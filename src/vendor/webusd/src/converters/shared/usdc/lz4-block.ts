/** WebUsdFramework.Converters.Shared.Usdc.Lz4Block — LZ4 block-format codec
 *
 * Pure-JS implementation of the LZ4 block format (NOT the framing format).
 * Used by the USDC TOKENS section and by array-value compression. The Pixar
 * Crate format calls `LZ4_compress_fast` with acceleration=1 and stores the
 * raw block bytes directly — no LZ4 frame header, no checksum.
 *
 * Reference: https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md
 *
 * Why hand-rolled instead of `lz4js`:
 *  - `lz4js` outputs LZ4 frames (with magic + checksums); USDC needs raw blocks.
 *  - This module is ~140 LOC and dependency-free, which keeps the package small.
 *  - The encoder is intentionally simple (single-pass, fixed 64K hash table).
 *    Its output is not optimal but it IS valid LZ4 — Apple's decoder accepts it.
 *
 * Both `compress` and `decompress` are pure functions. They never read or
 * write outside the supplied / returned buffers.
 */

/**
 * LZ4 minimum match length. Sequences shorter than 4 bytes are emitted as
 * literals only.
 */
const MIN_MATCH = 4;

/** Hash table size — 16-bit hashes give 64K slots, the canonical LZ4 sizing. */
const HASH_BITS = 16;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_MASK = HASH_SIZE - 1;

/**
 * Bytes left at the end of a block that must be encoded as literals only.
 * The LZ4 spec requires the last 5 bytes of any block to be literals.
 */
const LAST_LITERALS = 5;

/**
 * Minimum input length to attempt a match. Below this threshold the entire
 * input is emitted as literals. (LZ4 spec: matches must end at least
 * LAST_LITERALS bytes before the end of input.)
 */
const MFLIMIT = 12;

/** Maximum back-reference distance in the LZ4 block format. */
const MAX_OFFSET = 0xffff;

/**
 * Knuth multiplicative hash on the 4-byte sequence at `src[pos]`. Returns
 * a 16-bit hash table index. Uses `Math.imul` for safe 32-bit multiplication.
 */
function hash4(src: Uint8Array, pos: number): number {
  const v =
    src[pos] |
    (src[pos + 1] << 8) |
    (src[pos + 2] << 16) |
    (src[pos + 3] << 24);
  return (Math.imul(v, 0x9e3779b1) >>> (32 - HASH_BITS)) & HASH_MASK;
}

/** Count common bytes starting at `a` and `b`, capped at `limit`. */
function countMatch(src: Uint8Array, a: number, b: number, limit: number): number {
  let n = 0;
  while (b + n < limit && src[a + n] === src[b + n]) n++;
  return n;
}

/**
 * Compress a block of bytes using LZ4 block format.
 *
 * The output is a raw LZ4 block — no magic, no headers, no checksums. The
 * caller is responsible for recording the original size separately so the
 * decoder knows the expected output length.
 */
export function compress(src: Uint8Array): Uint8Array {
  const srcLen = src.length;

  // Trivial inputs: emit a single literals-only sequence.
  if (srcLen < MFLIMIT) {
    return emitLiteralsOnly(src);
  }

  const hashTable = new Int32Array(HASH_SIZE).fill(-1);
  // Worst-case output is ~ srcLen + (srcLen / 255) + 16; allocate generously.
  const dst = new Uint8Array(srcLen + Math.ceil(srcLen / 255) + 16);

  let dp = 0; // dst write cursor
  let anchor = 0; // start of current literal run
  let ip = 0; // current input cursor
  const ipEnd = srcLen;
  const ipLimit = srcLen - MFLIMIT;

  while (ip <= ipLimit) {
    const h = hash4(src, ip);
    const ref = hashTable[h];
    hashTable[h] = ip;

    if (
      ref >= 0 &&
      ip - ref <= MAX_OFFSET &&
      src[ref] === src[ip] &&
      src[ref + 1] === src[ip + 1] &&
      src[ref + 2] === src[ip + 2] &&
      src[ref + 3] === src[ip + 3]
    ) {
      // Match found. Extend it as far as possible (within block bounds).
      const extended = countMatch(src, ref + MIN_MATCH, ip + MIN_MATCH, ipEnd - LAST_LITERALS);
      const matchLen = MIN_MATCH + extended;
      const literalLen = ip - anchor;
      const offset = ip - ref;

      dp = emitSequence(dst, dp, src, anchor, literalLen, offset, matchLen);
      ip += matchLen;
      anchor = ip;
    } else {
      ip++;
    }
  }

  // Final sequence: remaining bytes as literals.
  dp = emitFinalLiterals(dst, dp, src, anchor, ipEnd - anchor);

  return dst.subarray(0, dp);
}

/**
 * Emit a block consisting of nothing but literals — used when the input is
 * shorter than MFLIMIT, or when the compressor cannot find any match.
 */
function emitLiteralsOnly(src: Uint8Array): Uint8Array {
  const literalLen = src.length;
  // Worst case: 1 token + ceil(literalLen / 255) extra bytes + literalLen bytes.
  const dst = new Uint8Array(1 + Math.ceil(literalLen / 255) + literalLen);
  const dp = emitFinalLiterals(dst, 0, src, 0, literalLen);
  return dst.subarray(0, dp);
}

/** Write a token + extra-length bytes for a length encoded as `nibble + extras`. */
function writeLength(dst: Uint8Array, dp: number, len: number): number {
  let remaining = len - 15;
  while (remaining >= 255) {
    dst[dp++] = 255;
    remaining -= 255;
  }
  dst[dp++] = remaining;
  return dp;
}

/** Emit one (literals + match) sequence into the output stream. */
function emitSequence(
  dst: Uint8Array,
  dp: number,
  src: Uint8Array,
  anchor: number,
  literalLen: number,
  offset: number,
  matchLen: number
): number {
  const matchExcess = matchLen - MIN_MATCH;
  const tokenLit = literalLen >= 15 ? 15 : literalLen;
  const tokenMatch = matchExcess >= 15 ? 15 : matchExcess;
  dst[dp++] = (tokenLit << 4) | tokenMatch;

  if (literalLen >= 15) dp = writeLength(dst, dp, literalLen);

  for (let i = 0; i < literalLen; i++) dst[dp++] = src[anchor + i];

  dst[dp++] = offset & 0xff;
  dst[dp++] = (offset >>> 8) & 0xff;

  if (matchExcess >= 15) dp = writeLength(dst, dp, matchExcess);

  return dp;
}

/** Emit the final sequence — literals only, no match. */
function emitFinalLiterals(
  dst: Uint8Array,
  dp: number,
  src: Uint8Array,
  anchor: number,
  literalLen: number
): number {
  const tokenLit = literalLen >= 15 ? 15 : literalLen;
  dst[dp++] = tokenLit << 4;
  if (literalLen >= 15) dp = writeLength(dst, dp, literalLen);
  for (let i = 0; i < literalLen; i++) dst[dp++] = src[anchor + i];
  return dp;
}

/**
 * Decompress an LZ4 block back into its original bytes.
 *
 * `expectedSize` is the original (uncompressed) size — required because the
 * block format does not store this internally. The function will throw a
 * `RangeError` if the stream is malformed or produces fewer / more bytes
 * than expected.
 */
export function decompress(src: Uint8Array, expectedSize: number): Uint8Array {
  const dst = new Uint8Array(expectedSize);
  let sp = 0;
  let dp = 0;

  while (sp < src.length) {
    const token = src[sp++];
    let literalLen = token >>> 4;
    if (literalLen === 15) {
      let b = 255;
      while (b === 255) {
        if (sp >= src.length) throw new RangeError('lz4 decompress: truncated literal length');
        b = src[sp++];
        literalLen += b;
      }
    }

    // Copy literals.
    if (sp + literalLen > src.length) {
      throw new RangeError('lz4 decompress: literal run exceeds input');
    }
    if (dp + literalLen > expectedSize) {
      throw new RangeError('lz4 decompress: output overflow during literals');
    }
    for (let i = 0; i < literalLen; i++) dst[dp++] = src[sp++];

    if (sp >= src.length) break; // last sequence has no match.

    if (sp + 2 > src.length) throw new RangeError('lz4 decompress: missing offset');
    const offset = src[sp] | (src[sp + 1] << 8);
    sp += 2;
    if (offset === 0) throw new RangeError('lz4 decompress: zero offset');

    let matchLen = (token & 0x0f) + MIN_MATCH;
    if ((token & 0x0f) === 15) {
      let b = 255;
      while (b === 255) {
        if (sp >= src.length) throw new RangeError('lz4 decompress: truncated match length');
        b = src[sp++];
        matchLen += b;
      }
    }

    const matchSrc = dp - offset;
    if (matchSrc < 0) throw new RangeError('lz4 decompress: offset before output start');
    if (dp + matchLen > expectedSize) {
      throw new RangeError('lz4 decompress: output overflow during match');
    }
    // Byte-by-byte copy: handles overlapping (run-length) copies correctly.
    for (let i = 0; i < matchLen; i++) dst[dp++] = dst[matchSrc + i];
  }

  if (dp !== expectedSize) {
    throw new RangeError(
      `lz4 decompress: produced ${dp} bytes, expected ${expectedSize}`
    );
  }
  return dst;
}
