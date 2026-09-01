const path = require('path');
const { createWorker } = require('tesseract.js');
const Jimp = require('jimp').Jimp;

const CACHE_PATH = path.join(__dirname, '..', '.tesseract-cache');

// Alias reconnus sur un ticket de caisse pour chaque marque (texte imprimé souvent abrégé/déformé
// par l'OCR : sans accents, parfois sans espace, casse variable).
const MARQUE_ALIASES = {
  Sensilis: ['SENSILIS', 'SENSIL'],
  'BABÉ': ['BABE', 'BABÉ'],
  'Cumlaude Lab': ['CUMLAUDE', 'CUMLAUDELAB', 'CUM LAUDE'],
  'Good Health': ['GOODHEALTH', 'GOOD HEALTH', 'GOODHLTH', 'GOOD HLTH'],
  Rilastil: ['RILASTIL', 'RILAST'],
};

function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuantite(line) {
  // cherche un nombre isolé (1-99) sur la ligne, souvent la quantité ou le prix unitaire ; à défaut 1.
  const matches = line.match(/\b([1-9][0-9]?)\b/g);
  if (!matches) return 1;
  const qty = matches.map(Number).find((n) => n >= 1 && n <= 99);
  return qty || 1;
}

// Repère, ligne par ligne, les marques mentionnées dans le texte OCR d'un ticket et propose une
// quantité par défaut. Résultat indicatif : la préparatrice corrige avant envoi (§7.6 du cahier
// des charges — les ventes déclaratives restent tracées et validées avant de compter).
function matchProduits(ocrText, marques) {
  const lines = ocrText.split('\n').map((l) => l.trim()).filter(Boolean);
  const suggestions = [];
  const dejaVues = new Set();

  for (const line of lines) {
    const normLine = normalize(line);
    const normLineNoSpace = normLine.replace(/ /g, '');
    if (normLineNoSpace.length < 3) continue;

    for (const marque of marques) {
      const aliases = MARQUE_ALIASES[marque.nom] || [normalize(marque.nom)];
      const found = aliases.some((alias) => normLineNoSpace.includes(alias.replace(/ /g, '')));
      if (found && !dejaVues.has(marque.id + '|' + line)) {
        dejaVues.add(marque.id + '|' + line);
        suggestions.push({
          marque_id: marque.id,
          marque_nom: marque.nom,
          quantite: extractQuantite(line),
          ligne_texte: line,
        });
      }
    }
  }
  return suggestions;
}

// Pré-traitement léger (niveaux de gris + largeur plafonnée) : accélère l'OCR et améliore la
// lisibilité d'une photo de ticket prise au smartphone (souvent trop grande, parfois de biais).
async function preprocessImage(inputPath, outputPath) {
  const image = await Jimp.read(inputPath);
  if (image.bitmap.width > 1400) {
    image.resize({ w: 1400 });
  }
  image.greyscale().contrast(0.2);
  await image.write(outputPath);
  return outputPath;
}

async function reconnaitreTexte(imagePath) {
  const worker = await createWorker('fra', 1, { cachePath: CACHE_PATH });
  try {
    const { data } = await worker.recognize(imagePath);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}

module.exports = { matchProduits, normalize, preprocessImage, reconnaitreTexte };
