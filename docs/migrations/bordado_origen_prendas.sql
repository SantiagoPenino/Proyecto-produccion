-- =====================================================================
-- BORDADO (EMB): ORIGEN DE LAS PRENDAS + DISEÑOS POR ORDEN
-- =====================================================================
-- Contexto: el form de Bordado del portal pasa a pedir DE DÓNDE salen las
-- prendas a bordar. El origen es "prendas del cliente": las que ya entregó
-- en recepción, que generan un remito PRE-xxx (Recepciones, Tipo =
-- 'PAQUETE DE PRENDAS'). El cliente las elige igual que hoy elige una
-- bobina de tela — ver BobinaSelector.jsx y /inventory/tela-cliente/disponible.
--
-- Si el bordado es PARCHE no hay prendas del cliente (el parche se fabrica
-- de cero): ahí no se elige origen y la cantidad es libre.
--
-- Comprar las prendas a USER NO entra por acá: ese flujo ya existe aparte
-- (PrendaOrderForm.jsx → "Comprar prendas" + "Personalizar esta compra").
--
-- ---------------------------------------------------------------------
-- POR QUÉ UNA TABLA DE INVENTARIO Y NO UN CAMPO EN Recepciones
-- ---------------------------------------------------------------------
-- Mismo motivo por el que una recepción de TELA no guarda "92 metros" sino
-- que crea UNA FILA POR BOBINA en InventarioBobinas: un remito puede traer
-- prendas DISTINTAS (12 gorros negros + 20 remeras blancas + 8 buzos). Con
-- un solo número por remito el cliente no podría elegir "los 12 gorros".
-- Entonces la recepción de prendas crea una fila por tipo de prenda, y el
-- cliente elige la LÍNEA, no el remito.
--
-- Diferencia deliberada con InventarioBobinas: acá NO se guarda un contador
-- de saldo. El disponible se CALCULA (ver vista al final). Es exactamente el
-- bug que arrastra tela de cliente, donde MetrosRestantes se desincronizó
-- del historial real de movimientos.
--
-- ---------------------------------------------------------------------
-- ESTRUCTURA DE LA ORDEN (copiada de Corte multi-tela)
-- ---------------------------------------------------------------------
-- En webOrdersController.js (~1106) cada orden de corte lleva SU bobina en
-- Ordenes.BobinaTelaID. Bordado igual:
--   · UNA orden por línea de prendas  → Ordenes.PrendaClienteID
--   · N diseños dentro de la orden    → N filas en ArchivosOrden
--       - Ancho / Alto  → medidas del bordado EN CM (columnas ya existentes)
--       - Piezas        → prendas a bordar con ESE logo (columna ya existente)
--       - PaletaBordado → hilos y puntadas del prediseño (NUEVA)
--
-- Un pedido puede usar varias líneas de prendas (una orden por cada una) y
-- una misma línea puede llevar varios diseños (varias filas de ArchivosOrden).
--
-- OJO — dependencia operativa: hoy NO hay ninguna recepción de tipo
-- 'PAQUETE DE PRENDAS' cargada (0 filas en la base). Hasta que recepción
-- empiece a registrarlas, el selector le va a aparecer vacío al cliente.

-- ---------------------------------------------------------------------
-- 1. Inventario de prendas del cliente (equivalente a InventarioBobinas)
-- ---------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
               WHERE TABLE_NAME = 'InventarioPrendasCliente')
BEGIN
    CREATE TABLE InventarioPrendasCliente (
        PrendaClienteID  INT IDENTITY(1,1) PRIMARY KEY,
        RecepcionID      INT           NOT NULL,   -- remito PRE-xxx del que salió
        ClienteID        VARCHAR(50)   NULL,       -- CliIdCliente (mismo criterio que InventarioBobinas.ClienteID)
        Descripcion      NVARCHAR(200) NOT NULL,   -- "Gorro negro", "Remera blanca M"
        Talle            NVARCHAR(50)  NULL,
        Color            NVARCHAR(50)  NULL,
        Cantidad         INT           NOT NULL,   -- cuántas entregó (NO se descuenta: es el declarado)
        Estado           VARCHAR(20)   NOT NULL CONSTRAINT DF_IPC_Estado DEFAULT 'Disponible',
        Referencia       NVARCHAR(100) NULL,       -- código de etiqueta del bulto (PRE-5 / PRE-5-2)
        Observaciones    NVARCHAR(MAX) NULL,
        FechaIngreso     DATETIME      NOT NULL CONSTRAINT DF_IPC_Fecha DEFAULT GETDATE(),
        UsuarioID        INT           NULL
    );

    CREATE INDEX IX_IPC_Cliente  ON InventarioPrendasCliente (ClienteID, Estado);
    CREATE INDEX IX_IPC_Recepcion ON InventarioPrendasCliente (RecepcionID);
END
GO

-- ---------------------------------------------------------------------
-- 2. Ordenes: de qué línea de prendas salen las prendas de esta orden
-- ---------------------------------------------------------------------
-- Análogo exacto de BobinaTelaID. NULL = la orden no consume prendas del
-- cliente (parche, o cualquier área que no sea bordado sobre prenda).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'Ordenes' AND COLUMN_NAME = 'PrendaClienteID')
BEGIN
    ALTER TABLE Ordenes ADD PrendaClienteID INT NULL;
END
GO

-- ---------------------------------------------------------------------
-- 3. ArchivosOrden: paleta de hilos del prediseño (opcional)
-- ---------------------------------------------------------------------
-- JSON con lo que el cliente eligió en el editor de prediseño:
--   [{"color":"#1a2b3c","puntada":"Satinado"}, ...] + si lleva aplique.
-- Es INFORMATIVO: la matriz real la hace igual un diseñador, el prediseño es
-- una referencia de "así lo quiero". Por eso va como dato suelto y no como
-- tabla con reglas.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'ArchivosOrden' AND COLUMN_NAME = 'PaletaBordado')
BEGIN
    ALTER TABLE ArchivosOrden ADD PaletaBordado NVARCHAR(MAX) NULL;
END
GO

-- ---------------------------------------------------------------------
-- 3b. ArchivosOrden: puntadas estimadas del diseño
-- ---------------------------------------------------------------------
-- El bordado se COBRA por puntadas (artículos 107/108/109/1630, UM 'PUNT'), y
-- el motor de precios las busca en `vars.puntadas`. Hasta ahora ese dato salía
-- de ServiciosExtraOrden.Puntadas, que solo se llena cuando el bordado es un
-- complemento; en un pedido propio de bordado llegaba vacío y el precio caía al
-- mínimo con "(0 p.)". Guardarlas por diseño permite que la cotización las sume.
--
-- Es una ESTIMACIÓN por área y densidad. El número real sale del ponchado, y
-- por eso el área lo puede corregir después en la cotización (Dato Técnico).
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'ArchivosOrden' AND COLUMN_NAME = 'PuntadasEstimadas')
BEGIN
    ALTER TABLE ArchivosOrden ADD PuntadasEstimadas INT NULL;
END
GO

-- ---------------------------------------------------------------------
-- 4. Vista de saldo: cuántas prendas quedan libres de cada línea
-- ---------------------------------------------------------------------
-- Calculado, no guardado. Lo tomado = suma de Piezas de los diseños de las
-- órdenes vivas que apuntan a esa línea (las canceladas no reservan nada).
IF OBJECT_ID('vw_PrendasClienteDisponibles', 'V') IS NOT NULL
    DROP VIEW vw_PrendasClienteDisponibles;
GO

CREATE VIEW vw_PrendasClienteDisponibles AS
SELECT
    p.PrendaClienteID,
    p.RecepcionID,
    r.Codigo            AS CodigoRecepcion,
    p.ClienteID,
    p.Descripcion,
    p.Talle,
    p.Color,
    p.Cantidad,
    p.Estado,
    p.FechaIngreso,
    ISNULL((
        SELECT SUM(ISNULL(ao.Piezas, 0))
        FROM Ordenes o
        LEFT JOIN ArchivosOrden ao ON ao.OrdenID = o.OrdenID
        WHERE o.PrendaClienteID = p.PrendaClienteID
          AND ISNULL(o.Estado, '') NOT IN ('Cancelado')
    ), 0)               AS CantidadUsada,
    p.Cantidad - ISNULL((
        SELECT SUM(ISNULL(ao.Piezas, 0))
        FROM Ordenes o
        LEFT JOIN ArchivosOrden ao ON ao.OrdenID = o.OrdenID
        WHERE o.PrendaClienteID = p.PrendaClienteID
          AND ISNULL(o.Estado, '') NOT IN ('Cancelado')
    ), 0)               AS CantidadDisponible
FROM InventarioPrendasCliente p
LEFT JOIN Recepciones r ON r.RecepcionID = p.RecepcionID;
GO

-- ---------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------
SELECT 'InventarioPrendasCliente' AS Objeto,
       CASE WHEN OBJECT_ID('InventarioPrendasCliente','U') IS NULL THEN 'FALTA' ELSE 'OK' END AS Estado
UNION ALL
SELECT 'Ordenes.PrendaClienteID',
       CASE WHEN COL_LENGTH('Ordenes','PrendaClienteID') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL
SELECT 'ArchivosOrden.PaletaBordado',
       CASE WHEN COL_LENGTH('ArchivosOrden','PaletaBordado') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL
SELECT 'ArchivosOrden.PuntadasEstimadas',
       CASE WHEN COL_LENGTH('ArchivosOrden','PuntadasEstimadas') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL
SELECT 'vw_PrendasClienteDisponibles',
       CASE WHEN OBJECT_ID('vw_PrendasClienteDisponibles','V') IS NULL THEN 'FALTA' ELSE 'OK' END;
GO
