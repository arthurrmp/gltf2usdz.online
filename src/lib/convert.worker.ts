/// <reference lib="webworker" />
import "./buffer-shim";
// Browser-side GLB/GLTF -> USDZ conversion, off the main thread.
//
// Owns a WebIO with Draco + Meshopt decoders registered (the vendored
// converter's own parser registers neither), decodes the document, reports
// model stats, lets the UI pick which animation to keep, transcodes any
// KTX2/Basis textures to PNG, then hands a plain GLB to convertGlbToUsdz().
import { WebIO, type Document, type JSONDocument } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import dracoWasmUrl from "draco3dgltf/draco_decoder_gltf.wasm?url";
import { MeshoptDecoder } from "meshoptimizer";
import { convertGlbToUsdz, type GltfTransformConfig } from "webusd";
import { transcodeKtx2Textures } from "./ktx2";
import {
  animationFilenameSuffix,
  dataUriToBytes,
  flipWinding,
  isGlb,
  isSceneMirrored,
} from "./mesh-utils";

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

const post = (msg: unknown, transfer?: Transferable[]) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
const progress = (stage: string) => post({ type: "progress", stage });

let currentDoc: Document | null = null;

// keep: a clip index to keep, null = strip all, "all" = keep every clip.
type Keep = number | null | "all";

type InMessage =
  | { type: "load"; buffer: ArrayBuffer; name: string }
  | { type: "convert"; keep: Keep; name: string; animationName?: string };

self.onmessage = async (e: MessageEvent<InMessage>) => {
  try {
    if (e.data.type === "load") {
      progress("Reading model");
      const io = await getIO();
      const bytes = new Uint8Array(e.data.buffer);
      let doc;
      if (isGlb(bytes)) {
        doc = await io.readBinary(bytes);
      } else {
        // Self-contained .gltf: decode embedded data: URIs into resources
        // (readJSON does not resolve URIs itself). A .gltf referencing
        // external files can't be read from a single upload.
        const json = JSON.parse(new TextDecoder().decode(bytes));
        const lists = [json.buffers, json.images] as ({ uri?: string }[] | undefined)[];
        const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
        for (const item of [...(lists[0] ?? []), ...(lists[1] ?? [])]) {
          if (item.uri?.startsWith("data:")) {
            resources[item.uri] = dataUriToBytes(item.uri);
          } else if (item.uri) {
            throw new Error(
              "This .gltf references external files. Please upload a .glb or a self-contained .gltf.",
            );
          }
        }
        doc = await io.readJSON({ json, resources } as JSONDocument);
      }
      currentDoc = doc;
      const animations = doc
        .getRoot()
        .listAnimations()
        .map((a, i) => a.getName() || `Animation ${i + 1}`);
      post({ type: "loaded", animations });
      return;
    }

    if (e.data.type === "convert") {
      const { keep, name, animationName } = e.data;
      const doc = currentDoc;
      if (!doc) throw new Error("No model loaded.");
      const io = await getIO();

      // keep === "all": leave every clip. Otherwise keep one (number) or none (null).
      if (keep !== "all") {
        doc
          .getRoot()
          .listAnimations()
          .forEach((a, i) => {
            if (keep === null || i !== keep) a.dispose();
          });
      }

      // Drop geometry-compression extensions so the plain GLB re-encode does
      // not attempt to re-compress (no encoders registered).
      let hadKtx2 = false;
      for (const ext of doc.getRoot().listExtensionsUsed()) {
        const n = ext.extensionName;
        if (n === "KHR_draco_mesh_compression" || n === "EXT_meshopt_compression") {
          ext.dispose();
        }
        if (n === "KHR_texture_basisu") hadKtx2 = true;
      }

      // KTX2/Basis textures aren't valid USDZ image payloads — transcode to PNG.
      if (hadKtx2) {
        progress("Transcoding textures");
        await transcodeKtx2Textures(doc);
      }

      // Mirrored models: the converter bakes the negative-determinant transform
      // but doesn't flip winding, so output comes out inside-out. Pre-flip the
      // winding here so the bake restores the correct orientation.
      if (isSceneMirrored(doc)) flipWinding(doc);

      progress("Preparing geometry");
      const glb = await io.writeBinary(doc);
      const ab = glb.buffer.slice(
        glb.byteOffset,
        glb.byteOffset + glb.byteLength,
      ) as ArrayBuffer;

      progress("Building USDZ");
      const usdz = await convertGlbToUsdz(ab, usdzConfig);
      const out = await usdz.arrayBuffer();
      const base = name.replace(/\.(glb|gltf)$/i, "");
      // Append the kept clip's name when a single animation was selected.
      const suffix = animationFilenameSuffix(animationName);
      currentDoc = null;
      post({ type: "done", usdz: out, name: `${base}${suffix}.usdz` }, [out]);
      return;
    }
  } catch (err) {
    currentDoc = null;
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
