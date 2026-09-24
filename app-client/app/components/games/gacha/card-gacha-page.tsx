"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { CardBack, TalentCard } from "@/app/components/games/cards/talent-card";
import { PityBar, PullButton, ShardGlyph, fmtCountdown, fmtLeft } from "@/app/components/games/gacha/gacha-parts";
import { PullFeed } from "@/app/components/games/gacha/pull-feed";
import { RevealStage, type RevealItem, type RevealStat } from "@/app/components/games/gacha/reveal-stage";
import { GamesFrame, SignInToPlay, useGamesWallet } from "@/app/components/games/shell/games-frame";
import { fetchBanners, pullCards } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import { MAX_STARS, RARITIES, RARITY_COLOR, RARITY_NAME, isHighRarity, rarityRank } from "@/app/lib/games/rarity";
import type { Banner, BannersResponse, Pity, PulledCard, PullResponse, Rarity, RarityRate, Talent } from "@/app/lib/games/types";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { fmtInteger } from "@/app/lib/format";
import { unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { useGamesStore } from "@/app/stores/games-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/games/gacha/card-gacha.module.scss";

// The talent card gacha (GAMES_DESIGN.md §1): featured + standard banners, pity, the pull
// reveal and the site-wide SSR feed.

const SR_EVERY = 10;
const HARD_PITY = 80;
const SOFT_PITY_FROM = 60;

/** GAMES_DESIGN §1 table, for signed-out visitors (signed-in players get collection.rates). */
const DEFAULT_RATES: RarityRate[] = [
  { rarity: "C", name: RARITY_NAME.C, rate_bps: 5500, power: 10, duplicate_shards: 5, craft_shards: 50 },
  { rarity: "R", name: RARITY_NAME.R, rate_bps: 3000, power: 14, duplicate_shards: 15, craft_shards: 150 },
  { rarity: "SR", name: RARITY_NAME.SR, rate_bps: 1100, power: 19, duplicate_shards: 50, craft_shards: 500 },
  { rarity: "SSR", name: RARITY_NAME.SSR, rate_bps: 350, power: 25, duplicate_shards: 200, craft_shards: 2000 },
  { rarity: "UR", name: RARITY_NAME.UR, rate_bps: 50, power: 32, duplicate_shards: 800, craft_shards: 8000 },
];

const MOMENT: Partial<Record<Rarity, RevealItem["moment"]>> = {
  SSR: { label: "SSR!", color: RARITY_COLOR.SSR },
  UR: { label: "UR!!", color: RARITY_COLOR.UR, big: true, holo: true },
};

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : bps % 10 === 0 ? 1 : 2)}%`;

const givenName = (name: string) => name.trim().split(/\s+/).pop() ?? name;

function toRevealItem(card: PulledCard, index: number): RevealItem {
  const tags: RevealItem["tags"] = [];
  if (card.was_new) tags.push({ text: "NEW", tone: "new" });
  else tags.push({ text: card.stars >= MAX_STARS && card.copies > MAX_STARS ? "★5 MAX" : `★${Math.min(card.stars, MAX_STARS)}`, tone: "stars" });
  if (card.shards > 0) tags.push({ text: `+${fmtInteger(card.shards)}`, tone: "shards" });
  if (card.was_featured) tags.push({ text: "FEATURED", tone: "featured" });
  return {
    id: `${index}-${card.key}`,
    rank: rarityRank(card.rarity) * 10 + (card.was_featured ? 2 : 0) + (card.was_new ? 1 : 0),
    glow: card.rarity === "C" ? null : RARITY_COLOR[card.rarity],
    moment: MOMENT[card.rarity] ?? null,
    label: `${card.name}, ${card.rarity}${card.was_new ? ", new" : `, ${Math.min(card.stars, MAX_STARS)} stars`}${card.shards ? `, plus ${card.shards} shards` : ""}`,
    name: card.name,
    tier: `${card.rarity} · ${RARITY_NAME[card.rarity]}`,
    face: (width) => <TalentCard card={card} width={width} isNew={card.was_new} ribbon={card.was_featured ? "FEATURED" : null} />,
    back: (width) => <CardBack width={width} glow={card.rarity === "C" ? null : card.rarity} />,
    tags,
  };
}

export function CardGachaPage() {
  const wallet = useGamesWallet();
  const signedIn = wallet.signedIn;
  const collection = useGamesStore((state) => state.collection);

  const [bannerData, setBannerData] = useState<BannersResponse | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<1 | 10 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PullResponse | null>(null);
  const [feedBump, setFeedBump] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchBanners()
      .then((data) => {
        if (!alive) return;
        setBannerData(data);
        setSelectedKey((current) => current ?? (data.banners.find((b) => b.kind === "featured") ?? data.banners[0])?.key ?? null);
      })
      .catch((reason) => alive && setBannerError(gameErrorText(reason)));
    return () => {
      alive = false;
    };
  }, []);

  const banners = useMemo(() => {
    const list = bannerData?.banners ?? [];
    return [...list].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "featured" ? -1 : 1));
  }, [bannerData]);
  const banner = banners.find((item) => item.key === selectedKey) ?? banners[0] ?? null;
  const pity: Pity | null = banner && collection ? collection.pity?.[banner.pool_key] ?? null : null;
  const rates = collection?.rates?.length ? collection.rates : DEFAULT_RATES;
  const costOne = bannerData?.pull_cost_cash ?? null;
  const costTen = bannerData?.ten_pull_cost_cash ?? null;

  // Talents to dress the standard banner with.
  const talents = useMemo(() => {
    const seen = new Map<string, Talent>();
    for (const talent of collection?.talents ?? []) seen.set(talent.symbol, talent);
    for (const b of banners) if (b.featured) seen.set(b.featured.symbol, b.featured);
    return Array.from(seen.values());
  }, [collection, banners]);

  const pull = useCallback(
    async (bannerKey: string, count: 1 | 10) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(count);
      setError(null);
      try {
        const response = await pullCards(bannerKey, count);
        const pool = banners.find((item) => item.key === bannerKey)?.pool_key ?? (response.banner.kind === "featured" ? "featured" : "standard");
        const store = useGamesStore.getState();
        store.setPity(pool, response.pity);
        store.setShards(response.shards);
        setResult(response);
        void useProfileStore.getState().fetchPortfolio();
        void store.loadCollection({ quiet: true });
        if (response.cards.some((card) => isHighRarity(card.rarity))) setFeedBump((n) => n + 1);
      } catch (reason) {
        setError(gameErrorText(reason));
      } finally {
        inFlight.current = false;
        setBusy(null);
      }
    },
    [banners],
  );

  const items = useMemo(() => (result ? result.cards.map(toRevealItem) : []), [result]);
  const stats = useMemo<RevealStat[]>(() => {
    if (!result) return [];
    const list: RevealStat[] = [
      { label: "New cards", value: result.cards.filter((card) => card.was_new).length, tone: "new" },
      {
        label: "Shards",
        value: (
          <>
            <ShardGlyph />+{fmtInteger(result.shards_awarded)}
          </>
        ),
        tone: "shards",
      },
      { label: "SSR+", value: result.cards.filter((card) => isHighRarity(card.rarity)).length },
    ];
    if (result.banner.kind === "featured") list.push({ label: "Rate up", value: result.cards.filter((card) => card.was_featured).length });
    return list;
  }, [result]);

  const againCount = (result?.cards.length === 1 ? 1 : 10) as 1 | 10;
  const againCost = againCount === 1 ? costOne : costTen;

  return (
    <GamesFrame
      kicker="Games · Gacha"
      title="Card gacha"
      blurb={
        <>
          <b>${costOne ?? 100}</b> a pull, <b>${costTen ?? 900}</b> for ten. Every 10th is SR or better.
        </>
      }
    >
      <div className={styles.page}>
        {bannerError ? <p className={styles.loadError}>Couldn&apos;t load banners. {bannerError}</p> : null}

        <div className={styles.tabs} role="tablist" aria-label="Banners">
          {banners.length === 0 && !bannerError
            ? [0, 1].map((n) => <span key={n} className={styles.tabGhost} aria-hidden="true" />)
            : banners.map((item) => <BannerTab key={item.key} banner={item} selected={item.key === banner?.key} onSelect={() => setSelectedKey(item.key)} />)}
        </div>

        <div className={styles.layout}>
          <div className={styles.main} role="tabpanel" aria-label={banner?.name ?? "Banner"}>
            {banner ? banner.kind === "featured" && banner.featured ? <FeaturedHero banner={banner} /> : <StandardHero talents={talents} poolSize={talents.length} signedIn={signedIn} /> : <div className={styles.heroLoading} />}

            <div className={styles.pullBar}>
              {signedIn ? (
                <>
                  <div className={styles.pullMeta}>
                    {pity ? (
                      <>
                        <span>
                          SR+ in <b>{pity.next_sr_guaranteed_in}</b>
                        </span>
                        <span>
                          SSR+ in <b>{pity.ssr_guaranteed_in}</b>
                        </span>
                        {banner?.kind === "featured" ? <span data-hot={pity.featured_guaranteed || undefined}>{pity.featured_guaranteed ? "Rate up guaranteed" : "50/50 on SSR+"}</span> : null}
                      </>
                    ) : (
                      <span>Loading pity…</span>
                    )}
                  </div>
                  <div className={styles.pullButtons}>
                    <PullButton count={1} cost={costOne} busy={busy === 1} disabled={!banner || busy !== null} onClick={() => banner && void pull(banner.key, 1)} />
                    <PullButton count={10} cost={costTen} busy={busy === 10} disabled={!banner || busy !== null} onClick={() => banner && void pull(banner.key, 10)} primary />
                  </div>
                  {error && !result ? (
                    <p className={styles.pullError} role="alert">
                      {error}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className={styles.signedOut}>
                  <SignInToPlay what="pull" />
                </div>
              )}
            </div>

            <RatesDetails rates={rates} />
          </div>

          <aside className={styles.rail}>
            <PityPanel banner={banner} pity={pity} signedIn={signedIn} />
            <PullFeed bump={feedBump} />
          </aside>
        </div>
      </div>

      <RevealStage
        batchKey={result?.batch_id ?? null}
        items={items}
        title={result ? `${result.cards.length === 1 ? "Single pull" : "10-pull"} · ${result.banner.name}` : ""}
        stats={stats}
        againLabel={`PULL ×${againCount} AGAIN · $${againCost === null ? "—" : fmtInteger(againCost)}`}
        againBusy={busy !== null}
        againError={result ? error : null}
        onAgain={() => result && void pull(result.banner.key, againCount)}
        onClose={() => {
          setResult(null);
          setError(null);
        }}
      />
    </GamesFrame>
  );
}

// ── Banner tabs ────────────────────────────────────────────────────────────
function BannerTab({ banner, selected, onSelect }: { banner: Banner; selected: boolean; onSelect: () => void }) {
  const left = useRemaining(banner.ends_at ? Date.parse(banner.ends_at) : null, 30_000);
  const featured = banner.kind === "featured" ? banner.featured : null;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={styles.tab}
      data-kind={banner.kind}
      onClick={onSelect}
      style={featured ? ({ "--tal": talentAccent(featured.color) } as CSSProperties) : undefined}
    >
      <span className={styles.tabMark} aria-hidden="true">
        {featured ? <Oshimark icon={featured.icon} symbol={featured.symbol} size={26} /> : <span className={styles.tabFan} />}
      </span>
      <span className={styles.tabText}>
        <small>{featured ? "Featured · rate up" : "Standard · always on"}</small>
        <b>{featured ? featured.name : "Standard"}</b>
      </span>
      {featured && left !== null ? <span className={styles.tabLeft}>{fmtLeft(left)}</span> : null}
    </button>
  );
}

// ── Heroes ─────────────────────────────────────────────────────────────────
function FeaturedHero({ banner }: { banner: Banner }) {
  const talent = banner.featured!;
  const accent = talentAccent(talent.color);
  const left = useRemaining(banner.ends_at ? Date.parse(banner.ends_at) : null, 1000);
  const given = givenName(talent.name);
  const marquee = Array.from({ length: 8 }, () => `RATE UP ★ ${talent.symbol} ★ `).join("");

  return (
    <section className={styles.hero} data-kind="featured" style={{ "--tal": accent } as CSSProperties} aria-labelledby="banner-name">
      <div className={styles.heroBg} aria-hidden="true">
        <span className={styles.heroRays} />
        <span className={styles.heroDots} />
        <span className={styles.heroGhost}>{talent.symbol}</span>
      </div>
      <div className={styles.marquee} aria-hidden="true">
        <span>{marquee}</span>
        <span>{marquee}</span>
      </div>

      <div className={styles.heroCopy}>
        <span className={styles.heroKicker}>
          <span className={styles.rateUp}>Rate up</span>
          {banner.name}
        </span>
        <h2 id="banner-name" className={styles.heroName}>
          {talent.name}
        </h2>
        <p className={styles.heroUnit}>
          <Oshimark icon={talent.icon} symbol={talent.symbol} size={18} />
          <b>{talent.symbol}</b>
          {talent.unit ? <span>{unitLabel(talent.unit)}</span> : null}
        </p>
        <p className={styles.heroPitch}>
          Every SSR+ is a 50/50 for {given}. Lose it and the next one&apos;s {given}, guaranteed.
        </p>
        <div className={styles.heroChips}>
          <span data-r="UR">UR {given}</span>
          <span data-r="SSR">SSR {given}</span>
        </div>
        <div className={styles.heroTimer}>
          <small>Ends in</small>
          <b>{fmtCountdown(left)}</b>
        </div>
      </div>

      <div className={styles.heroStage} aria-hidden="true">
        <ArtSlot kind="keyart" symbol={talent.symbol} icon={talent.icon} accent={accent} width={520} className={styles.heroArt} fallback={<span />} />
        <div className={styles.heroCardBack}>
          <TalentCard card={{ ...talent, rarity: "SSR", power: 25 }} width={176} tilt={false} />
        </div>
        <div className={styles.heroCardFront}>
          <TalentCard card={{ ...talent, rarity: "UR", power: 32 }} width={232} ribbon="RATE UP" />
        </div>
      </div>
    </section>
  );
}

function StandardHero({ talents, poolSize, signedIn }: { talents: Talent[]; poolSize: number; signedIn: boolean }) {
  // Five talents spread across the palette, one per rarity, fanned like a hand.
  const picks = useMemo(() => {
    if (!talents.length) return [];
    const step = Math.max(1, Math.floor(talents.length / 5));
    return RARITIES.map((rarity, index) => ({ talent: talents[(index * step + 3) % talents.length], rarity }));
  }, [talents]);

  return (
    <section className={styles.hero} data-kind="standard" aria-labelledby="banner-name">
      <div className={styles.heroBg} aria-hidden="true">
        <span className={styles.heroRays} />
        <span className={styles.heroDots} />
        <span className={styles.heroGhost}>ALL</span>
      </div>

      <div className={styles.heroCopy}>
        <span className={styles.heroKicker}>
          <span className={styles.always}>Always on</span>
          Standard banner
        </span>
        <h2 id="banner-name" className={styles.heroName}>
          Standard
        </h2>
        <p className={styles.heroPitch}>Every talent, every rarity. No rate up, no 50/50, and your pity keeps counting.</p>
        {signedIn && poolSize ? (
          <dl className={styles.heroStats}>
            <div>
              <dt>Talents</dt>
              <dd>{fmtInteger(poolSize)}</dd>
            </div>
            <div>
              <dt>Cards</dt>
              <dd>{fmtInteger(poolSize * RARITIES.length)}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      <div className={styles.heroStage} data-fan aria-hidden="true">
        <div className={styles.fan}>
          {picks.length
            ? picks.map(({ talent, rarity }, index) => (
                <div key={rarity} className={styles.fanCard} style={{ "--f": index - 2 } as CSSProperties}>
                  <TalentCard card={{ ...talent, rarity, power: DEFAULT_RATES[index].power }} width={150} tilt={false} />
                </div>
              ))
            : RARITIES.map((rarity, index) => (
                <div key={rarity} className={styles.fanCard} style={{ "--f": index - 2 } as CSSProperties}>
                  <CardBack width={150} glow={rarity === "C" ? null : rarity} />
                </div>
              ))}
        </div>
      </div>
    </section>
  );
}

// ── Pity ───────────────────────────────────────────────────────────────────
function PityPanel({ banner, pity, signedIn }: { banner: Banner | null; pity: Pity | null; signedIn: boolean }) {
  const featured = banner?.kind === "featured" ? banner.featured : null;
  return (
    <section className={styles.pityPanel} aria-labelledby="pity-title">
      <header className={styles.railHead}>
        <h2 id="pity-title">Pity</h2>
        <span>{banner?.kind === "featured" ? "Featured banners" : "Standard"}</span>
      </header>
      {signedIn ? (
        <>
          <PityBar
            label="SR+ guaranteed in"
            left={pity?.next_sr_guaranteed_in ?? null}
            done={pity?.pulls_since_sr ?? null}
            total={SR_EVERY}
            color={RARITY_COLOR.SR}
          />
          <PityBar
            label="SSR+ guaranteed in"
            left={pity?.ssr_guaranteed_in ?? null}
            done={pity?.pulls_since_ssr ?? null}
            total={HARD_PITY}
            softFrom={SOFT_PITY_FROM}
            hot={Boolean(pity?.soft_pity_active)}
            color={RARITY_COLOR.SSR}
            note={pity ? (pity.soft_pity_active ? "Soft pity on" : `Soft pity at ${SOFT_PITY_FROM}`) : null}
          />
          <div className={styles.rateLine} data-hot={pity?.soft_pity_active || undefined}>
            <span>Next pull SSR+ rate</span>
            <b>{pity ? pct(pity.next_ssr_rate_bps) : "—"}</b>
          </div>
          {featured ? (
            <div className={styles.fifty} data-guaranteed={pity?.featured_guaranteed || undefined} style={{ "--tal": talentAccent(featured.color) } as CSSProperties}>
              <Oshimark icon={featured.icon} symbol={featured.symbol} size={22} />
              <span>
                <small>Next SSR+</small>
                <b>{pity?.featured_guaranteed ? `${givenName(featured.name)}, guaranteed` : `50/50 for ${givenName(featured.name)}`}</b>
              </span>
            </div>
          ) : null}
          {pity ? (
            <p className={styles.pityTotal}>
              <span>Pulls on {banner?.kind === "featured" ? "featured" : "standard"}</span>
              <b>{fmtInteger(pity.total_pulls)}</b>
            </p>
          ) : null}
        </>
      ) : (
        <ul className={styles.pityRules}>
          <li>
            <b>SR+</b> every {SR_EVERY}th pull, guaranteed
          </li>
          <li>
            <b>SSR+</b> by pull {HARD_PITY}. Odds climb from pull {SOFT_PITY_FROM}
          </li>
          <li>
            <b>50/50</b> on featured. Lose it, win the next
          </li>
        </ul>
      )}
    </section>
  );
}

// ── Rates and rules ────────────────────────────────────────────────────────
function RatesDetails({ rates }: { rates: RarityRate[] }) {
  return (
    <details className={styles.rates}>
      <summary>
        <span>Rates and rules</span>
        <small>{rates.map((rate) => `${rate.rarity} ${pct(rate.rate_bps)}`).join(" · ")}</small>
      </summary>
      <div className={styles.ratesBody}>
        <div className={styles.tableWrap}>
          <table className={styles.rateTable}>
            <thead>
              <tr>
                <th scope="col">Rarity</th>
                <th scope="col">Rate</th>
                <th scope="col">Base power</th>
                <th scope="col">Dupe shards</th>
                <th scope="col">Craft cost</th>
              </tr>
            </thead>
            <tbody>
              {[...rates].reverse().map((rate) => (
                <tr key={rate.rarity} style={{ "--rc": RARITY_COLOR[rate.rarity] } as CSSProperties}>
                  <th scope="row">
                    <b>{rate.rarity}</b> {rate.name}
                  </th>
                  <td>{pct(rate.rate_bps)}</td>
                  <td>{rate.power}</td>
                  <td>
                    <ShardGlyph />
                    {fmtInteger(rate.duplicate_shards)}
                  </td>
                  <td>
                    <ShardGlyph />
                    {fmtInteger(rate.craft_shards)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.rules}>
          <section>
            <h3>Pity</h3>
            <ul>
              <li>Every {SR_EVERY}th pull is SR or better.</li>
              <li>
                SSR+ odds climb 6 points a pull from pull {SOFT_PITY_FROM}. Pull {HARD_PITY} is a guaranteed SSR+.
              </li>
              <li>Standard and featured keep separate pity. It carries between pulls and between weekly banners.</li>
              <li>A 10-pull is ten single pulls back to back, so pity can land mid-batch.</li>
            </ul>
          </section>
          <section>
            <h3>Featured 50/50</h3>
            <ul>
              <li>An SSR+ on a featured banner is the rate-up talent half the time.</li>
              <li>Lose the 50/50 and your next SSR+ on a featured banner is the rate-up card.</li>
            </ul>
          </section>
          <section>
            <h3>Stars and shards</h3>
            <ul>
              <li>Your first copy is ★1. Each dupe adds a star, up to ★{MAX_STARS}, and pays shards.</li>
              <li>Past ★{MAX_STARS}, dupes pay double shards.</li>
              <li>Each star above ★1 is +1 power in the Oshi duel.</li>
              <li>
                Spend shards crafting any card in your <Link href="/games/collection">collection</Link>.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </details>
  );
}
