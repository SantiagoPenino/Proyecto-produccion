# Fix: lentitud / "atomización" del socket

**Síntoma:** el sistema se pone cada vez más lento con el uso. Operaciones que tocan
muchas órdenes (cierre de ciclo, magic assignment, cambios de estado de lotes) saturan
el backend porque disparan una ráfaga de refetches del tablero en cada cliente conectado.

**Causa raíz (3 puntos que se combinan):**

1. El backend emite **un evento de socket por cada orden** afectada (en bucle).
2. `AreaView` **fuga listeners** y mata el socket global al desmontar → un solo evento
   termina disparando N refetches; empeora cuanto más se navega (degradación progresiva).
3. Las vistas refetchean el tablero **completo en cada evento, sin debounce**.

Con los FIX 1 y 2 se corta la tormenta. El FIX 2 es el que frena la degradación con el uso.

---

## 🔴 FIX 1 — Backend: emitir un evento por lote, no uno por orden

**Archivo:** `backend/services/stateManagerService.js`
**Líneas:** 198–203

### Antes
```js
if (io && ordenesAfectadas.length > 0) {
    for (const oid of ordenesAfectadas) {
        io.emit('server:order_updated', { orderId: oid, status: estadoGeneral || estado, estadoenArea: estado });
    }
    io.emit('server:ordersUpdated', { count: ordenesAfectadas.length });
}
```

### Después
```js
if (io && ordenesAfectadas.length > 0) {
    // Un solo evento por lote (antes se emitía uno por orden → tormenta de refetch)
    io.emit('server:order_updated', {
        orderIds: ordenesAfectadas,
        count: ordenesAfectadas.length,
        status: estadoGeneral || estado,
        estadoenArea: estado
    });
    io.emit('server:ordersUpdated', { count: ordenesAfectadas.length });
}
```

**Nota:** es compatible hacia atrás. Las vistas que escuchan `server:order_updated`
siguen recibiendo el evento (ahora una sola vez) e ignoran el payload igual.

---

## 🔴 FIX 2 — Frontend: AreaView mata el socket global y fuga listeners

**Archivo:** `src/components/production/areas/AreaView.jsx`
**Líneas:** 333–335

### Antes
```js
return () => {
    socket.disconnect();
};
```

### Después
```js
return () => {
    socket.off('server:order_updated', handleSocketUpdate);
    socket.off('server:ordersUpdated', handleSocketUpdate);
    socket.off('server:new_order', handleSocketUpdate);
    socket.off('lotes:updated', handleSocketUpdate);
};
```

**Por qué (importante):** el `socket` es un singleton compartido por toda la app. Este
`useEffect` registra 4 listeners (líneas 328–331) pero al desmontar hace
`socket.disconnect()` en vez de quitarlos. Consecuencias:

1. Los listeners **nunca se eliminan** → cada vez que se entra/sale de `AreaView` se suma
   otra copia de `handleSocketUpdate`. Tras navegar varias veces, **un solo evento dispara
   N refetches**. Por eso el sistema se va poniendo lento mientras se usa.
2. `socket.disconnect()` corta el socket para **toda** la app, y el auto-reconnect lo vuelve
   a levantar → churn de reconexiones.

---

## 🟡 FIX 3 — Frontend: debounce del refetch (defensa adicional)

Aplicar el mismo patrón en las vistas que refetchean en cada evento de socket.

**Archivo principal:** `src/components/pages/CoordinacionView.jsx`
**Líneas:** 241–262

### Después
```js
useEffect(() => {
    let t;
    const handleServerUpdate = () => {
        clearTimeout(t);
        t = setTimeout(() => {
            if (!selectedArea) return;
            rollsService.getBoard(selectedArea.code).then(data => {
                const sorted = sortPendingOrders(data.pendingOrders || []);
                setPendingOrders(sorted);
                const movable = (data.rolls || []).filter(r => MOVABLE_STATES.includes((r.status || '').toLowerCase()));
                const locked  = (data.rolls || []).filter(r => !MOVABLE_STATES.includes((r.status || '').toLowerCase()));
                setRolls([...movable, ...locked]);
            }).catch(e => console.error("Error en socket reload:", e));
        }, 400); // agrupa ráfagas en un solo getBoard
    };

    socket.on('server:order_updated', handleServerUpdate);
    socket.on('server:new_order', handleServerUpdate);

    return () => {
        clearTimeout(t);
        socket.off('server:order_updated', handleServerUpdate);
        socket.off('server:new_order', handleServerUpdate);
    };
}, [selectedArea]);
```

**Mismo patrón conviene en:**
- `src/components/pages/FilePrintControl.jsx` (líneas 147 y 311)
- `src/components/pages/customer-service/CustomerReplacementPage.jsx` (línea 55)

---

## Resumen

| Prioridad | Archivo | Líneas | Cambio |
|-----------|---------|--------|--------|
| 🔴 1 | `backend/services/stateManagerService.js` | 198–203 | Quitar el `for`, emitir **un** `server:order_updated` por lote |
| 🔴 2 | `src/components/production/areas/AreaView.jsx` | 333–335 | Reemplazar `socket.disconnect()` por `socket.off(...)` de los 4 listeners |
| 🟡 3 | `CoordinacionView.jsx` (+ FilePrintControl, CustomerReplacementPage) | handler de socket | Debounce de 400 ms + `socket.off` en el cleanup |

**Orden recomendado:** aplicar 1 y 2 primero (cortan la tormenta y la degradación);
3 es endurecimiento adicional.
