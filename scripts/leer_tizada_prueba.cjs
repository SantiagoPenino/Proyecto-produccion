// SOLO LECTURA. Mira la base de TIZADA PRO del servidor de prueba (192.168.0.101) para saber si el molde
// "Camiseta Goes 2026" tiene registrada su plantilla base. No modifica nada.
// Uso: completar en backend/.env las líneas TIZADAPRO_PRUEBA_DB_SERVER / _USER / _PASSWORD y correr
//   node scripts/leer_tizada_prueba.cjs
// (también acepta TZ_SQL_USER / TZ_SQL_PASS / TZ_SQL_SERVER puestas en la terminal)
const path = require('path');
require('../backend/node_modules/dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const sql = require('../backend/node_modules/mssql');
const SERVIDOR = process.env.TZ_SQL_SERVER || process.env.TIZADAPRO_PRUEBA_DB_SERVER || '192.168.0.101';
const USUARIO = process.env.TZ_SQL_USER || process.env.TIZADAPRO_PRUEBA_DB_USER;
const CLAVE = process.env.TZ_SQL_PASS || process.env.TIZADAPRO_PRUEBA_DB_PASSWORD;
const MOLDE = 'prod_20260921_152644_a01c';

(async () => {
  if (!USUARIO || !CLAVE) { console.log('Falta el usuario o la contraseña: completá TIZADAPRO_PRUEBA_DB_USER y TIZADAPRO_PRUEBA_DB_PASSWORD al final de backend/.env'); process.exit(1); }
  const pool = await sql.connect({ server: SERVIDOR, user: USUARIO, password: CLAVE, database: 'master',
    options: { encrypt: false, trustServerCertificate: true }, connectionTimeout: 15000, requestTimeout: 30000 });
  const q = async (t) => (await pool.request().query(t)).recordset;
  console.log('CONECTADO a', SERVIDOR, '·', (await q('SELECT @@VERSION AS v'))[0].v.split('\n')[0]);
  const bases = (await q("SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name")).map(x => x.name);
  console.log('BASES:', bases.join(', '));
  // la base de TIZADA: la que tenga la tabla "producto" con el molde Goes
  for (const db of bases) {
    let tiene = false;
    try { tiene = (await q(`SELECT 1 AS ok FROM [${db}].sys.tables WHERE name = 'producto'`)).length > 0; } catch (_) { continue; }
    if (!tiene) continue;
    console.log(`\n===== ${db} =====`);
    const tablas = await q(`SELECT t.name, (SELECT SUM(p.rows) FROM [${db}].sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS filas FROM [${db}].sys.tables t ORDER BY t.name`);
    console.log('TABLAS:', tablas.map(t => `${t.name}(${t.filas})`).join(', '));
    const cols = await q(`SELECT t.name AS tabla, c.name AS col FROM [${db}].sys.columns c JOIN [${db}].sys.tables t ON t.object_id = c.object_id
      WHERE c.name LIKE '%plantilla%' OR c.name LIKE '%base%' OR c.name LIKE '%arte%' OR c.name LIKE '%path%' OR c.name LIKE '%ruta%' OR c.name LIKE '%archivo%'`);
    console.log('COLUMNAS de archivos/plantillas:', cols.map(x => `${x.tabla}.${x.col}`).join(', ') || '—');
    let prod = [];
    try { prod = await q(`SELECT id, legacy_id, nombre, activo FROM [${db}].dbo.producto WHERE legacy_id = '${MOLDE}' OR nombre LIKE '%Goes%'`); } catch (e) { console.log('producto:', e.message); }
    console.log('MOLDE GOES:', JSON.stringify(prod));
    const id = prod.find(p => p.legacy_id === MOLDE)?.id;
    // cada tabla con columna producto_id: sus filas del molde Goes (ahí suele estar la plantilla)
    const conProd = await q(`SELECT t.name FROM [${db}].sys.columns c JOIN [${db}].sys.tables t ON t.object_id = c.object_id WHERE c.name = 'producto_id'`);
    for (const { name } of conProd) {
      if (!id) break;
      try {
        const filas = await q(`SELECT TOP 10 * FROM [${db}].dbo.[${name}] WHERE producto_id = ${Number(id)}`);
        if (filas.length) console.log(`  ${name}:`, filas.map(f => JSON.stringify(f).slice(0, 300)).join('\n    '));
      } catch (e) { console.log(`  ${name}: ${e.message}`); }
    }
    for (const t of ['config_molde', 'plantilla', 'plantillas', 'plantilla_base', 'archivo', 'archivos']) {
      if (!tablas.some(x => x.name === t)) continue;
      const filas = await q(`SELECT TOP 20 * FROM [${db}].dbo.[${t}]`);
      console.log(`  ${t} (${filas.length}):`, filas.map(f => JSON.stringify(f).slice(0, 250)).join('\n    '));
    }
  }
  await pool.close();
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
