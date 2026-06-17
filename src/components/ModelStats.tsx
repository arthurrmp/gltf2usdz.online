import type { ModelStats as Stats } from "@/common";
import { formatCount } from "@/lib/format";

const Chip = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col items-center rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/10">
    <span className="text-sm font-semibold tabular-nums text-white">{value}</span>
    <span className="text-[10px] uppercase tracking-wide text-white/45">{label}</span>
  </div>
);

export const ModelStats = ({ stats }: { stats: Stats }) => (
  <div className="flex flex-col gap-2">
    <div className="grid grid-cols-3 gap-2">
      <Chip label="Triangles" value={formatCount(stats.triangles)} />
      <Chip label="Textures" value={`${stats.textures}`} />
      <Chip label="Animations" value={`${stats.animations}`} />
    </div>
    {stats.compression.length > 0 && (
      <div className="flex flex-wrap justify-center gap-1.5">
        {stats.compression.map((c) => (
          <span
            key={c}
            className="rounded-full bg-lime-500/15 px-2.5 py-0.5 text-[11px] font-medium text-lime-200 ring-1 ring-lime-400/25"
          >
            {c}
          </span>
        ))}
      </div>
    )}
  </div>
);
