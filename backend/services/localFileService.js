// SIN USO (13/10): solo lo requiere controllers/chatController.js (sin uso). Ver docs/auditoria-limpieza-2026-10-09.md.
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const logger = require('../utils/logger');

const MANUALS_DIR = path.join(__dirname, '../../Manuales');

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];
    files.forEach(function (file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });
    return arrayOfFiles;
}

async function extractText(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    try {
        if (ext === '.docx') {
            const buffer = fs.readFileSync(filePath);
            // USAMOS HTML para preservar TABLAS y ESTRUCTURA
            // La IA entiende HTML, así que sabrá qué es fila y qué columna.
            const result = await mammoth.convertToHtml({ buffer: buffer });
            return result.value || "";
        }
        else if (ext === '.pdf') {
            // Lazy-load pdf-parse to avoid crashing on startup if native deps fail
            const pdf = require('pdf-parse');
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdf(dataBuffer);
            return data.text || "";
        }
        else if (['.txt', '.md', '.json', '.csv', '.js', '.html'].includes(ext)) {
            return fs.readFileSync(filePath, 'utf8');
        }
    } catch (e) {
        logger.error(`Error leyendo ${filePath}:`, e.message);
        return "";
    }
    return "";
}

/**
 * STRATEGY: FULL CONTEXT (Lectura Total)
 * Returns the consolidated content of ALL files in the Manuales directory.
 * Ideal for Gemini 1.5 Flash (1M Token context).
 */
exports.getAllFilesContent = async () => {
    try {
        if (!fs.existsSync(MANUALS_DIR)) return "⚠️ Carpeta Manuales no existe.";

        const allFiles = getAllFiles(MANUALS_DIR);
        let fullLibraryContext = "";
        let fileCount = 0;

        // logger.info(`📚 [LocalService] Cargando biblioteca completa (${allFiles.length} archivos docx/pdf/txt)...`);

        for (const filePath of allFiles) {
            const ext = path.extname(filePath).toLowerCase();
            if (!['.docx', '.pdf', '.txt', '.md', '.json', '.csv'].includes(ext)) continue;

            const content = await extractText(filePath);
            if (content && content.length > 20) {
                const fileName = path.basename(filePath);
                // Delimiters for AI to understand file boundaries
                fullLibraryContext += `\n--- INICIO DOCUMENTO: ${fileName} ---\n${content}\n--- FIN DOCUMENTO: ${fileName} ---\n`;
                fileCount++;
            }
        }

        if (fileCount === 0) return "⚠️ No se encontraron documentos válidos en la carpeta Manuales.";

        logger.info(`📚 [LocalService] Biblioteca OK: ${fileCount} docs cargados. Total caracteres: ${fullLibraryContext.length}.`);
        return fullLibraryContext;

    } catch (error) {
        return `❌ Error leyendo biblioteca: ${error.message}`;
    }
};

/**
 * Legacy/Compat alias: when 'searchFiles' is called, we return EVERYTHING.
 * This effectively disables keyword filtering and switches to Semantic Reading via LLM.
 */
exports.searchFiles = async (query) => {
    return await exports.getAllFilesContent();
};
