/**
 * Helpers compartidos de la Auditoría de Depósito.
 *
 * Nacen en auditDepositoController.js y se mueven acá tal cual para que el servicio de
 * sesiones/casos (auditoriaDepositoService.js) use EXACTAMENTE la misma normalización de
 * códigos y la misma lógica de "situación de pago" que la pantalla. No cambiar uno sin el otro.
 */

/**
 * Claves de comparación de un código de orden/etiqueta.
 *
 * La etiqueta FÍSICA que se escanea es `{NoDocERP}/B{idEtiqueta}` (ej. `9471/B11575`), mientras que
 * `OrdenesDeposito.OrdCodigoOrden` guarda el CodigoOrden CON prefijo de área (`SUB-9471`). Comparar
 * literal no matcheaba NUNCA: todo lo escaneado caía en "desconocido" (Falta Por Ingresar) y las
 * órdenes reales quedaban como extraviadas (de ahí que Activas y Extraviadas dieran el mismo número).
 *
 *   9471/B11575 → {'9471'}          SUB-9471 → {'SUB-9471', '9471'}     → matchean por '9471'
 *
 * Solo se quita el prefijo de área del INICIO: `SUB-7684-R1` → `7684-R1` (no `1`, que colisionaría
 * con cualquier código terminado en 1).
 */
const clavesDeCodigo = (raw) => {
    const base = String(raw || '').trim().toUpperCase().split('/')[0]; // saca el /B11575 de la etiqueta
    const claves = new Set();
    if (!base) return claves;
    claves.add(base);
    claves.add(base.replace(/^[A-Z]+-/, ''));
    return claves;
};

/** `SUB-9471` → `SUB`; `9471/B11575` → null (la etiqueta física no trae área). */
const prefijoDe = (raw) => {
    const m = String(raw || '').trim().toUpperCase().split('/')[0].match(/^([A-Z]+)-/);
    return m ? m[1] : null;
};

/** `SUB-9471` → `9471`; `9471/B11575` → `9471`; `SUB-7684-R1` → `7684-R1`. */
const claveSinPrefijo = (raw) => String(raw || '').trim().toUpperCase().split('/')[0].replace(/^[A-Z]+-/, '');

/**
 * Cobro "vía documento" (semanales / cuenta corriente): esas órdenes no estampan
 * OrdenesDeposito.PagIdPago nunca — el cargo va como mov ORDEN a la cuenta, el cierre de ciclo
 * lo liga a un PC/factura (DocIdDocumento) y el cobro salda ese DOCUMENTO (DocPagado=1 /
 * DeudaDocumento saldada). Sin este join, toda orden así figuraba "Pendiente" eternamente.
 *
 * OJO: MovimientosCuenta.OrdIdOrden NO sirve para unir con OrdenesDeposito (la vía logística
 * graba el ID de Ordenes, otra tabla). El único match confiable es el código de orden, que es
 * el primer token del MovConcepto (`${CodigoOrden} ${NombreTrabajo}`).
 */
const SQL_COLS_PAGO_DOC = `,
        doc.DocIdDocumento AS DocIdVinculado,
        doc.DocSerie       AS DocSerieVinculada,
        doc.DocNumero      AS DocNumeroVinculado,
        doc.DocPagado      AS DocPagadoVinculado,
        dd.DeudasTotales, dd.DeudasVivas,
        CASE WHEN mv.Cod IS NOT NULL THEN 1 ELSE 0 END AS TieneMovOrden`;

// Requiere que la tabla de órdenes esté aliasada como `o` y tenga la columna OrdCodigoOrden.
const SQL_JOIN_PAGO_DOC = `
      LEFT JOIN (
        SELECT UPPER(LTRIM(RTRIM(CASE WHEN CHARINDEX(' ', mc.MovConcepto) > 0
                     THEN LEFT(mc.MovConcepto, CHARINDEX(' ', mc.MovConcepto) - 1)
                     ELSE mc.MovConcepto END))) AS Cod,
               MAX(mc.DocIdDocumento) AS DocId
        FROM dbo.MovimientosCuenta mc WITH(NOLOCK)
        WHERE mc.MovTipo = 'ORDEN' AND ISNULL(mc.MovAnulado, 0) = 0
        GROUP BY UPPER(LTRIM(RTRIM(CASE WHEN CHARINDEX(' ', mc.MovConcepto) > 0
                     THEN LEFT(mc.MovConcepto, CHARINDEX(' ', mc.MovConcepto) - 1)
                     ELSE mc.MovConcepto END)))
      ) mv ON mv.Cod = UPPER(LTRIM(RTRIM(o.OrdCodigoOrden)))
      LEFT JOIN dbo.DocumentosContables doc WITH(NOLOCK)
             ON doc.DocIdDocumento = mv.DocId AND doc.DocEstado <> 'ANULADO'
      LEFT JOIN (
        SELECT DocIdDocumento,
               COUNT(*) AS DeudasTotales,
               SUM(CASE WHEN DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND DDeImportePendiente > 0.01
                        THEN 1 ELSE 0 END) AS DeudasVivas
        FROM dbo.DeudaDocumento WITH(NOLOCK)
        GROUP BY DocIdDocumento
      ) dd ON dd.DocIdDocumento = doc.DocIdDocumento`;

// Devuelve la situación de pago para mostrar + si la orden ya está saldada vía documento
// (en cuyo caso NO va a "Entregadas Sin Pago"). Documento saldado = DocPagado=1 o todas sus
// deudas saldadas (DocPagado puede quedar rezagado en docs cobrados por cuenta corriente).
const resolverSituacionPago = (row) => {
  if (row.PagIdPago) return { pagoEstado: 'Pagado', saldadaPorDoc: false };
  if (row.DocIdVinculado) {
    const serie = String(row.DocSerieVinculada || '').trim();
    const numero = String(row.DocNumeroVinculado || '').trim();
    const docRef = [serie, numero].filter(Boolean).join('-') || `Doc ${row.DocIdVinculado}`;
    const saldada = row.DocPagadoVinculado === true || row.DocPagadoVinculado === 1
      || ((row.DeudasTotales || 0) > 0 && (row.DeudasVivas || 0) === 0);
    if (saldada) return { pagoEstado: `Pagado (${docRef})`, saldadaPorDoc: true };
    return { pagoEstado: `Facturado - impago (${docRef})`, saldadaPorDoc: false };
  }
  if (row.TieneMovOrden) return { pagoEstado: 'En cta. cte. (sin facturar)', saldadaPorDoc: false };
  return { pagoEstado: 'Pendiente', saldadaPorDoc: false };
};

module.exports = { clavesDeCodigo, prefijoDe, claveSinPrefijo, SQL_COLS_PAGO_DOC, SQL_JOIN_PAGO_DOC, resolverSituacionPago };
