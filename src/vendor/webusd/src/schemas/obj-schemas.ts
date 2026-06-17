/** WebUsdFramework.Schemas.ObjSchemas - OBJ-specific USDA Mesh and material prim builders */

import { z } from 'zod';
import { UpAxisSchema } from './base-schemas';

/**
 * OBJ Converter Configuration Schema
 */
export const ObjConverterConfigSchema = z.object({
  debug: z.boolean().optional().default(false),
  debugOutputDir: z.string().optional().default('./debug-output'),
  upAxis: UpAxisSchema.optional().default('Y'),
  metersPerUnit: z.number().positive().optional().default(1),
  // Optional explicit MTL path override when mtllib cannot be resolved
  mtlPath: z.string().optional(),
  // Safety: disable auto-texture fallback by default
  allowAutoTextureFallback: z.boolean().optional().default(false),
  // Optional search roots for locating .mtl files
  mtlSearchPaths: z.array(z.string()).optional().default([]),
  // Optional search roots for locating texture files referenced by .mtl
  textureSearchPaths: z.array(z.string()).optional().default([]),
  materialPerSmoothingGroup: z.boolean().optional().default(true),
  useOAsMesh: z.boolean().optional().default(true),
  useIndices: z.boolean().optional().default(true),
  disregardNormals: z.boolean().optional().default(false),
});

/**
 * Type export for TypeScript inference
 */
export type ObjConverterConfig = z.infer<typeof ObjConverterConfigSchema>;
