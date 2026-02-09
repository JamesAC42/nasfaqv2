"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

type SavedChannel = {
  youtube_channel_id: string;
  name: string;
  symbol: string | null;
  icon: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  youtube_channel_url?: string;
};

export default function AddChannelPage() {
  const [youtubeChannelId, setYoutubeChannelId] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [icon, setIcon] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedChannel | null>(null);

  const canSubmit = useMemo(() => {
    return youtubeChannelId.trim().length > 0 && name.trim().length > 0 && !saving;
  }, [youtubeChannelId, name, saving]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtube_channel_id: youtubeChannelId.trim(),
          name: name.trim(),
          symbol: symbol.trim() ? symbol.trim() : null,
          icon: icon.trim() ? icon.trim() : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ? String(data.error) : `HTTP ${res.status}`);
      }
      setSaved(data as SavedChannel);
      setYoutubeChannelId("");
      setName("");
      setSymbol("");
      setIcon("");
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="title">Add YouTube Channel</h1>
          <p className="subtitle">
            Saves to <span className="muted">yt.youtube_channels</span> via <span className="muted">POST /api/channels</span>
          </p>
        </div>
        <Link className="pill" href="/">
          Back to dashboard
        </Link>
      </div>

      <div className="card">
        <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.9rem" }}>
          <Field label="YouTube channel ID" hint="Example: UC_x5XG1OV2P6uZZ5FSM9Ttw">
            <input
              value={youtubeChannelId}
              onChange={(e) => setYoutubeChannelId(e.target.value)}
              placeholder="UC..."
              style={inputStyle}
            />
          </Field>

          <Field label="Name" hint="Display name used in the dashboard">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Channel name" style={inputStyle} />
          </Field>

          <Field label="Symbol (optional)" hint="Ticker / short label">
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. Holo" style={inputStyle} />
          </Field>

          <Field label="Icon (optional)" hint="URL/path to icon image">
            <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="https://..." style={inputStyle} />
          </Field>

          <button className="btn" type="submit" disabled={!canSubmit}>
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      </div>

      {error ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="name">Error</p>
          <p className="muted">{error}</p>
        </div>
      ) : null}

      {saved ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="name">Saved</p>
          <div className="kv" style={{ marginTop: "0.5rem" }}>
            <div className="k">ID</div>
            <div className="v">{saved.youtube_channel_id}</div>
            <div className="k">Name</div>
            <div className="v">{saved.name}</div>
            <div className="k">Symbol</div>
            <div className="v">{saved.symbol || "—"}</div>
            <div className="k">Icon</div>
            <div className="v">{saved.icon || "—"}</div>
          </div>
          <div className="links">
            <a className="pill" href={saved.youtube_channel_url || `https://www.youtube.com/channel/${saved.youtube_channel_id}`} target="_blank" rel="noreferrer">
              Open channel
            </a>
            <Link className="pill" href="/">
              View dashboard
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: "0.35rem" }}>
      <span style={{ fontWeight: 650 }}>{label}</span>
      <span className="muted" style={{ fontSize: "0.9rem" }}>
        {hint}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  border: "0.0625rem solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  padding: "0.75rem 0.9rem",
  borderRadius: "0.75rem",
  outline: "none",
};


