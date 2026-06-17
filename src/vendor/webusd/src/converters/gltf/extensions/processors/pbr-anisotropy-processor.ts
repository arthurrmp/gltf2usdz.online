/**
 * PBR Anisotropy Extension Processor
 * 
 * Handles KHR_materials_anisotropy extension.
 * Extracts anisotropy texture.
 */

import { Material } from '@gltf-transform/core';
import { Anisotropy } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';
import { TextureReference } from '../../../shared/usd-material-builder';
import { generateTextureId, extractTextureTransform } from './texture-utils';

/**
 * Processor for KHR_materials_anisotropy extension
 */
export class PBRAnisotropyProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_anisotropy';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<Anisotropy>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;
    const extractedTextures: TextureReference[] = [];

    const anisotropyExtension = material.getExtension<Anisotropy>(this.extensionName);
    if (!anisotropyExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      // Extract anisotropyTexture
      const anisotropyTexture = anisotropyExtension.getAnisotropyTexture();
      if (anisotropyTexture) {
        try {
          const textureId = await generateTextureId(anisotropyTexture, 'anisotropy');
          const textureInfo = anisotropyExtension.getAnisotropyTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: anisotropyTexture,
            id: textureId,
            type: 'anisotropy',
            uvSet,
            transform
          });

          console.log(`[PBRAnisotropyProcessor] Extracted anisotropyTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRAnisotropyProcessor] Failed to extract anisotropyTexture: ${error instanceof Error ? error.message : String(error)}`);
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

