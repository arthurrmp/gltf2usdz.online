/** WebUsdFramework.Converters.Stl.StlConverter - Main orchestration class for ASCII/Binary STL to USDZ */

import { StlConverterConfig } from '../../schemas';
import { LoggerFactory } from '../../utils';
import { parseStl, parseStlFile, StlMeshData } from './stl-parser';
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
import { isDirectory, findStlFiles, getBasenameWithoutExt } from '../../utils/file-utils';
import * as fs from 'fs';

// Default configuration
const DEFAULT_CONFIG: Required<StlConverterConfig> = {
  debug: false,
  debugOutputDir: './debug-output',
  upAxis: 'Y',
  metersPerUnit: 1,
  optimizeMesh: false,
  defaultColor: [0.7, 0.7, 0.7], // Light gray
  autoComputeNormals: true
};

/**
 * Merge duplicate vertices in STL mesh data
 * STL files often have duplicate vertices - each triangle stores 3 verts independently
 * This function deduplicates them to massively reduce file size
 */
function mergeStlVertices(meshData: StlMeshData): {
  points: Float32Array;
  faceVertexIndices: Int32Array;
  normals: Float32Array;
  colors?: Float32Array | undefined;
  uniqueVertexCount: number;
} {
  const { vertices, normals, colors, triangleCount } = meshData;

  // Map to track unique vertices: "x,y,z" -> index
  const vertexMap = new Map<string, number>();
  const uniquePoints: number[] = [];
  const faceIndices: number[] = [];

  // Per-vertex normals (will average normals for shared vertices)
  const vertexNormals = new Map<number, number[]>();
  const vertexColors = colors ? new Map<number, number[]>() : undefined;

  let uniqueIndex = 0;

  // Process each triangle
  for (let t = 0; t < triangleCount; t++) {
    const faceNormalIdx = t * 3;
    const faceColorIdx = t * 3;

    // Process each vertex of the triangle
    for (let v = 0; v < 3; v++) {
      const vertIdx = (t * 3 + v) * 3;

      // Create vertex key with reasonable precision (1e-6)
      const x = vertices[vertIdx];
      const y = vertices[vertIdx + 1];
      const z = vertices[vertIdx + 2];
      const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;

      let index = vertexMap.get(key);

      if (index === undefined) {
        // New unique vertex
        index = uniqueIndex++;
        vertexMap.set(key, index);
        uniquePoints.push(x, y, z);

        // Initialize normal accumulator
        vertexNormals.set(index, [
          normals[faceNormalIdx],
          normals[faceNormalIdx + 1],
          normals[faceNormalIdx + 2]
        ]);

        // Initialize color if available
        if (colors && vertexColors) {
          vertexColors.set(index, [
            colors[faceColorIdx],
            colors[faceColorIdx + 1],
            colors[faceColorIdx + 2]
          ]);
        }
      } else {
        // Vertex already exists - accumulate normal for averaging
        const existingNormal = vertexNormals.get(index)!;
        existingNormal[0] += normals[faceNormalIdx];
        existingNormal[1] += normals[faceNormalIdx + 1];
        existingNormal[2] += normals[faceNormalIdx + 2];
      }

      faceIndices.push(index);
    }
  }

  // Normalize accumulated normals
  const finalNormals = new Float32Array(uniqueIndex * 3);
  for (let i = 0; i < uniqueIndex; i++) {
    const normal = vertexNormals.get(i)!;
    const len = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
    const scale = len > 0 ? 1 / len : 0;

    finalNormals[i * 3] = normal[0] * scale;
    finalNormals[i * 3 + 1] = normal[1] * scale;
    finalNormals[i * 3 + 2] = normal[2] * scale;
  }

  // Build final color array if needed
  let finalColors: Float32Array | undefined;
  if (vertexColors) {
    finalColors = new Float32Array(uniqueIndex * 3);
    for (let i = 0; i < uniqueIndex; i++) {
      const color = vertexColors.get(i)!;
      finalColors[i * 3] = color[0];
      finalColors[i * 3 + 1] = color[1];
      finalColors[i * 3 + 2] = color[2];
    }
  }

  return {
    points: new Float32Array(uniquePoints),
    faceVertexIndices: new Int32Array(faceIndices),
    normals: finalNormals,
    colors: finalColors,
    uniqueVertexCount: uniqueIndex
  };
}

/**
 * Convert STL mesh data to USD geometry (optimized for large meshes)
 * Stores TypedArrays directly to avoid memory overhead
 */
function convertStlMeshToUsdGeometry(
  meshData: StlMeshData,
  meshNode: UsdNode,
  logger: any
): void {
  const { triangleCount } = meshData;
  const originalVertexCount = meshData.vertices.length / 3;

  // CRITICAL FIX: Deduplicate vertices to reduce file size
  logger.info('Merging duplicate vertices', {
    originalVertexCount,
    triangleCount
  });

  const merged = mergeStlVertices(meshData);
  const reductionPercent = ((1 - merged.uniqueVertexCount / originalVertexCount) * 100).toFixed(1);

  logger.info('Vertex deduplication complete', {
    originalVertices: originalVertexCount,
    uniqueVertices: merged.uniqueVertexCount,
    duplicatesRemoved: originalVertexCount - merged.uniqueVertexCount,
    reductionPercent: `${reductionPercent}%`
  });

  // Store deduplicated geometry
  meshNode.setProperty('point3f[] points', merged.points);
  meshNode.setProperty('int[] faceVertexIndices', merged.faceVertexIndices);

  // Face vertex counts - all 3s for triangles
  const faceVertexCounts = new Int32Array(triangleCount);
  faceVertexCounts.fill(3);
  meshNode.setProperty('int[] faceVertexCounts', faceVertexCounts);

  // Averaged & normalized normals
  meshNode.setProperty('normal3f[] normals', merged.normals);
  meshNode.setProperty('uniform token primvars:normals:interpolation', 'vertex', 'raw');

  // Vertex colors if available
  if (merged.colors) {
    meshNode.setProperty('color3f[] primvars:displayColor', merged.colors);
    meshNode.setProperty('uniform token primvars:displayColor:interpolation', 'vertex', 'raw');
  }

  // Extent (bounding box)
  const { min, max } = meshData.bounds;
  const formatFloat = (n: number): string => n.toFixed(6);
  const extentStr = `[(${formatFloat(min.x)}, ${formatFloat(min.y)}, ${formatFloat(min.z)}), (${formatFloat(max.x)}, ${formatFloat(max.y)}, ${formatFloat(max.z)})]`;
  meshNode.setProperty('float3[] extent', extentStr, 'raw');
}

/**
 * Create a basic USD material node
 */
function createBasicMaterial(
  materialPath: string,
  color: [number, number, number],
  hasVertexColors: boolean
): UsdNode {
  const materialNode = new UsdNode(materialPath, 'Material');
  const surfaceShader = new UsdNode(`${materialPath}/PreviewSurface`, 'Shader');

  surfaceShader.setProperty('uniform token info:id', 'UsdPreviewSurface');

  // Set diffuse color
  if (!hasVertexColors) {
    surfaceShader.setProperty(
      'color3f inputs:diffuseColor',
      `(${color[0]}, ${color[1]}, ${color[2]})`,
      'color3f'
    );
  }

  // Set material properties for 3D printed look
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
 * Main STL to USDZ conversion function
 */
export function convertStlToUsdz(
  input: ArrayBuffer | string,
  config?: Partial<StlConverterConfig>
): Promise<Blob>;
export function convertStlToUsdz(
  input: ArrayBuffer | string,
  config: Partial<StlConverterConfig> | undefined,
  options: ConvertOptions & { outputPath: string }
): Promise<UsdzStreamResult>;
export async function convertStlToUsdz(
  input: ArrayBuffer | string,
  config?: Partial<StlConverterConfig>,
  options?: ConvertOptions
): Promise<Blob | UsdzStreamResult> {
  const logger = LoggerFactory.forConversion();

  try {
    // Merge config with defaults
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    logger.info('Starting STL to USDZ conversion', {
      stage: 'conversion_start',
      inputType: typeof input === 'string' ? 'stl_file' : 'stl_buffer',
      bufferSize: typeof input === 'string' ? 'N/A' : input.byteLength
    });

    // Detect if input is a folder with multiple STLs or a single file/buffer
    let stlFilesToProcess: { path?: string; buffer?: ArrayBuffer; name: string }[] = [];

    if (typeof input === 'string' && isDirectory(input)) {
      // Folder mode: Process each STL individually and save separate USDZ files
      const stlFiles = findStlFiles(input);

      if (stlFiles.length === 0) {
        throw new Error(`No STL files found in directory: ${input}`);
      }

      logger.info('Detected folder with multiple STL files - batch mode', {
        stage: 'folder_detection',
        folderPath: input,
        fileCount: stlFiles.length
      });

      // Ensure output directory exists
      const outputDir = finalConfig.debugOutputDir || './output';
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      logger.info('Processing STL files individually', {
        stage: 'batch_processing',
        outputDir,
        count: stlFiles.length
      });

      // Process each STL file as a separate conversion
      for (const stlPath of stlFiles) {
        const baseName = getBasenameWithoutExt(stlPath);

        logger.info(`Converting ${baseName}.stl`, {
          stage: 'individual_conversion',
          file: baseName
        });

        // Recursively call this function for the single file
        const usdzBlob = await convertStlToUsdz(stlPath, {
          ...config,
          debug: false // Disable debug for individual files to reduce output
        });

        // Save to output directory with original filename
        const outputPath = `${outputDir}/${baseName}.usdz`;
        const buffer = Buffer.from(await usdzBlob.arrayBuffer());
        fs.writeFileSync(outputPath, buffer);

        logger.info(`Saved ${baseName}.usdz`, {
          stage: 'file_saved',
          path: outputPath,
          size: buffer.length
        });
      }

      logger.info('Batch conversion complete', {
        stage: 'batch_complete',
        filesGenerated: stlFiles.length,
        outputDir
      });

      // Return a summary blob
      return new Blob([`Batch conversion complete. ${stlFiles.length} USDZ files generated in ${outputDir}/`], {
        type: 'text/plain'
      });
    }

    // Single file/buffer mode - continue with normal processing
    if (typeof input === 'string') {
      stlFilesToProcess = [{ path: input, name: 'StlMesh' }];
    } else {
      stlFilesToProcess = [{ buffer: input, name: 'StlMesh' }];
    }

    // Parse all STL files
    logger.info('Parsing STL files', {
      stage: 'stl_parsing',
      count: stlFilesToProcess.length
    });

    const meshDataArray: { data: StlMeshData; name: string }[] = [];

    for (const stlFile of stlFilesToProcess) {
      let meshData: StlMeshData;

      if (stlFile.path) {
        meshData = await parseStlFile(stlFile.path, {
          debug: finalConfig.debug,
          validateNormals: true,
          autoComputeNormals: finalConfig.autoComputeNormals
        });
      } else if (stlFile.buffer) {
        meshData = parseStl(stlFile.buffer, {
          debug: finalConfig.debug,
          validateNormals: true,
          autoComputeNormals: finalConfig.autoComputeNormals
        });
      } else {
        continue;
      }

      meshDataArray.push({ data: meshData, name: stlFile.name });

      logger.info('STL parsed successfully', {
        stage: 'stl_parsing',
        name: stlFile.name,
        format: meshData.format,
        triangleCount: meshData.triangleCount,
        vertexCount: meshData.vertices.length / 3,
        hasColors: !!meshData.colors
      });
    }

    // Center the geometry at the origin
    logger.info('Centering geometry', { stage: 'centering' });

    for (const { data: meshData, name } of meshDataArray) {
      const { vertices } = meshData;

      // Find bounding box
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      for (let i = 0; i < vertices.length; i += 3) {
        minX = Math.min(minX, vertices[i]);
        minY = Math.min(minY, vertices[i + 1]);
        minZ = Math.min(minZ, vertices[i + 2]);
        maxX = Math.max(maxX, vertices[i]);
        maxY = Math.max(maxY, vertices[i + 1]);
        maxZ = Math.max(maxZ, vertices[i + 2]);
      }

      // Calculate center offset
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const centerZ = (minZ + maxZ) / 2;

      logger.info(`Centering ${name}`, {
        stage: 'centering',
        center: [centerX.toFixed(2), centerY.toFixed(2), centerZ.toFixed(2)]
      });

      // Apply centering to all vertices
      for (let i = 0; i < vertices.length; i += 3) {
        vertices[i] -= centerX;
        vertices[i + 1] -= centerY;
        vertices[i + 2] -= centerZ;
      }

      // Update bounds
      meshData.bounds = {
        min: { x: minX - centerX, y: minY - centerY, z: minZ - centerZ },
        max: { x: maxX - centerX, y: maxY - centerY, z: maxZ - centerZ }
      };
    }

    // Create root structure
    const rootStructure = createRootStructure('stl_scene');
    const { rootNode, sceneNode, materialsNode } = rootStructure;

    // Apply Z-up to Y-up rotation (standard for STL)
    // This rotates -90 degrees around X axis to convert Z-up geometry to Y-up USD world
    sceneNode.setProperty('double xformOp:rotateX', -90, 'double');
    sceneNode.setProperty('xformOpOrder', ['xformOp:rotateX'], 'token[]');

    // For multi-part models, merge all geometry into a single mesh
    let finalMeshData: StlMeshData;

    if (meshDataArray.length > 1) {
      logger.info('Merging multi-part STL into single mesh', {
        stage: 'mesh_merging',
        partCount: meshDataArray.length
      });

      // First pass: calculate total sizes
      let totalVertices = 0;
      let totalNormals = 0;
      let totalTriangles = 0;
      let hasAnyColors = false;

      for (const { data } of meshDataArray) {
        totalVertices += data.vertices.length;
        totalNormals += data.normals.length;
        totalTriangles += data.triangleCount;
        if (data.colors) hasAnyColors = true;
      }

      // Pre-allocate merged arrays (much faster than push)
      const mergedVertices: number[] = new Array(totalVertices);
      const mergedNormals: number[] = new Array(totalNormals);
      const mergedColors: number[] | undefined = hasAnyColors ? new Array(totalTriangles * 3) : undefined;

      let vertexOffset = 0;
      let normalOffset = 0;
      let colorOffset = 0;

      // Second pass: copy geometry in chunks
      for (const { data, name } of meshDataArray) {
        const { vertices, normals, colors, triangleCount } = data;

        // Copy vertices
        for (let i = 0; i < vertices.length; i++) {
          mergedVertices[vertexOffset++] = vertices[i];
        }

        // Copy normals
        for (let i = 0; i < normals.length; i++) {
          mergedNormals[normalOffset++] = normals[i];
        }

        // Handle colors
        if (mergedColors) {
          if (colors) {
            for (let i = 0; i < colors.length; i++) {
              mergedColors[colorOffset++] = colors[i];
            }
          } else {
            // Fill with default gray (0.7, 0.7, 0.7) for each triangle
            for (let i = 0; i < triangleCount; i++) {
              mergedColors[colorOffset++] = 0.7;
              mergedColors[colorOffset++] = 0.7;
              mergedColors[colorOffset++] = 0.7;
            }
          }
        }

        logger.info(`Merged part: ${name}`, {
          stage: 'mesh_merging',
          triangles: triangleCount
        });
      }

      // Create combined mesh data
      finalMeshData = {
        vertices: mergedVertices,
        normals: mergedNormals,
        colors: mergedColors,
        triangleCount: totalTriangles,
        format: 'binary',
        bounds: meshDataArray[0].data.bounds // Use first part's bounds (will be recomputed later if needed)
      };

      logger.info('Multi-part merge complete', {
        stage: 'mesh_merging',
        totalTriangles,
        totalVertices: mergedVertices.length / 3,
        hasColors: !!mergedColors
      });

      // Center the merged geometry
      logger.info('Centering merged geometry', { stage: 'centering' });

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      // Find bounding box
      for (let i = 0; i < mergedVertices.length; i += 3) {
        minX = Math.min(minX, mergedVertices[i]);
        minY = Math.min(minY, mergedVertices[i + 1]);
        minZ = Math.min(minZ, mergedVertices[i + 2]);
        maxX = Math.max(maxX, mergedVertices[i]);
        maxY = Math.max(maxY, mergedVertices[i + 1]);
        maxZ = Math.max(maxZ, mergedVertices[i + 2]);
      }

      // Calculate center offset
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const centerZ = (minZ + maxZ) / 2;

      logger.info('Centering offset', {
        stage: 'centering',
        bounds: { min: [minX.toFixed(2), minY.toFixed(2), minZ.toFixed(2)], max: [maxX.toFixed(2), maxY.toFixed(2), maxZ.toFixed(2)] },
        center: [centerX.toFixed(2), centerY.toFixed(2), centerZ.toFixed(2)]
      });

      // Apply centering to all vertices
      for (let i = 0; i < mergedVertices.length; i += 3) {
        mergedVertices[i] -= centerX;
        mergedVertices[i + 1] -= centerY;
        mergedVertices[i + 2] -= centerZ;
      }

      // Create combined mesh data
      finalMeshData = {
        vertices: mergedVertices,
        normals: mergedNormals,
        colors: mergedColors,
        triangleCount: totalTriangles,
        format: 'binary',
        bounds: {
          min: { x: minX - centerX, y: minY - centerY, z: minZ - centerZ },
          max: { x: maxX - centerX, y: maxY - centerY, z: maxZ - centerZ }
        }
      };
    } else {
      // Single STL - use as-is
      finalMeshData = meshDataArray[0].data;
    }

    // Convert mesh data to USD geometry
    logger.info('Building USD geometry', {
      stage: 'geometry_building',
      triangleCount: finalMeshData.triangleCount
    });

    // Create single mesh node
    const meshPath = `${sceneNode.getPath()}/StlMesh`;
    const meshNode = new UsdNode(meshPath, 'Mesh');

    // Write geometry properties
    convertStlMeshToUsdGeometry(finalMeshData, meshNode, logger);

    // Set subdivision scheme
    meshNode.setProperty('uniform token subdivisionScheme', 'none', 'raw');

    // Add mesh to scene
    sceneNode.addChild(meshNode);

    // Create shared material
    logger.info('Creating material', {
      stage: 'material_creation',
      hasVertexColors: !!finalMeshData.colors
    });

    const materialName = 'StlMaterial';
    const materialPath = `${materialsNode.getPath()}/${materialName}`;
    const materialNode = createBasicMaterial(
      materialPath,
      finalConfig.defaultColor,
      !!finalMeshData.colors
    );

    materialsNode.addChild(materialNode);

    // Bind material to mesh
    meshNode.setProperty(
      USD_PROPERTIES.PREPEND_API_SCHEMAS,
      [USD_PROPERTIES.MATERIAL_BINDING_API],
      USD_PROPERTY_TYPES.STRING_ARRAY
    );
    meshNode.setProperty(
      USD_PROPERTIES.MATERIAL_BINDING,
      `<${materialPath}>`,
      USD_PROPERTY_TYPES.REL
    );

    // Add materials to root
    rootNode.addChild(materialsNode);

    logger.info('Material bound', {
      stage: 'material_binding',
      materialPath
    });

    // Create USDZ package
    logger.info('Generating USDZ package', {
      stage: 'usdz_packaging'
    });

    const packageContent: PackageContent = {
      usdContent: rootNode.serializeToUsda(),
      geometryFiles: new Map(), // Embedded geometry
      textureFiles: new Map() // No textures for STL
    };

    if (options?.outputPath) {
      const result = await createUsdzPackageToFile(packageContent, options.outputPath);
      logger.info('USDZ conversion completed', {
        stage: 'conversion_complete',
        usdzSize: result.totalBytes,
        mode: 'streaming',
        outputPath: options.outputPath
      });
      return result;
    }

    const usdzBlob = await createUsdzPackage(packageContent);

    logger.info('USDZ conversion completed', {
      stage: 'conversion_complete',
      usdzSize: usdzBlob.size
    });

    // Write debug output if enabled
    if (finalConfig.debug) {
      const debugContent: DebugOutputContent = {
        usdContent: rootNode.serializeToUsda(),
        geometryFiles: new Map(),
        textureFiles: new Map(),
        usdzBlob
      };

      await writeDebugOutput(finalConfig.debugOutputDir, debugContent);
    }

    return usdzBlob;

  } catch (error) {
    logger.error('STL to USDZ conversion failed', {
      stage: 'conversion_error',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
