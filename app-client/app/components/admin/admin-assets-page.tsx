"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/admin/admin-assets-page.module.scss";

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
};

type AdminAssetsResponse = {
  emojis: AdminEmojiAsset[];
  profile_pictures: AdminProfilePictureAsset[];
  gacha_prizes: AdminGachaPrizeAsset[];
};

function StatusMessage({ error, success }: { error: string | null; success: string | null }) {
  return (
    <>
      {error ? <div className="statusMessage statusMessageError">{error}</div> : null}
      {success ? <div className="statusMessage statusMessageSuccess">{success}</div> : null}
    </>
  );
}

function AssetSection({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <div className={styles.sectionNote}>{note}</div>
      </div>
      {children}
    </section>
  );
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

function EmojiRow({
  item,
  onUpdated,
}: {
  item: AdminEmojiAsset;
  onUpdated: (next: AdminEmojiAsset) => void;
}) {
  const [name, setName] = useState(item.name);
  const [isDeleted, setIsDeleted] = useState(item.is_deleted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(item.name);
    setIsDeleted(item.is_deleted);
  }, [item.id, item.is_deleted, item.name]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ emoji: AdminEmojiAsset }>(`/api/admin/assets/emojis/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, is_deleted: isDeleted }),
      });
      onUpdated(result.emoji);
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <div className={styles.previewCell}>
          <img src={item.url} alt={item.name} className={styles.previewImage} />
          <span className={styles.filename}>{item.filename}</span>
        </div>
      </td>
      <td>
        <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} />
      </td>
      <td>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={isDeleted} onChange={(event) => setIsDeleted(event.target.checked)} />
          {isDeleted ? "Deleted" : "Active"}
        </label>
      </td>
      <td className={item.is_deleted ? styles.statusDeleted : styles.statusActive}>{item.is_deleted ? "Deleted" : "Active"}</td>
      <td>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void handleSave()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {error ? <div className="statusMessage statusMessageError">{error}</div> : null}
      </td>
    </tr>
  );
}

function ProfilePictureRow({
  item,
  onUpdated,
}: {
  item: AdminProfilePictureAsset;
  onUpdated: (next: AdminProfilePictureAsset) => void;
}) {
  const [name, setName] = useState(item.name);
  const [isDeleted, setIsDeleted] = useState(item.is_deleted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(item.name);
    setIsDeleted(item.is_deleted);
  }, [item.id, item.is_deleted, item.name]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ profile_picture: AdminProfilePictureAsset }>(`/api/admin/assets/profile-pictures/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, is_deleted: isDeleted }),
      });
      onUpdated(result.profile_picture);
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <div className={styles.previewCell}>
          <img src={item.url_large} alt={`${item.name} large`} className={styles.previewImage} />
          <span className={styles.filename}>{item.filename_large}</span>
        </div>
      </td>
      <td>
        <div className={styles.previewCell}>
          <img src={item.url_small} alt={`${item.name} small`} className={styles.previewImage} />
          <span className={styles.filename}>{item.filename_small}</span>
        </div>
      </td>
      <td>
        <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} />
      </td>
      <td>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={isDeleted} onChange={(event) => setIsDeleted(event.target.checked)} />
          {isDeleted ? "Deleted" : "Active"}
        </label>
      </td>
      <td className={item.is_deleted ? styles.statusDeleted : styles.statusActive}>{item.is_deleted ? "Deleted" : "Active"}</td>
      <td>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void handleSave()}>
          {busy ? "Saving…" : "Save"}
        </button>
        {error ? <div className="statusMessage statusMessageError">{error}</div> : null}
      </td>
    </tr>
  );
}

function formatChance(value: number) {
  if (!(value > 0)) return "0%";
  const percent = value * 100;
  return percent >= 1 ? `${percent.toFixed(1)}%` : `${percent.toFixed(2)}%`;
}

function GachaPrizeRow({
  item,
  onSaved,
}: {
  item: AdminGachaPrizeAsset;
  onSaved: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(item.display_name);
  const [description, setDescription] = useState(item.description);
  const [cosmeticType, setCosmeticType] = useState(item.cosmetic_type);
  const [rarity, setRarity] = useState(item.rarity);
  const [pullWeight, setPullWeight] = useState(String(item.pull_weight));
  const [sortOrder, setSortOrder] = useState(String(item.sort_order));
  const [isActive, setIsActive] = useState(item.is_active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(item.display_name);
    setDescription(item.description);
    setCosmeticType(item.cosmetic_type);
    setRarity(item.rarity);
    setPullWeight(String(item.pull_weight));
    setSortOrder(String(item.sort_order));
    setIsActive(item.is_active);
  }, [item]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ gacha_prize: AdminGachaPrizeAsset | null; gacha_prizes: AdminGachaPrizeAsset[] }>(`/api/admin/assets/gacha-prizes/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName,
          description,
          cosmetic_type: cosmeticType,
          rarity,
          pull_weight: Number(pullWeight),
          sort_order: Number(sortOrder),
          is_active: isActive,
        }),
      });
      await onSaved();
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <div className={styles.previewCell}>
          <div
            className={styles.previewImage}
            role="img"
            aria-label={item.display_name}
            style={{ backgroundImage: `url("${item.image_url}")` }}
          />
          <span className={styles.filename}>{item.filename}</span>
        </div>
      </td>
      <td>
        <div className={styles.prizeFields}>
          <input className={styles.input} value={displayName} onChange={(event) => setDisplayName(event.target.value)} aria-label="Prize name" />
          <textarea className={styles.textarea} value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Prize description" />
        </div>
      </td>
      <td>
        <div className={styles.prizeFields}>
          <select className={styles.input} value={cosmeticType} onChange={(event) => setCosmeticType(event.target.value)} aria-label="Cosmetic type">
            <option value="profile_badge">Profile badge</option>
            <option value="profile_frame">Profile frame</option>
            <option value="chat_flair">Chat flair</option>
            <option value="portfolio_theme">Portfolio theme</option>
            <option value="hat">Hat</option>
            <option value="item">Item</option>
          </select>
          <select className={styles.input} value={rarity} onChange={(event) => setRarity(event.target.value)} aria-label="Rarity">
            <option value="common">Common</option>
            <option value="rare">Rare</option>
            <option value="epic">Epic</option>
            <option value="legendary">Legendary</option>
          </select>
          <span className={styles.filename}>Equip slot: {item.slot_key || cosmeticType}</span>
        </div>
      </td>
      <td>
        <div className={styles.prizeFields}>
          <input className={styles.input} type="number" min="0" step="0.01" value={pullWeight} onChange={(event) => setPullWeight(event.target.value)} aria-label="Pull chance weight" />
          <span className={styles.filename}>Actual chance: {formatChance(item.pull_chance)}</span>
        </div>
      </td>
      <td>
        <input className={styles.input} type="number" step="1" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} aria-label="Sort order" />
      </td>
      <td>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          {isActive ? "Active" : "Inactive"}
        </label>
        <div className={item.is_deleted ? styles.statusDeleted : styles.statusActive}>{item.is_deleted ? "Missing from S3" : "In S3"}</div>
      </td>
      <td>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void handleSave()}>
          {busy ? "Saving..." : "Save"}
        </button>
        {error ? <div className="statusMessage statusMessageError">{error}</div> : null}
      </td>
    </tr>
  );
}

export function AdminAssetsPage() {
  const { initialized, isLoading: isAuthLoading, user } = useAuth();
  const [bundle, setBundle] = useState<AdminAssetsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [emojiName, setEmojiName] = useState("");
  const [emojiFile, setEmojiFile] = useState<File | null>(null);
  const [emojiBusy, setEmojiBusy] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileLargeFile, setProfileLargeFile] = useState<File | null>(null);
  const [profileSmallFile, setProfileSmallFile] = useState<File | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [gachaSyncBusy, setGachaSyncBusy] = useState(false);

  const loadAdminAssets = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiFetch<AdminAssetsResponse>("/api/admin/assets", signal ? { signal } : undefined);
      if (!signal?.aborted) setBundle(result);
    } catch (nextError) {
      if ((nextError as Error).name === "AbortError") return;
      setError(String((nextError as Error).message || nextError));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized || !user?.is_admin) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    void loadAdminAssets(controller.signal);
    return () => controller.abort();
  }, [initialized, loadAdminAssets, user?.is_admin]);

  async function handleCreateEmoji(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emojiFile) {
      setError("Choose an emoji image first.");
      return;
    }

    setEmojiBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const imageDataUrl = await fileToDataUrl(emojiFile);
      const result = await apiFetch<{ emoji: AdminEmojiAsset }>("/api/admin/assets/emojis", {
        method: "POST",
        body: JSON.stringify({
          name: emojiName,
          image_data_url: imageDataUrl,
        }),
      });
      setBundle((current) => current ? { ...current, emojis: [result.emoji, ...current.emojis.filter((item) => item.id !== result.emoji.id)] } : current);
      setEmojiName("");
      setEmojiFile(null);
      setSuccess("Emoji uploaded.");
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setEmojiBusy(false);
    }
  }

  async function handleCreateProfilePicture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileLargeFile || !profileSmallFile) {
      setError("Choose both the large and small profile picture files.");
      return;
    }

    setProfileBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const [largeDataUrl, smallDataUrl] = await Promise.all([
        fileToDataUrl(profileLargeFile),
        fileToDataUrl(profileSmallFile),
      ]);
      const result = await apiFetch<{ profile_picture: AdminProfilePictureAsset }>("/api/admin/assets/profile-pictures", {
        method: "POST",
        body: JSON.stringify({
          name: profileName,
          image_large_data_url: largeDataUrl,
          image_small_data_url: smallDataUrl,
        }),
      });
      setBundle((current) =>
        current
          ? {
              ...current,
              profile_pictures: [result.profile_picture, ...current.profile_pictures.filter((item) => item.id !== result.profile_picture.id)],
            }
          : current
      );
      setProfileName("");
      setProfileLargeFile(null);
      setProfileSmallFile(null);
      setSuccess("Profile picture uploaded.");
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleSyncGachaPrizes() {
    setGachaSyncBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiFetch<{ sync: { total: number }; gacha_prizes: AdminGachaPrizeAsset[] }>("/api/admin/assets/gacha-prizes/sync", {
        method: "POST",
      });
      setBundle((current) => current ? { ...current, gacha_prizes: result.gacha_prizes } : current);
      setSuccess(`Gacha prize sync complete. Found ${result.sync.total} image files in gachaprizes/.`);
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setGachaSyncBusy(false);
    }
  }

  if (!initialized || isAuthLoading) {
    return (
      <SiteShell>
        <div className={styles.empty}>Loading admin session…</div>
      </SiteShell>
    );
  }

  if (!user?.is_admin) {
    return (
      <SiteShell>
        <div className={styles.empty}>This page is limited to admin users.</div>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>Admin Portal</div>
          <h1 className={styles.title}>Asset Management</h1>
          <p className={styles.copy}>
            Manage emoji assets and profile picture inventories synced from S3. New uploads are written to the bucket and tracked in the database catalog.
          </p>
        </section>

        <StatusMessage error={error} success={success} />
        {isLoading && !bundle ? <div className={styles.empty}>Loading asset catalog…</div> : null}

        {bundle ? (
          <>
            <AssetSection title="Emojis" note="Files sync from `emojis/` and use the `64_*.jpg` naming pattern.">
              <form onSubmit={(event) => void handleCreateEmoji(event)}>
                <div className={styles.createRow}>
                  <div className={styles.formGrid}>
                    <div className={styles.field}>
                      <label htmlFor="emoji-name">Name</label>
                      <input id="emoji-name" className={styles.input} value={emojiName} onChange={(event) => setEmojiName(event.target.value)} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="emoji-file">Image</label>
                      <input id="emoji-file" className={styles.fileInput} type="file" accept="image/*" onChange={(event) => setEmojiFile(event.target.files?.[0] || null)} />
                    </div>
                  </div>
                  <div className={styles.createAction}>
                    <button type="submit" className={styles.primaryButton} disabled={emojiBusy}>
                      {emojiBusy ? "Uploading…" : "Create Emoji"}
                    </button>
                  </div>
                </div>
              </form>

              {bundle.emojis.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Preview</th>
                        <th>Name</th>
                        <th>Deleted</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.emojis.map((item) => (
                        <EmojiRow
                          key={item.id}
                          item={item}
                          onUpdated={(next) =>
                            setBundle((current) =>
                              current
                                ? {
                                    ...current,
                                    emojis: current.emojis.map((entry) => (entry.id === next.id ? next : entry)),
                                  }
                                : current
                            )
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.empty}>No emojis are cataloged yet.</div>
              )}
            </AssetSection>

            <AssetSection title="Profile Pictures" note="Files sync from `profile-pictures/large` and `profile-pictures/small`.">
              <form onSubmit={(event) => void handleCreateProfilePicture(event)}>
                <div className={styles.createRow}>
                  <div className={styles.formGrid}>
                    <div className={styles.field}>
                      <label htmlFor="profile-name">Name</label>
                      <input id="profile-name" className={styles.input} value={profileName} onChange={(event) => setProfileName(event.target.value)} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="profile-large">Large image</label>
                      <input id="profile-large" className={styles.fileInput} type="file" accept="image/*" onChange={(event) => setProfileLargeFile(event.target.files?.[0] || null)} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="profile-small">Small image</label>
                      <input id="profile-small" className={styles.fileInput} type="file" accept="image/*" onChange={(event) => setProfileSmallFile(event.target.files?.[0] || null)} />
                    </div>
                  </div>
                  <div className={styles.createAction}>
                    <button type="submit" className={styles.primaryButton} disabled={profileBusy}>
                      {profileBusy ? "Uploading…" : "Create Profile Picture"}
                    </button>
                  </div>
                </div>
              </form>

              {bundle.profile_pictures.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Large</th>
                        <th>Small</th>
                        <th>Name</th>
                        <th>Deleted</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.profile_pictures.map((item) => (
                        <ProfilePictureRow
                          key={item.id}
                          item={item}
                          onUpdated={(next) =>
                            setBundle((current) =>
                              current
                                ? {
                                    ...current,
                                    profile_pictures: current.profile_pictures.map((entry) => (entry.id === next.id ? next : entry)),
                                  }
                                : current
                            )
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.empty}>No profile pictures are cataloged yet.</div>
              )}
            </AssetSection>

            <AssetSection title="Gacha Prize Catalogue" note="Click refresh to sync image files from the S3 `gachaprizes/` folder, then edit names, descriptions, and pull weights.">
              <div className={styles.createRow}>
                <p className={styles.sectionNote}>
                  Pull weight controls chance. Sort only controls display order in the admin and player catalogue.
                </p>
                <div className={styles.createAction}>
                  <button type="button" className={styles.primaryButton} disabled={gachaSyncBusy} onClick={() => void handleSyncGachaPrizes()}>
                    {gachaSyncBusy ? "Refreshing..." : "Refresh From S3"}
                  </button>
                </div>
              </div>

              {bundle.gacha_prizes.length ? (
                <div className={styles.tableWrap}>
                  <table className={`${styles.table} ${styles.prizeTable}`.trim()}>
                    <thead>
                      <tr>
                        <th>Image</th>
                        <th>Name and Description</th>
                        <th>Type</th>
                        <th>Pull Weight</th>
                        <th>Sort</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.gacha_prizes.map((item) => (
                        <GachaPrizeRow
                          key={item.id}
                          item={item}
                          onSaved={async () => {
                            setSuccess("Gacha prize saved.");
                            await loadAdminAssets();
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.empty}>No gacha prizes are cataloged yet. Add image files to S3 under `gachaprizes/`, then refresh.</div>
              )}
            </AssetSection>
          </>
        ) : null}
      </div>
    </SiteShell>
  );
}
