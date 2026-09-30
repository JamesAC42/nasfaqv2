"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess } from "@/app/components/admin/admin-frame";
import { Notice, Switch, Tabs, adminErrorText, adminUi as ui, useHashTab } from "@/app/components/admin/admin-ui";
import { apiFetch } from "@/app/lib/api";
import styles from "@/app/components/admin/admin-assets-page.module.scss";

// /admin/assets: emojis and profile pictures (admins and asset managers) and the capsule prize
// pool (admins only; the API leaves gacha_prizes out for asset managers). Uploads go to S3 through
// the API; prize odds update live as you type a weight. Asset-manager grants moved to People & roles.

type AdminEmojiAsset = {
  id: number;
  name: string;
  filename: string;
  url: string;
  is_deleted: boolean;
};

type AdminProfilePictureAsset = {
  id: number;
  name: string;
  filename_large: string;
  filename_small: string;
  url_large: string;
  url_small: string;
  is_deleted: boolean;
};

type AdminGachaPrizeAsset = {
  id: number;
  display_name: string;
  description: string;
  cosmetic_type: string;
  rarity: string;
  slot_key: string | null;
  pull_weight: number;
  pull_chance: number;
  image_key: string;
  filename: string;
  image_url: string;
  is_active: boolean;
  is_deleted: boolean;
  sort_order: number;
  /** Can change hands on the exchange (capsule pulls only). */
  tradable?: boolean;
};

type AdminAssetsResponse = {
  emojis?: AdminEmojiAsset[];
  profile_pictures?: AdminProfilePictureAsset[];
  gacha_prizes?: AdminGachaPrizeAsset[];
};

type Bundle = {
  emojis: AdminEmojiAsset[];
  profile_pictures: AdminProfilePictureAsset[];
  gacha_prizes: AdminGachaPrizeAsset[];
};

type TabKey = "emojis" | "pictures" | "prizes";
const TAB_KEYS = ["emojis", "pictures", "prizes"] as const;

const COSMETIC_TYPES = [
  ["profile_badge", "Profile badge"],
  ["profile_frame", "Profile frame"],
  ["chat_flair", "Chat flair"],
  ["portfolio_theme", "Portfolio theme"],
  ["hat", "Hat"],
  ["item", "Item"],
] as const;

const PRIZE_RARITIES = ["common", "rare", "epic", "legendary"] as const;

const EMOJI_MAX_BYTES = 200 * 1024;
const PICTURE_MAX_BYTES = 500 * 1024;

function normalizeBundle(raw: AdminAssetsResponse): Bundle {
  return {
    emojis: Array.isArray(raw?.emojis) ? raw.emojis : [],
    profile_pictures: Array.isArray(raw?.profile_pictures) ? raw.profile_pictures : [],
    gacha_prizes: Array.isArray(raw?.gacha_prizes) ? raw.gacha_prizes : [],
  };
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function formatChance(value: number) {
  if (!(value > 0)) return "0%";
  const percent = value * 100;
  return percent >= 10 ? `${percent.toFixed(1)}%` : percent >= 1 ? `${percent.toFixed(2)}%` : `${percent.toFixed(3)}%`;
}

/** An image that falls back to a labelled tile when the CDN can't serve it. */
function Thumb({ src, alt, size, className }: { src: string; alt: string; size: number; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  return (
    <span className={[styles.thumb, className].filter(Boolean).join(" ")} style={{ ["--s" as string]: `${size}px` }}>
      {failed || !src ? (
        <span className={styles.thumbMissing} role="img" aria-label={`${alt} (image missing)`}>
          {alt.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?"}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" onError={() => setFailedSrc(src)} />
      )}
    </span>
  );
}

/** A picked file with a local preview and its size against the limit. */
function FilePick({ id, label, file, limit, onPick }: { id: string; label: string; file: File | null; limit: number; onPick: (file: File | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      const timer = setTimeout(() => setPreview(null), 0);
      return () => clearTimeout(timer);
    }
    const url = URL.createObjectURL(file);
    const timer = setTimeout(() => setPreview(url), 0);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
  }, [file]);
  const over = file ? file.size > limit : false;
  return (
    <div className={ui.field}>
      <span>{label}</span>
      <div className={styles.filePick}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className={styles.filePreview} />
        ) : (
          <span className={styles.filePreviewEmpty} aria-hidden="true" />
        )}
        <input
          id={id}
          key={file ? "picked" : "empty"}
          className={ui.file}
          type="file"
          accept="image/jpeg,image/*"
          aria-label={label}
          onChange={(event) => onPick(event.target.files?.[0] || null)}
        />
      </div>
      {file ? (
        <small className={styles.fileSize} data-over={over || undefined}>
          {kb(file.size)} of {Math.round(limit / 1024)} KB
        </small>
      ) : null}
    </div>
  );
}

function useFlash() {
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(timer);
  }, [flash]);
  return [flash, setFlash] as const;
}

// ── Emojis ────────────────────────────────────────────────────────────────

function EmojiTile({ item, onUpdated }: { item: AdminEmojiAsset; onUpdated: (next: AdminEmojiAsset) => void }) {
  const [name, setName] = useState(item.name);
  const [isDeleted, setIsDeleted] = useState(item.is_deleted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();
  const [synced, setSynced] = useState(item);
  if (synced !== item) {
    setSynced(item);
    setName(item.name);
    setIsDeleted(item.is_deleted);
  }
  const dirty = name !== item.name || isDeleted !== item.is_deleted;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ emoji: AdminEmojiAsset }>(`/api/admin/assets/emojis/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, is_deleted: isDeleted }),
      });
      onUpdated(result.emoji);
      setFlash("Saved");
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.tile} data-removed={item.is_deleted || undefined}>
      <Thumb src={item.url} alt={item.name} size={64} className={styles.tileImage} />
      <input className={ui.input} value={name} onChange={(event) => setName(event.target.value)} aria-label={`Name for emoji ${item.name}`} />
      <small className={styles.filename} title={item.filename}>
        {item.filename}
      </small>
      <div className={styles.tileRow}>
        <Switch checked={!isDeleted} onChange={(next) => setIsDeleted(!next)} label={`${item.name} live`} on="Live" off="Hidden" />
        <button type="button" className={dirty ? ui.btnPrimary : ui.btn} disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "…" : "Save"}
        </button>
      </div>
      <div aria-live="polite" className={styles.tileStatus}>
        {error ? <p className={ui.inlineError}>{error}</p> : null}
        {flash ? <p className={ui.inlineOk}>{flash}</p> : null}
      </div>
    </li>
  );
}

function PictureTile({ item, onUpdated }: { item: AdminProfilePictureAsset; onUpdated: (next: AdminProfilePictureAsset) => void }) {
  const [name, setName] = useState(item.name);
  const [isDeleted, setIsDeleted] = useState(item.is_deleted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();
  const [synced, setSynced] = useState(item);
  if (synced !== item) {
    setSynced(item);
    setName(item.name);
    setIsDeleted(item.is_deleted);
  }
  const dirty = name !== item.name || isDeleted !== item.is_deleted;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ profile_picture: AdminProfilePictureAsset }>(`/api/admin/assets/profile-pictures/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, is_deleted: isDeleted }),
      });
      onUpdated(result.profile_picture);
      setFlash("Saved");
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.tile} data-removed={item.is_deleted || undefined}>
      <div className={styles.picPair}>
        <Thumb src={item.url_large} alt={`${item.name} large`} size={96} />
        <Thumb src={item.url_small} alt={`${item.name} small`} size={40} className={styles.picSmall} />
      </div>
      <input className={ui.input} value={name} onChange={(event) => setName(event.target.value)} aria-label={`Name for profile picture ${item.name}`} />
      <small className={styles.filename} title={`${item.filename_large} · ${item.filename_small}`}>
        {item.filename_large}
      </small>
      <div className={styles.tileRow}>
        <Switch checked={!isDeleted} onChange={(next) => setIsDeleted(!next)} label={`${item.name} live`} on="Live" off="Hidden" />
        <button type="button" className={dirty ? ui.btnPrimary : ui.btn} disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "…" : "Save"}
        </button>
      </div>
      <div aria-live="polite" className={styles.tileStatus}>
        {error ? <p className={ui.inlineError}>{error}</p> : null}
        {flash ? <p className={ui.inlineOk}>{flash}</p> : null}
      </div>
    </li>
  );
}

// ── Capsule prizes ────────────────────────────────────────────────────────

type PrizeDraft = {
  display_name: string;
  description: string;
  cosmetic_type: string;
  rarity: string;
  pull_weight: string;
  sort_order: string;
  is_active: boolean;
  tradable: boolean;
};

const draftOf = (item: AdminGachaPrizeAsset): PrizeDraft => ({
  display_name: item.display_name,
  description: item.description ?? "",
  cosmetic_type: item.cosmetic_type,
  rarity: item.rarity,
  pull_weight: String(item.pull_weight),
  sort_order: String(item.sort_order),
  is_active: item.is_active,
  tradable: item.tradable !== false,
});

const sameDraft = (a: PrizeDraft, b: PrizeDraft) => (Object.keys(a) as (keyof PrizeDraft)[]).every((key) => a[key] === b[key]);

/** Weight that counts toward the pool: live, in S3, and positive. */
function poolWeight(item: AdminGachaPrizeAsset, draft: PrizeDraft) {
  const weight = Number(draft.pull_weight);
  if (!draft.is_active || item.is_deleted || !Number.isFinite(weight) || weight <= 0) return 0;
  return weight;
}

function PrizeRow({
  item,
  draft,
  chance,
  onDraft,
  onSaved,
}: {
  item: AdminGachaPrizeAsset;
  draft: PrizeDraft;
  chance: number;
  onDraft: (patch: Partial<PrizeDraft>) => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !sameDraft(draft, draftOf(item));
  const weightNum = Number(draft.pull_weight);
  const weightBad = draft.pull_weight.trim() === "" || !Number.isFinite(weightNum) || weightNum < 0;
  const serverChanged = Math.abs(chance - (item.is_active && !item.is_deleted ? item.pull_chance : 0)) > 1e-9;

  async function save() {
    if (weightBad) {
      setError("Weight has to be zero or more.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ gacha_prize: AdminGachaPrizeAsset | null; gacha_prizes: AdminGachaPrizeAsset[] }>(`/api/admin/assets/gacha-prizes/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          display_name: draft.display_name,
          description: draft.description,
          cosmetic_type: draft.cosmetic_type,
          rarity: draft.rarity,
          pull_weight: Number(draft.pull_weight),
          sort_order: Number(draft.sort_order),
          is_active: draft.is_active,
          tradable: draft.tradable,
        }),
      });
      await onSaved(`${draft.display_name || "Prize"} saved.`);
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.prize} data-off={!draft.is_active || item.is_deleted || undefined} data-dirty={dirty || undefined}>
      <div className={styles.prizeImg} data-rarity={draft.rarity}>
        <Thumb src={item.image_url} alt={item.display_name} size={64} />
      </div>
      <div className={styles.prizeText}>
        <input className={ui.input} value={draft.display_name} onChange={(event) => onDraft({ display_name: event.target.value })} aria-label="Prize name" />
        <textarea
          className={`${ui.input} ${styles.desc}`}
          value={draft.description}
          rows={2}
          placeholder="Flavour text for the capsule reveal"
          onChange={(event) => onDraft({ description: event.target.value })}
          aria-label="Prize description"
        />
        <small className={styles.filename} title={item.image_key}>
          {item.filename} · slot {item.slot_key || draft.cosmetic_type}
        </small>
      </div>
      <div className={styles.prizeKind}>
        <label className={ui.field}>
          <span>Type</span>
          <select className={ui.select} value={draft.cosmetic_type} onChange={(event) => onDraft({ cosmetic_type: event.target.value })}>
            {COSMETIC_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          <span>Rarity</span>
          <select className={ui.select} value={draft.rarity} onChange={(event) => onDraft({ rarity: event.target.value })} data-rarity={draft.rarity}>
            {PRIZE_RARITIES.map((rarity) => (
              <option key={rarity} value={rarity}>
                {rarity[0].toUpperCase() + rarity.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.prizeOdds}>
        <label className={ui.field}>
          <span>Weight</span>
          <input
            className={ui.inputNum}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={draft.pull_weight}
            aria-invalid={weightBad || undefined}
            onChange={(event) => onDraft({ pull_weight: event.target.value })}
          />
        </label>
        <div className={styles.chance} data-changed={serverChanged || undefined}>
          <small>Actual chance</small>
          <b>{chance > 0 ? formatChance(chance) : draft.is_active && !item.is_deleted ? "0%" : "off"}</b>
          {serverChanged ? <em>was {formatChance(item.is_active && !item.is_deleted ? item.pull_chance : 0)}</em> : null}
        </div>
        <label className={ui.field}>
          <span>Sort</span>
          <input className={ui.inputNum} type="number" step="1" value={draft.sort_order} onChange={(event) => onDraft({ sort_order: event.target.value })} />
        </label>
      </div>
      <div className={styles.prizeSave}>
        <Switch checked={draft.is_active} onChange={(next) => onDraft({ is_active: next })} label={`${item.display_name} in the pool`} on="In pool" off="Out" />
        <Switch checked={draft.tradable} onChange={(next) => onDraft({ tradable: next })} label={`${item.display_name} can be traded on the exchange`} on="Tradable" off="Stays put" />
        {item.is_deleted ? (
          <span className={ui.pill} data-tone="warn">
            Missing from S3
          </span>
        ) : null}
        <button type="button" className={dirty ? ui.btnPrimary : ui.btn} disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        {error ? <p className={ui.inlineError}>{error}</p> : null}
      </div>
    </li>
  );
}

function PrizePool({ bundle, reload, onMessage }: { bundle: Bundle; reload: () => Promise<void>; onMessage: (tone: "ok" | "error", text: string) => void }) {
  const [drafts, setDrafts] = useState<Record<number, PrizeDraft>>({});
  const [syncBusy, setSyncBusy] = useState(false);
  const prizes = bundle.gacha_prizes;

  // Drafts only hold edits; anything untouched reads straight from the server row.
  const draftFor = useCallback((item: AdminGachaPrizeAsset) => drafts[item.id] ?? draftOf(item), [drafts]);

  const total = useMemo(() => prizes.reduce((sum, item) => sum + poolWeight(item, draftFor(item)), 0), [prizes, draftFor]);
  const byRarity = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const item of prizes) {
      const draft = draftFor(item);
      sums[draft.rarity] = (sums[draft.rarity] ?? 0) + poolWeight(item, draft);
    }
    return PRIZE_RARITIES.map((rarity) => ({ rarity, share: total > 0 ? (sums[rarity] ?? 0) / total : 0 }));
  }, [prizes, draftFor, total]);
  const inPool = prizes.filter((item) => poolWeight(item, draftFor(item)) > 0).length;
  const editing = Object.keys(drafts).filter((id) => {
    const item = prizes.find((entry) => entry.id === Number(id));
    return item && !sameDraft(drafts[Number(id)], draftOf(item));
  }).length;

  async function sync() {
    setSyncBusy(true);
    try {
      const result = await apiFetch<{ sync: { total: number }; gacha_prizes: AdminGachaPrizeAsset[] }>("/api/admin/assets/gacha-prizes/sync", { method: "POST" });
      await reload();
      onMessage("ok", `Synced. Found ${result?.sync?.total ?? 0} image files in gachaprizes/.`);
    } catch (caught) {
      onMessage("error", adminErrorText(caught));
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <div role="tabpanel" id="panel-prizes" aria-labelledby="tab-prizes">
      <div className={styles.toolbar}>
        <p className={styles.help}>
          Weight sets the odds; the chance updates as you type. Sort only changes display order. New art goes in S3 under <code>gachaprizes/</code>, then sync.
        </p>
        <button type="button" className={ui.btnPrimary} disabled={syncBusy} onClick={() => void sync()}>
          {syncBusy ? "Syncing…" : "Sync from S3"}
        </button>
      </div>

      {prizes.length ? (
        <div className={styles.odds}>
          <div className={styles.oddsHead}>
            <b>Pool</b>
            <span>
              {inPool} of {prizes.length} prizes · weight {Number(total.toFixed(2))}
              {editing ? ` · ${editing} unsaved` : ""}
            </span>
          </div>
          <div className={styles.oddsBar} role="img" aria-label={byRarity.map((entry) => `${entry.rarity} ${formatChance(entry.share)}`).join(", ")}>
            {byRarity.map((entry) => (entry.share > 0 ? <i key={entry.rarity} data-rarity={entry.rarity} style={{ flexGrow: entry.share }} /> : null))}
          </div>
          <ul className={styles.oddsLegend}>
            {byRarity.map((entry) => (
              <li key={entry.rarity} data-rarity={entry.rarity}>
                <i aria-hidden="true" />
                {entry.rarity}
                <b>{formatChance(entry.share)}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {prizes.length ? (
        <ul className={styles.prizes}>
          {prizes.map((item) => {
            const draft = draftFor(item);
            const weight = poolWeight(item, draft);
            return (
              <PrizeRow
                key={item.id}
                item={item}
                draft={draft}
                chance={total > 0 ? weight / total : 0}
                onDraft={(patch) => setDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? draftOf(item)), ...patch } }))}
                onSaved={async (message) => {
                  await reload();
                  setDrafts((current) => {
                    const next = { ...current };
                    delete next[item.id];
                    return next;
                  });
                  onMessage("ok", message);
                }}
              />
            );
          })}
        </ul>
      ) : (
        <p className={ui.empty}>No prizes catalogued yet. Drop image files in S3 under gachaprizes/, then sync.</p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export function AdminAssetsPage() {
  const access = useAdminAccess();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [tab, setTabState] = useState<TabKey>("emojis");
  const setTab = useHashTab(TAB_KEYS, "emojis", setTabState);

  const [emojiName, setEmojiName] = useState("");
  const [emojiFile, setEmojiFile] = useState<File | null>(null);
  const [emojiBusy, setEmojiBusy] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileLargeFile, setProfileLargeFile] = useState<File | null>(null);
  const [profileSmallFile, setProfileSmallFile] = useState<File | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const { initialized, isAdmin, canAssets } = access;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await apiFetch<AdminAssetsResponse>("/api/admin/assets", { cache: "no-store", ...(signal ? { signal } : {}) });
      if (signal?.aborted) return;
      setBundle(normalizeBundle(result));
      setLoadError(null);
    } catch (caught) {
      if ((caught as Error).name === "AbortError") return;
      setLoadError(adminErrorText(caught));
    }
  }, []);

  useEffect(() => {
    if (!initialized || !canAssets) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [initialized, canAssets, load]);

  const say = useCallback((tone: "ok" | "error", text: string) => setMessage({ tone, text }), []);

  async function handleCreateEmoji(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emojiFile) return say("error", "Pick an emoji image first.");
    if (emojiFile.size > EMOJI_MAX_BYTES) return say("error", `That emoji is ${kb(emojiFile.size)}; the limit is 200 KB. Use a small square 64×64 JPEG.`);
    setEmojiBusy(true);
    setMessage(null);
    try {
      const imageDataUrl = await fileToDataUrl(emojiFile);
      const result = await apiFetch<{ emoji: AdminEmojiAsset }>("/api/admin/assets/emojis", {
        method: "POST",
        body: JSON.stringify({ name: emojiName, image_data_url: imageDataUrl }),
      });
      setBundle((current) => (current ? { ...current, emojis: [result.emoji, ...current.emojis.filter((item) => item.id !== result.emoji.id)] } : current));
      setEmojiName("");
      setEmojiFile(null);
      say("ok", `:${result.emoji.name}: is up.`);
    } catch (caught) {
      say("error", adminErrorText(caught));
    } finally {
      setEmojiBusy(false);
    }
  }

  async function handleCreateProfilePicture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileLargeFile || !profileSmallFile) return say("error", "Pick both the large and the small file.");
    if (profileLargeFile.size > PICTURE_MAX_BYTES) return say("error", `The large picture is ${kb(profileLargeFile.size)}; the limit is 500 KB. Use a 256×256 JPEG.`);
    if (profileSmallFile.size > PICTURE_MAX_BYTES) return say("error", `The small picture is ${kb(profileSmallFile.size)}; the limit is 500 KB. Use a 128×128 JPEG.`);
    setProfileBusy(true);
    setMessage(null);
    try {
      const [largeDataUrl, smallDataUrl] = await Promise.all([fileToDataUrl(profileLargeFile), fileToDataUrl(profileSmallFile)]);
      const result = await apiFetch<{ profile_picture: AdminProfilePictureAsset }>("/api/admin/assets/profile-pictures", {
        method: "POST",
        body: JSON.stringify({ name: profileName, image_large_data_url: largeDataUrl, image_small_data_url: smallDataUrl }),
      });
      setBundle((current) =>
        current ? { ...current, profile_pictures: [result.profile_picture, ...current.profile_pictures.filter((item) => item.id !== result.profile_picture.id)] } : current,
      );
      setProfileName("");
      setProfileLargeFile(null);
      setProfileSmallFile(null);
      say("ok", `${result.profile_picture.name} is up.`);
    } catch (caught) {
      say("error", adminErrorText(caught));
    } finally {
      setProfileBusy(false);
    }
  }

  const needle = filter.trim().toLowerCase();
  const emojis = useMemo(
    () => (bundle?.emojis ?? []).filter((item) => (showHidden || !item.is_deleted) && (!needle || `${item.name} ${item.filename}`.toLowerCase().includes(needle))),
    [bundle?.emojis, showHidden, needle],
  );
  const pictures = useMemo(
    () =>
      (bundle?.profile_pictures ?? []).filter(
        (item) => (showHidden || !item.is_deleted) && (!needle || `${item.name} ${item.filename_large}`.toLowerCase().includes(needle)),
      ),
    [bundle?.profile_pictures, showHidden, needle],
  );

  if (!initialized) return <AdminLoading title="Assets & prizes" />;
  if (!canAssets) return <AdminGate title="Assets & prizes" signedIn={access.signedIn} need="admins and asset managers" />;

  const activeTab: TabKey = tab === "prizes" && !isAdmin ? "emojis" : tab;
  const hiddenEmojis = (bundle?.emojis ?? []).filter((item) => item.is_deleted).length;
  const hiddenPictures = (bundle?.profile_pictures ?? []).filter((item) => item.is_deleted).length;
  const hiddenHere = activeTab === "emojis" ? hiddenEmojis : hiddenPictures;
  const livePrizes = (bundle?.gacha_prizes ?? []).filter((item) => item.is_active && !item.is_deleted).length;

  const tabs = [
    { key: "emojis" as const, label: "Emojis", count: bundle ? bundle.emojis.length - hiddenEmojis : "…" },
    { key: "pictures" as const, label: "Profile pictures", count: bundle ? bundle.profile_pictures.length - hiddenPictures : "…" },
    ...(isAdmin ? [{ key: "prizes" as const, label: "Capsule prizes", count: bundle ? livePrizes : "…" }] : []),
  ];

  const onEmojiUpdated = (next: AdminEmojiAsset) =>
    setBundle((current) => (current ? { ...current, emojis: current.emojis.map((entry) => (entry.id === next.id ? next : entry)) } : current));
  const onPictureUpdated = (next: AdminProfilePictureAsset) =>
    setBundle((current) => (current ? { ...current, profile_pictures: current.profile_pictures.map((entry) => (entry.id === next.id ? next : entry)) } : current));

  return (
    <AdminFrame
      title="Assets & prizes"
      blurb={
        bundle ? (
          <>
            <b>{bundle.emojis.length - hiddenEmojis}</b> emojis, <b>{bundle.profile_pictures.length - hiddenPictures}</b> profile pictures
            {isAdmin ? (
              <>
                , <b>{livePrizes}</b> prizes in the capsule
              </>
            ) : null}
            .
          </>
        ) : (
          "Loading the catalogue…"
        )
      }
      aside={
        isAdmin ? (
          <Link href="/admin/people?role=can_manage_assets" className={ui.btn}>
            Asset managers →
          </Link>
        ) : null
      }
    >
      <Tabs tabs={tabs} value={activeTab} onChange={(key) => setTab(key)} label="Asset type" />

      {loadError ? (
        <Notice>
          {loadError}{" "}
          <button type="button" className={ui.btnGhost} onClick={() => void load()}>
            Retry
          </button>
        </Notice>
      ) : null}
      {message ? (
        <Notice tone={message.tone} onClose={() => setMessage(null)}>
          {message.text}
        </Notice>
      ) : null}

      {!bundle ? (
        loadError ? null : <p className={ui.empty}>Loading the catalogue…</p>
      ) : activeTab === "prizes" ? (
        <PrizePool bundle={bundle} reload={() => load()} onMessage={say} />
      ) : (
        <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
          {activeTab === "emojis" ? (
            <form className={styles.upload} onSubmit={(event) => void handleCreateEmoji(event)}>
              <div className={styles.uploadHead}>
                <b>Upload an emoji</b>
                <span>Square 64×64 JPEG under 200 KB. Short hyphenated name: smile-cat, holo-logo.</span>
              </div>
              <label className={ui.field}>
                <span>Name</span>
                <input className={ui.input} value={emojiName} onChange={(event) => setEmojiName(event.target.value)} placeholder="smile-cat" />
              </label>
              <FilePick id="emoji-file" label="Image" file={emojiFile} limit={EMOJI_MAX_BYTES} onPick={setEmojiFile} />
              <button type="submit" className={ui.btnPrimary} disabled={emojiBusy}>
                {emojiBusy ? "Uploading…" : "Upload"}
              </button>
            </form>
          ) : (
            <form className={`${styles.upload} ${styles.uploadWide}`} onSubmit={(event) => void handleCreateProfilePicture(event)}>
              <div className={styles.uploadHead}>
                <b>Upload a profile picture</b>
                <span>Two square JPEGs under 500 KB each: 256×256 large, 128×128 small.</span>
              </div>
              <label className={ui.field}>
                <span>Name</span>
                <input className={ui.input} value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="pekora-carrot" />
              </label>
              <FilePick id="profile-large" label="Large · 256" file={profileLargeFile} limit={PICTURE_MAX_BYTES} onPick={setProfileLargeFile} />
              <FilePick id="profile-small" label="Small · 128" file={profileSmallFile} limit={PICTURE_MAX_BYTES} onPick={setProfileSmallFile} />
              <button type="submit" className={ui.btnPrimary} disabled={profileBusy}>
                {profileBusy ? "Uploading…" : "Upload"}
              </button>
            </form>
          )}

          <div className={styles.gridTools}>
            <label className={styles.filter}>
              <span className={ui.srOnly}>Filter</span>
              <input className={ui.input} type="search" value={filter} placeholder="Filter by name" onChange={(event) => setFilter(event.target.value)} />
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />
              Show hidden ({hiddenHere})
            </label>
          </div>

          {activeTab === "emojis" ? (
            emojis.length ? (
              <ul className={styles.grid}>
                {emojis.map((item) => (
                  <EmojiTile key={item.id} item={item} onUpdated={onEmojiUpdated} />
                ))}
              </ul>
            ) : (
              <p className={ui.empty}>{bundle.emojis.length ? "Nothing matches." : "No emojis catalogued yet."}</p>
            )
          ) : pictures.length ? (
            <ul className={`${styles.grid} ${styles.gridPics}`}>
              {pictures.map((item) => (
                <PictureTile key={item.id} item={item} onUpdated={onPictureUpdated} />
              ))}
            </ul>
          ) : (
            <p className={ui.empty}>{bundle.profile_pictures.length ? "Nothing matches." : "No profile pictures catalogued yet."}</p>
          )}
        </div>
      )}
    </AdminFrame>
  );
}
