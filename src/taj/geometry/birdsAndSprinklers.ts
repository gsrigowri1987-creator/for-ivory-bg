import * as THREE from 'three';
import {
  computeBirdFlightPose,
  computeSprinklerIntensity,
  type BirdFlightSpec,
} from '../animation';
import { TAJ_DIMS } from '../config';

export interface FlyingBirdsHandles {
  root: THREE.Group;
  update: (elapsedSec: number) => void;
  applyTint: (
    sunColorHex: string,
    nightFactor: number,
    sunDir?: THREE.Vector3,
    fogColorHex?: string,
    fogDensity?: number,
  ) => void;
  dispose: () => void;
}

export interface FountainSprinklersHandles {
  root: THREE.Group;
  /** Water-surface splash/foam meshes sitting at y=0.18 (clipped in reflection, safe to cull during reflection pass). */
  surfaceSplashObjects: THREE.Object3D[];
  /** Update multi-tier jets, parabolic arcs, droplets, splash crowns, foam flecks & ripples; returns aggregate intensity [0..1]. */
  update: (
    elapsedSec: number,
    buildProgress: number,
    breezeStrength: number,
    overrideMode: 'auto' | 'on' | 'off',
  ) => number;
  applyTint: (
    sunColorHex: string,
    horizonColorHex: string,
    nightFactor: number,
    sunDir?: THREE.Vector3,
  ) => void;
  dispose: () => void;
}

function seededRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// =============================================================================
// REALISTIC ARTICULATED FLYING BIRDS (TWO-SEGMENT WINGS + SUNLIT RIM + HAZE)
// =============================================================================

/** Sculpted streamlined avian torso + tapered neck/head & delicate beak aligned along +Z nose. */
function createBirdBodyGeometry(): THREE.BufferGeometry {
  // Lathe profile along Y, then rotated so nose points along +Z
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.001, -0.34), // tail root
    new THREE.Vector2(0.042, -0.24),
    new THREE.Vector2(0.088, -0.10), // mid torso
    new THREE.Vector2(0.112, 0.04),  // full chest / shoulder
    new THREE.Vector2(0.092, 0.16),
    new THREE.Vector2(0.056, 0.25),  // neck taper
    new THREE.Vector2(0.062, 0.31),  // sleek head
    new THREE.Vector2(0.036, 0.37),
    new THREE.Vector2(0.001, 0.44),  // fine beak tip
  ];
  const geo = new THREE.LatheGeometry(pts, 10);
  geo.rotateX(Math.PI * 0.5);
  // Subtle aerodynamic oval cross-section (slightly wider across shoulders, sleek vertically)
  geo.scale(0.95, 0.78, 1.0);
  geo.computeVertexNormals();
  return geo;
}

/** Sculpted feathered tail (gracefully fanned pigeon/dove tail OR forked swift/kite tail). */
function createBirdTailGeometry(forked: boolean): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.045, 0.0);
  if (forked) {
    shape.quadraticCurveTo(-0.12, -0.16, -0.18, -0.38);
    shape.lineTo(-0.06, -0.27);
    shape.lineTo(0.0, -0.24);
    shape.lineTo(0.06, -0.27);
    shape.lineTo(0.18, -0.38);
    shape.quadraticCurveTo(0.12, -0.16, 0.045, 0.0);
  } else {
    shape.quadraticCurveTo(-0.14, -0.14, -0.19, -0.32);
    shape.quadraticCurveTo(0.0, -0.38, 0.19, -0.32);
    shape.quadraticCurveTo(0.14, -0.14, 0.045, 0.0);
  }
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 5);
  geo.rotateX(-Math.PI * 0.5);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, Math.abs(x) * 0.08 + z * 0.02);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Segment 1 (Inner Wing): cambered shoulder-to-wrist secondary feather airfoil (span 0 -> 0.50m).
 * Local origin sits at the shoulder joint; nose points along +Z.
 */
function createBirdInnerWingGeometry(side: 1 | -1): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.13); // shoulder leading edge
  shape.quadraticCurveTo(side * 0.24, 0.18, side * 0.50, 0.11); // forearm to wrist
  shape.lineTo(side * 0.50, -0.15); // wrist trailing edge
  shape.quadraticCurveTo(side * 0.24, -0.21, 0, -0.14); // secondary feathers trailing root
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 6);
  geo.rotateX(-Math.PI * 0.5);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const xFrac = Math.min(1, Math.abs(pos.getX(i)) / 0.5);
    const z = pos.getZ(i);
    const camber = Math.sin(xFrac * Math.PI * 0.78) * 0.042 + Math.max(0, z) * 0.075;
    pos.setY(i, camber);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Segment 2 (Hinged Outer Wingtip): wrist-to-primary flight feathers (span 0 -> 0.58m),
 * sculpted with tapered swept leading edge and delicate feathered primary notches at the tip!
 */
function createBirdOuterWingGeometry(side: 1 | -1): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.11); // wrist leading hinge
  shape.quadraticCurveTo(side * 0.28, 0.06, side * 0.58, -0.09); // swept primary tip 1
  shape.lineTo(side * 0.45, -0.12);
  shape.lineTo(side * 0.52, -0.17); // slotted primary tip 2
  shape.lineTo(side * 0.37, -0.17);
  shape.lineTo(side * 0.41, -0.22); // slotted primary tip 3
  shape.quadraticCurveTo(side * 0.20, -0.20, 0, -0.15); // wrist trailing hinge
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 6);
  geo.rotateX(-Math.PI * 0.5);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const xFrac = Math.min(1, Math.abs(pos.getX(i)) / 0.58);
    const z = pos.getZ(i);
    // Natural graceful upward wingtip flex & subtle feather twist
    const lift = xFrac * xFrac * 0.055 + Math.max(0, z) * 0.04 * (1 - xFrac);
    pos.setY(i, lift);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Custom GLSL Plumage Shader with Golden-Hour Sunlit Wing-Edge Rim Glow & Atmospheric Horizon Haze Fade.
 * Prevents distant birds from looking like harsh black dots against the golden sky while letting
 * banking wings catch warm amber sunlight along their upper feather margins.
 */
function createBirdPlumageMaterial(
  baseColorHex: string,
  underColorHex: string,
  rimStrength: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
    uniforms: {
      uBaseColor: { value: new THREE.Color(baseColorHex) },
      uUnderColor: { value: new THREE.Color(underColorHex) },
      uSunColor: { value: new THREE.Color('#ffcf90') },
      uSunDir: { value: new THREE.Vector3(0.62, 0.34, 0.70).normalize() },
      uFogColor: { value: new THREE.Color('#f2cda2') },
      uFogDensity: { value: 0.0022 },
      uNightFactor: { value: 0.0 },
      uRimStrength: { value: rimStrength },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBaseColor;
      uniform vec3 uUnderColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uNightFactor;
      uniform float uRimStrength;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 N = normalize(vWorldNormal);
        if (!gl_FrontFacing) N = -N;

        // Soft upper/under feather plumage shading (natural warm sky bounce on belly so undersides never crush black)
        float upMix = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 albedo = mix(uUnderColor, uBaseColor, upMix);

        // Directional golden-hour key light + warm atmospheric ambient fill
        float ndotl = dot(N, uSunDir);
        float diffuse = clamp(ndotl * 0.62 + 0.38, 0.0, 1.0);
        vec3 ambientSky = mix(vec3(0.56, 0.58, 0.64), vec3(0.28, 0.36, 0.52), uNightFactor);
        vec3 lit = albedo * (ambientSky * 0.54 + uSunColor * diffuse * 0.88);

        // Golden-hour sunlit rim & feather-edge translucency as wings bank toward the low sun
        float fresnel = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.1);
        float sunWrap = smoothstep(-0.35, 0.85, ndotl);
        float forwardScatter = pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.45;
        vec3 rimGlow = uSunColor * (fresnel * (0.42 + 0.78 * sunWrap) + forwardScatter * fresnel) * uRimStrength;
        lit += rimGlow * (1.0 - uNightFactor * 0.68);

        // Smooth atmospheric horizon haze blend so distant birds dissolve naturally into the golden sky
        float camDist = length(cameraPosition - vWorldPos);
        float fogFactor = 1.0 - exp(-pow(camDist * max(uFogDensity, 0.0012) * 1.48, 2.0));
        // Gentle elevation-aware haze softening for far birds near the horizon
        float horizonSoft = smoothstep(55.0, 210.0, camDist) * 0.52;
        vec3 finalCol = mix(lit, uFogColor, clamp(max(fogFactor, horizonSoft), 0.0, 0.86));

        // Soft far-distance alpha dissolve so extreme-distance birds never alias as crisp black speckles
        float distAlpha = 1.0 - smoothstep(165.0, 270.0, camDist) * 0.55;
        gl_FragColor = vec4(finalCol, distAlpha);
      }
    `,
  });
}

interface BirdInstance {
  group: THREE.Group;
  leftInnerWing: THREE.Mesh;
  rightInnerWing: THREE.Mesh;
  leftOuterWing: THREE.Mesh;
  rightOuterWing: THREE.Mesh;
  spec: BirdFlightSpec;
}

/**
 * Create natural flocks of articulated flapping & thermal-gliding Agra pigeons/doves and Indian swifts/kites
 * circling the Taj Mahal dome, minarets, reflecting pool, and Yamuna River.
 */
export function buildFlyingBirds(): FlyingBirdsHandles {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const root = new THREE.Group();
  root.name = 'FlyingBirdsFlocks';

  const bodyGeo = trackGeo(createBirdBodyGeometry());
  const fanTailGeo = trackGeo(createBirdTailGeometry(false));
  const forkTailGeo = trackGeo(createBirdTailGeometry(true));

  const leftInnerGeo = trackGeo(createBirdInnerWingGeometry(-1));
  const rightInnerGeo = trackGeo(createBirdInnerWingGeometry(1));
  const leftOuterGeo = trackGeo(createBirdOuterWingGeometry(-1));
  const rightOuterGeo = trackGeo(createBirdOuterWingGeometry(1));

  // Authentic Agra species plumage with golden-hour sunlit rim & soft horizon haze fade
  const doveBodyMat = trackMat(createBirdPlumageMaterial('#f7f2e8', '#dfd7ca', 0.92));
  const doveTipMat = trackMat(createBirdPlumageMaterial('#e2ddd4', '#c5c0b8', 0.98));
  const swiftBodyMat = trackMat(createBirdPlumageMaterial('#584a42', '#70635a', 0.78));
  const swiftTipMat = trackMat(createBirdPlumageMaterial('#423934', '#5c524b', 0.95));

  const plumageMats = [doveBodyMat, doveTipMat, swiftBodyMat, swiftTipMat];

  const rand = seededRand(1648);
  const specs: Array<{ spec: BirdFlightSpec; isDove: boolean }> = [];

  // Flock 1: 6 white Agra doves & dark swifts wheeling in wide thermal figure-8 arcs around dome & minarets
  for (let i = 0; i < 6; i += 1) {
    const isDove = i % 2 === 0;
    specs.push({
      isDove,
      spec: {
        centerX: (rand() - 0.5) * 18,
        centerZ: 8 + (rand() - 0.5) * 18,
        radiusX: 25 + rand() * 24,
        radiusZ: 21 + rand() * 22,
        baseAltitude: 25 + rand() * 14,
        altitudeWave: 1.8 + rand() * 2.1,
        angularSpeed: 0.14 + rand() * 0.065,
        phase: (i / 6) * Math.PI * 2 + rand() * 0.55,
        direction: i < 3 ? 1 : -1,
        figureEightAmp: 4.5 + rand() * 5.0,
        flapSpeed: isDove ? 9.4 + rand() * 2.0 : 8.0 + rand() * 2.2,
        wingSpan: isDove ? 0.86 + rand() * 0.18 : 0.94 + rand() * 0.22,
      },
    });
  }

  // Flock 2: 4 graceful doves & swifts sweeping & gliding above the Charbagh pool and cypresses
  for (let i = 0; i < 4; i += 1) {
    const isDove = i !== 2;
    specs.push({
      isDove,
      spec: {
        centerX: (rand() - 0.5) * 14,
        centerZ: 54 + (rand() - 0.5) * 20,
        radiusX: 19 + rand() * 16,
        radiusZ: 24 + rand() * 16,
        baseAltitude: 13.5 + rand() * 8.0,
        altitudeWave: 1.5 + rand() * 1.5,
        angularSpeed: 0.17 + rand() * 0.065,
        phase: (i / 4) * Math.PI * 2 + rand() * 0.7,
        direction: i % 2 === 0 ? 1 : -1,
        figureEightAmp: 3.8 + rand() * 4.2,
        flapSpeed: isDove ? 10.2 + rand() * 1.8 : 8.6 + rand() * 2.0,
        wingSpan: 0.74 + rand() * 0.18,
      },
    });
  }

  // Flock 3: 4 white river egrets & Indian kites gliding thermally across the Yamuna River behind the Taj
  for (let i = 0; i < 4; i += 1) {
    const isDove = i % 2 === 0;
    specs.push({
      isDove,
      spec: {
        centerX: (rand() - 0.5) * 44,
        centerZ: -86 + (rand() - 0.5) * 26,
        radiusX: 36 + rand() * 26,
        radiusZ: 20 + rand() * 16,
        baseAltitude: 14 + rand() * 13,
        altitudeWave: 1.8 + rand() * 2.2,
        angularSpeed: 0.12 + rand() * 0.055,
        phase: (i / 4) * Math.PI * 2 + rand() * 0.65,
        direction: i < 2 ? 1 : -1,
        figureEightAmp: 6.0 + rand() * 5.2,
        flapSpeed: 7.2 + rand() * 2.0,
        wingSpan: 1.04 + rand() * 0.24,
      },
    });
  }

  const birds: BirdInstance[] = [];
  for (const entry of specs) {
    const birdGroup = new THREE.Group();
    const innerMat = entry.isDove ? doveBodyMat : swiftBodyMat;
    const outerMat = entry.isDove ? doveTipMat : swiftTipMat;

    const body = new THREE.Mesh(bodyGeo, innerMat);
    birdGroup.add(body);

    const tail = new THREE.Mesh(entry.isDove ? fanTailGeo : forkTailGeo, outerMat);
    tail.position.set(0, 0.008, -0.31);
    birdGroup.add(tail);

    // Two-segment articulated left wing: shoulder -> wrist hinge -> slotted primary wingtip
    const leftInnerWing = new THREE.Mesh(leftInnerGeo, innerMat);
    leftInnerWing.position.set(-0.045, 0.032, 0.05);
    const leftOuterWing = new THREE.Mesh(leftOuterGeo, outerMat);
    leftOuterWing.position.set(-0.485, 0.036, 0.0);
    leftInnerWing.add(leftOuterWing);
    birdGroup.add(leftInnerWing);

    // Two-segment articulated right wing: shoulder -> wrist hinge -> slotted primary wingtip
    const rightInnerWing = new THREE.Mesh(rightInnerGeo, innerMat);
    rightInnerWing.position.set(0.045, 0.032, 0.05);
    const rightOuterWing = new THREE.Mesh(rightOuterGeo, outerMat);
    rightOuterWing.position.set(0.485, 0.036, 0.0);
    rightInnerWing.add(rightOuterWing);
    birdGroup.add(rightInnerWing);

    birdGroup.scale.setScalar(entry.spec.wingSpan);
    root.add(birdGroup);

    birds.push({
      group: birdGroup,
      leftInnerWing,
      rightInnerWing,
      leftOuterWing,
      rightOuterWing,
      spec: entry.spec,
    });
  }

  const update = (elapsedSec: number) => {
    for (let i = 0; i < birds.length; i += 1) {
      const b = birds[i];
      const pose = computeBirdFlightPose(b.spec, elapsedSec);
      b.group.position.set(pose.x, pose.y, pose.z);
      b.group.rotation.set(-pose.pitch, pose.yaw, pose.bank, 'YXZ');

      // Two-segment articulated wingbeat & soaring thermal dihedral
      b.leftInnerWing.rotation.z = -pose.wingAngle;
      b.rightInnerWing.rotation.z = pose.wingAngle;
      b.leftOuterWing.rotation.z = -pose.outerWingAngle;
      b.rightOuterWing.rotation.z = pose.outerWingAngle;

      // Subtle forward/back wing sweep as birds tuck slightly during fast glides
      const sweep = pose.glideFactor * 0.09;
      b.leftInnerWing.rotation.y = sweep;
      b.rightInnerWing.rotation.y = -sweep;
    }
  };

  // Place birds in natural initial flight poses immediately on frame 0
  update(2.4);

  return {
    root,
    update,
    applyTint: (
      sunColorHex: string,
      nightFactor: number,
      sunDir?: THREE.Vector3,
      fogColorHex?: string,
      fogDensity?: number,
    ) => {
      for (const m of plumageMats) {
        m.uniforms.uSunColor.value.set(sunColorHex);
        m.uniforms.uNightFactor.value = nightFactor;
        if (sunDir) m.uniforms.uSunDir.value.copy(sunDir);
        if (fogColorHex) m.uniforms.uFogColor.value.set(fogColorHex);
        if (typeof fogDensity === 'number') m.uniforms.uFogDensity.value = fogDensity;
      }
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

// =============================================================================
// PHOTOREALISTIC FLUID-DYNAMIC FOUNTAIN / SPRINKLER WATER SYSTEM
// =============================================================================

/** Build a single merged geometry of 8 smooth analytical ballistic-parabola water filaments emerging from the 8 brass micro-spouts. */
function createEightStreamArcGeometry(
  startR: number,
  startY: number,
  peakRise: number,
  endR: number,
  endY: number,
): THREE.BufferGeometry {
  const streamCount = 8;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertOffset = 0;

  const dropFromPeak = peakRise + (startY - endY);
  const sPeak = Math.sqrt(peakRise) / (Math.sqrt(peakRise) + Math.sqrt(Math.max(0.01, dropFromPeak)));
  const gEff = (2 * peakRise) / (sPeak * sPeak);
  const vY = gEff * sPeak;

  const samplePoints = 20;
  const tubularSegments = 30;
  const radialSegments = 6;

  for (let s = 0; s < streamCount; s += 1) {
    const ang = (s / streamCount) * Math.PI * 2;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);

    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= samplePoints; k += 1) {
      const u = k / samplePoints;
      const r = startR + (endR - startR) * u;
      const y = startY + vY * u - 0.5 * gEff * u * u;
      pts.push(new THREE.Vector3(cosA * r, y, sinA * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');

    const tube = new THREE.TubeGeometry(curve, tubularSegments, 0.0066, radialSegments, false);
    const pAttr = tube.attributes.position as THREE.BufferAttribute;
    const nAttr = tube.attributes.normal as THREE.BufferAttribute;
    const uvAttr = tube.attributes.uv as THREE.BufferAttribute;

    // Taper radius organically: sleek pressurized liquid jet at brass spout -> thinning breakup into falling droplets
    for (let v = 0; v < pAttr.count; v += 1) {
      const uAlong = uvAttr.getX(v);
      const center = curve.getPointAt(Math.min(1, Math.max(0, uAlong)));
      const taper = 0.76 + 0.28 * Math.sin(uAlong * Math.PI * 0.65) - 0.52 * uAlong * uAlong;
      const vx = center.x + (pAttr.getX(v) - center.x) * Math.max(0.18, taper);
      const vy = center.y + (pAttr.getY(v) - center.y) * Math.max(0.18, taper);
      const vz = center.z + (pAttr.getZ(v) - center.z) * Math.max(0.18, taper);

      positions.push(vx, vy, vz);
      normals.push(nAttr.getX(v), nAttr.getY(v), nAttr.getZ(v));
      uvs.push(uAlong, uvAttr.getY(v) + s * 0.37);
    }

    const idx = tube.index;
    if (idx) {
      for (let j = 0; j < idx.count; j += 1) {
        indices.push(idx.getX(j) + vertOffset);
      }
    }
    vertOffset += pAttr.count;
    tube.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  return merged;
}

/**
 * Sculpted teardrop / velocity-stretched liquid spindle aligned along +Y
 * (rounded leading droplet head at +Y, sleek tapered liquid wake at -Y).
 */
function createWaterStreakGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0005, -0.025), // trailing liquid wake
    new THREE.Vector2(0.0046, -0.013),
    new THREE.Vector2(0.0094, 0.0),
    new THREE.Vector2(0.0124, 0.010),  // glistening droplet head
    new THREE.Vector2(0.0092, 0.018),
    new THREE.Vector2(0.0005, 0.022),  // leading tip
  ];
  const geo = new THREE.LatheGeometry(pts, 7);
  geo.computeVertexNormals();
  return geo;
}

/** Build a 3-plane radial crossed billboard geometry (0, 60, 120 deg) for volumetric backlit fountain mist. */
function createCrossedPlumeGeometry(width: number, height: number): THREE.BufferGeometry {
  const halfW = width * 0.5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const angles = [0, Math.PI / 3, (2 * Math.PI) / 3];

  for (let p = 0; p < angles.length; p += 1) {
    const c = Math.cos(angles[p]);
    const s = Math.sin(angles[p]);
    const base = p * 4;
    positions.push(
      -halfW * c, 0, -halfW * s,
      halfW * c, 0, halfW * s,
      halfW * c, height, halfW * s,
      -halfW * c, height, -halfW * s,
    );
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create a photorealistic fluid-dynamic 7-layer intermittent reflecting-pool fountain system:
 * 1. Flowing GLSL central aerated pressurized water jet column breaking into crown spray
 * 2. 8-stream symmetrical Mughal parabolic water filaments atomizing naturally past the apex
 * 3. 116 velocity-stretched translucent golden-backlit water streaks & glistening droplets per nozzle
 * 4A. Organic wind-perturbed expanding concentric pool ripple rings & aerated splash froth
 * 4B. 3D micro-splash crowns erupting vertically where falling arcs strike the water
 * 4C. Delicate organic micro-bubble foam flecks drifting & dissipating around each impact zone
 * 5. Soft wispy backlit golden-hour mist plume leaning gently with the garden breeze
 */
export function buildFountainSprinklers(): FountainSprinklersHandles {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const root = new THREE.Group();
  root.name = 'IntermittentFountainSprinklers';

  // Exact bronze nozzle Z coordinates matching gardenEnvironment.ts
  const poolLen = TAJ_DIMS.poolLength;
  const fountainCount = 20;
  const activeNozzles: Array<{ z: number; index: number }> = [];
  for (let i = 0; i < fountainCount; i += 1) {
    const fz = TAJ_DIMS.poolStartZ + 3.2 + (i / (fountainCount - 1)) * (poolLen - 6.4);
    const insidePlatform = Math.abs(fz - 103.5) < 4.8;
    if (!insidePlatform) {
      activeNozzles.push({ z: fz, index: i });
    }
  }

  const nozzleCount = activeNozzles.length;
  const dropletsPerNozzle = 116;
  const totalDroplets = nozzleCount * dropletsPerNozzle;
  const crownsPerNozzle = 24;
  const totalCrowns = nozzleCount * crownsPerNozzle;
  const foamPerNozzle = 28;
  const totalFoam = nozzleCount * foamPerNozzle;

  // Exact hardware coordinates matching gardenEnvironment.ts (pedestal baseY = 0.02)
  const WATER_SURFACE_Y = 0.18;
  const OUTER_RING_Y = 0.719;
  const OUTER_RING_R = 0.111;
  const ARC_END_R = 0.63;
  const NOZZLE_TIP_Y = 0.805;
  const GRAVITY = 8.4;

  // -------------------------------------------------------------------------
  // LAYER 1: Slender Flowing GLSL Central Aerated Pressurized Water Jet Column
  // -------------------------------------------------------------------------
  const jetProfile = [
    new THREE.Vector2(0.010, 0.0),
    new THREE.Vector2(0.012, 0.22),
    new THREE.Vector2(0.017, 0.52),
    new THREE.Vector2(0.024, 0.76),
    new THREE.Vector2(0.027, 0.89),
    new THREE.Vector2(0.015, 0.96),
    new THREE.Vector2(0.004, 1.0),
  ];
  const jetStreamGeo = trackGeo(new THREE.LatheGeometry(jetProfile, 12));

  const jetStreamMat = trackMat(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.9 },
        uSunColor: { value: new THREE.Color('#ffcf8c') },
        uHorizonColor: { value: new THREE.Color('#dbe8f5') },
        uSunDir: { value: new THREE.Vector3(0.62, 0.34, 0.70).normalize() },
        uNightFactor: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying float vSeed;

        void main() {
          vUv = uv;
          vec4 localPos = vec4(position, 1.0);
          vec3 localNorm = normal;
          #ifdef USE_INSTANCING
            localPos = instanceMatrix * localPos;
            localNorm = mat3(instanceMatrix) * localNorm;
            vSeed = instanceMatrix[3][2] * 0.73;
          #else
            vSeed = 0.0;
          #endif
          vec4 worldPos = modelMatrix * localPos;
          vWorldPos = worldPos.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * localNorm);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uSunColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunDir;
        uniform float uNightFactor;

        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying float vSeed;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 N = normalize(vWorldNormal);
          float fresnel = pow(1.0 - abs(dot(N, V)), 1.9);
          float backlit = pow(max(dot(-V, uSunDir), 0.0), 3.2);
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(abs(dot(N, H)), 0.0), 26.0);

          float flow1 = valueNoise(vec2(vUv.x * 18.0 + vSeed, vUv.y * 10.5 - uTime * 7.8));
          float flow2 = valueNoise(vec2(vUv.x * 34.0 - vSeed * 1.4, vUv.y * 22.0 - uTime * 13.5));
          float streaks = smoothstep(0.24, 0.86, mix(flow1, flow2, 0.52));

          // Coherent glass column near orifice -> atomizing aerated wisps near top crest
          float crownBreakup = smoothstep(0.36, 0.92, vUv.y);
          float baseFade = smoothstep(0.0, 0.05, vUv.y);
          float topFade = smoothstep(0.98, 0.64, vUv.y);
          float coreDensity = mix(0.62, 0.14 + 0.52 * streaks, crownBreakup);

          vec3 crystalCore = mix(uHorizonColor * 0.94, vec3(0.95, 0.98, 1.0), 0.58);
          vec3 goldenRim = mix(vec3(1.0, 0.95, 0.84), uSunColor * 1.48, 0.78);
          vec3 col = mix(crystalCore, goldenRim, clamp(fresnel * 0.88 + backlit * 0.62 + spec * 0.92, 0.0, 1.0));
          col = mix(col, vec3(0.62, 0.75, 0.91), uNightFactor * 0.48);

          float alpha = baseFade * topFade * (coreDensity * (0.36 + 0.64 * streaks) + fresnel * 0.44 + spec * 0.25);
          alpha *= (0.10 + 0.70 * uIntensity);
          if (alpha < 0.02) discard;

          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.74));
        }
      `,
    }),
  );

  // -------------------------------------------------------------------------
  // LAYER 2: 8-Stream Symmetrical Mughal Parabolic Water Filaments
  // Coherent pressurized glass liquid near brass spout -> dissolves cleanly into individual droplets past apex!
  // -------------------------------------------------------------------------
  const arcsGeo = trackGeo(
    createEightStreamArcGeometry(
      OUTER_RING_R,
      0.0,
      0.48,
      ARC_END_R,
      WATER_SURFACE_Y - OUTER_RING_Y - 0.015,
    ),
  );

  const arcsMat = trackMat(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.9 },
        uSunColor: { value: new THREE.Color('#ffcf8c') },
        uHorizonColor: { value: new THREE.Color('#dbe8f5') },
        uSunDir: { value: new THREE.Vector3(0.62, 0.34, 0.70).normalize() },
        uNightFactor: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying float vSeed;

        void main() {
          vUv = uv;
          vec4 localPos = vec4(position, 1.0);
          vec3 localNorm = normal;
          #ifdef USE_INSTANCING
            localPos = instanceMatrix * localPos;
            localNorm = mat3(instanceMatrix) * localNorm;
            vSeed = instanceMatrix[3][2] * 0.61;
          #else
            vSeed = 0.0;
          #endif
          vec4 worldPos = modelMatrix * localPos;
          vWorldPos = worldPos.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * localNorm);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uSunColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunDir;
        uniform float uNightFactor;

        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying float vSeed;

        void main() {
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 N = normalize(vWorldNormal);
          float rim = pow(1.0 - abs(dot(N, V)), 1.85);
          float backlit = pow(max(dot(-V, uSunDir), 0.0), 3.6);
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(abs(dot(N, H)), 0.0), 30.0);

          // Coherent pressurized stream near nozzle -> rapidly pinches into broken filaments & dissolves into droplets!
          float t = vUv.x;
          float phase = vUv.y * 6.2831 + vSeed;
          float pulse1 = 0.5 + 0.5 * sin(t * 36.0 - uTime * 19.0 + phase);
          float pulse2 = 0.5 + 0.5 * sin(t * 72.0 - uTime * 29.0 - phase * 1.4);
          float pinch = smoothstep(0.36, 0.88, mix(pulse1, pulse2, 0.46));

          float breakup = mix(0.82, pinch, smoothstep(0.16, 0.52, t));
          float startFade = smoothstep(0.0, 0.035, t);
          // Dissolve continuous tube cleanly past the apex so individual falling droplets take over!
          float endFade = smoothstep(0.72, 0.34, t);

          vec3 baseCol = mix(uHorizonColor * 0.94, vec3(0.95, 0.99, 1.0), 0.64);
          vec3 goldenSpark = mix(vec3(1.0, 0.95, 0.82), uSunColor * 1.55, 0.80);
          vec3 col = mix(baseCol, goldenSpark, clamp(rim * 0.82 + backlit * 0.60 + spec * 0.95, 0.0, 1.0));
          col = mix(col, vec3(0.64, 0.78, 0.94), uNightFactor * 0.48);

          float alpha = startFade * endFade * breakup * (0.28 + 0.50 * rim + spec * 0.34) * (0.12 + 0.76 * uIntensity);
          if (alpha < 0.025) discard;

          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.72));
        }
      `,
    }),
  );

  // -------------------------------------------------------------------------
  // LAYER 3: Photorealistic Velocity-Stretched Golden-Backlit Water Streaks & Droplets
  // -------------------------------------------------------------------------
  const dropletGeo = trackGeo(createWaterStreakGeometry());

  const dropletMat = trackMat(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.9 },
        uSunColor: { value: new THREE.Color('#ffcb82') },
        uHorizonColor: { value: new THREE.Color('#e6eef7') },
        uSunDir: { value: new THREE.Vector3(0.62, 0.34, 0.70).normalize() },
        uNightFactor: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec3 vMeta; // r = ageAlpha, g = glintPhase, b = filamentFactor

        void main() {
          vec4 localPos = vec4(position, 1.0);
          vec3 localNorm = normal;
          #ifdef USE_INSTANCING
            localPos = instanceMatrix * localPos;
            localNorm = mat3(instanceMatrix) * localNorm;
          #endif
          #ifdef USE_INSTANCING_COLOR
            vMeta = instanceColor;
          #else
            vMeta = vec3(1.0, 0.5, 0.2);
          #endif
          vec4 worldPos = modelMatrix * localPos;
          vWorldPos = worldPos.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * localNorm);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uSunColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunDir;
        uniform float uNightFactor;

        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec3 vMeta;

        void main() {
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 N = normalize(vWorldNormal);
          float ndotv = abs(dot(N, V));

          // Physical refractive water silhouette: clear translucent interior + crisp bright Fresnel rim!
          float fresnel = pow(1.0 - ndotv, 1.75);
          // Golden-hour forward Mie backlighting & specular solar glint against darker trees & pool
          float backlit = pow(max(dot(-V, uSunDir), 0.0), 3.2);
          vec3 H = normalize(uSunDir + V);
          float sunSpec = pow(max(abs(dot(N, H)), 0.0), 18.0);
          float shimmer = 0.68 + 0.32 * sin(uTime * 18.0 + vMeta.g * 31.4);

          // Translucent crystal-water core shifting into warm golden-amber sunlit rim sparkle
          vec3 refractedCore = mix(uHorizonColor * 0.90, vec3(0.95, 0.99, 1.0), 0.50);
          vec3 goldenSparkle = mix(vec3(1.0, 0.94, 0.80), uSunColor * 1.78, 0.82);
          float sparkleWeight = clamp(fresnel * 0.88 + backlit * 0.64 + sunSpec * 1.25 * shimmer, 0.0, 1.0);
          vec3 col = mix(refractedCore, goldenSparkle, sparkleWeight);
          col = mix(col, vec3(0.68, 0.82, 0.98), uNightFactor * 0.50);

          // Realistic liquid translucency: semi-clear core, luminous backlit rim & solar glints
          float bodyAlpha = mix(0.22, 0.38, vMeta.b) + fresnel * 0.56 + sunSpec * 0.48;
          float alpha = clamp(bodyAlpha, 0.0, 0.88) * vMeta.r * (0.18 + 0.82 * uIntensity);
          if (alpha < 0.02) discard;

          gl_FragColor = vec4(col, alpha);
        }
      `,
    }),
  );

  // -------------------------------------------------------------------------
  // LAYER 4A: Organic Wind-Perturbed Expanding Pool Ripples & Aerated Impact Froth
  // -------------------------------------------------------------------------
  const splashGeo = trackGeo(new THREE.PlaneGeometry(2.35, 2.35));
  splashGeo.rotateX(-Math.PI * 0.5);

  const splashMat = trackMat(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.9 },
        uSunColor: { value: new THREE.Color('#ffcf8c') },
        uNightFactor: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vLocalXZ;
        varying float vSeed;

        void main() {
          vLocalXZ = position.xz;
          vec4 localPos = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            localPos = instanceMatrix * localPos;
            vSeed = instanceMatrix[3][2] * 0.83;
          #else
            vSeed = 0.0;
          #endif
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * localPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uSunColor;
        uniform float uNightFactor;

        varying vec2 vLocalXZ;
        varying float vSeed;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
          float r = length(vLocalXZ);
          float ang = atan(vLocalXZ.y, vLocalXZ.x);

          // Fine effervescent bubble/foam grain
          float bubbles1 = valueNoise(vLocalXZ * 34.0 + vec2(uTime * 1.4, -uTime * 1.2) + vSeed);
          float bubbles2 = valueNoise(vLocalXZ * 72.0 - vec2(uTime * 2.6, uTime * 2.2) - vSeed);
          float foamGrain = smoothstep(0.36, 0.86, mix(bubbles1, bubbles2, 0.5));

          // 1. Subtle aerated foam collar right around pedestal waterline (r ~ 0.34)
          float innerCollar = exp(-pow((r - 0.34) / 0.032, 2.0)) * (0.32 + 0.68 * foamGrain);

          // 2. 8 localized micro-impact frothy plumes directly under the 8 parabolic arc landings (r = 0.63)
          float eightLobes = pow(0.5 + 0.5 * cos(ang * 8.0), 5.0);
          float impactBand = exp(-pow((r - 0.63) / 0.058, 2.0));
          float impactCore = impactBand * (0.14 + 0.86 * eightLobes) * (0.38 + 0.72 * foamGrain);

          // 3. Organic wind-perturbed expanding concentric ripple crests (never rigid CAD circles!)
          float perturb = 0.018 * sin(ang * 5.0 + uTime * 2.1 + vSeed) + 0.011 * cos(ang * 8.0 - uTime * 1.8);
          float rp = r + perturb;
          float waveMod = 0.62 + 0.38 * valueNoise(vec2(ang * 2.4 + vSeed, r * 6.0 - uTime * 1.5));
          float ring1 = pow(0.5 + 0.5 * sin(rp * 38.0 - uTime * 9.2 + vSeed), 9.0);
          float ring2 = pow(0.5 + 0.5 * sin(rp * 64.0 - uTime * 13.0 - vSeed * 1.2), 10.0);
          float rippleEnvelope = smoothstep(0.32, 0.56, r) * smoothstep(1.16, 0.64, r);
          float crispRipples = (ring1 * 0.28 + ring2 * 0.14) * rippleEnvelope * waveMod;

          // Circular edge clip
          float outerFade = smoothstep(1.16, 0.88, r);
          float alpha = (innerCollar * 0.22 + impactCore * 0.56 + crispRipples) * outerFade * uIntensity;
          if (alpha < 0.02) discard;

          vec3 col = mix(vec3(0.95, 0.98, 1.0), uSunColor * 1.22, 0.48);
          col = mix(col, vec3(0.70, 0.82, 0.96), uNightFactor * 0.45);
          gl_FragColor = vec4(col, clamp(alpha * 0.46, 0.0, 0.48));
        }
      `,
    }),
  );

  // -------------------------------------------------------------------------
  // LAYER 4B: 3D Micro-Splash Crowns Erupting Where Water Arcs Strike Pool
  // -------------------------------------------------------------------------
  const crownInst = new THREE.InstancedMesh(dropletGeo, dropletMat, totalCrowns);
  crownInst.frustumCulled = false;

  // -------------------------------------------------------------------------
  // LAYER 4C: Organic Floating Micro-Bubble & Frothy Foam Flecks on Pool Surface
  // -------------------------------------------------------------------------
  const foamGeo = trackGeo(new THREE.PlaneGeometry(0.056, 0.056));
  foamGeo.rotateX(-Math.PI * 0.5);

  const foamMat = trackMat(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: {
        uSunColor: { value: new THREE.Color('#ffcf8c') },
        uNightFactor: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vMeta; // r = fadeAlpha, g = seedPhase
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING_COLOR
            vMeta = instanceColor;
          #else
            vMeta = vec3(1.0, 0.5, 0.0);
          #endif
          vec4 localPos = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            localPos = instanceMatrix * localPos;
          #endif
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * localPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor;
        uniform float uNightFactor;
        varying vec2 vUv;
        varying vec3 vMeta;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 c = (vUv - 0.5) * 2.0;
          float d = length(c);
          if (d > 1.0) discard;

          // Organic frothy micro-bubble cluster (tiny lacy bubbles + soft foam core, zero hollow donuts!)
          float ang = atan(c.y, c.x);
          float wobble = 0.82 + 0.18 * sin(ang * 3.0 + vMeta.g * 12.5) * cos(ang * 2.0 - vMeta.g * 7.3);
          float softCluster = exp(-pow(d / max(0.35, wobble), 2.0) * 3.2);
          float microSpec = smoothstep(0.32, 0.92, hash21(floor((vUv + vMeta.g) * 7.0)));
          float shape = softCluster * (0.48 + 0.65 * microSpec);
          float alpha = shape * vMeta.r * 0.54;
          if (alpha < 0.02) discard;

          vec3 col = mix(vec3(0.96, 0.98, 1.0), uSunColor * 1.18, 0.40);
          col = mix(col, vec3(0.72, 0.84, 0.96), uNightFactor * 0.45);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    }),
  );

  // -------------------------------------------------------------------------
  // LAYER 5: Soft Wispy Backlit Golden-Hour Mist Plume Drifting With Breeze
  // -------------------------------------------------------------------------
  const mistGeo = trackGeo(createCrossedPlumeGeometry(1.42, 1.56));
  const mistMat = trackMat(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
        uSunColor: { value: new THREE.Color('#ffcb8a') },
        uHorizonColor: { value: new THREE.Color('#f2c596') },
        uSunDir: { value: new THREE.Vector3(0.62, 0.34, 0.70).normalize() },
        uNightFactor: { value: 0.0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vSeed;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING
            vSeed = instanceMatrix[3][2] * 0.53;
          #else
            vSeed = 0.0;
          #endif
          vec4 wp = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vec4 worldPos = modelMatrix * wp;
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uSunColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunDir;
        uniform float uNightFactor;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vSeed;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.12);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
            mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          vec3 V = normalize(cameraPosition - vWorldPos);
          float backlit = 0.78 + 0.64 * pow(max(dot(-V, uSunDir), 0.0), 2.2);

          // Soft billowing multi-octave wisps hovering around active jet (zero hard polygon edges!)
          vec2 centered = vec2((vUv.x - 0.5) * 2.05, (vUv.y - 0.46) * 1.85);
          float radial = exp(-dot(centered, centered) * 2.65);
          float edgeMask = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x) *
                           smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.80, vUv.y);
          float wisp1 = vnoise(vec2(vUv.x * 4.2 + uTime * 0.42 + vSeed, vUv.y * 3.6 - uTime * 0.85));
          float wisp2 = vnoise(vec2(vUv.x * 8.6 - uTime * 0.55, vUv.y * 7.4 - uTime * 1.45 + vSeed));
          float wisp3 = vnoise(vec2(vUv.x * 14.0 + uTime * 0.28, vUv.y * 12.0 - uTime * 2.0));
          float mistDensity = radial * edgeMask * mix(0.42, 1.28, wisp1 * 0.52 + wisp2 * 0.32 + wisp3 * 0.16);
          float alpha = mistDensity * uIntensity * 0.26 * backlit;
          if (alpha < 0.004) discard;

          vec3 col = mix(uHorizonColor, uSunColor * 1.22, 0.78);
          col = mix(col, vec3(0.62, 0.78, 0.96), uNightFactor * 0.65);
          gl_FragColor = vec4(col * (1.18 * alpha), alpha);
        }
      `,
    }),
  );

  const jetInst = new THREE.InstancedMesh(jetStreamGeo, jetStreamMat, nozzleCount);
  const arcsInst = new THREE.InstancedMesh(arcsGeo, arcsMat, nozzleCount);
  const dropletInst = new THREE.InstancedMesh(dropletGeo, dropletMat, totalDroplets);
  const splashInst = new THREE.InstancedMesh(splashGeo, splashMat, nozzleCount);
  const foamInst = new THREE.InstancedMesh(foamGeo, foamMat, totalFoam);
  const mistInst = new THREE.InstancedMesh(mistGeo, mistMat, nozzleCount);

  jetInst.frustumCulled = false;
  arcsInst.frustumCulled = false;
  dropletInst.frustumCulled = false;
  splashInst.frustumCulled = false;
  foamInst.frustumCulled = false;
  mistInst.frustumCulled = false;

  // Guarantee all 7 fountain layers sort cleanly on top of the reflecting pool surface
  splashInst.renderOrder = 4;
  foamInst.renderOrder = 5;
  jetInst.renderOrder = 6;
  arcsInst.renderOrder = 6;
  dropletInst.renderOrder = 7;
  crownInst.renderOrder = 7;
  mistInst.renderOrder = 8;

  root.add(jetInst, arcsInst, dropletInst, splashInst, crownInst, foamInst, mistInst);

  // Pre-seeded deterministic fluid launch parameters aligned closely to the 8 ballistic arcs & central crown
  const rand = seededRand(1653);
  interface DropletSeed {
    isOuterArc: boolean;
    baseAngle: number;
    radialSpeed: number;
    upSpeed: number;
    phaseOffset: number;
    lifeDuration: number;
    size: number;
    startHeightJitter: number;
    glintSeed: number;
  }
  const dropletSeeds: DropletSeed[] = [];
  for (let d = 0; d < totalDroplets; d += 1) {
    const localIdx = d % dropletsPerNozzle;
    const isOuterArc = localIdx >= 36;
    if (isOuterArc) {
      const streamIdx = (localIdx - 36) % 8;
      // Tight coherence near nozzle breaking naturally into scattered droplets on descent
      const streamAngle = (streamIdx / 8) * Math.PI * 2 + (rand() - 0.5) * 0.16;
      dropletSeeds.push({
        isOuterArc: true,
        baseAngle: streamAngle,
        radialSpeed: 0.68 + rand() * 0.28,
        upSpeed: 2.52 + rand() * 0.62,
        phaseOffset: rand(),
        lifeDuration: 0.68 + rand() * 0.22,
        size: 0.54 + rand() * 0.78, // varied glistening droplet & streak sizes!
        startHeightJitter: 0,
        glintSeed: rand(),
      });
    } else {
      const crownAngle = (localIdx / 36) * Math.PI * 2 + (rand() - 0.5) * 0.34;
      dropletSeeds.push({
        isOuterArc: false,
        baseAngle: crownAngle,
        radialSpeed: 0.16 + rand() * 0.44,
        upSpeed: 2.85 + rand() * 1.15,
        phaseOffset: rand(),
        lifeDuration: 0.68 + rand() * 0.26,
        size: 0.46 + rand() * 0.68,
        startHeightJitter: rand() * 0.36,
        glintSeed: rand(),
      });
    }
  }

  // Deterministic micro-splash crown eruption seeds (3 sparkling upward-splashing crown droplets per arc landing)
  interface CrownSeed {
    streamAngle: number;
    splashOutAngle: number;
    outSpeed: number;
    upSpeed: number;
    phaseOffset: number;
    lifeDuration: number;
    size: number;
    glintSeed: number;
  }
  const crownSeeds: CrownSeed[] = [];
  for (let c = 0; c < totalCrowns; c += 1) {
    const localIdx = c % crownsPerNozzle;
    const streamIdx = localIdx % 8;
    const streamAngle = (streamIdx / 8) * Math.PI * 2;
    crownSeeds.push({
      streamAngle,
      splashOutAngle: rand() * Math.PI * 2,
      outSpeed: 0.18 + rand() * 0.28,
      upSpeed: 1.18 + rand() * 0.68,
      phaseOffset: rand(),
      lifeDuration: 0.28 + rand() * 0.14,
      size: 0.58 + rand() * 0.46,
      glintSeed: rand(),
    });
  }

  // Deterministic floating dissipating foam & bubble fleck seeds around each splash impact
  interface FoamSeed {
    streamAngle: number;
    driftAngle: number;
    driftDist: number;
    phaseOffset: number;
    lifeDuration: number;
    size: number;
    seedPhase: number;
  }
  const foamSeeds: FoamSeed[] = [];
  for (let f = 0; f < totalFoam; f += 1) {
    const localIdx = f % foamPerNozzle;
    const streamIdx = localIdx % 8;
    foamSeeds.push({
      streamAngle: (streamIdx / 8) * Math.PI * 2 + (rand() - 0.5) * 0.22,
      driftAngle: rand() * Math.PI * 2,
      driftDist: 0.06 + rand() * 0.24,
      phaseOffset: rand(),
      lifeDuration: 1.05 + rand() * 0.55,
      size: 0.52 + rand() * 0.88,
      seedPhase: rand(),
    });
  }

  // Module-scope reusable scratch objects (zero per-frame heap allocations)
  const _dummy = new THREE.Object3D();
  const _upVec = new THREE.Vector3(0, 1, 0);
  const _velDir = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _metaCol = new THREE.Color();
  const _sunCol = new THREE.Color('#ffcf8c');
  const _horizCol = new THREE.Color('#dbe8f5');

  // Initialize instanceColor buffers cleanly on frame 0
  _metaCol.setRGB(1, 0.5, 0.5);
  for (let i = 0; i < totalDroplets; i += 1) dropletInst.setColorAt(i, _metaCol);
  for (let i = 0; i < totalCrowns; i += 1) crownInst.setColorAt(i, _metaCol);
  for (let i = 0; i < totalFoam; i += 1) foamInst.setColorAt(i, _metaCol);

  // Track per-nozzle hidden state so calm nozzles never re-write hundreds of hidden matrices every frame
  const nozzleWasHidden = new Uint8Array(nozzleCount);
  // Pre-hide unused LOD slots on distant nozzles (>35m from resting hero camera) once at startup
  const _hiddenMat = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
  _hiddenMat.setPosition(0, -5, 0);
  const farDropletLimit = 48;
  const farCrownLimit = 8;
  const farFoamLimit = 8;
  for (let i = 0; i < nozzleCount; i += 1) {
    if (activeNozzles[i].z < 72) {
      const baseDrop = i * dropletsPerNozzle;
      for (let k = farDropletLimit; k < dropletsPerNozzle; k += 1) dropletInst.setMatrixAt(baseDrop + k, _hiddenMat);
      const baseCrown = i * crownsPerNozzle;
      for (let c = farCrownLimit; c < crownsPerNozzle; c += 1) crownInst.setMatrixAt(baseCrown + c, _hiddenMat);
      const baseFoam = i * foamPerNozzle;
      for (let f = farFoamLimit; f < foamPerNozzle; f += 1) foamInst.setMatrixAt(baseFoam + f, _hiddenMat);
    }
  }

  return {
    root,
    surfaceSplashObjects: [splashInst, crownInst, foamInst],
    update: (
      elapsedSec: number,
      buildProgress: number,
      breezeStrength: number,
      overrideMode: 'auto' | 'on' | 'off',
    ) => {
      const buildGate = THREE.MathUtils.smoothstep(buildProgress, 0.12, 0.28);
      let aggregateIntensity = 0;

      // Subtle organic breeze drift vector (slight gust modulation)
      const gust = 1.0 + 0.18 * Math.sin(elapsedSec * 0.85);
      const windSpeedX = 0.30 * breezeStrength * gust;
      const windSpeedZ = -0.11 * breezeStrength * gust;

      for (let i = 0; i < nozzleCount; i += 1) {
        const nozzle = activeNozzles[i];
        const nozzleRotY = (nozzle.index % 2) * (Math.PI / 8);
        const isFarNozzle = nozzle.z < 72;
        const activeDrops = isFarNozzle ? farDropletLimit : dropletsPerNozzle;
        const activeCrowns = isFarNozzle ? farCrownLimit : crownsPerNozzle;
        const activeFoams = isFarNozzle ? farFoamLimit : foamPerNozzle;

        let intensity: number;
        if (overrideMode === 'on') {
          intensity = 0.93 + 0.07 * Math.sin(elapsedSec * 3.1 + i * 0.7);
        } else if (overrideMode === 'off') {
          intensity = 0;
        } else {
          intensity = computeSprinklerIntensity(elapsedSec, nozzle.index, fountainCount);
        }
        intensity *= buildGate;
        aggregateIntensity += intensity;

        if (intensity <= 0.015) {
          if (!nozzleWasHidden[i]) {
            nozzleWasHidden[i] = 1;
            jetInst.setMatrixAt(i, _hiddenMat);
            arcsInst.setMatrixAt(i, _hiddenMat);
            splashInst.setMatrixAt(i, _hiddenMat);
            mistInst.setMatrixAt(i, _hiddenMat);

            const baseDrop = i * dropletsPerNozzle;
            for (let k = 0; k < activeDrops; k += 1) dropletInst.setMatrixAt(baseDrop + k, _hiddenMat);
            const baseCrown = i * crownsPerNozzle;
            for (let c = 0; c < activeCrowns; c += 1) crownInst.setMatrixAt(baseCrown + c, _hiddenMat);
            const baseFoam = i * foamPerNozzle;
            for (let f = 0; f < activeFoams; f += 1) foamInst.setMatrixAt(baseFoam + f, _hiddenMat);
          }
          continue;
        }
        nozzleWasHidden[i] = 0;

        const jitter = 1.0 + 0.045 * Math.sin(elapsedSec * 12.0 + i * 1.9);

        // Layer 1: Slender central aerated water jet column rising from bronze central orifice
        const jetHeight = (0.24 + 0.72 * intensity) * jitter;
        const jetRadius = 0.65 + 0.35 * intensity;
        _dummy.position.set(0, NOZZLE_TIP_Y, nozzle.z);
        _dummy.rotation.set(0, nozzleRotY + elapsedSec * 0.9, 0);
        _dummy.scale.set(jetRadius, jetHeight, jetRadius);
        _dummy.updateMatrix();
        jetInst.setMatrixAt(i, _dummy.matrix);

        // Layer 2: 8 symmetrical parabolic water filaments emerging directly from the 8 brass micro-spouts
        const arcScaleXZ = (0.45 + 0.56 * intensity) * (0.97 + 0.03 * Math.cos(elapsedSec * 9.2 + i));
        const arcScaleY = (0.42 + 0.60 * intensity) * jitter;
        _dummy.position.set(0, OUTER_RING_Y, nozzle.z);
        _dummy.rotation.set(0, nozzleRotY, 0);
        _dummy.scale.set(arcScaleXZ, arcScaleY, arcScaleXZ);
        _dummy.updateMatrix();
        arcsInst.setMatrixAt(i, _dummy.matrix);

        // Layer 4A: Organic wind-perturbed expanding concentric ripple rings synced to arc landing radius
        _dummy.position.set(0, WATER_SURFACE_Y + 0.011, nozzle.z);
        _dummy.rotation.set(0, nozzleRotY, 0);
        _dummy.scale.set(arcScaleXZ, 1, arcScaleXZ);
        _dummy.updateMatrix();
        splashInst.setMatrixAt(i, _dummy.matrix);

        // Layer 5: Soft wispy golden backlit mist plume leaning & drifting downwind with breeze
        const mistScale = 0.78 + 0.46 * intensity;
        const mistDriftX = windSpeedX * 0.72 + Math.sin(elapsedSec * 1.1 + i) * 0.05;
        const mistDriftZ = windSpeedZ * 0.72 + Math.cos(elapsedSec * 0.9 + i) * 0.04;
        _dummy.position.set(mistDriftX, OUTER_RING_Y - 0.16, nozzle.z + mistDriftZ);
        _dummy.rotation.set(
          windSpeedZ * 0.25,
          nozzleRotY + Math.sin(elapsedSec * 0.35 + i) * 0.22,
          -windSpeedX * 0.28,
        );
        _dummy.scale.set(mistScale * 1.06, mistScale, mistScale * 1.06);
        _dummy.updateMatrix();
        mistInst.setMatrixAt(i, _dummy.matrix);

        // Layer 3: Distance-adaptive velocity-stretched translucent water streaks & backlit droplets
        const baseIdx = i * dropletsPerNozzle;
        const speedScale = 0.48 + 0.54 * intensity;

        for (let k = 0; k < activeDrops; k += 1) {
          const seed = dropletSeeds[baseIdx + k];
          const ageNorm = ((elapsedSec / seed.lifeDuration) + seed.phaseOffset) % 1.0;
          const tSec = ageNorm * seed.lifeDuration;

          const worldAngle = seed.baseAngle - nozzleRotY;
          const cosA = Math.cos(worldAngle);
          const sinA = Math.sin(worldAngle);

          const startR = seed.isOuterArc ? OUTER_RING_R : 0.014;
          const startY = seed.isOuterArc ? OUTER_RING_Y : NOZZLE_TIP_Y + seed.startHeightJitter * intensity;

          const vRadial = seed.radialSpeed * speedScale;
          const vUp0 = seed.upSpeed * speedScale;

          // Subtle aerodynamic turbulence breakup increases naturally after apex
          const breakupJitter = ageNorm * ageNorm * 0.042;
          const px =
            cosA * (startR + vRadial * tSec) +
            windSpeedX * tSec * tSec * 1.12 +
            Math.sin(seed.glintSeed * 25.0 + tSec * 4.0) * breakupJitter;
          const py = startY + vUp0 * tSec - 0.5 * GRAVITY * tSec * tSec;
          const pz =
            nozzle.z +
            sinA * (startR + vRadial * tSec) +
            windSpeedZ * tSec * tSec * 1.12 +
            Math.cos(seed.glintSeed * 19.0 + tSec * 4.0) * breakupJitter;

          if (py < WATER_SURFACE_Y - 0.008) {
            _dummy.position.set(0, -5, nozzle.z);
            _dummy.quaternion.identity();
            _dummy.scale.set(0.0001, 0.0001, 0.0001);
            _metaCol.setRGB(0, 0, 0);
          } else {
            const vx = cosA * vRadial + 2.24 * windSpeedX * tSec;
            const vy = vUp0 - GRAVITY * tSec;
            const vz = sinA * vRadial + 2.24 * windSpeedZ * tSec;
            const speed = Math.hypot(vx, vy, vz);

            if (speed > 0.001) {
              _velDir.set(vx / speed, vy / speed, vz / speed);
              _quat.setFromUnitVectors(_upVec, _velDir);
              _dummy.quaternion.copy(_quat);
            } else {
              _dummy.quaternion.identity();
            }

            // Near nozzle (ageNorm < 0.32): elongated liquid streak filament; past apex: distinct glistening droplets!
            const filamentFactor = Math.max(0, 1.0 - ageNorm / 0.36);
            const dropRadius = seed.size * (0.50 + 0.50 * intensity) * (0.68 + 0.32 * (1.0 - filamentFactor * 0.45));
            const velStretch =
              1.18 + Math.min(2.8, speed * 0.46) + filamentFactor * 2.1;

            const fadeIn = THREE.MathUtils.smoothstep(ageNorm, 0.0, 0.06);
            const fadeOut = 1.0 - THREE.MathUtils.smoothstep(ageNorm, 0.82, 1.0);
            const alphaFade = fadeIn * fadeOut;

            _dummy.position.set(px, py, pz);
            _dummy.scale.set(dropRadius * 0.64, dropRadius * velStretch, dropRadius * 0.64);
            _metaCol.setRGB(alphaFade, seed.glintSeed, filamentFactor);
          }
          _dummy.updateMatrix();
          dropletInst.setMatrixAt(baseIdx + k, _dummy.matrix);
          dropletInst.setColorAt(baseIdx + k, _metaCol);
        }

        // Layer 4B: 3D micro-splash crowns erupting upward at the 8 parabolic arc impact spots
        const baseCrown = i * crownsPerNozzle;
        const impactR = ARC_END_R * arcScaleXZ;
        for (let c = 0; c < activeCrowns; c += 1) {
          const cs = crownSeeds[baseCrown + c];
          const ageNorm = ((elapsedSec / cs.lifeDuration) + cs.phaseOffset) % 1.0;
          const tSec = ageNorm * cs.lifeDuration;

          const impactAngle = cs.streamAngle - nozzleRotY;
          const ix = Math.cos(impactAngle) * impactR + windSpeedX * 0.16;
          const iz = nozzle.z + Math.sin(impactAngle) * impactR + windSpeedZ * 0.16;

          const spX = ix + Math.cos(cs.splashOutAngle) * cs.outSpeed * tSec;
          const spY = WATER_SURFACE_Y + 0.012 + cs.upSpeed * intensity * tSec - 0.5 * GRAVITY * tSec * tSec;
          const spZ = iz + Math.sin(cs.splashOutAngle) * cs.outSpeed * tSec;

          if (spY < WATER_SURFACE_Y) {
            _dummy.position.set(0, -5, nozzle.z);
            _dummy.scale.set(0.0001, 0.0001, 0.0001);
            _metaCol.setRGB(0, 0, 0);
          } else {
            const vx = Math.cos(cs.splashOutAngle) * cs.outSpeed;
            const vy = cs.upSpeed * intensity - GRAVITY * tSec;
            const vz = Math.sin(cs.splashOutAngle) * cs.outSpeed;
            const sp = Math.max(0.001, Math.hypot(vx, vy, vz));
            _velDir.set(vx / sp, vy / sp, vz / sp);
            _quat.setFromUnitVectors(_upVec, _velDir);
            _dummy.quaternion.copy(_quat);

            const fade = Math.sin(ageNorm * Math.PI) * intensity;
            const sc = cs.size * (0.62 + 0.44 * fade);
            _dummy.position.set(spX, spY, spZ);
            _dummy.scale.set(sc * 0.62, sc * (1.25 + Math.min(1.5, sp * 0.58)), sc * 0.62);
            _metaCol.setRGB(fade * 0.96, cs.glintSeed, 0.35);
          }
          _dummy.updateMatrix();
          crownInst.setMatrixAt(baseCrown + c, _dummy.matrix);
          crownInst.setColorAt(baseCrown + c, _metaCol);
        }

        // Layer 4C: Organic floating micro-bubble & foam flecks drifting outward from splash impact and dissipating quickly
        const baseFoam = i * foamPerNozzle;
        for (let f = 0; f < activeFoams; f += 1) {
          const fs = foamSeeds[baseFoam + f];
          const ageNorm = ((elapsedSec / fs.lifeDuration) + fs.phaseOffset) % 1.0;
          const impactAngle = fs.streamAngle - nozzleRotY;
          const ix = Math.cos(impactAngle) * impactR + windSpeedX * 0.16;
          const iz = nozzle.z + Math.sin(impactAngle) * impactR + windSpeedZ * 0.16;

          const easeOut = 1.0 - (1.0 - ageNorm) * (1.0 - ageNorm);
          const fx = ix + Math.cos(fs.driftAngle) * fs.driftDist * easeOut + windSpeedX * ageNorm * 0.18;
          const fz = iz + Math.sin(fs.driftAngle) * fs.driftDist * easeOut + windSpeedZ * ageNorm * 0.18;

          const fadeIn = THREE.MathUtils.smoothstep(ageNorm, 0.0, 0.10);
          const dissipate = 1.0 - THREE.MathUtils.smoothstep(ageNorm, 0.42, 1.0);
          const foamAlpha = fadeIn * dissipate * intensity;
          const sc = fs.size * (0.65 + 0.55 * easeOut);

          _dummy.position.set(fx, WATER_SURFACE_Y + 0.014, fz);
          _dummy.rotation.set(0, fs.driftAngle + ageNorm * 0.8, 0);
          _dummy.scale.set(sc, 1.0, sc);
          _dummy.updateMatrix();
          foamInst.setMatrixAt(baseFoam + f, _dummy.matrix);
          _metaCol.setRGB(foamAlpha, fs.seedPhase, 0);
          foamInst.setColorAt(baseFoam + f, _metaCol);
        }
      }

      jetInst.instanceMatrix.needsUpdate = true;
      arcsInst.instanceMatrix.needsUpdate = true;
      dropletInst.instanceMatrix.needsUpdate = true;
      if (dropletInst.instanceColor) dropletInst.instanceColor.needsUpdate = true;
      splashInst.instanceMatrix.needsUpdate = true;
      crownInst.instanceMatrix.needsUpdate = true;
      if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
      foamInst.instanceMatrix.needsUpdate = true;
      if (foamInst.instanceColor) foamInst.instanceColor.needsUpdate = true;
      mistInst.instanceMatrix.needsUpdate = true;

      const avgIntensity = nozzleCount > 0 ? aggregateIntensity / nozzleCount : 0;

      jetStreamMat.uniforms.uTime.value = elapsedSec;
      jetStreamMat.uniforms.uIntensity.value = avgIntensity;
      arcsMat.uniforms.uTime.value = elapsedSec;
      arcsMat.uniforms.uIntensity.value = avgIntensity;
      dropletMat.uniforms.uTime.value = elapsedSec;
      dropletMat.uniforms.uIntensity.value = avgIntensity;
      splashMat.uniforms.uTime.value = elapsedSec;
      splashMat.uniforms.uIntensity.value = avgIntensity;
      mistMat.uniforms.uTime.value = elapsedSec;
      mistMat.uniforms.uIntensity.value = avgIntensity;

      return avgIntensity;
    },
    applyTint: (
      sunColorHex: string,
      horizonColorHex: string,
      nightFactor: number,
      sunDir?: THREE.Vector3,
    ) => {
      _sunCol.set(sunColorHex);
      _horizCol.set(horizonColorHex);

      jetStreamMat.uniforms.uSunColor.value.copy(_sunCol);
      jetStreamMat.uniforms.uHorizonColor.value.copy(_horizCol);
      jetStreamMat.uniforms.uNightFactor.value = nightFactor;
      if (sunDir) jetStreamMat.uniforms.uSunDir.value.copy(sunDir);

      arcsMat.uniforms.uSunColor.value.copy(_sunCol);
      arcsMat.uniforms.uHorizonColor.value.copy(_horizCol);
      arcsMat.uniforms.uNightFactor.value = nightFactor;
      if (sunDir) arcsMat.uniforms.uSunDir.value.copy(sunDir);

      dropletMat.uniforms.uSunColor.value.copy(_sunCol);
      dropletMat.uniforms.uHorizonColor.value.copy(_horizCol);
      dropletMat.uniforms.uNightFactor.value = nightFactor;
      if (sunDir) dropletMat.uniforms.uSunDir.value.copy(sunDir);

      splashMat.uniforms.uSunColor.value.copy(_sunCol);
      splashMat.uniforms.uNightFactor.value = nightFactor;

      foamMat.uniforms.uSunColor.value.copy(_sunCol);
      foamMat.uniforms.uNightFactor.value = nightFactor;

      mistMat.uniforms.uSunColor.value.copy(_sunCol);
      mistMat.uniforms.uHorizonColor.value.copy(_horizCol);
      mistMat.uniforms.uNightFactor.value = nightFactor;
      if (sunDir) mistMat.uniforms.uSunDir.value.copy(sunDir);
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
