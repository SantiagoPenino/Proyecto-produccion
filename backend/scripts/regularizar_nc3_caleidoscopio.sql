/*
  Regularización NC-3 — Fundación Caleidoscopio ($ 2.515,01)

  DGI tiene 3 e-Facturas por UNA sola venta:
    A-27324  = ET-1195 (DocId 3112)  — el "E-Ticket" salió como e-Factura con RUT
    A-27394  = NC-3    (DocId 3817)  — la NC salió como VENTA (bug DocTipo truncado)
    A-27411  = FA-134  (DocId 3888)  — la factura que queda

  Se anulan A-27394 y A-27324 con dos NC de e-Factura (112), SOLO ante DGI.

  PASO 1 (en la app): Bandeja CFE → "NC Factura Externa", dos veces:
      Cliente Fundación Caleidoscopio, tipo FACTURA, total 2.515,01 UYU, línea por 2.515,01 (IVA 22%)
      a) serie A, número 27394, fecha 13/07/2026, motivo "Anula e-Factura A-27394 emitida por error (NC-3)"
      b) serie A, número 27324, fecha 07/07/2026, motivo "Anula e-Factura A-27324 (ET-1195), reemplazada por A-27411"
    NO movimiento, NO deuda, NO asiento (así funciona "NC Factura Externa").
    NO enviarlas todavía.

  PASO 2 (este script): apuntar cada NC al comprobante REAL en vez del documento
  "externo" que crea el botón. Así la referencia viaja específica
  (e_Factura serie A + número) y no como referencia global en texto.
*/

-- 2.1) Ubicar las dos NC nuevas (pendientes, del cliente, 2.515,01, apuntando a un "Externa")
SELECT n.DocIdDocumento, n.DocSerie + '-' + n.DocNumero AS NC, n.DocTipo, n.DocTotal, n.CfeEstado,
       n.DocIdDocumentoRef, r.DocTipo AS RefTipo, r.DocSerie AS RefSerie, r.DocNumero AS RefNumero
FROM dbo.DocumentosContables n
JOIN dbo.DocumentosContables r ON r.DocIdDocumento = n.DocIdDocumentoRef
WHERE n.CliIdCliente = (SELECT CliIdCliente FROM dbo.DocumentosContables WHERE DocIdDocumento = 3817)
  AND n.DocTotal = 2515.01
  AND n.CfeEstado = 'PENDIENTE'
  AND r.DocTipo LIKE '%Extern%';
-- Tienen que salir 2 filas: una con RefNumero 27394 y otra con RefNumero 27324.

-- 2.2) Reapuntar
BEGIN TRAN;

UPDATE n SET n.DocIdDocumentoRef = 3817          -- NC-3 = A-27394
FROM dbo.DocumentosContables n
JOIN dbo.DocumentosContables r ON r.DocIdDocumento = n.DocIdDocumentoRef
WHERE n.CliIdCliente = (SELECT CliIdCliente FROM dbo.DocumentosContables WHERE DocIdDocumento = 3817)
  AND n.DocTotal = 2515.01 AND n.CfeEstado = 'PENDIENTE'
  AND r.DocTipo LIKE '%Extern%' AND LTRIM(RTRIM(r.DocNumero)) = '27394';
SELECT @@ROWCOUNT AS Reapuntada_A27394;   -- tiene que dar 1

UPDATE n SET n.DocIdDocumentoRef = 3112          -- ET-1195 = A-27324
FROM dbo.DocumentosContables n
JOIN dbo.DocumentosContables r ON r.DocIdDocumento = n.DocIdDocumentoRef
WHERE n.CliIdCliente = (SELECT CliIdCliente FROM dbo.DocumentosContables WHERE DocIdDocumento = 3817)
  AND n.DocTotal = 2515.01 AND n.CfeEstado = 'PENDIENTE'
  AND r.DocTipo LIKE '%Extern%' AND LTRIM(RTRIM(r.DocNumero)) = '27324';
SELECT @@ROWCOUNT AS Reapuntada_A27324;   -- tiene que dar 1

-- Si las dos dieron 1: COMMIT.  Si no: ROLLBACK y avisar.
-- COMMIT;
-- ROLLBACK;

/*
  PASO 3: en la Bandeja CFE, botón verde de cada NC nueva → vista previa. Tiene que decir:
     112 · NC de e-Factura
     Receptor: RUT 218076410019
     Referencia: e_Factura, serie A, número 27394 (o 27324) — NO "global"
  Recién ahí confirmar el envío.
*/
