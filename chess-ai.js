/**
 * Intelligence Artificielle d'échecs à 3 niveaux :
 * - Niveau 1 : Initié (recherche 1-ply avec bonus captures/promotions + aléa tactique)
 * - Niveau 2 : Centurion (Minimax profondeur 3, Alpha-Bêta, MVV-LVA, Piece-Square Tables)
 * - Niveau 3 : Empereur (Minimax profondeur 4, Alpha-Bêta, MVV-LVA, Quiescence, sécurité du Roi & contrôle du centre)
 */

import { COLORS, oppositeColor, squareToAlgebraic } from './chess-engine.js';

export const AI_LEVELS = {
  1: {
    id: 1,
    name: 'Initié',
    label: 'Initié (Niveau 1)',
    description: 'Tactique instinctive favorisant les prises directes avec une part d’imprévisibilité.',
  },
  2: {
    id: 2,
    name: 'Centurion',
    label: 'Centurion (Niveau 2)',
    description: 'Calcul discipliné à 3 demi-coups avec ordonnancement MVV-LVA et tables positionnelles.',
  },
  3: {
    id: 3,
    name: 'Empereur',
    label: 'Empereur (Niveau 3)',
    description: 'Stratège impitoyable à 4 demi-coups, recherche de quiescence, contrôle du centre et sécurité royale.',
  },
};

const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-Square Tables du point de vue des Blancs (row 0 = rangée 8, row 7 = rangée 1)
const PST_PAWN = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [12, 14, 22, 30, 30, 22, 14, 12],
  [6, 8, 14, 28, 28, 14, 8, 6],
  [2, 4, 8, 24, 24, 8, 4, 2],
  [4, -4, -8, 0, 0, -8, -4, 4],
  [5, 10, 10, -22, -22, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

const PST_KNIGHT = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 4, 4, 0, -20, -40],
  [-30, 4, 14, 18, 18, 14, 4, -30],
  [-30, 6, 18, 24, 24, 18, 6, -30],
  [-30, 2, 18, 24, 24, 18, 2, -30],
  [-30, 6, 14, 18, 18, 14, 6, -30],
  [-40, -20, 0, 6, 6, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50],
];

const PST_BISHOP = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 4, 0, 0, 0, 0, 4, -10],
  [-10, 8, 10, 14, 14, 10, 8, -10],
  [-10, 4, 10, 14, 14, 10, 4, -10],
  [-10, 6, 10, 14, 14, 10, 6, -10],
  [-10, 12, 10, 10, 10, 10, 12, -10],
  [-10, 6, 0, 0, 0, 0, 6, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20],
];

const PST_ROOK = [
  [0, 0, 0, 2, 2, 0, 0, 0],
  [8, 14, 14, 14, 14, 14, 14, 8],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [0, 0, 4, 8, 8, 4, 0, 0],
];

const PST_QUEEN = [
  [-20, -10, -10, -5, -5, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 6, 6, 6, 6, 0, -10],
  [-5, 0, 6, 8, 8, 6, 0, -5],
  [0, 0, 6, 8, 8, 6, 0, -5],
  [-10, 5, 6, 6, 6, 6, 0, -10],
  [-10, 0, 5, 0, 0, 0, 0, -10],
  [-20, -10, -10, -5, -5, -10, -10, -20],
];

const PST_KING_MID = [
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-10, -20, -20, -20, -20, -20, -20, -10],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [20, 34, 12, 0, 0, 12, 34, 20],
];

const PST_KING_END = [
  [-50, -40, -30, -20, -20, -30, -40, -50],
  [-30, -20, -10, 0, 0, -10, -20, -30],
  [-30, -10, 20, 30, 30, 20, -10, -30],
  [-30, -10, 30, 40, 40, 30, -10, -30],
  [-30, -10, 30, 40, 40, 30, -10, -30],
  [-30, -10, 20, 30, 30, 20, -10, -30],
  [-30, -30, 0, 0, 0, 0, -30, -30],
  [-50, -30, -30, -30, -30, -30, -30, -50],
];

function getPstValue(type, color, row, col, isEndgame) {
  const r = color === COLORS.WHITE ? row : 7 - row;
  switch (type) {
    case 'p': return PST_PAWN[r][col];
    case 'n': return PST_KNIGHT[r][col];
    case 'b': return PST_BISHOP[r][col];
    case 'r': return PST_ROOK[r][col];
    case 'q': return PST_QUEEN[r][col];
    case 'k': return isEndgame ? PST_KING_END[r][col] : PST_KING_MID[r][col];
    default: return 0;
  }
}

/**
 * Représentation légère interne pour une recherche rapide sans allouer d'objets complexes.
 */
function snapshotSearchState(engine) {
  return {
    board: engine.board.map((row) => row.map((p) => (p ? { type: p.type, color: p.color } : null))),
    castlingRights: { ...engine.castlingRights },
    enPassantTarget: engine.enPassantTarget ? { ...engine.enPassantTarget } : null,
  };
}

function findKingFast(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color) return { row: r, col: c };
    }
  }
  return null;
}

function isAttackedFast(board, targetRow, targetCol, attackerColor) {
  const pawnDir = attackerColor === COLORS.WHITE ? 1 : -1;
  const pr = targetRow + pawnDir;
  if (pr >= 0 && pr < 8) {
    if (targetCol > 0) {
      const p = board[pr][targetCol - 1];
      if (p && p.color === attackerColor && p.type === 'p') return true;
    }
    if (targetCol < 7) {
      const p = board[pr][targetCol + 1];
      if (p && p.color === attackerColor && p.type === 'p') return true;
    }
  }

  const kd = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  for (let i = 0; i < 8; i++) {
    const r = targetRow + kd[i][0];
    const c = targetCol + kd[i][1];
    if (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const p = board[r][c];
      if (p && p.color === attackerColor && p.type === 'n') return true;
    }
  }

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = targetRow + dr;
      const c = targetCol + dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = board[r][c];
        if (p && p.color === attackerColor && p.type === 'k') return true;
      }
    }
  }

  const ortho = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let i = 0; i < 4; i++) {
    let r = targetRow + ortho[i][0];
    let c = targetCol + ortho[i][1];
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const p = board[r][c];
      if (p) {
        if (p.color === attackerColor && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
      r += ortho[i][0];
      c += ortho[i][1];
    }
  }

  const diag = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (let i = 0; i < 4; i++) {
    let r = targetRow + diag[i][0];
    let c = targetCol + diag[i][1];
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const p = board[r][c];
      if (p) {
        if (p.color === attackerColor && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
      r += diag[i][0];
      c += diag[i][1];
    }
  }

  return false;
}

function generateLegalMovesFast(state, color) {
  const { board, castlingRights, enPassantTarget } = state;
  const enemy = oppositeColor(color);
  const pseudo = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;

      if (piece.type === 'p') {
        const dir = color === COLORS.WHITE ? -1 : 1;
        const startRow = color === COLORS.WHITE ? 6 : 1;
        const promoRow = color === COLORS.WHITE ? 0 : 7;
        const r1 = r + dir;
        if (r1 >= 0 && r1 < 8 && !board[r1][c]) {
          if (r1 === promoRow) {
            pseudo.push({ fromRow: r, fromCol: c, toRow: r1, toCol: c, promotion: 'q' });
            pseudo.push({ fromRow: r, fromCol: c, toRow: r1, toCol: c, promotion: 'n' });
          } else {
            pseudo.push({ fromRow: r, fromCol: c, toRow: r1, toCol: c });
            const r2 = r + dir * 2;
            if (r === startRow && !board[r2][c]) {
              pseudo.push({ fromRow: r, fromCol: c, toRow: r2, toCol: c, isDoublePawnPush: true });
            }
          }
        }
        for (const dc of [-1, 1]) {
          const tc = c + dc;
          if (tc < 0 || tc > 7 || r1 < 0 || r1 > 7) continue;
          const target = board[r1][tc];
          if (target && target.color === enemy) {
            if (r1 === promoRow) {
              pseudo.push({ fromRow: r, fromCol: c, toRow: r1, toCol: tc, captureType: target.type, promotion: 'q' });
              pseudo.push({ fromRow: r, fromCol: c, toRow: r1, toCol: tc, captureType: target.type, promotion: 'n' });
            } else {
              pseudo.push({ fromRow: r, fromCol: c, toRow: r1, toCol: tc, captureType: target.type });
            }
          } else if (enPassantTarget && enPassantTarget.row === r1 && enPassantTarget.col === tc) {
            const ep = board[r][tc];
            if (ep && ep.color === enemy && ep.type === 'p') {
              pseudo.push({ fromRow: r, fromCol: c, toRow: r1, toCol: tc, captureType: 'p', isEnPassant: true });
            }
          }
        }
      } else if (piece.type === 'n') {
        const kd = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        for (let i = 0; i < 8; i++) {
          const tr = r + kd[i][0];
          const tc = c + kd[i][1];
          if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
          const t = board[tr][tc];
          if (!t || t.color === enemy) {
            pseudo.push({ fromRow: r, fromCol: c, toRow: tr, toCol: tc, captureType: t ? t.type : null });
          }
        }
      } else if (piece.type === 'b' || piece.type === 'r' || piece.type === 'q') {
        const dirs =
          piece.type === 'b'
            ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
            : piece.type === 'r'
            ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
            : [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let i = 0; i < dirs.length; i++) {
          let tr = r + dirs[i][0];
          let tc = c + dirs[i][1];
          while (tr >= 0 && tr < 8 && tc >= 0 && tc < 8) {
            const t = board[tr][tc];
            if (!t) {
              pseudo.push({ fromRow: r, fromCol: c, toRow: tr, toCol: tc });
            } else {
              if (t.color === enemy) {
                pseudo.push({ fromRow: r, fromCol: c, toRow: tr, toCol: tc, captureType: t.type });
              }
              break;
            }
            tr += dirs[i][0];
            tc += dirs[i][1];
          }
        }
      } else if (piece.type === 'k') {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const tr = r + dr;
            const tc = c + dc;
            if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
            const t = board[tr][tc];
            if (!t || t.color === enemy) {
              pseudo.push({ fromRow: r, fromCol: c, toRow: tr, toCol: tc, captureType: t ? t.type : null });
            }
          }
        }
        const homeRow = color === COLORS.WHITE ? 7 : 0;
        if (r === homeRow && c === 4 && !isAttackedFast(board, homeRow, 4, enemy)) {
          const kRight = color === COLORS.WHITE ? castlingRights.wK : castlingRights.bK;
          const qRight = color === COLORS.WHITE ? castlingRights.wQ : castlingRights.bQ;
          if (
            kRight &&
            !board[homeRow][5] &&
            !board[homeRow][6] &&
            board[homeRow][7]?.type === 'r' &&
            board[homeRow][7]?.color === color &&
            !isAttackedFast(board, homeRow, 5, enemy) &&
            !isAttackedFast(board, homeRow, 6, enemy)
          ) {
            pseudo.push({ fromRow: homeRow, fromCol: 4, toRow: homeRow, toCol: 6, isCastle: 'K' });
          }
          if (
            qRight &&
            !board[homeRow][3] &&
            !board[homeRow][2] &&
            !board[homeRow][1] &&
            board[homeRow][0]?.type === 'r' &&
            board[homeRow][0]?.color === color &&
            !isAttackedFast(board, homeRow, 3, enemy) &&
            !isAttackedFast(board, homeRow, 2, enemy)
          ) {
            pseudo.push({ fromRow: homeRow, fromCol: 4, toRow: homeRow, toCol: 2, isCastle: 'Q' });
          }
        }
      }
    }
  }

  // Filtrage légalité avec make/unmake sur place
  const legal = [];
  for (let i = 0; i < pseudo.length; i++) {
    const m = pseudo[i];
    const moving = board[m.fromRow][m.fromCol];
    const dest = board[m.toRow][m.toCol];
    let epCap = null;

    board[m.fromRow][m.fromCol] = null;
    if (m.isEnPassant) {
      epCap = board[m.fromRow][m.toCol];
      board[m.fromRow][m.toCol] = null;
    }
    board[m.toRow][m.toCol] = m.promotion ? { type: m.promotion, color: moving.color } : moving;

    if (m.isCastle === 'K') {
      board[m.toRow][5] = board[m.toRow][7];
      board[m.toRow][7] = null;
    } else if (m.isCastle === 'Q') {
      board[m.toRow][3] = board[m.toRow][0];
      board[m.toRow][0] = null;
    }

    const kingPos = findKingFast(board, color);
    const safe = kingPos && !isAttackedFast(board, kingPos.row, kingPos.col, enemy);
    if (safe) legal.push(m);

    // Unmake
    if (m.isCastle === 'K') {
      board[m.toRow][7] = board[m.toRow][5];
      board[m.toRow][5] = null;
    } else if (m.isCastle === 'Q') {
      board[m.toRow][0] = board[m.toRow][3];
      board[m.toRow][3] = null;
    }
    board[m.fromRow][m.fromCol] = moving;
    board[m.toRow][m.toCol] = dest;
    if (m.isEnPassant) {
      board[m.fromRow][m.toCol] = epCap;
    }
  }

  return legal;
}

function makeMoveFast(state, move) {
  const { board, castlingRights, enPassantTarget } = state;
  const moving = board[move.fromRow][move.fromCol];
  const captured = board[move.toRow][move.toCol];
  let epCaptured = null;

  const undoData = {
    moving,
    captured,
    epCaptured,
    prevCastling: { ...castlingRights },
    prevEnPassant: enPassantTarget,
  };

  board[move.fromRow][move.fromCol] = null;
  if (move.isEnPassant) {
    undoData.epCaptured = board[move.fromRow][move.toCol];
    board[move.fromRow][move.toCol] = null;
  }
  board[move.toRow][move.toCol] = move.promotion ? { type: move.promotion, color: moving.color } : moving;

  if (move.isCastle === 'K') {
    board[move.toRow][5] = board[move.toRow][7];
    board[move.toRow][7] = null;
  } else if (move.isCastle === 'Q') {
    board[move.toRow][3] = board[move.toRow][0];
    board[move.toRow][0] = null;
  }

  if (moving.type === 'k') {
    if (moving.color === COLORS.WHITE) {
      castlingRights.wK = false;
      castlingRights.wQ = false;
    } else {
      castlingRights.bK = false;
      castlingRights.bQ = false;
    }
  }
  if (moving.type === 'r') {
    if (move.fromRow === 7 && move.fromCol === 0) castlingRights.wQ = false;
    if (move.fromRow === 7 && move.fromCol === 7) castlingRights.wK = false;
    if (move.fromRow === 0 && move.fromCol === 0) castlingRights.bQ = false;
    if (move.fromRow === 0 && move.fromCol === 7) castlingRights.bK = false;
  }

  state.enPassantTarget = move.isDoublePawnPush
    ? { row: move.fromRow + (moving.color === COLORS.WHITE ? -1 : 1), col: move.fromCol }
    : null;

  return undoData;
}

function unmakeMoveFast(state, move, undoData) {
  const { board } = state;
  if (move.isCastle === 'K') {
    board[move.toRow][7] = board[move.toRow][5];
    board[move.toRow][5] = null;
  } else if (move.isCastle === 'Q') {
    board[move.toRow][0] = board[move.toRow][3];
    board[move.toRow][3] = null;
  }
  board[move.fromRow][move.fromCol] = undoData.moving;
  board[move.toRow][move.toCol] = undoData.captured;
  if (move.isEnPassant) {
    board[move.fromRow][move.toCol] = undoData.epCaptured;
  }
  state.castlingRights = undoData.prevCastling;
  state.enPassantTarget = undoData.prevEnPassant;
}

/**
 * Ordonnancement MVV-LVA + promotions + roques pour optimiser l'élagage Alpha-Bêta.
 */
function scoreMoveOrder(board, move) {
  let score = 0;
  if (move.captureType) {
    const attacker = board[move.fromRow][move.fromCol];
    score += 10000 + PIECE_VALUES[move.captureType] * 10 - (attacker ? PIECE_VALUES[attacker.type] : 0);
  }
  if (move.promotion) {
    score += 9000 + PIECE_VALUES[move.promotion];
  }
  if (move.isCastle) {
    score += 400;
  }
  // Léger bonus pour le contrôle du centre
  const dr = Math.abs(move.toRow - 3.5);
  const dc = Math.abs(move.toCol - 3.5);
  score += Math.round((5 - (dr + dc)) * 6);
  return score;
}

function orderMoves(board, moves) {
  moves.sort((a, b) => scoreMoveOrder(board, b) - scoreMoveOrder(board, a));
  return moves;
}

/**
 * Évaluation statique du plateau du point de vue de `perspectiveColor`.
 * Niveau 3 (Empereur) active la sécurité du roi et le contrôle avancé du centre.
 */
function evaluateBoard(board, perspectiveColor, level) {
  let whiteMaterial = 0;
  let blackMaterial = 0;
  let whiteScore = 0;
  let blackScore = 0;
  let whiteBishops = 0;
  let blackBishops = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.type === 'k') continue;
      const val = PIECE_VALUES[p.type];
      if (p.color === COLORS.WHITE) {
        whiteMaterial += val;
        if (p.type === 'b') whiteBishops++;
      } else {
        blackMaterial += val;
        if (p.type === 'b') blackBishops++;
      }
    }
  }

  const isEndgame = whiteMaterial < 1350 && blackMaterial < 1350;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const val = PIECE_VALUES[p.type] + getPstValue(p.type, p.color, r, c, isEndgame);

      let extra = 0;
      if (level >= 3) {
        // Contrôle du centre (d4, d5, e4, e5 et couronne centrale)
        if ((r === 3 || r === 4) && (c === 3 || c === 4)) {
          extra += p.type === 'p' ? 24 : 18;
        } else if (r >= 2 && r <= 5 && c >= 2 && c <= 5 && p.type !== 'k') {
          extra += 6;
        }

        // Sécurité du Roi : bouclier de pions devant le roi roqué en milieu de partie
        if (p.type === 'k' && !isEndgame) {
          const shieldRow = p.color === COLORS.WHITE ? r - 1 : r + 1;
          if (shieldRow >= 0 && shieldRow < 8) {
            for (let dc = -1; dc <= 1; dc++) {
              const sc = c + dc;
              if (sc >= 0 && sc < 8) {
                const sp = board[shieldRow][sc];
                if (sp && sp.color === p.color && sp.type === 'p') {
                  extra += 16;
                }
              }
            }
          }
          // Pénalité roi exposé au centre en milieu de jeu
          if (c >= 2 && c <= 5) extra -= 26;
        }
      }

      if (p.color === COLORS.WHITE) whiteScore += val + extra;
      else blackScore += val + extra;
    }
  }

  if (whiteBishops >= 2) whiteScore += 32;
  if (blackBishops >= 2) blackScore += 32;

  const diff = whiteScore - blackScore;
  return perspectiveColor === COLORS.WHITE ? diff : -diff;
}

function quiescence(state, colorToMove, alpha, beta, perspectiveColor, level, qDepth) {
  const standPat =
    evaluateBoard(state.board, perspectiveColor, level) *
    (colorToMove === perspectiveColor ? 1 : -1);
  if (qDepth <= 0) return standPat;
  if (standPat >= beta) return standPat;

  let best = standPat;
  if (alpha < standPat) alpha = standPat;

  const legal = generateLegalMovesFast(state, colorToMove).filter(
    (m) => m.captureType || m.promotion
  );
  if (legal.length === 0) return standPat;
  orderMoves(state.board, legal);

  const nextColor = oppositeColor(colorToMove);
  for (let i = 0; i < legal.length; i++) {
    const move = legal[i];
    const undo = makeMoveFast(state, move);
    const score = -quiescence(
      state,
      nextColor,
      -beta,
      -alpha,
      perspectiveColor,
      level,
      qDepth - 1
    );
    unmakeMoveFast(state, move, undo);

    if (score >= beta) return score;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
  }
  return best;
}

function negamax(state, depth, alpha, beta, colorToMove, perspectiveColor, level, ply) {
  const legal = generateLegalMovesFast(state, colorToMove);

  if (legal.length === 0) {
    const king = findKingFast(state.board, colorToMove);
    const inCheck = king && isAttackedFast(state.board, king.row, king.col, oppositeColor(colorToMove));
    if (inCheck) {
      return -100000 + ply * 50; // Préférer mater le plus vite possible
    }
    return 0; // Pat
  }

  if (depth <= 0) {
    if (level >= 3) {
      return quiescence(state, colorToMove, alpha, beta, perspectiveColor, level, 3);
    }
    const raw = evaluateBoard(state.board, perspectiveColor, level);
    return colorToMove === perspectiveColor ? raw : -raw;
  }

  orderMoves(state.board, legal);
  const nextColor = oppositeColor(colorToMove);
  let best = -Infinity;

  for (let i = 0; i < legal.length; i++) {
    const move = legal[i];
    const undo = makeMoveFast(state, move);
    const score = -negamax(state, depth - 1, -beta, -alpha, nextColor, perspectiveColor, level, ply + 1);
    unmakeMoveFast(state, move, undo);

    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

function yieldFrame() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function findBestAIMove(engine, level = 2) {
  const aiColor = engine.turn;
  const state = snapshotSearchState(engine);
  const legal = generateLegalMovesFast(state, aiColor);
  if (legal.length === 0) return null;

  orderMoves(state.board, legal);

  // Niveau 1 : Initié — 1-ply favorisant captures et promotions avec aléa tactique
  if (level === 1) {
    await new Promise((r) => setTimeout(r, 260));
    const enemy = oppositeColor(aiColor);
    const scored = legal.map((move) => {
      const undo = makeMoveFast(state, move);
      let score = evaluateBoard(state.board, aiColor, 1);
      if (move.captureType) score += 55;
      if (move.promotion) score += 160;
      const enemyKing = findKingFast(state.board, enemy);
      if (enemyKing && isAttackedFast(state.board, enemyKing.row, enemyKing.col, aiColor)) {
        score += 35;
      }
      unmakeMoveFast(state, move, undo);
      score += (Math.random() - 0.5) * 48;
      return { move, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const poolSize = Math.min(3, scored.length);
    const chosen = scored[Math.floor(Math.random() * poolSize * 0.65)];
    return chosen.move;
  }

  // Niveau 2 : Centurion (profondeur 3) | Niveau 3 : Empereur (profondeur 4)
  const targetDepth = level === 2 ? 3 : 4;
  const enemy = oppositeColor(aiColor);

  // Délai initial minimal pour que l'indicateur visuel apparaisse proprement
  await new Promise((r) => setTimeout(r, 120));

  let bestMove = legal[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  const startTime = performance.now();
  const maxBudgetMs = level === 3 ? 1800 : 900;

  for (let i = 0; i < legal.length; i++) {
    const move = legal[i];
    const undo = makeMoveFast(state, move);
    const elapsed = performance.now() - startTime;
    // Sécurité temporelle si la position est extrêmement ramifiée
    const effectiveDepth = elapsed > maxBudgetMs && level === 3 ? 2 : targetDepth - 1;

    const score = -negamax(
      state,
      effectiveDepth,
      -beta,
      -alpha,
      enemy,
      aiColor,
      level,
      1
    );
    unmakeMoveFast(state, move, undo);

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) {
      alpha = score;
    }

    // Rendre la main au navigateur toutes les 3 branches pour maintenir 60 FPS
    if (i % 3 === 2) {
      await yieldFrame();
    }
  }

  return bestMove;
}

// ============================================================================
// MODE APPRENTISSAGE : ANALYSE PÉDAGOGIQUE & CONSEILS STRATÉGIQUES
// ============================================================================

export const PIECE_LEARNING_TIPS = {
  p: 'Légionnaire (Pion) : avance d’1 case (ou 2 depuis le départ), capture en diagonale. Prise en passant possible juste après un double pas adverse, et promotion en 8e rangée.',
  n: 'Cheval (Cavalier) : saute par-dessus les pièces en « L » (2+1). Redoutable au centre pour créer des fourchettes attaquant deux pièces à la fois.',
  b: 'Philosophe (Fou) : glisse en diagonale sur les cases d’une même couleur. La paire de Fous domine les positions ouvertes.',
  r: 'Colonne (Tour) : glisse en ligne droite (rangs et colonnes). Placez-la sur des colonnes ouvertes et utilisez le roque pour la relier au combat.',
  q: 'Déesse (Dame) : pièce la plus puissante, combinant Tour et Fou. Évitez de la sortir trop tôt au risque d’être chassé par les pièces mineures.',
  k: 'Empereur (Roi) : se déplace d’1 case dans toute direction. En ouverture, mettez-le à l’abri via le roque ; en finale, faites-le participer au centre.',
};

const PIECE_SHORT_FR = {
  p: 'Pion',
  n: 'Cavalier',
  b: 'Fou',
  r: 'Tour',
  q: 'Dame',
  k: 'Roi',
};

function detectAttackedFriendlyPieces(board, color) {
  const enemy = oppositeColor(color);
  const threatened = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== color || p.type === 'k' || p.type === 'p') continue;
      if (isAttackedFast(board, r, c, enemy)) {
        const defended = isAttackedFast(board, r, c, color);
        threatened.push({
          type: p.type,
          row: r,
          col: c,
          sq: squareToAlgebraic(r, c),
          value: PIECE_VALUES[p.type],
          defended,
        });
      }
    }
  }
  threatened.sort((a, b) => b.value - a.value);
  return threatened;
}

function getGamePhaseLabel(board, fullMoveNumber) {
  let nonKingMaterial = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type !== 'k' && p.type !== 'p') {
        nonKingMaterial += PIECE_VALUES[p.type];
      }
    }
  }
  if (fullMoveNumber <= 8 && nonKingMaterial >= 4800) return 'Ouverture';
  if (nonKingMaterial <= 2600) return 'Finale';
  return 'Milieu de jeu';
}

function formatMoveLabelFr(board, move) {
  if (move.isCastle === 'K') return 'Petit roque (O-O)';
  if (move.isCastle === 'Q') return 'Grand roque (O-O-O)';
  const p = board[move.fromRow][move.fromCol];
  const name = p ? PIECE_SHORT_FR[p.type] : 'Pièce';
  const from = squareToAlgebraic(move.fromRow, move.fromCol);
  const to = squareToAlgebraic(move.toRow, move.toCol);
  const action = move.captureType ? 'prend' : '→';
  const promo = move.promotion ? ` (= ${PIECE_SHORT_FR[move.promotion]})` : '';
  return `${name} ${from} ${action} ${to}${promo}`;
}

export function getPhaseStrategyTips(phase) {
  if (phase === 'Ouverture') {
    return {
      title: 'Principes de l’Ouverture',
      tips: [
        'Contrôlez le centre (cases d4, d5, e4, e5) avec vos pions et vos pièces légères.',
        'Développez vos Cavaliers et vos Fous avant de sortir la Dame trop tôt.',
        'Mettez rapidement votre Roi à l’abri grâce au roque (petit ou grand roque) et reliez vos Tours.',
      ],
    };
  }
  if (phase === 'Finale') {
    return {
      title: 'Principes de la Finale',
      tips: [
        'Activez votre Roi : en finale, l’Empereur devient une pièce d’attaque et de soutien centrale.',
        'Créez et poussez un pion passé vers la 8e rangée pour forcer la promotion.',
        'Placez vos Tours derrière les pions passés (les vôtres ou ceux de l’adversaire).',
      ],
    };
  }
  return {
    title: 'Principes du Milieu de jeu',
    tips: [
      'Coordonnez vos pièces vers des objectifs communs (attaque sur le Roi ou faiblesse de pions).',
      'Placez vos Tours sur les colonnes ouvertes ou semi-ouvertes pour dominer le terrain.',
      'Surveillez les motifs tactiques : fourchettes de Cavalier, clouages de Fou/Tour et pièces non défendues.',
    ],
  };
}

function describeEvaluationMeaning(whiteAdvantageCp, turnColor) {
  if (Math.abs(whiteAdvantageCp) > 50000) {
    return whiteAdvantageCp > 0
      ? 'Les Blancs (Marbre) disposent d’un mat forcé.'
      : 'Les Noirs (Bronze) disposent d’un mat forcé.';
  }
  const absPawns = Math.abs(whiteAdvantageCp) / 100;
  if (absPawns < 0.35) {
    return 'La position est globalement équilibrée : aucun camp n’a encore pris d’avantage décisif.';
  }
  const leader = whiteAdvantageCp > 0 ? 'les Blancs (Marbre)' : 'les Noirs (Bronze)';
  const yourSide =
    (whiteAdvantageCp > 0 && turnColor === COLORS.WHITE) ||
    (whiteAdvantageCp < 0 && turnColor === COLORS.BLACK);
  const strength =
    absPawns >= 3
      ? 'un avantage décisif'
      : absPawns >= 1.2
        ? 'un net avantage'
        : 'un léger avantage';
  return `Score de ${whiteAdvantageCp >= 0 ? '+' : ''}${(whiteAdvantageCp / 100).toFixed(1)} pion(s) : ${leader} possèdent ${strength}${yourSide ? ' en votre faveur' : ''}.`;
}

function buildDetailedAnalysis(state, bestMove, bestScore, inCheckBefore, threatsBefore, phase, scoredMoves) {
  const board = state.board;
  const moving = board[bestMove.fromRow][bestMove.fromCol];
  const color = moving.color;
  const enemy = oppositeColor(color);
  const fromSq = squareToAlgebraic(bestMove.fromRow, bestMove.fromCol);
  const toSq = squareToAlgebraic(bestMove.toRow, bestMove.toCol);
  const movingName = PIECE_SHORT_FR[moving.type] || 'Pièce';

  let objectiveTitle = 'Amélioration positionnelle';
  if (bestScore > 90000) objectiveTitle = 'Échec et mat forcé';
  else if (inCheckBefore) objectiveTitle = 'Parade de l’échec';
  else if (bestMove.promotion) objectiveTitle = 'Promotion décisive';
  else if (bestMove.isCastle) objectiveTitle = 'Mise à l’abri du Roi (Roque)';
  else if (bestMove.captureType) objectiveTitle = 'Gain matériel et pression';
  else if (threatsBefore.some((t) => t.row === bestMove.fromRow && t.col === bestMove.fromCol)) {
    objectiveTitle = 'Sauvetage d’une pièce menacée';
  } else if ((bestMove.toRow === 3 || bestMove.toRow === 4) && (bestMove.toCol === 3 || bestMove.toCol === 4)) {
    objectiveTitle = 'Contrôle stratégique du centre';
  } else if (phase === 'Ouverture' && (moving.type === 'n' || moving.type === 'b')) {
    objectiveTitle = 'Développement des pièces légères';
  }

  const tacticalBreakdown = [];

  if (inCheckBefore) {
    tacticalBreakdown.push(
      'Votre Roi est actuellement attaqué : ce coup répond directement à l’échec tout en préservant l’équilibre de votre défense.'
    );
  }

  if (bestMove.isCastle) {
    tacticalBreakdown.push(
      'Le roque met l’Empereur en sécurité derrière son bouclier de pions et active immédiatement la Tour vers le centre.'
    );
  } else if (bestMove.promotion) {
    tacticalBreakdown.push(
      `En atteignant ${toSq}, votre Pion est promu en ${PIECE_SHORT_FR[bestMove.promotion]}, augmentant massivement votre puissance de frappe.`
    );
  } else if (bestMove.captureType) {
    const capName = PIECE_SHORT_FR[bestMove.captureType];
    const capPts = Math.round(PIECE_VALUES[bestMove.captureType] / 100);
    tacticalBreakdown.push(
      `Vous capturez un ${capName} adverse en ${toSq} (valeur ≈ ${capPts} point${capPts > 1 ? 's' : ''}), ce qui affaiblit la structure ennemie.`
    );
  } else {
    tacticalBreakdown.push(
      `Déplacer le ${movingName} de ${fromSq} vers ${toSq} améliore son rayon d’action et libère la coordination de vos autres pièces.`
    );
  }

  const rescued = threatsBefore.find((t) => t.row === bestMove.fromRow && t.col === bestMove.fromCol);
  if (rescued) {
    tacticalBreakdown.push(
      `Votre ${PIECE_SHORT_FR[rescued.type]} en ${rescued.sq} était sous le feu adverse : ce déplacement le sort de la zone de danger.`
    );
  }

  // Simuler le coup pour observer l'état tactique après exécution
  const undo = makeMoveFast(state, bestMove);
  const enemyKing = findKingFast(state.board, enemy);
  const givesCheck = enemyKing && isAttackedFast(state.board, enemyKing.row, enemyKing.col, color);
  if (givesCheck) {
    tacticalBreakdown.push(
      'Ce coup donne immédiatement échec au Roi adverse, le forçant à réagir et vous laissant l’initiative.'
    );
  }

  const destAttacked = isAttackedFast(state.board, bestMove.toRow, bestMove.toCol, enemy);
  const destDefended = isAttackedFast(state.board, bestMove.toRow, bestMove.toCol, color);
  if (destAttacked && destDefended) {
    tacticalBreakdown.push(
      `La case ${toSq} est disputée, mais votre pièce y est solidement soutenue par vos propres forces.`
    );
  } else if (!destAttacked && !bestMove.isCastle) {
    tacticalBreakdown.push(
      `Sur ${toSq}, votre ${movingName} occupe une case sûre qui n’est contrôlée par aucune pièce ennemie.`
    );
  }

  // Vérifier si de nouvelles pièces adverses sont attaquées après le coup
  const attackedTargets = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const target = state.board[r][c];
      if (!target || target.color !== enemy || target.type === 'k' || target.type === 'p') continue;
      if (isAttackedFast(state.board, r, c, color)) {
        attackedTargets.push(`${PIECE_SHORT_FR[target.type]} en ${squareToAlgebraic(r, c)}`);
      }
    }
  }
  if (attackedTargets.length > 0 && !bestMove.captureType) {
    tacticalBreakdown.push(
      `Pression offensive : après ce coup, vous menacez ${attackedTargets.slice(0, 2).join(' et ')}.`
    );
  }

  unmakeMoveFast(state, bestMove, undo);

  if (
    (bestMove.toRow === 3 || bestMove.toRow === 4) &&
    (bestMove.toCol === 3 || bestMove.toCol === 4)
  ) {
    tacticalBreakdown.push(
      'En occupant le cœur du plateau (d4, d5, e4, e5), vous restreignez la mobilité des pièces adverses.'
    );
  }

  const candidates = scoredMoves.slice(0, 3).map((entry, idx) => ({
    rank: idx + 1,
    label: formatMoveLabelFr(board, entry.move),
    scoreCp: entry.score,
    whiteScoreCp: color === COLORS.WHITE ? entry.score : -entry.score,
    deltaCp: Math.max(0, bestScore - entry.score),
    isBest: idx === 0,
  }));

  return {
    objectiveTitle,
    evalExplanation: describeEvaluationMeaning(
      color === COLORS.WHITE ? bestScore : -bestScore,
      color
    ),
    tacticalBreakdown: tacticalBreakdown.slice(0, 4),
    candidates,
    phaseGuide: getPhaseStrategyTips(phase),
  };
}

function buildPedagogicalReason(state, move, bestScore, inCheckBefore, threatsBefore, phase) {
  const board = state.board;
  const moving = board[move.fromRow][move.fromCol];
  const enemy = oppositeColor(moving.color);

  if (bestScore > 90000) {
    return 'Coup décisif : cette manœuvre force un échec et mat imparable !';
  }
  if (inCheckBefore) {
    return 'Défense royale urgente : votre Empereur est en échec, parez la menace ou dégagez-le.';
  }
  if (move.promotion) {
    return 'Promotion impériale : transformez ce Légionnaire en Déesse pour obtenir un avantage décisif.';
  }
  if (move.isCastle) {
    return 'Sécurité royale : le roque met votre Empereur à l’abri derrière ses pions et active la Tour.';
  }

  // Vérifier si le coup met l'adversaire en échec
  const undo = makeMoveFast(state, move);
  const enemyKing = findKingFast(state.board, enemy);
  const givesCheck = enemyKing && isAttackedFast(state.board, enemyKing.row, enemyKing.col, moving.color);
  unmakeMoveFast(state, move, undo);

  if (move.captureType) {
    const capName = PIECE_SHORT_FR[move.captureType];
    if (move.isEnPassant) {
      return `Prise en passant : capturez le Pion adverse en ${squareToAlgebraic(move.toRow, move.toCol)} avant que l’opportunité ne disparaisse.`;
    }
    if (givesCheck) {
      return `Double gain tactique : capturez le ${capName} adverse en ${squareToAlgebraic(move.toRow, move.toCol)} tout en mettant le Roi en échec.`;
    }
    return `Gain matériel : capturez le ${capName} adverse en ${squareToAlgebraic(move.toRow, move.toCol)} pour prendre l’ascendant.`;
  }

  // Sauvetage d'une pièce menacée
  const rescued = threatsBefore.find((t) => t.row === move.fromRow && t.col === move.fromCol);
  if (rescued) {
    return `Pièce menacée : votre ${PIECE_SHORT_FR[rescued.type]} en ${rescued.sq} était attaqué — replacez-le sur une case sûre.`;
  }

  if (givesCheck) {
    return 'Initiative tactique : mettez l’Empereur adverse en échec pour contraindre sa défense.';
  }

  // Contrôle du centre (d4, d5, e4, e5)
  const isCenterTarget =
    (move.toRow === 3 || move.toRow === 4) && (move.toCol === 3 || move.toCol === 4);
  if (isCenterTarget) {
    return 'Contrôle du centre : occupez les cases centrales (d4, d5, e4, e5) pour libérer le déploiement de vos forces.';
  }

  // Développement depuis la rangée de départ en ouverture
  const homeRow = moving.color === COLORS.WHITE ? 7 : 0;
  if (
    phase === 'Ouverture' &&
    move.fromRow === homeRow &&
    (moving.type === 'n' || moving.type === 'b')
  ) {
    return `Développement en ouverture : sortez votre ${PIECE_SHORT_FR[moving.type]} de sa case initiale pour préparer le roque et contrôler le centre.`;
  }

  if (phase === 'Finale' && moving.type === 'k') {
    return 'Activité royale en finale : rapprochez votre Empereur du centre pour soutenir vos pions.';
  }

  return 'Amélioration positionnelle : coordonnez vos pièces vers des cases plus actives et renforcez votre structure.';
}

/**
 * Analyse rapide (profondeur 3 avec quiescence) pour le Mode Apprentissage.
 */
export async function analyzePositionForLearning(engine) {
  const color = engine.turn;
  const state = snapshotSearchState(engine);
  const legal = generateLegalMovesFast(state, color);
  if (legal.length === 0) return null;

  orderMoves(state.board, legal);
  const enemy = oppositeColor(color);
  const king = findKingFast(state.board, color);
  const inCheckBefore = !!(king && isAttackedFast(state.board, king.row, king.col, enemy));
  const threats = detectAttackedFriendlyPieces(state.board, color);
  const phase = getGamePhaseLabel(state.board, engine.fullMoveNumber);

  let bestMove = legal[0];
  let bestScore = -Infinity;
  const scoredMoves = [];

  for (let i = 0; i < legal.length; i++) {
    const move = legal[i];
    const undo = makeMoveFast(state, move);
    const score = -negamax(state, 2, -Infinity, Infinity, enemy, color, 3, 1);
    unmakeMoveFast(state, move, undo);

    scoredMoves.push({ move, score });
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (i % 4 === 3) await yieldFrame();
  }

  scoredMoves.sort((a, b) => b.score - a.score);

  const moveLabel = formatMoveLabelFr(state.board, bestMove);
  const reason = buildPedagogicalReason(state, bestMove, bestScore, inCheckBefore, threats, phase);
  const details = buildDetailedAnalysis(
    state,
    bestMove,
    bestScore,
    inCheckBefore,
    threats,
    phase,
    scoredMoves
  );

  // Score relatif du point de vue des Blancs pour affichage clair
  const whiteAdvantageCp = color === COLORS.WHITE ? bestScore : -bestScore;

  return {
    color,
    phase,
    bestMove,
    moveLabel,
    reason,
    bestScoreCp: bestScore,
    whiteAdvantageCp,
    threats,
    inCheckBefore,
    details,
  };
}

/**
 * Évalue la qualité du coup joué par le joueur par rapport à la recommandation.
 */
export async function evaluatePlayedMoveQuality(engineAfterMove, moveRecord, preAnalysis) {
  if (!preAnalysis || !moveRecord) return null;

  const moverColor = moveRecord.color;
  const sameAsRecommended =
    preAnalysis.bestMove.fromRow === moveRecord.fromRow &&
    preAnalysis.bestMove.fromCol === moveRecord.fromCol &&
    preAnalysis.bestMove.toRow === moveRecord.toRow &&
    preAnalysis.bestMove.toCol === moveRecord.toCol &&
    (preAnalysis.bestMove.promotion || null) === (moveRecord.promotion || null);

  if (sameAsRecommended) {
    return {
      grade: 'excellent',
      title: 'Coup optimal !',
      detail: `Vous avez trouvé la recommandation exacte (${moveRecord.san}).`,
    };
  }

  // Évaluer la position résultante du point de vue du joueur qui vient de jouer
  const state = snapshotSearchState(engineAfterMove);
  const oppToMove = engineAfterMove.turn;
  const scoreAfter = -negamax(state, 2, -Infinity, Infinity, oppToMove, moverColor, 3, 1);
  const deltaCp = preAnalysis.bestScoreCp - scoreAfter;

  if (deltaCp <= 25) {
    return {
      grade: 'excellent',
      title: 'Excellent coup',
      detail: `${moveRecord.san} est tout aussi précis que ${preAnalysis.moveLabel}.`,
    };
  }
  if (deltaCp <= 75) {
    return {
      grade: 'good',
      title: 'Coup solide',
      detail: `Bon choix avec ${moveRecord.san}. L'alternative ${preAnalysis.moveLabel} gardait un léger plus.`,
    };
  }
  if (deltaCp <= 185) {
    return {
      grade: 'inaccuracy',
      title: 'Imprécision',
      detail: `${moveRecord.san} cède un peu de terrain. ${preAnalysis.moveLabel} était préférable (${preAnalysis.reason.toLowerCase()})`,
    };
  }
  return {
    grade: 'mistake',
    title: 'Erreur tactique',
    detail: `Attention : ${moveRecord.san} concède un avantage net. Utilisez « Annuler » si vous souhaitez rejouer ce tour (${preAnalysis.moveLabel}).`,
  };
}

