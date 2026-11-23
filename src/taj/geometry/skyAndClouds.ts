import * as THREE from 'three';
import { wrapCloudX } from '../animation';
import type { LightingPreset } from '../config';
import type { ProceduralTextureSet } from '../textures';

export interface SkyAndCloudsHandles {
  root: THREE.Group;
  skyMaterial: THREE.ShaderMaterial;
  dustMotes: THREE.Points;
  update: (elapsedSec: number, breezeStrength: number) => void;
  applyLighting: (preset: LightingPreset) => void;
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

/**
 * Generates a real-time HDRI PMREM environment map directly from the physically-based
 * Rayleigh/Mie golden-hour sky & warm Agra ground bounce so Makrana marble, domes,
 * water, foliage, and antique bronze finials reflect the live atmospheric sky.
 */
export function generateSkyEnvMap(
  renderer: THREE.WebGLRenderer,
  preset: LightingPreset,
): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const envGeo = new THREE.SphereGeometry(60, 32, 20);
  const isGolden = preset.id === 'golden';
  const isNight = preset.id === 'moonlight';

  const envMat = new THREE.ShaderMaterial({
    uniforms: {
      uTopColor: { value: new THREE.Color(preset.skyTop) },
      uMidColor: { value: new THREE.Color(preset.skyMid) },
      uHorizonColor: { value: new THREE.Color(preset.skyHorizon) },
      uGroundColor: { value: new THREE.Color(preset.hemiGroundColor) },
      uSunDir: { value: new THREE.Vector3(...preset.sunDirection).normalize() },
      uSunColor: { value: new THREE.Color(preset.sunColor) },
      uSunPower: { value: isNight ? 0.35 : isGolden ? 2.4 : 1.85 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uGroundColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunPower;
      varying vec3 vDir;
      void main() {
        vec3 rd = normalize(vDir);
        vec3 col;
        if (rd.y >= 0.0) {
          float rayleigh = clamp(1.0 - exp(-rd.y * 2.2), 0.0, 1.0);
          col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.36, rd.y));
          col = mix(col, uTopColor, smoothstep(0.24, 0.88, rayleigh));
          float sunDot = max(dot(rd, normalize(uSunDir)), 0.0);
          float mieHalo = pow(sunDot, 10.0) * 0.38 + pow(sunDot, 64.0) * 0.85;
          float sunCore = smoothstep(0.996, 0.9992, sunDot) * 4.0;
          col += uSunColor * (mieHalo + sunCore) * uSunPower * 0.72;
        } else {
          // Warm Agra sandstone & garden bounce below the horizon (lifts dark tree shadows cleanly!)
          float down = clamp(-rd.y, 0.0, 1.0);
          col = mix(uHorizonColor * 0.85, uGroundColor * 0.92, smoothstep(0.0, 0.55, down));
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const envMesh = new THREE.Mesh(envGeo, envMat);
  envScene.add(envMesh);

  const envRT = pmrem.fromScene(envScene, 0.025);
  envGeo.dispose();
  envMat.dispose();
  pmrem.dispose();

  return envRT;
}

/**
 * Physically-grounded Rayleigh/Mie atmospheric sky dome with:
 * - Natural luminous upper sky gradient transitioning softly into warm golden Agra horizon
 * - Soft-edged, unstretched isotropic spherical-shell golden-hour cumulus & high cloud veils
 * - Subtle 3D volumetric god rays (atmospheric crepuscular light shafts)
 * - Floating golden-hour dust motes & sunlit pollen drifting over the Charbagh gardens & reflecting pool
 */
export function buildSkyAndClouds(
  _textures: ProceduralTextureSet,
  initialPreset: LightingPreset,
): SkyAndCloudsHandles {
  const root = new THREE.Group();
  root.name = 'SkyAndCloudsRoot';

  const skyGeo = new THREE.SphereGeometry(520, 48, 32);
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTopColor: { value: new THREE.Color(initialPreset.skyTop) },
      uMidColor: { value: new THREE.Color(initialPreset.skyMid) },
      uHorizonColor: { value: new THREE.Color(initialPreset.skyHorizon) },
      uSunDir: { value: new THREE.Vector3(...initialPreset.sunDirection).normalize() },
      uMoonDir: { value: new THREE.Vector3(34, 62, -120).normalize() },
      uSunColor: { value: new THREE.Color(initialPreset.sunColor) },
      uCloudLight: { value: new THREE.Color(initialPreset.cloudTint) },
      uCloudShadow: { value: new THREE.Color(initialPreset.cloudShadowTint) },
      uCloudDrift: { value: 0.0 },
      uTime: { value: 0.0 },
      uStarVisibility: { value: 0.0 },
      uMoonVisibility: { value: 0.0 },
      uMieStrength: { value: initialPreset.id === 'golden' ? 1.0 : 0.45 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform vec3 uSunColor;
      uniform vec3 uCloudLight;
      uniform vec3 uCloudShadow;
      uniform float uCloudDrift;
      uniform float uTime;
      uniform float uStarVisibility;
      uniform float uMoonVisibility;
      uniform float uMieStrength;

      varying vec3 vWorldDir;

      const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);

      float hash21(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float hash31(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      // Soft, organic billowed cumulus fBM with isotropic multi-octave puffs (zero stretching)
      float fbmCumulus(vec2 p) {
        float val = 0.0;
        float amp = 0.50;
        for (int i = 0; i < 5; i++) {
          float n = noise(p);
          val += mix(n, 1.0 - abs(n * 2.0 - 1.0), 0.24) * amp;
          p = ROT * p * 2.02 + vec2(11.3, 7.7);
          amp *= 0.50;
        }
        return val;
      }

      float fbmSoftVeil(vec2 p) {
        float val = 0.0;
        float amp = 0.52;
        for (int i = 0; i < 4; i++) {
          val += noise(p) * amp;
          p = ROT * p * 2.06 + vec2(4.2, 9.1);
          amp *= 0.49;
        }
        return val;
      }

      float sampleCumulusDensity(vec2 uv, float drift) {
        vec2 q = uv * 0.95 + vec2(drift * 0.022, drift * 0.004);
        // Gentle domain warp (0.28) keeps puffs round, natural, and feathered instead of smeared/streaky
        vec2 warp = vec2(noise(q * 1.25 + vec2(2.1, 5.4)), noise(q * 1.25 + vec2(8.3, 1.9))) - 0.5;
        float base = fbmCumulus(q + warp * 0.28);
        float fineEdge = fbmSoftVeil(q * 2.4 - vec2(drift * 0.018, 1.7)) * 0.16;
        float weather = noise(uv * 0.38 + vec2(drift * 0.009 + 1.4, -0.8));
        float coverage = mix(0.46, 0.66, weather);
        // Wide feathered smoothstep transition for realistic photographic cloud edges
        return smoothstep(coverage, coverage + 0.32, base + fineEdge * 0.5 - 0.06);
      }

      float sampleStars(vec3 dir) {
        vec3 grid = floor(dir * 195.0);
        vec3 local = fract(dir * 195.0) - 0.5;
        float rnd = hash31(grid);
        float presence = step(0.991, rnd);
        float dist = length(local);
        float core = smoothstep(0.26, 0.03, dist);
        float twinkle = 0.68 + 0.32 * sin(uTime * (2.2 + rnd * 4.5) + rnd * 62.0);
        float sizeScale = mix(0.45, 1.15, fract(rnd * 37.3));
        return presence * core * twinkle * sizeScale;
      }

      float hgPhase(float cosTheta, float g) {
        float g2 = g * g;
        return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 0.001), 1.5));
      }

      void main() {
        vec3 rd = normalize(vWorldDir);
        vec3 sunDir = normalize(uSunDir);
        vec3 moonDir = normalize(uMoonDir);
        float h = clamp(rd.y, 0.0, 1.0);

        // Soft, photorealistic golden-hour sky gradient: luminous pastel zenith easing naturally into warm apricot horizon
        float rayleighCurve = 1.0 - exp(-h * 2.15);
        vec3 sky = mix(uHorizonColor, uMidColor, pow(smoothstep(0.0, 0.38, h), 0.76));
        sky = mix(sky, uTopColor, smoothstep(0.26, 0.94, rayleighCurve));

        // Broad atmospheric Mie glow warming the lower sky dome seamlessly
        float sunDot = dot(rd, sunDir);
        float sunDotPos = max(sunDot, 0.0);
        float dayHaloStrength = 1.0 - uMoonVisibility * 0.78;
        float horizonBand = exp(-h * 4.8);
        float azimuthWarmth = pow(
          clamp(
            dot(
              normalize(vec3(rd.x, 0.0, rd.z) + vec3(0.0001)),
              normalize(vec3(sunDir.x, 0.0, sunDir.z) + vec3(0.0001))
            ) * 0.5 + 0.5,
            0.0,
            1.0
          ),
          1.8
        );
        sky += uSunColor * horizonBand * (0.14 + 0.24 * azimuthWarmth) * uMieStrength * dayHaloStrength;

        // Subtle Henyey-Greenstein solar aureole + soft HDR sun disc
        float miePhase = hgPhase(sunDot, 0.68) * 0.20 + hgPhase(sunDot, 0.90) * 0.04;
        float sunDisc = smoothstep(0.9990, 0.9996, sunDot) * 2.2;
        sky += uSunColor * (miePhase * (0.55 + 0.75 * uMieStrength) + sunDisc) * dayHaloStrength;

        // Full Moon disc & lunar corona at night
        if (uMoonVisibility > 0.01 && rd.y > 0.02) {
          float moonDot = max(dot(rd, moonDir), 0.0);
          float moonDisc = smoothstep(0.9986, 0.9992, moonDot);
          float moonCorona = pow(moonDot, 42.0) * 0.28 + pow(moonDot, 6.0) * 0.09;
          float maria = 0.86 + 0.14 * noise(rd.xz * 48.0 + vec2(3.1, 1.7));
          vec3 moonCol = vec3(0.95, 0.97, 1.0) * maria;
          sky += vec3(0.76, 0.86, 1.0) * moonCorona * uMoonVisibility;
          sky = mix(sky, moonCol, moonDisc * uMoonVisibility * 0.96);
        }

        // Night starfield
        if (uStarVisibility > 0.01 && rd.y > 0.06) {
          float s1 = sampleStars(rd);
          float s2 = sampleStars(rd * 1.43 + vec3(1.7, 0.9, 2.3)) * 0.65;
          float horizonFadeStars = smoothstep(0.06, 0.32, rd.y);
          vec3 starCol = mix(vec3(0.84, 0.91, 1.0), vec3(1.0, 0.95, 0.86), hash31(floor(rd * 195.0) + 7.1));
          sky += starCol * (s1 + s2) * uStarVisibility * horizonFadeStars * 0.95;
        }

        if (rd.y > 0.008) {
          // Physically curved spherical cloud shell projection (eliminates upper-sky stretching & streaking!)
          float shellHeight = sqrt(rd.y * rd.y + 0.14);
          vec2 cloudUv = rd.xz / (shellHeight + 0.24) * 1.38;

          // LAYER 1: Delicate isotropic high-altitude soft cloud veil (no artificial directional stretch)
          vec2 veilUv = cloudUv * 1.25 + vec2(uCloudDrift * 0.011, 2.3);
          float veilNoise = fbmSoftVeil(veilUv);
          float veilAlpha = smoothstep(0.54, 0.88, veilNoise) * 0.22 * smoothstep(0.03, 0.28, rd.y);
          vec3 veilCol = mix(uCloudLight, uHorizonColor, 0.24);
          sky = mix(sky, veilCol, veilAlpha);

          // LAYER 2: Main soft-feathered volumetric golden-hour cumulus puffs
          float density = sampleCumulusDensity(cloudUv, uCloudDrift);

          if (density > 0.002) {
            vec2 sunStep = sunDir.xz / max(sunDir.y + 0.36, 0.36);
            float dSun1 = sampleCumulusDensity(cloudUv + sunStep * 0.09, uCloudDrift);
            float dSun2 = sampleCumulusDensity(cloudUv + sunStep * 0.22, uCloudDrift);
            float opticalDepth = dSun1 * 0.65 + dSun2 * 0.45 + density * 0.32;
            float transmittance = exp(-opticalDepth * 1.55);

            float crownLight = clamp(transmittance * 1.32 + (1.0 - density) * 0.24, 0.0, 1.0);
            float silverLining = pow(sunDotPos, 4.5) * (1.0 - density * 0.55) * (0.36 + 0.38 * uMieStrength);
            float ambientBounce = mix(0.28, 0.72, smoothstep(0.0, 0.5, rd.y));

            vec3 litCloud = mix(uCloudShadow, uCloudLight * 1.04, clamp(crownLight * 0.84 + ambientBounce * 0.24, 0.0, 1.0));
            litCloud += uSunColor * silverLining * (0.42 + 0.58 * transmittance);

            float horizonFade = smoothstep(0.015, 0.22, rd.y);
            float distHaze = 1.0 - smoothstep(0.04, 0.38, rd.y);
            litCloud = mix(litCloud, uHorizonColor, distHaze * 0.54);

            // Soft feathered cloud opacity so edges melt naturally into the sky
            float cloudAlpha = smoothstep(0.0, 0.82, density) * 0.86 * horizonFade;
            sky = mix(sky, litCloud, cloudAlpha);
          }
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const skyDome = new THREE.Mesh(skyGeo, skyMaterial);
  skyDome.frustumCulled = false;
  root.add(skyDome);

  // =========================================================================
  // 3D VOLUMETRIC GOD RAYS (Golden-Hour Atmospheric Crepuscular Light Shafts)
  // =========================================================================
  const godRaysGroup = new THREE.Group();
  godRaysGroup.name = 'VolumetricGodRays';

  const rayMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRayColor: { value: new THREE.Color('#ffd390') },
      uRayIntensity: { value: initialPreset.id === 'golden' ? 0.20 : initialPreset.id === 'daylight' ? 0.065 : 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uRayColor;
      uniform float uRayIntensity;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        float crossProfile = exp(-pow((vUv.x - 0.5) * 3.55, 2.0));
        float alongFade = smoothstep(0.0, 0.30, vUv.y) * smoothstep(1.0, 0.22, vUv.y);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float viewFacing = pow(abs(dot(normalize(vWorldNormal), V)), 1.45);
        float streak1 = 0.72 + 0.28 * sin(vUv.x * 16.0 + uTime * 0.24 + vWorldPos.z * 0.04);
        float streak2 = 0.78 + 0.22 * cos(vUv.x * 27.0 - uTime * 0.17 + vWorldPos.x * 0.05);
        float alpha = crossProfile * alongFade * viewFacing * streak1 * streak2 * uRayIntensity;
        gl_FragColor = vec4(uRayColor * alpha, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const rayPlaneGeo = new THREE.PlaneGeometry(1, 1);
  const rayEntries: Array<{ mesh: THREE.Mesh; roll: number }> = [];
  // Diagonal crepuscular volumetric sunbeams slanting majestically across the minarets & central dome shoulder
  const raySpecs: Array<{ pos: [number, number, number]; width: number; length: number; roll: number }> = [
    { pos: [28, 30, 18], width: 22, length: 92, roll: 0.08 },
    { pos: [14, 34, 8], width: 26, length: 96, roll: -0.22 },
    { pos: [-18, 32, 24], width: 22, length: 88, roll: 0.34 },
    { pos: [42, 30, -8], width: 30, length: 102, roll: -0.18 },
    { pos: [26, 26, 46], width: 24, length: 84, roll: 0.48 },
    { pos: [-30, 30, 12], width: 24, length: 90, roll: -0.32 },
    { pos: [6, 38, -22], width: 28, length: 94, roll: 0.25 },
  ];

  const alignRayQuat = new THREE.Quaternion();
  const upVec = new THREE.Vector3(0, 1, 0);
  const rollQuat = new THREE.Quaternion();
  const sunDirScratch = new THREE.Vector3(...initialPreset.sunDirection).normalize();

  const orientGodRays = (dir: THREE.Vector3) => {
    alignRayQuat.setFromUnitVectors(upVec, dir);
    for (const entry of rayEntries) {
      rollQuat.setFromAxisAngle(upVec, entry.roll);
      entry.mesh.quaternion.copy(alignRayQuat).multiply(rollQuat);
    }
  };

  for (const spec of raySpecs) {
    for (const crossOffset of [0, Math.PI * 0.5]) {
      const m = new THREE.Mesh(rayPlaneGeo, rayMaterial);
      m.position.set(...spec.pos);
      m.scale.set(spec.width, spec.length, 1);
      m.frustumCulled = false;
      m.renderOrder = 2;
      godRaysGroup.add(m);
      rayEntries.push({ mesh: m, roll: spec.roll + crossOffset });
    }
  }
  orientGodRays(sunDirScratch);
  root.add(godRaysGroup);

  // =========================================================================
  // LOW-LYING DRIFTING ATMOSPHERIC GROUND MIST (Distant Treeline & Yamuna River)
  // =========================================================================
  const groundMistGroup = new THREE.Group();
  groundMistGroup.name = 'AtmosphericGroundMist';

  const mistGeo = new THREE.PlaneGeometry(1, 1);
  const mistMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBreeze: { value: 1.0 },
      uMistColor: { value: new THREE.Color('#f7d5a8') },
      uOpacity: { value: initialPreset.id === 'golden' ? 0.24 : initialPreset.id === 'daylight' ? 0.11 : 0.08 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uBreeze;
      uniform vec3 uMistColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vWorldPos;

      float mHash(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 34.12);
        return fract(p.x * p.y);
      }
      float mNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mHash(i), mHash(i + vec2(1.0, 0.0)), f.x),
          mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        float drift = uTime * (0.045 + 0.055 * uBreeze);
        vec2 p1 = vec2(vUv.x * 3.8 - drift + vWorldPos.z * 0.015, vUv.y * 2.1);
        vec2 p2 = vec2(vUv.x * 7.5 - drift * 1.45, vUv.y * 4.2 + 1.7);
        float wisp = mNoise(p1) * 0.65 + mNoise(p2) * 0.35;

        // Soft horizontal & vertical feathering so mist hugs the treeline/river with zero hard edges
        float horizFade = smoothstep(0.0, 0.26, vUv.x) * smoothstep(1.0, 0.74, vUv.x);
        float vertFade = smoothstep(0.0, 0.22, vUv.y) * pow(smoothstep(1.0, 0.08, vUv.y), 1.45);
        float distFade = smoothstep(14.0, 42.0, length(cameraPosition - vWorldPos));
        float alpha = horizFade * vertFade * distFade * smoothstep(0.24, 0.86, wisp) * uOpacity;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uMistColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Mist banks hugging the outer garden treelines and drifting over the Yamuna River behind the monument
  const mistSpecs: Array<{ pos: [number, number, number]; w: number; h: number; rotY: number }> = [
    // Yamuna River drifting mist curtains behind Taj Mahal
    { pos: [0, 2.2, -58], w: 220, h: 8.5, rotY: 0 },
    { pos: [-55, 2.8, -96], w: 260, h: 10.5, rotY: 0.06 },
    { pos: [65, 2.6, -128], w: 270, h: 11.5, rotY: -0.05 },
    { pos: [0, 3.2, -162], w: 320, h: 12.0, rotY: 0 },
    // Soft low golden treeline haze flanking the outer Charbagh gardens
    { pos: [-58, 2.4, 24], w: 92, h: 7.4, rotY: 0.32 },
    { pos: [58, 2.4, 24], w: 92, h: 7.4, rotY: -0.32 },
    { pos: [-78, 2.6, -12], w: 112, h: 8.2, rotY: 0.14 },
    { pos: [78, 2.6, -12], w: 112, h: 8.2, rotY: -0.14 },
  ];

  for (const spec of mistSpecs) {
    const ribbon = new THREE.Mesh(mistGeo, mistMaterial);
    ribbon.position.set(...spec.pos);
    ribbon.scale.set(spec.w, spec.h, 1);
    ribbon.rotation.y = spec.rotY;
    ribbon.frustumCulled = false;
    ribbon.renderOrder = 2;
    groundMistGroup.add(ribbon);
  }
  root.add(groundMistGroup);

  // =========================================================================
  // FLOATING GOLDEN-HOUR DUST MOTES & SUNLIT POLLEN (AAA Atmospheric Depth)
  // =========================================================================
  const moteCount = 280;
  const moteRand = seededRand(1648);
  const motePositions = new Float32Array(moteCount * 3);
  const moteSeeds = new Float32Array(moteCount * 3); // [phase, sizeScale, speedScale]

  for (let i = 0; i < moteCount; i += 1) {
    // Concentrate softly across the sunlit Charbagh pool, cypress avenue & lower foreground gardens
    const inForeground = i < 150;
    const x = inForeground ? (moteRand() - 0.5) * 26 : (moteRand() - 0.5) * 58;
    const y = 0.45 + Math.pow(moteRand(), 1.65) * (inForeground ? 5.6 : 8.2);
    const z = inForeground ? 64 + moteRand() * 42 : 24 + moteRand() * 82;
    motePositions[i * 3] = x;
    motePositions[i * 3 + 1] = y;
    motePositions[i * 3 + 2] = z;

    moteSeeds[i * 3] = moteRand() * Math.PI * 2;
    moteSeeds[i * 3 + 1] = 0.65 + moteRand() * 1.10;
    moteSeeds[i * 3 + 2] = 0.65 + moteRand() * 0.75;
  }

  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(moteSeeds, 3));

  const moteMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBreeze: { value: 1.0 },
      uMoteColor: { value: new THREE.Color('#ffd996') },
      uOpacity: { value: initialPreset.id === 'golden' ? 0.50 : initialPreset.id === 'daylight' ? 0.24 : 0.10 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uBreeze;
      attribute vec3 aSeed;
      varying float vAlpha;
      varying float vWarmth;

      void main() {
        float phase = aSeed.x;
        float sizeScale = aSeed.y;
        float spd = aSeed.z;
        float t = uTime * (0.28 + 0.24 * uBreeze) * spd;

        // Lazy sunlit thermal buoyancy & soft garden breeze drift
        vec3 p = position;
        p.x += sin(t * 0.9 + phase) * 1.35 + cos(t * 0.42 + phase * 1.7) * 0.75 * uBreeze;
        p.y += sin(t * 0.65 + phase * 2.1) * 0.45 + mod(t * 0.18 + phase, 2.0) * 0.20;
        p.z += cos(t * 0.74 + phase * 1.3) * 1.15;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float dist = max(-mvPosition.z, 0.5);

        // Soft bokeh point sizing with graceful near/far fade
        float nearFade = smoothstep(1.2, 5.0, dist);
        float farFade = smoothstep(82.0, 20.0, dist);
        float twinkle = 0.50 + 0.50 * sin(uTime * (1.1 + spd * 0.9) + phase * 3.0);

        vAlpha = nearFade * farFade * twinkle;
        vWarmth = fract(phase * 1.618);

        gl_PointSize = clamp((52.0 * sizeScale) / dist, 3.0, 14.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uMoteColor;
      uniform float uOpacity;
      varying float vAlpha;
      varying float vWarmth;

      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0) discard;

        // Silky feathered golden-amber pollen bokeh disc (no sharp white star-like pinpoint spike)
        float softDisc = exp(-r * r * 3.6);
        float warmCore = exp(-r * r * 7.2) * 0.36;
        vec3 col = mix(uMoteColor, vec3(1.0, 0.92, 0.74), vWarmth * 0.42 + warmCore * 0.35);
        float a = (softDisc * 0.72 + warmCore) * vAlpha * uOpacity;
        gl_FragColor = vec4(col * (1.06 + warmCore * 0.45), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const dustMotes = new THREE.Points(moteGeo, moteMaterial);
  dustMotes.name = 'GoldenHourDustMotes';
  dustMotes.frustumCulled = false;
  dustMotes.renderOrder = 3;
  root.add(dustMotes);

  let accumulatedDrift = 14.5;
  let lastElapsed = 0;

  return {
    root,
    skyMaterial,
    dustMotes,
    update: (elapsedSec: number, breezeStrength: number) => {
      const dt = Math.max(0, Math.min(elapsedSec - lastElapsed, 1.5));
      lastElapsed = elapsedSec;
      const driftSpeed = 0.22 + 0.95 * breezeStrength;
      accumulatedDrift = wrapCloudX(accumulatedDrift, driftSpeed, dt);
      skyMaterial.uniforms.uCloudDrift.value = accumulatedDrift;
      skyMaterial.uniforms.uTime.value = elapsedSec;
      rayMaterial.uniforms.uTime.value = elapsedSec;
      mistMaterial.uniforms.uTime.value = elapsedSec;
      mistMaterial.uniforms.uBreeze.value = breezeStrength;
      moteMaterial.uniforms.uTime.value = elapsedSec;
      moteMaterial.uniforms.uBreeze.value = breezeStrength;
    },
    applyLighting: (preset: LightingPreset) => {
      skyMaterial.uniforms.uTopColor.value.set(preset.skyTop);
      skyMaterial.uniforms.uMidColor.value.set(preset.skyMid);
      skyMaterial.uniforms.uHorizonColor.value.set(preset.skyHorizon);
      sunDirScratch.set(...preset.sunDirection).normalize();
      skyMaterial.uniforms.uSunDir.value.copy(sunDirScratch);
      skyMaterial.uniforms.uSunColor.value.set(preset.sunColor);
      skyMaterial.uniforms.uCloudLight.value.set(preset.cloudTint);
      skyMaterial.uniforms.uCloudShadow.value.set(preset.cloudShadowTint);

      const isNight = preset.id === 'moonlight';
      const isGolden = preset.id === 'golden';
      skyMaterial.uniforms.uMoonDir.value.set(34, 62, -120).normalize();
      skyMaterial.uniforms.uStarVisibility.value = isNight ? 0.95 : 0.0;
      skyMaterial.uniforms.uMoonVisibility.value = isNight ? 0.95 : 0.0;
      skyMaterial.uniforms.uMieStrength.value = isGolden ? 1.0 : isNight ? 0.08 : 0.42;

      rayMaterial.uniforms.uRayColor.value.set(preset.sunColor);
      rayMaterial.uniforms.uRayIntensity.value = isGolden ? 0.22 : isNight ? 0.0 : 0.065;
      godRaysGroup.visible = !isNight;
      orientGodRays(sunDirScratch);

      mistMaterial.uniforms.uMistColor.value.set(isNight ? '#687e9e' : preset.skyHorizon);
      mistMaterial.uniforms.uOpacity.value = isGolden ? 0.24 : isNight ? 0.09 : 0.11;

      moteMaterial.uniforms.uMoteColor.value.set(isNight ? '#a8c6f0' : preset.sunColor);
      moteMaterial.uniforms.uOpacity.value = isGolden ? 0.50 : isNight ? 0.10 : 0.24;
    },
    dispose: () => {
      skyGeo.dispose();
      skyMaterial.dispose();
      rayPlaneGeo.dispose();
      rayMaterial.dispose();
      mistGeo.dispose();
      mistMaterial.dispose();
      moteGeo.dispose();
      moteMaterial.dispose();
    },
  };
}
