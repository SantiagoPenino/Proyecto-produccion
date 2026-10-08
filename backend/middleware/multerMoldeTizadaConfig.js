const multer = require('multer');
const path = require('path');
const fs = require('fs');

// PDF del molde de TizadaPro, subido una vez por molde para dibujar las siluetas de sus piezas.
// Se guarda por la clave del molde (legacy_id) para poder reprocesarlo.
const uploadFolder = require('../utils/rutasUploads').rutaUploads('moldes-tizadapro'); // UPLOADS_PATH
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => {
    const ref = String(req.params.ref || 'molde').replace(/[^A-Za-z0-9_-]/g, '_');
    cb(null, `${ref}-${Date.now()}.pdf`);
  },
});

module.exports = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const esPdf = /pdf$/i.test(file.mimetype) || /\.pdf$/i.test(file.originalname || '');
    cb(esPdf ? null : new Error('El molde tiene que ser el PDF vectorial que exporta el CAD.'), esPdf);
  },
});
