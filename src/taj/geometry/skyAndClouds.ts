import * as THREE from 'three';
import { wrapCloudX } from '../animation';
import type { LightingPreset } from '../config';
import type { ProceduralTextureSet } from '../textures';

export interface SkyAndCloudsHandles {
  root: THREE.Group;
  skyMaterial: THREE.ShaderMaterial;
  update: (elapsedSec: number, breezeStrength: number) => void;
  applyLighting: (preset: LightingPreset) => void;
  dispose: () => void;
}

/**
 * Photorealistic Rayleigh/Mie sky dome with analytical multi-layer volumetric clouds,
 * twinkling night starfield, and luminous moon disc & lunar corona:
 * - Continuous gradual Day -> Golden Evening -> Twilight Dusk -> Moonlit Night transitions
 * - Curved atmospheric cloud deck with crisp billowing cumulus structure
 * - Directional sun/moon light-march self-shadowing (bright sunlit crowns, cool blue-slate bases)
 * - Henyey-Greenstein silver-lining forward scattering near the sun/moon
 * - High-altitude wispy cirrus streaks drifting gently with the breeze
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
      uMoonDir: { value: new THREE.Vector3(-0.55, 0.62, 0.44).normalize() },
      uSunColor: { value: new THREE.Color(initialPreset.sunColor) },
      uCloudLight: { value: new THREE.Color(initialPreset.cloudTint) },
      uCloudShadow: { value: new THREE.Color(initialPreset.cloudShadowTint) },
      uCloudDrift: { value: 0.0 },
      uTime: { value: 0.0 },
      uStarVisibility: { value: 0.0 },
      uMoonVisibility: { value: 0.0 },
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

      // Billowed fBM for crisp cauliflower-like cumulus clouds
      float fbmCumulus(vec2 p) {
        float val = 0.0;
        float amp = 0.52;
        for (int i = 0; i < 5; i++) {
          float n = noise(p);
          val += mix(n, 1.0 - abs(n * 2.0 - 1.0), 0.28) * amp;
          p = ROT * p * 2.04 + vec2(11.3, 7.7);
          amp *= 0.49;
        }
        return val;
      }

      // Stretched delicate fBM for high-altitude wispy cirrus veils
      float fbmCirrus(vec2 p) {
        float val = 0.0;
        float amp = 0.55;
        for (int i = 0; i < 4; i++) {
          val += noise(p) * amp;
          p = ROT * p * 2.15 + vec2(4.2, 9.1);
          amp *= 0.48;
        }
        return val;
      }

      float sampleCumulusDensity(vec2 uv, float drift) {
        vec2 q = uv * 0.52 + vec2(drift * 0.028, drift * 0.005);
        vec2 warp = vec2(noise(q * 1.55 + vec2(2.1, 5.4)), noise(q * 1.55 + vec2(8.3, 1.9))) - 0.5;
        float base = fbmCumulus(q + warp * 0.62);

        float weather = noise(uv * 0.17 + vec2(drift * 0.012 + 1.4, -0.8));
        float coverage = mix(0.36, 0.60, weather);
        return smoothstep(coverage, coverage + 0.25, base);
      }

      // Crisp procedural twinkling night starfield mapped onto spherical sky direction
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

      void main() {
        vec3 rd = normalize(vWorldDir);
        vec3 sunDir = normalize(uSunDir);
        vec3 moonDir = normalize(uMoonDir);
        float h = clamp(rd.y, 0.0, 1.0);

        // Natural Rayleigh + Mie sky scattering gradient
        vec3 sky = mix(uHorizonColor, uMidColor, pow(smoothstep(0.0, 0.32, h), 0.78));
        sky = mix(sky, uTopColor, smoothstep(0.24, 0.85, h));

        // Atmospheric sunlight halo + solar aureole (fades smoothly during night)
        float sunDot = max(dot(rd, sunDir), 0.0);
        float dayHaloStrength = 1.0 - uMoonVisibility * 0.72;
        sky += uSunColor * pow(sunDot, 12.0) * 0.16 * dayHaloStrength;
        sky += uSunColor * pow(sunDot, 120.0) * 0.34 * dayHaloStrength;

        // Luminous full Moon disc + silvery lunar corona at dusk & night
        if (uMoonVisibility > 0.01 && rd.y > 0.02) {
          float moonDot = max(dot(rd, moonDir), 0.0);
          float moonDisc = smoothstep(0.9986, 0.9992, moonDot);
          float moonCorona = pow(moonDot, 42.0) * 0.28 + pow(moonDot, 6.0) * 0.09;
          // Subtle lunar maria mottling on the moon disc
          float maria = 0.86 + 0.14 * noise(rd.xz * 48.0 + vec2(3.1, 1.7));
          vec3 moonCol = vec3(0.95, 0.97, 1.0) * maria;
          sky += vec3(0.76, 0.86, 1.0) * moonCorona * uMoonVisibility;
          sky = mix(sky, moonCol, moonDisc * uMoonVisibility * 0.96);
        }

        // Twinkling stars emerging smoothly across clear upper sky at dusk & night
        if (uStarVisibility > 0.01 && rd.y > 0.06) {
          float s1 = sampleStars(rd);
          float s2 = sampleStars(rd * 1.43 + vec3(1.7, 0.9, 2.3)) * 0.65;
          float horizonFadeStars = smoothstep(0.06, 0.32, rd.y);
          vec3 starCol = mix(vec3(0.84, 0.91, 1.0), vec3(1.0, 0.95, 0.86), hash31(floor(rd * 195.0) + 7.1));
          sky += starCol * (s1 + s2) * uStarVisibility * horizonFadeStars * 0.95;
        }

        if (rd.y > 0.008) {
          // Curved atmospheric projection so clouds flatten and recede realistically toward the horizon
          float invY = 1.0 / (rd.y + 0.125);
          vec2 cloudUv = rd.xz * invY * 1.12;

          // --- LAYER 1: High-altitude wispy cirrus veil ---
          vec2 cirrusUv = rd.xz / (rd.y + 0.22) * vec2(0.85, 1.95) + vec2(uCloudDrift * 0.014, 0.0);
          float cirrusNoise = fbmCirrus(cirrusUv + vec2(fbmCirrus(cirrusUv * 0.6) * 0.7));
          float cirrusAlpha = smoothstep(0.56, 0.86, cirrusNoise) * 0.28 * smoothstep(0.02, 0.24, rd.y);
          vec3 cirrusCol = mix(uCloudLight, uHorizonColor, 0.18);
          sky = mix(sky, cirrusCol, cirrusAlpha);

          // --- LAYER 2: Main sunlit / moonlit volumetric cumulus cloud deck ---
          float density = sampleCumulusDensity(cloudUv, uCloudDrift);

          if (density > 0.002) {
            vec2 sunStep = sunDir.xz / max(sunDir.y + 0.32, 0.32);
            float dSun1 = sampleCumulusDensity(cloudUv + sunStep * 0.13, uCloudDrift);
            float dSun2 = sampleCumulusDensity(cloudUv + sunStep * 0.30, uCloudDrift);
            float opticalDepth = dSun1 * 0.72 + dSun2 * 0.52 + density * 0.38;
            float transmittance = exp(-opticalDepth * 1.75);

            float crownLight = clamp(transmittance * 1.32 + (1.0 - density) * 0.18, 0.0, 1.0);
            float silverLining = pow(sunDot, 6.0) * (1.0 - density * 0.62) * 0.52;
            float ambientBounce = mix(0.24, 0.68, smoothstep(0.0, 0.45, rd.y));

            vec3 litCloud = mix(uCloudShadow, uCloudLight * 1.05, clamp(crownLight * 0.86 + ambientBounce * 0.22, 0.0, 1.0));
            litCloud += uSunColor * silverLining * (0.45 + 0.55 * transmittance);

            float horizonFade = smoothstep(0.012, 0.19, rd.y);
            float distHaze = 1.0 - smoothstep(0.04, 0.30, rd.y);
            litCloud = mix(litCloud, uHorizonColor, distHaze * 0.44);

            float cloudAlpha = clamp(density * 1.18, 0.0, 0.98) * horizonFade;
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

  let accumulatedDrift = 14.5;
  let lastElapsed = 0;

  return {
    root,
    skyMaterial,
    update: (elapsedSec: number, breezeStrength: number) => {
      const dt = Math.max(0, Math.min(elapsedSec - lastElapsed, 1.5));
      lastElapsed = elapsedSec;
      const driftSpeed = 0.22 + 0.95 * breezeStrength;
      accumulatedDrift = wrapCloudX(accumulatedDrift, driftSpeed, dt);
      skyMaterial.uniforms.uCloudDrift.value = accumulatedDrift;
      skyMaterial.uniforms.uTime.value = elapsedSec;
    },
    applyLighting: (preset: LightingPreset) => {
      skyMaterial.uniforms.uTopColor.value.set(preset.skyTop);
      skyMaterial.uniforms.uMidColor.value.set(preset.skyMid);
      skyMaterial.uniforms.uHorizonColor.value.set(preset.skyHorizon);
      skyMaterial.uniforms.uSunDir.value.set(...preset.sunDirection).normalize();
      skyMaterial.uniforms.uSunColor.value.set(preset.sunColor);
      skyMaterial.uniforms.uCloudLight.value.set(preset.cloudTint);
      skyMaterial.uniforms.uCloudShadow.value.set(preset.cloudShadowTint);
      const isNight = preset.id === 'moonlight';
      skyMaterial.uniforms.uMoonDir.value.set(34, 62, -120).normalize();
      skyMaterial.uniforms.uStarVisibility.value = isNight ? 0.95 : 0.0;
      skyMaterial.uniforms.uMoonVisibility.value = isNight ? 0.95 : 0.0;
    },
    dispose: () => {
      skyGeo.dispose();
      skyMaterial.dispose();
    },
  };
}
