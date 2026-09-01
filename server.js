const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

require('./lib/db'); // creates schema
const { seedIfEmpty } = require('./lib/seed');

const authRoutes = require('./routes/auth');
const appRoutes = require('./routes/app');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3300;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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

seedIfEmpty()
  .catch((err) => console.error('Erreur lors de la génération du jeu de données de démonstration :', err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`NewMedica Challenge en écoute sur http://localhost:${PORT}`);
    });
  });
