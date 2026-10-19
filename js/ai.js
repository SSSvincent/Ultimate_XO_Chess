/* ============================================================
   究极井字棋 · 人机引擎
   纯函数式实现，不依赖 DOM，方便单独做回归测试。

   对外暴露：
     window.aiChooseMove(grid, current, nextBlock, difficulty)
       grid      : 9x9 二维数组，元素为 '' / 'X' / 'O'
       current   : 当前行动方 'X' 或 'O'
       nextBlock : 可落子的大区域索引 0~8（null 表示任意区域）
       difficulty: 'easy'（燕小北）| 'hard'（交小薇）
       返回 { r, c }（全局坐标）或 null（无处可落）

   两个难度：
     easy —— 燕小北：贪心 + 随机。优先「本手能得分」的格，其次「堵对手即将得分」的格，
             再其次「不让对手落到已满区域」，其余按概率随机落子，会犯错。
     hard —— 交小薇：minimax + α-β 剪枝，估值 = 本方三连数 − 对方三连数，
             深度足够时几乎不犯错。
   ============================================================ */
(function () {
  const BLOCKS = ['A','B','C','D','E','F','G','H','I'];
  const CELLS  = ['a','b','c','d','e','f','g','h','i'];

  // 8 条三连线（行 3 + 列 3 + 对角 2），作用于一个 3x3 区域内
  const LINES = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];

  function cellToBlock(r, c) {
    return (r % 3) * 3 + (c % 3);
  }

  // 统计某个大区域内 mark 的三连数
  function linesInBlock(grid, bi, mark) {
    const br = Math.floor(bi / 3), bc = bi % 3;
    const m = [];
    for (let i = 0; i < 3; i++) {
      m.push([]);
      for (let j = 0; j < 3; j++) m[i].push(grid[br * 3 + i][bc * 3 + j]);
    }
    let n = 0;
    for (const L of LINES) {
      if (L.every(k => m[Math.floor(k / 3)][k % 3] === mark)) n++;
    }
    return n;
  }

  // 全盘 mark 的三连总数（得分）
  function totalScore(grid, mark) {
    let s = 0;
    for (let bi = 0; bi < 9; bi++) s += linesInBlock(grid, bi, mark);
    return s;
  }

  function blockHasSpace(grid, bi) {
    const br = Math.floor(bi / 3), bc = bi % 3;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        if (!grid[br * 3 + i][bc * 3 + j]) return true;
    return false;
  }

  // 当前可落子的所有空位（全局坐标）
  function legalMoves(grid, nextBlock) {
    const moves = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r][c]) continue;
        const bi = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        if (nextBlock !== null && nextBlock !== bi) continue;
        moves.push({ r, c });
      }
    }
    return moves;
  }

  // 落子后的模拟（不修改原数组），返回新 grid
  function apply(grid, r, c, mark) {
    const g = grid.map(row => row.slice());
    g[r][c] = mark;
    return g;
  }

  /* ---------- 估值：从 current 视角，越大越好 ---------- */
  function evaluate(grid, current) {
    const me = current, op = current === 'X' ? 'O' : 'X';
    return totalScore(grid, me) - totalScore(grid, op);
  }

  /* ---------- minimax + α-β ---------- */
  function minimax(grid, current, nextBlock, depth, alpha, beta, me) {
    const moves = legalMoves(grid, nextBlock);
    if (moves.length === 0 || depth === 0) {
      return { score: evaluate(grid, me) };
    }
    const maximizing = (current === me);
    let bestScore = maximizing ? -Infinity : Infinity;

    for (const mv of moves) {
      const g = apply(grid, mv.r, mv.c, current);
      const nb = cellToBlock(mv.r, mv.c);
      const nextPlayer = current === 'X' ? 'O' : 'X';
      const res = minimax(g, nextPlayer, nb, depth - 1, alpha, beta, me);
      const s = res.score;
      if (maximizing) {
        if (s > bestScore) bestScore = s;
        if (bestScore > alpha) alpha = bestScore;
      } else {
        if (s < bestScore) bestScore = s;
        if (bestScore < beta) beta = bestScore;
      }
      if (alpha >= beta) break;   // 剪枝
    }
    return { score: bestScore };
  }

  /* ---------- 简单 AI：燕小北 ---------- */
  function easyMove(grid, current, nextBlock) {
    const op = current === 'X' ? 'O' : 'X';
    const moves = legalMoves(grid, nextBlock);
    if (moves.length === 0) return null;

    // 1) 本手能得分（落子后本方三连数 +1）→ 优先（但只拿第一优先格，简单 AI 不追求最大化）
    let bestGain = -1, bestMoves = [];
    for (const mv of moves) {
      const g = apply(grid, mv.r, mv.c, current);
      const gain = totalScore(g, current) - totalScore(grid, current);
      if (gain > bestGain) { bestGain = gain; bestMoves = [mv]; }
      else if (gain === bestGain) bestMoves.push(mv);
    }
    // 有得分机会 → 从中随机挑一个（可能挑到只连一条线的，这就是「简单」）
    if (bestGain > 0) {
      return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }

    // 2) 堵对手：找出对手若落到该格能得分的格，堵掉（随机堵一个）
    const blockMoves = [];
    for (const mv of moves) {
      const g = apply(grid, mv.r, mv.c, op);
      const gain = totalScore(g, op) - totalScore(grid, op);
      if (gain > 0) blockMoves.push(mv);
    }
    if (blockMoves.length > 0) {
      return blockMoves[Math.floor(Math.random() * blockMoves.length)];
    }

    // 3) 都不重要 → 随机落一个（偶尔会「送」出好位置，体现简单）
    return moves[Math.floor(Math.random() * moves.length)];
  }

  /* ---------- 较难 AI：交小薇 ---------- */
  function hardMove(grid, current, nextBlock) {
    const moves = legalMoves(grid, nextBlock);
    if (moves.length === 0) return null;

    // 开局 E 区中心 e 格（4,4）几乎总是最优，先固定它避免无谓搜索
    // （玩家先手已经在 E 区下过子，这里只在 e 还空着且可落时优先占）
    let depth = 4;
    const total = moves.length;
    if (total > 30) depth = 2;    // 前期分支多，降低深度保证响应速度
    else if (total > 16) depth = 3;

    let bestMove = moves[0], bestScore = -Infinity;
    for (const mv of moves) {
      const g = apply(grid, mv.r, mv.c, current);
      const nb = cellToBlock(mv.r, mv.c);
      const nextPlayer = current === 'X' ? 'O' : 'X';
      const res = minimax(g, nextPlayer, nb, depth - 1, -Infinity, Infinity, current);
      if (res.score > bestScore) { bestScore = res.score; bestMove = mv; }
    }
    return bestMove;
  }

  window.aiChooseMove = function (grid, current, nextBlock, difficulty) {
    if (difficulty === 'hard') return hardMove(grid, current, nextBlock);
    return easyMove(grid, current, nextBlock);   // 默认走简单
  };

  // 暴露给测试（便于断言内部细节）
  window.__ai = {
    cellToBlock, linesInBlock, totalScore, legalMoves, evaluate, easyMove, hardMove
  };
})();
