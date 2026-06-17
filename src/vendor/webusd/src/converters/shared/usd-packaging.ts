/** WebUsdFramework.Converters.Shared.UsdPackaging - Orchestrates USDA and payloads into final USDZ archive */

import { Writable } from 'node:stream';
import {
  DEFAULT_CONFIG,
  DIRECTORY_NAMES,
  FILE_EXTENSIONS
} from '../../constants/config';
import { USD_FILE_NAMES, USD_DEFAULT_NAMES } from '../../constants/usd';
import { UsdzZipWriter } from './usdz-zip-writer';
import {
  writeUsdzToFile,
  writeUsdzToStream,
  type StreamingUsdzFile,
} from './usdz-stream-writer';
import { getTextureFileBasename } from '../gltf/extensions/processors/texture-utils';
import { encodeUsdNodeTreeToUsdc } from './usdc/usd-node-adapter';

/**
 * Selects the on-disk format for the per-layer files inside the USDZ
 * archive. The outer file is always `.usdz` regardless of this setting.
 *
 *   - `'usda'`: ASCII text layers (`model.usda`, `Geometries/geom_N.usda`).
 *               This is the historical and current default — output is
 *               byte-stable and validated end-to-end against Apple's
 *               QuickLook / `usdview` / `usdcat`.
 *   - `'usdc'`: Pixar Crate binary layers. Smaller on-disk size, especially
 *               for geometry-heavy point clouds. **Experimental** — the
 *               encoder primitives (#122) are structurally complete and
 *               tested in isolation, but the full UsdNode→USDC adapter and
 *               byte-for-byte validation against `usdcat` fixtures has not
 *               yet landed. Until that work ships, this option falls back
 *               to `'usda'`.
 */
export type LayerFormat = 'usda' | 'usdc';

/**
 * Package Configuration
 */
export interface PackageConfig {
  compression?: 'STORE' | 'DEFLATE';
  mimeType?: string;
  /**
   * On-disk format for the per-layer files. Defaults to `'usda'`. See
   * {@link LayerFormat} for the trade-offs.
   */
  layerFormat?: LayerFormat;
}

/**
 * Package Content
 */
export interface PackageContent {
  usdContent: string | Generator<string>;
  geometryFiles: Map<string, ArrayBuffer>;
  textureFiles: Map<string, ArrayBuffer>;
  /**
   * Optional source `UsdNode` for the root layer. Required to opt into
   * `layerFormat: 'usdc'` — the binary encoder needs the structured tree,
   * not the serialized USDA text. When omitted (or when the encoder reports
   * unsupported properties), the packager falls back to writing the
   * `usdContent` string as `model.usda`.
   */
  usdContentNode?: import('../../core/usd-node').UsdNode;
}

/**
 * Try to build a binary USDC root layer from `content.usdContentNode`.
 *
 * Returns the encoded bytes when the adapter handled every property in the
 * tree, or `null` when:
 *   - `usdContentNode` was not supplied (caller didn't opt in), or
 *   - the adapter encountered a property it doesn't yet support (in which
 *     case the bytes would silently differ from the USDA source).
 *
 * In either case the packager falls back to writing USDA text. The fallback
 * is intentional and safe — it's how `layerFormat: 'usdc'` ships before the
 * adapter learns every USDA shape.
 */
function tryBuildUsdcRootLayer(content: PackageContent): Uint8Array | null {
  if (!content.usdContentNode) return null;
  const result = encodeUsdNodeTreeToUsdc(content.usdContentNode);
  if (result.report.skipped > 0) return null;
  return result.bytes;
}

/**
 * Build the ordered list of files (USD root layer first, then geometry layers,
 * then deduped textures) that make up a USDZ archive for the given content.
 *
 * Used by both the buffered (`createUsdzPackage`) and streaming
 * (`createUsdzPackageToStream` / `createUsdzPackageToFile`) packagers so the
 * file ordering and dedup rules cannot drift between the two paths.
 *
 * `config?.layerFormat`:
 *   - `'usda'` (default): write `model.usda` as text.
 *   - `'usdc'`: try `tryBuildUsdcRootLayer`; if it succeeds, write
 *     `model.usdc`. Otherwise fall back to USDA.
 *
 * NOTE: if `content.usdContent` is a `Generator<string>` it will be exhausted
 * in this call. Generators are single-use; callers that need to re-package the
 * same content should pass a string or a fresh generator on each call.
 */
function buildPackageFiles(
  content: PackageContent,
  config?: PackageConfig
): StreamingUsdzFile[] {
  const files: StreamingUsdzFile[] = [];

  // Main USD file — try binary first when requested, fall back to text.
  if (config?.layerFormat === 'usdc') {
    const usdcBytes = tryBuildUsdcRootLayer(content);
    if (usdcBytes) {
      const usdcName = USD_FILE_NAMES.MODEL.replace(/\.usda$/, '.usdc');
      files.push({ name: usdcName, data: usdcBytes });
      // Fall through into the geometry/texture loop below.
      for (const [geometryPath, geometryData] of content.geometryFiles) {
        files.push({ name: geometryPath, data: new Uint8Array(geometryData) });
      }
      const writtenTexturePaths = new Set<string>();
      for (const [textureId, textureData] of content.textureFiles) {
        const textureExtension = getTextureExtensionFromData(textureData);
        const basename = getTextureFileBasename(textureId);
        const textureName = `${USD_DEFAULT_NAMES.TEXTURE_PREFIX}${basename}.${textureExtension}`;
        const texturePath = `${DIRECTORY_NAMES.TEXTURES}/${textureName}`;
        if (writtenTexturePaths.has(texturePath)) continue;
        writtenTexturePaths.add(texturePath);
        files.push({ name: texturePath, data: new Uint8Array(textureData) });
      }
      return files;
    }
    // Fell through — emit USDA below.
  }

  let usdContentChunks: Uint8Array[];
  if (typeof content.usdContent === 'string') {
    usdContentChunks = [new TextEncoder().encode(content.usdContent)];
  } else {
    usdContentChunks = [];
    const encoder = new TextEncoder();
    for (const chunk of content.usdContent) {
      usdContentChunks.push(encoder.encode(chunk));
    }
  }
  files.push({ name: USD_FILE_NAMES.MODEL, data: usdContentChunks });

  // Geometry layer files
  for (const [geometryPath, geometryData] of content.geometryFiles) {
    files.push({ name: geometryPath, data: new Uint8Array(geometryData) });
  }

  // Texture files — dedupe by content-addressed basename. One image
  // referenced in multiple shader roles (e.g. baseColor + emissive) arrives
  // here under multiple composite IDs ("<hash>_diffuse", "<hash>_emissive")
  // but shares the same bytes; write only one archive entry per basename.
  const writtenTexturePaths = new Set<string>();
  for (const [textureId, textureData] of content.textureFiles) {
    const textureExtension = getTextureExtensionFromData(textureData);
    const basename = getTextureFileBasename(textureId);
    const textureName = `${USD_DEFAULT_NAMES.TEXTURE_PREFIX}${basename}.${textureExtension}`;
    const texturePath = `${DIRECTORY_NAMES.TEXTURES}/${textureName}`;
    if (writtenTexturePaths.has(texturePath)) continue;
    writtenTexturePaths.add(texturePath);
    files.push({ name: texturePath, data: new Uint8Array(textureData) });
  }

  return files;
}

/**
 * Creates a USDZ package using custom ZIP writer for proper file alignment.
 *
 * Buffered path: holds the complete archive bytes in memory and returns a
 * `Blob`. Use `createUsdzPackageToStream` / `createUsdzPackageToFile` for
 * memory-bounded streaming output.
 */
export async function createUsdzPackage(
  content: PackageContent,
  config?: PackageConfig
): Promise<Blob> {
  const files = buildPackageFiles(content, config);

  // Create ZIP writer with proper alignment for optimal performance
  const zipWriter = new UsdzZipWriter({
    alignTo64Bytes: true,
    compressionLevel: 0 // Store files without compression
  });

  for (const file of files) {
    zipWriter.addFile(file.name, file.data);
  }

  // Generate the USDZ package
  const usdzBuffer = zipWriter.generate();

  // Create and return USDZ blob
  return createUsdzBlob(usdzBuffer, config?.mimeType);
}

/**
 * Result of a streaming USDZ package operation.
 */
export interface UsdzStreamResult {
  /** Total bytes written to the output. */
  totalBytes: number;
  /** Number of files included in the archive (root USD + geometry + dedup'd textures). */
  fileCount: number;
}

export interface UsdzStreamOptions {
  /**
   * 64-byte-align file data inside the archive, matching Apple's USDZ profile
   * requirement. Defaults to `true`. Disable only for diagnostic purposes.
   */
  alignTo64Bytes?: boolean;
  /**
   * On-disk format for the per-layer files. Same semantics as
   * `PackageConfig.layerFormat` — defaults to `'usda'`.
   */
  layerFormat?: LayerFormat;
}

/**
 * Options for opting a per-format converter (`convertGlbToUsdz`,
 * `convertPlyToUsdz`, `convertObjToUsdz`, `convertStlToUsdz`) and
 * `WebUsdFramework.convert` into the streaming output path.
 */
export interface ConvertOptions {
  /**
   * When set, stream the USDZ archive directly to this file path via
   * `createUsdzPackageToFile`. The converter returns `UsdzStreamResult`
   * (`{ totalBytes, fileCount }`) instead of a `Blob`.
   *
   * Memory peak is bounded by the largest single file inside the archive
   * (the buffered path peaks at the full archive size). For dense point-
   * cloud archives this is an order-of-magnitude reduction.
   *
   * NOTE: when this option is used together with `debug: true`, the
   * debug-blob portion of the debug output (the full `.usdz` written
   * alongside the unpacked artifacts) is skipped. The other debug
   * artifacts (USDA, geometry, textures) still emit. To get the full
   * debug bundle including the archive blob, omit `outputPath`.
   */
  outputPath?: string;
  /**
   * On-disk format for the per-layer files inside the USDZ archive. The
   * outer file is always `.usdz` regardless of this setting. Defaults to
   * `'usda'`. See {@link LayerFormat} for the trade-offs and the safety
   * net (the packager falls back to `'usda'` if any property in the source
   * tree cannot be encoded).
   */
  layerFormat?: LayerFormat;
}

/**
 * Stream a USDZ package to any Node `Writable`.
 *
 * Memory peak is bounded by the largest single file in the archive, not the
 * total archive size. Output bytes are byte-for-byte identical to
 * `createUsdzPackage` for the same input.
 *
 * The function does NOT call `end()` on the stream; the caller owns its
 * lifecycle. Use `createUsdzPackageToFile` for the common write-to-disk case.
 */
export async function createUsdzPackageToStream(
  content: PackageContent,
  output: Writable,
  options: UsdzStreamOptions = {}
): Promise<UsdzStreamResult> {
  const files = buildPackageFiles(
    content,
    options.layerFormat ? { layerFormat: options.layerFormat } : undefined
  );
  return writeUsdzToStream(files, output, {
    alignTo64Bytes: options.alignTo64Bytes ?? true,
  });
}

/**
 * Stream a USDZ package to disk at `filePath`.
 *
 * Convenience wrapper around `createUsdzPackageToStream` that opens an
 * `fs.createWriteStream`, pipes the archive into it, and closes the stream
 * cleanly on success. On error the stream is destroyed and the partial file
 * is left for the caller to inspect or remove.
 */
export async function createUsdzPackageToFile(
  content: PackageContent,
  filePath: string,
  options: UsdzStreamOptions = {}
): Promise<UsdzStreamResult> {
  const files = buildPackageFiles(
    content,
    options.layerFormat ? { layerFormat: options.layerFormat } : undefined
  );
  return writeUsdzToFile(files, filePath, {
    alignTo64Bytes: options.alignTo64Bytes ?? true,
  });
}

/**
 * Get the correct file extension for a texture based on its data
 */
export function getTextureExtensionFromData(textureData: ArrayBuffer): string {
  const uint8Array = new Uint8Array(textureData);

  // Check for JPEG magic bytes (FF D8 FF)
  if (uint8Array.length >= 3 &&
    uint8Array[0] === 0xFF &&
    uint8Array[1] === 0xD8 &&
    uint8Array[2] === 0xFF) {
    return 'jpg';
  }

  // Check for PNG magic bytes (89 50 4E 47)
  if (uint8Array.length >= 8 &&
    uint8Array[0] === 0x89 &&
    uint8Array[1] === 0x50 &&
    uint8Array[2] === 0x4E &&
    uint8Array[3] === 0x47) {
    return 'png';
  }

  // Check for WebP header: RIFF .... WEBP
  if (uint8Array.length >= 12 &&
    uint8Array[0] === 0x52 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46 && uint8Array[3] === 0x46 && // RIFF
    uint8Array[8] === 0x57 && uint8Array[9] === 0x45 && uint8Array[10] === 0x42 && uint8Array[11] === 0x50) { // WEBP
    return 'webp';
  }

  // Default to PNG if format cannot be determined
  return 'png';
}

/**
 * Creates USDZ blob from ZIP buffer
 */
function createUsdzBlob(
  uint8Array: Uint8Array,
  mimeType?: string
): Blob {
  return new Blob([uint8Array.buffer as ArrayBuffer], {
    type: mimeType || DEFAULT_CONFIG.MIME_TYPE
  });
}

/**
 * Builds geometry file path
 */
export function buildGeometryPath(geometryName: string): string {
  return `${DIRECTORY_NAMES.GEOMETRIES}/${geometryName}${FILE_EXTENSIONS.USDA}`;
}

/**
 * Builds geometry file name
 */
export function buildGeometryName(counter: number): string {
  return `${USD_DEFAULT_NAMES.GEOMETRY_PREFIX}${counter}`;
}

