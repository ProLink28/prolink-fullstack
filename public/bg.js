/* Animated backgrounds (login screen + app). Needs script.js loaded first ($ and currentTheme come from there). */

/* ---------- Animated login background ---------- */
(function () {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BOX = new Path2D('M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z');
  const HANDLE = new Path2D('M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2');
  const LINK_DIST = 190, MOUSE_R = 170;
  let w = 0, h = 0, dpr = 1, nodes = [], mouse = { x: -999, y: -999 };

  function drawLogo(n) {
    const s = n.size, a = n.alpha;
    ctx.save();
    ctx.translate(n.x, n.y); ctx.rotate(n.rot);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.26); else ctx.rect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = `rgba(255,255,255,${a * 0.45})`;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(255,255,255,${a * 1.4})`;
    ctx.stroke();
    const k = (s * 0.56) / 24;
    ctx.scale(k, k); ctx.translate(-12, -12);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, a * 2.4)})`;
    ctx.stroke(BOX); ctx.stroke(HANDLE);
    ctx.restore();
  }

  function init() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(innerWidth < 700 ? 8 : 12, Math.min(34, Math.floor(w * h / 42000)));
    nodes = Array.from({ length: count }, () => {
      const z = 0.35 + Math.random() * 0.65;           // depth: 1 = closest
      const ang = Math.random() * Math.PI * 2, sp = 0.15 + z * 0.45;
      return {
        x: Math.random() * w, y: Math.random() * h, z,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        size: 22 + z * 34, alpha: 0.10 + z * 0.22,
        rot: Math.random() * 0.6 - 0.3, vr: (Math.random() - 0.5) * 0.004
      };
    }).sort((a, b) => a.z - b.z);                       // far ones drawn first
  }

  function frame() {
    if (!$('#auth').classList.contains('hidden')) {     // pause when logged in
      if (canvas.clientWidth !== w || Math.abs(canvas.clientHeight - h) > 150) init();
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK_DIST) {
            const t = 1 - d / LINK_DIST;
            ctx.strokeStyle = `rgba(186,230,253,${t * 0.35 * Math.min(a.z, b.z)})`;
            ctx.lineWidth = 0.6 + t * 1.2;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        const dx = n.x - mouse.x, dy = n.y - mouse.y, d = Math.hypot(dx, dy);
        if (d < MOUSE_R && d > 0) {                      // gently push away from cursor
          const f = (1 - d / MOUSE_R) * 0.6;
          n.x += (dx / d) * f * 3; n.y += (dy / d) * f * 3;
        }
        n.x += n.vx; n.y += n.vy; n.rot += n.vr;
        const m = n.size;                                // wrap around edges
        if (n.x < -m) n.x = w + m; else if (n.x > w + m) n.x = -m;
        if (n.y < -m) n.y = h + m; else if (n.y > h + m) n.y = -m;
        drawLogo(n);
      }
    }
    if (!reduce) requestAnimationFrame(frame);
  }

  addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  document.addEventListener('mouseleave', () => { mouse.x = mouse.y = -999; });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (Math.abs(canvas.clientWidth - w) > 1) init(); if (reduce) frame(); }, 150); });

  init(); frame();
})();


/* ---------- Animated app (dashboard) background ---------- */
(function () {
  const canvas = document.getElementById('appBgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BOX = new Path2D('M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z');
  const HANDLE = new Path2D('M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2');
  const LINK_DIST = 200, MOUSE_R = 150;
  let w = 0, h = 0, dpr = 1, nodes = [], mouse = { x: -999, y: -999 };
  const tone = () => currentTheme() === 'dark' ? ['165,180,252', 1.5] : ['79,70,229', 1];   // [rgb, strength]

  function drawLogo(n, rgb, k) {
    const s = n.size, a = n.alpha * k;
    ctx.save();
    ctx.translate(n.x, n.y); ctx.rotate(n.rot);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.26); else ctx.rect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = `rgba(${rgb},${a * 0.45})`; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = `rgba(${rgb},${a * 1.3})`; ctx.stroke();
    const sc = (s * 0.56) / 24;
    ctx.scale(sc, sc); ctx.translate(-12, -12);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${rgb},${Math.min(1, a * 2.2)})`;
    ctx.stroke(BOX); ctx.stroke(HANDLE);
    ctx.restore();
  }

  function init() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(innerWidth < 700 ? 6 : 10, Math.min(26, Math.floor(w * h / 60000)));
    nodes = Array.from({ length: count }, () => {
      const z = 0.35 + Math.random() * 0.65, ang = Math.random() * Math.PI * 2, sp = 0.12 + z * 0.35;
      return { x: Math.random() * w, y: Math.random() * h, z, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        size: 24 + z * 32, alpha: 0.06 + z * 0.10, rot: Math.random() * 0.6 - 0.3, vr: (Math.random() - 0.5) * 0.003 };
    }).sort((a, b) => a.z - b.z);
  }

  function frame() {
    if (!$('#app').classList.contains('hidden')) {      // only runs while logged in
      if (canvas.clientWidth !== w || Math.abs(canvas.clientHeight - h) > 150) init();
      const [rgb, k] = tone();
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK_DIST) {
            const t = 1 - d / LINK_DIST;
            ctx.strokeStyle = `rgba(${rgb},${t * 0.16 * k * Math.min(a.z, b.z)})`;
            ctx.lineWidth = 0.6 + t;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        if (!reduce) {
          const dx = n.x - mouse.x, dy = n.y - mouse.y, d = Math.hypot(dx, dy);
          if (d < MOUSE_R && d > 0) { const f = (1 - d / MOUSE_R) * 0.6; n.x += (dx / d) * f * 3; n.y += (dy / d) * f * 3; }
          n.x += n.vx; n.y += n.vy; n.rot += n.vr;
          const m = n.size;
          if (n.x < -m) n.x = w + m; else if (n.x > w + m) n.x = -m;
          if (n.y < -m) n.y = h + m; else if (n.y > h + m) n.y = -m;
        }
        drawLogo(n, rgb, k);
      }
    }
    requestAnimationFrame(frame);
  }

  addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  document.addEventListener('mouseleave', () => { mouse.x = mouse.y = -999; });
  init(); frame();
})();
