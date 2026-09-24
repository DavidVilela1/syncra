/**
 * Fractional indexing — lexicographically sortable order keys.
 *
 * WHY: Storing `position` as an integer (0, 1, 2, …) means moving one card to the
 * top of a 500-card column rewrites 500 rows. Instead, every item gets a string
 * key, and to insert between neighbours `a` and `b` we generate a new key `k`
 * with `a < k < b` (plain byte-wise string comparison). A move is therefore a
 * single-row UPDATE, regardless of column size, and it never conflicts with
 * concurrent moves of *other* cards.
 *
 * KEY FORMAT (after David Greenspan, "Implementing Fractional Indexing"):
 *
 *     key = <integer part> <fractional part>
 *
 *  - The integer part is a variable-length base-62 integer whose FIRST char
 *    encodes its own length: 'a'..'z' → positive, 2..27 chars long;
 *    'A'..'Z' → negative, 27..2 chars long. Because the head char sorts with the
 *    magnitude, integers compare correctly as plain strings.
 *  - The fractional part is a base-62 "decimal" with no trailing zero digit
 *    ('0'), so every point on the number line has exactly one representation.
 *
 * Appending at the end (the most common operation) just increments the integer
 * part: "a0" → "a1" → … → "az" → "b00". Keys therefore grow logarithmically for
 * appends/prepends, and only repeated inserts into the *same gap* grow the
 * fractional tail (by ~1 char per ~6 bisections of base 62).
 *
 * IMPORTANT: comparisons MUST be byte-wise. In Postgres the column is declared
 * `COLLATE "C"` (see schema.ts); in JS we use `<` on strings, never localeCompare.
 */

export const BASE_62_DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const ZERO = BASE_62_DIGITS[0] as string;
const MAX_DIGIT = BASE_62_DIGITS[BASE_62_DIGITS.length - 1] as string;
/** The smallest representable integer part. Nothing may sort before it. */
const SMALLEST_INTEGER = "A" + ZERO.repeat(26);

export class FractionalIndexError extends Error {
  override readonly name = "FractionalIndexError";
}

function charAt(s: string, i: number): string {
  const c = s[i];
  if (c === undefined) throw new FractionalIndexError(`index ${i} out of range for "${s}"`);
  return c;
}

function digitValue(c: string): number {
  const v = BASE_62_DIGITS.indexOf(c);
  if (v === -1) throw new FractionalIndexError(`invalid digit "${c}"`);
  return v;
}

function digitAt(v: number): string {
  return charAt(BASE_62_DIGITS, v);
}

/**
 * Returns a fraction string strictly between `a` and `b`, where both are
 * fractional parts (no integer head) in [0, 1). `b === null` means 1.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new FractionalIndexError(`${a} >= ${b}`);
  if (a.endsWith(ZERO) || (b !== null && b.endsWith(ZERO))) {
    throw new FractionalIndexError("trailing zero");
  }

  if (b !== null) {
    // Strip the common prefix (treating a missing digit in `a` as 0) and
    // recurse: mid("abc", "abe") = "ab" + mid("c", "e").
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }

  // First digits now differ.
  const digitA = a.length > 0 ? digitValue(charAt(a, 0)) : 0;
  const digitB = b !== null ? digitValue(charAt(b, 0)) : BASE_62_DIGITS.length;

  if (digitB - digitA > 1) {
    // Room for a single digit in between — take the middle one.
    return digitAt(Math.round(0.5 * (digitA + digitB)));
  }

  // Adjacent first digits.
  if (b !== null && b.length > 1) {
    // b is e.g. "58…" and a is "4…": "5" alone sits strictly between them.
    return b.slice(0, 1);
  }
  // Otherwise keep a's first digit and find a midpoint between the rest of `a` and 1.
  return digitAt(digitA) + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new FractionalIndexError(`invalid order key head "${head}"`);
}

function integerPart(key: string): string {
  const len = integerLength(charAt(key, 0));
  if (len > key.length) throw new FractionalIndexError(`invalid order key "${key}"`);
  return key.slice(0, len);
}

function assertInteger(int: string): void {
  if (int.length !== integerLength(charAt(int, 0))) {
    throw new FractionalIndexError(`invalid integer part "${int}"`);
  }
}

export function isValidOrderKey(key: string): boolean {
  try {
    validateOrderKey(key);
    return true;
  } catch {
    return false;
  }
}

export function validateOrderKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new FractionalIndexError(`invalid order key "${key}"`);
  const int = integerPart(key);
  const frac = key.slice(int.length);
  for (const c of frac) digitValue(c);
  for (const c of int.slice(1)) digitValue(c);
  if (frac.endsWith(ZERO)) throw new FractionalIndexError(`invalid order key "${key}"`);
}

/** +1 on a variable-length integer part. Returns null on overflow past "z…z". */
function incrementInteger(x: string): string | null {
  assertInteger(x);
  const head = charAt(x, 0);
  const digits = x.slice(1).split("");
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const d = digitValue(charAt(x, i + 1)) + 1;
    if (d === BASE_62_DIGITS.length) {
      digits[i] = ZERO;
    } else {
      digits[i] = digitAt(d);
      carry = false;
    }
  }
  if (!carry) return head + digits.join("");

  // Carry out of the top digit: move to the next head char (changes length).
  if (head === "Z") return "a" + ZERO;
  if (head === "z") return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > "a") digits.push(ZERO); // positive side: one digit longer
  else digits.pop(); // negative side: one digit shorter
  return nextHead + digits.join("");
}

/** -1 on a variable-length integer part. Returns null on underflow. */
function decrementInteger(x: string): string | null {
  assertInteger(x);
  const head = charAt(x, 0);
  const digits = x.slice(1).split("");
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const d = digitValue(charAt(x, i + 1)) - 1;
    if (d === -1) {
      digits[i] = MAX_DIGIT;
    } else {
      digits[i] = digitAt(d);
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join("");

  if (head === "a") return "Z" + MAX_DIGIT;
  if (head === "A") return null;
  const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (prevHead < "Z") digits.push(MAX_DIGIT);
  else digits.pop();
  return prevHead + digits.join("");
}

/**
 * Generate an order key strictly between `a` and `b`.
 *  - `a === null` → before `b` (prepend)
 *  - `b === null` → after `a`  (append)
 *  - both null    → the first key in an empty list
 */
export function generateKeyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateOrderKey(a);
  if (b !== null) validateOrderKey(b);
  if (a !== null && b !== null && a >= b) {
    throw new FractionalIndexError(`generateKeyBetween: "${a}" >= "${b}"`);
  }

  if (a === null) {
    if (b === null) return "a" + ZERO;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint("", fb);
    if (ib < b) return ib; // b has a fraction, so its bare integer part sorts before it
    const res = decrementInteger(ib);
    if (res === null) throw new FractionalIndexError("cannot decrement any more");
    // The bare smallest integer is reserved (nothing could ever precede it),
    // so step into its fractional space instead.
    return res === SMALLEST_INTEGER ? res + midpoint("", null) : res;
  }

  if (b === null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }

  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new FractionalIndexError("cannot increment any more");
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

/**
 * Generate `n` evenly spread keys between `a` and `b` in one go — used when
 * seeding/importing so keys stay short (divide-and-conquer instead of chaining
 * `n` appends into the same gap).
 */
export function generateNKeysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n === 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];
  if (b === null) {
    let c = generateKeyBetween(a, b);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(c, b);
      result.push(c);
    }
    return result;
  }
  if (a === null) {
    let c = generateKeyBetween(a, b);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(a, c);
      result.push(c);
    }
    return result.reverse();
  }
  const mid = Math.floor(n / 2);
  const c = generateKeyBetween(a, b);
  return [...generateNKeysBetween(a, c, mid), c, ...generateNKeysBetween(c, b, n - mid - 1)];
}

/** Byte-wise comparator matching Postgres `COLLATE "C"`. Never use localeCompare for keys. */
export function compareOrderKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
