import * as THREE from 'three';
import type { PerformanceTier } from './postprocessing';

const MARBLE_PHOTO_URL = '/src/assets/images/tex_makrana_marble_1795249692110.jpg';
const SANDSTONE_PHOTO_URL = '/src/assets/images/tex_agra_sandstone_1795249690974.jpg';
const GRASS_PHOTO_URL = '/src/assets/images/tex_mughal_lawn_1795249691827.jpg';

function createCanvas(width: number, height = width): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to obtain 2D canvas context for texture generation.');
  }
  return [canvas, ctx];
}

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function configureTexture(
  tex: THREE.Texture,
  isColor: boolean,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1,
  clamp = false,
): THREE.Texture {
  tex.wrapS = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Generate a high-res tangent-space normal map from any height/albedo canvas via Sobel gradient filter. */
function generateNormalMapFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  strength = 2.4,
  resolution = 512,
): HTMLCanvasElement {
  const w = resolution;
  const h = resolution;
  const [tmp, tmpCtx] = createCanvas(w, h);
  tmpCtx.drawImage(sourceCanvas, 0, 0, w, h);
  const srcData = tmpCtx.getImageData(0, 0, w, h).data;

  const [out, outCtx] = createCanvas(w, h);
  const outImg = outCtx.createImageData(w, h);
  const dst = outImg.data;

  const lum = (x: number, y: number) => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    const idx = (wy * w + wx) * 4;
    return (srcData[idx] * 0.299 + srcData[idx + 1] * 0.587 + srcData[idx + 2] * 0.114) / 255;
  };

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const tl = lum(x - 1, y - 1);
      const t = lum(x, y - 1);
      const tr = lum(x + 1, y - 1);
      const l = lum(x - 1, y);
      const r = lum(x + 1, y);
      const bl = lum(x - 1, y + 1);
      const b = lum(x, y + 1);
      const br = lum(x + 1, y + 1);

      const dX = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dY = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const dZ = 1.0;
      const invLen = 1 / Math.sqrt(dX * dX + dY * dY + dZ * dZ);

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((-dX * invLen * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((-dY * invLen * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((dZ * invLen * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }
  outCtx.putImageData(outImg, 0, 0);
  return out;
}

/**
 * Derive physically calibrated linear Roughness & Ambient Occlusion canvases from a surface canvas:
 * - Crevices & dark stone joints become rougher and darker in AO
 * - Polished stone faces & mineral veins vary smoothly in micro-roughness for authentic specular breakup
 */
function generateRoughnessAndAoFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  resolution: number,
  minRough: number,
  maxRough: number,
  aoContrast: number,
): { roughCanvas: HTMLCanvasElement; aoCanvas: HTMLCanvasElement } {
  const [tmp, tmpCtx] = createCanvas(resolution, resolution);
  tmpCtx.drawImage(sourceCanvas, 0, 0, resolution, resolution);
  const src = tmpCtx.getImageData(0, 0, resolution, resolution).data;

  const [roughCanvas, roughCtx] = createCanvas(resolution, resolution);
  const [aoCanvas, aoCtx] = createCanvas(resolution, resolution);
  const rImg = roughCtx.createImageData(resolution, resolution);
  const aImg = aoCtx.createImageData(resolution, resolution);
  const rDst = rImg.data;
  const aDst = aImg.data;

  // Compute local average luminance for cavity detection
  const total = resolution * resolution;
  const lums = new Float32Array(total);
  let meanLum = 0;
  for (let i = 0; i < total; i += 1) {
    const p = i * 4;
    const l = (src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114) / 255;
    lums[i] = l;
    meanLum += l;
  }
  meanLum /= Math.max(1, total);

  for (let i = 0; i < total; i += 1) {
    const l = lums[i];
    // Darker crevices -> higher roughness & stronger AO shadow
    const norm = Math.max(0, Math.min(1, (l - meanLum * 0.42) / Math.max(0.18, 1.0 - meanLum * 0.42)));
    const rough = maxRough - norm * (maxRough - minRough);
    const ao = Math.max(0.28, Math.min(1.0, 1.0 - (1.0 - norm) * aoContrast));

    const rVal = Math.round(Math.max(0, Math.min(1, rough)) * 255);
    const aVal = Math.round(ao * 255);
    const p = i * 4;
    rDst[p] = rVal;
    rDst[p + 1] = rVal;
    rDst[p + 2] = rVal;
    rDst[p + 3] = 255;

    aDst[p] = aVal;
    aDst[p + 1] = aVal;
    aDst[p + 2] = aVal;
    aDst[p + 3] = 255;
  }

  roughCtx.putImageData(rImg, 0, 0);
  aoCtx.putImageData(aImg, 0, 0);
  return { roughCanvas, aoCanvas };
}

/** Paint authentic translucent Makrana marble mineral veining, ashlar slab seams & subtle monsoon weathering. */
function drawMakranaMarbleDetail(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource | null,
  size: number,
): void {
  const rand = seededRandom(1632);
  if (baseSource) {
    ctx.drawImage(baseSource, 0, 0, size, size);
  } else {
    ctx.fillStyle = '#ece5d7';
    ctx.fillRect(0, 0, size, size);
  }

  const sc = size / 512;
  const logical = 512;
  ctx.save();
  ctx.scale(sc, sc);

  // Soft translucent calcite mineral clouds & warm honey-ivory veining
  for (let i = 0; i < 42; i += 1) {
    const x = rand() * logical;
    const y = rand() * logical;
    const r = 24 + rand() * 88;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    const warm = rand() > 0.45;
    g.addColorStop(0, warm ? 'rgba(214, 198, 174, 0.14)' : 'rgba(255, 252, 246, 0.14)');
    g.addColorStop(1, 'rgba(235, 226, 212, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Organic meandering grey-gold Makrana calcite veins (crisp native 2048px vector detail)
  for (let v = 0; v < 34; v += 1) {
    let vx = rand() * logical;
    let vy = rand() * logical;
    const angle = (rand() - 0.5) * 0.9;
    ctx.strokeStyle =
      v % 3 === 0 ? 'rgba(154, 142, 126, 0.22)' : 'rgba(182, 166, 144, 0.17)';
    ctx.lineWidth = 0.65 + rand() * 1.85;
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    for (let s = 0; s < 8; s += 1) {
      vx += Math.cos(angle + (rand() - 0.5) * 0.7) * (logical * 0.075);
      vy += Math.sin(angle + (rand() - 0.5) * 0.7) * (logical * 0.075);
      ctx.lineTo(vx, vy);
    }
    ctx.stroke();
  }

  // Crisp subtle ashlar Makrana marble masonry courses with delicate slab-to-slab tonal variation
  const rows = 6;
  const cols = 3;
  const rowH = logical / rows;
  const colW = logical / cols;
  for (let r = 0; r < rows; r += 1) {
    const xOff = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c += 1) {
      const bx = c * colW + xOff;
      const by = r * rowH;
      const tint = rand();
      ctx.fillStyle =
        tint > 0.65
          ? 'rgba(255, 251, 242, 0.06)'
          : tint < 0.32
            ? 'rgba(168, 152, 132, 0.075)'
            : 'rgba(220, 210, 194, 0.03)';
      ctx.fillRect(bx, by, colW, rowH);

      // Hairline recessed mortar seam
      ctx.strokeStyle = 'rgba(118, 108, 94, 0.26)';
      ctx.lineWidth = 1.25;
      ctx.strokeRect(bx, by, colW, rowH);
    }
  }
  ctx.restore();
}

/** 2D periodic value noise + fBM for photorealistic cumulus and wispy clouds. */
function createCloudFbmTexture(
  seed: number,
  width: number,
  height: number,
  style: 'bank' | 'tower' | 'wispy',
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(width, height);
  const rand = seededRandom(seed);
  const grid = 64;
  const table = new Float32Array(grid * grid);
  for (let i = 0; i < table.length; i += 1) {
    table[i] = rand();
  }

  const sampleNoise = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % grid) + grid) % grid;
    const y0 = ((yi % grid) + grid) % grid;
    const x1 = (x0 + 1) % grid;
    const y1 = (y0 + 1) % grid;
    const a = table[y0 * grid + x0];
    const b = table[y0 * grid + x1];
    const c = table[y1 * grid + x0];
    const d = table[y1 * grid + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  const fbm = (x: number, y: number): number => {
    let val = 0;
    let amp = 0.52;
    let freq = 1;
    for (let o = 0; o < 5; o += 1) {
      val += sampleNoise(x * freq, y * freq) * amp;
      freq *= 2.04;
      amp *= 0.5;
    }
    return val;
  };

  const img = ctx.createImageData(width, height);
  const data = img.data;

  for (let py = 0; py < height; py += 1) {
    const ny = py / (height - 1); // 0 = top, 1 = bottom
    for (let px = 0; px < width; px += 1) {
      const nx = px / (width - 1);
      const cx = (nx - 0.5) * 2.0;
      const cy = (ny - 0.52) * 2.0;

      // Sculpt natural cumulus envelope (flat bottom, billowing asymmetric crown)
      let envelope: number;
      if (style === 'bank') {
        const bottomFlat = ny > 0.7 ? Math.max(0, 1 - (ny - 0.7) / 0.24) : 1.0;
        const dome1 = Math.max(0, 1 - Math.hypot((nx - 0.5) * 1.9, (ny - 0.52) * 2.15));
        const dome2 = Math.max(0, 1 - Math.hypot((nx - 0.28) * 2.5, (ny - 0.62) * 2.7)) * 0.85;
        const dome3 = Math.max(0, 1 - Math.hypot((nx - 0.72) * 2.4, (ny - 0.6) * 2.6)) * 0.88;
        envelope = Math.max(dome1, dome2, dome3) * bottomFlat;
      } else if (style === 'tower') {
        const bottomFlat = ny > 0.74 ? Math.max(0, 1 - (ny - 0.74) / 0.2) : 1.0;
        const main = Math.max(0, 1 - Math.hypot((nx - 0.48) * 2.05, (ny - 0.46) * 1.95));
        const wingL = Math.max(0, 1 - Math.hypot((nx - 0.25) * 2.6, (ny - 0.66) * 2.8)) * 0.82;
        const wingR = Math.max(0, 1 - Math.hypot((nx - 0.74) * 2.6, (ny - 0.64) * 2.7)) * 0.8;
        envelope = Math.max(main, wingL, wingR) * bottomFlat;
      } else {
        // Wispy high-altitude cirrus/altocumulus streak
        envelope = Math.max(0, 1 - Math.hypot(cx * 0.95, cy * 1.65));
      }

      const smoothEdge = (v: number, band: number): number => {
        const t = Math.max(0, Math.min(1, v / band));
        return t * t * (3 - 2 * t);
      };
      const edgeFade =
        smoothEdge(nx, 0.16) *
        smoothEdge(1 - nx, 0.16) *
        smoothEdge(ny, 0.16) *
        smoothEdge(1 - ny, 0.16);

      const n = fbm(nx * (style === 'wispy' ? 6.5 : 4.2) + seed * 0.13, ny * (style === 'wispy' ? 4.8 : 3.4));
      const detail = fbm(nx * 10.5 + 3.1, ny * 8.5 + 1.7);
      const densityRaw =
        envelope * 1.18 +
        ((n - 0.48) * (style === 'wispy' ? 0.68 : 0.56) + (detail - 0.5) * 0.18) * Math.sqrt(edgeFade);
      const rawAlpha = Math.max(0, Math.min(1, (densityRaw - 0.24) / (style === 'wispy' ? 0.55 : 0.42)));
      const alpha = rawAlpha * edgeFade;

      // Soft photographic vertical self-shadowing (sunlit warm-white top -> cool blue-grey underside)
      const sunFacing = Math.max(0, Math.min(1, 1.08 - ny * 0.82 + (n - 0.5) * 0.25));
      const r = Math.round(218 + sunFacing * 37);
      const g = Math.round(224 + sunFacing * 31);
      const b = Math.round(236 + sunFacing * 19);

      const idx = (py * width + px) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = Math.round(alpha * (style === 'wispy' ? 190 : 242));
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  configureTexture(tex, true, maxAnisotropy, 1, 1, true);
  return tex;
}

/**
 * Paint a high-detail 512x512 compact, rounded Mediterranean cypress needle/scale-leaf bough tuft
 * (1:1 aspect — zero stretched vertical stalk! Crisp fine feathery scale-leaf fronds in deep
 * Mediterranean cypress green with subtle olive-green outer tips and lacy organic perimeter).
 */
function createCypressSprigTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size);
  const rand = seededRandom(8827);
  ctx.clearRect(0, 0, size, size);

  const drawCypressFrond = (
    ox: number,
    oy: number,
    angle: number,
    length: number,
    spread: number,
    lightBias: number,
  ) => {
    const steps = 10;
    const tipX = ox + Math.cos(angle) * length;
    const tipY = oy + Math.sin(angle) * length;

    // Fine dark forest-green inner scale stem
    ctx.strokeStyle = 'rgba(38, 54, 30, 0.94)';
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Fine paired Mediterranean cypress scale-needle sub-sprays
    for (let s = 1; s <= steps; s += 1) {
      const u = s / steps;
      const bx = ox + (tipX - ox) * u;
      const by = oy + (tipY - oy) * u;
      const needleLen = (1.0 - u * 0.56) * spread * (0.76 + rand() * 0.44);

      for (const side of [-1, 1]) {
        const fa = angle + side * (0.36 + (1 - u) * 0.24 + (rand() - 0.5) * 0.16);
        const fx = bx + Math.cos(fa) * needleLen;
        const fy = by + Math.sin(fa) * needleLen;
        const t = Math.min(1, u * 0.42 + lightBias * 0.50 + rand() * 0.14);

        // Rich natural dark Mediterranean cypress green -> muted olive-green sunlit tips (zero black crush, zero yellow-beige!)
        const rCol = Math.round(38 + t * 56);
        const gCol = Math.round(70 + t * 66);
        const bCol = Math.round(34 + t * 28);

        ctx.strokeStyle = `rgba(${rCol}, ${gCol}, ${bCol}, 0.98)`;
        ctx.lineWidth = 2.4 - u * 1.1;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(
          (bx + fx) * 0.5 + Math.cos(angle) * 2.2,
          (by + fy) * 0.5 + Math.sin(angle) * 2.2,
          fx,
          fy,
        );
        ctx.stroke();

        // Micro feathery secondary scale tips for crisp close-up edge definition
        if (s > 3 && rand() > 0.35) {
          const sa = fa + side * 0.28;
          ctx.strokeStyle = `rgba(${rCol + 12}, ${gCol + 16}, ${bCol + 6}, 0.95)`;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo((bx + fx) * 0.55, (by + fy) * 0.55);
          ctx.lineTo(
            (bx + fx) * 0.55 + Math.cos(sa) * needleLen * 0.48,
            (by + fy) * 0.55 + Math.sin(sa) * needleLen * 0.48,
          );
          ctx.stroke();
        }
      }
    }
  };

  // Compact radiating woody branchlet heart centered at (256, 268) so boughs form dense rounded tufts
  const hubX = 256;
  const hubY = 268;
  ctx.strokeStyle = 'rgba(42, 33, 23, 0.92)';
  ctx.lineCap = 'round';
  const branches: Array<{ x: number; y: number; a: number; len: number }> = [];
  for (let b = 0; b < 14; b += 1) {
    const a = (b / 14) * Math.PI * 2 + (rand() - 0.5) * 0.28;
    const len = 85 + rand() * 78;
    branches.push({ x: hubX, y: hubY, a, len });
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(hubX, hubY);
    ctx.lineTo(hubX + Math.cos(a) * len * 0.58, hubY + Math.sin(a) * len * 0.58);
    ctx.stroke();
  }

  // Layer 1: Dense deep-shadowed inner Mediterranean cypress core foliage
  for (let i = 0; i < 110; i += 1) {
    const br = branches[Math.floor(rand() * branches.length)];
    const u = rand() * 0.62;
    const sx = br.x + Math.cos(br.a) * br.len * u + (rand() - 0.5) * 28;
    const sy = br.y + Math.sin(br.a) * br.len * u + (rand() - 0.5) * 28;
    if (Math.hypot(sx - hubX, sy - hubY) > 175) continue;
    drawCypressFrond(sx, sy, br.a + (rand() - 0.5) * 1.1, 24 + rand() * 26, 11 + rand() * 9, 0.08);
  }

  // Layer 2: Crisp mid-crown overlapping dark cypress needle sprays
  for (let i = 0; i < 160; i += 1) {
    const br = branches[Math.floor(rand() * branches.length)];
    const u = 0.18 + rand() * 0.78;
    const sx = br.x + Math.cos(br.a) * br.len * u + (rand() - 0.5) * 34;
    const sy = br.y + Math.sin(br.a) * br.len * u + (rand() - 0.5) * 34;
    const dist = Math.hypot(sx - hubX, sy - hubY);
    if (dist > 205) continue;
    const bias = Math.min(1, dist / 195) * 0.55 + Math.max(0, (hubY - sy) / 240) * 0.35;
    drawCypressFrond(sx, sy, br.a + (rand() - 0.5) * 0.95, 22 + rand() * 28, 9.5 + rand() * 8.5, bias);
  }

  // Layer 3: Fine feathery outer scale-leaf plumes breaking up every silhouette edge
  for (let i = 0; i < 115; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = 115 + rand() * 88;
    const sx = hubX + Math.cos(a) * r;
    const sy = hubY + Math.sin(a) * r;
    if (Math.hypot(sx - 256, sy - 256) > 222) continue;
    const upwardTilt = a * 0.75 + (-Math.PI * 0.5) * 0.25;
    drawCypressFrond(sx, sy, upwardTilt + (rand() - 0.5) * 0.55, 18 + rand() * 22, 7.5 + rand() * 6.5, 0.72);
  }

  const tex = new THREE.CanvasTexture(canvas);
  configureTexture(tex, true, maxAnisotropy, 1, 1, true);
  return tex;
}

/**
 * Paint a realistic 512x512 deciduous Neem / Mughal shade-tree foliage branchlet with
 * forked woody twigs, crisp individually pointed leaves with midribs, natural color variation,
 * and organic lacy sky gaps around the perimeter.
 */
function createLeafClusterTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size);
  const rand = seededRandom(5519);
  ctx.clearRect(0, 0, size, size);

  const drawPointedLeaf = (
    x: number,
    y: number,
    angle: number,
    length: number,
    width: number,
    fill: string,
    veinColor: string,
  ) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(length * 0.3, -width, length * 0.72, -width * 0.8, length, 0);
    ctx.bezierCurveTo(length * 0.72, width * 0.8, length * 0.3, width, 0, 0);
    ctx.closePath();
    ctx.fill();

    // Subtle central midrib vein for botanical realism
    ctx.strokeStyle = veinColor;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(length * 0.84, 0);
    ctx.stroke();
    ctx.restore();
  };

  // Draw 7 radiating woody dark-bark twigs from center
  const twigs: Array<{ x0: number; y0: number; x1: number; y1: number; angle: number }> = [];
  for (let b = 0; b < 7; b += 1) {
    const a = (b / 7) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const len = 145 + rand() * 68;
    const x1 = 256 + Math.cos(a) * len;
    const y1 = 256 + Math.sin(a) * len;
    twigs.push({ x0: 256, y0: 256, x1, y1, angle: a });

    ctx.strokeStyle = 'rgba(56, 42, 30, 0.94)';
    ctx.lineWidth = 5.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(256, 256);
    ctx.quadraticCurveTo(
      256 + Math.cos(a + 0.14) * len * 0.5,
      256 + Math.sin(a + 0.14) * len * 0.5,
      x1,
      y1,
    );
    ctx.stroke();

    // Secondary forked sub-twigs
    for (const side of [-1, 1]) {
      const subA = a + side * (0.48 + rand() * 0.25);
      const sx0 = 256 + Math.cos(a) * len * 0.52;
      const sy0 = 256 + Math.sin(a) * len * 0.52;
      const subLen = 64 + rand() * 44;
      const sx1 = sx0 + Math.cos(subA) * subLen;
      const sy1 = sy0 + Math.sin(subA) * subLen;
      twigs.push({ x0: sx0, y0: sy0, x1: sx1, y1: sy1, angle: subA });
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
    }
  }

  // Layer 1: Shaded deep-forest back leaves anchoring interior density
  for (let i = 0; i < 240; i += 1) {
    const tw = twigs[Math.floor(rand() * twigs.length)];
    const u = 0.12 + rand() * 0.88;
    const bx = tw.x0 + (tw.x1 - tw.x0) * u + (rand() - 0.5) * 34;
    const by = tw.y0 + (tw.y1 - tw.y0) * u + (rand() - 0.5) * 34;
    const distFromCenter = Math.hypot(bx - 256, by - 256);
    if (distFromCenter > 224) continue;

    const leafAngle = tw.angle + (rand() > 0.5 ? 1 : -1) * (0.45 + rand() * 0.85);
    const len = 24 + rand() * 20;
    const wid = 7.5 + rand() * 5.5;
    const r = 22 + Math.floor(rand() * 20);
    const g = 48 + Math.floor(rand() * 24);
    const b = 18 + Math.floor(rand() * 14);
    drawPointedLeaf(
      bx,
      by,
      leafAngle,
      len,
      wid,
      `rgba(${r}, ${g}, ${b}, 0.97)`,
      `rgba(${r + 14}, ${g + 18}, ${b + 8}, 0.45)`,
    );
  }

  // Layer 2: Rich natural midtone & warm sunlit outer olive-green leaves
  for (let i = 0; i < 310; i += 1) {
    const tw = twigs[Math.floor(rand() * twigs.length)];
    const u = 0.15 + rand() * 0.92;
    const bx = tw.x0 + (tw.x1 - tw.x0) * u + (rand() - 0.5) * 40;
    const by = tw.y0 + (tw.y1 - tw.y0) * u + (rand() - 0.5) * 40;
    const distFromCenter = Math.hypot(bx - 256, by - 256);
    if (distFromCenter > 236) continue;

    const leafAngle = tw.angle + (rand() - 0.5) * 1.9;
    const len = 20 + rand() * 22;
    const wid = 6.5 + rand() * 5.0;
    const sunMix = Math.min(1, distFromCenter / 210) * 0.6 + rand() * 0.4;
    const r = Math.round(34 + sunMix * 52 + rand() * 14);
    const g = Math.round(66 + sunMix * 64 + rand() * 18);
    const b = Math.round(24 + sunMix * 24 + rand() * 10);
    drawPointedLeaf(
      bx,
      by,
      leafAngle,
      len,
      wid,
      `rgba(${r}, ${g}, ${b}, 0.98)`,
      `rgba(${Math.min(220, r + 24)}, ${Math.min(230, g + 28)}, ${b + 12}, 0.52)`,
    );
  }

  const tex = new THREE.CanvasTexture(canvas);
  configureTexture(tex, true, maxAnisotropy, 1, 1, true);
  return tex;
}

/** Paint a furrowed natural Indian tree bark canvas (used for albedo + Sobel normal map). */
function createBarkCanvas(): HTMLCanvasElement {
  const size = 256;
  const [canvas, ctx] = createCanvas(size);
  const rand = seededRandom(4411);

  ctx.fillStyle = '#47392e';
  ctx.fillRect(0, 0, size, size);

  // Deep vertical bark fissures and weathered warm grey-brown ridges
  for (let i = 0; i < 160; i += 1) {
    const x = rand() * size;
    const w = 1.5 + rand() * 5.5;
    const bright = rand() > 0.45;
    ctx.fillStyle = bright
      ? `rgba(${86 + Math.floor(rand() * 28)}, ${72 + Math.floor(rand() * 24)}, ${58 + Math.floor(rand() * 18)}, 0.42)`
      : `rgba(${34 + Math.floor(rand() * 16)}, ${26 + Math.floor(rand() * 14)}, ${20 + Math.floor(rand() * 12)}, 0.55)`;
    ctx.fillRect(x, 0, w, size);
  }

  for (let i = 0; i < 240; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 18 + rand() * 58;
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(26, 20, 16, 0.58)' : 'rgba(116, 102, 86, 0.34)';
    ctx.lineWidth = 1.2 + rand() * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rand() - 0.5) * 10, y + len * 0.5, x + (rand() - 0.5) * 6, y + len);
    ctx.stroke();
  }

  return canvas;
}

/** Paint natural warm Yamuna alluvial riverbank sand & silt texture. */
function createRiverSandTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size);
  const rand = seededRandom(7331);
  ctx.fillStyle = '#b9a384';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 180; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 10 + rand() * 34;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    const wet = rand() > 0.55;
    g.addColorStop(0, wet ? 'rgba(134, 118, 94, 0.28)' : 'rgba(212, 194, 164, 0.24)');
    g.addColorStop(1, 'rgba(185, 163, 132, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Subtle wind-swept river silt ripples
  ctx.strokeStyle = 'rgba(138, 122, 98, 0.22)';
  ctx.lineWidth = 2;
  for (let y = 8; y < size; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.33, y + 4, size * 0.66, y - 4, size, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  configureTexture(tex, true, maxAnisotropy, 14, 4);
  return tex;
}

/** Helper to paint an authentic multi-petal Mughal Pietra Dura floral lotus/carnation motif. */
function drawPietraDuraBlossom(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  rot: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  // Carved shadow halo around inlaid semiprecious stone
  ctx.fillStyle = 'rgba(72, 64, 54, 0.25)';
  ctx.beginPath();
  ctx.arc(0, 0, 14 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Malachite-jade outer calyx leaves
  ctx.fillStyle = 'rgba(64, 102, 72, 0.78)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 6 * scale);
    ctx.quadraticCurveTo(s * 16 * scale, 2 * scale, s * 14 * scale, -8 * scale);
    ctx.quadraticCurveTo(s * 6 * scale, -2 * scale, 0, 2 * scale);
    ctx.closePath();
    ctx.fill();
  }

  // Carnelian-red & jasper layered lotus/tulip petals
  const petalAngles = [-0.62, -0.3, 0, 0.3, 0.62];
  for (let i = 0; i < petalAngles.length; i += 1) {
    const a = petalAngles[i];
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(166, 68, 52, 0.84)' : 'rgba(196, 106, 68, 0.82)';
    ctx.beginPath();
    ctx.moveTo(0, 4 * scale);
    ctx.bezierCurveTo(-5 * scale, -4 * scale, -4 * scale, -15 * scale, 0, -18 * scale);
    ctx.bezierCurveTo(4 * scale, -15 * scale, 5 * scale, -4 * scale, 0, 4 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Golden-ochre / yellow-jasper stamen heart
  ctx.fillStyle = 'rgba(204, 158, 72, 0.88)';
  ctx.beginPath();
  ctx.arc(0, -3 * scale, 3.2 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Draw intricate Mughal Pietra Dura inlay, carved dado floral sprays, chevron borders, and pointed arch molding over base marble. */
function drawInlayMarbleCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  drawMakranaMarbleDetail(ctx, baseSource, size);

  const sc = size / 512;
  const logical = 512;
  ctx.save();
  ctx.scale(sc, sc);

  // Subtle warm patina & lower foundation contact shading
  const vig = ctx.createLinearGradient(0, 0, 0, logical);
  vig.addColorStop(0, 'rgba(255, 252, 246, 0.08)');
  vig.addColorStop(0.78, 'rgba(205, 192, 172, 0.1)');
  vig.addColorStop(1, 'rgba(130, 118, 100, 0.28)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, logical, logical);

  // Deep carved slate-black inlaid outer border & geometric rope framing
  ctx.strokeStyle = 'rgba(48, 44, 40, 0.82)';
  ctx.lineWidth = 6.5;
  ctx.strokeRect(14, 14, logical - 28, logical - 28);
  ctx.strokeStyle = 'rgba(84, 78, 68, 0.65)';
  ctx.lineWidth = 2.6;
  ctx.strokeRect(28, 28, logical - 56, logical - 56);

  // Geometric Mughal black-and-ochre chevron inlay bands
  for (let i = 0; i < 20; i += 1) {
    const step = (logical - 56) / 20;
    const cx = 28 + i * step;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(50, 46, 42, 0.72)' : 'rgba(168, 122, 76, 0.56)';
    for (const cy of [40, logical - 40]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + step * 0.5, cy - 9.5);
      ctx.lineTo(cx + step, cy);
      ctx.lineTo(cx + step * 0.5, cy + 9.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Carved double-bevel recessed pointed-arch molding
  ctx.strokeStyle = 'rgba(88, 78, 66, 0.68)';
  ctx.lineWidth = 5.2;
  ctx.beginPath();
  ctx.moveTo(76, logical - 58);
  ctx.lineTo(76, 224);
  ctx.quadraticCurveTo(84, 122, logical * 0.5, 76);
  ctx.quadraticCurveTo(logical - 84, 122, logical - 76, 224);
  ctx.lineTo(logical - 76, logical - 58);
  ctx.stroke();

  // Fine inner raised highlight bevel along carved arch
  ctx.strokeStyle = 'rgba(255, 250, 240, 0.45)';
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(82, logical - 58);
  ctx.lineTo(82, 226);
  ctx.quadraticCurveTo(90, 128, logical * 0.5, 82);
  ctx.quadraticCurveTo(logical - 90, 128, logical - 82, 226);
  ctx.lineTo(logical - 82, logical - 58);
  ctx.stroke();

  // Symmetrical Pietra Dura scrolling arabesque vines & carved floral medallions in upper spandrels
  for (const side of [-1, 1]) {
    const ox = logical * 0.5 + side * (logical * 0.34);
    ctx.strokeStyle = 'rgba(66, 98, 72, 0.62)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(ox, 168);
    ctx.bezierCurveTo(ox - side * 40, 138, ox - side * 22, 92, ox - side * 82, 90);
    ctx.stroke();

    drawPietraDuraBlossom(ctx, ox - side * 12, 118, 1.18, -side * 0.35);
    drawPietraDuraBlossom(ctx, ox - side * 70, 92, 0.86, -side * 0.8);
  }

  // Central carved Mughal marble lily dado relief inside lower panel
  const baseY = logical - 78;
  ctx.strokeStyle = 'rgba(72, 100, 74, 0.52)';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(logical * 0.5, baseY);
  ctx.quadraticCurveTo(logical * 0.5 - 10, baseY - 110, logical * 0.5, baseY - 205);
  ctx.stroke();
  drawPietraDuraBlossom(ctx, logical * 0.5, baseY - 214, 1.65, 0);
  drawPietraDuraBlossom(ctx, logical * 0.5 - 70, baseY - 138, 1.18, -0.55);
  drawPietraDuraBlossom(ctx, logical * 0.5 + 70, baseY - 138, 1.18, 0.55);

  ctx.restore();
}

/** Draw Great Pishtaq black-marble Thuluth calligraphic framing & ornate Pietra Dura floral arabesque spandrels. */
function drawPishtaqFrameCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  drawMakranaMarbleDetail(ctx, baseSource, size);

  const sc = size / 1024;
  const logical = 1024;
  ctx.save();
  ctx.scale(sc, sc);

  // Subtle architectural weathering gradient (luminous crown -> warm weathered base)
  const pat = ctx.createLinearGradient(0, 0, 0, logical);
  pat.addColorStop(0, 'rgba(255, 253, 248, 0.08)');
  pat.addColorStop(0.75, 'rgba(210, 198, 178, 0.10)');
  pat.addColorStop(1, 'rgba(138, 126, 108, 0.28)');
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, logical, logical);

  // Bold, razor-sharp iconic black-jasper double framing border around the Great Pishtaq
  ctx.strokeStyle = 'rgba(22, 20, 19, 0.96)';
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, logical - 24, logical - 16);

  ctx.strokeStyle = 'rgba(26, 24, 22, 0.94)';
  ctx.lineWidth = 6;
  ctx.strokeRect(66, 66, logical - 132, logical - 70);

  // Subtle recessed inner rule lines flanking the calligraphy cartouche band
  ctx.strokeStyle = 'rgba(72, 66, 58, 0.72)';
  ctx.lineWidth = 2.2;
  ctx.strokeRect(21, 21, logical - 42, logical - 26);
  ctx.strokeRect(59, 59, logical - 118, logical - 64);

  // Inner pale ivory cartouche band backing the high-contrast Thuluth calligraphic inscription
  ctx.fillStyle = 'rgba(252, 246, 236, 0.62)';
  ctx.fillRect(22, 22, logical - 44, 36);
  ctx.fillRect(22, 58, 36, logical - 62);
  ctx.fillRect(logical - 58, 58, 36, logical - 62);

  // Razor-sharp inlaid black-jasper Thuluth calligraphic strokes + diacritical dots (Pietra Dura inlay)
  const randScript = seededRandom(1653);
  ctx.strokeStyle = 'rgba(18, 17, 16, 0.96)';
  ctx.fillStyle = 'rgba(18, 17, 16, 0.95)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Horizontal upper Quranic inscription band
  for (let x = 28; x < logical - 30; x += 11) {
    ctx.lineWidth = 3.2 + randScript() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, 46 + (randScript() - 0.5) * 5);
    ctx.bezierCurveTo(
      x + 3.5,
      25 + randScript() * 7,
      x + 7,
      49 - randScript() * 7,
      x + 10.5,
      38 + (randScript() - 0.5) * 9,
    );
    ctx.stroke();

    // Tall vertical Alif/Lam ascenders & crisp Thuluth baseline swoops
    if (randScript() > 0.42) {
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x + 4.5, 25);
      ctx.lineTo(x + 4.5, 49);
      ctx.stroke();
    }
    if (randScript() > 0.58) {
      const dx = x + 6;
      const dy = 27 + randScript() * 20;
      ctx.beginPath();
      ctx.moveTo(dx, dy - 2.3);
      ctx.lineTo(dx + 2.3, dy);
      ctx.lineTo(dx, dy + 2.3);
      ctx.lineTo(dx - 2.3, dy);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Left and right vertical inlaid calligraphic frames
  for (const sideX of [40, logical - 40]) {
    for (let y = 64; y < logical - 18; y += 11) {
      ctx.lineWidth = 3.0 + randScript() * 1.3;
      ctx.beginPath();
      ctx.moveTo(sideX - 11 + randScript() * 20, y);
      ctx.bezierCurveTo(
        sideX + (randScript() - 0.5) * 22,
        y + 3.5,
        sideX - 10 + randScript() * 20,
        y + 7.5,
        sideX - 6 + randScript() * 14,
        y + 10,
      );
      ctx.stroke();
      if (randScript() > 0.48) {
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(sideX - 11, y + 4);
        ctx.lineTo(sideX + 11, y + 4);
        ctx.stroke();
      }
      if (randScript() > 0.62) {
        ctx.fillRect(sideX + (randScript() - 0.5) * 16 - 1.6, y + 2, 3.2, 3.2);
      }
    }
  }

  // Intricate symmetrical Pietra Dura floral arabesque spandrels with spiraling vines & multi-petal lotus inlays
  const drawFloralSpandrel = (originX: number, dir: number) => {
    ctx.strokeStyle = 'rgba(84, 72, 52, 0.86)';
    ctx.lineWidth = 3.2;
    for (let k = 0; k < 8; k += 1) {
      const r = 20 + k * 14;
      const sx = originX + dir * (36 + k * 16);
      const sy = 92 + k * 18;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.44, 0, Math.PI * 1.55);
      ctx.stroke();

      if (k % 2 === 0) {
        drawPietraDuraBlossom(ctx, sx + dir * 6, sy - 4, 0.92 + k * 0.05, dir * (0.4 + k * 0.12));
      } else {
        ctx.fillStyle = k % 4 === 1 ? 'rgba(54, 94, 64, 0.82)' : 'rgba(52, 72, 112, 0.76)';
        ctx.beginPath();
        ctx.ellipse(sx + dir * 4, sy - 2, 7.5, 3.8, dir * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  drawFloralSpandrel(72, 1);
  drawFloralSpandrel(logical - 72, -1);

  // Carved double outline tracing the Mughal arch shoulder
  ctx.strokeStyle = 'rgba(34, 31, 28, 0.86)';
  ctx.lineWidth = 4.5;
  ctx.strokeRect(72, 72, logical - 144, logical - 78);

  ctx.restore();
}

/** Draw Makrana dome marble with subtle radial stone courses & vertical atmospheric weathering. */
function drawDomeMarbleCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  ctx.drawImage(baseSource, 0, 0, size, size);

  // Vertical weathering patina matching the real Taj Mahal onion dome photograph:
  // bright luminous sunlit crown -> subtle warm weathered ivory stone bands -> slightly deeper base shadow
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0.0, 'rgba(255, 254, 248, 0.16)');
  grad.addColorStop(0.45, 'rgba(240, 234, 222, 0.04)');
  grad.addColorStop(0.82, 'rgba(190, 178, 160, 0.14)');
  grad.addColorStop(1.0, 'rgba(148, 136, 118, 0.28)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
}

/** Draw Minaret banded Makrana masonry with signature dark inlaid horizontal joint rings. */
function drawMinaretBandCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  ctx.drawImage(baseSource, 0, 0, size, size);
  const sc = size / 512;
  const logical = 512;
  ctx.save();
  ctx.scale(sc, sc);

  const ringCount = 14;
  for (let i = 0; i < ringCount; i += 1) {
    const y = (i / ringCount) * logical;
    ctx.fillStyle = 'rgba(64, 59, 54, 0.62)';
    ctx.fillRect(0, y, logical, 3.4);
    for (let j = 0; j < 8; j += 1) {
      const x = ((j + (i % 2) * 0.5) / 8) * logical;
      ctx.fillStyle = 'rgba(84, 78, 70, 0.40)';
      ctx.fillRect(x, y, 2.2, logical / ringCount);
    }
  }
  ctx.restore();
}

/** Soft radial ground contact shadow texture for grounding structures and trees. */
function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = createCanvas(size);
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0, 'rgba(22, 24, 22, 0.72)');
  grad.addColorStop(0.48, 'rgba(26, 28, 25, 0.42)');
  grad.addColorStop(0.8, 'rgba(28, 30, 26, 0.12)');
  grad.addColorStop(1, 'rgba(28, 30, 26, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Geometric perforated Mughal Jali lattice texture for sanctuary window screens. */
function createJaliScreenTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size);
  ctx.fillStyle = '#36322d';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = '#cbc1b0';
  ctx.lineWidth = 3.5;
  const step = 32;
  for (let y = 0; y <= size; y += step) {
    for (let x = 0; x <= size; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, y - step * 0.5);
      ctx.lineTo(x + step * 0.5, y);
      ctx.lineTo(x, y + step * 0.5);
      ctx.lineTo(x - step * 0.5, y);
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, step * 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  configureTexture(tex, true, maxAnisotropy, 1, 2);
  return tex;
}

/** Paint authentic Mughal white Makrana marble ashlar/checkered courtyard deck paving. */
function drawMarbleDeckCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  ctx.drawImage(baseSource, 0, 0, size, size);
  const sc = size / 512;
  const logical = 512;
  ctx.save();
  ctx.scale(sc, sc);
  const rand = seededRandom(1648);
  const cells = 8;
  const step = logical / cells;

  for (let gy = 0; gy < cells; gy += 1) {
    for (let gx = 0; gx < cells; gx += 1) {
      const checker = (gx + gy) % 2 === 0;
      const shade = checker
        ? `rgba(255, 252, 245, ${0.08 + rand() * 0.08})`
        : `rgba(182, 170, 152, ${0.1 + rand() * 0.08})`;
      ctx.fillStyle = shade;
      ctx.fillRect(gx * step, gy * step, step, step);

      // Fine recessed marble mortar joint lines
      ctx.strokeStyle = 'rgba(116, 108, 96, 0.42)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(gx * step, gy * step, step, step);
    }
  }

  // Subtle black-slate Mughal geometric border framing
  ctx.strokeStyle = 'rgba(66, 62, 58, 0.36)';
  ctx.lineWidth = 2.2;
  ctx.strokeRect(4, 4, logical - 8, logical - 8);
  ctx.restore();
}

/** Paint seamless un-gridded weathered Agra red sandstone grain (for individual 3D flagstones with zero double-tiling). */
function drawSandstoneGrainCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource | null,
  size: number,
): void {
  if (baseSource) {
    ctx.drawImage(baseSource, 0, 0, size, size);
  } else {
    ctx.fillStyle = '#a8644f';
    ctx.fillRect(0, 0, size, size);
  }
  const sc = size / 512;
  const logical = 512;
  ctx.save();
  ctx.scale(sc, sc);
  const rand = seededRandom(1649);

  // Subtle sedimentary Agra red sandstone mineral bands & weathered warm wash
  for (let i = 0; i < 42; i += 1) {
    const x = rand() * logical;
    const y = rand() * logical;
    const r = 24 + rand() * 72;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, r);
    const warm = rand() > 0.45;
    grad.addColorStop(0, warm ? 'rgba(218, 168, 134, 0.14)' : 'rgba(116, 58, 46, 0.13)');
    grad.addColorStop(1, 'rgba(164, 98, 76, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fine mineral grain pores & dusty quartz flecks (scales sharply at 2048px)
  for (let s = 0; s < 680; s += 1) {
    const sx = rand() * logical;
    const sy = rand() * logical;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(78, 42, 32, 0.15)' : 'rgba(232, 206, 182, 0.12)';
    ctx.fillRect(sx, sy, 0.9 + rand() * 1.6, 0.8 + rand() * 1.4);
  }
  ctx.restore();
}

/** Paint authentic square & balanced rectangular Agra red sandstone flagstones with soft matte mortar seams (zero specular grout glare). */
function drawSandstonePavingCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  drawSandstoneGrainCanvas(ctx, baseSource, size);
  const sc = size / 512;
  const logical = 512;
  ctx.save();
  ctx.scale(sc, sc);
  const rand = seededRandom(1642);

  // Properly proportioned square & balanced rectangular Agra red sandstone flagstones (4x4 alternating ashlar coursing)
  const rows = 4;
  const cols = 4;
  const rowH = logical / rows;
  const colW = logical / cols;

  for (let r = 0; r < rows; r += 1) {
    const offset = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c += 1) {
      const x = c * colW + offset;
      const y = r * rowH;
      const v = rand();
      // Authentic Agra red sandstone color variation: warm terracotta, dusty ochre, faded rose-stone, muted clay
      if (v > 0.72) {
        ctx.fillStyle = `rgba(214, 166, 134, ${0.14 + rand() * 0.09})`;
      } else if (v > 0.46) {
        ctx.fillStyle = `rgba(182, 118, 92, ${0.10 + rand() * 0.08})`;
      } else if (v > 0.22) {
        ctx.fillStyle = `rgba(136, 72, 56, ${0.13 + rand() * 0.10})`;
      } else {
        ctx.fillStyle = `rgba(122, 74, 64, ${0.15 + rand() * 0.08})`;
      }
      ctx.fillRect(x, y, colW, rowH);

      // Soft weathered patina & mineral clouding across slab surface
      const patchX = x + (0.25 + rand() * 0.5) * colW;
      const patchY = y + (0.25 + rand() * 0.5) * rowH;
      const patchR = Math.min(colW, rowH) * (0.45 + rand() * 0.45);
      const grad = ctx.createRadialGradient(patchX, patchY, 2, patchX, patchY, patchR);
      if (rand() > 0.45) {
        grad.addColorStop(0, `rgba(224, 196, 174, ${0.09 + rand() * 0.06})`);
        grad.addColorStop(1, 'rgba(224, 196, 174, 0)');
      } else {
        grad.addColorStop(0, `rgba(92, 54, 44, ${0.10 + rand() * 0.07})`);
        grad.addColorStop(1, 'rgba(92, 54, 44, 0)');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, colW, rowH);

      // Soft matte dusty-earth lime mortar seams (toned down so angled sunlight never glares along grout lines!)
      ctx.strokeStyle = `rgba(122, 110, 100, ${0.44 + rand() * 0.14})`;
      ctx.lineWidth = 1.9 + rand() * 0.5;
      ctx.strokeRect(x + 0.5, y + 0.5, colW - 1.0, rowH - 1.0);

      // Very subtle micro-recess line right inside mortar seam
      ctx.strokeStyle = 'rgba(84, 68, 60, 0.20)';
      ctx.lineWidth = 0.85;
      ctx.strokeRect(x + 2.0, y + 2.0, colW - 4.0, rowH - 4.0);

      // Whisper-soft warm chamfer edge (heavily toned down to prevent bright white specular glare!)
      ctx.strokeStyle = `rgba(224, 200, 178, ${0.05 + rand() * 0.04})`;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(x + 3.0, y + rowH - 3.5);
      ctx.lineTo(x + 3.0, y + 3.0);
      ctx.lineTo(x + colW - 3.5, y + 3.0);
      ctx.stroke();

      // Occasional whisper of damp moss tucked along shaded mortar seams
      if (rand() > 0.62) {
        ctx.strokeStyle = `rgba(74, 92, 50, ${0.16 + rand() * 0.12})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x + rand() * colW * 0.4, y + 1.5);
        ctx.lineTo(x + colW * (0.45 + rand() * 0.3), y + 1.5);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** Paint dense, natural, unstriped dark-emerald boxwood leaf foliage texture for sculpted Mughal hedges. */
function createBoxwoodFoliageCanvas(): HTMLCanvasElement {
  const size = 256;
  const [canvas, ctx] = createCanvas(size);
  const rand = seededRandom(6421);

  // Deep organic shaded boxwood foliage interior
  ctx.fillStyle = '#1e3619';
  ctx.fillRect(0, 0, size, size);

  // Hundreds of tightly packed tiny oval boxwood leaves at random orientations (zero stripes!)
  for (let i = 0; i < 950; i += 1) {
    const lx = rand() * size;
    const ly = rand() * size;
    const ang = rand() * Math.PI * 2;
    const rx = 4.2 + rand() * 4.5;
    const ry = 2.4 + rand() * 2.5;
    const light = rand();
    const r = Math.round(24 + light * 44);
    const g = Math.round(52 + light * 62);
    const b = Math.round(20 + light * 22);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.92)`;

    // Tile-seamless wrap across canvas edges
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const px = lx + ox;
        const py = ly + oy;
        if (px < -12 || px > size + 12 || py < -12 || py > size + 12) continue;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  return canvas;
}

/** Composite photographic Mughal lawn tile with soft organic meadow mottling (very gentle mowing bands so 3D grass blends seamlessly). */
function drawManicuredGrassCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  ctx.drawImage(baseSource, 0, 0, size, size);
  const sc = size / 512;
  const logical = 512;
  ctx.save();
  ctx.scale(sc, sc);
  const rand = seededRandom(1635);

  // Very subtle, soft lawn tone variation (no harsh dark mowing stripes!)
  const stripes = 4;
  const stripeW = logical / stripes;
  for (let i = 0; i < stripes; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(220, 238, 186, 0.022)' : 'rgba(26, 52, 20, 0.026)';
    ctx.fillRect(i * stripeW, 0, stripeW, logical);
  }

  // Rich organic soil/clover/turf mottling so dense 3D grass tufts blend naturally into the ground
  for (let i = 0; i < 110; i += 1) {
    const x = rand() * logical;
    const y = rand() * logical;
    const r = 12 + rand() * 38;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    const roll = rand();
    if (roll > 0.62) {
      g.addColorStop(0, 'rgba(116, 138, 62, 0.14)');
    } else if (roll > 0.25) {
      g.addColorStop(0, 'rgba(32, 64, 22, 0.15)');
    } else {
      g.addColorStop(0, 'rgba(66, 56, 36, 0.12)');
    }
    g.addColorStop(1, 'rgba(52, 86, 34, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Paint a lush botanical Mughal rose/marigold/jasmine border flowerbed tuft texture. */
function createFlowerTuftTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = createCanvas(size);
  const rand = seededRandom(9941);
  ctx.clearRect(0, 0, size, size);

  // Rich leafy green foliage base
  for (let i = 0; i < 160; i += 1) {
    const x = 30 + rand() * 196;
    const y = 90 + rand() * 150;
    const a = -Math.PI * 0.5 + (rand() - 0.5) * 1.4;
    const len = 14 + rand() * 24;
    ctx.strokeStyle = `rgba(${28 + Math.floor(rand() * 24)}, ${62 + Math.floor(rand() * 34)}, ${22 + Math.floor(rand() * 16)}, 0.96)`;
    ctx.lineWidth = 3 + rand() * 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  // Subtle crimson rose, warm marigold, and ivory jasmine blossoms
  const blossomPalette = [
    'rgba(186, 56, 62, 0.96)',
    'rgba(224, 146, 48, 0.96)',
    'rgba(244, 236, 218, 0.95)',
    'rgba(212, 92, 96, 0.95)',
  ];
  for (let i = 0; i < 42; i += 1) {
    const bx = 42 + rand() * 172;
    const by = 78 + rand() * 116;
    const br = 4.2 + rand() * 4.5;
    ctx.fillStyle = blossomPalette[Math.floor(rand() * blossomPalette.length)];
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  configureTexture(tex, true, maxAnisotropy, 1, 1, true);
  return tex;
}

export interface ProceduralTextureSet {
  marbleMap: THREE.CanvasTexture;
  marbleNormal: THREE.CanvasTexture;
  marbleRoughness: THREE.CanvasTexture;
  marbleAo: THREE.CanvasTexture;
  marbleDomeMap: THREE.CanvasTexture;
  marbleDeckMap: THREE.CanvasTexture;
  marbleDeckNormal: THREE.CanvasTexture;
  marbleDeckRoughness: THREE.CanvasTexture;
  marbleDeckAo: THREE.CanvasTexture;
  inlayPanelMap: THREE.CanvasTexture;
  inlayPanelNormal: THREE.CanvasTexture;
  inlayPanelRoughness: THREE.CanvasTexture;
  inlayPanelAo: THREE.CanvasTexture;
  pishtaqFrameMap: THREE.CanvasTexture;
  pishtaqFrameNormal: THREE.CanvasTexture;
  pishtaqFrameAo: THREE.CanvasTexture;
  minaretBandMap: THREE.CanvasTexture;
  jaliScreenMap: THREE.CanvasTexture;
  sandstoneMap: THREE.CanvasTexture;
  sandstoneNormal: THREE.CanvasTexture;
  sandstoneRoughness: THREE.CanvasTexture;
  sandstoneAo: THREE.CanvasTexture;
  walkwayPavingMap: THREE.CanvasTexture;
  walkwayPavingNormal: THREE.CanvasTexture;
  walkwayPavingRoughness: THREE.CanvasTexture;
  walkwayPavingAo: THREE.CanvasTexture;
  sandstoneGrainMap: THREE.CanvasTexture;
  sandstoneGrainNormal: THREE.CanvasTexture;
  boxwoodMap: THREE.CanvasTexture;
  boxwoodNormal: THREE.CanvasTexture;
  grassMap: THREE.CanvasTexture;
  grassNormal: THREE.CanvasTexture;
  grassRoughness: THREE.CanvasTexture;
  cypressSprigMap: THREE.CanvasTexture;
  leafClusterMap: THREE.CanvasTexture;
  flowerTuftMap: THREE.CanvasTexture;
  barkMap: THREE.CanvasTexture;
  barkNormal: THREE.CanvasTexture;
  barkRoughness: THREE.CanvasTexture;
  riverSandMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  cloudBankMap: THREE.CanvasTexture;
  cloudTowerMap: THREE.CanvasTexture;
  cloudWispyMap: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(
  maxAnisotropy: number,
  tier: PerformanceTier = 'desktop',
): ProceduralTextureSet {
  const textures: THREE.Texture[] = [];
  const track = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  // --- Ultra-HD 2048x2048 (2K/4K) procedural architectural & PBR maps on desktop GPU ---
  const isDesktop = tier === 'desktop';
  const size = isDesktop ? 2048 : 1024;
  const hiSize = isDesktop ? 2048 : 1024;
  const pbrSize = isDesktop ? 1024 : 512;
  const grainNormSize = isDesktop ? 512 : 256;

  const [marbleCanvas, marbleCtx] = createCanvas(size);
  drawMakranaMarbleDetail(marbleCtx, null, size);

  const [sandCanvas, sandCtx] = createCanvas(size);
  sandCtx.fillStyle = '#a45e49';
  sandCtx.fillRect(0, 0, size, size);
  drawSandstonePavingCanvas(sandCtx, sandCanvas, size);

  const [grassCanvas, grassCtx] = createCanvas(isDesktop ? 1024 : 512);
  grassCtx.fillStyle = '#3f6b28';
  grassCtx.fillRect(0, 0, grassCanvas.width, grassCanvas.height);
  drawManicuredGrassCanvas(grassCtx, grassCanvas, grassCanvas.width);

  // Derived architectural canvases (full 2048px on desktop for razor-sharp calligraphy, Pietra Dura & paving)
  const [domeCanvas, domeCtx] = createCanvas(size);
  drawDomeMarbleCanvas(domeCtx, marbleCanvas, size);

  const [deckCanvas, deckCtx] = createCanvas(size);
  drawMarbleDeckCanvas(deckCtx, marbleCanvas, size);

  const [inlayCanvas, inlayCtx] = createCanvas(hiSize);
  drawInlayMarbleCanvas(inlayCtx, marbleCanvas, hiSize);

  const [pishtaqCanvas, pishtaqCtx] = createCanvas(hiSize);
  drawPishtaqFrameCanvas(pishtaqCtx, marbleCanvas, hiSize);

  const [minaretCanvas, minaretCtx] = createCanvas(isDesktop ? 1024 : 512);
  drawMinaretBandCanvas(minaretCtx, marbleCanvas, minaretCanvas.width);

  const [walkwayCanvas, walkwayCtx] = createCanvas(size);
  drawSandstonePavingCanvas(walkwayCtx, sandCanvas, size);

  const [sandGrainCanvas, sandGrainCtx] = createCanvas(isDesktop ? 1024 : 512);
  drawSandstoneGrainCanvas(sandGrainCtx, null, sandGrainCanvas.width);

  const [sandGrainNormCanvas, sandGrainNormCtx] = createCanvas(grainNormSize);

  // High-res PBR Normal, Roughness, and Ambient Occlusion map canvases (1024px on desktop, 512px mobile/software)
  const [marbleNormCanvas, marbleNormCtx] = createCanvas(pbrSize);
  const [marbleRghCanvas, marbleRghCtx] = createCanvas(pbrSize);
  const [marbleAoCanvas, marbleAoCtx] = createCanvas(pbrSize);

  const [deckNormCanvas, deckNormCtx] = createCanvas(pbrSize);
  const [deckRghCanvas, deckRghCtx] = createCanvas(pbrSize);
  const [deckAoCanvas, deckAoCtx] = createCanvas(pbrSize);

  const [inlayNormCanvas, inlayNormCtx] = createCanvas(pbrSize);
  const [inlayRghCanvas, inlayRghCtx] = createCanvas(pbrSize);
  const [inlayAoCanvas, inlayAoCtx] = createCanvas(pbrSize);

  const [pishtaqNormCanvas, pishtaqNormCtx] = createCanvas(pbrSize);
  const [pishtaqAoCanvas, pishtaqAoCtx] = createCanvas(pbrSize);

  const [sandNormCanvas, sandNormCtx] = createCanvas(pbrSize);
  const [sandRghCanvas, sandRghCtx] = createCanvas(pbrSize);
  const [sandAoCanvas, sandAoCtx] = createCanvas(pbrSize);

  const [walkwayNormCanvas, walkwayNormCtx] = createCanvas(pbrSize);
  const [walkwayRghCanvas, walkwayRghCtx] = createCanvas(pbrSize);
  const [walkwayAoCanvas, walkwayAoCtx] = createCanvas(pbrSize);

  const [grassNormCanvas, grassNormCtx] = createCanvas(512);
  const [grassRghCanvas, grassRghCtx] = createCanvas(512);

  const rebuildMarbleDerivedMaps = () => {
    marbleNormCtx.drawImage(generateNormalMapFromCanvas(marbleCanvas, 2.8, pbrSize), 0, 0);
    const mPbr = generateRoughnessAndAoFromCanvas(marbleCanvas, pbrSize, 0.24, 0.66, 0.42);
    marbleRghCtx.drawImage(mPbr.roughCanvas, 0, 0);
    marbleAoCtx.drawImage(mPbr.aoCanvas, 0, 0);

    deckNormCtx.drawImage(generateNormalMapFromCanvas(deckCanvas, 3.2, pbrSize), 0, 0);
    const dPbr = generateRoughnessAndAoFromCanvas(deckCanvas, pbrSize, 0.18, 0.58, 0.55);
    deckRghCtx.drawImage(dPbr.roughCanvas, 0, 0);
    deckAoCtx.drawImage(dPbr.aoCanvas, 0, 0);

    inlayNormCtx.drawImage(generateNormalMapFromCanvas(inlayCanvas, 4.2, pbrSize), 0, 0);
    const iPbr = generateRoughnessAndAoFromCanvas(inlayCanvas, pbrSize, 0.16, 0.62, 0.58);
    inlayRghCtx.drawImage(iPbr.roughCanvas, 0, 0);
    inlayAoCtx.drawImage(iPbr.aoCanvas, 0, 0);

    pishtaqNormCtx.drawImage(generateNormalMapFromCanvas(pishtaqCanvas, 4.8, pbrSize), 0, 0);
    const pPbr = generateRoughnessAndAoFromCanvas(pishtaqCanvas, pbrSize, 0.18, 0.64, 0.66);
    pishtaqAoCtx.drawImage(pPbr.aoCanvas, 0, 0);
  };

  const rebuildSandstoneDerivedMaps = () => {
    sandNormCtx.drawImage(generateNormalMapFromCanvas(sandCanvas, 3.0, pbrSize), 0, 0);
    const sPbr = generateRoughnessAndAoFromCanvas(sandCanvas, pbrSize, 0.72, 0.98, 0.46);
    sandRghCtx.drawImage(sPbr.roughCanvas, 0, 0);
    sandAoCtx.drawImage(sPbr.aoCanvas, 0, 0);

    walkwayNormCtx.drawImage(generateNormalMapFromCanvas(walkwayCanvas, 2.6, pbrSize), 0, 0);
    const wPbr = generateRoughnessAndAoFromCanvas(walkwayCanvas, pbrSize, 0.78, 0.98, 0.38);
    walkwayRghCtx.drawImage(wPbr.roughCanvas, 0, 0);
    walkwayAoCtx.drawImage(wPbr.aoCanvas, 0, 0);

    sandGrainNormCtx.drawImage(generateNormalMapFromCanvas(sandGrainCanvas, 2.5, grainNormSize), 0, 0);
  };

  const rebuildGrassDerivedMaps = () => {
    grassNormCtx.drawImage(generateNormalMapFromCanvas(grassCanvas, 3.2, 512), 0, 0);
    const gPbr = generateRoughnessAndAoFromCanvas(grassCanvas, 512, 0.68, 0.98, 0.35);
    grassRghCtx.drawImage(gPbr.roughCanvas, 0, 0);
  };

  rebuildMarbleDerivedMaps();
  rebuildSandstoneDerivedMaps();
  rebuildGrassDerivedMaps();

  // Configure AO textures with channel = 0 so they automatically sample primary UVs on every geometry!
  const configureAo = (tex: THREE.Texture, repeatX: number, repeatY: number) => {
    configureTexture(tex, false, maxAnisotropy, repeatX, repeatY);
    tex.channel = 0;
    return tex;
  };

  const marbleMap = track(new THREE.CanvasTexture(marbleCanvas));
  configureTexture(marbleMap, true, maxAnisotropy, 2, 2);
  const marbleNormal = track(new THREE.CanvasTexture(marbleNormCanvas));
  configureTexture(marbleNormal, false, maxAnisotropy, 2, 2);
  const marbleRoughness = track(new THREE.CanvasTexture(marbleRghCanvas));
  configureTexture(marbleRoughness, false, maxAnisotropy, 2, 2);
  const marbleAo = track(new THREE.CanvasTexture(marbleAoCanvas));
  configureAo(marbleAo, 2, 2);

  const marbleDomeMap = track(new THREE.CanvasTexture(domeCanvas));
  configureTexture(marbleDomeMap, true, maxAnisotropy, 4, 2);

  const marbleDeckMap = track(new THREE.CanvasTexture(deckCanvas));
  configureTexture(marbleDeckMap, true, maxAnisotropy, 10, 10);
  const marbleDeckNormal = track(new THREE.CanvasTexture(deckNormCanvas));
  configureTexture(marbleDeckNormal, false, maxAnisotropy, 10, 10);
  const marbleDeckRoughness = track(new THREE.CanvasTexture(deckRghCanvas));
  configureTexture(marbleDeckRoughness, false, maxAnisotropy, 10, 10);
  const marbleDeckAo = track(new THREE.CanvasTexture(deckAoCanvas));
  configureAo(marbleDeckAo, 10, 10);

  const inlayPanelMap = track(new THREE.CanvasTexture(inlayCanvas));
  configureTexture(inlayPanelMap, true, maxAnisotropy, 1, 1);
  const inlayPanelNormal = track(new THREE.CanvasTexture(inlayNormCanvas));
  configureTexture(inlayPanelNormal, false, maxAnisotropy, 1, 1);
  const inlayPanelRoughness = track(new THREE.CanvasTexture(inlayRghCanvas));
  configureTexture(inlayPanelRoughness, false, maxAnisotropy, 1, 1);
  const inlayPanelAo = track(new THREE.CanvasTexture(inlayAoCanvas));
  configureAo(inlayPanelAo, 1, 1);

  const pishtaqFrameMap = track(new THREE.CanvasTexture(pishtaqCanvas));
  configureTexture(pishtaqFrameMap, true, maxAnisotropy, 1, 1);
  const pishtaqFrameNormal = track(new THREE.CanvasTexture(pishtaqNormCanvas));
  configureTexture(pishtaqFrameNormal, false, maxAnisotropy, 1, 1);
  const pishtaqFrameAo = track(new THREE.CanvasTexture(pishtaqAoCanvas));
  configureAo(pishtaqFrameAo, 1, 1);

  const minaretBandMap = track(new THREE.CanvasTexture(minaretCanvas));
  configureTexture(minaretBandMap, true, maxAnisotropy, 1, 2);

  const sandstoneMap = track(new THREE.CanvasTexture(sandCanvas));
  configureTexture(sandstoneMap, true, maxAnisotropy, 14, 14);
  const sandstoneNormal = track(new THREE.CanvasTexture(sandNormCanvas));
  configureTexture(sandstoneNormal, false, maxAnisotropy, 14, 14);
  const sandstoneRoughness = track(new THREE.CanvasTexture(sandRghCanvas));
  configureTexture(sandstoneRoughness, false, maxAnisotropy, 14, 14);
  const sandstoneAo = track(new THREE.CanvasTexture(sandAoCanvas));
  configureAo(sandstoneAo, 14, 14);

  // True 1:1 world-meter flagstone proportions on the 4.4m x 104m walkway (repeat 1.5 x 34 -> ~0.73m square flagstones!)
  const walkwayPavingMap = track(new THREE.CanvasTexture(walkwayCanvas));
  configureTexture(walkwayPavingMap, true, maxAnisotropy, 1.5, 34);
  const walkwayPavingNormal = track(new THREE.CanvasTexture(walkwayNormCanvas));
  configureTexture(walkwayPavingNormal, false, maxAnisotropy, 1.5, 34);
  const walkwayPavingRoughness = track(new THREE.CanvasTexture(walkwayRghCanvas));
  configureTexture(walkwayPavingRoughness, false, maxAnisotropy, 1.5, 34);
  const walkwayPavingAo = track(new THREE.CanvasTexture(walkwayAoCanvas));
  configureAo(walkwayPavingAo, 1.5, 34);

  // Seamless un-gridded sandstone grain for individual micro-tilted 3D foreground flagstones
  const sandstoneGrainMap = track(new THREE.CanvasTexture(sandGrainCanvas));
  configureTexture(sandstoneGrainMap, true, maxAnisotropy, 1, 1);
  const sandstoneGrainNormal = track(new THREE.CanvasTexture(sandGrainNormCanvas));
  configureTexture(sandstoneGrainNormal, false, maxAnisotropy, 1, 1);

  // Unstriped dense small-leaf boxwood foliage map & normal for softly rounded Mughal hedges
  const boxwoodCanvas = createBoxwoodFoliageCanvas();
  const boxwoodMap = track(new THREE.CanvasTexture(boxwoodCanvas));
  configureTexture(boxwoodMap, true, maxAnisotropy, 4, 4);
  const boxwoodNormal = track(new THREE.CanvasTexture(generateNormalMapFromCanvas(boxwoodCanvas, 3.6, 256)));
  configureTexture(boxwoodNormal, false, maxAnisotropy, 4, 4);

  const grassMap = track(new THREE.CanvasTexture(grassCanvas));
  configureTexture(grassMap, true, maxAnisotropy, 30, 30);
  const grassNormal = track(new THREE.CanvasTexture(grassNormCanvas));
  configureTexture(grassNormal, false, maxAnisotropy, 30, 30);
  const grassRoughness = track(new THREE.CanvasTexture(grassRghCanvas));
  configureTexture(grassRoughness, false, maxAnisotropy, 30, 30);

  // --- Load real photorealistic tile assets & composite into all high-res PBR maps ---
  const loadPhotoTile = (url: string, onLoaded: (img: HTMLImageElement) => void) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => onLoaded(img);
    img.src = url;
  };

  loadPhotoTile(MARBLE_PHOTO_URL, (img) => {
    drawMakranaMarbleDetail(marbleCtx, img, size);
    drawDomeMarbleCanvas(domeCtx, marbleCanvas, size);
    drawMarbleDeckCanvas(deckCtx, img, size);
    drawInlayMarbleCanvas(inlayCtx, img, hiSize);
    drawPishtaqFrameCanvas(pishtaqCtx, img, hiSize);
    drawMinaretBandCanvas(minaretCtx, marbleCanvas, minaretCanvas.width);
    rebuildMarbleDerivedMaps();

    marbleMap.needsUpdate = true;
    marbleNormal.needsUpdate = true;
    marbleRoughness.needsUpdate = true;
    marbleAo.needsUpdate = true;
    marbleDomeMap.needsUpdate = true;
    marbleDeckMap.needsUpdate = true;
    marbleDeckNormal.needsUpdate = true;
    marbleDeckRoughness.needsUpdate = true;
    marbleDeckAo.needsUpdate = true;
    inlayPanelMap.needsUpdate = true;
    inlayPanelNormal.needsUpdate = true;
    inlayPanelRoughness.needsUpdate = true;
    inlayPanelAo.needsUpdate = true;
    pishtaqFrameMap.needsUpdate = true;
    pishtaqFrameNormal.needsUpdate = true;
    pishtaqFrameAo.needsUpdate = true;
    minaretBandMap.needsUpdate = true;
  });

  loadPhotoTile(SANDSTONE_PHOTO_URL, (img) => {
    drawSandstonePavingCanvas(sandCtx, img, size);
    drawSandstonePavingCanvas(walkwayCtx, img, size);
    drawSandstoneGrainCanvas(sandGrainCtx, img, sandGrainCanvas.width);
    rebuildSandstoneDerivedMaps();

    sandstoneMap.needsUpdate = true;
    sandstoneNormal.needsUpdate = true;
    sandstoneRoughness.needsUpdate = true;
    sandstoneAo.needsUpdate = true;
    walkwayPavingMap.needsUpdate = true;
    walkwayPavingNormal.needsUpdate = true;
    walkwayPavingRoughness.needsUpdate = true;
    walkwayPavingAo.needsUpdate = true;
    sandstoneGrainMap.needsUpdate = true;
    sandstoneGrainNormal.needsUpdate = true;
  });

  loadPhotoTile(GRASS_PHOTO_URL, (img) => {
    drawManicuredGrassCanvas(grassCtx, img, grassCanvas.width);
    rebuildGrassDerivedMaps();

    grassMap.needsUpdate = true;
    grassNormal.needsUpdate = true;
    grassRoughness.needsUpdate = true;
  });

  // Botanical foliage sprigs, flower borders, furrowed tree bark, riverbank sand, jali screen & contact shadows
  const jaliScreenMap = track(createJaliScreenTexture(maxAnisotropy));
  const cypressSprigMap = track(createCypressSprigTexture(maxAnisotropy));
  const leafClusterMap = track(createLeafClusterTexture(maxAnisotropy));
  const flowerTuftMap = track(createFlowerTuftTexture(maxAnisotropy));
  const barkCanvas = createBarkCanvas();
  const barkMap = track(new THREE.CanvasTexture(barkCanvas));
  configureTexture(barkMap, true, maxAnisotropy, 2, 3);
  const barkNormal = track(new THREE.CanvasTexture(generateNormalMapFromCanvas(barkCanvas, 3.8, 256)));
  configureTexture(barkNormal, false, maxAnisotropy, 2, 3);
  const barkPbr = generateRoughnessAndAoFromCanvas(barkCanvas, 256, 0.72, 0.98, 0.45);
  const barkRoughness = track(new THREE.CanvasTexture(barkPbr.roughCanvas));
  configureTexture(barkRoughness, false, maxAnisotropy, 2, 3);
  const riverSandMap = track(createRiverSandTexture(maxAnisotropy));
  const contactShadowMap = track(createContactShadowTexture());
  contactShadowMap.anisotropy = maxAnisotropy;
  const cloudBankMap = track(createCloudFbmTexture(301, 384, 192, 'bank', maxAnisotropy));
  const cloudTowerMap = track(createCloudFbmTexture(709, 320, 224, 'tower', maxAnisotropy));
  const cloudWispyMap = track(createCloudFbmTexture(1217, 384, 160, 'wispy', maxAnisotropy));

  return {
    marbleMap,
    marbleNormal,
    marbleRoughness,
    marbleAo,
    marbleDomeMap,
    marbleDeckMap,
    marbleDeckNormal,
    marbleDeckRoughness,
    marbleDeckAo,
    inlayPanelMap,
    inlayPanelNormal,
    inlayPanelRoughness,
    inlayPanelAo,
    pishtaqFrameMap,
    pishtaqFrameNormal,
    pishtaqFrameAo,
    minaretBandMap,
    jaliScreenMap,
    sandstoneMap,
    sandstoneNormal,
    sandstoneRoughness,
    sandstoneAo,
    walkwayPavingMap,
    walkwayPavingNormal,
    walkwayPavingRoughness,
    walkwayPavingAo,
    sandstoneGrainMap,
    sandstoneGrainNormal,
    boxwoodMap,
    boxwoodNormal,
    grassMap,
    grassNormal,
    grassRoughness,
    cypressSprigMap,
    leafClusterMap,
    flowerTuftMap,
    barkMap,
    barkNormal,
    barkRoughness,
    riverSandMap,
    contactShadowMap,
    cloudBankMap,
    cloudTowerMap,
    cloudWispyMap,
    dispose: () => {
      for (const tex of textures) {
        tex.dispose();
      }
    },
  };
}
