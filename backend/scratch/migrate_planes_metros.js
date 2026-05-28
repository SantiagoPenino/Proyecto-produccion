const { getPool, sql } = require('../config/db');

async function main() {
  try {
    const pool = await getPool();
    console.log('Running migration on PlanesMetros...');

    const result = await pool.request().query(`
      IF NOT EXISTS (
          SELECT 1 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'PlanesMetros' AND COLUMN_NAME = 'PlaFechaBaja'
      )
      BEGIN
          ALTER TABLE dbo.PlanesMetros ADD PlaFechaBaja DATETIME NULL;
          PRINT 'Columna PlaFechaBaja agregada.';
      END
      ELSE
      BEGIN
          PRINT 'La columna PlaFechaBaja ya existe.';
      END

      IF NOT EXISTS (
          SELECT 1 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'PlanesMetros' AND COLUMN_NAME = 'PlaUsuarioBaja'
      )
      BEGIN
          ALTER TABLE dbo.PlanesMetros ADD PlaUsuarioBaja INT NULL;
          PRINT 'Columna PlaUsuarioBaja agregada.';
      END
      ELSE
      BEGIN
          PRINT 'La columna PlaUsuarioBaja ya existe.';
      END
    `);

    console.log('Migration ran successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error running migration:', err);
    process.exit(1);
  }
}

main();
