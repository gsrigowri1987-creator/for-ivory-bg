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
    // Iconic centered wide-angle Charbagh reflecting-pool hero framing:
    // full Taj Mahal, all four minarets, mirror pool reflection, and generous open golden-hour sky above the main dome
    position: [0, 2.02, 105.0],
    target: [0, 20.6, 0],
    fov: 56,
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
    skyTop: '#2c5fa3',
    skyMid: '#6898cc',
    skyHorizon: '#d9e7f5',
    sunDirection: [78, 56, 36],
    sunColor: '#fff5e2',
    sunIntensity: 2.35,
    hemiSkyColor: '#8ebce8',
    hemiGroundColor: '#7a6a54',
    hemiIntensity: 0.72,
    fillColor: '#bdd6f5',
    fillIntensity: 0.34,
    fogColor: '#d4e2f0',
    fogDensity: 0.0017,
    cloudTint: '#ffffff',
    cloudShadowTint: '#9fb4ce',
    exposure: 1.0,
    waterSkyTint: '#739ac4',
    riverDeepColor: '#2d4b58',
    riverShallowColor: '#697c74',
  },
  golden: {
    id: 'golden',
    label: 'Golden Hour',
    skyTop: '#4d75ad',
    skyMid: '#96aecb',
    skyHorizon: '#f2c596',
    // Low grazing golden-hour sun sculpting the onion dome, Great Pishtaq arches, minarets & cypress avenue
    sunDirection: [86, 22, 46],
    sunColor: '#ffcb8a',
    sunIntensity: 2.95,
    hemiSkyColor: '#a6c6eb',
    hemiGroundColor: '#947252',
    hemiIntensity: 1.18,
    fillColor: '#98b7de',
    fillIntensity: 0.68,
    fogColor: '#e4be97',
    fogDensity: 0.00165,
    cloudTint: '#fff0d8',
    cloudShadowTint: '#9a96ad',
    exposure: 1.03,
    waterSkyTint: '#95aac4',
    riverDeepColor: '#2d3f50',
    riverShallowColor: '#967660',
  },
  moonlight: {
    id: 'moonlight',
    label: 'Moonlight',
    skyTop: '#0b1830',
    skyMid: '#182f56',
    skyHorizon: '#2d4b75',
    sunDirection: [-56, 58, 44],
    sunColor: '#c8defc',
    sunIntensity: 1.35,
    hemiSkyColor: '#486fa8',
    hemiGroundColor: '#1f2836',
    hemiIntensity: 0.5,
    fillColor: '#587bb3',
    fillIntensity: 0.28,
    fogColor: '#243d61',
    fogDensity: 0.0024,
    cloudTint: '#7893b8',
    cloudShadowTint: '#1f304a',
    exposure: 0.96,
    waterSkyTint: '#2a466e',
    riverDeepColor: '#112238',
    riverShallowColor: '#233a54',
  },
};

export const CLOUD_FIELD_BOUNDS = {
  minX: -240,
  maxX: 240,
} as const;
