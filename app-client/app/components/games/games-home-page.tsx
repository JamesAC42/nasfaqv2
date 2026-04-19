"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { FaBolt, FaChartLine, FaClock, FaMoneyBillTrendUp, FaPlay, FaUsers } from "react-icons/fa6";
import { HiSparkles } from "react-icons/hi2";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtNumber } from "@/app/lib/format";
import {
  normalizeGameCatalogResponse,
  normalizeGameInventoryResponse,
  normalizeGamesSummary,
} from "@/app/lib/normalizers";
import type {
  GameCatalogEntry,
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
  if (game.key === "ticker-tap") return "Arcade run UI is the next milestone.";
  if (game.key === "prediction-duel") return "Async stake matches land after solo play.";
  return "Reserved for the next games wave.";
}

function gameSignal(game: GameCatalogEntry) {
  if (game.key === "capsule-gacha") return <HiSparkles />;
  if (game.game_type === "single_player") return <FaBolt />;
  if (game.game_type === "pvp") return <FaUsers />;
  return <FaPlay />;
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

export function GamesHomePage() {
  const { user, initialized } = useAuth();
  const [catalog, setCatalog] = useState<GameCatalogEntry[]>([]);
  const [summary, setSummary] = useState<GamesSummary | null>(null);
  const [inventory, setInventory] = useState<GameInventoryResponse | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  async function loadCatalog() {
    setIsLoadingCatalog(true);
    setCatalogError(null);
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/games/catalog", { cache: "no-store" });
      setCatalog(normalizeGameCatalogResponse(result).games);
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
      setAccountError(null);
      return;
    }
    void (async () => {
      setIsLoadingAccount(true);
      setAccountError(null);
      try {
        const [summaryResult, inventoryResult] = await Promise.all([
          apiFetch<Record<string, unknown>>("/api/games/me/summary", { cache: "no-store" }),
          apiFetch<Record<string, unknown>>("/api/games/me/inventory", { cache: "no-store" }),
        ]);
        setSummary(normalizeGamesSummary(summaryResult));
        setInventory(normalizeGameInventoryResponse(inventoryResult));
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

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <div className={styles.heroHeader}>
            <p className={styles.eyebrow}>Nasfaq Games</p>
            <h1 className={styles.heroTitle}>Keep the cash moving after the bell.</h1>
            <p className={styles.heroCopy}>
              NASFAQ Games is the retention lane for short runs, cosmetic sinks, and later PvP contests. The UI lives in
              `app-client` for now, but every interaction already targets the shared `/api/games/*` contract so this
              can move into a dedicated client later without reworking the backend.
            </p>
            <div className={styles.heroActions}>
              <Link href="/games/capsule-gacha" className={styles.heroButton}>Open Capsule Gacha</Link>
              <Link href={user ? "/profile" : "/login"} className={styles.heroButtonMuted}>
                {user ? "View Locker Context" : "Sign In To Play"}
              </Link>
            </div>
          </div>
          <div className={styles.heroMetrics}>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Catalog</span>
              <strong className={styles.metricValue}>{isLoadingCatalog ? "…" : catalog.length}</strong>
              <span className={styles.metricMeta}>Backend-defined games synced from `/api`.</span>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Live Now</span>
              <strong className={styles.metricValue}>{isLoadingCatalog ? "…" : liveGames.length}</strong>
              <span className={styles.metricMeta}>Only the gacha flow is fully wired in the UI today.</span>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Wallet</span>
              <strong className={styles.metricValue}>
                {user && summary ? fmtNumber(summary.cash_balance, "$") : user ? "Loading…" : "Connected"}
              </strong>
              <span className={styles.metricMeta}>One shared NASFAQ balance across market and games.</span>
            </article>
          </div>
        </section>

        <div className={styles.contentGrid}>
          <section className={styles.panel}>
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>Games Roadmap</h2>
                <p className={styles.sectionCopy}>
                  This hub lists the game catalog exactly the way the backend sees it. That keeps the page portable if
                  the games surface becomes its own client later.
                </p>
              </div>
            </div>

            {catalogError ? <div className={`${styles.statusMessage} ${styles.statusError}`}>Catalog error: {catalogError}</div> : null}

            <div className={styles.catalogGrid}>
              {catalog.map((game) => (
                <article
                  key={game.key}
                  id={game.key}
                  className={styles.gameCard}
                  style={{ "--card-accent": cardAccent(game) } as CSSProperties}
                >
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
                      <span className={styles.metaLabel}>Entry</span>
                      <strong className={styles.metaValue}>{gamePriceLine(game)}</strong>
                      <span className={styles.metaHint}>
                        {game.game_type === "gacha" ? "Direct money sink." : game.game_type === "pvp" ? "Stake band." : "Pay per run."}
                      </span>
                    </div>
                    <div className={styles.metaCard}>
                      <span className={styles.metaLabel}>Lane</span>
                      <strong className={styles.metaValue}>{game.game_type.replace("_", " ")}</strong>
                      <span className={styles.metaHint}>Portable API-first domain model.</span>
                    </div>
                  </div>
                  <div className={styles.cardFooter}>
                    <span className={styles.cardNote}>{futureNote(game)}</span>
                    <Link href={`/games/${encodeURIComponent(game.key)}`} className={styles.cardAction}>
                      {game.status === "active" ? "Open game" : "View status"} →
                    </Link>
                  </div>
                </article>
              ))}
              {!catalog.length && !isLoadingCatalog ? <div className={styles.empty}>No games have been synced yet.</div> : null}
            </div>
          </section>

          <aside className={styles.sidebar}>
            {user ? (
              <>
                <section className={styles.panel}>
                  <div className={styles.sectionHead}>
                    <div>
                      <h2 className={styles.sectionTitle}>Wallet Snapshot</h2>
                      <p className={styles.sectionCopy}>Shared market and games currency, no second wallet.</p>
                    </div>
                    <FaMoneyBillTrendUp />
                  </div>
                  {accountError ? <div className={`${styles.statusMessage} ${styles.statusWarn}`}>Account warning: {accountError}</div> : null}
                  <strong className={styles.walletValue}>{summary ? fmtNumber(summary.cash_balance, "$") : "Loading…"}</strong>
                  <span className={styles.walletMeta}>
                    {isLoadingAccount ? "Refreshing games account…" : "Pulled from `/api/games/me/summary`."}
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
                      <h2 className={styles.sectionTitle}>Equipped Now</h2>
                      <p className={styles.sectionCopy}>Current cosmetics that can later flow into profile and chat.</p>
                    </div>
                    <HiSparkles />
                  </div>
                  <div className={styles.equippedList}>
                    {summary?.inventory.equipped.length ? summary.inventory.equipped.map((item) => (
                      <article key={item.slot_key} className={styles.equippedItem}>
                        <strong className={styles.itemTitle}>{String(item.cosmetic.metadata.display_name || item.cosmetic.cosmetic_key)}</strong>
                        <span className={styles.itemMeta}>
                          {item.slot_key} · {item.cosmetic.rarity} · {item.cosmetic.cosmetic_type}
                        </span>
                      </article>
                    )) : <div className={styles.empty}>No cosmetics equipped yet.</div>}
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.sectionHead}>
                    <div>
                      <h2 className={styles.sectionTitle}>Recent Sessions</h2>
                      <p className={styles.sectionCopy}>Last runs recorded by the games backend.</p>
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
                <h2 className={styles.ctaTitle}>Sign in to light this up.</h2>
                <p className={styles.ctaCopy}>
                  The games homepage is public, but wallet state, pulls, inventory, and future PvP all depend on the
                  same NASFAQ session and cash balance used by the market.
                </p>
                <Link href="/login" className={styles.heroButton}>Sign In</Link>
              </section>
            )}
          </aside>
        </div>

        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>Featured Launch Surface</h2>
              <p className={styles.sectionCopy}>
                `capsule-gacha` is now the first dedicated `/games/[game]` page. The hub stays focused on discovery,
                wallet context, and routing into each game-specific surface.
              </p>
            </div>
            <FaChartLine />
          </div>

          <div className={styles.liveGrid}>
            <article className={styles.liveConsole}>
              <div className={styles.consoleHeadline}>
                <div className={styles.consolePrice}>
                  <HiSparkles />
                  <span>{capsuleGame ? fmtNumber(capsuleGame.entry_fee_cash, "$") : "$250.00"} per pull</span>
                </div>
                <p className={styles.consoleHint}>
                  Cosmetic-only sink with duplicate compensation, driven by the shared games backend and its own dedicated page.
                </p>
              </div>

              <div className={styles.pullMetaGrid}>
                <div className={styles.metaCard}>
                  <span className={styles.metaLabel}>Mode</span>
                  <strong className={styles.metaValue}>Single Pull</strong>
                  <span className={styles.metaHint}>One transactional pull request at a time.</span>
                </div>
                <div className={styles.metaCard}>
                  <span className={styles.metaLabel}>Surface</span>
                  <strong className={styles.metaValue}>/games/capsule-gacha</strong>
                  <span className={styles.metaHint}>Portable route that can move into a future games client.</span>
                </div>
                <div className={styles.metaCard}>
                  <span className={styles.metaLabel}>Balance</span>
                  <strong className={styles.metaValue}>{summary ? fmtNumber(summary.cash_balance, "$") : user ? "Loading…" : "Sign in"}</strong>
                  <span className={styles.metaHint}>Same wallet as `/market`.</span>
                </div>
              </div>

              <Link href="/games/capsule-gacha" className={styles.pullButton}>
                <FaPlay />
                <span>{user ? "Open Capsule Gacha" : "Preview Game Page"}</span>
              </Link>
            </article>

            <article className={styles.resultCard}>
              <div className={styles.sectionHead}>
                <div>
                  <h3 className={styles.sectionTitle}>What Lives There</h3>
                  <p className={styles.sectionCopy}>
                    The dedicated page owns live pulls, latest result state, and the cosmetic locker slice tied to the gacha loop.
                  </p>
                </div>
                <FaPlay />
              </div>

              <div className={`${styles.rewardHero} ${styles.rewardHeroStatic}`.trim()} style={{ "--reward-accent": "#f97316" } as CSSProperties}>
                <span className={styles.rewardKicker}>Live Game</span>
                <h4 className={styles.rewardTitle}>Capsule Gacha</h4>
                <span className={styles.rewardMeta}>
                  Pull console · latest reward card · recent cosmetics
                </span>
              </div>

              <div className={styles.resultLine}>
                <span className={styles.resultLabel}>Now</span>
                <strong className={styles.resultValue}>Dedicated route</strong>
              </div>
              <div className={styles.resultLine}>
                <span className={styles.resultLabel}>Next</span>
                <strong className={styles.resultValue}>Ticker Tap page</strong>
              </div>
              <div className={styles.resultLine}>
                <span className={styles.resultLabel}>After that</span>
                <strong className={styles.resultValue}>Prediction Duel page</strong>
              </div>

              <div className={styles.inventoryList}>
                {recentCosmetics.length ? recentCosmetics.map((cosmetic) => (
                  <article key={cosmetic.id} className={styles.inventoryItem}>
                    <strong className={styles.itemTitle}>{String(cosmetic.metadata.display_name || cosmetic.cosmetic_key)}</strong>
                    <span className={styles.itemMeta}>{cosmetic.rarity} · {cosmetic.cosmetic_type} · {fmtDate(cosmetic.granted_at)}</span>
                  </article>
                )) : <div className={styles.empty}>Your latest cosmetics will show up here after the first pull.</div>}
              </div>
            </article>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
