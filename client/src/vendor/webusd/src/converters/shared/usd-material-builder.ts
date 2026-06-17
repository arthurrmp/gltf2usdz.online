/** WebUsdFramework.Converters.Shared.UsdMaterialBuilder - PBR material shading network constructor */

import { Material, Texture, Primitive, Document, TextureInfo } from '@gltf-transform/core';
import {
  PBRSpecularGlossiness,
  Clearcoat,
  Sheen,
  Transmission,
  Volume,
  Specular,
  Iridescence,
  DiffuseTransmission,
  Anisotropy
} from '@gltf-transform/extensions';
import { UsdNode } from '../../core/usd-node';
import { sanitizeName } from '../../utils/name-utils';
import { bakeVertexColorsToTexture } from '../gltf/helpers/vertex-color-baker';
import { ExtensionFactory } from '../gltf/extensions/extension-factory';
import {
  generateTextureId,
  extractTextureTransform,
  getTextureFileBasename,
  getCleanTextureImage,
  getTextureExtension
} from '../gltf/extensions/processors/texture-utils';

/**
 * Texture type definitions based on GLTF standard and extensions
 * Supports all texture types from @gltf-transform/extensions library
 */
export type TextureType =
  // Standard PBR textures
  | 'diffuse' // baseColorTexture
  | 'normal' // normalTexture
  | 'metallicRoughness' // metallicRoughnessTexture
  | 'emissive' // emissiveTexture
  | 'occlusion' // occlusionTexture
  // PBRSpecularGlossiness extension
  | 'specular' // specularGlossinessTexture
  // KHR_materials_specular extension
  | 'specularColor' // specularColorTexture
  // KHR_materials_clearcoat extension
  | 'clearcoat' // clearcoatTexture
  | 'clearcoatRoughness' // clearcoatRoughnessTexture
  | 'clearcoatNormal' // clearcoatNormalTexture
  // KHR_materials_iridescence extension
  | 'iridescence' // iridescenceTexture
  | 'iridescenceThickness' // iridescenceThicknessTexture
  // KHR_materials_diffuse_transmission extension
  | 'diffuseTransmission' // diffuseTransmissionTexture
  | 'diffuseTransmissionColor' // diffuseTransmissionColorTexture
  // KHR_materials_sheen extension
  | 'sheenColor' // sheenColorTexture
  | 'sheenRoughness' // sheenRoughnessTexture
  // KHR_materials_transmission extension
  | 'transmission' // transmissionTexture
  // KHR_materials_volume extension
  | 'thickness' // thicknessTexture
  // KHR_materials_anisotropy extension
  | 'anisotropy'; // anisotropyTexture

/**
 * Texture reference info
 */
export interface TextureReference {
  /** Texture object from GLTF (optional for baked textures) */
  texture?: Texture;
  /** Unique texture identifier */
  id: string;
  /** Texture usage type - supports all GLTF standard and extension texture types */
  type: TextureType;
  /** UV set index for this texture */
  uvSet: number;
  /** Texture transform info */
  transform?: {
    offset: [number, number];
    scale: [number, number];
    rotation: number;
  } | undefined;
  /** Baked texture data (for vertex color textures) */
  textureData?: ArrayBuffer;
}

/**
 * Material build result
 */
export interface MaterialBuildResult {
  /** USD material node */
  materialNode: UsdNode;
  /** List of textures used by this material */
  textures: TextureReference[];
  /** UV readers created for this material */
  uvReaders: UsdNode[];
  /** Transform2d nodes created for this material */
  transform2dNodes: UsdNode[];
}

/**
 * Optimized texture mapping configuration
 */
interface TextureMappingConfig {
  /** UV set index */
  uvSet: number;
  /** Texture transform */
  transform?: {
    offset: [number, number];
    scale: [number, number];
    rotation: number;
  };
  /** Texture wrapping mode */
  wrapMode: 'repeat' | 'clamp' | 'mirror';
}

/**
 * Build USD material from GLTF material
 * @param material - GLTF material to convert
 * @param materialIndex - Index of the material
 * @param materialsPath - USD path for materials node
 * @param document - GLTF document (kept for future use, currently not needed as TextureInfo is obtained from material)
 * @param primitive - Optional primitive to check for vertex colors and bake them to textures
 */
export async function buildUsdMaterial(
  material: Material,
  materialIndex: number,
  materialsPath: string,
  _document: Document,
  primitive?: Primitive
): Promise<MaterialBuildResult> {
  const materialName = sanitizeName(material.getName() || `Material_${materialIndex}`);
  const materialPath = `${materialsPath}/${materialName}`;

  // Create material node
  const materialNode = new UsdNode(materialPath, 'Material');

  const textures: TextureReference[] = [];

  // Create shared UV reader and Transform2d node for UV set 0 (default)
  // Additional PrimvarReaders will be created dynamically for other UV sets
  const uvReader = new UsdNode(`${materialPath}/PrimvarReader_st`, 'Shader');
  uvReader.setProperty('uniform token info:id', 'UsdPrimvarReader_float2');
  uvReader.setProperty('float2 inputs:fallback', '(0, 0)', 'float2');
  uvReader.setProperty('string inputs:varname', 'st', 'string');
  uvReader.setProperty('float2 outputs:result', '');

  const transform2d = new UsdNode(`${materialPath}/Transform2d_st`, 'Shader');
  transform2d.setProperty('uniform token info:id', 'UsdTransform2d');
  transform2d.setProperty('float2 inputs:in.connect', `<${materialPath}/PrimvarReader_st.outputs:result>`, 'connection');
  // Default values - will be updated if texture transform is found
  transform2d.setProperty('float inputs:rotation', '0', 'float');
  transform2d.setProperty('float2 inputs:scale', '(1, 1)', 'float2');
  transform2d.setProperty('float2 inputs:translation', '(0, 0)', 'float2');
  transform2d.setProperty('float2 outputs:result', '');

  // Map to track created PrimvarReaders and Transform2d nodes for each UV set
  const uvSetReaders = new Map<number, UsdNode>();
  const uvSetTransforms = new Map<number, UsdNode>();
  uvSetReaders.set(0, uvReader);
  uvSetTransforms.set(0, transform2d);

  // Create PreviewSurface shader
  const surfaceShader = new UsdNode(`${materialPath}/PreviewSurface`, 'Shader');
  surfaceShader.setProperty('uniform token info:id', 'UsdPreviewSurface');

  // Check if material uses PBRSpecularGlossiness (specular workflow)
  // This MUST be set BEFORE processing any textures to ensure correct workflow
  const hasPBRSpecGloss = material.getExtension('KHR_materials_pbrSpecularGlossiness') !== null;

  // Set useSpecularWorkflow flag EARLY - before processing any textures
  // This ensures USD PreviewSurface interprets textures correctly
  surfaceShader.setProperty('int inputs:useSpecularWorkflow', hasPBRSpecGloss ? '1' : '0', 'int');

  if (hasPBRSpecGloss) {
    console.log(`[buildUsdMaterial] Material uses PBRSpecularGlossiness - specular workflow enabled: ${materialName}`);
  }

  // Process base color with optimized mapping
  // For PBRSpecularGlossiness materials, use diffuseTexture instead of baseColorTexture
  let baseColorTexture = material.getBaseColorTexture();
  if (hasPBRSpecGloss && !baseColorTexture) {
    const specGlossExtension = material.getExtension<PBRSpecularGlossiness>('KHR_materials_pbrSpecularGlossiness');
    if (specGlossExtension) {
      baseColorTexture = specGlossExtension.getDiffuseTexture();
    }
  }
  const normalTexture = material.getNormalTexture();

  // Get alphaMode and alphaCutoff early - needed for opacity processing
  const alphaMode = material.getAlphaMode();
  const alphaCutoff = material.getAlphaCutoff();

  // Log texture availability for debugging
  console.log(`[buildUsdMaterial] Material: ${materialName}`, {
    hasBaseColorTexture: !!baseColorTexture,
    hasNormalTexture: !!normalTexture,
    hasMetallicRoughnessTexture: !!material.getMetallicRoughnessTexture(),
    hasEmissiveTexture: !!material.getEmissiveTexture(),
    hasOcclusionTexture: !!material.getOcclusionTexture(),
    hasPBRSpecGloss,
    useSpecularWorkflow: hasPBRSpecGloss ? '1' : '0',
    alphaMode: Material.AlphaMode[alphaMode],
    alphaCutoff
  });

  // Check if primitive has vertex colors that should be baked to texture
  const hasVertexColors = primitive?.getAttribute('COLOR_0') !== null;
  const hasUVs = primitive?.getAttribute('TEXCOORD_0') !== null;
  const shouldBakeVertexColors = hasVertexColors && hasUVs && !baseColorTexture && primitive !== undefined;

  // Try to bake vertex colors to texture for better USDZ compatibility
  let bakedVertexColorTexture: { textureId: string; textureData: ArrayBuffer } | null = null;
  if (shouldBakeVertexColors && primitive) {
    try {
      const bakeResult = await bakeVertexColorsToTexture(primitive, {
        resolution: 2048,
        highQuality: true
      });
      bakedVertexColorTexture = {
        textureId: bakeResult.textureId,
        textureData: bakeResult.textureData
      };
      console.log(`[buildUsdMaterial] Baked vertex colors to texture: ${bakeResult.textureId}`);
    } catch (error) {
      console.warn(`[buildUsdMaterial] Failed to bake vertex colors: ${error instanceof Error ? error.message : String(error)}`);
      // Fall back to PrimvarReader if baking fails
    }
  }

  if (baseColorTexture) {
    const textureId = await generateTextureId(baseColorTexture, 'diffuse');
    const textureNodeName = `Texture_${textureId}`;
    const uvSet = getTextureUVSet(material, 'baseColor');
    const textureTransform = getTextureTransform(material, 'baseColor');

    textures.push({
      texture: baseColorTexture,
      id: textureId,
      type: 'diffuse',
      uvSet,
      transform: textureTransform
    });

    // NOTE: Per-texture transforms are handled inside createOptimizedTextureShader
    // via extractTextureTransform. Do NOT apply the transform to the shared
    // Transform2d_st node here — that would leak the base color's transform to
    // other textures on UV set 0 that don't have their own transform.

    // Create optimized texture shader network
    // Apply baseColorFactor/diffuseFactor as scale to the texture
    // For PBRSpecularGlossiness materials, use diffuseFactor instead of baseColorFactor
    let baseColorFactor = material.getBaseColorFactor();
    let baseColorTextureInfo = material.getBaseColorTextureInfo();
    if (hasPBRSpecGloss) {
      const specGlossExtension = material.getExtension<PBRSpecularGlossiness>('KHR_materials_pbrSpecularGlossiness');
      if (specGlossExtension) {
        const diffuseFactor = specGlossExtension.getDiffuseFactor();
        if (diffuseFactor && diffuseFactor.length >= 4) {
          baseColorFactor = diffuseFactor; // Use diffuseFactor for PBRSpecularGlossiness
        }
        // Also get TextureInfo from extension if using diffuseTexture
        if (baseColorTexture && !material.getBaseColorTexture()) {
          // We're using diffuseTexture from extension, get its TextureInfo
          const diffuseTextureInfo = specGlossExtension.getDiffuseTextureInfo();
          if (diffuseTextureInfo) {
            baseColorTextureInfo = diffuseTextureInfo;
          }
        }
      }
    }
    const scaleFactor: [number, number, number, number] | undefined = baseColorFactor && baseColorFactor.length >= 4
      ? [baseColorFactor[0], baseColorFactor[1], baseColorFactor[2], baseColorFactor[3]]
      : undefined;

    // Log baseColorFactor application for debugging (always log to verify it's being applied)
    console.log(`[buildUsdMaterial] Processing baseColorTexture for material: ${materialName}`, {
      hasBaseColorFactor: !!baseColorFactor,
      baseColorFactor: baseColorFactor || 'not set',
      scaleFactor: scaleFactor || 'not set',
      textureId,
      note: scaleFactor ? 'baseColorFactor will be applied as inputs:scale to texture' : 'No baseColorFactor - using default scale (1, 1, 1, 1)'
    });

    const { textureShader, transform2d: baseColorTransform2d } = createOptimizedTextureShader(
      materialPath,
      textureId,
      textureNodeName,
      false,
      false,
      baseColorTexture,
      baseColorTextureInfo,
      materialNode,
      uvSetReaders,
      uvSetTransforms,
      scaleFactor // Pass baseColorFactor as scale
    );

    materialNode.addChild(textureShader);
    if (baseColorTransform2d) {
      // Transform2d already added in createOptimizedTextureShader
    }

    // Connect to PreviewSurface
    surfaceShader.setProperty(
      'color3f inputs:diffuseColor.connect',
      `<${materialPath}/${textureNodeName}.outputs:rgb>`,
      'connection'
    );

    // Connect texture alpha channel to opacity for non-OPAQUE materials.
    // For BLEND mode: connect alpha → inputs:opacity for smooth transparency.
    // For MASK mode: connect alpha → inputs:opacity AND set inputs:opacityThreshold
    //   so USD PreviewSurface performs a hard cutoff (supported since USD 21.11).
    if (alphaMode !== Material.AlphaMode.OPAQUE) {
      surfaceShader.setProperty(
        'float inputs:opacity.connect',
        `<${materialPath}/${textureNodeName}.outputs:a>`,
        'connection'
      );
      if (alphaMode === Material.AlphaMode.MASK) {
        surfaceShader.setProperty('float inputs:opacityThreshold', alphaCutoff.toString(), 'float');
      }
      console.log(`[buildUsdMaterial] Connected texture alpha channel to opacity for material: ${materialName}`, {
        alphaMode: Material.AlphaMode[alphaMode],
        alphaCutoff
      });
    }
  } else if (bakedVertexColorTexture) {
    // Use baked vertex color texture - connect directly to PrimvarReader
    // UVs are already normalized and flipped during baking
    const textureId = bakedVertexColorTexture.textureId;
    const textureNodeName = `Texture_${textureId}`;
    const uvSet = 0; // Use first UV set for baked textures

    textures.push({
      id: textureId,
      type: 'diffuse',
      uvSet,
      textureData: bakedVertexColorTexture.textureData
    });

    // Create texture shader for baked vertex color texture
    const textureShader = new UsdNode(`${materialPath}/${textureNodeName}`, 'Shader');
    textureShader.setProperty('uniform token info:id', 'UsdUVTexture');
    // Asset paths are content-addressed (hash only) so one image referenced
    // in multiple roles resolves to a single file; the role suffix lives on
    // the shader node name, not on disk.
    textureShader.setProperty('asset inputs:file', `@textures/Texture_${getTextureFileBasename(textureId)}.png@`, 'asset');
    textureShader.setProperty('token inputs:sourceColorSpace', 'sRGB', 'token');
    textureShader.setProperty('token inputs:wrapS', 'repeat', 'token');
    textureShader.setProperty('token inputs:wrapT', 'repeat', 'token');
    textureShader.setProperty('float4 inputs:scale', '(1, 1, 1, 1)', 'float4');
    textureShader.setProperty('float outputs:r', '');
    textureShader.setProperty('float outputs:g', '');
    textureShader.setProperty('float outputs:b', '');
    textureShader.setProperty('float outputs:a', '');
    textureShader.setProperty('float3 outputs:rgb', '');

    // Connect directly to PrimvarReader - no Transform2d needed since UVs are pre-processed
    // Use 'connection' type for proper shader connection
    textureShader.setProperty(
      'float2 inputs:st.connect',
      `<${materialPath}/PrimvarReader_st.outputs:result>`,
      'connection'
    );

    materialNode.addChild(textureShader);

    // Connect to PreviewSurface
    surfaceShader.setProperty(
      'color3f inputs:diffuseColor.connect',
      `<${materialPath}/${textureNodeName}.outputs:rgb>`,
      'connection'
    );
  } else {
    // Use solid base color factor or PrimvarReader as fallback
    // For PBRSpecularGlossiness materials, use diffuseFactor instead of baseColorFactor
    let baseColorFactor = material.getBaseColorFactor();
    if (hasPBRSpecGloss) {
      const specGlossExtension = material.getExtension<PBRSpecularGlossiness>('KHR_materials_pbrSpecularGlossiness');
      if (specGlossExtension) {
        const diffuseFactor = specGlossExtension.getDiffuseFactor();
        if (diffuseFactor && diffuseFactor.length >= 4) {
          baseColorFactor = diffuseFactor; // Use diffuseFactor for PBRSpecularGlossiness
        }
      }
    }
    if (baseColorFactor) {
      const [r, g, b] = baseColorFactor;
      const isWhite = Math.abs(r - 1.0) < 0.001 && Math.abs(g - 1.0) < 0.001 && Math.abs(b - 1.0) < 0.001;

      if (isWhite && hasVertexColors) {
        // If baseColorFactor is white and we have vertex colors, try PrimvarReader as fallback
        // Note: This may not work in all USDZ viewers, but it's better than nothing
        const displayColorReader = new UsdNode(`${materialPath}/PrimvarReader_displayColor`, 'Shader');
        displayColorReader.setProperty('uniform token info:id', 'UsdPrimvarReader_float3');
        displayColorReader.setProperty('float3 inputs:fallback', '(1, 1, 1)', 'float3');
        displayColorReader.setProperty('string inputs:varname', 'displayColor', 'string');
        displayColorReader.setProperty('float3 outputs:result', '');

        materialNode.addChild(displayColorReader);

        surfaceShader.setProperty(
          'color3f inputs:diffuseColor.connect',
          `<${materialPath}/PrimvarReader_displayColor.outputs:result>`,
          'connection'
        );
      } else {
        // If not white, use the baseColorFactor directly
        surfaceShader.setProperty(
          'color3f inputs:diffuseColor',
          `(${r}, ${g}, ${b})`
        );
      }
    } else if (hasVertexColors) {
      // No baseColorFactor but we have vertex colors - use PrimvarReader as fallback
      const displayColorReader = new UsdNode(`${materialPath}/PrimvarReader_displayColor`, 'Shader');
      displayColorReader.setProperty('uniform token info:id', 'UsdPrimvarReader_float3');
      displayColorReader.setProperty('float3 inputs:fallback', '(1, 1, 1)', 'float3');
      displayColorReader.setProperty('string inputs:varname', 'displayColor', 'string');
      displayColorReader.setProperty('float3 outputs:result', '');

      materialNode.addChild(displayColorReader);

      surfaceShader.setProperty(
        'color3f inputs:diffuseColor.connect',
        `<${materialPath}/PrimvarReader_displayColor.outputs:result>`,
        'connection'
      );
    } else {
      // No base color at all - use default white
      surfaceShader.setProperty(
        'color3f inputs:diffuseColor',
        '(1, 1, 1)'
      );
    }
  }

  // Process normal map with optimized mapping
  if (normalTexture) {
    const textureId = await generateTextureId(normalTexture, 'normal');
    const textureNodeName = `Texture_${textureId}`;
    const uvSet = getTextureUVSet(material, 'normal');

    textures.push({
      texture: normalTexture,
      id: textureId,
      type: 'normal',
      uvSet,
      transform: getTextureTransform(material, 'normal')
    });

    // Create optimized texture shader network for normal map
    const normalTextureInfo = material.getNormalTextureInfo();
    const { textureShader } = createOptimizedTextureShader(
      materialPath,
      textureId,
      textureNodeName,
      true,
      true,
      normalTexture,
      normalTextureInfo,
      materialNode,
      uvSetReaders,
      uvSetTransforms
    );

    materialNode.addChild(textureShader);

    // Apply normal map scale factor from GLTF material.
    // Default decode: n = texel * 2 - 1. With normalScale s applied to xy:
    // n.xy = (texel.xy * 2 - 1) * s = texel.xy * 2s - s
    // So scale = (2s, 2s, 2, 1), bias = (-s, -s, -1, 0)
    const normalScale = material.getNormalScale();
    if (normalScale !== 1) {
      textureShader.setProperty('float4 inputs:scale', `(${2 * normalScale}, ${2 * normalScale}, 2, 1)`, 'float4');
      textureShader.setProperty('float4 inputs:bias', `(${-normalScale}, ${-normalScale}, -1, 0)`, 'float4');
    }

    // Connect to PreviewSurface via normal input
    surfaceShader.setProperty(
      'normal3f inputs:normal.connect',
      `<${materialPath}/${textureNodeName}.outputs:rgb>`,
      'connection'
    );
  }

  // Process emissive texture with optimized mapping
  let emissiveTextureShaderNode: UsdNode | null = null;
  const emissiveTexture = material.getEmissiveTexture();
  if (emissiveTexture) {
    const textureId = await generateTextureId(emissiveTexture, 'emissive');
    const textureNodeName = `Texture_${textureId}`;
    const uvSet = getTextureUVSet(material, 'emissive');

    textures.push({
      texture: emissiveTexture,
      id: textureId,
      type: 'emissive',
      uvSet,
      transform: getTextureTransform(material, 'emissive')
    });

    // Create optimized texture shader network for emissive
    // GLTF spec: final emissive = emissiveTexture * emissiveFactor
    const emissiveTextureInfo = material.getEmissiveTextureInfo();
    const emissiveFactor = material.getEmissiveFactor();
    const emissiveScale: [number, number, number, number] | undefined =
      emissiveFactor && (emissiveFactor[0] !== 1 || emissiveFactor[1] !== 1 || emissiveFactor[2] !== 1)
        ? [emissiveFactor[0], emissiveFactor[1], emissiveFactor[2], 1]
        : undefined;
    const { textureShader } = createOptimizedTextureShader(
      materialPath,
      textureId,
      textureNodeName,
      false,
      false,
      emissiveTexture,
      emissiveTextureInfo,
      materialNode,
      uvSetReaders,
      uvSetTransforms,
      emissiveScale
    );

    materialNode.addChild(textureShader);
    emissiveTextureShaderNode = textureShader;

    // Connect to PreviewSurface
    surfaceShader.setProperty(
      'color3f inputs:emissiveColor.connect',
      `<${materialPath}/${textureNodeName}.outputs:rgb>`,
      'connection'
    );

    console.log(`[buildUsdMaterial] Connected emissive texture to material: ${materialName}`, {
      textureId,
      textureNodeName
    });
  } else {
    // Use emissive factor if no texture
    const emissiveFactor = material.getEmissiveFactor();
    if (emissiveFactor && (emissiveFactor[0] > 0 || emissiveFactor[1] > 0 || emissiveFactor[2] > 0)) {
      surfaceShader.setProperty(
        'color3f inputs:emissiveColor',
        `(${emissiveFactor[0]}, ${emissiveFactor[1]}, ${emissiveFactor[2]})`
      );
      console.log(`[buildUsdMaterial] Applied emissive factor to material: ${materialName}`, {
        emissiveFactor: [emissiveFactor[0], emissiveFactor[1], emissiveFactor[2]]
      });
    }
  }

  // Process occlusion texture with optimized mapping
  const occlusionTexture = material.getOcclusionTexture();
  if (occlusionTexture) {
    const textureId = await generateTextureId(occlusionTexture, 'occlusion');
    const textureNodeName = `Texture_${textureId}`;
    const uvSet = getTextureUVSet(material, 'occlusion');

    textures.push({
      texture: occlusionTexture,
      id: textureId,
      type: 'occlusion',
      uvSet,
      transform: getTextureTransform(material, 'occlusion')
    });

    // Create optimized texture shader network for occlusion
    const occlusionTextureInfo = material.getOcclusionTextureInfo();
    const { textureShader } = createOptimizedTextureShader(
      materialPath,
      textureId,
      textureNodeName,
      true,
      false,
      occlusionTexture,
      occlusionTextureInfo,
      materialNode,
      uvSetReaders,
      uvSetTransforms
    );

    materialNode.addChild(textureShader);

    // Connect to PreviewSurface via occlusion input
    surfaceShader.setProperty(
      'float inputs:occlusion.connect',
      `<${materialPath}/${textureNodeName}.outputs:r>`,
      'connection'
    );
  }

  // Process metallic/roughness texture with optimized mapping
  // Only process if NOT using PBRSpecularGlossiness (specular workflow)
  // hasPBRSpecGloss is already checked above, reuse the variable

  if (!hasPBRSpecGloss) {
    const metallicRoughnessTexture = material.getMetallicRoughnessTexture();
    if (metallicRoughnessTexture) {
      const textureId = await generateTextureId(metallicRoughnessTexture, 'metallicRoughness');
      const textureNodeName = `Texture_${textureId}`;
      const uvSet = getTextureUVSet(material, 'metallicRoughness');

      textures.push({
        texture: metallicRoughnessTexture,
        id: textureId,
        type: 'metallicRoughness',
        uvSet,
        transform: getTextureTransform(material, 'metallicRoughness')
      });

      // Create optimized texture shader network for metallic/roughness
      const metallicRoughnessTextureInfo = material.getMetallicRoughnessTextureInfo();
      const { textureShader } = createOptimizedTextureShader(
        materialPath,
        textureId,
        textureNodeName,
        true,
        false,
        metallicRoughnessTexture,
        metallicRoughnessTextureInfo,
        materialNode,
        uvSetReaders,
        uvSetTransforms
      );

      materialNode.addChild(textureShader);

      // Connect metallic and roughness channels (correct channel mapping)
      surfaceShader.setProperty(
        'float inputs:metallic.connect',
        `<${materialPath}/${textureNodeName}.outputs:b>`,
        'connection'
      );
      surfaceShader.setProperty(
        'float inputs:roughness.connect',
        `<${materialPath}/${textureNodeName}.outputs:g>`,
        'connection'
      );
    } else {
      // Process metallic and roughness factors (only if no texture and not using specular workflow)
      const metallicFactor = material.getMetallicFactor();
      surfaceShader.setProperty('float inputs:metallic', (metallicFactor ?? 0.0).toString(), 'float');

      const roughnessFactor = material.getRoughnessFactor();
      surfaceShader.setProperty('float inputs:roughness', (roughnessFactor ?? 0.5).toString(), 'float');
    }
  } else {
    // For PBRSpecularGlossiness, set default metallic/roughness to avoid interference
    // These values are ignored when useSpecularWorkflow=1, but setting them prevents issues
    surfaceShader.setProperty('float inputs:metallic', '0.0', 'float');
    surfaceShader.setProperty('float inputs:roughness', '0.5', 'float');
    console.log(`[buildUsdMaterial] Using specular workflow - metallic/roughness set to defaults (ignored when useSpecularWorkflow=1)`);
  }

  // Process opacity from baseColorFactor/diffuseFactor alpha and alphaMode
  // Note: alphaMode and alphaCutoff are already declared above (before texture processing)
  // This is only used when there's NO baseColorTexture (opacity comes from baseColorFactor/diffuseFactor)
  // When there IS a baseColorTexture, opacity is connected from texture alpha channel (see above)
  // For PBRSpecularGlossiness materials, use diffuseFactor instead of baseColorFactor
  let baseColorFactorForOpacity = material.getBaseColorFactor();
  if (hasPBRSpecGloss) {
    const specGlossExtension = material.getExtension<PBRSpecularGlossiness>('KHR_materials_pbrSpecularGlossiness');
    if (specGlossExtension) {
      const diffuseFactor = specGlossExtension.getDiffuseFactor();
      if (diffuseFactor && diffuseFactor.length >= 4) {
        baseColorFactorForOpacity = diffuseFactor; // Use diffuseFactor for PBRSpecularGlossiness
      }
    }
  }

  let opacity = 1.0;
  if (baseColorFactorForOpacity && baseColorFactorForOpacity.length >= 4) {
    opacity = baseColorFactorForOpacity[3]; // 4th element is alpha
  }

  // Handle alphaMode: OPAQUE, MASK, or BLEND
  // For OPAQUE, opacity is always 1.0 (alpha is ignored)
  // For MASK, opacity is 1.0 if baseColorFactor alpha >= alphaCutoff, else 0.0
  //   (when a texture is present, inputs:opacityThreshold handles cutoff per-pixel)
  // For BLEND, opacity is the alpha value directly
  if (alphaMode === Material.AlphaMode.OPAQUE) {
    opacity = 1.0;
  } else if (alphaMode === Material.AlphaMode.MASK) {
    // No texture: bake the constant alpha against the cutoff threshold
    opacity = opacity >= alphaCutoff ? 1.0 : 0.0;
  } else if (alphaMode === Material.AlphaMode.BLEND) {
    // BLEND mode: use alpha value directly for transparency
    // opacity is already set from baseColorFactor[3]
  }

  surfaceShader.setProperty('float inputs:opacity', opacity.toString(), 'float');

  // Log opacity processing for debugging
  if (alphaMode !== Material.AlphaMode.OPAQUE || opacity !== 1.0) {
    console.log(`[buildUsdMaterial] Processed opacity for material: ${materialName}`, {
      alphaMode: Material.AlphaMode[alphaMode],
      alphaCutoff,
      baseColorFactorAlpha: baseColorFactorForOpacity && baseColorFactorForOpacity.length >= 4 ? baseColorFactorForOpacity[3] : undefined,
      finalOpacity: opacity
    });
  }

  // useSpecularWorkflow flag is already set above (before texture processing)

  // Handle PBRSpecularGlossiness factors when no textures are present
  if (hasPBRSpecGloss) {
    const specGlossExtension = material.getExtension<PBRSpecularGlossiness>('KHR_materials_pbrSpecularGlossiness');
    if (specGlossExtension) {
      // Check if we have specularGlossinessTexture - if not, use factors
      const specularGlossinessTexture = specGlossExtension.getSpecularGlossinessTexture();
      if (!specularGlossinessTexture) {
        // No texture - use specularFactor and glossinessFactor directly
        const specularFactor = specGlossExtension.getSpecularFactor();
        if (specularFactor) {
          surfaceShader.setProperty(
            'color3f inputs:specularColor',
            `(${specularFactor[0]}, ${specularFactor[1]}, ${specularFactor[2]})`
          );
        }
        const glossinessFactor = specGlossExtension.getGlossinessFactor();
        if (glossinessFactor !== undefined) {
          // Use 'glossiness' input when useSpecularWorkflow=1
          // This matches AR Quick Look's extended UsdPreviewSurface implementation
          surfaceShader.setProperty('float inputs:glossiness', glossinessFactor.toString(), 'float');
        }
        console.log(`[buildUsdMaterial] Set PBRSpecularGlossiness factors (no texture): specularFactor=${specularFactor}, glossinessFactor=${glossinessFactor}`);
      }
    }
  }

  // Add outputs:surface declaration - required for rendering
  surfaceShader.setProperty('token outputs:surface', '');

  // Process material extensions using the extension factory
  // This allows for extensible handling of various GLTF material extensions
  const extensionContext = {
    material,
    materialName,
    materialPath,
    baseColorTexture,
    textures
  };

  const extensionResults = await ExtensionFactory.processMaterialExtensions(material, extensionContext);

  // Collect textures and properties from all extension processors
  const allProperties: Record<string, unknown> = {};
  const extensionTextures: TextureReference[] = [];
  for (const result of extensionResults) {
    if (result.processed) {
      if (result.textures.length > 0) {
        extensionTextures.push(...result.textures);
        textures.push(...result.textures);
      }
      if (result.properties) {
        Object.assign(allProperties, result.properties);
      }
    } else if (result.error) {
      console.warn(`[buildUsdMaterial] Extension processing error: ${result.error}`);
    }
  }

  // Create shader nodes for extension textures and connect to PreviewSurface
  for (const texRef of extensionTextures) {
    if (!texRef.texture) continue; // Skip baked textures (already handled)

    try {
      const textureNodeName = `Texture_${texRef.id}`;
      const isNormalMap = texRef.type === 'normal' || texRef.type === 'clearcoatNormal';

      // Get TextureInfo from material extension dynamically
      // This function handles all supported GLTF material extensions
      const extensionTextureInfo = getExtensionTextureInfo(material, texRef.type);

      // Create texture shader node
      const { textureShader } = createOptimizedTextureShader(
        materialPath,
        texRef.id,
        textureNodeName,
        isNormalMap,
        isNormalMap,
        texRef.texture,
        extensionTextureInfo,
        materialNode,
        uvSetReaders,
        uvSetTransforms
      );

      materialNode.addChild(textureShader);

      // Connect to PreviewSurface based on texture type
      switch (texRef.type) {
        case 'diffuse':
          // PBRSpecularGlossiness diffuse texture - use as diffuseColor if not already set
          if (!baseColorTexture && !bakedVertexColorTexture) {
            surfaceShader.setProperty(
              'color3f inputs:diffuseColor.connect',
              `<${materialPath}/${textureNodeName}.outputs:rgb>`,
              'connection'
            );
            console.log(`[buildUsdMaterial] Connected extension diffuse texture to diffuseColor: ${texRef.id}`);
          }
          break;
        case 'specular':
          // PBRSpecularGlossiness specularGlossinessTexture
          // RGB channel → specularColor, A channel → glossiness
          // Use 'glossiness' input when useSpecularWorkflow=1
          // This matches AR Quick Look's extended UsdPreviewSurface implementation
          surfaceShader.setProperty(
            'color3f inputs:specularColor.connect',
            `<${materialPath}/${textureNodeName}.outputs:rgb>`,
            'connection'
          );
          surfaceShader.setProperty(
            'float inputs:glossiness.connect',
            `<${materialPath}/${textureNodeName}.outputs:a>`,
            'connection'
          );
          console.log(`[buildUsdMaterial] Connected PBRSpecularGlossiness texture: RGB→specularColor, A→glossiness: ${texRef.id}`);
          break;
        case 'specularColor':
          // KHR_materials_specular specularColorTexture - only RGB
          surfaceShader.setProperty(
            'color3f inputs:specularColor.connect',
            `<${materialPath}/${textureNodeName}.outputs:rgb>`,
            'connection'
          );
          console.log(`[buildUsdMaterial] Connected extension specularColor texture to specularColor: ${texRef.id}`);
          break;
        case 'clearcoat':
          surfaceShader.setProperty(
            'float inputs:clearcoat.connect',
            `<${materialPath}/${textureNodeName}.outputs:r>`,
            'connection'
          );
          break;
        case 'clearcoatRoughness':
          surfaceShader.setProperty(
            'float inputs:clearcoatRoughness.connect',
            `<${materialPath}/${textureNodeName}.outputs:g>`,
            'connection'
          );
          break;
        case 'clearcoatNormal':
          surfaceShader.setProperty(
            'normal3f inputs:clearcoatNormal.connect',
            `<${materialPath}/${textureNodeName}.outputs:rgb>`,
            'connection'
          );
          break;
        case 'sheenColor':
          surfaceShader.setProperty(
            'color3f inputs:sheenColor.connect',
            `<${materialPath}/${textureNodeName}.outputs:rgb>`,
            'connection'
          );
          break;
        case 'sheenRoughness':
          surfaceShader.setProperty(
            'float inputs:sheenRoughness.connect',
            `<${materialPath}/${textureNodeName}.outputs:a>`,
            'connection'
          );
          break;
        case 'transmission':
          surfaceShader.setProperty(
            'float inputs:transmission.connect',
            `<${materialPath}/${textureNodeName}.outputs:r>`,
            'connection'
          );
          break;
        case 'thickness':
          surfaceShader.setProperty(
            'float inputs:thickness.connect',
            `<${materialPath}/${textureNodeName}.outputs:r>`,
            'connection'
          );
          break;
        default:
          console.warn(`[buildUsdMaterial] Unhandled extension texture type: ${texRef.type}`);
      }
    } catch (error) {
      console.warn(`[buildUsdMaterial] Failed to create shader for extension texture ${texRef.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Apply extracted properties to material
  if (allProperties.emissiveStrength !== undefined) {
    const strength = allProperties.emissiveStrength as number;
    if (emissiveTextureShaderNode) {
      // Emissive is texture-connected: multiply existing scale (emissiveFactor) by strength.
      // The existing scale was set from emissiveFactor — we must preserve that color tint.
      const currentScale = emissiveTextureShaderNode.getProperty('float4 inputs:scale');
      let sr = strength, sg = strength, sb = strength;
      if (currentScale && typeof currentScale === 'string') {
        const match = currentScale.match(/\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
        if (match) {
          sr = parseFloat(match[1]) * strength;
          sg = parseFloat(match[2]) * strength;
          sb = parseFloat(match[3]) * strength;
        }
      }
      emissiveTextureShaderNode.setProperty(
        'float4 inputs:scale',
        `(${sr}, ${sg}, ${sb}, 1)`,
        'float4'
      );
    } else {
      // Emissive is a flat color: multiply the color by strength
      const currentEmissive = surfaceShader.getProperty('color3f inputs:emissiveColor');
      if (currentEmissive && typeof currentEmissive === 'string') {
        const match = currentEmissive.match(/\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);
        if (match) {
          const r = parseFloat(match[1]) * strength;
          const g = parseFloat(match[2]) * strength;
          const b = parseFloat(match[3]) * strength;
          surfaceShader.setProperty('color3f inputs:emissiveColor', `(${r}, ${g}, ${b})`);
        }
      }
    }
  }

  if (allProperties.ior !== undefined) {
    const ior = allProperties.ior as number;
    // USD PreviewSurface doesn't have direct IOR input, but we can store it as metadata
    surfaceShader.setProperty('float inputs:ior', ior.toString(), 'float');
  }

  if (allProperties.dispersion !== undefined) {
    const dispersion = allProperties.dispersion as number;
    // USD PreviewSurface doesn't have direct dispersion input, store as metadata
    surfaceShader.setProperty('float inputs:dispersion', dispersion.toString(), 'float');
  }

  if (allProperties.unlit === true) {
    // For unlit materials, route base color through emissive channel (lighting-independent)
    // UsdPreviewSurface has no native "unlit" mode, so we:
    // 1. Move base color (texture or factor) from diffuseColor → emissiveColor
    // 2. Set diffuseColor to black (no lit contribution)
    // 3. Set roughness=1, metallic=0 (prevent specular highlights)
    
    // Check if base color texture was connected to diffuseColor
    const diffuseConnection = surfaceShader.getProperty('color3f inputs:diffuseColor.connect');
    if (diffuseConnection && typeof diffuseConnection === 'string') {
      // Redirect: connect the same texture to emissiveColor instead
      surfaceShader.setProperty(
        'color3f inputs:emissiveColor.connect',
        diffuseConnection,
        'connection'
      );
    } else {
      // No texture — use the diffuseColor value as emissiveColor
      const diffuseValue = surfaceShader.getProperty('color3f inputs:diffuseColor');
      if (diffuseValue && typeof diffuseValue === 'string') {
        surfaceShader.setProperty('color3f inputs:emissiveColor', diffuseValue);
      }
    }

    // Zero out diffuseColor so lighting doesn't contribute
    surfaceShader.setProperty('color3f inputs:diffuseColor', '(0, 0, 0)');
    // Remove the diffuse connection if it existed (we moved it to emissive)
    if (diffuseConnection) {
      surfaceShader.removeProperty('color3f inputs:diffuseColor.connect');
    }
    surfaceShader.setProperty('float inputs:roughness', '1.0', 'float');
    surfaceShader.setProperty('float inputs:metallic', '0.0', 'float');
    console.log(`[buildUsdMaterial] Material marked as unlit (using emissive channel): ${materialName}`);
  }

  // Add shared UV reader and Transform2d nodes to material
  materialNode.addChild(uvReader);
  materialNode.addChild(transform2d);

  // Add surface shader to material
  materialNode.addChild(surfaceShader);

  // Connect material output to surface shader
  materialNode.setProperty(
    'token outputs:surface.connect',
    `<${materialPath}/PreviewSurface.outputs:surface>`,
    'connection'
  );

  return {
    materialNode,
    textures,
    uvReaders: [uvReader],
    transform2dNodes: [transform2d]
  };
}


/**
 * Get UV set index for texture based on material's texture info
 */
function getTextureUVSet(material: Material, textureType: 'baseColor' | 'normal' | 'emissive' | 'occlusion' | 'metallicRoughness'): number {
  let textureInfo = null;

  switch (textureType) {
    case 'baseColor':
      textureInfo = material.getBaseColorTextureInfo();
      break;
    case 'normal':
      textureInfo = material.getNormalTextureInfo();
      break;
    case 'emissive':
      textureInfo = material.getEmissiveTextureInfo();
      break;
    case 'occlusion':
      textureInfo = material.getOcclusionTextureInfo();
      break;
    case 'metallicRoughness':
      textureInfo = material.getMetallicRoughnessTextureInfo();
      break;
  }

  if (textureInfo) {
    const texCoord = textureInfo.getTexCoord();
    return texCoord;
  }
  // Default to UV set 0
  return 0;
}

/**
 * Get texture transform information from material's texture info
 */
function getTextureTransform(material: Material, textureType: 'baseColor' | 'normal' | 'emissive' | 'occlusion' | 'metallicRoughness'): TextureMappingConfig['transform'] | undefined {
  let textureInfo = null;

  switch (textureType) {
    case 'baseColor':
      textureInfo = material.getBaseColorTextureInfo();
      break;
    case 'normal':
      textureInfo = material.getNormalTextureInfo();
      break;
    case 'emissive':
      textureInfo = material.getEmissiveTextureInfo();
      break;
    case 'occlusion':
      textureInfo = material.getOcclusionTextureInfo();
      break;
    case 'metallicRoughness':
      textureInfo = material.getMetallicRoughnessTextureInfo();
      break;
  }

  return extractTextureTransform(textureInfo);
}

/**
 * Get texture wrapping modes (wrapS/wrapT) from GLTF TextureInfo
 * Maps GLTF wrap modes to USD wrap modes
 * 
 * GLTF wrap modes (WebGL enum values):
 * - 10497 = REPEAT
 * - 33071 = CLAMP_TO_EDGE
 * - 33648 = MIRRORED_REPEAT
 * 
 * USD wrap modes:
 * - 'repeat' = REPEAT
 * - 'clamp' = CLAMP_TO_EDGE
 * - 'mirror' = MIRRORED_REPEAT
 */
function getTextureWrapModes(textureInfo: TextureInfo | null): { wrapS: 'repeat' | 'clamp' | 'mirror'; wrapT: 'repeat' | 'clamp' | 'mirror' } {
  // Default to 'repeat' (GLTF spec default)
  let wrapS: 'repeat' | 'clamp' | 'mirror' = 'repeat';
  let wrapT: 'repeat' | 'clamp' | 'mirror' = 'repeat';

  if (!textureInfo) {
    // textureInfo is null — no sampler data available; falling back to GLTF defaults (repeat/repeat)
    console.warn('[getTextureWrapModes] TextureInfo is null; defaulting to wrapS=repeat, wrapT=repeat');
    return { wrapS, wrapT };
  }

  if (textureInfo) {
    // Get wrap modes from TextureInfo (which includes sampler properties)
    const wrapSMode = textureInfo.getWrapS();
    const wrapTMode = textureInfo.getWrapT();

    // Map GLTF wrap mode to USD wrap mode
    // GLTF uses WebGL enum values: 10497 (REPEAT), 33071 (CLAMP_TO_EDGE), 33648 (MIRRORED_REPEAT)
    if (wrapSMode === 33071) { // CLAMP_TO_EDGE
      wrapS = 'clamp';
    } else if (wrapSMode === 33648) { // MIRRORED_REPEAT
      wrapS = 'mirror';
    } else { // 10497 = REPEAT or undefined (defaults to REPEAT)
      wrapS = 'repeat';
    }

    if (wrapTMode === 33071) { // CLAMP_TO_EDGE
      wrapT = 'clamp';
    } else if (wrapTMode === 33648) { // MIRRORED_REPEAT
      wrapT = 'mirror';
    } else { // 10497 = REPEAT or undefined (defaults to REPEAT)
      wrapT = 'repeat';
    }
  }

  return { wrapS, wrapT };
}

/**
 * Get TextureInfo from material extension based on texture type
 * Dynamically retrieves TextureInfo for all supported GLTF material extensions
 * 
 * @param material - GLTF material
 * @param textureType - Type of texture to get TextureInfo for
 * @returns TextureInfo or null if not found
 */
function getExtensionTextureInfo(material: Material, textureType: TextureType): TextureInfo | null {
  switch (textureType) {
    // PBRSpecularGlossiness extension
    case 'specular': {
      const specGloss = material.getExtension<PBRSpecularGlossiness>('KHR_materials_pbrSpecularGlossiness');
      return specGloss?.getSpecularGlossinessTextureInfo() || null;
    }
    case 'diffuse': {
      // Check if it's from PBRSpecularGlossiness extension
      const specGloss = material.getExtension<PBRSpecularGlossiness>('KHR_materials_pbrSpecularGlossiness');
      if (specGloss) {
        return specGloss.getDiffuseTextureInfo();
      }
      // Otherwise, it's the standard baseColorTexture (handled separately)
      return null;
    }
    // KHR_materials_specular extension
    case 'specularColor': {
      const specular = material.getExtension<Specular>('KHR_materials_specular');
      return specular?.getSpecularColorTextureInfo() || null;
    }
    // KHR_materials_clearcoat extension
    case 'clearcoat': {
      const clearcoat = material.getExtension<Clearcoat>('KHR_materials_clearcoat');
      return clearcoat?.getClearcoatTextureInfo() || null;
    }
    case 'clearcoatRoughness': {
      const clearcoat = material.getExtension<Clearcoat>('KHR_materials_clearcoat');
      return clearcoat?.getClearcoatRoughnessTextureInfo() || null;
    }
    case 'clearcoatNormal': {
      const clearcoat = material.getExtension<Clearcoat>('KHR_materials_clearcoat');
      return clearcoat?.getClearcoatNormalTextureInfo() || null;
    }
    // KHR_materials_sheen extension
    case 'sheenColor': {
      const sheen = material.getExtension<Sheen>('KHR_materials_sheen');
      return sheen?.getSheenColorTextureInfo() || null;
    }
    case 'sheenRoughness': {
      const sheen = material.getExtension<Sheen>('KHR_materials_sheen');
      return sheen?.getSheenRoughnessTextureInfo() || null;
    }
    // KHR_materials_transmission extension
    case 'transmission': {
      const transmission = material.getExtension<Transmission>('KHR_materials_transmission');
      return transmission?.getTransmissionTextureInfo() || null;
    }
    // KHR_materials_volume extension
    case 'thickness': {
      const volume = material.getExtension<Volume>('KHR_materials_volume');
      return volume?.getThicknessTextureInfo() || null;
    }
    // KHR_materials_iridescence extension
    case 'iridescence': {
      const iridescence = material.getExtension<Iridescence>('KHR_materials_iridescence');
      return iridescence?.getIridescenceTextureInfo() || null;
    }
    case 'iridescenceThickness': {
      const iridescence = material.getExtension<Iridescence>('KHR_materials_iridescence');
      return iridescence?.getIridescenceThicknessTextureInfo() || null;
    }
    // KHR_materials_diffuse_transmission extension
    case 'diffuseTransmission': {
      const diffuseTransmission = material.getExtension<DiffuseTransmission>('KHR_materials_diffuse_transmission');
      return diffuseTransmission?.getDiffuseTransmissionTextureInfo() || null;
    }
    case 'diffuseTransmissionColor': {
      const diffuseTransmission = material.getExtension<DiffuseTransmission>('KHR_materials_diffuse_transmission');
      return diffuseTransmission?.getDiffuseTransmissionColorTextureInfo() || null;
    }
    // KHR_materials_anisotropy extension
    case 'anisotropy': {
      const anisotropy = material.getExtension<Anisotropy>('KHR_materials_anisotropy');
      return anisotropy?.getAnisotropyTextureInfo() || null;
    }
    // Standard PBR textures (handled separately, not extensions)
    case 'normal':
    case 'metallicRoughness':
    case 'emissive':
    case 'occlusion':
      return null;
    default:
      return null;
  }
}

/**
 * Create texture shader with UV reader and Transform2d
 * Creates a Transform2d per texture if it has texture transforms, otherwise uses shared one
 * Uses the correct PrimvarReader based on the texture's texCoord (UV set)
 */
function createOptimizedTextureShader(
  materialPath: string,
  textureId: string,
  textureNodeName: string,
  isLinearData: boolean,
  isNormalMap: boolean,
  texture: Texture,
  textureInfo: TextureInfo | null,
  materialNode: UsdNode,
  uvSetReaders: Map<number, UsdNode>,
  uvSetTransforms: Map<number, UsdNode>,
  scaleFactor?: [number, number, number, number] // Optional scale factor (e.g., baseColorFactor)
): { textureShader: UsdNode; transform2d: UsdNode | undefined } {
  // Get UV set index from textureInfo (defaults to 0 if not specified)
  const uvSetIndex = textureInfo ? textureInfo.getTexCoord() : 0;

  // Get or create PrimvarReader for this UV set
  let uvReader = uvSetReaders.get(uvSetIndex);
  if (!uvReader) {
    // Create PrimvarReader for this UV set
    const primvarName = uvSetIndex === 0 ? 'st' : `st${uvSetIndex}`;
    uvReader = new UsdNode(`${materialPath}/PrimvarReader_${primvarName}`, 'Shader');
    uvReader.setProperty('uniform token info:id', 'UsdPrimvarReader_float2');
    uvReader.setProperty('float2 inputs:fallback', '(0, 0)', 'float2');
    uvReader.setProperty('string inputs:varname', primvarName, 'string');
    uvReader.setProperty('float2 outputs:result', '');
    materialNode.addChild(uvReader);
    uvSetReaders.set(uvSetIndex, uvReader);
  }

  // Get or create Transform2d for this UV set (shared, no transform)
  let sharedTransform2d = uvSetTransforms.get(uvSetIndex);
  if (!sharedTransform2d) {
    const primvarName = uvSetIndex === 0 ? 'st' : `st${uvSetIndex}`;
    sharedTransform2d = new UsdNode(`${materialPath}/Transform2d_${primvarName}`, 'Shader');
    sharedTransform2d.setProperty('uniform token info:id', 'UsdTransform2d');
    sharedTransform2d.setProperty('float2 inputs:in.connect', `<${materialPath}/PrimvarReader_${primvarName}.outputs:result>`, 'connection');
    sharedTransform2d.setProperty('float inputs:rotation', '0', 'float');
    sharedTransform2d.setProperty('float2 inputs:scale', '(1, 1)', 'float2');
    sharedTransform2d.setProperty('float2 inputs:translation', '(0, 0)', 'float2');
    sharedTransform2d.setProperty('float2 outputs:result', '');
    materialNode.addChild(sharedTransform2d);
    uvSetTransforms.set(uvSetIndex, sharedTransform2d);
  }

  // Create texture shader
  const textureShader = new UsdNode(`${materialPath}/${textureNodeName}`, 'Shader');
  textureShader.setProperty('uniform token info:id', 'UsdUVTexture');

  // Detect the correct file extension based on texture data
  const textureExtension = getTextureExtension(texture);
  // Content-addressed asset path (see note in the companion .png site above).
  textureShader.setProperty('asset inputs:file', `@textures/Texture_${getTextureFileBasename(textureId)}.${textureExtension}@`, 'asset');

  // Set color space based on texture type
  // Non-color data (normal maps, metallic-roughness, occlusion) must use raw/linear
  if (isLinearData) {
    textureShader.setProperty('token inputs:sourceColorSpace', 'raw', 'token');
  } else {
    textureShader.setProperty('token inputs:sourceColorSpace', 'sRGB', 'token');
  }

  // Extract wrapping modes from GLTF TextureInfo dynamically
  const { wrapS, wrapT } = getTextureWrapModes(textureInfo);
  textureShader.setProperty('token inputs:wrapS', wrapS, 'token');
  textureShader.setProperty('token inputs:wrapT', wrapT, 'token');

  // Check if this texture has KHR_texture_transform
  let transform2d: UsdNode | undefined;
  let transformConnection: string;
  const primvarName = uvSetIndex === 0 ? 'st' : `st${uvSetIndex}`;

  if (textureInfo) {
    const textureTransform = extractTextureTransform(textureInfo);
    if (textureTransform && (textureTransform.offset[0] !== 0 || textureTransform.offset[1] !== 0 ||
      textureTransform.scale[0] !== 1 || textureTransform.scale[1] !== 1 ||
      textureTransform.rotation !== 0)) {
      // This texture has transform - create dedicated Transform2d
      const transform2dName = `Transform2d_${textureId}`;
      transform2d = new UsdNode(`${materialPath}/${transform2dName}`, 'Shader');
      transform2d.setProperty('uniform token info:id', 'UsdTransform2d');
      transform2d.setProperty('float2 inputs:in.connect', `<${materialPath}/PrimvarReader_${primvarName}.outputs:result>`, 'connection');

      const rotationRad = textureTransform.rotation;
      const rotationDeg = (rotationRad * 180) / Math.PI;
      transform2d.setProperty('float inputs:rotation', rotationDeg.toString(), 'float');
      transform2d.setProperty('float2 inputs:scale', `(${textureTransform.scale[0]}, ${textureTransform.scale[1]})`, 'float2');
      transform2d.setProperty('float2 inputs:translation', `(${textureTransform.offset[0]}, ${textureTransform.offset[1]})`, 'float2');
      transform2d.setProperty('float2 outputs:result', '');

      materialNode.addChild(transform2d);
      transformConnection = `<${materialPath}/${transform2dName}.outputs:result>`;
    } else {
      // No transform - use shared Transform2d for this UV set
      transformConnection = `<${materialPath}/Transform2d_${primvarName}.outputs:result>`;
    }
  } else {
    // No TextureInfo - use shared Transform2d for UV set 0
    transformConnection = `<${materialPath}/Transform2d_st.outputs:result>`;
  }

  textureShader.setProperty(
    'float2 inputs:st.connect',
    transformConnection,
    'connection'
  );

  // Add scale and bias based on texture type
  if (isNormalMap) {
    // Normal maps require specific bias and scale values for USD compliance
    // USD standard: bias=(-1, -1, -1, 0), scale=(2, 2, 2, 1) for 8-bit normal maps
    textureShader.setProperty('float4 inputs:scale', '(2, 2, 2, 1)', 'float4');
    textureShader.setProperty('float4 inputs:bias', '(-1, -1, -1, 0)', 'float4');
  } else {
    // Regular textures: use scaleFactor if provided (e.g., baseColorFactor), otherwise default to (1, 1, 1, 1)
    // baseColorFactor is applied as scale to the texture for proper color tinting
    // ALWAYS apply scaleFactor if provided, even if it's (1, 1, 1, 1) - this ensures consistency
    if (scaleFactor) {
      textureShader.setProperty('float4 inputs:scale', `(${scaleFactor[0]}, ${scaleFactor[1]}, ${scaleFactor[2]}, ${scaleFactor[3]})`, 'float4');
      // Log scale application for debugging
      const isNotDefault = scaleFactor[0] !== 1 || scaleFactor[1] !== 1 || scaleFactor[2] !== 1 || scaleFactor[3] !== 1;
      if (isNotDefault) {
        console.log(`[createOptimizedTextureShader] Applied non-default scale to texture: ${textureNodeName}`, {
          scale: scaleFactor,
          textureId
        });
      }
    } else {
      textureShader.setProperty('float4 inputs:scale', '(1, 1, 1, 1)', 'float4');
    }
  }

  // Add outputs for individual channels and RGB
  textureShader.setProperty('float outputs:r', '');
  textureShader.setProperty('float outputs:g', '');
  textureShader.setProperty('float outputs:b', '');
  textureShader.setProperty('float outputs:a', '');
  textureShader.setProperty('float3 outputs:rgb', '');

  return { textureShader, transform2d };
}

/**
 * Extract texture data as ArrayBuffer
 */
/**
 * Extract texture data as ArrayBuffer
 */
export async function extractTextureData(texture: Texture): Promise<ArrayBuffer> {
  const cleanData = getCleanTextureImage(texture);
  if (!cleanData) {
    throw new Error(`Texture has no image data`);
  }

  // Convert Uint8Array to ArrayBuffer
  return cleanData.buffer.slice(cleanData.byteOffset, cleanData.byteOffset + cleanData.byteLength) as ArrayBuffer;
}

/**
 * Build materials node for optimal USDZ compatibility
 */
export function buildMaterialsNode(materials: any): UsdNode {
  const materialsNode = new UsdNode('/Root/Materials', 'Scope');

  for (const materialId in materials) {
    const material = materials[materialId];
    const materialName = material.name || `Material_${materialId}`;
    const materialPath = `/Root/Materials/${materialName}`;

    // Create material node
    const materialNode = new UsdNode(materialPath, 'Material');

    // Create PreviewSurface shader
    const surfaceShader = new UsdNode(`${materialPath}/PreviewSurface`, 'Shader');
    surfaceShader.setProperty('uniform token info:id', 'UsdPreviewSurface');

    // Set base material properties
    if (material.color) {
      const color = material.color;
      surfaceShader.setProperty('color3f inputs:diffuseColor', `(${color.r}, ${color.g}, ${color.b})`, 'color3f');
    }

    if (material.metalness !== undefined) {
      surfaceShader.setProperty('float inputs:metallic', material.metalness.toString(), 'float');
    }

    if (material.roughness !== undefined) {
      surfaceShader.setProperty('float inputs:roughness', material.roughness.toString(), 'float');
    }

    if (material.emissive) {
      const emissive = material.emissive;
      surfaceShader.setProperty('color3f inputs:emissiveColor', `(${emissive.r}, ${emissive.g}, ${emissive.b})`, 'color3f');
    }

    // Set opacity
    if (material.transparent && material.opacity !== undefined) {
      surfaceShader.setProperty('float inputs:opacity', material.opacity.toString(), 'float');
    } else {
      surfaceShader.setProperty('float inputs:opacity', '1', 'float');
    }

    // Add surface shader to material
    materialNode.addChild(surfaceShader);

    // Connect material output to surface shader
    materialNode.setProperty(
      'token outputs:surface.connect',
      `<${materialPath}/PreviewSurface.outputs:surface>`,
      'connection'
    );

    // Add material to materials node
    materialsNode.addChild(materialNode);
  }

  return materialsNode;
}

