<div align="center">

<img src="public/favicon.svg" width="92" height="92" alt="gltf2usdz.online logo" />

# gltf2usdz.online

**Convert glTF / GLB → USDZ for AR Quick Look — entirely in your browser.**

[![Live](https://img.shields.io/badge/live-gltf2usdz.online-84cc16?logo=cloudflare&logoColor=white)](https://gltf2usdz.online)
[![License](https://img.shields.io/badge/license-MIT-84cc16)](LICENSE)
[![Converter](https://img.shields.io/badge/powered%20by-WebUsdFramework-84cc16)](https://github.com/chrismichaelps/WebUsdFramework)

</div>

> [!NOTE]
> Huge thanks to [**@chrismichaelps**](https://github.com/chrismichaelps) and
> [**WebUsdFramework**](https://github.com/chrismichaelps/WebUsdFramework) — a
> pure-JS glTF → USDZ converter. That excellent work let this project drop its
> entire backend (previously a `usd_from_gltf` Docker service) and run the
> conversion right in the browser. If gltf2usdz.online is useful to you, give
> [WebUsdFramework](https://github.com/chrismichaelps/WebUsdFramework) a star. ⭐

Your files never leave your device — the GLB → USDZ conversion runs client-side
in a Web Worker, so there's no upload and no backend. It's just a static site.

## Features

- 🧊 &nbsp;**glTF / GLB → USDZ**, fully in the browser
- 🔒 &nbsp;**Private** — nothing is uploaded, no account, free
- 🗜️ &nbsp;Handles **Draco** & **Meshopt** geometry and **KTX2/Basis** textures (transcoded to PNG)
- 🎞️ &nbsp;Multi-animation models: keep **one clip, all, or none** (AR Quick Look plays a single timeline)
- ⚡ &nbsp;Ships as a static **Cloudflare Worker** (assets only)

## Built with

- [React](https://reactjs.org) + [Vite](https://vitejs.dev) + [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)
- [WebUsdFramework](https://github.com/chrismichaelps/WebUsdFramework) — the glTF → USDZ converter
- [glTF-Transform](https://gltf-transform.dev) — glTF parsing & preprocessing
- [Draco](https://github.com/google/draco) + [meshoptimizer](https://github.com/zeux/meshoptimizer) — geometry decoders
- [Basis Universal](https://github.com/BinomialLLC/basis_universal) — KTX2 → PNG transcoder

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
bun run build      # outputs the static site to ./dist
bun run deploy     # build + wrangler deploy (uses your local `wrangler login`)
```

The app is an **assets-only Cloudflare Worker** served at
[gltf2usdz.online](https://gltf2usdz.online) through a custom-domain route
(`wrangler.jsonc`); the zone must already exist in the account.

### CI/CD

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs
lint · typecheck · test · build on every push and PR, and **deploys to
production on push to `main`**. It needs two repository secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | **Workers Scripts: Edit**, plus **DNS: Edit** and **Workers Routes: Edit** on the zone (to provision the custom domain) |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID |

## Third-party code

- `src/vendor/webusd/` — WebUsdFramework source, vendored **unmodified** (it is
  not published to npm). MIT; license retained in that directory.
- `src/lib/basis/` — Basis Universal transcoder (Apache-2.0), vendored from
  three.js. See `NOTICE.md` there.

## Acknowledgments

- [WebUsdFramework](https://github.com/chrismichaelps/WebUsdFramework) by
  Chris M. (Michael) Pérez — the glTF → USDZ converter that powers this tool.
- [shadcn/ui](https://ui.shadcn.com) — UI components and the theme preset.
