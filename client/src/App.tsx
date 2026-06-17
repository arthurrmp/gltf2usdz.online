import React from "react";
import SvgSpinners3DotsBounce from "@/icons/SvgSpinners3DotsBounce";
import { FilesTable } from "@/components/FilesTable";
import { AnimationModal } from "@/components/AnimationModal";
import { Footer } from "@/components/Footer";
import { BackgroundGradientAnimation } from "@/components/ui/background-gradient-animation";
import { ConvertedFile, MESSAGES, STATES } from "@/common";

type WorkerOut =
  | { type: "loaded"; animations: string[] }
  | { type: "done"; usdz: ArrayBuffer; name: string }
  | { type: "error"; message: string };

function App() {
  const [convertedFiles, setConvertedFiles] = React.useState<ConvertedFile[]>([]);
  const [state, setState] = React.useState<STATES>(STATES.IDLE);
  const [error, setError] = React.useState("");
  const [animations, setAnimations] = React.useState<string[] | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const workerRef = React.useRef<Worker | null>(null);
  const pendingName = React.useRef<string>("model.glb");

  React.useEffect(() => {
    const worker = new Worker(
      new URL("./lib/convert.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === "loaded") {
        if (msg.animations.length > 1) {
          setAnimations(msg.animations);
          return;
        }
        worker.postMessage({
          type: "convert",
          keep: msg.animations.length === 1 ? 0 : null,
          name: pendingName.current,
        });
      } else if (msg.type === "done") {
        const url = URL.createObjectURL(
          new Blob([msg.usdz], { type: "model/vnd.usdz+zip" }),
        );
        setConvertedFiles((prev) =>
          [{ name: msg.name, url, size: msg.usdz.byteLength }, ...prev].slice(0, 5),
        );
        setState(STATES.SUCCESS);
      } else if (msg.type === "error") {
        setError(msg.message);
        setState(STATES.ERROR);
      }
    };

    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    if (state === STATES.LOADING) return;
    e.preventDefault();
    e.stopPropagation();
    setError("");
    if (e.type === "dragenter" || e.type === "dragover") {
      setState(STATES.DRAGGING);
    } else if (e.type === "dragleave") {
      setState(STATES.IDLE);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (state === STATES.LOADING) return;
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files[0];
    if (file) {
      if (file.name.endsWith(".glb") || file.name.endsWith(".gltf")) {
        sendFile(file);
        return;
      }
      setError("Invalid file type. Please upload a .glb or .gltf file");
      setState(STATES.ERROR);
      return;
    }
    setState(STATES.IDLE);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    setError("");
    if (e.target.files?.[0]) sendFile(e.target.files[0]);
  };

  const onButtonClick = () => {
    if (state === STATES.LOADING || !inputRef.current) return;
    inputRef.current.value = "";
    inputRef.current.click();
  };

  const sendFile = async (file: File) => {
    setError("");
    setAnimations(null);
    setState(STATES.LOADING);
    pendingName.current = file.name;
    try {
      const buffer = await file.arrayBuffer();
      workerRef.current?.postMessage(
        { type: "load", buffer, name: file.name },
        [buffer],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
      setState(STATES.ERROR);
    }
  };

  const chooseAnimation = (keep: number | null) => {
    setAnimations(null);
    setState(STATES.LOADING);
    workerRef.current?.postMessage({
      type: "convert",
      keep,
      name: pendingName.current,
    });
  };

  const cancelAnimation = () => {
    setAnimations(null);
    setState(STATES.IDLE);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        id="input-file-upload"
        onChange={handleChange}
        accept=".glb, .gltf"
      />
      {state === STATES.DRAGGING && (
        <div
          className="absolute inset-0 z-50"
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        />
      )}
      {animations && (
        <AnimationModal
          animations={animations}
          onSelect={chooseAnimation}
          onCancel={cancelAnimation}
        />
      )}
      <BackgroundGradientAnimation state={state} interactive={false}>
        <div
          className="absolute z-10 grid w-screen h-screen px-4 font-bold text-white pointer-events-none place-items-center"
          onDragOver={handleDrag}
          onDragEnter={handleDrag}
        >
          <div className="w-7/12 text-center pointer-events-auto">
            <h1 className="text-3xl">gltf2usdz.online</h1>

            <button className="pt-5" onClick={onButtonClick}>
              {MESSAGES[state]}
              {state === STATES.ERROR && (
                <span className="pl-1">
                  You can{" "}
                  <span
                    className="underline decoration-dotted cursor-help"
                    title={error}
                  >
                    hover here
                  </span>{" "}
                  for details or click to try again.
                </span>
              )}
            </button>

            {state === STATES.LOADING && (
              <SvgSpinners3DotsBounce className="inline ml-1" />
            )}

            {Boolean(convertedFiles.length) && (
              <FilesTable convertedFiles={convertedFiles} />
            )}
          </div>
        </div>
        <Footer />
      </BackgroundGradientAnimation>
    </>
  );
}

export default App;
