/** WebUsdFramework.Converters.Shared.Usdc.PropertyParser — parses the
 *  type-prefixed property keys that `UsdNode.setProperty` accepts (e.g.
 *  `"point3f[] points"`, `"uniform token info:id"`) into a structured
 *  descriptor the USDC encoder can switch on.
 *
 * UsdNode property keys are a USDA-style line head: zero or more space-
 * separated *qualifiers* (`uniform`, `prepend`, `varying`, …) followed by
 * exactly one *type* token (`float`, `point3f[]`, `token[]`, …) followed by
 * the property name (which may contain `:` and `.` characters).
 *
 * Examples:
 *
 *   "point3f[] points"                              → type=Vec3f[], name=points
 *   "color3f[] primvars:displayColor"               → type=Vec3f[], name=primvars:displayColor
 *   "uniform token primvars:displayColor:interpolation" → uniform Token, name=primvars:displayColor:interpolation
 *   "float inputs:roughness"                        → type=Float, name=inputs:roughness
 *   "prepend apiSchemas"                            → metadata, name=apiSchemas
 *
 * Some keys aren't typed attributes — `prepend references`,
 * `material:binding`, `token outputs:surface.connect` describe relationships,
 * connections, or list-ops. Those are returned with `kind: 'unsupported'`
 * so the caller can fall back to the USDA path until the encoder learns the
 * extra cases.
 */

import { CrateDataType } from './value-rep';

/** Sub-list opcode parsed from a USDA `prepend|append|add|delete|reorder` key. */
export type ListOpOpcode = 'prepended' | 'appended' | 'added' | 'deleted' | 'ordered';

/** Type-tagged result — what the encoder needs to do with this property. */
export type ParsedProperty =
  | {
    kind: 'attribute';
    name: string;
    type: CrateDataType;
    isArray: boolean;
    isUniform: boolean;
  }
  | {
    /** A `prepend|append|...` list-op metadata key. The element type is
     * implied by `name` — the adapter dispatches per-name (e.g. `apiSchemas`
     * is a TokenListOp). */
    kind: 'list-op';
    name: string;
    opcode: ListOpOpcode;
  }
  | {
    /** A relationship spec: either a built-in name like `material:binding`
     * or an explicit `rel xxx` declaration. The value is the target path
     * (or array of target paths). */
    kind: 'relationship';
    name: string;
  }
  | {
    kind: 'unsupported';
    /** The original key, kept verbatim so the caller can log / route it. */
    raw: string;
    reason: string;
  };

const LIST_OP_PREFIXES: Record<string, ListOpOpcode> = {
  prepend: 'prepended',
  append: 'appended',
  add: 'added',
  delete: 'deleted',
  reorder: 'ordered',
};

/** Map from a single USD type token to the corresponding CrateDataType. */
const TYPE_MAP: Record<string, { type: CrateDataType; isArray: boolean }> = {
  // Scalars
  bool: { type: CrateDataType.Bool, isArray: false },
  uchar: { type: CrateDataType.UChar, isArray: false },
  int: { type: CrateDataType.Int, isArray: false },
  uint: { type: CrateDataType.UInt, isArray: false },
  int64: { type: CrateDataType.Int64, isArray: false },
  uint64: { type: CrateDataType.UInt64, isArray: false },
  half: { type: CrateDataType.Half, isArray: false },
  float: { type: CrateDataType.Float, isArray: false },
  double: { type: CrateDataType.Double, isArray: false },
  string: { type: CrateDataType.String, isArray: false },
  token: { type: CrateDataType.Token, isArray: false },
  asset: { type: CrateDataType.AssetPath, isArray: false },

  // Vec3f-family — color3f and normal3f and point3f all serialize as Vec3f.
  vector3f: { type: CrateDataType.Vec3f, isArray: false },
  point3f: { type: CrateDataType.Vec3f, isArray: false },
  normal3f: { type: CrateDataType.Vec3f, isArray: false },
  color3f: { type: CrateDataType.Vec3f, isArray: false },
  float3: { type: CrateDataType.Vec3f, isArray: false },

  // Vec2f
  texCoord2f: { type: CrateDataType.Vec2f, isArray: false },
  float2: { type: CrateDataType.Vec2f, isArray: false },

  // Vec4f
  color4f: { type: CrateDataType.Vec4f, isArray: false },
  float4: { type: CrateDataType.Vec4f, isArray: false },

  // Quatf
  quatf: { type: CrateDataType.Quatf, isArray: false },
};

/** Tokens that are qualifiers, not type names. Order in the key doesn't matter. */
const QUALIFIER_TOKENS = new Set(['uniform', 'varying', 'custom']);

/**
 * Parse a single UsdNode property key into a structured descriptor.
 *
 * The grammar is roughly: `(qualifier ' ')* type ' ' name`. Anything that
 * doesn't parse is returned as `unsupported` so the caller can route it
 * elsewhere.
 */
export function parsePropertyKey(rawKey: string): ParsedProperty {
  const key = rawKey.trim();
  if (key.length === 0) {
    return { kind: 'unsupported', raw: rawKey, reason: 'empty key' };
  }

  // List-op metadata keys (`prepend xxx`, `append xxx`, ...).
  for (const [prefix, opcode] of Object.entries(LIST_OP_PREFIXES)) {
    if (key.startsWith(prefix + ' ')) {
      const name = key.slice(prefix.length + 1).trim();
      if (name.length === 0) {
        return {
          kind: 'unsupported',
          raw: rawKey,
          reason: `list-op key \"${prefix}\" missing field name`,
        };
      }
      return { kind: 'list-op', name, opcode };
    }
  }
  if (key.endsWith('.connect')) {
    return { kind: 'unsupported', raw: rawKey, reason: 'attribute connection' };
  }
  // Built-in relationship name (USD's material-binding API).
  if (key === 'material:binding' || key.startsWith('material:binding:')) {
    return { kind: 'relationship', name: key };
  }
  // Explicit `rel <name>` form.
  if (key.startsWith('rel ')) {
    const name = key.slice(4).trim();
    if (name.length === 0) {
      return { kind: 'unsupported', raw: rawKey, reason: 'rel key missing name' };
    }
    return { kind: 'relationship', name };
  }

  // Tokenize on whitespace and pull qualifiers from the front.
  const tokens = key.split(/\s+/);
  let isUniform = false;
  let cursor = 0;
  while (cursor < tokens.length && QUALIFIER_TOKENS.has(tokens[cursor])) {
    if (tokens[cursor] === 'uniform') isUniform = true;
    cursor++;
  }

  if (cursor >= tokens.length - 0) {
    // No type/name tokens left.
    return { kind: 'unsupported', raw: rawKey, reason: 'missing type token' };
  }

  // Next token is the type (possibly with `[]` array suffix).
  const typeToken = tokens[cursor++];
  if (cursor >= tokens.length) {
    return { kind: 'unsupported', raw: rawKey, reason: 'missing name after type' };
  }
  const name = tokens.slice(cursor).join(' ');

  let typeStem = typeToken;
  let isArray = false;
  if (typeToken.endsWith('[]')) {
    typeStem = typeToken.slice(0, -2);
    isArray = true;
  }

  const mapped = TYPE_MAP[typeStem];
  if (!mapped) {
    return {
      kind: 'unsupported',
      raw: rawKey,
      reason: `unknown type token "${typeToken}"`,
    };
  }

  return {
    kind: 'attribute',
    name,
    type: mapped.type,
    isArray,
    isUniform,
  };
}
