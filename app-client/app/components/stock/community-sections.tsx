"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { useArticles, useBoardMood, useComments, useOshiboard, useTape, useTreasury } from "@/app/components/stock/use-stock-data";
import { apiFetch } from "@/app/lib/api";
import { formatEtTime } from "@/app/lib/market-clock";
import { normalizeAssetCommentListResponse } from "@/app/lib/normalizers";
import { money, signedPct, timeAgo, toneOf } from "@/app/lib/time";
import { ARTICLE_COMMENT_MOODS, type ArticleCommentMood, type AssetComment, type AssetCommentListResponse, type MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/stock/dossier.module.scss";

const MOOD_COLORS: Record<ArticleCommentMood, string> = {
  Bullish: "var(--up)",
  Bearish: "var(--down)",
  Neutral: "#A7AEBE",
  Hodling: "var(--blue)",
  "Dump Eet": "#FF8A3D",
  "He Bought?": "#B4F25C",
  "He Sold?": "#FF6FB5",
  "Diamond Hands": "#8AD6FF",
  Watching: "#C9A7FF",
  Accumulating: "#F5C542",
};

const enc = encodeURIComponent;

// ── Holders & supply ─────────────────────────────────────────────────────
export function HoldersSection({ asset }: { asset: MarketAsset }) {
  const board = useOshiboard(asset.symbol);
  const treasury = useTreasury(asset.symbol);
  const mood = useBoardMood(asset.symbol, 0);
  const stats = board.data?.stats;
  const entries = board.data?.entries ?? [];

  const moods = useMemo(() => {
    const counts = new Map<ArticleCommentMood, number>();
    for (const comment of mood.data?.comments ?? []) if (comment.mood) counts.set(comment.mood, (counts.get(comment.mood) ?? 0) + 1);
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    return { total, rows: [...counts.entries()].sort((a, b) => b[1] - a[1]) };
  }, [mood.data]);

  const supply = treasury.data;
  const max = supply?.max_supply ?? (asset.circulating_supply ?? 0) + (asset.treasury_supply ?? 0);
  const circulating = supply?.circulating_supply ?? asset.circulating_supply ?? 0;
  const inTreasury = supply?.treasury_supply ?? asset.treasury_supply ?? 0;
  const emission = supply?.current_daily_emission ?? asset.current_daily_emission ?? 0;

  return (
    <section className={styles.sec} id="s-holders">
      <div className={styles.secHead}>
        <h2>Holders &amp; supply</h2>
        <span className={styles.aside}>{stats ? `${stats.member_count.toLocaleString("en-US")} oshis hold ${stats.total_shares.toLocaleString("en-US")} sh` : "oshiboard"}</span>
      </div>
      <div className={styles.holdersGrid}>
        <div>
          <div className={styles.label} style={{ marginBottom: "0.4rem" }}>
            Oshiboard · players who made {asset.symbol} their oshi
          </div>
          {entries.length ? (
            entries.map((entry) => (
              <Link key={entry.user_id} href={`/profile/${enc(entry.username)}`} className={styles.holder}>
                <span className={styles.hRank}>{entry.rank}</span>
                <b>{entry.username}</b>
                <span>{entry.coin_quantity.toLocaleString("en-US")} sh</span>
                <span className={styles.dim}>{money(entry.coin_market_value)}</span>
                <span className={styles.dim}>{stats && stats.total_shares ? `${((entry.coin_quantity / stats.total_shares) * 100).toFixed(1)}%` : ""}</span>
              </Link>
            ))
          ) : (
            <p className={styles.empty}>{board.loading ? "Loading holders…" : `Nobody has picked ${asset.symbol} as their oshi yet.`}</p>
          )}
          <Link href="/oshiboard" className={styles.more}>
            Full oshiboard →
          </Link>
        </div>
        <div>
          <div className={styles.label} style={{ marginBottom: "0.4rem" }}>
            Board mood · last {moods.total || 24} posts
          </div>
          {moods.total ? (
            <>
              <div className={styles.moodBar}>
                {moods.rows.map(([name, count]) => (
                  <i key={name} style={{ flex: count, background: MOOD_COLORS[name] }} title={`${name} ${count}`} />
                ))}
              </div>
              <div className={styles.moodLeg}>
                {moods.rows.slice(0, 5).map(([name, count]) => (
                  <span key={name}>
                    <i style={{ background: MOOD_COLORS[name] }} />
                    {name} {Math.round((count / moods.total) * 100)}%
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className={styles.empty}>{mood.loading ? "Reading the room…" : "No moods posted yet."}</p>
          )}
          <div className={styles.label} style={{ margin: "1rem 0 0.4rem" }}>
            Supply
          </div>
          <div className={styles.supplyBar} role="img" aria-label={`${circulating} circulating of ${max}`}>
            <i style={{ width: `${max ? (circulating / max) * 100 : 0}%` }} />
          </div>
          <dl className={styles.kv}>
            <dt>Circulating</dt>
            <dd>{Math.round(circulating).toLocaleString("en-US")}</dd>
            <dt>Treasury</dt>
            <dd>{Math.round(inTreasury).toLocaleString("en-US")}</dd>
            <dt>Max supply</dt>
            <dd>{Math.round(max).toLocaleString("en-US")}</dd>
            <dt>Printed at settlement</dt>
            <dd>{emission ? `${emission.toFixed(2)} sh` : "none"}</dd>
          </dl>
          <p className={styles.formula}>The treasury prints new shares of stocks trading above their target at settlement. Buying from the treasury is what moves them into circulation.</p>
        </div>
      </div>
    </section>
  );
}

// ── The board ────────────────────────────────────────────────────────────
function commentError(error: unknown) {
  const code = String((error as Error).message || error);
  const known: Record<string, string> = {
    asset_comment_requires_holding: "Hold at least one share to post on the board.",
    invalid_asset_comment: "Posts need some text and a valid mood.",
    unauthenticated: "Sign in to join the board.",
    asset_comment_self_vote: "You can't vote on your own post.",
    invalid_asset_comment_vote: "That vote didn't save.",
  };
  return known[code] ?? code;
}

function Body({ text }: { text: string }) {
  return (
    <p>
      {text.split("\n").map((line, i) => (
        <span key={i} className={line.trimStart().startsWith(">") ? styles.gt : undefined}>
          {line}
          {"\n"}
        </span>
      ))}
    </p>
  );
}

export function BoardSection({ asset }: { asset: MarketAsset }) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const comments = useComments(asset.symbol, page);
  const [override, setOverride] = useState<{ page: number; board: AssetCommentListResponse } | null>(null);
  const [mood, setMood] = useState<ArticleCommentMood | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [voting, setVoting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const board = override && override.page === page ? override.board : comments.data;
  const verify = userNeedsEmailVerification(user);
  const owned = board?.viewer_context.owned_shares ?? 0;
  const canPost = Boolean(user) && !verify && (board?.viewer_context.can_post ?? owned > 0);
  const total = board?.pagination.total ?? 0;
  const sym = asset.symbol.toUpperCase();

  async function post(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || !canPost) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await apiFetch<Record<string, unknown>>(`/api/market/assets/${enc(sym)}/comments?page=1&limit=8`, { method: "POST", body: JSON.stringify({ body: text.trim(), mood }) });
      setOverride({ page: 1, board: normalizeAssetCommentListResponse(raw) });
      setPage(1);
      setText("");
      setMood(null);
    } catch (reason) {
      setError(commentError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function vote(comment: AssetComment, value: 1 | -1) {
    if (!user) {
      setError("Sign in to vote.");
      return;
    }
    setVoting(comment.id);
    setError(null);
    try {
      const raw = await apiFetch<Record<string, unknown>>(`/api/market/assets/${enc(sym)}/comments/${comment.id}/vote?page=${page}&limit=8`, {
        method: "POST",
        body: JSON.stringify({ value: comment.viewer_vote === value ? 0 : value }),
      });
      setOverride({ page, board: normalizeAssetCommentListResponse(raw) });
    } catch (reason) {
      setError(commentError(reason));
    } finally {
      setVoting(null);
    }
  }

  return (
    <section className={styles.sec} id="s-board">
      <div className={styles.secHead}>
        <h2>The board</h2>
        <span className={styles.aside}>
          {total.toLocaleString("en-US")} post{total === 1 ? "" : "s"} · holders only
        </span>
      </div>
      <form className={styles.composer} onSubmit={(event) => void post(event)}>
        <div className={styles.moods} role="group" aria-label="Mood">
          {ARTICLE_COMMENT_MOODS.map((name) => (
            <button key={name} type="button" className={styles.mood} style={{ "--mc": MOOD_COLORS[name] } as React.CSSProperties} aria-pressed={mood === name} onClick={() => setMood(mood === name ? null : name)} disabled={!canPost}>
              <i />
              {name}
            </button>
          ))}
        </div>
        <div className={styles.composeRow}>
          <textarea rows={2} value={text} onChange={(event) => setText(event.target.value.slice(0, 1000))} placeholder={canPost ? "Say something to the other bagholders" : "Hold a share to post"} disabled={!canPost} aria-label="Post to the board" />
          <button type="submit" className={styles.postBtn} disabled={!canPost || busy || !text.trim()}>
            {busy ? "…" : "POST"}
          </button>
        </div>
        <p className={styles.composeNote}>
          {!user ? (
            <>
              <Link href="/login">Sign in</Link> to vote. Hold shares of {sym} to post.
            </>
          ) : verify ? (
            "Verify your email to post and vote."
          ) : canPost ? (
            `You hold ${owned.toLocaleString("en-US")} ${sym}, so you can post. Pick a mood so everyone knows where you stand.`
          ) : (
            `Only holders can post. Buy a share of ${sym} to join in.`
          )}
        </p>
        {error ? (
          <p className={styles.err} role="alert">
            {error}
          </p>
        ) : null}
      </form>
      {board?.comments.length ? (
        board.comments.map((comment) => (
          <article key={comment.id} className={styles.cmt}>
            <div className={styles.votes}>
              <button type="button" aria-pressed={comment.viewer_vote === 1} aria-label="Upvote" onClick={() => void vote(comment, 1)} disabled={voting === comment.id}>
                ▲
              </button>
              <span>{comment.upvotes - comment.downvotes}</span>
              <button type="button" aria-pressed={comment.viewer_vote === -1} aria-label="Downvote" onClick={() => void vote(comment, -1)} disabled={voting === comment.id}>
                ▼
              </button>
            </div>
            <div>
              <div className={styles.cmtMeta}>
                <Link href={`/profile/${enc(comment.author.username)}`}>
                  <b style={comment.author.profile_color ? { color: comment.author.profile_color } : undefined}>{comment.author.username}</b>
                </Link>
                {comment.author_share_quantity > 0 ? (
                  <span className={styles.hold}>
                    {comment.author_share_quantity.toLocaleString("en-US")} {sym}
                  </span>
                ) : null}
                {comment.mood ? (
                  <span className={styles.mb} style={{ "--mc": MOOD_COLORS[comment.mood] } as React.CSSProperties}>
                    {comment.mood}
                  </span>
                ) : null}
                <time suppressHydrationWarning>{timeAgo(comment.created_at)}</time>
              </div>
              <Body text={comment.body} />
            </div>
          </article>
        ))
      ) : (
        <p className={styles.empty}>{comments.loading ? "Loading the board…" : `Nobody has posted about ${sym} yet.`}</p>
      )}
      {board && (board.pagination.has_next_page || page > 1) ? (
        <div className={styles.pager}>
          <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
            ‹ NEWER
          </button>
          <span>
            {page} / {board.pagination.page_count}
          </span>
          <button type="button" onClick={() => setPage(page + 1)} disabled={!board.pagination.has_next_page}>
            OLDER ›
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ── News, unit mates, tape ───────────────────────────────────────────────
export function NewsSection({ asset }: { asset: MarketAsset }) {
  const articles = useArticles(asset.symbol);
  const tape = useTape(asset.symbol);
  const assets = useMarketStore((state) => state.assets);
  const mates = useMemo(() => assets.filter((entry) => entry.unit && entry.unit === asset.unit && entry.symbol !== asset.symbol), [asset.symbol, asset.unit, assets]);
  const items = articles.data ?? [];

  return (
    <section className={styles.sec} id="s-news">
      <div className={styles.secHead}>
        <h2>In the news</h2>
        <span className={styles.aside}>HoloNews + player articles</span>
      </div>
      {items.length ? (
        <div className={styles.newsList}>
          {items.map((article) => (
            <Link key={article.id} href={`/articles/${enc(article.slug)}`} className={styles.nItem}>
              {article.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={article.thumbnail_url} alt="" loading="lazy" />
              ) : (
                <ArtSlot kind="chibi" pose="idle" symbol={asset.symbol} icon={asset.icon} width={64} className={styles.nArt} />
              )}
              <span>
                <b>{article.news_item?.headline || article.title}</b>
                <small>
                  <span className={styles.kind}>{article.is_news ? "HOLONEWS" : "ARTICLE"}</span>
                  {article.author && !article.is_news ? ` · ${article.author.username}` : ""} · <span suppressHydrationWarning>{timeAgo(article.published_at ?? article.created_at)}</span>
                  {article.comment_count ? ` · ${article.comment_count} comments` : ""}
                </small>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>{articles.loading ? "Loading coverage…" : `No coverage of ${asset.display_name} yet.`}</p>
      )}
      <div className={styles.newsFoot}>
        <Link href="/news">All HoloNews →</Link>
        <Link href="/articles/new">Write about {asset.symbol} →</Link>
      </div>

      {mates.length ? (
        <>
          <div className={styles.label} style={{ margin: "1.2rem 0 0.5rem" }}>
            Also in {asset.unit?.replace(/^hololive\s+/i, "")}
          </div>
          <div className={styles.mates}>
            {mates.map((mate) => (
              <Link key={mate.symbol} href={`/stocks/${enc(mate.symbol)}`} className={styles.mate} data-peek-stock={mate.symbol}>
                <Oshimark icon={mate.icon} symbol={mate.symbol} size={20} />
                <b>{mate.symbol}</b>
                <span className={styles[toneOf(mate.move_24h_pct)]}>{signedPct(mate.move_24h_pct, 1)}</span>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <div className={styles.label} style={{ margin: "1.2rem 0 0.4rem" }}>
        Tape · recent fills
      </div>
      {tape.data?.length ? (
        <div className={styles.tape}>
          {tape.data.map((trade) => (
            <div key={trade.id} className={styles.tapeRow}>
              <time suppressHydrationWarning>{formatEtTime(new Date(trade.ts), { seconds: true })}</time>
              <b className={trade.side === "buy" ? styles.up : styles.down}>{trade.side.toUpperCase()}</b>
              <span>{trade.quantity.toLocaleString("en-US")} sh</span>
              <span>@ {trade.price.toFixed(2)}</span>
              <span className={styles.dim}>{money(trade.gross_cash)}</span>
            </div>
          ))}
          <Link href={`/market/activity?symbol=${enc(asset.symbol)}`} className={styles.more}>
            Full tape on Activity →
          </Link>
        </div>
      ) : (
        <p className={styles.empty}>{tape.loading ? "Loading fills…" : `No fills on ${asset.symbol} lately.`}</p>
      )}
    </section>
  );
}
