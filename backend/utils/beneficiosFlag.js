'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Interruptor general de BENEFICIOS PACTADOS — ConfiguracionGlobal, clave
// 'BENEFICIOS_ACTIVOS' (mismo mecanismo que AREAS_NOMBRE_ARCHIVO_NUEVO).
//
//   '1' → encendido: el motor de precios aplica los precios pactados de los
//         beneficios activos, el motor contable consume las bolsas y se pueden
//         activar beneficios (caja y portal).
//   '0', vacío, clave inexistente o error de lectura → APAGADO: todo lo demás
//         (catálogo, pactos, aprobación) sigue funcionando, pero ningún precio
//         cambia y ninguna bolsa se crea ni se consume.
//
// Se relee de la base como mucho una vez por minuto. Ante cualquier error se
// asume apagado (fail-closed): nunca se cambia un precio por un error de lectura.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool } = require('../config/db');
const logger = require('./logger');

const CLAVE_BENEFICIOS = 'BENEFICIOS_ACTIVOS';
const CACHE_MS = 60 * 1000;

let cacheValor = false;
let cacheVence = 0;

async function beneficiosActivos(pool = null) {
  if (Date.now() < cacheVence) return cacheValor;
  try {
    const p = pool || await getPool();
    const r = await p.request()
      .input('K', CLAVE_BENEFICIOS)
      .query('SELECT TOP 1 Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = @K');
    const v = String(r.recordset[0]?.Valor ?? '').trim().toUpperCase();
    cacheValor = (v === '1' || v === 'SI' || v === 'TRUE' || v === 'ON');
  } catch (e) {
    logger.warn(`[BENEFICIOS] No se pudo leer ${CLAVE_BENEFICIOS}: ${e.message} → se asume APAGADO`);
    cacheValor = false;
  }
  cacheVence = Date.now() + CACHE_MS;
  return cacheValor;
}

function invalidarCacheBeneficios() { cacheVence = 0; }

module.exports = { beneficiosActivos, invalidarCacheBeneficios, CLAVE_BENEFICIOS };
