/* Service worker: hace que la herramienta funcione SIN SEÑAL despues de la primera visita.
 *
 * Por que importa y no es un adorno: las escuelas donde esta medicion mas falta son las que
 * no tienen conectividad. Si la app necesita internet cada vez, no sirve justamente donde
 * mas se necesita.
 *
 * El modelo de voz NO se cachea aca: transformers.js lo guarda por su cuenta en Cache
 * Storage con su propia clave. Esto cachea el armazon de la app, que es lo que permite que
 * abra sin señal.
 */
const CACHE = "fluidez-v11";
const ARMAZON = ["./", "./index.html", "./asistente.html", "./manual.html", "./manual_director.html", "./motor.js", "./datos.json",
                 "./estimulos.json", "./archivo.js", "./lectura.mp3", "./manifest.json",
                 "./icono.svg", "./icono-192.png", "./icono-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARMAZON)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE && k.startsWith("fluidez-")).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  /* Lo del hub de modelos y las tipografias los maneja el navegador, no nosotros. */
  if (url.origin !== location.origin) return;
  /* Red primero para tener la version fresca, cache como respaldo cuando no hay señal. */
  e.respondWith(
    fetch(e.request)
      .then(r => { const copia = r.clone();
                   caches.open(CACHE).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
