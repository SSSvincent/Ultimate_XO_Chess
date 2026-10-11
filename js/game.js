/* ============================================================
   究极井字棋 · 棋局核心
   适用于：
     game.html   正常对局            （<body data-mode="play">）
     rules.html  规则介绍 · 只读演示 （<body data-mode="readonly">）
   依赖：js/modal.js 提供的 window.showToast / window.showConfirm
   ============================================================ */
(function () {
  const board = document.getElementById('board');
  if (!board) return;                  // 页面没有棋盘就不初始化

  const N = 9;                         // 整体 9x9
  const BLOCKS = ['A','B','C','D','E','F','G','H','I']; // 大格命名：从左到右、从上到下
  const CELLS  = ['a','b','c','d','e','f','g','h','i']; // 小格命名：从左到右、从上到下

  const statusEl   = document.getElementById('status');
  const btnRestart = document.getElementById('restart');   // 规则页可能没有
  const btnUndo    = document.getElementById('undo');      // 规则页可能没有
  const btnBack    = document.getElementById('back');
  const scoreXEl   = document.getElementById('scoreX');
  const scoreOEl   = document.getElementById('scoreO');
  const crownX     = document.getElementById('crownX');
  const crownO     = document.getElementById('crownO');
  const scoreBoxX  = document.getElementById('scoreBoxX');
  const scoreBoxO  = document.getElementById('scoreBoxO');
  const labelX     = document.getElementById('labelX');

  // 只读模式：由页面 <body data-mode="readonly"> 决定
  //   （规则页讲解到最后可被 window.rulesGrantPlay 解除，届时才允许玩家落子）
  let readOnly = document.body.dataset.mode === 'readonly';

  // 规则页的交互模式：
  //   'off'      – 只读演示（默认）
  //   'practice' – 只放行玩家一手，落完立刻收回只读（讲「落子小格决定下一手区域」那段）
  //   'loop'     – 演练循环：玩家可连续落子，交小薇每手都到对应区域的 e 号格回应，
  //                从而把玩家送回 E 区；直到 E 区被下满才结束
  let rulesMode = 'off';
  let loopBaselineO = 0;      // 玩家「上一手之后」的分数（用于判断这一手有没有得分）
  let demoFinished = false;   // 规则页演练收尾：棋盘已无处可落，不再高亮任何区域

  const DEMO_STATUS = '📖 规则介绍 · 仅供演示，不可落子';

  let grid, current, nextBlock;       // nextBlock: 当前可落子的区域索引（0~8），null 表示任意
  let gameOver = false;
  let scoreX, scoreO;
  let finalBlock = null;              // 触发结束的最后落子区域索引
  let winner = null;                  // 'X' / 'O' / null(平局)
  let history = [];                   // 悔棋历史栈：每步存落子前的完整状态快照

  // 泛光控制：对局中当前玩家模块泛光；结束后仅获胜玩家模块+分数泛光
  const GLOW_CLASSES = ['turn-x', 'turn-o', 'win-x', 'win-o'];

  function setGlow() {
    scoreBoxX.classList.remove(...GLOW_CLASSES);
    scoreBoxO.classList.remove(...GLOW_CLASSES);
    if (gameOver) {
      if (winner === 'X') scoreBoxX.classList.add('win-x');
      else if (winner === 'O') scoreBoxO.classList.add('win-o');
    } else {
      if (current === 'X') scoreBoxX.classList.add('turn-x');
      else scoreBoxO.classList.add('turn-o');
    }
  }

  // 收起全部泛光（规则页演示收尾用：棋盘已收回只读，两边都不该显示「轮到你」）
  function clearGlow() {
    scoreBoxX.classList.remove(...GLOW_CLASSES);
    scoreBoxO.classList.remove(...GLOW_CLASSES);
  }

  function setCrown() {
    crownX.classList.toggle('show', winner === 'X');
    crownO.classList.toggle('show', winner === 'O');
  }

  function init() {
    grid = Array.from({ length: N }, () => Array(N).fill(''));
    current = 'X';
    nextBlock = 4;                    // 首手只能在 E 区域
    gameOver = false;
    scoreX = 0;
    scoreO = 0;
    finalBlock = null;
    winner = null;
    history = [];
    rulesMode = 'off';
    demoFinished = false;
    labelX.textContent = readOnly ? '✕ 交小薇' : '✕ 玩家';
    statusEl.textContent = readOnly
      ? DEMO_STATUS
      : '轮到 ✕ 落子（只能在 E 区域）';
    updateScores();
    setCrown();
    setGlow();
    render();
  }

  /* 规则页专用：把交小薇的演示落子同步进棋局状态，并解除只读，把棋盘交给玩家。
     规则页里的演示棋子是 dialogue.js 直接改 DOM 放的，棋局状态并不知情，这里补上：
       - 把 (r,c) 记为 mark（交小薇执 ✕），并按规则推导下一手区域与行动方
       - readOnly 置为 false，之后点击棋盘即真正落子
     返回解除后轮到的一方（'X' / 'O'）。 */
  window.rulesGrantPlay = function (r, c, mark) {
    if (grid && grid[r][c] === '') {
      grid[r][c] = mark;
      nextBlock = cellToBlock(r, c);
      current = mark === 'X' ? 'O' : 'X';
      updateScores();
    }
    readOnly = false;
    rulesMode = 'practice';        // 只放行玩家这一手
    setCrown();
    setGlow();
    statusEl.textContent = '轮到 ' + (current === 'X' ? '✕' : '◯') +
      ' 落子（只能在 ' + BLOCKS[nextBlock] + ' 区域）';
    render();
    return current;
  };

  /* 规则页专用：交小薇的脚本落子（玩家练习完一手后，她回应对应区域）。
     忽略只读限制，走与玩家点击完全相同的落子逻辑，落完后把棋盘收回「只读演示」。 */
  window.rulesScriptMove = function (r, c) {
    if (!grid || gameOver || grid[r][c]) return false;
    const bi = Math.floor(r / 3) * 3 + Math.floor(c / 3);
    if (nextBlock !== null && nextBlock !== bi) return false;   // 只能落在被指定的区域
    const info = applyMove(r, c, true);
    if (info.stuck) return true;   // 已安静收尾（正常不会走到）
    readOnly = true;               // 落完立刻收回只读
    clearGlow();                   // 演示到此收尾：两端都不再泛光，避免「轮到你」的错觉
    statusEl.textContent = DEMO_STATUS;
    return true;
  };

  /* 规则页专用：进入「演练循环」——把棋盘交给玩家，且允许连续落子。
     玩家每落一手由 dialogue.js 调度交小薇的回应（她只会落在对应区域的 e 号格，
     从而把下一手区域重新指回 E），直到 E 区被下满为止（见 onCellClick）。 */
  window.rulesStartLoop = function () {
    rulesMode = 'loop';
    loopBaselineO = scoreO;        // 记下玩家的起始分数
    demoFinished = false;          // 循环开始：恢复可落子区域高亮
    readOnly = false;
    setCrown();
    setGlow();
    statusEl.textContent = '轮到 ◯ 落子（只能在 ' + BLOCKS[nextBlock] + ' 区域）';
    render();
    return current;
  };

  /* 规则页专用：演练收尾 —— 棋盘收回只读演示。
     不再高亮任何区域（绿框）、不再标出结束手（红格）、不亮皇冠、不泛光，状态栏回到演示文案。
     触发点：① 收尾讲解说完时由 dialogue.js 调用（见 window.rulesEndDemo）；
             ② 万一她的脚本落子让玩家无处可落（理论上不会走到，因为收尾后她已不再落子）。 */
  function endDemo() {
    demoFinished = true;
    rulesMode = 'off';
    readOnly = true;
    clearGlow();
    render();
    statusEl.textContent = DEMO_STATUS;
  }
  window.rulesEndDemo = endDemo;

  /* 规则页专用：演练循环里交小薇的脚本落子（落完把棋盘交回玩家）。
     正常情况她总能落在对应区域的 e 号格；万一那格已被占，退而取该区域第一个空位。 */
  window.rulesLoopMove = function (r, c) {
    if (!grid || gameOver) return false;
    if (grid[r][c]) {
      const br = Math.floor(r / 3), bc = Math.floor(c / 3);
      let found = false;
      for (let i = 0; i < 3 && !found; i++) {
        for (let j = 0; j < 3 && !found; j++) {
          if (!grid[br * 3 + i][bc * 3 + j]) { r = br * 3 + i; c = bc * 3 + j; found = true; }
        }
      }
      if (!found) { endDemo(); return false; }   // 整个区域都满了：循环到此结束
    }
    const bi = Math.floor(r / 3) * 3 + Math.floor(c / 3);
    if (nextBlock !== null && nextBlock !== bi) return false;   // 只能落在被指定的区域
    const info = applyMove(r, c, true);   // 内部已更新状态栏与泛光
    if (info.stuck) return true;          // E 区被下满 → 已在 applyMove 里安静收尾
    readOnly = false;                     // 她落完 → 把棋盘交回玩家
    return true;
  };

  // 悔棋：回退一步
  function undo() {
    if (history.length === 0) return;
    const s = history.pop();
    grid = s.grid;
    current = s.current;
    nextBlock = s.nextBlock;
    gameOver = s.gameOver;
    finalBlock = s.finalBlock;
    winner = s.winner;
    scoreX = s.scoreX;
    scoreO = s.scoreO;
    scoreXEl.textContent = scoreX;
    scoreOEl.textContent = scoreO;
    setCrown();
    setGlow();
    if (gameOver) {
      statusEl.textContent = '游戏结束 —— 平局！';
    } else {
      statusEl.textContent = '轮到 ' + (current === 'X' ? '✕' : '◯') +
        ' 落子（只能在 ' + BLOCKS[nextBlock] + ' 区域）';
    }
    render();
  }

  /* ---------- 计分：统计每个 3x3 区域内三连线的数量 ---------- */
  function countLinesInBlock(bi, mark) {
    const br = Math.floor(bi / 3), bc = bi % 3;
    // 取该区域内 3x3 小格
    const m = [];
    for (let i = 0; i < 3; i++) {
      m.push([]);
      for (let j = 0; j < 3; j++) {
        m[i].push(grid[br * 3 + i][bc * 3 + j]);
      }
    }
    // 3 行 + 3 列 + 2 对角线
    const lines = [
      [m[0][0], m[0][1], m[0][2]],
      [m[1][0], m[1][1], m[1][2]],
      [m[2][0], m[2][1], m[2][2]],
      [m[0][0], m[1][0], m[2][0]],
      [m[0][1], m[1][1], m[2][1]],
      [m[0][2], m[1][2], m[2][2]],
      [m[0][0], m[1][1], m[2][2]],
      [m[0][2], m[1][1], m[2][0]],
    ];
    return lines.filter(l => l.every(v => v === mark)).length;
  }

  function updateScores() {
    scoreX = 0; scoreO = 0;
    for (let bi = 0; bi < 9; bi++) {
      scoreX += countLinesInBlock(bi, 'X');
      scoreO += countLinesInBlock(bi, 'O');
    }
    scoreXEl.textContent = scoreX;
    scoreOEl.textContent = scoreO;
  }

  /* ---------- 结束判定：当前玩家在指定区域内无处可落 ---------- */
  // 判断某个区域内是否还有空位
  function blockHasSpace(bi) {
    const br = Math.floor(bi / 3), bc = bi % 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (!grid[br * 3 + i][bc * 3 + j]) return true;
      }
    }
    return false;
  }

  // 当前玩家是否无处可落
  function currentPlayerStuck() {
    // 若未指定区域（正常情况不会发生，因为首手在E，之后总会有 nextBlock）
    if (nextBlock === null) {
      // 所有区域都满才无处可落
      for (let bi = 0; bi < 9; bi++) if (blockHasSpace(bi)) return false;
      return true;
    }
    // 指定区域无空位 → 无处可落
    return !blockHasSpace(nextBlock);
  }

  // 计算：落子在某个小格后，下一手被指定到哪个大格
  function cellToBlock(r, c) {
    const i = r % 3;   // 0/1/2  小格在大格内的行
    const j = c % 3;   // 0/1/2  小格在大格内的列
    return i * 3 + j;  // 返回大格索引 0~8
  }

  function render() {
    board.innerHTML = '';
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const bi = br * 3 + bc;       // 大格索引 0~8
        const block = document.createElement('div');
        block.className = 'block';
        block.dataset.label = BLOCKS[bi];   // 区域字母 A~I（规则页讲解时显示在区域顶部）
        // 可落子区域用绿框标记（游戏结束后不高亮；演练收尾后也不再高亮）
        if (!gameOver && !demoFinished && (nextBlock === null || nextBlock === bi)) {
          block.classList.add('active');
        }
        // 游戏结束：标注触发结束的区域（获胜方颜色）
        if (gameOver && finalBlock === bi && winner) {
          block.classList.add(winner === 'X' ? 'final-win-x' : 'final-win-o');
        }
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const r = br * 3 + i;
            const c = bc * 3 + j;
            const cell = document.createElement('div');
            cell.className = 'cell';
            if (grid[r][c]) {
              cell.classList.add(grid[r][c].toLowerCase());
              cell.textContent = grid[r][c] === 'X' ? '✕' : '◯';
            } else if (!gameOver && !demoFinished && (nextBlock === null || nextBlock === bi) && !blockHasSpace(cellToBlock(r, c))) {
              // 可落子、且落子后对手被指定到的区域已满 → 这步能结束游戏
              cell.classList.add('win-hint');
            }
            cell.dataset.r = r;
            cell.dataset.c = c;
            cell.dataset.label = CELLS[i * 3 + j];  // 本区域内小格字母 a~i（规则页讲解时用）
            cell.addEventListener('click', onCellClick);
            block.appendChild(cell);
          }
        }
        board.appendChild(block);
      }
    }
  }

  /* ---------- 落子 ----------
     把「真正下这一步」的逻辑抽出来，供「玩家点击」与「规则页脚本落子」共用。
     调用前需保证：目标格为空、区域合法、未结束（只读/练习限制由调用方负责）。
     返回 { player, nextBlock }：刚落子的一方，以及这手棋指定的下一手区域索引。 */
  function applyMove(r, c, demo) {
    // 落子前保存历史快照（用于悔棋）
    history.push({
      grid: grid.map(row => row.slice()),
      current, nextBlock, gameOver, finalBlock, winner, scoreX, scoreO
    });

    const player = current;
    grid[r][c] = player;

    // 更新得分
    updateScores();

    // 切换到下一玩家，并指定其落子区域
    nextBlock = cellToBlock(r, c);
    current = current === 'X' ? 'O' : 'X';

    // 结束判定：当且仅当当前玩家无处可落
    if (currentPlayerStuck()) {
      if (demo) {
        // 规则页演练：不进入「游戏结束」态。E 区被下满时会走到这里 ——
        //   只是没有可以落子的地方了，安静收尾（不判胜负、不亮皇冠）。
        endDemo();
        return { player, nextBlock, stuck: true };
      }
      gameOver = true;
      finalBlock = nextBlock;       // 记录让对手无处可落的区域
      if (scoreX > scoreO) winner = 'X';
      else if (scoreO > scoreX) winner = 'O';
      else winner = null;
      render();
      let msg;
      if (winner === 'X') msg = '✕ 玩家获胜！';
      else if (winner === 'O') msg = '◯ 玩家获胜！';
      else msg = '平局！';
      setCrown();
      setGlow();
      statusEl.textContent = '游戏结束 —— ' + (current === 'X' ? '◯' : '✕') +
        ' 无处落子，' + msg + '（✕ ' + scoreX + ' : ' + scoreO + ' ◯）';
      return { player, nextBlock };
    }

    setGlow();
    statusEl.textContent = '轮到 ' + (current === 'X' ? '✕' : '◯') +
      ' 落子（只能在 ' + BLOCKS[nextBlock] + ' 区域）';
    render();
    return { player, nextBlock };
  }

  function onCellClick(e) {
    if (readOnly) return;    // 规则介绍页：不可落子
    if (gameOver) return;
    const r = +e.target.dataset.r, c = +e.target.dataset.c;
    const bi = Math.floor(r / 3) * 3 + Math.floor(c / 3);

    // 非法区域拦截
    if (nextBlock !== null && nextBlock !== bi) return;
    if (grid[r][c]) return; // 已有棋子

    const info = applyMove(r, c);
    const cellLetter  = CELLS[(r % 3) * 3 + (c % 3)];   // 玩家落子的小格字母 a~i
    const blockLetter = BLOCKS[info.nextBlock];         // 下一手被指定的区域字母 A~I

    // 规则页练习：玩家只落这一手，落完立刻收回只读（后面的讲解仍由交小薇演示），
    //   并把「落在哪个小格」「下一手被派到哪个区域」告知对话脚本，由它续上下一句台词
    if (rulesMode === 'practice') {
      rulesMode = 'off';
      readOnly = true;
      statusEl.textContent = DEMO_STATUS;
      if (typeof window.rulesAfterPlayerMove === 'function') {
        window.rulesAfterPlayerMove({ cell: cellLetter, block: blockLetter });
      }
      return;
    }

    // 规则页演练循环：玩家每落一手，交小薇都会到「对应区域的 e 号格」回应
    //   （由 dialogue.js 调度：她停 1 秒再落子），把下一手区域重新指回 E，
    //   让玩家永远回到 E 区；直到 E 区被下满为止。
    //   等她的这段时间锁住棋盘，免得玩家顺手替她落子。
    if (rulesMode === 'loop') {
      const gained = scoreO - loopBaselineO;   // 玩家这一手拿到了几分（「本手得分」，用于点评台词）
      loopBaselineO = scoreO;
      if (gameOver || demoFinished) {          // 意外终局 → 安静收尾
        rulesMode = 'off';
        readOnly = true;
        clearGlow();
        statusEl.textContent = DEMO_STATUS;
        return;
      }
      readOnly = true;
      // E 区已被玩家下满 → 这是演练的最后一手，交小薇不再落子（后面只是「纯口头假设」）。
      //   棋盘保持「轮到 ✕」的观感：她的可落子区域仍是绿色呼吸框，她将落的 e 号格
      //   由 render 标成红色结束手提示（win-hint）—— 正好对应她那句
      //   「如果我在该区域的e号格落子，那么下一步你将无法落子」。
      //   等收尾讲解说完，dialogue.js 再调 rulesEndDemo() 一并收干净。
      if (typeof window.rulesAfterLoopMove === 'function') {
        window.rulesAfterLoopMove({
          cell: cellLetter, block: blockLetter, gained: gained
        });
      } else {
        readOnly = false;                      // 没有对话脚本接管就自己放行，避免卡死
      }
      return;
    }
  }

  /* ---------- 按钮绑定（按页面实际存在的按钮） ---------- */
  // 「重新开始」→ 确认弹窗
  if (btnRestart) {
    btnRestart.addEventListener('click', () => {
      window.showConfirm('🔄', '重新开始', '确定要重新开始吗？当前进度将丢失。', init);
    });
  }

  // 「悔棋」→ 确认弹窗
  if (btnUndo) {
    btnUndo.addEventListener('click', () => {
      if (history.length === 0) {
        window.showToast('ℹ️', '无法悔棋', '当前还没有可以悔的棋子');
        return;
      }
      window.showConfirm('↩️', '悔棋', '确定要撤销上一步落子吗？', undo);
    });
  }

  // 「← 主页」→ 确认弹窗 → 返回主页
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      window.showConfirm('🏠', '返回主页', '确定要返回主页吗？当前对局将丢失。', () => {
        location.href = 'index.html';
      });
    });
  }

  /* ---------- 启动 ---------- */
  init();
})();
