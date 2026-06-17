/** WebUsdFramework.Converters.Gltf.Extensions.ExtensionFactory - Factory for instantiating GLTF extension handlers */

import { Material } from '@gltf-transform/core';
import { IExtensionProcessor, ExtensionProcessingContext, ExtensionProcessingResult } from './extension-processor';
import { PBRSpecularGlossinessProcessor } from './processors/pbr-specular-glossiness-processor';
import { PBRClearcoatProcessor } from './processors/pbr-clearcoat-processor';
import { PBRIridescenceProcessor } from './processors/pbr-iridescence-processor';
import { PBRSpecularProcessor } from './processors/pbr-specular-processor';
import { PBRDiffuseTransmissionProcessor } from './processors/pbr-diffuse-transmission-processor';
import { PBRSheenProcessor } from './processors/pbr-sheen-processor';
import { PBRTransmissionProcessor } from './processors/pbr-transmission-processor';
import { PBRVolumeProcessor } from './processors/pbr-volume-processor';
import { PBRAnisotropyProcessor } from './processors/pbr-anisotropy-processor';
import { PBREmissiveStrengthProcessor } from './processors/pbr-emissive-strength-processor';
import { PBRDispersionProcessor } from './processors/pbr-dispersion-processor';
import { PBRIORProcessor } from './processors/pbr-ior-processor';
import { PBRUnlitProcessor } from './processors/pbr-unlit-processor';

/**
 * Factory for managing extension processors
 */
export class ExtensionFactory {
  private static processors: Map<string, IExtensionProcessor> = new Map();
  private static initialized = false;

  /**
   * Register an extension processor
   */
  static register(processor: IExtensionProcessor): void {
    this.processors.set(processor.extensionName, processor);
  }

  /**
   * Get processor for a specific extension name
   */
  static getProcessor(extensionName: string): IExtensionProcessor | undefined {
    return this.processors.get(extensionName);
  }

  /**
   * Get all registered processors
   */
  static getAllProcessors(): IExtensionProcessor[] {
    return Array.from(this.processors.values());
  }

  /**
   * Find processors that can handle the given material
   */
  static findProcessorsForMaterial(material: Material): IExtensionProcessor[] {
    return this.getAllProcessors().filter(processor => processor.canProcess(material));
  }

  /**
   * Process all applicable extensions for a material
   */
  static async processMaterialExtensions(
    material: Material,
    context: ExtensionProcessingContext
  ): Promise<ExtensionProcessingResult[]> {
    // Ensure factory is initialized
    this.ensureInitialized();

    const results: ExtensionProcessingResult[] = [];
    const applicableProcessors = this.findProcessorsForMaterial(material);

    for (const processor of applicableProcessors) {
      try {
        const result = await processor.process(context);
        results.push(result);
      } catch (error) {
        results.push({
          textures: [],
          processed: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  }

  /**
   * Initialize factory with default processors
   * This should be called once at application startup
   */
  static initialize(): void {
    if (this.initialized) {
      return;
    }

    // Register all extension processors
    this.register(new PBRSpecularGlossinessProcessor());
    this.register(new PBRClearcoatProcessor());
    this.register(new PBRIridescenceProcessor());
    this.register(new PBRSpecularProcessor());
    this.register(new PBRDiffuseTransmissionProcessor());
    this.register(new PBRSheenProcessor());
    this.register(new PBRTransmissionProcessor());
    this.register(new PBRVolumeProcessor());
    this.register(new PBRAnisotropyProcessor());
    this.register(new PBREmissiveStrengthProcessor());
    this.register(new PBRDispersionProcessor());
    this.register(new PBRIORProcessor());
    this.register(new PBRUnlitProcessor());

    this.initialized = true;
  }

  /**
   * Ensure factory is initialized (lazy initialization)
   */
  private static ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }

  /**
   * Check if factory is initialized
   */
  static isInitialized(): boolean {
    return this.initialized;
  }
}

