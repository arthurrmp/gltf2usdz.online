/**
 * PBR Volume Extension Processor
 * 
 * Handles KHR_materials_volume extension.
 * Extracts thickness texture.
 */

import { Material } from '@gltf-transform/core';
import { Volume } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';
import { TextureReference } from '../../../shared/usd-material-builder';
import { generateTextureId, extractTextureTransform } from './texture-utils';

/**
 * Processor for KHR_materials_volume extension
 */
export class PBRVolumeProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_volume';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<Volume>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;
    const extractedTextures: TextureReference[] = [];

    const volumeExtension = material.getExtension<Volume>(this.extensionName);
    if (!volumeExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      // Extract thicknessTexture
      const thicknessTexture = volumeExtension.getThicknessTexture();
      if (thicknessTexture) {
        try {
          const textureId = await generateTextureId(thicknessTexture, 'thickness');
          const textureInfo = volumeExtension.getThicknessTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: thicknessTexture,
            id: textureId,
            type: 'thickness',
            uvSet,
            transform
          });

          console.log(`[PBRVolumeProcessor] Extracted thicknessTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRVolumeProcessor] Failed to extract thicknessTexture: ${error instanceof Error ? error.message : String(error)}`);
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

