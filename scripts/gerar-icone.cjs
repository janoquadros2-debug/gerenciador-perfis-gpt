// Gera o ícone do Windows a partir do SVG GPT, sem reutilizar o ícone do aplicativo antigo.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../build/icon-gpt.svg'));
  const png = await sharp(svg).resize(256, 256).png().toBuffer();
  const destino = path.join(__dirname, '../build');
  fs.writeFileSync(path.join(destino, 'icon.png'), png);
  // ICO com imagem PNG de 256 pixels (Windows Vista ou posterior).
  const cab = Buffer.alloc(22);
  cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(1, 4);
  cab[6] = 0; cab[7] = 0; cab[8] = 0; cab[9] = 0;
  cab.writeUInt16LE(1, 10); cab.writeUInt16LE(32, 12);
  cab.writeUInt32LE(png.length, 14); cab.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(destino, 'icon.ico'), Buffer.concat([cab, png]));
  console.log('Ícone GPT gerado.');
})().catch(e => {console.error(e); process.exit(1)});
