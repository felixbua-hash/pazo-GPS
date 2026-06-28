# Pazo Baion GPS — Beta 1.2

## Cambios de esta beta

Esta versión integra únicamente los cambios visuales definidos para la Beta 1.2:

- Nueva pantalla de carga aprobada, mostrada durante 4 segundos.
- Estilo de botones e iconos tipo Champán elegante.
- Marco ornamental sutil como fondo de todas las pantallas internas, excepto la pantalla de carga.

## Privacidad

Esta versión NO incluye `PARCELAS.geojson` real ni `INCIDENCIAS_.geojson` real.
Las capas se cargan localmente desde el dispositivo y se guardan en el navegador del terminal.

Advertencia: el mapa satelital online consulta teselas del proveedor de mapas. No sube los GeoJSON, pero sí consulta imágenes de la zona visualizada.

## Archivos

Todos los archivos están en raíz para subirlos juntos a GitHub:

- index.html
- styles.css
- app.js
- data.js
- manifest.json
- VERSION.txt
- README_PRUEBA.md
- splash.png
- app-frame.png

## Prueba recomendada

1. Sube todos los archivos del ZIP a la raíz de GitHub.
2. Abre la app desde GitHub Pages.
3. Comprueba que la pantalla de carga se muestra durante 4 segundos.
4. Carga primero `PARCELAS.geojson`.
5. Carga después `INCIDENCIAS_.geojson`, aunque esté vacío.
6. Revisa que las pantallas internas usan el nuevo marco y los botones Champán elegante.
