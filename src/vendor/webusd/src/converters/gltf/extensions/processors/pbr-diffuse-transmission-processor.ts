/**
 * PBR Diffuse Transmission Extension Processor
 * 
 * Handles KHR_materials_diffuse_transmission extension.
 * Extracts diffuseTransmission and diffuseTransmissionColor textures.
 */

import { Material } from '@gltf-transform/core';
import { DiffuseTransmission } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';
import { TextureReference } from '../../../shared/usd-material-builder';
import { generateTextureId, extractTextureTransform } from './texture-utils';

/**
 * Processor for KHR_materials_diffuse_transmission extension
 */
export class PBRDiffuseTransmissionProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_diffuse_transmission';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<DiffuseTransmission>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName } = context;
    const extractedTextures: TextureReference[] = [];

    const diffuseTransmissionExtension = material.getExtension<DiffuseTransmission>(this.extensionName);
    if (!diffuseTransmissionExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      // Extract diffuseTransmissionTexture
      const diffuseTransmissionTexture = diffuseTransmissionExtension.getDiffuseTransmissionTexture();
      if (diffuseTransmissionTexture) {
        try {
          const textureId = await generateTextureId(diffuseTransmissionTexture, 'diffuseTransmission');
          const textureInfo = diffuseTransmissionExtension.getDiffuseTransmissionTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: diffuseTransmissionTexture,
            id: textureId,
            type: 'diffuseTransmission',
            uvSet,
            transform
          });

          console.log(`[PBRDiffuseTransmissionProcessor] Extracted diffuseTransmissionTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRDiffuseTransmissionProcessor] Failed to extract diffuseTransmissionTexture: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Extract diffuseTransmissionColorTexture
      const diffuseTransmissionColorTexture = diffuseTransmissionExtension.getDiffuseTransmissionColorTexture();
      if (diffuseTransmissionColorTexture) {
        try {
          const textureId = await generateTextureId(diffuseTransmissionColorTexture, 'diffuseTransmissionColor');
          const textureInfo = diffuseTransmissionExtension.getDiffuseTransmissionColorTextureInfo();
          const uvSet = textureInfo ? textureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(textureInfo);

          extractedTextures.push({
            texture: diffuseTransmissionColorTexture,
            id: textureId,
            type: 'diffuseTransmissionColor',
            uvSet,
            transform
          });

          console.log(`[PBRDiffuseTransmissionProcessor] Extracted diffuseTransmissionColorTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRDiffuseTransmissionProcessor] Failed to extract diffuseTransmissionColorTexture: ${error instanceof Error ? error.message : String(error)}`);
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

