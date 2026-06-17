/** WebUsdFramework.Converters.Ply.PlyParser - Parses ASCII and Binary PLY files into geometry objects */

/**
 * Parsed PLY mesh data structure.
 * Uses TypedArrays for memory efficiency with large point clouds.
 */
export interface PlyMeshData {
  /** Vertex positions as flat Float32Array [x,y,z, x,y,z, ...] */
  positions: Float32Array;

  /** Per-vertex normals as flat Float32Array [nx,ny,nz, ...], or undefined */
  normals: Float32Array | undefined;

  /** Per-vertex colors as flat Float32Array in linear RGB [r,g,b, ...] (0-1), or undefined */
  colors: Float32Array | undefined;

  /** Per-vertex alpha as Float32Array (0-1), or undefined */
  alpha: Float32Array | undefined;

  /** Per-vertex texture coordinates as flat Float32Array [s,t, ...], or undefined */
  texCoords: Float32Array | undefined;

  /** Number of vertices */
  vertexCount: number;

  /** Face vertex indices as Int32Array (flat, 3 per triangle after triangulation), or undefined for point clouds */
  faceIndices: Int32Array | undefined;

  /** Face vertex counts (3 for triangles, 4 for quads, etc.), or undefined for point clouds */
  faceVertexCounts: Int32Array | undefined;

  /** Number of faces (after triangulation) */
  faceCount: number;

  /** Whether this is a point cloud (no face elements) */
  isPointCloud: boolean;

  /** Format detected */
  format: 'ascii' | 'binary_little_endian' | 'binary_big_endian';

  /** Bounding box */
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

/**
 * PLY Parser Configuration
 */
export interface PlyParserConfig {
  debug?: boolean;
}

// PLY property type sizes in bytes
const PROPERTY_SIZES: Record<string, number> = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

interface PlyProperty {
  name: string;
  type: string;
  isList: boolean;
  countType?: string;  // for list properties
  valueType?: string;  // for list properties
}

interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

interface PlyHeader {
  format: 'ascii' | 'binary_little_endian' | 'binary_big_endian';
  elements: PlyElement[];
  headerByteLength: number;
}

/**
 * Parse PLY header from buffer.
 * Returns header metadata and byte offset where data begins.
 */
function parseHeader(buffer: ArrayBuffer): PlyHeader {
  const bytes = new Uint8Array(buffer);

  // Find end_header line — scan for the pattern
  let headerEnd = -1;
  for (let i = 0; i < Math.min(bytes.length, 65536); i++) {
    if (bytes[i] === 0x65 /* e */ &&
        bytes[i + 1] === 0x6E /* n */ &&
        bytes[i + 2] === 0x64 /* d */ &&
        bytes[i + 3] === 0x5F /* _ */ &&
        bytes[i + 4] === 0x68 /* h */ &&
        bytes[i + 5] === 0x65 /* e */ &&
        bytes[i + 6] === 0x61 /* a */ &&
        bytes[i + 7] === 0x64 /* d */ &&
        bytes[i + 8] === 0x65 /* e */ &&
        bytes[i + 9] === 0x72 /* r */) {
      // Find the newline after end_header
      let j = i + 10;
      while (j < bytes.length && bytes[j] !== 0x0A) j++;
      headerEnd = j + 1;
      break;
    }
  }

  if (headerEnd === -1) {
    throw new Error('PLY header not found or exceeds 64KB');
  }

  const headerText = new TextDecoder().decode(bytes.slice(0, headerEnd));
  const lines = headerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines[0] !== 'ply') {
    throw new Error('Not a valid PLY file: missing "ply" magic');
  }

  let format: PlyHeader['format'] = 'ascii';
  const elements: PlyElement[] = [];
  let currentElement: PlyElement | null = null;

  for (const line of lines) {
    const parts = line.split(/\s+/);
    const keyword = parts[0];

    if (keyword === 'format') {
      const fmt = parts[1];
      if (fmt === 'ascii') format = 'ascii';
      else if (fmt === 'binary_little_endian') format = 'binary_little_endian';
      else if (fmt === 'binary_big_endian') format = 'binary_big_endian';
      else throw new Error(`Unsupported PLY format: ${fmt}`);
    } else if (keyword === 'element') {
      currentElement = {
        name: parts[1],
        count: parseInt(parts[2], 10),
        properties: [],
      };
      elements.push(currentElement);
    } else if (keyword === 'property' && currentElement) {
      if (parts[1] === 'list') {
        currentElement.properties.push({
          name: parts[4],
          type: parts[3],
          isList: true,
          countType: parts[2],
          valueType: parts[3],
        });
      } else {
        currentElement.properties.push({
          name: parts[2],
          type: parts[1],
          isList: false,
        });
      }
    }
  }

  return { format, elements, headerByteLength: headerEnd };
}

/**
 * Read a single typed value from a DataView.
 */
function readValue(view: DataView, offset: number, type: string, littleEndian: boolean): { value: number; bytesRead: number } {
  switch (type) {
    case 'char': case 'int8':
      return { value: view.getInt8(offset), bytesRead: 1 };
    case 'uchar': case 'uint8':
      return { value: view.getUint8(offset), bytesRead: 1 };
    case 'short': case 'int16':
      return { value: view.getInt16(offset, littleEndian), bytesRead: 2 };
    case 'ushort': case 'uint16':
      return { value: view.getUint16(offset, littleEndian), bytesRead: 2 };
    case 'int': case 'int32':
      return { value: view.getInt32(offset, littleEndian), bytesRead: 4 };
    case 'uint': case 'uint32':
      return { value: view.getUint32(offset, littleEndian), bytesRead: 4 };
    case 'float': case 'float32':
      return { value: view.getFloat32(offset, littleEndian), bytesRead: 4 };
    case 'double': case 'float64':
      return { value: view.getFloat64(offset, littleEndian), bytesRead: 8 };
    default:
      throw new Error(`Unknown PLY property type: ${type}`);
  }
}

/**
 * Map common PLY property names to semantic roles.
 */
function getPropertyRole(name: string): string {
  const n = name.toLowerCase();
  if (n === 'x') return 'x';
  if (n === 'y') return 'y';
  if (n === 'z') return 'z';
  if (n === 'nx') return 'nx';
  if (n === 'ny') return 'ny';
  if (n === 'nz') return 'nz';
  if (n === 'red' || n === 'r') return 'red';
  if (n === 'green' || n === 'g') return 'green';
  if (n === 'blue' || n === 'b') return 'blue';
  if (n === 'alpha' || n === 'a') return 'alpha';
  if (n === 's' || n === 'u' || n === 'texture_u') return 's';
  if (n === 't' || n === 'v' || n === 'texture_v') return 't';
  return 'unknown';
}

/**
 * Parse ASCII PLY data section.
 */
function parseAsciiData(text: string, header: PlyHeader): PlyMeshData {
  const vertexElement = header.elements.find(e => e.name === 'vertex');
  const faceElement = header.elements.find(e => e.name === 'face');

  if (!vertexElement) {
    throw new Error('PLY file has no vertex element');
  }

  const vertexCount = vertexElement.count;
  const faceCountRaw = faceElement?.count ?? 0;

  // Map property indices to roles
  const propRoles = vertexElement.properties.map(p => getPropertyRole(p.name));
  const hasNormals = propRoles.includes('nx');
  const hasColors = propRoles.includes('red');
  const hasAlpha = propRoles.includes('alpha');
  const hasTexCoords = propRoles.includes('s');

  // Pre-allocate TypedArrays
  const positions = new Float32Array(vertexCount * 3);
  const normals = hasNormals ? new Float32Array(vertexCount * 3) : undefined;
  const colors = hasColors ? new Float32Array(vertexCount * 3) : undefined;
  const alpha = hasAlpha ? new Float32Array(vertexCount) : undefined;
  const texCoords = hasTexCoords ? new Float32Array(vertexCount * 2) : undefined;

  // Bounds tracking
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  // Split data section into lines — skip header
  const headerEndIdx = text.indexOf('end_header');
  const dataText = text.substring(text.indexOf('\n', headerEndIdx) + 1);
  const lines = dataText.split('\n');
  let lineIdx = 0;

  // Parse vertices
  for (let v = 0; v < vertexCount; v++) {
    while (lineIdx < lines.length && lines[lineIdx].trim() === '') lineIdx++;
    if (lineIdx >= lines.length) throw new Error(`PLY: premature end of data at vertex ${v}`);

    const parts = lines[lineIdx++].trim().split(/\s+/);
    const vals = parts.map(Number);

    for (let p = 0; p < propRoles.length; p++) {
      const role = propRoles[p];
      const val = vals[p];
      switch (role) {
        case 'x': positions[v * 3] = val; break;
        case 'y': positions[v * 3 + 1] = val; break;
        case 'z': positions[v * 3 + 2] = val; break;
        case 'nx': normals![v * 3] = val; break;
        case 'ny': normals![v * 3 + 1] = val; break;
        case 'nz': normals![v * 3 + 2] = val; break;
        case 'red': colors![v * 3] = val > 1 ? val / 255 : val; break;
        case 'green': colors![v * 3 + 1] = val > 1 ? val / 255 : val; break;
        case 'blue': colors![v * 3 + 2] = val > 1 ? val / 255 : val; break;
        case 'alpha': alpha![v] = val > 1 ? val / 255 : val; break;
        case 's': texCoords![v * 2] = val; break;
        case 't': texCoords![v * 2 + 1] = val; break;
      }
    }

    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  // Parse faces — triangulate quads/polygons
  let faceIndices: Int32Array | undefined;
  let faceVertexCounts: Int32Array | undefined;
  let faceCount = 0;

  if (faceCountRaw > 0 && faceElement) {
    // First pass: count total triangles for pre-allocation
    const faceLines: string[] = [];
    let totalTriangles = 0;

    for (let f = 0; f < faceCountRaw; f++) {
      while (lineIdx < lines.length && lines[lineIdx].trim() === '') lineIdx++;
      if (lineIdx >= lines.length) throw new Error(`PLY: premature end at face ${f}`);
      const line = lines[lineIdx++].trim();
      faceLines.push(line);
      const nVerts = parseInt(line.split(/\s+/)[0], 10);
      totalTriangles += nVerts - 2; // fan triangulation
    }

    faceCount = totalTriangles;
    faceIndices = new Int32Array(totalTriangles * 3);
    faceVertexCounts = new Int32Array(totalTriangles);
    faceVertexCounts.fill(3);

    let triIdx = 0;
    for (let f = 0; f < faceCountRaw; f++) {
      const parts = faceLines[f].split(/\s+/).map(Number);
      const nVerts = parts[0];
      const verts = parts.slice(1, 1 + nVerts);

      // Fan triangulation
      for (let t = 0; t < nVerts - 2; t++) {
        faceIndices[triIdx * 3] = verts[0];
        faceIndices[triIdx * 3 + 1] = verts[t + 1];
        faceIndices[triIdx * 3 + 2] = verts[t + 2];
        triIdx++;
      }
    }
  }

  const isPointCloud = faceCount === 0;

  return {
    positions, normals, colors, alpha, texCoords,
    vertexCount, faceIndices, faceVertexCounts, faceCount,
    isPointCloud, format: 'ascii',
    bounds: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
  };
}

/**
 * Parse binary PLY data section (little-endian or big-endian).
 * Single-pass, zero intermediate string allocation.
 */
function parseBinaryData(buffer: ArrayBuffer, header: PlyHeader): PlyMeshData {
  const littleEndian = header.format === 'binary_little_endian';
  const view = new DataView(buffer);
  let offset = header.headerByteLength;

  const vertexElement = header.elements.find(e => e.name === 'vertex');
  const faceElement = header.elements.find(e => e.name === 'face');

  if (!vertexElement) {
    throw new Error('PLY file has no vertex element');
  }

  const vertexCount = vertexElement.count;
  const faceCountRaw = faceElement?.count ?? 0;

  // Map property indices to roles
  const propRoles = vertexElement.properties.map(p => getPropertyRole(p.name));
  const hasNormals = propRoles.includes('nx');
  const hasColors = propRoles.includes('red');
  const hasAlpha = propRoles.includes('alpha');
  const hasTexCoords = propRoles.includes('s');

  // Pre-allocate
  const positions = new Float32Array(vertexCount * 3);
  const normals = hasNormals ? new Float32Array(vertexCount * 3) : undefined;
  const colors = hasColors ? new Float32Array(vertexCount * 3) : undefined;
  const alpha = hasAlpha ? new Float32Array(vertexCount) : undefined;
  const texCoords = hasTexCoords ? new Float32Array(vertexCount * 2) : undefined;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  // Parse all elements in order (PLY spec requires this)
  for (const element of header.elements) {
    if (element.name === 'vertex') {
      for (let v = 0; v < vertexCount; v++) {
        for (let p = 0; p < element.properties.length; p++) {
          const prop = element.properties[p];

          if (prop.isList) {
            // Skip list properties on vertex elements (rare)
            const countResult = readValue(view, offset, prop.countType!, littleEndian);
            offset += countResult.bytesRead;
            const listLen = countResult.value;
            for (let li = 0; li < listLen; li++) {
              offset += PROPERTY_SIZES[prop.valueType!] || 4;
            }
            continue;
          }

          const result = readValue(view, offset, prop.type, littleEndian);
          offset += result.bytesRead;
          const val = result.value;
          const role = propRoles[p];

          switch (role) {
            case 'x': positions[v * 3] = val; break;
            case 'y': positions[v * 3 + 1] = val; break;
            case 'z': positions[v * 3 + 2] = val; break;
            case 'nx': normals![v * 3] = val; break;
            case 'ny': normals![v * 3 + 1] = val; break;
            case 'nz': normals![v * 3 + 2] = val; break;
            case 'red': colors![v * 3] = val > 1 ? val / 255 : val; break;
            case 'green': colors![v * 3 + 1] = val > 1 ? val / 255 : val; break;
            case 'blue': colors![v * 3 + 2] = val > 1 ? val / 255 : val; break;
            case 'alpha': alpha![v] = val > 1 ? val / 255 : val; break;
            case 's': texCoords![v * 2] = val; break;
            case 't': texCoords![v * 2 + 1] = val; break;
          }
        }

        const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    } else if (element.name === 'face') {
      // We'll handle face parsing below after reading all elements in order
      // For now, record offset and break — face is typically the last element
      break;
    } else {
      // Skip unknown elements
      for (let i = 0; i < element.count; i++) {
        for (const prop of element.properties) {
          if (prop.isList) {
            const countResult = readValue(view, offset, prop.countType!, littleEndian);
            offset += countResult.bytesRead;
            const listLen = countResult.value;
            for (let li = 0; li < listLen; li++) {
              offset += PROPERTY_SIZES[prop.valueType!] || 4;
            }
          } else {
            offset += PROPERTY_SIZES[prop.type] || 4;
          }
        }
      }
    }
  }

  // Parse faces
  let faceIndices: Int32Array | undefined;
  let faceVertexCounts: Int32Array | undefined;
  let faceCount = 0;

  if (faceCountRaw > 0 && faceElement) {
    const listProp = faceElement.properties.find(p => p.isList);
    if (!listProp) {
      throw new Error('PLY face element has no list property');
    }

    // Two-pass for binary faces: first count triangles, then parse
    // Save offset for second pass
    const faceStartOffset = offset;

    // First pass: count total triangles
    let totalTriangles = 0;
    let tempOffset = faceStartOffset;

    for (let f = 0; f < faceCountRaw; f++) {
      const countResult = readValue(view, tempOffset, listProp.countType!, littleEndian);
      tempOffset += countResult.bytesRead;
      const nVerts = countResult.value;
      totalTriangles += nVerts - 2;
      tempOffset += nVerts * (PROPERTY_SIZES[listProp.valueType!] || 4);

      // Skip any non-list properties on the face element
      for (const prop of faceElement.properties) {
        if (!prop.isList) {
          tempOffset += PROPERTY_SIZES[prop.type] || 4;
        }
      }
    }

    faceCount = totalTriangles;
    faceIndices = new Int32Array(totalTriangles * 3);
    faceVertexCounts = new Int32Array(totalTriangles);
    faceVertexCounts.fill(3);

    // Second pass: read indices
    offset = faceStartOffset;
    let triIdx = 0;

    for (let f = 0; f < faceCountRaw; f++) {
      const countResult = readValue(view, offset, listProp.countType!, littleEndian);
      offset += countResult.bytesRead;
      const nVerts = countResult.value;

      const verts: number[] = [];
      for (let vi = 0; vi < nVerts; vi++) {
        const idxResult = readValue(view, offset, listProp.valueType!, littleEndian);
        offset += idxResult.bytesRead;
        verts.push(idxResult.value);
      }

      // Skip non-list properties
      for (const prop of faceElement.properties) {
        if (!prop.isList) {
          offset += PROPERTY_SIZES[prop.type] || 4;
        }
      }

      // Fan triangulation
      for (let t = 0; t < nVerts - 2; t++) {
        faceIndices[triIdx * 3] = verts[0];
        faceIndices[triIdx * 3 + 1] = verts[t + 1];
        faceIndices[triIdx * 3 + 2] = verts[t + 2];
        triIdx++;
      }
    }
  }

  const isPointCloud = faceCount === 0;

  return {
    positions, normals, colors, alpha, texCoords,
    vertexCount, faceIndices, faceVertexCounts, faceCount,
    isPointCloud, format: header.format,
    bounds: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
  };
}

/**
 * Parse a PLY file from an ArrayBuffer.
 */
export function parsePly(buffer: ArrayBuffer, _config?: PlyParserConfig): PlyMeshData {
  const header = parseHeader(buffer);

  if (header.format === 'ascii') {
    const text = new TextDecoder().decode(buffer);
    return parseAsciiData(text, header);
  } else {
    return parseBinaryData(buffer, header);
  }
}

/**
 * Parse a PLY file from a file path (Node.js only).
 */
export async function parsePlyFile(filePath: string, _config?: PlyParserConfig): Promise<PlyMeshData> {
  const fs = await import('fs');
  const fileBuffer = fs.readFileSync(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );
  return parsePly(arrayBuffer, _config);
}
