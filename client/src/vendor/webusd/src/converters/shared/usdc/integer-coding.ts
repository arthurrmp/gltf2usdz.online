/** WebUsdFramework.Converters.Shared.Usdc.IntegerCoding — TfDelta variable-byte
 *  integer compression used by USDC FIELDSETS / PATHS / SPECS sections.
 *
 * The Crate format compresses every integer-array section by:
 *   1. Differencing consecutive values (deltas).
 *   2. Choosing, per-value, the smallest signed byte width that holds the delta
 *      (1, 2, or 4 bytes for int32; 1, 2, 4, or 8 bytes for int64).
 *   3. Packing two-bit code-words into a header — 4 codes per byte — followed
 *      by the variable-width delta payloads in order.
 *
 * The result is then often LZ4-compressed on top, but that is the caller's
 * choice; this module is concerned only with the variable-byte layer.
 *
 * Reference: `pxr/usd/usd/integerCoding.{h,cpp}` from the OpenUSD source tree.
 *
 * Both `compressInt32` / `decompressInt32` (and the int64 pair) are pure
 * functions and do not mutate their inputs.
 */

/** Header bytes hold 4 two-bit codes each. */
const CODES_PER_HEADER_BYTE = 4;

/** Codes for int32 deltas: 1, 2, or 4 bytes. */
const CODE_INT32_BYTE = 0;
const CODE_INT32_WORD = 1;
const CODE_INT32_DWORD = 2;

/** Codes for int64 deltas: 1, 2, 4, or 8 bytes. */
const CODE_INT64_BYTE = 0;
const CODE_INT64_WORD = 1;
const CODE_INT64_DWORD = 2;
const CODE_INT64_QWORD = 3;

const INT32_PAYLOAD_WIDTHS = [1, 2, 4];
const INT64_PAYLOAD_WIDTHS = [1, 2, 4, 8];

/**
 * Compute the minimum encoding code for a 32-bit signed delta.
 * Returns CODE_INT32_BYTE / WORD / DWORD.
 */
function classifyInt32(delta: number): number {
  if (delta >= -0x80 && delta <= 0x7f) return CODE_INT32_BYTE;
  if (delta >= -0x8000 && delta <= 0x7fff) return CODE_INT32_WORD;
  return CODE_INT32_DWORD;
}

/**
 * Compute the maximum number of bytes the int32 encoder can produce for `n`
 * input integers. Useful for buffer sizing.
 */
export function int32CompressedBound(n: number): number {
  if (n === 0) return 0;
  const headerBytes = Math.ceil(n / CODES_PER_HEADER_BYTE);
  return headerBytes + n * 4; // worst case: every delta is a full dword
}

/**
 * Compress `ints` using TfDelta variable-byte encoding.
 *
 * The first delta is `ints[0] - 0` (i.e. the absolute first value); subsequent
 * deltas are `ints[i] - ints[i-1]`. The output layout is:
 *
 *   [ceil(n/4) header bytes] [variable-width signed deltas]
 *
 * The number of input integers is NOT stored — the caller must record `n`
 * separately so the decoder knows how many codes to read.
 */
export function compressInt32(ints: ArrayLike<number>): Uint8Array {
  const n = ints.length;
  if (n === 0) return new Uint8Array(0);

  // First pass: derive deltas + per-element codes; sum payload size.
  const deltas = new Int32Array(n);
  const codes = new Uint8Array(n);
  let payloadBytes = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = ints[i] | 0; // coerce to int32
    const d = (v - prev) | 0;
    deltas[i] = d;
    const code = classifyInt32(d);
    codes[i] = code;
    payloadBytes += INT32_PAYLOAD_WIDTHS[code];
    prev = v;
  }

  const headerBytes = Math.ceil(n / CODES_PER_HEADER_BYTE);
  const out = new Uint8Array(headerBytes + payloadBytes);

  // Pack codes into headers — 2 bits per code, 4 per byte, low-order first.
  for (let i = 0; i < n; i++) {
    out[i >> 2] |= codes[i] << ((i & 3) * 2);
  }

  // Write deltas.
  let dp = headerBytes;
  for (let i = 0; i < n; i++) {
    const d = deltas[i];
    switch (codes[i]) {
      case CODE_INT32_BYTE:
        out[dp++] = d & 0xff;
        break;
      case CODE_INT32_WORD:
        out[dp++] = d & 0xff;
        out[dp++] = (d >>> 8) & 0xff;
        break;
      default: // CODE_INT32_DWORD
        out[dp++] = d & 0xff;
        out[dp++] = (d >>> 8) & 0xff;
        out[dp++] = (d >>> 16) & 0xff;
        out[dp++] = (d >>> 24) & 0xff;
        break;
    }
  }

  return out;
}

/**
 * Decompress an int32 variable-byte stream back into an `Int32Array` of
 * exactly `n` elements.
 *
 * @throws RangeError if the source buffer is too short for the declared
 *   element count.
 */
export function decompressInt32(src: Uint8Array, n: number): Int32Array {
  if (n === 0) return new Int32Array(0);
  const headerBytes = Math.ceil(n / CODES_PER_HEADER_BYTE);
  if (headerBytes > src.length) {
    throw new RangeError('decompressInt32: header truncated');
  }

  const out = new Int32Array(n);
  let dp = headerBytes;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const code = (src[i >> 2] >>> ((i & 3) * 2)) & 0x3;
    let delta = 0;
    switch (code) {
      case CODE_INT32_BYTE:
        if (dp + 1 > src.length) throw new RangeError('decompressInt32: byte payload truncated');
        delta = (src[dp] << 24) >> 24; // sign-extend
        dp += 1;
        break;
      case CODE_INT32_WORD:
        if (dp + 2 > src.length) throw new RangeError('decompressInt32: word payload truncated');
        delta = ((src[dp] | (src[dp + 1] << 8)) << 16) >> 16;
        dp += 2;
        break;
      case CODE_INT32_DWORD:
        if (dp + 4 > src.length) throw new RangeError('decompressInt32: dword payload truncated');
        delta = src[dp] | (src[dp + 1] << 8) | (src[dp + 2] << 16) | (src[dp + 3] << 24);
        dp += 4;
        break;
      default:
        throw new RangeError(`decompressInt32: invalid code ${code} at index ${i}`);
    }
    const v = (prev + delta) | 0;
    out[i] = v;
    prev = v;
  }
  return out;
}

/** Classify a bigint delta into one of the four int64 code widths. */
function classifyInt64(delta: bigint): number {
  if (delta >= -128n && delta <= 127n) return CODE_INT64_BYTE;
  if (delta >= -32768n && delta <= 32767n) return CODE_INT64_WORD;
  if (delta >= -2147483648n && delta <= 2147483647n) return CODE_INT64_DWORD;
  return CODE_INT64_QWORD;
}

/** Worst-case int64 byte count for `n` inputs. */
export function int64CompressedBound(n: number): number {
  if (n === 0) return 0;
  const headerBytes = Math.ceil(n / CODES_PER_HEADER_BYTE);
  return headerBytes + n * 8;
}

/**
 * Compress an array of BigInt values as TfDelta-encoded int64.
 *
 * The codes occupy 4 slots: 1, 2, 4, or 8 bytes signed. The header layout is
 * the same as int32 (2 bits per code, packed 4 codes per byte).
 */
export function compressInt64(ints: ReadonlyArray<bigint> | BigInt64Array): Uint8Array {
  const n = ints.length;
  if (n === 0) return new Uint8Array(0);

  const deltas: bigint[] = new Array(n);
  const codes = new Uint8Array(n);
  let payloadBytes = 0;
  let prev = 0n;
  for (let i = 0; i < n; i++) {
    const v = BigInt.asIntN(64, BigInt(ints[i]));
    const d = BigInt.asIntN(64, v - prev);
    deltas[i] = d;
    const code = classifyInt64(d);
    codes[i] = code;
    payloadBytes += INT64_PAYLOAD_WIDTHS[code];
    prev = v;
  }

  const headerBytes = Math.ceil(n / CODES_PER_HEADER_BYTE);
  const out = new Uint8Array(headerBytes + payloadBytes);

  for (let i = 0; i < n; i++) {
    out[i >> 2] |= codes[i] << ((i & 3) * 2);
  }

  let dp = headerBytes;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < n; i++) {
    const d = deltas[i];
    switch (codes[i]) {
      case CODE_INT64_BYTE:
        out[dp++] = Number(BigInt.asUintN(8, d));
        break;
      case CODE_INT64_WORD: {
        const u = Number(BigInt.asUintN(16, d));
        out[dp++] = u & 0xff;
        out[dp++] = (u >>> 8) & 0xff;
        break;
      }
      case CODE_INT64_DWORD: {
        view.setInt32(dp, Number(BigInt.asIntN(32, d)), true);
        dp += 4;
        break;
      }
      default:
        view.setBigInt64(dp, d, true);
        dp += 8;
        break;
    }
  }

  return out;
}

/**
 * Decompress an int64 TfDelta stream into a BigInt64Array of `n` elements.
 */
export function decompressInt64(src: Uint8Array, n: number): BigInt64Array {
  if (n === 0) return new BigInt64Array(0);
  const headerBytes = Math.ceil(n / CODES_PER_HEADER_BYTE);
  if (headerBytes > src.length) throw new RangeError('decompressInt64: header truncated');

  const out = new BigInt64Array(n);
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let dp = headerBytes;
  let prev = 0n;

  for (let i = 0; i < n; i++) {
    const code = (src[i >> 2] >>> ((i & 3) * 2)) & 0x3;
    let delta = 0n;
    switch (code) {
      case CODE_INT64_BYTE:
        if (dp + 1 > src.length) throw new RangeError('decompressInt64: byte payload truncated');
        delta = BigInt(((src[dp] << 24) >> 24)); // sign-extend
        dp += 1;
        break;
      case CODE_INT64_WORD: {
        if (dp + 2 > src.length) throw new RangeError('decompressInt64: word payload truncated');
        const w = (src[dp] | (src[dp + 1] << 8)) | 0;
        delta = BigInt((w << 16) >> 16);
        dp += 2;
        break;
      }
      case CODE_INT64_DWORD:
        if (dp + 4 > src.length) throw new RangeError('decompressInt64: dword payload truncated');
        delta = BigInt(view.getInt32(dp, true));
        dp += 4;
        break;
      default:
        if (dp + 8 > src.length) throw new RangeError('decompressInt64: qword payload truncated');
        delta = view.getBigInt64(dp, true);
        dp += 8;
        break;
    }
    const v = BigInt.asIntN(64, prev + delta);
    out[i] = v;
    prev = v;
  }
  return out;
}
