/** WebUsdFramework.Schemas.ZipWriter - Uncompressed 64-byte aligned ZIP archive encoder for USDZ */

import { z } from 'zod';

/**
 * Valid file extensions for ZIP archives
 */
export const ZIP_FILE_EXTENSIONS = [
  '.usda',
  '.usdc',
  '.usd',
  '.png',
  '.jpg',
  '.jpeg'
] as const;

/**
 * ZIP Writer Options Schema
 */
export const ZipWriterOptionsSchema = z.object({
  alignTo64Bytes: z.boolean().optional().default(true),
  compressionLevel: z.number().int().min(0).max(0).optional().default(0)
});

/**
 * ZIP File Info Schema
 */
export const ZipFileInfoSchema = z.object({
  name: z.string().min(1).max(255),
  data: z.instanceof(Uint8Array),
  offset: z.number().int().min(0),
  size: z.number().int().min(0),
  uncompressedSize: z.number().int().min(0),
  crc32: z.number().int().min(0)
});

/**
 * File Name Validation Schema
 */
export const FileNameSchema = z.string()
  .min(1, 'File name cannot be empty')
  .max(255, 'File name too long')
  .refine(
    (name) => {
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      return ZIP_FILE_EXTENSIONS.includes(ext as any);
    },
    {
      message: `File extension must be one of: ${ZIP_FILE_EXTENSIONS.join(', ')}`
    }
  );

/**
 * File Data Validation Schema
 */
export const FileDataSchema = z.instanceof(Uint8Array)
  .refine(
    (data) => data.length <= 0xffffffff,
    {
      message: 'File size exceeds ZIP format limit (>4GB)'
    }
  );

/**
 * Archive Size Validation Schema
 */
export const ArchiveSizeSchema = z.number()
  .int()
  .min(0)
  .max(0xffffffff, 'Archive size exceeds ZIP format limit (>4GB)');

/**
 * File Count Validation Schema
 */
export const FileCountSchema = z.number()
  .int()
  .min(1, 'Cannot generate empty ZIP archive');

/**
 * CRC32 Validation Schema
 */
export const Crc32Schema = z.number()
  .int()
  .min(0)
  .max(0xffffffff);

/**
 * DOS Time Validation Schema
 */
export const DosTimeSchema = z.number()
  .int()
  .min(0)
  .max(0xffff);

/**
 * DOS Date Validation Schema
 */
export const DosDateSchema = z.number()
  .int()
  .min(0)
  .max(0xffff);

/**
 * ZIP Header Validation Schema
 */
export const ZipHeaderSchema = z.object({
  signature: z.number().int(),
  version: z.number().int(),
  flags: z.number().int(),
  compressionMethod: z.number().int(),
  lastModTime: DosTimeSchema,
  lastModDate: DosDateSchema,
  crc32: Crc32Schema,
  compressedSize: z.number().int().min(0),
  uncompressedSize: z.number().int().min(0),
  fileNameLength: z.number().int().min(0),
  extraFieldLength: z.number().int().min(0)
});

/**
 * Type exports for TypeScript
 */
export type ZipWriterOptions = z.infer<typeof ZipWriterOptionsSchema>;
export interface ZipFileInfo {
  name: string;
  /**
   * The file's bytes. May be cleared to undefined by the writer after the
   * data has been copied into the final output buffer, so the runtime can
   * reclaim the input chunks before generate() returns.
   */
  data: Uint8Array | Uint8Array[] | undefined;
  offset: number;
  size: number;
  uncompressedSize: number;
  crc32: number;
}
export type FileName = z.infer<typeof FileNameSchema>;
export type FileData = z.infer<typeof FileDataSchema>;
export type ArchiveSize = z.infer<typeof ArchiveSizeSchema>;
export type FileCount = z.infer<typeof FileCountSchema>;
export type Crc32 = z.infer<typeof Crc32Schema>;
export type DosTime = z.infer<typeof DosTimeSchema>;
export type DosDate = z.infer<typeof DosDateSchema>;
export type ZipHeader = z.infer<typeof ZipHeaderSchema>;
