/**
 * Pasos del ciclo en planta (services/cicloPlantaService.js, 28/10/2026): en qué se fueron los minutos de cada orden
 * según las marcas del historial. Funciones puras: no tocan la base.
 */
const { crearCalendario } = require('../utils/horarioLaboral');
const { pasosDe } = require('../services/cicloPlantaService');

const uy = (s) => new Date(`${s}:00-03:00`);
const ms = (s) => uy(s).getTime();
const lunesAViernes = (area, ini, fin) => [1, 2, 3, 4, 5].map(d => ({ AreaID: area, DiaSemana: d, HoraInicio: ini, HoraFin: fin }));
const cal = crearCalendario({
    horarios: [...lunesAViernes('DF', '08:00', '17:00'), ...lunesAViernes('SB', '08:00', '17:00'), ...lunesAViernes('TERMINAC', '08:00', '17:00')],
    feriados: [],
});
const h = (estado, fecha, detalle = '') => ({ Estado: estado, FechaInicio: uy(fecha), Detalle: detalle });
const total = (p) => Object.values(p).reduce((t, x) => t + x, 0);

describe('pasos del ciclo', () => {
    test('DTF: lote, máquina, producción y control (miércoles 28/10)', () => {
        const hist = [
            h('Pendiente', '2026-10-28 08:00', 'Archivos completos, orden activada'),
            h('En Lote', '2026-10-28 09:00', 'Asignado a Lote 26oct28-df-01'),
            h('En Maquina', '2026-10-28 09:00', 'Asignado a Maquina DTF-2'),
            h('En Maquina', '2026-10-28 10:30', 'Inicio Produccion - Maquina DTF-2 / Lote 26oct28-df-01'),
            h('Control y Calidad', '2026-10-28 11:00', 'Fin Impresion - Enviado a Control / Lote 26oct28-df-01 - Maquina DTF-2'),
            h('Pronto', '2026-10-28 11:20', 'Completada manualmente'),
        ];
        const p = pasosDe({ AreaID: 'DF' }, cal, hist, [], ms('2026-10-28 08:00'), ms('2026-10-28 11:20'), 200);
        expect(p).toEqual({ lote: 60, espera: 90, produccion: 30, control: 20 });
    });

    test('sin «Fin Impresion»: el rato hasta Pronto queda en producción', () => {
        const hist = [
            h('Pendiente', '2026-10-28 08:00'),
            h('En Lote', '2026-10-28 08:10'),
            h('En Maquina', '2026-10-28 08:30', 'Inicio Produccion - Maquina DTF-1 / Lote x'),
        ];
        const p = pasosDe({ AreaID: 'DF' }, cal, hist, [], ms('2026-10-28 08:00'), ms('2026-10-28 09:00'), 60);
        expect(p).toEqual({ lote: 10, espera: 20, produccion: 30 });
    });

    test('pausa: vuelve a «esperando máquina» hasta que retoma', () => {
        const hist = [
            h('En Lote', '2026-10-28 08:00'),
            h('En Maquina', '2026-10-28 08:00', 'Inicio Produccion - Maquina DTF-1 / Lote x'),
            h('En Maquina', '2026-10-28 08:20', 'Produccion Pausada - Lote x'),
            h('En Maquina', '2026-10-28 08:50', 'Inicio Produccion - Maquina DTF-1 / Lote x'),
        ];
        const p = pasosDe({ AreaID: 'DF' }, cal, hist, [], ms('2026-10-28 08:00'), ms('2026-10-28 09:00'), 60);
        expect(p).toEqual({ espera: 30, produccion: 30 });
    });

    test('SUB: la producción después de «Pasa a Calandra» es la calandra; el control es aparte', () => {
        const hist = [
            h('Pendiente', '2026-10-28 08:00'),
            h('En Lote', '2026-10-28 08:05'),
            h('En Maquina', '2026-10-28 08:30', 'Inicio Produccion - Maquina SB-1 / Lote x'),
            h('En Maquina', '2026-10-28 09:30', 'Fin Impresion - Pasa a Calandra x - Maquina CALANDRA 1'),
            h('En Maquina', '2026-10-28 11:00', 'Inicio Produccion - Maquina CALANDRA 1 / Lote x'),
            h('Control y Calidad', '2026-10-28 11:40', 'Fin Impresion - Enviado a Control / Lote x - Maquina CALANDRA 1'),
        ];
        const p = pasosDe({ AreaID: 'SB' }, cal, hist, [], ms('2026-10-28 08:00'), ms('2026-10-28 12:00'), 240);
        expect(p).toEqual({ lote: 5, espera: 25, produccion: 60, cola_calandra: 90, calandra: 40, control: 20 });
    });

    test('fuera de horario y la espera del cliente no cuentan; los pasos suman el ciclo', () => {
        const hist = [
            h('Pendiente', '2026-10-28 16:00'),
            h('En Lote', '2026-10-29 09:00'),        // la noche no cuenta: 1 h el 28 + 1 h el 29
        ];
        const ventanas = [[ms('2026-10-29 08:30'), ms('2026-10-29 09:00')]];  // consulta al cliente: 30 min
        const p = pasosDe({ AreaID: 'DF' }, cal, hist, ventanas, ms('2026-10-28 16:00'), ms('2026-10-29 10:00'), 150);
        expect(p).toEqual({ lote: 90, espera: 60 });
        expect(total(p)).toBe(150);
    });

    test('TERMINAC: arranca en «hasta recibir el material»; las marcas de antes del inicio no suman', () => {
        const hist = [
            h('Ingresado', '2026-10-28 07:00'),
            h('Material Recibido', '2026-10-28 15:00'),
            h('En Terminaciones', '2026-10-28 15:30'),
            h('Control y Calidad', '2026-10-28 15:30'),
            h('Finalizado', '2026-10-28 15:40'),
        ];
        const p = pasosDe({ AreaID: 'TERMINAC' }, cal, hist, [], ms('2026-10-28 09:00'), ms('2026-10-28 15:40'), 400);
        expect(p).toEqual({ material: 360, produccion: 30, control: 10 });
    });

    // (29/10) El tilde «impresa» de la orden manda sobre los botones del lote.
    test('tilde antes de «Iniciar producción» del lote (DTF-37461): espera+impresión juntas, el inicio tardío no cuenta', () => {
        const hist = [
            h('Pendiente', '2026-10-28 08:00'),
            h('En Lote', '2026-10-28 08:10', 'Asignado a Lote x'),
            h('En Maquina', '2026-10-28 08:10', 'Asignado a Maquina DTF-3'),
            h('En Maquina', '2026-10-28 10:55', 'Inicio Produccion - Maquina DTF-3 / Lote x'),
        ];
        const o = { AreaID: 'DF', FechaImpreso: uy('2026-10-28 09:30') };
        const p = pasosDe(o, cal, hist, [], ms('2026-10-28 08:00'), ms('2026-10-28 11:00'), 180);
        expect(p).toEqual({ lote: 10, en_lote: 80, control: 90 });
    });

    test('tilde después del inicio: producción hasta el tilde y control desde ahí, aunque el lote no marque el fin', () => {
        const hist = [
            h('En Lote', '2026-10-28 08:00'),
            h('En Maquina', '2026-10-28 08:30', 'Inicio Produccion - Maquina DTF-1 / Lote x'),
        ];
        const o = { AreaID: 'DF', FechaImpreso: uy('2026-10-28 09:00') };
        const p = pasosDe(o, cal, hist, [], ms('2026-10-28 08:00'), ms('2026-10-28 10:00'), 120);
        expect(p).toEqual({ espera: 30, produccion: 30, control: 60 });
    });

    test('SUB con «Iniciar» y «Pasa a Calandra» apretados juntos al final: desde el tilde espera la calandra', () => {
        const seg = (s) => new Date(`${s}-03:00`);
        const hist = [
            h('Pendiente', '2026-10-28 08:00'),
            h('En Lote', '2026-10-28 08:10'),
            h('En Maquina', '2026-10-28 08:12', 'Asignado a Maquina FEDAR 2'),
            { Estado: 'En Maquina', FechaInicio: seg('2026-10-28T10:00:30'), Detalle: 'Inicio Produccion - Maquina FEDAR 2 / Lote x' },
            { Estado: 'En Maquina', FechaInicio: seg('2026-10-28T10:00:30'), Detalle: 'Fin Impresion - Pasa a Calandra x - Maquina CALANDRA 1' },
            h('En Maquina', '2026-10-28 13:00', 'Inicio Produccion - Maquina CALANDRA 1 / Lote x'),
        ];
        const o = { AreaID: 'SB', FechaImpreso: uy('2026-10-28 10:00') };
        const p = pasosDe(o, cal, hist, [], ms('2026-10-28 08:00'), ms('2026-10-28 13:30'), 330);
        expect(p).toEqual({ lote: 10, en_lote: 110, cola_calandra: 180, calandra: 30 });
    });

    test('el tilde que pone el sistema al completar (mismo minuto que Pronto) no cuenta', () => {
        const hist = [
            h('Pendiente', '2026-10-28 08:00'),
            h('En Lote', '2026-10-28 08:10'),
            h('En Maquina', '2026-10-28 08:30', 'Inicio Produccion - Maquina DTF-1 / Lote x'),
        ];
        const o = { AreaID: 'DF', FechaImpreso: uy('2026-10-28 09:00') };
        const p = pasosDe(o, cal, hist, [], ms('2026-10-28 08:00'), ms('2026-10-28 09:00') + 20000, 60);
        expect(p).toEqual({ lote: 10, espera: 20, produccion: 30 });
    });

    test('el redondeo no deja diferencia con el ciclo', () => {
        const hist = [h('En Lote', '2026-10-28 08:00'), h('En Maquina', '2026-10-28 08:00', 'Inicio Produccion - x')];
        const p = pasosDe({ AreaID: 'DF' }, cal, hist, [], ms('2026-10-28 08:00'), ms('2026-10-28 08:30') + 20000, 30);
        expect(total(p)).toBe(30);
    });
});
