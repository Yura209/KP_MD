const express = require('express');
const pool = require('../db');
const {
  fail,
  validateText,
  tx
} = require('../lib/http');
const {
  sessions,
  makeSession,
  setCookie,
  safeUser,
  hashPassword,
  passwordMatches
} = require('../lib/auth');
const router = express.Router();
router.get('/session', (req, res) => {
  if (!req.session) {
    const s = makeSession();
    setCookie(res, s.token);
    return res.json({
      csrfToken: s.csrfToken,
      user: null
    });
  }
  res.json({
    csrfToken: req.session.csrfToken,
    user: safeUser(req.user)
  });
});
router.get('/setup/status', async (req, res) => {
  const r = await pool.query("SELECT EXISTS(SELECT 1 FROM users WHERE role='admin' AND is_active=TRUE) setup_complete");
  res.json({
    setupRequired: !r.rows[0].setup_complete
  });
});
router.post('/setup/admin', async (req, res) => {
  const remote = req.socket.remoteAddress;
  if (! [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1'
  ].includes(remote)) fail(403, 'Первого администратора можно создать только на локальном компьютере.');
  const fullName = validateText(req.body.fullName, 120, 'имя'),
  email = validateText(req.body.email, 254, 'электронная почта').toLowerCase(),
  password = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Укажите корректный адрес электронной почты.');
  if (password.length < 12 || password.length > 200) fail(400, 'Пароль администратора должен содержать не менее 12 символов.');
  const id = await tx(async db => {
    await db.query('SELECT pg_advisory_xact_lock(72944126)');
    const exists = await db.query("SELECT 1 FROM users WHERE role='admin' AND is_active=TRUE LIMIT 1");
    if (exists.rowCount) fail(409, 'Первый администратор уже создан.');
    const r = await db.query("INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id", [
      fullName,
      email,
      hashPassword(password)
    ]);
    return r.rows[0].id;
  });
  const s = makeSession(id);
  if (req.sessionToken) sessions.delete(req.sessionToken);
  setCookie(res, s.token);
  const u = (await pool.query('SELECT id,full_name,email,phone,role FROM users WHERE id=$1', [
    id
  ])).rows[0];
  res.status(201).json({
    csrfToken: s.csrfToken,
    user: safeUser(u)
  });
});
router.post('/register', async (req, res) => {
  const fullName = validateText(req.body.fullName, 120, 'имя'),
  email = validateText(req.body.email, 254, 'электронная почта').toLowerCase(),
  password = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Укажите корректный адрес электронной почты.');
  if (password.length < 10 || password.length > 200) fail(400, 'Пароль должен содержать от 10 до 200 символов.');
  const r = await pool.query("INSERT INTO users(full_name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,'customer') RETURNING id,full_name,email,phone,role", [
    fullName,
    email,
    String(req.body.phone || '').trim().slice(0, 30) || null,
    hashPassword(password)
  ]);
  const s = makeSession(r.rows[0].id);
  if (req.sessionToken) sessions.delete(req.sessionToken);
  setCookie(res, s.token);
  res.status(201).json({
    csrfToken: s.csrfToken,
    user: safeUser(r.rows[0])
  });
});
router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(),
  r = await pool.query('SELECT id,full_name,email,phone,role,is_active,password_hash FROM users WHERE lower(email)=lower($1)', [
    email
  ]);
  if (!r.rowCount || !r.rows[0].is_active || !passwordMatches(String(req.body.password || ''), r.rows[0].password_hash)) fail(401, 'Неверный адрес электронной почты или пароль.');
  const s = makeSession(r.rows[0].id);
  if (req.sessionToken) sessions.delete(req.sessionToken);
  setCookie(res, s.token);
  res.json({
    csrfToken: s.csrfToken,
    user: safeUser(r.rows[0])
  });
});
router.post('/logout', (req, res) => {
  if (req.sessionToken) sessions.delete(req.sessionToken);
  res.setHeader('Set-Cookie', 'sm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({
    ok: true
  });
});
module.exports = router;
