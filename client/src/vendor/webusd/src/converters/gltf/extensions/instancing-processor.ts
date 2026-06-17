/** WebUsdFramework.Converters.Gltf.Extensions.InstancingProcessor - EXT_mesh_gpu_instancing processor translating to PointInstancer */

import { Node, Accessor } from '@gltf-transform/core';
import { InstancedMesh } from '@gltf-transform/extensions';
import { UsdNode } from '../../../core/usd-node';
import { formatUsdTuple3, formatUsdTuple4 } from '../../../utils/usd-formatter';

/**
 * Properties extracted from GPU instancing extension
 */
export interface InstancingProperties {
  instanceCount: number;
  translations?: Float32Array | undefined;
  rotations?: Float32Array | undefined;
  scales?: Float32Array | undefined;
  ids?: Uint8Array | Uint16Array | Uint32Array | undefined;
  customAttributes: Map<string, Accessor>;
}

/**
 * Extract instancing properties from GLTF node
 */
export function processInstancingExtension(node: Node): InstancingProperties | null {
  const instancedMesh = node.getExtension<InstancedMesh>('EXT_mesh_gpu_instancing');
  if (!instancedMesh) {
    return null;
  }

  const attributes = instancedMesh.listAttributes();
  const semantics = instancedMesh.listSemantics();

  if (attributes.length === 0) {
    return null;
  }

  // Get instance count from first attribute
  const firstAttribute = attributes[0];
  const instanceCount = firstAttribute.getCount();

  // Extract standard attributes
  let translations: Float32Array | undefined;
  let rotations: Float32Array | undefined;
  let scales: Float32Array | undefined;
  let ids: Uint8Array | Uint16Array | Uint32Array | undefined;

  const customAttributes = new Map<string, Accessor>();

  for (let i = 0; i < semantics.length; i++) {
    const semantic = semantics[i];
    const accessor = attributes[i];
    const array = accessor.getArray();

    if (!array) continue;

    switch (semantic) {
      case 'TRANSLATION':
        if (array instanceof Float32Array) {
          translations = array;
        }
        break;
      case 'ROTATION':
        if (array instanceof Float32Array) {
          rotations = array;
        }
        break;
      case 'SCALE':
        if (array instanceof Float32Array) {
          scales = array;
        }
        break;
      case '_ID':
        if (array instanceof Uint8Array || array instanceof Uint16Array || array instanceof Uint32Array) {
          ids = array;
        }
        break;
      default:
        // Custom attributes (prefixed with _)
        if (semantic.startsWith('_')) {
          customAttributes.set(semantic, accessor);
        }
        break;
    }
  }

  return {
    instanceCount,
    translations,
    rotations,
    scales,
    ids,
    customAttributes
  };
}

/**
 * Apply instancing to USD node using PointInstancer
 * Note: This creates a PointInstancer which requires the mesh to be referenced
 */
export function applyInstancingToUsdNode(
  usdNode: UsdNode,
  instancingProps: InstancingProperties,
  prototypePath: string
): void {
  const { instanceCount, translations, rotations, scales } = instancingProps;

  // Change node type to PointInstancer
  // Note: In USD, we need to create a PointInstancer that references the prototype mesh
  // For now, we'll add the instancing data as metadata and let the converter handle it
  // A full implementation would require restructuring to use PointInstancer prim type

  // Store instancing data as metadata for now
  // Full PointInstancer implementation would require:
  // 1. Creating a prototype mesh
  // 2. Creating a PointInstancer prim that references it
  // 3. Setting positions, orientations, scales, and ids

  usdNode.setMetadata('instancing:instanceCount', instanceCount);
  usdNode.setMetadata('instancing:prototypePath', prototypePath);

  if (translations) {
    const positions: string[] = [];
    for (let i = 0; i < translations.length; i += 3) {
      positions.push(formatUsdTuple3(translations[i], translations[i + 1], translations[i + 2]));
    }
    usdNode.setMetadata('instancing:positions', positions);
  }

  if (rotations) {
    const orientations: string[] = [];
    for (let i = 0; i < rotations.length; i += 4) {
      // USD uses quaternions as (x, y, z, w)
      orientations.push(formatUsdTuple4(rotations[i], rotations[i + 1], rotations[i + 2], rotations[i + 3]));
    }
    usdNode.setMetadata('instancing:orientations', orientations);
  }

  if (scales) {
    const scalesList: string[] = [];
    for (let i = 0; i < scales.length; i += 3) {
      scalesList.push(formatUsdTuple3(scales[i], scales[i + 1], scales[i + 2]));
    }
    usdNode.setMetadata('instancing:scales', scalesList);
  }

  if (instancingProps.ids) {
    const idsArray = Array.from(instancingProps.ids);
    usdNode.setMetadata('instancing:ids', idsArray);
  }

  // Log that instancing was detected
  console.log(`[InstancingProcessor] Detected GPU instancing: ${instanceCount} instances`);
}

