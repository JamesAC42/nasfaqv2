"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState, type CSSProperties } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { displayName, equipCosmetic, slotFor, unequipCosmetic } from "@/app/components/games/locker/cosmetics";
import { AssetPicker } from "@/app/components/common/asset-picker";
import Link from "next/link";
import { Oshimark } from "@/app/components/common/oshimark";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { parseReaction } from "@/app/components/common/reaction-face";
import { apiFetch } from "@/app/lib/api";
import { normalizeGameInventoryResponse, normalizeProfileBundle, normalizeTheme } from "@/app/lib/normalizers";
import type { CosmeticTheme, GameInventoryResponse, ProfileBundle } from "@/app/lib/types";
import { useAuthStore } from "@/app/stores/auth-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useReactionStore } from "@/app/stores/reaction-store";
import styles from "@/app/components/profile/profile.module.scss";

type Profile = ProfileBundle["profile"];

/** A portfolio theme the player owns (a capsule prize), ready to show as a swatch and equip. */
type OwnedTheme = { id: number; slot: string; name: string; theme: CosmeticTheme };
const THEME_SLOT = "portfolio_theme";

/** The themes in an inventory, one per kind (duplicates collapse, the equipped copy wins). */
function ownedThemes(inventory: GameInventoryResponse): { themes: OwnedTheme[]; equipped: number | null } {
  const equipped = inventory.equipped.find((entry) => entry.slot_key === THEME_SLOT)?.cosmetic.id ?? null;
  const byKey = new Map<string, OwnedTheme>();
  for (const cosmetic of inventory.cosmetics) {
    if (cosmetic.cosmetic_type !== THEME_SLOT) continue;
    const raw = cosmetic.metadata?.theme;
    const theme = raw && typeof raw === "object" ? normalizeTheme(raw as Record<string, unknown>) : null;
    if (!theme || (byKey.has(cosmetic.cosmetic_key) && cosmetic.id !== equipped)) continue;
    byKey.set(cosmetic.cosmetic_key, { id: cosmetic.id, slot: slotFor(cosmetic), name: displayName(cosmetic).replace(/^Theme:\s*/i, ""), theme });
  }
  return { themes: [...byKey.values()], equipped };
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function SettingsModal({ open, profile, onClose, onSaved }: { open: boolean; profile: Profile; onClose: () => void; onSaved: (bundle: ProfileBundle) => void }) {
  const assets = useMarketStore((state) => state.assets);
  const [name, setName] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [color, setColor] = useState(profile.profile_color || "#3FB8F5");
  const [oshi, setOshi] = useState(profile.oshi_coin?.symbol ?? "");
  const [banner, setBanner] = useState(profile.profile_banner?.symbol ?? "");
  // Themes come from the games inventory, loaded when the modal opens (null while it loads).
  const [themes, setThemes] = useState<OwnedTheme[] | null>(null);
  const [equippedTheme, setEquippedTheme] = useState<number | null>(null);
  const [themeId, setThemeId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(profile.username);
    setBio(profile.bio ?? "");
    setColor(profile.profile_color || "#3FB8F5");
    setOshi(profile.oshi_coin?.symbol ?? "");
    setBanner(profile.profile_banner?.symbol ?? "");
    setError(null);
  }, [open, profile]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setThemes(null);
    apiFetch<Record<string, unknown>>("/api/games/me/inventory")
      .then((raw) => {
        if (cancelled) return;
        const owned = ownedThemes(normalizeGameInventoryResponse(raw));
        setThemes(owned.themes);
        setEquippedTheme(owned.equipped);
        setThemeId(owned.equipped);
      })
      .catch(() => {
        if (!cancelled) setThemes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const asset = assets.find((entry) => entry.symbol === oshi) ?? null;
      const bannerTalent = profile.banner_options.find((entry) => entry.symbol === banner) ?? null;
      // The theme first, so the profile the save returns already wears it.
      if (themes && themeId !== equippedTheme) {
        const chosen = themes.find((entry) => entry.id === themeId);
        if (chosen) await equipCosmetic(chosen.slot, chosen.id);
        else await unequipCosmetic(themes.find((entry) => entry.id === equippedTheme)?.slot ?? THEME_SLOT);
      }
      const raw = await apiFetch<Record<string, unknown>>("/api/profiles/me", {
        method: "PUT",
        body: JSON.stringify({
          username: name,
          bio,
          profile_color: color || null,
          oshi_coin_asset_id: asset?.id ?? null,
          profile_banner_asset_id: bannerTalent?.id ?? null,
        }),
      });
      onSaved(normalizeProfileBundle(raw));
      const current = useAuthStore.getState().user;
      if (current) useAuthStore.getState().setUser({ ...current, username: name });
      onClose();
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit profile" onClose={onClose}>
      <div className={styles.form}>
        <label>
          <span className={styles.label}>Username</span>
          <input value={name} maxLength={32} onChange={(event) => setName(event.target.value)} />
          <small>Letters, numbers, underscores and single spaces. 3–32 characters.</small>
        </label>
        <label>
          <span className={styles.label}>Bio</span>
          <textarea value={bio} maxLength={250} rows={3} onChange={(event) => setBio(event.target.value)} placeholder="Tell other traders what you're about." />
          <small>{bio.length}/250</small>
        </label>
        <div className={styles.formRow}>
          <label>
            <span className={styles.label}>Profile colour</span>
            <span className={styles.colorRow}>
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
              <code>{color}</code>
              <PlayerAvatar username={name || "?"} pictureUrl={profile.profile_picture_url} color={color} size={28} />
            </span>
          </label>
          <div>
            <span className={styles.label}>Oshi</span>
            <AssetPicker assets={assets} value={oshi} onChange={setOshi} placeholder="Pick your oshi" emptyLabel="No oshi" />
          </div>
        </div>
        <ThemeChoice themes={themes} value={themeId} onChange={setThemeId} />
        <BannerChoice options={profile.banner_options} value={banner} onChange={setBanner} />
        {themeId !== null && banner ? (
          <small className={styles.themeNote}>
            Your banner art fills the header, in place of the theme&apos;s pattern there. The theme still shades the banner and colours the rest of your page.
          </small>
        ) : null}
        {error ? (
          <p className={styles.err} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.formAct}>
          <button type="button" className={styles.ghost} onClick={onClose}>
            CANCEL
          </button>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void save()}>
            {busy ? "SAVING…" : "SAVE"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Portfolio themes you own (capsule prizes): each swatch is drawn like the header it gives you. */
function ThemeChoice({ themes, value, onChange }: { themes: OwnedTheme[] | null; value: number | null; onChange: (id: number | null) => void }) {
  return (
    <div className={styles.bannerField}>
      <span className={styles.label}>Theme</span>
      {themes?.length ? (
        <div className={styles.bannerGrid} role="radiogroup" aria-label="Profile theme">
          <button type="button" role="radio" aria-checked={value === null} className={`${styles.bannerChoice} ${styles.bannerNone}`} onClick={() => onChange(null)}>
            <span className={styles.bannerName}>None</span>
          </button>
          {themes.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={value === entry.id}
              className={styles.themeChoice}
              data-theme-pattern={entry.theme.pattern}
              style={{ "--th-a": entry.theme.accent, "--th-b": entry.theme.accent2 ?? entry.theme.accent } as CSSProperties}
              onClick={() => onChange(entry.id)}
              title={entry.name}
            >
              <span className={styles.bannerName}>{entry.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      <small>
        {themes === null ? (
          "Loading your themes…"
        ) : themes.length ? (
          "Colours your whole profile page, for everyone who visits."
        ) : (
          <>
            Themes come out of the capsule machine. <Link href="/games/capsule">Capsule machine →</Link>
          </>
        )}
      </small>
    </div>
  );
}

/** Banner art behind the profile header, from the talents whose SSR or UR card you own. */
function BannerChoice({ options, value, onChange }: { options: Profile["banner_options"]; value: string; onChange: (symbol: string) => void }) {
  return (
    <div className={styles.bannerField}>
      <span className={styles.label}>Banner</span>
      {options.length ? (
        <div className={styles.bannerGrid} role="radiogroup" aria-label="Profile banner">
          <button type="button" role="radio" aria-checked={!value} className={`${styles.bannerChoice} ${styles.bannerNone}`} onClick={() => onChange("")}>
            <span className={styles.bannerName}>None</span>
          </button>
          {options.map((talent) => (
            <button key={talent.symbol} type="button" role="radio" aria-checked={value === talent.symbol} className={styles.bannerChoice} onClick={() => onChange(talent.symbol)} title={talent.display_name}>
              <ArtSlot slot="banner" symbol={talent.symbol} icon={talent.icon} width={240} fit="cover" fallback={<span />} className={styles.bannerThumb} />
              <span className={styles.bannerName}>{talent.display_name.split(" ").slice(-1)[0]}</span>
            </button>
          ))}
        </div>
      ) : null}
      <small>
        {options.length ? "Yours while you own her SSR or UR card. " : "Own a talent's SSR or UR card to unlock her banner art here. "}
        <Link href="/games/cards/gallery">Card gallery →</Link>
      </small>
    </div>
  );
}

type Picture = { id: number; name: string; url_large: string; url_small: string };

export function PictureModal({ open, profile, onClose, onSaved }: { open: boolean; profile: Profile; onClose: () => void; onSaved: (bundle: ProfileBundle) => void }) {
  const [pictures, setPictures] = useState<Picture[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlocked = useReactionStore((state) => state.unlocked);
  const [talent, setTalent] = useState<string | null>(null);
  const loadReactions = useReactionStore((state) => state.load);

  useEffect(() => {
    if (!open) return;
    void loadReactions(true);
    if (pictures) return;
    apiFetch<{ profile_pictures?: Array<Record<string, unknown>> }>("/api/assets/profile-pictures")
      .then((raw) =>
        setPictures(
          (raw.profile_pictures ?? [])
            .map((item) => ({ id: Number(item.id || 0), name: String(item.name || ""), url_large: String(item.url_large || ""), url_small: String(item.url_small || "") }))
            .filter((item) => item.id > 0 && item.url_small),
        ),
      )
      .catch(() => setPictures([]));
  }, [open, pictures, loadReactions]);

  if (!open) return null;
  const currentReaction = parseReaction(profile.profile_picture_url);
  const shown = unlocked?.find((row) => row.symbol === (talent ?? currentReaction?.symbol)) ?? unlocked?.[0] ?? null;
  const current = currentReaction ? null : pictures?.find((item) => item.url_large === profile.profile_picture_url || item.url_small === profile.profile_picture_url)?.id ?? null;

  const pick = async (choice: { id: number | null } | { reaction: string }) => {
    const key = "reaction" in choice ? choice.reaction : String(choice.id ?? "none");
    setBusy(key);
    setError(null);
    try {
      const body = "reaction" in choice ? { reaction: choice.reaction } : { profile_picture_id: choice.id };
      const raw = await apiFetch<Record<string, unknown>>("/api/profiles/me/profile-picture", { method: "PUT", body: JSON.stringify(body) });
      const bundle = normalizeProfileBundle(raw);
      onSaved(bundle);
      // The header avatar reads the signed-in user.
      const user = useAuthStore.getState().user;
      if (user) useAuthStore.getState().setUser({ ...user, profile_picture_url: bundle.profile.profile_picture_url ?? null });
      onClose();
    } catch (reason) {
      const code = String((reason as Error).message || reason);
      setError(code === "reaction_locked" ? "You need one of her cards to use that reaction." : code);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Choose your icon" onClose={onClose}>
      <section className={styles.picSection} aria-labelledby="pic-reactions">
        <h3 id="pic-reactions">
          Card reactions <small>own any card of a talent to use her reactions</small>
        </h3>
        {unlocked === null ? (
          <p className={styles.note}>Loading your reactions…</p>
        ) : unlocked.length && shown ? (
          <>
            <div className={styles.reactionTalents} role="tablist" aria-label="Talents">
              {unlocked.map((talent) => (
                <button
                  key={talent.symbol}
                  type="button"
                  role="tab"
                  aria-selected={talent.symbol === shown.symbol}
                  onClick={() => setTalent(talent.symbol)}
                  title={talent.display_name}
                  style={{ "--tal": talent.color || "var(--blue)" } as React.CSSProperties}
                >
                  <Oshimark icon={talent.icon} symbol={talent.symbol} size={16} />
                  {talent.symbol}
                </button>
              ))}
            </div>
            <span className={styles.reactionName} style={{ "--tal": shown.color || "var(--blue)" } as React.CSSProperties}>
              {shown.display_name}
            </span>
            <div className={styles.pics}>
              {shown.poses.map((pose) => {
                const id = `${shown.symbol}/${pose}`;
                const selected = currentReaction?.symbol === shown.symbol && currentReaction.pose === pose;
                return (
                  <button key={pose} type="button" aria-pressed={selected} disabled={busy !== null} onClick={() => void pick({ reaction: id })} title={`${shown.display_name}: ${pose}`}>
                    <PlayerAvatar username={profile.username} pictureUrl={`reaction:${id}`} color={profile.profile_color || shown.color} size={64} />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className={styles.note}>
            None yet. Pull a card from the <Link href="/games/cards">card gacha</Link> and that talent&apos;s six reactions unlock here and as chat stickers.
          </p>
        )}
      </section>
      <section className={styles.picSection} aria-labelledby="pic-icons">
        <h3 id="pic-icons">Icons</h3>
        <div className={styles.pics}>
          <button type="button" aria-pressed={current === null && !profile.profile_picture_url} disabled={busy !== null} onClick={() => void pick({ id: null })} title="Initials">
            <PlayerAvatar username={profile.username} color={profile.profile_color} size={64} />
          </button>
          {(pictures ?? []).map((item) => (
            <button key={item.id} type="button" aria-pressed={current === item.id} disabled={busy !== null} onClick={() => void pick({ id: item.id })} title={item.name}>
              <img src={item.url_small} alt={item.name} loading="lazy" />
            </button>
          ))}
        </div>
        {pictures === null ? <p className={styles.note}>Loading icons…</p> : null}
      </section>
      {error ? <p className={styles.err}>{error}</p> : null}
    </Modal>
  );
}
