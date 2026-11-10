# PAZO BAION GPS · BETA v9.8.2

Versión de evaluación del 9 de noviembre de 2026, basada en la Beta v9.8.1.

## Flujo de trabajo

1. **Conjunto de mapas.** La pantalla inicial muestra las capas activas y el acceso al mapa. «Cambiar o importar conjunto» reúne la importación de parcelas e incidencias, la gestión de conjuntos y la exportación de incidencias. El historial general sigue disponible desde la pantalla inicial.
2. **Selección.** Toca una o varias parcelas en el mapa y confirma con «Elegir tipo de trabajo». Si marcas varias, elige la parcela que vas a trabajar en ese momento. Cada parcela mantiene su propia ficha. Puedes elegir otra de las seleccionadas y continuar con la misma labor.
3. **Trabajo.** La configuración de jornada, si hace falta, se pide después de elegir la labor. Fitosanitarios permite vincular la ficha a un tratamiento registrado o crear un nuevo tratamiento de campaña. El historial de la selección muestra los trabajos por parcela y ofrece acceso a los pendientes.
4. **Poda.** Comienza la poda desde su ficha. Al terminar, elige «Delimitar zonas podadas». Pulsa «Dibujar zona», toca las esquinas del contorno y guarda la zona. Puedes deshacer un vértice o quitar un contorno guardado y dibujarlo de nuevo. Repite el dibujo para tramos separados. «Finalizar poda» guarda la ficha con el operario, la parcela, las fechas y los contornos. Los mapas del informe visual y del PDF muestran las zonas. Este flujo registra el tiempo y las zonas manuales sin seguimiento GPS de la poda.

## Datos e instalación

- La actualización utiliza los mismos almacenes locales y el mismo formato de copia de seguridad que la Beta v9.8.1. Los trabajos históricos sin datos suficientes para identificar su parcela se consultan desde el historial general.
- Antes de actualizar, exporta una copia completa desde **Historial → engranaje → Exportar copia completa (JSON)** y guárdala fuera de Safari.
- Descomprime y sube los 11 archivos de la raíz a la rama publicada del mismo repositorio. Conserva el mismo dominio y ruta de acceso para que el navegador siga usando el almacenamiento del sitio.
- El ZIP contiene la aplicación y sus recursos. Las parcelas, rutas, zonas podadas e incidencias se guardan en el dispositivo durante el uso.

## Auditoría de la versión

- Integridad del ZIP, archivos en la raíz, referencias HTML y sintaxis JavaScript verificados.
- Pruebas con datos ficticios del mapa, selección múltiple, configuración diferida, historial contextual, homónimos de distintos conjuntos, pendientes y vinculación a un tratamiento existente.
- Pruebas simuladas de poda con pausa y dos contornos independientes. Se comprobó el guardado de la ficha y la presencia de ambas zonas en el informe HTML y el PDF A4.
- Pendiente de prueba en Safari de iPhone con la aplicación desplegada. Verifica los toques del mapa, el guardado tras volver a abrir Safari y la exportación de la copia completa JSON.
