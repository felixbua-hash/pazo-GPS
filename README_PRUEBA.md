# Pazo Baion GPS — Beta v7.0

Versión generada a partir de Beta v6.0.

## Correcciones Beta v7.0

Correcciones aplicadas únicamente sobre los fallos detectados tras la prueba de Beta v6.0:

- Separación más robusta entre trabajo activo, trabajo pendiente e informe abierto desde historial.
- Normalización de fichas finalizadas antes de abrir informe.
- Cierre automático de tramos abiertos cuando existe finalización real del trabajo.
- Snapshot final congelado reconstruido sin depender de valores antiguos.
- Recuperación de ruta en informe desde `pointsClean`; si falta, desde `pointsOriginal`; si tampoco existe, aviso explícito.
- Mapa de informe destruido y recreado de forma segura para poder abrir la misma ficha varias veces.
- Historial guardado con ficha final independiente del estado activo.

## Sin cambios intencionados

- No se modifica la visualización ornamental de Beta v6.0.
- No se modifican pantallas, estilos ni composición visual.
- No se incluyen `PARCELAS.geojson` ni `INCIDENCIAS_.geojson`.
