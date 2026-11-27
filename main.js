/**
 * Point d'entrée principal — « Échecs Antiques 3D »
 * Orchestre la scène Three.js, l'éclairage de musée, la caméra, le raycasting,
 * les animations, les effets d'éclats, le moteur FIDE, l'IA et le HUD.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { ChessEngine, COLORS, squareToAlgebraic } from './chess-engine.js';
import {
  AI_LEVELS,
  PIECE_LEARNING_TIPS,
  analyzePositionForLearning,
  evaluatePlayedMoveQuality,
  findBestAIMove,
  getPhaseStrategyTips,
} from './chess-ai.js';
import {
  BOARD_TOP_Y,
  REFERENCE_PIECES_DATA,
  SQUARE_SIZE,
  buildBoard3D,
  createMaterialLibrary,
  createPieceMesh,
  squareToWorld,
} from './pieces-3d.js';
import { ShatterFXManager } from './shatter-fx.js';
import { VoiceChessController } from './voice-control.js';
import { TUTORIAL_COMPLETED_STATE, TUTORIAL_STEPS } from './tutorial.js';
import { BEGINNER_BASICS, PIECE_GUIDE_DATA, createPieceDiagramSvg } from './beginner-guide.js';
import {
  PIECE_POINTS,
  PIECE_SHORT_NAMES,
  QUIZ_THEMES,
  advanceQuizConnection,
  getThemeMeta,
  pickQuizQuestion,
} from './quiz-bank.js';

// ============================================================================
// 1. AUDIO PROCÉDURAL DE MUSÉE (WEB AUDIO API, ZÉRO FICHIER EXTERNE)
// ============================================================================

class MuseumAudio {
  constructor() {
    this.ctx = null;
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playMove(isMarble = true) {
    try {
      const ctx = this._ensureCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isMarble ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(isMarble ? 165 : 220, now);
      osc.frequency.exponentialRampToValueAtTime(58, now + 0.09);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch (_) {}
  }

  playCapture() {
    try {
      const ctx = this._ensureCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Bruit bref d'éclat minéral/métallique
      const bufferSize = Math.floor(ctx.sampleRate * 0.18);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.045));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1400, now);
      filter.Q.setValueAtTime(1.4, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
    } catch (_) {}
  }

  playCheck() {
    try {
      const ctx = this._ensureCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    } catch (_) {}
  }
}

// ============================================================================
// 2. ÉTAT DU JEU & CONFIGURATION
// ============================================================================

const engine = new ChessEngine();
const audio = new MuseumAudio();

const gameConfig = {
  mode: 'ai', // 'ai' | 'learning' | 'pvp'
  aiLevel: 2, // 1 | 2 | 3
  playerColor: COLORS.WHITE, // 'w' | 'b'
  quizEnabled: true,
};

function isVsAIMode(mode = gameConfig.mode) {
  return mode === 'ai' || mode === 'learning';
}

function createEmptyQuizStats() {
  return {
    w: { asked: 0, correct: 0, wrong: 0, skipped: 0, recoveredPieces: [] },
    b: { asked: 0, correct: 0, wrong: 0, skipped: 0, recoveredPieces: [] },
  };
}

function normalizeQuizStats(rawStats) {
  const fresh = createEmptyQuizStats();
  if (!rawStats || typeof rawStats !== 'object') return fresh;
  for (const side of ['w', 'b']) {
    const src = rawStats[side];
    if (!src || typeof src !== 'object') continue;
    fresh[side].asked = Number.isFinite(Number(src.asked)) ? Math.max(0, Number(src.asked)) : 0;
    fresh[side].correct = Number.isFinite(Number(src.correct)) ? Math.max(0, Number(src.correct)) : 0;
    fresh[side].wrong = Number.isFinite(Number(src.wrong)) ? Math.max(0, Number(src.wrong)) : 0;
    fresh[side].skipped = Number.isFinite(Number(src.skipped)) ? Math.max(0, Number(src.skipped)) : 0;
    fresh[side].recoveredPieces = Array.isArray(src.recoveredPieces)
      ? src.recoveredPieces.filter((t) => ['p', 'n', 'b', 'r', 'q'].includes(t))
      : [];
  }
  return fresh;
}

// État de la sélection et des tours
let selectedSquare = null; // { row, col }
let legalMovesForSelected = [];
let isAiThinking = false;
let aiSessionToken = 0;
let pendingPromotion = null; // { fromRow, fromCol, toRow, toCol }
let pendingCaptureQuiz = null; // { record, victimColor, currentQuestion, answered, wasCorrect }
let quizStats = createEmptyQuizStats();
const usedQuizQuestionIds = new Set();
advanceQuizConnection();

function beginNewQuizGameSession() {
  if (engine.moveHistory.length > 0 || usedQuizQuestionIds.size > 0) {
    advanceQuizConnection();
  }
  usedQuizQuestionIds.clear();
}

// État du Mode Apprentissage
let learningEnabled = false;
let learningSessionToken = 0;
let currentLearningAnalysis = null;
let showHintArrowOnBoard = false;

// ============================================================================
// 3. DÉTECTION SOFTWARE WEBGL & INITIALISATION THREE.JS
// ============================================================================

const canvasContainer = document.getElementById('canvas-container');
const webglFallback = document.getElementById('webgl-fallback');

const isSoftwareGl = (() => {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch (_) {
    return true;
  }
})();

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
    alpha: true,
  });
} catch (_) {
  renderer = null;
}

if (!renderer) {
  webglFallback.classList.remove('hidden');
}

const scene = new THREE.Scene();
scene.background = null; // Laisse apparaître le dégradé sombre du musée CSS (#0F0D0B -> #191512 -> #0A0907)
scene.fog = new THREE.FogExp2(0x110e0b, 0.013);

const camera = new THREE.PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.1,
  120
);

if (renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasContainer.appendChild(renderer.domElement);

  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
  });

  // Environnement de studio procédural pour les reflets métalliques (bronze & or)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

// ============================================================================
// 4. ÉCLAIRAGE DE MUSÉE CINÉMATIQUE & SOCLE D'EXPOSITION
// ============================================================================

// Lumière hémisphérique froide/chaude pour sculpter les ombres
const hemiLight = new THREE.HemisphereLight(0xd4e2f2, 0x241c15, 0.72);
scene.add(hemiLight);

// Projecteur principal chaud de galerie (ombres portées nettes)
const keyLight = new THREE.DirectionalLight(0xfff1da, 2.55);
keyLight.position.set(6.5, 11.5, 7.5);
keyLight.castShadow = !isSoftwareGl;
keyLight.shadow.mapSize.width = 2048;
keyLight.shadow.mapSize.height = 2048;
keyLight.shadow.camera.near = 2;
keyLight.shadow.camera.far = 30;
keyLight.shadow.camera.left = -6.8;
keyLight.shadow.camera.right = 6.8;
keyLight.shadow.camera.top = 6.8;
keyLight.shadow.camera.bottom = -6.8;
keyLight.shadow.bias = -0.0005;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight);

// Contre-jour / Rim Light argenté pour détacher les silhouettes du fond sombre
const rimLight = new THREE.DirectionalLight(0xbcd0e8, 0.95);
rimLight.position.set(-7.5, 6.5, -8.0);
scene.add(rimLight);

// Lumière d'appoint douce frontale (met en valeur les boucliers scutum et aigles)
const fillLight = new THREE.PointLight(0xffe4b5, 4.5, 22, 1.6);
fillLight.position.set(-4.5, 4.2, 6.2);
scene.add(fillLight);

// Socle de salle de musée + ombre de contact radiale sous l'échiquier
function createMuseumPedestalAndShadow() {
  const group = new THREE.Group();

  const radialCanvas = document.createElement('canvas');
  radialCanvas.width = 256;
  radialCanvas.height = 256;
  const rCtx = radialCanvas.getContext('2d');
  const grad = rCtx.createRadialGradient(128, 128, 30, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.88)');
  grad.addColorStop(0.68, 'rgba(0, 0, 0, 0.55)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  rCtx.fillStyle = grad;
  rCtx.fillRect(0, 0, 256, 256);

  const shadowTex = new THREE.CanvasTexture(radialCanvas);
  shadowTex.colorSpace = THREE.SRGBColorSpace;
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(16.5, 16.5),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -0.02;
  group.add(shadowPlane);

  // Colonne / table d'exposition en marbre sombre sous le plateau
  const columnMat = new THREE.MeshStandardMaterial({
    color: 0x16120f,
    roughness: 0.55,
    metalness: 0.15,
  });
  const tablePedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(5.2, 5.7, 2.2, 48),
    columnMat
  );
  tablePedestal.position.y = -1.11;
  tablePedestal.receiveShadow = true;
  group.add(tablePedestal);

  return group;
}
scene.add(createMuseumPedestalAndShadow());

// ============================================================================
// 5. MATÉRIAUX, PLATEAU, MARQUEURS ET GESTION DES PIÈCES 3D
// ============================================================================

const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
const materials = createMaterialLibrary(maxAniso);
const { boardGroup, tiles } = buildBoard3D(materials);
scene.add(boardGroup);

const shatterFX = new ShatterFXManager(scene);

// Marqueurs visuels sur le plateau
const indicatorsGroup = new THREE.Group();
scene.add(indicatorsGroup);

// Anneau de sélection doré lumineux
const selectedRingMat = new THREE.MeshBasicMaterial({
  color: 0xf3e5ab,
  transparent: true,
  opacity: 0.92,
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});
const selectedRing = new THREE.Mesh(
  new THREE.RingGeometry(0.36, 0.45, 40).rotateX(-Math.PI / 2),
  selectedRingMat
);
selectedRing.visible = false;
indicatorsGroup.add(selectedRing);

// Aura rouge rubis pulsante sous le Roi en échec
const checkAuraMat = new THREE.MeshBasicMaterial({
  color: 0xc92a3e,
  transparent: true,
  opacity: 0.78,
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});
const checkAuraGroup = new THREE.Group();
const checkAuraInner = new THREE.Mesh(
  new THREE.CircleGeometry(0.46, 36).rotateX(-Math.PI / 2),
  checkAuraMat
);
const checkAuraRing = new THREE.Mesh(
  new THREE.RingGeometry(0.41, 0.51, 36).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({
    color: 0xff5a6e,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  })
);
checkAuraGroup.add(checkAuraInner, checkAuraRing);
checkAuraGroup.visible = false;
indicatorsGroup.add(checkAuraGroup);

// Surbrillance discrète des 2 cases du dernier coup
const lastMoveMat = new THREE.MeshBasicMaterial({
  color: 0xd4af37,
  transparent: true,
  opacity: 0.24,
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
});
const lastMoveSquareGeo = new THREE.PlaneGeometry(SQUARE_SIZE * 0.92, SQUARE_SIZE * 0.92).rotateX(-Math.PI / 2);
const lastMoveFromMesh = new THREE.Mesh(lastMoveSquareGeo, lastMoveMat);
const lastMoveToMesh = new THREE.Mesh(lastMoveSquareGeo, lastMoveMat);
lastMoveFromMesh.visible = false;
lastMoveToMesh.visible = false;
indicatorsGroup.add(lastMoveFromMesh, lastMoveToMesh);

// Pastilles/anneaux de coups légaux et cibles de capture
const legalMarkersGroup = new THREE.Group();
indicatorsGroup.add(legalMarkersGroup);

const emptyMoveDiscGeo = new THREE.CircleGeometry(0.145, 28).rotateX(-Math.PI / 2);
const emptyMoveRingGeo = new THREE.RingGeometry(0.20, 0.25, 28).rotateX(-Math.PI / 2);
const captureRingGeo = new THREE.RingGeometry(0.32, 0.43, 36).rotateX(-Math.PI / 2);
const captureGoldOuterGeo = new THREE.RingGeometry(0.43, 0.47, 36).rotateX(-Math.PI / 2);

const legalGoldMat = new THREE.MeshBasicMaterial({
  color: 0xe6c35a,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});
const legalCaptureRedMat = new THREE.MeshBasicMaterial({
  color: 0xb82234,
  transparent: true,
  opacity: 0.9,
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});

// Flèche 3D de conseil (Mode Apprentissage)
const hintGroup = new THREE.Group();
hintGroup.visible = false;
indicatorsGroup.add(hintGroup);

const hintMat = new THREE.MeshStandardMaterial({
  color: 0x6ea997,
  emissive: 0x2c6858,
  emissiveIntensity: 0.55,
  roughness: 0.25,
  metalness: 0.55,
  transparent: true,
  opacity: 0.92,
});
const hintRingGeo = new THREE.RingGeometry(0.36, 0.44, 32).rotateX(-Math.PI / 2);
const hintFromRing = new THREE.Mesh(hintRingGeo, hintMat);
const hintToRing = new THREE.Mesh(hintRingGeo, hintMat);
hintFromRing.position.y = BOARD_TOP_Y + 0.015;
hintToRing.position.y = BOARD_TOP_Y + 0.015;
hintGroup.add(hintFromRing, hintToRing);

const hintArrowBody = new THREE.Group();
hintGroup.add(hintArrowBody);

function show3DHintArrow(move) {
  if (!move) {
    clear3DHintArrow();
    return;
  }
  const from = squareToWorld(move.fromRow, move.fromCol);
  const to = squareToWorld(move.toRow, move.toCol);

  hintFromRing.position.x = from.x;
  hintFromRing.position.z = from.z;
  hintToRing.position.x = to.x;
  hintToRing.position.z = to.z;

  while (hintArrowBody.children.length > 0) {
    const child = hintArrowBody.children[0];
    hintArrowBody.remove(child);
    child.geometry?.dispose();
  }

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);

  const headLen = 0.34;
  const shaftLen = Math.max(0.15, dist - headLen);

  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.04, shaftLen),
    hintMat
  );
  shaft.position.set(0, 0, shaftLen / 2);

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.19, headLen, 4),
    hintMat
  );
  head.rotation.x = Math.PI / 2;
  head.rotation.y = Math.PI / 4;
  head.scale.set(1.0, 1.0, 0.35);
  head.position.set(0, 0, shaftLen + headLen * 0.45);

  hintArrowBody.add(shaft, head);
  hintArrowBody.position.set(from.x, BOARD_TOP_Y + 0.14, from.z);
  hintArrowBody.rotation.y = angle;
  hintGroup.visible = true;
  showHintArrowOnBoard = true;
  document.getElementById('btn-hide-hint')?.classList.remove('hidden');
}

function clear3DHintArrow() {
  hintGroup.visible = false;
  showHintArrowOnBoard = false;
  document.getElementById('btn-hide-hint')?.classList.add('hidden');
}

// Cadre 3D discret de survol de case
const hoverOutlineMat = new THREE.MeshBasicMaterial({
  color: 0xf3e5ab,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
});
const hoverOutlineGeo = new THREE.RingGeometry(0.64, 0.71, 4).rotateZ(Math.PI / 4).rotateX(-Math.PI / 2);
const hoverOutlineMesh = new THREE.Mesh(hoverOutlineGeo, hoverOutlineMat);
hoverOutlineMesh.visible = false;
indicatorsGroup.add(hoverOutlineMesh);

// Inscription 3D de la coordonnée affichée directement sur la case survolée
const hoverTileLabelGroup = new THREE.Group();
hoverTileLabelGroup.visible = false;
indicatorsGroup.add(hoverTileLabelGroup);

const hoverEmptyCanvas = document.createElement('canvas');
hoverEmptyCanvas.width = 512;
hoverEmptyCanvas.height = 468;
const hoverEmptyTex = new THREE.CanvasTexture(hoverEmptyCanvas);
hoverEmptyTex.colorSpace = THREE.SRGBColorSpace;
hoverEmptyTex.anisotropy = maxAniso;

const hoverEmptyMat = new THREE.MeshBasicMaterial({
  map: hoverEmptyTex,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});
const hoverEmptyGeo = new THREE.PlaneGeometry(0.96, 0.88);
hoverEmptyGeo.rotateX(-Math.PI / 2);
const hoverEmptyMesh = new THREE.Mesh(hoverEmptyGeo, hoverEmptyMat);
hoverEmptyMesh.position.set(0, BOARD_TOP_Y + 0.017, 0);
hoverEmptyMesh.renderOrder = 3;
hoverTileLabelGroup.add(hoverEmptyMesh);

const hoverOccupiedCanvas = document.createElement('canvas');
hoverOccupiedCanvas.width = 512;
hoverOccupiedCanvas.height = 224;
const hoverOccupiedTex = new THREE.CanvasTexture(hoverOccupiedCanvas);
hoverOccupiedTex.colorSpace = THREE.SRGBColorSpace;
hoverOccupiedTex.anisotropy = maxAniso;

const hoverOccupiedMat = new THREE.MeshBasicMaterial({
  map: hoverOccupiedTex,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const hoverOccupiedGeo = new THREE.PlaneGeometry(1.04, 0.45);
const hoverOccupiedMesh = new THREE.Mesh(hoverOccupiedGeo, hoverOccupiedMat);
hoverOccupiedMesh.position.set(0, BOARD_TOP_Y + 0.175, 0.47);
hoverOccupiedMesh.rotation.x = -0.72;
hoverOccupiedMesh.renderOrder = 4;
hoverTileLabelGroup.add(hoverOccupiedMesh);

// Map pieceId -> { mesh, row, col, type, color, anim }
const pieceMeshMap = new Map();
const piecesContainer = new THREE.Group();
scene.add(piecesContainer);

function clearAllPieceMeshes() {
  for (const entry of pieceMeshMap.values()) {
    piecesContainer.remove(entry.mesh);
  }
  pieceMeshMap.clear();
}

function syncMeshesFromEngineImmediate() {
  clearAllPieceMeshes();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = engine.board[r][c];
      if (!piece) continue;
      const mesh = createPieceMesh(piece.type, piece.color, materials);
      const pos = squareToWorld(r, c);
      mesh.position.copy(pos);
      mesh.userData.pieceId = piece.id;
      mesh.userData.square = { row: r, col: c };
      piecesContainer.add(mesh);
      pieceMeshMap.set(piece.id, {
        mesh,
        row: r,
        col: c,
        type: piece.type,
        color: piece.color,
        liftY: 0,
        moveAnim: null,
      });
    }
  }
  updateBoardIndicators();
}

function updateBoardIndicators() {
  // Dernier coup joué
  if (engine.lastMove) {
    const fromPos = squareToWorld(engine.lastMove.fromRow, engine.lastMove.fromCol);
    const toPos = squareToWorld(engine.lastMove.toRow, engine.lastMove.toCol);
    lastMoveFromMesh.position.set(fromPos.x, BOARD_TOP_Y + 0.006, fromPos.z);
    lastMoveToMesh.position.set(toPos.x, BOARD_TOP_Y + 0.006, toPos.z);
    lastMoveFromMesh.visible = true;
    lastMoveToMesh.visible = true;
  } else {
    lastMoveFromMesh.visible = false;
    lastMoveToMesh.visible = false;
  }

  // Pièce sélectionnée
  if (selectedSquare) {
    const selPos = squareToWorld(selectedSquare.row, selectedSquare.col);
    selectedRing.position.set(selPos.x, BOARD_TOP_Y + 0.011, selPos.z);
    selectedRing.visible = true;
  } else {
    selectedRing.visible = false;
  }

  // Roi en échec
  if (engine.status === 'check' || engine.status === 'checkmate') {
    const kingPos = engine.findKing(engine.turn);
    if (kingPos) {
      const wp = squareToWorld(kingPos.row, kingPos.col);
      checkAuraGroup.position.set(wp.x, BOARD_TOP_Y + 0.01, wp.z);
      checkAuraGroup.visible = true;
    }
  } else {
    checkAuraGroup.visible = false;
  }

  // Coups légaux
  while (legalMarkersGroup.children.length > 0) {
    legalMarkersGroup.remove(legalMarkersGroup.children[0]);
  }

  // Dédoublonner par case destination (en cas de promotion 4 choix sur la même case)
  const seenSquares = new Set();
  for (const move of legalMovesForSelected) {
    const key = `${move.toRow},${move.toCol}`;
    if (seenSquares.has(key)) continue;
    seenSquares.add(key);

    const wp = squareToWorld(move.toRow, move.toCol);
    const markerGroup = new THREE.Group();
    markerGroup.position.set(wp.x, BOARD_TOP_Y + 0.013, wp.z);

    if (move.capture) {
      const redRing = new THREE.Mesh(captureRingGeo, legalCaptureRedMat);
      const goldOuter = new THREE.Mesh(captureGoldOuterGeo, legalGoldMat);
      markerGroup.add(redRing, goldOuter);
    } else {
      const disc = new THREE.Mesh(emptyMoveDiscGeo, legalGoldMat);
      const ring = new THREE.Mesh(emptyMoveRingGeo, legalGoldMat);
      markerGroup.add(disc, ring);
    }
    legalMarkersGroup.add(markerGroup);
  }
}

// ============================================================================
// 6. CAMÉRA 3D (ORBITCONTROLS) & PRÉRÉGLAGES ANIMÉS
// ============================================================================

const POLAR_MIN_FREE = THREE.MathUtils.degToRad(24);
const POLAR_MAX_FREE = THREE.MathUtils.degToRad(85);

const controls = renderer
  ? new OrbitControls(camera, renderer.domElement)
  : null;

if (controls) {
  controls.enableDamping = !isSoftwareGl;
  controls.dampingFactor = 0.065;
  controls.enablePan = false;
  controls.minDistance = 5.5;
  controls.maxDistance = 42.0;
  controls.minPolarAngle = POLAR_MIN_FREE;
  controls.maxPolarAngle = POLAR_MAX_FREE;
  controls.target.set(0, 0.3, 0);
}

let activeCameraPreset = 'iso';
let cameraTransition = null; // { targetPos: Vector3, targetLook: Vector3, allowTopPolar: boolean }
let lastViewportAspect = window.innerWidth / Math.max(1, window.innerHeight);

const CAMERA_STYLE_ORDER = ['iso', 'top', 'cinematic'];
const CAMERA_STYLE_LABELS = {
  iso: 'Vision : 3D',
  top: 'Vision : 2D',
  cinematic: 'Vision : Cinématique',
};
const btnCameraStyle = document.getElementById('btn-camera-style');
const cameraStyleLabelEl = document.getElementById('camera-style-label');
const cameraViewToastEl = document.getElementById('camera-view-toast');
const cameraViewToastTextEl = document.getElementById('camera-view-toast-text');
let cameraToastTimer = 0;

function showCameraViewToast(label) {
  if (!cameraViewToastEl || !cameraViewToastTextEl) return;
  window.clearTimeout(cameraToastTimer);
  cameraViewToastTextEl.textContent = label;
  cameraViewToastEl.classList.remove('hidden');
  cameraToastTimer = window.setTimeout(() => {
    cameraViewToastEl.classList.add('hidden');
  }, 1500);
}

function cycleCameraPreset({ showToast = false } = {}) {
  const idx = CAMERA_STYLE_ORDER.indexOf(activeCameraPreset);
  const nextPreset = CAMERA_STYLE_ORDER[(idx + 1) % CAMERA_STYLE_ORDER.length];
  setCameraPreset(nextPreset, false);
  if (showToast) {
    showCameraViewToast(CAMERA_STYLE_LABELS[nextPreset] || 'Vision : 3D');
  }
}

// Emprise complète du jeu incluant le socle/cadre extérieur en marbre (±5.05) + marge visuelle
const BOARD_FRAME_HALF_EXTENT = 5.3;
const BOARD_FRAME_MAX_Y = 1.55;

function isSmartphoneLandscape() {
  return (
    window.innerWidth > window.innerHeight &&
    (window.innerWidth <= 960 || window.innerHeight <= 540)
  );
}

function isSmartphoneViewport() {
  return window.innerWidth <= 900 || isSmartphoneLandscape();
}

function isSmartphonePortrait() {
  return isSmartphoneViewport() && !isSmartphoneLandscape();
}

function fitCameraPoseToBoardFrame(basePos, look) {
  const aspect = Math.max(0.35, window.innerWidth / Math.max(1, window.innerHeight));
  const vHalfRad = THREE.MathUtils.degToRad(camera.fov / 2);
  const tanV = Math.tan(vHalfRad);
  const tanH = tanV * aspect;

  const isMenusHidden = document.querySelector('.hud-layer')?.classList.contains('is-menus-hidden');
  let fillX = 0.9;
  let fillY = 0.92;

  if (isSmartphoneLandscape()) {
    const panelWidth = learningEnabled ? Math.min(176, window.innerWidth * 0.26) + 18 : 0;
    const clearHorizRatio = !isMenusHidden
      ? Math.max(0.42, (window.innerWidth - 336) / Math.max(360, window.innerWidth))
      : learningEnabled
      ? Math.max(0.54, (window.innerWidth - panelWidth) / Math.max(360, window.innerWidth))
      : 0.94;
    fillX = clearHorizRatio * 0.93;
    fillY = 0.92 * 0.94;
  } else {
    const clearVertRatio = isMenusHidden
      ? isSmartphonePortrait() && learningEnabled
        ? Math.max(0.76, (window.innerHeight - 135) / Math.max(320, window.innerHeight))
        : 0.92
      : Math.max(0.68, (window.innerHeight - 148) / Math.max(320, window.innerHeight));
    fillX = 0.9;
    fillY = clearVertRatio * 0.92;
  }

  const offset = basePos.clone().sub(look);
  const baseDist = offset.length();
  const dir = offset.clone().normalize();
  const forward = dir.clone().negate();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp);
  if (right.lengthSq() < 1e-6) {
    right.set(1, 0, 0);
  } else {
    right.normalize();
  }
  const camUp = new THREE.Vector3().crossVectors(right, forward).normalize();

  let requiredDist = baseDist;
  const xs = [-BOARD_FRAME_HALF_EXTENT, BOARD_FRAME_HALF_EXTENT];
  const ys = [0, BOARD_FRAME_MAX_Y];
  const zs = [-BOARD_FRAME_HALF_EXTENT, BOARD_FRAME_HALF_EXTENT];
  const corner = new THREE.Vector3();

  for (const cx of xs) {
    for (const cy of ys) {
      for (const cz of zs) {
        corner.set(cx, cy, cz).sub(look);
        const xProj = Math.abs(corner.dot(right));
        const yProj = Math.abs(corner.dot(camUp));
        const zDepth = corner.dot(forward);

        const distX = xProj / (tanH * fillX) - zDepth;
        const distY = yProj / (tanV * fillY) - zDepth;
        requiredDist = Math.max(requiredDist, distX, distY);
      }
    }
  }

  return {
    pos: look.clone().addScaledVector(dir, requiredDist),
    dist: requiredDist,
  };
}

function getPresetPose(preset) {
  const sideSign = isVsAIMode() && gameConfig.playerColor === COLORS.BLACK ? -1 : 1;
  let basePos;
  let look;
  let allowTopPolar = false;

  if (preset === 'cinematic') {
    basePos = new THREE.Vector3(3.8 * sideSign, 3.35, 8.8 * sideSign);
    look = new THREE.Vector3(0, 0.35, 0);
  } else if (preset === 'top') {
    basePos = new THREE.Vector3(0, 14.8, 0.02 * sideSign);
    look = new THREE.Vector3(0, 0.2, 0);
    allowTopPolar = true;
  } else {
    // 'iso' par défaut
    basePos = new THREE.Vector3(0, 8.8, 9.0 * sideSign);
    look = new THREE.Vector3(0, 0.25, 0);
  }

  const fitted = fitCameraPoseToBoardFrame(basePos, look);
  return {
    pos: fitted.pos,
    look,
    dist: fitted.dist,
    allowTopPolar,
  };
}

function setCameraPreset(preset, immediate = false) {
  activeCameraPreset = preset;

  const labelText = CAMERA_STYLE_LABELS[preset] || 'Vision : 3D';
  if (cameraStyleLabelEl) {
    cameraStyleLabelEl.textContent = labelText;
  }
  if (btnCameraStyle) {
    btnCameraStyle.dataset.vision = preset;
    btnCameraStyle.setAttribute('aria-label', `${labelText} (appuyer pour changer de vue)`);
  }

  const pose = getPresetPose(preset);
  if (controls) {
    controls.maxDistance = Math.max(36, pose.dist * 1.45);
  }
  if (immediate || !controls) {
    camera.position.copy(pose.pos);
    if (controls) {
      controls.minPolarAngle = pose.allowTopPolar ? THREE.MathUtils.degToRad(2) : POLAR_MIN_FREE;
      controls.target.copy(pose.look);
      controls.update();
    } else {
      camera.lookAt(pose.look);
    }
    cameraTransition = null;
  } else {
    controls.minPolarAngle = pose.allowTopPolar ? THREE.MathUtils.degToRad(2) : POLAR_MIN_FREE;
    cameraTransition = {
      targetPos: pose.pos,
      targetLook: pose.look,
      allowTopPolar: pose.allowTopPolar,
    };
  }
}

if (controls) {
  controls.addEventListener('start', () => {
    // Annule toute transition scriptée dès que l'utilisateur prend la main
    cameraTransition = null;
    if (activeCameraPreset !== 'top') {
      controls.minPolarAngle = POLAR_MIN_FREE;
    }
  });
}

setCameraPreset('iso', true);

// ============================================================================
// 7. EXÉCUTION DES COUPS, ANIMATIONS & EFFET D'ÉCLATS
// ============================================================================

async function executeMoveVisualAndEngine(move) {
  const movingPieceBefore = engine.getPiece(move.fromRow, move.fromCol);
  if (!movingPieceBefore) return;

  const preMoveAnalysis = learningEnabled ? currentLearningAnalysis : null;
  const wasHumanMover =
    !isVsAIMode() || movingPieceBefore.color === gameConfig.playerColor;

  const record = engine.makeMove(move);
  if (!record) return;

  selectedSquare = null;
  legalMovesForSelected = [];
  clear3DHintArrow();
  updatePieceTipUI(null);

  // Déclenchement capture (prise normale ou en passant)
  if (record.capturedPiece) {
    const capEntry = pieceMeshMap.get(record.capturedPiece.id);
    if (capEntry) {
      const capWorldPos = capEntry.mesh.position.clone();
      piecesContainer.remove(capEntry.mesh);
      pieceMeshMap.delete(record.capturedPiece.id);
      shatterFX.spawnShatter(capWorldPos, record.capturedPiece.color);
      audio.playCapture();
    }
  } else {
    audio.playMove(record.color === COLORS.WHITE);
  }

  // Déplacement visuel de la pièce principale
  const movedEntry = pieceMeshMap.get(record.pieceId);
  if (movedEntry) {
    // En cas de promotion, remplacer le maillage par la nouvelle sculpture
    if (record.promotion && movedEntry.type !== record.pieceType) {
      const oldPos = movedEntry.mesh.position.clone();
      piecesContainer.remove(movedEntry.mesh);
      const newMesh = createPieceMesh(record.pieceType, record.color, materials);
      newMesh.position.copy(oldPos);
      newMesh.userData.pieceId = record.pieceId;
      piecesContainer.add(newMesh);
      movedEntry.mesh = newMesh;
      movedEntry.type = record.pieceType;
    }

    const startPos = movedEntry.mesh.position.clone();
    const endPos = squareToWorld(record.toRow, record.toCol);
    movedEntry.row = record.toRow;
    movedEntry.col = record.toCol;
    movedEntry.mesh.userData.square = { row: record.toRow, col: record.toCol };
    movedEntry.moveAnim = {
      startPos,
      endPos,
      elapsed: 0,
      duration: 0.34,
      arcHeight: record.pieceType === 'n' ? 0.72 : 0.34,
    };
  }

  // Déplacement visuel de la tour lors du roque
  if (record.rookMove) {
    const rookEntry = pieceMeshMap.get(record.rookMove.pieceId);
    if (rookEntry) {
      const rStart = rookEntry.mesh.position.clone();
      const rEnd = squareToWorld(record.rookMove.toRow, record.rookMove.toCol);
      rookEntry.row = record.rookMove.toRow;
      rookEntry.col = record.rookMove.toCol;
      rookEntry.mesh.userData.square = { row: record.rookMove.toRow, col: record.rookMove.toCol };
      rookEntry.moveAnim = {
        startPos: rStart,
        endPos: rEnd,
        elapsed: 0,
        duration: 0.38,
        arcHeight: 0.25,
      };
    }
  }

  if (engine.status === 'check' || engine.status === 'checkmate') {
    audio.playCheck();
  }

  updateBoardIndicators();
  updateHUD();

  if (learningEnabled && wasHumanMover && preMoveAnalysis) {
    evaluatePlayedMoveQuality(engine, record, preMoveAnalysis).then((verdict) => {
      if (verdict) renderLearningFeedback(verdict);
    });
  }

  if (tutorialActive && !tutorialCompleted && wasHumanMover) {
    onTutorialHumanMovePlayed();
  }

  if (!tutorialActive) {
    persistAutoSaveIfNeeded();
  }

  if (shouldTriggerCaptureQuiz(record)) {
    pendingCaptureQuiz = {
      record,
      victimColor: record.capturedPiece.color,
      currentQuestion: null,
      answered: false,
      wasCorrect: false,
    };
    window.setTimeout(() => {
      if (pendingCaptureQuiz && pendingCaptureQuiz.record === record) {
        openCaptureQuizModal();
      }
    }, 460);
    return;
  }

  if (engine.status === 'checkmate' || engine.status === 'stalemate' || engine.status === 'draw') {
    refreshLearningAdvice();
    setTimeout(() => showGameOverModal(), 620);
    return;
  }

  if (isVsAIMode() && engine.turn !== gameConfig.playerColor) {
    maybeTriggerAIMove();
  } else {
    refreshLearningAdvice();
  }
}

async function maybeTriggerAIMove() {
  if (!isVsAIMode()) return;
  if (pendingCaptureQuiz) return;
  if (engine.turn === gameConfig.playerColor) return;
  if (engine.status === 'checkmate' || engine.status === 'stalemate' || engine.status === 'draw') return;

  const myToken = ++aiSessionToken;
  isAiThinking = true;
  updateHUD();

  try {
    const bestMove = await findBestAIMove(engine, gameConfig.aiLevel);
    if (myToken !== aiSessionToken) return; // Partie annulée/réinitialisée entre-temps
    isAiThinking = false;
    updateHUD();

    if (bestMove) {
      executeMoveVisualAndEngine(bestMove);
    }
  } catch (err) {
    console.error('Erreur IA:', err);
    isAiThinking = false;
    updateHUD();
  }
}

// ============================================================================
// 8. INTERACTION SOURIS / TACTILE (RAYCASTING)
// ============================================================================

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let pointerDownPos = { x: 0, y: 0 };
let lastHoverCheck = 0;

function updatePointerNDC(clientX, clientY) {
  pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
}

function getClickedSquareFromRay(clientX, clientY) {
  updatePointerNDC(clientX, clientY);
  raycaster.setFromCamera(pointerNDC, camera);

  // 1. Tester les pièces en priorité (plus naturel en vue 3D inclinée)
  const pieceMeshes = Array.from(pieceMeshMap.values()).map((e) => e.mesh);
  const pieceHits = raycaster.intersectObjects(pieceMeshes, true);
  if (pieceHits.length > 0) {
    let curr = pieceHits[0].object;
    while (curr && curr.parent !== piecesContainer) {
      curr = curr.parent;
    }
    if (curr && curr.userData.square) {
      return curr.userData.square;
    }
  }

  // 2. Tester les 64 dalles du plateau
  const tileHits = raycaster.intersectObjects(tiles, false);
  if (tileHits.length > 0 && tileHits[0].object.userData.square) {
    return tileHits[0].object.userData.square;
  }

  return null;
}

function isHumanTurn() {
  if (isAiThinking || pendingPromotion || pendingCaptureQuiz) return false;
  if (engine.status === 'checkmate' || engine.status === 'stalemate' || engine.status === 'draw') {
    return false;
  }
  if (isVsAIMode() && engine.turn !== gameConfig.playerColor) return false;
  return true;
}

function handleSquareClick(sq) {
  if (!sq || !isHumanTurn()) {
    selectedSquare = null;
    legalMovesForSelected = [];
    updateBoardIndicators();
    return;
  }

  const clickedPiece = engine.getPiece(sq.row, sq.col);

  // Si un coup légal existe vers la case cliquée
  if (selectedSquare) {
    const matchingMoves = legalMovesForSelected.filter(
      (m) => m.toRow === sq.row && m.toCol === sq.col
    );
    if (matchingMoves.length > 0) {
      // Vérifier s'il s'agit d'une promotion de pion
      if (matchingMoves.some((m) => m.promotion)) {
        pendingPromotion = {
          fromRow: matchingMoves[0].fromRow,
          fromCol: matchingMoves[0].fromCol,
          toRow: matchingMoves[0].toRow,
          toCol: matchingMoves[0].toCol,
        };
        openModal('modal-promotion');
        return;
      }
      executeMoveVisualAndEngine(matchingMoves[0]);
      return;
    }
  }

  // Sinon, sélectionner une pièce alliée si présente
  if (clickedPiece && clickedPiece.color === engine.turn) {
    if (
      selectedSquare &&
      selectedSquare.row === sq.row &&
      selectedSquare.col === sq.col
    ) {
      selectedSquare = null;
      legalMovesForSelected = [];
      updatePieceTipUI(null);
    } else {
      selectedSquare = { row: sq.row, col: sq.col };
      legalMovesForSelected = engine.getLegalMovesForSquare(sq.row, sq.col);
      updatePieceTipUI(clickedPiece.type);
    }
  } else {
    selectedSquare = null;
    legalMovesForSelected = [];
    updatePieceTipUI(null);
  }

  updateBoardIndicators();
}

let lastHoveredKey = null;
let isPointerDragging = false;

function getCameraSnapYaw() {
  const camYaw = Math.atan2(camera.position.x, camera.position.z);
  return Math.round(camYaw / (Math.PI / 2)) * (Math.PI / 2);
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function renderOnSquareCoordinate(alg, squareNum, hasPiece) {
  if (hasPiece) {
    const ctx = hoverOccupiedCanvas.getContext('2d');
    const w = hoverOccupiedCanvas.width;
    const h = hoverOccupiedCanvas.height;
    ctx.clearRect(0, 0, w, h);

    drawRoundedRectPath(ctx, 10, 10, w - 20, h - 20, 28);
    ctx.fillStyle = 'rgba(14, 11, 9, 0.93)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.92)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 116px "Cinzel", Georgia, serif';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillText(`${alg} · ${squareNum}`, w / 2 + 3, h / 2 + 6, w - 56);
    ctx.fillStyle = '#FFF1BE';
    ctx.fillText(`${alg} · ${squareNum}`, w / 2, h / 2 + 2, w - 56);

    hoverOccupiedTex.needsUpdate = true;
    hoverEmptyMesh.visible = false;
    hoverOccupiedMesh.visible = true;
  } else {
    const ctx = hoverEmptyCanvas.getContext('2d');
    const w = hoverEmptyCanvas.width;
    const h = hoverEmptyCanvas.height;
    ctx.clearRect(0, 0, w, h);

    drawRoundedRectPath(ctx, 14, 14, w - 28, h - 28, 34);
    ctx.fillStyle = 'rgba(14, 11, 9, 0.84)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.85)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '700 208px "Cinzel", Georgia, serif';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillText(alg, w / 2 + 3, h * 0.40 + 6, w - 56);
    ctx.fillStyle = '#FFF1BE';
    ctx.fillText(alg, w / 2, h * 0.40, w - 56);

    ctx.font = '700 84px "Cinzel", Georgia, serif';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillText(`Case ${squareNum}`, w / 2 + 2, h * 0.78 + 3, w - 56);
    ctx.fillStyle = '#D4AF37';
    ctx.fillText(`Case ${squareNum}`, w / 2, h * 0.78, w - 56);

    hoverEmptyTex.needsUpdate = true;
    hoverOccupiedMesh.visible = false;
    hoverEmptyMesh.visible = true;
  }
}

function hideSquareHover() {
  lastHoveredKey = null;
  hoverOutlineMesh.visible = false;
  hoverTileLabelGroup.visible = false;
}

if (renderer) {
  const domEl = renderer.domElement;
  const activeCanvasPointers = new Set();
  let gestureHadMultiTouch = false;
  let pointerDownTime = 0;

  domEl.addEventListener('pointerdown', (e) => {
    activeCanvasPointers.add(e.pointerId);
    if (activeCanvasPointers.size > 1) {
      gestureHadMultiTouch = true;
    } else {
      gestureHadMultiTouch = false;
      pointerDownPos = { x: e.clientX, y: e.clientY };
      pointerDownTime = performance.now();
    }
    isPointerDragging = true;
    hideSquareHover();
  });

  domEl.addEventListener('pointerup', (e) => {
    activeCanvasPointers.delete(e.pointerId);
    const wasMultiTouch = gestureHadMultiTouch;
    if (activeCanvasPointers.size === 0) {
      isPointerDragging = false;
      gestureHadMultiTouch = false;
    }
    if (wasMultiTouch || activeCanvasPointers.size > 0) return;

    const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
    const elapsed = performance.now() - pointerDownTime;
    if (dist > 10 || elapsed > 450) return; // L'utilisateur a fait pivoter la caméra

    const sq = getClickedSquareFromRay(e.clientX, e.clientY);
    const hadSelectedPiece = Boolean(selectedSquare);
    handleSquareClick(sq);

    if (
      !sq &&
      !hadSelectedPiece &&
      isSmartphoneViewport() &&
      !document.querySelector('.modal-backdrop:not(.hidden)')
    ) {
      cycleCameraPreset({ showToast: true });
    }
  });

  domEl.addEventListener('pointercancel', (e) => {
    activeCanvasPointers.delete(e.pointerId);
    if (activeCanvasPointers.size === 0) {
      isPointerDragging = false;
      gestureHadMultiTouch = false;
    }
  });

  domEl.addEventListener('pointerleave', () => {
    isPointerDragging = false;
    hideSquareHover();
  });

  domEl.addEventListener('pointermove', (e) => {
    if (isPointerDragging) return;

    const now = performance.now();
    if (now - lastHoverCheck < 28) return;
    lastHoverCheck = now;

    const sq = getClickedSquareFromRay(e.clientX, e.clientY);
    if (!sq) {
      domEl.style.cursor = 'grab';
      hideSquareHover();
      return;
    }

    const piece = engine.getPiece(sq.row, sq.col);
    const hasPiece = Boolean(piece);
    const hoverKey = `${sq.row},${sq.col},${hasPiece ? 1 : 0}`;

    if (lastHoveredKey !== hoverKey) {
      lastHoveredKey = hoverKey;
      const wp = squareToWorld(sq.row, sq.col);
      hoverOutlineMesh.position.set(wp.x, BOARD_TOP_Y + 0.009, wp.z);
      hoverOutlineMesh.visible = true;

      const alg = squareToAlgebraic(sq.row, sq.col).toUpperCase();
      const squareNum = (7 - sq.row) * 8 + sq.col + 1;
      renderOnSquareCoordinate(alg, squareNum, hasPiece);

      hoverTileLabelGroup.position.set(wp.x, 0, wp.z);
      hoverTileLabelGroup.rotation.y = getCameraSnapYaw();
      hoverTileLabelGroup.visible = true;
    }

    if (!isHumanTurn()) {
      domEl.style.cursor = 'grab';
      return;
    }

    const isFriendly = piece && piece.color === engine.turn;
    const isLegalTarget =
      selectedSquare && legalMovesForSelected.some((m) => m.toRow === sq.row && m.toCol === sq.col);

    domEl.style.cursor = isFriendly || isLegalTarget ? 'pointer' : 'grab';
  });
}

// ============================================================================
// 9. INTERFACE HUD & MODALES
// ============================================================================

const hudModeSubtitle = document.getElementById('hud-mode-subtitle');
const turnSwatch = document.getElementById('turn-swatch');
const turnLabel = document.getElementById('turn-label');
const aiThinkingEl = document.getElementById('ai-thinking');
const aiThinkingText = document.getElementById('ai-thinking-text');
const checkAlertEl = document.getElementById('check-alert');
const capturedWhiteEl = document.getElementById('captured-white');
const capturedBlackEl = document.getElementById('captured-black');
const btnUndo = document.getElementById('btn-undo');

const SHORT_PIECE_LABEL = {
  q: 'Dame',
  r: 'Tour',
  b: 'Fou',
  n: 'Cavalier',
  p: 'Pion',
};

function formatCapturedSummary(types) {
  if (!types || types.length === 0) return 'Aucune perte';
  const order = ['q', 'r', 'b', 'n', 'p'];
  const counts = {};
  for (const t of types) counts[t] = (counts[t] || 0) + 1;
  const parts = [];
  for (const t of order) {
    if (counts[t]) {
      parts.push(counts[t] > 1 ? `${counts[t]}× ${SHORT_PIECE_LABEL[t]}` : SHORT_PIECE_LABEL[t]);
    }
  }
  return parts.join(' · ');
}

function updateHUD() {
  if (gameConfig.mode === 'learning') {
    hudModeSubtitle.textContent = `Apprentissage (vs Ordinateur) · ${AI_LEVELS[gameConfig.aiLevel].label}`;
  } else if (gameConfig.mode === 'ai') {
    hudModeSubtitle.textContent = learningEnabled
      ? `Contre l'ordinateur · ${AI_LEVELS[gameConfig.aiLevel].label} · Conseils`
      : `Contre l'ordinateur · ${AI_LEVELS[gameConfig.aiLevel].label}`;
  } else {
    hudModeSubtitle.textContent = learningEnabled
      ? 'Contre un joueur · 2 Joueurs · Conseils'
      : 'Contre un joueur · 2 Joueurs (Local)';
  }

  const quickAiBtn = document.getElementById('btn-quick-ai');
  const quickPvpBtn = document.getElementById('btn-quick-pvp');
  const vsAi = isVsAIMode();
  if (quickAiBtn) {
    quickAiBtn.classList.toggle('is-active', vsAi);
    quickAiBtn.setAttribute('aria-pressed', String(vsAi));
  }
  if (quickPvpBtn) {
    quickPvpBtn.classList.toggle('is-active', !vsAi);
    quickPvpBtn.setAttribute('aria-pressed', String(!vsAi));
  }

  const isWhiteTurn = engine.turn === COLORS.WHITE;
  turnSwatch.className = `material-swatch ${isWhiteTurn ? 'swatch-white' : 'swatch-black'}`;

  if (engine.status === 'checkmate') {
    const winSide = engine.winner === COLORS.WHITE ? 'Blancs (Marbre)' : 'Noirs (Bronze)';
    turnLabel.textContent = `Échec et Mat · Victoire ${winSide}`;
  } else if (engine.status === 'stalemate' || engine.status === 'draw') {
    turnLabel.textContent = 'Partie Nulle';
  } else {
    turnLabel.textContent = isWhiteTurn ? 'Tour : Blancs (Marbre)' : 'Tour : Noirs (Bronze)';
  }

  if (isAiThinking) {
    const aiTitle =
      gameConfig.aiLevel === 3
        ? "L'Empereur réfléchit..."
        : gameConfig.aiLevel === 2
        ? 'Le Centurion calcule...'
        : "L'Initié observe le plateau...";
    aiThinkingText.textContent = aiTitle;
    aiThinkingEl.classList.remove('hidden');
  } else {
    aiThinkingEl.classList.add('hidden');
  }

  const inCheck = engine.status === 'check' || engine.status === 'checkmate';
  checkAlertEl.classList.toggle('hidden', !inCheck);

  // Pertes : capturedByBlack contient les pièces blanches (Marbre) capturées
  capturedWhiteEl.textContent = formatCapturedSummary(engine.capturedByBlack);
  capturedBlackEl.textContent = formatCapturedSummary(engine.capturedByWhite);

  const canUndo =
    !isAiThinking &&
    !pendingPromotion &&
    (!isVsAIMode()
      ? engine.moveHistory.length >= 1
      : engine.moveHistory.length >= 2 ||
        (engine.moveHistory.length === 1 && gameConfig.playerColor === COLORS.WHITE));
  btnUndo.disabled = !canUndo;

  const btnLearning = document.getElementById('btn-learning');
  if (btnLearning) {
    btnLearning.classList.toggle('is-active', learningEnabled);
    btnLearning.setAttribute('aria-pressed', String(learningEnabled));
  }
  syncLearningPanelLayout();
}

// --- Panneau Mode Apprentissage & Conseils ---
const learningPanelEl = document.getElementById('learning-panel');
const learningMetaEl = document.getElementById('learning-meta');
const learningFeedbackEl = document.getElementById('learning-feedback');
const learningFeedbackTitleEl = document.getElementById('learning-feedback-title');
const learningFeedbackTextEl = document.getElementById('learning-feedback-text');
const learningThreatsEl = document.getElementById('learning-threats');
const learningThreatsTextEl = document.getElementById('learning-threats-text');
const learningEvalScoreEl = document.getElementById('learning-eval-score');
const learningRecommendedMoveEl = document.getElementById('learning-recommended-move');
const learningReasonEl = document.getElementById('learning-reason');
const learningPieceTipEl = document.getElementById('learning-piece-tip');
const learningPieceTipTextEl = document.getElementById('learning-piece-tip-text');
const learningPieceDiagramEl = document.getElementById('learning-piece-diagram');

function updatePieceTipUI(pieceType) {
  if (!learningEnabled || !pieceType || !PIECE_LEARNING_TIPS[pieceType]) {
    learningPieceTipEl.classList.add('hidden');
    learningPieceDiagramEl?.replaceChildren();
    return;
  }
  learningPieceTipTextEl.textContent = PIECE_LEARNING_TIPS[pieceType];
  if (learningPieceDiagramEl) {
    learningPieceDiagramEl.replaceChildren(createPieceDiagramSvg(pieceType));
  }
  learningPieceTipEl.classList.remove('hidden');
}

function renderLearningFeedback(verdict) {
  if (!verdict) {
    learningFeedbackEl.classList.add('hidden');
    return;
  }
  learningFeedbackEl.className = `learning-section grade-${verdict.grade}`;
  learningFeedbackTitleEl.textContent = verdict.title;
  learningFeedbackTextEl.textContent = verdict.detail;
  learningFeedbackEl.classList.remove('hidden');
}

function clearLearningFeedback() {
  learningFeedbackEl.classList.add('hidden');
}

function formatAdvantageLabel(cp) {
  if (Math.abs(cp) > 50000) return cp > 0 ? 'Mat Blancs' : 'Mat Noirs';
  const pawns = (cp / 100).toFixed(1);
  if (Math.abs(cp) < 35) return '0.0 (Équilibre)';
  return cp > 0 ? `+${pawns} Marbre` : `${pawns} Bronze`;
}

async function refreshLearningAdvice() {
  if (!learningEnabled) return;
  const myToken = ++learningSessionToken;

  if (engine.status === 'checkmate' || engine.status === 'stalemate' || engine.status === 'draw') {
    currentLearningAnalysis = null;
    learningMetaEl.textContent = 'Partie terminée';
    learningRecommendedMoveEl.textContent =
      engine.status === 'checkmate' ? 'Échec et mat accompli.' : 'Partie nulle.';
    learningReasonEl.textContent =
      'Consultez les Chroniques de la Bataille ou engagez une nouvelle partie pour continuer à progresser.';
    learningThreatsEl.classList.add('hidden');
    return;
  }

  if (isVsAIMode() && engine.turn !== gameConfig.playerColor) {
    learningMetaEl.textContent = 'Tour de l’adversaire...';
    return;
  }

  learningMetaEl.textContent = 'Analyse tactique en cours...';
  const analysis = await analyzePositionForLearning(engine);
  if (myToken !== learningSessionToken || !learningEnabled || !analysis) return;

  currentLearningAnalysis = analysis;
  const evalText = formatAdvantageLabel(analysis.whiteAdvantageCp);
  learningMetaEl.textContent = `${analysis.phase} · ${evalText}`;
  learningEvalScoreEl.textContent =
    Math.abs(analysis.whiteAdvantageCp) > 50000
      ? 'Mat'
      : `${analysis.whiteAdvantageCp >= 0 ? '+' : ''}${(analysis.whiteAdvantageCp / 100).toFixed(1)}`;
  learningRecommendedMoveEl.textContent = analysis.moveLabel;
  learningReasonEl.textContent = analysis.reason;

  if (analysis.threats.length > 0) {
    const top = analysis.threats[0];
    const pName = SHORT_PIECE_LABEL[top.type] || 'Pièce';
    const defNote = top.defended ? 'défendu' : 'non défendu !';
    learningThreatsTextEl.textContent = `Votre ${pName} en ${top.sq} est attaqué (${defNote}).`;
    learningThreatsEl.classList.remove('hidden');
  } else {
    learningThreatsEl.classList.add('hidden');
  }

  if (tutorialActive && !tutorialCompleted) {
    if (tutorialWaitingForAi) {
      tutorialWaitingForAi = false;
      renderTutorialStep();
    } else if (
      TUTORIAL_STEPS[tutorialStepIndex]?.kind === 'move' &&
      !showHintArrowOnBoard
    ) {
      showTutorialHintArrowForStep(TUTORIAL_STEPS[tutorialStepIndex]);
    }
  }
}

let autoHidMenusForLearning = false;
let lastIsLandscapeLayout = isSmartphoneLandscape();

function resetLearningPanelPosition() {
  if (!learningPanelEl) return;
  learningPanelEl.classList.remove('is-positioned', 'is-dragging');
  learningPanelEl.style.left = '';
  learningPanelEl.style.top = '';
  learningPanelEl.style.right = '';
  learningPanelEl.style.bottom = '';
}

function syncLearningPanelLayout() {
  const hudLayer = document.querySelector('.hud-layer');
  const hudTop = document.querySelector('.hud-top');
  const nowLandscape = isSmartphoneLandscape();

  if (nowLandscape !== lastIsLandscapeLayout) {
    lastIsLandscapeLayout = nowLandscape;
    resetLearningPanelPosition();
  }

  if (hudLayer && hudTop && !nowLandscape) {
    const topRect = hudTop.getBoundingClientRect();
    if (topRect.height > 0) {
      const offset = Math.max(76, Math.round(topRect.bottom + 8));
      /** @type {HTMLElement} */ (hudLayer).style.setProperty(
        '--learning-top-offset',
        `${offset}px`
      );
    }
  }
}

function enterMobileLearningMode() {
  resetLearningPanelPosition();
  if (!menusHidden) {
    autoHidMenusForLearning = true;
    setMenusHidden(true);
  }
  if (isSmartphoneLandscape() && !getFullscreenElement()) {
    try {
      const root = /** @type {any} */ (document.documentElement);
      if (root.requestFullscreen) {
        root.requestFullscreen().catch(() => {});
      } else if (root.webkitRequestFullscreen) {
        root.webkitRequestFullscreen();
      }
    } catch (_) {}
  }
}

function setLearningEnabled(enabled) {
  learningEnabled = enabled;
  learningPanelEl.classList.toggle('hidden', !enabled);
  learningPanelEl.classList.toggle('is-tutorial-active', Boolean(tutorialActive));

  if (!enabled) {
    learningSessionToken++;
    clear3DHintArrow();
    updatePieceTipUI(null);
    stopInteractiveTutorial();
    if (autoHidMenusForLearning) {
      autoHidMenusForLearning = false;
      setMenusHidden(false);
    }
  } else {
    if (selectedSquare) {
      const p = engine.getPiece(selectedSquare.row, selectedSquare.col);
      updatePieceTipUI(p ? p.type : null);
    }
    refreshLearningAdvice();
  }
  updateHUD();
  syncLearningPanelLayout();
  if (isSmartphoneViewport()) {
    setCameraPreset(activeCameraPreset, false);
  }
}

document.getElementById('btn-learning').addEventListener('click', () => {
  const nextEnabled = !learningEnabled;
  if (nextEnabled && isSmartphoneViewport()) {
    enterMobileLearningMode();
  }
  setLearningEnabled(nextEnabled);
});

document.getElementById('btn-learning-close').addEventListener('click', () => {
  setLearningEnabled(false);
});

document.getElementById('btn-show-hint').addEventListener('click', async () => {
  if (!learningEnabled) setLearningEnabled(true);
  if (!isHumanTurn()) return;
  if (!currentLearningAnalysis) {
    await refreshLearningAdvice();
  }
  if (currentLearningAnalysis?.bestMove) {
    show3DHintArrow(currentLearningAnalysis.bestMove);
  }
});

document.getElementById('btn-hide-hint').addEventListener('click', () => {
  clear3DHintArrow();
});

async function openCoachInfoModal() {
  const phaseEl = document.getElementById('coach-info-phase');
  const evalBadgeEl = document.getElementById('coach-info-eval-badge');
  const moveEl = document.getElementById('coach-info-move');
  const objectiveEl = document.getElementById('coach-info-objective');
  const evalDescEl = document.getElementById('coach-info-eval-desc');
  const reasonsBlockEl = document.getElementById('coach-info-reasons-block');
  const reasonsListEl = document.getElementById('coach-info-reasons-list');
  const candidatesBlockEl = document.getElementById('coach-info-candidates-block');
  const candidatesListEl = document.getElementById('coach-info-candidates-list');
  const threatsTextEl = document.getElementById('coach-info-threats-text');
  const phaseTitleEl = document.getElementById('coach-info-phase-title');
  const phaseTipsEl = document.getElementById('coach-info-phase-tips');
  const show3dBtn = document.getElementById('btn-coach-info-show-3d');

  if (!currentLearningAnalysis && isHumanTurn() && engine.status !== 'checkmate' && engine.status !== 'stalemate' && engine.status !== 'draw') {
    await refreshLearningAdvice();
  }

  const analysis = currentLearningAnalysis;
  const fallbackPhase = engine.fullMoveNumber <= 8 ? 'Ouverture' : 'Milieu de jeu';
  const activePhase = analysis?.phase || fallbackPhase;
  const phaseGuide = analysis?.details?.phaseGuide || getPhaseStrategyTips(activePhase);

  if (phaseEl) phaseEl.textContent = activePhase;
  if (phaseTitleEl) phaseTitleEl.textContent = phaseGuide.title;
  if (phaseTipsEl) {
    phaseTipsEl.replaceChildren();
    for (const tip of phaseGuide.tips) {
      const li = document.createElement('li');
      li.textContent = tip;
      phaseTipsEl.appendChild(li);
    }
  }

  if (analysis && analysis.details) {
    const { details } = analysis;
    if (evalBadgeEl) {
      evalBadgeEl.textContent =
        Math.abs(analysis.whiteAdvantageCp) > 50000
          ? 'Mat'
          : `${analysis.whiteAdvantageCp >= 0 ? '+' : ''}${(analysis.whiteAdvantageCp / 100).toFixed(1)}`;
    }
    if (moveEl) moveEl.textContent = `Coup conseillé : ${analysis.moveLabel}`;
    if (objectiveEl) objectiveEl.textContent = `Objectif : ${details.objectiveTitle}`;
    if (evalDescEl) evalDescEl.textContent = details.evalExplanation;

    if (reasonsBlockEl && reasonsListEl) {
      reasonsBlockEl.classList.remove('hidden');
      reasonsListEl.replaceChildren();
      for (const item of details.tacticalBreakdown) {
        const li = document.createElement('li');
        li.textContent = item;
        reasonsListEl.appendChild(li);
      }
    }

    if (candidatesBlockEl && candidatesListEl) {
      candidatesBlockEl.classList.remove('hidden');
      candidatesListEl.replaceChildren();
      for (const cand of details.candidates) {
        const row = document.createElement('div');
        row.className = `coach-candidate-row${cand.isBest ? ' is-best' : ''}`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'coach-candidate-name';
        nameSpan.textContent = `${cand.rank}. ${cand.label}`;

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'coach-candidate-score';
        if (Math.abs(cand.whiteScoreCp) > 50000) {
          scoreSpan.textContent = 'Mat';
        } else {
          const valStr = `${cand.whiteScoreCp >= 0 ? '+' : ''}${(cand.whiteScoreCp / 100).toFixed(1)}`;
          scoreSpan.textContent = cand.isBest
            ? `${valStr} · Optimal`
            : `${valStr} (-${(cand.deltaCp / 100).toFixed(1)})`;
        }

        row.append(nameSpan, scoreSpan);
        candidatesListEl.appendChild(row);
      }
    }

    if (threatsTextEl) {
      if (analysis.inCheckBefore) {
        threatsTextEl.textContent =
          'Alerte Échec : votre Empereur est directement menacé. Le coup recommandé répond en priorité à cette menace.';
      } else if (analysis.threats.length > 0) {
        const items = analysis.threats.slice(0, 3).map((t) => {
          const pName = SHORT_PIECE_LABEL[t.type] || 'Pièce';
          return `${pName} en ${t.sq} (${t.defended ? 'défendu' : 'non défendu !'})`;
        });
        threatsTextEl.textContent = `Pièce(s) sous pression : ${items.join(' · ')}.`;
      } else {
        threatsTextEl.textContent =
          'Aucune pièce majeure alliée n’est actuellement exposée sans défense. Vous pouvez développer votre plan librement.';
      }
    }

    if (show3dBtn) {
      show3dBtn.classList.toggle('hidden', !isHumanTurn());
    }
  } else {
    if (evalBadgeEl) evalBadgeEl.textContent = learningEvalScoreEl?.textContent || '0.0';
    if (moveEl) {
      moveEl.textContent =
        engine.status === 'checkmate' || engine.status === 'stalemate' || engine.status === 'draw'
          ? 'Partie terminée'
          : 'En attente du coup de l’adversaire';
    }
    if (objectiveEl) objectiveEl.textContent = 'Lecture stratégique de la position';
    if (evalDescEl) {
      evalDescEl.textContent =
        'L’évaluation mesure l’avantage matériel et positionnel en équivalent pions (+ positif pour le Marbre, - négatif pour le Bronze).';
    }
    reasonsBlockEl?.classList.add('hidden');
    candidatesBlockEl?.classList.add('hidden');
    if (threatsTextEl) {
      threatsTextEl.textContent =
        'Vérifiez toujours avant de jouer si une de vos pièces de valeur (Dame, Tour, Fou, Cavalier) vient d’être attaquée.';
    }
    show3dBtn?.classList.add('hidden');
  }

  openModal('modal-coach-info');
}

document.getElementById('btn-coach-more-info')?.addEventListener('click', () => {
  openCoachInfoModal();
});

document.getElementById('btn-coach-info-show-3d')?.addEventListener('click', async () => {
  closeModal('modal-coach-info');
  if (!learningEnabled) setLearningEnabled(true);
  if (!isHumanTurn()) return;
  if (!currentLearningAnalysis) {
    await refreshLearningAdvice();
  }
  if (currentLearningAnalysis?.bestMove) {
    show3DHintArrow(currentLearningAnalysis.bestMove);
  }
});

// --- Tutoriel Interactif (surbrillance HUD + guide dans le panneau Apprentissage) ---
let tutorialActive = false;
let tutorialStepIndex = 0;
let tutorialWaitingForAi = false;
let tutorialCompleted = false;

const tutorialSpotlightEl = document.getElementById('tutorial-spotlight');
const tutorialBoxEl = document.getElementById('learning-tutorial-box');
const tutorialBadgeEl = document.getElementById('tutorial-step-badge');
const tutorialTitleEl = document.getElementById('tutorial-step-title');
const tutorialDescEl = document.getElementById('tutorial-step-desc');
const tutorialHintEl = document.getElementById('tutorial-step-hint');
const tutorialActionsEl = document.getElementById('tutorial-step-actions');
const btnTutorialNext = document.getElementById('btn-tutorial-next');
const btnTutorialExit = document.getElementById('btn-tutorial-exit');

function hideTutorialSpotlight() {
  tutorialSpotlightEl?.classList.add('hidden');
}

function updateTutorialSpotlight() {
  if (!tutorialSpotlightEl) return;
  if (!tutorialActive || tutorialCompleted || tutorialWaitingForAi) {
    hideTutorialSpotlight();
    return;
  }
  const step = TUTORIAL_STEPS[tutorialStepIndex];
  if (!step || !step.selector) {
    hideTutorialSpotlight();
    return;
  }
  let target = document.querySelector(step.selector);
  let rect = target ? target.getBoundingClientRect() : null;
  if ((!rect || rect.width <= 0 || rect.height <= 0) && step.fallbackSelector) {
    target = document.querySelector(step.fallbackSelector);
    rect = target ? target.getBoundingClientRect() : null;
  }
  if (!target || !rect || rect.width <= 0 || rect.height <= 0) {
    hideTutorialSpotlight();
    return;
  }

  const pad = step.padding ?? 8;
  const left = Math.max(4, rect.left - pad);
  const top = Math.max(4, rect.top - pad);
  const width = Math.min(window.innerWidth - left - 4, rect.width + pad * 2);
  const height = Math.min(window.innerHeight - top - 4, rect.height + pad * 2);

  tutorialSpotlightEl.style.left = `${Math.round(left)}px`;
  tutorialSpotlightEl.style.top = `${Math.round(top)}px`;
  tutorialSpotlightEl.style.width = `${Math.round(width)}px`;
  tutorialSpotlightEl.style.height = `${Math.round(height)}px`;
  tutorialSpotlightEl.classList.remove('hidden');
}

function showTutorialHintArrowForStep(step) {
  if (!step || step.kind !== 'move') return;
  if (step.preferredMove) {
    const { fromRow, fromCol, toRow, toCol } = step.preferredMove;
    const legals = engine.getLegalMovesForSquare(fromRow, fromCol);
    const preferred = legals.find((m) => m.toRow === toRow && m.toCol === toCol);
    if (preferred) {
      show3DHintArrow(preferred);
      return;
    }
  }
  if (currentLearningAnalysis?.bestMove) {
    show3DHintArrow(currentLearningAnalysis.bestMove);
  }
}

function renderTutorialStep() {
  if (!tutorialBoxEl) return;
  if (!tutorialActive) {
    tutorialBoxEl.classList.add('hidden');
    hideTutorialSpotlight();
    return;
  }

  tutorialBoxEl.classList.remove('hidden');

  if (tutorialCompleted) {
    if (tutorialBadgeEl) tutorialBadgeEl.textContent = TUTORIAL_COMPLETED_STATE.badge;
    if (tutorialTitleEl) tutorialTitleEl.textContent = TUTORIAL_COMPLETED_STATE.title;
    if (tutorialDescEl) tutorialDescEl.textContent = TUTORIAL_COMPLETED_STATE.desc;
    if (tutorialHintEl) {
      tutorialHintEl.textContent = TUTORIAL_COMPLETED_STATE.hint;
      tutorialHintEl.classList.remove('hidden');
    }
    if (btnTutorialNext) btnTutorialNext.textContent = 'Continuer la partie';
    tutorialActionsEl?.classList.remove('hidden');
    btnTutorialExit?.classList.add('hidden');
    hideTutorialSpotlight();
    return;
  }

  btnTutorialExit?.classList.remove('hidden');
  const step = TUTORIAL_STEPS[tutorialStepIndex];
  if (!step) return;

  if (tutorialWaitingForAi) {
    if (tutorialBadgeEl) tutorialBadgeEl.textContent = step.badge;
    if (tutorialTitleEl) tutorialTitleEl.textContent = 'Riposte de l’adversaire...';
    if (tutorialDescEl) {
      tutorialDescEl.textContent =
        'Bien joué ! Observez le coup de réponse de l’adversaire sur le plateau 3D avant l’étape suivante.';
    }
    tutorialHintEl?.classList.add('hidden');
    tutorialActionsEl?.classList.add('hidden');
    hideTutorialSpotlight();
    return;
  }

  if (tutorialBadgeEl) tutorialBadgeEl.textContent = step.badge;
  if (tutorialTitleEl) tutorialTitleEl.textContent = step.title;
  if (tutorialDescEl) tutorialDescEl.textContent = step.desc;
  if (tutorialHintEl) {
    if (step.hint) {
      tutorialHintEl.textContent = step.hint;
      tutorialHintEl.classList.remove('hidden');
    } else {
      tutorialHintEl.classList.add('hidden');
    }
  }

  if (step.kind === 'highlight') {
    if (btnTutorialNext) btnTutorialNext.textContent = 'Suivant';
    tutorialActionsEl?.classList.remove('hidden');
    clear3DHintArrow();
    window.requestAnimationFrame(updateTutorialSpotlight);
  } else {
    tutorialActionsEl?.classList.add('hidden');
    hideTutorialSpotlight();
    showTutorialHintArrowForStep(step);
  }
}

function onTutorialHumanMovePlayed() {
  const step = TUTORIAL_STEPS[tutorialStepIndex];
  if (!step || step.kind !== 'move') return;

  if (
    engine.status === 'checkmate' ||
    engine.status === 'stalemate' ||
    engine.status === 'draw' ||
    tutorialStepIndex >= TUTORIAL_STEPS.length - 1
  ) {
    tutorialCompleted = true;
    tutorialWaitingForAi = false;
    renderTutorialStep();
    return;
  }

  tutorialStepIndex += 1;
  if (isVsAIMode() && engine.turn !== gameConfig.playerColor) {
    tutorialWaitingForAi = true;
  }
  renderTutorialStep();
}

function stopInteractiveTutorial() {
  tutorialActive = false;
  tutorialWaitingForAi = false;
  tutorialCompleted = false;
  learningPanelEl?.classList.remove('is-tutorial-active');
  tutorialBoxEl?.classList.add('hidden');
  hideTutorialSpotlight();
}

function startInteractiveTutorial() {
  gameConfig.mode = 'learning';
  gameConfig.aiLevel = 1;
  gameConfig.playerColor = COLORS.WHITE;

  aiSessionToken++;
  isAiThinking = false;
  pendingPromotion = null;
  pendingCaptureQuiz = null;
  closeModal('modal-capture-quiz');
  beginNewQuizGameSession();
  quizStats = createEmptyQuizStats();
  selectedSquare = null;
  legalMovesForSelected = [];
  clear3DHintArrow();
  clearLearningFeedback();
  updatePieceTipUI(null);

  engine.reset();
  syncMeshesFromEngineImmediate();
  setCameraPreset('iso', false);

  tutorialActive = true;
  tutorialStepIndex = 0;
  tutorialWaitingForAi = false;
  tutorialCompleted = false;

  closeModal('modal-new-game');
  if (isSmartphoneViewport()) {
    enterMobileLearningMode();
  }
  setLearningEnabled(true);
  updateHUD();
  renderTutorialStep();
  refreshLearningAdvice();
}

btnTutorialNext?.addEventListener('click', () => {
  if (!tutorialActive) return;
  if (tutorialCompleted) {
    stopInteractiveTutorial();
    return;
  }
  if (tutorialStepIndex < TUTORIAL_STEPS.length - 1) {
    tutorialStepIndex += 1;
    renderTutorialStep();
  } else {
    tutorialCompleted = true;
    renderTutorialStep();
  }
});

btnTutorialExit?.addEventListener('click', () => {
  stopInteractiveTutorial();
});

document.getElementById('btn-start-tutorial')?.addEventListener('click', () => {
  startInteractiveTutorial();
});

// Déplacement libre du panneau d'apprentissage à la souris / au doigt sur smartphone
const learningHeaderEl = document.getElementById('learning-panel-header');
if (learningPanelEl && learningHeaderEl) {
  let dragState = null;

  const clampPanelToViewport = (left, top) => {
    const rect = learningPanelEl.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    return {
      left: Math.min(maxLeft, Math.max(8, left)),
      top: Math.min(maxTop, Math.max(8, top)),
    };
  };

  const startPanelDrag = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target instanceof Element) {
      if (e.target.closest('button, a, input, select, textarea')) return;
      if (
        tutorialActive &&
        e.target.closest('.learning-body') &&
        !e.target.closest('.learning-header')
      ) {
        return;
      }
      if (!isSmartphoneViewport() && !e.target.closest('.learning-header')) {
        return;
      }
    }

    const rect = learningPanelEl.getBoundingClientRect();
    learningPanelEl.classList.add('is-positioned', 'is-dragging');
    learningPanelEl.style.left = `${rect.left}px`;
    learningPanelEl.style.top = `${rect.top}px`;
    learningPanelEl.style.right = 'auto';
    learningPanelEl.style.bottom = 'auto';

    dragState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
    };
    learningPanelEl.setPointerCapture?.(e.pointerId);
    e.stopPropagation();
    e.preventDefault();
  };

  learningPanelEl.addEventListener('pointerdown', startPanelDrag);

  learningPanelEl.addEventListener('pointermove', (e) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const rawLeft = dragState.originLeft + (e.clientX - dragState.startX);
    const rawTop = dragState.originTop + (e.clientY - dragState.startY);
    const clamped = clampPanelToViewport(rawLeft, rawTop);
    learningPanelEl.style.left = `${Math.round(clamped.left)}px`;
    learningPanelEl.style.top = `${Math.round(clamped.top)}px`;
  });

  const endPanelDrag = (e) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    dragState = null;
    learningPanelEl.classList.remove('is-dragging');
  };

  learningPanelEl.addEventListener('pointerup', endPanelDrag);
  learningPanelEl.addEventListener('pointercancel', endPanelDrag);

  window.addEventListener('resize', () => {
    syncLearningPanelLayout();
    if (!learningPanelEl.classList.contains('is-positioned')) return;
    if (learningPanelEl.classList.contains('hidden')) return;
    const rect = learningPanelEl.getBoundingClientRect();
    const clamped = clampPanelToViewport(rect.left, rect.top);
    learningPanelEl.style.left = `${Math.round(clamped.left)}px`;
    learningPanelEl.style.top = `${Math.round(clamped.top)}px`;
  });
}

// --- Commande vocale (Web Speech API) ---
const btnVoice = document.getElementById('btn-voice');
const voiceStatusBarEl = document.getElementById('voice-status-bar');
const voiceStatusTextEl = document.getElementById('voice-status-text');
let voiceResetTimer = 0;

function showVoiceStatus(text, isError = false, autoResetMs = 0) {
  window.clearTimeout(voiceResetTimer);
  if (!voiceStatusBarEl || !voiceStatusTextEl) return;
  voiceStatusTextEl.textContent = text;
  voiceStatusBarEl.classList.toggle('is-error', isError);
  voiceStatusBarEl.classList.remove('hidden');

  if (autoResetMs > 0) {
    voiceResetTimer = window.setTimeout(() => {
      if (voiceController.isActive) {
        voiceStatusBarEl.classList.remove('is-error');
        voiceStatusTextEl.textContent = 'Micro actif — Dites par ex. « C1 vers C3 »';
      } else {
        voiceStatusBarEl.classList.add('hidden');
      }
    }, autoResetMs);
  }
}

function handleVoiceCommand(cmd, transcript) {
  const anyOpenModal = document.querySelector('.modal-backdrop:not(.hidden)');
  if (anyOpenModal || !isHumanTurn()) {
    showVoiceStatus('Patientez : ce n’est pas votre tour ou une fenêtre est ouverte.', true, 2600);
    return;
  }

  if (!cmd) {
    showVoiceStatus(
      `Non compris : « ${transcript} ». Dites par ex. « C1 vers C3 ».`,
      true,
      3200
    );
    return;
  }

  if (cmd.type === 'castle') {
    const kingPos = engine.findKing(engine.turn);
    if (!kingPos) return;
    const legalMoves = engine.getLegalMovesForSquare(kingPos.row, kingPos.col);
    const targetFlag = cmd.side === 'k' ? 'K' : 'Q';
    const castleMove = legalMoves.find((m) => m.isCastle === targetFlag);
    if (!castleMove) {
      const label = cmd.side === 'k' ? 'Petit roque' : 'Grand roque';
      showVoiceStatus(`${label} impossible dans cette position.`, true, 3000);
      return;
    }
    selectedSquare = null;
    legalMovesForSelected = [];
    executeMoveVisualAndEngine(castleMove);
    showVoiceStatus(
      `✓ « ${cmd.side === 'k' ? 'Petit roque' : 'Grand roque'} » exécuté.`,
      false,
      2600
    );
    return;
  }

  const fromLabel = cmd.from.alg.toUpperCase();
  const toLabel = cmd.to.alg.toUpperCase();
  const piece = engine.getPiece(cmd.from.row, cmd.from.col);

  if (!piece || piece.color !== engine.turn) {
    showVoiceStatus(`Aucune pièce alliée sur ${fromLabel}.`, true, 2800);
    return;
  }

  const legalMoves = engine.getLegalMovesForSquare(cmd.from.row, cmd.from.col);
  const matching = legalMoves.filter(
    (m) => m.toRow === cmd.to.row && m.toCol === cmd.to.col
  );

  if (matching.length === 0) {
    showVoiceStatus(`Coup illégal : ${fromLabel} vers ${toLabel}.`, true, 3000);
    return;
  }

  let chosenMove = matching[0];
  if (matching.some((m) => m.promotion)) {
    const desiredPromo = cmd.promotion || 'q';
    chosenMove = matching.find((m) => m.promotion === desiredPromo) || matching[0];
  }

  selectedSquare = null;
  legalMovesForSelected = [];
  executeMoveVisualAndEngine(chosenMove);
  showVoiceStatus(`✓ « ${fromLabel} vers ${toLabel} » exécuté.`, false, 2600);
}

const voiceController = new VoiceChessController({
  onStateChange(active) {
    window.clearTimeout(voiceResetTimer);
    if (btnVoice) {
      btnVoice.classList.toggle('is-listening', active);
      btnVoice.setAttribute('aria-pressed', String(active));
    }
    if (!voiceStatusBarEl || !voiceStatusTextEl) return;
    if (active) {
      voiceStatusBarEl.classList.remove('is-error', 'hidden');
      voiceStatusTextEl.textContent = 'Micro actif — Dites par ex. « C1 vers C3 »';
    } else {
      voiceStatusBarEl.classList.add('hidden');
      voiceStatusBarEl.classList.remove('is-error');
    }
  },
  onInterim(text) {
    showVoiceStatus(`🎙 « ${text} »`, false, 0);
  },
  onCommand(cmd, transcript) {
    handleVoiceCommand(cmd, transcript);
  },
  onError(message) {
    showVoiceStatus(message, true, voiceController.isActive ? 3500 : 4500);
  },
});

btnVoice?.addEventListener('click', () => {
  voiceController.toggle();
});

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => {
    closeModal(btn.dataset.closeModal);
  });
});

document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
  backdrop.addEventListener('click', (e) => {
    if (
      e.target === backdrop &&
      backdrop.id !== 'modal-promotion' &&
      backdrop.id !== 'modal-capture-quiz'
    ) {
      closeModal(backdrop.id);
    }
  });
});

// --- Bouton vision caméra (menu horizontal du bas) ---
btnCameraStyle?.addEventListener('click', () => {
  cycleCameraPreset({ showToast: isSmartphoneViewport() });
});

// --- Bouton Plein écran (API Fullscreen native) ---
const btnFullscreen = document.getElementById('btn-fullscreen');
const fullscreenLabelEl = document.getElementById('fullscreen-label');
const fullscreenIconEnterEl = document.getElementById('fullscreen-icon-enter');
const fullscreenIconExitEl = document.getElementById('fullscreen-icon-exit');

function getFullscreenElement() {
  const doc = /** @type {any} */ (document);
  return document.fullscreenElement || doc.webkitFullscreenElement || null;
}

function isFullscreenSupported() {
  const doc = /** @type {any} */ (document);
  const root = /** @type {any} */ (document.documentElement);
  return Boolean(
    document.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      root.requestFullscreen ||
      root.webkitRequestFullscreen
  );
}

function syncFullscreenUI() {
  const isFull = Boolean(getFullscreenElement());
  if (btnFullscreen) {
    btnFullscreen.classList.toggle('is-active', isFull);
    btnFullscreen.setAttribute('aria-pressed', String(isFull));
    btnFullscreen.title = isFull
      ? 'Quitter le mode plein écran'
      : 'Basculer en mode plein écran';
  }
  if (fullscreenLabelEl) {
    fullscreenLabelEl.textContent = isFull ? 'Réduire' : 'Plein écran';
  }
  fullscreenIconEnterEl?.classList.toggle('hidden', isFull);
  fullscreenIconExitEl?.classList.toggle('hidden', !isFull);
}

if (btnFullscreen && !isFullscreenSupported()) {
  btnFullscreen.classList.add('hidden');
}

btnFullscreen?.addEventListener('click', async () => {
  try {
    if (!getFullscreenElement()) {
      const root = /** @type {any} */ (document.documentElement);
      if (root.requestFullscreen) {
        await root.requestFullscreen();
      } else if (root.webkitRequestFullscreen) {
        root.webkitRequestFullscreen();
      }
    } else {
      const doc = /** @type {any} */ (document);
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
    }
  } catch (_) {
    // Ignorer silencieusement si le navigateur refuse le plein écran (ex. restriction iframe)
  } finally {
    syncFullscreenUI();
  }
});

function handleFullscreenChange() {
  syncFullscreenUI();
  window.requestAnimationFrame(() => {
    if (renderer) {
      camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    }
    setCameraPreset(activeCameraPreset, false);
  });
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
syncFullscreenUI();

// --- Bouton Masquer / Afficher les menus ---
const hudLayerEl = document.querySelector('.hud-layer');
const btnToggleMenus = document.getElementById('btn-toggle-menus');
const toggleMenusLabelEl = document.getElementById('toggle-menus-label');
const menusIconHideEl = document.getElementById('menus-icon-hide');
const menusIconShowEl = document.getElementById('menus-icon-show');
let menusHidden = false;

function setMenusHidden(hidden) {
  menusHidden = Boolean(hidden);
  hudLayerEl?.classList.toggle('is-menus-hidden', menusHidden);
  if (btnToggleMenus) {
    btnToggleMenus.setAttribute('aria-pressed', String(menusHidden));
    btnToggleMenus.title = menusHidden
      ? 'Faire réapparaître les menus'
      : 'Masquer les menus pour dégager le plateau';
  }
  if (toggleMenusLabelEl) {
    toggleMenusLabelEl.textContent = menusHidden ? 'Afficher menus' : 'Masquer menus';
  }
  menusIconHideEl?.classList.toggle('hidden', menusHidden);
  menusIconShowEl?.classList.toggle('hidden', !menusHidden);
  if (getFullscreenElement() || isSmartphoneViewport()) {
    setCameraPreset(activeCameraPreset, false);
  }
  syncLearningPanelLayout();
}

btnToggleMenus?.addEventListener('click', () => {
  autoHidMenusForLearning = false;
  setMenusHidden(!menusHidden);
});

// --- Bouton Annuler ---
btnUndo.addEventListener('click', () => {
  if (isAiThinking || pendingPromotion || pendingCaptureQuiz) return;
  if (isVsAIMode()) {
    if (engine.turn === gameConfig.playerColor && engine.moveHistory.length >= 2) {
      engine.undo();
      engine.undo();
    } else if (engine.moveHistory.length >= 1) {
      engine.undo();
    }
  } else {
    engine.undo();
  }
  selectedSquare = null;
  legalMovesForSelected = [];
  clear3DHintArrow();
  clearLearningFeedback();
  updatePieceTipUI(null);
  syncMeshesFromEngineImmediate();
  updateHUD();
  if (!tutorialActive) {
    persistAutoSaveIfNeeded();
  }
  refreshLearningAdvice();
});

// --- Modale Chroniques de la Bataille ---
function renderHistoryModal() {
  const emptyEl = document.getElementById('history-empty');
  const wrapEl = document.getElementById('history-table-wrap');
  const tbody = document.getElementById('history-tbody');

  if (engine.moveHistory.length === 0) {
    emptyEl.classList.remove('hidden');
    wrapEl.classList.add('hidden');
    tbody.innerHTML = '';
    return;
  }

  emptyEl.classList.add('hidden');
  wrapEl.classList.remove('hidden');
  tbody.innerHTML = '';

  const pairs = [];
  for (let i = 0; i < engine.moveHistory.length; i += 2) {
    pairs.push({
      num: Math.floor(i / 2) + 1,
      white: engine.moveHistory[i]?.san || '',
      black: engine.moveHistory[i + 1]?.san || '',
    });
  }

  pairs.forEach((row, idx) => {
    const tr = document.createElement('tr');
    if (idx === pairs.length - 1) tr.classList.add('is-latest-row');
    tr.innerHTML = `<td>${row.num}.</td><td>${row.white}</td><td>${row.black}</td>`;
    tbody.appendChild(tr);
  });

  wrapEl.scrollTop = wrapEl.scrollHeight;
}

document.getElementById('btn-history').addEventListener('click', () => {
  renderHistoryModal();
  openModal('modal-history');
});

// --- Modale Promotion Impériale ---
document.querySelectorAll('.promo-choice').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!pendingPromotion) return;
    const move = {
      ...pendingPromotion,
      promotion: btn.dataset.promo,
    };
    pendingPromotion = null;
    closeModal('modal-promotion');
    executeMoveVisualAndEngine(move);
  });
});

// --- Défi de Rachat par Question (lorsqu'une pièce est capturée) ---
const quizModalKickerEl = document.getElementById('quiz-modal-kicker');
const quizVictimSwatchEl = document.getElementById('quiz-victim-swatch');
const quizPieceTitleEl = document.getElementById('quiz-piece-title');
const quizPieceSubEl = document.getElementById('quiz-piece-sub');
const quizStepThemeEl = document.getElementById('quiz-step-theme');
const quizThemeGridEl = document.getElementById('quiz-theme-grid');
const quizStepQuestionEl = document.getElementById('quiz-step-question');
const quizActiveThemeBadgeEl = document.getElementById('quiz-active-theme-badge');
const btnQuizChangeTheme = document.getElementById('btn-quiz-change-theme');
const quizQuestionTextEl = document.getElementById('quiz-question-text');
const quizChoicesListEl = document.getElementById('quiz-choices-list');
const quizAnswerFeedbackEl = document.getElementById('quiz-answer-feedback');
const quizFeedbackTitleEl = document.getElementById('quiz-feedback-title');
const quizFeedbackExplanationEl = document.getElementById('quiz-feedback-explanation');
const btnQuizForfeit = document.getElementById('btn-quiz-forfeit');
const btnQuizContinue = document.getElementById('btn-quiz-continue');

function shouldTriggerCaptureQuiz(record) {
  if (!gameConfig.quizEnabled || tutorialActive) return false;
  if (!record || !record.capturedPiece) return false;
  if (isVsAIMode() && record.capturedPiece.color !== gameConfig.playerColor) return false;
  return true;
}

function renderQuizThemeGrid() {
  if (!quizThemeGridEl) return;
  quizThemeGridEl.replaceChildren();
  for (const theme of QUIZ_THEMES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quiz-theme-btn';

    const head = document.createElement('span');
    head.className = 'quiz-theme-head';
    head.textContent = `${theme.icon} ${theme.label}`;

    const desc = document.createElement('span');
    desc.className = 'quiz-theme-desc';
    desc.textContent = theme.desc;

    btn.append(head, desc);
    btn.addEventListener('click', () => {
      startQuizQuestionForTheme(theme.id);
    });
    quizThemeGridEl.appendChild(btn);
  }
}

function openCaptureQuizModal() {
  if (!pendingCaptureQuiz) return;
  const { record, victimColor } = pendingCaptureQuiz;
  const pieceType = record.capturedPiece?.type || 'p';
  const pieceName = PIECE_SHORT_NAMES[pieceType] || 'Pièce';
  const pts = PIECE_POINTS[pieceType] ?? 1;
  const sideLabel = victimColor === COLORS.WHITE ? 'Blancs (Marbre)' : 'Noirs (Bronze)';

  if (quizModalKickerEl) {
    quizModalKickerEl.textContent = `Défi de Rachat · ${sideLabel}`;
  }
  if (quizVictimSwatchEl) {
    quizVictimSwatchEl.className = `material-swatch ${
      victimColor === COLORS.WHITE ? 'swatch-white' : 'swatch-black'
    }`;
  }
  if (quizPieceTitleEl) {
    const sqAlg = record.capturedPos
      ? squareToAlgebraic(record.capturedPos.row, record.capturedPos.col).toUpperCase()
      : '';
    quizPieceTitleEl.textContent = `Votre ${pieceName}${sqAlg ? ` (${sqAlg})` : ''} vient d'être capturé — ${pts} pt${pts > 1 ? 's' : ''}`;
  }
  if (quizPieceSubEl) {
    quizPieceSubEl.textContent =
      'Répondez juste pour que votre pièce vous soit rendue et repousser l’adversaire.';
  }

  quizStepThemeEl?.classList.remove('hidden');
  quizStepQuestionEl?.classList.add('hidden');
  quizAnswerFeedbackEl?.classList.add('hidden');
  quizAnswerFeedbackEl?.classList.remove('is-success', 'is-error');
  btnQuizContinue?.classList.add('hidden');
  btnQuizForfeit?.classList.remove('hidden');

  renderQuizThemeGrid();
  openModal('modal-capture-quiz');
}

function startQuizQuestionForTheme(themeId) {
  if (!pendingCaptureQuiz) return;
  const question = pickQuizQuestion(themeId, usedQuizQuestionIds);
  pendingCaptureQuiz.currentQuestion = question;
  pendingCaptureQuiz.answered = false;
  pendingCaptureQuiz.wasCorrect = false;

  const chosenMeta = getThemeMeta(themeId);
  const actualMeta = getThemeMeta(question.theme);
  if (quizActiveThemeBadgeEl) {
    quizActiveThemeBadgeEl.textContent =
      themeId === 'aleatoire'
        ? `${chosenMeta.icon} Aléatoire · ${actualMeta.label}`
        : `${actualMeta.icon} ${actualMeta.label}`;
  }

  quizStepThemeEl?.classList.add('hidden');
  quizStepQuestionEl?.classList.remove('hidden');
  btnQuizChangeTheme?.classList.remove('hidden');
  quizAnswerFeedbackEl?.classList.add('hidden');
  quizAnswerFeedbackEl?.classList.remove('is-success', 'is-error');
  btnQuizContinue?.classList.add('hidden');
  btnQuizForfeit?.classList.remove('hidden');

  if (quizQuestionTextEl) {
    quizQuestionTextEl.textContent = question.question;
  }

  if (quizChoicesListEl) {
    quizChoicesListEl.replaceChildren();
    const letters = ['A', 'B', 'C', 'D'];
    question.choices.forEach((choiceText, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-choice-btn';
      btn.dataset.choiceIndex = String(idx);

      const letterEl = document.createElement('span');
      letterEl.className = 'quiz-choice-letter';
      letterEl.textContent = letters[idx] || String(idx + 1);

      const textEl = document.createElement('span');
      textEl.textContent = choiceText;

      btn.append(letterEl, textEl);
      btn.addEventListener('click', () => handleQuizAnswerSelected(idx));
      quizChoicesListEl.appendChild(btn);
    });
  }
}

function handleQuizAnswerSelected(selectedIdx) {
  if (!pendingCaptureQuiz || pendingCaptureQuiz.answered || !pendingCaptureQuiz.currentQuestion) {
    return;
  }
  const q = pendingCaptureQuiz.currentQuestion;
  const isCorrect = selectedIdx === q.answerIndex;
  pendingCaptureQuiz.answered = true;
  pendingCaptureQuiz.wasCorrect = isCorrect;

  const sideStats = quizStats[pendingCaptureQuiz.victimColor];
  if (sideStats) {
    sideStats.asked += 1;
    if (isCorrect) sideStats.correct += 1;
    else sideStats.wrong += 1;
  }

  quizChoicesListEl?.querySelectorAll('.quiz-choice-btn').forEach((el) => {
    const btn = /** @type {HTMLButtonElement} */ (el);
    btn.disabled = true;
    const idx = Number(btn.dataset.choiceIndex);
    if (idx === q.answerIndex) {
      btn.classList.add('is-correct');
    } else if (idx === selectedIdx && !isCorrect) {
      btn.classList.add('is-wrong');
    }
  });

  btnQuizChangeTheme?.classList.add('hidden');
  btnQuizForfeit?.classList.add('hidden');

  const pieceName = PIECE_SHORT_NAMES[pendingCaptureQuiz.record.capturedPiece?.type || 'p'] || 'Pièce';

  if (quizAnswerFeedbackEl && quizFeedbackTitleEl && quizFeedbackExplanationEl) {
    quizAnswerFeedbackEl.classList.remove('hidden', 'is-success', 'is-error');
    quizAnswerFeedbackEl.classList.add(isCorrect ? 'is-success' : 'is-error');
    quizFeedbackTitleEl.textContent = isCorrect
      ? `Bonne réponse ! Votre ${pieceName} vous est rendu !`
      : `Mauvaise réponse ! Votre ${pieceName} reste perdu.`;
    quizFeedbackExplanationEl.textContent = q.explanation || '';
  }

  if (btnQuizContinue) {
    btnQuizContinue.textContent = isCorrect ? 'Reprendre ma pièce' : 'Continuer la partie';
    btnQuizContinue.classList.remove('hidden');
  }

  if (isCorrect) {
    audio.playMove(true);
  }
}

function finalizeCaptureQuiz() {
  if (!pendingCaptureQuiz) return;
  const quiz = pendingCaptureQuiz;
  pendingCaptureQuiz = null;
  closeModal('modal-capture-quiz');

  if (quiz.wasCorrect) {
    const redeemed = engine.redeemLastCapture();
    if (redeemed && quiz.record.capturedPiece) {
      const sideStats = quizStats[quiz.victimColor];
      if (sideStats) {
        sideStats.recoveredPieces.push(quiz.record.capturedPiece.type);
      }
      syncMeshesFromEngineImmediate();
      updateHUD();
    }
  }

  if (!tutorialActive) {
    persistAutoSaveIfNeeded();
  }

  if (engine.status === 'checkmate' || engine.status === 'stalemate' || engine.status === 'draw') {
    refreshLearningAdvice();
    window.setTimeout(() => showGameOverModal(), 420);
    return;
  }

  if (isVsAIMode() && engine.turn !== gameConfig.playerColor) {
    maybeTriggerAIMove();
  } else {
    refreshLearningAdvice();
  }
}

btnQuizChangeTheme?.addEventListener('click', () => {
  if (!pendingCaptureQuiz || pendingCaptureQuiz.answered) return;
  quizStepQuestionEl?.classList.add('hidden');
  quizStepThemeEl?.classList.remove('hidden');
});

btnQuizForfeit?.addEventListener('click', () => {
  if (!pendingCaptureQuiz) return;
  const sideStats = quizStats[pendingCaptureQuiz.victimColor];
  if (sideStats && !pendingCaptureQuiz.answered) {
    sideStats.skipped += 1;
  }
  pendingCaptureQuiz.answered = true;
  pendingCaptureQuiz.wasCorrect = false;
  finalizeCaptureQuiz();
});

btnQuizContinue?.addEventListener('click', () => {
  finalizeCaptureQuiz();
});

// --- Modale Fin de Partie ---
function computePieceListPoints(types) {
  if (!Array.isArray(types)) return 0;
  return types.reduce((sum, t) => sum + (PIECE_POINTS[t] || 0), 0);
}

function renderGameOverQuizSummary() {
  const grid = document.getElementById('gameover-players-grid');
  if (!grid) return;
  grid.replaceChildren();

  const sides = [
    {
      color: COLORS.WHITE,
      name: 'Blancs (Marbre)',
      captured: engine.capturedByWhite,
      swatchClass: 'swatch-white',
    },
    {
      color: COLORS.BLACK,
      name: 'Noirs (Bronze)',
      captured: engine.capturedByBlack,
      swatchClass: 'swatch-black',
    },
  ];

  for (const side of sides) {
    const stats = quizStats[side.color] || { asked: 0, correct: 0, wrong: 0, skipped: 0, recoveredPieces: [] };
    const isAiSide = isVsAIMode() && side.color !== gameConfig.playerColor;
    const roleTag = isVsAIMode()
      ? isAiSide
        ? ' · IA'
        : ' · Vous'
      : side.color === COLORS.WHITE
      ? ' · J1'
      : ' · J2';

    const capPts = computePieceListPoints(side.captured);
    const recPts = computePieceListPoints(stats.recoveredPieces);
    const accuracyPct = stats.asked > 0 ? Math.round((stats.correct / stats.asked) * 100) : null;

    const card = document.createElement('div');
    card.className = 'gameover-player-card';

    const head = document.createElement('div');
    head.className = 'gameover-player-head';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'gameover-player-title';
    const swatch = document.createElement('span');
    swatch.className = `material-swatch ${side.swatchClass}`;
    swatch.setAttribute('aria-hidden', 'true');
    const nameTxt = document.createElement('span');
    nameTxt.textContent = `${side.name}${roleTag}`;
    titleSpan.append(swatch, nameTxt);

    const accBadge = document.createElement('span');
    accBadge.className = 'gameover-accuracy-badge';
    accBadge.textContent = isAiSide
      ? 'IA'
      : accuracyPct !== null
      ? `${accuracyPct} % justes`
      : '— %';

    head.append(titleSpan, accBadge);

    const rowCaptured = document.createElement('div');
    rowCaptured.className = 'gameover-player-row';
    const lblCap = document.createElement('span');
    lblCap.className = 'gameover-player-label';
    lblCap.textContent = 'Gains en éléments capturés';
    const valCap = document.createElement('span');
    valCap.className = 'gameover-player-value';
    valCap.textContent =
      side.captured.length > 0
        ? `${formatCapturedSummary(side.captured)} (+${capPts} pt${capPts > 1 ? 's' : ''})`
        : 'Aucun élément capturé (0 pt)';
    rowCaptured.append(lblCap, valCap);

    const rowRecovered = document.createElement('div');
    rowRecovered.className = 'gameover-player-row';
    const lblRec = document.createElement('span');
    lblRec.className = 'gameover-player-label';
    lblRec.textContent = 'Éléments récupérés (Quiz)';
    const valRec = document.createElement('span');
    valRec.className = 'gameover-player-value';
    if (isAiSide) {
      valRec.textContent = 'Non concerné (Ordinateur)';
    } else {
      valRec.textContent =
        stats.recoveredPieces.length > 0
          ? `${formatCapturedSummary(stats.recoveredPieces)} (+${recPts} pt${recPts > 1 ? 's' : ''} sauvé${recPts > 1 ? 's' : ''})`
          : 'Aucun élément récupéré';
    }
    rowRecovered.append(lblRec, valRec);

    const rowQuiz = document.createElement('div');
    rowQuiz.className = 'gameover-player-row';
    const lblQuiz = document.createElement('span');
    lblQuiz.className = 'gameover-player-label';
    lblQuiz.textContent = 'Bilan des réponses';
    const valQuiz = document.createElement('span');
    valQuiz.className = 'gameover-player-value';
    if (isAiSide) {
      valQuiz.textContent = 'L’IA ne répond pas aux questions';
    } else if (stats.asked === 0) {
      valQuiz.textContent = stats.skipped > 0
        ? `0 question tentée (${stats.skipped} abandonnée${stats.skipped > 1 ? 's' : ''})`
        : 'Aucune question posée durant la partie';
    } else {
      valQuiz.textContent = `${stats.correct} bonne${stats.correct > 1 ? 's' : ''} réponse${stats.correct > 1 ? 's' : ''} sur ${stats.asked} (${accuracyPct} % de réussite)`;
    }
    rowQuiz.append(lblQuiz, valQuiz);

    card.append(head, rowCaptured, rowRecovered, rowQuiz);
    grid.appendChild(card);
  }
}

function showGameOverModal() {
  const kicker = document.getElementById('gameover-kicker');
  const title = document.getElementById('title-gameover');
  const desc = document.getElementById('gameover-desc');

  if (engine.status === 'checkmate') {
    const winName =
      engine.winner === COLORS.WHITE
        ? 'Les Blancs (Marbre de Carrare)'
        : 'Les Noirs (Bronze Patiné)';
    kicker.textContent = 'Échec et Mat';
    title.textContent = 'Victoire Impériale';
    desc.textContent = `${winName} remportent la victoire suprême sur le plateau de mosaïque.`;
  } else {
    kicker.textContent = 'Égalité';
    title.textContent = 'Partie Nulle';
    desc.textContent = engine.drawReason || 'Pat — Aucun camp ne peut forcer la victoire.';
  }

  document.getElementById('gameover-moves').textContent = String(
    Math.ceil(engine.moveHistory.length / 2)
  );
  document.getElementById('gameover-white-lost').textContent = String(
    engine.capturedByBlack.length
  );
  document.getElementById('gameover-black-lost').textContent = String(
    engine.capturedByWhite.length
  );

  renderGameOverQuizSummary();

  if (authToken && isVsAIMode()) {
    const result =
      engine.status === 'checkmate'
        ? engine.winner === gameConfig.playerColor
          ? 'win'
          : 'loss'
        : 'draw';
    recordMatchResult(result);
  }

  openModal('modal-gameover');
}

document.getElementById('btn-gameover-new').addEventListener('click', () => {
  closeModal('modal-gameover');
  openNewGameModal();
});

// --- Modale Nouvelle Campagne ---
let draftConfig = { ...gameConfig };

function syncNewGameModalUI() {
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.classList.toggle('is-selected', btn.dataset.mode === draftConfig.mode);
  });
  document.querySelectorAll('[data-level]').forEach((btn) => {
    btn.classList.toggle('is-selected', Number(btn.dataset.level) === draftConfig.aiLevel);
  });
  document.querySelectorAll('[data-side]').forEach((btn) => {
    btn.classList.toggle('is-selected', btn.dataset.side === draftConfig.playerColor);
  });
  document.querySelectorAll('[data-quiz-mode]').forEach((btn) => {
    const isOn = btn.dataset.quizMode === 'on';
    btn.classList.toggle('is-selected', isOn === Boolean(draftConfig.quizEnabled));
  });

  const isAi = isVsAIMode(draftConfig.mode);
  document.getElementById('ai-options-block').classList.toggle('hidden', !isAi);
  document.getElementById('side-options-block').classList.toggle('hidden', !isAi);
}

function openNewGameModal() {
  draftConfig = { ...gameConfig };
  syncNewGameModalUI();
  openModal('modal-new-game');
}

document.getElementById('btn-newgame-top').addEventListener('click', openNewGameModal);

document.getElementById('btn-quick-ai').addEventListener('click', () => {
  if (isVsAIMode()) return;
  gameConfig.mode = learningEnabled ? 'learning' : 'ai';
  // Si le joueur bascule vers l'IA pendant son tour, l'IA prend le camp adverse
  gameConfig.playerColor = engine.turn;
  setCameraPreset('iso', false);
  updateHUD();
  refreshLearningAdvice();
});

document.getElementById('btn-quick-pvp').addEventListener('click', () => {
  if (gameConfig.mode === 'pvp') return;
  aiSessionToken++;
  isAiThinking = false;
  gameConfig.mode = 'pvp';
  stopInteractiveTutorial();
  updateHUD();
  refreshLearningAdvice();
});

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    draftConfig.mode = btn.dataset.mode;
    if (draftConfig.mode === 'learning' && draftConfig.aiLevel === 3) {
      draftConfig.aiLevel = 1;
    }
    syncNewGameModalUI();
  });
});

document.querySelectorAll('[data-level]').forEach((btn) => {
  btn.addEventListener('click', () => {
    draftConfig.aiLevel = Number(btn.dataset.level);
    syncNewGameModalUI();
  });
});

document.querySelectorAll('[data-side]').forEach((btn) => {
  btn.addEventListener('click', () => {
    draftConfig.playerColor = btn.dataset.side;
    syncNewGameModalUI();
  });
});

document.querySelectorAll('[data-quiz-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    draftConfig.quizEnabled = btn.dataset.quizMode === 'on';
    syncNewGameModalUI();
  });
});

document.getElementById('btn-start-campaign').addEventListener('click', () => {
  stopInteractiveTutorial();
  gameConfig.mode = draftConfig.mode;
  gameConfig.aiLevel = draftConfig.aiLevel;
  gameConfig.playerColor = draftConfig.playerColor;
  gameConfig.quizEnabled = draftConfig.quizEnabled !== false;

  aiSessionToken++;
  isAiThinking = false;
  pendingPromotion = null;
  pendingCaptureQuiz = null;
  closeModal('modal-capture-quiz');
  beginNewQuizGameSession();
  quizStats = createEmptyQuizStats();
  selectedSquare = null;
  legalMovesForSelected = [];
  clear3DHintArrow();
  clearLearningFeedback();
  updatePieceTipUI(null);

  engine.reset();
  syncMeshesFromEngineImmediate();
  setCameraPreset('iso', false);

  if (gameConfig.mode === 'learning' && isSmartphoneViewport()) {
    enterMobileLearningMode();
  }
  setLearningEnabled(gameConfig.mode === 'learning');
  updateHUD();
  closeModal('modal-new-game');

  if (isVsAIMode() && engine.turn !== gameConfig.playerColor) {
    maybeTriggerAIMove();
  } else {
    refreshLearningAdvice();
  }
});

// --- Modale Planche de Référence Antique (Rendu 3D réel des 6 sculptures) ---
let refRenderer = null;
let refScene = null;
let refCamera = null;
let refShowcaseGroup = null;
let refCurrentColor = 'w';

function populateReferenceDescriptions() {
  const grid = document.getElementById('reference-grid');
  grid.innerHTML = '';
  for (const item of REFERENCE_PIECES_DATA) {
    const card = document.createElement('div');
    card.className = 'ref-item';
    card.innerHTML = `
      <h3 class="ref-item-title">${item.title}</h3>
      <p class="ref-item-latin">${item.latin}</p>
      <p class="ref-item-desc">${item.desc}</p>
    `;
    grid.appendChild(card);
  }
}
populateReferenceDescriptions();

function initReferenceShowcase() {
  const refCanvas = document.getElementById('reference-canvas');
  if (!refCanvas || refRenderer) return;

  refRenderer = new THREE.WebGLRenderer({
    canvas: refCanvas,
    antialias: !isSoftwareGl,
    alpha: false,
  });
  refRenderer.outputColorSpace = THREE.SRGBColorSpace;
  refRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  refRenderer.toneMappingExposure = 1.1;
  refRenderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  refRenderer.setSize(960, 320, false);

  refScene = new THREE.Scene();
  refScene.background = new THREE.Color(0x13100d);

  const pmrem = new THREE.PMREMGenerator(refRenderer);
  refScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  refCamera = new THREE.PerspectiveCamera(28, 960 / 320, 0.1, 40);
  refCamera.position.set(0, 1.55, 6.9);
  refCamera.lookAt(0, 0.65, 0);

  refScene.add(new THREE.HemisphereLight(0xd8e4f0, 0x241c15, 0.85));
  const key = new THREE.DirectionalLight(0xfff1da, 2.5);
  key.position.set(4, 7, 6);
  refScene.add(key);

  const rim = new THREE.DirectionalLight(0xc4d8ee, 1.1);
  rim.position.set(-5, 4, -5);
  refScene.add(rim);

  // Piédestal en mosaïque romaine pour exposer les 6 sculptures alignées
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.18, 1.45),
    materials.boardFrameBevel
  );
  plinth.position.y = -0.09;
  refScene.add(plinth);

  for (let i = 0; i < 6; i++) {
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(1.06, 0.03, 1.06),
      i % 2 === 0 ? materials.boardLightTile : materials.boardDarkTile
    );
    tile.position.set((i - 2.5) * 1.12, 0.015, 0);
    refScene.add(tile);
  }

  refShowcaseGroup = new THREE.Group();
  refScene.add(refShowcaseGroup);
}

function renderReferencePlate(color) {
  refCurrentColor = color;
  document.getElementById('ref-mat-w').classList.toggle('is-active', color === 'w');
  document.getElementById('ref-mat-b').classList.toggle('is-active', color === 'b');

  initReferenceShowcase();
  if (!refRenderer || !refShowcaseGroup) return;

  while (refShowcaseGroup.children.length > 0) {
    refShowcaseGroup.remove(refShowcaseGroup.children[0]);
  }

  const order = ['k', 'q', 'b', 'n', 'r', 'p'];
  order.forEach((type, idx) => {
    const mesh = createPieceMesh(type, color, materials);
    mesh.position.set((idx - 2.5) * 1.12, 0.03, 0);
    // Légère rotation 3/4 pour révéler les volumes (bouclier, encolure, sceptre)
    mesh.rotation.y = color === 'b' ? Math.PI + 0.38 : 0.38;
    refShowcaseGroup.add(mesh);
  });

  refRenderer.render(refScene, refCamera);
}

const refViewGuideEl = document.getElementById('ref-view-guide');
const refView3dEl = document.getElementById('ref-view-3d');
const tabRefGuideBtn = document.getElementById('tab-ref-guide');
const tabRef3dBtn = document.getElementById('tab-ref-3d');

function populateBeginnerGuide() {
  const basicsGrid = document.getElementById('beginner-basics-grid');
  if (basicsGrid) {
    basicsGrid.replaceChildren();
    for (const item of BEGINNER_BASICS) {
      const card = document.createElement('div');
      card.className = 'beginner-basic-card';

      const title = document.createElement('h3');
      title.className = 'beginner-basic-title';
      title.textContent = item.title;

      const text = document.createElement('p');
      text.className = 'beginner-basic-text';
      text.textContent = item.text;

      card.append(title, text);
      basicsGrid.appendChild(card);
    }
  }

  const piecesGrid = document.getElementById('beginner-pieces-grid');
  if (piecesGrid) {
    piecesGrid.replaceChildren();
    for (const piece of PIECE_GUIDE_DATA) {
      const card = document.createElement('article');
      card.className = 'guide-piece-card';

      const diagramWrap = document.createElement('div');
      diagramWrap.className = 'guide-piece-diagram';
      diagramWrap.appendChild(createPieceDiagramSvg(piece.type));

      const valueEl = document.createElement('span');
      valueEl.className = 'guide-piece-value';
      valueEl.textContent = piece.value;
      diagramWrap.appendChild(valueEl);

      const body = document.createElement('div');
      body.className = 'guide-piece-body';

      const head = document.createElement('div');
      head.className = 'guide-piece-head';

      const nameEl = document.createElement('h3');
      nameEl.className = 'guide-piece-name';
      nameEl.textContent = piece.name;

      const badgeEl = document.createElement('span');
      badgeEl.className = 'guide-piece-badge';
      badgeEl.textContent = piece.badge;

      head.append(nameEl, badgeEl);

      const summaryEl = document.createElement('p');
      summaryEl.className = 'guide-piece-summary';
      summaryEl.textContent = piece.summary;

      const movesList = document.createElement('ul');
      movesList.className = 'guide-piece-moves';
      for (const line of piece.moves) {
        const li = document.createElement('li');
        li.textContent = line;
        movesList.appendChild(li);
      }

      body.append(head, summaryEl, movesList);
      card.append(diagramWrap, body);
      piecesGrid.appendChild(card);
    }
  }
}
populateBeginnerGuide();

function setReferenceTab(tab = 'guide') {
  const isGuide = tab === 'guide';
  refViewGuideEl?.classList.toggle('hidden', !isGuide);
  refView3dEl?.classList.toggle('hidden', isGuide);

  tabRefGuideBtn?.classList.toggle('is-active', isGuide);
  tabRefGuideBtn?.setAttribute('aria-selected', String(isGuide));
  tabRef3dBtn?.classList.toggle('is-active', !isGuide);
  tabRef3dBtn?.setAttribute('aria-selected', String(!isGuide));

  if (!isGuide) {
    renderReferencePlate(refCurrentColor);
  }
}

function openReferenceModal(initialTab = '3d') {
  openModal('modal-reference');
  setReferenceTab(initialTab);
}

tabRefGuideBtn?.addEventListener('click', () => setReferenceTab('guide'));
tabRef3dBtn?.addEventListener('click', () => setReferenceTab('3d'));
document.getElementById('btn-help-top')?.addEventListener('click', () => openReferenceModal('guide'));
document.getElementById('btn-learning-help')?.addEventListener('click', () => openReferenceModal('guide'));
document.getElementById('btn-plate-top')?.addEventListener('click', () => openReferenceModal('3d'));
document.getElementById('btn-plate-bottom')?.addEventListener('click', () => openReferenceModal('3d'));
document.getElementById('ref-mat-w')?.addEventListener('click', () => renderReferencePlate('w'));
document.getElementById('ref-mat-b')?.addEventListener('click', () => renderReferencePlate('b'));

// ============================================================================
// 9B. ESPACE JOUEUR : IDENTIFIANT, CONNEXION & INSCRIPTION (SÉCURISÉ SERVEUR)
// ============================================================================

let authToken = null; // Conservé uniquement en mémoire JS (jamais en localStorage)
let currentUser = null;
let authModalMode = 'login'; // 'login' | 'register'
let authSubview = 'forms'; // 'forms' | 'forgot' | 'reset' | 'profile'
let pendingResetToken = null;
let serverSmtpConfigured = false;

async function refreshSmtpConfig() {
  try {
    const cfg = await apiFetch('/api/auth/config');
    serverSmtpConfigured = Boolean(cfg?.smtpConfigured);
  } catch {
    serverSmtpConfigured = false;
  }
  if (authSubview === 'forgot' && forgotSmtpNoteEl) {
    forgotSmtpNoteEl.classList.toggle('hidden', serverSmtpConfigured);
  }
}

const EMAIL_INPUT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const btnAuthTop = document.getElementById('btn-auth-top');
const authTopLabel = document.getElementById('auth-top-label');
const campaignAuthStatus = document.getElementById('campaign-auth-status');
const btnCampaignAuth = document.getElementById('btn-campaign-auth');
const authFormsView = document.getElementById('auth-forms-view');
const authForgotView = document.getElementById('auth-forgot-view');
const authResetView = document.getElementById('auth-reset-view');
const authProfileView = document.getElementById('auth-profile-view');
const tabAuthLogin = document.getElementById('tab-auth-login');
const tabAuthRegister = document.getElementById('tab-auth-register');
const formAuth = document.getElementById('form-auth');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authForgotRow = document.getElementById('auth-forgot-row');
const authConfirmGroup = document.getElementById('auth-confirm-group');
const authPasswordConfirmInput = document.getElementById('auth-password-confirm');
const authFeedbackEl = document.getElementById('auth-feedback');
const btnAuthSubmit = document.getElementById('btn-auth-submit');

const formForgot = document.getElementById('form-forgot-password');
const forgotEmailInput = document.getElementById('forgot-email');
const forgotSmtpNoteEl = document.getElementById('forgot-smtp-note');
const forgotFeedbackEl = document.getElementById('forgot-feedback');
const btnForgotSubmit = document.getElementById('btn-forgot-submit');

const formReset = document.getElementById('form-reset-password');
const resetPasswordInput = document.getElementById('reset-password');
const resetPasswordConfirmInput = document.getElementById('reset-password-confirm');
const resetFeedbackEl = document.getElementById('reset-feedback');
const btnResetSubmit = document.getElementById('btn-reset-submit');

async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const resp = await fetch(url, { ...options, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || 'Une erreur est survenue.');
  }
  return data;
}

function setBannerFeedback(el, message, isSuccess = false) {
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.toggle('is-success', isSuccess);
  el.classList.remove('hidden');
}

function showAuthFeedback(message, isSuccess = false) {
  setBannerFeedback(authFeedbackEl, message, isSuccess);
}

function setAuthSubview(view) {
  authSubview = view;
  authFormsView?.classList.toggle('hidden', view !== 'forms');
  authForgotView?.classList.toggle('hidden', view !== 'forgot');
  authResetView?.classList.toggle('hidden', view !== 'reset');
  authProfileView?.classList.toggle('hidden', view !== 'profile');
  if (view === 'forgot' && forgotSmtpNoteEl) {
    forgotSmtpNoteEl.classList.toggle('hidden', serverSmtpConfigured);
  }
}

function setAuthModalMode(mode) {
  authModalMode = mode === 'register' ? 'register' : 'login';
  const isReg = authModalMode === 'register';
  tabAuthLogin?.classList.toggle('is-active', !isReg);
  tabAuthLogin?.setAttribute('aria-selected', String(!isReg));
  tabAuthRegister?.classList.toggle('is-active', isReg);
  tabAuthRegister?.setAttribute('aria-selected', String(isReg));

  authForgotRow?.classList.toggle('hidden', isReg);
  authConfirmGroup?.classList.toggle('hidden', !isReg);
  if (authPasswordConfirmInput) {
    authPasswordConfirmInput.required = isReg;
    if (!isReg) authPasswordConfirmInput.value = '';
  }
  if (authPasswordInput) {
    authPasswordInput.autocomplete = isReg ? 'new-password' : 'current-password';
  }
  if (btnAuthSubmit) {
    btnAuthSubmit.textContent = isReg ? 'Créer mon compte' : 'Se connecter';
  }
  showAuthFeedback('');
}

function syncAuthUI() {
  const loggedIn = Boolean(currentUser);
  btnAuthTop?.classList.toggle('is-logged-in', loggedIn);
  if (authTopLabel) {
    authTopLabel.textContent = loggedIn ? currentUser.email : 'Connexion';
  }

  if (campaignAuthStatus) {
    if (loggedIn) {
      const s = currentUser.stats || { wins: 0, draws: 0, losses: 0 };
      campaignAuthStatus.textContent = `Connecté : ${currentUser.email} (${s.wins} V · ${s.draws} N · ${s.losses} D)`;
    } else {
      campaignAuthStatus.textContent =
        'Mode invité · Connectez-vous avec votre e-mail pour sauvegarder vos scores';
    }
  }
  if (btnCampaignAuth) {
    btnCampaignAuth.textContent = loggedIn ? 'Mon compte' : "Se connecter / S'inscrire";
  }

  if (loggedIn && authSubview !== 'reset') {
    setAuthSubview('profile');
  } else if (!loggedIn && authSubview === 'profile') {
    setAuthSubview('forms');
  }

  if (loggedIn) {
    const s = currentUser.stats || { wins: 0, draws: 0, losses: 0 };
    const profileEmailEl = document.getElementById('profile-email');
    const profileCreatedEl = document.getElementById('profile-created');
    const profileWinsEl = document.getElementById('profile-wins');
    const profileDrawsEl = document.getElementById('profile-draws');
    const profileLossesEl = document.getElementById('profile-losses');

    if (profileEmailEl) profileEmailEl.textContent = currentUser.email;
    if (profileCreatedEl) {
      const dateStr = currentUser.createdAt
        ? new Date(currentUser.createdAt).toLocaleDateString('fr-FR')
        : '';
      profileCreatedEl.textContent = dateStr ? `Inscrit le ${dateStr}` : 'Compte actif';
    }
    if (profileWinsEl) profileWinsEl.textContent = String(s.wins);
    if (profileDrawsEl) profileDrawsEl.textContent = String(s.draws);
    if (profileLossesEl) profileLossesEl.textContent = String(s.losses);
  }
}

function openAuthModal(defaultTab = 'login') {
  if (currentUser) {
    setAuthSubview('profile');
  } else {
    setAuthModalMode(defaultTab);
    setAuthSubview('forms');
  }
  syncAuthUI();
  openModal('modal-auth');
  if (!currentUser) {
    window.setTimeout(() => authEmailInput?.focus(), 40);
  }
}

async function recordMatchResult(result) {
  if (!authToken) return;
  try {
    const data = await apiFetch('/api/auth/stats', {
      method: 'POST',
      body: JSON.stringify({ result }),
    });
    if (data.user) {
      currentUser = data.user;
      syncAuthUI();
    }
  } catch (err) {
    console.error('Erreur enregistrement résultat:', err);
  }
}

btnAuthTop?.addEventListener('click', () => openAuthModal('login'));
btnCampaignAuth?.addEventListener('click', () => openAuthModal('login'));
tabAuthLogin?.addEventListener('click', () => setAuthModalMode('login'));
tabAuthRegister?.addEventListener('click', () => setAuthModalMode('register'));

document.getElementById('btn-forgot-password')?.addEventListener('click', () => {
  setBannerFeedback(forgotFeedbackEl, '');
  if (forgotEmailInput && authEmailInput?.value) {
    forgotEmailInput.value = authEmailInput.value.trim();
  }
  setAuthSubview('forgot');
  refreshSmtpConfig();
  window.setTimeout(() => forgotEmailInput?.focus(), 40);
});

document.getElementById('btn-forgot-back')?.addEventListener('click', () => {
  setAuthModalMode('login');
  setAuthSubview('forms');
});

document.getElementById('btn-reset-back')?.addEventListener('click', () => {
  pendingResetToken = null;
  setAuthModalMode('login');
  setAuthSubview('forms');
});

formAuth?.addEventListener('submit', async (e) => {
  e.preventDefault();
  showAuthFeedback('');

  const email = (authEmailInput?.value || '').trim();
  const password = authPasswordInput?.value || '';
  const confirm = authPasswordConfirmInput?.value || '';

  if (!EMAIL_INPUT_REGEX.test(email) || email.length > 160) {
    showAuthFeedback('Veuillez saisir une adresse e-mail valide.');
    return;
  }
  if (password.length < 6 || password.length > 128) {
    showAuthFeedback('Le mot de passe doit contenir au moins 6 caractères.');
    return;
  }
  if (authModalMode === 'register' && password !== confirm) {
    showAuthFeedback('Les deux mots de passe ne correspondent pas.');
    return;
  }

  if (btnAuthSubmit) btnAuthSubmit.disabled = true;
  try {
    const endpoint = authModalMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const data = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    authToken = data.token;
    currentUser = data.user;
    if (authPasswordInput) authPasswordInput.value = '';
    if (authPasswordConfirmInput) authPasswordConfirmInput.value = '';
    syncAuthUI();
    closeModal('modal-auth');
  } catch (err) {
    showAuthFeedback(err instanceof Error ? err.message : 'Échec de la connexion.');
  } finally {
    if (btnAuthSubmit) btnAuthSubmit.disabled = false;
  }
});

formForgot?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setBannerFeedback(forgotFeedbackEl, '');

  const email = (forgotEmailInput?.value || '').trim();
  if (!EMAIL_INPUT_REGEX.test(email) || email.length > 160) {
    setBannerFeedback(forgotFeedbackEl, 'Veuillez saisir une adresse e-mail valide.');
    return;
  }

  if (btnForgotSubmit) btnForgotSubmit.disabled = true;
  try {
    const data = await apiFetch('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    setBannerFeedback(
      forgotFeedbackEl,
      data.message ||
        "Si un compte correspond à cette adresse e-mail, un lien de réinitialisation vient d'être envoyé.",
      true
    );
  } catch (err) {
    setBannerFeedback(
      forgotFeedbackEl,
      err instanceof Error ? err.message : "Impossible d'envoyer l'e-mail."
    );
  } finally {
    if (btnForgotSubmit) btnForgotSubmit.disabled = false;
  }
});

formReset?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setBannerFeedback(resetFeedbackEl, '');

  const newPassword = resetPasswordInput?.value || '';
  const confirm = resetPasswordConfirmInput?.value || '';

  if (!pendingResetToken) {
    setBannerFeedback(resetFeedbackEl, 'Lien de réinitialisation manquant ou expiré.');
    return;
  }
  if (newPassword.length < 6 || newPassword.length > 128) {
    setBannerFeedback(resetFeedbackEl, 'Le mot de passe doit contenir au moins 6 caractères.');
    return;
  }
  if (newPassword !== confirm) {
    setBannerFeedback(resetFeedbackEl, 'Les deux mots de passe ne correspondent pas.');
    return;
  }

  if (btnResetSubmit) btnResetSubmit.disabled = true;
  try {
    const data = await apiFetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: pendingResetToken, newPassword }),
    });
    pendingResetToken = null;
    if (resetPasswordInput) resetPasswordInput.value = '';
    if (resetPasswordConfirmInput) resetPasswordConfirmInput.value = '';
    setAuthModalMode('login');
    setAuthSubview('forms');
    showAuthFeedback(
      data.message || 'Mot de passe modifié avec succès. Connectez-vous.',
      true
    );
  } catch (err) {
    setBannerFeedback(
      resetFeedbackEl,
      err instanceof Error ? err.message : 'Échec de la modification du mot de passe.'
    );
  } finally {
    if (btnResetSubmit) btnResetSubmit.disabled = false;
  }
});

document.getElementById('btn-auth-logout')?.addEventListener('click', async () => {
  try {
    if (authToken) {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    }
  } catch (_) {
    // Nettoyage local garanti même en cas d'erreur réseau
  } finally {
    authToken = null;
    currentUser = null;
    setAuthModalMode('login');
    setAuthSubview('forms');
    syncAuthUI();
  }
});

refreshSmtpConfig();

// Détection d'un lien de réinitialisation de mot de passe (?resetToken=...)
const initialParams = new URLSearchParams(window.location.search);
const urlResetToken = initialParams.get('resetToken');
if (urlResetToken) {
  pendingResetToken = urlResetToken;
  window.history.replaceState({}, '', window.location.pathname);
}

syncAuthUI();

// ============================================================================
// 9C. SAUVEGARDE & REPRISE DES PARTIES (SERVEUR + STOCKAGE LOCAL)
// ============================================================================

const LOCAL_SAVES_KEY = 'echecs_antiques_saved_games_v1';
const LOCAL_AUTOSAVE_KEY = 'echecs_antiques_autosave_v1';

const btnSaves = document.getElementById('btn-saves');
const btnOpenSavesFromNewGame = document.getElementById('btn-open-saves-from-newgame');
const savesStorageStatusEl = document.getElementById('saves-storage-status');
const btnSavesAuth = document.getElementById('btn-saves-auth');
const formSaveGame = document.getElementById('form-save-game');
const saveGameTitleInput = /** @type {HTMLInputElement | null} */ (
  document.getElementById('save-game-title')
);
const btnSaveCurrentGame = /** @type {HTMLButtonElement | null} */ (
  document.getElementById('btn-save-current-game')
);
const savesFeedbackEl = document.getElementById('saves-feedback');
const autosaveSlotCardEl = document.getElementById('autosave-slot-card');
const autosaveMetaEl = document.getElementById('autosave-meta');
const btnResumeAutosave = document.getElementById('btn-resume-autosave');
const savedGamesEmptyEl = document.getElementById('saved-games-empty');
const savedGamesListEl = document.getElementById('saved-games-list');

let cachedSavedGames = [];

function createClientSaveId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `save-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDefaultSaveTitle() {
  const modeLabel =
    gameConfig.mode === 'pvp'
      ? 'Duel 2 Joueurs'
      : `Vs ${AI_LEVELS[gameConfig.aiLevel]?.label || 'IA'}`;
  const moveTotal = engine.moveHistory.length;
  return moveTotal > 0 ? `${modeLabel} · ${moveTotal} coups` : `${modeLabel} · Début`;
}

function buildCurrentGamePayload(customTitle = '') {
  const cleanTitle = (customTitle || '').trim().slice(0, 80) || formatDefaultSaveTitle();
  return {
    title: cleanTitle,
    mode: gameConfig.mode,
    aiLevel: gameConfig.aiLevel,
    playerColor: gameConfig.playerColor,
    learningEnabled: Boolean(learningEnabled),
    quizEnabled: gameConfig.quizEnabled !== false,
    quizStats: normalizeQuizStats(quizStats),
    cameraPreset: activeCameraPreset,
    status: engine.status,
    turn: engine.turn,
    moveCount: engine.moveHistory.length,
    moves: engine.exportMoves(),
  };
}

function loadLocalSavedGames() {
  try {
    const raw = window.localStorage.getItem(LOCAL_SAVES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalSavedGames(games) {
  try {
    window.localStorage.setItem(LOCAL_SAVES_KEY, JSON.stringify(games.slice(0, 25)));
  } catch {
    // Ignorer si le stockage local est indisponible ou plein
  }
}

function loadLocalAutoSave() {
  try {
    const raw = window.localStorage.getItem(LOCAL_AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.moves) || parsed.moves.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistAutoSaveIfNeeded() {
  if (engine.moveHistory.length === 0) return;
  try {
    const payload = {
      ...buildCurrentGamePayload('Dernière partie en cours'),
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(LOCAL_AUTOSAVE_KEY, JSON.stringify(payload));
  } catch {
    // Ignorer les erreurs de quota localStorage
  }
}

function formatSavedGameMeta(game) {
  const modeText =
    game.mode === 'pvp'
      ? '2 Joueurs'
      : game.mode === 'learning'
      ? `Apprentissage (${AI_LEVELS[game.aiLevel]?.label || 'IA'})`
      : `Contre l'IA (${AI_LEVELS[game.aiLevel]?.label || 'IA'})`;

  const sideText =
    game.mode === 'pvp'
      ? game.turn === COLORS.WHITE
        ? 'Trait aux Blancs'
        : 'Trait aux Noirs'
      : game.playerColor === COLORS.WHITE
      ? 'Camp Blancs'
      : 'Camp Noirs';

  const count = Array.isArray(game.moves) ? game.moves.length : Number(game.moveCount) || 0;
  const movesText = `${count} ${count > 1 ? 'coups' : 'coup'}`;

  let dateText = '';
  if (game.savedAt) {
    const d = new Date(game.savedAt);
    if (!Number.isNaN(d.getTime())) {
      dateText = d.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }

  return [modeText, sideText, movesText, dateText].filter(Boolean).join(' · ');
}

function getStatusBadgeLabel(status) {
  if (status === 'checkmate') return 'Échec et mat';
  if (status === 'stalemate' || status === 'draw') return 'Partie nulle';
  if (status === 'check') return 'Échec';
  return 'En cours';
}

function syncSavesStorageBanner() {
  const loggedIn = Boolean(authToken && currentUser);
  if (savesStorageStatusEl) {
    savesStorageStatusEl.textContent = loggedIn
      ? `Compte actif : ${currentUser.email} — Parties sauvegardées sur votre compte`
      : 'Sauvegarde locale sur cet appareil · Connectez-vous pour enregistrer sur votre compte';
  }
  if (btnSavesAuth) {
    btnSavesAuth.textContent = loggedIn ? 'Mon compte' : 'Se connecter';
  }
}

function renderAutoSaveCard() {
  const autoGame = loadLocalAutoSave();
  if (!autosaveSlotCardEl || !autosaveMetaEl) return;
  if (!autoGame) {
    autosaveSlotCardEl.classList.add('hidden');
    return;
  }
  autosaveMetaEl.textContent = formatSavedGameMeta(autoGame);
  autosaveSlotCardEl.classList.remove('hidden');
}

function renderSavedGamesList(games) {
  if (!savedGamesListEl || !savedGamesEmptyEl) return;
  savedGamesListEl.replaceChildren();

  if (!games || games.length === 0) {
    savedGamesEmptyEl.classList.remove('hidden');
    return;
  }

  savedGamesEmptyEl.classList.add('hidden');

  for (const game of games) {
    const item = document.createElement('div');
    item.className = 'save-item';

    const info = document.createElement('div');
    info.className = 'save-item-info';

    const head = document.createElement('div');
    head.className = 'save-item-head';

    const titleEl = document.createElement('strong');
    titleEl.className = 'save-item-title';
    titleEl.textContent = game.title || 'Partie sauvegardée';

    const badgeEl = document.createElement('span');
    badgeEl.className = 'save-badge';
    badgeEl.textContent = getStatusBadgeLabel(game.status);

    head.append(titleEl, badgeEl);

    const metaEl = document.createElement('p');
    metaEl.className = 'save-item-meta';
    metaEl.textContent = formatSavedGameMeta(game);

    info.append(head, metaEl);

    const actions = document.createElement('div');
    actions.className = 'save-item-actions';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn-primary btn-compact';
    loadBtn.textContent = 'Charger';
    loadBtn.addEventListener('click', () => {
      applySavedGame(game);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-danger-compact';
    delBtn.textContent = 'Supprimer';
    delBtn.addEventListener('click', () => {
      deleteSavedGameById(game.id);
    });

    actions.append(loadBtn, delBtn);
    item.append(info, actions);
    savedGamesListEl.appendChild(item);
  }
}

async function refreshSavedGamesList() {
  syncSavesStorageBanner();
  renderAutoSaveCard();

  if (authToken) {
    try {
      const data = await apiFetch('/api/games');
      cachedSavedGames = Array.isArray(data.games) ? data.games : [];
    } catch (err) {
      setBannerFeedback(
        savesFeedbackEl,
        err instanceof Error ? err.message : 'Impossible de charger les sauvegardes.'
      );
      cachedSavedGames = [];
    }
  } else {
    cachedSavedGames = loadLocalSavedGames();
  }

  renderSavedGamesList(cachedSavedGames);
}

function applySavedGame(game) {
  if (!game || !Array.isArray(game.moves)) {
    setBannerFeedback(savesFeedbackEl, 'Cette sauvegarde est invalide.');
    return;
  }

  const loaded = engine.loadFromMoves(game.moves);
  if (!loaded) {
    setBannerFeedback(
      savesFeedbackEl,
      'Impossible de restaurer cette partie (historique de coups invalide).'
    );
    return;
  }

  stopInteractiveTutorial();
  aiSessionToken++;
  isAiThinking = false;
  pendingPromotion = null;
  pendingCaptureQuiz = null;
  closeModal('modal-capture-quiz');
  beginNewQuizGameSession();
  selectedSquare = null;
  legalMovesForSelected = [];
  clear3DHintArrow();
  clearLearningFeedback();
  updatePieceTipUI(null);

  gameConfig.mode =
    game.mode === 'pvp' || game.mode === 'learning' || game.mode === 'ai' ? game.mode : 'ai';
  gameConfig.aiLevel = [1, 2, 3].includes(Number(game.aiLevel)) ? Number(game.aiLevel) : 2;
  gameConfig.playerColor = game.playerColor === COLORS.BLACK ? COLORS.BLACK : COLORS.WHITE;
  gameConfig.quizEnabled = game.quizEnabled !== false;
  quizStats = normalizeQuizStats(game.quizStats);

  syncMeshesFromEngineImmediate();
  setLearningEnabled(Boolean(game.learningEnabled));
  setCameraPreset(
    CAMERA_STYLE_ORDER.includes(game.cameraPreset) ? game.cameraPreset : 'iso',
    false
  );
  updateHUD();
  persistAutoSaveIfNeeded();

  closeModal('modal-saves');
  closeModal('modal-new-game');
  closeModal('modal-gameover');

  if (
    engine.status !== 'checkmate' &&
    engine.status !== 'stalemate' &&
    engine.status !== 'draw' &&
    isVsAIMode() &&
    engine.turn !== gameConfig.playerColor
  ) {
    maybeTriggerAIMove();
  } else {
    refreshLearningAdvice();
  }
}

async function deleteSavedGameById(gameId) {
  setBannerFeedback(savesFeedbackEl, '');
  if (authToken) {
    try {
      await apiFetch(`/api/games/${encodeURIComponent(gameId)}`, { method: 'DELETE' });
      await refreshSavedGamesList();
      setBannerFeedback(savesFeedbackEl, 'Partie supprimée.', true);
    } catch (err) {
      setBannerFeedback(
        savesFeedbackEl,
        err instanceof Error ? err.message : 'Impossible de supprimer cette sauvegarde.'
      );
    }
    return;
  }

  const next = loadLocalSavedGames().filter((g) => g.id !== gameId);
  writeLocalSavedGames(next);
  cachedSavedGames = next;
  renderSavedGamesList(next);
  setBannerFeedback(savesFeedbackEl, 'Partie supprimée.', true);
}

async function openSavesModal() {
  setBannerFeedback(savesFeedbackEl, '');
  if (saveGameTitleInput) {
    saveGameTitleInput.value = '';
    saveGameTitleInput.placeholder = formatDefaultSaveTitle();
  }
  openModal('modal-saves');
  await refreshSavedGamesList();
}

btnSaves?.addEventListener('click', () => {
  openSavesModal();
});

btnOpenSavesFromNewGame?.addEventListener('click', () => {
  openSavesModal();
});

btnSavesAuth?.addEventListener('click', () => {
  closeModal('modal-saves');
  openAuthModal('login');
});

btnResumeAutosave?.addEventListener('click', () => {
  const autoGame = loadLocalAutoSave();
  if (!autoGame) return;
  applySavedGame(autoGame);
});

formSaveGame?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setBannerFeedback(savesFeedbackEl, '');

  if (isAiThinking || pendingPromotion) {
    setBannerFeedback(
      savesFeedbackEl,
      "Veuillez patienter la fin du coup ou de la promotion avant de sauvegarder."
    );
    return;
  }

  const payload = buildCurrentGamePayload(saveGameTitleInput?.value || '');
  if (btnSaveCurrentGame) btnSaveCurrentGame.disabled = true;

  try {
    if (authToken) {
      await apiFetch('/api/games', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } else {
      const localList = loadLocalSavedGames();
      localList.unshift({
        id: createClientSaveId(),
        ...payload,
        savedAt: new Date().toISOString(),
      });
      writeLocalSavedGames(localList);
    }

    if (saveGameTitleInput) saveGameTitleInput.value = '';
    await refreshSavedGamesList();
    setBannerFeedback(savesFeedbackEl, 'Partie sauvegardée avec succès !', true);
  } catch (err) {
    setBannerFeedback(
      savesFeedbackEl,
      err instanceof Error ? err.message : 'Échec de la sauvegarde de la partie.'
    );
  } finally {
    if (btnSaveCurrentGame) btnSaveCurrentGame.disabled = false;
  }
});

// ============================================================================
// 10. BOUCLE DE RENDU 60 FPS & REDIMENSIONNEMENT
// ============================================================================

syncMeshesFromEngineImmediate();
updateHUD();
if (pendingResetToken) {
  setBannerFeedback(resetFeedbackEl, '');
  setAuthSubview('reset');
  openModal('modal-auth');
  window.setTimeout(() => resetPasswordInput?.focus(), 40);
} else {
  openNewGameModal();
}

if (renderer && !isSoftwareGl) {
  renderer.compile(scene, camera);
}

const _tempPos = new THREE.Vector3();
let lastTime = performance.now();
let elapsedTotal = 0;
let frameId = 0;

function afterDraw(cb) {
  const gl = renderer.getContext();
  if (!gl || typeof gl.fenceSync !== 'function') {
    frameId = window.setTimeout(cb, 80);
    return;
  }
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  const poll = () => {
    const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
    if (state === gl.UNSIGNALED) {
      frameId = window.setTimeout(poll, 5);
    } else {
      if (sync) gl.deleteSync(sync);
      frameId = window.setTimeout(cb, 80);
    }
  };
  frameId = window.setTimeout(poll, 5);
}

function tick() {
  if (!renderer) return;

  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
  lastTime = now;
  elapsedTotal += dt;

  // 1. Transition douce de caméra (exponential damping)
  if (cameraTransition && controls) {
    camera.position.x = THREE.MathUtils.damp(camera.position.x, cameraTransition.targetPos.x, 7.5, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, cameraTransition.targetPos.y, 7.5, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, cameraTransition.targetPos.z, 7.5, dt);

    controls.target.x = THREE.MathUtils.damp(controls.target.x, cameraTransition.targetLook.x, 8.5, dt);
    controls.target.y = THREE.MathUtils.damp(controls.target.y, cameraTransition.targetLook.y, 8.5, dt);
    controls.target.z = THREE.MathUtils.damp(controls.target.z, cameraTransition.targetLook.z, 8.5, dt);

    if (camera.position.distanceTo(cameraTransition.targetPos) < 0.03) {
      camera.position.copy(cameraTransition.targetPos);
      controls.target.copy(cameraTransition.targetLook);
      cameraTransition = null;
    }
  }

  if (controls) {
    controls.update();
  }

  // 2. Animation des pièces (déplacement parabolique + lévitation de la pièce sélectionnée)
  for (const entry of pieceMeshMap.values()) {
    const isSel =
      selectedSquare && selectedSquare.row === entry.row && selectedSquare.col === entry.col;
    const targetLift = isSel ? 0.24 + Math.sin(elapsedTotal * 3.8) * 0.03 : 0;
    entry.liftY = THREE.MathUtils.damp(entry.liftY, targetLift, 14, dt);

    if (entry.moveAnim) {
      entry.moveAnim.elapsed += dt;
      const t = Math.min(1, entry.moveAnim.elapsed / entry.moveAnim.duration);
      const eased = 1 - Math.pow(1 - t, 3);
      _tempPos.lerpVectors(entry.moveAnim.startPos, entry.moveAnim.endPos, eased);
      const arc = Math.sin(t * Math.PI) * entry.moveAnim.arcHeight;
      entry.mesh.position.set(_tempPos.x, BOARD_TOP_Y + arc + entry.liftY, _tempPos.z);
      if (t >= 1) {
        entry.moveAnim = null;
      }
    } else {
      entry.mesh.position.y = BOARD_TOP_Y + entry.liftY;
    }
  }

  // 3. Pulsation de l'aura rouge rubis sous le Roi en échec
  if (checkAuraGroup.visible) {
    const pulse = 0.55 + 0.35 * Math.sin(elapsedTotal * 5.2);
    checkAuraMat.opacity = pulse;
    const s = 0.96 + 0.08 * Math.sin(elapsedTotal * 5.2);
    checkAuraGroup.scale.set(s, 1, s);
  }

  // 3b. Flottement de la flèche 3D de conseil (Mode Apprentissage)
  if (hintGroup.visible && showHintArrowOnBoard) {
    hintArrowBody.position.y = BOARD_TOP_Y + 0.14 + Math.sin(elapsedTotal * 3.4) * 0.035;
  }

  // 3c. Maintien de l'orientation de l'inscription de case face à la caméra
  if (hoverTileLabelGroup.visible) {
    hoverTileLabelGroup.rotation.y = getCameraSnapYaw();
  }

  // 4. Simulation physique 60 FPS des éclats 3D
  shatterFX.update(dt);

  renderer.render(scene, camera);

  if (isSoftwareGl) {
    afterDraw(tick);
  } else {
    frameId = requestAnimationFrame(tick);
  }
}

if (renderer) {
  if (isSoftwareGl) {
    frameId = requestAnimationFrame(tick);
  } else {
    frameId = requestAnimationFrame(tick);
  }
}

window.addEventListener('resize', () => {
  updateTutorialSpotlight();
  if (!renderer) return;
  const newAspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.aspect = newAspect;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  if (getFullscreenElement() || Math.abs(newAspect - lastViewportAspect) > 0.06) {
    lastViewportAspect = newAspect;
    setCameraPreset(activeCameraPreset, false);
  }
});

window.addEventListener('beforeunload', () => {
  voiceController.stop();
  cancelAnimationFrame(frameId);
  clearTimeout(frameId);
});
