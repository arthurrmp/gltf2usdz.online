import { motion } from "motion/react";
import type { ConvertedFile } from "@/common";
import { formatBytes } from "@/lib/format";
import { IconDownload } from "./icons";

export const ResultList = ({ files }: { files: ConvertedFile[] }) => (
  <div className="flex flex-col gap-2">
    {files.map((f, i) => (
      <motion.a
        key={f.url}
        href={f.url}
        download={f.name}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: i * 0.04 }}
        className="group flex items-center gap-3 rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 transition hover:bg-muted"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <IconDownload className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {f.name}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatBytes(f.size)}
        </span>
      </motion.a>
    ))}
  </div>
);
