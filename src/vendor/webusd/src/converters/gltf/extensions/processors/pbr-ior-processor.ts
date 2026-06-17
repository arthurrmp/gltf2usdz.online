/**
 * PBR IOR Extension Processor
 * 
 * Handles KHR_materials_ior extension.
 * Extracts index of refraction factor (no textures).
 */

import { Material } from '@gltf-transform/core';
import { IOR } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';

/**
 * Processor for KHR_materials_ior extension
 */
export class PBRIORProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_ior';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<IOR>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;

    const iorExtension = material.getExtension<IOR>(this.extensionName);
    if (!iorExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      const ior = iorExtension.getIOR();

      console.log(`[PBRIORProcessor] Extracted index of refraction`, {
        materialName,
        ior
      });

      return {
        textures: [],
        properties: {
          ior
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

