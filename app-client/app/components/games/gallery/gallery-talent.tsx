"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { FaArrowLeft, FaArrowRight, FaExpand, FaLock, FaTableCells } from "react-icons/fa6";
import { Oshimark } from "@/app/components/common/oshimark";
import { SceneArt } from "@/app/components/common/scene-art";
import { CardSheet } from "@/app/components/games/collection/card-sheet";
import type { CollectionModel, Pocket } from "@/app/components/games/collection/collection-model";
import { useShowcase } from "@/app/components/games/collection/use-showcase";
import { BannerIllustration, CardIllustration, KeyArt, RarityPips, Reaction } from "@/app/components/games/gallery/gallery-art";
import {
  BANNER_RARITIES,
  POSE_LABEL,
  RARITY_FLAVOUR,
  REACTION_POSES,
  bannerUnlocked,
  collectionOrder,
  givenName,
  ownedCount,
  reactionsUnlocked,
  useGallery,
  type ReactionPose,
} from "@/app/components/games/gallery/gallery-model";
import { Lightbox, type LightboxItem } from "@/app/components/games/gallery/lightbox";
import { GamesFrame, SignInToPlay } from "@/app/components/games/shell/games-frame";
import { apiFetch } from "@/app/lib/api";
import { artId } from "@/app/lib/art-manifest";
import { fmtInteger } from "@/app/lib/format";
import { fetchBanners } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import { MAX_STARS, RARITIES, RARITY_COLOR, RARITY_NAME } from "@/app/lib/games/rarity";
import type { Banner, Rarity, Talent } from "@/app/lib/games/types";
import { unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { useGamesStore } from "@/app/stores/games-store";
import styles from "@/app/components/games/gallery/gallery-talent.module.scss";

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

const fmtDay = (iso: string | null | undefined) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

type BannerInfo = { featured: Banner | null; pullCost: number };

export function GalleryTalent({ symbol }: { symbol: string }) {
  const gallery = useGallery();
  const { model, error } = gallery;
  const [bannerInfo, setBannerInfo] = useState<BannerInfo>({ featured: null, pullCost: 100 });

  useEffect(() => {
    let alive = true;
    fetchBanners()
      .then((data) => {
        if (!alive) return;
        setBannerInfo({ featured: data.banners.find((banner) => banner.kind === "featured" && banner.featured) ?? null, pullCost: data.pull_cost_cash ?? 100 });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const order = useMemo(() => (model ? collectionOrder(model) : []), [model]);
  const index = order.findIndex((pocket) => pocket.talent.symbol === symbol);
  const pocket = index >= 0 ? order[index] : null;
  const prev = order.length > 1 && index >= 0 ? order[(index - 1 + order.length) % order.length] : null;
  const next = order.length > 1 && index >= 0 ? order[(index + 1) % order.length] : null;

  const aside = (
    <nav className={styles.headNav} aria-label="Talents">
      <Link href="/games/cards/gallery" className={styles.allLink}>
        <FaTableCells aria-hidden="true" /> All talents
      </Link>
      {prev ? (
        <Link href={`/games/cards/gallery/${prev.talent.symbol}`} className={styles.stepLink} aria-label={`Previous: ${prev.talent.name}`}>
          <FaArrowLeft aria-hidden="true" />
          <span>{prev.talent.symbol}</span>
        </Link>
      ) : null}
      {next ? (
        <Link href={`/games/cards/gallery/${next.talent.symbol}`} className={styles.stepLink} aria-label={`Next: ${next.talent.name}`}>
          <span>{next.talent.symbol}</span>
          <FaArrowRight aria-hidden="true" />
        </Link>
      ) : null}
    </nav>
  );

  if (!model) {
    return (
      <GamesFrame kicker="Talent cards · Gallery" title="Gallery" aside={aside}>
        {error ? (
          <p className={styles.error} role="alert">
            {gameErrorText(new Error(error))}{" "}
            <button type="button" onClick={() => void useGamesStore.getState().loadCollection()}>
              Retry
            </button>
          </p>
        ) : (
          <div className={styles.loading} aria-busy="true" aria-label="Loading">
            <span />
            <div>
              {RARITIES.map((rarity) => (
                <span key={rarity} />
              ))}
            </div>
          </div>
        )}
      </GamesFrame>
    );
  }

  if (!pocket) {
    return (
      <GamesFrame kicker="Talent cards · Gallery" title="Gallery" aside={aside}>
        <div className={styles.missing}>
          <p>
            No talent with the ticker <b>{symbol}</b> hangs in this gallery.
          </p>
          <Link href="/games/cards/gallery">Back to the gallery</Link>
        </div>
      </GamesFrame>
    );
  }

  const count = ownedCount(pocket);
  const blurb = (
    <>
      <b>{count}</b> of <b>{RARITIES.length}</b> illustrations unlocked{count === RARITIES.length ? ". Full set." : "."}
    </>
  );

  return (
    <GamesFrame kicker="Talent cards · Gallery" title="Gallery" blurb={blurb} aside={aside}>
      <Room
        key={pocket.talent.symbol}
        model={model}
        pocket={pocket}
        position={index + 1}
        total={order.length}
        prev={prev}
        next={next}
        signedIn={gallery.signedIn}
        ready={gallery.ready}
        shards={gallery.shards}
        bannerInfo={bannerInfo}
      />
    </GamesFrame>
  );
}

type RoomProps = {
  model: CollectionModel;
  pocket: Pocket;
  position: number;
  total: number;
  prev: Pocket | null;
  next: Pocket | null;
  signedIn: boolean;
  ready: boolean;
  shards: number;
  bannerInfo: BannerInfo;
};

/** Puts her banner behind your profile header (also in Edit profile → Banner). */
function UseBanner({ symbol }: { symbol: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  useEffect(() => setState("idle"), [symbol]);
  const use = async () => {
    setState("busy");
    try {
      await apiFetch("/api/profiles/me/banner", { method: "PUT", body: JSON.stringify({ symbol }) });
      setState("done");
    } catch {
      setState("error");
    }
  };
  if (state === "done") {
    return (
      <Link href="/profile" className={styles.useBanner} data-done="">
        On your profile ✓
      </Link>
    );
  }
  return (
    <button type="button" className={styles.useBanner} onClick={() => void use()} disabled={state === "busy"}>
      {state === "busy" ? "Saving…" : state === "error" ? "Couldn't save · retry" : "Use on my profile"}
    </button>
  );
}

function Room({ model, pocket, position, total, prev, next, signedIn, ready, shards, bannerInfo }: RoomProps) {
  const { talent } = pocket;
  const accent = talentAccent(talent.color);
  const given = givenName(talent.name);
  const bannerOpen = bannerUnlocked(pocket);
  const reactionsOpen = reactionsUnlocked(pocket);
  const count = ownedCount(pocket);
  const featured = bannerInfo.featured?.featured?.symbol === talent.symbol ? bannerInfo.featured : null;
  const collection = useGamesStore((state) => state.collection);
  const showcase = useShowcase(collection?.showcase);
  const [sheet, setSheet] = useState<Rarity | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  // Everything unlocked, in wall order: banner, key art, the five cards, then reactions.
  const items = useMemo<LightboxItem[]>(() => {
    const list: LightboxItem[] = [];
    if (bannerUnlocked(pocket)) {
      list.push({
        key: "banner",
        artId: artId(talent.symbol, "banner"),
        aspect: 21 / 9,
        title: talent.name,
        tag: "Banner",
        color: accent,
        caption: "Featured banner art. Yours for owning her SSR or UR, and it can hang behind your profile.",
        render: (width) => <BannerIllustration talent={talent} width={width} priority />,
      });
    }
    list.push({
      key: "keyart",
      artId: artId(talent.symbol, "keyart"),
      aspect: 4 / 5,
      title: talent.name,
      tag: "Key art",
      color: accent,
      caption: talent.unit ? unitLabel(talent.unit) : undefined,
      render: (width) => (
        <div className={styles.lightboxKeyart} style={{ "--tal": accent } as CSSProperties}>
          <KeyArt talent={talent} width={width} priority />
        </div>
      ),
    });
    for (const rarity of RARITIES) {
      if (!pocket.owned[rarity]) continue;
      list.push({
        key: `card-${rarity}`,
        artId: artId(talent.symbol, `card-${rarity.toLowerCase()}`),
        aspect: 5 / 7,
        title: talent.name,
        tag: `${rarity} · ${RARITY_NAME[rarity]}`,
        color: RARITY_COLOR[rarity],
        caption: RARITY_FLAVOUR[rarity],
        render: (width) => <CardIllustration talent={talent} rarity={rarity} width={width} priority />,
      });
    }
    if (reactionsUnlocked(pocket)) {
      for (const pose of REACTION_POSES) {
        list.push({
          key: `reaction-${pose}`,
          artId: artId(talent.symbol, "reaction", pose),
          aspect: 1,
          title: `${given} · ${POSE_LABEL[pose]}`,
          tag: "Reaction",
          color: accent,
          render: (width) => (
            <div className={styles.lightboxReaction} style={{ "--tal": accent } as CSSProperties}>
              <Reaction talent={talent} pose={pose} width={width} />
            </div>
          ),
        });
      }
    }
    return list;
  }, [pocket, talent, accent, given]);

  const open = (key: string) => {
    const at = items.findIndex((item) => item.key === key);
    if (at >= 0) setViewing(at);
  };

  const bannerRates = BANNER_RARITIES.map((rarity) => `${rarity} ${pct(model.dropBps[rarity])}`).join(" · ");

  return (
    <div className={styles.room} style={{ "--tal": accent } as CSSProperties}>
      {/* ── Banner header ─────────────────────────────────────────────── */}
      <section className={styles.stage} aria-labelledby="talent-name">
        <div className={styles.bannerBox} data-locked={!bannerOpen || undefined}>
          {bannerOpen ? (
            <button type="button" className={styles.bannerButton} onClick={() => open("banner")} aria-label={`View ${talent.name}'s banner art full screen`}>
              <BannerIllustration talent={talent} width={1200} priority className={styles.bannerArt} />
              <span className={styles.expand} aria-hidden="true">
                <FaExpand />
              </span>
            </button>
          ) : (
            <div className={styles.bannerLocked}>
              <BannerIllustration talent={talent} width={1200} className={`${styles.bannerArt} ${styles.veiled}`} />
              <SceneArt slot="gallery-locked" fill width={1200} className={styles.veil} />
              <div className={styles.bannerLock}>
                <span className={styles.lockIcon} aria-hidden="true">
                  <FaLock />
                </span>
                <b>Banner art · locked</b>
                <span>Own {given}&apos;s SSR or UR to hang it.</span>
                <small>
                  {bannerRates} a pull
                  {featured ? " · rate up now" : ""}
                </small>
              </div>
            </div>
          )}
          <span className={styles.bannerTag} data-open={bannerOpen || undefined}>
            {bannerOpen ? "Banner" : "Banner · locked"}
          </span>
          {bannerOpen && signedIn ? <UseBanner symbol={talent.symbol} /> : null}
        </div>

        <div className={styles.identity}>
          <button type="button" className={styles.keyartBox} onClick={() => open("keyart")} aria-label={`View ${talent.name}'s key art full screen`}>
            <KeyArt talent={talent} width={320} priority plain className={styles.keyart} />
          </button>
          <div className={styles.idText}>
            <span className={styles.kicker}>
              {talent.unit ? unitLabel(talent.unit) : "Talent"} · No. {position}/{total}
            </span>
            <h2 id="talent-name" className={styles.name}>
              {talent.name}
            </h2>
            <p className={styles.ticker}>
              <Oshimark icon={talent.icon} symbol={talent.symbol} size={18} />
              <b>{talent.symbol}</b>
              <Link href={`/stocks/${talent.symbol}`}>Stock page</Link>
            </p>
            <div className={styles.progress}>
              <RarityPips owned={pocket.owned} size="md" />
              <em>
                {count}/{RARITIES.length}
              </em>
              <span className={styles.flag} data-on={bannerOpen || undefined}>
                {bannerOpen ? null : <FaLock aria-hidden="true" />}Banner
              </span>
              <span className={styles.flag} data-on={reactionsOpen || undefined}>
                {reactionsOpen ? null : <FaLock aria-hidden="true" />}Reactions
              </span>
            </div>
          </div>
        </div>
      </section>

      {ready && !signedIn ? <SignInToPlay what="unlock her art" /> : null}

      {/* ── Card illustrations ───────────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="plates-title">
        <header className={styles.sectionHead}>
          <h2 id="plates-title">Card illustrations</h2>
          <small>
            {count}/{RARITIES.length}
          </small>
        </header>
        <ol className={styles.plates}>
          {RARITIES.map((rarity, index) => (
            <Plate
              key={rarity}
              talent={talent}
              rarity={rarity}
              number={index + 1}
              card={pocket.owned[rarity] ?? null}
              model={model}
              signedIn={signedIn}
              shards={shards}
              featured={Boolean(featured)}
              pullCost={bannerInfo.pullCost}
              onView={() => open(`card-${rarity}`)}
              onCraft={() => setSheet(rarity)}
            />
          ))}
        </ol>
      </section>

      {/* ── Reactions ───────────────────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="reactions-title">
        <header className={styles.sectionHead}>
          <h2 id="reactions-title">Reactions</h2>
          <small>{reactionsOpen ? `${REACTION_POSES.length} poses · chat stickers and avatars` : "Locked"}</small>
        </header>
        <div className={styles.reactions} data-locked={!reactionsOpen || undefined}>
          <ul>
            {REACTION_POSES.map((pose) => (
              <ReactionTile key={pose} talent={talent} pose={pose} open={reactionsOpen} onView={() => open(`reaction-${pose}`)} />
            ))}
          </ul>
          {reactionsOpen ? null : (
            <p className={styles.reactionsLock}>
              <FaLock aria-hidden="true" /> Own any {given} card to unlock her reactions: send them as chat stickers and use one as your avatar.
            </p>
          )}
        </div>
      </section>

      {/* ── Prev / next ─────────────────────────────────────────────── */}
      {prev && next ? (
        <nav className={styles.pager} aria-label="More talents">
          <Link href={`/games/cards/gallery/${prev.talent.symbol}`} className={styles.pagerLink} data-dir="prev" style={{ "--tal": talentAccent(prev.talent.color) } as CSSProperties}>
            <FaArrowLeft aria-hidden="true" />
            <Oshimark icon={prev.talent.icon} symbol={prev.talent.symbol} size={22} />
            <span>
              <small>Previous</small>
              <b>{prev.talent.name}</b>
            </span>
            <RarityPips owned={prev.owned} className={styles.pagerPips} />
          </Link>
          <Link href={`/games/cards/gallery/${next.talent.symbol}`} className={styles.pagerLink} data-dir="next" style={{ "--tal": talentAccent(next.talent.color) } as CSSProperties}>
            <RarityPips owned={next.owned} className={styles.pagerPips} />
            <span>
              <small>Next</small>
              <b>{next.talent.name}</b>
            </span>
            <Oshimark icon={next.talent.icon} symbol={next.talent.symbol} size={22} />
            <FaArrowRight aria-hidden="true" />
          </Link>
        </nav>
      ) : null}

      <Lightbox items={items} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />

      {sheet && collection ? (
        <CardSheet model={model} symbol={talent.symbol} rarity={sheet} onRarity={setSheet} shards={collection.shards} showcase={showcase} onClose={closeSheet} artLink={false} />
      ) : null}
    </div>
  );
}

// ── A card illustration, framed, with its placard ──────────────────────────
type PlateProps = {
  talent: Talent;
  rarity: Rarity;
  number: number;
  card: Pocket["owned"][Rarity] | null;
  model: CollectionModel;
  signedIn: boolean;
  shards: number;
  featured: boolean;
  pullCost: number;
  onView: () => void;
  onCraft: () => void;
};

function Plate({ talent, rarity, number, card, model, signedIn, shards, featured, pullCost, onView, onCraft }: PlateProps) {
  const owned = Boolean(card);
  const cost = model.craftCost[rarity];
  const short = Math.max(0, cost - shards);
  const rateUp = featured && (rarity === "SSR" || rarity === "UR");
  const stars = Math.min(card?.stars ?? 0, MAX_STARS);
  const since = fmtDay(card?.obtained_at);

  return (
    <li className={styles.plate} data-rarity={rarity} data-locked={!owned || undefined} style={{ "--rc": RARITY_COLOR[rarity] } as CSSProperties}>
      <figure className={styles.figure}>
        <div className={styles.mat}>
          {owned ? (
            <button type="button" className={styles.pieceButton} onClick={onView} aria-label={`View ${talent.name} ${rarity} ${RARITY_NAME[rarity]} full screen`}>
              <CardIllustration talent={talent} rarity={rarity} width={560} />
              <span className={styles.expand} aria-hidden="true">
                <FaExpand />
              </span>
            </button>
          ) : (
            <div className={styles.lockedPiece}>
              <CardIllustration talent={talent} rarity={rarity} width={360} className={styles.veiled} />
              <SceneArt slot="gallery-locked" fill width={560} className={styles.veil} />
              <span className={styles.lockBadge}>
                <FaLock aria-hidden="true" />
                <b>{rarity}</b>
              </span>
            </div>
          )}
        </div>

        <figcaption className={styles.placard}>
          <div className={styles.placardHead}>
            <span className={styles.rarityChip}>{rarity}</span>
            <b>{RARITY_NAME[rarity]}</b>
            <small>No. {number}</small>
          </div>
          <p className={styles.flavour}>{RARITY_FLAVOUR[rarity]}</p>

          {owned ? (
            <p className={styles.facts}>
              <span className={styles.stars} aria-label={`${stars} of ${MAX_STARS} stars`}>
                {Array.from({ length: MAX_STARS }, (_, index) => (
                  <i key={index} data-on={index < stars || undefined} />
                ))}
              </span>
              <span>
                {fmtInteger(card?.copies ?? 1)} cop{(card?.copies ?? 1) === 1 ? "y" : "ies"}
              </span>
              {since ? <span>since {since}</span> : null}
            </p>
          ) : (
            <>
              <p className={styles.facts}>
                <span>
                  Drops <b>{pct(model.dropBps[rarity])}</b> a pull
                </span>
                {rateUp ? <span className={styles.rateUp}>Rate up now</span> : null}
              </p>
              {signedIn ? (
                <div className={styles.unlock}>
                  <Link href="/games/cards" className={styles.pullLink}>
                    {rateUp ? "Pull her banner" : "Pull"} · ${fmtInteger(pullCost)}
                  </Link>
                  <button type="button" className={styles.craftButton} onClick={onCraft} disabled={short > 0} aria-describedby={short > 0 ? `short-${rarity}` : undefined}>
                    Craft · <i aria-hidden="true" />
                    {fmtInteger(cost)}
                  </button>
                  {short > 0 ? (
                    <small id={`short-${rarity}`} className={styles.short}>
                      {fmtInteger(short)} more shards to craft
                    </small>
                  ) : null}
                </div>
              ) : (
                <div className={styles.unlock}>
                  <Link href="/login" className={styles.pullLink}>
                    Sign in to collect
                  </Link>
                </div>
              )}
            </>
          )}
        </figcaption>
      </figure>
    </li>
  );
}

function ReactionTile({ talent, pose, open, onView }: { talent: Talent; pose: ReactionPose; open: boolean; onView: () => void }) {
  return (
    <li className={styles.reaction}>
      {open ? (
        <button type="button" className={styles.reactionButton} onClick={onView} aria-label={`View ${talent.name} ${POSE_LABEL[pose]} reaction full screen`}>
          <Reaction talent={talent} pose={pose} width={128} />
        </button>
      ) : (
        <span className={styles.reactionLocked}>
          <Reaction talent={talent} pose={pose} width={128} className={styles.veiled} />
        </span>
      )}
      <span className={styles.poseLabel}>{POSE_LABEL[pose]}</span>
    </li>
  );
}
