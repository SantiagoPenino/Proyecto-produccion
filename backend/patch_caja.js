const fs = require('fs');
const path = 'c:/Integracion/User-Macrosoft/Proyecto-produccion/backend/services/cajaService.js';
let c = fs.readFileSync(path, 'utf8');

// Texto exacto con 3 espacios (lo vimos en el contexto)
const target = 'LEFT JOIN dbo.Articulos art ON art.ProIdProducto = ISNULL(pcd.ProIdProducto, od.ProIdProducto)\r\n                   WHERE td.TcaIdTransaccion = @tcaId';
const replacement = 'LEFT JOIN dbo.Articulos art ON art.ProIdProducto = ISNULL(pcd.ProIdProducto, od.ProIdProducto)\r\n                   -- Fallback: articulo correcto desde OrdenesDeposito cuando pcd.ProIdProducto es generico\r\n                   LEFT JOIN dbo.Articulos artod ON artod.ProIdProducto = od.ProIdProducto\r\n                   WHERE td.TcaIdTransaccion = @tcaId';

if (c.includes(target)) {
    // Solo primera ocurrencia
    c = c.replace(target, replacement);
    fs.writeFileSync(path, c, 'utf8');
    console.log('artod JOIN agregado OK');
    // Verificar cuantas ocurrencias hay ahora
    const count = (c.match(/LEFT JOIN dbo\.Articulos artod/g) || []).length;
    console.log('Total artod JOINs en el archivo:', count);
} else {
    console.log('Target aun no encontrado');
}
