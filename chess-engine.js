/**
 * Moteur d'échecs complet conforme aux règles officielles FIDE.
 * Plateau 8×8 : row 0 = rangée 8 (Noirs), row 7 = rangée 1 (Blancs).
 */

export const COLORS = {
  WHITE: 'w',
  BLACK: 'b',
};

export const PIECE_TYPES = {
  PAWN: 'p',
  KNIGHT: 'n',
  BISHOP: 'b',
  ROOK: 'r',
  QUEEN: 'q',
  KING: 'k',
};

export const PIECE_NAMES_FR = {
  k: 'Roi (Empereur)',
  q: 'Dame (Déesse)',
  b: 'Fou (Philosophe)',
  n: 'Cavalier (Cheval)',
  r: 'Tour (Colonne)',
  p: 'Pion (Légionnaire)',
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];
const SAN_LETTER_FR = {
  k: 'R',
  q: 'D',
  r: 'T',
  b: 'F',
  n: 'C',
  p: '',
};

let nextPieceId = 1;

export function createPiece(type, color, hasMoved = false, id = null) {
  return {
    id: id ?? nextPieceId++,
    type,
    color,
    hasMoved,
  };
}

export function squareToAlgebraic(row, col) {
  return `${FILES[col]}${RANKS[row]}`;
}

export function oppositeColor(color) {
  return color === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
}

export class ChessEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: 8 }, () => Array(8).fill(null));
    const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

    for (let col = 0; col < 8; col++) {
      this.board[0][col] = createPiece(backRank[col], COLORS.BLACK, false);
      this.board[1][col] = createPiece('p', COLORS.BLACK, false);
      this.board[6][col] = createPiece('p', COLORS.WHITE, false);
      this.board[7][col] = createPiece(backRank[col], COLORS.WHITE, false);
    }

    this.turn = COLORS.WHITE;
    this.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassantTarget = null; // { row, col }
    this.halfMoveClock = 0;
    this.fullMoveNumber = 1;
    this.moveHistory = [];
    this.capturedByWhite = [];
    this.capturedByBlack = [];
    this.lastMove = null;
    this.status = 'playing'; // 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw'
    this.winner = null; // 'w' | 'b' | null
    this.drawReason = null;
    this._snapshots = [];
    this._positionCounts = new Map();
    this._recordPosition();
    this._updateStatus();
  }

  cloneBoard(board = this.board) {
    return board.map((row) =>
      row.map((cell) => (cell ? { ...cell } : null))
    );
  }

  _saveSnapshot() {
    this._snapshots.push({
      board: this.cloneBoard(),
      turn: this.turn,
      castlingRights: { ...this.castlingRights },
      enPassantTarget: this.enPassantTarget ? { ...this.enPassantTarget } : null,
      halfMoveClock: this.halfMoveClock,
      fullMoveNumber: this.fullMoveNumber,
      capturedByWhite: [...this.capturedByWhite],
      capturedByBlack: [...this.capturedByBlack],
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      status: this.status,
      winner: this.winner,
      drawReason: this.drawReason,
      positionKey: this._getPositionKey(),
    });
  }

  undo() {
    if (this._snapshots.length === 0) return null;
    const snap = this._snapshots.pop();
    const currentKey = this._getPositionKey();
    const count = this._positionCounts.get(currentKey) || 0;
    if (count <= 1) this._positionCounts.delete(currentKey);
    else this._positionCounts.set(currentKey, count - 1);

    this.board = snap.board;
    this.turn = snap.turn;
    this.castlingRights = snap.castlingRights;
    this.enPassantTarget = snap.enPassantTarget;
    this.halfMoveClock = snap.halfMoveClock;
    this.fullMoveNumber = snap.fullMoveNumber;
    this.capturedByWhite = snap.capturedByWhite;
    this.capturedByBlack = snap.capturedByBlack;
    this.lastMove = snap.lastMove;
    this.status = snap.status;
    this.winner = snap.winner;
    this.drawReason = snap.drawReason;
    return this.moveHistory.pop();
  }

  _getPositionKey() {
    let key = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        key += p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.';
      }
    }
    key += `|${this.turn}|`;
    key += `${this.castlingRights.wK ? 'K' : ''}${this.castlingRights.wQ ? 'Q' : ''}${this.castlingRights.bK ? 'k' : ''}${this.castlingRights.bQ ? 'q' : ''}`;
    key += `|${this.enPassantTarget ? `${this.enPassantTarget.row},${this.enPassantTarget.col}` : '-'}`;
    return key;
  }

  _recordPosition() {
    const key = this._getPositionKey();
    this._positionCounts.set(key, (this._positionCounts.get(key) || 0) + 1);
  }

  inBounds(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  getPiece(r, c) {
    return this.inBounds(r, c) ? this.board[r][c] : null;
  }

  findKing(color, board = this.board) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === 'k' && p.color === color) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }

  isSquareAttacked(targetRow, targetCol, attackerColor, board = this.board) {
    // 1. Pions
    const pawnDir = attackerColor === COLORS.WHITE ? 1 : -1;
    const pawnRow = targetRow + pawnDir;
    if (pawnRow >= 0 && pawnRow < 8) {
      for (const dc of [-1, 1]) {
        const pc = targetCol + dc;
        if (pc >= 0 && pc < 8) {
          const p = board[pawnRow][pc];
          if (p && p.color === attackerColor && p.type === 'p') return true;
        }
      }
    }

    // 2. Cavaliers
    const knightDeltas = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1],
    ];
    for (const [dr, dc] of knightDeltas) {
      const nr = targetRow + dr;
      const nc = targetCol + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = board[nr][nc];
        if (p && p.color === attackerColor && p.type === 'n') return true;
      }
    }

    // 3. Roi adjacent
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const kr = targetRow + dr;
        const kc = targetCol + dc;
        if (kr >= 0 && kr < 8 && kc >= 0 && kc < 8) {
          const p = board[kr][kc];
          if (p && p.color === attackerColor && p.type === 'k') return true;
        }
      }
    }

    // 4. Lignes orthogonales (Tour / Dame)
    const orthoDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of orthoDirs) {
      let r = targetRow + dr;
      let c = targetCol + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = board[r][c];
        if (p) {
          if (p.color === attackerColor && (p.type === 'r' || p.type === 'q')) {
            return true;
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }

    // 5. Diagonales (Fou / Dame)
    const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, dc] of diagDirs) {
      let r = targetRow + dr;
      let c = targetCol + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = board[r][c];
        if (p) {
          if (p.color === attackerColor && (p.type === 'b' || p.type === 'q')) {
            return true;
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }

    return false;
  }

  isInCheck(color, board = this.board) {
    const king = this.findKing(color, board);
    if (!king) return false;
    return this.isSquareAttacked(king.row, king.col, oppositeColor(color), board);
  }

  _generatePseudoMovesForSquare(row, col) {
    const piece = this.board[row][col];
    if (!piece) return [];

    const moves = [];
    const color = piece.color;
    const enemy = oppositeColor(color);

    if (piece.type === 'p') {
      const dir = color === COLORS.WHITE ? -1 : 1;
      const startRow = color === COLORS.WHITE ? 6 : 1;
      const promoRow = color === COLORS.WHITE ? 0 : 7;

      const oneStep = row + dir;
      if (this.inBounds(oneStep, col) && !this.board[oneStep][col]) {
        if (oneStep === promoRow) {
          for (const promo of ['q', 'r', 'b', 'n']) {
            moves.push({ fromRow: row, fromCol: col, toRow: oneStep, toCol: col, promotion: promo });
          }
        } else {
          moves.push({ fromRow: row, fromCol: col, toRow: oneStep, toCol: col });
          const twoStep = row + dir * 2;
          if (row === startRow && !this.board[twoStep][col]) {
            moves.push({
              fromRow: row,
              fromCol: col,
              toRow: twoStep,
              toCol: col,
              isDoublePawnPush: true,
            });
          }
        }
      }

      for (const dc of [-1, 1]) {
        const tc = col + dc;
        const tr = row + dir;
        if (!this.inBounds(tr, tc)) continue;
        const target = this.board[tr][tc];
        if (target && target.color === enemy) {
          if (tr === promoRow) {
            for (const promo of ['q', 'r', 'b', 'n']) {
              moves.push({
                fromRow: row,
                fromCol: col,
                toRow: tr,
                toCol: tc,
                capture: target,
                promotion: promo,
              });
            }
          } else {
            moves.push({
              fromRow: row,
              fromCol: col,
              toRow: tr,
              toCol: tc,
              capture: target,
            });
          }
        } else if (
          this.enPassantTarget &&
          this.enPassantTarget.row === tr &&
          this.enPassantTarget.col === tc
        ) {
          const epPawn = this.board[row][tc];
          if (epPawn && epPawn.color === enemy && epPawn.type === 'p') {
            moves.push({
              fromRow: row,
              fromCol: col,
              toRow: tr,
              toCol: tc,
              capture: epPawn,
              isEnPassant: true,
              enPassantCapturedPos: { row, col: tc },
            });
          }
        }
      }
    } else if (piece.type === 'n') {
      const deltas = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2], [1, 2], [2, -1], [2, 1],
      ];
      for (const [dr, dc] of deltas) {
        const tr = row + dr;
        const tc = col + dc;
        if (!this.inBounds(tr, tc)) continue;
        const target = this.board[tr][tc];
        if (!target || target.color === enemy) {
          moves.push({
            fromRow: row,
            fromCol: col,
            toRow: tr,
            toCol: tc,
            capture: target || null,
          });
        }
      }
    } else if (piece.type === 'b' || piece.type === 'r' || piece.type === 'q') {
      const dirs = [];
      if (piece.type === 'b' || piece.type === 'q') {
        dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      }
      if (piece.type === 'r' || piece.type === 'q') {
        dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
      }
      for (const [dr, dc] of dirs) {
        let tr = row + dr;
        let tc = col + dc;
        while (this.inBounds(tr, tc)) {
          const target = this.board[tr][tc];
          if (!target) {
            moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
          } else {
            if (target.color === enemy) {
              moves.push({
                fromRow: row,
                fromCol: col,
                toRow: tr,
                toCol: tc,
                capture: target,
              });
            }
            break;
          }
          tr += dr;
          tc += dc;
        }
      }
    } else if (piece.type === 'k') {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const tr = row + dr;
          const tc = col + dc;
          if (!this.inBounds(tr, tc)) continue;
          const target = this.board[tr][tc];
          if (!target || target.color === enemy) {
            moves.push({
              fromRow: row,
              fromCol: col,
              toRow: tr,
              toCol: tc,
              capture: target || null,
            });
          }
        }
      }

      // Roque
      const homeRow = color === COLORS.WHITE ? 7 : 0;
      if (row === homeRow && col === 4 && !this.isInCheck(color)) {
        const kSideRight = color === COLORS.WHITE ? this.castlingRights.wK : this.castlingRights.bK;
        const qSideRight = color === COLORS.WHITE ? this.castlingRights.wQ : this.castlingRights.bQ;

        // Petit roque (O-O)
        if (
          kSideRight &&
          !this.board[homeRow][5] &&
          !this.board[homeRow][6] &&
          this.board[homeRow][7]?.type === 'r' &&
          this.board[homeRow][7]?.color === color &&
          !this.isSquareAttacked(homeRow, 5, enemy) &&
          !this.isSquareAttacked(homeRow, 6, enemy)
        ) {
          moves.push({
            fromRow: homeRow,
            fromCol: 4,
            toRow: homeRow,
            toCol: 6,
            isCastle: 'K',
          });
        }

        // Grand roque (O-O-O)
        if (
          qSideRight &&
          !this.board[homeRow][3] &&
          !this.board[homeRow][2] &&
          !this.board[homeRow][1] &&
          this.board[homeRow][0]?.type === 'r' &&
          this.board[homeRow][0]?.color === color &&
          !this.isSquareAttacked(homeRow, 3, enemy) &&
          !this.isSquareAttacked(homeRow, 2, enemy)
        ) {
          moves.push({
            fromRow: homeRow,
            fromCol: 4,
            toRow: homeRow,
            toCol: 2,
            isCastle: 'Q',
          });
        }
      }
    }

    return moves;
  }

  _isMoveLegal(move) {
    const piece = this.board[move.fromRow][move.fromCol];
    if (!piece) return false;
    const tempBoard = this.cloneBoard();
    tempBoard[move.fromRow][move.fromCol] = null;
    if (move.isEnPassant && move.enPassantCapturedPos) {
      tempBoard[move.enPassantCapturedPos.row][move.enPassantCapturedPos.col] = null;
    }
    tempBoard[move.toRow][move.toCol] = {
      ...piece,
      type: move.promotion || piece.type,
    };
    if (move.isCastle === 'K') {
      tempBoard[move.toRow][5] = tempBoard[move.toRow][7];
      tempBoard[move.toRow][7] = null;
    } else if (move.isCastle === 'Q') {
      tempBoard[move.toRow][3] = tempBoard[move.toRow][0];
      tempBoard[move.toRow][0] = null;
    }
    return !this.isInCheck(piece.color, tempBoard);
  }

  getLegalMovesForSquare(row, col) {
    const piece = this.board[row][col];
    if (!piece || piece.color !== this.turn) return [];
    const pseudo = this._generatePseudoMovesForSquare(row, col);
    return pseudo.filter((m) => this._isMoveLegal(m));
  }

  getAllLegalMoves(color = this.turn) {
    const all = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.color === color) {
          const pseudo = this._generatePseudoMovesForSquare(r, c);
          for (const m of pseudo) {
            if (this._isMoveLegal(m)) all.push(m);
          }
        }
      }
    }
    return all;
  }

  _buildSanNotation(move, movingPiece, allSameColorMoves, isCheck, isMate) {
    if (move.isCastle === 'K') return `O-O${isMate ? '#' : isCheck ? '+' : ''}`;
    if (move.isCastle === 'Q') return `O-O-O${isMate ? '#' : isCheck ? '+' : ''}`;

    let san = '';
    if (movingPiece.type === 'p') {
      if (move.capture) {
        san += `${FILES[move.fromCol]}x`;
      }
      san += squareToAlgebraic(move.toRow, move.toCol);
      if (move.promotion) {
        san += `=${SAN_LETTER_FR[move.promotion]}`;
      }
    } else {
      san += SAN_LETTER_FR[movingPiece.type];
      // Désambiguïsation si deux pièces identiques peuvent atteindre la même case
      const ambiguous = allSameColorMoves.filter(
        (m) =>
          (m.fromRow !== move.fromRow || m.fromCol !== move.fromCol) &&
          m.toRow === move.toRow &&
          m.toCol === move.toCol &&
          this.board[m.fromRow]?.[m.fromCol]?.type === movingPiece.type
      );
      if (ambiguous.length > 0) {
        const sameFile = ambiguous.some((m) => m.fromCol === move.fromCol);
        const sameRank = ambiguous.some((m) => m.fromRow === move.fromRow);
        if (!sameFile) san += FILES[move.fromCol];
        else if (!sameRank) san += RANKS[move.fromRow];
        else san += squareToAlgebraic(move.fromRow, move.fromCol);
      }
      if (move.capture) san += 'x';
      san += squareToAlgebraic(move.toRow, move.toCol);
    }

    if (isMate) san += '#';
    else if (isCheck) san += '+';
    return san;
  }

  makeMove(move) {
    const piece = this.board[move.fromRow][move.fromCol];
    if (!piece || piece.color !== this.turn) return null;

    const legalMovesBefore = this.getAllLegalMoves(this.turn);
    const matched = legalMovesBefore.find(
      (m) =>
        m.fromRow === move.fromRow &&
        m.fromCol === move.fromCol &&
        m.toRow === move.toRow &&
        m.toCol === move.toCol &&
        (m.promotion || null) === (move.promotion || null)
    );
    if (!matched) return null;

    this._saveSnapshot();

    // Sauvegarder une copie de la pièce avant mutation pour SAN
    const pieceSnapshot = { ...piece };

    let capturedPiece = null;
    let capturedPos = null;
    if (matched.isEnPassant && matched.enPassantCapturedPos) {
      capturedPos = matched.enPassantCapturedPos;
      capturedPiece = this.board[capturedPos.row][capturedPos.col];
      this.board[capturedPos.row][capturedPos.col] = null;
    } else if (this.board[matched.toRow][matched.toCol]) {
      capturedPos = { row: matched.toRow, col: matched.toCol };
      capturedPiece = this.board[matched.toRow][matched.toCol];
    }

    if (capturedPiece) {
      if (piece.color === COLORS.WHITE) {
        this.capturedByWhite.push(capturedPiece.type);
      } else {
        this.capturedByBlack.push(capturedPiece.type);
      }
    }

    // Déplacement de la pièce
    this.board[matched.fromRow][matched.fromCol] = null;
    const movedPiece = {
      ...piece,
      type: matched.promotion || piece.type,
      hasMoved: true,
    };
    this.board[matched.toRow][matched.toCol] = movedPiece;

    // Déplacement de la tour en cas de roque
    let rookMove = null;
    if (matched.isCastle === 'K') {
      const rook = this.board[matched.toRow][7];
      this.board[matched.toRow][7] = null;
      this.board[matched.toRow][5] = { ...rook, hasMoved: true };
      rookMove = { fromRow: matched.toRow, fromCol: 7, toRow: matched.toRow, toCol: 5, pieceId: rook.id };
    } else if (matched.isCastle === 'Q') {
      const rook = this.board[matched.toRow][0];
      this.board[matched.toRow][0] = null;
      this.board[matched.toRow][3] = { ...rook, hasMoved: true };
      rookMove = { fromRow: matched.toRow, fromCol: 0, toRow: matched.toRow, toCol: 3, pieceId: rook.id };
    }

    // Mise à jour des droits de roque
    if (piece.type === 'k') {
      if (piece.color === COLORS.WHITE) {
        this.castlingRights.wK = false;
        this.castlingRights.wQ = false;
      } else {
        this.castlingRights.bK = false;
        this.castlingRights.bQ = false;
      }
    }
    if (piece.type === 'r') {
      if (matched.fromRow === 7 && matched.fromCol === 0) this.castlingRights.wQ = false;
      if (matched.fromRow === 7 && matched.fromCol === 7) this.castlingRights.wK = false;
      if (matched.fromRow === 0 && matched.fromCol === 0) this.castlingRights.bQ = false;
      if (matched.fromRow === 0 && matched.fromCol === 7) this.castlingRights.bK = false;
    }
    if (capturedPiece && capturedPiece.type === 'r' && capturedPos) {
      if (capturedPos.row === 7 && capturedPos.col === 0) this.castlingRights.wQ = false;
      if (capturedPos.row === 7 && capturedPos.col === 7) this.castlingRights.wK = false;
      if (capturedPos.row === 0 && capturedPos.col === 0) this.castlingRights.bQ = false;
      if (capturedPos.row === 0 && capturedPos.col === 7) this.castlingRights.bK = false;
    }

    // Mise à jour de la cible en passant
    if (matched.isDoublePawnPush) {
      const dir = piece.color === COLORS.WHITE ? -1 : 1;
      this.enPassantTarget = { row: matched.fromRow + dir, col: matched.fromCol };
    } else {
      this.enPassantTarget = null;
    }

    // Horloge des 50 coups
    if (piece.type === 'p' || capturedPiece) {
      this.halfMoveClock = 0;
    } else {
      this.halfMoveClock += 1;
    }

    const prevTurn = this.turn;
    const moveNumberForEntry = this.fullMoveNumber;
    if (this.turn === COLORS.BLACK) {
      this.fullMoveNumber += 1;
    }
    this.turn = oppositeColor(this.turn);

    this._recordPosition();
    this._updateStatus();

    const isCheck = this.status === 'check' || this.status === 'checkmate';
    const isMate = this.status === 'checkmate';

    // Calcul de la notation algébrique
    // Temporairement restaurer snapshot.board? Non, on utilise pieceSnapshot + legalMovesBefore
    const san = this._buildSanNotationWithPreBoard(
      matched,
      pieceSnapshot,
      legalMovesBefore,
      isCheck,
      isMate
    );

    const record = {
      ...matched,
      pieceId: movedPiece.id,
      pieceType: movedPiece.type,
      color: prevTurn,
      capturedPiece,
      capturedPos,
      rookMove,
      san,
      moveNumber: moveNumberForEntry,
    };

    this.lastMove = record;
    this.moveHistory.push(record);
    return record;
  }

  _buildSanNotationWithPreBoard(move, movingPiece, allSameColorMoves, isCheck, isMate) {
    if (move.isCastle === 'K') return `O-O${isMate ? '#' : isCheck ? '+' : ''}`;
    if (move.isCastle === 'Q') return `O-O-O${isMate ? '#' : isCheck ? '+' : ''}`;

    const preBoard = this._snapshots[this._snapshots.length - 1].board;
    let san = '';
    if (movingPiece.type === 'p') {
      if (move.capture) san += `${FILES[move.fromCol]}x`;
      san += squareToAlgebraic(move.toRow, move.toCol);
      if (move.promotion) san += `=${SAN_LETTER_FR[move.promotion]}`;
    } else {
      san += SAN_LETTER_FR[movingPiece.type];
      const ambiguous = allSameColorMoves.filter(
        (m) =>
          (m.fromRow !== move.fromRow || m.fromCol !== move.fromCol) &&
          m.toRow === move.toRow &&
          m.toCol === move.toCol &&
          preBoard[m.fromRow]?.[m.fromCol]?.type === movingPiece.type
      );
      if (ambiguous.length > 0) {
        const sameFile = ambiguous.some((m) => m.fromCol === move.fromCol);
        const sameRank = ambiguous.some((m) => m.fromRow === move.fromRow);
        if (!sameFile) san += FILES[move.fromCol];
        else if (!sameRank) san += RANKS[move.fromRow];
        else san += squareToAlgebraic(move.fromRow, move.fromCol);
      }
      if (move.capture) san += 'x';
      san += squareToAlgebraic(move.toRow, move.toCol);
    }

    if (isMate) san += '#';
    else if (isCheck) san += '+';
    return san;
  }

  _hasInsufficientMaterial() {
    const pieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.type !== 'k') {
          pieces.push({ ...p, squareColor: (r + c) % 2 });
        }
      }
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1 && (pieces[0].type === 'n' || pieces[0].type === 'b')) return true;
    if (
      pieces.length === 2 &&
      pieces[0].type === 'b' &&
      pieces[1].type === 'b' &&
      pieces[0].color !== pieces[1].color &&
      pieces[0].squareColor === pieces[1].squareColor
    ) {
      return true;
    }
    return false;
  }

  _updateStatus() {
    const legalMoves = this.getAllLegalMoves(this.turn);
    const inCheck = this.isInCheck(this.turn);

    if (legalMoves.length === 0) {
      if (inCheck) {
        this.status = 'checkmate';
        this.winner = oppositeColor(this.turn);
        this.drawReason = null;
      } else {
        this.status = 'stalemate';
        this.winner = null;
        this.drawReason = 'Pat — Aucun coup légal disponible';
      }
      return;
    }

    if (this._hasInsufficientMaterial()) {
      this.status = 'draw';
      this.winner = null;
      this.drawReason = 'Matériel insuffisant pour mater';
      return;
    }

    if (this.halfMoveClock >= 100) {
      this.status = 'draw';
      this.winner = null;
      this.drawReason = 'Règle des 50 coups sans prise ni poussée de pion';
      return;
    }

    const posCount = this._positionCounts.get(this._getPositionKey()) || 0;
    if (posCount >= 3) {
      this.status = 'draw';
      this.winner = null;
      this.drawReason = 'Nulle par triple répétition';
      return;
    }

    this.winner = null;
    this.drawReason = null;
    this.status = inCheck ? 'check' : 'playing';
  }
}
