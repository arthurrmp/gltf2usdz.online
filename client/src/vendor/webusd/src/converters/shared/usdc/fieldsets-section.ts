/** WebUsdFramework.Converters.Shared.Usdc.FieldSetsSection — FIELDSETS
 *  section encoder.
 *
 * Each spec in the SPECS section references a *field set* — an ordered list
 * of FieldIndex values whose union describes that spec's properties.
 * Multiple specs commonly share the same field set (think: every empty Xform
 * has the same `(specifier, typeName)` pair), so the FIELDSETS section
 * stores a flat, deduped pool that specs reference by start position.
 *
 * The flat layout uses a sentinel value `~0u = 0xFFFFFFFF` to terminate each
 * field set inside the pool:
 *
 *   pool = [ A0, A1, A2, ~0,  B0, B1, ~0,  C0, ~0,  ... ]
 *           ^                  ^             ^
 *           FieldSetIndex 0    FieldSetIndex 4   FieldSetIndex 7
 *
 * On disk:
 *
 *   uint64                  numEntries  (total ints, including sentinels)
 *   uint64                  compressedSize
 *   bytes[compressedSize]   TfDelta-compressed flat int32 pool
 *
 * Reference: `pxr/usd/usd/crateFile.cpp` — search for `_WriteFieldSets`.
 */

import { compressInt32, decompressInt32 } from './integer-coding';

/** Sentinel marking the end of one field set inside the flat pool. */
export const FIELD_SET_SENTINEL = 0xffffffff;

/**
 * Mutable builder for the flat FIELDSETS pool. Deduplicates field sets that
 * have identical FieldIndex sequences so the SPECS section can re-use the
 * same FieldSetIndex.
 */
export class FieldSetTable {
  private readonly pool: number[] = [];
  private readonly dedupe = new Map<string, number>();

  /**
   * Add a field set to the pool. Returns the FieldSetIndex (the starting
   * offset of this set within the flat pool). Returns the existing index if
   * an identical sequence has already been added.
   *
   * The sentinel terminator is added automatically; the caller passes only
   * the field-index values themselves.
   */
  add(fieldIndices: ReadonlyArray<number>): number {
    for (const v of fieldIndices) {
      if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) {
        throw new RangeError(`FieldSetTable.add: invalid FieldIndex ${v}`);
      }
      if (v === FIELD_SET_SENTINEL) {
        throw new RangeError(
          `FieldSetTable.add: FieldIndex ${v} collides with the sentinel`
        );
      }
    }
    const key = fieldIndices.join(',');
    const existing = this.dedupe.get(key);
    if (existing !== undefined) return existing;

    const start = this.pool.length;
    for (const v of fieldIndices) this.pool.push(v >>> 0);
    this.pool.push(FIELD_SET_SENTINEL);
    this.dedupe.set(key, start);
    return start;
  }

  /** Read a field set out of the pool by its FieldSetIndex. */
  read(start: number): number[] {
    const out: number[] = [];
    for (let i = start; i < this.pool.length; i++) {
      const v = this.pool[i];
      if (v === FIELD_SET_SENTINEL) return out;
      out.push(v);
    }
    throw new RangeError(`FieldSetTable.read: no sentinel found from index ${start}`);
  }

  /** Number of integers in the flat pool (including sentinels). */
  get size(): number {
    return this.pool.length;
  }

  /** Snapshot of the flat pool. Caller owns the returned array. */
  toArray(): number[] {
    return this.pool.slice();
  }

  /** Encode the table as a complete FIELDSETS section payload. */
  encode(): Uint8Array {
    return encodeFieldSetsSection(this.pool);
  }
}

/**
 * Encode a FIELDSETS section from a flat int32 pool.
 *
 * Layout: 16-byte header (numEntries, compressedSize) + TfDelta-compressed
 * payload. The caller is responsible for inserting sentinels between sets.
 */
export function encodeFieldSetsSection(flat: ReadonlyArray<number>): Uint8Array {
  const n = flat.length;
  // Reinterpret as int32 for compression; sentinel value 0xFFFFFFFF becomes -1.
  const asInt32: number[] = new Array(n);
  for (let i = 0; i < n; i++) asInt32[i] = flat[i] | 0;

  const compressed = n === 0 ? new Uint8Array(0) : compressInt32(asInt32);
  const out = new Uint8Array(16 + compressed.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(0, BigInt(n), /* littleEndian */ true);
  view.setBigUint64(8, BigInt(compressed.length), true);
  out.set(compressed, 16);
  return out;
}

/**
 * Decode a FIELDSETS section back into the flat uint32 pool.
 *
 * @throws RangeError if the section is malformed or sizes disagree.
 */
export function decodeFieldSetsSection(src: Uint8Array): number[] {
  if (src.length < 16) {
    throw new RangeError('decodeFieldSetsSection: header truncated');
  }
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const numEntries = Number(view.getBigUint64(0, true));
  const compressedSize = Number(view.getBigUint64(8, true));
  if (16 + compressedSize > src.length) {
    throw new RangeError('decodeFieldSetsSection: payload truncated');
  }
  if (numEntries === 0) return [];

  const decoded = decompressInt32(src.subarray(16, 16 + compressedSize), numEntries);
  const out: number[] = new Array(numEntries);
  for (let i = 0; i < numEntries; i++) out[i] = decoded[i] >>> 0;
  return out;
}
