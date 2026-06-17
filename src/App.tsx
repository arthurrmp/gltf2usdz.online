import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { GradientBackdrop } from "@/components/GradientBackdrop";
import { AnimationModal } from "@/components/AnimationModal";
import { ProgressStages } from "@/components/ProgressStages";
import { ResultList } from "@/components/ResultList";
import { Footer } from "@/components/Footer";
import { IconUpload, IconLock, IconCheck, IconAlert } from "@/components/icons";
import type { ConvertedFile, Status } from "@/common";

type WorkerOut =
  | { type: "progress"; stage: string }
  | { type: "loaded"; animations: string[] }
  | { type: "done"; usdz: ArrayBuffer; name: string }
  | { type: "error"; message: string };

function App() {
  const [status, setStatus] = React.useState<Status>("idle");
  const [stage, setStage] = React.useState("Reading model");
  const [animations, setAnimations] = React.useState<string[] | null>(null);
  const [error, setError] = React.useState("");
  const [results, setResults] = React.useState<ConvertedFile[]>([]);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const workerRef = React.useRef<Worker | null>(null);
  const pendingName = React.useRef("model.glb");

  React.useEffect(() => {
    const worker = new Worker(
      new URL("./lib/convert.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setStage(msg.stage);
      } else if (msg.type === "loaded") {
        if (msg.animations.length > 1) {
          setAnimations(msg.animations);
        } else {
          worker.postMessage({
            type: "convert",
            keep: msg.animations.length === 1 ? 0 : null,
            name: pendingName.current,
          });
        }
      } else if (msg.type === "done") {
        const url = URL.createObjectURL(
          new Blob([msg.usdz], { type: "model/vnd.usdz+zip" }),
        );
        setResults((prev) =>
          [{ name: msg.name, url, size: msg.usdz.byteLength }, ...prev].slice(0, 5),
        );
        setStatus("success");
      } else if (msg.type === "error") {
        setError(msg.message);
        setStatus("error");
      }
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const sendFile = async (file: File) => {
    if (!(file.name.endsWith(".glb") || file.name.endsWith(".gltf"))) {
      setError("Please choose a .glb or .gltf file.");
      setStatus("error");
      return;
    }
    setError("");
    setAnimations(null);
    setStage("Reading model");
    setStatus("working");
    pendingName.current = file.name;
    try {
      const buffer = await file.arrayBuffer();
      workerRef.current?.postMessage({ type: "load", buffer, name: file.name }, [
        buffer,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file.");
      setStatus("error");
    }
  };

  const chooseAnimation = (keep: number | null | "all") => {
    setAnimations(null);
    setStage("Preparing geometry");
    setStatus("working");
    workerRef.current?.postMessage({
      type: "convert",
      keep,
      name: pendingName.current,
    });
  };

  const openPicker = () => {
    if (status === "working") return;
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  const onDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (status === "working") return;
    if (e.type === "dragenter" || e.type === "dragover") setStatus("dragging");
    else if (e.type === "dragleave") setStatus("idle");
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (status === "working") return;
    const file = e.dataTransfer.files?.[0];
    if (file) sendFile(file);
    else setStatus("idle");
  };

  const interactive = status === "idle" || status === "dragging";

  return (
    <div
      className="flex min-h-dvh flex-col"
      onDragEnter={onDrag}
      onDragOver={onDrag}
      onDragLeave={onDrag}
      onDrop={onDrop}
    >
      <GradientBackdrop />
      <input
        ref={inputRef}
        type="file"
        id="input-file-upload"
        accept=".glb,.gltf"
        onChange={(e) => e.target.files?.[0] && sendFile(e.target.files[0])}
      />

      {animations && (
        <AnimationModal
          animations={animations}
          onSelect={chooseAnimation}
          onCancel={() => {
            setAnimations(null);
            setStatus("idle");
          }}
        />
      )}

      <main className="flex flex-1 flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-md text-center">
          <h1 className="bg-gradient-to-br from-white via-white to-lime-200/80 bg-clip-text text-4xl font-semibold tracking-tight text-transparent">
            gltf2usdz
          </h1>
          <p className="mt-2 text-sm text-white/50">
            glTF / GLB → USDZ for AR Quick Look, converted in your browser.
          </p>

          {/* Morphing glass card */}
          <div
            onClick={interactive ? openPicker : undefined}
            className={[
              "relative mt-7 overflow-hidden rounded-3xl bg-white/[0.04] p-6 ring-1 backdrop-blur-2xl transition",
              interactive
                ? "cursor-pointer ring-white/10 hover:bg-white/[0.06]"
                : "ring-white/10",
              status === "dragging" ? "bg-white/[0.08] ring-2 ring-lime-400/60" : "",
            ].join(" ")}
          >
            <AnimatePresence mode="wait">
              {interactive && (
                <motion.div
                  key="drop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-3 py-6"
                >
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.06] text-white/80 ring-1 ring-white/10">
                    <IconUpload className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="text-base font-medium text-white">
                      {status === "dragging"
                        ? "Drop to convert"
                        : "Drop a .glb or .gltf"}
                    </p>
                    <p className="text-sm text-white/45">or click to choose a file</p>
                  </div>
                </motion.div>
              )}

              {status === "working" && (
                <motion.div
                  key="working"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-5"
                >
                  <ProgressStages stage={stage} />
                </motion.div>
              )}

              {status === "success" && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-4"
                >
                  <div className="flex items-center justify-center gap-2 text-emerald-300">
                    <IconCheck className="h-5 w-5" />
                    <span className="text-sm font-medium">Converted</span>
                  </div>
                  <ResultList files={results} />
                  <button
                    onClick={openPicker}
                    className="mt-1 rounded-xl bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
                  >
                    Convert another
                  </button>
                </motion.div>
              )}

              {status === "error" && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-3 py-4"
                >
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/20">
                    <IconAlert className="h-6 w-6" />
                  </span>
                  <p className="text-sm text-white/70">{error}</p>
                  <button
                    onClick={openPicker}
                    className="rounded-xl bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
                  >
                    Try again
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-white/40">
            <IconLock className="h-3.5 w-3.5" />
            Runs entirely on your device — files never leave your browser.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default App;
