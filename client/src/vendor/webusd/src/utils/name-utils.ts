/** WebUsdFramework.Utils.NameUtils - File and prim name sanitization for USD compliance */

import { NAME_SANITIZATION_PATTERN } from '../constants/usd';

/**
 * Sanitizes a name for use in USD paths
 * 
 * USD paths only allow alphanumeric characters and underscores.
 * All other characters are replaced with underscores.
 * Names must start with a letter or underscore (not a number).
 */
export function sanitizeName(name: string): string {
  if (!name || name.length === 0) {
    return 'Unnamed';
  }

  // Replace invalid characters with underscores
  let sanitized = name.replace(NAME_SANITIZATION_PATTERN, '_');

  // USD identifiers must start with a letter or underscore
  // If it starts with a number, prefix with an underscore
  if (/^[0-9]/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }

  // Remove multiple consecutive underscores
  sanitized = sanitized.replace(/_+/g, '_');

  // Remove leading/trailing underscores (except if we just added one)
  if (!name.match(/^[0-9]/)) {
    sanitized = sanitized.replace(/^_+|_+$/g, '');
  }

  // If result is empty after sanitization, return default
  return sanitized || 'Unnamed';
}

/**
 * Generates a random node name
 */
export function generateRandomNodeName(prefix: string = 'Node'): string {
  const randomId = Math.random().toString(36).substr(2, 9);
  return `${prefix}_${randomId}`;
}

