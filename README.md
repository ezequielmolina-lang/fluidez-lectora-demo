# Fluidez lectora automatizada · demostración

Página estática que muestra un prototipo abierto para puntuar la fluidez lectora en español
con reconocimiento de voz, y **cuánto se equivoca**.

No es un instrumento de evaluación. Todo lo que se muestra se midió con voz adulta y
sintetizada: **nunca se probó con niños peruanos**. Para que sirva hace falta entrenarlo y
validarlo con grabaciones de niños del Perú, incluyendo español andino y amazónico.

La demostración usa una lectura con **diez errores inyectados en posiciones conocidas**, así
que la respuesta correcta se sabe antes de medir y se puede decir si el programa acierta.

## Contenido

| Archivo | Qué es |
|---|---|
| `index.html` | La página. Sin dependencias ni servidor |
| `datos.json` | Salida real de los dos motores sobre la grabación, y la verdad conocida |
| `lectura.mp3` | La grabación sintetizada, 41 s |

## Atribución

Las especificaciones de subtareas, tiempos y reglas de corte son una adaptación de un trabajo
original publicado por RTI International y licenciado bajo Creative Commons Attribution 4.0:
*Early Grade Reading Assessment (EGRA) Toolkit, Second Edition* (2016). Los estímulos son de
elaboración propia.

Modelos usados, ambos de pesos abiertos: Whisper (MIT) y
`jonatasgrosman/wav2vec2-large-xlsr-53-spanish` (Apache 2.0).
