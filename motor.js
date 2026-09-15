/* Motor de fluidez lectora que corre ENTERO en el navegador.
 *
 * El audio nunca sale del dispositivo. No hay servidor: el modelo se descarga una vez y
 * la grabacion se procesa localmente. Eso no es una optimizacion, es el punto: se trata
 * de voz de personas leyendo, y la forma mas segura de proteger una grabacion es que no
 * viaje a ningun lado.
 *
 * Es un port de la logica de flulec/ en Python, con las mismas invariantes. Si cambia una
 * regla alla, tiene que cambiar aca, y por eso los comentarios repiten el POR QUE y no
 * solo el QUE.
 *
 * LIMITE IMPORTANTE: el modelo que corre aca es mucho mas chico que el de la version de
 * escritorio (whisper base contra whisper small mas wav2vec2 large). Los numeros que
 * produce son peores. Sirve para que se vea el mecanismo, no para comparar contra los
 * resultados de la pagina.
 */

/* ---------------------------------------------------------------- normalizacion */

const SIN_PUNTUACION = /[^\p{L}\p{N}\s]/gu;

/* Forma canonica para COMPARAR, nunca para mostrar.
 *
 * La enie y la dieresis NO se quitan: en espanol distinguen palabras ("ano" contra "anio",
 * "pinguino" contra "pingueino"). Colapsarlas inventa aciertos que el lector no tuvo. La
 * tilde aguda si se quita, porque los modelos de voz la escriben de forma inconsistente.
 *
 * Se hace descomponiendo y quitando SOLO el acento agudo y el grave (U+0301 y U+0300),
 * dejando intactas la tilde de la enie (U+0303) y la dieresis (U+0308). La version
 * anterior usaba caracteres centinela para proteger la enie, lo que llenaba el archivo de
 * bytes de control y hacia que git lo tratara como binario. Esto hace lo mismo sin trucos.
 */
export function normalizar(palabra) {
  return String(palabra)
    .toLowerCase()
    .trim()
    .replace(SIN_PUNTUACION, "")
    .normalize("NFD")
    .replace(/[̀́]/g, "")
    .normalize("NFC");
}

/* ---------------------------------------------------------------- sinalefa */

const VOCALES = { a: "a", á: "a", e: "e", é: "e", i: "i", í: "i", o: "o", ó: "o", u: "u", ú: "u", ü: "u" };
const MONOVOCALICAS = { a: "a", e: "e", o: "o", u: "u", y: "i", ha: "a", he: "e" };

/* En español hablado las vocales iguales que se tocan entre palabras se funden: "camina a
 * la" tiene UNA sola /a/. La palabra absorbida no deja evidencia acustica propia, asi que
 * preguntar "se leyo?" no tiene respuesta. Hereda el veredicto de la anterior, que es lo
 * que hace el evaluador humano. Descubierto el 2026-09-14 con la primera grabacion real. */
export function absorbidaPorSinalefa(anterior, palabra) {
  if (!anterior) return false;
  const v = MONOVOCALICAS[String(palabra).toLowerCase().replace(SIN_PUNTUACION, "")];
  if (!v) return false;
  const prev = String(anterior).toLowerCase().replace(SIN_PUNTUACION, "");
  return VOCALES[prev.at(-1)] === v;
}

/* ---------------------------------------------------------------- alineacion */

export const Op = { ACIERTO: "acierto", SUSTITUCION: "sustitucion", OMISION: "omision", INSERCION: "insercion" };

/* Needleman-Wunsch GLOBAL. Global y no local porque el puntaje necesita saber que paso con
 * CADA palabra del estimulo, incluidas las que nunca se leyeron porque se acabo el tiempo.
 * Una alineacion local las haria desaparecer del reporte en vez de marcarlas omitidas. */
export function alinear(ref, hip) {
  const n = ref.length, m = hip.length;
  const D = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 1; i <= n; i++) D[i][0] = i;
  for (let j = 1; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      D[i][j] = Math.min(
        D[i - 1][j - 1] + (ref[i - 1] === hip[j - 1] ? 0 : 1),
        D[i - 1][j] + 1,
        D[i][j - 1] + 1
      );

  const pares = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const igual = ref[i - 1] === hip[j - 1];
      if (D[i][j] === D[i - 1][j - 1] + (igual ? 0 : 1)) {
        pares.push({ op: igual ? Op.ACIERTO : Op.SUSTITUCION, idxRef: i - 1, idxHip: j - 1,
                     palabraRef: ref[i - 1], palabraHip: hip[j - 1] });
        i--; j--; continue;
      }
    }
    if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
      pares.push({ op: Op.OMISION, idxRef: i - 1, idxHip: null, palabraRef: ref[i - 1], palabraHip: null });
      i--; continue;
    }
    pares.push({ op: Op.INSERCION, idxRef: null, idxHip: j - 1, palabraRef: null, palabraHip: hip[j - 1] });
    j--;
  }
  return pares.reverse();
}

/* ---------------------------------------------------------------- puntaje */

const DURACION_MINIMA_S = 2.0;
const FRACCION_MINIMA_RECONOCIDA = 0.03;

/* LA INVARIANTE: un audio que no se pudo evaluar NO es un cero.
 *
 * Sin esto el sistema mide calidad de microfono y lo llama fluidez, y quien grabo mal
 * puntua peor que quien grabo bien. `pcpm: null` con un motivo es una respuesta honesta.
 * `pcpm: 0` seria una afirmacion falsa sobre una persona. */
export function puntuar(pares, tiempos, duracion, limite = 60) {
  const nRef = pares.filter(p => p.idxRef !== null).length;

  if (duracion < DURACION_MINIMA_S)
    return { estado: "NO_EVALUABLE", pcpm: null, correctas: 0, intentadas: nRef, segundos: duracion,
             motivo: `audio demasiado corto (${duracion.toFixed(1)} s)`, pares };

  const reconocidas = pares.filter(p => p.idxHip !== null).length;
  if (nRef && reconocidas / nRef < FRACCION_MINIMA_RECONOCIDA)
    return { estado: "NO_EVALUABLE", pcpm: null, correctas: 0, intentadas: nRef, segundos: duracion,
             motivo: `sin habla reconocible en ${duracion.toFixed(1)} s de audio`, pares };

  let correctas = 0;
  for (const p of pares) {
    if (p.op !== Op.ACIERTO || p.idxHip === null || p.idxHip >= tiempos.length) continue;
    if (tiempos[p.idxHip][1] > limite) continue;
    correctas++;
  }

  /* EL DENOMINADOR ES CUANDO DEJO DE LEER, NO CUANDO ACERTO POR ULTIMA VEZ.
   *
   * Es el cronometro del evaluador: se detiene cuando el chico termina o cuando suenan los
   * 60 segundos, sin importar si las ultimas palabras las leyo bien o mal. Medir hasta el
   * ultimo ACIERTO parece equivalente y no lo es: a quien lee todo y se traba en el tramo
   * final le acorta el denominador y le INFLA el puntaje, y el error crece con la cantidad
   * de errores, o sea que favorece mas a quien peor lee.
   *
   * Tampoco puede usarse 60 fijo: castigaria al lector rapido que termina en 20 segundos. */
  let finHabla = 0;
  for (const [, fin] of tiempos) if (fin <= limite) finHabla = Math.max(finHabla, fin);
  if (finHabla <= 0) finHabla = duracion;
  const segundos = Math.min(Math.max(finHabla, DURACION_MINIMA_S), limite);
  return { estado: "OK", pcpm: Math.round((correctas * 60) / segundos * 10) / 10,
           correctas, intentadas: nRef, segundos: Math.round(segundos * 100) / 100, motivo: null, pares };
}

/* LOS BORDES DE PALABRA, que es donde el conteo se rompe en espaniol.
 *
 * Los dos casos aparecieron MIDIENDO, no pensando, y son el mismo problema de fondo:
 *
 *   - Sinalefa: «camina a la escuela» se pronuncia «caminala escuela» y la «a» desaparece.
 *   - Resegmentacion: «leer es» se reconoce «le eres». Misma onda, otra division.
 *
 * La frontera entre palabras no esta en el aire: esta en la ortografia. Quien lee bien
 * «leer es» produce exactamente la misma onda que quien dijera «le eres».
 *
 * LA LINEA QUE NO SE CRUZA: esto repara bordes, no perdona errores. «cada» leido «caba»
 * tiene otras letras y sigue mal; «sol» leido «los» tiene las mismas letras en otro orden
 * y la concatenacion no coincide, asi que tambien sigue mal. */
const MAXIMO_EN_JUNTURA = 4;

/* FORMA CANONICA POR SONIDO, no por letra: «casa», «kasa» y «caza» dan lo mismo.
 *
 * POR QUE EXISTE, y el caso es real: al leer «Ca-da» con una pausa en el medio, el
 * reconocedor escribe «ka da». El chico leyo bien; lo que cambio es como se escribe lo que
 * se oyo. La silaba suelta se transcribe foneticamente porque no hay palabra que la ancle, y
 * en espaniol el mismo sonido se escribe de varias formas: /ka/ es «ca» o «ka», /s/ es «s»,
 * «c» o «z», /b/ es «b» o «v», y la hache no suena.
 *
 * SOLO se usa para juntar un tramo partido en varios pedazos, NUNCA para comparar una
 * palabra contra otra: esta funcion afloja, y lo que afloja hay que tenerlo acotado. */
export function claveFonetica(palabra) {
  let p = palabra.toLowerCase()
    .replace(/ch/g, "C").replace(/ll/g, "Y").replace(/rr/g, "r")
    .replace(/qu/g, "k").replace(/gu/g, "G");

  let salida = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    const palatal = i + 1 < p.length && "ei".includes(p[i + 1]);
    if (c === "c") salida += palatal ? "s" : "k";
    else if (c === "q" || c === "k") salida += "k";
    else if (c === "z") salida += "s";
    else if (c === "v") salida += "b";
    else if (c === "g") salida += palatal ? "j" : "g";
    else if (c === "h") continue;              // la hache no suena
    else if (c === "G") salida += "g";
    else if (c === "Y") salida += "y";         // yeismo
    else if (c === "C") salida += "ch";
    else salida += c;
  }
  // Letras dobles seguidas suenan una sola vez. Con un bucle y no con una retrorreferencia
  // en el regex: una barra invertida escrita por un generador ya se colo una vez en este
  // archivo como caracter de control.
  let junta = "";
  for (const c of salida) if (c !== junta[junta.length - 1]) junta += c;
  return junta;
}

function repararResegmentacion(pares) {
  let i = 0;
  while (i < pares.length) {
    if (pares[i].op === Op.ACIERTO) { i++; continue; }
    let j = i;
    while (j < pares.length && pares[j].op !== Op.ACIERTO) j++;
    const tramo = pares.slice(i, j);
    const refs = tramo.filter(p => p.idxRef !== null).map(p => p.palabraRef);
    const hips = tramo.filter(p => p.idxHip !== null).map(p => p.palabraHip);
    const mismasLetras = refs.join("") === hips.join("");
    const mismosSonidos = claveFonetica(refs.join("")) === claveFonetica(hips.join(""));
    if (refs.length && hips.length && (refs.length > 1 || hips.length > 1)
        && refs.length <= MAXIMO_EN_JUNTURA && hips.length <= MAXIMO_EN_JUNTURA
        && (mismasLetras || mismosSonidos)) {
      for (const p of tramo) if (p.idxRef !== null) {
        p.op = Op.ACIERTO;
        p.nota = "juntura: mismas letras, otra division de palabras";
      }
    }
    i = j > i ? j : i + 1;
  }
  return pares;
}

/* Primero la resegmentacion, que puede convertir un tramo entero en aciertos, y despues la
 * sinalefa, que necesita que la palabra ANTERIOR ya sea acierto para heredarle el veredicto. */
export function repararJunturas(pares, display) {
  return aplicarSinalefa(repararResegmentacion(pares), display);
}

/* Aplica la herencia por sinalefa sobre un resultado ya alineado. */
export function aplicarSinalefa(pares, display) {
  for (let k = 0; k < pares.length; k++) {
    const p = pares[k];
    if (p.op !== Op.OMISION || p.idxRef === null || p.idxRef === 0) continue;
    if (!absorbidaPorSinalefa(display[p.idxRef - 1], display[p.idxRef])) continue;
    const previo = pares[k - 1];
    if (previo && previo.op === Op.ACIERTO) {
      p.op = Op.ACIERTO;
      p.idxHip = previo.idxHip;
      p.nota = "absorbida por sinalefa, hereda el veredicto anterior";
    }
  }
  return pares;
}

/* ---------------------------------------------------------------- el modelo */

let transcriptor = null;

export async function cargarModelo(alProgreso) {
  if (transcriptor) return transcriptor;
  /* Version FIJA, y la eleccion no es cosmetica.
   *
   * La 4.2.0 no carga ningun modelo de whisper en este entorno: falla en el runtime de
   * onnx con "qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required
   * scale", con CUALQUIER modelo (whisper base, tiny, repos onnx-community y Xenova) y
   * con CUALQUIER dtype, incluso fp32. O sea que no es el modelo ni la cuantizacion:
   * es el onnxruntime-web que trae esa version. Verificado el 2026-09-14.
   *
   * La 3.7.6 con q8 carga en unos 7 segundos. Por eso queda fijada. Subir de version
   * exige volver a probar la carga, no alcanza con que compile.
   *
   * El modelo es la variante `_timestamped` y no la comun. Los tiempos POR PALABRA
   * necesitan que el modelo se haya exportado con las atenciones cruzadas, y el whisper
   * base normal no las trae: falla con "Model outputs must contain cross attentions to
   * extract timestamps". Sin tiempos por palabra no hay corte a los 60 segundos ni se
   * puede hacer clic para escuchar, asi que la variante no es opcional.
   */
  const { pipeline } = await import(
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js"
  );
  transcriptor = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base_timestamped", {
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback: alProgreso,
  });
  return transcriptor;
}

/* El navegador graba en webm/opus. Se decodifica a 16 kHz mono, que es lo que espera el
 * modelo, con un AudioContext que remuestrea solo. */
export async function aFloat32_16k(blob) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const audio = buf.getChannelData(0).slice();
  const duracion = buf.duration;
  ctx.close();
  return { audio, duracion };
}

export async function transcribir(audio) {
  const out = await transcriptor(audio, {
    language: "spanish",
    task: "transcribe",
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const palabras = [], tiempos = [];
  for (const c of out.chunks || []) {
    const n = normalizar(c.text);
    if (!n) continue;
    const [t0, t1] = c.timestamp || [null, null];
    if (t0 === null || t1 === null) continue;
    palabras.push(n);
    tiempos.push([t0, t1]);
  }
  return { palabras, tiempos, texto: out.text };
}

/* Camino completo: audio grabado y estimulo, adentro un resultado puntuado y marcado. */
export async function evaluar(blob, estimulo) {
  const { audio, duracion } = await aFloat32_16k(blob);
  const hip = await transcribir(audio);
  const refNorm = estimulo.palabras.map(normalizar);
  let pares = alinear(refNorm, hip.palabras);
  pares = repararJunturas(pares, estimulo.palabras);
  const r = puntuar(pares, hip.tiempos, duracion, estimulo.limite || 60);
  return { ...r, duracion, tiempos: hip.tiempos, transcripcion: hip.texto };
}

/* ---------------------------------------------------------------- tareas por item */

const ITEMS_REGLA_CORTE = 10;

/* Puntaje de letras, silabas, palabras y pseudopalabras.
 *
 * Se diferencia del pasaje en la REGLA DE CORTE TEMPRANO del protocolo de EGRA: si el nino
 * no acierta ninguno de los primeros 10 items, se interrumpe la subtarea.
 *
 * LA DISTINCION QUE IMPORTA: "descontinuado" es un cero LEGITIMO, porque se lo oyo intentar
 * y no acerto. "No evaluable" es la ausencia de una medicion. Los dos se ven identicos en la
 * salida del reconocedor (cero aciertos) y significan cosas opuestas, asi que la regla de
 * corte SOLO se aplica cuando ya se verifico que habia habla. Si no, bastaria un microfono
 * malo para dejar registrado que un chico no reconoce ninguna letra.
 */
export function puntuarItems(pares, tiempos, duracion, limite = 60) {
  const base = puntuar(pares, tiempos, duracion, limite);
  if (base.estado === "NO_EVALUABLE") return base;

  const primeros = pares.filter(p => p.idxRef !== null && p.idxRef < ITEMS_REGLA_CORTE);
  if (primeros.length && !primeros.some(p => p.op === Op.ACIERTO))
    return { ...base, estado: "DESCONTINUADO", pcpm: 0, correctas: 0,
             motivo: `ninguna respuesta correcta en los primeros ${ITEMS_REGLA_CORTE} ítems` };
  return base;
}

/* Camino completo para cualquiera de las cinco subtareas. */
export async function evaluarTarea(blob, estimulo) {
  const { audio, duracion } = await aFloat32_16k(blob);
  const hip = await transcribir(audio);
  const refNorm = estimulo.palabras.map(normalizar);
  let pares = alinear(refNorm, hip.palabras);
  if (!estimulo.esPorItem) pares = repararJunturas(pares, estimulo.palabras);
  const puntuador = estimulo.esPorItem ? puntuarItems : puntuar;
  const r = puntuador(pares, hip.tiempos, duracion, estimulo.limite || 60);
  return { ...r, duracion, tiempos: hip.tiempos, transcripcion: hip.texto };
}
