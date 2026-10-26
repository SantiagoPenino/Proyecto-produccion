'use strict';
// Clientes inactivos (pedido de Santiago, 23/10/2026): el cliente que pasa más de 60 días sin pedidos ni compras
// queda ESTADO = 'INACTIVO' y sin vendedor (VendedorID = NULL). Lo corre una vez por día clientesInactivos.job.js.
//
// Última actividad = la más nueva de:
//   - pedidos de producción (Ordenes.FechaIngreso; sin las -F, que son reposiciones internas clonadas de la madre);
//   - órdenes del depósito (OrdenesDeposito.OrdFechaIngresoOrden);
//   - ventas de salón sin anular (VentasSalon.VsaFecha);
//   - documentos de venta sin anular (e-tickets, e-facturas y Pedidos Caja; mismo criterio que los reportes de
//     ventas, condEsVenta), por DocFechaEmision.
// Si nunca compró, cuenta desde que se registró (Clientes.FechaRegistro); sin esa fecha, queda inactivo.
//
// Reglas:
//   - BLOQUEADO no se toca (es una decisión a mano y pesa más que inactivo). Las fichas genéricas tampoco.
//   - Un INACTIVO que vuelve a comprar pasa solo a ACTIVO en la corrida siguiente; el vendedor queda vacío
//     hasta que se le asigne uno.
//   - Cada cambio queda en ClientesInactividadLog con el estado y el VENDEDOR ANTERIOR, para poder devolverlo.
//
// /vendedores/ventas (y los ganadores) atribuyen por el vendedor actual del cliente, salvo los documentos
// anteriores a una inactivación: esos van al vendedor que guardó este log (vendedorVistaController).
const { sql, getPool } = require('../config/db');
const { reglasVentas } = require('../controllers/contabilidadReportesController');

const DIAS = 60;

const SQL_ACTIVIDAD = `
    SELECT CliIdCliente, MAX(F) AS UltimaActividad
    FROM (
        SELECT o.CliIdCliente, MAX(o.FechaIngreso) AS F
        FROM dbo.Ordenes o WITH(NOLOCK)
        WHERE o.CliIdCliente IS NOT NULL AND o.CodigoOrden NOT LIKE '%-F%'
        GROUP BY o.CliIdCliente
        UNION ALL
        SELECT d.CliIdCliente, MAX(d.OrdFechaIngresoOrden)
        FROM dbo.OrdenesDeposito d WITH(NOLOCK)
        WHERE d.CliIdCliente IS NOT NULL
        GROUP BY d.CliIdCliente
        UNION ALL
        SELECT v.CliIdCliente, MAX(v.VsaFecha)
        FROM dbo.VentasSalon v WITH(NOLOCK)
        WHERE v.CliIdCliente IS NOT NULL AND v.VsaFechaAnulacion IS NULL
        GROUP BY v.CliIdCliente
        UNION ALL
        SELECT dc.CliIdCliente, MAX(dc.DocFechaEmision)
        FROM dbo.DocumentosContables dc WITH(NOLOCK)
        WHERE dc.CliIdCliente IS NOT NULL AND ISNULL(dc.DocEstado, '') <> 'ANULADO' AND ${reglasVentas.condEsVenta('dc')}
        GROUP BY dc.CliIdCliente
    ) x
    GROUP BY CliIdCliente`;

let tablaLista = false;
async function asegurarTabla(pool) {
    if (tablaLista) return;
    await pool.request().query(`
        IF OBJECT_ID('dbo.ClientesInactividadLog', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.ClientesInactividadLog (
                LogID               INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                CliIdCliente        INT          NOT NULL,
                Fecha               DATETIME     NOT NULL CONSTRAINT DF_ClientesInactividadLog_Fecha DEFAULT GETDATE(),
                Accion              VARCHAR(12)  NOT NULL,   -- INACTIVADO | REACTIVADO
                EstadoAnterior      NVARCHAR(10) NULL,
                VendedorIDAnterior  NVARCHAR(20) NULL,
                UltimaActividad     DATETIME     NULL,
                DiasSinActividad    INT          NULL
            );
            CREATE INDEX IX_ClientesInactividadLog_Cliente ON dbo.ClientesInactividadLog (CliIdCliente, Fecha);
        END`);
    tablaLista = true;
}

/**
 * Marca INACTIVO (y sin vendedor) a los clientes sin actividad en más de DIAS días, y vuelve a ACTIVO a los
 * INACTIVO que compraron dentro del plazo.
 * @param {{ simular?: boolean }} op  simular = hace todo dentro de la transacción y la deshace (para probar).
 * @returns {{ inactivados: number, reactivados: number, simulado: boolean }}
 */
async function procesar({ simular = false } = {}) {
    const pool = await getPool();
    await asegurarTabla(pool);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        const r = await new sql.Request(tx)
            .input('Dias', sql.Int, DIAS)
            .query(`
                SELECT c.CliIdCliente, c.ESTADO, c.VendedorID, a.UltimaActividad,
                       DATEDIFF(DAY, ISNULL(a.UltimaActividad, c.FechaRegistro), GETDATE()) AS Dias
                INTO #cand
                FROM dbo.Clientes c
                LEFT JOIN (${SQL_ACTIVIDAD}) a ON a.CliIdCliente = c.CliIdCliente
                WHERE ISNULL(c.ESTADO, '') <> 'BLOQUEADO'
                  AND c.CliIdCliente NOT IN (${reglasVentas.CLIENTES_GENERICOS.join(', ')});

                -- Sin actividad en el plazo: inactivo y sin vendedor (también al INACTIVO que todavía tenía vendedor)
                INSERT INTO dbo.ClientesInactividadLog (CliIdCliente, Accion, EstadoAnterior, VendedorIDAnterior, UltimaActividad, DiasSinActividad)
                SELECT CliIdCliente, 'INACTIVADO', ESTADO, NULLIF(LTRIM(RTRIM(VendedorID)), ''), UltimaActividad, Dias
                FROM #cand
                WHERE (Dias IS NULL OR Dias > @Dias)
                  AND (ISNULL(ESTADO, '') <> 'INACTIVO' OR NULLIF(LTRIM(RTRIM(VendedorID)), '') IS NOT NULL);
                DECLARE @inactivados INT = @@ROWCOUNT;

                UPDATE c SET c.ESTADO = 'INACTIVO', c.VendedorID = NULL
                FROM dbo.Clientes c
                JOIN #cand k ON k.CliIdCliente = c.CliIdCliente
                WHERE (k.Dias IS NULL OR k.Dias > @Dias)
                  AND (ISNULL(k.ESTADO, '') <> 'INACTIVO' OR NULLIF(LTRIM(RTRIM(k.VendedorID)), '') IS NOT NULL);

                -- Volvió a comprar: activo de nuevo (el vendedor queda como esté: vacío hasta que se le asigne)
                INSERT INTO dbo.ClientesInactividadLog (CliIdCliente, Accion, EstadoAnterior, VendedorIDAnterior, UltimaActividad, DiasSinActividad)
                SELECT CliIdCliente, 'REACTIVADO', ESTADO, NULLIF(LTRIM(RTRIM(VendedorID)), ''), UltimaActividad, Dias
                FROM #cand
                WHERE ESTADO = 'INACTIVO' AND Dias <= @Dias;
                DECLARE @reactivados INT = @@ROWCOUNT;

                UPDATE c SET c.ESTADO = 'ACTIVO'
                FROM dbo.Clientes c
                JOIN #cand k ON k.CliIdCliente = c.CliIdCliente
                WHERE k.ESTADO = 'INACTIVO' AND k.Dias <= @Dias;

                DROP TABLE #cand;
                SELECT @inactivados AS inactivados, @reactivados AS reactivados;
            `);
        const { inactivados, reactivados } = r.recordset[0];
        if (simular) await tx.rollback();
        else await tx.commit();
        return { inactivados, reactivados, simulado: simular };
    } catch (e) {
        try { await tx.rollback(); } catch (_) { /* ya deshecha */ }
        throw e;
    }
}

module.exports = { procesar, asegurarTabla, DIAS };
