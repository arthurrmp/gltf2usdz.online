/** WebUsdFramework.Converters.Shared.UsdzStreamWriter — streaming USDZ archive writer
 *
 * Writes a USDZ (uncompressed, 64-byte aligned ZIP) archive directly to a
 * Node `Writable`, avoiding the full-archive `Uint8Array(totalSize)`
 * allocation that the buffered `UsdzZipWriter.generate()` requires.
 *
 * Memory profile:
 *   - Buffered writer:   peak ≈ 1 × total archive size (the final result buffer).
 *   - Streaming writer:  peak ≈ size of the largest single file in the archive
 *                        (because that file's CRC32 still needs a single-pass
 *                        walk before the local header can be emitted).
 *
 * For dense point-cloud archives where the final USDZ size is in the hundreds
 * of megabytes but no individual file is that large, this is an order-of-
 * magnitude reduction in peak resident memory.
 *
 * Output bytes are byte-for-byte identical to `UsdzZipWriter.generate()` for
 * the same input — verified by the byte-equivalence test in
 * `src/__tests__/usdz-stream-writer.test.ts` (with `vi.setSystemTime` pinning
 * the DOS time/date that both writers stamp into headers).
 *
 * NOTE: This module duplicates a handful of small format helpers
 * (`createLocalFileHeader`, `createCentralDirectoryHeader`,
 * `createEndOfCentralDirectoryRecord`, CRC32 + DOS time/date) from
 * `usdz-zip-writer.ts`. That duplication is intentional for this PR — keeping
 * the change additive — and is tracked for cleanup via a follow-up refactor.
 */

import * as fs from 'node:fs';
import { Writable } from 'node:stream';
import { ZIP_CONSTANTS } from '../../constants';
import {
  DosDateSchema,
  DosTimeSchema,
  FileNameSchema,
} from '../../schemas/zip-writer';

/**
 * One file to include in the USDZ archive.
 */
export interface StreamingUsdzFile {
  /** Archive-relative file name, e.g. `model.usda` or `Geometries/geom_0.usda`. */
  name: string;
  /** File payload. May be a single buffer or a list of chunks (concatenated in order). */
  data: Uint8Array | Uint8Array[];
}

export interface StreamingUsdzOptions {
  /**
   * 64-byte-align file data, mirroring Apple's USDZ profile requirement.
   * Defaults to `true`.
   */
  alignTo64Bytes?: boolean;
}

export interface StreamingUsdzResult {
  /** Total bytes written to the output stream. */
  totalBytes: number;
  /** Number of files included in the archive. */
  fileCount: number;
}

interface CentralDirectoryEntry {
  name: string;
  nameBytes: Uint8Array;
  crc32: number;
  size: number;
  uncompressedSize: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

const TEXT_ENCODER = new TextEncoder();

let cachedCrcTable: Uint32Array | null = null;
function getCrc32Table(): Uint32Array {
  if (cachedCrcTable) return cachedCrcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? ZIP_CONSTANTS.CRC32_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  cachedCrcTable = table;
  return table;
}

function crc32OfChunks(chunks: ReadonlyArray<Uint8Array>): number {
  const table = getCrc32Table();
  let crc = ZIP_CONSTANTS.CRC32_INITIAL;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      crc = table[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ ZIP_CONSTANTS.CRC32_INITIAL) >>> 0;
}

function getDosTime(date: Date): number {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return DosTimeSchema.parse(dosTime);
}

function getDosDate(date: Date): number {
  const dosDate =
    ((date.getFullYear() - ZIP_CONSTANTS.DOS_YEAR_OFFSET) << 9) |
    ((date.getMonth() + ZIP_CONSTANTS.DOS_MONTH_OFFSET) << 5) |
    date.getDate();
  return DosDateSchema.parse(dosDate);
}

interface LocalFileHeaderArgs {
  nameBytes: Uint8Array;
  size: number;
  uncompressedSize: number;
  crc32: number;
  dosTime: number;
  dosDate: number;
  currentOffset: number;
  alignTo64Bytes: boolean;
}

function createLocalFileHeader(args: LocalFileHeaderArgs): Uint8Array {
  const baseHeaderSize = ZIP_CONSTANTS.LOCAL_FILE_HEADER_SIZE + args.nameBytes.length;
  let extraFieldLength = 0;
  if (args.alignTo64Bytes) {
    const dataStartOffset = args.currentOffset + baseHeaderSize;
    const required =
      Math.ceil(dataStartOffset / ZIP_CONSTANTS.ALIGNMENT_BYTES) * ZIP_CONSTANTS.ALIGNMENT_BYTES;
    extraFieldLength = required - dataStartOffset;
  }
  const header = new Uint8Array(baseHeaderSize + extraFieldLength);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

  view.setUint32(0, ZIP_CONSTANTS.LOCAL_FILE_HEADER_SIGNATURE, true);
  view.setUint16(4, ZIP_CONSTANTS.VERSION_NEEDED, true);
  view.setUint16(6, 0, true); // general purpose bit flag
  view.setUint16(8, ZIP_CONSTANTS.COMPRESSION_STORE, true);
  view.setUint16(10, args.dosTime, true);
  view.setUint16(12, args.dosDate, true);
  view.setUint32(14, args.crc32, true);
  view.setUint32(18, args.size, true);
  view.setUint32(22, args.uncompressedSize, true);
  view.setUint16(26, args.nameBytes.length, true);
  view.setUint16(28, extraFieldLength, true);
  header.set(args.nameBytes, ZIP_CONSTANTS.LOCAL_FILE_HEADER_SIZE);
  // The trailing extraField bytes are already zero-initialized.

  return header;
}

interface CentralDirectoryHeaderArgs {
  nameBytes: Uint8Array;
  size: number;
  uncompressedSize: number;
  crc32: number;
  dosTime: number;
  dosDate: number;
  offset: number;
}

function createCentralDirectoryHeader(args: CentralDirectoryHeaderArgs): Uint8Array {
  const header = new Uint8Array(
    ZIP_CONSTANTS.CENTRAL_DIRECTORY_HEADER_SIZE + args.nameBytes.length
  );
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

  view.setUint32(0, ZIP_CONSTANTS.CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, ZIP_CONSTANTS.VERSION_MADE_BY, true);
  view.setUint16(6, ZIP_CONSTANTS.VERSION_NEEDED, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, ZIP_CONSTANTS.COMPRESSION_STORE, true);
  view.setUint16(12, args.dosTime, true);
  view.setUint16(14, args.dosDate, true);
  view.setUint32(16, args.crc32, true);
  view.setUint32(20, args.size, true);
  view.setUint32(24, args.uncompressedSize, true);
  view.setUint16(28, args.nameBytes.length, true);
  view.setUint16(30, 0, true); // extra field length
  view.setUint16(32, 0, true); // file comment length
  view.setUint16(34, 0, true); // disk number start
  view.setUint16(36, 0, true); // internal file attributes
  view.setUint32(38, 0, true); // external file attributes
  view.setUint32(42, args.offset, true);
  header.set(args.nameBytes, ZIP_CONSTANTS.CENTRAL_DIRECTORY_HEADER_SIZE);

  return header;
}

function createEndOfCentralDirectoryRecord(
  fileCount: number,
  centralDirSize: number,
  centralDirOffset: number
): Uint8Array {
  const record = new Uint8Array(ZIP_CONSTANTS.END_OF_CENTRAL_DIRECTORY_SIZE);
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);

  view.setUint32(0, ZIP_CONSTANTS.END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, 0, true); // disk number
  view.setUint16(6, 0, true); // disk with CD
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralDirSize, true);
  view.setUint32(16, centralDirOffset, true);
  view.setUint16(20, 0, true); // comment length

  return record;
}

/**
 * Write a chunk to the output stream, awaiting `'drain'` when the internal
 * buffer is full so we honour backpressure instead of unbounded buffering.
 */
function writeChunk(output: Writable, chunk: Uint8Array): Promise<void> {
  if (output.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onDrain = (): void => {
      output.off('error', onError);
      resolve();
    };
    const onError = (err: Error): void => {
      output.off('drain', onDrain);
      reject(err);
    };
    output.once('drain', onDrain);
    output.once('error', onError);
  });
}

/**
 * Stream a USDZ archive containing `files` to the supplied Node `Writable`.
 *
 * The function does not call `end()` on the stream; the caller owns the
 * stream's lifecycle. (`writeUsdzToFile` below is the convenience wrapper
 * that does.)
 */
export async function writeUsdzToStream(
  files: ReadonlyArray<StreamingUsdzFile>,
  output: Writable,
  options: StreamingUsdzOptions = {}
): Promise<StreamingUsdzResult> {
  const alignTo64Bytes = options.alignTo64Bytes ?? true;
  const cdEntries: CentralDirectoryEntry[] = [];
  let totalBytes = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const validatedName = FileNameSchema.parse(file.name);
    const nameBytes = TEXT_ENCODER.encode(validatedName);
    const chunks = Array.isArray(file.data) ? file.data : [file.data];

    let size = 0;
    for (const chunk of chunks) size += chunk.length;
    const crc32 = crc32OfChunks(chunks);

    const now = new Date();
    const dosTime = getDosTime(now);
    const dosDate = getDosDate(now);
    const fileOffset = totalBytes;

    const header = createLocalFileHeader({
      nameBytes,
      size,
      uncompressedSize: size,
      crc32,
      dosTime,
      dosDate,
      currentOffset: fileOffset,
      alignTo64Bytes,
    });

    await writeChunk(output, header);
    totalBytes += header.length;

    for (const chunk of chunks) {
      await writeChunk(output, chunk);
      totalBytes += chunk.length;
    }

    cdEntries.push({
      name: validatedName,
      nameBytes,
      crc32,
      size,
      uncompressedSize: size,
      offset: fileOffset,
      dosTime,
      dosDate,
    });
  }

  // Padding before central directory.
  if (alignTo64Bytes) {
    const aligned =
      Math.ceil(totalBytes / ZIP_CONSTANTS.ALIGNMENT_BYTES) * ZIP_CONSTANTS.ALIGNMENT_BYTES;
    const padding = aligned - totalBytes;
    if (padding > 0) {
      await writeChunk(output, new Uint8Array(padding));
      totalBytes += padding;
    }
  }

  const centralDirStart = totalBytes;
  let centralDirSize = 0;

  for (const entry of cdEntries) {
    const cdHeader = createCentralDirectoryHeader({
      nameBytes: entry.nameBytes,
      size: entry.size,
      uncompressedSize: entry.uncompressedSize,
      crc32: entry.crc32,
      dosTime: entry.dosTime,
      dosDate: entry.dosDate,
      offset: entry.offset,
    });
    await writeChunk(output, cdHeader);
    totalBytes += cdHeader.length;
    centralDirSize += cdHeader.length;
  }

  const eocd = createEndOfCentralDirectoryRecord(
    cdEntries.length,
    centralDirSize,
    centralDirStart
  );
  await writeChunk(output, eocd);
  totalBytes += eocd.length;

  return { totalBytes, fileCount: cdEntries.length };
}

/**
 * Convenience wrapper around `writeUsdzToStream` that opens a write stream
 * for `filePath`, writes the archive, and closes the stream cleanly.
 *
 * On success returns the total bytes written and file count.
 * On failure the partial output file is left for the caller to inspect or
 * delete; the underlying stream is destroyed.
 */
export async function writeUsdzToFile(
  files: ReadonlyArray<StreamingUsdzFile>,
  filePath: string,
  options?: StreamingUsdzOptions
): Promise<StreamingUsdzResult> {
  const stream = fs.createWriteStream(filePath);
  try {
    const result = await writeUsdzToStream(files, stream, options);
    await new Promise<void>((resolve, reject) => {
      stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    return result;
  } catch (err) {
    stream.destroy();
    throw err;
  }
}
