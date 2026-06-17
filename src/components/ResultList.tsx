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
        className="group flex items-center gap-3 rounded-xl bg-white/[0.04] px-3.5 py-2.5 ring-1 ring-white/10 transition hover:bg-white/[0.08] hover:ring-white/20"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/20">
          <IconDownload className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">
          {f.name}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-white/45">
          {formatBytes(f.size)}
        </span>
      </motion.a>
    ))}
  </div>
);
