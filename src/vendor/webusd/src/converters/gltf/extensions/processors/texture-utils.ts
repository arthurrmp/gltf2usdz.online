/**
 * Shared utility functions for extension processors
 */

import { Texture, TextureInfo } from '@gltf-transform/core';
import { Transform } from '@gltf-transform/extensions';

/**
 * Generate a unique texture ID based on texture data hash and type
 * Used by all extension processors to create consistent texture identifiers
 */
export async function generateTextureId(texture: Texture, type: string): Promise<string> {
  const image = texture.getImage();
  if (!image) {
    throw new Error(`Texture has no image data`);
  }

  const buffer = image.buffer as ArrayBuffer;
  const uint8Array = new Uint8Array(buffer);
  let hash = 0;
  const step = Math.max(1, Math.floor(uint8Array.length / 1000)); // Sample every nth byte for performance

  for (let i = 0; i < uint8Array.length; i += step) {
    hash = ((hash << 5) - hash + uint8Array[i]) & 0xffffffff;
  }

  // Convert to positive hex string and take first 8 characters
  const hashStr = Math.abs(hash).toString(16).substring(0, 8);

  return `${hashStr}_${type}`;
}

/**
 * Strips the role suffix from a texture ID to produce a content-addressed
 * basename suitable for file storage.
 *
 * `generateTextureId()` returns `<hash>_<role>` (e.g. `3ef307c5_diffuse`) so
 * that shader node names stay unique within a material when one image is
 * referenced in multiple slots. That composite ID must NOT be reused as the
 * on-disk filename: the same bytes would then be written once per role,
 * bloating the USDZ archive. This helper returns just the content-addressed
 * portion.
 *
 * Uses `lastIndexOf('_')` rather than `indexOf('_')` so identifiers that
 * intentionally carry a prefix (e.g. `vc_<hash>_baked` for vertex-color
 * baked textures) keep their prefix and only lose the trailing role.
 *
 *   "3ef307c5_diffuse"   -> "3ef307c5"
 *   "3ef307c5_emissive"  -> "3ef307c5"
 *   "vc_a1b2c3d4_baked"  -> "vc_a1b2c3d4"
 *   "noSuffix"           -> "noSuffix"
 */
export function getTextureFileBasename(textureId: string): string {
  const sep = textureId.lastIndexOf('_');
  return sep > 0 ? textureId.substring(0, sep) : textureId;
}

/**
 * Extract texture transform from TextureInfo using KHR_texture_transform extension
 * Returns transform data (offset, scale, rotation) if present, undefined otherwise
 */
export function extractTextureTransform(textureInfo: TextureInfo | null): {
  offset: [number, number];
  scale: [number, number];
  rotation: number;
} | undefined {
  if (!textureInfo) {
    return undefined;
  }

  const transform = textureInfo.getExtension<Transform>('KHR_texture_transform');
  if (!transform) {
    return undefined;
  }

  const offset = transform.getOffset();
  const scale = transform.getScale();
  const rotation = transform.getRotation();

  return {
    offset: [offset[0], offset[1]],
    scale: [scale[0], scale[1]],
    rotation
  };
}

/**
 * Get the correct file extension for a texture based on its data
 */
export function getTextureExtension(texture: Texture): string {
  const image = texture.getImage();
  if (!image) {
    return 'png'; // Default fallback
  }
  const buffer = image.buffer as ArrayBuffer;
  const data = new Uint8Array(buffer);

  // Check for PNG header: 89 50 4E 47 0D 0A 1A 0A
  if (data.length > 8 &&
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47 &&
    data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A) {
    return 'png';
  }

  // Check for JPEG header: FF D8 FF
  if (data.length > 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
    return 'jpg';
  }

  // Check for WebP header: RIFF .... WEBPVP8
  if (data.length > 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && // RIFF
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50 && // WEBP
    data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38) { // VP8
    return 'webp';
  }

  // Default to PNG if no known header is found
  return 'png';
}

/**
 * Get clean image data from texture, stripping any garbage data before the header.
 * Fixes issues where external tools might prepend text/logs to the binary output.
 */
export function getCleanTextureImage(texture: Texture): Uint8Array | null {
  const image = texture.getImage();
  if (!image) return null;

  const buffer = image.buffer as ArrayBuffer;
  const data = new Uint8Array(buffer);

  // Check for PNG header: 89 50 4E 47 0D 0A 1A 0A
  // If it starts with it, return as is
  if (data.length > 8 &&
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47 &&
    data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A) {
    return data;
  }

  // Search for PNG header in the first 1024 bytes
  const searchLimit = Math.min(data.length, 1024);
  for (let i = 0; i < searchLimit - 8; i++) {
    if (data[i] === 0x89 && data[i + 1] === 0x50 && data[i + 2] === 0x4E && data[i + 3] === 0x47 &&
      data[i + 4] === 0x0D && data[i + 5] === 0x0A && data[i + 6] === 0x1A && data[i + 7] === 0x0A) {
      // Found header, return slice from here
      return data.slice(i);
    }
  }

  // Check for JPEG header: FF D8 FF
  if (data.length > 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
    return data;
  }

  // Search for JPEG header
  for (let i = 0; i < searchLimit - 3; i++) {
    if (data[i] === 0xFF && data[i + 1] === 0xD8 && data[i + 2] === 0xFF) {
      return data.slice(i);
    }
  }

  // No known header found or already clean (but not PNG/JPEG), return original
  return data;
}
