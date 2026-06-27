# Pazo Baion GPS - Beta 0.2

Versión generada para pruebas funcionales iniciales en GitHub Pages.

## Criterio visual aplicado

Esta beta usa como pantallas base las imágenes aprobadas en el chat:

1. Pantalla de carga con versión **Beta 0.2**.
2. Configuración de jornada.
3. Selección de parcela.
4. Parcela seleccionada.
5. Tipo de trabajo.
6. Calibración GPS.
7. Registro de trabajo en estado trabajando.
8. Registro de trabajo en estado parado/continuar.
9. Informe de trabajo.
10. Historial de trabajos.

Las pantallas son **estáticas y no deslizantes**. La navegación se realiza mediante zonas táctiles invisibles sobre los botones representados en las imágenes, para respetar estrictamente la estética aprobada.

## Funciones incluidas

- Splash screen inicial de unos 4 segundos.
- Configuración de jornada: operario, tractor y atomizador/cisterna.
- Selección de parcela.
- Pantalla de parcela seleccionada.
- Selección de tipo de trabajo: aplicación de fitosanitarios, desbroce u otro.
- Calibración/comprobación GPS previa.
- Opción de comenzar de todos modos si la precisión no es suficiente.
- Registro GPS con estados: trabajando, parado y continuar.
- Botón Comienzo no permanece visible una vez iniciado el trabajo.
- Botón Parada en estado trabajando.
- Pantalla de parada con motivos: recarga cisterna, pausa técnica/incidencia, avería/revisión, otro motivo, fin de tratamiento y cancelar.
- Botón Continuar solo en estado parado cuando procede reanudar.
- Fin de tratamiento genera informe.
- Historial local en el navegador.
- Exportación básica JSON y CSV.
- Datos de GPS originales y depurados guardados en memoria local.
- Clasificación básica GPS: buena, aceptable, insuficiente o mala.
- Marcado de puntos válidos, dudosos y descartados.

## Estructura de archivos

```text
pazo_baion_gps_beta_0_2/
├── index.html
├── styles.css
├── app.js
├── data.js
├── manifest.json
├── VERSION.txt
├── README_PRUEBA.md
├── assets/
│   ├── splash.png
│   ├── config.png
│   ├── select-parcel.png
│   ├── parcel-selected.png
│   ├── work-type.png
│   ├── gps-calibration.png
│   ├── work-working.png
│   ├── work-stopped.png
│   ├── report.png
│   └── history.png
└── data/
    ├── PARCELAS.geojson
    └── INCIDENCIAS_.geojson
```

## Instalación en GitHub Pages

Subir todos los archivos descomprimidos al repositorio, manteniendo la carpeta `assets` y la carpeta `data`.

Después activar GitHub Pages:

```text
Settings → Pages → Deploy from a branch → main → /root → Save
```

La app debe abrirse desde la URL HTTPS de GitHub Pages para que el navegador permita el GPS.

## Limitaciones de esta beta

- Las pantallas son imágenes estáticas aprobadas; los valores visuales que aparecen en las imágenes son de ejemplo.
- Las funciones reales se guardan internamente en localStorage y en exportaciones JSON/CSV.
- No se redibuja aún una ruta real sobre el mapa visual de la pantalla, porque se ha priorizado respetar las pantallas aprobadas tal como están.
- Para pruebas GPS reales, mantener la app abierta y con permiso de ubicación precisa.

