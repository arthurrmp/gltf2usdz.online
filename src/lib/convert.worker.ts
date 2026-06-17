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

function dataUriToBytes(uri: string): Uint8Array<ArrayBuffer> {
  const comma = uri.indexOf(",");
  const meta = uri.slice(5, comma);
  const data = uri.slice(comma + 1);
  if (meta.includes(";base64")) {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(new TextEncoder().encode(decodeURIComponent(data)));
}

// Determinant of a 4x4 matrix's upper-left 3x3 (column-major). Negative means
// the transform mirrors (flips handedness / triangle winding).
function det3(m: ArrayLike<number>): number {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

// glTF handles mirrored (negative-determinant) instances by flipping front-face
// at render time; the USDZ converter bakes transforms but never compensates, so
// a mirrored model comes out inside-out. Detect a predominantly mirrored scene.
function isSceneMirrored(doc: Document): boolean {
  const nodes = doc.getRoot().listNodes();
  let neg = 0;
  let withMesh = 0;
  for (const n of nodes) {
    if (!n.getMesh()) continue;
    withMesh++;
    if (det3(n.getWorldMatrix()) < 0) neg++;
  }
  // Fall back to all nodes if meshes are skinned (mesh nodes carry no transform).
  if (withMesh === 0) {
    const all = nodes.filter((n) => det3(n.getWorldMatrix()) < 0).length;
    return nodes.length > 0 && all > nodes.length / 2;
  }
  return neg > withMesh / 2;
}

// Reverse triangle winding so the converter's bake of the mirror flips it back
// to correct. Topological only (safe for skinned meshes).
function flipWinding(doc: Document): void {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue; // TRIANGLES only
      const idx = prim.getIndices();
      if (idx) {
        const a = idx.getArray();
        if (!a) continue;
        for (let i = 0; i + 2 < a.length; i += 3) {
          const t = a[i + 1];
          a[i + 1] = a[i + 2];
          a[i + 2] = t;
        }
        idx.setArray(a);
      } else {
        // Non-indexed: swap the 2nd and 3rd vertex of each triangle, per attribute.
        for (const sem of prim.listSemantics()) {
          const acc = prim.getAttribute(sem);
          const arr = acc?.getArray();
          if (!acc || !arr) continue;
          const n = acc.getElementSize();
          for (let t = 0; t + 3 <= acc.getCount(); t += 3) {
            for (let k = 0; k < n; k++) {
              const i1 = (t + 1) * n + k;
              const i2 = (t + 2) * n + k;
              const tmp = arr[i1];
              arr[i1] = arr[i2];
              arr[i2] = tmp;
            }
          }
          acc.setArray(arr);
        }
      }
    }
  }
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
      // Binary GLB starts with the magic "glTF"; otherwise treat as JSON glTF.
      const isGlb =
        bytes[0] === 0x67 &&
        bytes[1] === 0x6c &&
        bytes[2] === 0x54 &&
        bytes[3] === 0x46;
      let doc;
      if (isGlb) {
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
      const suffix = animationName
        ? "_" + animationName.trim().replace(/[^\w.-]+/g, "_")
        : "";
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
