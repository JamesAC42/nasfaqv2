"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { Tile, TileRow, rowFromExample, type TileRowProps } from "@/app/components/games/mahjong/tile";
import { tilesFrom } from "@/app/lib/games/mahjong/tiles";
import type { ExampleCall, YakuExample } from "@/app/lib/games/mahjong/yaku";
import styles from "@/app/components/games/mahjong/learn/learn.module.scss";

export const LEARN_PAGES = [
  { href: "/games/mahjong/learn", label: "Start", exact: true },
  { href: "/games/mahjong/learn/tutorial", label: "Walkthrough" },
  { href: "/games/mahjong/learn/rules", label: "Rules" },
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
