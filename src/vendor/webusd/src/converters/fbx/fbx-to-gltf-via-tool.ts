/** WebUsdFramework.Converters.Fbx.FbxToGltfViaTool - FBX to GLB conversion shell delegator */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import the fbx2gltf CommonJS module
const fbx2gltfModule = require('fbx2gltf');
const fbx2gltfConvert: (srcFile: string, destFile: string, opts?: string[]) => Promise<string> =
  typeof fbx2gltfModule === 'function' ? fbx2gltfModule : fbx2gltfModule.default || fbx2gltfModule.convert;

export interface FbxToGltfOptions {
  binary?: boolean;      // Output GLB instead of GLTF
  verbose?: boolean;     // Enable verbose logging
  extraArgs?: string[];  // Extra args to pass to FBX2glTF
}

// Converts FBX file to GLB/GLTF using the FBX2glTF command-line tool
export async function convertFbxToGltfViaTool(
  fbxPath: string,
  options: FbxToGltfOptions = {}
): Promise<ArrayBuffer> {
  // Validate input file exists
  if (!fs.existsSync(fbxPath)) {
    throw new Error(`FBX file not found: ${fbxPath}`);
  }

  // Create temp directory for output
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx2gltf-'));
  const outputExt = options.binary !== false ? '.glb' : '.gltf';
  const outputPath = path.join(tmpDir, `converted${outputExt}`);

  try {
    console.log(`Converting FBX to ${outputExt.toUpperCase()} using FBX2glTF tool...`);
    console.log(`  Input:  ${fbxPath}`);
    console.log(`  Output: ${outputPath}`);

    // Build options array
    const args: string[] = options.extraArgs || [];

    if (options.verbose) {
      args.push('--verbose');
    }

    // Convert FBX to GLTF/GLB
    await fbx2gltfConvert(fbxPath, outputPath, args);

    // Read the output file
    if (!fs.existsSync(outputPath)) {
      throw new Error(`FBX2glTF conversion failed - output file not created: ${outputPath}`);
    }

    const gltfBuffer = fs.readFileSync(outputPath);
    console.log(`FBX converted successfully (${(gltfBuffer.length / 1024).toFixed(2)} KB)`);

    return gltfBuffer.buffer.slice(
      gltfBuffer.byteOffset,
      gltfBuffer.byteOffset + gltfBuffer.byteLength
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`FBX2glTF conversion failed: ${errMsg}`);
    throw new Error(`FBX to GLTF conversion failed: ${errMsg}`);
  } finally {
    // Cleanup temp directory
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.warn(`Warning: Failed to cleanup temp directory: ${tmpDir}`);
    }
  }
}

// Checks if the FBX2glTF binary exists for the current platform
export function isFbx2gltfAvailable(): boolean {
  try {
    const binExt = os.type() === 'Windows_NT' ? '.exe' : '';
    const toolPath = path.join(
      __dirname,
      '..',
      '..',
      'node_modules',
      'fbx2gltf',
      'bin',
      os.type(),
      'FBX2glTF' + binExt
    );
    return fs.existsSync(toolPath);
  } catch {
    return false;
  }
}
