-- =====================================================================
-- TABLA NUEVA: OrdenTalles
-- =====================================================================
-- Contexto: alta interna de pedidos de prendas (/ventas/pedido-prenda).
-- La "Tabla de Talles" del form (número, nombre de jugador, talle, categoría
-- por fila) se guarda acá, ligada a la Orden PRINCIPAL del pedido (no a los
-- servicios complementarios). El insert lo hace prendasOrdersController.js
-- dentro de la misma transacción de creación de la orden — si esta tabla no
-- existe todavía, ese insert falla en silencio (no aborta el pedido) hasta
-- que se corra este script.
--
-- No se corre en producción por mí — lo ejecuta el usuario.

CREATE TABLE dbo.OrdenTalles (
    OrdenTalleID  INT IDENTITY(1,1) PRIMARY KEY,
    OrdenID       INT NOT NULL FOREIGN KEY REFERENCES dbo.Ordenes(OrdenID),
    Tipo          VARCHAR(10) NOT NULL,   -- 'ADULTO' | 'NINO'
    TalleSup      VARCHAR(10) NULL,
    TalleInf      VARCHAR(10) NULL,
    Categoria     VARCHAR(30) NULL,       -- 'Jugador' | 'Golero' | 'Técnico'
    Numero        VARCHAR(10) NULL,
    Jugador       VARCHAR(100) NULL,
    Nota          NVARCHAR(300) NULL,
    Cantidad      INT NOT NULL DEFAULT 1,
    FechaRegistro DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE INDEX IX_OrdenTalles_OrdenID ON dbo.OrdenTalles(OrdenID);

-- Verificación
SELECT * FROM sys.tables WHERE name = 'OrdenTalles';
