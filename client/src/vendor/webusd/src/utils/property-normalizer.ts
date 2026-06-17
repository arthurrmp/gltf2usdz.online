/** WebUsdFramework.Utils.PropertyNormalizer - USD property type formatting and fallback logic */

/**
 * Converts a property value to an array.
 * USD might store it as:
 * - An array: returns a copy
 * - A single string: wraps it in an array
 * - Undefined/null: returns empty array
 * 
 * Useful for properties like rel skel:animationSource or xformOpOrder.
 */
export function normalizePropertyToArray<T>(
  value: T[] | T | undefined | null
): T[] {
  // If it's already an array, return a copy
  if (Array.isArray(value)) {
    return [...value];
  }

  // If it's a single value, wrap it in an array
  if (value !== undefined && value !== null) {
    return [value];
  }

  // Otherwise, return empty array
  return [];
}

/**
 * Gets the first value from a property.
 * Use this when you know a property should have a single value but
 * it might be stored as an array or string.
 */
export function getFirstPropertyValue<T>(
  value: T[] | T | undefined | null
): T | undefined {
  const normalized = normalizePropertyToArray(value);
  return normalized.length > 0 ? normalized[0] : undefined;
}

/**
 * Checks if a property value contains a specific item.
 * Works with arrays, single values, or undefined.
 */
export function propertyContains<T>(
  value: T[] | T | undefined | null,
  item: T
): boolean {
  const normalized = normalizePropertyToArray(value);
  return normalized.includes(item);
}

