import { Guia, Hoja, Encabezado, Titulo, Banner, Columnas, Tarjeta, Bajada, Texto, Aclaracion, M, Enlace, ListaNumerada, Aviso, Contacto, PieHoja } from './bloques';
import { TEMA_IMPRITEX } from './GuiaSublimacion';

export default function GuiaTelaCliente() {
  return (
    <Guia tema={TEMA_IMPRITEX}>
      <Hoja>
        <Encabezado anio="2026" numero="01." seccion="Tela" destacado="del cliente" marca="Impritex · Impresión textil directa / sublimación" />
        <Titulo linea1="Sublimación en" linea2="Tela del cliente" bajada="Es responsabilidad del cliente revisar el archivo antes de enviarlo." />
        <Banner>
          El mínimo de compra para la sublimación en tela proporcionada por el cliente es de <M><b>5 metros</b></M>, con un único archivo a sublimar en la misma tela.<br />
          <b><i>Y siempre debe enviar <M>1 metro</M> adicional de tela para garantizar un proceso sin complicaciones.</i></b>
        </Banner>
        <Columnas
          izquierda={<>
            <Tarjeta numero={1} titulo="Sobre la tela">
              <Bajada>La tela debe ser al menos un 80% poliéster, pero el proceso de sublimación textil es óptimo para telas blancas con un 100% de poliéster.</Bajada>
              <Texto>Si la tela no es 100% poliéster, se recomienda hacer pruebas, ya que el resultado no será el mismo. Además, si la tela no es blanca y tiene un color de base, los colores del diseño saldrán alterados durante la sublimación.</Texto>
            </Tarjeta>
            <Tarjeta numero={2} titulo="Ancho de impresión">
              <Bajada>Respetar el Ancho Máximo Imprimible.</Bajada>
              <Texto>Al armar la hoja de trabajo, ten en cuenta que el ancho imprimible es <M><b>3 cm</b></M> menos que el ancho total de la tela.</Texto>
              <Aclaracion>Ejemplo: Si tu tela mide 1,60 m de ancho, el tamaño que se podrá imprimir será de 1,57 m. Por lo tanto, el área de trabajo para diseñar es de 1,57 m y no debe superar ese tamaño.</Aclaracion>
            </Tarjeta>
            <Tarjeta numero={3} titulo="Diseño y diagramado">
              <Bajada>Para trabajar con Rapport.</Bajada>
              <Texto>Envíe el diseño rapport en escala real e indique en la ventana ‘Rapport’ el ancho y largo deseado para asegurar la repetición adecuada del patrón.</Texto>
            </Tarjeta>
            <Aviso>No se debe espejar el diseño</Aviso>
          </>}
          derecha={<>
            <Tarjeta numero={4} titulo="Envío de archivos">
              <Bajada>Envíe su archivo a través de los formularios del portal.</Bajada>
              <Texto><Enlace href="https://user.com.uy/portal">user.com.uy/portal</Enlace></Texto>
              <Texto>Cada formulario enviado debe corresponder a un solo tipo de tela por cliente. Si las telas tienen distintos colores, también se deben enviar en formularios separados.</Texto>
            </Tarjeta>
            <Tarjeta numero={5} titulo="Envío de tela">
              <Bajada>La tela debe venir enrollada.</Bajada>
              <Texto>Al momento de la recepción, debe indicar de qué lado se va a sublimar.</Texto>
              <Texto>Una vez aprobada la medida de la tela, se le asignarán los metros correspondientes a su cuenta, pudiendo cargar solo la cantidad aprobada.</Texto>
              <Bajada>Es imprescindible indicar estos datos:</Bajada>
              <ListaNumerada items={[
                'ID de cliente y su nombre.',
                'Marcar sobre cada tela el lado que se desea sublimar.',
                'Especificar el nombre de cada tela.',
              ]} />
            </Tarjeta>
            <Tarjeta suave>
              <Texto><b><i>Responsabilidades de la empresa:</i></b></Texto>
              <Texto><i>Si la tela del cliente se daña por un error de la empresa, se realizará el trabajo nuevamente sin cargo adicional. El cliente deberá aportar una nueva pieza de tela, ya que la empresa no cubre el costo de la tela dañada.</i></Texto>
            </Tarjeta>
          </>}
        />
        <div className="guia-relleno flex-1" />
        <Contacto texto="Por consultas, utilice nuestro servicio de chat por WhatsApp al número de sublimación." logo="/assets/images/marcas/impritex.svg" marca="Impritex" whatsapp="092 284 262" />
        <PieHoja etiqueta="SUBLIMACIÓN" fecha="Octubre, 2026" pagina={1} total={1} portal />
      </Hoja>
    </Guia>
  );
}
