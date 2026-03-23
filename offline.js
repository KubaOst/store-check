// IndexedDB storage for photos + offline queue
const PhotoStore = {
  _db: null,
  DB_NAME: 'store-check-photos',
  DB_VERSION: 1,

  async init() {
    if (this._db) return;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('photos')) {
          db.createObjectStore('photos', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('offlineQueue')) {
          db.createObjectStore('offlineQueue', { keyPath: 'localId', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => { this._db = e.target.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },

  async _tx(store, mode, fn) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(store, mode);
      const s = tx.objectStore(store);
      const result = fn(s);
      tx.oncomplete = () => resolve(result._result);
      tx.onerror = () => reject(tx.error);
      // For getAll/get, attach to request
      if (result instanceof IDBRequest) {
        result.onsuccess = () => { result._result = result.result; };
      }
    });
  },

  // --- Photos (array of base64 per entry ID) ---

  async savePhotos(id, photosArray) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put({ id, photos: photosArray });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getPhotos(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('photos', 'readonly');
      const req = tx.objectStore('photos').get(id);
      req.onsuccess = () => resolve(req.result?.photos || (req.result?.base64 ? [req.result.base64] : []));
      req.onerror = () => reject(req.error);
    });
  },

  async deletePhotos(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // --- Offline Queue ---

  async addToQueue(entry) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('offlineQueue', 'readwrite');
      const req = tx.objectStore('offlineQueue').add(entry);
      req.onsuccess = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getQueue() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('offlineQueue', 'readonly');
      const req = tx.objectStore('offlineQueue').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async removeFromQueue(localId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('offlineQueue', 'readwrite');
      tx.objectStore('offlineQueue').delete(localId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async clearQueue() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('offlineQueue', 'readwrite');
      tx.objectStore('offlineQueue').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

// Image compression utility with iOS error handling
function compressImage(file, maxWidth = 800, quality = 0.75) {
  return new Promise((resolve, reject) => {
    // Fallback: if anything fails, try to return raw data URL
    const fallback = () => {
      const r = new FileReader();
      r.onload = (e) => resolve(e.target.result);
      r.onerror = () => reject(new Error('Cannot read file'));
      r.readAsDataURL(file);
    };

    try {
      const reader = new FileReader();
      reader.onerror = fallback;
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = fallback;
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            let w = img.width;
            let h = img.height;
            if (w > maxWidth) {
              h = (h * maxWidth) / w;
              w = maxWidth;
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const result = canvas.toDataURL('image/jpeg', quality);
            // Verify we got a valid data URL
            if (result && result.length > 100) {
              resolve(result);
            } else {
              fallback();
            }
          } catch (err) {
            fallback();
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    } catch (err) {
      fallback();
    }
  });
}
