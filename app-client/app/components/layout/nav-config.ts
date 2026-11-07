/** `feature`: shown only while that feature flag is on for the viewer (api/src/features). */
export type NavLink = { href: string; label: string; hint?: string; feature?: string };

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
      { href: "/wire", label: "The Wire", hint: "Everything that happened, and who /vt/ is talking about" },
      { href: "/threads", label: "/vt/ threads", hint: "The general, mirrored" },
      { href: "/articles", label: "Articles", hint: "HoloNews headlines and player-written DD" },
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

/** The navigation without links behind a feature flag this viewer doesn't have (flags from useFeatures). */
export function navFor(flags: Record<string, boolean>, nav: NavGroup[] = NAV): NavGroup[] {
  return nav.map((group) => (group.links ? { ...group, links: group.links.filter((link) => !link.feature || flags[link.feature] === true) } : group));
}

export function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** In a menu, only the most specific matching link is current (a link to /a/b, not one to /a too). */
export function isActiveLink(pathname: string, href: string, links: NavLink[]) {
  if (!isActivePath(pathname, href)) return false;
  return !links.some((other) => other.href !== href && other.href.startsWith(`${href}/`) && isActivePath(pathname, other.href));
}

export function isGroupActive(pathname: string, group: NavGroup) {
  if (group.href) return isActivePath(pathname, group.href);
  return (group.links ?? []).some((link) => isActivePath(pathname, link.href));
}
