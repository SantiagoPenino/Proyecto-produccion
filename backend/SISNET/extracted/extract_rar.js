const fs = require('fs');
const { createExtractorFromFile } = require('node-unrar-js');

async function extract() {
  try {
    const extractor = await createExtractorFromFile({
      filepath: 'ejemplos.rar',
      targetPath: './ejemplos'
    });
    
    const extraction = extractor.extract();
    for (const file of extraction.files) {
        console.log(`Extracted: ${file.fileHeader.name}`);
    }
  } catch (err) {
    console.error(err);
  }
}

extract();
