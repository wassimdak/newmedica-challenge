// Parseur CSV minimal (pas de guillemets imbriqués / champs multi-lignes) : suffisant pour les
// fichiers plats d'import (ventes, préparatrices) décrits au cahier des charges §6.1/§6.2.
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const detectSeparator = (line) => (line.split(';').length > line.split(',').length ? ';' : ',');
  const sep = detectSeparator(lines[0]);
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line.split(sep).map((v) => v.trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = values[i] !== undefined ? values[i] : ''));
    return row;
  });
}

module.exports = { parseCsv };
