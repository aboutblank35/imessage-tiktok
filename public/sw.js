// public/sw.js
const CACHE = 'imessage-tiktok-v1';

const ASSETS = [
  '/',             // wenn dein Server public/ als root servt
  '/index.html',
  '/intro.html',
  '/outro.html',
  '/style.css',
  '/script.js',
  '/data.json',    // <— anpassen falls du einen anderen Pfad nutzt
  // Fonts/Avatare hier ergänzen:
  // '/fonts/Inter-Variable.woff2',
  // '/img/avatars/pix.png',
  // ...
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => 
      cached || fetch(req).then(res => {
        // put a copy
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy)).catch(()=>{});
        return res;
      }).catch(() => cached) // offline fallback
    )
  );
});
