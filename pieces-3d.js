/**
 * Modélisation 3D procédurale des 6 pièces gréco-romaines, matériaux PBR
 * (Marbre de Carrare & Bronze Patiné) et plateau en mosaïque romaine.
 */

import * as THREE from 'three';

export const SQUARE_SIZE = 1.05;
export const BOARD_TOP_Y = 0.24;

// ============================================================================
// 1. GÉNÉRATION PROCÉDURALE DE TEXTURES (CANVAS 2D)
// ============================================================================

function seededNoise(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = seededNoise(ix, iy);
  const b = seededNoise(ix + 1, iy);
  const c = seededNoise(ix, iy + 1);
  const d = seededNoise(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, octaves = 4) {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amp * smoothNoise(x * freq, y * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return value;
}

function createCarraraMarbleTextures(maxAnisotropy) {
  const size = 512;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d');

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d');

  const aImg = aCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 4.5;
      const ny = (y / size) * 4.5;
      const warp = fbm(nx + 1.3, ny + 2.7, 4);
      const veinRaw = Math.sin((nx * 1.8 + ny * 1.1 + warp * 3.8) * Math.PI);
      const vein = Math.pow(1 - Math.abs(veinRaw), 6.0);
      const fineVein = Math.pow(1 - Math.abs(Math.sin((nx * 4.2 - ny * 2.5 + warp * 5.0) * Math.PI)), 9.0);
      const baseVar = fbm(nx * 2.2, ny * 2.2, 3);

      // Base ivoire / marbre (#FAF8F3 à #C7BDA9)
      let r = 249 - baseVar * 16 - vein * 42 - fineVein * 22;
      let g = 246 - baseVar * 18 - vein * 44 - fineVein * 24;
      let b = 239 - baseVar * 22 - vein * 46 - fineVein * 26;

      // Léger grain minéral cristallin
      const sparkle = (seededNoise(x * 0.7, y * 0.7) - 0.5) * 6;
      r = Math.max(150, Math.min(255, r + sparkle));
      g = Math.max(145, Math.min(255, g + sparkle));
      b = Math.max(138, Math.min(255, b + sparkle));

      const idx = (y * size + x) * 4;
      aImg.data[idx] = r;
      aImg.data[idx + 1] = g;
      aImg.data[idx + 2] = b;
      aImg.data[idx + 3] = 255;

      // Rugosité : marbre poli (~0.18) un peu plus mat dans les veinures (~0.36)
      const roughVal = Math.round((0.18 + vein * 0.16 + baseVar * 0.08) * 255);
      rImg.data[idx] = roughVal;
      rImg.data[idx + 1] = roughVal;
      rImg.data[idx + 2] = roughVal;
      rImg.data[idx + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return { map, roughnessMap };
}

function createPatinatedBronzeTextures(maxAnisotropy) {
  const size = 512;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d');

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d');

  const aImg = aCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 5.2;
      const ny = (y / size) * 5.2;
      const n1 = fbm(nx, ny, 4);
      const n2 = fbm(nx * 2.7 + 4.1, ny * 2.7 + 1.9, 3);

      // Bronze sombre (#1E1813 -> #5B4A3A -> reflets cuivrés #7E664F)
      let r = 42 + n1 * 58 + n2 * 22;
      let g = 33 + n1 * 44 + n2 * 16;
      let b = 25 + n1 * 32 + n2 * 11;

      // Oxydation vert-de-gris (#3F6F61 / #5A9181) marbrée dans les zones patinées
      const patinaMask = Math.max(0, (n2 - 0.52) * 2.4);
      if (patinaMask > 0) {
        const t = Math.min(0.75, patinaMask);
        r = r * (1 - t) + 74 * t;
        g = g * (1 - t) + 128 * t;
        b = b * (1 - t) + 112 * t;
      }

      const idx = (y * size + x) * 4;
      aImg.data[idx] = Math.min(255, Math.max(0, r));
      aImg.data[idx + 1] = Math.min(255, Math.max(0, g));
      aImg.data[idx + 2] = Math.min(255, Math.max(0, b));
      aImg.data[idx + 3] = 255;

      // Zones oxydées plus mates (0.55), reliefs cuivrés plus polis (0.24)
      const roughVal = Math.round((0.26 + patinaMask * 0.28 + n1 * 0.1) * 255);
      rImg.data[idx] = roughVal;
      rImg.data[idx + 1] = roughVal;
      rImg.data[idx + 2] = roughVal;
      rImg.data[idx + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return { map, roughnessMap };
}

function createMosaicTileTextures(isLight, maxAnisotropy) {
  const size = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d');

  // Couleur de joint (mortier antique)
  ctx.fillStyle = isLight ? '#CBC2B2' : '#4A1F14';
  ctx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#383838';
  bCtx.fillRect(0, 0, size, size);

  // Grille 3×3 de micro-tesselles avec joints apparents
  const grid = 3;
  const cell = size / grid;
  const gap = 7;

  const lightPalette = ['#F2ECE1', '#EDE5D8', '#E5DDD0', '#F6F1E8'];
  const darkPalette = ['#6B2F1F', '#7A3624', '#8B3F2B', '#5F281A'];
  const palette = isLight ? lightPalette : darkPalette;

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const tx = gx * cell + gap;
      const ty = gy * cell + gap;
      const tw = cell - gap * 2;
      const th = cell - gap * 2;
      const pick = Math.floor(seededNoise(gx * 3.1 + (isLight ? 1 : 9), gy * 7.3) * palette.length);

      ctx.fillStyle = palette[pick];
      ctx.fillRect(tx, ty, tw, th);

      // Subtil biseau lumineux sur chaque tesselle
      ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.45)' : 'rgba(235,170,130,0.16)';
      ctx.lineWidth = 2;
      ctx.strokeRect(tx + 1, ty + 1, tw - 2, th - 2);

      // Grain de pierre dans la tesselle
      for (let i = 0; i < 45; i++) {
        const px = tx + seededNoise(i + gx * 11, gy * 5) * tw;
        const py = ty + seededNoise(gx * 7, i + gy * 13) * th;
        ctx.fillStyle = isLight ? 'rgba(180,165,145,0.18)' : 'rgba(30,12,8,0.22)';
        ctx.fillRect(px, py, 2, 2);
      }

      // Hauteur de tesselle pour bump map
      bCtx.fillStyle = '#D8D8D8';
      bCtx.fillRect(tx, ty, tw, th);
    }
  }

  // Rosette centrale subtile gravée sur la tesselle médiane
  const cx = size / 2;
  const cy = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = isLight ? 'rgba(184, 152, 96, 0.42)' : 'rgba(212, 175, 55, 0.34)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(0, 0, 17, 0, Math.PI * 2);
  ctx.stroke();

  for (let p = 0; p < 4; p++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(8, -11, 0, -16);
    ctx.quadraticCurveTo(-8, -11, 0, 0);
    ctx.fillStyle = isLight ? 'rgba(196, 168, 114, 0.25)' : 'rgba(212, 175, 55, 0.2)';
    ctx.fill();
  }
  ctx.restore();

  // Encadrement de dalle
  ctx.strokeStyle = isLight ? 'rgba(180,168,148,0.65)' : 'rgba(42,16,10,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = maxAnisotropy;

  return { map, bumpMap };
}

function createCoordinatePlaqueTexture(label, maxAnisotropy) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);
  ctx.font = '600 58px "Cinzel", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Ombre gravée sombre
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillText(label, size / 2 + 2, size / 2 + 3);

  // Lettrage Or Impérial
  ctx.fillStyle = '#D4AF37';
  ctx.fillText(label, size / 2, size / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createMeanderBorderTexture(maxAnisotropy) {
  const w = 1024;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1E1A16';
  ctx.fillRect(0, 0, w, h);

  // Filets dorés haut/bas
  ctx.fillStyle = '#D4AF37';
  ctx.fillRect(0, 5, w, 3);
  ctx.fillRect(0, h - 8, w, 3);

  // Motif méandre grec / perles dorées répétitives
  const step = 64;
  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 3.5;
  for (let x = 0; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + 8, 46);
    ctx.lineTo(x + 8, 18);
    ctx.lineTo(x + 48, 18);
    ctx.lineTo(x + 48, 38);
    ctx.lineTo(x + 24, 38);
    ctx.lineTo(x + 24, 28);
    ctx.lineTo(x + 36, 28);
    ctx.stroke();

    // Perle intercalée
    ctx.fillStyle = '#F3E5AB';
    ctx.beginPath();
    ctx.arc(x + 58, 32, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

// ============================================================================
// 2. BIBLIOTHÈQUE DE MATÉRIAUX PBR
// ============================================================================

export function createMaterialLibrary(maxAnisotropy = 4) {
  const marbleTex = createCarraraMarbleTextures(maxAnisotropy);
  const bronzeTex = createPatinatedBronzeTextures(maxAnisotropy);
  const lightTileTex = createMosaicTileTextures(true, maxAnisotropy);
  const darkTileTex = createMosaicTileTextures(false, maxAnisotropy);
  const meanderTex = createMeanderBorderTexture(maxAnisotropy);

  const whiteMain = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#FAF8F3'),
    map: marbleTex.map,
    roughnessMap: marbleTex.roughnessMap,
    roughness: 0.24,
    metalness: 0.04,
    envMapIntensity: 1.0,
  });

  const whiteTrim = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#D4AF37'),
    roughness: 0.22,
    metalness: 0.92,
    clearcoat: 0.25,
    envMapIntensity: 1.35,
  });

  const whiteShield = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#6E1828'), // Pourpre romain impérial
    roughness: 0.5,
    metalness: 0.12,
    envMapIntensity: 0.9,
  });

  const blackMain = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#B8A896'),
    map: bronzeTex.map,
    roughnessMap: bronzeTex.roughnessMap,
    roughness: 0.36,
    metalness: 0.84,
    envMapIntensity: 1.45,
  });

  const blackTrim = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#C79B3B'),
    roughness: 0.28,
    metalness: 0.9,
    clearcoat: 0.2,
    envMapIntensity: 1.35,
  });

  const blackShield = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2E554B'), // Vert-de-gris sombre
    roughness: 0.44,
    metalness: 0.42,
    envMapIntensity: 1.15,
  });

  const boardLightTile = new THREE.MeshStandardMaterial({
    map: lightTileTex.map,
    bumpMap: lightTileTex.bumpMap,
    bumpScale: 0.014,
    roughness: 0.34,
    metalness: 0.03,
    envMapIntensity: 0.85,
  });

  const boardDarkTile = new THREE.MeshStandardMaterial({
    map: darkTileTex.map,
    bumpMap: darkTileTex.bumpMap,
    bumpScale: 0.016,
    roughness: 0.42,
    metalness: 0.05,
    envMapIntensity: 0.8,
  });

  const boardFrameDark = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1E1A16'),
    roughness: 0.38,
    metalness: 0.12,
    envMapIntensity: 0.9,
  });

  const boardFrameBevel = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2B2520'),
    roughness: 0.34,
    metalness: 0.16,
    envMapIntensity: 1.0,
  });

  const boardMeander = new THREE.MeshStandardMaterial({
    map: meanderTex,
    roughness: 0.36,
    metalness: 0.45,
    envMapIntensity: 1.1,
  });

  return {
    maxAnisotropy,
    white: {
      main: whiteMain,
      gold: whiteTrim,
      accent: whiteShield,
    },
    black: {
      main: blackMain,
      gold: blackTrim,
      accent: blackShield,
    },
    boardLightTile,
    boardDarkTile,
    boardFrameDark,
    boardFrameBevel,
    boardMeander,
  };
}

// ============================================================================
// 3. GÉOMÉTRIES UTILITAIRES & PIÉDESTAL MOULURÉ À DEUX ÉTAGES
// ============================================================================

function enableShadows(group) {
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

function buildPedestal(matMain, matGold) {
  const group = new THREE.Group();

  // Profil à deux étages mouluré : socle bas, tore, gorge concave, tore supérieur
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.365, 0.0),
    new THREE.Vector2(0.365, 0.055),
    new THREE.Vector2(0.345, 0.078),
    new THREE.Vector2(0.305, 0.095),
    new THREE.Vector2(0.315, 0.125),
    new THREE.Vector2(0.278, 0.175),
    new THREE.Vector2(0.295, 0.205),
    new THREE.Vector2(0.275, 0.228),
    new THREE.Vector2(0.0, 0.228),
  ];

  const baseGeo = new THREE.LatheGeometry(pts, 32);
  const baseMesh = new THREE.Mesh(baseGeo, matMain);
  group.add(baseMesh);

  // Anneau filet doré incrusté sur le deuxième étage du piédestal
  const ringGeo = new THREE.TorusGeometry(0.306, 0.012, 10, 32);
  ringGeo.rotateX(Math.PI / 2);
  const ringMesh = new THREE.Mesh(ringGeo, matGold);
  ringMesh.position.y = 0.125;
  group.add(ringMesh);

  const upperRingGeo = new THREE.TorusGeometry(0.288, 0.009, 8, 32);
  upperRingGeo.rotateX(Math.PI / 2);
  const upperRingMesh = new THREE.Mesh(upperRingGeo, matGold);
  upperRingMesh.position.y = 0.21;
  group.add(upperRingMesh);

  return group;
}

/**
 * Crée un cylindre fuselé avec cannelures / plis verticaux sinusoïdaux.
 */
function createFlutedColumnGeometry(
  bottomRadius,
  topRadius,
  height,
  fluteCount,
  fluteDepth,
  radialSegments = 48,
  heightSegments = 12
) {
  const geo = new THREE.CylinderGeometry(
    topRadius,
    bottomRadius,
    height,
    radialSegments,
    heightSegments,
    false
  );
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.001) continue;

    // Atténuation aux extrémités haut/bas pour un raccord propre
    const tY = (y + height / 2) / height;
    const endMask = Math.sin(Math.min(1, Math.max(0, tY)) * Math.PI);
    const angle = Math.atan2(z, x);
    // Entasis antique subtil + plis/cannelures
    const entasis = 1.0 + 0.03 * Math.sin(tY * Math.PI);
    const wave = Math.cos(angle * fluteCount) * fluteDepth * (0.35 + 0.65 * endMask);
    const scale = (r * entasis + wave) / r;
    pos.setX(i, x * scale);
    pos.setZ(i, z * scale);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Tête humaine sculptée classique (crâne, arête nasale, arcade sourcilière, mâchoire).
 */
function buildSculptedHead(matMain, options = {}) {
  const { beard = false, female = false } = options;
  const head = new THREE.Group();

  // Crâne ovoïde
  const craniumGeo = new THREE.SphereGeometry(0.115, 22, 18);
  craniumGeo.scale(0.88, 1.12, 0.96);
  const cranium = new THREE.Mesh(craniumGeo, matMain);
  head.add(cranium);

  // Mâchoire / menton orienté vers -Z (avant)
  const jawGeo = new THREE.ConeGeometry(0.082, 0.11, 14);
  jawGeo.rotateX(Math.PI);
  jawGeo.scale(0.88, 1.0, 0.85);
  const jaw = new THREE.Mesh(jawGeo, matMain);
  jaw.position.set(0, -0.068, -0.025);
  head.add(jaw);

  // Nez grec droit
  const noseGeo = new THREE.BoxGeometry(0.022, 0.052, 0.038);
  const nose = new THREE.Mesh(noseGeo, matMain);
  nose.position.set(0, -0.006, -0.106);
  nose.rotation.x = 0.16;
  head.add(nose);

  // Arcade sourcilière
  const browGeo = new THREE.BoxGeometry(0.108, 0.022, 0.036);
  const brow = new THREE.Mesh(browGeo, matMain);
  brow.position.set(0, 0.028, -0.092);
  head.add(brow);

  if (female) {
    // Chignon classique à l'arrière (+Z)
    const bunGeo = new THREE.SphereGeometry(0.058, 14, 12);
    bunGeo.scale(0.95, 0.9, 1.05);
    const bun = new THREE.Mesh(bunGeo, matMain);
    bun.position.set(0, 0.01, 0.112);
    head.add(bun);

    // Bandeau de chevelure ondulée
    const hairGeo = new THREE.TorusGeometry(0.106, 0.022, 8, 22);
    hairGeo.rotateX(Math.PI / 2 - 0.25);
    const hair = new THREE.Mesh(hairGeo, matMain);
    hair.position.set(0, 0.032, 0.01);
    head.add(hair);
  } else {
    // Couronne de cheveux bouclés / volume capillaire romain
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.118, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.56),
      matMain
    );
    hairCap.scale.set(0.9, 1.06, 0.98);
    hairCap.position.set(0, 0.016, 0.012);
    hairCap.rotation.x = 0.22;
    head.add(hairCap);
  }

  if (beard) {
    const beardGeo = new THREE.ConeGeometry(0.088, 0.135, 14);
    beardGeo.rotateX(Math.PI);
    beardGeo.scale(0.9, 1.0, 0.78);
    const beardMesh = new THREE.Mesh(beardGeo, matMain);
    beardMesh.position.set(0, -0.105, -0.048);
    beardMesh.rotation.x = -0.12;
    head.add(beardMesh);
  }

  return head;
}

// ============================================================================
// 4. LES 6 SCULPTURES GRÉCO-ROMAINES
// ============================================================================

/**
 * 1. ROI — EMPEREUR ROMAIN
 * Toge drapée à plis verticaux, écharpe diagonale en relief, tête barbue,
 * couronne de lauriers dorée et sceptre impérial à l'aigle (Aquila) doré.
 */
function buildKing(mat) {
  const group = new THREE.Group();
  group.add(buildPedestal(mat.main, mat.gold));

  // Corps drapé en toge impériale
  const bodyGeo = createFlutedColumnGeometry(0.24, 0.175, 0.66, 12, 0.016, 48, 12);
  const body = new THREE.Mesh(bodyGeo, mat.main);
  body.position.y = 0.228 + 0.33;
  group.add(body);

  // Buste / épaules drapées
  const shouldersGeo = new THREE.CylinderGeometry(0.14, 0.21, 0.16, 24);
  shouldersGeo.scale(1.12, 1.0, 0.88);
  const shoulders = new THREE.Mesh(shouldersGeo, mat.main);
  shoulders.position.y = 0.92;
  group.add(shoulders);

  // Écharpe diagonale de toge impériale en relief (balteus)
  const sashCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.18, 0.97, -0.05),
    new THREE.Vector3(-0.04, 0.85, -0.185),
    new THREE.Vector3(0.16, 0.68, -0.17),
    new THREE.Vector3(0.21, 0.56, 0.04),
    new THREE.Vector3(0.05, 0.65, 0.19),
    new THREE.Vector3(-0.14, 0.86, 0.13),
    new THREE.Vector3(-0.18, 0.97, -0.05),
  ]);
  const sashGeo = new THREE.TubeGeometry(sashCurve, 36, 0.036, 10, true);
  const sash = new THREE.Mesh(sashGeo, mat.main);
  group.add(sash);

  // Cou & Tête impériale
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.072, 0.08, 16), mat.main);
  neck.position.y = 1.02;
  group.add(neck);

  const head = buildSculptedHead(mat.main, { beard: true });
  head.position.y = 1.15;
  group.add(head);

  // Couronne de lauriers dorée + feuilles sculptées
  const wreathBand = new THREE.Mesh(new THREE.TorusGeometry(0.114, 0.013, 8, 28), mat.gold);
  wreathBand.rotation.x = Math.PI / 2 - 0.16;
  wreathBand.position.set(0, 1.195, 0.005);
  group.add(wreathBand);

  const leafGeo = new THREE.ConeGeometry(0.022, 0.068, 4);
  leafGeo.scale(1.0, 1.0, 0.35);
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    if (Math.abs(Math.sin(angle)) < 0.25 && Math.cos(angle) < 0) continue; // ouverture frontale impériale
    const leaf = new THREE.Mesh(leafGeo, mat.gold);
    const rad = 0.122;
    leaf.position.set(Math.sin(angle) * rad, 1.215, Math.cos(angle) * rad);
    leaf.rotation.y = angle;
    leaf.rotation.z = -0.35 * Math.sign(Math.sin(angle) || 1);
    leaf.rotation.x = 0.25;
    group.add(leaf);
  }

  // Sceptre impérial sur le côté droit (+X) surmonté d'un aigle romain (Aquila) doré
  const sceptreGroup = new THREE.Group();
  sceptreGroup.position.set(0.245, 0.228, -0.06);

  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 1.06, 12), mat.gold);
  staff.position.y = 0.53;
  sceptreGroup.add(staff);

  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 12), mat.gold);
  orb.position.y = 1.06;
  sceptreGroup.add(orb);

  // Aigle romain (Aquila) doré : corps, ailes déployées, tête
  const eagleBody = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.085, 10), mat.gold);
  eagleBody.position.y = 1.12;
  sceptreGroup.add(eagleBody);

  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(0.085, 0.045);
  wingShape.lineTo(0.095, 0.015);
  wingShape.lineTo(0.04, -0.025);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.01, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003 });

  const wingR = new THREE.Mesh(wingGeo, mat.gold);
  wingR.position.set(0.01, 1.125, -0.005);
  sceptreGroup.add(wingR);

  const wingL = new THREE.Mesh(wingGeo, mat.gold);
  wingL.scale.x = -1;
  wingL.position.set(-0.01, 1.125, -0.005);
  sceptreGroup.add(wingL);

  const eagleHead = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), mat.gold);
  eagleHead.position.set(0, 1.168, -0.008);
  sceptreGroup.add(eagleHead);

  group.add(sceptreGroup);
  enableShadows(group);
  return group;
}

/**
 * 2. DAME — DÉESSE DRAPÉE
 * Robe péplos/chiton longue finement cannelée, taille marquée, buste drapé,
 * tête féminine avec chignon et diadème radieux doré à pointes.
 */
function buildQueen(mat) {
  const group = new THREE.Group();
  group.add(buildPedestal(mat.main, mat.gold));

  // Jupe du péplos fluide à 18 plis verticaux fins
  const skirtGeo = createFlutedColumnGeometry(0.245, 0.135, 0.52, 18, 0.017, 54, 14);
  const skirt = new THREE.Mesh(skirtGeo, mat.main);
  skirt.position.y = 0.228 + 0.26;
  group.add(skirt);

  // Ceinture dorée à la taille marquée
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.138, 0.016, 10, 28), mat.gold);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.755;
  group.add(belt);

  // Buste drapé supérieur (corsage chiton)
  const bustGeo = createFlutedColumnGeometry(0.135, 0.17, 0.22, 14, 0.011, 40, 8);
  bustGeo.scale(1.06, 1.0, 0.86);
  const bust = new THREE.Mesh(bustGeo, mat.main);
  bust.position.y = 0.865;
  group.add(bust);

  // Épaules élégantes
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 14), mat.main);
  shoulders.scale.set(1.22, 0.48, 0.78);
  shoulders.position.y = 0.945;
  group.add(shoulders);

  // Cou fin & tête féminine avec chignon
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.058, 0.09, 16), mat.main);
  neck.position.y = 1.015;
  group.add(neck);

  const head = buildSculptedHead(mat.main, { female: true });
  head.scale.setScalar(0.94);
  head.position.y = 1.135;
  group.add(head);

  // Diadème radieux doré à 7 pointes solaires
  const diademGroup = new THREE.Group();
  diademGroup.position.set(0, 1.19, -0.01);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.102, 0.012, 8, 24, Math.PI * 1.25), mat.gold);
  band.rotation.x = Math.PI / 2 - 0.18;
  band.rotation.z = Math.PI * 0.875;
  diademGroup.add(band);

  const rayGeo = new THREE.ConeGeometry(0.015, 0.088, 4);
  for (let i = -3; i <= 3; i++) {
    const a = (i / 3) * (Math.PI * 0.48);
    const ray = new THREE.Mesh(rayGeo, mat.gold);
    const heightBoost = 1.0 - Math.abs(i) * 0.12;
    ray.scale.y = heightBoost;
    ray.position.set(Math.sin(a) * 0.096, 0.045 * heightBoost, -Math.cos(a) * 0.096);
    ray.rotation.z = -a * 0.35;
    ray.rotation.x = -0.18;
    diademGroup.add(ray);
  }
  group.add(diademGroup);

  enableShadows(group);
  return group;
}

/**
 * 3. FOU — PHILOSOPHE ANTIQUE
 * Manteau himation drapé asymétrique, tête barbue érudite,
 * rouleau de parchemin/papyrus incliné contre son flanc.
 */
function buildBishop(mat) {
  const group = new THREE.Group();
  group.add(buildPedestal(mat.main, mat.gold));

  // Tunique et manteau himation drapé asymétrique
  const robeGeo = createFlutedColumnGeometry(0.225, 0.165, 0.56, 10, 0.014, 40, 10);
  const robe = new THREE.Mesh(robeGeo, mat.main);
  robe.position.y = 0.228 + 0.28;
  group.add(robe);

  // Drapé asymétrique du manteau sur l'épaule gauche
  const cloakCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.17, 0.85, 0.02),
    new THREE.Vector3(-0.08, 0.72, -0.175),
    new THREE.Vector3(0.14, 0.52, -0.15),
    new THREE.Vector3(0.17, 0.45, 0.12),
    new THREE.Vector3(-0.08, 0.68, 0.16),
    new THREE.Vector3(-0.17, 0.85, 0.02),
  ]);
  const cloakFold = new THREE.Mesh(
    new THREE.TubeGeometry(cloakCurve, 32, 0.042, 10, true),
    mat.main
  );
  group.add(cloakFold);

  // Épaules érudites légèrement voûtées
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.165, 18, 12), mat.main);
  shoulders.scale.set(1.08, 0.55, 0.86);
  shoulders.position.y = 0.81;
  group.add(shoulders);

  // Cou et tête barbue de philosophe
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.066, 0.07, 14), mat.main);
  neck.position.y = 0.895;
  group.add(neck);

  const head = buildSculptedHead(mat.main, { beard: true });
  head.position.y = 1.015;
  head.rotation.x = 0.06; // Légère inclinaison pensive
  group.add(head);

  // Rouleau de parchemin / papyrus incliné contre le flanc droit
  const scrollGroup = new THREE.Group();
  scrollGroup.position.set(0.19, 0.64, -0.05);
  scrollGroup.rotation.z = -0.34;
  scrollGroup.rotation.x = 0.25;

  const scrollCylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.036, 0.34, 16),
    mat.main
  );
  scrollGroup.add(scrollCylinder);

  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.024, 14), mat.gold);
  capTop.position.y = 0.175;
  scrollGroup.add(capTop);

  const capBot = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.024, 14), mat.gold);
  capBot.position.y = -0.175;
  scrollGroup.add(capBot);

  const ribbon = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.008, 8, 18), mat.gold);
  ribbon.rotation.x = Math.PI / 2;
  scrollGroup.add(ribbon);

  group.add(scrollGroup);

  enableShadows(group);
  return group;
}

/**
 * 4. CAVALIER — CHEVAL DE BRONZE / MARBRE
 * Poitrail puissant, encolure cambrée sculptée, tête équine orientée vers l'avant
 * (-Z), museau allongé, mâchoire, naseaux, oreilles pointues et crinière crantée à l'antique.
 */
function buildKnight(mat) {
  const group = new THREE.Group();
  group.add(buildPedestal(mat.main, mat.gold));

  // Poitrail puissant ancré sur le piédestal
  const chestGeo = new THREE.SphereGeometry(0.215, 24, 18);
  chestGeo.scale(0.86, 1.08, 1.08);
  const chest = new THREE.Mesh(chestGeo, mat.main);
  chest.position.set(0, 0.39, 0.02);
  group.add(chest);

  // Silhouette latérale (YZ -> Extrude puis tournée vers -Z) de l'encolure cambrée & tête
  const profile = new THREE.Shape();
  profile.moveTo(-0.15, 0.22); // Base arrière du cou
  profile.bezierCurveTo(-0.18, 0.45, -0.14, 0.72, -0.02, 0.84); // Crête arrière du cou
  profile.lineTo(0.06, 0.88); // Sommet nuque
  profile.lineTo(0.25, 0.70); // Chanfrein vers le museau
  profile.lineTo(0.29, 0.62); // Bout du nez
  profile.lineTo(0.23, 0.56); // Lèvre inférieure / mâchoire
  profile.lineTo(0.11, 0.60); // Ganache
  profile.bezierCurveTo(0.06, 0.56, 0.13, 0.40, 0.14, 0.22); // Gorge & poitrail avant
  profile.closePath();

  const extrudeGeo = new THREE.ExtrudeGeometry(profile, {
    depth: 0.16,
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 2,
    bevelSize: 0.035,
    bevelThickness: 0.035,
  });
  // Centrer l'épaisseur et orienter le museau vers -Z
  extrudeGeo.translate(0, 0, -0.08);
  extrudeGeo.rotateY(Math.PI / 2);

  const neckHead = new THREE.Mesh(extrudeGeo, mat.main);
  neckHead.position.y = 0.13;
  group.add(neckHead);

  // Museau sculpté & naseaux pour donner du volume 3D devant
  const muzzleGeo = new THREE.CylinderGeometry(0.048, 0.068, 0.18, 16);
  muzzleGeo.rotateX(Math.PI / 2 - 0.55);
  muzzleGeo.scale(0.88, 1.0, 1.0);
  const muzzle = new THREE.Mesh(muzzleGeo, mat.main);
  muzzle.position.set(0, 0.80, -0.19);
  group.add(muzzle);

  // Deux naseaux / reliefs latéraux du chanfrein
  for (const side of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), mat.main);
    nostril.position.set(side * 0.036, 0.755, -0.265);
    group.add(nostril);

    // Arcade oculaire
    const eyeRidge = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), mat.main);
    eyeRidge.scale.set(0.7, 0.8, 1.3);
    eyeRidge.position.set(side * 0.072, 0.895, -0.085);
    group.add(eyeRidge);

    // Deux oreilles pointues dressées
    const earGeo = new THREE.ConeGeometry(0.026, 0.105, 8);
    const ear = new THREE.Mesh(earGeo, mat.main);
    ear.position.set(side * 0.056, 1.035, -0.005);
    ear.rotation.z = -side * 0.18;
    ear.rotation.x = 0.22;
    group.add(ear);
  }

  // Crinière crantée à l'antique (7 crans sculptés le long de l'encolure)
  const maneStops = [
    { y: 0.96, z: 0.055, rx: -0.55, s: 0.85 },
    { y: 0.89, z: 0.105, rx: -0.45, s: 1.0 },
    { y: 0.81, z: 0.145, rx: -0.35, s: 1.08 },
    { y: 0.72, z: 0.172, rx: -0.22, s: 1.1 },
    { y: 0.63, z: 0.185, rx: -0.1, s: 1.05 },
    { y: 0.54, z: 0.182, rx: 0.05, s: 0.96 },
    { y: 0.45, z: 0.165, rx: 0.18, s: 0.86 },
  ];
  const maneGeo = new THREE.BoxGeometry(0.048, 0.074, 0.082);
  for (const stop of maneStops) {
    const tooth = new THREE.Mesh(maneGeo, mat.main);
    tooth.position.set(0, stop.y, stop.z);
    tooth.rotation.x = stop.rx;
    tooth.scale.setScalar(stop.s);
    group.add(tooth);
  }

  // Collier / harnais d'or antique à la base du poitrail
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.013, 8, 28), mat.gold);
  collar.rotation.x = Math.PI / 2 + 0.25;
  collar.position.set(0, 0.34, 0.01);
  group.add(collar);

  enableShadows(group);
  return group;
}

/**
 * 5. TOUR — COLONNE CORINTHIENNE
 * Fût à 10 cannelures verticales régulières, chapiteau corinthien évasé
 * orné de feuilles d'acanthe et couronné de 4 créneaux romains.
 */
function buildRook(mat) {
  const group = new THREE.Group();
  group.add(buildPedestal(mat.main, mat.gold));

  // Fût de colonne antique cannelé (10 cannelures)
  const shaftGeo = createFlutedColumnGeometry(0.21, 0.182, 0.52, 10, 0.018, 50, 10);
  const shaft = new THREE.Mesh(shaftGeo, mat.main);
  shaft.position.y = 0.228 + 0.26;
  group.add(shaft);

  // Astragale doré (anneau sous le chapiteau)
  const astragal = new THREE.Mesh(new THREE.TorusGeometry(0.188, 0.016, 10, 28), mat.gold);
  astragal.rotation.x = Math.PI / 2;
  astragal.position.y = 0.755;
  group.add(astragal);

  // Calathus / cloche évasée du chapiteau corinthien
  const bellGeo = new THREE.CylinderGeometry(0.25, 0.175, 0.14, 24);
  const bell = new THREE.Mesh(bellGeo, mat.main);
  bell.position.y = 0.83;
  group.add(bell);

  // Feuilles d'acanthe stylisées sur deux rangs décalés (8 feuilles par rang)
  const acanthusShape = new THREE.Shape();
  acanthusShape.moveTo(-0.036, 0);
  acanthusShape.lineTo(-0.044, 0.055);
  acanthusShape.quadraticCurveTo(0, 0.095, 0.044, 0.055);
  acanthusShape.lineTo(0.036, 0);
  acanthusShape.closePath();

  const acanthusGeo = new THREE.ExtrudeGeometry(acanthusShape, {
    depth: 0.022,
    bevelEnabled: true,
    bevelSize: 0.004,
    bevelThickness: 0.004,
  });

  for (let tier = 0; tier < 2; tier++) {
    const count = 8;
    const yPos = tier === 0 ? 0.76 : 0.82;
    const rad = tier === 0 ? 0.192 : 0.222;
    const offsetAngle = tier === 0 ? 0 : Math.PI / count;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + offsetAngle;
      const leaf = new THREE.Mesh(acanthusGeo, mat.main);
      leaf.position.set(Math.sin(a) * rad, yPos, Math.cos(a) * rad);
      leaf.rotation.y = a;
      leaf.rotation.x = 0.34; // Courbure extérieure caractéristique de l'acanthe
      group.add(leaf);
    }
  }

  // Abaque carré mouluré + 4 créneaux romains aux angles
  const abacus = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.055, 0.50), mat.main);
  abacus.position.y = 0.915;
  group.add(abacus);

  const merlonGeo = new THREE.BoxGeometry(0.145, 0.095, 0.145);
  const offsets = [
    [-0.165, -0.165],
    [0.165, -0.165],
    [-0.165, 0.165],
    [0.165, 0.165],
  ];
  for (const [ox, oz] of offsets) {
    const merlon = new THREE.Mesh(merlonGeo, mat.main);
    merlon.position.set(ox, 0.985, oz);
    group.add(merlon);
  }

  enableShadows(group);
  return group;
}

/**
 * 6. PION — LÉGIONNAIRE ROMAIN
 * Armure lorica segmentata, grand bouclier scutum courbé (pourpre / vert-de-gris)
 * cerclé d'or avec umbo doré, casque galea à crête transversale et lance pilum.
 */
function buildPawn(mat) {
  const group = new THREE.Group();
  group.add(buildPedestal(mat.main, mat.gold));

  // Bas de tunique militaire (ptéryges)
  const tunic = new THREE.Mesh(
    createFlutedColumnGeometry(0.20, 0.165, 0.18, 12, 0.012, 36, 6),
    mat.main
  );
  tunic.position.y = 0.228 + 0.09;
  group.add(tunic);

  // Torse en armure (lorica segmentata) : 4 bandes horizontales superposées
  for (let i = 0; i < 4; i++) {
    const rBot = 0.165 - i * 0.008;
    const rTop = 0.172 - i * 0.008;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, 0.055, 22),
      mat.main
    );
    band.scale.set(1.04, 1.0, 0.88);
    band.position.y = 0.425 + i * 0.05;
    group.add(band);
  }

  // Épaulières (épaules d'armure)
  const shoulderArmor = new THREE.Mesh(new THREE.SphereGeometry(0.162, 18, 12), mat.main);
  shoulderArmor.scale.set(1.12, 0.42, 0.85);
  shoulderArmor.position.y = 0.605;
  group.add(shoulderArmor);

  // Tête et casque romain (galea)
  const head = buildSculptedHead(mat.main, { beard: false });
  head.scale.setScalar(0.86);
  head.position.y = 0.72;
  group.add(head);

  const helmetBowl = new THREE.Mesh(
    new THREE.SphereGeometry(0.112, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
    mat.main
  );
  helmetBowl.position.set(0, 0.735, 0.005);
  group.add(helmetBowl);

  // Protège-nuque du casque galea
  const neckGuard = new THREE.Mesh(
    new THREE.CylinderGeometry(0.115, 0.135, 0.045, 16, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
    mat.main
  );
  neckGuard.position.set(0, 0.70, 0.012);
  neckGuard.rotation.x = -0.25;
  group.add(neckGuard);

  // Crête transversale de centurion (rouge impérial pour Blancs, vert-de-gris pour Noirs)
  const crestArc = new THREE.Mesh(
    new THREE.TorusGeometry(0.115, 0.025, 10, 20, Math.PI),
    mat.accent
  );
  crestArc.position.set(0, 0.785, 0);
  group.add(crestArc);

  const crestHolder = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.032, 0.028), mat.gold);
  crestHolder.position.set(0, 0.855, 0);
  group.add(crestHolder);

  // Grand bouclier rectangulaire courbé (scutum) devant lui (-Z)
  const shieldGroup = new THREE.Group();
  shieldGroup.position.set(-0.015, 0.46, -0.02);

  const scutumRadius = 0.245;
  const scutumArc = Math.PI * 0.46;
  const scutumH = 0.41;

  // Corps courbé du bouclier
  const scutumGeo = new THREE.CylinderGeometry(
    scutumRadius,
    scutumRadius,
    scutumH,
    20,
    1,
    true,
    Math.PI - scutumArc / 2,
    scutumArc
  );
  const scutumMatDouble = mat.accent.clone();
  scutumMatDouble.side = THREE.DoubleSide;
  const scutumMesh = new THREE.Mesh(scutumGeo, scutumMatDouble);
  shieldGroup.add(scutumMesh);

  // Bordure dorée en haut & bas du bouclier
  for (const yOff of [scutumH / 2, -scutumH / 2]) {
    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(scutumRadius, 0.011, 8, 20, scutumArc),
      mat.gold
    );
    trim.rotation.x = Math.PI / 2;
    trim.rotation.z = Math.PI / 2 - scutumArc / 2;
    trim.position.y = yOff;
    shieldGroup.add(trim);
  }

  // Bordures dorées latérales du scutum
  for (const sign of [-1, 1]) {
    const angle = Math.PI + (sign * scutumArc) / 2;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, scutumH + 0.01, 8), mat.gold);
    bar.position.set(Math.sin(angle) * scutumRadius, 0, Math.cos(angle) * scutumRadius);
    shieldGroup.add(bar);
  }

  // Umbo doré central (bosse hémisphérique du bouclier)
  const umbo = new THREE.Mesh(new THREE.SphereGeometry(0.056, 14, 12), mat.gold);
  umbo.scale.set(1.0, 1.15, 0.55);
  umbo.position.set(0, 0, -scutumRadius - 0.008);
  shieldGroup.add(umbo);

  group.add(shieldGroup);

  // Lance romaine (pilum) tenue verticalement sur le côté droit (+X)
  const spearGroup = new THREE.Group();
  spearGroup.position.set(0.225, 0.228, -0.02);

  const spearShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.72, 10), mat.main);
  spearShaft.position.y = 0.36;
  spearGroup.add(spearShaft);

  const spearNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.12, 8), mat.gold);
  spearNeck.position.y = 0.77;
  spearGroup.add(spearNeck);

  const spearTip = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.095, 4), mat.gold);
  spearTip.position.y = 0.86;
  spearGroup.add(spearTip);

  group.add(spearGroup);

  enableShadows(group);
  return group;
}

export function createPieceMesh(type, color, materials) {
  const matSet = color === 'w' ? materials.white : materials.black;
  let meshGroup;
  switch (type) {
    case 'k': meshGroup = buildKing(matSet); break;
    case 'q': meshGroup = buildQueen(matSet); break;
    case 'b': meshGroup = buildBishop(matSet); break;
    case 'n': meshGroup = buildKnight(matSet); break;
    case 'r': meshGroup = buildRook(matSet); break;
    case 'p':
    default:
      meshGroup = buildPawn(matSet); break;
  }

  // Orientation : Blancs face à -Z (vers les Noirs), Noirs face à +Z (vers les Blancs)
  if (color === 'b') {
    meshGroup.rotation.y = Math.PI;
  }
  meshGroup.userData.pieceType = type;
  meshGroup.userData.pieceColor = color;
  return meshGroup;
}

// ============================================================================
// 5. PLATEAU EN MOSAÏQUE ROMAINE & SOCLE PODIUM
// ============================================================================

export function buildBoard3D(materials) {
  const boardGroup = new THREE.Group();
  const tiles = [];
  const totalBoardSpan = SQUARE_SIZE * 8;
  const halfSpan = totalBoardSpan / 2;

  // Socle podium en marbre noir / anthracite (#1E1A16 / #2B2520)
  const plinthOuter = totalBoardSpan + 1.35;
  const plinthBase = new THREE.Mesh(
    new THREE.BoxGeometry(plinthOuter + 0.35, 0.14, plinthOuter + 0.35),
    materials.boardFrameDark
  );
  plinthBase.position.y = 0.07;
  plinthBase.receiveShadow = true;
  plinthBase.castShadow = true;
  boardGroup.add(plinthBase);

  const plinthUpper = new THREE.Mesh(
    new THREE.BoxGeometry(plinthOuter, 0.10, plinthOuter),
    materials.boardFrameBevel
  );
  plinthUpper.position.y = 0.18;
  plinthUpper.receiveShadow = true;
  plinthUpper.castShadow = true;
  boardGroup.add(plinthUpper);

  // Frise à méandres dorés tout autour du podium
  const meanderBand = new THREE.Mesh(
    new THREE.BoxGeometry(plinthOuter + 0.015, 0.075, plinthOuter + 0.015),
    materials.boardMeander
  );
  meanderBand.position.y = 0.18;
  boardGroup.add(meanderBand);

  // Bordure filet doré encadrant les 64 cases
  const innerRim = totalBoardSpan + 0.09;
  const goldRim = new THREE.Mesh(
    new THREE.BoxGeometry(innerRim, 0.025, innerRim),
    materials.white.gold
  );
  goldRim.position.y = BOARD_TOP_Y - 0.012;
  goldRim.receiveShadow = true;
  boardGroup.add(goldRim);

  // Dalles 8×8 de mosaïque romaine
  const tileGeo = new THREE.BoxGeometry(SQUARE_SIZE - 0.012, 0.04, SQUARE_SIZE - 0.012);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const isLight = (row + col) % 2 === 0;
      const tileMat = isLight ? materials.boardLightTile : materials.boardDarkTile;
      const tile = new THREE.Mesh(tileGeo, tileMat);

      const x = (col - 3.5) * SQUARE_SIZE;
      const z = (row - 3.5) * SQUARE_SIZE;
      tile.position.set(x, BOARD_TOP_Y - 0.018, z);
      tile.receiveShadow = true;
      tile.userData.square = { row, col };
      tiles.push(tile);
      boardGroup.add(tile);
    }
  }

  // Coordonnées gravées en or sur le cadre (A–H et I–VIII)
  const files = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const ranks = ['VIII', 'VII', 'VI', 'V', 'IV', 'III', 'II', 'I'];
  const plaqueGeo = new THREE.PlaneGeometry(0.46, 0.46);
  plaqueGeo.rotateX(-Math.PI / 2);

  for (let i = 0; i < 8; i++) {
    const fileTex = createCoordinatePlaqueTexture(files[i], materials.maxAnisotropy);
    const fileMat = new THREE.MeshBasicMaterial({
      map: fileTex,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const xPos = (i - 3.5) * SQUARE_SIZE;

    const frontPlaque = new THREE.Mesh(plaqueGeo, fileMat);
    frontPlaque.position.set(xPos, BOARD_TOP_Y - 0.008, halfSpan + 0.34);
    boardGroup.add(frontPlaque);

    const backPlaque = new THREE.Mesh(plaqueGeo, fileMat);
    backPlaque.rotation.y = Math.PI;
    backPlaque.position.set(xPos, BOARD_TOP_Y - 0.008, -halfSpan - 0.34);
    boardGroup.add(backPlaque);

    const rankTex = createCoordinatePlaqueTexture(ranks[i], materials.maxAnisotropy);
    const rankMat = new THREE.MeshBasicMaterial({
      map: rankTex,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const zPos = (i - 3.5) * SQUARE_SIZE;

    const leftPlaque = new THREE.Mesh(plaqueGeo, rankMat);
    leftPlaque.position.set(-halfSpan - 0.36, BOARD_TOP_Y - 0.008, zPos);
    boardGroup.add(leftPlaque);

    const rightPlaque = new THREE.Mesh(plaqueGeo, rankMat);
    rightPlaque.position.set(halfSpan + 0.36, BOARD_TOP_Y - 0.008, zPos);
    boardGroup.add(rightPlaque);
  }

  return { boardGroup, tiles };
}

export function squareToWorld(row, col) {
  return new THREE.Vector3(
    (col - 3.5) * SQUARE_SIZE,
    BOARD_TOP_Y,
    (row - 3.5) * SQUARE_SIZE
  );
}

export const REFERENCE_PIECES_DATA = [
  {
    type: 'k',
    title: 'Roi — Empereur Romain',
    latin: 'Imperator Augustus',
    desc: 'Vêtu d’une toge drapée à écharpe diagonale, coiffé d’une couronne de lauriers dorée et armé du sceptre impérial surmonté de l’Aquila.',
  },
  {
    type: 'q',
    title: 'Dame — Déesse Drapée',
    latin: 'Dea Regina',
    desc: 'Sculptée dans un péplos fluide à cannelures fines, taille ceinte d’or, chignon classique et diadème radieux à sept pointes solaires.',
  },
  {
    type: 'b',
    title: 'Fou — Philosophe Antique',
    latin: 'Philosophus',
    desc: 'Silhouette érudite drapée dans un manteau himation asymétrique, tête barbue et rouleau de papyrus incliné contre le flanc.',
  },
  {
    type: 'n',
    title: 'Cavalier — Cheval Antique',
    latin: 'Equus Bellicus',
    desc: 'Poitrail puissant et encolure cambrée tournée vers la bataille, museau ciselé, oreilles dressées et crinière crantée à l’antique.',
  },
  {
    type: 'r',
    title: 'Tour — Colonne Corinthienne',
    latin: 'Turris Corinthia',
    desc: 'Fût antique à dix cannelures verticales régulières, chapiteau corinthien à double rangée de feuilles d’acanthe et quatre créneaux romains.',
  },
  {
    type: 'p',
    title: 'Pion — Légionnaire Romain',
    latin: 'Miles Legionis',
    desc: 'Torse en lorica segmentata, casque galea à crête transversale de centurion, lance pilum et grand bouclier scutum courbé à umbo doré.',
  },
];
