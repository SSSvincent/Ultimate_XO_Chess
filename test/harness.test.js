/* ============================================================
   多页版回归测试
   以 DOM 桩 + vm 载入真实源码：js/sky.js、js/modal.js、js/game.js、js/home.js
   覆盖：棋局核心（Ei 场景）、悔棋、泛光、结束手提示、弹窗、页面跳转、规则页只读
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const SKY      = fs.readFileSync(path.join(root, 'js', 'sky.js'), 'utf8');
const MODAL    = fs.readFileSync(path.join(root, 'js', 'modal.js'), 'utf8');
const GAME     = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
const HOME     = fs.readFileSync(path.join(root, 'js', 'home.js'), 'utf8');
const DIALOGUE = fs.readFileSync(path.join(root, 'js', 'dialogue.js'), 'utf8');

/* 所有页面可能出现的元素 id */
const ALL_IDS = [
  'sky','board','status','restart','undo','scoreX','scoreO','crownX','crownO','scoreBoxX','scoreBoxO','labelX',
  'home','game','menuMain','menuSingle','btnRules','btnSingle','btnOnline','btnLocal','btnAi','btnBack','back',
  'modal','modalIcon','modalTitle','modalText','modalActions','modalOk','modalCancel',
  'dialogue','dlgName','dlgText','dlgNext','dlgChoices'
];

/* 规则页专属元素（play 页不存在） */
const RULES_ONLY_IDS = ['dialogue', 'dlgName', 'dlgText', 'dlgNext', 'dlgChoices'];

/* ---------- 构造一个「页面」运行环境 ----------
   mode      : 'play' | 'readonly'    → body[data-mode]
   excludeIds: 该页面上不存在、应返回 null 的元素 id（如规则页没有 restart/undo）
*/
function createEnv(mode, excludeIds) {
  const exclude = excludeIds || [];
  const allEls = [];

  function mk(tag) {
    const e = {
      tag,
      children: [],
      _parent: null,
      dataset: {},
      attrs: {},
      style: {},
      handlers: {},
      classList: {
        _s: new Set(),
        add(...cs) { cs.forEach(c => e.classList._s.add(c)); },
        remove(...cs) { cs.forEach(c => e.classList._s.delete(c)); },
        contains(c) { return e.classList._s.has(c); },
        toggle(c, force) {
          const on = force === undefined ? !e.classList._s.has(c) : !!force;
          on ? e.classList._s.add(c) : e.classList._s.delete(c);
          return on;
        }
      },
      get parentNode() { return e._parent; },
      appendChild(c) {
        if (c._parent) {
          const arr = c._parent.children;
          const i = arr.indexOf(c);
          if (i >= 0) arr.splice(i, 1);
        }
        e.children.push(c);
        c._parent = e;
        return c;
      },
      removeChild(c) {
        const i = e.children.indexOf(c);
        if (i >= 0) { e.children.splice(i, 1); c._parent = null; }
        return c;
      },
      insertBefore(c, ref) {
        if (c._parent) {
          const arr = c._parent.children;
          const i = arr.indexOf(c);
          if (i >= 0) arr.splice(i, 1);
        }
        const idx = ref ? e.children.indexOf(ref) : -1;
        if (idx < 0) e.children.push(c); else e.children.splice(idx, 0, c);
        c._parent = e;
        return c;
      },
      addEventListener(ev, fn) { e.handlers[ev] = fn; },
      removeEventListener(ev) { delete e.handlers[ev]; },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      getAttribute(k) { return e.attrs[k] === undefined ? null : e.attrs[k]; },
      getBoundingClientRect() { return { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 }; },
      get innerHTML() { return ''; },
      set innerHTML(v) { e.children = []; },
      get className() { return [...e.classList._s].join(' '); },
      set className(v) { e.classList._s = new Set(v.split(/\s+/).filter(Boolean)); },
      textContent: ''
    };
    allEls.push(e);
    return e;
  }

  const byId = {};
  ALL_IDS.filter(id => !exclude.includes(id)).forEach(id => { byId[id] = mk('div'); byId[id].id = id; });
  byId['sky'].getContext = () => new Proxy({}, { get: () => () => {} }); // canvas ctx：所有方法空实现
  byId['sky'].width = 0; byId['sky'].height = 0;

  const body = mk('body');
  body.dataset.mode = mode || 'play';

  /* ---- 可控的假定时器：只能在测试里 tick 推进 ---- */
  let clock = 0;
  let seq = 1;
  const tasks = [];   // { id, fn, time, every }
  function _setTimeout(fn, ms) { const id = seq++; tasks.push({ id, fn, time: clock + (ms || 0), every: 0 }); return id; }
  function _setInterval(fn, ms) { const id = seq++; tasks.push({ id, fn, time: clock + (ms || 1), every: (ms || 1) }); return id; }
  function _clear(id) { const i = tasks.findIndex(t => t.id === id); if (i >= 0) tasks.splice(i, 1); }
  const timers = {
    setTimeout: _setTimeout,
    setInterval: _setInterval,
    clearTimeout: _clear,
    clearInterval: _clear,
    _dump() { return { clock, tasks: tasks.map(t => ({ id: t.id, time: t.time, every: t.every })) }; },
    /* 把时间向前推进 ms，按时间顺序执行到期任务 */
    tick(ms) {
      const target = clock + ms;
      let guard = 0;
      while (guard++ < 100000) {
        let next = null;
        for (const t of tasks) if (t.time <= target && (!next || t.time < next.time)) next = t;
        if (!next) break;
        clock = next.time;
        if (next.every > 0) next.time = clock + next.every;
        else { const i = tasks.indexOf(next); if (i >= 0) tasks.splice(i, 1); }
        next.fn();
      }
      clock = target;
    }
  };

  /* ---- 记录 document 级事件监听，供测试触发 ---- */
  const docHandlers = {};

  const sandbox = {
    console,
    document: {
      getElementById: id => byId[id] || null,
      createElement: t => mk(t),
      createElementNS: (ns, t) => mk(t),
      addEventListener(ev, fn) { (docHandlers[ev] = docHandlers[ev] || []).push(fn); },
      removeEventListener(ev, fn) {
        const arr = docHandlers[ev];
        if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }
      },
      body
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    location: { href: '' },
    requestAnimationFrame: () => {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  };
  vm.createContext(sandbox);
  vm.runInContext([SKY, MODAL, GAME, DIALOGUE, HOME].join('\n;\n'), sandbox, { filename: 'bundle.js' });

  return { sandbox, byId, allEls, timers, docHandlers };
}

/* ---------- 断言工具 ---------- */
let PASS = 0, FAIL = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { PASS++; console.log('  ✓ ' + label); }
  else { FAIL++; console.log('  ✗ ' + label + '\n    期望: ' + b + '\n    实际: ' + a); }
}

/* ---------- 各环境下的操作工具 ---------- */
function makeOps(env) {
  // 点击全局坐标 (r,c) 的小格（取最新一次 render 生成的节点）
  function clickCell(r, c) {
    const cell = [...env.allEls].reverse().find(e => e.tag === 'div' && e.dataset.r == r && e.dataset.c == c && e.handlers.click);
    if (!cell) throw new Error('找不到格子 (' + r + ',' + c + ')');
    cell.handlers.click({ target: cell });
    return cell;
  }
  function pos(bi, ci) {
    return [Math.floor(bi / 3) * 3 + Math.floor(ci / 3), (bi % 3) * 3 + (ci % 3)];
  }
  function play(bi, ci) { return clickCell(...pos(bi, ci)); }
  return { clickCell, pos, play };
}

/* ============================================================
   一、对局页（play 模式）
   ============================================================ */
const env = createEnv('play', RULES_ONLY_IDS);
const byId = env.byId;
const { clickCell, play } = makeOps(env);

console.log('===== 场景：E 区填满，最后一手为 Ei =====');
// 落子链（区域索引, 小格索引）：0=A..4=E..8=I
const moves = [
  [4,4], // 1  ✕ E-e → E
  [4,0], // 2  ◯ E-a → A
  [0,4], // 3  ✕ A-e → E
  [4,1], // 4  ◯ E-b → B
  [1,4], // 5  ✕ B-e → E
  [4,2], // 6  ◯ E-c → C
  [2,4], // 7  ✕ C-e → E
  [4,3], // 8  ◯ E-d → D
  [3,4], // 9  ✕ D-e → E
  [4,5], // 10 ◯ E-f → F
  [5,4], // 11 ✕ F-e → E
  [4,6], // 12 ◯ E-g → G
  [6,4], // 13 ✕ G-e → E
  [4,7], // 14 ◯ E-h → H
  [7,4], // 15 ✕ H-e → E
  [4,8], // 16 ◯ E-i → I  ← 用户截图中的最后一手
];
moves.forEach(([b, c], i) => {
  play(b, c);
  if (byId['status'].textContent.includes('游戏结束')) {
    console.log('  （第 ' + (i + 1) + ' 手后意外结束：' + byId['status'].textContent + '）');
  }
});

eq(byId['status'].textContent.includes('游戏结束'), false, 'Ei 落子后游戏未结束');
eq(byId['status'].textContent.includes('轮到 ✕'), true, '轮到 ✕ 落子');
eq(byId['status'].textContent.includes('I 区域'), true, '且只能在 I 区域落子');

// I 区（索引 8）应被绿框标记为可落子
const blocks = [];
for (const e of env.allEls) if (e.classList._s.has('block')) blocks.push(e);
const latestBlocks = blocks.slice(-9); // 最后一次 render 的 9 个大格
eq(latestBlocks[8].classList._s.has('active'), true, 'I 区域有绿框高亮');
eq(latestBlocks[4].classList._s.has('active'), false, 'E 区域不再高亮');

// 继续在 I 区落子应成功：✕ 下 I-a（→ A 区）
play(8, 0);
eq(byId['status'].textContent.includes('轮到 ◯'), true, '✕ 在 I-a 落子成功，轮到 ◯');
eq(byId['status'].textContent.includes('A 区域'), true, '◯ 被指定到 A 区域');

console.log('\n===== 悔棋 =====');
byId['restart'].handlers.click({ target: byId['restart'] });
byId['modalOk'].handlers.click({ target: byId['modalOk'] });   // 确认重开
clickCell(4, 4); // ✕ E-e → E
clickCell(3, 3); // ◯ E-a → A（E 区 a 格 = 全局(3,3)）
eq(byId['status'].textContent.includes('轮到 ✕'), true, '两子后轮到 ✕');
eq(byId['status'].textContent.includes('A 区域'), true, '✕ 应在 A 区域落子');
// 点「悔棋」弹确认框
byId['undo'].handlers.click({ target: byId['undo'] });
eq(byId['modal'].classList._s.has('show'), true, '点"悔棋"后弹出确认框');
eq(byId['modalTitle'].textContent, '悔棋', '确认框标题为"悔棋"');
byId['modalOk'].handlers.click({ target: byId['modalOk'] });  // 确定 → undo
eq(byId['status'].textContent.includes('轮到 ◯'), true, '悔棋后轮到 ◯');
eq(byId['status'].textContent.includes('E 区域'), true, '悔棋后 ◯ 应在 E 区域落子');

console.log('\n===== 泛光：当前玩家模块泛光 / 结束仅获胜方泛光 =====');
eq(byId['scoreBoxO'].classList._s.has('turn-o'), true, '轮到 ◯ 时，◯ 模块泛光');
eq(byId['scoreBoxX'].classList._s.has('turn-x'), false, '◯ 回合 ✕ 模块不泛光');

byId['restart'].handlers.click({ target: byId['restart'] });
byId['modalOk'].handlers.click({ target: byId['modalOk'] });  // 确认重开
eq(byId['scoreBoxX'].classList._s.has('turn-x'), true, '重开后轮到 ✕，✕ 模块泛光');
eq(byId['scoreBoxO'].classList._s.has('turn-o'), false, '✕ 回合 ◯ 模块不泛光');

console.log('\n===== 结束手提示：可结束游戏的格子标淡红 =====');
// 复用「E 区填满」场景：16 手后 E 区已满，轮到 ✕ 在 I 区落子。
// I 区 9 个小格分别指向 A~I，其中 e 格指向已满的 E 区 → 落 e 格即让对手无处落子，应标 win-hint。
byId['restart'].handlers.click({ target: byId['restart'] });
byId['modalOk'].handlers.click({ target: byId['modalOk'] });
moves.forEach(([b, c]) => play(b, c));
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) {
    const r = 6 + i, c = 6 + j;
    const cell = [...env.allEls].reverse().find(e => e.tag === 'div' && e.dataset.r == r && e.dataset.c == c && e.handlers.click);
    const shouldHint = (i * 3 + j) === 4;   // e 格指向 E 区（满）
    eq(cell.classList._s.has('win-hint'), shouldHint,
      'I 区小格(' + i + ',' + j + ')' + (shouldHint ? ' 标结束提示' : ' 不标结束提示'));
  }
}

console.log('\n===== 弹窗：多人联机 / 人机对战 显示"暂未开放" =====');
byId['btnOnline'].handlers.click({ target: byId['btnOnline'] });
eq(byId['modal'].classList._s.has('show'), true, '点击多人联机后弹窗显示');
eq(byId['modalText'].textContent.includes('多人联机'), true, '弹窗文案提到多人联机');
eq(byId['modalOk'].textContent, '知道了', '提示弹窗按钮为"知道了"');
byId['modalOk'].handlers.click({ target: byId['modalOk'] });
eq(byId['modal'].classList._s.has('show'), false, '点"知道了"后弹窗关闭');

byId['btnSingle'].handlers.click({ target: byId['btnSingle'] });   // 切换二级菜单
byId['btnAi'].handlers.click({ target: byId['btnAi'] });
eq(byId['modal'].classList._s.has('show'), true, '点击人机对战弹窗显示');
eq(byId['modalText'].textContent.includes('人机对战'), true, '弹窗文案提到人机对战');
byId['modalOk'].handlers.click({ target: byId['modalOk'] });

console.log('\n===== 页面跳转 =====');
env.sandbox.location.href = '';
byId['btnRules'].handlers.click({ target: byId['btnRules'] });
eq(env.sandbox.location.href, 'rules.html', '点「规则介绍」跳转到 rules.html');

env.sandbox.location.href = '';
byId['btnLocal'].handlers.click({ target: byId['btnLocal'] });
eq(env.sandbox.location.href, 'game.html', '点「本地双人」跳转到 game.html');

env.sandbox.location.href = '';
byId['back'].handlers.click({ target: byId['back'] });
eq(byId['modal'].classList._s.has('show'), true, '对局页点「← 主页」弹出确认框');
eq(byId['modalTitle'].textContent, '返回主页', '确认框标题为"返回主页"');
byId['modalOk'].handlers.click({ target: byId['modalOk'] });
eq(env.sandbox.location.href, 'index.html', '确认后跳转回 index.html');

/* ============================================================
   二、规则介绍页（readonly 模式，且没有 restart/undo 按钮）
   ============================================================ */
console.log('\n===== 规则介绍页：只读演示 + 左侧改名「交小薇」 =====');
const envR = createEnv('readonly', ['restart', 'undo']);
const byIdR = envR.byId;
const opsR = makeOps(envR);

eq(byIdR['labelX'].textContent, '✕ 交小薇', '左侧标签显示「✕ 交小薇」');
eq(byIdR['status'].textContent.includes('规则介绍'), true, '状态栏提示为规则介绍');
eq(!!byIdR['restart'], false, '规则页不存在「重新开始」按钮（未报错即通过）');

// 尝试在 E-e 落子 → 应无效
const beforeStatus = byIdR['status'].textContent;
const cellEE = opsR.clickCell(4, 4);
eq(byIdR['status'].textContent, beforeStatus, '规则介绍页点击棋盘不改变状态（不可落子）');
eq(cellEE.classList._s.has('x'), false, '规则介绍页棋盘未落子');

console.log('\n===== 规则介绍页：galgame 对话框（逐字 / 0.2s 冷却 / 点击推进）=====');
const winR = envR.sandbox.window;
const timersR = envR.timers;
const fireClick = (target) => (envR.docHandlers.click || []).forEach(fn => fn({ target }));

const LINE1 = '你好我是交小薇！';
const LINE2 = '欢迎游玩Dr拾柒的游戏，究极井字棋~';
const LINE3 = '接下来，就由我来教您这个游戏的基本规则吧！';
const LINE4 = '如您所见，这是一个9×9的棋盘，被划分为了9个大区域。';
const LINE5 = '为了方便您理解，我们把这九个区域依次编号为：A B C D E F G H I。';
const LINE6 = '再来看每个区域。每个区域又是一个3×3的子棋盘~';
const LINE7 = '我们将子棋盘，依旧从左到右从上到下编号为：a b c d e f g h i。';
const LINE8 = '以中间E区域为例，像这样~';
const LINE9 = '每个区域的子棋盘上的每一格，都与大棋盘的每个区域一一对应。';
const LINE10 = '如果当前玩家在a号格子落子，那么下一名玩家只能在A区域挑选格子落子。';
const LINE11 = '其余落子规则，以此类推~';
const LINE12 = '先手玩家开始只能在最中间的区域，也就是E号区域落子。可落子的区域都会被绿框标出来。';
const LINE13 = '像这样。';
const LINE14 = '您看，我在E区域的e号格子落子了，那么相应的，轮到您时您就只能在中间的E区域落子啦！';
const LINE15 = '试试看吧！';
const LINE16 = '很好，您在a号格子落子了，那么接下来，我便要在A区域落子。';
// 第十七句不在静态 SCRIPT 里：它由「交小薇落完回应」后动态追加（见 dialogue.js）
const LINE17 = '继续试试看吧！';

eq(byIdR['dlgName'].textContent, '交小薇', '对话框左上角名字为「交小薇」');
eq(winR.dialogueState(), 'typing', '进入规则页后立即开始逐字显示第一句');
eq(byIdR['dlgText'].textContent, '', '刚开始时文本为空');

// 逐字：每 55ms 出现一个字
timersR.tick(55);
eq(byIdR['dlgText'].textContent, '你', '逐字显示：第 1 个字出现');
timersR.tick(55);
eq(byIdR['dlgText'].textContent, '你好', '逐字显示：第 2 个字出现');

// 打字途中点击 → 立即补全（不切下一句）
fireClick(byIdR['dlgText']);
eq(byIdR['dlgText'].textContent, LINE1, '打字中点击：立即补全当前句（第一句是打招呼）');
eq(winR.dialogueState(), 'cooling', '补全后进入 0.2s 冷却态');

// 冷却期内点击无效
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'cooling', '0.2s 内点击不会进入下一句');
eq(byIdR['dlgNext'].classList._s.has('show'), false, '冷却期不显示继续提示');

// 满 0.2s 前一刻仍不可推进
timersR.tick(199);
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'cooling', '未满 0.2s 时点击仍无效');

// 满 0.2s 后就绪
timersR.tick(2);
eq(winR.dialogueState(), 'ready', '满 0.2s 后进入就绪态');
eq(byIdR['dlgNext'].classList._s.has('show'), true, '就绪后显示「▼」继续提示');

// 就绪后点击 → 下一句（第二句）
fireClick(byIdR['dlgText']);
eq(byIdR['dlgText'].textContent, '', '切到第二句：文本清空重新逐字');
eq(winR.dialogueState(), 'typing', '第二句进入逐字状态');
eq(byIdR['board'].classList._s.has('labels-on'), false, '第二句时棋盘还不显示区域字母');

// 第二句完整逐字出现
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE2, '第二句完整显示');
eq(winR.dialogueState(), 'ready', '第二句满 0.2s 后就绪');
eq(byIdR['board'].classList._s.has('labels-on'), false, '第二句结束时仍未显示区域字母');

// 第三句：介绍语（无棋盘动作）
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第三句，进入逐字状态');
eq(byIdR['board'].classList._s.has('labels-on'), false, '第三句时棋盘仍不显示区域字母');
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE3, '第三句完整显示');
eq(winR.dialogueState(), 'ready', '第三句满 0.2s 后就绪');

// 第四句：台词浮现的同时，棋盘九个区域顶部显示 A~I 字母
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第四句，进入逐字状态');
eq(byIdR['board'].classList._s.has('labels-on'), true, '第四句出现时棋盘显示区域字母');
const labels = envR.allEls
  .filter(e => e.dataset && e.dataset.label && e.classList._s.has('block'))
  .map(e => e.dataset.label);
eq(labels.slice(-9).join(''), 'ABCDEFGHI', '九个区域字母从左到右、从上到下依次为 A~I');

timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE4, '第四句完整显示');
eq(winR.dialogueState(), 'ready', '第四句满 0.2s 后就绪');

// 第五句：区域编号说明
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第五句，进入逐字状态');
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE5, '第五句完整显示');
eq(winR.dialogueState(), 'ready', '第五句满 0.2s 后就绪');
eq(byIdR['board'].classList._s.has('labels-on'), true, '第五句期间区域字母继续保持显示');

// 第六句：讲「每个区域又是一个子棋盘」，收起闪烁的大写字母
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第六句，进入逐字状态');
eq(byIdR['board'].classList._s.has('labels-on'), false, '第六句出现时隐藏大区域字母 A~I');
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE6, '第六句完整显示');
eq(winR.dialogueState(), 'ready', '第六句满 0.2s 后就绪');

// 第七句：子棋盘编号 a~i —— 讲编号的同时 E 区小写字母浮现
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第七句，进入逐字状态');
eq(byIdR['board'].classList._s.has('sub-labels-on'), true, '第七句时 E 区小写字母同步出现');
const eBlock6 = envR.allEls
  .filter(e => e.classList._s.has('block') && e.dataset.label === 'E')
  .pop();
eq(eBlock6.children.map(c => c.dataset.label).join(''), 'abcdefghi', 'E 区 9 个小格从左到右、从上到下依次为 a~i');
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE7, '第七句完整显示');
eq(winR.dialogueState(), 'ready', '第七句满 0.2s 后就绪');
eq(byIdR['board'].classList._s.has('labels-on'), false, '第七句仍不显示大区域字母');

// 第八句：以 E 区为例（小写字母保持显示）
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第八句，进入逐字状态');
eq(byIdR['board'].classList._s.has('sub-labels-on'), true, '第八句时小写字母继续保持显示');
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE8, '第八句完整显示');
eq(winR.dialogueState(), 'ready', '第八句满 0.2s 后就绪');

// 第九句：一一对应 —— 大写字母重现 + 8 条指向大区域的箭头
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第九句，进入逐字状态');
eq(byIdR['board'].classList._s.has('labels-on'), true, '第九句时大区域字母重新出现');
eq(byIdR['board'].classList._s.has('sub-labels-on'), true, '第九句时 E 区小写字母仍保持显示');
const svgEl = byIdR['board'].children.find(c => c.classList._s.has('region-arrows'));
eq(!!svgEl, true, '第九句时棋盘内出现箭头覆盖层');
eq(svgEl.classList._s.has('show'), true, '箭头覆盖层处于显示状态');
const arrowLines = svgEl.children.filter(c => c.tag === 'line');
eq(arrowLines.length, 8, '共 8 条箭头（e 格对应 E 区自身，不画）');
eq(arrowLines.every(l => l.attrs['marker-end'] === 'url(#arrow-head)'), true, '每条箭头末端都带箭头尖');
eq(arrowLines.map(l => l.attrs['data-to']).join(','), 'A,B,C,D,F,G,H,I', '每条箭头标注了起点小格与目标区域');
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE9, '第九句完整显示');
eq(winR.dialogueState(), 'ready', '第九句满 0.2s 后就绪');

// 第十句：聚焦 a → A，隐藏其余字母与箭头
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第十句，进入逐字状态');
eq(byIdR['board'].classList._s.has('focus-a'), true, '第十句时进入聚焦模式');
eq(byIdR['board'].classList._s.has('labels-on'), true, '聚焦模式下大区域字母层仍开启（由 CSS 只留 A）');
eq(byIdR['board'].classList._s.has('sub-labels-on'), true, '聚焦模式下小写字母层仍开启（由 CSS 只留 a）');
eq(arrowLines.some(l => l.attrs['data-from'] === 'a' && l.attrs['data-to'] === 'A'), true, '保留 a→A 那一条箭头');
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE10, '第十句完整显示');
eq(winR.dialogueState(), 'ready', '第十句满 0.2s 后就绪');

// 第十句：逐格巡回演示 b~i（小格 → 箭头 → 大区域），一律不闪烁
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第十句，进入逐字状态');
eq(byIdR['board'].classList._s.has('tour-on'), true, '第十句时进入巡回演示模式');
eq(byIdR['board'].classList._s.has('focus-a'), false, '第十句时退出聚焦模式');

// 巡演用的元素查找工具（都取最新一次 render / 最新一组箭头）
const blockOf = lb => envR.allEls.filter(e => e.classList._s.has('block') && e.dataset.label === lb).pop();
const cellOf = lb => blockOf('E').children.find(c => c.dataset.label === lb);
const lineOf = lb => arrowLines.find(l => l.attrs['data-to'] === lb);

timersR.tick(1);                                   // 起步
eq(cellOf('b').classList._s.has('on'), true, '起步：小写 b 出现');
eq(lineOf('B').classList._s.has('on'), false, '起步：b→B 箭头尚未出现');
eq(blockOf('B').classList._s.has('on'), false, '起步：大写 B 尚未出现');

timersR.tick(499);                                 // 累计 500ms
eq(lineOf('B').classList._s.has('on'), true, '0.5s 后：b→B 箭头出现');
eq(blockOf('B').classList._s.has('on'), false, '0.5s 后：大写 B 仍未出现');

timersR.tick(500);                                 // 累计 1000ms
eq(blockOf('B').classList._s.has('on'), true, '1.0s 后：大写 B 出现');

timersR.tick(500);                                 // 累计 1500ms → b 组收起、c 组起步
eq(cellOf('b').classList._s.has('on'), false, '1.5s 后：小写 b 收起');
eq(lineOf('B').classList._s.has('on'), false, '1.5s 后：b→B 箭头收起');
eq(blockOf('B').classList._s.has('on'), false, '1.5s 后：大写 B 收起');
eq(cellOf('c').classList._s.has('on'), true, '紧接 c 组起步：小写 c 出现');
eq(lineOf('C').classList._s.has('on'), false, 'c 组起步时箭头尚未出现');

timersR.tick(3000);                                // 累计 4500ms → e 组起步（b 之后第 4 组）
eq(cellOf('e').classList._s.has('on'), true, 'e 组起步：小写 e 出现');
eq(arrowLines.some(l => l.attrs['data-to'] === 'E'), false, 'e 组不画箭头（e 对应 E 区自身）');

timersR.tick(500);                                 // 累计 5000ms（e 组的箭头档，无箭头 → 无变化）
eq(cellOf('e').classList._s.has('on'), true, 'e 组 0.5s 档：小写 e 仍在（无箭头）');
eq(blockOf('E').classList._s.has('on'), false, 'e 组 0.5s 档：大写 E 仍未出现');

timersR.tick(500);                                 // 累计 5500ms（e 组的大写档）
eq(cellOf('e').classList._s.has('on'), false, 'e 出现 1.0s 后：小写 e 消失');
eq(blockOf('E').classList._s.has('on'), true, '同时：大写 E 出现');

timersR.tick(6500);                                // 累计 12000ms → 整段演示结束
eq(blockOf('I').classList._s.has('on'), false, '演示结束：大写 I 已收起');
eq(cellOf('i').classList._s.has('on'), false, '演示结束：小写 i 已收起');

timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE11, '第十句完整显示');
eq(winR.dialogueState(), 'ready', '第十句满 0.2s 后就绪');

// 第十二句：结束巡演，棋盘回到起始态（仅 E 区绿框；呼吸效果是常驻 CSS，不再靠类切换）
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第十二句，进入逐字状态');
eq(byIdR['board'].classList._s.has('tour-on'), false, '第十二句时退出巡回演示模式');
eq(byIdR['board'].classList._s.has('labels-on'), false, '第十二句时收起大区域字母');
eq(byIdR['board'].classList._s.has('sub-labels-on'), false, '第十二句时收起小写字母');
eq(svgEl.classList._s.has('show'), false, '第十二句时收起箭头层');
// 演示期间残留的 .on 已被清理
eq(cellOf('i').classList._s.has('on'), false, '第十二句时小写字母 .on 已清空');
eq(blockOf('I').classList._s.has('on'), false, '第十二句时大写字母 .on 已清空');
// E 区仍是唯一可落子区域（绿框）
eq(blockOf('E').classList._s.has('active'), true, '第十二句时 E 区仍带绿框（唯一可落子区域）');
eq(blockOf('A').classList._s.has('active'), false, '第十二句时其余区域不带绿框');
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE12, '第十二句完整显示');
eq(winR.dialogueState(), 'ready', '第十二句满 0.2s 后就绪');

// 第十三句：交小薇（✕）在 Ee 落子，带缩放入场
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第十三句，进入逐字状态');
const eCell = cellOf('e');
eq(!!eCell, true, '找到 E 区 e 格（Ee）');
eq(eCell.classList._s.has('x'), true, '第十三句时 Ee 出现 ✕');
eq(eCell.textContent, '✕', '第十三句时 Ee 格文本为 ✕');
eq(eCell.classList._s.has('pop'), true, '第十三句落子带 pop 入场动画');
eq(cellOf('b').classList._s.has('x'), false, 'E 区其余小格不受影响');
eq(blockOf('E').children.filter(c => c.classList._s.has('x') || c.classList._s.has('o')).length, 1, 'E 区只有 Ee 一枚棋子');
eq(blockOf('E').classList._s.has('active'), true, 'Ee 落子后 E 区仍带绿框（仍是可落子区域）');
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE13, '第十三句完整显示');
eq(winR.dialogueState(), 'ready', '第十三句满 0.2s 后就绪');

// 第十四句：解释「落子小格 → 下一手区域」，无附加动作，棋盘仍只读
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第十四句，进入逐字状态');
eq(byIdR['status'].textContent.includes('规则介绍'), true, '第十四句时棋盘仍是只读');
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE14, '第十四句完整显示');
eq(winR.dialogueState(), 'ready', '第十四句满 0.2s 后就绪');

// 第十五句：试一试 —— 打字期间仍只读，「说完后」才解锁
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'typing', '切到第十五句，进入逐字状态');
eq(blockOf('E').classList._s.has('active'), true, '第十五句打字期间 E 区仍带绿框（呼吸常驻）');
eq(byIdR['status'].textContent.includes('规则介绍'), true, '第十五句打字期间仍只读');
timersR.tick(100000);                                  // 逐字完成 → after 触发解锁
eq(byIdR['dlgText'].textContent, LINE15, '第十五句完整显示');
eq(winR.dialogueState(), 'ready', '第十五句满 0.2s 后就绪');
eq(blockOf('E').classList._s.has('active'), true, '解锁后 E 区绿框仍在（呼吸不中断，与对局页一致）');
eq(byIdR['status'].textContent.includes('轮到 ◯'), true, '解锁后轮到 ◯（玩家）落子');
eq(byIdR['status'].textContent.includes('E 区域'), true, '解锁后只能在 E 区域落子');

// 交小薇的演示 ✕ 已同步进棋局状态（重新 render 后仍在）
eq(cellOf('e').classList._s.has('x'), true, '解锁后 Ee 仍是 ✕（演示落子已同步进棋局）');
eq(cellOf('e').textContent, '✕', '解锁后 Ee 文本为 ✕');

// 现在玩家真正可以落子：◯ 下 E-a（全局 3,3）
const statusBeforePlay = byIdR['status'].textContent;
opsR.clickCell(3, 3);
eq(byIdR['status'].textContent !== statusBeforePlay, true, '解锁后点击棋盘会真正落子（状态改变）');
eq(cellOf('a').classList._s.has('o'), true, '解锁后 ◯ 落在 E-a 成功');

// 落完这一手 → 立刻收回只读，并接上一句动态台词（延后一个宏任务才开始）
eq(winR.dialogueState(), 'ready', '玩家落子当下动态台词还未开始（延后一个宏任务）');
eq(byIdR['status'].textContent.includes('规则介绍'), true, '玩家落子后立刻回到只读演示');
// 真实浏览器里，落子那一下点击还会冒泡到 document → advance()；此时旧台词已说完，落到 done
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'done', '落子的同一下点击冒泡到 document：旧台词收尾为 done');
timersR.tick(1);
eq(winR.dialogueState(), 'typing', '动态台词在下一宏任务开始逐字显示');
eq(byIdR['dlgText'].textContent, '', '动态台词从空开始逐字');

timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE16, '动态台词带上了玩家落子的小格 a 与对应区域 A');
eq(winR.dialogueState(), 'ready', '动态台词满 0.2s 后就绪');

// 台词说完后交小薇并不立刻落子 —— 要等玩家点击推进，且点击后再间隔 0.5 秒才落
//   （注意：落子会触发 render 重建棋盘，必须每次都重新查询，不能缓存元素引用）
const aE = () => blockOf('A').children.find(c => c.dataset.label === 'e');
eq(aE().classList._s.has('x'), false, '台词刚说完时交小薇尚未落子（等她回应）');

// 玩家点击推进：台词收尾为 done，同时排好 0.5 秒后的落子
fireClick(byIdR['dlgText']);
eq(winR.dialogueState(), 'done', '点击推进后台词进入结束态');
eq(byIdR['dlgText'].textContent, LINE16, '结束态仍保留最后一句文本');
timersR.tick(400);
eq(aE().classList._s.has('x'), false, '点击后 0.4s 交小薇仍未落子（还差一点）');
timersR.tick(100);
eq(aE().classList._s.has('x'), true, '点击后满 0.5s 交小薇在 A 区 e 号格落子');
eq(aE().textContent, '✕', 'A 区 e 号格文本为 ✕');
eq(blockOf('A').children.filter(c => c.classList._s.has('x') || c.classList._s.has('o')).length, 1, 'A 区只有一枚棋子');
eq(byIdR['status'].textContent.includes('规则介绍'), true, '交小薇落子后棋盘仍停在只读演示');
eq(byIdR['scoreBoxX'].classList._s.has('turn-x'), false, '收尾后 ✕ 模块不再泛光');
eq(byIdR['scoreBoxO'].classList._s.has('turn-o'), false, '收尾后 ◯ 模块不再泛光（避免"轮到你"的错觉）');

// 她落完子 → 接上「继续试试看吧！」（动态追加），并从这一刻开始逐字
eq(winR.dialogueState(), 'typing', '交小薇落子后接上「继续试试看吧！」');
eq(byIdR['dlgText'].textContent, '', '新一句从交小薇落子那一刻开始逐字');

// 这句打字期间棋盘仍是只读：点棋盘（哪怕是可落子的 E 区）无效
const statusAfterLock = byIdR['status'].textContent;
opsR.clickCell(...opsR.pos(4, 1));                        // E-b
eq(byIdR['status'].textContent, statusAfterLock, '「继续试试看吧！」打字期间点击棋盘无效');
eq(cellOf('b').classList._s.has('o'), false, '打字期间 ◯ 无法落子');
eq(blockOf('E').children.filter(c => c.classList._s.has('x') || c.classList._s.has('o')).length, 2, 'E 区仍只有 Ee ✕ 与 Ea ◯ 两枚棋子');

// 「继续试试看吧！」说完 → 解除只读，进入演练循环
timersR.tick(100000);
eq(byIdR['dlgText'].textContent, LINE17, '「继续试试看吧！」完整显示');
eq(winR.dialogueState(), 'ready', '「继续试试看吧！」满 0.2s 后就绪');
eq(byIdR['status'].textContent.includes('轮到 ◯'), true, '说完后轮到 ◯（玩家）落子');
eq(byIdR['status'].textContent.includes('E 区域'), true, '此时玩家正在 E 区域落子（绿框所指）');

console.log('\n===== 规则页：演练循环（轮到交小薇后停 1 秒再落到对应区域 e 号格）=====');
const dlgR = byIdR['dlgText'];
// 某区域 e 号格 / 某区域内指定字母的小格（每次都重新查询：落子会触发 render 重建棋盘）
const cellIn = (lb, cl) => blockOf(lb).children.find(c => c.dataset.label === cl);
const eOf   = lb => cellIn(lb, 'e');
// 真实浏览器里，点击棋盘的那一下还会冒泡到 document 触发台词推进；桩环境不自动冒泡，这里手动补上
function playBoard(bi, ci) { opsR.play(bi, ci); fireClick(byIdR['dlgText']); }

// 第一轮：玩家 E-b → 轮到交小薇 → 1 秒后她落 B-e
playBoard(4, 1);
eq(cellOf('b').classList._s.has('o'), true, '循环第一轮：玩家在 E-b 落子成功');
eq(byIdR['status'].textContent.includes('轮到 ✕'), true, '玩家落子后轮到 ✕（交小薇）');
eq(byIdR['status'].textContent.includes('B 区域'), true, '交小薇被指定到 B 区域');
eq(eOf('B').classList._s.has('x'), false, '此时她还没有落子');
// 等她回应的这一秒里，棋盘锁住，玩家不能替她落子
const statusWaiting = byIdR['status'].textContent;
opsR.play(4, 2);                                             // E-c：应无效
eq(byIdR['status'].textContent, statusWaiting, '等待交小薇回应期间点击棋盘无效');
eq(cellOf('c').classList._s.has('o'), false, '等待期间 ◯ 无法落子');
timersR.tick(999);
eq(eOf('B').classList._s.has('x'), false, '玩家落子后 0.999s 交小薇仍未落子');
timersR.tick(1);
eq(eOf('B').classList._s.has('x'), true, '玩家落子满 1s：交小薇在 B 区 e 号格落子');
eq(eOf('B').textContent, '✕', 'B 区 e 号格文本为 ✕');
eq(byIdR['status'].textContent.includes('轮到 ◯'), true, '她回应后轮回玩家');
eq(byIdR['status'].textContent.includes('E 区域'), true, '玩家又被指回 E 区域（回到 E 区落子）');

console.log('\n----- 本手拿到 1 分（E-c）：交小薇先点评两句，再继续落子 -----');
playBoard(4, 2);                                             // E-c → E 区 a b c 三连
eq(cellOf('c').classList._s.has('o'), true, '玩家在 E-c 落子成功');
eq(byIdR['scoreO'].textContent, 1, '这一手让玩家得分变为 1（E 区 a b c 三连）');
eq(winR.dialogueState(), 'done', '得分变化的当下，点评台词还没开始（延后一个宏任务）');
eq(eOf('C').classList._s.has('x'), false, '点评期间她尚未落子');
timersR.tick(1);
eq(winR.dialogueState(), 'typing', '点评台词开始逐字显示');
timersR.tick(100000);
eq(dlgR.textContent, '恭喜，您成功拿到了一分！', '点评第一句：恭喜拿到一分');
eq(winR.dialogueState(), 'ready', '点评第一句满 0.2s 后就绪');
eq(eOf('C').classList._s.has('x'), false, '点评期间她一直没有落子');
fireClick(dlgR);
eq(dlgR.textContent, '', '点评第二句从空开始逐字');
timersR.tick(100000);
eq(dlgR.textContent, '让我们先继续吧~', '点评第二句：让我们先继续吧~');
timersR.tick(5000);
eq(eOf('C').classList._s.has('x'), false, '玩家没点掉点评，她就一直不落子');
fireClick(dlgR);                                             // 点掉最后一句 → 她才落子
eq(winR.dialogueState(), 'done', '点评说完、玩家点击后回到结束态');
timersR.tick(999);
eq(eOf('C').classList._s.has('x'), false, '点评结束后 0.999s 她仍未落子');
timersR.tick(1);
eq(eOf('C').classList._s.has('x'), true, '点评结束满 1s：她在 C 区 e 号格落子');
eq(byIdR['status'].textContent.includes('轮到 ◯'), true, '点评完她落子 → 轮回玩家');
eq(byIdR['status'].textContent.includes('E 区域'), true, '玩家回到 E 区域');

console.log('\n----- 本手又是 1 分（E-g）：1 分档已播报过，不再重复点评 -----');
playBoard(4, 3);                                             // E-d：不得分
eq(cellOf('d').classList._s.has('o'), true, '玩家在 E-d 落子成功');
eq(winR.dialogueState(), 'done', '不得分的一手没有点评台词');
timersR.tick(100000);
eq(eOf('D').classList._s.has('x'), true, '她 1 秒后在 D 区 e 号格落子');
eq(byIdR['status'].textContent.includes('E 区域'), true, '玩家回到 E 区域');

playBoard(4, 6);                                             // E-g → E 区 a d g 三连，本手 +1
eq(cellOf('g').classList._s.has('o'), true, '玩家在 E-g 落子成功');
eq(byIdR['scoreO'].textContent, 2, '这一手让玩家总分到 2（本手得分仍是 1）');
eq(winR.dialogueState(), 'done', '1 分档已播报过 → 本手再拿 1 分也不再点评');
timersR.tick(100000);
eq(eOf('G').classList._s.has('x'), true, '她 1 秒后在 G 区 e 号格落子');
eq(byIdR['status'].textContent.includes('E 区域'), true, '玩家回到 E 区域');

console.log('\n----- 此后延续同样的落子逻辑（本手不得分就不点评），直到 E 区被下满 -----');
playBoard(4, 5);                                             // E-f → F 区（本手不得分）
eq(cellOf('f').classList._s.has('o'), true, '玩家在 E-f 落子成功');
eq(winR.dialogueState(), 'done', '本手不得分 → 没有点评');
timersR.tick(100000);
eq(eOf('F').classList._s.has('x'), true, '她在 F 区 e 号格落子');
eq(byIdR['status'].textContent.includes('E 区域'), true, '玩家回到 E 区域');

playBoard(4, 7);                                             // E-h → H 区（本手不得分）
eq(cellOf('h').classList._s.has('o'), true, '玩家在 E-h 落子成功');
eq(winR.dialogueState(), 'done', '本手不得分 → 没有点评');
timersR.tick(100000);
eq(eOf('H').classList._s.has('x'), true, '她在 H 区 e 号格落子');
eq(byIdR['status'].textContent.includes('E 区域'), true, '玩家回到 E 区域');

console.log('\n----- 最后一手 E-i：首次本手一步两分（同时完成 g h i 与 c f i 两条线）→ 点评三句，随后收尾讲解 -----');
playBoard(4, 8);                                             // E-i：E 区最后一格
eq(cellOf('i').classList._s.has('o'), true, '玩家在 E-i 落子成功（E 区最后一格）');
eq(byIdR['scoreO'].textContent, 4, '这一手一步两分，玩家总分从 2 跳到 4');
eq(blockOf('E').children.filter(c => c.classList._s.has('x') || c.classList._s.has('o')).length, 9, 'E 区已被下满（9 格全满）');

// E 区被填满的当下：交小薇不再落子，但棋盘保持「轮到 ✕」的观感 ——
//   她的可落子区域 I 仍是绿色呼吸框，她将落的 I-e 标成红色结束手提示，
//   正好对应她紧接着那句「如果我在该区域的e号格落子，那么下一步你将无法落子」。
eq(byIdR['status'].textContent.includes('轮到 ✕'), true, '收尾阶段状态栏仍是「轮到 ✕」');
eq(byIdR['status'].textContent.includes('I 区域'), true, '交小薇被指定在 I 区域落子');
eq(blockOf('I').classList._s.has('active'), true, '她的可落子区域 I 保持绿色呼吸框');
eq(blockOf('E').classList._s.has('active'), false, '已下满的 E 区不再高亮');
eq(cellIn('I', 'e').classList._s.has('win-hint'), true, '她将落的 I-e 保持红色结束手提示');
eq(cellIn('I', 'a').classList._s.has('win-hint'), false, 'I 区其他格不标结束手提示');
eq(byIdR['crownO'].classList._s.has('show'), false, '收尾后不亮皇冠');
eq(byIdR['scoreBoxO'].classList._s.has('turn-o'), false, '收尾后 ◯ 模块不再泛光');

eq(winR.dialogueState(), 'done', '得分变化的当下点评还没开始（延后一个宏任务）');
timersR.tick(1);
timersR.tick(100000);
eq(dlgR.textContent, '我的天哇！一步两分！', '按本手得分触发：本手 2 分 → 点评第一句');
fireClick(dlgR);
timersR.tick(100000);
eq(dlgR.textContent, '这也在您的预料之中嘛！', '本手 2 分 → 点评第二句');
fireClick(dlgR);
timersR.tick(100000);
eq(dlgR.textContent, '让我们先继续下~', '本手 2 分 → 点评第三句');
eq(eOf('I').classList._s.has('x'), false, '三句点评期间她一直没有落子');
fireClick(dlgR);
eq(winR.dialogueState(), 'done', '点评说完进入结束态（收尾台词延后一个宏任务才开始）');
eq(eOf('I').classList._s.has('x'), false, '收尾台词开始前她仍未落子');

console.log('\n----- 收尾：她只用「纯口头假设」讲完「无法落子 → 结束」与计分、胜负（绿框与红格一直在） -----');
timersR.tick(1);
eq(winR.dialogueState(), 'typing', '收尾台词开始逐字显示');
timersR.tick(100000);
eq(dlgR.textContent, '请看向I区域，如果我在该区域的e号格落子，那么下一步你将无法落子。',
   '收尾第一句：点出她的可落子区域 I（纯口头假设，她不会真的落子）');
eq(eOf('I').classList._s.has('x'), false, '这句期间她没有落子');
// 讲这句时，绿框仍亮在她的可落子区域上，红格仍标在她「假设会落」的 e 号格上
eq(blockOf('I').classList._s.has('active'), true, '讲这句时 I 区绿色呼吸框没有消失');
eq(cellIn('I', 'e').classList._s.has('win-hint'), true, '讲这句时 I-e 红色结束手提示没有消失');

fireClick(dlgR);                                             // 玩家点击推进 → 不再等她落子，直接讲结束与计分
eq(eOf('I').classList._s.has('x'), false, '点击推进后她始终没有落子（纯口头假设）');
eq(winR.dialogueState(), 'done', '点击后进入结束态（结束语延后一个宏任务才开始）');
timersR.tick(1);
eq(winR.dialogueState(), 'typing', '结束语开始逐字显示');

// 结束条件 → 计分 → 胜负
timersR.tick(100000);
eq(dlgR.textContent, '如果当前玩家无法落子，那么游戏结束。', '收尾第二句：无法落子即游戏结束');
eq(blockOf('I').classList._s.has('active'), true, '讲第二句时 I 区绿色呼吸框仍在');
eq(cellIn('I', 'e').classList._s.has('win-hint'), true, '讲第二句时 I-e 红色结束手提示仍在');
fireClick(dlgR);
timersR.tick(100000);
eq(dlgR.textContent, '玩家每不跨区域将三子连成一条线，便会获得一分。', '收尾第三句：一区域三连线得一分');
eq(blockOf('I').classList._s.has('active'), true, '讲第三句时 I 区绿色呼吸框仍在');
eq(cellIn('I', 'e').classList._s.has('win-hint'), true, '讲第三句时 I-e 红色结束手提示仍在');
fireClick(dlgR);
timersR.tick(100000);
eq(dlgR.textContent, '游戏结束时得分较多的玩家将会获胜~', '收尾第四句：得分多者获胜');
eq(blockOf('I').classList._s.has('active'), true, '讲第四句时 I 区绿色呼吸框仍在');
eq(cellIn('I', 'e').classList._s.has('win-hint'), true, '讲第四句时 I-e 红色结束手提示仍在');

fireClick(dlgR);
timersR.tick(100000);
eq(dlgR.textContent, '好了，现在您学会了这个游戏的所有规则。', '收尾第五句：学会全部规则');
eq(blockOf('I').classList._s.has('active'), true, '讲第五句时 I 区绿色呼吸框仍在');
eq(cellIn('I', 'e').classList._s.has('win-hint'), true, '讲第五句时 I-e 红色结束手提示仍在');

fireClick(dlgR);
timersR.tick(1);
eq(winR.dialogueState(), 'typing', '末句开始逐字显示');
eq(blockOf('I').classList._s.has('active'), true, '末句逐字显示时 I 区绿色呼吸框还在');
eq(cellIn('I', 'e').classList._s.has('win-hint'), true, '末句逐字显示时 I-e 红色结束手提示还在');
timersR.tick(100000);
eq(dlgR.textContent, '您可以选择结束教程，也可以选择和交小薇完成这盘棋。', '收尾第六句：给出两个选择');

console.log('\n----- 收尾选项：对话框里弹出「结束教程 / 完成对局」 -----');
eq(byIdR['dlgChoices'].classList._s.has('show'), true, '末句说完后选项容器弹出');
const choicesR = byIdR['dlgChoices'].children;
eq(choicesR.length, 2, '选项容器里有两个按钮');
eq(choicesR[0].textContent, '结束教程', '第一个选项是「结束教程」');
eq(choicesR[1].textContent, '完成对局', '第二个选项是「完成对局」');
eq(choicesR[1].classList._s.has('primary'), true, '「完成对局」是主选项（高亮）');
eq(byIdR['dlgNext'].classList._s.has('show'), false, '弹出选项后不再显示「继续」提示');

// 选项弹出时棋盘仍停在她的回合：绿框与红格都还在 —— 红格指的就是她随后的收尾一手
eq(byIdR['status'].textContent.includes('轮到 ✕'), true, '挑选项期间状态栏仍是「轮到 ✕」');
eq(blockOf('I').classList._s.has('active'), true, '挑选项期间 I 区绿色呼吸框还在');
eq(cellIn('I', 'e').classList._s.has('win-hint'), true, '挑选项期间 I-e 红色结束手提示还在');
eq(byIdR['crownO'].classList._s.has('show'), false, '此时还没判胜负，不亮皇冠');
eq(byIdR['scoreBoxO'].classList._s.has('turn-o'), false, '此时 ◯ 模块不泛光（是她的回合）');
eq(winR.dialogueState(), 'ready', '末句就绪（等玩家在两个选项里挑一个）');

// 挑选项期间玩家点棋盘也无效（棋盘仍是只读的）
const statusEnd = byIdR['status'].textContent;
opsR.clickCell(3, 3);                                        // E-a（已有子）
eq(byIdR['status'].textContent, statusEnd, '挑选项期间点击棋盘不改变状态');

// 选「完成对局」→ 目前与人机对战一致，先弹「暂未开放」（棋盘保持现状，还能改选「结束教程」）
envR.sandbox.location.href = '';
choicesR[1].handlers.click({ target: choicesR[1] });
eq(byIdR['modal'].classList._s.has('show'), true, '选「完成对局」弹出提示');
eq(byIdR['modalText'].textContent.includes('人机对战'), true, '提示文案提到人机对战');
eq(envR.sandbox.location.href, '', '选「完成对局」不会离开当前页');
eq(cellIn('I', 'e').classList._s.has('x'), false, '选「完成对局」不会让她落子');
eq(byIdR['dlgChoices'].classList._s.has('show'), true, '选「完成对局」后选项仍留着（可改选「结束教程」）');
byIdR['modalOk'].handlers.click({ target: byIdR['modalOk'] });

console.log('\n----- 选「结束教程」：不直接回主页，交小薇先落下收尾那一手 → 判胜负、显示获胜者 -----');
envR.sandbox.location.href = '';
choicesR[0].handlers.click({ target: choicesR[0] });
eq(byIdR['dlgChoices'].classList._s.has('show'), false, '点「结束教程」后选项收了起来');
eq(envR.sandbox.location.href, '', '点「结束教程」不立刻回主页（先演示她的收尾一手）');
eq(cellIn('I', 'e').classList._s.has('x'), false, '点击后她还没落子（先停一下再落）');
timersR.tick(499);
eq(cellIn('I', 'e').classList._s.has('x'), false, '点击后 0.499s 她仍未落子');
timersR.tick(1);
eq(cellIn('I', 'e').classList._s.has('x'), true, '点击后满 0.5s：她在 I 区 e 号格落下收尾那一手');
eq(eOf('I').textContent, '✕', 'I-e 上是她的 ✕');

// 这一手把下一手指回已满的 E 区 → 玩家无处可落 → 棋局走正常的结束判定
eq(byIdR['status'].textContent.includes('游戏结束'), true, '玩家无处可落 → 游戏结束');
eq(byIdR['status'].textContent.includes('◯ 无处落子'), true, '状态栏指出无处可落的是 ◯（玩家）');
eq(byIdR['status'].textContent.includes('◯ 玩家获胜'), true, '状态栏显示获胜者：◯ 玩家获胜');
eq(byIdR['scoreX'].textContent, 0, '交小薇 0 分（✕ 都落在各区域 e 格，没能连成线）');
eq(byIdR['scoreO'].textContent, 4, '玩家 4 分（E 区四条线）');
eq(byIdR['crownO'].classList._s.has('show'), true, '◯ 模块亮出皇冠（获胜者）');
eq(byIdR['crownX'].classList._s.has('show'), false, '✕ 模块不亮皇冠');
eq(byIdR['scoreBoxO'].classList._s.has('win-o'), true, '◯ 模块泛获胜光效');
eq(byIdR['scoreBoxX'].classList._s.has('win-x'), false, '✕ 模块不泛获胜光效');
eq(blockOf('E').classList._s.has('final-win-o'), true, '触发结束的 E 区用获胜方颜色标注');
eq(blockOf('I').classList._s.has('active'), false, '结束后不再有绿色呼吸框');
eq(cellIn('I', 'e').classList._s.has('win-hint'), false, '结束后红色结束手提示消失');

// 她再补一句收尾台词；玩家点击后才回主页
eq(winR.dialogueState(), 'typing', '她落完子后接上收尾台词');
timersR.tick(100000);
eq(dlgR.textContent, '咦，这盘棋是您赢了呀！那么教程就到这里啦，我们下次再见~', '收尾台词点出获胜结果');
eq(byIdR['status'].textContent.includes('游戏结束'), true, '讲这句时棋局保持「游戏结束」态');
fireClick(dlgR);
eq(winR.dialogueState(), 'done', '玩家点击后对话结束');
timersR.tick(1);
eq(envR.sandbox.location.href, 'index.html', '收尾台词点掉后才返回主页 index.html');

// 规则页「← 主页」也能返回
envR.sandbox.location.href = '';
byIdR['back'].handlers.click({ target: byIdR['back'] });
byIdR['modalOk'].handlers.click({ target: byIdR['modalOk'] });
eq(envR.sandbox.location.href, 'index.html', '规则页「← 主页」返回 index.html');

console.log('\n结果: ' + PASS + ' 通过, ' + FAIL + ' 失败');
process.exit(FAIL ? 1 : 0);
