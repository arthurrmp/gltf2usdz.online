// Minimal Buffer shim for the browser. The vendored converter references
// `Buffer` only in dead branches (pngjs/canvas/sharp fallbacks, debug output)
// on the GLB->USDZ Blob path, but define a safe one so a stray reference can't
// throw. Imported first in the worker so it runs before other module code.
/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
if (!g.Buffer) {
  g.Buffer = {
    from: (x: any) => (x instanceof Uint8Array ? x : new Uint8Array(x)),
    alloc: (n: number) => new Uint8Array(n),
    isBuffer: () => false,
    concat: (arr: Uint8Array[]) => {
      let n = 0;
      for (const a of arr) n += a.length;
      const r = new Uint8Array(n);
      let o = 0;
      for (const a of arr) {
        r.set(a, o);
        o += a.length;
      }
      return r;
    },
  };
}
export {};
