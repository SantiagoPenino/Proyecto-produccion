// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — lo que trae de fábrica (docs/desarrollos/plan-integracion.md).
// Copiado tal cual del prototipo de Felipe Lalinde (DEF_PLANTILLAS, TIPOS_DES, ETAPAS y los
// estados/tildes de muestras; docs/desarrollos/spec-B §4.5 y spec-A §2.5). esquema.js lo carga en
// las tablas la primera vez; después se cambia desde las pantallas.
// ─────────────────────────────────────────────────────────────────────────────

// Tipos de desarrollo. "Producto" usa artículo del maestro, familia, variantes y muestras; el resto,
// proveedor y costo estimado.
const TIPOS = [
    { clave: 'producto', nombre: 'Producto', esProducto: true },
    { clave: 'tecnologia', nombre: 'Tecnología', esProducto: false },
    { clave: 'maquina', nombre: 'Máquina', esProducto: false },
    { clave: 'proceso', nombre: 'Proceso', esProducto: false },
    { clave: 'procedimiento', nombre: 'Procedimiento', esProducto: false },
    { clave: 'sistemas', nombre: 'Sistemas', esProducto: false },
];

// Las cinco etapas de siempre. La clave sirve para los chips de la lista de Proyectos.
const ETAPAS = [
    { clave: 'definicion', nombre: 'Definición', color: '#5b7cff' },
    { clave: 'desarrollo', nombre: 'Desarrollo técnico', color: '#0a8fb8' },
    { clave: 'muestra', nombre: 'Muestra y aprobación', color: '#3f9a2a' },
    { clave: 'industrializacion', nombre: 'Industrialización', color: '#d9822b' },
    { clave: 'lanzamiento', nombre: 'Lanzamiento', color: '#d1236b' },
];

// Paleta para etapas propias (DP.COLORES)
const COLORES = ['#5b7cff', '#0a8fb8', '#3f9a2a', '#d9822b', '#d1236b', '#7a6bd6', '#8a94a6'];

// t(etapa, nombre, días hábiles, entregable, { ref: pide el artículo del maestro, erp: marca sin uso todavía })
const t = (etapa, nombre, dias, entregable, flags = {}) => ({ etapa, nombre, dias, entregable, ref: !!flags.ref, erp: !!flags.erp });
const propias = (...pares) => pares.map(([nombre, color]) => ({ clave: null, nombre, color }));

// Plantillas. `fija`: el sistema las usa (prenda = la de respaldo, correccion = la de las correcciones,
// variante = las tareas de cada variante nueva); se editan pero no se borran.
const PLANTILLAS = [
    {
        clave: 'prenda', nombre: 'Prenda con molde', para: 'PRODUCTO', tipo: 'producto', fija: true,
        descripcion: 'Camisetas, shorts, buzos: molde en el sistema de moldes y en TizadaPro.',
        etapas: null,
        tareas: [
            t('definicion', 'Alta en el ERP como borrador', 1, 'REF del ERP', { ref: true }),
            t('definicion', 'Definición: modelo, medidas, telas y avíos', 3, 'Brief del producto'),
            t('desarrollo', 'Molde en el sistema de moldes', 5, 'Molde de alta'),
            t('desarrollo', 'Molde y modelos en TizadaPro', 2, 'Modelos cargados'),
            t('muestra', 'Corte y confección de la muestra', 3, 'Muestra física'),
            t('muestra', 'Revisión y ajustes', 2, 'Lista de cambios'),
            t('muestra', 'Aprobación de la muestra', 1, 'Muestra aprobada'),
            t('industrializacion', 'Ficha de diseño (dibujo, avíos, costura paso a paso)', 3, 'Ficha completa'),
            t('industrializacion', 'Tiempos de costura y costeo', 2, 'Costo unitario'),
            t('industrializacion', 'Precio', 1, 'Precio de lista'),
            t('lanzamiento', 'Configuración completa en el ERP', 2, 'Producto configurado', { erp: true }),
            t('lanzamiento', 'Fotos y publicación en canales', 2, 'Publicado'),
        ],
    },
    {
        clave: 'plano', nombre: 'Producto plano (lámina, sin molde)', para: 'PRODUCTO', tipo: 'producto', fija: false,
        descripcion: 'Toallas, manteles, banderas: medida de corte, sin talles.',
        etapas: null,
        tareas: [
            t('definicion', 'Alta en el ERP como borrador', 1, 'REF del ERP', { ref: true }),
            t('definicion', 'Definición: medidas estándar, material y terminación', 2, 'Tabla de medidas'),
            t('desarrollo', 'Lámina o archivo a medida', 2, 'Archivo listo'),
            t('muestra', 'Muestra impresa y terminada', 2, 'Muestra física'),
            t('muestra', 'Aprobación', 1, 'Muestra aprobada'),
            t('industrializacion', 'Costeo y precio', 2, 'Precio de lista'),
            t('lanzamiento', 'Configuración completa en el ERP', 1, 'Producto configurado', { erp: true }),
            t('lanzamiento', 'Fotos y publicación en canales', 1, 'Publicado'),
        ],
    },
    {
        clave: 'estructura', nombre: 'Estructura o exhibición', para: 'PRODUCTO', tipo: 'producto', fija: false,
        descripcion: 'Windflags, backdrops, gazebos: tela más estructura y accesorios.',
        etapas: null,
        tareas: [
            t('definicion', 'Alta en el ERP como borrador', 1, 'REF del ERP', { ref: true }),
            t('definicion', 'Definición: formas, tamaños y componentes', 3, 'Lista de tamaños y componentes'),
            t('definicion', 'Proveedores de la estructura', 3, 'Proveedor elegido'),
            t('desarrollo', 'Forma o archivo por tamaño', 4, 'Archivos por tamaño'),
            t('desarrollo', 'Funda y refuerzos', 2, 'Detalle de confección'),
            t('muestra', 'Muestra armada', 3, 'Muestra con estructura'),
            t('muestra', 'Aprobación', 1, 'Muestra aprobada'),
            t('industrializacion', 'Accesorios de stock en el WMS', 1, 'Accesorios vinculados'),
            t('industrializacion', 'Costeo y precio', 2, 'Precio de lista'),
            t('lanzamiento', 'Configuración completa en el ERP', 2, 'Producto configurado', { erp: true }),
            t('lanzamiento', 'Fotos y publicación en canales', 2, 'Publicado'),
        ],
    },
    {
        clave: 'stock', nombre: 'Producto de stock o de terceros', para: 'PRODUCTO', tipo: 'producto', fija: false,
        descripcion: 'Se compra hecho y se personaliza.',
        etapas: null,
        tareas: [
            t('definicion', 'Alta en el ERP como borrador', 1, 'REF del ERP', { ref: true }),
            t('definicion', 'Definición: proveedor, talles, colores y personalización', 2, 'Ficha de proveedor'),
            t('desarrollo', 'Zonas y archivos de personalización', 2, 'Plantilla de zonas'),
            t('muestra', 'Muestra personalizada', 2, 'Muestra física'),
            t('muestra', 'Aprobación', 1, 'Muestra aprobada'),
            t('industrializacion', 'Costeo y precio', 1, 'Precio de lista'),
            t('lanzamiento', 'Configuración en el ERP (origen «Producto del local»)', 1, 'Producto configurado', { erp: true }),
            t('lanzamiento', 'Fotos y publicación en canales', 1, 'Publicado'),
        ],
    },
    {
        clave: 'correccion', nombre: 'Corrección', para: 'CORRECCION', tipo: 'producto', fija: true,
        descripcion: 'Arreglo de un producto que ya existe.',
        etapas: null,
        tareas: [
            t('definicion', 'Diagnóstico: qué falla y qué se cambia', 2, 'Diagnóstico'),
            t('desarrollo', 'Corrección del molde o archivo', 3, 'Molde corregido'),
            t('muestra', 'Muestra de control', 2, 'Muestra física'),
            t('muestra', 'Aprobación', 1, 'Muestra aprobada'),
            t('industrializacion', 'Actualizar la ficha', 1, 'Ficha actualizada'),
            t('lanzamiento', 'Actualizar el producto en el ERP', 1, 'ERP actualizado', { erp: true }),
        ],
    },
    {
        clave: 'maquina', nombre: 'Máquina o tecnología nueva', para: 'PRODUCTO', tipo: 'maquina', fija: false,
        descripcion: 'Evaluar, comprar, instalar y poner en marcha un equipo o una tecnología.',
        etapas: propias(['Evaluación', '#5b7cff'], ['Compra', '#0a8fb8'], ['Instalación', '#d9822b'], ['Pruebas', '#3f9a2a'], ['Puesta en marcha', '#d1236b']),
        tareas: [
            t('Evaluación', 'Necesidad y qué se espera lograr', 2, 'Objetivo escrito'),
            t('Evaluación', 'Opciones y proveedores', 5, 'Comparativa'),
            t('Evaluación', 'Costo y decisión', 2, 'Decisión tomada'),
            t('Compra', 'Pedido y pago', 3, 'Orden de compra'),
            t('Compra', 'Seguimiento de la entrega', 10, 'Equipo recibido'),
            t('Instalación', 'Lugar, energía y conexiones', 3, 'Lugar listo'),
            t('Instalación', 'Instalación y configuración', 3, 'Equipo funcionando'),
            t('Pruebas', 'Pruebas con trabajos reales', 5, 'Resultados de las pruebas'),
            t('Pruebas', 'Ajustes', 3, 'Ajustes hechos'),
            t('Puesta en marcha', 'Capacitación del equipo', 2, 'Gente capacitada'),
            t('Puesta en marcha', 'Procedimiento de uso y mantenimiento', 2, 'Procedimiento escrito'),
            t('Puesta en marcha', 'En producción', 1, 'En uso'),
        ],
    },
    {
        clave: 'procedimiento', nombre: 'Proceso o procedimiento', para: 'PRODUCTO', tipo: 'procedimiento', fija: false,
        descripcion: 'Definir o cambiar cómo se hace algo y dejarlo funcionando.',
        etapas: propias(['Relevamiento', '#5b7cff'], ['Borrador', '#0a8fb8'], ['Prueba', '#d9822b'], ['Capacitación', '#3f9a2a'], ['Vigente', '#d1236b']),
        tareas: [
            t('Relevamiento', 'Cómo se hace hoy y qué falla', 3, 'Relevamiento'),
            t('Relevamiento', 'Qué se quiere lograr', 1, 'Objetivo'),
            t('Borrador', 'Escribir el paso a paso', 3, 'Borrador'),
            t('Borrador', 'Revisión con quienes lo hacen', 2, 'Borrador revisado'),
            t('Prueba', 'Probarlo en trabajos reales', 5, 'Resultado de la prueba'),
            t('Prueba', 'Ajustes', 2, 'Versión final'),
            t('Capacitación', 'Capacitar a quienes lo usan', 2, 'Gente capacitada'),
            t('Vigente', 'Publicarlo donde se consulta', 1, 'Procedimiento publicado'),
            t('Vigente', 'Revisión al mes', 1, 'Revisión hecha'),
        ],
    },
    {
        clave: 'sistemas', nombre: 'Desarrollo de sistemas', para: 'PRODUCTO', tipo: 'sistemas', fija: false,
        descripcion: 'Cambios o funciones nuevas en el ERP, en esta herramienta o en otros sistemas.',
        etapas: propias(['Definición', '#5b7cff'], ['Desarrollo', '#0a8fb8'], ['Pruebas', '#d9822b'], ['Puesta en producción', '#3f9a2a']),
        tareas: [
            t('Definición', 'Qué se necesita y para quién', 2, 'Pedido claro'),
            t('Definición', 'Alcance y prioridad con sistemas', 2, 'Alcance acordado'),
            t('Desarrollo', 'Desarrollo', 10, 'Versión para probar'),
            t('Pruebas', 'Pruebas con datos reales', 3, 'Lista de correcciones'),
            t('Pruebas', 'Correcciones', 3, 'Versión aprobada'),
            t('Puesta en producción', 'Puesta en producción', 1, 'Funcionando'),
            t('Puesta en producción', 'Capacitación y aviso al equipo', 1, 'Equipo avisado'),
        ],
    },
    {
        clave: 'variante', nombre: 'Variante', para: 'VARIANTE', tipo: 'producto', fija: true,
        descripcion: 'Un modelo o una opción de slot nueva.',
        etapas: null,
        tareas: [
            t('definicion', 'Definición de la combinación', 1, 'Combinación definida'),
            t('desarrollo', 'Receta o molde en el sistema de moldes', 3, 'Variante de alta'),
            t('desarrollo', 'Cargar el modelo en TizadaPro', 1, 'Modelo cargado'),
            t('muestra', 'Muestra', 2, 'Muestra física'),
            t('muestra', 'Aprobación', 1, 'Muestra aprobada'),
            t('lanzamiento', 'Habilitar en el ERP («Modelos que se venden»)', 1, 'Habilitada para la venta'),
        ],
    },
];

// Estados de una muestra, en el orden del recorrido, y tildes (marcas sueltas)
const MUESTRA_ESTADOS = [
    { clave: 'enviada', nombre: 'Enviada a producción', tono: 'azul' },
    { clave: 'cortada', nombre: 'Cortada (en mis manos, sin coser)', tono: 'ambar' },
    { clave: 'costura', nombre: 'En costura', tono: 'azul' },
    { clave: 'terminada', nombre: 'Terminada', tono: 'gris' },
    { clave: 'aprobada', nombre: 'Aprobada', tono: 'verde' },
    { clave: 'con_cambios', nombre: 'Aprobada con cambios', tono: 'ambar' },
    { clave: 'rechazada', nombre: 'Rechazada', tono: 'rojo' },
];
const MUESTRA_TILDES = [
    { clave: 'avisado', nombre: 'Avisado' },
    { clave: 'fotos', nombre: 'Fotos sacadas' },
];

// Líneas de producción del prototipo → áreas del sistema
const LINEAS = [
    { clave: 'sublimacion', areaId: 'SB', nombre: 'Sublimación' },
    { clave: 'directa', areaId: 'DIRECTA', nombre: 'Impresión Directa' },
    { clave: 'ecouv', areaId: 'ECOUV', nombre: 'EcoUV' },
];

// Planificación: horizonte (días; 0 = sin límite) y largo de tanda (semanas)
const PLAN = { horizonte: 28, tanda: 2 };

module.exports = { TIPOS, ETAPAS, COLORES, PLANTILLAS, MUESTRA_ESTADOS, MUESTRA_TILDES, LINEAS, PLAN };
