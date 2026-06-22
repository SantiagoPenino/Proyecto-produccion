#!/usr/bin/env python3
"""
IGUALADOR DE COLOR - dado un Lab objetivo, calcula:
  Camino A: CMYK de SALIDA (para definir como color spot/nombrado en el RIP)
  Camino B: CMYK de ENTRADA en el perfil del cliente (ej. SWOP) para flujo normal
Con chequeo de gama en ambos perfiles y Delta E 2000 de verificacion.

USO:
  python3 igualador_color.py --lab 55 25 -30
  python3 igualador_color.py --lab 55 25 -30 --entrada /ruta/SWOP.icc --salida /ruta/miperfil.icc
  python3 igualador_color.py --lab 55 25 -30 --json
"""
import subprocess, math, argparse, sys, json

DEFAULT_ENTRADA="/mnt/user-data/uploads/uswebcoatedswop.icc"
DEFAULT_SALIDA ="/mnt/user-data/uploads/fedar8H_XinF_50g_dryR__V360x1200_2Pass_.icc"

def cmyk_to_lab(prof,c,m,y,k,intent=1):
    r=subprocess.run(["transicc","-i",prof,"-o","*Lab","-t",str(intent),"-n"],
        input=f"{c} {m} {y} {k}\n",capture_output=True,text=True)
    for l in r.stdout.strip().splitlines():
        p=l.split()
        if len(p)==3: return tuple(float(x) for x in p)
    return None

def lab_to_cmyk(prof,L,a,b,intent=1):
    r=subprocess.run(["transicc","-i","*Lab","-o",prof,"-t",str(intent),"-n"],
        input=f"{L} {a} {b}\n",capture_output=True,text=True)
    for l in r.stdout.strip().splitlines():
        p=l.split()
        if len(p)==4: return tuple(float(x) for x in p)
    return None

def de2000(lab1,lab2):
    L1,a1,b1=lab1;L2,a2,b2=lab2;kL=kC=kH=1
    C1=math.hypot(a1,b1);C2=math.hypot(a2,b2);Cbar=(C1+C2)/2
    G=0.5*(1-math.sqrt(Cbar**7/(Cbar**7+25**7))) if Cbar>0 else 0
    a1p=(1+G)*a1;a2p=(1+G)*a2;C1p=math.hypot(a1p,b1);C2p=math.hypot(a2p,b2)
    h1p=math.degrees(math.atan2(b1,a1p))%360;h2p=math.degrees(math.atan2(b2,a2p))%360
    dLp=L2-L1;dCp=C2p-C1p;dhp=h2p-h1p
    if abs(dhp)>180: dhp-=360*(1 if dhp>0 else -1)
    dHp=2*math.sqrt(C1p*C2p)*math.sin(math.radians(dhp)/2)
    Lbp=(L1+L2)/2;Cbp=(C1p+C2p)/2;hbp=(h1p+h2p)/2
    if abs(h1p-h2p)>180: hbp+=180
    T=(1-0.17*math.cos(math.radians(hbp-30))+0.24*math.cos(math.radians(2*hbp))
       +0.32*math.cos(math.radians(3*hbp+6))-0.20*math.cos(math.radians(4*hbp-63)))
    dT=30*math.exp(-((hbp-275)/25)**2)
    Rc=2*math.sqrt(Cbp**7/(Cbp**7+25**7))
    Sl=1+(0.015*(Lbp-50)**2)/math.sqrt(20+(Lbp-50)**2)
    Sc=1+0.045*Cbp;Sh=1+0.015*Cbp*T;Rt=-math.sin(math.radians(2*dT))*Rc
    return math.sqrt((dLp/(kL*Sl))**2+(dCp/(kC*Sc))**2+(dHp/(kH*Sh))**2
                     +Rt*(dCp/(kC*Sc))*(dHp/(kH*Sh)))

def gama_msg(de):
    if de<1: return "EN GAMA - igualacion excelente (DE<1, imperceptible)"
    if de<2: return "EN GAMA - muy buena (DE<2, apenas perceptible)"
    if de<3.5:return "EN GAMA - aceptable (DE<3.5, perceptible pero usable)"
    if de<5: return "LIMITE - al borde de la gama (DE<5, diferencia visible)"
    return "FUERA DE GAMA - no se puede igualar (DE>5, color inalcanzable)"

def evaluar(target, prof_entrada, prof_salida, as_json=False):
    L,a,b=target

    result = {
        "objetivo": {"L": L, "a": a, "b": b},
        "caminoA": None,
        "caminoB": None,
        "recomendacion": None
    }

    # --- CAMINO A ---
    salida=lab_to_cmyk(prof_salida,L,a,b)
    de=None
    if salida:
        lab_real=cmyk_to_lab(prof_salida,*salida)
        de=de2000(target,lab_real)
        result["caminoA"]={
            "cmyk":{"C":round(salida[0]),"M":round(salida[1]),"Y":round(salida[2]),"K":round(salida[3])},
            "labReal":{"L":round(lab_real[0],1),"a":round(lab_real[1],1),"b":round(lab_real[2],1)},
            "deltaE":round(de,2),
            "mensaje":gama_msg(de),
            "enGama":de<5
        }

    # --- CAMINO B ---
    entrada=lab_to_cmyk(prof_entrada,L,a,b)
    de_ent=None
    if entrada:
        lab_sig=cmyk_to_lab(prof_entrada,*entrada)
        de_ent=de2000(target,lab_sig)
        result["caminoB"]={
            "cmyk":{"C":round(entrada[0]),"M":round(entrada[1]),"Y":round(entrada[2]),"K":round(entrada[3])},
            "labReal":{"L":round(lab_sig[0],1),"a":round(lab_sig[1],1),"b":round(lab_sig[2],1)},
            "deltaE":round(de_ent,2),
            "mensaje":gama_msg(de_ent),
            "enGama":de_ent<5,
            "viable":de_ent<5
        }

    # --- RECOMENDACION ---
    if salida and entrada and de is not None and de_ent is not None:
        if de<5 and de_ent<5:
            result["recomendacion"]="Ambos caminos viables. Usar Camino B (CMYK entrada) si el cliente trabaja en su perfil; Camino A (spot) para maxima fidelidad."
        elif de<5 and de_ent>=5:
            result["recomendacion"]="Solo Camino A (spot): el color esta en tu gama pero no en la del perfil de entrada del cliente."
        elif de>=5:
            result["recomendacion"]="El color esta fuera de la gama de tu impresora. No es igualable."
    elif salida and de is not None and de<5:
        result["recomendacion"]="Solo Camino A disponible."

    if as_json:
        print(json.dumps(result))
        return

    # Salida de texto (uso CLI)
    print("="*64)
    print(f"COLOR OBJETIVO (medido en la tela del cliente): Lab {L} {a} {b}")
    print("="*64)

    print("\n[ CAMINO A ] Color con nombre / spot  (maxima precision)")
    if result["caminoA"]:
        ca=result["caminoA"]
        print(f"  CMYK de SALIDA (definir como spot en el RIP):")
        print(f"     C={ca['cmyk']['C']}  M={ca['cmyk']['M']}  Y={ca['cmyk']['Y']}  K={ca['cmyk']['K']}")
        print(f"  Color que realmente saldria: Lab {(ca['labReal']['L'],ca['labReal']['a'],ca['labReal']['b'])}")
        print(f"  Delta E 2000: {ca['deltaE']}  ->  {ca['mensaje']}")
    else:
        print("  No se pudo invertir el perfil de salida.")

    print("\n[ CAMINO B ] CMYK de entrada para cliente que trabaja en su perfil")
    if result["caminoB"]:
        cb=result["caminoB"]
        print(f"  CMYK de ENTRADA (el cliente lo pone en su documento):")
        print(f"     C={cb['cmyk']['C']}  M={cb['cmyk']['M']}  Y={cb['cmyk']['Y']}  K={cb['cmyk']['K']}")
        print(f"  Ese CMYK en el perfil de entrada significa: Lab {(cb['labReal']['L'],cb['labReal']['a'],cb['labReal']['b'])}")
        print(f"  Delta E 2000 (gama del perfil de entrada): {cb['deltaE']}")
        if cb['viable']:
            print(f"  -> El color CABE en el perfil de entrada. Camino B viable.")
        else:
            print(f"  -> ATENCION: el color NO cabe en el perfil de entrada (DE {cb['deltaE']}).")
    else:
        print("  No se pudo invertir el perfil de entrada.")

    print("\n[ RECOMENDACION ]")
    if result["recomendacion"]:
        print(f"  {result['recomendacion']}")
    print("="*64)

if __name__=="__main__":
    ap=argparse.ArgumentParser(description="Igualador de color Lab->CMYK con chequeo de gama")
    ap.add_argument("--lab",nargs=3,type=float,required=True,metavar=("L","a","b"),
                    help="Lab objetivo medido en la tela")
    ap.add_argument("--entrada",default=DEFAULT_ENTRADA,help="perfil ICC de entrada (cliente)")
    ap.add_argument("--salida",default=DEFAULT_SALIDA,help="perfil ICC de salida (tu impresora)")
    ap.add_argument("--json",action="store_true",dest="as_json",help="output JSON estructurado")
    args=ap.parse_args()
    evaluar(tuple(args.lab),args.entrada,args.salida,args.as_json)
