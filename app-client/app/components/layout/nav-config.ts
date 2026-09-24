export type NavLink = { href: string; label: string; hint?: string };

/** A direct link (href) or a menu of links. */
export type NavGroup = { key: string; label: string; href?: string; links?: NavLink[] };

// Top-level navigation. Groups open a menu; items with href are direct links.
export const NAV: NavGroup[] = [
  { key: "home", label: "Home", href: "/" },
  { key: "market", label: "Market", href: "/market" },
  { key: "stocks", label: "Stocks", href: "/stocks" },
  {
    key: "community",
    label: "Community",
    links: [
      { href: "/leaderboard", label: "Leaderboard", hint: "Net worth, friends, rivals and oshiboards" },
      { href: "/chat", label: "Chat", hint: "The floor's group chat" },
      { href: "/predictions", label: "Predictions", hint: "Bet on what happens next" },
      { href: "/threads", label: "/vt/ threads", hint: "The general, mirrored" },
      { href: "/articles", label: "Articles", hint: "Player-written DD and shitposts" },
      { href: "/news", label: "HoloNews archive", hint: "Every headline and what it did to the price" },
      { href: "/livestreams", label: "Livestreams", hint: "Who's on air right now" },
    ],
  },
  { key: "games", label: "Games", href: "/games" },
  { key: "guide", label: "How to play", href: "/how-to-play" },
];

export const MOBILE_TABS: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/market", label: "Market" },
  { href: "/stocks", label: "Stocks" },
  { href: "/leaderboard", label: "Ranks" },
];

export function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isGroupActive(pathname: string, group: NavGroup) {
  if (group.href) return isActivePath(pathname, group.href);
  return (group.links ?? []).some((link) => isActivePath(pathname, link.href));
}
