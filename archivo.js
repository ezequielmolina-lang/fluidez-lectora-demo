/* Guardar el audio, que es el punto entero de un piloto.
 *
 * POR QUE EXISTE ESTE ARCHIVO: hasta ahora el asistente grababa, puntuaba y TIRABA el audio.
 * Para usarlo en el aula alcanzaba. Para un piloto con Enseña Perú no, porque lo que el
 * proyecto necesita es exactamente eso: la grabacion con el puntaje humano al lado. Sin el
 * audio, una jornada entera de trabajo deja una planilla y ningun dato de entrenamiento.
 *
 * POR QUE INDEXEDDB Y NO localStorage: localStorage guarda texto y tiene un limite del orden
 * de 5 MB. Una toma de 40 segundos pesa unos 100 KB, y un piloto de 100 chicos por cinco
 * subtareas son 500 tomas, del orden de 50 MB. En localStorage no entra, y peor: fallaria
 * en medio de la jornada, con el aula ya armada.
 *
 * POR QUE UN ZIP ESCRITO A MANO: el paquete que se entrega tiene que ser UN archivo, con el
 * audio y las etiquetas juntos. Una biblioteca de terceros significaria una dependencia de
 * red, y esto tiene que funcionar en una escuela sin señal. El zip va sin compresion, que en
 * dos docenas de lineas hace exactamente lo que hace falta: el audio ya viene comprimido en
 * opus, asi que comprimirlo de nuevo no ahorraria casi nada.
 */

const BASE = "fluidez";
const VERSION = 2;

function abrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("tomas")) db.createObjectStore("tomas", { keyPath: "id" });
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio");
      /* LA LISTA DEL AULA: codigo -> nombre. Version 2.
       *
       * POR QUE EXISTE, si la app dice "no escribas nombres": porque sin esto la
       * herramienta no le sirve a la escuela. Le devuelve "AS2B-014 leyo 38 ppm" y alguien
       * tiene que ir a buscar en un papel quien es AS2B-014. El docente que tomo la prueba
       * necesita ver el nombre; el que entrena el modelo no lo necesita nunca.
       *
       * POR QUE EN UN ALMACEN APARTE Y NO COMO UN CAMPO DE LA TOMA: para que sea imposible
       * que se filtre. `paqueteParaEntregar()` lee `tomas`, y `tomas` no tiene nombres. No
       * hay una lista de columnas que alguien pueda actualizar mal: el dato no esta ahi.
       * Los nombres solo salen por `planillaDeLaEscuela()`, que es otro boton, con otra
       * advertencia, y que NO lleva audio. */
      if (!db.objectStoreNames.contains("estudiantes")) {
        db.createObjectStore("estudiantes", { keyPath: "codigo" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function trans(db, stores, modo, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, modo);
    const r = fn(t);
    t.oncomplete = () => resolve(r);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/* Pide al navegador que NO borre estos datos cuando ande corto de espacio.
 *
 * Sin esto, el almacenamiento es "best effort": el sistema puede vaciarlo para hacer lugar,
 * y una jornada de grabaciones desaparece sin avisar. Con esto pasa a ser "persistente".
 * El navegador puede decir que no, asi que la app avisa en vez de asumir. */
export async function pedirPersistencia() {
  if (!navigator.storage?.persist) return null;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return null;
  }
}

export async function espacio() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usadoMB: usage / 1048576, totalMB: quota / 1048576 };
  } catch {
    return null;
  }
}

export async function guardar(registro, blob) {
  const db = await abrir();
  await trans(db, ["tomas", "audio"], "readwrite", (t) => {
    t.objectStore("tomas").put(registro);
    if (blob) t.objectStore("audio").put(blob, registro.id);
  });
  db.close();
}

export async function listar() {
  const db = await abrir();
  const tomas = await new Promise((resolve, reject) => {
    const req = db.transaction("tomas").objectStore("tomas").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return tomas.sort((a, b) => b.id - a.id);
}

export async function audioDe(id) {
  const db = await abrir();
  const blob = await new Promise((resolve, reject) => {
    const req = db.transaction("audio").objectStore("audio").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

export async function borrarTodo() {
  const db = await abrir();
  await trans(db, ["tomas", "audio", "estudiantes"], "readwrite", (t) => {
    t.objectStore("tomas").clear();
    t.objectStore("audio").clear();
    t.objectStore("estudiantes").clear();
  });
  db.close();
}

/* ------------------------------------------------------- la lista del aula */

export async function anotarEstudiante(codigo, nombre, seccion = "") {
  const db = await abrir();
  await trans(db, ["estudiantes"], "readwrite", (t) => {
    const almacen = t.objectStore("estudiantes");
    if (nombre.trim()) almacen.put({ codigo, nombre: nombre.trim(), seccion: seccion.trim() });
    else almacen.delete(codigo);   // borrar el nombre es una forma legitima de corregirse
  });
  db.close();
}

export async function estudiantes() {
  const db = await abrir();
  const lista = await new Promise((resolve, reject) => {
    const req = db.transaction("estudiantes").objectStore("estudiantes").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return new Map(lista.map((e) => [e.codigo, e]));
}

export async function borrarLaLista() {
  const db = await abrir();
  await trans(db, ["estudiantes"], "readwrite", (t) => t.objectStore("estudiantes").clear());
  db.close();
}

/* EL PROGRESO DE CADA ESTUDIANTE, que es lo unico que le sirve a una escuela.
 *
 * POR QUE NO ALCANZA CON LISTAR LAS TOMAS: la aplicacion venia devolviendo una fila por
 * grabacion, ordenada por fecha. Eso le sirve a quien junta un corpus y no le sirve a un
 * director, cuya pregunta es "¿este chico esta mejor que en marzo?". Y esa es ademas la
 * unica comparacion honesta que podemos ofrecer, porque no hay norma peruana verificada:
 * no podemos decir si 38 esta bien, pero si podemos decir que empezo en 22.
 *
 * QUE CUENTA COMO MEDICION: solo las que tienen un puntaje. DESCONTINUADO SI cuenta, porque
 * su cero es legitimo y ademas es el caso que mas importa: un chico que pasa de
 * descontinuado a 25 es la mejor noticia que puede dar esta herramienta. NO_EVALUABLE y
 * NO_PARTICIPA no cuentan: no son un cero, son un dato que falta.
 *
 * COMO SE ELIGE LA BASE: la que el evaluador declaro como linea de base. Si no hay ninguna
 * declarada, la mas vieja. No se ordena solo por fecha porque una escuela puede empezar en
 * agosto, o un chico faltar y que se le tome despues que a sus compañeros. */
const MIDEN = new Set(["OK", "DESCONTINUADO"]);

export async function progreso() {
  const [tomas, lista] = await Promise.all([listar(), estudiantes()]);
  const por = new Map();

  for (const t of tomas) {
    if (!MIDEN.has(t.estado_humano) || t.pcpm_humano === null || t.pcpm_humano === undefined) continue;
    /* La clave es un JSON y no "codigo + separador + tarea": un separador hay que
       elegirlo, escribirlo sin que ningun nivel de comillas lo rompa, y confiar en que
       no aparezca nunca en un codigo. JSON no necesita nada de eso, y ademas esto ya
       se rompio una vez: el separador llego al archivo como un NUL de verdad. */
    const clave = JSON.stringify([t.codigo, t.tarea]);
    if (!por.has(clave)) por.set(clave, []);
    por.get(clave).push(t);
  }

  const filas = [];
  for (const [clave, tomasDe] of por) {
    const [codigo, tarea] = JSON.parse(clave);
    tomasDe.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const base = tomasDe.find((t) => t.momento === "linea_base") ?? tomasDe[0];
    const ultimo = tomasDe[tomasDe.length - 1];
    const e = lista.get(codigo);
    filas.push({
      nombre: e?.nombre ?? "", seccion: e?.seccion ?? "", codigo, tarea,
      mediciones: tomasDe.length,
      pcpm_base: base.pcpm_humano, fecha_base: String(base.fecha).slice(0, 10),
      estimulo_base: base.estimulo,
      pcpm_ultimo: ultimo === base ? "" : ultimo.pcpm_humano,
      fecha_ultimo: ultimo === base ? "" : String(ultimo.fecha).slice(0, 10),
      estimulo_ultimo: ultimo === base ? "" : ultimo.estimulo,
      cambio: ultimo === base ? "" : ultimo.pcpm_humano - base.pcpm_humano,
      grado: ultimo.grado ?? "", escuela: ultimo.escuela ?? "",
      lengua_materna: ultimo.lengua_materna ?? "", evaluador: ultimo.evaluador ?? "",
    });
  }

  // Por nombre, que es como la lee una persona, y los sin nombre al final.
  filas.sort((a, b) => (a.nombre || "￿").localeCompare(b.nombre || "￿", "es")
                       || a.codigo.localeCompare(b.codigo, "es")
                       || a.tarea.localeCompare(b.tarea, "es"));
  return filas;
}

/* La planilla PARA LA ESCUELA: con nombres, sin audio, y una fila por estudiante y prueba.
 *
 * Es el otro lado del trato. El paquete de entrenamiento no lleva nombres nunca; esta
 * planilla los lleva siempre, porque es para el docente que tomo la prueba y que necesita
 * saber a quien acompaniar el lunes. Son dos archivos, dos botones y dos destinos. */
export async function planillaDeLaEscuela() {
  const filas = await progreso();
  const cols = ["nombre", "seccion", "codigo", "tarea", "mediciones",
                "pcpm_base", "fecha_base", "estimulo_base",
                "pcpm_ultimo", "fecha_ultimo", "estimulo_ultimo", "cambio",
                "grado", "escuela", "lengua_materna", "evaluador"];
  const csv = [cols.join(",")].concat(
    filas.map((f) => cols.map((c) => JSON.stringify(f[c] ?? "")).join(","))
  ).join("\n");
  return { csv, filas: filas.length,
           conNombre: filas.filter((f) => f.nombre).length,
           conCambio: filas.filter((f) => f.cambio !== "").length };
}

/* ---------------------------------------------------------------- el zip, a mano */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* Fecha y hora en el formato de MS-DOS que el zip todavia usa. */
function fechaDos(d) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const fecha = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, fecha };
}

/* Bit 11 de las banderas: "el nombre de este archivo esta en UTF-8".
 *
 * Sin esto, la especificacion del zip dice que el nombre se lee como CP437, y los
 * descompresores obedecen: un archivo llamado "nino.webm" con enie salia "ni├▒o.webm" al
 * abrir el paquete. Los bytes del nombre SIEMPRE fueron UTF-8, lo que faltaba era
 * declararlo. Lo encontro tests/test_zip_js.py, no una persona, y no se habia notado
 * porque los codigos de estudiante que veniamos usando eran todos ASCII. */
const NOMBRE_EN_UTF8 = 0x0800;

export async function armarZip(archivos) {
  const cod = new TextEncoder();
  const partes = [];
  const central = [];
  let desplazamiento = 0;
  const { hora, fecha } = fechaDos(new Date());

  for (const { nombre, datos } of archivos) {
    const bytes = datos instanceof Blob ? new Uint8Array(await datos.arrayBuffer()) : datos;
    const nom = cod.encode(nombre);
    const crc = crc32(bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);       // version necesaria
    local.setUint16(6, NOMBRE_EN_UTF8, true);
    local.setUint16(8, 0, true);        // metodo 0: guardado, sin comprimir
    local.setUint16(10, hora, true);
    local.setUint16(12, fecha, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nom.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nom, bytes);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, NOMBRE_EN_UTF8, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, hora, true);
    dir.setUint16(14, fecha, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, bytes.length, true);
    dir.setUint32(24, bytes.length, true);
    dir.setUint16(28, nom.length, true);
    dir.setUint32(42, desplazamiento, true);
    central.push(new Uint8Array(dir.buffer), nom);

    desplazamiento += 30 + nom.length + bytes.length;
  }

  const largoCentral = central.reduce((a, p) => a + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, largoCentral, true);
  fin.setUint32(16, desplazamiento, true);

  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: "application/zip" });
}

/* El paquete que se entrega: el audio, las etiquetas y un LEAME que explica que es cada cosa.
 *
 * Las etiquetas van en CSV y en JSON a proposito. El CSV lo abre cualquiera en una planilla
 * y sirve para revisar en el momento; el JSON conserva la marca palabra por palabra, que es
 * lo que el entrenamiento necesita y lo que una planilla arruinaria. */
/* El orden PREFERIDO de las columnas. No es la lista completa a proposito.
 *
 * POR QUE NO ES UNA LISTA FIJA: lo era, y se quedo vieja sin que nadie se enterara. El
 * asistente empezo a guardar `humano` y `maquina`, el veredicto palabra por palabra de cada
 * uno, que es EXACTAMENTE el dato por el que existe este paquete, y la planilla no los
 * exportaba porque no estaban en la lista. Peor: el LEAME los describia como "las dos
 * columnas que importan". El dato seguia en etiquetas.json, asi que no se perdio, pero la
 * planilla que abre cualquiera no los tenia.
 *
 * Ahora esta lista solo manda el ORDEN. Cualquier campo que el asistente guarde y no este
 * aca se agrega igual, al final. Una columna nueva puede quedar mal ubicada; ninguna puede
 * desaparecer en silencio. */
const ORDEN_PREFERIDO = [
  "archivo", "codigo", "estimulo", "tarea", "modo", "fecha", "duracion", "segundos",
  "pcpm_humano", "correctas_humano", "estado_humano",
  "pcpm_maquina", "correctas_maquina", "estado_maquina", "correcciones",
  "humano", "maquina", "palabras_estimulo", "transcripcion",
  "momento", "escuela", "region", "grado", "lengua_materna", "ruido", "evaluador", "formato",
  // De que version salio el dato y de que equipo. Es lo que permite comparar y rehacer.
  "version_app", "huella_estimulos", "equipo",
];

export function columnas(tomas) {
  const vistos = new Set(tomas.flatMap((t) => Object.keys(t)));
  vistos.delete("id");  // es la clave interna de IndexedDB, no dice nada de la toma
  return ORDEN_PREFERIDO.filter((c) => vistos.has(c))
    .concat([...vistos].filter((c) => !ORDEN_PREFERIDO.includes(c)).sort());
}

export async function paqueteParaEntregar() {
  const tomas = await listar();
  const archivos = [];

  for (const t of tomas) {
    const blob = await audioDe(t.id);
    if (blob) archivos.push({ nombre: `audio/${t.archivo}`, datos: blob });
  }

  const cols = columnas(tomas);
  const csv = [cols.join(",")].concat(
    tomas.map((t) => cols.map((c) => JSON.stringify(t[c] ?? "")).join(","))
  ).join("\n");

  const cod = new TextEncoder();
  archivos.push({ nombre: "etiquetas.csv", datos: cod.encode(csv) });
  archivos.push({ nombre: "etiquetas.json", datos: cod.encode(JSON.stringify(tomas, null, 1)) });
  archivos.push({ nombre: "LEAME.txt", datos: cod.encode(LEAME(tomas)) });

  return { zip: await armarZip(archivos), tomas: tomas.length, conAudio: archivos.length - 3 };
}

const LEAME = (tomas) => `PAQUETE DE FLUIDEZ LECTORA
${new Date().toLocaleString("es-PE")}
${tomas.length} tomas

QUE HAY ACA

  audio/            una grabacion por toma, en webm. El nombre de cada archivo coincide
                    con la columna "archivo" de las etiquetas.
  etiquetas.csv     una fila por toma, para abrir en una planilla y revisar.
  etiquetas.json    lo mismo, mas la marca PALABRA POR PALABRA, que es lo que sirve para
                    entrenar y lo que una planilla arruinaria.

LAS TRES COLUMNAS QUE IMPORTAN

  "humano"   lo que marco la persona: un 1 por palabra leida bien, un 0 por palabra mal.
  "maquina"  lo que habia propuesto el programa, en el mismo formato.

  Los dos son una cadena de digitos, uno por palabra del estimulo y EN ORDEN: el digito i
  corresponde a la palabra i de la lista o del pasaje que dice la columna "estimulo". Esas
  listas estan en el repositorio, en stimuli/. La columna "palabras_estimulo" dice cuantas
  tiene que haber, para poder comprobar que la cadena no vino cortada.

  Donde difieren esta el dato valioso: es el error del programa, senialado por alguien que
  estaba escuchando al chico. La columna "correcciones" cuenta en cuantas difieren.

  "transcripcion"  lo que el reconocedor entendio, en crudo, antes de compararlo con nada.

  Es lo unico del paquete que no se puede reconstruir despues. Con la transcripcion se puede
  volver a alinear y a puntuar con otro algoritmo sin correr el reconocedor de nuevo sobre
  cientos de audios; sin ella, probar una idea nueva cuesta una tarde de computo.

  Las tomas grabadas antes de setiembre de 2026 no la traen.

SIN NOMBRES

  Ninguna toma lleva el nombre del estudiante. El codigo es el que el evaluador anoto en su
  planilla, y la correspondencia entre codigo y nombre NO viaja en este paquete: queda en la
  escuela.

EL AUDIO ES VOZ DE MENORES

  Se usa para entrenar y validar el sistema, no se publica ni se cede, y se conserva solo lo
  necesario.
`;
