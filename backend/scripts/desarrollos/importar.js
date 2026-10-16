#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — importa el JSON del prototipo de Felipe (copia-de-datos.json) a las tablas Des*.
// Plan: docs/desarrollos/plan-integracion.md §5.
//
//   node scripts/desarrollos/importar.js --json "<ruta al JSON>"               → PRUEBA: hace todo y deshace
//   node scripts/desarrollos/importar.js --json "<ruta al JSON>" --confirmar   → guarda
//   … --vaciar   borra antes lo importado (pedidos, proyectos, muestras, catálogo, tandas, historial);
//                no toca plantillas, tipos de desarrollo, estados de muestras ni el equipo.
//
// Corre adentro de UNA transacción: si algo falla no queda nada a medias. Al final imprime el
// reporte: conteos contra el JSON y todo lo que no pudo enlazar (personas, REF, órdenes).
// Fechas: el JSON está en UTC y se guardan en UTC (como GETDATE() en prod), sin depender de DB_USE_UTC.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { getPool, sql } = require('../../config/db');
const { asegurarEsquema } = require('../../services/desarrollos/esquema');
const fabrica = require('../../services/desarrollos/fabrica');
const { norm } = require('../../services/desarrollos/comun');

// ── Argumentos ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const RUTA = arg('--json');
const CONFIRMAR = args.includes('--confirmar');
const VACIAR = args.includes('--vaciar');
if (!RUTA) {
    console.error('Uso: node scripts/desarrollos/importar.js --json "<ruta a copia-de-datos.json>" [--confirmar] [--vaciar]');
    process.exit(1);
}

// Personas del prototipo → usuario del sistema (por login, que es igual en local y prod). Los nombres
// que no son personas ("Lista de WhatsApp (06/10)", "Claude"…) quedan como texto, sin usuario.
const ALIAS_LOGIN = {
    'felipe': 'Pipo', 'felipe lalinde': 'Pipo',
    'german': 'german', 'german lalinde': 'german',
    'sergio': 'SergioB', 'sergio bresque': 'SergioB',
};
// Usuario del host de Claude (campo `autor`) → login
const AUTOR_HOST = { u_LesegtkaQTo9NGD6lNmyDQ: 'Pipo' };

const ESTADO_PROYECTO = { activo: 'ACTIVO', pausado: 'PAUSADO', cancelado: 'CANCELADO' };
const ESTADO_TAREA = { pendiente: 'PENDIENTE', en_curso: 'EN_CURSO', en_espera: 'EN_ESPERA', hecho: 'HECHO', no_aplica: 'NO_APLICA' };
const TIPO_SOLICITUD = { solicitud: 'SOLICITUD', idea: 'IDEA', orden: 'ORDEN', correccion: 'CORRECCION', variante: 'VARIANTE' };
const ESTADO_SOLICITUD = { nueva: 'NUEVA', en_evaluacion: 'EN_EVALUACION', pospuesta: 'POSPUESTA', aprobada: 'APROBADA', rechazada: 'RECHAZADA' };
const V_ESTADO = { propuesta: 'PROPUESTA', en_desarrollo: 'EN_DESARROLLO', muestra: 'MUESTRA', lista: 'LISTA', descartada: 'DESCARTADA' };
const V_MOLDES = { no: 'NO', generada: 'GENERADA', de_alta: 'DE_ALTA' };
const V_TIZADA = { sin_verificar: 'SIN_VERIFICAR', no: 'NO', cargada: 'CARGADA' };
const V_ERP = { sin_verificar: 'SIN_VERIFICAR', no: 'NO', habilitada: 'HABILITADA' };
const O_ESTADO = { receta: 'RECETA', molde: 'MOLDE', falta: 'FALTA' };
const LINEA_AREA = Object.fromEntries(fabrica.LINEAS.map(l => [l.clave, l.areaId]));
// Notas de "Fuentes de moldes" que parecen datos de acceso: no se importan (plan §5).
const PARECE_CREDENCIAL = /@|contrase|clave|password|pass\b|usuario|user\b|login/i;

// ── Helpers ──────────────────────────────────────────────────────────────────
const txt = (v, max) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, max) : null; };
const punt = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 5 ? n : null; };
const entero = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
// Día 'YYYY-MM-DD' → DATE; momento ISO → DATETIME2 en UTC
const D = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? { fecha: String(v).slice(0, 10), tipo: 'DATE' } : null);
const T = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : { fecha: d.toISOString().slice(0, 23), tipo: 'DATETIME2' };
};
const lista = (datos, col) => Object.entries(datos[col] || {}).map(([id, d]) => ({ _id: id, ...d }));

// INSERT con los tipos que infiere mssql; las fechas van como texto ISO y se convierten en SQL.
// Los campos undefined se omiten (toman el DEFAULT de la tabla).
async function insertar(tx, tabla, campos, idCol = null) {
    const req = tx.request();
    const cols = [];
    const vals = [];
    let i = 0;
    for (const [col, v] of Object.entries(campos)) {
        if (v === undefined) continue;
        const p = `p${i++}`;
        cols.push(col);
        if (v && typeof v === 'object' && 'fecha' in v) {
            req.input(p, sql.VarChar(30), v.fecha);
            vals.push(`CONVERT(${v.tipo}, @${p}, ${v.tipo === 'DATE' ? 23 : 126})`);
        } else if (v === null) {
            req.input(p, sql.NVarChar(1), null);
            vals.push(`@${p}`);
        } else {
            req.input(p, v);
            vals.push(`@${p}`);
        }
    }
    const salida = idCol ? `OUTPUT INSERTED.${idCol}` : '';
    const r = await req.query(`INSERT INTO dbo.${tabla} (${cols.join(', ')}) ${salida} VALUES (${vals.join(', ')})`);
    return idCol ? r.recordset[0][idCol] : null;
}

// ── Reporte ──────────────────────────────────────────────────────────────────
const rep = {
    conteos: {},                 // colección → { json, importados }
    personasSinUsuario: new Map(), // nombre → veces
    refSinArticulo: [],
    ordenesSinMatch: [],
    archivosSinBajar: 0,
    fuentesNotasOmitidas: [],
    avisos: [],
};
const contar = (col, json, importados) => { rep.conteos[col] = { json, importados }; };
const aviso = (m) => rep.avisos.push(m);

(async () => {
    const datos = JSON.parse(fs.readFileSync(path.resolve(RUTA), 'utf8'));
    const pool = await getPool();
    await asegurarEsquema(pool);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        // ── Vaciar o verificar que esté vacío ────────────────────────────────
        const TABLAS_DATOS = [
            'DesTandaTareas', 'DesTandaProyectos', 'DesTandaGrupos', 'DesTandas', 'DesOrdenLista',
            'DesMuestraTildesMarcadas', 'DesMuestraProyectos', 'DesMuestraOrdenes', 'DesMuestras',
            'DesCapacidadUso', 'DesCapacidades', 'DesOpcionProyectos', 'DesOpcionesSlot',
            'DesVarianteTareas', 'DesVariantes', 'DesTareaDependencias', 'DesTareas', 'DesHistorialEtapas',
            'DesProyectoEtapas', 'DesSolicitudes', 'DesProyectos', 'DesComentarios', 'DesBitacora', 'DesFeedback',
        ];
        if (VACIAR) {
            for (const t of TABLAS_DATOS) await tx.request().query(`DELETE FROM dbo.${t}`);
            await tx.request().query(`DELETE FROM dbo.DesAdjuntos WHERE Entidad IN ('SOLICITUD', 'PROYECTO', 'MUESTRA')`);
        } else {
            const r = await tx.request().query(`SELECT (SELECT COUNT(*) FROM dbo.DesProyectos) + (SELECT COUNT(*) FROM dbo.DesSolicitudes)
                + (SELECT COUNT(*) FROM dbo.DesMuestras) + (SELECT COUNT(*) FROM dbo.DesCapacidades) + (SELECT COUNT(*) FROM dbo.DesOpcionesSlot) AS n`);
            if (r.recordset[0].n > 0) throw new Error('Las tablas de Desarrollos ya tienen datos. Para volver a importar, agregá --vaciar.');
        }

        // ── Tablas de consulta ───────────────────────────────────────────────
        const usuarios = (await tx.request().query(`
            SELECT IdUsuario, LTRIM(RTRIM(Usuario)) AS Usuario, LTRIM(RTRIM(ISNULL(Nombre, ''))) AS Nombre, ISNULL(Activo, 1) AS Activo
            FROM dbo.Usuarios`)).recordset;
        const porLogin = new Map(usuarios.map(u => [u.Usuario.toLowerCase(), u]));
        const porNombre = new Map();
        for (const u of usuarios.filter(x => x.Activo)) {
            for (const k of [norm(u.Nombre), norm(u.Usuario)]) {
                if (!k) continue;
                porNombre.set(k, porNombre.has(k) && porNombre.get(k).IdUsuario !== u.IdUsuario ? null : u); // null = ambiguo
            }
        }
        const persona = (nombre) => {
            const n = norm(nombre);
            if (!n) return { id: null, texto: null };
            const alias = ALIAS_LOGIN[n] && porLogin.get(ALIAS_LOGIN[n].toLowerCase());
            const u = alias || porNombre.get(n) || null;
            if (u) return { id: u.IdUsuario, texto: null };
            rep.personasSinUsuario.set(String(nombre).trim(), (rep.personasSinUsuario.get(String(nombre).trim()) || 0) + 1);
            return { id: null, texto: String(nombre).trim().slice(0, 120) };
        };
        const autorHost = (id) => {
            const login = AUTOR_HOST[id];
            return login ? (porLogin.get(login.toLowerCase())?.IdUsuario || null) : null;
        };

        const filasArt = (await tx.request().query(`
            SELECT ProIdProducto, UPPER(LTRIM(RTRIM(CodArticulo))) AS Cod, LTRIM(RTRIM(Descripcion)) AS Descripcion
            FROM dbo.Articulos WHERE CodArticulo IS NOT NULL`)).recordset;
        const articulos = new Map(filasArt.map(a => [a.Cod, a.ProIdProducto]));
        const descArticulo = new Map(filasArt.map(a => [a.ProIdProducto, a.Descripcion]));
        let etiquetas = new Map();
        try {
            etiquetas = new Map((await tx.request().query('SELECT EtiquetaID, Nombre FROM dbo.ProductoEtiqueta')).recordset.map(e => [norm(e.Nombre), e.EtiquetaID]));
        } catch (_) { aviso('No hay tabla ProductoEtiqueta: las etiquetas no se enlazan.'); }
        const tipos = new Map((await tx.request().query('SELECT TipoID, Clave FROM dbo.DesTiposDesarrollo')).recordset.map(t => [t.Clave, t.TipoID]));

        // Tipos de desarrollo propios del prototipo (config/desarrollos), si los hay
        for (const [i, tp] of (datos.config?.desarrollos?.tipos || []).entries()) {
            if (!tp?.id || tipos.has(tp.id)) continue;
            const id = await insertar(tx, 'DesTiposDesarrollo', { Clave: String(tp.id).slice(0, 40), Nombre: txt(tp.nombre, 60) || tp.id, EsProducto: !!tp.producto, Orden: 100 + i }, 'TipoID');
            tipos.set(tp.id, id);
        }
        const tipoId = (clave) => {
            const k = clave || 'producto';
            if (tipos.has(k)) return tipos.get(k);
            aviso(`Tipo de desarrollo desconocido "${k}": quedó como Producto.`);
            return tipos.get('producto');
        };

        // Plantillas guardadas en el prototipo (si Felipe editó alguna, manda la suya)
        const plantillasDoc = lista(datos, 'plantillas');
        for (const doc of plantillasDoc) await importarPlantilla(tx, doc, tipoId);
        contar('plantillas', plantillasDoc.length, plantillasDoc.length);
        const plantillas = new Map((await tx.request().query('SELECT PlantillaID, Clave, Nombre FROM dbo.DesPlantillas WHERE Activo = 1')).recordset.map(p => [p.Clave, p]));

        // Estados y tildes de muestras de la configuración del prototipo
        const estadosMuestra = new Map((await tx.request().query('SELECT EstadoID, Clave FROM dbo.DesMuestraEstados')).recordset.map(e => [e.Clave, e.EstadoID]));
        for (const [i, e] of (datos.config?.muestras?.estados || []).entries()) {
            if (!e?.id || estadosMuestra.has(e.id)) continue;
            const tono = ['gris', 'azul', 'ambar', 'verde', 'rojo'].includes(e.tono) ? e.tono : 'gris';
            estadosMuestra.set(e.id, await insertar(tx, 'DesMuestraEstados', { Clave: String(e.id).slice(0, 40), Nombre: txt(e.nombre, 60) || e.id, Tono: tono, Orden: 100 + i }, 'EstadoID'));
        }
        const tildesMuestra = new Map((await tx.request().query('SELECT TildeID, Clave FROM dbo.DesMuestraTildes')).recordset.map(e => [e.Clave, e.TildeID]));
        for (const [i, e] of (datos.config?.muestras?.tildes || []).entries()) {
            if (!e?.id || tildesMuestra.has(e.id)) continue;
            tildesMuestra.set(e.id, await insertar(tx, 'DesMuestraTildes', { Clave: String(e.id).slice(0, 40), Nombre: txt(e.nombre, 40) || e.id, Orden: 100 + i }, 'TildeID'));
        }

        // Historial de cambios (bitácora) de cualquier entidad
        const importarBitacora = async (entidad, entidadId, entradas) => {
            for (const b of entradas || []) {
                const quien = txt(b.quien, 150);
                const p = quien ? persona(quien) : { id: autorHost(b.autor) };
                await insertar(tx, 'DesBitacora', {
                    Entidad: entidad, EntidadID: entidadId, Accion: txt(b.accion, 60) || 'Editó', Detalle: txt(b.detalle, 1000),
                    UsuarioID: p.id || autorHost(b.autor) || null, UsuarioNombre: quien, Fecha: T(b.fecha) || undefined,
                });
            }
        };

        // ── Capacidades ──────────────────────────────────────────────────────
        const capacidades = new Map();
        const capsJson = lista(datos, 'capacidades');
        for (const c of capsJson) {
            capacidades.set(c._id, await insertar(tx, 'DesCapacidades', {
                Clave: c._id.slice(0, 100), Nombre: txt(c.nombre, 80) || c._id.replace(/_/g, ' '), Familia: txt(c.familia, 60),
                Ambito: c.ambito === 'plano' ? 'PLANO' : 'PRENDA', Nota: txt(c.nota, 200), Resuelta: !!c.lista,
                FechaActualizado: T(c.actualizado) || undefined,
            }, 'CapacidadID'));
        }
        contar('capacidades', capsJson.length, capacidades.size);
        const usoCapacidad = async (ids, entidad, entidadId, relacion, quien) => {
            for (const cid of [...new Set(ids || [])]) {
                const capId = capacidades.get(cid);
                if (!capId) { aviso(`${quien}: capacidad "${cid}" no existe; no se enlazó.`); continue; }
                await insertar(tx, 'DesCapacidadUso', { CapacidadID: capId, Entidad: entidad, EntidadID: entidadId, Relacion: relacion });
            }
        };

        // ── Proyectos, con sus etapas, tareas, historial y variantes ─────────
        const proyectos = new Map();   // id prototipo → ProyectoID
        const tareas = new Map();      // 'pid|sid' → TareaID
        const variantes = [];          // { VarianteID, pid, v }
        let nTareas = 0;
        let nTareasJson = 0;
        const prodsJson = lista(datos, 'productos').sort((a, b) => String(a.creado || '').localeCompare(String(b.creado || '')));
        for (const p of prodsJson) {
            const estado = ESTADO_PROYECTO[p.estado_general] || 'ACTIVO';
            const lider = persona(p.lider);
            const ref = txt(p.ref_erp, 40);
            const proId = ref ? articulos.get(ref.toUpperCase()) || null : null;
            if (ref && !proId) rep.refSinArticulo.push(`${p.codigo} «${p.nombre}»: "${ref}"`);
            // Un REF de puros números (el prototipo usa PR-NNN) puede haber caído en otro artículo: que se revise.
            if (proId && /^\d+$/.test(ref)) aviso(`${p.codigo} «${p.nombre}»: REF "${ref}" se enlazó a «${descArticulo.get(proId)}». Revisar.`);
            const etiquetaId = p.etiqueta ? etiquetas.get(norm(p.etiqueta)) || null : null;
            if (p.etiqueta && !etiquetaId) aviso(`${p.codigo}: etiqueta "${p.etiqueta}" no está en el maestro.`);
            if (p.linea && !LINEA_AREA[p.linea]) aviso(`${p.codigo}: línea "${p.linea}" desconocida.`);
            const plantilla = plantillas.get(p.plantilla) || null;
            if (p.plantilla && !plantilla) aviso(`${p.codigo}: plantilla "${p.plantilla}" no existe; queda solo el nombre.`);
            const legado = {};
            for (const k of ['categoria', 'molde_sistema', 'prioridad_fija']) if (p[k] !== undefined && p[k] !== '' && p[k] !== 0) legado[k] = p[k];
            if (Array.isArray(p.muestras) && p.muestras.length) legado.muestras = p.muestras;
            if (Array.isArray(p.archivos) && p.archivos.length) { legado.archivos = p.archivos; rep.archivosSinBajar += p.archivos.length; }

            const pasos = Array.isArray(p.pasos) ? p.pasos : [];
            const pendientes = pasos.filter(s => !['hecho', 'no_aplica'].includes(s.estado));
            const hist = Array.isArray(p.historial) ? p.historial : [];
            const ultimo = (estadoHist) => [...hist].reverse().find(h => h.estado === estadoHist)?.fecha;
            const maxHecho = pasos.map(s => s.hecho_el).filter(Boolean).sort().pop();
            const terminado = estado !== 'CANCELADO' && pendientes.length === 0 ? (ultimo('publicado') || maxHecho || p.actualizado) : null;
            const cancelado = estado === 'CANCELADO' ? (ultimo('cancelado') || p.actualizado) : null;

            const pid = await insertar(tx, 'DesProyectos', {
                Codigo: txt(p.codigo, 20) || `PD-X${proyectos.size + 1}`, Nombre: txt(p.nombre, 120) || 'Sin nombre',
                Tipo: p.tipo === 'correccion' ? 'CORRECCION' : 'NUEVO', TipoOrigen: txt(p.tipo_origen, 20), Origen: txt(p.origen, 20),
                TipoID: tipoId(p.desarrollo), PlantillaID: plantilla?.PlantillaID || null, PlantillaNombre: plantilla?.Nombre || txt(p.plantilla, 60),
                Estado: estado, LiderUsuarioID: lider.id, LiderTexto: lider.texto, LineaAreaID: LINEA_AREA[p.linea] || null,
                FechaInicio: D(p.fecha_inicio), FechaLimite: D(p.fecha_limite), ProIdProducto: proId, RefErpTexto: proId ? null : ref,
                Familia: txt(p.familia, 60), EtiquetaID: etiquetaId, Notas: txt(p.notas, 20000), Proveedor: txt(p.proveedor, 80),
                CostoEstimado: txt(p.costo_estimado, 40),
                Estrategico: punt(p.puntaje?.estrategico), Comercial: punt(p.puntaje?.comercial),
                Complejidad: punt(p.puntaje?.complejidad), Recursos: punt(p.puntaje?.recursos),
                FechaTerminado: T(terminado), FechaCancelado: T(cancelado),
                DatosOrigenJson: Object.keys(legado).length ? JSON.stringify(legado) : null, IdOrigen: p._id.slice(0, 40),
                FechaAlta: T(p.creado) || undefined, FechaActualizado: T(p.actualizado) || undefined,
            }, 'ProyectoID');
            proyectos.set(p._id, pid);

            // Etapas: las propias del proyecto o las cinco de siempre (como DP.etapasDe)
            const etapasP = Array.isArray(p.etapas) && p.etapas.length
                ? p.etapas.map(e => ({ key: e.id, clave: null, nombre: txt(e.label, 40) || String(e.id), color: e.c || '#8a94a6' }))
                : fabrica.ETAPAS.map(e => ({ key: e.clave, clave: e.clave, nombre: e.nombre, color: e.color }));
            const etapaId = new Map();
            for (const [i, e] of etapasP.entries()) {
                etapaId.set(e.key, await insertar(tx, 'DesProyectoEtapas', { ProyectoID: pid, Clave: e.clave, Nombre: e.nombre, Color: e.color, Orden: i + 1 }, 'EtapaID'));
            }
            const nombreEtapa = new Map(etapasP.map(e => [e.key, e.nombre]));

            // Tareas en el orden de DP.tareasDe: por etapa y, adentro, por posición
            const idx = (s) => { const i = etapasP.findIndex(e => e.key === s.etapa); return i < 0 ? 9 : i; };
            const ordenadas = pasos.map((s, i) => ({ s, i })).sort((a, b) => idx(a.s) - idx(b.s) || a.i - b.i).map(x => x.s);
            const ordenEtapa = new Map();
            nTareasJson += pasos.length;
            for (const s of ordenadas) {
                let eId = etapaId.get(s.etapa);
                if (!eId) {
                    eId = etapaId.get(etapasP[etapasP.length - 1].key);
                    aviso(`${p.codigo}: la tarea «${s.nombre}» estaba en la etapa "${s.etapa}", que no existe; quedó en la última.`);
                }
                ordenEtapa.set(eId, (ordenEtapa.get(eId) || 0) + 1);
                const resp = persona(s.responsable);
                const est = ESTADO_TAREA[s.estado];
                if (!est) aviso(`${p.codigo}: tarea «${s.nombre}» con estado "${s.estado}": quedó Pendiente.`);
                const tid = await insertar(tx, 'DesTareas', {
                    ProyectoID: pid, EtapaID: eId, Nombre: txt(s.nombre, 120) || 'Sin nombre', Orden: ordenEtapa.get(eId),
                    Estado: est || 'PENDIENTE', ResponsableUsuarioID: resp.id, ResponsableTexto: resp.texto,
                    Fecha: D(s.fecha), HechoEl: T(s.hecho_el), DiasHabiles: Math.max(0, entero(s.duracion) ?? 1),
                    Entregable: txt(s.entregable, 80), Nota: txt(s.nota, 300), PideRef: !!s.ref, MarcaErp: !!s.erp,
                    IdOrigen: txt(s.id, 40),
                }, 'TareaID');
                tareas.set(`${p._id}|${s.id}`, tid);
                nTareas++;
            }
            for (const s of pasos) {
                for (const d of [...new Set(s.depende || [])]) {
                    const a = tareas.get(`${p._id}|${s.id}`);
                    const b = tareas.get(`${p._id}|${d}`);
                    if (a && b && a !== b) await insertar(tx, 'DesTareaDependencias', { TareaID: a, DependeDeTareaID: b });
                    else aviso(`${p.codigo}: dependencia de «${s.nombre}» a una tarea que no existe; no se importó.`);
                }
            }

            // Historial de etapas
            for (const h of hist) {
                const esFin = h.estado === 'publicado' || h.estado === 'cancelado';
                await insertar(tx, 'DesHistorialEtapas', {
                    ProyectoID: pid, EtapaID: esFin ? null : etapaId.get(h.estado) || null,
                    Etapa: h.estado === 'publicado' ? 'Terminado' : h.estado === 'cancelado' ? 'Cancelado' : (nombreEtapa.get(h.estado) || String(h.estado)).slice(0, 40),
                    Fecha: T(h.fecha) || undefined,
                });
            }
            await importarBitacora('PROYECTO', pid, p.bitacora);
            await usoCapacidad(p.requiere, 'PROYECTO', pid, 'REQUIERE', p.codigo);
            await usoCapacidad(p.resuelve, 'PROYECTO', pid, 'RESUELVE', p.codigo);

            // Variantes (los ids v1…v5 se repiten entre productos: IdOrigen = proyecto|variante)
            for (const [i, v] of (p.variantes || []).entries()) {
                const combo = { ...(v.combinacion || {}) };
                const libre = txt(combo.libre, 200);
                delete combo.libre;
                const resp = persona(v.responsable);
                const vid = await insertar(tx, 'DesVariantes', {
                    ProyectoID: pid, Nombre: txt(v.nombre, 120) || 'Sin nombre',
                    CombinacionJson: Object.keys(combo).length ? JSON.stringify(combo) : null, Libre: libre,
                    Origen: txt(v.origen, 12), Estado: V_ESTADO[v.estado] || 'PROPUESTA', Moldes: V_MOLDES[v.moldes] || 'NO',
                    Tizada: V_TIZADA[v.tizada] || 'SIN_VERIFICAR', TizadaNombre: txt(v.tizada_nombre, 80), Erp: V_ERP[v.erp] || 'SIN_VERIFICAR',
                    ResponsableUsuarioID: resp.id, ResponsableTexto: resp.texto, Fecha: D(v.fecha), Nota: txt(v.nota, 300), Orden: i + 1,
                    IdOrigen: `${p._id}|${v.id}`.slice(0, 40), FechaAlta: T(v.creado) || T(p.creado) || undefined,
                }, 'VarianteID');
                variantes.push({ vid, pid: p._id, v });
                for (const [j, s] of (v.pasos || []).entries()) {
                    const r2 = persona(s.responsable);
                    await insertar(tx, 'DesVarianteTareas', {
                        VarianteID: vid, EtapaClave: txt(s.etapa, 40), Nombre: txt(s.nombre, 120) || 'Sin nombre', Orden: j + 1,
                        Estado: ESTADO_TAREA[s.estado] || 'PENDIENTE', ResponsableUsuarioID: r2.id, ResponsableTexto: r2.texto,
                        Fecha: D(s.fecha), HechoEl: T(s.hecho_el), DiasHabiles: Math.max(0, entero(s.duracion) ?? 1), Entregable: txt(s.entregable, 80),
                    });
                }
            }
        }
        contar('productos (proyectos)', prodsJson.length, proyectos.size);
        contar('tareas', nTareasJson, nTareas);
        contar('variantes', prodsJson.reduce((n, p) => n + (p.variantes || []).length, 0), variantes.length);

        // ── Pedidos (solicitudes) ────────────────────────────────────────────
        const solicitudes = new Map();
        const solsJson = lista(datos, 'solicitudes').sort((a, b) => String(a.creado || '').localeCompare(String(b.creado || '')));
        const numerosUsados = new Set();
        for (const s of solsJson) {
            let numero = entero(String(s.codigo || '').replace(/\D/g, ''));
            if (!numero || numerosUsados.has(numero)) {
                const nuevo = Math.max(0, ...numerosUsados, ...solsJson.map(x => entero(String(x.codigo || '').replace(/\D/g, '')) || 0)) + 1;
                aviso(`Pedido ${s.codigo || s._id}: sin número o repetido; quedó DES-${nuevo}.`);
                numero = nuevo;
            }
            numerosUsados.add(numero);
            const pedidoPor = persona(s.pedido_por || s.contacto?.nombre);
            const decision = [...(s.bitacora || [])].reverse().find(b => /^(Aprob|Pospuso|Rechaz)/.test(b.accion || ''));
            const decidio = decision?.quien ? persona(decision.quien).id : null;
            const etiquetaId = s.etiqueta ? etiquetas.get(norm(s.etiqueta)) || null : null;
            const tipo = TIPO_SOLICITUD[s.tipo] || 'SOLICITUD';
            const proyCreado = s.producto_creado_id ? proyectos.get(s.producto_creado_id) || null : null;
            if (s.producto_creado_id && !proyCreado) aviso(`Pedido ${s.codigo}: apuntaba a un proyecto que no existe.`);
            let varCreada = null;
            if (tipo === 'VARIANTE' && proyCreado) varCreada = variantes.find(x => x.pid === s.producto_creado_id && x.v.solicitud_id === s._id)?.vid || null;
            const legado = { codigo_prototipo: s.codigo };
            for (const k of ['contacto', 'pasos_previos', 'puntaje_solicitante', 'opiniones', 'participantes', 'categoria']) {
                const v = s[k];
                if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length) && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) legado[k] = v;
            }
            if (Array.isArray(s.imagenes) && s.imagenes.length) { legado.imagenes = s.imagenes; rep.archivosSinBajar += s.imagenes.length; }
            const sid = await insertar(tx, 'DesSolicitudes', {
                Numero: numero, Tipo: tipo, TipoID: tipoId(s.desarrollo), Estado: ESTADO_SOLICITUD[s.estado] || 'NUEVA',
                Titulo: txt(s.titulo, 120) || 'Sin título', Descripcion: txt(s.descripcion, 4000), ClienteTexto: txt(s.cliente, 120),
                Cantidad: txt(s.cantidad, 60), FechaLimite: D(s.fecha_limite), PedidoPorUsuarioID: pedidoPor.id, PedidoPorTexto: pedidoPor.texto,
                AutorUsuarioID: autorHost(s.autor), AutorEquipo: s.autor_equipo !== false,
                CorrigeProyectoID: s.corrige_id ? proyectos.get(s.corrige_id) || null : null,
                Familia: txt(s.familia, 60), EtiquetaID: etiquetaId, LineaAreaID: LINEA_AREA[s.linea] || null, RefErpTexto: txt(s.ref_erp, 40),
                Estrategico: punt(s.puntaje?.estrategico) || 3, Comercial: punt(s.puntaje?.comercial) || 3,
                Complejidad: punt(s.puntaje?.complejidad) || 3, Recursos: punt(s.puntaje?.recursos) || 3,
                Evaluacion: txt(s.evaluacion, 2000), Motivo: txt(s.motivo, 2000), FechaRevision: D(s.fecha_revision),
                FechaDecision: T(s.decidido), DecididoPorUsuarioID: decidio, ProyectoCreadoID: proyCreado, VarianteCreadaID: varCreada,
                Links: txt(s.links, 1000), DatosOrigenJson: JSON.stringify(legado), IdOrigen: s._id.slice(0, 40),
                FechaAlta: T(s.creado) || undefined, FechaActualizado: T(s.actualizado) || undefined,
            }, 'SolicitudID');
            solicitudes.set(s._id, sid);
            await importarBitacora('SOLICITUD', sid, s.bitacora);
            await usoCapacidad(s.requiere, 'SOLICITUD', sid, 'REQUIERE', s.codigo);
        }
        contar('solicitudes (pedidos)', solsJson.length, solicitudes.size);

        // Enlaces que necesitaban los dos lados: proyecto → pedido y a qué corrige; variante → pedido
        for (const p of prodsJson) {
            const sid = p.solicitud_id ? solicitudes.get(p.solicitud_id) || null : null;
            const corr = p.corrige_id ? proyectos.get(p.corrige_id) || null : null;
            if (p.solicitud_id && !sid) aviso(`${p.codigo}: venía de un pedido que no existe.`);
            if (sid || corr) {
                await tx.request().input('P', sql.Int, proyectos.get(p._id)).input('S', sql.Int, sid).input('C', sql.Int, corr)
                    .query('UPDATE dbo.DesProyectos SET SolicitudID = @S, CorrigeProyectoID = @C WHERE ProyectoID = @P');
            }
        }
        for (const x of variantes) {
            const sid = x.v.solicitud_id ? solicitudes.get(x.v.solicitud_id) || null : null;
            if (sid) await tx.request().input('V', sql.Int, x.vid).input('S', sql.Int, sid).query('UPDATE dbo.DesVariantes SET SolicitudID = @S WHERE VarianteID = @V');
        }

        // ── Opciones de slot ─────────────────────────────────────────────────
        const opcsJson = lista(datos, 'opciones');
        let nOpc = 0;
        for (const o of opcsJson) {
            const oid = await insertar(tx, 'DesOpcionesSlot', {
                Clave: o._id.slice(0, 100), Molde: txt(o.molde, 60) || 'sin_molde', MoldeNombre: txt(o.molde_nombre, 100),
                Slot: txt(o.slot, 60) || 'sin_slot', SlotNombre: txt(o.slot_nombre, 80), Codigo: txt(o.codigo, 30) || o._id.slice(-30),
                CodigoCasa: txt(o.codigo_casa, 30), Nombre: txt(o.nombre, 120), Estado: O_ESTADO[o.estado] || 'RECETA',
                Habilitada: !!o.habilitada, PorDefecto: !!o.por_defecto, Nota: txt(o.nota, 200), FechaActualizado: T(o.actualizado) || undefined,
            }, 'OpcionID');
            nOpc++;
            for (const pidOrig of [...new Set(o.productos || [])]) {
                const pid = proyectos.get(pidOrig);
                if (pid) await insertar(tx, 'DesOpcionProyectos', { OpcionID: oid, ProyectoID: pid });
                else aviso(`Opción ${o._id}: proyecto "${pidOrig}" no existe.`);
            }
        }
        contar('opciones de slot', opcsJson.length, nOpc);

        // ── Muestras ─────────────────────────────────────────────────────────
        const muestrasJson = lista(datos, 'muestras').sort((a, b) => String(a.creado || '').localeCompare(String(b.creado || '')));
        let nMuestras = 0;
        for (const m of muestrasJson) {
            const autor = persona(m.quien);
            const estadoId = m.estado ? estadosMuestra.get(m.estado) || null : null;
            if (m.estado && !estadoId) aviso(`Muestra ${m._id}: estado "${m.estado}" desconocido.`);
            const mid = await insertar(tx, 'DesMuestras', {
                EstadoID: estadoId, FechaEnvio: D(m.fecha_envio), Ronda: entero(m.ronda), Comentario: txt(m.comentario, 2000),
                AutorUsuarioID: autor.id || autorHost(m.autor), AutorTexto: autor.texto, IdOrigen: m._id.slice(0, 40),
                FechaAlta: T(m.creado) || undefined, FechaActualizado: T(m.actualizado) || undefined,
            }, 'MuestraID');
            nMuestras++;
            for (const [i, o] of (m.ordenes || []).entries()) {
                const numero = txt(o.numero, 40);
                let ordenId = null;
                if (numero) {
                    const r = await tx.request().input('N', sql.VarChar(40), numero)
                        .query('SELECT TOP 1 OrdenID FROM dbo.Ordenes WHERE CodigoOrden = @N ORDER BY OrdenID');
                    ordenId = r.recordset[0]?.OrdenID || null;
                    if (!ordenId) rep.ordenesSinMatch.push(numero);
                }
                await insertar(tx, 'DesMuestraOrdenes', { MuestraID: mid, OrdenID: ordenId, Numero: numero, Nombre: txt(o.nombre, 120), Orden: i + 1 });
            }
            const proys = Array.isArray(m.proyectos) && m.proyectos.length ? m.proyectos : m.proyecto_id ? [m.proyecto_id] : [];
            for (const [i, pidOrig] of [...new Set(proys)].entries()) {
                const pid = proyectos.get(pidOrig);
                if (pid) await insertar(tx, 'DesMuestraProyectos', { MuestraID: mid, ProyectoID: pid, Orden: i + 1 });
                else aviso(`Muestra ${m._id}: proyecto "${pidOrig}" no existe.`);
            }
            for (const t of [...new Set(m.tildes || [])]) {
                const tid = tildesMuestra.get(t);
                if (tid) await insertar(tx, 'DesMuestraTildesMarcadas', { MuestraID: mid, TildeID: tid });
                else aviso(`Muestra ${m._id}: tilde "${t}" desconocido.`);
            }
            if (Array.isArray(m.fotos) && m.fotos.length) rep.archivosSinBajar += m.fotos.length;
            await importarBitacora('MUESTRA', mid, m.bitacora);
        }
        contar('muestras', muestrasJson.length, nMuestras);

        // ── Tandas (el JSON del 12/10 no trae; el del pase puede traer) ──────
        const tandasJson = lista(datos, 'tandas').sort((a, b) => String(a.inicio || '').localeCompare(String(b.inicio || '')));
        let nTandas = 0;
        const tareaEnAbierta = new Set();
        for (const t of tandasJson) {
            const abierta = t.estado !== 'cerrada';
            const inicio = D(t.inicio) || D(t.creado);
            const fin = D(t.fin) || inicio;
            if (!inicio) { aviso(`Tanda ${t.nombre || t._id}: sin fechas; no se importó.`); continue; }
            const tid = await insertar(tx, 'DesTandas', {
                Nombre: txt(t.nombre, 60) || 'Tanda', Inicio: inicio, Fin: fin, Objetivo: txt(t.objetivo, 200),
                Estado: abierta ? 'ABIERTA' : 'CERRADA', CerradaEl: T(t.cerrada_el), Resumen: txt(t.resumen, 100),
                IdOrigen: t._id.slice(0, 40), FechaAlta: T(t.creado) || undefined, FechaActualizado: T(t.actualizado) || undefined,
            }, 'TandaID');
            nTandas++;
            const grupoDe = new Map();
            for (const [i, g] of (t.grupos || []).entries()) {
                const gid = await insertar(tx, 'DesTandaGrupos', { TandaID: tid, Nombre: txt(g.nombre, 60) || `Grupo ${i + 1}`, Orden: i + 1 }, 'GrupoID');
                for (const pidOrig of g.productos || []) if (!grupoDe.has(pidOrig)) grupoDe.set(pidOrig, gid);
            }
            const refs = (t.tareas || []).map(r => String(r).split('|')).filter(x => x[0] === 'p' && x.length === 3);
            const proysTanda = new Set([...(t.productos || []), ...refs.map(x => x[1])]);
            for (const pidOrig of proysTanda) {
                const pid = proyectos.get(pidOrig);
                if (pid) await insertar(tx, 'DesTandaProyectos', { TandaID: tid, ProyectoID: pid, GrupoID: grupoDe.get(pidOrig) || null });
            }
            const pendientesAlCerrar = new Set(t.pendientes || []);
            for (const [, pidOrig, sidOrig] of refs) {
                const tareaId = tareas.get(`${pidOrig}|${sidOrig}`);
                if (!tareaId) continue; // ref colgada (el prototipo también la descarta)
                if (abierta && tareaEnAbierta.has(tareaId)) { aviso(`Tanda ${t.nombre}: una tarea ya estaba en otra tanda abierta; quedó en la primera.`); continue; }
                if (abierta) tareaEnAbierta.add(tareaId);
                await insertar(tx, 'DesTandaTareas', {
                    TandaID: tid, TareaID: tareaId, Abierta: abierta,
                    PendienteAlCerrar: abierta ? null : pendientesAlCerrar.has(`p|${pidOrig}|${sidOrig}`),
                });
            }
            await importarBitacora('TANDA', tid, t.bitacora);
        }
        contar('tandas', tandasJson.length, nTandas);

        // ── Comentarios y "Esto me trabó" (el JSON del 12/10 no trae) ────────
        const comsJson = lista(datos, 'comentarios');
        let nComs = 0;
        for (const c of comsJson) {
            const [col, idOrig] = String(c.ref || '').split('/');
            const entidad = col === 'productos' ? 'PROYECTO' : col === 'solicitudes' ? 'SOLICITUD' : null;
            const eid = entidad === 'PROYECTO' ? proyectos.get(idOrig) : entidad === 'SOLICITUD' ? solicitudes.get(idOrig) : null;
            if (!eid || !txt(c.texto, 2000)) { aviso(`Comentario ${c._id}: no se pudo enlazar (${c.ref}).`); continue; }
            const quien = persona(c.quien);
            await insertar(tx, 'DesComentarios', {
                Entidad: entidad, EntidadID: eid, Texto: txt(c.texto, 2000), UsuarioID: quien.id || autorHost(c.autor),
                UsuarioNombre: txt(c.quien, 150), Fecha: T(c.fecha) || undefined,
            });
            nComs++;
        }
        contar('comentarios', comsJson.length, nComs);
        const fbJson = lista(datos, 'feedback');
        for (const f of fbJson) {
            const quien = persona(f.quien);
            await insertar(tx, 'DesFeedback', {
                Texto: txt(f.texto, 1500) || '—', Vista: txt(f.vista, 30), ProyectoID: f.pid ? proyectos.get(f.pid) || null : null,
                UsuarioID: quien.id, UsuarioNombre: txt(f.quien, 150), Fecha: T(f.fecha) || undefined,
            });
        }
        contar('feedback («Esto me trabó»)', fbJson.length, fbJson.length);

        // ── Configuración ────────────────────────────────────────────────────
        const cfg = datos.config || {};
        const setConfig = (clave, valor) => tx.request().input('C', sql.VarChar(40), clave).input('V', sql.NVarChar(sql.MAX), valor == null ? null : String(valor))
            .query(`MERGE dbo.DesConfig AS t USING (SELECT @C AS Clave) AS s ON t.Clave = s.Clave
                    WHEN MATCHED THEN UPDATE SET Valor = @V, FechaActualizado = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (Clave, Valor) VALUES (@C, @V);`);

        // Equipo → DesEquipo como editores (en el prototipo el equipo editaba todo). Los vendedores no
        // son del equipo: ven Pedidos por el menú de su rol.
        let nEquipo = 0;
        for (const m of cfg.equipo?.miembros || []) {
            if (m.rol === 'vendedor') { aviso(`Equipo: ${m.nombre} es vendedor; no se suma al equipo (ve Pedidos por el menú de su rol).`); continue; }
            const p = persona(m.nombre);
            if (!p.id) continue;
            const lineas = (m.lineas || []).map(l => LINEA_AREA[l]).filter(Boolean).join(',') || null;
            await tx.request().input('U', sql.Int, p.id).input('L', sql.VarChar(100), lineas)
                .query(`MERGE dbo.DesEquipo AS t USING (SELECT @U AS UsuarioID) AS s ON t.UsuarioID = s.UsuarioID
                        WHEN MATCHED THEN UPDATE SET Lineas = @L, Activo = 1
                        WHEN NOT MATCHED THEN INSERT (UsuarioID, Nivel, Lineas) VALUES (@U, 'EDITOR', @L);`);
            nEquipo++;
        }
        contar('equipo', (cfg.equipo?.miembros || []).length, nEquipo);

        // Orden manual de la lista de desarrollo
        let pos = 0;
        for (const idOrig of cfg.orden?.ids || []) {
            const pid = proyectos.get(idOrig);
            if (pid) await insertar(tx, 'DesOrdenLista', { ProyectoID: pid, Posicion: ++pos });
        }
        contar('orden manual de la lista', (cfg.orden?.ids || []).length, pos);
        if (cfg.orden?.quien) await setConfig('orden_quien', txt(cfg.orden.quien, 120));
        if (cfg.orden?.actualizado) await setConfig('orden_fecha', cfg.orden.actualizado);

        if (cfg.plan?.horizonte !== undefined) await setConfig('plan_horizonte', entero(cfg.plan.horizonte) ?? fabrica.PLAN.horizonte);
        if (cfg.plan?.tanda !== undefined) await setConfig('plan_tanda', entero(cfg.plan.tanda) ?? fabrica.PLAN.tanda);

        // Fuentes de moldes, sin las notas que parecen datos de acceso
        const fuentes = (cfg.fuentes?.items || []).map(f => {
            const nota = txt(f.nota, 300);
            if (nota && PARECE_CREDENCIAL.test(nota)) { rep.fuentesNotasOmitidas.push(`${f.grupo || ''} › ${f.nombre || f.url}`); return { ...f, nota: '' }; }
            return { grupo: txt(f.grupo, 60), url: txt(f.url, 500), nombre: txt(f.nombre, 120), nota: nota || '' };
        });
        if (fuentes.length) await setConfig('fuentes', JSON.stringify(fuentes));
        contar('fuentes de moldes', (cfg.fuentes?.items || []).length, fuentes.length);

        // Familias y etiquetas copiadas a mano: ya no se usan (salen del maestro). Se avisa lo que no coincide.
        if (cfg.listas?.etiquetas) for (const e of cfg.listas.etiquetas) if (!etiquetas.has(norm(e))) aviso(`Etiqueta "${e}" de las listas del prototipo no está en ProductoEtiqueta.`);
        for (const col of ['pines', 'vistas']) if (datos[col]) aviso(`"${col}" no se importa (PIN y vistas guardadas quedan del prototipo).`);

        // ── Verificación final ───────────────────────────────────────────────
        const r = await tx.request().query(`SELECT
            (SELECT COUNT(*) FROM dbo.DesProyectos WHERE Borrado = 0) AS proyectos,
            (SELECT COUNT(*) FROM dbo.DesTareas) AS tareas,
            (SELECT COUNT(*) FROM dbo.DesSolicitudes WHERE Borrado = 0) AS pedidos,
            (SELECT COUNT(*) FROM dbo.DesMuestras WHERE Borrado = 0) AS muestras,
            (SELECT COUNT(*) FROM dbo.DesCapacidades) AS capacidades,
            (SELECT COUNT(*) FROM dbo.DesOpcionesSlot) AS opciones,
            (SELECT COUNT(*) FROM dbo.DesBitacora) AS bitacora`);
        const enBase = r.recordset[0];

        if (CONFIRMAR) await tx.commit();
        else await tx.rollback();

        // ── Reporte ──────────────────────────────────────────────────────────
        const l = (s = '') => console.log(s);
        l();
        l(CONFIRMAR ? '══ IMPORTACIÓN GUARDADA ══' : '══ PRUEBA (no se guardó nada; para guardar agregá --confirmar) ══');
        l(`JSON: ${path.resolve(RUTA)}`);
        l();
        l('Conteos (JSON → importados):');
        for (const [k, v] of Object.entries(rep.conteos)) l(`  ${k.padEnd(30)} ${String(v.json).padStart(5)} → ${String(v.importados).padStart(5)}${v.json !== v.importados ? '   ⚠' : ''}`);
        l(`En la base antes del ${CONFIRMAR ? 'commit' : 'rollback'}: ${JSON.stringify(enBase)}`);
        l();
        l(`Personas sin usuario (quedan como texto): ${rep.personasSinUsuario.size ? '' : 'ninguna'}`);
        for (const [n, c] of [...rep.personasSinUsuario].sort((a, b) => b[1] - a[1])) l(`  · ${n} (${c})`);
        l(`REF que no están en el maestro (quedan como texto): ${rep.refSinArticulo.length ? '' : 'ninguno'}`);
        for (const x of rep.refSinArticulo) l(`  · ${x}`);
        l(`Órdenes de muestras que no están en Ordenes: ${rep.ordenesSinMatch.length ? rep.ordenesSinMatch.join(', ') : 'ninguna'}`);
        l(`Archivos referenciados que el JSON no trae (fotos, imágenes, archivos): ${rep.archivosSinBajar}`);
        l(`Notas de fuentes omitidas por parecer datos de acceso: ${rep.fuentesNotasOmitidas.length ? rep.fuentesNotasOmitidas.join(' · ') : 'ninguna'}`);
        l(`Avisos: ${rep.avisos.length ? '' : 'ninguno'}`);
        for (const a of rep.avisos) l(`  · ${a}`);
        process.exit(0);
    } catch (err) {
        await tx.rollback().catch(() => {});
        console.error(`\n✗ No se importó nada: ${err.message}`);
        process.exit(1);
    }
})();

// Plantilla guardada en el prototipo: reemplaza la de la misma clave o entra como nueva.
async function importarPlantilla(tx, doc, tipoId) {
    const clave = String(doc._id).slice(0, 40);
    const para = doc.para === 'correccion' ? 'CORRECCION' : doc.para === 'variante' ? 'VARIANTE' : 'PRODUCTO';
    const r = await tx.request().input('C', sql.VarChar(40), clave).query('SELECT PlantillaID FROM dbo.DesPlantillas WHERE Clave = @C');
    let pid = r.recordset[0]?.PlantillaID;
    if (pid) {
        await tx.request().input('P', sql.Int, pid).query('DELETE FROM dbo.DesPlantillaTareas WHERE PlantillaID = @P; DELETE FROM dbo.DesPlantillaEtapas WHERE PlantillaID = @P;');
        await tx.request().input('P', sql.Int, pid).input('N', sql.NVarChar(60), txt(doc.nombre, 60) || clave).input('Para', sql.VarChar(12), para)
            .input('T', sql.Int, tipoId(doc.desarrollo)).input('D', sql.NVarChar(200), txt(doc.descripcion, 200))
            .query('UPDATE dbo.DesPlantillas SET Nombre = @N, Para = @Para, TipoID = @T, Descripcion = @D, Activo = 1, FechaActualizado = GETDATE() WHERE PlantillaID = @P');
    } else {
        pid = await insertar(tx, 'DesPlantillas', { Clave: clave, Nombre: txt(doc.nombre, 60) || clave, Para: para, TipoID: tipoId(doc.desarrollo), Descripcion: txt(doc.descripcion, 200), Orden: 50 }, 'PlantillaID');
    }
    const etapas = Array.isArray(doc.etapas) && doc.etapas.length
        ? doc.etapas.map(e => ({ key: e.id, clave: null, nombre: txt(e.label, 40) || String(e.id), color: e.c || '#8a94a6' }))
        : fabrica.ETAPAS.map(e => ({ key: e.clave, clave: e.clave, nombre: e.nombre, color: e.color }));
    const ids = new Map();
    for (const [i, e] of etapas.entries()) ids.set(e.key, await insertar(tx, 'DesPlantillaEtapas', { PlantillaID: pid, Clave: e.clave, Nombre: e.nombre, Color: e.color, Orden: i + 1 }, 'EtapaID'));
    const orden = new Map();
    for (const t of doc.pasos || []) {
        const eid = ids.get(t.etapa) || ids.get(etapas[etapas.length - 1].key);
        orden.set(eid, (orden.get(eid) || 0) + 1);
        await insertar(tx, 'DesPlantillaTareas', {
            PlantillaID: pid, EtapaID: eid, Nombre: txt(t.nombre, 120) || 'Sin nombre', DiasHabiles: Math.max(0, parseInt(t.duracion, 10) || 0),
            Entregable: txt(t.entregable, 80), PideRef: !!t.ref, MarcaErp: !!t.erp, Orden: orden.get(eid),
        });
    }
}
