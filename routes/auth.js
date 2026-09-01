const express = require('express');
const bcrypt = require('bcryptjs');
const { get } = require('../lib/dbHelpers');
const { createSession, destroySession } = require('../lib/auth');

const router = express.Router();

// --- Préparatrices ---
router.get('/login', (req, res) => {
  if (req.cookies.nm_app) return res.redirect('/');
  res.render('app/login', { error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const preparatrice = await get('SELECT * FROM preparatrices WHERE email = ? AND statut = ?', [
    (email || '').trim().toLowerCase(),
    'actif',
  ]);
  if (!preparatrice || !(await bcrypt.compare(password || '', preparatrice.password_hash))) {
    return res.render('app/login', { error: 'Identifiant ou mot de passe incorrect.' });
  }
  const token = createSession(preparatrice.id, 'preparatrice');
  res.cookie('nm_app', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' });
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies.nm_app);
  res.clearCookie('nm_app');
  res.redirect('/login');
});

// --- Back-office ---
router.get('/admin/login', (req, res) => {
  if (req.cookies.nm_admin) return res.redirect('/admin/dashboard');
  res.render('admin/login', { error: null });
});

router.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await get('SELECT * FROM backoffice_users WHERE email = ?', [(email || '').trim().toLowerCase()]);
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.render('admin/login', { error: 'Identifiant ou mot de passe incorrect.' });
  }
  const token = createSession(user.id, user.role, user.region_id);
  res.cookie('nm_admin', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' });
  res.redirect('/admin/dashboard');
});

router.post('/admin/logout', (req, res) => {
  destroySession(req.cookies.nm_admin);
  res.clearCookie('nm_admin');
  res.redirect('/admin/login');
});

module.exports = router;
