'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ESCALAS POR CANTIDAD DE LOS PRODUCTOS DEL CONFIGURADOR (27-oct-2026)
// backend/scripts/configurador_precios_escalonados.sql
//
// Cada producto (y cada variante) puede tener sus escalas, como los precios escalonados de los servicios:
//   «desde 10 prendas → $300 c/u» (precio fijo) o «desde 50 prendas → 10 %» (descuento sobre la lista).
// Viven en el perfil global "PRODUCTOS ESCALONADOS" (PerfilesPrecios.Categoria = 'PRO', el área de las órdenes
// de estos productos), una regla por escala atada al producto (PerfilesItems.ProIdProducto). Así el MOTOR las
// aplica solo al cotizar la línea PRO del pedido (pricingService.calculatePrice), sin código nuevo ahí.
//
// Un producto tiene UN cálculo para todas sus escalas (precio fijo o descuento), como en Precios Estándar.
// Las de precio fijo van en la moneda del precio de lista del producto.
//
// precioPara() repite lo que hace el motor con estas reglas, para MOSTRAR el precio de catálogo según la
// cantidad (solicitud, portal) sin cliente ni otros perfiles: gana la escala más alta que alcanza la cantidad;
// un precio fijo solo gana si es más bajo que la lista (y mayor que 0); el descuento es % sobre la lista.
// ─────────────────────────────────────────────────────────────────────────────
const { sql } = require('../config/db');
// Historial de perfiles (ver services/historialPrecios.js): las escalas viven en el perfil PRODUCTOS ESCALONADOS.
// Quién lo hizo no llega hasta acá (las llama el configurador sin el usuario): queda la fecha y el producto.
const { leerPerfil, registrarCambioPerfil } = require('./historialPrecios');

const TIPOS = ['fixed_price', 'percentage_discount'];
const FALTA_SQL = 'Para guardar escalas falta correr backend/scripts/configurador_precios_escalonados.sql en esta base (crea el perfil «PRODUCTOS ESCALONADOS»).';
const fallo = (status, msg) => Object.assign(new Error(msg), { status });
function req(cx) { return new sql.Request(cx); }
const lista = (ids) => [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];

// ID del perfil (el global de Categoria 'PRO'; el primero si hubiera más). Se recuerda solo cuando existe.
let _perfil = null;
async function perfilId(cx) {
    if (_perfil) return _perfil;
    const r = await req(cx).query("SELECT TOP 1 ID FROM dbo.PerfilesPrecios WHERE EsGlobal = 1 AND LTRIM(RTRIM(Categoria)) = 'PRO' ORDER BY ID");
    _perfil = r.recordset[0]?.ID || null;
    return _perfil;
}

// Escalas de varios productos: Map proId → { tipo, moneda, filas: [{ desde, valor }] } (solo los que tienen)
async function deProductos(cx, proIds) {
    const ids = lista(proIds);
    const mapa = new Map();
    if (!ids.length) return mapa;
    const perfil = await perfilId(cx);
    if (!perfil) return mapa;
    const r = await req(cx).input('Perfil', sql.Int, perfil).query(`
        SELECT ProIdProducto, TipoRegla, Valor, MonIdMoneda, CantidadMinima
        FROM dbo.PerfilesItems
        WHERE PerfilID = @Perfil AND ProIdProducto IN (${ids.join(',')})
        ORDER BY ProIdProducto, CantidadMinima`);
    r.recordset.forEach(x => {
        const id = Number(x.ProIdProducto);
        const e = mapa.get(id) || { tipo: x.TipoRegla, moneda: x.MonIdMoneda === 2 ? 'USD' : 'UYU', filas: [] };
        e.filas.push({ desde: Number(x.CantidadMinima) || 1, valor: Number(x.Valor) });
        mapa.set(id, e);
    });
    return mapa;
}
const deProducto = async (cx, proId) => (await deProductos(cx, [proId])).get(Number(proId)) || null;

// Lo que manda el editor → { tipo, filas } limpio. Error 400 si algo no cierra.
function normalizar(entrada) {
    const tipo = TIPOS.includes(entrada?.tipo) ? entrada.tipo : null;
    const filas = (Array.isArray(entrada?.filas) ? entrada.filas : [])
        .filter(f => f && String(f.desde ?? '').trim() !== '' && String(f.valor ?? '').trim() !== '')
        .map(f => ({ desde: Number(f.desde), valor: Number(String(f.valor).replace(',', '.')) }));
    if (!filas.length) return { tipo: tipo || 'fixed_price', filas: [] };
    if (!tipo) throw fallo(400, 'Escalas: elegí el cálculo (precio fijo o descuento).');
    for (const f of filas) {
        if (!Number.isInteger(f.desde) || f.desde < 2) throw fallo(400, `Escalas: «desde» tiene que ser una cantidad entera de 2 o más (${f.desde}).`);
        if (!(f.valor > 0)) throw fallo(400, `Escalas: el valor desde ${f.desde} tiene que ser mayor que 0.`);
        if (tipo === 'percentage_discount' && f.valor >= 100) throw fallo(400, `Escalas: el descuento desde ${f.desde} tiene que ser menor que 100 %.`);
    }
    const repetida = filas.find((f, i) => filas.findIndex(g => g.desde === f.desde) !== i);
    if (repetida) throw fallo(400, `Escalas: la cantidad ${repetida.desde} está dos veces.`);
    return { tipo, filas: filas.sort((a, b) => a.desde - b.desde) };
}

// Reemplaza las escalas del producto por estas (vacío = sin escalas). Con un pool o dentro de una transacción.
async function guardar(cx, proId, codArticulo, { tipo, filas }, moneda) {
    const perfil = await perfilId(cx);
    if (!perfil) {
        if (filas.length) throw fallo(409, FALTA_SQL);
        return;
    }
    const antes = await leerPerfil(cx, perfil, proId);
    await req(cx).input('Perfil', sql.Int, perfil).input('P', sql.Int, proId)
        .query('DELETE FROM dbo.PerfilesItems WHERE PerfilID = @Perfil AND ProIdProducto = @P');
    const monId = String(moneda || 'UYU').trim().toUpperCase() === 'USD' ? 2 : 1;
    for (const f of filas) {   // una detrás de otra: una transacción de mssql no admite dos pedidos a la vez
        await req(cx).input('Perfil', sql.Int, perfil).input('P', sql.Int, proId).input('Cod', sql.NVarChar(100), String(codArticulo || proId).trim())
            .input('Tipo', sql.NVarChar(40), tipo).input('Valor', sql.Decimal(18, 4), f.valor).input('Mon', sql.Int, monId)
            .input('MonTxt', sql.NVarChar(10), monId === 2 ? 'USD' : 'UYU').input('Desde', sql.Int, f.desde)
            .query(`INSERT INTO dbo.PerfilesItems (PerfilID, ProIdProducto, CodArticulo, CodGrupo, TipoRegla, Valor, MonIdMoneda, Moneda, CantidadMinima)
                    VALUES (@Perfil, @P, @Cod, NULL, @Tipo, @Valor, @Mon, @MonTxt, @Desde)`);
    }
    await registrarCambioPerfil(cx, { perfilId: perfil, origen: 'ESCALAS', user: null, antes, proId });
}

// Las escalas de un producto pasan a otro (variante nueva, copia o «copiar de nuevo del padre»): reemplaza las suyas.
async function copiar(cx, deProId, aProId, aCodArticulo) {
    const perfil = await perfilId(cx);
    if (!perfil) return 0;
    const antes = await leerPerfil(cx, perfil, aProId);
    await req(cx).input('Perfil', sql.Int, perfil).input('A', sql.Int, aProId)
        .query('DELETE FROM dbo.PerfilesItems WHERE PerfilID = @Perfil AND ProIdProducto = @A');
    const r = await req(cx).input('Perfil', sql.Int, perfil).input('De', sql.Int, deProId).input('A', sql.Int, aProId)
        .input('Cod', sql.NVarChar(100), String(aCodArticulo || aProId).trim()).query(`
            INSERT INTO dbo.PerfilesItems (PerfilID, ProIdProducto, CodArticulo, CodGrupo, TipoRegla, Valor, MonIdMoneda, Moneda, CantidadMinima)
            SELECT PerfilID, @A, @Cod, CodGrupo, TipoRegla, Valor, MonIdMoneda, Moneda, CantidadMinima
            FROM dbo.PerfilesItems WHERE PerfilID = @Perfil AND ProIdProducto = @De
            ORDER BY CantidadMinima`);
    await registrarCambioPerfil(cx, { perfilId: perfil, origen: 'ESCALAS', user: null, antes, proId: aProId });
    return r.rowsAffected[0] || 0;
}

// Precio c/u de catálogo para esa cantidad: { precio, desde (escala que aplica o null) }
function precioPara(precioLista, escalas, cantidad) {
    const base = Number(precioLista);
    if (!(base > 0) || !escalas?.filas?.length) return { precio: base > 0 ? base : null, desde: null };
    const q = Number(cantidad) || 0;
    const f = [...escalas.filas].sort((a, b) => b.desde - a.desde).find(x => x.desde <= q);
    if (!f) return { precio: base, desde: null };
    const precio = escalas.tipo === 'percentage_discount' ? base * (1 - f.valor / 100)
        : (f.valor > 0 && f.valor < base ? f.valor : base);
    return { precio: Math.round(precio * 100) / 100, desde: precio < base ? f.desde : null };
}

module.exports = { TIPOS, FALTA_SQL, perfilId, deProductos, deProducto, normalizar, guardar, copiar, precioPara };
