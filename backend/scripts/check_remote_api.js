const axios = require('axios');

(async () => {
    try {
        console.log("Probando conexión a https://administracionuser.uy/api/apiproducto/data ...");
        const res = await axios.get('https://administracionuser.uy/api/apiproducto/data');
        console.log("✅ ÉXITO. Status:", res.status);
        if (Array.isArray(res.data)) console.log(`Data count: ${res.data.length}`);
    } catch (e) {
        console.error("❌ FALLO:", e.message);
        if (e.response) {
            console.error("Status:", e.response.status);
            console.error("Data:", e.response.data);
        } else {
            console.error("Code:", e.code);
        }
    }
})();
