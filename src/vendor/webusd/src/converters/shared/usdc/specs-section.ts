/** WebUsdFramework.Converters.Shared.Usdc.SpecsSection — SPECS section encoder.
 *
 * The SPECS table maps every scene-description spec (prim, attribute,
 * relationship, ...) to its location in the path tree, the field set that
 * describes its properties, and its spec type.
 *
 * Each spec is a triple of unsigned 32-bit integers:
 *
 *   pathIndex      → index into the PATHS section
 *   fieldSetIndex  → start position of this spec's field set in FIELDSETS
 *   specType       → SdfSpecType enum value (Prim / Attribute / ...)
 *
 * The three columns are stored as parallel arrays, each TfDelta-compressed
 * independently. Adjacent specs commonly share consecutive pathIndexes (a
 * prim followed by all of its property specs), and many prims of the same
 * type share an identical fieldSetIndex, so the per-column compression is
 * effective.
 *
 * Layout on disk:
 *
 *   uint64                            numSpecs
 *   uint64                            compressedPathIndexesSize
 *   bytes[compressedPathIndexesSize]   TfDelta(int32) pathIndexes
 *   uint64                            compressedFieldSetIndexesSize
 *   bytes[..]                          TfDelta(int32) fieldSetIndexes
 *   uint64                            compressedSpecTypesSize
 *   bytes[..]                          TfDelta(int32) specTypes
 *
 * Reference: `pxr/usd/usd/crateFile.cpp` — search for `_WriteSpecs`.
 */

import { compressInt32, decompressInt32 } from './integer-coding';
import type { SdfSpecType } from './value-rep';

/** One row in the SPECS table. */
export interface UsdcSpec {
  pathIndex: number;
  fieldSetIndex: number;
  specType: SdfSpecType;
}

function validateUint32(value: number, name: string, row: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(
      `encodeSpecsSection: ${name} at row ${row} out of uint32 range (got ${value})`
    );
  }
}

/**
 * Encode the SPECS section for the supplied list of spec rows.
 *
 * @returns A freshly allocated `Uint8Array` with the section payload.
 */
export function encodeSpecsSection(specs: ReadonlyArray<UsdcSpec>): Uint8Array {
  const n = specs.length;

  const paths: number[] = new Array(n);
  const fieldSets: number[] = new Array(n);
  const types: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    validateUint32(specs[i].pathIndex, 'pathIndex', i);
    validateUint32(specs[i].fieldSetIndex, 'fieldSetIndex', i);
    validateUint32(specs[i].specType, 'specType', i);
    paths[i] = specs[i].pathIndex | 0;
    fieldSets[i] = specs[i].fieldSetIndex | 0;
    types[i] = specs[i].specType | 0;
  }

  const cPaths = n === 0 ? new Uint8Array(0) : compressInt32(paths);
  const cFieldSets = n === 0 ? new Uint8Array(0) : compressInt32(fieldSets);
  const cTypes = n === 0 ? new Uint8Array(0) : compressInt32(types);

  const headerBytes = 8 + 8 + 8 + 8;
  const out = new Uint8Array(headerBytes + cPaths.length + cFieldSets.length + cTypes.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(0, BigInt(n), /* littleEndian */ true);
  view.setBigUint64(8, BigInt(cPaths.length), true);
  view.setBigUint64(16, BigInt(cFieldSets.length), true);
  view.setBigUint64(24, BigInt(cTypes.length), true);

  let dp = headerBytes;
  out.set(cPaths, dp);
  dp += cPaths.length;
  out.set(cFieldSets, dp);
  dp += cFieldSets.length;
  out.set(cTypes, dp);

  return out;
}

/**
 * Decode a SPECS section back into its rows.
 *
 * Used by tests; not on the runtime encoding path.
 *
 * @throws RangeError if the section is malformed or sizes disagree.
 */
export function decodeSpecsSection(src: Uint8Array): UsdcSpec[] {
  if (src.length < 32) {
    throw new RangeError('decodeSpecsSection: header truncated');
  }
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const numSpecs = Number(view.getBigUint64(0, true));
  const cPathsSize = Number(view.getBigUint64(8, true));
  const cFieldSetsSize = Number(view.getBigUint64(16, true));
  const cTypesSize = Number(view.getBigUint64(24, true));
  const expected = 32 + cPathsSize + cFieldSetsSize + cTypesSize;
  if (expected > src.length) {
    throw new RangeError(
      `decodeSpecsSection: section too short (need ${expected}, have ${src.length})`
    );
  }
  if (numSpecs === 0) return [];

  let dp = 32;
  const paths = decompressInt32(src.subarray(dp, dp + cPathsSize), numSpecs);
  dp += cPathsSize;
  const fieldSets = decompressInt32(src.subarray(dp, dp + cFieldSetsSize), numSpecs);
  dp += cFieldSetsSize;
  const types = decompressInt32(src.subarray(dp, dp + cTypesSize), numSpecs);

  const out: UsdcSpec[] = new Array(numSpecs);
  for (let i = 0; i < numSpecs; i++) {
    out[i] = {
      pathIndex: paths[i] >>> 0,
      fieldSetIndex: fieldSets[i] >>> 0,
      specType: (types[i] >>> 0) as SdfSpecType,
    };
  }
  return out;
}
