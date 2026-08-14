#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
[DTF] Capa de tinta blanca automatica — reemplaza la accion de Photoshop
"DTF Photoprint V5_25.3" que hoy corre el operario.

Toma el arte del cliente (PDF de 1 pagina o PNG, fondo transparente) y devuelve
UN PDF: el arte original intacto + un canal de tinta plana (Separation "Spot_1")
con la plancha de blanco, en sobreimpresion, listo para PhotoPrint.

Reglas (decodificadas del .atn + spec del usuario, 14/08/2026):
  - Zonas de color: blanco al 100%, con CHOKE de 2 px @ 300 dpi (fisico: 0,169 mm).
  - Blancos del disenio (RGB >= tol, default 245): blanco al 100% SIN choke.
  - Semitransparencias: rampa desde 25% de opacidad (debajo no hay tinta;
    de 25% a 100% escala lineal 0->100). MEJORA sobre la accion (que era lineal desde 0).
  - Spot "Spot_1" con alternate CMYK (0,0,0,0) — fix PhotoPrint: un alternate de
    preview distinto de 0 lo aplicaba como valor real de tinta.

Motor adaptado de suite_user/dtf_white.py + pdf_merge_white.py (misma logica,
parametros pisados con los valores confirmados).

Uso:
    python dtf_blanco.py entrada.pdf salida.pdf [--preview salida.png]
        [--dpi 300] [--choke-px 2] [--white-pct 100] [--ramp 25] [--tol 245]
        [--spot Spot_1]

Salida (ultima linea, para el caller de Node): JSON {"ok":true,...} o {"ok":false,"error":...}
"""
import argparse
import io
import json
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


def plancha_blanco(rgba, dpi, choke_px300=2.0, white_pct=100.0, tol=245, ramp_pct=25.0):
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

    # Rampa de semitransparencias: bajo `ramp_pct` de opacidad no hay tinta; de ahi a 100%
    # se reescala lineal. (La accion de Photoshop era lineal desde 0; esto es spec nueva.)
    s = max(0.0, min(0.999, ramp_pct / 100.0))
    blanco *= np.clip((alpha - s) / (1.0 - s), 0.0, 1.0)

    # Choke SOLO sobre el color: el blanco del disenio no se adelgaza. El parametro esta
    # definido "en px a 300 dpi" (la unidad de la accion original): se escala al dpi real.
    choke_px = choke_px300 * (dpi / 300.0)
    if choke_px > 0:
        color_erosionado = _erosion(es_color, choke_px)
        perdidos = es_color & (~color_erosionado)
        blanco[perdidos] = 0.0

    gris = (255.0 - (blanco / 100.0) * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(gris, mode="L")


# ── Incrustado del spot (fiel a suite_user/pdf_merge_white.py) ───────────────

def incrustar_spot(pdf_bytes, plancha_L, spot="Spot_1"):
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
    sep = Array([Name.Separation, Name("/" + spot), Name.DeviceCMYK, fn])

    img = pdf.make_stream(data)
    img[Name.Type] = Name.XObject
    img[Name.Subtype] = Name.Image
    img[Name.Width] = w
    img[Name.Height] = h
    img[Name.BitsPerComponent] = 8
    img[Name.ColorSpace] = sep
    img[Name.Filter] = Name.FlateDecode
    img[Name.Mask] = Array([0, 0])                 # tinta 0 no pinta (PDF 1.3, max compat)

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

    mb = page.mediabox
    x0, y0 = float(mb[0]), float(mb[1])
    W = float(mb[2]) - x0
    H = float(mb[3]) - y0
    dibujo = f"q /{gname} gs {W:.4f} 0 0 {H:.4f} {x0:.4f} {y0:.4f} cm /{xname} Do Q\n".encode()

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
    ap = argparse.ArgumentParser(description="Capa de tinta blanca DTF (PDF con Spot_1)")
    ap.add_argument("entrada", help="arte del cliente: PDF de 1 pagina o PNG (fondo transparente)")
    ap.add_argument("salida", help="PDF resultante (arte + spot de blanco)")
    ap.add_argument("--preview", help="PNG opcional con la plancha de blanco (para revision)")
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--choke-px", type=float, default=2.0, help="choke en px a 300 dpi (default 2)")
    ap.add_argument("--white-pct", type=float, default=100.0, help="blanco bajo el color (default 100)")
    ap.add_argument("--ramp", type=float, default=25.0, help="opacidad donde arranca la tinta (default 25)")
    ap.add_argument("--tol", type=int, default=245, help="umbral RGB de blanco del disenio (default 245)")
    ap.add_argument("--spot", default="Spot_1")
    args = ap.parse_args()

    try:
        if args.entrada.lower().endswith(".png"):
            rgba, dpi, pdf_base = cargar_png(args.entrada, args.dpi)
        else:
            rgba, dpi, pdf_base = rasterizar_pdf(args.entrada, args.dpi)

        plancha = plancha_blanco(
            rgba, dpi,
            choke_px300=args.choke_px, white_pct=args.white_pct,
            tol=args.tol, ramp_pct=args.ramp,
        )

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
        print(json.dumps({
            "ok": True, "px": list(plancha.size), "dpi": round(dpi, 2),
            "pixelesConTinta": cubiertos, "scipy": _HAY_SCIPY, "bytes": len(resultado),
        }))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
