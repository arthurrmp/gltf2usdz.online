/** WebUsdFramework.Converters.Shared.Usdc.UsdaValueParser — parse the
 *  USDA-style string literals our converters store as property values into
 *  the typed numeric arrays the USDC encoder consumes.
 *
 * The existing converters were written for the USDA text path, so several
 * properties carry their values as USDA-formatted strings rather than typed
 * arrays. The most common shapes:
 *
 *   "(0.7, 0.7, 0.7)"                    — scalar Vec3f (color3f input)
 *   "[(min,min,min), (max,max,max)]"      — Vec3f[] of two (extent)
 *   "(0.5, 0.7)"                          — scalar Vec2f
 *
 * These parsers are intentionally tolerant of whitespace and trailing
 * commas; they reject anything that doesn't match the expected shape
 * (returning `null`) so the adapter can route the property to the
 * unsupported bucket without throwing.
 */

/** Parse a single USDA tuple `"(a, b, c, ...)"`. Returns the numbers, or null. */
function parseTuple(input: string, expectedLength?: number): number[] | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return [];
  const parts = inner.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  const out: number[] = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  if (expectedLength !== undefined && out.length !== expectedLength) return null;
  return out;
}

/**
 * Parse a USDA Vec3f scalar literal, e.g. `"(0.7, 0.7, 0.7)"`.
 *
 * Returns a 3-element `Float32Array` or `null` if the input is malformed.
 */
export function parseVec3fScalar(input: string): Float32Array | null {
  const tuple = parseTuple(input, 3);
  if (!tuple) return null;
  return Float32Array.from(tuple);
}

/**
 * Parse a USDA Vec2f scalar literal, e.g. `"(0.5, 0.7)"`.
 */
export function parseVec2fScalar(input: string): Float32Array | null {
  const tuple = parseTuple(input, 2);
  if (!tuple) return null;
  return Float32Array.from(tuple);
}

/**
 * Parse a USDA Vec3f[] array literal, e.g.
 *   `"[(0,0,0), (1,1,1)]"`   → Float32Array(6) [0,0,0,1,1,1]
 *   `"[]"`                    → Float32Array(0)
 *
 * Returns a flat interleaved `Float32Array` of length `3 × count`, or
 * `null` if any tuple is malformed or has the wrong arity.
 */
export function parseVec3fArray(input: string): Float32Array | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return new Float32Array(0);

  // Split into individual `(...)` tuples. We can't use split(',') on the
  // outer string because each tuple itself contains commas. Walk byte by
  // byte instead, tracking parenthesis depth.
  const tuples: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0 && start >= 0) {
        tuples.push(inner.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        return null;
      }
    }
  }
  if (depth !== 0) return null;

  const flat: number[] = new Array(tuples.length * 3);
  for (let t = 0; t < tuples.length; t++) {
    const parsed = parseTuple(tuples[t], 3);
    if (!parsed) return null;
    flat[t * 3] = parsed[0];
    flat[t * 3 + 1] = parsed[1];
    flat[t * 3 + 2] = parsed[2];
  }
  return Float32Array.from(flat);
}
