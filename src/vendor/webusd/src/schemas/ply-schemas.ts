/** WebUsdFramework.Schemas.PlySchemas - PLY-specific converter configuration */

import { z } from 'zod';
import { UpAxisSchema } from './base-schemas';

/**
 * PLY Converter Configuration Schema
 */
export const PlyConverterConfigSchema = z.object({
  debug: z.boolean().optional().default(false),
  debugOutputDir: z.string().optional().default('./debug-output'),
  upAxis: UpAxisSchema.optional().default('Y'),
  metersPerUnit: z.number().positive().optional().default(1),
  // Default material color (linear RGB 0-1)
  defaultColor: z.tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1)
  ]).optional().default([0.7, 0.7, 0.7]),
  // Default point width for UsdGeomPoints (in scene units)
  defaultPointWidth: z.number().positive().optional().default(0.005),
  // Max points for point cloud downsampling (0 = no limit)
  maxPoints: z.number().int().min(0).optional().default(0),
  // Target face count for mesh decimation via vertex clustering (0 = no decimation)
  decimateTarget: z.number().int().min(0).optional().default(0),
});

export type PlyConverterConfig = z.infer<typeof PlyConverterConfigSchema>;
