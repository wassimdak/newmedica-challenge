const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { all, get, run } = require('../lib/dbHelpers');
const { parseCsv } = require('../lib/csv');
const { requireAdminPage, requireAdminApi, requireWriteAccess, generatePassword } = require('../lib/auth');
const {
  currentPeriod,
  previousYearPeriod,
  periodLabel,
  getOrCreateObjectif,
  objectifEffectif,
  recalculerPointsVentes,
  recalcParticipations,
  getKPIs,
} = require('../lib/calculations');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

async function loadAdmin(req) {
  return get('SELECT * FROM backoffice_users WHERE id = ?', [req.adminUserId]);
}

function regionFilterClause(req, column = 'ph.region_id') {
  if (req.adminRole === 'kam_regional' && req.adminRegionId) {
    return { clause: ` AND ${column} = ?`, params: [req.adminRegionId] };
  }
  return { clause: '', params: [] };
}

router.get('/dashboard', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const periode = currentPeriod();
  const kpis = await getKPIs(periode);
  const challengesActifs = await all('SELECT * FROM challenges WHERE actif = 1 ORDER BY periode_fin ASC');
  const demandesEnAttente = await get(`SELECT COUNT(*) AS n FROM echanges WHERE statut = 'demande'`);
  const ticketsEnAttente = await get(`SELECT COUNT(*) AS n FROM tickets WHERE statut = 'en_attente'`);

  res.render('admin/dashboard', {
    page: 'dashboard', admin, periode, periodeLabel: periodLabel(periode), kpis, challengesActifs,
    demandesEnAttente: demandesEnAttente.n, ticketsEnAttente: ticketsEnAttente.n,
  });
});

// --- Pharmacies ---
router.get('/pharmacies', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const { clause, params } = regionFilterClause(req);
  const pharmacies = await all(
    `SELECT ph.*, r.nom AS region_nom, (SELECT COUNT(*) FROM preparatrices p WHERE p.pharmacie_id = ph.id) AS nb_preparatrices
     FROM pharmacies ph LEFT JOIN regions r ON r.id = ph.region_id
     WHERE 1=1 ${clause} ORDER BY ph.nom`,
    params
  );
  const regions = await all('SELECT * FROM regions ORDER BY nom');
  res.render('admin/pharmacies', { page: 'pharmacies', admin, pharmacies, regions });
});

router.post('/pharmacies', requireAdminApi, requireWriteAccess, async (req, res) => {
  const { nom, adresse, region_id, groupement } = req.body;
  await run('INSERT INTO pharmacies (id, nom, adresse, region_id, groupement) VALUES (?, ?, ?, ?, ?)', [
    uuid(), nom, adresse || null, region_id || null, groupement || null,
  ]);
  res.redirect('/admin/pharmacies');
});

// --- Produits ---
router.get('/produits', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const produits = await all(
    `SELECT p.*, m.nom AS marque_nom, m.points_par_unite AS marque_points_defaut
     FROM produits p JOIN marques m ON m.id = p.marque_id
     ORDER BY m.nom, p.nom`
  );
  const marques = await all('SELECT * FROM marques ORDER BY nom');
  res.render('admin/produits', { page: 'produits', admin, produits, marques, importees: req.query.importees });
});

router.post('/produits', requireAdminApi, requireWriteAccess, async (req, res) => {
  const { nom, reference, marque_id, unite_vente, points_par_unite } = req.body;
  await run('INSERT INTO produits (id, nom, reference, marque_id, unite_vente, points_par_unite, actif) VALUES (?, ?, ?, ?, ?, ?, 1)', [
    uuid(), nom, reference, marque_id, unite_vente || 'unité',
    points_par_unite === '' || points_par_unite == null ? null : parseInt(points_par_unite, 10),
  ]);
  res.redirect('/admin/produits');
});

router.post('/produits/import', requireAdminApi, requireWriteAccess, upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.redirect('/admin/produits');
  const rows = parseCsv(req.file.buffer.toString('utf8'));
  let importees = 0;
  for (const row of rows) {
    const marque = await get('SELECT id FROM marques WHERE LOWER(nom) = LOWER(?)', [row.marque || '']);
    const reference = (row.reference || row.ref || '').trim();
    if (!marque || !reference) continue;
    const exists = await get('SELECT id FROM produits WHERE reference = ? AND marque_id = ?', [reference, marque.id]);
    if (exists) continue;
    const pointsRaw = row.points_par_unite || row.points || '';
    await run('INSERT INTO produits (id, nom, reference, marque_id, unite_vente, points_par_unite, actif) VALUES (?, ?, ?, ?, ?, ?, 1)', [
      uuid(), row.nom || row.designation || reference, reference, marque.id, row.unite_vente || row['unité_vente'] || 'unité',
      pointsRaw === '' ? null : parseInt(pointsRaw, 10),
    ]);
    importees++;
  }
  res.redirect(`/admin/produits?importees=${importees}`);
});

router.post('/produits/:id/toggle', requireAdminApi, requireWriteAccess, async (req, res) => {
  const produit = await get('SELECT actif FROM produits WHERE id = ?', [req.params.id]);
  if (!produit) return res.status(404).json({ error: 'Introuvable' });
  const nouveau = produit.actif ? 0 : 1;
  await run('UPDATE produits SET actif = ? WHERE id = ?', [nouveau, req.params.id]);
  res.json({ ok: true, actif: !!nouveau });
});

router.post('/produits/:id/points', requireAdminApi, requireWriteAccess, async (req, res) => {
  const { points_par_unite } = req.body;
  const valeur = points_par_unite === '' || points_par_unite == null ? null : parseInt(points_par_unite, 10);
  await run('UPDATE produits SET points_par_unite = ? WHERE id = ?', [valeur, req.params.id]);
  res.redirect('/admin/produits');
});

// --- Préparatrices ---
router.get('/preparatrices', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const { clause, params } = regionFilterClause(req);
  const preparatrices = await all(
    `SELECT p.*, ph.nom AS pharmacie_nom FROM preparatrices p
     JOIN pharmacies ph ON ph.id = p.pharmacie_id
     WHERE 1=1 ${clause} ORDER BY p.nom`,
    params
  );
  const pharmacies = await all('SELECT * FROM pharmacies ORDER BY nom');
  const identifiants = req.query.identifiants
    ? req.query.identifiants.split(',').map((s) => {
        const [email, motDePasse] = s.split(':');
        return { email, motDePasse };
      })
    : [];
  res.render('admin/preparatrices', {
    page: 'preparatrices', admin, preparatrices, pharmacies, importees: req.query.importees,
    nouveauEmail: req.query.nouveau_email, nouveauMdp: req.query.nouveau_mdp, identifiants,
  });
});

router.post('/preparatrices', requireAdminApi, requireWriteAccess, async (req, res) => {
  const { nom, prenom, email, telephone, pharmacie_id, date_entree } = req.body;
  const motDePasse = generatePassword();
  const passwordHash = await bcrypt.hash(motDePasse, 10);
  await run(
    `INSERT INTO preparatrices (id, nom, prenom, email, telephone, password_hash, pharmacie_id, statut, date_entree, doit_changer_mdp)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'actif', ?, 1)`,
    [uuid(), nom, prenom, (email || '').toLowerCase(), telephone || null, passwordHash, pharmacie_id, date_entree || null]
  );
  res.redirect(`/admin/preparatrices?nouveau_email=${encodeURIComponent((email || '').toLowerCase())}&nouveau_mdp=${encodeURIComponent(motDePasse)}`);
});

router.post('/preparatrices/import', requireAdminApi, requireWriteAccess, upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.redirect('/admin/preparatrices');
  const rows = parseCsv(req.file.buffer.toString('utf8'));
  const identifiants = [];
  for (const row of rows) {
    const email = (row.email || '').toLowerCase().trim();
    if (!email) continue;
    const exists = await get('SELECT id FROM preparatrices WHERE email = ?', [email]);
    if (exists) continue;
    const pharmacie = await get('SELECT id FROM pharmacies WHERE LOWER(nom) = LOWER(?)', [row.pharmacie || '']);
    if (!pharmacie) continue;
    const motDePasse = generatePassword();
    const passwordHash = await bcrypt.hash(motDePasse, 10);
    await run(
      `INSERT INTO preparatrices (id, nom, prenom, email, telephone, password_hash, pharmacie_id, statut, date_entree, doit_changer_mdp)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'actif', ?, 1)`,
      [uuid(), row.nom || '', row.prenom || '', email, row.telephone || null, passwordHash, pharmacie.id, row.date_entree || null]
    );
    identifiants.push(`${email}:${motDePasse}`);
  }
  res.redirect(`/admin/preparatrices?importees=${identifiants.length}&identifiants=${encodeURIComponent(identifiants.join(','))}`);
});

router.post('/preparatrices/:id/toggle', requireAdminApi, requireWriteAccess, async (req, res) => {
  const prep = await get('SELECT statut FROM preparatrices WHERE id = ?', [req.params.id]);
  if (!prep) return res.status(404).json({ error: 'Introuvable' });
  const nouveauStatut = prep.statut === 'actif' ? 'inactif' : 'actif';
  await run('UPDATE preparatrices SET statut = ? WHERE id = ?', [nouveauStatut, req.params.id]);
  res.json({ ok: true, statut: nouveauStatut });
});

// --- Ventes ---
router.get('/ventes', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const periode = req.query.periode || currentPeriod();
  const ventes = await all(
    `SELECT v.*, p.nom AS prep_nom, p.prenom AS prep_prenom, m.nom AS marque_nom, ph.nom AS pharmacie_nom
     FROM ventes v
     JOIN preparatrices p ON p.id = v.preparatrice_id
     JOIN marques m ON m.id = v.marque_id
     JOIN pharmacies ph ON ph.id = p.pharmacie_id
     WHERE v.periode = ? ORDER BY v.created_at DESC LIMIT 100`,
    [periode]
  );
  res.render('admin/ventes', { page: 'ventes', admin, ventes, periode, periodeLabel: periodLabel(periode), importees: req.query.importees });
});

router.post('/ventes/import', requireAdminApi, requireWriteAccess, upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.redirect('/admin/ventes');
  const rows = parseCsv(req.file.buffer.toString('utf8'));
  const periodesTouchees = new Set();
  const preparatricesTouchees = new Set();
  let importees = 0;

  for (const row of rows) {
    const email = (row.email || row.preparatrice || '').toLowerCase().trim();
    const preparatrice = await get('SELECT id FROM preparatrices WHERE email = ?', [email]);
    if (!preparatrice) continue;
    const marque = await get('SELECT id, points_par_unite FROM marques WHERE LOWER(nom) = LOWER(?)', [row.marque || '']);
    if (!marque) continue;
    const referenceProduit = (row.reference || row.ref || row.produit_reference || '').trim();
    const produit = referenceProduit
      ? await get('SELECT id FROM produits WHERE marque_id = ? AND reference = ?', [marque.id, referenceProduit])
      : await get('SELECT id FROM produits WHERE marque_id = ? LIMIT 1', [marque.id]);
    const quantite = parseInt(row.quantite || row.quantité || '0', 10);
    const periode = row.periode || row.période || currentPeriod();
    if (!quantite || quantite <= 0) continue;

    await run(
      `INSERT INTO ventes (id, preparatrice_id, produit_id, marque_id, quantite, periode, source, statut_validation)
       VALUES (?, ?, ?, ?, ?, ?, 'import', 'valide')`,
      [uuid(), preparatrice.id, produit ? produit.id : null, marque.id, quantite, periode]
    );
    importees++;
    periodesTouchees.add(periode);
    preparatricesTouchees.add(preparatrice.id + '|' + periode);
  }

  for (const key of preparatricesTouchees) {
    const [prepId, periode] = key.split('|');
    await recalculerPointsVentes(prepId, periode);
  }
  for (const periode of periodesTouchees) {
    await recalcParticipations(periode);
  }

  res.redirect(`/admin/ventes?importees=${importees}`);
});

// --- Objectifs ---
router.get('/objectifs', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const periode = req.query.periode || currentPeriod();
  const { clause, params } = regionFilterClause(req);

  const preparatrices = await all(
    `SELECT p.id, p.nom, p.prenom, ph.nom AS pharmacie_nom FROM preparatrices p
     JOIN pharmacies ph ON ph.id = p.pharmacie_id WHERE p.statut = 'actif' ${clause} ORDER BY p.nom`,
    params
  );

  const objectifs = [];
  for (const prep of preparatrices) {
    const objectif = await getOrCreateObjectif(prep.id, periode);
    const ventes = await get(
      `SELECT COALESCE(SUM(quantite),0) AS total FROM ventes WHERE preparatrice_id = ? AND periode = ? AND statut_validation='valide'`,
      [prep.id, periode]
    );
    objectifs.push({
      ...objectif,
      prep_nom: prep.nom, prep_prenom: prep.prenom, pharmacie_nom: prep.pharmacie_nom,
      cible: objectifEffectif(objectif), ventesRealisees: ventes.total,
    });
  }

  res.render('admin/objectifs', { page: 'objectifs', admin, objectifs, periode, periodeLabel: periodLabel(periode) });
});

router.post('/objectifs/:id/ajuster', requireAdminApi, requireWriteAccess, async (req, res) => {
  const { valeur, motif } = req.body;
  await run('UPDATE objectifs SET ajustement_manuel = ?, ajustement_motif = ? WHERE id = ?', [
    valeur === '' ? null : parseInt(valeur, 10), motif || null, req.params.id,
  ]);
  res.redirect('back');
});

// --- Challenges ---
router.get('/challenges', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const challenges = await all(
    `SELECT c.*, m.nom AS marque_nom FROM challenges c LEFT JOIN marques m ON m.id = c.marque_id ORDER BY c.periode_debut DESC`
  );
  const marques = await all('SELECT * FROM marques ORDER BY nom');
  res.render('admin/challenges', { page: 'challenges', admin, challenges, marques, periode: currentPeriod() });
});

router.post('/challenges', requireAdminApi, requireWriteAccess, async (req, res) => {
  const { nom, type, periode_debut, periode_fin, perimetre, marque_id, objectif_unites, regles_points, recompense_associee, points_bonus } = req.body;
  await run(
    `INSERT INTO challenges (id, nom, type, periode_debut, periode_fin, perimetre, marque_id, objectif_unites, regles_points, recompense_associee, points_bonus, actif)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [uuid(), nom, type, periode_debut, periode_fin, perimetre || 'national',
      type === 'marque' || type === 'mission' || type === 'defi' ? (marque_id || null) : null,
      objectif_unites ? parseInt(objectif_unites, 10) : null, regles_points || null, recompense_associee || null,
      points_bonus ? parseInt(points_bonus, 10) : null]
  );
  await recalcParticipations(currentPeriod());
  res.redirect('/admin/challenges');
});

router.post('/challenges/:id/toggle', requireAdminApi, requireWriteAccess, async (req, res) => {
  const challenge = await get('SELECT actif FROM challenges WHERE id = ?', [req.params.id]);
  if (!challenge) return res.status(404).json({ error: 'Introuvable' });
  const nouveau = challenge.actif ? 0 : 1;
  await run('UPDATE challenges SET actif = ? WHERE id = ?', [nouveau, req.params.id]);
  res.json({ ok: true, actif: !!nouveau });
});

// --- Récompenses & échanges ---
router.get('/recompenses', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const catalogue = await all('SELECT * FROM recompenses ORDER BY cout_points ASC');
  const echanges = await all(
    `SELECT e.*, p.nom AS prep_nom, p.prenom AS prep_prenom, r.nom AS recompense_nom, r.cout_points
     FROM echanges e JOIN preparatrices p ON p.id = e.preparatrice_id JOIN recompenses r ON r.id = e.recompense_id
     ORDER BY e.date DESC LIMIT 100`
  );
  res.render('admin/recompenses', { page: 'recompenses', admin, catalogue, echanges });
});

router.post('/recompenses', requireAdminApi, requireWriteAccess, async (req, res) => {
  const { nom, categorie, cout_points, stock, condition_eligibilite } = req.body;
  await run(
    `INSERT INTO recompenses (id, nom, categorie, cout_points, stock, condition_eligibilite, actif) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [uuid(), nom, categorie, parseInt(cout_points, 10), parseInt(stock, 10) || 0, condition_eligibilite || null]
  );
  res.redirect('/admin/recompenses');
});

router.post('/echanges/:id/valider', requireAdminApi, requireWriteAccess, async (req, res) => {
  await run(`UPDATE echanges SET statut = 'valide' WHERE id = ? AND statut = 'demande'`, [req.params.id]);
  res.redirect('/admin/recompenses');
});

router.post('/echanges/:id/livrer', requireAdminApi, requireWriteAccess, async (req, res) => {
  await run(`UPDATE echanges SET statut = 'livre' WHERE id = ?`, [req.params.id]);
  res.redirect('/admin/recompenses');
});

router.post('/echanges/:id/refuser', requireAdminApi, requireWriteAccess, async (req, res) => {
  const echange = await get('SELECT * FROM echanges WHERE id = ?', [req.params.id]);
  if (echange && echange.statut !== 'refuse') {
    await run(`UPDATE echanges SET statut = 'refuse', motif_refus = ? WHERE id = ?`, [req.body.motif || 'Rupture de stock', req.params.id]);
    await run('UPDATE recompenses SET stock = stock + 1 WHERE id = ?', [echange.recompense_id]);
  }
  res.redirect('/admin/recompenses');
});

// --- Tickets de caisse scannés (ventes déclaratives à valider avant qu'elles ne comptent) ---
router.get('/tickets', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const tickets = await all(
    `SELECT t.*, p.nom AS prep_nom, p.prenom AS prep_prenom, ph.nom AS pharmacie_nom
     FROM tickets t
     JOIN preparatrices p ON p.id = t.preparatrice_id
     JOIN pharmacies ph ON ph.id = p.pharmacie_id
     ORDER BY (t.statut = 'en_attente') DESC, t.created_at DESC LIMIT 60`
  );
  for (const ticket of tickets) {
    ticket.lignes = await all(
      `SELECT v.quantite, m.nom AS marque_nom FROM ventes v JOIN marques m ON m.id = v.marque_id WHERE v.ticket_id = ?`,
      [ticket.id]
    );
  }
  res.render('admin/tickets', { page: 'tickets', admin, tickets });
});

router.post('/tickets/:id/valider', requireAdminApi, requireWriteAccess, async (req, res) => {
  const ticket = await get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!ticket || ticket.statut !== 'en_attente') return res.redirect('/admin/tickets');

  await run(`UPDATE ventes SET statut_validation = 'valide' WHERE ticket_id = ?`, [ticket.id]);
  await run(`UPDATE tickets SET statut = 'valide' WHERE id = ?`, [ticket.id]);
  await recalculerPointsVentes(ticket.preparatrice_id, ticket.periode);
  await recalcParticipations(ticket.periode);
  res.redirect('/admin/tickets');
});

router.post('/tickets/:id/rejeter', requireAdminApi, requireWriteAccess, async (req, res) => {
  const ticket = await get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!ticket || ticket.statut !== 'en_attente') return res.redirect('/admin/tickets');

  await run(`DELETE FROM ventes WHERE ticket_id = ?`, [ticket.id]);
  await run(`UPDATE tickets SET statut = 'rejete', motif_rejet = ? WHERE id = ?`, [req.body.motif || 'Ticket illisible ou non conforme', ticket.id]);
  res.redirect('/admin/tickets');
});

// --- Reporting ---
router.get('/reporting', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const periode = req.query.periode || currentPeriod();
  const kpis = await getKPIs(periode);

  const parMarque = await all(
    `SELECT m.nom, m.points_par_unite, COALESCE(SUM(v.quantite), 0) AS volume
     FROM marques m LEFT JOIN ventes v ON v.marque_id = m.id AND v.periode = ? AND v.statut_validation = 'valide'
     GROUP BY m.id ORDER BY volume DESC`,
    [periode]
  );
  const parRegion = await all(
    `SELECT r.nom, COALESCE(SUM(v.quantite), 0) AS volume
     FROM regions r
     LEFT JOIN pharmacies ph ON ph.region_id = r.id
     LEFT JOIN preparatrices p ON p.pharmacie_id = ph.id
     LEFT JOIN ventes v ON v.preparatrice_id = p.id AND v.periode = ? AND v.statut_validation = 'valide'
     GROUP BY r.id ORDER BY volume DESC`,
    [periode]
  );
  const maxVolumeMarque = Math.max(1, ...parMarque.map((m) => m.volume));
  const maxVolumeRegion = Math.max(1, ...parRegion.map((r) => r.volume));

  res.render('admin/reporting', {
    page: 'reporting', admin, periode, periodeLabel: periodLabel(periode), kpis,
    parMarque, parRegion, maxVolumeMarque, maxVolumeRegion,
  });
});

module.exports = router;
