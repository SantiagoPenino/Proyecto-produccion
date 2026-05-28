const fs = require('fs');
const readline = require('readline');

async function main() {
    const fileStream = fs.createReadStream('c:/Integracion/User-Macrosoft/Proyecto-produccion/backend/logs/combined-2026-05-28.log');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    console.log("--- CHRONOLOGICAL TRACE FOR XSB-62532 ---");
    let lineNum = 0;
    for await (const line of rl) {
        lineNum++;
        if (line.includes('XSB-62532')) {
            console.log(`${lineNum}: ${line}`);
        }
    }
}

main();
