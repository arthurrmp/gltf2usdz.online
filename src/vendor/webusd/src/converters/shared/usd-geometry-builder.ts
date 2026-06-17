/** WebUsdFramework.Converters.Shared.UsdGeometryBuilder - Generic agnostic mesh-to-USD translation layer */

import { Mesh, Primitive } from '@gltf-transform/core';
import { formatUsdTuple3, formatUsdTuple2 } from '../../utils/usd-formatter';

/**
 * Geometry build result
 */
export interface GeometryBuildResult {
  /** USD-formatted geometry content */
  content: string;
  /** Bounding box minimum coordinates */
  boundsMin: [number, number, number];
  /** Bounding box maximum coordinates */
  boundsMax: [number, number, number];
  /** Total vertex count */
  vertexCount: number;
  /** Total face count */
  faceCount: number;
}

/**
 * Raw geometry data
 */
export interface RawGeometryData {
  points: string;
  faceVertexCounts: string;
  faceVertexIndices: string;
  normals?: string;
  uvs?: string;
  colors?: string;
  extent: string;
}

/**
 * Extract raw geometry data from GLTF primitive
 */
export function extractRawGeometryData(primitive: Primitive): RawGeometryData {
  const positions = primitive.getAttribute('POSITION');
  const normals = primitive.getAttribute('NORMAL');
  const uvs = primitive.getAttribute('TEXCOORD_0');
  const colors = primitive.getAttribute('COLOR_0');
  const indices = primitive.getIndices();

  if (!positions) {
    throw new Error('Primitive missing POSITION attribute');
  }

  const positionArray = positions.getArray();
  if (!positionArray || positionArray.length === 0) {
    throw new Error('Primitive has empty position data');
  }

  // Calculate bounds
  const bounds = calculateBounds(positionArray);

  // Extract points as tuples
  const points: string[] = [];
  for (let i = 0; i < positionArray.length; i += 3) {
    // Use formatUsdTuple3 for consistent 7 decimal place precision
    points.push(formatUsdTuple3(positionArray[i], positionArray[i + 1], positionArray[i + 2]));
  }

  // Extract face data
  let faceVertexCounts: string;
  let faceVertexIndices: string;

  if (indices) {
    const indexArray = indices.getArray();
    if (indexArray && indexArray.length > 0) {
      // Validate that geometry is fully triangulated (indexArray.length must be divisible by 3).
      // gltf-transform's triangulate() transform should guarantee this; warn if it didn't.
      if (indexArray.length % 3 !== 0) {
        console.warn(
          `[extractPrimitiveData] Index count (${indexArray.length}) is not divisible by 3. ` +
          `Geometry may not be fully triangulated. Face topology will be incorrect.`
        );
      }
      const faceCount = Math.floor(indexArray.length / 3);
      faceVertexCounts = Array(faceCount).fill(3).join(', ');
      faceVertexIndices = Array.from(indexArray).join(', ');
    } else {
      // Fallback
      const vertexCount = positionArray.length / 3;
      if (vertexCount % 3 !== 0) {
        console.warn(
          `[extractPrimitiveData] Vertex count (${vertexCount}) is not divisible by 3. ` +
          `Non-indexed geometry may not be fully triangulated.`
        );
      }
      const faceCount = Math.floor(vertexCount / 3);
      faceVertexCounts = Array(faceCount).fill(3).join(', ');
      faceVertexIndices = Array.from({ length: vertexCount }, (_, i) => i).join(', ');
    }
  } else {
    // Non-indexed geometry
    const vertexCount = positionArray.length / 3;
    if (vertexCount % 3 !== 0) {
      console.warn(
        `[extractPrimitiveData] Vertex count (${vertexCount}) is not divisible by 3. ` +
        `Non-indexed geometry may not be fully triangulated.`
      );
    }
    const faceCount = Math.floor(vertexCount / 3);
    faceVertexCounts = Array(faceCount).fill(3).join(', ');
    faceVertexIndices = Array.from({ length: vertexCount }, (_, i) => i).join(', ');
  }

  // Format extent with consistent precision
  const extentMinStr = formatUsdTuple3(bounds.min[0], bounds.min[1], bounds.min[2]);
  const extentMaxStr = formatUsdTuple3(bounds.max[0], bounds.max[1], bounds.max[2]);

  const result: RawGeometryData = {
    points: `[${points.join(', ')}]`,
    faceVertexCounts: `[${faceVertexCounts}]`,
    faceVertexIndices: `[${faceVertexIndices}]`,
    extent: `[${extentMinStr}, ${extentMaxStr}]`
  };

  // Extract normals if available
  if (normals) {
    const normalArray = normals.getArray();
    if (normalArray && normalArray.length > 0) {
      const normalTuples: string[] = [];
      let nonUnitCount = 0;
      for (let i = 0; i < normalArray.length; i += 3) {
        let nx = normalArray[i];
        let ny = normalArray[i + 1];
        let nz = normalArray[i + 2];
        const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
        // Normalize if magnitude deviates from 1.0 by more than epsilon
        if (mag > 0 && Math.abs(mag - 1.0) > 1e-4) {
          nx /= mag;
          ny /= mag;
          nz /= mag;
          nonUnitCount++;
        }
        normalTuples.push(formatUsdTuple3(nx, ny, nz));
      }
      if (nonUnitCount > 0) {
        console.warn(`[extractPrimitiveData] Normalized ${nonUnitCount} non-unit normal vector(s) in mesh`);
      }
      result.normals = `[${normalTuples.join(', ')}]`;
    }
  }

  // Extract UVs if available
  if (uvs) {
    const uvArray = uvs.getArray();
    if (uvArray && uvArray.length > 0) {
      // Preserve GLTF UV coordinates as-is.
      // GLTF allows UV values outside [0,1] for tiled/repeating textures.
      // USD handles tiling via wrapS/wrapT = "repeat" on UsdUVTexture.
      // Normalizing to [0,1] would destroy all tiling information.
      const uvTuples: string[] = [];
      for (let i = 0; i < uvArray.length; i += 2) {
        uvTuples.push(formatUsdTuple2(uvArray[i], uvArray[i + 1]));
      }
      result.uvs = `[${uvTuples.join(', ')}]`;
    }
  }

  // Extract vertex colors if available (COLOR_0)
  if (colors) {
    const colorArray = colors.getArray();
    if (colorArray && colorArray.length > 0) {
      // GLTF stores colors as RGB or RGBA (0-1 range)
      // USD uses color3f[] for RGB colors
      // Determine component count from array length vs vertex count
      const vertexCount = positionArray.length / 3;
      const componentCount = colorArray.length / vertexCount; // 3 for RGB, 4 for RGBA

      const colorTuples: string[] = [];
      for (let i = 0; i < colorArray.length; i += componentCount) {
        const r = colorArray[i];
        const g = colorArray[i + 1];
        const b = colorArray[i + 2];
        // Use formatUsdTuple3 for consistent precision
        colorTuples.push(formatUsdTuple3(r, g, b));
      }
      result.colors = `[${colorTuples.join(', ')}]`;
    }
  }

  return result;
}

/**
 * Build USD geometry from GLTF primitive
 */
export function buildUsdGeometry(mesh: Mesh, primitiveIndex: number): GeometryBuildResult {
  const primitive = mesh.listPrimitives()[primitiveIndex];

  if (!primitive) {
    throw new Error(`Primitive ${primitiveIndex} not found in mesh`);
  }

  const positions = primitive.getAttribute('POSITION');
  const normals = primitive.getAttribute('NORMAL');
  const uvs = primitive.getAttribute('TEXCOORD_0');
  const indices = primitive.getIndices();

  if (!positions) {
    throw new Error(`Primitive ${primitiveIndex} missing POSITION attribute`);
  }

  let usdContent = '';

  // Extract and validate position data
  const positionArray = positions.getArray();
  if (!positionArray || positionArray.length === 0) {
    throw new Error(`Primitive ${primitiveIndex} has empty position data`);
  }

  const vertexCount = positionArray.length / 3;

  // Calculate bounding box
  const bounds = calculateBounds(positionArray);

  // Generate vertex positions
  usdContent += generatePositions(positionArray);

  // Generate face topology
  if (indices) {
    const indexArray = indices.getArray();
    if (indexArray && indexArray.length > 0) {
      const faceCount = indexArray.length / 3;
      usdContent += generateFaceData(indexArray as Uint32Array | Uint16Array | Uint8Array | Int8Array | Int16Array);

      // Add normals if available
      if (normals) {
        const normalArray = normals.getArray();
        if (normalArray && normalArray.length > 0) {
          usdContent += generateNormals(normalArray);
        }
      }

      // Add UVs if available
      if (uvs) {
        const uvArray = uvs.getArray();
        if (uvArray && uvArray.length > 0) {
          usdContent += generateUVs(uvArray);
        }
      }

      // Add extent (bounding box)
      usdContent += generateExtent(bounds.min, bounds.max);

      return {
        content: usdContent,
        boundsMin: bounds.min,
        boundsMax: bounds.max,
        vertexCount,
        faceCount
      };
    }
  }

  // Fallback for non-indexed geometry
  const faceCount = vertexCount / 3;
  usdContent += `    int[] faceVertexCounts = [${Array(faceCount).fill(3).join(', ')}]\n`;

  const faceIndices = Array.from({ length: vertexCount }, (_, i) => i);
  usdContent += `    int[] faceVertexIndices = [${faceIndices.join(', ')}]\n`;

  usdContent += generateExtent(bounds.min, bounds.max);

  return {
    content: usdContent,
    boundsMin: bounds.min,
    boundsMax: bounds.max,
    vertexCount,
    faceCount
  };
}

/**
 * Calculate bounding box from positions
 */
function calculateBounds(positions: Float32Array | Int8Array | Int16Array | Uint8Array | Uint16Array | Uint32Array): {
  min: [number, number, number];
  max: [number, number, number];
} {
  if (positions.length < 3) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0]
    };
  }

  let minX = positions[0], maxX = positions[0];
  let minY = positions[1], maxY = positions[1];
  let minZ = positions[2], maxZ = positions[2];

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ]
  };
}

/**
 * Generate USD points array
 */
function generatePositions(positions: Float32Array | Int8Array | Int16Array | Uint8Array | Uint16Array | Uint32Array): string {
  const pointCount = positions.length / 3;
  let content = `    point3f[] points = [\n`;

  for (let i = 0; i < pointCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    // Use formatUsdTuple3 for consistent 7 decimal place precision
    content += `        ${formatUsdTuple3(x, y, z)}`;
    if (i < pointCount - 1) content += `,\n`;
  }

  content += `\n    ]\n`;
  return content;
}

/**
 * Generate USD face data
 */
function generateFaceData(indices: Uint32Array | Uint16Array | Uint8Array | Int8Array | Int16Array): string {
  const faceCount = indices.length / 3;
  let content = `    int[] faceVertexCounts = [${Array(faceCount).fill(3).join(', ')}]\n`;

  content += `    int[] faceVertexIndices = [\n`;
  for (let i = 0; i < indices.length; i++) {
    content += `        ${indices[i]}`;
    if (i < indices.length - 1) content += `,\n`;
  }
  content += `\n    ]\n`;

  return content;
}

/**
 * Generate USD normals array
 */
function generateNormals(normals: Float32Array | Int8Array | Int16Array | Uint8Array | Uint16Array | Uint32Array): string {
  const normalCount = normals.length / 3;
  let content = `    normal3f[] normals = [\n`;

  for (let i = 0; i < normalCount; i++) {
    const x = normals[i * 3];
    const y = normals[i * 3 + 1];
    const z = normals[i * 3 + 2];
    content += `        (${x}, ${y}, ${z})`;
    if (i < normalCount - 1) content += `,\n`;
  }

  content += `\n    ]\n`;
  content += `    uniform token primvars:normals:interpolation = "vertex"\n`;

  return content;
}

/**
 * Generate USD UV array with normalized coordinates
 */
function generateUVs(uvs: Float32Array | Int8Array | Int16Array | Uint8Array | Uint16Array | Uint32Array): string {
  const uvCount = uvs.length / 2;

  // Preserve GLTF UV coordinates as-is.
  // GLTF allows UV values outside [0,1] for tiled/repeating textures.
  // USD handles tiling via wrapS/wrapT = "repeat" on UsdUVTexture.
  let content = `    texCoord2f[] primvars:st = [\n`;
  for (let i = 0; i < uvCount; i++) {
    const u = uvs[i * 2];
    const v = uvs[i * 2 + 1];

    content += `        (${u}, ${v})`;
    if (i < uvCount - 1) content += `,\n`;
  }
  content += `\n    ]\n`;
  content += `    primvars:st:interpolation = "vertex"\n`;

  return content;
}

/**
 * Generate USD extent property
 */
function generateExtent(min: [number, number, number], max: [number, number, number]): string {
  // Use formatUsdTuple3 for consistent 7 decimal place precision
  const extentMinStr = formatUsdTuple3(min[0], min[1], min[2]);
  const extentMaxStr = formatUsdTuple3(max[0], max[1], max[2]);
  return `    float3[] extent = [${extentMinStr}, ${extentMaxStr}]\n`;
}

/**
 * Wrap geometry in USD mesh file
 */
export function wrapGeometryInUsdFile(geometryContent: string, meshName: string = "Geometry"): string {
  return `#usda 1.0
(
    defaultPrim = "${meshName}"
    metersPerUnit = 1
    upAxis = "Y"
    
)

def Mesh "${meshName}"
{
${geometryContent}    uniform token subdivisionScheme = "none"
}
`;
}

