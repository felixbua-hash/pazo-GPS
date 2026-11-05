# PAZO BAION GPS — Beta v9.6

Versión basada directamente en Beta v9.5; se conserva el código GPS, incidencias, viento, historial, informes y PDF.

## Cambios de interfaz
- En **Cargar capas del mapa** hay un botón **Ver historial de trabajos** accesible sin importar parcelas ni preparar jornada. El botón de regreso devuelve a carga de capas.
- **Consultar / cambiar conjuntos guardados** es ahora un botón desplegable inequívoco, con icono y etiqueta explicativa. Conserva todas las opciones de seleccionar, cargar y eliminar.
- Cuando hay una configuración de un día anterior, aparece una **ventana ornamental** con **Usar configuración anterior**, **Modificar configuración** y **Volver a cargar capas**. La ayuda **?** explica las opciones y tiene un botón para regresar al aviso. Las observaciones de la jornada anterior no se trasladan al nuevo día.
- **Configuración de jornada** presenta la fecha actual y los datos operario, tractor, atomizador/cisterna, observaciones con rótulos en negrita, cerca de sus campos. No incluye mensajes repetidos ni botón de historial.
- Desde **Seleccionar parcela**, regresar lleva a carga de capas si llegó directamente de allí, o a configuración de jornada si esa pantalla se utilizó antes.

## Pruebas recomendadas en Safari de iPhone
1. Tras actualizar GitHub Pages, recargar la página y confirmar `Beta v9.6`.
2. Pulsar **Ver historial de trabajos** antes de cargar capas y consultar una ficha antigua. Regresar debe devolver a carga de capas.
3. Pulsar el botón de conjuntos guardados: verificar apertura/cierre y cargar un conjunto (sin borrarlo).
4. Al cambiar de día, comprobar la ventana de reutilización: abrir **?**, leer, pulsar **Volver al aviso**, y elegir la acción adecuada.
5. En configuración de jornada, comprobar fecha, campos y controles Añadir/Editar/Eliminar.
6. Tras usar una jornada vigente, **Continuar al mapa** y **Volver** debe regresar a carga de capas. Si se ha comenzado desde configuración de jornada, volver debe regresar a ella.
7. Abrir informe de historial, compartir resumen, generar PDF y comprobar navegación.
8. En entorno de pruebas, intentar reanudar un trabajo pendiente sin jornada vigente: debe solicitar confirmar la configuración, permitir regresar a la ficha sin borrarla y, tras comenzar la jornada, recuperar ese trabajo en estado detenido (sin activar el GPS automáticamente).

## Protección de datos
No se incluyen capas GeoJSON reales. La actualización mantiene las claves localStorage v08, el almacén IndexedDB de conjuntos v9.5 y la estructura de los trabajos anteriores. No borres datos del sitio de Safari si deseas conservar registros.

## Límites conocidos
- El GPS en segundo plano con pantalla bloqueada no está garantizado en Safari.
- La cartografía y el viento requieren internet.
- Los informes PDF no incluyen las fotografías incrustadas.
