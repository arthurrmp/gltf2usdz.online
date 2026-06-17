import { IconGithub, IconCoffee } from "./icons";

export const Footer = () => (
  <footer className="flex items-center justify-center gap-5 pb-6 pt-4 text-xs text-white/40">
    <a
      href="https://github.com/arthurrmp/gltf2usdz.online"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 transition hover:text-white/75"
    >
      <IconGithub className="h-4 w-4" />
      arthurrmp
    </a>
    <span className="text-white/15">·</span>
    <a
      href="https://ko-fi.com/arthurrmp"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 transition hover:text-white/75"
    >
      <IconCoffee className="h-4 w-4" />
      Buy me a coffee
    </a>
  </footer>
);
