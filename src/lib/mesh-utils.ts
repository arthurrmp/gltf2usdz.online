import type { Document } from "@gltf-transform/core";

// Binary GLB begins with the ASCII magic "glTF"; anything else is JSON glTF.
export function isGlb(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  );
}

// Decode a data: URI (embedded glTF buffer/image) into bytes.
export function dataUriToBytes(uri: string): Uint8Array<ArrayBuffer> {
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

// Suffix appended to the output filename when a single clip is kept.
export function animationFilenameSuffix(name: string | undefined): string {
  if (!name) return "";
  return "_" + name.trim().replace(/[^\w.-]+/g, "_");
}

// Determinant of a 4x4 matrix's upper-left 3x3 (column-major). Negative means
// the transform mirrors (flips handedness / triangle winding).
export function det3(m: ArrayLike<number>): number {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

// glTF flips front-face for mirrored (negative-determinant) instances at render
// time; the USDZ converter bakes transforms but never compensates, so a mirrored
// model comes out inside-out. Detect a predominantly mirrored scene.
export function isSceneMirrored(doc: Document): boolean {
  const nodes = doc.getRoot().listNodes();
  let neg = 0;
  let withMesh = 0;
  for (const n of nodes) {
    if (!n.getMesh()) continue;
    withMesh++;
    if (det3(n.getWorldMatrix()) < 0) neg++;
  }
  // Skinned meshes carry no mesh-node transform; fall back to all nodes.
  if (withMesh === 0) {
    const all = nodes.filter((n) => det3(n.getWorldMatrix()) < 0).length;
    return nodes.length > 0 && all > nodes.length / 2;
  }
  return neg > withMesh / 2;
}

// Reverse triangle winding so the converter's bake of a mirror flips it back to
// correct. Topological only (safe for skinned meshes).
export function flipWinding(doc: Document): void {
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
