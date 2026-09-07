const { all, get, run } = require('./dbHelpers');
const { v4: uuid } = require('uuid');

const MOIS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function currentPeriod(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function previousYearPeriod(periode) {
  const [y, m] = periode.split('-').map(Number);
  return `${y - 1}-${String(m).padStart(2, '0')}`;
}

function periodLabel(periode) {
  const [y, m] = periode.split('-').map(Number);
  return `${MOIS_FR[m - 1]} ${y}`;
}

// Objectif = Ventes N-1 (meme mois) x (1 + taux de croissance cible), arrondi
function computeObjectif(ventesN1, tauxCroissance) {
  return Math.round(ventesN1 * (1 + tauxCroissance));
}

async function getVentesRealisees(preparatriceId, periode, marqueId = null) {
  const params = [preparatriceId, periode];
  let sql = `SELECT COALESCE(SUM(quantite), 0) AS total FROM ventes
             WHERE preparatrice_id = ? AND periode = ? AND statut_validation = 'valide'`;
  if (marqueId) {
    sql += ' AND marque_id = ?';
    params.push(marqueId);
  }
  const row = await get(sql, params);
  return row.total;
}

async function getOrCreateObjectif(preparatriceId, periode, tauxCroissance = 0.2) {
  let objectif = await get(
    'SELECT * FROM objectifs WHERE preparatrice_id = ? AND periode = ?',
    [preparatriceId, periode]
  );
  if (objectif) return objectif;

  const ventesN1 = await getVentesRealisees(preparatriceId, previousYearPeriod(periode));
  const objectifCalcule = computeObjectif(ventesN1, tauxCroissance);
  const id = uuid();
  await run(
    `INSERT INTO objectifs (id, preparatrice_id, periode, ventes_n1, taux_croissance, objectif_calcule)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, preparatriceId, periode, ventesN1, tauxCroissance, objectifCalcule]
  );
  return get('SELECT * FROM objectifs WHERE id = ?', [id]);
}

function objectifEffectif(objectif) {
  return objectif.ajustement_manuel != null ? objectif.ajustement_manuel : objectif.objectif_calcule;
}

async function getProgression(preparatriceId, periode) {
  const objectif = await getOrCreateObjectif(preparatriceId, periode);
  const ventesRealisees = await getVentesRealisees(preparatriceId, periode);
  const cible = objectifEffectif(objectif);
  const pctAtteinte = cible > 0 ? Math.round((ventesRealisees / cible) * 1000) / 10 : 0;
  const ventesN1 = objectif.ventes_n1;
  const pctVsN1 = ventesN1 > 0 ? Math.round(((ventesRealisees - ventesN1) / ventesN1) * 1000) / 10 : null;
  return {
    objectif,
    cible,
    ventesRealisees,
    ventesN1,
    pctAtteinte,
    pctVsN1,
    unitesRestantes: Math.max(cible - ventesRealisees, 0),
  };
}

// Barème de points par défaut (§7.3):
// - chaque unité vendue : points_par_unite du produit si défini, sinon celui de sa marque
// - atteinte 100% de l'objectif: +50 points bonus (une fois)
// - dépassement par tranche de 10% au-delà de 100%: +20 points bonus par tranche
async function recalculerPointsVentes(preparatriceId, periode) {
  await run(`DELETE FROM scores WHERE preparatrice_id = ? AND periode = ? AND motif LIKE 'Vente%'`, [preparatriceId, periode]);
  await run(`DELETE FROM scores WHERE preparatrice_id = ? AND periode = ? AND motif LIKE 'Objectif%'`, [preparatriceId, periode]);

  const ventes = await all(
    `SELECT v.produit_id, v.marque_id, p.nom AS produit_nom, p.points_par_unite AS produit_points,
            m.points_par_unite AS marque_points, m.nom AS marque_nom, SUM(v.quantite) AS qte
     FROM ventes v
     JOIN marques m ON m.id = v.marque_id
     LEFT JOIN produits p ON p.id = v.produit_id
     WHERE v.preparatrice_id = ? AND v.periode = ? AND v.statut_validation = 'valide'
     GROUP BY v.produit_id, v.marque_id`,
    [preparatriceId, periode]
  );

  for (const v of ventes) {
    const tauxEffectif = v.produit_points != null ? v.produit_points : v.marque_points;
    const pts = v.qte * tauxEffectif;
    const libelle = v.produit_nom && !v.produit_nom.toLowerCase().startsWith(v.marque_nom.toLowerCase())
      ? `${v.marque_nom} — ${v.produit_nom}`
      : v.produit_nom || v.marque_nom;
    if (pts > 0) {
      await run(
        `INSERT INTO scores (id, preparatrice_id, montant, motif, periode) VALUES (?, ?, ?, ?, ?)`,
        [uuid(), preparatriceId, pts, `Vente ${libelle} (${v.qte} unités)`, periode]
      );
    }
  }

  const progression = await getProgression(preparatriceId, periode);
  if (progression.cible > 0 && progression.ventesRealisees >= progression.cible) {
    await run(
      `INSERT INTO scores (id, preparatrice_id, montant, motif, periode) VALUES (?, ?, ?, ?, ?)`,
      [uuid(), preparatriceId, 50, 'Objectif mensuel atteint (100%)', periode]
    );
    const tranches = Math.floor((progression.pctAtteinte - 100) / 10);
    if (tranches > 0) {
      await run(
        `INSERT INTO scores (id, preparatrice_id, montant, motif, periode) VALUES (?, ?, ?, ?, ?)`,
        [uuid(), preparatriceId, tranches * 20, `Dépassement d'objectif (+${tranches * 10}%)`, periode]
      );
    }
  }
  return progression;
}

async function getPointsBalance(preparatriceId) {
  const gained = await get('SELECT COALESCE(SUM(montant), 0) AS total FROM scores WHERE preparatrice_id = ?', [preparatriceId]);
  const spent = await get(
    `SELECT COALESCE(SUM(r.cout_points), 0) AS total FROM echanges e
     JOIN recompenses r ON r.id = e.recompense_id
     WHERE e.preparatrice_id = ? AND e.statut != 'refuse'`,
    [preparatriceId]
  );
  return gained.total - spent.total;
}

// Classement calcule sur le % d'atteinte de l'objectif (equite entre pharmacies)
async function getClassement(periode, { maille = 'national', regionId = null, pharmacieId = null, marqueId = null } = {}) {
  let sql = `SELECT p.id, p.nom, p.prenom, p.pharmacie_id, ph.nom AS pharmacie_nom, ph.region_id
             FROM preparatrices p
             JOIN pharmacies ph ON ph.id = p.pharmacie_id
             WHERE p.statut = 'actif'`;
  const params = [];
  if (maille === 'pharmacie' && pharmacieId) {
    sql += ' AND p.pharmacie_id = ?';
    params.push(pharmacieId);
  } else if (maille === 'regional' && regionId) {
    sql += ' AND ph.region_id = ?';
    params.push(regionId);
  }
  const preparatrices = await all(sql, params);

  const results = [];
  for (const p of preparatrices) {
    const objectif = await getOrCreateObjectif(p.id, periode);
    const ventesRealisees = await getVentesRealisees(p.id, periode, marqueId);
    const cible = marqueId ? null : objectifEffectif(objectif);
    const pct = cible ? Math.round((ventesRealisees / cible) * 1000) / 10 : ventesRealisees;
    results.push({ ...p, ventesRealisees, cible, pctAtteinte: pct });
  }

  results.sort((a, b) => b.pctAtteinte - a.pctAtteinte);
  results.forEach((r, i) => (r.rang = i + 1));
  return results;
}

// Met a jour la progression de toutes les participations aux challenges actifs
// couvrant la periode donnee, a partir des ventes consolidees.
async function recalcParticipations(periode) {
  const debutMois = `${periode}-01`;
  const challenges = await all(
    `SELECT * FROM challenges WHERE actif = 1 AND periode_debut <= ? AND periode_fin >= ?`,
    [`${periode}-31`, debutMois]
  );
  const preparatrices = await all('SELECT id FROM preparatrices WHERE statut = ?', ['actif']);

  for (const challenge of challenges) {
    for (const prep of preparatrices) {
      let progression;
      if (challenge.type === 'principal') {
        progression = await getVentesRealisees(prep.id, periode);
      } else {
        progression = await getVentesRealisees(prep.id, periode, challenge.marque_id);
      }

      let statut = 'en_cours';
      if (challenge.objectif_unites) {
        statut = progression >= challenge.objectif_unites ? 'reussi' : 'en_cours';
      } else if (challenge.type === 'principal') {
        const objectif = await getOrCreateObjectif(prep.id, periode);
        statut = progression >= objectifEffectif(objectif) ? 'reussi' : 'en_cours';
      }

      const existing = await get(
        'SELECT id, points_credites FROM participations WHERE challenge_id = ? AND preparatrice_id = ?',
        [challenge.id, prep.id]
      );

      // Challenge (marque / mission / défi) réussi pour la première fois : on crédite son bonus
      // de points une seule fois (cf. audit BIZ-1 — jusqu'ici jamais crédité). Le challenge
      // "principal" a déjà son propre bonus via recalculerPointsVentes (atteinte d'objectif),
      // on ne le recrédite pas ici pour éviter un doublon.
      const dejaCredite = existing ? existing.points_credites : 0;
      const vientDeReussir = statut === 'reussi' && !dejaCredite && challenge.type !== 'principal';
      if (vientDeReussir && challenge.points_bonus > 0) {
        await run(
          `INSERT INTO scores (id, preparatrice_id, montant, motif, periode) VALUES (?, ?, ?, ?, ?)`,
          [uuid(), prep.id, challenge.points_bonus, `Challenge réussi : ${challenge.nom}`, periode]
        );
      }
      const pointsCredites = dejaCredite || (vientDeReussir ? 1 : 0);

      if (existing) {
        await run('UPDATE participations SET progression = ?, statut = ?, points_credites = ? WHERE id = ?', [
          progression, statut, pointsCredites, existing.id,
        ]);
      } else {
        await run(
          'INSERT INTO participations (id, challenge_id, preparatrice_id, progression, statut, points_credites) VALUES (?, ?, ?, ?, ?, ?)',
          [uuid(), challenge.id, prep.id, progression, statut, pointsCredites]
        );
      }
    }
  }
}

async function getKPIs(periode) {
  const totalActives = await get(`SELECT COUNT(*) AS n FROM preparatrices WHERE statut = 'actif'`);
  const avecVentes = await get(
    `SELECT COUNT(DISTINCT preparatrice_id) AS n FROM ventes WHERE periode = ? AND statut_validation = 'valide'`,
    [periode]
  );
  const objectifsAtteints = await get(
    `SELECT COUNT(*) AS n FROM objectifs o
     WHERE o.periode = ? AND (
       SELECT COALESCE(SUM(v.quantite), 0) FROM ventes v
       WHERE v.preparatrice_id = o.preparatrice_id AND v.periode = o.periode AND v.statut_validation = 'valide'
     ) >= COALESCE(o.ajustement_manuel, o.objectif_calcule)`,
    [periode]
  );
  const totalObjectifs = await get('SELECT COUNT(*) AS n FROM objectifs WHERE periode = ?', [periode]);
  const volumeVentes = await get(
    `SELECT COALESCE(SUM(quantite), 0) AS total FROM ventes WHERE periode = ? AND statut_validation = 'valide'`,
    [periode]
  );
  const volumeVentesN1 = await get(
    `SELECT COALESCE(SUM(quantite), 0) AS total FROM ventes WHERE periode = ? AND statut_validation = 'valide'`,
    [previousYearPeriod(periode)]
  );
  const pointsDistribues = await get('SELECT COALESCE(SUM(montant), 0) AS total FROM scores WHERE periode = ?', [periode]);
  const pointsEchanges = await get(
    `SELECT COALESCE(SUM(r.cout_points), 0) AS total FROM echanges e JOIN recompenses r ON r.id = e.recompense_id WHERE e.statut != 'refuse'`
  );
  const pointsGagnesTotal = await get('SELECT COALESCE(SUM(montant), 0) AS total FROM scores');

  return {
    tauxEngagement: totalActives.n > 0 ? Math.round((avecVentes.n / totalActives.n) * 1000) / 10 : 0,
    tauxAtteinte: totalObjectifs.n > 0 ? Math.round((objectifsAtteints.n / totalObjectifs.n) * 1000) / 10 : 0,
    volumeVentes: volumeVentes.total,
    volumeVentesN1: volumeVentesN1.total,
    croissanceVentes: volumeVentesN1.total > 0
      ? Math.round(((volumeVentes.total - volumeVentesN1.total) / volumeVentesN1.total) * 1000) / 10
      : null,
    pointsDistribues: pointsDistribues.total,
    tauxConversionPoints: pointsGagnesTotal.total > 0
      ? Math.round((pointsEchanges.total / pointsGagnesTotal.total) * 1000) / 10
      : 0,
    totalActives: totalActives.n,
    avecVentes: avecVentes.n,
    objectifsAtteints: objectifsAtteints.n,
    totalObjectifs: totalObjectifs.n,
  };
}

module.exports = {
  currentPeriod,
  previousYearPeriod,
  periodLabel,
  computeObjectif,
  getVentesRealisees,
  getOrCreateObjectif,
  objectifEffectif,
  getProgression,
  recalculerPointsVentes,
  getPointsBalance,
  getClassement,
  recalcParticipations,
  getKPIs,
};
