/**
 * PBR Transmission Extension Processor
 * 
 * Handles KHR_materials_transmission extension.
 * Extracts transmission texture.
 */

import { Material } from '@gltf-transform/core';
import { Transmission } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';
import { TextureReference } from '../../../shared/usd-material-builder';
import { generateTextureId, extractTextureTransform } from './texture-utils';

/**
 * Processor for KHR_materials_transmission extension
 */
export class PBRTransmissionProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_transmission';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<Transmission>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;
    const extractedTextures: TextureReference[] = [];

    const transmissionExtension = material.getExtension<Transmission>(this.extensionName);
    if (!transmissionExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      // Extract transmissionTexture
      const transmissionTexture = transmissionExtension.getTransmissionTexture();
      if (transmissionTexture) {
        try {
          const textureId = await generateTextureId(transmissionTexture, 'transmission');
          const textureInfo = transmissionExtension.getTransmissionTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: transmissionTexture,
            id: textureId,
            type: 'transmission',
            uvSet,
            transform
          });

          console.log(`[PBRTransmissionProcessor] Extracted transmissionTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRTransmissionProcessor] Failed to extract transmissionTexture: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return {
        textures: extractedTextures,
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

