# Fluidez lectora automatizada · prototipo abierto

Un programa escucha a alguien leer en voz alta y cuenta las **palabras correctas por
minuto**, la misma medida que hoy toma un evaluador con cronómetro y una hoja de papel.
Corre entero **en el navegador**: el audio no sale del dispositivo y no hay servidor, ni
clave de servicio, ni costo por uso.

**En línea:** [la página](https://ezequielmolina-lang.github.io/fluidez-lectora-demo/) ·
[el asistente del evaluador](https://ezequielmolina-lang.github.io/fluidez-lectora-demo/asistente.html)

## Lo que hay que saber antes de mirarlo

**No es un instrumento de evaluación y no debe usarse para calificar a nadie.** Todo lo que
se muestra se midió con **voz adulta y sintetizada**: nunca se probó con niños peruanos, y
nunca se comparó contra un panel de evaluadores humanos. Para que sirva hace falta
entrenarlo y validarlo con grabaciones de niños del Perú, incluyendo español andino y
amazónico. Esa es la pieza que falta, y no es un detalle: es lo único que decide si esto
funciona.

El ejemplo de la página usa una lectura con **diez errores inyectados en posiciones
conocidas**, así que la respuesta correcta se sabe antes de medir y se puede decir si el
programa acierta.

## Qué hay acá

| Archivo | Qué es |
|---|---|
| `index.html` | La página: qué es, por qué importa, los benchmarks de la región, el ejemplo y la prueba con la propia voz |
| `asistente.html` | **El asistente del evaluador**: graba, devuelve la prueba marcada como borrador, y la persona corrige con un toque |
| `motor.js` | El motor entero: normalización, alineación global, sinalefa, puntaje y la regla de corte |
| `estimulos.json` | Los seis estímulos: letras, sílabas, palabras, palabras sin sentido y dos formas del pasaje |
| `datos.json` | Salida real de los dos motores de escritorio sobre la grabación de ejemplo, con la verdad conocida |
| `lectura.mp3` | La grabación sintetizada del ejemplo, 41 s |
| `manifest.json`, `sw.js` | Lo que permite **instalarlo como app** y que funcione **sin señal** |

## El asistente, que es la parte desplegable

El evaluador aplica la prueba como siempre, con un teléfono que graba. El sistema devuelve
**el borrador marcado** y el evaluador corrige lo que esté mal con un toque. **El puntaje
que vale es siempre el del humano.**

No requiere que el modelo sea bueno: requiere que sea útil, que es un umbral mucho más bajo.
Y tiene una propiedad que vale más que todo lo demás: **cada corrección del evaluador es una
etiqueta de entrenamiento**, con el audio al lado. La herramienta que recoge los datos es la
misma que después reemplaza el conteo manual.

Cubre **las cinco subtareas** del protocolo, con la grilla del evaluador y la **regla de
corte temprano**. Con una advertencia que la propia app repite: el reconocedor libre
transcribe palabras, no sonidos sueltos, así que en letras y sílabas el borrador viene mal
casi siempre. Están incluidas para medir cuánto falta, no para simular que ya funcionan.

### Dos formas de mostrarle los ítems al chico, y solo una es el instrumento

- **Hoja completa**: los cien ítems a la vista, diez por fila, como en el papel. Es el
  instrumento, y es el único modo cuyo puntaje se compara con las normas publicadas.
- **De a uno**: un ítem gigante por pantalla. En un teléfono se lee mucho mejor y cada ítem
  queda con su audio limpio, que es la mejor etiqueta para entrenar. Pero se pierde el
  barrido visual, que es parte de lo que la tarea mide, y el ritmo lo marca el dedo: **ese
  puntaje no se compara con ninguna norma**. Queda registrado en el campo `modo`.

## Dos invariantes del código, que no son detalles

1. **Un audio que no se pudo evaluar no es un cero.** Si sale mudo, con ruido o muy corto, el
   sistema devuelve `NO_EVALUABLE` **con el motivo**, nunca `0`. Si no, mediría la calidad
   del micrófono y la llamaría fluidez, y quien grabó mal puntuaría peor que quien grabó
   bien.
2. **Descontinuado sí es un cero, y es legítimo.** Si no hay ningún acierto en los primeros
   diez ítems, el protocolo manda interrumpir: se escuchó al chico intentar. Los dos casos se
   ven idénticos en la salida del reconocedor y significan lo contrario, así que la regla de
   corte **solo se aplica después de verificar que hubo habla**.

## Licencia

El código de este repositorio está bajo **[licencia MIT](LICENSE)**: se puede usar, copiar,
modificar y distribuir, también comercialmente, con solo conservar el aviso de copyright. Los
estímulos de `estimulos.json` van bajo la misma licencia, con la advertencia de que **no están
validados**.

Queda aparte lo que no es software: las especificaciones de subtareas, tiempos y reglas de
corte derivan del EGRA Toolkit bajo Creative Commons Attribution 4.0, y esa atribución se
mantiene. El detalle está en el archivo [LICENSE](LICENSE).

## Atribución y modelos

Las especificaciones de subtareas, tiempos y reglas de corte son una adaptación de un trabajo
original de RTI International bajo Creative Commons Attribution 4.0: *Early Grade Reading
Assessment (EGRA) Toolkit, Second Edition* (2016). **Los estímulos son de elaboración propia
y requieren revisión de un especialista en lengua antes de cualquier uso en campo.**

Modelos, los dos de pesos abiertos: **Whisper** (MIT), que en el navegador corre como
`onnx-community/whisper-base_timestamped` vía transformers.js, y
`jonatasgrosman/wav2vec2-large-xlsr-53-spanish` (Apache 2.0) en el motor de escritorio.
