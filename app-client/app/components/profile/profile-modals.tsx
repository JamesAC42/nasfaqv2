"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { AssetPicker } from "@/app/components/common/asset-picker";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { apiFetch } from "@/app/lib/api";
import { normalizeProfileBundle } from "@/app/lib/normalizers";
import type { ProfileBundle } from "@/app/lib/types";
import { useAuthStore } from "@/app/stores/auth-store";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/profile/profile.module.scss";

type Profile = ProfileBundle["profile"];

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(profile.username);
    setBio(profile.bio ?? "");
    setColor(profile.profile_color || "#3FB8F5");
    setOshi(profile.oshi_coin?.symbol ?? "");
    setError(null);
  }, [open, profile]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const asset = assets.find((entry) => entry.symbol === oshi) ?? null;
      const raw = await apiFetch<Record<string, unknown>>("/api/profiles/me", {
        method: "PUT",
        body: JSON.stringify({ username: name, bio, profile_color: color || null, oshi_coin_asset_id: asset?.id ?? null }),
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

type Picture = { id: number; name: string; url_large: string; url_small: string };

export function PictureModal({ open, profile, onClose, onSaved }: { open: boolean; profile: Profile; onClose: () => void; onSaved: (bundle: ProfileBundle) => void }) {
  const [pictures, setPictures] = useState<Picture[] | null>(null);
  const [busy, setBusy] = useState<number | "none" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || pictures) return;
    apiFetch<{ profile_pictures?: Array<Record<string, unknown>> }>("/api/assets/profile-pictures")
      .then((raw) =>
        setPictures(
          (raw.profile_pictures ?? [])
            .map((item) => ({ id: Number(item.id || 0), name: String(item.name || ""), url_large: String(item.url_large || ""), url_small: String(item.url_small || "") }))
            .filter((item) => item.id > 0 && item.url_small),
        ),
      )
      .catch(() => setPictures([]));
  }, [open, pictures]);

  if (!open) return null;
  const current = pictures?.find((item) => item.url_large === profile.profile_picture_url || item.url_small === profile.profile_picture_url)?.id ?? null;

  const pick = async (id: number | null) => {
    setBusy(id ?? "none");
    setError(null);
    try {
      const raw = await apiFetch<Record<string, unknown>>("/api/profiles/me/profile-picture", { method: "PUT", body: JSON.stringify({ profile_picture_id: id }) });
      onSaved(normalizeProfileBundle(raw));
      onClose();
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Choose your icon" onClose={onClose}>
      <div className={styles.pics}>
        <button type="button" aria-pressed={current === null && !profile.profile_picture_url} disabled={busy !== null} onClick={() => void pick(null)} title="Initials">
          <PlayerAvatar username={profile.username} color={profile.profile_color} size={64} />
        </button>
        {(pictures ?? []).map((item) => (
          <button key={item.id} type="button" aria-pressed={current === item.id} disabled={busy !== null} onClick={() => void pick(item.id)} title={item.name}>
            <img src={item.url_small} alt={item.name} loading="lazy" />
          </button>
        ))}
      </div>
      {pictures === null ? <p className={styles.note}>Loading icons…</p> : null}
      {error ? <p className={styles.err}>{error}</p> : null}
    </Modal>
  );
}
