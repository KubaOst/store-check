// Airtable REST API wrapper — single table "Storecheck"
// Fields: Session, Store, Date, Brand, Distributor, WWW, Photos, Timestamp
const AirtableAPI = {
  _pat: '',
  _baseId: '',
  _table: 'Storecheck',
  _baseUrl: 'https://api.airtable.com/v0',

  configure(pat, baseId) {
    this._pat = pat.trim();
    this._baseId = baseId.trim().replace(/\/+$/, '');
  },

  isConfigured() {
    return !!(this._pat && this._baseId);
  },

  async _fetch(path, { method = 'GET', params = null, body = null } = {}) {
    let url = `${this._baseUrl}/${this._baseId}/${path}`;
    if (params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) qs.append(k, v);
      url += '?' + qs.toString();
    }

    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${this._pat}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Airtable ${res.status}`);
    }
    if (method === 'DELETE') return null;
    return res.json();
  },

  // --- Entries ---

  async listEntriesBySession(sessionName) {
    const data = await this._fetch(this._table, {
      params: {
        filterByFormula: `{Session} = "${sessionName}"`,
        'sort[0][field]': 'Timestamp',
        'sort[0][direction]': 'asc',
      },
    });
    return data.records;
  },

  async createEntry({ session, brand, distributor, www }) {
    const fields = {
      Session: session,
      Brand: brand,
      Date: new Date().toISOString().slice(0, 10),
      Timestamp: new Date().toISOString(),
    };
    if (distributor) fields.Distributor = distributor;
    if (www) fields.WWW = www;
    return this._fetch(this._table, { method: 'POST', body: { fields } });
  },

  async updateEntry(id, fields) {
    return this._fetch(`${this._table}/${id}`, { method: 'PATCH', body: { fields } });
  },

  async deleteEntry(id) {
    return this._fetch(`${this._table}/${id}`, { method: 'DELETE' });
  },

  // --- Sessions (derived from unique Session values) ---

  async getSessions() {
    const data = await this._fetch(this._table, {
      params: { 'fields[]': 'Session', pageSize: '100' },
    });
    const counts = {};
    for (const r of data.records) {
      const s = r.fields.Session || 'Bez nazwy';
      counts[s] = (counts[s] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.name.localeCompare(a.name));
  },

  // --- Autocomplete ---

  async getUniqueBrands() {
    const data = await this._fetch(this._table, {
      params: { 'fields[]': 'Brand', pageSize: '100' },
    });
    return [...new Set(data.records.map(r => r.fields.Brand).filter(Boolean))].sort();
  },

  async getUniqueDistributors() {
    const data = await this._fetch(this._table, {
      params: { 'fields[]': 'Distributor', pageSize: '100' },
    });
    return [...new Set(data.records.map(r => r.fields.Distributor).filter(Boolean))].sort();
  },

  // --- Test ---

  async testConnection() {
    await this._fetch(this._table, { params: { maxRecords: '1' } });
    return true;
  },
};
