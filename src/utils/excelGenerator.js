/**
 * excelGenerator.js
 * Utilidades para exportar datos contables a archivos Excel (.xlsx).
 * Usa la librería `xlsx` ya instalada en el proyecto.
 */

const fmtNum = (n) =>
  new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

const fmtFecha = (dateString) => {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('es-UY', { timeZone: 'UTC' });
};

const TIPOS_MONETARIOS = ['USD', 'UYU', 'ARS', 'EUR', 'PYG', 'BRL', 'CORRIENTE', 'CREDITO', 'DEBITO', 'CAJA', 'DINERO_USD', 'DINERO_UYU'];
const ETIQUETA_TIPO = {
  ORDEN: 'Orden',
  ORDEN_ANTICIPO: 'Anticipo',
  PAGO: 'Pago',
  VTA_CAJA: 'Vta.Caja',
  AJUSTE: 'Ajuste',
  CREDITO: 'Crédito',
  DEBITO: 'Débito',
  ENTREGA: 'Entrega',
};

/**
 * Aplica estilos básicos al encabezado de una celda.
 * @param {object} ws  - hoja de cálculo
 * @param {string} cellRef - referencia de celda, ej: 'A1'
 * @param {boolean} isHeader - si es cabecera de tabla
 * @param {string} bgRGB - color hex de fondo sin #, ej 'C7D9F5'
 */
function styleCell(ws, cellRef, { bgRGB, bold, halign, color } = {}) {
  if (!ws[cellRef]) return;
  ws[cellRef].s = {
    font: { bold: !!bold, color: color ? { rgb: color } : undefined },
    fill: bgRGB ? { fgColor: { rgb: bgRGB }, patternType: 'solid' } : undefined,
    alignment: { horizontal: halign || 'left', wrapText: false },
    border: {
      top: { style: 'thin', color: { rgb: 'D1D5DB' } },
      bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
      left: { style: 'thin', color: { rgb: 'D1D5DB' } },
      right: { style: 'thin', color: { rgb: 'D1D5DB' } },
    },
  };
}

/**
 * Convierte un array de arrays en una hoja de cálculo xlsx y aplica anchos de columna.
 */
function aoa_to_sheet_with_widths(XLSX, data, colWidths) {
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = colWidths.map(w => ({ wch: w }));
  return ws;
}

/**
 * Exporta el Estado de Cuenta de un cliente a un archivo Excel con múltiples pestañas.
 *
 * @param {object} cliente   - objeto cliente { Nombre, NombreFantasia, CliIdCliente, CodCliente }
 * @param {Array}  cuentas   - array de cuentas del cliente
 * @param {object} secciones - mapa { CueIdCuenta: { cue, movs, saldoArrastre } }
 * @param {Array}  planes    - array de planes de recursos
 * @param {string} desde     - fecha inicio filtro (ISO string)
 * @param {string} hasta     - fecha fin filtro (ISO string)
 */
export const exportarExcelEstadoCuenta = async (cliente, cuentas, secciones, planes, desde, hasta) => {
  const XLSX = await import('xlsx');

  const wb = XLSX.utils.book_new();

  const fmtFiltroFecha = (str) => {
    if (!str) return '—';
    const parts = str.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return str;
  };

  const periodoStr = (desde && hasta)
    ? `${fmtFiltroFecha(desde)} al ${fmtFiltroFecha(hasta)}`
    : 'Período completo';

  const generadoStr = `${new Date().toLocaleDateString('es-UY')} ${new Date().toLocaleTimeString('es-UY')}`;

  // ── Pestaña 1: RESUMEN ────────────────────────────────────────────────────
  const resumenData = [
    ['ESTADO DE CUENTA'],
    [`Cliente: ${cliente.Nombre || 'Cliente Consumidor'}`],
    cliente.NombreFantasia ? [`Nombre Fantasía: ${cliente.NombreFantasia}`] : null,
    [`ID: ${cliente.CliIdCliente} | RUT/CI: ${cliente.CodCliente || '-'}`],
    [`Período: ${periodoStr}`],
    [`Generado: ${generadoStr}`],
    [],
    ['Cuenta', 'Tipo', 'Saldo Actual', 'Condición', 'Moneda'],
  ].filter(Boolean);

  cuentas.forEach(c => {
    const saldo = Number(c.CueSaldoActual ?? 0);
    const esRecurso = c.ProIdProducto != null || !TIPOS_MONETARIOS.includes(c.CueTipo?.toUpperCase());
    const saldoStr = esRecurso
      ? `${fmtNum(saldo)} ${c.UniSimbolo || c.UnidadLabel || ''}`
      : `${c.MonSimbolo || '$'} ${fmtNum(saldo)}`;
    const sufijo = !esRecurso ? (saldo > 0 ? ' (Saldo a favor)' : saldo < 0 ? ' (Deuda)' : '') : '';
    resumenData.push([
      c.NombreArticulo ? `${c.UnidadLabel || c.CueTipo} — ${c.NombreArticulo}` : (c.UnidadLabel || c.CueTipo),
      c.CueTipo,
      `${saldoStr}${sufijo}`,
      c.CondicionPago || (esRecurso ? 'Plan' : 'Contado'),
      c.MonSimbolo || (esRecurso ? (c.UniSimbolo || '') : '$'),
    ]);
  });

  const wsResumen = aoa_to_sheet_with_widths(XLSX, resumenData, [40, 18, 28, 14, 10]);

  // Estilos cabecera Resumen
  styleCell(wsResumen, 'A1', { bold: true, bgRGB: '1E3A5F', color: 'FFFFFF', halign: 'left' });

  const headerRowIdx = resumenData.findIndex(r => r && r[0] === 'Cuenta') + 1;
  ['A', 'B', 'C', 'D', 'E'].forEach(col => {
    styleCell(wsResumen, `${col}${headerRowIdx}`, { bold: true, bgRGB: '1E3A5F', color: 'FFFFFF', halign: 'center' });
  });

  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  // ── Pestañas por Cuenta ───────────────────────────────────────────────────
  cuentas.forEach(c => {
    const sec = secciones[c.CueIdCuenta];
    if (!sec) return;

    const rawMovs = sec.movs || [];
    const movs = rawMovs.filter(m => m.visualIsVisible !== false);
    const arrastre = Number(sec.saldoArrastre ?? 0);
    const esRecurso = c.ProIdProducto != null || !TIPOS_MONETARIOS.includes(c.CueTipo?.toUpperCase());
    const unidadLabel = c.UniSimbolo || c.UnidadLabel || c.CueTipo || '';
    const simbolo = esRecurso ? unidadLabel : (c.MonSimbolo || '$');
    const saldo = Number(c.CueSaldoActual ?? 0);

    const cuentaLabel = c.NombreArticulo
      ? `${c.UnidadLabel || c.CueTipo} — ${c.NombreArticulo}`
      : (c.UnidadLabel || c.CueTipo);

    const suffix = !esRecurso
      ? (saldo > 0 ? ' (Saldo a favor)' : saldo < 0 ? ' (Deuda)' : '')
      : '';

    const sheetData = [
      [`Cuenta: ${cuentaLabel}`],
      [`Saldo Actual: ${simbolo} ${fmtNum(saldo)}${suffix}`],
      [`Período: ${periodoStr}`],
      [],
    ];

    // Fila de arrastre
    if (arrastre !== 0) {
      sheetData.push([`Saldo arrastrado al inicio del período: ${simbolo} ${fmtNum(arrastre)}`]);
      sheetData.push([]);
    }

    // Cabecera de tabla de movimientos
    sheetData.push(['Fecha', 'Tipo', 'Documento', 'Concepto', 'Saldo Inicial', 'Debe', 'Haber', 'Saldo Final']);

    const movsAsc = [...movs].reverse();
    let runningSaldo = arrastre;

    movsAsc.forEach(m => {
      const importe = m.visualImporte !== undefined ? Number(m.visualImporte) : Number(m.MovImporte);
      const debeVal = importe < 0 ? Math.abs(importe) : 0;
      const haberVal = importe > 0 ? importe : 0;
      const saldoAntes = runningSaldo;
      runningSaldo += importe;

      const DOC_TIPO_LABEL = {
        '07': 'E-TICKET', '08': 'E-TICKET CRED.', '10': 'N.CRÉDITO ET',
        '01': 'E-FACTURA', '02': 'E-FACTURA CRED.', '04': 'N.CRÉDITO EF',
        '107': 'E-TICKET', '101': 'E-FACTURA', 'PedidoCaja': 'PEDIDO CAJA',
      };
      const dTipoLabel = m.DocTipo ? (DOC_TIPO_LABEL[m.DocTipo.trim()] || m.DocTipo.trim()) : null;
      const docFull = dTipoLabel
        ? `${dTipoLabel} ${m.DocSerie || ''}-${m.DocNumero || ''}`
        : (m.CodigoOrdenStr || m.OrdCodigoOrden || (m.OReIdOrdenRetiro ? `RET: ${m.OReIdOrdenRetiro}` : '—'));

      sheetData.push([
        fmtFecha(m.MovFecha),
        ETIQUETA_TIPO[m.MovTipo] || m.MovTipo,
        docFull,
        m.MovConcepto || '—',
        fmtNum(saldoAntes),
        debeVal > 0 ? fmtNum(debeVal) : '—',
        haberVal > 0 ? fmtNum(haberVal) : '—',
        fmtNum(runningSaldo),
      ]);
    });

    // Si no hay movimientos
    if (movs.length === 0) {
      sheetData.push(['Sin movimientos en el período seleccionado.', '', '', '', '', '', '', '']);
    }

    // Órdenes pendientes de facturar (solo cuentas monetarias)
    const ordenesPendientes = rawMovs.filter(m =>
      (m.MovTipo === 'ORDEN' || m.MovTipo === 'ORDEN_ANTICIPO') &&
      !m.MovAnulado &&
      !m.DocIdDocumento &&
      !(m.MovObservaciones && m.MovObservaciones.startsWith('CUBIERTO'))
    );

    if (ordenesPendientes.length > 0 && !esRecurso) {
      sheetData.push([]);
      sheetData.push([`Detalle de Órdenes Pendientes de Facturar (${ordenesPendientes.length})`]);
      sheetData.push(['Fecha', 'Orden', 'Trabajo / Descripción', 'Importe']);

      let totalPendiente = 0;
      ordenesPendientes.forEach(o => {
        const imp = Math.abs(Number(o.MovImporte));
        totalPendiente += imp;
        sheetData.push([
          fmtFecha(o.MovFecha),
          o.OrdCodigoOrden || o.MovConcepto || `Mov #${o.MovIdMovimiento}`,
          o.OrdNombreTrabajo || '—',
          `${simbolo} ${fmtNum(imp)}`,
        ]);
      });

      sheetData.push(['', '', 'TOTAL PENDIENTE A FACTURAR', `${simbolo} ${fmtNum(totalPendiente)}`]);
    }

    // Crear hoja con anchos de columna
    const ws = aoa_to_sheet_with_widths(XLSX, sheetData, [14, 16, 28, 38, 16, 14, 14, 16]);

    // Estilos de cabecera
    const movHeaderRow = sheetData.findIndex(r => r && r[0] === 'Fecha' && r[1] === 'Tipo');
    if (movHeaderRow >= 0) {
      const rowNum = movHeaderRow + 1;
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => {
        styleCell(ws, `${col}${rowNum}`, { bold: true, bgRGB: '1E3A5F', color: 'FFFFFF', halign: 'center' });
      });
    }

    const pendHeader = sheetData.findIndex(r => r && r[0] === 'Fecha' && r[2] === 'Trabajo / Descripción');
    if (pendHeader >= 0) {
      const rowNum = pendHeader + 1;
      ['A', 'B', 'C', 'D'].forEach(col => {
        styleCell(ws, `${col}${rowNum}`, { bold: true, bgRGB: 'D97706', color: 'FFFFFF', halign: 'center' });
      });
    }

    // Nombre de pestaña (máx 31 caracteres, sin caracteres especiales xlsx)
    const rawName = (c.UnidadLabel || c.CueTipo || `Cuenta ${c.CueIdCuenta}`)
      .replace(/[\\/*?:[\]]/g, '_')
      .slice(0, 31);

    XLSX.utils.book_append_sheet(wb, ws, rawName);
  });

  // Nombre del archivo
  const nombreCliente = (cliente.Nombre || 'Cliente').replace(/\s+/g, '_').slice(0, 30);
  const filename = `EstadoCuenta_${nombreCliente}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  XLSX.writeFile(wb, filename);
};
