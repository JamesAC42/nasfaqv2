"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChannelIconUrl } from "../lib/channelIcons";

type SavedChannel = {
  youtube_channel_id: string;
  name: string;
  name_english?: string | null;
  name_japanese?: string | null;
  symbol: string | null;
  icon: string | null;
  color?: string | null;
  twitter_id?: string | null;
  profile_id?: string | null;
  birthday?: string | null;
  height?: string | null;
  unit?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  youtube_channel_url?: string;
};

type ChannelFormState = {
  youtube_channel_id: string;
  name: string;
  name_english: string;
  name_japanese: string;
  symbol: string;
  icon: string;
  color: string;
  twitter_id: string;
  profile_id: string;
  birthday: string;
  height: string;
  unit: string;
  is_active: boolean;
};

type SaveResult = {
  kind: "created" | "updated";
  channel: SavedChannel;
};

type ActionResult =
  | SaveResult
  | {
      kind: "deleted";
      channel: SavedChannel;
    };

type DetectedChannel = {
  youtube_channel_id: string;
  name_short: string;
  name: string;
  name_english: string | null;
  name_japanese: string | null;
  symbol: string | null;
  icon: string | null;
  color?: string | null;
  twitter_id: string | null;
  profile_id: string | null;
  birthday: string | null;
  height: string | null;
  unit: string | null;
  reference_image_url: string | null;
  is_active: boolean;
  youtube_channel_url?: string;
};

type DetectAddAllResult = {
  inserted: SavedChannel[];
  skipped: Array<{
    youtube_channel_id: string | null;
    name_short: string | null;
    reason: string;
  }>;
};

export default function AddChannelPage() {
  const [form, setForm] = useState<ChannelFormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isManualFormOpen, setIsManualFormOpen] = useState(false);
  const [channels, setChannels] = useState<SavedChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ActionResult | null>(null);
  const [detectedChannels, setDetectedChannels] = useState<DetectedChannel[]>([]);
  const [hasRunDetection, setHasRunDetection] = useState(false);
  const [detectingChannels, setDetectingChannels] = useState(false);
  const [addingDetectedId, setAddingDetectedId] = useState<string | null>(null);
  const [addingAllDetected, setAddingAllDetected] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [detectionSummary, setDetectionSummary] = useState<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconUploadError, setIconUploadError] = useState<string | null>(null);
  const [iconUploadSuccess, setIconUploadSuccess] = useState<string | null>(null);

  const isEditing = Boolean(editingId);
  const trimmedChannelId = form.youtube_channel_id.trim();
  const trimmedName = form.name.trim();
  const iconPreviewUrl = getChannelIconUrl(form.icon);
  const normalizedColor = normalizeHexColorValue(form.color);

  const loadChannels = useCallback(async () => {
    setLoadingChannels(true);
    setChannelsError(null);
    try {
      const res = await fetch("/api/channels?active=false", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(toChannelErrorMessage(data, res.status));
      }
      setChannels(sortChannels((data as SavedChannel[]) || []));
    } catch (err) {
      setChannelsError(String((err as Error)?.message || err));
      setChannels([]);
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const duplicateId = useMemo(() => {
    if (isEditing || !trimmedChannelId) return null;
    return channels.find((channel) => channel.youtube_channel_id === trimmedChannelId) || null;
  }, [channels, isEditing, trimmedChannelId]);

  const duplicateName = useMemo(() => {
    if (!trimmedName) return null;
    const normalizedName = normalizeName(trimmedName);
    return (
      channels.find(
        (channel) =>
          normalizeName(channel.name) === normalizedName && (!editingId || channel.youtube_channel_id !== editingId)
      ) || null
    );
  }, [channels, editingId, trimmedName]);

  const canSubmit = useMemo(() => {
    const hasRequiredFields = trimmedName.length > 0 && (isEditing || trimmedChannelId.length > 0);
    return hasRequiredFields && !saving && !duplicateId && !duplicateName;
  }, [duplicateId, duplicateName, isEditing, saving, trimmedChannelId, trimmedName]);

  async function onDetectChannels() {
    setDetectingChannels(true);
    setDetectionError(null);
    setDetectionSummary(null);
    setSaved(null);

    try {
      const res = await fetch("/api/channels/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(toChannelErrorMessage(data, res.status));
      }

      const nextDetected = sortDetectedChannels((((data as { channels?: DetectedChannel[] }) || {}).channels || []).map(normalizeDetectedChannel));
      setDetectedChannels(nextDetected);
      setHasRunDetection(true);
      setDetectionSummary(
        nextDetected.length === 0
          ? "No new channels detected."
          : `Detected ${nextDetected.length} new channel${nextDetected.length === 1 ? "" : "s"}.`
      );
    } catch (err) {
      setHasRunDetection(true);
      setDetectionError(String((err as Error)?.message || err));
      setDetectedChannels([]);
    } finally {
      setDetectingChannels(false);
    }
  }

  async function onAddDetectedChannel(channel: DetectedChannel) {
    setAddingDetectedId(channel.youtube_channel_id);
    setDetectionError(null);
    setSaved(null);
    setError(null);

    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toDetectedPayload(channel)),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(toChannelErrorMessage(data, res.status));
      }

      const savedChannel = data as SavedChannel;
      setChannels((prev) => upsertChannelInList(prev, savedChannel));
      setDetectedChannels((prev) => prev.filter((item) => item.youtube_channel_id !== channel.youtube_channel_id));
      setSaved({ kind: "created", channel: savedChannel });
    } catch (err) {
      setDetectionError(String((err as Error)?.message || err));
    } finally {
      setAddingDetectedId(null);
    }
  }

  async function onAddAllDetectedChannels() {
    if (detectedChannels.length === 0) return;

    setAddingAllDetected(true);
    setDetectionError(null);
    setSaved(null);
    setError(null);

    try {
      const res = await fetch("/api/channels/detect/add-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: detectedChannels.map(toDetectedPayload),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(toChannelErrorMessage(data, res.status));
      }

      const result = data as DetectAddAllResult;
      setChannels((prev) => {
        let next = prev;
        for (const channel of result.inserted || []) {
          next = upsertChannelInList(next, channel);
        }
        return next;
      });

      const processedIds = new Set<string>([
        ...((result.inserted || []).map((channel) => channel.youtube_channel_id)),
        ...((result.skipped || []).map((channel) => channel.youtube_channel_id).filter((value): value is string => Boolean(value))),
      ]);
      setDetectedChannels((prev) => prev.filter((channel) => !processedIds.has(channel.youtube_channel_id)));
      setDetectionSummary(
        `Added ${(result.inserted || []).length} channel${(result.inserted || []).length === 1 ? "" : "s"}.${
          (result.skipped || []).length > 0 ? ` Skipped ${(result.skipped || []).length}.` : ""
        }`
      );
    } catch (err) {
      setDetectionError(String((err as Error)?.message || err));
    } finally {
      setAddingAllDetected(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const payload = {
        name: trimmedName,
        name_english: form.name_english.trim() ? form.name_english.trim() : null,
        name_japanese: form.name_japanese.trim() ? form.name_japanese.trim() : null,
        symbol: form.symbol.trim() ? form.symbol.trim() : null,
        icon: form.icon.trim() ? form.icon.trim() : null,
        color: normalizedColor,
        twitter_id: form.twitter_id.trim() ? form.twitter_id.trim() : null,
        profile_id: form.profile_id.trim() ? form.profile_id.trim() : null,
        birthday: form.birthday.trim() ? form.birthday.trim() : null,
        height: form.height.trim() ? form.height.trim() : null,
        unit: form.unit.trim() ? form.unit.trim() : null,
        is_active: form.is_active,
        ...(isEditing ? {} : { youtube_channel_id: trimmedChannelId }),
      };

      const res = await fetch(isEditing ? `/api/channels/${encodeURIComponent(editingId || "")}` : "/api/channels", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(toChannelErrorMessage(data, res.status));
      }
      const savedChannel = data as SavedChannel;
      setChannels((prev) => upsertChannelInList(prev, savedChannel));
      setSaved({ kind: isEditing ? "updated" : "created", channel: savedChannel });
      setEditingId(null);
      setForm(emptyForm);
      setIsManualFormOpen(false);
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setSaving(false);
    }
  }

  async function onIconFileChange(file: File | null) {
    setIconUploadError(null);
    setIconUploadSuccess(null);
    setSaved(null);

    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".svg") || (file.type && file.type !== "image/svg+xml")) {
      setIconUploadError("Only SVG files are allowed.");
      return;
    }

    setUploadingIcon(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

      const res = await fetch("/api/channels/icon-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "image/svg+xml",
          data: btoa(binary),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(toChannelErrorMessage(data, res.status));
      }

      const result = data as { icon: string; url: string };
      setForm((prev) => ({ ...prev, icon: result.icon }));
      setIconUploadSuccess(`Uploaded successfully to ${result.url}`);
    } catch (err) {
      setIconUploadError(String((err as Error)?.message || err));
    } finally {
      setUploadingIcon(false);
    }
  }

  function onEdit(channel: SavedChannel) {
    setEditingId(channel.youtube_channel_id);
    setIsManualFormOpen(true);
    setForm(toFormState(channel));
    setError(null);
    setSaved(null);
    setIconUploadError(null);
    setIconUploadSuccess(null);
  }

  function onCancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setIsManualFormOpen(false);
    setError(null);
    setSaved(null);
    setIconUploadError(null);
    setIconUploadSuccess(null);
  }

  async function onDelete(channel: SavedChannel) {
    const confirmed = window.confirm(
      `Delete ${channel.name} (${channel.youtube_channel_id})?\n\nThis also removes all associated rows from youtube_channel_daily_stats.`
    );
    if (!confirmed) return;

    setDeletingId(channel.youtube_channel_id);
    setError(null);
    setSaved(null);

    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channel.youtube_channel_id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(toChannelErrorMessage(data, res.status));
      }

      setChannels((prev) => removeChannelFromList(prev, channel.youtube_channel_id));
      if (editingId === channel.youtube_channel_id) {
        setEditingId(null);
        setForm(emptyForm);
        setIsManualFormOpen(false);
      }
      setSaved({ kind: "deleted", channel: data as SavedChannel });
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="title">Manage YouTube Channels</h1>
          <p className="subtitle">
            Add new channels, prevent duplicates, and edit existing entries from one screen.
          </p>
        </div>
        <Link className="pill" href="/">
          Back to dashboard
        </Link>
      </div>

      <div className="card" style={isEditing ? editingPanelStyle : undefined}>
        <div style={sectionHeaderStyle}>
          <div>
            <p className="name" style={{ marginBottom: "0.25rem" }}>
              {isEditing ? `Edit channel ${form.name || "..."}` : "Add channel manually"}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
              {isEditing
                ? "Channel IDs stay fixed during edits. Update metadata below and save when finished."
                : "Expand to manually add a channel with all supported metadata fields."}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {!isEditing ? (
              <button className="btn" type="button" onClick={() => setIsManualFormOpen((prev) => !prev)}>
                {isManualFormOpen ? "Collapse" : "Expand"}
              </button>
            ) : null}
            {isEditing ? (
              <button className="btn" type="button" onClick={onCancelEdit}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </div>

        {isEditing || isManualFormOpen ? (
        <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.9rem" }}>
          <Field label="YouTube channel ID" hint="Example: UC_x5XG1OV2P6uZZ5FSM9Ttw">
            <input
              value={form.youtube_channel_id}
              onChange={(e) => setForm((prev) => ({ ...prev, youtube_channel_id: e.target.value }))}
              placeholder="UC..."
              style={inputStyle}
              disabled={isEditing}
            />
          </Field>
          {duplicateId ? (
            <p style={warningTextStyle}>This YouTube channel ID is already saved as {duplicateId.name}.</p>
          ) : null}

          <Field label="Name" hint="Display name used in the dashboard">
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Channel name"
              style={inputStyle}
            />
          </Field>
          {duplicateName ? (
            <p style={warningTextStyle}>
              This name is already used by channel ID {duplicateName.youtube_channel_id}.
            </p>
          ) : null}

          <Field label="English name (optional)" hint="Alternate Romanized or English display name">
            <input
              value={form.name_english}
              onChange={(e) => setForm((prev) => ({ ...prev, name_english: e.target.value }))}
              placeholder="English name"
              style={inputStyle}
            />
          </Field>

          <Field label="Japanese name (optional)" hint="Native Japanese display name">
            <input
              value={form.name_japanese}
              onChange={(e) => setForm((prev) => ({ ...prev, name_japanese: e.target.value }))}
              placeholder="Japanese name"
              style={inputStyle}
            />
          </Field>

          <Field label="Symbol (optional)" hint="Ticker / short label">
            <input
              value={form.symbol}
              onChange={(e) => setForm((prev) => ({ ...prev, symbol: e.target.value }))}
              placeholder="e.g. Holo"
              style={inputStyle}
            />
          </Field>

          <Field label="Icon (optional)" hint="Stored as the icon name. Preview uses https://images.nasfaq.biz/icons/{icon}.svg">
            <input
              value={form.icon}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, icon: e.target.value }));
                setIconUploadError(null);
                setIconUploadSuccess(null);
              }}
              placeholder="ame"
              style={inputStyle}
            />
          </Field>

          <Field label="Color (optional)" hint="Hex color saved on the channel, with a picker for quick selection">
            <ColorField
              value={form.color}
              onCommit={(color) => setForm((prev) => ({ ...prev, color }))}
            />
          </Field>

          <Field label="Upload icon (SVG only)" hint="Uploads to S3 `/icons`, then auto-fills the icon field from the uploaded filename">
            <input
              type="file"
              accept=".svg,image/svg+xml"
              onChange={(e) => void onIconFileChange(e.target.files?.[0] || null)}
              disabled={uploadingIcon}
              style={inputStyle}
            />
          </Field>

          <div style={iconPreviewPanelStyle}>
            <div style={iconPreviewHeaderStyle}>
              <span style={{ fontWeight: 650 }}>Icon preview</span>
              {uploadingIcon ? <span className="muted">Uploading…</span> : null}
            </div>
            {iconPreviewUrl ? (
              <div style={iconPreviewContentStyle}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={iconPreviewUrl} alt="" style={iconPreviewImageStyle} loading="lazy" />
                <div style={{ minWidth: 0 }}>
                  <div className="muted" style={{ wordBreak: "break-all" }}>
                    {iconPreviewUrl}
                  </div>
                </div>
              </div>
            ) : (
              <div className="muted">Set the icon field to preview `images.nasfaq.biz/icons/&lt;icon&gt;.svg`.</div>
            )}
            {iconUploadError ? <div style={{ ...warningTextStyle, margin: 0 }}>{iconUploadError}</div> : null}
            {iconUploadSuccess ? <div style={successTextStyle}>{iconUploadSuccess}</div> : null}
          </div>

          <Field label="Twitter ID (optional)" hint="Account handle without the leading @">
            <input
              value={form.twitter_id}
              onChange={(e) => setForm((prev) => ({ ...prev, twitter_id: e.target.value }))}
              placeholder="username"
              style={inputStyle}
            />
          </Field>

          <Field label="Profile ID (optional)" hint="Internal or external profile identifier">
            <input
              value={form.profile_id}
              onChange={(e) => setForm((prev) => ({ ...prev, profile_id: e.target.value }))}
              placeholder="Profile ID"
              style={inputStyle}
            />
          </Field>

          <Field label="Birthday (optional)" hint="Use YYYY-MM-DD">
            <input
              type="date"
              value={form.birthday}
              onChange={(e) => setForm((prev) => ({ ...prev, birthday: e.target.value }))}
              style={inputStyle}
            />
          </Field>

          <Field label="Height (optional)" hint="Store the raw display value">
            <input
              value={form.height}
              onChange={(e) => setForm((prev) => ({ ...prev, height: e.target.value }))}
              placeholder="e.g. 155cm"
              style={inputStyle}
            />
          </Field>

          <Field label="Unit (optional)" hint="Group, branch, or unit name">
            <input
              value={form.unit}
              onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
              placeholder="Unit"
              style={inputStyle}
            />
          </Field>

          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
            />
            <span>Channel is active</span>
          </label>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button className="btn" type="submit" disabled={!canSubmit}>
              {saving ? (isEditing ? "Updating…" : "Saving…") : isEditing ? "Update channel" : "Save channel"}
            </button>
            {!isEditing ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setForm(emptyForm);
                  setIsManualFormOpen(false);
                }}
                disabled={saving && !canSubmit}
              >
                Clear
              </button>
            ) : null}
          </div>
        </form>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            The manual add form is collapsed by default. Expand it when you need to create a channel directly.
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <div style={sectionHeaderStyle}>
          <div>
            <p className="name" style={{ marginBottom: "0.25rem" }}>
              Detect New Channels
            </p>
            <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
              Scrape Hololive talent pages and show channels that are not yet in the database.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => void onDetectChannels()} disabled={detectingChannels || addingAllDetected}>
              {detectingChannels ? "Detecting…" : "Detect New Channels"}
            </button>
            {detectedChannels.length > 0 ? (
              <button className="btn" type="button" onClick={() => void onAddAllDetectedChannels()} disabled={detectingChannels || addingAllDetected || Boolean(addingDetectedId)}>
                {addingAllDetected ? "Adding all…" : "Add all"}
              </button>
            ) : null}
          </div>
        </div>

        {detectionError ? (
          <p className="muted" style={{ color: "var(--bad)", marginTop: 0 }}>
            {detectionError}
          </p>
        ) : detectionSummary ? (
          <p className="muted" style={{ marginTop: 0 }}>
            {detectionSummary}
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            This does not write to the database until you choose `Add` or `Add all`.
          </p>
        )}

        {detectingChannels ? (
          <p className="muted" style={{ marginTop: "1rem" }}>
            Scraping talent pages…
          </p>
        ) : detectedChannels.length > 0 ? (
          <div className="grid">
            {detectedChannels.map((channel) => {
              const isAdding = addingDetectedId === channel.youtube_channel_id;
              return (
                <div
                  key={channel.youtube_channel_id}
                  className="card"
                  style={{
                    padding: "1rem",
                    display: "grid",
                    gap: "0.75rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: "1 1 14rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      <div style={channelHeaderIconWrapStyle}>
                        {getChannelIconUrl(channel.icon) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={getChannelIconUrl(channel.icon)!}
                            alt=""
                            style={channelHeaderIconStyle}
                            loading="lazy"
                          />
                        ) : (
                          <div style={channelHeaderIconFallbackStyle} />
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p className="name" style={{ marginBottom: "0.15rem" }}>
                          {channel.name}
                        </p>
                        <div className="meta" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                          <span>YT: {channel.youtube_channel_id}</span>
                          <span>Unit: {channel.unit || "—"}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ ...activeBadgeStyle, flexShrink: 0, alignSelf: "flex-start" }}>Detected</div>
                  </div>

                  {channel.reference_image_url ? (
                    <a
                      href={channel.reference_image_url}
                      target="_blank"
                      rel="noreferrer"
                      style={detectedReferenceImageLinkStyle}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={channel.reference_image_url}
                        alt={`${channel.name} reference`}
                        style={detectedReferenceImageStyle}
                        loading="lazy"
                      />
                    </a>
                  ) : null}

                  <div style={detailListStyle}>
                    <Detail label="EN" value={channel.name_english} />
                    <Detail label="JP" value={channel.name_japanese} />
                    <Detail label="Twitter" value={channel.twitter_id} />
                    <Detail label="Profile" value={channel.profile_id} />
                    <Detail label="Birthday" value={channel.birthday} />
                    <Detail label="Height" value={channel.height} />
                  </div>

                  <div className="links" style={{ marginTop: 0 }}>
                    <button className="btn" type="button" onClick={() => void onAddDetectedChannel(channel)} disabled={isAdding || addingAllDetected}>
                      {isAdding ? "Adding…" : "Add"}
                    </button>
                    <a
                      className="pill"
                      href={channel.youtube_channel_url || `https://www.youtube.com/channel/${channel.youtube_channel_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open channel
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        ) : hasRunDetection ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            No channels are currently waiting to be added.
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="name">Error</p>
          <p className="muted">{error}</p>
        </div>
      ) : null}

      {saved ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="name">
            {saved.kind === "created"
              ? "Channel added"
              : saved.kind === "updated"
                ? "Channel updated"
                : "Channel deleted"}
          </p>
          <div className="kv" style={{ marginTop: "0.5rem" }}>
            <div className="k">ID</div>
            <div className="v">{saved.channel.youtube_channel_id}</div>
            <div className="k">Name</div>
            <div className="v">{saved.channel.name}</div>
            <div className="k">English name</div>
            <div className="v">{saved.channel.name_english || "—"}</div>
            <div className="k">Japanese name</div>
            <div className="v">{saved.channel.name_japanese || "—"}</div>
            <div className="k">Symbol</div>
            <div className="v">{saved.channel.symbol || "—"}</div>
            <div className="k">Icon</div>
            <div className="v">{saved.channel.icon || "—"}</div>
            <div className="k">Color</div>
            <div className="v">
              <ColorValue color={saved.channel.color} />
            </div>
            <div className="k">Twitter</div>
            <div className="v">{saved.channel.twitter_id || "—"}</div>
            <div className="k">Profile ID</div>
            <div className="v">{saved.channel.profile_id || "—"}</div>
            <div className="k">Birthday</div>
            <div className="v">{saved.channel.birthday || "—"}</div>
            <div className="k">Height</div>
            <div className="v">{saved.channel.height || "—"}</div>
            <div className="k">Unit</div>
            <div className="v">{saved.channel.unit || "—"}</div>
            <div className="k">Status</div>
            <div className="v">{saved.channel.is_active ? "Active" : "Inactive"}</div>
          </div>
          {saved.kind === "deleted" ? (
            <div className="links">
              <Link className="pill" href="/">
                View dashboard
              </Link>
            </div>
          ) : (
            <div className="links">
              <a
                className="pill"
                href={saved.channel.youtube_channel_url || `https://www.youtube.com/channel/${saved.channel.youtube_channel_id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open channel
              </a>
              <Link className="pill" href="/">
                View dashboard
              </Link>
            </div>
          )}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: "1rem" }}>
        <div style={sectionHeaderStyle}>
          <div>
            <p className="name" style={{ marginBottom: "0.25rem" }}>
              Current channels
            </p>
            <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
              {channels.length} total channel{channels.length === 1 ? "" : "s"}
            </p>
          </div>
          <button className="btn" type="button" onClick={() => void loadChannels()} disabled={loadingChannels}>
            {loadingChannels ? "Refreshing…" : "Refresh list"}
          </button>
        </div>

        {channelsError ? (
          <p className="muted">{channelsError}</p>
        ) : loadingChannels ? (
          <p className="muted">Loading channels…</p>
        ) : channels.length === 0 ? (
          <p className="muted">No channels have been added yet.</p>
        ) : (
          <div className="grid">
            {channels.map((channel) => {
              const isCurrentEdit = editingId === channel.youtube_channel_id;
              const isDeleting = deletingId === channel.youtube_channel_id;
              return (
                <div
                  key={channel.youtube_channel_id}
                  className="card"
                  style={{
                    padding: "1rem",
                    borderColor: isCurrentEdit ? "rgba(55, 214, 122, 0.6)" : undefined,
                    boxShadow: isCurrentEdit ? "0 0 0 0.125rem rgba(55, 214, 122, 0.16), 0 0 1.75rem rgba(55, 214, 122, 0.1)" : undefined,
                    display: "grid",
                    gap: "0.75rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0, display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      <div style={channelHeaderIconWrapStyle}>
                        {getChannelIconUrl(channel.icon) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={getChannelIconUrl(channel.icon)!}
                            alt=""
                            style={channelHeaderIconStyle}
                            loading="lazy"
                          />
                        ) : (
                          <div style={channelHeaderIconFallbackStyle} />
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p className="name" style={{ marginBottom: "0.15rem" }}>
                          {channel.name}
                          {formatTicker(channel.symbol) ? ` · ${formatTicker(channel.symbol)}` : ""}
                        </p>
                        <div className="meta" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                          <span>YT: {channel.youtube_channel_id}</span>
                          <span>Gen: {channel.unit || "—"}</span>
                        </div>
                      </div>
                    </div>
                    <div style={channel.is_active ? activeBadgeStyle : inactiveBadgeStyle}>
                      {channel.is_active ? "Active" : "Inactive"}
                    </div>
                  </div>

                  <div style={detailListStyle}>
                    <Detail label="EN" value={channel.name_english} />
                    <Detail label="JP" value={channel.name_japanese} />
                    <Detail label="Color" value={channel.color} swatchColor={channel.color} />
                    <Detail label="Twitter" value={channel.twitter_id} />
                    <Detail label="Profile" value={channel.profile_id} />
                    <Detail label="Birthday" value={channel.birthday} />
                    <Detail label="Height" value={channel.height} />
                  </div>

                  <div className="kv">
                    <div className="k">Created</div>
                    <div className="v">{fmtDate(channel.created_at)}</div>
                    <div className="k">Updated</div>
                    <div className="v">{fmtDate(channel.updated_at)}</div>
                  </div>

                  <div className="links" style={{ marginTop: 0 }}>
                    <button className="btn" type="button" onClick={() => onEdit(channel)} disabled={isDeleting}>
                      {isCurrentEdit ? "Editing" : "Edit"}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void onDelete(channel)}
                      disabled={Boolean(deletingId)}
                      style={deleteButtonStyle}
                    >
                      {isDeleting ? "Deleting…" : "Delete"}
                    </button>
                    <a
                      className="pill"
                      href={channel.youtube_channel_url || `https://www.youtube.com/channel/${channel.youtube_channel_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open channel
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <div style={{ fontWeight: 650 }}>{label}</div>
      <div className="muted" style={{ fontSize: "0.9rem" }}>
        {hint}
      </div>
      {children}
    </div>
  );
}

function Detail({ label, value, swatchColor }: { label: string; value?: string | null; swatchColor?: string | null }) {
  return (
    <div style={detailRowStyle}>
      <span className="muted" style={detailLabelStyle}>
        {label}
      </span>
      <span style={detailValueStyle}>{swatchColor ? <ColorValue color={swatchColor} /> : value || "—"}</span>
    </div>
  );
}

function ColorField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLInputElement | null>(null);
  const normalizedValue = normalizeHexColorValue(value);

  useEffect(() => {
    const picker = pickerRef.current;
    const text = textRef.current;
    if (picker) {
      picker.value = normalizedValue || defaultColorPickerValue;
    }
    if (text && text.value !== value) {
      text.value = value;
    }
  }, [normalizedValue, value]);

  function commit(nextValue: string) {
    onCommit(nextValue.trim());
  }

  return (
    <div style={colorFieldRowStyle}>
      <input
        ref={pickerRef}
        type="color"
        defaultValue={normalizedValue || defaultColorPickerValue}
        onInput={(e) => {
          if (textRef.current) {
            textRef.current.value = e.currentTarget.value;
          }
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyUp={(e) => {
          if (e.key === "Enter") {
            commit(e.currentTarget.value);
          }
        }}
        onPointerUp={(e) => commit(e.currentTarget.value)}
        style={colorPickerStyle}
      />
      <input
        ref={textRef}
        defaultValue={value}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
          }
        }}
        placeholder="#ffffff"
        style={{ ...inputStyle, flex: "1 1 10rem" }}
      />
      <button
        className="btn"
        type="button"
        onClick={() => {
          if (pickerRef.current) {
            pickerRef.current.value = defaultColorPickerValue;
          }
          if (textRef.current) {
            textRef.current.value = "";
          }
          onCommit("");
        }}
      >
        Clear
      </button>
    </div>
  );
}

function ColorValue({ color }: { color?: string | null }) {
  if (!color) return <>—</>;
  return (
    <span style={colorValueStyle}>
      <span style={{ ...colorSwatchStyle, background: color }} />
      <span>{color}</span>
    </span>
  );
}

function toFormState(channel: SavedChannel): ChannelFormState {
  return {
    youtube_channel_id: channel.youtube_channel_id,
    name: channel.name,
    name_english: channel.name_english || "",
    name_japanese: channel.name_japanese || "",
    symbol: channel.symbol || "",
    icon: channel.icon || "",
    color: channel.color || "",
    twitter_id: channel.twitter_id || "",
    profile_id: channel.profile_id || "",
    birthday: normalizeDateInputValue(channel.birthday),
    height: channel.height || "",
    unit: channel.unit || "",
    is_active: channel.is_active,
  };
}

function normalizeDateInputValue(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

function formatTicker(value?: string | null) {
  return value ? value.trim().toUpperCase() : "";
}

function normalizeDetectedChannel(channel: DetectedChannel): DetectedChannel {
  return {
    ...channel,
    name: channel.name || channel.name_short,
    name_english: channel.name_english || null,
    name_japanese: channel.name_japanese || null,
    symbol: channel.symbol || null,
    icon: channel.icon || null,
    color: channel.color || null,
    twitter_id: channel.twitter_id || null,
    profile_id: channel.profile_id || null,
    birthday: channel.birthday || null,
    height: channel.height || null,
    unit: channel.unit || null,
    reference_image_url: channel.reference_image_url || null,
  };
}

function toDetectedPayload(channel: DetectedChannel) {
  return {
    youtube_channel_id: channel.youtube_channel_id,
    name_short: channel.name_short,
    name_english: channel.name_english,
    name_japanese: channel.name_japanese,
    symbol: channel.symbol,
    icon: channel.icon,
    color: channel.color || null,
    twitter_id: channel.twitter_id,
    profile_id: channel.profile_id,
    birthday: channel.birthday,
    height: channel.height,
    unit: channel.unit,
    reference_image_url: channel.reference_image_url,
    is_active: false,
  };
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function normalizeHexColorValue(value?: string | null) {
  const trimmed = (value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function sortChannels(channels: SavedChannel[]) {
  return [...channels].sort((a, b) => {
    if (a.is_active !== b.is_active) {
      return a.is_active ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.youtube_channel_id.localeCompare(b.youtube_channel_id);
  });
}

function sortDetectedChannels(channels: DetectedChannel[]) {
  return [...channels].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.youtube_channel_id.localeCompare(b.youtube_channel_id)
  );
}

function upsertChannelInList(channels: SavedChannel[], nextChannel: SavedChannel) {
  const byId = new Map(channels.map((channel) => [channel.youtube_channel_id, channel]));
  byId.set(nextChannel.youtube_channel_id, nextChannel);
  return sortChannels(Array.from(byId.values()));
}

function removeChannelFromList(channels: SavedChannel[], channelId: string) {
  return channels.filter((channel) => channel.youtube_channel_id !== channelId);
}

function fmtDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function toChannelErrorMessage(data: unknown, status: number) {
  const error = data && typeof data === "object" && "error" in data ? data.error : null;
  const channelId = data && typeof data === "object" && "channel_id" in data ? data.channel_id : null;
  const detail = data && typeof data === "object" && "detail" in data ? data.detail : null;

  switch (error) {
    case "duplicate_youtube_channel_id":
      return "A channel with this YouTube channel ID already exists.";
    case "duplicate_name":
      return channelId
        ? `A channel with this name already exists on channel ID ${String(channelId)}.`
        : "A channel with this name already exists.";
    case "youtube_channel_id_immutable":
      return "You cannot change the YouTube channel ID when editing an existing channel.";
    case "youtube_channel_id_required":
      return "YouTube channel ID is required.";
    case "name_required":
      return "Channel name is required.";
    case "birthday_invalid":
      return "Birthday must use YYYY-MM-DD.";
    case "color_invalid":
      return "Color must use a full hex code like #3fa9f5.";
    case "detect_failed":
      return "Detecting new channels failed.";
    case "channels_required":
      return "No detected channels were provided.";
    case "icon_upload_fields_required":
      return "Filename and SVG image data are required.";
    case "icon_upload_not_configured":
      return "AWS S3 upload is not configured on the API server.";
    case "icon_upload_invalid_type":
      return "Only SVG files are allowed.";
    case "icon_upload_invalid_svg":
      return "The uploaded file is not a valid SVG.";
    case "icon_upload_failed":
      return detail ? `Uploading the icon to S3 failed: ${String(detail)}` : "Uploading the icon to S3 failed.";
    case "reference_image_upload_not_configured":
      return "AWS S3 upload is not configured on the API server for reference images.";
    case "reference_image_download_failed":
      return detail ? `Downloading or uploading the reference image failed: ${String(detail)}` : "Downloading or uploading the reference image failed.";
    case "reference_image_processing_not_configured":
      return "Reference image processing is not configured on the API server.";
    case "reference_image_processing_failed":
      return detail ? `Processing the reference image failed: ${String(detail)}` : "Processing the reference image failed.";
    case "reference_image_upload_failed":
      return detail ? `Uploading the reference image to S3 failed: ${String(detail)}` : "Uploading the reference image to S3 failed.";
    case "not_found":
      return "That channel could not be found.";
    default:
      return typeof error === "string" && error ? error : `HTTP ${status}`;
  }
}

const emptyForm: ChannelFormState = {
  youtube_channel_id: "",
  name: "",
  name_english: "",
  name_japanese: "",
  symbol: "",
  icon: "",
  color: "",
  twitter_id: "",
  profile_id: "",
  birthday: "",
  height: "",
  unit: "",
  is_active: false,
};

const inputStyle: React.CSSProperties = {
  border: "0.0625rem solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  padding: "0.75rem 0.9rem",
  borderRadius: "0.75rem",
  outline: "none",
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "1rem",
  marginBottom: "1rem",
};

const checkboxRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.55rem",
  fontWeight: 600,
};

const warningTextStyle: React.CSSProperties = {
  margin: "-0.35rem 0 0 0",
  color: "var(--bad)",
  fontSize: "0.9rem",
};

const successTextStyle: React.CSSProperties = {
  color: "var(--good)",
  fontSize: "0.9rem",
};

const iconPreviewPanelStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.75rem",
  padding: "0.9rem",
  border: "0.0625rem solid var(--border)",
  borderRadius: "0.9rem",
  background: "rgba(255, 255, 255, 0.02)",
};

const colorFieldRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  flexWrap: "wrap",
};

const colorPickerStyle: React.CSSProperties = {
  ...inputStyle,
  width: "3.5rem",
  minWidth: "3.5rem",
  height: "3rem",
  padding: "0.25rem",
};

const iconPreviewHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "0.75rem",
};

const iconPreviewContentStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
};

const iconPreviewImageStyle: React.CSSProperties = {
  width: "3.5rem",
  height: "3.5rem",
  borderRadius: "0.9rem",
  objectFit: "contain",
  background: "rgba(255, 255, 255, 0.04)",
  padding: "0.45rem",
  flexShrink: 0,
};

const badgeStyle: React.CSSProperties = {
  borderRadius: "999rem",
  padding: "0.25rem 0.6rem",
  fontSize: "0.8rem",
  fontWeight: 650,
  whiteSpace: "nowrap",
};

const activeBadgeStyle: React.CSSProperties = {
  ...badgeStyle,
  background: "rgba(55, 214, 122, 0.16)",
  color: "var(--good)",
  border: "0.0625rem solid rgba(55, 214, 122, 0.28)",
};

const inactiveBadgeStyle: React.CSSProperties = {
  ...badgeStyle,
  background: "rgba(255, 92, 122, 0.12)",
  color: "var(--bad)",
  border: "0.0625rem solid rgba(255, 92, 122, 0.22)",
};

const deleteButtonStyle: React.CSSProperties = {
  borderColor: "rgba(255, 92, 122, 0.28)",
  color: "var(--bad)",
};

const channelHeaderIconWrapStyle: React.CSSProperties = {
  width: "1.75rem",
  height: "1.75rem",
  borderRadius: "0.45rem",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(255, 255, 255, 0.03)",
  border: "0.0625rem solid rgba(255, 255, 255, 0.08)",
};

const channelHeaderIconStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
};

const channelHeaderIconFallbackStyle: React.CSSProperties = {
  width: "0.9rem",
  height: "0.9rem",
  borderRadius: "0.3rem",
  background: "rgba(255, 255, 255, 0.16)",
};

const detectedReferenceImageLinkStyle: React.CSSProperties = {
  display: "block",
};

const detectedReferenceImageStyle: React.CSSProperties = {
  width: "100%",
  maxHeight: "20rem",
  objectFit: "contain",
  borderRadius: "1rem",
  background: "rgba(255, 255, 255, 0.03)",
  border: "0.0625rem solid rgba(255, 255, 255, 0.08)",
};

const detailListStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
  gap: "0.35rem 1rem",
};

const detailRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "4.5rem minmax(0, 1fr)",
  alignItems: "start",
  gap: "0.5rem",
  minWidth: 0,
};

const detailLabelStyle: React.CSSProperties = {
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  lineHeight: 1.4,
};

const detailValueStyle: React.CSSProperties = {
  fontSize: "0.86rem",
  lineHeight: 1.4,
  overflowWrap: "anywhere",
};

const colorValueStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
};

const colorSwatchStyle: React.CSSProperties = {
  width: "0.9rem",
  height: "0.9rem",
  borderRadius: "999rem",
  border: "0.0625rem solid rgba(255, 255, 255, 0.18)",
  flexShrink: 0,
};

const editingPanelStyle: React.CSSProperties = {
  borderColor: "rgba(55, 214, 122, 0.6)",
  boxShadow: "0 0 0 0.125rem rgba(55, 214, 122, 0.18), 0 0 2.5rem rgba(55, 214, 122, 0.12)",
};

const defaultColorPickerValue = "#ffffff";


