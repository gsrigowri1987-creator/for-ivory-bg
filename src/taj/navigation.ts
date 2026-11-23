import { TAJ_DIMS } from './config';

export const HUMAN_EYE_HEIGHT = 1.72;
export const WALK_SPEED_MPS = 9.5;
export const RUN_SPEED_MPS = 17.5;

export interface Vec2XZ {
  x: number;
  z: number;
}

/**
 * Compute walkable ground elevation (meters) at world (x, z).
 * Smoothly steps across the Charbagh garden (0m), Agra red sandstone terrace (0.85m),
 * and the raised Makrana marble plinth (5.25m).
 */
export function getGroundHeightAt(x: number, z: number): number {
  const plinthHalfW = TAJ_DIMS.plinthW * 0.5 - 0.6;
  const plinthHalfD = TAJ_DIMS.plinthD * 0.5 - 0.6;

  // On top of the white Makrana marble plinth
  if (Math.abs(x) <= plinthHalfW && Math.abs(z) <= plinthHalfD) {
    return TAJ_DIMS.plinthTopY;
  }

  // Smooth stair ramp ascending the front/south or side approaches onto the plinth
  const stairZoneZ = z > plinthHalfD && z < plinthHalfD + 5.0 && Math.abs(x) < 12;
  if (stairZoneZ) {
    const t = 1 - (z - plinthHalfD) / 5.0;
    const smooth = t * t * (3 - 2 * t);
    return TAJ_DIMS.sandstoneTerraceH + smooth * (TAJ_DIMS.plinthTopY - TAJ_DIMS.sandstoneTerraceH);
  }

  // On the elevated red sandstone riverfront terrace surrounding the plinth
  const terraceHalfW = TAJ_DIMS.sandstoneTerraceW * 0.5 + 1.5;
  const terraceHalfD = TAJ_DIMS.sandstoneTerraceD * 0.5 + 2.5;
  if (Math.abs(x) <= terraceHalfW && z >= -40.5 && z <= terraceHalfD) {
    return TAJ_DIMS.sandstoneTerraceH;
  }

  // Extended riverfront promenade east & west of the terrace overlooking the Yamuna River
  if (z >= -40.5 && z <= -32.0 && Math.abs(x) <= 78) {
    return TAJ_DIMS.sandstoneTerraceH;
  }

  // Charbagh garden pathways & lawns
  return 0.04;
}

/**
 * Clamp a first-person walker position inside explorable grounds and outside
 * solid architectural volumes (central mausoleum sanctuary, 4 corner minarets,
 * reflecting pool water channel, and the Yamuna riverfront drop-off).
 */
export function clampFirstPersonPosition(x: number, z: number): Vec2XZ {
  // Keep within explorable garden & riverfront terrace bounds
  let nx = Math.max(-72, Math.min(72, x));
  let nz = Math.max(-38.6, Math.min(134, z));

  // Keep outside the solid central mausoleum sanctuary (31.6m x 31.6m + margin)
  const mausHalf = TAJ_DIMS.mausoleumW * 0.5 + 1.6;
  if (Math.abs(nx) < mausHalf && Math.abs(nz) < mausHalf) {
    const dx = mausHalf - Math.abs(nx);
    const dz = mausHalf - Math.abs(nz);
    if (dx < dz) {
      nx = (nx >= 0 ? 1 : -1) * mausHalf;
    } else {
      nz = (nz >= 0 ? 1 : -1) * mausHalf;
    }
  }

  // Keep outside the 4 corner minaret circular plinths
  const mOff = TAJ_DIMS.minaretOffset;
  const mRad = TAJ_DIMS.minaretBaseRadius + 1.45;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const mx = sx * mOff;
      const mz = sz * mOff;
      const vx = nx - mx;
      const vz = nz - mz;
      const dist = Math.hypot(vx, vz);
      if (dist < mRad && dist > 0.0001) {
        nx = mx + (vx / dist) * mRad;
        nz = mz + (vz / dist) * mRad;
      }
    }
  }

  // Keep off the open reflecting pool water surface (unless standing on the south viewing platform)
  const poolHalfW = TAJ_DIMS.poolWidth * 0.5 + 0.55;
  const poolMinZ = TAJ_DIMS.poolStartZ;
  const poolMaxZ = TAJ_DIMS.poolStartZ + TAJ_DIMS.poolLength - 1.2;
  if (Math.abs(nx) < poolHalfW && nz > poolMinZ && nz < poolMaxZ) {
    // Allow standing cleanly on the raised central marble viewing platform (z around 100..107)
    const onViewingPlatform = nz >= 98.5 && nz <= 107.5;
    if (!onViewingPlatform) {
      nx = (nx >= 0 ? 1 : -1) * poolHalfW;
    }
  }

  return { x: nx, z: nz };
}

/**
 * Compute subtle realistic human stride head-bob vertical offset (in meters) while walking.
 */
export function computeWalkBobOffset(walkPhase: number, moveBlend: number): number {
  const clampedBlend = Math.max(0, Math.min(1, moveBlend));
  return Math.sin(walkPhase) * 0.038 * clampedBlend;
}

/**
 * Compute initial yaw and pitch (radians, YXZ Euler order) looking from `from` to `to`.
 */
export function computeLookAngles(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): { yaw: number; pitch: number } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const horiz = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.max(horiz, 0.0001));
  return { yaw, pitch };
}

export interface CinematicParallaxOffset {
  yawOffset: number;
  pitchOffset: number;
  posOffsetX: number;
  posOffsetY: number;
}

/**
 * Compute subtle award-winning landing-page camera motion combining gentle mouse-parallax
 * look/sway with a slow, organic cinematic breathing drift. Bounded tightly so the monument
 * remains majestically framed at all times.
 */
export function computeCinematicParallax(
  mouseNormX: number,
  mouseNormY: number,
  elapsedSec: number,
  strength = 1.0,
): CinematicParallaxOffset {
  const s = Math.max(0, Math.min(1, strength));
  if (s <= 0) {
    return { yawOffset: 0, pitchOffset: 0, posOffsetX: 0, posOffsetY: 0 };
  }
  const mx = Math.max(-1, Math.min(1, mouseNormX));
  const my = Math.max(-1, Math.min(1, mouseNormY));

  // Slow organic cinematic breathing drift (~17s & ~25s periods)
  const driftYaw = Math.sin(elapsedSec * 0.26) * 0.009 + Math.sin(elapsedSec * 0.15 + 1.1) * 0.005;
  const driftPitch = Math.sin(elapsedSec * 0.21 + 0.6) * 0.0045;
  const driftX = Math.sin(elapsedSec * 0.23 + 0.4) * 0.18;
  const driftY = Math.cos(elapsedSec * 0.31) * 0.045;

  // Responsive yet restrained mouse-driven parallax tilt & micro-translation
  const yawOffset = (-mx * 0.032 + driftYaw) * s;
  const pitchOffset = (-my * 0.018 + driftPitch) * s;
  const posOffsetX = (mx * 0.42 + driftX) * s;
  const posOffsetY = (-my * 0.12 + driftY) * s;

  return { yawOffset, pitchOffset, posOffsetX, posOffsetY };
}
