/** WebUsdFramework.Converters.Shared.Usdc.UsdNodeAdapter — translate a
 *  `UsdNode` scene-graph tree into a `UsdcLayerBuilder` invocation
 *  sequence so the existing converters can opt into binary output without
 *  changing how they construct the scene.
 *
 * The converters today build USDA-shaped `UsdNode` trees and call
 * `serializeToUsda()` to produce text. With this adapter, the same tree can
 * be fed into `UsdcLayerBuilder` to produce equivalent binary bytes.
 *
 * The adapter handles the property shapes the live converters actually emit
 * (point3f[] arrays, float scalars, token attributes, …). Anything outside
 * that subset (relationships, list-ops, connections, scalar Vec3f literals
 * stored as USDA strings) is marked `unsupported` so the caller can decide
 * whether to skip it or fall back to USDA output for the whole layer.
 */

import { UsdNode } from '../../../core/usd-node';
import { UsdcLayerBuilder, type PrimHandle } from './layer-builder';
import {
  parsePropertyKey,
  type ParsedProperty,
  type ListOpOpcode,
} from './property-parser';
import { CrateDataType } from './value-rep';
import { parseVec3fScalar, parseVec3fArray } from './usda-value-parser';

/** What happened to one property as the adapter walked it. */
export interface AdaptedProperty {
  rawKey: string;
  /** `true` if the adapter encoded the property; `false` if it was skipped. */
  emitted: boolean;
  /** Human-readable explanation when `emitted` is `false`. */
  reason?: string;
}

/** Summary of a tree adaptation pass. */
export interface AdaptationReport {
  /** Number of prims declared. */
  primCount: number;
  /** Per-property outcomes (every property that was visited). */
  properties: AdaptedProperty[];
  /** Number of properties skipped (`reason` set). Convenience aggregate. */
  skipped: number;
}

/**
 * Encode `root` and every descendant into `builder`. The root must be an
 * `Xform`-typed prim (or compatible); the adapter declares it under the
 * pseudo-root and walks its children depth-first.
 *
 * Returns a report listing every property the walker saw and whether the
 * builder accepted it. Callers that need byte-for-byte parity with USDA
 * should treat any `report.skipped > 0` as a signal to fall back.
 */
export function adaptUsdNodeTree(root: UsdNode, builder: UsdcLayerBuilder): AdaptationReport {
  const report: AdaptationReport = {
    primCount: 0,
    properties: [],
    skipped: 0,
  };

  function visit(node: UsdNode): void {
    const handle = builder.declarePrim(node.getPath(), node.getTypeName());
    report.primCount++;

    for (const prop of node.getProperties()) {
      const result = applyProperty(builder, handle, prop.key, prop.value);
      if (!result.emitted) report.skipped++;
      report.properties.push(result);
    }

    for (const child of node.getChildren()) visit(child);
  }

  visit(root);
  return report;
}

/**
 * Apply a single property to the builder. Pure function — no I/O, no
 * exceptions on unsupported inputs (the unsupported case returns a
 * descriptive AdaptedProperty instead).
 */
export function applyProperty(
  builder: UsdcLayerBuilder,
  prim: PrimHandle,
  key: string,
  value: unknown
): AdaptedProperty {
  const parsed = parsePropertyKey(key);
  if (parsed.kind === 'unsupported') {
    return { rawKey: key, emitted: false, reason: parsed.reason };
  }
  if (parsed.kind === 'list-op') {
    return applyListOp(builder, prim, parsed.name, parsed.opcode, value, key);
  }
  if (parsed.kind === 'relationship') {
    return applyRelationship(builder, prim, parsed.name, value, key);
  }
  return applyTypedAttribute(builder, prim, parsed, value, key);
}

function applyTypedAttribute(
  builder: UsdcLayerBuilder,
  prim: PrimHandle,
  parsed: Extract<ParsedProperty, { kind: 'attribute' }>,
  value: unknown,
  rawKey: string
): AdaptedProperty {
  const { name, type, isArray } = parsed;
  if (isArray) {
    return applyArrayAttribute(builder, prim, name, type, value, rawKey);
  }
  return applyScalarAttribute(builder, prim, name, type, value, rawKey);
}

function applyScalarAttribute(
  builder: UsdcLayerBuilder,
  prim: PrimHandle,
  name: string,
  type: CrateDataType,
  value: unknown,
  rawKey: string
): AdaptedProperty {
  switch (type) {
    case CrateDataType.Float: {
      const n = coerceFiniteNumber(value);
      if (n === null) return skipped(rawKey, `non-numeric value for float scalar`);
      builder.addFloatAttribute(prim, name, n);
      return { rawKey, emitted: true };
    }
    case CrateDataType.Int: {
      const n = coerceInteger(value);
      if (n === null) return skipped(rawKey, `non-integer value for int scalar`);
      builder.addIntAttribute(prim, name, n);
      return { rawKey, emitted: true };
    }
    case CrateDataType.Token: {
      // Token values are always interned as strings; an empty string is
      // valid (e.g. `token outputs:surface`).
      const s = typeof value === 'string' ? value : value == null ? '' : String(value);
      builder.addTokenAttribute(prim, name, s);
      return { rawKey, emitted: true };
    }
    case CrateDataType.Vec3f: {
      // Two input shapes:
      //   - USDA-formatted string `"(x, y, z)"` (color3f inputs:diffuseColor)
      //   - typed Float32Array of length 3 (rare but cheap to support)
      let triple: Float32Array | null = null;
      if (typeof value === 'string') {
        triple = parseVec3fScalar(value);
      } else if (value instanceof Float32Array && value.length === 3) {
        triple = value;
      } else if (Array.isArray(value) && value.length === 3) {
        triple = coerceFloat32Array(value);
      }
      if (!triple) return skipped(rawKey, 'Vec3f scalar expected (x,y,z) tuple');
      builder.addVec3fAttribute(prim, name, triple[0], triple[1], triple[2]);
      return { rawKey, emitted: true };
    }
    default:
      return skipped(rawKey, `scalar type ${describeType(type)} not yet supported`);
  }
}

function applyArrayAttribute(
  builder: UsdcLayerBuilder,
  prim: PrimHandle,
  name: string,
  type: CrateDataType,
  value: unknown,
  rawKey: string
): AdaptedProperty {
  switch (type) {
    case CrateDataType.Float: {
      const arr = coerceFloat32Array(value);
      if (!arr) return skipped(rawKey, 'float[] expected Float32Array or numeric array');
      builder.addFloatArrayAttribute(prim, name, arr);
      return { rawKey, emitted: true };
    }
    case CrateDataType.Vec3f: {
      // Three input shapes for Vec3f[]:
      //   - typed Float32Array (point3f[] points, color3f[] primvars:displayColor)
      //   - plain number[] (typed-array refusing callers)
      //   - USDA-formatted string `"[(...), (...)]"` (float3[] extent)
      let arr: Float32Array | null = null;
      if (typeof value === 'string') {
        arr = parseVec3fArray(value);
      } else {
        arr = coerceFloat32Array(value);
      }
      if (!arr) return skipped(rawKey, 'Vec3f[] expected Float32Array, numeric array, or USDA literal');
      if (arr.length % 3 !== 0) {
        return skipped(rawKey, `Vec3f[] length ${arr.length} not a multiple of 3`);
      }
      builder.addVec3fArrayAttribute(prim, name, arr);
      return { rawKey, emitted: true };
    }
    case CrateDataType.Int: {
      const arr = coerceInt32Array(value);
      if (!arr) return skipped(rawKey, 'int[] expected Int32Array or integer array');
      builder.addIntArrayAttribute(prim, name, arr);
      return { rawKey, emitted: true };
    }
    case CrateDataType.Token: {
      const arr = coerceStringArray(value);
      if (!arr) return skipped(rawKey, 'token[] expected string array');
      builder.addTokenArrayAttribute(prim, name, arr);
      return { rawKey, emitted: true };
    }
    default:
      return skipped(rawKey, `array type ${describeType(type)} not yet supported`);
  }
}

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function coerceInteger(value: unknown): number | null {
  const n = coerceFiniteNumber(value);
  if (n === null) return null;
  if (!Number.isInteger(n)) return null;
  return n;
}

function coerceFloat32Array(value: unknown): Float32Array | null {
  if (value instanceof Float32Array) return value;
  if (Array.isArray(value)) {
    // Reject if any element isn't a finite number.
    const out = new Float32Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      out[i] = v;
    }
    return out;
  }
  return null;
}

function coerceInt32Array(value: unknown): Int32Array | null {
  if (value instanceof Int32Array) return value;
  if (value instanceof Uint32Array) return new Int32Array(value);
  if (Array.isArray(value)) {
    const out = new Int32Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (typeof v !== 'number' || !Number.isInteger(v)) return null;
      out[i] = v | 0;
    }
    return out;
  }
  return null;
}

function coerceStringArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v !== 'string') return null;
    return value as string[];
  }
  return null;
}

function skipped(rawKey: string, reason: string): AdaptedProperty {
  return { rawKey, emitted: false, reason };
}

/**
 * The set of list-op field names whose elements are tokens (TokenListOp).
 * Other element types (PathListOp for `references`, ReferenceListOp, etc.)
 * are not yet wired up — those are routed to `unsupported` until their
 * value encoders land.
 */
const TOKEN_LIST_OP_NAMES = new Set([
  'apiSchemas',
]);

/**
 * Dispatch a list-op key (`prepend apiSchemas`, `append xxx`, ...) to the
 * appropriate layer-builder method.
 *
 * The element type is inferred from the field name. We currently only emit
 * TokenListOp values (the only list-op shape our converters produce). Other
 * shapes (PathListOp / ReferenceListOp / etc.) fall into the unsupported
 * bucket so the packager can fall back to USDA cleanly.
 */
/**
 * Dispatch a relationship key (`material:binding`, `rel xxx`, ...) to the
 * layer-builder's `addRelationship`.
 *
 * The value can arrive in any of these shapes (depending on which converter
 * built the source UsdNode):
 *
 *   "/Root/Materials/Foo"        — bare path, no decorators
 *   "</Root/Materials/Foo>"       — USDA-style path literal with brackets
 *   ["/Root/A", "/Root/B"]        — multiple targets
 *
 * The adapter strips the optional `<...>` brackets and routes empty values
 * to the unsupported bucket (so the packager falls back rather than
 * emitting an unbound relationship).
 */
function applyRelationship(
  builder: UsdcLayerBuilder,
  prim: PrimHandle,
  name: string,
  value: unknown,
  rawKey: string
): AdaptedProperty {
  const targets = coerceTargetPaths(value);
  if (!targets || targets.length === 0) {
    return skipped(rawKey, `relationship "${name}": expected one or more target paths`);
  }
  for (const t of targets) {
    if (!t.startsWith('/')) {
      return skipped(rawKey, `relationship "${name}" target "${t}" is not absolute`);
    }
  }
  builder.addRelationship(prim, name, targets);
  return { rawKey, emitted: true };
}

function coerceTargetPaths(value: unknown): string[] | null {
  if (typeof value === 'string') {
    const stripped = stripPathLiteral(value);
    return stripped.length > 0 ? [stripped] : null;
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const v of value) {
      if (typeof v !== 'string') return null;
      const s = stripPathLiteral(v);
      if (s.length === 0) return null;
      out.push(s);
    }
    return out;
  }
  return null;
}

/** Strip optional `<...>` USDA brackets from a path literal. */
function stripPathLiteral(s: string): string {
  const t = s.trim();
  if (t.startsWith('<') && t.endsWith('>')) return t.slice(1, -1).trim();
  return t;
}

function applyListOp(
  builder: UsdcLayerBuilder,
  prim: PrimHandle,
  name: string,
  opcode: ListOpOpcode,
  value: unknown,
  rawKey: string
): AdaptedProperty {
  if (!TOKEN_LIST_OP_NAMES.has(name)) {
    return skipped(rawKey, `list-op for "${name}" is not yet a TokenListOp shape`);
  }
  const tokens = coerceStringArray(value);
  if (!tokens) {
    return skipped(rawKey, `${opcode} ${name}: expected an array of token strings`);
  }
  builder.addTokenListOpAttribute(prim, name, { [opcode]: tokens });
  return { rawKey, emitted: true };
}

/** Find the CrateDataType name corresponding to a numeric value, for error messages. */
function describeType(type: CrateDataType): string {
  for (const [name, v] of Object.entries(CrateDataType)) {
    if (v === type) return name;
  }
  return String(type);
}

/**
 * Convenience: build a USDC layer for the given root node in one call.
 *
 * Returns the encoded bytes plus the adaptation report. Callers can inspect
 * `report.skipped` to decide whether the resulting bytes are a faithful
 * representation of the source tree.
 */
export function encodeUsdNodeTreeToUsdc(root: UsdNode): {
  bytes: Uint8Array;
  report: AdaptationReport;
} {
  const builder = new UsdcLayerBuilder();
  const report = adaptUsdNodeTree(root, builder);
  return { bytes: builder.serialize(), report };
}
