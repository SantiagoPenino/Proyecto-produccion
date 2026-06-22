#!/usr/bin/env python3
"""
Calibración de color por foto.

Lee de STDIN un JSON:
  { "patches": [ {"rgb":[r,g,b], "lab":[L,a,b]}, ... ], "sample_rgb":[r,g,b] }

Ajusta por mínimos cuadrados una transformación  RGB_capturado -> LAB_real  usando
los parches de la chart (rgb medido en la foto vs lab medido con espectro), y la
aplica a la muestra. Devuelve el LAB calibrado + el error medio del ajuste (dE2000),
que sirve como indicador de calidad de la foto.
"""
import sys, json, math
import numpy as np


def poly_features(r, g, b):
    # Términos cuadráticos con cruces (10 términos)
    return [1.0, r, g, b, r * r, g * g, b * b, r * g, r * b, g * b]


def de2000(lab1, lab2):
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    kL = kC = kH = 1
    C1 = math.hypot(a1, b1); C2 = math.hypot(a2, b2); Cbar = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7))) if Cbar > 0 else 0
    a1p = (1 + G) * a1; a2p = (1 + G) * a2
    C1p = math.hypot(a1p, b1); C2p = math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dLp = L2 - L1; dCp = C2p - C1p; dhp = h2p - h1p
    if abs(dhp) > 180:
        dhp -= 360 * (1 if dhp > 0 else -1)
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp) / 2)
    Lbp = (L1 + L2) / 2; Cbp = (C1p + C2p) / 2; hbp = (h1p + h2p) / 2
    if abs(h1p - h2p) > 180:
        hbp += 180
    T = (1 - 0.17 * math.cos(math.radians(hbp - 30)) + 0.24 * math.cos(math.radians(2 * hbp))
         + 0.32 * math.cos(math.radians(3 * hbp + 6)) - 0.20 * math.cos(math.radians(4 * hbp - 63)))
    dT = 30 * math.exp(-((hbp - 275) / 25) ** 2)
    Rc = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + (0.015 * (Lbp - 50) ** 2) / math.sqrt(20 + (Lbp - 50) ** 2)
    Sc = 1 + 0.045 * Cbp; Sh = 1 + 0.015 * Cbp * T
    Rt = -math.sin(math.radians(2 * dT)) * Rc
    return math.sqrt((dLp / (kL * Sl)) ** 2 + (dCp / (kC * Sc)) ** 2 + (dHp / (kH * Sh)) ** 2
                     + Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)))


def main():
    data = json.load(sys.stdin)
    patches = data["patches"]
    sample = data["sample_rgb"]
    n = len(patches)

    # Cuadrático si hay parches suficientes; lineal si son pocos (más robusto al ruido).
    quad = n >= 10

    def feat(rgb):
        r, g, b = [c / 255.0 for c in rgb]
        f = poly_features(r, g, b)
        return f if quad else f[:4]

    X = np.array([feat(p["rgb"]) for p in patches])
    Y = np.array([p["lab"] for p in patches], dtype=float)

    beta, *_ = np.linalg.lstsq(X, Y, rcond=None)

    sample_lab = (np.array(feat(sample)) @ beta).tolist()

    # Error del ajuste: dE2000 medio entre LAB predicho y medido en los parches.
    pred = X @ beta
    errs = [de2000(Y[i].tolist(), pred[i].tolist()) for i in range(n)]
    mean_err = sum(errs) / len(errs)

    print(json.dumps({
        "lab": {
            "L": round(float(sample_lab[0]), 2),
            "a": round(float(sample_lab[1]), 2),
            "b": round(float(sample_lab[2]), 2),
        },
        "fitError": round(float(mean_err), 2),
        "model": "cuadratico" if quad else "lineal",
        "n": n,
    }))


if __name__ == "__main__":
    main()
