import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Lock, Plus, Save } from 'lucide-react';
import { BLOQUE_DEL_REQUISITO, RESPUESTA_MUESTRA, datosProductoVacios, evaluarProducto, fichaVacia } from './checklistSolicitud';
import api from '../../../services/apiClient';
import { useAuth } from '../../../context/AuthContext';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { BuscadorCliente, ESTADO_PARTE, MONEDA, NOMBRE_PARTE, ROL_ARCHIVO, errorDe } from './solicitudesComunes';
import './fichaPedido.css';

/**
 * Spec 41 — Alta y edición de una Solicitud (RN-SOL.05 a RN-SOL.11), con la forma de la maqueta
 * "Ficha de pedido personalizado": 7 bloques numerados y el panel "Estado del pedido" a la derecha.
 *   1 Identificación · 2 Pago y seña · 3 Producto · 4 Boceto · 5 Archivos para diseñar · 7 Extras
 *   (28-sep: la "Lista de talles" ya no es un paso del formulario: se carga en la solicitud, en la
 *   sección "Planilla de talles y nombres" de la producción principal, junto con el arte y las telas.)
 * Al INGRESAR solo se exige lo que el cliente puede dar (qué quiere, cuánto, dónde). Los datos
 * técnicos de cada servicio se pueden completar después: recién se exigen al convertir a pedido.
 * Editar una parte que ya está en Diseño la deja señalada como "Modificada" (RN-SOL.20b).
 * El pago es INFORMATIVO: se guarda en la solicitud y nunca toca el saldo del cliente.
 */
const ADICIONALES = ['BORDADO', 'DTF', 'TPU'];
const AREA_DE = { BORDADO: 'EMB', DTF: 'DF', TPU: 'TPU' };   // área del Configurador de Productos
const VARIANTE_DTF = 'DTF Textil';                          // fija, igual que en el ingreso de pedidos de prenda
const TIPOS_MOLDE = ['SUBLIMACION', 'MOLDES CLIENTES'];
const ORIGENES_TELA = ['TELA SUBLIMADA EN USER', 'TELA CLIENTE', 'TELA STOCK USER'];
const ORIGENES_PRENDA = ['Prendas del Cliente', 'Stock User'];

const BLOQUES = [
    { n: 1, id: 'b-ident', titulo: 'Identificación', corto: 'Identificación' },
    { n: 3, id: 'b-producto', titulo: 'Producto', corto: 'Producto' },
    { n: 7, id: 'b-extras', titulo: 'Servicios y extras', corto: 'Servicios y extras' },
    // El pago va al final (pedido del usuario, 25-sep). El orden de esta lista es el orden de los pasos.
    { n: 2, id: 'b-pago', titulo: 'Pago y seña', corto: 'Pago y seña' },
];

let seq = 0;
// tipo = modalidad de la solicitud: PRODUCTO_TERMINADO (del catálogo) | PERSONALIZADO (del cliente) | '' (todavía sin elegir)
const productoVacio = (tipo = '') => ({
    _k: `n${++seq}`, ProductoSolID: null, TipoFabricacion: tipo, ProIdProducto: '', ProductoNombre: '', Cantidad: '', Observaciones: '',
    Datos: datosProductoVacios(),
    Principal: { Observaciones: '', Estado: 'INGRESADO' },
    Partes: {}, permitidos: null, obligatorios: [], convertido: false, _familia: '',
});
// Toda la solicitud es de UNA modalidad. "mezclada" = solicitud vieja, cargada antes de esta regla.
// Cómo se nombra un producto en pestañas, panel y avisos: su referencia; si no tiene, lo elegido.
const nombreProd = (x, i) => (x?.TipoFabricacion === 'PRODUCTO_TERMINADO'
    ? (x?.ProductoNombre || `Sin producto elegido (${i + 1})`)                                   // del catálogo: el producto es la referencia
    : (String(x?.Datos?.referencia || '').trim() || String(x?.Datos?.tipoTrabajo || '').trim() || `Sin referencia (${i + 1})`));
// Requisitos que se completan al editar la solicitud (no en el alta)
const REQ_AL_EDITAR = ['Boceto, ficha técnica o muestra de referencia', 'Muestra aprobada por el cliente', 'Archivo de diseño entregado y verificado', 'Diseño aprobado por escrito por el cliente', 'Tipos de costura por parte de la prenda', 'Terminaciones definidas', 'Avíos y accesorios definidos', 'Tela e insumos definidos, y quién los provee'];
const MODALIDAD = { PRODUCTO_TERMINADO: 'Producto del catálogo', PERSONALIZADO: 'Producto del cliente' };
const modalidadDe = (ps) => {
    const t = [...new Set(ps.map(x => x.TipoFabricacion).filter(Boolean))];
    return { modalidad: t.length === 1 ? t[0] : '', mezclada: t.length > 1 };
};
const parteVacia = (incluido = false) => ({ IncluidoEnProducto: incluido, CantidadTotal: '', PorPrenda: '', Ubicacion: '', ArteOrigen: 'EMPRESA', Observaciones: '', Datos: {}, Estado: 'INGRESADO' });
const opciones = (lista, campo) => [...new Set((lista || []).map(x => String(x[campo] || '').trim()).filter(Boolean))];

// Pago y seña: mismos campos que la pestaña "Precio" de la solicitud (guardarPrecio / confirmarSena).
const pagoVacio = () => ({ ModoCobro: '', PrecioPactado: '', MonIdMoneda: 1, RequiereSena: false, SenaMontoRequerido: '', pagoSena: false, SenaVia: '', SenaMonto: '', SenaFecha: '', SenaReferencia: '', SenaConfirmada: false });
const precioDe = (p) => ({ ModoCobro: p.ModoCobro, PrecioPactado: p.ModoCobro === 'PRECIO_ESTABLECIDO' ? String(p.PrecioPactado) : '', MonIdMoneda: p.ModoCobro === 'PRECIO_ESTABLECIDO' || p.RequiereSena ? (Number(p.MonIdMoneda) || 1) : null, RequiereSena: !!p.RequiereSena, SenaMontoRequerido: p.RequiereSena ? String(p.SenaMontoRequerido) : '' });
const senaDe = (p) => ({ SenaVia: String(p.SenaVia || '').trim(), SenaMonto: String(p.SenaMonto || ''), SenaFecha: p.SenaFecha || '', SenaReferencia: String(p.SenaReferencia || '').trim() });
const ACEPTA_COMPROBANTE = 'image/*,.pdf';
const esComprobanteValido = (f) => /^image\//.test(f.type) || /\.pdf$/i.test(f.name);
const num = (v) => Number(v) || 0;
const fmtPlata = (v, mon) => `${MONEDA[mon] || '$'} ${num(v).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDia = (s) => (s ? s.split('-').reverse().join('/') : '');
const diasHasta = (s) => {
    if (!s) return null;
    const h = new Date();
    return Math.round((Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) - Date.UTC(h.getFullYear(), h.getMonth(), h.getDate())) / 86400000);
};

// Piezas de layout (fuera del componente: si se definieran adentro, React las recrearía en cada tecla y los inputs perderían el foco)
const Bloque = ({ n, num, id, titulo, sub, why, done, activo, children }) => (
    <section id={id} hidden={!activo} className={`fp-blk${done ? ' done' : ''}`}>
        <span className="fp-num" aria-hidden="true">{num || n}</span>
        <h2>{titulo}{sub ? <small>{sub}</small> : null}</h2>
        {why && <p className="fp-why">{why}</p>}
        {children}
    </section>
);
// <label> para un solo campo; <div> cuando adentro hay botones (buscadores, opciones), así un clic en el texto no dispara un botón.
const Campo = ({ label, ayuda, children, div }) => {
    const Tag = div ? 'div' : 'label';
    return <Tag className="fp-f">{label}{children}{ayuda && <span className="fp-hint">{ayuda}</span>}</Tag>;
};
const Tilde = ({ checked, onChange, children, disabled }) => (
    <label className={`fp-chk${disabled ? ' off' : ''}`}><input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span>{children}</span></label>
);
const Seg = ({ valor, onChange, opciones: ops, disabled }) => (
    <div className="fp-seg" role="group">
        {ops.map(([v, t, off]) => <button type="button" key={v} aria-pressed={valor === v} disabled={disabled || off} onClick={() => onChange(v)}>{t}</button>)}
    </div>
);
const EstadoParte = ({ e }) => <span className={`fp-pill${e && e !== 'INGRESADO' ? ' dis' : ''}`}>{ESTADO_PARTE[e]?.txt || e}</span>;
const ListaArchivos = ({ archivos, vacio }) => (
    archivos.length
        ? <div className="fp-files">{archivos.map(a => <span key={a.ArchivoID} className="fp-file">{a.NombreOriginal}<small>{ROL_ARCHIVO[a.Rol] || a.Rol}</small></span>)}</div>
        : <p className="fp-hint">{vacio}</p>
);


export default function SolicitudVendedorForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth() || {};
    const esEdicion = !!id;

    const [cargando, setCargando] = useState(esEdicion);
    const [guardando, setGuardando] = useState(false);
    const [cliente, setCliente] = useState(null);
    const [presupuesto, setPresupuesto] = useState(null);
    const [cab, setCab] = useState({ NombreTrabajo: '', VendedorID: user?.id || '', Detalle: '', Observaciones: '', FechaEntrega: '', FechaEntregaHasta: '', Ficha: fichaVacia() });
    const [vendedorNombre, setVendedorNombre] = useState('');           // solo para mostrar: el vendedor no se elige
    const [pago, setPago] = useState(pagoVacio());
    const [pagoInicial, setPagoInicial] = useState(null);             // en edición: lo guardado, para mandar solo lo que cambió
    const [archivosGuardados, setArchivosGuardados] = useState([]);   // en edición: para que el checklist vea los adjuntos
    const [comprobantes, setComprobantes] = useState([]);             // comprobantes elegidos, se suben al guardar
    const [arrastrando, setArrastrando] = useState(false);
    const [productos, setProductos] = useState([productoVacio('')]);
    const [sel, setSel] = useState(0);
    const [extraSel, setExtraSel] = useState('');                     // pestaña de extra que se ve (BORDADO | DTF | TPU)
    const [paso, setPaso] = useState(1);                              // pestaña (bloque) que se ve                                // producto que se ve en los bloques 3 a 7
    const [vendedores, setVendedores] = useState([]);
    const [catalogo, setCatalogo] = useState([]);
    const [nomen, setNomen] = useState({ embVariantes: [], tpuVariantes: [], dtfMateriales: [], materiales: {} });

    // Catálogos: vendedores, productos terminados (grupo 2.1 = prendas) y nomencladores de decoración
    useEffect(() => {
        svc.vendedores().then(setVendedores).catch(() => setVendedores([]));
        api.get('/prendas-orders/productos-terminados', { params: { grupo: '2.1', publicados: 1 } }).then(r => setCatalogo(r.data?.data || [])).catch(() => setCatalogo([]));
        api.get('/nomenclators/variants/EMB').then(r => setNomen(n => ({ ...n, embVariantes: opciones(r.data?.data, 'Variante') }))).catch(() => { });
        api.get('/nomenclators/variants/TPU').then(r => setNomen(n => ({ ...n, tpuVariantes: opciones(r.data?.data, 'Variante') }))).catch(() => { });
        api.get(`/nomenclators/materials/DF/${encodeURIComponent(VARIANTE_DTF)}`).then(r => setNomen(n => ({ ...n, dtfMateriales: opciones(r.data?.data, 'Material') }))).catch(() => { });
    }, []);

    const cargarMateriales = useCallback((area, variante) => {
        if (!variante) return;
        const clave = `${area}|${variante}`;
        setNomen(n => {
            if (n.materiales[clave]) return n;
            api.get(`/nomenclators/materials/${area}/${encodeURIComponent(variante)}`)
                .then(r => setNomen(m => ({ ...m, materiales: { ...m.materiales, [clave]: opciones(r.data?.data, 'Material') } })))
                .catch(() => { });
            return { ...n, materiales: { ...n.materiales, [clave]: [] } };
        });
    }, []);

    // Servicios que el producto terminado trae (obligatorios) y admite (lista cerrada) — RN-SOL.09
    const cargarServiciosProducto = useCallback(async (k, proId, alElegir) => {
        if (!proId) { setProductos(ps => ps.map(p => p._k === k ? { ...p, permitidos: null, obligatorios: [] } : p)); return; }
        try {
            const r = await api.get(`/prendas-orders/productos-terminados/${proId}/servicios`);
            const filas = r.data?.data || [];
            const area = (s) => String(s.AreaID || '').trim().toUpperCase();
            const permitidos = ADICIONALES.filter(t => filas.some(s => area(s) === AREA_DE[t]));
            const obligatorios = ADICIONALES.filter(t => filas.some(s => area(s) === AREA_DE[t] && s.Obligatorio));
            // Cómo se cobra cada técnica según el configurador: incluida en el precio del producto o como servicio aparte
            const cobros = Object.fromEntries(filas.map(s => [area(s), s.Cobro === 'INCLUIDA' ? 'INCLUIDA' : 'APARTE']));
            // [ACCESORIOS] artículos de stock del producto (configurador): al elegir el producto se arman
            // con los obligatorios marcados; al editar se respeta lo guardado y solo se refrescan las variantes.
            const accCfg = (r.data?.accesorios || []).map(a => ({
                id: a.ID, itemProIdProducto: a.ItemProIdProducto, nombre: a.ItemDescripcion || `Artículo ${a.ItemProIdProducto}`,
                wmsVarianteId: a.WmsVarianteId || '', varianteNombre: a.VarianteNombre || '', fijo: !!a.WmsVarianteId, unica: !!a.VarianteUnica,
                cantidadPorUnidad: a.Cantidad || 1, obligatorio: !!a.Obligatorio, cobro: a.Cobro === 'APARTE' ? 'APARTE' : 'INCLUIDO',
                incluir: !!a.Obligatorio, variantes: a.variantes || [], wmsDepositoId: a.WmsDepositoId || null,
            }));
            setProductos(ps => ps.map(p => {
                if (p._k !== k) return p;
                const partes = { ...p.Partes };
                if (alElegir) {
                    ADICIONALES.forEach(t => { if (!permitidos.includes(t) && partes[t]?.Estado === 'INGRESADO') delete partes[t]; });
                    obligatorios.forEach(t => { partes[t] = { ...(partes[t] || parteVacia()), IncluidoEnProducto: true }; });
                }
                const guardados = Array.isArray(p.Datos?.accesorios) ? p.Datos.accesorios : [];
                const accesorios = (alElegir || !guardados.length)
                    ? accCfg
                    : guardados.map(g => { const c = accCfg.find(x => x.id === g.id || x.itemProIdProducto === g.itemProIdProducto); return c ? { ...c, ...g, variantes: c.variantes } : g; });
                return { ...p, permitidos, obligatorios, cobros, Partes: partes, Datos: { ...p.Datos, accesorios } };
            }));
        } catch (e) { toast.error(`No se pudieron leer los servicios del producto: ${errorDe(e)}`); }
    }, []);

    // Edición: traer la solicitud
    useEffect(() => {
        if (!esEdicion) return;
        (async () => {
            try {
                const s = await svc.obtener(id);
                setCliente({ CodCliente: s.CodCliente, Nombre: s.ClienteNombre, Codigo: s.ClienteCodigo });
                setPresupuesto(s.Presupuesto || (s.PreId ? { PreId: s.PreId, PreNumero: s.PreNumero } : null));
                const fecha = (v) => (v ? String(v).slice(0, 10) : '');
                setVendedorNombre(s.VendedorNombre || '');
                setCab({ NombreTrabajo: s.NombreTrabajo, VendedorID: s.VendedorID, Detalle: s.Detalle, Observaciones: s.Observaciones || '', FechaEntrega: fecha(s.FechaEntrega), FechaEntregaHasta: fecha(s.FechaEntregaHasta), Ficha: { ...fichaVacia(), ...(s.Ficha || {}), muestra: { ...fichaVacia().muestra, ...(s.Ficha?.muestra || {}) } } });
                const pg = {
                    ModoCobro: s.ModoCobro || '', PrecioPactado: s.PrecioPactado ?? '', MonIdMoneda: s.MonIdMoneda || 1, RequiereSena: !!s.RequiereSena, SenaMontoRequerido: s.SenaMontoRequerido ?? '',
                    pagoSena: !!s.SenaConfirmada, SenaVia: s.SenaVia || '', SenaMonto: s.SenaMonto ?? '', SenaFecha: s.Ficha?.senaFecha || '', SenaReferencia: s.SenaReferencia || '', SenaConfirmada: !!s.SenaConfirmada,
                };
                setPago(pg);
                setPagoInicial(pg);
                setArchivosGuardados(s.Archivos || []);
                const ps = s.Productos.map(p => {
                    const base = productoVacio();
                    const principal = p.Partes.find(x => x.Tipo === 'PRINCIPAL');
                    const partes = {};
                    p.Partes.filter(x => x.Tipo !== 'PRINCIPAL').forEach(x => {
                        partes[x.Tipo] = { ParteID: x.ParteID, IncluidoEnProducto: !!x.IncluidoEnProducto, CantidadTotal: x.CantidadTotal ?? '', PorPrenda: x.PorPrenda ?? '', Ubicacion: x.Ubicacion || '', ArteOrigen: x.ArteOrigen || 'EMPRESA', Observaciones: x.Observaciones || '', Datos: x.Datos || {}, Estado: x.Estado };
                    });
                    return {
                        ...base, ProductoSolID: p.ProductoSolID, TipoFabricacion: p.TipoFabricacion, ProIdProducto: p.ProIdProducto || '', ProductoNombre: p.ProductoNombre || '',
                        Cantidad: p.Cantidad, Observaciones: p.Observaciones || '',
                        Datos: { ...base.Datos, ...(p.Datos || {}), corte: { ...base.Datos.corte, ...(p.Datos?.corte || {}) }, costura: { ...base.Datos.costura, ...(p.Datos?.costura || {}) }, espec: { ...base.Datos.espec, ...(p.Datos?.espec || {}) }, diseno: { ...base.Datos.diseno, ...(p.Datos?.diseno || {}) } },
                        Principal: { ParteID: principal?.ParteID, Observaciones: principal?.Observaciones || '', Estado: principal?.Estado || 'INGRESADO' },
                        Partes: partes, convertido: !!p.PedidoNoDocERP,
                    };
                });
                setProductos(ps);
                ps.forEach(p => {
                    if (p.ProIdProducto) cargarServiciosProducto(p._k, p.ProIdProducto, false);
                    if (p.Partes.BORDADO?.Datos?.variante) cargarMateriales('EMB', p.Partes.BORDADO.Datos.variante);
                    if (p.Partes.TPU?.Datos?.variante) cargarMateriales('TPU', p.Partes.TPU.Datos.variante);
                });
            } catch (e) { toast.error(errorDe(e)); navigate('/ventas/solicitudes'); }
            finally { setCargando(false); }
        })();
    }, [id, esEdicion, navigate, cargarServiciosProducto, cargarMateriales]);

    const cambiarProducto = (k, cambios) => setProductos(ps => ps.map(p => p._k === k ? { ...p, ...cambios } : p));
    const cambiarDatos = (k, grupo, cambios) => setProductos(ps => ps.map(p => p._k === k ? { ...p, Datos: { ...p.Datos, [grupo]: { ...p.Datos[grupo], ...cambios } } } : p));
    const cambiarDato = (k, cambios) => setProductos(ps => ps.map(p => p._k === k ? { ...p, Datos: { ...p.Datos, ...cambios } } : p));
    const setFicha = (cambios) => setCab(c => ({ ...c, Ficha: { ...c.Ficha, ...cambios } }));
    const setMuestra = (cambios) => setCab(c => ({ ...c, Ficha: { ...c.Ficha, muestra: { ...c.Ficha.muestra, ...cambios } } }));
    const cambiarParte = (k, tipo, cambios) => setProductos(ps => ps.map(p => p._k === k ? { ...p, Partes: { ...p.Partes, [tipo]: { ...p.Partes[tipo], ...cambios } } } : p));
    const cambiarDatosParte = (k, tipo, cambios) => setProductos(ps => ps.map(p => p._k === k ? { ...p, Partes: { ...p.Partes, [tipo]: { ...p.Partes[tipo], Datos: { ...p.Partes[tipo].Datos, ...cambios } } } } : p));
    const setP = (cambios) => setPago(x => ({ ...x, ...cambios }));
    const agregarComprobantes = (lista) => {
        const files = [...(lista || [])];
        const malos = files.filter(f => !esComprobanteValido(f));
        if (malos.length) toast.warning(`El comprobante tiene que ser una imagen o un PDF. No se agregó: ${malos.map(f => f.name).join(', ')}`);
        setComprobantes(cs => [...cs, ...files.filter(esComprobanteValido)]);
    };

    const alternarServicio = (p, tipo) => {
        if (p.Partes[tipo]) {
            if (p.obligatorios.includes(tipo)) return toast.warning('Este servicio viene incluido en el producto elegido — no se puede quitar.');
            if (p.Partes[tipo].Estado !== 'INGRESADO' && !window.confirm(`${NOMBRE_PARTE[tipo]} ya está en Diseño (${ESTADO_PARTE[p.Partes[tipo].Estado]?.txt}). Si lo quitás, sale de la bandeja de Diseño. ¿Quitarlo igual?`)) return undefined;
            return setProductos(ps => ps.map(x => { if (x._k !== p._k) return x; const partes = { ...x.Partes }; delete partes[tipo]; return { ...x, Partes: partes }; }));
        }
        const nueva = parteVacia();
        if (tipo === 'DTF') nueva.Datos = { variante: VARIANTE_DTF };
        if (tipo === 'TPU') nueva.Datos = { origenPrendas: 'Stock User' };
        nueva.CantidadTotal = p.Cantidad || '';
        return cambiarProducto(p._k, { Partes: { ...p.Partes, [tipo]: nueva } });
    };

    // La modalidad se elige una vez y pasa a todos los productos de la solicitud.
    const cambiarModalidad = (tipo) => {
        if (tipo === modalidadDe(productos).modalidad) return;
        if (productos.some(x => x.convertido)) { toast.warning('Esta solicitud ya tiene productos convertidos en pedido: la modalidad no se puede cambiar.'); return; }
        const conDatos = productos.some(x => x.TipoFabricacion && (x.ProIdProducto || String(x.Datos.tipoTrabajo || '').trim()));
        if (conDatos && !window.confirm(`Pasar toda la solicitud a "${MODALIDAD[tipo]}". Se borra el producto o el tipo de trabajo que ya elegiste en cada producto. ¿Seguir?`)) return;
        setProductos(ps => ps.map(x => ({ ...x, TipoFabricacion: tipo, ProIdProducto: '', ProductoNombre: '', permitidos: null, obligatorios: [], _familia: '', _otra: false, Datos: { ...x.Datos, tipoTrabajo: '', ...(tipo === 'PRODUCTO_TERMINADO' ? { productoNuevo: false } : {}), referencia: x._refAuto ? '' : x.Datos.referencia } })));
    };
    const elegirProducto = (p, proId) => {
        const art = catalogo.find(a => String(a.ProIdProducto) === String(proId));
        // La configuración del producto manda: si tiene paquete fijo o mínimo, la cantidad arranca ahí
        const fija = Number(art?.CantidadFija) || 0, min = Number(art?.CantidadMinima) || 0;
        const cant = Number(p.Cantidad) || 0;
        const cantidad = fija ? (cant && cant % fija === 0 ? cant : fija) : (min && cant < min ? min : (cant || ''));
        cambiarProducto(p._k, { ProIdProducto: proId, ProductoNombre: art?.Descripcion || '', Cantidad: cantidad, _min: min, _fija: fija, _precio: art?.Precio ?? null, _moneda: art?.Moneda || '', _molde: art?.Molde || null });
        cargarServiciosProducto(p._k, proId, true);
    };
    const agregarProducto = () => { setProductos(ps => [...ps, productoVacio(modalidadDe(ps).modalidad)]); setSel(productos.length); };
    const quitarProducto = (p, i) => {
        if (!window.confirm(`¿Quitar "${nombreProd(p, i)}" de la solicitud? Sus servicios salen de Diseño.`)) return;
        setProductos(ps => ps.filter(x => x._k !== p._k));
        setSel(s => (i < s ? s - 1 : i === s ? 0 : s));
    };
    // Ir a un paso: abre su pestaña y sube hasta la fila de pasos. Si no es un paso (ej. el panel), solo baja hasta ahí.
    const irA = (bid) => {
        const b = BLOQUES.find(x => x.id === bid);
        if (b) { setPaso(b.n); setTimeout(() => document.getElementById('fp-pasos')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); return; }
        document.getElementById(bid)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // Precio y seña: se guardan con los mismos endpoints de la pestaña "Precio" y solo si cambiaron.
    // Nunca tocan el saldo del cliente (el cobro lo ingresan Administración y Caja).
    const guardarPago = async (sid) => {
        const avisos = [];
        if (!pago.ModoCobro) return avisos;
        if (JSON.stringify(precioDe(pago)) !== JSON.stringify(pagoInicial ? precioDe(pagoInicial) : null)) {
            try { await svc.guardarPrecio(sid, precioDe(pago)); } catch (e) { avisos.push(`el precio y la seña no se guardaron: ${errorDe(e)}`); return avisos; }
        }
        if (pago.RequiereSena && pago.pagoSena && JSON.stringify(senaDe(pago)) !== JSON.stringify(pagoInicial?.SenaConfirmada ? senaDe(pagoInicial) : null)) {
            try { await svc.confirmarSena(sid, senaDe(pago)); } catch (e) { avisos.push(`el pago de la seña no se guardó: ${errorDe(e)}`); }
        }
        return avisos;
    };
    // Comprobantes de la seña: van como archivo general de la solicitud (tipo "Comprobante de pago").
    const subirComprobantes = async (sid) => {
        const avisos = [];
        for (const f of comprobantes) {
            try { await svc.subirArchivo(sid, f, { Rol: 'COMPROBANTE' }); } catch (e) { avisos.push(`el comprobante "${f.name}" no se subió: ${errorDe(e)}`); }
        }
        return avisos;
    };

    const guardar = async () => {
        if (!cliente) return toast.warning('Elegí el cliente de la solicitud.');
        if (!cab.NombreTrabajo.trim()) return toast.warning('Ingresá el nombre del trabajo.');
        if (!cab.Detalle.trim()) return toast.warning('Escribí el detalle de la solicitud (qué pide el cliente).');
        for (let i = 0; i < productos.length; i++) {
            const p = productos[i];
            if (!p.TipoFabricacion) return toast.warning('Elegí la modalidad de la solicitud: producto del catálogo o producto del cliente.');
            if (p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !p.ProIdProducto) return toast.warning(`${nombreProd(p, i)}: elegí el producto del catálogo.`);
            if (!(Number(p.Cantidad) > 0)) return toast.warning(`${nombreProd(p, i)}: ingresá la cantidad de prendas.`);
            if (p._fija > 0 && Number(p.Cantidad) % p._fija !== 0) return toast.warning(`${nombreProd(p, i)}: se vende en paquetes de ${p._fija}. Poné un múltiplo de ${p._fija}.`);
            if (p._min > 0 && Number(p.Cantidad) < p._min) return toast.warning(`${nombreProd(p, i)}: el mínimo es ${p._min} unidades.`);
            if (p.Datos.costura.activo && !p.Datos.corte.activo) return toast.warning(`${nombreProd(p, i)}: Costura requiere Corte.`);
        }
        if (cab.FechaEntregaHasta && cab.FechaEntrega && cab.FechaEntregaHasta < cab.FechaEntrega) return toast.warning('La fecha "hasta" no puede ser anterior a la fecha que necesita el cliente.');
        // Pago y seña: se revisa ANTES de guardar, para no dejar la solicitud guardada a medias.
        if (pago.RequiereSena && !pago.ModoCobro) return toast.warning('Pago y seña: elegí cómo se cobra.');
        if (pago.ModoCobro === 'PRECIO_ESTABLECIDO' && !(num(pago.PrecioPactado) > 0)) return toast.warning('Pago y seña: ingresá el total pactado, o elegí "Facturar por cada área".');
        if (pago.RequiereSena && !(num(pago.SenaMontoRequerido) > 0)) return toast.warning('Pago y seña: indicá de cuánto es la seña que se pide.');
        if (pago.RequiereSena && pago.pagoSena && (!senaDe(pago).SenaVia || !(num(pago.SenaMonto) > 0) || !senaDe(pago).SenaReferencia)) return toast.warning('Pago y seña: si pagó la seña, completá monto, vía de entrada y referencia del pago.');

        const payload = {
            CodCliente: cliente.CodCliente, PreId: presupuesto?.PreId || null, ...cab, FechaEntrega: cab.FechaEntrega || null, FechaEntregaHasta: cab.FechaEntregaHasta || null,
            Ficha: { ...cab.Ficha, senaFecha: pago.RequiereSena && pago.pagoSena ? pago.SenaFecha : '' },
            Productos: productos.map(p => ({
                ProductoSolID: p.ProductoSolID, TipoFabricacion: p.TipoFabricacion, ProIdProducto: p.ProIdProducto || null, ProductoNombre: p.ProductoNombre || null,
                Cantidad: p.Cantidad, Observaciones: p.Observaciones, Datos: p.Datos,
                Partes: [
                    { Tipo: 'PRINCIPAL', Observaciones: p.Principal.Observaciones },
                    ...ADICIONALES.filter(t => p.Partes[t]).map(t => ({ Tipo: t, ...p.Partes[t] })),
                ],
            })),
        };
        setGuardando(true);
        try {
            if (esEdicion) {
                const r = await svc.actualizar(id, payload);
                const avisos = [...await guardarPago(id), ...await subirComprobantes(id)];
                if (avisos.length) toast.warning(`La solicitud se guardó, pero ${avisos.join(' · ')}`);
                else toast.success(r.cambios ? 'Cambios guardados. Lo que ya estaba en Diseño quedó señalado como "Modificada".' : 'Guardado.');
                navigate(`/ventas/solicitudes/${id}`);
            } else {
                const r = await svc.crear(payload);
                const avisos = [...await guardarPago(r.SolicitudID), ...await subirComprobantes(r.SolicitudID)];
                if (avisos.length) toast.warning(`Solicitud #${r.SolicitudID} ingresada, pero ${avisos.join(' · ')}. Cargalo en la pestaña Precio.`);
                else toast.success(`Solicitud #${r.SolicitudID} ingresada. Ahora podés adjuntar archivos y enviar a Diseño.`);
                navigate(`/ventas/solicitudes/${r.SolicitudID}`);
            }
        } catch (e) { toast.error(errorDe(e)); }
        finally { setGuardando(false); }
    };


    // Al CREAR (solicitud inicial) solo va lo que se sabe al ingresar. Talles, archivos para diseñar,
    // especificaciones técnicas y la aprobación de la muestra se completan al EDITAR la solicitud.
    const SOLO_AL_EDITAR = [6];
    const bloquesVis = esEdicion ? BLOQUES : BLOQUES.filter(b => !SOLO_AL_EDITAR.includes(b.n));
    const numDe = (n) => bloquesVis.findIndex(b => b.n === n) + 1;
    if (cargando) return <div className="fp"><div className="fp-wrap" style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><Loader2 className="animate-spin" /></div></div>;

    // ── Estado del pedido, en vivo (mismas reglas que el sello guardado) ──
    const cabChk = { NombreTrabajo: cab.NombreTrabajo, VendedorID: cab.VendedorID, FechaEntrega: cab.FechaEntrega, Ficha: cab.Ficha };
    const checks = productos.map(p => (p.convertido ? null : evaluarProducto(cabChk, p, archivosGuardados)));
    const pref = (i) => (productos.length > 1 ? `${nombreProd(productos[i], i)}: ` : '');
    const faltan = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    // Requisitos que en la solicitud inicial se cumplen DESPUÉS de guardar (subiendo archivos o editando):
    // no se esconden, se listan aparte en el panel.
    const despues = [];
    const sumar = (b, txt) => { if (!faltan[b].includes(txt)) faltan[b].push(txt); };
    if (!cliente) sumar(1, 'Cliente');
    if (!cab.Detalle.trim()) sumar(1, 'Detalle de la solicitud');
    const { modalidad, mezclada } = modalidadDe(productos);
    if (!modalidad && !mezclada) sumar(3, 'Modalidad: producto del catálogo o del cliente');
    checks.forEach((c, i) => c && c.faltan.forEach(x => {
        const b = BLOQUE_DEL_REQUISITO[x] || 3;
        if (SOLO_AL_EDITAR.includes(b) || (!esEdicion && REQ_AL_EDITAR.includes(x))) {
            const t2 = `${pref(i)}${x}`;
            if (!despues.includes(t2)) despues.push(t2);
            return;
        }
        const txt = x === 'Tipo de trabajo definido' ? (productos[i].TipoFabricacion === 'PRODUCTO_TERMINADO' ? 'Producto del catálogo elegido' : 'Familia') : x;
        sumar(b, b === 1 || x.startsWith('Muestra') ? txt : `${pref(i)}${txt}`);   // los de la cabecera y la muestra son uno solo para toda la solicitud
    }));
    const sello = !!cliente && !!cab.Detalle.trim() && checks.every(c => !c || c.listo);
    // 2 · Pago (informativo; lo exige recién la conversión a pedido, igual que hoy)
    if (!pago.ModoCobro) sumar(2, 'Cómo se cobra');
    else if (pago.ModoCobro === 'PRECIO_ESTABLECIDO' && !(num(pago.PrecioPactado) > 0)) sumar(2, 'Total pactado');
    if (pago.RequiereSena && !(num(pago.SenaMontoRequerido) > 0)) sumar(2, 'Monto de la seña que se pide');
    if (pago.RequiereSena && !pago.pagoSena) sumar(2, 'La seña todavía no está paga');
    const comprobantesGuardados = archivosGuardados.filter(a => a.Vigente && a.Rol === 'COMPROBANTE');
    if (pago.RequiereSena && pago.pagoSena && !comprobantes.length && !comprobantesGuardados.length) sumar(2, 'Comprobante de la transferencia');
    // 7 · Extras: lo que se exige al convertir a pedido
    productos.forEach((p, i) => !p.convertido && ADICIONALES.filter(t => p.Partes[t]).forEach(t => {
        const pa = p.Partes[t]; const dd = pa.Datos || {};
        const f = [];
        if (!(num(pa.CantidadTotal) > 0)) f.push('cantidad');
        if (!String(pa.Ubicacion || '').trim()) f.push('ubicación');
        if (t !== 'DTF' && !dd.variante) f.push(t === 'BORDADO' ? 'dónde se borda' : 'tipo');
        if (!dd.material) f.push(t === 'BORDADO' ? 'hilo o tafeta' : t === 'DTF' ? 'film' : 'artículo');
        if (f.length) sumar(7, `${pref(i)}${NOMBRE_PARTE[t]}: falta ${f.join(', ')}`);
    }));
    const luego = [...new Set(checks.flatMap(c => (c ? c.luego : [])))];
    const listos = bloquesVis.filter(b => faltan[b.n].length === 0).length;
    const subDe = (b) => {
        if (faltan[b.n].length === 0) return b.n === 2 ? 'Cargado (informativo)' : b.n === 7 && !productos.some(p => ADICIONALES.some(t => p.Partes[t])) ? 'No lleva extras' : 'Listo';
        return `Falta: ${faltan[b.n].slice(0, 3).join(' · ')}${faltan[b.n].length > 3 ? ` · y ${faltan[b.n].length - 3} más` : ''}`;
    };

    // ── Producto que se muestra en los bloques 3 a 7 ──
    const iSel = Math.min(sel, productos.length - 1);
    const p = productos[iSel];
    const d = p.Datos;
    const subProd = productos.length > 1 ? nombreProd(productos[iSel], iSel) : '';
    const familias = [...new Set(catalogo.map(a => a.Categoria).filter(Boolean))];
    const esOtra = (x) => !!x._otra || (!!String(x.Datos.tipoTrabajo || '').trim() && !familias.includes(x.Datos.tipoTrabajo));
    const refAuto = (x) => !!x._refAuto || !String(x.Datos.referencia || '').trim();
    const conReferencia = (x, valor, extra = {}, datos = {}) => (refAuto(x)
        ? { ...extra, _refAuto: true, Datos: { ...x.Datos, ...datos, referencia: valor } }
        : { ...extra, Datos: { ...x.Datos, ...datos } });
    // Total sugerido = Σ cantidad × precio de catálogo, solo si TODOS los productos son del catálogo con precio
    const fmtMoneda = (v, m) => ((m || 'UYU').toUpperCase() === 'USD' ? 'US$ ' : '$ ') + Number(v).toLocaleString('es-UY', { maximumFractionDigits: 2 });
    const catalogoConPrecio = productos.length > 0 && productos.every(x => x.TipoFabricacion === 'PRODUCTO_TERMINADO' && x._precio != null && Number(x.Cantidad) > 0);
    const sugeridoCatalogo = catalogoConPrecio ? Math.round(productos.reduce((t, x) => t + Number(x._precio) * Number(x.Cantidad), 0) * 100) / 100 : null;
    const monedaCatalogo = productos[0]?._moneda || '';
    // Al editar (o si el catálogo llega después de elegir), los productos del catálogo recuperan su
    // precio, moneda y cantidades mínima/fija desde el catálogo: sin esto no hay referencia ni default.
    useEffect(() => {
        if (!catalogo.length) return;
        setProductos(ps => {
            let cambio = false;
            const next = ps.map(x => {
                if (x.TipoFabricacion !== 'PRODUCTO_TERMINADO' || !x.ProIdProducto || x._precio !== undefined) return x;
                const art = catalogo.find(a => String(a.ProIdProducto) === String(x.ProIdProducto));
                if (!art) return x;
                cambio = true;
                return { ...x, _precio: art.Precio ?? null, _moneda: art.Moneda || '', _molde: art.Molde || null, _min: x._min ?? (art.CantidadMinima || null), _fija: x._fija ?? (art.CantidadFija || null) };
            });
            return cambio ? next : ps;
        });
    }, [catalogo]);   // eslint-disable-line react-hooks/exhaustive-deps
    // Precio por defecto: con productos del catálogo, "Precio establecido" arranca con unidades × precio
    // de catálogo (y su moneda). Se vuelve a calcular mientras el total no se haya tocado a mano.
    useEffect(() => {
        if (sugeridoCatalogo == null) return;
        setPago(x => {
            const modo = x.ModoCobro || (esEdicion ? '' : 'PRECIO_ESTABLECIDO');
            const auto = x.PrecioPactado === '' || x._auto;
            if (modo !== 'PRECIO_ESTABLECIDO' || !auto) return x.ModoCobro === modo ? x : { ...x, ModoCobro: modo };
            return { ...x, ModoCobro: modo, PrecioPactado: String(sugeridoCatalogo), MonIdMoneda: (monedaCatalogo || '').toUpperCase() === 'USD' ? 2 : 1, _auto: true };
        });
    }, [sugeridoCatalogo, monedaCatalogo]);   // eslint-disable-line react-hooks/exhaustive-deps
    const famDe = (x) => x._familia || catalogo.find(a => String(a.ProIdProducto) === String(x.ProIdProducto))?.Categoria || '';
    // Segundo nivel del árbol: la etiqueta del configurador (Básquet, Fútbol…). '' = todas.
    const SIN_ETQ = '__sin__';
    const etqDe = (x) => x._etiqueta !== undefined ? x._etiqueta : (catalogo.find(a => String(a.ProIdProducto) === String(x.ProIdProducto))?.Etiqueta || '');
    const etiquetasDe = (fam) => {
        const arts = catalogo.filter(a => a.Categoria === fam);
        const lista = [...new Set(arts.map(a => a.Etiqueta).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        return { lista, conSin: arts.some(a => !a.Etiqueta), hay: lista.length > 0 };
    };
    const productosDe = (fam, etq) => catalogo.filter(a => a.Categoria === fam && (!etq || (etq === SIN_ETQ ? !a.Etiqueta : a.Etiqueta === etq)));
    const imgSrc = (a) => (a.Imagen ? (a.Imagen.startsWith('http') ? a.Imagen : `${(api.defaults?.baseURL || '').replace(/\/api\/?$/, '')}${a.Imagen}`) : null);
    const vig = archivosGuardados.filter(a => a.Vigente);
    const mio = (a) => a.ProductoSolID === p.ProductoSolID || (p.Principal?.ParteID && a.ParteID === p.Principal.ParteID) || (!a.ProductoSolID && !a.ParteID && !a.EventoID);
    const archivosDe = (roles) => vig.filter(a => roles.includes(a.Rol) && mio(a));
    // Igual que "mio", pero para cualquier producto (la tabla del paso 4 muestra todos a la vez)
    const archivosProd = (x, roles) => vig.filter(a => roles.includes(a.Rol) && (a.ProductoSolID === x.ProductoSolID || (x.Principal?.ParteID && a.ParteID === x.Principal.ParteID) || (!a.ProductoSolID && !a.ParteID && !a.EventoID)));
    const dias = diasHasta(cab.FechaEntrega);
    const hayExtras = ADICIONALES.some(t => p.Partes[t]);
    const extraVis = p.Partes[extraSel] ? extraSel : (ADICIONALES.find(t => p.Partes[t]) || '');
    const restante = pago.ModoCobro === 'PRECIO_ESTABLECIDO' ? num(pago.PrecioPactado) - (pago.pagoSena ? num(pago.SenaMonto) : 0) : null;
    const iPaso = Math.max(0, bloquesVis.findIndex(b => b.n === paso));   // posición del paso abierto (el 4 ya no existe)
    const textoGuardar = esEdicion ? 'Guardar cambios' : 'Ingresar solicitud';

    return (
        <div className="fp">
            <div className="fp-wrap">
                <header className="fp-top">
                    <div>
                        <h1>{esEdicion ? `Editar solicitud #${id}` : 'Nueva solicitud'}</h1>
                        <p>Completá con el cliente cada bloque. Se puede guardar incompleto: lo que falte queda marcado en el panel y se completa después.</p>
                    </div>
                    <button type="button" onClick={() => navigate(esEdicion ? `/ventas/solicitudes/${id}` : '/ventas/solicitudes')} className="fp-btn"><ArrowLeft size={16} /> Volver sin guardar</button>
                </header>

                <div className="fp-grid">
                    <main style={{ minWidth: 0 }}>
                        <nav id="fp-pasos" className="fp-pasos" aria-label="Pasos de la solicitud">
                            {bloquesVis.map((b, bi) => {
                                const n = faltan[b.n].length;
                                return (
                                    <button type="button" key={b.n} className={`fp-paso ${n ? 'falta' : 'ok'}`} aria-current={paso === b.n ? 'step' : undefined} onClick={() => irA(b.id)}
                                        title={n ? `Falta: ${faltan[b.n].join(' · ')}` : 'Completo'}>
                                        <span className="sig" aria-hidden="true">{n ? '!' : '✓'}</span>
                                        <span className="n">{bi + 1}</span>
                                        <span className="t">{b.corto}</span>
                                        <span className="e">{n ? `Falta${n === 1 ? '' : 'n'} ${n}` : b.n === 2 ? 'Cargado' : 'Completo'}</span>
                                    </button>
                                );
                            })}
                        </nav>

                        {/* 1 · IDENTIFICACIÓN */}
                        <Bloque n={1} num={numDe(1)} activo={paso === 1} id="b-ident" titulo="Identificación" done={!faltan[1].length}>
                            <div className="fp-stack">
                                <Campo div label="Cliente *"><BuscadorCliente cliente={cliente} onPick={setCliente} /></Campo>
                                <div className="fp-fields two">
                                    <Campo label="Nombre del trabajo *"><input type="text" value={cab.NombreTrabajo} onChange={e => setCab(c => ({ ...c, NombreTrabajo: e.target.value }))} placeholder="Ej: Buzos egresados 3ºB" /></Campo>
                                    <Campo label="Vendedor">
                                        <input type="text" readOnly tabIndex={-1} className="fp-fijo" title="Se carga solo: es quien ingresó la solicitud"
                                            value={vendedorNombre || vendedores.find(v => String(v.IdUsuario) === String(cab.VendedorID))?.Nombre || user?.nombre || user?.username || ''} />
                                    </Campo>
                                </div>
                                <Campo label="Detalle de la solicitud * (qué pide el cliente)"><textarea value={cab.Detalle} onChange={e => setCab(c => ({ ...c, Detalle: e.target.value }))} placeholder="Ej: 22 buzos canguro azul marino con escudo bordado y apodo en la espalda" /></Campo>
                                <div className={`fp-cfg${cab.FechaEntrega && dias < 0 ? ' late' : ''}`}>
                                    <div className="fp-stack">
                                        <div className="fp-fields two">
                                            <Campo label="Fecha que necesita el cliente *" ayuda="Una fecha concreta, no “para fin de mes”."><input type="date" value={cab.FechaEntrega} onChange={e => setCab(c => ({ ...c, FechaEntrega: e.target.value }))} /></Campo>
                                            <Campo label="Hasta (si es un rango)" ayuda="Si hay un evento, viaje o torneo: el último día posible."><input type="date" value={cab.FechaEntregaHasta} min={cab.FechaEntrega || undefined} onChange={e => setCab(c => ({ ...c, FechaEntregaHasta: e.target.value }))} /></Campo>
                                        </div>
                                        {cab.FechaEntrega && (dias < 0
                                            ? <p className="fp-warnline">La fecha de entrega ({fmtDia(cab.FechaEntrega)}) ya pasó.</p>
                                            : <p className="fp-hint">{dias === 0 ? 'La entrega es hoy.' : `Faltan ${dias} día${dias === 1 ? '' : 's'} para la entrega.`} Si la fecha se puede cumplir con la carga de cada sector se ve en la solicitud, después de guardar.</p>)}
                                    </div>
                                </div>
                                <Campo label="Observaciones generales"><textarea className="short" value={cab.Observaciones} onChange={e => setCab(c => ({ ...c, Observaciones: e.target.value }))} /></Campo>
                            </div>
                        </Bloque>

                        {/* 2 · PAGO Y SEÑA (informativo) */}
                        <Bloque n={2} num={numDe(2)} activo={paso === 2} id="b-pago" titulo="Pago y seña" done={!faltan[2].length}>
                            <div className="fp-stack">
                                <Campo div label="Cómo se cobra">
                                    <Seg valor={pago.ModoCobro} onChange={v => setP({ ModoCobro: v })} opciones={[['PRECIO_ESTABLECIDO', 'Precio establecido (un total, todo incluido)'], ['POR_AREA', 'Facturar por cada área']]} />
                                </Campo>
                                {pago.ModoCobro === 'PRECIO_ESTABLECIDO' && (
                                    <div className="fp-fields two">
                                        <Campo label="Moneda"><select value={pago.MonIdMoneda} onChange={e => setP({ MonIdMoneda: Number(e.target.value) })}>{Object.entries(MONEDA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
                                        <Campo label="Total pactado *">
                                            <input type="number" min="0" step="0.01" value={pago.PrecioPactado} onChange={e => setP({ PrecioPactado: e.target.value, _auto: false })} placeholder="0" />
                                            {catalogoConPrecio && (
                                                <p className="fp-hint">Referencia de catálogo: {productos.map(x => `${x.Cantidad} × ${fmtMoneda(x._precio, x._moneda)}`).join(' + ')} = <b>{fmtMoneda(sugeridoCatalogo, monedaCatalogo)}</b>{pago._auto ? ' (cargado por defecto; si lo cambiás, queda el tuyo)' : ''}</p>
                                            )}
                                            {sugeridoCatalogo != null && Number(pago.PrecioPactado || 0) !== sugeridoCatalogo && (
                                                <button type="button" className="fp-link" onClick={() => setP({ PrecioPactado: String(sugeridoCatalogo), MonIdMoneda: (monedaCatalogo || '').toUpperCase() === 'USD' ? 2 : 1, _auto: true })}>Volver al precio de catálogo: {fmtMoneda(sugeridoCatalogo, monedaCatalogo)}</button>
                                            )}
                                        </Campo>
                                    </div>
                                )}
                                <Campo div label="¿Se le pide seña?">
                                    <Seg valor={pago.RequiereSena ? 'SI' : 'NO'} onChange={v => setP({ RequiereSena: v === 'SI', pagoSena: v === 'SI' ? pago.pagoSena : false })} opciones={[['SI', 'Sí, se pide seña'], ['NO', 'No se pide seña', pago.SenaConfirmada]]} />
                                </Campo>
                                {pago.RequiereSena && (
                                    <div className="fp-cfg">
                                        <div className="fp-stack">
                                            <div className={`fp-fields ${pago.ModoCobro === 'PRECIO_ESTABLECIDO' ? 'two' : 'three'}`}>
                                                {pago.ModoCobro !== 'PRECIO_ESTABLECIDO' && <Campo label="Moneda"><select value={pago.MonIdMoneda} onChange={e => setP({ MonIdMoneda: Number(e.target.value) })}>{Object.entries(MONEDA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>}
                                                <Campo label="Seña que se pide *"><input type="number" min="0" step="0.01" value={pago.SenaMontoRequerido} onChange={e => setP({ SenaMontoRequerido: e.target.value })} placeholder="0" /></Campo>
                                                <Campo div label="¿Pagó la seña?">
                                                    <Seg valor={pago.pagoSena ? 'SI' : 'NO'} onChange={v => setP({ pagoSena: v === 'SI' })} opciones={[['SI', 'Sí, pagó'], ['NO', 'Todavía no', pago.SenaConfirmada]]} />
                                                </Campo>
                                            </div>
                                            {pago.pagoSena && (
                                                <>
                                                    <div className="fp-fields two">
                                                        <Campo label="Monto pagado *"><input type="number" min="0" step="0.01" value={pago.SenaMonto} onChange={e => setP({ SenaMonto: e.target.value })} placeholder="0" /></Campo>
                                                        <Campo label="Fecha de la transferencia"><input type="date" value={pago.SenaFecha} onChange={e => setP({ SenaFecha: e.target.value })} /></Campo>
                                                        <Campo label="Vía de entrada *"><input type="text" value={pago.SenaVia} onChange={e => setP({ SenaVia: e.target.value })} placeholder="Transferencia BROU, efectivo en caja…" /></Campo>
                                                        <Campo label="Referencia del pago *"><input type="text" value={pago.SenaReferencia} onChange={e => setP({ SenaReferencia: e.target.value })} placeholder="Nº de transferencia o de recibo" /></Campo>
                                                    </div>
                                                    <label className={`fp-drop${arrastrando ? ' over' : ''}`}
                                                        onDragOver={e => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)}
                                                        onDrop={e => { e.preventDefault(); setArrastrando(false); agregarComprobantes(e.dataTransfer.files); }}>
                                                        <input type="file" accept={ACEPTA_COMPROBANTE} multiple onChange={e => { agregarComprobantes(e.target.files); e.target.value = ''; }} />
                                                        Subí el comprobante de la transferencia *
                                                        <small>Captura o PDF del banco. Tocá o arrastrá acá. Se sube al guardar.</small>
                                                    </label>
                                                    {(comprobantes.length > 0 || comprobantesGuardados.length > 0) && (
                                                        <div className="fp-files">
                                                            {comprobantesGuardados.map(a => <span key={a.ArchivoID} className="fp-file">{a.NombreOriginal}<small>ya subido</small></span>)}
                                                            {comprobantes.map((f, i) => (
                                                                <span key={`${f.name}-${i}`} className="fp-file">{f.name}<small>se sube al guardar</small>
                                                                    <button type="button" className="fp-link danger" style={{ marginLeft: 8 }} title="Quitar este comprobante" onClick={() => setComprobantes(cs => cs.filter((_, j) => j !== i))}>✕</button>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                            {pago.SenaConfirmada && <p className="fp-hint">La seña ya está registrada: se puede corregir, no borrar.</p>}
                                        </div>
                                    </div>
                                )}
                                {pago.ModoCobro === 'PRECIO_ESTABLECIDO' && num(pago.PrecioPactado) > 0 && (
                                    <div className="fp-saldo">
                                        <div className="cel"><small>Total pactado</small><b>{fmtPlata(pago.PrecioPactado, pago.MonIdMoneda)}</b></div>
                                        <div className="cel"><small>Seña pagada</small><b>{fmtPlata(pago.pagoSena ? pago.SenaMonto : 0, pago.MonIdMoneda)}</b></div>
                                        <div className="cel resta"><small>Resta cobrar</small><b>{fmtPlata(restante, pago.MonIdMoneda)}</b></div>
                                    </div>
                                )}
                            </div>
                        </Bloque>

                        {/* 3 · PRODUCTO */}
                        <Bloque n={3} num={numDe(3)} activo={paso === 3} id="b-producto" titulo="Producto" sub={subProd} done={!faltan[3].length} why="Qué se fabrica y cuántas unidades. Cada producto termina en su propio pedido de producción.">
                            <div className="fp-tabs" role="group" aria-label="Modalidad de la solicitud">
                                {Object.entries(MODALIDAD).map(([v, t]) => <button type="button" key={v} className="fp-tab" aria-pressed={modalidad === v} onClick={() => cambiarModalidad(v)}>{t}</button>)}
                            </div>
                            {!modalidad && (
                                <p className="fp-note warn" style={{ marginBottom: 14 }}>{mezclada
                                    ? 'Esta solicitud se cargó antes de esta regla y tiene productos de las dos modalidades. Se puede guardar así. Si elegís una modalidad arriba, pasa a todos los productos.'
                                    : 'Elegí primero la modalidad. Todos los productos de la solicitud van a ser de la misma: no se mezclan productos del catálogo con productos del cliente.'}</p>
                            )}
                            {modalidad && <p className="fp-hint" style={{ margin: '0 0 14px' }}>{modalidad === 'PRODUCTO_TERMINADO' ? 'Del catálogo: cada producto trae sus servicios incluidos.' : 'Del cliente: una prenda que no está en el catálogo. La sublimación y todos los servicios se eligen a mano.'} Todos los productos de la solicitud son de esta modalidad.</p>}
                            {(modalidad || mezclada) && (
                                <div className="fp-tabs" role="group" aria-label="Productos de la solicitud">
                                    {productos.map((x, i) => (
                                        <span key={x._k} className="fp-tabw">
                                            <button type="button" className="fp-tab" aria-pressed={i === iSel} onClick={() => setSel(i)}>{x.convertido && <Lock size={12} />} {nombreProd(x, i)}</button>
                                            {productos.length > 1 && !x.convertido && <button type="button" className={`fp-tabx${i === iSel ? ' on' : ''}`} title={`Quitar "${nombreProd(x, i)}" de la solicitud`} aria-label={`Quitar "${nombreProd(x, i)}" de la solicitud`} onClick={() => quitarProducto(x, i)}>✕</button>}
                                        </span>
                                    ))}
                                    <button type="button" className="fp-tab add" onClick={agregarProducto}><Plus size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> Agregar otro producto</button>
                                </div>
                            )}
                            {p.convertido && <p className="fp-note" style={{ marginBottom: 14 }}><Lock size={13} style={{ display: 'inline', verticalAlign: '-2px' }} /> Este producto ya es un pedido de producción: no se edita.</p>}
                            <fieldset disabled={p.convertido || !(modalidad || mezclada)}>
                                <div className="fp-stack">
                                    {p.TipoFabricacion === 'PRODUCTO_TERMINADO' && (
                                        <>
                                            <Campo div label="Familia *">
                                                <div className="fp-seg" role="group">
                                                    {familias.map(fa => <button type="button" key={fa} aria-pressed={famDe(p) === fa} onClick={() => cambiarProducto(p._k, { _familia: fa, _etiqueta: '' })}>{fa}</button>)}
                                                </div>
                                            </Campo>
                                            {!catalogo.length && <p className="fp-warnline">No se pudo leer el catálogo de productos.</p>}
                                            {famDe(p) && etiquetasDe(famDe(p)).hay && (
                                                <Campo div label="Para qué es">
                                                    <div className="fp-seg" role="group">
                                                        <button type="button" aria-pressed={!etqDe(p)} onClick={() => cambiarProducto(p._k, { _etiqueta: '' })}>Todas</button>
                                                        {etiquetasDe(famDe(p)).lista.map(et => <button type="button" key={et} aria-pressed={etqDe(p) === et} onClick={() => cambiarProducto(p._k, { _etiqueta: et })}>{et}</button>)}
                                                        {etiquetasDe(famDe(p)).conSin && <button type="button" aria-pressed={etqDe(p) === SIN_ETQ} onClick={() => cambiarProducto(p._k, { _etiqueta: SIN_ETQ })}>Sin etiqueta</button>}
                                                    </div>
                                                </Campo>
                                            )}
                                            {famDe(p) && (
                                                <Campo div label="Producto a fabricar *">
                                                    <div className="fp-prods">
                                                        {productosDe(famDe(p), etqDe(p)).map(x => (
                                                            <button type="button" key={x.ProIdProducto} className="fp-prod" aria-pressed={String(p.ProIdProducto) === String(x.ProIdProducto)} onClick={() => elegirProducto(p, x.ProIdProducto)}>
                                                                {imgSrc(x) ? <img className="fp-prod-img" src={imgSrc(x)} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <div className="fp-prod-noimg" aria-hidden="true">👕</div>}
                                                                {x.Etiqueta && <span className="fp-prod-tag">{x.Etiqueta}</span>}
                                                                {x.TecnicaPrincipal && x.TecnicaPrincipal !== 'SB' && <span className="fp-prod-tag" title="Área que produce este producto">{({ DIRECTA: 'Imp. directa', ECOUV: 'Gran formato' })[x.TecnicaPrincipal] || x.TecnicaPrincipal}</span>}
                                                                <b>{x.Descripcion}</b><small>{x.CodArticulo}{x.Estado === 'PUBLICADO' ? ' · publicado' : ''}</small>
                                                            </button>
                                                        ))}
                                                        {productosDe(famDe(p), etqDe(p)).length === 0 && <p className="fp-hint">No hay productos con ese filtro.</p>}
                                                    </div>
                                                </Campo>
                                            )}
                                            {p.ProIdProducto ? <p className="fp-okline">Elegido: {p.ProductoNombre}{famDe(p) ? ` (${famDe(p)}${etqDe(p) && etqDe(p) !== SIN_ETQ ? ' › ' + etqDe(p) : ''})` : ''}{p._precio != null ? ` · precio de catálogo ${fmtMoneda(p._precio, p._moneda)} por unidad` : ' · sin precio de catálogo'}</p> : famDe(p) && <p className="fp-hint">Tocá una tarjeta para elegir el producto.</p>}
                                        </>
                                    )}
                                    {p.TipoFabricacion === 'PERSONALIZADO' && (
                                        <>
                                            <Campo div label="Familia *">
                                                <div className="fp-seg" role="group">
                                                    {familias.map(fa => <button type="button" key={fa} aria-pressed={!esOtra(p) && d.tipoTrabajo === fa} onClick={() => cambiarProducto(p._k, conReferencia(p, fa, { _otra: false }, { tipoTrabajo: fa }))}>{fa}</button>)}
                                                    <button type="button" aria-pressed={esOtra(p)} onClick={() => { const t = familias.includes(d.tipoTrabajo) ? '' : (d.tipoTrabajo || ''); cambiarProducto(p._k, conReferencia(p, t, { _otra: true }, { tipoTrabajo: t })); }}>Otra</button>
                                                </div>
                                            </Campo>
                                            {esOtra(p) && <Campo label="¿Cuál? *"><input type="text" value={d.tipoTrabajo || ''} onChange={e => cambiarProducto(p._k, conReferencia(p, e.target.value, {}, { tipoTrabajo: e.target.value }))} placeholder="Ej: Toalla, Mantel, Bolsa" /></Campo>}
                                        </>
                                    )}
                                    <div className="fp-fields two">
                                        {p.TipoFabricacion !== 'PRODUCTO_TERMINADO' && <Campo label="Referencia"><input type="text" value={d.referencia || ''} onChange={e => cambiarProducto(p._k, { _refAuto: false, Datos: { ...d, referencia: e.target.value } })} placeholder="Ej: Camiseta titular, Short suplente" /></Campo>}
                                        <Campo label="Cantidad total de unidades *">
                                            <input type="number" min={p._fija || p._min || 1} step={p._fija || 1} value={p.Cantidad} onChange={e => cambiarProducto(p._k, { Cantidad: e.target.value })} />
                                            {p._fija > 0 && <small className="fp-hint">Se vende en paquetes de {p._fija}: la cantidad tiene que ser múltiplo de {p._fija}.</small>}
                                            {!p._fija && p._min > 0 && <small className="fp-hint">Mínimo {p._min} unidades.</small>}
                                        </Campo>
                                    </div>
                                    {/* [ACCESORIOS] artículos de stock que salen con el producto (configurador › Accesorios y estructura) */}
                                    {p.TipoFabricacion === 'PRODUCTO_TERMINADO' && (d.accesorios || []).length > 0 && (
                                        <Campo div label="Accesorios de stock que salen con el producto" ayuda="Se retiran del WMS y Producción los recibe antes de que el pedido pase a Depósito. La cantidad sale de las unidades del producto.">
                                            {d.accesorios.map((a, ai) => {
                                                const setA = (patch) => cambiarDato(p._k, { accesorios: d.accesorios.map((x, j) => j === ai ? { ...x, ...patch } : x) });
                                                const total = (Number(a.cantidadPorUnidad) || 1) * (Number(p.Cantidad) || 0);
                                                const va = a.incluir !== false;
                                                return (
                                                    <div key={ai} className="fp-checkrow" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                                        {a.obligatorio
                                                            ? <span><b>{a.nombre}</b> <small className="fp-hint">siempre va</small></span>
                                                            : <Tilde checked={va} onChange={v => setA({ incluir: v })}>{a.nombre}</Tilde>}
                                                        <small className="fp-hint">{a.cantidadPorUnidad} por unidad → <b>{total}</b> en total · {a.cobro === 'APARTE' ? 'se cobra aparte' : 'incluido en el precio'}</small>
                                                        {va && (a.fijo
                                                            ? (a.unica ? null : <small className="fp-hint">· {a.varianteNombre}</small>)
                                                            : (a.variantes || []).length
                                                                ? <select value={a.wmsVarianteId || ''} onChange={e => { const v = (a.variantes || []).find(x => x.wms_variante_id === Number(e.target.value)); setA({ wmsVarianteId: e.target.value ? Number(e.target.value) : '', varianteNombre: v?.nombre_variante || '' }); }}>
                                                                    <option value="">Elegí talle/color…</option>
                                                                    {a.variantes.map(v => <option key={v.wms_variante_id} value={v.wms_variante_id}>{v.nombre_variante}</option>)}
                                                                </select>
                                                                : <small className="fp-hint" style={{ color: '#b45309' }}>Sin variantes de WMS: vinculá el artículo al WMS en Marketing › Productos.</small>)}
                                                    </div>
                                                );
                                            })}
                                        </Campo>
                                    )}
                                    <Campo div label="Se produce a partir de">
                                        <Seg valor={d.muestraFisica ? 'MUESTRA' : 'BOCETO'} onChange={v => cambiarDato(p._k, { muestraFisica: v === 'MUESTRA' })} opciones={[['BOCETO', 'Boceto digital'], ['MUESTRA', 'Muestra física']]} />
                                    </Campo>
                                    <div className="fp-checkrow">
                                        {p.TipoFabricacion !== 'PRODUCTO_TERMINADO' && <Tilde checked={d.productoNuevo} onChange={v => cambiarDato(p._k, { productoNuevo: v, ...(v ? { requiereMuestra: true } : {}) })}>Producto nuevo</Tilde>}
                                        <Tilde checked={d.produccionGrande} onChange={v => cambiarDato(p._k, { produccionGrande: v, ...(v ? { requiereMuestra: true } : {}) })}>Producción grande</Tilde>
                                        <Tilde checked={d.requiereMuestra} onChange={v => cambiarDato(p._k, { requiereMuestra: v, muestraAprobada: v ? d.muestraAprobada : false })}>Requiere confección de muestra</Tilde>
                                        {esEdicion && d.requiereMuestra && <Tilde checked={d.muestraAprobada} onChange={v => cambiarDato(p._k, { muestraAprobada: v })}>Muestra aprobada por el cliente</Tilde>}
                                    </div>
                                {esEdicion && d.productoNuevo && (
                                    <>
                                        <div className="fp-cfg">
                                            <div className="fp-cfg-head"><h3>Especificaciones técnicas · {nombreProd(p, iSel)}</h3><small>Producto nuevo</small></div>
                                            <div className="fp-stack">
                                                <div className="fp-fields two">
                                                    <Campo label="Costuras y en qué parte va cada una *"><textarea className="short" value={d.espec.costuras} onChange={e => cambiarDatos(p._k, 'espec', { costuras: e.target.value })} /></Campo>
                                                    <Campo label="Terminaciones *"><textarea className="short" value={d.espec.terminaciones} onChange={e => cambiarDatos(p._k, 'espec', { terminaciones: e.target.value })} /></Campo>
                                                    <Campo label="Avíos y accesorios (medida, color y cantidad) *"><textarea className="short" value={d.espec.avios} onChange={e => cambiarDatos(p._k, 'espec', { avios: e.target.value })} /></Campo>
                                                    <Campo label="Tela e insumos (tipo, composición, gramaje y color) *"><textarea className="short" value={d.espec.tela} onChange={e => cambiarDatos(p._k, 'espec', { tela: e.target.value })} /></Campo>
                                                </div>
                                                <Campo div label="El material lo provee *">
                                                    <Seg valor={d.espec.provee} onChange={v => cambiarDatos(p._k, 'espec', { provee: v })} opciones={[['TALLER', 'El taller'], ['CLIENTE', 'El cliente']]} />
                                                </Campo>
                                            </div>
                                        </div>
                                    </>
                                )}
                                    <Campo div label="Quién aporta el diseño">
                                        <Seg valor={d.diseno.origen} onChange={v => cambiarDatos(p._k, 'diseno', { origen: v })} opciones={[['CLIENTE', 'Lo entrega el cliente'], ['TALLER', 'Lo hace el taller']]} />
                                    </Campo>
                                    {esEdicion && d.diseno.origen === 'CLIENTE' && <Tilde checked={d.diseno.verificado} onChange={v => cambiarDatos(p._k, 'diseno', { verificado: v })}>Archivo de diseño recibido y verificado</Tilde>}
                                    {esEdicion && d.diseno.origen === 'TALLER' && <Tilde checked={d.diseno.aprobado} onChange={v => cambiarDatos(p._k, 'diseno', { aprobado: v })}>Propuesta aprobada por escrito por el cliente</Tilde>}
                                    <Campo label="Indicaciones para Diseño"><textarea className="short" value={p.Principal.Observaciones} onChange={e => cambiarProducto(p._k, { Principal: { ...p.Principal, Observaciones: e.target.value } })} /></Campo>
                                    <Campo label="Observaciones del producto"><textarea className="short" value={p.Observaciones} onChange={e => cambiarProducto(p._k, { Observaciones: e.target.value })} /></Campo>
                                </div>
                            </fieldset>
                        </Bloque>

                        {/* 7 · EXTRAS */}
                        <Bloque n={7} num={numDe(7)} activo={paso === 7} id="b-extras" titulo="Servicios y extras" sub={subProd} done={!faltan[7].length}>
                            <fieldset disabled={p.convertido}>
                                <div className="fp-stack">
                                    {/* Extras en pestañas: los agregados (con ✕ para quitar; candado si vienen con el producto) y "+" para agregar */}
                                    <div className="fp-tabs" role="group" aria-label="Extras del producto">
                                        {ADICIONALES.filter(t => p.Partes[t]).map(t => (
                                            <span key={t} className="fp-tabw">
                                                <button type="button" className="fp-tab fp-extra si" aria-pressed={extraVis === t} onClick={() => setExtraSel(t)}><span className="marca">{p.obligatorios.includes(t) ? <Lock size={12} /> : '✓'}</span><span>{NOMBRE_PARTE[t]}<small>{p.obligatorios.includes(t) ? 'lleva' : 'agregado'}{p.cobros?.[AREA_DE[t]] === 'INCLUIDA' ? ' · incluido en el precio' : p.cobros?.[AREA_DE[t]] === 'APARTE' ? ' · se cobra aparte' : ''}</small></span></button>
                                                {!p.obligatorios.includes(t) && <button type="button" className={`fp-tabx${extraVis === t ? ' on' : ''}`} title={`Quitar ${NOMBRE_PARTE[t]}`} aria-label={`Quitar ${NOMBRE_PARTE[t]}`} onClick={() => alternarServicio(p, t)}>✕</button>}
                                            </span>
                                        ))}
                                        {ADICIONALES.filter(t => !p.Partes[t] && (!p.permitidos || p.permitidos.includes(t))).map(t => (
                                            <button type="button" key={t} className="fp-tab fp-extra no" title={`Agregar ${NOMBRE_PARTE[t]}`} onClick={() => { alternarServicio(p, t); setExtraSel(t); }}><span className="marca"><Plus size={14} /></span><span>{NOMBRE_PARTE[t]}<small>no lleva</small></span></button>
                                        ))}
                                    </div>
                                    {p.permitidos && p.permitidos.length === 0 && <p className="fp-hint">El producto elegido no admite extras.</p>}
                                    {!hayExtras && <p className="fp-okline">No lleva extras.</p>}

                                    {ADICIONALES.filter(t => p.Partes[t] && t === extraVis).map(t => {
                                        const pa = p.Partes[t];
                                        const dd = pa.Datos || {};
                                        const materiales = t === 'DTF' ? nomen.dtfMateriales : (nomen.materiales[`${AREA_DE[t]}|${dd.variante}`] || []);
                                        return (
                                            <div key={t} className="fp-cfg">
                                                <div className="fp-cfg-head"><h3>{NOMBRE_PARTE[t]}{p.obligatorios.includes(t) ? <small> · incluido en el producto</small> : null}</h3><EstadoParte e={pa.Estado} /></div>
                                                <div className="fp-stack">
                                                    {pa.Estado !== 'INGRESADO' && <p className="fp-warnline">Ya está en Diseño: si cambiás algo, queda señalado como "Modificada" y el diseñador tiene que aceptar el cambio.</p>}
                                                    <div className="fp-fields three">
                                                        <Campo label="Cantidad total"><input type="number" min="1" value={pa.CantidadTotal} onChange={e => cambiarParte(p._k, t, { CantidadTotal: e.target.value })} /></Campo>
                                                        <Campo label={t === 'BORDADO' ? 'Bordados por prenda' : 'Estampados por prenda'}><input type="number" min="1" value={pa.PorPrenda} onChange={e => cambiarParte(p._k, t, { PorPrenda: e.target.value })} /></Campo>
                                                        <Campo label="Dónde va (ubicación en la prenda)"><input type="text" value={pa.Ubicacion} onChange={e => cambiarParte(p._k, t, { Ubicacion: e.target.value })} placeholder="Ej: pecho izquierdo 8 cm" /></Campo>
                                                    </div>
                                                    {t === 'DTF' && (<Campo div label="El arte">
                                                        <Seg valor={pa.ArteOrigen} onChange={v => cambiarParte(p._k, t, { ArteOrigen: v })} opciones={[['EMPRESA', 'Se diseña en la empresa (pasa por Diseño)'], ['CLIENTE', 'Viene listo del cliente']]} />
                                                    </Campo>)}
                                                    <div className="fp-fields three">
                                                        {t !== 'DTF' && (
                                                            <Campo label={t === 'BORDADO' ? 'Dónde se borda (sobre la prenda / parche adhesivo)' : 'Tipo / variante'} ayuda="Se exige al convertir a pedido">
                                                                <select value={dd.variante || ''} onChange={e => { cambiarDatosParte(p._k, t, { variante: e.target.value, material: '' }); cargarMateriales(AREA_DE[t], e.target.value); }}>
                                                                    <option value="">Sin definir todavía</option>
                                                                    {(t === 'BORDADO' ? nomen.embVariantes : nomen.tpuVariantes).map(v => <option key={v}>{v}</option>)}
                                                                </select>
                                                            </Campo>
                                                        )}
                                                        <Campo label={t === 'BORDADO' ? 'Tipo de bordado (100% hilo / con tafeta)' : t === 'DTF' ? 'Film / material' : 'Artículo de TPU (tipo y tamaño del parche)'} ayuda={t !== 'DTF' && !dd.variante ? 'Primero elegí el campo de la izquierda' : 'Se exige al convertir a pedido'}>
                                                            <select value={dd.material || ''} onChange={e => cambiarDatosParte(p._k, t, { material: e.target.value })} disabled={t !== 'DTF' && !dd.variante}>
                                                                <option value="">Sin definir todavía</option>
                                                                {dd.material && !materiales.includes(dd.material) && <option>{dd.material}</option>}
                                                                {materiales.map(m => <option key={m}>{m}</option>)}
                                                            </select>
                                                        </Campo>
                                                    </div>
                                                    <Campo label="Indicaciones para Diseño"><textarea className="short" value={pa.Observaciones} onChange={e => cambiarParte(p._k, t, { Observaciones: e.target.value })} /></Campo>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </fieldset>
                        </Bloque>

                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <span style={{ display: 'flex', gap: 8 }}>
                                <button type="button" className="fp-btn" disabled={iPaso === 0} onClick={() => irA(bloquesVis[iPaso - 1]?.id)}>← Anterior</button>
                                <button type="button" className="fp-btn primary" disabled={iPaso === bloquesVis.length - 1} onClick={() => irA(bloquesVis[iPaso + 1]?.id)}>{iPaso < bloquesVis.length - 1 ? `Siguiente: ${bloquesVis[iPaso + 1].corto} →` : 'Siguiente →'}</button>
                            </span>
                            <button type="button" onClick={guardar} disabled={guardando} className="fp-btn accent">{guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {textoGuardar}</button>
                        </div>
                    </main>

                    {/* PANEL: Estado del pedido */}
                    <aside id="fp-estado">
                        <div className="fp-panel">
                            <h3>Estado del pedido</h3>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <span>{listos === bloquesVis.length ? 'Todo completo' : `${listos} de ${bloquesVis.length} listos`}</span>
                                <span className={`fp-sello ${sello ? 'si' : 'no'}`}>{sello ? 'Listo para ingresar' : 'Falta info'}</span>
                            </div>
                            <div className="fp-meter"><i style={{ width: `${(listos / bloquesVis.length) * 100}%` }} /></div>
                            <ul className="fp-checks">
                                {bloquesVis.map((b, bi) => {
                                    const ok = faltan[b.n].length === 0;
                                    return (
                                        <li key={b.n} className={ok ? 'ok' : 'falta'}>
                                            <button type="button" onClick={() => irA(b.id)}>
                                                <span className="fp-dot">{ok ? '✓' : bi + 1}</span>
                                                <span><b>{b.titulo}</b><small>{subDe(b)}</small></span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                            {despues.length > 0 && (
                                <div className="fp-despues">
                                    <b>{esEdicion ? 'En la solicitud' : 'Después de guardar'}</b> <small>(se cumplen en la solicitud: archivos, piezas y telas, planilla de talles y nombres)</small>
                                    <ul>{despues.map(x => <li key={x}>{x}</li>)}</ul>
                                </div>
                            )}
                            {luego.length > 0 && <div className="fp-luego">Se puede completar después, no frena: {luego.join(' · ')}</div>}
                            <button type="button" onClick={guardar} disabled={guardando} className="fp-btn accent">{guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {textoGuardar}</button>
                        </div>
                        <p className="fp-saved">Se puede guardar incompleto. El sello "Falta info" queda en la solicitud hasta que esté todo lo necesario para producción; el pago y los extras se exigen recién al convertir a pedido.</p>
                    </aside>
                </div>
            </div>
            <div className="fp-mbar"><span>{listos === bloquesVis.length ? 'Todo completo' : `${listos} de ${bloquesVis.length} listos`}</span><a href="#fp-estado" onClick={e => { e.preventDefault(); irA('fp-estado'); }}>Ver qué falta</a></div>
        </div>
    );
}
