# Auditoría "cobro sin movimiento que lo respalde" — 27/7/2026

Barrido post-MoreggiT (PC-2221): deudas en `DeudaDocumento` que figuran
COBRADO/PARCIAL pero cuya suma de movimientos PAGO/PAGO_CRUZADO/ANTICIPO/
CREDITO_PLAN vinculados al documento no cubre lo cobrado. La detección simple
daba ~44; re-corrida el 27/7 sobre la réplica local da **36 documentos**.
Se auditó **uno por uno** contemplando cross-moneda, ANTICIPO_APLICADO,
pagos partidos y movimientos con `DocIdDocumento` NULL o estampado a otro doc.

**Resultado: solo 2 de los 36 tienen de verdad un movimiento ausente.**
El resto: 15 movimientos existentes a los que solo les falta el vínculo,
10 deudas marcadas cobradas SIN plata (hay que revertirlas), 9 falsos
positivos legítimos y 5 casos para revisar a mano.

## Scripts (validados en la réplica local con ROLLBACK — pendientes de correr en PROD)

| Bucket | Script | Qué hace |
|---|---|---|
| A — Solo falta vínculo (11 docs, 15 movs) | `fix_estampar_docid_pagos_deuda.sql` | Estampa `DocIdDocumento` (y 3 `PagIdPago`) en movs PAGO reales que quedaron con doc NULL o el doc equivocado. No cambia saldos. |
| B — Movimiento ausente (2 docs) | `repara_movs_pago_ausentes_et1489_pc2070.sql` | Repone vía `SP_RegistrarMovimiento` los movs de 2 cobros reales de caja que no lo tienen. ⚠ Requiere antes `add_MovFecha_SP_RegistrarMovimiento.sql` en prod. |
| C — Cobro fantasma (10 docs) | `fix_revertir_cobros_fantasma_deudas.sql` | Revierte 10 deudas marcadas cobradas sin ningún cobro que las respalde (vuelven a PENDIENTE y reaparecen para cobrar). |

Orden sugerido en prod: A → B → C (independientes entre sí, pero A y B hacen
que la verificación de cada uno cierre mejor).

## Clasificación doc por doc

### A — LEGÍTIMO, SOLO FALTA VÍNCULO (el pago existe, se estampa el doc)
| Doc | Cliente | Importe | Movs |
|---|---|---|---|
| PC-2056 | Atan | US$ 1.427,68 | 21826 |
| PC-2094 | Adolfo Maidana | $ 15.123,00 | 20324 |
| PC-2071 | Támara flores | $ 14.559,62 | 21600 (+Pag 53999) |
| PC-2072 | Palmero | $ 4.994,54 | 20993 + 20996 |
| PC-2220 | Palmero | $ 12.929,00 | 21640, 21641, 22201, 22204 |
| PC-2074 | Palmero | $ 154,00 | 22200 |
| FA-212 | Gustavo Casas | US$ 328,50 | 21651 |
| PC-2461 | Yesusport | $ 1.881,00 | 22192 (+Pag 54184) |
| PC-2093 | Yesusport | US$ 873,06 | 22184 (+Pag 54182) — bonus: no estaba en los 36 (deuda quedó `VENCIDO` con pendiente 0; el script la deja COBRADO) |
| FA-19 | Favio Curbelo | US$ 461,67 | 20318 (estaba estampado a FA-189) |
| FA-48 | Posse Gutierrez | US$ 1.544,88 | 20986 (estaba estampado a FA-254, cuya deuda sigue viva) |

### B — MOVIMIENTO REALMENTE AUSENTE (cobro real de caja, se repone el mov)
| Doc | Cliente | Importe | Evidencia |
|---|---|---|---|
| ET-1489 | Uniformes vym | US$ 2.926,87 | Tca 3732 + Pago #52938 (13-jul 16:09) existen; ningún mov con ese PagIdPago |
| PC-2070 | Támara flores | US$ 352,84 | Tca 4645 + Pago #54000 (15-jul 14:35); su hermano de sesión (Pago #53999) SÍ generó mov |

### C — COBRO FANTASMA (deuda marcada cobrada sin plata → revertir)
En todos, la "fecha de cobro" coincide al minuto con un pago real del cliente
por OTRA cosa (ya aplicado a su propio doc), y el saldo en vivo confirma que
la plata no entró.
| Doc | Cliente | Revive | Seña |
|---|---|---|---|
| PC-1808 | MARTIN PONTI | US$ 138,04 | saldo vivo −138,04 exacto |
| PC-458 / PC-1018 / PC-2199 | Puntogyf | 32,06 + 33,19 + 65,25 | marcadas en el instante del cobro de PC-2494 (65,25) |
| PC-525 | Yesusport | $ 1.881,00 | el cobro real de 1.881 quedó aplicado a PC-2461 (#7318); si el negocio dice que era para PC-525, mover la aplicación en vez de revertir |
| PC-532 | Yesusport | US$ 675,68 | ningún cobro ese día |
| PC-416 | De Zuasnabar | US$ 9,12 | el pago de 9,12 (mov 21766) fue ANULADO y la deuda no se revirtió |
| PC-2180 | Maxi.C | US$ 6,58 | saldo vivo −1.500,00 exacto |
| PC-1943 | Maximiliano Castro | US$ 29,16 | saldo vivo −1.500,00 exacto |
| FA-58 | Martin Moreira | US$ 54,00 | el pago de 54,00 (mov 21034) fue para DTF-7356 (doc 4670) |

### D — LEGÍTIMO (falso positivo del matcher: cubierto por anticipo / saldo a favor)
El cargo ya debitó la cuenta y el anticipo/saldo la cubre — no corresponde
ningún movimiento PAGO adicional (agregarlo duplicaría el crédito).
| Doc(s) | Cliente | Cobertura |
|---|---|---|
| PC-2047, PC-2055, PC-2086 | Nicolas Rodriguez | anticipo RA-17 US$ 3.000 (14-jul 18:05, mismo instante) |
| PC-1885, PC-1367 | Gerardo Mazzoni | anticipo RC-16 US$ 4.601,22 (6-jul 19:37); saldo vivo hoy +175,82 |
| PC-934, PC-2619, PC-2620 | Design Group | anticipo RC-10 US$ 1.339,08 + saldo a favor (hoy +909,07) |
| FA-6 | Sport Great Sas | saldo a favor USD (hoy +353,30) |

### E — REVISAR A MANO (no tocar todavía)
| Doc | Cliente | Qué pasa |
|---|---|---|
| PC-1387 | CAPA | Cliente con anticipos UYU + plan de metros (CREDITO_PLAN); además la deuda (8.076,19) no coincide con el DocTotal (19.231,28) — patrón "deuda calculada desde costo de órdenes". Requiere reconciliación completa del cliente. |
| PC-1982 | Palmero | Residuo de 449,35 de la saga Palmero (pagos reales 90.807,45 vs deuda cerrada por 91.256,80). Decidir si se condona o se reabre PARCIAL. |
| PC-1137 | Támara flores | Reducción de 750 sin respaldo + deuda original inflada (7.253,05 vs doc 5.241,96). Revertir sin corregir el importe original agranda el error. |
| ET-1805 | Felipe Izquierdo | Doc PAGADO vía flujo online (Tca tipo 08, cobrado 0) sin mov — patrón MercadoPago (igual que Rdssport PC-1971). Ver integración antes de tocar. |
| ET-1811 | Jose Laprovitera | Ídem anterior. |

## Hallazgos colaterales detectados (fuera del alcance, sin script)
- **Doble cobro**: ET-2152 (doc 4074, vym) deuda de 1.221,38 con DOS pagos de
  1.221,38; y doc 4814 (Támara) con deudas duplicadas #7281/#7282 cobradas
  las dos (2 × 17.279,54 — explica el saldo a favor de la cta 1212).
- PC-2220/PC-2461 tienen movs `PAGO_CRUZADO` de cobertura de órdenes
  estampados al doc (por eso su verificación da faltante negativo esperado).
