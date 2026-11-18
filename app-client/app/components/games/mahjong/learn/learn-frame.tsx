"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { FiAlertTriangle, FiBookmark, FiZap } from "react-icons/fi";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { Tile, TileRow, rowFromExample, type TileRowProps } from "@/app/components/games/mahjong/tile";
import { tilesFrom } from "@/app/lib/games/mahjong/tiles";
import type { ExampleCall, YakuExample } from "@/app/lib/games/mahjong/yaku";
import styles from "@/app/components/games/mahjong/learn/learn.module.scss";

export const LEARN_PAGES = [
  { href: "/games/mahjong/learn", label: "Start", exact: true },
  { href: "/games/mahjong/learn/tutorial", label: "Walkthrough" },
  { href: "/games/mahjong/learn/rules", label: "Rules" },
  { href: "/games/mahjong/learn/easy-patterns", label: "Easy patterns" },
  { href: "/games/mahjong/learn/yaku", label: "Yaku" },
  { href: "/games/mahjong/learn/glossary", label: "Glossary" },
  { href: "/games/mahjong/learn/tips", label: "Tips" },
] as const;

/** The games frame every learning page sits in, with the sub-nav for the guide. */
export function LearnFrame({ kicker = "Mahjong · learn", title, blurb, children }: { kicker?: string; title: string; blurb?: ReactNode; children: ReactNode }) {
  const pathname = usePathname() || "";
  return (
    <GamesFrame
      kicker={kicker}
      title={title}
      blurb={blurb}
      aside={
        <Link href="/games/mahjong" className={styles.subnavBack}>
          ← Mahjong lobby
        </Link>
      }
    >
      <div className={styles.page}>
        <nav className={styles.subnav} aria-label="Learn mahjong">
          {LEARN_PAGES.map((page) => {
            const active = "exact" in page ? pathname === page.href : pathname === page.href || pathname.startsWith(`${page.href}/`);
            return (
              <Link key={page.href} href={page.href} aria-current={active ? "page" : undefined}>
                {page.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </GamesFrame>
  );
}

/** The top of a reference page: a few "in short" lines beside the page's art slot. */
export function PageIntro({ art, points }: { art: ReactNode; points: ReactNode[] }) {
  return (
    <div className={styles.intro}>
      <div className={styles.inShort}>
        <span>In short</span>
        <ul>
          {points.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      </div>
      <div className={styles.introArt}>{art}</div>
    </div>
  );
}

const CALLOUT = {
  remember: { tag: "Remember", icon: <FiBookmark aria-hidden="true" /> },
  watch: { tag: "Watch out", icon: <FiAlertTriangle aria-hidden="true" /> },
  try: { tag: "Try this", icon: <FiZap aria-hidden="true" /> },
} as const;

/** A key point set apart: "Remember", "Watch out" or "Try this". Its words restate the page's own. */
export function Callout({ tone = "remember", title, children }: { tone?: keyof typeof CALLOUT; title?: string; children: ReactNode }) {
  const kind = CALLOUT[tone];
  return (
    <aside className={styles.callout} data-tone={tone}>
      {kind.icon}
      <div>
        <span className={styles.calloutTag}>{title ?? kind.tag}</span>
        {children}
      </div>
    </aside>
  );
}

/** A numbered list with round step markers. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className={styles.steps}>{children}</ol>;
}

/** Something hidden behind a button until the reader asks for it. */
export function Reveal({ label = "Show the answer", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.reveal}>
      {open ? (
        <div className={styles.revealed} role="status">
          {children}
        </div>
      ) : (
        <button type="button" className={styles.revealButton} onClick={() => setOpen(true)}>
          {label}
        </button>
      )}
    </div>
  );
}

/** Which of `ids` is the section being read: the last one whose top has passed the upper third of the screen. */
function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("|");
  useEffect(() => {
    const list = key.split("|");
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.innerHeight * 0.3;
      let current: string | null = null;
      for (const id of list) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= line) current = id;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atEnd) {
        const visible = list.filter((id) => document.getElementById(id));
        current = visible[visible.length - 1] ?? current;
      }
      setActive(current ?? list[0] ?? null);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);
  return active;
}

/**
 * A long page with an in-page nav: a sticky list beside the content on wide screens, a sticky strip
 * of links above it on narrow ones. The link for the section being read is marked.
 */
export function WithToc({ items, label = "On this page", children }: { items: readonly (readonly [string, string])[]; label?: string; children: ReactNode }) {
  const active = useActiveSection(items.map(([id]) => id));
  useEffect(() => {
    // Keep the marked link in view in the phone strip.
    if (!active) return;
    const link = document.querySelector<HTMLAnchorElement>(`[data-toc-link="${active}"]`);
    const strip = link?.closest("ol");
    if (link && strip && strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: link.offsetLeft - 16, behavior: "auto" });
  }, [active]);
  return (
    <div className={styles.withToc}>
      <nav className={styles.toc} aria-label={label}>
        <span>{label}</span>
        <ol>
          {items.map(([id, text]) => (
            <li key={id}>
              <a href={`#${id}`} data-toc-link={id} aria-current={active === id ? "true" : undefined}>
                {text}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** A pictured hand with a line under it. */
export function Picture({ label, caption, children }: { label?: string; caption?: ReactNode; children: ReactNode }) {
  return (
    <figure className={styles.picture} style={{ marginInline: 0 }}>
      {label ? <span className={styles.pictureLabel}>{label}</span> : null}
      {children}
      {caption ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
    </figure>
  );
}

/** Tiles from notation, sized for a phone: `gaps` puts a space after those tile indexes. */
export function Hand({ notation, size = 30, gaps, ...rest }: { notation: string; size?: number; gaps?: number[] } & Omit<TileRowProps, "notation" | "tiles" | "gapAfter" | "size">) {
  return <TileRow notation={notation} size={size} gapAfter={gaps} {...rest} />;
}

/** A yaku-style example (hand, calls, winning tile) as a picture. */
export function ExampleHand({ example, size = 26 }: { example: YakuExample; size?: number }) {
  return <TileRow {...rowFromExample(example)} size={size} />;
}

/** One tile at a size, for inline prose. */
export function Inline({ kind, red, size = 22 }: { kind: number; red?: boolean; size?: number }) {
  return <Tile kind={kind} red={red} size={size} />;
}

/** Called sets on their own, the taken tile lying sideways. */
export function MeldRow({ calls, size = 26 }: { calls: ExampleCall[]; size?: number }) {
  const used = new Set<number>();
  const melds = calls.map((call) => ({ tiles: tilesFrom(call.tiles, used), type: call.type, called: call.called }));
  return <TileRow tiles={[]} melds={melds} size={size} />;
}
