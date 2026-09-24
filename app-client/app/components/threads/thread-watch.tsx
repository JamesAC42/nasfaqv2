"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { RichText, type RichOptions } from "@/app/components/common/rich-text";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { signedPct, toneOf } from "@/app/lib/time";
import type { MarketAsset } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/threads/threads.module.scss";

// ── Data ─────────────────────────────────────────────────────────────────
type Post = {
  post_id: number;
  timestamp: number | null;
  author: string;
  text_content: string;
  image_url: string | null;
  thumbnail_url: string | null;
  op_cdn_image_url: string | null;
};

type Thread = { key: string; board: string; thread_id: number; subject: string | null; updated_at: string | null; posts: Post[] };
type Load = { data: Thread | null; error: string | null; loading: boolean };

type BoardKey = "nasfaq" | "hlg" | "numbers" | "news";
const BOARDS: Array<{ key: BoardKey; label: string; name: string; endpoint: string; notFound: string }> = [
  { key: "nasfaq", label: "/nasfaq/", name: "The NASFAQ general", endpoint: "/api/getNasfaqThread", notFound: "nasfaq_thread_not_found" },
  { key: "hlg", label: "/hlg/", name: "Hololive general", endpoint: "/api/getHlgThread", notFound: "hlg_thread_not_found" },
  { key: "numbers", label: "/#/", name: "Numbers general", endpoint: "/api/getNumbersThread", notFound: "numbers_thread_not_found" },
  { key: "news", label: "/news/", name: "Holo news general", endpoint: "/api/getNewsThread", notFound: "news_thread_not_found" },
];

type YouTab = { threadId: number | null; youPostIds: number[]; seenReplyIds: number[] };
type YouState = Record<BoardKey, YouTab>;
const YOU_KEY = "nasfaq-thread-you-state-v1";
const REFRESH_MS = 60_000;

const emptyYou = (): YouState => ({
  nasfaq: { threadId: null, youPostIds: [], seenReplyIds: [] },
  hlg: { threadId: null, youPostIds: [], seenReplyIds: [] },
  numbers: { threadId: null, youPostIds: [], seenReplyIds: [] },
  news: { threadId: null, youPostIds: [], seenReplyIds: [] },
});

function readYou(): YouState {
  const next = emptyYou();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(YOU_KEY) || "{}") as Partial<Record<BoardKey, Partial<YouTab> & { youPostId?: number }>>;
    for (const board of BOARDS) {
      const entry = parsed?.[board.key];
      if (!entry) continue;
      const nums = (list: unknown) => (Array.isArray(list) ? list.filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : []);
      next[board.key] = {
        threadId: typeof entry.threadId === "number" ? entry.threadId : null,
        youPostIds: Array.isArray(entry.youPostIds) ? nums(entry.youPostIds) : typeof entry.youPostId === "number" ? [entry.youPostId] : [],
        seenReplyIds: nums(entry.seenReplyIds),
      };
    }
  } catch {
    /* storage blocked or corrupt */
  }
  return next;
}

function writeYou(state: YouState) {
  try {
    window.localStorage.setItem(YOU_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked */
  }
}

function buildReplies(posts: Post[]) {
  const index = new Map<number, number[]>();
  for (const post of posts) {
    const seen = new Set<number>();
    for (const match of post.text_content.matchAll(/>>(\d+)/g)) {
      const target = Number(match[1]);
      if (seen.has(target)) continue;
      seen.add(target);
      index.set(target, [...(index.get(target) ?? []), post.post_id]);
    }
  }
  return index;
}

function repliesTo(ids: number[], replies: Map<number, number[]>) {
  const out = new Set<number>();
  for (const id of ids) for (const reply of replies.get(id) ?? []) out.add(reply);
  return out;
}

const hasMedia = (post: Post) => Boolean(post.thumbnail_url || post.image_url || post.op_cdn_image_url);
const hasLinks = (post: Post) => /https?:\/\//.test(post.text_content);
// A pruned 4chan image 404s; drop the empty frame instead of leaving a gap.
const hideBroken = (event: { currentTarget: HTMLImageElement }) => {
  const frame = event.currentTarget.parentElement;
  if (frame) frame.style.display = "none";
};
const isVideo = (url: string | null) => Boolean(url && /\.(webm|mp4)$/i.test(url));

function stamp(seconds: number | null) {
  if (!seconds) return "—";
  const date = new Date(seconds * 1000);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function ago(seconds: number | null, now: number) {
  if (!seconds) return "—";
  const mins = Math.max(0, Math.round((now - seconds * 1000) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Talents are named far more often than their tickers on /vt/. Match both.
const NAME_STOP = new Set(["sakura", "ookami", "akai", "hololive", "none"]);
function buildTalentMatcher(assets: MarketAsset[]) {
  const words = new Map<string, MarketAsset>();
  for (const asset of assets) {
    for (const word of asset.display_name.split(/[\s+]+/)) {
      const clean = word.replace(/[^A-Za-z']/g, "").toLowerCase();
      if (clean.length >= 4 && !NAME_STOP.has(clean) && !words.has(clean)) words.set(clean, asset);
    }
  }
  const tickers = new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset]));
  return (text: string) => {
    const found = new Set<MarketAsset>();
    for (const match of text.matchAll(/\$?\b([A-Z]{3,4})\b/g)) {
      const asset = tickers.get(match[1]);
      if (asset) found.add(asset);
    }
    for (const match of text.toLowerCase().matchAll(/[a-z']{4,}/g)) {
      const asset = words.get(match[0]);
      if (asset) found.add(asset);
    }
    return found;
  };
}

// ── Page ─────────────────────────────────────────────────────────────────
type Sort = "oldest" | "latest" | "replies";
type Media = "all" | "media" | "text";
type Preview = { postId: number; x: number; y: number; above: boolean } | null;

export function ThreadWatch() {
  const assets = useMarketStore((state) => state.assets);
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset])), [assets]);
  const matchTalents = useMemo(() => buildTalentMatcher(assets), [assets]);

  const [active, setActive] = useState<BoardKey>("nasfaq");
  const [loads, setLoads] = useState<Record<BoardKey, Load>>(() => ({
    nasfaq: { data: null, error: null, loading: true },
    hlg: { data: null, error: null, loading: true },
    numbers: { data: null, error: null, loading: true },
    news: { data: null, error: null, loading: true },
  }));
  // (You) marks live in this browser only. Nothing that renders on the server depends on them.
  const [you, setYou] = useState<YouState>(() => (typeof window === "undefined" ? emptyYou() : readYou()));
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("oldest");
  const [media, setMedia] = useState<Media>("all");
  const [highlights, setHighlights] = useState(false);
  const [onlyYou, setOnlyYou] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [preview, setPreview] = useState<Preview>(null);
  const [now, setNow] = useState(() => Date.now());
  const feedEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => writeYou(you), [you]);

  // Every board loads up front (so replies to you show on every tab) and refreshes each minute while visible.
  useEffect(() => {
    let cancelled = false;
    const fetchAll = () => {
      for (const board of BOARDS) {
        apiFetch<Thread>(board.endpoint, { cache: "no-store" }).then(
          (data) => {
            if (!cancelled) setLoads((current) => ({ ...current, [board.key]: { data: { ...data, posts: data.posts ?? [] }, error: null, loading: false } }));
          },
          (reason) => {
            if (cancelled) return;
            const error = String((reason as Error).message || reason);
            setLoads((current) => ({ ...current, [board.key]: { data: error === board.notFound ? null : current[board.key].data, error, loading: false } }));
          },
        );
      }
    };
    fetchAll();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") fetchAll();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const unseenByBoard = useMemo(() => {
    const out = {} as Record<BoardKey, number[]>;
    for (const board of BOARDS) {
      const data = loads[board.key].data;
      const entry = you[board.key];
      if (!data || entry.threadId !== data.thread_id || !entry.youPostIds.length) {
        out[board.key] = [];
        continue;
      }
      const seen = new Set(entry.seenReplyIds);
      out[board.key] = [...repliesTo(entry.youPostIds, buildReplies(data.posts))].filter((id) => !seen.has(id));
    }
    return out;
  }, [loads, you]);

  // Replies on the open board stay tagged NEW until you leave it (another board, another page, or the tab goes hidden).
  const latest = useRef({ active, unseenByBoard });
  useEffect(() => {
    latest.current = { active, unseenByBoard };
  });
  const commitSeen = useCallback((key: BoardKey, persist = false) => {
    const ids = latest.current.unseenByBoard[key];
    if (!ids.length) return;
    const apply = (current: YouState): YouState => ({ ...current, [key]: { ...current[key], seenReplyIds: [...new Set([...current[key].seenReplyIds, ...ids])].sort((a, b) => a - b) } });
    if (persist) writeYou(apply(readYou()));
    else setYou(apply);
  }, []);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") commitSeen(latest.current.active);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      commitSeen(latest.current.active, true);
    };
  }, [commitSeen]);

  const switchBoard = (key: BoardKey) => {
    if (key === active) return;
    commitSeen(active);
    setPreview(null);
    setActive(key);
  };

  const board = BOARDS.find((entry) => entry.key === active)!;
  const state = loads[active];
  const thread = state.data;
  const posts = useMemo(() => thread?.posts ?? [], [thread]);
  const byId = useMemo(() => new Map(posts.map((post) => [post.post_id, post])), [posts]);
  const replies = useMemo(() => buildReplies(posts), [posts]);
  const mine = useMemo(() => {
    const entry = you[active];
    return new Set(thread && entry.threadId === thread.thread_id ? entry.youPostIds.filter((id) => byId.has(id)) : []);
  }, [active, byId, thread, you]);
  const toMe = useMemo(() => repliesTo([...mine], replies), [mine, replies]);
  const freshSet = useMemo(() => new Set(unseenByBoard[active]), [active, unseenByBoard]);
  const op = posts[0] ?? null;

  const mentionsByPost = useMemo(() => new Map(posts.map((post) => [post.post_id, matchTalents(post.text_content)])), [matchTalents, posts]);

  const stats = useMemo(() => {
    const times = posts.map((post) => post.timestamp).filter((value): value is number => Boolean(value));
    const last = times.length ? Math.max(...times) : null;
    const hourAgo = now / 1000 - 3600;
    const talents = new Map<string, { asset: MarketAsset; posts: number }>();
    for (const found of mentionsByPost.values()) {
      for (const asset of found) {
        const entry = talents.get(asset.symbol) ?? { asset, posts: 0 };
        entry.posts += 1;
        talents.set(asset.symbol, entry);
      }
    }
    return {
      images: posts.filter(hasMedia).length,
      lastHour: times.filter((time) => time >= hourAgo).length,
      started: op?.timestamp ?? null,
      last,
      talents: [...talents.values()].sort((a, b) => b.posts - a.posts || a.asset.symbol.localeCompare(b.asset.symbol)).slice(0, 10),
      mostReplied: [...posts]
        .map((post) => ({ post, count: replies.get(post.post_id)?.length ?? 0 }))
        .filter((entry) => entry.count > 1)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }, [mentionsByPost, now, op?.timestamp, posts, replies]);

  const feed = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = posts.slice(1).filter((post) => {
      const count = replies.get(post.post_id)?.length ?? 0;
      if (media === "media" && !hasMedia(post)) return false;
      if (media === "text" && hasMedia(post)) return false;
      if (onlyYou && !mine.has(post.post_id) && !toMe.has(post.post_id)) return false;
      if (highlights && !hasMedia(post) && !hasLinks(post) && count === 0 && !(mentionsByPost.get(post.post_id)?.size ?? 0)) return false;
      if (needle && !`${post.post_id} ${post.author} ${post.text_content}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (sort === "latest") list.reverse();
    if (sort === "replies") list.sort((a, b) => (replies.get(b.post_id)?.length ?? 0) - (replies.get(a.post_id)?.length ?? 0) || a.post_id - b.post_id);
    return list;
  }, [highlights, media, mentionsByPost, mine, onlyYou, posts, replies, search, sort, toMe]);
  const filtering = Boolean(search.trim() || media !== "all" || highlights || onlyYou);

  const toggleYou = useCallback(
    (postId: number) => {
      if (!thread) return;
      setYou((current) => {
        const entry = current[active];
        const ids = entry.threadId === thread.thread_id ? entry.youPostIds : [];
        const next = ids.includes(postId) ? ids.filter((id) => id !== postId) : [...ids, postId].sort((a, b) => a - b);
        // Replies already in the thread aren't news.
        const seen = [...repliesTo(next, replies)].sort((a, b) => a - b);
        return { ...current, [active]: { threadId: thread.thread_id, youPostIds: next, seenReplyIds: seen } };
      });
    },
    [active, replies, thread],
  );

  const showPreview = useCallback((postId: number, event: ReactMouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(440, window.innerWidth - 24);
    const x = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const above = rect.bottom > window.innerHeight * 0.6;
    setPreview({ postId, x, y: above ? window.innerHeight - rect.top + 6 : rect.bottom + 6, above });
  }, []);
  const hidePreview = useCallback(() => setPreview(null), []);

  const jumpTo = useCallback((postId: number) => {
    const el = document.getElementById(`p${postId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove(styles.flash);
    void el.offsetWidth;
    el.classList.add(styles.flash);
    setPreview(null);
  }, []);

  const quote = useCallback(
    (postId: number): ReactNode => {
      if (!byId.has(postId)) return <span className={styles.deadQuote}>&gt;&gt;{postId}</span>;
      return (
        <a
          href={`#p${postId}`}
          className={styles.quote}
          onMouseEnter={(event) => showPreview(postId, event)}
          onMouseLeave={hidePreview}
          onClick={(event) => {
            event.preventDefault();
            jumpTo(postId);
          }}
        >
          &gt;&gt;{postId}
          {op && postId === op.post_id ? " (OP)" : ""}
          {mine.has(postId) ? <b> (You)</b> : null}
        </a>
      );
    },
    [byId, hidePreview, jumpTo, mine, op, showPreview],
  );

  const options = useMemo<RichOptions>(() => ({ assets: assetMap, quote }), [assetMap, quote]);
  const previewPost = preview ? byId.get(preview.postId) : undefined;
  const unseenTotal = (key: BoardKey) => (key === active ? 0 : unseenByBoard[key].length);

  const renderPost = (post: Post, featured = false) => {
    const backlinks = replies.get(post.post_id) ?? [];
    const isMine = mine.has(post.post_id);
    const isToMe = toMe.has(post.post_id);
    const talents = mentionsByPost.get(post.post_id);
    const open = expanded.has(post.post_id);
    const thumb = featured ? post.op_cdn_image_url || post.thumbnail_url : post.thumbnail_url;
    return (
      <article key={post.post_id} id={`p${post.post_id}`} className={`${featured ? styles.op : styles.post} ${isMine ? styles.mine : ""} ${isToMe ? styles.toMe : ""}`}>
        <header className={styles.postHead}>
          <span className={styles.author}>{post.author || "Anonymous"}</span>
          <time dateTime={post.timestamp ? new Date(post.timestamp * 1000).toISOString() : undefined} title={post.timestamp ? new Date(post.timestamp * 1000).toLocaleString() : undefined} suppressHydrationWarning>
            {stamp(post.timestamp)}
          </time>
          <button type="button" className={styles.no} onClick={() => jumpTo(post.post_id)}>
            No.{post.post_id}
          </button>
          {isMine ? <span className={styles.youTag}>(YOU)</span> : null}
          {isToMe ? <span className={`${styles.replyTag} ${freshSet.has(post.post_id) ? styles.replyNew : ""}`}>{freshSet.has(post.post_id) ? "NEW REPLY TO YOU" : "REPLY TO YOU"}</span> : null}
          <button type="button" className={`${styles.markYou} ${isMine ? styles.markYouOn : ""}`} onClick={() => toggleYou(post.post_id)} aria-pressed={isMine} title="Mark this as your post to track replies to it">
            {isMine ? "✓ (You)" : "this is me"}
          </button>
        </header>
        <div className={`${styles.postBody} ${open ? styles.postOpen : ""}`}>
          {thumb ? (
            <button type="button" className={styles.thumb} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(post.post_id)) next.delete(post.post_id); else next.add(post.post_id); return next; })} aria-label={open ? "Shrink image" : "Expand image"}>
              {open && post.image_url ? isVideo(post.image_url) ? <video src={post.image_url} controls autoPlay loop /> : <img src={post.image_url} alt="" /> : <img src={thumb} alt="" loading="lazy" onError={hideBroken} />}
            </button>
          ) : null}
          {featured && thread?.subject ? <h2 className={styles.subject}>{thread.subject}</h2> : null}
          <RichText text={post.text_content} options={options} className={styles.text} />
        </div>
        {backlinks.length || talents?.size ? (
          <footer className={styles.postFoot}>
            {backlinks.length ? (
              <span className={styles.backlinks}>
                <small>{backlinks.length} {backlinks.length === 1 ? "reply" : "replies"}</small>
                {backlinks.slice(0, 12).map((id) => (
                  <a key={id} href={`#p${id}`} className={styles.quote} onMouseEnter={(event) => showPreview(id, event)} onMouseLeave={hidePreview} onClick={(event) => { event.preventDefault(); jumpTo(id); }}>
                    &gt;&gt;{id}
                    {mine.has(id) ? <b> (You)</b> : null}
                  </a>
                ))}
                {backlinks.length > 12 ? <small>+{backlinks.length - 12}</small> : null}
              </span>
            ) : null}
            {talents?.size ? (
              <span className={styles.postTalents}>
                {[...talents].slice(0, 4).map((asset) => (
                  <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} data-peek-stock={asset.symbol} prefetch={false}>
                    <Oshimark icon={asset.icon} symbol={asset.symbol} size={14} />
                    <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct, 1)}</span>
                  </Link>
                ))}
              </span>
            ) : null}
          </footer>
        ) : null}
      </article>
    );
  };

  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.top}>
          <div className={styles.title}>
            <span className={styles.kicker}>/VT/ WATCH</span>
            <h1>Threads</h1>
            <p>The live /vt/ generals, with talents and tickers linked to the market. Mark your posts to catch replies.</p>
          </div>
          <nav className={styles.boards} aria-label="Boards">
            {BOARDS.map((entry) => {
              const status = loads[entry.key];
              const count = unseenTotal(entry.key);
              return (
                <button key={entry.key} type="button" className={entry.key === active ? styles.boardOn : undefined} onClick={() => switchBoard(entry.key)} aria-pressed={entry.key === active}>
                  <b>{entry.label}</b>
                  <small>{status.loading && !status.data ? "…" : status.data ? `${status.data.posts.length}` : "—"}</small>
                  {count ? <i title={`${count} new ${count === 1 ? "reply" : "replies"} to you`}>{count}</i> : null}
                </button>
              );
            })}
          </nav>
        </header>

        <div className={styles.layout}>
          <main className={styles.main}>
            {state.loading && !thread ? <div className={styles.skeleton} aria-label="Loading thread"><span /><span /><span /></div> : null}
            {!state.loading && !thread ? (
              <div className={styles.empty}>
                {state.error === board.notFound ? `No live ${board.label} thread right now. The scraper picks up the next one when it's posted.` : `Couldn't load ${board.label} (${state.error ?? "unknown error"}).`}
              </div>
            ) : null}
            {thread && op ? (
              <>
                <div className={styles.threadBar}>
                  <span>
                    <b>{board.name}</b> · No.{thread.thread_id}
                  </span>
                  <a href={`https://boards.4channel.org/${encodeURIComponent(thread.board)}/thread/${thread.thread_id}`} target="_blank" rel="noreferrer noopener">
                    OPEN ON 4CHAN ↗
                  </a>
                </div>
                {renderPost(op, true)}
                {stats.talents.length ? (
                  <div className={styles.mobileTalents} aria-label="Talked about">
                    {stats.talents.slice(0, 8).map(({ asset, posts: count }) => (
                      <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} data-peek-stock={asset.symbol}>
                        <Oshimark icon={asset.icon} symbol={asset.symbol} size={14} />
                        <b>{asset.symbol}</b>
                        <small>{count}</small>
                      </Link>
                    ))}
                  </div>
                ) : null}


                <div className={styles.tools}>
                  <label className={styles.search}>
                    <span aria-hidden="true">⌕</span>
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posts" aria-label="Search posts" />
                  </label>
                  <div className={styles.seg} role="group" aria-label="Sort">
                    {(["oldest", "latest", "replies"] as Sort[]).map((value) => (
                      <button key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)}>
                        {value === "replies" ? "Most replied" : value === "oldest" ? "Thread order" : "Newest"}
                      </button>
                    ))}
                  </div>
                  <div className={styles.seg} role="group" aria-label="Media">
                    {(["all", "media", "text"] as Media[]).map((value) => (
                      <button key={value} type="button" aria-pressed={media === value} onClick={() => setMedia(value)}>
                        {value === "all" ? "All" : value === "media" ? "Images" : "Text"}
                      </button>
                    ))}
                  </div>
                  <button type="button" className={styles.chip} aria-pressed={highlights} onClick={() => setHighlights((value) => !value)} title="Posts with replies, images, links or a talent mention">
                    Highlights
                  </button>
                  {mine.size ? (
                    <button type="button" className={styles.chip} aria-pressed={onlyYou} onClick={() => setOnlyYou((value) => !value)}>
                      (You) + replies
                    </button>
                  ) : null}
                </div>

                <div className={styles.feedMeta}>
                  <span>
                    {filtering ? `${feed.length} of ${posts.length - 1} replies` : `${posts.length - 1} replies`} · refreshes every minute · updated{" "}
                    <span suppressHydrationWarning>{thread.updated_at ? new Date(thread.updated_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—"}</span>
                  </span>
                  <button type="button" onClick={() => feedEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" })}>
                    BOTTOM ↓
                  </button>
                </div>

                <div className={styles.feed}>{feed.map((post) => renderPost(post))}</div>
                {!feed.length ? <div className={styles.empty}>{filtering ? "No posts match these filters." : "No replies yet."}</div> : null}
                <div ref={feedEnd} className={styles.feedEnd}>
                  <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                    TOP ↑
                  </button>
                  <a href={`https://boards.4channel.org/${encodeURIComponent(thread.board)}/thread/${thread.thread_id}`} target="_blank" rel="noreferrer noopener">
                    Reply on 4chan ↗
                  </a>
                </div>
              </>
            ) : null}
          </main>

          <aside className={styles.rail} aria-label="Thread stats">
            <section className={styles.railSec}>
              <h2>This thread</h2>
              <dl className={styles.kv}>
                <dt>Replies</dt>
                <dd>{thread ? posts.length - 1 : "—"}</dd>
                <dt>Images</dt>
                <dd>{thread ? stats.images : "—"}</dd>
                <dt>Last hour</dt>
                <dd>{thread ? `${stats.lastHour} posts` : "—"}</dd>
                <dt>Started</dt>
                <dd suppressHydrationWarning>{ago(stats.started, now)}</dd>
                <dt>Last post</dt>
                <dd suppressHydrationWarning>{ago(stats.last, now)}</dd>
              </dl>
            </section>
            <section className={styles.railSec}>
              <h2>Talked about</h2>
              {stats.talents.length ? (
                stats.talents.map(({ asset, posts: count }) => (
                  <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.talent} data-peek-stock={asset.symbol}>
                    <Oshimark icon={asset.icon} symbol={asset.symbol} size={18} />
                    <b>{asset.symbol}</b>
                    <small>{count} {count === 1 ? "post" : "posts"}</small>
                    <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct, 1)}</span>
                  </Link>
                ))
              ) : (
                <p className={styles.dim}>{thread ? "Nobody's named a talent yet." : "—"}</p>
              )}
            </section>
            {stats.mostReplied.length ? (
              <section className={styles.railSec}>
                <h2>Most replied</h2>
                {stats.mostReplied.map(({ post, count }) => (
                  <button key={post.post_id} type="button" className={styles.hot} onClick={() => jumpTo(post.post_id)}>
                    <b>{count}</b>
                    <span>{post.text_content.replace(/>>\d+/g, "").trim().slice(0, 90) || `No.${post.post_id}`}</span>
                  </button>
                ))}
              </section>
            ) : null}
            <section className={styles.railSec}>
              <h2>Your posts</h2>
              <p className={styles.dim}>
                {mine.size ? `${mine.size} marked · ${toMe.size} ${toMe.size === 1 ? "reply" : "replies"} to you.` : "Hit “this is me” on your posts and we'll flag replies to them on every board, even when you're on another tab."}{" "}
                Saved in this browser only.
              </p>
            </section>
          </aside>
        </div>


        {preview && previewPost ? (
          <div className={styles.preview} style={{ left: preview.x, ...(preview.above ? { bottom: preview.y } : { top: preview.y }) }} role="tooltip">
            <div className={styles.postHead}>
              <span className={styles.author}>{previewPost.author || "Anonymous"}</span>
              <time suppressHydrationWarning>{stamp(previewPost.timestamp)}</time>
              <span className={styles.no}>No.{previewPost.post_id}</span>
              {mine.has(previewPost.post_id) ? <span className={styles.youTag}>(YOU)</span> : null}
            </div>
            <div className={styles.postBody}>
              {previewPost.thumbnail_url || (previewPost === op && previewPost.op_cdn_image_url) ? (
                <span className={styles.thumb}>
                  <img src={(previewPost === op && previewPost.op_cdn_image_url) || previewPost.thumbnail_url || ""} alt="" />
                </span>
              ) : null}
              <RichText text={previewPost.text_content} options={{ assets: assetMap, quote: (id) => <span className={styles.quote}>&gt;&gt;{id}</span> }} className={styles.text} />
            </div>
          </div>
        ) : null}
      </div>
    </SiteShell>
  );
}
