require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
if (!process.env.JWT_SECRET) console.warn('[warn] JWT_SECRET is not set in .env. Using an insecure development secret.');

/* ---------- Constants (same rules as the front end had) ---------- */
const STATUSES = ['Pending', 'Reviewing', 'Accepted', 'Rejected'];
const JOB_TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract'];
const ALLOWED_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com'];
const EMAIL_RULE_MSG = 'Please use a Gmail, Yahoo or Outlook email address.';
const MAX_FILE_SIZE = 1024 * 1024;
const CODE_TTL = 10 * 60 * 1000, MAX_ATTEMPTS = 5, RESEND_COOLDOWN = 15 * 1000;

/* ---------- Helpers ---------- */
const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const str = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
const norm = n => n.trim().replace(/\s+/g, ' ');
const cleanName = v => v.replace(/[^A-Za-z\u00C0-\u024F\s.'-]/g, '');
const emailOk = e => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && ALLOWED_EMAIL_DOMAINS.includes(e.split('@')[1]);
const int = v => { const n = Number(v); if (!Number.isInteger(n)) throw httpError(400, 'Invalid id.'); return n; };
const sign = (payload, expiresIn = '7d') => jwt.sign(payload, JWT_SECRET, { expiresIn });
const isExpired = j => !!j.deadline && new Date(j.deadline + 'T23:59:59') < new Date();
const isClosed = j => !!j.closed || isExpired(j);

const verified = u => u.role === 'seeker'
  ? !!(u.photo && u.birthdate && u.sex && u.location && u.bio && u.skills)
  : !!(u.photo && u.company && u.location && u.bio);

async function nameTaken(name, exceptId = 0) {
  const k = norm(name).toLowerCase();
  const all = await prisma.user.findMany({ select: { id: true, name: true } });
  return all.some(u => u.id !== exceptId && norm(u.name).toLowerCase() === k);
}

/* ---------- Output shapes (match what the front end already expects) ---------- */
const ms = d => d.getTime();
const fullUser = (u, saved) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, company: u.company, bio: u.bio, location: u.location,
  birthdate: u.birthdate, sex: u.sex, skills: u.skills, photo: u.photo, created: ms(u.createdAt), saved
});
const pubUser = u => ({ id: u.id, name: u.name, role: u.role, company: u.company, photo: u.photo, location: u.location, bio: u.bio, verified: verified(u) });
const jobOut = j => ({
  id: j.id, employer: j.employerId ?? 0, company: j.company, title: j.title, location: j.location, type: j.type,
  salary: j.salary, description: j.description, requirements: j.requirements, deadline: j.deadline, closed: j.closed, created: ms(j.createdAt)
});
const APP_INC = {
  documents: { select: { id: true, name: true, type: true, size: true }, orderBy: { id: 'asc' } },
  events: { orderBy: { id: 'asc' } }
};
const appOut = (a, withNote) => ({
  id: a.id, jobId: a.jobId, userId: a.userId, status: a.status, date: ms(a.createdAt), documents: a.documents,
  history: a.events.map(e => ({ status: e.status, date: ms(e.createdAt), msg: e.msg })),
  ...(withNote ? { note: a.note } : {})
});
const notifOut = n => ({ id: n.id, userId: n.userId, text: n.text, appId: n.applicationId || 0, msg: n.msg, date: ms(n.createdAt), read: n.read });

/* ---------- Middleware ---------- */
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '25mb' }));

const auth = wrap(async (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw httpError(401, 'Please log in.');
  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); } catch (e) { throw httpError(401, 'Session expired. Please log in again.'); }
  if (payload.purpose) throw httpError(401, 'Session expired. Please log in again.');
  const user = await prisma.user.findUnique({ where: { id: payload.uid } });
  if (!user) throw httpError(401, 'Session expired. Please log in again.');
  req.user = user;
  next();
});
const only = role => (req, res, next) => req.user.role === role ? next() : next(httpError(403, 'You are not allowed to do that.'));

/* ---------- Email codes (signup + password reset) ---------- */
const pending = new Map();   // key "signup:email" or "reset:email" -> { code, expires, attempts, lastSent, ...data }
const usedResetTokens = new Set();
const makeCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

async function sendCodeEmail(email, name, code) {
  const { EMAILJS_SERVICE_ID: s, EMAILJS_TEMPLATE_ID: t, EMAILJS_PUBLIC_KEY: u, EMAILJS_PRIVATE_KEY: k } = process.env;
  if (!s || !t || !u || !k) { console.log(`\n[DEV] Verification code for ${email}: ${code}\n`); return; }
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: s, template_id: t, user_id: u, accessToken: k, template_params: { to_email: email, to_name: name, code } })
  });
  if (!r.ok) throw httpError(502, 'Could not send the email: ' + (await r.text()).slice(0, 120));
}
async function issueCode(kind, email, name, data = {}) {
  const key = kind + ':' + email, p = pending.get(key);
  if (p && Date.now() - p.lastSent < RESEND_COOLDOWN)
    throw httpError(429, `Please wait ${Math.ceil((RESEND_COOLDOWN - (Date.now() - p.lastSent)) / 1000)}s before requesting a new code.`);
  const code = makeCode();
  await sendCodeEmail(email, name, code);
  pending.set(key, { ...data, name, code, expires: Date.now() + CODE_TTL, attempts: 0, lastSent: Date.now() });
}
function checkCode(kind, email, code) {
  const key = kind + ':' + email, p = pending.get(key);
  if (!p) throw httpError(400, 'Please request a new code.', { restart: true });
  if (Date.now() > p.expires) { pending.delete(key); throw httpError(400, 'Code expired. Request a new one.', { restart: true }); }
  if (str(code, 6) !== p.code) {
    if (++p.attempts >= MAX_ATTEMPTS) { pending.delete(key); throw httpError(400, 'Too many wrong attempts. Request a new code.', { restart: true }); }
    throw httpError(400, `Incorrect code. ${MAX_ATTEMPTS - p.attempts} attempt(s) left.`);
  }
  pending.delete(key);
  return p;
}

/* ---------- Auth routes ---------- */
app.get('/api/auth/name-taken', wrap(async (req, res) => {
  res.json({ taken: await nameTaken(str(req.query.name, 100)) });
}));

app.post('/api/auth/signup/request', wrap(async (req, res) => {
  const b = req.body, name = norm(str(b.name, 100)), email = str(b.email, 200).toLowerCase(), password = String(b.password || ''), role = b.role;
  if (name.length < 2 || cleanName(name) !== name) throw httpError(400, 'Please enter your full name.');
  if (!emailOk(email)) throw httpError(400, EMAIL_RULE_MSG);
  if (!['seeker', 'employer'].includes(role)) throw httpError(400, 'Please choose a role.');
  if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters.');
  if (await nameTaken(name)) throw httpError(400, 'This name is already taken. Please use a different name.');
  if (await prisma.user.findUnique({ where: { email } })) throw httpError(400, 'An account with this email already exists.');
  await issueCode('signup', email, name, { email, role, passwordHash: await bcrypt.hash(password, 10) });
  res.json({ ok: true });
}));

app.post('/api/auth/signup/resend', wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase(), p = pending.get('signup:' + email);
  if (!p) throw httpError(400, 'Please sign up again.', { restart: true });
  await issueCode('signup', email, p.name, { email, role: p.role, passwordHash: p.passwordHash });
  res.json({ ok: true });
}));

app.post('/api/auth/signup/verify', wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const p = checkCode('signup', email, req.body.code);
  if (await prisma.user.findUnique({ where: { email } })) throw httpError(400, 'An account with this email already exists.', { restart: true });
  if (await nameTaken(p.name)) throw httpError(400, 'This name is already taken. Please use a different name.', { restart: true });
  const user = await prisma.user.create({ data: { name: p.name, email, passwordHash: p.passwordHash, role: p.role } });
  res.json({ token: sign({ uid: user.id }) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase(), user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash)))
    throw httpError(401, 'Incorrect email or password. Try again.');
  res.json({ token: sign({ uid: user.id }) });
}));

app.post('/api/auth/forgot/request', wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  if (!emailOk(email)) throw httpError(400, EMAIL_RULE_MSG);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw httpError(404, 'No account found for that email.');
  await issueCode('reset', email, user.name);
  res.json({ ok: true });
}));

app.post('/api/auth/forgot/verify', wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  checkCode('reset', email, req.body.code);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw httpError(404, 'Account not found.', { restart: true });
  res.json({ resetToken: sign({ uid: user.id, purpose: 'reset' }, '10m') });
}));

app.post('/api/auth/forgot/reset', wrap(async (req, res) => {
  const token = String(req.body.resetToken || ''), password = String(req.body.password || '');
  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); } catch (e) { throw httpError(400, 'Session expired. Start again.', { restart: true }); }
  if (payload.purpose !== 'reset' || usedResetTokens.has(token)) throw httpError(400, 'Session expired. Start again.', { restart: true });
  if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters.');
  await prisma.user.update({ where: { id: payload.uid }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  usedResetTokens.add(token);
  res.json({ ok: true });
}));

/* ---------- Everything the signed-in user needs in one call ---------- */
app.get('/api/bootstrap', auth, wrap(async (req, res) => {
  const me = req.user;
  const jobs = await prisma.job.findMany({ orderBy: { createdAt: 'desc' } });
  const apps = await prisma.application.findMany({
    where: me.role === 'seeker' ? { userId: me.id } : { job: { employerId: me.id } },
    include: APP_INC, orderBy: { createdAt: 'desc' }
  });
  const saved = (await prisma.savedJob.findMany({ where: { userId: me.id } })).map(s => s.jobId);
  const notifs = me.role === 'seeker'
    ? await prisma.notification.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'desc' }, take: 50 }) : [];
  const ids = new Set();
  jobs.forEach(j => j.employerId && ids.add(j.employerId));
  if (me.role === 'employer') apps.forEach(a => ids.add(a.userId));
  ids.delete(me.id);
  const others = await prisma.user.findMany({ where: { id: { in: [...ids] } } });
  const users = [fullUser(me, saved), ...others.map(u => me.role === 'employer' && u.role === 'seeker' ? { ...pubUser(u), email: u.email } : pubUser(u))];
  res.json({ me: me.id, users, jobs: jobs.map(jobOut), applications: apps.map(a => appOut(a, me.role === 'employer')), notifs: notifs.map(notifOut) });
}));

/* ---------- Profile ---------- */
app.put('/api/me', auth, wrap(async (req, res) => {
  const b = req.body, me = req.user, name = norm(str(b.name, 100));
  if (name.length < 2 || cleanName(name) !== name) throw httpError(400, 'Please enter a valid name.');
  const data = { name, location: str(b.location, 80), bio: str(b.bio, 2000) };
  if (me.role === 'seeker') {
    const sex = str(b.sex, 10), birthdate = str(b.birthdate, 10);
    if (!['', 'Male', 'Female'].includes(sex)) throw httpError(400, 'Invalid value for sex.');
    if (birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) throw httpError(400, 'Invalid birthdate.');
    Object.assign(data, { sex, birthdate, skills: str(b.skills, 500) });
  } else data.company = str(b.company, 120);
  await prisma.user.update({ where: { id: me.id }, data });
  if (me.role === 'employer') await prisma.job.updateMany({ where: { employerId: me.id }, data: { company: data.company } });
  res.json({ ok: true });
}));

app.put('/api/me/photo', auth, wrap(async (req, res) => {
  const photo = String(req.body.photo || '');
  if (photo && (!photo.startsWith('data:image/') || photo.length > 600000)) throw httpError(400, 'Invalid photo.');
  await prisma.user.update({ where: { id: req.user.id }, data: { photo } });
  res.json({ ok: true });
}));

app.put('/api/me/password', auth, wrap(async (req, res) => {
  const cur = String(req.body.current || ''), next = String(req.body.next || '');
  if (!(await bcrypt.compare(cur, req.user.passwordHash))) throw httpError(400, 'Current password is incorrect.');
  if (next.length < 6) throw httpError(400, 'New password must be at least 6 characters.');
  if (next === cur) throw httpError(400, 'New password must be different from the current one.');
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
  res.json({ ok: true });
}));

/* ---------- Notifications ---------- */
app.get('/api/notifications', auth, only('seeker'), wrap(async (req, res) => {
  const l = await prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json(l.map(notifOut));
}));
app.post('/api/notifications/read', auth, wrap(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, read: false }, data: { read: true } });
  res.json({ ok: true });
}));

/* ---------- Jobs (employer) ---------- */
function jobFields(b) {
  const d = {
    title: str(b.title, 150), type: str(b.type, 30), location: str(b.location, 80), salary: str(b.salary, 100),
    description: str(b.description, 5000), requirements: str(b.requirements, 2000), deadline: str(b.deadline, 10)
  };
  if (!d.title || !d.location || !d.description || !d.requirements) throw httpError(400, 'Please fill in all required fields.');
  if (!JOB_TYPES.includes(d.type)) throw httpError(400, 'Invalid employment type.');
  if (d.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(d.deadline)) throw httpError(400, 'Invalid deadline.');
  return d;
}
async function ownedJob(req) {
  const job = await prisma.job.findUnique({ where: { id: int(req.params.id) } });
  if (!job || job.employerId !== req.user.id) throw httpError(404, 'Job not found.');
  return job;
}

app.post('/api/jobs', auth, only('employer'), wrap(async (req, res) => {
  const job = await prisma.job.create({ data: { ...jobFields(req.body), employerId: req.user.id, company: req.user.company || req.user.name } });
  res.json(jobOut(job));
}));
app.put('/api/jobs/:id', auth, only('employer'), wrap(async (req, res) => {
  const job = await ownedJob(req);
  const updated = await prisma.job.update({ where: { id: job.id }, data: { ...jobFields(req.body), company: req.user.company || req.user.name } });
  res.json(jobOut(updated));
}));
app.post('/api/jobs/:id/toggle', auth, only('employer'), wrap(async (req, res) => {
  const job = await ownedJob(req);
  const updated = await prisma.job.update({ where: { id: job.id }, data: { closed: !job.closed } });
  res.json({ closed: updated.closed });
}));
app.delete('/api/jobs/:id', auth, only('employer'), wrap(async (req, res) => {
  const job = await ownedJob(req);
  await prisma.job.delete({ where: { id: job.id } });   // applications are deleted with it (cascade)
  res.json({ ok: true });
}));

/* ---------- Saved jobs + applying (seeker) ---------- */
app.post('/api/jobs/:id/save', auth, only('seeker'), wrap(async (req, res) => {
  const jobId = int(req.params.id), userId = req.user.id;
  if (!(await prisma.job.findUnique({ where: { id: jobId } }))) throw httpError(404, 'Job not found.');
  const key = { userId_jobId: { userId, jobId } };
  const had = await prisma.savedJob.findUnique({ where: key });
  if (had) await prisma.savedJob.delete({ where: key }); else await prisma.savedJob.create({ data: { userId, jobId } });
  res.json({ saved: !had });
}));

app.post('/api/jobs/:id/apply', auth, only('seeker'), wrap(async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: int(req.params.id) } });
  if (!job) throw httpError(404, 'Job not found.');
  if (isClosed(job)) throw httpError(400, 'This job is no longer accepting applications.');
  const docs = Array.isArray(req.body.documents) ? req.body.documents : [];
  if (!docs.length) throw httpError(400, 'Please attach your CV or Resume.');
  if (docs.length > 6) throw httpError(400, 'Too many files.');
  const clean = docs.map(d => {
    const name = str(d.name, 200), type = str(d.type, 100), data = String(d.data || ''), size = Number(d.size) || 0;
    if (!name || !data.startsWith('data:')) throw httpError(400, 'Invalid file.');
    if (size > MAX_FILE_SIZE || data.length > MAX_FILE_SIZE * 1.5) throw httpError(400, `"${name}" is over 1 MB.`);
    return { name, type, size, data };
  });
  try {
    await prisma.application.create({ data: { jobId: job.id, userId: req.user.id, events: { create: { status: 'Pending' } }, documents: { create: clean } } });
  } catch (e) {
    if (e.code === 'P2002') throw httpError(409, 'You already applied to this job.');
    throw e;
  }
  res.json({ ok: true });
}));

app.delete('/api/applications/:id', auth, only('seeker'), wrap(async (req, res) => {
  const a = await prisma.application.findUnique({ where: { id: int(req.params.id) } });
  if (!a || a.userId !== req.user.id) throw httpError(404, 'Application not found.');
  if (a.status !== 'Pending') throw httpError(400, 'Only pending applications can be withdrawn.');
  await prisma.application.delete({ where: { id: a.id } });
  res.json({ ok: true });
}));

/* ---------- Applicant review (employer) ---------- */
async function ownedApplication(req) {
  const a = await prisma.application.findUnique({ where: { id: int(req.params.id) }, include: { job: true } });
  if (!a || a.job.employerId !== req.user.id) throw httpError(404, 'Application not found.');
  return a;
}

app.put('/api/applications/:id/status', auth, only('employer'), wrap(async (req, res) => {
  const a = await ownedApplication(req), status = str(req.body.status, 20), msg = str(req.body.msg, 300);
  if (!STATUSES.includes(status)) throw httpError(400, 'Invalid status.');
  if (a.status !== status) {
    await prisma.$transaction([
      prisma.application.update({ where: { id: a.id }, data: { status } }),
      prisma.applicationEvent.create({ data: { applicationId: a.id, status, msg } }),
      prisma.notification.create({ data: { userId: a.userId, applicationId: a.id, text: `Your application for "${a.job.title}" is now ${status}.`, msg } })
    ]);
  }
  res.json({ ok: true });
}));

app.put('/api/applications/:id/note', auth, only('employer'), wrap(async (req, res) => {
  const a = await ownedApplication(req);
  await prisma.application.update({ where: { id: a.id }, data: { note: str(req.body.note, 500) } });
  res.json({ ok: true });
}));

app.get('/api/applications/:id/documents/:docId', auth, only('employer'), wrap(async (req, res) => {
  const a = await ownedApplication(req);
  const doc = await prisma.applicationDocument.findFirst({ where: { id: int(req.params.docId), applicationId: a.id } });
  if (!doc) throw httpError(404, 'Document not found.');
  res.json({ name: doc.name, type: doc.type, data: doc.data });
}));

/* ---------- Front end + errors ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Files are too large.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => console.log(`ProLink is running at http://localhost:${PORT}`));
