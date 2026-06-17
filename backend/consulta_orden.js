const sql = require('mssql');

const config = {
    server: 'localhost', database: 'SecureAppDB',
    user: 'sa', password: '2441',
    options: { trustServerCertificate: true, enableArithAbort: true }
};

// ← CAMBIAR ESTE NÚMERO para consultar otra orden
const NUMERO_ORDEN = process.argv[2] || '688';

async function consultar() {
    const pool = await sql.connect(config);

    const query = `
    DECLARE @Cod VARCHAR(50) = @CodigoParam;

    -- ════════════════════════════════════════════════════
    -- 1. ORDEN BASE (Ordenes)
    -- ════════════════════════════════════════════════════
    SELECT 
        'ORDEN' as Seccion,
        o.OrdenID,
        o.CodigoOrden,
        o.Estado              as Estado_Ordenes,
        o.EstadoLogistica     as EstadoLogistica,
        o.UbicacionActual     as UbicacionActual,
        o.AreaID              as Area,
        o.ProximoServicio,
        o.FechaIngreso
    FROM Ordenes o
    WHERE o.CodigoOrden LIKE '%' + @Cod + '%'
       OR o.CodigoOrden = 'DTF-' + @Cod
       OR o.CodigoOrden = 'SB-'  + @Cod
       OR o.CodigoOrden = 'DF-'  + @Cod;

    -- ════════════════════════════════════════════════════
    -- 2. ESTADO EN DEPÓSITO (OrdenesDeposito)
    -- ════════════════════════════════════════════════════
    SELECT
        'DEPOSITO' as Seccion,
        od.OrdIdOrden         as DepositoID,
        od.OrdCodigoOrden     as CodigoOrden,
        e.EOrNombreEstado     as Estado_Deposito,
        od.OrdFechaIngresoOrden as FechaIngreso,
        od.OrdFechaEstadoActual as FechaUltEstado,
        od.OReIdOrdenRetiro   as OrdenRetiroID,
        r.OReEstadoActual     as EstadoRetiro,
        CASE r.OReEstadoActual
            WHEN 1 THEN 'Pendiente' WHEN 2 THEN 'En proceso'
            WHEN 3 THEN 'Confirmado' WHEN 4 THEN 'Enviado'
            WHEN 5 THEN 'Entregado' WHEN 6 THEN 'Cancelado'
            WHEN 7 THEN 'En camino' WHEN 8 THEN 'Empaquetado/Listo'
            WHEN 9 THEN 'No retirado' WHEN 10 THEN 'Devuelto'
            ELSE 'Desconocido'
        END as NombreEstadoRetiro,
        r.FormaRetiro,
        r.ReceptorNombre
    FROM OrdenesDeposito od
    LEFT JOIN EstadosOrdenes e  ON od.OrdEstadoActual = e.EOrIdEstadoOrden
    LEFT JOIN OrdenesRetiro r   ON od.OReIdOrdenRetiro = r.OReIdOrdenRetiro
    WHERE od.OrdCodigoOrden LIKE '%' + @Cod + '%'
       OR od.OrdCodigoOrden = 'DTF-' + @Cod
       OR od.OrdCodigoOrden = 'SB-'  + @Cod
       OR od.OrdCodigoOrden = 'DF-'  + @Cod;

    -- ════════════════════════════════════════════════════
    -- 3. BULTOS (Logistica_Bultos)
    -- ════════════════════════════════════════════════════
    SELECT
        'BULTOS' as Seccion,
        b.BultoID,
        b.CodigoEtiqueta,
        b.Estado              as Estado_Bulto,
        b.UbicacionActual     as Ubicacion_Actual,
        b.Tipocontenido,
        b.FechaCreacion,
        CASE b.Estado
            WHEN 'EN_STOCK'    THEN '✅ En stock en ' + ISNULL(b.UbicacionActual,'NULL')
            WHEN 'EN_TRANSITO' THEN '🚚 En tránsito'
            WHEN 'ENTREGADO'   THEN '📦 Entregado al cliente'
            WHEN 'PROCESADO'   THEN '⚙️ Procesado/Consumido'
            WHEN 'PERDIDO'     THEN '❌ Extraviado'
            ELSE b.Estado
        END as Resumen_Estado
    FROM Logistica_Bultos b
    LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID
    WHERE o.CodigoOrden LIKE '%' + @Cod + '%'
       OR o.CodigoOrden = 'DTF-' + @Cod
       OR o.CodigoOrden = 'SB-'  + @Cod
       OR o.CodigoOrden = 'DF-'  + @Cod
       OR b.CodigoEtiqueta LIKE '%' + @Cod + '%';

    -- ════════════════════════════════════════════════════
    -- 4. REMITOS ASOCIADOS A ESOS BULTOS
    -- ════════════════════════════════════════════════════
    SELECT
        'REMITOS' as Seccion,
        e.CodigoRemito,
        e.AreaOrigenID        as Origen,
        e.AreaDestinoID       as Destino,
        e.Estado              as Estado_Remito,
        e.FechaSalida,
        e.FechaLlegada,
        i.BultoID,
        b.CodigoEtiqueta,
        i.EstadoRecepcion,
        i.FechaEscaneo
    FROM Logistica_EnvioItems i
    INNER JOIN Logistica_Envios e ON i.EnvioID = e.EnvioID
    INNER JOIN Logistica_Bultos b ON i.BultoID = b.BultoID
    LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID
    WHERE o.CodigoOrden LIKE '%' + @Cod + '%'
       OR o.CodigoOrden = 'DTF-' + @Cod
       OR o.CodigoOrden = 'SB-'  + @Cod
       OR o.CodigoOrden = 'DF-'  + @Cod
       OR b.CodigoEtiqueta LIKE '%' + @Cod + '%'
    ORDER BY e.FechaSalida;

    -- ════════════════════════════════════════════════════
    -- 5. MOVIMIENTOS LOGÍSTICOS
    -- ════════════════════════════════════════════════════
    SELECT
        'MOVIMIENTOS' as Seccion,
        m.FechaHora,
        m.CodigoBulto,
        m.TipoMovimiento,
        m.AreaID,
        m.EstadoAnterior,
        m.EstadoNuevo,
        ISNULL(m.Observaciones,'') as Observaciones
    FROM MovimientosLogistica m
    WHERE m.CodigoBulto IN (
        SELECT b.CodigoEtiqueta FROM Logistica_Bultos b
        LEFT JOIN Ordenes o ON b.OrdenID = o.OrdenID
        WHERE o.CodigoOrden LIKE '%' + @Cod + '%'
           OR o.CodigoOrden = 'DTF-' + @Cod
           OR o.CodigoOrden = 'SB-'  + @Cod
           OR o.CodigoOrden = 'DF-'  + @Cod
           OR b.CodigoEtiqueta LIKE '%' + @Cod + '%'
    )
    ORDER BY m.FechaHora;
    `;

    const req = pool.request().input('CodigoParam', sql.VarChar, NUMERO_ORDEN);
    const result = await req.query(query);

    const [ rOrdenes, rDeposito, rBultos, rRemitos, rMovimientos ] = result.recordsets;

    const sep = (titulo) => {
        const line = '═'.repeat(70);
        console.log(`\n╔${line}╗`);
        console.log(`║  ${titulo.padEnd(68)}║`);
        console.log(`╚${line}╝`);
    };

    sep(`1. ORDEN BASE — "${NUMERO_ORDEN}"`);
    if (rOrdenes.length === 0) { console.log('   ⚠️  No se encontró en tabla Ordenes'); }
    else console.table(rOrdenes.map(r => ({
        Orden: r.CodigoOrden, Estado: r.Estado_Ordenes,
        LogisticaEstado: r.EstadoLogistica, Ubicacion: r.UbicacionActual,
        Area: r.Area, ProxServicio: r.ProximoServicio
    })));

    sep(`2. ESTADO EN DEPÓSITO`);
    if (rDeposito.length === 0) { console.log('   ⚠️  No se encontró en OrdenesDeposito'); }
    else console.table(rDeposito.map(r => ({
        Orden: r.CodigoOrden, Estado: r.Estado_Deposito,
        UltEstado: r.FechaUltEstado?.toLocaleString('es-UY'),
        RetiroID: r.OrdenRetiroID, EstadoRetiro: r.NombreEstadoRetiro,
        Forma: r.FormaRetiro, Receptor: r.ReceptorNombre
    })));

    sep(`3. BULTOS`);
    if (rBultos.length === 0) { console.log('   ⚠️  No hay bultos en Logistica_Bultos'); }
    else console.table(rBultos.map(r => ({
        BultoID: r.BultoID, Etiqueta: r.CodigoEtiqueta,
        Estado: r.Estado_Bulto, Ubicacion: r.Ubicacion_Actual,
        Tipo: r.Tipocontenido, Resumen: r.Resumen_Estado,
        FechaCreacion: r.FechaCreacion?.toLocaleString('es-UY')
    })));

    sep(`4. REMITOS`);
    if (rRemitos.length === 0) { console.log('   ⚠️  No hay remitos asociados'); }
    else console.table(rRemitos.map(r => ({
        Remito: r.CodigoRemito, Origen: r.Origen, Destino: r.Destino,
        Estado: r.Estado_Remito, Salida: r.FechaSalida?.toLocaleString('es-UY'),
        Llegada: r.FechaLlegada?.toLocaleString('es-UY'),
        Bulto: r.CodigoEtiqueta, Recepcion: r.EstadoRecepcion,
        Escaneado: r.FechaEscaneo?.toLocaleString('es-UY')
    })));

    sep(`5. MOVIMIENTOS LOGÍSTICOS`);
    if (rMovimientos.length === 0) { console.log('   ⚠️  Sin movimientos en MovimientosLogistica'); }
    else console.table(rMovimientos.map(r => ({
        Fecha: r.FechaHora?.toLocaleString('es-UY'), Bulto: r.CodigoBulto,
        Tipo: r.TipoMovimiento, Area: r.AreaID,
        De: r.EstadoAnterior, A: r.EstadoNuevo, Obs: r.Observaciones
    })));

    console.log('');
    await pool.close();
}

consultar().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
