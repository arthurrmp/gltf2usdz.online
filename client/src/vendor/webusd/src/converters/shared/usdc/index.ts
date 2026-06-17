/** WebUsdFramework.Converters.Shared.Usdc — public re-exports for the
 *  USDC (Pixar Crate) binary layer encoder.
 *
 * The USDC encoder is structurally complete: tokens, strings, fields,
 * field-sets, paths, specs, array values, and a layer-builder orchestrator
 * are all in place and round-trip through their respective decoders.
 *
 * Pipeline integration is gated behind `PackageConfig.layerFormat` (default
 * `'usda'`). Flipping the default to `'usdc'` is part of issue #122 and
 * happens only after each output is validated against `usdcat`-produced
 * fixtures and loads cleanly in macOS QuickLook / `usdview` / `usdcat`.
 */

// Section encoders.
export {
  TokenTable,
  encodeTokensSection,
  decodeTokensSection,
  TOKENS_SECTION_HEADER_SIZE,
} from './tokens-section';

export {
  StringTable,
  encodeStringsSection,
  decodeStringsSection,
  STRINGS_SECTION_HEADER_SIZE,
} from './strings-section';

export {
  type UsdcField,
  encodeFieldsSection,
  decodeFieldsSection,
} from './fields-section';

export {
  FieldSetTable,
  FIELD_SET_SENTINEL,
  encodeFieldSetsSection,
  decodeFieldSetsSection,
} from './fieldsets-section';

export {
  type PathNode,
  type EncodedPathTree,
  encodePathsSection,
  decodePathsSection,
  rebuildPathTree,
} from './paths-section';

export {
  type UsdcSpec,
  encodeSpecsSection,
  decodeSpecsSection,
} from './specs-section';

// Array values + ValueRep helpers.
export {
  type EncodedArrayValue,
  encodeFloatArray,
  encodeVec3fArray,
  encodeInt32Array,
  encodeTokenArray,
  arrayValueRep,
  decodeArrayHeader,
  COMPRESSION_THRESHOLD_BYTES,
} from './array-values';

export {
  CrateDataType,
  SdfSpecifier,
  SdfPermission,
  SdfVariability,
  SdfSpecType,
  type ValueRepFields,
  encodeValueRep,
  decodeValueRep,
  inlineBool,
  inlineInt,
  inlineFloat,
  extractInlineFloat,
  inlineToken,
  inlineSpecifier,
  inlineVariability,
  inlinePermission,
  externalValueRep,
} from './value-rep';

// Layer assembly.
export {
  UsdcLayerBuilder,
  type PrimHandle,
  buildSimpleUsdcLayer,
} from './layer-builder';

// Low-level utilities (mostly for tests / advanced callers).
export {
  compress as lz4Compress,
  decompress as lz4Decompress,
} from './lz4-block';

export {
  compressInt32,
  decompressInt32,
  compressInt64,
  decompressInt64,
  int32CompressedBound,
  int64CompressedBound,
} from './integer-coding';
