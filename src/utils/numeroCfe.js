/**
 * Número OFICIAL del comprobante ante DGI.
 *
 * Es el que el cliente ve impreso en el PDF y por el que va a preguntar. NO es el
 * interno (DocSerie-DocNumero): la factura que internamente es la FA-332 es, para
 * DGI, la Serie A N° 27614. Son numeraciones distintas y no guardan relación.
 *
 * Devuelve null si el documento todavía no fue aceptado por DGI: hasta ese momento
 * no existe número oficial y hay que mostrar el interno.
 *
 * Formato que graba SISNET en CfeNumeroOficial:
 *     "Nro. de CAE 90262053670 Serie A 27503 / 29250"
 */
export const parsearNumeroOficialCfe = (doc) => {
    if (!doc || doc.CfeEstado !== 'ACEPTADO_DGI') return null;
    const texto = String(doc.CfeNumeroOficial || '').trim();
    if (!texto) return null;

    const m = texto.match(/Nro\.\s*de\s*CAE\s*(\d+)\s*Serie\s*([A-Za-z]+)\s*(\d+)/i);
    if (m) return { cae: m[1], serie: m[2].toUpperCase(), numero: m[3] };

    // Formato simple "A-27503", por si alguna emisión vieja quedó grabada así.
    const s = texto.match(/(?:Serie\s+)?([A-Za-z]+)\s*-\s*(\d+)/i);
    if (s) return { cae: null, serie: s[1].toUpperCase(), numero: s[2] };

    return null;
};

/**
 * Etiqueta lista para mostrar: el número de DGI si el documento ya está emitido,
 * y si no, el interno. Nunca devuelve vacío.
 */
export const etiquetaNumeroDocumento = (doc) => {
    const oficial = parsearNumeroOficialCfe(doc);
    if (oficial) return `Serie ${oficial.serie} N° ${oficial.numero}`;
    const interno = [doc?.DocSerie, doc?.DocNumero].filter(Boolean).join('-');
    return interno || `#${doc?.DocIdDocumento ?? ''}`;
};
