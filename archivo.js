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
const VERSION = 1;

function abrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("tomas")) db.createObjectStore("tomas", { keyPath: "id" });
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio");
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
  await trans(db, ["tomas", "audio"], "readwrite", (t) => {
    t.objectStore("tomas").clear();
    t.objectStore("audio").clear();
  });
  db.close();
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
    local.setUint16(6, 0, true);        // banderas
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
    dir.setUint16(8, 0, true);
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
export async function paqueteParaEntregar() {
  const tomas = await listar();
  const archivos = [];

  for (const t of tomas) {
    const blob = await audioDe(t.id);
    if (blob) archivos.push({ nombre: `audio/${t.archivo}`, datos: blob });
  }

  const cols = ["archivo", "codigo", "estimulo", "tarea", "modo", "fecha", "duracion", "segundos",
                "pcpm_humano", "correctas_humano", "estado_humano", "pcpm_maquina",
                "correctas_maquina", "estado_maquina", "correcciones", "escuela", "region",
                "grado", "lengua_materna", "ruido", "evaluador"];
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

LAS DOS COLUMNAS QUE IMPORTAN

  "humano"   lo que marco la persona: un 1 por palabra leida bien, un 0 por palabra mal.
  "maquina"  lo que habia propuesto el programa, en el mismo formato.

  Donde difieren esta el dato valioso: es el error del programa, senialado por alguien que
  estaba escuchando al chico.

SIN NOMBRES

  Ninguna toma lleva el nombre del estudiante. El codigo es el que el evaluador anoto en su
  planilla, y la correspondencia entre codigo y nombre NO viaja en este paquete: queda en la
  escuela.

EL AUDIO ES VOZ DE MENORES

  Se usa para entrenar y validar el sistema, no se publica ni se cede, y se conserva solo lo
  necesario.
`;
