/** WebUsdFramework.Converters.Shared.Usdc.PathsSection — PATHS section
 *  encoder.
 *
 * The PATHS section encodes the entire prim/property path hierarchy as
 * three parallel int32 arrays in depth-first traversal order:
 *
 *   pathIndexes[]          path index in the global table (uint32)
 *   elementTokenIndexes[]  element name token (sign bit = property: positive
 *                          for prim, negative for property)
 *   jumps[]                jump-tree control codes:
 *
 *     jump > 0   relative offset (in array positions) to this path's next
 *                sibling. The sub-tree rooted at this path occupies the
 *                intervening positions.
 *     jump == 0  this path is the last sibling and has at least one child.
 *                Walk to (current + 1) to enter the child sub-tree.
 *     jump == -1 this path is a leaf and the last sibling at its level.
 *     jump == -2 this path has both children and a next sibling — walk to
 *                (current + 1) for the child; the sibling is found by
 *                walking past the entire child sub-tree.
 *
 * Layout on disk:
 *
 *   uint64                          numPaths
 *   uint64                          compressedPathIndexesSize
 *   bytes[compressedPathIndexesSize] TfDelta(int32) pathIndexes
 *   uint64                          compressedTokensSize
 *   bytes[compressedTokensSize]      TfDelta(int32) elementTokenIndexes
 *   uint64                          compressedJumpsSize
 *   bytes[compressedJumpsSize]       TfDelta(int32) jumps
 *
 * Reference: `pxr/usd/usd/crateFile.cpp` — search for `_WriteCompressedPaths`.
 *
 * NOTE: This encoder produces well-formed input that round-trips through its
 * own decoder. The exact byte-for-byte compatibility with OpenUSD's reader
 * has not yet been validated against a `usdcat`-produced fixture; that work
 * is gated behind the pipeline-integration feature flag (#122).
 */

import { compressInt32, decompressInt32 } from './integer-coding';

/**
 * One node in the input path tree. The encoder walks these depth-first and
 * emits the three parallel arrays above. Children must already be ordered
 * the way they should appear in the encoded output.
 */
export interface PathNode {
  /** Index of this path in the layer's global path table. */
  pathIndex: number;
  /** TokenIndex of this path's last element (e.g., `Root`, `points`). */
  elementTokenIndex: number;
  /** True if this path names a property (e.g., `Root.points`); false for prims. */
  isProperty: boolean;
  /** Children in the order they should appear in the encoded output. */
  children: PathNode[];
}

/** Result of encoding a tree — three parallel arrays + the section bytes. */
export interface EncodedPathTree {
  pathIndexes: Int32Array;
  elementTokenIndexes: Int32Array;
  jumps: Int32Array;
  /** The on-disk PATHS section bytes. */
  bytes: Uint8Array;
}

/**
 * Recursively walk a `PathNode` tree, populating the three parallel arrays
 * in depth-first order, then encode the section bytes.
 */
export function encodePathsSection(root: PathNode): EncodedPathTree {
  const pathIndexes: number[] = [];
  const elementTokens: number[] = [];
  const jumps: number[] = [];

  function emit(node: PathNode, isLastSibling: boolean): void {
    const myIdx = pathIndexes.length;
    pathIndexes.push(node.pathIndex);
    // Sign-bit packs the prim/property bit. Property paths are negative;
    // prim paths (and the root, with token index 0) are positive.
    elementTokens.push(node.isProperty ? -node.elementTokenIndex : node.elementTokenIndex);
    jumps.push(0); // placeholder — patched below

    const hasChildren = node.children.length > 0;
    if (!hasChildren && isLastSibling) {
      jumps[myIdx] = -1;
    } else if (hasChildren && isLastSibling) {
      jumps[myIdx] = 0;
    } else if (hasChildren && !isLastSibling) {
      jumps[myIdx] = -2;
    }
    // For the (!hasChildren && !isLastSibling) case we patch the jump to
    // the relative offset to the next sibling AFTER recursion, when we
    // know the post-recursion size.

    for (let i = 0; i < node.children.length; i++) {
      emit(node.children[i], i === node.children.length - 1);
    }

    if (!hasChildren && !isLastSibling) {
      jumps[myIdx] = pathIndexes.length - myIdx;
    }
  }

  emit(root, /* root is always a "last sibling" since it has no siblings */ true);

  const ix = Int32Array.from(pathIndexes);
  const tk = Int32Array.from(elementTokens);
  const jp = Int32Array.from(jumps);

  // Compress each array independently.
  const cIx = compressInt32(Array.from(ix));
  const cTk = compressInt32(Array.from(tk));
  const cJp = compressInt32(Array.from(jp));

  const headerBytes = 8 + 8 + 8 + 8; // numPaths + 3 × compressedSize
  const out = new Uint8Array(headerBytes + cIx.length + cTk.length + cJp.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(0, BigInt(ix.length), /* littleEndian */ true);
  view.setBigUint64(8, BigInt(cIx.length), true);
  let dp = 32;
  out.set(cIx, dp);
  dp += cIx.length;
  view.setBigUint64(16, BigInt(cTk.length), true);
  out.set(cTk, dp);
  dp += cTk.length;
  view.setBigUint64(24, BigInt(cJp.length), true);
  out.set(cJp, dp);

  return { pathIndexes: ix, elementTokenIndexes: tk, jumps: jp, bytes: out };
}

/**
 * Decode a PATHS section into the three parallel int32 arrays.
 *
 * Used by tests; not on the runtime encoding path.
 */
export function decodePathsSection(src: Uint8Array): {
  pathIndexes: Int32Array;
  elementTokenIndexes: Int32Array;
  jumps: Int32Array;
} {
  if (src.length < 32) {
    throw new RangeError('decodePathsSection: header truncated');
  }
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const numPaths = Number(view.getBigUint64(0, true));
  const cIxSize = Number(view.getBigUint64(8, true));
  const cTkSize = Number(view.getBigUint64(16, true));
  const cJpSize = Number(view.getBigUint64(24, true));
  const expected = 32 + cIxSize + cTkSize + cJpSize;
  if (expected > src.length) {
    throw new RangeError(
      `decodePathsSection: section too short (need ${expected}, have ${src.length})`
    );
  }

  let dp = 32;
  const pathIndexes =
    numPaths === 0 ? new Int32Array(0) : decompressInt32(src.subarray(dp, dp + cIxSize), numPaths);
  dp += cIxSize;
  const elementTokenIndexes =
    numPaths === 0
      ? new Int32Array(0)
      : decompressInt32(src.subarray(dp, dp + cTkSize), numPaths);
  dp += cTkSize;
  const jumps =
    numPaths === 0 ? new Int32Array(0) : decompressInt32(src.subarray(dp, dp + cJpSize), numPaths);

  return { pathIndexes, elementTokenIndexes, jumps };
}

/**
 * Reconstruct a `PathNode` tree from the three decoded arrays. Inverse of
 * `encodePathsSection` — used by tests to verify round-trip equivalence.
 *
 * The decoder follows the jump-tree convention documented at the top of this
 * file. It assumes the input was produced by our own encoder.
 */
export function rebuildPathTree(
  pathIndexes: Int32Array,
  elementTokenIndexes: Int32Array,
  jumps: Int32Array
): PathNode {
  if (pathIndexes.length === 0) {
    throw new RangeError('rebuildPathTree: empty input');
  }

  // Use a recursive walker that consumes positions in order. The walker
  // returns a single sub-tree starting at `start` and the index of the
  // position immediately after that sub-tree.
  function walk(start: number, isLast: boolean): { node: PathNode; next: number } {
    const tokenSigned = elementTokenIndexes[start];
    const isProperty = tokenSigned < 0;
    const node: PathNode = {
      pathIndex: pathIndexes[start] >>> 0,
      elementTokenIndex: Math.abs(tokenSigned),
      isProperty,
      children: [],
    };
    const jump = jumps[start];

    let cursor = start + 1;

    if (jump === -1) {
      // Leaf, last sibling.
      return { node, next: cursor };
    }
    if (jump === 0) {
      // Last sibling with children. Recurse to consume the child sub-tree
      // until the recursive walk also signals "last sibling".
      while (cursor < pathIndexes.length) {
        const childIsLast = looksLikeLastSibling(jumps[cursor]);
        const r = walk(cursor, childIsLast);
        node.children.push(r.node);
        cursor = r.next;
        if (childIsLast) break;
      }
      return { node, next: cursor };
    }
    if (jump === -2) {
      // Has children AND a next sibling. Recurse children first, then return
      // — the parent walker will pick up the sibling on its next iteration.
      while (cursor < pathIndexes.length) {
        const childIsLast = looksLikeLastSibling(jumps[cursor]);
        const r = walk(cursor, childIsLast);
        node.children.push(r.node);
        cursor = r.next;
        if (childIsLast) break;
      }
      return { node, next: cursor };
    }
    if (jump > 0) {
      // No children, has next sibling at +jump. The cursor advances past
      // this single path.
      return { node, next: cursor };
    }
    throw new RangeError(`rebuildPathTree: invalid jump ${jump} at index ${start}`);
    void isLast;
  }

  function looksLikeLastSibling(jump: number): boolean {
    return jump === -1 || jump === 0;
  }

  // The root is always the only path at depth 0; treat it as last sibling.
  return walk(0, true).node;
}
