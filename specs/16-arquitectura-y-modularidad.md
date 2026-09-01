# Spec 16 — Arquitectura y Modularidad de la Plataforma (to-be)

> Spec de escalamiento. A diferencia de las specs de negocio (01–11), esta SÍ habla del
> CÓMO: fija los principios de arquitectura del sistema nuevo. Las decisiones puntuales de
> tecnología (lenguaje, framework, base) se registran aparte como **ADRs** (§8) — esta
> spec fija lo que cualquier elección tecnológica debe respetar.

## 1. Diagnóstico del sistema actual

1. **Sin fronteras**: controladores de miles de líneas donde conviven negocio, SQL,
   validación y formato de respuesta; la misma regla repetida en varios caminos.
2. **La lógica vive en procedimientos y controladores**, no en un modelo del dominio: las
   entidades son filas, no objetos con comportamiento — por eso los invariantes se
   protegen "acordándose de validar" en cada lugar.
3. **Acoplamiento por base compartida**: cualquier módulo lee y escribe las tablas de
   cualquier otro; no hay contrato entre módulos.
4. Lo que sí funciona y se conserva como idea: los pocos **servicios centralizados** que
   existen (punto único de estados, resolvedor de líneas, pedido completo, motor de
   reglas contables) son justamente las partes más sanas del sistema.

## 2. Estilo: monolito modular primero

- **RN-ARQ.01** El sistema nuevo nace como **monolito modular**: una sola aplicación
  desplegable, dividida en **módulos con fronteras duras** alineados a las specs de
  negocio (pedidos, producción, logística, caja, facturación, recursos, catálogo,
  precios, portal) más los transversales (seguridad, trazabilidad, motor de estados,
  errores, notificaciones).
- **RN-ARQ.02** **Regla de fronteras**: un módulo solo habla con otro por su **interfaz
  pública** (servicios/contratos) o por **eventos**; jamás leyendo sus datos directamente.
  Cada módulo es dueño exclusivo de sus tablas — el acoplamiento por base compartida del
  sistema actual queda prohibido por estructura.
- **RN-ARQ.03** Microservicios **no** son un objetivo: si algún día un módulo necesita
  desplegarse aparte (por carga o por equipo), las fronteras de RN-ARQ.02 lo hacen
  posible sin reescribir. La modularidad es la inversión; la distribución, una opción.

## 3. Capas dentro de cada módulo (aquí entra la POO)

- **RN-ARQ.04** Cada módulo se organiza en tres capas con dependencia en un solo sentido
  (afuera → adentro):

| Capa | Responsabilidad | Qué contiene |
|---|---|---|
| **Dominio** | Las reglas de negocio de las specs | Clases de entidad con **comportamiento** (Orden, Retiro, Documento, Cuenta, Plan…), objetos de valor, servicios de dominio, eventos de dominio |
| **Aplicación** | Orquestar casos de uso | Un servicio por operación de negocio: abre la transacción, verifica permiso (Spec 12), invoca al dominio, emite eventos (Spec 13), traduce errores (Spec 15) |
| **Infraestructura** | El mundo exterior | Persistencia, HTTP/API, proveedores externos (CFE, WMS, WhatsApp, email), jobs, tiempo real |

- **RN-ARQ.05** **POO con modelo de dominio rico** — el principio rector: *una entidad no
  es una fila con getters; es un objeto que protege sus propios invariantes*. Las reglas
  de las specs se implementan como comportamiento de la clase, no como validaciones
  regadas:
  - `Retiro` no tiene un `setEstado()`: tiene `cobrar()`, `autorizar()`, `entregar()` —
    y cada método aplica sus guardas o lanza el error del catálogo. Un estado inválido es
    **inconstruible**, no "invalidado".
  - Los **objetos de valor** eliminan clases enteras de bugs del sistema actual:
    `Dinero` (importe + moneda + cotización — inseparables, Spec 11 INV maestro 4),
    `CodigoOrden`, `Magnitud` (número + unidad), `ReceptorFiscal` (congelado).
  - Los **agregados** definen la frontera transaccional: Pedido con sus Órdenes,
    Documento con sus Líneas y su Deuda, Cuenta con sus Movimientos. Todo lo que debe ser
    consistente junto, cambia junto o no cambia.
  - La **herencia se usa poco y el polimorfismo mucho**: tipos de documento, medios de
    pago, tipos de movimiento y guardas son jerarquías de comportamiento detrás de una
    interfaz — el reemplazo de los `IF tipo IN (...)` regados de hoy.
- **RN-ARQ.06** El dominio **no conoce** la base, el framework HTTP ni los proveedores:
  se le inyectan interfaces (repositorios, puertos). Consecuencia práctica: el dominio se
  **testea sin base ni servidor**, que es lo que hace sostenible el sistema.

## 4. Comunicación entre módulos: eventos

- **RN-ARQ.07** Los encadenamientos entre dominios (orden pronta → logística; check-in →
  contabilidad → aviso; pago → deuda) se publican como **eventos de dominio**. El módulo
  emisor no conoce a los suscriptores. Esto materializa los flujos declarados de la Spec
  14 y alimenta el libro de la Spec 13 con el mismo mecanismo.
- **RN-ARQ.08** Efectos diferidos (avisos, emails, sincronizaciones, impresiones) van por
  **colas con reintento e idempotencia** (política de la Spec 15) — nunca "fire and
  forget" sin registro.

## 5. API, tiempo real y jobs

- **RN-ARQ.09** **Una sola API** para todos los clientes (interno, portal, tótem,
  integraciones), con autorización por operación (Spec 12); las diferencias entre
  audiencias son de permiso y de forma del mensaje (Spec 15), no APIs paralelas.
- **RN-ARQ.10** El **tiempo real** (bandejas, depósito, anuncios del tótem) es
  infraestructura transversal suscrita a los eventos de dominio — no emisiones manuales
  desde cada controlador.
- **RN-ARQ.11** Los **jobs** son casos de uso de aplicación con identidad de servicio
  (Spec 12), reporte de corrida y alerta si dejan de correr (Spec 15 RN-ERR.10).

## 6. Datos

- **RN-ARQ.12** La base implementa la Spec 11 con sus invariantes como constraints. Cada
  módulo es dueño de su esquema; las consultas cross-módulo de lectura (reportes, 360,
  hoja de ruta) van por una **capa de lectura** definida (vistas/consultas publicadas),
  nunca por JOINs clandestinos a tablas ajenas.
- **RN-ARQ.13** Migraciones de esquema **versionadas en el repo** y aplicadas por
  herramienta, nunca a mano (formaliza la práctica actual de scripts SQL).

## 7. Transversales obligatorios

Todo módulo, sin excepción, se integra con: **Seguridad** (Spec 12 — permiso por
operación), **Trazabilidad** (Spec 13 — evento por operación), **Motor de estados**
(Spec 14 — ciclos de vida por el motor), **Errores** (Spec 15 — catálogo y política).
Un módulo que "por ahora" los saltea no pasa revisión: es exactamente como el sistema
actual llegó a donde está.

## 8. ADRs (decisiones de tecnología)

- **RN-ARQ.14** Cada decisión tecnológica concreta (lenguaje, framework, ORM, base, cola,
  hosting) se registra como **ADR** (Architecture Decision Record) en `specs/adr/`:
  contexto, opciones, decisión, consecuencias. Las ADRs pueden cambiar; esta spec y las
  de negocio, no — por eso van separadas.

## 9. Interacciones

| Con | Relación |
|---|---|
| Specs 01–11 | Definen QUÉ hace cada módulo; esta spec define cómo se organiza y se comunica. |
| Spec 11 | Los agregados de RN-ARQ.05 implementan sus entidades; los invariantes maestros son constraints + comportamiento de clase. |
| Specs 12–15 | Son los módulos transversales que esta arquitectura obliga a usar. |
| Spec 17 | El front consume la API única y los eventos de tiempo real definidos aquí. |
