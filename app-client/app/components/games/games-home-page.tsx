"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { FaBolt, FaChartLine, FaClock, FaMoneyBillTrendUp, FaPlay, FaStar, FaTicket, FaUsers } from "react-icons/fa6";
import { HiSparkles } from "react-icons/hi2";
import { SiteShell } from "@/app/components/layout/site-shell";
import { fmtDate, fmtNumber } from "@/app/lib/format";
import {
  fetchGamesCatalog,
  fetchGameItemLocker,
  fetchGamesInventory,
  fetchGamesSummary,
} from "@/app/lib/games-api";
import type {
  GameCatalogEntry,
  GameItemLockerResponse,
  GameInventoryResponse,
  GamesSummary,
} from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/games-home-page.module.scss";

function typeLabel(gameType: GameCatalogEntry["game_type"]) {
  if (gameType === "gacha") return "Cosmetic Sink";
  if (gameType === "single_player") return "Solo Run";
  if (gameType === "pvp") return "PvP";
  return "Idle";
}

function statusClass(status: GameCatalogEntry["status"]) {
  if (status === "active") return styles.statusPillActive;
  if (status === "disabled") return styles.statusPillDisabled;
  return styles.statusPillDraft;
}

function statusCopy(status: GameCatalogEntry["status"]) {
  if (status === "active") return "Live";
  if (status === "disabled") return "Disabled";
  return "Draft";
}

function cardAccent(game: GameCatalogEntry) {
  if (game.key === "capsule-gacha") return "#f97316";
  if (game.game_type === "single_player") return "#0ea5e9";
  if (game.game_type === "pvp") return "#ef4444";
  return "#14b8a6";
}

function futureNote(game: GameCatalogEntry) {
  if (game.key === "capsule-gacha") return "Live now on its own game page.";
  if (game.key === "ticker-tap") return "Fast arcade runs for score.";
  if (game.key === "prediction-duel") return "Head-to-head prediction battles are coming.";
  return "More games are on the way.";
}

function gameSignal(game: GameCatalogEntry) {
  if (game.key === "capsule-gacha") return <HiSparkles />;
  if (game.game_type === "single_player") return <FaBolt />;
  if (game.game_type === "pvp") return <FaUsers />;
  return <FaPlay />;
}

function gameImagePrompt(game: GameCatalogEntry) {
  if (game.key === "capsule-gacha") {
    return "Image prompt: premium anime gacha banner for a finance arcade. Use the reference image of Ninomae Ina'nis as the featured character beside a glass capsule machine, collectible hats and items inside, teal and amber lighting, no text, wide 16:9 composition.";
  }
  if (game.key === "ticker-tap") {
    return "Image prompt: sleek arcade reaction game key art. Use the reference image of Vestia Zeta as the featured character tapping glowing ticker targets across neon lanes, dark teal trading floor, crisp UI lights, no text, wide 16:9 composition.";
  }
  if (game.key === "prediction-duel") {
    return "Image prompt: cinematic two-player prediction battle stage with market charts, split-screen rivals, restrained red and teal accents, no text, wide 16:9 composition.";
  }
  return "Image prompt: NASFAQ mini-game key art, polished dark fintech arcade style, collectible rewards, no text, wide 16:9 composition.";
}

function gameThumbnailUrl(game: GameCatalogEntry) {
  if (game.key === "capsule-gacha") return "/gacha-game-banner.png";
  if (game.key === "ticker-tap") return "/rhythm-game-banner.png";
  return null;
}

function gamePriceLine(game: GameCatalogEntry) {
  if (game.game_type === "pvp") {
    if (game.min_stake_cash !== null && game.max_stake_cash !== null) {
      return `${fmtNumber(game.min_stake_cash, "$")} to ${fmtNumber(game.max_stake_cash, "$")}`;
    }
    return "Stake based";
  }
  return fmtNumber(game.entry_fee_cash, "$");
}

const GACHA_GAME_BANNER_URL = "/gacha-game-banner.png";
const GAMES_HERO_IMAGE_URL = "/games-home-hero.png";

export function GamesHomePage() {
  const { user, initialized } = useAuth();
  const [catalog, setCatalog] = useState<GameCatalogEntry[]>([]);
  const [summary, setSummary] = useState<GamesSummary | null>(null);
  const [inventory, setInventory] = useState<GameInventoryResponse | null>(null);
  const [itemLocker, setItemLocker] = useState<GameItemLockerResponse | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  async function loadCatalog() {
    setIsLoadingCatalog(true);
    setCatalogError(null);
    try {
      setCatalog((await fetchGamesCatalog()).games);
    } catch (error) {
      setCatalogError(String((error as Error).message || error));
    } finally {
      setIsLoadingCatalog(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (!initialized) return;
    if (!user) {
      setSummary(null);
      setInventory(null);
      setItemLocker(null);
      setAccountError(null);
      return;
    }
    void (async () => {
      setIsLoadingAccount(true);
      setAccountError(null);
      try {
        const [summaryResult, inventoryResult, itemLockerResult] = await Promise.all([
          fetchGamesSummary(),
          fetchGamesInventory(),
          fetchGameItemLocker(),
        ]);
        setSummary(summaryResult);
        setInventory(inventoryResult);
        setItemLocker(itemLockerResult);
      } catch (error) {
        setAccountError(String((error as Error).message || error));
      } finally {
        setIsLoadingAccount(false);
      }
    })();
  }, [initialized, user]);

  const liveGames = catalog.filter((game) => game.status === "active");
  const capsuleGame = catalog.find((game) => game.key === "capsule-gacha") || null;
  const recentCosmetics = inventory?.cosmetics.slice(0, 4) || [];
  const recentLockerItems = itemLocker?.items.slice(0, 4) || [];
  const featuredGames = [...catalog].sort((a, b) => {
    if (a.key === "capsule-gacha") return -1;
    if (b.key === "capsule-gacha") return 1;
    return a.sort_order - b.sort_order;
  });

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero} style={{ "--hero-image": `url("${GAMES_HERO_IMAGE_URL}")` } as CSSProperties}>
          <div className={styles.heroContent}>
            <div className={styles.heroHeader}>
              <p className={styles.eyebrow}>NASFAQ arcade</p>
              <h1 className={styles.heroTitle}>NASFAQ Games</h1>
              <p className={styles.heroCopy}>
                Pick a quick session, spend from your NASFAQ balance, and collect profile cosmetics that carry back into the rest of the site.
              </p>
              <div className={styles.heroActions}>
                <Link href="/games/capsule-gacha" className={styles.heroButton}>Start with Capsule Gacha</Link>
                <Link href={user ? "/games/item-locker" : "/login"} className={styles.heroButtonMuted}>
                  {user ? "View my locker" : "Sign in to play"}
                </Link>
              </div>
            </div>
          </div>

          <div className={styles.heroMetrics}>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>
                <FaTicket />
                Catalog
              </span>
              <strong className={styles.metricValue}>{isLoadingCatalog ? "…" : catalog.length}</strong>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>
                <FaBolt />
                Live Now
              </span>
              <strong className={styles.metricValue}>{isLoadingCatalog ? "…" : liveGames.length}</strong>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>
                <FaMoneyBillTrendUp />
                Wallet
              </span>
              <strong className={styles.metricValue}>
                {user && summary ? fmtNumber(summary.cash_balance, "$") : user ? "Loading…" : "Sign in"}
              </strong>
            </article>
          </div>
        </section>

        <section className={styles.featurePanel}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>Featured Launch: Capsule Gacha</h2>
              <p className={styles.sectionCopy}>
                The first live game is a quick pull for collectible locker rewards.
              </p>
            </div>
            <FaChartLine />
          </div>

          <div className={styles.liveGrid}>
            <article className={styles.launchVisual}>
              <div
                className={`${styles.launchArt} ${styles.launchArtWithImage}`.trim()}
                style={{ "--launch-thumbnail": `url("${GACHA_GAME_BANNER_URL}")` } as CSSProperties}
              >
                <span className={styles.artLabel}>Capsule Gacha thumbnail</span>
              </div>
              <div className={styles.launchStats}>
                <div>
                  <span className={styles.metaLabel}>Entry</span>
                  <strong>{capsuleGame ? fmtNumber(capsuleGame.entry_fee_cash, "$") : "$50.00"}</strong>
                </div>
                <div>
                  <span className={styles.metaLabel}>Rewards</span>
                  <strong>Hats, items, customization</strong>
                </div>
              </div>
            </article>

            <article className={styles.resultCard}>
              <div className={styles.featureCopy}>
                <span className={styles.eyebrow}>How it works</span>
                <h3 className={styles.featureTitle}>Spend cash. Reveal a prize. Build your locker.</h3>
                <p className={styles.sectionCopy}>
                  Each paid pull reveals one reward and adds it to your item locker.
                </p>
              </div>
              <div className={styles.featureSteps}>
                <div className={styles.stepRow}>
                  <FaTicket />
                  <span>Buy one pull from your NASFAQ balance.</span>
                </div>
                <div className={styles.stepRow}>
                  <FaStar />
                  <span>Win hats, items, or profile customization.</span>
                </div>
                <div className={styles.stepRow}>
                  <HiSparkles />
                  <span>Open your locker to view everything you have won.</span>
                </div>
              </div>
              <Link href="/games/capsule-gacha" className={styles.pullButton}>
                <FaPlay />
                <span>{user ? "Open Capsule Gacha" : "Preview Capsule Gacha"}</span>
              </Link>
            </article>
          </div>
          {recentCosmetics.length ? (
            <div className={styles.inventoryStrip}>
              {recentCosmetics.map((cosmetic) => (
                <article key={cosmetic.id} className={styles.inventoryItem}>
                  <strong className={styles.itemTitle}>{String(cosmetic.metadata.display_name || cosmetic.cosmetic_key)}</strong>
                  <span className={styles.itemMeta}>{cosmetic.rarity} · {cosmetic.cosmetic_type} · {fmtDate(cosmetic.granted_at)}</span>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <div className={styles.contentGrid}>
          <section className={styles.panelLarge}>
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>Choose Your Next Session</h2>
                <p className={styles.sectionCopy}>
                  Each game explains the cost, status, and best reason to open it before you spend anything.
                </p>
              </div>
            </div>

            {catalogError ? <div className={`${styles.statusMessage} ${styles.statusError}`}>Catalog error: {catalogError}</div> : null}

            <div className={styles.catalogGrid}>
              {featuredGames.map((game, index) => {
                const thumbnailUrl = gameThumbnailUrl(game);

                return (
                  <article
                    key={game.key}
                    id={game.key}
                    className={`${styles.gameCard} ${(index === 0 || game.key === "ticker-tap") ? styles.gameCardFeatured : ""}`.trim()}
                    style={{ "--card-accent": cardAccent(game) } as CSSProperties}
                  >
                    <div
                      className={`${styles.gameArt} ${thumbnailUrl ? styles.gameArtWithImage : ""}`.trim()}
                      style={thumbnailUrl ? { "--game-thumbnail": `url("${thumbnailUrl}")` } as CSSProperties : undefined}
                    >
                      {thumbnailUrl ? (
                        <span className={styles.artLabel}>Game thumbnail</span>
                      ) : (
                        <div>
                          <span className={styles.artLabel}>Asset placeholder</span>
                          <p>{gameImagePrompt(game)}</p>
                        </div>
                      )}
                    </div>
                    <div className={styles.gameBody}>
                      <div className={styles.gameCardTop}>
                        <div className={styles.badgeRow}>
                          <span className={styles.typePill}>{typeLabel(game.game_type)}</span>
                          <span className={`${styles.statusPill} ${statusClass(game.status)}`.trim()}>{statusCopy(game.status)}</span>
                        </div>
                        <span className={styles.gameSignal}>{gameSignal(game)}</span>
                      </div>
                      <div>
                        <h3 className={styles.gameTitle}>{game.name}</h3>
                        <p className={styles.gameDescription}>{game.description}</p>
                      </div>
                      <div className={styles.metaGrid}>
                        <div className={styles.metaCard}>
                          <span className={styles.metaLabel}>Cost</span>
                          <strong className={styles.metaValue}>{gamePriceLine(game)}</strong>
                          <span className={styles.metaHint}>
                            {game.game_type === "gacha" ? "Per pull." : game.game_type === "pvp" ? "Stake band." : "Per run."}
                          </span>
                        </div>
                        <div className={styles.metaCard}>
                          <span className={styles.metaLabel}>Best for</span>
                          <strong className={styles.metaValue}>
                            {game.game_type === "gacha" ? "Cosmetics" : game.game_type === "pvp" ? "Duels" : "Scores"}
                          </strong>
                          <span className={styles.metaHint}>Clear outcome, short session.</span>
                        </div>
                      </div>
                      <div className={styles.cardFooter}>
                        <span className={styles.cardNote}>{futureNote(game)}</span>
                        <Link href={`/games/${encodeURIComponent(game.key)}`} className={styles.cardAction}>
                          {game.status === "active" ? "Open game" : "View preview"}
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
              {!catalog.length && !isLoadingCatalog ? <div className={styles.empty}>No games have been synced yet.</div> : null}
            </div>
          </section>

          <aside className={styles.sidebar}>
            {user ? (
              <>
                <section className={styles.panel}>
                  <div className={styles.sectionHead}>
                    <div>
                      <h2 className={styles.sectionTitle}>Player Snapshot</h2>
                      <p className={styles.sectionCopy}>Your balance, cosmetics, and latest activity.</p>
                    </div>
                    <FaMoneyBillTrendUp />
                  </div>
                  {accountError ? <div className={`${styles.statusMessage} ${styles.statusWarn}`}>Account warning: {accountError}</div> : null}
                  <strong className={styles.walletValue}>{summary ? fmtNumber(summary.cash_balance, "$") : "Loading…"}</strong>
                  <span className={styles.walletMeta}>
                    {isLoadingAccount ? "Refreshing…" : "Ready to spend."}
                  </span>
                  <div className={styles.miniGrid}>
                    <div className={styles.miniRow}>
                      <span className={styles.miniLabel}>Owned cosmetics</span>
                      <strong className={styles.miniValue}>{summary?.inventory.total_cosmetics ?? 0}</strong>
                    </div>
                    <div className={styles.miniRow}>
                      <span className={styles.miniLabel}>Recent sessions</span>
                      <strong className={styles.miniValue}>{summary?.recent_sessions.length ?? 0}</strong>
                    </div>
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.sectionHead}>
                    <div>
                      <h2 className={styles.sectionTitle}>Current Locker</h2>
                    </div>
                    <HiSparkles />
                  </div>
                  <div className={styles.equippedList}>
                    {recentLockerItems.length ? recentLockerItems.map((item) => (
                      <article key={item.id} className={styles.equippedItem}>
                        <strong className={styles.itemTitle}>{item.reward.display_name || item.reward_key}</strong>
                        <span className={styles.itemMeta}>
                          {item.reward.rarity} · {item.reward.type} · {fmtDate(item.created_at)}
                        </span>
                      </article>
                    )) : <div className={styles.empty}>No item wins yet.</div>}
                  </div>
                  <Link href="/games/item-locker" className={styles.panelLink}>View all items</Link>
                </section>

                <section className={styles.panel}>
                  <div className={styles.sectionHead}>
                    <div>
                      <h2 className={styles.sectionTitle}>Recent Activity</h2>
                      <p className={styles.sectionCopy}>Your latest game sessions.</p>
                    </div>
                    <FaClock />
                  </div>
                  <div className={styles.sessionList}>
                    {summary?.recent_sessions.length ? summary.recent_sessions.map((session) => (
                      <article key={session.id} className={styles.sessionItem}>
                        <strong className={styles.itemTitle}>{session.game_name}</strong>
                        <span className={styles.itemMeta}>
                          {session.status} · Fee {fmtNumber(session.entry_fee_cash, "$")} · {fmtDate(session.created_at)}
                        </span>
                      </article>
                    )) : <div className={styles.empty}>No game sessions recorded yet.</div>}
                  </div>
                </section>
              </>
            ) : (
              <section className={styles.ctaCard}>
                <h2 className={styles.ctaTitle}>Sign in to unlock the hub.</h2>
                <p className={styles.ctaCopy}>
                  Your wallet, locker, and session history live here once you are signed in.
                </p>
                <Link href="/login" className={styles.heroButton}>Sign In</Link>
              </section>
            )}
          </aside>
        </div>
      </div>
    </SiteShell>
  );
}
