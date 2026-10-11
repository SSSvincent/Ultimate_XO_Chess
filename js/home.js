/* ============================================================
   主页菜单逻辑
   仅 index.html 使用。依赖 js/modal.js 的 window.showToast
   「规则介绍」→ rules.html ；「本地双人」→ game.html
   ============================================================ */
(function () {
  const homeEl = document.getElementById('home');
  if (!homeEl) return;

  const menuMain   = document.getElementById('menuMain');
  const menuSingle = document.getElementById('menuSingle');
  const btnRules   = document.getElementById('btnRules');
  const btnSingle  = document.getElementById('btnSingle');
  const btnOnline  = document.getElementById('btnOnline');
  const btnLocal   = document.getElementById('btnLocal');
  const btnAi      = document.getElementById('btnAi');
  const btnBack    = document.getElementById('btnBack');

  // 一级菜单
  btnRules.addEventListener('click', () => { location.href = 'rules.html'; });
  btnSingle.addEventListener('click', () => {
    // 切换为二级菜单
    menuMain.style.display = 'none';
    menuSingle.style.display = 'flex';
  });
  btnOnline.addEventListener('click', () => {
    window.showToast('🚧', '暂未开放', '多人联机功能正在开发中，敬请期待');
  });

  // 二级菜单
  btnLocal.addEventListener('click', () => { location.href = 'game.html'; });
  btnAi.addEventListener('click', () => {
    window.showToast('🚧', '暂未开放', '人机对战功能正在开发中，敬请期待');
  });
  btnBack.addEventListener('click', () => {
    menuSingle.style.display = 'none';
    menuMain.style.display = 'flex';
  });
})();
