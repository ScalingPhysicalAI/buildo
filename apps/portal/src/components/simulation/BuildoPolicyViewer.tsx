"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import clsx from "clsx";

import { buildSceneFromModel, getPosition, getQuaternion } from "@/lib/mujoco/loadHumanoidScene";
import { loadBuildoModel } from "@/lib/mujoco/loadBuildoScene";
import { applyAction, newBaseIntegratorState, type BaseIntegratorState } from "@/lib/buildo/applyActionChunk";
import { observationFromMujoco } from "@/lib/buildo/observation";
import { PolicyClient, type PolicyClientState } from "@/lib/buildo/policyClient";

// Phase 4: wires buildo_v0.xml (Phase 2) up to services/policy-server
// (Phase 3) over real HTTP, in the browser. Deliberately a separate
// component and route from MujocoViewer.tsx/the existing /dashboard/simulate
// page -- that one is the working, tested simulator (different robot model
// entirely); this is new, still-experimental Phase 4 work that must not be
// able to affect it. See packages/buildo-mujoco/robots/buildo/ACTION_MAPPING.md
// and services/policy-server/README.md for what this is actually doing.

const ENGINE_URL = "/mujoco/engine/mujoco.js"; // shared WASM engine, same one MujocoViewer.tsx uses
const POLICY_SERVER_URL = process.env.NEXT_PUBLIC_POLICY_SERVER_URL ?? "http://localhost:8000/act";

type Status = "loading" | "ready" | "error";

const STATUS_LABEL: Record<PolicyClientState["status"], string> = {
  connecting: "Connecting to policy server…",
  ok: "Policy server connected",
  "safe-hold": "SAFE HOLD — holding last commanded pose",
};

export function BuildoPolicyViewer({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [policyState, setPolicyState] = useState<PolicyClientState>({
    status: "connecting",
    reason: null,
    lastChunkAtMs: null,
    lastError: null,
  });

  useEffect(() => {
    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      const container = containerRef.current;
      if (!container) return;

      const { default: loadMujoco } = await import(/* webpackIgnore: true */ ENGINE_URL);
      const mujoco = await loadMujoco();
      if (disposed) return;

      const model = await loadBuildoModel(mujoco);
      const data = new mujoco.MjData(model);
      mujoco.mj_forward(model, data);
      if (disposed) return;

      const { root, bodies } = buildSceneFromModel(mujoco, model);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf3efe4);
      scene.add(root);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
      keyLight.position.set(2, 3, 2);
      scene.add(keyLight);

      const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 50);
      camera.position.set(1.5, 1.2, 1.5);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.5, 0);
      controls.update();

      resizeObserver = new ResizeObserver(() => {
        if (!container || !renderer) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      });
      resizeObserver.observe(container);

      setStatus("ready");

      const policyClient = new PolicyClient(POLICY_SERVER_URL);
      const baseState: BaseIntegratorState = newBaseIntegratorState();
      const timestepMs = model.opt.timestep * 1000;
      const actionDt = 0.05; // matches policy_server/pick_and_place.py's default
      let simTimeS = 0;
      let actionElapsedS = actionDt; // force an immediate first tick
      let sequenceCounter = 0;
      let lastFrameTime: number | null = null;
      let animationFrame = 0;

      const tmpPos = new THREE.Vector3();
      const tmpQuat = new THREE.Quaternion();

      function animate(now: number) {
        if (disposed) return;
        animationFrame = requestAnimationFrame(animate);

        if (lastFrameTime === null) lastFrameTime = now;
        let remaining = Math.min(now - lastFrameTime, 50); // cap catch-up, same as MujocoViewer.tsx
        lastFrameTime = now;

        while (remaining >= timestepMs) {
          actionElapsedS += timestepMs / 1000;
          if (actionElapsedS >= actionDt) {
            actionElapsedS = 0;
            const entry = policyClient.tick(performance.now(), () =>
              observationFromMujoco(mujoco, model, data, `seq-${sequenceCounter++}`, simTimeS, "pick up the object and place it elsewhere")
            );
            // entry === null means SAFE HOLD: deliberately not calling
            // applyAction, so every actuator target stays exactly where it
            // last was -- see policyClient.ts's own header comment.
            if (entry) applyAction(mujoco, model, data, baseState, entry, actionDt);
          }
          mujoco.mj_step(model, data);
          simTimeS += timestepMs / 1000;
          remaining -= timestepMs;
        }

        setPolicyState((prev) => {
          const next = policyClient.getState();
          return prev.status === next.status && prev.reason === next.reason && prev.lastError === next.lastError ? prev : next;
        });

        for (let b = 0; b < model.nbody; b++) {
          const group = bodies[b];
          if (!group) continue;
          getPosition(data.xpos, b, tmpPos);
          group.position.copy(tmpPos);
          getQuaternion(data.xquat, b, tmpQuat);
          group.quaternion.copy(tmpQuat);
        }

        controls?.update();
        renderer?.render(scene, camera);
      }
      animationFrame = requestAnimationFrame(animate);

      return () => cancelAnimationFrame(animationFrame);
    }

    let cleanupAnimation: (() => void) | void;
    init()
      .then((cleanup) => {
        cleanupAnimation = cleanup;
      })
      .catch((err) => {
        console.error("[BuildoPolicyViewer] failed to initialize:", err);
        if (!disposed) {
          setStatus("error");
          setErrorMessage(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      disposed = true;
      cleanupAnimation?.();
      resizeObserver?.disconnect();
      controls?.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, []);

  return (
    <div className={clsx("relative h-full w-full", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">Loading Buildo…</div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center text-white">
          Failed to load: {errorMessage}
        </div>
      )}
      {status === "ready" && (
        <div
          className={clsx(
            "absolute top-3 left-3 rounded px-3 py-1.5 text-sm font-medium text-white",
            policyState.status === "ok" && "bg-emerald-600/90",
            policyState.status === "connecting" && "bg-slate-600/90",
            policyState.status === "safe-hold" && "bg-amber-600/90"
          )}
        >
          {STATUS_LABEL[policyState.status]}
          {policyState.status === "safe-hold" && policyState.lastError && (
            <span className="ml-2 font-normal opacity-80">({policyState.lastError})</span>
          )}
        </div>
      )}
    </div>
  );
}
