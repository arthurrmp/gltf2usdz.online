import { motion } from "motion/react";
import { Loader2 } from "lucide-react";

// Animated spinner + the current stage label coming from the worker.
export const ProgressStages = ({ stage }: { stage: string }) => (
  <div className="flex flex-col items-center gap-4 py-2">
    <Loader2 className="size-9 animate-spin text-primary" />
    <motion.span
      key={stage}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-sm font-medium text-foreground"
    >
      {stage}…
    </motion.span>
    <span className="text-xs text-muted-foreground">
      Working locally — large or animated models can take a moment.
    </span>
  </div>
);
