import { Guia, Hoja, Encabezado, Titulo, Banner, Columnas, Tarjeta, Item, Texto, Aclaracion, Medidas, Lista, Tabla, QR, Contacto, PieHoja } from './bloques';

const TEMA = { acento: '#ED2423', texto: '#ED2423', suave: '#FDD8D6', sobre: '#FFFFFF' };
const ENC = { anio: '2025', numero: '01.', seccion: 'Guía de', destacado: 'corte láser', marca: 'CENCO · Corte láser y costura' };
const PIE = { etiqueta: 'CORTE LÁSER Y COSTURA', fecha: 'Julio, 2025', total: 2 };

const PLANILLAS = [
  { titulo: 'Planilla de pedido de ropa', url: 'https://drive.google.com/uc?export=download&id=1_u6vdtCQJZxjM-DgH6RhsamqV4EhtoHw' },
  { titulo: 'Pedidos varios', detalle: '(Banderas, pañuelos, toallas, otros)', url: 'https://drive.google.com/uc?export=download&id=1yKe8DbrUyGKm2_Je6dOc3or67BDotnjl' },
];

const Reloj = () => (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);

export default function GuiaCenco() {
  return (
    <Guia tema={TEMA}>
      {/* ── Página 1 ── */}
      <Hoja>
        <Encabezado {...ENC} />
        <Titulo linea1="Guía para solicitar" linea2="Corte Láser" />
        <Banner>
          <b><i>La tela debe ser provista por el cliente</i></b>, ya sea propia o sublimada con nuestro servicio de sublimación (Impritex). Podés incluir cierres, elásticos u otros insumos si querés que los entreguemos junto a los cortes.
        </Banner>
        <Columnas
          izquierda={<>
            <Tarjeta numero={1} titulo="Requisitos técnicos del archivo">
              <Lista items={[
                <>El trazado debe estar en <b>color negro</b>, con <b>contorno de 4 puntos de grosor</b>.</>,
                <><b>Separación mínima de 3 mm entre piezas.</b></>,
              ]} />
              <Texto>Un archivo mal preparado puede generar <b>demoras o cancelación del pedido.</b></Texto>
            </Tarjeta>
            <Tarjeta numero={2} titulo="Tipos de corte">
              <Lista items={[
                <><b>Corte sobre tela sublimada:</b> el cliente debe <b>enviar el archivo ya armado.</b></>,
                <><b>Corte de moldes: CENCO arma el archivo</b> a partir de la base que se ha enviado.</>,
              ]} />
            </Tarjeta>
            <Tarjeta numero={3} titulo="Entrega organizada">
              <Lista items={[
                <>Las piezas se entregan <b>organizadas por tipo y talle</b> para facilitar el proceso de confección.</>,
                <>Para asegurar un mejor control y seguimiento de tu pedido, <b>es necesario que completes la planilla correspondiente con los talles y cantidades</b>, y <b>la envíes junto a tu pedido</b> en el formulario de CENCO o IMPRITEX.</>,
              ]} />
              <Texto><b>Escaneá los QR o tocá para descargar las planillas:</b></Texto>
              <div className="grid grid-cols-2 gap-3">
                {PLANILLAS.map(p => (
                  <div key={p.titulo} className="rounded-xl bg-[var(--g-sv)] p-3 flex flex-col items-center gap-2 text-center">
                    <p className="font-semibold text-[13px] leading-tight">{p.titulo}{p.detalle && <span className="block font-normal text-[11.5px] text-zinc-600">{p.detalle}</span>}</p>
                    <QR url={p.url} tamano={76} titulo={`Descargar: ${p.titulo}`} />
                    <a href={p.url} className="text-[12px] font-semibold text-[var(--g-tx)] underline underline-offset-2">Descargar</a>
                  </div>
                ))}
              </div>
            </Tarjeta>
          </>}
          derecha={<>
            <Tarjeta numero={4} titulo="Tamaño de corte">
              <Medidas filas={[['Máximo', '180 x 129 cm'], ['Mínimo', 'no hay']]} />
              <Texto><b>Se recomienda hacer pruebas si una pieza es muy pequeña.</b></Texto>
            </Tarjeta>
            <Tarjeta icono="?" titulo="Cómo solicito mi pedido">
              <Item titulo="Desde Formulario de CENCO con Moldes de User.">
                <Texto>Disponemos de una línea de moldes prediseñados para equipos deportivos (camperas, buzos, canguros y pantalones), <b>listos para usar eligiendo únicamente el color del diseño.</b> Esto agiliza el proceso y asegura resultados consistentes.</Texto>
              </Item>
              <Item titulo="Desde Formulario de CENCO con Moldes Cliente.">
                <Texto>Si contás con una <b>moldería especial o necesitás que armemos el archivo de corte</b>, esta es la opción indicada. Un encargado del área se pondrá en contacto para coordinar los detalles.</Texto>
                <Aclaracion><b>*Es imprescindible generar la orden de trabajo para asegurar el lugar en agenda.</b></Aclaracion>
              </Item>
              <Item titulo="Desde Formulario de Impritex (Sublimación).">
                <Texto>Corte de tela sublimada con reconocimiento de molde (punto 1). Seleccioná la opción “Servicios complementarios” y luego “Corte” o “Corte y costura”.</Texto>
                <Aclaracion><b>*Si te olvidaste de seleccionar el corte o lo decidís después, se puede solicitar a través de avisos cuando la sublimación esté pronta.</b></Aclaracion>
              </Item>
              <Texto><b className="text-[var(--g-tx)]">Importante:</b> Si sublimás un rollo de tela con un <b>patrón continuo</b> va a ser necesario que <b>cargues los moldes para poder cortarlo.</b> En ese caso, debés seleccionar la opción <b>“Moldes Cliente”</b> en el Formulario de <b>CENCO.</b></Texto>
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
            <Tarjeta icono="?" titulo="¿Cómo se cotiza?">
              <Lista items={[
                <><b>Por prenda completa</b> (cuando se trata de ropa)</>,
                <><b>Por medida</b> (en pañuelos, banderas, toallas, etc.)</>,
              ]} />
              <Texto>Se trabaja con <b>precio fijo</b>, sin mínimo de unidades.</Texto>
            </Tarjeta>
            <Tarjeta icono="?" titulo="¿Se aceptan diseños con detalles internos o calados?">
              <Texto><b>Sí, se pueden hacer.</b></Texto>
              <Texto>Se recomienda <b>consultar y revisar el archivo previamente</b> para asegurar que el diseño esté correctamente preparado para el corte láser.</Texto>
            </Tarjeta>
            <Tarjeta icono={<Reloj />} titulo="Tiempo de producción">
              <Lista items={[<>Entre <b>24 y 48 horas hábiles</b>, según el volumen del pedido.</>]} />
            </Tarjeta>
          </>}
          derecha={
            <Tarjeta titulo="Tarifario" suave>
              <Tabla
                alinearUltimas
                columnas={['Producto', 'Corte ($)', 'Costura ($)']}
                filas={[
                  ['Campera', '60', '150'],
                  ['Campera con capucha', '60', '150'],
                  ['Canguro', '60', '150'],
                  ['Buzo', '60', '100'],
                  ['Buzo con cierre', '60', '100'],
                  ['Camiseta', '30', '75'],
                  ['Short', '30', '50'],
                  ['Bandera', '30', '50'],
                  ['Chaleco 1 pieza', '20', '—'],
                  ['Pantalón', '40', '100'],
                ]}
              />
              <p className="text-center text-[12.5px] font-semibold italic text-zinc-800">Este es un tarifario base.<br />Consultar por más modelos y variantes.</p>
            </Tarjeta>
          }
        />
        <div className="guia-relleno flex-1" />
        <Contacto logo="/assets/images/marcas/cecnco.svg" marca="CENCO" whatsapp="099 957 375" />
        <PieHoja {...PIE} pagina={2} />
      </Hoja>
    </Guia>
  );
}
