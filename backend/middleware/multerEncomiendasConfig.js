const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Ruta de la carpeta donde se guardarán los comprobantes de las encomiendas (Logística)
const uploadFolder = process.env.COMPROBANTES_ENCOMIENDAS_PATH || path.join(__dirname, '../comprobantesEncomiendas');

// Verificar y crear la carpeta si no existe
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

// Multer con memoryStorage: el archivo queda en buffer para procesarlo con Sharp
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // máximo 20 MB entrada
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|bmp|tiff|heic|heif/i;
    const ext = path.extname(file.originalname).replace('.', '');
    if (allowed.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${ext}`));
    }
  }
});

/**
 * Middleware compuesto: multer (memoria) → Sharp (WebP comprimido) → disco
 * Resultado: req.file.filename / req.file.path disponibles igual que diskStorage
 */
const uploadEncomiendas = {
  single: (fieldName) => [
    upload.single(fieldName),
    async (req, res, next) => {
      if (!req.file) return next(); // sin archivo, continuar normalmente

      try {
        const remitoCode = req.params.code || 'SIN-REMITO';

        // Orden de retiro asociada (enviada como campo de texto en el FormData)
        const rawOrden = (req.body?.ordenDeRetiro || '').trim();
        const ordenSufijo = rawOrden
          ? rawOrden.replace(/^[A-Za-z]+-?/, '').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
          : (() => {
              const now = new Date();
              return [now.getHours(), now.getMinutes(), now.getSeconds()]
                .map(n => String(n).padStart(2, '0')).join('');
            })();

        const filename = `${remitoCode}-${ordenSufijo}.webp`;
        const destPath = path.join(uploadFolder, filename);

        // Convertir a WebP calidad 75 y achicar a 1200 px de ancho si es más grande.
        // (Las demás fotos del sistema usan 80 / lado mayor 1080 — utils/imagenWebp.js —;
        // encomiendas se queda en 75 por decisión del 07/10/2026.)
        await sharp(req.file.buffer)
          .rotate()                    // corregir orientación EXIF automáticamente
          .resize({ width: 1200, withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(destPath);

        // Exponer los mismos campos que diskStorage para no romper el controlador
        req.file.filename = filename;
        req.file.path = destPath;
        req.file.destination = uploadFolder;

        next();
      } catch (err) {
        next(err);
      }
    }
  ]
};

module.exports = uploadEncomiendas;
