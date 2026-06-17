/** WebUsdFramework.Converters.Shared.Usdc.ListOpValues — encoder for the
 *  list-op value types used by `prepend apiSchemas` / `append apiSchemas` /
 *  `prepend references` and friends.
 *
 * A `SdfListOp<T>` carries up to six independent sub-lists:
 *
 *   - explicit  — overrides any inherited list (rare; replaces the whole list)
 *   - added     — legacy; modern USD avoids this in favor of prepend/append
 *   - prepended — items pushed onto the front of the inherited list
 *   - appended  — items pushed onto the end of the inherited list
 *   - deleted   — items removed from the inherited list
 *   - ordered   — items present in a particular order
 *
 * The most common shape in our converters is a single `prepended` sub-list
 * with one or two TokenIndex values (e.g. `prepend apiSchemas =
 * ["MaterialBindingAPI"]`).
 *
 * On-disk wire format (uncompressed):
 *
 *   uint8                  isExplicit         (1 = the explicit sub-list is set)
 *   uint8                  numActiveLists     (count of non-empty sub-lists)
 *   for each active list:
 *     uint8                listType           (0..5; see SdfListOpSubListType)
 *     uint64               numItems
 *     uint32[numItems]     TokenIndex per item
 *
 * Reference: `pxr/usd/sdf/listOp.cpp` and `pxr/usd/usd/crateFile.cpp`
 * (search for `_WriteListOp`).
 */

import { CrateDataType, externalValueRep } from './value-rep';
import type { EncodedArrayValue } from './array-values';

/** Sub-list opcode encoding — fixed by the wire format. */
export const SdfListOpSubListType = {
  Explicit: 0,
  Added: 1,
  Deleted: 2,
  Ordered: 3,
  Prepended: 4,
  Appended: 5,
} as const;
export type SdfListOpSubListType =
  (typeof SdfListOpSubListType)[keyof typeof SdfListOpSubListType];

/**
 * Mutable description of a SdfListOp before serialization.
 *
 * The wire format is identical for `TokenListOp`, `StringListOp`, `IntListOp`,
 * `Int64ListOp`, `UIntListOp`, `UInt64ListOp`, and `PathListOp` — every
 * element is a uint32 *index* that references some other table (the
 * TOKENS table for tokens / strings, the PATHS table for paths). This
 * type captures all of them; concrete encoders set the appropriate
 * `CrateDataType` tag on the resulting ValueRep.
 */
export interface IndexListOpInput {
  isExplicit?: boolean;
  explicit?: ReadonlyArray<number>;
  added?: ReadonlyArray<number>;
  deleted?: ReadonlyArray<number>;
  ordered?: ReadonlyArray<number>;
  prepended?: ReadonlyArray<number>;
  appended?: ReadonlyArray<number>;
}

/** Backwards-compatible alias kept so existing TokenListOp callers don't break. */
export type TokenListOpInput = IndexListOpInput;

function validateTokenIndices(label: string, items: ReadonlyArray<number>): void {
  for (let i = 0; i < items.length; i++) {
    const v = items[i];
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) {
      throw new RangeError(
        `encodeTokenListOp: ${label}[${i}] = ${v} is out of uint32 range`
      );
    }
  }
}

/**
 * Shared low-level encoder for any index-based ListOp. The caller supplies
 * the `CrateDataType` tag that should appear on the resulting ValueRep
 * (`TokenListOp` for tokens, `PathListOp` for paths, ...).
 */
function encodeIndexListOp(
  input: IndexListOpInput,
  type: CrateDataType
): EncodedArrayValue {
  const sublists: { type: SdfListOpSubListType; items: ReadonlyArray<number> }[] = [];
  if (input.explicit && input.explicit.length > 0) {
    validateTokenIndices('explicit', input.explicit);
    sublists.push({ type: SdfListOpSubListType.Explicit, items: input.explicit });
  }
  if (input.added && input.added.length > 0) {
    validateTokenIndices('added', input.added);
    sublists.push({ type: SdfListOpSubListType.Added, items: input.added });
  }
  if (input.deleted && input.deleted.length > 0) {
    validateTokenIndices('deleted', input.deleted);
    sublists.push({ type: SdfListOpSubListType.Deleted, items: input.deleted });
  }
  if (input.ordered && input.ordered.length > 0) {
    validateTokenIndices('ordered', input.ordered);
    sublists.push({ type: SdfListOpSubListType.Ordered, items: input.ordered });
  }
  if (input.prepended && input.prepended.length > 0) {
    validateTokenIndices('prepended', input.prepended);
    sublists.push({ type: SdfListOpSubListType.Prepended, items: input.prepended });
  }
  if (input.appended && input.appended.length > 0) {
    validateTokenIndices('appended', input.appended);
    sublists.push({ type: SdfListOpSubListType.Appended, items: input.appended });
  }

  // Compute total size: 1 (isExplicit) + 1 (numActiveLists) +
  //   per-list: 1 (type) + 8 (numItems) + 4 × items.length
  let total = 2;
  for (const s of sublists) total += 1 + 8 + 4 * s.items.length;

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dp = 0;

  bytes[dp++] = input.isExplicit ? 1 : 0;
  bytes[dp++] = sublists.length;

  for (const s of sublists) {
    bytes[dp++] = s.type;
    view.setBigUint64(dp, BigInt(s.items.length), /* littleEndian */ true);
    dp += 8;
    for (let i = 0; i < s.items.length; i++) {
      view.setUint32(dp, s.items[i], true);
      dp += 4;
    }
  }

  return {
    bytes,
    type,
    isCompressed: false,
    count: sublists.length, // metadata only; not used by anyone today
    isArray: false,
  };
}

/**
 * Encode a TokenListOp. Items are TokenIndex values into the TOKENS table.
 * The resulting ValueRep has `type: TokenListOp`, `isArray: false`,
 * `isCompressed: false`.
 */
export function encodeTokenListOp(input: IndexListOpInput): EncodedArrayValue {
  return encodeIndexListOp(input, CrateDataType.TokenListOp);
}

/**
 * Encode a PathListOp. Items are PathIndex values into the PATHS table.
 * The resulting ValueRep has `type: PathListOp`, `isArray: false`,
 * `isCompressed: false`.
 */
export function encodePathListOp(input: IndexListOpInput): EncodedArrayValue {
  return encodeIndexListOp(input, CrateDataType.PathListOp);
}

/**
 * Decode a TokenListOp value from raw bytes. Used by tests; not on the
 * runtime encoding path.
 */
export function decodeTokenListOp(src: Uint8Array): TokenListOpInput {
  if (src.length < 2) throw new RangeError('decodeTokenListOp: header truncated');
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let sp = 0;
  const isExplicit = src[sp++] === 1;
  const numLists = src[sp++];
  const out: TokenListOpInput = { isExplicit };
  for (let l = 0; l < numLists; l++) {
    if (sp + 9 > src.length) throw new RangeError('decodeTokenListOp: sub-list header truncated');
    const listType = src[sp++] as SdfListOpSubListType;
    const numItems = Number(view.getBigUint64(sp, true));
    sp += 8;
    if (sp + 4 * numItems > src.length) {
      throw new RangeError('decodeTokenListOp: item payload truncated');
    }
    const items: number[] = new Array(numItems);
    for (let i = 0; i < numItems; i++) {
      items[i] = view.getUint32(sp, true);
      sp += 4;
    }
    switch (listType) {
      case SdfListOpSubListType.Explicit:
        out.explicit = items;
        break;
      case SdfListOpSubListType.Added:
        out.added = items;
        break;
      case SdfListOpSubListType.Deleted:
        out.deleted = items;
        break;
      case SdfListOpSubListType.Ordered:
        out.ordered = items;
        break;
      case SdfListOpSubListType.Prepended:
        out.prepended = items;
        break;
      case SdfListOpSubListType.Appended:
        out.appended = items;
        break;
      default:
        throw new RangeError(`decodeTokenListOp: unknown sublist type ${listType}`);
    }
  }
  return out;
}

/**
 * Build the ValueRep for an encoded ListOp once its file offset is known.
 * Same semantics as `arrayValueRep`, but the type bit always encodes as a
 * scalar (`isArray: false`) since list-ops are themselves their own type.
 */
export function listOpValueRep(value: EncodedArrayValue, fileOffset: number | bigint): bigint {
  return externalValueRep({
    type: value.type,
    isArray: false,
    isCompressed: value.isCompressed,
    fileOffset,
  });
}
