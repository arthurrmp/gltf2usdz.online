/** WebUsdFramework.Converters.Shared.Usdc.StringsSection — STRINGS section
 *  encoder.
 *
 * The STRINGS section is layered on top of TOKENS: every TfString-typed value
 * is stored as a 32-bit `StringIndex`, which itself is just a `TokenIndex`
 * pointing into the TOKENS table. The section's only job is to map each
 * StringIndex to its underlying TokenIndex.
 *
 * Layout on disk:
 *
 *   uint64                 numStrings
 *   uint32[numStrings]     TokenIndex per string (little-endian)
 *
 * Crate's own writer uses the same `_WriteVarBytes` helper for several
 * sections; STRINGS is the simplest member of that family.
 *
 * Reference: `pxr/usd/usd/crateFile.cpp` — search for `_WriteStrings`.
 */

/** Bytes consumed by the STRINGS section count prefix. */
export const STRINGS_SECTION_HEADER_SIZE = 8;

/**
 * Mutable string-table that interns string values as TokenIndex references.
 * Use this when a string value (e.g., a TfString attribute) needs to live in
 * the STRINGS section. The underlying string text always lives in the TOKENS
 * section; the STRINGS table only stores indirection.
 */
export class StringTable {
  private readonly index = new Map<number, number>();
  private readonly list: number[] = [];

  /**
   * Intern a TokenIndex as a string-table entry. Returns the StringIndex
   * (which is just the position in this table). Repeated calls for the same
   * TokenIndex return the same StringIndex.
   */
  intern(tokenIndex: number): number {
    const existing = this.index.get(tokenIndex);
    if (existing !== undefined) return existing;
    const i = this.list.length;
    this.index.set(tokenIndex, i);
    this.list.push(tokenIndex);
    return i;
  }

  /** Look up the TokenIndex referenced by `stringIndex`. */
  get(stringIndex: number): number | undefined {
    return this.list[stringIndex];
  }

  /** Number of distinct string-index entries. */
  get count(): number {
    return this.list.length;
  }

  /** Snapshot the underlying TokenIndex list. Caller owns the returned array. */
  toArray(): number[] {
    return this.list.slice();
  }

  /** Encode the table as a complete STRINGS section payload (header + body). */
  encode(): Uint8Array {
    return encodeStringsSection(this.list);
  }
}

/**
 * Encode a STRINGS section from a list of TokenIndex values.
 *
 * Layout: 8-byte uint64 count + 4 bytes per entry (little-endian uint32).
 */
export function encodeStringsSection(tokenIndices: ReadonlyArray<number>): Uint8Array {
  const n = tokenIndices.length;
  const out = new Uint8Array(STRINGS_SECTION_HEADER_SIZE + n * 4);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(0, BigInt(n), /* littleEndian */ true);
  for (let i = 0; i < n; i++) {
    const v = tokenIndices[i];
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) {
      throw new RangeError(
        `encodeStringsSection: tokenIndex at position ${i} is out of uint32 range (got ${v})`
      );
    }
    view.setUint32(STRINGS_SECTION_HEADER_SIZE + i * 4, v, true);
  }
  return out;
}

/**
 * Decode a STRINGS section into a list of TokenIndex values.
 *
 * @throws RangeError if the section is too short for the declared count.
 */
export function decodeStringsSection(src: Uint8Array): number[] {
  if (src.length < STRINGS_SECTION_HEADER_SIZE) {
    throw new RangeError('decodeStringsSection: header truncated');
  }
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const n = Number(view.getBigUint64(0, true));
  const expected = STRINGS_SECTION_HEADER_SIZE + n * 4;
  if (expected > src.length) {
    throw new RangeError(
      `decodeStringsSection: section too short (need ${expected} bytes, have ${src.length})`
    );
  }
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = view.getUint32(STRINGS_SECTION_HEADER_SIZE + i * 4, true);
  }
  return out;
}
