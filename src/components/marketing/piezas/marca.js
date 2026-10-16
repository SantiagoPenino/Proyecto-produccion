// Identidad visual de user para el compositor de piezas (/marketing/piezas).
// Sale del compositor que armó Marketing (Desktop/user-marca/user-marca/compositor/compositor-user.html)
// y del manual (USER-sistema-visual.md). Los paths son los de los SVG oficiales de logos/.

export const FORMATOS = {
    feed: { W: 1080, H: 1350, nombre: 'Posteo de feed' },
    historia: { W: 1080, H: 1920, nombre: 'Historia' },
};

// Tintas (texto del manual) y su sombra oscura, la de los halos.
export const TINTAS = { cian: '#22a9ff', magenta: '#ff0099', amarillo: '#ffff00' };
export const SOMBRAS = { cian: '#254159', magenta: '#5e063f', amarillo: '#443f0f' };

// Recuadro: el marco de 3 px a 40 px del borde. Las capas no salen de LIMITE_MARCO
// (16 px de aire contra la línea); sin marco, el límite es el borde de la pieza.
export const MARCO = { inset: 40, radio: 56, grosor: 3 };
export const LIMITE_MARCO = 56;

// Zona que tapa la interfaz de Instagram en las historias, arriba y abajo. Aproximada:
// es solo una guía del editor y no sale en el PNG.
export const ZONA_SEGURA_HISTORIA = 250;

// Colores que se pueden elegir. «auto» y «suave» siguen al fondo (blanco o gris sobre
// el negro, negro sobre la tinta), así una pieza que pasa a fondo de tinta se sigue leyendo.
export const COLORES = [
    { id: 'auto', nombre: 'Automático (blanco sobre negro, negro sobre tinta)' },
    { id: 'suave', nombre: 'Suave (gris sobre negro)' },
    { id: 'acento', nombre: 'Acento de la pieza (negro sobre tinta)' },
    { id: 'blanco', nombre: 'Blanco', hex: '#ffffff' },
    { id: 'negro', nombre: 'Negro', hex: '#000000' },
    { id: 'cian', nombre: 'Cian', hex: TINTAS.cian },
    { id: 'magenta', nombre: 'Magenta', hex: TINTAS.magenta },
    { id: 'amarillo', nombre: 'Amarillo', hex: TINTAS.amarillo },
];

export const resolverColor = (color, fondo, acento) => {
    const tinta = fondo === 'tinta';
    if (color === 'auto' || !color) return tinta ? '#000000' : '#ffffff';
    if (color === 'suave') return tinta ? 'rgba(0,0,0,0.72)' : '#a8a8a8';
    if (color === 'acento') return tinta ? '#000000' : TINTAS[acento] || TINTAS.magenta;
    return COLORES.find(c => c.id === color)?.hex || '#ffffff';
};

// Isotipo (la u con su barra), 52,39 × 76,78.
export const ISOTIPO = {
    w: 52.39, h: 76.78, paths: [
        'M52.39 72.31C52.39 74.15 51.29 75.73 49.72 76.42C49.19 76.65 48.59 76.78 47.97 76.78L4.42 76.78C1.98 76.78 0 74.79 0 72.31C0 69.85 1.98 67.84 4.42 67.84L47.97 67.84C48.59 67.84 49.19 67.97 49.72 68.21C51.29 68.89 52.39 70.47 52.39 72.31Z',
        'M0 0L11.43 0L11.43 34.76C11.43 42.79 16.87 48.79 25.02 48.79C33.28 48.79 39.17 42.79 39.17 34.3L39.17 0L50.6 0L50.6 57.74L39.17 57.74L39.17 51.28C35.21 56.04 29.09 58.87 22.19 58.87C8.94 58.87 0 49.25 0 36.91L0 0Z',
    ],
};

// Logotipo reducido con la Barra de Proceso, para fondo oscuro. Los colores de la barra son los
// de los vectores del manual (#00ABFF / #FF009D), como en el compositor de Marketing.
export const LOGOTIPO = {
    w: 240.08, h: 96.75, paths: [
        ['#FF009D', 'M122.22 86.24L117.87 96.75L57.85 96.75L62.19 86.24L122.22 86.24Z'],
        ['#FFFF00', 'M182.24 86.24L177.89 96.75L117.87 96.75L122.22 86.24L182.24 86.24Z'],
        ['#FFFFFF', 'M240.08 91.49C240.08 94.39 237.73 96.75 234.83 96.75L177.89 96.75L182.24 86.24L234.83 86.24C237.73 86.24 240.08 88.59 240.08 91.49Z'],
        ['#00ABFF', 'M62.2 86.24L57.85 96.75L5.26 96.75C2.35 96.75 0 94.39 0 91.49C0 88.59 2.35 86.24 5.26 86.24L62.2 86.24Z'],
        ['#FFFFFF', 'M0.66 6.54L14.09 6.54L14.09 47.37C14.09 56.81 20.47 63.86 30.05 63.86C39.76 63.86 46.67 56.81 46.67 46.84L46.67 6.54L60.11 6.54L60.11 74.37L46.67 74.37L46.67 66.79C42.02 72.38 34.84 75.7 26.72 75.7C11.16 75.7 0.66 64.4 0.66 49.9L0.66 6.54Z'],
        ['#FFFFFF', 'M67.36 53.2L80.26 53.23C81.84 60.94 88.48 64.95 96.86 64.97C104.18 64.98 108.7 61.53 108.72 56.35C108.72 52.22 105.8 49.29 99.42 47.55L86.93 44.46C74.83 41.38 68.59 34.98 68.61 25.27C68.64 12.9 78.63 4.94 92.33 4.97C108.16 5.01 118.51 14.74 120.35 27.51L107.45 27.48C105.87 19.76 99.09 15.76 92.18 15.75C85.66 15.73 81.79 19.18 81.78 23.97C81.78 28.23 85.09 31.16 91.47 32.77L103.17 35.85C115.67 39.07 121.91 45.6 121.88 55.31C121.86 67.01 112.13 75.77 96.97 75.74C80.48 75.7 69.73 66.11 67.36 53.2Z'],
        ['#FFFFFF', 'M234.49 18.51C225.71 18.51 219.33 25.29 219.33 35.8L219.33 74.37L205.89 74.37L205.89 6.54L219.19 6.54L219.19 14.92C222.52 9.47 227.97 6.01 235.42 6.01L240.07 6.01L240.07 18.51L234.49 18.51Z'],
        ['#FFFFFF', 'M142.09 41.6C142.09 41.6 142.37 19.83 163.14 17.22C173.68 15.89 181.65 23.18 184.19 29.29L142.09 41.6ZM185.17 54.89C182.58 58.34 179.16 60.78 175.81 62.42C173.02 63.77 170.29 64.58 167.13 64.77C162.55 65.14 158.11 64.1 153.86 61.78C149.6 59.44 146.42 56 144.44 52L198.64 36.14C198.37 32.55 197.53 29.06 196.14 25.79C193.31 19.14 188.23 13.41 181.11 9.52C163.73 0 142.82 6.9 133.62 23.71C129.78 30.71 128.47 38.21 129.4 45.31C129.86 48.85 130.87 52.28 132.4 55.51C132.84 56.44 133.32 57.36 133.85 58.25C137.1 63.8 142.04 68.21 148.31 71.65C151.21 73.24 156.41 75.74 165.89 75.74C171.15 75.74 176.31 74.99 180.88 72.97C186.42 70.53 191.13 67.04 194.86 62.1L185.17 54.89Z'],
    ],
};

// Asterisco de 8 pétalos, la viñeta de encabezado del manual (logos/user-asterisco-blanco.svg).
export const ASTERISCO = {
    w: 25.19, h: 25.19, paths: [
        'M12.59 12.59L9.65 25.19L15.53 25.19L12.59 12.59Z',
        'M12.59 12.59L19.42 23.58L23.57 19.42L12.59 12.59Z',
        'M12.59 12.59L25.19 15.53L25.19 9.65L12.59 12.59Z',
        'M12.59 12.59L23.57 5.77L19.42 1.61L12.59 12.59Z',
        'M12.59 12.59L15.53 0L9.65 0L12.59 12.59Z',
        'M12.59 12.59L5.77 1.61L1.61 5.77L12.59 12.59Z',
        'M12.59 12.59L0 9.65L0 15.53L12.59 12.59Z',
        'M12.59 12.59L1.61 19.42L5.77 23.58L12.59 12.59Z',
    ],
};

// Caras de las fuentes que usa la pieza. El canvas no espera a que una fuente cargue:
// si dibuja antes, usa otra y las medidas no coinciden, por eso el editor espera a estas.
export const FUENTES = [
    'italic 800 100px Inter',
    '800 100px Inter',
    '700 100px Inter',
    '500 100px Inter',
    '400 100px Inter',
    '300 100px Inter',
    '400 100px "Roboto Mono"',
];
