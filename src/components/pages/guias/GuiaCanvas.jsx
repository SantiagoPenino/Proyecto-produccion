import { Guia, Hoja, Encabezado, Titulo, Banner, Columnas, Tarjeta, Texto, Aclaracion, M, Cifra, Lista, Nota, Tabla, PieHoja } from './bloques';
import { DiagramaCanvas, DiagramaBastidor, Leyenda } from './diagramas';

const TEMA = { acento: '#22A8E0', texto: '#0B6A99', suave: '#E6F5FC', sobre: '#FFFFFF' };
const ENC = { anio: '2026', numero: '01.', seccion: 'Guía de', destacado: 'cuadros canvas', marca: 'Gran formato · Productos terminados' };
const PIE = { etiqueta: 'CUADROS CANVAS', fecha: 'Octubre, 2026', total: 2 };

/** Paso numerado del pedido: número, título y explicación. */
function Paso({ n, titulo, children }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-[var(--g-ac)] text-white text-[12px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
      <div><p className="font-bold text-[14.5px] text-zinc-900">{titulo}</p><Texto>{children}</Texto></div>
    </div>
  );
}

export default function GuiaCanvas() {
  return (
    <Guia tema={TEMA}>
      {/* ── Página 1 ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Titulo linea1="Cómo mandar el arte de un" linea2="cuadro canvas" />
        <Banner>
          <b className="text-[19px] sm:text-[22px]">Arte = medida final + 5 cm por lado.</b><br />
          Una sola regla, igual para todas las medidas.
        </Banner>
        <Columnas
          izquierda={
            <Tarjeta titulo="La regla">
              <DiagramaCanvas />
              <Texto>Esos 5 cm se doblan sobre el bastidor y no se ven de frente. Aplica a todos los cuadros, del más chico al más grande.</Texto>
              <Texto><b>Si el archivo no mide exactamente eso, el sistema lo rechaza.</b></Texto>
            </Tarjeta>
          }
          derecha={
            <Tarjeta numero={1} titulo="Sacá la medida del arte" nota="paso 1 de 3">
              <Cifra valor="final + 10 cm" detalle="en el ancho y en el alto" />
              <Tabla
                columnas={['Medida final', 'Arte a enviar']}
                filas={[
                  ['30 x 40 cm', <b className="text-[var(--g-tx)]">40 x 50 cm</b>],
                  ['40 x 60 cm', <b className="text-[var(--g-tx)]">50 x 70 cm</b>],
                  ['50 x 50 cm', <b className="text-[var(--g-tx)]">60 x 60 cm</b>],
                  ['60 x 90 cm', <b className="text-[var(--g-tx)]">70 x 100 cm</b>],
                  ['100 x 100 cm', <b className="text-[var(--g-tx)]">110 x 110 cm</b>],
                  ['115 x 115 cm', <b className="text-[var(--g-tx)]">125 x 125 cm</b>],
                ]}
              />
              <Aclaracion>Ejemplos del cálculo. Al elegir el producto, el sistema te muestra la medida exacta que espera. Por ejemplo, para un cuadro de 30 x 40 cm el arte mide <M>40 x 50 cm</M>.</Aclaracion>
              <Nota><b>El arte va en la medida final más 5 cm de borde en cada lado.</b><br />Siempre a escala 1:1. El sistema compara la medida del archivo con la del producto.</Nota>
            </Tarjeta>
          }
        />
        <PieHoja {...PIE} pagina={1} />
      </Hoja>

      {/* ── Página 2 ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Tarjeta numero={2} titulo="Qué pasa con esos 5 cm" nota="paso 2 de 3">
          <div className="grid md:grid-cols-2 gap-5 items-start">
            <div className="flex flex-col gap-3">
              <DiagramaCanvas resguardo />
              <Leyenda items={[['cian', 'Se envuelve: 5 cm por lado'], ['gris', 'Resguardo recomendado: 3 cm más adentro']]} />
            </div>
            <div className="flex flex-col gap-3">
              <DiagramaBastidor />
              <Lista items={[
                'El borde se dobla hacia atrás y se grapa al bastidor: de frente no se ve.',
                'De costado sí se ve, así que el fondo tiene que seguir hasta el filo del archivo.',
                'Dejá 3 cm de resguardo dentro de la cara visible: el canto del bastidor y el tensado se comen un poco del borde.',
                'Nunca pongas texto ni logos en la franja de 5 cm.',
              ]} />
            </div>
          </div>
          <Nota><b>El fondo llega hasta el borde del archivo. El contenido, 8 cm más adentro.</b><br />Son los 5 cm que se envuelven más 3 cm de resguardo.</Nota>
        </Tarjeta>
        <Tarjeta numero={3} titulo="Al subir el pedido" nota="paso 3 de 3">
          <div className="grid md:grid-cols-2 gap-5 items-start">
            <div className="flex flex-col gap-3">
              <Paso n={1} titulo="Elegí el producto exacto">Categoría Productos Terminados, Variante Cuadros Canvas y después el producto con la medida del cuadro que querés.</Paso>
              <Paso n={2} titulo="El material lo define el producto">El material de impresión viene fijado por el producto. La tinta viene sugerida y esa sí la podés cambiar.</Paso>
              <Paso n={3} titulo="Subí el arte en la medida que pide">Si el archivo no coincide, salta un error de validación y no te deja avanzar hasta que lo corrijas.</Paso>
              <Paso n={4} titulo="Los cuadros no van con urgencia">Los productos terminados llevan armado en taller, así que el pedido sigue siempre como Normal.</Paso>
            </div>
            <div className="flex flex-col gap-3">
              <div className="rounded-r-lg border-l-4 border-[#F04E4E] bg-[#FDEEEE] px-4 py-3 flex flex-col gap-1.5">
                <p style={{ fontFamily: "'Roboto Mono', monospace" }} className="text-[11px] font-bold tracking-wider text-[#E03C3C]">ERROR DE VALIDACIÓN</p>
                <Texto><b>Si la medida no coincide vas a ver algo así:</b></Texto>
                <Texto>Para un cuadro de 40 x 60 cm el arte debe medir 50 x 70 cm (40 x 60 de medida final + 5 cm de borde por lado). El archivo que cargaste no mide esa medida.</Texto>
                <Texto><b>La solución:</b> sacá el archivo, corregí la medida y volvé a subirlo. No lo escales al imprimir.</Texto>
              </div>
              <div className="rounded-r-lg border-l-4 border-[var(--g-ac)] bg-zinc-100 px-4 py-3 flex flex-col gap-2">
                <p style={{ fontFamily: "'Roboto Mono', monospace" }} className="text-[11px] font-bold tracking-wider">CHECKLIST ANTES DE MANDAR</p>
                <Lista items={[
                  'El archivo mide la medida final más 10 cm de ancho y de alto.',
                  'Está a escala 1:1, sin reducir ni ampliar.',
                  'No hay texto ni logos en los 8 cm del borde.',
                ]} />
              </div>
            </div>
          </div>
          <Nota><b>Antes de mandar: comprobá que el archivo mida final + 10 cm de ancho y de alto.</b><br />Es el chequeo que evita el 90 % de los rebotes en cuadros canvas.</Nota>
        </Tarjeta>
        <PieHoja {...PIE} pagina={2} />
      </Hoja>
    </Guia>
  );
}
