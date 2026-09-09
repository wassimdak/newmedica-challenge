const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { get } = require('../lib/dbHelpers');
const { createSession, destroySession, getSession } = require('../lib/auth');

const router = express.Router();

// Hash factice comparé quand l'email n'existe pas, pour que le temps de réponse ne trahisse pas
// l'existence d'un compte (bcrypt.compare est sinon court-circuité, donc bien plus rapide, pour
// un email inconnu que pour un mot de passe incorrect sur un compte réel).
const DUMMY_HASH = bcrypt.hashSync('mot-de-passe-factice-pour-comparaison-a-temps-constant', 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.',
});

function cookieOptions(req, maxAge) {
  return { httpOnly: true, maxAge, sameSite: 'lax', secure: req.protocol === 'https' };
}

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

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, remember } = req.body;
  const preparatrice = await get('SELECT * FROM preparatrices WHERE email = ? AND statut = ?', [
    (email || '').trim().toLowerCase(),
    'actif',
  ]);
  const motDePasseValide = await bcrypt.compare(password || '', preparatrice ? preparatrice.password_hash : DUMMY_HASH);
  if (!preparatrice || !motDePasseValide) {
    return res.render('app/login', { error: 'Identifiant ou mot de passe incorrect.' });
  }
  const { token, ttl } = createSession(preparatrice.id, 'preparatrice', null, null, !!remember);
  res.cookie('nm_app', token, cookieOptions(req, ttl));
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

router.post('/admin/login', loginLimiter, async (req, res) => {
  const { email, password, remember } = req.body;
  const user = await get('SELECT * FROM backoffice_users WHERE email = ?', [(email || '').trim().toLowerCase()]);
  const motDePasseValide = await bcrypt.compare(password || '', user ? user.password_hash : DUMMY_HASH);
  if (!user || !motDePasseValide) {
    return res.render('admin/login', { error: 'Identifiant ou mot de passe incorrect.' });
  }
  const { token, ttl } = createSession(user.id, user.role, user.region_id, null, !!remember);
  res.cookie('nm_admin', token, cookieOptions(req, ttl));
  res.redirect('/admin/dashboard');
});

router.post('/admin/logout', (req, res) => {
  destroySession(req.cookies.nm_admin);
  res.clearCookie('nm_admin');
  res.redirect('/admin/login');
});

module.exports = router;
