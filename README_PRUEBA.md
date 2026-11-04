# PAZO BAION GPS — Beta v9.5

**Base:** Beta v9.4 · Premium vitícola ornamental.  
**Fecha:** 03/11/2026.  
**Entrega:** archivos en la raíz del ZIP, sin subcarpetas y sin GeoJSON ni otros datos reales de explotación.

## Cambios respecto de v9.4

1. **Pantalla de inicio limpia.** El logotipo, nombre, subtítulo y versión se representan por separado en HTML/CSS. Solo se muestra la parte paisajística de la ilustración original, evitando la reproducción de horas, baterías, cobertura y textos superpuestos de la antigua captura.
2. **Carga de capas más clara.** Los campos para seleccionar PARCELAS.geojson e INCIDENCIAS_.geojson tienen apariencia inequívoca de botones táctiles.
3. **Privacidad bajo consulta.** El aviso largo deja de ocupar permanentemente la pantalla; el botón «Consultar» abre la explicación y «Volver a cargar capas» cierra la consulta.
4. **Varios conjuntos de capas.** Se puede nombrar y guardar cada conjunto de parcelas con sus incidencias en **IndexedDB**, elegir uno ya guardado, cargarlo y eliminarlo independientemente. Se elimina la duplicación «Continuar»/«Usar capas guardadas»: solo «Continuar al mapa» avanza a la siguiente pantalla. Al importar nuevas parcelas, se desvinculan las incidencias anteriores para no mezclar fincas.
5. **Compatibilidad de datos.** Se mantienen las claves de trabajos e historial `pbgps_*_v08`. La app intenta migrar el par de capas anterior a un conjunto denominado «Capas anteriores (v9.4)» en el navegador donde ya estaban guardadas; no elimina los datos originales.
6. **Validez GPS.** Puntos con latitud/longitud ausentes, nulas, fuera de rango o (0,0) dejan de convertirse en rutas aparentemente válidas. Se evita consultar viento en (0,0) por coordenadas ausentes. GPS: precisión buena hasta 5 m, aceptable hasta 10, límite hasta 20 y mala por encima de 20.
7. **Fiabilidad del viento.** Una consulta fallida no entra como 0 km/h en estadísticas; se diferencian lecturas válidas de intervalos sin dato. Alertas orientativas: verde hasta 4,5 km/h, ámbar de más de 4,5 a 9 km/h y rojo por encima de 9 km/h. Las direcciones válidas aparecen como flechas sobre los mapas donde exista coordenada de consulta. **Son datos meteorológicos modelizados, no medición directa en la parcela.**
8. **Trabajos y conservación.** Protección frente a sobrescribir sin aviso un trabajo activo al iniciar otro o cargar otras parcelas. Recuperación también de trabajos finalizados que no pudieron incluirse en historial. Se verifican más operaciones de guardado y se advierte de fallos. Se conserva la copia JSON previa al guardado compacto autorizado. No se descartan automáticamente trabajos al alcanzar 200 registros.
9. **Interrupciones del navegador.** Se detecta la suspensión/reapertura y se cierra conservadoramente el tramo GPS; los periodos sin seguimiento no se imputan como trabajo activo ni como tiempo operativo. Los tramos se presentan con fecha completa y existe desglose de tiempos por día.
10. **Incidencias.** Se comprueba el resultado de guardado. Una incidencia abierta desde una parcela no se adjunta por error a un trabajo activo de otra parcela.
11. **Informe.** Se mantiene el informe visual unificado, se reduce la redundancia en trabajos pendientes, se amplía el mapa y se habilita un botón «Ampliar mapa» y otro «Cerrar mapa». Se recupera la acción visible «Compartir resumen» con el texto previamente acordado.
12. **PDF real, local.** El botón «Generar / guardar PDF» crea directamente un archivo PDF A4 multipágina con cabecera, jornada, tiempos, desglose diario, ruta esquemática vectorial, GPS, viento, eventos e incidencias, mediante `pdf-v95.js`, sin imprimir la pestaña del navegador. Es un documento, no una captura de pantalla. Las fotografías de incidencias **no se incrustan** en el PDF; hay que conservar las fichas originales o el respaldo JSON para disponer de ellas.

## Guía de uso de las capas guardadas

- Importa PARCELAS.geojson y, si existe, INCIDENCIAS_.geojson. Una capa de incidencias vacía es válida.
- Escribe en «Nombre para guardar este conjunto» algo identificable, por ejemplo `Pazo Baion`, y pulsa **Guardar conjunto**.
- Para otra finca, selecciona sus nuevas parcelas e incidencias, escribe un nombre distinto y vuelve a guardarlas.
- Abre **Consultar / cambiar conjuntos guardados**, elige el conjunto exacto y pulsa **Cargar seleccionado**. Comprueba la confirmación y pulsa **Continuar al mapa**.
- Si faltan incidencias, puedes trabajar con parcelas solas; al guardar el conjunto se crea una capa de incidencias vacía, no se reutiliza una ajena.

## Importante antes de probar en el campo

- Esta beta sigue siendo una **aplicación web**. Safari en iPhone puede suspender la geolocalización o JavaScript con la pantalla bloqueada o al usar otra aplicación. Se ha mejorado el tratamiento de interrupciones, **no se garantiza GPS continuo en segundo plano**. Al volver, puede ser necesario pulsar «Continuar».
- La cartografía Leaflet se carga desde CDN, el satélite desde Esri y el viento desde Open-Meteo. Se requiere conexión para esos servicios: **no existe modo sin conexión completo**.
- Los conjuntos de capas guardados dependen del almacenamiento local del navegador/URL de origen. Cambiar de dominio o borrar «Datos de sitios web» puede hacerlos desaparecer. Conserva siempre copias de los GeoJSON y los informes importantes.
- Si actualizas la web donde estaba v9.4, usa **exactamente la misma URL/origen** para que Safari pueda recuperar los datos de esa versión. No borres datos de Safari mientras compruebas la migración.
- Antes de usarla para una jornada real, verifica en tu iPhone la importación, navegación, GPS físico, cambios de conexión, paradas, recuperación y exportación de PDF. Las pruebas automáticas y de Chromium no sustituyen una prueba física.
- Al eliminar un conjunto se borran sus capas guardadas de IndexedDB, **no** los GeoJSON originales ni el historial de trabajos.

## Validación técnica de esta entrega

- Comprobación de sintaxis JavaScript de `app.js`, `data.js` y `pdf-v95.js`.
- Pruebas de regresión con datos simulados: coordenadas nulas, (0,0), falsa ruta, viento sin dato y localización de consulta, interrupción simulada de 48 horas y desglose diario.
- Prueba móvil de interfaz: privacidad, importación de GeoJSON sintéticos, guardar dos conjuntos distintos, seleccionar y cargar uno, abrir el informe y generar un PDF descargable.
- PDF validado mediante `pdfinfo`, `pdftotext` y renderizado de página. Se ha probado con datos **ficticios**, que no se incluyen en el ZIP.

## Contenido

`index.html`, `styles.css`, `app.js`, `data.js`, `pdf-v95.js`, `splash.png`, `app-frame.png`, `manifest.json`, `VERSION.txt`, `README_PRUEBA.md`.
