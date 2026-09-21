'use strict';
// Adjuntos de las Solicitudes de vendedores (specs/41). El archivo pasa por
// uploads/tmp y de ahí va a Google Drive; el service lo borra del disco en su finally.
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadFolder = path.join(__dirname, '../uploads/tmp');
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => cb(null, `sol-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname || '')}`),
});

// multer entrega el nombre en latin1: sin esto los acentos del nombre original llegan rotos.
const fileFilter = (req, file, cb) => {
  try { file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8'); } catch (_) {}
  cb(null, true);
};

module.exports = multer({ storage, fileFilter, limits: { fileSize: 500 * 1024 * 1024 } });
