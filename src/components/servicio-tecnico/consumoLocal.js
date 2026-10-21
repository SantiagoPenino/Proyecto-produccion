// Consumo eléctrico y costo de un local (Servicio Técnico → Locales, 20/10/2026). Cuentas puras, sin React: la
// pantalla las corre con lo que trae GET /servicio-tecnico/locales, así un "¿y si agrego esta máquina?" se calcula
// en el momento. Los datos salen de la ficha técnica de cada máquina (secciones ele, dim e ins: texto tal cual se
// escribió) y del horario de su área en Planificación (ConfigHorarioLaboral).
//
// "A pleno" = todas las máquinas a su potencia nominal durante todo el horario de su área. Es el techo: lo que se
// gasta "palo y palo". El consumo real es menor (no todo anda todo el tiempo).

export const SEMANAS_POR_MES = 52 / 12;
const MIN_SEMANA = 7 * 1440;

export const num = (v) => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

const aMinutos = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// [desde, hasta) en minutos del día; si desde > hasta, cruza la medianoche (ej. valle 22:00 a 07:00).
const enRango = (t, desde, hasta) => {
    if (desde == null || hasta == null || desde === hasta) return false;
    return desde < hasta ? (t >= desde && t < hasta) : (t >= desde || t < hasta);
};

// Datos eléctricos de una máquina a partir de su ficha. La corriente: la de la ficha; si no está, se estima con la
// potencia nominal (monofásica P / V; trifásica P / (√3 · V), factor de potencia 1). Tensión por defecto: 230 V
// monofásica, 400 V trifásica.
export function datosMaquina(ficha = {}) {
    const ele = ficha.ele || {}, ins = ficha.ins || {}, dim = ficha.dim || {};
    const potNom = num(ele.potNom);
    const trifasica = ele.fases === 'Trifásica';
    const tension = num(ele.tension) || (trifasica ? 400 : 230);
    const corrienteFicha = num(ele.corriente);
    const corriente = corrienteFicha != null ? corrienteFicha
        : potNom != null ? (trifasica ? potNom * 1000 / (Math.sqrt(3) * tension) : potNom * 1000 / tension) : null;
    return {
        potNom,
        potMax: num(ele.potMax) ?? potNom,
        potReposo: num(ele.potReposo),
        trifasica,
        fasesCargadas: !!ele.fases,
        tension,
        corriente,
        corrienteEstimada: corrienteFicha == null && corriente != null,
        aire: ins.aire === 'Sí requiere' ? (num(ins.aireCaudal) || 0) : 0,
        aireSinCaudal: ins.aire === 'Sí requiere' && num(ins.aireCaudal) == null,
        extraccion: num(ins.caudalExtraccion) || 0,
        peso: num(dim.peso),
        largo: num(dim.largo), ancho: num(dim.ancho),
    };
}

// Banda de la tarifa en un momento de la semana. SIMPLE: todo igual. DOBLE: punta / fuera de punta (llano).
// TRIPLE: punta / valle / llano. La punta puede ser solo de lunes a viernes.
export function bandaDe(diaISO, minutoDia, energia) {
    const tipo = energia?.TipoTarifa || 'SIMPLE';
    if (tipo === 'SIMPLE') return 'simple';
    const habil = diaISO <= 5;
    if ((!energia.PuntaSoloHabiles || habil) && enRango(minutoDia, aMinutos(energia.PuntaDesde), aMinutos(energia.PuntaHasta))) return 'punta';
    if (tipo === 'TRIPLE' && enRango(minutoDia, aMinutos(energia.ValleDesde), aMinutos(energia.ValleHasta))) return 'valle';
    return 'llano';
}

export const BANDAS_DE = (energia) => {
    const tipo = energia?.TipoTarifa || 'SIMPLE';
    return tipo === 'SIMPLE' ? ['simple'] : tipo === 'DOBLE' ? ['punta', 'llano'] : ['punta', 'llano', 'valle'];
};
export const ETIQUETA_BANDA = { simple: 'Tarifa única', punta: 'Punta', llano: 'Llano', valle: 'Valle' };
export const precioDe = (banda, energia) => ({
    simple: energia?.PrecioSimple, punta: energia?.PrecioPunta, llano: energia?.PrecioLlano, valle: energia?.PrecioValle,
}[banda] ?? null);

// Minutos de una semana por banda: los que el área trabaja y los que no. horario = [{ DiaSemana 1..7 (ISO),
// HoraInicio 'HH:MM', HoraFin 'HH:MM' }]; un turno que termina antes de empezar cruza la medianoche.
export function minutosSemana(horario = [], energia = null) {
    const trabaja = new Uint8Array(MIN_SEMANA);
    for (const t of horario) {
        const d = aMinutos(t.HoraInicio), h = aMinutos(t.HoraFin);
        if (d == null || h == null || !(t.DiaSemana >= 1 && t.DiaSemana <= 7)) continue;
        let dur = h - d;
        if (dur <= 0) dur += 1440;
        const ini = (t.DiaSemana - 1) * 1440 + d;
        for (let i = 0; i < dur; i++) trabaja[(ini + i) % MIN_SEMANA] = 1;
    }
    const trabajo = {}, fuera = {};
    let total = 0;
    for (let m = 0; m < MIN_SEMANA; m++) {
        const b = bandaDe(Math.floor(m / 1440) + 1, m % 1440, energia);
        if (trabaja[m]) { trabajo[b] = (trabajo[b] || 0) + 1; total++; } else fuera[b] = (fuera[b] || 0) + 1;
    }
    return { trabajo, fuera, minutosTrabajo: total };
}

// kWh y costo por mes de una potencia (kW) repartida en minutos por banda de una semana.
function energiaMes(kw, minutosPorBanda, energia) {
    const kwh = {}, costo = {};
    let kwhTotal = 0, costoTotal = 0, faltaPrecio = false;
    for (const [banda, min] of Object.entries(minutosPorBanda)) {
        const k = kw * (min / 60) * SEMANAS_POR_MES;
        kwh[banda] = k; kwhTotal += k;
        const p = precioDe(banda, energia);
        if (p == null) { faltaPrecio = faltaPrecio || k > 0; costo[banda] = null; } else { costo[banda] = k * p; costoTotal += k * p; }
    }
    return { kwh, costo, kwhTotal, costoTotal: faltaPrecio ? null : costoTotal };
}

// Una máquina: potencia, horas que trabaja su área y lo que consume y cuesta por mes a pleno. `reposoFuera`: si queda
// prendida fuera de horario, lo que consume en reposo.
export function consumoMaquina(equipo, horarioArea, energia) {
    const d = datosMaquina(equipo.ficha);
    const ms = minutosSemana(horarioArea || [], energia);
    const pleno = d.potNom != null ? energiaMes(d.potNom, ms.trabajo, energia) : null;
    const reposoFuera = d.potReposo != null ? energiaMes(d.potReposo, ms.fuera, energia) : null;
    return { ...d, horasSemana: ms.minutosTrabajo / 60, sinHorario: !(horarioArea || []).length, pleno, reposoFuera };
}

// Resumen de un conjunto de máquinas (un local o una planta): potencias, corriente, aire, extracción, peso y costo.
// Corriente por fase: las trifásicas cargan las tres; las monofásicas se suponen repartidas parejas (un tercio en cada
// fase). Si se cargan todas en la misma fase, esa fase lleva mucho más: el aviso está en la pantalla.
export function resumen(equipos, horarios, energia) {
    const maquinas = equipos.map(e => ({ equipo: e, c: consumoMaquina(e, horarios?.[e.AreaID], energia) }));
    const r = {
        maquinas,
        cantidad: maquinas.length,
        potNom: 0, potMax: 0, potReposo: 0,
        corrienteTri: 0, corrienteMono: 0,
        aire: 0, extraccion: 0, peso: 0,
        kwhMes: 0, costoMes: 0, faltaPrecio: false,
        kwhBanda: {}, costoBanda: {},
        reposoFueraKwhMes: 0, reposoFueraCostoMes: 0,
        costoHoraBanda: {},   // $ por hora con todas andando a la vez, en cada banda
        sinPotencia: [], sinFases: [], sinHorario: [], aireSinCaudal: [], sinPeso: [],
    };
    for (const { equipo, c } of maquinas) {
        // El peso cuenta aunque la máquina no tenga la potencia cargada.
        if (c.peso != null) r.peso += c.peso; else r.sinPeso.push(equipo);
        if (c.potNom == null) { r.sinPotencia.push(equipo); continue; }
        r.potNom += c.potNom;
        r.potMax += c.potMax ?? c.potNom;
        r.potReposo += c.potReposo || 0;
        if (c.trifasica) r.corrienteTri += c.corriente || 0; else r.corrienteMono += c.corriente || 0;
        if (!c.fasesCargadas) r.sinFases.push(equipo);
        if (c.sinHorario) r.sinHorario.push(equipo);
        r.aire += c.aire; if (c.aireSinCaudal) r.aireSinCaudal.push(equipo);
        r.extraccion += c.extraccion;
        if (c.pleno) {
            r.kwhMes += c.pleno.kwhTotal;
            for (const [b, k] of Object.entries(c.pleno.kwh)) r.kwhBanda[b] = (r.kwhBanda[b] || 0) + k;
            for (const [b, v] of Object.entries(c.pleno.costo)) if (v != null) r.costoBanda[b] = (r.costoBanda[b] || 0) + v;
            if (c.pleno.costoTotal == null) r.faltaPrecio = true; else r.costoMes += c.pleno.costoTotal;
        }
        if (c.reposoFuera) { r.reposoFueraKwhMes += c.reposoFuera.kwhTotal; r.reposoFueraCostoMes += c.reposoFuera.costoTotal || 0; }
    }
    r.corrientePorFase = r.corrienteTri + r.corrienteMono / 3;
    for (const b of BANDAS_DE(energia)) {
        const p = precioDe(b, energia);
        r.costoHoraBanda[b] = p == null ? null : r.potNom * p;
    }
    if (r.faltaPrecio) r.costoMes = null;
    const contratada = energia?.PotenciaContratadaKW;
    r.potenciaContratada = contratada ?? null;
    r.usoContratada = contratada ? r.potNom / contratada : null;
    r.picoContratada = contratada ? r.potMax / contratada : null;
    r.cargoPotenciaMes = contratada != null && energia?.CargoPotenciaKW != null ? contratada * energia.CargoPotenciaKW : null;
    return r;
}

// Carga de un tablero (21/10): las máquinas que cuelgan de él, a pleno. Trifásico: corriente por fase como en
// `resumen` (las monofásicas repartidas parejas entre las tres). Monofásico: todo va a la misma fase; una máquina
// trifásica ahí es un error y se marca. `uso` = corriente / térmica.
export function cargaTablero(equipos, { fases = 'tri', termicaA = null } = {}) {
    let potNom = 0, potMax = 0, iTri = 0, iMono = 0;
    const sinPotencia = [], triEnMono = [];
    for (const e of equipos) {
        const d = datosMaquina(e.ficha);
        if (d.potNom == null) { sinPotencia.push(e); continue; }
        potNom += d.potNom;
        potMax += d.potMax ?? d.potNom;
        if (d.trifasica) { iTri += d.corriente || 0; if (fases === 'mono') triEnMono.push(e); } else iMono += d.corriente || 0;
    }
    const corriente = fases === 'mono' ? iMono + iTri : iTri + iMono / 3;
    return { potNom, potMax, corriente, sinPotencia, triEnMono, uso: termicaA ? corriente / termicaA : null };
}
