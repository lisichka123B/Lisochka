const CACHE_NAME = 'kesem-cache-v3';

self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(clients.claim());
});


self.addEventListener('push', event => {
  console.log('Push received:', event);
  
  let data = {};
  
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.error('Error parsing push data:', e);
    data = {
      title: 'Tobebe',
      body: event.data ? event.data.text() : 'Новое сообщение'
    };
  }
  
 
  const uniqueTag = 'msg-' + Date.now() + '-' + Math.random() + '-' + (data.senderId || '0');
  
  const options = {
    body: data.body || 'У вас новое сообщение',
    icon: data.icon || '/favicon-96x96.png',
    badge: '/favicon-96x96.png',
    vibrate: [200, 100, 200],
    tag: uniqueTag,
    renotify: true, 
    silent: false,
    data: data.data || {
      dateOfArrival: Date.now(),
      primaryKey: 1,
      url: '/'
    },
    actions: data.actions || [
      {
        action: 'open',
        title: 'Открыть'
      },
      {
        action: 'close',
        title: 'Закрыть'
      }
    ]
  };

  
  const title = data.title || 'Новое сообщение';
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});


self.addEventListener('notificationclick', event => {
  console.log('Notification clicked:', event);
  
  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};
  
  notification.close();
  
  if (action === 'close') {
    return;
  }
  
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    })
    .then(windowClients => {
      for (let client of windowClients) {
        if (client.url.includes('/') && 'focus' in client) {
          client.focus();
          
          if (data.senderId) {
            client.postMessage({
              type: 'OPEN_CHAT',
              senderId: data.senderId
            });
          }
          return;
        }
      }
      
      let url = data.url || '/';
      
      if (data.senderId) {
        url += '?open_chat=' + data.senderId;
      }
      
      return clients.openWindow(url);
    })
  );
});


self.addEventListener('message', event => {
  console.log('Message from client:', event.data);
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
