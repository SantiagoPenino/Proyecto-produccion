/**
 * Horas laborales de un área (utils/horarioLaboral.js) — plan INF-SIS-2026-04.
 * Funciones puras: no tocan la base.
 */
const { crearCalendario } = require('../utils/horarioLaboral');

// Instante de Uruguay (UTC−3) como Date
const uy = (s) => new Date(`${s}:00-03:00`);
const lunesAViernes = (area, ini, fin) => [1, 2, 3, 4, 5].map(d => ({ AreaID: area, DiaSemana: d, HoraInicio: ini, HoraFin: fin }));

const cal = crearCalendario({
    horarios: [
        ...lunesAViernes('SB', '07:00', '15:00'),
        // DF: dos tramos en el día
        ...lunesAViernes('DF', '06:00', '12:00'), ...lunesAViernes('DF', '13:00', '21:30'),
        // NOCHE: turno que pasa la medianoche (lunes a viernes de 22 a 06)
        ...lunesAViernes('NOCHE', '22:00', '06:00'),
        { AreaID: 'TPU ', DiaSemana: 1, HoraInicio: '09:00', HoraFin: '17:00' },  // AreaID con espacios, como en la base
    ],
    feriados: ['2026-10-12'],
});

describe('minutosLaborales', () => {
    test('dentro del mismo día', () => {
        // martes 15/09/2026
        expect(cal.minutosLaborales('SB', uy('2026-09-15T08:00'), uy('2026-09-15T10:30'))).toBe(150);
    });
    test('ingreso de noche: cuenta desde la apertura (SUB-24061: 00:07 → 14:29 = 7 h 29 min)', () => {
        expect(cal.minutosLaborales('SB', uy('2026-09-15T00:07'), uy('2026-09-15T14:29'))).toBe(7 * 60 + 29);
    });
    test('Pronto después del cierre: corta en el cierre', () => {
        expect(cal.minutosLaborales('SB', uy('2026-09-15T14:00'), uy('2026-09-15T19:00'))).toBe(60);
    });
    test('todo fuera de horario: 0', () => {
        expect(cal.minutosLaborales('SB', uy('2026-09-15T16:00'), uy('2026-09-15T23:00'))).toBe(0);
    });
    test('de viernes a lunes: el fin de semana no cuenta', () => {
        // viernes 18/09 14:00 → lunes 21/09 08:00 = 1 h + 1 h
        expect(cal.minutosLaborales('SB', uy('2026-09-18T14:00'), uy('2026-09-21T08:00'))).toBe(120);
    });
    test('feriado: no cuenta', () => {
        // viernes 09/10 14:00 → martes 13/10 08:00; el lunes 12/10 es feriado = 1 h + 1 h
        expect(cal.minutosLaborales('SB', uy('2026-10-09T14:00'), uy('2026-10-13T08:00'))).toBe(120);
    });
    test('dos tramos en el día: el corte del mediodía no cuenta', () => {
        expect(cal.minutosLaborales('DF', uy('2026-09-15T11:00'), uy('2026-09-15T14:00'))).toBe(120);
    });
    test('turno que pasa la medianoche', () => {
        // martes 23:00 → miércoles 05:00, dentro del turno de 22 a 06 que arrancó el martes
        expect(cal.minutosLaborales('NOCHE', uy('2026-09-15T23:00'), uy('2026-09-16T05:00'))).toBe(360);
        // el turno del viernes sigue el sábado a la madrugada; el sábado no arranca turno
        expect(cal.minutosLaborales('NOCHE', uy('2026-09-19T00:00'), uy('2026-09-20T00:00'))).toBe(360);
    });
    test('área sin horario: lunes a viernes de 9 a 17', () => {
        expect(cal.tieneHorario('TERMINAC')).toBe(false);
        expect(cal.minutosLaborales('TERMINAC', uy('2026-09-15T08:00'), uy('2026-09-15T10:00'))).toBe(60);
    });
    test('código equivalente: SUB usa el horario de SB; AreaID con espacios', () => {
        expect(cal.tieneHorario('SUB')).toBe(true);
        expect(cal.minutosLaborales('SUB', uy('2026-09-15T08:00'), uy('2026-09-15T10:30'))).toBe(150);
        expect(cal.tieneHorario('tpu')).toBe(true);
    });
    test('intervalo vacío o al revés: 0', () => {
        expect(cal.minutosLaborales('SB', uy('2026-09-15T10:00'), uy('2026-09-15T10:00'))).toBe(0);
        expect(cal.minutosLaborales('SB', uy('2026-09-15T10:00'), uy('2026-09-15T09:00'))).toBe(0);
    });
});

describe('minutosEnVentanas (espera del cliente)', () => {
    test('se recorta al ciclo y las ventanas que se pisan cuentan una vez', () => {
        const v = [[uy('2026-09-15T06:00'), uy('2026-09-15T09:00')], [uy('2026-09-15T08:00'), uy('2026-09-15T10:00')]];
        // ciclo desde las 08:30: ventana unida 06–10 recortada a 08:30–10 = 90 min laborales
        expect(cal.minutosEnVentanas('SB', v, uy('2026-09-15T08:30'), uy('2026-09-15T14:00'))).toBe(90);
    });
});

describe('minutosJornada', () => {
    test('promedio de los días con horario', () => {
        expect(cal.minutosJornada('SB')).toBe(480);
        expect(cal.minutosJornada('DF')).toBe(6 * 60 + 8.5 * 60);
        expect(cal.minutosJornada('NOCHE')).toBe(480);
        expect(cal.minutosJornada('TERMINAC')).toBe(480);
    });
});
