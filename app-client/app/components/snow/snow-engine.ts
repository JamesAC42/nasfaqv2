// The snow overlay: one fixed canvas under the top bar, pointer-events off, drawn from pre-rendered
// sprites. Written so it can't get in a trader's way:
// - No layout work per frame. Panel edges are measured every few seconds through a one-shot
//   IntersectionObserver, which hands over rects without forcing a layout; the pointer and scroll
//   position come from passive listeners.
// - No allocation per frame: flakes live in typed arrays.
// - It stops when the tab is hidden, caps its flake count and pixel ratio by device, and thins itself
//   out if frames run long.
// The depth comes from four layers that fall, drift and parallax at different rates. Wind is a slow
// wander plus gusts that sweep across the screen as a front, so they reach one side first.

export type SnowOptions = {
  amount: number;
  speed: number;
  size: number;
  wind: number;
  settle: boolean;
  reactive: boolean;
  /** Calm mode: nearly still, no gusts, nothing reacts. */
  still: boolean;
};

export type SnowTone = "dark" | "light";

type Layer = {
  share: number;
  capacity: number;
  size: [number, number];
  fall: [number, number];
  alpha: [number, number];
  /** How much of the wind reaches it. */
  drift: number;
  /** How far it moves with the page when scrolling. */
  parallax: number;
  sway: number;
  sprite: "small" | "medium" | "large" | "bokeh";
};

const LAYERS: Layer[] = [
  { share: 0.4, capacity: 460, size: [1.1, 1.8], fall: [13, 21], alpha: [0.24, 0.46], drift: 0.35, parallax: 0.05, sway: 5, sprite: "small" },
  { share: 0.36, capacity: 380, size: [2, 3.2], fall: [25, 39], alpha: [0.44, 0.68], drift: 0.6, parallax: 0.14, sway: 11, sprite: "medium" },
  { share: 0.21, capacity: 220, size: [3.2, 5.2], fall: [45, 68], alpha: [0.72, 0.94], drift: 0.85, parallax: 0.3, sway: 19, sprite: "large" },
  // Out-of-focus flakes just past the lens.
  { share: 0.03, capacity: 36, size: [26, 58], fall: [92, 135], alpha: [0.06, 0.14], drift: 1.15, parallax: 0.7, sway: 30, sprite: "bokeh" },
];
const NEAR = 2;
const BOKEH = 3;
const TOTAL = LAYERS.reduce((sum, layer) => sum + layer.capacity, 0);
const CRYSTAL_SHARE = 0.26;

const WIND_MAX = 150; // px/s at full slider
const GUST_FRONT_SPEED = 1100; // px/s across the screen
const LEDGE_STEP = 7; // px between height samples
const DRIFT_STEP = 6;
const LEDGE_MIN_WIDTH = 150;
const LEDGE_GAP = 72; // no two ledges this close over the same stretch of screen
const LEDGE_HEIGHT = 6.5;
const CATCH_CHANCE = 0.5; // the rest of the near flakes fall past an edge
const MAX_PUFFS = 180;
const MEASURE_EVERY = 3.5; // seconds
const TAU = Math.PI * 2;

// Tags that are never a shelf, so the walk over the page stays short.
const NOT_LEDGES = new Set(["A", "BUTTON", "IMG", "svg", "CANVAS", "SPAN", "INPUT", "SELECT", "TEXTAREA", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "P", "H1", "H2", "H3", "H4", "UL", "OL", "LI", "LABEL"]);

type Ledge = {
  element: Element;
  edge: "top" | "bottom";
  x0: number;
  x1: number;
  /** Document y, so it moves with the page. */
  y: number;
  height: Float32Array;
  cap: Float32Array;
  /** Whether it has anything on it to draw. */
  any: boolean;
};

type LedgeCandidate = { top: boolean; bottom: boolean };

type Sprites = {
  small: HTMLCanvasElement;
  medium: HTMLCanvasElement;
  large: HTMLCanvasElement;
  bokeh: HTMLCanvasElement;
  crystals: HTMLCanvasElement[];
};

const TONES: Record<SnowTone, { flake: string; core: string; pile: string; pileShade: string; pileEdge: string | null; sleigh: string; sleighAlpha: number }> = {
  dark: { flake: "#eaf4ff", core: "#ffffff", pile: "rgba(240, 247, 255, 0.96)", pileShade: "rgba(176, 205, 240, 0.78)", pileEdge: null, sleigh: "#dbe9ff", sleighAlpha: 0.62 },
  // White on a white page is invisible: flakes go a cold blue-gray, and piles get an edge.
  light: { flake: "#6a8fc2", core: "#a9c4e6", pile: "rgba(233, 241, 250, 0.98)", pileShade: "rgba(205, 221, 240, 0.9)", pileEdge: "rgba(112, 145, 186, 0.55)", sleigh: "#54709a", sleighAlpha: 0.7 },
};

const GOLD = { flake: "#ffcf73", core: "#fff4d6" };

function random(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function offscreen(size: number, width = size) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = size;
  return canvas;
}

function softDot(size: number, color: string, core: string, plateau = 0.28) {
  const canvas = offscreen(size);
  const ctx = canvas.getContext("2d")!;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, core);
  gradient.addColorStop(plateau, color);
  gradient.addColorStop(1, `${color}00`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, TAU);
  ctx.fill();
  return canvas;
}

// Soft all the way out: a hard-rimmed disc this size reads as a smudge on the glass, not a flake.
function bokehDisc(size: number, color: string) {
  const canvas = offscreen(size);
  const ctx = canvas.getContext("2d")!;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.35, `${color}b0`);
  gradient.addColorStop(0.7, `${color}38`);
  gradient.addColorStop(1, `${color}00`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, TAU);
  ctx.fill();
  return canvas;
}

// Three kinds of six-armed crystal. Real snow has six-fold symmetry; v1's flakes were PNGs.
function crystal(kind: number, color: string) {
  const size = 56;
  const canvas = offscreen(size);
  const ctx = canvas.getContext("2d")!;
  const r = size / 2 - 3;
  ctx.translate(size / 2, size / 2);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = 2.6;
  for (let arm = 0; arm < 6; arm += 1) {
    ctx.save();
    ctx.rotate((arm * TAU) / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r);
    const branches: Array<[number, number]> = kind === 0 ? [[0.42, 0.3], [0.68, 0.22]] : kind === 1 ? [[0.56, 0.34]] : [[0.3, 0.17], [0.52, 0.27], [0.76, 0.18]];
    for (const [at, length] of branches) {
      ctx.moveTo(0, -r * at);
      ctx.lineTo(-r * length, -r * (at + length * 0.72));
      ctx.moveTo(0, -r * at);
      ctx.lineTo(r * length, -r * (at + length * 0.72));
    }
    ctx.stroke();
    ctx.restore();
  }
  if (kind === 1) {
    // A plate in the middle.
    ctx.beginPath();
    for (let side = 0; side <= 6; side += 1) {
      const angle = (side * TAU) / 6 + Math.PI / 6;
      ctx.lineTo(Math.cos(angle) * r * 0.32, Math.sin(angle) * r * 0.32);
    }
    ctx.stroke();
  }
  return canvas;
}

function makeSprites(color: string, core: string): Sprites {
  return {
    small: softDot(8, color, core),
    medium: softDot(16, color, core),
    large: softDot(32, color, core),
    bokeh: bokehDisc(96, color),
    crystals: [0, 1, 2].map((kind) => crystal(kind, core)),
  };
}

// The sleigh, drawn once. A silhouette in the far distance, towing the only banner a trader would hang
// on it: the Santa Claus rally is a real thing that markets do in late December.
function makeSleigh(color: string) {
  const width = 372;
  const height = 64;
  const canvas = offscreen(height * 2, width * 2);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Banner and tow line, behind the sleigh.
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font-martian").trim();
  ctx.font = `700 11px ${font || "monospace"}, monospace`;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(100, 36);
  ctx.lineTo(120, 40);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(4, 30);
  ctx.lineTo(100, 30);
  ctx.quadraticCurveTo(103, 36, 100, 42);
  ctx.lineTo(4, 42);
  ctx.quadraticCurveTo(10, 36, 4, 30);
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  ctx.textAlign = "center";
  ctx.fillText("SANTA RALLY", 54, 36.5);
  ctx.globalCompositeOperation = "source-over";

  // Sleigh: runner, body, driver and his sack.
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(118, 53);
  ctx.lineTo(164, 53);
  ctx.quadraticCurveTo(174, 53, 174, 45);
  ctx.moveTo(130, 53);
  ctx.lineTo(130, 47);
  ctx.moveTo(156, 53);
  ctx.lineTo(156, 47);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(118, 34);
  ctx.quadraticCurveTo(116, 47, 128, 47);
  ctx.lineTo(158, 47);
  ctx.quadraticCurveTo(170, 45, 172, 30);
  ctx.quadraticCurveTo(162, 36, 152, 36);
  ctx.lineTo(132, 36);
  ctx.quadraticCurveTo(124, 36, 118, 34);
  ctx.fill();
  ctx.beginPath(); // sack
  ctx.ellipse(127, 28, 8, 9, -0.2, 0, TAU);
  ctx.fill();
  ctx.beginPath(); // driver
  ctx.moveTo(138, 37);
  ctx.quadraticCurveTo(136, 22, 145, 21);
  ctx.quadraticCurveTo(152, 22, 152, 37);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(146, 18, 4, 0, TAU);
  ctx.fill();
  ctx.beginPath(); // hat
  ctx.moveTo(142, 16);
  ctx.quadraticCurveTo(146, 8, 139, 9);
  ctx.quadraticCurveTo(150, 7, 150, 16);
  ctx.fill();

  // Reins, and four reindeer mid-gallop, each a touch higher: they're taking off.
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(172, 31);
  ctx.quadraticCurveTo(250, 32, 356, 16);
  ctx.stroke();
  for (let deer = 0; deer < 4; deer += 1) {
    const x = 194 + deer * 42;
    const y = 36 - deer * 4;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath(); // body
    ctx.ellipse(0, 0, 11, 4.6, -0.08, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 2.6;
    ctx.beginPath(); // neck
    ctx.moveTo(8, -2);
    ctx.lineTo(14, -9);
    ctx.stroke();
    ctx.beginPath(); // head
    ctx.ellipse(16.5, -10.5, 3.8, 2.2, 0.28, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.beginPath(); // legs, thrown forward and back
    ctx.moveTo(8, 2);
    ctx.lineTo(16, 9);
    ctx.moveTo(5, 3);
    ctx.lineTo(11, 11);
    ctx.moveTo(-8, 2);
    ctx.lineTo(-16, 9);
    ctx.moveTo(-5, 3);
    ctx.lineTo(-13, 11);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); // antlers
    ctx.moveTo(14.5, -12);
    ctx.lineTo(12, -19);
    ctx.moveTo(13.2, -15.5);
    ctx.lineTo(9, -17);
    ctx.moveTo(16, -12.5);
    ctx.lineTo(17, -19);
    ctx.moveTo(16.5, -16);
    ctx.lineTo(20, -18.5);
    ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.beginPath(); // tail
    ctx.moveTo(-10.5, -1.5);
    ctx.lineTo(-14, -4);
    ctx.stroke();
    ctx.restore();
  }
  return { canvas, width, height };
}

function visibleColor(color: string) {
  return color !== "transparent" && !/,\s*0\)$/.test(color);
}

// The page's horizontal lines worth catching snow, read from computed styles only (no rects here).
// Sticky and floating things are left out: they don't move with the page, so a pile wouldn't either.
function findLedgeCandidates() {
  const found = new Map<Element, LedgeCandidate>();
  const main = document.querySelector("main");
  if (!main) return found;
  let level: Element[] = Array.from(main.children);
  let visited = 0;
  for (let depth = 0; depth < 6 && level.length && visited < 260; depth += 1) {
    const next: Element[] = [];
    for (const element of level) {
      visited += 1;
      if (visited > 260) break;
      if (NOT_LEDGES.has(element.tagName)) continue;
      const style = getComputedStyle(element);
      if (style.position === "sticky" || style.position === "fixed" || style.position === "absolute" || style.display === "none" || style.display === "contents") {
        if (style.display === "contents") next.push(...Array.from(element.children));
        continue;
      }
      const top = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none" && visibleColor(style.borderTopColor);
      const bottom = parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== "none" && visibleColor(style.borderBottomColor);
      if (top || bottom) found.set(element, { top, bottom });
      else if (visibleColor(style.backgroundColor)) found.set(element, { top: true, bottom: false });
      // What's inside a scroller moves on its own.
      if (style.overflowY === "auto" || style.overflowY === "scroll") continue;
      next.push(...Array.from(element.children));
    }
    level = next;
  }
  return found;
}

export class SnowEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private options: SnowOptions;
  private tone: SnowTone;

  private sprites: Sprites;
  private gold: Sprites;
  private sleighSprite: ReturnType<typeof makeSleigh> | null = null;

  private readonly coarse: boolean;
  private readonly maxFlakes: number;
  private readonly maxDpr: number;
  private readonly frameMs: number;

  private width = 0;
  private height = 0;
  private viewportHeight = 0;
  private dpr = 1;

  // Flakes, one slice of each array per layer.
  private readonly x = new Float32Array(TOTAL);
  private readonly y = new Float32Array(TOTAL);
  private readonly vx = new Float32Array(TOTAL);
  private readonly kickY = new Float32Array(TOTAL);
  private readonly fall = new Float32Array(TOTAL);
  private readonly size = new Float32Array(TOTAL);
  private readonly alpha = new Float32Array(TOTAL);
  private readonly phase = new Float32Array(TOTAL);
  private readonly rotation = new Float32Array(TOTAL);
  private readonly spin = new Float32Array(TOTAL);
  private readonly luck = new Float32Array(TOTAL);
  private readonly shape = new Uint8Array(TOTAL); // 0 dot, 1-3 a crystal
  private readonly alive = new Uint8Array(TOTAL);
  private readonly starts: number[] = [];
  private readonly active = LAYERS.map(() => 0);
  private readonly target = LAYERS.map(() => 0);

  // Powder knocked loose, and glitter behind the sleigh.
  private readonly puffX = new Float32Array(MAX_PUFFS);
  private readonly puffY = new Float32Array(MAX_PUFFS);
  private readonly puffVx = new Float32Array(MAX_PUFFS);
  private readonly puffVy = new Float32Array(MAX_PUFFS);
  private readonly puffLife = new Float32Array(MAX_PUFFS);
  private readonly puffSpan = new Float32Array(MAX_PUFFS);
  private readonly puffSize = new Float32Array(MAX_PUFFS);
  private readonly puffGold = new Uint8Array(MAX_PUFFS);
  private puffNext = 0;

  private drift = new Float32Array(0);
  private driftCap = new Float32Array(0);
  private driftGradient: CanvasGradient | null = null;
  private bottomInset = 0;

  private ledges: Ledge[] = [];
  private measuring = false;
  private measureDue = 0;
  private main: Element | null = null;
  private pileAlpha = 1;

  private time = 0;
  private lastFrame = 0;
  private raf = 0;
  private destroyed = false;

  private gustStart = -100;
  private gustDirection = 1;
  private gustPower = 0;
  private gustHold = 2;
  private nextGust = 0;
  private lastSpindrift = 0;

  private blizzardUntil = 0;
  private goldUntil = 0;
  private sleighStart = -1;
  private sleighY = 0;
  private nextSleigh = 0;
  private lastGlitter = 0;

  private scrollY = 0;
  private pendingScroll = 0;
  private lastScrollAt = -10;
  private lastShake = 0;

  private pointerX = -1000;
  private pointerY = -1000;
  private pointerVx = 0;
  private pointerVy = 0;
  private pointerDx = 0;
  private pointerDy = 0;
  private pointerOn = false;

  private quality = 1;
  private qualityFrames = 0;
  private qualityMs = 0;
  private slowWindows = 0;
  private lastSlow = 0;

  private readonly resizeObserver: ResizeObserver;
  private readonly mainObserver: ResizeObserver;

  constructor(private readonly canvas: HTMLCanvasElement, options: SnowOptions, tone: SnowTone) {
    this.ctx = canvas.getContext("2d")!;
    this.options = options;
    this.tone = tone;
    this.sprites = makeSprites(TONES[tone].flake, TONES[tone].core);
    this.gold = makeSprites(GOLD.flake, GOLD.core);

    this.coarse = matchMedia("(pointer: coarse)").matches;
    const phone = this.coarse && matchMedia("(max-width: 720px)").matches;
    const cores = navigator.hardwareConcurrency ?? 8;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const slow = cores <= 4 || memory <= 4;
    this.maxFlakes = phone ? 140 : slow ? 320 : 900;
    this.maxDpr = phone ? 2 : slow ? 1.5 : 2;
    this.frameMs = phone ? 1000 / 30 : 1000 / 60;

    let start = 0;
    for (const layer of LAYERS) {
      this.starts.push(start);
      start += layer.capacity;
    }

    this.scrollY = window.scrollY;
    this.nextGust = random(6, 14);
    this.nextSleigh = random(180, 420);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.mainObserver = new ResizeObserver(() => {
      this.measureDue = Math.min(this.measureDue, this.time + 0.2);
    });
    this.watchMain();

    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onWindowResize, { passive: true });
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", this.onPointerLeave, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);

    this.resize();
    this.schedule();
  }

  setOptions(options: SnowOptions) {
    const settleTurnedOn = options.settle && !this.options.settle;
    this.options = options;
    this.applyCounts(false);
    if (settleTurnedOn) this.measureDue = 0;
    if (!options.settle) this.ledges = [];
    if (options.still) {
      this.gustStart = -100;
      this.sleighStart = -1;
      this.blizzardUntil = 0;
      this.goldUntil = 0;
    }
  }

  setTone(tone: SnowTone) {
    if (tone === this.tone) return;
    this.tone = tone;
    this.sprites = makeSprites(TONES[tone].flake, TONES[tone].core);
    this.sleighSprite = null;
    this.driftGradient = null;
  }

  /** A new page: its panels aren't the old page's. */
  pageChanged() {
    this.ledges = [];
    this.watchMain();
    this.measureDue = this.time + 0.5;
  }

  /** A front of wind crossing the screen. Stronger with more wind set. */
  gust(power = random(50, 90), direction?: number) {
    if (this.options.still) return;
    this.gustStart = this.time;
    this.gustDirection = direction ?? (this.options.wind === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(this.options.wind));
    this.gustPower = power + Math.abs(this.options.wind) * 170;
    this.gustHold = random(1.2, 2.6);
  }

  /** Some of the snow falls gold for a few seconds: your order filled. */
  goldRush() {
    if (!this.options.still) this.goldUntil = this.time + 9;
  }

  blizzard() {
    if (this.options.still) return;
    this.blizzardUntil = this.time + 16;
    this.applyCounts(false);
    this.gust(220);
  }

  flySleigh() {
    if (this.options.still || this.sleighStart >= 0) return;
    this.sleighStart = this.time;
    this.sleighY = this.height * random(0.2, 0.42);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.mainObserver.disconnect();
    window.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("pointermove", this.onPointerMove);
    document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  private readonly onScroll = () => {
    const y = window.scrollY;
    this.pendingScroll += y - this.scrollY;
    this.scrollY = y;
    this.lastScrollAt = this.time;
  };

  private readonly onWindowResize = () => {
    this.viewportHeight = window.innerHeight;
    this.resize();
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    if (this.pointerOn) {
      this.pointerDx += event.clientX - this.pointerX;
      this.pointerDy += event.clientY - this.pointerY;
    }
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.pointerOn = true;
  };

  private readonly onPointerLeave = () => {
    this.pointerOn = false;
  };

  private readonly onVisibility = () => {
    cancelAnimationFrame(this.raf);
    if (document.visibilityState === "visible") {
      this.lastFrame = 0;
      this.schedule();
    }
  };

  private watchMain() {
    const main = document.querySelector("main");
    if (main === this.main) return;
    if (this.main) this.mainObserver.unobserve(this.main);
    this.main = main;
    if (main) this.mainObserver.observe(main);
  }

  // ── Sizing ─────────────────────────────────────────────────────────────────

  private resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality < 0.7 ? 1 : this.maxDpr);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      // Setting a canvas's size clears it and costs an allocation, so only when it really changed.
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const first = this.width === 0;
    const widthChanged = width !== this.width;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.viewportHeight = window.innerHeight;
    if (widthChanged) this.resetDrift();
    this.driftGradient = null;
    this.applyCounts(first);
    this.measureDue = this.time + 0.2;
  }

  private resetDrift() {
    const samples = Math.ceil(this.width / DRIFT_STEP) + 2;
    const peak = this.coarse ? 11 : 20;
    const a = random(0, TAU);
    const b = random(0, TAU);
    const c = random(0, TAU);
    this.drift = new Float32Array(samples);
    this.driftCap = new Float32Array(samples);
    for (let i = 0; i < samples; i += 1) {
      // Dunes: long rolls with smaller ones on top.
      const shape = 0.56 + 0.26 * Math.sin(i * 0.031 + a) + 0.14 * Math.sin(i * 0.083 + b) + 0.06 * Math.sin(i * 0.21 + c);
      this.driftCap[i] = peak * Math.max(0.14, shape);
      this.drift[i] = this.driftCap[i] * 0.5;
    }
  }

  // How many flakes each layer should have. New ones start above the screen. Extras go at once when a
  // slider comes down; `retire` lets them finish falling instead, for the end of a blizzard.
  private applyCounts(scatter: boolean, retire = false) {
    if (!this.width) return;
    const { amount, still } = this.options;
    const megapixels = (this.width * this.height) / 1e6;
    let total = Math.max((30 + 300 * amount ** 1.4) * megapixels, amount * 140) * this.quality;
    if (still) total *= 0.5;
    if (this.time < this.blizzardUntil) total *= 2.4;
    total = Math.min(total, this.maxFlakes);
    LAYERS.forEach((layer, index) => {
      let target = Math.min(layer.capacity, Math.round(total * layer.share));
      if (index === BOKEH && (still || this.quality < 0.7)) target = 0;
      this.target[index] = target;
      const start = this.starts[index];
      for (let i = 0; i < target; i += 1) {
        if (!this.alive[start + i]) this.seed(start + i, index, scatter);
      }
      if (this.active[index] < target) {
        this.active[index] = target;
      } else if (!retire) {
        for (let i = target; i < this.active[index]; i += 1) this.alive[start + i] = 0;
        this.active[index] = target;
      }
    });
  }

  private seed(i: number, layerIndex: number, scatter: boolean) {
    const layer = LAYERS[layerIndex];
    const crystalFlake = layerIndex === NEAR && Math.random() < CRYSTAL_SHARE;
    this.alive[i] = 1;
    this.x[i] = random(-20, this.width + 20);
    this.y[i] = scatter ? random(-20, this.height) : random(-this.height * 0.5, -12);
    this.vx[i] = 0;
    this.kickY[i] = 0;
    this.fall[i] = random(layer.fall[0], layer.fall[1]);
    this.size[i] = crystalFlake ? random(9, 15) : random(layer.size[0], layer.size[1]);
    this.alpha[i] = crystalFlake ? random(0.62, 0.9) : random(layer.alpha[0], layer.alpha[1]);
    this.phase[i] = random(0, TAU);
    this.rotation[i] = random(0, TAU);
    this.spin[i] = random(-0.9, 0.9);
    this.luck[i] = Math.random();
    this.shape[i] = crystalFlake ? 1 + Math.floor(Math.random() * 3) : 0;
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  private schedule() {
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number) => {
    if (this.destroyed) return;
    this.schedule();
    // High-refresh screens get 60 fps, phones 30, and calm mode's slow snow needs less still.
    const frameMs = this.options.still ? 1000 / 24 : this.frameMs;
    const since = now - this.lastFrame;
    if (this.lastFrame && since < frameMs - 3) return;
    this.lastFrame = now;
    const dt = Math.min(since || 16, 50) / 1000;
    this.time += dt;
    if (since && since < 1000) this.watchFrameTime(since, frameMs);
    if (this.time >= this.measureDue) this.measure();
    this.step(dt);
    this.draw();
  };

  // Thin the snow out if frames run long, whatever is to blame; let it back slowly once they don't.
  private watchFrameTime(since: number, frameMs: number) {
    this.qualityFrames += 1;
    this.qualityMs += since;
    if (this.qualityMs < 2000) return;
    const average = this.qualityMs / this.qualityFrames;
    this.qualityFrames = 0;
    this.qualityMs = 0;
    if (average > frameMs * 1.55) {
      this.slowWindows += 1;
      this.lastSlow = this.time;
      if (this.slowWindows >= 2 && this.quality > 0.35) {
        this.slowWindows = 0;
        this.setQuality(Math.max(0.35, this.quality * 0.72));
      }
    } else {
      this.slowWindows = 0;
      if (this.quality < 1 && this.time - this.lastSlow > 45) {
        this.lastSlow = this.time;
        this.setQuality(Math.min(1, this.quality / 0.72));
      }
    }
  }

  private setQuality(quality: number) {
    const dprMatters = this.quality < 0.7 !== quality < 0.7;
    this.quality = quality;
    if (dprMatters) this.resize();
    else this.applyCounts(false);
  }

  private step(dt: number) {
    const { speed, wind, still, reactive, settle } = this.options;
    const t = this.time;
    const { width, height } = this;

    // Wind, shared by everything this frame.
    const steady = wind * WIND_MAX;
    const wander = still ? 0 : (Math.sin(t * 0.11) * 0.6 + Math.sin(t * 0.29 + 1.7) * 0.4) * (9 + Math.abs(wind) * 34);
    const base = (still ? steady * 0.12 : steady) + wander;

    if (!still && t >= this.nextGust) {
      this.gust();
      this.nextGust = t + random(9, 26);
    }
    const blizzard = t < this.blizzardUntil;
    if (this.blizzardUntil && !blizzard) {
      this.blizzardUntil = 0;
      this.applyCounts(false, true);
    }
    const gustAge = t - this.gustStart;
    const gustEnvelope = gustAge < this.gustHold ? 1 : Math.exp(-(gustAge - this.gustHold) * 1.05);
    const gustOn = gustEnvelope > 0.01;
    const gustReach = gustAge * GUST_FRONT_SPEED;
    const gustPower = this.gustPower * this.gustDirection * gustEnvelope;

    const fallRate = (still ? 0.12 : lerp(0.25, 2.4, speed ** 1.3)) * (blizzard ? 1.75 : 1);

    // Scroll: every layer shifts by its parallax; hard scrolling shakes the piles.
    const scrolled = reactive && !still ? this.pendingScroll : 0;
    this.pendingScroll = 0;
    const scrollSpeed = Math.abs(scrolled) / dt;
    const scrollingNow = t - this.lastScrollAt < 0.14;
    if (settle) {
      const target = scrollingNow ? 0 : 1;
      const rate = scrollingNow ? 16 : 3.2;
      this.pileAlpha += (target - this.pileAlpha) * Math.min(1, dt * rate);
      if (reactive && !still && scrollSpeed > 1500 && t - this.lastShake > 0.4) {
        this.lastShake = t;
        this.shakePiles();
      }
    }
    if (!scrollingNow && this.lastScrollAt > 0 && t - this.lastScrollAt < 0.14 + dt * 2) {
      this.measureDue = Math.min(this.measureDue, t + 0.12);
    }

    // Pointer: flakes part around it and get dragged along when it moves fast.
    const pointerActive = reactive && !still && this.pointerOn && !this.coarse;
    if (pointerActive) {
      this.pointerVx += (this.pointerDx / dt - this.pointerVx) * Math.min(1, dt * 14);
      this.pointerVy += (this.pointerDy / dt - this.pointerVy) * Math.min(1, dt * 14);
    } else {
      this.pointerVx = 0;
      this.pointerVy = 0;
    }
    this.pointerDx = 0;
    this.pointerDy = 0;
    const pointerRadius = 120;
    const pointerRadiusSq = pointerRadius * pointerRadius;

    // Near flakes check these edges as they fall.
    const bottom = this.viewportBottom();
    const catchers = settle && !scrollingNow ? this.visibleLedges() : null;

    const margin = 44;
    for (let l = 0; l < LAYERS.length; l += 1) {
      const layer = LAYERS[l];
      const start = this.starts[l];
      const end = start + this.active[l];
      const response = Math.min(1, dt * (1.2 + l * 0.9));
      const parallaxShift = scrolled * layer.parallax;
      const swayRate = 0.5 + l * 0.14;
      for (let i = start; i < end; i += 1) {
        if (!this.alive[i]) continue;
        let x = this.x[i];
        let y = this.y[i];

        // Horizontal: wind (front included), a slow sway, and eddies that nearby flakes share.
        let air = base;
        if (gustOn) {
          const along = this.gustDirection > 0 ? x : width - x;
          const reached = clamp01((gustReach - along) / 260);
          air += gustPower * reached;
        }
        let targetVx = air * layer.drift;
        if (!still) {
          targetVx += Math.sin(t * swayRate + this.phase[i]) * layer.sway;
          targetVx += Math.sin(x * 0.0043 + t * 0.37 + l) * Math.cos(y * 0.0031 - t * 0.23) * 15 * layer.drift;
        }
        let vx = this.vx[i];
        vx += (targetVx - vx) * response;

        let kick = this.kickY[i];
        if (pointerActive && l > 0) {
          const dx = x - this.pointerX;
          const dy = y - this.pointerY;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq < pointerRadiusSq) {
            const distance = Math.sqrt(distanceSq) + 1;
            const force = (1 - distance / pointerRadius) * layer.drift;
            const push = 420 * force * dt;
            vx += (dx / distance) * push + this.pointerVx * force * dt * 3.2;
            kick += (dy / distance) * push + this.pointerVy * force * dt * 3.2;
          }
        }
        kick *= Math.max(0, 1 - dt * 2.4);

        const nextY = y + (this.fall[i] * fallRate + kick) * dt - parallaxShift;
        x += vx * dt;

        // Landing: only the near layer is close enough to touch anything.
        let landed = false;
        if (l === NEAR && settle) {
          if (nextY >= bottom - this.driftAt(x)) {
            this.depositDrift(x);
            landed = true;
          } else if (catchers) {
            for (let k = 0; k < catchers.length; k += 1) {
              const ledge = catchers[k];
              const edgeY = ledge.y - this.scrollY;
              if (y < edgeY && nextY >= edgeY && x >= ledge.x0 && x <= ledge.x1 && this.luck[i] < CATCH_CHANCE) {
                this.depositLedge(ledge, x);
                landed = true;
                break;
              }
            }
          }
        }
        y = nextY;

        if (landed || y > height + margin) {
          // Back to the top, unless a blizzard is winding down and this one's extra.
          if (i - start >= this.target[l]) {
            this.alive[i] = 0;
            continue;
          }
          this.seed(i, l, false);
          this.y[i] = random(-46, -8);
          continue;
        }
        if (y < -margin * 2) y += height + margin * 2;
        if (x > width + margin) x -= width + margin * 2;
        else if (x < -margin) x += width + margin * 2;

        this.x[i] = x;
        this.y[i] = y;
        this.vx[i] = vx;
        this.kickY[i] = kick;
        if (this.shape[i] && !still) this.rotation[i] += this.spin[i] * dt;
      }
      // Retired flakes off the end of the slice stop costing anything.
      while (this.active[l] > this.target[l] && !this.alive[start + this.active[l] - 1]) this.active[l] -= 1;
    }

    // A strong gust lifts powder off the drift.
    if (settle && gustOn && Math.abs(gustPower) > 110 && t - this.lastSpindrift > 0.05) {
      this.lastSpindrift = t;
      const x = random(0, width);
      const lift = this.driftAt(x);
      if (lift > 2) {
        const index = Math.floor(x / DRIFT_STEP);
        this.drift[index] *= 0.96;
        this.spawnPuff(x, bottom - lift, gustPower * random(0.5, 1), random(-24, -6), random(0.7, 1.5), random(1.2, 2.6), false);
      }
    }

    // Powder and glitter.
    for (let i = 0; i < MAX_PUFFS; i += 1) {
      if (this.puffLife[i] <= 0) continue;
      this.puffLife[i] -= dt;
      this.puffVy[i] += 46 * dt;
      this.puffVx[i] += (base * 0.5 - this.puffVx[i]) * Math.min(1, dt * 0.9);
      this.puffX[i] += this.puffVx[i] * dt;
      this.puffY[i] += this.puffVy[i] * dt - scrolled * 0.3;
    }

    // Reactive extras on their own clocks.
    if (reactive && !still && t >= this.nextSleigh) {
      this.flySleigh();
      this.nextSleigh = t + random(600, 1500);
    }
    if (this.sleighStart >= 0 && t - this.lastGlitter > 0.07) {
      this.lastGlitter = t;
      const { x, y } = this.sleighAt(t);
      this.spawnPuff(x + 124, y + 42, -random(6, 26), random(-6, 16), random(0.9, 2), random(1.2, 2.6), true);
    }
  }

  private viewportBottom() {
    return (this.viewportHeight || this.height) - this.bottomInset;
  }

  private driftAt(x: number) {
    const samples = this.drift;
    if (!samples.length) return 0;
    const position = x / DRIFT_STEP;
    const index = Math.floor(position);
    if (index < 0 || index >= samples.length - 1) return 0;
    return lerp(samples[index], samples[index + 1], position - index);
  }

  private depositDrift(x: number) {
    const center = Math.round(x / DRIFT_STEP);
    for (let offset = -3; offset <= 3; offset += 1) {
      const i = center + offset;
      if (i < 0 || i >= this.drift.length) continue;
      const added = 0.55 * Math.exp(-(offset * offset) / 3.2);
      this.drift[i] = Math.min(this.driftCap[i], this.drift[i] + added);
    }
  }

  private depositLedge(ledge: Ledge, x: number) {
    const center = Math.round((x - ledge.x0) / LEDGE_STEP);
    for (let offset = -3; offset <= 3; offset += 1) {
      const i = center + offset;
      if (i < 0 || i >= ledge.height.length) continue;
      const added = 1.05 * Math.exp(-(offset * offset) / 2.6);
      ledge.height[i] = Math.min(ledge.cap[i], ledge.height[i] + added);
    }
    ledge.any = true;
  }

  private visibleLedges() {
    const list: Ledge[] = [];
    for (const ledge of this.ledges) {
      const edgeY = ledge.y - this.scrollY;
      if (edgeY > 0 && edgeY < this.height) list.push(ledge);
    }
    return list;
  }

  // Scrolling hard knocks the snow off the edges in view. It comes down as powder.
  private shakePiles() {
    let budget = 44;
    for (const ledge of this.visibleLedges()) {
      if (!ledge.any) continue;
      const edgeY = ledge.y - this.scrollY;
      for (let i = 0; i < ledge.height.length; i += 1) {
        const height = ledge.height[i];
        if (height > 1.4 && budget > 0 && Math.random() < 0.12) {
          budget -= 1;
          this.spawnPuff(ledge.x0 + i * LEDGE_STEP, edgeY - height, random(-30, 30), random(-34, 10), random(0.6, 1.3), random(1.2, 2.8), false);
        }
        ledge.height[i] = height * 0.45;
      }
    }
    const bottom = this.viewportBottom();
    for (let n = 0; n < 16 && budget > 0; n += 1, budget -= 1) {
      const x = random(0, this.width);
      this.spawnPuff(x, bottom - this.driftAt(x), random(-40, 40), random(-90, -30), random(0.5, 1.1), random(1.2, 2.6), false);
    }
    for (let i = 0; i < this.drift.length; i += 1) this.drift[i] *= 0.9;
  }

  private spawnPuff(x: number, y: number, vx: number, vy: number, life: number, size: number, gold: boolean) {
    const i = this.puffNext;
    this.puffNext = (i + 1) % MAX_PUFFS;
    this.puffX[i] = x;
    this.puffY[i] = y;
    this.puffVx[i] = vx;
    this.puffVy[i] = vy;
    this.puffLife[i] = life;
    this.puffSpan[i] = life;
    this.puffSize[i] = size;
    this.puffGold[i] = gold ? 1 : 0;
  }

  // Up and to the right, the only direction a rally goes.
  private sleighAt(t: number) {
    const sprite = this.sleighSprite ?? (this.sleighSprite = makeSleigh(TONES[this.tone].sleigh));
    const travelled = (t - this.sleighStart) * 165;
    const span = this.width + sprite.width;
    if (travelled > span) this.sleighStart = -1;
    return { x: travelled - sprite.width, y: this.sleighY - (travelled / span) * 70 + Math.sin(t * 1.5) * 5 };
  }

  // ── Measuring (never per frame) ────────────────────────────────────────────

  private measure() {
    this.measureDue = this.time + MEASURE_EVERY;
    if (this.measuring || document.visibilityState !== "visible") return;
    const nav = document.querySelector("[data-bottom-nav]");
    const candidates = this.options.settle ? findLedgeCandidates() : new Map<Element, LedgeCandidate>();
    if (!nav && !candidates.size) return;
    this.measuring = true;
    const observer = new IntersectionObserver((entries) => {
      observer.disconnect();
      this.measuring = false;
      if (this.destroyed) return;
      this.applyMeasure(entries, candidates, nav);
    });
    if (nav) observer.observe(nav);
    candidates.forEach((_value, element) => observer.observe(element));
  }

  private applyMeasure(entries: IntersectionObserverEntry[], candidates: Map<Element, LedgeCandidate>, nav: Element | null) {
    const lines: Array<{ element: Element; edge: "top" | "bottom"; x0: number; x1: number; y: number }> = [];
    const { width, height } = this;
    this.scrollY = window.scrollY;
    for (const entry of entries) {
      const rect = entry.boundingClientRect;
      if (entry.target === nav) {
        this.bottomInset = rect.height > 0 ? Math.max(0, (this.viewportHeight || height) - rect.top) : 0;
        continue;
      }
      if (rect.width < LEDGE_MIN_WIDTH || rect.height < 6 || rect.bottom < -height || rect.top > height * 2) continue;
      const candidate = candidates.get(entry.target);
      if (!candidate) continue;
      const x0 = Math.max(0, rect.left);
      const x1 = Math.min(width, rect.right);
      if (x1 - x0 < LEDGE_MIN_WIDTH) continue;
      if (candidate.top) lines.push({ element: entry.target, edge: "top", x0, x1, y: rect.top + this.scrollY });
      if (candidate.bottom) lines.push({ element: entry.target, edge: "bottom", x0, x1, y: rect.bottom + this.scrollY });
    }

    // Widest first, skipping any line too close over the same stretch: a table's rows aren't shelves.
    lines.sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0));
    const limit = this.coarse ? 5 : 14;
    const kept: typeof lines = [];
    for (const line of lines) {
      if (kept.length >= limit) break;
      const crowded = kept.some((other) => {
        if (Math.abs(other.y - line.y) >= LEDGE_GAP) return false;
        const overlap = Math.min(other.x1, line.x1) - Math.max(other.x0, line.x0);
        return overlap > (line.x1 - line.x0) * 0.4;
      });
      if (!crowded) kept.push(line);
    }

    const previous = this.ledges;
    this.ledges = kept.map((line) => {
      const known = previous.find((ledge) => ledge.element === line.element && ledge.edge === line.edge);
      const span = line.x1 - line.x0;
      const samples = Math.ceil(span / LEDGE_STEP) + 1;
      if (known && known.height.length === samples) {
        known.x0 = line.x0;
        known.x1 = line.x1;
        known.y = line.y;
        return known;
      }
      return this.newLedge(line, samples);
    });
  }

  private newLedge(line: { element: Element; edge: "top" | "bottom"; x0: number; x1: number; y: number }, samples: number): Ledge {
    const cap = new Float32Array(samples);
    const heights = new Float32Array(samples);
    const a = random(0, TAU);
    const b = random(0, TAU);
    for (let i = 0; i < samples; i += 1) {
      const fromEnd = Math.min(i, samples - 1 - i);
      const taper = clamp01(fromEnd / 5);
      const shape = 0.62 + 0.28 * Math.sin(i * 0.13 + a) + 0.1 * Math.sin(i * 0.41 + b);
      cap[i] = LEDGE_HEIGHT * shape * taper;
      // A dusting from before you got here, in patches.
      const patch = Math.sin(i * 0.09 + b) + Math.sin(i * 0.23 + a);
      heights[i] = patch > 0.2 ? cap[i] * 0.42 * clamp01(patch) : 0;
    }
    return { element: line.element, edge: line.edge, x0: line.x0, x1: line.x1, y: line.y, height: heights, cap, any: true };
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  private draw() {
    const { ctx, dpr } = this;
    const t = this.time;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const sizeScale = this.sizeScale();
    const goldShare = t < this.goldUntil ? clamp01((this.goldUntil - t) / 2.5) * 0.55 : 0;

    this.drawFlakes(0, sizeScale, goldShare);
    if (this.sleighStart >= 0) this.drawSleigh(t);
    this.drawFlakes(1, sizeScale, goldShare);
    if (this.options.settle) this.drawPiles();
    this.drawPuffs();
    this.drawFlakes(NEAR, sizeScale, goldShare);
    this.drawFlakes(BOKEH, sizeScale, 0);
    ctx.globalAlpha = 1;
  }

  private sizeScale() {
    const { size } = this.options;
    return size < 0.45 ? lerp(0.65, 1, size / 0.45) : lerp(1, 2, (size - 0.45) / 0.55);
  }

  private drawFlakes(l: number, sizeScale: number, goldShare: number) {
    const { ctx, dpr } = this;
    const start = this.starts[l];
    const end = start + this.active[l];
    const layer = LAYERS[l];
    const sprite = this.sprites[layer.sprite];
    const goldSprite = this.gold[layer.sprite];
    const t = this.time;
    for (let i = start; i < end; i += 1) {
      if (!this.alive[i]) continue;
      const size = this.size[i] * sizeScale;
      const x = this.x[i];
      const y = this.y[i];
      const golden = goldShare > 0 && this.luck[i] < goldShare;
      const shape = this.shape[i];
      if (shape) {
        // Crystals catch the light as they turn.
        ctx.globalAlpha = this.alpha[i] * (0.72 + 0.28 * Math.sin(t * 1.6 + this.phase[i]));
        const angle = this.rotation[i];
        const cos = Math.cos(angle) * dpr;
        const sin = Math.sin(angle) * dpr;
        ctx.setTransform(cos, sin, -sin, cos, x * dpr, y * dpr);
        ctx.drawImage((golden ? this.gold : this.sprites).crystals[shape - 1], -size / 2, -size / 2, size, size);
      } else {
        ctx.globalAlpha = this.alpha[i];
        ctx.drawImage(golden ? goldSprite : sprite, x - size / 2, y - size / 2, size, size);
      }
    }
    if (l === NEAR) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawPiles() {
    const { ctx } = this;
    const tone = TONES[this.tone];

    // The drift along the bottom of the screen, or on top of the phone's nav.
    const bottom = this.viewportBottom();
    const samples = this.drift;
    if (samples.length) {
      if (!this.driftGradient) {
        const gradient = ctx.createLinearGradient(0, bottom - 18, 0, bottom);
        gradient.addColorStop(0, tone.pile);
        gradient.addColorStop(1, tone.pileShade);
        this.driftGradient = gradient;
      }
      ctx.globalAlpha = this.coarse ? this.pileAlpha : 1;
      ctx.fillStyle = this.driftGradient;
      this.tracePile(samples, 0, DRIFT_STEP, bottom);
      ctx.fill();
      if (tone.pileEdge) {
        ctx.strokeStyle = tone.pileEdge;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Panel edges. They hide during a scroll: the page moves on another thread, so drawn piles would
    // swim against the lines they sit on.
    if (this.pileAlpha < 0.03) return;
    ctx.globalAlpha = this.pileAlpha;
    ctx.fillStyle = tone.pile;
    for (const ledge of this.ledges) {
      if (!ledge.any) continue;
      const edgeY = ledge.y - this.scrollY;
      if (edgeY < -10 || edgeY > this.height + 10) continue;
      this.tracePile(ledge.height, ledge.x0, LEDGE_STEP, edgeY);
      ctx.fill();
      if (tone.pileEdge) {
        ctx.strokeStyle = tone.pileEdge;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  private tracePile(heights: Float32Array, x0: number, step: number, baseY: number) {
    const { ctx } = this;
    const count = heights.length;
    ctx.beginPath();
    ctx.moveTo(x0, baseY);
    let px = x0;
    let py = baseY - heights[0];
    ctx.lineTo(px, py);
    for (let i = 1; i < count; i += 1) {
      const nx = x0 + i * step;
      const ny = baseY - heights[i];
      ctx.quadraticCurveTo(px, py, (px + nx) / 2, (py + ny) / 2);
      px = nx;
      py = ny;
    }
    ctx.lineTo(px, baseY);
    ctx.closePath();
  }

  private drawPuffs() {
    const { ctx } = this;
    const sprite = this.sprites.medium;
    const gold = this.gold.medium;
    for (let i = 0; i < MAX_PUFFS; i += 1) {
      const life = this.puffLife[i];
      if (life <= 0) continue;
      const size = this.puffSize[i];
      ctx.globalAlpha = clamp01(life / this.puffSpan[i]) * 0.8;
      ctx.drawImage(this.puffGold[i] ? gold : sprite, this.puffX[i] - size / 2, this.puffY[i] - size / 2, size, size);
    }
  }

  private drawSleigh(t: number) {
    const { ctx } = this;
    const { x, y } = this.sleighAt(t);
    const sprite = this.sleighSprite;
    if (!sprite) return;
    ctx.globalAlpha = TONES[this.tone].sleighAlpha;
    ctx.drawImage(sprite.canvas, x, y, sprite.width, sprite.height);
  }
}
