import { motion, AnimatePresence } from "motion/react";

type Props = {
  animations: string[];
  onSelect: (keep: number | null | "all") => void;
  onCancel: () => void;
};

// Shown when a model has more than one animation. AR Quick Look plays a single
// timeline, and keeping every clip bloats the USDZ, so the user picks one.
export const AnimationModal = ({ animations, onSelect, onCancel }: Props) => (
  <AnimatePresence>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-md"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-white/[0.06] p-6 text-left ring-1 ring-white/15 backdrop-blur-2xl"
      >
        <h2 className="text-lg font-semibold text-white">
          {animations.length} animations found
        </h2>
        <p className="mt-1 text-sm text-white/55">
          AR Quick Look plays one animation. Select a clip if you want, or just
          convert it.
        </p>

        <div className="scroll-soft mt-4 flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
          {animations.map((name, i) => (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className="shrink-0 truncate rounded-xl bg-white/[0.04] px-3.5 py-3 text-left text-sm font-medium leading-normal text-white/90 ring-1 ring-white/10 transition hover:bg-white/10 hover:ring-white/20"
            >
              {name}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => onSelect(null)}
              className="flex-1 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              No animation
            </button>
            <button
              onClick={() => onSelect("all")}
              className="flex-1 rounded-xl bg-lime-500/15 px-3 py-2.5 text-sm font-semibold text-lime-100 ring-1 ring-lime-400/25 transition hover:bg-lime-500/25"
            >
              All animations
            </button>
          </div>
          <button
            onClick={onCancel}
            className="rounded-xl px-3 py-2 text-sm font-medium text-white/45 transition hover:text-white/80"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
);
