/** WebUsdFramework.Utils.Encoding - Buffer and string encoding translation utilities */

/**
 * Generates a deterministic hash-based ID from an input string
 * @param input - The input string to hash
 * @returns A 8-character hash string
 */
export function generateId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36).substr(0, 8);
}

/**
 * Generates a unique ID with timestamp for better uniqueness
 * @param prefix - Optional prefix for the ID
 * @returns A unique hash-based ID
 */
export function generateUniqueId(prefix: string = ''): string {
  const timestamp = Date.now().toString();
  const random = Math.random().toString();
  const input = `${prefix}_${timestamp}_${random}`;
  return generateId(input);
}

/**
 * Generates a deterministic ID for GLTF objects
 * @param object - The GLTF object to generate ID for
 * @param type - The type of object (e.g., 'Texture', 'Material', 'Mesh')
 * @returns A deterministic ID based on object properties
 */
export function generateObjectId(object: { getName?: () => string; toString: () => string }, type: string): string {
  const name = object.getName?.() || '';
  const input = `${type}_${name}_${object.toString()}`;
  return generateId(input);
}
