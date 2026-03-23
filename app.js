const app = {
  currentSession: null,
  currentEntryId: null,
  pendingPhotos: [], // array of base64

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

  // --- Sessions ---

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

  createSession() {
    const today = new Date().toLocaleDateString('pl');
    const name = prompt('Nazwa sesji:', `Store Check ${today}`);
    if (!name || !name.trim()) return;
    this.openSession(name.trim());
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

      const noPhoto = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#232340"/><text x="36" y="40" text-anchor="middle" fill="#666" font-size="12">brak</text></svg>');
      const cards = [];
      for (const e of entries) {
        const f = e.fields;
        const photos = await PhotoStore.getPhotos(e.id);
        const thumbSrc = photos[0] || noPhoto;
        const photoCount = photos.length > 1 ? `<div class="photo-count">${photos.length}</div>` : '';
        cards.push(`
          <div class="entry-card" onclick="app.openEntry('${e.id}')">
            <div class="entry-thumb-wrap">
              <img class="entry-thumb" src="${thumbSrc}" alt="">
              ${photoCount}
            </div>
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
    this.pendingPhotos = [];
    document.getElementById('form-title').textContent = 'Nowy wpis';
    document.getElementById('delete-btn').classList.add('hidden');
    document.getElementById('field-brand').value = '';
    document.getElementById('field-distributor').value = '';
    document.getElementById('field-www').value = '';
    document.getElementById('form-status').textContent = '';
    document.getElementById('photo-input').value = '';
    this.renderPhotosGrid();
    this.showScreen('form');
  },

  async openEntry(id) {
    this.currentEntryId = id;
    this.pendingPhotos = await PhotoStore.getPhotos(id);
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

    document.getElementById('form-status').textContent = '';
    document.getElementById('photo-input').value = '';
    this.renderPhotosGrid();
    this.showScreen('form');
  },

  renderPhotosGrid() {
    const grid = document.getElementById('photos-grid');
    let html = '';
    this.pendingPhotos.forEach((photo, i) => {
      html += `
        <div class="photo-thumb">
          <img src="${photo}" alt="">
          <button class="photo-remove" onclick="event.stopPropagation(); app.removePhoto(${i})">✕</button>
        </div>
      `;
    });
    html += `
      <div class="photo-add" onclick="document.getElementById('photo-input').click()">
        <span>+</span>
      </div>
    `;
    grid.innerHTML = html;
  },

  removePhoto(index) {
    this.pendingPhotos.splice(index, 1);
    this.renderPhotosGrid();
  },

  hideForm() {
    this.showScreen('entries');
    this.loadEntries();
  },

  async onPhotoSelected(event) {
    const file = event.target.files[0];
    if (!file) return;
    const base64 = await compressImage(file, 1200, 0.85);
    this.pendingPhotos.push(base64);
    this.renderPhotosGrid();
    // Reset input so same file can be selected again
    document.getElementById('photo-input').value = '';
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

    if (this.pendingPhotos.length === 0 && !this.currentEntryId) {
      status.textContent = 'Dodaj przynajmniej jedno zdjecie';
      status.className = 'status-err';
      return;
    }

    this.showLoading('Zapisywanie...');

    try {
      if (navigator.onLine && AirtableAPI.isConfigured()) {
        if (this.currentEntryId) {
          const fields = { Brand: brand, Distributor: distributor || '', WWW: www || '' };
          await AirtableAPI.updateEntry(this.currentEntryId, fields);
          await PhotoStore.savePhotos(this.currentEntryId, this.pendingPhotos);
        } else {
          const entry = await AirtableAPI.createEntry({
            session: this.currentSession,
            brand,
            distributor,
            www,
          });
          await PhotoStore.savePhotos(entry.id, this.pendingPhotos);
        }
      } else {
        await PhotoStore.addToQueue({
          session: this.currentSession,
          brand,
          distributor,
          www,
          photos: this.pendingPhotos,
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
      await PhotoStore.deletePhotos(this.currentEntryId);
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
      const photoMaxH = 80;
      const spacing = 10;

      for (let i = 0; i < entries.length; i++) {
        const f = entries[i].fields;
        const photos = await PhotoStore.getPhotos(entries[i].id);

        // Brand header
        if (y + 30 > pageH - margin) {
          doc.addPage();
          y = margin;
        }

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(f.Brand || '—', margin, y + 5);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        const parts = [f.Distributor, f.WWW].filter(Boolean);
        if (parts.length) doc.text(parts.join('  |  '), margin, y + 11);
        doc.setTextColor(0);
        y += 16;

        // Photos for this entry
        for (const photoBase64 of photos) {
          if (y + photoMaxH + 5 > pageH - margin) {
            doc.addPage();
            y = margin;
          }

          try {
            const imgProps = doc.getImageProperties(photoBase64);
            let imgW = usableW;
            let imgH = (imgProps.height / imgProps.width) * imgW;
            if (imgH > photoMaxH) {
              imgH = photoMaxH;
              imgW = (imgProps.width / imgProps.height) * imgH;
            }
            doc.addImage(photoBase64, 'JPEG', margin + (usableW - imgW) / 2, y, imgW, imgH);
            y += imgH + 5;
          } catch (e) {
            y += 5;
          }
        }

        // Separator
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
        if (item.photos?.length) await PhotoStore.savePhotos(entry.id, item.photos);
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
