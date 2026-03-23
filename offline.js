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

// Image compression + 16:9 crop utility with iOS error handling
function compressImage(file, maxWidth = 800, quality = 0.75) {
  return new Promise((resolve, reject) => {
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
            let sw = img.width;
            let sh = img.height;

            // Crop to 16:9 from center
            const targetRatio = 16 / 9;
            const srcRatio = sw / sh;
            let cropX = 0, cropY = 0, cropW = sw, cropH = sh;
            if (srcRatio > targetRatio) {
              // Too wide — crop sides
              cropW = Math.round(sh * targetRatio);
              cropX = Math.round((sw - cropW) / 2);
            } else {
              // Too tall — crop top/bottom
              cropH = Math.round(sw / targetRatio);
              cropY = Math.round((sh - cropH) / 2);
            }

            // Scale down
            let outW = cropW;
            let outH = cropH;
            if (outW > maxWidth) {
              outH = Math.round((outH * maxWidth) / outW);
              outW = maxWidth;
            }

            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
            const result = canvas.toDataURL('image/jpeg', quality);
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
