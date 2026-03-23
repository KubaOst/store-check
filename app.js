const app = {
  currentSession: null, // session name string
  currentEntryId: null,
  pendingPhoto: null, // base64

  // --- Init ---

  async init() {
    await PhotoStore.init();
    this.loadSettings();
    if (AirtableAPI.isConfigured()) {
      this.showScreen('sessions');
      this.loadSessions();
      this.loadAutocomplete();
    } else {
      this.showScreen('settings');
    }
    this.setupOfflineDetection();
    this.syncOfflineQueue();
  },

  // --- Settings ---

  loadSettings() {
    const pat = localStorage.getItem('sc_pat') || '';
    const baseId = localStorage.getItem('sc_baseId') || '';
    document.getElementById('settings-pat').value = pat;
    document.getElementById('settings-base').value = baseId;
    if (pat && baseId) AirtableAPI.configure(pat, baseId);
  },

  async saveSettings() {
    const pat = document.getElementById('settings-pat').value.trim();
    const baseId = document.getElementById('settings-base').value.trim();
    const status = document.getElementById('settings-status');

    if (!pat || !baseId) {
      status.textContent = 'Uzupelnij oba pola';
      status.className = 'status-err';
      return;
    }

    AirtableAPI.configure(pat, baseId);
    status.textContent = 'Testowanie polaczenia...';
    status.className = '';

    try {
      await AirtableAPI.testConnection();
      localStorage.setItem('sc_pat', pat);
      localStorage.setItem('sc_baseId', baseId);
      status.textContent = 'Polaczono!';
      status.className = 'status-ok';
      setTimeout(() => {
        this.showScreen('sessions');
        this.loadSessions();
        this.loadAutocomplete();
      }, 800);
    } catch (e) {
      status.textContent = `Blad: ${e.message}`;
      status.className = 'status-err';
    }
  },

  // --- Navigation ---

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(`${name}-screen`).classList.remove('hidden');
  },

  showLoading(text = 'Ladowanie...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading').classList.remove('hidden');
  },

  hideLoading() {
    document.getElementById('loading').classList.add('hidden');
  },

  // --- Sessions (grouped by Session field) ---

  async loadSessions() {
    try {
      const sessions = await AirtableAPI.getSessions();
      const list = document.getElementById('sessions-list');
      const empty = document.getElementById('sessions-empty');

      if (sessions.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
      }

      empty.classList.add('hidden');
      list.innerHTML = sessions.map(s => `
        <div class="session-card" onclick="app.openSession('${this.esc(s.name)}')">
          <div class="info">
            <div class="name">${this.esc(s.name)}</div>
          </div>
          <div class="count">${s.count}</div>
        </div>
      `).join('');
    } catch (e) {
      console.error('loadSessions:', e);
    }
  },

  async createSession() {
    const today = new Date().toLocaleDateString('pl');
    const name = `Store Check ${today}`;
    this.openSession(name);
  },

  openSession(name) {
    this.currentSession = name;
    document.getElementById('entries-title').textContent = name;
    this.showScreen('entries');
    this.loadEntries();
  },

  // --- Entries ---

  async loadEntries() {
    try {
      const entries = await AirtableAPI.listEntriesBySession(this.currentSession);
      const list = document.getElementById('entries-list');
      const empty = document.getElementById('entries-empty');

      if (entries.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
      }

      empty.classList.add('hidden');

      const cards = [];
      for (const e of entries) {
        const f = e.fields;
        const photo = await PhotoStore.getPhoto(e.id);
        const thumbSrc = photo || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" fill="%23333"><rect width="72" height="72"/><text x="36" y="40" text-anchor="middle" fill="%23666" font-size="12">brak</text></svg>';
        cards.push(`
          <div class="entry-card" onclick="app.openEntry('${e.id}')">
            <img class="entry-thumb" src="${thumbSrc}" alt="">
            <div class="entry-info">
              <div class="entry-brand">${this.esc(f.Brand || '')}</div>
              <div class="entry-dist">${this.esc(f.Distributor || '')}</div>
              ${f.WWW ? `<div class="entry-www">${this.esc(f.WWW)}</div>` : ''}
            </div>
          </div>
        `);
      }
      list.innerHTML = cards.join('');
    } catch (e) {
      console.error('loadEntries:', e);
    }
  },

  // --- Add/Edit Form ---

  showAddForm() {
    this.currentEntryId = null;
    this.pendingPhoto = null;
    document.getElementById('form-title').textContent = 'Nowy wpis';
    document.getElementById('delete-btn').classList.add('hidden');
    document.getElementById('preview-img').classList.add('hidden');
    document.getElementById('preview-img').src = '';
    document.querySelector('#photo-preview span').textContent = 'Kliknij aby zrobic zdjecie';
    document.getElementById('field-brand').value = '';
    document.getElementById('field-distributor').value = '';
    document.getElementById('field-www').value = '';
    document.getElementById('form-status').textContent = '';
    document.getElementById('photo-input').value = '';
    this.showScreen('form');
  },

  async openEntry(id) {
    this.currentEntryId = id;
    this.pendingPhoto = await PhotoStore.getPhoto(id);
    document.getElementById('form-title').textContent = 'Edycja';
    document.getElementById('delete-btn').classList.remove('hidden');

    try {
      const entries = await AirtableAPI.listEntriesBySession(this.currentSession);
      const entry = entries.find(e => e.id === id);
      if (entry) {
        const f = entry.fields;
        document.getElementById('field-brand').value = f.Brand || '';
        document.getElementById('field-distributor').value = f.Distributor || '';
        document.getElementById('field-www').value = f.WWW || '';
      }
    } catch (e) { /* offline */ }

    if (this.pendingPhoto) {
      const img = document.getElementById('preview-img');
      img.src = this.pendingPhoto;
      img.classList.remove('hidden');
    } else {
      document.getElementById('preview-img').classList.add('hidden');
      document.querySelector('#photo-preview span').textContent = 'Kliknij aby zmienic zdjecie';
    }

    document.getElementById('form-status').textContent = '';
    document.getElementById('photo-input').value = '';
    this.showScreen('form');
  },

  hideForm() {
    this.showScreen('entries');
    this.loadEntries();
  },

  async onPhotoSelected(event) {
    const file = event.target.files[0];
    if (!file) return;
    const base64 = await compressImage(file, 1200, 0.85);
    this.pendingPhoto = base64;
    const img = document.getElementById('preview-img');
    img.src = base64;
    img.classList.remove('hidden');
  },

  async saveEntry() {
    const brand = document.getElementById('field-brand').value.trim();
    const distributor = document.getElementById('field-distributor').value.trim();
    const www = document.getElementById('field-www').value.trim();
    const status = document.getElementById('form-status');

    if (!brand) {
      status.textContent = 'Marka jest wymagana';
      status.className = 'status-err';
      return;
    }

    if (!this.pendingPhoto && !this.currentEntryId) {
      status.textContent = 'Dodaj zdjecie';
      status.className = 'status-err';
      return;
    }

    this.showLoading('Zapisywanie...');

    try {
      if (navigator.onLine && AirtableAPI.isConfigured()) {
        if (this.currentEntryId) {
          const fields = { Brand: brand, Distributor: distributor || '', WWW: www || '' };
          await AirtableAPI.updateEntry(this.currentEntryId, fields);
          if (this.pendingPhoto) {
            await PhotoStore.savePhoto(this.currentEntryId, this.pendingPhoto);
          }
        } else {
          const entry = await AirtableAPI.createEntry({
            session: this.currentSession,
            brand,
            distributor,
            www,
          });
          if (this.pendingPhoto) {
            await PhotoStore.savePhoto(entry.id, this.pendingPhoto);
          }
        }
      } else {
        await PhotoStore.addToQueue({
          session: this.currentSession,
          brand,
          distributor,
          www,
          photoBase64: this.pendingPhoto,
        });
        this.updateOfflineCount();
      }

      this.hideLoading();
      this.hideForm();
      this.loadAutocomplete();
    } catch (e) {
      this.hideLoading();
      status.textContent = `Blad: ${e.message}`;
      status.className = 'status-err';
    }
  },

  async deleteEntry() {
    if (!this.currentEntryId) return;
    if (!confirm('Usunac ten wpis?')) return;

    this.showLoading('Usuwanie...');
    try {
      await AirtableAPI.deleteEntry(this.currentEntryId);
      await PhotoStore.deletePhoto(this.currentEntryId);
      this.hideLoading();
      this.hideForm();
    } catch (e) {
      this.hideLoading();
      alert('Blad: ' + e.message);
    }
  },

  // --- PDF Generation ---

  async generatePDF() {
    if (!this.currentSession) return;
    this.showLoading('Generowanie PDF...');

    try {
      const entries = await AirtableAPI.listEntriesBySession(this.currentSession);
      if (entries.length === 0) {
        this.hideLoading();
        alert('Brak wpisow w sesji');
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = 210;
      const pageH = 297;
      const margin = 15;
      const usableW = pageW - margin * 2;

      // Title
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(this.currentSession, margin, 25);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120);
      doc.text(new Date().toLocaleDateString('pl'), margin, 33);
      doc.setTextColor(0);

      let y = 45;
      const photoMaxH = 90;
      const spacing = 10;

      for (let i = 0; i < entries.length; i++) {
        const f = entries[i].fields;
        const photoBase64 = await PhotoStore.getPhoto(entries[i].id);

        if (y + photoMaxH + 20 > pageH - margin) {
          doc.addPage();
          y = margin;
        }

        if (photoBase64) {
          try {
            const imgProps = doc.getImageProperties(photoBase64);
            let imgW = usableW;
            let imgH = (imgProps.height / imgProps.width) * imgW;
            if (imgH > photoMaxH) {
              imgH = photoMaxH;
              imgW = (imgProps.width / imgProps.height) * imgH;
            }
            doc.addImage(photoBase64, 'JPEG', margin + (usableW - imgW) / 2, y, imgW, imgH);
            y += imgH + 3;
          } catch (e) {
            y += 5;
          }
        }

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(f.Brand || '—', margin, y + 5);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        const parts = [f.Distributor, f.WWW].filter(Boolean);
        if (parts.length) doc.text(parts.join('  |  '), margin, y + 11);
        doc.setTextColor(0);

        y += 16;
        doc.setDrawColor(220);
        doc.line(margin, y, pageW - margin, y);
        y += spacing;
      }

      const today = new Date().toISOString().slice(0, 10);
      doc.save(`store-check-${today}.pdf`);
      this.hideLoading();
    } catch (e) {
      this.hideLoading();
      alert('Blad PDF: ' + e.message);
    }
  },

  // --- Autocomplete ---

  async loadAutocomplete() {
    if (!AirtableAPI.isConfigured() || !navigator.onLine) return;
    try {
      const [brands, dists] = await Promise.all([
        AirtableAPI.getUniqueBrands(),
        AirtableAPI.getUniqueDistributors(),
      ]);
      this.setDatalist('brands-list', brands);
      this.setDatalist('distributors-list', dists);
    } catch (e) { /* silent */ }
  },

  setDatalist(id, values) {
    document.getElementById(id).innerHTML = values.map(v => `<option value="${this.esc(v)}">`).join('');
  },

  // --- Offline ---

  setupOfflineDetection() {
    const update = () => {
      if (navigator.onLine) {
        document.getElementById('offline-bar').classList.add('hidden');
        this.syncOfflineQueue();
      } else {
        document.getElementById('offline-bar').classList.remove('hidden');
      }
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  },

  async updateOfflineCount() {
    const queue = await PhotoStore.getQueue();
    document.getElementById('pending-count').textContent = queue.length;
    if (queue.length > 0) document.getElementById('offline-bar').classList.remove('hidden');
  },

  async syncOfflineQueue() {
    if (!navigator.onLine || !AirtableAPI.isConfigured()) return;
    const queue = await PhotoStore.getQueue();
    if (!queue.length) return;

    for (const item of queue) {
      try {
        const entry = await AirtableAPI.createEntry({
          session: item.session,
          brand: item.brand,
          distributor: item.distributor,
          www: item.www,
        });
        if (item.photoBase64) await PhotoStore.savePhoto(entry.id, item.photoBase64);
        await PhotoStore.removeFromQueue(item.localId);
      } catch (e) {
        break;
      }
    }
    this.updateOfflineCount();
  },

  // --- Helpers ---

  esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
};

document.addEventListener('DOMContentLoaded', () => app.init());
