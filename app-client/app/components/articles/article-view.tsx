"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { SiteShell } from "@/app/components/layout/site-shell";
import { DraftRoom } from "@/app/components/articles/draft-room";
import { fromArticle, readMinutes, splitHeadline } from "@/app/components/articles/stories";
import { apiFetch } from "@/app/lib/api";
import { markSeries } from "@/app/lib/market-units";
import { MOOD_COLORS } from "@/app/lib/moods";
import { normalizeArticleDetail, normalizeArticleListResponse } from "@/app/lib/normalizers";
import { signedPct, timeAgo, toneOf } from "@/app/lib/time";
import { ARTICLE_COMMENT_MOODS, type ArticleComment, type ArticleCommentMood, type ArticleDetail } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/articles/articles.module.scss";

const enc = encodeURIComponent;

// Record one view per slug per page load, and share the in-flight request if the component remounts.
const viewed = new Set<string>();
const inflight = new Map<string, Promise<Record<string, unknown>>>();

function loadRecord(slug: string) {
  const existing = inflight.get(slug);
  if (existing) return existing;
  const record = !viewed.has(slug);
  if (record) viewed.add(slug);
  const request = apiFetch<{ article: Record<string, unknown> }>(record ? `/api/articles/${enc(slug)}/view` : `/api/articles/${enc(slug)}`, { method: record ? "POST" : "GET", body: record ? "{}" : undefined })
    .then((result) => result.article)
    .catch((reason) => {
      if (record) viewed.delete(slug);
      throw reason;
    })
    .finally(() => inflight.delete(slug));
  inflight.set(slug, request);
  return request;
}

type AdminAction = "delete-article" | "delete-body" | "delete-news" | "thumbnail";

export function ArticleView({ slug }: { slug: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState<"like" | "save" | null>(null);
  const [room, setRoom] = useState<"proposals" | "write" | null>(null);
  const [confirm, setConfirm] = useState<AdminAction | null>(null);
  const [adminBusy, setAdminBusy] = useState<AdminAction | null>(null);
  const [copied, setCopied] = useState(false);
  const verify = userNeedsEmailVerification(user);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setArticle(normalizeArticleDetail(await loadRecord(slug)));
    } catch (reason) {
      setArticle(null);
      setError(String((reason as Error).message || reason));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (raw: { article: Record<string, unknown> }) => setArticle(normalizeArticleDetail(raw.article));

  const react = async (kind: "like" | "save") => {
    if (!user || verify) return;
    try {
      replace(await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${enc(slug)}/${kind}`, { method: "POST", body: "{}" }));
      setBurst(kind);
      window.setTimeout(() => setBurst((current) => (current === kind ? null : current)), 650);
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    }
  };

  const admin = async (action: AdminAction) => {
    if (!article) return;
    if (confirm !== action) {
      setConfirm(action);
      return;
    }
    setConfirm(null);
    setAdminBusy(action);
    setError(null);
    try {
      if (action === "delete-article") {
        await apiFetch(`/api/articles/${enc(article.slug)}`, { method: "DELETE" });
        router.push("/articles?type=community");
      } else if (action === "delete-body") {
        replace(await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${enc(article.slug)}/body`, { method: "DELETE" }));
      } else if (action === "delete-news") {
        await apiFetch(`/api/admin/holonews/articles/${enc(article.slug)}`, { method: "DELETE" });
        router.push("/articles?type=news");
      } else {
        const start = await apiFetch<{ job_id?: string; status?: string }>("/api/admin/holonews/thumbnails/regenerate", {
          method: "POST",
          body: JSON.stringify({
            news_id: article.news_item?.id || null,
            article_slug: article.slug,
            impacted_coins: article.related_assets.map((asset) => asset.symbol).filter(Boolean),
            reference_images: article.related_assets.map((asset) => asset.display_name).filter(Boolean),
          }),
        });
        if (start.job_id && start.status === "pending") {
          const deadline = Date.now() + 12 * 60_000;
          for (;;) {
            if (Date.now() > deadline) throw new Error("Thumbnail is still generating. Refresh in a bit.");
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const state = await apiFetch<{ status: string; code?: string; message?: string }>(`/api/admin/holonews/thumbnails/regenerate/${enc(start.job_id)}`);
            if (state.status === "done") break;
            if (state.status === "error") throw new Error(state.message || state.code || "thumbnail_regeneration_failed");
          }
        }
        viewed.add(slug);
        await load();
      }
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setAdminBusy(null);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; nothing to do */
    }
  };

  if (!article) {
    return (
      <SiteShell>
        <div className={styles.page}>
          <Link href="/articles" className={styles.back}>
            ← ARTICLES
          </Link>
          <p className={styles.empty}>{loading ? "Loading article…" : error === "article_not_found" || error === "404" ? "That article doesn't exist, or it was taken down." : `Couldn't load this article (${error}).`}</p>
        </div>
      </SiteShell>
    );
  }

  const isNews = article.is_news;
  const hasBody = Boolean(article.content?.trim());
  const heading = isNews ? splitHeadline(article.title) : { title: article.title, dek: null };
  const dek = article.subtitle?.trim() || heading.dek;
  const minutes = readMinutes(article.content);
  const canEdit = Boolean(user && !isNews && (user.is_admin || user.id === article.author?.id));
  const published = article.published_at || article.news_item?.published_at || article.created_at;

  return (
    <SiteShell>
      <div className={styles.page}>
        <Link href={isNews ? "/articles?type=news" : "/articles?type=community"} className={styles.back}>
          ← {isNews ? "HOLONEWS" : "PLAYER ARTICLES"}
        </Link>

        <div className={styles.readLayout}>
          <article className={styles.story}>
            <header className={styles.storyHead}>
              <div className={styles.byline}>
                <b className={isNews ? styles.kNews : styles.kPlayer}>{isNews ? "HOLONEWS" : "PLAYER ARTICLE"}</b>
                {article.status === "draft" ? <b className={styles.kDraft}>DRAFT</b> : null}
                {isNews && !hasBody ? <b className={styles.kOpen}>OPEN FOR COVERAGE</b> : null}
                {article.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <h1>{heading.title}</h1>
              {dek ? <p className={styles.dek}>{dek}</p> : null}
              <div className={styles.meta} suppressHydrationWarning>
                {article.author ? (
                  <Link href={`/profile/${enc(article.author.username)}`}>
                    by <b>{article.author.username}</b>
                  </Link>
                ) : (
                  <span>Imported by the HoloNews wire</span>
                )}
                <span title={published ? new Date(published).toLocaleString() : undefined}>{published ? new Date(published).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "unpublished"}</span>
                <span>{minutes ? `${minutes} min read` : "no body yet"}</span>
                <span>{article.views.toLocaleString("en-US")} views</span>
                <a href="#comments">{article.comment_count} comments</a>
              </div>
            </header>

            <div className={styles.actions}>
              <button type="button" className={`${article.viewer_has_liked ? styles.on : ""} ${burst === "like" ? styles.burst : ""}`} disabled={!user || verify} onClick={() => void react("like")} aria-pressed={article.viewer_has_liked}>
                {article.viewer_has_liked ? "♥" : "♡"} {article.likes}
              </button>
              <button type="button" className={`${article.viewer_has_saved ? styles.on : ""} ${burst === "save" ? styles.burst : ""}`} disabled={!user || verify} onClick={() => void react("save")} aria-pressed={article.viewer_has_saved}>
                {article.viewer_has_saved ? "SAVED" : "SAVE"} {article.saves}
              </button>
              <button type="button" onClick={() => void copyLink()}>
                {copied ? "COPIED" : "COPY LINK"}
              </button>
              {canEdit ? (
                <Link href={`/articles/${enc(article.slug)}/edit`} className={styles.actLink}>
                  EDIT
                </Link>
              ) : null}
              {isNews && (hasBody ? article.proposals.length : true) ? (
                <button type="button" onClick={() => setRoom("proposals")}>
                  DRAFTS {article.proposals.length}
                </button>
              ) : null}
              {user?.is_admin ? (
                <span className={styles.adminActs}>
                  {!isNews ? (
                    <button type="button" className={confirm === "delete-article" ? styles.danger : undefined} disabled={adminBusy !== null} onClick={() => void admin("delete-article")}>
                      {confirm === "delete-article" ? "CONFIRM DELETE" : "DELETE"}
                    </button>
                  ) : null}
                  {isNews && hasBody ? (
                    <button type="button" className={confirm === "delete-body" ? styles.danger : undefined} disabled={adminBusy !== null} onClick={() => void admin("delete-body")}>
                      {confirm === "delete-body" ? "CONFIRM" : "DELETE BODY"}
                    </button>
                  ) : null}
                  {isNews ? (
                    <>
                      <button type="button" className={confirm === "delete-news" ? styles.danger : undefined} disabled={adminBusy !== null} onClick={() => void admin("delete-news")}>
                        {confirm === "delete-news" ? "CONFIRM" : "DELETE NEWS ITEM"}
                      </button>
                      <button type="button" className={confirm === "thumbnail" ? styles.danger : undefined} disabled={adminBusy !== null} onClick={() => void admin("thumbnail")}>
                        {adminBusy === "thumbnail" ? "GENERATING…" : confirm === "thumbnail" ? "CONFIRM" : "NEW THUMBNAIL"}
                      </button>
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
            {!user ? (
              <p className={styles.hint}>
                <Link href="/login">Sign in</Link> to like, save, comment or write coverage.
              </p>
            ) : verify ? (
              <VerificationRequiredNotice action="like, save, comment, or write coverage" compact />
            ) : null}
            {error ? (
              <p className={styles.err} role="alert">
                {error}
              </p>
            ) : null}

            {article.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={article.thumbnail_url} alt="" className={styles.hero} />
            ) : null}

            {hasBody ? (
              <div className={styles.prose}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{article.content}</ReactMarkdown>
              </div>
            ) : isNews ? (
              <section className={styles.open}>
                <b>Nobody has written this one up yet.</b>
                <p>The headline is on the wire, but the long version is still open. Write a draft or vote on the ones already in the room; an editor approves the best one as the official article.</p>
                <div>
                  <button type="button" className={styles.primary} onClick={() => setRoom("write")}>
                    OPEN THE DRAFT ROOM
                  </button>
                  {article.proposals.length ? (
                    <button type="button" className={styles.ghost} onClick={() => setRoom("proposals")}>
                      READ {article.proposals.length} DRAFT{article.proposals.length === 1 ? "" : "S"}
                    </button>
                  ) : null}
                </div>
              </section>
            ) : (
              <p className={styles.empty}>This article doesn&apos;t have a body yet.</p>
            )}

            <Comments article={article} onChange={setArticle} />
          </article>

          <aside className={styles.readRail}>
            <InThisStory article={article} />
            <MoreStories article={article} />
          </aside>
        </div>
      </div>

      {room ? <DraftRoom article={article} initialTab={room} onClose={() => setRoom(null)} onChange={setArticle} /> : null}
    </SiteShell>
  );
}

// ── Talents in the story ─────────────────────────────────────────────────
function InThisStory({ article }: { article: ArticleDetail }) {
  const assets = useMarketStore((state) => state.assets);
  const openTrade = useTradeStore((state) => state.openTrade);
  if (!article.related_assets.length) return null;
  return (
    <section className={styles.railSec}>
      <h2>In this story</h2>
      {article.related_assets.map((related) => {
        const asset = assets.find((entry) => entry.symbol === related.symbol);
        const move = asset?.move_24h_pct ?? null;
        return (
          <div key={related.id} className={styles.talent}>
            <Link href={`/stocks/${enc(related.symbol)}`} className={styles.talentId} data-peek-stock={related.symbol}>
              <Oshimark icon={related.icon ?? asset?.icon} symbol={related.symbol} size={26} />
              <span>
                <b>{related.symbol}</b>
                <small>{related.display_name}</small>
              </span>
            </Link>
            {asset ? <Sparkline values={markSeries(asset)} tone={toneOf(move) === "down" ? "down" : "up"} width={70} height={22} /> : <span />}
            <span className={styles.talentPx}>
              <b>{asset?.current_mid_price?.toFixed(2) ?? "—"}</b>
              <small className={styles[toneOf(move)]}>{signedPct(move)}</small>
            </span>
            <button type="button" className={styles.buy} onClick={() => openTrade(related.symbol, "buy")} disabled={!asset}>
              TRADE
            </button>
          </div>
        );
      })}
    </section>
  );
}

function MoreStories({ article }: { article: ArticleDetail }) {
  const symbol = article.related_assets[0]?.symbol ?? null;
  const [items, setItems] = useState<ReturnType<typeof fromArticle>[]>([]);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: "7" });
    if (symbol) params.set("asset", symbol);
    else params.set("type", article.is_news ? "news" : "community");
    apiFetch<Record<string, unknown>>(`/api/articles?${params}`)
      .then((raw) => !cancelled && setItems(normalizeArticleListResponse(raw).items.filter((item) => item.slug !== article.slug).slice(0, 6).map(fromArticle)))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [article.is_news, article.slug, symbol]);
  if (!items.length) return null;
  return (
    <section className={styles.railSec}>
      <h2>{symbol ? `More on ${symbol}` : "More stories"}</h2>
      {items.map((story) => (
        <Link key={story.key} href={story.href} className={styles.more}>
          <b>{story.kind === "news" ? splitHeadline(story.title).title : story.title}</b>
          <small suppressHydrationWarning>
            {story.kind === "news" ? "HoloNews" : story.author ? `by ${story.author}` : "Article"} · {timeAgo(story.at)}
          </small>
        </Link>
      ))}
    </section>
  );
}

// ── Comments ─────────────────────────────────────────────────────────────
type Sort = "newest" | "oldest" | "top";

function Comments({ article, onChange }: { article: ArticleDetail; onChange: (next: ArticleDetail) => void }) {
  const { user } = useAuth();
  const verify = userNeedsEmailVerification(user);
  const [sort, setSort] = useState<Sort>("newest");
  const [body, setBody] = useState("");
  const [mood, setMood] = useState<ArticleCommentMood | null>(null);
  const [busy, setBusy] = useState(false);
  const [voting, setVoting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const list = [...article.comments];
    if (sort === "top") return list.sort((a, b) => b.upvotes - b.downvotes - (a.upvotes - a.downvotes));
    const dir = sort === "oldest" ? 1 : -1;
    return list.sort((a, b) => dir * (Date.parse(a.created_at) - Date.parse(b.created_at)));
  }, [article.comments, sort]);

  const post = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${enc(article.slug)}/comments`, { method: "POST", body: JSON.stringify({ body: body.trim(), mood }) });
      onChange(normalizeArticleDetail(raw.article));
      setBody("");
      setMood(null);
      setSort("newest");
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setBusy(false);
    }
  };

  const vote = async (comment: ArticleComment, value: 1 | -1) => {
    if (!user || verify) return;
    setVoting(comment.id);
    try {
      const raw = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${enc(article.slug)}/comments/${comment.id}/vote`, {
        method: "POST",
        body: JSON.stringify({ value: comment.viewer_vote === value ? 0 : value }),
      });
      onChange(normalizeArticleDetail(raw.article));
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setVoting(null);
    }
  };

  return (
    <section className={styles.comments} id="comments">
      <div className={styles.cHead}>
        <h2>
          {article.comment_count} comment{article.comment_count === 1 ? "" : "s"}
        </h2>
        {article.comments.length > 1 ? (
          <span className={styles.seg} role="group" aria-label="Sort comments">
            {(["newest", "oldest", "top"] as Sort[]).map((value) => (
              <button key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)}>
                {value.toUpperCase()}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {user && !verify ? (
        <form className={styles.composer} onSubmit={(event) => void post(event)}>
          <div className={styles.moods} role="group" aria-label="Mood">
            {ARTICLE_COMMENT_MOODS.map((name) => (
              <button key={name} type="button" className={styles.mood} style={{ "--mc": MOOD_COLORS[name] } as React.CSSProperties} aria-pressed={mood === name} onClick={() => setMood(mood === name ? null : name)}>
                <i />
                {name}
              </button>
            ))}
          </div>
          <div className={styles.composeRow}>
            <textarea rows={3} value={body} onChange={(event) => setBody(event.target.value.slice(0, 2000))} placeholder="Add your take" aria-label="Comment" />
            <button type="submit" className={styles.primary} disabled={busy || !body.trim()}>
              {busy ? "…" : "POST"}
            </button>
          </div>
          {error ? <p className={styles.err}>{error}</p> : null}
        </form>
      ) : null}
      {sorted.length ? (
        sorted.map((comment) => {
          const own = user?.id === comment.author.id;
          return (
            <article key={comment.id} className={styles.cmt}>
              <div className={styles.votes}>
                <button type="button" aria-label="Upvote" aria-pressed={comment.viewer_vote === 1} disabled={!user || verify || own || voting === comment.id} onClick={() => void vote(comment, 1)}>
                  ▲
                </button>
                <span>{comment.upvotes - comment.downvotes}</span>
                <button type="button" aria-label="Downvote" aria-pressed={comment.viewer_vote === -1} disabled={!user || verify || own || voting === comment.id} onClick={() => void vote(comment, -1)}>
                  ▼
                </button>
              </div>
              <div>
                <div className={styles.cMeta}>
                  <Link href={`/profile/${enc(comment.author.username)}`}>
                    <b>{comment.author.username}</b>
                  </Link>
                  {comment.mood ? (
                    <span className={styles.mb} style={{ "--mc": MOOD_COLORS[comment.mood] } as React.CSSProperties}>
                      {comment.mood}
                    </span>
                  ) : null}
                  <time suppressHydrationWarning title={new Date(comment.created_at).toLocaleString()}>
                    {timeAgo(comment.created_at)}
                  </time>
                </div>
                <p>
                  {comment.body.split("\n").map((line, i) => (
                    <span key={i} className={line.trimStart().startsWith(">") ? styles.gt : undefined}>
                      {line}
                      {"\n"}
                    </span>
                  ))}
                </p>
              </div>
            </article>
          );
        })
      ) : (
        <p className={styles.empty}>No comments yet.{user ? "" : " Sign in to start one."}</p>
      )}
    </section>
  );
}
