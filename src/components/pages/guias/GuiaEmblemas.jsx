import { Guia, Hoja, Encabezado, Titulo, Banner, Columnas, Tarjeta, Bajada, Item, Texto, Chip, Lista, QR, Contacto, PieHoja } from './bloques';

const TEMA = { acento: '#763792', texto: '#763792', suave: '#E9DCEF', sobre: '#FFFFFF', atencion: '#C99BDD' };
const ENC = { anio: '2025', numero: '01.', seccion: 'Procedimiento de', destacado: 'bordados', marca: 'Emblemas · Parches y bordados' };
const PIE = { etiqueta: 'PARCHES Y BORDADOS', fecha: 'Julio, 2025', total: 2 };

const URL_FORMULARIO = 'https://forms.gle/JyLGABabo2hdQVZt9';
const URL_EJEMPLOS = 'https://www.canva.com/design/DAGljSSGxb0/gHgQtnHrEdwzdZ7D_PrcwQ/view?utm_content=DAGljSSGxb0&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=ha04001ae23';

const Capas = () => (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 2 8l10 5 10-5-10-5Z" /><path d="m2 13 10 5 10-5" />
  </svg>
);

export default function GuiaEmblemas() {
  return (
    <Guia tema={TEMA}>
      {/* ── Página 1 ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Titulo linea1="Procedimiento para" linea2="Servicio de Bordados" />
        <Banner>
          <i>Los <b>bordados se cotizan por puntada</b>, determinadas por la <b>matriz del diseño.</b></i><br />
          <i>No es posible definir el valor exacto hasta contar con el resultado final.</i>
        </Banner>
        <Columnas
          izquierda={<>
            <Tarjeta numero={1} titulo="Tipos de archivos admitidos">
              <Bajada>Enviá tu imagen, logo o tipografía en formato PDF, PNG o JPG.</Bajada>
              <Texto><b>El formato ideal es PDF (editable).</b></Texto>
              <Texto>Si envía una imagen PNG o JPG, tenga en cuenta que la resolución (calidad de la imagen) puede afectar la calidad del resultado final.</Texto>
            </Tarjeta>
            <Tarjeta numero={2} titulo="Tamaño y colores de hilos para bordar">
              <Item titulo={<>Tamaño máximo en <b><i>superficies planas:</i></b></>}>
                <Texto><b>36 x 67 cm</b> <i className="text-zinc-600">(Ejemplo: Banderas)</i></Texto>
              </Item>
              <Item titulo={<>Tamaño máximo para <b><i>prendas/piezas armadas o desarmadas:</i></b></>}>
                <Texto><b>26 x 30 cm</b> <i className="text-zinc-600">(Ejemplo: Espalda, mangas, gorros)</i></Texto>
              </Item>
              <Lista items={[
                <>Se debe considerar <b>al menos 1 cm de margen</b> respecto del borde.</>,
                <>Para el <b>uso de letras</b> y dependiendo del estilo el tamaño más recomendado es de al menos 1 cm de alto.</>,
              ]} />
              <Item titulo="+95 colores de hilo">
                <Texto>Contamos con un <b>stock amplio</b> de colores para tus diseños. Podés solicitar nuestra carta de colores por WhatsApp.</Texto>
              </Item>
            </Tarjeta>
          </>}
          derecha={
            <Tarjeta numero={3} titulo="Cómo registrar tu pedido">
              <Item titulo="Podés solicitar la prenda en User">
                <Texto>Contamos con productos como:</Texto>
                <Lista compacta items={['Shorts', 'Gorras', 'Gorros de lana', 'Cuellos polares de niño y adulto']} />
              </Item>
              <Item titulo="También podés traer tu prenda">
                <div className="rounded-xl bg-[var(--g-sv)] p-3 flex items-center gap-3">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <Texto><b><i>En este caso es necesario enviar el formulario de solicitud previamente.</i></b></Texto>
                    <a href={URL_FORMULARIO} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-[var(--g-tx)] underline underline-offset-2">Abrir el formulario</a>
                  </div>
                  <QR url={URL_FORMULARIO} tamano={70} titulo="Formulario de solicitud" />
                </div>
              </Item>
              <Texto>Las recibimos en nuestro showroom en: <i className="text-[var(--g-tx)]">Arenal Grande 2667, Montevideo.</i></Texto>
              <Texto>Por favor, identificá tu paquete claramente con:</Texto>
              <Lista compacta items={['ID de cliente', 'Nombre y apellido', 'Número de contacto', 'Dónde va el bordado:']} />
              <Texto><Chip color><i>Envianos un boceto o referencia que señale claramente dónde querés que vaya el diseño (visualizando: altura, lado, zona, etc.)</i></Chip></Texto>
            </Tarjeta>
          }
        />
        <PieHoja {...PIE} pagina={1} />
      </Hoja>

      {/* ── Página 2 ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Columnas
          izquierda={
            <Tarjeta icono={<Capas />} titulo="Posibilidad de superficies">
              <Bajada>Hacemos parches y bordados sobre:</Bajada>
              <Texto>Ejemplos:</Texto>
              <Lista compacta items={['Prendas', 'Gorras y sombreros', 'Bolsos', 'Textiles para el hogar', 'Uniformes', 'Ropa laboral y otros']} />
              <Texto><b>*Prendas pequeñas:</b></Texto>
              <Texto>Tener en cuenta que las prendas de talles chicos (2, 4 y 6) pueden presentar limitaciones para el bordado, debido al espacio reducido y la dificultad para montarlas en la máquina.</Texto>
              <Texto><b>En estos casos, se recomienda:</b></Texto>
              <Texto>Enviar las piezas sin confeccionar (partes sueltas). También podés solicitar un bordado como parche independiente, para aplicar luego a la prenda.</Texto>
            </Tarjeta>
          }
          derecha={<>
            <Tarjeta icono="!" titulo="Cantidad mínima por diseño">
              <Lista items={[
                <><i>Por cada diseño solicitado la <b>cantidad mínima</b> a realizar es de <b>5 bordados.</b></i></>,
                <>A su vez, <b><i>es necesario realizar una matriz del mismo,</i></b> la cual tiene un <b><i>costo de $200.</i></b></>,
              ]} />
              <Texto><b><i>Realizando 10 bordados el costo de la matriz va de regalo.</i></b></Texto>
            </Tarjeta>
            <Tarjeta icono="$" titulo="Referencia de costos">
              <div className="flex items-start gap-4">
                <div className="flex-1 flex flex-col gap-2">
                  <Bajada>Cálculo por puntadas:</Bajada>
                  <Texto><b>$8 cada 1000 puntadas</b></Texto>
                  <hr className="border-[var(--g-ac)]" />
                  <Texto>A partir de 10000 se cobra como puntadas extra: <b>$6 cada 1000 puntadas</b></Texto>
                </div>
                <div className="rounded-xl bg-[var(--g-ac)] p-2 flex flex-col items-center gap-1.5">
                  <a href={URL_EJEMPLOS} target="_blank" rel="noreferrer" className="text-[11px] italic text-[var(--g-on)] text-center leading-tight">Ver ejemplos<br />de referencia:</a>
                  <QR url={URL_EJEMPLOS} tamano={70} titulo="Ejemplos de referencia" />
                </div>
              </div>
            </Tarjeta>
          </>}
        />
        <div className="guia-relleno flex-1" />
        <Contacto logo="/assets/images/marcas/emblemas.svg" marca="Emblemas" whatsapp="091 612 909" />
        <PieHoja {...PIE} pagina={2} />
      </Hoja>
    </Guia>
  );
}
