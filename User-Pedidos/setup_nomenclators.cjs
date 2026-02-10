const path = require('path');
const dbConfigPath = path.resolve('C:/Integracion/User-Macrosoft/backend/config/db.js');
const { sql, getPool } = require(dbConfigPath);

async function setupNomenclators() {
    try {
        const pool = await getPool();
        console.log("🇺🇾 Configurando Nomencladores de Uruguay...");

        // 1. Create Tables
        await pool.request().query(`
            -- Departamentos
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Departamentos' AND xtype='U')
            CREATE TABLE Departamentos (
                ID INT PRIMARY KEY IDENTITY(1,1),
                Nombre NVARCHAR(100) NOT NULL
            );

            -- Localidades
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Localidades' AND xtype='U')
            CREATE TABLE Localidades (
                ID INT PRIMARY KEY IDENTITY(1,1),
                DepartamentoID INT FOREIGN KEY REFERENCES Departamentos(ID),
                Nombre NVARCHAR(100) NOT NULL
            );

            -- Agencias
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Agencias' AND xtype='U')
            CREATE TABLE Agencias (
                ID INT PRIMARY KEY IDENTITY(1,1),
                Nombre NVARCHAR(100) NOT NULL
            );

            -- Formas de Envio
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='FormasEnvio' AND xtype='U')
            CREATE TABLE FormasEnvio (
                ID INT PRIMARY KEY IDENTITY(1,1),
                Nombre NVARCHAR(100) NOT NULL
            );
        `);

        // 2. Populate Formas de Envio
        const formasEnvio = ['Retiro en el Local', 'Encomienda (Agencia)', 'Envío a Domicilio'];
        for (const forma of formasEnvio) {
            await pool.request().input('N', sql.NVarChar, forma).query(`
                IF NOT EXISTS (SELECT 1 FROM FormasEnvio WHERE Nombre = @N)
                INSERT INTO FormasEnvio (Nombre) VALUES (@N)
            `);
        }
        console.log("✅ Formas de Envío cargadas.");

        // 3. Populate Agencias
        const agencias = ['DAC', 'Mirtrans', 'Correo Uruguayo', 'Turil', 'Nuñez', 'DePunta', 'Cot', 'Cita'];
        for (const agencia of agencias) {
            await pool.request().input('N', sql.NVarChar, agencia).query(`
                IF NOT EXISTS (SELECT 1 FROM Agencias WHERE Nombre = @N)
                INSERT INTO Agencias (Nombre) VALUES (@N)
            `);
        }
        console.log("✅ Agencias cargadas.");

        // 4. Populate Departamentos & Localidades (Simplified List for Demo)
        const deps = [
            { name: 'Artigas', locs: ['Artigas', 'Bella Unión'] },
            { name: 'Canelones', locs: ['Canelones', 'Ciudad de la Costa', 'Las Piedras', 'Pando', 'La Paz'] },
            { name: 'Cerro Largo', locs: ['Melo', 'Río Branco'] },
            { name: 'Colonia', locs: ['Colonia del Sacramento', 'Carmelo', 'Juan Lacaze'] },
            { name: 'Durazno', locs: ['Durazno', 'Sarandí del Yí'] },
            { name: 'Flores', locs: ['Trinidad'] },
            { name: 'Florida', locs: ['Florida', 'Sarandí Grande'] },
            { name: 'Lavalleja', locs: ['Minas', 'José Pedro Varela'] },
            { name: 'Maldonado', locs: ['Maldonado', 'Punta del Este', 'San Carlos', 'Piriápolis'] },
            { name: 'Montevideo', locs: ['Montevideo'] },
            { name: 'Paysandú', locs: ['Paysandú', 'Guichón'] },
            { name: 'Río Negro', locs: ['Fray Bentos', 'Young'] },
            { name: 'Rivera', locs: ['Rivera', 'Tranqueras'] },
            { name: 'Rocha', locs: ['Rocha', 'Chuy', 'La Paloma'] },
            { name: 'Salto', locs: ['Salto'] },
            { name: 'San José', locs: ['San José de Mayo', 'Libertad'] },
            { name: 'Soriano', locs: ['Mercedes', 'Dolores'] },
            { name: 'Tacuarembó', locs: ['Tacuarembó', 'Paso de los Toros'] },
            { name: 'Treinta y Tres', locs: ['Treinta y Tres'] }
        ];

        for (const d of deps) {
            // Insert Dept
            let res = await pool.request().input('N', sql.NVarChar, d.name).query(`
                IF NOT EXISTS (SELECT 1 FROM Departamentos WHERE Nombre = @N)
                INSERT INTO Departamentos (Nombre) VALUES (@N);
                
                SELECT ID FROM Departamentos WHERE Nombre = @N;
            `);
            const depId = res.recordset[0].ID;

            // Insert Locs
            for (const loc of d.locs) {
                await pool.request()
                    .input('DID', sql.Int, depId)
                    .input('N', sql.NVarChar, loc)
                    .query(`
                        IF NOT EXISTS (SELECT 1 FROM Localidades WHERE Nombre = @N AND DepartamentoID = @DID)
                        INSERT INTO Localidades (DepartamentoID, Nombre) VALUES (@DID, @N)
                    `);
            }
        }
        console.log("✅ Departamentos y Localidades cargados.");

        // 5. Update Clientes Table to link to these new IDs
        // We will keep the old 'Localidad' and 'Agencia' text fields for backwards compatibility 
        // or compatibility with existing data, but add FK columns.
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Clientes' AND COLUMN_NAME = 'DepartamentoID')
            BEGIN
                ALTER TABLE Clientes ADD DepartamentoID INT FOREIGN KEY REFERENCES Departamentos(ID);
                ALTER TABLE Clientes ADD LocalidadID INT FOREIGN KEY REFERENCES Localidades(ID);
                ALTER TABLE Clientes ADD AgenciaID INT FOREIGN KEY REFERENCES Agencias(ID);
                ALTER TABLE Clientes ADD FormaEnvioID INT FOREIGN KEY REFERENCES FormasEnvio(ID);
                PRINT '✅ Columnas FK agregadas a Clientes.';
            END
        `);

    } catch (err) {
        console.error("❌ Error:", err);
    }
}

setupNomenclators();
