/** WebUsdFramework.Utils.UsdFormatter - Textual USDA formatting and indentation tools */

/**
 * Global precision for floating point numbers in USD output.
 * Controls the number of decimal places used throughout the codebase.
 */
export const USD_FLOAT_PRECISION = 7;

/**
 * Converts an array of strings to USD array syntax.
 * Example: ['item1', 'item2'] -> '[item1, item2]'
 * Use this for arrays that don't need quotes (numbers, tuples, etc).
 */
export function formatUsdArray(items: string[]): string {
  if (items.length === 0) {
    return '[]';
  }
  return `[${items.join(', ')}]`;
}

/**
 * Converts an array of strings to USD quoted array syntax.
 * Example: ['path1', 'path2'] -> '["path1", "path2"]'
 * Use this for token arrays (like joint paths) that need quotes.
 */
export function formatUsdQuotedArray(items: string[]): string {
  if (items.length === 0) {
    return '[]';
  }
  return `[${items.map(item => `"${item}"`).join(', ')}]`;
}

/**
 * Converts a number array to USD array syntax.
 * Example: [1, 2, 3] -> '[1, 2, 3]'
 */
export function formatUsdNumberArray(numbers: number[]): string {
  if (numbers.length === 0) {
    return '[]';
  }
  return `[${numbers.map(n => n.toString()).join(', ')}]`;
}

/**
 * Converts a number array to USD array with fixed decimal precision.
 * Example: [1.12, 2.46] with precision 2 -> '[1.12, 2.46]'
 * Good for weights and other values that need consistent precision.
 * Uses global USD_FLOAT_PRECISION by default.
 */
export function formatUsdNumberArrayFixed(
  numbers: number[],
  precision: number = USD_FLOAT_PRECISION
): string {
  if (numbers.length === 0) {
    return '[]';
  }
  return `[${numbers.map(n => n.toFixed(precision)).join(', ')}]`;
}

/**
 * Formats a floating point number with consistent precision.
 * Uses the global USD_FLOAT_PRECISION constant for decimal places.
 * Example: 0.36 -> "0.36" (not "0.36000000000000001")
 */
export function formatUsdFloat(value: number): string {
  // Handle undefined, null, or NaN values
  if (value === undefined || value === null || isNaN(value)) {
    return '0';
  }
  // Use toFixed with global precision then remove trailing zeros
  // This ensures consistent precision without unnecessary trailing zeros
  const fixed = value.toFixed(USD_FLOAT_PRECISION);
  // Remove trailing zeros and decimal point if not needed
  return fixed.replace(/\.?0+$/, '');
}

/**
 * Formats a 2D tuple for USD.
 * Example: (1, 2) -> '(1, 2)'
 * Use for UV coordinates, 2D vectors, etc.
 */
export function formatUsdTuple2(x: number, y: number): string {
  return `(${formatUsdFloat(x)}, ${formatUsdFloat(y)})`;
}

/**
 * Formats a 3D tuple for USD.
 * Example: (1, 2, 3) -> '(1, 2, 3)'
 * Use for positions, normals, translations, scales, etc.
 */
export function formatUsdTuple3(x: number, y: number, z: number): string {
  return `(${formatUsdFloat(x)}, ${formatUsdFloat(y)}, ${formatUsdFloat(z)})`;
}

/**
 * Formats a 4D tuple for USD.
 * Example: (1, 2, 3, 4) -> '(1, 2, 3, 4)'
 * Use for quaternions (w, x, y, z), RGBA colors, etc.
 */
export function formatUsdTuple4(w: number, x: number, y: number, z: number): string {
  return `(${formatUsdFloat(w)}, ${formatUsdFloat(x)}, ${formatUsdFloat(y)}, ${formatUsdFloat(z)})`;
}

/**
 * Converts a flat number array to USD tuple array format.
 * Groups numbers into tuples based on component count.
 * Example: [1, 2, 3, 4, 5, 6] with componentCount=3 -> '[(1, 2, 3), (4, 5, 6)]'
 */
export function formatUsdTupleArray(
  numbers: number[],
  componentCount: number
): string {
  if (numbers.length === 0) {
    return '[]';
  }

  const tuples: string[] = [];
  for (let i = 0; i < numbers.length; i += componentCount) {
    const components = numbers.slice(i, i + componentCount);
    if (componentCount === 2) {
      tuples.push(formatUsdTuple2(components[0], components[1]));
    } else if (componentCount === 3) {
      tuples.push(formatUsdTuple3(components[0], components[1], components[2]));
    } else if (componentCount === 4) {
      tuples.push(formatUsdTuple4(components[0], components[1], components[2], components[3]));
    } else {
      tuples.push(`(${components.join(', ')})`);
    }
  }

  return formatUsdArray(tuples);
}

/**
 * Wraps an array of formatted tuples into USD tuple array syntax.
 * Example: ['(1, 2)', '(3, 4)'] -> '[(1, 2), (3, 4)]'
 * Use this when you already have formatted tuples and just need to wrap them.
 */
export function formatUsdTupleArrayFromStrings(tuples: string[]): string {
  return formatUsdArray(tuples);
}

/**
 * Formats a time-sampled property for USD.
 * If there's only one time sample, use a regular property.
 * If there are multiple, use timeSampledProperty.
 * Returns the formatted value(s) and whether it's time-sampled.
 */
export function formatTimeSampledProperty<T>(
  values: Map<number, T[]>,
  formatter: (items: T[]) => string
): {
  isTimeSampled: boolean;
  singleValue?: string;
  timeSamples?: Map<number, string>;
} {
  if (values.size === 0) {
    return { isTimeSampled: false };
  }

  const sortedTimes = Array.from(values.keys()).sort((a, b) => a - b);

  if (sortedTimes.length === 1) {
    // Single time sample - return as regular property
    const singleValue = formatter(values.get(sortedTimes[0])!);
    return {
      isTimeSampled: false,
      singleValue
    };
  } else {
    // Multiple time samples - return as time-sampled property
    const timeSamples = new Map<number, string>();
    for (const time of sortedTimes) {
      const formatted = formatter(values.get(time)!);
      timeSamples.set(time, formatted);
    }
    return {
      isTimeSampled: true,
      timeSamples
    };
  }
}

