"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { apiFetch } from "@/app/lib/api";
import { normalizeArticleDetail } from "@/app/lib/normalizers";
import { timeAgo } from "@/app/lib/time";
import type { ArticleDetail, ArticleProposal } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/articles/articles.module.scss";

const enc = encodeURIComponent;

/** Side drawer where players draft the long version of a HoloNews headline and vote on each other's drafts. */
export function DraftRoom({ article, initialTab, onClose, onChange }: { article: ArticleDetail; initialTab: "proposals" | "write"; onClose: () => void; onChange: (next: ArticleDetail) => void }) {
  const { user } = useAuth();
  const verify = userNeedsEmailVerification(user);
  const hasBody = Boolean(article.content?.trim());
  const [tab, setTab] = useState<"proposals" | "write">(hasBody ? "proposals" : initialTab);
  const [selected, setSelected] = useState<number | null>(article.proposals.find((proposal) => proposal.status === "approved")?.id ?? article.proposals[0]?.id ?? null);
  const [voting, setVoting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [tags, setTags] = useState("");
  const [thumb, setThumb] = useState("");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const proposal = article.proposals.find((entry) => entry.id === selected) ?? null;

  const vote = async (entry: ArticleProposal, value: 1 | -1) => {
    if (!user || verify) return;
    setVoting(entry.id);
    try {
      const raw = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${enc(article.slug)}/proposals/${entry.id}/vote`, {
        method: "POST",
        body: JSON.stringify({ value: entry.viewer_vote === value ? 0 : value }),
      });
      onChange(normalizeArticleDetail(raw.article));
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setVoting(null);
    }
  };

  const approve = async (id: number) => {
    try {
      const raw = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${enc(article.slug)}/proposals/${id}/approve`, { method: "POST", body: "{}" });
      onChange(normalizeArticleDetail(raw.article));
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${enc(article.slug)}/proposals`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim() || null,
          subtitle: subtitle.trim() || null,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          thumbnail_url: thumb.trim() || null,
          content,
        }),
      });
      const next = normalizeArticleDetail(raw.article);
      onChange(next);
      const newest = [...next.proposals].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      setSelected(newest?.id ?? null);
      setTitle("");
      setSubtitle("");
      setTags("");
      setThumb("");
      setContent("");
      setTab("proposals");
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={styles.room} role="dialog" aria-modal="true" aria-labelledby="room-title">
        <header className={styles.roomHead}>
          <div>
            <span className={styles.kOpen}>{hasBody ? "DRAFT HISTORY" : "DRAFT ROOM"}</span>
            <h2 id="room-title">{hasBody ? "Drafts for this story" : "Write the long version"}</h2>
            <p>{hasBody ? "An approved version is live. Earlier drafts stay here for the record." : "Drafts stay in review until an editor approves one as the official article. Vote for the one you'd want to read."}</p>
          </div>
          <button type="button" className={styles.x} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className={styles.roomTabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === "proposals"} onClick={() => setTab("proposals")}>
            DRAFTS {article.proposals.length}
          </button>
          {!hasBody ? (
            <button type="button" role="tab" aria-selected={tab === "write"} onClick={() => setTab("write")}>
              WRITE ONE
            </button>
          ) : null}
        </div>
        {error ? <p className={styles.err}>{error}</p> : null}

        {tab === "proposals" ? (
          <div className={styles.roomBody}>
            <div className={styles.queue}>
              {article.proposals.length ? (
                article.proposals.map((entry) => (
                  <div key={entry.id} className={`${styles.qItem} ${entry.id === selected ? styles.qOn : ""}`}>
                    <button type="button" className={styles.qPick} onClick={() => setSelected(entry.id)}>
                      <b>{entry.title?.trim() || "Untitled draft"}</b>
                      <small suppressHydrationWarning>
                        {entry.author.username} · {timeAgo(entry.created_at)} · <span className={entry.status === "approved" ? styles.up : undefined}>{entry.status}</span>
                      </small>
                    </button>
                    <span className={styles.qVotes}>
                      <button type="button" aria-label="Upvote draft" aria-pressed={entry.viewer_vote === 1} disabled={!user || verify || voting === entry.id} onClick={() => void vote(entry, 1)}>
                        ▲
                      </button>
                      <b>{entry.upvotes - entry.downvotes}</b>
                      <button type="button" aria-label="Downvote draft" aria-pressed={entry.viewer_vote === -1} disabled={!user || verify || voting === entry.id} onClick={() => void vote(entry, -1)}>
                        ▼
                      </button>
                    </span>
                    {user?.is_admin && entry.status !== "approved" ? (
                      <button type="button" className={styles.approve} onClick={() => void approve(entry.id)}>
                        APPROVE
                      </button>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className={styles.empty}>No drafts yet. Be first.</p>
              )}
            </div>
            {proposal ? (
              <div className={styles.previewPane}>
                <span className={styles.byline}>
                  <b className={proposal.status === "approved" ? styles.kPlayer : styles.kDraft}>{proposal.status.toUpperCase()}</b>
                  <span>by {proposal.author.username}</span>
                  {proposal.tags.map((tag) => (
                    <span key={tag} className={styles.tag}>
                      {tag}
                    </span>
                  ))}
                </span>
                <h3>{proposal.title?.trim() || article.title}</h3>
                {proposal.subtitle ? <p className={styles.dek}>{proposal.subtitle}</p> : null}
                {proposal.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={proposal.thumbnail_url} alt="" className={styles.hero} />
                ) : null}
                <div className={styles.prose}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{proposal.content}</ReactMarkdown>
                </div>
              </div>
            ) : null}
          </div>
        ) : !user ? (
          <p className={styles.empty}>
            <Link href="/login">Sign in</Link> to write a draft.
          </p>
        ) : verify ? (
          <VerificationRequiredNotice action="submit drafts" />
        ) : (
          <form className={styles.draftForm} onSubmit={(event) => void submit(event)}>
            <label>
              <span className={styles.label}>Headline (optional)</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={article.title.slice(0, 90)} />
            </label>
            <label>
              <span className={styles.label}>Subtitle (optional)</span>
              <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} />
            </label>
            <div className={styles.formRow}>
              <label>
                <span className={styles.label}>Tags</span>
                <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="comma, separated" />
              </label>
              <label>
                <span className={styles.label}>Thumbnail URL</span>
                <input value={thumb} onChange={(event) => setThumb(event.target.value)} placeholder="optional" />
              </label>
            </div>
            <div className={styles.bodyHead}>
              <span className={styles.label}>Body · markdown</span>
              <span className={styles.seg}>
                <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
                  WRITE
                </button>
                <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
                  PREVIEW
                </button>
              </span>
            </div>
            {preview ? (
              <div className={`${styles.prose} ${styles.previewBox}`}>{content.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown> : <p className={styles.dim}>Nothing to preview yet.</p>}</div>
            ) : (
              <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={14} placeholder="What happened, why it matters, and what it does to the stock." />
            )}
            <div className={styles.formAct}>
              <span className={styles.dim}>{content.trim() ? `${content.trim().split(/\s+/).length} words` : ""}</span>
              <button type="submit" className={styles.primary} disabled={busy || !content.trim()}>
                {busy ? "SUBMITTING…" : "SUBMIT DRAFT"}
              </button>
            </div>
          </form>
        )}
      </aside>
    </>
  );
}
