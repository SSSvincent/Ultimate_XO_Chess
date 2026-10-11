/* ============================================================
   通用弹窗组件（所有页面共用）
   对外暴露（挂在 window 上）：
     window.showToast(icon, title, text)                提示型：单个「知道了」按钮
     window.showConfirm(icon, title, text, onConfirm)   确认型：取消 + 确定
     window.hideModal()                                 手动关闭
   ============================================================ */
(function () {
  const modal = document.getElementById('modal');
  if (!modal) return;

  const modalIcon = document.getElementById('modalIcon');
  const modalTitle = document.getElementById('modalTitle');
  const modalText = document.getElementById('modalText');
  const modalOk = document.getElementById('modalOk');
  const modalCancel = document.getElementById('modalCancel');

  let confirmCallback = null;   // 确定按钮的回调

  // 提示型弹窗（单个「知道了」按钮）
  function showToast(icon, title, text) {
    confirmCallback = null;
    modalIcon.textContent = icon;
    modalTitle.textContent = title;
    modalText.textContent = text;
    modalOk.textContent = '知道了';
    modalOk.classList.remove('danger');
    modalCancel.style.display = 'none';
    modal.classList.add('show');
  }

  // 确认型弹窗（取消 + 确定）
  function showConfirm(icon, title, text, onConfirm) {
    confirmCallback = onConfirm;
    modalIcon.textContent = icon;
    modalTitle.textContent = title;
    modalText.textContent = text;
    modalOk.textContent = '确定';
    modalOk.classList.remove('danger');
    modalCancel.style.display = 'inline-block';
    modal.classList.add('show');
  }

  function hideModal() {
    modal.classList.remove('show');
    confirmCallback = null;
  }

  modalOk.addEventListener('click', () => {
    const cb = confirmCallback;
    hideModal();               // 先取出回调再关闭，避免被 hideModal 清空
    if (cb) cb();
  });
  modalCancel.addEventListener('click', hideModal);

  // 点击遮罩空白处也可关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideModal();
  });

  window.showToast = showToast;
  window.showConfirm = showConfirm;
  window.hideModal = hideModal;
})();
