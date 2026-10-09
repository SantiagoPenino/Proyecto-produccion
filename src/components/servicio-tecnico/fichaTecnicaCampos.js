// Ficha técnica de máquinas (08/10): qué secciones y campos tiene cada tipo de máquina.
// Plan: docs/servicio-tecnico/ficha-tecnica-maquinas-plan.md. Base: el HTML "Ficha Técnica de Máquinas" de Santiago.
//
// Se guarda en ST_FichaEquipo: Identificación en columnas y el resto en Datos (JSON), un objeto por sección
// con los valores como texto, tal cual se escribieron: { dim: { largo: '4200', ... }, imp: { ..., posiciones: [...] } }.
// La sección Capacidad son columnas de ConfigEquipos (las lee Planificación) más dos datos de la ficha.
// Agregar o sacar un campo es tocar este archivo: no hace falta SQL. Si se agrega un campo que es de CADA
// máquina (no se copia a otra), sumarlo también a PROPIOS en backend/controllers/stFichaEquipoController.js.
//
// Campo: { k, l (etiqueta), t: 'txt' | 'num' | 'sel' | 'fecha' | 'area' | 'sino', u (unidad), o (opciones), ph, ancho }.

export const TIPOS = [
    { value: 'IMPRESORA', label: 'Impresora' },
    { value: 'CALANDRA', label: 'Calandra / prensa térmica' },
    { value: 'BORDADORA', label: 'Bordadora' },
    { value: 'LASER', label: 'Corte láser' },
    { value: 'CORTE', label: 'Corte' },
    { value: 'COSTURA', label: 'Máquina de coser' },
    { value: 'OTRA', label: 'Otra' },
];
export const tipoLabel = (v) => TIPOS.find(t => t.value === v)?.label || '';

// Tipo sugerido para una máquina que todavía no tiene (por área y nombre; el técnico lo confirma).
export const sugerirTipo = (areaId, nombre) => {
    const a = String(areaId || '').trim().toUpperCase();
    const n = String(nombre || '').trim().toLowerCase();
    if (n.startsWith('calandra')) return 'CALANDRA';
    if (n.startsWith('samurai')) return 'CORTE';
    if (['DF', 'DIRECTA', 'ECOUV', 'SB', 'TPU'].includes(a)) return 'IMPRESORA';
    if (a === 'EST') return 'CALANDRA';
    if (a === 'EMB') return 'BORDADORA';
    if (a === 'TWC') return 'LASER';
    if (a === 'TWT') return 'COSTURA';
    return 'OTRA';
};

const SINO = ['Sí', 'No'];
export const ESTADOS_PIEZA = ['Operativo', 'Revisar', 'Reemplazar'];
export const ESTADOS_CABEZAL_BORDADO = ['Operativo', 'Revisar', 'Fuera de servicio'];
export const COLORES = {
    Cian: '#00a3d9', Magenta: '#d6007e', Amarillo: '#f2d600', Negro: '#1a1a1a', 'Cian claro': '#7fd3ef', 'Magenta claro': '#f28cc4',
    Blanco: '#ffffff', Barniz: '#e9e4cf', Primer: '#c9c9c9', Rojo: '#e53935', Naranja: '#fb8c00', Verde: '#43a047', Azul: '#1e63d6',
    Gris: '#8a8a8a', 'Fluo amarillo': '#e8ff2a', 'Fluo magenta': '#ff3fb4', Otro: 'transparent',
};
export const HERRAMIENTAS_CORTE = ['Drag (cuchilla de arrastre)', 'Hidráulica', 'Cartón', 'Acrílico', 'Oscilante', 'Hendido', 'Router / fresa', 'Otra'];

const SOFTWARE = {
    IMPRESORA: 'RIP / software de impresión', BORDADORA: 'Software de diseño', LASER: 'Software de control', CORTE: 'Software de control',
};

// Secciones, en el orden en que se muestran. `tipos`: solo para esos tipos (sin `tipos`: todas las máquinas).
// `pestana`: 'ficha' (Ficha técnica) o 'comercial' (Comercial y documentos). `principales`: lo que cuenta el "3/5".
export const SECCIONES = [
    {
        key: 'ident', tag: 'IDN', titulo: 'Identificación', pestana: 'ficha', especial: 'ident',
        principales: ['tipo', 'marca', 'modelo', 'serie'],
    },
    {
        key: 'cap', tag: 'CAP', titulo: 'Capacidad de producción', pestana: 'ficha', especial: 'cap',
        principales: ['velocidadValor', 'velocidadUnidad', 'minutosPreparacion', 'horasTurno'],
    },
    {
        key: 'imp', tag: 'CAB', titulo: 'Cabezales de impresión', pestana: 'ficha', tipos: ['IMPRESORA'],
        campos: [
            { k: 'cantidad', l: 'Cantidad de cabezales', t: 'num', u: 'u' },
            { k: 'modeloCabezal', l: 'Modelo de cabezal', t: 'txt', ph: 'Ej: Epson i3200' },
            { k: 'tecnologia', l: 'Tecnología', t: 'sel', o: ['Piezoeléctrico', 'Térmico', 'Otra'] },
            { k: 'resolucion', l: 'Resolución máxima', t: 'num', u: 'dpi' },
            { k: 'tinta', l: 'Tipo de tinta', t: 'sel', o: ['DTF', 'Sublimación', 'Ecosolvente', 'Solvente', 'UV', 'Textil / pigmento', 'Látex', 'Base agua', 'TPU', 'Otra'] },
            { k: 'anchoMax', l: 'Ancho máximo de impresión', t: 'num', u: 'mm' },
            { k: 'perifericos', l: 'Periféricos', t: 'txt', ph: 'Ej: shaker, horno, secador', ancho: true },
        ],
        lista: {
            k: 'posiciones', titulo: 'Cabezal por posición', fila: 'Cabezal', cantidadDe: 'cantidad',
            cols: [
                { k: 'color', l: 'Canal / color', t: 'color' },
                { k: 'serie', l: 'N.º de serie', t: 'txt' },
                { k: 'fecha', l: 'Colocado el', t: 'fecha' },
                { k: 'estado', l: 'Estado', t: 'sel', o: ESTADOS_PIEZA },
            ],
            nueva: () => ({ color: '', serie: '', fecha: '', estado: 'Operativo' }),
        },
        principales: ['cantidad', 'modeloCabezal', 'tecnologia', 'resolucion', 'tinta'],
        nota: 'Son los cabezales de impresión: no cambian la capacidad de Planificación (eso es «Cabezales / estaciones» en Capacidad).',
    },
    {
        key: 'cal', tag: 'CAL', titulo: 'Calandra / prensa', pestana: 'ficha', tipos: ['CALANDRA'],
        campos: [
            { k: 'tipoPrensa', l: 'Tipo', t: 'sel', o: ['Calandra rotativa', 'Plancha plana', 'Neumática', 'Hidráulica', 'Otra'] },
            { k: 'anchoUtil', l: 'Ancho útil', t: 'num', u: 'mm' },
            { k: 'areaPlato', l: 'Área del plato', t: 'txt', ph: 'Ej: 400 × 500 mm' },
            { k: 'tempMax', l: 'Temperatura máxima', t: 'num', u: '°C' },
            { k: 'presion', l: 'Presión', t: 'num', u: 'bar' },
            { k: 'calentamiento', l: 'Calentamiento', t: 'sel', o: ['Eléctrico', 'Aceite térmico', 'Otro'] },
            { k: 'diametroCilindro', l: 'Diámetro del cilindro', t: 'num', u: 'mm' },
            { k: 'cambioManta', l: 'Último cambio de manta / fieltro', t: 'fecha' },
        ],
        principales: ['tipoPrensa', 'anchoUtil', 'tempMax', 'calentamiento'],
    },
    {
        key: 'bor', tag: 'BOR', titulo: 'Bordado', pestana: 'ficha', tipos: ['BORDADORA'],
        campos: [
            { k: 'agujas', l: 'Agujas por cabezal', t: 'num', u: 'u' },
            { k: 'areaBordado', l: 'Área máxima de bordado', t: 'txt', ph: 'Ej: 500 × 360 mm' },
            { k: 'velMax', l: 'Velocidad máxima', t: 'num', u: 'ppm' },
            { k: 'bastidores', l: 'Bastidores', t: 'txt', ph: 'Ej: plano, tubular, gorra' },
            { k: 'recortador', l: 'Recortador automático', t: 'sino' },
            { k: 'formato', l: 'Formato de archivo', t: 'txt', ph: 'Ej: DST' },
        ],
        lista: {
            k: 'cabezales', titulo: 'Estado de cada cabezal', fila: 'Cabezal', cantidadDeCapacidad: true,
            cols: [
                { k: 'serie', l: 'N.º de serie', t: 'txt' },
                { k: 'estado', l: 'Estado', t: 'sel', o: ESTADOS_CABEZAL_BORDADO },
                { k: 'nota', l: 'Nota', t: 'txt' },
            ],
            nueva: () => ({ serie: '', estado: 'Operativo', nota: '' }),
        },
        principales: ['agujas', 'areaBordado', 'velMax', 'bastidores'],
    },
    {
        key: 'las', tag: 'LAS', titulo: 'Láser', pestana: 'ficha', tipos: ['LASER'],
        campos: [
            { k: 'tipoTubo', l: 'Tipo de tubo', t: 'sel', o: ['CO2 de vidrio', 'CO2 RF (metálico)', 'Fibra', 'Diodo', 'Otro'] },
            { k: 'potencia', l: 'Potencia', t: 'num', u: 'W' },
            { k: 'marcaTubo', l: 'Marca y modelo del tubo', t: 'txt' },
            { k: 'fechaTubo', l: 'Tubo colocado el', t: 'fecha' },
            { k: 'vidaTubo', l: 'Vida útil estimada del tubo', t: 'num', u: 'h' },
            { k: 'chiller', l: 'Chiller', t: 'txt', ph: 'Modelo' },
            { k: 'tempChiller', l: 'Temperatura de trabajo del chiller', t: 'num', u: '°C' },
            { k: 'lente', l: 'Lente (distancia focal)', t: 'num', u: 'mm' },
            { k: 'aireAsistido', l: 'Aire asistido', t: 'sino' },
            { k: 'areaCorte', l: 'Área de corte', t: 'txt', ph: 'Ej: 1300 × 900 mm' },
            { k: 'espesorMax', l: 'Espesor máximo', t: 'num', u: 'mm' },
            { k: 'materiales', l: 'Materiales', t: 'txt', ph: 'Ej: acrílico, MDF, cuero, tela', ancho: true },
        ],
        principales: ['tipoTubo', 'potencia', 'areaCorte', 'chiller'],
    },
    {
        key: 'cor', tag: 'COR', titulo: 'Corte', pestana: 'ficha', tipos: ['CORTE'],
        campos: [
            { k: 'areaCorte', l: 'Área útil de corte', t: 'txt', ph: 'Ej: 1600 × 2500 mm' },
            { k: 'espesorMax', l: 'Espesor máximo', t: 'num', u: 'mm' },
            { k: 'vacio', l: 'Mesa de vacío', t: 'sino' },
            { k: 'potBomba', l: 'Potencia de la bomba de vacío', t: 'num', u: 'kW' },
            { k: 'cinta', l: 'Cinta transportadora', t: 'sino' },
            { k: 'lector', l: 'Lector de marcas / cámara', t: 'sino' },
            { k: 'materiales', l: 'Materiales', t: 'txt', ph: 'Ej: cartón, acrílico, vinilo, TPU', ancho: true },
        ],
        lista: {
            k: 'herramientas', titulo: 'Herramientas', fila: 'Herramienta', libre: true,
            cols: [
                { k: 'herramienta', l: 'Herramienta', t: 'sel', o: HERRAMIENTAS_CORTE },
                { k: 'modelo', l: 'Modelo / código', t: 'txt' },
                { k: 'serie', l: 'N.º de serie', t: 'txt' },
                { k: 'estado', l: 'Estado', t: 'sel', o: ESTADOS_PIEZA },
                { k: 'nota', l: 'Nota', t: 'txt' },
            ],
            nueva: () => ({ herramienta: '', modelo: '', serie: '', estado: 'Operativo', nota: '' }),
        },
        principales: ['areaCorte', 'espesorMax', 'vacio', 'materiales'],
    },
    {
        key: 'cos', tag: 'COS', titulo: 'Costura', pestana: 'ficha', tipos: ['COSTURA'],
        campos: [
            // Del catálogo de Configurar Productos (dbo.MaquinasCostura): las puntadas ISO salen de ahí.
            { k: 'maquinaCosturaId', l: 'Tipo de máquina de coser', t: 'maqCostura' },
            { k: 'agujas', l: 'Agujas', t: 'num', u: 'u' },
            { k: 'hilos', l: 'Hilos', t: 'num', u: 'u' },
            { k: 'velMax', l: 'Velocidad máxima', t: 'num', u: 'ppm' },
        ],
        principales: ['maquinaCosturaId', 'agujas', 'hilos'],
    },
    {
        key: 'sw', tag: 'SW', titulo: 'Software y conectividad', pestana: 'ficha', tipos: ['IMPRESORA', 'BORDADORA', 'LASER', 'CORTE'],
        campos: [
            { k: 'firmware', l: 'Versión de firmware', t: 'txt', ph: 'Ej: 2.14.3' },
            { k: 'software', l: (tipo) => SOFTWARE[tipo] || 'Software', t: 'txt' },
            { k: 'version', l: 'Versión del software', t: 'txt' },
            { k: 'licencia', l: 'Licencia / llave', t: 'txt', ph: 'N.º de licencia o dongle' },
            { k: 'pc', l: 'PC', t: 'txt', ph: 'Nombre o descripción' },
            { k: 'so', l: 'Sistema operativo de la PC', t: 'txt', ph: 'Ej: Windows 11 Pro' },
            { k: 'ip', l: 'Dirección IP', t: 'txt', ph: 'Ej: 192.168.1.50' },
        ],
        principales: ['firmware', 'software', 'so', 'ip'],
    },
    {
        key: 'dim', tag: 'DIM', titulo: 'Dimensiones', pestana: 'ficha',
        campos: [
            { k: 'largo', l: 'Largo (frente)', t: 'num', u: 'mm' },
            { k: 'ancho', l: 'Ancho (profundidad)', t: 'num', u: 'mm' },
            { k: 'alto', l: 'Alto', t: 'num', u: 'mm' },
            { k: 'peso', l: 'Peso', t: 'num', u: 'kg' },
            { k: 'espacioServicio', l: 'Espacio libre para servicio', t: 'num', u: 'mm' },
        ],
        principales: ['largo', 'ancho', 'alto', 'peso'],
    },
    {
        key: 'ele', tag: 'ELE', titulo: 'Consumo eléctrico', pestana: 'ficha',
        campos: [
            { k: 'tension', l: 'Tensión', t: 'num', u: 'V' },
            { k: 'fases', l: 'Fases', t: 'sel', o: ['Monofásica', 'Trifásica'] },
            { k: 'frecuencia', l: 'Frecuencia', t: 'sel', o: ['50 Hz', '60 Hz', '50/60 Hz'] },
            { k: 'potNom', l: 'Potencia nominal', t: 'num', u: 'kW' },
            { k: 'potMax', l: 'Potencia máxima (pico)', t: 'num', u: 'kW' },
            { k: 'potReposo', l: 'Consumo en reposo', t: 'num', u: 'kW' },
            { k: 'corriente', l: 'Corriente según fabricante', t: 'num', u: 'A' },
            { k: 'proteccion', l: 'Protección recomendada', t: 'txt', ph: 'Ej: termomagnética 2×20 A' },
        ],
        principales: ['tension', 'fases', 'frecuencia', 'potNom'],
    },
    {
        key: 'ins', tag: 'INS', titulo: 'Requisitos de instalación', pestana: 'ficha',
        campos: [
            { k: 'tempMin', l: 'Temperatura mínima', t: 'num', u: '°C' },
            { k: 'tempMax', l: 'Temperatura máxima', t: 'num', u: '°C' },
            { k: 'humMin', l: 'Humedad relativa mínima', t: 'num', u: '%' },
            { k: 'humMax', l: 'Humedad relativa máxima', t: 'num', u: '%' },
            { k: 'ventilacion', l: 'Ventilación', t: 'sel', o: ['No requiere', 'Natural', 'Extracción forzada'] },
            { k: 'caudalExtraccion', l: 'Caudal de extracción', t: 'num', u: 'm³/h' },
            { k: 'aire', l: 'Aire comprimido', t: 'sel', o: ['No requiere', 'Sí requiere'] },
            { k: 'airePresion', l: 'Presión de aire', t: 'num', u: 'bar' },
            { k: 'aireCaudal', l: 'Caudal de aire', t: 'num', u: 'l/min' },
            { k: 'red', l: 'Conexión de datos', t: 'sel', o: ['Ethernet', 'Wi-Fi', 'USB', 'Ninguna'] },
            { k: 'piso', l: 'Piso y nivelación', t: 'txt', ph: 'Ej: piso nivelado ±2 mm, carga mínima 500 kg/m²', ancho: true },
        ],
        principales: ['tempMin', 'tempMax', 'humMin', 'humMax', 'ventilacion', 'aire', 'red'],
    },
    {
        key: 'obs', tag: 'OBS', titulo: 'Observaciones técnicas', pestana: 'ficha',
        campos: [{ k: 'notas', l: 'Notas para el técnico', t: 'area', ph: 'Particularidades del equipo, advertencias, contactos internos…', ancho: true }],
        principales: ['notas'],
    },
    {
        key: 'gar', tag: 'GAR', titulo: 'Garantía y soporte', pestana: 'comercial',
        campos: [
            { k: 'fechaInstalacion', l: 'Fecha de instalación', t: 'fecha' },
            { k: 'meses', l: 'Duración de la garantía', t: 'num', u: 'meses' },
            { k: 'cobertura', l: 'Cobertura', t: 'txt', ph: 'Ej: mano de obra y partes, excluye cabezales' },
            { k: 'proveedor', l: 'Proveedor / distribuidor', t: 'txt' },
            { k: 'factura', l: 'N.º de factura / orden de compra', t: 'txt' },
            { k: 'soporteNombre', l: 'Contacto de soporte del fabricante', t: 'txt' },
            { k: 'soporteTel', l: 'Teléfono de soporte', t: 'txt' },
            { k: 'soporteEmail', l: 'Email de soporte', t: 'txt' },
        ],
        principales: ['fechaInstalacion', 'meses', 'proveedor'],
    },
    // Parte 3 (08/10). Los archivos (fotos, manuales en PDF, videos) son adjuntos de la máquina (ST_Adjuntos, Entidad
    // EQUIPO), no van en Datos; los enlaces sí. Ninguna de las dos cuenta para el "% completa".
    { key: 'arc', tag: 'DOC', titulo: 'Fotos y archivos', pestana: 'comercial', especial: 'archivos', principales: [] },
    {
        key: 'doc', tag: 'MAN', titulo: 'Manuales y enlaces', pestana: 'comercial', campos: [],
        lista: {
            k: 'links', titulo: 'Enlaces', fila: 'Enlace', libre: true,
            cols: [
                { k: 'titulo', l: 'Documento', t: 'txt', ph: 'Ej: manual técnico, drivers, soporte' },
                { k: 'url', l: 'Dirección (URL)', t: 'url', ph: 'https://…' },
            ],
            nueva: () => ({ titulo: '', url: '' }),
        },
        principales: [],
    },
];

export const seccionesDe = (tipo, pestana) => SECCIONES.filter(s => (!s.tipos || s.tipos.includes(tipo)) && (!pestana || s.pestana === pestana));
export const etiquetaCampo = (c, tipo) => (typeof c.l === 'function' ? c.l(tipo) : c.l);

// ── Números y cuentas ───────────────────────────────────────────────────────
export const num = (v) => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
export const fmtNum = (n, dec = 2) => Number(n).toLocaleString('es-UY', { maximumFractionDigits: dec });
const lleno = (v) => v !== null && v !== undefined && String(v).trim() !== '';

const parseFecha = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const hoy = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const sumarMeses = (d, n) => { const r = new Date(d.getFullYear(), d.getMonth() + n, d.getDate()); if (r.getDate() !== d.getDate()) r.setDate(0); return r; };
const diasEntre = (a, b) => Math.round((b - a) / 86400000);
const fmtFechaLarga = (d) => d.toLocaleDateString('es-UY', { day: '2-digit', month: 'short', year: 'numeric' });

// Capacidad como la calcula Planificación (planificacionController): velocidad (la real si está) × cabezales
// funcionando (los reales si están; si no, los de diseño; vacío = 1). Las unidades "por minuto" se pasan a hora.
export const capacidadHora = (eq) => {
    const vel = num(eq?.VelocidadValorReal) ?? num(eq?.VelocidadValor);
    if (vel == null) return null;
    const diseno = num(eq?.Cabezales) > 0 ? num(eq.Cabezales) : 1;
    const operativos = num(eq?.CabezalesReal) ?? diseno;
    const u = String(eq?.VelocidadUnidad || '').trim();
    const porMinuto = /\/\s*min$/i.test(u);
    const base = u.replace(/\/\s*(h|hora|min)$/i, '').trim() || 'unidades';
    return {
        porHora: vel * operativos * (porMinuto ? 60 : 1),
        instalada: (num(eq?.VelocidadValor) ?? vel) * diseno * (porMinuto ? 60 : 1),
        base,
    };
};

// Valores calculados de una sección: [{ titulo, valor, nota, tono: 'ok' | 'warn' | 'bad' }].
export const calculosDe = (key, v = {}, ctx = {}) => {
    const out = [];
    if (key === 'dim') {
        const L = num(v.largo), A = num(v.ancho), H = num(v.alto), S = num(v.espacioServicio) || 0;
        if (L && A) out.push({ titulo: 'Superficie ocupada', valor: `${fmtNum(L * A / 1e6)} m²` });
        if (L && A && H) out.push({ titulo: 'Volumen', valor: `${fmtNum(L * A * H / 1e9)} m³` });
        if (L && A && S) out.push({ titulo: 'Huella con espacio de servicio', valor: `${fmtNum((L + 2 * S) * (A + 2 * S) / 1e6)} m²`, nota: 'suma el espacio libre a cada lado' });
    }
    if (key === 'ele') {
        const V = num(v.tension), P = num(v.potMax) ?? num(v.potNom), Pn = num(v.potNom), hT = num(ctx.datos?.cap?.horasTurno);
        if (V && P) {
            const amp = v.fases === 'Trifásica' ? P * 1000 / (Math.sqrt(3) * V) : P * 1000 / V;
            out.push({ titulo: 'Corriente estimada (pico)', valor: `${fmtNum(amp, 1)} A`, nota: `aprox., ${v.fases === 'Trifásica' ? 'trifásica' : 'monofásica'}, con cos φ = 1` });
        }
        if (Pn && hT) out.push({ titulo: 'Energía por turno', valor: `${fmtNum(Pn * hT, 1)} kWh`, nota: 'potencia nominal × horas por turno' });
    }
    if (key === 'cap') {
        const c = capacidadHora(ctx.eq);
        const hT = num(v.horasTurno);
        if (c) {
            const enMant = String(ctx.eq?.Estado || '').trim().toUpperCase() === 'MANTENIMIENTO';
            out.push({
                titulo: 'Producción por hora', valor: `${fmtNum(c.porHora, 1)} ${c.base}`,
                nota: enMant ? 'en mantenimiento: Planificación la cuenta en 0' : (c.porHora < c.instalada ? `instalada ${fmtNum(c.instalada, 1)}; es la que usa Planificación` : 'la que usa Planificación'),
                tono: enMant ? 'bad' : (c.porHora < c.instalada ? 'warn' : undefined),
            });
            if (hT) {
                out.push({ titulo: 'Por turno', valor: `${fmtNum(c.porHora * hT, 0)} ${c.base}`, nota: 'por hora × horas por turno' });
                out.push({ titulo: 'Por mes', valor: `${fmtNum(c.porHora * hT * 22, 0)} ${c.base}`, nota: '22 días hábiles, 1 turno' });
            }
        }
    }
    if (key === 'gar') {
        const g = garantia(v);
        if (g?.vence) {
            out.push({ titulo: 'Vencimiento', valor: fmtFechaLarga(g.vence) });
            out.push({ titulo: 'Estado', valor: g.dias < 0 ? 'Vencida' : g.dias <= 30 ? `Vence en ${g.dias} d` : `Vigente · ${g.dias} d`, tono: g.tono });
        }
        if (g) out.push({ titulo: 'Antigüedad del equipo', valor: g.antiguedad, nota: 'desde la instalación' });
    }
    return out;
};

// Garantía: { vence, dias, tono, antiguedad, texto } o null sin fecha de instalación.
export const garantia = (v = {}) => {
    const d = parseFecha(v.fechaInstalacion);
    if (!d) return null;
    const meses = num(v.meses);
    let mo = (hoy().getFullYear() - d.getFullYear()) * 12 + hoy().getMonth() - d.getMonth();
    if (hoy().getDate() < d.getDate()) mo -= 1;
    mo = Math.max(0, mo);
    const antiguedad = `${mo >= 12 ? `${Math.floor(mo / 12)} año${mo >= 24 ? 's' : ''} ` : ''}${mo % 12} mes${mo % 12 === 1 ? '' : 'es'}`;
    if (meses == null) return { antiguedad };
    const vence = sumarMeses(d, meses);
    const dias = diasEntre(hoy(), vence);
    return {
        vence, dias, antiguedad, tono: dias < 0 ? 'bad' : dias <= 30 ? 'warn' : 'ok',
        texto: dias < 0 ? 'Garantía vencida' : dias <= 30 ? `Garantía: vence en ${dias} d` : 'En garantía',
    };
};

// Avisos de lo cargado (no frenan el guardado).
export const avisosDe = (key, v = {}) => {
    const out = [];
    if (key === 'ins') {
        if (num(v.tempMin) != null && num(v.tempMax) != null && num(v.tempMin) > num(v.tempMax)) out.push('La temperatura mínima es mayor que la máxima.');
        if (num(v.humMin) != null && num(v.humMax) != null && num(v.humMin) > num(v.humMax)) out.push('La humedad mínima es mayor que la máxima.');
        if (v.aire === 'Sí requiere' && !num(v.airePresion)) out.push('Falta la presión de aire requerida.');
    }
    if (key === 'sw' && lleno(v.ip) && !/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(String(v.ip).trim())) {
        out.push('La IP no tiene un formato válido (ej. 192.168.1.50).');
    }
    if (key === 'doc') {
        (v.links || []).forEach((l, i) => {
            if (lleno(l.url) && !esUrl(l.url)) out.push(`El enlace ${i + 1} no empieza con http:// o https://: no se va a poder abrir.`);
        });
    }
    return out;
};

// Solo se abren como enlace las direcciones http(s) (nunca "javascript:" ni otras).
export const esUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || '').trim());

// ── Alertas de una máquina (parte 4, 08/10) ──────────────────────────────────
// A partir de una fila de la lista de máquinas (GET /servicio-tecnico/equipos, que las calcula). Primero lo rojo.
// `destino`: adónde lleva tocarla en la página de la máquina ({ tab, sub } o { tab, seccion }).
export const TONO_ALERTA = {
    bad: 'bg-red-50 text-red-700 border-red-200',
    warn: 'bg-amber-50 text-amber-700 border-amber-200',
};
export const alertasMaquina = (e) => {
    if (!e) return [];
    const n = (v) => Number(v) || 0;
    const cuantos = (k, uno, varios) => (k === 1 ? uno : `${k} ${varios}`);
    const out = [];
    const mant = n(e.MantenimientosVencidos), repC = n(e.RepuestosCriticos), cab = n(e.CabezalesReemplazar);
    const herr = n(e.HerramientasReemplazar), repA = n(e.RepuestosAlerta);
    if (mant) out.push({ clave: 'mant', tono: 'bad', texto: cuantos(mant, 'Mantenimiento vencido', 'mantenimientos vencidos'), destino: { tab: 'servicio', sub: 'preventivo' } });
    if (repC) out.push({ clave: 'repc', tono: 'bad', texto: cuantos(repC, 'Repuesto sin stock o crítico', 'repuestos sin stock o críticos'), destino: { tab: 'servicio', sub: 'repuestos' } });
    if (cab) {
        out.push({
            clave: 'cab', tono: 'bad',
            texto: e.CabezalesSeccion === 'bor' ? cuantos(cab, 'Cabezal fuera de servicio', 'cabezales fuera de servicio') : cuantos(cab, 'Cabezal para cambiar', 'cabezales para cambiar'),
            destino: { tab: 'ficha', seccion: e.CabezalesSeccion || 'imp' },
        });
    }
    if (herr) out.push({ clave: 'herr', tono: 'bad', texto: cuantos(herr, 'Herramienta para cambiar', 'herramientas para cambiar'), destino: { tab: 'ficha', seccion: 'cor' } });
    if (repA) out.push({ clave: 'repa', tono: 'warn', texto: cuantos(repA, 'Repuesto en alerta', 'repuestos en alerta'), destino: { tab: 'servicio', sub: 'repuestos' } });
    if (e.GarantiaDias != null && e.GarantiaDias >= 0 && e.GarantiaDias <= 30) {
        out.push({ clave: 'gar', tono: 'warn', texto: e.GarantiaDias === 0 ? 'La garantía vence hoy' : `La garantía vence en ${e.GarantiaDias} d`, destino: { tab: 'comercial', seccion: 'gar' } });
    }
    if (n(e.SinCapacidad) === 1) out.push({ clave: 'sincap', tono: 'warn', texto: 'Sin capacidad', destino: { tab: 'ficha', seccion: 'cap' } });
    return out;
};

// "3/5": campos principales cargados de una sección. ficha = { Tipo, Marca, ..., Datos }, eq = la máquina (capacidad).
export const completitud = (sec, ficha, eq) => {
    const d = ficha?.Datos || {};
    const valor = (k) => {
        if (sec.especial === 'ident') return { tipo: ficha?.Tipo, marca: ficha?.Marca, modelo: ficha?.Modelo, serie: ficha?.Serie }[k];
        if (sec.especial === 'cap') {
            return { velocidadValor: eq?.VelocidadValor, velocidadUnidad: eq?.VelocidadUnidad, minutosPreparacion: eq?.MinutosPreparacion, horasTurno: d.cap?.horasTurno }[k];
        }
        return d[sec.key]?.[k];
    };
    const hechos = sec.principales.filter(k => lleno(valor(k))).length;
    return { hechos, total: sec.principales.length };
};

// Lo que cambió en una sección, para el historial: ['Firmware: 1.08 → 1.10', ...].
export const resumenCambios = (sec, antes = {}, despues = {}, { tipo, mostrarValor }) => {
    const out = [];
    const ver = (c, v) => (lleno(v) ? mostrarValor(c, v) : '—');
    (sec.campos || []).forEach(c => {
        const a = String(antes[c.k] ?? '').trim(), b = String(despues[c.k] ?? '').trim();
        if (a !== b) out.push(`${etiquetaCampo(c, tipo)}: ${ver(c, a)} → ${ver(c, b)}`);
    });
    if (sec.lista) {
        const la = antes[sec.lista.k] || [], lb = despues[sec.lista.k] || [];
        const n = Math.max(la.length, lb.length);
        const antesDeLista = out.length;
        for (let i = 0; i < n; i++) {
            const fa = la[i], fb = lb[i];
            const nombre = `${sec.lista.fila} ${i + 1}`;
            if (!fb) { out.push(`${nombre}: quitado`); continue; }
            if (!fa) {
                // Fila nueva: lo que se cargó (un estado "Operativo" solo es el valor por defecto, no se anota).
                const datos = sec.lista.cols.filter(c => lleno(fb[c.k]) && !(c.k === 'estado' && fb[c.k] === 'Operativo'))
                    .map(c => `${c.l.toLowerCase()} ${ver(c, fb[c.k])}`);
                if (datos.length) out.push(`${nombre}: ${datos.join(', ')}`);
                continue;
            }
            sec.lista.cols.forEach(c => {
                const a = String(fa[c.k] ?? '').trim(), b = String(fb[c.k] ?? '').trim();
                if (a !== b) out.push(`${nombre}, ${c.l.toLowerCase()}: ${ver(c, a)} → ${ver(c, b)}`);
            });
        }
        // Filas nuevas sin nada más que el valor por defecto: igual queda anotado que se cargó la tabla.
        if (out.length === antesDeLista && lb.length > la.length) {
            const f = sec.lista.fila.toLowerCase();
            out.push(`${sec.lista.titulo}: se cargaron ${lb.length} ${lb.length === 1 ? f : `${f}${/[aeiou]$/.test(f) ? 's' : 'es'}`}`);
        }
    }
    return out;
};
