# Spec 32 — Plan de Construcción (to-be)

> En qué orden se construye el sistema nuevo y por qué ese orden. Principios: (1) la
> plataforma transversal se construye ANTES que el negocio, porque es lo que el sistema
> viejo nunca tuvo y lo que evita repetirlo; (2) cada etapa termina en algo **verificable
> de punta a punta**, no en "avance porcentual"; (3) el orden de los módulos de negocio
> sigue la cadena del valor: lo que genera plata primero.

## 0. Prerrequisitos (antes de la primera línea)

1. Repo nuevo creado (separado del actual), con las specs convertidas a **lenguaje
   greenfield** (normativa + rationale separados) — el actual queda solo-mantenimiento.
2. ADRs fundacionales decididas (Spec 16 §8): lenguaje, framework, ORM, base, colas,
   hosting. Criterio sugerido: aburrido y probado gana a novedoso.
3. Glosario (Spec 00) y estrategia de pruebas (Spec 24) leídos por todo constructor
   (humano o agente) antes de tocar código.

## Etapa 1 — La plataforma (el esqueleto transversal)

Módulos: Seguridad (12) + Trazabilidad (13) + Motor de estados (14) + Errores (15) +
base de la arquitectura (16: módulos, capas, eventos, API) + esqueleto de consola (21).

**Verificable**: una entidad de juguete con ciclo de vida completo — se crea con permiso,
transiciona por el motor, emite eventos al libro, falla con mensajes del catálogo, y todo
se ve en la consola. Suite sagrada (Spec 24 INV-PRU.02) corriendo desde acá.

**Por qué primero**: todo módulo de negocio la consume; construirla después obligaría a
re-cablear cada módulo ya hecho (que es exactamente la historia del sistema viejo).

## Etapa 2 — Los cimientos de negocio

Módulos: Clientes (fichas, tipos, bloqueo) + Catálogo (08: artículos con identidad única,
categorías, terminaciones) + Precios (09: base, perfiles, excepciones, cotización BCU) +
Configuración/nomencladores/seeds (21) + Archivos (19: repositorio y pipeline de
validación).

**Verificable**: alta de cliente, catálogo cargado por seeds, una cotización de prueba
que da el precio correcto con traza, un archivo subido que pasa su pipeline.
**Primera migración parcial** (Spec 31): clientes y catálogo depurados, para probar el
pipeline de migración temprano.

## Etapa 3 — El corazón: pedido → producción

Módulos: Pedidos e ingreso (02, portal incluido para al menos 2 servicios piloto —
sugeridos: DTF y Sublimación, los de mayor volumen) + Producción (03: lotes, bandeja,
control, fallas) + Imágenes (20: medición, capa blanca, derivados).

**Verificable**: un pedido real de prueba entra por el portal, se cotiza, se produce en
lote, se controla, genera fallas y reposiciones con linaje.

## Etapa 4 — La cadena física: logística y entrega

Módulos: Logística (04: bultos, remitos, pedido completo, depósito, esperar bultos,
retiros, estantes) + Documentos impresos (18: etiquetas, remitos) + avisos (10: WhatsApp
con sus gates, push).

**Verificable**: el pedido de la etapa 3 viaja con remito firmado, hace check-in, espera
bultos, avisa una sola vez, se retira por tótem simulado.

## Etapa 5 — La plata: caja, facturación, contabilidad

Módulos: Caja (05: sesiones, cobros, billetera, anticipos, cobertura) + Facturación (06:
CFE contra sandbox DGI, deudas, ciclos, NC) + Recursos (07: planes, telas, bobinas) +
Tesorería (28) + reportería contable (18).

**Verificable**: el flujo e2e completo n.º 1 de la Spec 24 (pedido → cobro cross-moneda →
factura → DGI sandbox → asiento cuadrado) en verde, más los chequeos de consistencia
dando cero.

**Nota**: esta etapa es la más densa en invariantes — es donde la suite sagrada y los
casos de regresión históricos pagan el boleto.

## Etapa 6 — Completar el perímetro

Módulos: los servicios restantes del portal (bordado, corte, TPU con aprobaciones, UV con
terminaciones, tienda, configurador) + CRM (26) + Soporte (27) + Compras/gastos (29) +
CMS (30) + reportes de gestión completos.

**Verificable**: paridad funcional con el sistema viejo verificada contra la **matriz de
trazabilidad**: toda RN de las specs 01–10 tiene su lugar y su prueba, o una decisión
registrada de dejarla afuera.

## Etapa 7 — Ensayo, corte y convivencia

1. **Ensayo general**: semanas de operación en staging con datos migrados de ensayo y
   usuarios reales haciendo su trabajo en paralelo (doble digitación acotada a un
   subconjunto: p. ej. un área piloto).
2. Migración según Spec 31 (depurar en el viejo → pipeline → verificación con cifras).
3. **Corte por pedido** (Spec 31 RN-MIG.05), convivencia, migración financiera final,
   viejo apagado-consultable.

## Reglas del plan

- **RN-PLA.01** No se empieza una etapa sin que la anterior tenga su verificable en verde
  — pero dentro de una etapa los módulos avanzan en paralelo si sus fronteras lo permiten.
- **RN-PLA.02** Cada etapa incluye sus pruebas, sus seeds, su parte de consola y sus
  specs actualizadas: la definición de terminado (Spec 24 RN-PRU.06) aplica a etapas
  igual que a tareas.
- **RN-PLA.03** El sistema viejo recibe SOLO mantenimiento correctivo desde el inicio de
  la etapa 3: cada mejora nueva que se le agrega al viejo agranda la matriz de paridad
  del nuevo. Excepción: correcciones de datos y bugs de plata, siempre.
- **RN-PLA.04** Al cerrar cada etapa se revisan las specs contra lo aprendido
  construyendo: la spec manda, pero si construir reveló que una regla estaba mal escrita,
  se corrige la spec con registro — nunca se deja divergir.
- **RN-PLA.05** DECISIÓN PENDIENTE (negocio): si la tienda y el configurador entran en la
  etapa 6 o se adelantan — depende de prioridad comercial, no técnica.

## Interacciones

| Con | Relación |
|---|---|
| Spec 31 | Las fases de migración están calendarizadas dentro de las etapas 2 y 7. |
| Spec 24 | Los verificables de etapa son sus flujos e2e; la suite sagrada corre desde la etapa 1. |
| Spec 16 | El orden respeta las dependencias de la arquitectura (plataforma → negocio). |
