import { test, expect, describe } from "bun:test";
import { Document } from "@gltf-transform/core";
import {
  isGlb,
  dataUriToBytes,
  animationFilenameSuffix,
  det3,
  isSceneMirrored,
  flipWinding,
} from "./mesh-utils";

describe("isGlb", () => {
  test("true for the glTF binary magic", () => {
    expect(isGlb(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0]))).toBe(true);
  });
  test("false for JSON glTF text", () => {
    expect(isGlb(new TextEncoder().encode('{"asset"'))).toBe(false);
  });
});

describe("dataUriToBytes", () => {
  test("decodes base64 data URIs", () => {
    // base64 "AAEC" => [0,1,2]
    const out = dataUriToBytes("data:application/octet-stream;base64,AAEC");
    expect([...out]).toEqual([0, 1, 2]);
  });
  test("decodes plain (non-base64) data URIs", () => {
    expect([...dataUriToBytes("data:,Hi")]).toEqual([...new TextEncoder().encode("Hi")]);
  });
});

describe("animationFilenameSuffix", () => {
  test("sanitizes and prefixes with underscore", () => {
    expect(animationFilenameSuffix("Run Walk")).toBe("_Run_Walk");
    expect(animationFilenameSuffix("Idle.Base-1")).toBe("_Idle.Base-1");
  });
  test("empty for undefined/empty", () => {
    expect(animationFilenameSuffix(undefined)).toBe("");
    expect(animationFilenameSuffix("")).toBe("");
  });
});

describe("det3", () => {
  test("identity is positive, mirror is negative", () => {
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const mirror = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(det3(I)).toBeGreaterThan(0);
    expect(det3(mirror)).toBeLessThan(0);
  });
});

// Build a one-triangle mesh on a node so winding/mirror logic has real data.
function triDoc(scale: [number, number, number]) {
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
  const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx);
  const mesh = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(mesh).setScale(scale);
  doc.createScene().addChild(node);
  return { doc, idx };
}

describe("isSceneMirrored", () => {
  test("false for a normal (positive-scale) scene", () => {
    expect(isSceneMirrored(triDoc([1, 1, 1]).doc)).toBe(false);
  });
  test("true when a node has negative (mirror) scale", () => {
    expect(isSceneMirrored(triDoc([-1, 1, 1]).doc)).toBe(true);
  });
});

describe("flipWinding", () => {
  test("reverses each triangle's index order", () => {
    const { doc, idx } = triDoc([1, 1, 1]);
    flipWinding(doc);
    expect([...idx.getArray()!]).toEqual([0, 2, 1]);
  });
});
