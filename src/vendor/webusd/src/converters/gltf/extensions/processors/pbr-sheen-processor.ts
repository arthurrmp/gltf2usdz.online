/**
 * PBR Sheen Extension Processor
 * 
 * Handles KHR_materials_sheen extension.
 * Extracts sheenColor and sheenRoughness textures.
 */

import { Material } from '@gltf-transform/core';
import { Sheen } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';
import { TextureReference } from '../../../shared/usd-material-builder';
import { generateTextureId, extractTextureTransform } from './texture-utils';

/**
 * Processor for KHR_materials_sheen extension
 */
export class PBRSheenProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_sheen';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<Sheen>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;
    const extractedTextures: TextureReference[] = [];

    const sheenExtension = material.getExtension<Sheen>(this.extensionName);
    if (!sheenExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      // Extract sheenColorTexture
      const sheenColorTexture = sheenExtension.getSheenColorTexture();
      if (sheenColorTexture) {
        try {
          const textureId = await generateTextureId(sheenColorTexture, 'sheenColor');
          const textureInfo = sheenExtension.getSheenColorTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: sheenColorTexture,
            id: textureId,
            type: 'sheenColor',
            uvSet,
            transform
          });

          console.log(`[PBRSheenProcessor] Extracted sheenColorTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRSheenProcessor] Failed to extract sheenColorTexture: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Extract sheenRoughnessTexture
      const sheenRoughnessTexture = sheenExtension.getSheenRoughnessTexture();
      if (sheenRoughnessTexture) {
        try {
          const textureId = await generateTextureId(sheenRoughnessTexture, 'sheenRoughness');
          const textureInfo = sheenExtension.getSheenRoughnessTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: sheenRoughnessTexture,
            id: textureId,
            type: 'sheenRoughness',
            uvSet,
            transform
          });

          console.log(`[PBRSheenProcessor] Extracted sheenRoughnessTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRSheenProcessor] Failed to extract sheenRoughnessTexture: ${error instanceof Error ? error.message : String(error)}`);
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

