/** WebUsdFramework.Converters.Shared.DebugWriter - Diagnostics and intermediate USDA file emit */

import * as fs from 'fs';
import * as path from 'path';
import { Logger, LoggerFactory } from '../../utils';
import { DIRECTORY_NAMES } from '../../constants/config';
import { USD_FILE_NAMES, USD_DEFAULT_NAMES } from '../../constants/usd';
import { getTextureExtensionFromData } from './usd-packaging';
import { getTextureFileBasename } from '../gltf/extensions/processors/texture-utils';

/**
 * Debug Output Content
 */
export interface DebugOutputContent {
  usdContent: string | Generator<string>;
  geometryFiles: Map<string, ArrayBuffer>;
  textureFiles: Map<string, ArrayBuffer>;
  usdzBlob: Blob;
}

/**
 * Writes debug output to the specified directory
 */
export async function writeDebugOutput(
  debugDir: string,
  content: DebugOutputContent
): Promise<void> {
  const logger = LoggerFactory.forDebug();

  ensureDirectoryExists(debugDir);

  await writeUsdFile(debugDir, content.usdContent, logger);

  await writeTextureFiles(debugDir, content.textureFiles, logger);
  await writeUsdzFile(debugDir, content.usdzBlob, logger);
}

/**
 * Ensures a directory exists, creating it if necessary
 */
function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Writes the main USD file
 */
async function writeUsdFile(
  debugDir: string,
  usdContent: string | Generator<string>,
  logger: Logger
): Promise<void> {
  const usdPath = path.join(debugDir, USD_FILE_NAMES.MODEL);

  if (typeof usdContent === 'string') {
    fs.writeFileSync(usdPath, usdContent);
    logger.info(`Written ${usdPath}`, { fileSize: usdContent.length });
  } else {
    // Handle generator - write chunks
    const writeStream = fs.createWriteStream(usdPath);
    let totalSize = 0;

    for (const chunk of usdContent) {
      writeStream.write(chunk);
      totalSize += chunk.length;
    }

    writeStream.end();

    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    logger.info(`Written ${usdPath}`, { fileSize: totalSize });
  }
}

/**
 * Writes all texture files
 */
async function writeTextureFiles(
  debugDir: string,
  textureFiles: Map<string, ArrayBuffer>,
  logger: Logger
): Promise<void> {
  const texturesDir = path.join(debugDir, DIRECTORY_NAMES.TEXTURES);
  ensureDirectoryExists(texturesDir);

  // Dedupe by content-addressed basename so a single image referenced in
  // multiple shader roles (e.g. baseColor + emissive) is written once, not
  // once per role. The composite textureId keeps role context at the shader
  // graph level; the on-disk name must collapse back to the hash.
  const writtenPaths = new Set<string>();
  for (const [textureId, textureData] of textureFiles) {
    const textureExtension = getTextureExtensionFromData(textureData);
    const basename = getTextureFileBasename(textureId);
    const fileName = `${USD_DEFAULT_NAMES.TEXTURE_PREFIX}${basename}.${textureExtension}`;
    const texturePath = path.join(texturesDir, fileName);
    if (writtenPaths.has(texturePath)) continue;
    writtenPaths.add(texturePath);
    fs.writeFileSync(texturePath, Buffer.from(textureData));
    logger.info(`Written ${texturePath}`, { fileSize: textureData.byteLength });
  }
}

/**
 * Writes the USDZ file
 */
async function writeUsdzFile(
  debugDir: string,
  usdzBlob: Blob,
  logger: Logger
): Promise<void> {
  const usdzPath = path.join(debugDir, USD_FILE_NAMES.CONVERTED);
  const usdzBuffer = await usdzBlob.arrayBuffer();
  fs.writeFileSync(usdzPath, Buffer.from(usdzBuffer));
  logger.info(`Written ${usdzPath}`, { fileSize: usdzBuffer.byteLength });
}

