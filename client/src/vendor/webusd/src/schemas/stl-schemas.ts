/** WebUsdFramework.Schemas.StlSchemas - STL-specific USDA Mesh schema builders */

import { z } from 'zod';
import { UpAxisSchema } from './base-schemas';

/**
 * STL Converter Configuration Schema
 */
export const StlConverterConfigSchema = z.object({
  debug: z.boolean().optional().default(false),
  debugOutputDir: z.string().optional().default('./debug-output'),
  upAxis: UpAxisSchema.optional().default('Y'),
  metersPerUnit: z.number().positive().optional().default(1),
  // Enable mesh optimization with meshoptimizer
  optimizeMesh: z.boolean().optional().default(false),
  // Default material color (linear RGB 0-1)
  defaultColor: z.tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1)
  ]).optional().default([0.7, 0.7, 0.7]),
  // Automatically compute normals if missing or  invalid
  autoComputeNormals: z.boolean().optional().default(true),
});

export type StlConverterConfig = z.infer<typeof StlConverterConfigSchema>;
