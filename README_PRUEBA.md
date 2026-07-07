# Pazo Baion GPS — Beta v5.0

## Cambios de esta beta

Esta versión mantiene la línea visual **Opción A · Premium vitícola ornamental** de la Beta v4.0 y corrige únicamente los fallos funcionales detectados en la prueba de campo:

- Velocidad mostrada como **velocidad GPS estimada**, con cálculo suavizado para evitar saltos erráticos.
- Registro de tiempos corregido:
  - hora de inicio,
  - tramos de trabajo entre paradas,
  - hora de cada parada,
  - tiempo parado,
  - tiempo acumulado de trabajo.
- Punto de **Comienzo** guardado con coordenada GPS válida cuando esté disponible.
- Botón **Resumen** reforzado para abrir el informe de forma estable.
- Guardado en **Historial** reforzado, con recuperación de trabajos activos y respaldo compacto si el almacenamiento local no acepta el registro completo.

## Alcance

No se han introducido cambios visuales nuevos sobre la línea Premium vitícola ornamental.  
No se han modificado mapas, parcelas reales, incidencias reales ni datos de usuario.

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
3. Comprueba que la pantalla de entrada muestra **Beta v5.0**.
4. Carga `PARCELAS.geojson` y `INCIDENCIAS_.geojson` desde el dispositivo.
5. Inicia un trabajo de prueba.
6. Comprueba que aparece el punto de comienzo.
7. Realiza una parada y una continuación.
8. Finaliza el trabajo.
9. Pulsa Resumen y verifica que se abre el informe.
10. Abre Historial y comprueba que aparece el trabajo finalizado.
