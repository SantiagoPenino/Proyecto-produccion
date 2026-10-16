import { Guia, Hoja, Encabezado, Titulo, Banner, Columnas, Tarjeta, Bajada, Item, Texto, Aclaracion, M, Chip, Enlace, Lista, Aviso, QR, Contacto, Portal, PieHoja } from './bloques';

export const TEMA_IMPRITEX = { acento: '#21A8FF', texto: '#254159', suave: '#BFEBF9', sobre: '#0B1B2A', insignia: '#FFFFFF' };
const ENC = { anio: '2026', numero: '01.', seccion: 'Guía', destacado: 'de archivos', marca: 'Impritex · Impresión textil directa / sublimación' };
const PIE = { etiqueta: 'SUBLIMACIÓN', fecha: 'Octubre, 2026', total: 2 };

export default function GuiaSublimacion() {
  return (
    <Guia tema={TEMA_IMPRITEX}>
      {/* ── Página 1 ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Titulo linea1="Impresión para" linea2="Sublimación Textil" />
        <Banner>
          Se reciben todos los diseños ya diagramados en la hoja,<br />
          <b><i>es responsabilidad del cliente revisar el archivo antes de enviarlo.</i></b>
        </Banner>
        <Columnas
          izquierda={<>
            <Tarjeta numero={1} titulo="Tipos de archivos admitidos">
              <Item titulo="Archivos en formato PDF"><Texto>Puede guardar en PDF desde cualquier programa de edición. Si trabaja con CorelDRAW, debe guardar su archivo como <b>PDF/X-4</b>. De lo contrario, los mapas de bits con transparencia y otros efectos alterarán los colores del archivo.</Texto></Item>
              <Item titulo="También puede enviar el archivo en formato JPG"><Texto>Considere que la resolución elegida puede afectar el tamaño final del diseño. Y que aunque se trabaje en diferentes perfiles de color (RGB, CMYK, Pantone) se unificará en uno solo al guardarlo en este formato.</Texto></Item>
            </Tarjeta>
            <Tarjeta numero={2} titulo="Compatibilidad de colores">
              <Bajada>Se recomienda utilizar el modo de color CMYK e incrustar el perfil de color “U.S. Web Coated (SWOP) v2”.</Bajada>
              <Texto>Trabajamos con tabla de colores física y digital para que pueda obtener los colores deseados. Puede elegir valores de nuestra tabla de colores. El archivo se encuentra en nuestra web, sección recursos - paleta de colores.</Texto>
              <Texto><Enlace href="/paletas">user.com.uy/paletas</Enlace></Texto>
              <Texto>Si decide trabajar en <b>RGB</b>, podría lograr un mejor resultado utilizando el perfil de color <b>sRGB</b>. No obstante, tenga en cuenta que este método es bajo su responsabilidad.</Texto>
              <Texto>También es posible trabajar con códigos de color Pantone, aunque se deben evitar efectos como filtros o degradados.</Texto>
            </Tarjeta>
            <Aviso>No se debe espejar el diseño</Aviso>
          </>}
          derecha={<>
            <Tarjeta numero={3} titulo="Ancho de impresión">
              <Bajada>Es necesario armar la hoja de trabajo con el <b><i>ancho imprimible de cada tela.</i></b></Bajada>
              <div className="flex items-center gap-4">
                <QR url="https://user.com.uy/portal/precios" tamano={64} />
                <Texto>Puede guiarse por la información proporcionada en nuestra web: <Enlace href="https://user.com.uy/portal/precios">user.com.uy/portal/precios</Enlace></Texto>
              </div>
              <Aclaracion>Ejemplo: La tela Dry Pro tiene un ancho total de 1,83 m, pero su ancho imprimible es de 1,80 m (siempre se deben restar 3 cm del ancho total de la tela).</Aclaracion>
            </Tarjeta>
            <Tarjeta numero={4} titulo="Diseño y diagramado">
              <Item titulo="Elasticidad de la tela"><Texto>Tenga en cuenta el sentido de la elasticidad de la tela al diagramar su archivo para imprimir, especialmente cuando se trate de prendas de vestir.</Texto></Item>
              <Item titulo="Márgenes"><Texto>Evite incluir espacios blancos que no vaya a necesitar. Si precisa un área de tela blanca en su diseño, agregue un marco visible que delimite el área total para que se reconozca el tamaño deseado.</Texto></Item>
              <Item titulo="Escala">
                <Texto>En el programa Illustrator, es posible diseñar hasta un máximo de 5 metros. Si su diseño supera ese tamaño, le recomendamos trabajar a una escala del 50%.</Texto>
                <Aclaracion>Siempre que trabaje a escala, debe indicarlo en la sección ‘Escala’ del pedido, con la escala utilizada.</Aclaracion>
              </Item>
              <Item titulo="Para trabajar con Rapport">
                <Texto><b>Envíe su diseño ‘rapport’ a escala real.</b></Texto>
                <Aclaracion>Seleccione ‘Rapport’ en el pedido y escriba el ancho y largo deseado para asegurar la repetición adecuada del patrón.</Aclaracion>
              </Item>
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
            <Tarjeta numero={5} titulo="Recomendaciones técnicas">
              <Item titulo="Diferenciación entre los colores"><Texto>Es importante tener en cuenta que los colores muy similares —aunque puedan distinguirse en pantalla— podrían no diferenciarse claramente una vez sublimados.</Texto></Item>
              <Item titulo="Trabajar con una tabla de colores para lograr el resultado deseado"><Texto>En el caso de utilizar telas no habituales se recomienda realizar muestras, especialmente en producciones grandes.</Texto></Item>
              <Item titulo="Convertir texto a curvas o contornos"><Texto>Para evitar posibles errores durante el proceso de impresión, especialmente si la fuente original utilizada no está disponible en el sistema del centro de impresión.</Texto></Item>
              <Item titulo="Tener en cuenta el grosor de las líneas"><Texto>Al imprimirse, las líneas de trazo fino pueden verse afectadas según el color y el fondo. <Chip>El color oscuro tiende a invadir al claro,</Chip> por lo que es importante considerar esta diferencia.</Texto></Item>
            </Tarjeta>
            <Tarjeta numero={6} titulo="Condiciones que generan fallas" suave>
              <Bajada>Bajo estas condiciones el archivo va a presentar fallas:</Bajada>
              <Lista items={[
                <><b>Degradados con Pantone.</b> La transición genera colores indeseados en el medio.</>,
                <><b>Rasterizar colores Pantone.</b> Produce un efecto glitch sobre la tela.</>,
                <><b>Mapas de bits con transparencia en CorelDRAW sin guardar como PDF/X-4.</b> Altera los colores del archivo.</>,
                <><b>Negro de registro.</b> Puede generar fallas y manchas en la tela. Utilice negro plano.</>,
                <><b>Sobreimpresión.</b> Genera un exceso de carga de tinta que mancha la tela.</>,
                <><b>Opacidades y efectos.</b> El resultado es incierto.</>,
              ]} />
            </Tarjeta>
          </>}
          derecha={<>
            <Tarjeta numero={7} titulo="Resolución de archivos">
              <Bajada>Resolución recomendada <M>300 ppi</M></Bajada>
              <Texto>Es importante diseñar en alta definición para garantizar una calidad óptima de impresión. Las imágenes pixeladas en pantalla se verán de la misma manera al sublimarse en la tela.</Texto>
            </Tarjeta>
            <Tarjeta numero={8} titulo="Envío por formulario">
              <Bajada>Antes de enviar</Bajada>
              <Texto>Al enviar el pedido, revise que haya seleccionado la tela deseada.</Texto>
              <Bajada>Notas</Bajada>
              <Texto>Si es necesario, incluya en la sección ‘Notas’ cualquier otra información crucial para impresión o calandrado.</Texto>
            </Tarjeta>
          </>}
        />
        <div className="guia-relleno flex-1" />
        <div className="grid md:grid-cols-2 gap-5">
          <Contacto compacto texto="Por consultas, utilice nuestro servicio de chat por WhatsApp al número de sublimación." logo="/assets/images/marcas/impritex.svg" marca="Impritex" whatsapp="092 284 262" />
          <Portal />
        </div>
        <PieHoja {...PIE} pagina={2} />
      </Hoja>
    </Guia>
  );
}
