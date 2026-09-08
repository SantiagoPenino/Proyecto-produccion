# -*- coding: utf-8 -*-
"""
svg_trazos.py — lee un SVG de textura del catalogo TPU y devuelve sus trazados como geometria
plana en coordenadas del viewBox (puntos, origen arriba-izquierda, y hacia abajo).

Por que existe: PyMuPDF (fitz) convierte SVG a PDF pero NO aplica estilos por clase CSS ni
rellenos con <pattern>, que es exactamente como exporta Illustrator las texturas "Recurso N" /
"texturaN": un rectangulo relleno con `url(#Motivo_...)` cuyo dibujo real vive en <defs>. fitz
lo pintaba como un rectangulo negro solido y la zona salia con cobertura 100 % (TPU-20747, 07/09).

Cubre lo que usa el catalogo (barrido 07/09 sobre public/assets/textures):
  - <style> con clases (.cls-1 { fill: #231f20; fill-rule: evenodd; ... }), atributos
    fill / fill-rule / stroke / class / style="..." inline.
  - <path d>, <polygon points>, <polyline points>, <rect>, <circle>, <ellipse>, <line>.
  - transform (matrix / translate / scale / rotate / skewX / skewY) en el elemento y en <g>.
  - <pattern patternUnits="userSpaceOnUse" x y width height viewBox patternTransform>: la forma
    rellena con url(#id) se recorta y adentro se repite el contenido del patron.
  - <clipPath>: se ignora (en estos archivos es el rectangulo del propio viewBox).
  - Comandos de d: M m L l H h V v C c S s Q q T t Z z. Arcos (A a) no aparecen en el catalogo:
    se aproximan con una recta al punto final y se deja aviso.

Salida de `leer_svg(ruta)`:
  {
    "ancho": w, "alto": h,                       # tamanio del tile en unidades del viewBox (pt)
    "figuras": [ { "subpaths": [[("m",x,y), ("l",x,y), ("c",x1,y1,x2,y2,x,y), ("h",)], ...],
                   "even_odd": bool, "clip": [subpaths] | None,  # clip = forma rellena con patron
                   "fill": (r,g,b) } ],
    "avisos": [str],
  }
Todas las figuras devueltas son RELLENOS con tinta (fill distinto de none y no blanco).
Los trazos (stroke) se ignoran: en el catalogo solo aparece un stroke en el rectangulo exterior
de las texturas con patron, que es el borde de la mesa de Illustrator, no parte del dibujo.
"""

import math
import re
import xml.etree.ElementTree as ET

_NUM = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
_CMD = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def _tag(el):
    return el.tag.split("}")[-1] if isinstance(el.tag, str) else ""


# ── matrices afines (a b c d e f), como en SVG/PDF ────────────────────────────

def _mul(m, n):
    """m ∘ n : primero n, despues m (como la concatenacion de transform="m n")."""
    a, b, c, d, e, f = m
    a2, b2, c2, d2, e2, f2 = n
    return (a * a2 + c * b2, b * a2 + d * b2,
            a * c2 + c * d2, b * c2 + d * d2,
            a * e2 + c * f2 + e, b * e2 + d * f2 + f)


def _apl(m, x, y):
    a, b, c, d, e, f = m
    return (a * x + c * y + e, b * x + d * y + f)


def _inv(m):
    a, b, c, d, e, f = m
    det = a * d - b * c
    if abs(det) < 1e-12:
        return (1, 0, 0, 1, 0, 0)
    ia, ib, ic, id_ = d / det, -b / det, -c / det, a / det
    return (ia, ib, ic, id_, -(ia * e + ic * f), -(ib * e + id_ * f))


IDENT = (1, 0, 0, 1, 0, 0)


def parse_transform(texto):
    m = IDENT
    if not texto:
        return m
    for nombre, args in re.findall(r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)", texto):
        v = [float(x) for x in _NUM.findall(args)]
        if nombre == "matrix" and len(v) == 6:
            t = tuple(v)
        elif nombre == "translate":
            t = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif nombre == "scale":
            t = (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
        elif nombre == "rotate":
            r = math.radians(v[0])
            rot = (math.cos(r), math.sin(r), -math.sin(r), math.cos(r), 0, 0)
            if len(v) > 2:
                t = _mul(_mul((1, 0, 0, 1, v[1], v[2]), rot), (1, 0, 0, 1, -v[1], -v[2]))
            else:
                t = rot
        elif nombre == "skewX":
            t = (1, 0, math.tan(math.radians(v[0])), 1, 0, 0)
        elif nombre == "skewY":
            t = (1, math.tan(math.radians(v[0])), 0, 1, 0, 0)
        else:
            continue
        m = _mul(m, t)
    return m


# ── estilos ──────────────────────────────────────────────────────────────────

def _parse_css(texto):
    reglas = {}
    for sel, cuerpo in re.findall(r"([^{}]+)\{([^}]*)\}", texto or ""):
        props = {}
        for k, v in re.findall(r"([\w-]+)\s*:\s*([^;]+)", cuerpo):
            props[k.strip()] = v.strip()
        for s in sel.split(","):
            s = s.strip()
            if s.startswith("."):
                reglas.setdefault(s[1:], {}).update(props)
    return reglas


def _color(v):
    """'#rgb' / '#rrggbb' / 'rgb(...)' / nombre basico -> (r,g,b) 0..1; None si no hay color."""
    if v is None:
        return None
    v = v.strip()
    if not v or v == "none" or v.startswith("url("):
        return None
    if v.startswith("#"):
        h = v[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) >= 6:
            try:
                return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
            except ValueError:
                return None
    m = re.match(r"rgb\(\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*\)", v)
    if m:
        vals = [float(x) for x in m.groups()]
        return tuple((x / 100 if "%" in v else x / 255) for x in vals)
    basicos = {"black": (0, 0, 0), "white": (1, 1, 1), "red": (1, 0, 0), "gray": (.5, .5, .5), "grey": (.5, .5, .5)}
    return basicos.get(v.lower())


class _Estilo:
    def __init__(self, css):
        self.css = css

    def de(self, el, heredado):
        props = dict(heredado)
        for cls in (el.get("class") or "").split():
            props.update(self.css.get(cls, {}))
        for k in ("fill", "fill-rule", "stroke", "opacity", "fill-opacity"):
            if el.get(k) is not None:
                props[k] = el.get(k)
        for k, v in re.findall(r"([\w-]+)\s*:\s*([^;]+)", el.get("style") or ""):
            props[k.strip()] = v.strip()
        return props


# ── geometria: cada forma -> subpaths con operadores m/l/c/h ─────────────────

def _path_d(d):
    """Parser de `d`. Devuelve subpaths: listas de tuplas ('m',x,y) ('l',x,y) ('c',...) ('h',)."""
    toks = _CMD.findall(d or "")
    subs, cur = [], []
    x = y = 0.0
    sx = sy = 0.0
    px = py = None            # ultimo punto de control (para S/T)
    cmd = None
    i = 0
    avisos = []

    def num():
        nonlocal i
        v = float(toks[i]); i += 1
        return v

    def cerrar():
        nonlocal cur, x, y
        if cur:
            cur.append(("h",))
            subs.append(cur)
            cur = []
        x, y = sx, sy

    while i < len(toks):
        t = toks[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t; i += 1
            if cmd in "Zz":
                cerrar(); px = py = None
                continue
        if cmd is None:
            i += 1; continue
        rel = cmd.islower()
        c = cmd.upper()
        try:
            if c == "M":
                nx, ny = num(), num()
                if rel: nx += x; ny += y
                if cur:
                    subs.append(cur)
                cur = [("m", nx, ny)]
                x, y = nx, ny; sx, sy = nx, ny
                cmd = "l" if rel else "L"       # coordenadas siguientes = lineto implicito
                px = py = None
            elif c == "L":
                nx, ny = num(), num()
                if rel: nx += x; ny += y
                cur.append(("l", nx, ny)); x, y = nx, ny; px = py = None
            elif c == "H":
                nx = num()
                if rel: nx += x
                cur.append(("l", nx, y)); x = nx; px = py = None
            elif c == "V":
                ny = num()
                if rel: ny += y
                cur.append(("l", x, ny)); y = ny; px = py = None
            elif c == "C":
                x1, y1, x2, y2, nx, ny = num(), num(), num(), num(), num(), num()
                if rel: x1 += x; y1 += y; x2 += x; y2 += y; nx += x; ny += y
                cur.append(("c", x1, y1, x2, y2, nx, ny)); px, py = x2, y2; x, y = nx, ny
            elif c == "S":
                x2, y2, nx, ny = num(), num(), num(), num()
                if rel: x2 += x; y2 += y; nx += x; ny += y
                x1, y1 = (2 * x - px, 2 * y - py) if px is not None else (x, y)
                cur.append(("c", x1, y1, x2, y2, nx, ny)); px, py = x2, y2; x, y = nx, ny
            elif c == "Q":
                qx, qy, nx, ny = num(), num(), num(), num()
                if rel: qx += x; qy += y; nx += x; ny += y
                c1 = (x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y))
                c2 = (nx + 2 / 3 * (qx - nx), ny + 2 / 3 * (qy - ny))
                cur.append(("c", c1[0], c1[1], c2[0], c2[1], nx, ny)); px, py = qx, qy; x, y = nx, ny
            elif c == "T":
                nx, ny = num(), num()
                if rel: nx += x; ny += y
                qx, qy = (2 * x - px, 2 * y - py) if px is not None else (x, y)
                c1 = (x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y))
                c2 = (nx + 2 / 3 * (qx - nx), ny + 2 / 3 * (qy - ny))
                cur.append(("c", c1[0], c1[1], c2[0], c2[1], nx, ny)); px, py = qx, qy; x, y = nx, ny
            elif c == "A":
                _rx, _ry, _rot, _la, _sw, nx, ny = num(), num(), num(), num(), num(), num(), num()
                if rel: nx += x; ny += y
                cur.append(("l", nx, ny)); x, y = nx, ny; px = py = None
                avisos.append("arco aproximado por recta")
            else:
                i += 1
        except (IndexError, ValueError):
            break
    if cur:
        subs.append(cur)
    return subs, avisos


def _poly(points, cerrar):
    v = [float(t) for t in _NUM.findall(points or "")]
    pts = list(zip(v[0::2], v[1::2]))
    if len(pts) < 2:
        return []
    sub = [("m", pts[0][0], pts[0][1])] + [("l", x, y) for x, y in pts[1:]]
    if cerrar:
        sub.append(("h",))
    return [sub]


def _rect(el):
    x, y = float(el.get("x", 0)), float(el.get("y", 0))
    w, h = float(el.get("width", 0)), float(el.get("height", 0))
    if w <= 0 or h <= 0:
        return []
    return [[("m", x, y), ("l", x + w, y), ("l", x + w, y + h), ("l", x, y + h), ("h",)]]


def _elipse(cx, cy, rx, ry):
    k = 0.5522847498
    return [[("m", cx + rx, cy),
             ("c", cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry),
             ("c", cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy),
             ("c", cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry),
             ("c", cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy), ("h",)]]


def _geometria(el):
    t = _tag(el)
    if t == "path":
        return _path_d(el.get("d"))
    if t == "polygon":
        return _poly(el.get("points"), True), []
    if t == "polyline":
        return _poly(el.get("points"), False), []
    if t == "rect":
        return _rect(el), []
    if t == "circle":
        r = float(el.get("r", 0))
        return _elipse(float(el.get("cx", 0)), float(el.get("cy", 0)), r, r), []
    if t == "ellipse":
        return _elipse(float(el.get("cx", 0)), float(el.get("cy", 0)), float(el.get("rx", 0)), float(el.get("ry", 0))), []
    if t == "line":
        return [[("m", float(el.get("x1", 0)), float(el.get("y1", 0))), ("l", float(el.get("x2", 0)), float(el.get("y2", 0)))]], []
    return [], []


def _transformar(subpaths, m):
    out = []
    for sub in subpaths:
        ns = []
        for op in sub:
            if op[0] == "h":
                ns.append(op)
            elif op[0] == "c":
                a = _apl(m, op[1], op[2]); b = _apl(m, op[3], op[4]); c = _apl(m, op[5], op[6])
                ns.append(("c", a[0], a[1], b[0], b[1], c[0], c[1]))
            else:
                p = _apl(m, op[1], op[2])
                ns.append((op[0], p[0], p[1]))
        out.append(ns)
    return out


def _bbox(subpaths):
    xs, ys = [], []
    for sub in subpaths:
        for op in sub:
            if op[0] == "h":
                continue
            xs.extend(op[1::2]); ys.extend(op[2::2])
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


# ── lectura ──────────────────────────────────────────────────────────────────

def leer_svg(ruta):
    raiz = ET.parse(ruta).getroot()
    avisos = []
    css = {}
    for st in raiz.iter():
        if _tag(st) == "style" and st.text:
            css.update(_parse_css(st.text))
    estilo = _Estilo(css)

    vb = [float(v) for v in _NUM.findall(raiz.get("viewBox") or "")]
    if len(vb) != 4:
        w = float(_NUM.search(raiz.get("width") or "0").group()) if raiz.get("width") else 0
        h = float(_NUM.search(raiz.get("height") or "0").group()) if raiz.get("height") else 0
        vb = [0, 0, w, h]
    vx, vy, vw, vh = vb
    if vw <= 0 or vh <= 0:
        raise ValueError("El SVG no tiene viewBox ni tamanio.")

    # patrones y clips definidos (por id)
    patrones = {}
    for el in raiz.iter():
        if _tag(el) == "pattern" and el.get("id"):
            patrones[el.get("id")] = el

    figuras = []

    def es_tinta(color):
        if color is None:
            return False
        lum = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]
        return lum < 0.5

    def recorrer(el, m, heredado, en_defs):
        t = _tag(el)
        if t in ("defs", "style", "clipPath", "mask", "marker", "symbol", "pattern", "title", "desc", "metadata"):
            return
        props = estilo.de(el, heredado)
        m_el = _mul(m, parse_transform(el.get("transform")))
        if t in ("g", "svg", "a", "switch"):
            for hijo in el:
                recorrer(hijo, m_el, props, en_defs)
            return
        subs, av = _geometria(el)
        avisos.extend(av)
        if not subs:
            return
        subs = _transformar(subs, m_el)
        fill = props.get("fill", "#000000")     # default SVG: negro
        even_odd = (props.get("fill-rule", "nonzero") == "evenodd")
        if fill and fill.strip().startswith("url("):
            pid = re.search(r"url\(#([^)]+)\)", fill)
            pat = patrones.get(pid.group(1)) if pid else None
            if pat is None:
                avisos.append("relleno con url() desconocido: se ignora")
                return
            figuras.extend(_expandir_patron(pat, subs, even_odd, m_el, estilo, props, es_tinta, avisos))
            return
        color = _color(fill)
        if not es_tinta(color):
            return                              # fill none / blanco / claro: no es relieve
        figuras.append({"subpaths": subs, "even_odd": even_odd, "clip": None, "fill": color})

    recorrer(raiz, (1, 0, 0, 1, -vx, -vy), {}, False)
    return {"ancho": vw, "alto": vh, "figuras": figuras, "avisos": sorted(set(avisos))}


def _expandir_patron(pat, forma_subs, forma_even_odd, m_forma, estilo, props_forma, es_tinta, avisos):
    """La forma rellena con el patron se vuelve CLIP; adentro se repite el contenido del patron."""
    if (pat.get("patternUnits") or "objectBoundingBox") != "userSpaceOnUse":
        avisos.append("patron en objectBoundingBox: aproximado como userSpaceOnUse")
    px, py = float(pat.get("x", 0)), float(pat.get("y", 0))
    pw, ph = float(pat.get("width", 0)), float(pat.get("height", 0))
    if pw <= 0 or ph <= 0:
        return []
    pvb = [float(v) for v in _NUM.findall(pat.get("viewBox") or "")]
    if len(pvb) == 4 and pvb[2] > 0 and pvb[3] > 0:
        contenido = _mul((pw / pvb[2], 0, 0, ph / pvb[3], 0, 0), (1, 0, 0, 1, -pvb[0], -pvb[1]))
    else:
        contenido = IDENT
    m_pat = parse_transform(pat.get("patternTransform"))

    # geometria del contenido del patron (una celda, en coordenadas de patron)
    celda = []

    def rec(el, m, heredado):
        t = _tag(el)
        if t in ("style", "title", "desc"):
            return
        props = estilo.de(el, heredado)
        m_el = _mul(m, parse_transform(el.get("transform")))
        if t in ("g", "pattern", "a"):
            for hijo in el:
                rec(hijo, m_el, props)
            return
        subs, av = _geometria(el)
        avisos.extend(av)
        if not subs:
            return
        fill = props.get("fill", "#000000")
        if fill and fill.strip().startswith("url("):
            avisos.append("patron anidado: se ignora")
            return
        color = _color(fill)
        if not es_tinta(color):
            return
        celda.append({"subpaths": _transformar(subs, m_el), "even_odd": props.get("fill-rule", "nonzero") == "evenodd", "fill": color})

    rec(pat, contenido, {})
    if not celda:
        return []

    # celdas necesarias: bbox de la forma llevado al espacio del patron
    bb = _bbox(forma_subs)
    if bb is None:
        return []
    inv = _inv(m_pat)
    esquinas = [_apl(inv, bb[0], bb[1]), _apl(inv, bb[2], bb[1]), _apl(inv, bb[2], bb[3]), _apl(inv, bb[0], bb[3])]
    xs = [p[0] for p in esquinas]; ys = [p[1] for p in esquinas]
    i0 = int(math.floor((min(xs) - px) / pw)) - 1
    i1 = int(math.ceil((max(xs) - px) / pw)) + 1
    j0 = int(math.floor((min(ys) - py) / ph)) - 1
    j1 = int(math.ceil((max(ys) - py) / ph)) + 1
    if (i1 - i0) * (j1 - j0) > 4000:
        avisos.append("patron con demasiadas celdas: se limita")
        i1 = i0 + 60; j1 = j0 + 60

    figuras = []
    # Cada celda muestra SOLO su ventana [0,w]x[0,h] (overflow oculto, como en SVG): el dibujo del
    # patron desborda la celda (Recurso 9: la celda es 306x308 y el contenido va de -77 a 385) y
    # ese desborde lo tapa la celda vecina. Sin el recorte, los desbordes se superponian: en la
    # textura directa engrosaban las costuras y en la invertida (par-impar) quedaban en negro.
    for j in range(j0, j1):
        for i in range(i0, i1):
            m_celda = _mul(m_pat, (1, 0, 0, 1, px + i * pw, py + j * ph))
            # Ventana con 0,05 pt de solape hacia afuera: dos clips exactamente adyacentes dejan una
            # costura antialiasada de un pixel entre celdas (se veia como lineas claras en la textura
            # invertida). El solape se pinta dos veces, que es lo mismo que una.
            e = 0.05
            ventana = _transformar([[("m", -e, -e), ("l", pw + e, -e), ("l", pw + e, ph + e), ("l", -e, ph + e), ("h",)]], m_celda)
            vb_ = _bbox(ventana)
            if vb_[2] < bb[0] or vb_[0] > bb[2] or vb_[3] < bb[1] or vb_[1] > bb[3]:
                continue                                    # la celda no toca la forma
            for f in celda:
                subs = _transformar(f["subpaths"], m_celda)
                # Solo lo que toca la ventana de su celda (lo demas lo pinta la celda vecina) y la
                # forma rellena; en texturas densas (Recurso 10: 2.747 trazados por celda) esto
                # es lo que mantiene el archivo en un tamanio razonable.
                fb = _bbox(subs)
                if fb is None or fb[2] < vb_[0] or fb[0] > vb_[2] or fb[3] < vb_[1] or fb[1] > vb_[3]:
                    continue
                if fb[2] < bb[0] or fb[0] > bb[2] or fb[3] < bb[1] or fb[1] > bb[3]:
                    continue
                figuras.append({"subpaths": subs, "even_odd": f["even_odd"],
                                "clip": (forma_subs, forma_even_odd), "celda": ventana, "fill": f["fill"]})
    return figuras


# ── utilidades para el generador ─────────────────────────────────────────────

def _f(v):
    s = f"{float(v):.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def ops_pdf(subpaths, T):
    """Subpaths -> operadores de construccion de path PDF. T(x, y) -> (X, Y) destino."""
    out = []
    for sub in subpaths:
        for op in sub:
            if op[0] == "m":
                X, Y = T(op[1], op[2]); out.append(f"{_f(X)} {_f(Y)} m")
            elif op[0] == "l":
                X, Y = T(op[1], op[2]); out.append(f"{_f(X)} {_f(Y)} l")
            elif op[0] == "c":
                a = T(op[1], op[2]); b = T(op[3], op[4]); c = T(op[5], op[6])
                out.append(f"{_f(a[0])} {_f(a[1])} {_f(b[0])} {_f(b[1])} {_f(c[0])} {_f(c[1])} c")
            elif op[0] == "h":
                out.append("h")
    return "\n".join(out)


def contenido_tile(svg, invertir=False):
    """Content stream (sin color) que pinta la TINTA del tile en coordenadas PDF del tile
    (origen abajo-izquierda). Con `invertir`, pinta el complemento: rectangulo del tile XOR figuras
    (regla par-impar) — es lo que hace el visor cuando el dibujo oscuro es mayoria."""
    w, h = svg["ancho"], svg["alto"]

    def T(x, y):
        return x, h - y

    partes = []
    # Figuras sueltas (sin patron) y figuras de patron agrupadas por celda (misma lista `celda`).
    sueltas = [f for f in svg["figuras"] if not f.get("celda")]
    grupos = []
    for f in svg["figuras"]:
        if not f.get("celda"):
            continue
        if grupos and grupos[-1][0] is f["celda"]:
            grupos[-1][1].append(f)
        else:
            grupos.append((f["celda"], [f]))

    def clips(fig):
        partes.append(ops_pdf(fig["clip"][0], T))
        partes.append("W* n" if fig["clip"][1] else "W n")
        partes.append(ops_pdf(fig["celda"], T))
        partes.append("W n")

    if not invertir:
        for fig in sueltas:
            partes.append(ops_pdf(fig["subpaths"], T))
            partes.append("f*" if fig["even_odd"] else "f")
        for ventana, figs in grupos:
            partes.append("q")
            clips(figs[0])
            for fig in figs:
                partes.append(ops_pdf(fig["subpaths"], T))
                partes.append("f*" if fig["even_odd"] else "f")
            partes.append("Q")
        return "\n".join(partes)

    # COMPLEMENTO (textura invertida: sube el fondo).
    # Sueltas: un compuesto par-impar rectangulo del tile + figuras.
    if sueltas:
        partes.append(f"0 0 {_f(w)} {_f(h)} re")
        for fig in sueltas:
            partes.append(ops_pdf(fig["subpaths"], T))
        partes.append("f*")
    # Patron: por celda, dentro de su ventana, ventana XOR figuras de la celda. Las ventanas no se
    # superponen, asi que los complementos tampoco (sin esto el XOR global dejaba en negro los
    # desbordes superpuestos de celdas vecinas).
    for ventana, figs in grupos:
        partes.append("q")
        clips(figs[0])
        partes.append(ops_pdf(ventana, T))
        for fig in figs:
            partes.append(ops_pdf(fig["subpaths"], T))
        partes.append("f*")
        partes.append("Q")
    return "\n".join(partes)
