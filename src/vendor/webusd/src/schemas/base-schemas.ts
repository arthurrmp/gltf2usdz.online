/** WebUsdFramework.Schemas.BaseSchemas - Foundational USDA stage header and prim templates */

import { z } from 'zod';

/**
 * Supported Up Axes Schema
 */
export const UpAxisSchema = z.enum(['Y', 'Z']);

/**
 * Supported Compression Types Schema
 */
export const CompressionSchema = z.enum(['STORE', 'DEFLATE']);
