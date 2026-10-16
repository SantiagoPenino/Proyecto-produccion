import { Guia, Hoja, Encabezado, Titulo, Banner, Tarjeta, Cifra, Lista, Nota, Tabla, PieHoja } from './bloques';
import { DiagramaLona, Leyenda } from './diagramas';

// Amarillo de gran formato, como ECOUV; los diagramas usan magenta (soldadura), amarillo (bolsillo) y cian (ojales).
const TEMA = { acento: '#FFE600', texto: '#6B5E00', suave: '#FFF6D6', sobre: '#1A1A1A', insignia: '#1A1A1A' };
const ENC = { anio: '2026', numero: '01.', seccion: 'Guía de', destacado: 'terminaciones de lona', marca: 'Gran formato · Lonas' };
const PIE = { etiqueta: 'TERMINACIONES DE LONA', fecha: 'Octubre, 2026', total: 3 };

const SOLDADURA = { arriba: 'soldadura', abajo: 'soldadura', izquierda: 'soldadura', derecha: 'soldadura' };
const BOLSILLOS = { arriba: 'bolsillo', abajo: 'bolsillo', izquierda: 'soldadura', derecha: 'soldadura' };
const TODO_JUNTO = { arriba: 'bolsillo', abajo: 'soldadura', izquierda: 'soldadura', derecha: 'soldadura' };
const CUATRO = ['arriba', 'abajo', 'izquierda', 'derecha'];

const RESUMEN = [
  { titulo: 'Solo soldadura', color: '#E0007F', detalle: '5 cm en los 4 lados', lados: SOLDADURA },
  { titulo: 'Soldadura + ojales', color: '#E0007F', detalle: '5 cm + ojales a 7,5 cm', lados: SOLDADURA, ojales: CUATRO },
  { titulo: 'Bolsillo arriba y abajo', color: '#8F8000', detalle: '15 cm arriba y abajo, 5 a los costados', lados: BOLSILLOS },
  { titulo: 'Todo junto', color: '#1489BF', detalle: 'bolsillo arriba, soldadura y ojales en el resto', lados: TODO_JUNTO, ojales: ['abajo', 'izquierda', 'derecha'] },
];

/** Una terminación: diagrama con referencias a la izquierda y la explicación a la derecha. */
function Terminacion({ n, titulo, lados, ojales, leyenda, cifra, detalle, colorCifra, puntos, extra, nota }) {
  return (
    <Tarjeta numero={n} titulo={titulo} nota={`terminación ${n} de 4`}>
      <div className="grid md:grid-cols-2 gap-5 items-start">
        <div className="flex flex-col gap-3">
          <DiagramaLona lados={lados} ojales={ojales} />
          <Leyenda items={leyenda} />
        </div>
        <div className="flex flex-col gap-3">
          <Cifra valor={cifra} detalle={detalle} color={colorCifra} />
          <Lista items={puntos} />
          {extra}
        </div>
      </div>
      <Nota>{nota}</Nota>
    </Tarjeta>
  );
}

const FONDO = 'El fondo y las imágenes sí tienen que llegar hasta el borde del archivo.';

export default function GuiaLona() {
  return (
    <Guia tema={TEMA}>
      {/* ── Página 1: resumen ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Titulo linea1="Cuánto margen dejar" previo2="en tu" linea2="lona" resaltado />
        <Banner>
          Toda terminación se come una parte del borde del archivo.<br />
          <b><i>Cada lado puede llevar una distinta, así que el margen se calcula lado por lado.</i></b>
        </Banner>
        <Tarjeta titulo="Según la terminación y el lado en que la pidas">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {RESUMEN.map(r => (
              <div key={r.titulo} className="flex flex-col gap-1.5">
                <DiagramaLona lados={r.lados} ojales={r.ojales} chico />
                <p style={{ fontFamily: "'Roboto Mono', monospace", color: r.color }} className="text-[11px] font-bold uppercase tracking-wide">{r.titulo}</p>
                <p className="text-[12.5px] font-semibold text-zinc-900 leading-snug">{r.detalle}</p>
              </div>
            ))}
          </div>
          <Leyenda items={[['magenta', 'Soldadura'], ['amarillo', 'Bolsillo'], ['cian', 'Ojales']]} />
        </Tarjeta>
        <Nota>
          <b>El fondo llega hasta el borde. El contenido arranca más adentro.</b><br />
          Zona segura = lo que consume ese lado + 5 cm de resguardo. El archivo va siempre en la medida final, a escala 1:1.
        </Nota>
        <div className="guia-relleno flex-1" />
        <PieHoja {...PIE} pagina={1} />
      </Hoja>

      {/* ── Página 2: terminaciones 1 y 2 ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Terminacion
          n={1} titulo="Solo soldadura" lados={SOLDADURA}
          leyenda={[['magenta', 'Se pierde 5 cm: los 4 lados'], ['gris', 'Zona segura: 5 cm más adentro']]}
          cifra="5 cm" detalle="por lado" colorCifra="#E0007F"
          puntos={[
            'Dobla el borde hacia atrás y toma 5 cm de cada lado.',
            'Ese borde deja de verse, pero el fondo tiene que llegar igual hasta el filo.',
            'Podés pedirla en todo el perímetro o solo en los lados que necesites.',
          ]}
          nota={<><b>Dejá 10 cm libres de texto y logos: 5 que se dobla más 5 de resguardo.</b><br />{FONDO}</>}
        />
        <Terminacion
          n={2} titulo="Soldadura + ojales" lados={SOLDADURA} ojales={CUATRO}
          leyenda={[['magenta', 'Se pierde 5 cm: los 4 lados'], ['cian', 'Ojales a 7,5 cm: los 4 lados'], ['gris', 'Zona segura: 5 cm más adentro']]}
          cifra="7,5 cm" detalle="del borde del archivo al centro del ojal" colorCifra="#E0007F"
          puntos={[
            'El ojal va a 2,5 cm del borde terminado: 7,5 cm desde el borde del archivo.',
            'Uno cada 50 cm por defecto. Máximo 90 cm.',
            'Las esquinas se cuentan una sola vez.',
            'El ojal perfora la lona: rompe lo que caiga en esa franja.',
          ]}
          nota={<><b>Dejá 10 cm libres: cubre la soldadura y la línea de ojales.</b><br />{FONDO}</>}
        />
        <PieHoja {...PIE} pagina={2} />
      </Hoja>

      {/* ── Página 3: terminaciones 3 y 4 ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Terminacion
          n={3} titulo="Bolsillo arriba y abajo" lados={BOLSILLOS}
          leyenda={[['amarillo', 'Se pierde 15 cm: arriba y abajo'], ['magenta', 'Se pierde 5 cm: izquierda y derecha'], ['gris', 'Zona segura: 5 cm más adentro']]}
          cifra="(bolsillo × 2) + 5" detalle="cm que consume ese lado" colorCifra="#9A8A00"
          puntos={[
            'Es el tubo por donde entra el caño o la soga. Vos elegís de cuántos centímetros.',
            'Casi siempre va en dos lados nada más: arriba y abajo.',
            'Los lados que no llevan bolsillo se cierran con soldadura y consumen 5 cm.',
          ]}
          extra={<>
            <Tabla
              columnas={['Bolsillo', 'Consume', 'Segura']}
              filas={[
                ['3 cm', '11 cm', '16 cm'],
                [<b>5 cm</b>, <b>15 cm</b>, <b>20 cm</b>],
                ['7 cm', '19 cm', '24 cm'],
                ['10 cm', '25 cm', '30 cm'],
                ['15 cm', '35 cm', '40 cm'],
              ]}
            />
            <p className="text-[12px] text-zinc-500">El de 5 cm es el estándar.</p>
          </>}
          nota={<><b>Zona segura: 20 cm arriba y abajo, 10 cm a los costados.</b><br />{FONDO}</>}
        />
        <Terminacion
          n={4} titulo="Todo junto" lados={TODO_JUNTO} ojales={['abajo', 'izquierda', 'derecha']}
          leyenda={[['amarillo', 'Se pierde 15 cm: arriba'], ['magenta', 'Se pierde 5 cm: abajo, izquierda y derecha'], ['cian', 'Ojales a 7,5 cm: abajo, izquierda y derecha'], ['gris', 'Zona segura: 5 cm más adentro']]}
          cifra="15 y 5 cm" detalle="cada lado consume distinto" colorCifra="#1489BF"
          puntos={[
            'Ejemplo real: bolsillo arriba para colgarla del caño y soldadura en los otros tres lados.',
            'Los ojales van en los lados soldados, a 7,5 cm del borde del archivo.',
            'El lado del bolsillo consume 15 cm y los otros tres, 5 cm cada uno.',
            'No hace falta que todo vaya igual: elegís lado por lado.',
          ]}
          nota={<><b>Calculá el margen lado por lado, no uno solo para toda la pieza.</b><br />{FONDO}</>}
        />
        <PieHoja {...PIE} pagina={3} />
      </Hoja>
    </Guia>
  );
}
