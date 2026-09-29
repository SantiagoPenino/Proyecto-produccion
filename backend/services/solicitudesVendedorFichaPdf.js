'use strict';
// =====================================================================
// FICHA DEL PEDIDO (PDF) — todo lo cargado en la Solicitud, organizado, en un solo PDF.
// =====================================================================
//   1. Encabezado: trabajo, cliente, vendedor, pedido(s), entrega.
//   2. Solicitud del cliente: identificación · pago y seña (informativo) · productos con sus
//      datos, servicios/extras y archivos del cliente (en miniatura).
//   3. Diseño: por producto y servicio — quién lo diseña, estado, fechas, indicaciones y el
//      diseño pronto (miniatura + medida, tela y copias).
//   4. Qué falta para producción (si falta algo) · interacciones con el cliente.
//
// Lo usan: el botón "Ficha del pedido (PDF)" del detalle, y la conversión a pedido, que lo
// adjunta SOLO a la orden PRO del pedido como referencia "FICHA_PEDIDO" (mismo camino que la
// subida manual de referencias: ordersController.uploadReferenceFile → Drive + ArchivosReferencia).
// Solo LEE la solicitud; si falla, la conversión no se entera (queda en el log).
// Mismo motor que el informe de producción: puppeteer (headless) sobre HTML armado acá.
// =====================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sql } = require('../config/db');
const logger = require('../utils/logger');

const NOMBRE_PARTE = { PRINCIPAL: 'Producción principal (sublimación)', BORDADO: 'Bordado', DTF: 'Estampado DTF', TPU: 'Estampado TPU' };
const ESTADO_PARTE = { INGRESADO: 'Ingresado (sin enviar a Diseño)', ENVIADO_DISENO: 'Enviado a Diseño', DISENO_INICIADO: 'Diseño iniciado', DISENADO: 'Diseñado' };
const TIPO_TRABAJO = { REVISAR: 'Revisar el arte del cliente', DESDE_CERO: 'Diseñar desde cero' };
const ROL_ARCHIVO = { ARTE_CLIENTE: 'Arte del cliente', REFERENCIA: 'Referencia', BOCETO: 'Boceto', PLANILLA: 'Planilla de talles y nombres', TIZADA: 'Tizada / molde', DISENO_PRONTO: 'Diseño pronto', COMPROBANTE: 'Comprobante de pago' };
const ESTADO_SOLICITUD = { INGRESADA: 'Ingresada', EN_DISENO: 'En diseño', PEDIDO_SOLICITADO: 'Pedido solicitado', CANCELADA: 'Cancelada' };
const MONEDA = { 1: '$', 2: 'US$' };

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const fechaHora = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : `${fecha(v)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const plata = (m, mon) => (m == null || m === '' ? '' : `${MONEDA[mon] || ''} ${Number(m).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim());
const si = (b) => (b ? 'Sí' : 'No');
// Las fechas de la base vienen como hora local guardada (se leen con getUTC*); "ahora" es la hora real del servidor.
const ahoraLocal = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const driveIdDe = (url) => { const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]{10,})|[?&]id=([a-zA-Z0-9_-]{10,})/); return m ? (m[1] || m[2]) : null; };

// Dato: solo si tiene valor (la ficha no muestra renglones vacíos)
const F = (l, v) => (v === null || v === undefined || v === '' || v === false ? '' : `<div class="f"><span>${esc(l)}</span><b>${esc(v)}</b></div>`);
const H2 = (t, sub) => `<h2>${esc(t)}${sub ? ` <small>${esc(sub)}</small>` : ''}</h2>`;
const H3 = (t, sub) => `<h3>${esc(t)}${sub ? ` <small>${esc(sub)}</small>` : ''}</h3>`;

function miniaturas(lista, conProduccion) {
  if (!lista.length) return '';
  return `<div class="minis">${lista.map(a => {
    const idDrive = driveIdDe(a.UrlDrive);
    const ext = (String(a.NombreOriginal || '').split('.').pop() || '').toUpperCase().slice(0, 4) || 'ARCH';
    const img = idDrive
      ? `<img src="https://drive.google.com/thumbnail?id=${idDrive}&sz=w400" onerror="this.outerHTML='<span class=ext>${esc(ext)}</span>'">`
      : `<span class="ext">${esc(ext)}</span>`;
    const extra = [
      ROL_ARCHIVO[a.Rol] || a.Rol,
      a.AnchoM && a.AltoM ? `${Number(a.AnchoM).toFixed(2)}×${Number(a.AltoM).toFixed(2)} m` : '',
      conProduccion && a.Material ? `Tela: ${a.Material}` : '',
      conProduccion && a.Copias ? `${a.Copias} copia${a.Copias === 1 ? '' : 's'}` : '',
      a.UsuarioNombre ? `subió ${a.UsuarioNombre}` : '',
      fechaHora(a.FechaSubida),
    ].filter(Boolean).join(' · ');
    return `<figure><div class="img">${img}</div><figcaption><b>${esc(a.NombreOriginal)}</b><br>${esc(extra)}</figcaption></figure>`;
  }).join('')}</div>`;
}

function datosProducto(p) {
  const d = p.Datos || {};
  const e = d.espec || {};
  const dis = d.diseno || {};
  const esCatalogo = p.TipoFabricacion === 'PRODUCTO_TERMINADO';
  return `<div class="grid">
    ${F('Modalidad', esCatalogo ? 'Producto del catálogo' : 'Producto del cliente')}
    ${F(esCatalogo ? 'Producto' : 'Referencia', esCatalogo ? (p.ProductoNombre || `Producto ${p.ProIdProducto}`) : d.referencia)}
    ${F('Familia / tipo de trabajo', d.tipoTrabajo)}
    ${F('Cantidad', `${p.Cantidad} unidades`)}
    ${F('Se produce a partir de', d.muestraFisica ? 'Muestra física' : 'Boceto digital')}
    ${F('Quién aporta el diseño', dis.origen === 'CLIENTE' ? `Lo entrega el cliente · archivo ${dis.verificado ? 'verificado' : 'SIN verificar'}` : dis.origen === 'TALLER' ? `Lo hace el taller · propuesta ${dis.aprobado ? 'aprobada por escrito' : 'SIN aprobar'}` : '')}
    ${F('Producto nuevo', d.productoNuevo ? 'Sí' : '')}
    ${F('Producción grande', d.produccionGrande ? 'Sí' : '')}
    ${F('Muestra', d.requiereMuestra ? `Requiere confección · ${d.muestraAprobada ? 'aprobada por el cliente' : 'SIN aprobar'}` : '')}
    ${F('Cómo se define', d.comoSeDefine === 'MEDIDA' ? 'Por medidas en cm' : 'Por talle')}
    ${d.comoSeDefine === 'MEDIDA' ? F('Medidas y cantidad por medida', d.medidas) + F('Terminación / costura', d.terminacion)
      : F('Talles', d.notaTalles) + F('Medidas de la prenda', d.medidasPrenda || (d.tablaEstandar ? 'Tabla estándar del taller, confirmada con el cliente' : ''))}
    ${d.personalizacion ? F('Nombres y números', d.listaCerrada ? 'Lista completa y cerrada' : 'LISTA SIN CERRAR') : ''}
    ${F('Corte', d.corte?.activo ? `${d.corte.tipoMolde || ''} · ${d.corte.origenTela || ''}` : 'No lleva')}
    ${F('Costura', d.costura?.activo ? (d.costura.instrucciones || 'Sin instrucciones especiales') : 'No lleva')}
    ${F('Pedido de producción', p.PedidoNoDocERP ? `${p.PedidoNoDocERP} · convertido el ${fechaHora(p.FechaConversion)}` : '')}
  </div>
  ${F('Observaciones del producto', p.Observaciones)}
  ${d.productoNuevo ? `<div class="caja"><div class="cap">Especificaciones técnicas (producto nuevo)</div><div class="grid">
    ${F('Costuras', e.costuras)}${F('Terminaciones', e.terminaciones)}${F('Avíos y accesorios', e.avios)}${F('Tela e insumos', e.tela)}${F('El material lo provee', e.provee === 'TALLER' ? 'El taller' : e.provee === 'CLIENTE' ? 'El cliente' : '')}
  </div></div>` : ''}`;
}

function servicio(pa) {
  const dd = pa.Datos || {};
  if (pa.Tipo === 'PRINCIPAL') return '';
  return `<tr>
    <td><b>${esc(NOMBRE_PARTE[pa.Tipo] || pa.Tipo)}</b>${pa.IncluidoEnProducto ? '<br><small>incluido en el producto</small>' : ''}</td>
    <td>${esc(pa.CantidadTotal ?? '')}${pa.PorPrenda != null ? ` · ${esc(pa.PorPrenda)} por prenda` : ''}</td>
    <td>${esc(pa.Ubicacion || '')}</td>
    <td>${esc([dd.variante, dd.material].filter(Boolean).join(' · '))}${dd.origenPrendas ? `<br><small>Prendas: ${esc(dd.origenPrendas)}</small>` : ''}</td>
    <td>${pa.ArteOrigen === 'CLIENTE' ? 'Viene listo del cliente' : 'Se diseña en la empresa'}</td>
  </tr>`;
}

// Piezas y telas de la sublimación (producto del catálogo con molde): modelo + tela y arte por pieza
function piezasTelas(p) {
  const sub = (p.Datos || {}).sublimacion;
  if (!sub || !sub.modeloClave) return '';
  return `${H3('Piezas y telas de la sublimación', `modelo ${sub.modeloNombre || sub.modeloClave}${sub.completo ? '' : ' · INCOMPLETO: faltan telas'}`)}
    <table><thead><tr><th>Pieza</th><th>Tela</th><th>Arte del cliente</th><th>Nota</th></tr></thead><tbody>
    ${(sub.piezas || []).map(z => `<tr>
      <td><b>${esc(z.generico || z.pieza)}</b>${z.generico && z.generico !== z.pieza ? `<br><small>${esc(z.pieza)}</small>` : ''}</td>
      <td>${z.telaNombre ? esc(z.telaNombre) + (z.fija ? '<br><small>fija del molde</small>' : '') : '<b class="rojo">SIN TELA</b>'}</td>
      <td>${esc(z.archivoNombre || 'Sin arte (lo diseña el taller)')}</td>
      <td>${esc(z.nota || '')}</td>
    </tr>`).join('')}
    </tbody></table>`;
}

// Ficha técnica del producto del catálogo (Configurar productos → Ficha de diseño): avíos, costuras, material, tallas, notas, dibujo
function fichaTecnica(p) {
  const f = p.FichaProducto;
  if (!f) return '';
  const { dibujoDataUri } = require('./solicitudesVendedorFichaProducto');
  const dib = dibujoDataUri(f.dibujoUrl);
  return `${H3('Ficha técnica del producto', 'del configurador · informativa para Diseño y producción')}
    <div class="grid">
      ${F('Referencia', f.ref)}${F('Marca', f.marca)}${F('Material', f.material)}${F('Tallas', f.tallas)}${F('Marcación', f.marcacion)}
    </div>
    ${dib ? `<figure style="margin:6px 0"><div class="img" style="max-width:260px"><img src="${dib}" alt="" style="max-width:100%;max-height:220px"></div><figcaption>Dibujo de la ficha</figcaption></figure>` : ''}
    ${f.avios.length ? `<table><thead><tr><th>Avío</th><th>Por prenda</th><th>Medida</th><th>Nota</th></tr></thead><tbody>${f.avios.map(a => `<tr><td><b>${esc(a.nombre)}</b></td><td>${esc(a.cantidad ?? '')} ${esc(a.unidad)}</td><td>${esc(a.medida || '')}</td><td>${esc(a.nota || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="nota">Sin avíos cargados en el configurador.</p>'}
    ${f.costuras.length ? `<table><thead><tr><th>Unión</th><th>Costura (ISO 4915)</th></tr></thead><tbody>${f.costuras.map(c => `<tr><td><b>${esc(c.union)}</b></td><td>${esc(c.codigoISO)}${c.nombre ? ' · ' + esc(c.nombre) : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="nota">Sin costuras cargadas en el configurador.</p>'}
    ${f.notas.length ? `<ul class="lista">${f.notas.map(n => `<li>${n.etiqueta ? '<b>' + esc(n.etiqueta) + ':</b> ' : ''}${esc(n.valor)}</li>`).join('')}</ul>` : ''}`;
}

function htmlFicha(s) {
  const f = s.Ficha || {};
  const vig = (s.Archivos || []).filter(a => a.Vigente);
  const pedidos = s.Productos.filter(p => p.PedidoNoDocERP).map(p => p.PedidoNoDocERP);
  const generales = vig.filter(a => !a.ProductoSolID && !a.ParteID && !a.EventoID && a.Rol !== 'COMPROBANTE');
  const comprobantes = vig.filter(a => a.Rol === 'COMPROBANTE');
  const interacciones = (s.Eventos || []).filter(e => e.Tipo === 'INTERACCION');

  const productos = s.Productos.map((p, i) => {
    const d = p.Datos || {};
    const nombre = p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (p.ProductoNombre || `Producto ${i + 1}`) : (d.referencia || d.tipoTrabajo || `Producto ${i + 1}`);
    const extras = p.Partes.filter(pa => pa.Tipo !== 'PRINCIPAL');
    const delCliente = vig.filter(a => (a.ProductoSolID === p.ProductoSolID && !a.ParteID) || (a.ParteID && p.Partes.some(pa => pa.ParteID === a.ParteID) && a.Rol !== 'DISENO_PRONTO'));
    return { p, nombre, extras, delCliente };
  });

  const seccionCliente = productos.map(({ p, nombre, extras, delCliente }, i) => `
    <section class="${i > 0 ? 'salto' : ''}">
      ${H2(`Producto ${i + 1}: ${nombre}`, `${p.Cantidad} unidades`)}
      ${datosProducto(p)}
      ${piezasTelas(p)}
      ${fichaTecnica(p)}
      ${extras.length ? `${H3('Servicios y extras')}<table><thead><tr><th>Servicio</th><th>Cantidad</th><th>Dónde va</th><th>Tipo / material</th><th>El arte</th></tr></thead><tbody>${extras.map(servicio).join('')}</tbody></table>` : `${H3('Servicios y extras')}<p class="nota">No lleva extras.</p>`}
      ${delCliente.length ? `${H3('Archivos del cliente', 'arte, bocetos, referencias y planillas')}${miniaturas(delCliente, false)}` : ''}
    </section>`).join('');

  const seccionDiseno = productos.map(({ p, nombre }) => `
    ${H3(nombre, `${p.Cantidad} unidades`)}
    ${p.Partes.map(pa => {
      const pronto = vig.filter(a => a.ParteID === pa.ParteID && a.Rol === 'DISENO_PRONTO');
      return `<div class="parte">
        <div class="parte-tit">${esc(NOMBRE_PARTE[pa.Tipo] || pa.Tipo)} <span class="pill">${esc(ESTADO_PARTE[pa.Estado] || pa.Estado)}</span>${pa.Modificada ? ' <span class="pill rojo">Modificada · falta aceptar</span>' : ''}</div>
        <div class="grid">
          ${F('Trabajo de Diseño', TIPO_TRABAJO[pa.TipoTrabajo] || '')}
          ${F('Diseñador', pa.DisenadorNombre)}
          ${F('Enviado a Diseño', fechaHora(pa.FechaEnvioDiseno))}
          ${F('Diseño iniciado', fechaHora(pa.FechaInicioDiseno))}
          ${F('Diseñado', fechaHora(pa.FechaDisenado))}
        </div>
        ${F('Indicaciones para Diseño', pa.Observaciones)}
        ${pronto.length ? miniaturas(pronto, true) : '<p class="nota">Todavía no hay diseño pronto.</p>'}
      </div>`;
    }).join('')}`).join('');

  const faltanPorProducto = productos.map(({ p, nombre }) => {
    const c = (s.Conversion || []).find(x => x.ProductoSolID === p.ProductoSolID);
    const faltan = c?.checklist && !c.checklist.listo ? c.checklist.faltan : [];
    return faltan.length ? `<div class="caja rojo"><div class="cap">${esc(nombre)}: falta para entrar a producción</div><ul>${faltan.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  }).join('');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ficha del pedido — Solicitud #${s.SolicitudID}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body { background: #fff; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5px; color: #16233F; margin: 0; }
  .top { display: flex; justify-content: space-between; gap: 12px; border-bottom: 3px solid #16233F; padding-bottom: 8px; margin-bottom: 6px; }
  .top .kicker { font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: #5B6780; }
  .top h1 { font-size: 22px; margin: 2px 0; }
  .top .der { text-align: right; }
  .top .ped { font-size: 15px; font-weight: 800; }
  .banda { background: #16233F; color: #F5C231; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; font-size: 11px; padding: 5px 8px; margin: 14px 0 6px; border-radius: 3px; }
  h2 { font-size: 14px; margin: 12px 0 4px; border-bottom: 1px solid #CDD4DF; padding-bottom: 2px; }
  h3 { font-size: 11.5px; margin: 10px 0 4px; }
  h2 small, h3 small { font-weight: 400; color: #5B6780; font-size: 10px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; }
  .f { display: flex; gap: 4px; line-height: 1.35; }
  .f span { color: #5B6780; white-space: nowrap; }
  .f span::after { content: ":"; }
  .f b { font-weight: 600; white-space: pre-line; }
  .caja { border: 1px solid #CDD4DF; border-radius: 4px; padding: 6px 8px; margin: 6px 0; }
  .caja.rojo { border-color: #C0262D; }
  .caja .cap { font-size: 9.5px; font-weight: 800; text-transform: uppercase; color: #5B6780; margin-bottom: 3px; }
  .caja.rojo .cap { color: #C0262D; }
  table { width: 100%; border-collapse: collapse; margin: 2px 0 4px; }
  th, td { border: 1px solid #CDD4DF; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #EDF0F4; font-size: 9.5px; }
  small { color: #5B6780; }
  .minis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 4px 0; }
  figure { margin: 0; border: 1px solid #CDD4DF; border-radius: 4px; padding: 3px; break-inside: avoid; }
  figure .img { height: 105px; display: flex; align-items: center; justify-content: center; background: #F6F8FB; overflow: hidden; }
  figure img { max-width: 100%; max-height: 105px; object-fit: contain; }
  .ext { font-size: 16px; font-weight: 800; color: #9AA6BE; }
  figcaption { font-size: 8px; line-height: 1.25; margin-top: 2px; word-break: break-all; }
  .parte { border-left: 3px solid #38BDF8; padding: 2px 0 2px 8px; margin: 6px 0; break-inside: avoid-page; }
  .parte-tit { font-weight: 800; font-size: 11px; margin-bottom: 2px; }
  .pill { display: inline-block; border: 1px solid #9AA6BE; border-radius: 9px; padding: 0 6px; font-size: 8.5px; font-weight: 700; color: #5B6780; }
  .pill.rojo { border-color: #C0262D; color: #C0262D; }
  b.rojo { color: #C0262D; }
  .nota { color: #5B6780; margin: 2px 0; }
  .salto { break-before: page; }
  ul { margin: 2px 0 0 16px; padding: 0; }
  .pie { margin-top: 14px; border-top: 1px solid #CDD4DF; padding-top: 3px; font-size: 8.5px; color: #9AA6BE; }
</style></head><body>
  <div class="top">
    <div>
      <div class="kicker">Ficha del pedido · Solicitud #${s.SolicitudID} · ${esc(ESTADO_SOLICITUD[s.Estado] || s.Estado)} · ingresada el ${fechaHora(s.FechaSolicitud)}</div>
      <h1>${esc(s.NombreTrabajo)}</h1>
      <div>${esc(s.ClienteNombre)}${s.ClienteFantasia ? ` (${esc(s.ClienteFantasia)})` : ''}${s.ClienteCodigo ? ` · ${esc(s.ClienteCodigo)}` : ''} · vendedor <b>${esc(s.VendedorNombre || '—')}</b></div>
    </div>
    <div class="der">
      ${pedidos.length ? `<div class="ped">Pedido ${esc(pedidos.join(', '))}</div>` : ''}
      <div>Entrega: <b>${s.FechaEntrega ? `${fecha(s.FechaEntrega)}${s.FechaEntregaHasta ? ` → ${fecha(s.FechaEntregaHasta)}` : ''}` : 'sin fecha'}</b></div>
    </div>
  </div>

  <div class="banda">Solicitud del cliente</div>
  ${H2('Identificación')}
  <div class="grid">
    ${F('Cliente', s.ClienteNombre)}${F('Vendedor', s.VendedorNombre)}
    ${F('Nombre del trabajo', s.NombreTrabajo)}${F('Presupuesto', s.PreNumero)}
    ${F('Fecha que necesita el cliente', fecha(s.FechaEntrega))}${F('Hasta', fecha(s.FechaEntregaHasta))}
    ${F('Dónde se cose', f.dondeSeCose === 'EXTERNO' ? `Taller externo${f.tallerExterno ? `: ${f.tallerExterno}` : ''}` : 'Nuestro taller')}
  </div>
  ${F('Qué pide el cliente', s.Detalle)}
  ${F('Observaciones generales', s.Observaciones)}
  ${F('Indicaciones del cliente', f.indicaciones)}
  ${F('Notas internas', f.notasInternas)}
  ${generales.length ? `${H3('Archivos generales de la solicitud')}${miniaturas(generales, false)}` : ''}

  ${H2('Pago y seña', 'informativo: no mueve la cuenta del cliente')}
  <div class="grid">
    ${F('Cómo se cobra', !s.ModoCobro ? 'Sin pactar' : s.ModoCobro === 'POR_AREA' ? 'Facturar por cada área' : 'Precio establecido (todo incluido)')}
    ${F('Total pactado', s.ModoCobro === 'PRECIO_ESTABLECIDO' ? plata(s.PrecioPactado, s.MonIdMoneda) : '')}
    ${F('Seña', !s.RequiereSena ? 'No se pide' : `Se pide ${plata(s.SenaMontoRequerido, s.MonIdMoneda)}`)}
    ${s.RequiereSena ? F('Pagó la seña', s.SenaConfirmada ? `Sí · ${plata(s.SenaMonto, s.MonIdMoneda)}` : 'Todavía no') : ''}
    ${s.SenaConfirmada ? F('Vía de entrada', s.SenaVia) + F('Referencia del pago', s.SenaReferencia) + F('Fecha de la transferencia', fecha(f.senaFecha)) + F('Registró', `${s.SenaConfirmadaPorNombre || ''} ${fechaHora(s.SenaFechaConfirma)}`.trim()) : ''}
    ${s.ModoCobro === 'PRECIO_ESTABLECIDO' && s.PrecioPactado ? F('Resta cobrar', plata(Number(s.PrecioPactado) - (s.SenaConfirmada ? Number(s.SenaMonto || 0) : 0), s.MonIdMoneda)) : ''}
  </div>
  ${comprobantes.length ? `${H3('Comprobante de pago')}${miniaturas(comprobantes, false)}` : ''}

  ${seccionCliente}

  <div class="banda salto">Diseño</div>
  ${seccionDiseno}

  ${faltanPorProducto ? `<div class="banda">Qué falta para producción</div>${faltanPorProducto}` : ''}

  ${interacciones.length ? `<div class="banda">Interacciones con el cliente</div><table><thead><tr><th style="width:120px">Fecha</th><th style="width:120px">Quién</th><th>Qué se habló</th></tr></thead><tbody>${interacciones.map(e => `<tr><td>${fechaHora(e.Fecha)}</td><td>${esc(e.UsuarioNombre || '')}</td><td style="white-space:pre-line">${esc(e.Texto || '')}</td></tr>`).join('')}</tbody></table>` : ''}

  <div class="pie">Generado el ${ahoraLocal()} · Ficha del pedido · Solicitud #${s.SolicitudID}</div>
</body></html>`;
}

/** Arma el PDF de la solicitud (Buffer). `sol` = lo que devuelve obtener(). */
async function generarPdf(sol) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    // networkidle0: espera las miniaturas de Drive. Tope 45 s: si Drive tarda, sale igual (con la extensión).
    await page.setContent(htmlFicha(sol), { waitUntil: 'networkidle0', timeout: 45000 }).catch(e => logger.warn(`[FICHA-PDF] miniaturas: ${e.message}`));
    // puppeteer ≥ 22 devuelve Uint8Array: a Express hay que darle un Buffer (si no, res.send lo serializa como JSON y el PDF no abre)
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' } }));
  } finally {
    await browser.close().catch(() => { });
  }
}

const nombreArchivo = (sol) => `Ficha pedido SOL-${sol.SolicitudID}.pdf`;

// Llama a un handler de Express en el mismo proceso (igual que pedidosExternos/procesador.js).
function invocar(handler, req) {
  return new Promise((resolve, reject) => {
    let status = 200; let listo = false;
    const fin = (body) => { if (!listo) { listo = true; resolve({ status, body }); } };
    const res = { status(c) { status = c; return res; }, json(b) { fin(b); return res; }, send(b) { fin(b); return res; }, setHeader() { return res; } };
    Promise.resolve(handler(req, res)).then(() => fin(null)).catch(reject);
  });
}

/**
 * Adjunta la ficha a la orden PRO del pedido (si no hay PRO, a la primera orden del pedido) como
 * referencia "FICHA_PEDIDO". Nunca lanza: si algo falla queda en el log y la conversión sigue.
 */
async function adjuntarAlPedido(pool, obtenerSol, solicitudId, noDocERP, user, app) {
  let tmp = null;
  try {
    // NoDocERP es nchar y hay filas no numéricas ('SB-64158', 'VEN-2332'): comparar con INT rompe la consulta
    const r = await pool.request().input('N', sql.VarChar(60), String(noDocERP)).query(`
      SELECT TOP 1 OrdenID, CodigoOrden FROM dbo.Ordenes
      WHERE LTRIM(RTRIM(NoDocERP)) = @N
      ORDER BY CASE WHEN LTRIM(RTRIM(AreaID)) = 'PRO' THEN 0 ELSE 1 END, OrdenID`);
    const orden = r.recordset[0];
    if (!orden) { logger.warn(`[FICHA-PDF] SOL-${solicitudId}: el pedido ${noDocERP} no tiene órdenes; no se adjuntó la ficha.`); return null; }
    const sol = await obtenerSol();
    const pdf = await generarPdf(sol);
    tmp = path.join(os.tmpdir(), `ficha-SOL-${solicitudId}-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, pdf);
    const { uploadReferenceFile } = require('../controllers/ordersController');
    const out = await invocar(uploadReferenceFile, {
      params: { ordenId: String(orden.OrdenID) },
      body: { tipo: 'FICHA_PEDIDO', nota: `Ficha del pedido generada desde la Solicitud #${solicitudId}` },
      file: { path: tmp, originalname: nombreArchivo(sol), mimetype: 'application/pdf', size: pdf.length },
      user: user || { id: 0, usuario: 'Sistema' }, headers: {}, app,
    });
    if (!out.body?.success) throw new Error(out.body?.error || `la subida respondió ${out.status}`);
    logger.info(`[FICHA-PDF] SOL-${solicitudId}: ficha adjuntada a ${orden.CodigoOrden} (pedido ${noDocERP}).`);
    return { ordenId: orden.OrdenID, codigoOrden: orden.CodigoOrden, url: out.body.url };
  } catch (e) {
    logger.warn(`[FICHA-PDF] SOL-${solicitudId}: no se pudo adjuntar la ficha al pedido ${noDocERP}: ${e.message}`);
    return null;
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (_) { /* ya lo borró la subida */ } }
  }
}

module.exports = { htmlFicha, generarPdf, nombreArchivo, adjuntarAlPedido };
