# Scripts históricos

Scripts y runbooks de episodios cerrados, una carpeta por episodio (`<año-mes-episodio>`). Se archivaron el 21/10/2026 (auditoría de limpieza, §6).

- **No corren desde acá.** Usan `require('../config/db')` y otros caminos relativos a `backend/scripts/`. Para volver a usar uno, copiarlo a `backend/scripts/` y correrlo desde `backend/`.
- Los `.sql` y los `.csv` no están en git (reglas `*.sql` y `backend/scripts/**/*.csv` del `.gitignore`): existen solo en la PC donde se archivaron.
- Cada carpeta tiene su README: qué pasó, qué se corrió en producción y qué quedó pendiente. «No lo sé» quiere decir que no hay registro de que se haya corrido.
- Los documentos de los mismos episodios están en `docs/_historico/`.
