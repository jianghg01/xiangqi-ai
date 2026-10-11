"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/rules/exports.ts
var exports_exports = {};
__export(exports_exports, {
  FEN_TO_PIECE: () => FEN_TO_PIECE,
  FILES: () => FILES,
  INITIAL_FEN: () => INITIAL_FEN,
  PIECE_CHAR: () => PIECE_CHAR,
  RANKS: () => RANKS,
  applyMove: () => applyMove,
  attackedBy: () => attackedBy,
  checkStatus: () => checkStatus,
  cloneBoard: () => cloneBoard,
  countPiece: () => countPiece,
  emptyBoard: () => emptyBoard,
  findKing: () => findKing,
  flyingGeneralFacing: () => flyingGeneralFacing,
  getPiece: () => getPiece,
  hasAttackingPieces: () => hasAttackingPieces,
  inCheck: () => inCheck,
  initialBoard: () => initialBoard,
  isMaterialDraw: () => isMaterialDraw,
  legalMoves: () => legalMoves,
  legalMovesFrom: () => legalMovesFrom,
  parseFen: () => parseFen,
  parseIccs: () => parseIccs,
  pieceToFenChar: () => pieceToFenChar,
  pseudoMoves: () => pseudoMoves,
  pseudoMovesFrom: () => pseudoMovesFrom,
  sameSquare: () => sameSquare,
  setPiece: () => setPiece,
  sq: () => sq,
  squareKey: () => squareKey,
  toFen: () => toFen,
  toIccs: () => toIccs
});
module.exports = __toCommonJS(exports_exports);

// src/board/types.ts
var FILES = 9;
var RANKS = 10;
function sq(file, rank) {
  return { file, rank };
}
function sameSquare(a, b) {
  return a.file === b.file && a.rank === b.rank;
}
function squareKey(s) {
  return `${s.file},${s.rank}`;
}
var PIECE_CHAR = {
  red: { K: "\u5E05", A: "\u4ED5", B: "\u76F8", N: "\u9A6C", R: "\u8F66", C: "\u70AE", P: "\u5175" },
  black: { K: "\u5C06", A: "\u58EB", B: "\u8C61", N: "\u9A6C", R: "\u8F66", C: "\u70AE", P: "\u5352" }
};
var FEN_TO_PIECE = {
  K: { side: "red", type: "K" },
  A: { side: "red", type: "A" },
  B: { side: "red", type: "B" },
  N: { side: "red", type: "N" },
  R: { side: "red", type: "R" },
  C: { side: "red", type: "C" },
  P: { side: "red", type: "P" },
  k: { side: "black", type: "K" },
  a: { side: "black", type: "A" },
  b: { side: "black", type: "B" },
  n: { side: "black", type: "N" },
  r: { side: "black", type: "R" },
  c: { side: "black", type: "C" },
  p: { side: "black", type: "P" }
};
function pieceToFenChar(p) {
  const ch = p.type;
  return p.side === "red" ? ch : ch.toLowerCase();
}
function parseIccs(s) {
  const m = /^([a-i])(\d)([a-i])(\d)$/.exec(s.trim());
  if (!m) return null;
  return {
    from: { file: m[1].charCodeAt(0) - 97, rank: parseInt(m[2], 10) },
    to: { file: m[3].charCodeAt(0) - 97, rank: parseInt(m[4], 10) }
  };
}
function toIccs(mv) {
  return String.fromCharCode(97 + mv.from.file) + mv.from.rank + String.fromCharCode(97 + mv.to.file) + mv.to.rank;
}

// src/board/fen.ts
var INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
function emptyBoard() {
  const pieces = [];
  for (let r = 0; r < 10; r++) pieces.push(new Array(9).fill(null));
  return { pieces, sideToMove: "red" };
}
function initialBoard() {
  return parseFen(INITIAL_FEN).board;
}
function parseFen(fen) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) throw new Error(`FEN \u5B57\u6BB5\u4E0D\u8DB3: ${fen}`);
  const rows = parts[0].split("/");
  if (rows.length !== 10) throw new Error(`FEN \u884C\u6570\u5E94\u4E3A 10\uFF0C\u5B9E\u9645 ${rows.length}`);
  const board = emptyBoard();
  if (parts[1] !== "w" && parts[1] !== "b") {
    throw new Error(`\u884C\u68CB\u65B9\u5B57\u6BB5\u65E0\u6548: ${parts[1]}`);
  }
  board.sideToMove = parts[1] === "w" ? "red" : "black";
  rows.forEach((row, rank) => {
    let file = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "9") {
        file += parseInt(ch, 10);
      } else {
        const piece = FEN_TO_PIECE[ch];
        if (!piece) throw new Error(`FEN \u542B\u975E\u6CD5\u68CB\u5B50\u5B57\u7B26: ${ch}`);
        if (file >= FILES) throw new Error(`FEN \u884C\u8D85\u957F: ${row}`);
        board.pieces[rank][file] = piece;
        file++;
      }
    }
    if (file !== FILES) throw new Error(`FEN \u884C\u5BBD\u5EA6\u4E0D\u8DB3: ${row}`);
  });
  return { board, extra: parts.slice(2) };
}
function toFen(board, extra = ["-", "-", "0", "1"]) {
  const rows = [];
  for (let rank = 0; rank < 10; rank++) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 9; file++) {
      const p = board.pieces[rank][file];
      if (p) {
        if (empty) {
          row += empty;
          empty = 0;
        }
        row += pieceToFenChar(p);
      } else {
        empty++;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const side = board.sideToMove === "red" ? "w" : "b";
  return `${rows.join("/")} ${side} ${extra.join(" ")}`;
}
function getPiece(board, file, rank) {
  return board.pieces[rank][file] ?? null;
}
function setPiece(board, file, rank, p) {
  if (file < 0 || file > 8 || rank < 0 || rank > 9) {
    throw new Error(`\u5750\u6807\u8D8A\u754C: (${file},${rank})`);
  }
  board.pieces[rank][file] = p;
}
function cloneBoard(board) {
  return {
    pieces: board.pieces.map((row) => row.slice()),
    sideToMove: board.sideToMove
  };
}
function countPiece(board, side, type) {
  let n = 0;
  for (let r = 0; r < 10; r++)
    for (let f = 0; f < 9; f++) {
      const p = board.pieces[r][f];
      if (p && p.side === side && p.type === type) n++;
    }
  return n;
}

// src/rules/rules.ts
var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
var DIAGS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
var KNIGHT = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2]
];
function onBoard(s) {
  return s.file >= 0 && s.file <= 8 && s.rank >= 0 && s.rank <= 9;
}
function inPalace(s, side) {
  return s.file >= 3 && s.file <= 5 && (side === "red" ? s.rank >= 7 : s.rank <= 2);
}
function crossedRiver(s, side) {
  return side === "red" ? s.rank <= 4 : s.rank >= 5;
}
function findKing(board, side) {
  const r0 = side === "red" ? 7 : 0;
  for (let r = r0; r < r0 + 3; r++)
    for (let f = 3; f <= 5; f++) {
      const p = getPiece(board, f, r);
      if (p && p.side === side && p.type === "K") return sq(f, r);
    }
  return null;
}
function flyingGeneralFacing(board) {
  const rk = findKing(board, "red");
  const bk = findKing(board, "black");
  if (!rk || !bk || rk.file !== bk.file) return false;
  for (let r = bk.rank + 1; r < rk.rank; r++) {
    if (getPiece(board, rk.file, r)) return false;
  }
  return true;
}
function attackedBy(board, target, by) {
  const { file: f, rank: r } = target;
  const dir = by === "red" ? -1 : 1;
  for (const [df, dr] of DIRS) {
    let cf = f + df, cr = r + dr, screen = false;
    while (cf >= 0 && cf <= 8 && cr >= 0 && cr <= 9) {
      const p = getPiece(board, cf, cr);
      if (p) {
        if (!screen) {
          if (p.side === by && p.type === "R") return true;
          screen = true;
        } else {
          if (p.side === by && p.type === "C") return true;
          break;
        }
      }
      cf += df;
      cr += dr;
    }
  }
  for (const [df, dr] of KNIGHT) {
    const tf = f + df, tr = r + dr;
    if (tf < 0 || tf > 8 || tr < 0 || tr > 9) continue;
    const p = getPiece(board, tf, tr);
    if (!p || p.side !== by || p.type !== "N") continue;
    const lf = tf + (Math.abs(df) === 2 ? df > 0 ? -1 : 1 : 0);
    const lr = tr + (Math.abs(dr) === 2 ? dr > 0 ? -1 : 1 : 0);
    if (!getPiece(board, lf, lr)) return true;
  }
  const pr = r - dir;
  if (pr >= 0 && pr <= 9) {
    const p = getPiece(board, f, pr);
    if (p && p.side === by && p.type === "P") return true;
  }
  for (const df of [-1, 1]) {
    const sf = f + df;
    if (sf < 0 || sf > 8) continue;
    const p = getPiece(board, sf, r);
    if (p && p.side === by && p.type === "P" && crossedRiver(sq(sf, r), by)) return true;
  }
  return false;
}
function inCheck(board, side) {
  if (flyingGeneralFacing(board)) return true;
  const k = findKing(board, side);
  if (!k) return true;
  return attackedBy(board, k, side === "red" ? "black" : "red");
}
function pseudoMovesFrom(board, from) {
  const p = getPiece(board, from.file, from.rank);
  if (!p) return [];
  const { side, type } = p;
  const out = [];
  const dir = side === "red" ? -1 : 1;
  const push = (to) => {
    if (!onBoard(to)) return;
    const t = getPiece(board, to.file, to.rank);
    if (t && t.side === side) return;
    out.push({ from, to });
  };
  if (type === "K") {
    for (const [df, dr] of DIRS) {
      const to = sq(from.file + df, from.rank + dr);
      if (inPalace(to, side)) push(to);
    }
  } else if (type === "A") {
    for (const [df, dr] of DIAGS) {
      const to = sq(from.file + df, from.rank + dr);
      if (inPalace(to, side)) push(to);
    }
  } else if (type === "B") {
    for (const [df, dr] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const to = sq(from.file + df, from.rank + dr);
      const eye = sq(from.file + df / 2, from.rank + dr / 2);
      if (onBoard(to) && !crossedRiver(to, side) && !getPiece(board, eye.file, eye.rank)) push(to);
    }
  } else if (type === "N") {
    for (const [df, dr] of KNIGHT) {
      const to = sq(from.file + df, from.rank + dr);
      const leg = sq(
        from.file + (Math.abs(df) === 2 ? df / 2 : 0),
        from.rank + (Math.abs(dr) === 2 ? dr / 2 : 0)
      );
      if (onBoard(to) && !getPiece(board, leg.file, leg.rank)) push(to);
    }
  } else if (type === "R") {
    for (const [df, dr] of DIRS) {
      let f = from.file + df, r = from.rank + dr;
      while (f >= 0 && f <= 8 && r >= 0 && r <= 9) {
        const t = getPiece(board, f, r);
        if (!t) out.push({ from, to: sq(f, r) });
        else {
          if (t.side !== side) out.push({ from, to: sq(f, r) });
          break;
        }
        f += df;
        r += dr;
      }
    }
  } else if (type === "C") {
    for (const [df, dr] of DIRS) {
      let f = from.file + df, r = from.rank + dr, screen = false;
      while (f >= 0 && f <= 8 && r >= 0 && r <= 9) {
        const t = getPiece(board, f, r);
        if (!screen) {
          if (!t) out.push({ from, to: sq(f, r) });
          else screen = true;
        } else if (t) {
          if (t.side !== side) out.push({ from, to: sq(f, r) });
          break;
        }
        f += df;
        r += dr;
      }
    }
  } else {
    push(sq(from.file, from.rank + dir));
    if (crossedRiver(from, side)) {
      push(sq(from.file - 1, from.rank));
      push(sq(from.file + 1, from.rank));
    }
  }
  return out;
}
function pseudoMoves(board, side) {
  const out = [];
  for (let r = 0; r < 10; r++)
    for (let f = 0; f < 9; f++) {
      const p = getPiece(board, f, r);
      if (p && p.side === side) out.push(...pseudoMovesFrom(board, sq(f, r)));
    }
  return out;
}
function applyMove(board, mv) {
  const p = getPiece(board, mv.from.file, mv.from.rank);
  if (!p) throw new Error(`\u8D77\u70B9\u65E0\u68CB\u5B50: (${mv.from.file},${mv.from.rank})`);
  const nb = cloneBoard(board);
  setPiece(nb, mv.from.file, mv.from.rank, null);
  setPiece(nb, mv.to.file, mv.to.rank, p);
  nb.sideToMove = nb.sideToMove === "red" ? "black" : "red";
  return nb;
}
function legalMoves(board, side) {
  return pseudoMoves(board, side).filter((mv) => !inCheck(applyMove(board, mv), side));
}
function legalMovesFrom(board, from) {
  const p = getPiece(board, from.file, from.rank);
  if (!p) return [];
  return legalMoves(board, p.side).filter((mv) => mv.from.file === from.file && mv.from.rank === from.rank);
}
function checkStatus(board) {
  const side = board.sideToMove;
  const moves = legalMoves(board, side);
  if (moves.length === 0) {
    return { status: inCheck(board, side) ? "checkmate" : "stalemate", moves };
  }
  return { status: inCheck(board, side) ? "check" : "ok", moves };
}
function hasAttackingPieces(board, side) {
  for (let r = 0; r < 10; r++)
    for (let f = 0; f < 9; f++) {
      const p = getPiece(board, f, r);
      if (p && p.side === side && (p.type === "R" || p.type === "C" || p.type === "N" || p.type === "P")) {
        return true;
      }
    }
  return false;
}
function isMaterialDraw(board) {
  return !hasAttackingPieces(board, "red") && !hasAttackingPieces(board, "black");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FEN_TO_PIECE,
  FILES,
  INITIAL_FEN,
  PIECE_CHAR,
  RANKS,
  applyMove,
  attackedBy,
  checkStatus,
  cloneBoard,
  countPiece,
  emptyBoard,
  findKing,
  flyingGeneralFacing,
  getPiece,
  hasAttackingPieces,
  inCheck,
  initialBoard,
  isMaterialDraw,
  legalMoves,
  legalMovesFrom,
  parseFen,
  parseIccs,
  pieceToFenChar,
  pseudoMoves,
  pseudoMovesFrom,
  sameSquare,
  setPiece,
  sq,
  squareKey,
  toFen,
  toIccs
});
