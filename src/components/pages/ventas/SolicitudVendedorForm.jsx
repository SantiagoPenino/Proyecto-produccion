import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ClipboardList, Loader2, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { RESPUESTA_MUESTRA, datosProductoVacios, evaluarProducto, fichaVacia } from './checklistSolicitud';
import api from '../../../services/apiClient';
import { useAuth } from '../../../context/AuthContext';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { BTN_PRIMARIO, BTN_SECUNDARIO, BuscadorCliente, BuscadorPresupuesto, Campo, Checklist, ESTADO_PARTE, INPUT, NOMBRE_PARTE, Pill, errorDe } from './solicitudesComunes';

/**
 * Spec 41 — Alta y edición de una Solicitud (RN-SOL.05 a RN-SOL.11).
 * Al INGRESAR solo se exige lo que el cliente puede dar (qué quiere, cuánto, dónde). Los datos
 * técnicos de cada servicio se pueden completar después: recién se exigen al convertir a pedido.
 * Editar una parte que ya está en Diseño la deja señalada como "Modificada" (RN-SOL.20b).
 */
const ADICIONALES = ['BORDADO', 'DTF', 'TPU'];
const AREA_DE = { BORDADO: 'EMB', DTF: 'DF', TPU: 'TPU' };   // área del Configurador de Productos
const VARIANTE_DTF = 'DTF Textil';                          // fija, igual que en el ingreso de pedidos de prenda
const TIPOS_MOLDE = ['SUBLIMACION', 'MOLDES CLIENTES'];
const ORIGENES_TELA = ['TELA SUBLIMADA EN USER', 'TELA CLIENTE', 'TELA STOCK USER'];
const ORIGENES_PRENDA = ['Prendas del Cliente', 'Stock User'];

let seq = 0;
const productoVacio = () => ({
    _k: `n${++seq}`, ProductoSolID: null, TipoFabricacion: 'PERSONALIZADO', ProIdProducto: '', ProductoNombre: '', Cantidad: '', Observaciones: '',
    Datos: datosProductoVacios(),
    Principal: { Observaciones: '', Estado: 'INGRESADO' },
    Partes: {}, permitidos: null, obligatorios: [], convertido: false,
});
const parteVacia = (incluido = false) => ({ IncluidoEnProducto: incluido, CantidadTotal: '', PorPrenda: '', Ubicacion: '', ArteOrigen: 'EMPRESA', Observaciones: '', Datos: {}, Estado: 'INGRESADO' });
const opciones = (lista, campo) => [...new Set((lista || []).map(x => String(x[campo] || '').trim()).filter(Boolean))];

// Piezas de layout (fuera del componente: si se definieran adentro, React las recrearía en cada tecla y los inputs perderían el foco)
const Seccion = ({ titulo, ayuda, children }) => (
    <fieldset className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 min-w-0">
        <legend className="px-1 text-[11px] font-black uppercase tracking-wide text-slate-600">{titulo}</legend>
        {ayuda && <p className="text-[11px] text-slate-500 -mt-1">{ayuda}</p>}
        {children}
    </fieldset>
);
const Tilde = ({ checked, onChange, children, disabled }) => (
    <label className={`flex items-start gap-2 text-xs ${disabled ? 'text-slate-400' : 'text-slate-700'}`}><input type="checkbox" className="mt-0.5" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span>{children}</span></label>
);
const Opcion = ({ activo, onClick, children }) => (
    <button type="button" onClick={onClick} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${activo ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{children}</button>
);


export default function SolicitudVendedorForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const esEdicion = !!id;

    const [cargando, setCargando] = useState(esEdicion);
    const [guardando, setGuardando] = useState(false);
    const [cliente, setCliente] = useState(null);
    const [presupuesto, setPresupuesto] = useState(null);
    const [cab, setCab] = useState({ NombreTrabajo: '', VendedorID: user?.id || '', Detalle: '', Observaciones: '', FechaEntrega: '', FechaEntregaHasta: '', Ficha: fichaVacia() });
    const [archivosGuardados, setArchivosGuardados] = useState([]);   // en edición: para que el checklist vea los adjuntos
    const [productos, setProductos] = useState([productoVacio()]);
    const [vendedores, setVendedores] = useState([]);
    const [catalogo, setCatalogo] = useState([]);
    const [nomen, setNomen] = useState({ embVariantes: [], tpuVariantes: [], dtfMateriales: [], materiales: {} });

    // Catálogos: vendedores, productos terminados (grupo 2.1 = prendas) y nomencladores de decoración
    useEffect(() => {
        svc.vendedores().then(setVendedores).catch(() => setVendedores([]));
        api.get('/prendas-orders/productos-terminados', { params: { grupo: '2.1' } }).then(r => setCatalogo(r.data?.data || [])).catch(() => setCatalogo([]));
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
            setProductos(ps => ps.map(p => {
                if (p._k !== k) return p;
                const partes = { ...p.Partes };
                if (alElegir) {
                    ADICIONALES.forEach(t => { if (!permitidos.includes(t) && partes[t]?.Estado === 'INGRESADO') delete partes[t]; });
                    obligatorios.forEach(t => { partes[t] = { ...(partes[t] || parteVacia()), IncluidoEnProducto: true }; });
                }
                return { ...p, permitidos, obligatorios, Partes: partes };
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
                setCab({ NombreTrabajo: s.NombreTrabajo, VendedorID: s.VendedorID, Detalle: s.Detalle, Observaciones: s.Observaciones || '', FechaEntrega: fecha(s.FechaEntrega), FechaEntregaHasta: fecha(s.FechaEntregaHasta), Ficha: { ...fichaVacia(), ...(s.Ficha || {}), muestra: { ...fichaVacia().muestra, ...(s.Ficha?.muestra || {}) } } });
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

    const elegirTipo = (p, tipo) => {
        if (tipo === p.TipoFabricacion) return;
        cambiarProducto(p._k, { TipoFabricacion: tipo, ProIdProducto: '', ProductoNombre: '', permitidos: null, obligatorios: [] });
    };
    const elegirProducto = (p, proId) => {
        const art = catalogo.find(a => String(a.ProIdProducto) === String(proId));
        cambiarProducto(p._k, { ProIdProducto: proId, ProductoNombre: art?.Descripcion || '' });
        cargarServiciosProducto(p._k, proId, true);
    };

    const guardar = async () => {
        if (!cliente) return toast.warning('Elegí el cliente de la solicitud.');
        if (!cab.NombreTrabajo.trim()) return toast.warning('Ingresá el nombre del trabajo.');
        if (!cab.Detalle.trim()) return toast.warning('Escribí el detalle de la solicitud (qué pide el cliente).');
        for (let i = 0; i < productos.length; i++) {
            const p = productos[i];
            if (p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !p.ProIdProducto) return toast.warning(`Producto ${i + 1}: elegí el producto terminado del catálogo.`);
            if (!(Number(p.Cantidad) > 0)) return toast.warning(`Producto ${i + 1}: ingresá la cantidad de prendas.`);
            if (p.Datos.costura.activo && !p.Datos.corte.activo) return toast.warning(`Producto ${i + 1}: Costura requiere Corte.`);
        }
        if (cab.FechaEntregaHasta && cab.FechaEntrega && cab.FechaEntregaHasta < cab.FechaEntrega) return toast.warning('La fecha "hasta" no puede ser anterior a la fecha que necesita el cliente.');
        const payload = {
            CodCliente: cliente.CodCliente, PreId: presupuesto?.PreId || null, ...cab, FechaEntrega: cab.FechaEntrega || null, FechaEntregaHasta: cab.FechaEntregaHasta || null,
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
                toast.success(r.cambios ? 'Cambios guardados. Lo que ya estaba en Diseño quedó señalado como "Modificada".' : 'No había cambios para guardar.');
                navigate(`/ventas/solicitudes/${id}`);
            } else {
                const r = await svc.crear(payload);
                toast.success(`Solicitud #${r.SolicitudID} ingresada. Ahora podés adjuntar archivos y enviar a Diseño.`);
                navigate(`/ventas/solicitudes/${r.SolicitudID}`);
            }
        } catch (e) { toast.error(errorDe(e)); }
        finally { setGuardando(false); }
    };


    if (cargando) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-indigo-500" /></div>;

    // Checklist en vivo (misma lectura que la maqueta): se recalcula mientras se escribe.
    const cabChk = { NombreTrabajo: cab.NombreTrabajo, VendedorID: cab.VendedorID, FechaEntrega: cab.FechaEntrega, Ficha: cab.Ficha };
    const checks = productos.map(p => (p.convertido ? null : evaluarProducto(cabChk, p, archivosGuardados)));
    const chTotal = {
        listo: checks.every(c => !c || c.listo),
        faltan: checks.flatMap((c, i) => (c ? c.faltan.map(x => (productos.length > 1 ? `Producto ${i + 1}: ${x}` : x)) : [])),
        ok: checks.flatMap((c, i) => (c ? c.ok.map(x => (productos.length > 1 ? `Producto ${i + 1}: ${x}` : x)) : [])),
        luego: [...new Set(checks.flatMap(c => (c ? c.luego : [])))],
    };
    if (!esEdicion) chTotal.luego.unshift('Bocetos, lista de talles y demás archivos: se adjuntan desde la solicitud, después de guardar');

    return (
        <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-xl font-black text-slate-800 flex items-center gap-2"><ClipboardList size={22} className="text-indigo-500" /> {esEdicion ? `Editar solicitud #${id}` : 'Nueva solicitud'}</h1>
                <button onClick={() => navigate(esEdicion ? `/ventas/solicitudes/${id}` : '/ventas/solicitudes')} className={BTN_SECUNDARIO}><ArrowLeft size={14} /> Volver sin guardar</button>
            </div>

            {/* El recuadro de arriba, como en la maqueta: se actualiza mientras escribís y dice qué falta. */}
            <div className="sticky top-2 z-10">
                <Checklist ch={chTotal} compacto titulo={chTotal.listo ? 'Tiene todo para entrar a producción. Podés guardar igual si te falta algo: el pedido queda con su sello y lo completás después.' : 'Completá lo que tengas y guardá: no hace falta tener todo. Lo rojo es lo que frena el ingreso a producción.'} />
            </div>

            <Seccion titulo="Identificación">
                <Campo label="Cliente *"><BuscadorCliente cliente={cliente} onPick={setCliente} /></Campo>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Campo label="Nombre del pedido *" ayuda="Es como lo vas a buscar después. Cuanto más reconocible, mejor."><input value={cab.NombreTrabajo} onChange={e => setCab(c => ({ ...c, NombreTrabajo: e.target.value }))} placeholder="Ej: Buzos egresados 3ºB" className={INPUT} /></Campo>
                    <Campo label="Vendedor *">
                        <select value={cab.VendedorID} onChange={e => setCab(c => ({ ...c, VendedorID: e.target.value }))} className={INPUT}>
                            {!vendedores.some(v => String(v.IdUsuario) === String(cab.VendedorID)) && <option value={cab.VendedorID}>{user?.nombre || 'Yo'}</option>}
                            {vendedores.map(v => <option key={v.IdUsuario} value={v.IdUsuario}>{v.Nombre}</option>)}
                        </select>
                    </Campo>
                </div>
                <Campo label="Presupuesto del que salió (opcional)" ayuda="Solo deja la referencia: no copia el precio. El precio pactado se carga en la solicitud, después de guardar."><BuscadorPresupuesto presupuesto={presupuesto} onPick={setPresupuesto} clienteNombre={cliente?.Nombre} /></Campo>
                <Campo label="Detalle de la solicitud * (qué pide el cliente)"><textarea rows={3} value={cab.Detalle} onChange={e => setCab(c => ({ ...c, Detalle: e.target.value }))} className={INPUT} /></Campo>
                <Campo label="Observaciones generales"><textarea rows={2} value={cab.Observaciones} onChange={e => setCab(c => ({ ...c, Observaciones: e.target.value }))} className={INPUT} /></Campo>
            </Seccion>

            <Seccion titulo="Dónde se cose" ayuda="Nuestro taller o un taller externo. El sector donde está el pedido y su estado salen solos de producción una vez convertido.">
                <div className="flex flex-wrap items-center gap-2">
                    <Opcion activo={cab.Ficha.dondeSeCose !== 'EXTERNO'} onClick={() => setFicha({ dondeSeCose: 'TALLER' })}>Nuestro taller</Opcion>
                    <Opcion activo={cab.Ficha.dondeSeCose === 'EXTERNO'} onClick={() => setFicha({ dondeSeCose: 'EXTERNO' })}>Taller externo</Opcion>
                    {cab.Ficha.dondeSeCose === 'EXTERNO' && <input value={cab.Ficha.tallerExterno} onChange={e => setFicha({ tallerExterno: e.target.value })} placeholder="Qué taller externo" className={`${INPUT} md:w-72`} />}
                </div>
            </Seccion>

            {productos.map((p, i) => {
                const d = p.Datos;
                const porMedida = d.comoSeDefine === 'MEDIDA';
                return (
                <div key={p._k} className="space-y-4">
                    <div className="flex items-center justify-between gap-2 px-1">
                        <h2 className="text-sm font-black text-slate-800">Qué se produce{productos.length > 1 ? ` · producto ${i + 1}` : ''} <span className="text-[11px] font-bold text-slate-400">· cada producto termina en su propio pedido</span></h2>
                        {p.convertido
                            ? <span className="text-[10px] font-black uppercase text-emerald-700 flex items-center gap-1"><Lock size={12} /> Ya convertido en pedido — no se edita</span>
                            : productos.length > 1 && <button onClick={() => { if (window.confirm(`¿Quitar el producto ${i + 1} de la solicitud? Sus servicios salen de Diseño.`)) setProductos(ps => ps.filter(x => x._k !== p._k)); }} className="text-xs font-bold text-rose-600 hover:underline inline-flex items-center gap-1"><Trash2 size={12} /> Quitar producto</button>}
                    </div>

                    <fieldset disabled={p.convertido} className="space-y-4">
                    <Seccion titulo="Qué se produce">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {[['PRODUCTO_TERMINADO', 'Producto terminado', 'Del catálogo — trae sus servicios incluidos'], ['PERSONALIZADO', 'Producto personalizado (cliente)', 'Libre — sublimación y todos los servicios a mano']].map(([v, t, dd]) => (
                                <button type="button" key={v} onClick={() => elegirTipo(p, v)} className={`text-left rounded-xl border p-3 ${p.TipoFabricacion === v ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                                    <div className="text-sm font-black text-slate-800">{t}</div><div className="text-[11px] text-slate-500">{dd}</div>
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (
                                <div className="md:col-span-2"><Campo label="Producto terminado a fabricar *">
                                    <select value={p.ProIdProducto} onChange={e => elegirProducto(p, e.target.value)} className={INPUT}>
                                        <option value="">Elegí el producto…</option>
                                        {catalogo.map(a => <option key={a.ProIdProducto} value={a.ProIdProducto}>{a.Categoria} · {a.Descripcion}</option>)}
                                    </select>
                                </Campo></div>
                            ) : (
                                <div className="md:col-span-2"><Campo label="Tipo de trabajo *" ayuda="Remera, equipo, bandera, toalla… Acepta cualquier texto."><input list={`tipos-${p._k}`} value={d.tipoTrabajo || ''} onChange={e => cambiarDato(p._k, { tipoTrabajo: e.target.value })} className={INPUT} />
                                    <datalist id={`tipos-${p._k}`}>{['Remera', 'Camiseta', 'Equipo deportivo', 'Buzo', 'Short', 'Bandera', 'Toalla', 'Mantel', 'Pañuelo', 'Bolsa'].map(x => <option key={x} value={x} />)}</datalist>
                                </Campo></div>
                            )}
                            <Campo label="Cantidad total de unidades *"><input type="number" min="1" value={p.Cantidad} onChange={e => cambiarProducto(p._k, { Cantidad: e.target.value })} className={INPUT} /></Campo>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide">Cómo se define</span>
                            <Opcion activo={!porMedida} onClick={() => cambiarDato(p._k, { comoSeDefine: 'TALLE' })}>Por talle (prendas de vestir)</Opcion>
                            <Opcion activo={porMedida} onClick={() => cambiarDato(p._k, { comoSeDefine: 'MEDIDA' })}>Por medidas en cm (banderas, toallas, manteles…)</Opcion>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <Tilde checked={d.productoNuevo} onChange={v => cambiarDato(p._k, { productoNuevo: v })}><b>Producto nuevo</b>, nunca fabricado antes por el taller — abre las especificaciones técnicas y pide muestra aprobada</Tilde>
                            <Tilde checked={d.produccionGrande} onChange={v => cambiarDato(p._k, { produccionGrande: v })}><b>Producción grande</b> — pide muestra previa igual que un producto nuevo</Tilde>
                        </div>
                        <Campo label="Observaciones del producto"><textarea rows={2} value={p.Observaciones} onChange={e => cambiarProducto(p._k, { Observaciones: e.target.value })} className={INPUT} /></Campo>
                    </Seccion>

                    {porMedida ? (
                        <Seccion titulo="Medidas y terminación">
                            <Campo label="Medidas exactas y cantidad por cada medida *" ayuda="Una línea por medida: Banderas 90 x 150 cm — 50 unidades / Banderas 60 x 90 cm — 30 unidades"><textarea rows={3} value={d.medidas || ''} onChange={e => cambiarDato(p._k, { medidas: e.target.value })} className={INPUT} /></Campo>
                            <Campo label="Tipo de terminación o costura *" ayuda="Dobladillo y tiras, vaina para mástil, fuelle…"><input value={d.terminacion || ''} onChange={e => cambiarDato(p._k, { terminacion: e.target.value })} className={INPUT} /></Campo>
                        </Seccion>
                    ) : (
                        <Seccion titulo="Talles y medidas de la prenda" ayuda={esEdicion ? 'La lista de talles (foto, PDF, Excel o CSV) y la de nombres y números se adjuntan como "Planilla de talles y nombres" en la solicitud. Con la planilla o con la nota de abajo alcanza.' : 'La lista de talles se adjunta como "Planilla de talles y nombres" después de guardar. Si no la tenés, escribí la nota de abajo: con una de las dos alcanza.'}>
                            <Campo label="Nota sobre los talles (si no adjuntás la lista)" ayuda="Ej: S 20 · M 40 · L 30 · XL 10"><input value={d.notaTalles || ''} onChange={e => cambiarDato(p._k, { notaTalles: e.target.value })} className={INPUT} /></Campo>
                            <Campo label="Medidas de la prenda (largo, ancho de pecho, manga, cintura…)" ayuda="No frena el ingreso: queda como pendiente si está vacía."><textarea rows={2} value={d.medidasPrenda || ''} onChange={e => cambiarDato(p._k, { medidasPrenda: e.target.value })} className={INPUT} /></Campo>
                            <Tilde checked={d.tablaEstandar} onChange={v => cambiarDato(p._k, { tablaEstandar: v })}>Se trabaja con la tabla de medidas estándar del taller, confirmada con el cliente</Tilde>
                            <Tilde checked={d.personalizacion} onChange={v => cambiarDato(p._k, { personalizacion: v, listaCerrada: v ? d.listaCerrada : false })}>Lleva personalización individual (nombres y números)</Tilde>
                            {d.personalizacion && <div className="pl-5"><Tilde checked={d.listaCerrada} onChange={v => cambiarDato(p._k, { listaCerrada: v })}><b>Lista de nombres y números recibida, completa y cerrada.</b> Se produce tal cual figura en la lista. Lo que se agregue después puede cambiar costo y plazo.</Tilde></div>}
                        </Seccion>
                    )}

                    <Seccion titulo="Bocetos y archivos" ayuda={esEdicion ? 'Los bocetos, fichas técnicas y fotos de referencia se adjuntan en la solicitud, en la fila de cada servicio. Acá solo la tilde de la muestra física.' : 'Boceto, ficha técnica o foto de referencia: se adjuntan desde la solicitud, después de guardar. Es obligatorio tener al menos uno, salvo que tildes lo de abajo.'}>
                        <Tilde checked={d.muestraFisica} onChange={v => cambiarDato(p._k, { muestraFisica: v })}>El cliente entregó una muestra física o un molde — reemplaza al boceto como referencia</Tilde>
                    </Seccion>

                    {d.productoNuevo && (
                        <Seccion titulo="Especificaciones técnicas" ayuda="Requeridas porque el producto no fue desarrollado antes. Si algo no está definido, el taller propone una alternativa y espera confirmación escrita.">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <Campo label="Costuras y en qué parte va cada una *"><textarea rows={2} value={d.espec.costuras} onChange={e => cambiarDatos(p._k, 'espec', { costuras: e.target.value })} className={INPUT} /></Campo>
                                <Campo label="Terminaciones *"><textarea rows={2} value={d.espec.terminaciones} onChange={e => cambiarDatos(p._k, 'espec', { terminaciones: e.target.value })} className={INPUT} /></Campo>
                                <Campo label="Avíos y accesorios (medida, color y cantidad) *"><textarea rows={2} value={d.espec.avios} onChange={e => cambiarDatos(p._k, 'espec', { avios: e.target.value })} className={INPUT} /></Campo>
                                <Campo label="Tela e insumos (tipo, composición, gramaje y color) *"><textarea rows={2} value={d.espec.tela} onChange={e => cambiarDatos(p._k, 'espec', { tela: e.target.value })} className={INPUT} /></Campo>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide">El material lo provee *</span>
                                <Opcion activo={d.espec.provee === 'TALLER'} onClick={() => cambiarDatos(p._k, 'espec', { provee: 'TALLER' })}>El taller</Opcion>
                                <Opcion activo={d.espec.provee === 'CLIENTE'} onClick={() => cambiarDatos(p._k, 'espec', { provee: 'CLIENTE' })}>El cliente</Opcion>
                            </div>
                        </Seccion>
                    )}

                    <Seccion titulo="Producción principal, corte y costura">
                        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
                            <div className="flex items-center justify-between"><h3 className="text-xs font-black text-slate-700">{NOMBRE_PARTE.PRINCIPAL}</h3><Pill e={p.Principal.Estado} mapa={ESTADO_PARTE} /></div>
                            <p className="text-[11px] text-slate-500">Su arte siempre pasa por Diseño (para revisar lo que trajo el cliente o para diseñar desde cero). Se envía desde la solicitud, después de guardar.</p>
                            <Campo label="Indicaciones para Diseño"><textarea rows={2} value={p.Principal.Observaciones} onChange={e => cambiarProducto(p._k, { Principal: { ...p.Principal, Observaciones: e.target.value } })} className={INPUT} /></Campo>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={!!p.Datos.corte.activo} onChange={e => { cambiarDatos(p._k, 'corte', { activo: e.target.checked }); if (!e.target.checked) cambiarDatos(p._k, 'costura', { activo: false }); }} /> Servicio de Corte</label>
                                    {p.Datos.corte.activo && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <Campo label="Tipo de molde"><select value={p.Datos.corte.tipoMolde} onChange={e => cambiarDatos(p._k, 'corte', { tipoMolde: e.target.value, origenTela: e.target.value === 'SUBLIMACION' ? 'TELA SUBLIMADA EN USER' : (p.Datos.corte.origenTela === 'TELA SUBLIMADA EN USER' ? 'TELA CLIENTE' : p.Datos.corte.origenTela) })} className={INPUT}>{TIPOS_MOLDE.map(m => <option key={m}>{m}</option>)}</select></Campo>
                                            <Campo label="Origen de la tela"><select value={p.Datos.corte.origenTela} onChange={e => cambiarDatos(p._k, 'corte', { origenTela: e.target.value })} className={INPUT}>{ORIGENES_TELA.filter(o => p.Datos.corte.tipoMolde !== 'MOLDES CLIENTES' || o !== 'TELA SUBLIMADA EN USER').map(o => <option key={o}>{o}</option>)}</select></Campo>
                                            <p className="col-span-2 text-[11px] text-slate-500">La tizada es el archivo de impresión de la sublimación: la sube Diseño como diseño pronto de la producción principal. Corte no lleva archivo propio.</p>
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={!!p.Datos.costura.activo} disabled={!p.Datos.corte.activo} onChange={e => cambiarDatos(p._k, 'costura', { activo: e.target.checked })} /> Servicio de Costura <span className="font-normal text-slate-400">(requiere Corte)</span></label>
                                    {p.Datos.costura.activo && <Campo label="Instrucciones especiales de costura"><textarea rows={2} value={p.Datos.costura.instrucciones} onChange={e => cambiarDatos(p._k, 'costura', { instrucciones: e.target.value })} className={INPUT} /></Campo>}
                                </div>
                            </div>
                        </div>
                    </Seccion>

                    <Seccion titulo="Trabajos adicionales" ayuda="DTF, TPU, bordado. El tamaño, los colores y la ubicación van en cada servicio; lo que falte se completa después y no frena el ingreso.">
                        <div className="space-y-2">
                            <h3 className="text-xs font-black text-slate-700">Servicios adicionales</h3>
                            <div className="flex flex-wrap gap-2">
                                {ADICIONALES.filter(t => !p.permitidos || p.permitidos.includes(t) || p.Partes[t]).map(t => (
                                    <button type="button" key={t} onClick={() => alternarServicio(p, t)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border inline-flex items-center gap-1 ${p.Partes[t] ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                                        {p.obligatorios.includes(t) && <Lock size={11} />} {p.Partes[t] ? `Quitar ${NOMBRE_PARTE[t]}` : `Agregar ${NOMBRE_PARTE[t]}`}
                                    </button>
                                ))}
                                {p.permitidos && p.permitidos.length === 0 && <span className="text-[11px] text-slate-400">El producto elegido no admite servicios adicionales.</span>}
                            </div>

                            {ADICIONALES.filter(t => p.Partes[t]).map(t => {
                                const pa = p.Partes[t];
                                const d = pa.Datos || {};
                                const materiales = t === 'DTF' ? nomen.dtfMateriales : (nomen.materiales[`${AREA_DE[t]}|${d.variante}`] || []);
                                return (
                                    <div key={t} className="border border-indigo-200 rounded-xl p-3 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-xs font-black text-indigo-700">{NOMBRE_PARTE[t]}{p.obligatorios.includes(t) ? ' · incluido en el producto' : ''}</h4>
                                            <Pill e={pa.Estado} mapa={ESTADO_PARTE} />
                                        </div>
                                        {pa.Estado !== 'INGRESADO' && <p className="text-[11px] text-fuchsia-700">Ya está en Diseño: si cambiás algo, queda señalado como "Modificada" y el diseñador tiene que aceptar el cambio.</p>}
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            <Campo label="Cantidad total"><input type="number" min="1" value={pa.CantidadTotal} onChange={e => cambiarParte(p._k, t, { CantidadTotal: e.target.value })} className={INPUT} /></Campo>
                                            <Campo label={t === 'BORDADO' ? 'Bordados por prenda' : 'Estampados por prenda'}><input type="number" min="1" value={pa.PorPrenda} onChange={e => cambiarParte(p._k, t, { PorPrenda: e.target.value })} className={INPUT} /></Campo>
                                            <div className="col-span-2"><Campo label="Dónde va (ubicación en la prenda)"><input value={pa.Ubicacion} onChange={e => cambiarParte(p._k, t, { Ubicacion: e.target.value })} placeholder="Ej: pecho izquierdo 8 cm, espalda centrado" className={INPUT} /></Campo></div>
                                        </div>
                                        <Campo label="El arte">
                                            <div className="flex flex-wrap gap-4 text-xs text-slate-700 pt-1">
                                                <label className="flex items-center gap-1.5"><input type="radio" checked={pa.ArteOrigen === 'EMPRESA'} onChange={() => cambiarParte(p._k, t, { ArteOrigen: 'EMPRESA' })} /> Se diseña en la empresa (pasa por Diseño)</label>
                                                <label className="flex items-center gap-1.5"><input type="radio" checked={pa.ArteOrigen === 'CLIENTE'} onChange={() => cambiarParte(p._k, t, { ArteOrigen: 'CLIENTE' })} /> Viene listo del cliente</label>
                                            </div>
                                        </Campo>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            {t !== 'DTF' && (
                                                <Campo label={t === 'BORDADO' ? 'Dónde se borda (sobre la prenda / parche adhesivo)' : 'Tipo / variante'} ayuda="Se exige al convertir a pedido">
                                                    <select value={d.variante || ''} onChange={e => { cambiarDatosParte(p._k, t, { variante: e.target.value, material: '' }); cargarMateriales(AREA_DE[t], e.target.value); }} className={INPUT}>
                                                        <option value="">Sin definir todavía</option>
                                                        {(t === 'BORDADO' ? nomen.embVariantes : nomen.tpuVariantes).map(v => <option key={v}>{v}</option>)}
                                                    </select>
                                                </Campo>
                                            )}
                                            <Campo label={t === 'BORDADO' ? 'Tipo de bordado (100% hilo / con tafeta)' : t === 'DTF' ? 'Film / material' : 'Artículo de TPU (tipo y tamaño del parche)'} ayuda={t !== 'DTF' && !d.variante ? 'Primero elegí el campo de la izquierda' : 'Se exige al convertir a pedido'}>
                                                <select value={d.material || ''} onChange={e => cambiarDatosParte(p._k, t, { material: e.target.value })} className={INPUT} disabled={t !== 'DTF' && !d.variante}>
                                                    <option value="">Sin definir todavía</option>
                                                    {d.material && !materiales.includes(d.material) && <option>{d.material}</option>}
                                                    {materiales.map(m => <option key={m}>{m}</option>)}
                                                </select>
                                            </Campo>
                                            {t === 'TPU' && <Campo label="Origen de las prendas"><select value={d.origenPrendas || ''} onChange={e => cambiarDatosParte(p._k, t, { origenPrendas: e.target.value })} className={INPUT}>{ORIGENES_PRENDA.map(o => <option key={o}>{o}</option>)}</select></Campo>}
                                        </div>
                                        <Campo label="Indicaciones para Diseño"><textarea rows={2} value={pa.Observaciones} onChange={e => cambiarParte(p._k, t, { Observaciones: e.target.value })} className={INPUT} /></Campo>
                                    </div>
                                );
                            })}
                        </div>
                    </Seccion>

                    <Seccion titulo="Diseño">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide">Quién aporta el diseño</span>
                            <Opcion activo={d.diseno.origen === 'NO'} onClick={() => cambiarDatos(p._k, 'diseno', { origen: 'NO' })}>No lleva diseño</Opcion>
                            <Opcion activo={d.diseno.origen === 'CLIENTE'} onClick={() => cambiarDatos(p._k, 'diseno', { origen: 'CLIENTE' })}>Lo entrega el cliente</Opcion>
                            <Opcion activo={d.diseno.origen === 'TALLER'} onClick={() => cambiarDatos(p._k, 'diseno', { origen: 'TALLER' })}>Lo hace el taller</Opcion>
                        </div>
                        {d.diseno.origen === 'CLIENTE' && <Tilde checked={d.diseno.verificado} onChange={v => cambiarDatos(p._k, 'diseno', { verificado: v })}><b>Archivo recibido y verificado</b>: formato vectorial o alta resolución, medidas y colores</Tilde>}
                        {d.diseno.origen === 'TALLER' && <Tilde checked={d.diseno.aprobado} onChange={v => cambiarDatos(p._k, 'diseno', { aprobado: v })}><b>Propuesta enviada y aprobada por escrito por el cliente</b></Tilde>}
                        <p className="text-[11px] text-slate-500">Las indicaciones para el diseñador van arriba, en "Producción principal". El trabajo de Diseño se envía, se toma y se sube desde la solicitud, después de guardar.</p>
                    </Seccion>
                    </fieldset>
                </div>
                );
            })}

            <Seccion titulo="Muestra, fecha y plazo">
                <Tilde checked={cab.Ficha.muestra.ofrecida} onChange={v => setMuestra({ ofrecida: v, respuesta: v ? cab.Ficha.muestra.respuesta : '', aprobada: v ? cab.Ficha.muestra.aprobada : false })}><b>Se le ofreció la muestra al cliente</b> (o él la pidió)</Tilde>
                {cab.Ficha.muestra.ofrecida && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-5">
                        <Campo label="Qué respondió *">
                            <select value={cab.Ficha.muestra.respuesta} onChange={e => setMuestra({ respuesta: e.target.value, aprobada: e.target.value === 'RECHAZO' ? false : cab.Ficha.muestra.aprobada })} className={INPUT}>
                                <option value="">— sin registrar —</option>
                                {Object.entries(RESPUESTA_MUESTRA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                        </Campo>
                        <div className="pt-5"><Tilde checked={cab.Ficha.muestra.aprobada} disabled={cab.Ficha.muestra.respuesta === 'RECHAZO'} onChange={v => setMuestra({ aprobada: v })}>Muestra realizada y aprobada por el cliente</Tilde></div>
                    </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Campo label="Fecha que necesita el cliente *" ayuda="Tiene que ser una fecha concreta, no “para fin de mes”."><input type="date" value={cab.FechaEntrega} onChange={e => setCab(c => ({ ...c, FechaEntrega: e.target.value }))} className={INPUT} /></Campo>
                    <Campo label="Hasta (si es un rango)"><input type="date" value={cab.FechaEntregaHasta} min={cab.FechaEntrega || undefined} onChange={e => setCab(c => ({ ...c, FechaEntregaHasta: e.target.value }))} className={INPUT} /></Campo>
                </div>
                <Tilde checked={cab.Ficha.plazoOk} onChange={v => setFicha({ plazoOk: v })}><b>Plazo verificado contra la carga del taller, informado al cliente y aceptado.</b> El plazo lo define el taller y se cuenta desde la aprobación de la muestra, no desde la fecha del pedido.</Tilde>
            </Seccion>

            <Seccion titulo="Indicaciones del cliente" ayuda="Todo lo acordado que pueda afectar la producción o la entrega: entregas parciales, embalaje, quién retira, variantes de algunas unidades.">
                <textarea rows={3} value={cab.Ficha.indicaciones} onChange={e => setFicha({ indicaciones: e.target.value })} className={INPUT} placeholder="Indicaciones adicionales acordadas con el cliente" />
                <Tilde checked={cab.Ficha.sinIndicaciones} onChange={v => setFicha({ sinIndicaciones: v })}>No hay indicaciones especiales, ya lo pregunté</Tilde>
            </Seccion>

            <Seccion titulo="Notas internas" ayuda="Para organizarse el taller. No frena el ingreso y no sale en la hoja de diseño.">
                <textarea rows={2} value={cab.Ficha.notasInternas} onChange={e => setFicha({ notasInternas: e.target.value })} className={INPUT} />
            </Seccion>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <button onClick={() => setProductos(ps => [...ps, productoVacio()])} className={BTN_SECUNDARIO}><Plus size={14} /> Agregar otro producto a la solicitud</button>
                <div className="flex items-center gap-3">
                    <span className="text-[11px] text-slate-500">Se puede guardar incompleto: el sello queda en rojo hasta que esté todo.</span>
                    <button onClick={guardar} disabled={guardando} className={`${BTN_PRIMARIO} !text-sm !px-5 !py-2`}>{guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {esEdicion ? 'Guardar cambios de la solicitud' : 'Ingresar solicitud'}</button>
                </div>
            </div>
        </div>
    );
}
