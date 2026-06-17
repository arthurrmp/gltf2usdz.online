/** WebUsdFramework.Converters.Ply.PlyConverter - Main PLY to USDZ converter */

import { PlyConverterConfig } from '../../schemas';
import { LoggerFactory } from '../../utils';
import { parsePly, parsePlyFile, PlyMeshData } from './ply-parser';
import { decimateMesh } from './mesh-decimator';
import { createRootStructure } from '../shared/usd-root-builder';
import {
  createUsdzPackage,
  createUsdzPackageToFile,
  PackageContent,
  ConvertOptions,
  UsdzStreamResult
} from '../shared/usd-packaging';
import {
  writeDebugOutput,
  DebugOutputContent
} from '../shared/debug-writer';
import { UsdNode } from '../../core/usd-node';
import { USD_PROPERTIES, USD_PROPERTY_TYPES } from '../../constants/usd';
const DEFAULT_CONFIG: Required<PlyConverterConfig> = {
  debug: false,
  debugOutputDir: './debug-output',
  upAxis: 'Y',
  metersPerUnit: 1,
  defaultColor: [0.7, 0.7, 0.7],
  defaultPointWidth: 0.005,
  maxPoints: 0,
  decimateTarget: 0,
};

/**
 * Format a float for USDA output.
 */
function fmtFloat(n: number): string {
  return n.toFixed(6);
}

/**
 * Build extent string from bounds.
 */
function formatExtent(bounds: PlyMeshData['bounds']): string {
  const { min, max } = bounds;
  return `[(${fmtFloat(min.x)}, ${fmtFloat(min.y)}, ${fmtFloat(min.z)}), (${fmtFloat(max.x)}, ${fmtFloat(max.y)}, ${fmtFloat(max.z)})]`;
}

/**
 * Center geometry in-place and update bounds. Modifies the positions array directly.
 */
function centerGeometry(data: PlyMeshData): void {
  const { positions, bounds } = data;
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cy = (bounds.min.y + bounds.max.y) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;

  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 1] -= cy;
    positions[i + 2] -= cz;
  }

  data.bounds = {
    min: { x: bounds.min.x - cx, y: bounds.min.y - cy, z: bounds.min.z - cz },
    max: { x: bounds.max.x - cx, y: bounds.max.y - cy, z: bounds.max.z - cz },
  };
}

/**
 * Downsample a point cloud by uniform stride if it exceeds maxPoints.
 * Returns a new PlyMeshData with reduced point count, or the original if no reduction needed.
 */
function downsamplePointCloud(data: PlyMeshData, maxPoints: number): PlyMeshData {
  if (maxPoints <= 0 || data.vertexCount <= maxPoints) return data;

  const stride = Math.ceil(data.vertexCount / maxPoints);
  const newCount = Math.ceil(data.vertexCount / stride);

  const positions = new Float32Array(newCount * 3);
  const normals = data.normals ? new Float32Array(newCount * 3) : undefined;
  const colors = data.colors ? new Float32Array(newCount * 3) : undefined;
  const alpha = data.alpha ? new Float32Array(newCount) : undefined;
  const texCoords = data.texCoords ? new Float32Array(newCount * 2) : undefined;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let dst = 0;
  for (let src = 0; src < data.vertexCount && dst < newCount; src += stride, dst++) {
    const si3 = src * 3;
    const di3 = dst * 3;
    positions[di3] = data.positions[si3];
    positions[di3 + 1] = data.positions[si3 + 1];
    positions[di3 + 2] = data.positions[si3 + 2];

    if (normals && data.normals) {
      normals[di3] = data.normals[si3];
      normals[di3 + 1] = data.normals[si3 + 1];
      normals[di3 + 2] = data.normals[si3 + 2];
    }
    if (colors && data.colors) {
      colors[di3] = data.colors[si3];
      colors[di3 + 1] = data.colors[si3 + 1];
      colors[di3 + 2] = data.colors[si3 + 2];
    }
    if (alpha && data.alpha) {
      alpha[dst] = data.alpha[src];
    }
    if (texCoords && data.texCoords) {
      texCoords[dst * 2] = data.texCoords[src * 2];
      texCoords[dst * 2 + 1] = data.texCoords[src * 2 + 1];
    }

    const x = positions[di3], y = positions[di3 + 1], z = positions[di3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  return {
    positions, normals, colors, alpha, texCoords,
    vertexCount: dst,
    faceIndices: undefined,
    faceVertexCounts: undefined,
    faceCount: 0,
    isPointCloud: true,
    format: data.format,
    bounds: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
  };
}

/**
 * Build a UsdGeomMesh node from PLY mesh data.
 */
function buildMeshNode(data: PlyMeshData, meshPath: string): UsdNode {
  const meshNode = new UsdNode(meshPath, 'Mesh');

  meshNode.setProperty('point3f[] points', data.positions);
  meshNode.setProperty('int[] faceVertexIndices', data.faceIndices!);
  meshNode.setProperty('int[] faceVertexCounts', data.faceVertexCounts!);

  if (data.normals) {
    meshNode.setProperty('normal3f[] normals', data.normals);
    meshNode.setProperty('uniform token primvars:normals:interpolation', 'vertex', 'raw');
  }

  if (data.colors) {
    meshNode.setProperty('color3f[] primvars:displayColor', data.colors);
    meshNode.setProperty('uniform token primvars:displayColor:interpolation', 'vertex', 'raw');
  }

  if (data.texCoords) {
    meshNode.setProperty('texCoord2f[] primvars:st', data.texCoords);
    meshNode.setProperty('uniform token primvars:st:interpolation', 'vertex', 'raw');
  }

  meshNode.setProperty('float3[] extent', formatExtent(data.bounds), 'raw');
  meshNode.setProperty('uniform token subdivisionScheme', 'none', 'raw');

  return meshNode;
}

/**
 * Build a UsdGeomPoints node from PLY point cloud data.
 */
function buildPointsNode(data: PlyMeshData, pointsPath: string, pointWidth: number): UsdNode {
  const pointsNode = new UsdNode(pointsPath, 'Points');

  pointsNode.setProperty('point3f[] points', data.positions);

  // Widths — uniform size for all points
  const widths = new Float32Array(data.vertexCount);
  widths.fill(pointWidth);
  pointsNode.setProperty('float[] widths', widths);

  if (data.normals) {
    pointsNode.setProperty('normal3f[] normals', data.normals);
    pointsNode.setProperty('uniform token primvars:normals:interpolation', 'vertex', 'raw');
  }

  if (data.colors) {
    pointsNode.setProperty('color3f[] primvars:displayColor', data.colors);
    pointsNode.setProperty('uniform token primvars:displayColor:interpolation', 'vertex', 'raw');
  }

  pointsNode.setProperty('float3[] extent', formatExtent(data.bounds), 'raw');

  return pointsNode;
}

/**
 * Create a basic USD material.
 */
function createBasicMaterial(
  materialPath: string,
  color: [number, number, number],
  hasVertexColors: boolean
): UsdNode {
  const materialNode = new UsdNode(materialPath, 'Material');
  const surfaceShader = new UsdNode(`${materialPath}/PreviewSurface`, 'Shader');

  surfaceShader.setProperty('uniform token info:id', 'UsdPreviewSurface');

  if (!hasVertexColors) {
    surfaceShader.setProperty(
      'color3f inputs:diffuseColor',
      `(${color[0]}, ${color[1]}, ${color[2]})`,
      'color3f'
    );
  }

  surfaceShader.setProperty('float inputs:roughness', '0.6', 'float');
  surfaceShader.setProperty('float inputs:metallic', '0.0', 'float');
  surfaceShader.setProperty('float inputs:opacity', '1.0', 'float');
  surfaceShader.setProperty('token outputs:surface', '');

  materialNode.addChild(surfaceShader);
  materialNode.setProperty(
    'token outputs:surface.connect',
    `<${materialPath}/PreviewSurface.outputs:surface>`,
    'connection'
  );

  return materialNode;
}

/**
 * Main PLY to USDZ conversion function.
 */
export function convertPlyToUsdz(
  input: ArrayBuffer | string,
  config?: Partial<PlyConverterConfig>
): Promise<Blob>;
export function convertPlyToUsdz(
  input: ArrayBuffer | string,
  config: Partial<PlyConverterConfig> | undefined,
  options: ConvertOptions & { outputPath: string }
): Promise<UsdzStreamResult>;
export async function convertPlyToUsdz(
  input: ArrayBuffer | string,
  config?: Partial<PlyConverterConfig>,
  options?: ConvertOptions
): Promise<Blob | UsdzStreamResult> {
  const logger = LoggerFactory.forConversion();

  try {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    logger.info('Starting PLY to USDZ conversion', {
      stage: 'conversion_start',
      inputType: typeof input === 'string' ? 'ply_file' : 'ply_buffer',
    });

    // Parse PLY
    let meshData: PlyMeshData;
    if (typeof input === 'string') {
      meshData = await parsePlyFile(input, { debug: finalConfig.debug });
    } else {
      meshData = parsePly(input, { debug: finalConfig.debug });
    }

    logger.info('PLY parsed', {
      stage: 'ply_parsed',
      format: meshData.format,
      vertexCount: meshData.vertexCount,
      faceCount: meshData.faceCount,
      isPointCloud: meshData.isPointCloud,
      hasNormals: !!meshData.normals,
      hasColors: !!meshData.colors,
      hasTexCoords: !!meshData.texCoords,
    });

    // Downsample point clouds if maxPoints is set
    if (meshData.isPointCloud && finalConfig.maxPoints > 0) {
      const before = meshData.vertexCount;
      meshData = downsamplePointCloud(meshData, finalConfig.maxPoints);
      if (meshData.vertexCount < before) {
        logger.info('Point cloud downsampled', {
          stage: 'downsample',
          before,
          after: meshData.vertexCount,
          reductionPercent: ((1 - meshData.vertexCount / before) * 100).toFixed(1) + '%',
        });
      }
    }

    // Center geometry
    centerGeometry(meshData);

    // Decimate mesh if requested and applicable
    if (!meshData.isPointCloud && finalConfig.decimateTarget > 0 && meshData.faceCount > finalConfig.decimateTarget) {
      const beforeVerts = meshData.vertexCount;
      const beforeFaces = meshData.faceCount;

      logger.info('Starting mesh decimation', {
        stage: 'decimation',
        targetFaces: finalConfig.decimateTarget,
        inputVertices: beforeVerts,
        inputFaces: beforeFaces,
      });

      const decimated = decimateMesh(
        meshData.positions,
        meshData.faceIndices!,
        meshData.colors ?? undefined,
        finalConfig.decimateTarget,
        meshData.bounds
      );

      // Update meshData with decimated result
      meshData.positions = decimated.positions;
      meshData.faceIndices = decimated.indices;
      meshData.faceVertexCounts = decimated.faceVertexCounts;
      meshData.normals = decimated.normals;
      meshData.vertexCount = decimated.vertexCount;
      meshData.faceCount = decimated.faceCount;
      meshData.bounds = decimated.bounds;
      if (decimated.colors) meshData.colors = decimated.colors;

      logger.info('Mesh decimation complete', {
        stage: 'decimation',
        outputVertices: decimated.vertexCount,
        outputFaces: decimated.faceCount,
        vertexReduction: ((1 - decimated.vertexCount / beforeVerts) * 100).toFixed(1) + '%',
        faceReduction: ((1 - decimated.faceCount / beforeFaces) * 100).toFixed(1) + '%',
      });
    }

    // Build USD scene
    const rootStructure = createRootStructure('ply_scene');
    const { rootNode, sceneNode, materialsNode } = rootStructure;

    // Build geometry node
    let geomNode: UsdNode;
    if (meshData.isPointCloud) {
      geomNode = buildPointsNode(
        meshData,
        `${sceneNode.getPath()}/PlyPoints`,
        finalConfig.defaultPointWidth
      );
    } else {
      geomNode = buildMeshNode(
        meshData,
        `${sceneNode.getPath()}/PlyMesh`
      );
    }

    sceneNode.addChild(geomNode);

    // Create and bind material
    const materialPath = `${materialsNode.getPath()}/PlyMaterial`;
    const materialNode = createBasicMaterial(
      materialPath,
      finalConfig.defaultColor,
      !!meshData.colors
    );
    materialsNode.addChild(materialNode);

    geomNode.setProperty(
      USD_PROPERTIES.PREPEND_API_SCHEMAS,
      [USD_PROPERTIES.MATERIAL_BINDING_API],
      USD_PROPERTY_TYPES.STRING_ARRAY
    );
    geomNode.setProperty(
      USD_PROPERTIES.MATERIAL_BINDING,
      `<${materialPath}>`,
      USD_PROPERTY_TYPES.REL
    );

    rootNode.addChild(materialsNode);

    logger.info('USD scene built', {
      stage: 'usd_built',
      primType: meshData.isPointCloud ? 'Points' : 'Mesh',
    });

    // Package — pass both the serialized USDA text and the source UsdNode
    // tree so the packager can opt into USDC root layers when the caller
    // asks for it. With layerFormat undefined or 'usda' (the default), the
    // tree is ignored and the text path runs unchanged.
    const packageContent: PackageContent = {
      usdContent: rootNode.serializeToUsda(),
      usdContentNode: rootNode,
      geometryFiles: new Map(),
      textureFiles: new Map(),
    };

    if (options?.outputPath) {
      const result = await createUsdzPackageToFile(packageContent, options.outputPath, {
        ...(options.layerFormat ? { layerFormat: options.layerFormat } : {}),
      });
      logger.info('USDZ conversion completed', {
        stage: 'conversion_complete',
        usdzSize: result.totalBytes,
        mode: 'streaming',
        outputPath: options.outputPath,
      });
      return result;
    }

    const usdzBlob = await createUsdzPackage(
      packageContent,
      options?.layerFormat ? { layerFormat: options.layerFormat } : undefined
    );

    logger.info('USDZ conversion completed', {
      stage: 'conversion_complete',
      usdzSize: usdzBlob.size,
    });

    // Debug output
    if (finalConfig.debug) {
      const debugContent: DebugOutputContent = {
        usdContent: rootNode.serializeToUsda(),
        geometryFiles: new Map(),
        textureFiles: new Map(),
        usdzBlob,
      };
      await writeDebugOutput(finalConfig.debugOutputDir, debugContent);
    }

    return usdzBlob;

  } catch (error) {
    logger.error('PLY to USDZ conversion failed', {
      stage: 'conversion_error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
