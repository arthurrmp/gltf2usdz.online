# gltf2usdz.online

This is the source code for [gltf2usdz.online](https://gltf2usdz.online), a web app
that converts glTF/GLB files to USDZ for use in AR Quick Look on iOS.

Conversion runs **entirely in the browser** — the file never leaves your machine,
and there is no server. The GLB → USDZ work happens in a Web Worker, so a static
deploy (Cloudflare Workers/Pages assets) is all that's needed.

It supports Draco- and Meshopt-compressed geometry and KTX2/Basis textures
(transcoded to PNG in-browser). When a model has multiple animations, a prompt
lets you keep one (or none) — AR Quick Look plays a single timeline, and dropping
unused clips keeps the file small.

Made with:
- [react](https://reactjs.org) + [vite](https://vitejs.dev)
- [WebUsdFramework](https://github.com/chrismichaelps/WebUsdFramework) — the glTF → USDZ converter (MIT)
- [glTF-Transform](https://gltf-transform.dev) — glTF parsing/preprocessing
- [Draco](https://github.com/google/draco) (`draco3dgltf`) and [meshoptimizer](https://github.com/zeux/meshoptimizer) decoders
- [Basis Universal](https://github.com/BinomialLLC/basis_universal) transcoder (KTX2 → PNG)
- [shadcn/ui](https://ui.shadcn.com) — UI components and theme

## Development

```bash
bun install
bun run dev        # dev server (Vite)
bun run lint       # eslint
bun run typecheck  # tsc --noEmit
bun test src       # unit + conversion tests (bun:test)
```

## Build & deploy

```bash
bun run build      # outputs static site to ./dist
bun run deploy     # build + wrangler deploy (uses your local `wrangler login`)
```

The app is an **assets-only Cloudflare Worker** served at
[gltf2usdz.online](https://gltf2usdz.online) via a custom-domain route
(`wrangler.jsonc`); the zone must already exist in the account.

### CI/CD

`.github/workflows/deploy.yml` runs lint · typecheck · test · build on every
push and PR, and **deploys to production on push to `main`**. It needs two
repo secrets:

- `CLOUDFLARE_API_TOKEN` — token with **Workers Scripts: Edit**, plus
  **DNS: Edit** and **Workers Routes: Edit** on the zone (required to
  provision the custom domain).
- `CLOUDFLARE_ACCOUNT_ID` — the account ID.

## Third-party code

- `src/vendor/webusd/` — WebUsdFramework source, vendored unmodified
  (it is not published to npm). MIT, license retained in that directory.
- `src/lib/basis/` — Basis Universal transcoder (Apache-2.0), vendored
  from three.js. See `NOTICE.md` there.

## Acknowledgments

- [WebUsdFramework](https://github.com/chrismichaelps/WebUsdFramework) by
  Chris M. (Michael) Pérez — the glTF → USDZ converter that powers this tool.
- [shadcn/ui](https://ui.shadcn.com) — UI components and the theme preset.
