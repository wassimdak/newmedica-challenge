const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { all, get, run } = require('./dbHelpers');
const { currentPeriod, previousYearPeriod, getOrCreateObjectif, recalculerPointsVentes } = require('./calculations');

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Seed une participation à un challenge marque/mission/défi et, si l'objectif est déjà atteint,
// crédite immédiatement son bonus de points — pour que les données de démo soient cohérentes
// avec le comportement de recalcParticipations() (cf. correctif BIZ-1).
async function seedParticipation(challengeId, preparatriceId, progression, objectifUnites, pointsBonus, nomChallenge, periode) {
  const reussi = progression >= objectifUnites;
  await run(
    `INSERT INTO participations (id, challenge_id, preparatrice_id, progression, statut, points_credites) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), challengeId, preparatriceId, progression, reussi ? 'reussi' : 'en_cours', reussi ? 1 : 0]
  );
  if (reussi && pointsBonus > 0) {
    await run(
      `INSERT INTO scores (id, preparatrice_id, montant, motif, periode) VALUES (?, ?, ?, ?, ?)`,
      [uuid(), preparatriceId, pointsBonus, `Challenge réussi : ${nomChallenge}`, periode]
    );
  }
}

async function seedIfEmpty() {
  const existing = await get('SELECT COUNT(*) AS n FROM preparatrices');
  if (existing.n > 0) return;

  console.log('Base de données vide : génération du jeu de données de démonstration NewMedica Challenge…');

  const periodeCourante = currentPeriod();
  const periodeN1 = previousYearPeriod(periodeCourante);

  // --- Régions ---
  const regions = [
    { id: uuid(), nom: 'Grand Tunis / Nord', kam: 'Sami Ben Amor' },
    { id: uuid(), nom: 'Centre / Sahel', kam: 'Amina Trabelsi' },
    { id: uuid(), nom: 'Sud', kam: 'Karim Gharbi' },
  ];
  for (const r of regions) {
    await run('INSERT INTO regions (id, nom, kam_responsable) VALUES (?, ?, ?)', [r.id, r.nom, r.kam]);
  }

  // --- Pharmacies ---
  const pharmaciesData = [
    { nom: 'Pharmacie Centrale El Menzah', adresse: 'Av. Habib Bourguiba, Tunis', region: 0 },
    { nom: 'Pharmacie Les Berges du Lac', adresse: 'Les Berges du Lac 2, Tunis', region: 0 },
    { nom: 'Pharmacie Ibn Khaldoun', adresse: 'Av. Léopold Sédar Senghor, Sousse', region: 1 },
    { nom: 'Pharmacie El Ons', adresse: 'Route de Moknine, Monastir', region: 1 },
    { nom: 'Pharmacie Essaada', adresse: 'Av. Habib Bourguiba, Sfax', region: 2 },
    { nom: 'Pharmacie El Amen', adresse: 'Av. Farhat Hached, Gabès', region: 2 },
  ];
  const pharmacies = [];
  for (const p of pharmaciesData) {
    const id = uuid();
    await run('INSERT INTO pharmacies (id, nom, adresse, region_id, groupement) VALUES (?, ?, ?, ?, ?)', [
      id, p.nom, p.adresse, regions[p.region].id, null,
    ]);
    pharmacies.push({ id, ...p });
  }

  // --- Marques ---
  const marquesData = [
    { nom: 'Sensilis', points: 1 },
    { nom: 'BABÉ', points: 2 },
    { nom: 'Cumlaude Lab', points: 1 },
    { nom: 'Good Health', points: 1 },
    { nom: 'Rilastil', points: 1 },
  ];
  const marques = [];
  for (const m of marquesData) {
    const id = uuid();
    await run('INSERT INTO marques (id, nom, logo, points_par_unite) VALUES (?, ?, ?, ?)', [id, m.nom, null, m.points]);
    marques.push({ id, ...m });
  }

  // --- Produits ---
  const produits = [];
  for (const marque of marques) {
    for (let i = 1; i <= 3; i++) {
      const id = uuid();
      const ref = `${marque.nom.replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3).toUpperCase()}-${String(i).padStart(3, '0')}`;
      await run('INSERT INTO produits (id, nom, reference, marque_id, unite_vente) VALUES (?, ?, ?, ?, ?)', [id, `${marque.nom} — Produit ${i}`, ref, marque.id, 'unité']);
      produits.push({ id, marque_id: marque.id });
    }
  }

  // --- Préparatrices ---
  const noms = [
    ['Amel', 'Jaziri'], ['Sarra', 'Mansour'], ['Rania', 'Belhaj'], ['Nesrine', 'Chaabane'],
    ['Ines', 'Gharsalli'], ['Mariem', 'Ferjani'], ['Yosra', 'Bouzid'], ['Emna', 'Kort'],
    ['Sabrine', 'Toumi'], ['Hana', 'Slimani'], ['Wafa', 'Ayari'], ['Dorra', 'Cherif'],
  ];
  const passwordHash = await bcrypt.hash('newmedica123', 10);
  const preparatrices = [];
  for (let i = 0; i < noms.length; i++) {
    const [prenom, nom] = noms[i];
    const pharmacie = pharmacies[i % pharmacies.length];
    const id = uuid();
    const email = `${prenom}.${nom}@newmedica-app.tn`.toLowerCase();
    await run(
      `INSERT INTO preparatrices (id, nom, prenom, email, telephone, password_hash, pharmacie_id, statut, date_entree, doit_changer_mdp)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'actif', ?, 0)`,
      [id, nom, prenom, email, `+216 ${rand(20, 55)} ${rand(100, 999)} ${rand(100, 999)}`, passwordHash, pharmacie.id, `202${rand(1, 4)}-0${rand(1, 9)}-01`]
    );
    preparatrices.push({ id, nom, prenom, email, pharmacie_id: pharmacie.id });
  }

  // --- Ventes N-1 (référence de croissance) ---
  for (const prep of preparatrices) {
    for (const marque of marques) {
      const produitsMarque = produits.filter((p) => p.marque_id === marque.id);
      const produit = produitsMarque[rand(0, produitsMarque.length - 1)];
      const qte = rand(8, 30);
      await run(
        `INSERT INTO ventes (id, preparatrice_id, produit_id, marque_id, quantite, periode, source, statut_validation)
         VALUES (?, ?, ?, ?, ?, ?, 'import', 'valide')`,
        [uuid(), prep.id, produit.id, marque.id, qte, periodeN1]
      );
    }
  }

  // --- Objectifs de la période courante (calculés depuis N-1 x taux) ---
  for (const prep of preparatrices) {
    await getOrCreateObjectif(prep.id, periodeCourante, 0.2);
  }

  // --- Ventes courantes (mois en cours) : profils variés (avance / retard) ---
  for (const prep of preparatrices) {
    const objectif = await get('SELECT * FROM objectifs WHERE preparatrice_id = ? AND periode = ?', [prep.id, periodeCourante]);
    const facteur = [0.55, 0.75, 0.9, 1.05, 1.2][rand(0, 4)] / marques.length;
    for (const marque of marques) {
      const produitsMarque = produits.filter((p) => p.marque_id === marque.id);
      const produit = produitsMarque[rand(0, produitsMarque.length - 1)];
      const qte = Math.max(0, Math.round(objectif.objectif_calcule * facteur * (0.8 + Math.random() * 0.4)));
      if (qte > 0) {
        await run(
          `INSERT INTO ventes (id, preparatrice_id, produit_id, marque_id, quantite, periode, source, statut_validation)
           VALUES (?, ?, ?, ?, ?, ?, 'import', 'valide')`,
          [uuid(), prep.id, produit.id, marque.id, qte, periodeCourante]
        );
      }
    }
    await recalculerPointsVentes(prep.id, periodeCourante);
  }

  // --- Challenges ---
  const babeId = marques.find((m) => m.nom === 'BABÉ').id;
  const cumlaudeId = marques.find((m) => m.nom === 'Cumlaude Lab').id;
  const rilastilId = marques.find((m) => m.nom === 'Rilastil').id;

  const debutMois = `${periodeCourante}-01`;
  const finMois = `${periodeCourante}-30`;

  const challengePrincipal = uuid();
  await run(
    `INSERT INTO challenges (id, nom, type, periode_debut, periode_fin, perimetre, marque_id, objectif_unites, regles_points, recompense_associee, actif)
     VALUES (?, ?, 'principal', ?, ?, 'national', NULL, NULL, ?, ?, 1)`,
    [challengePrincipal, `Challenge NewMedica ${periodeCourante}`, debutMois, finMois,
      '1 point par unité vendue (toutes marques), +50 pts à 100% de l\'objectif, +20 pts par tranche de 10% de dépassement.',
      'Points échangeables contre le catalogue de récompenses']
  );

  const challengeBabe = uuid();
  await run(
    `INSERT INTO challenges (id, nom, type, periode_debut, periode_fin, perimetre, marque_id, objectif_unites, regles_points, recompense_associee, points_bonus, actif)
     VALUES (?, ?, 'marque', ?, ?, 'national', ?, 40, ?, ?, 100, 1)`,
    [challengeBabe, 'Challenge BABÉ — Vendez plus, gagnez plus', debutMois, finMois, babeId,
      '2 points par unité BABÉ vendue. Bonus de 100 points si l\'objectif de 40 unités est atteint.',
      'Coffret BABÉ Premium']
  );

  const challengeMission = uuid();
  await run(
    `INSERT INTO challenges (id, nom, type, periode_debut, periode_fin, perimetre, marque_id, objectif_unites, regles_points, recompense_associee, points_bonus, actif)
     VALUES (?, ?, 'mission', ?, ?, 'national', ?, 10, ?, ?, 30, 1)`,
    [challengeMission, 'Sprint de la semaine — Cumlaude Lab', debutMois, `${periodeCourante}-07`, cumlaudeId,
      '30 points bonus si 10 unités Cumlaude Lab vendues avant la fin de la semaine.',
      '30 points bonus']
  );

  const challengeDefi = uuid();
  await run(
    `INSERT INTO challenges (id, nom, type, periode_debut, periode_fin, perimetre, marque_id, objectif_unites, regles_points, recompense_associee, points_bonus, actif)
     VALUES (?, ?, 'defi', ?, ?, 'national', ?, 15, ?, ?, 45, 1)`,
    [challengeDefi, 'Lancement Rilastil Sun', debutMois, finMois, rilastilId,
      '45 points bonus si l\'objectif de 15 unités Rilastil Sun est atteint pendant le lancement.',
      'Trousse de soins Rilastil']
  );

  for (const prep of preparatrices) {
    const progressionPrincipale = await get(
      `SELECT COALESCE(SUM(quantite),0) AS total FROM ventes WHERE preparatrice_id = ? AND periode = ? AND statut_validation = 'valide'`,
      [prep.id, periodeCourante]
    );
    await run(
      `INSERT INTO participations (id, challenge_id, preparatrice_id, progression, statut) VALUES (?, ?, ?, ?, ?)`,
      [uuid(), challengePrincipal, prep.id, progressionPrincipale.total, 'en_cours']
    );

    const progressionBabe = await get(
      `SELECT COALESCE(SUM(quantite),0) AS total FROM ventes WHERE preparatrice_id = ? AND periode = ? AND marque_id = ? AND statut_validation = 'valide'`,
      [prep.id, periodeCourante, babeId]
    );
    await seedParticipation(challengeBabe, prep.id, progressionBabe.total, 40, 100, 'Challenge BABÉ — Vendez plus, gagnez plus', periodeCourante);

    const progressionMission = Math.min(10, rand(0, 12));
    await seedParticipation(challengeMission, prep.id, progressionMission, 10, 30, 'Sprint de la semaine — Cumlaude Lab', periodeCourante);

    const progressionDefi = rand(0, 18);
    await seedParticipation(challengeDefi, prep.id, progressionDefi, 15, 45, 'Lancement Rilastil Sun', periodeCourante);
  }

  // --- Récompenses ---
  const recompensesData = [
    { nom: 'Cadeau surprise NewMedica', categorie: 'cadeau', cout: 100, stock: 100 },
    { nom: 'Bon d\'achat 50 DT', categorie: 'bon_achat', cout: 200, stock: 50 },
    { nom: 'Trousse de soins Sensilis', categorie: 'produit', cout: 350, stock: 20 },
    { nom: 'Coffret BABÉ Premium', categorie: 'produit', cout: 500, stock: 15 },
    { nom: 'Formation certifiante dermo-cosmétique', categorie: 'formation', cout: 800, stock: 10 },
    { nom: 'Séminaire NewMedica annuel (2 places)', categorie: 'evenement', cout: 1500, stock: 5 },
  ];
  const recompenses = [];
  for (const r of recompensesData) {
    const id = uuid();
    await run(
      `INSERT INTO recompenses (id, nom, categorie, cout_points, stock, condition_eligibilite, actif) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, r.nom, r.categorie, r.cout, r.stock, null]
    );
    recompenses.push({ id, ...r });
  }

  // --- Badges ---
  const badgesData = [
    { nom: 'Bienvenue', regle: 'Activation du compte', points: 10 },
    { nom: '3 mois d\'objectif atteint', regle: 'Objectif mensuel atteint 3 mois consécutifs', points: 100 },
    { nom: 'Ambassadrice BABÉ', regle: 'Challenge BABÉ réussi', points: 80 },
    { nom: 'Top 10 national', regle: 'Classement national dans le top 10', points: 150 },
  ];
  const badges = [];
  for (const b of badgesData) {
    const id = uuid();
    await run('INSERT INTO badges (id, nom, regle_obtention, points_associes) VALUES (?, ?, ?, ?)', [id, b.nom, b.regle, b.points]);
    badges.push({ id, ...b });
  }
  const badgeBienvenue = badges.find((b) => b.nom === 'Bienvenue');
  const badgeBabe = badges.find((b) => b.nom === 'Ambassadrice BABÉ');

  for (const prep of preparatrices) {
    await run('INSERT OR IGNORE INTO obtentions (id, badge_id, preparatrice_id) VALUES (?, ?, ?)', [uuid(), badgeBienvenue.id, prep.id]);
    await run(
      `INSERT INTO scores (id, preparatrice_id, montant, motif, periode) VALUES (?, ?, ?, ?, ?)`,
      [uuid(), prep.id, badgeBienvenue.points, 'Badge : Bienvenue', periodeCourante]
    );
  }

  const participationsBabeReussies = await all(
    `SELECT preparatrice_id FROM participations WHERE challenge_id = ? AND statut = 'reussi'`,
    [challengeBabe]
  );
  for (const p of participationsBabeReussies) {
    await run('INSERT OR IGNORE INTO obtentions (id, badge_id, preparatrice_id) VALUES (?, ?, ?)', [uuid(), badgeBabe.id, p.preparatrice_id]);
    await run(
      `INSERT INTO scores (id, preparatrice_id, montant, motif, periode) VALUES (?, ?, ?, ?, ?)`,
      [uuid(), p.preparatrice_id, badgeBabe.points, 'Badge : Ambassadrice BABÉ', periodeCourante]
    );
  }

  // --- Échanges de démonstration ---
  const bonAchat = recompenses.find((r) => r.nom.includes('Bon d\'achat'));
  const cadeauSurprise = recompenses.find((r) => r.nom.includes('Cadeau surprise'));
  if (preparatrices[0]) {
    await run(
      `INSERT INTO echanges (id, preparatrice_id, recompense_id, statut) VALUES (?, ?, ?, 'livre')`,
      [uuid(), preparatrices[0].id, cadeauSurprise.id]
    );
  }
  if (preparatrices[1]) {
    await run(
      `INSERT INTO echanges (id, preparatrice_id, recompense_id, statut) VALUES (?, ?, ?, 'demande')`,
      [uuid(), preparatrices[1].id, bonAchat.id]
    );
  }

  // --- Notifications ---
  for (const prep of preparatrices) {
    await run(
      `INSERT INTO notifications (id, preparatrice_id, titre, message) VALUES (?, ?, ?, ?)`,
      [uuid(), prep.id, 'Bienvenue sur NewMedica Challenge !', 'Ton objectif du mois est prêt. Consulte ton tableau de bord pour démarrer.']
    );
    await run(
      `INSERT INTO notifications (id, preparatrice_id, titre, message) VALUES (?, ?, ?, ?)`,
      [uuid(), prep.id, 'Nouveau challenge disponible', 'Le Challenge BABÉ — Vendez plus, gagnez plus vient de démarrer.']
    );
  }

  // --- Utilisateurs back-office ---
  // Le compte Super Admin est géré séparément par syncAdminCredentials() (appelée à chaque
  // démarrage, pas seulement au seed initial) afin qu'un changement d'ADMIN_EMAIL/ADMIN_PASSWORD
  // fasse office de réinitialisation de mot de passe.
  await run(
    `INSERT INTO backoffice_users (id, nom, email, password_hash, role, region_id) VALUES (?, ?, ?, ?, 'kam_regional', ?)`,
    [uuid(), 'Sami Ben Amor', 'kam.nord@newmedica.tn', await bcrypt.hash('kam123', 10), regions[0].id]
  );
  await run(
    `INSERT INTO backoffice_users (id, nom, email, password_hash, role, region_id) VALUES (?, ?, ?, ?, 'marque_lecture', NULL)`,
    [uuid(), 'BABÉ Laboratorios', 'marque.babe@newmedica.tn', await bcrypt.hash('lecture123', 10)]
  );

  console.log('Jeu de données de démonstration généré : 12 préparatrices, 6 pharmacies, 5 marques, 4 challenges.');
  console.log(`Connexion préparatrice (démo) : ${preparatrices[0].email} / newmedica123`);
}

// Le compte Super Admin est resynchronisé sur ADMIN_EMAIL/ADMIN_PASSWORD à *chaque* démarrage
// (pas seulement au premier) : changer ces variables d'environnement fait donc office de
// réinitialisation de mot de passe, même après le seed initial.
async function syncAdminCredentials() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@newmedica.tn').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const existing = await get(`SELECT id FROM backoffice_users WHERE role = 'super_admin' ORDER BY rowid ASC LIMIT 1`);
  if (existing) {
    await run(`UPDATE backoffice_users SET email = ?, password_hash = ? WHERE id = ?`, [adminEmail, passwordHash, existing.id]);
  } else {
    await run(
      `INSERT INTO backoffice_users (id, nom, email, password_hash, role, region_id) VALUES (?, ?, ?, ?, 'super_admin', NULL)`,
      [uuid(), 'Administrateur NewMedica', adminEmail, passwordHash]
    );
  }

  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.warn(
      `⚠️  ADMIN_EMAIL / ADMIN_PASSWORD non définis : identifiants par défaut utilisés (${adminEmail} / ${adminPassword}). ` +
      'Définissez ces variables d\'environnement en production.'
    );
  } else {
    console.log(`Identifiants Super Admin synchronisés : ${adminEmail}`);
  }
}

module.exports = { seedIfEmpty, syncAdminCredentials };
