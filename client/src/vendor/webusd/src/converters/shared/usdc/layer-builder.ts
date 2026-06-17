/** WebUsdFramework.Converters.Shared.Usdc.LayerBuilder — orchestrator that
 *  assembles a complete USDC layer file from incremental scene-description
 *  inputs.
 *
 * The builder owns the six interrelated tables (tokens, strings, fields,
 * field-sets, paths, specs) and the pending external array payloads. It
 * exposes a small, intent-shaped API:
 *
 *   const b = new UsdcLayerBuilder();
 *   const root = b.declarePrim('/Root', 'Xform');
 *   b.addFloatAttribute(root, 'inputs:roughness', 0.6);
 *   b.addFloatArrayAttribute(root, 'points', [0, 0, 0, 1, 0, 0, ...]);
 *   const bytes = b.serialize();
 *
 * `serialize()` writes:
 *   1. The 88-byte bootstrap (placeholder TOC offset, patched at the end).
 *   2. Each section in dependency order — TOKENS, STRINGS, FIELDS, FIELDSETS,
 *      PATHS, SPECS — plus any external array payloads. Offsets for array
 *      payloads are resolved here, so the FIELDS section's ValueReps can
 *      reference real file positions.
 *   3. The TOC (uint64 sectionCount + N × {char[16], int64, int64}).
 *   4. Patches the bootstrap's tocOffset to point at step 3.
 *
 * NOTE: This is an integration-stage milestone. The byte-for-byte
 * equivalence with `usdcat`-produced fixtures is gated behind issue #122's
 * pipeline flag (default `usda`); the builder produces structurally-correct
 * USDC that round-trips through our own decoder.
 */

import {
  USDC_BOOTSTRAP_SIZE,
  USDC_DEFAULT_VERSION,
  type UsdcSection,
  writeBootstrap,
  writeTOC,
  tocByteLength,
} from '../usdc-writer';
import { TokenTable } from './tokens-section';
import { StringTable } from './strings-section';
import { type UsdcField, encodeFieldsSection } from './fields-section';
import { FieldSetTable } from './fieldsets-section';
import {
  type PathNode,
  encodePathsSection,
} from './paths-section';
import { type UsdcSpec, encodeSpecsSection } from './specs-section';
import {
  type EncodedArrayValue,
  encodeFloatArray,
  encodeVec3fArray,
  encodeVec3fScalar,
  encodeInt32Array,
  encodeTokenArray,
  arrayValueRep,
} from './array-values';
import {
  encodePathListOp,
  encodeTokenListOp,
  type TokenListOpInput,
} from './listop-values';
import {
  CrateDataType,
  SdfSpecType,
  SdfSpecifier,
  SdfVariability,
  inlineFloat,
  inlineInt,
  inlineToken,
  inlineSpecifier,
  inlineVariability,
} from './value-rep';

/** Opaque handle returned by `declarePrim`; pass back to `add*Attribute`. */
export interface PrimHandle {
  /** Index in the layer's path table (PATHS section row). */
  pathIndex: number;
  /** The path node entry — owned by the builder, do not mutate. */
  node: PathNode;
}

interface PendingField {
  /** TokenIndex of the field name. */
  tokenIndex: number;
  /** Either an inlined ValueRep already, or a reference to a pending array. */
  rep:
  | { kind: 'inline'; value: bigint }
  | { kind: 'array'; arrayId: number };
}

interface PendingArray {
  encoded: EncodedArrayValue;
  /** Resolved at serialize time. */
  fileOffset?: bigint;
}

interface SpecBuilder {
  pathIndex: number;
  specType: SdfSpecType;
  fields: PendingField[];
}

/**
 * Pending relationship — full resolution happens at `serialize()` time
 * because target paths often reference prims that haven't been declared
 * yet when `addRelationship` is called.
 */
interface PendingRelationship {
  /** Index into `specBuilders` of this relationship's spec. */
  specBuilderIndex: number;
  /** Stringly-typed target paths to resolve at serialize time. */
  targetPaths: string[];
}

export class UsdcLayerBuilder {
  private readonly tokens = new TokenTable();
  private readonly strings = new StringTable();
  private readonly fieldSets = new FieldSetTable();
  /** All pending array payloads, in declaration order. */
  private readonly pendingArrays: PendingArray[] = [];
  /** Built-up prim/attribute spec list. Pseudo-root is index 0. */
  private readonly specBuilders: SpecBuilder[] = [];
  /** Relationships awaiting target-path resolution at serialize time. */
  private readonly pendingRelationships: PendingRelationship[] = [];
  /** Maps a USD path string ("/Root/Materials/Foo") to its PathIndex. */
  private readonly pathStringToIndex = new Map<string, number>();
  /** PATHS root, with children attached as prims/attributes are declared. */
  private readonly pseudoRoot: PathNode;

  /** Cached token indices for builtin field names. */
  private readonly tok_specifier: number;
  private readonly tok_typeName: number;
  private readonly tok_targetPaths: number;
  private readonly tok_variability: number;

  constructor() {
    // Pre-intern the builtin field tokens so they get small indices and are
    // available to every prim spec without re-checking.
    this.tok_specifier = this.tokens.intern('specifier');
    this.tok_typeName = this.tokens.intern('typeName');
    this.tok_targetPaths = this.tokens.intern('targetPaths');
    this.tok_variability = this.tokens.intern('variability');

    // Pseudo-root (path "/", spec type 7, no parent).
    this.pseudoRoot = {
      pathIndex: 0,
      elementTokenIndex: 0, // root has no element name
      isProperty: false,
      children: [],
    };
    this.specBuilders.push({
      pathIndex: 0,
      specType: SdfSpecType.PseudoRoot,
      fields: [],
    });
    this.pathStringToIndex.set('/', 0);
  }

  /**
   * Declare a prim at `path` (e.g., `/Root` or `/Root/Geom`). The first
   * component must match an already-declared parent, except for the root
   * which is anchored under the pseudo-root.
   *
   * @returns A handle the caller threads back to `add*Attribute`.
   */
  declarePrim(path: string, typeName: string): PrimHandle {
    if (!path.startsWith('/')) {
      throw new RangeError(`declarePrim: path "${path}" must start with /`);
    }
    const components = path.slice(1).split('/').filter((c) => c.length > 0);
    if (components.length === 0) {
      throw new RangeError('declarePrim: cannot declare the pseudo-root');
    }

    // Walk down from the pseudo-root, attaching children as needed.
    let parent: PathNode = this.pseudoRoot;
    let parentSpec = this.specBuilders[0];
    for (let i = 0; i < components.length - 1; i++) {
      const name = components[i];
      const tokenIdx = this.tokens.intern(name);
      const existing = parent.children.find(
        (c) => c.elementTokenIndex === tokenIdx && !c.isProperty
      );
      if (!existing) {
        throw new RangeError(
          `declarePrim: parent path /${components.slice(0, i + 1).join('/')} has not been declared`
        );
      }
      parent = existing;
      parentSpec = this.specBuilders[existing.pathIndex];
    }

    const leafName = components[components.length - 1];
    const elementTokenIndex = this.tokens.intern(leafName);
    const typeNameTokenIndex = this.tokens.intern(typeName);

    const newPathIndex = this.specBuilders.length;
    const node: PathNode = {
      pathIndex: newPathIndex,
      elementTokenIndex,
      isProperty: false,
      children: [],
    };
    parent.children.push(node);
    this.pathStringToIndex.set(path, newPathIndex);
    void parentSpec; // The builder doesn't need to update parent's fields here.

    const fields: PendingField[] = [
      {
        tokenIndex: this.tok_specifier,
        rep: { kind: 'inline', value: inlineSpecifier(SdfSpecifier.Def) },
      },
      {
        tokenIndex: this.tok_typeName,
        rep: { kind: 'inline', value: inlineToken(typeNameTokenIndex) },
      },
    ];
    this.specBuilders.push({
      pathIndex: newPathIndex,
      specType: SdfSpecType.Prim,
      fields,
    });

    return { pathIndex: newPathIndex, node };
  }

  /** Add an inlined float scalar attribute. */
  addFloatAttribute(prim: PrimHandle, name: string, value: number): void {
    const tokenIdx = this.tokens.intern(name);
    this.specBuilders[prim.pathIndex].fields.push({
      tokenIndex: tokenIdx,
      rep: { kind: 'inline', value: inlineFloat(value) },
    });
  }

  /** Add an inlined int32 scalar attribute. */
  addIntAttribute(prim: PrimHandle, name: string, value: number): void {
    const tokenIdx = this.tokens.intern(name);
    this.specBuilders[prim.pathIndex].fields.push({
      tokenIndex: tokenIdx,
      rep: { kind: 'inline', value: inlineInt(value) },
    });
  }

  /** Add an inlined token attribute. The token is interned in the TOKENS table. */
  addTokenAttribute(prim: PrimHandle, name: string, tokenValue: string): void {
    const fieldTok = this.tokens.intern(name);
    const valueTok = this.tokens.intern(tokenValue);
    this.specBuilders[prim.pathIndex].fields.push({
      tokenIndex: fieldTok,
      rep: { kind: 'inline', value: inlineToken(valueTok) },
    });
  }

  /**
   * Add a Float[] attribute. The bytes go into the external value pool and a
   * non-inlined ValueRep is appended to the prim's spec.
   */
  addFloatArrayAttribute(prim: PrimHandle, name: string, values: Float32Array | ReadonlyArray<number>): void {
    const enc = encodeFloatArray(values);
    const arrayId = this.pendingArrays.length;
    this.pendingArrays.push({ encoded: enc });
    const fieldTok = this.tokens.intern(name);
    this.specBuilders[prim.pathIndex].fields.push({
      tokenIndex: fieldTok,
      rep: { kind: 'array', arrayId },
    });
  }

  /** Add a Vec3f[] attribute (point3f[], color3f[], normal3f[], float3[]). */
  addVec3fArrayAttribute(
    prim: PrimHandle,
    name: string,
    flat: Float32Array | ReadonlyArray<number>
  ): void {
    const enc = encodeVec3fArray(flat);
    const arrayId = this.pendingArrays.length;
    this.pendingArrays.push({ encoded: enc });
    const fieldTok = this.tokens.intern(name);
    this.specBuilders[prim.pathIndex].fields.push({
      tokenIndex: fieldTok,
      rep: { kind: 'array', arrayId },
    });
  }

  /**
   * Add a Vec3f scalar attribute (color3f, normal3f, point3f single value).
   * Stored externally — Vec3f doesn't fit in a 48-bit inlined ValueRep.
   */
  addVec3fAttribute(
    prim: PrimHandle,
    name: string,
    x: number,
    y: number,
    z: number
  ): void {
    const enc = encodeVec3fScalar(x, y, z);
    const arrayId = this.pendingArrays.length;
    this.pendingArrays.push({ encoded: enc });
    const fieldTok = this.tokens.intern(name);
    this.specBuilders[prim.pathIndex].fields.push({
      tokenIndex: fieldTok,
      rep: { kind: 'array', arrayId },
    });
  }

  /** Add an Int[] attribute (faceVertexIndices, faceVertexCounts). */
  addIntArrayAttribute(
    prim: PrimHandle,
    name: string,
    values: Int32Array | ReadonlyArray<number>
  ): void {
    const enc = encodeInt32Array(values);
    const arrayId = this.pendingArrays.length;
    this.pendingArrays.push({ encoded: enc });
    const fieldTok = this.tokens.intern(name);
    this.specBuilders[prim.pathIndex].fields.push({
      tokenIndex: fieldTok,
      rep: { kind: 'array', arrayId },
    });
  }

  /** Add a Token[] attribute (xformOpOrder, apiSchemas). */
  addTokenArrayAttribute(prim: PrimHandle, name: string, tokenValues: ReadonlyArray<string>): void {
    const indices = tokenValues.map((t) => this.tokens.intern(t));
    const enc = encodeTokenArray(indices);
    const arrayId = this.pendingArrays.length;
    this.pendingArrays.push({ encoded: enc });
    const fieldTok = this.tokens.intern(name);
    this.specBuilders[prim.pathIndex].fields.push({
      tokenIndex: fieldTok,
      rep: { kind: 'array', arrayId },
    });
  }

  /**
   * Add a TokenListOp metadata attribute. The most common shape is a
   * single `prepended` list (e.g. `prepend apiSchemas = ["MaterialBindingAPI"]`).
   * Pass token *strings*; the builder interns them.
   *
   * The `name` must include the opcode prefix the adapter expects to round-
   * trip back through the property parser (e.g. `apiSchemas` — *not*
   * `prepend apiSchemas`); the opcode is captured in which sub-list the
   * caller fills.
   */
  addTokenListOpAttribute(
    prim: PrimHandle,
    name: string,
    op: {
      isExplicit?: boolean;
      explicit?: ReadonlyArray<string>;
      added?: ReadonlyArray<string>;
      deleted?: ReadonlyArray<string>;
      ordered?: ReadonlyArray<string>;
      prepended?: ReadonlyArray<string>;
      appended?: ReadonlyArray<string>;
    }
  ): void {
    const internAll = (xs: ReadonlyArray<string> | undefined) =>
      xs ? xs.map((t) => this.tokens.intern(t)) : undefined;
    const input: TokenListOpInput = {
      ...(op.isExplicit !== undefined ? { isExplicit: op.isExplicit } : {}),
      ...(op.explicit ? { explicit: internAll(op.explicit)! } : {}),
      ...(op.added ? { added: internAll(op.added)! } : {}),
      ...(op.deleted ? { deleted: internAll(op.deleted)! } : {}),
      ...(op.ordered ? { ordered: internAll(op.ordered)! } : {}),
      ...(op.prepended ? { prepended: internAll(op.prepended)! } : {}),
      ...(op.appended ? { appended: internAll(op.appended)! } : {}),
    };
    const enc = encodeTokenListOp(input);
    const arrayId = this.pendingArrays.length;
    this.pendingArrays.push({ encoded: enc });
    const fieldTok = this.tokens.intern(name);
    this.specBuilders[prim.pathIndex].fields.push({
      tokenIndex: fieldTok,
      rep: { kind: 'array', arrayId },
    });
  }

  /**
   * Declare a relationship attached to `prim` whose targets are USD prim
   * paths. Examples:
   *
   *   b.addRelationship(meshPrim, 'material:binding', ['/Root/Materials/Foo'])
   *   b.addRelationship(prim, 'rel:proxyPrim', ['/Root/Proxy'])
   *
   * The relationship gets its own path entry under the prim (a property-
   * typed child whose element name is `name`) and its own SPECS row with
   * `SdfSpecType.Relationship`.
   *
   * Target paths are not resolved against the path table until
   * `serialize()` runs — they may legally refer to prims declared later
   * in the build sequence.
   */
  addRelationship(
    prim: PrimHandle,
    name: string,
    targetPaths: ReadonlyArray<string>
  ): void {
    if (targetPaths.length === 0) {
      throw new RangeError('addRelationship: targetPaths is empty');
    }
    const elementToken = this.tokens.intern(name);
    const newPathIndex = this.specBuilders.length;
    const node: PathNode = {
      pathIndex: newPathIndex,
      elementTokenIndex: elementToken,
      isProperty: true,
      children: [],
    };
    prim.node.children.push(node);

    this.specBuilders.push({
      pathIndex: newPathIndex,
      specType: SdfSpecType.Relationship,
      // The targetPaths field is filled in at serialize time once every
      // referenced prim has had a chance to be declared. variability is
      // uniform per the USD spec for relationships.
      fields: [
        {
          tokenIndex: this.tok_variability,
          rep: { kind: 'inline', value: inlineVariability(SdfVariability.Uniform) },
        },
      ],
    });

    this.pendingRelationships.push({
      specBuilderIndex: newPathIndex,
      targetPaths: [...targetPaths],
    });
  }

  /**
   * Produce the complete USDC layer bytes. After this call, the builder's
   * internal state should be considered consumed; calling it twice will
   * produce identical output but is wasteful.
   */
  serialize(): Uint8Array {
    // Step 1 — compute layout up to (but not including) the FIELDS section,
    // because FIELDS' ValueReps need to know where each external array payload
    // landed in the file. So we build everything except FIELDS first, then
    // place arrays at known offsets, then encode FIELDS, then the rest.
    //
    // Strategy: lay sections out in the order the file will contain them and
    // resolve offsets as we go.

    // Resolve every pending relationship's target paths to PathIndex values
    // and emit the corresponding `targetPaths` field. This must happen
    // BEFORE TOKENS is closed (resolution doesn't intern any tokens, but
    // the encoded PathListOp does sit in pendingArrays which is consumed
    // below).
    for (const rel of this.pendingRelationships) {
      const indices: number[] = new Array(rel.targetPaths.length);
      for (let i = 0; i < rel.targetPaths.length; i++) {
        const tp = rel.targetPaths[i];
        const idx = this.pathStringToIndex.get(tp);
        if (idx === undefined) {
          throw new RangeError(
            `serialize: relationship target path "${tp}" was never declared`
          );
        }
        indices[i] = idx;
      }
      const enc = encodePathListOp({ explicit: indices });
      const arrayId = this.pendingArrays.length;
      this.pendingArrays.push({ encoded: enc });
      this.specBuilders[rel.specBuilderIndex].fields.push({
        tokenIndex: this.tok_targetPaths,
        rep: { kind: 'array', arrayId },
      });
    }

    // Encode TOKENS first so the byte size is known. (TokenTable closed.)
    const tokensBytes = this.tokens.encode();
    const stringsBytes = this.strings.encode();

    // We can't encode FIELDS yet — we need pendingArray offsets. Compute
    // the layout up to where arrays start.

    // The plan:
    //   bootstrap (88 bytes)
    //   tokens
    //   strings
    //   external array payloads (placed back-to-back, offsets recorded)
    //   FIELDS (now able to reference array offsets)
    //   FIELDSETS
    //   PATHS
    //   SPECS
    //   TOC

    let cursor = USDC_BOOTSTRAP_SIZE;

    const tokensSection = { name: 'TOKENS', start: cursor, size: tokensBytes.length };
    cursor += tokensBytes.length;

    const stringsSection = { name: 'STRINGS', start: cursor, size: stringsBytes.length };
    cursor += stringsBytes.length;

    // Place external array payloads.
    for (const a of this.pendingArrays) {
      a.fileOffset = BigInt(cursor);
      cursor += a.encoded.bytes.length;
    }
    const arrayPayloadEnd = cursor;

    // Now we can resolve every PendingField → final ValueRep and build the
    // FIELDS table.
    const fieldRows: UsdcField[] = [];
    /** Maps `${pathIndex}:${tokenIndex}` → fieldIndex in fieldRows. */
    const fieldIndexCache = new Map<string, number>();
    function internField(token: number, rep: bigint): number {
      const key = `${token}:${rep.toString(16)}`;
      const cached = fieldIndexCache.get(key);
      if (cached !== undefined) return cached;
      const idx = fieldRows.length;
      fieldRows.push({ tokenIndex: token, valueRep: rep });
      fieldIndexCache.set(key, idx);
      return idx;
    }

    // Record each spec's fieldSet — list of FieldIndex into fieldRows.
    const specs: UsdcSpec[] = new Array(this.specBuilders.length);
    for (let i = 0; i < this.specBuilders.length; i++) {
      const sb = this.specBuilders[i];
      const fieldIndexes: number[] = [];
      for (const f of sb.fields) {
        let valueRep: bigint;
        if (f.rep.kind === 'inline') {
          valueRep = f.rep.value;
        } else {
          const a = this.pendingArrays[f.rep.arrayId];
          valueRep = arrayValueRep(a.encoded, a.fileOffset!);
        }
        fieldIndexes.push(internField(f.tokenIndex, valueRep));
      }
      const fieldSetIndex = this.fieldSets.add(fieldIndexes);
      specs[i] = {
        pathIndex: sb.pathIndex,
        fieldSetIndex,
        specType: sb.specType,
      };
    }

    const fieldsBytes = encodeFieldsSection(fieldRows);
    const fieldsSection = { name: 'FIELDS', start: cursor, size: fieldsBytes.length };
    cursor += fieldsBytes.length;

    const fieldSetsBytes = this.fieldSets.encode();
    const fieldSetsSection = { name: 'FIELDSETS', start: cursor, size: fieldSetsBytes.length };
    cursor += fieldSetsBytes.length;

    const pathsBytes = encodePathsSection(this.pseudoRoot).bytes;
    const pathsSection = { name: 'PATHS', start: cursor, size: pathsBytes.length };
    cursor += pathsBytes.length;

    const specsBytes = encodeSpecsSection(specs);
    const specsSection = { name: 'SPECS', start: cursor, size: specsBytes.length };
    cursor += specsBytes.length;

    // TOC.
    const tocOffset = cursor;
    const sections: UsdcSection[] = [
      tokensSection,
      stringsSection,
      fieldsSection,
      fieldSetsSection,
      pathsSection,
      specsSection,
    ];
    const tocBytes = tocByteLength(sections.length);
    cursor += tocBytes;

    // Assemble the final buffer.
    const out = new Uint8Array(cursor);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

    writeBootstrap(view, 0, tocOffset, USDC_DEFAULT_VERSION);
    out.set(tokensBytes, tokensSection.start);
    out.set(stringsBytes, stringsSection.start);
    let arrCursor = stringsSection.start + stringsSection.size;
    for (const a of this.pendingArrays) {
      out.set(a.encoded.bytes, arrCursor);
      arrCursor += a.encoded.bytes.length;
    }
    if (arrCursor !== arrayPayloadEnd) {
      throw new Error(
        `serialize: array layout mismatch (${arrCursor} vs ${arrayPayloadEnd})`
      );
    }
    out.set(fieldsBytes, fieldsSection.start);
    out.set(fieldSetsBytes, fieldSetsSection.start);
    out.set(pathsBytes, pathsSection.start);
    out.set(specsBytes, specsSection.start);
    writeTOC(view, tocOffset, sections);

    return out;
  }
}

/**
 * Convenience wrapper: build a USDC layer with a single `Xform "Root"` and
 * an arbitrary list of attribute closures. Useful for unit tests.
 */
export function buildSimpleUsdcLayer(
  apply: (b: UsdcLayerBuilder, root: PrimHandle) => void
): Uint8Array {
  const b = new UsdcLayerBuilder();
  const root = b.declarePrim('/Root', 'Xform');
  apply(b, root);
  return b.serialize();
}

// Mark CrateDataType as used so the import is not dropped — the builder
// references it transitively through helpers, but TypeScript's import-elision
// can be aggressive with const-value re-exports.
void CrateDataType;
