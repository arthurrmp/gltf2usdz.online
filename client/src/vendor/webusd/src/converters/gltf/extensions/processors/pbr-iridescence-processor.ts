/**
 * PBR Iridescence Extension Processor
 * 
 * Handles KHR_materials_iridescence extension.
 * Extracts iridescence and iridescenceThickness textures.
 */

import { Material } from '@gltf-transform/core';
import { Iridescence } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';
import { TextureReference } from '../../../shared/usd-material-builder';
import { generateTextureId, extractTextureTransform } from './texture-utils';

/**
 * Processor for KHR_materials_iridescence extension
 */
export class PBRIridescenceProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_iridescence';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<Iridescence>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;
    const extractedTextures: TextureReference[] = [];

    const iridescenceExtension = material.getExtension<Iridescence>(this.extensionName);
    if (!iridescenceExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      // Extract iridescenceTexture
      const iridescenceTexture = iridescenceExtension.getIridescenceTexture();
      if (iridescenceTexture) {
        try {
          const textureId = await generateTextureId(iridescenceTexture, 'iridescence');
          const textureInfo = iridescenceExtension.getIridescenceTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: iridescenceTexture,
            id: textureId,
            type: 'iridescence',
            uvSet,
            transform
          });

          console.log(`[PBRIridescenceProcessor] Extracted iridescenceTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRIridescenceProcessor] Failed to extract iridescenceTexture: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Extract iridescenceThicknessTexture
      const iridescenceThicknessTexture = iridescenceExtension.getIridescenceThicknessTexture();
      if (iridescenceThicknessTexture) {
        try {
          const textureId = await generateTextureId(iridescenceThicknessTexture, 'iridescenceThickness');
          const textureInfo = iridescenceExtension.getIridescenceThicknessTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: iridescenceThicknessTexture,
            id: textureId,
            type: 'iridescenceThickness',
            uvSet,
            transform
          });

          console.log(`[PBRIridescenceProcessor] Extracted iridescenceThicknessTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRIridescenceProcessor] Failed to extract iridescenceThicknessTexture: ${error instanceof Error ? error.message : String(error)}`);
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

