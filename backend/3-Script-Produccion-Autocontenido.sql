-- ================================================================
-- SCRIPT AUTOCONTENIDO PARA PRODUCCION
-- Generado: 2026-05-25 12:32:51
-- Fuente  : SecureAppDB2205
-- Destino : SecureAppDB (produccion)
-- Tablas  : 21
-- ================================================================
USE [SecureAppDB];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Deshabilitar FK constraints para permitir DROP/CREATE de tablas referenciadas
EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL';
GO

-- ================================================================
-- [1/21] SecuenciaDocumentos
-- ================================================================
PRINT '>>> [1/21] SecuenciaDocumentos';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[SecuenciaDocumentos]', 'U') IS NOT NULL
        DROP TABLE [dbo].[SecuenciaDocumentos];

    CREATE TABLE [dbo].[SecuenciaDocumentos] (
    [SecIdSecuencia] INT IDENTITY(1,1) NOT NULL,
    [SecTipoDoc] VARCHAR(20) NOT NULL,
    [SecSerie] VARCHAR(5) NOT NULL,
    [SecPrefijo] VARCHAR(10) NULL,
    [SecDigitos] INT NOT NULL,
    [SecUltimoNumero] INT NOT NULL,
    [SecActivo] BIT NOT NULL,
    [SecObservaciones] NVARCHAR(200) NULL,
    [SecNroResolucion] VARCHAR(20) NULL,
    [SecRangoDesde] INT NULL,
    [SecRangoHasta] INT NULL,
    [SecFechaVencimientoCAE] DATE NULL
    );

    -- INSERT (14 filas)
    SET IDENTITY_INSERT [dbo].[SecuenciaDocumentos] ON;
    INSERT INTO [dbo].[SecuenciaDocumentos] ([SecIdSecuencia], [SecTipoDoc], [SecSerie], [SecPrefijo], [SecDigitos], [SecUltimoNumero], [SecActivo], [SecObservaciones], [SecNroResolucion], [SecRangoDesde], [SecRangoHasta], [SecFechaVencimientoCAE]) VALUES
        (1, 'ETICKET', 'ET', 'ET-', 7, 13, 1, NULL, NULL, NULL, NULL, NULL),
        (2, 'FACTURA', 'FA', 'FA-', 6, 5, 1, NULL, NULL, NULL, NULL, NULL),
        (3, 'CREDITO', 'NC', 'NC-', 6, 0, 1, NULL, NULL, NULL, NULL, NULL),
        (4, 'NOTA_CONSUMO', 'NC', 'NC-', 6, 0, 1, NULL, NULL, NULL, NULL, NULL),
        (5, 'RECIBO', 'RC', 'RC-', 6, 0, 1, NULL, NULL, NULL, NULL, NULL),
        (6, 'ORDEN_PAGO', 'OP', 'OP-', 6, 0, 1, NULL, NULL, NULL, NULL, NULL),
        (7, 'FACTURA_CICLO', 'FC', 'FC-', 5, 0, 1, NULL, NULL, NULL, NULL, NULL),
        (8, 'VOUCHER_CAJA', 'VC', 'VC-', 6, 0, 1, NULL, NULL, NULL, NULL, NULL),
        (9, 'E-TICKET CREDITO', 'ET', 'ET-', 5, 0, 1, NULL, NULL, NULL, NULL, NULL),
        (10, 'E-FACTURA CREDITO', 'FA', 'FA-', 5, 0, 1, NULL, NULL, NULL, NULL, NULL),
        (11, 'E-FACTURA CONTADO', 'FA', 'FA-', 5, 0, 1, NULL, NULL, NULL, NULL, NULL),
        (12, 'PEDIDO_CAJA', 'PC', 'PC-', 5, 0, 1, NULL, NULL, NULL, NULL, NULL),
        (13, 'RECIBO_ANTICIPO', 'RC', 'RC-', 5, 5, 1, NULL, NULL, NULL, NULL, NULL),
        (14, 'E-TICKET CREDITO', 'A', 'A-', 5, 4, 1, NULL, NULL, NULL, NULL, NULL);
    SET IDENTITY_INSERT [dbo].[SecuenciaDocumentos] OFF;

    COMMIT TRAN;
    PRINT '    OK SecuenciaDocumentos (14 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[SecuenciaDocumentos] OFF;
    PRINT '    ERROR SecuenciaDocumentos: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [2/21] SINCRO-ARTICULOS
-- ================================================================
PRINT '>>> [2/21] SINCRO-ARTICULOS';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[SINCRO-ARTICULOS]', 'U') IS NOT NULL
        DROP TABLE [dbo].[SINCRO-ARTICULOS];

    CREATE TABLE [dbo].[SINCRO-ARTICULOS] (
    [PRODUCTO] NVARCHAR(100) NULL,
    [codStock] NVARCHAR(100) NULL,
    [VARIANTE] NVARCHAR(100) NULL,
    [PROIDPRODUCTO] SMALLINT NULL,
    [Material] NVARCHAR(150) NULL,
    [codArticulo] SMALLINT NULL,
    [IDREACT] SMALLINT NULL,
    [AREA] NVARCHAR(50) NULL
    );

    -- INSERT (132 filas)
    INSERT INTO [dbo].[SINCRO-ARTICULOS] ([PRODUCTO], [codStock], [VARIANTE], [PROIDPRODUCTO], [Material], [codArticulo], [IDREACT], [AREA]) VALUES
        ('COMUN', '1.1.2.1', 'Dtf Textil                                             ', 247, 'DTF textil COMUN                                                                                    ', 48, 47, 'DTF'),
        ('DORADO BRILLANTE', '1.1.2.1', 'Dtf Textil                                             ', 248, 'DTF textil DORADO                                                                                   ', 49, 48, 'DTF'),
        ('UV (PARA RIGIDOS 0.57)', '1.1.2.2', 'Dtf UV                                                 ', 255, 'DTF para rígidos UV                                                                                 ', 55, 52, 'DTF'),
        ('Parche (De hasta 10x8)', '1.1.10.1', 'TPU', 413, 'Parche (De hasta 10x8)', 152, 152, 'TPU'),
        ('Parche (Hasta 4x4)', '1.1.10.1', 'TPU', 414, 'Parche (Hasta 4x4)', 153, 153, 'TPU'),
        ('Parche con un maximo de 4 estrellas (De hasta 10x8)', '1.1.10.1', 'TPU', 415, 'Parche con un maximo de 4 estrellas (De hasta 10x8)', 154, 154, 'TPU'),
        ('Parche (Hasta 7,5 x 4)', '1.1.10.1', 'TPU', 416, 'Parche (Hasta 7,5 x 4)', 155, 155, 'TPU'),
        ('Matriz TPU', '1.1.10.1', 'TPU', 417, 'Matriz TPU', 156, 156, 'TPU'),
        ('ESTAMPADO DE TPU EN PESOS', '1.1.5.1', 'Estampado                                              ', 418, 'ESTAMPADO DE TPU ', 157, 157, 'EST'),
        ('Tela de bandera (3,10)', '1.1.11.1', 'Impresión Directa 3.20', 9, 'Tela de bandera (3,10)', 1558, 160, 'IMD'),
        ('Tela de bandera Mesh (3,17)', '1.1.11.1', 'Impresión Directa 3.20', 420, 'Tela de bandera Mesh (3,17)', 161, 161, 'IMD'),
        ('Tela Blackout – Tela Doble Cara (2,9)', '1.1.11.1', 'Impresión Directa 3.20', 32, 'Tela Blackout – Tela Doble Cara (2,9)', 1560, 162, 'IMD'),
        ('Corte Laser Balconera', '1.1.6.1', 'Corte Laser                                            ', 85, 'Corte Laser Balconera', 1370, 226, 'TWC'),
        ('Corte Laser Bandera de auto', '1.1.6.1', 'Corte Laser                                            ', 80, 'Corte Laser Bandera de auto', 1365, 224, 'TWC'),
        ('Corte Laser Bandera x metro cuadrado', '1.1.6.1', 'Corte Laser                                            ', 79, 'Corte Laser Bandera x metro cuadrado', 1364, 240, 'TWC'),
        ('Corte Laser Banderas piezas (1 pieza hasta 1,80 m X 4,00 m)', '1.1.6.1', 'Corte Laser                                            ', 78, 'Corte Laser Banderas piezas (1 pieza hasta 1,80 m X 4,00 m)', 1363, 241, 'TWC'),
        ('Corte Laser Banderín triangular', '1.1.6.1', 'Corte Laser                                            ', 81, 'Corte Laser Banderín triangular', 1366, 242, 'TWC'),
        ('Corte Laser Buzo y buzo con cierre', '1.1.6.1', 'Corte Laser                                            ', 75, 'Corte Laser Buzo y buzo con cierre', 1360, 243, 'TWC'),
        ('Corte Laser Camiseta compleja', '1.1.6.1', 'Corte Laser                                            ', 71, 'Corte Laser Camiseta compleja', 1356, 244, 'TWC'),
        ('Corte Laser camiseta con detalles', '1.1.6.1', 'Corte Laser                                            ', 70, 'Corte Laser camiseta con detalles', 1355, 245, 'TWC'),
        ('Corte Laser camiseta simple', '1.1.6.1', 'Corte Laser                                            ', 68, 'Corte Laser camiseta simple', 1353, 246, 'TWC'),
        ('Corte Laser Campera', '1.1.6.1', 'Corte Laser                                            ', 74, 'Corte Laser Campera', 1359, 247, 'TWC'),
        ('Corte Laser Camperas, buzos y canguros 2 colores', '1.1.6.1', 'Corte Laser                                            ', 76, 'Corte Laser Camperas, buzos y canguros 2 colores', 1361, 223, 'TWC'),
        ('Corte Laser Capa barbería', '1.1.6.1', 'Corte Laser                                            ', 91, 'Corte Laser Capa barbería', 1376, 229, 'TWC'),
        ('Corte Laser Chaleco', '1.1.6.1', 'Corte Laser                                            ', 86, 'Corte Laser Chaleco', 1371, 227, 'TWC'),
        ('Corte Laser Cuellitos / buffs', '1.1.6.1', 'Corte Laser                                            ', 88, 'Corte Laser Cuellitos / buffs', 1373, 233, 'TWC'),
        ('Corte Laser Etiquetas para ropa', '1.1.6.1', 'Corte Laser                                            ', 87, 'Corte Laser Etiquetas para ropa', 1372, 234, 'TWC'),
        ('Corte Laser Letras y números', '1.1.6.1', 'Corte Laser                                            ', 89, 'Corte Laser Letras y números', 1374, 228, 'TWC'),
        ('Corte Laser Pantalón', '1.1.6.1', 'Corte Laser                                            ', 77, 'Corte Laser Pantalón', 1362, 235, 'TWC'),
        ('Corte Laser Piezas (1 pieza hasta 0,20 m X 0,20 m)', '1.1.6.1', 'Corte Laser                                            ', 84, 'Corte Laser Piezas (1 pieza hasta 0,20 m X 0,20 m)', 1369, 225, 'TWC'),
        ('Corte Laser Piezas (1 pieza hasta 0,6 m X 0.9 m)', '1.1.6.1', 'Corte Laser                                            ', 83, 'Corte Laser Piezas (1 pieza hasta 0,6 m X 0.9 m)', 1368, 236, 'TWC'),
        ('Corte Laser Piezas (1 pieza hasta 1,20 m X 1,80 m)', '1.1.6.1', 'Corte Laser                                            ', 82, 'Corte Laser Piezas (1 pieza hasta 1,20 m X 1,80 m)', 1367, 237, 'TWC'),
        ('Corte Laser por prenda', '1.1.6.1', 'Corte Laser                                            ', 90, 'Corte Laser por prenda', 1375, 253, 'TWC'),
        ('Corte Laser Pulseras', '1.1.6.1', 'Corte Laser                                            ', 437, 'Corte Laser Pulseras', 1570, 1571, 'TWC'),
        ('Corte Laser Short-pollera', '1.1.6.1', 'Corte Laser                                            ', 73, 'Corte Laser Short-pollera', 1358, 222, 'TWC'),
        ('Corte Laser Shorts', '1.1.6.1', 'Corte Laser                                            ', 72, 'Corte Laser Shorts', 1357, 238, 'TWC'),
        ('Costura', '1.1.7.1', 'Costura                                                ', 36, 'Costura', 115, 219, 'TWT'),
        ('Costura camiseta con detalles', '1.1.7.1', 'Costura                                                ', 38, 'Costura camiseta con detalles', 116, 220, 'TWT'),
        ('Costura camiseta compleja', '1.1.7.1', 'Costura                                                ', 40, 'Costura camiseta compleja', 1178, 221, 'TWT'),
        ('Costura shorts', '1.1.7.1', 'Costura                                                ', 41, 'Costura shorts', 1179, 239, 'TWT'),
        ('Cosstura de Almohadones con cierre', '1.1.7.1', 'Costura                                                ', 113, 'Cosstura de Almohadones con cierre', 1398, 230, 'TWT'),
        ('Costura de short-pollera', '1.1.7.1', 'Costura                                                ', 191, 'Costura de short-pollera', 1475, 191, 'TWT'),
        ('Costura de campera', '1.1.7.1', 'Costura                                                ', 192, 'Costura de campera', 1476, 192, 'TWT'),
        ('Costura de buzo y buzo con cierre', '1.1.7.1', 'Costura                                                ', 193, 'Costura de buzo y buzo con cierre', 1477, 193, 'TWT'),
        ('Costura de camperas, buzos y canguros', '1.1.7.1', 'Costura                                                ', 194, 'Costura de camperas, buzos y canguros', 1478, 194, 'TWT'),
        ('Costura de pantalón', '1.1.7.1', 'Costura                                                ', 195, 'Costura de pantalón', 1479, 195, 'TWT'),
        ('Costura de bandera piezas (1 pieza hasta 1,80 m x 4,00 m)', '1.1.7.1', 'Costura                                                ', 196, 'Costura de bandera piezas (1 pieza hasta 1,80 m x 4,00 m)', 1480, 196, 'TWT'),
        ('Costura de bandera x metro cuadrado', '1.1.7.1', 'Costura                                                ', 197, 'Costura de bandera x metro cuadrado', 1481, 197, 'TWT'),
        ('Costura de bandera de auto', '1.1.7.1', 'Costura                                                ', 198, 'Costura de bandera de auto', 1482, 198, 'TWT'),
        ('Costura de banderín triangular', '1.1.7.1', 'Costura                                                ', 199, 'Costura de banderín triangular', 1483, 199, 'TWT'),
        ('Costura de piezas (1 pieza hasta 1,20 m x 1,80 m)', '1.1.7.1', 'Costura                                                ', 200, 'Costura de piezas (1 pieza hasta 1,20 m x 1,80 m)', 1484, 200, 'TWT'),
        ('Costura de piezas (1 pieza hasta 0,6 m x 0.9 m)', '1.1.7.1', 'Costura                                                ', 201, 'Costura de piezas (1 pieza hasta 0,6 m x 0.9 m)', 1485, 201, 'TWT'),
        ('Costura de piezas (1 pieza hasta 0,20 m x 0,20 m)', '1.1.7.1', 'Costura                                                ', 202, 'Costura de piezas (1 pieza hasta 0,20 m x 0,20 m)', 1486, 202, 'TWT'),
        ('Costura de balconera', '1.1.7.1', 'Costura                                                ', 203, 'Costura de balconera', 1487, 203, 'TWT'),
        ('Costura de chaleco', '1.1.7.1', 'Costura                                                ', 204, 'Costura de chaleco', 1488, 204, 'TWT'),
        ('Costura de cuellitos / buffs', '1.1.7.1', 'Costura                                                ', 205, 'Costura de cuellitos / buffs', 1489, 205, 'TWT'),
        ('Costura de capa barbería', '1.1.7.1', 'Costura                                                ', 206, 'Costura de capa barbería', 1490, 206, 'TWT'),
        ('Costura de totebag', '1.1.7.1', 'Costura                                                ', 207, 'Costura de totebag', 1491, 207, 'TWT'),
        ('Papel', '1.1.1.2', 'Impresión de Papel                           ', 246, 'Papel', 47, 37, 'SB'),
        ('Adis Elastizado Grueso (1,83)', '1.1.1.1', 'Sublimacion Tela                                       ', 239, 'Adis Elastizado Grueso (1,83)', 40, 103, 'SB'),
        ('Bandera (1,60)', '1.1.1.1', 'Sublimacion Tela                                       ', 44, 'Bandera (1,60)', 12, 56, 'SB'),
        ('Bandera mesh (1,60) (110g)', '1.1.1.1', 'Sublimacion Tela                                       ', 227, 'Bandera mesh (1,60) (110g)', 3, 40, 'SB'),
        ('Delta (1,72 m)', '1.1.1.1', 'Sublimacion Tela                                       ', 56, 'Delta (1,72 m)', 1223, 137, 'SB'),
        ('Deportiva (1,60)', '1.1.1.1', 'Sublimacion Tela                                       ', 214, 'Deportiva (1,60)', 18, 63, 'SB'),
        ('Dry Microporoso 1.83 (lado  liso)', '1.1.1.1', 'Sublimacion Tela                                       ', 277, 'Dry Microporoso 1.83 (lado  liso)', 8, 45, 'SB'),
        ('Dry Microporoso 1.83 (lado  poroso)', '1.1.1.1', 'Sublimacion Tela                                       ', 266, 'Dry Microporoso 1.83 (lado  poroso)', 7, 44, 'SB'),
        ('Dry Polo (1,80)', '1.1.1.1', 'Sublimacion Tela                                       ', 52, 'Dry Polo (1,80)', 1219, 111, 'SB'),
        ('Dry Poroso (1,50)', '1.1.1.1', 'Sublimacion Tela                                       ', 217, 'Dry Poroso (1,50)', 20, 2, 'SB'),
        ('Dry Pro (1,80)', '1.1.1.1', 'Sublimacion Tela                                       ', 28, 'Dry Pro (1,80)', 11, 55, 'SB'),
        ('ESPECIAL F', '1.1.1.1', 'Sublimacion Tela                                       ', 231, 'ESPECIAL F', 33, 86, 'SB'),
        ('Grid (1,70 m)', '1.1.1.1', 'Sublimacion Tela                                       ', 58, 'Grid (1,70 m)', 1225, 139, 'SB'),
        ('Hexagonal (1,83)', '1.1.1.1', 'Sublimacion Tela                                       ', 258, 'Hexagonal (1,83)', 6, 43, 'SB'),
        ('Interlock feria (1,80)', '1.1.1.1', 'Sublimacion Tela                                       ', 388, 'Interlock feria (1,80)', 93, 93, 'SB'),
        ('Interlock Fina "Fer" (1,83 m)', '1.1.1.1', 'Sublimacion Tela                                       ', 235, 'Interlock Fina "Fer" (1,83 m)', 37, 158, 'SB'),
        ('Interlock Grueso  (1,83 m)', '1.1.1.1', 'Sublimacion Tela                                       ', 410, 'Interlock Grueso  (1,83 m)', 149, 149, 'SB'),
        ('Jacquard city 1,83', '1.1.1.1', 'Sublimacion Tela                                       ', 208, 'Jacquard city 1,83', 1499, 113, 'SB'),
        ('Jacquard Elite 1,83', '1.1.1.1', 'Sublimacion Tela                                       ', 223, 'Jacquard Elite 1,83', 26, 29, 'SB'),
        ('Lycra (1,60)', '1.1.1.1', 'Sublimacion Tela                                       ', 221, 'Lycra (1,60)', 24, 6, 'SB'),
        ('Lycra Mykonos (1,80)', '1.1.1.1', 'Sublimacion Tela                                       ', 236, 'Lycra Mykonos (1,80)', 38, 101, 'SB'),
        ('Microfibra RV Waterproof (1,50)', '1.1.1.1', 'Sublimacion Tela                                       ', 48, 'Microfibra RV Waterproof (1,50)', 1215, 116, 'SB'),
        ('Microfibra Short', '1.1.1.1', 'Sublimacion Tela                                       ', 49, 'Microfibra Short', 1216, 117, 'SB'),
        ('Modal (1,50)', '1.1.1.1', 'Sublimacion Tela                                       ', 220, 'Modal (1,50)', 23, 5, 'SB'),
        ('Nagasaki (1,80 m)', '1.1.1.1', 'Sublimacion Tela                                       ', 57, 'Nagasaki (1,80 m)', 1224, 138, 'SB'),
        ('NeoStretch (1,83)', '1.1.1.1', 'Sublimacion Tela                                       ', 53, 'NeoStretch (1,83)', 1220, 112, 'SB'),
        ('Panama (1,60)', '1.1.1.1', 'Sublimacion Tela                                       ', 240, 'Panama (1,60)', 41, 57, 'SB'),
        ('Polar (1,50)', '1.1.1.1', 'Sublimacion Tela                                       ', 212, 'Polar (1,50)', 16, 60, 'SB'),
        ('Rib 1,70 (Cuellos y vivos tela Elite y Supreme)', '1.1.1.1', 'Sublimacion Tela                                       ', 225, 'Rib 1,70 (Cuellos y vivos tela Elite y Supreme)', 28, 31, 'SB'),
        ('Saten (1,50)', '1.1.1.1', 'Sublimacion Tela                                       ', 2, 'Saten (1,50)', 10, 54, 'SB'),
        ('Tela Cliente (Minimo 5mts)', '1.1.1.3', 'Sublimacion Tela Cliente                                      ', 1, 'Tela Cliente (Minimo 5mts)', 1, 38, 'SB'),
        ('Toalla (1,80)', '1.1.1.1', 'Sublimacion Tela                                       ', 216, 'Toalla (1,80)', 2, 39, 'SB'),
        ('Banner Pet mate (0,91)', '1.1.3.1', 'Impresion Gran Formato                                 ', 317, 'Banner Pet mate (0,91)', 1585, 27, 'ECOUV'),
        ('Canvas Brillo 0,91', '1.1.3.1', 'Impresion Gran Formato                                 ', 338, 'Canvas Brillo 0,91', 1606, 80, 'ECOUV'),
        ('Canvas Brillo 1,27', '1.1.3.1', 'Impresion Gran Formato                                 ', 436, 'Canvas Brillo 1,27', 1569, 231, 'ECOUV'),
        ('Canvas Mate 1,27', '1.1.3.1', 'Impresion Gran Formato                                 ', 346, 'Canvas Mate 1,27', 1614, 24, 'ECOUV'),
        ('Canvas Mate 1,52', '1.1.3.1', 'Impresion Gran Formato                                 ', 347, 'Canvas Mate 1,52', 1615, 25, 'ECOUV'),
        ('Columnera 0,77 x 0,50 + Palo', '1.1.3.1', 'Impresion Gran Formato                                 ', 342, 'Columnera 0,77 x 0,50 + Palo', 1610, 97, 'ECOUV'),
        ('Cuadro canvas 1,10 x 50', '1.1.3.1', 'Impresion Gran Formato                                 ', 358, 'Cuadro canvas 1,10 x 50', 1625, 142, 'ECOUV'),
        ('Cuadro canvas 25 x 25', '1.1.3.1', 'Impresion Gran Formato                                 ', 349, 'Cuadro canvas 25 x 25', 1616, 121, 'ECOUV'),
        ('Cuadro canvas 35 x 15', '1.1.3.1', 'Impresion Gran Formato                                 ', 355, 'Cuadro canvas 35 x 15', 1622, 133, 'ECOUV'),
        ('Cuadro canvas 40 x 40', '1.1.3.1', 'Impresion Gran Formato                                 ', 350, 'Cuadro canvas 40 x 40', 1617, 122, 'ECOUV'),
        ('Cuadro canvas 50 x 30', '1.1.3.1', 'Impresion Gran Formato                                 ', 356, 'Cuadro canvas 50 x 30', 1623, 140, 'ECOUV'),
        ('Cuadro canvas 60 x 60', '1.1.3.1', 'Impresion Gran Formato                                 ', 351, 'Cuadro canvas 60 x 60', 1618, 123, 'ECOUV'),
        ('Cuadro canvas 70 x 50', '1.1.3.1', 'Impresion Gran Formato                                 ', 357, 'Cuadro canvas 70 x 50', 1624, 141, 'ECOUV'),
        ('Cuadro canvas 80 x 80', '1.1.3.1', 'Impresion Gran Formato                                 ', 352, 'Cuadro canvas 80 x 80', 1619, 124, 'ECOUV'),
        ('Frontlight Brillo hasta 3.17', '1.1.3.1', 'Impresion Gran Formato                                 ', 360, 'Frontlight Brillo hasta 3.17', 1627, 8, 'ECOUV'),
        ('Frontlight Mate hasta 3.17', '1.1.3.1', 'Impresion Gran Formato                                 ', 378, 'Frontlight Mate hasta 3.17', 1628, 9, 'ECOUV'),
        ('Lona Backligth hasta 3,17', '1.1.3.1', 'Impresion Gran Formato                                 ', 336, 'Lona Backligth hasta 3,17', 1604, 89, 'ECOUV'),
        ('Lona para Pasacalles 0,80', '1.1.3.1', 'Impresion Gran Formato                                 ', 319, 'Lona para Pasacalles 0,80', 1587, 36, 'ECOUV'),
        ('Papel Fotográfico (0,87)', '1.1.3.1', 'Impresion Gran Formato                                 ', 340, 'Papel Fotográfico (0,87)', 1608, 91, 'ECOUV'),
        ('Pasacalles 0,77 x 1,00 + Palo', '1.1.3.1', 'Impresion Gran Formato                                 ', 343, 'Pasacalles 0,77 x 1,00 + Palo', 1611, 98, 'ECOUV'),
        ('Pasacalles 0,77 x 2,00  + Palo', '1.1.3.1', 'Impresion Gran Formato                                 ', 344, 'Pasacalles 0,77 x 2,00  + Palo', 1612, 99, 'ECOUV'),
        ('Pasacalles 0,77 x 3,00 + Palo', '1.1.3.1', 'Impresion Gran Formato                                 ', 345, 'Pasacalles 0,77 x 3,00 + Palo', 1613, 100, 'ECOUV'),
        ('Roll up aluminio + (Banner Pet mate - 0,78)', '1.1.3.1', 'Impresion Gran Formato                                 ', 334, 'Roll up aluminio + (Banner Pet mate - 0,78)', 1602, 85, 'ECOUV'),
        ('Vinilo brillo  hasta 1,49', '1.1.3.1', 'Impresion Gran Formato                                 ', 339, 'Vinilo brillo  hasta 1,49', 1607, 16, 'ECOUV'),
        ('Vinilo Mate hasta 1,49', '1.1.3.1', 'Impresion Gran Formato                                 ', 308, 'Vinilo Mate hasta 1,49', 1578, 18, 'ECOUV'),
        ('Vinilo Microperforado hasta 1,49 (Reverso Negro)', '1.1.3.1', 'Impresion Gran Formato                                 ', 326, 'Vinilo Microperforado hasta 1,49 (Reverso Negro)', 1594, 73, 'ECOUV'),
        ('Vinilo Vehicular 1,34 (Adhesivo Gris)', '1.1.3.1', 'Impresion Gran Formato                                 ', 329, 'Vinilo Vehicular 1,34 (Adhesivo Gris)', 1597, 76, 'ECOUV'),
        ('Bastidor de hierro', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 428, 'Bastidor de hierro', 1561, 212, 'ECOUV'),
        ('Colocacion de ojales', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 429, 'Colocacion de ojales', 1562, 213, 'ECOUV'),
        ('Corte de vinilo', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 430, 'Corte de vinilo', 1563, 214, 'ECOUV'),
        ('Palos pasacalle', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 431, 'Palos pasacalle', 1564, 215, 'ECOUV'),
        ('Roll up aluminio', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 181, 'Roll up aluminio', 1465, 216, 'ECOUV'),
        ('Roll up plastico', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 406, 'Roll up plastico', 1629, 159, 'ECOUV'),
        ('Roll up PVC', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 432, 'Roll up PVC', 1565, 217, 'ECOUV'),
        ('Soldadura de lona', '1.1.3.2', 'Materiales Extra Gran Formato                          ', 433, 'Soldadura de lona', 1566, 218, 'ECOUV'),
        ('Parche adhesivo 100% hilo', '1.1.4.1', 'Bordado                                                ', 424, 'Parche adhesivo 100% hilo', 1630, 232, 'EMB'),
        ('Parche adhesivo con tafeta', '1.1.4.1', 'Bordado                                                ', 27, 'Parche adhesivo con tafeta', 109, 211, 'EMB'),
        ('Parche bordado sobre prenda 100% hilo', '1.1.4.1', 'Bordado                                                ', 26, 'Parche bordado sobre prenda 100% hilo', 108, 250, 'EMB'),
        ('Parche bordado sobre prenda con tafeta', '1.1.4.1', 'Bordado                                                ', 25, 'Parche bordado sobre prenda con tafeta', 107, 249, 'EMB'),
        ('Bordado', '1.1.4.1', 'Bordado                                                ', 434, 'Bordado', 1567, 65, 'EMB'),
        ('Estampado', '1.1.5.1', 'Estampado                                              ', 29, 'Estampado', 110, 84, 'EMB'),
        ('Matriz Bordado', '1.1.4.1', 'Bordado                                                ', 435, 'Matriz Bordado', 1568, 248, 'EST');

    COMMIT TRAN;
    PRINT '    OK SINCRO-ARTICULOS (132 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ERROR SINCRO-ARTICULOS: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [3/21] ConfiguracionPrecios
-- ================================================================
PRINT '>>> [3/21] ConfiguracionPrecios';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[ConfiguracionPrecios]', 'U') IS NOT NULL
        DROP TABLE [dbo].[ConfiguracionPrecios];

    CREATE TABLE [dbo].[ConfiguracionPrecios] (
    [Clave] VARCHAR(100) NOT NULL,
    [Valor] VARCHAR(255) NOT NULL,
    [AreaID] VARCHAR(20) NULL,
    [Descripcion] NVARCHAR(500) NULL
    );

    -- INSERT (7 filas)
    INSERT INTO [dbo].[ConfiguracionPrecios] ([Clave], [Valor], [AreaID], [Descripcion]) VALUES
        ('BOR_PRECIO_BASE_UYU', '50', 'EMB', 'Precio de las puntadas base'),
        ('BOR_PRECIO_INTERVALO_UYU', '10', 'EMB', 'Precio por cada intervalo extra'),
        ('BOR_PUNTADAS_BASE', '5000', 'EMB', 'Cantidad de puntadas base para bordado'),
        ('BOR_PUNTADAS_INTERVALO', '1000', 'EMB', 'Intervalo de puntadas extras'),
        ('EST_CARGO_FIJO_UYU', '150', 'EST', 'Cargo mínimo fijo si no supera el umbral'),
        ('EST_PRECIO_BAJADA_UYU', '15', 'EST', 'Precio por cada bajada (si supera umbral)'),
        ('EST_UMBRAL_BAJADAS', '10', 'EST', 'Límite de bajadas totales para cargo fijo');

    COMMIT TRAN;
    PRINT '    OK ConfiguracionPrecios (7 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ERROR ConfiguracionPrecios: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [4/21] TesoreriaBancos
-- ================================================================
PRINT '>>> [4/21] TesoreriaBancos';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[TesoreriaBancos]', 'U') IS NOT NULL
        DROP TABLE [dbo].[TesoreriaBancos];

    CREATE TABLE [dbo].[TesoreriaBancos] (
    [IdBanco] INT IDENTITY(1,1) NOT NULL,
    [NombreBanco] VARCHAR(100) NOT NULL,
    [Activo] BIT NULL
    );

    -- INSERT (8 filas)
    SET IDENTITY_INSERT [dbo].[TesoreriaBancos] ON;
    INSERT INTO [dbo].[TesoreriaBancos] ([IdBanco], [NombreBanco], [Activo]) VALUES
        (1, 'BROU', 1),
        (2, 'Banco Santander', 1),
        (3, 'Banco Itaú', 1),
        (4, 'Scotiabank', 1),
        (5, 'BBVA', 1),
        (6, 'HSBC', 1),
        (7, 'Bandes', 1),
        (8, 'Heritage', 1);
    SET IDENTITY_INSERT [dbo].[TesoreriaBancos] OFF;

    COMMIT TRAN;
    PRINT '    OK TesoreriaBancos (8 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[TesoreriaBancos] OFF;
    PRINT '    ERROR TesoreriaBancos: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [5/21] Config_TiposDocumento
-- ================================================================
PRINT '>>> [5/21] Config_TiposDocumento';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[Config_TiposDocumento]', 'U') IS NOT NULL
        DROP TABLE [dbo].[Config_TiposDocumento];

    CREATE TABLE [dbo].[Config_TiposDocumento] (
    [CodDocumento] VARCHAR(10) NOT NULL,
    [Detalle] VARCHAR(100) NULL,
    [Codigo_Efact] INT NULL,
    [RutObligatorio] BIT NULL,
    [AfectaCtaCte] BIT NULL,
    [Referenciado] BIT NULL,
    [NroCaja] INT NULL,
    [EvtCodigo] VARCHAR(50) NULL,
    [SecIdSecuencia] INT NULL
    );

    -- INSERT (10 filas)
    INSERT INTO [dbo].[Config_TiposDocumento] ([CodDocumento], [Detalle], [Codigo_Efact], [RutObligatorio], [AfectaCtaCte], [Referenciado], [NroCaja], [EvtCodigo], [SecIdSecuencia]) VALUES
        ('01', 'E-Factura Contado             ', 111, 1, 0, 0, 2, 'VTA_CAJA', 2),
        ('02', 'E-Factura Credito             ', 111, 1, 1, 0, 2, 'FACTURA', 2),
        ('03', 'E-Factura Dev.Contado         ', 112, 1, 0, 0, 2, NULL, NULL),
        ('04', 'E-Factura Nota De Credito     ', 112, 1, 1, 1, 2, 'NOTA_CREDITO', 3),
        ('05', 'Recibo                        ', 0, 0, 1, 1, 2, 'RECIBO', 5),
        ('07', 'E-Ticket Contado              ', 101, 0, 0, 0, 2, 'VTA_CAJA', 1),
        ('08', 'E-Ticket Credito              ', 101, 0, 1, 0, 2, 'FACTURA', 1),
        ('09', 'E-Ticket Dev.Contado          ', 102, 0, 0, 0, 2, NULL, NULL),
        ('10', 'E-Ticket Nota De Credito      ', 102, 0, 1, 1, 2, 'NOTA_CREDITO', 3),
        ('40', 'Pedidos Caja                  ', 0, 0, 0, 0, 2, 'VTA_CAJA', 12);

    COMMIT TRAN;
    PRINT '    OK Config_TiposDocumento (10 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ERROR Config_TiposDocumento: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [6/21] Config_CuentasEgreso
-- ================================================================
PRINT '>>> [6/21] Config_CuentasEgreso';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[Config_CuentasEgreso]', 'U') IS NOT NULL
        DROP TABLE [dbo].[Config_CuentasEgreso];

    CREATE TABLE [dbo].[Config_CuentasEgreso] (
    [CegId] INT IDENTITY(1,1) NOT NULL,
    [CegTipoEgreso] VARCHAR(30) NOT NULL,
    [CegNombreTipo] NVARCHAR(80) NOT NULL,
    [CegCueCodigo] VARCHAR(20) NOT NULL,
    [CegCueNombre] NVARCHAR(100) NOT NULL,
    [CegEmoji] VARCHAR(10) NULL,
    [CegOrden] INT NOT NULL,
    [CegActivo] BIT NOT NULL,
    [CegFechaAlta] DATETIME NOT NULL,
    [CegUsuarioAlta] INT NULL
    );

    -- INSERT (7 filas)
    SET IDENTITY_INSERT [dbo].[Config_CuentasEgreso] ON;
    INSERT INTO [dbo].[Config_CuentasEgreso] ([CegId], [CegTipoEgreso], [CegNombreTipo], [CegCueCodigo], [CegCueNombre], [CegEmoji], [CegOrden], [CegActivo], [CegFechaAlta], [CegUsuarioAlta]) VALUES
        (1, 'GASTO_OPERATIVO', 'Gasto Operativo', '5.1.03', 'Mantenimiento y Reparaciones', '??', 1, 1, '2026-05-08 09:28:20', NULL),
        (2, 'SALARIO', 'Salario / Honorarios', '5.1.01', 'Sueldos y Cargas Sociales', '??', 2, 1, '2026-05-08 09:28:20', NULL),
        (3, 'COMPRA_INSUMO', 'Compra de Insumos', '1.3.1', 'Mercaderías de Reventa', '??', 3, 1, '2026-05-08 09:28:20', NULL),
        (4, 'PAGO_PROVEEDOR', 'Pago a Proveedor', '2.1.1', 'Acreedores por Compras MN (Proveedores)', '??', 4, 1, '2026-05-08 09:28:20', NULL),
        (5, 'DEVOLUCION_CLIENTE', 'Devolución a Cliente', '2.3.1', 'Anticipos de Clientes (Prepagos, Rollos)', '??', 5, 1, '2026-05-08 09:28:20', NULL),
        (6, 'ANTICIPO_EMPLEADO', 'Anticipo / Préstamo', '1.2.2', 'Anticipos al Personal', '??', 6, 1, '2026-05-08 09:28:20', NULL),
        (7, 'RETIRO_FONDOS', 'Retiro de Fondos', '3.1', 'Capital y Reservas', '??', 7, 1, '2026-05-08 09:28:20', NULL);
    SET IDENTITY_INSERT [dbo].[Config_CuentasEgreso] OFF;

    COMMIT TRAN;
    PRINT '    OK Config_CuentasEgreso (7 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Config_CuentasEgreso] OFF;
    PRINT '    ERROR Config_CuentasEgreso: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [7/21] CondicionesPago
-- ================================================================
PRINT '>>> [7/21] CondicionesPago';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[CondicionesPago]', 'U') IS NOT NULL
        DROP TABLE [dbo].[CondicionesPago];

    CREATE TABLE [dbo].[CondicionesPago] (
    [CPaIdCondicion] INT IDENTITY(1,1) NOT NULL,
    [CPaNombre] NVARCHAR(100) NOT NULL,
    [CPaDiasVencimiento] INT NOT NULL,
    [CPaPermiteCuotas] BIT NOT NULL,
    [CPaCantidadCuotas] INT NOT NULL,
    [CPaDiasEntreCuotas] INT NOT NULL,
    [CPaActiva] BIT NOT NULL
    );

    -- INSERT (5 filas)
    SET IDENTITY_INSERT [dbo].[CondicionesPago] ON;
    INSERT INTO [dbo].[CondicionesPago] ([CPaIdCondicion], [CPaNombre], [CPaDiasVencimiento], [CPaPermiteCuotas], [CPaCantidadCuotas], [CPaDiasEntreCuotas], [CPaActiva]) VALUES
        (1, 'Contado', 0, 0, 1, 0, 1),
        (2, '15 días', 15, 0, 1, 0, 1),
        (3, '30 días', 30, 0, 1, 0, 1),
        (4, '30/60 días', 30, 1, 2, 30, 1),
        (5, '30/60/90 días', 30, 1, 3, 30, 1);
    SET IDENTITY_INSERT [dbo].[CondicionesPago] OFF;

    COMMIT TRAN;
    PRINT '    OK CondicionesPago (5 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[CondicionesPago] OFF;
    PRINT '    ERROR CondicionesPago: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [8/21] TiposMovimiento
-- ================================================================
PRINT '>>> [8/21] TiposMovimiento';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[TiposMovimiento]', 'U') IS NOT NULL
        DROP TABLE [dbo].[TiposMovimiento];

    CREATE TABLE [dbo].[TiposMovimiento] (
    [TmoId] VARCHAR(30) NOT NULL,
    [TmoNombre] NVARCHAR(100) NOT NULL,
    [TmoDescripcion] NVARCHAR(500) NULL,
    [TmoPrefijo] VARCHAR(5) NOT NULL,
    [TmoSecuencia] VARCHAR(30) NULL,
    [TmoAfectaSaldo] SMALLINT NOT NULL,
    [TmoGeneraDeuda] BIT NOT NULL,
    [TmoAplicaRecurso] BIT NOT NULL,
    [TmoRequiereDoc] BIT NOT NULL,
    [TmoActivo] BIT NOT NULL,
    [TmoOrden] INT NOT NULL,
    [TmoFechaAlta] DATETIME NOT NULL
    );

    -- INSERT (7 filas)
    INSERT INTO [dbo].[TiposMovimiento] ([TmoId], [TmoNombre], [TmoDescripcion], [TmoPrefijo], [TmoSecuencia], [TmoAfectaSaldo], [TmoGeneraDeuda], [TmoAplicaRecurso], [TmoRequiereDoc], [TmoActivo], [TmoOrden], [TmoFechaAlta]) VALUES
        ('AJUSTE', 'Ajuste manual', 'Corrección manual de saldo autorizada por administrador.', '', NULL, 0, 0, 0, 0, 1, 60, '2026-03-24 22:07:44'),
        ('ANTICIPO', 'Anticipo / Pago anticipado', 'Saldo a favor aplicado antes del vencimiento.', '', NULL, 1, 0, 0, 0, 1, 30, '2026-03-24 22:07:44'),
        ('ENTRADA', 'Entrada de recursos', 'Ingreso al inventario de metros / unidades (compra de plan).', '', NULL, 1, 0, 1, 0, 1, 110, '2026-03-24 22:07:44'),
        ('ENTREGA', 'Entrega de recursos', 'Salida del inventario al entregar una orden.', '', NULL, -1, 0, 1, 0, 1, 120, '2026-03-24 22:07:44'),
        ('NOTA_CREDITO', 'Nota de crédito', 'Crédito a favor por pago en exceso o ajuste.', '', NULL, 1, 0, 0, 0, 1, 50, '2026-03-24 22:07:44'),
        ('ORDEN', 'Orden ingresada', 'Débito por una orden de plazo. Resta el saldo del cliente.', '', NULL, -1, 1, 0, 0, 1, 10, '2026-03-24 22:07:44'),
        ('PAGO', 'Pago recibido', 'Acreditación de un pago en efectivo, transferencia, etc.', '', NULL, 1, 0, 0, 0, 1, 20, '2026-03-24 22:07:44');

    COMMIT TRAN;
    PRINT '    OK TiposMovimiento (7 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ERROR TiposMovimiento: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [9/21] Cont_PlanCuentas
-- ================================================================
PRINT '>>> [9/21] Cont_PlanCuentas';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[Cont_PlanCuentas]', 'U') IS NOT NULL
        DROP TABLE [dbo].[Cont_PlanCuentas];

    CREATE TABLE [dbo].[Cont_PlanCuentas] (
    [CueId] INT IDENTITY(1,1) NOT NULL,
    [CueCodigo] VARCHAR(20) NOT NULL,
    [CueNombre] NVARCHAR(100) NOT NULL,
    [CueNivel] INT NOT NULL,
    [CueTipoBase] VARCHAR(20) NOT NULL,
    [CueMoneda] VARCHAR(5) NOT NULL,
    [CueImputable] BIT NOT NULL,
    [CueActiva] BIT NOT NULL
    );

    -- INSERT (47 filas)
    SET IDENTITY_INSERT [dbo].[Cont_PlanCuentas] ON;
    INSERT INTO [dbo].[Cont_PlanCuentas] ([CueId], [CueCodigo], [CueNombre], [CueNivel], [CueTipoBase], [CueMoneda], [CueImputable], [CueActiva]) VALUES
        (1, '1', 'ACTIVO', 1, 'ACTIVO', 'AMBAS', 0, 1),
        (2, '1.1', 'Disponibilidades', 2, 'ACTIVO', 'AMBAS', 0, 1),
        (3, '1.1.1', 'Caja Moneda Nacional (UYU)', 3, 'ACTIVO', 'UYU', 1, 1),
        (4, '1.1.2', 'Caja Moneda Extranjera (USD)', 3, 'ACTIVO', 'USD', 1, 1),
        (5, '1.1.3', 'Bancos Moneda Nacional (UYU)', 3, 'ACTIVO', 'UYU', 1, 1),
        (6, '1.1.4', 'Bancos Moneda Extranjera (USD)', 3, 'ACTIVO', 'USD', 1, 1),
        (7, '1.2', 'Créditos (Cuentas por Cobrar)', 2, 'ACTIVO', 'AMBAS', 0, 1),
        (8, '1.2.1', 'Deudores por Ventas MN (Clientes)', 3, 'ACTIVO', 'UYU', 1, 1),
        (9, '1.2.2', 'Deudores por Ventas ME (Clientes USD)', 3, 'ACTIVO', 'USD', 1, 1),
        (10, '1.2.3', 'Tarjetas de Crédito a Cobrar', 3, 'ACTIVO', 'UYU', 1, 1),
        (11, '1.2.4', 'IVA Compras (Crédito Fiscal)', 3, 'ACTIVO', 'UYU', 1, 1),
        (12, '1.3', 'Inventarios', 2, 'ACTIVO', 'AMBAS', 0, 1),
        (13, '1.3.1', 'Mercaderías de Reventa', 3, 'ACTIVO', 'AMBAS', 1, 1),
        (14, '2', 'PASIVO', 1, 'PASIVO', 'AMBAS', 0, 1),
        (15, '2.1', 'Deudas Comerciales', 2, 'PASIVO', 'AMBAS', 0, 1),
        (16, '2.1.1', 'Acreedores por Compras MN (Proveedores)', 3, 'PASIVO', 'UYU', 1, 1),
        (17, '2.1.2', 'Acreedores por Compras ME (Proveedores USD)', 3, 'PASIVO', 'USD', 1, 1),
        (18, '2.2', 'Deudas Fiscales y Sociales', 2, 'PASIVO', 'AMBAS', 0, 1),
        (19, '2.2.1', 'IVA Ventas Tasa Básica (22%)', 3, 'PASIVO', 'UYU', 1, 1),
        (20, '2.2.2', 'IVA Ventas Tasa Mínima (10%)', 3, 'PASIVO', 'UYU', 1, 1),
        (21, '2.3', 'Ingresos Diferidos (Anticipos)', 2, 'PASIVO', 'AMBAS', 0, 1),
        (22, '2.3.1', 'Anticipos de Clientes (Prepagos, Rollos)', 3, 'PASIVO', 'AMBAS', 1, 1),
        (23, '3', 'PATRIMONIO', 1, 'PATRIMONIO', 'AMBAS', 0, 1),
        (24, '3.1', 'Capital y Reservas', 2, 'PATRIMONIO', 'AMBAS', 1, 1),
        (25, '3.2', 'Resultados Acumulados', 2, 'PATRIMONIO', 'AMBAS', 1, 1),
        (26, '4', 'INGRESOS', 1, 'GANANCIA', 'AMBAS', 0, 1),
        (27, '4.1', 'Ingresos Operativos', 2, 'GANANCIA', 'AMBAS', 0, 1),
        (28, '4.1.1', 'Ventas Servicios / Mostrador', 3, 'GANANCIA', 'AMBAS', 1, 1),
        (29, '4.1.2', 'Ventas de Productos', 3, 'GANANCIA', 'AMBAS', 1, 1),
        (30, '4.2', 'Ingresos No Operativos', 2, 'GANANCIA', 'AMBAS', 0, 1),
        (31, '4.2.1', 'Ganancia por Diferencia de Cambio', 3, 'GANANCIA', 'AMBAS', 1, 1),
        (32, '5', 'EGRESOS', 1, 'PERDIDA', 'AMBAS', 0, 1),
        (33, '5.1', 'Gastos Operativos y Administrativos', 2, 'PERDIDA', 'AMBAS', 0, 1),
        (34, '5.1.01', 'Sueldos y Cargas Sociales', 3, 'PERDIDA', 'UYU', 1, 1),
        (35, '5.1.02', 'Gastos de Papelería y Oficina', 3, 'PERDIDA', 'UYU', 1, 1),
        (36, '5.1.03', 'Mantenimiento y Reparaciones', 3, 'PERDIDA', 'AMBAS', 1, 1),
        (37, '5.1.04', 'Servicios Profesionales', 3, 'PERDIDA', 'AMBAS', 1, 1),
        (38, '5.1.05', 'Consumos Generales (Luz, Agua, Antel)', 3, 'PERDIDA', 'UYU', 0, 1),
        (39, '5.2', 'Gastos Financieros', 2, 'PERDIDA', 'AMBAS', 0, 1),
        (40, '5.2.01', 'Pérdida por Diferencia de Cambio', 3, 'PERDIDA', 'AMBAS', 1, 1),
        (41, '5.2.02', 'Comisiones y Gastos Bancarios', 3, 'PERDIDA', 'AMBAS', 1, 1),
        (42, '1.1.5', 'Valores a Depositar (Cheques)', 3, 'ACTIVO', '1', 1, 1),
        (43, '2.1.3', 'Cheques Diferidos a Pagar', 3, 'PASIVO', '1', 1, 1),
        (44, '5.1.05.01', 'Agua (OSE)', 4, 'PERDIDA', 'UYU', 1, 1),
        (45, '5.1.05.02', 'Luz (UTE)', 4, 'PERDIDA', 'UYU', 1, 1),
        (46, '5.1.05.03', 'Internet (Antel)', 4, 'PERDIDA', 'UYU', 1, 1),
        (47, '1.3.2', 'PEDIDOS EN DEPOSITO', 3, 'ACTIVO', 'AMBAS', 1, 1);
    SET IDENTITY_INSERT [dbo].[Cont_PlanCuentas] OFF;

    COMMIT TRAN;
    PRINT '    OK Cont_PlanCuentas (47 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Cont_PlanCuentas] OFF;
    PRINT '    ERROR Cont_PlanCuentas: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [10/21] Cont_TiposTransaccion
-- ================================================================
PRINT '>>> [10/21] Cont_TiposTransaccion';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[Cont_TiposTransaccion]', 'U') IS NOT NULL
        DROP TABLE [dbo].[Cont_TiposTransaccion];

    CREATE TABLE [dbo].[Cont_TiposTransaccion] (
    [TrtCodigo] VARCHAR(30) NOT NULL,
    [TrtNombre] NVARCHAR(100) NOT NULL,
    [TrtDescripcion] NVARCHAR(500) NULL,
    [TrtUsaEntidad] BIT NOT NULL,
    [TrtEstado] BIT NOT NULL
    );

    -- INSERT (7 filas)
    INSERT INTO [dbo].[Cont_TiposTransaccion] ([TrtCodigo], [TrtNombre], [TrtDescripcion], [TrtUsaEntidad], [TrtEstado]) VALUES
        ('ASIENTO_MAN', 'Asiento Manual', 'Asiento libre sin estructura fija.', 0, 1),
        ('COBRO_CTA', 'Cobro de Cuenta', 'Pago recibido y cargado a favor del cliente.', 1, 1),
        ('VTA_CAJA', 'Venta en Caja', 'Venta realizada desde el punto de venta directo.', 1, 1),
        ('TES_CHEQUE_REC', 'Recibir Cheque', 'Ingreso Cheque de Tercero (A Cartera)', 1, 1),
        ('TES_CHEQUE_DEP', 'Depósito Cheque', 'Depósito Bancario de Cheque', 1, 1),
        ('TES_CHEQUE_END', 'Endoso Cheque', 'Endoso de Cheque a Proveedor', 1, 1),
        ('TES_CHEQUE_EMI', 'Emitir Cheque', 'Emisión Cheque Propio (A Proveedor)', 1, 1);

    COMMIT TRAN;
    PRINT '    OK Cont_TiposTransaccion (7 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ERROR Cont_TiposTransaccion: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [11/21] Cont_EventosContables
-- ================================================================
PRINT '>>> [11/21] Cont_EventosContables';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[Cont_EventosContables]', 'U') IS NOT NULL
        DROP TABLE [dbo].[Cont_EventosContables];

    CREATE TABLE [dbo].[Cont_EventosContables] (
    [EvtCodigo] VARCHAR(30) NOT NULL,
    [EvtNombre] NVARCHAR(100) NOT NULL,
    [EvtDescripcion] NVARCHAR(500) NULL,
    [EvtPrefijo] VARCHAR(5) NULL,
    [EvtSubtipo] VARCHAR(30) NULL,
    [EvtAfectaSaldo] SMALLINT NOT NULL,
    [EvtGeneraDeuda] BIT NOT NULL,
    [EvtAplicaRecurso] BIT NOT NULL,
    [EvtUsaEntidad] BIT NOT NULL,
    [EvtRequiereDoc] BIT NOT NULL,
    [EvtActivo] BIT NOT NULL,
    [EvtOrden] INT NOT NULL,
    [EvtFechaAlta] DATETIME NOT NULL
    );

    -- INSERT (39 filas)
    INSERT INTO [dbo].[Cont_EventosContables] ([EvtCodigo], [EvtNombre], [EvtDescripcion], [EvtPrefijo], [EvtSubtipo], [EvtAfectaSaldo], [EvtGeneraDeuda], [EvtAplicaRecurso], [EvtUsaEntidad], [EvtRequiereDoc], [EvtActivo], [EvtOrden], [EvtFechaAlta]) VALUES
        ('01', 'E-Factura Contado', 'E-Factura Contado Caja 2', 'FC', NULL, -1, 0, 0, 1, 1, 1, 1, '2026-03-30 23:29:47'),
        ('02', 'E-Factura Credito', 'eFact 111 - Caja 2', 'FC', NULL, -1, 1, 0, 1, 1, 1, 2, '2026-03-30 23:29:47'),
        ('03', 'E-Factura Dev.Contado', 'eFact 112 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 1, 3, '2026-03-30 23:29:47'),
        ('04', 'E-Factura Nota De Credito', 'eFact 112 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 1, 4, '2026-03-30 23:29:47'),
        ('07', 'E-Ticket Contado', 'eFact 101 - Caja 2', 'TK', NULL, -1, 0, 0, 1, 1, 1, 7, '2026-03-30 23:29:47'),
        ('08', 'E-Ticket Credito', 'eFact 101 - Caja 2', 'TK', NULL, -1, 1, 0, 1, 1, 1, 8, '2026-03-30 23:29:47'),
        ('09', 'E-Ticket Dev.Contado', 'eFact 102 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 1, 9, '2026-03-30 23:29:47'),
        ('10', 'E-Ticket Nota De Credito', 'eFact 102 - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 1, 10, '2026-03-30 23:29:47'),
        ('100', 'E-Ticket Nota de Credito Admin', 'eFact 102 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 0, 100, '2026-03-30 23:29:47'),
        ('101', 'E-Factura Contado Admin', 'eFact 111 - Caja 3', 'FC', NULL, -1, 0, 0, 1, 1, 0, 101, '2026-03-30 23:29:47'),
        ('102', 'E-Factura Credito Admin', 'eFact 111 - Caja 3', 'FC', NULL, -1, 1, 0, 1, 1, 0, 102, '2026-03-30 23:29:47'),
        ('103', 'E-Factura Dev.Contado Admin', 'eFact 112 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 0, 103, '2026-03-30 23:29:47'),
        ('104', 'E-Factura Nota De Credito Admin', 'eFact 112 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 0, 104, '2026-03-30 23:29:47'),
        ('107', 'E-Ticket Contado Admin', 'eFact 101 - Caja 3', 'TK', NULL, -1, 0, 0, 1, 1, 0, 107, '2026-03-30 23:29:47'),
        ('108', 'E-Ticket Credito Admin', 'eFact 101 - Caja 3', 'TK', NULL, -1, 1, 0, 1, 1, 0, 108, '2026-03-30 23:29:47'),
        ('109', 'E-Ticket Dev.Contado Admin', 'eFact 102 - Caja 3', 'NC', NULL, 1, 0, 0, 1, 1, 0, 109, '2026-03-30 23:29:47'),
        ('40', 'Pedidos Caja', 'Interno (0) - Caja 2', 'PE', NULL, -1, 0, 0, 1, 1, 0, 40, '2026-03-30 23:29:47'),
        ('41', 'Dev Pedidos Caja', 'Interno (0) - Caja 2', 'NC', NULL, 1, 0, 0, 1, 1, 0, 41, '2026-03-30 23:29:47'),
        ('AJUSTE', 'Ajuste manual', 'Corrección manual de saldo autorizada por administrador.', '', NULL, 0, 0, 0, 0, 0, 1, 60, '2026-03-30 23:29:47'),
        ('ANTICIPO', 'Anticipo / Pago anticipado', 'Saldo a favor aplicado antes del vencimiento.', '', NULL, 1, 0, 0, 1, 0, 1, 30, '2026-03-30 23:29:47'),
        ('ASIENTO_MAN', 'Asiento Manual', 'Asiento libre sin estructura fija.', NULL, NULL, 0, 0, 0, 0, 0, 1, 220, '2026-03-30 23:29:47'),
        ('CIERRE_CICLO', 'Cierre de ciclo semanal', 'Marca de cierre de ciclo. Importe neutro — solo trazabilidad.', NULL, NULL, 0, 0, 0, 0, 1, 1, 80, '2026-03-30 23:29:47'),
        ('COBRO_CTA', 'Cobro de Cuenta', 'Pago recibido y cargado a favor del cliente.', NULL, NULL, 1, 0, 0, 1, 0, 1, 210, '2026-03-30 23:29:47'),
        ('ENTRADA', 'Entrada de recursos', 'Ingreso al inventario de metros / unidades (compra de plan).', '', NULL, 1, 0, 1, 1, 0, 1, 110, '2026-03-30 23:29:47'),
        ('ENTREGA', 'Entrega de recursos', 'Salida del inventario al entregar una orden.', '', NULL, -1, 0, 1, 1, 0, 1, 120, '2026-03-30 23:29:47'),
        ('FACTURA', 'Factura de venta', 'Factura de venta de plan de recursos.', 'FC', 'FACTURA_PLAN', -1, 1, 0, 1, 1, 0, 210, '2026-03-30 23:29:47'),
        ('FACTURA_CICLO', 'Factura de ciclo semanal', 'Factura emitida al cerrar un ciclo de crédito semanal.', 'FC', 'FACTURA_CICLO', -1, 1, 0, 1, 1, 0, 220, '2026-03-30 23:29:47'),
        ('NOTA_CREDITO', 'Nota de crédito', 'Crédito a favor por pago en exceso o ajuste.', '', NULL, 1, 0, 0, 1, 0, 1, 50, '2026-03-30 23:29:47'),
        ('ORDEN', 'Orden ingresada', 'Débito por una orden de plazo. Resta el saldo del cliente.', NULL, NULL, -1, 1, 0, 1, 0, 1, 10, '2026-03-30 23:29:47'),
        ('PAGO', 'Pago recibido', 'Acreditación de un pago en efectivo, transferencia, etc.', '', NULL, 1, 0, 0, 1, 0, 1, 20, '2026-03-30 23:29:47'),
        ('RECIBO', 'Recibo de pago', 'Constancia de cobro inmediato. No genera deuda pendiente.', 'RC', 'RECIBO_PLAN', 1, 0, 0, 1, 1, 0, 230, '2026-03-30 23:29:47'),
        ('REPOSICION', 'Reposición sin cargo', 'Orden de reposición. No genera débito ni consume recursos.', '', NULL, 0, 0, 0, 0, 0, 1, 70, '2026-03-30 23:29:47'),
        ('SALDO_INICIAL', 'Saldo inicial', 'Saldo de apertura de una cuenta nueva.', '', NULL, 1, 0, 0, 1, 0, 1, 40, '2026-03-30 23:29:47'),
        ('TICKET', 'Ticket / Comprobante interno', 'Comprobante interno sin efecto contable. Solo trazabilidad.', 'TK', NULL, 0, 0, 0, 0, 0, 0, 240, '2026-03-30 23:29:47'),
        ('VTA_CAJA', 'Venta en Caja', 'Venta realizada desde el punto de venta directo.', NULL, NULL, -1, 1, 0, 1, 0, 1, 200, '2026-03-30 23:29:47'),
        ('TES_CHEQUE_REC', 'Recibir Cheque Tercero', NULL, 'CHQR', 'TESORERIA', 1, 0, 0, 1, 0, 1, 100, '2026-04-23 01:14:27'),
        ('TES_CHEQUE_DEP', 'Depositar Cheque Tercero', NULL, 'CHQD', 'TESORERIA', 0, 0, 0, 1, 0, 1, 100, '2026-04-23 01:14:27'),
        ('TES_CHEQUE_END', 'Endosar Cheque Tercero', NULL, 'CHQE', 'TESORERIA', -1, 0, 0, 1, 0, 1, 100, '2026-04-23 01:14:27'),
        ('TES_CHEQUE_EMI', 'Emitir Cheque Propio', NULL, 'CHQP', 'TESORERIA', -1, 0, 0, 1, 0, 1, 100, '2026-04-23 01:14:27');

    COMMIT TRAN;
    PRINT '    OK Cont_EventosContables (39 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ERROR Cont_EventosContables: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [12/21] Cont_ReglasEventos
-- ================================================================
PRINT '>>> [12/21] Cont_ReglasEventos';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[Cont_ReglasEventos]', 'U') IS NOT NULL
        DROP TABLE [dbo].[Cont_ReglasEventos];

    CREATE TABLE [dbo].[Cont_ReglasEventos] (
    [RegId] INT IDENTITY(1,1) NOT NULL,
    [RegCodigo] VARCHAR(50) NOT NULL,
    [RegNombre] NVARCHAR(100) NOT NULL,
    [RegCuentaDebe] INT NULL,
    [RegCuentaHaber] INT NULL,
    [RegObservacion] NVARCHAR(200) NULL
    );

    -- INSERT (7 filas)
    SET IDENTITY_INSERT [dbo].[Cont_ReglasEventos] ON;
    INSERT INTO [dbo].[Cont_ReglasEventos] ([RegId], [RegCodigo], [RegNombre], [RegCuentaDebe], [RegCuentaHaber], [RegObservacion]) VALUES
        (1, 'VENTA_CONTADO_UYU', 'Venta Contado en Efectivo (Pesos)', NULL, NULL, NULL),
        (2, 'VENTA_CONTADO_USD', 'Venta Contado en Efectivo (Dólares)', NULL, NULL, NULL),
        (3, 'VENTA_CREDITO_UYU', 'Venta a Crédito en Cuenta Corriente (Pesos)', NULL, NULL, NULL),
        (4, 'COBRO_DEUDA_UYU', 'Cobro de Deuda Clientes en Efectivo (Pesos)', NULL, NULL, NULL),
        (5, 'CONSUMO_ANTICIPO', 'Consumo de Rollo Adelantado / Prepago', NULL, NULL, NULL),
        (6, 'DIFERENCIA_CAMBIO_G', 'Asiento Automático: Ganancia Dif. Cambio', NULL, NULL, NULL),
        (7, 'DIFERENCIA_CAMBIO_P', 'Asiento Automático: Pérdida Dif. Cambio', NULL, NULL, NULL);
    SET IDENTITY_INSERT [dbo].[Cont_ReglasEventos] OFF;

    COMMIT TRAN;
    PRINT '    OK Cont_ReglasEventos (7 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Cont_ReglasEventos] OFF;
    PRINT '    ERROR Cont_ReglasEventos: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [13/21] Cont_ReglasContables
-- ================================================================
PRINT '>>> [13/21] Cont_ReglasContables';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[Cont_ReglasContables]', 'U') IS NOT NULL
        DROP TABLE [dbo].[Cont_ReglasContables];

    CREATE TABLE [dbo].[Cont_ReglasContables] (
    [RgcId] INT IDENTITY(1,1) NOT NULL,
    [TrtCodigo] VARCHAR(30) NOT NULL,
    [CueCodigo] VARCHAR(20) NOT NULL,
    [RgcNaturaleza] VARCHAR(10) NOT NULL,
    [RgcFilaFormula] VARCHAR(50) NOT NULL,
    [RgcOrden] INT NOT NULL
    );

    -- INSERT (5 filas)
    SET IDENTITY_INSERT [dbo].[Cont_ReglasContables] ON;
    INSERT INTO [dbo].[Cont_ReglasContables] ([RgcId], [TrtCodigo], [CueCodigo], [RgcNaturaleza], [RgcFilaFormula], [RgcOrden]) VALUES
        (1, 'VTA_CAJA', 'META_CLIENTE', 'DEBE', 'TOTAL', 10),
        (2, 'VTA_CAJA', '4.1.1.01', 'HABER', 'NETO', 20),
        (3, 'VTA_CAJA', '2.1.2.01', 'HABER', 'IVA', 30),
        (4, 'COBRO_CTA', '1.1.1.01', 'DEBE', 'TOTAL', 10),
        (5, 'COBRO_CTA', 'META_CLIENTE', 'HABER', 'TOTAL', 20);
    SET IDENTITY_INSERT [dbo].[Cont_ReglasContables] OFF;

    COMMIT TRAN;
    PRINT '    OK Cont_ReglasContables (5 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Cont_ReglasContables] OFF;
    PRINT '    ERROR Cont_ReglasContables: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [14/21] Cont_ReglasAsiento
-- ================================================================
PRINT '>>> [14/21] Cont_ReglasAsiento';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[Cont_ReglasAsiento]', 'U') IS NOT NULL
        DROP TABLE [dbo].[Cont_ReglasAsiento];

    CREATE TABLE [dbo].[Cont_ReglasAsiento] (
    [RasId] INT IDENTITY(1,1) NOT NULL,
    [EvtCodigo] VARCHAR(30) NOT NULL,
    [CueCodigo] VARCHAR(30) NOT NULL,
    [RasNaturaleza] VARCHAR(10) NOT NULL,
    [RasFormula] VARCHAR(50) NOT NULL,
    [RasOrden] INT NOT NULL
    );

    -- INSERT (49 filas)
    SET IDENTITY_INSERT [dbo].[Cont_ReglasAsiento] ON;
    INSERT INTO [dbo].[Cont_ReglasAsiento] ([RasId], [EvtCodigo], [CueCodigo], [RasNaturaleza], [RasFormula], [RasOrden]) VALUES
        (15, 'ANTICIPO', 'META_CAJA', 'DEBE', 'TOTAL', 10),
        (16, 'ANTICIPO', 'META_CLIENTE', 'HABER', 'TOTAL', 20),
        (17, 'NOTA_CREDITO', 'META_CLIENTE', 'DEBE', 'TOTAL', 10),
        (18, 'NOTA_CREDITO', '4.1.1.01', 'HABER', 'TOTAL', 20),
        (19, 'PAGO', 'META_CAJA', 'DEBE', 'TOTAL', 10),
        (20, 'PAGO', 'META_CLIENTE', 'HABER', 'TOTAL', 20),
        (1030, 'ENTRADA', 'META_CAJA', 'DEBE', 'TOTAL', 10),
        (1031, 'ENTRADA', '2.3.1', 'HABER', 'TOTAL', 10),
        (1032, 'ENTREGA', '2.3.1', 'DEBE', 'TOTAL', 10),
        (1033, 'ENTREGA', '4.1.1', 'HABER', 'TOTAL', 10),
        (1088, '01', 'META_CLIENTE', 'DEBE', 'TOTAL', 10),
        (1089, '01', '4.1.1', 'HABER', 'NETO', 10),
        (1090, '01', '2.2.1', 'HABER', 'IVA', 10),
        (1040, '02', 'META_CLIENTE', 'DEBE', 'TOTAL', 10),
        (1041, '02', '4.1.1', 'HABER', 'NETO', 10),
        (1042, '02', '2.2.1', 'HABER', 'IVA', 10),
        (1043, '07', 'META_CLIENTE', 'DEBE', 'TOTAL', 10),
        (1044, '07', '4.1.1', 'HABER', 'NETO', 10),
        (1045, '07', '2.2.1', 'HABER', 'IVA', 10),
        (1046, '08', 'META_CLIENTE', 'DEBE', 'TOTAL', 10),
        (1047, '08', '4.1.1', 'HABER', 'NETO', 10),
        (1048, '08', '2.2.1', 'HABER', 'IVA', 10),
        (1049, 'COBRO_CTA', 'META_CAJA', 'DEBE', 'TOTAL', 10),
        (1050, 'COBRO_CTA', 'META_CLIENTE', 'HABER', 'TOTAL', 10),
        (1051, 'RECIBO', 'META_CAJA', 'DEBE', 'TOTAL', 10),
        (1052, 'RECIBO', 'META_CLIENTE', 'HABER', 'TOTAL', 10),
        (1053, 'FACTURA_CICLO', 'META_CLIENTE', 'DEBE', 'TOTAL', 10),
        (1054, 'FACTURA_CICLO', '4.1.1', 'HABER', 'NETO', 10),
        (1055, 'FACTURA_CICLO', '2.2.1', 'HABER', 'IVA', 10),
        (1056, '03', '5.1.1', 'DEBE', 'NETO', 10),
        (1057, '03', '2.2.1', 'DEBE', 'IVA', 10),
        (1058, '03', 'META_CLIENTE', 'HABER', 'TOTAL', 10),
        (1059, '09', '5.1.1', 'DEBE', 'NETO', 10),
        (1060, '09', '2.2.1', 'DEBE', 'IVA', 10),
        (1061, '09', 'META_CLIENTE', 'HABER', 'TOTAL', 10),
        (1071, 'ORDEN', 'META_CLIENTE', 'DEBE', 'TOTAL', 10),
        (1072, 'ORDEN', '4.1.1', 'HABER', 'NETO', 20),
        (1073, 'ORDEN', '2.2.1', 'HABER', 'IVA', 30),
        (1077, 'VTA_CAJA', 'META_CAJA', 'DEBE', 'TOTAL', 10),
        (1078, 'VTA_CAJA', '4.1.1', 'HABER', 'NETO', 20),
        (1079, 'VTA_CAJA', '2.2.1', 'HABER', 'IVA', 30),
        (1080, 'TES_CHEQUE_REC', '1.1.5', 'DEBE', 'TOTAL', 1),
        (1081, 'TES_CHEQUE_REC', 'META_CLIENTE', 'HABER', 'TOTAL', 2),
        (1082, 'TES_CHEQUE_DEP', '1.1.3', 'DEBE', 'TOTAL', 1),
        (1083, 'TES_CHEQUE_DEP', '1.1.5', 'HABER', 'TOTAL', 2),
        (1084, 'TES_CHEQUE_END', '2.1.1', 'DEBE', 'TOTAL', 1),
        (1085, 'TES_CHEQUE_END', '1.1.5', 'HABER', 'TOTAL', 2),
        (1086, 'TES_CHEQUE_EMI', '2.1.1', 'DEBE', 'TOTAL', 1),
        (1087, 'TES_CHEQUE_EMI', '2.1.3', 'HABER', 'TOTAL', 2);
    SET IDENTITY_INSERT [dbo].[Cont_ReglasAsiento] OFF;

    COMMIT TRAN;
    PRINT '    OK Cont_ReglasAsiento (49 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Cont_ReglasAsiento] OFF;
    PRINT '    ERROR Cont_ReglasAsiento: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [15/21] Articulos
-- ================================================================
PRINT '>>> [15/21] Articulos';
BEGIN TRY
    BEGIN TRAN;

    -- Tabla con FK entrantes: DELETE + INSERT (no DROP)
    DELETE FROM [dbo].[Articulos];
    DBCC CHECKIDENT ('[dbo].[Articulos]', RESEED, 0) WITH NO_INFOMSGS;

    -- INSERT (249 filas)
    SET IDENTITY_INSERT [dbo].[Articulos] ON;
    INSERT INTO [dbo].[Articulos] ([ProIdProducto], [CodArticulo], [IDProdReact], [SupFlia], [Grupo], [CodStock], [Descripcion], [Mostrar], [anchoimprimible], [LLEVAPAPEL], [MonIdMoneda], [ProCodigoOdooProducto], [UniIdUnidad], [borrar]) VALUES
        (1, '1                   ', 38, '1       ', '1.1                 ', '1.1.1.3             ', 'Tela Cliente (Minimo 5mts)                                                                          ', 1, 0, 0, 2, 'ST-CL-', 2, 0),
        (2, '10                  ', 54, '1       ', '1.1                 ', '1.1.1.1             ', 'Saten (1,50)                                                                                        ', 1, 0, 0, 2, 'ST-FS-', 2, 0),
        (9, '1558                ', 160, '1       ', '1.11                ', '1.1.11.1            ', 'Tela de bandera (3,10)                                                                              ', 1, 3.0999999, 0, NULL, NULL, 2, 0),
        (25, '107                 ', 249, '1       ', '1.4                 ', '1.1.4.1             ', 'Parche bordado sobre prenda con tafeta                                                              ', 1, NULL, NULL, 1, 'Bordado', 2, 0),
        (26, '108                 ', 250, '1       ', '1.4                 ', '1.1.4.1             ', 'Parche bordado sobre prenda 100% hilo                                                               ', 1, NULL, NULL, 1, 'Bordado', 2, 0),
        (27, '109                 ', 211, '1       ', '1.4                 ', '1.1.4.1             ', 'Parche adhesivo con tafeta                                                                          ', 1, NULL, NULL, 1, 'Bordado', 2, 0),
        (28, '11                  ', 55, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry Pro (1,80)                                                                                      ', 1, 1.79999995, 0, 2, 'ST-DP-', 2, 0),
        (29, '110                 ', 84, '1       ', '1.5                 ', '1.1.5.1             ', 'Estampado                                                                                           ', 1, 0, 0, 1, 'ES-TA-', 2, 0),
        (32, '1560                ', 162, '1       ', '1.11                ', '1.1.11.1            ', 'Tela Blackout – Tela Doble Cara (2,9)                                                               ', 1, 0, 0, NULL, NULL, NULL, 0),
        (36, '115                 ', 219, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura                                                                                             ', 1, 0, 0, 1, '1', 2, 0),
        (38, '116                 ', 220, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura camiseta con detalles                                                                       ', 1, NULL, NULL, 1, '1', 2, 0),
        (40, '1178                ', 221, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura camiseta compleja                                                                           ', 1, NULL, NULL, 1, '1', 2, 0),
        (41, '1179                ', 239, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura shorts                                                                                      ', 1, NULL, NULL, 1, '1', 2, 0),
        (44, '12                  ', 56, '1       ', '1.1                 ', '1.1.1.1             ', 'Bandera (1,60)                                                                                      ', 1, 0, 0, 2, 'ST-BA-', 2, 0),
        (48, '1215                ', 116, '1       ', '1.1                 ', '1.1.1.1             ', 'Microfibra RV Waterproof (1,50)                                                                     ', 1, 0, 0, 2, '1', 2, 0),
        (49, '1216                ', 117, '1       ', '1.1                 ', '1.1.1.1             ', 'Microfibra Short                                                                                    ', 1, 0, 0, 2, '1', 2, 0),
        (50, '1217                ', 118, '1       ', '1.1                 ', '1.1.1.1             ', 'Tela UrbanFit                                                                                       ', 1, 0, 0, 2, '1', 2, 1),
        (51, '1218                ', 119, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry milan 1,83                                                                                      ', 1, 1.83000004, 0, 2, '1', 2, 1),
        (52, '1219                ', 111, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry Polo (1,80)                                                                                     ', 1, 1.79999995, 0, 2, '1', 2, 0),
        (53, '1220                ', 112, '1       ', '1.1                 ', '1.1.1.1             ', 'NeoStretch (1,83)                                                                                   ', 1, 0, 0, 2, '1', 2, 0),
        (54, '1221                ', 134, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry Microporoso new 1.73 (lado  poroso)                                                             ', 1, 1.73000002, 0, 2, '1', 2, 1),
        (56, '1223                ', 137, '1       ', '1.1                 ', '1.1.1.1             ', 'Delta (1,72 m)                                                                                      ', 1, 0, 0, 2, '1', 2, 0),
        (57, '1224                ', 138, '1       ', '1.1                 ', '1.1.1.1             ', 'Nagasaki (1,80 m)                                                                                   ', 1, 0, 0, 2, '1', 2, 0),
        (58, '1225                ', 139, '1       ', '1.1                 ', '1.1.1.1             ', 'Grid (1,70 m)                                                                                       ', 1, 0, 0, 2, '1', 2, 0),
        (68, '1353                ', 246, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser camiseta simple                                                                         ', 1, NULL, NULL, NULL, NULL, 2, 0),
        (70, '1355                ', 245, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser camiseta con detalles                                                                   ', 1, NULL, NULL, NULL, NULL, 2, 0),
        (71, '1356                ', 244, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Camiseta compleja                                                                       ', 1, NULL, NULL, NULL, NULL, 2, 0),
        (72, '1357                ', 238, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Shorts                                                                                  ', 1, NULL, NULL, NULL, NULL, 2, 0),
        (73, '1358                ', 222, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Short-pollera                                                                           ', 1, NULL, NULL, 2, '1', 2, 0),
        (74, '1359                ', 247, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Campera                                                                                 ', 1, NULL, NULL, 2, '1', 2, 0),
        (75, '1360                ', 243, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Buzo y buzo con cierre                                                                  ', 1, NULL, NULL, 2, '1', 2, 0),
        (76, '1361                ', 223, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Camperas, buzos y canguros 2 colores                                                    ', 1, NULL, NULL, 2, '1', 2, 0),
        (77, '1362                ', 235, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Pantalón                                                                                ', 1, NULL, NULL, 2, '1', 2, 0),
        (78, '1363                ', 241, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Banderas piezas (1 pieza hasta 1,80 m X 4,00 m)                                         ', 1, NULL, NULL, 2, '1', 2, 0),
        (79, '1364                ', 240, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Bandera x metro cuadrado                                                                ', 1, NULL, NULL, 2, '1', 2, 0),
        (80, '1365                ', 224, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Bandera de auto                                                                         ', 1, NULL, NULL, 2, '1', 2, 0),
        (81, '1366                ', 242, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Banderín triangular                                                                     ', 1, NULL, NULL, 2, '1', 2, 0),
        (82, '1367                ', 237, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Piezas (1 pieza hasta 1,20 m X 1,80 m)                                                  ', 1, NULL, NULL, 2, '1', 2, 0),
        (83, '1368                ', 236, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Piezas (1 pieza hasta 0,6 m X 0.9 m)                                                    ', 1, NULL, NULL, 2, '1', 2, 0),
        (84, '1369                ', 225, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Piezas (1 pieza hasta 0,20 m X 0,20 m)                                                  ', 1, NULL, NULL, 2, '1', 2, 0),
        (86, '1371                ', 227, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Chaleco                                                                                 ', 1, NULL, NULL, 2, '1', 2, 0),
        (87, '1372                ', 234, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Etiquetas para ropa                                                                     ', 1, NULL, NULL, 2, '1', 2, 0),
        (88, '1373                ', 233, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Cuellitos / buffs                                                                       ', 1, NULL, NULL, 2, '1', 2, 0),
        (89, '1374                ', 228, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Letras y números                                                                        ', 1, NULL, NULL, 2, '1', 2, 0),
        (90, '1375                ', 253, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser por prenda                                                                              ', 1, 0, 0, 2, '1', 2, NULL),
        (91, '1376                ', 229, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Capa barbería                                                                           ', 1, NULL, NULL, 2, '1', 2, 0),
        (113, '1398                ', 230, '1       ', '1.7                 ', '1.1.7.1             ', 'Cosstura de Almohadones con cierre                                                                  ', 1, NULL, NULL, 1, '1', 2, 0),
        (180, '1464                ', 254, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser por prenda                                                                              ', 1, 0, 0, NULL, NULL, 2, NULL),
        (181, '1465                ', 216, '1       ', '1.3                 ', '1.1.3.2             ', 'Roll up aluminio                                                                                    ', 1, 0, 0, NULL, NULL, 2, 0),
        (191, '1475                ', 191, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de short-pollera                                                                            ', 1, NULL, NULL, 1, '1', 2, 0),
        (192, '1476                ', 192, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de campera                                                                                  ', 1, NULL, NULL, 1, '1', 2, 0),
        (193, '1477                ', 193, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de buzo y buzo con cierre                                                                   ', 1, NULL, NULL, 1, '1', 2, 0),
        (194, '1478                ', 194, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de camperas, buzos y canguros                                                               ', 1, NULL, NULL, 1, '1', 2, 0),
        (195, '1479                ', 195, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de pantalón                                                                                 ', 1, NULL, NULL, 1, '1', 2, 0),
        (196, '1480                ', 196, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de bandera piezas (1 pieza hasta 1,80 m x 4,00 m)                                           ', 1, NULL, NULL, 1, '1', 2, 0),
        (197, '1481                ', 197, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de bandera x metro cuadrado                                                                 ', 1, NULL, NULL, 1, '1', 2, 0),
        (198, '1482                ', 198, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de bandera de auto                                                                          ', 1, NULL, NULL, 1, '1', 2, 0),
        (199, '1483                ', 199, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de banderín triangular                                                                      ', 1, NULL, NULL, 1, '1', 2, 0),
        (200, '1484                ', 200, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de piezas (1 pieza hasta 1,20 m x 1,80 m)                                                   ', 1, NULL, NULL, 1, '1', 2, 0),
        (201, '1485                ', 201, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de piezas (1 pieza hasta 0,6 m x 0.9 m)                                                     ', 1, NULL, NULL, 1, '1', 2, 0),
        (202, '1486                ', 202, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de piezas (1 pieza hasta 0,20 m x 0,20 m)                                                   ', 1, NULL, NULL, 1, '1', 2, 0),
        (203, '1487                ', 203, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de balconera                                                                                ', 1, NULL, NULL, 1, '1', 2, 0),
        (204, '1488                ', 204, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de chaleco                                                                                  ', 1, NULL, NULL, 1, '1', 2, 0),
        (205, '1489                ', 205, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de cuellitos / buffs                                                                        ', 1, NULL, NULL, 1, '1', 2, 0),
        (206, '1490                ', 206, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de capa barbería                                                                            ', 1, NULL, NULL, 1, '1', 2, 0),
        (207, '1491                ', 207, '1       ', '1.7                 ', '1.1.7.1             ', 'Costura de totebag                                                                                  ', 1, NULL, NULL, 1, '1', 2, 0),
        (208, '1499                ', 113, '1       ', '1.1                 ', '1.1.1.1             ', 'Jacquard city 1,83                                                                                  ', 1, 0, 0, 2, '1', 2, 0),
        (209, '15                  ', 59, '1       ', '1.1                 ', '1.1.1.1             ', 'Micro fibra (1,50)                                                                                  ', 1, 0, 0, 2, 'ST-MF-', 2, 1),
        (212, '16                  ', 60, '1       ', '1.1                 ', '1.1.1.1             ', 'Polar (1,50)                                                                                        ', 1, 0, 0, 2, 'ST-P-', 2, 0),
        (213, '17                  ', 62, '1       ', '1.1                 ', '1.1.1.1             ', 'Mykonos (1,60)                                                                                      ', 1, 0, 0, 2, 'ST-MY-', 2, 1),
        (214, '18                  ', 63, '1       ', '1.1                 ', '1.1.1.1             ', 'Deportiva (1,60)                                                                                    ', 1, 0, 0, 2, 'ST-DE-', 2, 0),
        (216, '2                   ', 39, '1       ', '1.1                 ', '1.1.1.1             ', 'Toalla (1,80)                                                                                       ', 1, 1.83000004, 0, 2, 'ST-T-', 2, 0),
        (217, '20                  ', 2, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry Poroso (1,50)                                                                                   ', 1, 1.5, 0, NULL, NULL, 2, 0),
        (218, '21                  ', 64, '1       ', '1.1                 ', '1.1.1.1             ', 'Bandera Confeccionada (1,50x0,85)                                                                   ', 1, 0, 0, 1, 'BC150X09', 2, 1),
        (219, '22                  ', 58, '1       ', '1.1                 ', '1.1.1.1             ', 'Adis Elastizado (1,50)                                                                              ', 1, 1.5, 0, NULL, NULL, 2, 1),
        (220, '23                  ', 5, '1       ', '1.1                 ', '1.1.1.1             ', 'Modal (1,50)                                                                                        ', 1, 0, 0, 2, 'ST-MO-', 2, 0),
        (85, '1370                ', 226, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Balconera                                                                               ', 1, 0, 0, 2, '1', 2, 0),
        (221, '24                  ', 6, '1       ', '1.1                 ', '1.1.1.1             ', 'Lycra (1,60)                                                                                        ', 1, 0, 0, 2, 'ST-L-', 2, 0),
        (222, '25                  ', 7, '1       ', '1.1                 ', '1.1.1.1             ', 'Micropolar (1,50)                                                                                   ', 1, 0, 0, 2, 'ST-MP-', 2, 1),
        (223, '26                  ', 29, '1       ', '1.1                 ', '1.1.1.1             ', 'Jacquard Elite 1,83                                                                                 ', 1, 0, 0, 2, 'JACADI180', 2, 0),
        (224, '27                  ', 30, '1       ', '1.1                 ', '1.1.1.1             ', 'Jacquard Supreme 1,83                                                                               ', 1, 1.83000004, 0, 2, 'JACNIK180', 2, 1),
        (225, '28                  ', 31, '1       ', '1.1                 ', '1.1.1.1             ', 'Rib 1,70 (Cuellos y vivos tela Elite y Supreme)                                                     ', 1, 0, 0, 2, 'RIB180', 2, 0),
        (226, '29                  ', 32, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry Exclusive (1,83)                                                                                ', 1, 1.83000004, 0, 2, 'DRYEXCL180', 2, 1),
        (227, '3                   ', 40, '1       ', '1.1                 ', '1.1.1.1             ', 'Bandera mesh (1,60) (110g)                                                                          ', 1, 0, 0, 2, 'ST-BM-', 2, 0),
        (228, '30                  ', 33, '1       ', '1.1                 ', '1.1.1.1             ', 'Scuba 1,80                                                                                          ', 1, 0, 0, 2, 'SCU160', 2, 1),
        (229, '31                  ', 34, '1       ', '1.1                 ', '1.1.1.1             ', 'Jacquard 1,83 (Lado poroso)                                                                         ', 1, 0, 0, 2, 'ST-J180-', 2, 1),
        (230, '32                  ', 35, '1       ', '1.1                 ', '1.1.1.1             ', 'Jacquard 1,83 (lado liso)                                                                           ', 1, 0, 0, 2, 'ST-J180-', 2, 1),
        (231, '33                  ', 86, '1       ', '1.1                 ', '1.1.1.1             ', 'ESPECIAL F                                                                                          ', 1, 0, 0, 1, '1', 2, 0),
        (232, '34                  ', 90, '1       ', '1.1                 ', '1.1.1.1             ', 'Jacquard Charrúa (1,83)                                                                             ', 1, 0, 0, 2, 'JACCH183', 2, 1),
        (233, '35                  ', 42, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry Liso (1,83)                                                                                     ', 1, 1.83000004, 0, 2, 'ST-DLR180-', 2, 1),
        (234, '36                  ', 92, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry pique grueso (1,80)                                                                             ', 1, 1.79999995, 0, 2, '1', 2, 1),
        (235, '37                  ', 158, '1       ', '1.1                 ', '1.1.1.1             ', 'Interlock Fina "Fer" (1,83 m)                                                                       ', 1, 0, 0, 2, '1', 2, 0),
        (236, '38                  ', 101, '1       ', '1.1                 ', '1.1.1.1             ', 'Lycra Mykonos (1,80)                                                                                ', 1, 0, 0, 2, 'ST-MY-180-', 2, 0),
        (237, '39                  ', 102, '1       ', '1.1                 ', '1.1.1.1             ', 'Adis Elastizado fino (1,83)                                                                         ', 1, 0, 0, 2, '1', 2, 1),
        (238, '4                   ', 41, '1       ', '1.1                 ', '1.1.1.1             ', 'Bandera fina (1,60) (68g)                                                                           ', 1, 0, 0, 2, 'ST-BF-', 2, 1),
        (239, '40                  ', 103, '1       ', '1.1                 ', '1.1.1.1             ', 'Adis Elastizado Grueso (1,83)                                                                       ', 1, 0, 0, 2, '1', 2, 0),
        (240, '41                  ', 57, '1       ', '1.1                 ', '1.1.1.1             ', 'Panama (1,60)                                                                                       ', 1, 0, 0, 2, 'ST-PA-', 2, 0),
        (244, '45                  ', 135, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry Microporoso 1.77 (lado  poroso)                                                                 ', 1, 1.76999998, 0, 2, '1', 2, 1),
        (245, '46                  ', 136, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry Microporoso 1.77 (lado  liso)                                                                   ', 1, 1.76999998, 0, 2, '1', 2, 1),
        (246, '47                  ', 37, '1       ', '1.1                 ', '1.1.3.1             ', 'Papel                                                                                               ', 1, 1.60000002, 0, 2, 'IPS', 2, 0),
        (247, '48                  ', 47, '1       ', '1.2                 ', '1.1.2.1             ', 'DTF textil COMUN                                                                                    ', 1, 0.569999993, 0, 2, 'IDTF', 2, 0),
        (248, '49                  ', 48, '1       ', '1.2                 ', '1.1.2.1             ', 'DTF textil DORADO                                                                                   ', 1, 0, 0, 2, 'IDTFED', 2, 0),
        (255, '55                  ', 52, '1       ', '1.2                 ', '1.1.2.2             ', 'DTF para rígidos UV                                                                                 ', 1, 0.569999993, 0, 2, 'IDTFUV', 2, 0),
        (258, '6                   ', 43, '1       ', '1.1                 ', '1.1.1.1             ', 'Hexagonal (1,83)                                                                                    ', 1, 0, 0, 2, 'ST-H180-', 2, 0),
        (266, '7                   ', 44, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry Microporoso 1.83 (lado  poroso)                                                                 ', 1, 1.83000004, 0, 2, 'ST-DM180-', 2, 0),
        (277, '8                   ', 45, '1       ', '1.1                 ', '1.1.1.1             ', 'Dry Microporoso 1.83 (lado  liso)                                                                   ', 1, 1.83000004, 0, 2, 'ST-DM180-', 2, 0),
        (288, '9                   ', 46, '1       ', '1.1                 ', '1.1.1.1             ', 'Adis Elastizado (1,83)                                                                              ', 1, 1.83000004, 0, 2, 'ST-AE183-', 2, 1),
        (300, '1571                ', 10, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 3,20 Brillo (reverso gris)                                                               ', 1, 0, 0, 2, 'LOF320ECOGB', 2, 1),
        (301, '1572                ', 11, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 3,20 Mate (reverso gris)                                                                 ', 1, NULL, NULL, 2, 'LOF320ECOGM', 2, 1),
        (302, '1573                ', 12, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Mate (reverso gris)                                                                 ', 1, 0, 0, 2, 'LOF160ECOGM', 2, 1),
        (303, '1574                ', 13, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Brillo (reverso gris)                                                               ', 1, 0, 0, 2, 'LOF160ECOGB', 2, 1),
        (304, '1575                ', 14, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Mate (reverso blanco)                                                               ', 1, 0, 0, 2, 'LOF160ECOBM', 2, 1),
        (305, '1576                ', 15, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Brillo (reverso blanco)                                                             ', 1, 0, 0, 2, 'LOF160ECOBB', 2, 1),
        (307, '1577                ', 17, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,52 (Adhesivo Transparente)                                                          ', 1, 0, 0, 2, 'Vin152BriEcoAT', 2, NULL),
        (308, '1578                ', 18, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Mate hasta 1,49                                                                              ', 1, 0, 0, 2, 'Vin137MatEcoG', 2, 0),
        (309, '1579                ', 19, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,37 (Adhesivo Gris)                                                                  ', 1, 0, 0, 2, 'Vin137BriEcoG', 2, NULL),
        (310, '1580                ', 20, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,37 (Adhesivo Transparente)                                                          ', 1, 0, 0, 2, 'Vin137BriAdTEco', 2, NULL),
        (311, '1581                ', 21, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Brillo 1,37 (Adhesivo Blanco)                                                                ', 1, 0, 0, 2, 'Vin137BriEcoB', 2, NULL),
        (312, '1582                ', 22, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Brillo 1,0 (Adhesivo Blanco)                                                                 ', 1, 0, 0, 2, 'Vin100BriEcoB', 2, NULL),
        (313, '1583                ', 23, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Vehicular (1,52)                                                                             ', 1, 0, 0, 2, 'Vin152VehiEcoB', 2, NULL),
        (316, '1584                ', 26, '1       ', '1.3                 ', '1.1.3.2             ', 'Banner Pet semibrillo (0,91)                                                                        ', 1, NULL, NULL, 2, 'BaPetSem091', 2, NULL),
        (317, '1585                ', 27, '1       ', '1.3                 ', '1.1.3.2             ', 'Banner Pet mate (0,91)                                                                              ', 1, NULL, NULL, 2, 'BaPetMatt137', 2, 0),
        (318, '1586                ', 66, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Microperforado 1,50                                                                          ', 1, 0, 0, 2, 'Vin152MicroEcoB', 2, NULL),
        (319, '1587                ', 36, '1       ', '1.3                 ', '1.1.3.1             ', 'Lona para Pasacalles 0,80                                                                           ', 1, 0, 0, 2, 'LOF160ECONM', 2, 0),
        (320, '1588                ', 67, '1       ', '1.3                 ', '1.1.3.1             ', 'PET Backlight (0,91)                                                                                ', 1, 0, 0, 2, NULL, 2, NULL),
        (321, '1589                ', 68, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 3,20 Brillo (Reverso Negro)                                                              ', 1, 0, 0, 2, 'LOF160ECONB', 2, 1),
        (322, '1590                ', 69, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 3,20 Mate (Reverso Negro)                                                                ', 1, 0, 0, 2, 'LOF320ECONM', 2, 1),
        (323, '1591                ', 70, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Brillo (Reverso Negro)                                                              ', 1, 0, 0, 2, 'LOF160ECONB', 2, 1),
        (324, '1592                ', 71, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Mate (Reverso Negro)                                                                ', 1, 0, 0, 2, 'LOF160ECONM', 2, 1),
        (325, '1593                ', 72, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Microperforado 1,52 (Reverso Negro)                                                          ', 1, 0, 0, 2, 'Vin152MicroEcoN', 2, 0),
        (326, '1594                ', 73, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Microperforado hasta 1,49 (Reverso Negro)                                                    ', 1, 0, 0, 2, 'Vin98MicroEcoN', 2, 0),
        (327, '1595                ', 74, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Brillo 1,52 (Adhesivo Blanco)                                                                ', 1, 0, 0, 2, 'Vin152MatAdTEco', 2, NULL),
        (328, '1596                ', 75, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Mate 1,52 (Adhesivo Blanco)                                                                  ', 1, 0, 0, 2, 'Vin137MatAdTEco', 2, NULL),
        (329, '1597                ', 76, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Vehicular 1,34 (Adhesivo Gris)                                                               ', 1, 0, 0, 2, 'Vin152VehiEcoG', 2, 0),
        (330, '1598                ', 77, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,37 (adhesivo translúcido/blanco)                                                    ', 1, 0, 0, 2, 'Vin137BriAdTEco', 2, NULL),
        (331, '1599                ', 78, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Brillo 0,91 (Adhesivo Blanco)                                                                ', 1, 0, 0, 2, 'Vin91BriEcoG', 2, NULL),
        (332, '1600                ', 79, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Mate 0,91 (Adhesivo Blanco)                                                                  ', 1, 0, 0, 2, 'Vin91BriEcoB', 2, NULL),
        (333, '1601                ', 210, '1       ', '1.3                 ', '1.1.3.1             ', 'Canvas Mate 0,91                                                                                    ', 1, 0, 0, 2, 'CAN90ECO', 2, 1),
        (334, '1602                ', 85, '1       ', '1.3                 ', '1.1.3.1             ', 'Roll up aluminio + (Banner Pet mate - 0,78)                                                         ', 1, 0, 0, 2, 'R-A-UP-', 2, 0),
        (335, '1603                ', 88, '1       ', '1.3                 ', '1.1.3.1             ', 'Lona Backligth 1,60                                                                                 ', 1, 0, 0, 2, 'Balight160', 2, 1),
        (336, '1604                ', 89, '1       ', '1.3                 ', '1.1.3.1             ', 'Lona Backligth hasta 3,17                                                                           ', 1, 0, 0, 2, 'Balight320', 2, 0),
        (337, '1605                ', 209, '1       ', '1.3                 ', '1.1.3.1             ', 'Roll up aluminio + (Banner Pet mate - 0,91) ARMADO                                                  ', 1, NULL, NULL, 2, 'R-A-UP-', 2, NULL),
        (338, '1606                ', 80, '1       ', '1.3                 ', '1.1.3.1             ', 'Canvas Brillo 0,91                                                                                  ', 1, 0, 0, 2, 'CAN90ECO', 2, 0),
        (339, '1607                ', 16, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo  hasta 1,49                                                                           ', 1, 0, 0, 2, 'Vin152BriEcoG', 2, 0),
        (340, '1608                ', 91, '1       ', '1.3                 ', '1.1.3.1             ', 'Papel Fotográfico (0,87)                                                                            ', 1, NULL, NULL, 2, 'P-F-', 2, 0),
        (341, '1609                ', 96, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,52 (adhesivo translúcido/blanco)                                                    ', 1, 0, 0, 2, '1', 2, NULL),
        (342, '1610                ', 97, '1       ', '1.3                 ', '1.1.3.1             ', 'Columnera 0,77 x 0,50 + Palo                                                                        ', 1, 0, 0, 1, '1', 2, 0),
        (343, '1611                ', 98, '1       ', '1.3                 ', '1.1.3.1             ', 'Pasacalles 0,77 x 1,00 + Palo                                                                       ', 1, 0, 0, 1, '1', 2, 0),
        (344, '1612                ', 99, '1       ', '1.3                 ', '1.1.3.1             ', 'Pasacalles 0,77 x 2,00  + Palo                                                                      ', 1, 0, 0, 1, '1', 2, 0),
        (345, '1613                ', 100, '1       ', '1.3                 ', '1.1.3.1             ', 'Pasacalles 0,77 x 3,00 + Palo                                                                       ', 1, 0, 0, 1, '1', 2, 0),
        (346, '1614                ', 24, '1       ', '1.3                 ', '1.1.3.1             ', 'Canvas Mate 1,27                                                                                    ', 1, 0, 0, 2, 'CAN152ECO', 2, 0),
        (347, '1615                ', 25, '1       ', '1.3                 ', '1.1.3.1             ', 'Canvas Mate 1,52                                                                                    ', 1, 0, 0, 2, 'CAN127ECO', 2, 0),
        (349, '1616                ', 121, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 25 x 25                                                                               ', 1, 0, 0, 1, '1', 2, 0),
        (350, '1617                ', 122, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 40 x 40                                                                               ', 1, 0, 0, 1, '1', 2, 0),
        (351, '1618                ', 123, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 60 x 60                                                                               ', 1, 0, 0, 1, '1', 2, 0),
        (352, '1619                ', 124, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 80 x 80                                                                               ', 1, 0, 0, 1, '1', 2, 0),
        (353, '1620                ', 125, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1,00 x 1,00                                                                           ', 1, 0, 0, 1, '1', 2, 1),
        (354, '1621                ', 126, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1,20 x 1,20                                                                           ', 1, 0, 0, 1, '1', 2, 1),
        (355, '1622                ', 133, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 35 x 15                                                                               ', 1, 0, 0, 1, '1', 2, 0),
        (356, '1623                ', 140, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 50 x 30                                                                               ', 1, 0, 0, 1, '1', 2, 0),
        (357, '1624                ', 141, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 70 x 50                                                                               ', 1, NULL, NULL, 1, '1', 2, 0),
        (358, '1625                ', 142, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1,10 x 50                                                                             ', 1, 0, 0, 1, '1', 2, 0),
        (359, '1626                ', 143, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1,20 x 80                                                                             ', 1, NULL, NULL, 1, '1', 2, 1),
        (360, '1627                ', 8, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight Brillo hasta 3.17                                                                        ', 1, 0, 0, 1, '1', 2, 0),
        (378, '1628                ', 9, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight Mate hasta 3.17                                                                          ', 1, 0, 0, 2, '1', 2, 0),
        (381, '3                   ', 3, '1       ', '1.1                 ', '1.1.1.1             ', 'Bandera Confeccionada                                                                               ', 1, NULL, NULL, 1, 'BC150X09', 2, 1),
        (383, '28                  ', 28, '1       ', '1.3                 ', '1.1.3.2             ', 'Back pet                                                                                            ', 1, NULL, NULL, 2, NULL, 2, NULL),
        (384, '61                  ', 61, '1       ', '1.1                 ', '1.1.1.1             ', 'Mykonos                                                                                             ', 1, NULL, NULL, 2, 'ST-MY-', 2, NULL),
        (385, '81                  ', 81, '1       ', '1.1                 ', '1.1.1.1             ', 'SUBLIMACIÓN                                                                                         ', 1, NULL, NULL, 1, 'TWCL', 2, NULL),
        (386, '82                  ', 82, '1       ', NULL, NULL, 'Articulos User                                                                                      ', 1, NULL, NULL, 1, NULL, 2, NULL),
        (387, '83                  ', 83, '1       ', NULL, NULL, 'MOLDES CLIENTE                                                                                      ', 1, NULL, NULL, 1, 'TWCL', 2, NULL),
        (388, '93                  ', 93, '1       ', '1.1                 ', '1.1.1.1             ', 'Interlock feria (1,80)                                                                              ', 1, NULL, NULL, 2, 'IN-LOCK180-', 2, 0),
        (389, '94                  ', 94, '1       ', NULL, NULL, 'MOLDES                                                                                              ', 1, NULL, NULL, 1, '1', 2, NULL),
        (391, '105                 ', 105, '1       ', NULL, NULL, 'DISEÑO                                                                                              ', 1, NULL, NULL, 1, '1', 2, NULL),
        (397, '114                 ', 114, '1       ', NULL, NULL, 'PROMO UNIFORME NEOPRENO                                                                             ', 1, NULL, NULL, 2, '1', 2, NULL),
        (398, '115                 ', 115, '1       ', NULL, NULL, 'PROMO UNIFORME CAPITONEADA                                                                          ', 1, NULL, NULL, 2, '1', 2, NULL),
        (400, '127                 ', 127, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 35 x 15                                                                               ', 1, NULL, NULL, 1, '1', 2, NULL),
        (401, '128                 ', 128, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 60 x 20                                                                               ', 1, NULL, NULL, 1, '1', 2, NULL),
        (402, '129                 ', 129, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 90 x 30                                                                               ', 1, NULL, NULL, 1, '1', 2, NULL),
        (403, '130                 ', 130, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1.20 x 40                                                                             ', 1, NULL, NULL, 1, '1', 2, NULL),
        (404, '131                 ', 131, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1.40 x 60                                                                             ', 1, NULL, NULL, 1, '1', 2, NULL),
        (405, '132                 ', 132, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1.60 x 80                                                                             ', 1, NULL, NULL, 1, '1', 2, NULL),
        (406, '1629                ', 159, '1       ', '1.3                 ', '1.1.3.2             ', 'Roll up plastico                                                                                    ', 1, 0, 0, 2, '1', 2, 0),
        (407, '146                 ', 146, '1       ', NULL, NULL, 'Venta productos                                                                                     ', 1, NULL, NULL, 1, '1', 2, NULL),
        (408, '147                 ', 147, '1       ', '1.4                 ', '1.1.4.1             ', '6 Gorros + Bordados hasta 4000 puntadas                                                             ', 1, 0, 0, 1, '1', 2, NULL),
        (409, '148                 ', 148, '1       ', '1.4                 ', '1.1.4.1             ', '12 Gorros + Bordados hasta 4000 puntadas                                                            ', 1, 0, 0, 1, '1', 2, NULL),
        (410, '149                 ', 149, '1       ', '1.1                 ', '1.1.1.1             ', 'Interlock Grueso  (1,83 m)                                                                          ', 1, 0, 0, 2, '1', 2, 0),
        (411, '150                 ', 150, '1       ', NULL, NULL, 'Articulos User USD                                                                                  ', 1, NULL, NULL, 2, '1', 2, NULL),
        (412, '151                 ', 151, '1       ', '1.1                 ', '1.1.1.1             ', 'Lycra Mykonos                                                                                       ', 1, NULL, NULL, 2, '1', 2, NULL),
        (413, '152                 ', 152, '1       ', '1.10                ', '1.1.10.1            ', 'Parche (De hasta 10x8)                                                                              ', 1, 0, 0, 2, '1', 2, 0),
        (414, '153                 ', 153, '1       ', '1.10                ', '1.1.10.1            ', 'Parche (Hasta 4x4)                                                                                  ', 1, 0, 0, 2, '1', 2, 0),
        (415, '154                 ', 154, '1       ', '1.10                ', '1.1.10.1            ', 'Parche con un maximo de 4 estrellas (De hasta 10x8)                                                 ', 1, 0, 0, 2, '1', 2, 0),
        (416, '155                 ', 155, '1       ', '1.10                ', '1.1.10.1            ', 'Parche (Hasta 7,5 x 4)                                                                              ', 1, 0, 0, 2, '1', 2, 0),
        (417, '156                 ', 156, '1       ', '1.10                ', '1.1.10.1            ', 'Matriz TPU                                                                                          ', 1, 0, 0, 2, '1', 2, 0),
        (418, '157                 ', 157, '1       ', '1.5                 ', '1.1.5.1             ', 'ESTAMPADO DE TPU                                                                                    ', 1, 0, 0, 2, '1', 2, 0),
        (420, '161                 ', 161, '1       ', '1.11                ', '1.1.11.1            ', 'Tela de bandera Mesh (3,17)                                                                         ', 1, 0, 0, 2, '1', 2, 0),
        (422, '163                 ', 163, '1       ', NULL, NULL, 'SUBLIMACION + BORDADO                                                                               ', 1, NULL, NULL, 2, '1', 2, NULL),
        (424, '1630                ', 232, '1       ', '1.4                 ', '1.1.4.1             ', 'Parche adhesivo 100% hilo                                                                           ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (425, '88                  ', 255, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser por prenda                                                                              ', 1, 0, 0, NULL, NULL, NULL, NULL),
        (428, '1561                ', 212, '1       ', '1.3                 ', '1.1.3.2             ', 'Bastidor de hierro                                                                                  ', 1, NULL, NULL, NULL, NULL, NULL, NULL),
        (429, '1562                ', 213, '1       ', '1.3                 ', '1.1.3.2             ', 'Colocacion de ojales                                                                                ', 1, NULL, NULL, NULL, NULL, NULL, NULL),
        (430, '1563                ', 214, '1       ', '1.3                 ', '1.1.3.2             ', 'Corte de vinilo                                                                                     ', 1, NULL, NULL, NULL, NULL, NULL, NULL),
        (431, '1564                ', 215, '1       ', '1.3                 ', '1.1.3.2             ', 'Palos pasacalle                                                                                     ', 1, NULL, NULL, NULL, NULL, NULL, NULL),
        (432, '1565                ', 217, '1       ', '1.3                 ', '1.1.3.2             ', 'Roll up PVC                                                                                         ', 1, NULL, NULL, NULL, NULL, NULL, NULL),
        (433, '1566                ', 218, '1       ', '1.3                 ', '1.1.3.2             ', 'Soldadura de lona                                                                                   ', 1, NULL, NULL, NULL, NULL, NULL, NULL),
        (434, '1567                ', 65, '1       ', '1.4                 ', '1.1.4.1             ', 'Bordado                                                                                             ', 1, NULL, NULL, NULL, NULL, NULL, NULL),
        (435, '1568                ', 248, '1       ', '1.4                 ', '1.1.4.1             ', 'Matriz Bordado                                                                                      ', 1, NULL, NULL, NULL, NULL, NULL, NULL),
        (436, '1569                ', 231, '1       ', '1.3                 ', '1.1.3.1             ', 'Canvas Brillo 1,27                                                                                  ', 1, NULL, NULL, NULL, NULL, NULL, NULL),
        (437, '1570                ', 1571, '1       ', '1.6                 ', '1.1.6.1             ', 'Corte Laser Pulseras                                                                                ', 1, NULL, NULL, NULL, NULL, NULL, NULL),
        (438, 'INS-001-9428        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Pet Film 1,2 X100 m                                                                                 ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (439, 'INS-002-9542        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Pet Film 0,6 X100 m                                                                                 ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (440, 'INS-003-9546        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Pet Film 0,3 X100 m                                                                                 ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (441, 'INS-004-9550        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Pet Film Uv (A-Blanco y A-Transparente)0,6 X100 m                                                   ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (442, 'INS-005-9554        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Pet Film Uv (A-Blanco y A-Transparente)0,3 X100 m                                                   ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (443, 'INS-006-9557        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Hoja A3 100 Hojas                                                                                   ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (444, 'INS-007-9559        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Hoja A4 100 Hojas                                                                                   ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (445, 'INS-008-9562        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Tinta Blanca 1L                                                                                     ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (446, 'INS-009-9564        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Tinta de Color 1L                                                                                   ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (447, 'INS-010-9566        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Poliamida 1Kg                                                                                       ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (448, 'INS-011-9568        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Tinta Ecosolvente 1L                                                                                ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (449, 'INS-012-9571        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Tinta Uv (Rigida y Soft)1L                                                                          ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (450, 'INS-013-9573        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Liquido de Limpieza Suave DTF1L                                                                     ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (451, 'INS-014-9575        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Liquido de Limpieza Subli1L                                                                         ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (452, 'INS-015-9578        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Liquido de Limpieza UV1L                                                                            ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (453, 'INS-016-9580        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Liquido de Limpieza Ecosolvente1L                                                                   ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (454, 'INS-017-9583        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Papel de Sublimación 1,60 de 90 g100                                                                ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (455, 'INS-018-9585        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Papel de Sublimación 1,18 de 90 g100                                                                ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (456, 'INS-019-9587        ', NULL, '2       ', '2.1                 ', '2.2.1.1             ', 'Papel de Sublimación 0,914 de 90 g100                                                               ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (457, 'PT-020-9589         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Backing Pop Up (Soporte para Tela o Lona)                                                           ', 1, NULL, NULL, 2, NULL, NULL, 0),
        (458, 'PT-021-9591         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Caña                                                                                                ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (459, 'PT-022-9593         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Media Antideslizante + Caña                                                                         ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (460, 'PT-023-9595         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Shorts (Adulto)                                                                                     ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (461, 'PT-024-9597         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Shorts (Niño)                                                                                       ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (462, 'PT-025-9600         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Cuellos Polares Adulto                                                                              ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (463, 'PT-026-9602         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Cuellos Polares Niño                                                                                ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (464, 'PT-027-9604         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Media Antideslizante                                                                                ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (465, 'PT-028-9606         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Maquinita pelo x1                                                                                   ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (466, 'PT-029-9608         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Maquinita pelo x 10                                                                                 ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (467, 'PT-030-9610         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Maquinita pelo x 100                                                                                ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (468, 'PT-031-9613         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Auriculares Inalámbricos x Unidad                                                                   ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (469, 'PT-032-9617         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Auriculares Inalámbricos x 10                                                                       ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (470, 'PT-033-9619         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Auriculares Inalámbricos x 100                                                                      ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (471, 'PT-034-9621         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Gorros Lisos y Jaspeados x Unidad                                                                   ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (472, 'PT-035-9623         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Gorros Lisos y Jaspeados x 10                                                                       ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (473, 'PT-036-9625         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Gorros Lisos y Jaspeados x 100                                                                      ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (474, 'PT-037-9627         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Gorros de lana                                                                                      ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (475, 'PT-038-9629         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Medias premium adulto                                                                               ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (476, 'PT-039-9630         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Medias basicas niño                                                                                 ', 1, NULL, NULL, 1, NULL, NULL, 0),
        (477, 'PT-040-9632         ', NULL, '2       ', '2.1                 ', '2.2.1.2             ', 'Medias basicas adulto                                                                               ', 1, NULL, NULL, 1, NULL, NULL, 0);
    SET IDENTITY_INSERT [dbo].[Articulos] OFF;

    COMMIT TRAN;
    PRINT '    OK Articulos (249 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Articulos] OFF;
    PRINT '    ERROR Articulos: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [16/21] PreciosBase
-- ================================================================
PRINT '>>> [16/21] PreciosBase';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[PreciosBase]', 'U') IS NOT NULL
        DROP TABLE [dbo].[PreciosBase];

    CREATE TABLE [dbo].[PreciosBase] (
    [ID] INT IDENTITY(1,1) NOT NULL,
    [CodArticulo] NVARCHAR(50) NOT NULL,
    [Precio] DECIMAL(18,4) DEFAULT ((0)) NOT NULL,
    [Moneda] NVARCHAR(5) DEFAULT ('UYU') NULL,
    [UltimaActualizacion] DATETIME DEFAULT (getdate()) NULL,
    [MonIdMoneda] INT NULL,
    [ProIdProducto] INT NULL,
    CONSTRAINT [PK_PreciosBase] PRIMARY KEY CLUSTERED ([ID])
    );

    -- INSERT (200 filas)
    SET IDENTITY_INSERT [dbo].[PreciosBase] ON;
    INSERT INTO [dbo].[PreciosBase] ([ID], [CodArticulo], [Precio], [Moneda], [UltimaActualizacion], [MonIdMoneda], [ProIdProducto]) VALUES
        (78, '10', 10.0000, 'USD', '2026-04-21 15:12:25', 2, 2),
        (79, '1558', 28.0000, 'USD', '2026-04-21 11:59:15', 2, 9),
        (80, '107', 0.0000, 'UYU', '2026-04-22 13:00:13', 1, 25),
        (81, '108', 0.0000, 'UYU', '2026-04-22 13:00:13', 1, 26),
        (82, '109', 0.0000, 'UYU', '2026-04-22 13:00:13', 1, 27),
        (83, '11', 10.5000, 'USD', '2026-04-21 15:08:24', 2, 28),
        (84, '110', 0.0000, 'UYU', '2026-04-22 13:00:24', 1, 29),
        (85, '1560', 30.0000, 'USD', '2026-04-21 11:59:15', 2, 32),
        (86, '115', 0.0000, 'UYU', '2026-04-22 13:01:54', 1, 36),
        (87, '116', 90.0000, 'UYU', '2026-04-22 17:10:41', 1, 38),
        (88, '1178', 90.0000, 'UYU', '2026-04-22 17:10:41', 1, 40),
        (89, '1179', 60.0000, 'UYU', '2026-04-22 17:10:41', 1, 41),
        (90, '12', 10.0000, 'USD', '2026-04-21 15:05:06', 2, 44),
        (91, '1215', 10.0000, 'USD', '2026-04-21 15:13:40', 2, 48),
        (92, '1218', 10.0000, 'USD', '2026-04-21 15:13:56', 2, 51),
        (93, '1219', 9.0000, 'USD', '2026-04-21 15:11:40', 2, 52),
        (94, '1220', 13.0000, 'USD', '2026-04-21 15:12:25', 2, 53),
        (95, '1223', 12.0000, 'USD', '2026-04-21 15:14:06', 2, 56),
        (96, '1224', 10.0000, 'USD', '2026-04-21 15:14:21', 2, 57),
        (97, '1225', 12.0000, 'USD', '2026-04-21 15:14:33', 2, 58),
        (98, '1353', 30.0000, 'UYU', '2026-04-22 17:04:41', 1, 68),
        (99, '1355', 35.0000, 'UYU', '2026-04-22 17:04:41', 1, 70),
        (100, '1356', 40.0000, 'UYU', '2026-04-22 17:04:41', 1, 71),
        (101, '1357', 30.0000, 'UYU', '2026-04-22 17:04:41', 1, 72),
        (102, '1358', 40.0000, 'UYU', '2026-04-22 17:04:41', 1, 73),
        (103, '1359', 60.0000, 'UYU', '2026-04-22 17:07:17', 1, 74),
        (104, '1360', 60.0000, 'UYU', '2026-04-22 17:07:17', 1, 75),
        (105, '1361', 65.0000, 'UYU', '2026-04-22 17:07:17', 1, 76),
        (106, '1362', 60.0000, 'UYU', '2026-04-22 17:07:17', 1, 77),
        (107, '1363', 40.0000, 'UYU', '2026-04-22 17:07:17', 1, 78),
        (108, '1364', 20.0000, 'UYU', '2026-04-22 17:07:17', 1, 79),
        (109, '1365', 20.0000, 'UYU', '2026-04-22 17:07:17', 1, 80),
        (110, '1366', 10.0000, 'UYU', '2026-04-22 17:07:17', 1, 81),
        (111, '1367', 30.0000, 'UYU', '2026-04-22 17:07:17', 1, 82),
        (112, '1368', 20.0000, 'UYU', '2026-04-22 17:07:17', 1, 83),
        (113, '1369', 10.0000, 'UYU', '2026-04-22 17:07:17', 1, 84),
        (114, '1370', 25.0000, 'UYU', '2026-04-22 17:07:17', 1, 85),
        (115, '1371', 20.0000, 'UYU', '2026-04-22 17:07:17', 1, 86),
        (116, '1372', 2.0000, 'UYU', '2026-04-22 17:07:17', 1, 87),
        (117, '1373', 15.0000, 'UYU', '2026-04-22 17:07:17', 1, 88),
        (118, '1374', 10.0000, 'UYU', '2026-04-22 17:07:17', 1, 89),
        (119, '1375', 0.0000, 'UYU', '2026-04-22 13:01:15', 1, 90),
        (120, '1376', 30.0000, 'UYU', '2026-04-22 17:07:17', 1, 91),
        (121, '1398', 0.0000, 'UYU', '2026-04-22 13:01:54', 1, 113),
        (122, '1464', 0.0000, 'UYU', '2026-04-22 13:01:15', 1, 180),
        (123, '1465', 0.0000, 'USD', '2026-02-02 09:36:39', 2, 181),
        (124, '1475', 70.0000, 'UYU', '2026-04-22 17:10:41', 1, 191),
        (125, '1476', 150.0000, 'UYU', '2026-04-22 17:10:41', 1, 192),
        (126, '1477', 100.0000, 'UYU', '2026-04-22 17:10:41', 1, 193),
        (127, '1478', 100.0000, 'UYU', '2026-04-22 17:10:41', 1, 194),
        (128, '1479', 100.0000, 'UYU', '2026-04-22 17:10:41', 1, 195),
        (129, '1480', 100.0000, 'UYU', '2026-04-22 17:10:41', 1, 196),
        (130, '1481', 0.0000, 'UYU', '2026-04-22 13:01:54', 1, 197),
        (131, '1482', 20.0000, 'UYU', '2026-04-22 17:10:41', 1, 198),
        (132, '1483', 15.0000, 'UYU', '2026-04-22 17:10:41', 1, 199),
        (133, '1484', 25.0000, 'UYU', '2026-04-22 17:10:41', 1, 200),
        (134, '1485', 20.0000, 'UYU', '2026-04-22 17:10:41', 1, 201),
        (135, '1486', 15.0000, 'UYU', '2026-04-22 17:10:41', 1, 202),
        (136, '1487', 30.0000, 'UYU', '2026-04-22 17:10:41', 1, 203),
        (137, '1488', 20.0000, 'UYU', '2026-04-22 17:10:41', 1, 204),
        (138, '1489', 30.0000, 'UYU', '2026-04-22 17:10:41', 1, 205),
        (139, '1490', 100.0000, 'UYU', '2026-04-22 17:10:41', 1, 206),
        (140, '1491', 0.0000, 'UYU', '2026-04-22 13:01:54', 1, 207),
        (141, '1499', 13.0000, 'USD', '2026-04-21 15:13:20', 2, 208),
        (142, '16', 12.0000, 'USD', '2026-04-21 15:11:22', 2, 212),
        (143, '18', 11.0000, 'USD', '2026-04-21 15:05:58', 2, 214),
        (144, '2', 12.0000, 'USD', '2026-04-21 15:12:41', 2, 216),
        (145, '20', 9.0000, 'USD', '2026-04-21 15:08:24', 2, 217),
        (146, '21', 300.0000, 'UYU', '2026-04-21 15:16:06', 1, 218),
        (147, '22', 0.0000, 'USD', '2026-02-12 12:29:04', 2, 219),
        (148, '24', 12.0000, 'USD', '2026-04-21 15:10:41', 2, 221),
        (149, '26', 13.0000, 'USD', '2026-04-21 15:14:45', 2, 223),
        (150, '27', 13.0000, 'USD', '2026-04-21 15:10:08', 2, 224),
        (151, '28', 12.0000, 'USD', '2026-04-21 15:12:25', 2, 225),
        (152, '3', 9.0000, 'USD', '2026-04-21 15:05:06', 2, 227),
        (153, '31', 10.0000, 'USD', '2026-04-21 15:08:24', 2, 229),
        (154, '32', 10.0000, 'USD', '2026-04-21 15:08:24', 2, 230),
        (155, '34', 13.0000, 'USD', '2026-04-21 15:10:08', 2, 232),
        (156, '35', 10.0000, 'USD', '2026-04-21 15:08:24', 2, 233),
        (157, '37', 8.0000, 'USD', '2026-04-21 15:09:31', 2, 235),
        (158, '38', 9.0000, 'USD', '2026-04-21 15:10:41', 2, 236),
        (159, '39', 12.0000, 'USD', '2026-04-21 15:23:08', 2, 237),
        (160, '4', 9.0000, 'USD', '2026-04-21 15:05:06', 2, 238),
        (161, '40', 12.0000, 'USD', '2026-04-21 15:02:51', 2, 239),
        (162, '41', 9.0000, 'USD', '2026-04-21 15:11:22', 2, 240),
        (163, '45', 10.0000, 'USD', '2026-04-21 15:23:08', 2, 244),
        (164, '46', 10.0000, 'USD', '2026-04-21 15:23:08', 2, 245),
        (165, '47', 7.0000, 'USD', '2026-04-21 15:23:08', 2, 246),
        (166, '48', 22.0000, 'USD', '2026-04-21 09:56:55', 2, 247),
        (167, '49', 22.0000, 'USD', '2026-04-21 09:56:55', 2, 248),
        (168, '55', 22.0000, 'USD', '2026-04-21 09:56:55', 2, 255),
        (169, '6', 1.5000, 'USD', '2026-04-21 15:08:36', 2, 258),
        (170, '7', 10.0000, 'USD', '2026-04-21 15:08:24', 2, 266),
        (171, '8', 10.0000, 'USD', '2026-04-21 15:08:24', 2, 277),
        (172, '9', 12.0000, 'USD', '2026-04-21 15:23:08', 2, 288),
        (173, '1571', 20.0000, 'USD', '2026-04-21 15:26:37', 2, 300),
        (174, '1572', 20.0000, 'USD', '2026-04-21 15:26:37', 2, 301),
        (175, '1573', 10.0000, 'USD', '2026-04-21 15:26:37', 2, 302),
        (176, '1574', 10.0000, 'USD', '2026-04-21 15:26:37', 2, 303),
        (177, '1575', 10.0000, 'USD', '2026-04-21 15:26:37', 2, 304),
        (178, '1576', 10.0000, 'USD', '2026-04-21 15:26:37', 2, 305),
        (179, '1577', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 307),
        (180, '1578', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 308),
        (181, '1579', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 309),
        (182, '1580', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 310),
        (183, '1581', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 311),
        (184, '1582', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 312),
        (185, '1583', 15.0000, 'USD', '2026-04-21 15:29:38', 2, 313),
        (186, '1584', 12.0000, 'USD', '2026-04-21 15:29:58', 2, 316),
        (187, '1585', 12.0000, 'USD', '2026-04-21 15:29:58', 2, 317),
        (188, '1587', 0.0000, 'UYU', '2026-04-21 15:43:25', 1, 319),
        (189, '1595', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 327),
        (190, '1596', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 328),
        (191, '1597', 15.0000, 'USD', '2026-04-21 15:29:38', 2, 329),
        (192, '1598', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 330),
        (193, '1599', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 331),
        (194, '1600', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 332),
        (195, '1601', 8.0000, 'USD', '2026-04-21 15:31:13', 2, 333),
        (196, '1602', 35.0000, 'USD', '2026-04-21 15:26:37', 2, 334),
        (197, '1605', 35.0000, 'USD', '2026-04-21 15:26:37', 2, 337),
        (198, '1606', 8.0000, 'USD', '2026-04-21 15:31:13', 2, 338),
        (199, '1607', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 339),
        (200, '1608', 9.0000, 'USD', '2026-04-21 15:44:22', 2, 340),
        (201, '1609', 9.0000, 'USD', '2026-04-21 15:29:38', 2, 341),
        (202, '1611', 350.0000, 'UYU', '2026-04-21 15:43:12', 1, 343),
        (203, '1612', 550.0000, 'UYU', '2026-04-21 15:43:12', 1, 344),
        (204, '1613', 700.0000, 'UYU', '2026-04-21 15:43:12', 1, 345),
        (205, '1614', 10.0000, 'USD', '2026-04-21 15:36:55', 2, 346),
        (206, '1615', 18.0000, 'USD', '2026-04-21 15:36:55', 2, 347),
        (207, '1616', 190.0000, 'UYU', '2026-04-21 15:38:32', 1, 349),
        (208, '1617', 290.0000, 'UYU', '2026-04-21 15:38:32', 1, 350),
        (209, '1618', 490.0000, 'UYU', '2026-04-21 15:38:44', 1, 351),
        (210, '1619', 690.0000, 'UYU', '2026-04-21 15:38:54', 1, 352),
        (211, '1620', 0.0000, 'UYU', '2026-04-21 15:40:10', 1, 353),
        (212, '1621', 0.0000, 'UYU', '2026-04-21 15:40:10', 1, 354),
        (213, '1622', 0.0000, 'UYU', '2026-04-21 15:40:10', 1, 355),
        (214, '1623', 0.0000, 'UYU', '2026-04-21 15:40:10', 1, 356),
        (215, '1624', 0.0000, 'UYU', '2026-04-21 15:40:10', 1, 357),
        (216, '1627', 20.0000, 'USD', '2026-04-21 15:26:37', 2, 360),
        (217, '1628', 20.0000, 'USD', '2026-04-21 15:26:37', 2, 378),
        (218, '3', 300.0000, 'UYU', '2026-04-21 15:16:06', 1, 381),
        (220, '61', 9.0000, 'USD', '2026-04-21 15:23:08', 2, 384),
        (221, '81', 0.0000, 'USD', '2026-02-02 09:38:23', 2, 385),
        (222, '82', 0.0000, 'USD', '2026-02-02 09:38:23', 2, 386),
        (223, '83', 0.0000, 'USD', '2026-02-02 09:40:03', 2, 387),
        (224, '93', 8.0000, 'USD', '2026-04-21 15:23:08', 2, 388),
        (225, '94', 0.0000, 'USD', '2026-02-02 09:37:32', 2, 389),
        (226, '105', 0.0000, 'USD', '2026-02-22 12:28:24', 2, 391),
        (227, '115', 0.0000, 'USD', '2026-04-08 09:30:02', 2, 398),
        (228, '127', 190.0000, 'UYU', '2026-04-21 15:37:59', 1, 400),
        (229, '130', 190.0000, 'UYU', '2026-04-21 15:39:34', 1, 403),
        (230, '131', 990.0000, 'UYU', '2026-04-21 15:39:34', 1, 404),
        (231, '132', 1290.0000, 'UYU', '2026-04-21 15:39:34', 1, 405),
        (232, '147', 0.0000, 'UYU', '2026-04-22 13:00:13', 1, 408),
        (233, '148', 0.0000, 'UYU', '2026-04-22 13:00:13', 1, 409),
        (234, '149', 10.0000, 'USD', '2026-04-21 15:09:31', 2, 410),
        (235, '151', 9.0000, 'USD', '2026-04-21 15:10:41', 2, 412),
        (236, '152', 3.5000, 'USD', '2026-04-21 10:13:48', 2, 413),
        (237, '153', 2.0000, 'USD', '2026-04-21 10:13:48', 2, 414),
        (238, '154', 4.5000, 'USD', '2026-04-21 10:13:48', 2, 415),
        (239, '155', 2.5000, 'USD', '2026-04-21 10:13:48', 2, 416),
        (240, '156', 15.0000, 'USD', '2026-04-21 10:13:48', 2, 417),
        (241, '157', 0.0000, 'USD', '2026-04-10 12:27:25', 2, 418),
        (242, '161', 28.0000, 'USD', '2026-04-21 11:59:15', 2, 420),
        (243, '1630', 0.0000, 'UYU', '2026-04-22 13:00:13', 1, 424),
        (244, '88', 0.0000, 'UYU', '2026-04-22 13:01:15', 1, 425),
        (245, '1564', 0.0000, 'UYU', '2026-04-21 15:43:25', 1, 431),
        (246, '1567', 0.0000, 'UYU', '2026-04-22 13:00:13', 1, 434),
        (247, '1568', 0.0000, 'UYU', '2026-04-22 13:00:13', 1, 435),
        (248, '1569', 10.0000, 'USD', '2026-04-21 15:31:13', 2, 436),
        (249, '1570', 5.0000, 'UYU', '2026-04-22 17:07:17', 1, 437),
        (250, 'INS-001-9428', 200.0000, 'USD', '2026-04-24 15:09:51', 2, 438),
        (251, 'INS-002-9542', 100.0000, 'USD', '2026-04-24 15:09:51', 2, 439),
        (252, 'INS-003-9546', 50.0000, 'USD', '2026-04-24 15:09:51', 2, 440),
        (253, 'INS-004-9550', 250.0000, 'USD', '2026-04-24 15:09:51', 2, 441),
        (254, 'INS-005-9554', 125.0000, 'USD', '2026-04-24 15:09:51', 2, 442),
        (255, 'INS-006-9557', 40.0000, 'USD', '2026-04-24 15:09:51', 2, 443),
        (256, 'INS-007-9559', 20.0000, 'USD', '2026-04-24 15:09:51', 2, 444),
        (257, 'INS-008-9562', 40.0000, 'USD', '2026-04-24 15:09:51', 2, 445),
        (258, 'INS-009-9564', 40.0000, 'USD', '2026-04-24 15:09:51', 2, 446),
        (259, 'INS-010-9566', 25.0000, 'USD', '2026-04-24 15:09:51', 2, 447),
        (260, 'INS-011-9568', 45.0000, 'USD', '2026-04-24 15:09:51', 2, 448),
        (261, 'INS-012-9571', 90.0000, 'USD', '2026-04-24 15:09:51', 2, 449),
        (262, 'INS-013-9573', 40.0000, 'USD', '2026-04-24 15:09:51', 2, 450),
        (263, 'INS-014-9575', 40.0000, 'USD', '2026-04-24 15:09:51', 2, 451),
        (264, 'INS-015-9578', 70.0000, 'USD', '2026-04-24 15:09:51', 2, 452),
        (265, 'INS-016-9580', 70.0000, 'USD', '2026-04-24 15:09:51', 2, 453),
        (266, 'INS-017-9583', 90.0000, 'USD', '2026-04-24 15:09:51', 2, 454),
        (267, 'INS-018-9585', 66.0000, 'USD', '2026-04-24 15:09:51', 2, 455),
        (268, 'INS-019-9587', 52.0000, 'USD', '2026-04-24 15:09:51', 2, 456),
        (269, 'PT-020-9589', 0.0000, 'UYU', '2026-04-24 15:12:45', 1, 457),
        (270, 'PT-021-9591', 0.0000, 'UYU', '2026-04-24 15:12:45', 1, 458),
        (271, 'PT-022-9593', 0.0000, 'UYU', '2026-04-24 15:12:45', 1, 459),
        (272, 'PT-027-9604', 0.0000, 'UYU', '2026-04-24 15:12:45', 1, 464),
        (273, 'PT-028-9606', 0.0000, 'UYU', '2026-04-24 15:12:45', 1, 465),
        (274, 'PT-029-9608', 0.0000, 'UYU', '2026-04-24 15:12:45', 1, 466),
        (275, 'PT-030-9610', 0.0000, 'UYU', '2026-04-24 15:12:45', 1, 467),
        (276, 'PT-031-9613', 0.0000, 'UYU', '2026-04-24 15:12:45', 1, 468),
        (277, 'PT-032-9617', 0.0000, 'UYU', '2026-04-24 15:12:45', 1, 469),
        (278, 'PT-033-9619', 0.0000, 'UYU', '2026-04-24 15:12:45', 1, 470);
    SET IDENTITY_INSERT [dbo].[PreciosBase] OFF;

    COMMIT TRAN;
    PRINT '    OK PreciosBase (200 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[PreciosBase] OFF;
    PRINT '    ERROR PreciosBase: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [17/21] PerfilesPrecios
-- ================================================================
PRINT '>>> [17/21] PerfilesPrecios';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[PerfilesPrecios]', 'U') IS NOT NULL
        DROP TABLE [dbo].[PerfilesPrecios];

    CREATE TABLE [dbo].[PerfilesPrecios] (
    [ID] INT IDENTITY(1,1) NOT NULL,
    [Nombre] NVARCHAR(100) NOT NULL,
    [Descripcion] NVARCHAR(255) NULL,
    [Activo] BIT DEFAULT ((1)) NULL,
    [EsGlobal] BIT DEFAULT ((0)) NULL,
    [Categoria] VARCHAR(255) NULL,
    CONSTRAINT [PK_PerfilesPrecios] PRIMARY KEY CLUSTERED ([ID])
    );

    -- INSERT (13 filas)
    SET IDENTITY_INSERT [dbo].[PerfilesPrecios] ON;
    INSERT INTO [dbo].[PerfilesPrecios] ([ID], [Nombre], [Descripcion], [Activo], [EsGlobal], [Categoria]) VALUES
        (1, 'Descuentos por Cantidades DTF', 'Descuentos por Cantidades', 1, 1, 'DTF'),
        (2, 'Recargo por Urgencias ', 'Recargo por Urgencias', 1, 0, 'Todos'),
        (3, 'Recargo por Tinta', 'Recargo por Tinta', 1, 1, 'ECOUV'),
        (4, 'Descuento Trabajadores 10%', 'Descuento Trabajadores', 1, 0, 'Todos'),
        (5, 'Descuento Especial 10%', 'Descuento Especial 10%', 1, 0, 'Todos'),
        (6, 'Precios fijos por productos', 'Precios fijos por productos', 0, 0, 'Todos'),
        (7, 'TPU PRECIOS ESCALONADOS POR CANTIDAD', 'TPU PRECIOS ESCALONADOS POR CANTIDAD', 1, 1, 'TPU'),
        (8, ' TPU PRECIOS ESPECIALES', 'PRECIOS ESPECIALES TPU', 0, 0, 'TPU'),
        (10, 'EST PRECIOS', 'Precios estampados x bajadas', 1, 0, 'Estampados'),
        (11, 'Reposiciones ', 'Reposiciones', 1, 0, 'Todos'),
        (12, 'ESCALONADOS IMPRESION DIRECTA', 'ESCALONADOS IMPRESION DIRECTA', 1, 1, 'IMD'),
        (13, 'SUBLIMACION ESCALONADOS', 'SUBLIMACION ESCALONADOS', 1, 1, 'SB'),
        (14, 'ECOUV ESCALONADOS', 'ECOUV ESCALONADOS', 1, 1, 'ECOUV');
    SET IDENTITY_INSERT [dbo].[PerfilesPrecios] OFF;

    COMMIT TRAN;
    PRINT '    OK PerfilesPrecios (13 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[PerfilesPrecios] OFF;
    PRINT '    ERROR PerfilesPrecios: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [18/21] PreciosEspeciales
-- ================================================================
PRINT '>>> [18/21] PreciosEspeciales';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[PreciosEspeciales]', 'U') IS NOT NULL
        DROP TABLE [dbo].[PreciosEspeciales];

    CREATE TABLE [dbo].[PreciosEspeciales] (
    [ID] INT IDENTITY(1,1) NOT NULL,
    [ClienteID] INT NOT NULL,
    [NombreCliente] NVARCHAR(255) NULL,
    [FechaCreacion] DATETIME DEFAULT (getdate()) NULL,
    [UltimaActualizacion] DATETIME DEFAULT (getdate()) NULL,
    [PerfilID] INT NULL,
    [PerfilesIDs] NVARCHAR(MAX) NULL,
    [CliIdCliente] INT NULL,
    CONSTRAINT [PK_PreciosEspeciales] PRIMARY KEY CLUSTERED ([ID])
    );

    -- INSERT (34 filas)
    SET IDENTITY_INSERT [dbo].[PreciosEspeciales] ON;
    INSERT INTO [dbo].[PreciosEspeciales] ([ID], [ClienteID], [NombreCliente], [FechaCreacion], [UltimaActualizacion], [PerfilID], [PerfilesIDs], [CliIdCliente]) VALUES
        (13, 3149, NULL, '2026-04-07 16:18:27', '2026-04-07 16:18:27', 4, '4', 3149),
        (14, 795, NULL, '2026-04-07 16:18:29', '2026-04-07 16:18:29', 4, '4', 795),
        (15, 1, NULL, '2026-04-07 16:18:45', '2026-04-07 16:18:45', 4, '4', 1),
        (16, 2930, NULL, '2026-04-07 16:18:57', '2026-04-07 16:18:57', 4, '4', 2930),
        (17, 774, NULL, '2026-04-07 16:19:12', '2026-04-07 16:19:12', 4, '4', 774),
        (18, 894, NULL, '2026-04-07 16:19:44', '2026-04-07 16:19:44', 4, '4', 894),
        (19, 6793, NULL, '2026-04-16 23:30:28', '2026-04-16 23:30:28', NULL, '5', 6793),
        (20, 5714062, NULL, '2026-04-16 23:37:56', '2026-04-16 23:37:56', NULL, NULL, 5714062),
        (21, 1624, NULL, '2026-04-17 14:49:16', '2026-04-17 14:49:16', NULL, '4', 1624),
        (22, 433, NULL, '2026-04-17 14:49:34', '2026-04-17 14:49:34', NULL, '4', 433),
        (23, 3063, NULL, '2026-04-17 14:49:51', '2026-04-17 14:49:51', NULL, '4', 3063),
        (24, 261, NULL, '2026-04-17 14:50:44', '2026-04-17 14:50:44', NULL, '4', 261),
        (25, 1019, NULL, '2026-04-17 14:52:13', '2026-04-17 14:52:13', NULL, '4', 1019),
        (26, 1188, NULL, '2026-04-17 14:53:30', '2026-04-17 14:53:30', NULL, '4', 1188),
        (27, 2187, NULL, '2026-04-17 14:53:45', '2026-04-17 14:53:45', NULL, '4', 2187),
        (28, 5216, NULL, '2026-04-17 14:54:05', '2026-04-17 14:54:05', NULL, '4', 5216),
        (29, 1520, NULL, '2026-04-17 14:54:28', '2026-04-17 14:54:28', NULL, '4', 1520),
        (30, 368, NULL, '2026-04-17 14:55:15', '2026-04-17 14:55:15', NULL, '4', 368),
        (31, 6293, NULL, '2026-04-17 14:55:48', '2026-04-17 14:55:48', NULL, '4', 6293),
        (32, 2061, NULL, '2026-04-17 14:55:50', '2026-04-17 14:55:50', NULL, '4', 2061),
        (33, 2098, NULL, '2026-04-17 14:56:20', '2026-04-17 14:56:20', NULL, '4', 2098),
        (34, 2352, NULL, '2026-04-17 14:56:36', '2026-04-17 14:56:36', NULL, '4', 2352),
        (35, 5469, NULL, '2026-04-17 14:56:58', '2026-04-17 14:56:58', NULL, '4', 5469),
        (36, 5552, NULL, '2026-04-17 15:07:58', '2026-04-17 15:07:58', NULL, '4', 5552),
        (37, 6473, NULL, '2026-04-17 15:08:04', '2026-04-17 15:08:04', NULL, '4', 6473),
        (38, 5598, NULL, '2026-04-17 15:09:13', '2026-04-17 15:09:13', NULL, '4', 5598),
        (39, 6834, NULL, '2026-04-17 15:09:32', '2026-04-17 15:09:32', NULL, '4', 6834),
        (40, 125801, NULL, '2026-04-17 21:02:31', '2026-04-17 21:02:31', NULL, NULL, 125801),
        (45, 358701, 'Samiplus Sa                                                                                                                                           ', '2026-05-19 13:43:23', '2026-05-19 13:43:23', NULL, NULL, 358701),
        (46, 115601, 'Jim texeira 893                                                                                                                                       ', '2026-05-19 13:44:48', '2026-05-19 13:44:48', NULL, NULL, 115601),
        (47, 100401, 'CAMILO-7008                                                                                                                                           ', '2026-05-19 13:45:19', '2026-05-19 13:45:19', NULL, NULL, 100401),
        (48, 5714803, 'Favio Curbelo                                                                                                                                         ', '2026-05-19 13:59:00', '2026-05-19 13:59:00', NULL, NULL, 5714803),
        (49, 5713074, 'Favio Curbelo                                                                                                                                         ', '2026-05-19 14:01:24', '2026-05-19 14:02:10', NULL, NULL, 5713074),
        (50, 126001, 'Herman Halter                                                                                                                                         ', '2026-05-19 14:04:16', '2026-05-19 14:04:49', NULL, NULL, 126001);
    SET IDENTITY_INSERT [dbo].[PreciosEspeciales] OFF;

    COMMIT TRAN;
    PRINT '    OK PreciosEspeciales (34 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[PreciosEspeciales] OFF;
    PRINT '    ERROR PreciosEspeciales: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [19/21] PreciosEspecialesItems
-- ================================================================
PRINT '>>> [19/21] PreciosEspecialesItems';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[PreciosEspecialesItems]', 'U') IS NOT NULL
        DROP TABLE [dbo].[PreciosEspecialesItems];

    CREATE TABLE [dbo].[PreciosEspecialesItems] (
    [ItemID] INT IDENTITY(1,1) NOT NULL,
    [ClienteID] INT NOT NULL,
    [CodArticulo] NVARCHAR(50) NOT NULL,
    [TipoRegla] NVARCHAR(20) NOT NULL,
    [Valor] DECIMAL(18,4) NOT NULL,
    [Moneda] NVARCHAR(5) DEFAULT ('UYU') NULL,
    [MinCantidad] DECIMAL(18,2) DEFAULT ((0)) NULL,
    [MonIdMoneda] INT NULL,
    [ProIdProducto] INT NULL,
    [CliIdCliente] INT NULL,
    [CodGrupo] VARCHAR(100) NULL,
    CONSTRAINT [PK_PreciosEspecialesItems] PRIMARY KEY CLUSTERED ([ItemID])
    );

    -- INSERT (7 filas)
    SET IDENTITY_INSERT [dbo].[PreciosEspecialesItems] ON;
    INSERT INTO [dbo].[PreciosEspecialesItems] ([ItemID], [ClienteID], [CodArticulo], [TipoRegla], [Valor], [Moneda], [MinCantidad], [MonIdMoneda], [ProIdProducto], [CliIdCliente], [CodGrupo]) VALUES
        (1, 125801, '48', 'fixed', 15.0000, 'UYU', 0.00, 2, 247, 125801, NULL),
        (4, 358701, '48', 'fixed', 13.0000, 'UYU', 0.00, 2, 247, 358701, NULL),
        (5, 115601, '48', 'fixed', 18.0000, 'UYU', 0.00, 2, 247, 115601, NULL),
        (6, 100401, '48', 'fixed', 18.0000, 'UYU', 0.00, 2, 247, 100401, NULL),
        (7, 5714803, '48', 'fixed', 18.0000, 'UYU', 0.00, 2, 247, 5714803, NULL),
        (9, 5713074, '48', 'fixed', 18.0000, 'UYU', 0.00, 2, 247, 5713074, NULL),
        (11, 126001, '55', 'fixed', 10.0000, 'UYU', 0.00, 2, 255, 126001, NULL);
    SET IDENTITY_INSERT [dbo].[PreciosEspecialesItems] OFF;

    COMMIT TRAN;
    PRINT '    OK PreciosEspecialesItems (7 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[PreciosEspecialesItems] OFF;
    PRINT '    ERROR PreciosEspecialesItems: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [20/21] ConfigEstados
-- ================================================================
PRINT '>>> [20/21] ConfigEstados';
BEGIN TRY
    BEGIN TRAN;

    IF OBJECT_ID('dbo.[ConfigEstados]', 'U') IS NOT NULL
        DROP TABLE [dbo].[ConfigEstados];

    CREATE TABLE [dbo].[ConfigEstados] (
    [EstadoID] INT NOT NULL,
    [AreaID] NVARCHAR(255) NULL,
    [Nombre] NVARCHAR(100) NOT NULL,
    [ColorHex] VARCHAR(20) NULL,
    [Orden] INT NOT NULL,
    [EsFinal] BIT NULL,
    [TipoEstado] NVARCHAR(50) NULL,
    CONSTRAINT [PK_ConfigEstados] PRIMARY KEY CLUSTERED ([EstadoID])
    );

    -- INSERT (27 filas)
    INSERT INTO [dbo].[ConfigEstados] ([EstadoID], [AreaID], [Nombre], [ColorHex], [Orden], [EsFinal], [TipoEstado]) VALUES
        (1, 'ADMIN', 'Produccion', '#cccccc', 0, 0, 'ESTADO'),
        (2, 'ADMIN', 'Pendiente', '#cccccc', 1, 0, 'ESTADO'),
        (3, 'ADMIN', 'En Proceso', '#cccccc', 2, 0, 'ESTADO'),
        (4, 'ADMIN', 'Pronto', '#cccccc', 3, 0, 'ESTADO'),
        (5, 'ADMIN', 'Cancelado', '#cccccc', 4, 0, 'ESTADO'),
        (6, 'ADMIN', 'Retenido', '#cccccc', 0, 0, 'ESTADO'),
        (7, 'ADMIN', 'Pausado', '#cccccc', 6, 0, 'ESTADO'),
        (8, 'ADMIN', 'Pendiente', '#cccccc', 0, 0, 'ESTADOENAREA'),
        (9, 'ADMIN', 'En Lote', '#cccccc', 8, 0, 'ESTADOENAREA'),
        (10, 'DF,SB,ECOUV,IMD', 'En Rollo', '#cccccc', 9, 0, 'ESTADOENAREA'),
        (11, 'DF,SB,ECOUV,IMD', 'En Cola', '#cccccc', 10, 0, 'ESTADOENAREA'),
        (12, 'ADMIN', 'Control y Calidad', '#cccccc', 11, 0, 'ESTADOENAREA'),
        (13, 'ADMIN', 'Pronto', '#cccccc', 12, 0, 'ESTADOENAREA'),
        (14, 'ADMIN', 'Cancelado', '#cccccc', 13, 0, 'ESTADOENAREA'),
        (15, 'ADMIN', 'Finalizado', '#cccccc', 14, 0, 'ESTADOENAREA'),
        (16, 'ADMIN', 'Canasto Produccion', '#cccccc', 15, 0, 'ESTADOLOGISTICA'),
        (17, 'ADMIN', 'Canasto Incompletos', '#cccccc', 16, 0, 'ESTADOLOGISTICA'),
        (18, 'ADMIN', 'Cancelado', '#cccccc', 17, 0, 'ESTADOLOGISTICA'),
        (19, 'ADMIN', 'ENTREGADO', '#cccccc', 18, 0, 'ESTADOENAREA'),
        (20, 'EMB', 'Bordando', '#cccccc', 0, 0, 'ESTADOENAREA'),
        (21, 'IMD,ECOUV,DF,SB,TPU', 'Imprimiendo', '#cccccc', 20, 0, 'ESTADOENAREA'),
        (22, 'SB', 'Calandrando', '#cccccc', 21, 0, 'ESTADOENAREA'),
        (23, 'TWC', 'Cortando', '#cccccc', 22, 0, 'ESTADOENAREA'),
        (24, 'TWT', 'Cosiendo', '#cccccc', 23, 0, 'ESTADOENAREA'),
        (25, 'EST', 'Estampando', '#cccccc', 24, 0, 'ESTADOENAREA'),
        (26, 'ADMIN', 'Con Falla', '#cccccc', 25, 0, 'ESTADOENAREA'),
        (27, 'ADMIN', 'ESPERANDO INFO', '#cccccc', 0, 0, 'ESTADO');

    COMMIT TRAN;
    PRINT '    OK ConfigEstados (27 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '    ERROR ConfigEstados: ' + ERROR_MESSAGE();
END CATCH
GO

-- ================================================================
-- [21/21] Modulos
-- ================================================================
PRINT '>>> [21/21] Modulos';
BEGIN TRY
    BEGIN TRAN;

    -- Tabla con FK entrantes: DELETE + INSERT (no DROP)
    DELETE FROM [dbo].[Modulos];
    DBCC CHECKIDENT ('[dbo].[Modulos]', RESEED, 0) WITH NO_INFOMSGS;

    -- INSERT (76 filas)
    SET IDENTITY_INSERT [dbo].[Modulos] ON;
    INSERT INTO [dbo].[Modulos] ([IdModulo], [Titulo], [IdPadre], [Ruta], [Icono], [IndiceOrden]) VALUES
        (1, 'Informes', NULL, '/INFORMES', 'fa-layer-group', 5),
        (2, 'Sys Admin', NULL, '/admin', 'fa-shield-halved', 6),
        (3, 'Producción', NULL, '/area', 'fa-industry', 2),
        (4, 'Usuarios', 2, '/admin/users', 'fa-users', 1),
        (5, 'Gestión de Roles', 2, '/admin/roles', 'fa-users-gear', 2),
        (6, 'Auditoría', 2, '/admin/audit', 'fa-file-lines', 3),
        (7, 'Impresión', 3, '/ops/production', 'fa-layer-group', 20),
        (8, 'Inventario', 10, '/ops/inventory', 'fa-boxes-stacked', 10),
        (9, 'Dashboard', NULL, '/', 'fa-home', 1),
        (10, 'Logística WMS', NULL, '/logistica', 'fa-truck-ramp-box', 4),
        (11, 'Corte', 3, '/area/TWC', 'fa-chart-pie', 5),
        (12, 'Estampado', 3, '/area/EST', 'fa-comments', 7),
        (16, 'Admin DB', 2, '/admin/database', 'fa-database', 20),
        (17, 'DTF', 3, '/area/DF', 'fa-shirt', 1),
        (18, 'Bordado', 3, '/area/EMB', 'fa-circle-dot', 7),
        (19, 'Eco UV', 3, '/area/ecouv', 'fa-print', 2),
        (20, 'Sublimación', 3, '/area/SB', 'fa-fire', 3),
        (21, 'Costura', 3, '/area/TWT', 'fa-vest', 6),
        (22, 'Configuración', 2, '/admin/config', 'fa-gear', 19),
        (26, 'Gestion Menu', 2, '/admin/menu', NULL, 0),
        (27, 'Inventarios de Insumo', 10, '/inventario', 'fa-container-storage', 22),
        (28, 'Insumos', 10, '/insumos', 'fa-storage', 23),
        (29, 'Atención al Cliente', NULL, '/atencion-cliente', 'fa-headset', 80),
        (30, 'Ingreso Materiales', 29, '/atencion-cliente/recepcion', 'fa-box-open', 10),
        (31, 'Control Logístico', 10, '/atencion-cliente/control', 'fa-barcode', 20),
        (32, 'Control Transporte', 10, '/logistica/transporte', 'fa-truck-fast', 99),
        (34, 'Terminaciones ECOUV', 3, '/produccion/terminaciones', NULL, 2),
        (35, 'Gestion Clientes', NULL, '/admin/clientes-integration', NULL, 29),
        (36, 'Gestion de Productos', NULL, '/admin/products-integration', NULL, 30),
        (37, 'Gestion de Precios', 38, '/admin/special-prices', NULL, 31),
        (38, 'Gestión de Precios', NULL, '/admin/prices', 'fa-tags', 90),
        (39, 'Precios Estándar', 38, '/admin/base-prices', 'fa-barcode', 1),
        (40, 'Perfiles de Precios', 38, '/admin/price-profiles', 'fa-users-gear', 3),
        (43, 'Generar Etiquetas', 3, '/produccion/etiquetas', 'fa-qrcode', 30),
        (44, 'Enviar a React', 31, '/logistica/stock-deposito', NULL, 38),
        (46, 'Reposiciones', 29, '/atencion-cliente/reposiciones', NULL, 35),
        (47, 'TPU', 3, '/area/TPU', NULL, 36),
        (48, 'Impresion Directa', 3, '/area/directa', NULL, 37),
        (49, 'Historial de Lotes', 3, '/consultas/rollos', 'fa-clock-rotate-left', 99),
        (50, 'Catálogo por Cliente', 38, '/admin/price-catalog', 'fa-book-open', 4),
        (51, 'Empaquetado de Retiros', 10, '/logistica/retiros-web', 'fa-box-open', 2),
        (52, 'Administracion', NULL, NULL, 'fa-cash-register', 90),
        (53, 'Caja ACTUAL', 52, '/caja/pagos', 'fa-credit-card', 1),
        (54, 'Pagos  Online por la Web (Handy)', 52, '/caja/pagos-online', 'fa-money-check-dollar', 43),
        (55, 'Autorizaciones de Pagos ', 52, '/logistica/excepciones', 'fa-hand-holding-dollar', 44),
        (1055, 'Ingreso/ aviso de Ordenes ', 10, '/logistica/carga-deposito', 'fa-solid fa-comments', 1),
        (1056, 'depurar clientes', 2, '/admin/duplicate-clients', NULL, 46),
        (1057, 'Buscar/Actualizar Órdenes de Retiro', 10, '/logistica/buscar-ordenes', 'fa-magnifying-glass', 4),
        (1058, 'Gestion de  Encomiendas y Cadeteria', 10, '/atencion-cliente/entrega-pedidos', 'fa-truck', 3),
        (1059, 'DASHBOARD DEPOSITO', 10, '/logistica/dashboard-deposito', 'fa-chart-bar', 0),
        (1060, 'Cierre diario', 52, '/caja/cuadre', NULL, 50),
        (1061, 'Comprobar Codigo QR', 10, '/logistica/verificar-codigo', NULL, 51),
        (1062, 'Consola', 2, '/admin/consola', 'fa-terminal', 99),
        (1064, 'Agencias/Localidades', NULL, '/admin/nomencladores', NULL, 53),
        (1065, 'Importar Ordenes', 3, '/produccion/importar', NULL, 29),
        (1066, 'Auditoría de Depósito', 10, '/logistica/auditoria-deposito', 'ScanLine', 99),
        (1067, 'Agencias/Localidades', NULL, '/admin/nomencladores', NULL, 57),
        (1074, 'Importar ordenes', 3, '/produccion/importar', NULL, 29),
        (2062, 'Contabilidad', NULL, NULL, NULL, 100),
        (2063, 'Cuentas', 2062, '/contabilidad/cuentas', NULL, 10),
        (2064, 'Antiguedades de Deuda', 2079, '/contabilidad/antiguedad', NULL, 2),
        (2065, 'Estados de Cuenta', 2079, '/contabilidad/cola-estados', NULL, 3),
        (2068, 'Plan de Cuentas', 2062, '/contabilidad/plan-cuentas', 'ClipboardList', 7),
        (2069, 'Libro Mayor', 2062, '/contabilidad/libro-mayor', 'BookOpen', 5),
        (2070, 'Operaciones de Caja', 2080, '/caja/transaccion', 'Wallet', 0),
        (2072, 'Motor Asientos Generales', 2062, '/contabilidad/motor', 'fa-cogs', 6),
        (2073, 'Recursos y Planes', 2079, '/contabilidad/recursos', 'fa-cubes', 2),
        (2074, 'Reconciliación', 2062, ' /contabilidad/reconciliacion', 'fa-shield-check ', 11),
        (2075, 'Jobs / Cron', 2, ' /admin/cron', 'fa-bolt', 67),
        (2076, 'Facturas', 2079, '/contabilidad/bandeja-cfe', 'fa-file-invoice', 7),
        (2077, 'Bandeja Tesorería', 2080, '/contabilidad/tesoreria', 'Landmark', 5),
        (2078, 'Documentos', NULL, NULL, NULL, 70),
        (2079, 'Cuenta Corriente', NULL, NULL, NULL, 71),
        (2080, 'Caja', NULL, NULL, NULL, 72),
        (2081, 'Recibos', 2079, NULL, NULL, 73),
        (2082, 'Operaciones ', 2079, '/contabilidad/caja-admin', NULL, 0);
    SET IDENTITY_INSERT [dbo].[Modulos] OFF;

    COMMIT TRAN;
    PRINT '    OK Modulos (76 filas)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    SET IDENTITY_INSERT [dbo].[Modulos] OFF;
    PRINT '    ERROR Modulos: ' + ERROR_MESSAGE();
END CATCH
GO

-- Rehabilitar FK constraints
EXEC sp_MSforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL';
GO

-- ================================================================
PRINT '================================================================';
PRINT ' SCRIPT COMPLETADO';
PRINT ' Tablas: 21';
PRINT '================================================================';
GO
