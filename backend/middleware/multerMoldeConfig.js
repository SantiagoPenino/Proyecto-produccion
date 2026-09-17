const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Moldes escalados: PDF de plotter a escala 1:1. Mismo patrón que
// multerFichaDisenoConfig, con dos diferencias: sólo acepta PDF (un JPG de un
// molde no se puede despiezar) y tiene tope de tamaño, porque estos archivos
// vienen de un CAD y pueden ser pesados.
const uploadFolder = path.join(__dirname, '../uploads/moldes');

if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadFolder);
  },
  filename: (req, file, cb) => {
    const uniqueName = `mol-${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const uploadMolde = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const esPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    if (!esPdf) return cb(new Error('El molde tiene que ser un PDF vectorial exportado del CAD.'));
    cb(null, true);
  },
});

module.exports = uploadMolde;
