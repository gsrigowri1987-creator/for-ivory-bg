import { useEffect, useRef, useState } from 'react';
import {
  BUILD_STAGES,
  TOTAL_BUILD_DURATION,
} from './taj/config';
import { TajSceneController, type SceneHudSnapshot } from './taj/TajSceneController';

const INITIAL_HUD: SceneHudSnapshot = {
  buildTime: 0,
  buildProgress: 0,
  isBuilding: true,
  stageLabel: BUILD_STAGES[0].label,
  cameraPreset: 'pov_garden',
  cameraMode: 'pov',
  lightingPreset: 'daylight',
  sprinklersActive: true,
  breezeEnabled: true,
  contextLost: false,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<TajSceneController | null>(null);

  const [hud, setHud] = useState<SceneHudSnapshot>(INITIAL_HUD);
  const [webglError, setWebglError] = useState<string | null>(null);

  const onHudUpdateRef = useRef((snapshot: SceneHudSnapshot) => {
    setHud(snapshot);
  });

  // Mount Three.js WebGL scene once in an isolated ref container
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const params = new URLSearchParams(window.location.search);
    const initialBuilt = params.get('built') === '1' || params.get('autostart') === '1';

    const sprinklerParam = params.get('sprinkler');
    const sprinklerOverride: 'auto' | 'on' | 'off' =
      sprinklerParam === 'on' || sprinklerParam === 'off' ? sprinklerParam : 'auto';
    const initialView = params.get('view') ?? undefined;

    let controller: TajSceneController | null = null;
    try {
      controller = new TajSceneController({
        container: mountEl,
        initialBuilt,
        sprinklerOverride,
        initialView,
        onHudUpdate: (snapshot) => onHudUpdateRef.current(snapshot),
      });
      controllerRef.current = controller;
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : 'WebGL is unavailable in this browser.');
    }

    return () => {
      controller?.dispose();
      controllerRef.current = null;
    };
  }, []);

  // Optional keyboard shortcut: R to replay the <10s construction animation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        controllerRef.current?.replayBuild();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const buildStateAttr = hud.isBuilding
    ? 'building'
    : hud.buildTime >= TOTAL_BUILD_DURATION
      ? 'complete'
      : 'paused';

  return (
    <main
      className="relative h-screen w-screen overflow-hidden bg-[#5b8ec9]"
      data-build-state={buildStateAttr}
      data-camera={hud.cameraPreset}
      data-camera-mode={hud.cameraMode}
      data-lighting={hud.lightingPreset}
      data-sprinklers={hud.sprinklersActive ? 'spraying' : 'calm'}
      data-breeze={hud.breezeEnabled ? 'on' : 'off'}
    >
      {/* Pure full-bleed 3D WebGL viewport (zero UI overlays) */}
      <div
        ref={canvasMountRef}
        data-testid="taj-webgl-canvas"
        className="h-full w-full cursor-grab active:cursor-grabbing"
      />

      {/* Graceful WebGL fallback only if WebGL fails */}
      {(webglError || hud.contextLost) && (
        <div
          role="alert"
          className="fixed inset-0 z-30 flex items-center justify-center bg-[#122036]/92 p-6 text-center text-[#f5f2ea]"
        >
          <div className="max-w-md rounded-2xl border border-white/15 bg-[#192840] p-6 shadow-2xl">
            <h2 className="font-display text-2xl font-semibold">3D Viewport Unavailable</h2>
            <p className="mt-2 text-sm text-[#c8d4e5]">
              {webglError || 'The WebGL rendering context was interrupted. Refresh or restore graphics acceleration to view the 3D Taj Mahal.'}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
