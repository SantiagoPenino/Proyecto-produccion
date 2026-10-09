// =====================================================================
// Genera los dibujos de prendas (prendas.cjs) en un color: un SVG y un PNG de 1080×1080
// con fondo transparente por prenda, listos para subir como foto de un producto de la tienda.
//
//   node scripts/prendas/generar.cjs                          → celeste, en public/prendas/
//   node scripts/prendas/generar.cjs --color "#22303a" --carpeta negro
//                                                             → public/prendas/negro/
//   node scripts/prendas/generar.cjs --hoja ruta/hoja.png     → además, una hoja con todas
//
// El color de la prenda es lo único que se elige: el interior, el contorno y las costuras
// salen de ese color. En telas oscuras las costuras van claras, como el hilo sobre tela negra.
// =====================================================================
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PRENDAS } = require('./prendas.cjs');

const args = process.argv.slice(2);
const arg = (nombre, defecto) => {
    const i = args.indexOf(`--${nombre}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : defecto;
};
const color = arg('color', '#5bb4e5').toLowerCase();
if (!/^#[0-9a-f]{6}$/.test(color)) {
    console.error(`Color inválido: ${color}. Usá el formato #RRGGBB.`);
    process.exit(1);
}
const carpeta = path.join(__dirname, '../../public/prendas', arg('carpeta', ''));
const hoja = arg('hoja', null);

const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mezcla = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v * t + rgb(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
// Luminancia relativa (WCAG): por debajo de 0,08 la tela se trata como oscura.
const luminancia = h => rgb(h).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);

function estilos(tela) {
    const oscura = luminancia(tela) < 0.08;
    const linea = oscura ? '#0a1116' : mezcla(tela, '#0b1a24', 0.22);
    const hueco = oscura ? mezcla(tela, '#000000', 0.55) : mezcla(tela, '#0b1a24', 0.72);
    const hilo = oscura ? mezcla(tela, '#ffffff', 0.55) : linea;
    return `.cuerpo{fill:${tela};stroke:${linea};stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
.hueco{fill:${hueco};stroke:${linea};stroke-width:2.2;stroke-linejoin:round}
.costura{fill:none;stroke:${hilo};stroke-width:1.6;stroke-linecap:round}
.pespunte{fill:none;stroke:${hilo};stroke-width:1.1;stroke-dasharray:3 2.6;opacity:.8;stroke-linecap:round}
.rib{fill:none;stroke:${hilo};stroke-width:1;opacity:.5}
.metal{fill:#d8dde0;stroke:${linea};stroke-width:1.2}
.cierre{fill:none;stroke:${linea};stroke-width:3.2;stroke-dasharray:1.4 1.4}`;
}

const svgDe = (p, css) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
<title>${p.nombre}</title>
<style>${css}</style>${p.svg}
</svg>
`;

(async () => {
    fs.mkdirSync(carpeta, { recursive: true });
    const css = estilos(color);
    for (const p of PRENDAS) {
        const svg = svgDe(p, css);
        fs.writeFileSync(path.join(carpeta, `${p.id}.svg`), svg);
        await sharp(Buffer.from(svg), { density: 72 * 1080 / 240 }).resize(1080, 1080).png().toFile(path.join(carpeta, `${p.id}.png`));
    }
    console.log(`${PRENDAS.length} prendas en ${path.relative(process.cwd(), carpeta) || '.'} (color ${color})`);

    if (hoja) {
        // Hoja de revisión: todas las prendas en una grilla, fondo blanco.
        const cols = 4, celda = 260, filas = Math.ceil(PRENDAS.length / cols);
        const grupos = PRENDAS.map((p, i) => `<g transform="translate(${10 + (i % cols) * celda} ${10 + Math.floor(i / cols) * celda})">${p.svg}</g>`).join('\n');
        const todo = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * celda * 2}" height="${filas * celda * 2}" viewBox="0 0 ${cols * celda} ${filas * celda}">
<style>${css}</style><rect width="100%" height="100%" fill="#ffffff"/>${grupos}</svg>`;
        await sharp(Buffer.from(todo)).png().toFile(hoja);
        console.log(`Hoja: ${hoja}`);
    }
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
