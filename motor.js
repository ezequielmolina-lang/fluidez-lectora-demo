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

  let correctas = 0, finUltima = 0;
  for (const p of pares) {
    if (p.op !== Op.ACIERTO || p.idxHip === null || p.idxHip >= tiempos.length) continue;
    const fin = tiempos[p.idxHip][1];
    if (fin > limite) continue;
    correctas++;
    finUltima = Math.max(finUltima, fin);
  }

  /* El denominador es el tiempo que efectivamente tardo, no 60 fijos: usar siempre 60
   * castigaria al lector rapido que termina el pasaje en 20 segundos. */
  const segundos = Math.min(Math.max(finUltima, DURACION_MINIMA_S), limite);
  return { estado: "OK", pcpm: Math.round((correctas * 60) / segundos * 10) / 10,
           correctas, intentadas: nRef, segundos: Math.round(segundos * 100) / 100, motivo: null, pares };
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
  pares = aplicarSinalefa(pares, estimulo.palabras);
  const r = puntuar(pares, hip.tiempos, duracion, estimulo.limite || 60);
  return { ...r, duracion, tiempos: hip.tiempos, transcripcion: hip.texto };
}
