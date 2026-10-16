/* =====================================================================
   SCHEMA — "Esperar todos los bultos" (órdenes multi-bulto)
   Base: SecureAppDB

   Agrega:
     - OrdenesDeposito.BultosEsperados  (INT NULL) → cuántos bultos tiene la orden
     - OrdenesDeposito.BultosRecibidos  (INT NULL) → cuántos ya llegaron al depósito
     - EstadosOrdenes  → estado 13 = "Esperando Bultos"

   IDEMPOTENTE: se puede correr más de una vez sin romper nada.
   BAJO RIESGO: agregar columnas NULL es metadata-only (no reescribe la tabla).
   NO cambia ninguna lógica todavía — solo prepara el terreno.
   ===================================================================== */

/* --- 1. Columnas contador en OrdenesDeposito --- */
IF COL_LENGTH('dbo.OrdenesDeposito', 'BultosEsperados') IS NULL
    ALTER TABLE dbo.OrdenesDeposito ADD BultosEsperados INT NULL;

IF COL_LENGTH('dbo.OrdenesDeposito', 'BultosRecibidos') IS NULL
    ALTER TABLE dbo.OrdenesDeposito ADD BultosRecibidos INT NULL;


/* --- 2. Estado 13 = "Esperando Bultos" --- */
IF NOT EXISTS (SELECT 1 FROM dbo.EstadosOrdenes WHERE EOrIdEstadoOrden = 13)
BEGIN
    -- Contempla los dos casos: que la PK sea IDENTITY o que se cargue a mano
    IF OBJECTPROPERTY(OBJECT_ID('dbo.EstadosOrdenes'), 'TableHasIdentity') = 1
    BEGIN
        SET IDENTITY_INSERT dbo.EstadosOrdenes ON;
        INSERT INTO dbo.EstadosOrdenes (EOrIdEstadoOrden, EOrNombreEstado) VALUES (13, 'Esperando Bultos');
        SET IDENTITY_INSERT dbo.EstadosOrdenes OFF;
    END
    ELSE
        INSERT INTO dbo.EstadosOrdenes (EOrIdEstadoOrden, EOrNombreEstado) VALUES (13, 'Esperando Bultos');
END


/* --- 3. Verificación (debería mostrar las 2 columnas con un número y la fila 13) --- */
SELECT COL_LENGTH('dbo.OrdenesDeposito','BultosEsperados') AS Col_BultosEsperados,
       COL_LENGTH('dbo.OrdenesDeposito','BultosRecibidos') AS Col_BultosRecibidos;

SELECT EOrIdEstadoOrden, EOrNombreEstado
FROM dbo.EstadosOrdenes
WHERE EOrIdEstadoOrden = 13;
