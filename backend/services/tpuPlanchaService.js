/**
 * [TPU] Imposición de la plancha: toma el arte de UN parche (PDF/AI con sus capas) y arma la
 * plancha con N copias en filas y columnas, más las marcas de registro, y exporta UN PDF POR CAPA.
 *
 * Es el port de `Script TPU 240726v2.jsx` (el que hoy se corre a mano en Illustrator). Los números
 * salen de ahí y están verificados contra `leones.plt`:
 *   · marcas de registro: círculos de 5 mm, a 5 mm de cada borde lateral, en CADA límite de fila
 *     (filas+1 pares), dibujadas SOLO en las capas CMYK y Corte
 *   · alto = altoArte×filas + espacioFilas×(filas+1) + diámetroRegistro + 2×margenRegistro
 *   · copias por fila = 1 + floor((anchoPlancha − anchoArte + tolerancia) / (anchoArte + separación))
 *   · la mesa final se recorta al contenido + 5 mm
 * Ver docs/tpu-cliente-sube-vectorizado-plan.md
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { PDFDocument, PDFName, PDFArray, rgb } = require('pdf-lib');
const ejecutar = promisify(execFile);

const PT_POR_MM = 2.83464567;
const DIAMETRO_REGISTRO_MM = 5;
const OFFSET_REGISTRO_MM = 5;      // separación lateral del borde al círculo
const MARGEN_REGISTRO_MM = 5;      // margen arriba y abajo
const MARGEN_EXTRA_MM = 5;         // margen de la mesa de trabajo final
const CAPAS_CON_REGISTRO = ['CMYK', 'Corte'];

const mm = (v) => v * PT_POR_MM;

/** Nombres de las capas OCG del PDF, en el orden en que están declaradas. */
async function leerCapas(rutaPdf) {
    const doc = await PDFDocument.load(fs.readFileSync(rutaPdf), { updateMetadata: false });
    const ocp = doc.catalog.lookup(PDFName.of('OCProperties'));
    if (!ocp) return [];
    const ocgs = ocp.lookup(PDFName.of('OCGs'));
    if (!ocgs) return [];
    const nombres = [];
    for (let i = 0; i < ocgs.size(); i++) {
        const g = ocgs.lookup(i);
        const nm = g?.lookup?.(PDFName.of('Name'));
        nombres.push(nm?.decodeText?.() ?? String(nm ?? ''));
    }
    return nombres;
}

/**
 * Deja UNA sola capa visible y aplana con Poppler (`pdftocairo -pdf`), que respeta la
 * visibilidad de las OCG. El resultado es un PDF plano, sin capas, con solo ese contenido.
 * Es el equivalente exacto a lo que hace el script prendiendo/apagando capas antes de exportar.
 */
async function aislarCapa(rutaPdf, nombreCapa, dirTmp) {
    const doc = await PDFDocument.load(fs.readFileSync(rutaPdf), { updateMetadata: false });
    const ocp = doc.catalog.lookup(PDFName.of('OCProperties'));
    if (!ocp) throw new Error('El PDF no tiene capas (OCProperties).');
    const ocgs = ocp.lookup(PDFName.of('OCGs'));
    const d = ocp.lookup(PDFName.of('D'));

    const apagadas = doc.context.obj([]);
    let encontrada = false;
    for (let i = 0; i < ocgs.size(); i++) {
        const ref = ocgs.get(i);
        const nombre = ocgs.lookup(i)?.lookup?.(PDFName.of('Name'))?.decodeText?.() ?? '';
        if (nombre === nombreCapa) { encontrada = true; continue; }
        apagadas.push(ref);
    }
    if (!encontrada) throw new Error(`No existe la capa "${nombreCapa}".`);

    // /OFF manda sobre /ON: alcanza con listar las demás.
    d.set(PDFName.of('OFF'), apagadas);
    d.set(PDFName.of('BaseState'), PDFName.of('ON'));

    const seguro = nombreCapa.replace(/[^\w.-]+/g, '_');
    const conFiltro = path.join(dirTmp, `filtro-${seguro}.pdf`);
    const aplanado = path.join(dirTmp, `capa-${seguro}.pdf`);
    fs.writeFileSync(conFiltro, await doc.save());
    await ejecutar('pdftocairo', ['-pdf', conFiltro, aplanado]);
    return aplanado;
}

/**
 * Caja REAL del arte (la tinta, no la mesa de trabajo). El equivalente al `geometricBounds` de
 * los elementos que recorre el script: la mesa suele ser mucho más grande que el parche —en el
 * arte de ejemplo la mesa mide 350×100 mm y el escudo bastante menos—, y medir la mesa hacía
 * entrar una sola copia por fila.
 *
 * Se mide sobre la geometría de TODAS las capas juntas. Es exacto para arte vectorial, que es
 * justamente lo que exige este flujo (el vector del cliente se valida antes; ver F1 del plan).
 */
async function medirArte(rutaPdf, capas) {
    const { extraerContornosDeCapa } = require('./tpuPltService');
    const pdfjs = await import(
        require('url').pathToFileURL(
            path.join(require.resolve('pdfjs-dist/package.json'), '..', 'legacy', 'build', 'pdf.mjs')
        ).href
    );
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const capa of capas) {
        const { contornos } = await extraerContornosDeCapa(pdfjs, rutaPdf, capa, fs);
        for (const c of contornos) for (const [x, y] of c) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    }
    if (!isFinite(x0)) throw new Error('No se pudo medir el arte: no se encontró geometría vectorial.');
    return { x0, y0, x1, y1, ancho: x1 - x0, alto: y1 - y0 };
}

/**
 * Genera la plancha.
 * @param {string} rutaArte  PDF/AI del parche con sus capas
 * @param {object} opts
 *   anchoPlanchaCm (default 30, rango 20-50) · filas (5) · copias (auto si no se pasa)
 *   espacioMm (0) · espacioFilasMm (5) · dirSalida
 * @returns {Promise<{archivos: {capa:string, ruta:string}[], plancha:{anchoMm,altoMm}, copias, filas, total}>}
 */
async function generarPlancha(rutaArte, opts = {}) {
    const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpu-plancha-'));
    const dirSalida = opts.dirSalida || dirTmp;
    fs.mkdirSync(dirSalida, { recursive: true });

    const capas = await leerCapas(rutaArte);
    if (!capas.length) throw new Error('El arte no tiene capas nombradas (CMYK / Corte / Spot…).');

    const anchoPlanchaCm = Math.min(50, Math.max(20, opts.anchoPlanchaCm ?? 30));
    const anchoPlancha = mm(anchoPlanchaCm * 10);
    const espacio = mm(opts.espacioMm ?? 0);
    const espacioFilas = mm(opts.espacioFilasMm ?? 5);
    const filas = Math.min(20, Math.max(1, opts.filas ?? 5));

    const caja = await medirArte(rutaArte, capas);
    const anchoArte = caja.ancho, altoArte = caja.alto;
    if (anchoArte > anchoPlancha + 0.01) throw new Error('El arte es más ancho que la plancha.');

    // Mismo cálculo que el script (0.5 pt de tolerancia).
    const paso = anchoArte + espacio;
    const maxCopias = paso > 0 ? 1 + Math.floor((anchoPlancha - anchoArte + 0.5) / paso) : 1;
    const copias = Math.min(Math.max(1, opts.copias ?? maxCopias), maxCopias);

    const diamReg = mm(DIAMETRO_REGISTRO_MM);
    const altoPlancha = (altoArte * filas) + (espacioFilas * (filas + 1)) + diamReg + (2 * mm(MARGEN_REGISTRO_MM));

    const anchoOcupado = anchoArte + paso * (copias - 1);
    const inicioX = (anchoPlancha - anchoOcupado) / 2;
    const pasoFila = altoArte + espacioFilas;

    // Y de la primera fila (desde abajo). El script centra el bloque y va restando hacia abajo;
    // acá se arma desde arriba con la misma geometría.
    const yPrimeraFila = altoPlancha - mm(MARGEN_REGISTRO_MM) - (diamReg / 2) - (espacioFilas / 2) - altoArte;

    // Extensión real del contenido de la plancha: los parches más las marcas de registro, que
    // sobresalen a los costados y arriba/abajo de la primera y última fila.
    const radioReg = diamReg / 2;
    const yMarcaAlta = yPrimeraFila + altoArte + (espacioFilas / 2);
    const yMarcaBaja = yMarcaAlta - (pasoFila * filas);
    const contX0 = Math.min(inicioX, mm(OFFSET_REGISTRO_MM));
    const contX1 = Math.max(inicioX + anchoOcupado, anchoPlancha - mm(OFFSET_REGISTRO_MM));
    const contY0 = Math.min(yPrimeraFila - (pasoFila * (filas - 1)), yMarcaBaja - radioReg);
    const contY1 = Math.max(yPrimeraFila + altoArte, yMarcaAlta + radioReg);
    const recorte = {
        x: contX0,
        y: contY0 - mm(MARGEN_EXTRA_MM),
        ancho: contX1 - contX0,
        alto: (contY1 - contY0) + 2 * mm(MARGEN_EXTRA_MM),
    };

    const archivos = [];
    for (const capa of capas) {
        const planoCapa = await aislarCapa(rutaArte, capa, dirTmp);
        const salida = await PDFDocument.create();
        const pagina = salida.addPage([anchoPlancha, altoPlancha]);
        // Se incrusta RECORTADO a la caja de tinta: así el parche queda pegado al borde de su
        // celda y las copias no arrastran el vacío de la mesa de trabajo original.
        const origen = await PDFDocument.load(fs.readFileSync(planoCapa), { updateMetadata: false });
        const incrustada = await salida.embedPage(origen.getPage(0), {
            left: caja.x0, bottom: caja.y0, right: caja.x1, top: caja.y1,
        });

        for (let f = 0; f < filas; f++) {
            const y = yPrimeraFila - (pasoFila * f);
            for (let c = 0; c < copias; c++) {
                pagina.drawPage(incrustada, { x: inicioX + paso * c, y, width: anchoArte, height: altoArte });
            }
        }

        // Marcas de registro: solo en CMYK y Corte, en cada límite de fila (filas+1).
        if (CAPAS_CON_REGISTRO.includes(capa)) {
            const radio = diamReg / 2;
            const xIzq = mm(OFFSET_REGISTRO_MM) + radio;
            const xDer = anchoPlancha - mm(OFFSET_REGISTRO_MM) - radio;
            for (let k = 0; k <= filas; k++) {
                const y = yPrimeraFila + altoArte + (espacioFilas / 2) - (pasoFila * k);
                for (const x of [xIzq, xDer]) {
                    pagina.drawCircle({ x, y, size: radio, color: rgb(0, 0, 0), borderWidth: 0 });
                }
            }
        }

        // Recorte final de la mesa, igual que el script:
        //   artboardRect = [minX, maxY + margenExtra, maxX, minY - margenExtra]
        // horizontal EXACTO al contenido, vertical con 5 mm arriba y abajo. El contenido de todas
        // las capas es el mismo bloque de parches, así que el recorte se calcula una vez y se
        // aplica igual a las cinco — si cada capa se recortara a SU propia tinta, las capas
        // dejarían de calzar entre sí al superponerlas en la impresora.
        pagina.setMediaBox(recorte.x, recorte.y, recorte.ancho, recorte.alto);
        pagina.setCropBox(recorte.x, recorte.y, recorte.ancho, recorte.alto);

        const nombre = `${capa.replace(/[^\w.() -]+/g, '_')}.pdf`;
        const ruta = path.join(dirSalida, nombre);
        fs.writeFileSync(ruta, await salida.save());
        archivos.push({ capa, ruta });
    }

    // Archivo de corte (.plt) a partir de la capa Corte ya impuesta: reemplaza el paso manual
    // de abrir el PDF en Corel para exportarlo. Best-effort — si algo falla, la plancha ya está
    // generada y no tiene por qué caerse toda la operación por el corte.
    let plt = null;
    const capaCorte = archivos.find(a => /corte/i.test(a.capa));
    if (capaCorte) {
        try {
            const { generarPltDesdePlancha } = require('./tpuPltService');
            const r = await generarPltDesdePlancha(capaCorte.ruta, { capaCorte: null });
            plt = path.join(dirSalida, 'Corte.plt');
            fs.writeFileSync(plt, r.plt, 'latin1');
        } catch (e) {
            plt = null;
            console.warn('[TPU-plancha] no se pudo generar el .plt: ' + e.message);
        }
    }

    return {
        archivos, plt,
        plancha: { anchoMm: anchoPlancha / PT_POR_MM, altoMm: altoPlancha / PT_POR_MM },
        recorteMm: { ancho: recorte.ancho / PT_POR_MM, alto: recorte.alto / PT_POR_MM },
        arte: { anchoMm: anchoArte / PT_POR_MM, altoMm: altoArte / PT_POR_MM },
        copias, filas, total: copias * filas, maxCopias, dirSalida,
    };
}

module.exports = { generarPlancha, leerCapas, aislarCapa, PT_POR_MM, DIAMETRO_REGISTRO_MM };
