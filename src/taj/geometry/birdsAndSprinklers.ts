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
  applyTint: (sunColorHex: string, nightFactor: number) => void;
  dispose: () => void;
}

export interface FountainSprinklersHandles {
  root: THREE.Group;
  /** Update multi-tier jets, parabolic arcs, droplets & splash rings; returns aggregate spray intensity [0..1]. */
  update: (
    elapsedSec: number,
    buildProgress: number,
    breezeStrength: number,
    overrideMode: 'auto' | 'on' | 'off',
  ) => number;
  applyTint: (sunColorHex: string, horizonColorHex: string, nightFactor: number) => void;
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

/** Build a sculpted tapered bird wing BufferGeometry extending along +X (right) or -X (left). */
function createBirdWingGeometry(side: 1 | -1): THREE.BufferGeometry {
  // Aerodynamic swept wing polygon with cambered arch: shoulder -> elbow -> wingtip -> trailing edge
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.14); // leading shoulder
  shape.quadraticCurveTo(side * 0.28, 0.2, side * 0.56, 0.08); // forearm & wrist
  shape.quadraticCurveTo(side * 0.84, -0.02, side * 1.0, -0.14); // primary feather wingtip
  shape.quadraticCurveTo(side * 0.68, -0.22, side * 0.34, -0.19); // secondary trailing feathers
  shape.quadraticCurveTo(side * 0.14, -0.18, 0, -0.14); // inner trailing root
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 5);
  // Rotate from XY plane into XZ horizontal wing plane (nose faces +Z)
  geo.rotateX(-Math.PI * 0.5);

  // Add subtle realistic upward camber along the wing chord
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = Math.abs(pos.getX(i));
    const z = pos.getZ(i);
    const camber = Math.sin(Math.min(1, x) * Math.PI * 0.85) * 0.045 + Math.max(0, z) * 0.06;
    pos.setY(i, camber);
  }
  geo.computeVertexNormals();
  return geo;
}

interface BirdInstance {
  group: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  spec: BirdFlightSpec;
}

/**
 * Create graceful flocks of sculpted flapping & gliding birds circling the Taj Mahal domes,
 * sweeping over the Charbagh reflecting pool, and soaring above the Yamuna River.
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

  // Streamlined fuselage (scaled sphere elongated along +Z) + fanned tail wedge
  const bodyGeo = trackGeo(new THREE.SphereGeometry(0.14, 8, 6));
  bodyGeo.scale(0.85, 0.72, 2.75);

  const tailGeo = trackGeo(new THREE.ConeGeometry(0.16, 0.36, 4));
  tailGeo.rotateX(-Math.PI * 0.5);
  tailGeo.scale(1.2, 0.16, 1.0);

  const leftWingGeo = trackGeo(createBirdWingGeometry(-1));
  const rightWingGeo = trackGeo(createBirdWingGeometry(1));

  // Two authentic Agra plumage palettes: crisp white doves/egrets & dark slate-grey pigeons (high sky contrast!)
  const doveMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf4f1ea,
      roughness: 0.72,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
  );
  const pigeonMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b4450,
      roughness: 0.78,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  );
  const pigeonWingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x262e38,
      roughness: 0.8,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  );

  const rand = seededRand(1648);
  const specs: Array<{ spec: BirdFlightSpec; isDove: boolean }> = [];

  // Flock 1: 5 Agra pigeons & doves circling high around the onion dome & four minarets
  for (let i = 0; i < 5; i += 1) {
    const isDove = i % 2 === 0;
    specs.push({
      isDove,
      spec: {
        centerX: (rand() - 0.5) * 14,
        centerZ: 8 + (rand() - 0.5) * 16,
        radiusX: 24 + rand() * 22,
        radiusZ: 20 + rand() * 20,
        baseAltitude: 25 + rand() * 13,
        altitudeWave: 1.6 + rand() * 2.0,
        angularSpeed: 0.16 + rand() * 0.07,
        phase: (i / 5) * Math.PI * 2 + rand() * 0.5,
        direction: i < 3 ? 1 : -1,
        figureEightAmp: 4.0 + rand() * 4.5,
        flapSpeed: 8.5 + rand() * 2.6,
        wingSpan: isDove ? 0.88 + rand() * 0.2 : 0.82 + rand() * 0.18,
      },
    });
  }

  // Flock 2: 3 swifts & doves sweeping gently over the Charbagh reflecting pool & cypress avenue
  for (let i = 0; i < 3; i += 1) {
    const isDove = i % 2 === 0;
    specs.push({
      isDove,
      spec: {
        centerX: (rand() - 0.5) * 10,
        centerZ: 56 + (rand() - 0.5) * 18,
        radiusX: 17 + rand() * 15,
        radiusZ: 22 + rand() * 14,
        baseAltitude: 12.5 + rand() * 7.5,
        altitudeWave: 1.4 + rand() * 1.4,
        angularSpeed: 0.2 + rand() * 0.07,
        phase: (i / 3) * Math.PI * 2 + rand() * 0.6,
        direction: i % 2 === 0 ? 1 : -1,
        figureEightAmp: 3.5 + rand() * 4.0,
        flapSpeed: 9.6 + rand() * 2.4,
        wingSpan: 0.76 + rand() * 0.18,
      },
    });
  }

  // Flock 3: 3 white river egrets & kites gliding across the Yamuna River behind the Taj Mahal
  for (let i = 0; i < 3; i += 1) {
    const isDove = i !== 1;
    specs.push({
      isDove,
      spec: {
        centerX: (rand() - 0.5) * 40,
        centerZ: -86 + (rand() - 0.5) * 24,
        radiusX: 34 + rand() * 24,
        radiusZ: 18 + rand() * 16,
        baseAltitude: 13 + rand() * 12,
        altitudeWave: 1.8 + rand() * 2.0,
        angularSpeed: 0.14 + rand() * 0.06,
        phase: (i / 3) * Math.PI * 2 + rand() * 0.6,
        direction: i < 2 ? 1 : -1,
        figureEightAmp: 5.5 + rand() * 5.0,
        flapSpeed: 7.4 + rand() * 2.2,
        wingSpan: 1.0 + rand() * 0.24,
      },
    });
  }

  const birds: BirdInstance[] = [];
  for (const entry of specs) {
    const birdGroup = new THREE.Group();
    const bodyMat = entry.isDove ? doveMat : pigeonMat;
    const wingMat = entry.isDove ? doveMat : pigeonWingMat;

    const body = new THREE.Mesh(bodyGeo, bodyMat);
    birdGroup.add(body);

    const tail = new THREE.Mesh(tailGeo, wingMat);
    tail.position.set(0, 0.01, -0.34);
    birdGroup.add(tail);

    const leftWing = new THREE.Mesh(leftWingGeo, wingMat);
    leftWing.position.set(-0.04, 0.03, 0.04);
    birdGroup.add(leftWing);

    const rightWing = new THREE.Mesh(rightWingGeo, wingMat);
    rightWing.position.set(0.04, 0.03, 0.04);
    birdGroup.add(rightWing);

    birdGroup.scale.setScalar(entry.spec.wingSpan);
    root.add(birdGroup);

    birds.push({
      group: birdGroup,
      leftWing,
      rightWing,
      spec: entry.spec,
    });
  }

  const _doveBase = new THREE.Color('#f4f1ea');
  const _pigeonBase = new THREE.Color('#3b4450');
  const _pigeonWingBase = new THREE.Color('#262e38');
  const _sunTint = new THREE.Color('#fff5e2');
  const _nightTint = new THREE.Color('#6f88ad');

  const update = (elapsedSec: number) => {
    for (let i = 0; i < birds.length; i += 1) {
      const b = birds[i];
      const pose = computeBirdFlightPose(b.spec, elapsedSec);
      b.group.position.set(pose.x, pose.y, pose.z);
      b.group.rotation.set(-pose.pitch, pose.yaw, pose.bank, 'YXZ');
      b.leftWing.rotation.z = -pose.wingAngle;
      b.rightWing.rotation.z = pose.wingAngle;
    }
  };

  // Place birds in natural initial flight poses immediately on frame 0
  update(2.4);

  return {
    root,
    update,
    applyTint: (sunColorHex: string, nightFactor: number) => {
      _sunTint.set(sunColorHex);
      doveMat.color.copy(_doveBase).lerp(_sunTint, 0.22).lerp(_nightTint, nightFactor * 0.45);
      pigeonMat.color.copy(_pigeonBase).lerp(_sunTint, 0.1).lerp(_nightTint, nightFactor * 0.3);
      pigeonWingMat.color.copy(_pigeonWingBase).lerp(_nightTint, nightFactor * 0.25);
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

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

  // Solve exact ballistic parabola y(s) = startY + vY * s - 0.5 * g * s^2 for s in [0, 1]
  // Peak occurs at sPeak = vY / g where y(sPeak) = startY + peakRise, and y(1) = endY.
  const dropFromPeak = peakRise + (startY - endY);
  const sPeak = Math.sqrt(peakRise) / (Math.sqrt(peakRise) + Math.sqrt(Math.max(0.01, dropFromPeak)));
  const gEff = (2 * peakRise) / (sPeak * sPeak);
  const vY = gEff * sPeak;

  const samplePoints = 18;
  const tubularSegments = 28;
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

    const tube = new THREE.TubeGeometry(curve, tubularSegments, 0.0088, radialSegments, false);
    const pAttr = tube.attributes.position as THREE.BufferAttribute;
    const nAttr = tube.attributes.normal as THREE.BufferAttribute;
    const uvAttr = tube.attributes.uv as THREE.BufferAttribute;

    // Taper radius organically along ballistic arc: sleek glass stream at brass spout -> bubbly flare -> thin plunge
    for (let v = 0; v < pAttr.count; v += 1) {
      const uAlong = uvAttr.getX(v);
      const center = curve.getPointAt(Math.min(1, Math.max(0, uAlong)));
      const taper = 0.68 + 0.5 * Math.sin(uAlong * Math.PI * 0.88) - 0.25 * uAlong * uAlong;
      const vx = center.x + (pAttr.getX(v) - center.x) * taper;
      const vy = center.y + (pAttr.getY(v) - center.y) * taper;
      const vz = center.z + (pAttr.getZ(v) - center.z) * taper;

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
 * Create a detailed 4-layer intermittent reflecting-pool fountain sprinkler system:
 * 1. Flowing GLSL central aerated pressurized water jet column
 * 2. 8-stream symmetrical Mughal parabolic water filaments emerging from the brass micro-spouts
 * 3. 36 velocity-oriented, breeze-drifting sparkling water droplets & mist beads per nozzle
 * 4. Animated pool-surface impact froth & concentric splash rings
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
  const dropletsPerNozzle = 52;
  const totalDroplets = nozzleCount * dropletsPerNozzle;

  // Exact hardware coordinates matching gardenEnvironment.ts (pedestal baseY = 0.02)
  const WATER_SURFACE_Y = 0.18;
  const OUTER_RING_Y = 0.719;
  const OUTER_RING_R = 0.111;
  const ARC_END_R = 0.63;
  const NOZZLE_TIP_Y = 0.805;
  const GRAVITY = 7.8;

  // -------------------------------------------------------------------------
  // LAYER 1: Flowing GLSL Central Aerated Pressurized Water Jet Column
  // -------------------------------------------------------------------------
  const jetProfile = [
    new THREE.Vector2(0.014, 0.0),
    new THREE.Vector2(0.017, 0.22),
    new THREE.Vector2(0.025, 0.52),
    new THREE.Vector2(0.038, 0.78),
    new THREE.Vector2(0.048, 0.91),
    new THREE.Vector2(0.032, 0.98),
    new THREE.Vector2(0.010, 1.0),
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
        uSunColor: { value: new THREE.Color('#fff5e2') },
        uHorizonColor: { value: new THREE.Color('#dbe8f5') },
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
          float ndotv = abs(dot(N, V));
          float fresnel = pow(1.0 - ndotv, 1.7);

          // Fast upward-rushing aerated water streaks
          float flow1 = valueNoise(vec2(vUv.x * 14.0 + vSeed, vUv.y * 8.5 - uTime * 5.2));
          float flow2 = valueNoise(vec2(vUv.x * 26.0 - vSeed * 1.4, vUv.y * 16.0 - uTime * 8.8));
          float streaks = mix(flow1, flow2, 0.45);

          // Frothy aerated crown near upper 30% of jet
          float crownFroth = smoothstep(0.55, 0.96, vUv.y);
          float baseFade = smoothstep(0.0, 0.07, vUv.y);
          float topFade = smoothstep(1.0, 0.82, vUv.y);
          float coreDensity = mix(0.86, 0.54, crownFroth);

          vec3 waterBase = mix(uHorizonColor, vec3(0.97, 0.99, 1.0), 0.72);
          vec3 sunlitGlint = mix(vec3(1.0), uSunColor, 0.32);
          vec3 col = mix(waterBase, sunlitGlint, clamp(fresnel * 0.75 + streaks * 0.42 + crownFroth * 0.3, 0.0, 1.0));
          col = mix(col, vec3(0.62, 0.75, 0.91), uNightFactor * 0.45);

          float alpha = baseFade * topFade * (coreDensity * (0.48 + 0.52 * streaks) + fresnel * 0.34);
          alpha *= (0.14 + 0.72 * uIntensity);
          if (alpha < 0.02) discard;

          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.9));
        }
      `,
    }),
  );

  // -------------------------------------------------------------------------
  // LAYER 2: 8-Stream Symmetrical Mughal Parabolic Water Filaments
  // -------------------------------------------------------------------------
  // Local origin at (0, OUTER_RING_Y, 0) so scaling with intensity shrinks cleanly into the brass spouts
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
        uSunColor: { value: new THREE.Color('#fff5e2') },
        uHorizonColor: { value: new THREE.Color('#dbe8f5') },
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
        uniform float uNightFactor;

        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying float vSeed;

        void main() {
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 N = normalize(vWorldNormal);
          float rim = pow(1.0 - abs(dot(N, V)), 1.5);

          // Rushing beaded water pulses racing along each parabolic filament
          float t = vUv.x;
          float phase = vUv.y * 6.2831 + vSeed;
          float pulse1 = 0.5 + 0.5 * sin(t * 28.0 - uTime * 15.5 + phase);
          float pulse2 = 0.5 + 0.5 * sin(t * 54.0 - uTime * 23.0 - phase * 1.3);
          float beads = mix(pulse1, pulse2, 0.42);

          // Continuous glossy glass-stream near brass spout, breaking into aerated beads past the apex
          float breakup = mix(0.88, 0.38 + 0.62 * beads, smoothstep(0.28, 0.88, t));
          float startFade = smoothstep(0.0, 0.04, t);
          float endFade = smoothstep(1.0, 0.86, t);

          vec3 baseCol = mix(uHorizonColor, vec3(0.96, 0.99, 1.0), 0.78);
          vec3 sparkle = mix(vec3(1.0), uSunColor, 0.35);
          vec3 col = mix(baseCol, sparkle, clamp(rim * 0.65 + beads * 0.45, 0.0, 1.0));
          col = mix(col, vec3(0.64, 0.78, 0.94), uNightFactor * 0.45);

          float alpha = startFade * endFade * breakup * (0.56 + 0.34 * rim) * (0.12 + 0.78 * uIntensity);
          if (alpha < 0.025) discard;

          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.86));
        }
      `,
    }),
  );

  // -------------------------------------------------------------------------
  // LAYER 3: 52 Fine Velocity-Oriented Sparkling Droplets & Breeze Mist Beads
  // -------------------------------------------------------------------------
  // Fine water droplet aligned along +Y so quaternion alignment points tip along flight direction
  const dropletGeo = trackGeo(new THREE.SphereGeometry(0.0115, 6, 5));
  dropletGeo.scale(0.84, 1.32, 0.84);

  const dropletMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  );

  // -------------------------------------------------------------------------
  // LAYER 4: Animated Pool-Surface Bubbly Impact Froth & Crisp Splash Ripples
  // -------------------------------------------------------------------------
  const splashGeo = trackGeo(new THREE.PlaneGeometry(1.92, 1.92));
  splashGeo.rotateX(-Math.PI * 0.5);

  const splashMat = trackMat(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.9 },
        uSunColor: { value: new THREE.Color('#fff5e2') },
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

          // High-frequency bubbly foam speckle texture
          float bubbles1 = valueNoise(vLocalXZ * 26.0 + vec2(uTime * 1.4, -uTime * 1.2) + vSeed);
          float bubbles2 = valueNoise(vLocalXZ * 54.0 - vec2(uTime * 2.4, uTime * 2.1) - vSeed);
          float foamGrain = smoothstep(0.28, 0.82, mix(bubbles1, bubbles2, 0.5));

          // 1. Subtle aerated foam ring right where marble pedestal meets water (r ~ 0.34)
          float innerCollar = exp(-pow((r - 0.34) / 0.042, 2.0)) * (0.45 + 0.55 * foamGrain);

          // 2. 8 crisp bubbly splash impact hotspots aligned directly under the 8 parabolic arc plunges (r = 0.63)
          float eightLobes = pow(0.5 + 0.5 * cos(ang * 8.0), 4.0);
          float impactBand = exp(-pow((r - 0.63) / 0.058, 2.0));
          float impactCore = impactBand * (0.22 + 0.78 * eightLobes) * (0.55 + 0.65 * foamGrain);

          // 3. Delicate crisp radiating water ripple rings expanding outward from impact
          float rippleWave = 0.5 + 0.5 * sin(r * 46.0 - uTime * 10.5 + vSeed);
          float rippleMask = smoothstep(0.32, 0.52, r) * smoothstep(0.94, 0.60, r);
          float crispRipples = pow(rippleWave, 6.0) * rippleMask * 0.44;

          // Circular edge clip
          float outerFade = smoothstep(0.94, 0.78, r);
          float alpha = (innerCollar * 0.38 + impactCore * 0.92 + crispRipples) * outerFade * uIntensity;

          if (alpha < 0.03) discard;

          vec3 col = mix(vec3(0.97, 0.99, 1.0), uSunColor, 0.18);
          col = mix(col, vec3(0.70, 0.82, 0.96), uNightFactor * 0.45);
          gl_FragColor = vec4(col, clamp(alpha * 0.82, 0.0, 0.84));
        }
      `,
    }),
  );

  const jetInst = new THREE.InstancedMesh(jetStreamGeo, jetStreamMat, nozzleCount);
  const arcsInst = new THREE.InstancedMesh(arcsGeo, arcsMat, nozzleCount);
  const dropletInst = new THREE.InstancedMesh(dropletGeo, dropletMat, totalDroplets);
  const splashInst = new THREE.InstancedMesh(splashGeo, splashMat, nozzleCount);

  jetInst.frustumCulled = false;
  arcsInst.frustumCulled = false;
  dropletInst.frustumCulled = false;
  splashInst.frustumCulled = false;
  root.add(jetInst, arcsInst, dropletInst, splashInst);

  // Pre-seeded deterministic launch parameters per droplet:
  // k = 0..15 -> fine sparkling crown droplets bursting off central vertical jet
  // k = 16..35 -> outer micro-spout spray beads peeling off the 8 parabolic arcs
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
  }
  const dropletSeeds: DropletSeed[] = [];
  for (let d = 0; d < totalDroplets; d += 1) {
    const localIdx = d % dropletsPerNozzle;
    const isOuterArc = localIdx >= 20;
    if (isOuterArc) {
      const streamIdx = (localIdx - 20) % 8;
      const streamAngle = (streamIdx / 8) * Math.PI * 2 + (rand() - 0.5) * 0.24;
      dropletSeeds.push({
        isOuterArc: true,
        baseAngle: streamAngle,
        radialSpeed: 0.72 + rand() * 0.42,
        upSpeed: 2.25 + rand() * 0.88,
        phaseOffset: rand(),
        lifeDuration: 0.60 + rand() * 0.22,
        size: 0.46 + rand() * 0.44,
        startHeightJitter: 0,
      });
    } else {
      const crownAngle = (localIdx / 20) * Math.PI * 2 + (rand() - 0.5) * 0.38;
      dropletSeeds.push({
        isOuterArc: false,
        baseAngle: crownAngle,
        radialSpeed: 0.22 + rand() * 0.48,
        upSpeed: 2.65 + rand() * 1.05,
        phaseOffset: rand(),
        lifeDuration: 0.64 + rand() * 0.26,
        size: 0.42 + rand() * 0.46,
        startHeightJitter: rand() * 0.34,
      });
    }
  }

  // Module-scope reusable scratch objects (zero per-frame heap allocations)
  const _dummy = new THREE.Object3D();
  const _upVec = new THREE.Vector3(0, 1, 0);
  const _velDir = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _sunCol = new THREE.Color('#fff5e2');
  const _horizCol = new THREE.Color('#dbe8f5');
  const _white = new THREE.Color('#ffffff');
  const _nightWater = new THREE.Color('#9ec0e8');

  return {
    root,
    update: (
      elapsedSec: number,
      buildProgress: number,
      breezeStrength: number,
      overrideMode: 'auto' | 'on' | 'off',
    ) => {
      const buildGate = THREE.MathUtils.smoothstep(buildProgress, 0.12, 0.28);
      let aggregateIntensity = 0;

      // Subtle cross-garden breeze drift vector for airborne droplets
      const windSpeedX = 0.28 * breezeStrength;
      const windSpeedZ = -0.10 * breezeStrength;

      for (let i = 0; i < nozzleCount; i += 1) {
        const nozzle = activeNozzles[i];
        const nozzleRotY = (nozzle.index % 2) * (Math.PI / 8);

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
          _dummy.position.set(0, -5, nozzle.z);
          _dummy.quaternion.identity();
          _dummy.scale.set(0.0001, 0.0001, 0.0001);
          _dummy.updateMatrix();
          jetInst.setMatrixAt(i, _dummy.matrix);
          arcsInst.setMatrixAt(i, _dummy.matrix);
          splashInst.setMatrixAt(i, _dummy.matrix);

          const baseIdx = i * dropletsPerNozzle;
          for (let k = 0; k < dropletsPerNozzle; k += 1) {
            dropletInst.setMatrixAt(baseIdx + k, _dummy.matrix);
          }
          continue;
        }

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

        // Layer 4: Animated splash-impact froth & concentric ripple rings synced to exact arc landing radius
        _dummy.position.set(0, WATER_SURFACE_Y + 0.012, nozzle.z);
        _dummy.rotation.set(0, nozzleRotY, 0);
        _dummy.scale.set(arcScaleXZ, 1, arcScaleXZ);
        _dummy.updateMatrix();
        splashInst.setMatrixAt(i, _dummy.matrix);

        // Layer 3: 52 fine velocity-oriented, breeze-drifting sparkling water droplets & mist beads
        const baseIdx = i * dropletsPerNozzle;
        const speedScale = 0.48 + 0.54 * intensity;

        for (let k = 0; k < dropletsPerNozzle; k += 1) {
          const seed = dropletSeeds[baseIdx + k];
          const ageNorm = ((elapsedSec / seed.lifeDuration) + seed.phaseOffset) % 1.0;
          const tSec = ageNorm * seed.lifeDuration;

          // Rotate launch direction to align with this nozzle's alternating 8-spout orientation
          const worldAngle = seed.baseAngle - nozzleRotY;
          const cosA = Math.cos(worldAngle);
          const sinA = Math.sin(worldAngle);

          const startR = seed.isOuterArc ? OUTER_RING_R : 0.016;
          const startY = seed.isOuterArc ? OUTER_RING_Y : NOZZLE_TIP_Y + seed.startHeightJitter * intensity;

          const vRadial = seed.radialSpeed * speedScale;
          const vUp0 = seed.upSpeed * speedScale;

          const px = cosA * (startR + vRadial * tSec) + windSpeedX * tSec * tSec * 0.9;
          const py = startY + vUp0 * tSec - 0.5 * GRAVITY * tSec * tSec;
          const pz = nozzle.z + sinA * (startR + vRadial * tSec) + windSpeedZ * tSec * tSec * 0.9;

          if (py < WATER_SURFACE_Y - 0.01) {
            _dummy.position.set(0, -5, nozzle.z);
            _dummy.quaternion.identity();
            _dummy.scale.set(0.0001, 0.0001, 0.0001);
          } else {
            // Analytical instantaneous 3D velocity vector for realistic droplet orientation & fine motion streak
            const vx = cosA * vRadial + 1.8 * windSpeedX * tSec;
            const vy = vUp0 - GRAVITY * tSec;
            const vz = sinA * vRadial + 1.8 * windSpeedZ * tSec;
            const speed = Math.hypot(vx, vy, vz);

            if (speed > 0.001) {
              _velDir.set(vx / speed, vy / speed, vz / speed);
              _quat.setFromUnitVectors(_upVec, _velDir);
              _dummy.quaternion.copy(_quat);
            } else {
              _dummy.quaternion.identity();
            }

            const fadeEdge = Math.sin(Math.min(1, ageNorm) * Math.PI);
            const dropScale = seed.size * (0.5 + 0.52 * intensity) * (0.4 + 0.6 * fadeEdge);
            const stretch = 1.0 + Math.min(0.95, speed * 0.20);

            _dummy.position.set(px, py, pz);
            _dummy.scale.set(dropScale * 0.8, dropScale * stretch, dropScale * 0.8);
          }
          _dummy.updateMatrix();
          dropletInst.setMatrixAt(baseIdx + k, _dummy.matrix);
        }
      }

      jetInst.instanceMatrix.needsUpdate = true;
      arcsInst.instanceMatrix.needsUpdate = true;
      dropletInst.instanceMatrix.needsUpdate = true;
      splashInst.instanceMatrix.needsUpdate = true;

      const avgIntensity = nozzleCount > 0 ? aggregateIntensity / nozzleCount : 0;

      // Update flowing shader uniforms
      jetStreamMat.uniforms.uTime.value = elapsedSec;
      jetStreamMat.uniforms.uIntensity.value = avgIntensity;
      arcsMat.uniforms.uTime.value = elapsedSec;
      arcsMat.uniforms.uIntensity.value = avgIntensity;
      splashMat.uniforms.uTime.value = elapsedSec;
      splashMat.uniforms.uIntensity.value = avgIntensity;
      dropletMat.opacity = 0.22 + 0.68 * avgIntensity;

      return avgIntensity;
    },
    applyTint: (sunColorHex: string, horizonColorHex: string, nightFactor: number) => {
      _sunCol.set(sunColorHex);
      _horizCol.set(horizonColorHex);

      jetStreamMat.uniforms.uSunColor.value.copy(_sunCol);
      jetStreamMat.uniforms.uHorizonColor.value.copy(_horizCol);
      jetStreamMat.uniforms.uNightFactor.value = nightFactor;

      arcsMat.uniforms.uSunColor.value.copy(_sunCol);
      arcsMat.uniforms.uHorizonColor.value.copy(_horizCol);
      arcsMat.uniforms.uNightFactor.value = nightFactor;

      splashMat.uniforms.uSunColor.value.copy(_sunCol);
      splashMat.uniforms.uNightFactor.value = nightFactor;

      dropletMat.color
        .copy(_white)
        .lerp(_sunCol, 0.26)
        .lerp(_nightWater, nightFactor * 0.42);
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
