const fs = require('fs');
const path = 'c:/Integracion/User-Macrosoft/Proyecto-produccion/src/components/pages/CajaTransaccionView.jsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /<div className=\"col-span-1\">\s*<label className=\"text-\[10px\] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1\">Monto de Salida<\/label>/,
  '<div className="col-span-2">\n                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Monto de Salida</label>'
);

const start = content.indexOf('<label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Método de Retiro</label>');
const parentDivStart = content.lastIndexOf('<div className="col-span-1">', start);
const endLabel = content.indexOf('<label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Referencia / Observaciones de Salida</label>');
const parentDivEnd = content.indexOf('</div>', content.indexOf('</textarea>', endLabel)) + 6;

if (parentDivStart !== -1 && parentDivEnd !== -1) {
    content = content.substring(0, parentDivStart) + content.substring(parentDivEnd);
    fs.writeFileSync(path, content, 'utf8');
    console.log('Deleted duplicated fields');
} else {
    console.log('Could not find ranges', parentDivStart, parentDivEnd);
}
