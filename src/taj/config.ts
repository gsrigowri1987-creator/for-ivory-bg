export type CameraPresetId = 'pov_garden' | 'pov_plinth' | 'pov_river' | 'aerial';
export type CameraControlMode = 'pov' | 'orbit';
export type LightingPresetId = 'daylight' | 'golden' | 'moonlight';

export type BuildStageId =
  | 'garden'
  | 'plinth'
  | 'mausoleum'
  | 'minarets'
  | 'chhatris'
  | 'dome';

export interface BuildStageSpec {
  id: BuildStageId;
  label: string;
  start: number;
  end: number;
}

/** Total construction animation duration in seconds (strictly under 10s). */
export const TOTAL_BUILD_DURATION = 8.5;

export const BUILD_STAGES: readonly BuildStageSpec[] = [
  { id: 'garden', label: 'Charbagh Gardens & Yamuna Riverfront', start: 0.0, end: 1.5 },
  { id: 'plinth', label: 'Makrana Marble Plinth', start: 1.0, end: 2.7 },
  { id: 'mausoleum', label: 'Sanctuary & Great Pishtaqs', start: 2.2, end: 4.5 },
  { id: 'minarets', label: 'Four Corner Minarets', start: 3.9, end: 6.1 },
  { id: 'chhatris', label: 'Roof Chhatris & Dome Drum', start: 5.3, end: 7.2 },
  { id: 'dome', label: 'Grand Onion Dome & Kalasha Finial', start: 6.4, end: TOTAL_BUILD_DURATION },
] as const;

/** Architectural dimensions in meters (1 Three.js unit = 1 meter). */
export const TAJ_DIMS = {
  sandstoneTerraceW: 86,
  sandstoneTerraceD: 74,
  sandstoneTerraceH: 0.85,

  plinthW: 60,
  plinthD: 60,
  plinthH: 4.4,
  plinthBaseY: 0.85,
  plinthTopY: 5.25,

  mausoleumW: 31.6,
  mausoleumH: 17.6,
  mausoleumChamfer: 4.4,
  pishtaqW: 12.2,
  pishtaqH: 21.8,
  pishtaqDepth: 1.4,

  drumRadius: 6.35,
  drumHeight: 5.2,
  domeMaxRadius: 7.55,
  domeHeight: 14.2,

  minaretOffset: 27.6,
  minaretBaseRadius: 1.72,
  minaretTopRadius: 1.18,
  minaretShaftHeight: 24.4,

  chhatriOffset: 9.8,

  poolWidth: 6.2,
  poolLength: 108,
  poolStartZ: 32.5,

  riverStartZ: -44,
  riverWidth: 118,
  riverWaterY: -1.35,
} as const;

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  mode: CameraControlMode;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  {
    id: 'pov_garden',
    label: 'Garden POV',
    mode: 'pov',
    // Standing at true human eye level (~1.76m) on the central Charbagh marble platform
    // gazing down the reflecting pool & towering cypresses toward the Taj Mahal
    position: [0, 1.88, 103.5],
    target: [0, 15.6, 0],
    fov: 50,
  },
  {
    id: 'pov_plinth',
    label: 'Plinth POV',
    mode: 'pov',
    // Standing directly on the Makrana marble plinth at eye level looking up at the Pishtaq & dome
    position: [-14.5, 6.97, 25.5],
    target: [0, 19.2, 0],
    fov: 54,
  },
  {
    id: 'pov_river',
    label: 'Yamuna River',
    mode: 'pov',
    // Standing at eye level on the northeast sandstone riverfront terrace overlooking
    // the broad flowing Yamuna River, Mehtab Bagh woodland, and Taj Mahal's north facade
    position: [48, 2.75, -37.2],
    target: [-10, 8.2, -56],
    fov: 54,
  },
  {
    id: 'aerial',
    label: 'Aerial Orbit',
    mode: 'orbit',
    // Elevated sweeping vista showing the Taj Mahal, Charbagh gardens, and Yamuna River flowing behind
    position: [68, 40, 78],
    target: [0, 15, -14],
    fov: 42,
  },
] as const;

export interface LightingPreset {
  id: LightingPresetId;
  label: string;
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  sunDirection: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  hemiSkyColor: string;
  hemiGroundColor: string;
  hemiIntensity: number;
  fillColor: string;
  fillIntensity: number;
  fogColor: string;
  fogDensity: number;
  cloudTint: string;
  cloudShadowTint: string;
  exposure: number;
  waterSkyTint: string;
  riverDeepColor: string;
  riverShallowColor: string;
}

export const LIGHTING_PRESETS: Record<LightingPresetId, LightingPreset> = {
  daylight: {
    id: 'daylight',
    label: 'Clear Day',
    skyTop: '#3e72b0',
    skyMid: '#76a1d0',
    skyHorizon: '#d9e7f5',
    // Oblique sunlit angle to carve sculptural shading across dome, arches, trees, and clouds
    sunDirection: [78, 56, 36],
    sunColor: '#fff5e2',
    sunIntensity: 1.98,
    hemiSkyColor: '#8ebce8',
    hemiGroundColor: '#7a6a54',
    hemiIntensity: 0.7,
    fillColor: '#bdd6f5',
    fillIntensity: 0.3,
    fogColor: '#d4e2f0',
    fogDensity: 0.0017,
    cloudTint: '#ffffff',
    cloudShadowTint: '#9fb4ce',
    exposure: 0.96,
    waterSkyTint: '#739ac4',
    riverDeepColor: '#2d4b58',
    riverShallowColor: '#697c74',
  },
  golden: {
    id: 'golden',
    label: 'Golden Hour',
    skyTop: '#2e528c',
    skyMid: '#9481a3',
    skyHorizon: '#f2be8c',
    sunDirection: [88, 20, 34],
    sunColor: '#ffbe7d',
    sunIntensity: 2.15,
    hemiSkyColor: '#eba97a',
    hemiGroundColor: '#5c4336',
    hemiIntensity: 0.56,
    fillColor: '#7ea3d9',
    fillIntensity: 0.28,
    fogColor: '#e5be9b',
    fogDensity: 0.0021,
    cloudTint: '#ffebd0',
    cloudShadowTint: '#997c88',
    exposure: 0.96,
    waterSkyTint: '#c4967f',
    riverDeepColor: '#3a3b48',
    riverShallowColor: '#8f7261',
  },
  moonlight: {
    id: 'moonlight',
    label: 'Moonlight',
    skyTop: '#0b1830',
    skyMid: '#182f56',
    skyHorizon: '#2d4b75',
    sunDirection: [-56, 58, 44],
    sunColor: '#c8defc',
    sunIntensity: 1.25,
    hemiSkyColor: '#486fa8',
    hemiGroundColor: '#1f2836',
    hemiIntensity: 0.48,
    fillColor: '#587bb3',
    fillIntensity: 0.25,
    fogColor: '#243d61',
    fogDensity: 0.0024,
    cloudTint: '#7893b8',
    cloudShadowTint: '#1f304a',
    exposure: 0.92,
    waterSkyTint: '#2a466e',
    riverDeepColor: '#112238',
    riverShallowColor: '#233a54',
  },
};

export const CLOUD_FIELD_BOUNDS = {
  minX: -240,
  maxX: 240,
} as const;
