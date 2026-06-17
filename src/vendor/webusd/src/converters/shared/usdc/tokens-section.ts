/** WebUsdFramework.Converters.Shared.Usdc.TokensSection — TOKENS section
 *  encoder and string-interning table.
 *
 * The Crate file format stores all interned strings in one section called
 * TOKENS. Every other section that needs to refer to an identifier (a field
 * name, a path component, a typeName value, a token-typed value) does so by
 * `TokenIndex` — a 32-bit index into this section's table.
 *
 * Section layout on disk:
 *
 *   uint64       numTokens
 *   uint64       uncompressedSize  // total bytes of NUL-separated UTF-8
 *   uint64       compressedSize    // bytes of LZ4 payload that follow
 *   bytes[compressedSize]           // LZ4-compressed token data
 *
 * If LZ4 expands the data (rare for token-shaped inputs), we fall back to
 * storing the bytes verbatim and set `compressedSize == uncompressedSize`.
 * Apple's reader handles both cases.
 *
 * Reference: `pxr/usd/usd/crateFile.cpp` — search for `_WriteTokens`.
 */

import { compress as lz4Compress, decompress as lz4Decompress } from './lz4-block';

const TEXT_ENCODER = new TextEncoder();

/** Bytes consumed by the TOKENS section header (3 × uint64). */
export const TOKENS_SECTION_HEADER_SIZE = 24;

/**
 * Mutable token-interning table. Returns stable indices for every distinct
 * string passed through `intern`. Use `encode()` to emit the on-disk TOKENS
 * section bytes once interning is complete.
 */
export class TokenTable {
  private readonly index = new Map<string, number>();
  private readonly list: string[] = [];

  /** Intern `token`. Returns its TokenIndex (stable across the lifetime of this table). */
  intern(token: string): number {
    const existing = this.index.get(token);
    if (existing !== undefined) return existing;
    const idx = this.list.length;
    this.index.set(token, idx);
    this.list.push(token);
    return idx;
  }

  /** Look up a token by index. Returns `undefined` if `i` is out of range. */
  get(i: number): string | undefined {
    return this.list[i];
  }

  /** Number of distinct tokens currently interned. */
  get count(): number {
    return this.list.length;
  }

  /**
   * Snapshot the current token list. The caller owns the returned array;
   * mutating it will not affect the table.
   */
  toArray(): string[] {
    return this.list.slice();
  }

  /** Encode the table as a complete TOKENS section payload (header + body). */
  encode(): Uint8Array {
    return encodeTokensSection(this.list);
  }
}

/**
 * Build the flat NUL-separated payload that the TOKENS section compresses.
 * Each token is followed by a single 0 byte; an empty input yields an empty
 * buffer.
 */
function buildFlatPayload(tokens: ReadonlyArray<string>): Uint8Array {
  if (tokens.length === 0) return new Uint8Array(0);

  const encoded = tokens.map((t) => TEXT_ENCODER.encode(t));
  let total = 0;
  for (const e of encoded) total += e.length + 1; // + NUL
  const out = new Uint8Array(total);
  let dp = 0;
  for (const e of encoded) {
    out.set(e, dp);
    dp += e.length;
    out[dp++] = 0; // NUL terminator
  }
  return out;
}

/**
 * Encode the TOKENS section for a list of strings.
 *
 * Layout: 24-byte header (numTokens, uncompressedSize, compressedSize) +
 * LZ4-compressed (or raw, if expansion) payload bytes.
 *
 * @returns A freshly allocated `Uint8Array` containing the section bytes.
 */
export function encodeTokensSection(tokens: ReadonlyArray<string>): Uint8Array {
  const flat = buildFlatPayload(tokens);
  const uncompressedSize = flat.length;

  // LZ4 only when there's something worth compressing. For an empty payload
  // we still emit the 24-byte header with all zeros.
  let payload: Uint8Array;
  if (uncompressedSize === 0) {
    payload = new Uint8Array(0);
  } else {
    const compressed = lz4Compress(flat);
    payload = compressed.length < uncompressedSize ? compressed : flat;
  }

  const compressedSize = payload.length;
  const out = new Uint8Array(TOKENS_SECTION_HEADER_SIZE + compressedSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(0, BigInt(tokens.length), /* littleEndian */ true);
  view.setBigUint64(8, BigInt(uncompressedSize), true);
  view.setBigUint64(16, BigInt(compressedSize), true);
  out.set(payload, TOKENS_SECTION_HEADER_SIZE);
  return out;
}

/**
 * Decode a TOKENS section, returning the original list of strings.
 *
 * Used by tests and any future inspection tooling. Not on the runtime
 * encoding path.
 *
 * @throws RangeError if the buffer is too short for the declared sizes.
 */
export function decodeTokensSection(src: Uint8Array): string[] {
  if (src.length < TOKENS_SECTION_HEADER_SIZE) {
    throw new RangeError('decodeTokensSection: header truncated');
  }
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const numTokens = Number(view.getBigUint64(0, true));
  const uncompressedSize = Number(view.getBigUint64(8, true));
  const compressedSize = Number(view.getBigUint64(16, true));
  if (TOKENS_SECTION_HEADER_SIZE + compressedSize > src.length) {
    throw new RangeError('decodeTokensSection: payload truncated');
  }
  if (numTokens === 0) return [];

  const payload = src.subarray(
    TOKENS_SECTION_HEADER_SIZE,
    TOKENS_SECTION_HEADER_SIZE + compressedSize
  );
  const flat: Uint8Array =
    compressedSize === uncompressedSize ? payload : lz4Decompress(payload, uncompressedSize);

  const decoder = new TextDecoder('utf-8');
  const tokens: string[] = new Array(numTokens);
  let start = 0;
  let i = 0;
  for (let p = 0; p < flat.length; p++) {
    if (flat[p] === 0) {
      tokens[i++] = decoder.decode(flat.subarray(start, p));
      start = p + 1;
    }
  }
  if (i !== numTokens) {
    throw new RangeError(
      `decodeTokensSection: payload had ${i} NUL-separated entries, expected ${numTokens}`
    );
  }
  return tokens;
}
