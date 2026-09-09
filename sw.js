/* 离线缓存：加到主屏幕后，第二次打开秒开且断网也能背（词库约 4MB，首次用后即缓存） */
const C = 'wb-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;           // GitHub API 等外部请求不拦
  e.respondWith(
    caches.open(C).then(c => c.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') c.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || net;                            // 有缓存先给缓存，同时后台更新
    }))
  );
});
