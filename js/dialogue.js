/* ============================================================
   规则介绍 · galgame 对话框（仅 rules.html 使用）
   行为：
     1. 每句台词逐字出现
     2. 文本完全展现后，再等 0.2s 才允许推进
     3. 点击屏幕任意位置：
          - 打字中       → 立即补全当前句（不进入下一句）
          - 0.2s 冷却中  → 忽略
          - 已就绪       → 进入下一句
          - 全部说完     → 结束（保持最后一句）
   玩家练习落子（最后一场交互）：
     玩家在 E 区落一手 → 立刻收回只读 → 弹出动态台词
     → 玩家点击推进这句 → 再间隔 0.5s，交小薇才在对应区域的 e 号格落子
     → 她落完接上「继续试试看吧！」，这句说完后进入「演练循环」：
         轮到交小薇时她停 1 秒再落到「对应区域的 e 号格」，
         把下一手区域重新指回 E；如此往复，直到 E 区被下满为止
         期间玩家「本手得分」首次为 1 / 2 分时，她会停下来点评两句/三句，点评完再继续落子
         E 区被下满后收尾：她先不落子（纯口头假设，绿框与红格一直亮着）
         → 讲完「无法落子即结束 / 计分 / 得分多者获胜 / 学会全部规则」后，
           对话框里弹出「结束教程 / 完成对局」两个选项：
             结束教程 → 她才真正落下那一手（最后区域的 e 号格）→ 棋局判胜负、亮皇冠、给出比分
                        → 她再补一句收尾台词 → 玩家点击后回主页
             完成对局 → 暂未开放（占位提示，棋盘保持现状）
   对外暴露（供测试）：
     window.dialogueAdvance()   推进一次（等价于点击）
     window.dialogueState()     返回当前状态字符串
   ============================================================ */
(function () {
  const box = document.getElementById('dialogue');
  if (!box) return;                       // 非规则页（无对话框）则不初始化

  const nameEl = document.getElementById('dlgName');
  const textEl = document.getElementById('dlgText');
  const nextEl = document.getElementById('dlgNext');
  const choicesEl = document.getElementById('dlgChoices');   // 收尾选项容器（rules.html）

  const NAME = '交小薇';

  const BLOCKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];  // 大区域：从左到右、从上到下
  const CELLS  = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];  // 子棋盘小格：从左到右、从上到下

  // 棋盘区域字母（A~I）开关：由 game.js 渲染的 data-label 配合 CSS 显示
  function setBoardLabels(on) {
    const b = document.getElementById('board');
    if (b) b.classList.toggle('labels-on', on);
  }

  // 子棋盘小格字母（a~i）开关：仅在中间的 E 区域显示
  function setSubLabels(on) {
    const b = document.getElementById('board');
    if (b) b.classList.toggle('sub-labels-on', on);
  }

  // 聚焦模式（a → A）：只保留 A 区大写字母、E 区 a 格的小写字母、
  //   以及 a 指向 A 的那一条箭头（其余字母与箭头由 CSS 依 #board.focus-a 隐藏）
  function setFocusA(on) {
    const b = document.getElementById('board');
    if (b) b.classList.toggle('focus-a', on);
  }

  /* ---------- 逐格巡回演示：小格 → 箭头 → 对应大区域 ---------- */
  //   每一格 1.5s：小写出现 → 0.5s 后箭头出现 → 再 0.5s 后大写出现 → 再 0.5s 整组收起
  //   特例：e 格没有箭头，小写 e 出现 1s 后直接消失、同时换成大写 E
  //   演示期间由 #board.tour-on 接管显示（只有带 .on 的那一个元素露出来），且一律不闪烁
  const TOUR_STEP = 500;
  const TOUR_LIFE = 1500;              // 一组的总时长（3 档）
  let tourTimers = [];

  function boardBlocks() {
    const b = document.getElementById('board');
    return b ? Array.prototype.slice.call(b.children)
      .filter(el => el && el.classList && el.classList.contains('block')) : [];
  }

  function blockElOf(label) {
    return boardBlocks().find(el => el.dataset && el.dataset.label === label) || null;
  }

  function cellElOf(label) {           // 小写字母都在中间的 E 区里
    const e = blockElOf('E');
    if (!e) return null;
    return Array.prototype.slice.call(e.children)
      .find(c => c && c.dataset && c.dataset.label === label) || null;
  }

  function arrowElOf(label) {          // data-to 等于目标区域的箭头（如 A）
    if (!arrowSvg) return null;
    return Array.prototype.slice.call(arrowSvg.children)
      .find(el => el.classList && el.classList.contains('arrow-line') &&
                  el.getAttribute('data-to') === label) || null;
  }

  function setOn(el, on) {
    if (el) el.classList.toggle('on', on);
  }

  function clearTour() {
    tourTimers.forEach(function (t) { clearTimeout(t); });
    tourTimers = [];
    const b = document.getElementById('board');
    if (!b) return;
    boardBlocks().forEach(function (bl) {
      bl.classList.remove('on');
      Array.prototype.slice.call(bl.children).forEach(function (c) { c.classList.remove('on'); });
    });
    if (arrowSvg) {
      Array.prototype.slice.call(arrowSvg.children).forEach(function (l) {
        if (l.classList) l.classList.remove('on');
      });
    }
  }

  function startTour() {
    const b = document.getElementById('board');
    if (!b) return;
    clearTour();
    b.classList.add('tour-on');

    let t = 0;
    for (let i = 1; i < 9; i++) {      // b~i（a 已在聚焦那一段讲过）
      const low = CELLS[i], up = BLOCKS[i];
      const base = t;
      const hasArrow = (i !== 4);      // e 格对应 E 区自身，没有箭头
      tourTimers.push(setTimeout(function () {
        setOn(cellElOf(low), true);                       // 0ms：小写出现
      }, base));
      if (hasArrow) {
        tourTimers.push(setTimeout(function () {
          setOn(arrowElOf(up), true);                     // 0.5s：箭头出现
        }, base + TOUR_STEP));
      }
      tourTimers.push(setTimeout(function () {
        if (hasArrow) {
          setOn(blockElOf(up), true);                     // 1.0s：大写出现
        } else {
          setOn(cellElOf(low), false);                    // e：小写收起
          setOn(blockElOf(up), true);                     //    同时大写 E 出现
        }
      }, base + TOUR_STEP * 2));
      tourTimers.push(setTimeout(function () {            // 1.5s：整组收起
        setOn(cellElOf(low), false);
        setOn(arrowElOf(up), false);
        setOn(blockElOf(up), false);
      }, base + TOUR_LIFE));
      t += TOUR_LIFE;
    }
  }

  // 结束巡回演示：停掉所有挂起的定时器、清掉 .on，并收起字母层与箭头，
  //   使棋盘回到「干净」状态（只留下可落子区域的绿框）
  function endTour() {
    clearTour();
    const b = document.getElementById('board');
    if (b) b.classList.remove('tour-on');
    setBoardLabels(false);
    setSubLabels(false);
    setArrows(false);
  }

  // 在指定小格落一枚棋子（规则页讲解用：直接改 DOM，不经过棋局状态机）
  //   blockLabel 大区域 A~I，cellLabel 小格 a~i，mark 'X' / 'O'
  function placeMark(blockLabel, cellLabel, mark) {
    const block = blockElOf(blockLabel);
    if (!block) return;
    const cell = Array.prototype.slice.call(block.children)
      .find(c => c && c.dataset && c.dataset.label === cellLabel);
    if (!cell) return;
    cell.classList.add(mark.toLowerCase());        // 'x' / 'o'
    cell.textContent = mark === 'X' ? '✕' : '◯';
    cell.classList.remove('pop');
    void cell.offsetWidth;                         // 强制重排 → 让 pop 入场动画重新播放
    cell.classList.add('pop');
  }

  // 讲解结束：把练习落子同步进棋局并解除只读 —— 玩家从此可以真正落子
  //   （绿框呼吸是常驻样式，无需在切换时增删类）
  function unlockPlay() {
    if (typeof window.rulesGrantPlay === 'function') {
      window.rulesGrantPlay(4, 4, 'X');            // E 区 e 格 = 全局 (4,4)，交小薇执 ✕
    }
  }

  // 大区域字母 + 小格字母 → 全局坐标 (r, c)
  function globalPos(blockLabel, cellLabel) {
    const bi = BLOCKS.indexOf(blockLabel);
    const ci = CELLS.indexOf(cellLabel);
    if (bi < 0 || ci < 0) return null;
    return [Math.floor(bi / 3) * 3 + Math.floor(ci / 3), (bi % 3) * 3 + (ci % 3)];
  }

  // 运行中追加一句台词并立即开始显示（用于「玩家落子」后的动态反馈）
  //   line = { text, enter?, after?, onAdvance? }（也可直接传字符串）
  function startDynamicLine(line) {
    SCRIPT.push(typeof line === 'string' ? { text: line } : line);
    startLine(SCRIPT.length - 1);
  }

  // 运行中追加多句台词，从句首开始逐句显示（用于得分后的连续点评）
  function startDynamicLines(lines) {
    if (!lines || !lines.length) return;
    const from = SCRIPT.length;
    lines.forEach(function (l) {
      SCRIPT.push(typeof l === 'string' ? { text: l } : l);
    });
    startLine(from);
  }

  // 交小薇「听到」玩家推进后，间隔这么久才落子（营造她先思考再落子的感觉）
  const RESPONSE_DELAY = 500;

  // 演练循环里：玩家落子后，交小薇间隔这么久才到对应区域的 e 号格落子
  const LOOP_DELAY = 1000;

  // 演练循环的引导语（交小薇落完第一手回应后接上）
  const LOOP_LINE = '继续试试看吧！';

  // 演练循环里，玩家「本手得分」为 1 / 2 分及以上时交小薇的点评
  //   —— 按「这一手拿到了几分」触发（不看累计总分），说完最后一句她才继续落子
  const SCORE_COMMENTS = {
    1: ['恭喜，您成功拿到了一分！', '让我们先继续吧~'],
    2: ['我的天哇！一步两分！', '这也在您的预料之中嘛！', '让我们先继续下~']
  };

  // 每一档只播「首次」：本手第一次拿到 1 分 / 2 分时点评，之后同样的本手得分不再重复
  const playedComments = { 1: false, 2: false };

  // 收尾讲解：E 区被下满后，她先不落子（只是「纯口头假设」）——
  //   棋盘停在她的回合观感上：她的可落子区域保持绿色呼吸框，她将落的 e 号格标成红色结束手提示；
  //   绿框与红格会一直亮到玩家在两个选项里做出选择（红格指的就是她随后要落的那一格）。
  const END_LINES = [
    '如果当前玩家无法落子，那么游戏结束。',
    '玩家每不跨区域将三子连成一条线，便会获得一分。',
    '游戏结束时得分较多的玩家将会获胜~',
    '好了，现在您学会了这个游戏的所有规则。',
    { text: '您可以选择结束教程，也可以选择和交小薇完成这盘棋。',
      after: showChoices }                     // 末句说完 → 弹出「结束教程 / 完成对局」
  ];

  // 收尾时她「将会落到」的那一格（最后区域的 e 号格）—— 就是红格所指的那一格。
  //   玩家点「结束教程」后，她在这里真正落子（见 endTutorial）。
  let finalPos = null;

  /* ---------- 收尾选项：对话框里弹出「结束教程 / 完成对局」 ---------- */
  let choicesShown = false;      // 选项已弹出 → 不再显示右下角的「继续」提示

  function showChoices() {
    if (!choicesEl) return;
    choicesShown = true;
    nextEl.classList.remove('show');          // 有选项了，不再提示「点击继续」
    choicesEl.innerHTML = '';                 // 幂等：重复调用只重建一次内容
    addChoice('结束教程', false, endTutorial);
    addChoice('完成对局', true, function () {
      // TODO(待定)：这里的行为还未最终确定（跳对局页 / 本页接着下 / 暂未开放）。
      //   现在与人机对战保持一致，先弹「暂未开放」；棋盘保持现状，玩家还可以改选「结束教程」。
      window.showToast('🚧', '暂未开放', '与交小薇对弈（人机对战）功能正在开发中，敬请期待');
    });
    choicesEl.classList.add('show');
  }

  /* 「结束教程」：不直接回主页 —— 交小薇先真正落下收尾那一手
     （就是讲解里点出的「最后区域的 e 号格」，也是此刻标着红格的那一格）。
     这一手过后玩家正好无处可落，棋局于是走正常的结束判定：亮皇冠、给出比分、显示获胜者。
     之后再补一句收尾台词，玩家点击后才回主页。 */
  function endTutorial() {
    choicesShown = false;                                        // 选项撤下 → 恢复「点击继续」提示
    if (choicesEl) { choicesEl.classList.remove('show'); choicesEl.innerHTML = ''; }
    // 停顿一下再落子（与她其它回合的节奏一致：先想一下再落）
    setTimeout(function () {
      let result = null;
      if (finalPos && typeof window.rulesFinalMove === 'function') {
        result = window.rulesFinalMove(finalPos[0], finalPos[1]);
      }
      startDynamicLine({ text: closingText(result), onAdvance: goHome });
    }, RESPONSE_DELAY);
  }

  // 收尾台词随胜负变化（这场演示里玩家 4 : 0 获胜，但三种结果都留了话）
  function closingText(result) {
    const w = result && result.winner;
    if (w === 'O') return '咦，这盘棋是您赢了呀！那么教程就到这里啦，我们下次再见~';
    if (w === 'X') return '这盘棋是我赢啦~ 不过您已经学会了全部规则，那么教程就到这里啦！';
    return '这盘棋打了个平手！那么教程就到这里啦，我们下次再见~';
  }

  // 收尾台词说完、玩家点击 → 回主页（延后一个宏任务，避开 advance() 随后的「下一句」处理）
  function goHome() {
    setTimeout(function () { location.href = 'index.html'; }, 0);
  }

  // 生成一个选项按钮
  function addChoice(text, primary, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dlg-choice' + (primary ? ' primary' : '');
    btn.textContent = text;
    btn.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();   // 别让点击冒泡去推进对话
      onClick();
    });
    choicesEl.appendChild(btn);
  }

  // E 区是否已被下满（玩家在 E 区的最后一手落完后即为真）
  function eRegionFull() {
    const e = blockElOf('E');
    if (!e) return false;
    let n = 0;
    Array.prototype.slice.call(e.children).forEach(function (c) {
      if (c.classList && (c.classList.contains('x') || c.classList.contains('o'))) n++;
    });
    return n === 9;
  }

  /* ---------- 玩家在规则页练习落子后的回调（由 game.js 调用） ----------
     info = { cell: 玩家落子的小格字母 a~i, block: 这手棋派给下一手的区域字母 A~I }
     此时 game.js 已把棋盘收回只读；这里接上一句动态台词，
     台词「说完后」交小薇在对应区域的 e 号格落子（走真实棋局逻辑）。 */
  window.rulesAfterPlayerMove = function (info) {
    const cell  = (info && info.cell)  || '';
    const block = (info && info.block) || '';
    const text  = '很好，您在' + cell + '号格子落子了，那么接下来，我便要在' + block + '区域落子。';
    // 延后一个宏任务：触发本次落子的那一下点击还会冒泡到 document 去 advance()，
    //   若在这里同步开新句，会被那一下点击立刻「补全」，看不到逐字效果。
    setTimeout(function () {
      startDynamicLine({
        text: text,
        // 玩家点击推进这句后，再间隔 0.5 秒，交小薇才在对应区域的 e 号格落子
        onAdvance: function () {
          setTimeout(function () {
            const pos = globalPos(block, 'e');
            if (pos && typeof window.rulesScriptMove === 'function') {
              window.rulesScriptMove(pos[0], pos[1]);
            }
            // 她落完子 → 接上「继续试试看吧！」；这句话说完后开始演练循环
            startDynamicLine({ text: LOOP_LINE, after: startPracticeLoop });
          }, RESPONSE_DELAY);
        }
      });
    }, 0);
  };

  /* ---------- 演练循环：玩家每落一手，交小薇 1 秒后到「对应区域的 e 号格」回应 ----------
     玩家总在 E 区落子，而她的这一手会把下一手区域重新指回 E，于是玩家永远回到 E 区；
     如此往复，直到 E 区被下满 —— 此时她先停下不落子（绿框与红格保持亮着），
     只用「纯口头假设」补完「无法落子 → 结束」与计分、胜负的讲解，
     最后弹出「结束教程 / 完成对局」两个选项。 */
  let loopTimer = null;

  // 开始演练循环：由 game.js 解除只读，之后玩家的每一手都会回调 rulesAfterLoopMove
  function startPracticeLoop() {
    if (typeof window.rulesStartLoop === 'function') window.rulesStartLoop();
  }

  // game.js 在演练循环里每收到玩家一手就回调一次
  //   info = { cell: 玩家落子的小格字母 a~i, block: 这手棋派给下一手的区域字母 A~I }
  window.rulesAfterLoopMove = function (info) {
    const block  = (info && info.block)  || '';
    const gained = (info && info.gained) || 0;   // 玩家这一手新拿到的分数（本手得分）
    const pos = globalPos(block, 'e');           // 交小薇只会落在该区域的 e 号格
    if (!pos) return;

    // 她到对应区域的 e 号格落子（把下一手指回 E 区）
    function reply() {
      if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }

      // E 区已被玩家下满 → 这是收尾：她先一步都不落（后面只是「纯口头假设」）。
      //   棋盘保持「轮到 ✕」的观感（绿框仍亮在她可落子的区域、她将落的 e 号格标红），
      //   她借此点出自己的可落子区域、说明这手会造成什么，再补上结束条件与计分规则。
      //   绿框与红格会一直亮到玩家选完选项 —— 选「结束教程」时她才真正落下这一手
      //   （见 endTutorial 与 game.js 的 window.rulesFinalMove）。
      if (eRegionFull()) {
        finalPos = pos;      // 记下她将会落到的那一格（红格所指），供「结束教程」时真正落子
        setTimeout(function () {
          startDynamicLine({
            text: '请看向' + block + '区域，如果我在该区域的e号格落子，那么下一步你将无法落子。',
            // 玩家点掉这句后，直接讲「结束」与「计分」（她不再落子）。
            // 延后一个宏任务：推进时 advance() 紧接着还会 startLine(index+1)，
            //   若在这里同步追加，会被它立刻「重播」；与上面几句同理。
            onAdvance: function () {
              setTimeout(function () {
                startDynamicLines(END_LINES);
              }, 0);
            }
          });
        }, 0);
        return;
      }

      loopTimer = setTimeout(function () {
        loopTimer = null;
        if (typeof window.rulesLoopMove === 'function') {
          window.rulesLoopMove(pos[0], pos[1]);
        }
      }, LOOP_DELAY);
    }

    // 按「本手得分」触发点评：这一手拿 1 分播两句；拿 2 分及以上播三句；
    //   且每档只在「首次」播报 —— 之后同样的本手得分不再重复
    const tier = gained >= 2 ? 2 : (gained === 1 ? 1 : 0);
    const comments = (tier && !playedComments[tier]) ? SCORE_COMMENTS[tier] : null;
    if (!comments) { reply(); return; }          // 本手没得分（或该档已播过）：照旧直接回应
    playedComments[tier] = true;                 // 记下这一档已经播报过

    // 本手首次拿到 1 / 2 分：先让交小薇点评；玩家点掉最后一句后她才落子，循环继续
    setTimeout(function () {
      startDynamicLines(comments.map(function (text, i) {
        return {
          text: text,
          onAdvance: (i === comments.length - 1) ? reply : undefined
        };
      }));
    }, 0);
  };

  /* ---------- 指向大区域的箭头（E 区 9 小格 ↔ 9 大区域 一一对应） ---------- */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let arrowSvg = null;

  // 依据棋盘真实几何，从 E 区每个小格中心画一条指向对应大区域中心的箭头
  //   - e 格（索引 4）对应的就是 E 区自身，不画
  //   - 起点落在 E 区边界，终点停在目标区域中心稍靠内处（不压住字母正中）
  function buildArrows() {
    const b = document.getElementById('board');
    if (!b || !b.getBoundingClientRect) return null;
    const bRect = b.getBoundingClientRect();
    const blocks = Array.prototype.slice.call(b.children)
      .filter(el => el && el.classList && el.classList.contains('block'));
    if (blocks.length !== 9) return null;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('region-arrows');
    svg.setAttribute('viewBox', '0 0 ' + Math.round(bRect.width) + ' ' + Math.round(bRect.height));

    // 箭头尖（沿用 SVG marker，随线方向自动旋转）
    const defs = document.createElementNS(SVG_NS, 'defs');
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', 'arrow-head');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '4');
    marker.setAttribute('markerHeight', '4');
    marker.setAttribute('orient', 'auto');
    const head = document.createElementNS(SVG_NS, 'path');
    head.setAttribute('d', 'M0 0 L10 5 L0 10 Z');
    head.classList.add('arrow-head');
    marker.appendChild(head);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const eCells = blocks[4].children;   // E 区 9 个小格，顺序即 a~i
    for (let i = 0; i < 9; i++) {
      if (i === 4) continue;             // e → E 自己，跳过
      const cRect = eCells[i].getBoundingClientRect();
      const tRect = blocks[i].getBoundingClientRect();
      const cx = cRect.left - bRect.left + cRect.width / 2;
      const cy = cRect.top - bRect.top + cRect.height / 2;
      const tx = tRect.left - bRect.left + tRect.width / 2;
      const ty = tRect.top - bRect.top + tRect.height / 2;
      const x1 = cx + (tx - cx) * 0.25;  // 从小格中心沿连线走到 E 区边界
      const y1 = cy + (ty - cy) * 0.25;
      const x2 = tx + (cx - tx) * 0.25;  // 指向目标区域中心，稍留一点距离
      const y2 = ty + (cy - ty) * 0.25;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1.toFixed(1));
      line.setAttribute('y1', y1.toFixed(1));
      line.setAttribute('x2', x2.toFixed(1));
      line.setAttribute('y2', y2.toFixed(1));
      line.setAttribute('data-from', CELLS[i]);   // 起点小格（如 a）
      line.setAttribute('data-to', BLOCKS[i]);    // 目标区域（如 A），供聚焦/巡回模式筛选
      line.classList.add('arrow-line');
      line.setAttribute('marker-end', 'url(#arrow-head)');
      svg.appendChild(line);
    }
    return svg;
  }

  function setArrows(on) {
    const b = document.getElementById('board');
    if (!b) return;
    if (on) {
      // 棋盘被重建过（render）时旧 svg 会失效，这里按需重建
      if (!arrowSvg || !arrowSvg.parentNode) {
        arrowSvg = buildArrows();
        if (arrowSvg) b.appendChild(arrowSvg);
      }
      if (arrowSvg) arrowSvg.classList.add('show');
    } else if (arrowSvg) {
      arrowSvg.classList.remove('show');
    }
  }

  // 窗口尺寸变化会改变棋盘几何，箭头需要按新尺寸重算（否则会指偏）
  window.addEventListener('resize', function () {
    if (!arrowSvg || !arrowSvg.parentNode) return;
    const b = document.getElementById('board');
    const fresh = buildArrows();
    if (!fresh) return;
    b.removeChild(arrowSvg);
    arrowSvg = fresh;
    b.appendChild(arrowSvg);
    arrowSvg.classList.add('show');
  });

  // 让棋盘上的闪烁元素（大写字母 / 小写字母 / 指向箭头）从同一时刻开始闪烁
  //   三者共用同一个 region-blink 动画（时长 1.6s、延迟 0.55s 完全一致），
  //   因此只要在同一帧里被点亮，相位就会永久保持同步。
  //   做法：先把两类字母关掉并强制重排（丢弃旧的动画时间线），再同时点亮。
  function restartBlink() {
    const b = document.getElementById('board');
    if (!b) return;
    b.classList.remove('labels-on', 'sub-labels-on');
    void b.offsetWidth;                       // 触发重排：让下面的重新添加从 0 时刻开始动画
    b.classList.add('labels-on', 'sub-labels-on');
  }

  // 全部台词（后续新增台词直接往数组里加即可）
  //   { text, enter?, after?, onAdvance? }
  //     enter：该句开始出现时同时触发的动作
  //     after：该句文本「说完后」才触发的动作（如最后一句说完后解锁棋盘让玩家落子）
  //     onAdvance：该句「被玩家点击推进」时触发的动作（如交小薇停顿 1 秒再落子）
  const SCRIPT = [
    { text: '你好我是交小薇！' },
    { text: '欢迎游玩Dr拾柒的游戏，究极井字棋~' },
    { text: '接下来，就由我来教您这个游戏的基本规则吧！' },
    { text: '如您所见，这是一个9×9的棋盘，被划分为了9个大区域。',
      enter: function () { setBoardLabels(true); } },
    { text: '为了方便您理解，我们把这九个区域依次编号为：A B C D E F G H I。' },
    { text: '再来看每个区域。每个区域又是一个3×3的子棋盘~',
      enter: function () { setBoardLabels(false); } },   // 讲完大区域编号，收起闪烁的大写字母
    { text: '我们将子棋盘，依旧从左到右从上到下编号为：a b c d e f g h i。',
      enter: function () { setSubLabels(true); } },        // 讲编号的同时，E 区 9 个小格浮出小写字母
    { text: '以中间E区域为例，像这样~' },                   // 小写字母已在上一句出现，这里只作说明
    { text: '每个区域的子棋盘上的每一格，都与大棋盘的每个区域一一对应。',
      enter: function () { restartBlink(); setArrows(true); } },  // 大写字母重现 + 8 条箭头（与小写字母同相位闪烁）
    { text: '如果当前玩家在a号格子落子，那么下一名玩家只能在A区域挑选格子落子。',
      enter: function () { setFocusA(true); } },           // 只留下 A、a 和 a→A 那条箭头
    { text: '其余落子规则，以此类推~',
      enter: function () { setFocusA(false); startTour(); } }, // b~i 逐格巡回演示（小格→箭头→大区域）
    { text: '先手玩家开始只能在最中间的区域，也就是E号区域落子。可落子的区域都会被绿框标出来。',
      enter: function () { endTour(); } },                 // 结束演示，棋盘回到起始态：仅 E 区带绿框（呼吸常驻）
    { text: '像这样。',
      enter: function () { placeMark('E', 'e', 'X'); } },  // 交小薇（✕）在 Ee 落子，带缩放入场
    { text: '您看，我在E区域的e号格子落子了，那么相应的，轮到您时您就只能在中间的E区域落子啦！' },
    { text: '试试看吧！',
      after: function () { unlockPlay(); } }               // 这句「说完后」才解除只读，交棋盘给玩家
  ];

  const TYPE_SPEED   = 55;    // 每个字的间隔（ms）
  const ADVANCE_DELAY = 200;  // 完全展现后需等待的冷却时间（ms）

  let index = -1;             // 当前句索引
  let typed = 0;              // 已显示的字数
  let fullText = '';          // 当前句完整文本
  let state = 'idle';         // 'idle' | 'typing' | 'cooling' | 'ready' | 'done'
  let typeTimer = null;       // 逐字定计时器
  let readyTimer = null;      // 冷却计时器
  let pendingAfter = null;    // 当前句「说完后」要执行的动作（{ text, after } 里的 after）
  let pendingAdvance = null;  // 当前句「被玩家点击推进」时要执行的动作（{ text, onAdvance }）

  function clearTimers() {
    if (typeTimer)  { clearInterval(typeTimer); typeTimer = null; }
    if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
  }

  // 文本完全展现（打字结束或点击补全）→ 进入 0.2s 冷却
  function completeTyping() {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    typed = fullText.length;
    textEl.textContent = fullText;
    nextEl.classList.remove('show');
    if (pendingAfter) {                    // 「说完后」动作：文本一展现完就执行
      const f = pendingAfter;
      pendingAfter = null;
      f();
    }
    state = 'cooling';
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = setTimeout(function () {
      readyTimer = null;
      state = 'ready';
      if (!choicesShown) nextEl.classList.add('show');   // 已弹选项时不再提示「继续」
    }, ADVANCE_DELAY);
  }

  // 开始第 i 句
  function startLine(i) {
    clearTimers();
    if (i >= SCRIPT.length) {       // 没有更多台词
      state = 'done';
      nextEl.classList.remove('show');
      return;
    }
    index = i;
    const line = SCRIPT[i];
    fullText = typeof line === 'string' ? line : line.text;
    typed = 0;
    textEl.textContent = '';
    nextEl.classList.remove('show');
    state = 'typing';
    // 该句开始出现的同时，触发配套动作（如点亮棋盘区域字母）
    if (line && typeof line === 'object' && typeof line.enter === 'function') line.enter();
    // 该句「说完后」要执行的动作（如最后一句说完后解锁棋盘让玩家落子）
    pendingAfter = (line && typeof line === 'object' && typeof line.after === 'function') ? line.after : null;
    // 该句「被玩家点击推进」时要执行的动作（当前仅用于交小薇落子前的停顿）
    pendingAdvance = (line && typeof line === 'object' && typeof line.onAdvance === 'function') ? line.onAdvance : null;
    typeTimer = setInterval(function () {
      typed++;
      textEl.textContent = fullText.slice(0, typed);
      if (typed >= fullText.length) completeTyping();
    }, TYPE_SPEED);
  }

  // 推进一次（点击任意位置的效果）
  function advance() {
    if (state === 'typing')  { completeTyping(); return; }   // 打字中：立即补全
    if (state === 'cooling') { return; }                     // 冷却中：忽略
    if (state === 'ready') {                                 // 就绪：下一句
      if (pendingAdvance) {                                  // 先把「点击时」的动作执行掉
        const f = pendingAdvance;
        pendingAdvance = null;
        f();
      }
      startLine(index + 1);
      return;
    }
    // 'idle' / 'done'：无操作
  }

  function init() {
    nameEl.textContent = NAME;
    playedComments[1] = false;              // 重新开始讲解：点评播报次数一并复位
    playedComments[2] = false;
    startLine(0);
  }

  // 点击屏幕任意位置推进（弹窗打开 / 点击工具栏或收尾选项时不处理）
  document.addEventListener('click', function (e) {
    const modal = document.getElementById('modal');
    if (modal && modal.classList.contains('show')) return;
    const t = e && e.target;
    if (t && t.closest && t.closest('.toolbar')) return;
    if (t && t.closest && t.closest('.dlg-choices')) return;
    advance();
  });

  // 暴露给测试
  window.dialogueAdvance = advance;
  window.dialogueState = function () { return state; };

  init();
})();
