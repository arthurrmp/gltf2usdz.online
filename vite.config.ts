import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const nodeStub = path.resolve(__dirname, "./src/lib/node-stub.ts");

// Node builtins + native/optional deps the vendored converter references but
// never executes on the browser GLB->USDZ path. Aliased to a harmless stub.
const stubbedModules = [
  "fs",
  "os",
  "path",
  "stream",
  "util",
  "child_process",
  "sharp",
  "canvas",
  "fbx2gltf",
  "pngjs",
];

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      {
        find: "webusd",
        replacement: path.resolve(
          __dirname,
          "./src/vendor/webusd/src/converters/gltf",
        ),
      },
      ...stubbedModules.flatMap((m) => [
        { find: new RegExp(`^${m}$`), replacement: nodeStub },
        { find: new RegExp(`^node:${m}$`), replacement: nodeStub },
      ]),
    ],
  },
  define: {
    global: "globalThis",
  },
  worker: {
    format: "es",
  },
});
