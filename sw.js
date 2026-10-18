// Storm Ops service worker: keeps the app itself, the map library, fonts and
// every map/satellite tile you've looked at available with no signal.
const VERSION = 'stormops-v3.6.1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/layers.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/layers-2x.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png'];
const TILE_CACHE = 'stormops-tiles';
const MAX_TILES = 4000;

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(VERSION).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION && k!==TILE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

const isTile = url => /tile\.openstreetmap\.org|(server\.arcgisonline\.com\/ArcGIS|clarity\.maptiles\.arcgis\.com\/arcgis)\/rest\/services\/(World_Imagery|Reference)/.test(url);
const isStatic = url => /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url);

async function trimTiles(){
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  for(let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = req.url;

  // The app page: try the network first so updates arrive, fall back to the saved copy.
  if(req.mode === 'navigate' || (url.startsWith(self.location.origin) && /\/(index\.html)?$/.test(new URL(url).pathname))){
    e.respondWith(fetch(req).then(r=>{ const copy = r.clone(); caches.open(VERSION).then(c=>c.put('./index.html', copy)); return r; })
      .catch(()=>caches.match('./index.html')));
    return;
  }
  // Map tiles: saved copy first (fast, works offline), fill in from the network.
  if(isTile(url)){
    e.respondWith(caches.open(TILE_CACHE).then(async c=>{
      const hit = await c.match(req);
      if(hit) return hit;
      try{ const r = await fetch(req); if(r.ok || r.type === 'opaque'){ c.put(req, r.clone()); trimTiles(); } return r; }
      catch(err){ return new Response('', { status: 504 }); }
    }));
    return;
  }
  // Town contact lists: always fresh; the app keeps its own saved copy.
  if(url.startsWith(self.location.origin) && url.includes('/towns/')) return;
  // Libraries, fonts and the app's own files: cache-first.
  if(isStatic(url) || url.startsWith(self.location.origin)){
    e.respondWith(caches.match(req).then(hit=> hit || fetch(req).then(r=>{ if(r.ok || r.type === 'opaque'){ const copy = r.clone(); caches.open(VERSION).then(c=>c.put(req, copy)); } return r; })));
  }
  // Everything else (live lookups) goes straight to the network; the app
  // keeps its own saved copies of those results.
});
