'use strict';

/*
 * Local demo backend for Scrap Yard Manager.
 *
 * app.js talks to the server only through fetch('/api/...'). This file answers those
 * calls inside the browser, from test data kept in localStorage, whenever there is no
 * real backend behind the page (page opened from a file, or served by a plain static
 * file server). app.js itself is not changed: its token handling (Authorization header,
 * 401 -> back to the login screen) and PIN screen run exactly as they do against server.js.
 *
 * The demo backend repeats the rules of server.js: separate worker/admin PINs (salted hash,
 * never compared in clear), random session tokens, idle timeouts (worker 12 h, admin 15 min),
 * lock-out after 5 wrong PINs, role checks on every route, the same validation and stock rules.
 *
 * When is it used?
 *   - ?mock=1      always (demo)         - ?mock=0      never (real server only)
 *   - ?mock=reset  restore the seed data, then demo
 *   - otherwise    automatically, but ONLY when the page was opened from a file or the
 *                  host is a plain static file server (it lacks the security headers that
 *                  server.js sends). A real backend that is merely unreachable (Wi-Fi drop)
 *                  is never replaced by fake data, and the check never requests /api/.
 * Nothing is ever sent anywhere. Real data (data/ folder on the server) is not touched.
 */
(() => {
  const g = typeof window !== 'undefined' ? window : globalThis;
  const loc = g.location || { search: '', protocol: 'http:', href: 'http://localhost/' };
  const forced = new URLSearchParams(loc.search || '').get('mock');

  const DB_KEY = 'sy_mock_db';
  const SESSIONS_KEY = 'sy_mock_sessions';
  const APP_TOKEN_KEY = 'sy_token'; // the key app.js keeps its token under
  const SESSION_IDLE_MS = { worker: 12 * 3600e3, admin: 15 * 60e3 };
  const MAX_WEIGHT_KG = 200000;
  const DEMO_PINS = { worker: '1111', admin: '222222' };

  // Same lists as catalog.js (that file is Node-only, so it is repeated here).
  const MATERIALS = [
    { id: 'copper-wire', name: 'Copper Wire', color: '#d9824f' },
    { id: 'aluminum-cable', name: 'Aluminum Cable', color: '#9fb8cf' },
    { id: 'brass', name: 'Brass', color: '#e0be4a' },
    { id: 'stainless-steel', name: 'Stainless Steel', color: '#b4bcc6' },
    { id: 'copper-pipes', name: 'Copper Pipes', color: '#c46d3d' },
    { id: 'kopa-pipes', name: 'Painted Copper Pipes', color: '#6fb08a' },
    { id: 'kopa-tanks', name: 'Copper Tanks', color: '#58a07a' },
    { id: 'lead', name: 'Lead', color: '#7a7f8a' },
    { id: 'dry-copper-wire', name: 'Dry Copper Wire', color: '#be7a4c' },
    { id: 'lead-cables', name: 'Lead Cables', color: '#6d8494' },
    { id: 'stainless-steel-316', name: 'Stainless Steel 316', color: '#a8b7c8' },
    { id: 'armored-cables', name: 'Armored Cables', color: '#6d756e' },
    { id: 'clean-copper-pipes', name: 'Clean Copper Pipes', color: '#c07a50' },
    { id: 'copper-solid-bars', name: 'Copper Solid Bars', color: '#cd8050' },
    { id: 'data-cables', name: 'Data Cables', color: '#7297b5' },
    { id: 'electric-motors', name: 'Electric Motors', color: '#9a86c8' },
    { id: 'transformers', name: 'Transformers', color: '#c486a0' },
    { id: 'radiators', name: 'Radiators', color: '#6fb0c4' },
    { id: 'mixed-metals', name: 'Mixed Metals', color: '#9aa3ad' },
  ];
  const PRODUCTS = [
    { id: 'copper-granules', name: 'Copper Granules', color: '#d9824f' },
    { id: 'aluminum-bars', name: 'Processed Aluminum Bars', color: '#9fb8cf' },
    { id: 'brass-ingots', name: 'Brass Ingots', color: '#e0be4a' },
    { id: 'recycled-copper-pipes', name: 'Recycled Copper Pipes', color: '#c46d3d' },
    { id: 'recycled-kopa-pipes', name: 'Recycled Painted Copper Pipes', color: '#6fb08a' },
    { id: 'recycled-kopa-tanks', name: 'Recycled Copper Tanks', color: '#58a07a' },
    { id: 'recycled-lead', name: 'Recycled Lead', color: '#7a7f8a' },
    { id: 'dry-copper-granules', name: 'Dry Copper Granules', color: '#be7a4c' },
    { id: 'recycled-lead-cables', name: 'Recycled Lead Cables', color: '#6d8494' },
    { id: 'recycled-stainless-steel-316', name: 'Recycled Stainless Steel 316', color: '#a8b7c8' },
    { id: 'recycled-armored-cables', name: 'Recycled Armored Cables', color: '#6d756e' },
    { id: 'recycled-clean-copper-pipes', name: 'Recycled Clean Copper Pipes', color: '#c07a50' },
    { id: 'copper-solid-bar-scrap', name: 'Copper Solid Bar Scrap', color: '#cd8050' },
    { id: 'recycled-data-cables', name: 'Recycled Data Cables', color: '#7297b5' },
    { id: 'electric-motor-scrap', name: 'Electric Motor Scrap', color: '#9a86c8' },
    { id: 'transformer-scrap', name: 'Transformer Scrap', color: '#c486a0' },
    { id: 'radiator-scrap', name: 'Radiator Scrap', color: '#6fb0c4' },
    { id: 'mixed-metal-scrap', name: 'Mixed Metal Scrap', color: '#9aa3ad' },
  ];
  const DEFAULT_PRODUCT = {
    'copper-wire': 'copper-granules',
    'aluminum-cable': 'aluminum-bars',
    'brass': 'brass-ingots',
    'stainless-steel': 'mixed-metal-scrap',
    'copper-pipes': 'recycled-copper-pipes',
    'kopa-pipes': 'recycled-kopa-pipes',
    'kopa-tanks': 'recycled-kopa-tanks',
    'lead': 'recycled-lead',
    'dry-copper-wire': 'dry-copper-granules',
    'lead-cables': 'recycled-lead-cables',
    'stainless-steel-316': 'recycled-stainless-steel-316',
    'armored-cables': 'recycled-armored-cables',
    'clean-copper-pipes': 'recycled-clean-copper-pipes',
    'copper-solid-bars': 'copper-solid-bar-scrap',
    'data-cables': 'recycled-data-cables',
    'electric-motors': 'electric-motor-scrap',
    'transformers': 'transformer-scrap',
    'radiators': 'radiator-scrap',
    'mixed-metals': 'mixed-metal-scrap',
  };

  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  // ---------------------------------------------------------------- storage
  // localStorage, with an in-memory copy for browsers that block it (private mode).

  const mem = {};
  const storage = {
    read(k) {
      try { const v = g.localStorage.getItem(k); if (v !== null) return v; } catch { /* blocked */ }
      return k in mem ? mem[k] : null;
    },
    write(k, v) {
      mem[k] = v;
      try { g.localStorage.setItem(k, v); } catch { /* blocked */ }
    },
    remove(k) {
      delete mem[k];
      try { g.localStorage.removeItem(k); } catch { /* blocked */ }
    },
  };

  // ---------------------------------------------------------------- helpers (same rules as server.js)

  const pad = (n) => String(n).padStart(2, '0');
  const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const r2 = (n) => Math.round(n * 100) / 100;

  function str(value, name, { required = false, max = 120 } = {}) {
    if (value === undefined || value === null || value === '') {
      if (required) throw new HttpError(400, `${name} is required`);
      return '';
    }
    if (typeof value !== 'string') throw new HttpError(400, `${name} must be text`);
    const s = value.trim();
    if (!s && required) throw new HttpError(400, `${name} is required`);
    if (s.length > max) throw new HttpError(400, `${name} is too long (max ${max} characters)`);
    return s;
  }

  function weight(value, name) {
    const n = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      throw new HttpError(400, `${name} must be a number greater than 0`);
    }
    if (n > MAX_WEIGHT_KG) throw new HttpError(400, `${name} is too large (max ${MAX_WEIGHT_KG} kg)`);
    return r2(n);
  }

  function price(value, name) {
    const n = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e6) {
      throw new HttpError(400, `${name} must be a number between 0 and 1,000,000`);
    }
    return Math.round(n * 1000) / 1000;
  }

  function requestId(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || !/^[\w-]{8,64}$/.test(value)) throw new HttpError(400, 'Invalid request id');
    return value;
  }

  const findMaterial = (id) => MATERIALS.find((m) => m.id === id);
  const findProduct = (id) => PRODUCTS.find((p) => p.id === id);
  const PIN_RE = /^\d{4,8}$/;

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    g.crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------------------------------------------------------------- PIN hashing
  // crypto.subtle only exists on https / localhost, and the demo may run on plain http
  // over the Wi-Fi, so SHA-256 is implemented here. PINs are stored salted and stretched.

  const PRIMES = [];
  for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every((p) => n % p)) PRIMES.push(n);
  const frac = (x) => x - Math.floor(x);
  const K = PRIMES.map((p) => Math.floor(frac(Math.cbrt(p)) * 2 ** 32));
  const H0 = PRIMES.slice(0, 8).map((p) => Math.floor(frac(Math.sqrt(p)) * 2 ** 32));
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256(text) {
    const msg = unescape(encodeURIComponent(text)); // UTF-8 as a byte string
    const bytes = [];
    for (let i = 0; i < msg.length; i++) bytes.push(msg.charCodeAt(i));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 2 ** 32);
    const lo = bitLen >>> 0;
    for (let s = 24; s >= 0; s -= 8) bytes.push((hi >>> s) & 255);
    for (let s = 24; s >= 0; s -= 8) bytes.push((lo >>> s) & 255);

    const h = H0.slice();
    const w = new Array(64);
    for (let o = 0; o < bytes.length; o += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = (bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3];
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, gg, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & gg)) + K[i] + w[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = gg; gg = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + gg) | 0; h[7] = (h[7] + hh) | 0;
    }
    return h.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  function hashPin(pin, salt) {
    salt = salt || randomHex(16);
    let x = `${salt}:${pin}`;
    for (let i = 0; i < 1000; i++) x = sha256(x + salt);
    return { salt, hash: x };
  }

  function verifyPin(pin, record) {
    if (!record || typeof pin !== 'string' || pin.length > 64) return false;
    const a = hashPin(pin, record.salt).hash;
    const b = record.hash;
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  // ---------------------------------------------------------------- demo data

  function seedDb() {
    const settings = {
      company: { name: 'Demo Scrap Yard', address: '1 Example Street\nDemo Town' },
      currency: '£',
      prices: {
        materials: {
          'copper-wire': 5.2, 'aluminum-cable': 1.15, 'brass': 3.4, 'stainless-steel': 0.85, 'copper-pipes': 5.6,
          'kopa-pipes': 3.1, 'kopa-tanks': 2.8, 'electric-motors': 0.42, 'transformers': 0.6, 'radiators': 1.9, 'mixed-metals': 0.3,
        },
        products: {
          'copper-granules': 6.4, 'aluminum-bars': 1.6, 'brass-ingots': 3.9, 'recycled-copper-pipes': 6.1, 'recycled-kopa-pipes': 3.5,
          'recycled-kopa-tanks': 3.2, 'electric-motor-scrap': 0.55, 'transformer-scrap': 0.75, 'radiator-scrap': 2.2, 'mixed-metal-scrap': 0.4,
        },
      },
    };
    const now = Date.now();
    const stamp = (daysAgo, minutesBefore) => {
      const t = new Date(now - daysAgo * 864e5 - minutesBefore * 6e4);
      return { ts: t.toISOString(), date: localDate(t) };
    };
    const events = { intake: [], processing: [], dispatch: [] };
    const batchCount = {};
    const docketCount = {};

    // [days ago, minutes earlier, supplier, material, kg, inspection, notes] - oldest first
    [
      [6, 300, 'Greenfield Scrap Ltd', 'copper-wire', 420.5, 'Pass', ''],
      [5, 420, 'Harbour Metals', 'aluminum-cable', 610, 'Pass', ''],
      [5, 200, 'J. Smith', 'brass', 185.2, 'Pass', 'Mostly taps and fittings'],
      [4, 380, 'Riverside Plumbing', 'copper-pipes', 240, 'Pass', ''],
      [3, 330, 'AutoDismantlers Ltd', 'electric-motors', 780, 'Pass', ''],
      [3, 150, 'Roadside Collections', 'mixed-metals', 150, 'Fail', 'Contaminated with plastic and rubber'],
      [2, 260, 'Greenfield Scrap Ltd', 'copper-wire', 355, 'Pass', ''],
      [1, 400, 'Harbour Metals', 'radiators', 290.4, 'Pass', ''],
      [1, 180, 'Northside Recyclers', 'kopa-tanks', 520, 'Pass', ''],
      [0, 150, 'Acme Cable Co', 'copper-wire', 128.6, 'Pass', ''],
      [0, 35, 'J. Smith', 'stainless-steel', 64.3, 'Pass', ''],
    ].forEach(([d, m, supplier, matId, weightKg, inspection, notes]) => {
      const t = stamp(d, m);
      const mat = findMaterial(matId);
      batchCount[t.date] = (batchCount[t.date] || 0) + 1;
      events.intake.push({
        id: events.intake.length + 1, ...t, supplier, materialId: mat.id, material: mat.name, weightKg, inspection,
        batchId: `B-${t.date.replace(/-/g, '')}-${String(batchCount[t.date]).padStart(3, '0')}`,
        notes, by: 'worker', pricePerKg: settings.prices.materials[mat.id] ?? null,
      });
    });

    // [days ago, minutes earlier, raw material, input kg, product, output kg, notes]
    [
      [5, 100, 'copper-wire', 400, 'copper-granules', 388, ''],
      [2, 180, 'aluminum-cable', 580, 'aluminum-bars', 561, ''],
      [1, 300, 'brass', 180, 'brass-ingots', 176.5, ''],
      [1, 100, 'electric-motors', 700, 'electric-motor-scrap', 630, 'Copper windings pulled out first'],
    ].forEach(([d, m, matId, inputKg, prodId, outputKg, notes]) => {
      const mat = findMaterial(matId);
      const prod = findProduct(prodId);
      events.processing.push({
        id: events.processing.length + 1, ...stamp(d, m), materialId: mat.id, material: mat.name, inputKg,
        productId: prod.id, product: prod.name, outputKg, notes,
      });
    });

    // [days ago, minutes earlier, buyer, product, kg, destination, notes]
    [
      [4, 200, 'Midlands Smelting', 'copper-granules', 300, 'Birmingham', ''],
      [1, 250, 'Foundry Supplies Ltd', 'aluminum-bars', 350, 'Leeds', 'Collected by buyer'],
      [0, 60, 'Midlands Smelting', 'copper-granules', 60, 'Birmingham', ''],
    ].forEach(([d, m, buyer, prodId, weightKg, destination, notes]) => {
      const t = stamp(d, m);
      const prod = findProduct(prodId);
      const year = t.date.slice(0, 4);
      docketCount[year] = (docketCount[year] || 0) + 1;
      events.dispatch.push({
        id: events.dispatch.length + 1, ...t, buyer, productId: prod.id, product: prod.name, weightKg,
        docketNo: `WZ/${year}/${String(docketCount[year]).padStart(4, '0')}`,
        destination, notes, pricePerKg: settings.prices.products[prod.id] ?? null,
      });
    });

    return {
      v: 1,
      config: { worker: hashPin(DEMO_PINS.worker), admin: hashPin(DEMO_PINS.admin) },
      settings,
      events,
      limiter: { count: 0, until: 0 },
    };
  }

  let db = null;

  function loadDb() {
    const raw = storage.read(DB_KEY);
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (d && d.v === 1 && d.config && d.events && d.settings) return d;
      } catch { /* damaged: start again from the seed */ }
    }
    const fresh = seedDb();
    storage.write(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }

  const commit = () => storage.write(DB_KEY, JSON.stringify(db));

  function reset() {
    storage.remove(DB_KEY);
    storage.remove(SESSIONS_KEY);
    storage.remove(APP_TOKEN_KEY); // a token from before the reset would only show "session expired"
  }

  // ---------------------------------------------------------------- business logic

  const nextId = (list) => list.reduce((m, e) => Math.max(m, e.id), 0) + 1;

  function addEvent(type, rec) {
    rec.id = nextId(db.events[type]);
    db.events[type].push(rec);
    commit();
    return rec;
  }

  function duplicate(type, rid) {
    return rid ? db.events[type].find((e) => e.rid === rid) || null : null;
  }

  function computeStock() {
    const raw = Object.fromEntries(MATERIALS.map((m) => [m.id, 0]));
    const prod = Object.fromEntries(PRODUCTS.map((p) => [p.id, 0]));
    for (const e of db.events.intake) if (e.inspection === 'Pass') raw[e.materialId] += e.weightKg;
    for (const e of db.events.processing) {
      raw[e.materialId] -= e.inputKg;
      prod[e.productId] += e.outputKg;
    }
    for (const e of db.events.dispatch) prod[e.productId] -= e.weightKg;
    for (const k of Object.keys(raw)) raw[k] = r2(raw[k]);
    for (const k of Object.keys(prod)) prod[k] = r2(prod[k]);
    return { raw, prod };
  }

  function nextBatchId() {
    const today = localDate(new Date());
    const n = db.events.intake.filter((e) => e.date === today).length + 1;
    return `B-${today.replace(/-/g, '')}-${String(n).padStart(3, '0')}`;
  }

  function nextDocket() {
    const year = new Date().getFullYear();
    let n = db.events.dispatch.filter((d) => d.date.startsWith(String(year))).length + 1;
    const used = new Set(db.events.dispatch.map((d) => d.docketNo.toLowerCase()));
    let no;
    do {
      no = `WZ/${year}/${String(n++).padStart(4, '0')}`;
    } while (used.has(no.toLowerCase()));
    return no;
  }

  // What the weighbridge worker may see about an intake record: no prices, no stock.
  const workerView = (e) => ({
    id: e.id, ts: e.ts, supplier: e.supplier, material: e.material, weightKg: e.weightKg, inspection: e.inspection, batchId: e.batchId,
  });

  const withValue = (e, priceField = 'pricePerKg') => {
    const { rid, ...rest } = e;
    return { ...rest, value: e[priceField] != null ? r2((e.weightKg ?? e.outputKg) * e[priceField]) : null };
  };

  // ---------------------------------------------------------------- sessions and tokens

  const loadSessions = () => {
    try { return JSON.parse(storage.read(SESSIONS_KEY)) || {}; } catch { return {}; }
  };
  const saveSessions = (s) => storage.write(SESSIONS_KEY, JSON.stringify(s));

  function getSession(token) {
    if (!token) return null;
    const all = loadSessions();
    const s = all[token];
    if (!s) return null;
    const now = Date.now();
    if (now - s.last > SESSION_IDLE_MS[s.role]) {
      delete all[token];
      saveSessions(all);
      return null;
    }
    s.last = now;
    saveSessions(all);
    return { ...s, token };
  }

  // Locks the device out after repeated wrong PINs (1 min after 5 tries, doubling, max 16 min).
  const limiter = {
    blockedFor() {
      const r = db.limiter;
      return r && r.until ? Math.max(0, Math.ceil((r.until - Date.now()) / 1000)) : 0;
    },
    fail() {
      const r = db.limiter || (db.limiter = { count: 0, until: 0 });
      r.count += 1;
      if (r.count % 5 === 0) r.until = Date.now() + 60e3 * 2 ** Math.min(r.count / 5 - 1, 4);
      commit();
    },
    ok() {
      db.limiter = { count: 0, until: 0 };
      commit();
    },
  };

  function checkLocked() {
    const wait = limiter.blockedFor();
    if (wait > 0) throw new HttpError(429, `Too many wrong PIN attempts. Try again in ${wait} s.`);
  }

  // ---------------------------------------------------------------- routes (same table as server.js)

  const routes = [];
  // role: null = public, 'worker' = worker or admin, 'admin' = admin only
  const route = (method, pattern, role, handler) => routes.push({ method, pattern, role, handler });

  route('POST', '/api/login', null, (ctx) => {
    checkLocked();
    const pin = typeof ctx.body.pin === 'string' ? ctx.body.pin : '';
    const isAdmin = verifyPin(pin, db.config.admin);
    const isWorker = verifyPin(pin, db.config.worker);
    if (!isAdmin && !isWorker) {
      limiter.fail();
      throw new HttpError(401, 'Wrong PIN');
    }
    limiter.ok();
    const role = isAdmin ? 'admin' : 'worker';
    const token = `demo-${randomHex(24)}`;
    const now = Date.now();
    const all = loadSessions();
    for (const [t, s] of Object.entries(all)) if (now - s.last > SESSION_IDLE_MS[s.role]) delete all[t];
    all[token] = { role, last: now };
    saveSessions(all);
    return { token, role };
  });

  route('POST', '/api/logout', 'worker', (ctx) => {
    const all = loadSessions();
    delete all[ctx.session.token];
    saveSessions(all);
    return { ok: true };
  });

  route('GET', '/api/session', 'worker', (ctx) => ({ role: ctx.session.role }));

  route('GET', '/api/catalog', 'worker', (ctx) => {
    const suppliers = [];
    const list = db.events.intake;
    for (let i = list.length - 1; i >= 0 && suppliers.length < 50; i--) {
      if (!suppliers.includes(list[i].supplier)) suppliers.push(list[i].supplier);
    }
    const out = { materials: MATERIALS.map(({ id, name, color }) => ({ id, name, color })), suppliers };
    if (ctx.session.role === 'admin') {
      out.products = PRODUCTS.map(({ id, name, color }) => ({ id, name, color }));
      out.defaultProduct = DEFAULT_PRODUCT;
    }
    return out;
  });

  route('GET', '/api/next-batch', 'worker', () => ({ batchId: nextBatchId() }));

  route('GET', '/api/intake/recent', 'worker', () => {
    const today = localDate(new Date());
    return { entries: db.events.intake.filter((e) => e.date === today).slice(-8).reverse().map(workerView) };
  });

  route('POST', '/api/intake', 'worker', (ctx) => {
    const b = ctx.body;
    const rid = requestId(b.rid);
    const dup = duplicate('intake', rid);
    if (dup) return { entry: workerView(dup), duplicate: true };

    const supplier = str(b.supplier, 'Supplier Name', { required: true, max: 100 });
    const material = findMaterial(b.materialId);
    if (!material) throw new HttpError(400, 'Unknown material');
    const weightKg = weight(b.weightKg, 'Weight');
    if (!['Pass', 'Fail'].includes(b.inspection)) throw new HttpError(400, 'Inspection Status must be Pass or Fail');
    const notes = str(b.notes, 'Notes', { max: 500 });
    if (b.inspection === 'Fail' && !notes) throw new HttpError(400, 'Add a note explaining why the load failed inspection');
    const batchId = str(b.batchId, 'Batch ID', { max: 40 }) || nextBatchId();

    const now = new Date();
    const entry = addEvent('intake', {
      ...(rid && { rid }),
      ts: now.toISOString(),
      date: localDate(now),
      supplier,
      materialId: material.id,
      material: material.name,
      weightKg,
      inspection: b.inspection,
      batchId,
      notes,
      by: ctx.session.role,
      pricePerKg: db.settings.prices.materials[material.id] ?? null,
    });
    ctx.status = 201;
    return { entry: workerView(entry) };
  });

  // ---- admin only

  route('GET', '/api/admin/stock', 'admin', () => {
    const { raw, prod } = computeStock();
    return {
      materials: MATERIALS.map((m) => ({ id: m.id, name: m.name, color: m.color, kg: raw[m.id] })),
      products: PRODUCTS.map((p) => ({ id: p.id, name: p.name, color: p.color, kg: prod[p.id] })),
    };
  });

  route('GET', '/api/admin/dashboard', 'admin', (ctx) => {
    const asked = Number(ctx.url.searchParams.get('days'));
    const count = [7, 14, 30].includes(asked) ? asked : 7;
    const sums = {};
    const bucket = (date) => (sums[date] = sums[date] || { intakeKg: 0, dispatchKg: 0 });
    for (const e of db.events.intake) if (e.inspection === 'Pass') bucket(e.date).intakeKg += e.weightKg;
    for (const e of db.events.dispatch) bucket(e.date).dispatchKg += e.weightKg;

    const days = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = localDate(d);
      const s = sums[date] || { intakeKg: 0, dispatchKg: 0 };
      days.push({ date, intakeKg: r2(s.intakeKg), dispatchKg: r2(s.dispatchKg) });
    }
    const today = localDate(new Date());
    const { raw, prod } = computeStock();
    const sum = (o) => r2(Object.values(o).reduce((a, b) => a + b, 0));
    return {
      currency: db.settings.currency,
      days,
      today: {
        intakeKg: days[days.length - 1].intakeKg,
        dispatchKg: days[days.length - 1].dispatchKg,
        loads: db.events.intake.filter((e) => e.date === today).length,
        rejected: db.events.intake.filter((e) => e.date === today && e.inspection === 'Fail').length,
      },
      totals: { rawKg: sum(raw), productKg: sum(prod) },
    };
  });

  route('GET', '/api/admin/logs', 'admin', (ctx) => {
    const asked = parseInt(ctx.url.searchParams.get('limit'), 10);
    const limit = Math.min(Math.max(asked || 50, 1), 500);
    const last = (arr) => arr.slice(-limit).reverse();
    return {
      currency: db.settings.currency,
      intake: last(db.events.intake).map((e) => withValue(e)),
      dispatch: last(db.events.dispatch).map((e) => withValue(e)),
      processing: last(db.events.processing).map((e) => {
        const { rid, ...rest } = e;
        return { ...rest, lossKg: r2(e.inputKg - e.outputKg) };
      }),
    };
  });

  route('GET', '/api/admin/next-docket', 'admin', () => ({ docketNo: nextDocket() }));

  route('POST', '/api/admin/process', 'admin', (ctx) => {
    const b = ctx.body;
    const rid = requestId(b.rid);
    const dup = duplicate('processing', rid);
    if (dup) return { entry: dup, duplicate: true };

    const material = findMaterial(b.materialId);
    if (!material) throw new HttpError(400, 'Unknown raw material');
    const product = findProduct(b.productId);
    if (!product) throw new HttpError(400, 'Unknown output product');
    const inputKg = weight(b.inputKg, 'Input weight');
    const outputKg = weight(b.outputKg, 'Output weight');
    if (outputKg > inputKg) throw new HttpError(400, 'Output weight cannot be higher than the input weight');
    const available = computeStock().raw[material.id];
    if (inputKg > available + 1e-6) throw new HttpError(409, `Not enough ${material.name} in stock: only ${available} kg available`);
    const now = new Date();
    const entry = addEvent('processing', {
      ...(rid && { rid }),
      ts: now.toISOString(),
      date: localDate(now),
      materialId: material.id,
      material: material.name,
      inputKg,
      productId: product.id,
      product: product.name,
      outputKg,
      notes: str(b.notes, 'Notes', { max: 500 }),
    });
    ctx.status = 201;
    return { entry };
  });

  route('POST', '/api/admin/dispatch', 'admin', (ctx) => {
    const b = ctx.body;
    const rid = requestId(b.rid);
    const dup = duplicate('dispatch', rid);
    if (dup) return { entry: withValue(dup), duplicate: true };

    const buyer = str(b.buyer, 'Recipient/Buyer', { required: true, max: 100 });
    const product = findProduct(b.productId);
    if (!product) throw new HttpError(400, 'Unknown product');
    const weightKg = weight(b.weightKg, 'Weight');
    const docketNo = str(b.docketNo, 'Dispatch Docket No.', { max: 40 }) || nextDocket();
    if (db.events.dispatch.some((d) => d.docketNo.toLowerCase() === docketNo.toLowerCase())) {
      throw new HttpError(409, `Dispatch Docket No. ${docketNo} is already used`);
    }
    const available = computeStock().prod[product.id];
    if (weightKg > available + 1e-6) throw new HttpError(409, `Not enough ${product.name} in stock: only ${available} kg available`);
    const now = new Date();
    const entry = addEvent('dispatch', {
      ...(rid && { rid }),
      ts: now.toISOString(),
      date: localDate(now),
      buyer,
      productId: product.id,
      product: product.name,
      weightKg,
      docketNo,
      destination: str(b.destination, 'Destination', { max: 150 }),
      notes: str(b.notes, 'Notes', { max: 500 }),
      pricePerKg: db.settings.prices.products[product.id] ?? null,
    });
    ctx.status = 201;
    return { entry: withValue(entry) };
  });

  route('GET', '/api/admin/settings', 'admin', () => db.settings);

  route('PUT', '/api/admin/settings', 'admin', (ctx) => {
    const b = ctx.body;
    const next = JSON.parse(JSON.stringify(db.settings));
    if (b.company && typeof b.company === 'object') {
      next.company.name = str(b.company.name, 'Company name', { max: 100 });
      next.company.address = str(b.company.address, 'Company address', { max: 300 });
    }
    if (b.currency !== undefined) next.currency = str(b.currency, 'Currency', { max: 8 });
    if (b.prices && typeof b.prices === 'object') {
      for (const [group, list] of [['materials', MATERIALS], ['products', PRODUCTS]]) {
        const src = b.prices[group];
        if (!src || typeof src !== 'object') continue;
        for (const item of list) {
          if (!Object.prototype.hasOwnProperty.call(src, item.id)) continue;
          const v = src[item.id];
          if (v === '' || v === null) delete next.prices[group][item.id];
          else next.prices[group][item.id] = price(v, `${item.name} price`);
        }
      }
    }
    db.settings = next;
    commit();
    return db.settings;
  });

  route('POST', '/api/admin/pin', 'admin', (ctx) => {
    checkLocked();
    const { role, newPin, adminPin } = ctx.body;
    if (!['worker', 'admin'].includes(role)) throw new HttpError(400, 'Choose which PIN to change');
    if (typeof adminPin !== 'string' || !verifyPin(adminPin, db.config.admin)) {
      limiter.fail();
      throw new HttpError(403, 'Your current admin PIN is wrong');
    }
    limiter.ok();
    if (typeof newPin !== 'string' || !PIN_RE.test(newPin)) throw new HttpError(400, 'The new PIN must be 4 to 8 digits');
    const other = role === 'admin' ? 'worker' : 'admin';
    if (verifyPin(newPin, db.config[other])) throw new HttpError(400, 'Worker and admin PINs must be different');
    db.config[role] = hashPin(newPin);
    commit();
    if (role === 'worker') {
      const all = loadSessions();
      for (const [t, s] of Object.entries(all)) if (s.role === 'worker') delete all[t]; // old PIN holders are logged out
      saveSessions(all);
    }
    return { ok: true };
  });

  // ---------------------------------------------------------------- request entry point

  function parseBody(text) {
    if (text === undefined || text === null || text === '') return {};
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      return v;
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
  }

  // request('POST', '/api/login', { token, body }) -> { status, data }
  function request(method, target, opts = {}) {
    try {
      db = loadDb();
      const url = new URL(target, 'http://demo.local');
      const r = routes.find((x) => x.method === method && x.pattern === url.pathname);
      if (!r) throw new HttpError(404, 'Not found');
      let session = null;
      if (r.role) {
        session = getSession(opts.token);
        if (!session) throw new HttpError(401, 'Please enter your PIN');
        if (r.role === 'admin' && session.role !== 'admin') throw new HttpError(403, 'Administrator access required');
      }
      const body = method === 'POST' || method === 'PUT' ? (opts.rawBody !== undefined ? parseBody(opts.rawBody) : opts.body || {}) : {};
      const ctx = { url, body, session, status: 200 };
      const data = r.handler(ctx);
      return { status: ctx.status, data };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, data: { error: err.message } };
      console.error(err);
      return { status: 500, data: { error: 'Something went wrong in the local demo backend' } };
    }
  }

  // ---------------------------------------------------------------- fetch hook
  // Only /api/ calls are looked at. In demo mode they are answered here; otherwise they pass
  // straight through to the real server, untouched.

  const origFetch = typeof g.fetch === 'function' ? g.fetch.bind(g) : null;

  // server.js puts these security headers on every response, static files included
  // (see SECURITY_HEADERS there; test/api.test.js guards it). A plain static file server does not.
  const looksLikeBackend = (res) =>
    (res.headers.get('x-frame-options') || '').toLowerCase() === 'deny' &&
    /frame-ancestors 'none'/.test(res.headers.get('content-security-policy') || '');

  async function decide() {
    if (forced === '0') return false;
    if (forced === '1' || forced === 'reset' || loc.protocol === 'file:' || !origFetch) return true;
    try {
      // A file that exists on both kinds of server, so the check itself never causes a 404.
      const res = await origFetch(new URL('manifest.webmanifest', loc.href).href, { cache: 'no-store' });
      return !looksLikeBackend(res);
    } catch {
      return false; // server unreachable: let the app show its own "cannot reach the server" message
    }
  }

  if (forced === 'reset') {
    reset();
    try { g.history.replaceState(null, '', `${loc.pathname || ''}?mock=1${loc.hash || ''}`); } catch { /* ignore */ }
  }

  const ready = decide();

  async function answerLocally(method, route, input, init) {
    const asRequest = input && typeof input === 'object' && typeof input.url === 'string' ? input : null;
    const headers = new Headers((init && init.headers) || (asRequest && asRequest.headers) || undefined);
    const m = /^Bearer (.+)$/.exec(headers.get('authorization') || '');
    let rawBody;
    if (method === 'POST' || method === 'PUT') {
      if (init && init.body != null) rawBody = String(init.body);
      else if (asRequest) rawBody = await asRequest.text();
    }
    const { status, data } = request(method, route, { token: m ? m[1] : null, rawBody });
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  g.fetch = function patchedFetch(input, init) {
    let url;
    try {
      url = new URL(typeof input === 'string' ? input : input.url, loc.href);
    } catch {
      return origFetch(input, init);
    }
    const at = url.pathname.indexOf('/api/');
    if (at === -1 || url.host !== (loc.host || '') || url.protocol !== loc.protocol) return origFetch(input, init);
    const route = url.pathname.slice(at) + url.search;
    const asRequest = input && typeof input === 'object' && typeof input.url === 'string' ? input : null;
    const method = String((init && init.method) || (asRequest && asRequest.method) || 'GET').toUpperCase();
    return ready.then((useMock) => (useMock ? answerLocally(method, route, input, init) : origFetch(input, init)));
  };

  // ---------------------------------------------------------------- "demo mode" ribbon

  function showRibbon() {
    if (typeof document === 'undefined') return;
    const add = () => {
      const bar = document.createElement('div');
      bar.className = 'demo-banner';
      const label = document.createElement('span');
      let hint = '';
      try {
        db = loadDb();
        if (verifyPin(DEMO_PINS.worker, db.config.worker) && verifyPin(DEMO_PINS.admin, db.config.admin)) {
          hint = ` · PIN ${DEMO_PINS.worker} worker · ${DEMO_PINS.admin} admin`;
        }
      } catch { /* no hint */ }
      label.textContent = `DEMO · test data${hint}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Reset';
      btn.title = 'Restore the original test data';
      btn.addEventListener('click', () => {
        if (!g.confirm || g.confirm('Restore the original test data? Everything entered in demo mode will be lost.')) {
          reset();
          loc.reload();
        }
      });
      bar.append(label, btn);
      document.body.classList.add('demo');
      document.body.prepend(bar);
    };
    if (document.body) add();
    else document.addEventListener('DOMContentLoaded', add);
  }

  ready.then((useMock) => { if (useMock) showRibbon(); });

  g.SYMock = { ready, request, reset, routes, sha256, hashPin, verifyPin };
})();
