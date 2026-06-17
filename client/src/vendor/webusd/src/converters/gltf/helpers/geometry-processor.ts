/** WebUsdFramework.Converters.Gltf.Helpers.GeometryProcessor - GLTF accessor unpacker and delegator to UsdGeometryBuilder */

import { Mesh } from '@gltf-transform/core';
import { buildUsdGeometry, wrapGeometryInUsdFile } from '../../shared/usd-geometry-builder';
import { buildGeometryPath, buildGeometryName } from '../../shared/usd-packaging';
import { PrimitiveMetadata } from './usd-hierarchy-builder';

/**
 * Geometry Processing Result
 */
export interface GeometryProcessingResult {
  primitiveMetadata: PrimitiveMetadata[];
  geometryFiles: Map<string, ArrayBuffer>;
  geometryCounter: number;
}

/**
 * Processes all meshes for embedded geometry approach
 * Instead of creating separate geometry files, we collect the data to embed directly in the main USD
 * This approach ensures optimal USDZ compatibility across different viewers and platforms
 */
export function processGeometries(meshes: Mesh[]): GeometryProcessingResult {
  // We're not creating separate files anymore - everything goes into the main USD
  const geometryFiles = new Map<string, ArrayBuffer>();
  const primitiveMetadata: PrimitiveMetadata[] = [];
  let geometryCounter = 0;

  for (const mesh of meshes) {
    const primitives = mesh.listPrimitives();

    for (let i = 0; i < primitives.length; i++) {
      // Process the primitive to collect geometry data for embedding
      // Data will be embedded directly in the main USD file for optimal compatibility
      const result = processPrimitive(mesh, i, geometryCounter);

      // Skip adding to geometryFiles - we're embedding everything in the main USD now
      // geometryFiles.set(result.filePath, result.buffer);
      primitiveMetadata.push(result.metadata);

      geometryCounter++;
    }
  }

  return {
    primitiveMetadata,
    geometryFiles, // Empty - all geometry data embedded in main USD
    geometryCounter
  };
}

/**
 * Process a single primitive
 */
interface PrimitiveProcessingResult {
  filePath: string;
  buffer: ArrayBuffer;
  metadata: PrimitiveMetadata;
}

function processPrimitive(
  mesh: Mesh,
  primitiveIndex: number,
  geometryCounter: number
): PrimitiveProcessingResult {
  const geometryName = buildGeometryName(geometryCounter);
  const geometryId = geometryName;

  // Generate geometry USD content
  const geometryResult = buildUsdGeometry(mesh, primitiveIndex);
  const geometryUsdContent = wrapGeometryInUsdFile(
    geometryResult.content,
    geometryName
  );

  // Encode to buffer
  const geometryBuffer = new TextEncoder().encode(geometryUsdContent).buffer;

  // Build file path
  const filePath = buildGeometryPath(geometryName);

  // Build metadata
  const metadata: PrimitiveMetadata = {
    mesh,
    primitiveIndex,
    geometryId,
    geometryName
  };

  return {
    filePath,
    buffer: geometryBuffer,
    metadata
  };
}

