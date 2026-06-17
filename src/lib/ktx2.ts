// Transcode KHR_texture_basisu (KTX2) textures to PNG so they're valid USDZ
// image payloads. Uses the Khronos Basis transcoder (WASM) to get RGBA, then
// OffscreenCanvas (available in workers) to PNG-encode.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Document } from "@gltf-transform/core";
// The Basis transcoder is Emscripten UMD glue (declares `var BASIS`), not an ES
// module - load it as text and evaluate to capture the factory.
import basisJsUrl from "./basis/basis_transcoder.js?url";
import basisWasmUrl from "./basis/basis_transcoder.wasm?url";

let modPromise: Promise<any> | null = null;
function getBasis(): Promise<any> {
  if (!modPromise) {
    modPromise = (async () => {
      const code = await (await fetch(basisJsUrl)).text();
      const factory = new Function(`${code}\nreturn BASIS;`)();
      const m = await factory({
        locateFile: (p: string) => (p.endsWith(".wasm") ? basisWasmUrl : p),
      });
      m.initializeBasis();
      return m;
    })();
  }
  return modPromise;
}

function isKtx2(bytes: Uint8Array): boolean {
  // KTX2 identifier: «KTX 20»\r\n\x1A\n
  return (
    bytes.length > 12 &&
    bytes[0] === 0xab &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x58
  );
}

async function ktx2ToPng(Module: any, bytes: Uint8Array): Promise<Uint8Array> {
  const ktx = new Module.KTX2File(bytes);
  try {
    if (!ktx.isValid()) throw new Error("invalid KTX2 file");
    if (!ktx.startTranscoding()) throw new Error("startTranscoding failed");

    const w = ktx.getWidth();
    const h = ktx.getHeight();
    const RGBA32 = Module.transcoder_texture_format.cTFRGBA32.value;
    const size = ktx.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32);
    const dst = new Uint8Array(size);
    const ok = ktx.transcodeImage(dst, 0, 0, 0, RGBA32, 0, -1, -1);
    if (!ok) throw new Error("transcodeImage failed");

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const clamped = new Uint8ClampedArray(dst.buffer, dst.byteOffset, w * h * 4);
    ctx.putImageData(new ImageData(clamped, w, h), 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    ktx.close();
    ktx.delete();
  }
}

export async function transcodeKtx2Textures(doc: Document): Promise<void> {
  const textures = doc.getRoot().listTextures();
  const ktx2Textures = textures.filter((t) => {
    const img = t.getImage();
    return t.getMimeType() === "image/ktx2" || (img != null && isKtx2(img));
  });
  if (ktx2Textures.length === 0) return;

  const Module = await getBasis();
  for (const tex of ktx2Textures) {
    const img = tex.getImage();
    if (!img) continue;
    const png = await ktx2ToPng(Module, img);
    tex.setImage(png);
    tex.setMimeType("image/png");
  }

  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === "KHR_texture_basisu") ext.dispose();
  }
}
