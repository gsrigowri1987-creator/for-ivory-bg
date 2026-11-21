import {
  BUILD_STAGES,
  CLOUD_FIELD_BOUNDS,
  TOTAL_BUILD_DURATION,
  type BuildStageId,
  type BuildStageSpec,
} from './config';

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export function easeOutQuint(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 5);
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutBackSubtle(t: number): number {
  const x = clamp01(t);
  const c1 = 0.72;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Normalized [0..1] linear progress for a given stage at elapsed build time (seconds). */
export function getStageLinearProgress(stage: BuildStageSpec, elapsedSec: number): number {
  if (elapsedSec <= stage.start) return 0;
  if (elapsedSec >= stage.end) return 1;
  return clamp01((elapsedSec - stage.start) / (stage.end - stage.start));
}

/** Eased progress values for every Taj Mahal architectural stage. */
export function evaluateBuildStages(elapsedSec: number): Record<BuildStageId, number> {
  const result = {} as Record<BuildStageId, number>;
  for (const stage of BUILD_STAGES) {
    result[stage.id] = easeOutCubic(getStageLinearProgress(stage, elapsedSec));
  }
  return result;
}

/** Active human-readable label describing what is currently assembling. */
export function getActiveBuildLabel(elapsedSec: number): string {
  if (elapsedSec >= TOTAL_BUILD_DURATION) {
    return 'Complete — Makrana Marble Sanctuary';
  }
  for (let i = BUILD_STAGES.length - 1; i >= 0; i -= 1) {
    const stage = BUILD_STAGES[i];
    if (elapsedSec >= stage.start) {
      return stage.label;
    }
  }
  return BUILD_STAGES[0].label;
}

/** Staggered sub-element progress inside a stage (e.g., 4 minarets or cypress rows). */
export function getSubStageProgress(
  stageLinear: number,
  index: number,
  total: number,
  overlap = 0.58,
): number {
  if (total <= 1) return easeOutCubic(stageLinear);
  const step = (1 - overlap) / (total - 1);
  const localStart = index * step;
  const localEnd = localStart + overlap;
  return easeOutCubic((stageLinear - localStart) / (localEnd - localStart));
}

export interface BuildRiseTransform {
  visible: boolean;
  offsetY: number;
  scaleY: number;
  scaleXZ: number;
}

/** Compute smooth upward rise + structural settle transform for a building component. */
export function computeRiseTransform(
  easedProgress: number,
  dropDistance: number,
  fromBelow = true,
): BuildRiseTransform {
  const p = clamp01(easedProgress);
  if (p <= 0.001) {
    return {
      visible: false,
      offsetY: fromBelow ? -dropDistance : dropDistance,
      scaleY: 0.05,
      scaleXZ: 0.88,
    };
  }
  const rawOffsetY = (fromBelow ? -1 : 1) * dropDistance * (1 - p);
  const offsetY = rawOffsetY === 0 ? 0 : rawOffsetY;
  const scaleY = 0.15 + 0.85 * easeOutQuint(p);
  const scaleXZ = 0.92 + 0.08 * p;
  return {
    visible: true,
    offsetY,
    scaleY,
    scaleXZ,
  };
}

/** Compute smooth horizontal wrapping position for drifting clouds. */
export function wrapCloudX(
  initialX: number,
  speed: number,
  elapsedSec: number,
  minX: number = CLOUD_FIELD_BOUNDS.minX,
  maxX: number = CLOUD_FIELD_BOUNDS.maxX,
): number {
  const span = maxX - minX;
  if (span <= 0) return initialX;
  const raw = initialX + speed * elapsedSec - minX;
  const wrapped = ((raw % span) + span) % span;
  return minX + wrapped;
}

export interface BreezeSwayAngles {
  rotX: number;
  rotZ: number;
}

/**
 * Compute gentle, natural breeze sway angles (radians) for a cypress or garden tree.
 * Combines a slow travelling gust wave with a secondary harmonic shimmer.
 */
export function computeTreeBreezeSway(
  worldX: number,
  worldZ: number,
  elapsedSec: number,
  breezeStrength: number,
  heightFactor = 1.0,
): BreezeSwayAngles {
  if (breezeStrength <= 0) {
    return { rotX: 0, rotZ: 0 };
  }
  const phase = worldX * 0.085 + worldZ * 0.055;
  const gust = 0.65 + 0.35 * Math.sin(elapsedSec * 0.42 + phase * 0.4);
  const primary = Math.sin(elapsedSec * 1.45 + phase);
  const secondary = Math.sin(elapsedSec * 2.75 + phase * 1.65) * 0.32;

  const amp = 0.036 * breezeStrength * heightFactor * gust;
  return {
    rotZ: -(primary + secondary) * amp,
    rotX: Math.cos(elapsedSec * 1.12 + phase * 0.8) * amp * 0.48,
  };
}

/** Total period (seconds) of the intermittent fountain sprinkler ON / OFF cycle. */
export const SPRINKLER_CYCLE_PERIOD = 15.0;

/**
 * Compute smooth intermittent sprinkler / fountain spray intensity in [0..1].
 * Alternates organically between active water spraying (~8.8s ON with natural pressure pulse)
 * and tranquil off intervals (~6.2s OFF so the reflecting pool settles into a calm mirror).
 * Optional nozzleIndex subtly staggers pressure ramp-up along the pool axis.
 */
export function computeSprinklerIntensity(
  elapsedSec: number,
  nozzleIndex = 0,
  totalNozzles = 20,
): number {
  const stagger = totalNozzles > 1 ? (nozzleIndex / (totalNozzles - 1)) * 0.9 : 0;
  const cycleT = (((elapsedSec - stagger) % SPRINKLER_CYCLE_PERIOD) + SPRINKLER_CYCLE_PERIOD) % SPRINKLER_CYCLE_PERIOD;

  // 0.0..1.4s: ramp up | 1.4..7.6s: active spray with gentle natural water-pressure pulse | 7.6..9.1s: taper down | 9.1..15.0s: OFF
  let envelope = 0;
  if (cycleT < 1.4) {
    envelope = easeInOutCubic(cycleT / 1.4);
  } else if (cycleT < 7.6) {
    const pulse = 0.91 + 0.09 * Math.sin(elapsedSec * 3.1 + nozzleIndex * 0.65);
    envelope = pulse;
  } else if (cycleT < 9.1) {
    envelope = 1 - easeInOutCubic((cycleT - 7.6) / 1.5);
  } else {
    envelope = 0;
  }

  return clamp01(envelope);
}

export interface BirdFlightSpec {
  centerX: number;
  centerZ: number;
  radiusX: number;
  radiusZ: number;
  baseAltitude: number;
  altitudeWave: number;
  angularSpeed: number;
  phase: number;
  /** +1 counter-clockwise or -1 clockwise circling direction */
  direction: 1 | -1;
  /** Subtle figure-eight harmonic modulation */
  figureEightAmp: number;
  flapSpeed: number;
  wingSpan: number;
}

export interface BirdFlightPose {
  x: number;
  y: number;
  z: number;
  /** Yaw heading in radians (aligned with velocity vector) */
  yaw: number;
  /** Pitch angle in radians (climbing vs descending) */
  pitch: number;
  /** Aerodynamic banking roll into turns (radians) */
  bank: number;
  /** Wing dihedral angle in radians (alternating flapping bursts & smooth glides) */
  wingAngle: number;
}

/**
 * Evaluate smooth 3D position, heading, banking roll, and natural flap/glide wing angle
 * for a soaring bird circling the Taj Mahal gardens, domes, and Yamuna River.
 */
export function computeBirdFlightPose(spec: BirdFlightSpec, elapsedSec: number): BirdFlightPose {
  const samplePos = (t: number) => {
    const theta = spec.phase + t * spec.angularSpeed * spec.direction;
    const x =
      spec.centerX +
      Math.cos(theta) * spec.radiusX +
      Math.sin(theta * 2.0) * spec.figureEightAmp;
    const z =
      spec.centerZ +
      Math.sin(theta) * spec.radiusZ +
      Math.cos(theta * 1.5) * spec.figureEightAmp * 0.55;
    const y =
      spec.baseAltitude +
      Math.sin(theta * 1.5 + spec.phase) * spec.altitudeWave +
      Math.cos(t * 0.45 + spec.phase) * 1.1;
    return { x, y, z };
  };

  const dtSample = 0.08;
  const curr = samplePos(elapsedSec);
  const next = samplePos(elapsedSec + dtSample);
  const prev = samplePos(elapsedSec - dtSample);

  const vx = (next.x - prev.x) / (2 * dtSample);
  const vy = (next.y - prev.y) / (2 * dtSample);
  const vz = (next.z - prev.z) / (2 * dtSample);
  const horizSpeed = Math.max(0.001, Math.hypot(vx, vz));

  // Forward heading aligned with +Z nose convention
  const yaw = Math.atan2(vx, vz);
  const pitch = Math.max(-0.42, Math.min(0.42, Math.atan2(vy, horizSpeed)));

  // Curvature-driven banking roll into turns
  const ax = (next.x - 2 * curr.x + prev.x) / (dtSample * dtSample);
  const az = (next.z - 2 * curr.z + prev.z) / (dtSample * dtSample);
  const lateralAccel = (vx * az - vz * ax) / horizSpeed;
  const bank = Math.max(-0.55, Math.min(0.55, -lateralAccel * 0.22));

  // Alternate organically between active wingbeats (~60% of time) and poised soaring glides (~40%)
  const glideCycle = Math.sin(elapsedSec * 0.72 + spec.phase * 1.9);
  const flapEnvelope = glideCycle > -0.25 ? clamp01((glideCycle + 0.25) / 0.45) : 0;
  const flapWave = Math.sin(elapsedSec * spec.flapSpeed + spec.phase * 3.1);
  // Subtle upward V-dihedral during glides, wide energetic stroke during flaps
  const wingAngle = 0.14 + flapEnvelope * flapWave * 0.62;

  return {
    x: curr.x,
    y: curr.y,
    z: curr.z,
    yaw,
    pitch,
    bank,
    wingAngle,
  };
}

