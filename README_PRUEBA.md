# Pazo Baion GPS — Beta v6.0

Versión generada a partir de Beta v5.0.

Mantiene la línea visual **Opción A · Premium vitícola ornamental** y corrige únicamente el motor de tiempos, informe provisional/definitivo y guardado asociado.

## Correcciones Beta v6.0

- El informe provisional ya no suma horas usando `Date.now()` indefinidamente si el trabajo quedó abierto o la app estuvo en segundo plano.
- Los informes usan un reloj de trabajo basado en registros guardados: eventos, GPS, paradas, reanudaciones y fin.
- Al finalizar, se congela un `finalSnapshot` con tiempo activo, tiempo parado, tiempo transcurrido, distancia, recargas, paradas e incidencias.
- El informe definitivo se abre desde ese snapshot congelado y no desde un trabajo abierto.
- Se mantienen los tramos de trabajo entre paradas, hora de inicio, hora de parada, hora de continuación y hora de fin.
- Se refuerza la diferencia entre resumen provisional y informe definitivo.

## No modificado

- Visualización ornamental de Beta v4/v5.
- Estructura visual de pantallas.
- CSS visual.
- Mapas, capas GeoJSON, incidencias y configuración de jornada salvo uso de datos ya existentes para cálculo de tiempos.

## Archivos incluidos

- index.html
- styles.css
- app.js
- data.js
- manifest.json
- splash.png
- app-frame.png
- VERSION.txt

No se incluyen `PARCELAS.geojson` ni `INCIDENCIAS_.geojson` reales.

## Prueba mínima obligatoria

1. Iniciar trabajo y abrir resumen sin finalizar: debe indicar resumen provisional y no inflar horas sin registros.
2. Iniciar → parada → continuar → fin: el informe definitivo debe congelar tramos y tiempos.
3. Abrir historial: el trabajo finalizado debe aparecer como completado.
4. Volver a abrir el informe desde historial: los tiempos deben permanecer iguales, sin seguir sumando.
