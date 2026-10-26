#!/usr/bin/env python3
"""
user_preflight.py — Motor de validación de archivos de clientes
USER Centro de Impresión Digital

Analiza PDFs (y JPGs) subidos por formulario contra las reglas de cada
servicio (sublimación, tela del cliente, DTF, gran formato) y genera:
  1. Un reporte técnico JSON (para el equipo / registro)
  2. Un mensaje listo para enviar al cliente (aprobado / observado / rechazado)

Uso CLI:
  python3 user_preflight.py archivo.pdf --servicio sublimacion --ancho-tela 160
  python3 user_preflight.py logo.pdf --servicio dtf --prensa plana
  python3 user_preflight.py lona.pdf --servicio gran_formato --ancho-material 320 --colocacion

Dependencias: pymupdf, pikepdf, pillow
"""

import argparse
import json
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

# Windows: stdout por defecto es cp1252 y los mensajes usan emojis/−; forzar UTF-8
# para que la salida JSON sea siempre válida (en Linux ya es UTF-8).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import fitz  # PyMuPDF
import pikepdf
from PIL import Image

# Tope de memoria (23/10/2026): python/_tope_memoria.py del backend; sin el módulo corre sin tope
sys.path.append(str(Path(__file__).resolve().parent.parent.parent / "python"))
try:
    import _tope_memoria
except ImportError:
    _tope_memoria = None

PT_A_CM = 2.54 / 72.0  # 1 pt = 1/72 in

# ---------------------------------------------------------------- resultados

NIVEL = {"OK": 0, "ADVERTENCIA": 1, "ERROR": 2}


@dataclass
class Hallazgo:
    nivel: str          # OK / ADVERTENCIA / ERROR
    codigo: str         # identificador de regla
    mensaje: str        # técnico
    mensaje_cliente: str = ""  # redacción amable para el cliente


@dataclass
class Reporte:
    archivo: str
    servicio: str
    veredicto: str = "APROBADO"     # APROBADO / APROBADO_CON_OBSERVACIONES / RECHAZADO
    paginas: int = 0
    dimensiones_cm: list = field(default_factory=list)
    hallazgos: list = field(default_factory=list)

    def agregar(self, nivel, codigo, mensaje, mensaje_cliente=""):
        self.hallazgos.append(Hallazgo(nivel, codigo, mensaje, mensaje_cliente or mensaje))

    def cerrar(self):
        peor = max((NIVEL[h.nivel] for h in self.hallazgos), default=0)
        self.veredicto = ("APROBADO", "APROBADO_CON_OBSERVACIONES", "RECHAZADO")[peor]
        return self


# ---------------------------------------------------------------- utilidades

def cargar_reglas(ruta="reglas_user.json"):
    with open(Path(__file__).parent / ruta, encoding="utf-8") as f:
        return json.load(f)


def _cs_legible(colorspace_str):
    s = (colorspace_str or "").lower()
    if "cmyk" in s:
        return "CMYK"
    if "rgb" in s:
        return "RGB"
    if "gray" in s or "grey" in s:
        return "Escala de grises"
    if "sep" in s or "devicen" in s:
        return "Separación/Spot"
    return colorspace_str or "desconocido"


# ---------------------------------------------------------------- chequeos PDF

def check_integridad(ruta, rep, reglas_g):
    """Abre el PDF, detecta corrupción y encriptado. Devuelve doc o None."""
    try:
        doc = fitz.open(ruta)
    except Exception as e:
        rep.agregar("ERROR", "PDF_CORRUPTO",
                    f"No se pudo abrir el PDF: {e}",
                    "El archivo parece estar dañado o incompleto. "
                    "Por favor volvé a exportarlo y subilo nuevamente.")
        return None

    if doc.needs_pass or doc.is_encrypted:
        rep.agregar("ERROR", "PDF_ENCRIPTADO",
                    "PDF protegido con contraseña.",
                    "El PDF está protegido con contraseña y no podemos procesarlo. "
                    "Exportalo sin protección y volvé a enviarlo.")
        doc.close()
        return None

    rep.paginas = doc.page_count
    return doc


def check_dimensiones(doc, rep, servicio, reglas_s, args):
    """Tamaño de página vs ancho imprimible / tamaños máximos."""
    for i, page in enumerate(doc, start=1):
        w_cm = round(page.rect.width * PT_A_CM, 1)
        h_cm = round(page.rect.height * PT_A_CM, 1)
        rep.dimensiones_cm.append([w_cm, h_cm])

        # --- ancho imprimible (sublimación / tela cliente / gran formato)
        ancho_material = args.ancho_tela or args.ancho_material
        if ancho_material:
            descuento = reglas_s.get("descuento_ancho_tela_cm") or \
                        reglas_s.get("descuento_ancho_material_cm") or 0
            imprimible = ancho_material - descuento
            if min(w_cm, h_cm) > imprimible:
                rep.agregar(
                    "ERROR", "EXCEDE_ANCHO",
                    f"Página {i}: {w_cm}×{h_cm} cm excede el ancho imprimible "
                    f"({imprimible} cm = {ancho_material} − {descuento} cm).",
                    f"Tu diseño mide {w_cm}×{h_cm} cm pero el ancho imprimible del "
                    f"material elegido es {imprimible} cm (siempre se descuentan "
                    f"{descuento} cm del ancho total). Ajustá la hoja de trabajo a "
                    f"ese ancho máximo y volvé a subir el archivo.")
            elif w_cm > imprimible:
                rep.agregar(
                    "ADVERTENCIA", "ANCHO_ROTADO",
                    f"Página {i}: ancho {w_cm} cm > imprimible {imprimible} cm; "
                    f"entra solo rotado 90°.",
                    f"Tu hoja de trabajo mide {w_cm} cm de ancho y el ancho "
                    f"imprimible del material es {imprimible} cm. El diseño solo "
                    "entra girado 90°. Verificá que la orientación (y el sentido "
                    "de elasticidad de la tela, si es para prendas) sea la "
                    "correcta, o rearmá la hoja al ancho imprimible.")

        # --- largo máximo (sublimación: 5 m Illustrator)
        largo_max = reglas_s.get("largo_maximo_cm")
        if largo_max and max(w_cm, h_cm) > largo_max:
            rep.agregar(
                "ADVERTENCIA", "EXCEDE_LARGO",
                f"Página {i}: largo {max(w_cm, h_cm)} cm > {largo_max} cm.",
                f"Tu diseño supera los {largo_max/100:.0f} metros de largo. "
                "Si trabajaste a escala (por ej. 50%), indicalo en la sección "
                "'Notas' del formulario junto con el ancho final deseado. "
                "Si no, verificá las medidas del archivo.")

        # --- DTF: tamaños máximos de prensa
        if servicio == "dtf":
            clave = "tamano_maximo_curva_cm" if args.prensa == "curva" else "tamano_maximo_plana_cm"
            mx, mn = reglas_s[clave]
            lado_mayor, lado_menor = max(w_cm, h_cm), min(w_cm, h_cm)
            if lado_mayor > mx or lado_menor > mn:
                rep.agregar(
                    "ERROR", "EXCEDE_PRENSA",
                    f"Página {i}: {w_cm}×{h_cm} cm excede prensa {args.prensa} ({mx}×{mn} cm).",
                    f"El diseño mide {w_cm}×{h_cm} cm y el tamaño máximo para "
                    f"prensa {args.prensa} es {mx}×{mn} cm. Reducí el tamaño del "
                    "diseño o consultanos por alternativas.")


def check_resolucion(doc, rep, reglas_s):
    """DPI efectivo de cada imagen embebida al tamaño de colocación real."""
    dpi_min = reglas_s["dpi_minimo"]
    dpi_rec = reglas_s["dpi_recomendado"]
    peor_dpi = None

    for pno, page in enumerate(doc, start=1):
        for img in page.get_images(full=True):
            xref = img[0]
            try:
                pix_w, pix_h = img[2], img[3]
                rects = page.get_image_rects(xref)
            except Exception:
                continue
            for r in rects:
                w_in = r.width / 72.0
                h_in = r.height / 72.0
                if w_in <= 0 or h_in <= 0:
                    continue
                dpi = min(pix_w / w_in, pix_h / h_in)
                if peor_dpi is None or dpi < peor_dpi:
                    peor_dpi = dpi

    if peor_dpi is None:
        return  # PDF 100% vectorial: perfecto

    peor_dpi = round(peor_dpi)
    if peor_dpi < dpi_min:
        rep.agregar(
            "ERROR", "DPI_INSUFICIENTE",
            f"Imagen con {peor_dpi} dpi efectivos (mínimo {dpi_min}).",
            f"Al tamaño de impresión pedido, tu imagen queda en {peor_dpi} dpi "
            f"y el mínimo aceptable es {dpi_min} dpi (recomendado {dpi_rec}). "
            "Las imágenes pixeladas en pantalla se verán igual de pixeladas "
            "impresas. Usá una imagen de mayor resolución o reducí el tamaño.")
    elif peor_dpi < dpi_rec:
        rep.agregar(
            "ADVERTENCIA", "DPI_BAJO",
            f"Imagen con {peor_dpi} dpi efectivos (recomendado {dpi_rec}).",
            f"Tu imagen queda en {peor_dpi} dpi al tamaño de impresión. "
            f"Recomendamos {dpi_rec} dpi para calidad óptima. Podemos imprimir "
            "así, pero la nitidez puede no ser la ideal — queda bajo tu criterio.")


def check_color(ruta, doc, rep, reglas_s, reglas_g):
    """Espacios de color de imágenes + OutputIntent / perfil ICC."""
    espacios = set()
    for page in doc:
        for img in page.get_images(full=True):
            cs = _cs_legible(img[5])
            if cs in ("ICCBased", "Indexed", "desconocido") or "ICC" in cs:
                # Resolver por cantidad de componentes reales
                try:
                    pix = fitz.Pixmap(doc, img[0])
                    n = pix.colorspace.n if pix.colorspace else 1
                    cs = {1: "Escala de grises", 3: "RGB", 4: "CMYK"}.get(n, cs)
                    pix = None
                except Exception:
                    pass
            espacios.add(cs)

    if "RGB" in espacios:
        rep.agregar(
            "ADVERTENCIA", "COLOR_RGB",
            f"Imágenes en RGB detectadas (espacios: {sorted(espacios)}).",
            "Tu archivo contiene imágenes en RGB. Recomendamos trabajar en "
            f"{reglas_s['color_recomendado']} con el perfil "
            f"'{reglas_g['perfil_cmyk_recomendado']}'. Si preferís RGB, usá el "
            "perfil sRGB — tené en cuenta que el resultado de color queda bajo "
            "tu responsabilidad.")

    # OutputIntent (perfil de salida del PDF, típico en PDF/X)
    try:
        with pikepdf.open(ruta) as pdf:
            oi = pdf.Root.get("/OutputIntents")
            if oi is None:
                rep.agregar(
                    "ADVERTENCIA", "SIN_PERFIL_SALIDA",
                    "PDF sin OutputIntent (no es PDF/X).",
                    "El PDF no tiene perfil de color de salida embebido. Si usás "
                    "CorelDRAW, guardá como PDF/X-4 para evitar que algunos "
                    "efectos alteren los colores del archivo.")
    except Exception:
        pass


def check_fuentes_y_texto(doc, rep):
    """Texto vivo y fuentes no embebidas → recomendar convertir a curvas."""
    hay_texto = False
    no_embebidas = set()
    for page in doc:
        if page.get_text("text").strip():
            hay_texto = True
        for f in page.get_fonts(full=True):
            # f: (xref, ext, type, basefont, name, encoding, referencer)
            ext = f[1]
            basefont = f[3]
            if ext == "n/a" or ext == "":
                no_embebidas.add(basefont)

    if no_embebidas:
        rep.agregar(
            "ERROR", "FUENTES_NO_EMBEBIDAS",
            f"Fuentes no embebidas: {sorted(no_embebidas)}.",
            "El archivo usa tipografías que no están incluidas dentro del PDF: "
            f"{', '.join(sorted(no_embebidas))}. Si esas fuentes no están en "
            "nuestro sistema, el texto se imprimirá con otra tipografía. "
            "Convertí todo el texto a curvas o contornos y volvé a exportar.")
    elif hay_texto:
        rep.agregar(
            "ADVERTENCIA", "TEXTO_VIVO",
            "El PDF contiene texto vivo (no convertido a curvas).",
            "Detectamos texto sin convertir a curvas. Las fuentes están "
            "embebidas, así que en principio no habría problema, pero para "
            "evitar cualquier error de impresión recomendamos convertir el "
            "texto a curvas o contornos antes de enviar.")


def check_transparencias(ruta, rep):
    """Transparencias / grupos de mezcla que pueden complicar el RIP."""
    try:
        with pikepdf.open(ruta) as pdf:
            for page in pdf.pages:
                if "/Group" in page and page.Group.get("/S") == pikepdf.Name("/Transparency"):
                    rep.agregar(
                        "ADVERTENCIA", "TRANSPARENCIAS",
                        "El PDF contiene grupos de transparencia.",
                        "Tu diseño usa transparencias o efectos de mezcla. En "
                        "general se procesan bien, pero si combinás colores "
                        "Pantone con filtros o degradados el resultado puede "
                        "variar. Si es tu caso, evitá esos efectos o aplaná las "
                        "transparencias antes de exportar.")
                    return
    except Exception:
        pass


# ---------------------------------------------------------------- Imágenes (JPG / PNG)

def analizar_imagen(ruta, rep, reglas_s, args):
    es_png = Path(ruta).suffix.lower() == ".png"
    try:
        im = Image.open(ruta)
    except Exception as e:
        rep.agregar("ERROR", "IMG_CORRUPTA", f"No se pudo abrir: {e}",
                    "La imagen parece dañada. Volvé a exportarla y subila de nuevo.")
        return rep.cerrar()

    dpi_declarado = im.info.get("dpi", (0, 0))[0] or 0
    # Convención del portal USER: los PNG sin DPI declarado (sin chunk pHYs) se
    # asumen a 300 dpi — misma regla que aplica el formulario web al medir el archivo.
    if not dpi_declarado or dpi_declarado <= 1:
        if es_png:
            dpi = 300
            rep.agregar(
                "ADVERTENCIA", "SIN_DPI",
                "PNG sin DPI declarado; se asume 300 dpi (convención del formulario).",
                "Tu PNG no declara resolución (DPI), así que asumimos 300 dpi — "
                "la misma regla del formulario web. Verificá que las medidas "
                "resultantes coincidan con lo que querés imprimir.")
        else:
            dpi = 72
    else:
        dpi = dpi_declarado

    w_cm = round(im.width / dpi * 2.54, 1)
    h_cm = round(im.height / dpi * 2.54, 1)
    rep.paginas = 1
    rep.dimensiones_cm.append([w_cm, h_cm])

    if im.mode not in ("CMYK",):
        formato = "PNG" if es_png else "JPG"
        rep.agregar(
            "ADVERTENCIA", "COLOR_RGB",
            f"{formato} en modo {im.mode}.",
            f"Tu {formato} está en {im.mode}. Recomendamos trabajar los colores "
            "pensando en CMYK, o usar sRGB si trabajás en RGB (el resultado de "
            "color queda bajo tu responsabilidad).")

    # --- ancho imprimible (mismo criterio que los PDF)
    ancho_material = args.ancho_tela or args.ancho_material
    if ancho_material:
        descuento = reglas_s.get("descuento_ancho_tela_cm") or \
                    reglas_s.get("descuento_ancho_material_cm") or 0
        imprimible = ancho_material - descuento
        if min(w_cm, h_cm) > imprimible:
            rep.agregar(
                "ERROR", "EXCEDE_ANCHO",
                f"{w_cm}×{h_cm} cm excede el ancho imprimible ({imprimible} cm).",
                f"Tu diseño mide {w_cm}×{h_cm} cm pero el ancho imprimible del "
                f"material elegido es {imprimible} cm (siempre se descuentan "
                f"{descuento} cm del ancho total). Ajustá el diseño a ese ancho "
                "máximo y volvé a subir el archivo.")
        elif w_cm > imprimible:
            rep.agregar(
                "ADVERTENCIA", "ANCHO_ROTADO",
                f"Ancho {w_cm} cm > imprimible {imprimible} cm; entra solo rotado 90°.",
                f"Tu diseño mide {w_cm} cm de ancho y el ancho imprimible del "
                f"material es {imprimible} cm. Solo entra girado 90°. Verificá "
                "que la orientación sea la correcta.")

    # --- DTF: tamaños máximos de prensa
    if rep.servicio == "dtf":
        clave = "tamano_maximo_curva_cm" if args.prensa == "curva" else "tamano_maximo_plana_cm"
        mx, mn = reglas_s[clave]
        if max(w_cm, h_cm) > mx or min(w_cm, h_cm) > mn:
            rep.agregar(
                "ERROR", "EXCEDE_PRENSA",
                f"{w_cm}×{h_cm} cm excede prensa {args.prensa} ({mx}×{mn} cm).",
                f"El diseño mide {w_cm}×{h_cm} cm y el tamaño máximo para "
                f"prensa {args.prensa} es {mx}×{mn} cm. Reducí el tamaño del "
                "diseño o consultanos por alternativas.")

    dpi_min, dpi_rec = reglas_s["dpi_minimo"], reglas_s["dpi_recomendado"]
    if dpi < dpi_min:
        rep.agregar(
            "ERROR", "DPI_INSUFICIENTE",
            f"Imagen a {dpi} dpi declarados ({im.width}×{im.height} px → {w_cm}×{h_cm} cm).",
            f"La imagen está a {dpi} dpi y el mínimo es {dpi_min} dpi "
            f"(recomendado {dpi_rec}). Considerá que la resolución elegida "
            "afecta el tamaño final del diseño.")
    elif dpi < dpi_rec:
        rep.agregar("ADVERTENCIA", "DPI_BAJO",
                    f"Imagen a {dpi} dpi (recomendado {dpi_rec}).",
                    f"La imagen está a {dpi} dpi; recomendamos {dpi_rec} dpi "
                    "para calidad óptima.")
    return rep.cerrar()


# ---------------------------------------------------------------- mensaje

def redactar_mensaje_cliente(rep, reglas_s):
    nombre_srv = reglas_s["nombre"]
    contacto = reglas_s.get("contacto", "")
    lineas = []

    if rep.veredicto == "APROBADO":
        lineas.append(f"✅ ¡Tu archivo para {nombre_srv} fue aprobado!")
        lineas.append("Pasa a la cola de producción. Te avisaremos cuando esté pronto.")
    elif rep.veredicto == "APROBADO_CON_OBSERVACIONES":
        lineas.append(f"⚠️ Tu archivo para {nombre_srv} fue aceptado, con observaciones:")
        lineas.append("")
        for h in rep.hallazgos:
            if h.nivel == "ADVERTENCIA":
                lineas.append(f"• {h.mensaje_cliente}")
        lineas.append("")
        lineas.append("Si querés corregir algo, subí el archivo nuevamente antes del "
                      "cierre de recepción. Si no, seguimos con este archivo tal cual "
                      "(recordá que es responsabilidad del cliente revisar el archivo "
                      "antes de enviarlo).")
    else:
        lineas.append(f"❌ Tu archivo para {nombre_srv} no cumple los requisitos "
                      "y no podemos procesarlo todavía:")
        lineas.append("")
        for h in rep.hallazgos:
            if h.nivel == "ERROR":
                lineas.append(f"• {h.mensaje_cliente}")
        avisos = [h for h in rep.hallazgos if h.nivel == "ADVERTENCIA"]
        if avisos:
            lineas.append("")
            lineas.append("Además, tené en cuenta:")
            for h in avisos:
                lineas.append(f"• {h.mensaje_cliente}")
        lineas.append("")
        lineas.append("Corregí estos puntos y volvé a subir el archivo por el formulario.")

    if contacto:
        lineas.append("")
        lineas.append(f"Por consultas, escribinos por WhatsApp al {contacto}.")
    return "\n".join(lineas)


# ---------------------------------------------------------------- main

def analizar(ruta, servicio, args):
    reglas = cargar_reglas()
    reglas_g = reglas["global"]
    reglas_s = reglas["servicios"][servicio]
    rep = Reporte(archivo=Path(ruta).name, servicio=servicio)

    ext = Path(ruta).suffix.lower()
    if ext not in reglas_g["formatos_admitidos"]:
        rep.agregar("ERROR", "FORMATO_INVALIDO",
                    f"Extensión {ext} no admitida.",
                    f"Solo aceptamos archivos PDF, PNG o JPG. Tu archivo es '{ext}'. "
                    "Exportá tu diseño en formato PDF (ideal PDF/X-4 desde "
                    "CorelDRAW) o PNG y volvé a subirlo.")
        return rep.cerrar()

    if ext in (".jpg", ".jpeg", ".png"):
        return analizar_imagen(ruta, rep, reglas_s, args)

    doc = check_integridad(ruta, rep, reglas_g)
    if doc is None:
        return rep.cerrar()

    check_dimensiones(doc, rep, servicio, reglas_s, args)
    check_resolucion(doc, rep, reglas_s)
    check_color(ruta, doc, rep, reglas_s, reglas_g)
    check_fuentes_y_texto(doc, rep)
    check_transparencias(ruta, rep)
    doc.close()
    return rep.cerrar()


def main():
    ap = argparse.ArgumentParser(description="Preflight USER")
    ap.add_argument("archivo")
    ap.add_argument("--servicio", required=True,
                    choices=["sublimacion", "tela_cliente", "dtf", "gran_formato"])
    ap.add_argument("--ancho-tela", type=float, default=None,
                    help="Ancho total de la tela en cm (sublimación)")
    ap.add_argument("--ancho-material", type=float, default=None,
                    help="Ancho total del material en cm (gran formato)")
    ap.add_argument("--prensa", choices=["plana", "curva"], default="plana",
                    help="Tipo de prensa (DTF)")
    ap.add_argument("--colocacion", action="store_true",
                    help="El cliente pidió servicio de colocación (gran formato)")
    ap.add_argument("--json", action="store_true", help="Salida solo JSON")
    args = ap.parse_args()

    rep = analizar(args.archivo, args.servicio, args)
    reglas_s = cargar_reglas()["servicios"][args.servicio]

    salida = {
        "reporte": {**asdict(rep), "hallazgos": [asdict(h) for h in rep.hallazgos]},
        "mensaje_cliente": redactar_mensaje_cliente(rep, reglas_s),
    }
    if args.json:
        print(json.dumps(salida, ensure_ascii=False, indent=2))
    else:
        r = salida["reporte"]
        print(f"\n=== PREFLIGHT USER · {r['archivo']} · {reglas_s['nombre']} ===")
        print(f"Veredicto: {r['veredicto']}")
        print(f"Páginas: {r['paginas']} · Dimensiones (cm): {r['dimensiones_cm']}")
        for h in r["hallazgos"]:
            print(f"  [{h['nivel']}] {h['codigo']}: {h['mensaje']}")
        print("\n--- Mensaje para el cliente ---\n")
        print(salida["mensaje_cliente"])

    sys.exit(0 if rep.veredicto != "RECHAZADO" else 1)


if __name__ == "__main__":
    # PY_MAX_MEM_MB lo pone utils/preflight.js. Sin memoria: sin JSON, mensaje por stderr y código 2
    # (el 1 es RECHAZADO, que sí trae su JSON)
    if _tope_memoria:
        _tope_memoria.aplicar()
    try:
        main()
    except MemoryError as e:
        print(f"sin memoria suficiente para procesarlo ({str(e) or 'MemoryError'})", file=sys.stderr)
        sys.exit(2)
