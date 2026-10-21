/* ============================================================
   究极井字棋 · 自适应布局
   目标：棋盘永远完整可见 —— 同时受「窗口宽」和「窗口高」双重约束，
        手机竖屏 / 手机横屏 / 桌面拖动窗口，都不需要横向滚动，也不需要缩放页面。

   做法：
     1. 量出棋盘之外的内容（标题、工具栏、状态栏、得分面板、对话框…）各占了多少宽高；
     2. 把剩下的空间换算成单格边长 cell = (min(可用宽, 可用高) - 棋盘间距/内边距) / 9；
     3. 把 cell 写进 #board 的 CSS 变量 --cell，样式表里所有棋盘尺寸都由它推导；
     4. 窗口尺寸变化、设备旋转、地址栏收放、对话框变高（比如收尾选项弹出）时重算。

   依赖：css/style.css 中的 --cell / --gap-cell / --gap-block / --pad-board
   对外：window.fitBoard()   手动重算一次
        window.onBoardResize  可选钩子 —— 棋盘尺寸真的变了才回调（规则页用它重算箭头）
   ============================================================ */
(function () {
  const board = document.getElementById('board');
  if (!board) return;                                   // 主页等没有棋盘的页面直接跳过
  if (typeof window.getComputedStyle !== 'function') return;   // 非浏览器环境（如测试桩）

  const MIN_CELL = 18;      // 单格最小边长：再小就不好点了，此时宁可让页面纵向滚动
  const MAX_CELL = 52;      // 单格最大边长（桌面端原始尺寸，不再放大）

  let scheduled = false;
  let lastCell = 0;
  let didFit = false;

  function num(v, fb) {
    const n = parseFloat(v);
    return isFinite(n) ? n : fb;
  }

  function visible(el) {
    return !!el && el.offsetParent !== null;
  }

  // 从 :root 读一个数值型 CSS 变量（媒体查询可能改过它，所以每次现读）
  function cssNum(name, fb) {
    const cs = window.getComputedStyle(document.documentElement);
    return num(cs.getPropertyValue(name), fb);
  }

  function measure() {
    const wrap = (board.closest && board.closest('.wrap')) || board.parentNode;
    const playarea = board.parentNode;
    if (!wrap || !playarea) return;

    // 移动端优先用 visualViewport（地址栏收起/展开时更准）
    const vv = window.visualViewport;
    const vw = (vv && vv.width) || window.innerWidth || 0;
    const vh = (vv && vv.height) || window.innerHeight || 0;

    const wrapCS = window.getComputedStyle(wrap);
    const padX = num(wrapCS.paddingLeft, 0) + num(wrapCS.paddingRight, 0);
    const padY = num(wrapCS.paddingTop, 0) + num(wrapCS.paddingBottom, 0);
    const wrapGap = num(wrapCS.rowGap, num(wrapCS.gap, 0));

    // ---- 可用宽度 ----
    const wrapW = Math.min(wrap.clientWidth || vw, vw) - padX;

    // ---- 可用高度：视口高 - 上下内边距 - 棋盘之外所有内容（含间距）----
    let reservedH = 0;
    const kids = wrap.children || [];
    for (let i = 0; i < kids.length; i++) {
      const ch = kids[i];
      if (ch === playarea || !visible(ch)) continue;
      const r = ch.getBoundingClientRect();
      reservedH += (r.height || 0) + wrapGap;
    }

    // ---- 得分面板：横排（桌面）占宽度，竖排（手机）占高度 ----
    const paCS = window.getComputedStyle(playarea);
    const stacked = String(paCS.flexDirection || '').indexOf('column') === 0;
    // 窄屏下 .playarea 是横向滚动容器：两侧信息留在棋盘左右，用滑动查看，
    //   不参与棋盘宽度的扣减 —— 棋盘必须独占整行、完整可见。
    const scrollX = /^(auto|scroll)$/.test(String(paCS.overflowX || ''));
    const paGap = num(stacked ? paCS.rowGap : paCS.columnGap, 0);
    let panelW = 0, panelH = 0, panelCount = 0;
    const paKids = playarea.children || [];
    for (let i = 0; i < paKids.length; i++) {
      const ch = paKids[i];
      if (ch === board || !visible(ch)) continue;
      const r = ch.getBoundingClientRect();
      panelW += r.width || 0;
      panelH += r.height || 0;
      panelCount++;
    }
    if (panelCount) {
      if (stacked) panelH += paGap * panelCount;
      else panelW += paGap * panelCount;
    }

    const availW = wrapW - ((stacked || scrollX) ? 0 : panelW);
    // 内容超出视口时 clientHeight 会变大，这里用 min(...,vh) 夹住，避免「越大越算大」的死循环
    const availH = Math.min(wrap.clientHeight || vh, vh) - padY - reservedH - (stacked ? panelH : 0);

    // ---- 换算单格边长 ----
    // 盘宽 = 9*cell + 6*gapCell(每个大区 2 条) + 2*gapBlock + 2*padBoard
    const chrome = 6 * cssNum('--gap-cell', 2)
                 + 2 * cssNum('--gap-block', 8)
                 + 2 * cssNum('--pad-board', 8);
    const side = Math.min(availW, availH, MAX_CELL * 9 + chrome);
    let cell = Math.floor((side - chrome) / 9);
    if (!isFinite(cell)) return;
    cell = Math.max(MIN_CELL, Math.min(MAX_CELL, cell));

    const changed = cell !== lastCell;
    if (changed) {
      lastCell = cell;
      board.style.setProperty('--cell', cell + 'px');

      // 棋盘尺寸变化后，通知需要重算几何的地方（规则页的指向箭头）
      if (typeof window.onBoardResize === 'function') {
        try { window.onBoardResize(); } catch (e) { /* 钩子异常不影响布局 */ }
      }
    }

    // 窄屏：两侧信息留在棋盘左右。
    //   内容比容器宽 → 左对齐 + 把初始滚动位置居中到棋盘，之后玩家左右滑动看两侧；
    //   内容放得下 → 直接居中，不留偏心的空白。
    if (scrollX) {
      playarea.style.justifyContent = 'flex-start';     // 先按可滚动排版再量，避免中心对齐裁掉左侧导致量偏
      const max = playarea.scrollWidth - playarea.clientWidth;
      if (max > 1) {
        if (changed || !didFit) playarea.scrollLeft = Math.round(max / 2);
      } else {
        playarea.style.justifyContent = 'center';       // 放得下就居中，不留偏心空白
      }
    }
    didFit = true;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    const raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () {
      scheduled = false;
      measure();
    });
  }

  window.fitBoard = measure;

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  if (window.visualViewport && window.visualViewport.addEventListener) {
    window.visualViewport.addEventListener('resize', schedule);
  }

  // 对话框高度变化（逐字台词变长、收尾选项弹出）时也要重新分配高度
  if (typeof window.ResizeObserver !== 'undefined') {
    const ro = new window.ResizeObserver(schedule);
    const dlg = document.getElementById('dialogue');
    if (dlg) ro.observe(dlg);
  }

  // 字体加载完成后文字尺寸会变，补算一次
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(schedule).catch(function () {});
  }

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule);

  schedule();
})();
