import * as THREE from 'three';
import { TAJ_DIMS } from '../config';
import type { TajMaterialLibrary } from '../materials';

export interface SwayingTreeHandle {
  group: THREE.Group;
  worldX: number;
  worldZ: number;
  baseScale: number;
  heightFactor: number;
}

export interface GardenEnvironmentHandles {
  root: THREE.Group;
  terraceAndPoolGroup: THREE.Group;
  treesGroup: THREE.Group;
  swayingTrees: SwayingTreeHandle[];
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

/** Generate a realistic volumetric clipped Indian cypress foliage crown (normalized height ~1.0, radius ~1.0). */
function createCypressCrownGeometry(seed: number): THREE.BufferGeometry {
  const rand = seededRand(seed);
  const cards: CardPlacement[] = [];

  // 6 vertical criss-crossing feathery sprig curtains forming a dense velvety silhouette
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI + (rand() - 0.5) * 0.14;
    cards.push({
      pos: new THREE.Vector3((rand() - 0.5) * 0.14, 0.52, (rand() - 0.5) * 0.14),
      rot: new THREE.Euler((rand() - 0.5) * 0.08, angle, (rand() - 0.5) * 0.08),
      width: 2.15 + (rand() - 0.5) * 0.25,
      height: 1.04,
      ao: 0.94,
    });
  }

  // 14 radiating upward-tilted conifer needle boughs stacked along the height for thick 3D body
  const tiers = 5;
  for (let t = 0; t < tiers; t += 1) {
    const frac = (t + 0.4) / tiers;
    const profileR = Math.sin(Math.pow(frac, 0.68) * Math.PI) * 0.78 + 0.18;
    const count = t === tiers - 1 ? 2 : 3;
    for (let k = 0; k < count; k += 1) {
      const a = (k / count) * Math.PI * 2 + t * 1.15 + rand() * 0.35;
      cards.push({
        pos: new THREE.Vector3(Math.cos(a) * profileR * 0.32, 0.14 + frac * 0.76, Math.sin(a) * profileR * 0.32),
        rot: new THREE.Euler(0.45 + (rand() - 0.5) * 0.28, a, (rand() - 0.5) * 0.32),
        width: profileR * 1.85,
        height: 0.38 + (1 - frac) * 0.16,
        ao: 0.85 + frac * 0.18,
      });
    }
  }

  return buildVolumetricFoliageGeometry(
    cards,
    0.5,
    1.15,
    new THREE.Color('#c8d9b2'),
    new THREE.Color('#6c8058'),
  );
}

/** Generate a rich 28-branchlet 3D deciduous shade tree crown (normalized radius ~1.0 centered at y = 0). */
function createDeciduousCrownGeometry(seed: number): THREE.BufferGeometry {
  const rand = seededRand(seed);
  const cards: CardPlacement[] = [];

  // 6 deeply shaded interior foliage clusters so no hollow gaps appear inside the canopy
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.4;
    cards.push({
      pos: new THREE.Vector3(Math.cos(a) * 0.26, (rand() - 0.4) * 0.25, Math.sin(a) * 0.26),
      rot: new THREE.Euler((rand() - 0.5) * 1.1, a + rand() * 1.5, (rand() - 0.5) * 0.8),
      width: 1.05 + rand() * 0.28,
      height: 0.92 + rand() * 0.24,
      ao: 0.68,
    });
  }

  // 22 outer billowing leafy branchlet clouds arranged on an asymmetric natural canopy dome
  for (let i = 0; i < 22; i += 1) {
    const goldenAngle = i * 2.39996 + rand() * 0.25;
    const t = (i + 0.5) / 22;
    const elev = -0.34 + t * 1.12; // fuller upper crown, slightly flatter shaded underside
    const ringR = Math.sqrt(Math.max(0.08, 1 - Math.pow(elev * 0.85, 2))) * (0.64 + rand() * 0.34);
    const px = Math.cos(goldenAngle) * ringR;
    const py = elev * 0.72 + (rand() - 0.5) * 0.14;
    const pz = Math.sin(goldenAngle) * ringR;

    const cardW = 0.86 + rand() * 0.44;
    const cardH = cardW * (0.82 + rand() * 0.26);
    cards.push({
      pos: new THREE.Vector3(px, py, pz),
      rot: new THREE.Euler(
        (rand() - 0.5) * 0.95 + elev * 0.35,
        goldenAngle + (rand() - 0.5) * 1.4,
        (rand() - 0.5) * 0.75,
      ),
      width: cardW,
      height: cardH,
      ao: 0.88 + Math.max(0, elev) * 0.16,
    });
  }

  return buildVolumetricFoliageGeometry(
    cards,
    0.05,
    1.15,
    new THREE.Color('#eef5dc'),
    new THREE.Color('#788d64'),
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
    new THREE.Color('#dfecc8'),
    new THREE.Color('#6f8558'),
  );
}

/** Create a lifelike clipped cypress tree with bark stem, inner conifer core, and volumetric sprig crown. */
function createRealisticCypressTree(
  height: number,
  radius: number,
  rand: () => number,
  materials: TajMaterialLibrary,
  sharedGeos: {
    trunkFlared: THREE.BufferGeometry;
    cypressCore: THREE.BufferGeometry;
    cypressCrowns: THREE.BufferGeometry[];
    shadowPad: THREE.BufferGeometry;
  },
): THREE.Group {
  const tree = new THREE.Group();

  const shadow = new THREE.Mesh(sharedGeos.shadowPad, materials.contactShadow);
  shadow.rotation.x = -Math.PI * 0.5;
  shadow.position.y = 0.035;
  shadow.scale.setScalar(radius * 3.1);
  tree.add(shadow);

  // Textured bark stem at base
  const trunk = new THREE.Mesh(sharedGeos.trunkFlared, materials.bark);
  trunk.scale.set(radius * 0.26, height * 0.19, radius * 0.26);
  trunk.castShadow = true;
  tree.add(trunk);

  // Dark dense shaded inner conifer body
  const foliageStart = height * 0.13;
  const foliageH = height * 0.86;
  const core = new THREE.Mesh(sharedGeos.cypressCore, materials.cypressCore);
  core.scale.set(radius * 0.68, foliageH * 0.94, radius * 0.68);
  core.position.y = foliageStart + foliageH * 0.48;
  core.castShadow = true;
  tree.add(core);

  // Volumetric spherical-normal feathery cypress crown
  const crownGeo = sharedGeos.cypressCrowns[Math.floor(rand() * sharedGeos.cypressCrowns.length)];
  const crown = new THREE.Mesh(crownGeo, materials.cypressSprig);
  crown.scale.set(radius, foliageH, radius);
  crown.position.y = foliageStart;
  crown.rotation.y = rand() * Math.PI * 2;
  crown.castShadow = true;
  crown.receiveShadow = true;
  tree.add(crown);

  return tree;
}

/** Create a lifelike broad-canopy Mughal Neem/shade tree with flared trunk, forked boughs, and volumetric leafy crown. */
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

  // 4 organic spreading primary boughs + forked secondary limbs reaching into the crown
  const boughCount = 4;
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

export function buildGardenEnvironment(materials: TajMaterialLibrary): GardenEnvironmentHandles {
  const geometries: THREE.BufferGeometry[] = [];
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

  // Ceremonial front marble staircase ascending smoothly from terrace onto the main white marble plinth
  const stepCount = 14;
  const totalRise = TAJ_DIMS.plinthTopY - TAJ_DIMS.sandstoneTerraceH;
  const stairDepth = 5.2;
  for (let s = 0; s < stepCount; s += 1) {
    const frac = (s + 1) / stepCount;
    const stepH = totalRise / stepCount;
    const stepD = stairDepth * (1 - s / stepCount);
    const step = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(11.4, stepH + 0.04, stepD)), materials.marbleTrim);
    step.position.set(0, TAJ_DIMS.sandstoneTerraceH + frac * totalRise - stepH * 0.5, TAJ_DIMS.plinthD * 0.5 + stepD * 0.5);
    step.receiveShadow = true;
    step.castShadow = true;
    terraceAndPoolGroup.add(step);
  }

  // Sculpted marble stair cheek-walls & corner bollards framing the ceremonial steps
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.65, totalRise * 0.55, stairDepth + 0.6)), materials.marbleMain);
    cheek.position.set(sx * 6.02, TAJ_DIMS.sandstoneTerraceH + totalRise * 0.28, TAJ_DIMS.plinthD * 0.5 + stairDepth * 0.5);
    cheek.castShadow = true;
    cheek.receiveShadow = true;
    terraceAndPoolGroup.add(cheek);

    const newel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.86, 1.15, 0.86)), materials.marbleTrim);
    newel.position.set(sx * 6.02, TAJ_DIMS.sandstoneTerraceH + 0.58, TAJ_DIMS.plinthD * 0.5 + stairDepth + 0.25);
    newel.castShadow = true;
    terraceAndPoolGroup.add(newel);
  }

  // Soft contact shadow directly beneath the white marble plinth resting on the red sandstone terrace
  const plinthShadow = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(72, 72)), materials.contactShadow);
  plinthShadow.rotation.x = -Math.PI * 0.5;
  plinthShadow.position.y = TAJ_DIMS.sandstoneTerraceH + 0.02;
  terraceAndPoolGroup.add(plinthShadow);

  // Front red sandstone apron promenade
  const apron = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(130, 0.08, 12)), materials.sandstone);
  apron.position.set(0, 0.04, 38.5);
  apron.receiveShadow = true;
  terraceAndPoolGroup.add(apron);

  // Central reflecting pool channel extending from the terrace toward the viewer (+Z)
  const poolLen = TAJ_DIMS.poolLength;
  const poolW = TAJ_DIMS.poolWidth;
  const poolCenterZ = TAJ_DIMS.poolStartZ + poolLen * 0.5;

  // World-proportioned Agra red sandstone flagstone promenades with crisp inlaid white marble border strips
  const walkwayGeo = trackGeo(new THREE.BoxGeometry(4.4, 0.06, poolLen + 4));
  const marbleInlayLongGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.075, poolLen + 3.6));
  const marbleInlayCrossGeo = trackGeo(new THREE.BoxGeometry(4.2, 0.075, 0.14));
  const redCurbGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.14, poolLen + 4));

  for (const sx of [-1, 1]) {
    const walkX = sx * (poolW * 0.5 + 2.55);
    const walk = new THREE.Mesh(walkwayGeo, materials.walkwaySandstone);
    walk.position.set(walkX, 0.03, poolCenterZ);
    walk.receiveShadow = true;
    terraceAndPoolGroup.add(walk);

    // Authentic Mughal inlaid white Makrana marble geometric strips running along the sandstone walkways
    for (const offX of [-1.85, 1.85]) {
      const strip = new THREE.Mesh(marbleInlayLongGeo, materials.marbleTrim);
      strip.position.set(walkX + offX, 0.036, poolCenterZ);
      strip.receiveShadow = true;
      terraceAndPoolGroup.add(strip);
    }
    for (let rz = TAJ_DIMS.poolStartZ + 4; rz < TAJ_DIMS.poolStartZ + poolLen - 2; rz += 6.2) {
      const crossStrip = new THREE.Mesh(marbleInlayCrossGeo, materials.marbleTrim);
      crossStrip.position.set(walkX, 0.036, rz);
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

  // White Makrana marble coping curbs framing the reflecting pool
  const curbLongGeo = trackGeo(new THREE.BoxGeometry(0.52, 0.3, poolLen + 1.0));
  for (const sx of [-1, 1]) {
    const curb = new THREE.Mesh(curbLongGeo, materials.marbleTrim);
    curb.position.set(sx * (poolW * 0.5 + 0.26), 0.15, poolCenterZ);
    curb.castShadow = true;
    curb.receiveShadow = true;
    terraceAndPoolGroup.add(curb);
  }

  const curbEndGeo = trackGeo(new THREE.BoxGeometry(poolW + 1.04, 0.3, 0.52));
  for (const ez of [TAJ_DIMS.poolStartZ - 0.26, TAJ_DIMS.poolStartZ + poolLen + 0.26]) {
    const endCurb = new THREE.Mesh(curbEndGeo, materials.marbleTrim);
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

  const pedestalInst = new THREE.InstancedMesh(pedestalGeo, materials.marbleTrim, fountainCount);
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
  // STAGE 1B: VOLUMETRIC REALISTIC CYPRESSES, SHADE TREES, SHRUBS & FAR-BANK GROVE
  // =========================================================================
  const treesGroup = new THREE.Group();
  treesGroup.name = 'CharbaghTrees';
  const swayingTrees: SwayingTreeHandle[] = [];

  // Root-flared organic tree trunk profile (LatheGeometry, y from 0 to 1)
  const trunkProfile = [
    new THREE.Vector2(1.42, 0.0),
    new THREE.Vector2(1.12, 0.14),
    new THREE.Vector2(0.95, 0.45),
    new THREE.Vector2(0.84, 0.78),
    new THREE.Vector2(0.72, 1.0),
  ];

  const coreProfile = [
    new THREE.Vector2(0.0, -0.5),
    new THREE.Vector2(0.8, -0.44),
    new THREE.Vector2(1.0, -0.18),
    new THREE.Vector2(0.92, 0.16),
    new THREE.Vector2(0.68, 0.39),
    new THREE.Vector2(0.28, 0.47),
    new THREE.Vector2(0.0, 0.5),
  ];

  const sharedTreeGeos = {
    trunkFlared: trackGeo(new THREE.LatheGeometry(trunkProfile, 10)),
    branchCylinder: trackGeo(new THREE.CylinderGeometry(0.58, 0.96, 1.0, 7)),
    cypressCore: trackGeo(new THREE.LatheGeometry(coreProfile, 12)),
    cypressCrowns: [
      trackGeo(createCypressCrownGeometry(201)),
      trackGeo(createCypressCrownGeometry(409)),
      trackGeo(createCypressCrownGeometry(719)),
    ],
    deciduousCrowns: [
      trackGeo(createDeciduousCrownGeometry(311)),
      trackGeo(createDeciduousCrownGeometry(613)),
      trackGeo(createDeciduousCrownGeometry(929)),
    ],
    shrubCrown: trackGeo(createShrubCrownGeometry(521)),
    shadowPad: trackGeo(new THREE.PlaneGeometry(1, 1)),
  };

  // Iconic flanking clipped cypress avenues along both sides of the reflecting pool walkway
  const cypressCountPerRow = 15;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < cypressCountPerRow; i += 1) {
      const z = 41.5 + i * 6.3;
      if (Math.abs(z - 54) < 1.9 || Math.abs(z - 78) < 1.9 || Math.abs(z - 103.5) < 4.5) continue;

      const h = 5.4 + (rand() - 0.5) * 0.75 + (i > 9 ? 0.85 : 0);
      const r = 0.72 + (rand() - 0.5) * 0.09;
      const x = sx * (poolW * 0.5 + 5.3);
      const cypress = createRealisticCypressTree(h, r, rand, materials, sharedTreeGeos);
      cypress.position.set(x, 0.05, z);
      treesGroup.add(cypress);

      swayingTrees.push({
        group: cypress,
        worldX: x,
        worldZ: z,
        baseScale: 1,
        heightFactor: h / 5.2,
      });
    }

    // Secondary parallel cypress row further out on the lawns
    for (let i = 0; i < 8; i += 1) {
      const z = 60 + i * 9.5;
      const h = 6.3 + (rand() - 0.5) * 0.9;
      const r = 0.88 + (rand() - 0.5) * 0.11;
      const x = sx * 15.6;
      const cypress = createRealisticCypressTree(h, r, rand, materials, sharedTreeGeos);
      cypress.position.set(x, 0.05, z);
      treesGroup.add(cypress);

      swayingTrees.push({
        group: cypress,
        worldX: x,
        worldZ: z,
        baseScale: 1,
        heightFactor: h / 5.2,
      });
    }
  }

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
    [-70, -14, 12.2, 5.6],
    [72, -14, 12.0, 5.4],
    [-90, -28, 13.0, 6.2],
    [90, -28, 12.8, 6.0],
    [-116, -26, 13.6, 6.5],
    [116, -26, 13.4, 6.4],
    [-68, 72, 11.8, 5.3],
    [70, 74, 11.6, 5.1],
    [-44, 114, 10.8, 4.7],
    [44, 112, 10.6, 4.6],
  ];

  for (const [tx, tz, th, tr] of gardenShadeSpecs) {
    const shadeTree = createRealisticDeciduousTree(th, tr, rand, materials, sharedTreeGeos);
    shadeTree.position.set(tx, 0, tz);
    treesGroup.add(shadeTree);

    swayingTrees.push({
      group: shadeTree,
      worldX: tx,
      worldZ: tz,
      baseScale: 1,
      heightFactor: 0.62,
    });
  }

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
    bankTree.position.set(tx, 0.35, tz);
    treesGroup.add(bankTree);

    swayingTrees.push({
      group: bankTree,
      worldX: tx,
      worldZ: tz,
      baseScale: 1,
      heightFactor: 0.55,
    });
  }

  // Manicured volumetric botanical shrubs lining the lawns & base of the terrace apron
  const shrubSpecs: Array<[number, number, number]> = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 8; i += 1) {
      shrubSpecs.push([sx * (11.2 + (i % 2) * 9.5), 44 + i * 10.5, 1.0 + rand() * 0.4]);
    }
    shrubSpecs.push([sx * 20.5, 39.2, 1.35]);
    shrubSpecs.push([sx * 29.5, 39.2, 1.45]);
    shrubSpecs.push([sx * 36.5, 39.2, 1.3]);
  }

  for (const [sx, sz, sr] of shrubSpecs) {
    const shrub = new THREE.Group();
    const shadow = new THREE.Mesh(sharedTreeGeos.shadowPad, materials.contactShadow);
    shadow.rotation.x = -Math.PI * 0.5;
    shadow.position.y = 0.035;
    shadow.scale.setScalar(sr * 2.4);
    shrub.add(shadow);

    const bush = new THREE.Mesh(sharedTreeGeos.shrubCrown, materials.shrubLeafCluster);
    bush.scale.setScalar(sr);
    bush.rotation.y = rand() * Math.PI * 2;
    bush.castShadow = true;
    bush.receiveShadow = true;
    shrub.add(bush);

    shrub.position.set(sx, 0.04, sz);
    treesGroup.add(shrub);
  }

  // Delicate Mughal rose, marigold & jasmine flowering garden border tufts hugging the lawn curbs & cypress bases
  const flowerCardGeo = trackGeo(new THREE.PlaneGeometry(1.15, 0.68));
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 16; i += 1) {
      const fz = 42.5 + i * 5.8;
      if (Math.abs(fz - 54) < 2.2 || Math.abs(fz - 78) < 2.2 || Math.abs(fz - 103.5) < 4.8) continue;
      const fx = sx * (poolW * 0.5 + 5.65) + (rand() - 0.5) * 0.65;
      const tuft = new THREE.Group();
      for (let k = 0; k < 2; k += 1) {
        const card = new THREE.Mesh(flowerCardGeo, materials.flowerBorder);
        card.rotation.y = k * Math.PI * 0.5 + rand() * 0.4;
        card.position.y = 0.28;
        tuft.add(card);
      }
      tuft.position.set(fx, 0.04, fz);
      treesGroup.add(tuft);
    }
  }

  root.add(terraceAndPoolGroup, treesGroup);

  return {
    root,
    terraceAndPoolGroup,
    treesGroup,
    swayingTrees,
    dispose: () => {
      for (const geo of geometries) {
        geo.dispose();
      }
    },
  };
}
