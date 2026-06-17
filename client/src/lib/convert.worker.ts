/// <reference lib="webworker" />
import "./buffer-shim";
// Browser-side GLB/GLTF -> USDZ conversion, off the main thread.
//
// Owns a WebIO with Draco + Meshopt decoders registered (the vendored
// converter's own parser registers neither), decodes the document, lets the UI
// pick which animation to keep, transcodes any KTX2/Basis textures to PNG, then
// hands a plain GLB to the vendored convertGlbToUsdz().
import { WebIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import dracoWasmUrl from "draco3dgltf/draco_decoder_gltf.wasm?url";
import { MeshoptDecoder } from "meshoptimizer";
import { convertGlbToUsdz } from "../vendor/webusd/src/converters/gltf";
import type { GltfTransformConfig } from "../vendor/webusd/src/schemas";
import { transcodeKtx2Textures } from "./ktx2";

const usdzConfig: GltfTransformConfig = {
  debug: false,
  debugOutputDir: "./debug-output",
  upAxis: "Y",
  metersPerUnit: 0.008,
  preprocess: {
    dequantize: true,
    generateNormals: true,
    prune: true,
    weld: true,
    dedup: false,
    logBounds: false,
    center: false,
    resample: false,
    unlit: false,
    flatten: false,
    metalRough: false,
    join: false,
  },
};

let ioPromise: Promise<WebIO> | null = null;
async function getIO(): Promise<WebIO> {
  if (!ioPromise) {
    ioPromise = (async () => {
      await MeshoptDecoder.ready;
      // Feed the Draco wasm bytes directly so the Emscripten glue neither
      // fs-reads nor fetches a (missing) sibling .wasm in the browser.
      const wasmBinary = await (await fetch(dracoWasmUrl)).arrayBuffer();
      return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
        "draco3d.decoder": await draco3d.createDecoderModule({ wasmBinary }),
        "meshopt.decoder": MeshoptDecoder,
      });
    })();
  }
  return ioPromise;
}

let currentDoc: Document | null = null;

type InMessage =
  | { type: "load"; buffer: ArrayBuffer; name: string }
  | { type: "convert"; keep: number | null; name: string };

self.onmessage = async (e: MessageEvent<InMessage>) => {
  try {
    if (e.data.type === "load") {
      const io = await getIO();
      const doc = await io.readBinary(new Uint8Array(e.data.buffer));
      currentDoc = doc;
      const animations = doc
        .getRoot()
        .listAnimations()
        .map((a, i) => a.getName() || `Animation ${i + 1}`);
      (self as DedicatedWorkerGlobalScope).postMessage({ type: "loaded", animations });
      return;
    }

    if (e.data.type === "convert") {
      const doc = currentDoc;
      if (!doc) throw new Error("No model loaded.");
      const io = await getIO();

      // Keep only the chosen animation (null = strip all).
      const anims = doc.getRoot().listAnimations();
      anims.forEach((a, i) => {
        if (e.data.keep === null || i !== e.data.keep) a.dispose();
      });

      // Drop geometry-compression extensions so the plain GLB re-encode does
      // not attempt to re-compress (no encoders registered).
      for (const ext of doc.getRoot().listExtensionsUsed()) {
        const n = ext.extensionName;
        if (n === "KHR_draco_mesh_compression" || n === "EXT_meshopt_compression") {
          ext.dispose();
        }
      }

      // KTX2/Basis textures aren't valid USDZ image payloads — transcode to PNG.
      await transcodeKtx2Textures(doc);

      const glb = await io.writeBinary(doc);
      const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;

      const usdz = (await convertGlbToUsdz(ab, usdzConfig)) as Blob;
      const out = await usdz.arrayBuffer();
      const base = e.data.name.replace(/\.(glb|gltf)$/i, "");
      currentDoc = null;
      (self as DedicatedWorkerGlobalScope).postMessage(
        { type: "done", usdz: out, name: `${base}.usdz` },
        [out],
      );
      return;
    }
  } catch (err) {
    currentDoc = null;
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
