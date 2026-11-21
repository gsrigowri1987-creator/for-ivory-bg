import * as THREE from 'three';

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

/** Generate a real tangent-space normal map from any canvas via Sobel gradient filter. */
function generateNormalMapFromCanvas(sourceCanvas: HTMLCanvasElement, strength = 2.2): HTMLCanvasElement {
  const w = 256;
  const h = 256;
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

/** Paint a high-detail 512x512 evergreen Indian cypress foliage spray with scale-like upward conifer needles. */
function createCypressSprigTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = createCanvas(size);
  const rand = seededRandom(8821);
  ctx.clearRect(0, 0, size, size);

  // Subtle dark woody inner stems
  ctx.strokeStyle = 'rgba(34, 28, 20, 0.92)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(256, 470);
  ctx.lineTo(256, 110);
  ctx.stroke();

  // Dense shaded conifer interior mass
  for (let i = 0; i < 420; i += 1) {
    const t = rand();
    const y = 66 + t * 400;
    const widthProfile = Math.sin(Math.pow(t, 0.65) * Math.PI) * 165 + 18;
    const x = 256 + (rand() - 0.5) * 2 * widthProfile * 0.72;
    const r = 10 + rand() * 18;
    ctx.fillStyle = `rgba(${18 + Math.floor(rand() * 14)}, ${36 + Math.floor(rand() * 18)}, ${14 + Math.floor(rand() * 10)}, 0.92)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.7, r * 1.15, (rand() - 0.5) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Over 1,400 feathery upward-curving cypress scale-leaf sprays for authentic dark velvety contour
  for (let i = 0; i < 1450; i += 1) {
    const t = rand();
    const cy = 46 + t * 432;
    const widthProfile = Math.sin(Math.pow(t, 0.62) * Math.PI) * 176 + 14;
    const normX = (rand() - 0.5) * 2;
    const cx = 256 + normX * widthProfile * (0.35 + 0.65 * Math.sqrt(rand()));
    const len = 14 + rand() * 26;
    const angle = -Math.PI * 0.5 + normX * 0.42 + (rand() - 0.5) * 0.48;

    const tipX = cx + Math.cos(angle) * len;
    const tipY = cy + Math.sin(angle) * len;

    const outerBoost = Math.abs(normX) * 0.55 + (1 - t) * 0.35;
    const tone = rand() * 0.6 + outerBoost * 0.4;
    let rCol: number;
    let gCol: number;
    let bCol: number;
    if (tone > 0.76) {
      // Sunlit warm olive-cypress tips
      rCol = 56 + Math.floor(rand() * 26);
      gCol = 88 + Math.floor(rand() * 28);
      bCol = 34 + Math.floor(rand() * 14);
    } else if (tone > 0.38) {
      // Mid-depth Mediterranean/Mughal cypress green
      rCol = 32 + Math.floor(rand() * 20);
      gCol = 60 + Math.floor(rand() * 22);
      bCol = 22 + Math.floor(rand() * 12);
    } else {
      // Deep shaded conifer heart
      rCol = 16 + Math.floor(rand() * 12);
      gCol = 34 + Math.floor(rand() * 15);
      bCol = 12 + Math.floor(rand() * 9);
    }

    ctx.strokeStyle = `rgba(${rCol}, ${gCol}, ${bCol}, 0.96)`;
    ctx.lineWidth = 2.6 + rand() * 2.8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(
      (cx + tipX) * 0.5 + normX * 4,
      (cy + tipY) * 0.5 - 3,
      tipX,
      tipY,
    );
    ctx.stroke();

    // Fine feathery side branchlets on outer sprays
    if (i % 3 === 0) {
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo((cx + tipX) * 0.5, (cy + tipY) * 0.5);
      ctx.lineTo(tipX + Math.cos(angle + 0.55) * 8, tipY + Math.sin(angle + 0.55) * 8);
      ctx.moveTo((cx + tipX) * 0.5, (cy + tipY) * 0.5);
      ctx.lineTo(tipX + Math.cos(angle - 0.55) * 8, tipY + Math.sin(angle - 0.55) * 8);
      ctx.stroke();
    }
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

/** Draw intricate Mughal Pietra Dura inlay, chevron borders, and pointed arch molding over base marble. */
function drawInlayMarbleCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  ctx.drawImage(baseSource, 0, 0, size, size);

  // Subtle warm patina vignette
  const vig = ctx.createLinearGradient(0, 0, 0, size);
  vig.addColorStop(0, 'rgba(255, 252, 246, 0.06)');
  vig.addColorStop(0.85, 'rgba(210, 198, 178, 0.08)');
  vig.addColorStop(1, 'rgba(150, 138, 120, 0.22)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, size, size);

  // Crisp slate-black inlaid outer border & geometric rope framing
  ctx.strokeStyle = 'rgba(54, 51, 47, 0.72)';
  ctx.lineWidth = 7;
  ctx.strokeRect(16, 16, size - 32, size - 32);
  ctx.strokeStyle = 'rgba(88, 82, 74, 0.56)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(30, 30, size - 60, size - 60);

  // Geometric Mughal black-and-white chevron inlay bands (signature frieze detail)
  for (let i = 0; i < 16; i += 1) {
    const cx = 30 + i * ((size - 60) / 16);
    const step = (size - 60) / 16;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(56, 52, 48, 0.62)' : 'rgba(164, 126, 86, 0.46)';
    for (const cy of [44, size - 44]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + step * 0.5, cy - 11);
      ctx.lineTo(cx + step, cy);
      ctx.lineTo(cx + step * 0.5, cy + 11);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Delicate recessed pointed-arch molding & floral spandrel medallions
  ctx.strokeStyle = 'rgba(98, 88, 76, 0.56)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(86, size - 62);
  ctx.lineTo(86, 224);
  ctx.quadraticCurveTo(92, 124, size * 0.5, 82);
  ctx.quadraticCurveTo(size - 92, 124, size - 86, 224);
  ctx.lineTo(size - 86, size - 62);
  ctx.stroke();

  // Subtle pietra dura corner rosettes
  for (const rx of [110, size - 110]) {
    ctx.fillStyle = 'rgba(154, 84, 66, 0.44)';
    ctx.beginPath();
    ctx.arc(rx, 114, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(66, 94, 72, 0.48)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rx, 114, 18, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Draw Great Pishtaq black-marble Thuluth calligraphic framing & ornate floral spandrel arabesques. */
function drawPishtaqFrameCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  ctx.drawImage(baseSource, 0, 0, size, size);

  // Subtle architectural weathering gradient (slightly warmer/darker near lower foundation)
  const pat = ctx.createLinearGradient(0, 0, 0, size);
  pat.addColorStop(0, 'rgba(255, 253, 248, 0.08)');
  pat.addColorStop(0.75, 'rgba(218, 208, 190, 0.08)');
  pat.addColorStop(1, 'rgba(156, 144, 126, 0.24)');
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, size, size);

  // Bold iconic black-marble outer rectangular border framing the Pishtaq (distinctive in reference photo!)
  ctx.strokeStyle = 'rgba(42, 40, 38, 0.88)';
  ctx.lineWidth = 7;
  ctx.strokeRect(14, 14, size - 28, size - 18);

  ctx.strokeStyle = 'rgba(46, 44, 41, 0.84)';
  ctx.lineWidth = 4;
  ctx.strokeRect(56, 56, size - 112, size - 60);

  // Inner pale ivory band backing the Thuluth calligraphic inscription
  ctx.fillStyle = 'rgba(246, 240, 228, 0.45)';
  ctx.fillRect(19, 19, size - 38, 33);
  ctx.fillRect(19, 52, 33, size - 56);
  ctx.fillRect(size - 52, 52, 33, size - 56);

  // Dense authentic-looking Thuluth calligraphic script strokes inside the border band
  const randScript = seededRandom(1653);
  ctx.strokeStyle = 'rgba(32, 30, 28, 0.86)';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  for (let x = 26; x < size - 28; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, 42 + (randScript() - 0.5) * 6);
    ctx.bezierCurveTo(
      x + 3,
      23 + randScript() * 8,
      x + 6,
      46 - randScript() * 8,
      x + 9,
      34 + (randScript() - 0.5) * 10,
    );
    ctx.stroke();
    if (randScript() > 0.55) {
      ctx.beginPath();
      ctx.moveTo(x + 4, 24);
      ctx.lineTo(x + 4, 44);
      ctx.stroke();
    }
  }
  for (const sideX of [35, size - 35]) {
    for (let y = 60; y < size - 16; y += 11) {
      ctx.beginPath();
      ctx.moveTo(sideX - 9 + randScript() * 18, y);
      ctx.quadraticCurveTo(sideX + (randScript() - 0.5) * 18, y + 5, sideX - 6 + randScript() * 12, y + 9);
      ctx.stroke();
    }
  }

  // Ornate symmetrical pietra dura floral arabesque spandrels above the pointed arch
  const drawFloralSpandrel = (originX: number, dir: number) => {
    ctx.strokeStyle = 'rgba(116, 94, 68, 0.72)';
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 7; k += 1) {
      const r = 18 + k * 14;
      const sx = originX + dir * (34 + k * 15);
      const sy = 84 + k * 17;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.42, 0, Math.PI * 1.45);
      ctx.stroke();

      // Carnelian red & jade green pietra dura blossoms
      ctx.fillStyle = k % 2 === 0 ? 'rgba(156, 78, 58, 0.58)' : 'rgba(72, 102, 74, 0.54)';
      ctx.beginPath();
      ctx.arc(sx + dir * 4, sy - 2, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  drawFloralSpandrel(62, 1);
  drawFloralSpandrel(size - 62, -1);

  // Subtle dark double outline tracing the Mughal arch shoulder
  ctx.strokeStyle = 'rgba(66, 61, 56, 0.65)';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(62, 62, size - 124, size - 68);
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

  const ringCount = 14;
  for (let i = 0; i < ringCount; i += 1) {
    const y = (i / ringCount) * size;
    ctx.fillStyle = 'rgba(64, 59, 54, 0.62)';
    ctx.fillRect(0, y, size, 3.6);
    for (let j = 0; j < 8; j += 1) {
      const x = ((j + (i % 2) * 0.5) / 8) * size;
      ctx.fillStyle = 'rgba(84, 78, 70, 0.40)';
      ctx.fillRect(x, y, 2.4, size / ringCount);
    }
  }
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
  const rand = seededRandom(1648);
  const cells = 8;
  const step = size / cells;

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
      ctx.lineWidth = 1.6;
      ctx.strokeRect(gx * step, gy * step, step, step);
    }
  }

  // Subtle black-slate Mughal geometric border framing
  ctx.strokeStyle = 'rgba(66, 62, 58, 0.36)';
  ctx.lineWidth = 2.4;
  ctx.strokeRect(4, 4, size - 8, size - 8);
}

/** Paint authentic Agra red sandstone flagstone paving with slab-to-slab weathering & inlaid marble lines. */
function drawSandstonePavingCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  ctx.drawImage(baseSource, 0, 0, size, size);
  const rand = seededRandom(1642);

  // Authentic staggered Mughal red sandstone flagstone courses with natural warm ochre/terracotta tone shifts
  const rows = 8;
  const cols = 4;
  const rowH = size / rows;
  const colW = size / cols;

  for (let r = 0; r < rows; r += 1) {
    const offset = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c += 1) {
      const x = c * colW + offset;
      const y = r * rowH;
      const v = rand();
      ctx.fillStyle =
        v > 0.62
          ? `rgba(215, 165, 134, ${0.14 + rand() * 0.08})`
          : v < 0.34
            ? `rgba(116, 58, 42, ${0.14 + rand() * 0.1})`
            : `rgba(176, 118, 92, 0.07)`;
      ctx.fillRect(x, y, colW, rowH);

      // Deep dark mortar joints between flagstones
      ctx.strokeStyle = 'rgba(68, 38, 28, 0.52)';
      ctx.lineWidth = 2.4;
      ctx.strokeRect(x, y, colW, rowH);

      // Bright sunlit chamfer bevel along top/left slab edge
      ctx.strokeStyle = 'rgba(245, 224, 202, 0.28)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + rowH - 2);
      ctx.lineTo(x + 2, y + 2);
      ctx.lineTo(x + colW - 2, y + 2);
      ctx.stroke();
    }
  }
}

/** Composite photographic Mughal lawn tile with subtle royal garden mowing bands & natural organic mottling. */
function drawManicuredGrassCanvas(
  ctx: CanvasRenderingContext2D,
  baseSource: CanvasImageSource,
  size: number,
): void {
  ctx.drawImage(baseSource, 0, 0, size, size);
  const rand = seededRandom(1635);

  // Subtle manicured diagonal/parallel lawn mower striping (authentic to real Taj Mahal Charbagh lawns!)
  const stripes = 4;
  const stripeW = size / stripes;
  for (let i = 0; i < stripes; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(232, 245, 196, 0.075)' : 'rgba(22, 46, 16, 0.095)';
    ctx.fillRect(i * stripeW, 0, stripeW, size);
  }

  // Organic sun-dappled soil/clover micro-variation so large lawns never feel sterile
  for (let i = 0; i < 65; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 14 + rand() * 44;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    const warm = rand() > 0.55;
    g.addColorStop(0, warm ? 'rgba(138, 152, 74, 0.13)' : 'rgba(26, 56, 18, 0.14)');
    g.addColorStop(1, 'rgba(60, 96, 38, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
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
  marbleDomeMap: THREE.CanvasTexture;
  marbleDeckMap: THREE.CanvasTexture;
  marbleDeckNormal: THREE.CanvasTexture;
  inlayPanelMap: THREE.CanvasTexture;
  inlayPanelNormal: THREE.CanvasTexture;
  pishtaqFrameMap: THREE.CanvasTexture;
  pishtaqFrameNormal: THREE.CanvasTexture;
  minaretBandMap: THREE.CanvasTexture;
  jaliScreenMap: THREE.CanvasTexture;
  sandstoneMap: THREE.CanvasTexture;
  sandstoneNormal: THREE.CanvasTexture;
  walkwayPavingMap: THREE.CanvasTexture;
  walkwayPavingNormal: THREE.CanvasTexture;
  grassMap: THREE.CanvasTexture;
  grassNormal: THREE.CanvasTexture;
  cypressSprigMap: THREE.CanvasTexture;
  leafClusterMap: THREE.CanvasTexture;
  flowerTuftMap: THREE.CanvasTexture;
  barkMap: THREE.CanvasTexture;
  barkNormal: THREE.CanvasTexture;
  riverSandMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  cloudBankMap: THREE.CanvasTexture;
  cloudTowerMap: THREE.CanvasTexture;
  cloudWispyMap: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const textures: THREE.Texture[] = [];
  const track = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  // --- Instant fallback procedural base canvases (replaced seamlessly the millisecond real photo tiles load) ---
  const size = 512;
  const [marbleCanvas, marbleCtx] = createCanvas(size);
  const randM = seededRandom(1632);
  marbleCtx.fillStyle = '#e7dfd0';
  marbleCtx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i += 1) {
    const g = marbleCtx.createRadialGradient(randM() * size, randM() * size, 4, randM() * size, randM() * size, 80);
    g.addColorStop(0, 'rgba(196, 184, 166, 0.22)');
    g.addColorStop(1, 'rgba(231, 223, 208, 0)');
    marbleCtx.fillStyle = g;
    marbleCtx.fillRect(0, 0, size, size);
  }
  marbleCtx.strokeStyle = 'rgba(138, 128, 114, 0.28)';
  marbleCtx.lineWidth = 1.6;
  for (let r = 0; r < 6; r += 1) {
    const y = (r / 6) * size;
    marbleCtx.beginPath();
    marbleCtx.moveTo(0, y);
    marbleCtx.lineTo(size, y);
    marbleCtx.stroke();
  }

  const [sandCanvas, sandCtx] = createCanvas(size);
  sandCtx.fillStyle = '#a45e49';
  sandCtx.fillRect(0, 0, size, size);
  sandCtx.strokeStyle = 'rgba(222, 202, 178, 0.45)';
  sandCtx.lineWidth = 2;
  for (let y = 0; y < size; y += 64) {
    for (let x = 0; x < size; x += 64) {
      sandCtx.strokeRect(x, y, 64, 64);
    }
  }

  const [grassCanvas, grassCtx] = createCanvas(size);
  grassCtx.fillStyle = '#3f6b28';
  grassCtx.fillRect(0, 0, size, size);

  // Derived canvases for marble architectural variants (high-res 1024px for crisp Pishtaq calligraphy & inlay)
  const hiSize = 1024;
  const [domeCanvas, domeCtx] = createCanvas(size);
  drawDomeMarbleCanvas(domeCtx, marbleCanvas, size);

  const [deckCanvas, deckCtx] = createCanvas(size);
  drawMarbleDeckCanvas(deckCtx, marbleCanvas, size);

  const [inlayCanvas, inlayCtx] = createCanvas(hiSize);
  drawInlayMarbleCanvas(inlayCtx, marbleCanvas, hiSize);

  const [pishtaqCanvas, pishtaqCtx] = createCanvas(hiSize);
  drawPishtaqFrameCanvas(pishtaqCtx, marbleCanvas, hiSize);

  const [minaretCanvas, minaretCtx] = createCanvas(size);
  drawMinaretBandCanvas(minaretCtx, marbleCanvas, size);

  const [walkwayCanvas, walkwayCtx] = createCanvas(size);
  drawSandstonePavingCanvas(walkwayCtx, sandCanvas, size);

  // Roughness map for Makrana marble (subtle slab-to-slab polish variation)
  const [mRghCanvas, mRgh] = createCanvas(256);
  mRgh.fillStyle = '#707070';
  mRgh.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 48; i += 1) {
    const x = randM() * 256;
    const y = randM() * 256;
    const r = 18 + randM() * 44;
    const g = mRgh.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, randM() > 0.5 ? 'rgba(136,136,136,0.28)' : 'rgba(62,62,62,0.28)');
    g.addColorStop(1, 'rgba(112,112,112,0)');
    mRgh.fillStyle = g;
    mRgh.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Normal map canvases (upgraded automatically from real photo pixels once loaded)
  const [marbleNormCanvas, marbleNormCtx] = createCanvas(256);
  marbleNormCtx.drawImage(generateNormalMapFromCanvas(marbleCanvas, 2.2), 0, 0);

  const [deckNormCanvas, deckNormCtx] = createCanvas(256);
  deckNormCtx.drawImage(generateNormalMapFromCanvas(deckCanvas, 2.6), 0, 0);

  const [inlayNormCanvas, inlayNormCtx] = createCanvas(256);
  inlayNormCtx.drawImage(generateNormalMapFromCanvas(inlayCanvas, 3.0), 0, 0);

  const [pishtaqNormCanvas, pishtaqNormCtx] = createCanvas(256);
  pishtaqNormCtx.drawImage(generateNormalMapFromCanvas(pishtaqCanvas, 3.0), 0, 0);

  const [sandNormCanvas, sandNormCtx] = createCanvas(256);
  sandNormCtx.drawImage(generateNormalMapFromCanvas(sandCanvas, 3.2), 0, 0);

  const [walkwayNormCanvas, walkwayNormCtx] = createCanvas(256);
  walkwayNormCtx.drawImage(generateNormalMapFromCanvas(walkwayCanvas, 3.6), 0, 0);

  const [grassNormCanvas, grassNormCtx] = createCanvas(256);
  grassNormCtx.drawImage(generateNormalMapFromCanvas(grassCanvas, 2.6), 0, 0);

  // Create CanvasTextures that stay bound to materials while images stream in seamlessly
  const marbleMap = track(new THREE.CanvasTexture(marbleCanvas));
  configureTexture(marbleMap, true, maxAnisotropy, 2, 2);

  const marbleNormal = track(new THREE.CanvasTexture(marbleNormCanvas));
  configureTexture(marbleNormal, false, maxAnisotropy, 2, 2);

  const marbleRoughness = track(new THREE.CanvasTexture(mRghCanvas));
  configureTexture(marbleRoughness, false, maxAnisotropy, 2, 2);

  const marbleDomeMap = track(new THREE.CanvasTexture(domeCanvas));
  configureTexture(marbleDomeMap, true, maxAnisotropy, 4, 2);

  const marbleDeckMap = track(new THREE.CanvasTexture(deckCanvas));
  configureTexture(marbleDeckMap, true, maxAnisotropy, 10, 10);

  const marbleDeckNormal = track(new THREE.CanvasTexture(deckNormCanvas));
  configureTexture(marbleDeckNormal, false, maxAnisotropy, 10, 10);

  const inlayPanelMap = track(new THREE.CanvasTexture(inlayCanvas));
  configureTexture(inlayPanelMap, true, maxAnisotropy, 1, 1);

  const inlayPanelNormal = track(new THREE.CanvasTexture(inlayNormCanvas));
  configureTexture(inlayPanelNormal, false, maxAnisotropy, 1, 1);

  const pishtaqFrameMap = track(new THREE.CanvasTexture(pishtaqCanvas));
  configureTexture(pishtaqFrameMap, true, maxAnisotropy, 1, 1);

  const pishtaqFrameNormal = track(new THREE.CanvasTexture(pishtaqNormCanvas));
  configureTexture(pishtaqFrameNormal, false, maxAnisotropy, 1, 1);

  const minaretBandMap = track(new THREE.CanvasTexture(minaretCanvas));
  configureTexture(minaretBandMap, true, maxAnisotropy, 1, 2);

  const sandstoneMap = track(new THREE.CanvasTexture(sandCanvas));
  configureTexture(sandstoneMap, true, maxAnisotropy, 14, 14);

  const sandstoneNormal = track(new THREE.CanvasTexture(sandNormCanvas));
  configureTexture(sandstoneNormal, false, maxAnisotropy, 14, 14);

  const walkwayPavingMap = track(new THREE.CanvasTexture(walkwayCanvas));
  configureTexture(walkwayPavingMap, true, maxAnisotropy, 2, 28);

  const walkwayPavingNormal = track(new THREE.CanvasTexture(walkwayNormCanvas));
  configureTexture(walkwayPavingNormal, false, maxAnisotropy, 2, 28);

  const grassMap = track(new THREE.CanvasTexture(grassCanvas));
  configureTexture(grassMap, true, maxAnisotropy, 30, 30);

  const grassNormal = track(new THREE.CanvasTexture(grassNormCanvas));
  configureTexture(grassNormal, false, maxAnisotropy, 30, 30);

  // --- Load real photorealistic generated tile assets & composite into all derived stone & lawn maps ---
  const loadPhotoTile = (url: string, onLoaded: (img: HTMLImageElement) => void) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => onLoaded(img);
    img.src = url;
  };

  loadPhotoTile(MARBLE_PHOTO_URL, (img) => {
    marbleCtx.drawImage(img, 0, 0, size, size);
    marbleMap.needsUpdate = true;

    marbleNormCtx.drawImage(generateNormalMapFromCanvas(marbleCanvas, 2.5), 0, 0);
    marbleNormal.needsUpdate = true;

    drawDomeMarbleCanvas(domeCtx, img, size);
    marbleDomeMap.needsUpdate = true;

    drawMarbleDeckCanvas(deckCtx, img, size);
    marbleDeckMap.needsUpdate = true;
    deckNormCtx.drawImage(generateNormalMapFromCanvas(deckCanvas, 2.8), 0, 0);
    marbleDeckNormal.needsUpdate = true;

    drawInlayMarbleCanvas(inlayCtx, img, hiSize);
    inlayPanelMap.needsUpdate = true;
    inlayNormCtx.drawImage(generateNormalMapFromCanvas(inlayCanvas, 3.2), 0, 0);
    inlayPanelNormal.needsUpdate = true;

    drawPishtaqFrameCanvas(pishtaqCtx, img, hiSize);
    pishtaqFrameMap.needsUpdate = true;
    pishtaqNormCtx.drawImage(generateNormalMapFromCanvas(pishtaqCanvas, 3.2), 0, 0);
    pishtaqFrameNormal.needsUpdate = true;

    drawMinaretBandCanvas(minaretCtx, img, size);
    minaretBandMap.needsUpdate = true;
  });

  loadPhotoTile(SANDSTONE_PHOTO_URL, (img) => {
    drawSandstonePavingCanvas(sandCtx, img, size);
    sandstoneMap.needsUpdate = true;
    sandNormCtx.drawImage(generateNormalMapFromCanvas(sandCanvas, 3.5), 0, 0);
    sandstoneNormal.needsUpdate = true;

    drawSandstonePavingCanvas(walkwayCtx, img, size);
    walkwayPavingMap.needsUpdate = true;
    walkwayNormCtx.drawImage(generateNormalMapFromCanvas(walkwayCanvas, 3.8), 0, 0);
    walkwayPavingNormal.needsUpdate = true;
  });

  loadPhotoTile(GRASS_PHOTO_URL, (img) => {
    drawManicuredGrassCanvas(grassCtx, img, size);
    grassMap.needsUpdate = true;
    grassNormCtx.drawImage(generateNormalMapFromCanvas(grassCanvas, 2.8), 0, 0);
    grassNormal.needsUpdate = true;
  });

  // Botanical foliage sprigs, flower borders, furrowed tree bark, riverbank sand, jali screen & contact shadows
  const jaliScreenMap = track(createJaliScreenTexture(maxAnisotropy));
  const cypressSprigMap = track(createCypressSprigTexture(maxAnisotropy));
  const leafClusterMap = track(createLeafClusterTexture(maxAnisotropy));
  const flowerTuftMap = track(createFlowerTuftTexture(maxAnisotropy));
  const barkCanvas = createBarkCanvas();
  const barkMap = track(new THREE.CanvasTexture(barkCanvas));
  configureTexture(barkMap, true, maxAnisotropy, 2, 3);
  const barkNormal = track(new THREE.CanvasTexture(generateNormalMapFromCanvas(barkCanvas, 3.2)));
  configureTexture(barkNormal, false, maxAnisotropy, 2, 3);
  const riverSandMap = track(createRiverSandTexture(maxAnisotropy));
  const contactShadowMap = track(createContactShadowTexture());
  const cloudBankMap = track(createCloudFbmTexture(301, 384, 192, 'bank', maxAnisotropy));
  const cloudTowerMap = track(createCloudFbmTexture(709, 320, 224, 'tower', maxAnisotropy));
  const cloudWispyMap = track(createCloudFbmTexture(1217, 384, 160, 'wispy', maxAnisotropy));

  return {
    marbleMap,
    marbleNormal,
    marbleRoughness,
    marbleDomeMap,
    marbleDeckMap,
    marbleDeckNormal,
    inlayPanelMap,
    inlayPanelNormal,
    pishtaqFrameMap,
    pishtaqFrameNormal,
    minaretBandMap,
    jaliScreenMap,
    sandstoneMap,
    sandstoneNormal,
    walkwayPavingMap,
    walkwayPavingNormal,
    grassMap,
    grassNormal,
    cypressSprigMap,
    leafClusterMap,
    flowerTuftMap,
    barkMap,
    barkNormal,
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
