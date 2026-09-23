export type NavLink = { href: string; label: string; hint?: string };

/** A direct link (href) or a menu of links. */
export type NavGroup = { key: string; label: string; href?: string; links?: NavLink[] };

// Top-level navigation. Groups open a menu; items with href are direct links.
export const NAV: NavGroup[] = [
  { key: "home", label: "Home", href: "/" },
  { key: "stocks", label: "Stocks", href: "/stocks" },
  {
    key: "market",
    label: "Market",
    links: [
      { href: "/market", label: "Daily report", hint: "Settlement movers and fair value changes" },
      { href: "/finance/activity", label: "Activity", hint: "Every fill as it happens" },
      { href: "/indexes", label: "Indexes", hint: "Generations and branches as one number" },
      { href: "/finance/rankings", label: "Rankings", hint: "Talents ranked by subs, views and streams" },
    ],
  },
  {
    key: "news",
    label: "News",
    links: [
      { href: "/news", label: "HoloNews", hint: "Headlines and what they did to the price" },
      { href: "/livestreams", label: "Livestreams", hint: "Who's on air right now" },
      { href: "/articles", label: "Articles", hint: "Player-written DD and shitposts" },
    ],
  },
  {
    key: "community",
    label: "Community",
    links: [
      { href: "/chat", label: "Chat", hint: "The floor's group chat" },
      { href: "/predictions", label: "Predictions", hint: "Bet on what happens next" },
      { href: "/threads", label: "/vt/ threads", hint: "The general, mirrored" },
      { href: "/leaderboard", label: "Leaderboard", hint: "Net worth rankings, friends and rivals" },
      { href: "/oshiboard", label: "Oshiboard", hint: "Each talent's biggest bagholders" },
    ],
  },
  { key: "games", label: "Games", href: "/games" },
  { key: "guide", label: "How to play", href: "/how-to-play" },
];

export const MOBILE_TABS: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/stocks", label: "Stocks" },
  { href: "/leaderboard", label: "Ranks" },
  { href: "/chat", label: "Chat" },
];

export function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isGroupActive(pathname: string, group: NavGroup) {
  if (group.href) return isActivePath(pathname, group.href);
  return (group.links ?? []).some((link) => isActivePath(pathname, link.href));
}
