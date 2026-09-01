const { Jimp, loadFont } = require('jimp');
const path = require('path');

(async () => {
  const image = new Jimp({ width: 500, height: 400, color: 0xffffffff });
  const fontPath = path.join(__dirname, '..', 'node_modules', '@jimp', 'plugin-print', 'dist', 'fonts', 'open-sans', 'open-sans-32-black', 'open-sans-32-black.fnt');
  const font = await loadFont(fontPath).catch((e) => { console.error('font error', e.message); return null; });
  const lines = ['PHARMACIE TEST', 'BABE CREME    2', 'SENSILIS LOTION 1', 'TOTAL 45.00 DT'];
  let y = 20;
  for (const line of lines) {
    if (font) {
      image.print({ font, x: 20, y, text: line });
    }
    y += 60;
  }
  const out = path.join(__dirname, '..', 'test-receipt.jpg');
  await image.write(out);
  console.log('wrote', out, 'fontLoaded=', !!font);
})();
