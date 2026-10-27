"use client";

import { useRef, useState } from "react";
import clsx from "clsx";

import type { SimEnvironment } from "@/lib/mujoco/environments";
import {
  prepareUploadedEnvironment,
  UPLOAD_ACCEPT,
  UPLOAD_LIMITS,
  UploadError,
  type UpAxis,
} from "@/lib/mujoco/uploadEnvironment";

interface EnvironmentUploadPanelProps {
  /** Returns a fresh MuJoCo WASM instance for validation. */
  loadEngine: () => Promise<unknown>;
  onLoaded: (environment: SimEnvironment, warnings: string[]) => void;
  onClose: () => void;
}

const MB = 1024 * 1024;

export function EnvironmentUploadPanel({ loadEngine, onLoaded, onClose }: EnvironmentUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [upAxis, setUpAxis] = useState<UpAxis>("auto");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setProgress("Reading file");
    try {
      const { environment, warnings } = await prepareUploadedEnvironment(file, upAxis, loadEngine, setProgress);
      onLoaded(environment, warnings);
    } catch (err) {
      console.error("Environment upload failed:", err);
      setError(err instanceof UploadError ? err.message : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const busy = progress !== null;
  const buttonClass =
    "rounded-sm border border-border-strong bg-panel-raised px-4 py-2 text-xs text-off-white transition-colors hover:bg-panel cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-label="Upload environment"
        className="w-full max-w-md rounded-sm border border-border-strong bg-panel/95 p-5 text-xs text-off-white/80 backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-technical mb-3 text-sand">UPLOAD ENVIRONMENT</p>
        <p className="mb-3">
          Load your own room into the simulator. It stays in this browser tab only, and Buildo is placed in the middle of it
          automatically.
        </p>
        <ul className="mb-4 list-disc space-y-1 pl-4 text-off-white/70">
          <li>
            <span className="text-off-white">.zip</span> with one MJCF <span className="font-mono">.xml</span> (only{" "}
            <span className="font-mono">&lt;asset&gt;</span>, <span className="font-mono">&lt;worldbody&gt;</span>, named{" "}
            <span className="font-mono">&lt;default&gt;</span> classes) and the .stl/.obj/.png files it references
          </li>
          <li>
            a single <span className="text-off-white">.xml</span>, <span className="text-off-white">.obj</span>, or{" "}
            <span className="text-off-white">.stl</span>
          </li>
          <li>
            Up to {UPLOAD_LIMITS.maxUploadBytes / MB} MB ({UPLOAD_LIMITS.maxExtractedBytes / MB} MB unzipped),{" "}
            {UPLOAD_LIMITS.maxTriangles.toLocaleString()} triangles, {UPLOAD_LIMITS.maxGeoms} geoms, at most{" "}
            {UPLOAD_LIMITS.maxExtentM} m across. Units are meters.
          </li>
        </ul>

        <label className="mb-4 flex items-center gap-2">
          <span>Up axis</span>
          <select
            value={upAxis}
            disabled={busy}
            onChange={(e) => setUpAxis(e.target.value as UpAxis)}
            className="rounded-sm border border-border-strong bg-panel px-2 py-1 text-off-white"
          >
            <option value="auto">Auto (.obj meshes Y-up, otherwise Z-up)</option>
            <option value="z">Z-up (MuJoCo, most STL/MJCF)</option>
            <option value="y">Y-up (Blender OBJ/glTF exports)</option>
          </select>
        </label>

        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {error && <p className="mb-3 rounded-sm border border-error/50 bg-error/10 px-3 py-2 text-error">{error}</p>}
        {busy && (
          <p className="mb-3 flex items-center gap-2 text-sand">
            <span className="h-2 w-2 animate-pulse rounded-full bg-sand" />
            {progress}…
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={buttonClass}>
            Cancel
          </button>
          <button onClick={() => inputRef.current?.click()} disabled={busy} className={clsx(buttonClass, "text-sand")}>
            Choose file…
          </button>
        </div>
      </div>
    </div>
  );
}
