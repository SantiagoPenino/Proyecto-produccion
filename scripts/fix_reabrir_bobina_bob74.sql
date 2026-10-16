-- ============================================================================
-- BOB-74 (Mandra, Seda Santiago) — reabrir tras cierre manual incorrecto.
--
-- El 17-sep-2026 se usó "Ajustar bobina → Devolución al Cliente" (ManageBobinaModal),
-- un concepto pre-existente que solo cierra la bobina (AJUSTE_MANUAL -7 + closeBobina)
-- SIN generar bulto, etiqueta, entrada a depósito ni aviso al cliente. Ese concepto
-- fue eliminado del modal (era una trampa: parecía la devolución real y no lo era).
-- La devolución real es "Solicitar devolución" → Bandeja → Aprobar → Empaquetar.
--
-- Este script solo reabre la bobina a su estado antes del cierre manual. El aviso de
-- excedente pendiente (TevID 13, si aplica) se auto-resuelve solo apenas se cree la
-- solicitud real — no hace falta tocarlo a mano (fix en solicitarDevolucion).
-- ============================================================================

BEGIN TRAN;

UPDATE InventarioBobinas
SET Estado = 'Disponible', MetrosRestantes = MetrosIniciales, FechaAgotado = NULL
WHERE CodigoEtiqueta = 'BOB-74' AND Estado = 'Agotado' AND MetrosRestantes = 0;

INSERT INTO MovimientosInsumos (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID)
SELECT InsumoID, BobinaID, 'AJUSTE_MANUAL', MetrosIniciales,
       'Reversión del cierre manual ("Devolución al Cliente" del ajuste, que no generaba bulto real): la devolución se gestiona por Solicitar devolución → Empaquetar (bulto DEV-)', 1
FROM InventarioBobinas WHERE CodigoEtiqueta = 'BOB-74';

-- Debería afectar 1 fila cada uno. Si está bien:
COMMIT TRAN;
-- Si algo se ve mal: ROLLBACK TRAN;
