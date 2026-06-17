/** WebUsdFramework.Converters.Shared.Usdc.ArrayValues — encoders for the
 *  external (non-inlined) array ValueReps emitted by our converters.
 *
 * Most field values fit in the 48-bit ValueRep payload (Bool, Int, Float,
 * Token, Specifier, ...), but the geometry-heavy values do not. These
 * functions produce both:
 *
 *   - the bytes that go into the file at some offset, and
 *   - a metadata object the caller uses to populate the ValueRep once that
 *     offset is known.
 *
 * On-disk per-array layout:
 *
 *   uint64                     numElements
 *   if isCompressed:
 *     uint64                   uncompressedSize  (numElements × elementSize)
 *     uint64                   compressedSize    (length of LZ4 payload)
 *     bytes[compressedSize]    LZ4-compressed element bytes
 *   else:
 *     bytes[uncompressedSize]  raw element bytes
 *
 * Reference: `pxr/usd/usd/crateFile.cpp` — `_WriteArray` family.
 */

import { compress as lz4Compress, decompress as lz4Decompress } from './lz4-block';
import {
  CrateDataType,
  externalValueRep,
} from './value-rep';

/** Threshold above which array data is LZ4-compressed by default. */
export const COMPRESSION_THRESHOLD_BYTES = 256;

/**
 * Result of encoding one array value: the bytes to write at the file's
 * current cursor, along with the type info the caller needs to construct a
 * `ValueRep` once it knows the offset.
 */
export interface EncodedArrayValue {
  /** Bytes to append to the file at `cursor`. */
  bytes: Uint8Array;
  /** CrateDataType the ValueRep should claim. */
  type: CrateDataType;
  /** Whether the bytes were LZ4-compressed (sets `isCompressed` on the ValueRep). */
  isCompressed: boolean;
  /** Number of elements (used for sanity checks; not embedded in this struct). */
  count: number;
  /**
   * Whether the resulting ValueRep should set the `isArray` flag.
   *
   * Most external values are arrays (`Float[]`, `Vec3f[]`, `Int[]`), but some
   * scalar values are too large for the 48-bit inlined payload and are stored
   * externally with `isArray: false` (a single `Vec3f`, `Vec4f`, or matrix).
   */
  isArray: boolean;
}

/**
 * Build a ValueRep for an `EncodedArrayValue` once its file offset is known.
 */
export function arrayValueRep(value: EncodedArrayValue, fileOffset: number | bigint): bigint {
  return externalValueRep({
    type: value.type,
    isArray: value.isArray,
    isCompressed: value.isCompressed,
    fileOffset,
  });
}

/**
 * Wrap a flat byte buffer of element data with the on-disk array header
 * (count + optional compressed envelope).
 */
function packArray(
  count: number,
  elementBytes: Uint8Array,
  forceCompress: boolean | undefined
): { bytes: Uint8Array; isCompressed: boolean } {
  const uncompressedSize = elementBytes.length;
  const shouldCompress =
    forceCompress === true ||
    (forceCompress !== false && uncompressedSize >= COMPRESSION_THRESHOLD_BYTES);

  if (!shouldCompress || uncompressedSize === 0) {
    const out = new Uint8Array(8 + uncompressedSize);
    new DataView(out.buffer, out.byteOffset, out.byteLength).setBigUint64(
      0,
      BigInt(count),
      true
    );
    out.set(elementBytes, 8);
    return { bytes: out, isCompressed: false };
  }

  const compressed = lz4Compress(elementBytes);
  if (compressed.length >= uncompressedSize) {
    // LZ4 expanded; fall back to uncompressed.
    const out = new Uint8Array(8 + uncompressedSize);
    new DataView(out.buffer, out.byteOffset, out.byteLength).setBigUint64(
      0,
      BigInt(count),
      true
    );
    out.set(elementBytes, 8);
    return { bytes: out, isCompressed: false };
  }

  const out = new Uint8Array(8 + 8 + 8 + compressed.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(0, BigInt(count), true);
  view.setBigUint64(8, BigInt(uncompressedSize), true);
  view.setBigUint64(16, BigInt(compressed.length), true);
  out.set(compressed, 24);
  return { bytes: out, isCompressed: true };
}

/** Encode a Float[] (one float per element). */
export function encodeFloatArray(
  values: Float32Array | ReadonlyArray<number>,
  opts?: { compress?: boolean }
): EncodedArrayValue {
  const count = values.length;
  const elementBytes = new Uint8Array(count * 4);
  const view = new DataView(elementBytes.buffer);
  for (let i = 0; i < count; i++) view.setFloat32(i * 4, values[i], true);
  const { bytes, isCompressed } = packArray(count, elementBytes, opts?.compress);
  return { bytes, type: CrateDataType.Float, isCompressed, count, isArray: true };
}

/**
 * Encode a Vec3f[] (three floats per element). The input is a flat array of
 * length `3 × count` interleaved x,y,z,x,y,z,...
 */
export function encodeVec3fArray(
  flat: Float32Array | ReadonlyArray<number>,
  opts?: { compress?: boolean }
): EncodedArrayValue {
  if (flat.length % 3 !== 0) {
    throw new RangeError(
      `encodeVec3fArray: input length ${flat.length} is not a multiple of 3`
    );
  }
  const count = flat.length / 3;
  const elementBytes = new Uint8Array(flat.length * 4);
  const view = new DataView(elementBytes.buffer);
  for (let i = 0; i < flat.length; i++) view.setFloat32(i * 4, flat[i], true);
  const { bytes, isCompressed } = packArray(count, elementBytes, opts?.compress);
  return { bytes, type: CrateDataType.Vec3f, isCompressed, count, isArray: true };
}

/**
 * Encode a single Vec3f scalar (3 × float32 = 12 bytes). Returned with
 * `isArray: false` so the resulting ValueRep refers to a single value, not
 * an array.
 *
 * The on-disk format is identical to `encodeVec3fArray` with count=1 (so the
 * 8-byte count prefix + 12 bytes of data, uncompressed). The `isArray` flag
 * on the ValueRep is the bit that distinguishes scalar from 1-element array.
 */
export function encodeVec3fScalar(x: number, y: number, z: number): EncodedArrayValue {
  const elementBytes = new Uint8Array(12);
  const view = new DataView(elementBytes.buffer);
  view.setFloat32(0, x, true);
  view.setFloat32(4, y, true);
  view.setFloat32(8, z, true);
  // Always uncompressed for a single Vec3f — 12 bytes is too small to compress.
  const out = new Uint8Array(8 + 12);
  new DataView(out.buffer).setBigUint64(0, 1n, true);
  out.set(elementBytes, 8);
  return {
    bytes: out,
    type: CrateDataType.Vec3f,
    isCompressed: false,
    count: 1,
    isArray: false,
  };
}

/** Encode an Int[] (signed 32-bit integers). */
export function encodeInt32Array(
  values: Int32Array | ReadonlyArray<number>,
  opts?: { compress?: boolean }
): EncodedArrayValue {
  const count = values.length;
  const elementBytes = new Uint8Array(count * 4);
  const view = new DataView(elementBytes.buffer);
  for (let i = 0; i < count; i++) view.setInt32(i * 4, values[i] | 0, true);
  const { bytes, isCompressed } = packArray(count, elementBytes, opts?.compress);
  return { bytes, type: CrateDataType.Int, isCompressed, count, isArray: true };
}

/**
 * Encode a Token[] (each element is a uint32 TokenIndex into the TOKENS table).
 */
export function encodeTokenArray(
  tokenIndexes: ReadonlyArray<number>,
  opts?: { compress?: boolean }
): EncodedArrayValue {
  const count = tokenIndexes.length;
  const elementBytes = new Uint8Array(count * 4);
  const view = new DataView(elementBytes.buffer);
  for (let i = 0; i < count; i++) {
    const v = tokenIndexes[i];
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) {
      throw new RangeError(`encodeTokenArray: index ${i} = ${v} out of uint32 range`);
    }
    view.setUint32(i * 4, v, true);
  }
  const { bytes, isCompressed } = packArray(count, elementBytes, opts?.compress);
  return { bytes, type: CrateDataType.Token, isCompressed, count, isArray: true };
}

/**
 * Decode the on-disk header at `bytes[offset]` and return the underlying
 * element bytes plus the element count.
 *
 * Used by tests; not on the runtime encoding path.
 */
export function decodeArrayHeader(
  bytes: Uint8Array,
  offset: number,
  isCompressed: boolean
): { count: number; elementBytes: Uint8Array; nextOffset: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Number(view.getBigUint64(offset, true));
  if (!isCompressed) {
    const elementBytes = bytes.subarray(offset + 8);
    return { count, elementBytes, nextOffset: bytes.length };
  }
  const uncompressedSize = Number(view.getBigUint64(offset + 8, true));
  const compressedSize = Number(view.getBigUint64(offset + 16, true));
  const payload = bytes.subarray(offset + 24, offset + 24 + compressedSize);
  const elementBytes = lz4Decompress(payload, uncompressedSize);
  return { count, elementBytes, nextOffset: offset + 24 + compressedSize };
}
