/** WebUsdFramework.Utils.FileUtils - Virtual filesystem and path manipulation functions */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if a path is a directory
 */
export function isDirectory(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

/**
 * Find all STL files in a directory (non-recursive)
 * Returns absolute paths to all .stl files
 */
export function findStlFiles(dirPath: string): string[] {
  if (!isDirectory(dirPath)) {
    return [];
  }

  try {
    const files = fs.readdirSync(dirPath);
    const stlFiles = files
      .filter(file => file.toLowerCase().endsWith('.stl'))
      .map(file => path.join(dirPath, file))
      .sort(); // Sort alphabetically for consistent ordering

    return stlFiles;
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
    return [];
  }
}

/**
 * Get basename of file without extension
 * Example: "/path/to/helmet.stl" -> "helmet"
 */
export function getBasenameWithoutExt(filePath: string): string {
  const basename = path.basename(filePath);
  return basename.replace(/\.[^/.]+$/, '');
}

/**
 * Check if path exists
 */
export function pathExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
