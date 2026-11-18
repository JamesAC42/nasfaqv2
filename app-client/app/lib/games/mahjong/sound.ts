"use client";

import { useCallback, useSyncExternalStore } from "react";

// The mahjong table's sound engine. Every cue is a short synthesized sound made with the Web Audio
// API (nothing is downloaded), unless a file for it is hosted: if NEXT_PUBLIC_MAHJONG_SOUNDS_BASE is
// set, each cue first tries `${base}/<cue>.mp3`, preloaded and cached, and any error (a missing file,
// a bad decode, a blocked request) quietly falls back to the synthesized version.
//
// Browsers only allow audio after a user gesture, so the AudioContext is created (and resumed) by the
// first pointer or key press anywhere on the page. Before that, cues do nothing.

export const CUES = [
  "draw",
  "discard",
  "call",
  "riichi",
  "ron",
  "tsumo",
  "win_small",
  "win_big",
  "yakuman",
  "yaku_tick",
  "points_tick",
  "your_turn",
  "clock_low",
  "draw_game",
  "game_start",
  "game_over_win",
  "game_over",
  "ui_click",
  "reaction",
] as const;
export type Cue = (typeof CUES)[number];

const FILES_BASE = (process.env.NEXT_PUBLIC_MAHJONG_SOUNDS_BASE ?? "").replace(/\/+$/, "");

// ── Settings: muted and volume, remembered per browser ──────────────────────────────────────────
const MUTE_KEY = "nasfaq.mahjong.sound-muted";
const VOLUME_KEY = "nasfaq.mahjong.sound-volume";
const DEFAULT_VOLUME = 0.7;

type Settings = { muted: boolean; volume: number };
let settings: Settings | null = null;
const listeners = new Set<() => void>();
const SERVER_SETTINGS: Settings = { muted: false, volume: DEFAULT_VOLUME };

function load(): Settings {
  let muted = false;
  let volume = DEFAULT_VOLUME;
  try {
    muted = window.localStorage.getItem(MUTE_KEY) === "1";
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw !== null && Number.isFinite(Number(raw))) volume = Math.min(1, Math.max(0, Number(raw)));
  } catch {
    /* storage blocked: defaults for this visit */
  }
  return { muted, volume };
}

function current(): Settings {
  if (!settings) settings = load();
  return settings;
}

function store(next: Settings) {
  settings = next;
  try {
    window.localStorage.setItem(MUTE_KEY, next.muted ? "1" : "0");
    window.localStorage.setItem(VOLUME_KEY, String(next.volume));
  } catch {
    /* kept in memory */
  }
  if (master && ctx) master.gain.setTargetAtTime(next.muted ? 0 : next.volume, ctx.currentTime, 0.02);
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  const onStorage = () => {
    settings = null;
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", onStorage);
  };
};

/** { muted, volume 0-1 } and their setters. Server render and first paint say "on, 70%". */
export function useSoundSettings() {
  const value = useSyncExternalStore(subscribe, current, () => SERVER_SETTINGS);
  const setMuted = useCallback((muted: boolean) => store({ ...current(), muted }), []);
  const setVolume = useCallback((volume: number) => store({ ...current(), volume: Math.min(1, Math.max(0, volume)) }), []);
  return { muted: value.muted, volume: value.volume, setMuted, setVolume };
}

// ── The audio context, made on the first gesture ───────────────────────────────────────────────
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let gestured = false;
let installed = false;
let voices = 0;
const buffers = new Map<Cue, AudioBuffer | "loading" | "none">();

function makeContext() {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = current().muted ? 0 : current().volume;
    const squash = ctx.createDynamicsCompressor();
    squash.threshold.value = -18;
    squash.ratio.value = 4;
    master.connect(squash).connect(ctx.destination);
    const length = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

function preload() {
  if (!FILES_BASE || !ctx) return;
  const context = ctx;
  for (const cue of CUES) {
    if (buffers.has(cue)) continue;
    buffers.set(cue, "loading");
    fetch(`${FILES_BASE}/${cue}.mp3`)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("missing"))))
      .then((bytes) => context.decodeAudioData(bytes))
      .then((decoded) => buffers.set(cue, decoded))
      .catch(() => buffers.set(cue, "none"));
  }
}

function unlock() {
  gestured = true;
  const context = makeContext();
  if (!context) return;
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  preload();
}

/** Listens (once) for the first press or key anywhere; that is what lets sound start. Safe to call again. */
export function installSoundUnlock() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const options = { capture: true, passive: true } as const;
  const handler = () => unlock();
  window.addEventListener("pointerdown", handler, options);
  window.addEventListener("keydown", handler, options);
  window.addEventListener("touchend", handler, options);
}

// ── Synthesis ───────────────────────────────────────────────────────────────────────────────────
type NoteOptions = { type?: OscillatorType; gain?: number; attack?: number; to?: number; detune?: number };

/** One tone: a quick attack, then an exponential fade over `dur` seconds. */
function note(context: AudioContext, out: AudioNode, at: number, freq: number, dur: number, options: NoteOptions = {}) {
  const { type = "sine", gain = 0.2, attack = 0.004, to, detune = 0 } = options;
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
  osc.detune.value = detune;
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.linearRampToValueAtTime(gain, at + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(amp).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.03);
  voices += 1;
  osc.onended = () => {
    voices -= 1;
  };
}

/** A burst of filtered noise: the click or brush of a tile on wood. */
function burst(context: AudioContext, out: AudioNode, at: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass") {
  if (!noiseBuffer) return;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const amp = context.createGain();
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  source.connect(filter).connect(amp).connect(out);
  source.start(at, Math.random() * 0.5);
  source.stop(at + dur + 0.02);
}

/**
 * A hard tile clack: a sharp transient and a few short, bright, inharmonic rings, the way a dense
 * plastic or bone tile sounds against the table or another tile, with almost no low thump. Each
 * clack is tuned a little differently so a run of them doesn't sound machine-made. `weight` scales
 * its loudness.
 */
function tap(context: AudioContext, out: AudioNode, at: number, weight = 1, pitch = 1) {
  const p = pitch * (0.96 + Math.random() * 0.08);
  burst(context, out, at, 0.006, 3000 * p, 0.7, 0.5 * weight, "highpass");
  burst(context, out, at, 0.022, 3300 * p, 6, 0.32 * weight);
  note(context, out, at, 2450 * p, 0.05, { type: "sine", gain: 0.11 * weight, attack: 0.0005 });
  note(context, out, at, 3780 * p, 0.035, { type: "sine", gain: 0.07 * weight, attack: 0.0005 });
  note(context, out, at, 5650 * p, 0.022, { type: "sine", gain: 0.035 * weight, attack: 0.0005 });
  note(context, out, at, 640 * p, 0.025, { type: "triangle", gain: 0.05 * weight, attack: 0.001 });
}

const NOTE = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12);
const C5 = NOTE(3);
const E5 = NOTE(7);
const G5 = NOTE(10);
const C6 = NOTE(15);

type Voice = (context: AudioContext, out: AudioNode, at: number, pitch: number) => void;

const SYNTH: Record<Cue, Voice> = {
  draw: (c, o, t, p) => {
    burst(c, o, t - 0.03, 0.04, 2500, 0.9, 0.03);
    tap(c, o, t, 0.45, 1.15 * p);
  },
  discard: (c, o, t, p) => {
    tap(c, o, t, 1, p);
    tap(c, o, t + 0.032, 0.35, 0.94 * p);
  },
  call: (c, o, t) => {
    tap(c, o, t, 0.75, 1.05);
    tap(c, o, t + 0.045, 0.7, 0.98);
    tap(c, o, t + 0.09, 0.6, 1.02);
    note(c, o, t + 0.1, NOTE(-5), 0.2, { type: "triangle", gain: 0.07, to: NOTE(-3) });
  },
  riichi: (c, o, t) => {
    tap(c, o, t, 1.1, 0.8);
    note(c, o, t + 0.04, NOTE(12), 0.7, { type: "sine", gain: 0.12 });
    note(c, o, t + 0.04, NOTE(19), 0.5, { type: "sine", gain: 0.05 });
    burst(c, o, t + 0.02, 0.18, 6000, 3, 0.05);
  },
  ron: (c, o, t) => {
    tap(c, o, t, 1.2, 0.85);
    note(c, o, t + 0.03, NOTE(-2), 0.22, { type: "sawtooth", gain: 0.07, to: NOTE(-2) * 1.01 });
    note(c, o, t + 0.12, NOTE(5), 0.34, { type: "triangle", gain: 0.2 });
    note(c, o, t + 0.12, NOTE(12), 0.3, { type: "sine", gain: 0.08 });
  },
  tsumo: (c, o, t) => {
    [C5, E5, G5].forEach((freq, index) => note(c, o, t + index * 0.075, freq, 0.3, { type: "triangle", gain: 0.17 }));
    note(c, o, t + 0.22, C6, 0.5, { type: "sine", gain: 0.1 });
  },
  win_small: (c, o, t) => {
    [C5, E5, G5].forEach((freq) => note(c, o, t, freq, 0.55, { type: "triangle", gain: 0.1, attack: 0.02 }));
    note(c, o, t, C5 / 2, 0.6, { type: "sine", gain: 0.14, attack: 0.02 });
  },
  win_big: (c, o, t) => {
    [C5, E5, G5, C6].forEach((freq, index) => note(c, o, t + index * 0.09, freq, 0.5, { type: "triangle", gain: 0.14, attack: 0.01 }));
    [C5, E5, G5, C6].forEach((freq) => note(c, o, t + 0.4, freq, 0.9, { type: "sine", gain: 0.08, attack: 0.03 }));
    note(c, o, t + 0.4, C5 / 2, 1, { type: "sine", gain: 0.16, attack: 0.03 });
    burst(c, o, t + 0.38, 0.5, 7000, 2, 0.04);
  },
  yakuman: (c, o, t) => {
    [C5, E5, G5, C6, E5 * 2, G5 * 2].forEach((freq, index) => note(c, o, t + index * 0.1, freq, 0.55, { type: "triangle", gain: 0.13, attack: 0.01 }));
    [C5, E5, G5, C6].forEach((freq) => {
      note(c, o, t + 0.7, freq, 1.6, { type: "sine", gain: 0.09, attack: 0.05 });
      note(c, o, t + 0.7, freq * 1.004, 1.6, { type: "sine", gain: 0.05, attack: 0.05 });
    });
    note(c, o, t + 0.7, C5 / 2, 1.7, { type: "sine", gain: 0.18, attack: 0.05 });
    burst(c, o, t + 0.65, 1.1, 5000, 1.5, 0.05);
  },
  yaku_tick: (c, o, t, p) => {
    note(c, o, t, NOTE(15) * p, 0.16, { type: "sine", gain: 0.13 });
    note(c, o, t, NOTE(22) * p, 0.1, { type: "sine", gain: 0.04 });
  },
  points_tick: (c, o, t, p) => {
    note(c, o, t, 1900 * p, 0.025, { type: "triangle", gain: 0.05, attack: 0.001 });
    burst(c, o, t, 0.012, 3500, 1, 0.04);
  },
  your_turn: (c, o, t) => {
    note(c, o, t, NOTE(3), 0.16, { type: "sine", gain: 0.1 });
    note(c, o, t + 0.09, NOTE(10), 0.22, { type: "sine", gain: 0.1 });
  },
  clock_low: (c, o, t) => {
    note(c, o, t, 760, 0.07, { type: "sine", gain: 0.13, to: 640 });
    burst(c, o, t, 0.02, 2600, 2, 0.06);
  },
  draw_game: (c, o, t) => {
    note(c, o, t, NOTE(-2), 0.45, { type: "sine", gain: 0.14, attack: 0.02 });
    note(c, o, t + 0.2, NOTE(-5), 0.7, { type: "sine", gain: 0.14, attack: 0.02 });
  },
  game_start: (c, o, t) => {
    tap(c, o, t, 0.9, 0.9);
    tap(c, o, t + 0.12, 0.9, 1);
    tap(c, o, t + 0.24, 0.9, 1.1);
    [C5, E5, G5].forEach((freq, index) => note(c, o, t + 0.42 + index * 0.08, freq, 0.5, { type: "triangle", gain: 0.1 }));
  },
  game_over_win: (c, o, t) => {
    [C5, E5, G5, C6, G5, C6].forEach((freq, index) => note(c, o, t + index * 0.13, freq, 0.55, { type: "triangle", gain: 0.13, attack: 0.01 }));
    [C5, E5, G5].forEach((freq) => note(c, o, t + 0.8, freq, 1.2, { type: "sine", gain: 0.09, attack: 0.03 }));
  },
  game_over: (c, o, t) => {
    [NOTE(3), NOTE(-2), NOTE(-5)].forEach((freq, index) => note(c, o, t + index * 0.2, freq, 0.6, { type: "sine", gain: 0.12, attack: 0.02 }));
  },
  ui_click: (c, o, t) => {
    tap(c, o, t, 0.4, 1.5);
  },
  reaction: (c, o, t) => {
    note(c, o, t, 520, 0.09, { type: "sine", gain: 0.1, to: 900 });
  },
};

// Bursts of the same cue would stack into a rattle; the quick ones wait their turn.
const MIN_GAP_MS: Partial<Record<Cue, number>> = { discard: 140, draw: 120, reaction: 180, ui_click: 60, call: 160, your_turn: 400 };
const lastPlayed = new Map<Cue, number>();
const MAX_VOICES = 40;

function playFile(context: AudioContext, buffer: AudioBuffer) {
  if (!master) return;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(master);
  source.start();
}

/**
 * Play a cue now. Does nothing until the first gesture, while muted, or while the tab is hidden.
 * `pitch` nudges a synthesized cue up or down (yaku_tick climbs as lines appear); files ignore it.
 */
export function playCue(cue: Cue, options: { pitch?: number } = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  installSoundUnlock();
  if (!gestured || document.hidden) return;
  if (current().muted || current().volume <= 0) return;
  const context = ctx;
  if (!context || context.state !== "running") {
    if (context && context.state === "suspended") void context.resume().catch(() => undefined);
    return;
  }
  const now = performance.now();
  const gap = MIN_GAP_MS[cue] ?? 0;
  if (gap && now - (lastPlayed.get(cue) ?? -Infinity) < gap) return;
  lastPlayed.set(cue, now);
  if (voices > MAX_VOICES) return;
  try {
    const file = buffers.get(cue);
    if (file && file !== "loading" && file !== "none") playFile(context, file);
    else if (master) SYNTH[cue](context, master, context.currentTime + 0.005, options.pitch ?? 1);
  } catch {
    /* a sound must never break the table */
  }
}
