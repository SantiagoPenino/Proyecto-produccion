#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
[DTF] Capa de tinta blanca automatica — reemplaza la accion de Photoshop
"DTF Photoprint V5_25.3" que hoy corre el operario.

Toma el arte del cliente (PDF de 1 pagina o PNG, fondo transparente) y devuelve
UN PDF: el arte original intacto + un canal de tinta plana (Separation "Spot 1")
con la plancha de blanco, en sobreimpresion, listo para PhotoPrint.

Reglas (decodificadas del .atn + spec del usuario, 14/08/2026):
  - Zonas de color: blanco al 100%, con CHOKE de 1 px @ 300 dpi (fisico: 0,085 mm; era 2 hasta el 31/08).
  - Blancos del disenio (RGB >= tol, default 245): blanco al 100% SIN choke.
  - Semitransparencias: blanco = opacidad 1:1, lineal desde 0 (identico a la accion,
    que rellena 100K a traves de la seleccion de transparencia).
  - Corte de cola (--tail-cut, default 3%): bajo ese umbral de opacidad no se imprime
    NADA — ni blanco ni color. Va MAS ALLA de la accion, que nunca toca el arte.
  - Spot "Spot 1" con alternate CMYK (0,0,0,0) — fix PhotoPrint: un alternate de
    preview distinto de 0 lo aplicaba como valor real de tinta.

Motor adaptado de suite_user/dtf_white.py + pdf_merge_white.py (misma logica,
parametros pisados con los valores confirmados).

Uso:
    python dtf_blanco.py entrada.pdf salida.pdf [--preview salida.png]
        [--dpi 300] [--choke-px 1] [--white-pct 100] [--ramp 25] [--tail-cut 3]
        [--tol 245] [--spot "Spot 1"]

Salida (ultima linea, para el caller de Node): JSON {"ok":true,...} o {"ok":false,"error":...}
"""
import argparse
import io
import json
import os
import sys
import zlib

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # planchas grandes a 300 dpi superan el limite default de PIL

# scipy es lo ideal (erosion circular, identica a la suite). Si no esta, se cae a un
# MinFilter cuadrado de PIL: para un choke de 2 px la diferencia es de sub-pixel en
# las esquinas. El server con el venv completo usa siempre scipy.
try:
    from scipy import ndimage
    _HAY_SCIPY = True
except Exception:
    from PIL import ImageFilter
    _HAY_SCIPY = False


# ── Rasterizado del PDF (fiel a suite_user/dtf_white.py) ─────────────────────

def _best_ppm(w_mm, h_mm, dpi, search=300):
    """Pixeles-por-metro que minimizan el error de tamanio fisico al redondear."""
    target = dpi / 0.0254
    best, best_err = int(round(target)), float("inf")
    for ppm in range(int(target) - search, int(target) + search + 1):
        if ppm <= 0:
            continue
        ew = abs(round(w_mm / 1000.0 * ppm) / ppm * 1000.0 - w_mm)
        eh = abs(round(h_mm / 1000.0 * ppm) / ppm * 1000.0 - h_mm)
        err = max(ew, eh)
        if err < best_err - 1e-12 or (abs(err - best_err) < 1e-12 and abs(ppm - target) < abs(best - target)):
            best, best_err = ppm, err
    return best


def rasterizar_pdf(ruta, dpi):
    """Rasteriza la pagina 1 con tamanio fisico exacto. Devuelve (rgba, dpi_efectivo, pdf_bytes)."""
    import fitz  # PyMuPDF — solo hace falta para entrada PDF
    with open(ruta, "rb") as f:
        pdf_bytes = f.read()
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    try:
        page.set_cropbox(page.mediabox)
    except Exception:
        pass
    mb = page.mediabox
    w_mm = mb.width / 72.0 * 25.4
    h_mm = mb.height / 72.0 * 25.4
    ppm = _best_ppm(w_mm, h_mm, dpi)
    target_w = int(round(w_mm / 1000.0 * ppm))
    target_h = int(round(h_mm / 1000.0 * ppm))
    pix = page.get_pixmap(matrix=fitz.Matrix(target_w / mb.width, target_h / mb.height), alpha=True)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        rgba = img.copy()
    elif pix.n == 3:
        rgba = np.dstack([img, np.full(img.shape[:2], 255, np.uint8)])
    else:
        raise ValueError(f"pixmap inesperado: n={pix.n}")
    h, w = rgba.shape[:2]
    rgba = rgba[:min(h, target_h), :min(w, target_w)]
    h, w = rgba.shape[:2]
    if h < target_h or w < target_w:
        pad = np.zeros((target_h, target_w, 4), dtype=np.uint8)
        pad[:h, :w] = rgba
        rgba = pad
    doc.close()
    return rgba, ppm * 0.0254, pdf_bytes


def cargar_png(ruta, dpi_defecto):
    """PNG del cliente → (rgba, dpi, pdf_base_bytes). El PDF base se arma con la imagen
    al tamanio fisico que declara su DPI (o el default), para poder incrustar el spot."""
    import fitz
    im = Image.open(ruta).convert("RGBA")
    dpi = float((im.info.get("dpi") or (dpi_defecto, dpi_defecto))[0]) or dpi_defecto
    rgba = np.asarray(im, dtype=np.uint8)
    h, w = rgba.shape[:2]
    w_pt = w / dpi * 72.0
    h_pt = h / dpi * 72.0
    doc = fitz.open()
    page = doc.new_page(width=w_pt, height=h_pt)
    page.insert_image(fitz.Rect(0, 0, w_pt, h_pt), filename=ruta, keep_proportion=False)
    pdf_bytes = doc.tobytes()
    doc.close()
    return rgba, dpi, pdf_bytes


# ── Plancha de blanco (fiel a suite_user, defaults pisados) ──────────────────

def _erosion(mascara, radio_px):
    """Erosion binaria de la mascara. scipy (circular) o PIL MinFilter (cuadrada)."""
    rad = max(1, int(round(radio_px)))
    if _HAY_SCIPY:
        yy, xx = np.ogrid[-rad:rad + 1, -rad:rad + 1]
        struct = (xx * xx + yy * yy) <= rad * rad
        return ndimage.binary_erosion(mascara, structure=struct, border_value=0)
    im = Image.fromarray((mascara * 255).astype(np.uint8), mode="L")
    im = im.filter(ImageFilter.MinFilter(rad * 2 + 1))
    return np.asarray(im) >= 128


def mascara_conservar(rgba, tail_cut_pct):
    """Mascara booleana del CORTE DE COLA: True = se imprime, False = no se imprime nada.

    Un degrade que se esfuma "a cero" sigue tirando gotitas invisibles al 2-3% de
    opacidad, y en DTF cada gotita ancla su poliamida: la pelicula termina bastante
    mas afuera de donde el disenio se deja de ver (el halo lechoso alrededor de los
    glows). Cortando color Y blanco en el MISMO borde, la estampa muere limpia.
    Devuelve None si el corte esta desactivado (0), para no tocar el PDF de mas.
    """
    if tail_cut_pct <= 0:
        return None
    alpha = rgba[..., 3].astype(np.float32) / 255.0
    return alpha >= (tail_cut_pct / 100.0)


def plancha_blanco(rgba, dpi, choke_px300=2.0, white_pct=100.0, tol=245, ramp_pct=0.0,
                   conservar=None, gamma=1.0):
    """Imagen L con la convencion negro(0) = 100% de tinta blanca."""
    H, W = rgba.shape[:2]
    r, g, b, a = rgba[..., 0], rgba[..., 1], rgba[..., 2], rgba[..., 3]

    alpha = a.astype(np.float32) / 255.0
    hay_contenido = alpha > 0.0
    es_blanco = (r >= tol) & (g >= tol) & (b >= tol) & hay_contenido
    es_color = hay_contenido & (~es_blanco)

    blanco = np.zeros((H, W), np.float32)          # 0..100 (% de tinta)
    blanco[es_color] = white_pct
    blanco[es_blanco] = 100.0

    # Rampa de semitransparencias. Con ramp_pct=0 (default) el blanco copia la opacidad
    # 1:1, que es exactamente lo que hace la accion de Photoshop.
    s = max(0.0, min(0.999, ramp_pct / 100.0))
    factor = np.clip((alpha - s) / (1.0 - s), 0.0, 1.0)

    # Gamma: curva el reparto SIN mover los extremos (0 sigue en 0, opaco sigue en 100).
    # gamma > 1 adelgaza los medios y bajos → el blanco muere ANTES que el color, que es
    # lo que se busca: un color al 10% casi no se ve, pero un blanco al 10% es tinta opaca
    # y sobre la tela se lee como velo. Es la version SUAVE de lo que intentaba el ramp 25
    # (que cortaba en seco y dejaba el escalon visible en el degrade).
    if gamma != 1.0:
        factor = np.power(factor, max(0.05, gamma))

    blanco *= factor

    # Choke SOLO sobre el color: el blanco del disenio no se adelgaza. El parametro esta
    # definido "en px a 300 dpi" (la unidad de la accion original): se escala al dpi real.
    choke_px = choke_px300 * (dpi / 300.0)
    if choke_px > 0:
        color_erosionado = _erosion(es_color, choke_px)
        perdidos = es_color & (~color_erosionado)
        blanco[perdidos] = 0.0

    # Corte de cola: el blanco muere en el mismo borde que el color (ver mascara_conservar).
    if conservar is not None:
        blanco[~conservar] = 0.0

    gris = (255.0 - (blanco / 100.0) * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(gris, mode="L")


# ── Arte en CMYK con perfil (pedido 31/08) ───────────────────────────────────

ICC_DEFAULT = r"C:\Program Files (x86)\Common Files\Adobe\Color\Profiles\Recommended\USWebCoatedSWOP.icc"

def _abrir_con_arte(pdf_bytes):
    """Abre el PDF y devuelve (pdf, imagen_del_arte). El arte es la unica imagen
    con SMask (su alpha); la plancha de blanco no lleva."""
    import pikepdf
    from pikepdf import Name
    pdf = pikepdf.open(io.BytesIO(pdf_bytes))
    for obj in pdf.objects:
        try:
            if obj.get(Name.Subtype, None) == Name.Image and Name.SMask in obj:
                return pdf, obj
        except Exception:
            continue
    raise RuntimeError("no encontre la imagen del arte")


def incrustar_icc_rgb(pdf_bytes, icc_bytes):
    """El arte TRAE su propio perfil (iCCP del PNG): se embebe ESE como ICCBased N=3,
    sin convertir nada — regla 31/08: USWC es solo para los que vienen sin perfil."""
    import pikepdf
    from pikepdf import Name, Array
    pdf, arte = _abrir_con_arte(pdf_bytes)
    icc_stream = pdf.make_stream(bytes(icc_bytes))
    icc_stream[Name.N] = 3
    icc_stream[Name("/Alternate")] = Name.DeviceRGB
    arte[Name.ColorSpace] = pdf.make_indirect(Array([Name.ICCBased, icc_stream]))
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


def arte_a_cmyk(pdf_bytes, rgba, icc_ruta):
    """SOLO entrada PNG: reemplaza la imagen del arte (RGB) por su conversion a CMYK
    con el perfil embebido (ICCBased N=4). Asi el RIP recibe el color ya separado,
    como lo entregaba el flujo de Photoshop (doc CMYK U.S. Web Coated v2), en vez
    de convertir el RGB con su default. La alpha (SMask) queda intacta.

    Conversion sRGB -> perfil con intento colorimetrico relativo + compensacion de
    punto negro (los defaults de Photoshop). OJO: SWOP tiene gamut chico — los
    fluor/neon se apagan igual que se apagaban al pasar el arte a CMYK en PS.
    """
    from PIL import ImageCms
    import pikepdf
    from pikepdf import Name, Array

    with open(icc_ruta, "rb") as f:
        icc_bytes = f.read()

    srgb = ImageCms.createProfile("sRGB")
    destino = ImageCms.getOpenProfile(io.BytesIO(icc_bytes))
    # Pillow nuevo expone enums (Intent/Flags); el viejo, constantes INTENT_*/FLAGS.
    try:
        intento = ImageCms.Intent.RELATIVE_COLORIMETRIC
        flags = ImageCms.Flags.BLACKPOINTCOMPENSATION
    except AttributeError:
        intento = ImageCms.INTENT_RELATIVE_COLORIMETRIC
        flags = ImageCms.FLAGS.get("BLACKPOINTCOMPENSATION", 0)
    transform = ImageCms.buildTransform(
        srgb, destino, "RGB", "CMYK",
        renderingIntent=intento, flags=flags,
    )
    cmyk = ImageCms.applyTransform(Image.fromarray(rgba[..., :3], "RGB"), transform)
    data = zlib.compress(cmyk.tobytes(), 6)

    pdf, arte = _abrir_con_arte(pdf_bytes)

    icc_stream = pdf.make_stream(icc_bytes)
    icc_stream[Name.N] = 4
    icc_stream[Name("/Alternate")] = Name.DeviceCMYK

    arte.write(data, filter=Name.FlateDecode)
    arte[Name.ColorSpace] = pdf.make_indirect(Array([Name.ICCBased, icc_stream]))
    arte[Name.BitsPerComponent] = 8
    if Name("/Decode") in arte:
        del arte[Name("/Decode")]

    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


# ── Corte de cola sobre el ARTE (mas alla de la accion de Photoshop) ─────────

def enmascarar_cola(pdf_bytes, conservar):
    """Recorta el arte del cliente donde `conservar` es False.

    NO rasteriza: envuelve el contenido original en un Form XObject y le aplica un
    soft mask de luminosidad. El vector sigue siendo vector (textos y curvas nitidos
    al ripear), solo deja de pintar en la zona cortada.
    """
    import pikepdf
    from pikepdf import Name, Dictionary, Array
    import pikepdf as _pk

    pdf = pikepdf.open(io.BytesIO(pdf_bytes))
    page = pdf.pages[0]

    mb = page.mediabox
    x0, y0 = float(mb[0]), float(mb[1])
    W = float(mb[2]) - x0
    H = float(mb[3]) - y0

    # Mascara: blanco(255) = se conserva, negro(0) = se corta. Como luminosidad, es el
    # alfa que se le aplica al arte.
    m = np.where(conservar, 255, 0).astype(np.uint8)
    mh, mw = m.shape
    mimg = pdf.make_stream(zlib.compress(m.tobytes(), 6))
    mimg[Name.Type] = Name.XObject
    mimg[Name.Subtype] = Name.Image
    mimg[Name.Width] = mw
    mimg[Name.Height] = mh
    mimg[Name.BitsPerComponent] = 8
    mimg[Name.ColorSpace] = Name.DeviceGray
    mimg[Name.Filter] = Name.FlateDecode

    mres = Dictionary()
    mres[Name.XObject] = Dictionary()
    mres[Name.XObject][Name("/MascaraIMG")] = mimg
    mform = pdf.make_stream(
        f"q {W:.4f} 0 0 {H:.4f} {x0:.4f} {y0:.4f} cm /MascaraIMG Do Q\n".encode())
    mform[Name.Type] = Name.XObject
    mform[Name.Subtype] = Name.Form
    mform[Name.BBox] = Array([x0, y0, x0 + W, y0 + H])
    mform[Name.Resources] = mres
    mform[Name.Group] = Dictionary(Type=Name.Group, S=Name.Transparency, CS=Name.DeviceGray)

    # Contenido original -> Form XObject, con SUS recursos (por eso la pagina estrena
    # un diccionario de recursos limpio: nadie se referencia a si mismo).
    contents = page.get(Name.Contents)
    if isinstance(contents, _pk.Array):
        raw = b"\n".join(bytes(c.read_bytes()) for c in contents)
    else:
        raw = bytes(contents.read_bytes())
    oform = pdf.make_stream(raw)
    oform[Name.Type] = Name.XObject
    oform[Name.Subtype] = Name.Form
    oform[Name.BBox] = Array([x0, y0, x0 + W, y0 + H])
    oform[Name.Resources] = page.get(Name.Resources, Dictionary())
    # Grupo de transparencia SIN CS: hereda el espacio de color de la pagina, asi un
    # arte CMYK no se convierte a RGB de paso.
    oform[Name.Group] = Dictionary(Type=Name.Group, S=Name.Transparency)

    gs = Dictionary()
    gs[Name.Type] = Name.ExtGState
    gs[Name.SMask] = Dictionary(
        Type=Name.Mask, S=Name.Luminosity, G=mform, BC=Array([0]))

    nres = Dictionary()
    nres[Name.XObject] = Dictionary()
    nres[Name.XObject][Name("/ArteOriginal")] = oform
    nres[Name.ExtGState] = Dictionary()
    nres[Name.ExtGState][Name("/GSCorteCola")] = gs
    page[Name.Resources] = nres
    page[Name.Contents] = pdf.make_stream(b"q /GSCorteCola gs /ArteOriginal Do Q\n")

    out = io.BytesIO()
    pdf.save(out, object_stream_mode=_pk.ObjectStreamMode.disable)
    pdf.close()
    return out.getvalue()


# ── Incrustado del spot (fiel a suite_user/pdf_merge_white.py) ───────────────

def incrustar_spot(pdf_bytes, plancha_L, spot="Spot 1"):
    import pikepdf
    from pikepdf import Name, Dictionary, Array

    pdf = pikepdf.open(io.BytesIO(pdf_bytes))
    page = pdf.pages[0]

    arr = np.asarray(plancha_L, dtype=np.uint8)
    tinta = (255 - arr).astype(np.uint8)           # 255 = tinta al 100%
    h, w = tinta.shape
    data = zlib.compress(tinta.tobytes(), 6)

    # Separation clasica; C1=(0,0,0,0) A PROPOSITO: PhotoPrint aplica el alternate como
    # valor real de tinta (bug pagado en la suite v3.3) — nada de preview gris.
    fn = Dictionary()
    fn[Name.FunctionType] = 2
    fn[Name.Domain] = Array([0, 1])
    fn[Name.C0] = Array([0, 0, 0, 0])
    fn[Name.C1] = Array([0, 0, 0, 0])
    fn[Name.N] = 1
    fn[Name.Range] = Array([0, 1, 0, 1, 0, 1, 0, 1])
    # Indirecto: el MISMO objeto Separation se referencia desde la imagen y desde los
    # recursos de pagina (ver abajo) — una sola definicion de la tinta, dos usos.
    sep = pdf.make_indirect(Array([Name.Separation, Name("/" + spot), Name.DeviceCMYK, fn]))

    img = pdf.make_stream(data)
    img[Name.Type] = Name.XObject
    img[Name.Subtype] = Name.Image
    img[Name.Width] = w
    img[Name.Height] = h
    img[Name.BitsPerComponent] = 8
    img[Name.ColorSpace] = sep
    img[Name.Filter] = Name.FlateDecode
    # SIN /Mask [0 0]. El color-key masking era el causante de las RAYAS NEGRAS
    # (27-31/08): PhotoPrint lo decodifica con basura determinística — mismas
    # posiciones en cada impresión; aislado con variantes A/A2/B el 31/08 (la
    # única diferencia entre el archivo rayado y el limpio era esta línea).
    # No hace falta: tinta 0 con overprint no pinta nada de todos modos.

    res = page.get(Name.Resources, None)
    if res is None:
        res = Dictionary()
        page[Name.Resources] = res
    xobjs = res.get(Name.XObject, None)
    if xobjs is None:
        xobjs = Dictionary()
        res[Name.XObject] = xobjs
    xname = "WhiteLayerIMG"
    i = 0
    while Name("/" + xname) in xobjs.keys():
        i += 1
        xname = f"WhiteLayerIMG{i}"
    xobjs[Name("/" + xname)] = img

    gs = Dictionary()
    gs[Name.Type] = Name.ExtGState
    gs[Name.OP] = True
    gs[Name("/op")] = True
    gs[Name.OPM] = 1
    gss = res.get(Name.ExtGState, None)
    if gss is None:
        gss = Dictionary()
        res[Name.ExtGState] = gss
    gname = "GSWhiteOP"
    j = 0
    while Name("/" + gname) in gss.keys():
        j += 1
        gname = f"GSWhiteOP{j}"
    gss[Name("/" + gname)] = gs

    # La tinta tambien como COLORSPACE DE PAGINA + un objeto VECTORIAL que la usa.
    # Motivo (14/08): PhotoPrint no listaba el canal cuando la Separation vivia solo dentro
    # de la imagen — su escaner de tintas enumera las usadas por objetos del contenido
    # (como hace Illustrator al repintar con tintas planas). El marcador es un rectangulo
    # de 0.05 pt (17 micrones) en la esquina de la hoja: invisible e inimprimible, pero
    # suficiente para que la tinta figure en la lista de canales.
    cspaces = res.get(Name.ColorSpace, None)
    if cspaces is None:
        cspaces = Dictionary()
        res[Name.ColorSpace] = cspaces
    csname = "CSWhite"
    k = 0
    while Name("/" + csname) in cspaces.keys():
        k += 1
        csname = f"CSWhite{k}"
    cspaces[Name("/" + csname)] = sep

    mb = page.mediabox
    x0, y0 = float(mb[0]), float(mb[1])
    W = float(mb[2]) - x0
    H = float(mb[3]) - y0
    dibujo = (
        f"q /{gname} gs /{csname} cs 1 scn {x0:.4f} {y0:.4f} 0.05 0.05 re f Q\n"
        f"q /{gname} gs {W:.4f} 0 0 {H:.4f} {x0:.4f} {y0:.4f} cm /{xname} Do Q\n"
    ).encode()

    nuevo = pdf.make_stream(dibujo)
    import pikepdf as _pk
    contents = page.get(Name.Contents)
    if isinstance(contents, _pk.Array):
        page[Name.Contents] = Array(list(contents) + [nuevo])
    else:
        page[Name.Contents] = Array([contents, nuevo])

    out = io.BytesIO()
    pdf.save(out, object_stream_mode=_pk.ObjectStreamMode.disable)
    pdf.close()
    return out.getvalue()


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Capa de tinta blanca DTF (PDF con tinta 'Spot 1')")
    ap.add_argument("entrada", help="arte del cliente: PDF de 1 pagina o PNG (fondo transparente)")
    ap.add_argument("salida", help="PDF resultante (arte + spot de blanco)")
    ap.add_argument("--preview", help="PNG opcional con la plancha de blanco (para revision)")
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--choke-px", type=float, default=1.0, help="choke en px a 300 dpi (default 1, pedido 31/08)")
    ap.add_argument("--white-pct", type=float, default=100.0, help="blanco bajo el color (default 100)")
    # Default 25 (veredicto impreso 27/08 sobre tela oscura): el blanco arranca recién en el
    # 25% de opacidad — abajo de eso el color queda sin respaldo y se funde con la tela, que
    # es el efecto de semitransparencia buscado. La acción de Photoshop original es ramp 0
    # (lineal 1:1): quedó disponible pasando --ramp 0 si algún arte lo pide.
    # ramp 0 = blanco copia la opacidad 1:1, lineal desde cero — es lo que hace la acción de
    # Photoshop (DTF Photoprint V5_25.3: rellena 100K a través de la selección de transparencia).
    # El 25 anterior era un invento de la traducción: cortaba el blanco en las colas de los
    # degradés y dejaba un anillo lechoso de adhesivo sin respaldo (prueba del 18/08).
    ap.add_argument("--ramp", type=float, default=25.0, help="opacidad donde arranca el blanco (default 25; 0 = lineal 1:1 como la acción PS)")
    # Corte de cola: bajo este % de opacidad no se imprime NADA (ni blanco ni color).
    # A 3% la tinta ya es invisible, pero seguia anclando poliamida: es el halo lechoso
    # alrededor de los glows. 0 lo desactiva y el arte sale intacto, como la accion.
    ap.add_argument("--tail-cut", type=float, default=3.0,
                    help="opacidad bajo la cual no se imprime nada, ni color (default 3; 0 = sin corte)")
    # Gamma del reparto de blanco: 1 = lineal (como la accion). >1 = el blanco cae mas
    # rapido que el color en los tonos bajos, sin escalon y sin tocar los solidos.
    ap.add_argument("--gamma", type=float, default=1.0,
                    help="curva del blanco: 1 lineal, >1 menos blanco en medios/bajos (default 1)")
    ap.add_argument("--tol", type=int, default=245, help="umbral RGB de blanco del disenio (default 245)")
    ap.add_argument("--spot", default="Spot 1")
    # Perfil para separar el arte a CMYK — SOLO entrada PNG y SOLO si el arte no trae
    # perfil propio (si trae, se respeta el suyo). El PDF del cliente va intacto siempre.
    # "" = no convertir nunca.
    ap.add_argument("--icc", default=ICC_DEFAULT,
                    help="perfil CMYK para PNG sin perfil embebido (default USWC v2; '' = no convertir)")
    args = ap.parse_args()

    try:
        icc_usado = None
        if args.entrada.lower().endswith(".png"):
            rgba, dpi, pdf_base = cargar_png(args.entrada, args.dpi)
            # Regla 31/08: el USWC es SOLO para artes que vienen sin perfil. Si el PNG
            # trae el suyo (iCCP), se respeta y se embebe ese, sin conversion.
            perfil_propio = Image.open(args.entrada).info.get("icc_profile")
            if perfil_propio:
                pdf_base = incrustar_icc_rgb(pdf_base, perfil_propio)
                icc_usado = "propio del archivo"
            elif args.icc and os.path.isfile(args.icc):
                pdf_base = arte_a_cmyk(pdf_base, rgba, args.icc)
                icc_usado = os.path.basename(args.icc)
        else:
            # El PDF del cliente va INTACTO por diseno: no se le toca el color.
            rgba, dpi, pdf_base = rasterizar_pdf(args.entrada, args.dpi)

        conservar = mascara_conservar(rgba, args.tail_cut)

        plancha = plancha_blanco(
            rgba, dpi,
            choke_px300=args.choke_px, white_pct=args.white_pct,
            tol=args.tol, ramp_pct=args.ramp, conservar=conservar, gamma=args.gamma,
        )

        if conservar is not None:
            pdf_base = enmascarar_cola(pdf_base, conservar)

        resultado = incrustar_spot(pdf_base, plancha, spot=args.spot)
        with open(args.salida, "wb") as f:
            f.write(resultado)

        if args.preview:
            prev = plancha
            if max(prev.size) > 1200:
                e = 1200.0 / max(prev.size)
                prev = prev.resize((int(prev.size[0] * e), int(prev.size[1] * e)), Image.LANCZOS)
            prev.save(args.preview, "PNG")

        cubiertos = int((np.asarray(plancha) < 255).sum())
        cortados = int((~conservar & (rgba[..., 3] > 0)).sum()) if conservar is not None else 0
        print(json.dumps({
            "ok": True, "px": list(plancha.size), "dpi": round(dpi, 2),
            "pixelesConTinta": cubiertos, "pixelesCortados": cortados,
            "tailCut": args.tail_cut, "icc": icc_usado, "scipy": _HAY_SCIPY, "bytes": len(resultado),
        }))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
