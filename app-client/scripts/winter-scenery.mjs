// Draws the Winter lights scenery in public/seasonal, so it needs no art pipeline. Same picture every
// run. From app-client: node scripts/winter-scenery.mjs
//   winter-lights.svg      the eave, wire and bulbs under the top bar
//   winter-lights-a/b.svg  two sets of glows that twinkle over it (site-shell.module.scss)
//   winter-hills.svg       the hillside along the top of the footer
//   winter-stars.svg       the sky behind the page (globals.scss)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "seasonal");
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const f = (n) => Number(n.toFixed(1));

// String lights under the top bar: a snowy eave, a sagging wire, bulbs. One tile, 720 wide.
const W = 720, H = 40;
{
  const r = rng(12);
  // Eave: scallops hanging from the bar, with the odd drip of an icicle.
  let eave = `M0 0`;
  let x = 0;
  const points = [];
  while (x < W) { const step = 9 + r() * 20; const nx = Math.min(W, x + step); const depth = 2 + r() * 4.2; points.push([x, nx, depth]); x = nx; }
  for (const [a, b, depth] of points) eave += ` Q${f((a + b) / 2)} ${f(depth * 2)} ${f(b)} 0.6`;
  eave += ` L${W} 0 Z`;
  const icicles = [];
  for (let i = 0; i < 16; i++) { const ix = 12 + r() * (W - 24), w = 1.4 + r() * 1.6, h = 5 + r() * 8; icicles.push(`M${f(ix - w)} 2 Q${f(ix)} ${f(h * 0.5)} ${f(ix)} ${f(h + 2)} Q${f(ix)} ${f(h * 0.5)} ${f(ix + w)} 2 Z`); }

  // Wire: spans that sag; the tile starts and ends at the same height so it repeats cleanly.
  const spans = 9, span = W / spans;
  const wireY = 4;
  let wire = `M0 ${wireY}`;
  const bulbs = [];
  const colors = [ { c: "#fff1cf", g: "255,226,160" }, { c: "#ffc861", g: "255,190,84" }, { c: "#c3e9ff", g: "150,215,255" }, { c: "#fff1cf", g: "255,226,160" }, { c: "#e7c2ff", g: "212,160,255" }, { c: "#ffc861", g: "255,190,84" } ];
  let n = 0;
  for (let i = 0; i < spans; i++) {
    const a = i * span, b = a + span, sag = 13 + (i % 3) * 2;
    const control = wireY + sag * 2 - 6;
    wire += ` Q${f((a + b) / 2)} ${f(control)} ${f(b)} ${wireY}`;
    // Three bulbs a span, along the curve, each hanging plumb with a little tilt.
    for (const t of [0.24, 0.5, 0.76]) {
      const qx = (1 - t) ** 2 * a + 2 * (1 - t) * t * ((a + b) / 2) + t ** 2 * b;
      const qy = (1 - t) ** 2 * wireY + 2 * (1 - t) * t * control + t ** 2 * wireY;
      bulbs.push({ x: qx, y: qy, tilt: (t - 0.5) * 22 + (r() - 0.5) * 12, color: colors[n % colors.length], group: n % 3 });
      n++;
    }
  }
  const defs = colors.map((c, i) => `<radialGradient id="g${i}"><stop offset="0" stop-color="rgb(${c.g})" stop-opacity=".62"/><stop offset=".38" stop-color="rgb(${c.g})" stop-opacity=".2"/><stop offset="1" stop-color="rgb(${c.g})" stop-opacity="0"/></radialGradient>`).join("");
  const bulbShape = (b) => `<g transform="translate(${f(b.x)} ${f(b.y)}) rotate(${f(b.tilt)})"><rect x="-1.25" y="-0.6" width="2.5" height="2.4" rx=".5" fill="#26364f"/><path d="M0 1.2c2.3 0 2.9 2.3 2.9 3.8S1.3 9.6 0 9.6-2.9 6.5-2.9 5-2.3 1.2 0 1.2Z" fill="${b.color.c}"/></g>`;
  const glow = (b, radius) => `<circle cx="${f(b.x)}" cy="${f(b.y + 5.5)}" r="${radius}" fill="url(#g${colors.indexOf(b.color)})"/>`;

  // Base: eave, wire and the bulbs, softly lit. Each of the two glow tiles holds a third of the bulbs.
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}<linearGradient id="e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f9ff"/><stop offset="1" stop-color="#bcd4f0"/></linearGradient></defs>`
    + `<path d="${wire}" fill="none" stroke="#6d84a8" stroke-opacity=".75" stroke-width=".9"/>`
    + bulbs.map((b) => glow(b, 11)).join("") + bulbs.map(bulbShape).join("")
    + `<path d="${eave}" fill="url(#e)"/><path d="${icicles.join(" ")}" fill="#dcecff" fill-opacity=".92"/></svg>`;
  fs.writeFileSync(path.join(out, "winter-lights.svg"), base);
  for (const [name, group] of [["a", 0], ["b", 1]]) {
    const lit = bulbs.filter((b) => b.group === group);
    fs.writeFileSync(path.join(out, `winter-lights-${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${lit.map((b) => glow(b, 17)).join("")}</svg>`);
  }
}

// A hillside for the footer: 1600 wide, repeats. Far ridge, pines, a cabin with its window lit.
{
  const w = 1600, h = 132;
  const r = rng(77);
  const ridge = (base, amp, seedA, seedB) => { const pts = []; for (let x = 0; x <= w; x += 40) pts.push([x, base + Math.sin((x / w) * Math.PI * 2 * 3 + seedA) * amp + Math.sin((x / w) * Math.PI * 2 * 7 + seedB) * amp * 0.34]); return pts; };
  const smooth = (pts) => { let d = `M${pts[0][0]} ${f(pts[0][1])}`; for (let i = 1; i < pts.length; i++) { const [px, py] = pts[i - 1], [x, y] = pts[i]; d += ` Q${px} ${f(py)} ${f((px + x) / 2)} ${f((py + y) / 2)}`; } d += ` L${w} ${f(pts.at(-1)[1])}`; return d; };
  const far = ridge(70, 16, 0.4, 2.1), near = ridge(104, 11, 2.2, 0.9);
  const heightAt = (pts, x) => { const i = Math.min(pts.length - 2, Math.floor(x / 40)); const t = (x - pts[i][0]) / 40; return pts[i][1] * (1 - t) + pts[i + 1][1] * t; };

  const pine = (x, y, s, fill, cap) => {
    const tiers = [[0, 1], [0.32, 0.8], [0.6, 0.56]];
    let body = "", snow = "";
    for (const [lift, width] of tiers) {
      const top = y - s * (0.55 + lift * 0.9), bottom = y - s * lift * 0.82, half = s * 0.33 * width;
      body += `M${f(x - half)} ${f(bottom)}L${f(x)} ${f(top)}L${f(x + half)} ${f(bottom)}Z`;
      snow += `M${f(x - half * 0.56)} ${f(top + (bottom - top) * 0.56)}L${f(x)} ${f(top)}L${f(x + half * 0.56)} ${f(top + (bottom - top) * 0.56)}Q${f(x)} ${f(top + (bottom - top) * 0.36)} ${f(x - half * 0.56)} ${f(top + (bottom - top) * 0.56)}Z`;
    }
    return `<path d="${body}" fill="${fill}"/><path d="${snow}" fill="${cap}"/><rect x="${f(x - s * 0.03)}" y="${f(y - 1)}" width="${f(s * 0.06)}" height="${f(s * 0.1)}" fill="${fill}"/>`;
  };

  let farTrees = "", nearTrees = "";
  for (let x = 14; x < w; x += 18 + r() * 54) { const s = 22 + r() * 18; farTrees += pine(x, heightAt(far, x) + 2, s, "#0c1b37", "#3b5684"); }
  for (let x = 40; x < w; x += 46 + r() * 150) { if (x > 690 && x < 860) continue; const s = 34 + r() * 26; nearTrees += pine(x, heightAt(near, x) + 3, s, "#081429", "#b9d0ee"); }

  // A tree in the clearing dressed for it, the only one with lights on.
  const tx = 700, ty = heightAt(near, tx) + 3;
  let dressed = pine(tx, ty, 62, "#081429", "#cfe0f6");
  const tinsel = [[-6, -13, "#ffc861"], [7, -17, "#fff1cf"], [-10, -24, "#c3e9ff"], [4, -29, "#ffc861"], [-3, -39, "#fff1cf"], [8, -11, "#e7c2ff"], [-13, -11, "#fff1cf"]];
  for (const [dx, dy, c] of tinsel) dressed += `<circle cx="${tx + dx}" cy="${f(ty + dy)}" r="3.2" fill="${c}" fill-opacity=".22"/><circle cx="${tx + dx}" cy="${f(ty + dy)}" r="1.15" fill="${c}"/>`;
  dressed += `<path transform="translate(${tx} ${f(ty - 59)})" d="M0-5 1.2-1.2 5 0 1.2 1.2 0 5-1.2 1.2-5 0-1.2-1.2Z" fill="#ffd27a"/><circle cx="${tx}" cy="${f(ty - 59)}" r="8" fill="#ffd27a" fill-opacity=".16"/>`;

  // The cabin: snow on the roof, a warm window, smoke going straight up.
  const cx = 770, cy = heightAt(near, cx + 26) + 2;
  const cabin = `<g transform="translate(${cx} ${f(cy)})">`
    + `<rect x="6" y="-25" width="44" height="26" fill="#0a1428"/>`
    + `<rect x="36" y="-44" width="6" height="14" fill="#0a1428"/>`
    + `<path d="M0-24 28-44 56-24Z" fill="#0a1428"/>`
    + `<path d="M-3-22.5 28-46 59-22.5 52-23 49-20.5 44-25 38-21 31-26 24-20.5 17-25 11-20.5 6-24Z" fill="#e4effb"/>`
    + `<circle cx="19" cy="-13" r="22" fill="url(#w)"/><circle cx="39" cy="-13" r="16" fill="url(#w)"/>`
    + `<rect x="13" y="-18" width="11" height="10" fill="#ffd27a"/><path d="M18.5-18v10M13-13h11" stroke="#7a4a12" stroke-width=".9"/>`
    + `<rect x="33" y="-17" width="9" height="18" fill="#3a2410"/><circle cx="40" cy="-8" r=".8" fill="#ffd27a"/>`
    + `<path d="M39-46c-3-5 3-7 0-12s3-7 0-12" fill="none" stroke="#a8bfe0" stroke-opacity=".28" stroke-width="2.4" stroke-linecap="round"/>`
    + `</g>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>`
    + `<radialGradient id="w" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffc861" stop-opacity=".5"/><stop offset="1" stop-color="#ffc861" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c4470"/><stop offset="1" stop-color="#14264a"/></linearGradient>`
    + `<linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d7cab"/><stop offset=".22" stop-color="#2d4674"/><stop offset="1" stop-color="#14264a"/></linearGradient></defs>`
    + `<path d="${smooth(far)} L${w} ${h} L0 ${h} Z" fill="url(#s)"/>` + farTrees
    + `<path d="${smooth(near)} L${w} ${h} L0 ${h} Z" fill="url(#n)"/>` + nearTrees + dressed + cabin + `</svg>`;
  fs.writeFileSync(path.join(out, "winter-hills.svg"), svg);
}

// Stars, for the sky behind the page.
{
  const r = rng(5), size = 640;
  let dots = "";
  for (let i = 0; i < 70; i++) dots += `<circle cx="${f(r() * size)}" cy="${f(r() * size)}" r="${f(0.4 + r() * r() * 0.9)}" fill="#dcebff" fill-opacity="${f(0.16 + r() * 0.42)}"/>`;
  fs.writeFileSync(path.join(out, "winter-stars.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${dots}</svg>`);
}
for (const file of fs.readdirSync(out)) console.log(file, fs.statSync(path.join(out, file)).size);
