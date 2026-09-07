const express = require('express');
require('express-async-errors'); // forward rejected promises from async route handlers to Express's error middleware
const path = require('path');
const cookieParser = require('cookie-parser');

require('./lib/db'); // creates schema
const { seedIfEmpty, syncAdminCredentials } = require('./lib/seed');

const authRoutes = require('./routes/auth');
const appRoutes = require('./routes/app');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3300;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Nécessaire derrière le proxy TLS-terminant de Render pour que req.protocol/req.secure et
// express-rate-limit (identification par IP) reflètent la vraie connexion du client, pas celle
// (toujours HTTP, toujours la même IP interne) entre le proxy et ce processus.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(authRoutes);
app.use(appRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).send('Page introuvable');
});

// Filet de sécurité : une erreur dans une route (contrainte base de données, bug, requête
// malformée...) ne doit jamais faire planter tout le serveur pour tout le monde — elle est
// journalisée puis renvoyée en 500 au seul appelant concerné.
app.use((err, req, res, next) => {
  console.error('Erreur non gérée sur', req.method, req.originalUrl, ':', err);
  if (res.headersSent) return next(err);
  res.status(500).send("Une erreur est survenue. Réessayez, ou contactez l'administrateur si ça persiste.");
});

process.on('unhandledRejection', (err) => {
  console.error('Rejet de promesse non géré (processus maintenu en vie) :', err);
});

seedIfEmpty()
  .catch((err) => console.error('Erreur lors de la génération du jeu de données de démonstration :', err))
  .then(() => syncAdminCredentials())
  .catch((err) => console.error('Erreur lors de la synchronisation des identifiants admin :', err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`NewMedica Challenge en écoute sur http://localhost:${PORT}`);
    });
  });
