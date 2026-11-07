# PAZO BAION GPS — BETA v9.8

**Versión de evaluación** · Base: v9.7 · 7 de noviembre de 2026.

## Cambios implementados

1. **Historial simplificado:** selector de campaña, filtros Todos/Pendientes/Completados y dos secciones separadas: «Tratamientos numerados» y «Trabajos históricos sin numerar». Se muestran nombres completos de parcelas y fechas sin botones de eliminación en la lista.
2. **Ficha de tratamiento:** cada tratamiento numerado abre su mapa e informe conjunto, con acceso a las fichas individuales de sus parcelas y jornadas mediante «Fichas de parcelas y jornadas».
3. **Acciones por ficha:** en el informe abierto desde el historial, desplegar «Acciones de esta ficha» para exportar JSON de la ficha o eliminar únicamente esa ficha. Si se trata de un tratamiento conjunto, la exportación/eliminación se refiere a todo ese tratamiento, con confirmación específica.
4. **Gestión general independiente:** botón de engranaje en la cabecera de Historial. Abre «Gestión de datos» para exportar una copia completa, restaurar una copia sin sobrescribir fichas coincidentes o borrar TODO el historial con confirmación reforzada. Estas acciones ya no ocupan la lista de trabajos.
5. **Mapas históricos:** si una ficha antigua no conserva su perímetro, busca coincidencias en los conjuntos GeoJSON guardados y en la capa actual. Solo recupera el límite si encuentra una única geometría inequívoca; el informe indica que ese límite puede ser distinto al de la fecha original. Si hay ambigüedad, no elige ninguno. **No modifica los registros originales.**
6. **Control GPS:** el informe advierte si la precisión es deficiente, si la distancia/tiempo equivalen a velocidades anómalas o si existen saltos de velocidad instantánea. Los puntos originales y la distancia registrada se conservan sin corregirse automáticamente.
7. **PDF:** continúa generándose en el dispositivo con campaña, tratamiento, croquis de los límites disponibles y rutas separadas. Se identifican como «perímetros disponibles», no como límites históricos garantizados, y se incluyen avisos de fiabilidad geográfica.
8. **Compatibilidad:** conserva las claves antiguas `localStorage` v08, el IndexedDB de conjuntos `pazo_baion_local_v95`, el archivo de trabajos `pazo_baion_trabajos_v97` y el generador `pdf-v95.js`. Sus nombres internos se mantienen por compatibilidad; los textos de versión muestran **Beta v9.8**. No renumera históricos ni elimina registros al instalar.

## Antes de publicar en GitHub

- **Muy importante:** en la Beta v9.7, abre Historial → «Exportar copia de seguridad completa (JSON)». Comprueba que el archivo está guardado fuera de Safari, en «Archivos». Conserva el ZIP de v9.7.
- Descomprime la v9.8 y sube los **11 archivos de la raíz**, no el ZIP, a la rama publicada `main` del mismo repositorio. No cambies la URL de GitHub Pages.
- El ZIP no contiene ninguna parcela, incidencia ni recorrido real.

## Pruebas de aceptación en el iPhone

1. Abre el historial desde «Cargar capas del mapa» y selecciona campaña 2026: verifica que las fichas antiguas siguen presentes bajo «Trabajos históricos sin numerar».
2. Cambia a una campaña con un tratamiento numerado, abre su ficha conjunta, despliega «Fichas de parcelas y jornadas» y entra en una ficha. Comprueba su retorno al tratamiento.
3. En una ficha, despliega «Acciones de esta ficha», **exporta** su JSON. Verifica que el fichero existe en «Archivos».
4. En Historial, pulsa el **engranaje**. Comprueba la pantalla de gestión y vuelve atrás. **No pruebes borrados con el historial real.**
5. Abre un trabajo antiguo sin perímetro y comprueba el aviso de ausencia o de reconstrucción inequívoca. Valida visualmente el mapa y su PDF.
6. En un trabajo con dos parcelas, el PDF debe mostrar ambos perímetros y los dos recorridos por separado.
7. Prueba en condiciones controladas el GPS y el seguimiento de viento; no se ha certificado el GPS con iPhone bloqueado.
8. Si existe una ficha pendiente real, **no la elimines** antes de respaldarla. La app impide borrar una ficha que es trabajo activo.
9. Como prueba de restauración y borrado, utiliza solo datos ficticios en un navegador/perfil de pruebas con copia de seguridad verificable.

## Resultado de la auditoría antes de empaquetar

- Sintaxis de JavaScript comprobada.
- Comprobaciones directas (con registros *ficticios*): separación de grupos e históricos, asociación de dos parcelas, recuperación de perímetro solo con coincidencia única, rechazo de límites ambiguos, eliminación individual y de tratamiento contra un archivo simulado y generación de PDF A4 de dos páginas con dos perímetros y dos rutas.
- Integridad ZIP, raíces y ausencia de datos GeoJSON reales verificadas.
- **Limitación:** el navegador automatizado de este entorno bloqueó la carga local; no se ha podido completar la prueba visual táctil ni la prueba con GPS real en Safari. La Beta v9.8 debe evaluarse en el dispositivo antes de considerarse estable.
- Safari puede suspender el GPS en segundo plano. Esri y Open-Meteo requieren conexión. Las copias en IndexedDB y localStorage no sustituyen una exportación JSON guardada fuera del navegador.
