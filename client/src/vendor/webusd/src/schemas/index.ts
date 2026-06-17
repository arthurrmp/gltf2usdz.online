/** WebUsdFramework.Schemas.Index - USDA prim schema builders and assembly functions */

import { z } from 'zod';
import { DEFAULT_CONFIG } from '../constants/config';
import { UpAxisSchema, CompressionSchema } from './base-schemas';

/**
 * GLTF Preprocessing Options Schema
 */
export const GltfPreprocessOptionsSchema = z.object({
  dequantize: z.boolean().optional().default(true),
  generateNormals: z.boolean().optional().default(true),
  prune: z.boolean().optional().default(false),
  dedup: z.boolean().optional().default(false),
  logBounds: z.boolean().optional().default(false),
  weld: z.boolean().optional().default(false),
  center: z.union([z.boolean(), z.enum(['center', 'above', 'below'])]).optional().default(false),
  resample: z.boolean().optional().default(false),
  unlit: z.boolean().optional().default(false),
  flatten: z.boolean().optional().default(false),
  metalRough: z.boolean().optional().default(false),
  vertexColorSpace: z.enum(['srgb', 'srgb-linear']).optional(),
  join: z.boolean().optional().default(false),
});

/**
 * WebUSD Configuration Schema
 */
export const WebUsdConfigSchema = z.object({
  debug: z.boolean().optional().default(false),
  debugOutputDir: z.string().optional().default('./debug-output'),
  upAxis: UpAxisSchema.optional().default('Y'),
  metersPerUnit: z.number().positive().optional().default(1),
  preprocess: GltfPreprocessOptionsSchema.optional(),
});

/**
 * GLTF-Transform Converter Configuration Schema
 */
export const GltfTransformConfigSchema = z.object({
  debug: z.boolean().optional().default(false),
  debugOutputDir: z.string().optional().default('./debug-output'),
  upAxis: UpAxisSchema.optional().default('Y'),
  metersPerUnit: z.number().positive().optional().default(1),
  preprocess: GltfPreprocessOptionsSchema.optional(),
});

/**
 * USDZ Generation Options Schema
 */
export const UsdzGenerationOptionsSchema = z.object({
  compression: CompressionSchema.optional().default('STORE'),
  mimeType: z.string().optional().default('model/vnd.usdz+zip'),
  alignment: z.number().positive().optional().default(DEFAULT_CONFIG.ALIGNMENT),
});

/**
 * Debug Output Schema
 */
export const DebugOutputSchema = z.object({
  enabled: z.boolean(),
  outputDir: z.string().min(1, 'Output directory cannot be empty'),
  includeTextures: z.boolean().default(true),
  includeMaterials: z.boolean().default(true),
  includeGeometries: z.boolean().default(true),
  includeScene: z.boolean().default(true),
});

/**
 * File Path Schema
 */
export const FilePathSchema = z.string()
  .min(1, 'File path cannot be empty')
  .regex(/^[a-zA-Z0-9_\/\-\.]+$/, 'File path contains invalid characters');

/**
 * Directory Path Schema
 */
export const DirectoryPathSchema = z.string()
  .min(1, 'Directory path cannot be empty')
  .regex(/^[a-zA-Z0-9_\/\-\.]+$/, 'Directory path contains invalid characters');

/**
 * USD Path Schema (re-exported from validation.ts)
 */
export const UsdPathSchema = z.string()
  .min(1, 'USD path cannot be empty')
  .regex(/^\/[a-zA-Z0-9_\/]*$/, 'USD path must start with / and contain only alphanumeric characters, underscores, and forward slashes');

/**
 * USD Attribute Value Schema
 */
export const UsdAttributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.number()),
  z.array(z.string()),
  z.record(z.string(), z.unknown())
]);

/**
 * Type exports for TypeScript inference
 */
export type WebUsdConfig = z.infer<typeof WebUsdConfigSchema>;
export type GltfPreprocessOptions = z.infer<typeof GltfPreprocessOptionsSchema>;
export type GltfTransformConfig = z.infer<typeof GltfTransformConfigSchema>;
export type UsdzGenerationOptions = z.infer<typeof UsdzGenerationOptionsSchema>;
export type DebugOutput = z.infer<typeof DebugOutputSchema>;
export type FilePath = z.infer<typeof FilePathSchema>;
export type DirectoryPath = z.infer<typeof DirectoryPathSchema>;
export type UsdPath = z.infer<typeof UsdPathSchema>;
export type UsdAttributeValue = z.infer<typeof UsdAttributeValueSchema>;

// Re-export base schemas
export { UpAxisSchema, CompressionSchema } from './base-schemas';

// Re-export OBJ schemas
export { ObjConverterConfigSchema, type ObjConverterConfig } from './obj-schemas';

// Re-export STL schemas
export { StlConverterConfigSchema, type StlConverterConfig } from './stl-schemas';

// Re-export PLY schemas
export { PlyConverterConfigSchema, type PlyConverterConfig } from './ply-schemas';

