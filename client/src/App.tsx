import React from "react";
import useLocalStorage from "@/hooks/useLocalStorage";
import SvgSpinners3DotsBounce from "@/icons/SvgSpinners3DotsBounce";
import { FilesTable } from "@/components/FilesTable";
import { Footer } from "@/components/Footer";
import { BackgroundGradientAnimation } from "@/components/ui/background-gradient-animation";
import { ConvertedFile, LOCAL_STORAGE_KEY, MESSAGES, STATES } from "@/common";

function App() {
  const [convertedFiles, setConvertedFiles] = useLocalStorage<ConvertedFile[]>(
    LOCAL_STORAGE_KEY,
    [],
  );

  const [state, setState] = React.useState<STATES>(STATES.IDLE);

  const [error, setError] = React.useState("");

  const inputRef = React.useRef<HTMLInputElement>(null);

  // Clean the expired files every second
  React.useEffect(() => {
    const interval = setInterval(() => {
      setConvertedFiles((convertedFiles) => {
        return convertedFiles.filter(({ expires }) => expires >= Date.now());
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleDrag = function (e: React.DragEvent<HTMLDivElement>) {
    if (state === STATES.LOADING) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setError("");

    if (e.type === "dragenter" || e.type === "dragover") {
      setState(STATES.DRAGGING);
    } else if (e.type === "dragleave") {
      setState(STATES.IDLE);
    }
  };

  const handleDrop = function (e: React.DragEvent<HTMLDivElement>) {
    if (state === STATES.LOADING) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];

      if (file.name.endsWith(".glb") || file.name.endsWith(".gltf")) {
        sendFile(file);
        return;
      }

      setError("Invalid file type. Please upload a .glb or .gltf file");

      setTimeout(() => {
        setError("");
      }, 10_000);

      return;
    }

    setState(STATES.IDLE);
  };

  const handleChange = function (e: React.ChangeEvent<HTMLInputElement>) {
    e.preventDefault();
    setError("");
    setState(STATES.IDLE);
    if (e.target.files) {
      sendFile(e.target.files[0]);
    }
  };

  const onButtonClick = () => {
    if (!inputRef.current) {
      return;
    }

    inputRef.current.value = "";
    inputRef.current.click();
  };

  const sendFile = async (file: File) => {
    const data = new FormData();
    data.append("file", file);

    setState(STATES.LOADING);

    try {
      const res = await fetch("/api/convert", { method: "POST", body: data });

      if (!res.ok) {
        throw new Error(await res.text() || "The server returned an unexpected error. Please try again later.");
      }

      setConvertedFiles([await res.json(), ...convertedFiles].slice(0, 5));

      setState(STATES.SUCCESS);
    } catch (error) {
      setError(error instanceof Error ? error.message : "An unknown error occurred");
      setState(STATES.ERROR);
    }

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
              {
                state === STATES.ERROR &&
                <span className="pl-1">
                  You can <span className="underline decoration-dotted cursor-help" title={error}>hover here</span> for details or click to try again.
                </span>
              }
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
      </BackgroundGradientAnimation >
    </>
  );
}

export default App;
