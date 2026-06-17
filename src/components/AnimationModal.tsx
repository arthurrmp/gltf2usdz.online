import { motion } from "framer-motion";

type Props = {
  animations: string[];
  onSelect: (keep: number | null) => void;
  onCancel: () => void;
};

// Shown when an uploaded model has more than one animation. AR Quick Look
// plays a single timeline, and keeping every clip bloats the USDZ, so the
// user picks one (or none).
export const AnimationModal = ({ animations, onSelect, onCancel }: Props) => {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-[90vw] max-w-md rounded-2xl bg-zinc-900/95 p-6 text-left text-white shadow-2xl ring-1 ring-white/10"
      >
        <h2 className="text-lg font-bold">This model has {animations.length} animations</h2>
        <p className="mt-1 text-sm font-normal text-white/70">
          USDZ / AR Quick Look plays one timeline. Pick the clip to keep — fewer
          clips means a much smaller file.
        </p>

        <div className="mt-4 max-h-60 space-y-1 overflow-y-auto pr-1">
          {animations.map((name, i) => (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className="block w-full truncate rounded-lg bg-white/5 px-3 py-2 text-left text-sm font-medium hover:bg-white/15"
            >
              {name}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => onSelect(null)}
            className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20"
          >
            None (static)
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm font-medium text-white/60 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
};
