/** WebUsdFramework.Converters.Gltf.Extensions.ExtensionProcessor - Dispatcher for executing registered GLTF extensions */

import { Material } from '@gltf-transform/core';
import { TextureReference } from '../../shared/usd-material-builder';

/**
 * Context for extension processing
 */
export interface ExtensionProcessingContext {
  /** Material being processed */
  material: Material;
  /** Material name (sanitized) */
  materialName: string;
  /** Material path in USD hierarchy */
  materialPath: string;
  /** Base color texture (if exists) */
  baseColorTexture: any | null;
  /** Existing textures array to append to */
  textures: TextureReference[];
}

/**
 * Material properties extracted from extensions (non-texture properties)
 */
export interface MaterialProperties {
  /** Emissive strength factor */
  emissiveStrength?: number;
  /** Dispersion factor */
  dispersion?: number;
  /** Index of refraction */
  ior?: number;
  /** Whether material is unlit */
  unlit?: boolean;
  /** Additional custom properties */
  [key: string]: unknown;
}

/**
 * Result of extension processing
 */
export interface ExtensionProcessingResult {
  /** Additional textures extracted from extension */
  textures: TextureReference[];
  /** Material properties extracted from extension (non-texture) */
  properties?: MaterialProperties;
  /** Whether the extension was successfully processed */
  processed: boolean;
  /** Optional error message if processing failed */
  error?: string;
}

/**
 * Base interface for extension processors
 */
export interface IExtensionProcessor {
  /** Extension name (e.g., 'KHR_materials_pbrSpecularGlossiness') */
  readonly extensionName: string;

  /**
   * Check if this processor can handle the given material
   */
  canProcess(material: Material): boolean;

  /**
   * Process the extension and extract textures
   * @param context Processing context with material and related data
   * @returns Processing result with extracted textures
   */
  process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult>;
}

