# PAZO BAION GPS — Beta v9.7

**Base:** Beta v9.6.1. **Fecha:** 07/11/2026. **Objeto:** prueba funcional del sistema de campañas, tratamientos y mapas históricos. No es una certificación de precisión GPS ni un cuaderno oficial de tratamientos fitosanitarios.

## Cambios introducidos

1. **Parcelas como base geográfica.** El GeoJSON de parcelas sigue siendo la referencia cartográfica. Cada nuevo trabajo conserva una copia de la geometría de la parcela que tenía al registrarse, sin modificar el fichero original.
2. **Tratamientos numerados por campaña.** Al seleccionar «Aplicación de fitosanitarios», aparece una pantalla para indicar la campaña y elegir «Tratamiento nuevo» o «Añadir otra parcela o jornada» a uno existente. El número de tratamiento se reserva de forma consecutiva en IndexedDB al preparar el nuevo trabajo y no se reutiliza tras borrar una ficha.
3. **Una ficha por trabajo/parcela; un informe por tratamiento.** Distintas parcelas y jornadas pueden vincularse a un mismo número de tratamiento. Cada ficha conserva puntos originales, puntos depurados, tiempos, meteorología y demás datos. No se mezclan artificialmente los recorridos.
4. **Historial organizado por campañas.** Filtro de año y listas agrupadas por número de tratamiento, con acceso al informe conjunto y a cada ficha individual. Los registros anteriores sin número permanecen como **históricos sin numerar**; no se les asignan números ficticios.
5. **Mapas e informes.** El mapa del informe recupera las geometrías guardadas con la ficha y muestra los recorridos independientes. El PDF vectorial incluye los perímetros disponibles de parcelas y los recorridos por separado, además del número de tratamiento y campaña. Si faltan geometrías antiguas, se indica; no se inventan puntos.
6. **Fiabilidad GPS.** Se avisa sobre baja precisión y sobre posibles incoherencias entre distancia y tiempo (por ejemplo, velocidades medias incompatibles con el uso normal de un tractor). Los datos originales no se alteran.
7. **Archivo local reforzado.** Nuevo IndexedDB `pazo_baion_trabajos_v97` para fichas completas, más la compatibilidad con `localStorage` v08. La migración es conservadora: no borra el historial anterior. Exportación JSON completa e importación sin eliminar las fichas preexistentes. Los contadores de campañas se pueden restaurar desde una copia.
8. **Incidencias.** Se conservan las incidencias GeoJSON importadas y las incidencias locales como fuentes distintas, con representación sobre el mismo mapa, identificación del origen y colores por tipo cuando exista correspondencia. Posibilidad de exportar las incidencias geolocalizadas locales en GeoJSON sin fotografías; las fotografías se conservan en el backup JSON completo.
9. **Continuidad v9.6.1.** Se mantienen las pantallas, navegación, seguridad al finalizar trabajos, jornadas, calibración, meteorología, informes visuales, PDF y las correcciones anteriores.

## Pruebas de aceptación en iPhone (usar parcelas y recorridos de PRUEBA)

1. Descargar y conservar antes **una copia JSON de seguridad** desde «Historial». No borrar datos del sitio de Safari.
2. Desde la selección de una parcela, iniciar una labor fitosanitaria. Verificar pantalla «Tratamiento fitosanitario» con campaña 2027 y «Tratamiento nuevo». Comenzar una prueba GPS solo en un lugar adecuado y con permiso.
3. Finalizar esa ficha, seleccionar otra parcela, volver a «Aplicación de fitosanitarios», elegir «Añadir otra parcela o jornada» y vincularla al tratamiento existente. Comprobar que mantiene el mismo número.
4. En «Historial», seleccionar campaña 2027 y abrir «Consultar mapa e informe del tratamiento». Comprobar límites, dos trazados separados, fechas y sumas. Abrir también cada ficha individual desde el grupo.
5. Generar PDF y revisar número de tratamiento, campaña, páginas y croquis con geometría. Comprobar que la imagen de fondo satelital **no** se incrusta en el PDF; el croquis es vectorial.
6. Abrir un trabajo anterior a v9.7. Si no conserva el perímetro, verificar el aviso en vez de un contorno inventado. Los datos anteriores deben mantenerse.
7. Exportar una copia JSON y comprobar que el archivo se descarga. **No probar borrar o restaurar sobre el historial real sin disponer de una copia fuera de Safari.**
8. Comprobar la capa de incidencias importadas, los puntos locales y la exportación GeoJSON. Unas incidencias sin coordenadas no pueden representarse como puntos.
9. Verificar regreso entre pantallas y que los controles siguen siendo pulsables y legibles en el iPhone.

## Privacidad y limitaciones

* El ZIP contiene **únicamente código e imágenes ornamentales**: ninguna parcela, incidencia ni recorrido real. Todos los archivos están en la raíz del ZIP.
* Las claves existentes `localStorage` v08 y el IndexedDB de conjuntos `pazo_baion_local_v95` se conservan. La nueva base `pazo_baion_trabajos_v97` utiliza IndexedDB, pero no protege frente al borrado de datos del sitio o a pérdida del dispositivo. **Mantener copias JSON fuera del navegador.**
* Las incidencias importadas y las registradas se visualizan juntas, pero **no se fusionan ni sobrescriben automáticamente los GeoJSON originales**. Las fotos no se incrustan en el PDF ni en la exportación GeoJSON de puntos.
* En iOS, Safari no garantiza captura GPS durante suspensión o bloqueo. Los tiempos sin seguimiento no deben considerarse tiempo GPS efectivo; hay que comprobarlo en el dispositivo.
* Esri y Open-Meteo requieren conexión y reciben las solicitudes cartográficas o meteorológicas necesarias. Las predicciones de viento no sustituyen mediciones locales.
* Los registros históricos con mala calidad GPS pueden contener distancia y tiempo incoherentes; esta beta **advierte** de ello, sin reescribir el dato original.
* La exportación de rutas heredada (GPX, KML, GeoJSON) sigue siendo por ficha individual. El PDF conjunto y el mapa conjunto permiten revisar varios tramos de un mismo tratamiento.
* El generador PDF conserva el nombre de archivo interno `pdf-v95.js` por compatibilidad de publicación, pero identifica su contenido como **Beta v9.7**.

## Publicación en GitHub

Descomprimir el ZIP y subir los **11 archivos directamente a la raíz** del repositorio, en `main`, sustituyendo los nombres ya existentes. `campaign-v97.js` es **nuevo** y debe subirse junto con `index.html` y `app.js`; de lo contrario la numeración por campaña no funcionará. No subir el ZIP comprimido. No cambiar la URL de Pages, para conservar el origen de los datos locales.
