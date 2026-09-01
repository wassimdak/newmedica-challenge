const crypto = require('crypto');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const sessions = new Map(); // token -> { userId, role, regionId, expiresAt }

function createSession(userId, role, regionId = null) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, role, regionId, expiresAt: Date.now() + SESSION_TTL_MS });
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

// --- Application préparatrices (cookie de session "nm_app") ---
function requireAppPage(req, res, next) {
  const session = getSession(req.cookies.nm_app);
  if (!session || session.role !== 'preparatrice') {
    return res.redirect('/login');
  }
  req.preparatriceId = session.userId;
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
  requireAppPage,
  requireAppApi,
  requireAdminPage,
  requireAdminApi,
  requireWriteAccess,
};
