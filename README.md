# NewMedica Challenge

Application de gamification commerciale pour les préparatrices en pharmacie et parapharmacie,
distribuant les marques Sensilis, BABÉ, Cumlaude Lab, Good Health et Rilastil.

MVP du Lot 1 du cahier des charges : application préparatrices (PWA responsive) + back-office
NewMedica, sur une stack Express / EJS / SQLite sans étape de build (Tailwind chargé en CDN).

## Démarrage

```bash
npm install
npm start       # http://localhost:3300
```

`npm run dev` relance le serveur automatiquement (nodemon) à chaque modification.

Au premier démarrage, la base `newmedica.db` (SQLite, créée automatiquement) est peuplée avec un
jeu de données de démonstration : 12 préparatrices, 6 pharmacies, 3 régions, 5 marques, 4
challenges actifs, un catalogue de récompenses et quelques échanges/badges déjà attribués.
Supprimer `newmedica.db` régénère un jeu de données frais au redémarrage.

### Comptes de démonstration

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Préparatrice | `amel.jaziri@newmedica-app.tn` (ou toute autre préparatrice générée) | `newmedica123` |
| Administrateur (Super Admin) | `admin@newmedica.tn` (ou `ADMIN_EMAIL`) | `admin123` (ou `ADMIN_PASSWORD`) |
| KAM régional (Nord) | `kam.nord@newmedica.tn` | `kam123` |
| Marque (lecture seule) | `marque.babe@newmedica.tn` | `lecture123` |

Définissez `ADMIN_EMAIL` / `ADMIN_PASSWORD` avant le premier démarrage pour ne pas utiliser les
identifiants par défaut (un avertissement s'affiche sinon au démarrage).

## Périmètre couvert (Lot 1)

- **Application préparatrices** (`/login`, puis `/`, `/challenges`, `/classement`,
  `/recompenses`, `/profil`) : objectif du mois, jauge de progression, % vs N-1, challenges
  (principal / marque / mission bonus / défi ponctuel), classement (pharmacie / régional /
  national, filtrable par marque), catalogue de récompenses avec échange de points, badges,
  historique et notifications. Installable comme une app sur Android/iOS (PWA — voir plus bas).
- **Scan de ticket de caisse** (`/scanner`) : la préparatrice prend en photo un ticket de caisse
  (via l'appareil photo du téléphone), le serveur en extrait le texte par OCR (Tesseract.js,
  français) et propose automatiquement les marques et quantités détectées ; la préparatrice
  relit/corrige la liste avant envoi. Les ventes ainsi déclarées restent **en attente** — elles ne
  comptent dans les objectifs/classement/points qu'une fois validées côté back-office (§7.6 du
  cahier des charges : source déclarative tracée + contrôle avant validation définitive).
- **Back-office** (`/admin/login`, puis `/admin/dashboard`, `/admin/preparatrices`,
  `/admin/pharmacies`, `/admin/ventes`, `/admin/tickets`, `/admin/objectifs`, `/admin/challenges`,
  `/admin/recompenses`, `/admin/reporting`) : gestion des utilisateurs/pharmacies (avec import
  CSV), import des ventes (fichier plat simulant un connecteur caisse/ERP), validation/rejet des
  tickets scannés par les préparatrices, calcul automatique des objectifs (Ventes N-1 × (1 + taux
  de croissance)) avec ajustement manuel motivé, gestion des challenges et du catalogue de
  récompenses (validation/refus des demandes d'échange), reporting (engagement, atteinte des
  objectifs, volumes par marque/région, points distribués).
- Rôles back-office : Super Admin (accès complet), KAM régional (vues filtrées sur sa région),
  Marque en lecture seule (aucune action d'écriture).

## Installation sur mobile (PWA)

L'app préparatrices peut être installée sur l'écran d'accueil (icône, plein écran, sans barre
d'adresse) depuis Chrome (Android) ou Safari (iPhone) — voir `public/manifest.json` et
`public/sw.js`. Le téléphone doit pouvoir atteindre l'adresse du serveur (réseau local ou
hébergement public). Ceci rend l'app installable depuis le navigateur ; ça ne la publie pas sur
l'App Store / Play Store (qui demanderait des comptes développeur Apple/Google et, pour une vraie
app native, une coquille type Capacitor).

## Simplifications assumées pour ce MVP

- Pas d'application mobile native (React Native/Flutter) : le front préparatrices est une PWA
  web responsive, conformément à l'alternative « plus économique pour un MVP » du cahier des
  charges (§10.1).
- L'import de ventes/préparatrices se fait par fichier CSV téléversé dans le back-office ; aucun
  connecteur ERP/caisse réel n'est branché.
- La reconnaissance de produits sur ticket scanné (OCR) est un **assistant de saisie**, pas un
  lecteur fiable à 100 % : elle repère les 5 noms de marques dans le texte détecté et propose une
  quantité par défaut, à corriger par la préparatrice. C'est pour cela que ces ventes restent
  « en attente » jusqu'à validation par un administrateur.
- Les notifications sont uniquement in-app (centre de notifications côté profil préparatrice) ;
  aucun envoi push/SMS/email réel n'est déclenché.
- Academy et Communauté (Lot 3 / Phase 2 du cahier des charges) ne sont pas implémentés.
- Authentification par session serveur (cookie httpOnly), sans SSO ni MFA.

## Structure

```
server.js            point d'entrée Express
lib/db.js             schéma SQLite
lib/seed.js           jeu de données de démonstration
lib/calculations.js   règles métier (objectifs, points, classement, KPIs)
lib/auth.js           sessions préparatrice / back-office
lib/csv.js            parseur CSV minimal pour les imports
lib/ocr.js             OCR (tesseract.js) + rapprochement produits pour les tickets scannés
routes/               routes Express (auth, app préparatrices, back-office)
views/                vues EJS (views/app, views/admin, views/partials)
public/               CSS et JS client (aucune étape de build), manifest/service worker PWA
public/uploads/tickets/  photos de tickets envoyées par les préparatrices (non versionné)
scripts/generate-icons.js  génère les icônes PWA (Node pur, sans dépendance)
```
