# PAZO BAION GPS · BETA v9.8.4

Versión de prueba del 10 de noviembre de 2026, basada en la Beta v9.8.3.

## Marcar la poda

1. Selecciona la parcela, elige **Poda** y pulsa **Comenzar poda** o **Retomar poda**.
2. Abre **Marcar tramos podados**. Toca el comienzo y después el fin de la parra o de la parte trabajada. El segundo toque guarda una raya independiente. El siguiente toque inicia otra.
3. **Guardar avance** archiva los tramos y el tiempo de esta intervención, deja la parcela en curso y permite cambiar de parcela.
4. Al volver a elegir **Poda** en esa parcela, se abre su ficha pendiente. El mapa distingue los tramos de la jornada de los tramos anteriores.
5. **Finalizar poda de la parcela** confirma el cierre de toda la parcela. Desde su informe puedes elegir otra parcela y trabajar con la misma configuración de jornada.

El punto azul muestra tu posición en directo si concedes permiso de ubicación. El botón de centrar te lleva a ese punto. La posición del operario se usa solo como referencia visual durante la poda y queda fuera de las fichas, las copias y los informes.

En el mapa, el comienzo se marca con un punto verde y el fin con uno ocre. Puedes borrar un comienzo antes del segundo toque o elegir un tramo guardado y quitarlo.

## Informe diario

En **Historial → Informe diario de poda**, elige la fecha y el operario. La vista y el PDF reúnen todas las parcelas en las que trabajó ese día. Incluyen un croquis por parcela, los tramos de ese operario, su tiempo activo registrado y el estado de cada parcela al cierre de la fecha consultada.

Las superficies y líneas antiguas siguen en la ficha de parcela. Los tramos anteriores que carecen de fecha u operario propios se consultan en esa ficha.

## Instalación y prueba

- Antes de actualizar, guarda la copia completa desde **Historial → engranaje → Exportar copia completa (JSON)**.
- Descomprime y sube los 11 archivos de la raíz a la rama publicada del mismo repositorio. Abre la aplicación desde el mismo sitio para acceder a sus datos locales.
- En Safari de iPhone, marca dos parras contiguas con cuatro toques, guarda el avance, retoma la parcela, ciérrala y empieza otra. Genera el informe de ese día desde el historial.
- Las pruebas técnicas verificaron el guardado por parejas, la continuidad entre fechas, el tiempo sin sumar el intervalo entre jornadas, la recuperación de tramos, el filtro por operario y el PDF de dos parcelas.
