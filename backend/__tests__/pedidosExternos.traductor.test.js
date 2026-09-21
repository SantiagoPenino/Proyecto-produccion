/**
 * Ingreso de pedidos por sistema — traductor (pedido de negocio → body de /ventas/pedido-prenda).
 * Función pura: no toca la base ni la red.
 *
 * PARIDAD CON LA PÁGINA ("fixtures dorados"): cargá un pedido en /ventas/pedido-prenda, copiá el body
 * del POST /api/prendas-orders/create (pestaña Red del navegador) en
 *   __tests__/fixtures/pedidosExternos/<caso>.pagina.json
 * y el pedido de negocio equivalente en <caso>.pedido.json. Este test los compara solo si existen.
 */
const fs = require('fs');
const path = require('path');
const { traducir } = require('../services/pedidosExternos/traductor');

const arch = (id, nombre, anchoM, altoM) => ({ id, url: `https://drive.google.com/file/d/${id}/view`, nombre, anchoM, altoM });
const tela = (nombre, cod) => ({ nombre, codArticulo: cod, codStock: '1.1.1.1' });

const pedidoBase = () => ({
  cliente: { codCliente: 100 }, nombreTrabajo: 'Camisetas', notas: 'nota', modo: 'FABRICAR', servicioPrincipal: 'sublimacion',
  producto: { tipoFabricacion: 'PERSONALIZADO', cantidad: 50, precio: { modo: 'ESTABLECIDO', monto: 5000, moneda: 'UYU' } },
  impresion: {
    variante: 'Sublimacion Tela',
    items: [
      { archivo: arch('A1', 'frente.pdf', 1.5, 2), material: tela('Dry Fit (1,83)', '10'), copias: 2 },
      { archivo: arch('A2', 'espalda.pdf', 1.5, 1), material: tela('Dry Fit (1,83)', '10'), copias: 1 },
      { archivo: arch('A3', 'mangas.pdf', 1.4, 0.5), material: tela('Set (1,60)', '11'), copias: 1 },
    ],
  },
  corte: { tipoMolde: 'MOLDES CLIENTES', origenTela: 'TELA USER', tizadas: [arch('T1', 'tizada.pdf')] },
  costura: { instrucciones: 'doble costura' },
  servicios: [
    { tipo: 'BORDADO', variante: 'Bordado sobre la prenda', material: tela('Hilo', '20'), ubicacion: 'pecho', nota: '', prendas: 50, archivos: [arch('B1', 'logo.dst')], bocetos: [arch('B2', 'boceto.png')], referencias: [] },
    { tipo: 'DTF', variante: 'DTF Textil', material: tela('DTF textil COMUN', '30'), ubicacion: 'espalda', nota: 'centrado', archivos: [arch('D1', 'dtf1.png', 0.3, 0.4), { ...arch('D2', 'dtf2.png', 0.3, 0.4), copias: 4 }], bocetos: [arch('D3', 'ubicacion.png')], referencias: [], estampado: { prendas: 50, estampadosPorPrenda: 3, origen: 'Stock User' } },
    { tipo: 'TPU', variante: 'TPU Mate', material: tela('TPU 3D', '40'), ubicacion: '', nota: '', archivos: [arch('U1', 'tpu.png', 0.1, 0.1)], bocetos: [], referencias: [], estampado: { prendas: 50, estampadosPorPrenda: 1, origen: 'Cliente' } },
  ],
  bocetos: [arch('P1', 'boceto-general.png')],
  planillas: [arch('P2', 'talles.xlsx')],
  archivosReferencia: [arch('R1', 'referencia.jpg')],
});

describe('traductor de pedidos por sistema', () => {
  test('una orden de sublimación por tela, y ninguna es la principal (la madre es PRO)', () => {
    const { payload } = traducir(pedidoBase());
    const sb = payload.servicios.filter(s => s.areaId === 'SB');
    expect(sb.map(s => s.cabecera.material)).toEqual(['Dry Fit (1,83)', 'Set (1,60)']);
    expect(sb[0].items.map(i => [i.fileName, i.cantidad, i.width, i.height])).toEqual([['frente.pdf', 2, 1.5, 2], ['espalda.pdf', 1, 1.5, 1]]);
    expect(sb.every(s => s.esPrincipal === false)).toBe(true);
    expect(sb[0].items[0].printSettings).toEqual({ mode: 'normal' });   // archivo normal: sin escala ni raport
    expect(payload.servicios.filter(s => s.esPrincipal).map(s => s.areaId)).toEqual(['PRO']);
  });

  test('las referencias van solo a la primera orden de sublimación; con Corte, boceto y planilla van a Corte', () => {
    const { payload } = traducir(pedidoBase());
    const [sb1, sb2] = payload.servicios.filter(s => s.areaId === 'SB');
    expect(sb1.archivos.filter(a => a.tipo === 'REFERENCIA').map(a => a.name)).toEqual(['referencia.jpg']);
    expect(sb2.archivos.some(a => a.tipo !== 'PRODUCCION')).toBe(false);
    const twc = payload.servicios.find(s => s.areaId === 'TWC');
    expect(twc.archivos.map(a => `${a.tipo}:${a.name}`)).toEqual(['ARCHIVO_CORTE:tizada.pdf', 'BOCETO_CORTE:boceto-general.png', 'INFO_CORTE:talles.xlsx']);
  });

  test('sin Corte, boceto y planilla van a la primera orden de sublimación', () => {
    const p = pedidoBase(); p.corte = null; p.costura = null;
    const sb1 = traducir(p).payload.servicios.find(s => s.areaId === 'SB');
    expect(sb1.archivos.map(a => a.tipo)).toEqual(['PRODUCCION', 'PRODUCCION', 'REFERENCIA', 'BOCETO', 'INFO_PEDIDO']);
  });

  test('orden madre PRO: precio establecido, por área y producto terminado', () => {
    const pro = (p) => traducir(p).payload.servicios.find(s => s.areaId === 'PRO');
    expect(pro(pedidoBase()).notas).toBe('[PRENDA PERSONALIZADA] [PRECIO ESTABLECIDO: 5000 UYU]');
    expect(pro(pedidoBase()).esPrendaPersonalizada).toBe(true);

    const porArea = pedidoBase(); porArea.producto.precio = { modo: 'POR_AREA' };
    expect(pro(porArea).notas).toBe('[PRENDA PERSONALIZADA] [FACTURA POR AREA]');

    const terminado = pedidoBase(); terminado.producto = { tipoFabricacion: 'TERMINADO', proIdProducto: 474, nombre: 'Camiseta Pro', cantidad: 12 };
    const t = pro(terminado);
    expect(t.cabecera).toEqual({ material: 'Camiseta Pro', proIdProducto: 474, variante: 'FABRICA PRODUCTO TERMINADO' });
    expect(t.notas).toBe('[PRODUCTO FABRICADO A MEDIDA]');
    expect(t.esPrendaPersonalizada).toBeUndefined();
    expect(t.items).toEqual([{ cantidad: 12 }]);
  });

  test('un Estampado por cada DTF / TPU, encadenado al suyo y con SUS cantidades', () => {
    const est = traducir(pedidoBase()).payload.servicios.filter(s => s.areaId === 'EST');
    expect(est.map(s => s.chainedAfterAreaId)).toEqual(['DF', 'TPU']);
    expect(est[0].metadata).toEqual({ prendas: 50, estampadosPorPrenda: 3, origen: 'Stock User' });
    expect(est[1].metadata).toEqual({ prendas: 50, estampadosPorPrenda: 1, origen: 'Cliente' });
    expect(est[0].cabecera).toEqual({ variante: 'Estampado', material: 'Estampado (Servicio)', codArticulo: '110', codStock: '1.1.5.1' });
  });

  test('DTF: cada archivo a imprimir es un ítem; el boceto va como referencia', () => {
    const df = traducir(pedidoBase()).payload.servicios.find(s => s.areaId === 'DF');
    // DTF viaja con su medida y SUS copias (metros = alto × copias); TPU no lleva medida
    expect(df.items).toEqual([{ fileName: 'dtf1.png', fileKey: 'D1', cantidad: 1, width: 0.3, height: 0.4 }, { fileName: 'dtf2.png', fileKey: 'D2', cantidad: 4, width: 0.3, height: 0.4 }]);
    // TPU: lo que llega es un boceto de referencia; el arte de producción se hace en el área
    const tpu = traducir(pedidoBase()).payload.servicios.find(s => s.areaId === 'TPU');
    expect(tpu.items).toEqual([]);
    expect(tpu.archivos).toEqual([{ name: 'tpu.png', tipo: 'BOCETO' }]);
    expect(df.archivos.map(a => a.tipo)).toEqual(['PRODUCCION', 'PRODUCCION', 'REFERENCIA']);
    expect(df.cabecera).toEqual({ variante: 'DTF Textil', material: { name: 'DTF textil COMUN', codArt: '30', codStock: '1.1.1.1' } });
  });

  test('Bordado: el diseño pronto es el logo, el boceto es boceto', () => {
    const emb = traducir(pedidoBase()).payload.servicios.find(s => s.areaId === 'EMB');
    expect(emb.archivos.map(a => `${a.tipo}:${a.name}`)).toEqual(['BOCETO_BORDADO:boceto.png', 'LOGO_BORDADO:logo.dst']);
    expect(emb.metadata.prendas).toBe(50);
    expect(emb.notas).toBe('Ubicación: pecho');
  });

  test('tela del cliente: bobina y metros (alto × copias) arriba del todo, y la bobina en Corte', () => {
    const p = pedidoBase(); p.corte = { tipoMolde: 'MOLDES CLIENTES', origenTela: 'TELA CLIENTE', bobinaId: 143, tizadas: [arch('T1', 'tizada.pdf')] };
    const { payload } = traducir(p);
    expect(payload.bobinaId).toBe(143);
    expect(payload.magnitud).toBe(5.5);   // 2×2 + 1×1 + 0,5×1
    expect(payload.servicios.find(s => s.areaId === 'TWC').metadata.selectedBobinaId).toBe(143);
    expect(traducir(pedidoBase()).payload.bobinaId).toBeNull();
  });

  test('Bordado y TPU se pueden pedir sin ningún archivo: el diseño se sube después en el área', () => {
    const p = pedidoBase();
    p.servicios[0].archivos = []; p.servicios[0].bocetos = [];
    p.servicios[2].archivos = [];
    const { payload } = traducir(p);
    expect(payload.servicios.find(s => s.areaId === 'EMB').archivos).toEqual([]);
    expect(payload.servicios.find(s => s.areaId === 'TPU').archivos).toEqual([]);
    expect(payload.servicios.filter(s => s.areaId === 'EST').map(s => s.chainedAfterAreaId)).toEqual(['DF', 'TPU']);
  });

  test('dos archivos distintos con el mismo nombre no se pisan', () => {
    const p = pedidoBase();
    p.impresion.items[1].archivo = arch('A2', 'frente.pdf', 1.5, 1);
    const { payload, archivos } = traducir(p);
    const nombres = payload.servicios.find(s => s.areaId === 'SB').items.map(i => i.fileName);
    expect(nombres).toEqual(['frente.pdf', '(2) frente.pdf']);
    expect(archivos.filter(a => a.name.endsWith('frente.pdf')).map(a => a.fileKey)).toEqual(['A1', 'A2']);
  });

  test('cabecera del body: igual a la que manda la página', () => {
    const { payload } = traducir(pedidoBase());
    expect(payload).toMatchObject({ idServicioBase: 'sublimacion', nombreTrabajo: 'Camisetas', prioridad: 'Normal', notasGenerales: 'nota', tinta: null, clienteInfo: {} });
  });
});

// ── Paridad contra bodies reales de la página (opcional: corre solo si hay fixtures) ──────────────
const DIR = path.join(__dirname, 'fixtures', 'pedidosExternos');
const casos = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.pedido.json')).map(f => f.replace('.pedido.json', '')) : [];

// Lo que legítimamente difiere: las claves de archivo (la página usa "1::nombre") y los undefined.
const normalizar = (body) => JSON.parse(JSON.stringify(body, (k, v) => (['fileKey', 'fileBackKey'].includes(k) ? undefined : v)));

(casos.length ? describe : describe.skip)('paridad con /ventas/pedido-prenda', () => {
  test.each(casos)('%s', (caso) => {
    const pedido = JSON.parse(fs.readFileSync(path.join(DIR, `${caso}.pedido.json`), 'utf8'));
    const pagina = JSON.parse(fs.readFileSync(path.join(DIR, `${caso}.pagina.json`), 'utf8'));
    expect(normalizar(traducir(pedido).payload)).toEqual(normalizar(pagina));
  });
});
