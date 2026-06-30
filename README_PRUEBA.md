# Pazo Baion GPS — Beta 1.5

Versión privada de prueba.

## Base

Esta versión se reconstruye tomando como base la **Beta 1.2** e integrando de nuevo las mejoras válidas de **Beta 1.3**.  
No se utiliza la Beta 1.4 como base.

## Cambios integrados

- Pantalla de carga limpia, actualizada a Beta 1.5.
- Módulo de viento previsto durante el trabajo activo.
- Registro de viento previsto, racha, dirección, fuente y avisos.
- Informe de viento con tabla, resumen y advertencia de que los datos proceden de pronóstico meteorológico y no de medición directa en parcela.
- Corrección del mapa del informe de trabajo para recrearlo al abrir la pantalla y dibujar parcela, recorrido, eventos e incidencias cuando existan.
- Botón “Continuar trabajo” en trabajos pendientes del historial.
- Registro de sesiones de trabajo por fecha para trabajos retomados en días distintos.
- Triple validación para borrar historial local.
- Carga local protegida de capas.

## Seguridad de datos

Este ZIP no incluye:

- PARCELAS.geojson real.
- INCIDENCIAS_.geojson real.
- Coordenadas reales.
- Rutas GPS reales.

Las capas reales deben cargarse localmente desde el dispositivo.
