/** WebUsdFramework.Converters.Shared.Usdc.ValueRep — 8-byte tagged-union
 *  encoding for every value the FIELDS section references.
 *
 * Each `ValueRep` packs three flags, a type enum, and a 48-bit payload into
 * a single uint64. The payload is interpreted differently depending on the
 * `isInlined` flag:
 *
 *   - isInlined = true:  the payload IS the value (for small scalars: bool,
 *                        int, float, token-index, specifier, etc.).
 *   - isInlined = false: the payload is a file offset where the value's bytes
 *                        live (for large values: arrays, dictionaries, etc.).
 *                        `isCompressed` indicates whether those bytes are
 *                        LZ4-compressed.
 *
 * Bit layout (MSB → LSB):
 *
 *   bit 63       isArray
 *   bit 62       isInlined
 *   bit 61       isCompressed
 *   bits 56–60   reserved (always 0)
 *   bits 48–55   CrateDataType  (8-bit enum)
 *   bits 0–47    payload        (48 bits — value or file offset)
 *
 * The bit positions match the corresponding constants in OpenUSD's
 * `pxr/usd/usd/crateValueInliners.h` / `crateFile.h`.
 */

/**
 * Subset of the CrateDataType enum from OpenUSD that our converters
 * actually emit. The numeric values are stable wire-format identifiers and
 * MUST match Apple's reader.
 */
export const CrateDataType = {
  Invalid: 0,
  Bool: 1,
  UChar: 2,
  Int: 3,
  UInt: 4,
  Int64: 5,
  UInt64: 6,
  Half: 7,
  Float: 8,
  Double: 9,
  String: 10,
  Token: 11,
  AssetPath: 12,
  Quatd: 16,
  Quatf: 17,
  Quath: 18,
  Vec2d: 19,
  Vec2f: 20,
  Vec2h: 21,
  Vec2i: 22,
  Vec3d: 23,
  Vec3f: 24,
  Vec3h: 25,
  Vec3i: 26,
  Vec4d: 27,
  Vec4f: 28,
  Vec4h: 29,
  Vec4i: 30,
  Dictionary: 31,
  TokenListOp: 32,
  StringListOp: 33,
  PathListOp: 34,
  ReferenceListOp: 35,
  IntListOp: 36,
  Int64ListOp: 37,
  UIntListOp: 38,
  UInt64ListOp: 39,
  PathVector: 40,
  TokenVector: 41,
  Specifier: 42,
  Permission: 43,
  Variability: 44,
  VariantSelectionMap: 45,
  TimeSamples: 46,
  Payload: 47,
  DoubleVector: 48,
  LayerOffsetVector: 49,
  StringVector: 50,
  ValueBlock: 51,
  Value: 52,
  UnregisteredValue: 53,
  UnregisteredValueListOp: 54,
  PayloadListOp: 55,
  TimeCode: 56,
} as const;
export type CrateDataType = (typeof CrateDataType)[keyof typeof CrateDataType];

/** SdfSpecifier enum — `def` / `over` / `class` on a prim spec. */
export const SdfSpecifier = {
  Def: 0,
  Over: 1,
  Class: 2,
} as const;
export type SdfSpecifier = (typeof SdfSpecifier)[keyof typeof SdfSpecifier];

/** SdfPermission enum — public / private property visibility. */
export const SdfPermission = {
  Public: 0,
  Private: 1,
} as const;
export type SdfPermission = (typeof SdfPermission)[keyof typeof SdfPermission];

/** SdfVariability enum — varying / uniform attribute scheduling. */
export const SdfVariability = {
  Varying: 0,
  Uniform: 1,
} as const;
export type SdfVariability = (typeof SdfVariability)[keyof typeof SdfVariability];

/** SdfSpecType enum — what kind of scene-description spec a row in the SPECS section describes. */
export const SdfSpecType = {
  Unknown: 0,
  Attribute: 1,
  Connection: 2,
  Expression: 3,
  Mapper: 4,
  MapperArg: 5,
  Prim: 6,
  PseudoRoot: 7,
  Relationship: 8,
  RelationshipTarget: 9,
  Variant: 10,
  VariantSet: 11,
} as const;
export type SdfSpecType = (typeof SdfSpecType)[keyof typeof SdfSpecType];

const BIT_IS_ARRAY = 1n << 63n;
const BIT_IS_INLINED = 1n << 62n;
const BIT_IS_COMPRESSED = 1n << 61n;
const TYPE_SHIFT = 48n;
const TYPE_MASK = 0xffn;
const PAYLOAD_MASK = (1n << 48n) - 1n;

/** Decoded ValueRep — purely descriptive; the canonical representation is the bigint. */
export interface ValueRepFields {
  type: CrateDataType;
  isArray: boolean;
  isInlined: boolean;
  isCompressed: boolean;
  /** 48-bit payload. Caller must ensure it fits in `PAYLOAD_MASK`. */
  payload: bigint;
}

/** Pack a `ValueRepFields` into the canonical uint64 representation. */
export function encodeValueRep(rep: ValueRepFields): bigint {
  if ((rep.payload & ~PAYLOAD_MASK) !== 0n) {
    throw new RangeError(
      `encodeValueRep: payload ${rep.payload} does not fit in 48 bits`
    );
  }
  if (rep.type < 0 || rep.type > 0xff) {
    throw new RangeError(`encodeValueRep: type ${rep.type} out of uint8 range`);
  }
  let v = 0n;
  if (rep.isArray) v |= BIT_IS_ARRAY;
  if (rep.isInlined) v |= BIT_IS_INLINED;
  if (rep.isCompressed) v |= BIT_IS_COMPRESSED;
  v |= (BigInt(rep.type) & TYPE_MASK) << TYPE_SHIFT;
  v |= rep.payload & PAYLOAD_MASK;
  return v;
}

/** Decode a uint64 ValueRep into its named fields. */
export function decodeValueRep(value: bigint): ValueRepFields {
  return {
    type: Number((value >> TYPE_SHIFT) & TYPE_MASK) as CrateDataType,
    isArray: (value & BIT_IS_ARRAY) !== 0n,
    isInlined: (value & BIT_IS_INLINED) !== 0n,
    isCompressed: (value & BIT_IS_COMPRESSED) !== 0n,
    payload: value & PAYLOAD_MASK,
  };
}

/** Inline a boolean as a ValueRep. */
export function inlineBool(b: boolean): bigint {
  return encodeValueRep({
    type: CrateDataType.Bool,
    isArray: false,
    isInlined: true,
    isCompressed: false,
    payload: b ? 1n : 0n,
  });
}

/** Inline a 32-bit signed integer. The payload holds the 32-bit two's-complement value. */
export function inlineInt(n: number): bigint {
  if (!Number.isInteger(n) || n < -0x80000000 || n > 0x7fffffff) {
    throw new RangeError(`inlineInt: ${n} is out of int32 range`);
  }
  // Sign-extending into 48 bits is unnecessary for round-tripping — we
  // store the low 32 bits and the decoder extracts them the same way.
  const low32 = BigInt(n >>> 0); // unsigned representation of the int32
  return encodeValueRep({
    type: CrateDataType.Int,
    isArray: false,
    isInlined: true,
    isCompressed: false,
    payload: low32,
  });
}

/**
 * Inline a 32-bit IEEE-754 float. The payload holds the raw 32 bits of the
 * float (low end of the 48-bit window).
 */
export function inlineFloat(f: number): bigint {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, f, /* littleEndian */ true);
  const bits = new DataView(buf).getUint32(0, true);
  return encodeValueRep({
    type: CrateDataType.Float,
    isArray: false,
    isInlined: true,
    isCompressed: false,
    payload: BigInt(bits),
  });
}

/** Recover a float value from an inlined Float ValueRep. */
export function extractInlineFloat(rep: bigint): number {
  const fields = decodeValueRep(rep);
  if (fields.type !== CrateDataType.Float || !fields.isInlined) {
    throw new RangeError('extractInlineFloat: not an inlined Float ValueRep');
  }
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, Number(fields.payload & 0xffffffffn), true);
  return new DataView(buf).getFloat32(0, true);
}

/** Inline a TokenIndex. The payload holds the uint32 index. */
export function inlineToken(tokenIndex: number): bigint {
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 0xffffffff) {
    throw new RangeError(`inlineToken: ${tokenIndex} out of uint32 range`);
  }
  return encodeValueRep({
    type: CrateDataType.Token,
    isArray: false,
    isInlined: true,
    isCompressed: false,
    payload: BigInt(tokenIndex),
  });
}

/** Inline a Specifier (def / over / class). */
export function inlineSpecifier(s: SdfSpecifier): bigint {
  return encodeValueRep({
    type: CrateDataType.Specifier,
    isArray: false,
    isInlined: true,
    isCompressed: false,
    payload: BigInt(s),
  });
}

/** Inline a Variability (varying / uniform). */
export function inlineVariability(v: SdfVariability): bigint {
  return encodeValueRep({
    type: CrateDataType.Variability,
    isArray: false,
    isInlined: true,
    isCompressed: false,
    payload: BigInt(v),
  });
}

/** Inline a Permission (public / private). */
export function inlinePermission(p: SdfPermission): bigint {
  return encodeValueRep({
    type: CrateDataType.Permission,
    isArray: false,
    isInlined: true,
    isCompressed: false,
    payload: BigInt(p),
  });
}

/**
 * Build a ValueRep for an external (non-inlined) value of the given type.
 * The payload is the file offset where the value's bytes live.
 *
 * Use this for arrays, dictionaries, and any other value whose serialized
 * form does not fit in 48 bits.
 */
export function externalValueRep(opts: {
  type: CrateDataType;
  isArray: boolean;
  isCompressed: boolean;
  fileOffset: bigint | number;
}): bigint {
  const offset = typeof opts.fileOffset === 'bigint' ? opts.fileOffset : BigInt(opts.fileOffset);
  if (offset < 0n || (offset & ~PAYLOAD_MASK) !== 0n) {
    throw new RangeError(
      `externalValueRep: file offset ${offset} does not fit in 48 bits`
    );
  }
  return encodeValueRep({
    type: opts.type,
    isArray: opts.isArray,
    isInlined: false,
    isCompressed: opts.isCompressed,
    payload: offset,
  });
}
