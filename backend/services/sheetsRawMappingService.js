const logger = require('../utils/logger');

/**
 * Convierte un Array crudo de Google Sheets en el objeto JSON estandar del ERP
 */
class SheetsRawMappingService {

    // Convierte [ 'TP-24', null, 'Juan' ] en { A: 'TP-24', C: 'Juan' }
    static _normalizeRow(f) {
        if (!f) return {};
        if (!Array.isArray(f)) return f; // Ya es objeto de letras
        const obj = {};
        for (let i = 0; i < f.length; i++) {
            if (f[i] === '' || f[i] == null) continue;
            let temp = i, letra = '';
            while (temp >= 0) {
                letra = String.fromCharCode((temp % 26) + 65) + letra;
                temp = Math.floor(temp / 26) - 1;
            }
            obj[letra] = f[i];
        }
        return obj;
    }

    static mapToOrderPayload(rawDataObj) {
        try {
            const { idExterno, area, rawRow, matrizData, datosPorHoja,
                    baseRow, baseIngresoRow } = rawDataObj;

            // ── Construir datosPorHoja si no viene en ese formato ────────────────
            // actionImportarOrdenesCompletas devuelve rawRow (BASE INGRESO) y baseRow (BASE)
            // por separado. Lo unificamos aquí para que los mappers puedan leer ambas hojas.
            let resolvedDatosPorHoja = datosPorHoja;
            if (!resolvedDatosPorHoja && (baseRow || baseIngresoRow)) {
                resolvedDatosPorHoja = {};
                if (baseIngresoRow) resolvedDatosPorHoja["BASE INGRESO"] = baseIngresoRow;
                if (baseRow)        resolvedDatosPorHoja["BASE"]          = baseRow;
            }

            // Reconstruir un "normRow" principal para la lógica inferior
            let normRow = {};
            let dMatriz = [];

            if (resolvedDatosPorHoja) {
                // Nuevo formato unificado puro: Extraer hoja principal
                let keys = Object.keys(resolvedDatosPorHoja);
                let selectedKey = keys.find(k => k.includes("INGRESO")) || keys.find(k => k.includes("BASE")) || keys.find(k => k.includes("PROD")) || keys[0];
                if (selectedKey) normRow = resolvedDatosPorHoja[selectedKey];

                if (resolvedDatosPorHoja["MATRIZ"]) dMatriz = [resolvedDatosPorHoja["MATRIZ"]]; // Convertimos a arr para compatibilidad
            } else if (rawRow) {
                normRow = this._normalizeRow(rawRow);
                dMatriz = matrizData || [];
            } else {
                return null;
            }

            // Alias Normalization
            const areaUpper = (area || "").toUpperCase().trim();
            const esFamiliaDF = ["DF", "UVDF", "RDF", "XDF", "RXDF", "RUVDF"].includes(areaUpper);
            const esFamiliaECOUV = ["ECOUV", "XECOUV", "RECOUV", "RXECOUV"].includes(areaUpper);
            const esFamiliaTPU = ["TPU", "TP", "RTPU", "RTP"].includes(areaUpper);
            const esFamiliaSB = ["SB", "XSB", "RSB", "RXSB"].includes(areaUpper);
            const esFamiliaIMD = ["IMD", "XMD", "XIMD", "RIMD", "RXIMD"].includes(areaUpper);
            const esFamiliaCenco = ["TWC", "TWT", "RTWC"].includes(areaUpper);
            const esFamiliaEMB = ["EMB", "XEMB", "REMB", "RXEMB"].includes(areaUpper);

            if (esFamiliaDF) return this.mapDF(idExterno, "DF", normRow, resolvedDatosPorHoja);
            if (esFamiliaECOUV) return this.mapECOUV(idExterno, "ECOUV", normRow, resolvedDatosPorHoja);
            if (esFamiliaTPU) return this.mapTPU(idExterno, "TPUT", normRow, dMatriz, resolvedDatosPorHoja);
            if (esFamiliaSB) return this.mapSB(idExterno, "SB", normRow, resolvedDatosPorHoja);
            if (esFamiliaIMD) return this.mapIMD(idExterno, "IMD", normRow, resolvedDatosPorHoja);
            if (esFamiliaCenco) return this.mapGenerico(idExterno, "TWC", normRow, resolvedDatosPorHoja);
            if (esFamiliaEMB) return this.mapEMB(idExterno, "EMB", normRow, resolvedDatosPorHoja);

            // Fallback Generico
            return this.mapGenerico(idExterno, areaUpper, normRow, resolvedDatosPorHoja);
        } catch (error) {
            logger.error(`[SheetsRawMappingService] Error al mapear orden ${rawDataObj?.idExterno}: ${error.message}`);
            return null;
        }
    }

    static mapECOUV(idExterno, areaId, f, datosPorHoja) {
        const clienteNom = f.C ? f.C.toString().trim() : "";
        const nombreTrabajo = f.D ? f.D.toString().trim() : "S/N";
        const prioridadStr = f.E ? f.E.toString().toUpperCase() : (f.F ? f.F.toString().toUpperCase() : "");
        const prioridad = prioridadStr.includes("URGENT") ? "Urgente" : "Normal";
        
        const material = (f.J || f.I || "").toString().trim();
        const variante = (f.H || "").toString().trim();

        let cantidadReal = parseFloat(f.F) || parseFloat(f.B) || 1;
        if (datosPorHoja && datosPorHoja["BASE"] && datosPorHoja["BASE"].B) {
            const baseCant = parseFloat(datosPorHoja["BASE"].B);
            if (!isNaN(baseCant) && baseCant > 0) cantidadReal = baseCant;
        }

        const colFiles = ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
        const colCopias = ['U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD'];
        const colMetros = ['AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP'];

        let itemsResult = [];
        const hojaBase = (datosPorHoja && datosPorHoja["BASE"]) ? datosPorHoja["BASE"] : f;

        for (let i = 0; i < 10; i++) {
            const fileUrl = hojaBase[colFiles[i]] ? hojaBase[colFiles[i]].toString().trim() : null;
            if (fileUrl && fileUrl.includes('http')) {
                const copias = parseFloat(hojaBase[colCopias[i]]) || 1;
                const metros = parseFloat(hojaBase[colMetros[i]]) || 0;
                itemsResult.push({ fileName: fileUrl, cantidad: metros > 0 ? metros : cantidadReal, copias });
            }
        }
        if (itemsResult.length === 0) itemsResult.push({ fileName: "Sin link", cantidad: cantidadReal, copias: 1 });

        cantidadReal = Math.round(cantidadReal * 100) / 100;

        return { 
            idExterno, idServicioBase: areaId, nombreTrabajo, prioridad, metrosTotales: cantidadReal, 
            clienteInfo: { id: clienteNom, idReact: 0 }, archivosReferencia: [], archivosTecnicos: [], 
            servicios: [{ areaId, esPrincipal: true, cabecera: { material, variante, metros: cantidadReal }, items: itemsResult, variablesEspeciales: {} }] 
        };
    }

    static mapDF(idExterno, areaId, f, datosPorHoja) {
        const clienteNom = f.C ? f.C.toString().trim() : "";
        const nombreTrabajo = f.D ? f.D.toString().trim() : "S/N";
        const prioridadStr = f.E ? f.E.toString().toUpperCase() : "";
        const prioridad = prioridadStr.includes("URGENT") ? "Urgente" : "Normal";
        const material = f.H ? f.H.toString().trim() : "";

        // Fecha/hora de la planilla: columna A suele tener el timestamp de ingreso
        let fechaIngreso = null;
        const rawFecha = f.A || f.B || null;
        if (rawFecha) {
            const parsedFecha = new Date(rawFecha);
            if (!isNaN(parsedFecha.getTime()) && parsedFecha.getFullYear() > 2000) {
                fechaIngreso = parsedFecha.toISOString();
            }
        }

        let cantidadReal = parseFloat(f.J) || parseFloat(f.F) || 1;
        if (datosPorHoja && datosPorHoja["BASE"] && datosPorHoja["BASE"].B) {
            const baseCant = parseFloat(datosPorHoja["BASE"].B);
            if (!isNaN(baseCant) && baseCant > 0) cantidadReal = baseCant;
        }

        const colFiles = ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
        const colCopias = ['U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD'];
        const colMetros = ['AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP'];

        let itemsResult = [];
        const hojaBase = (datosPorHoja && datosPorHoja["BASE"]) ? datosPorHoja["BASE"] : f;

        for (let i = 0; i < 10; i++) {
            const fileUrl = hojaBase[colFiles[i]] ? hojaBase[colFiles[i]].toString().trim() : null;
            if (fileUrl && fileUrl.includes('http')) {
                const copias = parseFloat(hojaBase[colCopias[i]]) || 1;
                const metros = parseFloat(hojaBase[colMetros[i]]) || 0;
                itemsResult.push({ fileName: fileUrl, cantidad: metros > 0 ? metros : cantidadReal, copias });
            }
        }
        if (itemsResult.length === 0) itemsResult.push({ fileName: "Sin link", cantidad: cantidadReal, copias: 1 });

        const notasGenerales = f.P ? f.P.toString().trim() : "";
        cantidadReal = Math.round(cantidadReal * 100) / 100;

        return { idExterno, idServicioBase: areaId, nombreTrabajo, prioridad, notasGenerales, metrosTotales: cantidadReal, fechaIngreso, clienteInfo: { id: clienteNom, idReact: 0 }, archivosReferencia: [], archivosTecnicos: [], servicios: [{ areaId, esPrincipal: true, cabecera: { material, variante: "", metros: cantidadReal }, items: itemsResult, variablesEspeciales: {} }] };
    }

    static mapTPU(idExterno, areaId, f, matriz, datosPorHoja) {
        const clienteNom = f.C ? f.C.toString().trim() : "";
        const nombreTrabajo = f.D ? f.D.toString().trim() : "S/N";
        const material = f.E ? f.E.toString().trim() : "";
        const prioridadStr = f.F ? f.F.toString().toUpperCase() : "";

        let cantidadReal = parseFloat(f.F) || 1;
        
        const hojaBase = (datosPorHoja && datosPorHoja["BASE"]) ? datosPorHoja["BASE"] : f;
        
        let urls = [];
        const linkUrl = hojaBase['G'] ? hojaBase['G'].toString().trim() : null;
        if (linkUrl && linkUrl.includes('http')) {
            const copias = parseFloat(hojaBase['F']) || 1;
            urls.push({ fileName: linkUrl, cantidad: cantidadReal, copias: copias });
        } else {
            urls.push({ fileName: "Sin link", cantidad: cantidadReal, copias: 1 });
        }

        let linkSpot = "";
        let linkRefMatriz = "";
        
        const hojaMatriz = (datosPorHoja && datosPorHoja["MATRIZ"]) ? datosPorHoja["MATRIZ"] : null;
        if (hojaMatriz) {
            linkSpot = hojaMatriz.B ? hojaMatriz.B.toString().trim() : "";
            linkRefMatriz = hojaMatriz.C ? hojaMatriz.C.toString().trim() : "";
        } else if (matriz && Array.isArray(matriz)) {
            for (const m of matriz) {
                const normM = this._normalizeRow(m);
                if (normM.A && normM.A.toString().trim().toUpperCase() === idExterno.toUpperCase()) {
                    linkSpot = normM.B ? normM.B.toString().trim() : "";
                    linkRefMatriz = normM.C ? normM.C.toString().trim() : "";
                    break;
                }
            }
        }

        let refFiles = [];
        let localesRef = [];
        if (linkSpot && linkSpot.includes("http")) {
            refFiles.push({ nombre: linkSpot, url: linkSpot });
            localesRef.push({ url: linkSpot, nota: linkSpot, tipo: "SPOT-TPU" });
        }
        if (linkRefMatriz && linkRefMatriz.includes("http")) {
            refFiles.push({ nombre: linkRefMatriz, url: linkRefMatriz });
            localesRef.push({ url: linkRefMatriz, nota: linkRefMatriz, tipo: "MATRIZ-TPU" });
        }

        cantidadReal = Math.round(cantidadReal * 100) / 100;

        const serviciosArray = [{ 
            areaId, 
            esPrincipal: true, 
            cabecera: { material, variante: "TPU", metros: cantidadReal }, 
            items: urls,
            archivosReferenciaLocales: localesRef,
            variablesEspeciales: {} 
        }];

        serviciosArray.push({
            areaId: areaId,
            esPrincipal: false,
            isCobranzaExtra: true,
            cabecera: { material: "Matriz TPU", variante: "Matriz asignada automáticamente", metros: 1, codArticulo: "156", proIdProducto: 417, codStock: "1.1.10.1" },
            items: [{ fileName: "Matriz automática.dat", cantidad: 1, copias: 1 }],
            variablesEspeciales: { isMatriz: true }
        });
        
        return { idExterno, idServicioBase: areaId, nombreTrabajo, prioridad: "Normal", metrosTotales: cantidadReal, clienteInfo: { id: clienteNom, idReact: 0 }, archivosReferencia: refFiles, archivosTecnicos: [], servicios: serviciosArray };
    }

    // --- NUEVA FUNCIÓN ESPECÍFICA PARA IMD ---
    static mapIMD(idExterno, areaId, f, datosPorHoja) {
        const clienteNom = f.C ? f.C.toString().trim() : "";
        const nombreTrabajo = f.D ? f.D.toString().trim() : idExterno;
        const prioridadStr = f.E ? f.E.toString().toUpperCase() : "";
        const prioridad = prioridadStr.includes("URGENT") ? "Urgente" : "Normal";
        const material = (f.K || f.I || "").toString().trim();
        const variante = (f.H || "Impresión Directa").toString().trim();

        let cR = parseFloat(f.F) || parseFloat(f.B) || 1;
        if (datosPorHoja && datosPorHoja["BASE"] && datosPorHoja["BASE"].B) {
            const baseCant = parseFloat(datosPorHoja["BASE"].B);
            if (!isNaN(baseCant) && baseCant > 0) cR = baseCant;
        }
        
        const hojaBase = (datosPorHoja && datosPorHoja["BASE"]) ? datosPorHoja["BASE"] : f;
        
        let colFiles;
        if (datosPorHoja && datosPorHoja["BASE"] && !datosPorHoja["BASE INGRESO"]) {
            // BASE tab: files start at N (index 13)
            colFiles = ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'];
        } else {
            // BASE INGRESO tab or automatic sync: files start at L (index 11)
            colFiles = ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'];
        }
        const colCopias = ['X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG'];
        const colMetros = ['AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP', 'AQ'];

        let itemsResult = [];

        for (let i = 0; i < colFiles.length; i++) {
            const fileUrl = hojaBase[colFiles[i]] ? hojaBase[colFiles[i]].toString().trim() : null;
            if (fileUrl && fileUrl.includes('http')) {
                const copias = (i < colCopias.length && hojaBase[colCopias[i]]) ? parseFloat(hojaBase[colCopias[i]]) || 1 : 1;
                const metros = (i < colMetros.length && hojaBase[colMetros[i]]) ? parseFloat(hojaBase[colMetros[i]]) || 0 : 0;
                itemsResult.push({ fileName: fileUrl, cantidad: metros, copias });
            }
        }
        if (itemsResult.length === 0) itemsResult.push({ fileName: "Sin link", cantidad: cR, copias: 1 });

        cR = Math.round(cR * 100) / 100;

        const serviciosArray = [{
            areaId, esPrincipal: true, cabecera: { material, variante, metros: cR },
            items: itemsResult, variablesEspeciales: {}
        }];

        const textoServiciosExtra = (
            (f.G || "") + " " + 
            (f.I || "") + " " + 
            (f.AI || "") + " " + 
            (f.AJ || "") + " " + 
            (f.AK || "") + " " + 
            (f.AM || "")
        ).toUpperCase();

        let urlInfoCorte = "";
        let urlBocetoCorte = "";

        // Caso normal / On-demand: enlaces directos (que no contienen "$*")
        if (f.AL && typeof f.AL === 'string' && f.AL.includes('http') && !f.AL.includes('$*')) {
            urlInfoCorte = f.AL.toString().trim();
        } else if (datosPorHoja && datosPorHoja["BASE INGRESO"] && datosPorHoja["BASE INGRESO"].AL && !datosPorHoja["BASE INGRESO"].AL.includes('$*')) {
            urlInfoCorte = datosPorHoja["BASE INGRESO"].AL.toString().trim();
        }

        if (f.BH && typeof f.BH === 'string' && f.BH.includes('http') && !f.BH.includes('$*')) {
            urlBocetoCorte = f.BH.toString().trim();
        } else if (datosPorHoja && datosPorHoja["BASE INGRESO"] && datosPorHoja["BASE INGRESO"].BH && !datosPorHoja["BASE INGRESO"].BH.includes('$*')) {
            urlBocetoCorte = datosPorHoja["BASE INGRESO"].BH.toString().trim();
        }

        // Si tenemos un string QR con "$*" en cualquier columna (caso sincronización automática)
        let qrString = "";
        for (let key of Object.keys(f)) {
            if (f[key] && typeof f[key] === 'string' && f[key].includes('$*')) {
                qrString = f[key];
                break;
            }
        }

        if (qrString) {
            const parts = qrString.split('$*');
            if (parts[5] && parts[5].includes('http')) {
                urlInfoCorte = parts[5].trim();
            }
            if (parts[7] && parts[7].includes('http')) {
                urlBocetoCorte = parts[7].trim();
            }
        }
        
        let refFiles = [];
        let localesCorte = [];
        
        if (urlInfoCorte) {
            refFiles.push({ nombre: 'Archivo de Corte (AL)', url: urlInfoCorte, tipo: "ARCHIVO-PEDIDO" });
            localesCorte.push({ url: urlInfoCorte, nota: 'Archivo de Corte (AL)', tipo: "ARCHIVO-PEDIDO" });
        }
        if (urlBocetoCorte) {
            refFiles.push({ nombre: 'Archivo de Referencia (BH)', url: urlBocetoCorte, tipo: "BOCETO-CORTE" });
            localesCorte.push({ url: urlBocetoCorte, nota: 'Archivo de Referencia (BH)', tipo: "BOCETO-CORTE" });
        }

        // Extraer también Boceto (L) y Logo (M) como archivos de referencia generales para IMD
        const urlBocetoL = hojaBase.L ? hojaBase.L.toString().trim() : '';
        const urlLogoM = hojaBase.M ? hojaBase.M.toString().trim() : '';
        if (urlBocetoL && urlBocetoL.includes('http')) {
            refFiles.push({ nombre: 'Boceto (L)', url: urlBocetoL, tipo: "BOCETO" });
        }
        if (urlLogoM && urlLogoM.includes('http')) {
            refFiles.push({ nombre: 'Logo (M)', url: urlLogoM, tipo: "LOGO" });
        }

        const checkServiciosExtra = ((f.AI || "") + " " + (f.AJ || "") + " " + (f.AK || "") + " " + (f.AM || "")).toUpperCase();
        const obsUpper = ((f.G || "") + " " + (f.I || "")).toUpperCase();

        let tieneCorte = checkServiciosExtra.includes("CORTE");
        if (!tieneCorte && obsUpper.includes("CORTE")) {
            const falsosPositivos = ["HICIMOS YA", "YA HICIMOS", "YA TIENE", "YA VIENE", "SIN CORTE", "NO CORTE", "NO REQUIERE CORTE"];
            const esFalsoPositivo = falsosPositivos.some(fp => obsUpper.includes(fp));
            if (!esFalsoPositivo) tieneCorte = true;
        }

        let tieneCostura = checkServiciosExtra.includes("COSTURA");
        if (!tieneCostura && obsUpper.includes("COSTURA")) {
            const falsosPositivos = ["SIN COSTURA", "NO COSTURA", "NO REQUIERE COSTURA", "YA TIENE COSTURA"];
            const esFalsoPositivo = falsosPositivos.some(fp => obsUpper.includes(fp));
            if (!esFalsoPositivo) tieneCostura = true;
        }

        let tieneBordado = checkServiciosExtra.includes("BORDADO") || checkServiciosExtra.includes("EMB");
        if (!tieneBordado && (obsUpper.includes("BORDADO") || obsUpper.includes("EMB"))) {
            const falsosPositivos = ["SIN BORDADO", "NO BORDADO", "NO REQUIERE BORDADO", "YA TIENE BORDADO"];
            const esFalsoPositivo = falsosPositivos.some(fp => obsUpper.includes(fp));
            if (!esFalsoPositivo) tieneBordado = true;
        }

        if (tieneCorte) {
            serviciosArray.push({
                areaId: 'TWC', esPrincipal: false,
                cabecera: { material: "Corte Laser por prenda", variante: "Corte detectado Automáticamente", metros: 0, codArticulo: "1375", proIdProducto: 90, codStock: "1.1.6.1" },
                items: [], archivosReferenciaLocales: localesCorte
            });
        }
        
        if (tieneCostura) {
            serviciosArray.push({ areaId: 'TWT', esPrincipal: false, cabecera: { material: "Costura", variante: "Costura detectada Automáticamente", metros: 0, codArticulo: "115", proIdProducto: 36, codStock: "1.1.7.1" }, items: [] });
        }

        if (tieneBordado) {
            serviciosArray.push({ areaId: 'EMB', esPrincipal: false, cabecera: { material: "Bordado Estándar", variante: "Bordado detectado Automáticamente", metros: 0, codArticulo: "1567", proIdProducto: 434, codStock: "1.1.9.1" }, items: [] });
        }

        return { idExterno, idServicioBase: areaId, nombreTrabajo, prioridad, metrosTotales: cR, clienteInfo: { id: clienteNom, idReact: 0 }, archivosReferencia: refFiles, archivosTecnicos: [], servicios: serviciosArray };
    }

    // --- NUEVA FUNCIÓN ESPECÍFICA PARA SB (Sublimación) ---
    static mapSB(idExterno, areaId, f, datosPorHoja) {
        const clienteNom = f.C ? f.C.toString().trim() : "";
        const nombreTrabajo = f.D ? f.D.toString().trim() : idExterno;
        const prioridadStr = f.E ? f.E.toString().toUpperCase() : (f.F ? f.F.toString().toUpperCase() : "");
        const prioridad = prioridadStr.includes("URGENT") ? "Urgente" : "Normal";

        // Material en SB viene típicamente en la J o I, Variante en la H.
        const material = (f.J || f.I || "").toString().trim();
        const variante = (f.H || "").toString().trim();

        let cR = parseFloat(f.F) || parseFloat(f.B) || 1;
        
        // Si datosPorHoja tiene "BASE", la cantidad real está en la col B
        if (datosPorHoja && datosPorHoja["BASE"] && datosPorHoja["BASE"].B) {
            const baseCant = parseFloat(datosPorHoja["BASE"].B);
            if (!isNaN(baseCant) && baseCant > 0) {
                cR = baseCant;
            }
        }
        
        // Obtener la fila correspondiente a "BASE"
        const hojaBase = (datosPorHoja && datosPorHoja["BASE"]) ? datosPorHoja["BASE"] : f;

        let colFiles;
        if (datosPorHoja && datosPorHoja["BASE"] && !datosPorHoja["BASE INGRESO"]) {
            // BASE tab: files start at N (index 13)
            colFiles = ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'];
        } else {
            // BASE INGRESO tab or automatic sync: files start at L (index 11)
            colFiles = ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'];
        }
        const colCopias = ['X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG'];
        const colMetros = ['AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP', 'AQ'];

        let itemsResult = [];
        
        for (let i = 0; i < colFiles.length; i++) {
            const fileUrl = hojaBase[colFiles[i]] ? hojaBase[colFiles[i]].toString().trim() : null;
            if (fileUrl && fileUrl.includes('http')) {
                const copias = (i < colCopias.length && hojaBase[colCopias[i]]) ? parseFloat(hojaBase[colCopias[i]]) || 1 : 1;
                const metros = (i < colMetros.length && hojaBase[colMetros[i]]) ? parseFloat(hojaBase[colMetros[i]]) || 0 : 0;

                itemsResult.push({
                    fileName: fileUrl,
                    cantidad: metros,
                    copias: copias
                });
            }
        }

        // Fallback por si la URL está en otra columna impredecible
        if (itemsResult.length === 0) {
            for (let key of Object.keys(hojaBase)) {
                if (hojaBase[key] && typeof hojaBase[key] === 'string' && hojaBase[key].includes('http')) {
                    itemsResult.push({ fileName: hojaBase[key].toString().trim(), cantidad: cR, copias: 1 });
                }
            }
        }
        if (itemsResult.length === 0) itemsResult.push({ fileName: "Sin link", cantidad: cR, copias: 1 });

        cR = Math.round(cR * 100) / 100;

        const serviciosArray = [{
            areaId,
            esPrincipal: true,
            cabecera: { material, variante, metros: cR },
            items: itemsResult,
            variablesEspeciales: {}
        }];

        // LÓGICA DE SERVICIOS EXTRA (Corte, Costura, Bordado) 
        // El usuario indica que en Corte/Costura/Bordado u otras columnas (G, I, AI, AJ, AM) puede venir esta solicitud
        const textoServiciosExtra = (
            (f.G || "") + " " + 
            (f.I || "") + " " + 
            (f.AI || "") + " " + 
            (f.AJ || "") + " " + 
            (f.AK || "") + " " + 
            (f.AM || "")
        ).toUpperCase();

        let urlInfoCorte = "";
        let urlBocetoCorte = "";

        // Caso normal / On-demand: enlaces directos (que no contienen "$*")
        if (f.AL && typeof f.AL === 'string' && f.AL.includes('http') && !f.AL.includes('$*')) {
            urlInfoCorte = f.AL.toString().trim();
        } else if (datosPorHoja && datosPorHoja["BASE INGRESO"] && datosPorHoja["BASE INGRESO"].AL && !datosPorHoja["BASE INGRESO"].AL.includes('$*')) {
            urlInfoCorte = datosPorHoja["BASE INGRESO"].AL.toString().trim();
        }

        if (f.BH && typeof f.BH === 'string' && f.BH.includes('http') && !f.BH.includes('$*')) {
            urlBocetoCorte = f.BH.toString().trim();
        } else if (datosPorHoja && datosPorHoja["BASE INGRESO"] && datosPorHoja["BASE INGRESO"].BH && !datosPorHoja["BASE INGRESO"].BH.includes('$*')) {
            urlBocetoCorte = datosPorHoja["BASE INGRESO"].BH.toString().trim();
        }

        // Si tenemos un string QR con "$*" en cualquier columna (caso sincronización automática)
        let qrString = "";
        for (let key of Object.keys(f)) {
            if (f[key] && typeof f[key] === 'string' && f[key].includes('$*')) {
                qrString = f[key];
                break;
            }
        }

        if (qrString) {
            const parts = qrString.split('$*');
            if (parts[5] && parts[5].includes('http')) {
                urlInfoCorte = parts[5].trim();
            }
            if (parts[7] && parts[7].includes('http')) {
                urlBocetoCorte = parts[7].trim();
            }
        }

        let refFiles = [];
        let localesCorte = [];
        
        if (urlInfoCorte) {
            refFiles.push({ nombre: 'Archivo de Corte (AL)', url: urlInfoCorte, tipo: "ARCHIVO-PEDIDO" });
            localesCorte.push({ url: urlInfoCorte, nota: 'Archivo de Corte (AL)', tipo: "ARCHIVO-PEDIDO" });
        }
        if (urlBocetoCorte) {
            refFiles.push({ nombre: 'Archivo de Referencia (BH)', url: urlBocetoCorte, tipo: "BOCETO-CORTE" });
            localesCorte.push({ url: urlBocetoCorte, nota: 'Archivo de Referencia (BH)', tipo: "BOCETO-CORTE" });
        }

        const checkServiciosExtra = ((f.AI || "") + " " + (f.AJ || "") + " " + (f.AK || "") + " " + (f.AM || "")).toUpperCase();
        const obsUpper = ((f.G || "") + " " + (f.I || "")).toUpperCase();

        let tieneCorte = checkServiciosExtra.includes("CORTE");
        if (!tieneCorte && obsUpper.includes("CORTE")) {
            const falsosPositivos = ["HICIMOS YA", "YA HICIMOS", "YA TIENE", "YA VIENE", "SIN CORTE", "NO CORTE", "NO REQUIERE CORTE"];
            const esFalsoPositivo = falsosPositivos.some(fp => obsUpper.includes(fp));
            if (!esFalsoPositivo) tieneCorte = true;
        }

        let tieneCostura = checkServiciosExtra.includes("COSTURA");
        if (!tieneCostura && obsUpper.includes("COSTURA")) {
            const falsosPositivos = ["SIN COSTURA", "NO COSTURA", "NO REQUIERE COSTURA", "YA TIENE COSTURA"];
            const esFalsoPositivo = falsosPositivos.some(fp => obsUpper.includes(fp));
            if (!esFalsoPositivo) tieneCostura = true;
        }

        let tieneBordado = checkServiciosExtra.includes("BORDADO") || checkServiciosExtra.includes("EMB");
        if (!tieneBordado && (obsUpper.includes("BORDADO") || obsUpper.includes("EMB"))) {
            const falsosPositivos = ["SIN BORDADO", "NO BORDADO", "NO REQUIERE BORDADO", "YA TIENE BORDADO"];
            const esFalsoPositivo = falsosPositivos.some(fp => obsUpper.includes(fp));
            if (!esFalsoPositivo) tieneBordado = true;
        }

        if (tieneCorte) {
            serviciosArray.push({
                areaId: 'TWC', // Taller Web Corte / Corte Láser
                esPrincipal: false,
                cabecera: { 
                    material: "Corte Laser por prenda", 
                    variante: "Corte detectado Automáticamente", 
                    metros: 0, 
                    codArticulo: "1375",
                    proIdProducto: 90, 
                    codStock: "1.1.6.1" 
                },
                items: [],
                archivosReferenciaLocales: localesCorte
            });
        }
        
        if (tieneCostura) {
            serviciosArray.push({
                areaId: 'TWT', // Taller Web Costura
                esPrincipal: false,
                cabecera: { 
                    material: "Costura", 
                    variante: "Costura detectada Automáticamente", 
                    metros: 0, 
                    codArticulo: "115", 
                    proIdProducto: 36,
                    codStock: "1.1.7.1" 
                },
                items: []
            });
        }

        if (tieneBordado) {
            serviciosArray.push({
                areaId: 'EMB', // Bordado
                esPrincipal: false,
                cabecera: { 
                    material: "Bordado Estándar", 
                    variante: "Bordado detectado Automáticamente", 
                    metros: 0, 
                    codArticulo: "1567",
                    proIdProducto: 434,
                    codStock: "1.1.9.1"
                },
                items: []
            });
        }

        return {
            idExterno,
            idServicioBase: areaId,
            nombreTrabajo,
            prioridad,
            metrosTotales: cR,
            clienteInfo: { id: clienteNom, idReact: 0 },
            archivosReferencia: refFiles,
            archivosTecnicos: [],
            servicios: serviciosArray
        };
    }

    // --- NUEVA FUNCIÓN ESPECÍFICA PARA EMB (Bordados) ---
    static mapEMB(idExterno, areaId, f, datosPorHoja) {
        const clienteNom = f.D ? f.D.toString().trim() : "";
        const nombreTrabajo = f.E ? f.E.toString().trim() : idExterno;
        const prioridadStr = f.F ? f.F.toString().toUpperCase() : "";
        const prioridad = prioridadStr.includes("URGENT") ? "Urgente" : "Normal";

        const materialRaw = (f.W || "").toString().trim();
        const variante = (f.I || f.H || "").toString().trim();
        
        const matchPuntadas = materialRaw.match(/(\d+)\s*puntadas/i);
        const extractPuntadas = matchPuntadas ? parseInt(matchPuntadas[1], 10) : 0;
        
        const material = materialRaw || "Bordado Personalizado";

        let cR = parseFloat(f.J) || parseFloat(f.B) || 1;
        if (datosPorHoja && datosPorHoja["BASE"] && datosPorHoja["BASE"].J) {
            const baseCant = parseFloat(datosPorHoja["BASE"].J);
            if (!isNaN(baseCant) && baseCant > 0) cR = baseCant;
        }
        
        let refFiles = [];
        let localesRef = [];

        const hojaBase = (datosPorHoja && datosPorHoja["BASE"]) ? datosPorHoja["BASE"] : f;
        
        const logoBordado = hojaBase.F ? hojaBase.F.toString().trim() : "";
        const bocetoBordado = hojaBase.G ? hojaBase.G.toString().trim() : "";
        
        if (logoBordado && logoBordado.includes("http")) {
            refFiles.push({ nombre: logoBordado, url: logoBordado });
            localesRef.push({ url: logoBordado, nota: logoBordado, tipo: "LOGO-BORDADO" });
        }
        if (bocetoBordado && bocetoBordado.includes("http")) {
            refFiles.push({ nombre: bocetoBordado, url: bocetoBordado });
            localesRef.push({ url: bocetoBordado, nota: bocetoBordado, tipo: "BOCETO-BORDADO" });
        }

        const hojaMatriz = (datosPorHoja && datosPorHoja["MATRIZ"]) ? datosPorHoja["MATRIZ"] : null;
        if (hojaMatriz) {
            const archivoDst = hojaMatriz.B ? hojaMatriz.B.toString().trim() : "";
            const archivoBordado = hojaMatriz.C ? hojaMatriz.C.toString().trim() : "";
            if (archivoDst && archivoDst.includes("http")) {
                refFiles.push({ nombre: archivoDst, url: archivoDst });
                localesRef.push({ url: archivoDst, nota: archivoDst, tipo: "ARCHIVO-DST" });
            }
            if (archivoBordado && archivoBordado.includes("http")) {
                refFiles.push({ nombre: archivoBordado, url: archivoBordado });
                localesRef.push({ url: archivoBordado, nota: archivoBordado, tipo: "ARCHIVO-BORDADO" });
            }
        }

        cR = Math.round(cR * 100) / 100;

        const serviciosArray = [{
            areaId,
            esPrincipal: true,
            cabecera: { material, variante, metros: cR, codArticulo: extractPuntadas > 0 ? `EMB-BORD-${extractPuntadas}` : "EMB-BORD" },
            items: [{ fileName: "Sin impresión requerida", cantidad: cR, copias: 1 }],
            archivosReferenciaLocales: localesRef,
            variablesEspeciales: { puntadas: extractPuntadas }
        }];

        serviciosArray.push({
            areaId: areaId,
            esPrincipal: false,
            isCobranzaExtra: true,
            cabecera: { material: "Matriz Emblema", variante: "Matriz asignada automáticamente", metros: 1, codArticulo: "EMB-MATRIZ", proIdProducto: null, codStock: "1.1.X" },
            items: [{ fileName: "Matriz automática.dat", cantidad: 1, copias: 1 }],
            variablesEspeciales: { isMatriz: true }
        });

        return { idExterno, idServicioBase: areaId, nombreTrabajo, prioridad, metrosTotales: cR, clienteInfo: { id: clienteNom, idReact: 0 }, archivosReferencia: refFiles, archivosTecnicos: [], servicios: serviciosArray };
    }

    static mapGenerico(idExterno, areaId, f, datosPorHoja) {
        const clienteNom = f.C ? f.C.toString().trim() : "";
        const nombreTrabajo = f.D ? f.D.toString().trim() : idExterno;
        let cR = 1; 

        // Si datosPorHoja tiene "BASE", intentamos buscar la cantidad en B
        if (datosPorHoja && datosPorHoja["BASE"] && datosPorHoja["BASE"].B) {
            const baseCant = parseFloat(datosPorHoja["BASE"].B);
            if (!isNaN(baseCant) && baseCant > 0) cR = baseCant;
        }

        let material = "";
        let codArticulo = undefined;
        let proIdProducto = undefined;

        const areaUp = (areaId || '').toUpperCase();
        if (areaUp === 'TWC' || areaUp === 'CORTE') {
            material = 'Corte Laser por prenda'; codArticulo = '1375'; proIdProducto = 90;
        } else if (areaUp === 'TWT' || areaUp === 'COSTURA') {
            material = 'Costura'; codArticulo = '115'; proIdProducto = 36;
        } else if (areaUp === 'EMB' || areaUp === 'BORDADO' || areaUp === 'BORD') {
            material = 'Bordado'; codArticulo = '1567'; proIdProducto = 434;
        }

        const hojaBase = (datosPorHoja && datosPorHoja["BASE"]) ? datosPorHoja["BASE"] : f;
        let refFiles = [];
        let localesRef = [];

        // Archivos de referencia CORTE Y COSTURA
        const archivoPedido = hojaBase.V ? hojaBase.V.toString().trim() : "";
        const bocetoCorte = hojaBase.ALAL ? hojaBase.ALAL.toString().trim() : (hojaBase.AL ? hojaBase.AL.toString().trim() : "");
        
        if (archivoPedido && archivoPedido.includes("http")) {
            refFiles.push({ nombre: archivoPedido, url: archivoPedido });
            localesRef.push({ url: archivoPedido, nota: archivoPedido, tipo: "ARCHIVO-PEDIDO" });
        }
        if (bocetoCorte && bocetoCorte.includes("http")) {
            refFiles.push({ nombre: bocetoCorte, url: bocetoCorte });
            localesRef.push({ url: bocetoCorte, nota: bocetoCorte, tipo: "BOCETO-CORTE" });
        }

        cR = Math.round(cR * 100) / 100;

        return { 
            idExterno, idServicioBase: areaId, nombreTrabajo, prioridad: "Normal", metrosTotales: cR, 
            clienteInfo: { id: clienteNom, idReact: 0 }, archivosReferencia: refFiles, archivosTecnicos: [], 
            servicios: [{ 
                areaId, esPrincipal: true, 
                cabecera: { material, variante: "", metros: cR, codArticulo, proIdProducto }, 
                items: [{ fileName: "Sin impresión requerida", cantidad: cR, copias: 1 }], 
                archivosReferenciaLocales: localesRef,
                variablesEspeciales: {} 
            }] 
        };
    }
}

module.exports = SheetsRawMappingService;

module.exports = SheetsRawMappingService;
