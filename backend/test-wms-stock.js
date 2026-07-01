require('dotenv').config();

async function checkVariantes() {
    const wmsUrl = process.env.WMS_API_URL || 'https://administracionuser.uy/api';

    const query = `
        USE Ventas_Dev;
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'Stock_Variantes'
    `;

    try {
        const response = await fetch(`${wmsUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });

        const data = await response.json();
        console.log('Stock_Variantes Columns:', data.data);
    } catch (error) {
        console.error('Error fetching stock:', error);
    }
}

checkVariantes();
