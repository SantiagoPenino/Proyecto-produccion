const fs = require('fs');

const path = 'c:/Integracion/User-Macrosoft/Proyecto-produccion/backend/controllers/productsIntegrationController.js';
let content = fs.readFileSync(path, 'utf8');

// Use regex to remove ANY existing module.exports block
content = content.replace(/module\.exports\s*=\s*{[^}]*};\s*/g, '');

const exportsStr = `module.exports = {
    getLocalArticles,
    getRemoteProducts,
    linkProduct,
    unlinkProduct,
    updateLocalProduct,
    createLocalProduct,
    updateWmsMasterId,
    uploadArticleImage,
    getWmsMasters,
    getWmsVariants,
    importWmsMaster
};`;

content = content + '\n\n' + exportsStr;

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed exports');
