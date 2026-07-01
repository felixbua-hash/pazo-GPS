# Pazo Baion GPS — Beta 1.9 reconstruida desde Beta 1.2

## Base utilizada

Esta versión parte de `Pazo Baion GPS Beta 1.2.zip` y aplica exclusivamente los cambios pendientes indicados para la reconstrucción.

No se ha usado Beta 1.4 ni Beta 1.5 como base.

## Cambios integrados

- Carga local y privacidad diferenciada en dos bloques: **Datos locales** y **Servicios externos**.
- Viento previsto limitado a **Aplicación de fitosanitarios**.
- En desbroce y otros trabajos no se muestra ni se registra viento.
- Registro de viento previsto con velocidad, racha, dirección, fuente, hora y coordenada de referencia.
- Nota obligatoria en informe: dato procedente de pronóstico meteorológico, no de medición directa en parcela.
- Umbrales de viento: verde 0-10,8 km/h; ámbar 10,9-15,3 km/h; rojo >15,3 km/h.
- Mapa de informe inicializado cuando la pantalla está visible y con aviso si no hay recorrido GPS registrado.
- Continuación de trabajos pendientes desde historial sin crear un trabajo nuevo.
- Sesiones de trabajo por fecha, inicio, fin, tiempo activo y tiempo parado.
- Pantallas de informe reconstruidas: Resumen general, Trabajo/sesiones, Eventos, GPS, Viento e Incidencias.
- Navegación del informe rediseñada: se elimina la botonera superior visible y el cambio de pantalla se realiza mediante deslizamiento horizontal dentro del informe.
- Historial con filtros Todos / Pendientes / Completados y borrado local con triple validación.

## Privacidad

Esta versión NO incluye `PARCELAS.geojson` real ni `INCIDENCIAS_.geojson` real.

Tampoco incluye coordenadas reales, rutas GPS reales ni datos reales de trabajo. Las capas se cargan localmente desde el dispositivo y se guardan en el navegador del terminal.

Advertencia: el mapa satelital online y el viento previsto pueden consultar proveedores externos usando la ubicación de referencia.

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

## Prueba recomendada en iPhone

1. Abrir la app y comprobar que la pantalla de carga dura 4 segundos.
2. Cargar `PARCELAS.geojson`.
3. Cargar `INCIDENCIAS_.geojson`, aunque esté vacío.
4. Crear un trabajo de desbroce y verificar que no aparece ni se registra viento.
5. Crear un trabajo de aplicación de fitosanitarios y verificar que aparece el registro de viento previsto.
6. Parar y continuar trabajo en el mismo día.
7. Dejar un trabajo pendiente y retomarlo desde historial con **Continuar trabajo**.
8. Revisar informe provisional y definitivo.
9. Revisar las pantallas Resumen, Trabajo, Eventos, GPS, Viento e Incidencias mediante deslizamiento horizontal dentro del informe.
10. Confirmar que el mapa del informe no queda gris y muestra aviso si no hay recorrido GPS.

## Nota de prueba

La revisión incluida antes de la entrega es estructural y sintáctica. La prueba real en iPhone debe hacerse en el dispositivo.
