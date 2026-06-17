/** WebUsdFramework.Constants.Usd - USD schema token strings and stage metadata keys */

/**
 * USD Node Types
 */
export const USD_NODE_TYPES = {
  XFORM: 'Xform',
  SCOPE: 'Scope',
  MESH: 'Mesh',
  MATERIAL: 'Material',
  SHADER: 'Shader',
} as const;

/**
 * USD Root Paths
 */
export const USD_ROOT_PATHS = {
  ROOT: '/Root',
  SCENES: '/Root/Scenes',
  MATERIALS: '/Root/Materials',
} as const;

/**
 * USD Default Names
 */
export const USD_DEFAULT_NAMES = {
  SCENE: 'Scene',
  MATERIAL_PREFIX: 'Material_',
  GEOMETRY_PREFIX: 'Geometry_',
  TEXTURE_PREFIX: 'Texture_',
  NODE_PREFIX: 'Node_',
  PRIM_SUFFIX: '_prim',
} as const;

/**
 * USD File Names
 */
export const USD_FILE_NAMES = {
  MODEL: 'model.usda',
  CONVERTED: 'converted.usdz',
} as const;

/**
 * USD Property Names
 */
export const USD_PROPERTIES = {
  ANCHORING_TYPE: 'preliminary:anchoring:type',
  ANCHORING_PLANE: 'plane',
  XFORM_OP_TRANSFORM: 'xformOp:transform',
  XFORM_OP_ORDER: 'xformOpOrder',
  PREPEND_REFERENCES: 'prepend references',
  PREPEND_API_SCHEMAS: 'prepend apiSchemas',
  MATERIAL_BINDING: 'material:binding',
  MATERIAL_BINDING_API: 'MaterialBindingAPI',
  SUBDIVISION_SCHEME: 'subdivisionScheme',
  SUBDIVISION_NONE: 'none',
} as const;

/**
 * USD Property Types
 */
export const USD_PROPERTY_TYPES = {
  TOKEN: 'token',
  TOKEN_ARRAY: 'token[]',
  STRING_ARRAY: 'string[]',
  REL: 'rel',
  RAW: 'raw',
  ASSET: 'asset',
  INT: 'int',
  FLOAT: 'float',
} as const;

/**
 * ZIP Version Constants
 */
export const ZIP_VERSION = {
  MAJOR: 0x14,
  MINOR: 0x00,
  MAJOR_OFFSET: 4,
  MINOR_OFFSET: 5,
} as const;

/**
 * Name Sanitization Pattern
 */
export const NAME_SANITIZATION_PATTERN = /[^A-Za-z0-9_]/g;

