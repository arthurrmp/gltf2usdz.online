/** WebUsdFramework.Converters.Gltf.Helpers.AnimationProcessorFactory - Resolves specific transform/morph processor per channel */

import { Animation, Node, Skin } from '@gltf-transform/core';
import { UsdNode } from '../../../core/usd-node';
import { Logger } from '../../../utils';
import { SkeletonData } from './skeleton-processor';
import { SkeletonAnimationProcessor } from './processors/skeleton-animation-processor';
import { NodeAnimationProcessor } from './processors/node-animation-processor';
import { MorphTargetAnimationProcessor } from './processors/morph-target-animation-processor';

/**
 * Base interface for all animation processors
 */
export interface IAnimationProcessor {
  /**
   * Check if this processor can handle the given animation
   */
  canProcess(animation: Animation, context: AnimationProcessorContext): boolean;

  /**
   * Process the animation and return the duration
   */
  process(
    animation: Animation,
    animationIndex: number,
    context: AnimationProcessorContext
  ): AnimationProcessorResult | null;
}

/**
 * Context information needed by animation processors
 */
export interface AnimationProcessorContext {
  nodeMap: Map<Node, UsdNode>;
  logger: Logger;
  skeletonMap?: Map<Skin, SkeletonData> | undefined;
}

/**
 * Result of processing an animation
 */
export interface AnimationProcessorResult {
  duration: number;
  path?: string;
  name?: string;
  detectedFrameRate?: number; // Frame rate detected from animation time intervals
  maxTimeCode?: number; // Maximum time code including loop frame (if added)
  /**
   * One entry per skin this animation drives.
   *
   * A GLTF animation can target joints across multiple skins (e.g. a
   * butterfly-swarm where every butterfly is its own skinned mesh yet they
   * share one animation). Processors must emit one entry per skin; the caller
   * binds `skel:animationSource` on each SkelRoot/Skeleton accordingly.
   */
  animationSources?: Array<{
    path: string;
    name: string;
    index: number;
    targetSkin: Skin;
  }>;
}

/**
 * Animation processor factory
 * Determines which processor to use based on the animation type
 */
export class AnimationProcessorFactory {
  private processors: IAnimationProcessor[];

  constructor(logger: Logger) {
    // Initialize available processors
    // Order matters: check skeleton animations first, then morph targets, then node animations
    this.processors = [
      new SkeletonAnimationProcessor(logger),
      new MorphTargetAnimationProcessor(logger),
      new NodeAnimationProcessor(logger),
    ];
  }

  /**
   * Get the appropriate processor for an animation
   * Checks processors in order until one can handle the animation
   * @deprecated Use getProcessors() instead to support animations with multiple channel types
   */
  getProcessor(
    animation: Animation,
    context: AnimationProcessorContext
  ): IAnimationProcessor | null {
    for (const processor of this.processors) {
      if (processor.canProcess(animation, context)) {
        return processor;
      }
    }
    return null;
  }

  /**
   * Get ALL processors that can handle this animation
   * An animation can have multiple types of channels (e.g., morph targets + node transforms),
   * so we need to process it with all applicable processors
   */
  getProcessors(animation: Animation, context: AnimationProcessorContext): IAnimationProcessor[] {
    const applicableProcessors: IAnimationProcessor[] = [];
    for (const processor of this.processors) {
      if (processor.canProcess(animation, context)) {
        applicableProcessors.push(processor);
      }
    }
    return applicableProcessors;
  }

  /**
   * Register a new processor type
   * Useful for extending with new animation types in the future
   */
  registerProcessor(processor: IAnimationProcessor): void {
    this.processors.push(processor);
  }
}
