const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'newmedica.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS regions (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    kam_responsable TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pharmacies (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    adresse TEXT,
    region_id TEXT REFERENCES regions(id),
    groupement TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS marques (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    logo TEXT,
    points_par_unite INTEGER NOT NULL DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS produits (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL,
    marque_id TEXT REFERENCES marques(id),
    unite_vente TEXT DEFAULT 'unite'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS preparatrices (
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ventes (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    produit_id TEXT REFERENCES produits(id),
    marque_id TEXT REFERENCES marques(id),
    quantite INTEGER NOT NULL,
    periode TEXT NOT NULL,
    source TEXT DEFAULT 'import',
    statut_validation TEXT NOT NULL DEFAULT 'valide',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS objectifs (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    periode TEXT NOT NULL,
    ventes_n1 INTEGER NOT NULL DEFAULT 0,
    taux_croissance REAL NOT NULL DEFAULT 0.2,
    objectif_calcule INTEGER NOT NULL,
    ajustement_manuel INTEGER,
    ajustement_motif TEXT,
    UNIQUE(preparatrice_id, periode)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS challenges (
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
    actif INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS participations (
    id TEXT PRIMARY KEY,
    challenge_id TEXT REFERENCES challenges(id),
    preparatrice_id TEXT REFERENCES preparatrices(id),
    progression INTEGER NOT NULL DEFAULT 0,
    statut TEXT NOT NULL DEFAULT 'en_cours',
    UNIQUE(challenge_id, preparatrice_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS scores (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    montant INTEGER NOT NULL,
    motif TEXT NOT NULL,
    periode TEXT,
    date TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS recompenses (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    categorie TEXT NOT NULL,
    cout_points INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    condition_eligibilite TEXT,
    visuel TEXT,
    actif INTEGER NOT NULL DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS echanges (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    recompense_id TEXT REFERENCES recompenses(id),
    date TEXT DEFAULT CURRENT_TIMESTAMP,
    statut TEXT NOT NULL DEFAULT 'demande',
    motif_refus TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS badges (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    regle_obtention TEXT,
    points_associes INTEGER NOT NULL DEFAULT 0,
    icone TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS obtentions (
    id TEXT PRIMARY KEY,
    badge_id TEXT REFERENCES badges(id),
    preparatrice_id TEXT REFERENCES preparatrices(id),
    date TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(badge_id, preparatrice_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    preparatrice_id TEXT REFERENCES preparatrices(id),
    titre TEXT NOT NULL,
    message TEXT NOT NULL,
    lu INTEGER NOT NULL DEFAULT 0,
    date TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS backoffice_users (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'super_admin',
    region_id TEXT REFERENCES regions(id)
  )`);
});

module.exports = db;
