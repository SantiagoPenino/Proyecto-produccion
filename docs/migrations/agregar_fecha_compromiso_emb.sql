-- [BORDADO] Fecha Compromiso real (capacidad + cola) y Magnitud en la unidad de
-- capacidad (puntadas totales) — ver project_capacidad_planta.md, 25-ago-2026.
-- Columnas nuevas, nullable, aditivas — sin riesgo para el resto del sistema.
-- NUNCA tocar Ordenes.Magnitud (el pricing ya la usa como cantidad de piezas).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='MagnitudCapacidad' AND Object_ID = Object_ID('dbo.Ordenes'))
BEGIN
    ALTER TABLE dbo.Ordenes ADD MagnitudCapacidad DECIMAL(18,2) NULL; -- puntadas TOTALES del diseño (piezas x puntadas c/u), solo EMB
END
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='FechaCompromiso' AND Object_ID = Object_ID('dbo.Ordenes'))
BEGIN
    ALTER TABLE dbo.Ordenes ADD FechaCompromiso DATE NULL; -- fecha prometida real (capacidad+cola), congelada al vender. Igual en todas las órdenes-hermanas del mismo pedido.
END

-- Colchón de días de preparación de matriz (tiempo de diseño en computadora, no bloquea la
-- máquina) — editable después desde Configuración → Configuración General. Valor inicial: 2 días.
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'EMB_DIAS_PREPARACION_MATRIZ')
BEGIN
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('EMB_DIAS_PREPARACION_MATRIZ', 'EMB', '2');
END
