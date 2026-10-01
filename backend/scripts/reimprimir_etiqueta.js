// Reimprime UNA etiqueta sin desplegar: arma el mismo HTML que el botón "Reimprimir"
// del detalle de la orden y lo guarda en un archivo para abrirlo e imprimirlo.
// SOLO LECTURA: no modifica nada en la base.
//
// Uso:  node scripts/reimprimir_etiqueta.js <CodigoEtiqueta>
//   ej: node scripts/reimprimir_etiqueta.js 28167/B32101
// La base sale del .env del backend; las variables DB_* del shell tienen prioridad.
const fs = require('fs');
const path = require('path');
const { getPool } = require('../config/db');
const ctl = require('../controllers/etiquetasController');

(async () => {
    const codigo = process.argv[2];
    if (!codigo) throw new Error('Falta el código de etiqueta (ej. 28167/B32101)');

    const pool = await getPool();
    const et = (await pool.request()
        .input('Cod', codigo)
        .query('SELECT EtiquetaID, OrdenID FROM Etiquetas WHERE CodigoEtiqueta = @Cod')).recordset[0];
    if (!et) throw new Error(`No existe la etiqueta ${codigo} en ${process.env.DB_DATABASE}`);

    const html = await new Promise((resolve, reject) => ctl.printEtiquetas(
        { params: { ordenId: String(et.OrdenID) }, query: { etiquetaId: String(et.EtiquetaID), reimprimir: '1' } },
        { send: resolve, status() { return this; }, json: j => reject(new Error(JSON.stringify(j))) }
    ));

    const out = path.resolve(__dirname, `etiqueta_${codigo.replace(/[^\w-]/g, '_')}.html`);
    fs.writeFileSync(out, html);
    console.log(`Etiqueta generada: ${out}`);
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
