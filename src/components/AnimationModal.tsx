import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  animations: string[];
  onSelect: (keep: number | null | "all") => void;
  onCancel: () => void;
};

// Shown when a model has more than one animation. AR Quick Look plays a single
// timeline, so the user picks one clip, none, or keeps them all.
export const AnimationModal = ({ animations, onSelect, onCancel }: Props) => (
  <Dialog
    open
    onOpenChange={(open) => {
      if (!open) onCancel();
    }}
  >
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{animations.length} animations found</DialogTitle>
        <DialogDescription>
          AR Quick Look plays one animation. Select a clip if you want.
        </DialogDescription>
      </DialogHeader>

      <div className="scroll-soft -mr-2 flex max-h-56 flex-col divide-y divide-border overflow-y-auto pr-2">
        {animations.map((name, i) => (
          <Button
            key={i}
            variant="ghost"
            size="lg"
            onClick={() => onSelect(i)}
            className="h-auto w-full shrink-0 justify-start rounded-none py-2.5 font-normal"
          >
            <span className="truncate">{name}</span>
          </Button>
        ))}
      </div>

      <DialogFooter className="gap-2 sm:flex-row sm:justify-stretch">
        <Button variant="secondary" className="flex-1" onClick={() => onSelect(null)}>
          No animation
        </Button>
        <Button className="flex-1" onClick={() => onSelect("all")}>
          All animations
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
