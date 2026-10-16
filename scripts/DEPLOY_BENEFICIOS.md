# Deploy — Beneficios pactados sobre la billetera

Spec de negocio: `specs/40-beneficios-pactados.md`. Plan técnico: `docs/beneficios-billetera-plan.md`.
Rama de trabajo: `feature/beneficios` (worktree separado, nada commiteado a `main`).

Esta guía la corre **el usuario**, en su orden. La sesión que armó la feature no toca
producción ni corre migraciones: solo entrega el script SQL y el código para mergear.

## 0. Qué implica subir esto (resumen para decidir)

- **No interfiere con nada de lo que hoy funciona.** El script SQL es idempotente y solo
  agrega tablas/columnas nuevas (nada existente se altera). El código nuevo se activa recién
  cuando `ConfiguracionGlobal.BENEFICIOS_ACTIVOS = '1'`; con el interruptor en `'0'` (el valor
  con el que el script lo crea), el motor de precios y el motor contable ni siquiera
  consultan las tablas nuevas — el comportamiento de hoy queda idéntico.
- Los archivos que se tocaron (no se reescribieron) son compartidos con producción:
  `pricingService.js`, `contabilidadService.js`, `erpSyncService.js`, `webOrdersController.js`,
  `contabilidadController.js`, `profilesController.js`, `ContabilidadCuentasView.jsx`,
  `ClienteBilletera.jsx`, `VendedorCliente360.jsx`, `MainAppContent.jsx`, `RecursosView.jsx`
  (portal). Todos los cambios son **aditivos** (nuevas ramas de código detrás del flag, o
  columnas nuevas que se leen como `NULL` si no aplican) — no se borró ni reescribió lógica
  existente.
- Si tenés que subir otros arreglos antes de terminar de probar esto: podés mergear
  `feature/beneficios` a `main` y desplegar tranquilo con el flag en `'0'`; el código nuevo
  queda dormido hasta que decidas prenderlo.

## 1. Antes del deploy

1. Revisar el diff de la rama contra `main`:
   ```bash
   git diff main..feature/beneficios --stat
   ```
2. Correr `scripts/add_beneficios.sql` **en producción**, con la app parada o no (no bloquea:
   son `CREATE TABLE`/`ALTER TABLE` con `IF NOT EXISTS`). Es el mismo script que ya se probó
   en local. Al final deja:
   - `PerfilesPrecios.EsBeneficio` (bit, default 0).
   - Tablas `Beneficios` y `BeneficiosCliente`.
   - `Ordenes.BclIdBeneficioCliente` y `PedidosCobranzaDetalle.BclIdBeneficioCliente`.
   - `ConfiguracionGlobal` con `BENEFICIOS_ACTIVOS = '0'` (apagado).
   - Los módulos de menú `/beneficios/predefinidos` y `/beneficios/pactos`, colgando del
     mismo padre que "Vista 360" de vendedores, con permiso para los roles 1 (Admin), 7, 8
     (Administración) y 12 — revisá esos IDs de rol contra tu tabla `Roles` de producción
     antes de correrlo; si tu Administración tiene otro `IdRol`, editá la sección final del
     script (los `VALUES (1),(7),(8),(12)`) antes de ejecutarlo.
   - Tabla `BeneficiosAprobadores` (vacía): lista opcional de usuarios puntuales que pueden
     aprobar pactos/plantillas sin tener rol Admin/Administración. No hace falta cargarla
     para empezar — sin filas, aprueba solo quien ya tiene esos roles, como siempre.
3. Verificar que corrió bien:
   ```sql
   SELECT Valor FROM ConfiguracionGlobal WHERE Clave = 'BENEFICIOS_ACTIVOS'; -- '0'
   SELECT COUNT(*) FROM sys.tables WHERE name IN ('Beneficios','BeneficiosCliente'); -- 2
   SELECT Ruta FROM Modulos WHERE Ruta LIKE '/beneficios/%'; -- 2 filas
   ```

## 2. Deploy de código

1. Mergear `feature/beneficios` a `main` (o al branch que uses para desplegar) y hacer el
   build/deploy como siempre (`npx vite build` para el front, reinicio del backend).
2. Con el flag en `'0'` no hace falta piloto previo: no hay ningún cambio visible para nadie
   todavía, salvo dos entradas de menú nuevas ("Beneficios predefinidos" y "Beneficios
   pactados") y la pestaña "Beneficios" en la Vista 360 de vendedores — ambas funcionan (se
   puede crear un predefinido, proponer y aprobar un pacto) pero **ningún precio cambia**
   hasta que el pacto se activa, y activar también está bloqueado mientras el flag esté en 0
   (el backend lo rechaza con un mensaje explícito).

## 3. Piloto y encendido

1. Elegí 1–2 clientes de prueba reales y armá un beneficio predefinido interno o un pacto
   con ellos (sin activar todavía).
2. Prendé el interruptor:
   ```sql
   UPDATE ConfiguracionGlobal SET Valor = '1' WHERE Clave = 'BENEFICIOS_ACTIVOS';
   ```
   (o desde la pantalla "Beneficios predefinidos", el switch de arriba, si sos Admin —
   pasa por `POST /api/beneficios/config`). El cache del flag dura 60 segundos: el efecto es
   casi inmediato.
3. Activá el pacto de prueba (caja → Venta de saldo → "Un beneficio aprobado o predefinido",
   o portal) y cotizá un pedido de ese cliente en el alcance del beneficio: el precio debe
   salir pactado y la traza del motor de precios debe decir "BENEFICIO PACTADO".
4. Seguí la `GUIA_PRUEBAS_BENEFICIOS.md` (mismo directorio) para el resto de los casos
   (cascada, agotado, pausa, cierre) antes de anunciarlo a más clientes.

## 4. Apagar si algo sale mal

```sql
UPDATE ConfiguracionGlobal SET Valor = '0' WHERE Clave = 'BENEFICIOS_ACTIVOS';
```
Con el flag en `'0'`: el motor de precios deja de aplicar cualquier beneficio (todos los
clientes vuelven a su tarifa normal en el acto) y el motor contable deja de descontar de
las bolsas (las órdenes nuevas van derecho a la cuenta principal, como si el beneficio no
existiera). **Nada se borra**: los pactos, plantillas y bolsas con su saldo quedan tal cual
were, listos para retomar cuando vuelvas a prender el interruptor.

## 5. Reversa completa (si hace falta desarmar todo)

Solo si de verdad hay que sacar la feature entera (no solo apagarla):

```sql
-- En este orden, por las FK. Revisa antes que no haya bolsas con saldo real (Sección 8
-- de GUIA_PRUEBAS_BENEFICIOS.md) que el cliente no haya recibido de otra forma: cerralas
-- primero desde la 360 (pasa el saldo a la billetera común del cliente) o vas a perder
-- esa plata para el cliente.
DELETE FROM MovimientosCuenta WHERE CueIdCuenta IN (SELECT CueIdCuenta FROM CuentasCliente WHERE CueNombre LIKE 'Beneficio:%');
DELETE FROM CuentasClienteArticulosPermitidos WHERE CueIdCuenta IN (SELECT CueIdCuenta FROM CuentasCliente WHERE CueNombre LIKE 'Beneficio:%');
DELETE FROM BeneficiosCliente;
DELETE FROM CuentasCliente WHERE CueNombre LIKE 'Beneficio:%';
DELETE FROM Beneficios;
DELETE FROM PerfilesItems WHERE PerfilID IN (SELECT ID FROM PerfilesPrecios WHERE EsBeneficio = 1);
DELETE FROM PerfilesPrecios WHERE EsBeneficio = 1;
DELETE FROM PermisosRoles WHERE IdModulo IN (SELECT IdModulo FROM Modulos WHERE Ruta LIKE '/beneficios/%');
DELETE FROM Modulos WHERE Ruta LIKE '/beneficios/%';
DELETE FROM BeneficiosAprobadores;
-- Las columnas (EsBeneficio, BclIdBeneficioCliente) y ConfiguracionGlobal.BENEFICIOS_ACTIVOS
-- se pueden dejar: no afectan nada con la feature apagada/desinstalada.
```

## 6. Checklist rápido

- [ ] `add_beneficios.sql` corrido en producción, sin errores.
- [ ] `SELECT Valor FROM ConfiguracionGlobal WHERE Clave='BENEFICIOS_ACTIVOS'` → `'0'`.
- [ ] IDs de rol en la sección de `PermisosRoles` del script confirmados contra tu tabla
      `Roles` de producción (Admin / Administración) antes de correrlo.
- [ ] Deploy de backend + frontend hecho.
- [ ] Menú: "Beneficios predefinidos" y "Beneficios pactados" visibles para los roles que
      aprueban; pestaña "Beneficios" visible en la Vista 360 de vendedores para todos los
      vendedores.
- [ ] Página "Perfiles de Precios": los perfiles de beneficio (nombre `BENEFICIO · …`) NO
      aparecen en el listado ni son asignables a mano.
- [ ] Piloto con 1–2 clientes, interruptor prendido, casos de `GUIA_PRUEBAS_BENEFICIOS.md`
      corridos en producción con datos reales de esos clientes.
