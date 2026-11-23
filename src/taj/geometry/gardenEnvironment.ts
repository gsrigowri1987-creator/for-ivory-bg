import * as THREE from 'three';
import { TAJ_DIMS } from '../config';
import type { TajMaterialLibrary } from '../materials';
import type { PerformanceTier } from '../postprocessing';

export interface SwayingTreeHandle {
  group: THREE.Group;
  worldX: number;
  worldZ: number;
  baseScale: number;
  heightFactor: number;
  baseLeanX: number;
  baseLeanZ: number;
}

export interface GardenEnvironmentHandles {
  root: THREE.Group;
  terraceAndPoolGroup: THREE.Group;
  treesGroup: THREE.Group;
  waterSurface: THREE.Mesh;
  swayingTrees: SwayingTreeHandle[];
  nonReflectedObjects: THREE.Object3D[];
  updateFloatingClutter: (elapsedSec: number, breezeStrength: number) => void;
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

interface CardPlacement {
  pos: THREE.Vector3;
  rot: THREE.Euler;
  width: number;
  height: number;
  ao: number;
}

/**
 * Build a merged volumetric foliage BufferGeometry from organically arranged cards,
 * assigning smooth outward spherical crown normals and radial/vertical vertex-color AO.
 * This eliminates flat paper-card shading so sunlight wraps naturally across the whole tree crown.
 */
function buildVolumetricFoliageGeometry(
  cards: CardPlacement[],
  centerY: number,
  maxRadius: number,
  topTint: THREE.Color,
  bottomTint: THREE.Color,
): THREE.BufferGeometry {
  const quadCount = cards.length;
  const positions = new Float32Array(quadCount * 4 * 3);
  const normals = new Float32Array(quadCount * 4 * 3);
  const uvs = new Float32Array(quadCount * 4 * 2);
  const colors = new Float32Array(quadCount * 4 * 3);
  const indices: number[] = [];

  const localCorners = [
    new THREE.Vector3(-0.5, -0.5, 0),
    new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(-0.5, 0.5, 0),
  ];
  const cornerUvs: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  const mat = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (let i = 0; i < quadCount; i += 1) {
    const card = cards[i];
    quat.setFromEuler(card.rot);
    scale.set(card.width, card.height, 1);
    mat.compose(card.pos, quat, scale);

    const baseVert = i * 4;
    for (let k = 0; k < 4; k += 1) {
      v.copy(localCorners[k]).applyMatrix4(mat);
      const vi = (baseVert + k) * 3;
      positions[vi] = v.x;
      positions[vi + 1] = v.y;
      positions[vi + 2] = v.z;

      // Smooth outward spherical crown normal (slightly upward-biased for natural sky lighting)
      n.set(v.x, (v.y - centerY) * 0.92 + maxRadius * 0.28, v.z);
      if (n.lengthSq() < 0.0001) n.set(0, 1, 0);
      n.normalize();
      normals[vi] = n.x;
      normals[vi + 1] = n.y;
      normals[vi + 2] = n.z;

      const ui = (baseVert + k) * 2;
      uvs[ui] = cornerUvs[k][0];
      uvs[ui + 1] = cornerUvs[k][1];

      // Radial + vertical canopy ambient occlusion (dark shaded interior, warm sunlit exterior)
      const distRatio = Math.min(1, Math.hypot(v.x, (v.y - centerY) * 0.85, v.z) / Math.max(maxRadius, 0.01));
      const heightRatio = Math.max(0, Math.min(1, (v.y - (centerY - maxRadius)) / (maxRadius * 2.1)));
      const shade = (0.56 + 0.44 * distRatio) * card.ao;
      c.copy(bottomTint).lerp(topTint, heightRatio * 0.72 + distRatio * 0.28).multiplyScalar(shade);
      colors[vi] = c.r;
      colors[vi + 1] = c.g;
      colors[vi + 2] = c.b;
    }

    indices.push(baseVert, baseVert + 1, baseVert + 2, baseVert, baseVert + 2, baseVert + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Generate a 100% organic, dense Mediterranean cypress foliage crown built in canonical world units
 * (height = 6.0m, max radius = 0.78m) so EVERY bough tuft card keeps a natural ~1:1 rounded aspect ratio
 * with ZERO vertical stretching! Uses ~94 densely overlapping small rounded botanical bough tufts arranged
 * tightly around the trunk from y = 0.22m (hiding the lower trunk inside full foliage) up to a soft,
 * irregular, billowing multi-tuft apex (zero sharp cone silhouette).
 */
function createCypressCrownGeometry(seed: number): THREE.BufferGeometry {
  const rand = seededRand(seed);
  const cards: CardPlacement[] = [];

  const canonicalH = 6.0;
  const canonicalR = 0.78;

  // 1. 18 deep shaded inner core bough tufts tightly enveloping the trunk from near-ground to upper crown
  for (let i = 0; i < 18; i += 1) {
    const frac = (i + 0.25) / 18;
    const angle = i * 2.39996 + rand() * 0.45;
    // Full cylindrical-flame cypress envelope (thick lower skirt, gently tapering upper body, rounded tip)
    const env = Math.pow(Math.sin(Math.pow(frac, 0.56) * Math.PI * 0.94 + 0.14), 0.72);
    const r = canonicalR * (0.16 + env * 0.34);
    const tuftSize = (0.58 + env * 0.40) * (0.9 + rand() * 0.2);
    cards.push({
      pos: new THREE.Vector3(
        Math.cos(angle) * r,
        0.24 + frac * (canonicalH - 0.52),
        Math.sin(angle) * r,
      ),
      rot: new THREE.Euler(
        (rand() - 0.5) * 0.85,
        angle + (rand() - 0.5) * 0.7,
        (rand() - 0.5) * 0.72,
      ),
      width: tuftSize,
      height: tuftSize * (0.92 + rand() * 0.16), // ~1:1 rounded bough tuft
      ao: 0.68 + frac * 0.18,
    });
  }

  // 2. 68 dense overlapping outer botanical bough tufts arranged in 17 staggered organic whorls
  const tiers = 17;
  for (let t = 0; t < tiers; t += 1) {
    const frac = (t + 0.15) / tiers;
    // Natural full Mediterranean cypress silhouette: lush rounded lower skirt -> gently tapered billowing column -> soft dome tip
    const baseProfile =
      frac < 0.16
        ? 0.68 + (frac / 0.16) * 0.32
        : Math.pow(Math.cos(((frac - 0.16) / 0.84) * Math.PI * 0.47), 0.68);
    // Subtle organic multi-lobe bulge variation along the height so no tree reads like a geometric cone
    const organicWave = 1.0 + Math.sin(frac * 15.5 + seed) * 0.10 + (rand() - 0.5) * 0.14;
    const tierR = canonicalR * Math.max(0.18, baseProfile * organicWave);
    const count = t >= tiers - 2 ? 3 : 4;

    for (let k = 0; k < count; k += 1) {
      const a = (k / count) * Math.PI * 2 + t * 1.18 + (rand() - 0.5) * 0.42;
      const radialOff = tierR * (0.48 + rand() * 0.34);
      // Small rounded botanical bough tuft (~0.52..0.88m square, NEVER stretched vertically!)
      const tuftW = (0.46 + baseProfile * 0.38) * (0.88 + rand() * 0.26);
      const tuftH = tuftW * (0.90 + rand() * 0.20);

      cards.push({
        pos: new THREE.Vector3(
          Math.cos(a) * radialOff,
          0.22 + frac * (canonicalH - 0.46) + (rand() - 0.5) * 0.14,
          Math.sin(a) * radialOff,
        ),
        rot: new THREE.Euler(
          0.22 + (rand() - 0.5) * 0.78 - frac * 0.15,
          a + (rand() - 0.5) * 0.9,
          (rand() - 0.5) * 0.68,
        ),
        width: tuftW,
        height: tuftH,
        ao: 0.76 + frac * 0.22 + (rand() - 0.5) * 0.08,
      });
    }
  }

  // 3. 8 soft, irregular, overlapping rounded leader tufts crowning the apex (eliminates any sharp point)
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + rand() * 0.5;
    const r = i < 2 ? 0.05 : 0.12 + rand() * 0.11;
    const tuftSize = i < 2 ? 0.44 + rand() * 0.12 : 0.50 + rand() * 0.14;
    cards.push({
      pos: new THREE.Vector3(
        Math.cos(a) * r,
        canonicalH - 0.54 + (i < 2 ? 0.34 : 0.08) + rand() * 0.18,
        Math.sin(a) * r,
      ),
      rot: new THREE.Euler((rand() - 0.5) * 0.65, a + rand() * 0.8, (rand() - 0.5) * 0.55),
      width: tuftSize,
      height: tuftSize * (0.94 + rand() * 0.16),
      ao: 0.94 + rand() * 0.08,
    });
  }

  return buildVolumetricFoliageGeometry(
    cards,
    canonicalH * 0.5,
    canonicalH * 0.54,
    new THREE.Color('#c2da9c'), // subtle olive-green sunlit cypress tips (never yellow-beige!)
    new THREE.Color('#5a7a4c'), // rich deep Mediterranean cypress evergreen interior (never black!)
  );
}

/** Generate a rich 34-branchlet airy 3D deciduous shade tree crown with natural sky gaps for backlit SSS. */
function createDeciduousCrownGeometry(seed: number): THREE.BufferGeometry {
  const rand = seededRand(seed);
  const cards: CardPlacement[] = [];

  // 6 deeply shaded interior foliage clusters anchoring the inner boughs
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.45;
    cards.push({
      pos: new THREE.Vector3(Math.cos(a) * 0.28, (rand() - 0.35) * 0.26, Math.sin(a) * 0.28),
      rot: new THREE.Euler((rand() - 0.5) * 1.15, a + rand() * 1.5, (rand() - 0.5) * 0.85),
      width: 0.96 + rand() * 0.26,
      height: 0.86 + rand() * 0.24,
      ao: 0.64,
    });
  }

  // 28 outer billowing lacy botanical bough clusters arranged on an asymmetric natural canopy
  for (let i = 0; i < 28; i += 1) {
    const goldenAngle = i * 2.39996 + rand() * 0.28;
    const t = (i + 0.5) / 28;
    const elev = -0.36 + t * 1.16;
    const ringR = Math.sqrt(Math.max(0.08, 1 - Math.pow(elev * 0.84, 2))) * (0.62 + rand() * 0.38);
    const px = Math.cos(goldenAngle) * ringR;
    const py = elev * 0.74 + (rand() - 0.5) * 0.16;
    const pz = Math.sin(goldenAngle) * ringR;

    const cardW = 0.78 + rand() * 0.42;
    const cardH = cardW * (0.80 + rand() * 0.28);
    cards.push({
      pos: new THREE.Vector3(px, py, pz),
      rot: new THREE.Euler(
        (rand() - 0.5) * 1.0 + elev * 0.35,
        goldenAngle + (rand() - 0.5) * 1.4,
        (rand() - 0.5) * 0.78,
      ),
      width: cardW,
      height: cardH,
      ao: 0.86 + Math.max(0, elev) * 0.18,
    });
  }

  return buildVolumetricFoliageGeometry(
    cards,
    0.05,
    1.15,
    new THREE.Color('#f0f8de'),
    new THREE.Color('#809969'),
  );
}

/** Generate a dense volumetric manicured garden shrub foliage geometry (radius ~1.0). */
function createShrubCrownGeometry(seed: number): THREE.BufferGeometry {
  const rand = seededRand(seed);
  const cards: CardPlacement[] = [];
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2 + rand() * 0.3;
    const r = i < 3 ? 0.12 : 0.34 + rand() * 0.2;
    cards.push({
      pos: new THREE.Vector3(Math.cos(a) * r, 0.38 + (rand() - 0.3) * 0.24, Math.sin(a) * r),
      rot: new THREE.Euler((rand() - 0.5) * 0.7, a + rand() * 0.8, (rand() - 0.5) * 0.5),
      width: 1.35 + rand() * 0.3,
      height: 1.02 + rand() * 0.24,
      ao: 0.86 + (i >= 3 ? 0.12 : -0.1),
    });
  }
  return buildVolumetricFoliageGeometry(
    cards,
    0.36,
    0.95,
    new THREE.Color('#e5f1cf'),
    new THREE.Color('#7f9866'),
  );
}

/**
 * Build a merged 5-blade varied-height curved botanical grass tuft geometry (uv.y = 0 at root -> 1 at tip)
 * for dense, lush GPU-instanced wind-swaying 3D Charbagh lawn carpets.
 */
function createGrassBladeTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vOff = 0;

  // 5 crossing varied-height arched blades per tuft (46,000+ blades on desktop!)
  const bladeConfigs = [
    { angle: 0.0, ox: -0.045, oz: 0.025, h: 0.27, w: 0.052, bend: 0.105 },
    { angle: 1.26, ox: 0.048, oz: -0.028, h: 0.35, w: 0.056, bend: 0.135 },
    { angle: 2.51, ox: -0.022, oz: -0.046, h: 0.22, w: 0.048, bend: 0.085 },
    { angle: 3.77, ox: 0.036, oz: 0.044, h: 0.30, w: 0.050, bend: 0.118 },
    { angle: 5.03, ox: 0.0, oz: 0.0, h: 0.18, w: 0.046, bend: 0.068 },
  ];

  const segs = 3;
  for (const cfg of bladeConfigs) {
    const cosA = Math.cos(cfg.angle);
    const sinA = Math.sin(cfg.angle);
    const tx = -sinA;
    const tz = cosA;

    for (let s = 0; s <= segs; s += 1) {
      const t = s / segs;
      const halfW = cfg.w * 0.5 * (1.0 - Math.pow(t, 1.35) * 0.90);
      const y = cfg.h * t;
      const forward = cfg.bend * t * t;
      const cx = cfg.ox + cosA * forward;
      const cz = cfg.oz + sinA * forward;

      const nx = cosA * 0.34;
      const ny = 0.89;
      const nz = sinA * 0.34;
      const nLen = Math.hypot(nx, ny, nz);

      if (s === segs) {
        positions.push(cx, y, cz);
        normals.push(nx / nLen, ny / nLen, nz / nLen);
        uvs.push(0.5, 1.0);
      } else {
        positions.push(cx - tx * halfW, y, cz - tz * halfW);
        normals.push(nx / nLen, ny / nLen, nz / nLen);
        uvs.push(0.0, t);

        positions.push(cx + tx * halfW, y, cz + tz * halfW);
        normals.push(nx / nLen, ny / nLen, nz / nLen);
        uvs.push(1.0, t);
      }
    }

    for (let s = 0; s < segs - 1; s += 1) {
      const row0 = vOff + s * 2;
      const row1 = vOff + (s + 1) * 2;
      indices.push(row0, row0 + 1, row1 + 1, row0, row1 + 1, row1);
    }
    const lastRow = vOff + (segs - 1) * 2;
    const tipIdx = vOff + segs * 2;
    indices.push(lastRow, lastRow + 1, tipIdx);
    vOff += segs * 2 + 1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Create a softly rounded, pillowy, thick leafy Mughal boxwood hedge geometry with organic
 * uneven foliage shoulders and world-scaled UVs (zero sharp rectangular blocks or texture stretching!).
 */
function createSculptedHedgeGeometry(lengthX: number, height: number, lengthZ: number, seed: number): THREE.BufferGeometry {
  const segX = Math.max(4, Math.min(28, Math.round(lengthX * 1.4)));
  const segZ = Math.max(4, Math.min(28, Math.round(lengthZ * 1.4)));
  const geo = new THREE.BoxGeometry(lengthX, height, lengthZ, segX, 5, segZ);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const halfX = lengthX * 0.5;
  const halfZ = lengthZ * 0.5;
  const halfH = height * 0.5;

  for (let i = 0; i < pos.count; i += 1) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const yNorm = Math.max(0, Math.min(1, (y + halfH) / Math.max(height, 0.001)));
    const nx = halfX > 0.01 ? x / halfX : 0;
    const nz = halfZ > 0.01 ? z / halfZ : 0;

    // Softly rounded pillowy/mounded cross-section along width & ends so corners never read as crisp boxes
    const shoulderCurve = yNorm > 0.42 ? Math.pow((yNorm - 0.42) / 0.58, 1.55) : 0;
    const endDistX = Math.max(0, 1.0 - (halfX - Math.abs(x)) / Math.min(0.42, halfX));
    const endDistZ = Math.max(0, 1.0 - (halfZ - Math.abs(z)) / Math.min(0.42, halfZ));

    const crownShrink = 1.0 - shoulderCurve * 0.36;
    if (lengthX > lengthZ) {
      z *= crownShrink;
      x *= 1.0 - shoulderCurve * endDistX * 0.14;
    } else {
      x *= crownShrink;
      z *= 1.0 - shoulderCurve * endDistZ * 0.14;
    }

    // Gentle dome mounding on top face + organic uneven foliage bough lumps
    const crossAxis = lengthX > lengthZ ? nz : nx;
    const domeLift = yNorm > 0.5 ? (1.0 - crossAxis * crossAxis) * height * 0.18 * ((yNorm - 0.5) / 0.5) : 0;
    const lumpA = Math.sin(x * 3.7 + z * 3.5 + seed) * Math.cos(x * 1.9 - z * 2.3 + seed * 0.6);
    const lumpB = Math.sin(x * 7.1 - z * 6.4 + seed * 1.4);
    const foliageBump = (lumpA * 0.042 + lumpB * 0.018) * (0.35 + 0.65 * yNorm);

    x += foliageBump * (Math.abs(nx) > 0.6 ? Math.sign(nx) : 0.45);
    z += foliageBump * (Math.abs(nz) > 0.6 ? Math.sign(nz) : 0.45);
    y += domeLift + (yNorm > 0.25 ? foliageBump * 1.25 : 0);

    pos.setXYZ(i, x, y, z);

    // True world-meter UVs so boxwood leaf texture stays crisp and unstretched along 19m hedge runs
    const isTop = yNorm > 0.85;
    if (isTop) {
      uv.setXY(i, (x + halfX) * 0.85, (z + halfZ) * 0.85);
    } else if (lengthX > lengthZ) {
      uv.setXY(i, (x + halfX) * 0.85, yNorm * height * 1.35);
    } else {
      uv.setXY(i, (z + halfZ) * 0.85, yNorm * height * 1.35);
    }

    // Deep grounded base shadow + dappled sunlit olive-green foliage crown
    const dapple = 0.88 + (lumpA * 0.5 + 0.5) * 0.20;
    const ao = (0.46 + 0.54 * Math.pow(yNorm, 0.72)) * dapple;
    colors[i * 3] = ao * 0.88;
    colors[i * 3 + 1] = ao * 1.02;
    colors[i * 3 + 2] = ao * 0.82;
  }
  uv.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create an organic tapering bark trunk with 6 flared buttress roots gripping the ground,
 * gnarled fluted bark ribs, and subtle natural S-curve lean (replaces plain smooth cylinders).
 */
function createOrganicRootedTrunkGeometry(): THREE.BufferGeometry {
  const radialSegs = 20;
  const heightSegs = 10;
  const geo = new THREE.CylinderGeometry(0.68, 1.0, 1.0, radialSegs, heightSegs, false);
  geo.translate(0, 0.5, 0);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.001) {
      const ang = Math.atan2(z, x);
      // 6 flared buttress roots gripping the soil cleanly at y in [0..0.34]
      const rootZone = Math.pow(Math.max(0, 1.0 - y / 0.34), 2.0);
      const buttress = Math.pow(0.5 + 0.5 * Math.cos(ang * 6.0 + Math.sin(ang * 2.0) * 0.5), 1.65);
      const rootFlare = 1.0 + rootZone * (0.48 + 0.78 * buttress);
      // Subtle furrowed gnarled trunk fluting along entire shaft
      const flute = 1.0 + Math.sin(ang * 5.0 + y * 2.4) * 0.065 + Math.cos(ang * 9.0 - y * 3.1) * 0.03;
      // Gentle organic S-curve trunk bend
      const bendX = Math.sin(y * Math.PI * 1.15) * 0.14 * y;
      const bendZ = Math.cos(y * Math.PI * 0.95) * 0.09 * y;
      pos.setXYZ(i, x * rootFlare * flute + bendX, y, z * rootFlare * flute + bendZ);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build a lush 10-frond gracefully arching radial ornamental fern / low groundcover cluster
 * to tuck naturally around cypress tree bases, hedge corners, and shade tree roots.
 */
function createOrnamentalFernGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vOff = 0;

  const frondCount = 10;
  const segs = 4;
  for (let f = 0; f < frondCount; f += 1) {
    const angle = (f / frondCount) * Math.PI * 2 + (f % 2) * 0.18;
    const isOuter = f % 2 === 0;
    const len = isOuter ? 0.56 : 0.42;
    const maxW = isOuter ? 0.145 : 0.125;
    const riseH = isOuter ? 0.30 : 0.38;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const tx = -sinA;
    const tz = cosA;

    for (let s = 0; s <= segs; s += 1) {
      const t = s / segs;
      const reach = len * Math.pow(t, 0.92);
      // Arch gracefully upward then droop slightly toward pointed fern frond tip
      const y = riseH * Math.sin(t * Math.PI * 0.78) + 0.025;
      const halfW = maxW * 0.5 * Math.sin(Math.pow(t, 0.7) * Math.PI) * 1.15;
      const cx = cosA * reach;
      const cz = sinA * reach;

      const nx = cosA * 0.25;
      const ny = 0.94;
      const nz = sinA * 0.25;

      if (s === segs) {
        positions.push(cx, Math.max(0.03, y), cz);
        normals.push(nx, ny, nz);
        uvs.push(0.5, 1.0);
      } else {
        positions.push(cx - tx * halfW, y, cz - tz * halfW);
        normals.push(nx, ny, nz);
        uvs.push(0.0, t);

        positions.push(cx + tx * halfW, y, cz + tz * halfW);
        normals.push(nx, ny, nz);
        uvs.push(1.0, t);
      }
    }

    for (let s = 0; s < segs - 1; s += 1) {
      const row0 = vOff + s * 2;
      const row1 = vOff + (s + 1) * 2;
      indices.push(row0, row0 + 1, row1 + 1, row0, row1 + 1, row1);
    }
    const lastRow = vOff + (segs - 1) * 2;
    const tipIdx = vOff + segs * 2;
    indices.push(lastRow, lastRow + 1, tipIdx);
    vOff += segs * 2 + 1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Build a delicate 5-petal cupped 3D blossom rosette geometry for instanced hibiscus,
 * bougainvillea, Mughal rose, marigold & jasmine blooms.
 */
function createBlossomClusterGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vOff = 0;

  const petals = 5;
  for (let p = 0; p < petals; p += 1) {
    const a = (p / petals) * Math.PI * 2;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const tx = -sinA;
    const tz = cosA;

    const rMid = 0.046;
    const rTip = 0.088;
    const wMid = 0.044;
    const yMid = 0.022;
    const yTip = 0.036;

    // 4-vert cupped diamond petal
    positions.push(
      0, 0.004, 0,
      cosA * rMid - tx * wMid, yMid, sinA * rMid - tz * wMid,
      cosA * rTip, yTip, sinA * rTip,
      cosA * rMid + tx * wMid, yMid, sinA * rMid + tz * wMid,
    );
    for (let k = 0; k < 4; k += 1) {
      normals.push(cosA * 0.28, 0.92, sinA * 0.28);
    }
    uvs.push(0.5, 0, 0, 0.5, 0.5, 1, 1, 0.5);
    indices.push(vOff, vOff + 1, vOff + 2, vOff, vOff + 2, vOff + 3);
    vOff += 4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/** Create a gently beveled world-UV veined marble strip so walkway inlays catch crisp golden edge highlights. */
function createBeveledStripGeometry(width: number, height: number, length: number): THREE.BufferGeometry {
  const b = Math.min(0.016, width * 0.16, height * 0.35);
  const hw = width * 0.5 - b;
  const hl = length * 0.5 - b;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hl);
  shape.lineTo(hw, -hl);
  shape.lineTo(hw, hl);
  shape.lineTo(-hw, hl);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, height - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
  });
  geo.rotateX(-Math.PI * 0.5);
  geo.translate(0, -(height - b * 2) * 0.5, 0);

  // World-meter planar UVs so Makrana marble veining runs naturally along the border strips
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    uv.setXY(i, pos.getX(i) * 0.28 + 0.5, pos.getZ(i) * 0.28 + 0.5);
  }
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Create a delicate curled dry leaf / flower petal geometry for natural ground & water clutter. */
function createCurvedLeafPetalGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(0.11, 0.068, 2, 2);
  geo.rotateX(-Math.PI * 0.5);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const nx = x / 0.055;
    const nz = z / 0.034;
    // Taper ends to an organic almond leaf / oval petal silhouette and curl edges slightly upward
    const widthScale = Math.max(0.18, 1.0 - nx * nx * 0.72);
    const curlY = (nx * nx * 0.009) + (nz * nz * 0.006);
    pos.setXYZ(i, x, curlY, z * widthScale);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create a realistic full Mediterranean cypress tree with a partially hidden rooted trunk,
 * ascending inner conifer limbs, and dense ~94-tuft isotropic 1:1 rounded botanical crown.
 */
function createRealisticCypressTree(
  height: number,
  radiusX: number,
  radiusZ: number,
  rand: () => number,
  materials: TajMaterialLibrary,
  sharedGeos: {
    trunkFlared: THREE.BufferGeometry;
    branchCylinder: THREE.BufferGeometry;
    cypressCrowns: THREE.BufferGeometry[];
    shadowPad: THREE.BufferGeometry;
  },
): THREE.Group {
  const tree = new THREE.Group();
  const avgR = (radiusX + radiusZ) * 0.5;

  const shadow = new THREE.Mesh(sharedGeos.shadowPad, materials.contactShadow);
  shadow.rotation.x = -Math.PI * 0.5;
  shadow.position.y = 0.035;
  shadow.scale.set(radiusX * 3.2, radiusZ * 3.2, 1);
  tree.add(shadow);

  // Tapered dark bark trunk tucked naturally inside the lush lower cypress foliage (never a bare pole!)
  const trunk = new THREE.Mesh(sharedGeos.trunkFlared, materials.bark);
  trunk.scale.set(avgR * 0.17, height * 0.78, avgR * 0.17);
  trunk.rotation.y = rand() * Math.PI * 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);

  // Subtle ascending woody conifer limbs nestled inside the dense foliage core
  const foliageStart = height * 0.06;
  const foliageH = height * 0.88;
  for (let b = 0; b < 8; b += 1) {
    const frac = (b + 0.4) / 8;
    const a = b * 2.39996 + rand() * 0.5;
    const branchLen = avgR * (0.72 - frac * 0.36);
    const branchY = foliageStart + frac * foliageH * 0.78;
    const tilt = 0.38 + (1 - frac) * 0.18;

    const limb = new THREE.Mesh(sharedGeos.branchCylinder, materials.bark);
    limb.scale.set(avgR * 0.048 * (1.0 - frac * 0.45), branchLen, avgR * 0.048 * (1.0 - frac * 0.45));
    limb.position.set(
      Math.cos(a) * branchLen * 0.28,
      branchY + Math.cos(tilt) * branchLen * 0.22,
      Math.sin(a) * branchLen * 0.28,
    );
    limb.rotation.z = -Math.cos(a) * tilt;
    limb.rotation.x = Math.sin(a) * tilt;
    tree.add(limb);
  }

  // Dense overlapping isotropic 1:1 rounded botanical bough-tuft crown (canonical H=6.0, R=0.78)
  const crownGeo = sharedGeos.cypressCrowns[Math.floor(rand() * sharedGeos.cypressCrowns.length)];
  const crown = new THREE.Mesh(crownGeo, materials.cypressSprig);
  crown.scale.set(radiusX / 0.78, height / 6.0, radiusZ / 0.78);
  crown.position.y = 0.02;
  crown.rotation.y = rand() * Math.PI * 2;
  crown.castShadow = true;
  crown.receiveShadow = true;
  tree.add(crown);

  return tree;
}

/** Create a lifelike broad-canopy Mughal Neem/shade tree with flared trunk, 5 forked boughs, and volumetric lacy leafy crown. */
function createRealisticDeciduousTree(
  height: number,
  canopyRadius: number,
  rand: () => number,
  materials: TajMaterialLibrary,
  sharedGeos: {
    trunkFlared: THREE.BufferGeometry;
    branchCylinder: THREE.BufferGeometry;
    deciduousCrowns: THREE.BufferGeometry[];
    shadowPad: THREE.BufferGeometry;
  },
): THREE.Group {
  const tree = new THREE.Group();

  const shadow = new THREE.Mesh(sharedGeos.shadowPad, materials.contactShadow);
  shadow.rotation.x = -Math.PI * 0.5;
  shadow.position.y = 0.04;
  shadow.scale.setScalar(canopyRadius * 2.45);
  tree.add(shadow);

  // Root-flared gnarled trunk
  const trunkH = height * 0.46;
  const trunk = new THREE.Mesh(sharedGeos.trunkFlared, materials.bark);
  trunk.scale.set(canopyRadius * 0.155, trunkH, canopyRadius * 0.155);
  trunk.rotation.y = rand() * Math.PI * 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);

  // 5 organic spreading primary boughs + forked secondary limbs reaching into the crown
  const boughCount = 5;
  for (let b = 0; b < boughCount; b += 1) {
    const a = (b / boughCount) * Math.PI * 2 + (rand() - 0.5) * 0.42;
    const tilt = 0.44 + rand() * 0.24;
    const bLen = trunkH * (0.58 + rand() * 0.22);

    const bough = new THREE.Mesh(sharedGeos.branchCylinder, materials.bark);
    bough.scale.set(canopyRadius * 0.072, bLen, canopyRadius * 0.072);
    bough.position.set(
      Math.cos(a) * canopyRadius * 0.18,
      trunkH * 0.78 + Math.cos(tilt) * bLen * 0.35,
      Math.sin(a) * canopyRadius * 0.18,
    );
    bough.rotation.z = -Math.cos(a) * tilt;
    bough.rotation.x = Math.sin(a) * tilt;
    bough.castShadow = true;
    tree.add(bough);

    // Secondary twig limb higher up
    const subA = a + (b % 2 === 0 ? 0.55 : -0.55);
    const subLen = bLen * 0.62;
    const subBranch = new THREE.Mesh(sharedGeos.branchCylinder, materials.bark);
    subBranch.scale.set(canopyRadius * 0.042, subLen, canopyRadius * 0.042);
    subBranch.position.set(
      Math.cos(a) * canopyRadius * 0.42,
      trunkH * 1.08,
      Math.sin(a) * canopyRadius * 0.42,
    );
    subBranch.rotation.z = -Math.cos(subA) * (tilt + 0.24);
    subBranch.rotation.x = Math.sin(subA) * (tilt + 0.24);
    tree.add(subBranch);
  }

  // Primary volumetric leafy canopy crown + subtle secondary sub-crown for asymmetric real-tree silhouette
  const mainGeo = sharedGeos.deciduousCrowns[Math.floor(rand() * sharedGeos.deciduousCrowns.length)];
  const mainCrown = new THREE.Mesh(mainGeo, materials.shadeLeafCluster);
  mainCrown.scale.set(canopyRadius * 1.04, canopyRadius * 0.88, canopyRadius * 1.04);
  mainCrown.position.y = height * 0.66;
  mainCrown.rotation.y = rand() * Math.PI * 2;
  mainCrown.castShadow = true;
  mainCrown.receiveShadow = true;
  tree.add(mainCrown);

  const subGeo = sharedGeos.deciduousCrowns[Math.floor(rand() * sharedGeos.deciduousCrowns.length)];
  const sideA = rand() * Math.PI * 2;
  const sideCrown = new THREE.Mesh(subGeo, materials.shadeLeafCluster);
  sideCrown.scale.set(canopyRadius * 0.64, canopyRadius * 0.58, canopyRadius * 0.64);
  sideCrown.position.set(
    Math.cos(sideA) * canopyRadius * 0.44,
    height * 0.61,
    Math.sin(sideA) * canopyRadius * 0.44,
  );
  sideCrown.rotation.y = rand() * Math.PI * 2;
  sideCrown.castShadow = true;
  tree.add(sideCrown);

  return tree;
}

/** Build an octagonal Mughal red sandstone & white marble Riverfront Burj pavilion overlooking the Yamuna. */
function buildRiverfrontBurj(
  materials: TajMaterialLibrary,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
): THREE.Group {
  const burj = new THREE.Group();

  // Tall octagonal red sandstone bastion tower rising from the riverbank up to the terrace
  const bastion = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(4.4, 4.8, 5.4, 8)), materials.sandstone);
  bastion.position.y = -1.1;
  bastion.receiveShadow = true;
  bastion.castShadow = true;
  burj.add(bastion);

  // Sandstone cornice & parapet
  const cornice = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(4.75, 4.55, 0.52, 8)), materials.sandstoneDark);
  cornice.position.y = 1.65;
  burj.add(cornice);

  // Open 8-column octagonal white marble chhatri pavilion atop the riverfront bastion
  const colGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.22, 3.1, 8));
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const col = new THREE.Mesh(colGeo, materials.marbleTrim);
    col.position.set(Math.cos(a) * 3.15, 3.35, Math.sin(a) * 3.15);
    col.castShadow = true;
    burj.add(col);
  }

  // Deep overhanging red sandstone chhajja eave
  const chhajja = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(3.5, 4.2, 0.42, 8)), materials.sandstone);
  chhajja.position.y = 5.05;
  burj.add(chhajja);

  // White marble dome crown + bronze finial
  const dome = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(2.75, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56)),
    materials.marbleMain,
  );
  dome.position.y = 5.2;
  dome.scale.set(1, 1.05, 1);
  dome.castShadow = true;
  burj.add(dome);

  const spire = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.16, 1.45, 8)), materials.bronzeFinial);
  spire.position.y = 8.6;
  burj.add(spire);

  return burj;
}

/**
 * Build historic Agra red sandstone Charbagh Mughal perimeter enclosure walls with rhythmic blind-arch
 * pilasters, sandstone chhajja cornice, white marble coping, traditional Mughal merlons (crenellations),
 * flanking East/West garden pavilions (inspired by the historic Taj garden architecture), and South Great Gate.
 */
function buildCharbaghPerimeterWalls(
  materials: TajMaterialLibrary,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
): THREE.Group {
  const perimeter = new THREE.Group();
  perimeter.name = 'MughalCharbaghPerimeterWalls';

  const wallH = 4.4;
  const eastWestX = 66.0;
  const southZ = 146.0;
  const northZ = -38.5;
  const sideLen = southZ - northZ;
  const sideMidZ = (southZ + northZ) * 0.5;
  const southLen = eastWestX * 2 + 2.4;

  // Shared wall segment geometries
  const sideWallGeo = trackGeo(new THREE.BoxGeometry(1.35, wallH, sideLen));
  const sideCorniceGeo = trackGeo(new THREE.BoxGeometry(1.85, 0.34, sideLen + 0.6));
  const sideMarbleCopingGeo = trackGeo(new THREE.BoxGeometry(1.62, 0.22, sideLen + 0.6));
  const sidePlinthGeo = trackGeo(new THREE.BoxGeometry(1.9, 0.65, sideLen + 0.8));

  const pilasterSideGeo = trackGeo(new THREE.BoxGeometry(1.75, wallH + 0.2, 0.92));
  const blindRecessSideGeo = trackGeo(new THREE.BoxGeometry(0.28, 2.75, 4.4));
  const merlonSideGeo = trackGeo(new THREE.BoxGeometry(0.42, 0.56, 0.72));

  // East & West red sandstone Charbagh enclosure walls
  for (const sx of [-1, 1]) {
    const wx = sx * eastWestX;
    const wall = new THREE.Mesh(sideWallGeo, materials.sandstone);
    wall.position.set(wx, wallH * 0.5, sideMidZ);
    wall.receiveShadow = true;
    wall.castShadow = true;
    perimeter.add(wall);

    const plinth = new THREE.Mesh(sidePlinthGeo, materials.sandstoneDark);
    plinth.position.set(wx, 0.32, sideMidZ);
    plinth.receiveShadow = true;
    perimeter.add(plinth);

    const cornice = new THREE.Mesh(sideCorniceGeo, materials.sandstoneDark);
    cornice.position.set(wx, wallH - 0.14, sideMidZ);
    perimeter.add(cornice);

    const coping = new THREE.Mesh(sideMarbleCopingGeo, materials.marbleTrim);
    coping.position.set(wx, wallH + 0.14, sideMidZ);
    perimeter.add(coping);

    // Rhythmic Mughal wall pilasters, shadowed blind-arch bays & parapet merlons
    const bayStep = 7.4;
    const bayCount = Math.floor((sideLen - 8) / bayStep);
    const pilInst = new THREE.InstancedMesh(pilasterSideGeo, materials.sandstoneDark, bayCount + 1);
    const recInst = new THREE.InstancedMesh(blindRecessSideGeo, materials.sandstoneDark, bayCount);
    const merlonCount = Math.floor(sideLen / 1.45);
    const merlonInst = new THREE.InstancedMesh(merlonSideGeo, materials.sandstone, merlonCount);
    const dObj = new THREE.Object3D();

    for (let i = 0; i <= bayCount; i += 1) {
      const bz = northZ + 4.0 + i * bayStep;
      dObj.position.set(wx - sx * 0.12, wallH * 0.5 + 0.08, bz);
      dObj.rotation.set(0, 0, 0);
      dObj.scale.set(1, 1, 1);
      dObj.updateMatrix();
      pilInst.setMatrixAt(i, dObj.matrix);
      if (i < bayCount) {
        dObj.position.set(wx - sx * 0.62, 2.05, bz + bayStep * 0.5);
        dObj.updateMatrix();
        recInst.setMatrixAt(i, dObj.matrix);
      }
    }
    for (let m = 0; m < merlonCount; m += 1) {
      dObj.position.set(wx - sx * 0.25, wallH + 0.48, northZ + 0.8 + m * 1.45);
      dObj.rotation.set(0, 0, 0);
      dObj.scale.set(1, 1, 1);
      dObj.updateMatrix();
      merlonInst.setMatrixAt(m, dObj.matrix);
    }
    pilInst.instanceMatrix.needsUpdate = true;
    recInst.instanceMatrix.needsUpdate = true;
    merlonInst.instanceMatrix.needsUpdate = true;
    perimeter.add(pilInst, recInst, merlonInst);

    // Historic red sandstone Mughal Garden Pavilion / Side Gateway (z = 78 cross-axis) with white marble dome
    const pav = new THREE.Group();
    const pavBody = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(5.8, 7.6, 13.4)), materials.sandstone);
    pavBody.position.y = 3.8;
    pavBody.castShadow = true;
    pavBody.receiveShadow = true;
    pav.add(pavBody);

    const pavArch = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(6.1, 4.9, 5.4)), materials.marbleDeepVault);
    pavArch.position.y = 2.5;
    pav.add(pavArch);

    const pavFrame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(6.2, 0.36, 14.0)), materials.marbleTrim);
    pavFrame.position.y = 7.72;
    pav.add(pavFrame);

    // Central white marble Mughal pavilion dome + two flanking sandstone chhatri cupolas
    const pavDome = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(3.15, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58)),
      materials.marbleMain,
    );
    pavDome.position.y = 8.1;
    pavDome.scale.set(1, 1.12, 1);
    pavDome.castShadow = true;
    pav.add(pavDome);

    const pavFinial = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.16, 1.35, 8)), materials.bronzeFinial);
    pavFinial.position.y = 12.15;
    pav.add(pavFinial);

    for (const cz of [-4.6, 4.6]) {
      const miniDome = new THREE.Mesh(
        trackGeo(new THREE.SphereGeometry(1.35, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)),
        materials.marbleMain,
      );
      miniDome.position.set(0, 8.75, cz);
      pav.add(miniDome);
      const miniDrum = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.18, 1.24, 1.05, 8)), materials.sandstoneDark);
      miniDrum.position.set(0, 8.2, cz);
      pav.add(miniDrum);
    }

    pav.position.set(wx + sx * 1.2, 0, 78);
    perimeter.add(pav);
  }

  // Southern Charbagh red sandstone enclosure wall (behind the viewer at z = 146)
  const southWall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(southLen, wallH, 1.4)), materials.sandstone);
  southWall.position.set(0, wallH * 0.5, southZ);
  southWall.receiveShadow = true;
  perimeter.add(southWall);

  const southCornice = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(southLen + 0.4, 0.34, 1.9)), materials.sandstoneDark);
  southCornice.position.set(0, wallH - 0.14, southZ);
  perimeter.add(southCornice);

  const southCoping = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(southLen + 0.4, 0.22, 1.68)), materials.marbleTrim);
  southCoping.position.set(0, wallH + 0.14, southZ);
  perimeter.add(southCoping);

  // Iconic Darwaza-i-Rauza (Great South Red Sandstone Gatehouse) anchoring the southern horizon behind viewer
  const southGate = new THREE.Group();
  const gateBody = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(24, 13.5, 8.5)), materials.sandstone);
  gateBody.position.y = 6.75;
  southGate.add(gateBody);
  const gateArch = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.8, 9.2, 9.1)), materials.marbleDeepVault);
  gateArch.position.y = 4.6;
  southGate.add(gateArch);
  const gateTrim = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(24.6, 0.42, 9.0)), materials.marbleTrim);
  gateTrim.position.y = 13.6;
  southGate.add(gateTrim);
  // Signature row of small white marble chhatri cupolas crowning the Great Gate
  const cupolaGeo = trackGeo(new THREE.SphereGeometry(0.95, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55));
  for (let c = -3; c <= 3; c += 1) {
    const cup = new THREE.Mesh(cupolaGeo, materials.marbleMain);
    cup.position.set(c * 2.75, 14.3, 0);
    southGate.add(cup);
  }
  southGate.position.set(0, 0, southZ + 2.2);
  perimeter.add(southGate);

  return perimeter;
}

export function buildGardenEnvironment(
  materials: TajMaterialLibrary,
  tier: PerformanceTier = 'desktop',
): GardenEnvironmentHandles {
  const geometries: THREE.BufferGeometry[] = [];
  const localMaterials: THREE.Material[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  const rand = seededRand(1631);
  const root = new THREE.Group();
  root.name = 'CharbaghGardenRoot';

  // =========================================================================
  // TERRAIN SPLIT AROUND THE YAMUNA RIVER (SOUTH GARDENS + YAMUNA + FAR BANK)
  // =========================================================================
  // South side Charbagh lawns & Agra grounds (z from -41 to +360)
  const southGround = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(760, 401)), materials.grass);
  southGround.rotation.x = -Math.PI * 0.5;
  southGround.position.set(0, 0, 159.5);
  southGround.receiveShadow = true;
  root.add(southGround);

  // North far riverbank — lush green Mehtab Bagh plains across the Yamuna River (z from -168 to -420)
  const northFarGround = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(760, 252)), materials.grass);
  northFarGround.rotation.x = -Math.PI * 0.5;
  northFarGround.position.set(0, 0.35, -294);
  northFarGround.receiveShadow = true;
  root.add(northFarGround);

  // Sloping warm alluvial sandy riverbank on the near South shore (beneath Taj embankment -> into water)
  const nearSandBank = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(760, 15)), materials.riverSand);
  nearSandBank.rotation.x = -Math.PI * 0.5 + 0.16;
  nearSandBank.position.set(0, -1.05, -45.2);
  nearSandBank.receiveShadow = true;
  root.add(nearSandBank);

  // Gentle sandy far North shore rising out of the Yamuna up toward Mehtab Bagh
  const farSandBank = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(760, 22)), materials.riverSand);
  farSandBank.rotation.x = -Math.PI * 0.5 - 0.11;
  farSandBank.position.set(0, -0.68, -162.5);
  farSandBank.receiveShadow = true;
  root.add(farSandBank);

  // Shimmering broad Yamuna River flowing east-to-west right behind the Taj Mahal!
  const riverCenterZ = TAJ_DIMS.riverStartZ - TAJ_DIMS.riverWidth * 0.5;
  const yamunaWater = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(760, TAJ_DIMS.riverWidth + 8, 1, 1)),
    materials.yamunaRiver,
  );
  yamunaWater.rotation.x = -Math.PI * 0.5;
  yamunaWater.position.set(0, TAJ_DIMS.riverWaterY, riverCenterZ);
  root.add(yamunaWater);

  // =========================================================================
  // HISTORIC AGRA RED SANDSTONE RIVERFRONT EMBANKMENT & BURJ PAVILIONS
  // =========================================================================
  // Tall red sandstone retaining embankment wall holding up the Taj terrace above the Yamuna River
  const riverWall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(360, 3.6, 2.2)), materials.sandstone);
  riverWall.position.set(0, -0.65, -40.8);
  riverWall.receiveShadow = true;
  riverWall.castShadow = true;
  root.add(riverWall);

  // Low carved sandstone safety parapet along the riverfront overlook promenade
  const riverParapet = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(168, 0.92, 0.55)), materials.sandstoneDark);
  riverParapet.position.set(0, TAJ_DIMS.sandstoneTerraceH + 0.46, -39.95);
  riverParapet.receiveShadow = true;
  riverParapet.castShadow = true;
  root.add(riverParapet);

  // White marble coping cap along the top of the riverfront parapet
  const riverParapetCap = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(168.4, 0.16, 0.72)), materials.marbleTrim);
  riverParapetCap.position.set(0, TAJ_DIMS.sandstoneTerraceH + 0.96, -39.95);
  root.add(riverParapetCap);

  // Rhythmic arched sandstone retaining buttresses visible along the Yamuna riverside wall
  const buttressGeo = trackGeo(new THREE.BoxGeometry(1.15, 3.4, 1.0));
  for (let bx = -132; bx <= 132; bx += 12) {
    const buttress = new THREE.Mesh(buttressGeo, materials.sandstoneDark);
    buttress.position.set(bx, -0.7, -41.95);
    root.add(buttress);
  }

  // Extended east & west riverfront sandstone terrace overlook wings (walkable in First-Person POV!)
  const riverPromenade = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(166, TAJ_DIMS.sandstoneTerraceH, 10)), materials.sandstone);
  riverPromenade.position.set(0, TAJ_DIMS.sandstoneTerraceH * 0.5, -35.8);
  riverPromenade.receiveShadow = true;
  root.add(riverPromenade);

  // Two iconic octagonal Mughal Riverfront Burj pavilions anchoring the NE & NW river corners
  for (const sx of [-1, 1]) {
    const burj = buildRiverfrontBurj(materials, trackGeo);
    burj.position.set(sx * 58, 0, -39.5);
    root.add(burj);
  }

  // =========================================================================
  // STAGE 1A: LOWER RED SANDSTONE TERRACE, MARBLE STAIRS & REFLECTING POOL
  // =========================================================================
  const terraceAndPoolGroup = new THREE.Group();
  terraceAndPoolGroup.name = 'TerraceAndPool';

  // Lower Agra red sandstone terrace beneath the marble plinth
  const terrace = new THREE.Mesh(
    trackGeo(
      new THREE.BoxGeometry(TAJ_DIMS.sandstoneTerraceW, TAJ_DIMS.sandstoneTerraceH, TAJ_DIMS.sandstoneTerraceD),
    ),
    materials.sandstone,
  );
  terrace.position.y = TAJ_DIMS.sandstoneTerraceH * 0.5;
  terrace.receiveShadow = true;
  terraceAndPoolGroup.add(terrace);

  // Crisp 3D ceremonial front marble staircase: deeply shadowed recessed risers + beveled overhanging bullnose treads!
  const stepCount = 16;
  const totalRise = TAJ_DIMS.plinthTopY - TAJ_DIMS.sandstoneTerraceH;
  const stairDepth = 5.4;
  const stairW = 11.4;
  const stepH = totalRise / stepCount;
  const treadLipH = Math.min(0.088, stepH * 0.34);
  const riserH = Math.max(0.06, stepH - treadLipH);
  const stepRun = stairDepth / stepCount;

  const riserShadowLineGeo = trackGeo(new THREE.BoxGeometry(stairW - 0.04, 0.036, 0.055));
  const treadBevelLipGeo = trackGeo(createBeveledStripGeometry(stairW + 0.06, treadLipH, stepRun + 0.075));
  const wearRunnerGeo = trackGeo(new THREE.BoxGeometry(4.4, 0.012, stepRun * 0.72));

  for (let s = 0; s < stepCount; s += 1) {
    const stepBaseY = TAJ_DIMS.sandstoneTerraceH + s * stepH;
    const stepFrontZ = TAJ_DIMS.plinthD * 0.5 + stairDepth - s * stepRun;
    const riserDepth = Math.max(stepRun, stairDepth - s * stepRun - 0.045);

    // 1. Recessed shaded vertical marble riser block (reads clearly in shadow below each tread lip)
    const riser = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(stairW, riserH + 0.02, riserDepth)),
      materials.marbleShadowRecess,
    );
    riser.position.set(0, stepBaseY + riserH * 0.5, TAJ_DIMS.plinthD * 0.5 + riserDepth * 0.5);
    riser.receiveShadow = true;
    riser.castShadow = true;
    terraceAndPoolGroup.add(riser);

    // 2. Crisp dark architectural shadow undercut right beneath the overhanging bullnose tread nose
    const undercut = new THREE.Mesh(riserShadowLineGeo, materials.marbleDeepVault);
    undercut.position.set(0, stepBaseY + riserH - 0.016, stepFrontZ - 0.032);
    terraceAndPoolGroup.add(undercut);

    // 3. Beveled overhanging marble tread slab catching golden sunlight along its front nosing
    const tread = new THREE.Mesh(treadBevelLipGeo, materials.marbleMain);
    tread.position.set(0, stepBaseY + riserH + treadLipH * 0.5, stepFrontZ - stepRun * 0.5 + 0.024);
    tread.castShadow = true;
    tread.receiveShadow = true;
    terraceAndPoolGroup.add(tread);

    // 4. Subtle foot-worn central patina strip along the middle of each marble tread
    const wear = new THREE.Mesh(wearRunnerGeo, materials.marbleTrim);
    wear.position.set(0, stepBaseY + stepH + 0.002, stepFrontZ - stepRun * 0.5);
    wear.receiveShadow = true;
    terraceAndPoolGroup.add(wear);
  }

  // Sculpted stepped marble stair cheek-walls, beveled coping cap & corner bollards framing the ceremonial steps
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.68, totalRise * 0.58, stairDepth + 0.68)), materials.marbleMain);
    cheek.position.set(sx * 6.04, TAJ_DIMS.sandstoneTerraceH + totalRise * 0.29, TAJ_DIMS.plinthD * 0.5 + stairDepth * 0.5);
    cheek.castShadow = true;
    cheek.receiveShadow = true;
    terraceAndPoolGroup.add(cheek);

    const cheekCap = new THREE.Mesh(
      trackGeo(createBeveledStripGeometry(0.82, 0.16, stairDepth + 0.84)),
      materials.marbleTrim,
    );
    cheekCap.position.set(sx * 6.04, TAJ_DIMS.sandstoneTerraceH + totalRise * 0.58 + 0.06, TAJ_DIMS.plinthD * 0.5 + stairDepth * 0.5);
    cheekCap.castShadow = true;
    cheekCap.receiveShadow = true;
    terraceAndPoolGroup.add(cheekCap);

    const newel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.90, 1.22, 0.90)), materials.marbleTrim);
    newel.position.set(sx * 6.04, TAJ_DIMS.sandstoneTerraceH + 0.61, TAJ_DIMS.plinthD * 0.5 + stairDepth + 0.28);
    newel.castShadow = true;
    newel.receiveShadow = true;
    terraceAndPoolGroup.add(newel);
  }

  // Soft contact shadow directly beneath the white marble plinth & ceremonial staircase on the red sandstone terrace
  const plinthShadow = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(72, 72)), materials.contactShadow);
  plinthShadow.rotation.x = -Math.PI * 0.5;
  plinthShadow.position.y = TAJ_DIMS.sandstoneTerraceH + 0.02;
  terraceAndPoolGroup.add(plinthShadow);

  const stairShadow = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(15.8, 8.6)), materials.contactShadow);
  stairShadow.rotation.x = -Math.PI * 0.5;
  stairShadow.position.set(0, TAJ_DIMS.sandstoneTerraceH + 0.026, TAJ_DIMS.plinthD * 0.5 + 3.1);
  terraceAndPoolGroup.add(stairShadow);

  // Front red sandstone apron promenade
  const apron = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(130, 0.08, 12)), materials.sandstone);
  apron.position.set(0, 0.04, 38.5);
  apron.receiveShadow = true;
  terraceAndPoolGroup.add(apron);

  // Central reflecting pool channel extending from the terrace toward the viewer (+Z)
  const poolLen = TAJ_DIMS.poolLength;
  const poolW = TAJ_DIMS.poolWidth;
  const poolCenterZ = TAJ_DIMS.poolStartZ + poolLen * 0.5;

  // World-proportioned Agra red sandstone flagstone promenades with beveled veined white Makrana marble border strips
  const walkwayGeo = trackGeo(new THREE.BoxGeometry(4.4, 0.06, poolLen + 4));
  const marbleInlayLongGeo = trackGeo(createBeveledStripGeometry(0.18, 0.088, poolLen + 3.6));
  const marbleInlayCrossGeo = trackGeo(createBeveledStripGeometry(4.2, 0.088, 0.18));
  const redCurbGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.14, poolLen + 4));

  // Soft matte dusty earth-sand mortar bed right beneath the foreground 3D flagstones (zero specular grout glare!)
  const mortarBedMat = new THREE.MeshStandardMaterial({
    color: 0x877b70,
    roughness: 0.99,
    metalness: 0.0,
    envMapIntensity: 0.05,
  });
  localMaterials.push(mortarBedMat);
  const mortarBedGeo = trackGeo(new THREE.PlaneGeometry(3.52, poolLen - 2));

  for (const sx of [-1, 1]) {
    const walkX = sx * (poolW * 0.5 + 2.55);
    const walk = new THREE.Mesh(walkwayGeo, materials.walkwaySandstone);
    walk.position.set(walkX, 0.03, poolCenterZ);
    walk.receiveShadow = true;
    terraceAndPoolGroup.add(walk);

    // Shallow dusty-grey lime mortar base visible inside the tight flagstone joints
    const mortarBed = new THREE.Mesh(mortarBedGeo, mortarBedMat);
    mortarBed.rotation.x = -Math.PI * 0.5;
    mortarBed.position.set(walkX, 0.0615, poolCenterZ);
    mortarBed.receiveShadow = true;
    terraceAndPoolGroup.add(mortarBed);

    // Authentic Mughal inlaid beveled & veined white Makrana marble strips running along the sandstone walkways
    for (const offX of [-1.86, 1.86]) {
      const strip = new THREE.Mesh(marbleInlayLongGeo, materials.marbleTrim);
      strip.position.set(walkX + offX, 0.044, poolCenterZ);
      strip.receiveShadow = true;
      terraceAndPoolGroup.add(strip);
    }
    for (let rz = TAJ_DIMS.poolStartZ + 4; rz < TAJ_DIMS.poolStartZ + poolLen - 2; rz += 6.2) {
      const crossStrip = new THREE.Mesh(marbleInlayCrossGeo, materials.marbleTrim);
      crossStrip.position.set(walkX, 0.044, rz);
      crossStrip.receiveShadow = true;
      terraceAndPoolGroup.add(crossStrip);
    }

    // Carved stepped stone curb separating sandstone promenade from manicured grass parterres
    const lawnEdge = new THREE.Mesh(redCurbGeo, materials.sandstoneDark);
    lawnEdge.position.set(sx * (poolW * 0.5 + 4.86), 0.07, poolCenterZ);
    lawnEdge.receiveShadow = true;
    terraceAndPoolGroup.add(lawnEdge);

    const lawnEdgeCap = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.16, 0.16, poolLen + 4)),
      materials.marbleTrim,
    );
    lawnEdgeCap.position.set(sx * (poolW * 0.5 + 4.74), 0.08, poolCenterZ);
    terraceAndPoolGroup.add(lawnEdgeCap);

    // Outer secondary parallel sandstone pathways
    const outerWalk = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.2, 0.05, poolLen + 8)), materials.walkwaySandstone);
    outerWalk.position.set(sx * 24.5, 0.025, poolCenterZ);
    outerWalk.receiveShadow = true;
    terraceAndPoolGroup.add(outerWalk);
  }

  // Cross-axis red sandstone walkways dividing the Charbagh parterres
  for (const cz of [54, 78, 103]) {
    const crossWalk = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(116, 0.045, 3.4)), materials.sandstone);
    crossWalk.position.set(0, 0.022, cz);
    crossWalk.receiveShadow = true;
    terraceAndPoolGroup.add(crossWalk);
  }

  // Raised iconic central Charbagh checkered Makrana marble viewing platform (Hawz-i-Kauthar axis)
  const viewingPlatform = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(11.2, 0.24, 8.8)), materials.marbleDeck);
  viewingPlatform.position.set(0, 0.12, 103.5);
  viewingPlatform.receiveShadow = true;
  terraceAndPoolGroup.add(viewingPlatform);

  const platformTrim = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(11.6, 0.14, 9.2)), materials.marbleTrim);
  platformTrim.position.set(0, 0.07, 103.5);
  terraceAndPoolGroup.add(platformTrim);

  // Carved marble Diana Bench set tastefully at the rear of the central viewing platform
  const benchSeat = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.6, 0.14, 0.72)), materials.marbleMain);
  benchSeat.position.set(0, 0.66, 106.2);
  benchSeat.castShadow = true;
  terraceAndPoolGroup.add(benchSeat);
  for (const bsx of [-1.05, 1.05]) {
    const benchLeg = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.22, 0.44, 0.66)), materials.marbleTrim);
    benchLeg.position.set(bsx, 0.42, 106.2);
    benchLeg.castShadow = true;
    terraceAndPoolGroup.add(benchLeg);
  }

  // White Makrana marble coping curbs framing the reflecting pool (with subtle waterline wet-stone darkening)
  const curbLongGeo = trackGeo(new THREE.BoxGeometry(0.52, 0.3, poolLen + 1.0));
  for (const sx of [-1, 1]) {
    const curb = new THREE.Mesh(curbLongGeo, materials.poolCurbMarble);
    curb.position.set(sx * (poolW * 0.5 + 0.26), 0.15, poolCenterZ);
    curb.castShadow = true;
    curb.receiveShadow = true;
    terraceAndPoolGroup.add(curb);
  }

  const curbEndGeo = trackGeo(new THREE.BoxGeometry(poolW + 1.04, 0.3, 0.52));
  for (const ez of [TAJ_DIMS.poolStartZ - 0.26, TAJ_DIMS.poolStartZ + poolLen + 0.26]) {
    const endCurb = new THREE.Mesh(curbEndGeo, materials.poolCurbMarble);
    endCurb.position.set(0, 0.15, ez);
    endCurb.castShadow = true;
    endCurb.receiveShadow = true;
    terraceAndPoolGroup.add(endCurb);
  }

  // Pool stone bed and shimmering photorealistic water plane
  const poolBed = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(poolW, poolLen)), materials.poolBed);
  poolBed.rotation.x = -Math.PI * 0.5;
  poolBed.position.set(0, 0.04, poolCenterZ);
  terraceAndPoolGroup.add(poolBed);

  const waterSurface = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(poolW, poolLen, 1, 1)), materials.water);
  waterSurface.rotation.x = -Math.PI * 0.5;
  waterSurface.position.set(0, 0.18, poolCenterZ);
  waterSurface.renderOrder = 1;
  terraceAndPoolGroup.add(waterSurface);

  // Central line of detailed Mughal carved Makrana marble lotus pedestals + ornate turned bronze sprinkler nozzles
  // (Dynamic intermittent multi-tier water jets, parabolic arcs, droplets & splash rings are driven by buildFountainSprinklers)
  const fountainCount = 20;

  // 1. Stepped Makrana marble fountain pedestal (submerged base -> cavetto waist -> projecting cornice)
  const pedestalProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.35, 0.0),
    new THREE.Vector2(0.35, 0.055),
    new THREE.Vector2(0.30, 0.085),
    new THREE.Vector2(0.245, 0.14),
    new THREE.Vector2(0.225, 0.21),
    new THREE.Vector2(0.268, 0.248),
    new THREE.Vector2(0.285, 0.282),
    new THREE.Vector2(0.22, 0.308),
    new THREE.Vector2(0.145, 0.312),
    new THREE.Vector2(0.0, 0.312),
  ];
  const pedestalGeo = trackGeo(new THREE.LatheGeometry(pedestalProfile, 24));

  // 2. Smoothly sculpted 8-petal Mughal lotus-crown marble collar (48 radial segments = 6 per curved petal)
  const lotusCollarGeo = trackGeo(new THREE.CylinderGeometry(0.185, 0.142, 0.105, 48, 5, false));
  {
    const pos = lotusCollarGeo.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v += 1) {
      const vx = pos.getX(v);
      const vy = pos.getY(v);
      const vz = pos.getZ(v);
      const r = Math.hypot(vx, vz);
      if (r > 0.03) {
        const ang = Math.atan2(vz, vx);
        // Normalized height along collar [0..1]
        const hNorm = Math.max(0, Math.min(1, (vy + 0.0525) / 0.105));
        // Rounded lotus petal lobe profile (smooth bell curve instead of sharp triangle)
        const lobe = 0.5 + 0.5 * Math.cos(ang * 8.0);
        const smoothPetal = Math.pow(lobe, 0.65);
        // Gently flare petals outward near the crown rim and scallop the upper edge cleanly
        const flare = 1.0 + (0.04 + 0.15 * smoothPetal) * Math.pow(hNorm, 1.35);
        const rimArch = Math.pow(hNorm, 1.8) * (0.026 * smoothPetal - 0.012);
        pos.setXYZ(v, vx * flare, vy + rimArch, vz * flare);
      }
    }
    lotusCollarGeo.computeVertexNormals();
  }

  // 3. Ornate turned Mughal brass/bronze lotus-bud sprinkler riser & multi-jet nozzle head (y = 0..0.46)
  const nozzleProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.138, 0.0),   // heavy bronze mounting flange
    new THREE.Vector2(0.138, 0.03),
    new THREE.Vector2(0.112, 0.045), // stepped bead molding
    new THREE.Vector2(0.102, 0.058),
    new THREE.Vector2(0.076, 0.082),
    new THREE.Vector2(0.098, 0.118), // lower turned baluster torus ring
    new THREE.Vector2(0.068, 0.152),
    new THREE.Vector2(0.056, 0.215), // slender tapering neck
    new THREE.Vector2(0.074, 0.236), // crisp mid-stem brass collar bead
    new THREE.Vector2(0.064, 0.252),
    new THREE.Vector2(0.090, 0.282), // flared lotus-bud sprinkler bowl base
    new THREE.Vector2(0.104, 0.330), // wide fluted lotus-bud spray ring (8 micro-spouts emerge here)
    new THREE.Vector2(0.078, 0.376), // tapered crown shoulder
    new THREE.Vector2(0.056, 0.398), // upper turned brass collar
    new THREE.Vector2(0.044, 0.445), // precision central jet tip
    new THREE.Vector2(0.026, 0.455),
    new THREE.Vector2(0.0, 0.455),
  ];
  const nozzleGeo = trackGeo(new THREE.LatheGeometry(nozzleProfile, 28));
  // Subtle vertical fluting along the bulbous lotus-bud head for realistic cast-bronze highlights
  {
    const pos = nozzleGeo.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v += 1) {
      const vx = pos.getX(v);
      const vy = pos.getY(v);
      const vz = pos.getZ(v);
      if (vy > 0.265 && vy < 0.388) {
        const ang = Math.atan2(vz, vx);
        const flute = 1.0 + 0.055 * Math.cos(ang * 8.0);
        pos.setX(v, vx * flute);
        pos.setZ(v, vz * flute);
      }
    }
    nozzleGeo.computeVertexNormals();
  }

  // 4. Crisp recessed dark orifice cap + 8 angled brass micro-jet spouts around the fluted lotus-bud spray ring
  const orificeGeo = trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 12));

  // Build a single merged 8-spout micro-jet ring geometry (8 tiny flared brass ports tilted at 36 deg)
  const spoutCount = 8;
  const spoutPositions: number[] = [];
  const spoutNormals: number[] = [];
  const spoutIndices: number[] = [];
  const baseSpout = new THREE.CylinderGeometry(0.010, 0.0155, 0.048, 8, 1, false);
  const spoutMat4 = new THREE.Matrix4();
  const spoutQuat = new THREE.Quaternion();
  const spoutEuler = new THREE.Euler();
  const spoutPosVec = new THREE.Vector3();
  const spoutScaleVec = new THREE.Vector3(1, 1, 1);
  const vTmp = new THREE.Vector3();
  const nTmp = new THREE.Vector3();
  const normMat3 = new THREE.Matrix3();
  let vertOffset = 0;

  for (let s = 0; s < spoutCount; s += 1) {
    const ang = (s / spoutCount) * Math.PI * 2;
    const radialDist = 0.098;
    spoutPosVec.set(Math.cos(ang) * radialDist, 0.335, Math.sin(ang) * radialDist);
    // Tilt spout radially outward and upward from the lotus-bud spray ring
    spoutEuler.set(0, -ang, -0.62, 'YXZ');
    spoutQuat.setFromEuler(spoutEuler);
    spoutMat4.compose(spoutPosVec, spoutQuat, spoutScaleVec);
    normMat3.getNormalMatrix(spoutMat4);

    const pAttr = baseSpout.attributes.position as THREE.BufferAttribute;
    const nAttr = baseSpout.attributes.normal as THREE.BufferAttribute;
    for (let v = 0; v < pAttr.count; v += 1) {
      vTmp.fromBufferAttribute(pAttr, v).applyMatrix4(spoutMat4);
      nTmp.fromBufferAttribute(nAttr, v).applyMatrix3(normMat3).normalize();
      spoutPositions.push(vTmp.x, vTmp.y, vTmp.z);
      spoutNormals.push(nTmp.x, nTmp.y, nTmp.z);
    }
    const idx = baseSpout.index;
    if (idx) {
      for (let j = 0; j < idx.count; j += 1) {
        spoutIndices.push(idx.getX(j) + vertOffset);
      }
    }
    vertOffset += pAttr.count;
  }
  baseSpout.dispose();

  const microSpoutsGeo = trackGeo(new THREE.BufferGeometry());
  microSpoutsGeo.setAttribute('position', new THREE.Float32BufferAttribute(spoutPositions, 3));
  microSpoutsGeo.setAttribute('normal', new THREE.Float32BufferAttribute(spoutNormals, 3));
  microSpoutsGeo.setIndex(spoutIndices);

  const pedestalInst = new THREE.InstancedMesh(pedestalGeo, materials.poolCurbMarble, fountainCount);
  const collarInst = new THREE.InstancedMesh(lotusCollarGeo, materials.marbleMain, fountainCount);
  const nozzleInst = new THREE.InstancedMesh(nozzleGeo, materials.bronzeFinial, fountainCount);
  const microSpoutsInst = new THREE.InstancedMesh(microSpoutsGeo, materials.bronzeFinial, fountainCount);
  const orificeInst = new THREE.InstancedMesh(orificeGeo, materials.darkInlayStone, fountainCount);
  pedestalInst.castShadow = true;
  pedestalInst.receiveShadow = true;
  nozzleInst.castShadow = true;
  const dummy = new THREE.Object3D();

  for (let i = 0; i < fountainCount; i += 1) {
    const fz = TAJ_DIMS.poolStartZ + 3.2 + (i / (fountainCount - 1)) * (poolLen - 6.4);
    const insidePlatform = Math.abs(fz - 103.5) < 4.8;
    const baseY = insidePlatform ? -3.0 : 0.02;

    dummy.position.set(0, baseY, fz);
    dummy.rotation.set(0, (i % 2) * (Math.PI / 8), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    pedestalInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(0, baseY + 0.34, fz);
    dummy.updateMatrix();
    collarInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(0, baseY + 0.345, fz);
    dummy.updateMatrix();
    nozzleInst.setMatrixAt(i, dummy.matrix);
    microSpoutsInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(0, baseY + 0.798, fz);
    dummy.updateMatrix();
    orificeInst.setMatrixAt(i, dummy.matrix);
  }
  pedestalInst.instanceMatrix.needsUpdate = true;
  pedestalInst.computeBoundingSphere();
  collarInst.instanceMatrix.needsUpdate = true;
  collarInst.computeBoundingSphere();
  nozzleInst.instanceMatrix.needsUpdate = true;
  nozzleInst.computeBoundingSphere();
  microSpoutsInst.instanceMatrix.needsUpdate = true;
  microSpoutsInst.computeBoundingSphere();
  orificeInst.instanceMatrix.needsUpdate = true;
  orificeInst.computeBoundingSphere();
  terraceAndPoolGroup.add(pedestalInst, collarInst, nozzleInst, microSpoutsInst, orificeInst);

  // Elevated manicured grass parterre strips flanking the pool promenade
  const parterreGeo = trackGeo(new THREE.BoxGeometry(15.2, 0.06, poolLen - 4));
  for (const sx of [-1, 1]) {
    const lawn = new THREE.Mesh(parterreGeo, materials.grass);
    lawn.position.set(sx * 15.3, 0.03, poolCenterZ);
    lawn.receiveShadow = true;
    terraceAndPoolGroup.add(lawn);
  }

  // =========================================================================
  // MICRO-TILTED 3D AGRA RED SANDSTONE WALKWAY FLAGSTONES (SQUARE & BALANCED RECTANGLES)
  // Uses seamless un-gridded sandstone grain (materials.walkwayFlagstone) with tight shallow dusty-grey seams!
  // =========================================================================
  {
    const flagGeo = trackGeo(new THREE.BoxGeometry(0.84, 0.012, 0.86));
    const flagCols = 4;
    const flagRows = 78;
    const totalFlags = 2 * flagCols * flagRows;
    const flagInst = new THREE.InstancedMesh(flagGeo, materials.walkwayFlagstone, totalFlags);
    flagInst.receiveShadow = true;
    const slabColor = new THREE.Color();
    let fIdx = 0;

    for (const sx of [-1, 1]) {
      const walkX = sx * (poolW * 0.5 + 2.55);
      for (let r = 0; r < flagRows; r += 1) {
        const isRectRow = r % 3 === 1;
        const rowPitchZ = 0.885;
        const fz = 50.2 + r * rowPitchZ;
        if (fz > 119.5) break;
        if (Math.abs(fz - 54) < 1.85 || Math.abs(fz - 78) < 1.85 || Math.abs(fz - 103.5) < 4.75) continue;
        // Skip white marble transverse border strips cleanly
        const relStrip = ((fz - (TAJ_DIMS.poolStartZ + 4)) % 6.2 + 6.2) % 6.2;
        if (relStrip < 0.52 || relStrip > 5.68) continue;

        for (let c = 0; c < flagCols; c += 1) {
          // 4 balanced square/rectangular Agra sandstone flagstones fitting neatly between the marble border inlays
          const fx = walkX - 1.305 + c * 0.87 + (rand() - 0.5) * 0.006;
          const microH = 0.068 + (rand() - 0.5) * 0.0032;
          dummy.position.set(fx, microH, fz + (rand() - 0.5) * 0.006);
          dummy.rotation.set(
            (rand() - 0.5) * 0.007,
            (rand() - 0.5) * 0.006,
            (rand() - 0.5) * 0.007,
          );
          // Slight natural variation between square (1:1) and balanced rectangular flagstones with tight 0.024m seams
          dummy.scale.set(
            0.975 + rand() * 0.025,
            1.0,
            isRectRow ? 0.995 : 0.965 + rand() * 0.025,
          );
          dummy.updateMatrix();
          flagInst.setMatrixAt(fIdx, dummy.matrix);

          // Authentic Agra sandstone mineral slab variation (warm terracotta, dusty rose, soft buff ochre)
          const tint = 0.89 + rand() * 0.20;
          slabColor.setRGB(
            tint * (0.99 + (rand() - 0.5) * 0.08),
            tint * (0.95 + (rand() - 0.5) * 0.06),
            tint * (0.92 + (rand() - 0.5) * 0.06),
          );
          flagInst.setColorAt(fIdx, slabColor);
          fIdx += 1;
        }
      }
    }
    flagInst.count = fIdx;
    flagInst.instanceMatrix.needsUpdate = true;
    if (flagInst.instanceColor) flagInst.instanceColor.needsUpdate = true;
    flagInst.computeBoundingSphere();
    terraceAndPoolGroup.add(flagInst);
  }

  // Ground-level micro-detail instanced meshes hidden during the planar water reflection pass
  // (below the pool marble rim and never visible in the mirror reflection — huge 120fps GPU win!)
  const nonReflectedObjects: THREE.Object3D[] = [];

  // =========================================================================
  // DENSE, LUSH 3D FOREGROUND GRASS CARPET (MULTIPLIED INSTANCED 5-BLADE TUFTS + GPU LOD)
  // =========================================================================
  {
    const grassTuftGeo = trackGeo(createGrassBladeTuftGeometry());
    const tuftCount = tier === 'desktop' ? 9200 : tier === 'mobile' ? 4200 : 2200;
    const widthBoost = tier === 'desktop' ? 1.15 : tier === 'mobile' ? 1.38 : 1.55;
    const grassInst = new THREE.InstancedMesh(grassTuftGeo, materials.grassBlade, tuftCount);
    grassInst.receiveShadow = true;
    const bladeCol = new THREE.Color();
    let gIdx = 0;

    for (let i = 0; i < tuftCount; i += 1) {
      const sx = i % 2 === 0 ? -1 : 1;
      // Thick foreground-to-midground blanket covering both flanking Charbagh lawns seamlessly
      const zBias = i < tuftCount * 0.65 ? Math.pow(rand(), 0.72) : rand();
      const gz = 40.5 + zBias * 81.5;
      if (Math.abs(gz - 54) < 1.95 || Math.abs(gz - 78) < 1.95 || Math.abs(gz - 103) < 2.0) continue;

      // Extra dense near inner walkway/hedge edge while still richly covering the full 15m lawn width
      const xBias = i % 3 === 0 ? Math.pow(rand(), 1.35) : rand();
      const gx = sx * (poolW * 0.5 + 5.05 + xBias * 14.8);

      dummy.position.set(gx, 0.056, gz);
      dummy.rotation.set(
        (rand() - 0.5) * 0.16,
        rand() * Math.PI * 2,
        (rand() - 0.5) * 0.16,
      );
      const scXZ = (0.95 + rand() * 0.72) * widthBoost;
      const scY = 0.68 + rand() * 0.82;
      dummy.scale.set(scXZ, scY, scXZ);
      dummy.updateMatrix();
      grassInst.setMatrixAt(gIdx, dummy.matrix);

      // Natural dark-to-light emerald & olive lawn variation so turf blends seamlessly into ground
      const shade = 0.72 + rand() * 0.36;
      const warmth = rand();
      bladeCol.setRGB(
        shade * (0.78 + warmth * 0.24),
        shade * (0.92 + rand() * 0.16),
        shade * (0.64 + (1 - warmth) * 0.16),
      );
      grassInst.setColorAt(gIdx, bladeCol);
      gIdx += 1;
    }
    grassInst.count = gIdx;
    grassInst.instanceMatrix.needsUpdate = true;
    if (grassInst.instanceColor) grassInst.instanceColor.needsUpdate = true;
    grassInst.computeBoundingSphere();
    terraceAndPoolGroup.add(grassInst);
    nonReflectedObjects.push(grassInst);
  }

  // =========================================================================
  // SOFTLY ROUNDED, THICK LEAFY MUGHAL BOXWOOD HEDGES & ORGANIC OUTER LEAF TUFTS
  // =========================================================================
  {
    const hedgeBorderRuns: Array<[number, number, number, number]> = [
      // Outer sculpted boxwood borders framing each Charbagh parterre quadrant
      [22.4, 46.5, 0.74, 10.6],
      [22.4, 66.0, 0.74, 19.6],
      [22.4, 90.5, 0.74, 20.6],
      [22.4, 114.2, 0.74, 17.6],
      // Low parterre cross-walkway flanking hedges (running east-west perpendicular to pool)
      [15.6, 51.7, 13.4, 0.70],
      [15.6, 56.3, 13.4, 0.70],
      [15.6, 75.7, 13.4, 0.70],
      [15.6, 80.3, 13.4, 0.70],
      [15.6, 100.7, 13.4, 0.70],
      [15.6, 105.3, 13.4, 0.70],
      // Inner low boxwood ribbon neatly edging the lawn behind the marble curb
      [9.48, 66.0, 0.62, 18.8],
      [9.48, 90.5, 0.62, 19.6],
      [9.48, 113.8, 0.62, 15.8],
    ];

    // Collect positions for protruding organic alpha-masked leafy boxwood bough tufts along hedge crowns & sides
    const hedgeTuftPositions: Array<{ x: number; y: number; z: number; s: number }> = [];

    let hSeed = 11;
    for (const sx of [-1, 1]) {
      for (const [hxAbs, hz, hw, hd] of hedgeBorderRuns) {
        hSeed += 3.7;
        const hedgeH = 0.48 + (rand() - 0.5) * 0.05;
        const hedgeGeo = trackGeo(createSculptedHedgeGeometry(hw, hedgeH, hd, hSeed));
        const hedge = new THREE.Mesh(hedgeGeo, materials.boxwoodHedge);
        hedge.position.set(sx * hxAbs, 0.05 + hedgeH * 0.5, hz);
        hedge.castShadow = true;
        hedge.receiveShadow = true;
        terraceAndPoolGroup.add(hedge);

        // Scatter organic protruding leafy tufts along the top & outer shoulders to break up any straight edge
        const isRunZ = hd > hw;
        const runLen = isRunZ ? hd : hw;
        const tuftStep = tier === 'desktop' ? 0.68 : 0.95;
        const count = Math.max(4, Math.floor(runLen / tuftStep));
        for (let k = 0; k < count; k += 1) {
          const frac = (k + 0.3 + rand() * 0.4) / count - 0.5;
          const jitterCross = (rand() - 0.5) * (isRunZ ? hw : hd) * 0.72;
          const tx = sx * hxAbs + (isRunZ ? jitterCross : frac * runLen);
          const tz = hz + (isRunZ ? frac * runLen : jitterCross);
          const ty = 0.05 + hedgeH * (0.68 + rand() * 0.34);
          hedgeTuftPositions.push({ x: tx, y: ty, z: tz, s: 0.24 + rand() * 0.14 });
        }

        // Low red sandstone grounding curb beneath cross-walkway hedges
        if (hw > 3.0) {
          const curb = new THREE.Mesh(
            trackGeo(new THREE.BoxGeometry(hw + 0.16, 0.12, hd + 0.16)),
            materials.sandstoneDark,
          );
          curb.position.set(sx * hxAbs, 0.06, hz);
          curb.receiveShadow = true;
          terraceAndPoolGroup.add(curb);
        }
      }
    }

    // Instanced leafy foliage tufts crowning the rounded boxwood hedges
    const hedgeTuftGeo = trackGeo(new THREE.PlaneGeometry(1.0, 0.85));
    const tuftTotal = hedgeTuftPositions.length * 2;
    const hedgeTuftInst = new THREE.InstancedMesh(hedgeTuftGeo, materials.shrubLeafCluster, tuftTotal);
    hedgeTuftInst.receiveShadow = true;
    const hCol = new THREE.Color();
    let htIdx = 0;
    for (const pt of hedgeTuftPositions) {
      for (let c = 0; c < 2; c += 1) {
        dummy.position.set(pt.x, pt.y, pt.z);
        dummy.rotation.set(
          (rand() - 0.5) * 0.65,
          c * Math.PI * 0.5 + rand() * Math.PI,
          (rand() - 0.5) * 0.55,
        );
        dummy.scale.set(pt.s * 1.45, pt.s * 1.25, 1.0);
        dummy.updateMatrix();
        hedgeTuftInst.setMatrixAt(htIdx, dummy.matrix);
        const shade = 0.72 + rand() * 0.26;
        hCol.setRGB(shade * 0.86, shade * 1.02, shade * 0.78);
        hedgeTuftInst.setColorAt(htIdx, hCol);
        htIdx += 1;
      }
    }
    hedgeTuftInst.count = htIdx;
    hedgeTuftInst.instanceMatrix.needsUpdate = true;
    if (hedgeTuftInst.instanceColor) hedgeTuftInst.instanceColor.needsUpdate = true;
    hedgeTuftInst.computeBoundingSphere();
    terraceAndPoolGroup.add(hedgeTuftInst);
    nonReflectedObjects.push(hedgeTuftInst);
  }

  // =========================================================================
  // NATURAL GROUND CLUTTER: FALLEN DRY LEAVES & MARIGOLD/ROSE PETALS
  // =========================================================================
  const leafPetalGeo = trackGeo(createCurvedLeafPetalGeometry());
  {
    const staticCount = 540;
    const staticClutterInst = new THREE.InstancedMesh(leafPetalGeo, materials.groundClutter, staticCount);
    staticClutterInst.receiveShadow = true;
    const clutterCol = new THREE.Color();
    let cIdx = 0;

    for (let i = 0; i < staticCount; i += 1) {
      const sx = i % 2 === 0 ? -1 : 1;
      const zoneRoll = rand();
      let cx = 0;
      let cy = 0.072;
      let cz = 48.0 + rand() * 72.0;

      if (zoneRoll < 0.44) {
        // Nestled naturally right against the white marble pool curb edge
        cx = sx * (poolW * 0.5 + 0.56 + rand() * 0.48);
        cy = 0.073;
      } else if (zoneRoll < 0.80) {
        // Resting along the outer sandstone promenade & lawn curb seam
        cx = sx * (poolW * 0.5 + 4.15 + (rand() - 0.5) * 0.92);
        cy = 0.073;
      } else {
        // Scattered organically on the walkways & viewing platform edges
        cx = sx * (poolW * 0.5 + 1.1 + rand() * 3.1);
        cy = 0.074;
      }

      if (Math.abs(cz - 103.5) < 4.5 && Math.abs(cx) < 5.7) {
        cy = 0.246;
      }

      dummy.position.set(cx, cy, cz);
      dummy.rotation.set(
        (rand() - 0.5) * 0.12,
        rand() * Math.PI * 2,
        (rand() - 0.5) * 0.12,
      );
      const leafScale = 0.72 + rand() * 0.85;
      dummy.scale.set(leafScale, 1.0, leafScale * (0.75 + rand() * 0.45));
      dummy.updateMatrix();
      staticClutterInst.setMatrixAt(cIdx, dummy.matrix);

      // Mix of dry amber/russet fallen leaves, olive cypress sprigs, marigold orange & soft crimson rose petals
      const kind = rand();
      if (kind < 0.45) {
        // Warm dry autumn/amber leaf
        clutterCol.setRGB(0.62 + rand() * 0.18, 0.44 + rand() * 0.14, 0.22 + rand() * 0.08);
      } else if (kind < 0.68) {
        // Muted olive-brown fallen foliage
        clutterCol.setRGB(0.40 + rand() * 0.14, 0.46 + rand() * 0.14, 0.24 + rand() * 0.08);
      } else if (kind < 0.86) {
        // Vibrant Indian marigold petal
        clutterCol.setRGB(0.95, 0.56 + rand() * 0.18, 0.12);
      } else {
        // Mughal rose petal
        clutterCol.setRGB(0.84, 0.24 + rand() * 0.14, 0.30 + rand() * 0.12);
      }
      staticClutterInst.setColorAt(cIdx, clutterCol);
      cIdx += 1;
    }
    staticClutterInst.count = cIdx;
    staticClutterInst.instanceMatrix.needsUpdate = true;
    if (staticClutterInst.instanceColor) staticClutterInst.instanceColor.needsUpdate = true;
    staticClutterInst.computeBoundingSphere();
    terraceAndPoolGroup.add(staticClutterInst);
    nonReflectedObjects.push(staticClutterInst);
  }

  // Animated delicate leaves & flower petals drifting slowly on the reflecting pool surface
  const floatingCount = 64;
  const floatingClutterInst = new THREE.InstancedMesh(leafPetalGeo, materials.groundClutter, floatingCount);
  floatingClutterInst.frustumCulled = false;
  floatingClutterInst.renderOrder = 3;
  nonReflectedObjects.push(floatingClutterInst);
  const floatingSeeds: Array<{
    x0: number;
    z0: number;
    driftSpeed: number;
    swayAmp: number;
    phase: number;
    rot0: number;
    spinSpeed: number;
    scale: number;
  }> = [];
  {
    const floatCol = new THREE.Color();
    for (let i = 0; i < floatingCount; i += 1) {
      const fz = TAJ_DIMS.poolStartZ + 2.0 + rand() * (poolLen - 4.0);
      const fx = (rand() - 0.5) * (poolW - 0.95);
      const scale = 0.68 + rand() * 0.68;
      floatingSeeds.push({
        x0: fx,
        z0: fz,
        driftSpeed: 0.045 + rand() * 0.055,
        swayAmp: 0.12 + rand() * 0.18,
        phase: rand() * Math.PI * 2,
        rot0: rand() * Math.PI * 2,
        spinSpeed: (rand() - 0.5) * 0.18,
        scale,
      });

      const kind = rand();
      if (kind < 0.42) {
        floatCol.setRGB(0.68, 0.48, 0.24);
      } else if (kind < 0.74) {
        floatCol.setRGB(0.96, 0.62, 0.16);
      } else {
        floatCol.setRGB(0.88, 0.30, 0.36);
      }
      floatingClutterInst.setColorAt(i, floatCol);
    }
    if (floatingClutterInst.instanceColor) floatingClutterInst.instanceColor.needsUpdate = true;
    terraceAndPoolGroup.add(floatingClutterInst);
  }

  const floatDummy = new THREE.Object3D();
  const updateFloatingClutter = (elapsedSec: number, breezeStrength: number): void => {
    const breeze = 0.35 + breezeStrength * 0.65;
    const minZ = TAJ_DIMS.poolStartZ + 1.5;
    const spanZ = poolLen - 3.0;
    const halfPoolW = poolW * 0.5 - 0.35;

    for (let i = 0; i < floatingCount; i += 1) {
      const seed = floatingSeeds[i];
      const wrappedZ = minZ + (((seed.z0 - minZ + elapsedSec * seed.driftSpeed * breeze) % spanZ) + spanZ) % spanZ;
      // Hide gracefully beneath the central marble viewing platform
      const underPlatform = Math.abs(wrappedZ - 103.5) < 4.7;
      const wx = THREE.MathUtils.clamp(
        seed.x0 + Math.sin(elapsedSec * 0.35 + seed.phase) * seed.swayAmp,
        -halfPoolW,
        halfPoolW,
      );
      const bobY = underPlatform ? -2.0 : 0.185 + Math.sin(elapsedSec * 1.9 + seed.phase) * 0.0022;
      floatDummy.position.set(wx, bobY, wrappedZ);
      floatDummy.rotation.set(
        Math.sin(elapsedSec * 1.6 + seed.phase) * 0.06,
        seed.rot0 + elapsedSec * seed.spinSpeed * breeze,
        Math.cos(elapsedSec * 1.4 + seed.phase) * 0.06,
      );
      floatDummy.scale.set(seed.scale, 1.0, seed.scale * 0.82);
      floatDummy.updateMatrix();
      floatingClutterInst.setMatrixAt(i, floatDummy.matrix);
    }
    floatingClutterInst.instanceMatrix.needsUpdate = true;
  };
  updateFloatingClutter(0, 1.0);

  // =========================================================================
  // STAGE 1B: VOLUMETRIC REALISTIC CYPRESSES, SHADE TREES, SHRUBS & FAR-BANK GROVE
  // =========================================================================
  const treesGroup = new THREE.Group();
  treesGroup.name = 'CharbaghTrees';
  const swayingTrees: SwayingTreeHandle[] = [];

  // Organic gnarled buttress-rooted tree trunk (replaces plain smooth cylinder!)
  const sharedTreeGeos = {
    trunkFlared: trackGeo(createOrganicRootedTrunkGeometry()),
    branchCylinder: trackGeo(new THREE.CylinderGeometry(0.55, 0.96, 1.0, 7)),
    cypressCrowns: [
      trackGeo(createCypressCrownGeometry(201)),
      trackGeo(createCypressCrownGeometry(409)),
      trackGeo(createCypressCrownGeometry(719)),
      trackGeo(createCypressCrownGeometry(977)),
    ],
    deciduousCrowns: [
      trackGeo(createDeciduousCrownGeometry(311)),
      trackGeo(createDeciduousCrownGeometry(613)),
      trackGeo(createDeciduousCrownGeometry(929)),
    ],
    shrubCrown: trackGeo(createShrubCrownGeometry(521)),
    shadowPad: trackGeo(new THREE.PlaneGeometry(1, 1)),
  };

  // Iconic flanking cypress avenues with organic height, asymmetric width/fullness & slight natural lean
  const cypressCountPerRow = 15;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < cypressCountPerRow; i += 1) {
      const z = 41.5 + i * 6.3 + (rand() - 0.5) * 0.28;
      if (Math.abs(z - 54) < 1.9 || Math.abs(z - 78) < 1.9 || Math.abs(z - 103.5) < 4.5) continue;

      const h = 5.35 + (rand() - 0.5) * 1.45 + (i > 9 ? 0.85 : 0);
      const rX = 0.68 + (rand() - 0.5) * 0.18;
      const rZ = rX * (0.86 + rand() * 0.28);
      const x = sx * (poolW * 0.5 + 5.35) + (rand() - 0.5) * 0.22;
      const baseLeanX = (rand() - 0.5) * 0.044;
      const baseLeanZ = (rand() - 0.5) * 0.044;

      const cypress = createRealisticCypressTree(h, rX, rZ, rand, materials, sharedTreeGeos);
      cypress.position.set(x, 0.05, z);
      cypress.rotation.set(baseLeanX, 0, baseLeanZ);
      treesGroup.add(cypress);

      swayingTrees.push({
        group: cypress,
        worldX: x,
        worldZ: z,
        baseScale: 1,
        heightFactor: h / 5.2,
        baseLeanX,
        baseLeanZ,
      });
    }

    // Secondary parallel cypress row further out on the lawns (natural asymmetric height & lean)
    for (let i = 0; i < 8; i += 1) {
      const z = 60 + i * 9.5 + (rand() - 0.5) * 0.45;
      const h = 6.3 + (rand() - 0.5) * 1.65;
      const rX = 0.86 + (rand() - 0.5) * 0.22;
      const rZ = rX * (0.85 + rand() * 0.30);
      const x = sx * 15.6 + (rand() - 0.5) * 0.35;
      const baseLeanX = (rand() - 0.5) * 0.048;
      const baseLeanZ = (rand() - 0.5) * 0.048;

      const cypress = createRealisticCypressTree(h, rX, rZ, rand, materials, sharedTreeGeos);
      cypress.position.set(x, 0.05, z);
      cypress.rotation.set(baseLeanX, 0, baseLeanZ);
      treesGroup.add(cypress);

      swayingTrees.push({
        group: cypress,
        worldX: x,
        worldZ: z,
        baseScale: 1,
        heightFactor: h / 5.2,
        baseLeanX,
        baseLeanZ,
      });
    }
  }

  // Organic matte dark soil/mulch circular ring beds & low groundcover bushes around every Charbagh shade tree trunk!
  const mulchBedMat = new THREE.MeshStandardMaterial({
    color: 0x463628,
    roughness: 0.99,
    metalness: 0.0,
    envMapIntensity: 0.05,
  });
  localMaterials.push(mulchBedMat);
  const mulchBedGeo = trackGeo(new THREE.CylinderGeometry(1.38, 1.78, 0.085, 14));
  const mulchRimGeo = trackGeo(new THREE.TorusGeometry(1.56, 0.065, 6, 16));
  mulchRimGeo.rotateX(Math.PI * 0.5);

  // Mature broad-canopy Mughal Neem/Banyan shade trees in the outer Charbagh gardens
  // (leaving clear sightlines from the riverfront terrace out across the Yamuna River!)
  const gardenShadeSpecs: Array<[number, number, number, number]> = [
    [-29, 90, 10.6, 4.6],
    [34, 86, 10.2, 4.4],
    [-38, 62, 11.0, 4.8],
    [40, 60, 10.8, 4.6],
    [-48, 36, 11.4, 5.1],
    [50, 34, 11.2, 4.9],
    [-58, 12, 11.8, 5.4],
    [60, 14, 11.6, 5.2],
    [-68, 72, 11.8, 5.3],
    [70, 74, 11.6, 5.1],
    [-44, 114, 10.8, 4.7],
    [44, 112, 10.6, 4.6],
    // Lush multi-layered background treeline framing East, West & South Charbagh perimeter walls!
    [-56, 104, 12.2, 5.4],
    [56, 102, 12.0, 5.3],
    [-58, 84, 12.8, 5.6],
    [58, 86, 12.6, 5.5],
    [-58, 52, 12.4, 5.5],
    [58, 50, 12.2, 5.4],
    [-60, 26, 13.0, 5.8],
    [60, 24, 12.8, 5.6],
    [-61, -4, 12.4, 5.6],
    [61, -6, 12.2, 5.4],
    [-74, 96, 13.8, 6.2],
    [74, 94, 13.6, 6.0],
    [-75, 58, 14.2, 6.4],
    [75, 56, 14.0, 6.2],
    [-74, 24, 13.6, 6.1],
    [74, 22, 13.4, 6.0],
    [-74, -14, 12.6, 5.8],
    [74, -14, 12.4, 5.6],
    [-90, -28, 13.0, 6.2],
    [90, -28, 12.8, 6.0],
    [-116, -26, 13.6, 6.5],
    [116, -26, 13.4, 6.4],
    // South perimeter treeline behind the viewer along the Mughal boundary wall
    [-52, 134, 12.4, 5.5],
    [-30, 138, 11.8, 5.2],
    [30, 138, 11.8, 5.2],
    [52, 134, 12.4, 5.5],
  ];

  // Track inner-garden shade trees for lush organic root-hugging ferns & low ornamental bushes
  const groundedShadeBases: Array<{ x: number; z: number; r: number }> = [];

  for (const [tx, tz, th, tr] of gardenShadeSpecs) {
    const shadeTree = createRealisticDeciduousTree(th, tr, rand, materials, sharedTreeGeos);
    const leanX = (rand() - 0.5) * 0.032;
    const leanZ = (rand() - 0.5) * 0.032;
    shadeTree.position.set(tx, 0, tz);
    shadeTree.rotation.set(leanX, 0, leanZ);
    treesGroup.add(shadeTree);

    // Organic dark soil/mulch ring bed grounding every shade tree trunk inside the Charbagh perimeter
    if (Math.abs(tx) < 64 && tz > -20 && tz < 142) {
      const bedScale = 0.78 + (tr / 5.0) * 0.42;
      const mulchBed = new THREE.Mesh(mulchBedGeo, mulchBedMat);
      mulchBed.position.set(tx, 0.038, tz);
      mulchBed.scale.set(bedScale, 1.0, bedScale * (0.92 + rand() * 0.16));
      mulchBed.rotation.y = rand() * Math.PI * 2;
      mulchBed.receiveShadow = true;
      treesGroup.add(mulchBed);

      const rim = new THREE.Mesh(mulchRimGeo, materials.sandstoneDark);
      rim.position.set(tx, 0.055, tz);
      rim.scale.set(bedScale, 0.85, bedScale);
      rim.receiveShadow = true;
      treesGroup.add(rim);

      // 2-3 soft low ornamental groundcover bushes hugging the flared buttress roots
      const baseBushes = Math.abs(tx) < 52 ? 3 : 2;
      for (let gb = 0; gb < baseBushes; gb += 1) {
        const ang = (gb / baseBushes) * Math.PI * 2 + rand() * 0.9;
        const dist = 0.88 * bedScale + rand() * 0.48;
        const bRadius = 0.62 + rand() * 0.42;
        const lowBush = new THREE.Mesh(sharedTreeGeos.shrubCrown, materials.shrubLeafCluster);
        lowBush.position.set(tx + Math.cos(ang) * dist, 0.03, tz + Math.sin(ang) * dist);
        lowBush.scale.set(bRadius * 1.12, bRadius * 0.66, bRadius * 1.12);
        lowBush.rotation.y = rand() * Math.PI * 2;
        lowBush.castShadow = true;
        lowBush.receiveShadow = true;
        treesGroup.add(lowBush);
      }

      groundedShadeBases.push({ x: tx, z: tz, r: bedScale });
    }

    swayingTrees.push({
      group: shadeTree,
      worldX: tx,
      worldZ: tz,
      baseScale: 1,
      heightFactor: 0.62,
      baseLeanX: leanX,
      baseLeanZ: leanZ,
    });
  }

  // Framing tall background cypress silhouettes lining the outer East/West Charbagh boundary walls
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 9; i += 1) {
      const bz = 14 + i * 14.5 + (rand() - 0.5) * 2.2;
      if (Math.abs(bz - 78) < 9.5) continue; // keep side garden pavilion clear
      const bx = sx * (61.8 + (rand() - 0.5) * 1.8);
      const bh = 8.4 + rand() * 2.8;
      const br = 0.96 + rand() * 0.28;
      const bgCyp = createRealisticCypressTree(bh, br, br * 0.95, rand, materials, sharedTreeGeos);
      bgCyp.position.set(bx, 0.04, bz);
      treesGroup.add(bgCyp);
    }
  }

  // Historic Agra red sandstone Mughal Charbagh perimeter walls, side garden pavilions & South Great Gate
  const perimeterWalls = buildCharbaghPerimeterWalls(materials, trackGeo);
  root.add(perimeterWalls);

  // Lush Mehtab Bagh riverside woodland clustered naturally along the far Northern bank of the Yamuna
  const farBankSpecs: Array<[number, number, number, number]> = [
    [-162, -182, 13.8, 6.6],
    [-144, -175, 11.4, 5.4],
    [-132, -196, 15.2, 7.2],
    [-108, -178, 12.6, 5.8],
    [-95, -188, 14.4, 6.9],
    [-82, -174, 10.6, 4.9],
    [-58, -184, 13.8, 6.5],
    [-44, -175, 11.2, 5.2],
    [-36, -204, 15.0, 7.1],
    [-12, -179, 12.8, 6.0],
    [2, -192, 14.6, 6.9],
    [16, -175, 10.8, 5.0],
    [34, -186, 13.4, 6.4],
    [48, -176, 11.8, 5.5],
    [66, -198, 15.4, 7.4],
    [78, -178, 12.2, 5.7],
    [98, -184, 14.0, 6.6],
    [118, -176, 11.6, 5.4],
    [136, -194, 14.8, 7.0],
    [154, -180, 13.2, 6.2],
  ];

  for (const [tx, tz, th, tr] of farBankSpecs) {
    const bankTree = createRealisticDeciduousTree(th, tr, rand, materials, sharedTreeGeos);
    const leanX = (rand() - 0.5) * 0.028;
    const leanZ = (rand() - 0.5) * 0.028;
    bankTree.position.set(tx, 0.35, tz);
    bankTree.rotation.set(leanX, 0, leanZ);
    treesGroup.add(bankTree);

    swayingTrees.push({
      group: bankTree,
      worldX: tx,
      worldZ: tz,
      baseScale: 1,
      heightFactor: 0.55,
      baseLeanX: leanX,
      baseLeanZ: leanZ,
    });
  }

  // =========================================================================
  // RICHER MUGHAL GARDEN VEGETATION: FLOWERING SHRUBS (HIBISCUS, BOUGAINVILLEA,
  // MUGHAL ROSES), DENSER MARIGOLD & JASMINE BORDERS, AND ORNAMENTAL FERNS
  // =========================================================================
  type ShrubKind = 'hibiscus' | 'bougainvillea' | 'rose' | 'ornamental';
  const shrubSpecs: Array<{ x: number; z: number; r: number; kind: ShrubKind }> = [];
  const shrubPalette: ShrubKind[] = ['hibiscus', 'bougainvillea', 'rose', 'ornamental'];

  for (const sx of [-1, 1]) {
    // Rich flowering Mughal shrubs dotting both inner & outer Charbagh parterre lawns
    for (let i = 0; i < 14; i += 1) {
      const sz = 43.0 + i * 5.75 + (rand() - 0.5) * 0.9;
      if (Math.abs(sz - 54) < 2.2 || Math.abs(sz - 78) < 2.2 || Math.abs(sz - 103.5) < 4.5) continue;
      const lane = i % 3;
      const rx = lane === 0 ? 11.4 + rand() * 1.4 : lane === 1 ? 19.6 + rand() * 1.6 : 15.8 + rand() * 1.8;
      shrubSpecs.push({
        x: sx * rx,
        z: sz,
        r: 0.92 + rand() * 0.55,
        kind: shrubPalette[i % shrubPalette.length],
      });
    }
    // Lush flowering bougainvillea & hibiscus shrubs anchoring the terrace apron edge
    shrubSpecs.push({ x: sx * 19.5, z: 39.4, r: 1.38, kind: 'bougainvillea' });
    shrubSpecs.push({ x: sx * 27.5, z: 39.2, r: 1.48, kind: 'hibiscus' });
    shrubSpecs.push({ x: sx * 35.5, z: 39.4, r: 1.32, kind: 'rose' });
    // Corner flowering bushes framing the central viewing platform & walkway intersections
    shrubSpecs.push({ x: sx * 10.6, z: 98.4, r: 0.96, kind: 'rose' });
    shrubSpecs.push({ x: sx * 10.6, z: 108.2, r: 1.02, kind: 'hibiscus' });
    shrubSpecs.push({ x: sx * 10.8, z: 73.2, r: 0.94, kind: 'bougainvillea' });
    shrubSpecs.push({ x: sx * 10.8, z: 82.8, r: 0.98, kind: 'rose' });
  }

  const blossomPlacements: Array<{ x: number; y: number; z: number; s: number; col: [number, number, number] }> = [];

  for (const spec of shrubSpecs) {
    const shrub = new THREE.Group();
    const shadow = new THREE.Mesh(sharedTreeGeos.shadowPad, materials.contactShadow);
    shadow.rotation.x = -Math.PI * 0.5;
    shadow.position.y = 0.035;
    shadow.scale.setScalar(spec.r * 2.45);
    shrub.add(shadow);

    // Multi-layered bush (primary leafy crown + offset secondary lobe for organic shrub fullness)
    const bush = new THREE.Mesh(sharedTreeGeos.shrubCrown, materials.shrubLeafCluster);
    bush.scale.set(spec.r * 1.05, spec.r * 0.88, spec.r * 1.05);
    bush.rotation.y = rand() * Math.PI * 2;
    bush.castShadow = true;
    bush.receiveShadow = true;
    shrub.add(bush);

    const subBush = new THREE.Mesh(sharedTreeGeos.shrubCrown, materials.shrubLeafCluster);
    const subA = rand() * Math.PI * 2;
    subBush.scale.set(spec.r * 0.72, spec.r * 0.64, spec.r * 0.72);
    subBush.position.set(Math.cos(subA) * spec.r * 0.36, 0.0, Math.sin(subA) * spec.r * 0.36);
    subBush.rotation.y = rand() * Math.PI * 2;
    subBush.castShadow = true;
    shrub.add(subBush);

    shrub.position.set(spec.x, 0.04, spec.z);
    treesGroup.add(shrub);

    // Scatter vibrant 3D blossom clusters across the outer crown of flowering Mughal shrubs
    if (spec.kind !== 'ornamental') {
      const bloomsPerBush = tier === 'desktop' ? 16 : 10;
      for (let b = 0; b < bloomsPerBush; b += 1) {
        const theta = rand() * Math.PI * 2;
        const elev = 0.28 + rand() * 0.65;
        const rad = spec.r * (0.52 + rand() * 0.42) * Math.sin(elev * Math.PI * 0.85);
        const bx = spec.x + Math.cos(theta) * rad;
        const by = 0.08 + elev * spec.r * 0.78;
        const bz = spec.z + Math.sin(theta) * rad;

        let col: [number, number, number];
        if (spec.kind === 'hibiscus') {
          col = [0.94, 0.22 + rand() * 0.14, 0.24 + rand() * 0.10]; // tropical crimson-coral hibiscus
        } else if (spec.kind === 'bougainvillea') {
          col = [0.88 + rand() * 0.10, 0.16 + rand() * 0.12, 0.56 + rand() * 0.18]; // vibrant magenta-fuchsia bougainvillea
        } else {
          // Mughal rose: soft blush-pink to deep damask rose
          const isBlush = rand() > 0.45;
          col = isBlush
            ? [0.95, 0.58 + rand() * 0.14, 0.66 + rand() * 0.10]
            : [0.84, 0.18 + rand() * 0.12, 0.30 + rand() * 0.10];
        }
        blossomPlacements.push({ x: bx, y: by, z: bz, s: 1.05 + rand() * 0.72, col });
      }
    }
  }

  // Denser Mughal marigold & creamy white jasmine flower beds lining both sandstone walkway borders
  const flowerCardGeo = trackGeo(new THREE.PlaneGeometry(1.36, 0.78));
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 42; i += 1) {
      const fz = 41.2 + i * 2.02 + (rand() - 0.5) * 0.35;
      if (fz > 119.5) break;
      if (Math.abs(fz - 54) < 2.05 || Math.abs(fz - 78) < 2.05 || Math.abs(fz - 103.5) < 4.55) continue;
      const fx = sx * (poolW * 0.5 + 5.65) + (rand() - 0.5) * 1.15;
      const tuft = new THREE.Group();
      for (let k = 0; k < 3; k += 1) {
        const card = new THREE.Mesh(flowerCardGeo, materials.flowerBorder);
        card.rotation.y = (k / 3) * Math.PI + rand() * 0.5;
        card.position.y = 0.31;
        tuft.add(card);
      }
      tuft.position.set(fx, 0.045, fz);
      treesGroup.add(tuft);

      // Add crisp 3D marigold gold-orange & jasmine ivory-white blossom clusters atop each flower bed clump
      const borderBlooms = tier === 'desktop' ? 5 : 3;
      for (let b = 0; b < borderBlooms; b += 1) {
        const isJasmine = (i + b) % 3 === 0;
        blossomPlacements.push({
          x: fx + (rand() - 0.5) * 0.76,
          y: 0.24 + rand() * 0.34,
          z: fz + (rand() - 0.5) * 0.76,
          s: isJasmine ? 0.78 + rand() * 0.36 : 0.96 + rand() * 0.48,
          col: isJasmine
            ? [0.98, 0.96, 0.88] // fragrant creamy-white Mughal jasmine
            : [0.98, 0.58 + rand() * 0.22, 0.09], // vibrant Indian marigold orange-gold
        });
      }
    }
  }

  // Render all 3D flowering blossoms in one crisp GPU InstancedMesh
  if (blossomPlacements.length > 0) {
    const blossomGeo = trackGeo(createBlossomClusterGeometry());
    const blossomInst = new THREE.InstancedMesh(blossomGeo, materials.blossomCluster, blossomPlacements.length);
    const bCol = new THREE.Color();
    for (let i = 0; i < blossomPlacements.length; i += 1) {
      const bp = blossomPlacements[i];
      dummy.position.set(bp.x, bp.y, bp.z);
      dummy.rotation.set(
        (rand() - 0.5) * 0.65,
        rand() * Math.PI * 2,
        (rand() - 0.5) * 0.65,
      );
      dummy.scale.setScalar(bp.s);
      dummy.updateMatrix();
      blossomInst.setMatrixAt(i, dummy.matrix);
      bCol.setRGB(bp.col[0], bp.col[1], bp.col[2]);
      blossomInst.setColorAt(i, bCol);
    }
    blossomInst.instanceMatrix.needsUpdate = true;
    if (blossomInst.instanceColor) blossomInst.instanceColor.needsUpdate = true;
    blossomInst.computeBoundingSphere();
    treesGroup.add(blossomInst);
    nonReflectedObjects.push(blossomInst);
  }

  // Soft low ornamental ferns & lush groundcover tucked naturally around cypress bases, hedge corners & shade roots
  {
    const fernGeo = trackGeo(createOrnamentalFernGeometry());
    const fernPositions: Array<{ x: number; z: number; s: number }> = [];

    // Tuck 2-3 lush ferns around every inner cypress tree base & hedge corner
    for (const item of swayingTrees) {
      if (item.worldZ < 36 || item.worldZ > 122 || Math.abs(item.worldX) > 26) continue;
      const aroundCount = tier === 'desktop' ? 3 : 2;
      for (let f = 0; f < aroundCount; f += 1) {
        const a = rand() * Math.PI * 2;
        const dist = 0.55 + rand() * 0.58;
        fernPositions.push({
          x: item.worldX + Math.cos(a) * dist,
          z: item.worldZ + Math.sin(a) * dist,
          s: 0.78 + rand() * 0.58,
        });
      }
    }
    // Tuck 4-5 lush arching ferns around the soil/mulch ring base of every Charbagh shade tree trunk!
    for (const base of groundedShadeBases) {
      const fCount = tier === 'desktop' ? 5 : 3;
      for (let f = 0; f < fCount; f += 1) {
        const a = (f / fCount) * Math.PI * 2 + rand() * 0.65;
        const dist = 0.72 * base.r + rand() * 0.78 * base.r;
        fernPositions.push({
          x: base.x + Math.cos(a) * dist,
          z: base.z + Math.sin(a) * dist,
          s: 1.05 + rand() * 0.62,
        });
      }
    }
    // Additional soft ornamental ferns nestled along hedge corners & shady lawn margins
    for (const sx of [-1, 1]) {
      for (const fz of [51.2, 56.8, 75.2, 80.8, 100.2, 105.8, 63.0, 88.0, 96.5, 111.0]) {
        fernPositions.push({
          x: sx * (9.95 + rand() * 1.1),
          z: fz + (rand() - 0.5) * 0.6,
          s: 0.85 + rand() * 0.55,
        });
      }
    }

    const fernInst = new THREE.InstancedMesh(fernGeo, materials.grassBlade, fernPositions.length);
    fernInst.receiveShadow = true;
    const fCol = new THREE.Color();
    for (let i = 0; i < fernPositions.length; i += 1) {
      const fp = fernPositions[i];
      dummy.position.set(fp.x, 0.055, fp.z);
      dummy.rotation.set((rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12);
      dummy.scale.set(fp.s, fp.s * (0.85 + rand() * 0.35), fp.s);
      dummy.updateMatrix();
      fernInst.setMatrixAt(i, dummy.matrix);
      const tone = 0.64 + rand() * 0.28;
      fCol.setRGB(tone * 0.68, tone * 0.96, tone * 0.58); // lush deep botanical fern green
      fernInst.setColorAt(i, fCol);
    }
    fernInst.instanceMatrix.needsUpdate = true;
    if (fernInst.instanceColor) fernInst.instanceColor.needsUpdate = true;
    fernInst.computeBoundingSphere();
    treesGroup.add(fernInst);
    nonReflectedObjects.push(fernInst);
  }

  root.add(terraceAndPoolGroup, treesGroup);

  return {
    root,
    terraceAndPoolGroup,
    treesGroup,
    waterSurface,
    swayingTrees,
    nonReflectedObjects,
    updateFloatingClutter,
    dispose: () => {
      for (const geo of geometries) {
        geo.dispose();
      }
      for (const mat of localMaterials) {
        mat.dispose();
      }
    },
  };
}
