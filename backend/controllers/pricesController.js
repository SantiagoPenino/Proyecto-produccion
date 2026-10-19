const { getPool, sql } = require('../config/db');
const PricingService = require('../services/pricingService');
const logger = require('../utils/logger');

// Obtener Precios Base (Lista Pagina o Filtrada)
// Obtener Precios Base (Lista Pagina o Filtrada)
const getBasePrices = async (req, res) => {
    try {
        const pool = await getPool();
        // Los flags de listas viven en Articulos (26/08) — garantizar que existan las columnas
        try { await require('./tiendaController').ensureTiendaSchema(pool); } catch (e) { /* best effort */ }
        // Usamos LEFT JOIN con Articulos para mostrar Descripción si existe
        // PRECIO MULTI-MONEDA: Si un artículo tiene 2 precios, aparecerá 2 veces (deseado)
        const result = await pool.request().query(`
            SELECT LTRIM(RTRIM(A.CodArticulo)) as CodArticulo, A.Descripcion, A.SupFlia, A.Grupo,
                   LTRIM(RTRIM(SA.Articulo)) as GrupoNombre,
                   MAP.NombreReferencia as NombreReferenciaGrupo,
                   -- [19/10] El área del grupo: Precios Estándar la usa para saber qué artículos se
                   -- cobran por puntadas (Bordado) y no por este precio
                   LTRIM(RTRIM(MAP.AreaID_Interno)) as AreaGrupo,
                   PB.ID, PB.Precio, CASE WHEN PB.MonIdMoneda = 1 THEN 'UYU' ELSE 'USD' END AS Moneda, PB.MonIdMoneda,
                   A.ProIdProducto, A.Mostrar,
                   -- [28/08] El portal descarta los borrados (ver /api/precios-publicos).
                   -- Sin este dato la pantalla mostraba el toggle en verde para artículos
                   -- que nunca iban a salir en la lista.
                   ISNULL(A.borrar, 0) AS Borrado,
                   ISNULL(A.EnListaPrecios, 1) AS EnListaPrecios,
                   ISNULL(A.EnListaPublica, 1) AS EnListaPublica,
                   -- [27/08] Texto de la columna "Descripción" de las listas de precios
                   -- (portal y landing). Se edita acá mismo, en /marketing/precios.
                   A.DescripcionLista
            FROM Articulos A
            LEFT JOIN StockArt SA ON A.CodStock = SA.CodStock
            LEFT JOIN ConfigMapeoERP MAP ON MAP.CodigoERP = A.Grupo COLLATE Database_Default
            LEFT JOIN PreciosBase PB ON A.ProIdProducto = PB.ProIdProducto
            ORDER BY A.SupFlia, A.Grupo, A.CodArticulo, PB.MonIdMoneda
        `);
        logger.info(`getBasePrices: Found ${result.recordset.length} rows.`);
        res.json(result.recordset);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Guardar Precio Base (Individual)
const saveBasePrice = async (req, res) => {
    const { codArticulo, precio, moneda, proIdProducto } = req.body;
    try {
        // La moneda va tal cual venga ('UYU'/'USD' o el id): el service la normaliza. Convertirla
        // acá a número era lo que rompía el endpoint — el service hacía moneda.toUpperCase().
        await PricingService.setBasePrice(codArticulo, precio, moneda, proIdProducto);
        res.json({ success: true });
    } catch (e) {
        // Sin este log el 500 no dejaba NADA en el servidor y había que reproducirlo para verlo.
        logger.error(`Error saveBasePrice (art=${codArticulo} prod=${proIdProducto} ${moneda}):`, e);
        res.status(500).json({ error: e.message });
    }
};

// PUT /prices/lista-flags — visibilidad del PRODUCTO en las dos listas de precios
// (Articulos.EnListaPrecios = portal de clientes / EnListaPublica = landing). Los usa
// /marketing/precios; /marketing/productos escribe los mismos flags vía la vitrina.
const saveListFlags = async (req, res) => {
    const { proIdProducto, EnListaPrecios, EnListaPublica } = req.body || {};
    const id = parseInt(proIdProducto, 10);
    if (!id) return res.status(400).json({ error: 'Falta proIdProducto' });
    try {
        const pool = await getPool();
        try { await require('./tiendaController').ensureTiendaSchema(pool); } catch (e) { /* best effort */ }
        await pool.request()
            .input('Id', sql.Int, id)
            .input('Cli', sql.Bit, EnListaPrecios ? 1 : 0)
            .input('Pub', sql.Bit, EnListaPublica ? 1 : 0)
            .query('UPDATE dbo.Articulos SET EnListaPrecios = @Cli, EnListaPublica = @Pub WHERE ProIdProducto = @Id');
        res.json({ success: true });
    } catch (e) {
        logger.error('Error saveListFlags:', e);
        res.status(500).json({ error: e.message });
    }
};

// PUT /prices/descripcion-lista — texto que acompaña al producto en las DOS listas de
// precios (columna "Descripción" del portal y de la landing). Vive en Articulos, igual
// criterio que los flags de arriba: es propiedad del producto. Vacío = NULL (guion).
const saveDescripcionLista = async (req, res) => {
    const { proIdProducto, descripcion } = req.body || {};
    const id = parseInt(proIdProducto, 10);
    if (!id) return res.status(400).json({ error: 'Falta proIdProducto' });
    try {
        const pool = await getPool();
        try { await require('./tiendaController').ensureTiendaSchema(pool); } catch (e) { /* best effort */ }
        const texto = String(descripcion || '').trim().substring(0, 500) || null;
        await pool.request()
            .input('Id', sql.Int, id)
            .input('Desc', sql.NVarChar(500), texto)
            .query('UPDATE dbo.Articulos SET DescripcionLista = @Desc WHERE ProIdProducto = @Id');
        res.json({ success: true });
    } catch (e) {
        logger.error('Error saveDescripcionLista:', e);
        res.status(500).json({ error: e.message });
    }
};

// Guardar Precios Base (Masivo)
const saveBasePricesBulk = async (req, res) => {
    const { items } = req.body; // Array de { codArticulo, precio, moneda }
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Se espera un array 'items'." });

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const item of items) {
                const request = new sql.Request(transaction);

                if (item.id) {
                    await request
                        .input('Id', sql.Int, item.id)
                        .input('Precio', sql.Decimal(18, 4), item.precio)
                        .input('MonIdMoneda', sql.Int, (item.moneda === 'USD' || item.moneda === 2) ? 2 : 1)
                        .query(`
                            UPDATE PreciosBase
                            SET Precio = @Precio, MonIdMoneda = @MonIdMoneda,
                                Moneda = CASE WHEN @MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END,
                                UltimaActualizacion = GETDATE()
                            WHERE ID = @Id
                        `);
                } else {
                    // PreciosBase ahora sólo utiliza ProIdProducto (INT) pero la tabla aún requiere CodArticulo
                    await request
                        .input('ProId', sql.Int, item.proIdProducto || null)
                        .input('CodArticulo', sql.VarChar, item.codArticulo || '')
                        .input('Precio', sql.Decimal(18, 4), item.precio)
                        .input('MonIdMoneda', sql.Int, (item.moneda === 'USD' || item.moneda === 2) ? 2 : 1)
                        .query(`
                            IF @ProId IS NOT NULL AND @ProId > 0
                            BEGIN
                                MERGE PreciosBase AS target
                                USING (SELECT @MonIdMoneda AS MonIdMoneda, @ProId AS ProIdProducto) AS source
                                ON (target.ProIdProducto = source.ProIdProducto AND target.MonIdMoneda = source.MonIdMoneda)
                                WHEN MATCHED THEN
                                    UPDATE SET Precio = @Precio, UltimaActualizacion = GETDATE()
                                WHEN NOT MATCHED THEN
                                    INSERT (ProIdProducto, CodArticulo, Precio, MonIdMoneda, Moneda, UltimaActualizacion)
                                    VALUES (@ProId, @CodArticulo, @Precio, @MonIdMoneda, CASE WHEN @MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END, GETDATE());
                            END
                        `);
                }
            }

            await transaction.commit();
            res.json({ success: true, count: items.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (e) {
        logger.error("Error saveBasePricesBulk:", e);
        res.status(500).json({ error: e.message });
    }
};

// Endpoint de prueba para CALCULAR precio (Simulador)
const calculatePriceEndpoint = async (req, res) => {
    const { codArticulo, proIdProducto, cantidad, clienteId, variables, targetCurrency, extraProfileIds, areaId, datoTecnicoValue } = req.body;
    try {
        const fallbackCurrency = targetCurrency || 'AUTO';
        // CodArticulo puede repetirse entre áreas (ej. '28' = Back pet ECOUV y Rib 1,70 SB):
        // si el caller ya sabe el ProIdProducto exacto se prioriza vía descriptor objeto.
        const prodDescriptor = proIdProducto ? { proIdProducto: parseInt(proIdProducto, 10), codArticulo } : codArticulo;
        const result = await PricingService.calculatePrice(prodDescriptor, parseFloat(cantidad) || 1, clienteId, extraProfileIds || [], variables || {}, fallbackCurrency, null, areaId, datoTecnicoValue);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Obtener Precios Escalonados (Reglas de Perfiles Activos)
const getTieredPrices = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT PI.ID, PI.PerfilID, PI.ProIdProducto, PI.CodGrupo, PI.TipoRegla, PI.Valor, 
                   CASE WHEN PI.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END as Moneda, PI.MonIdMoneda,
                   PI.CantidadMinima, PP.Nombre as NombrePerfil, PP.Categoria,
                   LTRIM(RTRIM(COALESCE(PI.CodGrupo, A.CodArticulo, CASE WHEN PI.ProIdProducto = 0 THEN 'TOTAL' WHEN PI.ProIdProducto IS NULL THEN 'TOTAL' ELSE CAST(PI.ProIdProducto AS VARCHAR) END))) as CodArticulo
            FROM PerfilesItems PI
            INNER JOIN PerfilesPrecios PP ON PI.PerfilID = PP.ID
            LEFT JOIN Articulos A ON PI.ProIdProducto = A.ProIdProducto
            WHERE PP.Activo = 1
        `);
        res.json(result.recordset);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// Guardar Precios Escalonados (Masivo)
const saveTieredPricesBulk = async (req, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Se espera un array 'items'." });

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const item of items) {
                const request = new sql.Request(transaction);
                const monIdMoneda = (item.moneda === 'USD' || item.moneda === 2 || item.Moneda === 'USD') ? 2 : 1;

                if (item.action === 'delete') {
                    if (item.id) {
                        await request
                            .input('Id', sql.Int, item.id)
                            .query("DELETE FROM PerfilesItems WHERE ID = @Id");
                    }
                } else if (item.id) {
                    // UPDATE
                    await request
                        .input('Id', sql.Int, item.id)
                        .input('TipoRegla', sql.NVarChar, item.tipoRegla)
                        .input('Valor', sql.Decimal(18, 4), item.valor)
                        .input('MonIdMoneda', sql.Int, monIdMoneda)
                        .input('CantidadMinima', sql.Int, item.cantidadMinima)
                        .query(`
                            UPDATE PerfilesItems
                            SET TipoRegla = @TipoRegla, Valor = @Valor, MonIdMoneda = @MonIdMoneda, CantidadMinima = @CantidadMinima
                            WHERE ID = @Id
                        `);
                } else {
                    // INSERT (o MERGE para evitar duplicados)
                    let finalProId = (item.proIdProducto !== undefined && item.proIdProducto !== null) ? item.proIdProducto : null;
                    let finalCodGrupo = item.codGrupo || null;
                    // CodArticulo es NOT NULL en PerfilesItems: para la fila general (TOTAL,
                    // ProIdProducto 0/NULL) no hay artículo real, así que cae a 'TOTAL'.
                    let finalCodArticulo = item.codArticulo || finalCodGrupo || 'TOTAL';

                    await request
                        .input('PerfilID', sql.Int, item.perfilId)
                        .input('ProId', sql.Int, finalProId)
                        .input('CodArticulo', sql.NVarChar, finalCodArticulo)
                        .input('CodGrupo', sql.VarChar, finalCodGrupo)
                        .input('TipoRegla', sql.NVarChar, item.tipoRegla)
                        .input('Valor', sql.Decimal(18, 4), item.valor)
                        .input('MonIdMoneda', sql.Int, monIdMoneda)
                        .input('CantidadMinima', sql.Int, item.cantidadMinima)
                        .query(`
                            MERGE PerfilesItems AS target
                            USING (SELECT @PerfilID AS PerfilID, @ProId AS ProIdProducto, @CantidadMinima AS CantidadMinima) AS source
                            ON (target.PerfilID = source.PerfilID AND ISNULL(target.ProIdProducto, 0) = ISNULL(source.ProIdProducto, 0) AND target.CantidadMinima = source.CantidadMinima)
                            WHEN MATCHED THEN
                                UPDATE SET TipoRegla = @TipoRegla, Valor = @Valor, MonIdMoneda = @MonIdMoneda
                            WHEN NOT MATCHED THEN
                                INSERT (PerfilID, ProIdProducto, CodArticulo, CodGrupo, TipoRegla, Valor, MonIdMoneda, CantidadMinima)
                                VALUES (@PerfilID, @ProId, @CodArticulo, @CodGrupo, @TipoRegla, @Valor, @MonIdMoneda, @CantidadMinima);
                        `);
                }
            }

            await transaction.commit();
            res.json({ success: true, count: items.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (e) {
        logger.error("Error saveTieredPricesBulk:", e);
        res.status(500).json({ error: e.message });
    }
};

// ─── PRECIOS POR CANTIDAD (19/10/2026) ─────────────────────────────────────────
// Vista de solo lectura /vendedores/precios-cantidad, como la planilla de precios: TODO el nomenclador
// (los artículos activos, tengan o no precio de lista) con su precio de lista y su moneda y, donde hay
// franjas de cantidad, el precio y el % de descuento de cada franja.
//   · Los precios de las franjas los calcula el MISMO motor que cotiza (pricingService.calculatePrice),
//     sin cliente: es lo que paga un cliente sin excepciones ni perfiles propios. Así la pantalla no
//     puede decir otra cosa que lo que se cobra (perfiles que compiten, % o precio fijo, reglas por
//     artículo, por grupo o TOTAL).
//   · Las franjas (columnas) son los mínimos (CantidadMinima > 1) de los perfiles globales que el
//     motor aplica al área, con su mismo criterio de Categoria (sin mirar Activo, como el motor).
//   · El área se le pasa al motor: si no, la saca de la primera orden del artículo y un artículo
//     que nunca se pidió no recibiría los descuentos del área.
//   · Bordado (por puntadas) y Estampado (por bajadas) no se cobran por la lista: van sus artículos
//     con un aviso que dice cómo se cobran.
//   · Los artículos sin área en ConfigMapeoERP (productos de la tienda, sueltos) van en "Otros": sin
//     área no les aplica ningún perfil por área.
// GET /prices/por-cantidad[?inactivos=1]             → { areas: [{ area, nombre, articulos }] } (las pestañas)
// GET /prices/por-cantidad?area=DF[&inactivos=1]     → { area, nombre, franjas, aviso, articulos: [...] }
// GET /prices/por-cantidad?area=TODAS[&inactivos=1]  → { secciones: [la de cada área, en el orden de las pestañas] }
// Las puntadas de la tabla "Tarifa por puntadas" (Precios por cantidad y el recuadro de Precios Estándar):
// de a mil hasta 10.000 y después saltos más grandes. Una sola lista para las dos pantallas.
const PUNTADAS_REFERENCIA_BORDADO = [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000, 20000, 25000, 30000];
// Las bajadas EN TOTAL (bajadas por prenda × prendas) de la tabla de estampado
const BAJADAS_REFERENCIA_ESTAMPADO = [1, 5, 9, 10, 15, 20, 30, 40, 50, 100, 200];

const AREA_OTROS = 'OTROS';
const NOMBRE_OTROS = 'Otros (sin área)';
const LIMITE_LLAMADAS_MOTOR = 6;   // cálculos del motor a la vez (cada uno hace varias consultas)

const enParalelo = async (tareas, limite) => {
    const resultados = new Array(tareas.length);
    let siguiente = 0;
    const trabajador = async () => {
        while (siguiente < tareas.length) {
            const k = siguiente++;
            resultados[k] = await tareas[k]();
        }
    };
    await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, trabajador));
    return resultados;
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const monedaDe = (id) => (id == null ? null : Number(id) === 1 ? 'UYU' : 'USD');

// Las pestañas: cada área con artículos y, al final, "Otros" si hay artículos sin área
const listarAreasPorCantidad = async (pool, inactivos) => {
    const r = await pool.request().input('Inactivos', sql.Bit, inactivos ? 1 : 0).query(`
        SELECT LTRIM(RTRIM(M.AreaID_Interno)) AS area, MAX(LTRIM(RTRIM(M.NombreReferencia))) AS nombre,
               COUNT(DISTINCT A.ProIdProducto) AS articulos
        FROM dbo.Articulos A
        JOIN dbo.ConfigMapeoERP M ON M.CodigoERP = A.Grupo COLLATE Database_Default
        WHERE ISNULL(A.borrar, 0) = 0 AND (A.Mostrar = 1 OR @Inactivos = 1)
        GROUP BY LTRIM(RTRIM(M.AreaID_Interno))
        ORDER BY nombre;

        SELECT COUNT(*) AS articulos
        FROM dbo.Articulos A
        LEFT JOIN dbo.ConfigMapeoERP M ON M.CodigoERP = A.Grupo COLLATE Database_Default
        WHERE M.CodigoERP IS NULL AND ISNULL(A.borrar, 0) = 0 AND (A.Mostrar = 1 OR @Inactivos = 1);`);
    const areas = r.recordsets[0];
    const otros = r.recordsets[1][0].articulos;
    if (otros > 0) areas.push({ area: AREA_OTROS, nombre: NOMBRE_OTROS, articulos: otros });
    return areas;
};

// La tabla de un área: sus artículos (una fila por moneda de lista; sin precio, una fila sin moneda), sus
// franjas y, en cada franja, el precio que da el motor.
const matrizDeArea = async (pool, { area, nombre, grupo }, inactivos, globales, cfg) => {
    const esOtros = area === AREA_OTROS;
    const req = pool.request().input('Inactivos', sql.Bit, inactivos ? 1 : 0);
    if (!esOtros) req.input('Area', sql.VarChar(20), area);
    const articulos = (await req.query(`
        SELECT A.ProIdProducto, LTRIM(RTRIM(A.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(A.Descripcion)) AS Descripcion,
               LTRIM(RTRIM(SA.Articulo)) AS Variante, LTRIM(RTRIM(SA.UM)) AS UM, CAST(ISNULL(A.Mostrar, 0) AS bit) AS Activo,
               PB.Precio, PB.MonIdMoneda
        FROM dbo.Articulos A
        LEFT JOIN dbo.ConfigMapeoERP M ON M.CodigoERP = A.Grupo COLLATE Database_Default
        LEFT JOIN dbo.PreciosBase PB ON PB.ProIdProducto = A.ProIdProducto
        LEFT JOIN dbo.StockArt SA ON SA.CodStock = A.CodStock
        WHERE ISNULL(A.borrar, 0) = 0 AND (A.Mostrar = 1 OR @Inactivos = 1)
          AND ${esOtros ? 'M.CodigoERP IS NULL' : 'LTRIM(RTRIM(M.AreaID_Interno)) = @Area'}
        ORDER BY LTRIM(RTRIM(SA.Articulo)), LTRIM(RTRIM(A.Descripcion)), PB.MonIdMoneda`)).recordset;

    // Las áreas que no se cobran por la lista
    const areasDe = (clave, def) => String(globales[clave] || def).split(',').map(s => s.trim().toUpperCase());
    let aviso = null;
    let conFranjas = !esOtros;
    let tarifa = null;   // bordado / estampado: la tarifa por dato técnico del área (la pantalla arma la tabla)
    const miles = (n) => Number(n).toLocaleString('es-UY');
    if (areasDe('AREAS_BORDADO_PUNTADAS', 'BOR,EMB').includes(area)) {
        // El motor cobra el bordado por puntadas (pricingService.tarifaBordado, guía de Emblemas) y los
        // cargos (matriz, relieve, aplicación) por su lista
        conFranjas = false;
        tarifa = { tipo: 'bordado', ...TARIFAS.bordado.leer(cfg, globales) };
        const matriz = articulos.find(a => a.CodArticulo === tarifa.codMatriz && Number(a.Precio) > 0);
        aviso = `${nombre} se cobra por puntadas, por bordado: $ ${tarifa.precioCada1000} cada ${miles(tarifa.intervalo)} puntadas (o fracción) hasta `
            + `${miles(tarifa.tramo2Desde)} y $ ${tarifa.precioTramo2} cada ${miles(tarifa.intervalo)} de ahí en más. `
            // El mínimo es regla del ingreso (guía de Emblemas): el motor no lo cobra
            + 'Mínimo 5 bordados por diseño. '
            + (matriz ? `Matriz $ ${miles(r2(matriz.Precio))} por diseño` : 'La matriz no tiene precio de lista cargado')
            + (tarifa.matrizGratisDesde > 0 ? `, sin cargo desde ${tarifa.matrizGratisDesde} bordados.` : '.');
    } else if (areasDe('AREAS_CALCULO_BAJADAS', 'EST').includes(area)) {
        // El motor cobra por bajadas cuando la orden las trae ("CÁLCULO DINÁMICO ESTAMPADO POR BAJADAS"). El
        // aviso usa 'EST' si falta la clave (el motor usa 'EST,COR,DF', pero DTF no se cobra por bajadas).
        tarifa = { tipo: 'estampado', ...TARIFAS.estampado.leer(cfg, globales) };
        aviso = `${nombre} se cobra por bajadas, por trabajo: $ ${miles(tarifa.cargoFijo)} en total si tiene menos de ${tarifa.umbral} bajadas `
            + `y $ ${miles(tarifa.precioBajada)} por bajada desde ahí. Las bajadas en total son las bajadas por prenda × las prendas `
            + `(20 prendas con 2 bajadas = 40 bajadas). Si la orden no trae las bajadas, se cobra el precio de lista por prenda.`;
    }

    // Mismo criterio de Categoria que el motor para los perfiles globales (pricingService, consulta de
    // reglas): el código del área, su alias (DF → DTF, EST → Estampados) o su nombre de referencia.
    let franjas = [];
    if (conFranjas && articulos.length > 0) {
        const categoria = area === 'DF' ? 'DTF' : area === 'EST' ? 'Estampados' : area;
        const ids = [...new Set(articulos.map(a => a.ProIdProducto))];
        const codigos = [...new Set(articulos.map(a => a.CodArticulo))];
        const reqF = pool.request()
            .input('Area', sql.VarChar(20), area)
            .input('Categoria', sql.VarChar(50), categoria)
            .input('AreaNombre', sql.VarChar(100), nombre || area)
            .input('Grupo', sql.VarChar(20), grupo);
        ids.forEach((id, k) => reqF.input(`P${k}`, sql.Int, id));
        codigos.forEach((c, k) => reqF.input(`C${k}`, sql.VarChar(50), c));
        const f = await reqF.query(`
            SELECT DISTINCT PI.CantidadMinima
            FROM dbo.PerfilesItems PI
            JOIN dbo.PerfilesPrecios PP ON PP.ID = PI.PerfilID
            WHERE PP.EsGlobal = 1
              AND (ISNULL(PP.Categoria, 'Todos') = 'Todos' OR PP.Categoria = '' OR PP.Categoria = @Area
                   OR PP.Categoria = @Categoria OR PP.Categoria = @AreaNombre)
              AND PI.CantidadMinima > 1
              AND (PI.ProIdProducto IN (${ids.map((_, k) => `@P${k}`).join(',')})
                   OR LTRIM(RTRIM(PI.CodArticulo)) IN (${codigos.map((_, k) => `@C${k}`).join(',')})
                   OR LTRIM(RTRIM(PI.CodGrupo)) = @Grupo
                   OR (ISNULL(PI.ProIdProducto, 0) = 0 AND (NULLIF(LTRIM(RTRIM(PI.CodArticulo)), '') IS NULL OR LTRIM(RTRIM(PI.CodArticulo)) = 'TOTAL')
                       AND NULLIF(LTRIM(RTRIM(PI.CodGrupo)), '') IS NULL))
            ORDER BY PI.CantidadMinima`);
        franjas = f.recordset.map(r => Number(r.CantidadMinima));
    }

    // Una llamada al motor por artículo y franja, en la moneda de esa lista (sin lista: la que elija el
    // motor). sinTraza: sin el detalle de cada cálculo en el log. skipBeneficios: sin cliente no hay
    // beneficios, se ahorra la consulta.
    const tareas = [];
    articulos.forEach((a, i) => franjas.forEach(cantidad => tareas.push(async () => {
        const r = await PricingService.calculatePrice(
            { proIdProducto: a.ProIdProducto, codArticulo: a.CodArticulo }, cantidad, null, [],
            { sinTraza: true, skipBeneficios: true }, monedaDe(a.MonIdMoneda) || 'AUTO', null, area);
        return { i, cantidad, r };
    })));
    const calculos = await enParalelo(tareas, LIMITE_LLAMADAS_MOTOR);

    const filas = articulos.map(a => {
        // Bordado y estampado: lo que el motor cobra por la tarifa del área y no por la lista (en bordado,
        // todo menos los cargos). La tarifa es en pesos; el precio básico lo arma la pantalla.
        const porTarifa = !!tarifa && !tarifa.cargos.includes(a.CodArticulo);
        return {
            proIdProducto: a.ProIdProducto,
            codArticulo: a.CodArticulo,
            descripcion: a.Descripcion,
            variante: a.Variante || null,
            unidad: a.UM || null,
            activo: !!a.Activo,
            moneda: porTarifa ? 'UYU' : monedaDe(a.MonIdMoneda),
            precioLista: Number(a.Precio) > 0 ? r2(a.Precio) : null,   // null = sin precio de lista (no cargado o en 0)
            porTarifa,
            celdas: [],
        };
    });
    calculos.forEach(({ i, cantidad, r }) => {
        const lista = filas[i].precioLista;
        const precio = r2(r.precioUnitario);
        const d = r.desglose?.descuento;
        filas[i].celdas.push({
            cantidad,
            precio: precio > 0 ? precio : null,
            moneda: r.moneda || null,
            // El % sale de la lista y el precio (sirve igual para un % y para un precio fijo).
            // Negativo = el precio de la franja es MAYOR que la lista.
            pct: lista > 0 && precio > 0 ? r2((1 - precio / lista) * 100) : null,
            origen: d ? (d.nombre || d.origen || null) : null,
        });
    });
    filas.forEach(f => f.celdas.sort((x, y) => x.cantidad - y.cantidad));

    return { area, nombre, franjas, aviso, tarifa, articulos: filas };
};

const getPreciosPorCantidad = async (req, res) => {
    const area = String(req.query.area || '').trim().toUpperCase();
    const inactivos = req.query.inactivos === '1' || req.query.inactivos === 'true';
    try {
        const pool = await getPool();
        if (!area) return res.json({ areas: await listarAreasPorCantidad(pool, inactivos) });

        const globales = await PricingService.getGlobalConfigs(pool);
        const cfg = await PricingService.getPriceConfigs(pool);
        const mapas = (await pool.request().query(`
            SELECT LTRIM(RTRIM(AreaID_Interno)) AS Area, LTRIM(RTRIM(CodigoERP)) AS Grupo, LTRIM(RTRIM(NombreReferencia)) AS Nombre
            FROM dbo.ConfigMapeoERP`)).recordset;
        const datosDe = (codigo) => {
            if (codigo === AREA_OTROS) return { area: AREA_OTROS, nombre: NOMBRE_OTROS, grupo: null };
            const m = mapas.find(x => String(x.Area || '').toUpperCase() === codigo);
            return m ? { area: codigo, nombre: m.Nombre || codigo, grupo: m.Grupo } : null;
        };

        if (area === 'TODAS') {
            const secciones = [];
            // De a un área: cada una ya hace LIMITE_LLAMADAS_MOTOR cálculos a la vez
            for (const p of await listarAreasPorCantidad(pool, inactivos)) {
                secciones.push(await matrizDeArea(pool, datosDe(p.area), inactivos, globales, cfg));
            }
            return res.json({ secciones });
        }

        const datos = datosDe(area);
        if (!datos) return res.status(404).json({ error: `No existe el área ${area}.` });
        res.json(await matrizDeArea(pool, datos, inactivos, globales, cfg));
    } catch (e) {
        logger.error(`Error getPreciosPorCantidad (área ${area}):`, e);
        res.status(500).json({ error: e.message });
    }
};

// ─── TARIFAS POR DATO TÉCNICO: BORDADO Y ESTAMPADO (19/10/2026) ─────────────────────
// Bordado se cobra por puntadas (guía de Emblemas) y estampado por bajadas: el motor no usa el precio de
// lista de esos artículos sino estas tarifas (pricingService.tarifaBordado / tarifaEstampado), cuyos
// valores viven en ConfiguracionPrecios. Precios Estándar las muestra y las edita en el grupo de cada
// área; Precios por cantidad las muestra. Se aplican a lo que se cotice desde que se guardan: el motor
// las lee en cada cálculo.
// GET /prices/tarifa/:tipo   (tipo = bordado | estampado) → { tipo, ...valores, areas, cargos, referencia }
// PUT /prices/tarifa/:tipo   { ...valores editables }
const TARIFAS = {
    bordado: {
        nombre: 'Tarifa de bordado',
        campos: {
            precioCada1000:    { clave: 'BOR_PRECIO_CADA_1000_UYU',        texto: 'el precio cada 1.000 puntadas', descripcion: 'Bordado: $ por cada 1.000 puntadas (o fracción), por bordado, hasta BOR_PUNTADAS_TRAMO2_DESDE' },
            tramo2Desde:       { clave: 'BOR_PUNTADAS_TRAMO2_DESDE',       texto: 'desde cuántas puntadas cambia', descripcion: 'Bordado: desde cuántas puntadas rige el precio del segundo tramo', entero: true },
            precioTramo2:      { clave: 'BOR_PRECIO_CADA_1000_TRAMO2_UYU', texto: 'el precio cada 1.000 desde ahí', descripcion: 'Bordado: $ por cada 1.000 puntadas (o fracción) desde BOR_PUNTADAS_TRAMO2_DESDE' },
            matrizGratisDesde: { clave: 'BOR_MATRIZ_GRATIS_DESDE',         texto: 'desde cuántos bordados la matriz va sin cargo', descripcion: 'Bordado: desde cuántos bordados la matriz va sin cargo (0 = nunca)', entero: true },
        },
        leer: (cfg, globales) => {
            const t = PricingService.tarifaBordado(cfg, 0);
            const cb = PricingService.configBordado(cfg);
            return {
                precioCada1000: t.precio1, tramo2Desde: t.desde2, precioTramo2: t.precio2, intervalo: t.intervalo,
                matrizGratisDesde: cb.matrizGratisDesde, codMatriz: cb.codMatriz, cargos: [...cb.cargos],
                areas: String(globales.AREAS_BORDADO_PUNTADAS || 'BOR,EMB').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
                referencia: PUNTADAS_REFERENCIA_BORDADO,
            };
        },
        resumen: (x) => `$ ${x.precioCada1000} c/1000 hasta ${x.tramo2Desde}, $ ${x.precioTramo2} c/1000 después, matriz sin cargo desde ${x.matrizGratisDesde}`,
    },
    estampado: {
        nombre: 'Tarifa de estampado',
        campos: {
            // Positivos: el motor toma un 0 como "sin configurar" y usa el valor por defecto
            cargoFijo:    { clave: 'EST_CARGO_FIJO_UYU',    texto: 'el cargo fijo',                              descripcion: 'Estampado: $ por trabajo si tiene menos de EST_UMBRAL_BAJADAS bajadas en total', positivo: true },
            umbral:       { clave: 'EST_UMBRAL_BAJADAS',    texto: 'con cuántas bajadas deja de ir el cargo fijo', descripcion: 'Estampado: con menos bajadas en total que esto se cobra el cargo fijo', entero: true, positivo: true },
            precioBajada: { clave: 'EST_PRECIO_BAJADA_UYU', texto: 'el precio por bajada',                       descripcion: 'Estampado: $ por bajada desde EST_UMBRAL_BAJADAS bajadas en total', positivo: true },
        },
        leer: (cfg, globales) => {
            const t = PricingService.tarifaEstampado(cfg, 0);
            return {
                cargoFijo: t.cargoFijo, umbral: t.umbral, precioBajada: t.precioBajada, cargos: [],
                // 'EST' si falta la clave: el motor usa 'EST,COR,DF', pero DTF no se cobra por bajadas
                areas: String(globales.AREAS_CALCULO_BAJADAS || 'EST').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
                referencia: BAJADAS_REFERENCIA_ESTAMPADO,
            };
        },
        resumen: (x) => `$ ${x.cargoFijo} fijo con menos de ${x.umbral} bajadas, $ ${x.precioBajada} por bajada desde ahí`,
    },
};

const leerTarifa = async (pool, tipo) => {
    const cfg = await PricingService.getPriceConfigs(pool);
    const globales = await PricingService.getGlobalConfigs(pool);
    return { tipo, ...TARIFAS[tipo].leer(cfg, globales) };
};

const getTarifa = async (req, res) => {
    const tipo = String(req.params.tipo || '').toLowerCase();
    if (!TARIFAS[tipo]) return res.status(404).json({ error: `No hay tarifa "${req.params.tipo}".` });
    try {
        res.json(await leerTarifa(await getPool(), tipo));
    } catch (e) {
        logger.error(`Error getTarifa (${tipo}):`, e);
        res.status(500).json({ error: e.message });
    }
};

const saveTarifa = async (req, res) => {
    const tipo = String(req.params.tipo || '').toLowerCase();
    const def = TARIFAS[tipo];
    if (!def) return res.status(404).json({ error: `No hay tarifa "${req.params.tipo}".` });
    try {
        const valores = {};
        for (const [campo, c] of Object.entries(def.campos)) {
            const n = Number(String(req.body?.[campo] ?? '').replace(',', '.'));
            if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `Revisá ${c.texto}: tiene que ser un número, cero o más.` });
            if (c.positivo && n === 0) return res.status(400).json({ error: `Revisá ${c.texto}: tiene que ser mayor que cero.` });
            if (c.entero && !Number.isInteger(n)) return res.status(400).json({ error: `Revisá ${c.texto}: tiene que ser un número entero.` });
            valores[campo] = Math.round(n * 100) / 100;
        }
        const pool = await getPool();
        const antes = await leerTarifa(pool, tipo);
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            for (const [campo, c] of Object.entries(def.campos)) {
                await new sql.Request(tx)
                    .input('Clave', sql.VarChar(100), c.clave)
                    .input('Valor', sql.VarChar(255), String(valores[campo]))
                    .input('Area', sql.VarChar(20), tipo === 'bordado' ? 'EMB' : 'EST')
                    .input('Desc', sql.NVarChar(500), c.descripcion)
                    .query(`MERGE dbo.ConfiguracionPrecios AS t
                            USING (SELECT @Clave AS Clave) AS s ON t.Clave = s.Clave
                            WHEN MATCHED THEN UPDATE SET Valor = @Valor
                            WHEN NOT MATCHED THEN INSERT (Clave, Valor, AreaID, Descripcion) VALUES (@Clave, @Valor, @Area, @Desc);`);
            }
            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }
        const despues = await leerTarifa(pool, tipo);
        // Quién cambió la tarifa y de qué a qué (tabla Auditoria, como las otras pantallas)
        try {
            await pool.request()
                .input('UID', sql.Int, Number(req.user?.id) || null)
                .input('Accion', sql.NVarChar(100), def.nombre)
                .input('Detalles', sql.NVarChar(sql.MAX), `Antes: ${def.resumen(antes)}. Ahora: ${def.resumen(despues)}.`)
                .input('IP', sql.NVarChar(50), String(req.ip || '').slice(0, 50))
                .query(`INSERT INTO dbo.Auditoria (IdUsuario, Accion, Detalles, DireccionIP, FechaHora) VALUES (@UID, @Accion, @Detalles, @IP, GETDATE())`);
        } catch (e) {
            logger.warn(`[Precios] No se pudo registrar la auditoría de ${def.nombre}: ${e.message}`);
        }
        res.json(despues);
    } catch (e) {
        logger.error(`Error saveTarifa (${tipo}):`, e);
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getTarifa,
    saveTarifa,
    getBasePrices,
    saveBasePrice,
    saveListFlags,
    saveDescripcionLista,
    saveBasePricesBulk,
    calculatePriceEndpoint,
    getTieredPrices,
    saveTieredPricesBulk,
    getPreciosPorCantidad
};

