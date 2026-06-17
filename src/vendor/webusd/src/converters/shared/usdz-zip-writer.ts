/** WebUsdFramework.Converters.Shared.UsdzZipWriter - Domain-specific wrapper over zip-writer for USDZ rules */

import {
  ZipWriterOptionsSchema,
  FileNameSchema,
  FileCountSchema,
  DosTimeSchema,
  DosDateSchema,
  type ZipWriterOptions,
  type ZipFileInfo
} from '../../schemas/zip-writer';
import { ZIP_CONSTANTS } from '../../constants';

/**
 * ZIP writer that creates archives with 64-byte aligned file data.
 * Generates ZIP files with CRC32 checksums, DOS timestamps, and no compression.
 */
export class UsdzZipWriter {
  private files: ZipFileInfo[] = [];
  private currentOffset = 0;
  private alignTo64Bytes: boolean;
  private compressionLevel: number;
  private crcTable: Uint32Array | null = null;
  private encoder = new TextEncoder();

  constructor(options: Partial<ZipWriterOptions> = {}) {
    // Validate options
    const validatedOptions = ZipWriterOptionsSchema.parse(options);

    this.alignTo64Bytes = validatedOptions.alignTo64Bytes;
    this.compressionLevel = validatedOptions.compressionLevel;

    // Enforce no compression for optimal performance
    if (this.compressionLevel !== ZIP_CONSTANTS.COMPRESSION_STORE) {
      console.warn('[UsdzZipWriter] Compression is not supported for optimal performance; ignoring compressionLevel');
      this.compressionLevel = ZIP_CONSTANTS.COMPRESSION_STORE;
    }

    // Start at 0 - we'll add padding in generate()
    this.currentOffset = 0;
  }

  /**
   * Add a file to the ZIP archive
   */
  addFile(fileName: string, data: Uint8Array | Uint8Array[]): string {
    // Validate file name
    const validatedFileName = FileNameSchema.parse(fileName);

    // Normalize data to chunks
    const chunks = Array.isArray(data) ? data : [data];

    // Calculate total size and CRC32
    let size = 0;
    let crc = ZIP_CONSTANTS.CRC32_INITIAL;
    const crcTable = this.getCrc32Table();

    for (const chunk of chunks) {
      size += chunk.length;

      // Update CRC32 for this chunk
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i];
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      }
    }

    // Finalize CRC32
    const crc32 = (crc ^ ZIP_CONSTANTS.CRC32_INITIAL) >>> 0;

    const fileInfo: ZipFileInfo = {
      name: validatedFileName,
      data: chunks, // Store as chunks
      offset: this.currentOffset, // This will be updated in generate()
      size: size,
      uncompressedSize: size,
      crc32: crc32
    };

    // Update offset for next file (header size + filename length + data length)
    this.currentOffset += ZIP_CONSTANTS.LOCAL_FILE_HEADER_SIZE + validatedFileName.length + size;

    this.files.push(fileInfo);

    return validatedFileName;
  }

  /**
   * Generate the final ZIP file buffer.
   *
   * Two-pass strategy keeps peak memory bounded to a single output buffer:
   *   Pass 1 — compute total byte size and per-file local header offsets via sizing math
   *            (no allocations beyond small offset/length arrays).
   *   Pass 2 — preallocate the final Uint8Array once and write headers, file data, padding,
   *            central directory and EOCD record directly into it.
   *
   * Output bytes are byte-for-byte identical to the previous chunk-accumulator implementation.
   */
  generate(): Uint8Array {
    // Validate file count
    FileCountSchema.parse(this.files.length);

    // Pass 1: size everything.
    const fileOffsets: number[] = new Array(this.files.length);
    const nameByteLengths: number[] = new Array(this.files.length);
    let totalSize = 0;

    for (let i = 0; i < this.files.length; i++) {
      const file = this.files[i];
      fileOffsets[i] = totalSize;

      const nameByteLength = this.encoder.encode(file.name).length;
      nameByteLengths[i] = nameByteLength;

      const baseHeaderSize = ZIP_CONSTANTS.LOCAL_FILE_HEADER_SIZE + nameByteLength;
      let extraFieldLength = 0;
      if (this.alignTo64Bytes) {
        const dataStart = totalSize + baseHeaderSize;
        const aligned = Math.ceil(dataStart / ZIP_CONSTANTS.ALIGNMENT_BYTES) * ZIP_CONSTANTS.ALIGNMENT_BYTES;
        extraFieldLength = aligned - dataStart;
      }

      totalSize += baseHeaderSize + extraFieldLength + file.size;
    }

    // Padding before central directory.
    let centralDirPadding = 0;
    if (this.alignTo64Bytes) {
      const aligned = Math.ceil(totalSize / ZIP_CONSTANTS.ALIGNMENT_BYTES) * ZIP_CONSTANTS.ALIGNMENT_BYTES;
      centralDirPadding = aligned - totalSize;
      totalSize += centralDirPadding;
    }
    const centralDirStart = totalSize;

    // Central directory size.
    let centralDirSize = 0;
    for (let i = 0; i < this.files.length; i++) {
      centralDirSize += ZIP_CONSTANTS.CENTRAL_DIRECTORY_HEADER_SIZE + nameByteLengths[i];
    }
    totalSize += centralDirSize + ZIP_CONSTANTS.END_OF_CENTRAL_DIRECTORY_SIZE;

    // Pass 2: write directly into the preallocated output.
    const result = new Uint8Array(totalSize);
    let offset = 0;

    for (let i = 0; i < this.files.length; i++) {
      const file = this.files[i];
      file.offset = fileOffsets[i];

      const header = this.createLocalFileHeader(file, fileOffsets[i]);
      result.set(header, offset);
      offset += header.length;

      const data = file.data;
      if (Array.isArray(data)) {
        for (const chunk of data) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
      } else if (data) {
        result.set(data, offset);
        offset += data.length;
      }

      // Release the input chunk references now that the bytes live in
      // `result`. The remaining work in this method (alignment padding,
      // central directory, EOCD record) only needs the small metadata
      // fields on `file`. Dropping `data` lets the runtime reclaim the
      // source buffers progressively rather than holding them all live
      // until generate() returns.
      file.data = undefined;
    }

    // Padding bytes are already zero-initialized in result.
    offset += centralDirPadding;

    for (let i = 0; i < this.files.length; i++) {
      const centralHeader = this.createCentralDirectoryHeader(this.files[i], fileOffsets[i]);
      result.set(centralHeader, offset);
      offset += centralHeader.length;
    }

    const endRecord = this.createEndOfCentralDirectoryRecord(centralDirStart, centralDirSize);
    result.set(endRecord, offset);

    return result;
  }

  /**
   * Create local file header (30 bytes + filename + padding)
   */
  private createLocalFileHeader(file: ZipFileInfo, currentOffset: number): Uint8Array {
    const nameBytes = this.encoder.encode(file.name);
    const now = new Date();

    // Calculate base header size (header size + filename)
    const baseHeaderSize = ZIP_CONSTANTS.LOCAL_FILE_HEADER_SIZE + nameBytes.length;
    let extraFieldLength = 0;

    // Add padding to align file data to proper boundary
    if (this.alignTo64Bytes) {
      // Calculate where the file data will start (current offset + complete header)
      const dataStartOffset = currentOffset + baseHeaderSize;
      const requiredOffset = Math.ceil(dataStartOffset / ZIP_CONSTANTS.ALIGNMENT_BYTES) * ZIP_CONSTANTS.ALIGNMENT_BYTES;
      const paddingNeeded = requiredOffset - dataStartOffset;

      if (paddingNeeded > 0) {
        extraFieldLength = paddingNeeded;
      }
    }

    // Total header size including extra field
    const totalHeaderSize = baseHeaderSize + extraFieldLength;

    const header = new Uint8Array(totalHeaderSize);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

    // Local file header signature
    view.setUint32(0, ZIP_CONSTANTS.LOCAL_FILE_HEADER_SIGNATURE, true);

    // Version needed to extract (2.0 for compatibility)
    view.setUint16(4, ZIP_CONSTANTS.VERSION_NEEDED, true);

    // General purpose bit flag
    view.setUint16(6, 0, true);

    // Compression method (0 = stored, no compression)
    view.setUint16(8, ZIP_CONSTANTS.COMPRESSION_STORE, true);

    // Last mod file time
    view.setUint16(10, this.getDosTime(now), true);

    // Last mod file date
    view.setUint16(12, this.getDosDate(now), true);

    // CRC-32
    view.setUint32(14, file.crc32, true);

    // Compressed size
    view.setUint32(18, file.size, true);

    // Uncompressed size
    view.setUint32(22, file.uncompressedSize, true);

    // File name length
    view.setUint16(26, nameBytes.length, true);

    // Extra field length (for padding)
    view.setUint16(28, extraFieldLength, true);

    // Write filename
    header.set(nameBytes, ZIP_CONSTANTS.LOCAL_FILE_HEADER_SIZE);

    // Add padding in extra field if needed
    if (extraFieldLength > 0) {
      header.fill(0, ZIP_CONSTANTS.LOCAL_FILE_HEADER_SIZE + nameBytes.length, ZIP_CONSTANTS.LOCAL_FILE_HEADER_SIZE + nameBytes.length + extraFieldLength);
    }

    return header;
  }

  /**
   * Create central directory header (46 bytes + filename)
   */
  private createCentralDirectoryHeader(file: ZipFileInfo, actualOffset: number): Uint8Array {
    const nameBytes = this.encoder.encode(file.name);
    const now = new Date();

    const header = new Uint8Array(ZIP_CONSTANTS.CENTRAL_DIRECTORY_HEADER_SIZE + nameBytes.length);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

    // Central directory file header signature
    view.setUint32(0, ZIP_CONSTANTS.CENTRAL_DIRECTORY_SIGNATURE, true);

    // Version made by
    view.setUint16(4, ZIP_CONSTANTS.VERSION_MADE_BY, true);

    // Version needed to extract
    view.setUint16(6, ZIP_CONSTANTS.VERSION_NEEDED, true);

    // General purpose bit flag
    view.setUint16(8, 0, true);

    // Compression method
    view.setUint16(10, ZIP_CONSTANTS.COMPRESSION_STORE, true);

    // Last mod file time
    view.setUint16(12, this.getDosTime(now), true);

    // Last mod file date
    view.setUint16(14, this.getDosDate(now), true);

    // CRC-32
    view.setUint32(16, file.crc32, true);

    // Compressed size
    view.setUint32(20, file.size, true);

    // Uncompressed size
    view.setUint32(24, file.uncompressedSize, true);

    // File name length
    view.setUint16(28, nameBytes.length, true);

    // Extra field length
    view.setUint16(30, 0, true);

    // File comment length
    view.setUint16(32, 0, true);

    // Disk number start
    view.setUint16(34, 0, true);

    // Internal file attributes
    view.setUint16(36, 0, true);

    // External file attributes
    view.setUint32(38, 0, true);

    // Relative offset of local header
    view.setUint32(42, actualOffset, true);

    // Write filename
    header.set(nameBytes, ZIP_CONSTANTS.CENTRAL_DIRECTORY_HEADER_SIZE);

    return header;
  }

  /**
   * Create end of central directory record (22 bytes)
   */
  private createEndOfCentralDirectoryRecord(centralDirOffset: number, centralDirSize: number): Uint8Array {
    const record = new Uint8Array(ZIP_CONSTANTS.END_OF_CENTRAL_DIRECTORY_SIZE);
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);

    // End of central directory signature
    view.setUint32(0, ZIP_CONSTANTS.END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);

    // Number of this disk
    view.setUint16(4, 0, true);

    // Number of the disk with the start of the central directory
    view.setUint16(6, 0, true);

    // Total number of entries in the central directory on this disk
    view.setUint16(8, this.files.length, true);

    // Total number of entries in the central directory
    view.setUint16(10, this.files.length, true);

    // Size of the central directory
    view.setUint32(12, centralDirSize, true);

    // Offset of start of central directory with respect to the starting disk number
    view.setUint32(16, centralDirOffset, true);

    // ZIP file comment length
    view.setUint16(20, 0, true);

    return record;
  }

  /**
   * Generate CRC32 lookup table with caching
   */
  private getCrc32Table(): Uint32Array {
    if (this.crcTable) return this.crcTable;

    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (ZIP_CONSTANTS.CRC32_POLYNOMIAL ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0; // Ensure unsigned 32-bit
    }
    this.crcTable = table;
    return table;
  }

  /**
   * Convert Date to DOS time format
   */
  private getDosTime(date: Date): number {
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    return DosTimeSchema.parse(dosTime);
  }

  /**
   * Convert Date to DOS date format
   */
  private getDosDate(date: Date): number {
    const dosDate = ((date.getFullYear() - ZIP_CONSTANTS.DOS_YEAR_OFFSET) << 9) | ((date.getMonth() + ZIP_CONSTANTS.DOS_MONTH_OFFSET) << 5) | date.getDate();
    return DosDateSchema.parse(dosDate);
  }
}
