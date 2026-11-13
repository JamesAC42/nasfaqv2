import { BADGES, badgeText, sortBadges } from "@/app/lib/games/mahjong/badges";
import type { BadgeRow } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/beta/beta.module.scss";

/** A small "Beta" tag for headings, the arcade tile and nav items. */
export function BetaTag({ className }: { className?: string }) {
  return (
    <span className={[styles.beta, className].filter(Boolean).join(" ")} title="Mahjong is in beta: play chips only, no Cash or Credit changes hands.">
      Beta
    </span>
  );
}

// Code-drawn badge marks: a ring and one glyph each. No image files.
const GLYPHS: Record<string, React.ReactNode> = {
  // A tile with a dot: a game played.
  first_game: (
    <>
      <rect x="9.5" y="7.5" width="9" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="14" cy="14" r="2.2" fill="currentColor" />
    </>
  ),
  // A check mark: a win.
  first_win: <path d="M8.5 14.5l3.8 3.8 7.2-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />,
  // A riichi stick.
  first_riichi_win: (
    <>
      <rect x="7" y="11.7" width="14" height="4.6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="14" cy="14" r="1.2" fill="currentColor" />
    </>
  ),
  // An arrow down into a line: a draw.
  first_tsumo: <path d="M14 7.5v9M10 13l4 4 4-4M9 20.5h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />,
  // Three rising bars: a limit hand.
  first_mangan: <path d="M9 20.5v-4M14 20.5v-8M19 20.5v-12" fill="none" stroke="currentColor" strokeWidth="2.6" />,
  // A numeral 1: first place.
  first_table_win: <path d="M11.5 11l3-2.5V20M11 20h6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />,
};

/** One badge mark. `earned={false}` draws it faint, for a shelf of everything still to get. */
export function BadgeMark({ badge, size = 28, earned = true }: { badge: string; size?: number; earned?: boolean }) {
  return (
    <svg className={styles.mark} data-earned={earned || undefined} width={size} height={size} viewBox="0 0 28 28" role="img" aria-label={badgeText(badge).name}>
      <circle cx="14" cy="14" r="12.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      {GLYPHS[badge] ?? <circle cx="14" cy="14" r="3" fill="currentColor" />}
    </svg>
  );
}

const earnedOn = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** A compact row of earned badges, names on hover. Nothing when there are none. */
export function BadgeStrip({ badges }: { badges: readonly BadgeRow[] | null | undefined }) {
  if (!badges?.length) return null;
  return (
    <ul className={styles.strip} aria-label="Badges">
      {sortBadges(badges).map((row) => (
        <li key={row.badge} title={`${badgeText(row.badge).name}: ${badgeText(row.badge).description}`}>
          <BadgeMark badge={row.badge} size={24} />
          <span>{badgeText(row.badge).name}</span>
        </li>
      ))}
    </ul>
  );
}

/** Every badge with what it takes, earned ones lit and dated, the rest faint. */
export function BadgeShelf({ badges }: { badges: readonly BadgeRow[] | null | undefined }) {
  const earned = new Map((badges ?? []).map((row) => [row.badge, row]));
  const extra = (badges ?? []).filter((row) => !BADGES.some((badge) => badge.key === row.badge));
  const rows = [...BADGES.map((badge) => ({ key: badge.key as string, row: earned.get(badge.key) })), ...extra.map((row) => ({ key: row.badge, row }))];
  return (
    <ul className={styles.shelf} aria-label="Badges">
      {rows.map(({ key, row }) => (
        <li key={key} data-earned={row ? "" : undefined}>
          <BadgeMark badge={key} size={32} earned={Boolean(row)} />
          <span className={styles.shelfText}>
            <b>{badgeText(key).name}</b>
            <small>{badgeText(key).description}</small>
          </span>
          {row ? <time className={styles.shelfDate} dateTime={row.earned_at}>{earnedOn(row.earned_at)}</time> : null}
        </li>
      ))}
    </ul>
  );
}
