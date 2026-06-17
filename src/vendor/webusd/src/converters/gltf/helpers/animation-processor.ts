/** WebUsdFramework.Converters.Gltf.Helpers.AnimationProcessor - Orchestrates GLTF animation curves into USD SkelAnimation */

import { Document, Node, Skin, Animation } from '@gltf-transform/core';
import { Logger } from '../../../utils';
import { SkeletonData } from './skeleton-processor';
import { ANIMATION } from '../../../constants';
import { UsdNode } from '../../../core/usd-node';
import {
  AnimationProcessorFactory,
  AnimationProcessorContext,
  AnimationProcessorResult,
} from './animation-processor-factory';
import { setSkeletonAnimationSources } from './processors/skeleton-animation-processor';
import { calculateSceneExtent } from './usd-hierarchy-builder';
import { formatUsdTuple3 } from '../../../utils/usd-formatter';

/**
 * Animation timing information for the USD file header.
 * Tells USD how long the animation is and what frame rate to use.
 */
export interface AnimationTimeCode {
  startTimeCode: number;
  endTimeCode: number;
  timeCodesPerSecond: number;
  framesPerSecond: number;
}

/**
 * Gets the total duration of an animation by finding the latest time sample.
 */
function getAnimationDuration(animation: Animation): number {
  const channels = animation.listChannels();
  let maxTime = 0;

  for (const channel of channels) {
    const sampler = channel.getSampler();
    if (!sampler) continue;

    const input = sampler.getInput();
    if (!input) continue;

    const inputArray = input.getArray();
    if (!inputArray) continue;

    const times = Array.from(inputArray as Float32Array);
    if (times.length > 0) {
      maxTime = Math.max(maxTime, ...times);
    }
  }

  return maxTime;
}

/**
 * Processes all animations from a GLTF document and converts them to USD format.
 *
 * Routes each animation to the right processor and sets up animation sources
 * so viewers know which animations to play.
 */
export function processAnimations(
  document: Document,
  nodeMap: Map<Node, UsdNode>,
  logger: Logger,
  skeletonMap?: Map<Skin, SkeletonData>
): AnimationTimeCode | null {
  const root = document.getRoot();
  const animations = root.listAnimations();

  if (animations.length === 0) {
    return null;
  }

  logger.info(`Processing ${animations.length} animations`);

  // Set up the factory that routes animations to the right processor
  const factory = new AnimationProcessorFactory(logger);
  const context: AnimationProcessorContext = {
    nodeMap,
    logger,
    skeletonMap,
  };

  const defaultFrameRate = ANIMATION.FRAME_RATE;
  const animationSourcesMap = new Map<
    Skin,
    Array<{ path: string; name: string; index: number; duration: number }>
  >();
  let firstAnimationDuration = 0;
  let detectedFrameRate: number | undefined = undefined;
  let firstAnimationMaxTimeCode: number | undefined = undefined;

  // Process each animation
  for (let animIdx = 0; animIdx < animations.length; animIdx++) {
    const animation = animations[animIdx];

    // Get ALL processors that can handle this animation
    // An animation can have multiple types of channels (e.g., morph targets + node transforms)
    // So we need to process it with all applicable processors
    const applicableProcessors = factory.getProcessors(animation, context);

    if (applicableProcessors.length === 0) {
      logger.warn(
        `No processor found for animation: ${animation.getName() || `Animation_${animIdx}`}`
      );
      continue;
    }

    // Process the animation with each applicable processor
    // Each processor handles its own channel types
    let animationResult: AnimationProcessorResult | null = null;
    for (const processor of applicableProcessors) {
      const result = processor.process(animation, animIdx, context);

      if (result) {
        // Use the first result for duration/frame rate tracking
        // If multiple processors return results, merge the max values
        if (!animationResult) {
          animationResult = result;
        } else {
          // Merge results: use max duration, max time code, etc.
          animationResult.duration = Math.max(animationResult.duration, result.duration);
          if (
            result.detectedFrameRate &&
            (!animationResult.detectedFrameRate ||
              result.detectedFrameRate > animationResult.detectedFrameRate)
          ) {
            animationResult.detectedFrameRate = result.detectedFrameRate;
          }
          if (result.maxTimeCode !== undefined) {
            if (
              animationResult.maxTimeCode === undefined ||
              result.maxTimeCode > animationResult.maxTimeCode
            ) {
              animationResult.maxTimeCode = result.maxTimeCode;
            }
          }
          // Merge animation sources (for skeleton animations).
          // Concatenate rather than overwrite — a single animation can drive
          // multiple skins, and multiple applicable processors can each
          // contribute sources. Overwriting here dropped 13 of 14 bindings on
          // multi-skin GLBs.
          if (result.animationSources && result.animationSources.length > 0) {
            animationResult.animationSources = [
              ...(animationResult.animationSources ?? []),
              ...result.animationSources,
            ];
          }
        }
      }
    }

    if (!animationResult) {
      continue;
    }

    // Save duration, frame rate, and max time code
    // We track the maximum duration across all animations to ensure the timeline covers everything
    if (animationResult.duration > firstAnimationDuration) {
      firstAnimationDuration = animationResult.duration;
    }

    if (
      animationResult.detectedFrameRate &&
      (!detectedFrameRate || animationResult.detectedFrameRate > detectedFrameRate)
    ) {
      detectedFrameRate = animationResult.detectedFrameRate;
    }

    if (animationResult.maxTimeCode !== undefined) {
      if (
        firstAnimationMaxTimeCode === undefined ||
        animationResult.maxTimeCode > firstAnimationMaxTimeCode
      ) {
        firstAnimationMaxTimeCode = animationResult.maxTimeCode;
      }
    }

    // Collect skeleton animation sources so we can link them later.
    // Each entry in `animationSources` represents one (skin, SkelAnimation)
    // binding emitted by the processor — we record all of them, not just the
    // first, so every SkelRoot gets its own animationSource relationship.
    if (animationResult.animationSources) {
      for (const src of animationResult.animationSources) {
        if (!animationSourcesMap.has(src.targetSkin)) {
          animationSourcesMap.set(src.targetSkin, []);
        }
        animationSourcesMap.get(src.targetSkin)!.push({
          path: src.path,
          name: src.name,
          index: src.index,
          duration: animationResult.duration,
        });
      }
    }
  }

  // Link animations to their skeletons so viewers know what to play
  if (skeletonMap && skeletonMap.size > 0 && animationSourcesMap.size > 0) {
    setSkeletonAnimationSources(animationSourcesMap, skeletonMap, logger);
  }

  // Calculate animation timing for the USD header
  // The header needs to know the frame rate and duration
  if (animations.length === 0) {
    return null;
  }

  // Figure out the animation duration
  let duration = firstAnimationDuration;
  if (duration === 0 && animations.length > 0) {
    duration = getAnimationDuration(animations[0]);
  }

  // Use a default duration if we still don't have one
  if (duration === 0) {
    duration = 1.0;
  }

  // Use the detected frame rate from the GLTF animation directly
  // All metadata comes from the actual GLTF file, no hardcoded values
  const effectiveFrameRate = detectedFrameRate || defaultFrameRate;

  // Use 120fps for time codes - this gives us integer values for common frame rates (24, 30, 60)
  const startTimeCode = 0;

  // Convert duration to time codes by multiplying by the time code frame rate
  // Use the max time code from the animation if available, otherwise calculate from duration
  const endTimeCode =
    firstAnimationMaxTimeCode !== undefined
      ? firstAnimationMaxTimeCode
      : Math.ceil(duration * ANIMATION.TIME_CODE_FPS);

  // Set time code metadata for USD:
  // - timeCodesPerSecond = 120 (all time codes are scaled by this)
  // - framesPerSecond = detected frame rate from GLTF (controls playback speed)
  // Using 120fps for time codes ensures smooth playback across different frame rates
  const timeCodesPerSecond = ANIMATION.TIME_CODE_FPS;
  const framesPerSecond = effectiveFrameRate;

  logger.info('Animation time code metadata', {
    startTimeCode,
    endTimeCode,
    duration,
    detectedFrameRate,
    defaultFrameRate,
    effectiveFrameRate,
    timeCodesPerSecond,
    framesPerSecond,
    hasSkeletonAnimations: animationSourcesMap.size > 0,
    totalAnimations: animations.length,
  });

  // For skeleton animations: timeCodesPerSecond = 1 (time codes are in seconds)
  // For other animations: timeCodesPerSecond = framesPerSecond (time codes are integer frames)
  return {
    startTimeCode,
    endTimeCode,
    timeCodesPerSecond,
    framesPerSecond,
  };
}

/**
 * Sets the bounding box (extent) on SkelRoot nodes for animated skeletons.
 *
 * USDZ files need time-sampled extent so viewers know the model's size at each frame.
 * This helps with culling and camera positioning.
 */
export function setAnimatedExtentOnSkelRoots(
  skeletonMap: Map<Skin, SkeletonData>,
  animationSourcesMap: Map<Skin, Array<{ path: string; name: string; index: number }>>,
  logger: Logger,
  rootNode?: UsdNode
): void {
  for (const [skin, skeletonData] of skeletonMap) {
    const skelRootNode = skeletonData.skelRootNode;
    const animationSources = animationSourcesMap.get(skin);

    if (!animationSources || animationSources.length === 0) {
      continue;
    }

    // Calculate the bounding box from all meshes
    const staticExtent = calculateSceneExtent(skelRootNode);
    if (!staticExtent) {
      logger.warn('Could not calculate extent for SkelRoot', {
        skelRootPath: skelRootNode.getPath(),
      });
      continue;
    }

    const [minX, minY, minZ, maxX, maxY, maxZ] = staticExtent;

    // Get animation timing from the root node metadata
    const startTimeCode = rootNode?.getMetadata('startTimeCode') as number | undefined;
    const endTimeCode = rootNode?.getMetadata('endTimeCode') as number | undefined;

    if (startTimeCode === undefined || endTimeCode === undefined) {
      // Fall back to calculated default range if we can't get timing info
      // Get frame rate from metadata or use default, then calculate end time code
      const frameRate =
        (rootNode?.getMetadata('timeCodesPerSecond') as number | undefined) ||
        (rootNode?.getMetadata('framesPerSecond') as number | undefined) ||
        ANIMATION.FRAME_RATE;

      // Use a minimum duration of 1 second to ensure we have at least some frames
      // This works for all models regardless of their actual animation length
      const defaultDuration = 1.0;
      const defaultStart = 0;
      const defaultEnd = Math.ceil(defaultDuration * frameRate);

      logger.warn(
        'Could not get time codes from SkelRoot metadata, using calculated default range',
        {
          skelRootPath: skelRootNode.getPath(),
          frameRate,
          defaultDuration,
          defaultEnd,
        }
      );

      const finalExtentTimeSamples = new Map<number, string>();
      const extentMinStr = formatUsdTuple3(minX, minY, minZ);
      const extentMaxStr = formatUsdTuple3(maxX, maxY, maxZ);
      const extentValue = `[${extentMinStr}, ${extentMaxStr}]`;

      // Set the same extent for all frames
      for (let frame = defaultStart; frame <= defaultEnd; frame++) {
        finalExtentTimeSamples.set(frame, extentValue);
      }

      skelRootNode.setTimeSampledProperty('float3[] extent', finalExtentTimeSamples, 'float3[]');
      continue;
    }

    // Create time-sampled extent for all animation frames
    // We use the same bounding box for all frames (conservative approach)
    const finalExtentTimeSamples = new Map<number, string>();
    const extentMinStr = formatUsdTuple3(minX, minY, minZ);
    const extentMaxStr = formatUsdTuple3(maxX, maxY, maxZ);
    const extentValue = `[${extentMinStr}, ${extentMaxStr}]`;

    // Set extent for each frame
    for (let frame = startTimeCode; frame <= endTimeCode; frame++) {
      finalExtentTimeSamples.set(frame, extentValue);
    }
    skelRootNode.setTimeSampledProperty('float3[] extent', finalExtentTimeSamples, 'float3[]');

    logger.info('Set animated extent on SkelRoot', {
      skelRootPath: skelRootNode.getPath(),
      extent: `[(${minX}, ${minY}, ${minZ}), (${maxX}, ${maxY}, ${maxZ})]`,
      timeSampleCount: finalExtentTimeSamples.size,
      firstTimeCode: Array.from(finalExtentTimeSamples.keys()).sort((a, b) => a - b)[0],
      lastTimeCode: Array.from(finalExtentTimeSamples.keys()).sort((a, b) => b - a)[0],
    });
  }
}

/**
 * Recursively finds all SkelRoot nodes in the hierarchy and sets animated extent on them.
 * This includes SkelRoots created for blend shape animations (morph targets).
 *
 * USDZ files need time-sampled extent on SkelRoots so viewers know the model's size at each frame.
 * Also sets customData.defaultAnimation on blend shape SkelRoots to specify which animation to play.
 */
export function setAnimatedExtentOnAllSkelRoots(
  rootNode: UsdNode,
  logger: Logger,
  defaultAnimationName?: string
): void {
  const skelRoots: UsdNode[] = [];

  // Recursively find all SkelRoot nodes
  function findSkelRoots(node: UsdNode): void {
    if (node.getTypeName() === 'SkelRoot') {
      skelRoots.push(node);
    }
    for (const child of node.getChildren()) {
      findSkelRoots(child);
    }
  }

  findSkelRoots(rootNode);

  if (skelRoots.length === 0) {
    return;
  }

  // Get animation timing from the root node metadata
  const startTimeCode = rootNode.getMetadata('startTimeCode') as number | undefined;
  const endTimeCode = rootNode.getMetadata('endTimeCode') as number | undefined;

  if (startTimeCode === undefined || endTimeCode === undefined) {
    logger.warn('Could not get time codes from root metadata for blend shape SkelRoots', {
      hasStartTimeCode: startTimeCode !== undefined,
      hasEndTimeCode: endTimeCode !== undefined,
    });
    return;
  }

  // Set animated extent on each SkelRoot
  for (const skelRoot of skelRoots) {
    // Check if extent is already time-sampled (skip if already set by skeleton processor)
    const existingExtent = skelRoot.getProperty('float3[] extent');
    if (existingExtent && typeof existingExtent === 'object' && 'timeSamples' in existingExtent) {
      // Already has time-sampled extent, skip
      continue;
    }

    // Calculate the bounding box from all meshes under this SkelRoot
    const staticExtent = calculateSceneExtent(skelRoot);
    if (!staticExtent) {
      logger.warn('Could not calculate extent for blend shape SkelRoot', {
        skelRootPath: skelRoot.getPath(),
      });
      continue;
    }

    const [minX, minY, minZ, maxX, maxY, maxZ] = staticExtent;

    // Create time-sampled extent for all animation frames
    const finalExtentTimeSamples = new Map<number, string>();
    const extentMinStr = formatUsdTuple3(minX, minY, minZ);
    const extentMaxStr = formatUsdTuple3(maxX, maxY, maxZ);
    const extentValue = `[${extentMinStr}, ${extentMaxStr}]`;

    // Set extent for each frame
    for (let frame = startTimeCode; frame <= endTimeCode; frame++) {
      finalExtentTimeSamples.set(frame, extentValue);
    }

    skelRoot.setTimeSampledProperty('float3[] extent', finalExtentTimeSamples, 'float3[]');

    // Check if this SkelRoot has blend shapes (morph targets)
    let hasBlendShapes = false;
    function checkForBlendShapes(node: UsdNode): boolean {
      // Check if this node is a mesh with skel:blendShapes
      if (node.getTypeName() === 'Mesh') {
        const blendShapes = node.getProperty('rel skel:blendShapes');
        if (blendShapes) {
          return true;
        }
      }
      // Recursively check children
      for (const child of node.getChildren()) {
        if (checkForBlendShapes(child)) {
          return true;
        }
      }
      return false;
    }

    hasBlendShapes = checkForBlendShapes(skelRoot);

    // Set customData.defaultAnimation on blend shape SkelRoots
    if (hasBlendShapes && defaultAnimationName) {
      skelRoot.setProperty('customData', { defaultAnimation: defaultAnimationName });
      logger.info('Set customData.defaultAnimation on blend shape SkelRoot', {
        skelRootPath: skelRoot.getPath(),
        defaultAnimation: defaultAnimationName,
      });
    }

    logger.info('Set animated extent on blend shape SkelRoot', {
      skelRootPath: skelRoot.getPath(),
      extent: `[(${minX}, ${minY}, ${minZ}), (${maxX}, ${maxY}, ${maxZ})]`,
      timeSampleCount: finalExtentTimeSamples.size,
      firstTimeCode: startTimeCode,
      lastTimeCode: endTimeCode,
      hasBlendShapes,
      hasDefaultAnimation: hasBlendShapes && !!defaultAnimationName,
    });
  }
}
