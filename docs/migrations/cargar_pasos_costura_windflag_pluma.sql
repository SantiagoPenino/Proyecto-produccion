-- ════════════════════════════════════════════════════════════════════
--  Costura paso a paso del producto "Windflag Pluma 2,8 m" (05-oct-2026)
-- ════════════════════════════════════════════════════════════════════
--  Correr DESPUÉS de docs/migrations/configurador_costuras_paso_a_paso.sql.
--  REEMPLAZA los pasos de costura que tenga hoy el producto (en local son
--  3 de prueba: "lateral", "ZADFGSADG", "FRYSIJTUKIU6Y").
--  Busca el producto por nombre (el ProIdProducto puede no ser el mismo
--  en local y en producción). Si no lo encuentra, o encuentra más de uno,
--  no toca nada.
--
--  Secuencia armada con referencias de fabricación de feather flags:
--  vaina de poliéster 600D por el lado del mástil + curva de arriba,
--  punta cerrada y reforzada, bandera metida entre las solapas de la vaina
--  con zigzag, bordes libres con dobladillo doble pespunte, cordón de
--  tensión abajo. Los tiempos son ESTIMADOS: ajustarlos al taller.
-- ════════════════════════════════════════════════════════════════════

-- Sin el SQL de paso a paso no sigue (SET NOEXEC ON saltea el resto)
IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'MaquinaCosturaID') IS NULL OR OBJECT_ID('dbo.MaquinasCostura', 'U') IS NULL
BEGIN
    RAISERROR('Falta correr antes docs/migrations/configurador_costuras_paso_a_paso.sql. No se hizo nada.', 16, 1);
    SET NOEXEC ON;
END
GO

SET XACT_ABORT ON;
DECLARE @Nombre VARCHAR(100) = 'Windflag Pluma 2,8 m';
DECLARE @PID INT, @N INT;
SELECT @N = COUNT(*), @PID = MAX(ProIdProducto) FROM dbo.Articulos
WHERE LTRIM(RTRIM(Descripcion)) = @Nombre AND ISNULL(borrar, 0) = 0;

IF @N <> 1
BEGIN
    RAISERROR('Se encontraron %d productos llamados "%s" (tiene que ser 1). No se hizo nada.', 16, 1, @N, @Nombre);
    RETURN;
END

-- Preview: lo que hay hoy (se borra)
SELECT 'ANTES' AS Momento, @PID AS ProIdProducto, Orden, UnionNombre, CodigoISO
FROM dbo.ProductoFichaDisenoCosturas WHERE ProIdProducto = @PID ORDER BY Orden;

DECLARE @Pasos TABLE (Orden INT, Etapa VARCHAR(60), Operacion VARCHAR(100), ISO VARCHAR(20), Maquina VARCHAR(100), Piezas VARCHAR(500), TiempoMin DECIMAL(7,2), Obs VARCHAR(500));
INSERT INTO @Pasos VALUES
 (1,  'Preparación de la vaina', 'Control de la pieza impresa', NULL,      'Manual (mesa)', 'Bandera impresa y cortada (llega de Corte)', 0.50, 'Verificar medida, impresión completa y cuál es la cara impresa; si es doble faz, que las dos caras coincidan'),
 (2,  'Preparación de la vaina', 'Cortar la tira de vaina',     NULL,      'Manual (mesa)', 'Tira de poliéster 600D (negro o blanco): largo = lado del mástil + curva de arriba + 5 cm', 1.00, 'Ancho de la tira aprox. 9 cm: doblada deja un túnel de ~3,5 cm para el mástil'),
 (3,  'Preparación de la vaina', 'Formar el túnel de la vaina', 'ISO 301', 'Recta 1 aguja', 'Tira de vaina doblada al medio, a lo largo', 1.20, 'Pespunte a 1 cm del borde abierto; quedan dos solapas libres para meter la bandera'),
 (4,  'Armado',                  'Cerrar la punta de la vaina', 'ISO 301', 'Recta 1 aguja', 'Extremo de arriba de la vaina (punta de la curva)', 0.40, 'Costura doble + doblez de refuerzo: la punta del mástil empuja ahí y no la tiene que perforar'),
 (5,  'Armado',                  'Pegar la vaina a la bandera', 'ISO 304', 'Zigzag',        'Lado del mástil y curva de arriba de la bandera, metidos entre las dos solapas de la vaina', 3.50, 'Meter la tela de a 20–30 cm siguiendo la curva, sin arrugas ni frunces; la vaina no tiene que tapar la impresión'),
 (6,  'Armado',                  'Atraques en los extremos',    'ISO 304', 'Atracadora',    'Inicio y final de la costura de la vaina', 0.30, NULL),
 (7,  'Terminación',             'Dobladillo de los bordes libres', 'ISO 301', 'Recta 2 agujas', 'Borde de vuelo y borde de abajo (los lados sin vaina)', 2.50, 'Doblez de 1 cm hacia el revés; en las curvas coser despacio para que no frunza'),
 (8,  'Terminación',             'Coser el cordón de tensión',  'ISO 301', 'Recta 1 aguja', 'Cordón elástico + punta de abajo del vuelo', 0.40, 'Es el que tensa la bandera contra la base; rematar con 3 pasadas'),
 (9,  'Control y embolsado',     'Cortar hilos y control',      NULL,      'Manual (mesa)', 'Bandera terminada', 0.60, 'Probar con un mástil que entre hasta la punta; revisar que no haya puntadas saltadas'),
 (10, 'Control y embolsado',     'Doblado y embolsado',         NULL,      'Manual (mesa)', 'Bandera terminada', 0.30, 'Si lleva estructura, el mástil y la base se juntan en Producción (PRO) antes de Depósito');

BEGIN TRAN;
    DELETE FROM dbo.ProductoFichaDisenoCosturas WHERE ProIdProducto = @PID;

    INSERT INTO dbo.ProductoFichaDisenoCosturas
        (ProIdProducto, UnionNombre, CodigoISO, Orden, Etapa, Descripcion, MaquinaCosturaID, TiempoMin, Observaciones, ImagenUrl)
    SELECT @PID, p.Operacion, p.ISO, p.Orden, p.Etapa, p.Piezas, m.MaquinaCosturaID, p.TiempoMin, p.Obs, NULL
    FROM @Pasos p
    LEFT JOIN dbo.MaquinasCostura m ON m.Nombre = p.Maquina
    ORDER BY p.Orden;

    -- Resultado (Máquina NULL = no está en el catálogo de máquinas: revisar)
    SELECT 'DESPUÉS' AS Momento, c.Orden, c.Etapa, c.UnionNombre AS Operacion, c.CodigoISO, mq.Nombre AS Maquina, c.TiempoMin, c.Descripcion AS Piezas
    FROM dbo.ProductoFichaDisenoCosturas c
    LEFT JOIN dbo.MaquinasCostura mq ON mq.MaquinaCosturaID = c.MaquinaCosturaID
    WHERE c.ProIdProducto = @PID ORDER BY c.Orden;
    SELECT SUM(TiempoMin) AS MinutosPorBandera FROM dbo.ProductoFichaDisenoCosturas WHERE ProIdProducto = @PID;
COMMIT;
GO

SET NOEXEC OFF;
GO
