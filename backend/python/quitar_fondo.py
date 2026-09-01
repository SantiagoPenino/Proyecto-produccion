# -*- coding: utf-8 -*-
"""
quitar_fondo.py — Remueve el fondo de una foto de producto (rembg / U2-Net).

Uso: python quitar_fondo.py <entrada> <salida.png>
Salida: PNG con canal alfa (el conversor del catálogo la compone sobre blanco puro).

Pensado para fotos de PRODUCTO SOBRE FONDO (gorro sobre fondo gris). Para fotos
full-producto (toda la imagen es tela) NO usar: el modelo puede alucinar una silueta
— por eso en el editor es un checkbox opcional, no automático.

Dependencias (una vez, mismo venv que dtf_blanco):
    pip install rembg onnxruntime
La primera corrida descarga el modelo (~170MB) a ~/.u2net/.
"""
import sys


def main():
    if len(sys.argv) != 3:
        print("Uso: quitar_fondo.py <entrada> <salida.png>", file=sys.stderr)
        return 2
    entrada, salida = sys.argv[1], sys.argv[2]
    try:
        from rembg import remove, new_session
    except ImportError as e:
        print(f"rembg no instalado: {e}. Correr: pip install rembg onnxruntime", file=sys.stderr)
        return 3
    try:
        # Modelo EXPLICITO u2net (~170MB): el default de rembg >= 2.0.81 es bria-rmbg (1GB),
        # demasiado pesado para el VPS y su descarga revienta el timeout de la subida.
        # Pre-descarga (una vez): python -c "from rembg import new_session; new_session('u2net')"
        session = new_session("u2net")
        with open(entrada, "rb") as f:
            data = f.read()
        resultado = remove(data, session=session)
        with open(salida, "wb") as f:
            f.write(resultado)
        print("OK")
        return 0
    except Exception as e:
        print(f"Error quitando fondo: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
