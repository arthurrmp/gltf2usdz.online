/** WebUsdFramework.Converters.Shared.Usdc.FieldsSection — FIELDS section
 *  encoder for the USDC Crate format.
 *
 * Each entry in the FIELDS table is a `(tokenIndex, valueRep)` pair: a token
 * naming the field (e.g., `points`, `typeName`, `inputs:roughness`) and the
 * 8-byte ValueRep that either inlines the value or points to it externally.
 *
 * Layout on disk:
 *
 *   uint64                        numFields
 *   uint64                        compressedTokensSize
 *   bytes[compressedTokensSize]   TfDelta-compressed uint32 tokenIndices
 *   uint64[numFields]             valueReps (raw little-endian)
 *
 * The tokenIndex column is integer-coded because adjacent fields tend to
 * reuse the same token (e.g., many prims have a `typeName`). The valueRep
 * column is uncompressed: each entry is already only 8 bytes, and the cost
 * of an integer pass on 8-byte values would not pay back in size savings.
 *
 * Reference: `pxr/usd/usd/crateFile.cpp` — search for `_WriteFields`.
 */

import { compressInt32, decompressInt32 } from './integer-coding';

/**
 * One row in the FIELDS table.
 *
 * `tokenIndex` references a token in the TOKENS section; `valueRep` is the
 * raw uint64 produced by `encodeValueRep` / `inlineXxx` from `value-rep.ts`.
 */
export interface UsdcField {
  tokenIndex: number;
  valueRep: bigint;
}

/**
 * Encode the FIELDS section for the supplied list of field entries.
 *
 * @returns A freshly allocated `Uint8Array` containing the section payload
 * (header + compressed tokens + raw valueReps).
 */
export function encodeFieldsSection(fields: ReadonlyArray<UsdcField>): Uint8Array {
  const n = fields.length;

  // Step 1 — collect tokenIndices and TfDelta-compress them.
  const tokenIndices = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const t = fields[i].tokenIndex;
    if (!Number.isInteger(t) || t < 0 || t > 0xffffffff) {
      throw new RangeError(
        `encodeFieldsSection: tokenIndex at row ${i} out of uint32 range (got ${t})`
      );
    }
    tokenIndices[i] = t;
  }
  // Reinterpret the uint32 indices as int32 for compressInt32 — the values
  // are always positive and within int32 range for any realistic table size.
  const compressedTokens = compressInt32(
    Array.from(tokenIndices, (v) => v | 0)
  );

  // Step 2 — assemble the on-disk buffer.
  const headerBytes = 16; // 2 × uint64
  const valueRepsBytes = n * 8;
  const out = new Uint8Array(headerBytes + compressedTokens.length + valueRepsBytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  view.setBigUint64(0, BigInt(n), /* littleEndian */ true);
  view.setBigUint64(8, BigInt(compressedTokens.length), true);
  out.set(compressedTokens, headerBytes);

  // Step 3 — write valueReps as raw little-endian uint64 (no compression).
  let dp = headerBytes + compressedTokens.length;
  for (let i = 0; i < n; i++) {
    view.setBigUint64(dp, BigInt.asUintN(64, fields[i].valueRep), true);
    dp += 8;
  }

  return out;
}

/**
 * Decode a FIELDS section back into its rows.
 *
 * Used by tests; not on the runtime encoding path.
 *
 * @throws RangeError if the buffer is malformed or the declared size does
 *   not match the actual payload length.
 */
export function decodeFieldsSection(src: Uint8Array): UsdcField[] {
  if (src.length < 16) {
    throw new RangeError('decodeFieldsSection: header truncated');
  }
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const numFields = Number(view.getBigUint64(0, true));
  const compressedTokensSize = Number(view.getBigUint64(8, true));
  const expected = 16 + compressedTokensSize + numFields * 8;
  if (expected > src.length) {
    throw new RangeError(
      `decodeFieldsSection: section too short (need ${expected}, have ${src.length})`
    );
  }

  const tokens =
    numFields === 0
      ? new Int32Array(0)
      : decompressInt32(
          src.subarray(16, 16 + compressedTokensSize),
          numFields
        );

  const fields: UsdcField[] = new Array(numFields);
  let dp = 16 + compressedTokensSize;
  for (let i = 0; i < numFields; i++) {
    const tokenIndex = tokens[i] >>> 0; // back to uint32
    const valueRep = view.getBigUint64(dp, true);
    dp += 8;
    fields[i] = { tokenIndex, valueRep };
  }
  return fields;
}
