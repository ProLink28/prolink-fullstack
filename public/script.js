const $ = s => document.querySelector(s);
const STATUSES = ['Pending', 'Reviewing', 'Accepted', 'Rejected'];
const JOB_TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract'];
const MAX_FILE_SIZE = 1024 * 1024;
const LOCATIONS = ['Remote','Metro Manila','Abra','Agusan del Norte','Agusan del Sur','Aklan','Albay','Antique','Apayao','Aurora','Basilan','Bataan','Batanes','Batangas','Benguet','Biliran','Bohol','Bukidnon','Bulacan','Cagayan','Camarines Norte','Camarines Sur','Camiguin','Capiz','Catanduanes','Cavite','Cebu','Cotabato','Davao de Oro','Davao del Norte','Davao del Sur','Davao Occidental','Davao Oriental','Dinagat Islands','Eastern Samar','Guimaras','Ifugao','Ilocos Norte','Ilocos Sur','Iloilo','Isabela','Kalinga','La Union','Laguna','Lanao del Norte','Lanao del Sur','Leyte','Maguindanao del Norte','Maguindanao del Sur','Marinduque','Masbate','Misamis Occidental','Misamis Oriental','Mountain Province','Negros Occidental','Negros Oriental','Northern Samar','Nueva Ecija','Nueva Vizcaya','Occidental Mindoro','Oriental Mindoro','Palawan','Pampanga','Pangasinan','Quezon','Quirino','Rizal','Romblon','Samar','Sarangani','Siquijor','Sorsogon','South Cotabato','Southern Leyte','Sultan Kudarat','Sulu','Surigao del Norte','Surigao del Sur','Tarlac','Tawi-Tawi','Zambales','Zamboanga del Norte','Zamboanga del Sur','Zamboanga Sibugay'];

/* ---------- Safe storage (only used for the theme and the login token) ---------- */
const mem = {};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] ?? null; } },
  set(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) { if (e && (e.name === 'QuotaExceededError' || e.code === 22)) return false; mem[k] = v; return true; }
  },
  del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }
};

/* ---------- Theme (light / dark) ---------- */
const THEME_KEY = 'prolink_theme';
const ICON = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const SUN = ICON('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>');
const MOON = ICON('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>');
function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
function applyTheme(t, persist = true) {
  const dark = t === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (persist) store.set(THEME_KEY, dark ? 'dark' : 'light');
  document.querySelectorAll('[data-theme-toggle]').forEach(b => {
    b.innerHTML = dark ? SUN : MOON;
    b.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    b.setAttribute('aria-label', b.title);
  });
  document.querySelectorAll('[data-theme-switch]').forEach(b => b.setAttribute('aria-checked', String(dark)));
  const sel = document.getElementById('themeSelect'); if (sel) sel.value = dark ? 'dark' : 'light';
}

/* ---------- API layer (talks to the Express server) ---------- */
const API_BASE = (window.PROLINK_API || '/api').replace(/\/$/, '');
const TOKEN_KEY = 'prolink_token';
async function api(path, { method = 'GET', body } = {}) {
  const headers = {}, token = store.get(TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new Error('Cannot reach the server. Make sure it is running.'); }
  let data = null; try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && token && !path.startsWith('/auth/')) forceLogout();
  if (!res.ok) { const err = new Error((data && data.error) || 'Request failed.'); err.restart = !!(data && data.restart); throw err; }
  return data;
}
const fail = err => toast(err && err.message ? err.message : 'Something went wrong.', 'err');

/* Local copy of the data the server sent us. Views read from here; every change goes through the API first. */
let db = { users: [], jobs: [], applications: [], notifs: [] };
let current = null, page = 'dashboard', editingJobId = null, animateNext = false, appQuery = '', appSort = 'new', sortBy = 'new', onlySalary = false;
let filters = { q: '', loc: '', type: '' }, appFilter = '';
async function refresh() {
  const d = await api('/bootstrap');
  db = { users: d.users, jobs: d.jobs, applications: d.applications, notifs: d.notifs };
  current = d.me;
}
async function softRefresh() {
  if (!current) return;
  try { const before = JSON.stringify(db); await refresh(); if (current && JSON.stringify(db) !== before) render(); } catch (e) {}
}
let pollTimer = null;
const startPoll = () => { stopPoll(); pollTimer = setInterval(syncNotifs, 20000); };
const stopPoll = () => { clearInterval(pollTimer); pollTimer = null; };
async function syncNotifs() {
  const u = user(); if (!u || u.role !== 'seeker') return;
  try { db.notifs = await api('/notifications'); renderBell(); } catch (e) {}
}

/* ---------- Email rules (checked here for quick feedback, and again on the server) ---------- */
const ALLOWED_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com'];
const EMAIL_RULE_MSG = 'Please use a Gmail, Yahoo or Outlook email address.';
const emailOk = e => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && ALLOWED_EMAIL_DOMAINS.includes(e.split('@')[1]);
let reset = null; // { email, token }

function showForgotStep(step) {
  ['forgotEmailForm', 'forgotCodeForm', 'forgotResetForm'].forEach(id => $('#' + id).classList.toggle('hidden', id !== step));
}
function resetForgotFlow() {
  reset = null;
  ['forgotEmailForm', 'forgotCodeForm', 'forgotResetForm'].forEach(id => $('#' + id).reset());
  showForgotStep('forgotEmailForm');
}
async function issueCode(email) {
  if (!emailOk(email)) { toast(EMAIL_RULE_MSG, 'err'); return false; }
  try {
    await api('/auth/forgot/request', { method: 'POST', body: { email } });
    reset = { email, token: null };
    $('#codeSentMsg').textContent = `We sent a 6-digit code to ${email}. Check your inbox (and spam folder).`;
    return true;
  } catch (err) { fail(err); return false; }
}

/* ---------- Helpers ---------- */
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = n => (n || 'P').split(' ').filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const avatarHTML = u => u.photo ? `<img src="${esc(u.photo)}" alt="">` : esc(initials(u.name));
const cleanName = v => v.replace(/[^A-Za-z\u00C0-\u024F\s.'-]/g, '');
const user = () => db.users.find(u => u.id === current);
const userName = id => db.users.find(u => u.id === id)?.name || 'Candidate';
const myJobs = () => db.jobs.filter(j => j.employer === current);
const myApplicants = () => { const ids = myJobs().map(j => j.id); return db.applications.filter(a => ids.includes(a.jobId)); };
const options = (list, sel = '', ph = '') => (ph ? `<option value="">${esc(ph)}</option>` : '') +
  list.map(v => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
function calcAge(b) {
  if (!b) return ''; const d = new Date(b); if (isNaN(d)) return '';
  const t = new Date(); let a = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--;
  return a >= 0 ? a : '';
}
const memberSince = u => {
  const d = new Date(u.created || u.id);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ---------- Auth ---------- */
function login(u) {
  current = u.id; page = 'dashboard'; animateNext = true;
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  render(); window.scrollTo(0, 0); startPoll();
}
async function enter(token) {   // save the token, load the account, show the app
  store.set(TOKEN_KEY, token);
  await refresh();
  login(user());
}
function logout() {
  closeMenu(); stopPoll(); current = null; store.del(TOKEN_KEY);
  db = { users: [], jobs: [], applications: [], notifs: [] };
  $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden');
  $('#signupView').classList.add('hidden'); $('#forgotView').classList.add('hidden'); $('#loginView').classList.remove('hidden');
}
function forceLogout() {   // the server said our login is no longer valid
  store.del(TOKEN_KEY);
  if (current) { logout(); toast('Session expired. Please log in again.', 'err'); }
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme(), false);
  $('#showSignup').onclick = e => { e.preventDefault(); $('#loginView').classList.add('hidden'); $('#signupView').classList.remove('hidden'); };
  $('#showLogin').onclick = e => { e.preventDefault(); $('#signupView').classList.add('hidden'); $('#forgotView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); resetForgotFlow(); };
  $('#showForgot').onclick = e => { e.preventDefault(); resetForgotFlow(); $('#loginView').classList.add('hidden'); $('#forgotView').classList.remove('hidden'); };
  $('#backToLogin').onclick = e => { e.preventDefault(); resetForgotFlow(); $('#forgotView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); };

  const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const EYE = svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>');
  const EYE_OFF = svg('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>');
  document.querySelectorAll('[data-toggle]').forEach(b => {
    b.innerHTML = EYE;
    b.onclick = () => {
      const i = $('#' + b.dataset.toggle), show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      b.innerHTML = show ? EYE_OFF : EYE;
      b.title = b.ariaLabel = show ? 'Hide password' : 'Show password';
    };
  });

  /* Warn when the full name is already used by another account (checked on the server) */
  let nameTimer, nameTakenNow = false;
  const updateNameMsg = async () => {
    const v = $('#signupName').value.trim(), m = $('#nameMsg');
    if (v.length < 2) { nameTakenNow = false; m.textContent = ''; m.className = 'pw-hint'; return; }
    try {
      const r = await api('/auth/name-taken?name=' + encodeURIComponent(v));
      if ($('#signupName').value.trim() !== v) return;
      nameTakenNow = r.taken;
    } catch (e) { return; }
    m.textContent = nameTakenNow ? '⚠ This name is already taken. Please use a different name.' : '';
    m.className = 'pw-hint' + (nameTakenNow ? ' bad' : '');
  };
  $('#signupName').addEventListener('input', e => { e.target.value = cleanName(e.target.value); clearTimeout(nameTimer); nameTimer = setTimeout(updateNameMsg, 350); });

  /* Live "passwords match" hint under Confirm password */
  const updatePwMatch = () => {
    const a = $('#signupPassword').value, b = $('#signupConfirmPassword').value, msg = $('#pwMatchMsg');
    if (!b) { msg.textContent = ''; msg.className = 'pw-hint'; return; }
    const ok = a === b;
    msg.textContent = ok ? '✓ Passwords match' : '✗ Passwords do not match';
    msg.className = 'pw-hint ' + (ok ? 'ok' : 'bad');
  };
  $('#signupPassword').addEventListener('input', updatePwMatch);
  $('#signupConfirmPassword').addEventListener('input', updatePwMatch);

  /* Sign up: form -> emailed code -> account created */
  let signupEmail = null;
  const signupStep = s => {
    $('#signupForm').classList.toggle('hidden', s !== 'form');
    $('#signupCodeForm').classList.toggle('hidden', s !== 'code');
  };
  const signupCancel = () => { signupEmail = null; $('#signupCodeForm').reset(); signupStep('form'); };

  $('#signupForm').onsubmit = async e => {
    e.preventDefault();
    const name = $('#signupName').value.trim().replace(/\s+/g, ' ');
    const email = $('#signupEmail').value.trim().toLowerCase();
    const password = $('#signupPassword').value, role = $('#signupRole').value;
    if (name.length < 2) return toast('Please enter your full name.', 'err');
    if (!emailOk(email)) return toast(EMAIL_RULE_MSG, 'err');
    if (nameTakenNow) return toast('This name is already taken. Please use a different name.', 'err');
    if (password.length < 6) return toast('Password must be at least 6 characters.', 'err');
    if (password !== $('#signupConfirmPassword').value) return toast('Passwords do not match.', 'err');

    const btn = $('#signupSubmit'); btn.disabled = true; btn.textContent = 'Sending code…';
    try {
      await api('/auth/signup/request', { method: 'POST', body: { name, email, password, role } });
      signupEmail = email;
      $('#signupCodeMsg').textContent = `We sent a 6-digit code to ${email}. Check your inbox (and spam folder).`;
      signupStep('code'); $('#signupCode').focus();
      toast('Verification code sent.');
    } catch (err) { fail(err); }
    btn.disabled = false; btn.textContent = 'Create account';
  };

  $('#signupCodeForm').onsubmit = async e => {
    e.preventDefault();
    if (!signupEmail) { signupCancel(); return toast('Please sign up again.', 'err'); }
    try {
      const { token } = await api('/auth/signup/verify', { method: 'POST', body: { email: signupEmail, code: $('#signupCode').value.trim() } });
      const first = $('#signupName').value.trim().split(' ')[0];
      $('#signupForm').reset(); $('#signupCodeForm').reset(); updatePwMatch(); updateNameMsg();
      signupEmail = null; signupStep('form');
      await enter(token); toast(`Welcome to ProLink, ${first}!`);
    } catch (err) { if (err.restart) signupCancel(); fail(err); }
  };

  $('#signupResend').onclick = async e => {
    e.preventDefault();
    if (!signupEmail) return;
    try { await api('/auth/signup/resend', { method: 'POST', body: { email: signupEmail } }); toast('A new code was sent.'); }
    catch (err) { if (err.restart) signupCancel(); fail(err); }
  };
  $('#signupBack').onclick = e => { e.preventDefault(); signupCancel(); };
  $('#showLogin').addEventListener('click', signupCancel);

  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const form = e.target, email = $('#loginEmail').value.trim().toLowerCase(), password = $('#loginPassword').value;
    try {
      const { token } = await api('/auth/login', { method: 'POST', body: { email, password } });
      form.reset(); await enter(token);
    } catch (err) { fail(err); }
  };

  /* Forgot password: email -> code -> new password */
  $('#forgotEmailForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#sendCodeBtn'); btn.disabled = true; btn.textContent = 'Sending…';
    const ok = await issueCode($('#forgotEmail').value.trim().toLowerCase());
    btn.disabled = false; btn.textContent = 'Send code';
    if (ok) { showForgotStep('forgotCodeForm'); toast('Verification code sent.'); }
  };
  $('#resendCode').onclick = async e => {
    e.preventDefault();
    if (!reset) return;
    if (await issueCode(reset.email)) toast('A new code was sent.');
  };
  $('#forgotCodeForm').onsubmit = async e => {
    e.preventDefault();
    if (!reset) { showForgotStep('forgotEmailForm'); return toast('Please request a new code.', 'err'); }
    try {
      const { resetToken } = await api('/auth/forgot/verify', { method: 'POST', body: { email: reset.email, code: $('#resetCode').value.trim() } });
      reset.token = resetToken;
      showForgotStep('forgotResetForm');
      toast('Code verified.');
    } catch (err) { if (err.restart) resetForgotFlow(); fail(err); }
  };
  $('#forgotResetForm').onsubmit = async e => {
    e.preventDefault();
    if (!reset || !reset.token) { resetForgotFlow(); return toast('Session expired. Start again.', 'err'); }
    const password = $('#resetPassword').value, confirm = $('#confirmResetPassword').value;
    if (password.length < 6) return toast('Password must be at least 6 characters.', 'err');
    if (password !== confirm) return toast('Passwords do not match.', 'err');
    try {
      await api('/auth/forgot/reset', { method: 'POST', body: { resetToken: reset.token, password } });
      resetForgotFlow();
      $('#forgotView').classList.add('hidden');
      $('#loginView').classList.remove('hidden');
      toast('Password updated. You can now log in.');
    } catch (err) { if (err.restart) resetForgotFlow(); fail(err); }
  };

  /* Profile dropdown + theme switches */
  $('#ddLogout').onclick = () => { closeMenu(); logout(); };
  $('#bellBtn').onclick = e => {
    e.stopPropagation();
    const m = $('#notifMenu');
    if (!m.classList.contains('hidden')) return m.classList.add('hidden');
    closeMenu(); renderBell(); m.classList.remove('hidden');
    if (myNotifs().some(n => !n.read)) {
      api('/notifications/read', { method: 'POST' }).catch(() => {});
      myNotifs().forEach(n => { n.read = true; });
      $('#bellBadge').classList.add('hidden');
    }
  };
  document.querySelectorAll('[data-theme-toggle],[data-theme-switch]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); }));
  $('#profileBtn').onclick = e => { e.stopPropagation(); $('#profileMenu').classList.contains('hidden') ? openMenu() : closeMenu(); };
  $('#profileMenu').querySelectorAll('[data-go]').forEach(b => b.onclick = () => { closeMenu(); go(b.dataset.go, ''); });
  document.addEventListener('click', e => { if (!e.target.closest('.profile-wrap')) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  /* Already logged in? Restore the session from the saved token. */
  if (store.get(TOKEN_KEY)) refresh().then(() => { if (user()) login(user()); }).catch(fail);
});

/* ---------- Navigation ---------- */
const NAV = {
  seeker: [['dashboard', 'Dashboard'], ['jobs', 'Find Jobs'], ['saved', 'Saved Jobs'], ['applications', 'My Applications']],
  employer: [['dashboard', 'Dashboard'], ['post', 'Post a Job'], ['manage', 'Manage Jobs'], ['applicants', 'Applicants']]
};
const EXTRA_PAGES = ['profile', 'settings', 'about'];   // reachable from the profile menu
function openMenu() { $('#notifMenu')?.classList.add('hidden'); $('#profileMenu').classList.remove('hidden'); $('#profileBtn').setAttribute('aria-expanded', 'true'); }
function closeMenu() {
  const m = $('#profileMenu'); if (!m) return;
  m.classList.add('hidden'); $('#notifMenu')?.classList.add('hidden'); $('#profileBtn').setAttribute('aria-expanded', 'false');
}
function go(p, extra) {
  if (p !== 'post') editingJobId = null;
  if (extra !== undefined) appFilter = extra;
  if (p !== page) animateNext = true;   // only animate real page changes (not filter changes)
  page = p; render(); window.scrollTo(0, 0);
  if (!['post', 'profile', 'settings', 'about'].includes(p)) softRefresh();   // pick up changes made by other users
}
/* Replays the page-enter animation and the top progress bar */
function playPageAnimation() {
  const c = $('#content'), bar = $('#pageBar');
  c.classList.remove('page-anim'); void c.offsetWidth; c.classList.add('page-anim');
  if (bar) { bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run'); }
}
function render() {
  const u = user(); if (!u) return;
  const items = NAV[u.role];
  if (!items.some(([id]) => id === page) && !EXTRA_PAGES.includes(page)) page = 'dashboard';
  paintName(u); $('#topAvatar').innerHTML = avatarHTML(u);
  $('#ddEmail').textContent = u.email;
  $('#ddProfile').textContent = u.role === 'seeker' ? 'My Profile' : 'Company Profile';
  renderBell();
  applyTheme(currentTheme(), false);
  $('#nav').innerHTML = items.map(([id, l]) => `<button class="${page === id ? 'active' : ''}" data-page="${id}">${l}</button>`).join('');
  $('#nav').querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.page, ''));
  { const nv = $('#nav'), ac = nv.querySelector('.active'); if (ac && nv.scrollWidth > nv.clientWidth) nv.scrollLeft = ac.offsetLeft - (nv.clientWidth - ac.offsetWidth) / 2; }
  const views = { dashboard, jobs, saved: savedJobs, applications, profile, post, manage, applicants, settings, about };
  const binders = { jobs: bindJobs, profile: bindProfile, post: bindPost, settings: bindSettings };
  $('#content').innerHTML = views[page]();
  if (binders[page]) binders[page]();
  if (animateNext) { animateNext = false; playPageAnimation(); }
}
const pageHeader = (t, s, btn = '') => `<div class="welcome"><div><h1>${t}</h1><div class="muted">${s}</div></div>${btn}</div>`;

/* ---------- Dashboard ---------- */
function dashboard() {
  const u = user();
  if (u.role === 'seeker') {
    const apps = db.applications.filter(a => a.userId === u.id);
    const recent = db.jobs.slice().sort((a, b) => b.created - a.created).slice(0, 3);
    return `${pageHeader(`Hello, ${esc(u.name.split(' ')[0])} 👋`, 'Here’s your career activity at a glance.', `<button class="primary" onclick="go('jobs')">Explore jobs</button>`)}
      <div class="cards">
        <div class="stat" onclick="go('jobs')"><label>Available opportunities</label><strong>${db.jobs.length}</strong></div>
        <div class="stat" onclick="go('applications')"><label>Applications submitted</label><strong>${apps.length}</strong></div>
        <div class="stat" onclick="go('applications')"><label>Under review</label><strong>${apps.filter(a => a.status === 'Pending' || a.status === 'Reviewing').length}</strong></div>
      </div>
      ${u.bio || u.location ? '' : `<div class="panel">💡 <b>Tip:</b> complete your <a href="#" onclick="go('profile');return false">profile</a> so employers know who you are.</div>`}
      <div class="panel"><h3>Recently posted opportunities</h3>${jobCards(recent, false)}</div>`;
  }
  const apps = myApplicants();
  return `${pageHeader(`Welcome, ${esc(u.company || u.name)} 👋`, 'Manage your hiring activity from one place.', `<button class="primary" onclick="go('post')">＋ Create a job</button>`)}
    <div class="cards">
      <div class="stat" onclick="go('manage')"><label>Active job postings</label><strong>${myJobs().filter(j => !isClosed(j)).length}</strong></div>
      <div class="stat" onclick="go('applicants','')"><label>Total applicants</label><strong>${apps.length}</strong></div>
      <div class="stat" onclick="go('applicants','Pending')"><label>Awaiting review</label><strong>${apps.filter(a => a.status === 'Pending').length}</strong></div>
    </div>
    <div class="panel"><h3>Applicants by status</h3>${statusChart(apps)}</div>
    <div class="panel"><h3>Recent applicants</h3>
      ${apps.length ? `<div class="table-wrap"><table class="table"><tr><th>Candidate</th><th>Position</th><th>Status</th></tr>
        ${apps.slice().sort((a, b) => a.date - b.date).slice(-5).reverse().map(a => `<tr><td data-label="Candidate">${esc(userName(a.userId))}</td><td data-label="Position">${esc(db.jobs.find(j => j.id === a.jobId)?.title || '')}</td><td data-label="Status"><span class="status ${a.status}">${a.status}</span></td></tr>`).join('')}
      </table></div>` : '<div class="empty">Applicants will appear here when candidates apply.</div>'}
    </div>`;
}

/* ---------- Seeker: jobs ---------- */
function jobCards(list, canApply = true) {
  if (!list.length) return '<div class="empty">😕 No jobs found. Try adjusting your filters.</div>';
  return `<div class="joblist">${list.map(j => {
    const applied = db.applications.some(a => a.jobId === j.id && a.userId === current);
    const m = canApply ? matchScore(j) : null, isSaved = (user()?.saved || []).includes(j.id);
    return `<article class="job">
      <div class="job-head"><div><h3>${esc(j.title)}</h3><div class="company">${esc(j.company || 'Company')}${empBadge(j)} · 📍 ${esc(j.location)}</div></div><span class="job-side">${m !== null ? `<span class="match ${m >= 70 ? 'hi' : m >= 40 ? 'mid' : 'lo'}" title="Based on the skills in your profile">${m}% match</span>` : ''}<span class="tag">${esc(j.type)}</span>${canApply ? `<button type="button" class="heart ${isSaved ? 'on' : ''}" onclick="toggleSave(${j.id})" aria-label="${isSaved ? 'Remove from saved jobs' : 'Save job'}" title="${isSaved ? 'Remove from saved jobs' : 'Save job'}">${isSaved ? '♥' : '♡'}</button>` : ''}</span></div>
      <p>${esc(j.description)}</p>
      <div class="tags"><span class="tag g">💰 ${j.salary ? esc(j.salary) : 'Salary not specified'}</span>${j.deadline ? `<span class="tag g">⏰ Apply by ${esc(new Date(j.deadline + 'T00:00').toLocaleDateString())}</span>` : ''}<span class="tag g">Requirements: ${esc(j.requirements)}</span></div>
      ${canApply ? `<div><button class="${applied ? 'secondary' : 'primary'}" ${applied || isClosed(j) ? 'disabled' : ''} onclick="applyJob(${j.id})">${applied ? '✓ Applied' : isClosed(j) ? 'Closed' : 'Quick apply'}</button></div>` : ''}
    </article>`;
  }).join('')}</div>`;
}
function filteredJobs() {
  const q = filters.q.toLowerCase();
  return db.jobs.filter(j => (j.title + ' ' + j.company + ' ' + j.description + ' ' + j.requirements).toLowerCase().includes(q) &&
    (!filters.loc || j.location === filters.loc) && (!filters.type || j.type === filters.type) && (!onlySalary || j.salary)).sort(SORTS[sortBy] || SORTS.new);
}
function results() {
  const l = filteredJobs(), active = filters.q || filters.loc || filters.type || onlySalary;
  return `<div class="count"><span>${l.length} job${l.length === 1 ? '' : 's'} found</span>${active ? '<button class="secondary" id="clearF">Clear filters</button>' : ''}</div>${jobCards(l)}`;
}
function jobs() {
  return `${pageHeader('Find your next opportunity', 'Search and filter openings that match your goals.')}
    <div class="toolbar">
      <input class="field" id="searchTerm" placeholder="🔍 Job title or keyword" value="${esc(filters.q)}">
      <select class="field" id="searchLocation">${options(LOCATIONS, filters.loc, 'All locations')}</select>
      <select class="field" id="searchType">${options(JOB_TYPES, filters.type, 'All employment types')}</select>
      <select class="field" id="searchSort">${[['new', 'Newest first'], ['old', 'Oldest first'], ['salary', 'Highest salary'], ['match', 'Best match']].map(([v, l]) => `<option value="${v}" ${sortBy === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="searchSalary" ${onlySalary ? 'checked' : ''}> Has salary listed</label>
    </div><div id="jobResults">${results()}</div>`;
}
function bindJobs() {
  const show = () => {
    $('#jobResults').innerHTML = results();
    const c = $('#clearF');
    if (c) c.onclick = () => { filters = { q: '', loc: '', type: '' }; onlySalary = false; render(); };
  };
  const update = () => { filters = { q: $('#searchTerm').value.trim(), loc: $('#searchLocation').value, type: $('#searchType').value }; sortBy = $('#searchSort').value; onlySalary = $('#searchSalary').checked; show(); };
  $('#searchTerm').addEventListener('input', update);
  $('#searchLocation').addEventListener('change', update);
  $('#searchType').addEventListener('change', update);
  $('#searchSort').addEventListener('change', update);
  $('#searchSalary').addEventListener('change', update);
  show();
}

/* ---------- Seeker: apply ---------- */
function applyJob(id) {
  const u = user(); if (!u || u.role !== 'seeker') return;
  if (db.applications.some(a => a.jobId === id && a.userId === current)) return;
  const j = db.jobs.find(x => x.id === id); if (!j || isClosed(j)) return;
  $('#applyModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'applyModal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal"><h2>Apply for ${esc(j.title)}</h2><p class="muted">${esc(j.company)} · Submit your application documents</p>
    <form id="applicationForm">
      <label>Full Name<input class="field" value="${esc(u.name)}" disabled></label>
      <label>Email Address<input class="field" value="${esc(u.email)}" disabled></label>
      <label>CV / Resume *<input class="field" type="file" id="cvFile" accept=".pdf,.doc,.docx" required><span class="hint">PDF, DOC or DOCX (max 1 MB)</span></label>
      <label>Other Requirements (optional)<input class="field" type="file" id="otherFiles" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" multiple><span class="hint">Max 1 MB per file</span></label>
      <div class="actions"><button type="button" class="secondary" id="cancelApply">Cancel</button><button type="submit" class="primary" id="submitApplication">Submit Application</button></div>
    </form></div>`;
  document.body.appendChild(modal);
  $('#cancelApply').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', esc_); } });

  $('#applicationForm').onsubmit = async e => {
    e.preventDefault();
    const cv = $('#cvFile').files[0];
    if (!cv) return toast('Please attach your CV or Resume.', 'err');
    const files = [cv, ...$('#otherFiles').files];
    const big = files.find(f => f.size > MAX_FILE_SIZE);
    if (big) return toast(`"${big.name}" is over 1 MB.`, 'err');
    const read = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, type: f.type, size: f.size, data: r.result }); r.onerror = rej; r.readAsDataURL(f); });
    const btn = $('#submitApplication'); btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const documents = await Promise.all(files.map(read));
      await api(`/jobs/${id}/apply`, { method: 'POST', body: { documents } });
      await refresh();
      modal.remove(); render(); toast('Application submitted! Track it under My Applications.');
    } catch (err) {
      fail(err);
      btn.disabled = false; btn.textContent = 'Submit Application';
    }
  };
}

function applications() {
  const list = db.applications.filter(a => a.userId === current).sort((a, b) => b.date - a.date);
  return `${pageHeader('My applications', 'Track the progress of every submitted application.')}
    <div class="panel">${list.length ? `<div class="table-wrap"><table class="table">
      <tr><th>Position</th><th>Company</th><th>Salary</th><th>Date applied</th><th>Status</th><th></th></tr>
      ${list.map(a => { const j = db.jobs.find(x => x.id === a.jobId) || {};
        return `<tr id="app-${a.id}"><td data-label="Position">${esc(j.title || 'Removed job')}</td><td data-label="Company">${esc(j.company || '—')}</td><td data-label="Salary">${esc(j.salary || 'Not specified')}</td>
        <td data-label="Date applied">${new Date(a.date).toLocaleDateString()}</td><td data-label="Status"><span class="status ${a.status}">${a.status}</span></td>
        <td class="td-actions"><div class="row-actions"><button class="secondary" onclick="showTimeline(${a.id})">Timeline</button>${a.status === 'Pending' ? `<button class="secondary" onclick="withdraw(${a.id})">Withdraw</button>` : ''}</div></td></tr>`; }).join('')}
    </table></div>` : `<div class="empty">No applications yet. <a href="#" onclick="go('jobs');return false">Browse jobs →</a></div>`}</div>`;
}
async function withdraw(id) {
  if (!await confirmBox('Withdraw application', 'Are you sure you want to withdraw this application?', 'Withdraw')) return;
  try { await api('/applications/' + id, { method: 'DELETE' }); await refresh(); render(); toast('Application withdrawn.'); }
  catch (err) { fail(err); }
}

/* ---------- Profile ---------- */
function profile() {
  const u = user(), s = u.role === 'seeker';
  return `${pageHeader(s ? 'My Profile' : 'Company Profile', 'Manage your personal information and preferences.')}${completenessBar(u)}
    <div class="panel"><form id="profileForm" class="formgrid">
      <div class="full pfp-row"><div class="pfp" id="pfpBox">${avatarHTML(u)}</div>
        <div class="pfp-actions"><input type="file" id="pfpFile" accept="image/*" class="hidden">
          <button type="button" class="secondary" id="pfpChange">Change photo</button>
          <button type="button" class="secondary ${u.photo ? '' : 'hidden'}" id="pfpRemove">Remove</button>
          <span class="hint">JPG or PNG. It will be cropped to a square.</span>
          <span class="member-since">📅 Profile created on ${esc(memberSince(u))}</span></div></div>
      <label>${s ? 'Full name' : 'Contact person'}<input class="field" id="pfName" value="${esc(u.name)}" required></label>
      <label>Email<input class="field" value="${esc(u.email)}" readonly></label>
      ${s ? '' : `<label class="full">Company name<input class="field" id="pfCompany" value="${esc(u.company)}" required></label>`}
      ${s ? `<label>📅 Birthdate<input class="field" type="date" id="pfBirthdate" value="${esc(u.birthdate)}" max="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Age<input class="field" id="pfAge" value="${calcAge(u.birthdate)}" readonly placeholder="Calculated from birthdate"></label>
      <label>Sex<select class="field" id="pfSex">${options(['Male', 'Female'], u.sex, 'Select')}</select></label>` : ''}
      <label>${s ? 'Location' : 'Company location'}<select class="field" id="pfLocation">${options(LOCATIONS, u.location, 'Select location')}</select></label>
      <label class="full">${s ? 'Bio / Professional summary' : 'About the company'}<textarea class="field" id="pfBio">${esc(u.bio)}</textarea></label>
      ${s ? `<label class="full">Skills<input class="field" id="pfSkills" value="${esc(u.skills || '')}" placeholder="e.g. HTML, CSS, JavaScript, Customer service"><span class="hint">Separate skills with commas. They are used to calculate the match score on each job.</span></label>` : ''}
      <div class="full form-actions"><button class="primary" type="submit">Save changes</button></div>
    </form></div>`;
}
function bindProfile() {
  const refreshPhoto = () => { const u = user(); $('#pfpBox').innerHTML = avatarHTML(u); $('#pfpRemove').classList.toggle('hidden', !u.photo); $('#topAvatar').innerHTML = avatarHTML(u); paintName(u); const cb = $('#completeBox'); if (cb) cb.outerHTML = completenessBar(u); };
  const setPhoto = async v => {
    try { await api('/me/photo', { method: 'PUT', body: { photo: v } }); await refresh(); refreshPhoto(); toast(v ? 'Photo updated.' : 'Photo removed.'); }
    catch (err) { fail(err); }
  };
  $('#pfpChange').onclick = () => $('#pfpFile').click();
  $('#pfpRemove').onclick = () => setPhoto('');
  $('#pfpFile').onchange = e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Please choose an image file.', 'err');
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const m = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
      URL.revokeObjectURL(url); setPhoto(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Could not read that image.', 'err'); };
    img.src = url;
  };
  $('#pfName').addEventListener('input', e => { e.target.value = cleanName(e.target.value); });
  const bd = $('#pfBirthdate'); if (bd) bd.addEventListener('input', () => { $('#pfAge').value = calcAge(bd.value); });
  if (bd) bd.addEventListener('click', () => { try { bd.showPicker(); } catch (e) {} });
  $('#profileForm').onsubmit = async e => {
    e.preventDefault();
    const u = user(), name = $('#pfName').value.trim();
    if (name.length < 2) return toast('Please enter a valid name.', 'err');
    const wasComplete = isComplete(u);
    const body = { name, location: $('#pfLocation').value, bio: $('#pfBio').value.trim() };
    if (u.role === 'seeker') Object.assign(body, { birthdate: $('#pfBirthdate').value, sex: $('#pfSex').value, skills: $('#pfSkills').value.trim() });
    else body.company = $('#pfCompany').value.trim();
    try {
      await api('/me', { method: 'PUT', body });
      await refresh(); render();
      toast(!wasComplete && isComplete(user()) ? '🎉 Congratulations! You earned the ProLink Verified badge.' : 'Profile updated.');
    } catch (err) { fail(err); }
  };
}

/* ---------- Employer ---------- */
function post() {
  const u = user(), j = editingJobId ? myJobs().find(x => x.id === editingJobId) : null;
  const v = j || { title: '', type: 'Full-time', location: '', salary: '', description: '', requirements: '' };
  return `${pageHeader(j ? 'Edit Job Posting' : 'Create Job Posting', j ? 'Update the details of this position.' : 'Post a new position for job seekers to apply for.')}
    <div class="panel"><form id="jobForm" class="formgrid">
      <label class="full">Job title<input class="field" id="jobTitle" value="${esc(v.title)}" placeholder="e.g. Marketing Assistant" required></label>
      <label>Employment type<select class="field" id="jobType">${options(JOB_TYPES, v.type)}</select></label>
      <label>Location<select class="field" id="jobLocation" required>${options(LOCATIONS, v.location || u.location, 'Select location')}</select></label>
      <label class="full">Salary (optional)<input class="field" id="jobSalary" value="${esc(v.salary)}" placeholder="e.g. ₱20,000 – ₱30,000 / month"></label>
      <label class="full">Application deadline (optional)<input class="field" type="date" id="jobDeadline" value="${esc(v.deadline || '')}"><span class="hint">After this date the job shows as closed for applicants.</span></label>
      <label class="full">Job description<textarea class="field" id="jobDescription" required>${esc(v.description)}</textarea></label>
      <label class="full">Requirements<textarea class="field" id="jobRequirements" required>${esc(v.requirements)}</textarea></label>
      <div class="full form-actions"><button class="primary" type="submit">${j ? 'Save changes' : 'Publish job'}</button>
      ${j ? `<button class="secondary" type="button" onclick="go('manage')">Cancel</button>` : ''}</div>
    </form></div>`;
}
function bindPost() {
  $('#jobForm').onsubmit = async e => {
    e.preventDefault();
    const data = { title: $('#jobTitle').value.trim(), type: $('#jobType').value, location: $('#jobLocation').value,
      salary: $('#jobSalary').value.trim(), description: $('#jobDescription').value.trim(),
      requirements: $('#jobRequirements').value.trim(), deadline: $('#jobDeadline').value };
    if (!data.title || !data.location || !data.description || !data.requirements) return toast('Please fill in all required fields.', 'err');
    const was = !!editingJobId;
    try {
      if (was) {
        if (!myJobs().some(x => x.id === editingJobId)) return toast('Job not found.', 'err');
        await api('/jobs/' + editingJobId, { method: 'PUT', body: data });
      } else await api('/jobs', { method: 'POST', body: data });
      await refresh();
      editingJobId = null; go('manage');
      toast(was ? 'Job updated.' : 'Job posted successfully!');
    } catch (err) { fail(err); }
  };
}
function manage() {
  const list = myJobs().sort((a, b) => b.created - a.created);
  return `${pageHeader('Manage Job Postings', 'View and edit your existing job posts.', `<button class="primary" onclick="go('post')">＋ Create a job</button>`)}
    <div class="panel">${list.length ? `<div class="table-wrap"><table class="table">
      <tr><th>Position</th><th>Type</th><th>Location</th><th>Applicants</th><th>Status</th><th>Actions</th></tr>
      ${list.map(j => `<tr><td data-label="Position">${esc(j.title)}</td><td data-label="Type">${esc(j.type)}</td><td data-label="Location">${esc(j.location)}</td><td data-label="Applicants">${db.applications.filter(a => a.jobId === j.id).length}</td>
        <td data-label="Status"><span class="status ${jobStatus(j) === 'Open' ? 'Accepted' : jobStatus(j) === 'Closed' ? 'Rejected' : 'Pending'}">${jobStatus(j)}</span></td>
        <td class="td-actions"><div class="row-actions"><button class="secondary" onclick="editJob(${j.id})">Edit</button><button class="secondary" onclick="toggleJob(${j.id})">${j.closed ? 'Reopen' : 'Close'}</button><button class="danger" onclick="deleteJob(${j.id})">Delete</button></div></td></tr>`).join('')}
    </table></div>` : `<div class="empty">You have not posted any jobs yet. <a href="#" onclick="go('post');return false">Create your first job →</a></div>`}</div>`;
}
function editJob(id) { if (!myJobs().some(j => j.id === id)) return; editingJobId = id; page = 'post'; animateNext = true; render(); window.scrollTo(0, 0); }
async function deleteJob(id) {
  if (!myJobs().some(j => j.id === id)) return;
  if (!await confirmBox('Delete job posting', 'This will permanently delete the job posting and all of its applications. This cannot be undone.', 'Delete')) return;
  try { await api('/jobs/' + id, { method: 'DELETE' }); await refresh(); render(); toast('Job deleted.'); }
  catch (err) { fail(err); }
}
function applicants() {
  const all = myApplicants().sort((a, b) => b.date - a.date);
  let list = appFilter ? all.filter(a => a.status === appFilter) : all;
  const q = appQuery.trim().toLowerCase();
  if (q) list = list.filter(a => (userName(a.userId) + ' ' + (db.jobs.find(j => j.id === a.jobId)?.title || '')).toLowerCase().includes(q));
  list = list.slice().sort(appSort === 'old' ? (a, b) => a.date - b.date : appSort === 'az' ? (a, b) => userName(a.userId).localeCompare(userName(b.userId)) : (a, b) => b.date - a.date);
  return `${pageHeader('Applicant Review', 'Review incoming candidate applications and update their status.')}
    <div class="chips">${[['', 'All', all.length], ...STATUSES.map(s => [s, s, all.filter(a => a.status === s).length])].map(([v, l, n]) => `<button type="button" class="chip ${appFilter === v ? 'active' : ''}" onclick="go('applicants','${v}')">${l} <b>${n}</b></button>`).join('')}</div>
    <div class="toolbar">
      <input class="field" id="appSearch" placeholder="🔍 Search candidate or position" value="${esc(appQuery)}" oninput="setAppQuery(this.value)">
      <select class="field" style="max-width:200px" onchange="appSort=this.value;render()">${[['new', 'Newest first'], ['old', 'Oldest first'], ['az', 'Name A–Z']].map(([v, l]) => `<option value="${v}" ${appSort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="panel" id="appPanel">${list.length ? `<div class="table-wrap"><table class="table">
      <tr><th>Candidate</th><th>Position</th><th>Date</th><th>Profile</th><th>Documents</th><th>Notes</th><th>Status</th></tr>
      ${list.map(a => { const c = db.users.find(x => x.id === a.userId);
        return `<tr><td data-label="Candidate">${esc(c?.name || 'Candidate')}${c && isComplete(c) ? badge(true) : ''}<br><span class="muted">${esc(c?.email || '')}</span></td>
        <td data-label="Position">${esc(db.jobs.find(j => j.id === a.jobId)?.title || '')}</td><td data-label="Date">${a.date ? esc(new Date(a.date).toLocaleString()) : 'Date unavailable'}</td>
        <td data-label="Profile"><button class="secondary" onclick="viewApplicantProfile(${a.id})">View Profile</button></td>
        <td data-label="Documents">${(a.documents || []).map(d => `<button class="doc-link" onclick="downloadDoc(${a.id},${d.id})">${esc(d.name)}</button>`).join('')}</td>
        <td data-label="Notes"><button class="secondary" onclick="editNote(${a.id})">${a.note ? '📝 Edit note' : '＋ Add note'}</button></td>
        <td data-label="Status"><select class="field" onchange="askStatus(${a.id},this.value)">${options(STATUSES, a.status)}</select></td></tr>`; }).join('')}
    </table></div>` : '<div class="empty">No applicants found.</div>'}</div>`;
}
function viewApplicantProfile(applicationId) {
  const a = db.applications.find(x => x.id === applicationId);
  if (!a || !myJobs().some(j => j.id === a.jobId)) return;
  const c = db.users.find(x => x.id === a.userId);
  if (!c || c.role !== 'seeker') return;
  const job = db.jobs.find(j => j.id === a.jobId);
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'applicantProfileModal';
  modal.innerHTML = `<div class="modal applicant-profile-modal" role="dialog" aria-modal="true" aria-labelledby="applicantProfileTitle">
    <div class="applicant-profile-head"><div class="pfp">${avatarHTML(c)}</div><div><h2 id="applicantProfileTitle">${esc(c.name || 'Candidate')}${isComplete(c) ? badge(true) : ''}</h2><p class="muted">${esc(c.email || 'Email unavailable')}</p></div></div>
    <div class="applicant-profile-details">
      <div><strong>Applied for</strong><span>${esc(job?.title || 'Job unavailable')}</span></div>
      <div><strong>Location</strong><span>${esc(c.location || 'Not provided')}</span></div>
      <div class="profile-bio"><strong>Bio / Professional Summary</strong><p>${esc(c.bio || 'No professional summary provided.')}</p></div>
    </div>
    <div class="actions"><button type="button" class="primary" id="closeApplicantProfile">Close</button></div>
  </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  $('#closeApplicantProfile').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}
async function updateStatus(id, status, msg = '') {
  const a = db.applications.find(x => x.id === id);
  if (!a || !STATUSES.includes(status) || !myJobs().some(j => j.id === a.jobId)) return;
  try {
    await api(`/applications/${id}/status`, { method: 'PUT', body: { status, msg } });
    await refresh();
    toast(`Marked as ${status}.`);
  } catch (err) { fail(err); }
  render();
}
async function downloadDoc(id, docId) {
  const a = db.applications.find(x => x.id === id);
  if (!a || !myJobs().some(j => j.id === a.jobId)) return;
  try {
    const d = await api(`/applications/${id}/documents/${docId}`);
    const l = document.createElement('a'); l.href = d.data; l.download = d.name;
    document.body.appendChild(l); l.click(); l.remove();
  } catch (err) { fail(err); }
}

/* ---------- Seeker extras: saved jobs, match score, notifications, timeline, completeness ---------- */
const skillList = u => (u.skills || '').toLowerCase().split(/[,\n]/).map(s => s.trim()).filter(Boolean);
function matchScore(j) {
  const u = user(); if (!u || u.role !== 'seeker') return null;
  const sk = skillList(u); if (!sk.length) return null;
  const items = (j.requirements || '').toLowerCase().split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
  if (!items.length) return null;
  return Math.round(items.filter(it => sk.some(s => it.includes(s) || s.includes(it))).length / items.length * 100);
}
const salaryOf = j => Math.max(0, ...((j.salary || '').match(/\d[\d,]*/g) || []).map(n => +n.replace(/,/g, '')));
const SORTS = {
  new: (a, b) => b.created - a.created,
  old: (a, b) => a.created - b.created,
  salary: (a, b) => salaryOf(b) - salaryOf(a) || b.created - a.created,
  match: (a, b) => (matchScore(b) ?? -1) - (matchScore(a) ?? -1) || b.created - a.created
};
async function toggleSave(id) {
  try {
    const r = await api(`/jobs/${id}/save`, { method: 'POST' });
    await refresh(); render(); toast(r.saved ? 'Job saved.' : 'Removed from saved jobs.');
  } catch (err) { fail(err); }
}
function savedJobs() {
  const u = user(), l = db.jobs.filter(j => (u.saved || []).includes(j.id)).sort(SORTS.new);
  return `${pageHeader('Saved Jobs', 'Jobs you bookmarked for later.')}` +
    (l.length ? jobCards(l) : `<div class="panel empty">No saved jobs yet. Tap the ♡ on any job to save it. <a href="#" onclick="go('jobs');return false">Browse jobs →</a></div>`);
}
const badge = (small = true, earned = true) => `<span class="pl-badge ${small ? 'sm' : 'lg'} ${earned ? '' : 'locked'}" title="${earned ? 'ProLink Verified: profile complete' : 'Complete your profile to earn this badge'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5z"/><path d="M8.5 12l2.5 2.5L16 9.5"/></svg></span>`;
const profileFields = u => u.role === 'seeker'
  ? [['photo', u.photo], ['birthdate', u.birthdate], ['sex', u.sex], ['location', u.location], ['bio', u.bio], ['skills', u.skills]]
  : [['company logo', u.photo], ['company name', u.company], ['location', u.location], ['about the company', u.bio]];
/* For your own account the fields are checked here; for other people the server sends a "verified" flag. */
const isComplete = u => !!u && (u.id === current ? profileFields(u).every(x => x[1]) : !!u.verified);
function paintName(u) {
  const b = isComplete(u) ? badge(true) : '';
  $('#topName').innerHTML = esc(u.name) + b; $('#ddName').innerHTML = esc(u.name) + b;
}
const empBadge = j => { const e = db.users.find(x => x.id === j.employer); return e && isComplete(e) ? badge(true) : ''; };
function completenessBar(u) {
  const f = profileFields(u), miss = f.filter(x => !x[1]).map(x => x[0]), pct = Math.round((f.length - miss.length) / f.length * 100), done = !miss.length;
  return `<div class="panel" id="completeBox"><div class="badge-row">${badge(false, done)}<div class="grow">
    <strong>${done ? 'You earned the ProLink Verified badge!' : `Your profile is ${pct}% complete`}</strong>
    <div class="meter"><span style="width:${pct}%"></span></div>
    <div class="muted" style="margin-top:8px">${done ? `Your badge shows next to your name, so ${u.role === 'seeker' ? 'employers' : 'job seekers'} know your profile is complete.` : 'Still to add: ' + miss.join(', ') + '. Complete everything to earn the ProLink Verified badge.'}</div></div></div></div>`;
}
const histOf = a => a.history || [{ status: 'Pending', date: a.date }];
function showTimeline(id) {
  const a = db.applications.find(x => x.id === id && x.userId === current); if (!a) return;
  const j = db.jobs.find(x => x.id === a.jobId) || {}, steps = histOf(a);
  const m = document.createElement('div'); m.className = 'modal-backdrop';
  m.innerHTML = `<div class="modal"><h2>Application timeline</h2><p class="muted">${esc(j.title || 'Removed job')} · ${esc(j.company || '')}</p>
    <ol class="timeline">${steps.map((s, i) => `<li class="${i === steps.length - 1 ? 'current' : ''}"><span class="dot"></span><div><span class="status ${s.status}">${s.status === 'Pending' ? 'Applied (Pending)' : s.status}</span><div class="muted">${esc(new Date(s.date).toLocaleString())}</div>${s.msg ? `<div class="tl-msg">💬 ${esc(s.msg)}</div>` : ''}</div></li>`).join('')}</ol>
    <div class="actions"><button type="button" class="primary" id="tlClose">Close</button></div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  $('#tlClose').onclick = close;
  m.addEventListener('click', e => { if (e.target === m) close(); });
}
function openNotif(appId) {
  closeMenu(); go('applications', '');
  const row = appId && document.getElementById('app-' + appId);
  if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 2400); }
}
const myNotifs = () => (db.notifs || []).filter(n => n.userId === current);
function renderBell() {
  const u = user(), wrap = $('.notif-wrap'); if (!u || !wrap) return;
  wrap.classList.toggle('hidden', u.role !== 'seeker');
  const l = myNotifs().slice().sort((a, b) => b.date - a.date), un = l.filter(n => !n.read).length;
  $('#bellBadge').textContent = un; $('#bellBadge').classList.toggle('hidden', !un);
  $('#notifMenu').innerHTML = `<div class="dd-head"><strong>Notifications</strong></div><div class="dd-sep"></div>` +
    (l.length ? l.slice(0, 8).map(n => `<button type="button" class="notif-item ${n.read ? '' : 'unread'}" onclick="openNotif(${n.appId || 0})">${esc(n.text)}${n.msg ? `<span class="notif-msg">💬 ${esc(n.msg)}</span>` : ''}<span class="muted">${esc(new Date(n.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</span></button>`).join('') : '<div class="notif-item muted">No notifications yet.</div>');
}

/* ---------- Employer extras: status, notes, chart ---------- */
const isExpired = j => !!j.deadline && new Date(j.deadline + 'T23:59:59') < new Date();
const isClosed = j => !!j.closed || isExpired(j);
const jobStatus = j => j.closed ? 'Closed' : isExpired(j) ? 'Expired' : 'Open';
async function toggleJob(id) {
  if (!myJobs().some(x => x.id === id)) return;
  try {
    const r = await api(`/jobs/${id}/toggle`, { method: 'POST' });
    await refresh(); render(); toast(r.closed ? 'Job closed. It no longer accepts applications.' : 'Job reopened.');
  } catch (err) { fail(err); }
}
function askStatus(id, status) {
  const a = db.applications.find(x => x.id === id);
  if (!a || !STATUSES.includes(status) || !myJobs().some(j => j.id === a.jobId)) return;
  if (a.status === status) return render();
  const job = db.jobs.find(j => j.id === a.jobId);
  const m = document.createElement('div'); m.className = 'modal-backdrop';
  m.innerHTML = `<div class="modal"><h2>Mark as ${status}</h2><p class="muted">${esc(userName(a.userId))} · ${esc(job?.title || '')}</p>
    <form id="msgForm"><label>Message to the applicant (optional)<textarea class="field" id="msgText" maxlength="300" placeholder="e.g. Please come for an interview on Friday, 10 AM"></textarea></label>
    <span class="hint">The applicant will see this in their notification and application timeline. Max 300 characters.</span>
    <div class="actions"><button type="button" class="secondary" id="msgCancel">Cancel</button><button type="submit" class="primary">Confirm</button></div></form></div>`;
  document.body.appendChild(m);
  function close() { m.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') { close(); render(); } }
  document.addEventListener('keydown', onKey);
  $('#msgCancel').onclick = () => { close(); render(); };
  m.addEventListener('click', e => { if (e.target === m) { close(); render(); } });
  $('#msgText').focus();
  $('#msgForm').onsubmit = e => { e.preventDefault(); const txt = $('#msgText').value.trim(); close(); updateStatus(id, status, txt); };
}
/* In-app confirmation pop-up (replaces the browser's confirm(), which can be blocked) */
function confirmBox(title, text, okLabel = 'Confirm', danger = true) {
  return new Promise(resolve => {
    const m = document.createElement('div'); m.className = 'modal-backdrop';
    m.innerHTML = `<div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="cfTitle"><h2 id="cfTitle">${esc(title)}</h2>
      <p class="muted" style="margin:10px 0 22px;line-height:1.5">${esc(text)}</p>
      <div class="actions"><button type="button" class="secondary" id="cfNo">Cancel</button><button type="button" class="${danger ? 'danger' : 'primary'}" id="cfYes">${esc(okLabel)}</button></div></div>`;
    document.body.appendChild(m);
    const done = v => { m.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    $('#cfNo').onclick = () => done(false);
    $('#cfYes').onclick = () => done(true);
    m.addEventListener('click', e => { if (e.target === m) done(false); });
    $('#cfNo').focus();
  });
}
function setAppQuery(v) {
  appQuery = v;
  const t = document.createElement('div'); t.innerHTML = applicants();
  const np = t.querySelector('#appPanel'), cp = $('#appPanel');
  if (np && cp) cp.innerHTML = np.innerHTML; else render();
}
function editNote(id) {
  const a = db.applications.find(x => x.id === id);
  if (!a || !myJobs().some(j => j.id === a.jobId)) return;
  const m = document.createElement('div'); m.className = 'modal-backdrop';
  m.innerHTML = `<div class="modal"><h2>Private note</h2><p class="muted">${esc(userName(a.userId))} · Only you can see this note.</p>
    <form id="noteForm"><textarea class="field" id="noteText" maxlength="500" placeholder="e.g. Strong portfolio, follow up on Friday">${esc(a.note || '')}</textarea>
    <span class="hint">Max 500 characters</span>
    <div class="actions"><button type="button" class="secondary" id="noteCancel">Cancel</button><button type="submit" class="primary">Save note</button></div></form></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  $('#noteCancel').onclick = close;
  m.addEventListener('click', e => { if (e.target === m) close(); });
  $('#noteText').focus();
  $('#noteForm').onsubmit = async e => {
    e.preventDefault();
    try {
      await api(`/applications/${id}/note`, { method: 'PUT', body: { note: $('#noteText').value.trim() } });
      await refresh(); close(); render(); toast('Note saved.');
    } catch (err) { fail(err); }
  };
}
function statusChart(apps) {
  if (!apps.length) return '<div class="empty">No applicants yet.</div>';
  const count = s => apps.filter(a => a.status === s).length, max = Math.max(...STATUSES.map(count), 1);
  return `<div class="chart">${STATUSES.map(s => `<div class="bar-row"><span>${s}</span><div class="bar-track"><div class="bar ${s}" style="width:${count(s) / max * 100}%"></div></div><b>${count(s)}</b></div>`).join('')}</div>`;
}

/* ---------- Settings ---------- */
function settings() {
  const u = user();
  return `${pageHeader('Settings', 'Manage your appearance and account security.')}
    <div class="panel"><h3>Appearance</h3>
      <div class="setting-row"><div><strong>Theme</strong><div class="muted">Choose how ProLink looks on your device.</div></div>
        <select class="field setting-select" id="themeSelect"><option value="light">Light</option><option value="dark">Dark</option></select></div></div>
    <div class="panel"><h3>Account</h3>
      <div class="setting-row"><div><strong>${esc(u.name)}</strong><div class="muted">${esc(u.email)} · ${u.role === 'seeker' ? 'Job Seeker' : 'Employer / Recruiter'}</div></div>
        <button class="secondary" type="button" onclick="go('profile')">${u.role === 'seeker' ? 'Edit profile' : 'Edit company profile'}</button></div></div>
    <div class="panel"><h3>Change password</h3>
      <form id="passwordForm" class="formgrid">
        <label class="full">Current password<input class="field" id="curPw" type="password" autocomplete="current-password" required></label>
        <label>New password (min. 6 characters)<input class="field" id="newPw" type="password" minlength="6" autocomplete="new-password" required></label>
        <label>Confirm new password<input class="field" id="newPw2" type="password" minlength="6" autocomplete="new-password" required></label>
        <div class="full form-actions"><button class="primary" type="submit">Update password</button></div>
      </form></div>`;
}
function bindSettings() {
  const sel = $('#themeSelect'); sel.value = currentTheme();
  sel.onchange = () => applyTheme(sel.value);
  $('#passwordForm').onsubmit = async e => {
    e.preventDefault();
    const form = e.target, cur = $('#curPw').value, np = $('#newPw').value, np2 = $('#newPw2').value;
    if (np.length < 6) return toast('New password must be at least 6 characters.', 'err');
    if (np !== np2) return toast('New passwords do not match.', 'err');
    if (np === cur) return toast('New password must be different from the current one.', 'err');
    try { await api('/me/password', { method: 'PUT', body: { current: cur, next: np } }); form.reset(); toast('Password updated.'); }
    catch (err) { fail(err); }
  };
}

/* ---------- About us ---------- */
function about() {
  return `${pageHeader('About ProLink', 'Connecting people with the work that fits them.')}
    <div class="panel about-hero"><p>ProLink is a job-matching platform that brings job seekers and employers together in one simple place. Seekers can discover openings, apply in minutes and track every application. Employers can post positions, review candidates and move hiring forward.</p></div>
    <div class="about-grid">
      <div class="panel"><div class="about-icon" aria-hidden="true">🎯</div><h3>Our Mission</h3>
        <p>To make finding work and finding talent simple, fair and accessible, giving every job seeker a clear path to opportunity and giving employers a fast, trustworthy way to meet the right people.</p></div>
      <div class="panel"><div class="about-icon" aria-hidden="true">🔭</div><h3>Our Vision</h3>
        <p>A Philippines where everyone can find meaningful work that fits their skills and goals, and where every business, big or small, can grow with the right team.</p></div>
    </div>
    <div class="panel"><h3>What we value</h3>
      <div class="values">
        <div><strong>Accessibility</strong><p>Opportunities should be easy to find, whatever your location or background.</p></div>
        <div><strong>Transparency</strong><p>Clear job details, clear requirements and clear application status.</p></div>
        <div><strong>Opportunity</strong><p>Helping people grow their careers and helping teams find the talent they need.</p></div>
      </div></div>`;
}
