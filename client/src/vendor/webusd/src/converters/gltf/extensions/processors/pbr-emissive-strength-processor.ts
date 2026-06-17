/**
 * PBR Emissive Strength Extension Processor
 * 
 * Handles KHR_materials_emissive_strength extension.
 * Extracts emissive strength factor (no textures).
 */

import { Material } from '@gltf-transform/core';
import { EmissiveStrength } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';

/**
 * Processor for KHR_materials_emissive_strength extension
 */
export class PBREmissiveStrengthProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_emissive_strength';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<EmissiveStrength>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;

    const emissiveStrengthExtension = material.getExtension<EmissiveStrength>(this.extensionName);
    if (!emissiveStrengthExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      const emissiveStrength = emissiveStrengthExtension.getEmissiveStrength();

      console.log(`[PBREmissiveStrengthProcessor] Extracted emissive strength`, {
        materialName,
        emissiveStrength
      });

      return {
        textures: [],
        properties: {
          emissiveStrength
        },
        processed: true
      };
    } catch (error) {
      return {
        textures: [],
        processed: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

