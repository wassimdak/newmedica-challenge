const express = require('express');
const bcrypt = require('bcryptjs');
const { get } = require('../lib/dbHelpers');
const { createSession, destroySession, getSession } = require('../lib/auth');

const router = express.Router();

// --- Préparatrices ---
router.get('/login', (req, res) => {
  // Vérifie la session réelle, pas juste la présence du cookie : les sessions sont en mémoire et
  // ne survivent pas à un redémarrage serveur, un cookie périmé provoquerait sinon une boucle
  // infinie de redirection entre /login et / (cookie présent -> redirige vers / -> session
  // introuvable -> redirige vers /login -> ...).
  const session = getSession(req.cookies.nm_app);
  if (session && session.role === 'preparatrice') return res.redirect('/');
  if (req.cookies.nm_app) res.clearCookie('nm_app');
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
  const session = getSession(req.cookies.nm_admin);
  if (session && ['super_admin', 'kam_regional', 'marque_lecture'].includes(session.role)) {
    return res.redirect('/admin/dashboard');
  }
  if (req.cookies.nm_admin) res.clearCookie('nm_admin');
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
