# -*- coding: utf-8 -*-
"""
_tope_memoria.py — tope de memoria para los scripts que lanza el backend (23/10/2026).

El 21 y el 22/10 un python llego a 12-13,6 GB y el OOM killer del VPS lo mato; el backend se
cayo con el. El backend (utils/topeMemoriaPython.js) calcula cuanto puede usar el script segun
la memoria libre del momento y lo pasa en PY_MAX_MEM_MB; aca se aplica con RLIMIT_DATA. Si el
script lo necesita, falla SOLO el con MemoryError (cada script lo devuelve como su error normal,
"sin memoria suficiente para procesarlo") en vez de que el sistema mate a otro proceso.

Mismo mecanismo que dtf_blanco.py (DTF_BLANCO_MAX_MEM_MB, verificado en el VPS el 23/10).
RLIMIT_DATA y no RLIMIT_AS: desde Linux 4.7 cuenta la memoria PRIVADA (los arrays de numpy), no
las librerias mapeadas ni el espacio que reservan sin usar, que con RLIMIT_AS frenaban archivos
chicos. Solo Linux: en Windows no hay `resource` y no se hace nada.

Uso (al principio del script; si el modulo no esta, el script corre sin tope, como antes):
    try:
        import _tope_memoria
    except ImportError:
        _tope_memoria = None
    ...
    if _tope_memoria:
        _tope_memoria.aplicar()
y el script atrapa MemoryError y lo devuelve como su error de siempre (JSON, stderr, codigo).
Los scripts de fuera de python/ (scripts/, scripts/preflight/) lo buscan agregando esta carpeta
al final de sys.path.
"""
import os
import sys

VARIABLE = "PY_MAX_MEM_MB"


def aplicar():
    """Pone el tope de PY_MAX_MEM_MB (MB). Devuelve el tope en bytes, o None si no se puso."""
    tope_mb = os.environ.get(VARIABLE)
    if not tope_mb:
        return None
    try:
        import resource
    except ImportError:         # Windows: sin tope
        return None
    try:
        tope = int(float(tope_mb)) * 1024 * 1024
        if tope <= 0:
            return None
        # Sin root no se puede subir el maximo que ya tenga el proceso: no pedir mas que eso
        _, duro = resource.getrlimit(resource.RLIMIT_DATA)
        if duro != resource.RLIM_INFINITY:
            tope = min(tope, duro)
        resource.setrlimit(resource.RLIMIT_DATA, (tope, tope))
        return tope
    except (ValueError, OSError) as e:
        print(f"aviso: no se pudo poner el tope de memoria ({e})", file=sys.stderr)
        return None
