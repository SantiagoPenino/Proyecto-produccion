const fs = require('fs');
const readline = require('readline');

async function main() {
    const fileStream = fs.createReadStream('c:/Integracion/User-Macrosoft/Proyecto-produccion/backend/logs/combined-2026-05-28.log');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    console.log("--- BUSCANDO LOGS CLAVES ---");
    for await (const line of rl) {
        if (line.includes('METROS') || line.includes('62532') || line.includes('17.32') || line.includes('17,32') || line.includes('Plan #3') || line.includes('12475') || line.includes('12476')) {
            console.log(line);
        }
    }
}

main();
