import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  computeRiseTransform,
  computeTreeBreezeSway,
  easeOutBackSubtle,
  evaluateBuildStages,
  getActiveBuildLabel,
  getStageLinearProgress,
  getSubStageProgress,
} from './animation';
import {
  BUILD_STAGES,
  CAMERA_PRESETS,
  LIGHTING_PRESETS,
  TAJ_DIMS,
  TOTAL_BUILD_DURATION,
  type CameraControlMode,
  type CameraPresetId,
  type LightingPresetId,
} from './config';
import {
  buildFlyingBirds,
  buildFountainSprinklers,
  type FlyingBirdsHandles,
  type FountainSprinklersHandles,
} from './geometry/birdsAndSprinklers';
import { buildGardenEnvironment, type GardenEnvironmentHandles } from './geometry/gardenEnvironment';
import { buildSkyAndClouds, generateSkyEnvMap, type SkyAndCloudsHandles } from './geometry/skyAndClouds';
import { buildTajMahalStructure, type TajStructureHandles } from './geometry/tajStructure';
import { createTajMaterials, type TajMaterialLibrary } from './materials';
import {
  clampFirstPersonPosition,
  computeCinematicParallax,
  computeLookAngles,
  computeWalkBobOffset,
  getGroundHeightAt,
  HUMAN_EYE_HEIGHT,
  RUN_SPEED_MPS,
  WALK_SPEED_MPS,
} from './navigation';
import {
  PlanarWaterReflector,
  TajPostProcessingPipeline,
  type PerformanceTier,
} from './postprocessing';
import { createProceduralTextures, type ProceduralTextureSet } from './textures';

export interface SceneHudSnapshot {
  buildTime: number;
  buildProgress: number;
  isBuilding: boolean;
  stageLabel: string;
  cameraPreset: CameraPresetId;
  cameraMode: CameraControlMode;
  lightingPreset: LightingPresetId;
  sprinklersActive: boolean;
  breezeEnabled: boolean;
  contextLost: boolean;
}

export interface TajSceneOptions {
  container: HTMLElement;
  initialBuilt?: boolean;
  sprinklerOverride?: 'auto' | 'on' | 'off';
  initialView?: string;
  onHudUpdate: (snapshot: SceneHudSnapshot) => void;
}

function detectSoftwareGl(): boolean {
  const probeCanvas = document.createElement('canvas');
  const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param) ?? '');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
}

function detectPerformanceTier(isSoftwareGl: boolean): PerformanceTier {
  if (isSoftwareGl) return 'software';
  const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const lowCores = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4;
  const narrowViewport = Math.min(window.innerWidth, window.innerHeight) < 700;
  return coarsePointer || mobileUa || lowCores || narrowViewport ? 'mobile' : 'desktop';
}

function getCappedPixelRatio(tier: PerformanceTier): number {
  if (tier === 'software') return 1;
  if (tier === 'mobile') return Math.min(window.devicePixelRatio || 1, 1.5);
  // True native 4K (3840x2160 on 2x HiDPI 1080p / native 4K monitors) without accidentally pushing 6K+ at 120Hz
  return Math.min(window.devicePixelRatio || 1, 2.0);
}

// Module-scope reusable scratch objects (zero GC allocations inside render loop)
const _targetPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();
const _sunPosScratch = new THREE.Vector3();
const _forwardXZ = new THREE.Vector3();
const _rightXZ = new THREE.Vector3();

function shortestAngleDiff(from: number, to: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export class TajSceneController {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private envRT: THREE.WebGLRenderTarget;
  private planarReflector: PlanarWaterReflector;
  private postProcessing: TajPostProcessingPipeline;

  private textures: ProceduralTextureSet;
  private materials: TajMaterialLibrary;
  private taj: TajStructureHandles;
  private garden: GardenEnvironmentHandles;
  private sky: SkyAndCloudsHandles;
  private birds: FlyingBirdsHandles;
  private sprinklers: FountainSprinklersHandles;

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private fillLight: THREE.DirectionalLight;
  private sanctuaryLantern: THREE.PointLight;
  private fog: THREE.FogExp2;

  private isSoftwareGl: boolean;
  private performanceTier: PerformanceTier;
  private nonReflectedObjects: THREE.Object3D[] = [];
  private smoothedRawDt = 1 / 60;
  private frameCounter = 0;
  private frameId = 0;
  private disposed = false;
  private contextLost = false;
  private onHudUpdate: (snapshot: SceneHudSnapshot) => void;

  // Dynamic simulation state
  private lastNow = 0;
  private worldElapsed = 0;
  private buildStartWallTime = 0;
  private buildElapsed = 0;
  private isBuilding = true;
  private breezeEnabled = true;
  private breezeStrength = 1.0;

  // Intermittent fountain sprinkler state
  private sprinklerOverride: 'auto' | 'on' | 'off' = 'auto';
  private sprinklersActive = true;

  // Camera & First-Person POV state
  private activeCameraPreset: CameraPresetId = 'pov_garden';
  private cameraMode: CameraControlMode = 'pov';
  private activeLightingPreset: LightingPresetId = 'golden';
  private cameraTransitionActive = false;
  private targetCamPos = new THREE.Vector3(...CAMERA_PRESETS[0].position);
  private targetCamLook = new THREE.Vector3(...CAMERA_PRESETS[0].target);
  private targetFov: number = CAMERA_PRESETS[0].fov;

  // First-person eye orientation, walkable base position, & subtle landing-page mouse-parallax
  private povYaw = 0;
  private povPitch = 0;
  private targetPovYaw = 0;
  private targetPovPitch = 0;
  private basePovX = CAMERA_PRESETS[0].position[0];
  private basePovZ = CAMERA_PRESETS[0].position[2];
  private povGroundY = CAMERA_PRESETS[0].position[1];
  private lockInitialEyeHeight = false;
  private parallaxEnabled = true;
  private mouseNormX = 0;
  private mouseNormY = 0;
  private smoothMouseX = 0;
  private smoothMouseY = 0;
  private parallaxBlend = 1.0;
  private walkPhase = 0;
  private walkBlend = 0;
  private isDraggingLook = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private activePointerId: number | null = null;
  private pressedKeys = new Set<string>();

  // Throttled HUD reporting (<= 10Hz)
  private lastHudPushTime = 0;

  // Stored base Y positions of Taj components for smooth rise animations
  private basePlinthY: number;
  private baseMausoleumY: number;
  private baseMinaretY: number;
  private baseChhatriY: number;
  private baseDrumY: number;
  private baseDomeY: number;
  private baseFinialY: number;

  // Bound event listeners
  private handleResizeBound: () => void;
  private handleContextLostBound: (e: Event) => void;
  private handleContextRestoredBound: () => void;
  private handlePointerDownBound: (e: PointerEvent) => void;
  private handlePointerMoveBound: (e: PointerEvent) => void;
  private handlePointerUpBound: (e: PointerEvent) => void;
  private handleKeyDownBound: (e: KeyboardEvent) => void;
  private handleKeyUpBound: (e: KeyboardEvent) => void;
  private handleBlurBound: () => void;

  constructor(options: TajSceneOptions) {
    this.container = options.container;
    this.onHudUpdate = options.onHudUpdate;
    this.isSoftwareGl = detectSoftwareGl();
    this.performanceTier = detectPerformanceTier(this.isSoftwareGl);

    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);

    const pixelRatio = getCappedPixelRatio(this.performanceTier);
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // Handled crisply by EffectComposer MSAA + SMAA/FXAA
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = LIGHTING_PRESETS.golden.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Smart shadow caching: render 4096x4096 shadows on demand (during build, lighting change, and 15Hz tree-sway cadence)
    // instead of re-rasterizing the entire monument 120 times/second!
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    // Allow native vertical page scrolling over the full-screen background canvas
    this.renderer.domElement.style.touchAction = 'pan-y';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const initialLight = LIGHTING_PRESETS.golden;
    this.scene.background = new THREE.Color(initialLight.skyHorizon);
    this.fog = new THREE.FogExp2(initialLight.fogColor, initialLight.fogDensity);
    this.scene.fog = this.fog;

    // Real-time HDRI Environment Reflections generated directly from the golden-hour Rayleigh/Mie sky
    this.envRT = generateSkyEnvMap(this.renderer, initialLight);
    this.scene.environment = this.envRT.texture;

    // Initialize camera at First-Person POV eye level on the central Charbagh marble platform
    // (Optional ?view=sprinkler or ?view=plinth positions close-up inspection views)
    const initialCam = CAMERA_PRESETS[0];
    const isSprinklerCloseup = options.initialView === 'sprinkler';
    const isPlinthCloseup = options.initialView === 'plinth';
    const plinthPreset = CAMERA_PRESETS.find((p) => p.id === 'pov_plinth');
    const startPos: [number, number, number] = isSprinklerCloseup
      ? [1.58, 1.32, 96.45]
      : isPlinthCloseup && plinthPreset
        ? plinthPreset.position
        : initialCam.position;
    const startTarget: [number, number, number] = isSprinklerCloseup
      ? [0, 0.84, 92.8]
      : isPlinthCloseup && plinthPreset
        ? plinthPreset.target
        : initialCam.target;
    const startFov = isSprinklerCloseup ? 46 : isPlinthCloseup && plinthPreset ? plinthPreset.fov : initialCam.fov;

    this.camera = new THREE.PerspectiveCamera(startFov, width / height, 0.2, 1100);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(...startPos);
    this.targetFov = startFov;

    const initialAngles = computeLookAngles(startPos, startTarget);
    this.povYaw = initialAngles.yaw;
    this.povPitch = initialAngles.pitch;
    this.targetPovYaw = initialAngles.yaw;
    this.targetPovPitch = initialAngles.pitch;
    this.basePovX = startPos[0];
    this.basePovZ = startPos[2];
    this.povGroundY = startPos[1];
    this.lockInitialEyeHeight = isSprinklerCloseup || isPlinthCloseup;
    this.parallaxEnabled = !isSprinklerCloseup && !isPlinthCloseup;
    this.parallaxBlend = this.parallaxEnabled ? 1.0 : 0.0;
    this.camera.rotation.set(this.povPitch, this.povYaw, 0, 'YXZ');

    // OrbitControls stays disabled & disconnected during First-Person POV so zero non-passive wheel listeners sit on the canvas
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...startTarget);
    this.controls.enableZoom = false;
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.492;
    this.controls.minPolarAngle = 0.14;
    this.controls.minDistance = 24;
    this.controls.maxDistance = 195;
    this.controls.enabled = initialCam.mode === 'orbit';
    if (this.controls.enabled) {
      this.controls.update();
    } else {
      this.controls.disconnect();
    }
    // Restore vertical touch scroll passthrough (OrbitControls constructor sets touchAction='none')
    this.renderer.domElement.style.touchAction = 'pan-y';

    this.controls.addEventListener('start', () => {
      this.cameraTransitionActive = false;
    });

    // Physically accurate Golden-Hour Sun Light with crisp 4096px PCF soft shadows & tight monument frustum
    const shadowSize =
      this.performanceTier === 'desktop' ? 4096 : this.performanceTier === 'mobile' ? 2048 : 1024;
    this.sunLight = new THREE.DirectionalLight(initialLight.sunColor, initialLight.sunIntensity);
    this.sunLight.position.set(...initialLight.sunDirection);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.shadow.camera.near = 14;
    this.sunLight.shadow.camera.far = 240;
    const d = 66;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.025;
    this.sunLight.shadow.radius = 2.0;
    this.scene.add(this.sunLight);

    this.hemiLight = new THREE.HemisphereLight(
      initialLight.hemiSkyColor,
      initialLight.hemiGroundColor,
      initialLight.hemiIntensity,
    );
    this.scene.add(this.hemiLight);

    this.fillLight = new THREE.DirectionalLight(initialLight.fillColor, initialLight.fillIntensity);
    this.fillLight.position.set(-64, 34, -48);
    this.scene.add(this.fillLight);

    // Gentle recessed sanctuary interior oil-lamp warmth (subtle so doorway marble & muqarnas never blow out)
    this.sanctuaryLantern = new THREE.PointLight('#ffbd76', 0.55, 16, 2.0);
    this.sanctuaryLantern.position.set(0, TAJ_DIMS.plinthTopY + 3.6, TAJ_DIMS.mausoleumW * 0.5 - 1.48);
    this.scene.add(this.sanctuaryLantern);

    // Procedural Ultra-HD 2048px PBR Textures & Materials with full max anisotropy
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso, this.performanceTier);
    this.materials = createTajMaterials(this.textures);

    // Build 3D World (Sky + Clouds + Stars/Moon, Gardens + Yamuna, Taj Mahal, Flying Birds, Intermittent Sprinklers)
    this.sky = buildSkyAndClouds(this.textures, initialLight);
    this.garden = buildGardenEnvironment(this.materials, this.performanceTier);
    this.taj = buildTajMahalStructure(this.materials);
    this.birds = buildFlyingBirds();
    this.sprinklers = buildFountainSprinklers();

    this.scene.add(this.sky.root, this.garden.root, this.taj.root, this.birds.root, this.sprinklers.root);

    // Hide invisible ground micro-detail & water-surface particles during planar reflection pass
    this.nonReflectedObjects = [
      ...this.garden.nonReflectedObjects,
      this.sky.dustMotes,
      ...this.sprinklers.surfaceSplashObjects,
    ];

    // Real-time Planar Water Reflector & AAA EffectComposer Post-Processing Pipeline
    this.planarReflector = new PlanarWaterReflector(this.performanceTier);
    this.postProcessing = new TajPostProcessingPipeline(
      this.renderer,
      this.scene,
      this.camera,
      width,
      height,
      pixelRatio,
      this.performanceTier,
    );
    if (isSprinklerCloseup) {
      this.postProcessing.setDofEnabled(false);
    }

    // Record resting Y positions for build animation transforms
    this.basePlinthY = this.taj.plinthGroup.position.y;
    this.baseMausoleumY = this.taj.mausoleumGroup.position.y;
    this.baseMinaretY = TAJ_DIMS.plinthTopY;
    this.baseChhatriY = TAJ_DIMS.plinthTopY + TAJ_DIMS.mausoleumH;
    this.baseDrumY = this.taj.drumGroup.position.y;
    this.baseDomeY = this.taj.domeGroup.position.y;
    this.baseFinialY = this.taj.finialGroup.position.y;

    // Initial sprinkler override (optional)
    if (options.sprinklerOverride) {
      this.sprinklerOverride = options.sprinklerOverride;
    }

    // Initial build state
    const startNow = performance.now();
    this.lastNow = startNow;
    if (options.initialBuilt) {
      this.buildElapsed = TOTAL_BUILD_DURATION;
      this.buildStartWallTime = startNow - TOTAL_BUILD_DURATION * 1000;
      this.isBuilding = false;
    } else {
      this.buildElapsed = 0;
      this.buildStartWallTime = startNow;
      this.isBuilding = true;
    }
    this.applyBuildAnimation(this.buildElapsed);
    this.setLightingPreset('golden', false);
    const initSpray = this.sprinklers.update(
      2.6,
      Math.min(1, this.buildElapsed / TOTAL_BUILD_DURATION),
      this.breezeStrength,
      this.sprinklerOverride,
    );
    this.sprinklersActive = initSpray > 0.12;
    this.materials.water.uniforms.uSprinklerIntensity.value = initSpray;

    // Pre-warm shaders on GPU devices (skip on software WebGL)
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Event bindings (window + canvas pointer/keyboard for seamless First-Person POV)
    this.handleResizeBound = this.handleResize.bind(this);
    this.handleContextLostBound = (event: Event) => {
      event.preventDefault();
      this.contextLost = true;
      this.pushHudState(true);
    };
    this.handleContextRestoredBound = () => {
      this.contextLost = false;
      this.pushHudState(true);
    };
    this.handlePointerDownBound = this.handlePointerDown.bind(this);
    this.handlePointerMoveBound = this.handlePointerMove.bind(this);
    this.handlePointerUpBound = this.handlePointerUp.bind(this);
    this.handleKeyDownBound = this.handleKeyDown.bind(this);
    this.handleKeyUpBound = this.handleKeyUp.bind(this);
    this.handleBlurBound = () => {
      this.pressedKeys.clear();
      this.isDraggingLook = false;
      this.activePointerId = null;
      this.mouseNormX = 0;
      this.mouseNormY = 0;
    };

    const dom = this.renderer.domElement;
    window.addEventListener('resize', this.handleResizeBound);
    window.addEventListener('keydown', this.handleKeyDownBound);
    window.addEventListener('keyup', this.handleKeyUpBound);
    window.addEventListener('blur', this.handleBlurBound);
    dom.addEventListener('pointerdown', this.handlePointerDownBound);
    window.addEventListener('pointermove', this.handlePointerMoveBound);
    window.addEventListener('pointerup', this.handlePointerUpBound);
    window.addEventListener('pointercancel', this.handlePointerUpBound);
    dom.addEventListener('webglcontextlost', this.handleContextLostBound);
    dom.addEventListener('webglcontextrestored', this.handleContextRestoredBound);

    this.pushHudState(true);
    this.lastNow = performance.now();
    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(this.tick, 16);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.cameraMode !== 'pov' || e.button !== 0) return;
    this.cameraTransitionActive = false;
    this.isDraggingLook = true;
    this.activePointerId = e.pointerId;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  }

  private handlePointerMove(e: PointerEvent): void {
    // Always track normalized pointer coordinates for subtle interactive landing-page parallax
    if (e.pointerType !== 'touch') {
      const rect = this.container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.mouseNormX = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
        this.mouseNormY = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
      }
    }

    if (!this.isDraggingLook || this.cameraMode !== 'pov') return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    const sensitivity = 0.0042;
    this.targetPovYaw -= dx * sensitivity;
    this.targetPovPitch = Math.max(-1.05, Math.min(1.25, this.targetPovPitch - dy * sensitivity));
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
    this.isDraggingLook = false;
    this.activePointerId = null;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const code = e.code;
    if (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'ShiftLeft' ||
      code === 'ShiftRight'
    ) {
      if (this.cameraMode === 'pov') {
        this.cameraTransitionActive = false;
      }
      this.pressedKeys.add(code);
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.pressedKeys.delete(e.code);
  }

  public replayBuild(): void {
    this.buildElapsed = 0;
    this.buildStartWallTime = performance.now();
    this.isBuilding = true;
    this.applyBuildAnimation(0);
    this.pushHudState(true);
  }

  public setBuildProgress(normalized: number): void {
    const clamped = Math.max(0, Math.min(1, normalized));
    this.buildElapsed = clamped * TOTAL_BUILD_DURATION;
    this.buildStartWallTime = performance.now() - this.buildElapsed * 1000;
    this.isBuilding = clamped < 0.999;
    this.applyBuildAnimation(this.buildElapsed);
    this.pushHudState(true);
  }

  public completeBuildImmediately(): void {
    this.buildElapsed = TOTAL_BUILD_DURATION;
    this.isBuilding = false;
    this.applyBuildAnimation(this.buildElapsed);
    this.pushHudState(true);
  }

  public setCameraPreset(presetId: CameraPresetId): void {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.activeCameraPreset = presetId;
    this.cameraMode = preset.mode;
    this.targetCamPos.set(...preset.position);
    this.targetCamLook.set(...preset.target);
    this.targetFov = preset.fov;

    if (preset.mode === 'pov') {
      this.controls.enabled = false;
      this.controls.disconnect();
      this.renderer.domElement.style.touchAction = 'pan-y';
      const angles = computeLookAngles(preset.position, preset.target);
      this.povYaw = angles.yaw;
      this.povPitch = angles.pitch;
      this.targetPovYaw = angles.yaw;
      this.targetPovPitch = angles.pitch;
      this.basePovX = preset.position[0];
      this.basePovZ = preset.position[2];
      this.povGroundY = preset.position[1];
      this.camera.position.copy(this.targetCamPos);
      this.camera.fov = this.targetFov;
      this.camera.rotation.set(this.povPitch, this.povYaw, 0, 'YXZ');
      this.camera.updateProjectionMatrix();
      this.cameraTransitionActive = false;
    } else {
      this.controls.connect(this.renderer.domElement);
      this.controls.enabled = true;
      this.renderer.domElement.style.touchAction = 'pan-y';
      if (this.isSoftwareGl) {
        this.camera.position.copy(this.targetCamPos);
        this.controls.target.copy(this.targetCamLook);
        this.camera.fov = this.targetFov;
        this.camera.updateProjectionMatrix();
        this.controls.update();
        this.cameraTransitionActive = false;
      } else {
        this.cameraTransitionActive = true;
      }
    }

    this.pushHudState(true);
  }

  public setLightingPreset(presetId: LightingPresetId, rebuildEnv = true): void {
    const preset = LIGHTING_PRESETS[presetId];
    if (!preset) return;
    this.activeLightingPreset = presetId;

    this.sunLight.color.set(preset.sunColor);
    this.sunLight.intensity = preset.sunIntensity;
    this.sunLight.position.set(...preset.sunDirection);

    this.hemiLight.color.set(preset.hemiSkyColor);
    this.hemiLight.groundColor.set(preset.hemiGroundColor);
    this.hemiLight.intensity = preset.hemiIntensity;

    this.fillLight.color.set(preset.fillColor);
    this.fillLight.intensity = preset.fillIntensity;

    const nightFactor = presetId === 'moonlight' ? 1.0 : 0.0;
    this.sanctuaryLantern.intensity = presetId === 'moonlight' ? 7.5 : presetId === 'golden' ? 0.55 : 0.0;

    this.fog.color.set(preset.fogColor);
    this.fog.density = preset.fogDensity;
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.set(preset.skyHorizon);
    } else {
      this.scene.background = new THREE.Color(preset.skyHorizon);
    }
    this.renderer.toneMappingExposure = preset.exposure;
    this.postProcessing.setExposure(preset.exposure);
    this.renderer.shadowMap.needsUpdate = true;

    if (rebuildEnv) {
      const nextEnv = generateSkyEnvMap(this.renderer, preset);
      this.scene.environment = nextEnv.texture;
      this.envRT.dispose();
      this.envRT = nextEnv;
    }

    _sunPosScratch.set(...preset.sunDirection).normalize();

    this.sky.applyLighting(preset);
    this.birds.applyTint(preset.sunColor, nightFactor, _sunPosScratch, preset.fogColor, preset.fogDensity);
    this.sprinklers.applyTint(preset.sunColor, preset.skyHorizon, nightFactor, _sunPosScratch);
    this.postProcessing.setLightingMode(presetId);

    this.materials.updateSunUniforms(_sunPosScratch, new THREE.Color(preset.sunColor));

    // Sync reflecting pool water lighting & distance haze uniforms
    const waterUniforms = this.materials.water.uniforms;
    waterUniforms.uSkyColor.value.set(preset.waterSkyTint);
    waterUniforms.uHorizonColor.value.set(preset.skyHorizon);
    waterUniforms.uSunColor.value.set(preset.sunColor);
    waterUniforms.uSunDir.value.copy(_sunPosScratch);
    waterUniforms.uFogColor.value.set(preset.fogColor);
    waterUniforms.uFogDensity.value = preset.fogDensity;

    // Sync Yamuna River water lighting uniforms
    const riverUniforms = this.materials.yamunaRiver.uniforms;
    riverUniforms.uSkyTop.value.set(preset.skyTop);
    riverUniforms.uSkyHorizon.value.set(preset.skyHorizon);
    riverUniforms.uRiverDeep.value.set(preset.riverDeepColor);
    riverUniforms.uRiverShallow.value.set(preset.riverShallowColor);
    riverUniforms.uSunColor.value.set(preset.sunColor);
    riverUniforms.uSunDir.value.copy(_sunPosScratch);
    riverUniforms.uFogColor.value.set(preset.fogColor);

    this.pushHudState(true);
  }

  public setBreezeEnabled(enabled: boolean): void {
    this.breezeEnabled = enabled;
    this.pushHudState(true);
  }

  private applyBuildAnimation(elapsedSec: number): void {
    const eased = evaluateBuildStages(elapsedSec);
    const gardenLinear = getStageLinearProgress(BUILD_STAGES[0], elapsedSec);
    const minaretsLinear = getStageLinearProgress(BUILD_STAGES[3], elapsedSec);
    const chhatrisLinear = getStageLinearProgress(BUILD_STAGES[4], elapsedSec);
    const domeLinear = getStageLinearProgress(BUILD_STAGES[5], elapsedSec);

    // Stage 1: Lower sandstone terrace, reflecting pool, & Charbagh trees
    const poolTransform = computeRiseTransform(eased.garden, 1.4, true);
    this.garden.terraceAndPoolGroup.visible = poolTransform.visible;
    this.garden.terraceAndPoolGroup.position.y = poolTransform.offsetY;
    this.garden.terraceAndPoolGroup.scale.set(1, poolTransform.scaleY, 1);

    const treeCount = this.garden.swayingTrees.length;
    for (let i = 0; i < treeCount; i += 1) {
      const t = this.garden.swayingTrees[i];
      const p = getSubStageProgress(gardenLinear, i % 8, 8, 0.55);
      t.group.visible = p > 0.005;
      const s = p > 0.005 ? easeOutBackSubtle(p) : 0.001;
      t.baseScale = Math.max(0.001, s);
      t.group.scale.set(t.baseScale, t.baseScale, t.baseScale);
    }
    this.garden.treesGroup.visible = gardenLinear > 0.01;

    // Stage 2: White Makrana Marble Plinth
    const plinthT = computeRiseTransform(eased.plinth, 4.8, true);
    this.taj.plinthGroup.visible = plinthT.visible;
    this.taj.plinthGroup.position.y = this.basePlinthY + plinthT.offsetY;
    this.taj.plinthGroup.scale.set(plinthT.scaleXZ, plinthT.scaleY, plinthT.scaleXZ);

    // Stage 3: Central Mausoleum & Great Pishtaqs
    const mausT = computeRiseTransform(eased.mausoleum, 9.5, true);
    this.taj.mausoleumGroup.visible = mausT.visible;
    this.taj.mausoleumGroup.position.y = this.baseMausoleumY + mausT.offsetY;
    this.taj.mausoleumGroup.scale.set(mausT.scaleXZ, mausT.scaleY, mausT.scaleXZ);

    // Stage 4: Four Corner Minarets (staggered symmetrical ascent)
    this.taj.minaretGroups.forEach((minaret, idx) => {
      const p = getSubStageProgress(minaretsLinear, idx, 4, 0.65);
      const t = computeRiseTransform(p, 11.0, true);
      minaret.visible = t.visible;
      minaret.position.y = this.baseMinaretY + t.offsetY;
      minaret.scale.set(t.scaleXZ, t.scaleY, t.scaleXZ);
    });

    // Stage 5: Four Roof Chhatris & Central Drum
    this.taj.chhatriGroups.forEach((chhatri, idx) => {
      const p = getSubStageProgress(chhatrisLinear, idx, 4, 0.6);
      const t = computeRiseTransform(p, 5.5, true);
      chhatri.visible = t.visible;
      chhatri.position.y = this.baseChhatriY + t.offsetY;
      chhatri.scale.set(t.scaleXZ, t.scaleY, t.scaleXZ);
    });

    const drumT = computeRiseTransform(eased.chhatris, 5.0, true);
    this.taj.drumGroup.visible = drumT.visible;
    this.taj.drumGroup.position.y = this.baseDrumY + drumT.offsetY;
    this.taj.drumGroup.scale.set(drumT.scaleXZ, drumT.scaleY, drumT.scaleXZ);

    // Stage 6: Grand Onion Dome & Kalasha Finial
    const domeProgress = getSubStageProgress(domeLinear, 0, 2, 0.72);
    const domeT = computeRiseTransform(domeProgress, 7.5, true);
    this.taj.domeGroup.visible = domeT.visible;
    this.taj.domeGroup.position.y = this.baseDomeY + domeT.offsetY;
    this.taj.domeGroup.scale.set(domeT.scaleXZ, domeT.scaleY, domeT.scaleXZ);

    const finialProgress = getSubStageProgress(domeLinear, 1, 2, 0.58);
    const finialT = computeRiseTransform(finialProgress, 4.5, false);
    this.taj.finialGroup.visible = finialT.visible;
    this.taj.finialGroup.position.y = this.baseFinialY + finialT.offsetY;
    this.taj.finialGroup.scale.set(finialT.scaleXZ, finialT.scaleY, finialT.scaleXZ);

    // Sync reflected Taj silhouette opacity in water pool
    this.materials.water.uniforms.uBuildProgress.value = Math.min(1, elapsedSec / TOTAL_BUILD_DURATION);
  }

  private updateLivingEnvironment(dt: number): void {
    const targetBreeze = this.breezeEnabled ? 1.0 : 0.0;
    this.breezeStrength = THREE.MathUtils.damp(this.breezeStrength, targetBreeze, 4.0, dt);

    // Update slow-drifting cloud shadows & GPU wind-swaying 3D foreground grass blades
    this.materials.updateEnvironmentTime(this.worldElapsed, this.breezeStrength);

    // Move volumetric clouds, diagonal sunbeams & drifting ground mist continuously
    this.sky.update(this.worldElapsed, this.breezeStrength);

    // Gently drift fallen leaves & flower petals across the reflecting pool surface
    this.garden.updateFloatingClutter(this.worldElapsed, this.breezeStrength);

    // Animate soaring & flapping birds around the Taj Mahal, pool, and Yamuna River
    this.birds.update(this.worldElapsed + 2.4);

    // Animate intermittent fountain sprinklers (alternating between spraying jets/droplets and calm mirror)
    const buildNorm = Math.min(1, this.buildElapsed / TOTAL_BUILD_DURATION);
    const sprayIntensity = this.sprinklers.update(
      this.worldElapsed + 2.6,
      buildNorm,
      this.breezeStrength,
      this.sprinklerOverride,
    );
    const nextSprinklersActive = sprayIntensity > 0.12;
    const sprinklerChanged = nextSprinklersActive !== this.sprinklersActive;
    this.sprinklersActive = nextSprinklersActive;
    this.materials.water.uniforms.uSprinklerIntensity.value = sprayIntensity;

    // Gentle travelling breeze wave across every cypress, shade tree, and far riverbank tree (preserving organic lean)
    // Pace distant far-riverbank trees at half-rate on 120Hz displays (imperceptible at >100m, saves CPU matrix math)
    const updateFarTrees = (this.frameCounter & 1) === 0;
    const swaying = this.garden.swayingTrees;
    for (let i = 0; i < swaying.length; i += 1) {
      const item = swaying[i];
      if (!item.group.visible) continue;
      if (!updateFarTrees && item.worldZ < -46) continue;
      const angles = computeTreeBreezeSway(
        item.worldX,
        item.worldZ,
        this.worldElapsed,
        this.breezeStrength,
        item.heightFactor,
      );
      item.group.rotation.x = item.baseLeanX + angles.rotX;
      item.group.rotation.z = item.baseLeanZ + angles.rotZ;
    }

    // Animate breeze ripples on the reflecting pool and flowing current on the Yamuna River
    this.materials.water.uniforms.uTime.value = this.worldElapsed;
    this.materials.water.uniforms.uBreeze.value = this.breezeStrength;
    this.materials.yamunaRiver.uniforms.uTime.value = this.worldElapsed;
    this.materials.yamunaRiver.uniforms.uBreeze.value = this.breezeStrength;

    if (sprinklerChanged && !this.isBuilding) {
      this.pushHudState(true);
    }
  }

  private updateFirstPersonController(dt: number): void {
    // Smoothly damp look orientation & visual zoom FOV
    const lookAlpha = 1 - Math.exp(-12.0 * dt);
    this.povYaw += shortestAngleDiff(this.povYaw, this.targetPovYaw) * lookAlpha;
    this.povPitch = THREE.MathUtils.lerp(this.povPitch, this.targetPovPitch, lookAlpha);

    if (Math.abs(this.camera.fov - this.targetFov) > 0.02) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetFov, 1 - Math.exp(-9.0 * dt));
      this.camera.updateProjectionMatrix();
    }

    // WASD / Arrow walking locomotion along viewer gaze direction
    const forwardInput =
      (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp') ? 1 : 0) -
      (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown') ? 1 : 0);
    const strafeInput =
      (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight') ? 1 : 0) -
      (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft') ? 1 : 0);

    const isMoving = forwardInput !== 0 || strafeInput !== 0;
    if (isMoving) {
      const speed =
        this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight')
          ? RUN_SPEED_MPS
          : WALK_SPEED_MPS;
      _forwardXZ.set(-Math.sin(this.povYaw), 0, -Math.cos(this.povYaw));
      _rightXZ.set(Math.cos(this.povYaw), 0, -Math.sin(this.povYaw));

      let moveX = _forwardXZ.x * forwardInput + _rightXZ.x * strafeInput;
      let moveZ = _forwardXZ.z * forwardInput + _rightXZ.z * strafeInput;
      const len = Math.hypot(moveX, moveZ);
      if (len > 0.0001) {
        moveX = (moveX / len) * speed * dt;
        moveZ = (moveZ / len) * speed * dt;
      }

      const clamped = clampFirstPersonPosition(
        this.basePovX + moveX,
        this.basePovZ + moveZ,
      );
      this.basePovX = clamped.x;
      this.basePovZ = clamped.z;
      this.walkPhase += dt * (speed > WALK_SPEED_MPS ? 11.5 : 8.2);
    }

    this.walkBlend = THREE.MathUtils.damp(this.walkBlend, isMoving ? 1 : 0, 8.0, dt);

    // Smooth eye-level ground elevation stepping (garden -> terrace -> marble plinth)
    if (isMoving) {
      this.lockInitialEyeHeight = false;
    }
    if (!this.lockInitialEyeHeight) {
      const desiredEyeY = getGroundHeightAt(this.basePovX, this.basePovZ) + HUMAN_EYE_HEIGHT;
      this.povGroundY = THREE.MathUtils.damp(this.povGroundY, desiredEyeY, 8.5, dt);
    }

    // Subtle award-winning mouse-parallax + slow ambient breathing drift when admiring the vista
    const wantParallax = this.parallaxEnabled && !this.isDraggingLook && !isMoving ? 1.0 : 0.0;
    this.parallaxBlend = THREE.MathUtils.damp(this.parallaxBlend, wantParallax, 3.2, dt);
    this.smoothMouseX = THREE.MathUtils.damp(this.smoothMouseX, this.mouseNormX, 3.8, dt);
    this.smoothMouseY = THREE.MathUtils.damp(this.smoothMouseY, this.mouseNormY, 3.8, dt);
    const parallax = computeCinematicParallax(
      this.smoothMouseX,
      this.smoothMouseY,
      this.worldElapsed,
      this.parallaxBlend,
    );

    const cosYaw = Math.cos(this.povYaw);
    const sinYaw = Math.sin(this.povYaw);
    this.camera.position.set(
      this.basePovX + cosYaw * parallax.posOffsetX,
      this.povGroundY + computeWalkBobOffset(this.walkPhase, this.walkBlend) + parallax.posOffsetY,
      this.basePovZ - sinYaw * parallax.posOffsetX,
    );

    this.camera.rotation.set(
      this.povPitch + parallax.pitchOffset,
      this.povYaw + parallax.yawOffset,
      0,
      'YXZ',
    );
  }

  private updateCameraTransition(dt: number): void {
    if (!this.cameraTransitionActive) return;

    const lambda = 4.8;
    const alpha = 1 - Math.exp(-lambda * dt);

    this.camera.position.lerp(this.targetCamPos, alpha);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetFov, alpha);
    this.camera.updateProjectionMatrix();

    if (this.cameraMode === 'pov') {
      this.povYaw += shortestAngleDiff(this.povYaw, this.targetPovYaw) * alpha;
      this.povPitch = THREE.MathUtils.lerp(this.povPitch, this.targetPovPitch, alpha);
      this.povGroundY = this.camera.position.y;
      this.camera.rotation.set(this.povPitch, this.povYaw, 0, 'YXZ');

      _targetPos.copy(this.camera.position).sub(this.targetCamPos);
      if (
        _targetPos.lengthSq() < 0.02 &&
        Math.abs(shortestAngleDiff(this.povYaw, this.targetPovYaw)) < 0.005 &&
        Math.abs(this.povPitch - this.targetPovPitch) < 0.005 &&
        Math.abs(this.camera.fov - this.targetFov) < 0.05
      ) {
        this.camera.position.copy(this.targetCamPos);
        this.povYaw = this.targetPovYaw;
        this.povPitch = this.targetPovPitch;
        this.povGroundY = this.targetCamPos.y;
        this.camera.fov = this.targetFov;
        this.camera.rotation.set(this.povPitch, this.povYaw, 0, 'YXZ');
        this.camera.updateProjectionMatrix();
        this.cameraTransitionActive = false;
      }
      return;
    }

    // Orbit mode smooth transition
    this.controls.target.lerp(this.targetCamLook, alpha);
    _targetPos.copy(this.camera.position).sub(this.targetCamPos);
    _targetLook.copy(this.controls.target).sub(this.targetCamLook);

    if (_targetPos.lengthSq() < 0.02 && _targetLook.lengthSq() < 0.02 && Math.abs(this.camera.fov - this.targetFov) < 0.05) {
      this.camera.position.copy(this.targetCamPos);
      this.controls.target.copy(this.targetCamLook);
      this.camera.fov = this.targetFov;
      this.camera.updateProjectionMatrix();
      this.cameraTransitionActive = false;
    }
  }

  private pushHudState(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastHudPushTime < 110) return;
    this.lastHudPushTime = now;

    this.onHudUpdate({
      buildTime: Math.min(this.buildElapsed, TOTAL_BUILD_DURATION),
      buildProgress: Math.min(1, this.buildElapsed / TOTAL_BUILD_DURATION),
      isBuilding: this.isBuilding,
      stageLabel: getActiveBuildLabel(this.buildElapsed),
      cameraPreset: this.activeCameraPreset,
      cameraMode: this.cameraMode,
      lightingPreset: this.activeLightingPreset,
      sprinklersActive: this.sprinklersActive,
      breezeEnabled: this.breezeEnabled,
      contextLost: this.contextLost,
    });
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 10);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 220);
        }
      };
      this.frameId = window.setTimeout(poll, 10);
    } else {
      this.frameId = window.setTimeout(cb, 220);
    }
  }

  private tick = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = Math.max(0.001, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.smoothedRawDt = this.smoothedRawDt * 0.9 + Math.min(rawDt, 0.05) * 0.1;
    const clampedDt = Math.min(rawDt, 0.25);

    this.worldElapsed += Math.min(rawDt, 1.2);

    if (this.isBuilding) {
      this.buildElapsed = Math.min(TOTAL_BUILD_DURATION, (now - this.buildStartWallTime) / 1000);
      this.applyBuildAnimation(this.buildElapsed);
      if (this.buildElapsed >= TOTAL_BUILD_DURATION) {
        this.isBuilding = false;
        this.renderer.shadowMap.needsUpdate = true;
        this.pushHudState(true);
      } else {
        this.pushHudState(false);
      }
    }

    this.updateLivingEnvironment(clampedDt);

    if (this.cameraTransitionActive) {
      this.updateCameraTransition(clampedDt);
      if (this.cameraMode === 'orbit') {
        this.controls.update();
      }
    } else if (this.cameraMode === 'pov') {
      this.updateFirstPersonController(clampedDt);
    } else {
      this.controls.update();
    }

    if (!this.contextLost) {
      this.frameCounter += 1;

      // Smart 4096x4096 shadow map update cadence:
      // - Always bake on frame 1
      // - Every 2nd frame while rising during the <10s construction animation
      // - Every 8th frame (~15Hz at 120 FPS) at rest so gentle tree-breeze shadows stay alive with 87.5% less shadow GPU cost!
      const shadowMapReady = this.sunLight.shadow.map !== null;
      if (
        !shadowMapReady ||
        (this.isBuilding && (this.frameCounter & 1) === 0) ||
        (!this.isBuilding && this.frameCounter % 8 === 0)
      ) {
        this.renderer.shadowMap.needsUpdate = true;
      }

      if (this.garden.terraceAndPoolGroup.visible) {
        // High-refresh smart reflection pacing:
        // On 120Hz displays (smoothedRawDt < 11.5ms) during gentle resting parallax, update live mirror at 60Hz (every 2nd frame),
        // and update every frame during active camera drag/movement or on 60Hz displays!
        const isHighRefresh = this.smoothedRawDt < 0.0115;
        const isFastCameraMove = this.isDraggingLook || this.pressedKeys.size > 0 || this.cameraTransitionActive;
        const shouldUpdateReflection =
          this.frameCounter === 1 ||
          !shadowMapReady ||
          isFastCameraMove ||
          (this.performanceTier === 'desktop' && !isHighRefresh) ||
          (this.performanceTier === 'software' ? this.frameCounter % 4 === 0 : (this.frameCounter & 1) === 0);

        if (shouldUpdateReflection) {
          this.planarReflector.update(
            this.renderer,
            this.scene,
            this.camera,
            this.garden.waterSurface,
            true,
            this.nonReflectedObjects,
          );
        }
      }
      this.postProcessing.render();
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const pixelRatio = getCappedPixelRatio(this.performanceTier);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(pixelRatio);
    this.postProcessing.setSize(width, height, pixelRatio);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    const dom = this.renderer.domElement;
    window.removeEventListener('resize', this.handleResizeBound);
    window.removeEventListener('keydown', this.handleKeyDownBound);
    window.removeEventListener('keyup', this.handleKeyUpBound);
    window.removeEventListener('blur', this.handleBlurBound);
    dom.removeEventListener('pointerdown', this.handlePointerDownBound);
    window.removeEventListener('pointermove', this.handlePointerMoveBound);
    window.removeEventListener('pointerup', this.handlePointerUpBound);
    window.removeEventListener('pointercancel', this.handlePointerUpBound);
    dom.removeEventListener('webglcontextlost', this.handleContextLostBound);
    dom.removeEventListener('webglcontextrestored', this.handleContextRestoredBound);

    this.controls.dispose();
    this.planarReflector.dispose();
    this.postProcessing.dispose();
    this.taj.dispose();
    this.garden.dispose();
    this.sky.dispose();
    this.birds.dispose();
    this.sprinklers.dispose();
    this.materials.dispose();
    this.textures.dispose();
    this.envRT.dispose();
    this.renderer.dispose();

    if (dom.parentNode === this.container) {
      this.container.removeChild(dom);
    }
  }
}
