#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
medir_trazo_texturas.py — escala minima de cada textura TPU segun el grosor de su trazo.

Para cada SVG del catalogo genera, con el generador real (tpu_matriz.generar, misma receta que
produccion: relieve rasterizado, doble), un parche cuadrado de referencia de 60 mm a escala 1 y
mide el trazo mediano de la capa de relieve (Spot 2) a DPI_MEDICION. Con eso escribe en
texturas.json, por textura:

  trazoMm    trazo mediano del relieve a escala 1 en el parche de referencia de 60 mm.
  escalaMin  0,5 x TRAZO_FINO_MM / trazoMm, acotado a [PISO, 0,5] y redondeado a 0,1 hacia arriba.

  - Las finas (trazo como el de Recurso 8 y 10) quedan en 0,5: decision de Santiago (25/09).
  - Las demas bajan hasta que su trazo llega al que tienen las finas a 0,5 (~0,04 mm, un punto del
    relieve a 600 dpi), con piso PISO: 0,2, lo mas chico que se midio (25/09).
  - `escalaMinFija` en texturas.json (a mano) manda sobre la cuenta y el script no la pisa. Hoy:
    textura2 = 1 (decision de Santiago, 25/09): a 0,5 el archivo se parece un 47 % a la trama real,
    como Recurso 8 a 0,2, y desde 0,3 casi desaparece. textura5, con el mismo trazo, a 0,5 da 58 %
    y queda en 0,5 como las otras finas.
  La relacion entre trazos no depende del tamanio del parche (todo escala igual), asi que escalaMin
  es una propiedad de la textura. VOLVER A CORRER si se agrega una textura o cambian sus
  `repeticiones` en texturas.json.

Referencia (25/09, parche del escudo de 6 x 8 cm, 2400 dpi): trazo a 1x Recurso 8 0,079 mm,
Recurso 10 0,074, Recurso 9 0,272, textura-001 0,265, textura-007 0,454.

Uso (desde backend/):
  python python/medir_trazo_texturas.py                 mide todas y actualiza texturas.json
  python python/medir_trazo_texturas.py --dry-run       solo muestra la tabla
  python python/medir_trazo_texturas.py --solo "Recurso 8.svg" textura-001.svg
  python python/medir_trazo_texturas.py --recalcular    recalcula escalaMin con los trazoMm ya medidos
"""
import json
import math
import os
import sys
import tempfile

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import tpu_matriz as tm  # noqa: E402

import pikepdf  # noqa: E402
from scipy import ndimage  # noqa: E402
from skimage.morphology import skeletonize  # noqa: E402

TEXTURAS_DIR = os.path.normpath(os.path.join(AQUI, '..', '..', 'public', 'assets', 'textures'))
PARCHE_MM = 60.0            # ancho del parche de referencia (el mismo de la medicion del 25/09)
DPI_MEDICION = 2400         # 0,0106 mm por punto: el trazo mas fino del catalogo son ~7 puntos
TRAZO_FINO_MM = 0.08        # trazo a 1x de las texturas finas (Recurso 8 y 10) en el parche de referencia
ESCALA_FINAS = 0.5          # minimo de las finas (decision de Santiago, 25/09)
PISO = 0.2                  # nadie baja de aca: lo mas chico que se midio
REPETICIONES_DEFAULT = 2    # espeja REPETICIONES_DEFAULT de webOrdersController.getTexturasTpu


def parche_referencia(carpeta):
    """PDF vectorial con un cuadrado negro de PARCHE_MM, con margen para que no cuente como fondo."""
    import pymupdf as fitz
    lado = PARCHE_MM * tm.PT_POR_MM
    margen = 5 * tm.PT_POR_MM
    doc = fitz.open()
    pg = doc.new_page(width=lado + 2 * margen, height=lado + 2 * margen)
    pg.draw_rect(fitz.Rect(margen, margen, margen + lado, margen + lado), color=None, fill=(0, 0, 0))
    ruta = os.path.join(carpeta, 'parche_referencia.pdf')
    doc.save(ruta)
    doc.close()
    return ruta


def trazo_mm(textura, repeticiones, pdf, seqnos, carpeta):
    """Trazo mediano (mm) del relieve Spot 2 del parche de referencia con la textura a escala 1."""
    job = {
        'pdf': pdf, 'salida_dir': os.path.join(carpeta, 'salida'), 'base': 'medicion',
        'medida_mm': {'ancho': PARCHE_MM, 'alto': PARCHE_MM}, 'sangrado_mm': 1.0,
        'texturas_dir': TEXTURAS_DIR,
        'zonas': [{'indice': 0, 'nombre': 'Todo', 'seqnos': seqnos, 'textura': textura,
                   'repeticiones': repeticiones, 'invertida': None, 'escala': 1.0,
                   'dx': 0.5, 'dy': 0.5, 'doble': True, 'barniz': False}],
        'imposicion': {'cantidad': 1, 'plancha_mm': PARCHE_MM + 20, 'sep_mm': 5, 'sep_filas_mm': 5,
                       'max_alto_mm': 500, 'completar_filas': True},
        'boceto': False, 'vista': False, 'capas': False,
        'spots_raster': True, 'relieve_doble_siempre': True,
    }
    original = tm._capa_raster
    tm._capa_raster = lambda *a, **k: original(*a, **{**k, 'dpi': DPI_MEDICION})
    try:
        res = tm.generar(job)
    finally:
        tm._capa_raster = original
    pdf_imp = pikepdf.open(res['archivos']['impresion'])
    im = pdf_imp.pages[0].Resources.XObject['/ISpot2']
    w, h = int(im.Width), int(im.Height)
    datos = np.frombuffer(im.read_bytes(), dtype=np.uint8)
    if int(im.BitsPerComponent) == 1:
        tinta = np.unpackbits(datos).reshape(h, -1)[:, :w].astype(bool)
    else:
        tinta = datos.reshape(h, w) > 127
    pdf_imp.close()
    if not tinta.any():
        return None
    # ancho en el eje de cada trazo: 2 x distancia al borde - 1 punto
    anchos = (2 * ndimage.distance_transform_edt(tinta)[skeletonize(tinta)] - 1) * 25.4 / DPI_MEDICION
    return float(np.median(anchos))


def escala_min(trazo, entrada):
    if entrada.get('escalaMinFija'):    # decidida a mano: manda sobre la cuenta
        return float(entrada['escalaMinFija'])
    crudo = ESCALA_FINAS * TRAZO_FINO_MM / trazo
    return min(ESCALA_FINAS, max(PISO, math.ceil(round(crudo, 6) * 10) / 10))


def main():
    args = sys.argv[1:]
    dry = '--dry-run' in args
    solo = args[args.index('--solo') + 1:] if '--solo' in args else None
    ruta_json = os.path.join(TEXTURAS_DIR, 'texturas.json')
    with open(ruta_json, encoding='utf-8') as fh:
        catalogo = json.load(fh)
    archivos = sorted(f for f in os.listdir(TEXTURAS_DIR) if f.lower().endswith('.svg'))
    if solo:
        archivos = [f for f in archivos if f in solo]

    if '--recalcular' in args:
        # Sin volver a medir: aplica la regla actual a los trazos ya guardados.
        for archivo in archivos:
            entrada = catalogo.get(archivo) or {}
            if entrada.get('trazoMm'):
                entrada['escalaMin'] = escala_min(float(entrada['trazoMm']), entrada)
                print(f"{archivo:<18} {entrada['trazoMm']:>7.3f} mm {entrada['escalaMin']:>9.1f}", flush=True)
            else:
                print(f"{archivo:<18} sin trazoMm: hay que medirla", flush=True)
        archivos = []

    with tempfile.TemporaryDirectory() as carpeta:
        if archivos:            # con --recalcular no se mide nada
            pdf = parche_referencia(carpeta)
            seqnos = [f['seqno'] for f in tm.analizar(pdf)['formas']]
            print(f"{'textura':<18} {'rep':>5} {'trazo 1x':>9} {'escalaMin':>9}", flush=True)
        for archivo in archivos:
            rep = float((catalogo.get(archivo) or {}).get('repeticiones') or REPETICIONES_DEFAULT)
            try:
                t = trazo_mm(archivo, rep, pdf, seqnos, carpeta)
            except Exception as e:  # noqa
                print(f"{archivo:<18} ERROR: {e}", flush=True)
                continue
            if t is None:
                print(f"{archivo:<18} sin relieve: no se toca", flush=True)
                continue
            entrada = catalogo.setdefault(archivo, {})
            em = escala_min(t, entrada)
            print(f"{archivo:<18} {rep:>5g} {t:>7.3f} mm {em:>9.1f}", flush=True)
            entrada['trazoMm'] = round(t, 3)
            entrada['escalaMin'] = em

    if dry:
        print('dry-run: no se escribio texturas.json')
        return
    with open(ruta_json, 'w', encoding='utf-8', newline='\n') as fh:   # LF, como estaba el archivo
        json.dump(catalogo, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print(f'texturas.json actualizado ({ruta_json})')


if __name__ == '__main__':
    main()
