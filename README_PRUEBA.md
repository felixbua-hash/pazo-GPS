# Pazo Baion GPS — Beta 1.4

Versión privada de prueba.

## Cambios de esta beta

- Privacidad corregida en la pantalla de carga de capas: datos locales y servicios externos diferenciados.
- Viento previsto solo para trabajos de “Aplicación de fitosanitarios”.
- Registro de viento únicamente durante trabajo activo.
- Umbrales de viento en km/h:
  - Verde / recomendado: 0–10,8 km/h.
  - Ámbar / precaución: >10,8–15,3 km/h.
  - Rojo / exceso: >15,3 km/h.
- Informe de viento con resumen superior, mapa con recorrido y flechas, tabla por intervalos y conclusión.
- Pantallas de informe con composición visual fijada para Resumen, Trabajo, Eventos, GPS e Incidencias.
- Mapa del informe reforzado para representar parcela, recorrido GPS, incidencias, eventos y flechas de viento cuando existan datos.
- Trabajos pendientes continúan desde historial y conservan sesiones por días.

## Seguridad de datos

Este ZIP no incluye:

- PARCELAS.geojson real.
- INCIDENCIAS_.geojson real.
- Coordenadas reales.
- Rutas GPS reales.

Las capas reales deben cargarse localmente desde el dispositivo.
