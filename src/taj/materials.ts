import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';

export interface TajMaterialLibrary {
  marbleMain: THREE.MeshPhysicalMaterial;
  marbleDome: THREE.MeshPhysicalMaterial;
  marbleDeck: THREE.MeshPhysicalMaterial;
  marbleTrim: THREE.MeshStandardMaterial;
  marbleShadowRecess: THREE.MeshStandardMaterial;
  marbleDeepVault: THREE.MeshStandardMaterial;
  marbleInlayPanel: THREE.MeshStandardMaterial;
  pishtaqFrame: THREE.MeshStandardMaterial;
  minaretMarble: THREE.MeshPhysicalMaterial;
  darkInlayStone: THREE.MeshStandardMaterial;
  jaliScreen: THREE.MeshStandardMaterial;
  bronzeFinial: THREE.MeshPhysicalMaterial;
  sandstone: THREE.MeshStandardMaterial;
  walkwaySandstone: THREE.MeshStandardMaterial;
  sandstoneDark: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  cypressCore: THREE.MeshStandardMaterial;
  cypressSprig: THREE.MeshStandardMaterial;
  shadeLeafCluster: THREE.MeshStandardMaterial;
  shrubLeafCluster: THREE.MeshStandardMaterial;
  flowerBorder: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
  riverSand: THREE.MeshStandardMaterial;
  water: THREE.ShaderMaterial;
  yamunaRiver: THREE.ShaderMaterial;
  poolBed: THREE.MeshStandardMaterial;
  fountainMist: THREE.MeshBasicMaterial;
  contactShadow: THREE.MeshBasicMaterial;
  dispose: () => void;
}

export function createTajMaterials(textures: ProceduralTextureSet): TajMaterialLibrary {
  const materials: THREE.Material[] = [];
  const track = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Authentic photographic Makrana white marble with normal micro-relief & subtle clearcoat
  const marbleMain = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.marbleMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.62,
      metalness: 0.02,
      clearcoat: 0.18,
      clearcoatRoughness: 0.36,
      envMapIntensity: 0.42,
    }),
  );

  // Grand bulbous onion dome marble with vertex-color AO support & curved specular sheen
  const marbleDome = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.marbleDomeMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 0.46,
      metalness: 0.02,
      clearcoat: 0.26,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.48,
      vertexColors: true,
    }),
  );

  // Polished Makrana marble courtyard deck paving (checkered/ashlar slab joints)
  const marbleDeck = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.marbleDeckMap,
      normalMap: textures.marbleDeckNormal,
      normalScale: new THREE.Vector2(0.52, 0.52),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.44,
      metalness: 0.02,
      clearcoat: 0.24,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.48,
    }),
  );

  // Crisp architectural moldings, cornices, plinth caps, and balusters
  const marbleTrim = track(
    new THREE.MeshStandardMaterial({
      color: 0xf7f2e8,
      map: textures.marbleMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 0.52,
      metalness: 0.02,
      envMapIntensity: 0.4,
    }),
  );

  // Recessed pointed-arch alcove interiors (rich warm shaded ivory stone depth)
  const marbleShadowRecess = track(
    new THREE.MeshStandardMaterial({
      color: 0xb7aa98,
      map: textures.marbleMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.82,
      metalness: 0.0,
      envMapIntensity: 0.2,
    }),
  );

  // Deepest shadowed interior vault inside the Great Pishtaq & sanctuary doorways
  const marbleDeepVault = track(
    new THREE.MeshStandardMaterial({
      color: 0x857869,
      map: textures.marbleMap,
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.12,
    }),
  );

  // Carved marble panel with pietra dura border & chevron frieze
  const marbleInlayPanel = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.inlayPanelMap,
      normalMap: textures.inlayPanelNormal,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.52,
      metalness: 0.02,
      envMapIntensity: 0.42,
    }),
  );

  // Great Pishtaq calligraphic border & floral arabesque spandrels with dedicated relief normal map
  const pishtaqFrame = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.pishtaqFrameMap,
      normalMap: textures.pishtaqFrameNormal,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.48,
      metalness: 0.02,
      envMapIntensity: 0.44,
    }),
  );

  // Tapering minaret masonry shaft with signature dark inlaid horizontal mortar rings
  const minaretMarble = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.minaretBandMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.46, 0.46),
      roughness: 0.52,
      metalness: 0.02,
      clearcoat: 0.16,
      clearcoatRoughness: 0.38,
      envMapIntensity: 0.42,
    }),
  );

  // Black/slate marble inlaid framing strips, shadow undercut grooves, & drum chevrons
  const darkInlayStone = track(
    new THREE.MeshStandardMaterial({
      color: 0x3b3835,
      roughness: 0.62,
      metalness: 0.04,
      envMapIntensity: 0.3,
    }),
  );

  // Perforated geometric marble Jali lattice window screen
  const jaliScreen = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.jaliScreenMap,
      roughness: 0.78,
      metalness: 0.02,
      envMapIntensity: 0.2,
    }),
  );

  // Authentic weathered antique Mughal gilded bronze Kalasha finial (matches dark sculpted spire in photo)
  const bronzeFinial = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x5c492e,
      roughness: 0.34,
      metalness: 0.84,
      clearcoat: 0.3,
      clearcoatRoughness: 0.26,
      envMapIntensity: 1.15,
    }),
  );

  // Real photographic Agra red sandstone paving & lower terrace
  const sandstone = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.sandstoneMap,
      normalMap: textures.sandstoneNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.84,
      metalness: 0.01,
      envMapIntensity: 0.24,
    }),
  );

  // World-proportioned Agra red sandstone flagstone paving for the long pool promenades (zero UV stretching!)
  const walkwaySandstone = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.walkwayPavingMap,
      normalMap: textures.walkwayPavingNormal,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughness: 0.82,
      metalness: 0.01,
      envMapIntensity: 0.26,
    }),
  );

  const sandstoneDark = track(
    new THREE.MeshStandardMaterial({
      color: 0xc99684,
      map: textures.sandstoneMap,
      normalMap: textures.sandstoneNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.88,
      metalness: 0.01,
      envMapIntensity: 0.2,
    }),
  );

  // Real photographic manicured Mughal garden lawn grass
  const grass = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.grassMap,
      normalMap: textures.grassNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.16,
    }),
  );

  // Dark shaded interior core of clipped cypresses (gives dense natural depth behind feathery sprigs)
  const cypressCore = track(
    new THREE.MeshStandardMaterial({
      color: 0x1a2d15,
      roughness: 0.95,
      metalness: 0.0,
    }),
  );

  // Feathery alpha-tested cypress needle sprigs with spherical crown vertex-color AO
  const cypressSprig = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.cypressSprigMap,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0.0,
      envMapIntensity: 0.14,
      vertexColors: true,
    }),
  );

  // Alpha-tested leafy branch clusters for deciduous shade trees with volumetric crown AO
  const shadeLeafCluster = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.leafClusterMap,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.84,
      metalness: 0.0,
      envMapIntensity: 0.18,
      vertexColors: true,
    }),
  );

  // Slightly deeper clipped garden shrub foliage
  const shrubLeafCluster = track(
    new THREE.MeshStandardMaterial({
      color: 0xe6f0d8,
      map: textures.leafClusterMap,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.16,
      vertexColors: true,
    }),
  );

  // Delicate Mughal rose, marigold & jasmine flowering garden border tufts
  const flowerBorder = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.flowerTuftMap,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.86,
      metalness: 0.0,
    }),
  );

  // Furrowed natural tree bark with Sobel normal map relief
  const bark = track(
    new THREE.MeshStandardMaterial({
      color: 0xd8cec2,
      map: textures.barkMap,
      normalMap: textures.barkNormal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.1,
    }),
  );

  // Warm alluvial Yamuna riverbank sand & silt
  const riverSand = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.riverSandMap,
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.14,
    }),
  );

  const poolBed = track(
    new THREE.MeshStandardMaterial({
      color: 0x3b453c,
      roughness: 0.92,
      metalness: 0.0,
    }),
  );

  // Ultra-realistic Mughal reflecting pool water shader:
  // glassy calm mirror reflection of the Taj Mahal, flanking dark cypresses, drifting clouds,
  // animated concentric fountain rings around each water nozzle, wet curb shadow, & subtle stone-basin caustics
  const water = track(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBreeze: { value: 1.0 },
        uBuildProgress: { value: 1.0 },
        uSprinklerIntensity: { value: 1.0 },
        uSkyColor: { value: new THREE.Color('#5f8fc2') },
        uHorizonColor: { value: new THREE.Color('#dbe8f5') },
        uWaterDeep: { value: new THREE.Color('#27332d') },
        uSunDir: { value: new THREE.Vector3(0.68, 0.55, 0.38).normalize() },
        uSunColor: { value: new THREE.Color('#fff5e2') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uBreeze;
        uniform float uBuildProgress;
        uniform float uSprinklerIntensity;
        uniform vec3 uSkyColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uWaterDeep;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;

        varying vec2 vUv;
        varying vec3 vWorldPos;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.12);
          return fract(p.x * p.y);
        }

        float noise2(vec2 p) {
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
          // 1. Delicate glassy capillary breeze ripples (crisp micro-scale, never coarse blobs)
          float t = uTime * (0.45 + 0.65 * uBreeze);
          vec2 pA = vec2(vWorldPos.x * 2.6 + t * 0.45, vWorldPos.z * 3.8 - t * 0.72);
          vec2 pB = vec2(vWorldPos.x * 5.8 - t * 0.65, vWorldPos.z * 7.2 + t * 0.55);
          float nA = noise2(pA);
          float nB = noise2(pB);
          float dNx = (noise2(pA + vec2(0.08, 0.0)) - nA) * 0.65 + (noise2(pB + vec2(0.06, 0.0)) - nB) * 0.35;
          float dNz = (noise2(pA + vec2(0.0, 0.08)) - nA) * 0.65 + (noise2(pB + vec2(0.0, 0.06)) - nB) * 0.35;

          // 2. Physical concentric water rings radiating out from each bronze nozzle when sprinklers spray!
          float spacing = 5.347;
          float fzLocal = mod(vWorldPos.z - 35.7 + spacing * 0.5, spacing) - spacing * 0.5;
          float fDist = length(vec2(vWorldPos.x, fzLocal));
          float ringWave = sin(fDist * 16.5 - uTime * 4.6) * exp(-fDist * 1.32);
          float ringMask = smoothstep(2.55, 0.14, fDist) * uSprinklerIntensity;
          vec2 ringGrad = normalize(vec2(vWorldPos.x, fzLocal) + vec2(0.0001)) * ringWave * ringMask * 0.115;

          float breezeAmp = 0.042 + 0.088 * uBreeze;
          vec3 N = normalize(vec3(
            -dNx * breezeAmp * 1.6 - ringGrad.x,
            1.0,
            -dNz * breezeAmp * 2.2 - ringGrad.y
          ));

          vec3 V = normalize(cameraPosition - vWorldPos);
          float ndotv = clamp(dot(N, V), 0.0, 1.0);
          // Grazing eye-level Fresnel -> mirror-like glassy reflections ahead, transparent stone basin at feet
          float fresnel = mix(0.24, 0.94, pow(1.0 - ndotv, 2.65));

          // 3. Sky & drifting cloud reflection matching the Agra sky dome across day/evening/night
          vec3 R = reflect(-V, N);
          float skyH = clamp(R.y, 0.0, 1.0);
          vec3 reflSky = mix(uHorizonColor, uSkyColor, pow(smoothstep(0.0, 0.52, skyH), 0.72));
          float cloudPatch = smoothstep(0.46, 0.76, noise2(vec2(vWorldPos.x * 0.09 + uTime * 0.03, vWorldPos.z * 0.035)) * 0.65 + noise2(vec2(vWorldPos.x * 0.22, vWorldPos.z * 0.09)) * 0.35);
          vec3 cloudReflCol = mix(uHorizonColor, uSunColor, 0.35);
          reflSky = mix(reflSky, cloudReflCol, cloudPatch * 0.38);

          // 4. Razor-sharp, delicately micro-sliced inverted reflection of the Taj Mahal
          // vUv.y = 0 at south end (near viewer), vUv.y = 1 at north end (near Taj plinth)
          float rx = (vUv.x - 0.5) * 2.0 + N.x * 0.36;
          float ry = (1.0 - vUv.y) + N.z * 0.16;

          float plinth = smoothstep(0.88, 0.78, abs(rx)) * smoothstep(0.01, 0.05, ry) * smoothstep(0.18, 0.13, ry);
          float body = smoothstep(0.46, 0.39, abs(rx)) * smoothstep(0.12, 0.17, ry) * smoothstep(0.42, 0.36, ry);
          float pishtaqArch = smoothstep(0.145, 0.085, abs(rx)) * smoothstep(0.14, 0.19, ry) * smoothstep(0.37, 0.29, ry);
          float sideArchL = smoothstep(0.065, 0.03, abs(rx + 0.26)) * smoothstep(0.16, 0.21, ry) * smoothstep(0.36, 0.30, ry);
          float sideArchR = smoothstep(0.065, 0.03, abs(rx - 0.26)) * smoothstep(0.16, 0.21, ry) * smoothstep(0.36, 0.30, ry);
          float dome = smoothstep(0.24, 0.18, length(vec2(rx * 1.15, (ry - 0.47) * 1.55)));
          float chhatriL = smoothstep(0.09, 0.055, length(vec2((rx + 0.23) * 1.2, (ry - 0.43) * 1.65)));
          float chhatriR = smoothstep(0.09, 0.055, length(vec2((rx - 0.23) * 1.2, (ry - 0.43) * 1.65)));
          float finial = smoothstep(0.018, 0.004, abs(rx)) * smoothstep(0.55, 0.58, ry) * smoothstep(0.67, 0.62, ry);
          float minL = smoothstep(0.055, 0.025, abs(rx + 0.72)) * smoothstep(0.08, 0.13, ry) * smoothstep(0.56, 0.48, ry);
          float minR = smoothstep(0.055, 0.025, abs(rx - 0.72)) * smoothstep(0.08, 0.13, ry) * smoothstep(0.56, 0.48, ry);

          float tajMask = clamp(
            max(max(plinth, body), max(max(dome, max(chhatriL, chhatriR)), max(finial, max(minL, minR)))),
            0.0,
            1.0
          ) * smoothstep(0.15, 0.95, uBuildProgress);

          // Authentic warm sunlit / golden / silvery moonlit Makrana marble reflection tone
          vec3 marbleRefl = mix(vec3(0.89, 0.86, 0.79), uSunColor, 0.32) * mix(0.42, 1.02, clamp(length(uHorizonColor) * 0.62, 0.0, 1.0));
          float archShade = clamp(pishtaqArch * 0.34 + (sideArchL + sideArchR) * 0.22, 0.0, 0.38);
          marbleRefl *= (1.0 - archShade);
          vec3 surfaceRefl = mix(reflSky, marbleRefl, tajMask * 0.86);

          // 5. Flanking dark-emerald cypress avenue reflections along the left & right pool margins
          float edgeBand = smoothstep(0.62, 0.92, abs(rx));
          float cypressRhythm = 0.55 + 0.45 * sin(vWorldPos.z * 0.98 + N.z * 12.0);
          vec3 cypressReflCol = mix(vec3(0.08, 0.14, 0.08), vec3(0.16, 0.25, 0.14), cypressRhythm) * mix(0.45, 1.0, clamp(length(uHorizonColor) * 0.6, 0.0, 1.0));
          surfaceRefl = mix(surfaceRefl, cypressReflCol, edgeBand * 0.58);

          // 6. Submerged carved stone pool basin tiles + subtle dancing sunlight caustics (visible close to feet)
          float tileX = smoothstep(0.04, 0.08, abs(fract(vWorldPos.x * 0.85) - 0.5));
          float tileZ = smoothstep(0.04, 0.08, abs(fract(vWorldPos.z * 0.85) - 0.5));
          float caustics = pow(noise2(vec2(vWorldPos.x * 3.1 + t * 0.9, vWorldPos.z * 3.1 - t * 0.7)), 3.0) * 0.26;
          vec3 basinBed = uWaterDeep * mix(0.76, 1.05, tileX * tileZ) + vec3(0.16, 0.18, 0.13) * caustics;

          // Dark wet-stone reflection & ambient occlusion along the raised white marble inner curbs
          float curbAO = smoothstep(0.0, 0.11, vUv.x) * smoothstep(1.0, 0.89, vUv.x);
          basinBed *= mix(0.48, 1.0, curbAO);
          surfaceRefl *= mix(0.62, 1.0, curbAO);

          // 7. Crisp fountain ring splash highlights + sunlit/moonlit specular sparkle
          vec3 H = normalize(normalize(uSunDir) + V);
          float specSharp = pow(max(dot(N, H), 0.0), 260.0) * 0.95;
          float splashFoam = smoothstep(0.42, 0.06, fDist) * uSprinklerIntensity * 0.24;
          float ringGlint = max(0.0, ringWave) * ringMask * 0.34;

          vec3 col = mix(basinBed, surfaceRefl, fresnel) + uSunColor * (specSharp + ringGlint) + vec3(0.92, 0.96, 1.0) * splashFoam;
          gl_FragColor = vec4(col, 0.97);
        }
      `,
      transparent: true,
    }),
  );

  // Broad, serene flowing Yamuna River shader behind the Taj Mahal (North bank)
  const yamunaRiver = track(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBreeze: { value: 1.0 },
        uSkyTop: { value: new THREE.Color('#3e72b0') },
        uSkyHorizon: { value: new THREE.Color('#d9e7f5') },
        uRiverDeep: { value: new THREE.Color('#2d4b58') },
        uRiverShallow: { value: new THREE.Color('#697c74') },
        uSunDir: { value: new THREE.Vector3(0.68, 0.55, 0.38).normalize() },
        uSunColor: { value: new THREE.Color('#fff5e2') },
        uFogColor: { value: new THREE.Color('#d4e2f0') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uBreeze;
        uniform vec3 uSkyTop;
        uniform vec3 uSkyHorizon;
        uniform vec3 uRiverDeep;
        uniform vec3 uRiverShallow;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uFogColor;

        varying vec2 vUv;
        varying vec3 vWorldPos;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise2(vec2 p) {
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
          // Gentle slow east-to-west flowing river current + wind capillary waves
          float flow = uTime * (0.42 + 0.35 * uBreeze);
          vec2 p1 = vec2(vWorldPos.x * 0.14 - flow * 0.65, vWorldPos.z * 0.34);
          vec2 p2 = vec2(vWorldPos.x * 0.32 - flow * 1.15, vWorldPos.z * 0.72 + flow * 0.18);
          vec2 p3 = vec2(vWorldPos.x * 0.85 - flow * 1.75, vWorldPos.z * 1.45 - flow * 0.32);

          float h1 = noise2(p1);
          float h2 = noise2(p2);
          float h3 = noise2(p3);
          float wave = h1 * 0.52 + h2 * 0.32 + h3 * 0.16;

          float dx = (noise2(p1 + vec2(0.18, 0.0)) - h1) * 0.55 + (noise2(p2 + vec2(0.12, 0.0)) - h2) * 0.45;
          float dz = (noise2(p1 + vec2(0.0, 0.18)) - h1) * 0.55 + (noise2(p2 + vec2(0.0, 0.12)) - h2) * 0.45;
          float amp = 0.24 + 0.28 * uBreeze;
          vec3 N = normalize(vec3(-dx * amp * 1.6, 1.0, -dz * amp * 2.2));

          vec3 V = normalize(cameraPosition - vWorldPos);
          float ndotv = clamp(dot(N, V), 0.0, 1.0);
          float fresnel = mix(0.18, 0.88, pow(1.0 - ndotv, 2.7));

          // Sky + drifting sunlit cloud reflection in the Yamuna
          vec3 R = reflect(-V, N);
          float skyElev = clamp(R.y, 0.0, 1.0);
          vec3 reflCol = mix(uSkyHorizon, uSkyTop, pow(smoothstep(0.0, 0.72, skyElev), 0.75));
          float cloudRefl = smoothstep(0.45, 0.78, noise2(vec2(vWorldPos.x * 0.015 - flow * 0.05, vWorldPos.z * 0.025)));
          reflCol = mix(reflCol, vec3(0.95, 0.96, 0.98) * mix(vec3(1.0), uSunColor, 0.35), cloudRefl * 0.28);

          // Soft warm reflection of the Taj Mahal's north marble facade & plinth on the near south bank
          float tajAlign = exp(-pow((vWorldPos.x + dx * 12.0) / 36.0, 2.0));
          float nearSouthBank = smoothstep(0.55, 0.02, vUv.y);
          vec3 tajRefl = mix(vec3(0.86, 0.82, 0.74), uSunColor, 0.22);
          reflCol = mix(reflCol, tajRefl, tajAlign * nearSouthBank * 0.36);

          // Deep mid-channel river tone -> shallow silty sandbars along both banks
          float bankDist = min(vUv.y, 1.0 - vUv.y);
          float shallowMask = smoothstep(0.18, 0.015, bankDist);
          vec3 riverBase = mix(uRiverDeep, uRiverShallow, shallowMask * 0.82 + wave * 0.12);

          // Subtle shimmering foam wisps right along the sandy shoreline
          float foamBand = smoothstep(0.045, 0.005, bankDist) * smoothstep(0.42, 0.72, wave);
          vec3 col = mix(riverBase, reflCol, fresnel);
          col = mix(col, mix(uSkyHorizon, vec3(0.92, 0.90, 0.84), 0.5), foamBand * 0.42);

          // Broad sunlit river glitter path
          vec3 H = normalize(normalize(uSunDir) + V);
          float specBroad = pow(max(dot(N, H), 0.0), 42.0) * 0.18;
          float specSharp = pow(max(dot(N, H), 0.0), 220.0) * 0.85;
          col += uSunColor * (specBroad + specSharp);

          // Atmospheric distance haze blending east/west river bends seamlessly into the horizon
          float camDist = length(cameraPosition - vWorldPos);
          float fogFactor = 1.0 - exp(-pow(camDist * 0.0021, 1.55));
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 0.92));

          gl_FragColor = vec4(col, 0.98);
        }
      `,
      transparent: true,
    }),
  );

  // Delicate white water-jet spray above bronze fountains
  const fountainMist = track(
    new THREE.MeshBasicMaterial({
      color: 0xf4f7fa,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  );

  // Soft ground contact shadow for anchoring plinth, mausoleum, minarets, and trees
  const contactShadow = track(
    new THREE.MeshBasicMaterial({
      map: textures.contactShadowMap,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );

  return {
    marbleMain,
    marbleDome,
    marbleDeck,
    marbleTrim,
    marbleShadowRecess,
    marbleDeepVault,
    marbleInlayPanel,
    pishtaqFrame,
    minaretMarble,
    darkInlayStone,
    jaliScreen,
    bronzeFinial,
    sandstone,
    walkwaySandstone,
    sandstoneDark,
    grass,
    cypressCore,
    cypressSprig,
    shadeLeafCluster,
    shrubLeafCluster,
    flowerBorder,
    bark,
    riverSand,
    water,
    yamunaRiver,
    poolBed,
    fountainMist,
    contactShadow,
    dispose: () => {
      for (const mat of materials) {
        mat.dispose();
      }
    },
  };
}
