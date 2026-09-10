const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const { v4: uuid } = require('uuid');
const { all, get, run } = require('../lib/dbHelpers');
const { parseCsv } = require('../lib/csv');
const { requireAdminPage, requireAdminApi, requireWriteAccess, generatePassword, createSession } = require('../lib/auth');
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

// Génère un fichier .xlsx à partir d'une ou plusieurs feuilles ([{ nom, rows }]) et l'envoie en téléchargement.
function sendXlsxSheets(res, filename, sheets) {
  const workbook = XLSX.utils.book_new();
  for (const { nom, rows } of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), nom);
  }
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

function sendXlsx(res, filename, sheetName, rows) {
  sendXlsxSheets(res, filename, [{ nom: sheetName, rows }]);
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
  const id = uuid();
  await run('INSERT INTO pharmacies (id, nom, adresse, region_id, groupement) VALUES (?, ?, ?, ?, ?)', [
    id, nom, adresse || null, region_id || null, groupement || null,
  ]);
  // Ajout rapide depuis le formulaire "Ajouter une préparatrice" (JS fetch) : renvoie du JSON au
  // lieu de rediriger, pour ne pas perdre le reste du formulaire en cours de saisie.
  if (req.get('X-Requested-With') === 'fetch') {
    return res.json({ ok: true, id, nom });
  }
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
  const regions = await all('SELECT * FROM regions ORDER BY nom');
  const identifiants = req.query.identifiants
    ? req.query.identifiants.split(',').map((s) => {
        const [email, motDePasse] = s.split(':');
        return { email, motDePasse };
      })
    : [];
  res.render('admin/preparatrices', {
    page: 'preparatrices', admin, preparatrices, pharmacies, regions, importees: req.query.importees,
    nouveauEmail: req.query.nouveau_email, nouveauMdp: req.query.nouveau_mdp, identifiants,
  });
});

router.get('/export/preparatrices', requireAdminPage, async (req, res) => {
  const { clause, params } = regionFilterClause(req);
  const preparatrices = await all(
    `SELECT p.nom, p.prenom, p.email, p.telephone, ph.nom AS pharmacie, r.nom AS region,
            p.statut, p.date_entree, p.created_at
     FROM preparatrices p
     JOIN pharmacies ph ON ph.id = p.pharmacie_id
     LEFT JOIN regions r ON r.id = ph.region_id
     WHERE 1=1 ${clause} ORDER BY p.nom`,
    params
  );
  const rows = preparatrices.map((p) => ({
    Nom: p.nom, Prénom: p.prenom, Téléphone: p.telephone, Email: p.email || '',
    Pharmacie: p.pharmacie, Région: p.region || '', Statut: p.statut,
    "Date d'entrée": p.date_entree || '', 'Créé le': p.created_at,
  }));
  sendXlsx(res, `preparatrices-${currentPeriod()}.xlsx`, 'Préparatrices', rows);
});

async function renderPreparatricesAvecErreur(req, res, erreur) {
  const admin = await loadAdmin(req);
  const { clause, params } = regionFilterClause(req);
  const preparatrices = await all(
    `SELECT p.*, ph.nom AS pharmacie_nom FROM preparatrices p
     JOIN pharmacies ph ON ph.id = p.pharmacie_id
     WHERE 1=1 ${clause} ORDER BY p.nom`,
    params
  );
  const pharmacies = await all('SELECT * FROM pharmacies ORDER BY nom');
  const regions = await all('SELECT * FROM regions ORDER BY nom');
  res.render('admin/preparatrices', { page: 'preparatrices', admin, preparatrices, pharmacies, regions, importees: undefined, identifiants: [], erreurCreation: erreur });
}

router.post('/preparatrices', requireAdminApi, requireWriteAccess, async (req, res) => {
  const { nom, prenom, email, telephone, pharmacie_id, date_entree } = req.body;
  const telephoneNormalise = (telephone || '').trim();
  // L'email reste un identifiant de connexion possible mais n'est plus obligatoire à la création —
  // le téléphone (obligatoire) sert d'identifiant de repli pour les préparatrices sans email.
  const emailNormalise = (email || '').trim().toLowerCase() || null;

  if (!nom || !prenom || !telephoneNormalise) {
    return renderPreparatricesAvecErreur(req, res, 'Prénom, nom et téléphone sont requis.');
  }
  const pharmacie = await get('SELECT id FROM pharmacies WHERE id = ?', [pharmacie_id || '']);
  if (!pharmacie) {
    return renderPreparatricesAvecErreur(req, res, "Pharmacie invalide : sélectionnez-en une dans la liste (cliquez sur un résultat de recherche), ou créez-la via « + Nouvelle pharmacie ».");
  }
  const telephoneExiste = await get('SELECT id FROM preparatrices WHERE telephone = ?', [telephoneNormalise]);
  if (telephoneExiste) {
    return renderPreparatricesAvecErreur(req, res, `Une préparatrice existe déjà avec le téléphone ${telephoneNormalise}.`);
  }
  if (emailNormalise) {
    const emailExiste = await get('SELECT id FROM preparatrices WHERE email = ?', [emailNormalise]);
    if (emailExiste) {
      return renderPreparatricesAvecErreur(req, res, `Une préparatrice existe déjà avec l'email ${emailNormalise}.`);
    }
  }

  const motDePasse = generatePassword();
  const passwordHash = await bcrypt.hash(motDePasse, 10);
  await run(
    `INSERT INTO preparatrices (id, nom, prenom, email, telephone, password_hash, pharmacie_id, statut, date_entree, doit_changer_mdp)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'actif', ?, 1)`,
    [uuid(), nom, prenom, emailNormalise, telephoneNormalise, passwordHash, pharmacie.id, date_entree || null]
  );
  res.redirect(`/admin/preparatrices?nouveau_email=${encodeURIComponent(emailNormalise || telephoneNormalise)}&nouveau_mdp=${encodeURIComponent(motDePasse)}`);
});

router.post('/preparatrices/import', requireAdminApi, requireWriteAccess, upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.redirect('/admin/preparatrices');
  const rows = parseCsv(req.file.buffer.toString('utf8'));
  const identifiants = [];
  for (const row of rows) {
    const telephone = (row.telephone || '').trim();
    if (!telephone) continue;
    const email = (row.email || '').toLowerCase().trim() || null;
    const telephoneExiste = await get('SELECT id FROM preparatrices WHERE telephone = ?', [telephone]);
    if (telephoneExiste) continue;
    if (email) {
      const emailExiste = await get('SELECT id FROM preparatrices WHERE email = ?', [email]);
      if (emailExiste) continue;
    }
    const pharmacie = await get('SELECT id FROM pharmacies WHERE LOWER(nom) = LOWER(?)', [row.pharmacie || '']);
    if (!pharmacie) continue;
    const motDePasse = generatePassword();
    const passwordHash = await bcrypt.hash(motDePasse, 10);
    await run(
      `INSERT INTO preparatrices (id, nom, prenom, email, telephone, password_hash, pharmacie_id, statut, date_entree, doit_changer_mdp)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'actif', ?, 1)`,
      [uuid(), row.nom || '', row.prenom || '', email, telephone, passwordHash, pharmacie.id, row.date_entree || null]
    );
    identifiants.push(`${email || telephone}:${motDePasse}`);
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

// Génère un nouveau mot de passe aléatoire pour une préparatrice qui a perdu le sien (il n'est
// jamais récupérable en clair depuis SEC-1) et la force à en choisir un nouveau à sa prochaine
// connexion.
router.post('/preparatrices/:id/reset-mdp', requireAdminApi, requireWriteAccess, async (req, res) => {
  const prep = await get('SELECT email, telephone FROM preparatrices WHERE id = ?', [req.params.id]);
  if (!prep) return res.status(404).json({ error: 'Introuvable' });
  const motDePasse = generatePassword();
  const passwordHash = await bcrypt.hash(motDePasse, 10);
  await run('UPDATE preparatrices SET password_hash = ?, doit_changer_mdp = 1 WHERE id = ?', [passwordHash, req.params.id]);
  res.redirect(`/admin/preparatrices?nouveau_email=${encodeURIComponent(prep.email || prep.telephone)}&nouveau_mdp=${encodeURIComponent(motDePasse)}`);
});

// Ouvre l'app préparatrices comme si l'admin s'était connecté(e) avec ce compte, sans en
// connaître le mot de passe — pour tester ou dépanner. Ne touche pas à la session admin en
// cours : /quitter-visualisation permet d'y revenir.
router.post('/preparatrices/:id/impersonate', requireAdminApi, requireWriteAccess, async (req, res) => {
  const prep = await get('SELECT id, statut FROM preparatrices WHERE id = ?', [req.params.id]);
  if (!prep || prep.statut !== 'actif') return res.status(404).json({ error: 'Introuvable ou inactive' });
  const { token } = createSession(prep.id, 'preparatrice', null, req.adminUserId);
  res.cookie('nm_app', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax', secure: req.protocol === 'https' });
  res.redirect('/');
});

// --- Ventes ---
router.get('/ventes', requireAdminPage, async (req, res) => {
  const admin = await loadAdmin(req);
  const periode = req.query.periode || currentPeriod();
  const toutesPeriodes = req.query.toutes === '1';
  const groupeParProduit = req.query.vue === 'produit';

  let ventes = [];
  let parProduit = [];

  if (groupeParProduit) {
    const params = [];
    let where = "v.statut_validation = 'valide'";
    if (!toutesPeriodes) {
      where += ' AND v.periode = ?';
      params.push(periode);
    }
    parProduit = await all(
      `SELECT pr.nom AS produit_nom, pr.reference, m.nom AS marque_nom,
              SUM(v.quantite) AS volume,
              SUM(v.quantite * COALESCE(pr.points_par_unite, m.points_par_unite)) AS points_generes
       FROM ventes v
       JOIN produits pr ON pr.id = v.produit_id
       JOIN marques m ON m.id = v.marque_id
       WHERE ${where}
       GROUP BY v.produit_id ORDER BY volume DESC`,
      params
    );
  } else {
    const params = [];
    let where = '1=1';
    if (!toutesPeriodes) {
      where += ' AND v.periode = ?';
      params.push(periode);
    }
    ventes = await all(
      `SELECT v.*, p.nom AS prep_nom, p.prenom AS prep_prenom, m.nom AS marque_nom, ph.nom AS pharmacie_nom, pr.nom AS produit_nom
       FROM ventes v
       JOIN preparatrices p ON p.id = v.preparatrice_id
       JOIN marques m ON m.id = v.marque_id
       JOIN pharmacies ph ON ph.id = p.pharmacie_id
       LEFT JOIN produits pr ON pr.id = v.produit_id
       WHERE ${where} ORDER BY v.created_at DESC LIMIT 200`,
      params
    );
  }

  res.render('admin/ventes', {
    page: 'ventes', admin, ventes, parProduit, periode, periodeLabel: periodLabel(periode),
    importees: req.query.importees, groupeParProduit, toutesPeriodes,
  });
});

router.get('/export/ventes-produit', requireAdminPage, async (req, res) => {
  const periode = req.query.periode || currentPeriod();
  const toutesPeriodes = req.query.toutes === '1';
  const params = [];
  let where = "v.statut_validation = 'valide'";
  if (!toutesPeriodes) {
    where += ' AND v.periode = ?';
    params.push(periode);
  }
  const parProduit = await all(
    `SELECT pr.nom AS produit_nom, pr.reference, m.nom AS marque_nom,
            SUM(v.quantite) AS volume,
            SUM(v.quantite * COALESCE(pr.points_par_unite, m.points_par_unite)) AS points_generes
     FROM ventes v
     JOIN produits pr ON pr.id = v.produit_id
     JOIN marques m ON m.id = v.marque_id
     WHERE ${where}
     GROUP BY v.produit_id ORDER BY volume DESC`,
    params
  );
  const rows = parProduit.map((p) => ({
    Produit: p.produit_nom || '—', Référence: p.reference, Marque: p.marque_nom,
    'Quantité totale': p.volume, 'Points générés': p.points_generes,
  }));
  const suffixe = toutesPeriodes ? 'toutes-periodes' : periode;
  sendXlsx(res, `ventes-par-produit-${suffixe}.xlsx`, 'Ventes par produit', rows);
});

router.get('/export/ventes-marque', requireAdminPage, async (req, res) => {
  const periode = req.query.periode || currentPeriod();
  const toutesPeriodes = req.query.toutes === '1';
  const params = [];
  let where = "v.statut_validation = 'valide'";
  if (!toutesPeriodes) {
    where += ' AND v.periode = ?';
    params.push(periode);
  }
  const parMarque = await all(
    `SELECT m.nom AS marque_nom,
            SUM(v.quantite) AS volume,
            SUM(v.quantite * COALESCE(pr.points_par_unite, m.points_par_unite)) AS points_generes
     FROM ventes v
     JOIN marques m ON m.id = v.marque_id
     LEFT JOIN produits pr ON pr.id = v.produit_id
     WHERE ${where}
     GROUP BY v.marque_id ORDER BY volume DESC`,
    params
  );
  const rows = parMarque.map((m) => ({
    Marque: m.marque_nom, 'Quantité totale': m.volume, 'Points générés': m.points_generes,
  }));
  const suffixe = toutesPeriodes ? 'toutes-periodes' : periode;
  sendXlsx(res, `ventes-par-marque-${suffixe}.xlsx`, 'Ventes par marque', rows);
});

router.post('/ventes/import', requireAdminApi, requireWriteAccess, upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.redirect('/admin/ventes');
  const rows = parseCsv(req.file.buffer.toString('utf8'));
  const periodesTouchees = new Set();
  const preparatricesTouchees = new Set();
  let importees = 0;

  for (const row of rows) {
    const identifiant = (row.email || row.preparatrice || row.telephone || '').trim();
    const preparatrice = await get(
      'SELECT id FROM preparatrices WHERE LOWER(email) = LOWER(?) OR telephone = ?',
      [identifiant, identifiant]
    );
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

router.post('/challenges/:id', requireAdminApi, requireWriteAccess, async (req, res) => {
  const { nom, type, periode_debut, periode_fin, perimetre, marque_id, objectif_unites, regles_points, recompense_associee, points_bonus } = req.body;
  const challenge = await get('SELECT id FROM challenges WHERE id = ?', [req.params.id]);
  if (!challenge) return res.status(404).json({ error: 'Introuvable' });
  await run(
    `UPDATE challenges SET nom = ?, type = ?, periode_debut = ?, periode_fin = ?, perimetre = ?, marque_id = ?,
       objectif_unites = ?, regles_points = ?, recompense_associee = ?, points_bonus = ? WHERE id = ?`,
    [nom, type, periode_debut, periode_fin, perimetre || 'national',
      type === 'marque' || type === 'mission' || type === 'defi' ? (marque_id || null) : null,
      objectif_unites ? parseInt(objectif_unites, 10) : null, regles_points || null, recompense_associee || null,
      points_bonus ? parseInt(points_bonus, 10) : null, req.params.id]
  );
  await recalcParticipations(currentPeriod());
  res.redirect('/admin/challenges');
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
  const parPharmacie = await all(
    `SELECT ph.nom, COALESCE(SUM(v.quantite), 0) AS volume
     FROM pharmacies ph
     LEFT JOIN preparatrices p ON p.pharmacie_id = ph.id
     LEFT JOIN ventes v ON v.preparatrice_id = p.id AND v.periode = ? AND v.statut_validation = 'valide'
     GROUP BY ph.id ORDER BY volume DESC`,
    [periode]
  );
  const parProduit = await all(
    `SELECT p.nom AS produit_nom, p.reference, m.nom AS marque_nom, SUM(v.quantite) AS volume,
            SUM(v.quantite * COALESCE(p.points_par_unite, m.points_par_unite)) AS points_generes
     FROM ventes v
     JOIN produits p ON p.id = v.produit_id
     JOIN marques m ON m.id = v.marque_id
     WHERE v.periode = ? AND v.statut_validation = 'valide'
     GROUP BY v.produit_id ORDER BY volume DESC LIMIT 30`,
    [periode]
  );

  const maxVolumeMarque = Math.max(1, ...parMarque.map((m) => m.volume));
  const maxVolumeRegion = Math.max(1, ...parRegion.map((r) => r.volume));
  const maxVolumePharmacie = Math.max(1, ...parPharmacie.map((p) => p.volume));

  res.render('admin/reporting', {
    page: 'reporting', admin, periode, periodeLabel: periodLabel(periode), kpis,
    parMarque, parRegion, parPharmacie, parProduit, maxVolumeMarque, maxVolumeRegion, maxVolumePharmacie,
  });
});

router.get('/export/reporting', requireAdminPage, async (req, res) => {
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
  const parPharmacie = await all(
    `SELECT ph.nom, COALESCE(SUM(v.quantite), 0) AS volume
     FROM pharmacies ph
     LEFT JOIN preparatrices p ON p.pharmacie_id = ph.id
     LEFT JOIN ventes v ON v.preparatrice_id = p.id AND v.periode = ? AND v.statut_validation = 'valide'
     GROUP BY ph.id ORDER BY volume DESC`,
    [periode]
  );
  const parProduit = await all(
    `SELECT p.nom AS produit_nom, p.reference, m.nom AS marque_nom, SUM(v.quantite) AS volume,
            SUM(v.quantite * COALESCE(p.points_par_unite, m.points_par_unite)) AS points_generes
     FROM ventes v
     JOIN produits p ON p.id = v.produit_id
     JOIN marques m ON m.id = v.marque_id
     WHERE v.periode = ? AND v.statut_validation = 'valide'
     GROUP BY v.produit_id ORDER BY volume DESC`,
    [periode]
  );

  sendXlsxSheets(res, `reporting-${periode}.xlsx`, [
    {
      nom: 'KPIs',
      rows: [{
        Période: periodLabel(periode),
        "Taux d'engagement (%)": kpis.tauxEngagement,
        "Taux d'atteinte objectifs (%)": kpis.tauxAtteinte,
        'Volume de ventes': kpis.volumeVentes,
        'Volume ventes N-1': kpis.volumeVentesN1,
        'Croissance vs N-1 (%)': kpis.croissanceVentes,
        'Points distribués': kpis.pointsDistribues,
      }],
    },
    { nom: 'Par marque', rows: parMarque.map((m) => ({ Marque: m.nom, 'Points/unité': m.points_par_unite, 'Volume vendu': m.volume })) },
    { nom: 'Par région', rows: parRegion.map((r) => ({ Région: r.nom, 'Volume vendu': r.volume })) },
    { nom: 'Par pharmacie', rows: parPharmacie.map((p) => ({ Pharmacie: p.nom, 'Volume vendu': p.volume })) },
    { nom: 'Par produit', rows: parProduit.map((p) => ({ Produit: p.produit_nom || '—', Référence: p.reference, Marque: p.marque_nom, 'Volume vendu': p.volume, 'Points générés': p.points_generes })) },
  ]);
});

module.exports = router;
