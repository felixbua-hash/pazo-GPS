# Pazo Baion GPS — Beta 0.6 Profesional Privada Corregida

## Qué es
Beta profesional privada corregida de la app de viñedo GPS. Mantiene la estructura sin carpetas y sin datos sensibles incluidos.

## Privacidad
Esta versión NO incluye `PARCELAS.geojson` real ni `INCIDENCIAS_.geojson` real.
Al abrir la app se solicita seleccionar desde el terminal el archivo `PARCELAS.geojson`, que se guarda localmente en el dispositivo.

Advertencia: el mapa satelital online consulta teselas del proveedor de mapas. No sube el GeoJSON, pero sí consulta imágenes de la zona visualizada. Esta opción queda aceptada solo para beta, pendiente de valorar una solución offline/privada.

## Archivos
Todos los archivos están en raíz:
- index.html
- styles.css
- app.js
- data.js
- manifest.json
- VERSION.txt
- README_PRUEBA.md
- splash.png

## Funciones incluidas
- Pantalla de carga con versión visible.
- Carga local protegida de `PARCELAS.geojson`.
- Guardado local del mapa de parcelas.
- Configuración de jornada con operario, tractor y atomizador/cisterna.
- Aviso si se conserva una jornada de fecha anterior.
- Listas mixtas editables localmente.
- Selección táctil de parcela sobre mapa satelital.
- Pantalla de parcela seleccionada.
- Selección de tipo de trabajo.
- Calibración GPS con varias muestras.
- Inicio normal o inicio forzado si la precisión es insuficiente.
- Registro GPS con Comienzo, Parada, Continuar y Fin.
- Comienzo no reutilizable tras iniciar.
- Recargas múltiples y punto final único.
- Datos en pantalla: velocidad, parcial, total, distancia, precisión, estado y recargas.
- Incidencias con tipo, estado, observación, coordenada GPS y foto local.
- Solicitud de posición GPS al guardar incidencia si no hay posición activa.
- Fotos comprimidas localmente antes de guardarse.
- Tipos de incidencia iniciales y posibilidad de añadir nuevos tipos.
- Corrección GPS prudente: puntos originales, ruta depurada y clasificación válidos/dudosos/descartados.
- Informe ampliado con resumen, jornada, eventos, incidencias, calidad GPS y exportación.
- Historial local pulsable para abrir informes anteriores.
- Exportación JSON, CSV, GeoJSON, KML y GPX de ruta.
- Compartir resumen desde el móvil si el navegador lo permite.

## Prueba en iPhone
Para usar GPS real, abre la app desde GitHub Pages en HTTPS y permite ubicación precisa.
