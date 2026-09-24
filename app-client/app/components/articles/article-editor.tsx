"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Oshimark } from "@/app/components/common/oshimark";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { SiteShell } from "@/app/components/layout/site-shell";
import { readMinutes } from "@/app/components/articles/stories";
import { apiFetch } from "@/app/lib/api";
import { normalizeArticleDetail } from "@/app/lib/normalizers";
import type { ArticleDetail } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/articles/articles.module.scss";

const DRAFT_KEY = "nasfaq:article-editor:draft";
type Draft = { title: string; subtitle: string; thumbnailUrl: string; tagText: string; content: string; status: string; selectedAssetIds: number[]; savedAt: string };

function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      title: String(parsed.title ?? ""),
      subtitle: String(parsed.subtitle ?? ""),
      thumbnailUrl: String(parsed.thumbnailUrl ?? ""),
      tagText: String(parsed.tagText ?? ""),
      content: String(parsed.content ?? ""),
      status: parsed.status === "draft" ? "draft" : "published",
      selectedAssetIds: Array.isArray(parsed.selectedAssetIds) ? parsed.selectedAssetIds.filter((value): value is number => Number.isFinite(value)) : [],
      savedAt: String(parsed.savedAt ?? ""),
    };
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft | null) {
  try {
    if (draft) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage blocked: the draft just isn't kept */
  }
}

type View = "write" | "split" | "preview";

export function ArticleEditor({ mode, slug }: { mode: "create" | "edit"; slug?: string }) {
  const router = useRouter();
  const { user, initialized, isLoading: authLoading } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [tagText, setTagText] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("published");
  const [assetIds, setAssetIds] = useState<number[]>([]);
  const [ticker, setTicker] = useState("");
  const [original, setOriginal] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(mode !== "create");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [view, setView] = useState<View>("split");
  const [discard, setDiscard] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(max-width: 1020px)").matches) setView("write");
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !slug) return;
    let cancelled = false;
    apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}`)
      .then((raw) => {
        if (cancelled) return;
        const article = normalizeArticleDetail(raw.article);
        setOriginal(article);
        setTitle(article.title);
        setSubtitle(article.subtitle ?? "");
        setThumbnailUrl(article.thumbnail_url ?? "");
        setTagText(article.tags.join(", "));
        setContent(article.content);
        setStatus(article.status);
        setAssetIds(article.related_assets.map((asset) => asset.id));
      })
      .catch((reason) => !cancelled && setError(String((reason as Error).message || reason)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [mode, slug]);

  useEffect(() => {
    if (mode !== "create") return;
    const draft = readDraft();
    if (draft) {
      setTitle(draft.title);
      setSubtitle(draft.subtitle);
      setThumbnailUrl(draft.thumbnailUrl);
      setTagText(draft.tagText);
      setContent(draft.content);
      setStatus(draft.status);
      setAssetIds(draft.selectedAssetIds);
      setSavedAt(draft.savedAt || null);
    }
    setRestored(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== "create" || !restored) return;
    const id = window.setTimeout(() => {
      const empty = !(title.trim() || subtitle.trim() || thumbnailUrl.trim() || tagText.trim() || content.trim() || assetIds.length);
      if (empty) {
        writeDraft(null);
        setSavedAt(null);
        return;
      }
      const at = new Date().toISOString();
      writeDraft({ title, subtitle, thumbnailUrl, tagText, content, status, selectedAssetIds: assetIds, savedAt: at });
      setSavedAt(at);
    }, 600);
    return () => window.clearTimeout(id);
  }, [assetIds, content, mode, restored, status, subtitle, tagText, thumbnailUrl, title]);

  const selected = useMemo(() => assetIds.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)), [assetIds, assets]);
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const tags = tagText.split(",").map((tag) => tag.trim()).filter(Boolean);

  const addTicker = (value: string) => {
    const next = value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    const asset = assets.find((entry) => entry.symbol === next);
    if (asset) {
      setAssetIds((current) => (current.includes(asset.id) ? current : [...current, asset.id]));
      setTicker("");
    } else setTicker(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { title: title.trim(), subtitle: subtitle.trim() || null, thumbnail_url: thumbnailUrl.trim() || null, tags, content, asset_ids: assetIds, status };
      const raw =
        mode === "edit" && slug
          ? await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}`, { method: "PUT", body: JSON.stringify(payload) })
          : await apiFetch<{ article: Record<string, unknown> }>("/api/articles", { method: "POST", body: JSON.stringify(payload) });
      const article = normalizeArticleDetail(raw.article);
      if (mode === "create") writeDraft(null);
      router.push(`/articles/${encodeURIComponent(article.slug)}`);
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setSaving(false);
    }
  };

  const gate = !initialized || authLoading ? "Checking your session…" : !user ? "signin" : userNeedsEmailVerification(user) ? "verify" : null;
  if (gate) {
    return (
      <SiteShell>
        <div className={styles.page}>
          <Link href="/articles" className={styles.back}>
            ← ARTICLES
          </Link>
          {gate === "signin" ? (
            <p className={styles.empty}>
              <Link href="/login">Sign in</Link> to write an article.
            </p>
          ) : gate === "verify" ? (
            <VerificationRequiredNotice action="write articles" />
          ) : (
            <p className={styles.empty}>{gate}</p>
          )}
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      <form className={styles.page} onSubmit={(event) => void submit(event)}>
        <Link href={mode === "edit" && slug ? `/articles/${encodeURIComponent(slug)}` : "/articles"} className={styles.back}>
          ← {mode === "edit" ? "BACK TO THE ARTICLE" : "ARTICLES"}
        </Link>
        <header className={styles.edHead}>
          <div>
            <h1>{mode === "edit" ? "Edit article" : "Write an article"}</h1>
            <p suppressHydrationWarning>
              {words.toLocaleString("en-US")} words{readMinutes(content) ? ` · ${readMinutes(content)} min read` : ""} · {mode === "create" ? (savedAt ? `draft saved on this device ${new Date(savedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : "drafts save on this device as you type") : `editing “${original?.title ?? ""}”`}
            </p>
          </div>
          <div className={styles.edActs}>
            <span className={styles.seg} role="group" aria-label="Visibility">
              <button type="button" aria-pressed={status === "published"} onClick={() => setStatus("published")}>
                PUBLISHED
              </button>
              <button type="button" aria-pressed={status === "draft"} onClick={() => setStatus("draft")}>
                DRAFT
              </button>
            </span>
            <button type="submit" className={styles.primary} disabled={saving || loading || !title.trim() || !content.trim()}>
              {saving ? "SAVING…" : mode === "edit" ? "SAVE CHANGES" : status === "draft" ? "SAVE DRAFT" : "PUBLISH"}
            </button>
          </div>
        </header>
        {error ? (
          <p className={styles.err} role="alert">
            {error}
          </p>
        ) : null}
        {loading ? <p className={styles.empty}>Loading the article…</p> : null}

        <div className={styles.edGrid}>
          <div className={styles.edMain}>
            <textarea className={styles.edTitle} rows={1} value={title} onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))} placeholder="Headline" maxLength={200} aria-label="Headline" required />
            <input className={styles.edDek} value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="Subtitle (optional)" maxLength={300} aria-label="Subtitle" />
            <div className={styles.bodyHead}>
              <span className={styles.label}>Body · markdown</span>
              <span className={styles.seg} role="group" aria-label="Editor view">
                {(["write", "split", "preview"] as View[]).map((value) => (
                  <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={value === "split" ? styles.hideM : undefined}>
                    {value.toUpperCase()}
                  </button>
                ))}
              </span>
            </div>
            <div className={`${styles.edBody} ${view === "split" ? styles.split : ""}`}>
              {view !== "preview" ? (
                <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder={"## The thesis\n\nWhat happened, why it matters, and what it does to the stock.\n\n> quotes, **bold**, lists and links all work."} aria-label="Body" />
              ) : null}
              {view !== "write" ? (
                <div className={`${styles.prose} ${styles.previewBox}`}>
                  {title.trim() ? <h1 className={styles.previewTitle}>{title}</h1> : null}
                  {content.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown> : <p className={styles.dim}>The preview shows up here.</p>}
                </div>
              ) : null}
            </div>
          </div>

          <aside className={styles.edSide}>
            <section className={styles.railSec}>
              <h2>Talents</h2>
              <p className={styles.dim}>Tag who the article is about. It shows up on their stock pages.</p>
              <label className={styles.ticker}>
                <span className={styles.dim}>$</span>
                <input value={ticker} onChange={(event) => addTicker(event.target.value)} placeholder="ADD TICKER" maxLength={4} spellCheck={false} autoComplete="off" aria-label="Add a talent by ticker" list="ticker-list" />
                <datalist id="ticker-list">
                  {assets.map((asset) => (
                    <option key={asset.symbol} value={asset.symbol}>
                      {asset.display_name}
                    </option>
                  ))}
                </datalist>
              </label>
              <div className={styles.picked}>
                {selected.map((asset) => (
                  <button key={asset.id} type="button" onClick={() => setAssetIds((current) => current.filter((id) => id !== asset.id))} title={`Remove ${asset.display_name}`}>
                    <Oshimark icon={asset.icon} symbol={asset.symbol} size={16} />
                    {asset.symbol} ✕
                  </button>
                ))}
              </div>
            </section>
            <section className={styles.railSec}>
              <h2>Tags</h2>
              <input className={styles.field} value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="analysis, collab, dd" aria-label="Tags, comma separated" />
              {tags.length ? (
                <div className={styles.picked}>
                  {tags.map((tag) => (
                    <span key={tag} className={styles.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
            <section className={styles.railSec}>
              <h2>Thumbnail</h2>
              <input className={styles.field} value={thumbnailUrl} onChange={(event) => setThumbnailUrl(event.target.value)} placeholder="https://…" aria-label="Thumbnail URL" />
              {thumbnailUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnailUrl} alt="" className={styles.thumbPreview} />
              ) : null}
            </section>
            {mode === "create" && savedAt ? (
              <button
                type="button"
                className={discard ? styles.dangerBtn : styles.ghost}
                onClick={() => {
                  if (!discard) {
                    setDiscard(true);
                    window.setTimeout(() => setDiscard(false), 4000);
                    return;
                  }
                  setDiscard(false);
                  writeDraft(null);
                  setTitle("");
                  setSubtitle("");
                  setThumbnailUrl("");
                  setTagText("");
                  setContent("");
                  setAssetIds([]);
                  setStatus("published");
                  setSavedAt(null);
                }}
              >
                {discard ? "CLICK AGAIN TO DISCARD" : "DISCARD DRAFT"}
              </button>
            ) : null}
          </aside>
        </div>
      </form>
    </SiteShell>
  );
}
