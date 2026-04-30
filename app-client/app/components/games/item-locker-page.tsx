"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FaArrowLeft, FaBoxOpen, FaCompress, FaExpand, FaHandPointer, FaListUl, FaXmark } from "react-icons/fa6";
import { fetchGameItemLocker } from "@/app/lib/games-api";
import type { GameItemLockerEntry, GameItemLockerResponse } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { SiteShell } from "@/app/components/layout/site-shell";
import styles from "@/app/components/games/item-locker-page.module.scss";

type Bubble = {
  id: number;
  item: GameItemLockerEntry;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  seed: number;
  image: HTMLImageElement | null;
  imageLoaded: boolean;
};

type ViewportState = {
  x: number;
  y: number;
  scale: number;
};

type PointerState = {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  dx: number;
  dy: number;
  active: boolean;
  dragging: boolean;
  dragX: number;
  dragY: number;
};

type LockerListItem = {
  key: string;
  displayName: string;
  rewardType: string;
  rarity: string;
  imageUrl: string;
  count: number;
};

const LOCKER_TYPES = new Set(["hat", "item"]);
const RARITY_COLORS: Record<string, string> = {
  common: "#34d399",
  rare: "#38bdf8",
  epic: "#c084fc",
  legendary: "#eab308",
};

function seededUnit(value: number) {
  const x = Math.sin(value * 999.91) * 43758.5453;
  return x - Math.floor(x);
}

function imageUrlForItem(item: GameItemLockerEntry) {
  return item.reward.image_url || String(item.metadata.image_url || "");
}

function rewardTypeLabel(value: string) {
  return value.replaceAll("_", " ");
}

function buildLockerList(items: GameItemLockerEntry[]): LockerListItem[] {
  const grouped = new Map<string, LockerListItem>();

  for (const item of items) {
    const key = `${item.reward_type}:${item.reward_key}`;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      continue;
    }

    grouped.set(key, {
      key,
      displayName: item.reward.display_name || String(item.metadata.display_name || item.reward_key),
      rewardType: item.reward_type,
      rarity: item.reward.rarity,
      imageUrl: imageUrlForItem(item),
      count: 1,
    });
  }

  return [...grouped.values()].sort((a, b) => (
    a.rewardType.localeCompare(b.rewardType)
    || a.displayName.localeCompare(b.displayName)
  ));
}

function buildBubbles(items: GameItemLockerEntry[]): Bubble[] {
  const spread = Math.max(170, Math.sqrt(Math.max(items.length, 1)) * 46);
  return items.map((item, index) => {
    const angle = index * 2.399963 + seededUnit(item.id) * 0.3;
    const ring = Math.sqrt(index + 1) * spread * 0.16;
    const jitter = 28 + seededUnit(item.id + 12) * 48;
    return {
      id: item.id,
      item,
      x: Math.cos(angle) * (ring + jitter),
      y: Math.sin(angle) * (ring + jitter),
      vx: (seededUnit(item.id + 31) - 0.5) * 0.6,
      vy: (seededUnit(item.id + 47) - 0.5) * 0.6,
      radius: 42 + seededUnit(item.id + 5) * 15,
      seed: seededUnit(item.id + 90),
      image: null,
      imageLoaded: false,
    };
  });
}

function getCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function toWorld(point: { x: number; y: number }, canvas: HTMLCanvasElement, viewport: ViewportState) {
  return {
    x: (point.x - canvas.clientWidth / 2 - viewport.x) / viewport.scale,
    y: (point.y - canvas.clientHeight / 2 - viewport.y) / viewport.scale,
  };
}

function drawBubble(ctx: CanvasRenderingContext2D, bubble: Bubble, viewport: ViewportState, time: number, width: number, height: number) {
  const scale = viewport.scale;
  const screenX = width / 2 + viewport.x + bubble.x * scale;
  const screenY = height / 2 + viewport.y + bubble.y * scale;
  const radius = bubble.radius * scale;
  if (screenX < -radius || screenX > width + radius || screenY < -radius || screenY > height + radius) return;

  const rarity = bubble.item.reward.rarity.toLowerCase();
  const accent = RARITY_COLORS[rarity] || RARITY_COLORS.common;
  const wobble = Math.sin(time * 0.0016 + bubble.seed * 10) * radius * 0.035;

  ctx.save();
  ctx.translate(screenX, screenY + wobble);

  const outer = ctx.createRadialGradient(-radius * 0.32, -radius * 0.42, radius * 0.08, 0, 0, radius);
  outer.addColorStop(0, "rgba(255,255,255,0.72)");
  outer.addColorStop(0.42, "rgba(255,255,255,0.18)");
  outer.addColorStop(0.74, "rgba(255,255,255,0.07)");
  outer.addColorStop(1, "rgba(5,13,18,0.56)");
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.76;
  ctx.lineWidth = Math.max(1, radius * 0.045);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.68, 0, Math.PI * 2);
  ctx.clip();
  if (bubble.image && bubble.imageLoaded) {
    const imageRatio = bubble.image.width / Math.max(bubble.image.height, 1);
    const box = radius * 1.32;
    const drawWidth = imageRatio >= 1 ? box : box * imageRatio;
    const drawHeight = imageRatio >= 1 ? box / imageRatio : box;
    ctx.drawImage(bubble.image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.beginPath();
  ctx.ellipse(-radius * 0.3, -radius * 0.38, radius * 0.22, radius * 0.11, -0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function ItemLockerCanvas({ items }: { items: GameItemLockerEntry[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bubblesRef = useRef<Bubble[]>([]);
  const viewportRef = useRef<ViewportState>({ x: 0, y: 0, scale: 1 });
  const pointerRef = useRef<PointerState>({
    x: 0,
    y: 0,
    worldX: 0,
    worldY: 0,
    dx: 0,
    dy: 0,
    active: false,
    dragging: false,
    dragX: 0,
    dragY: 0,
  });

  useEffect(() => {
    const bubbles = buildBubbles(items);
    bubblesRef.current = bubbles;

    for (const bubble of bubbles) {
      const src = imageUrlForItem(bubble.item);
      if (!src) continue;
      const image = new window.Image();
      bubble.image = image;
      image.onload = () => {
        bubble.imageLoaded = true;
      };
      image.decoding = "async";
      image.src = src;
    }
  }, [items]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let frame = 0;
    let lastTime = performance.now();
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const tick = (time: number) => {
      const delta = Math.min(32, time - lastTime) / 16.67;
      lastTime = time;
      const viewport = viewportRef.current;
      const pointer = pointerRef.current;
      const bubbles = bubblesRef.current;

      ctx.clearRect(0, 0, width, height);
      const background = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.74);
      background.addColorStop(0, "rgba(20,184,166,0.12)");
      background.addColorStop(0.52, "rgba(9,19,25,0.58)");
      background.addColorStop(1, "rgba(3,8,12,0.92)");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      for (const bubble of bubbles) {
        const distanceToCenter = Math.hypot(bubble.x, bubble.y) || 1;
        const gravity = 0.006 + Math.min(0.026, distanceToCenter / 22000);
        bubble.vx += (-bubble.x / distanceToCenter) * gravity * delta;
        bubble.vy += (-bubble.y / distanceToCenter) * gravity * delta;

        if (pointer.active && !pointer.dragging) {
          const pointerDistance = Math.hypot(bubble.x - pointer.worldX, bubble.y - pointer.worldY);
          const reach = bubble.radius + 118 / viewport.scale;
          if (pointerDistance < reach) {
            const influence = (1 - pointerDistance / reach) ** 2;
            bubble.vx += (pointer.dx / viewport.scale) * 0.052 * influence;
            bubble.vy += (pointer.dy / viewport.scale) * 0.052 * influence;
          }
        }
      }

      if (bubbles.length <= 220) {
        for (let i = 0; i < bubbles.length; i += 1) {
          for (let j = i + 1; j < bubbles.length; j += 1) {
            const a = bubbles[i];
            const b = bubbles[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy) || 1;
            const minDistance = (a.radius + b.radius) * 0.84;
            if (distance >= minDistance) continue;
            const overlap = (minDistance - distance) * 0.5;
            const nx = dx / distance;
            const ny = dy / distance;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
            const impulse = ((b.vx - a.vx) * nx + (b.vy - a.vy) * ny) * 0.018;
            a.vx += impulse * nx;
            a.vy += impulse * ny;
            b.vx -= impulse * nx;
            b.vy -= impulse * ny;
          }
        }
      }

      for (const bubble of bubbles) {
        bubble.vx *= 0.986;
        bubble.vy *= 0.986;
        bubble.x += bubble.vx * delta;
        bubble.y += bubble.vy * delta;
        drawBubble(ctx, bubble, viewport, time, width, height);
      }

      pointer.dx *= 0.72;
      pointer.dy *= 0.72;
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const pointer = pointerRef.current;
    const point = getCanvasPoint(canvas, event.clientX, event.clientY);
    const world = toWorld(point, canvas, viewportRef.current);

    if (pointer.dragging) {
      viewportRef.current.x += event.clientX - pointer.dragX;
      viewportRef.current.y += event.clientY - pointer.dragY;
      pointer.dragX = event.clientX;
      pointer.dragY = event.clientY;
    } else {
      pointer.dx = point.x - pointer.x;
      pointer.dy = point.y - pointer.y;
    }

    pointer.x = point.x;
    pointer.y = point.y;
    pointer.worldX = world.x;
    pointer.worldY = world.y;
    pointer.active = true;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current.dragging = true;
    pointerRef.current.dragX = event.clientX;
    pointerRef.current.dragY = event.clientY;
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId);
    pointerRef.current.dragging = false;
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const canvas = event.currentTarget;
    const viewport = viewportRef.current;
    const point = getCanvasPoint(canvas, event.clientX, event.clientY);
    const before = toWorld(point, canvas, viewport);
    const nextScale = Math.max(0.38, Math.min(2.8, viewport.scale * Math.exp(-event.deltaY * 0.0012)));
    viewport.scale = nextScale;
    viewport.x = point.x - canvas.clientWidth / 2 - before.x * nextScale;
    viewport.y = point.y - canvas.clientHeight / 2 - before.y * nextScale;
  }

  function resetView() {
    viewportRef.current = { x: 0, y: 0, scale: 1 };
  }

  return (
    <div className={styles.canvasWrap}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        aria-label="Interactive item locker canvas"
        onPointerDown={handlePointerDown}
        onPointerLeave={() => {
          pointerRef.current.active = false;
          pointerRef.current.dragging = false;
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />
      <button type="button" className={styles.resetButton} onClick={resetView}>
        <FaCompress />
        <span>Center View</span>
      </button>
    </div>
  );
}

export function ItemLockerPage() {
  const { user, initialized } = useAuth();
  const [locker, setLocker] = useState<GameItemLockerResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized || !user) {
      setLocker(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await fetchGameItemLocker();
        if (!cancelled) setLocker(result);
      } catch (nextError) {
        if (!cancelled) setError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialized, user]);

  const items = useMemo(() => (
    locker?.items.filter((item) => LOCKER_TYPES.has(item.reward_type)) || []
  ), [locker]);

  const drawerItems = useMemo(() => buildLockerList(locker?.items || []), [locker]);
  const hatCount = locker?.summary.counts_by_type.hat || 0;
  const itemCount = locker?.summary.counts_by_type.item || 0;

  return (
    <SiteShell fullBleed hideFooter>
      <section className={styles.page}>
        <div className={styles.topPanel}>
          <div className={styles.headingBlock}>
            <Link href="/games/capsule-gacha" className={styles.backLink}>
              <FaArrowLeft />
              <span>Back to Capsule Gacha</span>
            </Link>
            <div>
              <span className={styles.kicker}>Item Locker</span>
              <h1 className={styles.title}>My Collection</h1>
            </div>
          </div>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <span>Total bubbles</span>
              <strong>{items.length}</strong>
            </div>
            <div className={styles.stat}>
              <span>Hats</span>
              <strong>{hatCount}</strong>
            </div>
            <div className={styles.stat}>
              <span>Items</span>
              <strong>{itemCount}</strong>
            </div>
          </div>
        </div>

        <div className={styles.canvasPanel}>
          {error ? (
            <div className={styles.stateCard}>
              <FaBoxOpen />
              <h2>Locker could not load</h2>
              <p>{error}</p>
            </div>
          ) : !initialized || isLoading ? (
            <div className={styles.stateCard}>
              <FaExpand />
              <h2>Inflating bubbles</h2>
              <p>Your locker canvas is loading.</p>
            </div>
          ) : !user ? (
            <div className={styles.stateCard}>
              <FaBoxOpen />
              <h2>Sign in to open your locker</h2>
              <p>The item locker is tied to your gacha pull history.</p>
              <Link href="/login" className={styles.stateAction}>Sign In</Link>
            </div>
          ) : items.length ? (
            <ItemLockerCanvas items={items} />
          ) : (
            <div className={styles.stateCard}>
              <FaHandPointer />
              <h2>No hats or items yet</h2>
              <p>Pull Capsule Gacha rewards of type hat or item and they will appear here as bubbles.</p>
              <Link href="/games/capsule-gacha" className={styles.stateAction}>Go Pull</Link>
            </div>
          )}
        </div>

        {!isDrawerOpen ? (
          <button
            type="button"
            className={styles.drawerHandle}
            aria-expanded={isDrawerOpen}
            onClick={() => setIsDrawerOpen(true)}
          >
            <FaListUl />
            <span>Collection</span>
          </button>
        ) : null}

        <aside className={`${styles.drawer} ${isDrawerOpen ? styles.drawerOpen : ""}`.trim()} aria-label="Won item list">
          <div className={styles.drawerContent}>
            <div className={styles.drawerHead}>
              <div>
                <span className={styles.kicker}>Collection List</span>
                <h2>Won Prizes</h2>
              </div>
              <button
                type="button"
                className={styles.drawerClose}
                aria-label="Close collection drawer"
                onClick={() => setIsDrawerOpen(false)}
              >
                <FaXmark />
              </button>
            </div>

            <div className={styles.drawerList}>
              {!initialized || isLoading ? (
                <div className={styles.drawerEmpty}>Loading collection...</div>
              ) : !user ? (
                <div className={styles.drawerEmpty}>Sign in to view your collection.</div>
              ) : drawerItems.length ? drawerItems.map((item) => (
                <article key={item.key} className={styles.drawerItem}>
                  <div className={styles.drawerThumb} style={item.imageUrl ? { backgroundImage: `url("${item.imageUrl}")` } : undefined} />
                  <div className={styles.drawerItemBody}>
                    <strong>{item.displayName}</strong>
                    <span>{item.rarity} · {rewardTypeLabel(item.rewardType)}</span>
                  </div>
                  <span className={styles.drawerCount}>x{item.count}</span>
                </article>
              )) : (
                <div className={styles.drawerEmpty}>No gacha prizes won yet.</div>
              )}
            </div>
          </div>
        </aside>

        <div className={styles.instructions} style={{ "--panel-count": "3" } as CSSProperties}>
          <span>Move the mouse through bubbles to nudge them.</span>
          <span>Drag anywhere to pan the view.</span>
          <span>Scroll to zoom in and out.</span>
        </div>
      </section>
    </SiteShell>
  );
}
