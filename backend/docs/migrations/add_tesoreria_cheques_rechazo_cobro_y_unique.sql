/* ============================================================================
   add_tesoreria_cheques_rechazo_cobro_y_unique.sql
   ----------------------------------------------------------------------------
   Tres cosas para Tesorería:
     1. Los eventos contables TES_CHEQUE_REB (rechazo) y TES_CHEQUE_COB (cobro de
        cheque propio), que el código llamaba pero NUNCA se cargaron.
     2. El estado ANULADO.
     3. Un índice que impida cargar dos veces el mismo cheque.

   (1) POR QUÉ: `cambiarEstadoCheque` resuelve TES_CHEQUE_REB / TES_CHEQUE_COB en el
   motor; como no existen, el motor devuelve [] y el controller hace `if (lineas.length
   > 0)` → el estado cambia SIN asiento, en silencio y sin error. Un cheque rebotado no
   volvía a generar la deuda del cliente.

   Idempotente: se puede correr más de una vez.

   ⚠️ ORDEN: correr ANTES `backend/scripts/fix_cheques_duplicados.sql`. Si quedan
   duplicados vivos, la creación del índice UNIQUE de la sección 3 falla.
   ============================================================================ */

SET NOCOUNT ON;
GO

-- ── 1. Eventos que faltan ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.Cont_EventosContables WHERE EvtCodigo = 'TES_CHEQUE_REB')
BEGIN
    INSERT INTO dbo.Cont_EventosContables
        (EvtCodigo, EvtNombre, EvtDescripcion, EvtPrefijo, EvtSubtipo, EvtAfectaSaldo,
         EvtGeneraDeuda, EvtAplicaRecurso, EvtUsaEntidad, EvtRequiereDoc, EvtActivo, EvtOrden, EvtFechaAlta)
    VALUES
        ('TES_CHEQUE_REB', 'Rechazar Cheque Tercero', 'Cheque de tercero rebotado por el banco',
         'CHQX', 'TESORERIA', -1, 0, 0, 1, 0, 1, 100, GETDATE());
    PRINT '[OK] Evento TES_CHEQUE_REB creado.';
END
ELSE PRINT '[SKIP] TES_CHEQUE_REB ya existe.';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Cont_EventosContables WHERE EvtCodigo = 'TES_CHEQUE_COB')
BEGIN
    INSERT INTO dbo.Cont_EventosContables
        (EvtCodigo, EvtNombre, EvtDescripcion, EvtPrefijo, EvtSubtipo, EvtAfectaSaldo,
         EvtGeneraDeuda, EvtAplicaRecurso, EvtUsaEntidad, EvtRequiereDoc, EvtActivo, EvtOrden, EvtFechaAlta)
    VALUES
        ('TES_CHEQUE_COB', 'Cobro Cheque Propio', 'El banco debitó nuestro cheque propio',
         'CHQC', 'TESORERIA', -1, 0, 0, 0, 0, 1, 100, GETDATE());
    PRINT '[OK] Evento TES_CHEQUE_COB creado.';
END
ELSE PRINT '[SKIP] TES_CHEQUE_COB ya existe.';
GO

-- ── 2. Reglas de asiento ────────────────────────────────────────────────────
-- RECHAZO: el cheque no valía nada → sale de Valores a Depositar y el cliente vuelve
-- a deber. Es el espejo exacto de TES_CHEQUE_REC (Debe 1.1.5 / Haber META_CLIENTE).
IF NOT EXISTS (SELECT 1 FROM dbo.Cont_ReglasAsiento WHERE EvtCodigo = 'TES_CHEQUE_REB')
BEGIN
    INSERT INTO dbo.Cont_ReglasAsiento (EvtCodigo, CueCodigo, RasNaturaleza, RasFormula, RasOrden)
    VALUES
        ('TES_CHEQUE_REB', 'META_CLIENTE', 'DEBE',  'TOTAL', 1),   -- al cliente le vuelve la deuda
        ('TES_CHEQUE_REB', '1.1.5',        'HABER', 'TOTAL', 2);   -- se va de Valores a Depositar
    PRINT '[OK] Reglas de TES_CHEQUE_REB creadas.';
END
ELSE PRINT '[SKIP] Reglas de TES_CHEQUE_REB ya existen.';
GO

-- COBRO DE CHEQUE PROPIO: el banco lo debitó → se cancela el pasivo "Cheques Diferidos
-- a Pagar" (2.1.3, que creó TES_CHEQUE_EMI) contra Bancos.
IF NOT EXISTS (SELECT 1 FROM dbo.Cont_ReglasAsiento WHERE EvtCodigo = 'TES_CHEQUE_COB')
BEGIN
    INSERT INTO dbo.Cont_ReglasAsiento (EvtCodigo, CueCodigo, RasNaturaleza, RasFormula, RasOrden)
    VALUES
        ('TES_CHEQUE_COB', '2.1.3', 'DEBE',  'TOTAL', 1),   -- se cancela el cheque a pagar
        ('TES_CHEQUE_COB', '1.1.3', 'HABER', 'TOTAL', 2);   -- sale la plata del banco
    PRINT '[OK] Reglas de TES_CHEQUE_COB creadas.';
END
ELSE PRINT '[SKIP] Reglas de TES_CHEQUE_COB ya existen.';
GO

-- ── 3. Freno de duplicados en la base ───────────────────────────────────────
-- Índice filtrado: ignora los ANULADOS (si no, no se podría volver a cargar un cheque
-- que se anuló por error).
--
-- ⚠️ CRITERIO: la clave incluye el MONTO a propósito. Dos titulares distintos del mismo
-- banco SÍ pueden tener cheques con el mismo número (el número es único por cuenta, no
-- por banco); con el monto adentro, la coincidencia exacta de número+banco+tipo+monto es
-- prácticamente siempre el mismo cheque cargado dos veces. Es un cinturón: la defensa
-- principal es el aviso de `recibirCheque`, que muestra el cheque ya cargado y pide
-- confirmación explícita.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_TesoreriaCheques_NoDuplicado' AND object_id = OBJECT_ID('dbo.TesoreriaCheques')
)
BEGIN
    -- Si esto falla por duplicados existentes: correr primero
    -- backend/scripts/fix_cheques_duplicados.sql
    CREATE UNIQUE NONCLUSTERED INDEX UX_TesoreriaCheques_NoDuplicado
        ON dbo.TesoreriaCheques (NumeroCheque, IdBanco, Tipo, Monto)
        WHERE Estado <> 'ANULADO';
    PRINT '[OK] UX_TesoreriaCheques_NoDuplicado creado.';
END
ELSE PRINT '[SKIP] UX_TesoreriaCheques_NoDuplicado ya existe.';
GO

-- ── 4. Verificación ─────────────────────────────────────────────────────────
SELECT e.EvtCodigo, e.EvtNombre,
       Reglas = (SELECT COUNT(*) FROM dbo.Cont_ReglasAsiento r WHERE r.EvtCodigo = e.EvtCodigo)
FROM dbo.Cont_EventosContables e
WHERE e.EvtCodigo LIKE 'TES_CHEQUE%'
ORDER BY e.EvtCodigo;
-- Los 6 (REC/DEP/END/EMI/REB/COB) deben tener 2 reglas cada uno.
GO
