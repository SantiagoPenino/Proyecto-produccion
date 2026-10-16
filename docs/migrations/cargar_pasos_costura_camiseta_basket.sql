-- ════════════════════════════════════════════════════════════════════
--  Costura paso a paso + avíos de "Camiseta basket FP" (05-oct-2026)
-- ════════════════════════════════════════════════════════════════════
--  Molde TizadaPro "Camiseta Goes 2026", modelo "Camiseta basket Goes 2026"
--  (cuello redondo, 8 piezas): Frente 43,5×79 · Espalda 43,5×81 ·
--  Costadillo der./izq. 13,5×55,9 · Cuello 57,8×5,5 · Tapacostura 22,1×3,5 ·
--  Sisa der./izq. 61,3×6 (medidas talle M).
--
--  Solo los pasos que llevan costura (armado y terminación), sin
--  preparación ni empaquetado. Tiempos ESTIMADOS: ajustarlos al taller.
--
--  Correr DESPUÉS de docs/migrations/configurador_costuras_paso_a_paso.sql.
--  REEMPLAZA los pasos de costura y los avíos que tenga hoy el producto.
--  Busca el producto por nombre. Si no encuentra exactamente uno, no toca nada.
--  Agrega al catálogo de avíos los dos hilos si no existen.
-- ════════════════════════════════════════════════════════════════════

IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'MaquinaCosturaID') IS NULL OR OBJECT_ID('dbo.MaquinasCostura', 'U') IS NULL
   OR COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'Etapa') < 60
   OR OBJECT_ID('dbo.CatalogoAvios', 'U') IS NULL OR COL_LENGTH('dbo.ProductoAvios', 'AvioID') IS NULL
BEGIN
    RAISERROR('Falta correr antes configurador_costuras_paso_a_paso.sql (Etapa de 60) o el catálogo de avíos. No se hizo nada.', 16, 1);
    SET NOEXEC ON;
END
GO

SET XACT_ABORT ON;
DECLARE @Nombre VARCHAR(100) = 'Camiseta basket FP';
DECLARE @PID INT, @N INT;
SELECT @N = COUNT(*), @PID = MAX(ProIdProducto) FROM dbo.Articulos
WHERE LTRIM(RTRIM(Descripcion)) = @Nombre AND ISNULL(borrar, 0) = 0;
IF @N <> 1
BEGIN
    RAISERROR('Se encontraron %d productos llamados "%s" (tiene que ser 1). No se hizo nada.', 16, 1, @N, @Nombre);
    RETURN;
END

-- Preview: lo que hay hoy (se reemplaza)
SELECT 'ANTES costuras' AS Momento, Orden, UnionNombre, CodigoISO FROM dbo.ProductoFichaDisenoCosturas WHERE ProIdProducto = @PID ORDER BY Orden;
SELECT 'ANTES avíos' AS Momento, Nombre, Cantidad, Unidad FROM dbo.ProductoAvios WHERE ProIdProducto = @PID ORDER BY Orden;

DECLARE @Pasos TABLE (Orden INT, Etapa VARCHAR(60), Operacion VARCHAR(100), ISO VARCHAR(20), Maquina VARCHAR(100), Piezas VARCHAR(500), TiempoMin DECIMAL(7,2), Obs VARCHAR(500));
INSERT INTO @Pasos VALUES
 (1,  'Armado',      'Unir hombros',                    'ISO 514', 'Overlock 4 hilos',        'Frente + espalda, por los hombros', 0.30, NULL),
 (2,  'Armado',      'Pegar costadillos al frente',     'ISO 514', 'Overlock 4 hilos',        'Costadillo derecho + frente y costadillo izquierdo + frente (2 costuras)', 0.60, 'Hacer coincidir los piquetes; el costadillo arranca debajo de la sisa'),
 (3,  'Armado',      'Cerrar costados con la espalda',  'ISO 514', 'Overlock 4 hilos',        'Costadillos + espalda, de la sisa al ruedo (2 costuras)', 0.60, 'Las dos uniones de la sisa a la misma altura. Meter la etiqueta de composición en el costado izquierdo, a 10 cm del ruedo'),
 (4,  'Armado',      'Recubrir costuras de costadillos','ISO 602', 'Recubridora (collareta)', 'Las 4 costuras de los costadillos (pespunte visto por el derecho)', 0.90, 'Solo si el diseño lleva la costura vista; si no, borrar este paso'),
 (5,  'Terminación', 'Cerrar cuello en aro',            'ISO 301', 'Recta 1 aguja',           'Pieza Cuello (57,8 cm), punta con punta', 0.15, NULL),
 (6,  'Terminación', 'Pegar cuello',                    'ISO 514', 'Overlock 4 hilos',        'Cuello doblado al medio + escote de frente y espalda', 0.45, 'Repartir el cuello en 4 cuartos; la unión del aro va al centro de la espalda. Meter las etiquetas de marca y talle en el centro de la espalda'),
 (7,  'Terminación', 'Pegar tapacostura en la espalda', 'ISO 406', 'Recubridora (collareta)', 'Tapacostura (22,1 cm) sobre la costura del cuello, de hombro a hombro por la espalda', 0.40, 'Tapa el overlock del cuello y fija las etiquetas'),
 (8,  'Terminación', 'Recubrir cuello por el frente',   'ISO 406', 'Recubridora (collareta)', 'Costura del cuello, de hombro a hombro por el frente', 0.30, NULL),
 (9,  'Terminación', 'Cerrar tiras de sisa en aro',     'ISO 301', 'Recta 1 aguja',           'Sisa derecha y sisa izquierda (61,3 cm), punta con punta', 0.20, NULL),
 (10, 'Terminación', 'Pegar ribete de sisas',           'ISO 514', 'Overlock 4 hilos',        'Tiras de sisa dobladas al medio + sisas del cuerpo', 0.80, 'La unión del aro va en la costura del costado; estirar apenas la tira en la parte de abajo de la sisa para que no quede abierta'),
 (11, 'Terminación', 'Recubrir sisas',                  'ISO 406', 'Recubridora (collareta)', 'Costura de las dos sisas (pespunte por el cuerpo)', 0.60, NULL),
 (12, 'Terminación', 'Ruedo',                           'ISO 406', 'Recubridora (collareta)', 'Bajo de frente, costadillos y espalda (doblez de 2,5 cm)', 0.55, 'Coincidir las costuras de los costados al doblar');

-- Hilos: no estaban en el catálogo de avíos
INSERT INTO dbo.CatalogoAvios (Nombre, Unidad, Activo, Orden)
SELECT v.Nombre, 'm', 1, v.Orden FROM (VALUES (N'Hilo de poliéster (agujas)', 70), (N'Hilo texturizado (áncoras)', 71)) v (Nombre, Orden)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CatalogoAvios c WHERE c.Nombre = v.Nombre);

-- Hilo: estimado para talle M con el largo de costuras del molde (≈ 8,5 m de costura)
-- y consumo típico por tipo de puntada (301 ≈ 2,5×, 514 ≈ 18×, 406 ≈ 18×, 602 ≈ 25×), +10 % de desperdicio.
DECLARE @Avios TABLE (Orden INT, Nombre NVARCHAR(200), Cantidad DECIMAL(10,2), Unidad NVARCHAR(20), Medida NVARCHAR(200), Nota NVARCHAR(400));
INSERT INTO @Avios VALUES
 (1, N'Etiqueta de marca',                1,   N'u', NULL, N'Centro de la espalda, cosida al pegar el cuello'),
 (2, N'Etiqueta de talle',                1,   N'u', NULL, N'Junto a la etiqueta de marca'),
 (3, N'Etiqueta de composición y lavado', 1,   N'u', NULL, N'Costado izquierdo, a 10 cm del ruedo'),
 (4, N'Hilo de poliéster (agujas)',       35,  N'm', N'Talle M ≈ 35 m · más chico o más grande en proporción', N'Estimado. Color de la tela'),
 (5, N'Hilo texturizado (áncoras)',       175, N'm', N'Talle M ≈ 175 m · más chico o más grande en proporción', N'Estimado. Áncoras de overlock y recubridora; color de la tela');

BEGIN TRAN;
    DELETE FROM dbo.ProductoFichaDisenoCosturas WHERE ProIdProducto = @PID;
    INSERT INTO dbo.ProductoFichaDisenoCosturas
        (ProIdProducto, UnionNombre, CodigoISO, Orden, Etapa, Descripcion, MaquinaCosturaID, TiempoMin, Observaciones, ImagenUrl)
    SELECT @PID, p.Operacion, p.ISO, p.Orden, p.Etapa, p.Piezas, m.MaquinaCosturaID, p.TiempoMin, p.Obs, NULL
    FROM @Pasos p LEFT JOIN dbo.MaquinasCostura m ON m.Nombre = p.Maquina;

    DELETE FROM dbo.ProductoAvios WHERE ProIdProducto = @PID;
    INSERT INTO dbo.ProductoAvios (ProIdProducto, Nombre, ArtProIdProducto, Cantidad, Unidad, Medida, Nota, Orden, AvioID)
    SELECT @PID, a.Nombre, NULL, a.Cantidad, a.Unidad, a.Medida, a.Nota, a.Orden, c.AvioID
    FROM @Avios a LEFT JOIN dbo.CatalogoAvios c ON c.Nombre = a.Nombre;

    -- Resultado (Maquina o AvioID NULL = no se encontró en el catálogo: revisar)
    SELECT 'DESPUÉS costuras' AS Momento, c.Orden, c.Etapa, c.UnionNombre AS Operacion, c.CodigoISO, mq.Nombre AS Maquina, c.TiempoMin
    FROM dbo.ProductoFichaDisenoCosturas c LEFT JOIN dbo.MaquinasCostura mq ON mq.MaquinaCosturaID = c.MaquinaCosturaID
    WHERE c.ProIdProducto = @PID ORDER BY c.Orden;
    SELECT SUM(TiempoMin) AS MinutosPorCamiseta FROM dbo.ProductoFichaDisenoCosturas WHERE ProIdProducto = @PID;
    SELECT 'DESPUÉS avíos' AS Momento, Orden, Nombre, AvioID, Cantidad, Unidad, Medida, Nota FROM dbo.ProductoAvios WHERE ProIdProducto = @PID ORDER BY Orden;
COMMIT;
GO

SET NOEXEC OFF;
GO
