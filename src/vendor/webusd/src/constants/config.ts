/** WebUsdFramework.Constants.Config - Default framework configuration values */

/**
 * Default Configuration Values
 */
export const DEFAULT_CONFIG = {
  DEBUG: false,
  DEBUG_OUTPUT_DIR: './debug-output',
  UP_AXIS: 'Y' as const,
  METERS_PER_UNIT: 1,
  COMPRESSION: 'STORE' as const,
  MIME_TYPE: 'model/vnd.usdz+zip',
  ALIGNMENT: 64,
} as const;


/**
 * File Extensions
 */
export const FILE_EXTENSIONS = {
  USD: '.usd',
  USDA: '.usda',
  PNG: '.png',
  USDZ: '.usdz',
} as const;

/**
 * Directory Names
 */
export const DIRECTORY_NAMES = {
  GEOMETRIES: 'geometries',
  MATERIALS: 'materials',
  TEXTURES: 'textures',
  DEBUG_OUTPUT: 'debug-output',
  TEST_OUTPUT: 'test-output',
} as const;
