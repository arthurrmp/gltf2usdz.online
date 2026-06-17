/** WebUsdFramework.Converters.Ply.MeshDecimator - O(n) vertex clustering decimation for large meshes */

/**
 * Decimated mesh result. All arrays are tightly sized.
 */
export interface DecimatedMesh {
  positions: Float32Array;
  indices: Int32Array;
  faceVertexCounts: Int32Array;
  vertexCount: number;
  faceCount: number;
  /** Per-vertex normals computed from face normals (area-weighted) */
  normals: Float32Array;
  /** Per-vertex colors (averaged from original vertices in same cell), or undefined */
  colors: Float32Array | undefined;
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

/**
 * Vertex clustering mesh decimation.
 *
 * Algorithm:
 * 1. Divide the bounding box into a uniform 3D grid
 * 2. Map each vertex to a grid cell
 * 3. Average all vertices within each cell → new vertex position
 * 4. Remap face indices to cell IDs
 * 5. Discard degenerate triangles (where 2+ vertices collapsed to the same cell)
 * 6. Compute per-vertex normals from surviving faces
 *
 * Time: O(V + F) — single pass over vertices, single pass over faces
 * Memory: O(G^3 + V) where G is grid resolution, typically G ~ 100-300
 *
 * @param positions  Flat Float32Array [x,y,z, ...]
 * @param indices    Flat Int32Array of face vertex indices (triangles only)
 * @param colors     Optional flat Float32Array [r,g,b, ...] per vertex (0-1)
 * @param targetFaces Target number of output faces. Grid resolution is derived from this.
 * @param bounds     Bounding box of the mesh
 */
export function decimateMesh(
  positions: Float32Array,
  indices: Int32Array,
  colors: Float32Array | undefined,
  targetFaces: number,
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
): DecimatedMesh {
  const vertexCount = positions.length / 3;
  const inputFaceCount = indices.length / 3;

  // Nothing to decimate
  if (inputFaceCount <= targetFaces) {
    // Still compute normals for completeness
    const normals = computeFaceNormals(positions, indices, vertexCount);
    return {
      positions, indices,
      faceVertexCounts: createFillArray(inputFaceCount, 3),
      vertexCount, faceCount: inputFaceCount,
      normals, colors, bounds,
    };
  }

  // Estimate grid resolution from target face count.
  // Empirically, output faces scale as k * gridRes^2 where k depends on mesh
  // surface density relative to the grid. Calibration on dense meshes shows
  // k ≈ 6 is a reasonable middle-ground. We solve: gridRes = sqrt(targetFaces / k).
  // Clamped to [10, 1000] to avoid degenerate grids.
  const k = 6;
  let gridRes = Math.round(Math.sqrt(targetFaces / k));
  gridRes = Math.max(10, Math.min(1000, gridRes));

  const { min, max } = bounds;
  const sizeX = max.x - min.x || 1e-6;
  const sizeY = max.y - min.y || 1e-6;
  const sizeZ = max.z - min.z || 1e-6;
  const maxSize = Math.max(sizeX, sizeY, sizeZ);

  // Per-axis resolution proportional to extent
  const resX = Math.max(1, Math.round(gridRes * sizeX / maxSize));
  const resY = Math.max(1, Math.round(gridRes * sizeY / maxSize));
  const resZ = Math.max(1, Math.round(gridRes * sizeZ / maxSize));

  const cellSizeX = sizeX / resX;
  const cellSizeY = sizeY / resY;
  const cellSizeZ = sizeZ / resZ;

  // Pass 1: Map each vertex to a cell, accumulate position + color sums
  // Cell key = iz * resY * resX + iy * resX + ix
  // Use Map for sparse cell storage (most cells will be empty)
  // cellData: Map<cellKey, { sumX, sumY, sumZ, sumR, sumG, sumB, count, newIndex }>
  const cellMap = new Map<number, {
    sx: number; sy: number; sz: number;
    sr: number; sg: number; sb: number;
    count: number;
    newIdx: number;
  }>();

  // vertexToCell: which cell each original vertex maps to
  const vertexToCell = new Int32Array(vertexCount);

  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];

    const ix = Math.min(Math.floor((x - min.x) / cellSizeX), resX - 1);
    const iy = Math.min(Math.floor((y - min.y) / cellSizeY), resY - 1);
    const iz = Math.min(Math.floor((z - min.z) / cellSizeZ), resZ - 1);

    const cellKey = iz * resY * resX + iy * resX + ix;
    vertexToCell[v] = cellKey;

    let cell = cellMap.get(cellKey);
    if (!cell) {
      cell = { sx: 0, sy: 0, sz: 0, sr: 0, sg: 0, sb: 0, count: 0, newIdx: -1 };
      cellMap.set(cellKey, cell);
    }

    cell.sx += x;
    cell.sy += y;
    cell.sz += z;
    cell.count++;

    if (colors) {
      cell.sr += colors[v * 3];
      cell.sg += colors[v * 3 + 1];
      cell.sb += colors[v * 3 + 2];
    }
  }

  // Assign new vertex indices and compute averaged positions
  const newVertexCount = cellMap.size;
  const newPositions = new Float32Array(newVertexCount * 3);
  const newColors = colors ? new Float32Array(newVertexCount * 3) : undefined;

  let newMinX = Infinity, newMinY = Infinity, newMinZ = Infinity;
  let newMaxX = -Infinity, newMaxY = -Infinity, newMaxZ = -Infinity;

  let idx = 0;
  for (const cell of cellMap.values()) {
    cell.newIdx = idx;
    const inv = 1 / cell.count;
    const ax = cell.sx * inv;
    const ay = cell.sy * inv;
    const az = cell.sz * inv;

    newPositions[idx * 3] = ax;
    newPositions[idx * 3 + 1] = ay;
    newPositions[idx * 3 + 2] = az;

    if (ax < newMinX) newMinX = ax; if (ax > newMaxX) newMaxX = ax;
    if (ay < newMinY) newMinY = ay; if (ay > newMaxY) newMaxY = ay;
    if (az < newMinZ) newMinZ = az; if (az > newMaxZ) newMaxZ = az;

    if (newColors) {
      newColors[idx * 3] = cell.sr * inv;
      newColors[idx * 3 + 1] = cell.sg * inv;
      newColors[idx * 3 + 2] = cell.sb * inv;
    }

    idx++;
  }

  // Build cellKey → newIdx lookup for fast face remapping
  // (reuse vertexToCell array to map original vertex → new index)
  const vertexToNewIdx = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const cell = cellMap.get(vertexToCell[v])!;
    vertexToNewIdx[v] = cell.newIdx;
  }

  // Pass 2: Remap faces, discard degenerate triangles
  // Worst case: all faces survive, so pre-allocate full size
  const tempIndices = new Int32Array(indices.length);
  let outFaceCount = 0;

  for (let f = 0; f < inputFaceCount; f++) {
    const a = vertexToNewIdx[indices[f * 3]];
    const b = vertexToNewIdx[indices[f * 3 + 1]];
    const c = vertexToNewIdx[indices[f * 3 + 2]];

    // Skip degenerate triangles
    if (a === b || b === c || a === c) continue;

    tempIndices[outFaceCount * 3] = a;
    tempIndices[outFaceCount * 3 + 1] = b;
    tempIndices[outFaceCount * 3 + 2] = c;
    outFaceCount++;
  }

  // Trim to actual size
  const newIndices = tempIndices.slice(0, outFaceCount * 3);
  const newFaceVertexCounts = createFillArray(outFaceCount, 3);

  // Compute normals from decimated faces
  const newNormals = computeFaceNormals(newPositions, newIndices, newVertexCount);

  return {
    positions: newPositions,
    indices: newIndices,
    faceVertexCounts: newFaceVertexCounts,
    vertexCount: newVertexCount,
    faceCount: outFaceCount,
    normals: newNormals,
    colors: newColors,
    bounds: {
      min: { x: newMinX, y: newMinY, z: newMinZ },
      max: { x: newMaxX, y: newMaxY, z: newMaxZ },
    },
  };
}

/**
 * Compute area-weighted per-vertex normals from triangle faces.
 */
function computeFaceNormals(
  positions: Float32Array,
  indices: Int32Array,
  vertexCount: number
): Float32Array {
  const normals = new Float32Array(vertexCount * 3);
  const faceCount = indices.length / 3;

  for (let f = 0; f < faceCount; f++) {
    const ai = indices[f * 3] * 3;
    const bi = indices[f * 3 + 1] * 3;
    const ci = indices[f * 3 + 2] * 3;

    // Edge vectors
    const e1x = positions[bi] - positions[ai];
    const e1y = positions[bi + 1] - positions[ai + 1];
    const e1z = positions[bi + 2] - positions[ai + 2];
    const e2x = positions[ci] - positions[ai];
    const e2y = positions[ci + 1] - positions[ai + 1];
    const e2z = positions[ci + 2] - positions[ai + 2];

    // Cross product (area-weighted, not normalized)
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Accumulate to all 3 vertices
    normals[ai] += nx; normals[ai + 1] += ny; normals[ai + 2] += nz;
    normals[bi] += nx; normals[bi + 1] += ny; normals[bi + 2] += nz;
    normals[ci] += nx; normals[ci + 1] += ny; normals[ci + 2] += nz;
  }

  // Normalize
  for (let v = 0; v < vertexCount; v++) {
    const i = v * 3;
    const len = Math.sqrt(normals[i] * normals[i] + normals[i + 1] * normals[i + 1] + normals[i + 2] * normals[i + 2]);
    if (len > 1e-10) {
      const inv = 1 / len;
      normals[i] *= inv;
      normals[i + 1] *= inv;
      normals[i + 2] *= inv;
    }
  }

  return normals;
}

/**
 * Create an Int32Array filled with a single value.
 */
function createFillArray(length: number, value: number): Int32Array {
  const arr = new Int32Array(length);
  arr.fill(value);
  return arr;
}
