"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FiLink } from "react-icons/fi";
import { Tile } from "@/app/components/games/mahjong/tile";
import { artSrcSet, lookupArt, resolveArtUrl, sharedArtId, type ArtImage, type ArtManifest } from "@/app/lib/art-manifest";
import { useArtStore } from "@/app/stores/art-store";
import sceneStyles from "@/app/components/common/scene-art.module.scss";
import styles from "@/app/components/games/mahjong/talent-scene.module.scss";

// The mahjong lobby and Learn slots once their talent art ships: a code background, the talent cut out
// (the only generated part), the table edge, and the game's own tiles in front, so every tile face is
// exact. The images are `_shared/<slot>/<variant>` cutouts, 768×987, whose manifest anchors say where
// the face is (`face_y`), where the table edge goes (`cut_y`) and how wide the figure is (`span`), all as
// fractions. Until a slot's images are all in the manifest (or if one has the wrong shape or no anchors),
// the drawn fallback shows, exactly as before.

type Kind = "quick" | "practice" | "friend" | "chips" | "rules" | "patterns" | "yaku" | "glossary" | "tips" | "finish" | "hub";

/** Where one figure sits: its face at F (fraction of the frame height), the table edge at R, scale limits, distance from the right edge (cqw) on wide and narrow frames. */
type Placement = { F: number; R: number; max: number; min?: number; right: number; rightN: number };

type SceneSpec = { kind: Kind; variants: string[]; place?: Placement; glow?: string };

// Signed off by the owner on 2026-11-16 (the sign-off page's composites use these same numbers).
const SCENES = {
  "mahjong-lobby-quick": { kind: "quick", variants: ["default"], place: { F: 0.4, R: 0.66, max: 2.4, right: 3, rightN: -4 } },
  "mahjong-lobby-practice": { kind: "practice", variants: ["default"], place: { F: 0.37, R: 0.74, max: 2.4, right: 3, rightN: -10 } },
  // The friend room has two talents: `default` stands at the right, `partner` to its left.
  "mahjong-lobby-friend": { kind: "friend", variants: ["default", "partner"] },
  "mahjong-lobby-chips": { kind: "chips", variants: ["default"], place: { F: 0.45, R: 0.8, max: 1.2, right: 2, rightN: 0 } },
  "mahjong-learn-hub-hero": { kind: "hub", variants: ["default"], place: { F: 0.35, R: 0.8, max: 2.4, right: 3, rightN: 3 }, glow: "82%" },
  "mahjong-learn-rules": { kind: "rules", variants: ["default"], place: { F: 0.38, R: 0.8, max: 1.1, right: 2, rightN: 1 } },
  "mahjong-learn-patterns": { kind: "patterns", variants: ["default"], place: { F: 0.4, R: 0.74, max: 1.35, right: 1, rightN: 0 } },
  "mahjong-learn-yaku": { kind: "yaku", variants: ["default"], place: { F: 0.42, R: 0.8, max: 1.15, right: 2, rightN: 1 } },
  "mahjong-learn-glossary": { kind: "glossary", variants: ["default"], place: { F: 0.34, R: 0.84, max: 1.1, right: 3, rightN: 2 } },
  "mahjong-learn-tips": { kind: "tips", variants: ["default"], place: { F: 0.42, R: 0.78, max: 1.3, right: 1, rightN: 0 } },
  "mahjong-learn-finish": { kind: "finish", variants: ["default"], place: { F: 0.46, R: 0.82, max: 1.25, right: 2, rightN: 1 } },
} satisfies Record<string, SceneSpec>;

export type TalentSceneSlot = keyof typeof SCENES;

/** The cutouts' shape (768×987); anything else is not one of these images. */
const FIGURE_RATIO = 768 / 987;

type Figure = { image: ArtImage; id: string; face: number; cut: number; span: number };

function figureOf(manifest: ArtManifest | null, id: string): Figure | null {
  const image = lookupArt(manifest, id);
  if (!image || !image.w || !image.h || Math.abs(image.w / image.h - FIGURE_RATIO) > 0.01) return null;
  const { face_y: face, cut_y: cut, span } = image.anchors ?? {};
  if (typeof face !== "number" || typeof cut !== "number" || !(cut > face)) return null;
  return { image, id, face, cut, span: Math.max(0.55, Math.min(1, typeof span === "number" ? span : 1)) };
}

/** All of a slot's figures, or null when any is missing (then the drawn version shows). */
function figuresOf(manifest: ArtManifest | null, slot: TalentSceneSlot): Figure[] | null {
  const figures = SCENES[slot].variants.map((variant) => figureOf(manifest, sharedArtId(slot, variant)));
  return figures.every(Boolean) ? (figures as Figure[]) : null;
}

/** Width of a run of tiles, in tile heights: n tiles in `groups` groups, plus `extra` for other pieces. */
const units = (n: number, groups = 1, extra = 0) => n * 0.75 + Math.max(0, n - groups) * 0.03 + Math.max(0, groups - 1) * 0.06 + extra;

type Frame = { w: number; h: number };

/** Tile height (px) that fits both the height cap (% of the frame's height) and the room across (% of its width). */
const fit = (frame: Frame, capH: number, roomW: number, u: number) => Math.min((capH / 100) * frame.h, ((roomW / u) / 100) * frame.w);

type Placed = { s: number; top: number; railTop: number; widthCqw: number; leftOf: (right: number) => number };

/** Places one figure: its face at F and its cut line on the table edge, within the scale limits. */
function place(figure: Figure, frame: Frame, F: number, opt: { R: number; max?: number; min?: number }): Placed {
  let s = (opt.R - F) / (figure.cut - figure.face);
  s = Math.max(opt.min || 1.1, Math.min(opt.max || 2.4, s));
  const top = F - s * figure.face;
  const railTop = Math.min(0.86, top + s * figure.cut);
  const fullCqw = ((s * FIGURE_RATIO * frame.h) / frame.w) * 100;
  // The figure is centered in its image, so its left edge sits (1 + span) / 2 of the image width from the right.
  return { s, top, railTop, widthCqw: fullCqw * figure.span, leftOf: (right) => 100 - right - fullCqw * (0.5 + figure.span / 2) };
}

function FigureImage({ figure, placed, right, width, priority }: { figure: Figure; placed: Placed; right: number; width: number; priority: boolean }) {
  const { image, id } = figure;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.talent}
      data-art-id={id}
      src={resolveArtUrl(image.src) ?? undefined}
      srcSet={artSrcSet(image)}
      sizes={`${width}px`}
      width={image.w}
      height={image.h}
      alt=""
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      style={{ height: `${placed.s * 100}%`, top: `${placed.top * 100}%`, right: `${right}%` }}
    />
  );
}

/** A tile for the scene: `th` is the tile's height in px. */
const T = ({ kind, th, className }: { kind: number; th: number; className?: string }) => <Tile kind={kind} size={th * 0.75} labels={false} title="" className={className} />;

function Group({ kinds, th, className }: { kinds: number[]; th: number; className?: string }) {
  return (
    <span className={[styles.group, className].filter(Boolean).join(" ")}>
      {kinds.map((kind, at) => (
        <T key={at} kind={kind} th={th} />
      ))}
    </span>
  );
}

const thVar = (th: number) => ({ "--th": `${th}px` }) as CSSProperties;

function Shield() {
  return (
    <svg className={styles.shield} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="#2ee38e" />
      <path d="M8 12l3 3 5-6" fill="none" stroke="#0a0c11" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type SceneProps = { slot: TalentSceneSlot; figures: Figure[]; frame: Frame; width: number; priority: boolean; seconds?: number };

function Scene({ slot, figures, frame, width, priority, seconds }: SceneProps) {
  const spec: SceneSpec = SCENES[slot];
  const narrow = frame.w / frame.h < 1.8;
  const at = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
  let figs: ReactNode;
  let under: ReactNode = null;
  let front: ReactNode = null;
  let railTop: number;

  if (spec.kind === "friend") {
    // `default` (right) and `partner` (left, half behind the first).
    const [right, left] = figures;
    const pb = place(right, frame, 0.42, { R: 0.7, max: 2.0 });
    const pa = place(left, frame, 0.44, { R: 0.7, max: 2.0 });
    const rb = 1;
    const ra = rb + pb.widthCqw * 0.62;
    figs = (
      <>
        <FigureImage figure={right} placed={pb} right={rb} width={width} priority={priority} />
        <FigureImage figure={left} placed={pa} right={ra} width={width} priority={priority} />
      </>
    );
    railTop = Math.max(pa.railTop, pb.railTop);
    const room = 100 - ra - pa.widthCqw * 0.85 - 6;
    const th = fit(frame, narrow ? 34 : 40, Math.max(room, 12), units(1, 1, 2.2));
    front = (
      <div className={`${styles.layer} ${styles.row}`} style={{ ...thVar(th), left: "4%", bottom: `${(1 - railTop) * 100 - 8}%` }}>
        <span className={styles.seat}>+</span>
        <span className={styles.pill}>
          <FiLink aria-hidden="true" />
          <span>Invite</span>
        </span>
      </div>
    );
  } else {
    const [figure] = figures;
    const L = spec.place!;
    const p = place(figure, frame, L.F, { R: L.R, max: L.max, min: L.min });
    const right = narrow ? L.rightN : L.right;
    figs = <FigureImage figure={figure} placed={p} right={right} width={width} priority={priority} />;
    railTop = p.railTop;
    const boardy = spec.kind === "yaku" || spec.kind === "hub";
    const room = p.leftOf(right) - (boardy ? 6 : 1);
    const bottom = `${(1 - railTop) * 100 - (narrow ? 10 : 12)}%`;
    const row = (th: number, children: ReactNode, extra?: CSSProperties, className = styles.row) => (
      <div className={`${styles.layer} ${className}`} style={{ ...thVar(th), left: "4%", bottom, ...extra }}>
        {children}
      </div>
    );

    if (spec.kind === "quick") {
      const n = narrow ? 2 : 3;
      const th = fit(frame, narrow ? 40 : 50, room, units(n + 1, 2, 1.06));
      front = row(
        th,
        <>
          <span className={styles.ring}>{seconds ?? 0}s</span>
          <Group kinds={[27, 28, 29].slice(0, n)} th={th} />
          <span className={`${styles.seat} ${styles.pulse}`} />
        </>,
        { gap: `${th * 0.16}px` },
      );
    } else if (spec.kind === "practice") {
      const kinds = narrow ? [1, 2, 3] : [1, 2, 3, 12, 13, 24];
      const th = fit(frame, narrow ? 32 : 38, room, units(kinds.length + 1, 2));
      const backs = narrow ? 4 : 7;
      under = (
        <div className={`${styles.layer} ${styles.row}`} style={{ ...thVar(th * 0.45), left: "5%", top: "12%", gap: `${th * 0.45 * 0.06}px` }}>
          {Array.from({ length: backs }, (_, n) => (
            <Tile key={n} faceDown size={th * 0.45 * 0.75} title="" />
          ))}
        </div>
      );
      front = row(
        th,
        <>
          <Group kinds={kinds} th={th} />
          <Group kinds={[27]} th={th} className={styles.hint} />
        </>,
        { gap: `${th * 0.06}px` },
      );
    } else if (spec.kind === "chips") {
      const th = fit(frame, narrow ? 30 : 34, room, units(2, 1, 3.4));
      front = row(
        th,
        <>
          <span className={styles.stack} style={{ "--c": "#1d4ed8", height: th * 0.9 } as CSSProperties} />
          <span className={styles.stack} style={{ "--c": "#e6ebf5", height: th * 1.3 } as CSSProperties} />
          <span className={styles.stack} style={{ "--c": "#3fb8f5", height: th * 1.8 } as CSSProperties} />
          <Group kinds={[4, 4]} th={th} />
        </>,
        { left: "5%", gap: `${th * 0.14}px` },
      );
    } else if (spec.kind === "rules") {
      const th = fit(frame, narrow ? 30 : 34, room, units(3, 1, 3.2));
      // 7 seconds a move: the standard table's turn clock (api/src/services/games/mahjong/settings.js).
      front = row(
        th,
        <>
          <span className={styles.ring}>7s</span>
          <span className={styles.stick} />
          <Group kinds={[9, 10, 11]} th={th} />
        </>,
        { left: "5%" },
      );
    } else if (spec.kind === "patterns") {
      const sets = [
        [0, 1, 2],
        [31, 31, 31],
        [18, 19, 20],
      ];
      const th = fit(frame, narrow ? 26 : 28, room, units(sets.flat().length, sets.length, sets.length * 0.3));
      front = row(
        th,
        sets.map((kinds, n) => (
          <span key={n} className={styles.plinth} data-lit={n === 1 ? "" : undefined}>
            <Group kinds={kinds} th={th} />
            <i />
          </span>
        )),
        { gap: `${th * 0.3}px` },
      );
    } else if (spec.kind === "yaku" || spec.kind === "hub") {
      const boardW = Math.max(room, 30);
      const th = fit(frame, spec.kind === "hub" ? (narrow ? 17 : 15) : narrow ? 16 : 15, boardW - 6, units(9, 3));
      // Yaku: 456 in all three suits plus all simples, tanyao + sanshoku, 3 han (checked with the scorer).
      const rows =
        spec.kind === "yaku"
          ? [
              [
                [3, 4, 5],
                [12, 13, 14],
                [21, 22, 23],
              ],
              [
                [10, 10, 10],
                [25, 25],
              ],
            ]
          : [
              [
                [0, 1, 2],
                [12, 13, 14],
                [24, 25, 26],
              ],
              [
                [19, 20, 21],
                [13, 13],
              ],
            ];
      under = (
        <div
          className={`${styles.under} ${styles.board}`}
          style={{ ...thVar(th), left: "3%", top: "8%", width: `${boardW}%`, height: `${railTop * 100 - 14}%`, gap: `${th * (spec.kind === "hub" ? 0.4 : 0.35)}px` }}
        >
          {rows.map((groups, n) => (
            <div key={n} className={`${styles.tiles} ${spec.kind === "hub" ? styles.lift : ""}`}>
              {groups.map((kinds, g) => (
                <Group key={g} kinds={kinds} th={th} />
              ))}
              {spec.kind === "yaku" && n === 1 ? <span className={styles.han}>3 han</span> : null}
            </div>
          ))}
        </div>
      );
    } else if (spec.kind === "glossary") {
      const th = fit(frame, narrow ? 24 : 26, room, units(2, 2, 1.4));
      front = row(
        th,
        <>
          <span className={styles.card}>
            <T kind={33} th={th} />
            <span>Yakuhai</span>
          </span>
          <span className={styles.card}>
            <T kind={13} th={th} />
            <span>Dora</span>
          </span>
        </>,
        { left: "5%", bottom: `${(1 - railTop) * 100 - (narrow ? 10 : 12) + 6}%`, gap: `${th * 0.3}px` },
      );
    } else if (spec.kind === "tips") {
      const pond = [8, 27, 19, 33, 2, 25, 14, 30, 6, 21, 11, 29];
      const th = fit(frame, narrow ? 22 : 24, room, units(6, 1, 0.8));
      front = row(
        th,
        <>
          <span className={styles.pond}>
            {pond.map((kind, n) => (
              <T key={n} kind={kind} th={th} className={n === 9 ? styles.safe : undefined} />
            ))}
          </span>
          <Shield />
        </>,
      );
    } else if (spec.kind === "finish") {
      // A complete hand: 234m 456p 55m / 456s 234s, pinfu + tanyao (checked with the scorer).
      const th = fit(frame, narrow ? 22 : 20, room, units(8, 3));
      under = <div className={`${styles.under} ${styles.confetti}`} />;
      front = row(
        th,
        <>
          <div className={`${styles.tiles} ${styles.lift}`}>
            <Group kinds={[1, 2, 3]} th={th} />
            <Group kinds={[12, 13, 14]} th={th} />
            <Group kinds={[4, 4]} th={th} />
          </div>
          <div className={`${styles.tiles} ${styles.lift}`}>
            <Group kinds={[21, 22, 23]} th={th} />
            <Group kinds={[19, 20, 21]} th={th} />
          </div>
        </>,
        { gap: `${th * 0.2}px` },
        styles.stackRows,
      );
    }
  }

  return (
    <>
      {under}
      {figs}
      <div className={styles.rail} style={{ top: at(railTop) }} />
      {front}
    </>
  );
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type TalentSceneProps = {
  slot: TalentSceneSlot;
  /** The drawn version: what shows until the slot's talent art is in the manifest. */
  fallback: ReactNode;
  /** Rendered width in px, for srcset. */
  width?: number;
  priority?: boolean;
  /** Quick match: the bot-fill seconds shown on the ring. */
  seconds?: number;
};

/** A mahjong lobby or Learn slot: the talent composite when its art has shipped, the drawing until then. Fills its parent. */
export function TalentScene({ slot, fallback, width = 420, priority = false, seconds }: TalentSceneProps) {
  const manifest = useArtStore((state) => state.manifest);
  const ensureLoaded = useArtStore((state) => state.ensureLoaded);
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const figures = figuresOf(manifest, slot);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  useIsoLayoutEffect(() => {
    const node = ref.current;
    if (!node || !figures) return;
    const measure = () => {
      const { width: w, height: h } = node.getBoundingClientRect();
      setFrame((old) => (w > 0 && h > 0 && (!old || Math.abs(old.w - w) > 0.5 || Math.abs(old.h - h) > 0.5) ? { w, h } : old));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [Boolean(figures)]);

  if (!figures) {
    // Same markup as SceneArt's drawn state; the cutouts are never shown as plain scene images.
    return (
      <div className={`${sceneStyles.slot} ${sceneStyles.fill} ${sceneStyles.drawn}`} data-art-id={sharedArtId(slot)} data-art-missing="" aria-hidden="true">
        {fallback}
      </div>
    );
  }

  const glow = (SCENES[slot] as SceneSpec).glow ?? "80%";
  return (
    <div ref={ref} className={styles.scene} style={{ "--glow": glow } as CSSProperties} data-art-id={sharedArtId(slot)} aria-hidden="true">
      {frame ? <Scene slot={slot} figures={figures} frame={frame} width={width} priority={priority} seconds={seconds} /> : null}
    </div>
  );
}
