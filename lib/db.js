const path = require('path');
const { createClient } = require('@libsql/client');

// En production (TURSO_DATABASE_URL défini), on se connecte à la base Turso hébergée — persistante,
// contrairement au disque local de Render qui est effacé à chaque redémarrage du conteneur (y
// compris les mises en veille par inactivité, pas seulement les redéploiements). En local sans ces
// variables, on retombe sur un fichier SQLite classique pour ne pas dépendre du réseau en dev.
const db = process.env.TURSO_DATABASE_URL
  ? createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  : createClient({ url: `file:${path.join(__dirname, '..', 'newmedica.db')}` });

const SCHEMA_STATEMENTS = [
  'PRAGMA foreign_keys = ON',

  `CREATE TABLE IF NOT EXISTS regions (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    kam_responsable TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS pharmacies (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    adresse TEXT,
    region_id TEXT REFERENCES regions(id),
    groupement TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS marques (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    logo TEXT,
    points_par_unite INTEGER NOT NULL DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS produits (
    id TEXT PRIMARY KEY,
    nom TEXT,
    reference TEXT NOT NULL,
    marque_id TEXT REFERENCES marques(id),
    unite_vente TEXT DEFAULT 'unite',
    points_par_unite INTEGER,
    actif INTEGER NOT NULL DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS preparatrices (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    email TEXT UNIQUE,
    telephone TEXT,
    password_hash TEXT NOT NULL,
    pharmacie_id TEXT REFERENCES pharmacies(id),
    statut TEXT NOT NULL DEFAULT 'actif',
    date_entree TEXT,
    photo TEXT,
    doit_changer_mdp INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    photo TEXT NOT NULL,
    periode TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'en_attente',
    texte_ocr TEXT,
    motif_rejet TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS ventes (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    produit_id TEXT REFERENCES produits(id),
    marque_id TEXT REFERENCES marques(id),
    quantite INTEGER NOT NULL,
    periode TEXT NOT NULL,
    source TEXT DEFAULT 'import',
    statut_validation TEXT NOT NULL DEFAULT 'valide',
    ticket_id TEXT REFERENCES tickets(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS objectifs (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    periode TEXT NOT NULL,
    ventes_n1 INTEGER NOT NULL DEFAULT 0,
    taux_croissance REAL NOT NULL DEFAULT 0.2,
    objectif_calcule INTEGER NOT NULL,
    ajustement_manuel INTEGER,
    ajustement_motif TEXT,
    UNIQUE(preparatrice_id, periode)
  )`,

  `CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    type TEXT NOT NULL,
    periode_debut TEXT NOT NULL,
    periode_fin TEXT NOT NULL,
    perimetre TEXT NOT NULL DEFAULT 'national',
    marque_id TEXT REFERENCES marques(id),
    objectif_unites INTEGER,
    regles_points TEXT,
    recompense_associee TEXT,
    points_bonus INTEGER,
    actif INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS participations (
    id TEXT PRIMARY KEY,
    challenge_id TEXT REFERENCES challenges(id),
    preparatrice_id TEXT REFERENCES preparatrices(id),
    progression INTEGER NOT NULL DEFAULT 0,
    statut TEXT NOT NULL DEFAULT 'en_cours',
    points_credites INTEGER NOT NULL DEFAULT 0,
    UNIQUE(challenge_id, preparatrice_id)
  )`,

  `CREATE TABLE IF NOT EXISTS scores (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    montant INTEGER NOT NULL,
    motif TEXT NOT NULL,
    periode TEXT,
    date TEXT DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS recompenses (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    categorie TEXT NOT NULL,
    cout_points INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    condition_eligibilite TEXT,
    visuel TEXT,
    actif INTEGER NOT NULL DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS echanges (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    recompense_id TEXT REFERENCES recompenses(id),
    date TEXT DEFAULT CURRENT_TIMESTAMP,
    statut TEXT NOT NULL DEFAULT 'demande',
    motif_refus TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS badges (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    regle_obtention TEXT,
    points_associes INTEGER NOT NULL DEFAULT 0,
    icone TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS obtentions (
    id TEXT PRIMARY KEY,
    badge_id TEXT REFERENCES badges(id),
    preparatrice_id TEXT REFERENCES preparatrices(id),
    date TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(badge_id, preparatrice_id)
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    titre TEXT NOT NULL,
    message TEXT NOT NULL,
    lu INTEGER NOT NULL DEFAULT 0,
    date TEXT DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS backoffice_users (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'super_admin',
    region_id TEXT REFERENCES regions(id)
  )`,
];

// Exécutées en séquence (pas en parallèle) : certaines tables référencent les précédentes via
// REFERENCES, et PRAGMA foreign_keys doit s'appliquer avant les CREATE TABLE suivants.
const ready = (async () => {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.execute(statement);
  }
})();

module.exports = db;
module.exports.ready = ready;
