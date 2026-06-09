const fs = require('fs');
const path = 'c:/Integracion/User-Macrosoft/Proyecto-produccion/backend/controllers/cajaController.js';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(/concepto:\s*\`Nota de D.*motivo \|\| 'Reverso NC'}\`,/, "concepto: \`Nota de Débito ${fullNdNumero} - ${motivo || 'Reverso NC'}\`,");
fs.writeFileSync(path, content, 'utf8');
console.log('Replaced');
