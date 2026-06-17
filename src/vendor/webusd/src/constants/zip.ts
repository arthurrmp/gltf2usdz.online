/** WebUsdFramework.Constants.Zip - USDZ zip archive alignment and magic byte constants */

export const ZIP_CONSTANTS = {
  LOCAL_FILE_HEADER_SIGNATURE: 0x04034b50,
  CENTRAL_DIRECTORY_SIGNATURE: 0x02014b50,
  END_OF_CENTRAL_DIRECTORY_SIGNATURE: 0x06054b50,

  VERSION_NEEDED: 20,
  VERSION_MADE_BY: 20,

  COMPRESSION_STORE: 0,

  CRC32_INITIAL: 0xffffffff as number,
  CRC32_POLYNOMIAL: 0xedb88320 as number,

  MAX_FILE_SIZE: 0xffffffff,
  MAX_ARCHIVE_SIZE: 0xffffffff,

  LOCAL_FILE_HEADER_SIZE: 30,
  CENTRAL_DIRECTORY_HEADER_SIZE: 46,
  END_OF_CENTRAL_DIRECTORY_SIZE: 22,

  ALIGNMENT_BYTES: 64,

  DOS_YEAR_OFFSET: 1980,
  DOS_MONTH_OFFSET: 1
} as const;

export const ZIP_ERROR_MESSAGES = {
  FILE_TOO_LARGE: 'File size exceeds ZIP format limit (>4GB)',
  ARCHIVE_TOO_LARGE: 'Archive size exceeds ZIP format limit (>4GB)',
  UNSUPPORTED_EXTENSION: 'Unsupported file extension for ZIP archive',
  EMPTY_ARCHIVE: 'Cannot generate empty ZIP archive',
  CRC32_MISMATCH: 'CRC32 checksum mismatch detected'
} as const;
