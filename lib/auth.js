const crypto = require('crypto');
const { get } = require('./dbHelpers');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const sessions = new Map(); // token -> { userId, role, regionId, expiresAt }

// Mot de passe aléatoire lisible (alphabet sans caractères ambigus : pas de 0/O/1/I/l).
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generatePassword(length = 10) {
  const bytes = crypto.randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return password;
}

function createSession(userId, role, regionId = null, impersonatedBy = null) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, role, regionId, impersonatedBy, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

const FORCE_PASSWORD_CHANGE_PATH = '/changer-mot-de-passe';

// --- Application préparatrices (cookie de session "nm_app") ---
async function requireAppPage(req, res, next) {
  const session = getSession(req.cookies.nm_app);
  if (!session || session.role !== 'preparatrice') {
    return res.redirect('/login');
  }
  req.preparatriceId = session.userId;
  req.isImpersonating = !!session.impersonatedBy;
  res.locals.isImpersonating = req.isImpersonating;

  // Mot de passe initial (généré à la création du compte) jamais changé : on bloque l'accès au
  // reste de l'app tant qu'elle n'en a pas choisi un à elle (cf. audit SEC-1). Non applicable
  // quand un admin visualise le compte via "Se connecter en tant que" : forcer un changement de
  // mot de passe qui n'est pas le sien n'aurait pas de sens.
  if (req.path !== FORCE_PASSWORD_CHANGE_PATH && !req.isImpersonating) {
    const preparatrice = await get('SELECT doit_changer_mdp FROM preparatrices WHERE id = ?', [session.userId]);
    if (preparatrice && preparatrice.doit_changer_mdp) {
      return res.redirect(FORCE_PASSWORD_CHANGE_PATH);
    }
  }
  next();
}

function requireAppApi(req, res, next) {
  const session = getSession(req.cookies.nm_app);
  if (!session || session.role !== 'preparatrice') {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  req.preparatriceId = session.userId;
  next();
}

// --- Back-office (cookie de session "nm_admin") ---
function requireAdminPage(req, res, next) {
  const session = getSession(req.cookies.nm_admin);
  if (!session || !['super_admin', 'kam_regional', 'marque_lecture'].includes(session.role)) {
    return res.redirect('/admin/login');
  }
  req.adminUserId = session.userId;
  req.adminRole = session.role;
  req.adminRegionId = session.regionId;
  next();
}

function requireAdminApi(req, res, next) {
  const session = getSession(req.cookies.nm_admin);
  if (!session || !['super_admin', 'kam_regional', 'marque_lecture'].includes(session.role)) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  req.adminUserId = session.userId;
  req.adminRole = session.role;
  req.adminRegionId = session.regionId;
  next();
}

function requireWriteAccess(req, res, next) {
  if (req.adminRole === 'marque_lecture') {
    return res.status(403).json({ error: "Accès en lecture seule" });
  }
  next();
}

module.exports = {
  createSession,
  getSession,
  destroySession,
  generatePassword,
  requireAppPage,
  requireAppApi,
  requireAdminPage,
  requireAdminApi,
  requireWriteAccess,
};
