/** WebUsdFramework.Constants.Animation - USD animation timeline and FPS constants */

export const ANIMATION = {
  /**
   * Standard frame rate for USD animations.
   * USD viewers expect 60 fps for smooth animation playback.
   * This is the standard frame rate used in most USD workflows.
   */
  FRAME_RATE: 60,

  /**
   * Time codes per second for USD animations.
   * This tells USD viewers how to interpret time samples.
   * With timeCodesPerSecond = 60, animations play at real-time speed.
   */
  TIME_CODES_PER_SECOND: 60,

  /**
   * Time code frame rate (120fps) used for converting animation times to USD time codes.
   * Using 120fps ensures we get integer time codes for most common frame rates (24, 30, 60).
   * All animations use this for timeCodesPerSecond to keep playback speed consistent.
   */
  TIME_CODE_FPS: 120.0,

  /**
   * Tolerance for snapping time codes to integer values.
   * When converting time values, if they're very close to an integer, we round them.
   * This prevents floating point precision issues.
   */
  SNAP_TIME_CODE_TOL: 0.001 / 120.0,
} as const;

