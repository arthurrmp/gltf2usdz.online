import { test, expect } from "bun:test";
import { Document, WebIO } from "@gltf-transform/core";
import { convertGlbToUsdz } from "../vendor/webusd/src/converters/gltf";

const config = {
  debug: false,
  debugOutputDir: "./debug-output",
  upAxis: "Y" as const,
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

// Minimal single-triangle GLB, in memory.
async function tinyGlb(): Promise<ArrayBuffer> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buf);
  const idx = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint32Array([0, 1, 2]))
    .setBuffer(buf);
  const mat = doc.createMaterial("M").setBaseColorFactor([0.6, 0.9, 0.2, 1]);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", pos)
    .setIndices(idx)
    .setMaterial(mat);
  const mesh = doc.createMesh("Tri").addPrimitive(prim);
  const node = doc.createNode("N").setMesh(mesh);
  doc.createScene("S").addChild(node);
  const bin = await new WebIO().writeBinary(doc);
  return bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
}

test("converts a minimal GLB to a valid USDZ", async () => {
  const glb = await tinyGlb();
  const usdz = (await convertGlbToUsdz(glb, config)) as Blob;

  expect(usdz.size).toBeGreaterThan(0);

  const bytes = new Uint8Array(await usdz.arrayBuffer());
  // USDZ is a zip archive ("PK").
  expect(bytes[0]).toBe(0x50);
  expect(bytes[1]).toBe(0x4b);

  // STORE zip keeps file names in plaintext — the USD layer must be present.
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  expect(s.includes("model.usda")).toBe(true);
});
