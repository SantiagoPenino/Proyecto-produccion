#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tpu_matriz.py — TPU "Hago mi matriz": del vector del cliente a los 2 PDFs del RIP.

Reemplaza, para el modo "matriz propia", lo que hoy hace SCRIPT DE PRUEBA 1PDF.jsx en
Illustrator. Reproduce su contrato de salida (verificado 04/09/2026 sobre
"PRUEBA SPOTS como TINTAS SINEDIT.pdf" y "TPU UV  - Corte.pdf"):

  <base>-cmyk-spots.pdf   una pagina por plancha, 4 capas OCG (panel de capas, de arriba a abajo):
                            CMYK · Spot 1 (Relieve 1) · Spot 2 (Relieve 2) · Spot 3 (Barniz)
                          y 3 tintas planas Separation "Spot 1" / "Spot 2" / "Spot 3"
                          (alternate DeviceCMYK). ORDEN DE DIBUJO: CMYK primero y los spots
                          ENCIMA con sobreimpresion (receta de dtf_blanco); si el arte va encima,
                          su knockout anula el relieve (ver generar()). PhotoPrint separa por
                          TINTA, no por capa, y el orden de deposicion lo fija la maquina.
  <base>-corte.pdf        misma geometria de plancha, capa OCG "Corte", tinta "CutContour".
  <base>-boceto.pdf       (opcional) el parche unitario a tamanio real con cotas, para el
                          cliente / "Mis matrices". No va al RIP.
  <base>-capas.pdf        (control, job.capas) una pagina por capa del parche unitario + "todo
                          junto", rotuladas, para comprobar que cada capa lleva lo suyo.
  <base>-vista.png        (job.vista) arte + spots tintados + corte, para el operario.

Subcomandos (la ULTIMA linea de stdout es SIEMPRE un JSON, incluso al fallar):

  python tpu_matriz.py analizar  arte.pdf
      -> {ok, vector, motivo, pagina, bbox, formas:[{seqno, fill, d, rect,...}], colores:[...]}
         Coordenadas en pt con origen arriba-izquierda (las de fitz): sirven tal cual para
         un <svg viewBox="x y w h"> en el editor de zonas.

  python tpu_matriz.py generar  job.json  [--preview salida.png]
      -> {ok, archivos:{impresion, corte, boceto}, parche_mm, plancha, islas, avisos}

Formato de job.json:
  {
    "pdf": "/ruta/arte_cliente.pdf",
    "salida_dir": "/ruta/salida",
    "base": "tpu12345",
    "medida_mm": {"ancho": 80, "alto": 60},         # opcional: el arte se ESCALA para entrar
    "sangrado_mm": 1.0,                             # default 1
    "texturas_dir": "/ruta/public/assets/textures",
    "zonas": [
      {"indice": 0, "nombre": "Amarillo", "seqnos": [1, 5, 9],
       "textura": "textura-005.svg" | null,         # null = liso (zona entera en relieve)
       "repeticiones": 6, "escala": 1.0, "dx": 0.0, "dy": 0.0,
       "invertida": false,                          # polaridad que decidio el visor (opcional)
       "doble": false,                              # true = tambien en Spot 2 (doble altura)
       "barniz": true}                              # true = zona entera en Spot 3
    ],
    "imposicion": {"cantidad": 40, "plancha_mm": 300, "sep_mm": 5, "sep_filas_mm": 5,   # entre CORTES
                   "max_alto_mm": 500, "completar_filas": true},
    "aplanar": true,                                # spots inline en la pagina (default; ver APLANAR_*)
    "spots_raster": false,                          # true = capas de relieve como IMAGEN con su tinta
    "spots_trazado": false,                         # true = capas de relieve como TRAZADOS ya recortados
    "boceto": true,
    "relieve_doble_siempre": false,                 # true = Spot 2 con TODAS las zonas (un solo cabezal blanco)
    "pieza_unica": true                             # el corte envuelve TODO el arte (default)
  }

Reglas (docs/tpu-cliente-sube-vectorizado-plan.md §1 y §0.6, decisiones del 04/09):
  - Corte = silueta exterior del arte (una por isla, sin huecos), SIN agrandar.
  - CMYK = el arte del cliente INTACTO (se incrusta la pagina como Form XObject: conserva sus
    espacios de color) + un anillo de sangrado de 1 mm hacia afuera relleno con el color de
    la forma mas externa de cada isla.
  - Spot 1 = toda zona: lisa (su geometria rellena) o con textura (tiles del SVG del catalogo
    recortados a la geometria de la zona). Spot 2 = copia exacta de las zonas "doble".
    Spot 3 = las zonas con barniz, lisas. Todo vectorial, tinta al 100 %.
  - Escala de textura WYSIWYG con el visor 3D: ancho del tile = ancho del parche /
    repeticiones * escala; dx/dy = corrimiento en fracciones de tile.
  - Imposicion = la del script: copias por fila = 1 + floor((plancha - parche + 0.5pt) /
    (parche + sep)), grupo centrado, registros de 5 mm a 5 mm del borde en cada limite de
    fila (solo CMYK y Corte), mesa = contenido + 5 mm. UNA sola plancha de alto maximo
    max_alto_mm (decision 04/09: 50 cm), siempre con filas completas (sobran hasta
    columnas-1 parches). Si la plancha no alcanza la cantidad pedida, los archivos de
    impresion y corte llevan el sufijo "-<N>copias", con N = VECES que hay que imprimir la
    plancha (copias de plancha) para cubrir el pedido.
"""

import io
import json
import math
import os
import sys
import zlib

import numpy as np

try:                        # PyMuPDF >= 1.24: nombre nuevo. 'fitz' sigue existiendo pero en 1.28 (VPS) avisa deprecado.
    import pymupdf as fitz
except ImportError:         # instalaciones viejas
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import svg_trazos           # lector propio de los SVG del catalogo (fitz no aplica clases CSS ni <pattern>)

PT_POR_MM = 72.0 / 25.4
DIAMETRO_REGISTRO_MM = 5.0
OFFSET_REGISTRO_MM = 5.0        # del borde de la plancha al borde de la marca
MARGEN_EXTRA_MM = 5.0           # mesa = contenido + este margen
# Separacion entre parches vecinos, medida entre LINEAS DE CORTE (decision del usuario 08/09:
# "5 mm entre escudo y escudo, 2,5 mm de cada uno, solo si hay un escudo de ese lado"). Como cada
# parche ya lleva su sangrado, la separacion entre las cajas del parche es SEP - 2 x sangrado; y
# contra el borde de la plancha no se agrega nada, porque ahi no hay vecino.
SEP_CORTES_DEFAULT_MM = 5.0
SEP_FILAS_DEFAULT_MM = 5.0
PLANCHA_DEFAULT_MM = 300.0
MAX_ALTO_DEFAULT_MM = 500.0     # alto maximo de la plancha (decision del usuario 04/09)
REPETICIONES_DEFAULT = 2        # espeja REPETICIONES_DEFAULT de webOrdersController.getTexturasTpu
CAPAS_BANDA_MM = 12.0           # banda superior con el rotulo en el PDF de control de capas

# Orden del PANEL DE CAPAS, como la referencia de Illustrator ('TPU UV  - Impresion.pdf'):
# Spot 3 -> Spot 2 -> Spot 1 -> CMYK. El orden de DIBUJO en la pagina es otro (CMYK primero, ver
# generar()): el arte del cliente encima anulaba el relieve.
CAPAS = [
    ("Spot 3 (Barniz)", "Spot 3"),
    ("Spot 2 (Relieve 2)", "Spot 2"),
    ("Spot 1 (Relieve 1)", "Spot 1"),
    ("CMYK", None),
]
CAPA_CORTE = ("Corte", "CutContour")

DPI_RASTER = 600                # silueta / sangrado / islas
MAX_PIXELES_RASTER = 24_000_000
TOL_SIMPLIFICACION_MM = 0.05    # Douglas-Peucker sobre los contornos
CIERRE_MM = 0.3                 # une piezas separadas por menos de 2x esto
ISLA_MINIMA_MM2 = 1.0
# PIEZA UNICA (decision del usuario 08/09): todo lo que trae el archivo del cliente es UN parche.
# Las piezas sueltas (las 4 estrellas del escudo de la AUF) se unen con TPU al cuerpo principal en
# vez de salir como recortes separados. Se cierra la silueta con un radio creciente hasta que quede
# un solo componente; si ni con el tope se unen, se usa la envolvente convexa.
PIEZA_UNICA = True
CIERRE_MAX_MM = 25.0
PASO_CURVA_MM = 0.15


# ── utilidades ────────────────────────────────────────────────────────────────

def _f(v):
    """Numero para content stream: 3 decimales, sin ceros de mas ni '-0'."""
    s = f"{float(v):.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def _hex(rgb):
    if rgb is None:
        return None
    r, g, b = (max(0, min(255, int(round(c * 255)))) for c in rgb[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def _rgb_a_cmyk(rgb):
    r, g, b = rgb[:3]
    k = 1.0 - max(r, g, b)
    if k >= 0.999:
        return (0.0, 0.0, 0.0, 1.0)
    return ((1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k)


def _leer_json(ruta):
    with open(ruta, "r", encoding="utf-8") as fh:
        return json.load(fh)


# ── lectura del vector ───────────────────────────────────────────────────────

class Forma:
    """Un path pintado del PDF del cliente, tal como lo entrega fitz.get_drawings()."""

    __slots__ = ("seqno", "items", "fill", "stroke", "width", "even_odd", "closePath",
                 "rect", "es_fondo", "tipo")

    def __init__(self, d):
        self.seqno = int(d.get("seqno", 0))
        self.items = d.get("items") or []
        self.fill = d.get("fill")
        self.stroke = d.get("color")
        self.width = d.get("width") or 0.0
        self.even_odd = bool(d.get("even_odd"))
        self.closePath = bool(d.get("closePath"))
        self.rect = d.get("rect")
        self.tipo = d.get("type") or ""
        self.es_fondo = False


def _es_rectangulo(forma):
    it = forma.items
    if len(it) == 1 and it[0][0] == "re":
        return True
    if len(it) == 4 and all(x[0] == "l" for x in it):
        return True
    return False


def leer_vector(ruta_pdf):
    """Abre el PDF del cliente y devuelve (doc fitz, page, formas, avisos, veredicto)."""
    import pikepdf

    avisos = []
    motivo = None

    pdf = pikepdf.open(ruta_pdf)
    if len(pdf.pages) != 1:
        motivo = f"El PDF tiene {len(pdf.pages)} paginas; el arte tiene que ser 1 pagina."
    imagenes = 0
    degradados = 0
    fuentes = 0
    vistos = set()

    def recorrer(recursos):
        nonlocal imagenes, degradados, fuentes
        if recursos is None:
            return
        xobjs = recursos.get("/XObject")
        if xobjs is not None:
            for _, xo in xobjs.items():
                try:
                    oid = xo.objgen
                except Exception:
                    oid = None
                if oid in vistos:
                    continue
                if oid is not None:
                    vistos.add(oid)
                st = str(xo.get("/Subtype"))
                if st == "/Image":
                    imagenes += 1
                elif st == "/Form":
                    recorrer(xo.get("/Resources"))
                    imagenes += _inline_images(xo)
        if recursos.get("/Shading") is not None or recursos.get("/Pattern") is not None:
            degradados += 1
        if recursos.get("/Font") is not None and len(recursos.get("/Font").keys()) > 0:
            fuentes += 1

    def _inline_images(obj):
        n = 0
        try:
            for inst in pikepdf.parse_content_stream(obj):
                if isinstance(inst, pikepdf.ContentStreamInlineImage):
                    n += 1
        except Exception:
            pass
        return n

    pagina0 = pdf.pages[0]
    recorrer(pagina0.get("/Resources"))
    imagenes += _inline_images(pagina0)
    pdf.close()

    doc = fitz.open(ruta_pdf)
    page = doc[0]
    texto = page.get_text("text").strip()

    if motivo is None and imagenes > 0:
        motivo = (f"El PDF contiene {imagenes} imagen(es) rasterizada(s). El arte tiene que ser "
                  f"100 % vectorial (trazados), sin fotos ni mapas de bits.")
    if motivo is None and (texto or fuentes):
        motivo = "El PDF tiene texto sin convertir a curvas. Converti los textos a contornos y volve a exportar."
    if degradados:
        avisos.append("El arte usa degradados o patrones: se imprimen, pero no pueden formar una zona de relieve.")

    formas = [Forma(d) for d in page.get_drawings()]
    formas = [f for f in formas if f.items and (f.fill is not None or (f.stroke is not None and f.width > 0))]

    # FONDO DE LA MESA DE TRABAJO: formas blancas que llegan al borde de la hoja. No son parte del
    # parche — si se cuentan, el corte sale rectangular en vez de seguir el dibujo (caso del escudo
    # de la AUF de seeklogo, 07/09: una banda blanca arriba y dos esquinas abajo).
    # Se pide que toque AL MENOS DOS bordes de la hoja: el blanco legitimo del dibujo (el interior
    # del escudo) queda separado del borde, y una forma que apenas roza un lado no se descarta.
    pr = page.rect
    tol = 1.0
    for f in formas:
        if f.fill is None or min(f.fill[:3]) < 0.95 or f.rect is None:
            continue
        r = f.rect
        bordes = sum((abs(r.x0 - pr.x0) <= tol, abs(r.y0 - pr.y0) <= tol,
                      abs(r.x1 - pr.x1) <= tol, abs(r.y1 - pr.y1) <= tol))
        if bordes >= 2:
            f.es_fondo = True
    # Nunca dejar el arte vacio: si TODO seria fondo, no se descarta nada (arte blanco a sangre).
    if formas and all(f.es_fondo or f.fill is None for f in formas):
        for f in formas:
            f.es_fondo = False
    n_fondo = sum(1 for f in formas if f.es_fondo)
    if n_fondo:
        avisos.append(f"Se ignoraron {n_fondo} forma(s) blancas de fondo que llegaban al borde de la hoja "
                      f"(no son parte del parche: el corte sigue el dibujo).")

    utiles = [f for f in formas if not f.es_fondo]
    if motivo is None and not utiles:
        motivo = "No se encontraron trazados rellenos en el PDF."
    if motivo is None and len(utiles) > 5000:
        avisos.append(f"El arte tiene {len(utiles)} trazados: probablemente un autotrazado. Revisalo antes de seguir.")

    solo_trazo = [f for f in utiles if f.fill is None]
    if solo_trazo:
        avisos.append(f"{len(solo_trazo)} trazado(s) son solo linea (sin relleno): entran al corte por su contorno "
                      f"si son cerrados, pero no pueden ser zona de relieve.")

    return doc, page, formas, avisos, motivo


# ── geometria: items de fitz -> operadores PDF / poligonos ────────────────────

def _pts_item(item):
    """Puntos de control de un item de fitz, ya como tuplas (x, y) en coordenadas fitz."""
    op = item[0]
    if op == "l":
        return [(item[1].x, item[1].y), (item[2].x, item[2].y)]
    if op == "c":
        return [(p.x, p.y) for p in item[1:5]]
    if op == "re":
        r = item[1]
        return [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
    if op == "qu":
        q = item[1]
        return [(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)]
    return []


def _mismo(a, b, tol=1e-4):
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def path_pdf(forma, T):
    """Operadores de construccion de path (sin el operador de pintura). T: (x,y) fitz -> (X,Y) destino."""
    out = []
    cur = None
    for item in forma.items:
        op = item[0]
        pts = _pts_item(item)
        if not pts:
            continue
        if op in ("l", "c"):
            if cur is None or not _mismo(cur, pts[0]):
                X, Y = T(*pts[0])
                out.append(f"{_f(X)} {_f(Y)} m")
            if op == "l":
                X, Y = T(*pts[1])
                out.append(f"{_f(X)} {_f(Y)} l")
            else:
                c = [T(*p) for p in pts[1:4]]
                out.append(" ".join(f"{_f(x)} {_f(y)}" for x, y in c) + " c")
            cur = pts[-1]
        else:  # re / qu: subpath cerrado propio
            P = [T(*p) for p in pts]
            out.append(f"{_f(P[0][0])} {_f(P[0][1])} m " +
                       " ".join(f"{_f(x)} {_f(y)} l" for x, y in P[1:]) + " h")
            cur = None
    if forma.closePath and out:
        out.append("h")
    return "\n".join(out)


def _bezier(p0, p1, p2, p3, n):
    pts = []
    for i in range(1, n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def poligonos(forma, paso_pt):
    """Aplana la forma a una lista de subpaths (listas de (x, y) en coordenadas fitz)."""
    subs = []
    cur = []
    last = None
    for item in forma.items:
        op = item[0]
        pts = _pts_item(item)
        if not pts:
            continue
        if op in ("l", "c"):
            if last is None or not _mismo(last, pts[0]):
                if len(cur) >= 3:
                    subs.append(cur)
                cur = [pts[0]]
            if op == "l":
                cur.append(pts[1])
            else:
                largo = sum(math.dist(pts[i], pts[i + 1]) for i in range(3))
                n = int(max(4, min(48, math.ceil(largo / paso_pt))))
                cur.extend(_bezier(pts[0], pts[1], pts[2], pts[3], n))
            last = pts[-1]
        else:
            if len(cur) >= 3:
                subs.append(cur)
            subs.append(list(pts))
            cur = []
            last = None
    if len(cur) >= 3:
        subs.append(cur)
    return subs


# ── raster de silueta (solo para corte, sangrado e islas) ────────────────────

def rasterizar(formas, bbox, escala, sangrado_pt, ppmm):
    """Mascara booleana del arte + mapa de 'dueño' (indice de forma + 1, la ultima pintada gana).

    Coordenadas de parche: origen abajo-izquierda del parche (que incluye el sangrado).

    Se pinta con PIL (scanline en C): skimage.draw.polygon hace punto-en-poligono por cada
    pixel del bbox y con formas grandes a 600 dpi tardaba 15 s; PIL lo hace en decimas."""
    from PIL import Image, ImageDraw

    x0, y0, x1, y1 = bbox                       # bbox del arte en coordenadas fitz (y hacia abajo)
    Wp = (x1 - x0) * escala + 2 * sangrado_pt   # pt
    Hp = (y1 - y0) * escala + 2 * sangrado_pt
    W_px = int(math.ceil(Wp / PT_POR_MM * ppmm))
    H_px = int(math.ceil(Hp / PT_POR_MM * ppmm))
    img_owner = Image.new("I", (W_px, H_px), 0)      # int32: indice de forma + 1 (la ultima pintada gana)
    img_mask = Image.new("1", (W_px, H_px), 0)
    dr_owner = ImageDraw.Draw(img_owner)
    dr_mask = ImageDraw.Draw(img_mask)

    def a_px(x, y):
        X = (x - x0) * escala + sangrado_pt
        Y = (y1 - y) * escala + sangrado_pt           # y hacia arriba en el parche
        col = X / PT_POR_MM * ppmm
        row = H_px - Y / PT_POR_MM * ppmm
        return col, row

    paso_pt = PASO_CURVA_MM * PT_POR_MM
    for idx, f in enumerate(formas):
        if f.es_fondo:
            continue
        for sub in poligonos(f, paso_pt):
            if len(sub) < 3:
                continue
            pts = [a_px(x, y) for x, y in sub]
            dr_mask.polygon(pts, fill=1)
            if f.fill is not None:
                dr_owner.polygon(pts, fill=idx + 1)
    mask = np.array(img_mask, dtype=bool)
    owner = np.array(img_owner, dtype=np.int32)
    return mask, owner, W_px, H_px, Wp, Hp


def _disco(mask, radio_px, dilatar):
    from scipy import ndimage
    if radio_px <= 0:
        return mask.copy()
    if dilatar:
        d = ndimage.distance_transform_edt(~mask)
        return d <= radio_px
    d = ndimage.distance_transform_edt(mask)
    return d > radio_px


def contornos_de(mask_bool, tol_px):
    """Contornos (lista de arrays Nx2 en (row, col)) de una mascara, simplificados."""
    from skimage.measure import find_contours, approximate_polygon
    padded = np.pad(mask_bool.astype(np.float32), 1)
    out = []
    for c in find_contours(padded, 0.5):
        c = c - 1.0                                     # quitar el padding
        if len(c) >= 3:
            c = approximate_polygon(c, tolerance=tol_px)
            if len(c) >= 3:
                out.append(c)
    return out


def _area_poligono(c):
    x = c[:, 1]
    y = c[:, 0]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def _unir_en_una(mask, ppmm, cierre_max_mm=CIERRE_MAX_MM):
    """Devuelve la mascara cerrada de modo que quede UNA sola pieza (ver PIEZA_UNICA)."""
    from scipy import ndimage
    etiquetas, n = ndimage.label(mask, structure=np.ones((3, 3), dtype=int))
    if n <= 1:
        return mask
    r = 1.0
    while r <= cierre_max_mm:
        cerrada = _disco(_disco(mask, r * ppmm, True), r * ppmm, False) | mask
        _, n2 = ndimage.label(cerrada, structure=np.ones((3, 3), dtype=int))
        if n2 <= 1:
            return cerrada
        r *= 1.6
    # Ultimo recurso: envolvente convexa de todo el arte.
    from skimage.morphology import convex_hull_image
    return convex_hull_image(mask)


def islas(mask, owner, formas, ppmm, sangrado_mm, pieza_unica=PIEZA_UNICA):
    """Por isla del arte: contorno de corte (exterior, sin huecos), contornos del sangrado
    (compound, even-odd) y color del borde. Coordenadas (row, col) en px del raster."""
    from scipy import ndimage

    cierre_px = CIERRE_MM * ppmm
    tol_px = TOL_SIMPLIFICACION_MM * ppmm
    unida = _disco(_disco(mask, cierre_px, True), cierre_px, False) | mask
    if pieza_unica:
        # El corte envuelve TODO el arte: una sola pieza, con el TPU uniendo lo que estaba suelto.
        unida = _unir_en_una(unida, ppmm)
    etiquetas, n = ndimage.label(unida, structure=np.ones((3, 3), dtype=int))
    resultado = []
    descartadas = 0
    for i in range(1, n + 1):
        region = etiquetas == i
        area_mm2 = region.sum() / (ppmm * ppmm)
        if area_mm2 < ISLA_MINIMA_MM2:
            descartadas += 1
            continue
        original = region & mask
        # Corte: exterior de la isla, huecos rellenos, sin agrandar. Con PIEZA_UNICA, `region` ya
        # trae los puentes de TPU que unen las piezas sueltas, y el corte los sigue.
        llena = ndimage.binary_fill_holes(region if pieza_unica else (original | region))
        cortes = contornos_de(llena, tol_px)
        if not cortes:
            continue
        corte = max(cortes, key=_area_poligono)
        # Sangrado: la isla original dilatada 1 mm, con sus huecos (>2 mm) como sub-contornos.
        dil = _disco(original, sangrado_mm * ppmm, True)
        sangrado = contornos_de(dil, tol_px)
        # Color del borde: la forma visible en los pixeles del borde interior de la isla.
        borde = original & ~_disco(original, 1.5, False)
        due = owner[borde]
        due = due[due > 0]
        color = None
        if due.size:
            idx = int(np.bincount(due).argmax()) - 1
            color = formas[idx].fill
        if color is None:
            # isla solo de trazos: primer relleno que toque la isla, o negro
            due2 = owner[original]
            due2 = due2[due2 > 0]
            color = formas[int(np.bincount(due2).argmax()) - 1].fill if due2.size else (0.0, 0.0, 0.0)
        resultado.append({"corte": corte, "sangrado": sangrado, "color": color, "area_mm2": area_mm2})
    return resultado, descartadas


# ── construccion de PDFs (pikepdf) ───────────────────────────────────────────

# Color ALTERNATIVO (CMYK) de cada tinta plana: es lo que pinta cualquier visor que no separe
# tintas (Drive, pdf.js, Acrobat sin "previsualizar sobreimpresion"). El RIP separa por NOMBRE,
# no por este color. Decision del usuario 07/09: las tres tintas de relieve se ven NEGRAS (el
# relieve es una sola tinta negra en los archivos de produccion, plan §1); el corte queda magenta
# como en el archivo de referencia. Con (0,0,0,0) —la receta de dtf_blanco para la tinta blanca—
# los visores pintaban las zonas de BLANCO OPACO encima del arte y el archivo se veia vacio
# (caso TPU-20744, 04/09).
ALTERNATIVOS = {
    "Spot 1": (0, 0, 0, 1),
    "Spot 2": (0, 0, 0, 1),
    "Spot 3": (0, 0, 0, 1),
    "CutContour": (0, 1, 0, 0),
}


def _separation(pdf, nombre):
    from pikepdf import Array, Dictionary, Name
    fn = Dictionary()
    fn[Name.FunctionType] = 2
    fn[Name.Domain] = Array([0, 1])
    fn[Name.C0] = Array([0, 0, 0, 0])
    fn[Name.C1] = Array(list(ALTERNATIVOS.get(nombre, (0, 0, 0, 1))))
    fn[Name.N] = 1
    fn[Name.Range] = Array([0, 1, 0, 1, 0, 1, 0, 1])
    return pdf.make_indirect(Array([Name.Separation, Name("/" + nombre), Name.DeviceCMYK, fn]))


def _ocg(pdf, nombre):
    """Capa (OCG) declarada COMO LAS DE ILLUSTRATOR (verificado 08/09 en 'TPU UV - Impresion.pdf'):
    con /Intent [/View /Design] y /Usage /CreatorInfo. Las mias iban sin /Intent ni /Usage y el RIP
    no imprimia su contenido — la prueba que si salio (`prueba-trama-spot.pdf`) no tenia capas."""
    from pikepdf import Array, Dictionary, Name, String
    d = Dictionary()
    d[Name.Type] = Name.OCG
    d[Name.Name] = nombre
    d[Name.Intent] = Array([Name.View, Name("/Design")])
    d[Name.Usage] = Dictionary({
        "/CreatorInfo": Dictionary({"/Creator": String("Adobe Illustrator 29.0"), "/Subtype": Name("/Artwork")}),
    })
    return pdf.make_indirect(d)


def _form_xobject(pdf, contenido, bbox, recursos):
    from pikepdf import Array, Name
    xo = pdf.make_stream(contenido.encode("latin-1") if isinstance(contenido, str) else contenido)
    xo[Name.Type] = Name.XObject
    xo[Name.Subtype] = Name.Form
    xo[Name.FormType] = 1
    xo[Name.BBox] = Array([float(v) for v in bbox])
    xo[Name.Resources] = recursos
    return pdf.make_indirect(xo)


def _extgstate_overprint(pdf):
    """Sobreimpresion ENCENDIDA, como dtf_blanco.incrustar_spot (en produccion desde agosto).
    Imprescindible para las capas RASTERIZADAS: la imagen cubre TODA la plancha y, sin
    sobreimpresion, hace knockout de los otros canales en cada pixel sin tinta — se comia el
    relieve texturado (07/09). Para los vectores se sigue usando el /GS0 de Illustrator."""
    from pikepdf import Dictionary, Name
    gs = Dictionary()
    gs[Name.Type] = Name.ExtGState
    gs[Name.OP] = True
    gs[Name("/op")] = True
    gs[Name.OPM] = 1
    gs[Name.BM] = Name.Normal
    gs[Name.SMask] = Name("/None")
    return pdf.make_indirect(gs)


def _extgstate_illustrator(pdf):
    """El /GS0 que Illustrator pone en CADA objeto del archivo que PhotoPrint separa bien
    (verificado 07/09 en 'TPU UV  - Impresion.pdf'): knockout, sin mascara, opacidad 1."""
    from pikepdf import Dictionary, Name
    gs = Dictionary()
    gs[Name.Type] = Name.ExtGState
    gs[Name("/AIS")] = False
    gs[Name.BM] = Name.Normal
    gs[Name.CA] = 1.0
    gs[Name("/ca")] = 1.0
    gs[Name.OP] = False
    gs[Name("/op")] = False
    gs[Name.OPM] = 1
    gs[Name("/SA")] = True
    gs[Name.SMask] = Name("/None")   # Name.None_ se escribe "/None_" (pikepdf); el RIP espera "/None"
    return pdf.make_indirect(gs)


def _forzar_sobreimpresion(xobj, vistos=None):
    """Pone /OP y /op en true en TODOS los ExtGState de un XObject y de los que cuelgan de el.

    El PDF del cliente sale de Illustrator con un /GS0 de knockout (/OP false, /op false) aplicado
    a cada objeto. Ese estado vive DENTRO del Form XObject del arte, asi que pisa la sobreimpresion
    que le pongamos al hacer el `Do`: el arte termina borrando las tintas planas que tiene debajo y
    del relieve solo queda el contorno (diagnostico del 08/09, pruebas 3 a 13).

    Con /op true y /OPM 1 (modo no-cero) un componente en 0 ya no borra lo que hay debajo: el arte
    sigue imprimiendo igual en CMYK pero deja intactos Spot 1/2/3. Si el arte no declara ningun
    ExtGState, se agrega uno y NO se puede aplicar sin tocar su content stream — ese caso se avisa.
    """
    from pikepdf import Dictionary, Name
    if vistos is None:
        vistos = set()
    try:
        oid = xobj.objgen
    except Exception:
        oid = None
    if oid is not None:
        if oid in vistos:
            return 0
        vistos.add(oid)
    res = xobj.get(Name.Resources)
    if res is None:
        return 0
    n = 0
    gss = res.get(Name.ExtGState)
    if gss is not None:
        for _, gs in gss.items():
            gs[Name.OP] = True
            gs[Name("/op")] = True
            gs[Name.OPM] = 1
            n += 1
    hijos = res.get(Name.XObject)
    if hijos is not None:
        for _, hijo in hijos.items():
            if str(hijo.get(Name.Subtype)) == "/Form":
                n += _forzar_sobreimpresion(hijo, vistos)
    return n


# Umbral de "tinta mayoritaria" para invertir la textura, como el visor (cargarTile: si lo que
# subiria es mas de la mitad de la superficie, se da vuelta y sube el fondo).
POLARIDAD_INVERTIR = 0.5

# APLANADO de las capas con tinta plana (07/09): PhotoPrint mostraba las capas Spot 1/2/3 VACIAS al
# asignarlas a spot color. El archivo de Illustrator que separa bien no usa Form XObjects: todos sus
# objetos estan DIRECTOS en el content stream de la pagina, cada uno con su `cs 1 scn`. Aca se hace
# igual: el contenido de los spots (y el troquel) se emite inline, una vez por copia. El arte del
# cliente (CMYK) sigue como XObject: es proceso, no tinta plana, y repetirlo multiplicaria el archivo.
# Tope de seguridad: si el contenido aplanado se dispara (texturas muy densas x muchas copias), se
# vuelve a XObjects y se avisa — mejor un archivo que abre que uno de cientos de MB.
APLANAR_MAX_BYTES = 60 * 1024 * 1024

# RASTERIZAR las capas de relieve (job "spots_raster"): cada capa entra como UNA imagen en escala de
# grises con su tinta plana, en vez de decenas de miles de trazados con recortes anidados. Es la
# receta de dtf_blanco.py (`incrustar_spot`), que PhotoPrint ya separa bien en produccion. Motivo
# (07/09): con las capas vectoriales, PhotoPrint mostraba las zonas LISAS pero no las TEXTURADAS —
# lo que las distingue son los clips anidados que meten la trama dentro de la forma.
SPOTS_RASTER_DPI = 600

# Guardar las imagenes de relieve a 1 BIT por pixel en vez de 8. La mascara es binaria (tinta o
# nada), asi que no se pierde absolutamente nada y el archivo baja mucho: a 600 dpi cada capa son
# 72,8 millones de pixeles, 69 MB en crudo a 8 bits contra 8,7 MB a 1 bit. Sigue en False mientras
# se valida el relieve en maquina (09/09): un cambio por vez.
SPOTS_1BIT = False

# GROSOR MINIMO del relieve, en mm: la mascara se DILATA hasta este minimo. En 0 = apagado.
#
# APAGADO el 09/09 tras verificarlo en material. Se habia puesto en 0,5 creyendo que las tramas del
# catalogo (0,08 mm de trazo al tamanio del parche) eran demasiado finas para imprimir. Eran dos
# errores encadenados:
#   - La prueba que parecia demostrarlo se hizo en una impresora de UN SOLO cabezal de blanco, que
#     solo imprime el canal asignado a ese cabezal: las zonas de relieve normal (solo Spot 1)
#     desaparecian y quedaban las de relieve doble. No era el tamanio de la trama.
#   - Y el engorde no salvaba nada: en una trama densa dilatar cada trazo fusiona los vecinos, asi
#     que en vez de engordar el dibujo lo rellena y la "textura" pasa a ser los huecos que
#     sobrevivieron. Salia un manchon (comparado en pantalla y en material el 09/09).
# Verificado imprimiendo: una trama de 0,08 mm de trazo sale bien — no como trazos separados sino
# fusionada por la tinta en una textura tipo cuero. No hace falta grosor minimo.
RELIEVE_MIN_MM = 0.0


def cargar_textura(pdf, ruta_svg, sep, cs_name="CSspot", invertir=None):
    """SVG del catalogo -> Form XObject vectorial pintado con la tinta plana `sep` al 100 %.

    Se lee con svg_trazos (clases CSS, <pattern>, transform) y NO con fitz.convert_to_pdf: fitz
    pintaba las texturas con patron de Illustrator como un rectangulo negro solido (TPU-20747).
    Polaridad como el visor 3D: lo que sube es el DIBUJO; si la tinta cubre mas de la mitad del
    tile, sube el complemento (rectangulo del tile menos el dibujo, par-impar).
    Devuelve (xobject, ancho_pt, alto_pt, info)."""
    import pikepdf
    from pikepdf import Dictionary, Name
    ext = os.path.splitext(ruta_svg)[1].lower()
    if ext != ".svg":
        raise ValueError(f"La textura {os.path.basename(ruta_svg)} no es SVG: solo las texturas vectoriales sirven para el relieve.")
    svg = svg_trazos.leer_svg(ruta_svg)
    if not svg["figuras"]:
        raise ValueError(f"La textura {os.path.basename(ruta_svg)} no tiene trazados con tinta.")
    tw, th = svg["ancho"], svg["alto"]

    # cobertura de tinta: se rasteriza el tile tal cual (sin invertir) a ~256 px
    cont_directo = svg_trazos.contenido_tile(svg, invertir=False)
    tmp = pikepdf.new()
    pg = tmp.add_blank_page(page_size=(tw, th))
    pg.Contents = tmp.make_stream(("0 g\n" + cont_directo).encode("latin-1"))
    buf = io.BytesIO()
    tmp.save(buf)
    tmp.close()
    dtmp = fitz.open("pdf", buf.getvalue())
    zoom = 512.0 / max(tw, 1)
    pix = dtmp[0].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True)
    alfa = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 4)[:, :, 3]
    # umbral al 50 % de alfa: con "alfa > 0" las rayas finas antialiasadas contaban como tinta en
    # todo el tile (Recurso 8 daba 100 % y se invertia a vacio)
    cobertura = float((alfa >= 128).mean())
    dtmp.close()
    # Si el visor 3D ya decidio la polaridad (lo que el cliente VIO), manda esa; el calculo propio
    # es el fallback (texturas cerca del 50 % podrian caer distinto en cada lado).
    if invertir is None:
        invertir = cobertura > POLARIDAD_INVERTIR
    else:
        invertir = bool(invertir)

    contenido = svg_trazos.contenido_tile(svg, invertir=invertir)
    recursos = Dictionary()
    recursos[Name.ColorSpace] = Dictionary({"/" + cs_name: sep})
    xo = _form_xobject(pdf, f"/{cs_name} cs 1 scn\n" + contenido, (0, 0, tw, th), recursos)
    info = {"cobertura": round(cobertura, 3), "invertida": invertir, "figuras": len(svg["figuras"]),
            "avisos": svg["avisos"], "contenido": contenido}
    return xo, tw, th, info


def _capa_raster(pdf, xo_unitario, Wp, Hp, imp, copias, sep, dpi=SPOTS_RASTER_DPI, min_mm=RELIEVE_MIN_MM,
                 un_bit=SPOTS_1BIT):
    """Renderiza una capa (el XObject unitario repetido en las copias) y la devuelve como imagen
    con la tinta plana `sep`: 0 = sin tinta, 255 = tinta al 100 %. Igual que dtf_blanco.
    `un_bit`: guardar la mascara a 1 bit por pixel en vez de 8 (ver SPOTS_1BIT)."""
    import pikepdf
    from pikepdf import Array, Dictionary, Name

    # 1) PDF temporal con la capa sola, en negro sobre blanco, del tamanio de la plancha
    tmp = pikepdf.new()
    pg = tmp.add_blank_page(page_size=(imp.W, imp.H))
    xo = tmp.copy_foreign(xo_unitario)
    # NO se toca el ColorSpace: la Separation tiene alternate NEGRO (K100), asi que el render sale
    # negro sobre blanco. Cambiarlo por DeviceGray convertia el "1 scn" (tinta al 100 %) en "gris 1"
    # = BLANCO y la capa salia vacia — asi quedo Spot 3 en la prueba del 07/09.
    # SIN fondo: la mascara sale del canal ALFA (donde la capa pinto algo), no del brillo. Con el
    # brillo, un alternativo claro (Spot 1 cian, Spot 2 amarillo) no pasaba el umbral y la capa
    # salia VACIA — asi quedo la prueba 9 del 08/09.
    cont = []
    for (cx, cy) in copias:
        cont.append(f"q 1 0 0 1 {_f(cx)} {_f(cy)} cm /X Do Q")
    pg.Resources = Dictionary({"/XObject": Dictionary({"/X": xo})})
    pg.Contents = tmp.make_stream(chr(10).join(cont).encode("latin-1"))
    buf = io.BytesIO()
    tmp.save(buf)
    tmp.close()

    # 2) rasterizar en gris
    doc = fitz.open("pdf", buf.getvalue())
    pix = doc[0].get_pixmap(dpi=dpi, colorspace=fitz.csGRAY, alpha=True)
    buf = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 2)
    alfa = buf[:, :, 1]
    doc.close()
    # BINARIO: el relieve es tinta o nada (como el vector del script de Illustrator). Sin el umbral,
    # el antialias del render deja medias tintas y la capa nunca llega al 100 % (max 223/255 medido
    # el 07/09). Umbral al 50 % del gris.
    tinta = np.where(alfa >= 128, np.uint8(255), np.uint8(0))

    # Engordar los trazos finos hasta RELIEVE_MIN_MM: dilatacion por distancia (cada pixel a menos
    # de medio ancho minimo de un trazo pasa a tinta). Sin esto la trama existe en el archivo pero
    # es demasiado fina para el blanco y el parche sale liso.
    if min_mm and min_mm > 0:
        from scipy import ndimage
        px_mm = dpi / 25.4
        radio = max(0.0, (min_mm * px_mm - 1.0) / 2.0)
        if radio >= 0.5 and tinta.any():
            dist = ndimage.distance_transform_edt(tinta == 0)
            tinta = np.where(dist <= radio, np.uint8(255), np.uint8(0))

    # 3) imagen con la Separation como colorspace (receta de dtf_blanco.incrustar_spot)
    # La mascara es BINARIA (tinta o nada), asi que a 1 bit por pixel entra igual y ocupa 8 veces
    # menos antes de comprimir. np.packbits empaqueta por filas y ya las alinea a byte, que es lo
    # que pide el formato de imagen del PDF. Con 1 bit los valores son 0 y 1, y el /Decode por
    # defecto de una Separation ([0 1]) los lee como 0 % y 100 % de tinta: mismo resultado exacto.
    if un_bit:
        datos = np.packbits(tinta > 0, axis=-1).tobytes()
        bpc = 1
    else:
        datos = tinta.tobytes()
        bpc = 8
    img = pdf.make_stream(zlib.compress(datos, 6))
    img[Name.Type] = Name.XObject
    img[Name.Subtype] = Name.Image
    img[Name.Width] = int(pix.width)
    img[Name.Height] = int(pix.height)
    img[Name.BitsPerComponent] = bpc
    img[Name.ColorSpace] = sep
    img[Name.Filter] = Name.FlateDecode
    return pdf.make_indirect(img), int(pix.width), int(pix.height)


def _capa_trazada(pdf, xo_unitario, Wp, Hp, imp, copias, cs_name, dpi=SPOTS_RASTER_DPI,
                  min_mm=RELIEVE_MIN_MM):
    """La capa de relieve como TRAZADOS ya recortados: se rasteriza la capa entera de la plancha
    (con el engorde), se sacan los contornos y se emiten como paths rellenos con la tinta. Sin
    clips anidados (el sospechoso de que PhotoPrint solo dibuje el contorno) y sin imagenes
    (que el RIP mostraba solo como borde). Es la forma mas parecida al arte de Illustrator."""
    from skimage.measure import find_contours, approximate_polygon

    # 1) mascara binaria de la capa, ya engordada (misma cocina que _capa_raster)
    tinta, w, h = _mascara_capa(pdf, xo_unitario, imp, copias, dpi, min_mm)
    if not tinta.any():
        return None
    # 2) contornos (con agujeros) -> paths; even-odd resuelve los huecos
    from scipy import ndimage
    esc = (imp.W / w)                       # px de la mascara -> pt de la pagina
    tol_px = max(0.5, (TOL_SIMPLIFICACION_MM / 25.4) * dpi)
    partes = [f"/{cs_name} cs 1 scn /GSop gs"]
    n = 0
    # UN RELLENO POR FIGURA, como Illustrator (440 `f` en el archivo que imprime bien). Un unico
    # path compuesto con 16.000 subtrazados y regla par-impar era lo que el RIP reducia al contorno
    # (comparado el 08/09). Cada componente lleva su contorno exterior y sus agujeros en un `f*`.
    etiquetas, ncomp = ndimage.label(tinta > 0, structure=np.ones((3, 3), dtype=int))
    for idx, corte in enumerate(ndimage.find_objects(etiquetas), start=1):
        if corte is None:
            continue
        y0, x0 = corte[0].start, corte[1].start
        sub = (etiquetas[corte] == idx)
        sub_pad = np.pad(sub.astype(np.float32), 1)
        anillos = []
        for c in find_contours(sub_pad, 0.5):
            c = approximate_polygon(c - 1.0, tolerance=tol_px)
            if len(c) < 3:
                continue
            pts = [((x + x0) * esc, imp.H - (y + y0) * esc) for y, x in c]
            anillos.append(f"{_f(pts[0][0])} {_f(pts[0][1])} m " +
                           " ".join(f"{_f(x)} {_f(y)} l" for x, y in pts[1:]) + " h")
        if not anillos:
            continue
        partes.append(chr(10).join(anillos))
        partes.append("f*")                 # exterior + agujeros de ESTA figura
        n += 1
    if not n:
        return None
    return chr(10).join(partes), n


def _mascara_capa(pdf, xo_unitario, imp, copias, dpi, min_mm):
    """Mascara binaria (0/255) de una capa sobre la plancha entera, con el engorde aplicado."""
    import pikepdf
    from pikepdf import Dictionary, Name
    tmp = pikepdf.new()
    pg = tmp.add_blank_page(page_size=(imp.W, imp.H))
    xo = tmp.copy_foreign(xo_unitario)
    cont = []
    for (cx, cy) in copias:
        cont.append(f"q 1 0 0 1 {_f(cx)} {_f(cy)} cm /X Do Q")
    pg.Resources = Dictionary({"/XObject": Dictionary({"/X": xo})})
    pg.Contents = tmp.make_stream(chr(10).join(cont).encode("latin-1"))
    buf = io.BytesIO()
    tmp.save(buf)
    tmp.close()
    doc = fitz.open("pdf", buf.getvalue())
    pix = doc[0].get_pixmap(dpi=dpi, colorspace=fitz.csGRAY, alpha=True)
    alfa = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 2)[:, :, 1]
    doc.close()
    tinta = np.where(alfa >= 128, np.uint8(255), np.uint8(0))
    if min_mm and min_mm > 0:
        from scipy import ndimage
        radio = max(0.0, (min_mm * (dpi / 25.4) - 1.0) / 2.0)
        if radio >= 0.5 and tinta.any():
            dist = ndimage.distance_transform_edt(tinta == 0)
            tinta = np.where(dist <= radio, np.uint8(255), np.uint8(0))
    return tinta, pix.width, pix.height


def _circulo(cx, cy, r):
    k = 0.5522847498 * r
    return (f"{_f(cx + r)} {_f(cy)} m "
            f"{_f(cx + r)} {_f(cy + k)} {_f(cx + k)} {_f(cy + r)} {_f(cx)} {_f(cy + r)} c "
            f"{_f(cx - k)} {_f(cy + r)} {_f(cx - r)} {_f(cy + k)} {_f(cx - r)} {_f(cy)} c "
            f"{_f(cx - r)} {_f(cy - k)} {_f(cx - k)} {_f(cy - r)} {_f(cx)} {_f(cy - r)} c "
            f"{_f(cx + k)} {_f(cy - r)} {_f(cx + r)} {_f(cy - k)} {_f(cx + r)} {_f(cy)} c h")


def _contorno_a_path(contorno, H_px, ppmm):
    """Contorno (row, col) del raster -> operadores PDF en pt de parche (y hacia arriba)."""
    pts = [((c / ppmm) * PT_POR_MM, ((H_px - r) / ppmm) * PT_POR_MM) for r, c in contorno]
    return (f"{_f(pts[0][0])} {_f(pts[0][1])} m " +
            " ".join(f"{_f(x)} {_f(y)} l" for x, y in pts[1:]) + " h")


class Imposicion:
    """UNA plancha: ancho fijo, alto = lo que pidan las filas hasta max_alto_mm.

    Filas completas siempre (decision 04/09): copias = columnas x filas >= cantidad, y sobran
    hasta columnas-1. Si ni la plancha mas alta alcanza la cantidad, `suficiente` es False y
    `sufijo` = "-<N>copias" para el nombre de los archivos, donde N es la cantidad de VECES que
    hay que imprimir la plancha (copias de plancha, no parches por plancha — aclaracion del
    usuario 04/09 tras el caso TPU-20744: 15 pedidos, 12 por plancha → "-2copias")."""

    def __init__(self, Wp, Hp, cfg):
        self.Wp, self.Hp = Wp, Hp
        self.cantidad = max(1, int(cfg.get("cantidad") or 1))
        self.W = float(cfg.get("plancha_mm") or PLANCHA_DEFAULT_MM) * PT_POR_MM
        # sep_mm / sep_filas_mm se miden entre CORTES: se les descuenta el sangrado de los dos
        # parches vecinos para obtener la separacion entre sus cajas (que incluyen el sangrado).
        sangrado = float(cfg.get("sangrado_mm") or 0.0)
        sep_cortes = float(cfg.get("sep_mm") if cfg.get("sep_mm") is not None else SEP_CORTES_DEFAULT_MM)
        sepf_cortes = float(cfg.get("sep_filas_mm") if cfg.get("sep_filas_mm") is not None else SEP_FILAS_DEFAULT_MM)
        self.sep = max(0.0, sep_cortes - 2 * sangrado) * PT_POR_MM
        self.sepF = max(0.0, sepf_cortes - 2 * sangrado) * PT_POR_MM
        self.sep_cortes_mm = sep_cortes
        self.sepf_cortes_mm = sepf_cortes
        self.max_alto = float(cfg.get("max_alto_mm") or MAX_ALTO_DEFAULT_MM) * PT_POR_MM
        self.completar = bool(cfg.get("completar_filas", True))
        max_filas_cfg = int(cfg.get("max_filas") or 0)          # tope opcional extra (0 = sin tope)
        if Wp > self.W + 0.01:
            raise ValueError(f"El parche ({Wp / PT_POR_MM:.1f} mm) es mas ancho que la plancha ({self.W / PT_POR_MM:.0f} mm).")
        paso = Wp + self.sep
        self.columnas = max(1, 1 + int(math.floor((self.W - Wp + 0.5) / paso))) if paso > 0 else 1
        self.pasoX = paso
        self.pasoY = Hp + self.sepF
        self.radio = DIAMETRO_REGISTRO_MM * PT_POR_MM / 2
        self.margen = MARGEN_EXTRA_MM * PT_POR_MM
        fijo = 2 * self.margen + 2 * self.radio                  # 15 mm: registros + mesa
        filas_max = int(math.floor((self.max_alto - fijo + 0.01) / self.pasoY))
        if filas_max < 1:
            raise ValueError(f"El parche ({Hp / PT_POR_MM:.1f} mm de alto) no entra en una plancha de {self.max_alto / PT_POR_MM:.0f} mm.")
        if max_filas_cfg > 0:
            filas_max = min(filas_max, max_filas_cfg)
        filas_necesarias = int(math.ceil(self.cantidad / self.columnas))
        self.filas = min(filas_necesarias, filas_max)
        capacidad = self.filas * self.columnas
        self.copias_total = capacidad if self.completar else min(self.cantidad, capacidad)
        self.suficiente = self.copias_total >= self.cantidad
        self.impresiones = int(math.ceil(self.cantidad / self.copias_total))
        self.sufijo = "" if self.suficiente else f"-{self.impresiones}copias"
        self.paginas = 1
        ocupado = Wp + self.pasoX * (self.columnas - 1)
        self.x0 = (self.W - ocupado) / 2
        self.H = fijo + self.filas * self.pasoY

    def pagina(self, i=0):
        """Alto de mesa y posiciones (x, y) del origen de cada copia + y de cada par de registros."""
        H = self.H
        y_reg_sup = H - self.margen - self.radio           # centro de la marca superior
        primera_top = y_reg_sup - self.sepF / 2
        copias = []
        restantes = self.copias_total
        for f in range(self.filas):
            en_fila = min(self.columnas, restantes)
            restantes -= en_fila
            top = primera_top - f * self.pasoY
            for c in range(en_fila):
                copias.append((self.x0 + c * self.pasoX, top - self.Hp))
        registros = [y_reg_sup - k * self.pasoY for k in range(self.filas + 1)]
        return self.filas, H, copias, registros

    def resumen(self):
        return {
            "ancho_mm": round(self.W / PT_POR_MM, 1),
            "alto_mm": round(self.H / PT_POR_MM, 1),
            "alto_max_mm": round(self.max_alto / PT_POR_MM, 1),
            "copias_por_fila": self.columnas,
            "filas": self.filas,
            "copias_total": self.copias_total,
            "cantidad_pedida": self.cantidad,
            "suficiente": self.suficiente,
            "impresiones_necesarias": self.impresiones,
            "sufijo": self.sufijo,
            "sep_entre_cortes_mm": self.sep_cortes_mm,
            "sep_filas_entre_cortes_mm": self.sepf_cortes_mm,
            "sep_cajas_mm": round(self.sep / PT_POR_MM, 1),
            "sep_filas_cajas_mm": round(self.sepF / PT_POR_MM, 1),
        }


def generar(job, preview=None):
    import pikepdf
    from pikepdf import Array, Dictionary, Name

    avisos = []
    ruta_pdf = job["pdf"]
    salida_dir = job["salida_dir"]
    base = job.get("base") or "tpu"
    os.makedirs(salida_dir, exist_ok=True)
    sangrado_mm = float(job.get("sangrado_mm", 1.0))
    sangrado_pt = sangrado_mm * PT_POR_MM
    texturas_dir = job.get("texturas_dir")

    doc, page, formas, av, motivo = leer_vector(ruta_pdf)
    avisos.extend(av)
    if motivo:
        raise ValueError(motivo)
    utiles = [f for f in formas if not f.es_fondo]

    # bbox del arte (coordenadas fitz)
    x0 = min(f.rect.x0 for f in utiles)
    y0 = min(f.rect.y0 for f in utiles)
    x1 = max(f.rect.x1 for f in utiles)
    y1 = max(f.rect.y1 for f in utiles)
    bw, bh = x1 - x0, y1 - y0
    if bw <= 0 or bh <= 0:
        raise ValueError("El arte no tiene dimensiones validas.")

    # escala a la medida pedida (fit, conserva proporcion)
    escala = 1.0
    med = job.get("medida_mm") or {}
    if med.get("ancho") or med.get("alto"):
        fx = (float(med["ancho"]) * PT_POR_MM / bw) if med.get("ancho") else None
        fy = (float(med["alto"]) * PT_POR_MM / bh) if med.get("alto") else None
        escala = min(v for v in (fx, fy) if v)
        if fx and fy and abs(fx - fy) / max(fx, fy) > 0.02:
            avisos.append(f"La proporcion del arte no coincide con la medida pedida: se escalo para entrar "
                          f"({bw * escala / PT_POR_MM:.1f} x {bh * escala / PT_POR_MM:.1f} mm).")

    Wp = bw * escala + 2 * sangrado_pt
    Hp = bh * escala + 2 * sangrado_pt

    def T(x, y):
        """fitz -> coordenadas de parche (pt, origen abajo-izquierda, y hacia arriba)."""
        return (x - x0) * escala + sangrado_pt, (y1 - y) * escala + sangrado_pt

    # ── raster: islas, corte, sangrado
    ppmm = DPI_RASTER / 25.4
    px_est = (Wp / PT_POR_MM * ppmm) * (Hp / PT_POR_MM * ppmm)
    if px_est > MAX_PIXELES_RASTER:
        ppmm *= math.sqrt(MAX_PIXELES_RASTER / px_est)
    mask, owner, W_px, H_px, _, _ = rasterizar(utiles, (x0, y0, x1, y1), escala, sangrado_pt, ppmm)
    if not mask.any():
        raise ValueError("No se pudo rasterizar la silueta del arte.")
    lista_islas, descartadas = islas(mask, owner, utiles, ppmm, sangrado_mm,
                                     pieza_unica=bool(job.get("pieza_unica", PIEZA_UNICA)))
    if not lista_islas:
        raise ValueError("No se encontro ninguna isla de corte en el arte.")
    if descartadas:
        avisos.append(f"Se ignoraron {descartadas} pieza(s) menores a {ISLA_MINIMA_MM2:g} mm2 (basura del vector).")
    if len(lista_islas) > 1:
        avisos.append(f"El arte tiene {len(lista_islas)} piezas separadas y muy lejos entre si: cada una lleva su propio corte.")
    # La imposicion se resuelve ANTES de armar los PDFs: los nombres de salida dependen de si la
    # plancha alcanza la cantidad pedida (sufijo -Ncopias).
    imp = Imposicion(Wp, Hp, dict(job.get("imposicion") or {}, sangrado_mm=sangrado_mm))
    if not imp.suficiente:
        avisos.append(f"La plancha de {imp.W / PT_POR_MM:.0f} x {imp.H / PT_POR_MM:.0f} mm trae {imp.copias_total} parches y el pedido es de "
                      f"{imp.cantidad}: hay que imprimirla {imp.impresiones} veces ({imp.copias_total * imp.impresiones} parches, "
                      f"sobran {imp.copias_total * imp.impresiones - imp.cantidad}); los archivos llevan '{imp.sufijo}'.")

    # el arte, ¿en CMYK? (para pintar el sangrado en el mismo espacio)
    src_pdf = pikepdf.open(ruta_pdf)
    contenido_src = b""
    try:
        contenido_src = pikepdf.Page(src_pdf.pages[0]).contents_coalesce() or b""
    except Exception:
        try:
            contenido_src = src_pdf.pages[0].Contents.read_bytes()
        except Exception:
            pass
    import re as _re
    usa_cmyk = bool(_re.search(rb"(^|\s)(k|K)(\s|$)", contenido_src)) and not _re.search(rb"(^|\s)(rg|RG)(\s|$)", contenido_src)

    # ── PDF de impresion
    pdf = pikepdf.new()
    seps = {n: _separation(pdf, n) for _, n in CAPAS if n}
    seps[CAPA_CORTE[1]] = _separation(pdf, CAPA_CORTE[1])
    gs_ai = _extgstate_illustrator(pdf)
    gs_op = _extgstate_overprint(pdf)
    arte_xo = pdf.copy_foreign(pikepdf.Page(src_pdf.pages[0]).as_form_xobject())
    # El arte va ENCIMA de las capas de relieve: si conserva el knockout que le puso Illustrator,
    # borra las tintas planas que tiene debajo (ver _forzar_sobreimpresion y el comentario del
    # orden de dibujo, mas abajo).
    n_gs = _forzar_sobreimpresion(arte_xo)
    if not n_gs:
        avisos.append("El PDF del cliente no declara ningun estado grafico propio: no se pudo forzar "
                      "la sobreimpresion del arte. Si el relieve sale solo como contorno, es por esto.")

    # matriz para colocar el arte original dentro del parche: pdf(user) -> parche
    M = ~page.transformation_matrix           # fitz -> pdf del cliente
    # punto (x,y) fitz -> pdf: p * M ; luego a parche: T. Buscamos A tal que parche = A(pdf).
    # A = inversa(M) compuesta con T: fitz_from_pdf = pdf * ~M... derivamos por 3 puntos.
    def _pdf_de_fitz(x, y):
        p = fitz.Point(x, y) * M
        return p.x, p.y

    P0f, P1f, P2f = (x0, y0), (x1, y0), (x0, y1)
    P0p, P1p, P2p = (_pdf_de_fitz(*P0f), _pdf_de_fitz(*P1f), _pdf_de_fitz(*P2f))
    Q0, Q1, Q2 = (T(*P0f), T(*P1f), T(*P2f))
    # resolver afin: [a b c d e f] con (X,Y) = (a x + c y + e, b x + d y + f) sobre pdf -> parche
    Ap = np.array([[P0p[0], P0p[1], 1], [P1p[0], P1p[1], 1], [P2p[0], P2p[1], 1]], dtype=float)
    solX = np.linalg.solve(Ap, np.array([Q0[0], Q1[0], Q2[0]]))
    solY = np.linalg.solve(Ap, np.array([Q0[1], Q1[1], Q2[1]]))
    cm_arte = f"{_f(solX[0])} {_f(solY[0])} {_f(solX[1])} {_f(solY[1])} {_f(solX[2])} {_f(solY[2])} cm"

    # -- capa CMYK unitaria: sangrado (anillos) + arte
    ops = []
    for isla in lista_islas:
        col = isla["color"] or (0.0, 0.0, 0.0)
        if usa_cmyk:
            c, m, y, k = _rgb_a_cmyk(col)
            ops.append(f"{_f(c)} {_f(m)} {_f(y)} {_f(k)} k")
        else:
            ops.append(f"{_f(col[0])} {_f(col[1])} {_f(col[2])} rg")
        for cont in isla["sangrado"]:
            ops.append(_contorno_a_path(cont, H_px, ppmm))
        ops.append("f*")
    # El arte va RECORTADO al contorno del sangrado: la hoja del cliente puede traer fondo (blanco o
    # de color) que llega al borde y quedaria impreso fuera del parche (escudo de la AUF, 07/09).
    ops.append("q")
    for isla in lista_islas:
        for cont in isla["sangrado"]:
            ops.append(_contorno_a_path(cont, H_px, ppmm))
    ops.append("W* n")
    ops.append(f"q {cm_arte} /XArte Do Q")
    ops.append("Q")
    res_cmyk = Dictionary()
    res_cmyk[Name.XObject] = Dictionary({"/XArte": arte_xo})
    x_cmyk = _form_xobject(pdf, "\n".join(ops), (0, 0, Wp, Hp), res_cmyk)

    # -- zonas -> Spot 1 / 2 / 3
    por_seqno = {f.seqno: f for f in utiles}
    texturas_cache = {}
    manifest = {}
    if texturas_dir and os.path.isfile(os.path.join(texturas_dir, "texturas.json")):
        try:
            manifest = _leer_json(os.path.join(texturas_dir, "texturas.json"))
        except Exception:
            avisos.append("texturas.json ilegible: se usan los defaults de repeticion.")

    def xobj_textura(nombre, tinta, invertida=None):
        # Un XObject por textura Y por tinta: el Form XObject trae sus propios recursos y esos
        # mandan sobre los del padre, asi que la misma textura repintada con "Spot 1" pintaba en
        # Spot 1 aunque se dibujara en la capa Spot 2 (lo delato el PDF de control, 07/09).
        # `invertida`: polaridad decidida por el visor (None = calcularla aca).
        clave = (nombre, tinta, invertida)
        if clave in texturas_cache:
            return texturas_cache[clave]
        if not texturas_dir:
            raise ValueError("Falta texturas_dir en el job.")
        ruta = os.path.join(texturas_dir, nombre)
        if not os.path.isfile(ruta):
            raise ValueError(f"No existe la textura {nombre}.")
        xo, tw, th, info = cargar_textura(pdf, ruta, seps[tinta], invertir=invertida)
        texto_tile = info["contenido"]
        if info["invertida"]:
            avisos.append(f"Textura {nombre}: el dibujo cubre el {int(info['cobertura'] * 100)} % del tile, se imprime invertida (sube el fondo), como en el visor.")
        for a in info["avisos"]:
            avisos.append(f"Textura {nombre}: {a}.")
        texturas_cache[clave] = (xo, tw, th, texto_tile)
        return texturas_cache[clave]

    # Zonas EXCLUYENTES, como en el visor 3D ("cada pixel pertenece a la forma MAS ALTA que lo
    # cubre"): una forma de zona se recorta con las formas que estan ENCIMA de ella (seqno mayor =
    # pintadas despues) y que no son de su misma zona — sean de otra zona o hayan quedado planas.
    # Sin esto, un fondo marcado liso tapaba en Spot 1 a las estrellas texturadas que lleva encima
    # (caso TPU-20745, 04/09). En PDF no hay resta de clips: se usa clip nonzero de la forma +
    # clip even-odd del compuesto {forma, tapas} = forma menos tapas.
    pertenece = {}
    for zi, z in enumerate(job.get("zonas") or []):
        for sq in z.get("seqnos", []):
            pertenece[sq] = zi
    formas_con_relleno = [f for f in utiles if f.fill is not None]

    def tapan_a(forma, zona_idx):
        return [g for g in formas_con_relleno
                if g.seqno > forma.seqno and pertenece.get(g.seqno) != zona_idx
                and forma.rect is not None and g.rect is not None and forma.rect.intersects(g.rect)]

    def contenido_zonas(zonas, tinta, con_textura=True):
        """Content stream unitario de una capa spot: zonas lisas + texturas recortadas."""
        if not zonas:
            return None
        recursos = Dictionary()
        recursos[Name.ColorSpace] = Dictionary({"/CSspot": seps[tinta]})
        recursos[Name.ExtGState] = Dictionary({"/GS0": gs_ai, "/GSop": gs_op})
        xobjs = Dictionary()
        # Sin ExtGState de sobreimpresion: el archivo de referencia (Illustrator) va en knockout
        # (/OP false) y asi imprime bien; los visores ademas muestran las zonas como areas de color.
        # `partes` arma el contenido con los tiles como XObject (para el PDF de control) y `planas`
        # el mismo contenido con los tiles INLINE (para la pagina del PDF del RIP, ver APLANAR_*).
        # /GSop = sobreimpresion ENCENDIDA. Las tres tintas de relieve conviven en el mismo lugar
        # (Spot 2 es la misma geometria que Spot 1; el CMYK va encima de todo): con knockout cada
        # capa borraba a la anterior en su area y del relieve sobrevivia casi nada (07/09).
        partes = ["/CSspot cs 1 scn /GSop gs"]
        planas = ["/CSspot cs 1 scn /GSop gs"]
        n_tex = 0
        for z in zonas:
            formas_z = [por_seqno[s] for s in z["seqnos"] if s in por_seqno]
            if not formas_z:
                continue
            zona_idx = pertenece.get(formas_z[0].seqno)
            tex = z.get("textura") if con_textura else None

            def emitir(txt):
                partes.append(txt)
                planas.append(txt)

            def recortar(f):
                """Emite los clips de la forma (menos lo que la tapa). Va dentro de un q ... Q."""
                emitir(path_pdf(f, T))
                emitir("W* n" if f.even_odd else "W n")
                tapas = tapan_a(f, zona_idx)
                if tapas:
                    emitir(path_pdf(f, T))
                    for g in tapas:
                        emitir(path_pdf(g, T))
                    emitir("W* n")

            if not tex:
                for f in formas_z:
                    emitir("q")
                    recortar(f)
                    emitir(path_pdf(f, T))
                    emitir("f*" if f.even_odd else "f")
                    emitir("Q")
                continue
            xo, tw, th, texto_tile = xobj_textura(tex, tinta, z.get("invertida"))
            nombre_xo = f"/XT{len(xobjs)}"
            xobjs[Name(nombre_xo)] = xo
            rep = float(z.get("repeticiones") or manifest.get(tex, {}).get("repeticiones") or REPETICIONES_DEFAULT)
            esc = float(z.get("escala") or 1.0)
            tile_w = (Wp - 2 * sangrado_pt) / max(rep, 0.01) * esc
            s = tile_w / tw
            tile_h = th * s
            dx = (float(z.get("dx") or 0.0) % 1.0) * tile_w
            dy = (float(z.get("dy") or 0.0) % 1.0) * tile_h
            # grilla anclada al parche (misma para todas las zonas), corrida dx/dy
            for f in formas_z:
                r = f.rect
                (zx0, zy1), (zx1, zy0) = T(r.x0, r.y0), T(r.x1, r.y1)
                zx0, zx1 = min(zx0, zx1), max(zx0, zx1)
                zy0, zy1 = min(zy0, zy1), max(zy0, zy1)
                emitir("q")
                recortar(f)
                # tiles que tocan el bbox de la forma (floor/ceil ya cubren los bordes)
                i0 = int(math.floor((zx0 - sangrado_pt - dx) / tile_w))
                i1 = int(math.ceil((zx1 - sangrado_pt - dx) / tile_w))
                j0 = int(math.floor((zy0 - sangrado_pt - dy) / tile_h))
                j1 = int(math.ceil((zy1 - sangrado_pt - dy) / tile_h))
                for j in range(j0, j1):
                    for i in range(i0, i1):
                        tx = sangrado_pt + dx + i * tile_w
                        ty = sangrado_pt + dy + j * tile_h
                        cm_tile = f"{_f(s)} 0 0 {_f(s)} {_f(tx)} {_f(ty)} cm"
                        partes.append(f"q {cm_tile} {nombre_xo} Do Q")
                        planas.append(f"q {cm_tile} {texto_tile} Q")
                        n_tex += 1
                emitir("Q")
        if len(xobjs.keys()):
            recursos[Name.XObject] = xobjs
        return _form_xobject(pdf, "\n".join(partes), (0, 0, Wp, Hp), recursos), "\n".join(planas), n_tex

    zonas = job.get("zonas") or []
    for z in zonas:
        faltan = [s for s in z.get("seqnos", []) if s not in por_seqno]
        if faltan:
            raise ValueError(f"La zona '{z.get('nombre') or z.get('indice')}' referencia trazados inexistentes: {faltan[:5]}")
    asignados = set(s for z in zonas for s in z.get("seqnos", []))
    sin_zona = [f.seqno for f in utiles if f.fill is not None and f.seqno not in asignados]
    if sin_zona:
        avisos.append(f"{len(sin_zona)} trazado(s) del arte quedan sin relieve (no pertenecen a ninguna zona).")

    r1 = contenido_zonas(zonas, "Spot 1")
    # Un solo cabezal blanco en la maquina (verificado 09/09, prueba 16): Spot_1 no imprime, solo
    # Spot_2, asi que todo lo marcado "relieve normal" salia vacio. Mientras el service mande
    # `relieve_doble_siempre`, Spot 2 lleva TODAS las zonas (= Spot 1) y el archivo sale igual en la
    # maquina de uno y en la de dos cabezales. La eleccion del cliente se conserva en `doble`.
    doble_siempre = bool(job.get("relieve_doble_siempre", False))
    r2 = contenido_zonas(zonas if doble_siempre else [z for z in zonas if z.get("doble")], "Spot 2")
    if doble_siempre and zonas:
        avisos.append("Relieve doble en todas las zonas (forzado: la impresora tiene un solo cabezal blanco).")
    r3 = contenido_zonas([z for z in zonas if z.get("barniz")], "Spot 3", con_textura=False)
    x_spot1, plano1, tiles1 = r1 if r1 else (None, None, 0)
    x_spot2, plano2, _ = r2 if r2 else (None, None, 0)
    x_spot3, plano3, _ = r3 if r3 else (None, None, 0)
    if x_spot1 is None:
        avisos.append("Ninguna zona con relieve: el parche saldria sin Spot 1 (impresion plana).")

    # -- corte unitario: la silueta RELLENA con CutContour, como en el archivo de referencia (el
    # troquel de Illustrator son formas rellenas; la cortadora sigue el contorno del objeto).
    ops_c = ["/CScut cs 1 scn /GS0 gs"]
    for isla in lista_islas:
        ops_c.append(_contorno_a_path(isla["corte"], H_px, ppmm))
        ops_c.append("f")
    res_c = Dictionary()
    res_c[Name.ColorSpace] = Dictionary({"/CScut": seps["CutContour"]})
    res_c[Name.ExtGState] = Dictionary({"/GS0": gs_ai})
    plano_corte = "\n".join(ops_c)
    x_corte = _form_xobject(pdf, plano_corte, (0, 0, Wp, Hp), res_c)

    # -- PDF de CONTROL: el parche unitario con UNA pagina por capa (CMYK, Spot 1, Spot 2, Spot 3,
    # Corte) y una ultima con todo junto, cada una rotulada y con la silueta de corte en gris como
    # referencia. Sirve para comprobar que cada capa lleva lo que tiene que llevar (pedido del
    # usuario 07/09, "temporal"). La vista PNG se compone rasterizando sus primeras paginas.
    ruta_capas = None
    if job.get("capas", True) or job.get("vista", True):
        BANDA = CAPAS_BANDA_MM * PT_POR_MM
        pdf_cap = pikepdf.new()
        font_c = pdf_cap.make_indirect(Dictionary({"/Type": Name.Font, "/Subtype": Name.Type1,
                                                   "/BaseFont": Name.Helvetica, "/Encoding": Name.WinAnsiEncoding}))
        silueta_gris = "q 0.72 G 0.5 w " + " ".join(_contorno_a_path(i["corte"], H_px, ppmm) + " S" for i in lista_islas) + " Q"
        alternativos_txt = {n: f"CMYK {','.join(str(int(v * 100)) for v in c)}" for n, c in ALTERNATIVOS.items()}
        paginas = [
            ("CMYK", x_cmyk, "Capa CMYK: arte del cliente intacto + sangrado 1 mm (proceso, sin tinta plana)", False),
            ("Spot 1 (Relieve 1)", x_spot1, f"Capa Spot 1 (Relieve 1): zonas con relieve, lisas o con textura. Tinta 'Spot 1', alternativo {alternativos_txt['Spot 1']}", True),
            ("Spot 2 (Relieve 2)", x_spot2, f"Capa Spot 2 (Relieve 2): zonas con relieve doble. Tinta 'Spot 2', alternativo {alternativos_txt['Spot 2']}", True),
            ("Spot 3 (Barniz)", x_spot3, f"Capa Spot 3 (Barniz): zonas con barniz. Tinta 'Spot 3', alternativo {alternativos_txt['Spot 3']}", True),
            ("Corte", x_corte, f"Corte: silueta exterior por isla, rellena. Tinta 'CutContour', alternativo {alternativos_txt['CutContour']}", False),
        ]
        paginas = [
            (t, xo, (d if xo is not None else d + "  -  SIN CONTENIDO: esta capa va vacia"), sil)
            for t, xo, d, sil in paginas
        ]
        def pagina_capa(titulo, xobjs, detalle, con_silueta):
            pg_c = pdf_cap.add_blank_page(page_size=(Wp, Hp + BANDA))
            xod = Dictionary()
            cont = []
            for k, xo in enumerate(xobjs):
                if xo is None:
                    continue
                xod[Name(f"/X{k}")] = pdf_cap.copy_foreign(xo)
            # Capa sin contenido (p. ej. Spot 3 sin barniz): la pagina queda VACIA, solo el rotulo
            # (pedido del usuario 07/09: no dibujar nada, ni la silueta de referencia).
            if any(xobjs):
                if con_silueta:
                    cont.append(silueta_gris)
                for k, xo in enumerate(xobjs):
                    if xo is not None:
                        cont.append(f"q /X{k} Do Q")
            # banda superior con el rotulo
            cont.append(f"q 0.93 g 0 {_f(Hp)} {_f(Wp)} {_f(BANDA)} re f Q")
            cont.append(f"BT /F1 10 Tf 0 g 1 0 0 1 {_f(8)} {_f(Hp + BANDA - 16)} Tm ({titulo}) Tj ET")
            cont.append(f"BT /F1 6.5 Tf 0.25 g 1 0 0 1 {_f(8)} {_f(Hp + BANDA - 27)} Tm ({detalle}) Tj ET")
            pg_c.Resources = Dictionary({"/XObject": xod, "/Font": Dictionary({"/F1": font_c})})
            pg_c.Contents = pdf_cap.make_stream("\n".join(cont).encode("latin-1", "replace"))
        for titulo, xo, detalle, con_sil in paginas:
            pagina_capa(titulo, [xo], detalle, con_sil)
        pagina_capa("Todo junto", [x_spot1, x_spot2, x_spot3, x_cmyk],
                    "Las cuatro capas en el orden de impresion: relieve (tinta blanca) abajo, CMYK encima. El RIP separa por tinta.", False)
        ruta_capas = os.path.join(salida_dir, f"{base}-capas.pdf")
        pdf_cap.save(ruta_capas, min_version="1.6")
        pdf_cap.close()

    # -- imposicion (ya calculada arriba) y capas
    # ¿Se aplana? (ver APLANAR_MAX_BYTES). Con texturas muy densas x muchas copias el contenido se
    # dispara: ahi se vuelve a XObjects y se avisa.
    aplanar = bool(job.get("aplanar", True))
    spots_raster = bool(job.get("spots_raster", False))
    spots_trazado = bool(job.get("spots_trazado", False))
    if spots_raster or spots_trazado:
        aplanar = False
    if aplanar:
        peso = sum(len(x) for x in (plano1, plano2, plano3) if x) * max(1, imp.copias_total)
        if peso > APLANAR_MAX_BYTES:
            aplanar = False
            avisos.append(f"El arte con las texturas elegidas pesa demasiado para aplanarlo ({peso // (1024 * 1024)} MB): "
                          f"las capas de relieve van como objetos reutilizados. Si PhotoPrint las muestra vacias, "
                          f"usa menos repeticiones o una textura mas simple.")
    ocgs = {nombre: _ocg(pdf, nombre) for nombre, _ in CAPAS}
    orden_ocg = [ocgs[n] for n, _ in CAPAS]

    # /MCn sigue el orden de CAPAS (Spot 3, Spot 2, Spot 1, CMYK): tinta -> indice de propiedad.
    PROP_DE_TINTA = {3: 0, 2: 1, 1: 2, 0: 3}

    def props_de(ocg_map):
        d = Dictionary()
        for i, (n, _) in enumerate(ocg_map):
            d[Name(f"/MC{i}")] = ocgs[n]
        return d

    def _marcas(registros, W, tinta_cs):
        out = []
        xi = OFFSET_REGISTRO_MM * PT_POR_MM + imp.radio
        xd = W - OFFSET_REGISTRO_MM * PT_POR_MM - imp.radio
        out.append(tinta_cs)
        for y in registros:
            out.append(_circulo(xi, y, imp.radio) + " f")
            out.append(_circulo(xd, y, imp.radio) + " f")
        return "\n".join(out)

    for i in range(imp.paginas):
        filas, H, copias, registros = imp.pagina(i)
        pg = pdf.add_blank_page(page_size=(imp.W, H))
        cont = []
        imgs = {}
        # marcador vectorial por tinta (como dtf_blanco): PhotoPrint enumera tintas usadas por
        # objetos del contenido de pagina.
        # (Sin "marcador de tintas": la referencia de Illustrator no lo tiene. Cada tinta figura en
        # la lista de canales por los objetos que la usan, que ahora estan aplanados en la pagina.)
        # ORDEN DE DIBUJO: spots primero, CMYK ultimo — como el archivo de Illustrator que imprime
        # bien ('TPU UV  - Impresion.pdf', cuyo primer objeto es de Spot 3 y cuyo CMYK va al final).
        # PhotoPrint usa este orden para el APILADO FISICO: la prueba 14 (08/09) lo invirtio —CMYK
        # primero, spots encima— y la maquina deposito el blanco ARRIBA del color; el escudo salio
        # blanco con el dorado tapado, aunque la previsualizacion de los 4 canales de proceso se veia
        # completa. O sea: el orden de la pagina manda, y el relieve tiene que ir primero.
        #
        # Pero con los spots primero, el arte de arriba los ANULA (pruebas 3 a 13): el PDF del
        # cliente trae su propio ExtGState con /OP false —Illustrator lo pone en cada objeto— asi
        # que la sobreimpresion que le damos al XObject padre no rige adentro, y cada relleno del
        # arte hace knockout de las tintas planas que tiene debajo. De Spot 1 solo sobrevivia el
        # borde: la "linea finita en el contorno del escudo y de las estrellas".
        # Por eso el arte se incrusta con la sobreimpresion FORZADA (ver _forzar_sobreimpresion):
        # asi va encima sin borrar el relieve, y el orden de deposicion queda como corresponde.
        for idx, xo, plano in ((3, x_spot3, plano3), (2, x_spot2, plano2), (1, x_spot1, plano1)):
            cont.append(f"/OC /MC{PROP_DE_TINTA[idx]} BDC")
            if xo is not None:
                if spots_trazado:
                    tr = _capa_trazada(pdf, xo, Wp, Hp, imp, copias, f"CSs{idx}")
                    if tr:
                        cont.append("q " + tr[0] + " Q")
                elif spots_raster:
                    # Una imagen por capa, cubriendo la plancha entera (ver SPOTS_RASTER_DPI).
                    im, iw, ih = _capa_raster(pdf, xo, Wp, Hp, imp, copias, seps[f"Spot {idx}"],
                                              min_mm=float(job.get("relieve_min_mm", RELIEVE_MIN_MM)),
                                              un_bit=bool(job.get("spots_1bit", SPOTS_1BIT)))
                    imgs[f"/ISpot{idx}"] = im
                    cont.append(f"q /GSop gs {_f(imp.W)} 0 0 {_f(H)} 0 0 cm /ISpot{idx} Do Q")
                else:
                    # El contenido inline nombra su tinta "/CSspot" (venia de un XObject con recursos
                    # propios); en la pagina la tinta de esta capa se llama "/CSs{idx}".
                    cuerpo = plano.replace("/CSspot", f"/CSs{idx}") if (aplanar and plano) else f"/XSpot{idx} Do"
                    for (cx, cy) in copias:
                        cont.append(f"q 1 0 0 1 {_f(cx)} {_f(cy)} cm {cuerpo} Q")
            cont.append("EMC")
        cont.append(f"/OC /MC{PROP_DE_TINTA[0]} BDC")
        for (cx, cy) in copias:
            # /GSop ademas de la sobreimpresion forzada adentro del arte: el knockout de este
            # objeto apagaba los canales de relieve en toda el area del parche.
            cont.append(f"q /GSop gs 1 0 0 1 {_f(cx)} {_f(cy)} cm /XCmyk Do Q")
        cont.append("q " + _marcas(registros, imp.W, "0 0 0 1 k") + " Q")
        cont.append("EMC")
        res = Dictionary()
        xod = Dictionary({"/XCmyk": x_cmyk})
        for k, v in imgs.items():
            xod[Name(k)] = v
        if not aplanar and not spots_raster and not spots_trazado:   # inline/imagen/trazado: no hace falta
            for idx, xo in ((1, x_spot1), (2, x_spot2), (3, x_spot3)):
                if xo is not None:
                    xod[Name(f"/XSpot{idx}")] = xo
        res[Name.XObject] = xod
        cs_pg = Dictionary()
        for idx, xo in ((1, x_spot1), (2, x_spot2), (3, x_spot3)):
            if xo is not None:                     # solo las tintas realmente usadas
                cs_pg[Name(f"/CSs{idx}")] = seps[f"Spot {idx}"]
        res[Name.ColorSpace] = cs_pg
        res[Name.ExtGState] = Dictionary({"/GS0": gs_ai, "/GSop": gs_op})
        res[Name.Properties] = props_de(CAPAS)
        pg.Resources = res
        pg.Contents = pdf.make_stream("\n".join(cont).encode("latin-1"))

    ocp = Dictionary()
    ocp[Name.OCGs] = Array(orden_ocg)
    d = Dictionary()
    d[Name.Order] = Array(orden_ocg)
    d[Name.ON] = Array(orden_ocg)
    d[Name("/RBGroups")] = Array([])
    ocp[Name.D] = d
    pdf.Root[Name.OCProperties] = ocp
    ruta_imp = os.path.join(salida_dir, f"{base}-cmyk-spots{imp.sufijo}.pdf")
    # 1.6 = Acrobat 7, lo que exporta el script de Illustrator (las capas OCG son de PDF 1.5+).
    pdf.save(ruta_imp, object_stream_mode=pikepdf.ObjectStreamMode.disable, min_version="1.6")
    pdf.close()

    # ── PDF de corte (misma plancha)
    pdf_c = pikepdf.new()
    sep_cut = _separation(pdf_c, CAPA_CORTE[1])
    ocg_c = _ocg(pdf_c, CAPA_CORTE[0])
    x_corte_c = pdf_c.copy_foreign(x_corte)
    # el XObject copiado trae su propia Separation; unificar al objeto de este PDF
    x_corte_c.Resources.ColorSpace[Name("/CScut")] = sep_cut
    for i in range(imp.paginas):
        filas, H, copias, registros = imp.pagina(i)
        pg = pdf_c.add_blank_page(page_size=(imp.W, H))
        cont = ["/OC /MC0 BDC"]
        for (cx, cy) in copias:
            cuerpo = plano_corte if aplanar else "/XCorte Do"
            cont.append(f"q 1 0 0 1 {_f(cx)} {_f(cy)} cm {cuerpo} Q")
        cont.append("q " + _marcas(registros, imp.W, "/CScut cs 1 scn") + " Q")
        cont.append("EMC")
        res = Dictionary()
        if not aplanar:
            res[Name.XObject] = Dictionary({"/XCorte": x_corte_c})
        res[Name.ColorSpace] = Dictionary({"/CScut": sep_cut})
        res[Name.Properties] = Dictionary({"/MC0": ocg_c})
        pg.Resources = res
        pg.Contents = pdf_c.make_stream("\n".join(cont).encode("latin-1"))
    ocp = Dictionary()
    ocp[Name.OCGs] = Array([ocg_c])
    d = Dictionary()
    d[Name.Order] = Array([ocg_c])
    d[Name.ON] = Array([ocg_c])
    d[Name("/RBGroups")] = Array([])
    ocp[Name.D] = d
    pdf_c.Root[Name.OCProperties] = ocp
    ruta_corte = os.path.join(salida_dir, f"{base}-corte{imp.sufijo}.pdf")
    pdf_c.save(ruta_corte, object_stream_mode=pikepdf.ObjectStreamMode.disable, min_version="1.6")
    pdf_c.close()

    # ── vista PNG (para el operario): arte + zonas tintadas + corte. El PDF del RIP pinta las
    # tintas planas opacas encima del arte (igual que el de Illustrator), asi que en Drive/Acrobat
    # no se ve el diseno debajo; esta imagen muestra el conjunto.
    ruta_vista = None
    if ruta_capas and job.get("vista", True):
        try:
            ruta_vista = os.path.join(salida_dir, f"{base}-vista.png")
            _vista(ruta_vista, ruta_capas, Wp, Hp, lista_islas, H_px, ppmm)
        except Exception as e:  # nunca frena la generacion
            avisos.append(f"No se pudo armar la vista PNG: {e}")
            ruta_vista = None
    if ruta_capas and not job.get("capas", True):
        try:
            os.remove(ruta_capas)
        except OSError:
            pass
        ruta_capas = None

    # ── boceto (parche unitario, tamanio real, cotas)
    ruta_boceto = None
    if job.get("boceto", True):
        ruta_boceto = os.path.join(salida_dir, f"{base}-boceto.pdf")
        _boceto(ruta_boceto, ruta_pdf, cm_arte, Wp, Hp, lista_islas, H_px, ppmm)

    if preview:
        dd = fitz.open(ruta_imp)
        pix = dd[0].get_pixmap(dpi=40, alpha=False)
        pix.save(preview)
        dd.close()

    src_pdf.close()
    doc.close()
    return {
        "ok": True,
        "archivos": {"impresion": ruta_imp, "corte": ruta_corte, "boceto": ruta_boceto, "vista": ruta_vista, "capas": ruta_capas},
        "parche_mm": {"ancho": round(Wp / PT_POR_MM, 2), "alto": round(Hp / PT_POR_MM, 2),
                      "sangrado": sangrado_mm, "escala": round(escala, 4)},
        "plancha": imp.resumen(),
        "islas": len(lista_islas),
        "zonas": len(zonas),
        "tiles_textura": tiles1,
        "arte_cmyk": usa_cmyk,
        "avisos": list(dict.fromkeys(avisos)),   # sin repetidos (una textura usada en Spot 1 y Spot 2 avisaba dos veces)
    }


def _vista(ruta_png, ruta_capas, Wp, Hp, lista_islas, H_px, ppmm):
    """PNG del parche unitario: el arte (capa CMYK) con Spot 1/2/3 tintados al 45 % y el corte en
    magenta. `ruta_capas` es el PDF auxiliar con una pagina por capa (CMYK, Spot 1, Spot 2, Spot 3)."""
    from PIL import Image, ImageDraw

    dpi = int(max(100, min(300, 1000.0 / (Wp / 72.0))))   # fitz exige int
    doc = fitz.open(ruta_capas)

    banda = CAPAS_BANDA_MM * PT_POR_MM
    clip = fitz.Rect(0, banda, Wp, banda + Hp)     # fitz: origen arriba-izquierda; la banda esta arriba

    def render(i):
        pix = doc[i].get_pixmap(dpi=dpi, alpha=True, clip=clip)
        return Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)

    base = render(0)
    fondo = Image.new("RGBA", base.size, (255, 255, 255, 255))
    fondo.alpha_composite(base)
    tintes = [(1, (0, 174, 239)), (2, (255, 222, 0)), (3, (0, 166, 81))]
    for i, rgb in tintes:
        capa = render(i)
        mask = capa.getchannel("A").point(lambda a: int(a * 0.45))
        color = Image.new("RGBA", base.size, rgb + (255,))
        fondo.paste(color, (0, 0), mask)
    doc.close()

    # Corte: contornos del raster de silueta -> pixeles de la vista
    dr = ImageDraw.Draw(fondo)
    W_img, H_img = fondo.size
    escala_x = W_img / (Wp / PT_POR_MM * ppmm)
    escala_y = H_img / (Hp / PT_POR_MM * ppmm)
    for isla in lista_islas:
        pts = [(c * escala_x, r * escala_y) for r, c in isla["corte"]]
        if len(pts) >= 3:
            dr.line(pts + [pts[0]], fill=(236, 0, 140, 255), width=max(2, int(W_img / 400)))

    # Leyenda
    alto_ley = 26 + 18 * 4
    salida = Image.new("RGB", (W_img, H_img + alto_ley), (255, 255, 255))
    salida.paste(fondo.convert("RGB"), (0, 0))
    d2 = ImageDraw.Draw(salida)
    y = H_img + 6
    lineas = [((0, 174, 239), "Spot 1 (Relieve 1): zonas con relieve, liso o textura"),
              ((255, 222, 0), "Spot 2 (Relieve 2): zonas con relieve doble"),
              ((0, 166, 81), "Spot 3 (Barniz)"),
              ((236, 0, 140), f"Corte (CutContour) - parche {Wp / PT_POR_MM:.1f} x {Hp / PT_POR_MM:.1f} mm con sangrado")]
    for rgb, texto in lineas:
        d2.rectangle([8, y + 3, 20, y + 15], fill=rgb, outline=(80, 80, 80))
        d2.text((26, y + 2), texto, fill=(40, 40, 40))
        y += 18
    salida.save(ruta_png, "PNG")


def _boceto(ruta, ruta_arte, cm_arte, Wp, Hp, lista_islas, H_px, ppmm):
    """Hoja gris con el parche a tamanio real (troquel en blanco, arte encima) y cotas en cm."""
    import pikepdf
    from pikepdf import Array, Dictionary, Name

    margen = 12 * PT_POR_MM
    zona_cota = 16 * PT_POR_MM
    marca = 2.5 * PT_POR_MM
    W = Wp + 2 * margen + zona_cota
    H = Hp + 2 * margen + zona_cota
    ox, oy = margen + zona_cota, margen + zona_cota      # origen del parche en la hoja

    pdf = pikepdf.new()
    src = pikepdf.open(ruta_arte)
    arte = pdf.copy_foreign(pikepdf.Page(src.pages[0]).as_form_xobject())
    font = pdf.make_indirect(Dictionary({"/Type": Name.Font, "/Subtype": Name.Type1,
                                         "/BaseFont": Name.Helvetica, "/Encoding": Name.WinAnsiEncoding}))
    pg = pdf.add_blank_page(page_size=(W, H))
    c = []
    c.append(f"0 0 0 0.65 k 0 0 {_f(W)} {_f(H)} re f")                      # fondo gris K65
    c.append(f"q 1 0 0 1 {_f(ox)} {_f(oy)} cm")
    c.append("0 0 0 0 k")
    for isla in lista_islas:
        c.append(_contorno_a_path(isla["corte"], H_px, ppmm) + " f")     # parche en blanco (base)
    # Arte recortado al troquel: lo que la hoja del cliente tenga fuera del parche no se ve.
    c.append("q")
    for isla in lista_islas:
        c.append(_contorno_a_path(isla["corte"], H_px, ppmm))
    c.append("W* n")
    c.append(f"q {cm_arte} /XArte Do Q")
    c.append("Q")
    # linea de troquel en magenta ENCIMA del arte (convencion de imprenta): es lo que corta la cuchilla
    c.append("0 1 0 0 K 0.6 w")
    for isla in lista_islas:
        c.append(_contorno_a_path(isla["corte"], H_px, ppmm) + " S")
    c.append("Q")
    # cotas
    negro = "0 0 0 1 k 0 0 0 1 K 1.5 w"
    c.append(negro)
    xc = ox - zona_cota / 2
    c.append(f"{_f(xc)} {_f(oy)} m {_f(xc)} {_f(oy + Hp)} l S")
    c.append(f"{_f(xc - marca)} {_f(oy)} m {_f(xc + marca)} {_f(oy)} l S")
    c.append(f"{_f(xc - marca)} {_f(oy + Hp)} m {_f(xc + marca)} {_f(oy + Hp)} l S")
    yc = oy - zona_cota / 2
    c.append(f"{_f(ox)} {_f(yc)} m {_f(ox + Wp)} {_f(yc)} l S")
    c.append(f"{_f(ox)} {_f(yc - marca)} m {_f(ox)} {_f(yc + marca)} l S")
    c.append(f"{_f(ox + Wp)} {_f(yc - marca)} m {_f(ox + Wp)} {_f(yc + marca)} l S")
    alto_cm = f"{Hp / PT_POR_MM / 10:.2f} cm"
    ancho_cm = f"{Wp / PT_POR_MM / 10:.2f} cm"
    c.append(f"BT /F1 11 Tf 0 1 -1 0 {_f(xc - marca - 4)} {_f(oy + Hp / 2 - 12)} Tm ({alto_cm}) Tj ET")
    c.append(f"BT /F1 11 Tf 1 0 0 1 {_f(ox + Wp / 2 - 12)} {_f(yc - marca - 12)} Tm ({ancho_cm}) Tj ET")
    c.append(f"BT /F1 8 Tf 1 0 0 1 {_f(ox)} {_f(H - margen / 2)} Tm (Medidas con sangrado de 1 mm. La linea magenta es el corte.) Tj ET")
    res = Dictionary()
    res[Name.XObject] = Dictionary({"/XArte": arte})
    res[Name.Font] = Dictionary({"/F1": font})
    pg.Resources = res
    pg.Contents = pdf.make_stream("\n".join(c).encode("latin-1"))
    pdf.save(ruta, object_stream_mode=pikepdf.ObjectStreamMode.disable)
    pdf.close()
    src.close()


# ── analizar ─────────────────────────────────────────────────────────────────

def analizar(ruta_pdf):
    doc, page, formas, avisos, motivo = leer_vector(ruta_pdf)
    pr = page.rect
    utiles = [f for f in formas if not f.es_fondo]

    def T_id(x, y):
        return x, y

    salida_formas = []
    colores = {}
    for f in utiles:
        d = path_pdf(f, T_id)
        # a sintaxis SVG: "x y m" -> "M x y", "x y l" -> "L x y", "c" -> "C", "h" -> "Z"
        svg = []
        for linea in d.split("\n"):
            tok = linea.split()
            if not tok:
                continue
            i = 0
            while i < len(tok):
                if tok[i] == "m":
                    svg.append(f"M {tok[i-2]} {tok[i-1]}")
                elif tok[i] == "l":
                    svg.append(f"L {tok[i-2]} {tok[i-1]}")
                elif tok[i] == "c":
                    svg.append("C " + " ".join(tok[i-6:i]))
                elif tok[i] == "h":
                    svg.append("Z")
                i += 1
        fill_hex = _hex(f.fill)
        item = {
            "seqno": f.seqno,
            "fill": fill_hex,
            "stroke": _hex(f.stroke),
            "width": round(float(f.width or 0), 3),
            "evenOdd": f.even_odd,
            "rect": [round(f.rect.x0, 2), round(f.rect.y0, 2), round(f.rect.x1, 2), round(f.rect.y1, 2)],
            "area": round((f.rect.x1 - f.rect.x0) * (f.rect.y1 - f.rect.y0), 2),
            "d": " ".join(svg),
        }
        salida_formas.append(item)
        if fill_hex:
            colores.setdefault(fill_hex, []).append(f.seqno)

    bbox = None
    if utiles:
        bbox = [round(min(f.rect.x0 for f in utiles), 2), round(min(f.rect.y0 for f in utiles), 2),
                round(max(f.rect.x1 for f in utiles), 2), round(max(f.rect.y1 for f in utiles), 2)]
    res = {
        "ok": True,
        "vector": motivo is None,
        "motivo": motivo,
        "pagina": {"x": round(pr.x0, 2), "y": round(pr.y0, 2), "ancho": round(pr.width, 2), "alto": round(pr.height, 2),
                   "ancho_mm": round(pr.width / PT_POR_MM, 1), "alto_mm": round(pr.height / PT_POR_MM, 1)},
        "bbox": bbox,
        "bbox_mm": ([round((bbox[2] - bbox[0]) / PT_POR_MM, 1), round((bbox[3] - bbox[1]) / PT_POR_MM, 1)] if bbox else None),
        "formas": salida_formas,
        "colores": [{"fill": k, "n": len(v), "seqnos": v} for k, v in
                    sorted(colores.items(), key=lambda kv: -len(kv[1]))],
        "avisos": avisos,
    }
    doc.close()
    return res


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    import argparse
    ap = argparse.ArgumentParser(description="TPU matriz propia: analisis del vector y generacion de los PDFs del RIP")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analizar")
    a.add_argument("pdf")
    g = sub.add_parser("generar")
    g.add_argument("job")
    g.add_argument("--preview", default=None, help="PNG de la primera plancha (40 dpi)")
    args = ap.parse_args()
    try:
        if args.cmd == "analizar":
            out = analizar(args.pdf)
        else:
            out = generar(_leer_json(args.job), preview=args.preview)
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:  # noqa
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
