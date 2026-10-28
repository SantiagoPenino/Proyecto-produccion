'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTO PADRE Y VARIANTES + CODIFICACIÓN NUEVA (12-oct-2026)
// docs/migrations/configurador_variantes.sql
//
//   Familia → Etiqueta → PRODUCTO PADRE → VARIANTES
//   Camisetas → Básquet → Camiseta Basket (CAM-BAS-01)
//                           ├ Cuello Redondo Costadillo Grueso (CAM-BAS-01-01)
//                           └ Cuello V Común Costadillo Fino    (CAM-BAS-01-02)
//
// La VARIANTE es un artículo más: apunta a su padre (ProductoVentaConfig.PadreProIdProducto) y a un modelo del
// molde del padre (ModeloClave). Nace como COPIA del padre (técnicas, telas, apliques, accesorios, ficha, avíos,
// costuras, foto, precio y escalas de precio) y se edita en el mismo editor, como cualquier artículo. Reglas:
//   · el molde, el modelo, la producción principal, el origen y la medida son los del padre: no se cambian;
//   · las técnicas, sus opciones (tamaños), las telas y los accesorios solo pueden ser de los que tiene el padre;
//     si el padre deja de tener algo, se les saca también a sus variantes.
//   · [27/10] un modelo puede tener VARIAS variantes: «Copiar» en una variante da otra del mismo padre y modelo
//     (otra tela, otro precio…), sin precio y en borrador (configuradorController.copiarProducto).
//
// CÓDIGOS: <FAMILIA>-<ETIQUETA>-NN (CAM-BAS-01); sin etiqueta <FAMILIA>-NN; combos CMB-NN;
// variante = código del padre + -NN (CAM-BAS-01-02). Abreviatura = 3 primeras letras sin tildes.
// ─────────────────────────────────────────────────────────────────────────────
const { sql } = require('../config/db');
const escalasSvc = require('./escalasProducto');   // [ESCALAS 27/10] la variante nace con las escalas del padre

const NOMBRE_AREA = { SB: 'Sublimación', TWC: 'Corte', TWT: 'Costura', EMB: 'Bordado', DF: 'Estampado DTF', TPU: 'Estampado TPU', DIRECTA: 'Impresión directa', ECOUV: 'EcoUV' };
// Lo que una variante no cambia (es del padre): se saca de lo que manda el editor
const CAMPOS_DEL_PADRE = ['tizadaProMoldeRef', 'modelos', 'tecnicaPrincipal', 'molde', 'um', 'anchoM', 'altoM', 'bordeCm', 'origenTipo', 'origenProIdProducto', 'surtido', 'comboItems', 'validarStock'];

let _tiene = false;
async function tieneVariantes(cx) {
    if (_tiene) return true;
    const r = await req(cx).query(`SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'PadreProIdProducto') AS p,
                                          COL_LENGTH('dbo.ProductoVentaConfig', 'ModeloClave') AS m`);
    _tiene = r.recordset[0].p != null && r.recordset[0].m != null;
    return _tiene;
}
const FALTA_SQL = 'Falta correr docs/migrations/configurador_variantes.sql en esta base.';

// [COPIAR VARIANTE 27/10] Varias variantes del MISMO modelo (otra tela, otro precio): hace falta
// configurador_variantes_copias.sql, que saca el índice único padre + modelo. Sin él, la copia choca con ese índice.
let _copias = false;
async function admiteCopias(cx) {
    if (_copias) return true;
    const r = await req(cx).query(`SELECT COUNT(*) AS n FROM sys.indexes
                                   WHERE name = 'UQ_ProductoVentaConfig_PadreModelo' AND object_id = OBJECT_ID('dbo.ProductoVentaConfig')`);
    _copias = r.recordset[0].n === 0;
    return _copias;
}
const FALTA_SQL_COPIAS = 'Para copiar una variante falta correr docs/migrations/configurador_variantes_copias.sql en esta base (permite varias variantes del mismo modelo).';
const fallo = (status, msg) => Object.assign(new Error(msg), { status });
// Pedido nuevo de mssql: sirve igual con un pool o con una transacción
function req(cx) { return new sql.Request(cx); }
const lista = (ids) => ids.map(Number).filter(n => Number.isInteger(n)).join(',') || 'NULL';

// ── Códigos ─────────────────────────────────────────────────────────────────
const abreviar = (texto, n = 3) => {
    const limpio = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim();
    const palabra = limpio.split(/\s+/).find(w => /[A-Z]/.test(w)) || '';
    return palabra.slice(0, n);
};

async function codigoLibre(cx, cod) {
    const r = await req(cx).input('Cod', sql.VarChar(20), cod).query(`
        SELECT TOP 1 1 AS x FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) = @Cod
        UNION ALL SELECT TOP 1 1 FROM dbo.PreciosBase WHERE LTRIM(RTRIM(CodArticulo)) = @Cod`);
    return !r.recordset.length;
}

// Siguiente número libre de un prefijo: CAM-BAS- → CAM-BAS-01, -02… (mira artículos y precios)
async function siguienteDePrefijo(cx, prefijo, digitos = 2) {
    const esc = prefijo.replace(/[[%_]/g, (c) => `[${c}]`);
    const r = await req(cx).input('Pref', sql.VarChar(30), `${esc}%`).query(`
        SELECT LTRIM(RTRIM(CodArticulo)) AS Cod FROM dbo.Articulos WHERE CodArticulo LIKE @Pref
        UNION SELECT LTRIM(RTRIM(CodArticulo)) FROM dbo.PreciosBase WHERE CodArticulo LIKE @Pref`);
    const patron = new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
    let n = r.recordset.reduce((mx, x) => { const k = patron.exec(x.Cod || ''); return k ? Math.max(mx, Number(k[1])) : mx; }, 0) + 1;
    for (;;) {   // por si hay un hueco ocupado con otro formato
        const cod = `${prefijo}${String(n).padStart(digitos, '0')}`;
        if (cod.length > 20) throw fallo(400, `El código ${cod} pasa de 20 caracteres.`);
        if (await codigoLibre(cx, cod)) return cod;
        n++;
    }
}

// Prefijo de un producto según su familia (StockArt) y su etiqueta. Combo → CMB.
async function prefijoProducto(cx, { codStock, etiquetaId, esCombo }) {
    if (esCombo) return 'CMB-';
    let fam = '';
    if (codStock) {
        const f = await req(cx).input('CS', sql.VarChar(50), String(codStock).trim())
            .query('SELECT TOP 1 LTRIM(RTRIM(Articulo)) AS n FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = @CS');
        fam = abreviar(f.recordset[0]?.n);
    }
    let etq = '';
    if (etiquetaId) {
        const e = await req(cx).input('E', sql.Int, Number(etiquetaId))
            .query('SELECT TOP 1 Nombre AS n FROM dbo.ProductoEtiqueta WHERE EtiquetaID = @E');
        etq = abreviar(e.recordset[0]?.n);
    }
    return `${fam || 'PRD'}-${etq ? `${etq}-` : ''}`;
}
const codigoNuevoProducto = async (cx, datos) => siguienteDePrefijo(cx, await prefijoProducto(cx, datos));
const codigoNuevaVariante = async (cx, codPadre) => siguienteDePrefijo(cx, `${String(codPadre).trim()}-`);

// Código sugerido para un producto que ya existe (su familia y etiqueta actuales; variante: el del padre + NN)
async function codigoSugerido(cx, proId) {
    const conVar = await tieneVariantes(cx);
    const a = (await req(cx).input('PID', sql.Int, proId).query(`
        SELECT LTRIM(RTRIM(a.CodArticulo)) AS Cod, LTRIM(RTRIM(a.CodStock)) AS CodStock,
               ${conVar ? 'vc.PadreProIdProducto,' : 'CAST(NULL AS INT) AS PadreProIdProducto,'}
               CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'EtiquetaID') IS NULL THEN NULL ELSE vc.EtiquetaID END AS EtiquetaID,
               ISNULL(vc.EsCombo, 0) AS EsCombo
        FROM dbo.Articulos a LEFT JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
        WHERE a.ProIdProducto = @PID`)).recordset[0];
    if (!a) throw fallo(404, 'Producto no encontrado.');
    const sigue = (pref) => a.Cod.startsWith(pref) && /^\d+$/.test(a.Cod.slice(pref.length));
    if (a.PadreProIdProducto) {
        const p = (await req(cx).input('P', sql.Int, a.PadreProIdProducto).query('SELECT LTRIM(RTRIM(CodArticulo)) AS Cod FROM dbo.Articulos WHERE ProIdProducto = @P')).recordset[0];
        return sigue(`${p.Cod}-`) ? a.Cod : codigoNuevaVariante(cx, p.Cod);
    }
    const pref = await prefijoProducto(cx, { codStock: a.CodStock, etiquetaId: a.EtiquetaID, esCombo: !!a.EsCombo });
    return sigue(pref) ? a.Cod : siguienteDePrefijo(cx, pref);
}

// ── Datos ───────────────────────────────────────────────────────────────────
async function padreDe(cx, proId) {
    if (!(await tieneVariantes(cx))) return null;
    const r = await req(cx).input('PID', sql.Int, proId).query('SELECT PadreProIdProducto AS p FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @PID');
    return r.recordset[0]?.p || null;
}

// Lo que el padre permite: técnicas (con su modo), opciones, telas y accesorios.
// Una consulta detrás de otra (no Promise.all): se usa dentro de transacciones y una transacción de mssql
// no admite dos pedidos a la vez (EREQINPROG, y después tampoco puede deshacerse).
async function permitidoPor(cx, padreId) {
    const tec = await req(cx).input('P', sql.Int, padreId).query('SELECT AreaID, Modo FROM dbo.ProductoTerminadoServicios WHERE ProIdProducto = @P');
    const opc = await req(cx).input('P', sql.Int, padreId).query(`SELECT pto.TecnicaOpcionID AS id, t.AreaID FROM dbo.ProductoTecnicaOpciones pto JOIN dbo.TecnicaOpciones t ON t.TecnicaOpcionID = pto.TecnicaOpcionID WHERE pto.ProIdProducto = @P`);
    const hay = (await req(cx).query("SELECT OBJECT_ID('dbo.ProductoTelas', 'U') AS t, OBJECT_ID('dbo.ProductoAccesorios', 'U') AS a")).recordset[0];
    const tel = hay.t ? await req(cx).input('P', sql.Int, padreId).query('SELECT TelaProIdProducto AS id FROM dbo.ProductoTelas WHERE ProIdProducto = @P') : { recordset: [] };
    const acc = hay.a ? await req(cx).input('P', sql.Int, padreId).query('SELECT ItemProIdProducto AS id, WmsVarianteId AS varId FROM dbo.ProductoAccesorios WHERE ProIdProducto = @P') : { recordset: [] };
    return {
        tecnicas: tec.recordset.map(t => ({ areaId: t.AreaID, modo: t.Modo || 'LIBRE' })),
        opciones: opc.recordset.map(o => o.id),
        telas: tel.recordset.map(t => t.id),
        accesorios: acc.recordset.filter(a => a.id != null).map(a => a.id),
        // [ACCESORIOS SOLO STOCK] los del padre sin artículo, por su variante del WMS
        accesoriosStock: acc.recordset.filter(a => a.id == null && a.varId != null).map(a => a.varId),
    };
}

// A la ficha de un producto le agrega: si es variante, de quién y qué permite el padre; si es padre, cuántas tiene.
async function datosParaFicha(cx, data) {
    if (!(await tieneVariantes(cx))) return data;
    const cfg = data.config || {};
    if (!cfg.PadreProIdProducto) {
        const n = (await req(cx).input('P', sql.Int, data.ProIdProducto).query('SELECT COUNT(*) AS n FROM dbo.ProductoVentaConfig WHERE PadreProIdProducto = @P')).recordset[0].n;
        return { ...data, cantidadVariantes: n };
    }
    const p = (await req(cx).input('P', sql.Int, cfg.PadreProIdProducto).input('C', sql.NVarChar(96), cfg.ModeloClave || '').query(`
        SELECT LTRIM(RTRIM(a.CodArticulo)) AS Cod, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
               (SELECT TOP 1 ModeloNombre FROM dbo.ProductoModelos m WHERE m.ProIdProducto = a.ProIdProducto AND m.ModeloClave = @C) AS ModeloNombre
        FROM dbo.Articulos a WHERE a.ProIdProducto = @P`)).recordset[0] || {};
    const fotoPadre = data.Imagen ? null : (await req(cx).input('P', sql.Int, cfg.PadreProIdProducto)
        .query('SELECT TOP 1 url_imagen AS u FROM dbo.Articulos_Imagenes WHERE Idproid = @P ORDER BY orden')).recordset[0]?.u || null;
    return {
        ...data,
        ...(fotoPadre ? { Imagen: fotoPadre, ImagenDelPadre: true } : {}),
        variante: {
            padre: { proId: cfg.PadreProIdProducto, codArticulo: p.Cod || null, descripcion: p.Descripcion || null },
            modeloClave: cfg.ModeloClave, modeloNombre: p.ModeloNombre || null,
            permitido: await permitidoPor(cx, cfg.PadreProIdProducto),
        },
    };
}

// Variantes de un padre (resumen) + modelos que se venden y todavía no tienen variante.
async function variantesDe(cx, padreId) {
    if (!(await tieneVariantes(cx))) throw fallo(409, FALTA_SQL);
    const padre = (await req(cx).input('P', sql.Int, padreId).query(`
        SELECT a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
               vc.TizadaProMoldeRef, vc.PadreProIdProducto
        FROM dbo.Articulos a LEFT JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
        WHERE a.ProIdProducto = @P`)).recordset[0];
    if (!padre) throw fallo(404, 'Producto no encontrado.');
    const [modelos, vars] = await Promise.all([
        req(cx).input('P', sql.Int, padreId).query('SELECT ModeloClave, ModeloNombre FROM dbo.ProductoModelos WHERE ProIdProducto = @P ORDER BY ISNULL(Orden, 999), ID'),
        req(cx).input('P', sql.Int, padreId).query(`
            SELECT a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
                   vc.ModeloClave, vc.Estado, pb.Precio, pb.Moneda
            FROM dbo.ProductoVentaConfig vc JOIN dbo.Articulos a ON a.ProIdProducto = vc.ProIdProducto
            OUTER APPLY (SELECT TOP 1 Precio, Moneda FROM dbo.PreciosBase p WHERE p.ProIdProducto = a.ProIdProducto ORDER BY p.UltimaActualizacion DESC) pb
            WHERE vc.PadreProIdProducto = @P ORDER BY a.CodArticulo`),
    ]);
    const variantes = vars.recordset.map(v => {
        const m = modelos.recordset.find(x => x.ModeloClave === v.ModeloClave);
        return {
            proId: v.ProIdProducto, codArticulo: v.CodArticulo, descripcion: v.Descripcion, estado: v.Estado || 'BORRADOR',
            modeloClave: v.ModeloClave, modeloNombre: m?.ModeloNombre || null, modeloOfrecido: !!m, precio: v.Precio, moneda: v.Moneda,
        };
    });
    const conVariante = new Set(variantes.map(v => v.modeloClave));
    return {
        padre: { proId: padre.ProIdProducto, codArticulo: padre.CodArticulo, descripcion: padre.Descripcion, moldeRef: padre.TizadaProMoldeRef || null, esVariante: !!padre.PadreProIdProducto },
        variantes,
        modelosSinVariante: modelos.recordset.filter(m => !conVariante.has(m.ModeloClave)).map(m => ({ modeloClave: m.ModeloClave, modeloNombre: m.ModeloNombre })),
    };
}

const precioDe = async (cx, proId) => (await req(cx).input('P', sql.Int, proId).query('SELECT TOP 1 Precio, Moneda FROM dbo.PreciosBase WHERE ProIdProducto = @P ORDER BY UltimaActualizacion DESC')).recordset[0] || null;

// Copia del padre a la variante (configuración, ficha, listas, su modelo y, si se pide, las fotos). La variante
// tiene que estar vacía de todo eso (recién creada, o vaciada por recopiar). estado: null = el del padre.
async function copiarDelPadre(tx, h, { padreId, varId, clave, codPadre, codVariante, estado, fotos }) {
    // Configuración: la del padre, marcada como variante de ese modelo
    await h.copiarFilas(tx, 'ProductoVentaConfig', 'ProIdProducto', padreId, varId,
        { PadreProIdProducto: '@Padre', ModeloClave: '@Modelo', FechaRegistro: 'GETDATE()', FechaModif: 'GETDATE()', ...(estado ? { Estado: '@EstadoVar' } : {}) },
        [['Padre', sql.Int, padreId], ['Modelo', sql.NVarChar(96), clave], ...(estado ? [['EstadoVar', sql.VarChar(12), estado]] : [])]);
    // Ficha de diseño (la referencia pasa a ser el código de la variante si era la del padre)
    await h.copiarFilas(tx, 'ProductoFichaDiseno', 'ProIdProducto', padreId, varId,
        { Ref: 'CASE WHEN LTRIM(RTRIM([Ref])) = @CodOrig OR [Ref] IS NULL THEN @CodNuevo ELSE [Ref] END', FechaRegistro: 'GETDATE()', FechaModif: 'GETDATE()' },
        [['CodOrig', sql.VarChar(50), codPadre], ['CodNuevo', sql.VarChar(50), codVariante]]);
    // Listas (técnicas, opciones, telas, avíos, apliques, accesorios, costuras…). Modelos: solo el suyo.
    for (const tabla of h.TABLAS_COPIA) if (tabla !== 'ProductoModelos') await h.copiarFilas(tx, tabla, 'ProIdProducto', padreId, varId);
    await req(tx).input('V', sql.Int, varId).input('P', sql.Int, padreId).input('C', sql.NVarChar(96), clave).query(`
        INSERT INTO dbo.ProductoModelos (ProIdProducto, ModeloClave, ModeloNombre, EsDefault, Orden)
        SELECT @V, ModeloClave, ModeloNombre, 1, 1 FROM dbo.ProductoModelos WHERE ProIdProducto = @P AND ModeloClave = @C`);
    // Fotos (los mismos archivos)
    if (fotos) await h.copiarFilas(tx, 'Articulos_Imagenes', 'Idproid', padreId, varId);
    // [ESCALAS 27/10] Los precios por cantidad del padre (reemplazan los suyos; después se cambian en «Precios»)
    await escalasSvc.copiar(tx, padreId, varId, codVariante);
}

// ── Crear una variante: COPIA del padre para un modelo ───────────────────────
// h = herramientas de copia del configurador { copiarFilas, columnasCopiables, TABLAS_COPIA, upsertPrecioBase }
async function crearVariante(pool, user, padreId, modeloClave, h) {
    if (!(await tieneVariantes(pool))) throw fallo(409, FALTA_SQL);
    const clave = String(modeloClave || '').trim();
    if (!clave) throw fallo(400, 'Elegí el modelo.');
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let res;
    let precioPadre = null;
    try {
        const p = (await req(tx).input('P', sql.Int, padreId).query(`
            SELECT a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS Cod, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
                   vc.PadreProIdProducto, vc.TizadaProMoldeRef, ISNULL(vc.EsCombo, 0) AS EsCombo
            FROM dbo.Articulos a JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
            WHERE a.ProIdProducto = @P AND ISNULL(a.borrar, 0) = 0`)).recordset[0];
        if (!p) throw fallo(404, 'Producto no encontrado.');
        if (p.PadreProIdProducto) throw fallo(409, 'Este producto ya es una variante: las variantes se crean desde el producto padre.');
        if (p.EsCombo) throw fallo(409, 'Un combo no tiene variantes de molde.');
        if (!p.TizadaProMoldeRef) throw fallo(409, 'El producto no tiene molde vinculado: vinculalo en "Molde, telas y apliques" y marcá los modelos que se venden.');
        const m = (await req(tx).input('P', sql.Int, padreId).input('C', sql.NVarChar(96), clave)
            .query('SELECT ModeloNombre FROM dbo.ProductoModelos WHERE ProIdProducto = @P AND ModeloClave = @C')).recordset[0];
        if (!m) throw fallo(409, 'Ese modelo no está entre los "Modelos que se venden" del producto: marcalo y guardá primero.');
        const ya = (await req(tx).input('P', sql.Int, padreId).input('C', sql.NVarChar(96), clave).query(`
            SELECT LTRIM(RTRIM(a.CodArticulo)) AS Cod FROM dbo.ProductoVentaConfig vc JOIN dbo.Articulos a ON a.ProIdProducto = vc.ProIdProducto
            WHERE vc.PadreProIdProducto = @P AND vc.ModeloClave = @C`)).recordset[0];
        if (ya) throw fallo(409, `Ese modelo ya tiene su variante (${ya.Cod}). Para otra del mismo modelo (otra tela, otro precio), abrí ${ya.Cod} y tocá «Copiar».`);

        const cod = await codigoNuevaVariante(tx, p.Cod);
        const nombre = `${p.Descripcion} · ${m.ModeloNombre || clave}`.slice(0, 100);
        // 1. Artículo: mismas columnas de clasificación que el padre
        const { cols: colsArt } = await h.columnasCopiables(tx, 'Articulos');
        const usar = ['SupFlia', 'Grupo', 'CodStock', 'Mostrar', 'anchoimprimible', 'LLEVAPAPEL', 'MonIdMoneda', 'UniIdUnidad', 'largoimprimible'].filter(c => colsArt.includes(c));
        const ins = await req(tx).input('P', sql.Int, padreId).input('Desc', sql.VarChar(100), nombre).input('Cod', sql.VarChar(20), cod).query(`
            INSERT INTO dbo.Articulos (CodArticulo, IDProdReact, Descripcion, borrar${usar.map(c => `, [${c}]`).join('')})
            OUTPUT INSERTED.ProIdProducto
            SELECT @Cod, NULL, @Desc, 0${usar.map(c => `, [${c}]`).join('')} FROM dbo.Articulos WHERE ProIdProducto = @P`);
        const varId = ins.recordset[0].ProIdProducto;
        await req(tx).input('V', sql.Int, varId).query('UPDATE dbo.Articulos SET IDProdReact = ProIdProducto WHERE ProIdProducto = @V');
        await copiarDelPadre(tx, h, { padreId, varId, clave, codPadre: p.Cod, codVariante: cod, estado: null, fotos: true });
        precioPadre = await precioDe(tx, padreId);
        await tx.commit();
        res = { proId: varId, codArticulo: cod, descripcion: nombre, modeloClave: clave };
    } catch (e) {
        try { await tx.rollback(); } catch (_) { /* ya cerrada */ }
        throw e;
    }
    // 6. Precio: el mismo del padre, con el código de la variante
    if (precioPadre && precioPadre.Precio != null) await h.upsertPrecioBase(pool, res.codArticulo, Number(precioPadre.Precio), String(precioPadre.Moneda || 'UYU').trim());
    return res;
}

// ── Copiar de nuevo todo del padre ──────────────────────────────────────────
// La variante vuelve a quedar igual al padre: configuración, ficha, técnicas, telas, apliques, accesorios, avíos,
// costuras, precio y escalas de precio. Se quedan su nombre, su código, su estado y su foto (si no tiene, toma la del padre).
async function recopiarDelPadre(pool, user, varId, h) {
    if (!(await tieneVariantes(pool))) throw fallo(409, FALTA_SQL);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let v;
    let precioPadre;
    try {
        v = (await req(tx).input('V', sql.Int, varId).query(`
            SELECT vc.PadreProIdProducto AS Padre, vc.ModeloClave, vc.Estado, LTRIM(RTRIM(a.CodArticulo)) AS Cod,
                   (SELECT LTRIM(RTRIM(CodArticulo)) FROM dbo.Articulos WHERE ProIdProducto = vc.PadreProIdProducto) AS CodPadre,
                   (SELECT COUNT(*) FROM dbo.Articulos_Imagenes i WHERE i.Idproid = a.ProIdProducto) AS Fotos
            FROM dbo.ProductoVentaConfig vc JOIN dbo.Articulos a ON a.ProIdProducto = vc.ProIdProducto WHERE vc.ProIdProducto = @V`)).recordset[0];
        if (!v) throw fallo(404, 'Variante no encontrada.');
        if (!v.Padre) throw fallo(409, 'Este producto no es una variante.');
        // Vaciar lo copiable de la variante (los hijos antes que la configuración)
        for (const tabla of [...h.TABLAS_COPIA].reverse()) {
            const hay = (await req(tx).input('T', sql.NVarChar(260), `dbo.${tabla}`).query("SELECT OBJECT_ID(@T, 'U') AS o")).recordset[0].o;
            if (hay) await req(tx).input('V', sql.Int, varId).query(`DELETE FROM dbo.[${tabla}] WHERE ProIdProducto = @V`);
        }
        await req(tx).input('V', sql.Int, varId).query('DELETE FROM dbo.ProductoFichaDiseno WHERE ProIdProducto = @V');
        await req(tx).input('V', sql.Int, varId).query('DELETE FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @V');
        await copiarDelPadre(tx, h, { padreId: v.Padre, varId, clave: v.ModeloClave, codPadre: v.CodPadre, codVariante: v.Cod, estado: v.Estado || 'BORRADOR', fotos: !v.Fotos });
        precioPadre = await precioDe(tx, v.Padre);
        await tx.commit();
    } catch (e) {
        try { await tx.rollback(); } catch (_) { /* ya cerrada */ }
        throw e;
    }
    if (precioPadre && precioPadre.Precio != null) await h.upsertPrecioBase(pool, v.Cod, Number(precioPadre.Precio), String(precioPadre.Moneda || 'UYU').trim());
    return { proId: varId, codArticulo: v.Cod };
}

// ── Guardar una variante (mismo PUT que cualquier producto) ─────────────────
// Saca lo que es del padre y controla que técnicas, opciones, telas y accesorios sean de los que el padre tiene.
async function prepararGuardarVariante(cx, varId, padreId, body) {
    const b = { ...body };
    CAMPOS_DEL_PADRE.forEach(k => delete b[k]);
    const per = await permitidoPor(cx, padreId);
    const modo = new Map(per.tecnicas.map(t => [t.areaId, t.modo]));
    if (b.tecnicas !== undefined) {
        const fuera = (b.tecnicas || []).filter(t => !modo.has(t.areaId));
        if (fuera.length) throw fallo(400, `${fuera.map(t => NOMBRE_AREA[t.areaId] || t.areaId).join(', ')}: el producto padre no lo tiene, así que la variante tampoco puede. Activalo primero en el padre.`);
    }
    if (b.opcionesPermitidas !== undefined) {
        const ids = (b.opcionesPermitidas || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (ids.length) {
            const areas = (await req(cx).query(`SELECT TecnicaOpcionID AS id, AreaID FROM dbo.TecnicaOpciones WHERE TecnicaOpcionID IN (${lista(ids)})`)).recordset;
            const delPadre = new Set(per.opciones);
            if (areas.some(o => (modo.get(o.AreaID) || 'LIBRE') !== 'LIBRE' && !delPadre.has(o.id))) throw fallo(400, 'Hay opciones de técnica (tamaños) que el padre no ofrece: la variante solo puede elegir entre las del padre.');
        }
    }
    if (b.telas !== undefined) {
        const delPadre = new Set(per.telas);
        if ((b.telas || []).some(t => !delPadre.has(Number(t.telaProIdProducto ?? t)))) throw fallo(400, 'La variante solo puede ofrecer telas que ofrece el padre.');
    }
    if (b.accesorios !== undefined) {
        const delPadre = new Set(per.accesorios);
        const delPadreStock = new Set(per.accesoriosStock);
        const esDelPadre = (a) => (Number(a.itemProIdProducto) > 0 ? delPadre.has(Number(a.itemProIdProducto)) : delPadreStock.has(Number(a.wmsVarianteId)));
        if ((b.accesorios || []).some(a => !esDelPadre(a))) throw fallo(400, 'La variante solo puede llevar accesorios que lleva el padre.');
    }
    return b;
}

// ── Guardar el padre ────────────────────────────────────────────────────────
// Antes: no se puede sacar un modelo que tiene variante ni cambiar el molde con variantes.
async function validarGuardarPadre(cx, proId, body) {
    if (!(await tieneVariantes(cx))) return;
    const vars = (await req(cx).input('P', sql.Int, proId).query(`
        SELECT vc.ModeloClave, LTRIM(RTRIM(a.CodArticulo)) AS Cod FROM dbo.ProductoVentaConfig vc
        JOIN dbo.Articulos a ON a.ProIdProducto = vc.ProIdProducto WHERE vc.PadreProIdProducto = @P`)).recordset;
    if (!vars.length) return;
    if (body.tizadaProMoldeRef !== undefined) {
        const act = (await req(cx).input('P', sql.Int, proId).query('SELECT TizadaProMoldeRef AS m FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @P')).recordset[0]?.m || null;
        const nuevo = body.tizadaProMoldeRef ? String(body.tizadaProMoldeRef).trim() : null;
        if ((act || null) !== nuevo) throw fallo(409, `No se puede cambiar el molde: el producto tiene ${vars.length} variante(s) (${vars.map(x => x.Cod).join(', ')}) que son modelos de ese molde. Borralas primero.`);
    }
    if (body.modelos !== undefined) {
        const quedan = new Set((body.modelos || []).map(m => String(m.clave ?? m.modeloClave ?? '').trim()));
        const sacados = vars.filter(x => !quedan.has(x.ModeloClave));
        if (sacados.length) throw fallo(409, `No se puede dejar de vender ${sacados.length === 1 ? 'ese modelo' : 'esos modelos'}: ${sacados.length === 1 ? 'tiene su variante' : 'tienen sus variantes'} (${sacados.map(x => x.Cod).join(', ')}). Borrá la variante primero.`);
    }
}

// Después de guardar el padre (en la misma transacción): lo que el padre ya no tiene se les saca a sus variantes
// (técnicas, opciones, telas, accesorios y apliques de técnicas que ya no están). Devuelve qué se sacó.
async function podarVariantes(tx, padreId) {
    if (!(await tieneVariantes(tx))) return [];
    const vars = (await req(tx).input('P', sql.Int, padreId).query(`
        SELECT vc.ProIdProducto AS id, LTRIM(RTRIM(a.CodArticulo)) AS Cod FROM dbo.ProductoVentaConfig vc
        JOIN dbo.Articulos a ON a.ProIdProducto = vc.ProIdProducto WHERE vc.PadreProIdProducto = @P`)).recordset;
    if (!vars.length) return [];
    const ids = lista(vars.map(v => v.id));
    const per = await permitidoPor(tx, padreId);
    const areas = per.tecnicas.map(t => `'${t.areaId}'`).join(',') || "''";
    const restringidas = per.tecnicas.filter(t => t.modo !== 'LIBRE').map(t => `'${t.areaId}'`).join(',') || "''";
    const hecho = [];
    const borrar = async (texto, sqlTxt) => { const r = await req(tx).query(sqlTxt); const n = r.rowsAffected.reduce((a, x) => a + x, 0); if (n) hecho.push(`${texto} (${n})`); };
    await borrar('técnicas', `DELETE FROM dbo.ProductoTerminadoServicios WHERE ProIdProducto IN (${ids}) AND AreaID NOT IN (${areas})`);
    await borrar('apliques', `DELETE FROM dbo.ProductoApliques WHERE ProIdProducto IN (${ids}) AND AreaID <> 'ETIQUETA' AND AreaID NOT IN (${areas})`);
    await borrar('opciones de técnicas', `DELETE pto FROM dbo.ProductoTecnicaOpciones pto JOIN dbo.TecnicaOpciones t ON t.TecnicaOpcionID = pto.TecnicaOpcionID
        WHERE pto.ProIdProducto IN (${ids}) AND (t.AreaID NOT IN (${areas}) OR (t.AreaID IN (${restringidas}) AND pto.TecnicaOpcionID NOT IN (${lista(per.opciones)})))`);
    await borrar('telas', `DELETE FROM dbo.ProductoTelas WHERE ProIdProducto IN (${ids}) AND TelaProIdProducto NOT IN (${lista(per.telas)})`);
    if ((await req(tx).query("SELECT OBJECT_ID('dbo.ProductoAccesorios', 'U') AS t")).recordset[0].t) {
        await borrar('accesorios', `DELETE FROM dbo.ProductoAccesorios WHERE ProIdProducto IN (${ids})
            AND ((ItemProIdProducto IS NOT NULL AND ItemProIdProducto NOT IN (${lista(per.accesorios)}))
              OR (ItemProIdProducto IS NULL AND ISNULL(WmsVarianteId, 0) NOT IN (${lista(per.accesoriosStock)})))`);
    }
    return hecho;
}

module.exports = {
    NOMBRE_AREA, FALTA_SQL, FALTA_SQL_COPIAS, tieneVariantes, admiteCopias, abreviar,
    codigoNuevoProducto, codigoNuevaVariante, codigoSugerido, siguienteDePrefijo,
    padreDe, permitidoPor, datosParaFicha, variantesDe, crearVariante, recopiarDelPadre, prepararGuardarVariante, validarGuardarPadre, podarVariantes,
};
