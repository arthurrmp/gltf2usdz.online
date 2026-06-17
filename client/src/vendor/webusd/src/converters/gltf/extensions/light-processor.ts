/** WebUsdFramework.Converters.Gltf.Extensions.LightProcessor - KHR_lights_punctual processor translating to USD lights */

import { Node } from '@gltf-transform/core';
import { Light } from '@gltf-transform/extensions';
import { UsdNode } from '../../../core/usd-node';

/**
 * Light properties extracted from GLTF
 */
export interface LightProperties {
  type: 'directional' | 'point' | 'spot';
  color: [number, number, number];
  intensity: number;
  range?: number | null;
  innerConeAngle?: number;
  outerConeAngle?: number;
}

/**
 * Process light extension from a GLTF node
 */
export function processLightExtension(node: Node): LightProperties | null {
  const lightExtension = node.getExtension<Light>('KHR_lights_punctual');
  if (!lightExtension) {
    return null;
  }

  try {
    const type = lightExtension.getType();
    const color = lightExtension.getColor();
    const intensity = lightExtension.getIntensity();
    const range = lightExtension.getRange();
    const innerConeAngle = lightExtension.getInnerConeAngle();
    const outerConeAngle = lightExtension.getOuterConeAngle();

    console.log(`[processLightExtension] Extracted light properties`, {
      nodeName: node.getName(),
      type,
      color,
      intensity,
      range,
      innerConeAngle,
      outerConeAngle
    });

    return {
      type,
      color: [color[0], color[1], color[2]],
      intensity,
      range: range ?? null,
      innerConeAngle,
      outerConeAngle
    };
  } catch (error) {
    console.warn(`[processLightExtension] Failed to extract light properties: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Apply light properties to a USD node
 * Note: USD uses different light prim types (DistantLight, SphereLight, DiskLight, RectLight)
 */
export function applyLightToUsdNode(usdNode: UsdNode, lightProps: LightProperties): void {
  const nodeName = usdNode.getName();
  const nodePath = usdNode.getPath();

  // USD light prim types:
  // - DistantLight (directional)
  // - SphereLight (point)
  // - DiskLight (spot)

  let lightType: string;
  switch (lightProps.type) {
    case 'directional':
      lightType = 'DistantLight';
      break;
    case 'point':
      lightType = 'SphereLight';
      break;
    case 'spot':
      lightType = 'DiskLight';
      break;
    default:
      console.warn(`[applyLightToUsdNode] Unknown light type: ${lightProps.type}`);
      return;
  }

  // Create light prim as child of the node
  const lightNode = new UsdNode(`${nodePath}/Light`, lightType);

  // Set purpose to "guide" to prevent lights from rendering as visible geometry
  lightNode.setProperty('token purpose', 'guide', 'token');

  // Set color (RGB)
  lightNode.setProperty('color3f inputs:color', `(${lightProps.color[0]}, ${lightProps.color[1]}, ${lightProps.color[2]})`, 'color3f');

  // Set intensity
  lightNode.setProperty('float inputs:intensity', lightProps.intensity.toString(), 'float');

  // Set range (for point and spot lights)
  if (lightProps.range !== null && lightProps.range !== undefined && (lightProps.type === 'point' || lightProps.type === 'spot')) {
    lightNode.setProperty('float inputs:radius', (lightProps.range / 2).toString(), 'float');
  }

  // Set cone angles (for spot lights)
  if (lightProps.type === 'spot') {
    if (lightProps.innerConeAngle !== undefined) {
      lightNode.setProperty('float inputs:innerConeAngle', lightProps.innerConeAngle.toString(), 'float');
    }
    if (lightProps.outerConeAngle !== undefined) {
      lightNode.setProperty('float inputs:outerConeAngle', lightProps.outerConeAngle.toString(), 'float');
    }
  }

  usdNode.addChild(lightNode);

  console.log(`[applyLightToUsdNode] Applied ${lightType} to node: ${nodeName}`, {
    color: lightProps.color,
    intensity: lightProps.intensity,
    range: lightProps.range
  });
}

