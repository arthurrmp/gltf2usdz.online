// Dark canvas with slow-drifting blurred gradient blobs — the "living glow".
// Pure CSS animation, no JS per-frame work.
export const GradientBackdrop = () => (
  <div className="fixed inset-0 -z-10 overflow-hidden bg-[#07070b]">
    <div
      className="absolute -left-[10%] top-[-15%] h-[55vmax] w-[55vmax] rounded-full opacity-50 blur-[110px] animate-float-slow"
      style={{ background: "radial-gradient(circle, var(--color-glow-1), transparent 65%)" }}
    />
    <div
      className="absolute right-[-15%] top-[10%] h-[50vmax] w-[50vmax] rounded-full opacity-40 blur-[120px] animate-float-slower"
      style={{ background: "radial-gradient(circle, var(--color-glow-2), transparent 65%)" }}
    />
    <div
      className="absolute bottom-[-20%] left-[20%] h-[45vmax] w-[45vmax] rounded-full opacity-35 blur-[120px] animate-float-slow"
      style={{ background: "radial-gradient(circle, var(--color-glow-3), transparent 65%)" }}
    />
    {/* Vignette + subtle top sheen */}
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,#07070b_95%)]" />
  </div>
);
