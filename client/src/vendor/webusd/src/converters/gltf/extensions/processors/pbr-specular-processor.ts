/**
 * PBR Specular Extension Processor
 * 
 * Handles KHR_materials_specular extension.
 * Extracts specularColor texture.
 */

import { Material } from '@gltf-transform/core';
import { Specular } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';
import { TextureReference } from '../../../shared/usd-material-builder';
import { generateTextureId, extractTextureTransform } from './texture-utils';

/**
 * Processor for KHR_materials_specular extension
 */
export class PBRSpecularProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_specular';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<Specular>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;
    const extractedTextures: TextureReference[] = [];

    const specularExtension = material.getExtension<Specular>(this.extensionName);
    if (!specularExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      // Extract specularColorTexture
      const specularColorTexture = specularExtension.getSpecularColorTexture();
      if (specularColorTexture) {
        try {
          const textureId = await generateTextureId(specularColorTexture, 'specularColor');
          const textureInfo = specularExtension.getSpecularColorTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: specularColorTexture,
            id: textureId,
            type: 'specularColor',
            uvSet,
            transform
          });

          console.log(`[PBRSpecularProcessor] Extracted specularColorTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRSpecularProcessor] Failed to extract specularColorTexture: ${error instanceof Error ? error.message : String(error)}`);
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

