/**
 * PBR Clearcoat Extension Processor
 * 
 * Handles KHR_materials_clearcoat extension.
 * Extracts clearcoat, clearcoatRoughness, and clearcoatNormal textures.
 */

import { Material } from '@gltf-transform/core';
import { Clearcoat } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';
import { TextureReference } from '../../../shared/usd-material-builder';
import { generateTextureId, extractTextureTransform } from './texture-utils';

/**
 * Processor for KHR_materials_clearcoat extension
 */
export class PBRClearcoatProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_clearcoat';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<Clearcoat>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;
    const extractedTextures: TextureReference[] = [];

    const clearcoatExtension = material.getExtension<Clearcoat>(this.extensionName);
    if (!clearcoatExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      // Extract clearcoatTexture
      const clearcoatTexture = clearcoatExtension.getClearcoatTexture();
      if (clearcoatTexture) {
        try {
          const textureId = await generateTextureId(clearcoatTexture, 'clearcoat');
          const textureInfo = clearcoatExtension.getClearcoatTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: clearcoatTexture,
            id: textureId,
            type: 'clearcoat',
            uvSet,
            transform
          });

          console.log(`[PBRClearcoatProcessor] Extracted clearcoatTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRClearcoatProcessor] Failed to extract clearcoatTexture: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Extract clearcoatRoughnessTexture
      const clearcoatRoughnessTexture = clearcoatExtension.getClearcoatRoughnessTexture();
      if (clearcoatRoughnessTexture) {
        try {
          const textureId = await generateTextureId(clearcoatRoughnessTexture, 'clearcoatRoughness');
          const textureInfo = clearcoatExtension.getClearcoatRoughnessTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: clearcoatRoughnessTexture,
            id: textureId,
            type: 'clearcoatRoughness',
            uvSet,
            transform
          });

          console.log(`[PBRClearcoatProcessor] Extracted clearcoatRoughnessTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRClearcoatProcessor] Failed to extract clearcoatRoughnessTexture: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Extract clearcoatNormalTexture
      const clearcoatNormalTexture = clearcoatExtension.getClearcoatNormalTexture();
      if (clearcoatNormalTexture) {
        try {
          const textureId = await generateTextureId(clearcoatNormalTexture, 'clearcoatNormal');
          const textureInfo = clearcoatExtension.getClearcoatNormalTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: clearcoatNormalTexture,
            id: textureId,
            type: 'clearcoatNormal',
            uvSet,
            transform
          });

          console.log(`[PBRClearcoatProcessor] Extracted clearcoatNormalTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRClearcoatProcessor] Failed to extract clearcoatNormalTexture: ${error instanceof Error ? error.message : String(error)}`);
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

