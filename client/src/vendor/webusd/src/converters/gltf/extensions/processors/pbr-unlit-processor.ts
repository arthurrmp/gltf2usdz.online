/**
 * PBR Unlit Extension Processor
 * 
 * Handles KHR_materials_unlit extension.
 * Marks material as unlit (no textures, no properties).
 */

import { Material } from '@gltf-transform/core';
import { Unlit } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';

/**
 * Processor for KHR_materials_unlit extension
 */
export class PBRUnlitProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_unlit';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<Unlit>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;

    const unlitExtension = material.getExtension<Unlit>(this.extensionName);
    if (!unlitExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      console.log(`[PBRUnlitProcessor] Material marked as unlit`, {
        materialName
      });

      return {
        textures: [],
        properties: {
          unlit: true
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

