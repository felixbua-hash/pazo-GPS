# Pazo Baion GPS — Beta v4.0

## Cambios de esta beta

Esta versión aplica únicamente cambios de visualización conforme a la **Opción A · Premium vitícola ornamental**:

- Fondo marfil/pergamino y marco ornamental vitícola.
- Paleta visual verde oscuro, oro viejo, marfil y beige cálido.
- Botones, tarjetas, avisos, modales, paneles y controles adaptados al estilo premium ornamental.
- Pantalla de entrada actualizada para mostrar **Beta v4.0**.

## Alcance

No se han introducido cambios funcionales deliberados sobre GPS, mapas, almacenamiento local, cálculos, incidencias, historial ni exportaciones.

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
3. Comprueba que la pantalla de entrada muestra **Beta v4.0**.
4. Carga primero `PARCELAS.geojson`.
5. Carga después `INCIDENCIAS_.geojson`, aunque esté vacío.
6. Revisa que las pantallas internas mantienen la línea visual Premium vitícola ornamental.
