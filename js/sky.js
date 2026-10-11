/* ============================================================
   星座背景动画
   所有页面共用：在 #sky 画布上绘制漂移的星座 + 闪烁小星星
   无对外接口，纯装饰。
   ============================================================ */
(function () {
  const sky = document.getElementById('sky');
  if (!sky) return;                    // 页面没有画布就不处理

  const ctx = sky.getContext('2d');
  let W, H;
  const constellations = [];
  const stars = [];

  function resize() {
    W = sky.width = window.innerWidth;
    H = sky.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // 生成若干星座：随机点 + 相邻连线，缓慢漂移
  function makeConstellations() {
    for (let i = 0; i < 7; i++) {
      const cx = Math.random() * W;
      const cy = Math.random() * H;
      const n = 4 + Math.floor(Math.random() * 4); // 4~7 颗星
      const pts = [];
      for (let j = 0; j < n; j++) {
        const ang = (j / n) * Math.PI * 2 + Math.random() * 1.2;
        const r = 30 + Math.random() * 55;
        pts.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * 0.8 });
      }
      constellations.push({
        pts,
        vx: 0.15 + Math.random() * 0.25,
        vy: (Math.random() - 0.5) * 0.1
      });
    }
    // 点缀小星星
    for (let i = 0; i < 60; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.6 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        speed: 0.008 + Math.random() * 0.02
      });
    }
  }
  makeConstellations();

  function drawSky(t) {
    ctx.clearRect(0, 0, W, H);

    for (const c of constellations) {
      c.pts.forEach(p => { p.x += c.vx; p.y += c.vy; });
      // 出界回绕
      if (c.pts[0].x > W + 120) c.pts.forEach(p => p.x -= W + 240);
      if (c.pts[0].x < -120)    c.pts.forEach(p => p.x += W + 240);
      if (c.pts[0].y > H + 120) c.pts.forEach(p => p.y -= H + 240);
      if (c.pts[0].y < -120)    c.pts.forEach(p => p.y += H + 240);

      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(c.pts[0].x, c.pts[0].y);
      for (let j = 1; j < c.pts.length; j++) ctx.lineTo(c.pts[j].x, c.pts[j].y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      for (const p of c.pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 闪烁小星星
    for (const s of stars) {
      const a = 0.25 + 0.75 * Math.abs(Math.sin(s.phase + t * s.speed));
      ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(drawSky);
  }
  requestAnimationFrame(drawSky);
})();
