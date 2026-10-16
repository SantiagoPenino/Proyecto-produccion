import { Guia, Hoja, Encabezado, Titulo, Banner, Columnas, Tarjeta, Bajada, Item, Texto, Aclaracion, M, Enlace, Lista, Aviso, QR, Contacto, Portal, PieHoja } from './bloques';

const TEMA = { acento: '#FFFF00', texto: '#443F0F', suave: '#FFFED0', sobre: '#1A1A1A', insignia: '#1A1A1A' };
const ENC = { anio: '2026', numero: '01.', seccion: 'Guía', destacado: 'de archivos', marca: 'Eco UV · Impresión digital en gran formato' };
const PIE = { etiqueta: 'GRAN FORMATO', fecha: 'Octubre, 2026', total: 2 };

/** Ejemplo visual del margen de colocación (4 cm por lado). */
function EjemploMargen() {
  return (
    <div className="flex flex-col sm:flex-row items-start gap-4">
      <svg viewBox="0 0 150 96" className="w-full max-w-[230px]" aria-label="Ejemplo del margen de colocación">
        <rect x="2" y="2" width="128" height="78" fill="#FFFED0" stroke="#111" strokeWidth="1.2" />
        <rect x="10" y="10" width="112" height="62" fill="#FFD400" stroke="#111" strokeWidth="0.8" strokeDasharray="3 2" />
        <circle cx="96" cy="26" r="5" fill="#fff" />
        <path d="M22 26c0-5 9-7 12-3 3-3 9-1 9 3z" fill="#fff" />
        <path d="M20 72 L48 40 L66 60 L80 48 L112 72 Z" fill="#fff" />
        <line x1="134" y1="72" x2="134" y2="80" stroke="#111" strokeWidth="0.8" />
        <text x="137" y="79" fontSize="5.5" fill="#111">4cm</text>
        <line x1="122" y1="85" x2="130" y2="85" stroke="#111" strokeWidth="0.8" />
        <text x="119" y="93" fontSize="5.5" fill="#111">4cm</text>
      </svg>
      <ul className="flex flex-col gap-2 text-[12.5px] text-zinc-800">
        <li className="flex items-center gap-2"><span className="w-3.5 h-3.5 border-[1.5px] border-zinc-900 rounded-sm flex-shrink-0" />Tamaño total para poder colocarlo</li>
        <li className="flex items-center gap-2"><span className="w-3.5 h-3.5 border border-dashed border-zinc-900 bg-[#FFFED0] rounded-sm flex-shrink-0" />Márgenes de colocación</li>
        <li className="flex items-center gap-2"><span className="w-3.5 h-3.5 bg-[#FFD400] rounded-sm flex-shrink-0" />Área visible de tu cuadro</li>
      </ul>
    </div>
  );
}

export default function GuiaEcouv() {
  return (
    <Guia tema={TEMA}>
      {/* ── Página 1 ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Titulo linea1="Impresión en Gran Formato" previo2="con tintas" linea2="Ecosolvente y UV" resaltado />
        <Banner>
          Se reciben todos los diseños ya diagramados en la hoja,<br />
          <b><i>es responsabilidad del cliente revisar el archivo antes de enviarlo.</i></b>
        </Banner>
        <Columnas
          izquierda={<>
            <Tarjeta numero={1} titulo="Tipos de archivos admitidos">
              <Item titulo="Archivos en formato PDF"><Texto>Puede guardar en PDF desde cualquier programa de edición. Si trabaja con CorelDRAW, debe guardar su archivo como PDF/X-4 para evitar que algunos efectos utilizados en el diseño afecten los colores del archivo.</Texto></Item>
              <Item titulo="También puede enviar archivo en formato JPG"><Texto>Considere que la resolución elegida puede afectar el tamaño final del diseño. Y que aunque se trabaje en diferentes perfiles de color (RGB, CMYK, Pantone) se unificará en uno solo al guardarlo en este formato.</Texto></Item>
            </Tarjeta>
            <Tarjeta numero={2} titulo="Compatibilidad de colores">
              <Bajada>Se recomienda utilizar el modo de color CMYK e incrustar el perfil de color “U.S. Web Coated (SWOP) v2”.</Bajada>
              <Texto>Si trabaja en <b>RGB</b>, puede obtener mejores resultados utilizando el perfil <b>sRGB</b>, aunque este método queda bajo su responsabilidad.</Texto>
              <Texto>También es posible trabajar con códigos de color <b>Pantone</b>, aunque se deben evitar efectos como filtros o degradados.</Texto>
              <Texto><b>El color puede variar según el material elegido (vinilo, lona, PET, etc.), su reverso y si es brillo o mate.</b></Texto>
              <Texto><b>Puede consultar nuestro muestrario físico en el local</b>, donde encontrará ejemplos de impresión sobre distintos materiales.</Texto>
              <Texto>Si desea, también puede enviarnos una muestra de color como referencia para lograr una mayor aproximación al resultado final.</Texto>
            </Tarjeta>
          </>}
          derecha={<>
            <Tarjeta numero={3} titulo="Ancho de impresión">
              <Bajada>Es necesario armar la hoja de trabajo con el <b><i>ancho imprimible de cada material.</i></b></Bajada>
              <div className="flex items-center gap-4">
                <QR url="https://user.com.uy/portal/precios" tamano={64} />
                <Texto>Puede guiarse por la información proporcionada en nuestra web: <Enlace href="https://user.com.uy/portal/precios">user.com.uy/portal/precios</Enlace></Texto>
              </div>
              <Aclaracion>Ejemplo: la Lona Frontlight tiene 3,20 m de ancho total, pero su ancho imprimible es de 3,17 m (siempre se deben restar 3 cm del ancho total).</Aclaracion>
            </Tarjeta>
            <Tarjeta numero={4} titulo="Resolución de archivos">
              <Bajada>Resolución recomendada <M>150 dpi</M></Bajada>
              <Texto>Es importante diseñar en buena definición para garantizar una calidad óptima de impresión.</Texto>
            </Tarjeta>
            <Tarjeta numero={5} titulo="Diseño y diagramado">
              <Item titulo="Márgenes">
                <Lista items={[
                  'No incluya espacios en blanco innecesarios.',
                  'Si necesitás un área blanca en tu diseño, agregá un marco visible que delimite el tamaño exacto.',
                ]} />
              </Item>
              <Item titulo="Márgenes para colocación">
                <Texto>Si va a <b><i>solicitar el servicio de colocación</i></b> de su imagen en un bastidor, es necesario que envíes tu diseño con <b><M>4 cm</M> <i>de margen de cada lado</i></b> y que remarques el <b><i>borde del tamaño total</i></b> para que podamos montarla en el soporte.</Texto>
              </Item>
              <p className="text-right text-[11.5px] italic text-zinc-500">continúa al dorso de la hoja →</p>
            </Tarjeta>
          </>}
        />
        <PieHoja {...PIE} pagina={1} />
      </Hoja>

      {/* ── Página 2 ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Columnas
          izquierda={<>
            <Tarjeta numero={5} titulo="Diseño y diagramado" nota="(continuación)">
              <Bajada>Ejemplo visual del margen de colocación</Bajada>
              <EjemploMargen />
              <Bajada>Importante</Bajada>
              <Texto><i>Asegurate de incluir estos márgenes o retiros extra en tu archivo original.</i></Texto>
              <Texto><b><i>Nosotros no realizamos ajustes adicionales ni agregamos espacios al diseño.</i></b></Texto>
            </Tarjeta>
            <Aviso>No se debe espejar el diseño</Aviso>
            <Tarjeta numero={6} titulo="Recomendaciones técnicas">
              <Item titulo="Convertir texto a curvas o contornos"><Texto>Para evitar posibles errores durante el proceso de impresión, especialmente si la fuente original utilizada no está disponible en el sistema del centro de impresión.</Texto></Item>
            </Tarjeta>
          </>}
          derecha={<>
            <Tarjeta numero={7} titulo="Elección de tinta entre ECO y UV">
              <Item titulo="Color con tintas Eco-solventes"><Texto>Las tintas eco-solventes ofrecen una reproducción de colores más vibrante.</Texto></Item>
              <Item titulo="Color con tintas UV"><Texto>Las tintas UV ofrecen ventajas en cuanto a durabilidad y resistencia. Su gama cromática es menos vibrante en comparación con las tintas eco-solventes.</Texto></Item>
            </Tarjeta>
            <Tarjeta numero={8} titulo="Envío por formulario">
              <Bajada>Notas</Bajada>
              <Texto>Al enviar el pedido, en la sección ‘Notas’ del formulario, especifique la información pertinente para la impresión, como:</Texto>
              <Lista items={[
                'Si se trabaja con escala, indique con cuál y cuál es el ancho final deseado.',
                'Si es necesario, incluya cualquier otra información crucial.',
              ]} />
            </Tarjeta>
          </>}
        />
        <div className="guia-relleno flex-1" />
        <div className="grid md:grid-cols-2 gap-5">
          <Contacto compacto logo="/assets/images/marcas/ecouv.svg" marca="Eco UV" whatsapp="099 985 373" />
          <Portal />
        </div>
        <PieHoja {...PIE} pagina={2} />
      </Hoja>
    </Guia>
  );
}
