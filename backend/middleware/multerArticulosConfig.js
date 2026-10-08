const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadFolder = require('../utils/rutasUploads').rutaUploads('articulos'); // UPLOADS_PATH

if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadFolder);
  },
  filename: (req, file, cb) => {
    const uniqueName = `art-${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const uploadArticulo = multer({ storage });
module.exports = uploadArticulo;
