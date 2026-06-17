import { motion } from "motion/react";

// Animated ring + the current stage label coming from the worker.
export const ProgressStages = ({ stage }: { stage: string }) => (
  <div className="flex flex-col items-center gap-4 py-2">
    <div className="relative h-14 w-14">
      <div className="absolute inset-0 rounded-full border-2 border-white/10" />
      <div className="absolute inset-0 animate-[spin-ring_0.9s_linear_infinite] rounded-full border-2 border-transparent border-t-lime-400 border-r-green-400" />
    </div>
    <motion.span
      key={stage}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-sm font-medium text-white/80"
    >
      {stage}…
    </motion.span>
    <span className="text-xs text-white/40">
      Working locally — large or animated models can take a moment.
    </span>
  </div>
);
