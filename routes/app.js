const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const { all, get, run } = require('../lib/dbHelpers');
const { requireAppPage, requireAppApi } = require('../lib/auth');
const { matchProduits, preprocessImage, reconnaitreTexte } = require('../lib/ocr');
const {
  currentPeriod,
  previousYearPeriod,
  periodLabel,
  getProgression,
  getPointsBalance,
  getClassement,
} = require('../lib/calculations');

const router = express.Router();

const TICKETS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'tickets');
fs.mkdirSync(TICKETS_DIR, { recursive: true });
const uploadTicket = multer({
  storage: multer.diskStorage({
    destination: TICKETS_DIR,
    filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname) || '.jpg'}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

async function loadPreparatrice(id) {
  return get(
    `SELECT p.*, ph.nom AS pharmacie_nom, ph.region_id, r.nom AS region_nom
     FROM preparatrices p
     JOIN pharmacies ph ON ph.id = p.pharmacie_id
     LEFT JOIN regions r ON r.id = ph.region_id
     WHERE p.id = ?`,
    [id]
  );
}

function messageMotivationnel(progression) {
  const restantes = progression.unitesRestantes;
  if (progression.pctAtteinte >= 100) {
    return `Objectif atteint 🎉 Continue sur ta lancée pour gagner des points bonus supplémentaires !`;
  }
  if (restantes <= 5) {
    return `Encore ${restantes} unité${restantes > 1 ? 's' : ''} pour atteindre ton objectif ! Tu y es presque.`;
  }
  return `Encore ${restantes} unités pour atteindre ton objectif ce mois-ci.`;
}

router.get('/', requireAppPage, async (req, res) => {
  const preparatrice = await loadPreparatrice(req.preparatriceId);
  const periode = currentPeriod();
  const progression = await getProgression(preparatrice.id, periode);
  const pointsBalance = await getPointsBalance(preparatrice.id);
  const notificationsNonLues = await get(
    'SELECT COUNT(*) AS n FROM notifications WHERE preparatrice_id = ? AND lu = 0',
    [preparatrice.id]
  );

  res.render('app/accueil', {
    active: 'accueil',
    preparatrice,
    periode,
    periodeLabel: periodLabel(periode),
    progression,
    pointsBalance,
    message: messageMotivationnel(progression),
    notifNonLues: notificationsNonLues.n,
  });
});

router.get('/challenges', requireAppPage, async (req, res) => {
  const preparatrice = await loadPreparatrice(req.preparatriceId);
  const periode = currentPeriod();

  const rows = await all(
    `SELECT c.*, m.nom AS marque_nom, part.progression, part.statut AS participation_statut
     FROM challenges c
     LEFT JOIN marques m ON m.id = c.marque_id
     LEFT JOIN participations part ON part.challenge_id = c.id AND part.preparatrice_id = ?
     ORDER BY c.periode_fin ASC`,
    [preparatrice.id]
  );

  const today = new Date().toISOString().slice(0, 10);
  const typeLabels = { principal: 'Challenge principal', marque: 'Challenge marque', mission: 'Mission bonus', defi: 'Défi ponctuel' };
  const challenges = rows.map((c) => ({
    ...c,
    typeLabel: typeLabels[c.type] || c.type,
    termine: c.periode_fin < today || c.participation_statut === 'reussi' && c.periode_fin < today,
    pct: c.objectif_unites ? Math.min(100, Math.round(((c.progression || 0) / c.objectif_unites) * 100)) : null,
  }));

  res.render('app/challenges', {
    active: 'challenges',
    preparatrice,
    periodeLabel: periodLabel(periode),
    enCours: challenges.filter((c) => c.periode_fin >= today),
    termines: challenges.filter((c) => c.periode_fin < today),
  });
});

router.get('/classement', requireAppPage, async (req, res) => {
  const preparatrice = await loadPreparatrice(req.preparatriceId);
  const periode = currentPeriod();
  const maille = ['pharmacie', 'regional', 'national'].includes(req.query.maille) ? req.query.maille : 'national';
  const marqueId = req.query.marque || null;

  const classement = await getClassement(periode, {
    maille,
    pharmacieId: preparatrice.pharmacie_id,
    regionId: preparatrice.region_id,
    marqueId,
  });

  const marques = await all('SELECT * FROM marques ORDER BY nom');
  const position = classement.find((c) => c.id === preparatrice.id);

  res.render('app/classement', {
    active: 'classement',
    preparatrice,
    periodeLabel: periodLabel(periode),
    maille,
    marqueId,
    marques,
    top: classement.slice(0, 10),
    position,
    totalParticipantes: classement.length,
  });
});

router.get('/recompenses', requireAppPage, async (req, res) => {
  const preparatrice = await loadPreparatrice(req.preparatriceId);
  const pointsBalance = await getPointsBalance(preparatrice.id);
  const catalogue = await all('SELECT * FROM recompenses WHERE actif = 1 ORDER BY cout_points ASC');
  const historique = await all(
    `SELECT e.*, r.nom AS recompense_nom, r.categorie, r.cout_points
     FROM echanges e JOIN recompenses r ON r.id = e.recompense_id
     WHERE e.preparatrice_id = ? ORDER BY e.date DESC`,
    [preparatrice.id]
  );
  const gains = await all(
    `SELECT * FROM scores WHERE preparatrice_id = ? ORDER BY date DESC LIMIT 15`,
    [preparatrice.id]
  );

  res.render('app/recompenses', {
    active: 'recompenses',
    preparatrice,
    pointsBalance,
    catalogue,
    historique,
    gains,
  });
});

router.post('/recompenses/:id/echanger', requireAppApi, async (req, res) => {
  const recompense = await get('SELECT * FROM recompenses WHERE id = ? AND actif = 1', [req.params.id]);
  if (!recompense) return res.status(404).json({ error: 'Récompense introuvable' });

  const solde = await getPointsBalance(req.preparatriceId);
  if (solde < recompense.cout_points) {
    return res.status(400).json({ error: 'Solde de points insuffisant' });
  }
  if (recompense.stock <= 0) {
    return res.status(400).json({ error: 'Récompense en rupture de stock' });
  }

  await run('INSERT INTO echanges (id, preparatrice_id, recompense_id, statut) VALUES (?, ?, ?, ?)', [
    uuid(), req.preparatriceId, recompense.id, 'demande',
  ]);
  await run('UPDATE recompenses SET stock = stock - 1 WHERE id = ?', [recompense.id]);

  res.json({ ok: true, nouveauSolde: solde - recompense.cout_points });
});

router.get('/profil', requireAppPage, async (req, res) => {
  const preparatrice = await loadPreparatrice(req.preparatriceId);
  const badges = await all(
    `SELECT b.*, o.date AS obtenu_le FROM obtentions o JOIN badges b ON b.id = o.badge_id
     WHERE o.preparatrice_id = ? ORDER BY o.date DESC`,
    [preparatrice.id]
  );
  const historique = await all(
    `SELECT periode, objectif_calcule, ajustement_manuel, ventes_n1 FROM objectifs
     WHERE preparatrice_id = ? ORDER BY periode DESC LIMIT 12`,
    [preparatrice.id]
  );
  for (const h of historique) {
    const row = await get(
      `SELECT COALESCE(SUM(quantite),0) AS total FROM ventes WHERE preparatrice_id = ? AND periode = ? AND statut_validation='valide'`,
      [preparatrice.id, h.periode]
    );
    h.periodeLabel = periodLabel(h.periode);
    h.ventesRealisees = row.total;
    h.cible = h.ajustement_manuel != null ? h.ajustement_manuel : h.objectif_calcule;
  }
  const notifications = await all(
    'SELECT * FROM notifications WHERE preparatrice_id = ? ORDER BY date DESC LIMIT 20',
    [preparatrice.id]
  );

  res.render('app/profil', { active: 'profil', preparatrice, badges, historique, notifications });
});

router.post('/api/notifications/:id/lu', requireAppApi, async (req, res) => {
  await run('UPDATE notifications SET lu = 1 WHERE id = ? AND preparatrice_id = ?', [req.params.id, req.preparatriceId]);
  res.json({ ok: true });
});

// --- Scan de ticket de caisse (photo -> OCR -> relecture -> ventes déclaratives en attente) ---

router.get('/scanner', requireAppPage, async (req, res) => {
  const preparatrice = await loadPreparatrice(req.preparatriceId);
  const marques = await all('SELECT * FROM marques ORDER BY nom');
  const tickets = await all(
    'SELECT * FROM tickets WHERE preparatrice_id = ? ORDER BY created_at DESC LIMIT 10',
    [preparatrice.id]
  );
  res.render('app/scanner', { active: 'accueil', preparatrice, marques, tickets });
});

router.post('/scanner/analyser', requireAppApi, uploadTicket.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Photo requise' });

  const processedPath = req.file.path + '.processed.jpg';
  try {
    await preprocessImage(req.file.path, processedPath);
    const ocrText = await reconnaitreTexte(processedPath);
    const marques = await all('SELECT * FROM marques ORDER BY nom');
    const suggestions = matchProduits(ocrText, marques);
    res.json({
      ok: true,
      photo: `/uploads/tickets/${req.file.filename}`,
      ocrText,
      suggestions,
    });
  } catch (err) {
    console.error('Erreur OCR ticket :', err);
    res.status(500).json({ error: "La reconnaissance automatique a échoué. Vous pouvez ajouter les lignes manuellement." });
  } finally {
    fs.unlink(processedPath, () => {});
  }
});

router.post('/scanner/confirmer', requireAppApi, async (req, res) => {
  const { photo, ocrText, lignes } = req.body;
  if (!photo || !photo.startsWith('/uploads/tickets/') || !fs.existsSync(path.join(__dirname, '..', 'public', photo))) {
    return res.status(400).json({ error: 'Photo introuvable, merci de reprendre la photo.' });
  }
  const lignesValides = Array.isArray(lignes)
    ? lignes.filter((l) => l && l.marque_id && Number(l.quantite) > 0)
    : [];
  if (lignesValides.length === 0) {
    return res.status(400).json({ error: 'Ajoutez au moins une ligne (marque + quantité) avant d\'envoyer.' });
  }

  const periode = currentPeriod();
  const ticketId = uuid();
  await run(
    `INSERT INTO tickets (id, preparatrice_id, photo, periode, statut, texte_ocr) VALUES (?, ?, ?, ?, 'en_attente', ?)`,
    [ticketId, req.preparatriceId, photo, periode, ocrText || null]
  );

  for (const ligne of lignesValides) {
    const produit = await get('SELECT id FROM produits WHERE marque_id = ? LIMIT 1', [ligne.marque_id]);
    await run(
      `INSERT INTO ventes (id, preparatrice_id, produit_id, marque_id, quantite, periode, source, statut_validation, ticket_id)
       VALUES (?, ?, ?, ?, ?, ?, 'ticket_photo', 'en_attente', ?)`,
      [uuid(), req.preparatriceId, produit ? produit.id : null, ligne.marque_id, Math.round(Number(ligne.quantite)), periode, ticketId]
    );
  }

  res.json({ ok: true, ticketId });
});

module.exports = router;
