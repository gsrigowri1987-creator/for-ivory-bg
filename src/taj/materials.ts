import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';

export interface TajMaterialLibrary {
  marbleMain: THREE.MeshPhysicalMaterial;
  marbleDome: THREE.MeshPhysicalMaterial;
  marbleDeck: THREE.MeshPhysicalMaterial;
  marbleTrim: THREE.MeshStandardMaterial;
  poolCurbMarble: THREE.MeshStandardMaterial;
  marbleShadowRecess: THREE.MeshStandardMaterial;
  marbleDeepVault: THREE.MeshStandardMaterial;
  marbleMuqarnasVault: THREE.MeshStandardMaterial;
  marbleMuqarnasRib: THREE.MeshStandardMaterial;
  marbleInlayPanel: THREE.MeshPhysicalMaterial;
  pishtaqFrame: THREE.MeshPhysicalMaterial;
  minaretMarble: THREE.MeshPhysicalMaterial;
  darkInlayStone: THREE.MeshStandardMaterial;
  jaliScreen: THREE.MeshStandardMaterial;
  carvedJaliMarble: THREE.MeshStandardMaterial;
  bronzeFinial: THREE.MeshPhysicalMaterial;
  sandstone: THREE.MeshStandardMaterial;
  walkwaySandstone: THREE.MeshStandardMaterial;
  walkwayFlagstone: THREE.MeshStandardMaterial;
  sandstoneDark: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  grassBlade: THREE.MeshStandardMaterial;
  boxwoodHedge: THREE.MeshStandardMaterial;
  groundClutter: THREE.MeshStandardMaterial;
  blossomCluster: THREE.MeshStandardMaterial;
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
  updateSunUniforms: (sunDir: THREE.Vector3, sunColor: THREE.Color) => void;
  updateEnvironmentTime: (elapsedSec: number, breezeStrength: number) => void;
  dispose: () => void;
}

interface SharedAtmosphereUniforms {
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uCloudTime: { value: number };
  uBreezeTime: { value: number };
  uBreezeAmp: { value: number };
}

/** Shared GLSL functions for giant slow-moving soft cloud shadows projected across world geometry. */
const CLOUD_SHADOW_GLSL = /* glsl */ `
float csHash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.12);
  return fract(p.x * p.y);
}
float csNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(csHash21(i), csHash21(i + vec2(1.0, 0.0)), f.x),
    mix(csHash21(i + vec2(0.0, 1.0)), csHash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float computeCloudShadow(vec3 wp, vec3 sunDir, float cloudTime) {
  vec2 projXZ = wp.xz - sunDir.xz * (wp.y / max(sunDir.y, 0.25)) * 0.45;
  vec2 uv = projXZ * 0.0115 + vec2(cloudTime * 0.014, cloudTime * 0.005);
  float n1 = csNoise(uv);
  float n2 = csNoise(uv * 2.15 + vec2(-cloudTime * 0.008, cloudTime * 0.011));
  float cloudField = n1 * 0.68 + n2 * 0.32;
  float shadowMask = smoothstep(0.50, 0.84, cloudField);
  // Subtle cinematic breathing cloud shadow (never darkens scene harshly)
  return mix(1.0, 0.78, shadowMask);
}
`;

/**
 * Inject Makrana calcite marble subsurface scattering, block-by-block warm/cool slab variation,
 * subtle rainwater-streak weathering below cornices & minaret balconies, and slow-moving cloud shadows.
 */
function injectMarbleSubsurface(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  sharedUniforms: SharedAtmosphereUniforms,
  strength: number,
  cacheSuffix: string,
): void {
  material.customProgramCacheKey = () => `makrana-aaa-${cacheSuffix}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDirSSS = sharedUniforms.uSunDir;
    shader.uniforms.uSunColorSSS = sharedUniforms.uSunColor;
    shader.uniforms.uCloudTimeSSS = sharedUniforms.uCloudTime;
    shader.uniforms.uMarbleSssStrength = { value: strength };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vMarbleWorldPos;
        varying vec3 vMarbleWorldNorm;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 mWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mWp = instanceMatrix * mWp;
        #endif
        mWp = modelMatrix * mWp;
        vMarbleWorldPos = mWp.xyz;
        mat3 mNormMat = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          mNormMat = mNormMat * mat3(instanceMatrix);
        #endif
        vMarbleWorldNorm = normalize(mNormMat * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform vec3 uSunDirSSS;
        uniform vec3 uSunColorSSS;
        uniform float uCloudTimeSSS;
        uniform float uMarbleSssStrength;
        varying vec3 vMarbleWorldPos;
        varying vec3 vMarbleWorldNorm;
        ${CLOUD_SHADOW_GLSL}
        float blockHash31(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        // 1. Individual Makrana marble ashlar block-by-block warm/cool slab variation
        vec3 blkCoord = vec3(
          floor(vMarbleWorldPos.x / 1.55 + floor(vMarbleWorldPos.y / 0.90) * 0.5),
          floor(vMarbleWorldPos.y / 0.90),
          floor(vMarbleWorldPos.z / 1.55)
        );
        float blkRand = blockHash31(blkCoord);
        vec3 warmBlock = vec3(1.032, 1.012, 0.976);
        vec3 coolBlock = vec3(0.958, 0.972, 0.996);
        diffuseColor.rgb *= mix(coolBlock, warmBlock, blkRand);

        // 2. Subtle rainwater-streak staining directly beneath cornices, stringcourses & minaret balconies
        float horizWall = 1.0 - abs(normalize(vMarbleWorldNorm).y);
        float dripFreq = csNoise(vec2((vMarbleWorldPos.x + vMarbleWorldPos.z) * 1.9, vMarbleWorldPos.y * 0.22));
        float dripMask = smoothstep(0.42, 0.86, dripFreq);
        float streak = 0.0;
        // Plinth top cornice (y ~ 5.10)
        streak += smoothstep(5.22, 5.05, vMarbleWorldPos.y) * smoothstep(3.75, 5.05, vMarbleWorldPos.y) * 0.14;
        // Mausoleum mid-stringcourse (y ~ 14.05) & roof parapet (y ~ 22.85)
        streak += smoothstep(14.15, 13.92, vMarbleWorldPos.y) * smoothstep(12.6, 13.92, vMarbleWorldPos.y) * 0.12;
        streak += smoothstep(22.95, 22.70, vMarbleWorldPos.y) * smoothstep(21.2, 22.70, vMarbleWorldPos.y) * 0.13;
        // Minaret 3 circular balcony overhangs (y ~ 15.65, 23.95, 31.45)
        streak += smoothstep(15.75, 15.50, vMarbleWorldPos.y) * smoothstep(14.2, 15.50, vMarbleWorldPos.y) * 0.14;
        streak += smoothstep(24.05, 23.80, vMarbleWorldPos.y) * smoothstep(22.5, 23.80, vMarbleWorldPos.y) * 0.14;
        streak += smoothstep(31.55, 31.30, vMarbleWorldPos.y) * smoothstep(30.0, 31.30, vMarbleWorldPos.y) * 0.13;
        float stain = clamp(streak * dripMask * horizWall, 0.0, 0.18);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.76, 0.72, 0.64), stain);
        `,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        vec3 mN = normalize(vMarbleWorldNorm);
        vec3 mV = normalize(cameraPosition - vMarbleWorldPos);
        vec3 mL = normalize(uSunDirSSS);
        float mNdotL = dot(mN, mL);
        float cloudVis = computeCloudShadow(vMarbleWorldPos, mL, uCloudTimeSSS);

        // Subtle calcite wrap-scattering across the shadow terminator (warm honey-peach translucent scatter)
        float wrapScatter = clamp((mNdotL + 0.42) / 1.42, 0.0, 1.0) * smoothstep(0.55, -0.18, mNdotL);
        // Backlit & oblique grazing translucency along curved dome & minaret edges
        float rimView = pow(1.0 - clamp(dot(mN, mV), 0.0, 1.0), 2.8);
        float forwardScatter = pow(clamp(dot(mV, -mL), 0.0, 1.0), 3.0) * 0.65 + 0.35;
        vec3 calciteTint = vec3(1.0, 0.80, 0.58) * uSunColorSSS;
        outgoingLight *= mix(0.84, 1.0, (cloudVis - 0.78) / 0.22);
        // Subtle cool slate-blue bounce in deep architectural shade opposite the warm sun key
        float shadowSide = smoothstep(0.15, -0.55, mNdotL);
        outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.86, 0.92, 1.06), shadowSide * 0.38);
        outgoingLight += diffuseColor.rgb * calciteTint * (wrapScatter * 0.20 + rimView * forwardScatter * 0.25) * uMarbleSssStrength * cloudVis;
        #include <opaque_fragment>
        `,
      );
  };
}

/**
 * Inject giant slow-moving cloud shadows + subtle shaded crevice dampness/moss onto ground, sandstone & grass surfaces.
 */
function injectGroundCloudAndMoss(
  material: THREE.MeshStandardMaterial,
  sharedUniforms: SharedAtmosphereUniforms,
  mossStrength: number,
  cacheSuffix: string,
): void {
  material.customProgramCacheKey = () => `ground-cloud-moss-${cacheSuffix}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDirG = sharedUniforms.uSunDir;
    shader.uniforms.uCloudTimeG = sharedUniforms.uCloudTime;
    shader.uniforms.uMossStrengthG = { value: mossStrength };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vGroundWorldPos;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 gWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gWp = instanceMatrix * gWp;
        #endif
        gWp = modelMatrix * gWp;
        vGroundWorldPos = gWp.xyz;
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform vec3 uSunDirG;
        uniform float uCloudTimeG;
        uniform float uMossStrengthG;
        varying vec3 vGroundWorldPos;
        ${CLOUD_SHADOW_GLSL}
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        if (uMossStrengthG > 0.001) {
          // Subtle shaded dampness & moss tucked along outer walkway lawn edges & shaded stone seams
          float edgeProx = smoothstep(7.2, 7.95, abs(vGroundWorldPos.x)) * (1.0 - smoothstep(8.2, 9.0, abs(vGroundWorldPos.x)));
          float patchNoise = csNoise(vGroundWorldPos.xz * 1.45) * csNoise(vGroundWorldPos.xz * 3.8);
          float mossAmt = smoothstep(0.18, 0.56, patchNoise) * (0.28 + 0.72 * edgeProx) * uMossStrengthG;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.34, 0.18), mossAmt);
        }
        `,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        float gCloud = computeCloudShadow(vGroundWorldPos, normalize(uSunDirG), uCloudTimeG);
        outgoingLight *= gCloud;
        #include <opaque_fragment>
        `,
      );
  };
}

/**
 * Inject sharp golden metallic starburst sun glint onto gilded Mughal Kalasha finials.
 */
function injectGoldFinialGlint(
  material: THREE.MeshPhysicalMaterial,
  sharedUniforms: SharedAtmosphereUniforms,
): void {
  material.customProgramCacheKey = () => 'kalasha-gold-glint';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDirGold = sharedUniforms.uSunDir;
    shader.uniforms.uSunColorGold = sharedUniforms.uSunColor;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vGoldWorldPos;
        varying vec3 vGoldWorldNorm;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 glWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          glWp = instanceMatrix * glWp;
        #endif
        glWp = modelMatrix * glWp;
        vGoldWorldPos = glWp.xyz;
        mat3 glNMat = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          glNMat = glNMat * mat3(instanceMatrix);
        #endif
        vGoldWorldNorm = normalize(glNMat * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform vec3 uSunDirGold;
        uniform vec3 uSunColorGold;
        varying vec3 vGoldWorldPos;
        varying vec3 vGoldWorldNorm;
        `,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        vec3 gN = normalize(vGoldWorldNorm);
        vec3 gV = normalize(cameraPosition - vGoldWorldPos);
        vec3 gL = normalize(uSunDirGold);
        vec3 gH = normalize(gL + gV);
        // Sharp warm metallic sun glint + grazing gilded edge sparkle (triggers soft HDR bloom on finials)
        float sharpGlint = pow(max(dot(gN, gH), 0.0), 320.0) * 6.2;
        float warmRim = pow(1.0 - max(dot(gN, gV), 0.0), 3.0) * max(dot(gN, gL) * 0.5 + 0.5, 0.0) * 0.85;
        outgoingLight += vec3(1.0, 0.86, 0.48) * uSunColorGold * (sharpGlint + warmRim);
        #include <opaque_fragment>
        `,
      );
  };
}

/**
 * Inject GPU wind-wave vertex sway, root-to-tip AO, sunlit golden backlighting & cloud shadows for 3D grass blades.
 */
function injectSwayingGrassShader(
  material: THREE.MeshStandardMaterial,
  sharedUniforms: SharedAtmosphereUniforms,
): void {
  material.customProgramCacheKey = () => 'instanced-3d-grass-blade';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDirGr = sharedUniforms.uSunDir;
    shader.uniforms.uSunColorGr = sharedUniforms.uSunColor;
    shader.uniforms.uCloudTimeGr = sharedUniforms.uCloudTime;
    shader.uniforms.uBreezeTimeGr = sharedUniforms.uBreezeTime;
    shader.uniforms.uBreezeAmpGr = sharedUniforms.uBreezeAmp;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uBreezeTimeGr;
        uniform float uBreezeAmpGr;
        varying float vBladeTip;
        varying vec3 vBladeWorldPos;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        float tipMask = clamp(position.y / 0.34, 0.0, 1.0);
        vBladeTip = tipMask;
        vec4 instOrigin = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          instOrigin = instanceMatrix * instOrigin;
        #endif
        vec3 instWorld = (modelMatrix * instOrigin).xyz;

        // Smooth distance-based LOD height fade so dense foreground grass melts naturally into turf without FPS drop
        float camDistGr = length(cameraPosition - instWorld);
        float lodScale = 1.0 - smoothstep(42.0, 78.0, camDistGr);
        transformed *= mix(0.08, 1.0, lodScale);

        // Travelling golden-hour garden wind gusts bending blade tips organically
        float gustPhase = instWorld.x * 0.24 + instWorld.z * 0.19 - uBreezeTimeGr * 1.85;
        float swayX = (sin(gustPhase) * 0.075 + sin(gustPhase * 2.1 + 1.4) * 0.028) * uBreezeAmpGr * lodScale;
        float swayZ = cos(gustPhase * 0.85 + instWorld.z * 0.35) * 0.048 * uBreezeAmpGr * lodScale;
        float bend = tipMask * tipMask;
        transformed.x += swayX * bend;
        transformed.z += swayZ * bend;
        transformed.y -= (abs(swayX) + abs(swayZ)) * 0.20 * bend;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 bWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          bWp = instanceMatrix * bWp;
        #endif
        vBladeWorldPos = (modelMatrix * bWp).xyz;
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform vec3 uSunDirGr;
        uniform vec3 uSunColorGr;
        uniform float uCloudTimeGr;
        varying float vBladeTip;
        varying vec3 vBladeWorldPos;
        ${CLOUD_SHADOW_GLSL}
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        // Deep soil-grounded roots -> lush Mughal emerald & subtle warm olive blade tips
        vec3 rootTint = vec3(0.38, 0.46, 0.30);
        vec3 tipTint = vec3(0.96, 1.08, 0.72);
        diffuseColor.rgb *= mix(rootTint, tipTint, pow(vBladeTip, 0.85));
        `,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        vec3 gV = normalize(cameraPosition - vBladeWorldPos);
        vec3 gL = normalize(uSunDirGr);
        float cloudVis = computeCloudShadow(vBladeWorldPos, gL, uCloudTimeGr);
        float tipScatter = pow(clamp(dot(gV, -gL), 0.0, 1.0), 2.8) * 0.45 + 0.22;
        outgoingLight *= cloudVis;
        outgoingLight += diffuseColor.rgb * uSunColorGr * vec3(0.56, 0.76, 0.28) * (vBladeTip * vBladeTip) * tipScatter * 0.30 * cloudVis;
        #include <opaque_fragment>
        `,
      );
  };
}

/**
 * Inject backlit botanical leaf subsurface scattering (SSS) for golden-hour translucent foliage glow.
 */
function injectFoliageSubsurface(
  material: THREE.MeshStandardMaterial,
  sharedUniforms: SharedAtmosphereUniforms,
  tintHex: number,
  strength: number,
  cacheSuffix: string,
): void {
  const sssTint = new THREE.Color(tintHex);
  material.customProgramCacheKey = () => `foliage-sss-${cacheSuffix}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDirLeaf = sharedUniforms.uSunDir;
    shader.uniforms.uSunColorLeaf = sharedUniforms.uSunColor;
    shader.uniforms.uLeafSssTint = { value: sssTint };
    shader.uniforms.uLeafSssStrength = { value: strength };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vLeafWorldPos;
        varying vec3 vLeafWorldNorm;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 lWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lWp = instanceMatrix * lWp;
        #endif
        lWp = modelMatrix * lWp;
        vLeafWorldPos = lWp.xyz;
        mat3 lNormMat = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          lNormMat = lNormMat * mat3(instanceMatrix);
        #endif
        vLeafWorldNorm = normalize(lNormMat * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform vec3 uSunDirLeaf;
        uniform vec3 uSunColorLeaf;
        uniform vec3 uLeafSssTint;
        uniform float uLeafSssStrength;
        varying vec3 vLeafWorldPos;
        varying vec3 vLeafWorldNorm;
        `,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        vec3 fN = normalize(vLeafWorldNorm);
        vec3 fV = normalize(cameraPosition - vLeafWorldPos);
        vec3 fL = normalize(uSunDirLeaf);
        // Controlled backlit olive-green transmittance (avoids washed-out yellow-beige sun-side blowout)
        float backLight = pow(clamp(dot(fV, -fL + fN * 0.35), 0.0, 1.0), 3.2);
        float crownWrap = clamp(dot(fN, fL) * 0.5 + 0.5, 0.0, 1.0);
        float edgeRim = pow(1.0 - abs(dot(fN, fV)), 2.5) * crownWrap;
        vec3 leafGlow = diffuseColor.rgb * uLeafSssTint * mix(vec3(0.92, 0.96, 0.86), uSunColorLeaf, 0.45) * (backLight * 0.62 + edgeRim * 0.26) * uLeafSssStrength;
        // Soft natural dark-emerald ambient bounce lift so shadowed interiors retain rich foliage texture
        vec3 bounceLift = diffuseColor.rgb * mix(vec3(0.09, 0.14, 0.08), vec3(0.14, 0.18, 0.10), crownWrap);
        outgoingLight += leafGlow + bounceLift;
        #include <opaque_fragment>
        `,
      );
  };
}

/**
 * Inject subtle waterline wet-stone darkening, mineral damp patina, and specular wet sheen
 * where the Charbagh reflecting pool water (y = 0.18) meets the inner Makrana marble curb and pedestals.
 */
function injectWaterlineWeathering(
  material: THREE.MeshStandardMaterial,
  cacheSuffix: string,
): void {
  material.customProgramCacheKey = () => `waterline-weathering-${cacheSuffix}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vWetWorldPos;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 wWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wWp = instanceMatrix * wWp;
        #endif
        wWp = modelMatrix * wWp;
        vWetWorldPos = wWp.xyz;
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vWetWorldPos;
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        float wickWave = sin(vWetWorldPos.z * 2.1 + vWetWorldPos.x * 3.4) * 0.015
                       + sin(vWetWorldPos.z * 6.7 - vWetWorldPos.x * 4.2) * 0.007;
        float wetBand = 1.0 - smoothstep(0.175 + wickWave, 0.292 + wickWave, vWetWorldPos.y);
        // Pool inner marble rim sits at |x| = 3.10..3.36m, fountain pedestals at |x| < 0.45m
        float innerRimMask = 1.0 - smoothstep(3.12, 3.42, abs(vWetWorldPos.x));
        // Subtle damp splash darkening along the inner top coping edge right beside the water
        float lipSplash = (1.0 - smoothstep(3.10, 3.24, abs(vWetWorldPos.x))) * smoothstep(0.26, 0.30, vWetWorldPos.y) * 0.34;
        float wetStrength = clamp(wetBand * mix(0.22, 1.0, innerRimMask) + lipSplash, 0.0, 1.0);
        vec3 wetTint = mix(vec3(1.0), vec3(0.45, 0.47, 0.42), wetStrength);
        diffuseColor.rgb *= wetTint;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        float rWick = sin(vWetWorldPos.z * 2.1 + vWetWorldPos.x * 3.4) * 0.015;
        float rWetBand = 1.0 - smoothstep(0.175 + rWick, 0.292 + rWick, vWetWorldPos.y);
        float rInnerMask = 1.0 - smoothstep(3.12, 3.42, abs(vWetWorldPos.x));
        roughnessFactor = mix(roughnessFactor, 0.14, clamp(rWetBand * rInnerMask * 0.90, 0.0, 0.90));
        `,
      );
  };
}

export function createTajMaterials(textures: ProceduralTextureSet): TajMaterialLibrary {
  const materials: THREE.Material[] = [];
  const track = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const sharedSun: SharedAtmosphereUniforms = {
    uSunDir: { value: new THREE.Vector3(86, 22, 46).normalize() },
    uSunColor: { value: new THREE.Color('#ffc884') },
    uCloudTime: { value: 0 },
    uBreezeTime: { value: 0 },
    uBreezeAmp: { value: 1.0 },
  };

  // Authentic Makrana white marble with translucent veining, micro-roughness, AO, clearcoat & calcite SSS
  const marbleMain = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.marbleMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.56, 0.56),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.64,
      aoMap: textures.marbleAo,
      aoMapIntensity: 0.58,
      metalness: 0.02,
      clearcoat: 0.24,
      clearcoatRoughness: 0.28,
      sheen: 0.14,
      sheenRoughness: 0.52,
      sheenColor: new THREE.Color('#ffe2be'),
      envMapIntensity: 0.72,
    }),
  );
  injectMarbleSubsurface(marbleMain, sharedSun, 0.72, 'main');

  // Grand bulbous onion dome marble with spherical AO, translucent calcite glow & curved HDRI reflections
  const marbleDome = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.marbleDomeMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.52,
      aoMap: textures.marbleAo,
      aoMapIntensity: 0.48,
      metalness: 0.02,
      clearcoat: 0.34,
      clearcoatRoughness: 0.22,
      sheen: 0.18,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color('#ffe0b8'),
      envMapIntensity: 0.88,
      vertexColors: true,
    }),
  );
  injectMarbleSubsurface(marbleDome, sharedSun, 0.92, 'dome');

  // Polished Makrana marble courtyard deck paving (checkered/ashlar slab joints with real AO & roughness)
  const marbleDeck = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.marbleDeckMap,
      normalMap: textures.marbleDeckNormal,
      normalScale: new THREE.Vector2(0.68, 0.68),
      roughnessMap: textures.marbleDeckRoughness,
      roughness: 0.52,
      aoMap: textures.marbleDeckAo,
      aoMapIntensity: 0.62,
      metalness: 0.02,
      clearcoat: 0.30,
      clearcoatRoughness: 0.24,
      envMapIntensity: 0.78,
    }),
  );
  injectMarbleSubsurface(marbleDeck, sharedSun, 0.42, 'deck');

  // Crisp architectural moldings, cornices, plinth caps, and balusters
  const marbleTrim = track(
    new THREE.MeshStandardMaterial({
      color: 0xf8f3e9,
      map: textures.marbleMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.58,
      aoMap: textures.marbleAo,
      aoMapIntensity: 0.45,
      metalness: 0.02,
      envMapIntensity: 0.65,
    }),
  );

  // Poolside Makrana marble curbs & fountain pedestals with subtle waterline wet-stone darkening & sheen
  const poolCurbMarble = track(
    new THREE.MeshStandardMaterial({
      color: 0xf8f3e9,
      map: textures.marbleMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.46, 0.46),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.58,
      aoMap: textures.marbleAo,
      aoMapIntensity: 0.48,
      metalness: 0.02,
      envMapIntensity: 0.72,
    }),
  );
  injectWaterlineWeathering(poolCurbMarble, 'curb');

  // Recessed pointed-arch alcove interiors & muqarnas vaults (cool slate-blue architectural shadow contrast + vertex AO)
  const marbleShadowRecess = track(
    new THREE.MeshStandardMaterial({
      color: 0x768296,
      map: textures.marbleMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.46, 0.46),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.88,
      aoMap: textures.marbleAo,
      aoMapIntensity: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.18,
    }),
  );

  // Deepest shadowed interior vault inside the Great Pishtaq, arch soffits & sanctuary doorways (cool slate-blue depth)
  const marbleDeepVault = track(
    new THREE.MeshStandardMaterial({
      color: 0x3a465a,
      map: textures.marbleMap,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.10,
    }),
  );

  // Seamless warm shaded Makrana stone for the deeply carved recessed Muqarnas honeycomb vaulting inside the main iwan
  const marbleMuqarnasVault = track(
    new THREE.MeshStandardMaterial({
      color: 0x8d8277,
      map: textures.marbleMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.52, 0.52),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.89,
      aoMap: textures.marbleAo,
      aoMapIntensity: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.16,
    }),
  );

  // Softly blended warm-ivory shaded Makrana marble for carved muqarnas pendentives & delicate corbelled facets
  const marbleMuqarnasRib = track(
    new THREE.MeshStandardMaterial({
      color: 0xb2a596,
      map: textures.marbleMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.46, 0.46),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.82,
      aoMap: textures.marbleAo,
      aoMapIntensity: 0.74,
      metalness: 0.0,
      envMapIntensity: 0.22,
    }),
  );

  // Carved marble panel with Mughal Pietra Dura lotus/carnation inlay & deep PBR normal/AO/roughness relief
  const marbleInlayPanel = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.inlayPanelMap,
      normalMap: textures.inlayPanelNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: textures.inlayPanelRoughness,
      roughness: 0.62,
      aoMap: textures.inlayPanelAo,
      aoMapIntensity: 0.72,
      metalness: 0.02,
      clearcoat: 0.20,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.68,
    }),
  );
  injectMarbleSubsurface(marbleInlayPanel, sharedSun, 0.56, 'inlay');

  // Great Pishtaq calligraphic border & carved floral arabesque spandrels with deep PBR relief
  const pishtaqFrame = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.pishtaqFrameMap,
      normalMap: textures.pishtaqFrameNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.56,
      aoMap: textures.pishtaqFrameAo,
      aoMapIntensity: 0.78,
      metalness: 0.02,
      clearcoat: 0.22,
      clearcoatRoughness: 0.26,
      envMapIntensity: 0.72,
    }),
  );
  injectMarbleSubsurface(pishtaqFrame, sharedSun, 0.60, 'pishtaq');

  // Tapering minaret masonry shaft with signature dark inlaid horizontal mortar rings & calcite SSS
  const minaretMarble = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.minaretBandMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.56, 0.56),
      roughnessMap: textures.marbleRoughness,
      roughness: 0.58,
      aoMap: textures.marbleAo,
      aoMapIntensity: 0.54,
      metalness: 0.02,
      clearcoat: 0.22,
      clearcoatRoughness: 0.30,
      envMapIntensity: 0.72,
    }),
  );
  injectMarbleSubsurface(minaretMarble, sharedSun, 0.76, 'minaret');

  // Black/slate marble inlaid framing strips, shadow undercut grooves, & drum chevrons
  const darkInlayStone = track(
    new THREE.MeshStandardMaterial({
      color: 0x383431,
      roughness: 0.54,
      metalness: 0.06,
      envMapIntensity: 0.45,
    }),
  );

  // Perforated geometric marble Jali lattice backing screen (kept deep shaded so doorway never blows out)
  const jaliScreen = track(
    new THREE.MeshStandardMaterial({
      color: 0x7a746c,
      map: textures.jaliScreenMap,
      roughness: 0.92,
      metalness: 0.02,
      envMapIntensity: 0.12,
    }),
  );

  // Crisp rim-lit carved 3D pierced Makrana marble Jali filigree screens in side bays & central sanctuary
  const carvedJaliMarble = track(
    new THREE.MeshStandardMaterial({
      color: 0xf4ede0,
      map: textures.marbleMap,
      normalMap: textures.marbleNormal,
      normalScale: new THREE.Vector2(0.48, 0.48),
      roughness: 0.46,
      metalness: 0.04,
      envMapIntensity: 0.82,
    }),
  );

  // Authentic gilded Mughal antique brass/gold Kalasha finial & ornate sprinkler heads with crisp sun glint
  const bronzeFinial = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xc89a4a,
      roughness: 0.17,
      metalness: 0.94,
      clearcoat: 0.65,
      clearcoatRoughness: 0.12,
      envMapIntensity: 2.05,
    }),
  );
  injectGoldFinialGlint(bronzeFinial, sharedSun);

  // Agra red sandstone terrace & masonry with chiseled normal relief, crevice moss & slow-moving cloud shadows
  const sandstone = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.sandstoneMap,
      normalMap: textures.sandstoneNormal,
      normalScale: new THREE.Vector2(0.86, 0.86),
      roughnessMap: textures.sandstoneRoughness,
      roughness: 0.94,
      aoMap: textures.sandstoneAo,
      aoMapIntensity: 0.54,
      metalness: 0.0,
      envMapIntensity: 0.18,
    }),
  );
  injectGroundCloudAndMoss(sandstone, sharedSun, 0.14, 'sandstone');

  // World-proportioned Agra red sandstone flagstone paving with soft matte mortar seams (zero specular grout glare!)
  const walkwaySandstone = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.walkwayPavingMap,
      normalMap: textures.walkwayPavingNormal,
      normalScale: new THREE.Vector2(0.68, 0.68),
      roughnessMap: textures.walkwayPavingRoughness,
      roughness: 0.96,
      aoMap: textures.walkwayPavingAo,
      aoMapIntensity: 0.44,
      metalness: 0.0,
      envMapIntensity: 0.11,
    }),
  );
  injectGroundCloudAndMoss(walkwaySandstone, sharedSun, 0.18, 'walkway');

  // Seamless un-gridded matte sandstone grain for individual micro-tilted 3D foreground flagstones
  const walkwayFlagstone = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.sandstoneGrainMap,
      normalMap: textures.sandstoneGrainNormal,
      normalScale: new THREE.Vector2(0.56, 0.56),
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.12,
    }),
  );
  injectGroundCloudAndMoss(walkwayFlagstone, sharedSun, 0.12, 'flagstone');

  const sandstoneDark = track(
    new THREE.MeshStandardMaterial({
      color: 0xc28d7a,
      map: textures.sandstoneMap,
      normalMap: textures.sandstoneNormal,
      normalScale: new THREE.Vector2(0.78, 0.78),
      roughnessMap: textures.sandstoneRoughness,
      roughness: 0.96,
      aoMap: textures.sandstoneAo,
      aoMapIntensity: 0.52,
      metalness: 0.0,
      envMapIntensity: 0.15,
    }),
  );
  injectGroundCloudAndMoss(sandstoneDark, sharedSun, 0.18, 'sandstone-dark');

  // Manicured Mughal garden lawn turf base beneath thousands of 3D grass blades (soft organic mottling)
  const grass = track(
    new THREE.MeshStandardMaterial({
      color: 0xe6f0dc,
      map: textures.grassMap,
      normalMap: textures.grassNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: textures.grassRoughness,
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.24,
    }),
  );
  injectGroundCloudAndMoss(grass, sharedSun, 0.0, 'grass');

  // GPU-instanced 3D wind-swaying Charbagh grass blades with distance LOD fade & subtle backlit tips
  const grassBlade = track(
    new THREE.MeshStandardMaterial({
      color: 0x4d772e,
      roughness: 0.84,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.30,
    }),
  );
  injectSwayingGrassShader(grassBlade, sharedSun);

  // Softly rounded, thick unstriped boxwood hedge foliage with fine small-leaf normal relief & vertical AO
  const boxwoodHedge = track(
    new THREE.MeshStandardMaterial({
      color: 0x9cbb7e,
      map: textures.boxwoodMap,
      normalMap: textures.boxwoodNormal,
      normalScale: new THREE.Vector2(1.55, 1.55),
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.32,
      vertexColors: true,
    }),
  );
  injectFoliageSubsurface(boxwoodHedge, sharedSun, 0x6f9642, 0.42, 'boxwood');

  // Natural ground clutter: fallen dry autumn/olive leaves & rose/marigold petals (walkways, curbs & floating on pool)
  const groundClutter = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.74,
      metalness: 0.02,
      side: THREE.DoubleSide,
      envMapIntensity: 0.32,
    }),
  );

  // Lush 3D Mughal garden blossoms (hibiscus, bougainvillea, rose, marigold & jasmine clusters via instanceColor)
  const blossomCluster = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.36,
    }),
  );

  // Deep natural Mediterranean cypress green needle tufts with crisp feathery edges & controlled olive tips
  const cypressSprig = track(
    new THREE.MeshStandardMaterial({
      color: 0xeef4e4,
      map: textures.cypressSprigMap,
      alphaTest: 0.28,
      side: THREE.DoubleSide,
      roughness: 0.90,
      metalness: 0.0,
      envMapIntensity: 0.16,
      vertexColors: true,
    }),
  );
  injectFoliageSubsurface(cypressSprig, sharedSun, 0x6e923c, 0.42, 'cypress');

  // Alpha-tested leafy branch clusters for deciduous shade trees with backlit SSS & crown AO
  const shadeLeafCluster = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.leafClusterMap,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
      roughness: 0.76,
      metalness: 0.0,
      envMapIntensity: 0.46,
      vertexColors: true,
    }),
  );
  injectFoliageSubsurface(shadeLeafCluster, sharedSun, 0xbcd962, 1.02, 'shade');

  // Clipped garden shrub foliage with backlit SSS
  const shrubLeafCluster = track(
    new THREE.MeshStandardMaterial({
      color: 0xecf4de,
      map: textures.leafClusterMap,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0.0,
      envMapIntensity: 0.42,
      vertexColors: true,
    }),
  );
  injectFoliageSubsurface(shrubLeafCluster, sharedSun, 0xb0d058, 0.88, 'shrub');

  // Delicate Mughal rose, marigold & jasmine flowering garden border tufts
  const flowerBorder = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.flowerTuftMap,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0.0,
      envMapIntensity: 0.36,
    }),
  );
  injectFoliageSubsurface(flowerBorder, sharedSun, 0xffd288, 0.72, 'flower');

  // Furrowed natural tree bark with Sobel normal map relief & warm bounce readability
  const bark = track(
    new THREE.MeshStandardMaterial({
      color: 0xe4d8ca,
      map: textures.barkMap,
      normalMap: textures.barkNormal,
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughnessMap: textures.barkRoughness,
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.38,
    }),
  );

  // Warm alluvial Yamuna riverbank sand & silt
  const riverSand = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.riverSandMap,
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.22,
    }),
  );

  const poolBed = track(
    new THREE.MeshStandardMaterial({
      color: 0x2e3a32,
      roughness: 0.92,
      metalness: 0.0,
    }),
  );

  // =========================================================================
  // AAA REAL-TIME PLANAR REFLECTION WATER SHADER (Charbagh Reflecting Pool)
  // - True mirrored-camera planar reflections (Taj Mahal, golden sky, clouds, birds, cypresses)
  // - Multi-octave wind capillary normal ripples + physical concentric sprinkler rings
  // - Schlick Fresnel reflectivity + Beer-Lambert optical water depth absorption & caustics
  // - Linear HDR output matching ACES Filmic EffectComposer + exponential golden-hour haze
  // =========================================================================
  const water = track(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBreeze: { value: 1.0 },
        uBuildProgress: { value: 1.0 },
        uSprinklerIntensity: { value: 1.0 },
        uSkyColor: { value: new THREE.Color('#6879a4') },
        uHorizonColor: { value: new THREE.Color('#f2b982') },
        uWaterDeep: { value: new THREE.Color('#1a2824') },
        uSunDir: { value: new THREE.Vector3(86, 22, 46).normalize() },
        uSunColor: { value: new THREE.Color('#ffc884') },
        uFogColor: { value: new THREE.Color('#dfb48c') },
        uFogDensity: { value: 0.00175 },
        tReflection: { value: null as THREE.Texture | null },
        uTextureMatrix: { value: new THREE.Matrix4() },
        uHasReflection: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        uniform mat4 uTextureMatrix;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec4 vReflCoord;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          vReflCoord = uTextureMatrix * vec4(position, 1.0);
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
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform sampler2D tReflection;
        uniform float uHasReflection;

        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec4 vReflCoord;

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
          // 1. Multi-layered outdoor wind capillary normal ripples (4 octaves for organic outdoor water shimmer)
          float t = uTime * (0.46 + 0.58 * uBreeze);
          vec2 pA = vec2(vWorldPos.x * 1.85 + t * 0.34, vWorldPos.z * 2.65 - t * 0.58);
          vec2 pB = vec2(vWorldPos.x * 4.4 - t * 0.52, vWorldPos.z * 5.8 + t * 0.42);
          vec2 pC = vec2(vWorldPos.x * 9.8 + t * 0.78, vWorldPos.z * 12.2 - t * 0.86);
          vec2 pD = vec2(vWorldPos.x * 19.5 - t * 1.15, vWorldPos.z * 22.0 + t * 1.05);
          float nA = noise2(pA);
          float nB = noise2(pB);
          float nC = noise2(pC);
          float nD = noise2(pD);
          float dNx =
            (noise2(pA + vec2(0.07, 0.0)) - nA) * 0.46 +
            (noise2(pB + vec2(0.05, 0.0)) - nB) * 0.30 +
            (noise2(pC + vec2(0.04, 0.0)) - nC) * 0.16 +
            (noise2(pD + vec2(0.03, 0.0)) - nD) * 0.08;
          float dNz =
            (noise2(pA + vec2(0.0, 0.07)) - nA) * 0.46 +
            (noise2(pB + vec2(0.0, 0.05)) - nB) * 0.30 +
            (noise2(pC + vec2(0.0, 0.04)) - nC) * 0.16 +
            (noise2(pD + vec2(0.0, 0.03)) - nD) * 0.08;

          // 2. Physical concentric ripples + subtle meniscus ring right where each marble lotus pedestal meets the water
          float spacing = 5.347;
          float fzLocal = mod(vWorldPos.z - 35.7 + spacing * 0.5, spacing) - spacing * 0.5;
          float fDist = length(vec2(vWorldPos.x, fzLocal));
          float baseRippleAmt = 0.28 + 0.72 * uSprinklerIntensity;
          float ringWave = sin(fDist * 19.5 - uTime * 4.4) * exp(-max(0.0, fDist - 0.26) * 1.45);
          float ringMask = smoothstep(2.55, 0.26, fDist) * smoothstep(0.18, 0.28, fDist) * baseRippleAmt;
          vec2 ringGrad = normalize(vec2(vWorldPos.x, fzLocal) + vec2(0.0001)) * ringWave * ringMask * 0.15;

          float breezeAmp = 0.054 + 0.105 * uBreeze;
          vec3 N = normalize(vec3(
            -dNx * breezeAmp * 1.85 - ringGrad.x,
            1.0,
            -dNz * breezeAmp * 2.35 - ringGrad.y
          ));

          vec3 camVec = cameraPosition - vWorldPos;
          float camDist = length(camVec);
          vec3 V = camVec / max(camDist, 0.0001);
          float ndotv = clamp(dot(N, V), 0.02, 1.0);

          // 3. Physical Schlick Fresnel (F0 = 0.02 water IOR=1.333)
          float schlick = 0.02 + 0.98 * pow(1.0 - ndotv, 4.2);
          float fresnel = clamp(mix(0.18, 0.96, schlick), 0.0, 0.97);

          // 4. Real-time planar mirrored camera reflection gently distorted by outdoor wind & fountain ripples
          vec3 R = reflect(-V, N);
          vec3 fallbackSky = mix(uHorizonColor, uSkyColor, pow(smoothstep(0.0, 0.55, clamp(R.y, 0.0, 1.0)), 0.75));
          vec3 planarRefl = fallbackSky;

          if (uHasReflection > 0.5) {
            float invW = 1.0 / max(vReflCoord.w, 0.0001);
            vec2 baseUv = vReflCoord.xy * invW;
            // Balanced outdoor ripple distortion so trees, sky, and fountains shimmer organically instead of flat glass
            float distScale = clamp(22.0 / (camDist + 10.0), 0.32, 1.38);
            vec2 rippleOffset = vec2(N.x * 0.088, N.z * 0.064) * distScale;
            vec2 reflUv = clamp(baseUv + rippleOffset, vec2(0.002), vec2(0.998));
            vec3 c0 = texture2D(tReflection, reflUv).rgb;
            vec3 c1 = texture2D(tReflection, clamp(reflUv + vec2(0.0014, 0.0008), vec2(0.002), vec2(0.998))).rgb;
            vec3 c2 = texture2D(tReflection, clamp(reflUv - vec2(0.0014, 0.0008), vec2(0.002), vec2(0.998))).rgb;
            planarRefl = c0 * 0.60 + (c1 + c2) * 0.20;
          }

          // 5. Deeper Beer-Lambert water absorption + weathered Mughal stone basin floor + soft dancing golden caustics
          float curbEdge = min(vUv.x, 1.0 - vUv.x);
          float waterDepth = mix(0.38, 1.02, smoothstep(0.0, 0.24, curbEdge));
          float opticalPath = waterDepth / max(ndotv, 0.20);
          // Natural emerald-slate historic pool absorption (avoids artificial bright swimming-pool blue)
          vec3 transmittance = exp(-opticalPath * vec3(1.38, 0.88, 0.82));

          vec2 refractPos = vWorldPos.xz + N.xz * waterDepth * 0.48;
          // Softly weathered natural stone slabs (NO harsh sharp swimming-pool tile grid!)
          float slabSeamX = smoothstep(0.015, 0.075, abs(fract(refractPos.x * 0.72) - 0.5));
          float slabSeamZ = smoothstep(0.015, 0.075, abs(fract(refractPos.y * 0.72) - 0.5));
          float stoneMottle = noise2(refractPos * 0.95) * 0.65 + noise2(refractPos * 2.6) * 0.35;
          vec3 baseStone = mix(vec3(0.18, 0.20, 0.17), vec3(0.29, 0.28, 0.23), stoneMottle);
          baseStone *= mix(0.88, 1.03, slabSeamX * slabSeamZ);

          // Soft shimmering golden-hour underwater caustics web dancing gently across the stone basin
          float cw1 = noise2(vec2(refractPos.x * 2.6 + t * 0.72, refractPos.y * 2.6 - t * 0.58));
          float cw2 = noise2(vec2(refractPos.x * 3.9 - t * 0.54, refractPos.y * 3.9 + t * 0.68));
          float ridge1 = 1.0 - abs(cw1 * 2.0 - 1.0);
          float ridge2 = 1.0 - abs(cw2 * 2.0 - 1.0);
          float caustics = pow(clamp(ridge1 * ridge2, 0.0, 1.0), 2.8) * 0.88;

          vec3 stoneFloor = baseStone + uSunColor * vec3(1.0, 0.88, 0.64) * caustics * 0.52;
          vec3 refractedCol = mix(uWaterDeep, stoneFloor, transmittance);

          // Wet-stone ambient darkening along inner pool curbs & right around marble fountain pedestal bases
          float curbAO = smoothstep(0.0, 0.11, curbEdge);
          float pedestalBaseAO = smoothstep(0.24, 0.54, fDist);
          refractedCol *= mix(0.46, 1.0, curbAO) * mix(0.56, 1.0, pedestalBaseAO);
          planarRefl *= mix(0.68, 1.0, curbAO) * mix(0.76, 1.0, pedestalBaseAO);

          // Subtle luminous water meniscus rim where water tension hugs each marble lotus pedestal
          float meniscusRim = exp(-pow((fDist - 0.30) / 0.036, 2.0)) * (0.09 + 0.07 * uSprinklerIntensity);

          // 6. Sunlit GGX-style golden specular sparkle, pinpoint capillary micro-glints, concentric ripples & meniscus
          vec3 L = normalize(uSunDir);
          vec3 H = normalize(L + V);
          float ndoth = max(dot(N, H), 0.0);
          float specBroad = pow(ndoth, 52.0) * 0.12;
          float specCrisp = pow(ndoth, 320.0) * 1.35;

          vec2 pGlintA = vec2(vWorldPos.x * 34.0 + t * 1.55, vWorldPos.z * 42.0 - t * 1.35);
          vec2 pGlintB = vec2(vWorldPos.x * 58.0 - t * 1.25, vWorldPos.z * 66.0 + t * 1.65);
          float gA = noise2(pGlintA);
          float gB = noise2(pGlintB);
          float gC = noise2(vec2(vWorldPos.x * 88.0 + t * 2.2, vWorldPos.z * 96.0 - t * 1.9));
          vec3 glintN = normalize(vec3(
            N.x + (gA - 0.5) * 0.58 + (gB - 0.5) * 0.38,
            1.0,
            N.z + (gB - 0.5) * 0.54 - (gA - 0.5) * 0.36
          ));
          float glintSpec = pow(max(dot(glintN, H), 0.0), 190.0);
          float rawPin = smoothstep(0.76, 0.95, gA * gB * 1.48) * smoothstep(0.68, 0.94, gC);
          float pinpoint = rawPin * rawPin;
          float glintDistFade = smoothstep(68.0, 5.0, camDist);
          float sunGlint = (glintSpec * 1.10 + pinpoint * 2.55 * (0.35 + 0.65 * fresnel)) * glintDistFade * (0.45 + 0.55 * uBreeze);

          float ringGlint = max(0.0, ringWave) * ringMask * 0.075;
          float splashFoam = smoothstep(0.38, 0.24, fDist) * uSprinklerIntensity * 0.07;

          vec3 col = mix(refractedCol, planarRefl, fresnel);
          col += uSunColor * (specBroad + specCrisp + sunGlint + ringGlint);
          col += mix(vec3(0.92, 0.95, 0.98), uSunColor, 0.42) * meniscusRim;
          col = mix(col, mix(vec3(0.95, 0.97, 1.0), uSunColor, 0.28), splashFoam);

          // 7. Exponential distance haze matching scene.fog (FogExp2)
          float fogFactor = 1.0 - exp(-pow(camDist * uFogDensity, 2.0));
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 0.92));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: false,
      depthWrite: true,
    }),
  );

  // Broad, serene flowing Yamuna River shader behind the Taj Mahal (North bank)
  const yamunaRiver = track(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBreeze: { value: 1.0 },
        uSkyTop: { value: new THREE.Color('#1d3c72') },
        uSkyHorizon: { value: new THREE.Color('#f2b982') },
        uRiverDeep: { value: new THREE.Color('#2d3e4c') },
        uRiverShallow: { value: new THREE.Color('#7a6c5a') },
        uSunDir: { value: new THREE.Vector3(86, 22, 46).normalize() },
        uSunColor: { value: new THREE.Color('#ffc884') },
        uFogColor: { value: new THREE.Color('#dfb48c') },
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
          float fresnel = mix(0.18, 0.90, pow(1.0 - ndotv, 2.7));

          vec3 R = reflect(-V, N);
          float skyElev = clamp(R.y, 0.0, 1.0);
          vec3 reflCol = mix(uSkyHorizon, uSkyTop, pow(smoothstep(0.0, 0.72, skyElev), 0.75));
          float cloudRefl = smoothstep(0.45, 0.78, noise2(vec2(vWorldPos.x * 0.015 - flow * 0.05, vWorldPos.z * 0.025)));
          reflCol = mix(reflCol, mix(uSkyHorizon, uSunColor, 0.45), cloudRefl * 0.32);

          float tajAlign = exp(-pow((vWorldPos.x + dx * 12.0) / 36.0, 2.0));
          float nearSouthBank = smoothstep(0.55, 0.02, vUv.y);
          vec3 tajRefl = mix(vec3(0.86, 0.80, 0.70), uSunColor, 0.35);
          reflCol = mix(reflCol, tajRefl, tajAlign * nearSouthBank * 0.38);

          float bankDist = min(vUv.y, 1.0 - vUv.y);
          float shallowMask = smoothstep(0.18, 0.015, bankDist);
          vec3 riverBase = mix(uRiverDeep, uRiverShallow, shallowMask * 0.82 + wave * 0.12);

          float foamBand = smoothstep(0.045, 0.005, bankDist) * smoothstep(0.42, 0.72, wave);
          vec3 col = mix(riverBase, reflCol, fresnel);
          col = mix(col, mix(uSkyHorizon, vec3(0.92, 0.88, 0.82), 0.5), foamBand * 0.42);

          vec3 H = normalize(normalize(uSunDir) + V);
          float specBroad = pow(max(dot(N, H), 0.0), 42.0) * 0.22;
          float specSharp = pow(max(dot(N, H), 0.0), 220.0) * 1.15;
          col += uSunColor * (specBroad + specSharp);

          float camDist = length(cameraPosition - vWorldPos);
          float fogFactor = 1.0 - exp(-pow(camDist * 0.0020, 1.55));
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
      color: 0xfff6eb,
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
      opacity: 0.54,
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
    poolCurbMarble,
    marbleShadowRecess,
    marbleDeepVault,
    marbleMuqarnasVault,
    marbleMuqarnasRib,
    marbleInlayPanel,
    pishtaqFrame,
    minaretMarble,
    darkInlayStone,
    jaliScreen,
    carvedJaliMarble,
    bronzeFinial,
    sandstone,
    walkwaySandstone,
    walkwayFlagstone,
    sandstoneDark,
    grass,
    grassBlade,
    boxwoodHedge,
    groundClutter,
    blossomCluster,
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
    updateSunUniforms: (sunDir: THREE.Vector3, sunColor: THREE.Color) => {
      sharedSun.uSunDir.value.copy(sunDir).normalize();
      sharedSun.uSunColor.value.copy(sunColor);
    },
    updateEnvironmentTime: (elapsedSec: number, breezeStrength: number) => {
      sharedSun.uCloudTime.value = elapsedSec;
      sharedSun.uBreezeTime.value = elapsedSec;
      sharedSun.uBreezeAmp.value = 0.25 + 0.75 * breezeStrength;
    },
    dispose: () => {
      for (const mat of materials) {
        mat.dispose();
      }
    },
  };
}
