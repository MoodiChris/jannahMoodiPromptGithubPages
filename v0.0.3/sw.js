// Jannah Islamic Habit Tracker - Service Worker
// Version: 1.0.0
// This service worker provides offline functionality for the Islamic habit tracking app

const CACHE_NAME = 'jannah-v1.0.0';
const STATIC_CACHE_NAME = 'jannah-static-v1.0.0';
const DATA_CACHE_NAME = 'jannah-data-v1.0.0';

// Assets to cache for offline use
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/index.css',
  '/assets/index.js',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  // Add other static assets as needed
];

// API endpoints to cache
const API_CACHE_URLS = [
  '/api/prayer-times',
  '/api/habits',
  '/api/quran',
  '/api/challenges',
  '/api/analytics'
];

// Islamic content to cache for offline access
const ISLAMIC_CONTENT = [
  '/data/hadith.json',
  '/data/duas.json',
  '/data/quran-verses.json',
  '/audio/adhan.mp3',
  '/audio/dhikr.mp3'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install event');

  event.waitUntil(
    Promise.all([
      // Cache static files
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        console.log('[ServiceWorker] Caching static files');
        return cache.addAll(STATIC_FILES);
      }),

      // Cache Islamic content
      caches.open(DATA_CACHE_NAME).then((cache) => {
        console.log('[ServiceWorker] Caching Islamic content');
        return cache.addAll(ISLAMIC_CONTENT);
      }),

      // Skip waiting to activate immediately
      self.skipWaiting()
    ])
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate event');

  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE_NAME &&
                cacheName !== DATA_CACHE_NAME &&
                cacheName !== CACHE_NAME) {
              console.log('[ServiceWorker] Removing old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),

      // Take control of all pages
      self.clients.claim()
    ])
  );
});

// Fetch event - handle network requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle different types of requests
  if (request.method === 'GET') {
    // API requests - cache first, then network
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(handleAPIRequest(request));
    }
    // Static assets - cache first
    else if (STATIC_FILES.includes(url.pathname) || url.pathname.startsWith('/assets/')) {
      event.respondWith(handleStaticRequest(request));
    }
    // Islamic content - cache first
    else if (ISLAMIC_CONTENT.some(path => url.pathname.includes(path))) {
      event.respondWith(handleContentRequest(request));
    }
    // Navigation requests - network first, fallback to cache
    else if (request.mode === 'navigate') {
      event.respondWith(handleNavigationRequest(request));
    }
    // Other requests - network first
    else {
      event.respondWith(handleNetworkFirstRequest(request));
    }
  }
});

// Handle API requests with cache-first strategy
async function handleAPIRequest(request) {
  const cache = await caches.open(DATA_CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // Return cached response and update cache in background
    updateCacheInBackground(request, cache);
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    if (response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[ServiceWorker] API request failed:', error);
    return new Response(JSON.stringify({ error: 'Offline mode active' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Handle static file requests
async function handleStaticRequest(request) {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    if (response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[ServiceWorker] Static request failed:', error);
    return caches.match('/offline.html') || new Response('Offline');
  }
}

// Handle Islamic content requests
async function handleContentRequest(request) {
  const cache = await caches.open(DATA_CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    if (response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[ServiceWorker] Content request failed:', error);
    // Return default Islamic content if available
    return caches.match('/data/default-content.json') ||
           new Response(JSON.stringify({ message: 'Content unavailable offline' }));
  }
}

// Handle navigation requests
async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (error) {
    console.log('[ServiceWorker] Navigation request failed, serving cached version');
    const cache = await caches.open(STATIC_CACHE_NAME);
    return cache.match('/index.html') || cache.match('/');
  }
}

// Handle other network requests
async function handleNetworkFirstRequest(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    return cache.match(request) || new Response('Resource unavailable offline');
  }
}

// Update cache in background
async function updateCacheInBackground(request, cache) {
  try {
    const response = await fetch(request);
    if (response.status === 200) {
      cache.put(request, response.clone());
    }
  } catch (error) {
    console.log('[ServiceWorker] Background cache update failed:', error);
  }
}

// Background sync for habit data
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] Background sync event:', event.tag);

  if (event.tag === 'habit-sync') {
    event.waitUntil(syncHabitData());
  } else if (event.tag === 'prayer-sync') {
    event.waitUntil(syncPrayerData());
  } else if (event.tag === 'progress-sync') {
    event.waitUntil(syncProgressData());
  }
});

// Sync habit data when back online
async function syncHabitData() {
  try {
    const habits = await getStoredData('pendingHabits');
    if (habits && habits.length > 0) {
      for (const habit of habits) {
        await fetch('/api/habits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(habit)
        });
      }
      await clearStoredData('pendingHabits');
      console.log('[ServiceWorker] Habit data synced successfully');
    }
  } catch (error) {
    console.log('[ServiceWorker] Habit sync failed:', error);
  }
}

// Sync prayer data when back online
async function syncPrayerData() {
  try {
    const prayers = await getStoredData('pendingPrayers');
    if (prayers && prayers.length > 0) {
      for (const prayer of prayers) {
        await fetch('/api/prayers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prayer)
        });
      }
      await clearStoredData('pendingPrayers');
      console.log('[ServiceWorker] Prayer data synced successfully');
    }
  } catch (error) {
    console.log('[ServiceWorker] Prayer sync failed:', error);
  }
}

// Sync progress data when back online
async function syncProgressData() {
  try {
    const progress = await getStoredData('pendingProgress');
    if (progress && progress.length > 0) {
      for (const item of progress) {
        await fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
      }
      await clearStoredData('pendingProgress');
      console.log('[ServiceWorker] Progress data synced successfully');
    }
  } catch (error) {
    console.log('[ServiceWorker] Progress sync failed:', error);
  }
}

// Push notification handler
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push notification received');

  const options = {
    body: 'It\'s time for prayer. May Allah accept your worship.',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: 'prayer-reminder',
    requireInteraction: true,
    actions: [
      {
        action: 'mark-completed',
        title: 'Mark as Completed',
        icon: '/icons/check.png'
      },
      {
        action: 'snooze',
        title: 'Remind me in 5 minutes',
        icon: '/icons/snooze.png'
      }
    ],
    data: {
      type: 'prayer-reminder',
      timestamp: Date.now()
    }
  };

  if (event.data) {
    const data = event.data.json();
    options.title = data.title || 'Prayer Reminder';
    options.body = data.body || options.body;
    options.data = { ...options.data, ...data };
  }

  event.waitUntil(
    self.registration.showNotification('Prayer Time', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification click received');

  event.notification.close();

  if (event.action === 'mark-completed') {
    // Handle marking prayer as completed
    event.waitUntil(markPrayerCompleted(event.notification.data));
  } else if (event.action === 'snooze') {
    // Handle snooze action
    event.waitUntil(snoozePrayerReminder(5));
  } else {
    // Default action - open app
    event.waitUntil(
      clients.openWindow('/') || clients.openWindow('/')
    );
  }
});

// Mark prayer as completed
async function markPrayerCompleted(data) {
  try {
    const habits = await getStoredData('habits') || [];
    const prayerHabit = habits.find(h => h.type === 'prayer' && h.name === data.prayer);

    if (prayerHabit) {
      prayerHabit.completed = true;
      prayerHabit.completedAt = new Date().toISOString();
      await storeData('habits', habits);

      // Sync when online
      if (navigator.onLine) {
        await syncHabitData();
      }
    }
  } catch (error) {
    console.log('[ServiceWorker] Failed to mark prayer completed:', error);
  }
}

// Snooze prayer reminder
async function snoozePrayerReminder(minutes) {
  try {
    const registration = await self.registration;

    setTimeout(() => {
      registration.showNotification('Prayer Reminder', {
        body: 'Reminder: It\'s time for prayer.',
        icon: '/icons/icon-192x192.png',
        tag: 'prayer-reminder-snooze'
      });
    }, minutes * 60 * 1000);
  } catch (error) {
    console.log('[ServiceWorker] Failed to snooze reminder:', error);
  }
}

// Utility functions for data storage
async function getStoredData(key) {
  try {
    const db = await openDB();
    const transaction = db.transaction(['data'], 'readonly');
    const store = transaction.objectStore('data');
    const result = await store.get(key);
    return result?.data;
  } catch (error) {
    console.log('[ServiceWorker] Failed to get stored data:', error);
    return null;
  }
}

async function storeData(key, data) {
  try {
    const db = await openDB();
    const transaction = db.transaction(['data'], 'readwrite');
    const store = transaction.objectStore('data');
    await store.put({ key, data });
  } catch (error) {
    console.log('[ServiceWorker] Failed to store data:', error);
  }
}

async function clearStoredData(key) {
  try {
    const db = await openDB();
    const transaction = db.transaction(['data'], 'readwrite');
    const store = transaction.objectStore('data');
    await store.delete(key);
  } catch (error) {
    console.log('[ServiceWorker] Failed to clear stored data:', error);
  }
}

// Open IndexedDB
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('JannahDB', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('data')) {
        db.createObjectStore('data', { keyPath: 'key' });
      }
    };
  });
}

// Handle errors
self.addEventListener('error', (event) => {
  console.error('[ServiceWorker] Error:', event.error);
});

// Handle unhandled promise rejections
self.addEventListener('unhandledrejection', (event) => {
  console.error('[ServiceWorker] Unhandled promise rejection:', event.reason);
});

// Message handler for communication with main thread
self.addEventListener('message', (event) => {
  const { action, data } = event.data;

  switch (action) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CACHE_PRAYER_TIMES':
      cachePrayerTimes(data);
      break;
    case 'CACHE_QURAN_DATA':
      cacheQuranData(data);
      break;
    case 'SYNC_NOW':
      performSync();
      break;
    default:
      console.log('[ServiceWorker] Unknown message action:', action);
  }
});

// Cache prayer times for offline use
async function cachePrayerTimes(prayerData) {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const response = new Response(JSON.stringify(prayerData), {
      headers: { 'Content-Type': 'application/json' }
    });
    await cache.put('/api/prayer-times', response);
    console.log('[ServiceWorker] Prayer times cached successfully');
  } catch (error) {
    console.log('[ServiceWorker] Failed to cache prayer times:', error);
  }
}

// Cache Quran data for offline use
async function cacheQuranData(quranData) {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const response = new Response(JSON.stringify(quranData), {
      headers: { 'Content-Type': 'application/json' }
    });
    await cache.put('/api/quran', response);
    console.log('[ServiceWorker] Quran data cached successfully');
  } catch (error) {
    console.log('[ServiceWorker] Failed to cache Quran data:', error);
  }
}

// Perform manual sync
async function performSync() {
  try {
    await Promise.all([
      syncHabitData(),
      syncPrayerData(),
      syncProgressData()
    ]);

    // Notify main thread of successful sync
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_COMPLETE' });
    });
  } catch (error) {
    console.log('[ServiceWorker] Manual sync failed:', error);
  }
}

console.log('[ServiceWorker] Service worker script loaded');
