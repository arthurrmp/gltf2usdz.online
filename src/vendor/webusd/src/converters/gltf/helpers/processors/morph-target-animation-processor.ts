/**
 * Converts morph target (blend shape) animations from GLTF to USD format.
 *
 * Handles animations that change morph target weights over time.
 * Morph targets are used for facial expressions, cloth deformation, and other shape changes.
 */

import { Animation } from '@gltf-transform/core';
import { UsdNode } from '../../../../core/usd-node';
import { Logger } from '../../../../utils';
import { ANIMATION } from '../../../../constants';
import { IAnimationProcessor, AnimationProcessorContext, AnimationProcessorResult } from '../animation-processor-factory';
import { TimeCodeConverter } from '../../../../utils/time-code-converter';
import { formatUsdNumberArrayFixed } from '../../../../utils/usd-formatter';

/**
 * Stores morph target animation data for a mesh.
 * Contains time-sampled weights for each morph target.
 */
interface MorphTargetAnimationData {
  meshNode: UsdNode;
  weights: Map<number, number[]>; // Time in seconds -> array of weights (one per morph target)
  morphTargetCount: number;
}

/**
 * Processes morph target animations and applies them to USD mesh nodes.
 */
export class MorphTargetAnimationProcessor implements IAnimationProcessor {
  constructor(private logger: Logger) { }

  /**
   * Checks if this animation targets morph target weights.
   * Returns true if any channel has targetPath === 'weights'.
   */
  canProcess(animation: Animation, _context: AnimationProcessorContext): boolean {
    const channels = animation.listChannels();

    for (const channel of channels) {
      const targetPath = channel.getTargetPath();
      if (targetPath === 'weights') {
        // This is a morph target animation
        return true;
      }
    }

    return false;
  }

  /**
   * Converts a GLTF morph target animation into USD blend shape weights.
   * 
   * Extracts morph target data from the mesh primitive and creates
   * time-sampled blend shape weights on the USD mesh node.
   */
  process(
    animation: Animation,
    animationIndex: number,
    context: AnimationProcessorContext
  ): AnimationProcessorResult | null {
    const animationName = animation.getName() || `Animation_${animationIndex}`;
    const channels = animation.listChannels();

    if (channels.length === 0) {
      return null;
    }

    // Collect all animation times and find target meshes
    const allAnimationTimes = new Set<number>();
    let maxTime = 0;
    const meshAnimations = new Map<UsdNode, MorphTargetAnimationData>();

    this.logger.info(`Processing morph target animation channels`, {
      animationName,
      totalChannels: channels.length,
      channelTargets: channels.map(ch => ({
        targetNode: ch.getTargetNode()?.getName() || 'null',
        targetPath: ch.getTargetPath(),
        hasSampler: !!ch.getSampler()
      }))
    });

    for (const channel of channels) {
      const targetPath = channel.getTargetPath();
      if (targetPath !== 'weights') {
        continue;
      }

      const targetNode = channel.getTargetNode();
      if (!targetNode) {
        this.logger.warn(`Channel has no target node`, { animationName });
        continue;
      }

      const usdNode = context.nodeMap.get(targetNode);
      if (!usdNode) {
        this.logger.warn(`USD node not found for GLTF node: ${targetNode.getName()}`, {
          animationName,
          targetNodeName: targetNode.getName()
        });
        continue;
      }

      // Get the mesh to find morph target count
      const gltfMesh = targetNode.getMesh();
      if (!gltfMesh) {
        this.logger.warn(`Target node has no mesh`, {
          animationName,
          targetNodeName: targetNode.getName()
        });
        continue;
      }

      // Get morph target count from the first primitive
      const primitives = gltfMesh.listPrimitives();
      if (primitives.length === 0) {
        this.logger.warn(`Mesh has no primitives`, {
          animationName,
          targetNodeName: targetNode.getName()
        });
        continue;
      }

      const sampler = channel.getSampler();
      if (!sampler) {
        this.logger.warn(`Channel has no sampler`, {
          animationName,
          targetNode: targetNode.getName()
        });
        continue;
      }

      const input = sampler.getInput();
      const output = sampler.getOutput();
      if (!input || !output) {
        this.logger.warn(`Channel sampler missing input or output`, {
          animationName,
          targetNode: targetNode.getName(),
          hasInput: !!input,
          hasOutput: !!output
        });
        continue;
      }

      const inputArray = input.getArray();
      const outputArray = output.getArray();
      if (!inputArray || !outputArray) {
        this.logger.warn(`Channel sampler arrays are missing`, {
          animationName,
          targetNode: targetNode.getName(),
          hasInputArray: !!inputArray,
          hasOutputArray: !!outputArray
        });
        continue;
      }

      const times = Array.from(inputArray as Float32Array);
      const values = Array.from(outputArray as Float32Array);

      // Determine morph target count from the animation data
      // The number of weights per time sample tells us how many morph targets there are
      if (times.length === 0 || values.length === 0) {
        this.logger.warn(`Empty animation data`, {
          animationName,
          targetNode: targetNode.getName()
        });
        continue;
      }

      // GLTF spec: for CUBICSPLINE interpolation, the output accessor stores
      // [in-tangent, value, out-tangent] per keyframe, so:
      //   values.length = 3 × times.length × morphTargetCount
      // For LINEAR/STEP:
      //   values.length = times.length × morphTargetCount
      const interpolation = sampler.getInterpolation();
      const valuesPerKeyframe = interpolation === 'CUBICSPLINE' ? 3 : 1;
      const morphTargetCount = Math.floor(values.length / (times.length * valuesPerKeyframe));
      if (morphTargetCount === 0) {
        this.logger.warn(`Cannot determine morph target count from animation data`, {
          animationName,
          targetNode: targetNode.getName(),
          interpolation,
          timeSampleCount: times.length,
          valueCount: values.length
        });
        continue;
      }

      // For CUBICSPLINE, extract only the keyframe values (index 1 of each triplet per target)
      // Layout: [inTangent_0..N, value_0..N, outTangent_0..N] per keyframe
      let weightValues = values;
      if (interpolation === 'CUBICSPLINE') {
        weightValues = [];
        for (let ki = 0; ki < times.length; ki++) {
          const stride = morphTargetCount * 3;
          const base = ki * stride + morphTargetCount; // skip in-tangents
          for (let wi = 0; wi < morphTargetCount; wi++) {
            weightValues.push(values[base + wi]);
          }
        }
      }

      // Validate that we have the right number of values
      const expectedValueCount = times.length * morphTargetCount;
      if (weightValues.length !== expectedValueCount) {
        this.logger.warn(`Morph target weight count mismatch, using calculated count`, {
          animationName,
          targetNode: targetNode.getName(),
          interpolation,
          morphTargetCount,
          timeSampleCount: times.length,
          expectedValueCount,
          actualValueCount: weightValues.length
        });
      }

      // Find the inner mesh node that contains the geometry
      // The nodeMap points to the outer node, but geometry is in a child mesh node
      let geometryMeshNode = usdNode;
      const children = Array.from(usdNode.getChildren());
      const meshChild = children.find(child => child.getTypeName() === 'Mesh');
      if (meshChild) {
        geometryMeshNode = meshChild;
      }


      // Collect all times
      for (const time of times) {
        allAnimationTimes.add(time);
      }

      if (times.length > 0) {
        for (const t of times) {
          if (t > maxTime) maxTime = t;
        }
      }

      // Store weights for each time sample
      // Use the geometry mesh node (inner node with geometry) for storing blend shape weights
      let meshAnim = meshAnimations.get(geometryMeshNode);
      if (!meshAnim) {
        meshAnim = {
          meshNode: geometryMeshNode,
          weights: new Map<number, number[]>(),
          morphTargetCount
        };
        meshAnimations.set(geometryMeshNode, meshAnim);
      } else if (meshAnim.morphTargetCount !== morphTargetCount) {
        // Multiple channels targeting the same mesh must agree on morph target count.
        // Mismatched counts would produce wrong-length weight arrays in USD.
        this.logger.warn(`Skipping morph target channel: morphTargetCount mismatch for mesh`, {
          animationName,
          targetNode: targetNode.getName(),
          existingCount: meshAnim.morphTargetCount,
          channelCount: morphTargetCount
        });
        continue;
      }

      for (let i = 0; i < times.length; i++) {
        const time = times[i];
        const startIdx = i * morphTargetCount;
        const weights = weightValues.slice(startIdx, startIdx + morphTargetCount);

        // Store weights for this time (if multiple channels target the same mesh, last one wins)
        meshAnim.weights.set(time, weights);
      }

      this.logger.info(`Processed morph target animation channel`, {
        animationName,
        targetNode: targetNode.getName(),
        morphTargetCount,
        timeSampleCount: times.length,
        weightCount: weightValues.length
      });
    }

    if (allAnimationTimes.size === 0 || meshAnimations.size === 0) {
      this.logger.warn(`No valid morph target animations found`, {
        animationName,
        totalChannels: channels.length
      });
      return {
        duration: maxTime
      };
    }

    // Detect frame rate from time intervals
    const sortedAllTimes = Array.from(allAnimationTimes).sort((a, b) => a - b);
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
        detectedFrameRate = Math.round(1 / avgInterval);
        // Keep frame rate between 24 and 60 fps
        detectedFrameRate = Math.max(24, Math.min(60, detectedFrameRate));
      }
    }

    // Track the maximum time code across all meshes (including loop frame)
    let globalMaxTimeCode = 0;

    // Apply morph target animations to USD mesh nodes
    for (const [, meshAnim] of meshAnimations) {
      // Convert time samples from seconds to frame numbers
      // First, convert number arrays to string arrays for TimeCodeConverter
      const weightsTimeSamples = new Map<number, string[]>();
      for (const [timeSeconds, weights] of meshAnim.weights) {
        // Convert number array to string array (formatted as USD numbers)
        const weightsStr = weights.map(w => w.toFixed(6));
        weightsTimeSamples.set(timeSeconds, weightsStr);
      }

      // Convert to time codes using the standard time code frame rate
      // This keeps time code scaling consistent across all animation types
      const weightsTimeCodes = TimeCodeConverter.convertArraysToTimeCodes(
        weightsTimeSamples,
        ANIMATION.TIME_CODE_FPS
      );

      // Ensure consecutive time codes (0, 1, 2, 3...) for USD viewers
      const sortedTimeCodes = Array.from(weightsTimeCodes.keys()).sort((a, b) => a - b);
      if (sortedTimeCodes.length === 0) {
        continue;
      }

      const minTimeCode = sortedTimeCodes[0];
      const maxTimeCode = sortedTimeCodes[sortedTimeCodes.length - 1];

      // Fill in all missing frames between min and max
      const formattedWeights = new Map<number, string>();
      let lastValue = weightsTimeCodes.get(minTimeCode)!;
      const firstValue = lastValue; // Store first value for looping

      for (let frame = minTimeCode; frame <= maxTimeCode; frame++) {
        if (weightsTimeCodes.has(frame)) {
          // Use the actual value for this frame
          lastValue = weightsTimeCodes.get(frame)!;
          formattedWeights.set(frame, lastValue);
        } else {
          // Fill missing frame with the last known value (hold)
          formattedWeights.set(frame, lastValue);
        }
      }

      // Make the animation loop by adding a frame after maxTimeCode that equals the first frame
      // This ensures seamless looping in USDZ viewers (frame 0 = frame N+1)
      let loopFrame: number | undefined = undefined;
      if (formattedWeights.size > 1 && minTimeCode !== maxTimeCode) {
        loopFrame = maxTimeCode + 1;
        formattedWeights.set(loopFrame, firstValue);

        this.logger.info('Added loop frame for morph target animation', {
          animationName,
          minTimeCode,
          maxTimeCode,
          loopFrame,
          firstValue: firstValue.substring(0, 50) + '...'
        });
      }

      // Track the maximum time code (including loop frame if added)
      const currentMaxTimeCode = loopFrame !== undefined ? loopFrame : maxTimeCode;
      globalMaxTimeCode = Math.max(globalMaxTimeCode, currentMaxTimeCode);

      // Set default weights (from time code 0, or first time sample)
      const defaultWeights = formattedWeights.get(0) ||
        (meshAnim.weights.size > 0
          ? formatUsdNumberArrayFixed(Array.from(meshAnim.weights.values())[0], 6)
          : formatUsdNumberArrayFixed(new Array(meshAnim.morphTargetCount).fill(0), 6));

      // Set blend shape weights on the mesh node
      // USD uses 'primvars:blendShapeWeights' for morph target weights
      // This is a primvar that can be time-sampled
      meshAnim.meshNode.setProperty('float[] primvars:blendShapeWeights', defaultWeights, 'raw');
      meshAnim.meshNode.setProperty('uniform token primvars:blendShapeWeights:interpolation', 'constant', 'interpolation');

      // Set time-sampled weights if we have multiple time samples
      if (formattedWeights.size > 1) {
        // Convert formatted strings back to arrays for time sampling
        const timeSampledWeights = new Map<number, string>();
        for (const [timeCode, weightsStr] of formattedWeights) {
          timeSampledWeights.set(timeCode, weightsStr);
        }
        meshAnim.meshNode.setTimeSampledProperty('float[] primvars:blendShapeWeights', timeSampledWeights, 'float[]');
      }

      this.logger.info(`Applied morph target animation`, {
        animationName,
        meshPath: meshAnim.meshNode.getPath(),
        meshName: meshAnim.meshNode.getName(),
        morphTargetCount: meshAnim.morphTargetCount,
        timeSampleCount: formattedWeights.size,
        detectedFrameRate
      });
    }

    return {
      duration: maxTime,
      detectedFrameRate,
      // Return the max time code including loop frame so animation-processor can use it
      maxTimeCode: globalMaxTimeCode
    };
  }

}

