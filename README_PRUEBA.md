# PAZO BAION GPS — BETA v9.8.1

Versión de evaluación · 8 de noviembre de 2026 · Basada en Beta v9.8.

## Cambios de esta versión (alcance acordado)

1. **Un solo apartado «Trabajos» en el historial:** desaparecen los bloques «Tratamientos numerados» y «Trabajos históricos sin numerar». Todos los registros se presentan en **una lista cronológica**, ordenada de más reciente a más antiguo por fecha de comienzo. Los tratamientos numerados se muestran como una ficha conjunta, independientemente de sus parcelas y jornadas; los trabajos sin numerar siguen disponibles y no se renumeran automáticamente.
2. **Filtros combinables:** selector de campaña/año, estado (Todos/Pendientes/Completados) y tipo (Todos los tipos, Aplicación de fitosanitarios, Desbroce, Otros trabajos y nuevos nombres encontrados en registros históricos). La combinación reduce el listado sin alterar ningún registro.
3. **Botón de ayuda (?) a la derecha del título «Trabajos»:** explica filtros, numeración global, fichas y copias de seguridad. Tiene «Volver al historial» y no cambia filtros al salir.
4. **Identificación de fitosanitarios en ficha:** campaña, número o «Sin asignar», y botón «Asignar / editar tratamiento» accesible desde la ficha del historial, incluso si está pendiente.
5. **Asignación o edición desde la ficha:** permite vincular a un tratamiento existente, reservar un nuevo número correlativo, indicar un número histórico libre o retirar la asignación sin borrar la ficha. Una operación sobre la ficha conjunta afecta de forma coherente a **todas** las fichas de ese tratamiento, con confirmación.
6. **Integridad y compatibilidad:** actualiza las fichas afectadas en una sola transacción IndexedDB, conserva la clave de datos `pazo_baion_trabajos_v97` y la compatibilidad localStorage anterior; no modifica rutas, tiempos, distancias, fotografías ni geometrías. Mantiene el acceso a las acciones por ficha y a la gestión global desde el engranaje.
7. **Versión:** textos de aplicación, PDF, manifiesto y VERSION.txt actualizados a Beta v9.8.1. Los nombres técnicos `campaign-v97.js` y `pdf-v95.js` se conservan para no romper referencias.

## Antes de subir a GitHub

- Exporta la copia completa JSON desde **Historial → engranaje → Exportar copia completa (JSON)** y guárdala fuera de Safari. Conserva además el ZIP v9.8.
- Descomprime y sube los **11 archivos de la raíz** del ZIP a la rama publicada (`main`) del mismo repositorio, sin subir la carpeta contenedora. No cambia el dominio de GitHub Pages.
- Esta Beta **no contiene** parcelas, incidencias ni rutas reales.

## Pruebas importantes en iPhone

1. Comprueba que «Trabajos» es un listado único cronológico; verifica el historial de 2026 sin perder fichas antiguas.
2. Selecciona 2026, «Pendientes», «Aplicación de fitosanitarios»; cambia filtros y comprueba que el listado coincide con tus datos.
3. Pulsa (?) en «Trabajos» y usa «Volver al historial»; deben conservarse los filtros.
4. Abre una ficha antigua de fitosanitarios «Sin asignar» y pulsa «Asignar / editar tratamiento». **Prueba inicialmente con una ficha ficticia respaldada**, no con un tratamiento real importante.
5. Comprueba que las opciones muestran tratamientos existentes de la campaña, permiten añadir uno nuevo y que el guardado no altera el GPS. Verifica el número después de cerrar/reabrir Safari.
6. Comprueba una ficha de tratamiento con varias parcelas: si decides cambiar su asignación, debe afectar a todas sus fichas y nunca mezclar los recorridos.
7. Comprueba que el engranaje sigue dando acceso a copias generales y que las opciones de ficha siguen en la pantalla de cada trabajo.
8. Los GPS históricos con precisión muy mala pueden seguir mostrando advertencias o mapas parciales; **esta versión no reconstruye coordenadas inexistentes**.

## Verificación técnica

- Se comprueba la integridad del ZIP, sintaxis JS y estructura de scripts.
- Se prueban los filtros, agrupación cronológica y asignación con datos ficticios en entorno controlado.
- Pendiente: prueba real táctil y de persistencia en Safari del iPhone. Safari puede detener el GPS en segundo plano. Los GeoJSON y trabajos reales deben respaldarse fuera del navegador.
