const apiService = require('./apiService');

const pedidoDetalladoV2 = async (req, res) => {
    try {
        const id = req.params.id || 28;
        const data = await apiService.getPedidoCompleto(id);

        // Formateamos la respuesta para que tu Frontend la entienda fácil
        const pedidoFinal = {
            cabecera: {
                numero: data.NroFact,
                cliente: data.Nombre.trim(),
                fecha: data.Fecha,
                total: data.TotalDebe
            },
            lineas: data.Lineas.map(linea => ({
                descripcion: linea.Descripcion.trim(),
                cantidad: linea.CantidadHaber,
                precio: linea.Precio,
                // PROCESAMOS LAS SUBLÍNEAS (Tus nuevos datos)
                especificaciones: linea.Sublineas.map(sub => ({
                    archivo: sub.Archivo || null,
                    nota: sub.Notas || "Sin notas",
                    esDrive: sub.Archivo.includes("drive.google.com")
                }))
            }))
        };

        res.json({ success: true, data: pedidoFinal });

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Error al sincronizar con la API externa" 
        });
    }
};
