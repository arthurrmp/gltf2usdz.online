/** WebUsdFramework.Converters.Obj.ObjConverter - Main OBJ to USDZ converter orchestra */

import { ObjConverterConfig } from '../../schemas';
import { Logger, LoggerFactory } from '../../utils';
import { ObjParserFactory } from './obj-parser';
import { ParsedGeometry } from './obj-mesh-parser';
import { createRootStructure } from '../shared/usd-root-builder';
import { adaptObjMeshesToUsd, createUsdMeshFromObj } from './helpers/obj-to-usd-adapter';
import {
  createUsdzPackage,
  createUsdzPackageToFile,
  PackageContent,
  getTextureExtensionFromData,
  ConvertOptions,
  UsdzStreamResult
} from '../shared/usd-packaging';
import {
  writeDebugOutput,
  DebugOutputContent
} from '../shared/debug-writer';
import { UsdNode } from '../../core/usd-node';
import { USD_PROPERTIES, USD_PROPERTY_TYPES } from '../../constants/usd';
import * as path from 'path';
import * as fs from 'fs';

// Constants
const DEFAULT_CONFIG: ObjConverterConfig = {
  debug: false,
  debugOutputDir: './debug-output',
  upAxis: 'Y',
  metersPerUnit: 1,
  allowAutoTextureFallback: false,
  mtlSearchPaths: [],
  textureSearchPaths: [],
  materialPerSmoothingGroup: true,
  useOAsMesh: true,
  useIndices: true,
  disregardNormals: false
};

// Types for parsed MTL values and texture bindings
type MtlMapBinding = {
  textureId: string;
  textureExt: string;
  textureData: ArrayBuffer;
};

type MtlMaterial = {
  kd?: [number, number, number]; // diffuse color
  ks?: [number, number, number]; // specular color
  ns?: number; // shininess
  d?: number; // opacity
  // maps
  map_Kd?: MtlMapBinding;
  map_Ks?: MtlMapBinding;
  map_Bump?: MtlMapBinding;
};

// Make a valid USD prim name: [A-Za-z_][A-Za-z0-9_]*
function sanitizeUsdName(name: string): string {
  const replaced = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(replaced)) return `M_${replaced}`;
  return replaced;
}

// Resolve texture path relative to the MTL folder with practical fallbacks
function resolveTexturePath(mtlDir: string, rel: string, extraRoots: string[] = []): string | undefined {
  // Normalize quotes/backslashes
  let texRel = rel.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  // Absolute
  if (path.isAbsolute(texRel) && fs.existsSync(texRel)) return texRel;
  // Direct relative
  let cand = path.resolve(mtlDir, texRel);
  if (fs.existsSync(cand)) return cand;
  // Try common subfolders/parent with basename
  const base = path.basename(texRel);
  const commonDirs = ['tex', 'textures', 'Tex', 'Textures', 'images', 'Images', 'maps', 'Maps', 'materials', 'Materials'];
  const candidates: string[] = [path.resolve(mtlDir, '..', base)];
  for (const d of commonDirs) candidates.push(path.resolve(mtlDir, d, base));
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  for (const root of extraRoots) {
    const p = path.resolve(root, base);
    if (fs.existsSync(p)) return p;
  }
  // Case-insensitive shallow scan
  const dirsToScan = [mtlDir, path.resolve(mtlDir, '..'), ...commonDirs.map(d => path.resolve(mtlDir, d)), ...extraRoots];
  const targetLower = base.toLowerCase();
  for (const d of dirsToScan) {
    if (!fs.existsSync(d)) continue;
    try {
      for (const e of fs.readdirSync(d)) {
        if (e.toLowerCase() === targetLower) return path.join(d, e);
      }
    } catch { /* ignore */ }
  }
  // Shallow recursive search (bounded depth)
  const queue: Array<{ dir: string, depth: number }> = [];
  queue.push({ dir: mtlDir, depth: 0 });
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (depth > 5) continue;
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          queue.push({ dir: full, depth: depth + 1 });
        } else if (e.toLowerCase() === targetLower) {
          return full;
        }
      } catch { /* ignore */ }
    }
  }
  return undefined;
}

export function convertObjToUsdz(
  input: ArrayBuffer | string,
  config?: ObjConverterConfig
): Promise<Blob>;
export function convertObjToUsdz(
  input: ArrayBuffer | string,
  config: ObjConverterConfig | undefined,
  options: ConvertOptions & { outputPath: string }
): Promise<UsdzStreamResult>;
export async function convertObjToUsdz(
  input: ArrayBuffer | string,
  config?: ObjConverterConfig,
  options?: ConvertOptions
): Promise<Blob | UsdzStreamResult> {
  const logger = LoggerFactory.forConversion();

  try {
    // Merge config with defaults
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    logger.info('Starting OBJ to USDZ conversion', {
      stage: 'conversion_start',
      inputType: typeof input === 'string' ? 'obj_file' : 'obj_buffer',
      bufferSize: typeof input === 'string' ? 'N/A' : input.byteLength
    });

    // Parse OBJ file
    logger.info('Parsing OBJ file', {
      stage: 'obj_parsing',
      inputType: typeof input === 'string' ? 'file' : 'buffer'
    });

    const meshes: ParsedGeometry[] = await ObjParserFactory.parse(input);

    logger.info('OBJ parsed successfully', {
      stage: 'obj_parsing',
      meshCount: meshes.length
    });

    // Create root structure using existing USD infrastructure
    const rootStructure = createRootStructure('obj_scene');
    const { rootNode, sceneNode, materialsNode } = rootStructure;

    // Adapt OBJ meshes to USD-compatible format
    logger.info('Processing geometries', {
      stage: 'geometry_processing',
      meshCount: meshes.length
    });

    const meshAdapters = adaptObjMeshesToUsd(meshes);

    logger.info('Building node hierarchy', {
      stage: 'hierarchy_building',
      primitiveCount: meshAdapters.length
    });

    // Create materials and bind them to meshes (like GLB converter)
    let materialCounter = 0;
    const textureFiles = new Map<string, ArrayBuffer>();

    // Load material->texture mappings from MTL (supports map_Kd)
    const mtlBindings = typeof input === 'string' ? tryLoadMtlAllMaterials(
      input,
      finalConfig.mtlPath,
      logger,
      finalConfig.allowAutoTextureFallback,
      finalConfig.mtlSearchPaths,
      finalConfig.textureSearchPaths
    ) : new Map<string, MtlMaterial>();
    // Register textures for packaging/debug
    for (const mat of mtlBindings.values()) {
      const maps: (MtlMapBinding | undefined)[] = [mat.map_Kd, mat.map_Ks, mat.map_Bump];
      for (const m of maps) {
        if (!m) continue;
        if (!textureFiles.has(m.textureId)) textureFiles.set(m.textureId, m.textureData);
      }
    }
    // Always ensure at least one default material exists
    const defaultMaterialName = 'defaultMaterial';
    const defaultMaterialPath = `${materialsNode.getPath()}/${sanitizeUsdName(defaultMaterialName)}`;
    const defaultMaterialNode = buildUsdMaterial(defaultMaterialPath, undefined);
    materialsNode.addChild(defaultMaterialNode);
    materialCounter++;

    // Create mesh nodes and bind materials (supports multi-material via GeomSubset)
    for (const meshAdapter of meshAdapters) {
      const meshNode = createUsdMeshFromObj(meshAdapter, sceneNode);

      // Bind material using the same approach as GLB converter
      meshNode.setProperty(
        USD_PROPERTIES.PREPEND_API_SCHEMAS,
        [USD_PROPERTIES.MATERIAL_BINDING_API],
        USD_PROPERTY_TYPES.STRING_ARRAY
      );

      // If the mesh has grouped materials, create subsets per group and bind corresponding materials
      if (meshAdapter.mesh.createMultiMaterial && meshAdapter.mesh.geometryGroups?.length) {
        const groups = meshAdapter.mesh.geometryGroups;
        const materialNames = meshAdapter.mesh.multiMaterial || [];
        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi];
          const subsetName = `Subset_${gi}`;
          const subsetPath = `${meshNode.getPath()}/${subsetName}`;
          const subset = new UsdNode(subsetPath, 'GeomSubset');
          subset.setProperty('uniform token familyName', 'materialBind');
          subset.setProperty('uniform token elementType', 'face');
          // Build face index range for this group
          const start = g.materialGroupOffset;
          const len = g.materialGroupLength;
          const idxList = Array.from({ length: len }, (_, k) => (start + k).toString()).join(', ');
          subset.setProperty('int[] indices', `[${idxList}]`, 'raw');

          // Build or reuse material for this group
          const originalName = materialNames[gi] || defaultMaterialName;
          const matObj = mtlBindings.get(originalName);
          const matName = matObj ? originalName : defaultMaterialName;
          const matPath = `${materialsNode.getPath()}/${sanitizeUsdName(matName)}`;

          if (matObj) {
            const matNode = buildUsdMaterial(matPath, matObj);
            materialsNode.addChild(matNode);
            materialCounter++;
            const tex = matObj.map_Kd ? `${matObj.map_Kd.textureId}.${matObj.map_Kd.textureExt}` : 'color';
            logger.info('Bound material subset', { subset: subsetName, material: matName, texture: tex });
          }
          subset.setProperty(USD_PROPERTIES.MATERIAL_BINDING, `<${matPath}>`, USD_PROPERTY_TYPES.REL);
          meshNode.addChild(subset);
        }
      } else {
        // Single-material: if an MTL binding exists, bind first available material; else default
        let singleMatPath = defaultMaterialPath;
        const firstBindingEntry = mtlBindings.entries().next();
        if (!firstBindingEntry.done) {
          const [matName, matObj] = firstBindingEntry.value as [string, MtlMaterial];
          const matPath = `${materialsNode.getPath()}/${sanitizeUsdName(matName)}`;
          const matNode = buildUsdMaterial(matPath, matObj);
          materialsNode.addChild(matNode);
          materialCounter++;
          singleMatPath = matPath;
          const tex = matObj.map_Kd ? `${matObj.map_Kd.textureId}.${matObj.map_Kd.textureExt}` : 'color';
          logger.info('Bound single material', { material: matName, texture: tex });
        }
        meshNode.setProperty(USD_PROPERTIES.MATERIAL_BINDING, `<${singleMatPath}>`, USD_PROPERTY_TYPES.REL);
      }
    }

    // Add materials to root level for proper USDZ structure (like GLB converter)
    rootNode.addChild(materialsNode);

    logger.info('Generated materials', {
      stage: 'material_generation',
      materialCount: materialCounter,
      textureCount: textureFiles.size
    });

    // Create USDZ package
    logger.info('Generating USDZ package', {
      stage: 'usdz_packaging',
      fileCount: 1 + textureFiles.size // +1 for main USD file
    });

    const packageContent: PackageContent = {
      usdContent: rootNode.serializeToUsda(),
      geometryFiles: new Map(), // No separate geometry files - embedded in main USD
      textureFiles
    };

    if (options?.outputPath) {
      const result = await createUsdzPackageToFile(packageContent, options.outputPath);
      logger.info('USDZ conversion completed', {
        stage: 'conversion_complete',
        usdzSize: result.totalBytes,
        mode: 'streaming',
        outputPath: options.outputPath
      });
      return result;
    }

    const usdzBlob = await createUsdzPackage(packageContent);

    logger.info('USDZ conversion completed', {
      stage: 'conversion_complete',
      usdzSize: usdzBlob.size
    });

    // Write debug output if enabled
    if (finalConfig.debug) {
      const debugContent: DebugOutputContent = {
        usdContent: rootNode.serializeToUsda(),
        geometryFiles: new Map(), // No separate geometry files - embedded in main USD
        textureFiles,
        usdzBlob
      };

      await writeDebugOutput(finalConfig.debugOutputDir, debugContent);
    }

    return usdzBlob;

  } catch (error) {
    logger.error('OBJ to USDZ conversion failed', {
      stage: 'conversion_error',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}


/**
 * Parse all materials from MTL and return mapping materialName -> texture binding (map_Kd only).
 */
function tryLoadMtlAllMaterials(
  objPath: string,
  explicitMtlPath: string | undefined,
  logger: Logger,
  allowAutoTextureFallback: boolean,
  mtlSearchPaths: string[] = [],
  textureSearchPaths: string[] = []
): Map<string, MtlMaterial> {
  const map = new Map<string, MtlMaterial>();
  try {
    const dir = path.dirname(objPath);
    const base = path.basename(objPath, path.extname(objPath));
    let mtlPaths: string[] = [];
    if (explicitMtlPath) {
      const p = path.isAbsolute(explicitMtlPath) ? explicitMtlPath : path.resolve(dir, explicitMtlPath);
      if (fs.existsSync(p)) mtlPaths.push(p);
    } else {
      try {
        const objText = fs.readFileSync(objPath, 'utf8');
        const mtllibMatches = objText.match(/^\s*mtllib\s+(.+)$/gm);
        if (mtllibMatches) {
          for (const m of mtllibMatches) {
            const rel = m.replace(/^\s*mtllib\s+/, '').trim();
            const p = path.isAbsolute(rel) ? rel : path.resolve(dir, rel);
            if (fs.existsSync(p)) mtlPaths.push(p);
          }
        }
      } catch { /* ignore */ }
      // Include user-provided MTL search roots
      try {
        for (const root of mtlSearchPaths || []) {
          if (!fs.existsSync(root)) continue;
          const entries = fs.readdirSync(root);
          for (const e of entries) {
            if (e.toLowerCase().endsWith('.mtl')) mtlPaths.push(path.join(root, e));
          }
        }
      } catch { /* ignore */ }
      if (mtlPaths.length === 0 && allowAutoTextureFallback) {
        const guess = path.join(dir, `${base}.mtl`);
        if (fs.existsSync(guess)) mtlPaths.push(guess);
        // As last resort, pick any .mtl in dir
        const anyMtls = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mtl'));
        for (const f of anyMtls) mtlPaths.push(path.join(dir, f));
        // Recursive search up to depth 3 in current and parent
        if (mtlPaths.length === 0) {
          const startDirs = [dir, path.resolve(dir, '..')];
          const seen = new Set<string>();
          const queue: Array<{ d: string, depth: number }> = [];
          for (const sd of startDirs) if (fs.existsSync(sd)) queue.push({ d: sd, depth: 0 });
          while (queue.length && mtlPaths.length === 0) {
            const { d, depth } = queue.shift()!;
            if (seen.has(d) || depth > 3) continue;
            seen.add(d);
            let entries: string[] = [];
            try { entries = fs.readdirSync(d); } catch { continue; }
            for (const e of entries) {
              const full = path.join(d, e);
              try {
                const st = fs.statSync(full);
                if (st.isDirectory()) {
                  queue.push({ d: full, depth: depth + 1 });
                } else if (e.toLowerCase().endsWith('.mtl')) {
                  mtlPaths.push(full);
                }
              } catch { /* ignore */ }
            }
          }
          // If still no MTL, optionally attempt auto-texture discovery (jpg/png) near OBJ (recursive)
          if (mtlPaths.length === 0 && allowAutoTextureFallback) {
            const imgExts = ['.jpg', '.jpeg', '.png'];
            let foundImg: string | undefined;
            const seenImg = new Set<string>();
            const imgQueue: Array<{ d: string, depth: number }> = [];
            const roots = [dir, path.resolve(dir, '..')];
            for (const r of roots) if (fs.existsSync(r)) imgQueue.push({ d: r, depth: 0 });
            while (imgQueue.length && !foundImg) {
              const { d, depth } = imgQueue.shift()!;
              if (depth > 4 || seenImg.has(d)) continue;
              seenImg.add(d);
              let entries: string[] = [];
              try { entries = fs.readdirSync(d); } catch { continue; }
              for (const e of entries) {
                const full = path.join(d, e);
                try {
                  const st = fs.statSync(full);
                  if (st.isDirectory()) imgQueue.push({ d: full, depth: depth + 1 });
                  else if (imgExts.some(ext => e.toLowerCase().endsWith(ext))) { foundImg = full; break; }
                } catch { /* ignore */ }
              }
            }
            if (foundImg && fs.existsSync(foundImg)) {
              const bytes = fs.readFileSync(foundImg);
              const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
              const fileBase = path.basename(foundImg);
              const nameNoExt = fileBase.replace(/\.[^.]+$/, '');
              const ext = getTextureExtensionFromData(ab);
              map.set('AutoTexture', { map_Kd: { textureId: nameNoExt, textureExt: ext, textureData: ab } });
              logger.info('Auto-texture discovery used (no MTL found)', { image: foundImg });
              return map;
            } else {
              logger.info('Auto-texture discovery failed (no images found)', {});
            }
          }
        }
      }
    }
    logger.info('MTL discovery', { objPath, explicitMtlPath: explicitMtlPath || null, mtlPaths });
    if (mtlPaths.length === 0) return map;
    for (const mtlPath of mtlPaths) {
      logger.info('Parsing MTL', { mtlPath });
      const mtlContent = fs.readFileSync(mtlPath, 'utf8');
      const lines = mtlContent.split(/\r?\n/);
      let currentMtl = '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (line.startsWith('newmtl ')) {
          currentMtl = line.substring(7).trim();
          if (!map.has(currentMtl)) map.set(currentMtl, {});
        } else if (line.startsWith('Kd ')) {
          const parts = line.split(/\s+/);
          const r = Number(parts[1] || 0.8), g = Number(parts[2] || 0.8), b = Number(parts[3] || 0.8);
          const mat = map.get(currentMtl); if (mat) mat.kd = [r, g, b];
        } else if (line.startsWith('Ks ')) {
          const parts = line.split(/\s+/);
          const r = Number(parts[1] || 0), g = Number(parts[2] || 0), b = Number(parts[3] || 0);
          const mat = map.get(currentMtl); if (mat) mat.ks = [r, g, b];
        } else if (line.startsWith('Ns ')) {
          const parts = line.split(/\s+/);
          const s = Number(parts[1] || 0);
          const mat = map.get(currentMtl); if (mat) mat.ns = s;
        } else if (line.startsWith('d ') || line.startsWith('Tr ')) {
          const parts = line.split(/\s+/);
          const v = Number(parts[1] || 1);
          const mat = map.get(currentMtl); if (mat) mat.d = line.startsWith('Tr ') ? (1 - v) : v;
        } else if (line.startsWith('map_Kd')) {
          if (currentMtl) {
            const m = line.match(/^map_Kd\s+(.+)$/i);
            if (!m) continue;
            const rest = m[1];
            const mtlDir = path.dirname(mtlPath);
            const texPath = resolveTexturePath(mtlDir, rest, textureSearchPaths || []);
            if (!texPath || !fs.existsSync(texPath)) {
              logger.info('Texture not found', { currentMtl, raw: line, baseDir: mtlDir });
              continue;
            }
            const bytes = fs.readFileSync(texPath);
            const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const fileBase = path.basename(texPath);
            const nameNoExt = fileBase.replace(/\.[^.]+$/, '');
            const ext = getTextureExtensionFromData(ab);
            const mat = map.get(currentMtl)!; mat.map_Kd = { textureId: nameNoExt, textureExt: ext, textureData: ab };
            logger.info('Texture mapped (map_Kd)', { currentMtl, texPath, id: nameNoExt, ext });
          }
        } else if (line.startsWith('map_Ks')) {
          if (currentMtl) {
            const m = line.match(/^map_Ks\s+(.+)$/i);
            if (!m) continue;
            const rest = m[1];
            const mtlDir = path.dirname(mtlPath);
            const texPath = resolveTexturePath(mtlDir, rest, textureSearchPaths || []);
            if (!texPath || !fs.existsSync(texPath)) continue;
            const bytes = fs.readFileSync(texPath);
            const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const fileBase = path.basename(texPath);
            const nameNoExt = fileBase.replace(/\.[^.]+$/, '');
            const ext = getTextureExtensionFromData(ab);
            const mat = map.get(currentMtl)!; mat.map_Ks = { textureId: nameNoExt, textureExt: ext, textureData: ab };
            logger.info('Texture mapped (map_Ks)', { currentMtl, texPath, id: nameNoExt, ext });
          }
        } else if (line.startsWith('bump') || line.startsWith('map_Bump') || line.startsWith('map_normal')) {
          if (currentMtl) {
            const m = line.match(/^(?:bump|map_Bump|map_normal)\s+(.+)$/i);
            if (!m) continue;
            const rest = m[1];
            const mtlDir = path.dirname(mtlPath);
            const texPath = resolveTexturePath(mtlDir, rest, textureSearchPaths || []);
            if (!texPath || !fs.existsSync(texPath)) continue;
            const bytes = fs.readFileSync(texPath);
            const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const fileBase = path.basename(texPath);
            const nameNoExt = fileBase.replace(/\.[^.]+$/, '');
            const ext = getTextureExtensionFromData(ab);
            const mat = map.get(currentMtl)!; mat.map_Bump = { textureId: nameNoExt, textureExt: ext, textureData: ab };
            logger.info('Texture mapped (normal)', { currentMtl, texPath, id: nameNoExt, ext });
          }
        }
      }
    }
  } catch { /* ignore */ }
  return map;
}

/**
 * Build a USD material node with optional UV texture bound to diffuseColor.
 */
function buildUsdMaterial(
  materialPath: string,
  mat?: MtlMaterial
): UsdNode {
  const materialNode = new UsdNode(materialPath, 'Material');
  const surfaceShader = new UsdNode(`${materialPath}/PreviewSurface`, 'Shader');
  surfaceShader.setProperty('uniform token info:id', 'UsdPreviewSurface');
  // Map Ns to roughness (approx)
  const rough = mat?.ns !== undefined ? (1 - Math.min(mat.ns, 1000) / 1000).toFixed(3) : '0.5';
  surfaceShader.setProperty('float inputs:roughness', rough, 'float');
  surfaceShader.setProperty('float inputs:metallic', '0.0', 'float');
  const opacity = mat?.d !== undefined ? mat.d.toFixed(3) : '1';
  surfaceShader.setProperty('float inputs:opacity', opacity, 'float');
  surfaceShader.setProperty('token outputs:surface', '');

  if (mat?.map_Kd) {
    const stReader = new UsdNode(`${materialPath}/Primvar_st`, 'Shader');
    stReader.setProperty('uniform token info:id', 'UsdPrimvarReader_float2');
    stReader.setProperty('string inputs:varname', 'st');
    stReader.setProperty('float2 outputs:result', '');

    const uvTexture = new UsdNode(`${materialPath}/UVTexture`, 'Shader');
    uvTexture.setProperty('uniform token info:id', 'UsdUVTexture');
    uvTexture.setProperty('asset inputs:file', `@textures/Texture_${mat.map_Kd.textureId}.${mat.map_Kd.textureExt}@`);
    uvTexture.setProperty('float3 outputs:rgb', '');
    uvTexture.setProperty('float2 inputs:st.connect', `<${materialPath}/Primvar_st.outputs:result>`, 'connection');

    surfaceShader.setProperty('color3f inputs:diffuseColor.connect', `<${materialPath}/UVTexture.outputs:rgb>`, 'connection');
    materialNode.addChild(stReader);
    materialNode.addChild(uvTexture);
  } else {
    const kd = mat?.kd || [0.8, 0.8, 0.8];
    surfaceShader.setProperty('color3f inputs:diffuseColor', `(${kd[0]}, ${kd[1]}, ${kd[2]})`, 'color3f');
  }

  // Specular map/color (optional)
  if (mat?.map_Ks) {
    const uvSpec = new UsdNode(`${materialPath}/UVTexture_spec`, 'Shader');
    uvSpec.setProperty('uniform token info:id', 'UsdUVTexture');
    uvSpec.setProperty('asset inputs:file', `@textures/Texture_${mat.map_Ks.textureId}.${mat.map_Ks.textureExt}@`);
    uvSpec.setProperty('float3 outputs:rgb', '');
    uvSpec.setProperty('float2 inputs:st.connect', `<${materialPath}/Primvar_st.outputs:result>`, 'connection');
    surfaceShader.setProperty('color3f inputs:specularColor.connect', `<${materialPath}/UVTexture_spec.outputs:rgb>`, 'connection');
    materialNode.addChild(uvSpec);
  } else if (mat?.ks) {
    surfaceShader.setProperty('color3f inputs:specularColor', `(${mat.ks[0]}, ${mat.ks[1]}, ${mat.ks[2]})`, 'color3f');
  }

  // Normal map (optional)
  if (mat?.map_Bump) {
    const uvN = new UsdNode(`${materialPath}/UVTexture_normal`, 'Shader');
    uvN.setProperty('uniform token info:id', 'UsdUVTexture');
    uvN.setProperty('asset inputs:file', `@textures/Texture_${mat.map_Bump.textureId}.${mat.map_Bump.textureExt}@`);
    uvN.setProperty('float3 outputs:rgb', '');
    uvN.setProperty('float2 inputs:st.connect', `<${materialPath}/Primvar_st.outputs:result>`, 'connection');
    surfaceShader.setProperty('normal3f inputs:normal.connect', `<${materialPath}/UVTexture_normal.outputs:rgb>`, 'connection');
    materialNode.addChild(uvN);
  }

  materialNode.addChild(surfaceShader);
  materialNode.setProperty('token outputs:surface.connect', `<${materialPath}/PreviewSurface.outputs:surface>`, 'connection');
  return materialNode;
}

