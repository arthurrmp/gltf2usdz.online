/** WebUsdFramework.Utils.TimeCodeConverter - GLTF seconds to USDA time code mapping */

import { formatUsdArray } from './usd-formatter';

/**
 * Time samples stored in seconds (GLTF format).
 * Maps time in seconds to animation values.
 */
type TimeSamplesInSeconds<T> = Map<number, T>;

/**
 * Time samples stored as frame numbers (USD format).
 * Maps frame numbers to animation values.
 */
type TimeSamplesInTimeCodes<T> = Map<number, T>;


/**
 * Converts animation times from seconds to frame numbers.
 * 
 * GLTF uses fractional seconds (0.033, 0.066) but USD needs whole frame numbers (0, 1, 2).
 * This class handles that conversion and ensures frames start at 0.
 */
export class TimeCodeConverter {
  /**
   * Converts time samples from seconds to frame numbers.
   * 
   * Takes times like 0.033 seconds and converts them to frame numbers like 1.
   * Also normalizes so frames always start at 0 (Xcode requirement).
   * 
   * @param timeSamples - Animation times in seconds
   * @param frameRate - Frame rate to use (defaults to 60fps)
   */
  private static convertToTimeCodes<T>(
    timeSamples: TimeSamplesInSeconds<T>,
    frameRate?: number
  ): TimeSamplesInTimeCodes<T> {
    if (!timeSamples || timeSamples.size === 0) {
      return new Map();
    }

    const effectiveFrameRate = frameRate || 60; // Default to 60fps

    // Convert each time in seconds to an integer frame number
    // USD works best with consecutive integer frames (0, 1, 2, 3...) for smooth interpolation
    const timeCodeMap = new Map<number, { time: number; value: T }[]>();
    const times = Array.from(timeSamples.keys()).sort((a, b) => a - b);

    for (const timeSeconds of times) {
      // Round to nearest frame to get integer time codes
      const timeCode = Math.round(timeSeconds * effectiveFrameRate);
      const value = timeSamples.get(timeSeconds)!;

      if (!timeCodeMap.has(timeCode)) {
        timeCodeMap.set(timeCode, []);
      }
      timeCodeMap.get(timeCode)!.push({ time: timeSeconds, value });
    }

    // If multiple samples map to the same frame, use the one closest to the exact frame time
    // This preserves animation smoothness by keeping the most accurate keyframe
    const finalTimeCodes = new Map<number, T>();

    for (const [timeCode, entries] of timeCodeMap) {
      if (entries.length > 1) {
        // Multiple samples at the same frame - use the one closest to the exact frame time
        // Calculate the exact frame time in seconds
        const exactFrameTime = timeCode / effectiveFrameRate;

        // Find the entry with time closest to the exact frame time
        let closestEntry = entries[0];
        let minDistance = Math.abs(entries[0].time - exactFrameTime);

        for (let i = 1; i < entries.length; i++) {
          const distance = Math.abs(entries[i].time - exactFrameTime);
          if (distance < minDistance) {
            minDistance = distance;
            closestEntry = entries[i];
          }
        }

        finalTimeCodes.set(timeCode, closestEntry.value);
      } else {
        finalTimeCodes.set(timeCode, entries[0].value);
      }
    }

    // Normalize time codes to start at 0
    if (finalTimeCodes.size > 0) {
      const sortedTimeCodes = Array.from(finalTimeCodes.keys()).sort((a, b) => a - b);
      const minTimeCode = sortedTimeCodes[0];

      // Shift all frames so the first one becomes 0
      if (minTimeCode !== 0) {
        const normalizedTimeCodes = new Map<number, T>();
        for (const [timeCode, value] of finalTimeCodes) {
          const normalizedTimeCode = timeCode - minTimeCode;
          normalizedTimeCodes.set(normalizedTimeCode, value);
        }

        return normalizedTimeCodes;
      }
    }

    return finalTimeCodes;
  }

  /**
   * Converts time samples with array values (like joint translations/rotations).
   * 
   * This is for SkelAnimation properties that need arrays formatted as USD strings.
   * Also normalizes time codes to start at 0 for Xcode.
   * 
   * @param timeSamples - Time samples in seconds with array values
   * @param frameRate - Frame rate to use (defaults to 60fps)
   */
  static convertArraysToTimeCodes(
    timeSamples: TimeSamplesInSeconds<string[]>,
    frameRate?: number
  ): TimeSamplesInTimeCodes<string> {
    const timeCodes = this.convertToTimeCodes(timeSamples, frameRate);

    // Format the arrays as USD strings
    const formattedTimeCodes = new Map<number, string>();
    for (const [timeCode, array] of timeCodes) {
      formattedTimeCodes.set(timeCode, formatUsdArray(array));
    }

    return formattedTimeCodes;
  }
}

