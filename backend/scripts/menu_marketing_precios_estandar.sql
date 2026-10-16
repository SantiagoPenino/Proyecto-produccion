/* ─────────────────────────────────────────────────────────────────────────
   Acceso del rol "Marketing" a la vista sola "Precios Estándar"
   (precios base + escalas de volumen editables: agregar/quitar/renombrar rango)

   Ruta del front: /admin/base-prices  → componente BasePrices.jsx
   Módulo padre  : "Gestión de Precios" (IdModulo 38, /admin/prices)
   Módulo hijo   : "Precios Estándar"   (IdModulo 39, /admin/base-prices)

   El árbol de menú (MainAppContent.jsx) descarta un ítem hijo si su padre no
   está también en la lista de permisos del usuario, por eso se otorgan AMBOS
   IdModulo (38 y 39) al rol Marketing (IdRol 13).

   Es idempotente: si el permiso ya existe (p.ej. porque local ya lo tiene),
   no duplica ni falla.
   ───────────────────────────────────────────────────────────────────────── */

DECLARE @IdRolMarketing INT = 13;   -- Roles.NombreRol = 'Marketing'

DECLARE @Modulos TABLE (IdModulo INT);
INSERT INTO @Modulos (IdModulo) VALUES (38), (39);

INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT @IdRolMarketing, m.IdModulo
FROM @Modulos m
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.PermisosRoles pr
    WHERE pr.IdRol = @IdRolMarketing AND pr.IdModulo = m.IdModulo
);

SELECT pr.IdRol, r.NombreRol, pr.IdModulo, mo.Titulo, mo.Ruta
FROM dbo.PermisosRoles pr
JOIN dbo.Roles r ON r.IdRol = pr.IdRol
JOIN dbo.Modulos mo ON mo.IdModulo = pr.IdModulo
WHERE pr.IdRol = @IdRolMarketing AND pr.IdModulo IN (38, 39);
