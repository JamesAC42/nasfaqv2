// Postgres NUMERIC arithmetic in JS, exact (BigInt), for batched code that has to land on the same
// values as a row-at-a-time version. That version wrote a JS number into a NUMERIC column, read the
// column back with Number() and decided its next step from that: the column holds the exact decimal
// sum of everything written to it, so replaying it needs the exact sum too, not a sum of doubles.
//
// A value is { int, scale } meaning int / 10^scale. parse() takes NUMERIC text as node-pg returns it
// or a JS number (written the way node-pg sends one: String(number), exponent and all).

function parse(value) {
  const text = typeof value === "number" ? String(value) : String(value ?? "0").trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || (!match[2] && !match[3])) throw new Error(`not a number: ${text}`);
  let digits = `${match[2] || ""}${match[3] || ""}`;
  let scale = (match[3] || "").length - Number(match[4] || 0);
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  const int = BigInt(digits);
  return { int: match[1] === "-" ? -int : int, scale };
}

const ZERO = Object.freeze({ int: 0n, scale: 0 });
const pow10 = (n) => 10n ** BigInt(n);
const scaled = (value, scale) => value.int * pow10(scale - value.scale);

function add(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return { int: scaled(a, scale) + scaled(b, scale), scale };
}

function mul(a, b) {
  return { int: a.int * b.int, scale: a.scale + b.scale };
}

function compare(a, b) {
  const scale = Math.max(a.scale, b.scale);
  const x = scaled(a, scale);
  const y = scaled(b, scale);
  return x === y ? 0 : x < y ? -1 : 1;
}

/** round(value, places), half away from zero like NUMERIC's. */
function round(value, places) {
  if (value.scale <= places) return value;
  const factor = pow10(value.scale - places);
  const magnitude = value.int < 0n ? -value.int : value.int;
  const quotient = magnitude / factor + ((magnitude % factor) * 2n >= factor ? 1n : 0n);
  return { int: value.int < 0n ? -quotient : quotient, scale: places };
}

function toString(value) {
  const negative = value.int < 0n;
  let digits = (negative ? -value.int : value.int).toString();
  if (value.scale > 0) {
    digits = digits.padStart(value.scale + 1, "0");
    digits = `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
  }
  return negative ? `-${digits}` : digits;
}

/** What Number() of the column's text gives. */
function toNumber(value) {
  return Number(toString(value));
}

module.exports = { ZERO, parse, add, mul, compare, round, toString, toNumber };
