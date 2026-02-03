const { sql, getPool } = require('../config/db');

/**
 * 1. Obtener Número de Pedido (ERP) dado un OrdenID
 * @param {number} ordenId 
 * @returns {Promise<string>} NoDocERP
 */
async function getPedidoNumber(ordenId) {
    const pool = await getPool();
    const result = await pool.request()
        .input('OID', sql.Int, ordenId)
        .query("SELECT NoDocERP FROM Ordenes WHERE OrdenID = @OID");

    return result.recordset[0]?.NoDocERP || null;
}

/**
 * 2. Validar si es la última orden del flujo (Próximo Servicio = Depósito/Logística)
 * @param {number} ordenId 
 * @returns {Promise<boolean>} True si el próximo paso es salir de producción
 */
async function isLastOrder(ordenId) {
    const pool = await getPool();
    const result = await pool.request()
        .input('OID', sql.Int, ordenId)
        .query("SELECT ProximoServicio, EstadoLogistica FROM Ordenes WHERE OrdenID = @OID");

    const { ProximoServicio } = result.recordset[0] || {};

    // Criterio: Si el próximo servicio es DEPOSITO o vacío (fin de línea)
    // O si ya está en estado logístico de salida.
    if (!ProximoServicio) return true;

    const next = ProximoServicio.toUpperCase().trim();
    return (next === 'DEPOSITO' || next === 'ENTREGA' || next === 'LOGISTICA');
}

/**
 * 3. Validar si se puede generar la etiqueta (Intermediate vs Final)
 * Retorna objeto con status y tipo de etiqueta sugerida.
 * @param {number} ordenId
 * @returns {Promise<{ready: boolean, type: 'INTERMEDIATE'|'FINAL'|'ERROR', missing: string[]}>} 
 */
async function validateLabelReady(ordenId) {
    const pool = await getPool();
    // Buscamos los campos requeridos: Magnitud, IdClienteReact, IdProductoReact (o Material?), Precio (??)
    // Nota: 'Precio' no existe en tabla Ordenes estándar, se simulará con 0 o buscará en otra tabla si existe.
    // Usaremos 'Magnitud' y 'IdClienteReact' como filtro principal.

    const result = await pool.request()
        .input('OID', sql.Int, ordenId)
        .query(`
            SELECT 
                Magnitud, 
                IdClienteReact, 
                IdProductoReact, 
                Material,
                ProximoServicio 
            FROM Ordenes 
            WHERE OrdenID = @OID
        `);

    if (!result.recordset.length) return { ready: false, type: 'ERROR', missing: ['Orden no encontrada'] };

    const ord = result.recordset[0];
    const missing = [];

    // Validar campos comunes
    if (!ord.Magnitud) missing.push('Magnitud');

    // Determinar si es Final (Próximo = Depósito) o Intermedia
    const next = (ord.ProximoServicio || '').toUpperCase().trim();
    const isFinal = (next === 'DEPOSITO' || next === 'ENTREGA' || next === 'LOGISTICA' || next === '');

    if (isFinal) {
        // Para etiqueta FINAL, requerimos ID React y Producto
        if (!ord.IdClienteReact) missing.push('IdClienteReact');
        if (!ord.IdProductoReact) missing.push('IdProductoReact');
        // Precio no lo validamos estricto porque no está en DB, asumimos 0 si falta
    }

    if (missing.length > 0) {
        return {
            ready: false,
            type: isFinal ? 'FINAL' : 'INTERMEDIATE',
            missing: missing
        };
    }

    return {
        ready: true,
        type: isFinal ? 'FINAL' : 'INTERMEDIATE',
        missing: []
    };
}

/**
 * 4. Obtener Datos Unificados para Etiqueta (Strategy Pattern)
 * Devuelve estructura estandarizada de items y totales según el tipo de área/orden.
 * @param {number} ordenId 
 */
async function getOrderLabelData(ordenId) {
    const pool = await getPool();

    // 1. Obtener Cabezal
    const headRes = await pool.request()
        .input('OID', sql.Int, ordenId)
        .query(`
            SELECT 
                O.*,
                ISNULL(O.Prioridad, 'Normal') as Prioridad,
                ISNULL(O.DescripcionTrabajo, '') as Descripcion
            FROM Ordenes O
            WHERE O.OrdenID = @OID
        `);

    if (!headRes.recordset.length) throw new Error("Orden no encontrada");
    const head = headRes.recordset[0];

    // 2. Determinar Estrategia (Impresión vs Manufactura Discreta)
    // Estrategia por defecto: Buscar Extras (Manufactura/Terminaciones/Costura)
    // Si no hay extras, buscar Archivos (Impresión).

    // --- ESTRATEGIA A: EXTRAS ---
    const extrasRes = await pool.request()
        .input('OID', sql.Int, ordenId)
        .query(`
            SELECT 
                Descripcion as descripcion, 
                Cantidad as cant, 
                'un' as unidad, 
                ISNULL(PrecioUnitario, 0) as precio
            FROM ServiciosExtraOrden 
            WHERE OrdenID = @OID
        `);

    let items = [];
    let totalPrecio = 0;

    if (extrasRes.recordset.length > 0) {
        items = extrasRes.recordset;
        // Calcular total precio
        totalPrecio = items.reduce((sum, item) => sum + (item.cant * item.precio), 0);

    } else {
        // --- ESTRATEGIA B: IMPRESIÓN ---
        // Basado en Archivos/Superficie y Metros
        const filesRes = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`
                SELECT 
                    NombreArchivo as descripcion,
                    (ISNULL(Copias, 1) * ISNULL(Metros, 0)) as cant,
                    'm' as unidad, 
                    0 as precio
                FROM ArchivosOrden
                WHERE OrdenID = @OID AND (EstadoArchivo IS NULL OR EstadoArchivo != 'CANCELADO')
            `);

        items = filesRes.recordset;

        // En impresión, si no tenemos precio unitario, el total es 0 (o CostoEstimado si existiera)
        // Podríamos intentar obtener el precio del material si tuviéramos tabla tarifas.
    }

    // Si tenemos CostoEstimado en Ordenes (nuevo campo sugerido), lo usamos como override del total
    if (head.CostoEstimado && head.CostoEstimado > 0) {
        totalPrecio = head.CostoEstimado;
    }

    return {
        ordenId: head.OrdenID,
        codigoOrden: head.CodigoOrden,
        cliente: head.Cliente,
        clienteIdQR: head.IdClienteReact || head.CodCliente || '0',  // Mapeo sugerido
        productoIdQR: head.IdProductoReact || '0', // Mapeo sugerido
        nombreTrabajo: head.Descripcion,
        modoQR: head.Variante || head.Material, // "Modo" suele ser material/variante
        tipo: head.AreaID, // Tipo de trabajo
        servicios: items.map(i => i.descripcion).join(', '), // Resumen para QR Izquierdo
        costoTotal: totalPrecio,

        items_detalle: items, // Detalle completo para la tabla visual
        magnitud_total: head.Magnitud,
        unidad_total: head.UM
    };
}

module.exports = {
    getPedidoNumber,
    isLastOrder,
    validateLabelReady,
    getOrderLabelData
};
