/**
 * PBR Dispersion Extension Processor
 * 
 * Handles KHR_materials_dispersion extension.
 * Extracts dispersion factor (no textures).
 */

import { Material } from '@gltf-transform/core';
import { Dispersion } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';

/**
 * Processor for KHR_materials_dispersion extension
 */
export class PBRDispersionProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_dispersion';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<Dispersion>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;

    const dispersionExtension = material.getExtension<Dispersion>(this.extensionName);
    if (!dispersionExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      const dispersion = dispersionExtension.getDispersion();

      console.log(`[PBRDispersionProcessor] Extracted dispersion`, {
        materialName,
        dispersion
      });

      return {
        textures: [],
        properties: {
          dispersion
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

