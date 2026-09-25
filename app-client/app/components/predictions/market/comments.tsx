"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { fetchComments, postComment, type CommentsPage, type MarketComment } from "@/app/components/predictions/market/shared";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { outcomeColor, shares as fmtShares, timeAgo } from "@/app/lib/predictions/format";
import type { PredictionMarketDetail } from "@/app/lib/predictions/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/predictions/market/market.module.scss";

const COMMENT_COPY: Record<string, string> = {
  prediction_market_comment_requires_position: "Take a position to post here.",
  invalid_prediction_market_comment: "Say something first (4,000 characters max).",
};

/** The market's thread. Posting needs a position, so everyone talking has skin in it. */
export function Comments({ market }: { market: PredictionMarketDetail }) {
  const { user } = useAuth();
  const [page, setPage] = useState<CommentsPage | null>(null);
  const [items, setItems] = useState<MarketComment[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchComments(market.slug, 1);
      setPage(result);
      setItems(result.comments);
    } catch {
      setPage(null);
    }
  }, [market.slug]);

  // Reload when the viewer's position changes (it decides whether they can post).
  const positionKey = market.mine?.positions.map((position) => `${position.outcome_id}:${position.shares > 0}`).join(",") ?? "";
  useEffect(() => {
    void load();
  }, [load, positionKey, user?.id]);

  const more = async () => {
    if (!page?.pagination.has_next_page) return;
    setLoadingMore(true);
    try {
      const next = await fetchComments(market.slug, page.pagination.page + 1);
      setPage(next);
      setItems((current) => [...current, ...next.comments.filter((comment) => !current.some((entry) => entry.id === comment.id))]);
    } finally {
      setLoadingMore(false);
    }
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await postComment(market.slug, body);
      setDraft("");
      await load();
    } catch (reason) {
      const message = String((reason as Error)?.message ?? "");
      setError(COMMENT_COPY[message] ?? predictionErrorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const canPost = Boolean(page?.viewer_context.can_post);
  const colorOf = (code: string) => {
    const outcome = market.outcomes.find((entry) => entry.outcome_code === code);
    return outcome ? outcomeColor(market, outcome) : "var(--dim)";
  };

  return (
    <section className={styles.section} aria-labelledby="com-h">
      <div className={styles.sectionHead}>
        <h2 id="com-h">Comments</h2>
        {page ? <span className={styles.headStat}>{page.pagination.total}</span> : null}
      </div>

      {!user ? (
        <p className={styles.fine}>
          <Link href="/login">Sign in</Link> to join the thread.
        </p>
      ) : canPost ? (
        <div className={styles.composer}>
          <label htmlFor={`c-${market.id}`} className={styles.srOnly}>
            Comment
          </label>
          <textarea id={`c-${market.id}`} rows={2} maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Talk your book." />
          <button type="button" className={styles.postBtn} disabled={!draft.trim() || busy} onClick={submit}>
            {busy ? "Posting…" : "Post"}
          </button>
          {error ? (
            <p className={styles.errorLine} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className={styles.fine}>Take a position to post. Only players with skin in it can talk here.</p>
      )}

      {items.length ? (
        <ol className={styles.comments}>
          {items.map((comment) => (
            <li key={comment.id}>
              <PlayerAvatar username={comment.author?.username ?? "?"} pictureUrl={comment.author?.profile_picture_url} color={comment.author?.profile_color} size={28} />
              <div>
                <div className={styles.commentHead}>
                  {comment.author ? <Link href={`/profile/${encodeURIComponent(comment.author.username)}`}>{comment.author.username}</Link> : <span>someone</span>}
                  {comment.author_stakes.slice(0, 2).map((stake) => (
                    <span key={stake.outcome_id} className={styles.stake} style={{ "--oc": colorOf(stake.outcome_code) } as CSSProperties}>
                      {fmtShares(stake.shares)} {stake.outcome_label ?? stake.outcome_code}
                    </span>
                  ))}
                  <time dateTime={comment.created_at}>{timeAgo(comment.created_at)}</time>
                </div>
                <p>{comment.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : page ? (
        <p className={styles.fine}>No comments yet.</p>
      ) : null}
      {page?.pagination.has_next_page ? (
        <button type="button" className={styles.miniBtn} onClick={more} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Older comments"}
        </button>
      ) : null}
    </section>
  );
}
