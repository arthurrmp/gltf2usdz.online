/** WebUsdFramework.Interfaces.Index - Core interface contracts for converter pipeline */

/**
 * WebUSD Configuration Interface
 */
export interface WebUsdConfig {
  debug?: boolean;
  debugOutputDir?: string;
  upAxis?: 'Y' | 'Z';
  metersPerUnit?: number;
}

/**
 * GLTF-Transform Converter Configuration Interface
 */
export interface GltfTransformConfig {
  debug?: boolean;
  debugOutputDir?: string;
  upAxis?: 'Y' | 'Z';
  metersPerUnit?: number;
}

/**
 * USDZ Generation Options Interface
 */
export interface UsdzGenerationOptions {
  compression?: 'STORE' | 'DEFLATE';
  mimeType?: string;
  alignment?: number;
}

/**
 * Debug Output Interface
 */
export interface DebugOutput {
  enabled: boolean;
  outputDir: string;
  includeTextures: boolean;
  includeMaterials: boolean;
  includeGeometries: boolean;
  includeScene: boolean;
}
