'use strict';
// Traductor: pedido en términos de negocio → el MISMO body que /ventas/pedido-prenda le manda a
// POST /api/prendas-orders/create. Función pura (sin base, sin red): se puede probar comparando
// su salida contra un body real copiado de la pestaña Red del navegador.
//
// Cada bloque dice de qué líneas de src/client-portal/modulos/PrendaOrderForm.jsx (handleSubmit)
// se copió. Si el formulario cambia ahí, hay que cambiar acá.
//
// Alcance: "Fabricar prendas a la medida" con producción principal Sublimación.

const VARIANTE_PRO = {                       // PrendaOrderForm.jsx:116
  FABRICA_TERMINADO: 'FABRICA PRODUCTO TERMINADO',
  FABRICA_PERSONALIZADO: 'FABRICA PRODUCTO PERSONALIZADO',
};

// Cada archivo viaja con una clave única: el creador de pedidos la devuelve en el manifiesto de
// subida y con ella se sabe qué archivo del origen va en cada lugar. Dos archivos distintos con el
// mismo nombre se renombran ("(2) logo.pdf") porque las referencias se cruzan SOLO por nombre.
function registroDeArchivos() {
  const porClave = {};
  const nombresUsados = new Map();   // nombre en minúsculas → clave
  const usar = (a) => {
    const clave = String(a.id ?? a.url);
    if (porClave[clave]) return porClave[clave];
    let nombre = String(a.nombre).trim();
    let n = 1;
    while (nombresUsados.has(nombre.toLowerCase())) { n += 1; nombre = `(${n}) ${String(a.nombre).trim()}`; }
    nombresUsados.set(nombre.toLowerCase(), clave);
    porClave[clave] = { fileKey: clave, name: nombre, url: a.url };
    return porClave[clave];
  };
  return { usar, lista: () => Object.values(porClave) };
}

function traducir(pedido) {
  const reg = registroDeArchivos();
  const prod = pedido.producto;
  const cantidadPrendas = parseFloat(prod.cantidad) || 1;
  const corte = pedido.corte || null;
  const bocetos = pedido.bocetos || [];
  const planillas = pedido.planillas || [];
  const referencias = pedido.archivosReferencia || [];
  const servicios = pedido.servicios || [];
  const listaServicios = [];
  // Tela del cliente (jsx:2331): bobina elegida + corte con origen TELA CLIENTE y molde que no sea SUBLIMACION
  const usaTelaCliente = !!(corte && corte.bobinaId && String(corte.origenTela || '').toUpperCase() === 'TELA CLIENTE' && corte.tipoMolde !== 'SUBLIMACION');

  // ── A) Producción principal: un grupo por MATERIAL|VARIANTE = una orden (jsx:1671-1746, 1797-1897)
  const grupos = {};
  pedido.impresion.items.forEach((it) => {
    const key = `${it.material.nombre}| ${pedido.impresion.variante} `.toUpperCase();
    if (!grupos[key]) {
      grupos[key] = {
        cabecera: { material: it.material.nombre, variante: pedido.impresion.variante, codArticulo: it.material.codArticulo, codStock: it.material.codStock },
        sublineas: [],
      };
    }
    const f = reg.usar(it.archivo);
    const width = Number(it.archivo.anchoM);
    const height = Number(it.archivo.altoM);
    grupos[key].sublineas.push({ f, width, height, cantidad: it.copias, nota: it.nota || '' });
  });

  Object.values(grupos).forEach((grp, idx) => {
    const archivos = [];
    grp.sublineas.forEach(sl => archivos.push({ name: sl.f.name, fileKey: sl.f.fileKey, width: sl.width, height: sl.height, observaciones: '', sinDPI: null, tipo: 'PRODUCCION' }));
    if (idx === 0) {
      referencias.forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'REFERENCIA' }));
      // Con Corte activo, boceto y planilla van a Corte (jsx:1815-1825)
      if (!corte) {
        bocetos.forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'BOCETO' }));
        planillas.forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'INFO_PEDIDO' }));
      }
    }
    listaServicios.push({
      esPrincipal: false,          // siempre hay orden madre PRO en "Fabricar a medida" (jsx:1870)
      areaId: 'SB',
      cabecera: grp.cabecera,
      archivos,
      items: grp.sublineas.map(sl => ({
        cantidad: sl.cantidad, nota: sl.nota, width: sl.width, height: sl.height,
        fileName: sl.f.name, fileBackName: undefined, fileKey: sl.f.fileKey, fileBackKey: null,
        printSettings: { mode: 'normal' },        // archivo normal: sin escala ni raport
        terminaciones: [], widthBack: undefined, heightBack: undefined,
        observaciones: '', observacionesBack: undefined, sinDPI: null, sinDPIBack: undefined,
      })),
      metadata: {},
      notas: '',
    });
  });

  // ── Orden madre PRO (jsx:2047-2060 terminado · 2070-2085 personalizado)
  if (prod.tipoFabricacion === 'TERMINADO') {
    listaServicios.push({
      esPrincipal: true, areaId: 'PRO', esProductoFabricado: true,
      cabecera: { material: prod.nombre || 'Prenda a Medida', proIdProducto: Number(prod.proIdProducto), variante: VARIANTE_PRO.FABRICA_TERMINADO },
      archivos: [], items: [{ cantidad: cantidadPrendas }], metadata: {},
      notas: '[PRODUCTO FABRICADO A MEDIDA]',
    });
  } else {
    const marcador = prod.precio.modo === 'ESTABLECIDO'
      ? `[PRECIO ESTABLECIDO: ${parseFloat(prod.precio.monto)} ${prod.precio.moneda}]`
      : '[FACTURA POR AREA]';
    listaServicios.push({
      esPrincipal: true, areaId: 'PRO', esProductoFabricado: true, esPrendaPersonalizada: true,
      cabecera: { material: 'Prenda Personalizada', variante: VARIANTE_PRO.FABRICA_PERSONALIZADO },
      archivos: [], items: [{ cantidad: cantidadPrendas }], metadata: {},
      notas: `[PRENDA PERSONALIZADA] ${marcador}`,
    });
  }

  // ── B) Servicios adicionales (jsx:1572-1623 cabeceras/archivos · 2145-2230 armado)
  const notaDe = (s) => [s.ubicacion ? `Ubicación: ${s.ubicacion}` : '', s.nota || ''].filter(Boolean).join('. ');
  const cabeceraDe = (s) => ({ variante: s.variante, material: { name: s.material.nombre, codArt: s.material.codArticulo, codStock: s.material.codStock } });

  const bordado = servicios.find(s => s.tipo === 'BORDADO');
  if (bordado) {
    const archivos = [];
    (bordado.bocetos || []).forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'BOCETO_BORDADO' }));
    (bordado.archivos || []).forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'LOGO_BORDADO' }));
    (bordado.referencias || []).forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'REFERENCIA' }));
    listaServicios.push({
      esPrincipal: false, areaId: 'EMB', cabecera: cabeceraDe(bordado), archivos, items: [],
      notas: notaDe(bordado),
      metadata: { prendas: parseInt(bordado.prendas, 10), material: bordado.material.nombre, variante: bordado.variante },
      chainedAfterAreaId: null,
    });
  }

  // DTF / TPU: cada archivo a imprimir es un ítem; el boceto va como referencia (jsx:1607-1623, 2215-2230)
  const estampados = [];
  ['DTF', 'TPU'].forEach((tipo) => {
    const s = servicios.find(x => x.tipo === tipo);
    if (!s) return;
    const areaId = tipo === 'DTF' ? 'DF' : 'TPU';
    const archivos = [];
    const items = [];
    // TPU: lo que llega NO es el arte de producción (son 2 a 5 capas en PDF que hace el área después de que el
    // cliente aprueba el boceto). Viaja como boceto de referencia: si fuera como archivo de producción contaría
    // como una "capa" y la orden pasaría a "Diseñado" antes de tiempo. La cantidad la pone el procesador.
    if (tipo === 'TPU') (s.archivos || []).forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'BOCETO' }));
    else (s.archivos || []).forEach(a => {
      const f = reg.usar(a);
      archivos.push({ name: f.name, fileKey: f.fileKey, tipo: 'PRODUCCION' });
      // DTF: viaja con ancho/alto y las copias de ESE archivo → el creador de pedidos calcula los metros (alto × copias).
      items.push({ fileName: f.name, fileKey: f.fileKey, cantidad: a.copias || 1, width: Number(a.anchoM), height: Number(a.altoM) });
    });
    (s.bocetos || []).forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'REFERENCIA' }));
    (s.referencias || []).forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'REFERENCIA' }));
    listaServicios.push({
      esPrincipal: false, areaId, cabecera: cabeceraDe(s), archivos, items,
      notas: notaDe(s), metadata: { prendas: cantidadPrendas }, chainedAfterAreaId: null,
    });
    estampados.push({ areaId, s });
  });

  // Estampado: UNA orden por cada DTF/TPU, encadenada a la suya (jsx:2173-2208)
  estampados.forEach(({ areaId, s }) => {
    listaServicios.push({
      esPrincipal: false, areaId: 'EST',
      cabecera: { variante: 'Estampado', material: 'Estampado (Servicio)', codArticulo: '110', codStock: '1.1.5.1' },
      archivos: (s.bocetos || []).map(a => ({ name: reg.usar(a).name, tipo: 'BOCETO_ESTAMPADO' })),
      items: [],
      notas: notaDe(s),
      metadata: { prendas: parseInt(s.estampado.prendas, 10), estampadosPorPrenda: parseInt(s.estampado.estampadosPorPrenda, 10), origen: s.estampado.origen || 'Stock User' },
      chainedAfterAreaId: areaId,
    });
  });

  // Corte y Costura (jsx:1641-1668, 2131-2143)
  if (corte) {
    const archivos = [];
    (corte.tizadas || []).forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'ARCHIVO_CORTE' }));
    bocetos.forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'BOCETO_CORTE' }));
    planillas.forEach(a => archivos.push({ name: reg.usar(a).name, tipo: 'INFO_CORTE' }));
    listaServicios.push({
      esPrincipal: false, areaId: 'TWC',
      cabecera: { variante: 'Corte Laser', material: { name: 'Corte Laser por prenda', id: 90, codArt: '1375', codStock: '1.1.6.1' } },
      archivos, items: [],
      notas: `Corte habilitado. Molde: ${corte.tipoMolde}. Tela: ${corte.origenTela}.`,
      metadata: { moldType: corte.tipoMolde, fabricOrigin: corte.origenTela, clientFabricName: corte.nombreTelaCliente || '', selectedSubOrderId: '', selectedBobinaId: usaTelaCliente ? parseInt(corte.bobinaId, 10) : null },
      chainedAfterAreaId: null,
    });
  }
  if (pedido.costura) {
    listaServicios.push({
      esPrincipal: false, areaId: 'TWT',
      cabecera: { variante: 'Costura', material: { name: 'Costura Standard', codArt: '112', codStock: '1.1.7.1' } },
      archivos: [], items: [],
      notas: pedido.costura.instrucciones || 'Servicio de Costura solicitado',
      metadata: {}, chainedAfterAreaId: null,
    });
  }

  // ── Body final (jsx:2339-2366)
  const payload = {
    idServicioBase: 'sublimacion',
    nombreTrabajo: pedido.nombreTrabajo,
    prioridad: 'Normal',
    notasGenerales: pedido.notas || '',
    tinta: null,
    // El creador de pedidos descuenta estos metros de la bobina (jsx:2332-2337, 2352-2353)
    bobinaId: usaTelaCliente ? parseInt(corte.bobinaId, 10) : null,
    magnitud: usaTelaCliente ? Math.round(pedido.impresion.items.reduce((acc, it) => acc + (Number(it.archivo.altoM) * (it.copias || 1)), 0) * 100) / 100 : null,
    servicios: listaServicios,
    combosRetiro: undefined,
    clienteInfo: {},
  };
  return { payload, archivos: reg.lista() };
}

module.exports = { traducir };
