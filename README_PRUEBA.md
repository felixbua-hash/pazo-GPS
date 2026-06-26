# Pazo Baion GPS · BETA 0.3

# Pazo Baion GPS · Beta funcional 0.1

Primera beta para pruebas internas de flujo y registro GPS.

## Contenido

- `index.html`: aplicación web.
- `styles.css`: estilos.
- `app.js`: lógica de pantallas, parcelas, GPS, registro e informe.
- `data.js`: parcelas embebidas para carga directa.
- `data/PARCELAS.geojson`: parcelas exportadas desde SW Maps.
- `data/INCIDENCIAS_.geojson`: capa vacía de incidencias.
- `manifest.json`: base para instalación como app web.

## Qué permite probar

1. Pantalla de bienvenida de unos 4 segundos.
2. Configuración de jornada: operario, tractor y atomizador/cisterna.
3. Mapa satelital real como fondo.
4. Capa limpia de parcelas desde `PARCELAS.geojson`, sin puntos de edición de SW Maps.
5. Selección táctil de parcela.
6. Pantalla de parcela seleccionada.
7. Menú de trabajo: aplicación de fitosanitarios, desbroce u otro.
8. Calibración/comprobación GPS previa.
9. Registro de trabajo con estados:
   - Preparado
   - Trabajando
   - Parado
   - Finalizado
10. Botones según estado:
   - Antes de iniciar: Comienzo
   - Trabajando: Parada
   - Parado: Continuar
   - Finalizado: Generar informe
11. Menú de parada:
   - Recarga cisterna
   - Pausa técnica / incidencia
   - Avería / revisión
   - Otro motivo
   - Fin de tratamiento de la parcela
12. Datos en pantalla:
   - Velocidad
   - Tiempo parcial
   - Tiempo total
   - Distancia
   - Precisión GPS
   - Recargas
13. Corrección GPS básica:
   - guarda puntos originales
   - crea ruta depurada
   - descarta precisión > 15 m
   - descarta saltos/velocidades no lógicas
   - marca puntos dudosos
14. Informe en pantalla.
15. Historial local.
16. Exportación JSON y CSV.
17. Compartir resumen si el navegador lo permite.

## Cómo probar

### Opción recomendada

Subir todos los archivos a GitHub Pages o a un servidor HTTPS.

Esto es importante porque iPhone/Safari suele exigir HTTPS para que la geolocalización funcione correctamente.

### Opción rápida en ordenador

Desde la carpeta de la app:

```bash
python3 -m http.server 8000
```

Abrir:

```text
http://localhost:8000
```

## Limitaciones de esta beta

- El mapa satelital depende de conexión a internet.
- El registro GPS real requiere permisos de ubicación y navegador compatible.
- El informe PDF se genera mediante la opción del navegador `Ver / imprimir PDF`.
- La integración completa con productos fitosanitarios, dosis y cuaderno de tratamientos queda pendiente.
- Las fotos de incidencias quedan pendientes.
- No hay sincronización en nube.
- Los datos se guardan localmente en el dispositivo mediante `localStorage`.

## Criterios respetados

- No se usan capturas de SW Maps como base final.
- SW Maps solo aporta el GeoJSON de parcelas.
- La app muestra mapa satelital real + polígonos limpios.
- No aparecen puntos/vértices de edición de SW Maps.
- El punto de comienzo es único.
- El punto final es único.
- Puede haber varias recargas/continuaciones.
- Si el GPS no tiene precisión suficiente, la app permite comenzar igualmente y lo registra.
