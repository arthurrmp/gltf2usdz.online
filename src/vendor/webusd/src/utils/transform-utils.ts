/** WebUsdFramework.Utils.TransformUtils - Translation, rotation, and scale decomposition routines */

import { UsdNode } from '../core/usd-node';
import { formatMatrix } from './matrix-utils';
import { normalizePropertyToArray } from './property-normalizer';

/**
 * USD transform operation types.
 * These are the standard ops you can use in xformOpOrder.
 */
export const XFORM_OP_TYPES = {
  TRANSFORM: 'xformOp:transform',
  TRANSLATE: 'xformOp:translate',
  ORIENT: 'xformOp:orient',
  SCALE: 'xformOp:scale',
  ROTATE_X: 'xformOp:rotateX',
  ROTATE_Y: 'xformOp:rotateY',
  ROTATE_Z: 'xformOp:rotateZ',
} as const;

/**
 * Sets a transform matrix on a USD node.
 * USD doesn't allow mixing xformOp:transform (matrix) with individual ops.
 * This sets the matrix and updates xformOpOrder, removing any individual ops.
 */
export function setTransformMatrix(
  node: UsdNode,
  matrix: number[] | Float32Array | ArrayLike<number>
): void {
  if (!node) return;

  const matrixString = formatMatrix(matrix);

  // Set the transform property
  node.setProperty(XFORM_OP_TYPES.TRANSFORM, matrixString);

  // Set xformOpOrder to only include xformOp:transform
  // USD doesn't allow mixing matrix transform with individual ops
  node.setProperty('xformOpOrder', [XFORM_OP_TYPES.TRANSFORM], 'token[]');
}

/**
 * Sets a transform matrix string directly on a USD node.
 * Use this when you already have a formatted matrix string (like from identity matrix).
 */
export function setTransformMatrixString(
  node: UsdNode,
  matrixString: string
): void {
  if (!node) return;

  // Set the transform property
  node.setProperty(XFORM_OP_TYPES.TRANSFORM, matrixString);

  // Set xformOpOrder to only include xformOp:transform
  node.setProperty('xformOpOrder', [XFORM_OP_TYPES.TRANSFORM], 'token[]');
}

/**
 * Gets the current xformOpOrder from a USD node.
 * Returns an array of transform operations, or empty array if not set.
 * USD might store it as an array, a single string, or nothing - we handle all cases.
 */
export function getXformOpOrder(node: UsdNode): string[] {
  if (!node) return [];

  const existingOrder = node.getProperty('xformOpOrder');
  return normalizePropertyToArray(existingOrder).filter((op): op is string => typeof op === 'string');
}

/**
 * Adds transform operations to xformOpOrder.
 * USD doesn't allow mixing matrix transforms with individual ops.
 * This automatically removes xformOp:transform if you're adding individual ops.
 */
export function addXformOps(node: UsdNode, ops: string[]): string[] {
  if (!node || !ops || ops.length === 0) {
    return getXformOpOrder(node);
  }

  const currentOps = getXformOpOrder(node);

  // Remove xformOp:transform if individual ops are being added
  // USD doesn't allow mixing matrix transform with individual ops
  const filteredOps = currentOps.filter(op => op !== XFORM_OP_TYPES.TRANSFORM);

  // Note: We can't actually remove the xformOp:transform property, but setting
  // xformOpOrder without it will make USD ignore it

  // Add new ops that aren't already present
  const newOps = [...filteredOps];
  for (const op of ops) {
    if (op && !newOps.includes(op)) {
      newOps.push(op);
    }
  }

  // Update the node
  node.setProperty('xformOpOrder', newOps, 'token[]');

  return newOps;
}

/**
 * Sets xformOpOrder to a specific array of operations.
 * Automatically removes xformOp:transform if individual ops are being set.
 */
export function setXformOpOrder(node: UsdNode, ops: string[]): void {
  if (!node) return;

  // Remove xformOp:transform if individual ops are being set
  // USD doesn't allow mixing matrix transform with individual ops
  const filteredOps = ops.filter(op => op !== XFORM_OP_TYPES.TRANSFORM);

  node.setProperty('xformOpOrder', filteredOps, 'token[]');
}

/**
 * Removes transform operations from xformOpOrder.
 */
export function removeXformOps(node: UsdNode, ops: string[]): string[] {
  if (!node || !ops || ops.length === 0) {
    return getXformOpOrder(node);
  }

  const currentOps = getXformOpOrder(node);
  const newOps = currentOps.filter(op => !ops.includes(op));

  node.setProperty('xformOpOrder', newOps, 'token[]');

  return newOps;
}

/**
 * Checks if a node has xformOp:transform set.
 */
export function hasTransformMatrix(node: UsdNode): boolean {
  if (!node) return false;
  return !!node.getProperty(XFORM_OP_TYPES.TRANSFORM);
}

/**
 * Checks if a node has individual transform ops (translate, orient, scale) set.
 */
export function hasIndividualXformOps(node: UsdNode): boolean {
  if (!node) return false;

  const ops = getXformOpOrder(node);
  const individualOps: string[] = [
    XFORM_OP_TYPES.TRANSLATE,
    XFORM_OP_TYPES.ORIENT,
    XFORM_OP_TYPES.SCALE,
    XFORM_OP_TYPES.ROTATE_X,
    XFORM_OP_TYPES.ROTATE_Y,
    XFORM_OP_TYPES.ROTATE_Z,
  ];

  return ops.some(op => individualOps.includes(op));
}

