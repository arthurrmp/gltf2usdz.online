// Typed module boundary for the vendored WebUsdFramework converter.
//
// The app imports the converter from "webusd"; TypeScript resolves it to this
// ambient declaration (so it never type-checks the vendored source, which we
// keep unmodified), while Vite's resolve.alias maps "webusd" to the real
// implementation at build time. Mirrors how a published package + .d.ts works.
declare module "webusd" {
  export interface GltfPreprocessOptions {
    dequantize?: boolean;
    generateNormals?: boolean;
    prune?: boolean;
    dedup?: boolean;
    logBounds?: boolean;
    weld?: boolean;
    center?: boolean | "center" | "above" | "below";
    resample?: boolean;
    unlit?: boolean;
    flatten?: boolean;
    metalRough?: boolean;
    join?: boolean;
  }

  export interface GltfTransformConfig {
    debug?: boolean;
    debugOutputDir?: string;
    upAxis?: "Y" | "Z";
    metersPerUnit?: number;
    preprocess?: GltfPreprocessOptions;
  }

  export function convertGlbToUsdz(
    input: ArrayBuffer | string,
    config?: GltfTransformConfig,
    options?: { outputPath?: string; layerFormat?: "usda" | "usdc" },
  ): Promise<Blob>;
}
