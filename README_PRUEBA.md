# PAZO BAION GPS — Beta v9.6.1

Actualización puntual basada **directamente en Beta v9.6**. Conserva su diseño, navegación, carga de capas, historial, GPS, viento e informes.

## Correcciones respecto a v9.6
1. **Versión coherente:** pantalla inicial, `app.js`, `data.js`, manifiesto, archivo `VERSION.txt` e informes PDF (cabecera y pie) identifican la Beta v9.6.1. Se conserva el nombre interno `pdf-v95.js` por compatibilidad con la ruta usada en GitHub Pages; el contenido generado ya muestra la versión correcta.
2. **Protección al finalizar pendientes:** después de seleccionar un trabajo pendiente del historial, la aplicación **solo** puede finalizarlo si se activó correctamente ese mismo trabajo. Si se cancela el cambio porque existe otro trabajo activo, no se modifica ni finaliza el trabajo anterior.
3. **Fecha:** la pantalla de configuración muestra la fecha con formato de español correcto: «Viernes, 6 de noviembre de 2026», sin capitalizar «De» ni «Noviembre».

## Verificaciones recomendadas en iPhone
1. Publicar todos los archivos del ZIP en la **raíz** del repositorio de GitHub Pages y comprobar que la pantalla de inicio indica **Beta v9.6.1**.
2. Desde un informe de trabajo, generar un PDF y verificar que tanto cabecera como pie dicen **Beta v9.6.1**. El nombre `pdf-v95.js` es interno y no se muestra como versión del documento.
3. En «Configuración de jornada», revisar la fecha: día de la semana con inicial mayúscula, mes y «de» en minúsculas.
4. **Solo con registros de prueba:** crear dos trabajos pendientes, dejar uno activo, abrir otro desde el historial e intentar finalizarlo. Si se cancela el cambio de trabajo, no debe finalizarse ninguno. Si se acepta, solo debe finalizarse el seleccionado.
5. Comprobar de nuevo los recorridos de la v9.6: historial directo, ayuda de jornada anterior, regreso, conjuntos guardados, informes.

## Protección de datos
No se incluyen capas GeoJSON ni incidencias reales. Se conservan las mismas claves `localStorage` v08, el almacén IndexedDB `pazo_baion_local_v95` y el formato anterior de los trabajos. **No borres los datos del sitio en Safari** si quieres conservar registros.

## Limitaciones
GPS en segundo plano de Safari no garantizado; cartografía y viento requieren internet. Las fotografías de incidencias siguen sin incrustarse en los PDF.
