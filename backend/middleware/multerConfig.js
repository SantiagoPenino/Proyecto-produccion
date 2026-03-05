const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ruta de la carpeta donde se guardarán los archivos
const uploadFolder = path.join(__dirname, '../comprobantesPagos');

// Verificar y crear la carpeta si no existe
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true }); // Crea la carpeta, incluso si faltan directorios intermedios
}

// Configuración de almacenamiento para Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadFolder); // Usar la carpeta asegurada
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName); // Generar un nombre único para evitar conflictos
  },
});

// Crear instancia de Multer con configuración
const upload = multer({ storage });

module.exports = upload;
