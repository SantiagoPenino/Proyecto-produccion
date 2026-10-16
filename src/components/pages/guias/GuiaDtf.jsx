import { Guia, Hoja, Encabezado, Titulo, Banner, Columnas, Tarjeta, TarjetaPildora, Bajada, Item, Texto, M, Chip, Enlace, Medidas, Lista, ListaNumerada, Nota, Tabla, Contacto, PieHoja } from './bloques';

const TEMA = { acento: '#FF0099', texto: '#FF0099', suave: '#FFC3FF', sobre: '#FFFFFF' };
const ENC = { anio: '2026' };
const PIE = { etiqueta: 'ESTAMPADO DTF', fecha: 'Octubre, 2026', total: 3 };

export default function GuiaDtf() {
  return (
    <Guia tema={TEMA}>
      {/* ── Página 1 ── */}
      <Hoja>
        <Encabezado {...ENC} numero="01." seccion="Guía" destacado="de archivos" marca="DTF Uruguay · Estampados textiles y adhesivos UV" />
        <Titulo linea1="Impresión de estampado" linea2="DTF (textil) y DTF UV (adhesivo)" />
        <Banner>
          Se reciben todos los diseños ya diagramados en la hoja,<br />
          <b><i>es responsabilidad del cliente revisar el archivo antes de enviarlo.</i></b>
        </Banner>
        <Columnas
          izquierda={<>
            <Tarjeta numero={1} titulo="Formatos aceptados y fondo blanco">
              <Texto>No se aceptan archivos <b>con fondo blanco</b> plano (sin transparencia o sin recorte). Estos archivos serán cancelados automáticamente.</Texto>
              <Texto><b>Puede enviar su archivo final ya armado con todos los diseños dentro, en los siguientes formatos:</b></Texto>
              <Item titulo="PDF"><Texto>Puede contener tanto imágenes PNG como vectores.</Texto></Item>
              <Item titulo="PNG con fondo transparente"><Texto>La resolución elegida del PNG puede afectar el tamaño final del diseño.</Texto></Item>
              <Item titulo="Si trabaja en CorelDRAW"><Texto>Guarde el archivo como <M><b>PDF/X-4</b></M> para evitar problemas con transparencias, fondos blancos inesperados o alteraciones de color.</Texto></Item>
              <Item titulo="No recomendamos trabajar con Inkscape"><Texto>Genera máscaras de recorte que el sistema no interpreta bien y el diseño sale blanco. Si igual lo utiliza, libere las máscaras o exporte en PNG, que las aplana.</Texto></Item>
              <Item titulo="Importante"><Texto>Luego de guardar su archivo final, asegúrese de que el archivo esté listo para imprimir.</Texto></Item>
            </Tarjeta>
            <Tarjeta numero={2} titulo="Compatibilidad de colores">
              <Bajada>Utilizar modo de color CMYK e incrustar perfil de color “U.S. Web Coated (SWOP) v2”.</Bajada>
              <Texto>Trabajamos con tabla de colores física y digital para que pueda obtener los colores deseados. Puede elegir valores de nuestra tabla de colores. El archivo se encuentra en nuestra web, sección recursos - paleta de colores.</Texto>
              <Texto><Enlace href="/paletas">user.com.uy/paletas</Enlace></Texto>
              <Texto>En caso de preferir trabajar, bajo su responsabilidad, en RGB porque ya verificó la salida adecuada de los colores, se recomienda el uso del perfil de color sRGB.</Texto>
            </Tarjeta>
          </>}
          derecha={<>
            <Tarjeta numero={3} titulo="Ancho y largo de impresión">
              <Bajada>Armar la hoja de trabajo con 57 cm de ancho en total.</Bajada>
              <Medidas filas={[['Ancho de la hoja de trabajo', '57 cm'], ['Largo máximo de archivo', '250 cm'], ['Mínimo de impresión', '10 cm']]} />
            </Tarjeta>
            <Tarjeta numero={4} titulo="Tamaño mínimo para formas pequeñas">
              <Bajada>Cualquier trazo o punto más pequeño que medio milímetro no podrá ser estampado.</Bajada>
              <Texto>El grosor mínimo para líneas, trazos de letra, punto o cualquier figura que esté sobre fondo transparente es de <b><M>0,5 mm</M>, siempre y cuando se trabaje con una resolución de <M>300 ppi</M></b> (tamaño equivalente a <M><b>1,5 pt</b></M> o <M><b>7 px</b></M>).</Texto>
            </Tarjeta>
            <Tarjeta numero={5} titulo="Recomendaciones técnicas">
              <Item titulo="Diferenciación entre los colores"><Texto>Tener en cuenta que colores muy próximos que se ven distintos en el monitor, puede que no lleguen a diferenciarse luego de ser impresos.</Texto></Item>
              <Item titulo="Convertir texto a curvas o contornos"><Texto>Esto evita posibles errores durante el proceso de impresión que podrían surgir si la fuente original utilizada no está disponible en el sistema del centro de impresión.</Texto></Item>
              <Item titulo="Líneas claras sobre color oscuro"><Texto>Cuando en el diseño incorporamos líneas de trazo fino (textos o formas muy pequeñas), no se comportan de la misma manera si es color oscuro sobre un fondo claro, o claro sobre fondo oscuro. <Chip>Dado que el color oscuro invade al claro.</Chip></Texto></Item>
            </Tarjeta>
          </>}
        />
        <PieHoja {...PIE} pagina={1} />
      </Hoja>

      {/* ── Página 2 ── */}
      <Hoja>
        <Encabezado {...ENC} numero="01." seccion="Guía" destacado="de archivos" marca="DTF Uruguay · Estampados textiles y adhesivos UV" />
        <Tarjeta numero={6} titulo="Qué pasa si el archivo no cumple">
          <Texto><b>Revisar el archivo antes de enviarlo es responsabilidad del cliente.</b> Hay fallas que solo se ven una vez impresas.</Texto>
          <Bajada>No nos hacemos responsables si el archivo…</Bajada>
          <Tabla
            columnas={['Si el archivo…', 'El resultado va a ser…']}
            filas={[
              [<>Tiene menos de <M><b>300 dpi</b></M> reales</>, 'Impresión pixelada o borrosa'],
              ['Tiene fondo blanco o halo de recorte', 'Contorno blanco alrededor del diseño'],
              ['Tiene píxeles semitransparentes', 'Resultados no deseados en los difuminados'],
              ['Tiene detalles por debajo del mínimo', 'Esas partes no se pegan o se despegan con el uso'],
              ['Viene en RGB', 'Colores más apagados u oscuros que en pantalla'],
              ['Tiene la tipografía sin pasar a curvas', 'Letra distinta a la del diseño original'],
              ['Trae capas, máscaras o efectos sin aplanar', 'Fallas varias; con máscaras, sale blanco sin color'],
            ]}
          />
          <Texto><b>En estos casos el resultado viene determinado por el archivo que enviaste.</b></Texto>
          <Nota>Para detectar y corregir semitransparencias, vea el anexo <b>“DTF sin semitransparencias”</b> (página 3 de esta guía).</Nota>
        </Tarjeta>
        <Columnas
          izquierda={
            <TarjetaPildora titulo="Opciones de terminación (DTF UV)">
              <Bajada>En nuestros adhesivos DTF UV ofrecemos dos terminaciones que definen el acabado del diseño:</Bajada>
              <Item titulo="Con barniz expandido (+5px)"><Texto>Se aplica una capa de barniz con una expansión de <M><b>5 px</b></M> alrededor del contorno, generando brillo y protección.</Texto></Item>
              <Item titulo="Sin barniz (acabado mate)"><Texto>El diseño se entrega sin aplicación de barniz, con una terminación completamente mate y sin reflejos.</Texto></Item>
              <Texto><b><i>*Por defecto aplicamos barniz expandido de +5px, salvo que se indique lo contrario en Notas.</i></b></Texto>
            </TarjetaPildora>
          }
          derecha={
            <TarjetaPildora titulo="DTF textil con efectos “Especiales”">
              <Item titulo="Se imprimen los días martes y jueves"><Texto>Se diseñan de la misma manera que el DTF Común. Tenga en cuenta que cada efecto influirá en la apariencia final de los colores.</Texto></Item>
              <Texto><i>Consulte por más información.</i></Texto>
            </TarjetaPildora>
          }
        />
        <div className="guia-relleno flex-1" />
        <Contacto logo="/assets/images/marcas/dtfuy.svg" marca="DTF Uruguay" whatsapp="091 612 909" />
        <PieHoja {...PIE} pagina={2} />
      </Hoja>

      {/* ── Página 3: anexo ── */}
      <Hoja>
        <Encabezado {...ENC} numero="02." seccion="Anexo" destacado="semitransparencias" marca="DTF Uruguay" />
        <Titulo linea1="Anexo" linea2="DTF sin semitransparencias" />
        <Banner>
          <b><i>Regla base:</i></b> en un archivo para DTF, cada píxel debe estar al <M><b>100%</b></M> o al <M><b>0%</b></M> de opacidad.
        </Banner>
        <Columnas
          izquierda={<>
            <Tarjeta numero={1} titulo="El problema">
              <Texto>Un píxel semitransparente no indica «no imprimas», indica «imprimí menos». Recibe poca tinta, pero igual agarra adhesivo, y en la prenda aparece como un velo opaco, un halo alrededor del diseño, bordes blanquecinos o píxeles sueltos.</Texto>
            </Tarjeta>
            <Tarjeta numero={2} titulo="De dónde vienen">
              <Lista items={[
                'Suavizado de bordes (antialiasing), también al exportar o rasterizar.',
                'Sombras paralelas, resplandores y desenfoques.',
                'Degradados «a transparente».',
                'Pinceles suaves y máscaras con calado.',
                'Opacidad o relleno menor a 100% y modos de fusión.',
                'PNG de internet, IA o «quitar fondo»: suelen traer píxeles sueltos al 1–5%, invisibles a simple vista.',
              ]} />
            </Tarjeta>
            <Tarjeta numero={3} titulo="Cómo detectarlas">
              <Bajada>Siempre en Photoshop y a la resolución final.</Bajada>
              <Texto>Corel e Illustrator no las muestran de forma confiable: exporte un PNG con fondo transparente y ábralo en Photoshop.</Texto>
              <Lista items={[
                <><b>Fondo de contraste:</b> una capa de color saturado (magenta o verde) debajo del diseño. Los halos se ven enseguida.</>,
                <><b>Trazo exterior:</b> aplique a la capa del diseño un trazo de pocos píxeles. Cada píxel suelto queda remarcado.</>,
                <><b>Duplicar la capa 8–10 veces:</b> lo que estaba al 2% se vuelve visible.</>,
              ]} />
            </Tarjeta>
          </>}
          derecha={<>
            <Tarjeta numero={4} titulo="Cómo corregir">
              <Item titulo="En Photoshop">
                <Lista items={[
                  <><b>Bordes y textos:</b> Umbral (alrededor de 128) sobre el canal alfa, aplicado como máscara.</>,
                  <><b>Sombras y degradados que quiera conservar:</b> convertirlos a semitono (puntos 100% opacos).</>,
                  <><b>Píxeles sueltos:</b> borrarlos a mano o con una selección.</>,
                ]} />
              </Item>
              <Item titulo="En Illustrator o CorelDRAW">
                <Lista items={[
                  'Opacidad al 100% y modo de fusión en Normal.',
                  'Sin sombras, resplandores, desenfoques ni calados.',
                  'Sin degradados que terminen en transparente.',
                  'Al rasterizar: suavizado en «Ninguno» y fondo transparente.',
                ]} />
              </Item>
            </Tarjeta>
            <Tarjeta numero={5} titulo="Exportar desde CorelDRAW">
              <Texto><M><b>Archivo &gt; Publicar en PDF &gt; PDF/X-4</b></M></Texto>
              <Texto>Sin conversión de color, con el perfil ICC incrustado y mapas de bits a <M><b>300 ppi</b></M> como mínimo, con compresión sin pérdida.</Texto>
              <Nota>PDF/X-4 protege los colores, pero no elimina las semitransparencias: <b>primero limpiar, después exportar.</b></Nota>
            </Tarjeta>
            <Tarjeta numero={6} titulo="Checklist antes de enviar" suave>
              <ListaNumerada items={[
                'Revisado en Photoshop con fondo de contraste y trazo: sin halos ni píxeles sueltos.',
                'Opacidad y relleno al 100%, fusión en Normal.',
                'Sin sombras, resplandores ni calados, o convertidos a semitono.',
                'Degradados sin paradas transparentes.',
                'En Corel: exportación en PDF/X-4 sin conversión de color.',
              ]} />
            </Tarjeta>
          </>}
        />
        <PieHoja {...PIE} pagina={3} />
      </Hoja>
    </Guia>
  );
}
