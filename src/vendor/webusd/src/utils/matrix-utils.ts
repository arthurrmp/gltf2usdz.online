/** WebUsdFramework.Utils.MatrixUtils - 4x4 affine transformation matrix operations */

import { formatUsdFloat } from './usd-formatter';

/**
 * Identity matrix in USD format (row-major).
 * This is the default transform when no transformation is applied.
 */
export const IDENTITY_MATRIX = '( (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1) )';

/**
 * Formats a 4x4 matrix array into USD matrix string format (row-major).
 * Takes a 16-element array and formats it as USD expects.
 * Example: [1, 0, 0, 0, 0, 1, 0, 0, ...] -> '( (1, 0, 0, 0), (0, 1, 0, 0), ... )'
 */
export function formatMatrix(matrix: number[] | Float32Array | ArrayLike<number>): string {
  if (!matrix || matrix.length < 16) {
    return IDENTITY_MATRIX;
  }

  // Convert to array if needed (handles Float32Array, etc.)
  const m = Array.from(matrix);

  // Format as USD matrix (row-major) with consistent 7 decimal place precision
  return `( (${formatUsdFloat(m[0])}, ${formatUsdFloat(m[1])}, ${formatUsdFloat(m[2])}, ${formatUsdFloat(m[3])}), (${formatUsdFloat(m[4])}, ${formatUsdFloat(m[5])}, ${formatUsdFloat(m[6])}, ${formatUsdFloat(m[7])}), (${formatUsdFloat(m[8])}, ${formatUsdFloat(m[9])}, ${formatUsdFloat(m[10])}, ${formatUsdFloat(m[11])}), (${formatUsdFloat(m[12])}, ${formatUsdFloat(m[13])}, ${formatUsdFloat(m[14])}, ${formatUsdFloat(m[15])}) )`;
}

/**
 * Formats a matrix from individual components.
 * Use this when building matrices manually - pass all 16 components.
 */
export function formatMatrixFromComponents(
  m00: number, m01: number, m02: number, m03: number,
  m10: number, m11: number, m12: number, m13: number,
  m20: number, m21: number, m22: number, m23: number,
  m30: number, m31: number, m32: number, m33: number
): string {
  // Format as USD matrix (row-major) with consistent 7 decimal place precision
  return `( (${formatUsdFloat(m00)}, ${formatUsdFloat(m01)}, ${formatUsdFloat(m02)}, ${formatUsdFloat(m03)}), (${formatUsdFloat(m10)}, ${formatUsdFloat(m11)}, ${formatUsdFloat(m12)}, ${formatUsdFloat(m13)}), (${formatUsdFloat(m20)}, ${formatUsdFloat(m21)}, ${formatUsdFloat(m22)}, ${formatUsdFloat(m23)}), (${formatUsdFloat(m30)}, ${formatUsdFloat(m31)}, ${formatUsdFloat(m32)}, ${formatUsdFloat(m33)}) )`;
}

/**
 * Returns the identity matrix in USD format.
 * Just returns the constant for consistency.
 */
export function getIdentityMatrix(): string {
  return IDENTITY_MATRIX;
}

/**
 * Builds a 4x4 transformation matrix from translation, rotation (quaternion), and scale.
 * Quaternion format: (w, x, y, z) as used in USD
 * Returns the matrix as a USD-formatted string.
 */
export function buildMatrixFromTRS(
  translation: [number, number, number] | string,
  rotation: [number, number, number, number] | string,
  scale: [number, number, number] | string = [1, 1, 1]
): string {
  // Parse string inputs if needed
  let t: [number, number, number];
  let r: [number, number, number, number];
  let s: [number, number, number];

  if (typeof translation === 'string') {
    // Parse "(x, y, z)" format
    const match = translation.match(/\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (!match) throw new Error(`Invalid translation format: ${translation}`);
    t = [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
  } else {
    t = translation;
  }

  if (typeof rotation === 'string') {
    // Parse "(w, x, y, z)" format
    const match = rotation.match(/\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (!match) throw new Error(`Invalid rotation format: ${rotation}`);
    r = [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]), parseFloat(match[4])];
  } else {
    r = rotation;
  }

  if (typeof scale === 'string') {
    // Parse "(x, y, z)" format
    const match = scale.match(/\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (!match) throw new Error(`Invalid scale format: ${scale}`);
    s = [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
  } else {
    s = scale;
  }

  // Extract quaternion components (w, x, y, z)
  const [qw, qx, qy, qz] = r;

  // Build rotation matrix from quaternion
  // Quaternion to rotation matrix conversion
  const xx = qx * qx;
  const yy = qy * qy;
  const zz = qz * qz;
  const xy = qx * qy;
  const xz = qx * qz;
  const yz = qy * qz;
  const wx = qw * qx;
  const wy = qw * qy;
  const wz = qw * qz;

  // Rotation matrix (row-major)
  const m00 = 1 - 2 * (yy + zz);
  const m01 = 2 * (xy - wz);
  const m02 = 2 * (xz + wy);
  const m10 = 2 * (xy + wz);
  const m11 = 1 - 2 * (xx + zz);
  const m12 = 2 * (yz - wx);
  const m20 = 2 * (xz - wy);
  const m21 = 2 * (yz + wx);
  const m22 = 1 - 2 * (xx + yy);

  // Apply scale to rotation matrix (S * R)
  // USD uses S * R * T order (reversed from GLTF's T * R * S)
  // Scale is applied per-row: row 0 uses s[0], row 1 uses s[1], row 2 uses s[2]
  const m00s = m00 * s[0];
  const m01s = m01 * s[0];
  const m02s = m02 * s[0];
  const m10s = m10 * s[1];
  const m11s = m11 * s[1];
  const m12s = m12 * s[1];
  const m20s = m20 * s[2];
  const m21s = m21 * s[2];
  const m22s = m22 * s[2];

  // Build final matrix (row-major): S * R * T
  // Translation goes in 4th row (m30, m31, m32), not 4th column
  // This matches USD's matrix format convention
  return formatMatrixFromComponents(
    m00s, m01s, m02s, 0.0,
    m10s, m11s, m12s, 0.0,
    m20s, m21s, m22s, 0.0,
    t[0], t[1], t[2], 1.0
  );
}

