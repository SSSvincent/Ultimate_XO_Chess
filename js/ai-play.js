/* ============================================================
   究极井字棋 · 人机对局调度
   仅 ai.html 使用，依赖 js/ai.js 与 js/game.js。

   职责：
     - 从 URL 参数 ?ai=... 读出对手与难度
     - 把对手名字/难度标签写进界面
     - 玩家（✕）落子后，若轮到 AI（◯）且棋局未结束，
       延时一段时间再调 window.aiChooseMove 决策并落子
   ============================================================ */
(function () {
  const board = document.getElementById('board');
  if (!board) return;

  // 对手配置（名字 + 难度档）
  const OPPONENTS = {
    xiaoyan:      { name: '燕小北', tag: '简单', diff: 'easy' },
    jiaoxiaowei:  { name: '交小薇', tag: '较难', diff: 'hard' }
  };

  // 从 URL 读对手（默认燕小北）
  const qs = new URLSearchParams(window.location.search);
  let aiKey = qs.get('ai') || 'xiaoyan';
  if (!OPPONENTS[aiKey]) aiKey = 'xiaoyan';
  const OPP = OPPONENTS[aiKey];

  // AI 落子前的「思考」延时
  const THINK_DELAY = 600;

  const labelO = document.getElementById('labelO');
  const statusEl = document.getElementById('status');

  let busy = false;      // AI 正在思考/落子，期间阻止重复调度
  let timer = null;

  // 更新对手显示名（把「◯ 对手」换成「◯ 燕小北（简单）」之类）
  if (labelO) {
    labelO.textContent = '◯ ' + OPP.name + '（' + OPP.tag + '）';
  }

  // 当前是否轮到 AI（◯）
  function isAiTurn(state) {
    return !state.gameOver && state.current === 'O';
  }

  // 尝试让 AI 落子
  function maybeAiMove() {
    if (!window.gameGetState || !window.aiChooseMove || !window.aiApplyMove) return;
    const st = window.gameGetState();
    if (!isAiTurn(st)) return;      // 不是 AI 的回合
    if (busy) return;               // 已有一轮在跑
    busy = true;

    if (timer) { clearTimeout(timer); timer = null; }
    timer = setTimeout(function () {
      timer = null;
      // 决策前再取一次最新状态（防止期间被悔棋/重开改变）
      const s = window.gameGetState();
      if (!isAiTurn(s)) { busy = false; return; }
      const mv = window.aiChooseMove(s.grid, s.current, s.nextBlock, OPP.diff);
      if (mv) {
        window.aiApplyMove(mv.r, mv.c);
      }
      busy = false;
      // 落完后再检查一次：万一 AI 落子后又轮到自己（不会，因为 AI 是 O、玩家是 X），无需递归
    }, THINK_DELAY);
  }

  // 观察棋盘：玩家每落一手（DOM 变化）就尝试触发 AI。
  // 重开 / 悔棋都会触发 render 重建棋盘，同样会走这里重新判断，无需额外监听按钮。
  const observer = new MutationObserver(maybeAiMove);
  observer.observe(board, { childList: true, subtree: true });

  // 页面加载后，若初始就轮到 AI（理论上玩家先手不会），做一次兜底
  maybeAiMove();

  // 暴露给测试
  window.aiPlayState = function () {
    return { opponent: aiKey, name: OPP.name, diff: OPP.diff, busy: busy };
  };
})();
