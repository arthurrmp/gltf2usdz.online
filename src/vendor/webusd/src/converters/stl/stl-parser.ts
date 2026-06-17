/** WebUsdFramework.Converters.Stl.StlParser - Parses ASCII and Binary STL arrays into geometry objects */

import { Logger, LogLevel } from '../../utils';

/**
 * Parsed STL mesh data structure
 */
export interface StlMeshData {
  /** Vertex positions as flat array [x,y,z, x,y,z, ...] */
  vertices: number[];

  /** Face normals as flat array [nx,ny,nz, nx,ny,nz, ...] (one per triangle) */
  normals: number[];

  /** Optional face colors in linear RGB [r,g,b, r,g,b, ...] (0-1 range) */
  colors: number[] | undefined;

  /** Number of triangles in the mesh */
  triangleCount: number;

  /** Format detected: 'binary' or 'ascii' */
  format: 'binary' | 'ascii';

  /** Bounding box of the mesh */
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

/**
 * STL Parser Configuration
 */
export interface StlParserConfig {
  /** Enable debug logging */
  debug?: boolean;

  /** Validate normals (check if they match computed face normals) */
  validateNormals?: boolean;

  /** Automatically compute normals if validation fails or they're zero */
  autoComputeNormals?: boolean;
}

const DEFAULT_CONFIG: Required<StlParserConfig> = {
  debug: false,
  validateNormals: false,
  autoComputeNormals: true,
};

/**
 * Detect STL file format (binary vs ASCII)
 */
function detectFormat(buffer: ArrayBuffer): 'binary' | 'ascii' {
  const view = new Uint8Array(buffer);

  // Check if file starts with "solid" (ASCII format)
  const header = String.fromCharCode(...view.slice(0, 5));

  if (header === 'solid') {
    // Could be ASCII, but some binary files also start with "solid"
    // Check if the file contains non-ASCII characters
    const sample = view.slice(0, Math.min(1024, view.length));

    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i];
      // Check for binary characters (null bytes or high bytes typically not in ASCII)
      if (byte === 0 || (byte > 127 && byte < 160)) {
        return 'binary';
      }
    }

    // If it looks like ASCII text, assume ASCII
    return 'ascii';
  }

  return 'binary';
}

/**
 * Parse Binary STL format
 * 
 * Format:
 * - Header: 80 bytes (often contains metadata but can be ignored)
 * - Triangle count: uint32 (4 bytes)
 * - For each triangle:
 *   - Normal: 3x float32 (12 bytes)
 *   - Vertex 1: 3x float32 (12 bytes)
 *   - Vertex 2: 3x float32 (12 bytes)
 *   - Vertex 3: 3x float32 (12 bytes)
 *   - Attribute byte count: uint16 (2 bytes, often used for color)
 */
function parseBinaryStl(buffer: ArrayBuffer, config: Required<StlParserConfig>, logger: Logger): StlMeshData {
  const view = new DataView(buffer);

  // Skip 80-byte header
  const triangleCount = view.getUint32(80, true); // Little-endian

  if (config.debug) {
    logger.debug(`Binary STL: ${triangleCount} triangles`);
  }

  const vertices: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let offset = 84; // Start after header and triangle count

  for (let i = 0; i < triangleCount; i++) {
    // Read normal
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;

    // Read 3 vertices
    const triangleVertices: number[] = [];
    for (let j = 0; j < 3; j++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      offset += 12;

      triangleVertices.push(x, y, z);

      // Update bounds
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }

    vertices.push(...triangleVertices);

    // Store normal for each vertex of the triangle
    normals.push(nx, ny, nz);

    // Read attribute bytes (may contain color info)
    const attribute = view.getUint16(offset, true);
    offset += 2;

    // Check if attribute contains color (VisCAM/SolidView color format)
    // Bit 15: 0, Bits 10-14: Blue, Bits 5-9: Green, Bits 0-4: Red
    if (attribute !== 0 && !(attribute & 0x8000)) {
      const r = ((attribute >> 0) & 0x1F) / 31.0;
      const g = ((attribute >> 5) & 0x1F) / 31.0;
      const b = ((attribute >> 10) & 0x1F) / 31.0;
      colors.push(r, g, b);
    }
  }

  return {
    vertices,
    normals,
    colors: colors.length > 0 ? colors : undefined,
    triangleCount,
    format: 'binary',
    bounds: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
  };
}

/**
 * Parse ASCII STL format
 * 
 * Format:
 * solid [name]
 *   facet normal nx ny nz
 *     outer loop
 *       vertex x1 y1 z1
 *       vertex x2 y2 z2
 *       vertex x3 y3 z3
 *     endloop
 *   endfacet
 *   ...
 * endsolid [name]
 */
function parseAsciiStl(buffer: ArrayBuffer, config: Required<StlParserConfig>, logger: Logger): StlMeshData {
  const decoder = new TextDecoder('utf-8');
  const text = decoder.decode(buffer);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);

  const vertices: number[] = [];
  const normals: number[] = [];
  let triangleCount = 0;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let currentNormal: number[] | null = null;

  for (const line of lines) {
    const parts = line.split(/\s+/);
    const keyword = parts[0].toLowerCase();

    if (keyword === 'facet' && parts[1] === 'normal') {
      // Read normal
      const nx = parseFloat(parts[2]);
      const ny = parseFloat(parts[3]);
      const nz = parseFloat(parts[4]);
      currentNormal = [nx, ny, nz];
    } else if (keyword === 'vertex') {
      // Read vertex
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);

      vertices.push(x, y, z);

      // Update bounds
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    } else if (keyword === 'endfacet') {
      // Store normal for this triangle
      if (currentNormal) {
        normals.push(...currentNormal);
      } else {
        normals.push(0, 0, 0);
      }
      triangleCount++;
      currentNormal = null;
    }
  }

  if (config.debug) {
    logger.debug(`ASCII STL: ${triangleCount} triangles, ${vertices.length / 3} vertices`);
  }

  return {
    vertices,
    normals,
    colors: undefined,
    triangleCount,
    format: 'ascii',
    bounds: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
  };
}

/**
 * Compute face normal from three vertices
 */
function computeFaceNormal(
  v1: [number, number, number],
  v2: [number, number, number],
  v3: [number, number, number]
): [number, number, number] {
  // Edge vectors
  const e1x = v2[0] - v1[0];
  const e1y = v2[1] - v1[1];
  const e1z = v2[2] - v1[2];

  const e2x = v3[0] - v1[0];
  const e2y = v3[1] - v1[1];
  const e2z = v3[2] - v1[2];

  // Cross product
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;

  // Normalize
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (length > 0) {
    nx /= length;
    ny /= length;
    nz /= length;
  }

  return [nx, ny, nz];
}

/**
 * Validate and optionally recompute normals
 */
function processNormals(
  meshData: StlMeshData,
  config: Required<StlParserConfig>,
  logger: Logger
): void {
  if (!config.validateNormals && !config.autoComputeNormals) {
    return;
  }

  const { vertices, normals } = meshData;
  let recomputedCount = 0;

  for (let i = 0; i < meshData.triangleCount; i++) {
    const vIdx = i * 9; // 3 vertices * 3 components
    const nIdx = i * 3; // 1 normal * 3 components

    const v1: [number, number, number] = [vertices[vIdx], vertices[vIdx + 1], vertices[vIdx + 2]];
    const v2: [number, number, number] = [vertices[vIdx + 3], vertices[vIdx + 4], vertices[vIdx + 5]];
    const v3: [number, number, number] = [vertices[vIdx + 6], vertices[vIdx + 7], vertices[vIdx + 8]];

    const storedNormal = [normals[nIdx], normals[nIdx + 1], normals[nIdx + 2]];
    const normalLength = Math.sqrt(
      storedNormal[0] * storedNormal[0] +
      storedNormal[1] * storedNormal[1] +
      storedNormal[2] * storedNormal[2]
    );

    // Recompute if normal is zero or if auto-compute is enabled and validation requested
    if (config.autoComputeNormals && normalLength < 0.001) {
      const computed = computeFaceNormal(v1, v2, v3);
      normals[nIdx] = computed[0];
      normals[nIdx + 1] = computed[1];
      normals[nIdx + 2] = computed[2];
      recomputedCount++;
    }
  }

  if (config.debug && recomputedCount > 0) {
    logger.debug(`Recomputed ${recomputedCount} normals`);
  }
}

/**
 * Parse STL file from ArrayBuffer
 * 
 * @param buffer - STL file data
 * @param config - Parser configuration
 * @returns Parsed mesh data
 */
export function parseStl(buffer: ArrayBuffer, config: Partial<StlParserConfig> = {}): StlMeshData {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const logger = new Logger({ level: finalConfig.debug ? LogLevel.DEBUG : LogLevel.ERROR });

  if (buffer.byteLength === 0) {
    throw new Error('STL file is empty');
  }

  const format = detectFormat(buffer);

  if (finalConfig.debug) {
    logger.debug(`Detected ${format.toUpperCase()} STL format`);
  }

  let meshData: StlMeshData;

  if (format === 'binary') {
    meshData = parseBinaryStl(buffer, finalConfig, logger);
  } else {
    meshData = parseAsciiStl(buffer, finalConfig, logger);
  }

  // Process normals if needed
  processNormals(meshData, finalConfig, logger);

  if (finalConfig.debug) {
    logger.debug(`Parsed STL: ${meshData.triangleCount} triangles`);
    logger.debug(`Bounds: [${meshData.bounds.min.x.toFixed(2)}, ${meshData.bounds.min.y.toFixed(2)}, ${meshData.bounds.min.z.toFixed(2)}] to [${meshData.bounds.max.x.toFixed(2)}, ${meshData.bounds.max.y.toFixed(2)}, ${meshData.bounds.max.z.toFixed(2)}]`);
  }

  return meshData;
}

/**
 * Parse STL file from file path (Node.js only)
 */
export async function parseStlFile(filePath: string, config: Partial<StlParserConfig> = {}): Promise<StlMeshData> {
  const fs = await import('fs');
  const fileBuffer = fs.readFileSync(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );

  return parseStl(arrayBuffer, config);
}
