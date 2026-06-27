# Pazo Baion GPS — Beta 0.8 Profesional Privada · Mapa reprogramado

## Qué corrige esta beta

Esta versión corrige los problemas detectados en iPhone en la Beta 0.6:

- La pantalla de carga ya permite cargar dos capas separadas:
  - `PARCELAS.geojson`
  - `INCIDENCIAS_.geojson`
- `PARCELAS.geojson` se valida como capa de polígonos.
- `INCIDENCIAS_.geojson` se valida como capa de incidencias y puede estar vacía. No se exige que tenga polígonos.
- Se refuerza la inicialización de Leaflet en iPhone: invalidación de tamaño, reajuste de límites y redibujado de teselas.
- Las parcelas se dibujan encima del satélite con capa vectorial visible.
- La capa importada de incidencias se dibuja en los mapas si contiene geometrías.

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

## Prueba recomendada

1. Sube todos los archivos del ZIP a la raíz de GitHub.
2. Abre la app desde GitHub Pages.
3. Carga primero `PARCELAS.geojson`.
4. Carga después `INCIDENCIAS_.geojson`, aunque esté vacío.
5. Pulsa continuar y comprueba que el mapa se centra y que las parcelas aparecen encima del satélite.


## Corrección específica Beta 0.8
Esta versión reprograma la visualización del mapa para iPhone/Safari:
- El CSS crítico de Leaflet se integra localmente en `styles.css` para no depender de que cargue la hoja CSS externa.
- El mapa se destruye y recrea al entrar en las pantallas de mapa, evitando heredar tamaños internos erróneos.
- La pantalla “Seleccionar parcela” usa altura explícita calculada con la altura real de la ventana.
- Se fuerza el ajuste de tamaño y el encuadre después de que el contenedor tenga tamaño real.
- Se mantienen visibles los botones de carga y navegación.
