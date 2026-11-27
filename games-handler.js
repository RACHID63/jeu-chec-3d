import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { requireAuth } from './auth-handler.js';

// ============================================================================
// 1. STOCKAGE PERSISTANT ATOMIQUE DES PARTIES SAUVEGARDÉES
// ============================================================================

const DATA_DIR = path.resolve(process.cwd(), 'data');
const GAMES_FILE = path.resolve(DATA_DIR, 'games.json');
const MAX_GAMES_PER_USER = 25;
const MAX_MOVES_PER_GAME = 600;

if (!GAMES_FILE.startsWith(DATA_DIR + path.sep)) {
  throw new Error('Chemin de stockage des parties invalide.');
}

let gamesWriteQueue = Promise.resolve();

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
}

/**
 * @returns {Promise<any[]>}
 */
async function loadGames() {
  await ensureDataDir();
  try {
    const raw = await fsp.readFile(GAMES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (/** @type {any} */ (err)?.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * @param {(games: any[]) => Promise<void> | void} mutator
 */
function saveGamesSerialized(mutator) {
  const next = gamesWriteQueue.then(async () => {
    const games = await loadGames();
    await mutator(games);
    const tmpFile = path.resolve(DATA_DIR, `.games.${crypto.randomUUID()}.tmp`);
    if (!tmpFile.startsWith(DATA_DIR + path.sep)) {
      throw new Error('Chemin temporaire invalide.');
    }
    await fsp.writeFile(tmpFile, JSON.stringify(games, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fsp.rename(tmpFile, GAMES_FILE);
  });
  gamesWriteQueue = next.catch(() => {});
  return next;
}

// ============================================================================
// 2. VALIDATION STRICTE DES DONNÉES DE PARTIE
// ============================================================================

const VALID_MODES = new Set(['ai', 'learning', 'pvp']);
const VALID_LEVELS = new Set([1, 2, 3]);
const VALID_COLORS = new Set(['w', 'b']);
const VALID_PRESETS = new Set(['iso', 'cinematic', 'top']);
const VALID_PROMOS = new Set(['q', 'r', 'b', 'n']);
const VALID_STATUSES = new Set(['playing', 'check', 'checkmate', 'stalemate', 'draw']);

const VALID_PIECE_TYPES = new Set(['p', 'n', 'b', 'r', 'q']);

/**
 * @param {any} rawMove
 */
function sanitizeMove(rawMove) {
  if (!rawMove || typeof rawMove !== 'object') return null;
  const { fromRow, fromCol, toRow, toCol, promotion, redeemed } = rawMove;
  const coords = [fromRow, fromCol, toRow, toCol];
  if (coords.some((n) => !Number.isInteger(n) || n < 0 || n > 7)) {
    return null;
  }
  /** @type {{ fromRow: number, fromCol: number, toRow: number, toCol: number, promotion?: string, redeemed?: boolean }} */
  const clean = { fromRow, fromCol, toRow, toCol };
  if (promotion !== undefined && promotion !== null) {
    if (typeof promotion !== 'string' || !VALID_PROMOS.has(promotion)) {
      return null;
    }
    clean.promotion = promotion;
  }
  if (redeemed === true) {
    clean.redeemed = true;
  }
  return clean;
}

/**
 * @param {any} rawSide
 */
function sanitizeQuizSide(rawSide) {
  const s = rawSide && typeof rawSide === 'object' ? rawSide : {};
  const asked = Number.isInteger(s.asked) && s.asked >= 0 && s.asked <= 500 ? s.asked : 0;
  const correct = Number.isInteger(s.correct) && s.correct >= 0 && s.correct <= asked ? s.correct : 0;
  const wrong = Number.isInteger(s.wrong) && s.wrong >= 0 && s.wrong <= asked ? s.wrong : 0;
  const skipped = Number.isInteger(s.skipped) && s.skipped >= 0 && s.skipped <= 500 ? s.skipped : 0;
  const recoveredPieces = Array.isArray(s.recoveredPieces)
    ? s.recoveredPieces.filter((t) => typeof t === 'string' && VALID_PIECE_TYPES.has(t)).slice(0, 64)
    : [];
  return { asked, correct, wrong, skipped, recoveredPieces };
}

/**
 * @param {any} rawStats
 */
function sanitizeQuizStats(rawStats) {
  const obj = rawStats && typeof rawStats === 'object' ? rawStats : {};
  return {
    w: sanitizeQuizSide(obj.w),
    b: sanitizeQuizSide(obj.b),
  };
}

/**
 * @param {any} body
 */
function validateSavedGamePayload(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Données de partie invalides.' };
  }

  const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
  const title = (rawTitle || 'Partie sans titre').slice(0, 80);

  const mode = VALID_MODES.has(body.mode) ? body.mode : null;
  if (!mode) {
    return { error: 'Mode de jeu invalide.' };
  }

  const aiLevel = Number(body.aiLevel);
  if (!VALID_LEVELS.has(aiLevel)) {
    return { error: 'Niveau IA invalide.' };
  }

  const playerColor = VALID_COLORS.has(body.playerColor) ? body.playerColor : null;
  if (!playerColor) {
    return { error: 'Couleur du joueur invalide.' };
  }

  const learningEnabled = Boolean(body.learningEnabled);
  const quizEnabled = body.quizEnabled !== false;
  const cameraPreset = VALID_PRESETS.has(body.cameraPreset) ? body.cameraPreset : 'iso';
  const status = VALID_STATUSES.has(body.status) ? body.status : 'playing';
  const turn = VALID_COLORS.has(body.turn) ? body.turn : 'w';

  if (!Array.isArray(body.moves) || body.moves.length > MAX_MOVES_PER_GAME) {
    return { error: 'Historique de coups invalide ou trop volumineux.' };
  }

  const moves = [];
  for (const m of body.moves) {
    const clean = sanitizeMove(m);
    if (!clean) {
      return { error: 'Coup invalide détecté dans la sauvegarde.' };
    }
    moves.push(clean);
  }

  return {
    data: {
      title,
      mode,
      aiLevel,
      playerColor,
      learningEnabled,
      quizEnabled,
      quizStats: sanitizeQuizStats(body.quizStats),
      cameraPreset,
      status,
      turn,
      moveCount: moves.length,
      moves,
    },
  };
}

/**
 * @param {any} g
 */
function toPublicGame(g) {
  return {
    id: g.id,
    title: g.title,
    mode: g.mode,
    aiLevel: g.aiLevel,
    playerColor: g.playerColor,
    learningEnabled: Boolean(g.learningEnabled),
    quizEnabled: g.quizEnabled !== false,
    quizStats: sanitizeQuizStats(g.quizStats),
    cameraPreset: g.cameraPreset || 'iso',
    status: g.status || 'playing',
    turn: g.turn || 'w',
    moveCount: Array.isArray(g.moves) ? g.moves.length : 0,
    moves: Array.isArray(g.moves) ? g.moves : [],
    savedAt: g.savedAt,
  };
}

// ============================================================================
// 3. ROUTEUR EXPRESS /api/games/*
// ============================================================================

export function createGamesRouter() {
  const router = express.Router();

  router.use(requireAuth);

  router.get('/', async (/** @type {any} */ req, res) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentification requise.' });
        return;
      }

      const games = await loadGames();
      const userGames = games
        .filter((g) => g.userId === userId)
        .sort((a, b) => Date.parse(b.savedAt || '') - Date.parse(a.savedAt || ''))
        .map(toPublicGame);

      res.json({ games: userGames });
    } catch (err) {
      console.error('Erreur chargement parties sauvegardées:', err);
      res.status(500).json({ error: 'Impossible de charger vos parties sauvegardées.' });
    }
  });

  router.post('/', async (/** @type {any} */ req, res) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentification requise.' });
        return;
      }

      const validation = validateSavedGamePayload(req.body);
      if ('error' in validation) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const existingId =
        typeof req.body?.id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(req.body.id)
          ? req.body.id
          : null;

      /** @type {any} */
      let savedRecord = null;

      await saveGamesSerialized((games) => {
        const nowIso = new Date().toISOString();
        if (existingId) {
          const existing = games.find((g) => g.id === existingId && g.userId === userId);
          if (existing) {
            Object.assign(existing, validation.data, { savedAt: nowIso });
            savedRecord = existing;
            return;
          }
        }

        savedRecord = {
          id: crypto.randomUUID(),
          userId,
          ...validation.data,
          savedAt: nowIso,
        };
        games.push(savedRecord);

        // Conserver au maximum MAX_GAMES_PER_USER parties par joueur (les plus récentes)
        const userEntries = games
          .filter((g) => g.userId === userId)
          .sort((a, b) => Date.parse(b.savedAt || '') - Date.parse(a.savedAt || ''));

        if (userEntries.length > MAX_GAMES_PER_USER) {
          const dropIds = new Set(userEntries.slice(MAX_GAMES_PER_USER).map((g) => g.id));
          for (let i = games.length - 1; i >= 0; i--) {
            if (games[i].userId === userId && dropIds.has(games[i].id)) {
              games.splice(i, 1);
            }
          }
        }
      });

      if (!savedRecord) {
        res.status(500).json({ error: 'Impossible de sauvegarder la partie.' });
        return;
      }

      res.status(201).json({ game: toPublicGame(savedRecord) });
    } catch (err) {
      console.error('Erreur sauvegarde partie:', err);
      res.status(500).json({ error: 'Erreur serveur lors de la sauvegarde.' });
    }
  });

  router.delete('/:id', async (/** @type {any} */ req, res) => {
    try {
      const userId = req.authUser?.id;
      const gameId = req.params?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentification requise.' });
        return;
      }
      if (typeof gameId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(gameId)) {
        res.status(400).json({ error: 'Identifiant de sauvegarde invalide.' });
        return;
      }

      let deleted = false;
      await saveGamesSerialized((games) => {
        const idx = games.findIndex((g) => g.id === gameId && g.userId === userId);
        if (idx !== -1) {
          games.splice(idx, 1);
          deleted = true;
        }
      });

      if (!deleted) {
        res.status(404).json({ error: 'Sauvegarde introuvable.' });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('Erreur suppression partie:', err);
      res.status(500).json({ error: 'Erreur serveur lors de la suppression.' });
    }
  });

  return router;
}
