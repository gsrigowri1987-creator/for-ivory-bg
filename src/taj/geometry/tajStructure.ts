import * as THREE from 'three';
import { TAJ_DIMS } from '../config';
import type { TajMaterialLibrary } from '../materials';

export interface TajStructureHandles {
  root: THREE.Group;
  plinthGroup: THREE.Group;
  mausoleumGroup: THREE.Group;
  minaretGroups: THREE.Group[];
  chhatriGroups: THREE.Group[];
  drumGroup: THREE.Group;
  domeGroup: THREE.Group;
  finialGroup: THREE.Group;
  dispose: () => void;
}

/**
 * Create an extruded wall panel with a crisp recessed Mughal four-centered pointed arch cutout.
 */
function createPointedArchFrameGeometry(
  outerW: number,
  outerH: number,
  archW: number,
  archSpringY: number,
  archPeakY: number,
  depth: number,
): THREE.ExtrudeGeometry {
  const hw = outerW * 0.5;
  const ahw = archW * 0.5;

  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(hw, outerH);
  shape.lineTo(-hw, outerH);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-ahw, 0);
  hole.lineTo(-ahw, archSpringY);
  hole.bezierCurveTo(
    -ahw,
    archSpringY + (archPeakY - archSpringY) * 0.58,
    -ahw * 0.36,
    archPeakY - (archPeakY - archSpringY) * 0.14,
    0,
    archPeakY,
  );
  hole.bezierCurveTo(
    ahw * 0.36,
    archPeakY - (archPeakY - archSpringY) * 0.14,
    ahw,
    archSpringY + (archPeakY - archSpringY) * 0.58,
    ahw,
    archSpringY,
  );
  hole.lineTo(ahw, 0);
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.055,
    bevelSize: 0.045,
    bevelSegments: 2,
    curveSegments: 18,
  });

  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv.setXY(i, (x + hw) / outerW, y / outerH);
  }
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create an authentic bulbous Mughal onion dome via LatheGeometry with optional carved vertical fluting
 * (for chhatri domes) and subtle baked vertical/flute AO vertex colors.
 */
function createOnionDomeGeometry(
  baseRadius: number,
  maxRadius: number,
  height: number,
  radialSegments = 48,
  fluteCount = 0,
): THREE.LatheGeometry {
  const profile: Array<[number, number]> = [
    [baseRadius * 0.99, 0.0],
    [baseRadius * 0.96, 0.045],
    [baseRadius * 1.03, 0.115],
    [maxRadius * 0.96, 0.215],
    [maxRadius * 1.0, 0.335],
    [maxRadius * 0.97, 0.455],
    [maxRadius * 0.88, 0.575],
    [maxRadius * 0.74, 0.685],
    [maxRadius * 0.55, 0.785],
    [maxRadius * 0.34, 0.875],
    [maxRadius * 0.16, 0.94],
    [maxRadius * 0.045, 0.985],
    [0.0, 1.0],
  ];

  const segs = fluteCount > 0 ? Math.max(radialSegments, fluteCount * 4) : radialSegments;
  const points = profile.map(([r, t]) => new THREE.Vector2(r, t * height));
  const geo = new THREE.LatheGeometry(points, segs);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i += 1) {
    let vx = pos.getX(i);
    const vy = pos.getY(i);
    let vz = pos.getZ(i);
    const t = Math.max(0, Math.min(1, vy / Math.max(height, 0.001)));

    let fluteAo = 1.0;
    if (fluteCount > 0) {
      const r = Math.hypot(vx, vz);
      if (r > 0.02) {
        const ang = Math.atan2(vz, vx);
        const envelope = Math.pow(Math.sin(t * Math.PI), 0.72);
        const ribWave = Math.cos(ang * fluteCount);
        const scaleR = 1.0 + 0.036 * ribWave * envelope;
        vx *= scaleR;
        vz *= scaleR;
        pos.setXYZ(i, vx, vy, vz);
        // Subtle crevice AO inside carved flute troughs so ribs catch golden raking sunlight
        fluteAo = 0.91 + 0.09 * (0.5 + 0.5 * ribWave) * envelope + (1 - envelope) * 0.09;
      }
    }

    const neckAo = t < 0.16 ? 0.78 + (t / 0.16) * 0.22 : 0.98 + 0.02 * t;
    const ao = neckAo * fluteAo;
    colors[i * 3] = ao;
    colors[i * 3 + 1] = ao * 0.995;
    colors[i * 3 + 2] = ao * 0.985;
  }

  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Create a chamfered/beveled stone slab centered at (0, 0, 0) so golden sunlight catches crisp rim highlights.
 */
function createBeveledBoxGeometry(
  width: number,
  height: number,
  depth: number,
  bevel = 0.075,
): THREE.ExtrudeGeometry {
  const b = Math.min(bevel, width * 0.22, height * 0.35, depth * 0.22);
  const hw = Math.max(0.02, width * 0.5 - b);
  const hd = Math.max(0.02, depth * 0.5 - b);
  const coreH = Math.max(0.02, height - b * 2);

  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hd);
  shape.lineTo(hw, -hd);
  shape.lineTo(hw, hd);
  shape.lineTo(-hw, hd);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: coreH,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
  });
  geo.rotateX(-Math.PI * 0.5);
  geo.translate(0, -coreH * 0.5, 0);

  // Planar world-scaled UVs for crisp marble/sandstone texture alignment
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = Math.abs(nrm.getY(i));
    if (ny > 0.6) {
      uv.setXY(i, x * 0.08 + 0.5, z * 0.08 + 0.5);
    } else if (Math.abs(nrm.getX(i)) > 0.6) {
      uv.setXY(i, z * 0.08 + 0.5, y * 0.22 + 0.5);
    } else {
      uv.setXY(i, x * 0.08 + 0.5, y * 0.22 + 0.5);
    }
  }
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Merge an array of positioned box/cylinder primitives into a single BufferGeometry. */
function appendGeometryToBuffers(
  src: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  vertOffset: number,
): number {
  const pAttr = src.attributes.position as THREE.BufferAttribute;
  const nAttr = src.attributes.normal as THREE.BufferAttribute;
  const uvAttr = src.attributes.uv as THREE.BufferAttribute | undefined;
  const normMat = new THREE.Matrix3().getNormalMatrix(matrix);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < pAttr.count; i += 1) {
    v.fromBufferAttribute(pAttr, i).applyMatrix4(matrix);
    n.fromBufferAttribute(nAttr, i).applyMatrix3(normMat).normalize();
    positions.push(v.x, v.y, v.z);
    normals.push(n.x, n.y, n.z);
    if (uvAttr) {
      uvs.push(uvAttr.getX(i), uvAttr.getY(i));
    } else {
      uvs.push(v.x * 0.25, v.y * 0.25);
    }
  }

  const idx = src.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 1) {
      indices.push(idx.getX(i) + vertOffset);
    }
  } else {
    for (let i = 0; i < pAttr.count; i += 1) {
      indices.push(i + vertOffset);
    }
  }
  return vertOffset + pAttr.count;
}

/**
 * Build physical 3D Mughal Muqarnas (corbelled stalactite honeycomb vaulting) tucked inside
 * the upper vaulted head of each Great Pishtaq iwan.
 * Combines a recessed carved semi-dome marble hood with brick-staggered interlocking honeycomb
 * niches and soft corbelled pendentive facets so the vault reads as one seamless block of
 * deeply carved, warmly shaded Makrana stone rather than harsh stacked horizontal ridges.
 */
function createMuqarnasVaultGeometries(
  archW: number,
  archSpringY: number,
  archPeakY: number,
  depth: number,
): { cellsGeo: THREE.BufferGeometry; ribsGeo: THREE.BufferGeometry } {
  const cPos: number[] = [];
  const cNrm: number[] = [];
  const cUv: number[] = [];
  const cIdx: number[] = [];
  let cOff = 0;

  const rPos: number[] = [];
  const rNrm: number[] = [];
  const rUv: number[] = [];
  const rIdx: number[] = [];
  let rOff = 0;

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitPendentive = new THREE.ConeGeometry(0.56, 1.0, 4);
  const unitNicheArch = new THREE.CylinderGeometry(0.5, 0.56, 1.0, 6, 1, false, 0, Math.PI);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  const vaultH = archPeakY - archSpringY;
  const halfSpan = archW * 0.47;

  // Recessed solid carved semi-dome marble backing shell behind the muqarnas tiers
  // (eliminates hard black gaps and grounds the honeycomb cells inside continuous carved stone)
  const shellGeo = new THREE.SphereGeometry(
    1.0,
    18,
    10,
    0,
    Math.PI,
    0,
    Math.PI * 0.52,
  );
  // Flip normals inward so the concave inner vault catches soft bounced golden light cleanly
  const shIdx = shellGeo.index;
  if (shIdx) {
    for (let i = 0; i < shIdx.count; i += 3) {
      const a = shIdx.getX(i + 1);
      const b = shIdx.getX(i + 2);
      shIdx.setX(i + 1, b);
      shIdx.setX(i + 2, a);
    }
  }
  shellGeo.computeVertexNormals();
  p.set(0, archSpringY + 0.08, -depth * 0.08);
  euler.set(0, Math.PI, 0, 'YXZ');
  q.setFromEuler(euler);
  s.set(halfSpan * 1.02, vaultH * 1.02, depth * 0.94);
  m.compose(p, q, s);
  cOff = appendGeometryToBuffers(shellGeo, m, cPos, cNrm, cUv, cIdx, cOff);
  shellGeo.dispose();

  // 6 finely graduated corbelled honeycomb tiers climbing smoothly into the pointed crown
  const tiers = [
    { frac: 0.04, count: 9, radiusFrac: 0.94, zFrac: 0.20, cellH: vaultH * 0.21 },
    { frac: 0.22, count: 8, radiusFrac: 0.85, zFrac: 0.34, cellH: vaultH * 0.21 },
    { frac: 0.40, count: 7, radiusFrac: 0.73, zFrac: 0.48, cellH: vaultH * 0.20 },
    { frac: 0.57, count: 5, radiusFrac: 0.57, zFrac: 0.62, cellH: vaultH * 0.19 },
    { frac: 0.73, count: 3, radiusFrac: 0.37, zFrac: 0.76, cellH: vaultH * 0.17 },
    { frac: 0.88, count: 1, radiusFrac: 0.15, zFrac: 0.87, cellH: vaultH * 0.14 },
  ];

  for (let t = 0; t < tiers.length; t += 1) {
    const tier = tiers[t];
    const yBase = archSpringY + tier.frac * vaultH;
    const tierSpanR = halfSpan * tier.radiusFrac;
    const zDepthR = depth * (0.86 - tier.zFrac * 0.48);

    for (let i = 0; i < tier.count; i += 1) {
      // Semi-circular arc from left wall (PI) around back (PI/2) to right wall (0)
      const u = tier.count === 1 ? 0.5 : (i + 0.5) / tier.count;
      const theta = Math.PI * (0.07 + u * 0.86);
      const cx = Math.cos(theta) * tierSpanR;
      const cz = -depth * 0.09 - Math.sin(theta) * zDepthR;
      const faceYaw = Math.PI * 0.5 - theta;

      const cellW = Math.max(0.44, ((tierSpanR * Math.PI * 0.88) / Math.max(tier.count, 1)) * 0.90);

      // 1. Deeply carved recessed arched honeycomb cell hood (shaded warm marble vault tone)
      p.set(cx, yBase + tier.cellH * 0.52, cz);
      euler.set(0.28, faceYaw, 0, 'YXZ');
      q.setFromEuler(euler);
      s.set(cellW, tier.cellH * 1.06, 0.30);
      m.compose(p, q, s);
      cOff = appendGeometryToBuffers(unitNicheArch, m, cPos, cNrm, cUv, cIdx, cOff);

      // 2. Soft sculpted stalactite pendentive facet hanging organically between cell arches
      p.set(cx, yBase + tier.cellH * 0.12, cz + Math.sin(theta) * 0.15);
      euler.set(Math.PI, faceYaw + Math.PI * 0.25, 0, 'YXZ');
      q.setFromEuler(euler);
      s.set(cellW * 0.42, tier.cellH * 0.56, 0.24);
      m.compose(p, q, s);
      rOff = appendGeometryToBuffers(unitPendentive, m, rPos, rNrm, rUv, rIdx, rOff);

      // 3. Delicate angled diamond squinch facet bridging consecutive tiers (subtle carved relief, no stark horizontal bars)
      p.set(cx, yBase + tier.cellH * 0.86, cz + Math.sin(theta) * 0.14);
      euler.set(0.32, faceYaw, Math.PI * 0.08 * (i % 2 === 0 ? 1 : -1), 'YXZ');
      q.setFromEuler(euler);
      s.set(cellW * 0.62, 0.065, 0.14);
      m.compose(p, q, s);
      rOff = appendGeometryToBuffers(unitBox, m, rPos, rNrm, rUv, rIdx, rOff);
    }
  }

  unitBox.dispose();
  unitPendentive.dispose();
  unitNicheArch.dispose();

  const cellsGeo = new THREE.BufferGeometry();
  cellsGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
  cellsGeo.setAttribute('normal', new THREE.Float32BufferAttribute(cNrm, 3));
  cellsGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cUv, 2));
  cellsGeo.setIndex(cIdx);
  cellsGeo.computeBoundingSphere();

  const ribsGeo = new THREE.BufferGeometry();
  ribsGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
  ribsGeo.setAttribute('normal', new THREE.Float32BufferAttribute(rNrm, 3));
  ribsGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rUv, 2));
  ribsGeo.setIndex(rIdx);
  ribsGeo.computeBoundingSphere();

  return { cellsGeo, ribsGeo };
}

/**
 * Build physical 3D carved Mughal Jali marble latticework screen (intersecting stone mullions +
 * 45-degree geometric star-diamond filigree) so arched niches cast real micro-shadows.
 */
function createJaliLattice3DGeometry(
  width: number,
  height: number,
  cols: number,
  rows: number,
  barThick = 0.055,
  depth = 0.11,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  const addBar = (x: number, y: number, w: number, h: number, rotZ = 0) => {
    p.set(x, y, 0);
    euler.set(0, 0, rotZ);
    q.setFromEuler(euler);
    s.set(w, h, depth);
    m.compose(p, q, s);
    offset = appendGeometryToBuffers(unitBox, m, positions, normals, uvs, indices, offset);
  };

  // Outer stone frame + recessed inner molding bead
  const frameT = barThick * 1.42;
  addBar(0, height * 0.5 - frameT * 0.5, width, frameT);
  addBar(0, -height * 0.5 + frameT * 0.5, width, frameT);
  addBar(-width * 0.5 + frameT * 0.5, 0, frameT, height);
  addBar(width * 0.5 - frameT * 0.5, 0, frameT, height);

  // Crisp vertical mullions & horizontal transoms
  const cellW = width / cols;
  const cellH = height / rows;
  for (let c = 1; c < cols; c += 1) {
    const x = -width * 0.5 + c * cellW;
    addBar(x, 0, barThick * 0.92, height - frameT);
  }
  for (let r = 1; r < rows; r += 1) {
    const y = -height * 0.5 + r * cellH;
    addBar(0, y, width - frameT, barThick * 0.92);
  }

  // Fine Mughal geometric star-diamond filigree + carved octagonal rosette nodes inside each cell
  const diagLen = Math.hypot(cellW, cellH) * 0.95;
  const diagAngle = Math.atan2(cellH, cellW);
  const fineT = barThick * 0.58;
  const starR = Math.min(cellW, cellH) * 0.24;
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const cx = -width * 0.5 + (c + 0.5) * cellW;
      const cy = -height * 0.5 + (r + 0.5) * cellH;
      addBar(cx, cy, diagLen, fineT, diagAngle);
      addBar(cx, cy, diagLen, fineT, -diagAngle);

      // Carved diamond collar framing the central pierced star opening
      addBar(cx, cy + starR, starR * 1.35, fineT * 0.85, 0);
      addBar(cx, cy - starR, starR * 1.35, fineT * 0.85, 0);
      addBar(cx - starR, cy, fineT * 0.85, starR * 1.35, 0);
      addBar(cx + starR, cy, fineT * 0.85, starR * 1.35, 0);
    }
  }

  unitBox.dispose();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/** Create the carved inverted lotus petal crown that hugs the onion dome apex. */
function createInvertedLotusCap(radius: number, height: number, radialSegments = 28): THREE.LatheGeometry {
  const points = [
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(radius * 0.86, height * 0.22),
    new THREE.Vector2(radius * 0.54, height * 0.52),
    new THREE.Vector2(radius * 0.28, height * 0.8),
    new THREE.Vector2(radius * 0.15, height),
  ];
  const geo = new THREE.LatheGeometry(points, radialSegments);
  geo.computeVertexNormals();
  return geo;
}

/** Create weathered antique Mughal bronze Kalasha finial spire with stacked orbs and crescent moon. */
function createKalashaFinialGroup(
  scale: number,
  material: THREE.Material,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
): THREE.Group {
  const group = new THREE.Group();

  const lathePoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.44, 0.08),
    new THREE.Vector2(0.18, 0.28),
    new THREE.Vector2(0.48, 0.64),
    new THREE.Vector2(0.5, 0.84),
    new THREE.Vector2(0.16, 1.2),
    new THREE.Vector2(0.38, 1.52),
    new THREE.Vector2(0.36, 1.7),
    new THREE.Vector2(0.12, 2.02),
    new THREE.Vector2(0.26, 2.26),
    new THREE.Vector2(0.09, 2.55),
    new THREE.Vector2(0.055, 3.8),
    new THREE.Vector2(0.0, 4.55),
  ].map((p) => p.multiplyScalar(scale));

  const spireMesh = new THREE.Mesh(trackGeo(new THREE.LatheGeometry(lathePoints, 20)), material);
  spireMesh.castShadow = true;
  group.add(spireMesh);

  const crescent = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.36 * scale, 0.058 * scale, 10, 20, Math.PI * 1.25)),
    material,
  );
  crescent.position.y = 3.38 * scale;
  crescent.rotation.z = Math.PI * 0.875;
  crescent.castShadow = true;
  group.add(crescent);

  return group;
}

/** Create a slender Mughal guldasta (decorative corner pinnacle with lotus bud tip). */
function createGuldasta(
  height: number,
  radius: number,
  materials: TajMaterialLibrary,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(radius * 0.82, radius, height, 8)),
    materials.marbleTrim,
  );
  shaft.position.y = height * 0.5;
  shaft.castShadow = true;
  g.add(shaft);

  // Subtle dark ring collar below lotus bud
  const collar = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(radius * 1.15, radius * 1.15, radius * 0.65, 8)),
    materials.darkInlayStone,
  );
  collar.position.y = height - radius * 0.3;
  g.add(collar);

  const bud = new THREE.Mesh(
    trackGeo(createOnionDomeGeometry(radius * 1.18, radius * 1.6, radius * 4.4, 14)),
    materials.marbleDome,
  );
  bud.position.y = height;
  bud.castShadow = true;
  g.add(bud);

  const needle = new THREE.Mesh(
    trackGeo(new THREE.ConeGeometry(radius * 0.25, radius * 4.0, 8)),
    materials.bronzeFinial,
  );
  needle.position.y = height + radius * 4.4 + radius * 2.0;
  g.add(needle);

  return g;
}

/**
 * Build a carved octagonal Mughal Chhatri kiosk with arched spandrels, corbel brackets,
 * flared overhanging eave (chhajja), recessed shadow undercut, onion dome, and antique bronze finial.
 */
function createChhatriPavilion(
  radius: number,
  columnHeight: number,
  domeHeight: number,
  includeBase: boolean,
  materials: TajMaterialLibrary,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
): THREE.Group {
  const group = new THREE.Group();
  let curY = 0;

  if (includeBase) {
    const base = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(radius * 1.14, radius * 1.22, 0.72, 8)),
      materials.marbleTrim,
    );
    base.position.y = 0.36;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const baseDark = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(radius * 1.16, radius * 1.16, 0.1, 8)),
      materials.darkInlayStone,
    );
    baseDark.position.y = 0.72;
    group.add(baseDark);
    curY = 0.74;
  }

  // 8 slender perimeter columns + carved arch spandrel lintels connecting them
  const colGeo = trackGeo(new THREE.CylinderGeometry(radius * 0.082, radius * 0.105, columnHeight, 8));
  const colBaseGeo = trackGeo(new THREE.CylinderGeometry(radius * 0.14, radius * 0.15, 0.22, 8));
  const colRingR = radius * 0.87;
  const sideSpan = 2 * colRingR * Math.sin(Math.PI / 8);
  const archRingGeo = trackGeo(
    createPointedArchFrameGeometry(
      sideSpan + 0.08,
      columnHeight * 0.44,
      sideSpan * 0.74,
      columnHeight * 0.08,
      columnHeight * 0.34,
      radius * 0.14,
    ),
  );

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const cx = Math.cos(angle) * colRingR;
    const cz = Math.sin(angle) * colRingR;

    const col = new THREE.Mesh(colGeo, materials.marbleTrim);
    col.position.set(cx, curY + columnHeight * 0.5, cz);
    col.castShadow = true;
    col.receiveShadow = true;
    group.add(col);

    const plinth = new THREE.Mesh(colBaseGeo, materials.marbleTrim);
    plinth.position.set(cx, curY + 0.11, cz);
    group.add(plinth);

    // Pointed arch spandrel spanning between adjacent columns
    const midAngle = (i / 8) * Math.PI * 2;
    const archSpan = new THREE.Mesh(archRingGeo, materials.marbleMain);
    archSpan.position.set(
      Math.cos(midAngle) * (colRingR * Math.cos(Math.PI / 8) - radius * 0.07),
      curY + columnHeight * 0.56,
      Math.sin(midAngle) * (colRingR * Math.cos(Math.PI / 8) - radius * 0.07),
    );
    archSpan.rotation.y = -midAngle + Math.PI * 0.5;
    archSpan.castShadow = true;
    group.add(archSpan);
  }

  // Deep recessed shadow underside under the chhajja eave (crucial real-life depth cue!)
  const eaveShadow = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(radius * 0.96, radius * 1.18, 0.24, 8)),
    materials.marbleDeepVault,
  );
  eaveShadow.position.y = curY + columnHeight + 0.34;
  group.add(eaveShadow);

  // Flared overhanging stone eave (chhajja)
  const eave = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(radius * 1.06, radius * 1.42, 0.38, 8)),
    materials.marbleTrim,
  );
  eave.position.y = curY + columnHeight + 0.58;
  eave.castShadow = true;
  eave.receiveShadow = true;
  group.add(eave);

  // Octagonal inlaid frieze drum under dome
  const drumH = domeHeight * 0.26;
  const drum = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(radius * 0.88, radius * 0.94, drumH, 16)),
    materials.marbleInlayPanel,
  );
  drum.position.y = curY + columnHeight + 0.76 + drumH * 0.5;
  drum.castShadow = true;
  group.add(drum);

  const drumRing = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(radius * 0.91, radius * 0.91, 0.1, 16)),
    materials.darkInlayStone,
  );
  drumRing.position.y = curY + columnHeight + 0.76 + drumH * 0.85;
  group.add(drumRing);

  // Fluted/ribbed carved Mughal chhatri onion dome (16 sculpted vertical ribs catch golden rim light)
  const domeY = curY + columnHeight + 0.75 + drumH;
  const dome = new THREE.Mesh(
    trackGeo(createOnionDomeGeometry(radius * 0.88, radius * 1.08, domeHeight, 48, 16)),
    materials.marbleDome,
  );
  dome.position.y = domeY;
  dome.castShadow = true;
  dome.receiveShadow = true;
  group.add(dome);

  // Inverted lotus cap + antique bronze finial
  const lotus = new THREE.Mesh(
    trackGeo(createInvertedLotusCap(radius * 0.28, domeHeight * 0.15, 16)),
    materials.marbleTrim,
  );
  lotus.position.y = domeY + domeHeight * 0.935;
  group.add(lotus);

  const finial = createKalashaFinialGroup(radius * 0.2, materials.bronzeFinial, trackGeo);
  finial.position.y = domeY + domeHeight * 1.04;
  group.add(finial);

  return group;
}

export function buildTajMahalStructure(materials: TajMaterialLibrary): TajStructureHandles {
  const geometries: THREE.BufferGeometry[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  const root = new THREE.Group();
  root.name = 'TajMahalRoot';

  // =========================================================================
  // STAGE 2: MAKRANA MARBLE PLINTH WITH 23-ARCH BLIND ARCADE & GROUNDING SHADOW
  // =========================================================================
  const plinthGroup = new THREE.Group();
  plinthGroup.name = 'MarblePlinth';
  plinthGroup.position.y = TAJ_DIMS.plinthBaseY;

  const pW = TAJ_DIMS.plinthW;
  const pH = TAJ_DIMS.plinthH;
  const pD = TAJ_DIMS.plinthD;

  const localMaterials: THREE.Material[] = [];

  // Inner deeply recessed core behind blind arches (pushed back 0.80m for true physical architectural depth)
  const plinthCore = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(pW - 1.62, pH - 0.12, pD - 1.62)),
    materials.marbleShadowRecess,
  );
  plinthCore.position.y = pH * 0.5;
  plinthCore.castShadow = true;
  plinthCore.receiveShadow = true;
  plinthGroup.add(plinthCore);

  // Dark cornice undercut groove directly beneath the overhanging marble terrace deck
  const corniceShadow = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(pW + 0.18, 0.18, pD + 0.18)),
    materials.marbleDeepVault,
  );
  corniceShadow.position.y = pH - 0.34;
  plinthGroup.add(corniceShadow);

  // Top polished checkered Makrana marble terrace deck with chamfered/beveled stone edge catching golden rim light
  const plinthDeck = new THREE.Mesh(
    trackGeo(createBeveledBoxGeometry(pW + 0.66, 0.38, pD + 0.66, 0.085)),
    materials.marbleDeck,
  );
  plinthDeck.position.y = pH - 0.08;
  plinthDeck.castShadow = true;
  plinthDeck.receiveShadow = true;
  plinthGroup.add(plinthDeck);

  // Stepped chamfered marble base skirt resting solidly on the red sandstone terrace
  const plinthSkirt = new THREE.Mesh(
    trackGeo(createBeveledBoxGeometry(pW + 0.58, 0.44, pD + 0.58, 0.075)),
    materials.marbleTrim,
  );
  plinthSkirt.position.y = 0.22;
  plinthSkirt.receiveShadow = true;
  plinthGroup.add(plinthSkirt);

  const plinthBaseLine = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(pW + 0.64, 0.1, pD + 0.64)),
    materials.darkInlayStone,
  );
  plinthBaseLine.position.y = 0.05;
  plinthGroup.add(plinthBaseLine);

  // Soft contact shadow directly on the upper marble deck beneath the central mausoleum
  const mausContact = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(42, 42)), materials.contactShadow);
  mausContact.rotation.x = -Math.PI * 0.5;
  mausContact.position.y = pH + 0.09;
  plinthGroup.add(mausContact);

  // Rhythmic deeply recessed blind-arch arcade along all 4 faces of the plinth (23 niches per side)
  // with physical 0.78m architectural depth, recessed sub-arch lip, and smooth baked top-to-bottom AO gradient!
  const nicheCount = 23;
  const arcadeSpan = pW - 1.2;
  const bayW = arcadeSpan / nicheCount;
  const nicheH = pH - 0.8;
  const nicheDepth = 0.78;
  const nicheFrameGeo = trackGeo(
    createPointedArchFrameGeometry(
      bayW - 0.03,
      nicheH,
      bayW * 0.65,
      nicheH * 0.46,
      nicheH * 0.85,
      nicheDepth,
    ),
  );
  const pilasterGeo = trackGeo(new THREE.BoxGeometry(0.24, pH - 0.46, 0.86));

  // Recessed back panel with smooth baked ambient occlusion gradient (deep slate-shadow arch soffit -> softly lit lower marble)
  const nicheBackGeo = trackGeo(new THREE.PlaneGeometry(bayW * 0.78, nicheH * 0.94, 4, 6));
  {
    const pos = nicheBackGeo.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    const halfW = bayW * 0.39;
    const halfH = nicheH * 0.47;
    const topAoColor = new THREE.Color('#2d3749');    // deep cool-slate soffit occlusion inside arch apex
    const midAoColor = new THREE.Color('#6f7580');    // recessed cool-warm shaded marble mid-wall
    const lowBounceColor = new THREE.Color('#b6aea1'); // soft warm terrace bounce light at lower niche
    const cTmp = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const u = Math.min(1, Math.abs(x) / Math.max(halfW, 0.01)); // 0 at center -> 1 at jamb edges
      const v = Math.max(0, Math.min(1, (y + halfH) / Math.max(halfH * 2, 0.01))); // 0 at bottom -> 1 at top
      // Smooth vertical AO gradient (darkest under arch hood + subtle ground contact shadow at very bottom)
      if (v > 0.48) {
        cTmp.copy(midAoColor).lerp(topAoColor, Math.pow((v - 0.48) / 0.52, 0.85));
      } else {
        cTmp.copy(lowBounceColor).lerp(midAoColor, v / 0.48);
      }
      // Side-jamb crevice occlusion + subtle bottom plinth contact darkening
      const jambAo = 1.0 - Math.pow(u, 1.8) * 0.38;
      const bottomAo = v < 0.14 ? 0.78 + (v / 0.14) * 0.22 : 1.0;
      cTmp.multiplyScalar(jambAo * bottomAo);
      cols[i * 3] = cTmp.r;
      cols[i * 3 + 1] = cTmp.g;
      cols[i * 3 + 2] = cTmp.b;
    }
    nicheBackGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  const plinthAoBackMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
    envMapIntensity: 0.28,
  });
  localMaterials.push(plinthAoBackMat);

  // Subtle recessed inner dado sill ledge inside every blind arch for real carved stonework depth
  const nicheSillGeo = trackGeo(new THREE.BoxGeometry(bayW * 0.66, 0.16, 0.34));

  const arcadeFaces: Array<{ rotY: number; offsetZ: number }> = [
    { rotY: 0, offsetZ: pD * 0.5 - 0.76 },
    { rotY: Math.PI, offsetZ: pD * 0.5 - 0.76 },
    { rotY: Math.PI * 0.5, offsetZ: pW * 0.5 - 0.76 },
    { rotY: -Math.PI * 0.5, offsetZ: pW * 0.5 - 0.76 },
  ];

  const nicheInst = new THREE.InstancedMesh(nicheFrameGeo, materials.marbleMain, nicheCount * 4);
  nicheInst.castShadow = true;
  nicheInst.receiveShadow = true;

  const nicheBackInst = new THREE.InstancedMesh(nicheBackGeo, plinthAoBackMat, nicheCount * 4);
  nicheBackInst.receiveShadow = true;

  const nicheSillInst = new THREE.InstancedMesh(nicheSillGeo, materials.marbleShadowRecess, nicheCount * 4);
  nicheSillInst.receiveShadow = true;

  const pilasterInst = new THREE.InstancedMesh(pilasterGeo, materials.marbleTrim, (nicheCount + 1) * 4);
  pilasterInst.castShadow = true;
  pilasterInst.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let nIdx = 0;
  let pIdx = 0;

  for (const face of arcadeFaces) {
    const faceGroup = new THREE.Object3D();
    faceGroup.rotation.y = face.rotY;
    faceGroup.updateMatrix();

    for (let i = 0; i < nicheCount; i += 1) {
      const lx = -arcadeSpan * 0.5 + (i + 0.5) * bayW;
      dummy.position.set(lx, 0.42, face.offsetZ);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dummy.matrix.premultiply(faceGroup.matrix);
      nicheInst.setMatrixAt(nIdx, dummy.matrix);

      // Gradient AO recessed backing seated deeply inside the arch niche
      dummy.position.set(lx, 0.42 + nicheH * 0.47, face.offsetZ + 0.04);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dummy.matrix.premultiply(faceGroup.matrix);
      nicheBackInst.setMatrixAt(nIdx, dummy.matrix);

      // Carved inner marble bench/sill at the floor of each recessed blind arch
      dummy.position.set(lx, 0.50, face.offsetZ + 0.24);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dummy.matrix.premultiply(faceGroup.matrix);
      nicheSillInst.setMatrixAt(nIdx, dummy.matrix);

      nIdx += 1;
    }

    for (let i = 0; i <= nicheCount; i += 1) {
      const lx = -arcadeSpan * 0.5 + i * bayW;
      dummy.position.set(lx, pH * 0.5, face.offsetZ + 0.39);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dummy.matrix.premultiply(faceGroup.matrix);
      pilasterInst.setMatrixAt(pIdx++, dummy.matrix);
    }
  }
  nicheInst.instanceMatrix.needsUpdate = true;
  nicheInst.computeBoundingSphere();
  nicheBackInst.instanceMatrix.needsUpdate = true;
  nicheBackInst.computeBoundingSphere();
  nicheSillInst.instanceMatrix.needsUpdate = true;
  nicheSillInst.computeBoundingSphere();
  pilasterInst.instanceMatrix.needsUpdate = true;
  pilasterInst.computeBoundingSphere();
  plinthGroup.add(nicheInst, nicheBackInst, nicheSillInst, pilasterInst);

  // Subtle decorative dark stone cornice band running around the top of the plinth
  const plinthDarkBand = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(pW + 0.24, 0.12, pD + 0.24)),
    materials.darkInlayStone,
  );
  plinthDarkBand.position.y = pH - 0.46;
  plinthGroup.add(plinthDarkBand);

  // =========================================================================
  // STAGE 3: CENTRAL MAUSOLEUM, DEEP VAULTED PISHTAQS & MERLON PARAPET
  // =========================================================================
  const mausoleumGroup = new THREE.Group();
  mausoleumGroup.name = 'CentralMausoleum';
  mausoleumGroup.position.y = TAJ_DIMS.plinthTopY;

  const mW = TAJ_DIMS.mausoleumW;
  const mH = TAJ_DIMS.mausoleumH;
  const ch = TAJ_DIMS.mausoleumChamfer;
  const halfW = mW * 0.5;

  // Inner deeply shaded octagonal core (recessed behind all side bays & Pishtaq vaults)
  const coreInset = 2.05;
  const cHalf = halfW - coreInset;
  const cCham = ch - coreInset * 0.45;
  const octShape = new THREE.Shape();
  octShape.moveTo(-cHalf + cCham, -cHalf);
  octShape.lineTo(cHalf - cCham, -cHalf);
  octShape.lineTo(cHalf, -cHalf + cCham);
  octShape.lineTo(cHalf, cHalf - cCham);
  octShape.lineTo(cHalf - cCham, cHalf);
  octShape.lineTo(-cHalf + cCham, cHalf);
  octShape.lineTo(-cHalf, cHalf - cCham);
  octShape.lineTo(-cHalf, -cHalf + cCham);
  octShape.closePath();

  const coreGeo = trackGeo(
    new THREE.ExtrudeGeometry(octShape, {
      depth: mH,
      bevelEnabled: false,
    }),
  );
  coreGeo.rotateX(-Math.PI * 0.5);
  const sanctuaryCore = new THREE.Mesh(coreGeo, materials.marbleShadowRecess);
  sanctuaryCore.castShadow = true;
  sanctuaryCore.receiveShadow = true;
  mausoleumGroup.add(sanctuaryCore);

  // Roof deck slab matching full chamfered octagonal footprint
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-halfW + ch, -halfW);
  roofShape.lineTo(halfW - ch, -halfW);
  roofShape.lineTo(halfW, -halfW + ch);
  roofShape.lineTo(halfW, halfW - ch);
  roofShape.lineTo(halfW - ch, halfW);
  roofShape.lineTo(-halfW + ch, halfW);
  roofShape.lineTo(-halfW, halfW - ch);
  roofShape.lineTo(-halfW, -halfW + ch);
  roofShape.closePath();

  const roofSlabGeo = trackGeo(
    new THREE.ExtrudeGeometry(roofShape, {
      depth: 0.78,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 2,
    }),
  );
  roofSlabGeo.rotateX(-Math.PI * 0.5);
  const roofSlab = new THREE.Mesh(roofSlabGeo, materials.marbleTrim);
  roofSlab.position.y = mH - 0.56;
  roofSlab.castShadow = true;
  roofSlab.receiveShadow = true;
  mausoleumGroup.add(roofSlab);

  // Shared geometries for the 4 identical cardinal facades
  const pishtaqW = TAJ_DIMS.pishtaqW;
  const pishtaqH = TAJ_DIMS.pishtaqH;
  const pishtaqGeo = trackGeo(
    createPointedArchFrameGeometry(
      pishtaqW,
      pishtaqH,
      pishtaqW * 0.67,
      pishtaqH * 0.45,
      pishtaqH * 0.77,
      1.75,
    ),
  );
  const pishtaqSideWallGeo = trackGeo(new THREE.BoxGeometry(1.45, pishtaqH, 2.7));
  const pishtaqCapGeo = trackGeo(createBeveledBoxGeometry(pishtaqW + 0.6, 0.58, 2.58, 0.095));
  const pishtaqDarkFrameGeo = trackGeo(new THREE.BoxGeometry(pishtaqW + 0.22, 0.26, 2.0));
  const pishtaqSplayWallGeo = trackGeo(new THREE.BoxGeometry(2.6, pishtaqH * 0.78, 0.28));
  const vaultBackGeo = trackGeo(new THREE.PlaneGeometry(pishtaqW * 0.68, pishtaqH * 0.78));

  // Physical 3D Muqarnas honeycomb vaulting inside the upper arched head of each Great Pishtaq iwan
  const muqarnas = createMuqarnasVaultGeometries(
    pishtaqW * 0.66,
    pishtaqH * 0.455,
    pishtaqH * 0.76,
    1.32,
  );
  const muqarnasCellsGeo = trackGeo(muqarnas.cellsGeo);
  const muqarnasRibsGeo = trackGeo(muqarnas.ribsGeo);

  // Inner sanctuary screen (doorway + upper arched jali window + physical 3D carved marble jali screens)
  const innerDoorFrameGeo = trackGeo(createPointedArchFrameGeometry(4.5, 5.2, 2.35, 2.5, 4.1, 0.62));
  const innerUpperWindowGeo = trackGeo(createPointedArchFrameGeometry(4.5, 4.6, 2.15, 2.0, 3.6, 0.55));
  const jaliBackingGeo = trackGeo(new THREE.BoxGeometry(3.4, 9.6, 0.25));
  const pishtaqDoorJali3DGeo = trackGeo(createJaliLattice3DGeometry(2.38, 4.15, 4, 6, 0.052, 0.11));
  const pishtaqUpperJali3DGeo = trackGeo(createJaliLattice3DGeometry(2.18, 3.65, 4, 5, 0.048, 0.10));
  const sideBayJali3DGeo = trackGeo(createJaliLattice3DGeometry(2.05, 3.85, 3, 5, 0.052, 0.10));
  const merlonGeo = trackGeo(new THREE.ConeGeometry(0.2, 0.48, 4));

  // Flanking 2-story side bay arch frames (lower & upper alcoves with deeper shadow recess)
  const sideBayW = (mW - 2 * ch - pishtaqW) * 0.5;
  const lowerBayH = mH * 0.5;
  const upperBayH = mH * 0.5;
  const sideArchGeo = trackGeo(
    createPointedArchFrameGeometry(
      sideBayW + 0.1,
      lowerBayH,
      sideBayW * 0.65,
      lowerBayH * 0.44,
      lowerBayH * 0.82,
      1.7,
    ),
  );
  const sideBandGeo = trackGeo(createBeveledBoxGeometry(sideBayW + 0.3, 0.38, 2.02, 0.068));
  const sideDarkLineGeo = trackGeo(new THREE.BoxGeometry(sideBayW + 0.32, 0.12, 2.02));
  const sideVaultBackGeo = trackGeo(new THREE.PlaneGeometry(sideBayW * 0.72, lowerBayH * 0.86));

  // Chamfered 45-degree corner facade arch frames
  const chamferFaceW = Math.hypot(ch, ch);
  const chamferArchGeo = trackGeo(
    createPointedArchFrameGeometry(
      chamferFaceW + 0.15,
      lowerBayH,
      chamferFaceW * 0.6,
      lowerBayH * 0.44,
      lowerBayH * 0.82,
      1.55,
    ),
  );

  // Build all 4 cardinal facades
  for (let side = 0; side < 4; side += 1) {
    const facade = new THREE.Group();
    facade.rotation.y = (side * Math.PI) / 2;

    // 1. Projecting Central Pishtaq Portal with bold dark calligraphic border
    const pishtaq = new THREE.Mesh(pishtaqGeo, materials.pishtaqFrame);
    pishtaq.position.set(0, 0, halfW - 0.65);
    pishtaq.castShadow = true;
    pishtaq.receiveShadow = true;
    facade.add(pishtaq);

    // Deep dark vaulted back wall inside the Great Pishtaq for strong photographic arch shadow
    const vaultBack = new THREE.Mesh(vaultBackGeo, materials.marbleDeepVault);
    vaultBack.position.set(0, pishtaqH * 0.39, halfW - 2.02);
    facade.add(vaultBack);

    // Physical 3D carved Muqarnas honeycomb vaulting inside the upper Great Pishtaq iwan
    // Blended in warm shaded Makrana marble tones so the vault reads as seamless carved stone
    const muqarnasCells = new THREE.Mesh(muqarnasCellsGeo, materials.marbleMuqarnasVault);
    muqarnasCells.position.set(0, 0, halfW - 0.66);
    muqarnasCells.castShadow = true;
    muqarnasCells.receiveShadow = true;
    facade.add(muqarnasCells);

    const muqarnasRibs = new THREE.Mesh(muqarnasRibsGeo, materials.marbleMuqarnasRib);
    muqarnasRibs.position.set(0, 0, halfW - 0.66);
    muqarnasRibs.castShadow = true;
    muqarnasRibs.receiveShadow = true;
    facade.add(muqarnasRibs);

    // Semi-octagonal splayed interior side walls inside the Great Iwan with carved dado relief niches
    for (const sx of [-1, 1]) {
      const splay = new THREE.Mesh(pishtaqSplayWallGeo, materials.marbleShadowRecess);
      splay.position.set(sx * 3.15, pishtaqH * 0.39, halfW - 1.28);
      splay.rotation.y = sx * 0.46;
      splay.receiveShadow = true;
      facade.add(splay);

      // Carved inlaid marble dado & upper blind niche panels recessed into the splayed iwan walls
      const splayDado = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(1.7, 3.6, 0.14)),
        materials.marbleInlayPanel,
      );
      splayDado.position.set(sx * 2.95, 2.2, halfW - 1.18);
      splayDado.rotation.y = sx * 0.46;
      facade.add(splayDado);

      const splayUpper = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(1.7, 4.4, 0.14)),
        materials.marbleInlayPanel,
      );
      splayUpper.position.set(sx * 2.95, 7.6, halfW - 1.18);
      splayUpper.rotation.y = sx * 0.46;
      facade.add(splayUpper);

      const retWall = new THREE.Mesh(pishtaqSideWallGeo, materials.marbleMain);
      retWall.position.set(sx * (pishtaqW * 0.5 - 0.72), pishtaqH * 0.5, halfW - 1.2);
      retWall.castShadow = true;
      retWall.receiveShadow = true;
      facade.add(retWall);

      // Tall slender Pishtaq corner guldastas rising above the parapet
      const guldasta = createGuldasta(pishtaqH + 3.2, 0.24, materials, trackGeo);
      guldasta.position.set(sx * (pishtaqW * 0.5 + 0.04), 0, halfW + 0.96);
      facade.add(guldasta);
    }

    // Subtle recessed shaded molding cornice separating the upper Jali window from the dark iwan vault
    const vaultCornice = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(4.5, 0.28, 0.24)),
      materials.marbleShadowRecess,
    );
    vaultCornice.position.set(0, 10.15, halfW - 1.74);
    facade.add(vaultCornice);

    // Pishtaq crown cornice, dark marble frieze stripe, and decorative scalloped merlon cresting
    const cap = new THREE.Mesh(pishtaqCapGeo, materials.marbleTrim);
    cap.position.set(0, pishtaqH + 0.22, halfW - 0.08);
    cap.castShadow = true;
    cap.receiveShadow = true;
    facade.add(cap);

    const darkStripe = new THREE.Mesh(pishtaqDarkFrameGeo, materials.darkInlayStone);
    darkStripe.position.set(0, pishtaqH - 0.34, halfW + 0.14);
    facade.add(darkStripe);

    const merlonCount = 15;
    for (let m = 0; m < merlonCount; m += 1) {
      const mx = -pishtaqW * 0.46 + (m / (merlonCount - 1)) * (pishtaqW * 0.92);
      const merlon = new THREE.Mesh(merlonGeo, materials.marbleTrim);
      merlon.position.set(mx, pishtaqH + 0.7, halfW + 1.04);
      merlon.rotation.y = Math.PI * 0.25;
      facade.add(merlon);
    }

    // Deep recessed interior doorway, perforated Jali backing + finely carved 3D pierced marble Jali latticework
    const jaliBack = new THREE.Mesh(jaliBackingGeo, materials.jaliScreen);
    jaliBack.position.set(0, 4.9, halfW - 1.94);
    facade.add(jaliBack);

    const doorJali3D = new THREE.Mesh(pishtaqDoorJali3DGeo, materials.carvedJaliMarble);
    doorJali3D.position.set(0, 2.08, halfW - 1.78);
    doorJali3D.castShadow = true;
    doorJali3D.receiveShadow = true;
    facade.add(doorJali3D);

    const upperJali3D = new THREE.Mesh(pishtaqUpperJali3DGeo, materials.carvedJaliMarble);
    upperJali3D.position.set(0, 7.22, halfW - 1.74);
    upperJali3D.castShadow = true;
    upperJali3D.receiveShadow = true;
    facade.add(upperJali3D);

    const innerDoor = new THREE.Mesh(innerDoorFrameGeo, materials.marbleShadowRecess);
    innerDoor.position.set(0, 0, halfW - 1.82);
    innerDoor.receiveShadow = true;
    facade.add(innerDoor);

    const innerUpper = new THREE.Mesh(innerUpperWindowGeo, materials.marbleShadowRecess);
    innerUpper.position.set(0, 5.4, halfW - 1.78);
    innerUpper.receiveShadow = true;
    facade.add(innerUpper);

    // Subtle marble gallery balustrade rail separating lower and upper inner arches
    const rail = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(4.4, 0.34, 0.3)),
      materials.marbleTrim,
    );
    rail.position.set(0, 5.26, halfW - 1.25);
    facade.add(rail);

    // 2. Flanking Two-Story Arched Side Bays (left & right of Pishtaq)
    for (const sx of [-1, 1]) {
      const bayX = sx * (pishtaqW * 0.5 + sideBayW * 0.5);

      const lowerBay = new THREE.Mesh(sideArchGeo, materials.marbleInlayPanel);
      lowerBay.position.set(bayX, 0, halfW - 1.72);
      lowerBay.castShadow = true;
      lowerBay.receiveShadow = true;
      facade.add(lowerBay);

      const upperBay = new THREE.Mesh(sideArchGeo, materials.marbleInlayPanel);
      upperBay.position.set(bayX, upperBayH, halfW - 1.72);
      upperBay.castShadow = true;
      upperBay.receiveShadow = true;
      facade.add(upperBay);

      // Deep shaded alcove backing behind both stacked arches + physical 3D carved marble jali screens
      const lowerBack = new THREE.Mesh(sideVaultBackGeo, materials.marbleDeepVault);
      lowerBack.position.set(bayX, lowerBayH * 0.44, halfW - 1.98);
      facade.add(lowerBack);

      const upperBack = new THREE.Mesh(sideVaultBackGeo, materials.marbleDeepVault);
      upperBack.position.set(bayX, upperBayH + lowerBayH * 0.44, halfW - 1.98);
      facade.add(upperBack);

      const bayJaliLower = new THREE.Mesh(sideBayJali3DGeo, materials.carvedJaliMarble);
      bayJaliLower.position.set(bayX, 2.1, halfW - 1.88);
      bayJaliLower.castShadow = true;
      bayJaliLower.receiveShadow = true;
      facade.add(bayJaliLower);

      const bayJaliUpper = new THREE.Mesh(sideBayJali3DGeo, materials.carvedJaliMarble);
      bayJaliUpper.position.set(bayX, upperBayH + 2.0, halfW - 1.88);
      bayJaliUpper.castShadow = true;
      bayJaliUpper.receiveShadow = true;
      facade.add(bayJaliUpper);

      // Horizontal stringcourse molding & dark shadow groove between tiers
      const midBand = new THREE.Mesh(sideBandGeo, materials.marbleTrim);
      midBand.position.set(bayX, lowerBayH, halfW - 0.85);
      midBand.castShadow = true;
      facade.add(midBand);

      const midDark = new THREE.Mesh(sideDarkLineGeo, materials.darkInlayStone);
      midDark.position.set(bayX, lowerBayH - 0.22, halfW - 0.85);
      facade.add(midDark);

      const topBand = new THREE.Mesh(sideBandGeo, materials.marbleTrim);
      topBand.position.set(bayX, mH + 0.14, halfW - 0.85);
      topBand.castShadow = true;
      facade.add(topBand);

      const topDarkLine = new THREE.Mesh(sideDarkLineGeo, materials.darkInlayStone);
      topDarkLine.position.set(bayX, mH - 0.14, halfW - 0.85);
      facade.add(topDarkLine);

      // Continuous scalloped Mughal merlon cresting crowning the side bay parapet
      for (let sm = 0; sm < 6; sm += 1) {
        const smx = bayX - sideBayW * 0.42 + (sm / 5) * (sideBayW * 0.84);
        const sideMerlon = new THREE.Mesh(merlonGeo, materials.marbleTrim);
        sideMerlon.position.set(smx, mH + 0.56, halfW - 0.04);
        sideMerlon.rotation.y = Math.PI * 0.25;
        facade.add(sideMerlon);
      }

      // Outer edge guldasta pinnacle where side bay meets chamfered corner
      const edgeSpire = createGuldasta(mH + 2.5, 0.2, materials, trackGeo);
      edgeSpire.position.set(sx * (halfW - ch), 0, halfW - 0.04);
      facade.add(edgeSpire);
    }

    mausoleumGroup.add(facade);
  }

  // Build all 4 chamfered 45-degree corner facades
  const chamferDist = (halfW + (halfW - ch)) * Math.SQRT1_2;
  for (let c = 0; c < 4; c += 1) {
    const cornerGroup = new THREE.Group();
    cornerGroup.rotation.y = Math.PI * 0.25 + c * Math.PI * 0.5;

    const lowerChamfer = new THREE.Mesh(chamferArchGeo, materials.marbleInlayPanel);
    lowerChamfer.position.set(0, 0, chamferDist - 1.56);
    lowerChamfer.castShadow = true;
    lowerChamfer.receiveShadow = true;
    cornerGroup.add(lowerChamfer);

    const upperChamfer = new THREE.Mesh(chamferArchGeo, materials.marbleInlayPanel);
    upperChamfer.position.set(0, upperBayH, chamferDist - 1.56);
    upperChamfer.castShadow = true;
    upperChamfer.receiveShadow = true;
    cornerGroup.add(upperChamfer);

    const cornerBand = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(chamferFaceW + 0.2, 0.36, 1.7)),
      materials.marbleTrim,
    );
    cornerBand.position.set(0, mH + 0.14, chamferDist - 0.72);
    cornerGroup.add(cornerBand);

    mausoleumGroup.add(cornerGroup);
  }

  // =========================================================================
  // STAGE 4: FOUR CORNER MINARETS (BANDED MASONRY + 3 BALCONIES + CHHATRI CROWNS)
  // =========================================================================
  const minaretGroups: THREE.Group[] = [];
  const minOffset = TAJ_DIMS.minaretOffset;
  const minaretCoords: Array<[number, number]> = [
    [-minOffset, minOffset],
    [minOffset, minOffset],
    [-minOffset, -minOffset],
    [minOffset, -minOffset],
  ];

  const minOctBaseGeo = trackGeo(new THREE.CylinderGeometry(2.16, 2.34, 1.92, 8));
  const minOctCollarGeo = trackGeo(new THREE.CylinderGeometry(1.88, 2.1, 0.44, 8));
  const minShadowPadGeo = trackGeo(new THREE.PlaneGeometry(6.8, 6.8));
  const stageHeights = [8.2, 7.6, 6.8];
  const stageRadii: Array<[number, number]> = [
    [1.76, 1.58],
    [1.54, 1.38],
    [1.34, 1.2],
  ];
  const stageGeos = stageHeights.map((h, idx) =>
    trackGeo(new THREE.CylinderGeometry(stageRadii[idx][1], stageRadii[idx][0], h, 28)),
  );

  for (let m = 0; m < 4; m += 1) {
    const [mx, mz] = minaretCoords[m];
    const minGroup = new THREE.Group();
    minGroup.name = `Minaret_${m + 1}`;
    minGroup.position.set(mx, TAJ_DIMS.plinthTopY, mz);

    const leanSignX = Math.sign(mx);
    const leanSignZ = Math.sign(mz);
    minGroup.rotation.z = -leanSignX * 0.008;
    minGroup.rotation.x = leanSignZ * 0.008;

    // Grounding contact shadow on marble plinth deck
    const minShadow = new THREE.Mesh(minShadowPadGeo, materials.contactShadow);
    minShadow.rotation.x = -Math.PI * 0.5;
    minShadow.position.y = 0.08;
    minGroup.add(minShadow);

    const baseMesh = new THREE.Mesh(minOctBaseGeo, materials.marbleTrim);
    baseMesh.position.y = 0.96;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    minGroup.add(baseMesh);

    const collarMesh = new THREE.Mesh(minOctCollarGeo, materials.marbleMain);
    collarMesh.position.y = 2.08;
    collarMesh.castShadow = true;
    minGroup.add(collarMesh);

    let y = 2.24;

    for (let s = 0; s < 3; s += 1) {
      const sh = stageHeights[s];
      const topR = stageRadii[s][1];

      const shaft = new THREE.Mesh(stageGeos[s], materials.minaretMarble);
      shaft.position.y = y + sh * 0.5;
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      minGroup.add(shaft);

      y += sh;

      // Deep shaded undercut shadow ring below each projecting circular balcony
      const underShadow = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(topR + 0.14, topR + 0.02, 0.24, 24)),
        materials.marbleDeepVault,
      );
      underShadow.position.y = y - 0.12;
      minGroup.add(underShadow);

      // Carved corbel bracket flare + 16 radial sculpted muqarnas stone brackets supporting each balcony
      const corbel = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(topR + 0.56, topR + 0.06, 0.62, 24)),
        materials.marbleTrim,
      );
      corbel.position.y = y + 0.24;
      corbel.castShadow = true;
      minGroup.add(corbel);

      const bracketGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.46, 0.46));
      for (let b = 0; b < 16; b += 1) {
        const ba = (b / 16) * Math.PI * 2;
        const br = new THREE.Mesh(bracketGeo, materials.marbleMain);
        br.position.set(Math.cos(ba) * (topR + 0.34), y + 0.32, Math.sin(ba) * (topR + 0.34));
        br.rotation.y = -ba + Math.PI * 0.5;
        minGroup.add(br);
      }

      // Chamfered/beveled minaret balcony deck & carved stone rim lip catching golden sunlight
      const deck = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(topR + 0.68, topR + 0.58, 0.26, 24)),
        materials.marbleMain,
      );
      deck.position.y = y + 0.6;
      deck.castShadow = true;
      deck.receiveShadow = true;
      minGroup.add(deck);

      const deckRimBevel = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(topR + 0.65, 0.055, 6, 24)),
        materials.marbleTrim,
      );
      deckRimBevel.rotation.x = Math.PI * 0.5;
      deckRimBevel.position.y = y + 0.72;
      minGroup.add(deckRimBevel);

      // Recessed dark arched balcony doorway opening facing the central mausoleum
      const doorRecess = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.56, 1.38, 0.24)),
        materials.marbleDeepVault,
      );
      doorRecess.position.set(-leanSignX * (topR - 0.02), y + 1.38, -leanSignZ * (topR - 0.02));
      doorRecess.rotation.y = Math.atan2(-leanSignX, -leanSignZ);
      minGroup.add(doorRecess);

      // Carved perforated balustrade parapet ring + top chamfered stone handrail torus
      const parapet = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(topR + 0.58, topR + 0.58, 0.62, 24, 1, true)),
        materials.marbleInlayPanel,
      );
      parapet.material.side = THREE.DoubleSide;
      parapet.position.y = y + 0.98;
      minGroup.add(parapet);

      const parapetRail = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(topR + 0.58, 0.052, 6, 24)),
        materials.marbleTrim,
      );
      parapetRail.rotation.x = Math.PI * 0.5;
      parapetRail.position.y = y + 1.29;
      minGroup.add(parapetRail);

      const darkBand = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(topR + 0.61, topR + 0.61, 0.1, 24)),
        materials.darkInlayStone,
      );
      darkBand.position.y = y + 0.68;
      minGroup.add(darkBand);

      y += 0.7;
    }

    // Crowning 8-columned Chhatri pavilion atop minaret
    const crown = createChhatriPavilion(1.26, 2.38, 2.6, false, materials, trackGeo);
    crown.position.y = y + 0.04;
    minGroup.add(crown);

    minaretGroups.push(minGroup);
  }

  // =========================================================================
  // STAGE 5: FOUR ROOF CHHATRIS & INLAID CENTRAL DOME DRUM
  // =========================================================================
  const chhatriGroups: THREE.Group[] = [];
  const roofY = TAJ_DIMS.plinthTopY + mH;
  const chOff = TAJ_DIMS.chhatriOffset;
  const chhatriCoords: Array<[number, number]> = [
    [-chOff, chOff],
    [chOff, chOff],
    [-chOff, -chOff],
    [chOff, -chOff],
  ];

  for (let i = 0; i < 4; i += 1) {
    const [cx, cz] = chhatriCoords[i];
    const chhatri = createChhatriPavilion(2.88, 3.65, 4.18, true, materials, trackGeo);
    chhatri.name = `RoofChhatri_${i + 1}`;
    chhatri.position.set(cx, roofY, cz);
    chhatriGroups.push(chhatri);
  }

  // Central Monumental Dome Drum with inlaid geometric frieze & carved lotus base collar
  const drumGroup = new THREE.Group();
  drumGroup.name = 'CentralDomeDrum';
  drumGroup.position.y = roofY;

  const drumBase = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(TAJ_DIMS.drumRadius + 0.44, TAJ_DIMS.drumRadius + 0.68, 0.88, 40)),
    materials.marbleTrim,
  );
  drumBase.position.y = 0.44;
  drumBase.castShadow = true;
  drumBase.receiveShadow = true;
  drumGroup.add(drumBase);

  const drumBody = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(TAJ_DIMS.drumRadius, TAJ_DIMS.drumRadius + 0.14, TAJ_DIMS.drumHeight, 44)),
    materials.marbleInlayPanel,
  );
  drumBody.position.y = 0.8 + TAJ_DIMS.drumHeight * 0.5;
  drumBody.castShadow = true;
  drumBody.receiveShadow = true;
  drumGroup.add(drumBody);

  // Crisp dark geometric inlay bands & shadow ring around drum (matching the dark collar ring in the photo!)
  for (const bandY of [1.18, TAJ_DIMS.drumHeight - 0.15, TAJ_DIMS.drumHeight + 0.48]) {
    const band = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(TAJ_DIMS.drumRadius + 0.14, TAJ_DIMS.drumRadius + 0.14, 0.22, 40)),
      materials.darkInlayStone,
    );
    band.position.y = bandY;
    drumGroup.add(band);
  }

  // Carved projecting lotus-petal cornice collar & sculpted rope-molding torus ring cradling the grand dome
  const drumCornice = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(TAJ_DIMS.drumRadius + 0.38, TAJ_DIMS.drumRadius + 0.08, 0.62, 44)),
    materials.marbleTrim,
  );
  drumCornice.position.y = TAJ_DIMS.drumHeight + 0.9;
  drumCornice.castShadow = true;
  drumGroup.add(drumCornice);

  const ropeMolding = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(TAJ_DIMS.drumRadius + 0.22, 0.14, 10, 48)),
    materials.marbleMain,
  );
  ropeMolding.rotation.x = Math.PI * 0.5;
  ropeMolding.position.y = TAJ_DIMS.drumHeight + 1.12;
  drumGroup.add(ropeMolding);

  // =========================================================================
  // STAGE 6: GRAND BULBOUS ONION DOME, SCULPTED LOTUS CROWN & ANTIQUE BRONZE FINIAL
  // =========================================================================
  const domeBaseY = roofY + TAJ_DIMS.drumHeight + 1.04;
  const domeGroup = new THREE.Group();
  domeGroup.name = 'GrandOnionDome';
  domeGroup.position.y = domeBaseY;

  const mainDome = new THREE.Mesh(
    trackGeo(createOnionDomeGeometry(TAJ_DIMS.drumRadius - 0.04, TAJ_DIMS.domeMaxRadius, TAJ_DIMS.domeHeight, 56)),
    materials.marbleDome,
  );
  mainDome.castShadow = true;
  mainDome.receiveShadow = true;
  domeGroup.add(mainDome);

  const finialGroup = new THREE.Group();
  finialGroup.name = 'KalashaFinial';
  finialGroup.position.y = domeBaseY + TAJ_DIMS.domeHeight * 0.942;

  const lotusCap = new THREE.Mesh(
    trackGeo(createInvertedLotusCap(1.68, 1.44, 32)),
    materials.marbleTrim,
  );
  lotusCap.castShadow = true;
  finialGroup.add(lotusCap);

  // 28 sculpted 3D inverted lotus-petal relief ribs radiating down around the dome apex collar
  const petalGeo = trackGeo(new THREE.ConeGeometry(0.16, 1.38, 4));
  for (let p = 0; p < 28; p += 1) {
    const pa = (p / 28) * Math.PI * 2;
    const petal = new THREE.Mesh(petalGeo, materials.marbleMain);
    petal.position.set(Math.cos(pa) * 1.18, 0.36, Math.sin(pa) * 1.18);
    petal.rotation.y = -pa;
    petal.rotation.z = 0.72;
    finialGroup.add(petal);
  }

  // Subtle dark collar ring separating marble lotus cap from antique bronze finial
  const finialCollar = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.46, 0.56, 0.24, 20)),
    materials.darkInlayStone,
  );
  finialCollar.position.y = 1.24;
  finialGroup.add(finialCollar);

  const kalasha = createKalashaFinialGroup(1.16, materials.bronzeFinial, trackGeo);
  kalasha.position.y = 1.28;
  finialGroup.add(kalasha);

  root.add(plinthGroup, mausoleumGroup, ...minaretGroups, ...chhatriGroups, drumGroup, domeGroup, finialGroup);

  return {
    root,
    plinthGroup,
    mausoleumGroup,
    minaretGroups,
    chhatriGroups,
    drumGroup,
    domeGroup,
    finialGroup,
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
