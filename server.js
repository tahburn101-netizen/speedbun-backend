const express = require('express');
const seedCars = require('./seed_cars');
const cors = require('cors');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── DATABASE ────────────────────────────────────────────────────────────────
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'speedbun.db'));

// Serve uploaded images
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    name TEXT NOT NULL,
    year TEXT,
    miles TEXT,
    price TEXT,
    fuel TEXT,
    trans TEXT,
    color TEXT,
    hp TEXT,
    seats TEXT,
    range_mi TEXT,
    desc TEXT,
    hero_img TEXT,
    imgs TEXT DEFAULT '[]',
    at_link TEXT DEFAULT '',
    fb_link TEXT DEFAULT '',
    wa_link TEXT DEFAULT '',
    ig_link TEXT DEFAULT '',
    sold INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sold_cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url TEXT NOT NULL,
    label TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS editable_text (
    id TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─── SEED DEFAULT SETTINGS ───────────────────────────────────────────────────
const defaultSettings = {
  fb_url: 'https://www.facebook.com/share/1DzPe8NNxo/?mibextid=wwXIfr',
  at_url: '#',
  wa_url: 'https://wa.me/447891237204',
  ig_url: 'https://www.instagram.com/speedbun?igsh=MWVhZ3pwNHE4anB6cQ%3D%3D&utm_source=qr',
  tt_url: 'https://www.tiktok.com/@speedbuncars?_r=1&_t=ZN-952HaLEF7mI',
  contact_phone: '07891 237204',
  contact_email: 'tahmid772011@gmail.com',
  contact_address: '16 Primrose Lane, Birmingham, B28 0JJ',
  contact_hours: 'Mon–Fri: 9am–6pm\nSat: 10am–4pm\nSun: Closed',
  admin_user: 'imranadmin',
  admin_pass: 'Admin1234!'
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) {
  insertSetting.run(k, v);
}

// ─── SEED CARS FROM CAZOO ────────────────────────────────────────────────────
const carCount = db.prepare('SELECT COUNT(*) as c FROM cars').get();
if (carCount.c === 0) {
  seedCars(db);
}

// ─── SEED SOLD CARS ──────────────────────────────────────────────────────────
const soldCount = db.prepare('SELECT COUNT(*) as c FROM sold_cars').get();
if (soldCount.c === 0) {
  // Seed with the uploaded sold car images (served from GitHub Pages)
  const GH_PAGES_BASE = 'https://tahburn101-netizen.github.io/speedbun/sold_cars';
  const soldImages = [
    'IMG-20260405-WA0000.jpg', 'IMG-20260405-WA0001.jpg', 'IMG-20260405-WA0002.jpg',
    'IMG-20260405-WA0003.jpg', 'IMG-20260405-WA0004.jpg', 'IMG-20260405-WA0005.jpg',
    'IMG-20260405-WA0006.jpg', 'IMG-20260405-WA0007.jpg', 'IMG-20260405-WA0008.jpg',
    'IMG-20260405-WA0009.jpg', 'IMG-20260405-WA0010.jpg', 'IMG-20260405-WA0011.jpg',
    'IMG-20260405-WA0012.jpg', 'IMG-20260405-WA0013.jpg'
  ];
  const insertSold = db.prepare('INSERT INTO sold_cars (image_url, label, sort_order) VALUES (?, ?, ?)');
  soldImages.forEach((img, i) => {
    insertSold.run(`${GH_PAGES_BASE}/${img}`, 'Sold', i);
  });
  console.log('Seeded 14 sold car images');
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getSetting(key) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run(key, value);
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const auth = req.headers['x-admin-token'];
  if (auth === 'speedbun_admin_' + getSetting('admin_pass')) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ─── MULTER ──────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── SETTINGS ──
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_settings WHERE key != "admin_pass" AND key != "admin_user"').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const allowed = ['fb_url','at_url','wa_url','ig_url','tt_url','contact_phone','contact_email','contact_address','contact_hours'];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) setSetting(k, v);
  }
  res.json({ ok: true });
});

// Admin login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const storedUser = getSetting('admin_user');
  const storedPass = getSetting('admin_pass');
  if (username === storedUser && password === storedPass) {
    res.json({ ok: true, token: 'speedbun_admin_' + storedPass });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Change admin credentials
app.post('/api/admin/credentials', requireAdmin, (req, res) => {
  const { newUser, newPass } = req.body;
  if (newUser) setSetting('admin_user', newUser);
  if (newPass) setSetting('admin_pass', newPass);
  res.json({ ok: true, token: newPass ? 'speedbun_admin_' + (newPass || getSetting('admin_pass')) : undefined });
});

// ── EDITABLE TEXT ──
app.get('/api/text', (req, res) => {
  const rows = db.prepare('SELECT id, value FROM editable_text').all();
  const text = {};
  rows.forEach(r => text[r.id] = r.value);
  res.json(text);
});

app.post('/api/text', requireAdmin, (req, res) => {
  const { texts } = req.body; // { id: value, ... }
  const upsert = db.prepare('INSERT OR REPLACE INTO editable_text (id, value) VALUES (?, ?)');
  for (const [id, value] of Object.entries(texts)) {
    upsert.run(id, value);
  }
  res.json({ ok: true });
});

// ── CARS ──
app.get('/api/cars', (req, res) => {
  const cars = db.prepare('SELECT * FROM cars ORDER BY sort_order ASC, id ASC').all();
  cars.forEach(c => {
    try { c.imgs = JSON.parse(c.imgs || '[]'); } catch { c.imgs = []; }
  });
  res.json(cars);
});

app.get('/api/cars/active', (req, res) => {
  const cars = db.prepare('SELECT * FROM cars WHERE sold = 0 ORDER BY sort_order ASC, id ASC').all();
  cars.forEach(c => {
    try { c.imgs = JSON.parse(c.imgs || '[]'); } catch { c.imgs = []; }
  });
  res.json(cars);
});

app.get('/api/cars/:id', (req, res) => {
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.id);
  if (!car) return res.status(404).json({ error: 'Not found' });
  try { car.imgs = JSON.parse(car.imgs || '[]'); } catch { car.imgs = []; }
  res.json(car);
});

app.post('/api/cars', requireAdmin, (req, res) => {
  const { make, model, name, year, miles, price, fuel, trans, color, hp, seats, range_mi, desc, hero_img, imgs, at_link, fb_link, wa_link, ig_link } = req.body;
  const imgsJson = JSON.stringify(Array.isArray(imgs) ? imgs : []);
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM cars').get();
  const sortOrder = (maxOrder.m || 0) + 1;
  const result = db.prepare(`INSERT INTO cars (make,model,name,year,miles,price,fuel,trans,color,hp,seats,range_mi,desc,hero_img,imgs,at_link,fb_link,wa_link,ig_link,sold,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`).run(make||'', model||'', name||'', year||'', miles||'', price||'', fuel||'', trans||'', color||'', hp||'', seats||'', range_mi||'', desc||'', hero_img||'', imgsJson, at_link||'', fb_link||'', wa_link||'', ig_link||'', sortOrder);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.put('/api/cars/:id', requireAdmin, (req, res) => {
  const { make, model, name, year, miles, price, fuel, trans, color, hp, seats, range_mi, desc, hero_img, imgs, at_link, fb_link, wa_link, ig_link, sold, sort_order } = req.body;
  const imgsJson = imgs !== undefined ? JSON.stringify(Array.isArray(imgs) ? imgs : []) : undefined;
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.id);
  if (!car) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE cars SET make=?,model=?,name=?,year=?,miles=?,price=?,fuel=?,trans=?,color=?,hp=?,seats=?,range_mi=?,desc=?,hero_img=?,imgs=?,at_link=?,fb_link=?,wa_link=?,ig_link=?,sold=?,sort_order=? WHERE id=?`).run(
    make ?? car.make, model ?? car.model, name ?? car.name, year ?? car.year, miles ?? car.miles, price ?? car.price, fuel ?? car.fuel, trans ?? car.trans, color ?? car.color, hp ?? car.hp, seats ?? car.seats, range_mi ?? car.range_mi, desc ?? car.desc, hero_img ?? car.hero_img, imgsJson ?? car.imgs, at_link ?? car.at_link, fb_link ?? car.fb_link, wa_link ?? car.wa_link, ig_link ?? car.ig_link, sold ?? car.sold, sort_order ?? car.sort_order, req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/cars/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM cars WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Mark as sold/unsold
app.post('/api/cars/:id/sold', requireAdmin, (req, res) => {
  const { sold } = req.body;
  db.prepare('UPDATE cars SET sold = ? WHERE id = ?').run(sold ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ── SOLD CARS CAROUSEL ──
app.get('/api/sold-cars', (req, res) => {
  const rows = db.prepare('SELECT * FROM sold_cars ORDER BY sort_order ASC, id ASC').all();
  res.json(rows);
});

app.post('/api/sold-cars', requireAdmin, upload.single('image'), (req, res) => {
  const { label } = req.body;
  let imageUrl = req.body.image_url || '';
  if (req.file) {
    imageUrl = `/uploads/${req.file.filename}`;
  }
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM sold_cars').get();
  const sortOrder = (maxOrder.m || 0) + 1;
  const result = db.prepare('INSERT INTO sold_cars (image_url, label, sort_order) VALUES (?, ?, ?)').run(imageUrl, label || '', sortOrder);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.put('/api/sold-cars/:id', requireAdmin, (req, res) => {
  const { label, image_url } = req.body;
  const row = db.prepare('SELECT * FROM sold_cars WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE sold_cars SET label=?, image_url=? WHERE id=?').run(label ?? row.label, image_url ?? row.image_url, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/sold-cars/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM sold_cars WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── IMAGE UPLOAD ──
app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
});

// Multiple images upload
app.post('/api/upload-multiple', requireAdmin, upload.array('images', 20), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ ok: true, urls });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SpeedBun API running on port ${PORT}`);
});
