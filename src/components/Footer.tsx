import { IconGithub, IconCoffee } from "./icons";

export const Footer = () => (
  <footer className="flex items-center justify-center gap-5 pb-6 pt-4 text-xs text-muted-foreground">
    <a
      href="https://github.com/arthurrmp/gltf2usdz.online"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 transition hover:text-foreground"
    >
      <IconGithub className="size-4" />
      arthurrmp
    </a>
    <span className="text-border">·</span>
    <a
      href="https://ko-fi.com/arthurrmp"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 transition hover:text-foreground"
    >
      <IconCoffee className="size-4" />
      Buy me a coffee
    </a>
  </footer>
);
