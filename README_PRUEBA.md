# Pazo Baion GPS — Beta 3.0

## Cambios de esta beta

Esta versión toma como base la Beta 1.2 e integra únicamente el cambio visual ordenado para la pantalla “Informe de trabajo”.

La pantalla de informe queda adaptada a la referencia visual fijada:

- Cabecera centrada con botón circular de vuelta.
- Resumen de trabajo con cuatro tarjetas: tiempo activo, tiempo parado, sesiones y recargas.
- Leyenda de sesiones con puntos de color.
- Bloque “Sesiones de trabajo” con línea temporal, numeración, fecha, inicio, fin y tiempo activo.
- Bloque “Detalle por sesiones” en tabla.
- Bloque “Conclusión”.
- Aviso inferior con icono de información.

No se han integrado cambios funcionales ajenos a esta instrucción.

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
3. Carga `PARCELAS.geojson`.
4. Carga `INCIDENCIAS_.geojson`, aunque esté vacío.
5. Genera o abre un informe de trabajo.
6. Comprueba que la pantalla “Informe de trabajo” sigue la referencia visual fijada.
