/**
 * PBR Specular Glossiness Extension Processor
 * 
 * Handles KHR_materials_pbrSpecularGlossiness extension.
 * Extracts specular and diffuse textures for USDZ packaging.
 */

import { Material } from '@gltf-transform/core';
import { PBRSpecularGlossiness } from '@gltf-transform/extensions';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from '../extension-processor';
import { TextureReference } from '../../../shared/usd-material-builder';
import { generateTextureId, extractTextureTransform } from './texture-utils';

/**
 * Processor for KHR_materials_pbrSpecularGlossiness extension
 */
export class PBRSpecularGlossinessProcessor implements IExtensionProcessor {
  readonly extensionName = 'KHR_materials_pbrSpecularGlossiness';

  canProcess(material: Material): boolean {
    const extension = material.getExtension<PBRSpecularGlossiness>(this.extensionName);
    return extension !== null;
  }

  async process(context: ExtensionProcessingContext): Promise<ExtensionProcessingResult> {
    const { material, materialName, baseColorTexture, textures } = context;
    const extractedTextures: TextureReference[] = [];

    const specGlossExtension = material.getExtension<PBRSpecularGlossiness>(this.extensionName);
    if (!specGlossExtension) {
      return {
        textures: [],
        processed: false,
        error: 'Extension not found on material'
      };
    }

    try {
      // Extract specularGlossinessTexture
      const specularGlossinessTexture = specGlossExtension.getSpecularGlossinessTexture();
      if (specularGlossinessTexture) {
        try {
          const textureId = await generateTextureId(specularGlossinessTexture, 'specular');
          const specularTextureInfo = specGlossExtension.getSpecularGlossinessTextureInfo();
          const uvSet = specularTextureInfo ? specularTextureInfo.getTexCoord() : 0;
          const transform = extractTextureTransform(specularTextureInfo);

          extractedTextures.push({
            texture: specularGlossinessTexture,
            id: textureId,
            type: 'specular',
            uvSet,
            transform
          });

          console.log(`[PBRSpecularGlossinessProcessor] Extracted specularGlossinessTexture`, {
            materialName,
            textureId,
            uvSet
          });
        } catch (error) {
          console.warn(`[PBRSpecularGlossinessProcessor] Failed to extract specularGlossinessTexture: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Extract diffuseTexture if not already handled via baseColorTexture
      const diffuseTexture = specGlossExtension.getDiffuseTexture();
      if (diffuseTexture && !baseColorTexture) {
        // Check if this texture is already in the textures array
        const alreadyIncluded = textures.some(t => t.texture === diffuseTexture);
        if (!alreadyIncluded) {
          try {
            const textureId = await generateTextureId(diffuseTexture, 'diffuse');
            const diffuseTextureInfo = specGlossExtension.getDiffuseTextureInfo();
            const uvSet = diffuseTextureInfo ? diffuseTextureInfo.getTexCoord() : 0;
            const transform = extractTextureTransform(diffuseTextureInfo);

            extractedTextures.push({
              texture: diffuseTexture,
              id: textureId,
              type: 'diffuse',
              uvSet,
              transform
            });

            console.log(`[PBRSpecularGlossinessProcessor] Extracted diffuseTexture`, {
              materialName,
              textureId,
              uvSet
            });
          } catch (error) {
            console.warn(`[PBRSpecularGlossinessProcessor] Failed to extract diffuseTexture: ${error instanceof Error ? error.message : String(error)}`);
          }
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

