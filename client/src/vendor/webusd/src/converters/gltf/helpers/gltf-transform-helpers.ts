/** WebUsdFramework.Converters.Gltf.Helpers.GltfTransformHelpers - Wrapper utilities over @gltf-transform/core functions */

import { Document } from '@gltf-transform/core';
import {
  dequantize,
  normals,
  prune,
  dedup,
  getBounds,
  weld,
  center,
  resample,
  unlit,
  flatten,
  metalRough,
  vertexColorSpace,
  join
} from '@gltf-transform/functions';
import { Logger } from '../../../utils';

/**
 * Options for GLTF preprocessing transforms
 * 
 * These options control preprocessing operations from @gltf-transform/functions
 * that are applied to the GLTF document before conversion to USDZ.
 * 
 */
export interface GltfPreprocessOptions {
  /**
   * Dequantize mesh attributes (remove KHR_mesh_quantization)
   * 
   * Converts quantized vertex attributes to float32 for USDZ compatibility.
   * This is important because USDZ requires float32 attributes.
   * 
   * @default true
   */
  dequantize?: boolean;

  /**
   * Generate normals if missing
   * 
   * Generates flat vertex normals for mesh primitives that don't have them.
   * USD requires normals for proper lighting calculations.
   * 
   * @default true
   */
  generateNormals?: boolean;

  /**
   * Weld vertices (merge identical vertices for optimization)
   * 
   * Merges bitwise identical vertices to reduce file size and improve
   * GPU vertex cache efficiency. When merged and indexed, data is shared
   * more efficiently between vertices.
   * 
   * @default false
   */
  weld?: boolean;

  /**
   * Remove duplicate resources
   * 
   * Removes duplicate Accessor, Mesh, Texture, and Material properties.
   * This helps reduce file size by deduplicating identical resources.
   * 
   * @default false
   */
  dedup?: boolean;

  /**
   * Remove unused resources
   * 
   * Removes properties from the file if they are not referenced by a Scene.
   * Commonly helpful for cleaning up after other operations.
   * 
   * @default false
   */
  prune?: boolean;

  /**
   * Calculate and log bounds
   * 
   * Calculates bounding box (AABB) in world space for scenes and logs
   * the results. Useful for debugging and understanding model dimensions.
   * 
   * @default false
   */
  logBounds?: boolean;

  /**
   * Center model at origin
   * 
   * Centers the Scene at the origin, or above/below it. Transformations
   * from animation, skinning, and morph targets are not taken into account.
   * 
   * @default false
   * @example 'center' | 'above' | 'below' | false
   */
  center?: boolean | 'center' | 'above' | 'below';

  /**
   * Resample animations (optimize keyframes)
   * 
   * Resamples AnimationChannels, losslessly deduplicating keyframes to
   * reduce file size. Duplicate keyframes are commonly present in animation
   * 'baked' by authoring software.
   * 
   * @default false
   */
  resample?: boolean;

  /**
   * Convert unlit materials to standard PBR
   * 
   * Converts materials using KHR_materials_unlit extension to standard
   * PBR materials for better compatibility with USD PreviewSurface.
   * 
   * @default false
   */
  unlit?: boolean;

  /**
   * Flatten scene graph (may break animations)
   * 
   * Flattens the scene graph, leaving Nodes with Meshes, Cameras, and
   * other attachments as direct children of the Scene. Skeletons and their
   * descendants are left in their original Node structure.
   * 
   * ⚠️ Warning: Animation targeting a Node or its parents will prevent
   * that Node from being moved. Use with caution as it may break animations.
   * 
   * @default false
   */
  flatten?: boolean;

  /**
   * Convert spec/gloss materials to metal/rough PBR
   * 
   * Converts Materials from spec/gloss PBR workflow to metal/rough PBR workflow,
   * removing KHR_materials_pbrSpecularGlossiness and adding KHR_materials_ior
   * and KHR_materials_specular. The metal/rough PBR workflow is preferred
   * for most use cases and is a prerequisite for other advanced PBR extensions.
   * 
   * @default false
   */
  metalRough?: boolean;

  /**
   * Convert vertex colors color space
   * 
   * Vertex color color space correction. The glTF format requires vertex
   * colors to be stored in Linear Rec. 709 D65 color space. This function
   * provides a way to correct vertex colors that are (incorrectly) stored in sRGB.
   * 
   * @default undefined
   * @example 'srgb' | 'srgb-linear'
   */
  vertexColorSpace?: 'srgb' | 'srgb-linear' | undefined;

  /**
   * Join compatible primitives to reduce draw calls
   * 
   * Joins compatible Primitives and reduces draw calls. Primitives are eligible
   * for joining if they are members of the same Mesh or, optionally, attached
   * to sibling Nodes in the scene hierarchy.
   * 
   * For best results, apply dedup and flatten first to maximize the number
   * of Primitives that can be joined.
   * 
   * @default false
   */
  join?: boolean;
}

/**
 * Apply preprocessing transforms to GLTF document
 */
export async function preprocessGltfDocument(
  document: Document,
  options: GltfPreprocessOptions = {},
  logger: Logger
): Promise<Document> {
  const {
    dequantize: shouldDequantize = true,
    generateNormals: shouldGenerateNormals = true,
    prune: shouldPrune = false,
    dedup: shouldDedup = false,
    logBounds: shouldLogBounds = false,
    weld: shouldWeld = false,
    center: shouldCenter = false,
    resample: shouldResample = false,
    unlit: shouldUnlit = false,
    flatten: shouldFlatten = false,
    metalRough: shouldMetalRough = false,
    vertexColorSpace: vertexColorSpaceInput,
    join: shouldJoin = false
  } = options;

  // Dequantize mesh attributes (important for USDZ compatibility)
  if (shouldDequantize) {
    logger.info('Dequantizing mesh attributes', {
      stage: 'preprocessing',
      operation: 'dequantize'
    });
    await document.transform(dequantize());
  }

  // Generate normals if missing (USD requires normals for proper lighting)
  if (shouldGenerateNormals) {
    logger.info('Generating normals for meshes', {
      stage: 'preprocessing',
      operation: 'normals'
    });
    await document.transform(normals({ overwrite: false }));
  }

  // Weld vertices (merge identical vertices for optimization)
  if (shouldWeld) {
    logger.info('Welding vertices', {
      stage: 'preprocessing',
      operation: 'weld'
    });
    await document.transform(weld());
  }

  // Center model at origin
  if (shouldCenter) {
    const pivot = typeof shouldCenter === 'string' ? shouldCenter : 'center';
    logger.info('Centering model', {
      stage: 'preprocessing',
      operation: 'center',
      pivot
    });
    await document.transform(center({ pivot: pivot as 'center' | 'above' | 'below' }));
  }

  // Resample animations (optimize keyframes)
  if (shouldResample) {
    logger.info('Resampling animations', {
      stage: 'preprocessing',
      operation: 'resample'
    });
    await document.transform(resample());
  }

  // Convert unlit materials to standard PBR
  if (shouldUnlit) {
    logger.info('Converting unlit materials', {
      stage: 'preprocessing',
      operation: 'unlit'
    });
    await document.transform(unlit());
  }

  // Flatten scene graph (may break animations, use with caution)
  if (shouldFlatten) {
    logger.info('Flattening scene graph', {
      stage: 'preprocessing',
      operation: 'flatten',
      warning: 'This may break animations'
    });
    await document.transform(flatten());
  }

  // Convert spec/gloss materials to metal/rough PBR
  if (shouldMetalRough) {
    logger.info('Converting spec/gloss to metal/rough PBR', {
      stage: 'preprocessing',
      operation: 'metalRough'
    });
    await document.transform(metalRough());
  }

  // Convert vertex colors color space
  if (vertexColorSpaceInput) {
    logger.info('Converting vertex color space', {
      stage: 'preprocessing',
      operation: 'vertexColorSpace',
      inputColorSpace: vertexColorSpaceInput
    });
    await document.transform(vertexColorSpace({ inputColorSpace: vertexColorSpaceInput }));
  }

  // Join compatible primitives to reduce draw calls
  if (shouldJoin) {
    logger.info('Joining compatible primitives', {
      stage: 'preprocessing',
      operation: 'join'
    });
    await document.transform(join());
  }

  // Remove duplicate resources (optimization)
  if (shouldDedup) {
    logger.info('Removing duplicate resources', {
      stage: 'preprocessing',
      operation: 'dedup'
    });
    await document.transform(dedup());
  }

  // Remove unused resources (cleanup)
  if (shouldPrune) {
    logger.info('Pruning unused resources', {
      stage: 'preprocessing',
      operation: 'prune'
    });
    await document.transform(prune());
  }

  // Calculate and log bounds if requested
  if (shouldLogBounds) {
    const root = document.getRoot();
    const scenes = root.listScenes();
    for (const scene of scenes) {
      const bounds = getBounds(scene);
      logger.info('Scene bounds calculated', {
        stage: 'preprocessing',
        operation: 'getBounds',
        sceneName: scene.getName(),
        min: bounds.min,
        max: bounds.max
      });
    }
  }

  return document;
}

