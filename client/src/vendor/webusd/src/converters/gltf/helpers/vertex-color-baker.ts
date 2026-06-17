/** WebUsdFramework.Converters.Gltf.Helpers.VertexColorBaker - PBR base color pre-multiplication routine */

import { Primitive } from '@gltf-transform/core';

/**
 * Options for vertex color baking
 */
export interface VertexColorBakeOptions {
  /** Texture resolution (width and height). Default: 2048 */
  resolution?: number;
  /** Whether to use high quality filtering. Default: true */
  highQuality?: boolean;
}

/**
 * Result of vertex color baking
 */
export interface VertexColorBakeResult {
  /** Texture data as PNG ArrayBuffer */
  textureData: ArrayBuffer;
  /** Unique texture ID for this baked texture */
  textureId: string;
  /** Texture extension (always 'png' for baked textures) */
  extension: string;
}

/**
 * Bakes vertex colors from a GLTF primitive to a texture
 * Uses UV coordinates to map vertex colors to texture pixels
 * 
 * @param primitive - GLTF primitive with vertex colors and UVs
 * @param options - Baking options
 * @returns Baked texture data and metadata
 */
export async function bakeVertexColorsToTexture(
  primitive: Primitive,
  options: VertexColorBakeOptions = {}
): Promise<VertexColorBakeResult> {
  const {
    resolution = 2048,
    highQuality = true
  } = options;

  // Get vertex colors
  const colorAttr = primitive.getAttribute('COLOR_0');
  if (!colorAttr) {
    throw new Error('Primitive has no COLOR_0 attribute');
  }

  // Get UV coordinates
  const uvAttr = primitive.getAttribute('TEXCOORD_0');
  if (!uvAttr) {
    throw new Error('Primitive has no TEXCOORD_0 attribute for texture baking');
  }

  // Get positions to determine vertex count
  const positionAttr = primitive.getAttribute('POSITION');
  if (!positionAttr) {
    throw new Error('Primitive has no POSITION attribute');
  }

  // Get indices for proper face mapping
  const indices = primitive.getIndices();

  // Extract arrays
  const colorArray = colorAttr.getArray();
  const uvArray = uvAttr.getArray();
  const positionArray = positionAttr.getArray();
  const indexArray = indices ? indices.getArray() : null;

  if (!colorArray || colorArray.length === 0) {
    throw new Error('Color array is empty');
  }

  if (!uvArray || uvArray.length === 0) {
    throw new Error('UV array is empty');
  }

  if (!positionArray || positionArray.length === 0) {
    throw new Error('Position array is empty');
  }

  // Determine component count (3 for RGB, 4 for RGBA)
  const vertexCount = positionArray.length / 3;
  const componentCount = colorArray.length / vertexCount;

  // Create texture using Canvas API
  // For Node.js, we'll use a lightweight approach with ImageData
  // This works without requiring the 'canvas' package by using a polyfill or native Canvas
  const textureData = await createTextureFromVertexColors(
    colorArray,
    uvArray,
    indexArray,
    vertexCount,
    componentCount,
    resolution,
    highQuality
  );

  // Generate unique texture ID based on vertex color data hash
  const textureId = generateVertexColorTextureId(colorArray, uvArray);

  return {
    textureData,
    textureId,
    extension: 'png'
  };
}

/**
 * Creates a texture from vertex colors using UV mapping
 */
async function createTextureFromVertexColors(
  colorArray: ArrayLike<number>,
  uvArray: ArrayLike<number>,
  indexArray: ArrayLike<number> | null,
  vertexCount: number,
  componentCount: number,
  resolution: number,
  highQuality: boolean
): Promise<ArrayBuffer> {
  // Create a canvas-like structure for texture generation
  // We'll use a simple approach: create ImageData and convert to PNG
  const width = resolution;
  const height = resolution;

  // Create RGBA buffer (4 bytes per pixel)
  const imageData = new Uint8ClampedArray(width * height * 4);

  // Create accumulation buffers for averaging overlapping triangles
  const colorAccum = new Float32Array(width * height * 4); // R, G, B, count
  const pixelCount = new Uint32Array(width * height); // Count of triangles contributing to each pixel

  // Calculate average vertex color for background (better than pure white)
  let avgR = 0, avgG = 0, avgB = 0;
  for (let i = 0; i < colorArray.length; i += componentCount) {
    avgR += colorArray[i];
    avgG += colorArray[i + 1];
    avgB += colorArray[i + 2];
  }
  const colorCount = colorArray.length / componentCount;
  avgR = avgR / colorCount;
  avgG = avgG / colorCount;
  avgB = avgB / colorCount;

  // Initialize with average vertex color background (better fallback for unmapped areas)
  const bgR = Math.round(avgR * 255);
  const bgG = Math.round(avgG * 255);
  const bgB = Math.round(avgB * 255);
  for (let i = 0; i < imageData.length; i += 4) {
    imageData[i] = bgR;     // R
    imageData[i + 1] = bgG; // G
    imageData[i + 2] = bgB; // B
    imageData[i + 3] = 255; // A
  }

  // Check if UVs are already normalized (typically in [0,1] range for GLTF)
  // Only normalize if they're outside this range to avoid distortion
  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;

  for (let i = 0; i < uvArray.length; i += 2) {
    const u = uvArray[i];
    const v = uvArray[i + 1];
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  // Check if UVs are already in [0,1] range (typical for GLTF)
  // If they are, don't normalize to avoid distortion
  const needsNormalization = minU < 0 || maxU > 1 || minV < 0 || maxV > 1;
  const uRange = maxU - minU;
  const vRange = maxV - minV;

  // Map vertex colors to texture using UV coordinates
  // For each triangle, interpolate colors across the face
  const faceCount = indexArray
    ? indexArray.length / 3
    : vertexCount / 3;

  for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
    let v0Idx: number, v1Idx: number, v2Idx: number;

    if (indexArray) {
      v0Idx = indexArray[faceIdx * 3];
      v1Idx = indexArray[faceIdx * 3 + 1];
      v2Idx = indexArray[faceIdx * 3 + 2];
    } else {
      v0Idx = faceIdx * 3;
      v1Idx = faceIdx * 3 + 1;
      v2Idx = faceIdx * 3 + 2;
    }

    // Get raw UV coordinates for this triangle
    const rawUv0 = { u: uvArray[v0Idx * 2], v: uvArray[v0Idx * 2 + 1] };
    const rawUv1 = { u: uvArray[v1Idx * 2], v: uvArray[v1Idx * 2 + 1] };
    const rawUv2 = { u: uvArray[v2Idx * 2], v: uvArray[v2Idx * 2 + 1] };

    // Normalize UV coordinates only if needed (matching mesh normalization)
    let normalizedU0: number, normalizedV0: number;
    let normalizedU1: number, normalizedV1: number;
    let normalizedU2: number, normalizedV2: number;

    if (needsNormalization) {
      normalizedU0 = uRange > 0 ? (rawUv0.u - minU) / uRange : 0;
      normalizedV0 = vRange > 0 ? (rawUv0.v - minV) / vRange : 0;
      normalizedU1 = uRange > 0 ? (rawUv1.u - minU) / uRange : 0;
      normalizedV1 = vRange > 0 ? (rawUv1.v - minV) / vRange : 0;
      normalizedU2 = uRange > 0 ? (rawUv2.u - minU) / uRange : 0;
      normalizedV2 = vRange > 0 ? (rawUv2.v - minV) / vRange : 0;
    } else {
      // UVs are already in [0,1] range, use them directly
      normalizedU0 = rawUv0.u;
      normalizedV0 = rawUv0.v;
      normalizedU1 = rawUv1.u;
      normalizedV1 = rawUv1.v;
      normalizedU2 = rawUv2.u;
      normalizedV2 = rawUv2.v;
    }

    // Flip V-axis to match USD texture coordinate convention (same as mesh)
    const uv0 = { u: normalizedU0, v: 1.0 - normalizedV0 };
    const uv1 = { u: normalizedU1, v: 1.0 - normalizedV1 };
    const uv2 = { u: normalizedU2, v: 1.0 - normalizedV2 };

    // Get vertex colors for this triangle (keep in [0,1] range for precision)
    const color0 = {
      r: colorArray[v0Idx * componentCount],
      g: colorArray[v0Idx * componentCount + 1],
      b: colorArray[v0Idx * componentCount + 2]
    };
    const color1 = {
      r: colorArray[v1Idx * componentCount],
      g: colorArray[v1Idx * componentCount + 1],
      b: colorArray[v1Idx * componentCount + 2]
    };
    const color2 = {
      r: colorArray[v2Idx * componentCount],
      g: colorArray[v2Idx * componentCount + 1],
      b: colorArray[v2Idx * componentCount + 2]
    };

    // Always use smooth interpolation (barycentric) to match GLB viewer behavior
    // Even when vertices have the same color, smooth interpolation ensures seamless
    // color transitions at edges and eliminates visible seams like the brown line on the stomach
    rasterizeTriangle(
      imageData,
      colorAccum,
      pixelCount,
      width,
      height,
      uv0, uv1, uv2,
      color0, color1, color2,
      highQuality
    );
  }

  // Average accumulated colors for pixels with multiple contributions
  // Convert from [0,1] range to [0,255] range only at the end for maximum precision
  // IMPORTANT: USD image reader flips images bottom-to-top, so we need to flip the final image
  // to compensate. This ensures the baked texture matches the flipped mesh UVs.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const count = pixelCount[idx];

      // Flip Y coordinate because USD image reader flips images bottom-to-top
      // This ensures the baked texture matches the flipped mesh UVs
      const flippedY = height - 1 - y;
      const imageIdx = (flippedY * width + x) * 4;

      if (count > 0) {
        const accumIdx = idx * 4;
        // Average the accumulated colors (still in [0,1] range)
        const avgR = colorAccum[accumIdx] / count;
        const avgG = colorAccum[accumIdx + 1] / count;
        const avgB = colorAccum[accumIdx + 2] / count;

        // Convert to [0,255] range only when writing to image data
        imageData[imageIdx] = Math.max(0, Math.min(255, Math.round(avgR * 255)));
        imageData[imageIdx + 1] = Math.max(0, Math.min(255, Math.round(avgG * 255)));
        imageData[imageIdx + 2] = Math.max(0, Math.min(255, Math.round(avgB * 255)));
        imageData[imageIdx + 3] = 255; // Alpha
      }
      // If count is 0, pixel keeps the average background color (already set in initialization)
    }
  }

  // Fill gaps using nearest-neighbor interpolation to eliminate white lines
  // This ensures all pixels have valid colors, even if they weren't directly mapped
  fillGapsWithNearestNeighbor(imageData, pixelCount, width, height);

  // Apply slight blur to smooth out UV seams and eliminate brown lines
  // This helps blend colors at seams where the same geometric edge has different UV coordinates
  applySeamSmoothing(imageData, pixelCount, width, height);

  // Convert ImageData to PNG
  return await imageDataToPng(imageData, width, height);
}

/**
 * Rasterizes a triangle to the texture using barycentric coordinates
 * Always uses smooth interpolation to match GLB viewer behavior
 */
function rasterizeTriangle(
  _imageData: Uint8ClampedArray,
  colorAccum: Float32Array,
  pixelCount: Uint32Array,
  width: number,
  height: number,
  uv0: { u: number; v: number },
  uv1: { u: number; v: number },
  uv2: { u: number; v: number },
  color0: { r: number; g: number; b: number },
  color1: { r: number; g: number; b: number },
  color2: { r: number; g: number; b: number },
  _highQuality: boolean
): void {
  // Convert UV coordinates to pixel coordinates
  // UV coordinates are already normalized to [0,1] and V is already flipped
  const x0 = Math.floor(uv0.u * width);
  const y0 = Math.floor(uv0.v * height);
  const x1 = Math.floor(uv1.u * width);
  const y1 = Math.floor(uv1.v * height);
  const x2 = Math.floor(uv2.u * width);
  const y2 = Math.floor(uv2.v * height);

  // Find bounding box
  const minX = Math.max(0, Math.min(x0, x1, x2));
  const maxX = Math.min(width - 1, Math.max(x0, x1, x2));
  const minY = Math.max(0, Math.min(y0, y1, y2));
  const maxY = Math.min(height - 1, Math.max(y0, y1, y2));

  // Rasterize triangle with sub-pixel precision for better color accuracy
  // Use pixel centers instead of corners to match how textures are sampled
  // Note: We're using flipped UVs (1.0 - v) from the baking process, so y=0 is bottom
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // Use pixel center for more accurate UV sampling (matches texture filtering)
      // Convert pixel coordinates to UV space (y=0 is bottom because UVs are flipped)
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;

      // Calculate barycentric coordinates in UV space
      // Using the standard formula: w0, w1, w2 are weights for vertices 0, 1, 2
      // Formula: area of sub-triangles / area of main triangle
      const denom = (uv1.v - uv2.v) * (uv0.u - uv2.u) + (uv2.u - uv1.u) * (uv0.v - uv2.v);
      if (Math.abs(denom) < 1e-10) continue; // Degenerate triangle

      // Calculate areas of sub-triangles (P, v1, v2), (v0, P, v2), (v0, v1, P)
      // w0 = area(P, v1, v2) / area(v0, v1, v2)
      // w1 = area(v0, P, v2) / area(v0, v1, v2)
      // w2 = area(v0, v1, P) / area(v0, v1, v2)
      const w0 = ((uv1.v - uv2.v) * (u - uv2.u) + (uv2.u - uv1.u) * (v - uv2.v)) / denom;
      const w1 = ((uv2.v - uv0.v) * (u - uv2.u) + (uv0.u - uv2.u) * (v - uv2.v)) / denom;
      const w2 = 1.0 - w0 - w1;

      // Check if point is inside triangle (with larger epsilon to fill gaps)
      // Use a larger epsilon to ensure edge pixels are included and gaps are filled
      const epsilon = -0.001; // Larger negative value to include edge pixels and fill gaps
      if (w0 >= epsilon && w1 >= epsilon && w2 >= epsilon) {
        // Clamp weights to [0,1] for numerical stability
        const clampedW0 = Math.max(0, Math.min(1, w0));
        const clampedW1 = Math.max(0, Math.min(1, w1));
        const clampedW2 = Math.max(0, Math.min(1, w2));
        const sum = clampedW0 + clampedW1 + clampedW2;
        const normW0 = sum > 0 ? clampedW0 / sum : 1 / 3;
        const normW1 = sum > 0 ? clampedW1 / sum : 1 / 3;
        const normW2 = sum > 0 ? clampedW2 / sum : 1 / 3;

        // Interpolate color using normalized barycentric coordinates
        const r = normW0 * color0.r + normW1 * color1.r + normW2 * color2.r;
        const g = normW0 * color0.g + normW1 * color1.g + normW2 * color2.g;
        const b = normW0 * color0.b + normW1 * color1.b + normW2 * color2.b;

        // Accumulate color for averaging (handles overlapping triangles)
        const idx = y * width + x;
        const accumIdx = idx * 4;
        colorAccum[accumIdx] += r;
        colorAccum[accumIdx + 1] += g;
        colorAccum[accumIdx + 2] += b;
        pixelCount[idx]++;
      }
    }
  }
}

/**
 * Fills gaps in the texture using nearest-neighbor interpolation
 * This eliminates white lines caused by unmapped pixels
 */
function fillGapsWithNearestNeighbor(
  imageData: Uint8ClampedArray,
  pixelCount: Uint32Array,
  width: number,
  height: number
): void {
  // First pass: identify pixels that need filling (count === 0)
  const needsFilling: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (pixelCount[idx] === 0) {
        needsFilling.push({ x, y });
      }
    }
  }

  // Second pass: fill gaps with nearest mapped pixel using improved algorithm
  // This handles UV seams better by averaging nearby colors instead of just taking the nearest
  const searchRadius = 5; // Increased radius for better seam handling
  for (const { x, y } of needsFilling) {
    let colorSumR = 0, colorSumG = 0, colorSumB = 0;
    let colorCount = 0;
    let minDist = Infinity;

    // Search in expanding radius and collect nearby colors
    for (let radius = 1; radius <= searchRadius; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;

          // Check bounds
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          // Check if this pixel is mapped
          const nIdx = ny * width + nx;
          if (pixelCount[nIdx] > 0) {
            const dist = dx * dx + dy * dy;
            minDist = Math.min(minDist, dist);

            // Collect colors from nearby mapped pixels (weighted by distance)
            // This helps smooth out seams by averaging colors from multiple triangles
            const flippedNy = height - 1 - ny;
            const imageIdx = (flippedNy * width + nx) * 4;
            const weight = 1.0 / (1.0 + dist); // Closer pixels have more weight
            colorSumR += imageData[imageIdx] * weight;
            colorSumG += imageData[imageIdx + 1] * weight;
            colorSumB += imageData[imageIdx + 2] * weight;
            colorCount += weight;
          }
        }
      }

      // If we found colors in this radius, use them (don't search further)
      if (colorCount > 0) break;
    }

    // Fill the gap with averaged color (smooths out seams)
    if (colorCount > 0) {
      const flippedY = height - 1 - y;
      const imageIdx = (flippedY * width + x) * 4;
      imageData[imageIdx] = Math.round(colorSumR / colorCount);
      imageData[imageIdx + 1] = Math.round(colorSumG / colorCount);
      imageData[imageIdx + 2] = Math.round(colorSumB / colorCount);
      imageData[imageIdx + 3] = 255; // Alpha
    }
  }
}

/**
 * Applies slight smoothing to texture to eliminate seams and brown lines
 * This helps blend colors at UV seams where the same geometric edge has different UV coordinates
 */
function applySeamSmoothing(
  imageData: Uint8ClampedArray,
  pixelCount: Uint32Array,
  width: number,
  height: number
): void {
  // Create a temporary buffer for smoothed data
  const smoothed = new Uint8ClampedArray(imageData.length);
  smoothed.set(imageData);

  // Apply a simple box blur (3x3 kernel) only to pixels that were directly mapped
  // This smooths out seams without affecting the overall texture quality
  const kernelSize = 3;
  const halfKernel = Math.floor(kernelSize / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // Only smooth pixels that were directly mapped (not gap-filled)
      // This preserves the original colors while smoothing seams
      if (pixelCount[idx] > 0) {
        let sumR = 0, sumG = 0, sumB = 0;
        let count = 0;

        // Sample neighboring pixels
        for (let dy = -halfKernel; dy <= halfKernel; dy++) {
          for (let dx = -halfKernel; dx <= halfKernel; dx++) {
            const nx = x + dx;
            const ny = y + dy;

            // Check bounds
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = ny * width + nx;
              // Only average with other directly mapped pixels
              if (pixelCount[nIdx] > 0) {
                const flippedNy = height - 1 - ny;
                const imageIdx = (flippedNy * width + nx) * 4;
                sumR += imageData[imageIdx];
                sumG += imageData[imageIdx + 1];
                sumB += imageData[imageIdx + 2];
                count++;
              }
            }
          }
        }

        // Apply smoothed color (weighted: 70% original, 30% smoothed)
        // This preserves detail while smoothing seams
        if (count > 0) {
          const flippedY = height - 1 - y;
          const imageIdx = (flippedY * width + x) * 4;
          const avgR = sumR / count;
          const avgG = sumG / count;
          const avgB = sumB / count;

          smoothed[imageIdx] = Math.round(imageData[imageIdx] * 0.7 + avgR * 0.3);
          smoothed[imageIdx + 1] = Math.round(imageData[imageIdx + 1] * 0.7 + avgG * 0.3);
          smoothed[imageIdx + 2] = Math.round(imageData[imageIdx + 2] * 0.7 + avgB * 0.3);
        }
      }
    }
  }

  // Copy smoothed data back
  imageData.set(smoothed);
}

/**
 * Converts ImageData to PNG format
 * Tries multiple PNG encoding methods for maximum compatibility
 */
async function imageDataToPng(
  imageData: Uint8ClampedArray,
  width: number,
  height: number
): Promise<ArrayBuffer> {
  // Try Canvas API first (Node.js with 'canvas' package)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(imageData);
    ctx.putImageData(imgData, 0, 0);
    const buffer = canvas.toBuffer('image/png');
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  } catch (error: unknown) {
    // Try sharp library (popular and fast)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sharp = require('sharp');
      const sharpInstance = sharp.default || sharp;
      const buffer = await sharpInstance(imageData, {
        raw: {
          width,
          height,
          channels: 4
        }
      })
        .png()
        .toBuffer();
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    } catch (error2: unknown) {
      // Try pngjs (pure JavaScript, no native dependencies)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { PNG } = require('pngjs');
        const png = new PNG({ width, height });
        // Copy imageData to PNG buffer
        for (let i = 0; i < imageData.length; i++) {
          png.data[i] = imageData[i];
        }
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          png.on('data', (chunk: Buffer) => chunks.push(chunk));
          png.on('end', () => {
            const buffer = Buffer.concat(chunks);
            resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
          });
          png.on('error', reject);
          PNG.pack(png);
        });
      } catch (error3: unknown) {
        // Final fallback: throw helpful error
        const errorMsg = error instanceof Error ? error.message : String(error);
        const error2Msg = error2 instanceof Error ? error2.message : String(error2);
        const error3Msg = error3 instanceof Error ? error3.message : String(error3);
        throw new Error(
          'No PNG encoder available. Please install one of:\n' +
          '  - npm install canvas (recommended)\n' +
          '  - npm install sharp (fast, popular)\n' +
          '  - npm install pngjs (pure JS, no native deps)\n' +
          `Errors: ${errorMsg}, ${error2Msg}, ${error3Msg}`
        );
      }
    }
  }
}

/**
 * Generates a unique texture ID based on vertex color and UV data
 */
function generateVertexColorTextureId(
  colorArray: ArrayLike<number>,
  uvArray: ArrayLike<number>
): string {
  // Create hash from color and UV data
  let hash = 0;
  const sampleSize = Math.min(1000, colorArray.length);
  const step = Math.max(1, Math.floor(colorArray.length / sampleSize));

  for (let i = 0; i < colorArray.length; i += step) {
    hash = ((hash << 5) - hash + Math.round(colorArray[i] * 1000)) & 0xffffffff;
  }

  for (let i = 0; i < uvArray.length; i += step) {
    hash = ((hash << 5) - hash + Math.round(uvArray[i] * 1000)) & 0xffffffff;
  }

  const hashStr = Math.abs(hash).toString(16).substring(0, 8);
  return `vc_${hashStr}_baked`;
}

