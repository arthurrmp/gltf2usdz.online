/** WebUsdFramework.Constants.Errors - String-keyed error code catalogue */

/**
 * Error Codes
 */
export const ERROR_CODES = {
  SCHEMA_VALIDATION_ERROR: 'USD_SCHEMA_VALIDATION_ERROR',
  CONFIG_VALIDATION_ERROR: 'USD_CONFIG_VALIDATION_ERROR',
  CONVERSION_ERROR: 'USD_CONVERSION_ERROR',
  FILE_SYSTEM_ERROR: 'USD_FILE_SYSTEM_ERROR',
  VALIDATION_ERROR: 'USD_VALIDATION_ERROR',
  ZIP_WRITER_ERROR: 'USD_ZIP_WRITER_ERROR',
  ZIP_FILE_SIZE_ERROR: 'USD_ZIP_FILE_SIZE_ERROR',
  ZIP_ARCHIVE_SIZE_ERROR: 'USD_ZIP_ARCHIVE_SIZE_ERROR',
  ZIP_FILE_EXTENSION_ERROR: 'USD_ZIP_FILE_EXTENSION_ERROR',
  ZIP_EMPTY_ARCHIVE_ERROR: 'USD_ZIP_EMPTY_ARCHIVE_ERROR',
} as const;

/**
 * Error Messages
 */
export const ERROR_MESSAGES = {
  SCHEMA_VALIDATION_ERROR: 'USD schema validation failed',
  CONFIG_VALIDATION_ERROR: 'Configuration validation failed',
  CONVERSION_ERROR: 'GLB to USDZ conversion failed',
  FILE_SYSTEM_ERROR: 'File system operation failed',
  VALIDATION_ERROR: 'General validation failed',
  INVALID_PATH: 'Invalid USD path format',
  INVALID_CONFIG: 'Invalid configuration provided',
  CONVERSION_STAGE_FAILED: 'Conversion stage failed',
  FILE_OPERATION_FAILED: 'File operation failed',
  VALIDATION_FAILED: 'Validation failed',
  ZIP_WRITER_ERROR: 'ZIP writer operation failed',
  ZIP_FILE_SIZE_ERROR: 'File size exceeds ZIP format limit (>4GB)',
  ZIP_ARCHIVE_SIZE_ERROR: 'Archive size exceeds ZIP format limit (>4GB)',
  ZIP_FILE_EXTENSION_ERROR: 'Unsupported file extension for ZIP archive',
  ZIP_EMPTY_ARCHIVE_ERROR: 'Cannot generate empty ZIP archive',
} as const;

