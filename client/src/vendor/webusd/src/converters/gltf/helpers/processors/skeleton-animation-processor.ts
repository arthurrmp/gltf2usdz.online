/**
 * Converts skeleton animations from GLTF to USD format.
 *
 * Takes animations that move bones/joints and creates SkelAnimation prims
 * that USD can play back. This handles character animations like walking,
 * running, or any movement that involves a skeleton.
 */

import { Animation, Skin } from '@gltf-transform/core';
import { UsdNode } from '../../../../core/usd-node';
import { Logger, sanitizeName, formatUsdQuotedArray } from '../../../../utils';
import {
  formatUsdTuple3,
  formatUsdTuple4,
  formatUsdArray,
  formatUsdFloat,
} from '../../../../utils/usd-formatter';
import { ApiSchemaBuilder, API_SCHEMAS } from '../../../../utils/api-schema-builder';
import { SkeletonData } from '../skeleton-processor';
import {
  IAnimationProcessor,
  AnimationProcessorContext,
  AnimationProcessorResult,
} from '../animation-processor-factory';
import { ANIMATION } from '../../../../constants';

/**
 * Stores animation data for a single joint (bone).
 * Each joint can have translations, rotations, and scales that change over time.
 */
interface JointAnimationData {
  jointPath: string;
  translations?: Map<number, string>;
  rotations?: Map<number, string>;
  scales?: Map<number, string>;
}

/**
 * Processes skeleton animations and converts them to USD SkelAnimation format.
 */
export class SkeletonAnimationProcessor implements IAnimationProcessor {
  constructor(private logger: Logger) {}

  /**
   * Converts animation times to USD time codes.
   * Multiplies times by 120fps and rounds to integers when they're close enough.
   * This gives us smooth animation playback in USD viewers.
   */
  private convertToContinuousTimeSamples(
    timeSamples: Map<number, string[]>,
    sortedTimes: number[],
    _frameRate: number
  ): Map<number, string> {
    const formattedTimeCodes = new Map<number, string>();

    for (const timeSeconds of sortedTimes) {
      const array = timeSamples.get(timeSeconds);
      if (array) {
        // Multiply by frame rate to get time code
        const s = ANIMATION.TIME_CODE_FPS * timeSeconds;
        // Round to nearest integer
        const r = Math.round(s);
        // If close to integer, use integer; otherwise use continuous value
        const timeCode = Math.abs(s - r) < ANIMATION.SNAP_TIME_CODE_TOL ? r : s;
        formattedTimeCodes.set(timeCode, formatUsdArray(array));
      }
    }

    return formattedTimeCodes;
  }

  /**
   * Checks if this animation moves skeleton joints (bones).
   * Returns true if any animation channel targets a joint node.
   */
  canProcess(animation: Animation, context: AnimationProcessorContext): boolean {
    if (!context.skeletonMap || context.skeletonMap.size === 0) {
      return false;
    }

    const channels = animation.listChannels();

    // Debug: log channel count and target info
    this.logger.info(`Checking if animation ${animation.getName()} can be processed`, {
      channelCount: channels.length,
      skeletonCount: context.skeletonMap.size,
    });

    for (const channel of channels) {
      const targetNode = channel.getTargetNode();
      if (!targetNode) continue;

      for (const [skin, skeletonData] of context.skeletonMap) {
        // Debug: check if target matches
        const hasTarget = skeletonData.jointNodes.has(targetNode);
        const skinJoints = skin.listJoints();
        const isInSkinJoints = skinJoints.includes(targetNode);

        this.logger.debug(`Checking target node ${targetNode.getName()}`, {
          hasInJointNodesMap: hasTarget,
          isInSkinJoints,
          skinJointCount: skinJoints.length,
          jointNodesMapSize: skeletonData.jointNodes.size,
        });

        if (skeletonData.jointNodes.has(targetNode)) {
          return true;
        }
      }
    }

    // Log why we failed
    if (channels.length > 0) {
      const firstTarget = channels[0].getTargetNode();
      this.logger.warn(
        `Animation ${animation.getName()} targets node ${firstTarget?.getName()} which is not in any skeleton`,
        {
          targetNodeName: firstTarget?.getName(),
          skeletonCount: context.skeletonMap.size,
        }
      );
    } else {
      this.logger.warn(`Animation ${animation.getName()} has no channels`);
    }

    return false;
  }

  /**
   * Converts a GLTF skeleton animation into a USD SkelAnimation prim.
   *
   * This function:
   * 1. Finds which skeleton the animation targets
   * 2. Collects all animation times from all joints
   * 3. Detects the actual frame rate from the time intervals
   * 4. Builds arrays of translations, rotations, and scales for each frame
   * 5. Creates a SkelAnimation prim with time-sampled properties
   */
  process(
    animation: Animation,
    animationIndex: number,
    context: AnimationProcessorContext
  ): AnimationProcessorResult | null {
    if (!context.skeletonMap || context.skeletonMap.size === 0) {
      return null;
    }

    // Figure out which skeletons this animation drives.
    //
    // A single GLTF animation can target joints across multiple skins — e.g.
    // a butterfly-swarm model where every butterfly is its own skinned mesh
    // but they all share one animation. Previously we took the first matching
    // skin and returned one SkelAnimation, leaving the other N-1 SkelRoots
    // frozen in the rest pose. Instead we collect every skin whose jointNodes
    // contain any animated target and emit a SkelAnimation per skin below.
    const channels = animation.listChannels();
    const matchingSkins: Skin[] = [];
    for (const [skin, skeletonData] of context.skeletonMap) {
      for (const channel of channels) {
        const targetNode = channel.getTargetNode();
        if (targetNode && skeletonData.jointNodes.has(targetNode)) {
          matchingSkins.push(skin);
          break;
        }
      }
    }

    if (matchingSkins.length === 0) {
      return null;
    }

    // Accumulators populated inside the per-skin loop below.
    const animationSources: Array<{
      path: string;
      name: string;
      index: number;
      targetSkin: Skin;
    }> = [];
    let aggregateDuration = 0;
    let aggregateDetectedFrameRate: number = ANIMATION.FRAME_RATE;
    let aggregateMaxTimeCode = 0;
    let firstAnimationPath: string | undefined;
    let firstAnimationName: string | undefined;

    for (const targetSkin of matchingSkins) {
      // Get the skeleton data we'll be animating
      const targetSkeleton = context.skeletonMap.get(targetSkin);
      if (!targetSkeleton) {
        continue;
      }

      const animationName = animation.getName() || `Animation_${animationIndex}`;

      // Get the actual skeleton joint paths - if we omitted the root joint, it won't be in this list
      // even though jointNodes might still reference it
      const skeletonJointPaths = targetSkeleton.jointPaths;
      const skeletonJointPathsSet = new Set(skeletonJointPaths);

      // Collect all animation time points from all joints
      // We need every time sample to build complete arrays for each frame
      // Skip joints that aren't in the final skeleton (like omitted root joint)
      const allAnimationTimes = new Set<number>();
      let maxTime = 0;

      for (const channel of channels) {
        const targetNode = channel.getTargetNode();
        if (!targetNode || !targetSkeleton.jointNodes.has(targetNode)) continue;

        const jointUsdNode = targetSkeleton.jointNodes.get(targetNode);
        if (!jointUsdNode) continue;

        const jointPath = jointUsdNode.getPath();

        // Skip this joint if it's not in the final skeleton (e.g., omitted root joint)
        if (!skeletonJointPathsSet.has(jointPath)) {
          continue;
        }

        const sampler = channel.getSampler();
        if (!sampler) continue;

        const input = sampler.getInput();
        if (!input) continue;

        const inputArray = input.getArray();
        if (!inputArray) continue;

        const times = Array.from(inputArray as Float32Array);
        for (const time of times) {
          allAnimationTimes.add(time);
        }

        if (times.length > 0) {
          for (const t of times) {
            if (t > maxTime) maxTime = t;
          }
        }
      }

      // Sort times so we can work through them in order
      const sortedAllTimes = Array.from(allAnimationTimes).sort((a, b) => a - b);

      // Figure out the actual frame rate by looking at time intervals
      // This prevents sparse time codes (like 0, 2, 4, 6) and gives us consecutive frames (0, 1, 2, 3)
      let detectedFrameRate: number = ANIMATION.FRAME_RATE;
      if (sortedAllTimes.length > 1) {
        const intervals: number[] = [];
        for (let i = 1; i < Math.min(sortedAllTimes.length, 100); i++) {
          const interval = sortedAllTimes[i] - sortedAllTimes[i - 1];
          if (interval > 0) {
            intervals.push(interval);
          }
        }
        if (intervals.length > 0) {
          const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const rawFrameRate = 1 / avgInterval;
          // Round to nearest standard frame rate (24, 30, 60)
          const standardRates = [24, 30, 60];
          detectedFrameRate = standardRates.reduce((prev, curr) =>
            Math.abs(curr - rawFrameRate) < Math.abs(prev - rawFrameRate) ? curr : prev
          );
        }
      }

      this.logger.info(`Collected all animation times`, {
        animationName,
        totalUniqueTimes: sortedAllTimes.length,
        firstTime: sortedAllTimes[0],
        lastTime: sortedAllTimes[sortedAllTimes.length - 1],
        duration: sortedAllTimes[sortedAllTimes.length - 1] - sortedAllTimes[0],
        detectedFrameRate,
        defaultFrameRate: ANIMATION.FRAME_RATE,
        first10Times: sortedAllTimes.slice(0, 10),
        last10Times: sortedAllTimes.slice(-10),
        middle10Times:
          sortedAllTimes.length > 20
            ? sortedAllTimes.slice(
                Math.floor(sortedAllTimes.length / 2) - 5,
                Math.floor(sortedAllTimes.length / 2) + 5
              )
            : [],
      });

      // Collect animation data for each joint
      // Only process joints that are in the final skeleton (skip omitted root joint)
      const jointAnimations = new Map<string, JointAnimationData>();
      const collectedJointPaths = new Set<string>();

      for (const channel of channels) {
        const targetNode = channel.getTargetNode();
        if (!targetNode || !targetSkeleton.jointNodes.has(targetNode)) continue;

        const jointUsdNode = targetSkeleton.jointNodes.get(targetNode);
        if (!jointUsdNode) continue;

        const jointPath = jointUsdNode.getPath();

        // Skip joints that aren't in the final skeleton (e.g., omitted root joint)
        if (!skeletonJointPathsSet.has(jointPath)) {
          this.logger.debug('Skipping animation data for omitted joint', {
            jointPath,
            jointName: targetNode.getName(),
            rootJointOmitted: targetSkeleton.rootJointOmitted,
          });
          continue;
        }

        collectedJointPaths.add(jointPath);

        this.logger.debug('Collecting animation data for joint', {
          jointPath,
          jointName: targetNode.getName(),
          targetPath: channel.getTargetPath(),
          isInSkeleton: skeletonJointPathsSet.has(jointPath),
        });

        const sampler = channel.getSampler();
        if (!sampler) continue;

        const input = sampler.getInput();
        const output = sampler.getOutput();
        if (!input || !output) continue;

        const inputArray = input.getArray();
        const outputArray = output.getArray();
        if (!inputArray || !outputArray) continue;

        const times = Array.from(inputArray as Float32Array);
        const values = Array.from(outputArray as Float32Array);
        const targetPath = channel.getTargetPath();

        // Check interpolation mode — CUBICSPLINE stores 3× the data per keyframe
        // Layout: [inTangent, value, outTangent] per component per keyframe
        const interpolation = sampler.getInterpolation();

        let jointAnim = jointAnimations.get(jointPath);
        if (!jointAnim) {
          jointAnim = { jointPath };
          jointAnimations.set(jointPath, jointAnim);
        }

        // Store the animation values for this joint at each time point
        const timeSamples = new Map<number, string>();
        const componentCount = targetPath === 'rotation' ? 4 : 3;
        // CUBICSPLINE: stride is 3× componentCount (inTangent + value + outTangent)
        const stride = interpolation === 'CUBICSPLINE' ? componentCount * 3 : componentCount;

        for (let i = 0; i < times.length; i++) {
          const time = times[i];
          const startIdx = i * stride + (interpolation === 'CUBICSPLINE' ? componentCount : 0);
          const value = values.slice(startIdx, startIdx + componentCount);

          let valueString: string;
          if (componentCount === 3) {
            // Format as (x, y, z) tuple with consistent precision
            valueString = formatUsdTuple3(value[0], value[1], value[2]);
          } else {
            // Rotations: GLTF stores (x,y,z,w) but USD wants (w,x,y,z)
            valueString = formatUsdTuple4(value[3], value[0], value[1], value[2]);
          }
          timeSamples.set(time, valueString);
        }

        // STEP interpolation: simulate by inserting a hold sample one frame before
        // each keyframe transition so USD's linear interpolator holds the value.
        if (interpolation === 'STEP' && timeSamples.size > 1) {
          const frameEpsilon = 1 / 120; // one frame at 120 timeCodesPerSecond
          const sortedTimes = Array.from(timeSamples.keys()).sort((a, b) => a - b);
          for (let si = 0; si < sortedTimes.length - 1; si++) {
            const holdTime = sortedTimes[si + 1] - frameEpsilon;
            if (holdTime > sortedTimes[si]) {
              timeSamples.set(holdTime, timeSamples.get(sortedTimes[si])!);
            }
          }
        }

        if (targetPath === 'translation') {
          jointAnim.translations = timeSamples;
        } else if (targetPath === 'rotation') {
          jointAnim.rotations = timeSamples;
        } else if (targetPath === 'scale') {
          jointAnim.scales = timeSamples;
        }
      }

      // Create the SkelAnimation node as a child of Skeleton
      // Structure: SkelRoot -> Skeleton -> SkelAnimation
      const skeletonPrimNode = targetSkeleton.skeletonPrimNode;
      const skeletonPrimPath = skeletonPrimNode.getPath();
      const skeletonPrimName = skeletonPrimNode.getName();
      const sanitizedName = sanitizeName(animationName);
      const animationPath = `${skeletonPrimPath}/${skeletonPrimName}_${sanitizedName}`;

      const skelAnimationNode = new UsdNode(animationPath, 'SkelAnimation');

      // Use relative joint paths (like "root", "root/body")
      // These must match the paths used in the Skeleton prim's joints array
      const allSkeletonJointRelativePaths =
        targetSkeleton.jointRelativePaths || targetSkeleton.jointPaths;
      // skeletonJointPaths was already defined above when filtering animation channels

      const sortedTimes = sortedAllTimes;

      // USD needs translations, rotations, and scales at every time point
      // If a joint doesn't animate at a specific time, we use the closest value we have
      const translations = new Map<number, string[]>();
      const rotations = new Map<number, string[]>();
      const scales = new Map<number, string[]>();

      // Helper to interpolate a value at a specific time
      // Finds the two keyframes that bracket the requested time and interpolates between them
      const getValueAtTime = (
        timeSamples: Map<number, string>,
        time: number,
        defaultValue: string,
        isQuaternion: boolean = false
      ): string => {
        if (timeSamples.has(time)) {
          return timeSamples.get(time)!;
        }

        const sorted = Array.from(timeSamples.keys()).sort((a, b) => a - b);
        if (sorted.length === 0) return defaultValue;

        // Find the two keyframes that bracket this time
        let i0 = -1;
        let i1 = sorted.length;

        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i] <= time) {
            i0 = i;
          }
          if (sorted[i] >= time && i1 === sorted.length) {
            i1 = i;
            break;
          }
        }

        // If before first keyframe, use first value
        if (i0 < 0) {
          return timeSamples.get(sorted[i1]) || defaultValue;
        }

        // If after last keyframe, use last value
        if (i1 >= sorted.length) {
          return timeSamples.get(sorted[i0]) || defaultValue;
        }

        // If exactly on a keyframe
        if (i0 === i1) {
          return timeSamples.get(sorted[i0]) || defaultValue;
        }

        // Interpolate between bounding keyframes
        const t0 = sorted[i0];
        const t1 = sorted[i1];
        const v0 = timeSamples.get(t0)!;
        const v1 = timeSamples.get(t1)!;

        // Parse tuple values
        const parseTuple = (tupleStr: string): number[] => {
          const match = tupleStr.match(/\(([^)]+)\)/);
          if (!match) return [];
          return match[1].split(',').map(s => parseFloat(s.trim()));
        };

        const p0 = parseTuple(v0);
        const p1 = parseTuple(v1);

        if (p0.length === 0 || p1.length === 0) {
          return defaultValue;
        }

        // Calculate interpolation factor
        const dt = t1 - t0;
        const kAnimDtMin = 0.00001; // Minimum delta time for interpolation
        const s = dt < kAnimDtMin ? 0.0 : (time - t0) / dt;

        // Interpolate: linear for translations/scales, SLERP for rotations
        let interpolated: number[];
        if (isQuaternion && p0.length === 4 && p1.length === 4) {
          // SLERP for quaternions (w, x, y, z format)
          const [w0, x0, y0, z0] = p0;
          const [w1, x1, y1, z1] = p1;

          // Calculate dot product
          let dot = w0 * w1 + x0 * x1 + y0 * y1 + z0 * z1;

          // If dot < 0, negate one quaternion to take shorter path
          let w1_final = w1;
          let x1_final = x1;
          let y1_final = y1;
          let z1_final = z1;
          if (dot < 0) {
            dot = -dot;
            w1_final = -w1;
            x1_final = -x1;
            y1_final = -y1;
            z1_final = -z1;
          }

          // If quaternions are very close, use linear interpolation
          if (dot > 0.9995) {
            interpolated = [
              w0 + (w1_final - w0) * s,
              x0 + (x1_final - x0) * s,
              y0 + (y1_final - y0) * s,
              z0 + (z1_final - z0) * s,
            ];
          } else {
            // SLERP
            const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
            const sinTheta = Math.sin(theta);
            const w = Math.sin((1 - s) * theta) / sinTheta;
            const v = Math.sin(s * theta) / sinTheta;
            interpolated = [
              w * w0 + v * w1_final,
              w * x0 + v * x1_final,
              w * y0 + v * y1_final,
              w * z0 + v * z1_final,
            ];
          }
        } else {
          // Linear interpolation for translations/scales
          interpolated = p0.map((val, i) => val + (p1[i] - val) * s);
        }

        // Format back to tuple string
        if (interpolated.length === 3) {
          return `(${interpolated.map(v => formatUsdFloat(v)).join(', ')})`;
        } else if (interpolated.length === 4) {
          return `(${interpolated.map(v => formatUsdFloat(v)).join(', ')})`;
        }

        return defaultValue;
      };

      // Build arrays for each time point with values for all joints
      // IMPORTANT: Joint order in animation arrays must match skeleton joints array exactly
      // We iterate over skeleton joints in order (not animation channels) to guarantee correct mapping
      for (const time of sortedTimes) {
        const transArray: string[] = [];
        const rotArray: string[] = [];
        const scaleArray: string[] = [];

        // Use rest pose TRS as defaults for joints without animation channels
        const restPoseTranslations = targetSkeleton.restPoseTranslations || [];
        const restPoseRotations = targetSkeleton.restPoseRotations || [];
        const restPoseScales = targetSkeleton.restPoseScales || [];

        if (time === sortedTimes[0] && restPoseTranslations.length > 0) {
          this.logger.debug('Using rest pose translations as defaults', {
            animationName,
            restPoseTranslationCount: restPoseTranslations.length,
            skeletonJointCount: skeletonJointPaths.length,
            first3RestPoseTranslations: restPoseTranslations.slice(0, 3),
          });
        }

        // Iterate over skeleton joints in their exact order to ensure correct mapping
        for (let i = 0; i < skeletonJointPaths.length; i++) {
          const jointPath = skeletonJointPaths[i];
          const jointAnim = jointAnimations.get(jointPath);

          // Use rest pose translation if this joint doesn't have translation animation
          // This prevents joints from defaulting to (0, 0, 0) when they should use their rest pose position
          const defaultTranslation =
            i < restPoseTranslations.length ? restPoseTranslations[i] : '(0, 0, 0)';
          if (jointAnim?.translations) {
            transArray.push(getValueAtTime(jointAnim.translations, time, defaultTranslation));
          } else {
            transArray.push(defaultTranslation);
          }

          // Get rotation, using rest pose if this joint doesn't animate
          // Use SLERP interpolation for rotations (isQuaternion = true)
          const defaultRotation =
            i < restPoseRotations.length ? restPoseRotations[i] : '(1, 0, 0, 0)';
          if (jointAnim?.rotations) {
            rotArray.push(getValueAtTime(jointAnim.rotations, time, defaultRotation, true));
          } else {
            rotArray.push(defaultRotation);
          }

          // Get scale, using rest pose if this joint doesn't animate
          const defaultScale =
            i < restPoseScales.length ? restPoseScales[i] : '(1, 1, 1)';
          if (jointAnim?.scales) {
            scaleArray.push(getValueAtTime(jointAnim.scales, time, defaultScale));
          } else {
            scaleArray.push(defaultScale);
          }
        }

        // Store arrays for this time point
        translations.set(time, transArray);
        rotations.set(time, rotArray);
        scales.set(time, scaleArray);
      }

      // Validate that animation arrays match skeleton joint count
      // IMPORTANT: Joint order in animation arrays must match skeleton joints array exactly
      const validationTime = sortedTimes[0];
      if (translations.has(validationTime)) {
        const transLength = translations.get(validationTime)!.length;
        const expectedLength = skeletonJointPaths.length;
        if (transLength !== expectedLength) {
          this.logger.error('Animation array length mismatch!', {
            animationName,
            expectedLength,
            actualLength: transLength,
            skeletonJointCount: expectedLength,
          });
        } else {
          // Log joint order info to help debug skeleton mapping issues
          const firstJointPath = skeletonJointPaths[0];
          const lastJointPath = skeletonJointPaths[skeletonJointPaths.length - 1];
          const animatedJointCount = jointAnimations.size;
          this.logger.info('Animation array length matches skeleton joints', {
            animationName,
            arrayLength: transLength,
            skeletonJointCount: expectedLength,
            animatedJointCount,
            firstSkeletonJointPath: firstJointPath,
            lastSkeletonJointPath: lastJointPath,
            firstAnimatedJointPath: Array.from(jointAnimations.keys())[0] || 'none',
            skeletonJointOrderPreserved: true,
          });

          // Log which joints have animation data vs which don't
          const jointsWithoutAnimation: string[] = [];
          for (let i = 0; i < skeletonJointPaths.length; i++) {
            const jointPath = skeletonJointPaths[i];
            if (!jointAnimations.has(jointPath)) {
              jointsWithoutAnimation.push(jointPath);
            }
          }

          if (jointsWithoutAnimation.length > 0) {
            this.logger.warn('Some skeleton joints have no animation data', {
              animationName,
              jointsWithoutAnimationCount: jointsWithoutAnimation.length,
              first5WithoutAnimation: jointsWithoutAnimation
                .slice(0, 5)
                .map(p => p.split('/').pop() || p),
              totalSkeletonJoints: skeletonJointPaths.length,
              totalAnimatedJoints: jointAnimations.size,
            });
          } else {
            this.logger.info('All skeleton joints have animation data', {
              animationName,
              totalJoints: skeletonJointPaths.length,
            });
          }

          // Log collected joint paths vs skeleton joint paths
          this.logger.info('Animation data collection summary', {
            animationName,
            collectedJointPathsCount: collectedJointPaths.size,
            skeletonJointPathsCount: skeletonJointPaths.length,
            collectedJointNames: Array.from(collectedJointPaths)
              .slice(0, 5)
              .map(p => p.split('/').pop() || p),
            skeletonJointNames: skeletonJointPaths.slice(0, 5).map(p => p.split('/').pop() || p),
            allCollectedMatchSkeleton: skeletonJointPaths.every(p => collectedJointPaths.has(p)),
          });
        }
      }

      // Make sure translations, rotations, and scales all have values at the same times
      // USD requires all three to use identical time samples
      const allCommonTimes = new Set<number>();
      for (const time of translations.keys()) allCommonTimes.add(time);
      for (const time of rotations.keys()) allCommonTimes.add(time);
      for (const time of scales.keys()) allCommonTimes.add(time);

      const sortedCommonTimes = Array.from(allCommonTimes).sort((a, b) => a - b);

      // Fill in any missing values so all three components have data at every time
      for (const time of sortedCommonTimes) {
        if (!translations.has(time)) {
          const firstTime = sortedCommonTimes[0];
          translations.set(
            time,
            translations.has(firstTime)
              ? [...translations.get(firstTime)!]
              : skeletonJointPaths.map(() => '(0, 0, 0)')
          );
        }
        if (!rotations.has(time)) {
          const firstTime = sortedCommonTimes[0];
          rotations.set(
            time,
            rotations.has(firstTime)
              ? [...rotations.get(firstTime)!]
              : skeletonJointPaths.map(() => '(1, 0, 0, 0)')
          );
        }
        if (!scales.has(time)) {
          const firstTime = sortedCommonTimes[0];
          scales.set(
            time,
            scales.has(firstTime)
              ? [...scales.get(firstTime)!]
              : skeletonJointPaths.map(() => '(1, 1, 1)')
          );
        }
      }

      // Note: Previously forced looping by overwriting the last frame with the first.
      // This was removed because it silently corrupts non-looping animations
      // (e.g., death, jump, transitions). Looping should be handled by the
      // consumer/player, not baked into the conversion.

      // Set the joints array using relative paths
      const jointsArray = formatUsdQuotedArray(allSkeletonJointRelativePaths);
      skelAnimationNode.setProperty('uniform token[] joints', jointsArray, 'raw');

      // Convert animation times to USD time codes
      // Multiply by 120fps and round to integers when close
      // This ensures smooth playback in USD viewers
      const transTimeCodes = this.convertToContinuousTimeSamples(
        translations,
        sortedCommonTimes,
        detectedFrameRate
      );
      const rotTimeCodes = this.convertToContinuousTimeSamples(
        rotations,
        sortedCommonTimes,
        detectedFrameRate
      );
      const scaleTimeCodes = this.convertToContinuousTimeSamples(
        scales,
        sortedCommonTimes,
        detectedFrameRate
      );

      // Get the first frame values to use as defaults (the rest pose)
      // Time codes are now multiplied by TIME_CODE_FPS, so get the first time code
      const firstTimeSeconds = sortedCommonTimes[0];
      const firstTimeCode = Math.round(ANIMATION.TIME_CODE_FPS * firstTimeSeconds);
      const timeCode0Translations = transTimeCodes.get(firstTimeCode);
      const timeCode0Rotations = rotTimeCodes.get(firstTimeCode);
      const timeCode0Scales = scaleTimeCodes.get(firstTimeCode);

      const defaultTranslations =
        timeCode0Translations ||
        (translations.has(firstTimeSeconds)
          ? `[${translations.get(firstTimeSeconds)!.join(', ')}]`
          : `[${skeletonJointPaths.map(() => '(0, 0, 0)').join(', ')}]`);
      const defaultRotations =
        timeCode0Rotations ||
        (rotations.has(firstTimeSeconds)
          ? `[${rotations.get(firstTimeSeconds)!.join(', ')}]`
          : `[${skeletonJointPaths.map(() => '(1, 0, 0, 0)').join(', ')}]`);
      const defaultScales =
        timeCode0Scales ||
        (scales.has(firstTimeSeconds)
          ? `[${scales.get(firstTimeSeconds)!.join(', ')}]`
          : `[${skeletonJointPaths.map(() => '(1, 1, 1)').join(', ')}]`);

      // Set default values (the pose before animation starts)
      skelAnimationNode.setProperty('float3[] translations', defaultTranslations, 'raw');
      skelAnimationNode.setProperty('quatf[] rotations', defaultRotations, 'raw');
      skelAnimationNode.setProperty('half3[] scales', defaultScales, 'raw');

      // Set the time-sampled animation data
      if (transTimeCodes.size > 0) {
        skelAnimationNode.setTimeSampledProperty(
          'float3[] translations',
          transTimeCodes,
          'float3[]'
        );
      }

      if (rotTimeCodes.size > 0) {
        skelAnimationNode.setTimeSampledProperty('quatf[] rotations', rotTimeCodes, 'quatf[]');
      }

      if (scaleTimeCodes.size > 0) {
        skelAnimationNode.setTimeSampledProperty('half3[] scales', scaleTimeCodes, 'half3[]');
      }

      // Add SkelAnimation as a child of Skeleton
      skeletonPrimNode.addChild(skelAnimationNode);
      const finalTransTimes = Array.from(transTimeCodes.keys()).sort((a, b) => a - b);
      const finalRotTimes = Array.from(rotTimeCodes.keys()).sort((a, b) => a - b);
      const finalScaleTimes = Array.from(scaleTimeCodes.keys()).sort((a, b) => a - b);

      this.logger.info(`Created SkelAnimation: ${animationName}`, {
        animationName,
        animationPath,
        timeSamples: sortedCommonTimes.length,
        duration: maxTime,
        translationSamples: finalTransTimes.length,
        rotationSamples: finalRotTimes.length,
        scaleSamples: finalScaleTimes.length,
        firstTime: sortedCommonTimes[0],
        lastTime: sortedCommonTimes[sortedCommonTimes.length - 1],
        timeRange: `${sortedCommonTimes[0]} - ${sortedCommonTimes[sortedCommonTimes.length - 1]}`,
        first10Times: sortedCommonTimes.slice(0, 10),
        last10Times: sortedCommonTimes.slice(-10),
      });

      // Calculate max time code by multiplying max time by the time code frame rate
      const maxTimeCode = Math.ceil(maxTime * ANIMATION.TIME_CODE_FPS);

      const skelAnimationSourceName = `${skeletonPrimName}_${sanitizedName}`;
      animationSources.push({
        path: animationPath,
        name: skelAnimationSourceName,
        index: animationIndex,
        targetSkin,
      });

      if (maxTime > aggregateDuration) aggregateDuration = maxTime;
      if (detectedFrameRate > aggregateDetectedFrameRate) {
        aggregateDetectedFrameRate = detectedFrameRate;
      }
      if (maxTimeCode > aggregateMaxTimeCode) aggregateMaxTimeCode = maxTimeCode;
      if (!firstAnimationPath) {
        firstAnimationPath = animationPath;
        firstAnimationName = skelAnimationSourceName;
      }
    } // end for (const targetSkin of matchingSkins)

    if (animationSources.length === 0) {
      return null;
    }

    // Both firstAnimationPath and firstAnimationName are set on the first
    // iteration that successfully pushes a source, so they are defined here.
    const result: AnimationProcessorResult = {
      duration: aggregateDuration,
      detectedFrameRate: aggregateDetectedFrameRate,
      maxTimeCode: aggregateMaxTimeCode,
      animationSources,
    };
    if (firstAnimationPath) result.path = firstAnimationPath;
    if (firstAnimationName) result.name = firstAnimationName;
    return result;
  }
}

/**
 * Tells USDZ viewers which animation to play by setting the animation source.
 *
 * This connects the skeleton to its SkelAnimation so viewers know what to play.
 */
export function setSkeletonAnimationSources(
  animationSourcesMap: Map<
    Skin,
    Array<{ path: string; name: string; index: number; duration: number }>
  >,
  skeletonMap: Map<Skin, SkeletonData>,
  logger: Logger
): void {
  for (const [skin, animationSources] of animationSourcesMap) {
    const skeletonData = skeletonMap.get(skin);
    if (!skeletonData || animationSources.length === 0) continue;

    const skelRootNode = skeletonData.skelRootNode;
    const skelPrim = skeletonData.skeletonPrimNode;

    // Find the best animation to use as default (longest duration)
    // If all have 0 duration, use the first one
    let defaultAnim = animationSources[0];
    let maxDuration = -1;

    for (const anim of animationSources) {
      if (anim.duration > maxDuration) {
        maxDuration = anim.duration;
        defaultAnim = anim;
      }
    }

    const defaultAnimationSource = `<${defaultAnim.path}>`;

    const isUsingIndex0 = defaultAnim.index === 0;
    logger.info(`Setting animation source for skeleton`, {
      skeletonPath: skelRootNode.getPath(),
      skeletonPrimPath: skelPrim?.getPath(),
      animationIndex: defaultAnim.index,
      animationName: defaultAnim.name,
      animationPath: defaultAnim.path,
      duration: defaultAnim.duration,
      isUsingIndex0,
      totalAnimations: animationSources.length,
    });

    // Set animation source on Skeleton prim
    if (skelPrim) {
      ApiSchemaBuilder.addApiSchema(skelPrim, API_SCHEMAS.SKEL_BINDING);
      skelPrim.setProperty('rel skel:animationSource', defaultAnimationSource, 'rel');
    }

    // Also set animation source on SkelRoot - Xcode/RealityKit needs it here, not just on the Skeleton prim
    ApiSchemaBuilder.addApiSchema(skelRootNode, API_SCHEMAS.SKEL_BINDING);
    skelRootNode.setProperty('rel skel:animationSource', defaultAnimationSource, 'rel');

    // Set the default animation name in customData
    if (animationSources.length > 0) {
      skelRootNode.setProperty('customData', { defaultAnimation: defaultAnim.name });
      logger.info('Set customData.defaultAnimation on SkelRoot', {
        skelRootPath: skelRootNode.getPath(),
        defaultAnimation: defaultAnim.name,
        animationPath: defaultAnim.path,
      });
    }

    logger.info(`Set all animations on skeleton`, {
      skeletonPath: skelRootNode.getPath(),
      animationCount: animationSources.length,
      animations: animationSources.map(a => ({
        index: a.index,
        name: a.name,
        duration: a.duration,
      })),
    });
  }
}
