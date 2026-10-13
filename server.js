require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_DIR = path.join(DATA_DIR, "db");
const MAX_FILE_MB = Math.max(1, Number(process.env.MAX_FILE_MB || 500));
for (const dir of [DATA_DIR, UPLOAD_DIR, DB_DIR]) fs.mkdirSync(dir, { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("ERROR: Set SESSION_SECRET to a random secret of at least 32 characters.");
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD_HASH || !process.env.ADMIN_PASSWORD_HASH.startsWith("$2")) {
  console.error("ERROR: Set ADMIN_PASSWORD_HASH to a bcrypt hash. See README.md.");
  process.exit(1);
}
if (!process.env.ADMIN_USERNAME) {
  console.error("ERROR: Set ADMIN_USERNAME in .env");
  process.exit(1);
}

const db = new Database(path.join(DB_DIR, "rell-linkes.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS files (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT 'Lainnya',
 original_name TEXT NOT NULL DEFAULT '',
 stored_name TEXT NOT NULL DEFAULT '',
 external_url TEXT NOT NULL DEFAULT '',
 size INTEGER NOT NULL DEFAULT 0,
 mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 downloads INTEGER NOT NULL DEFAULT 0
);
`);
const insertFile = db.prepare(`INSERT INTO files
(title,description,category,original_name,stored_name,external_url,size,mime_type)
VALUES (@title,@description,@category,@original_name,@stored_name,@external_url,@size,@mime_type)`);
const getFile = db.prepare("SELECT * FROM files WHERE id=?");
const listFiles = db.prepare("SELECT * FROM files ORDER BY id DESC");
const deleteFile = db.prepare("DELETE FROM files WHERE id=?");

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  name: "rell.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DB_DIR }),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect("/admin/login");
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}
function fmtSize(bytes) {
  if (!bytes) return "Link eksternal";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
function fmtDate(s) {
  const d = new Date(s.includes("Z") ? s : s.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day:"numeric", month:"short", year:"numeric" });
}
function validExternalUrl(raw) {
  try {
    const u = new URL(raw);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch { return null; }
}
function layout(title, body, admin = false) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#101116"><meta name="description" content="Rell Linkes, pusat unduhan file.">
  <title>${esc(title)} | Rell Linkes</title><link rel="stylesheet" href="/style.css"></head><body>
  <header class="topbar"><a class="brand" href="/"><span class="brand-mark">RL</span><span>RELL <b>LINKES</b><small>FILE DOWNLOAD CENTER</small></span></a>
  <nav><a href="/">Beranda</a>${admin ? '<a href="/admin">Dashboard</a><form class="nav-form" method="post" action="/admin/logout"><button class="nav-link" type="submit">Keluar</button></form>' : '<a href="/admin/login">Admin</a>'}</nav></header>
  <main class="container">${body}</main><footer>© ${new Date().getFullYear()} Rell Linkes <span>Unduh dengan bijak. Periksa file sebelum dibuka.</span></footer></body></html>`;
}
function fileCard(f) {
  const ext = f.external_url ? "LINK" : (path.extname(f.original_name).slice(1).toUpperCase() || "FILE").slice(0,5);
  return `<article class="file-card"><div class="file-icon">${esc(ext)}</div><div class="file-info"><div class="meta"><span>${esc(f.category)}</span><span>${esc(fmtSize(f.size))}</span></div><h3>${esc(f.title)}</h3><p>${esc(f.description || "Tidak ada deskripsi.")}</p><div class="file-foot"><small>${esc(fmtDate(f.created_at))} · ${Number(f.downloads)} unduhan</small><a class="btn btn-small" href="/download/${Number(f.id)}">${f.external_url ? "Buka link ↗" : "Download ↓"}</a></div></div></article>`;
}
app.get("/", (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const category = String(req.query.category || "").trim().slice(0, 40);
  let files = listFiles.all();
  if (q) {
    const needle = q.toLocaleLowerCase("id");
    files = files.filter(f => [f.title, f.description, f.category, f.original_name].some(v => String(v).toLocaleLowerCase("id").includes(needle)));
  }
  if (category) files = files.filter(f => f.category === category);
  const categories = [...new Set(listFiles.all().map(f => f.category))].sort();
  const cards = files.length ? files.map(fileCard).join("") : `<div class="empty"><span>⌕</span><h3>Belum ada file yang cocok</h3><p>Admin belum mengisi rak digitalnya, atau pencarianmu terlalu spesifik.</p></div>`;
  const opts = categories.map(c => `<option value="${esc(c)}" ${category===c?"selected":""}>${esc(c)}</option>`).join("");
  const body = `<section class="hero"><div class="eyebrow"><span class="pulse"></span> PUSAT FILE DIGITAL</div><h1>Temukan file.<br><em>Unduh dengan mudah.</em></h1><p>Semua file favoritmu di satu tempat. Cari, pilih, lalu unduh. Tidak perlu ritual teknologi.</p>
  <form class="searchbar" method="get" action="/"><label class="sr-only" for="q">Cari file</label><input id="q" name="q" value="${esc(q)}" placeholder="Cari nama file, mod, dokumen..."><select name="category" aria-label="Kategori"><option value="">Semua kategori</option>${opts}</select><button class="btn" type="submit">Cari</button></form></section>
  <section class="section-head"><div><div class="eyebrow">KOLEKSI</div><h2>File terbaru</h2></div><span class="count">${files.length} file</span></section><section class="file-grid">${cards}</section>`;
  res.send(layout("Beranda", body));
});
app.get("/download/:id", (req, res) => {
  const f = getFile.get(Number(req.params.id));
  if (!f) return res.status(404).send(layout("File tidak ditemukan", `<div class="empty"><h2>File tidak ditemukan</h2><a class="btn" href="/">Kembali</a></div>`));
  db.prepare("UPDATE files SET downloads=downloads+1 WHERE id=?").run(f.id);
  if (f.external_url) return res.redirect(f.external_url);
  const full = path.resolve(UPLOAD_DIR, f.stored_name);
  if (!f.stored_name || !full.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(full)) {
    return res.status(404).send(layout("File tidak tersedia", `<div class="empty"><h2>File tidak tersedia</h2><p>File mungkin sudah dipindahkan.</p><a class="btn" href="/">Kembali</a></div>`));
  }
  res.download(full, f.original_name || f.title, err => { if (err && !res.headersSent) res.status(500).end("Gagal mengirim file."); });
});

app.get("/admin/login", (req, res) => {
  if (req.session.isAdmin) return res.redirect("/admin");
  const error = req.query.error ? `<p class="notice error">Login gagal. Periksa username dan password.</p>` : "";
  const body = `<section class="auth-card"><div class="eyebrow">AREA TERBATAS</div><h1>Admin <em>Rell Linkes</em></h1><p>Masuk untuk mengelola file yang tampil di website.</p>${error}
  <form method="post" action="/admin/login" class="stack"><label>Username<input name="username" autocomplete="username" required maxlength="80"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><button class="btn" type="submit">Masuk ke dashboard</button></form><a class="back-link" href="/">← Kembali ke website</a></section>`;
  res.send(layout("Login Admin", body));
});
app.post("/admin/login", loginLimiter, async (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  const okUser = crypto.timingSafeEqual(Buffer.from(username.padEnd(80, "\0").slice(0,80)), Buffer.from(String(process.env.ADMIN_USERNAME).padEnd(80, "\0").slice(0,80)));
  let okPass = false;
  try { okPass = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH); } catch {}
  if (!okUser || !okPass) return res.redirect("/admin/login?error=1");
  req.session.regenerate(err => {
    if (err) return res.status(500).send("Gagal membuat sesi.");
    req.session.isAdmin = true;
    res.redirect("/admin");
  });
});
app.post("/admin/logout", requireAdmin, (req, res) => req.session.destroy(() => res.redirect("/")));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 20)}`)
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Accept all file types by design. Upload only files you trust and have rights to distribute.
    cb(null, true);
  }
});
app.get("/admin", requireAdmin, (req, res) => {
  const files = listFiles.all();
  const rows = files.map(f => `<tr><td><b>${esc(f.title)}</b><small>${esc(f.original_name || f.external_url)}</small></td><td>${esc(f.category)}</td><td>${esc(fmtSize(f.size))}</td><td>${Number(f.downloads)}</td><td><form method="post" action="/admin/delete/${Number(f.id)}" onsubmit="return confirm('Hapus item ini?')"><button class="btn btn-danger btn-small" type="submit">Hapus</button></form></td></tr>`).join("");
  const body = `<section class="dashboard-head"><div><div class="eyebrow">PANEL KONTROL</div><h1>Dashboard <em>Admin</em></h1><p>Tambah file upload atau tautan eksternal.</p></div><div class="stat"><strong>${files.length}</strong><span>item terdaftar</span></div></section>
  ${req.query.error ? `<p class="notice error">${esc(req.query.error)}</p>` : ""}${req.query.ok ? `<p class="notice success">Item berhasil ditambahkan.</p>` : ""}
  <section class="admin-grid"><div class="panel"><h2>Upload file</h2><p class="muted">Maksimal ${MAX_FILE_MB} MB per file. Jenis file tidak dibatasi.</p>
  <form class="stack" method="post" action="/admin/upload" enctype="multipart/form-data"><label>Judul<input name="title" required maxlength="120" placeholder="Contoh: Warband Bahasa Indonesia"></label><label>Kategori<select name="category"><option>Game & Mod</option><option>APK</option><option>Dokumen</option><option>Video</option><option>Musik</option><option>Arsip ZIP/RAR</option><option>Gambar</option><option>Lainnya</option></select></label><label>Deskripsi<textarea name="description" rows="3" maxlength="1000" placeholder="Keterangan singkat"></textarea></label><label>Pilih file<input type="file" name="file" required></label><button class="btn" type="submit">Upload file</button></form></div>
  <div class="panel"><h2>Tambah link eksternal</h2><p class="muted">Untuk Google Drive, MediaFire, atau tautan unduhan lain.</p>
  <form class="stack" method="post" action="/admin/link"><label>Judul<input name="title" required maxlength="120" placeholder="Nama file"></label><label>Kategori<select name="category"><option>Game & Mod</option><option>APK</option><option>Dokumen</option><option>Video</option><option>Musik</option><option>Arsip ZIP/RAR</option><option>Gambar</option><option>Lainnya</option></select></label><label>Deskripsi<textarea name="description" rows="2" maxlength="1000"></textarea></label><label>URL file<input type="url" name="url" required maxlength="2000" placeholder="https://..."></label><button class="btn btn-secondary" type="submit">Simpan tautan</button></form></div></section>
  <section class="panel inventory"><div class="section-head"><div><div class="eyebrow">INVENTARIS</div><h2>Kelola file</h2></div><span class="count">${files.length} item</span></div><div class="table-wrap"><table><thead><tr><th>Nama</th><th>Kategori</th><th>Ukuran</th><th>Unduhan</th><th>Aksi</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Belum ada file.</td></tr>'}</tbody></table></div></section>`;
  res.send(layout("Dashboard Admin", body, true));
});
app.post("/admin/upload", requireAdmin, (req, res) => {
  upload.single("file")(req, res, err => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE" ? `File terlalu besar. Batas ${MAX_FILE_MB} MB.` : "Upload gagal. Periksa file dan kapasitas penyimpanan.";
      return res.redirect("/admin?error=" + encodeURIComponent(message));
    }
    if (!req.file) return res.redirect("/admin?error=" + encodeURIComponent("Pilih file terlebih dahulu."));
    const title = String(req.body.title || "").trim().slice(0,120);
    const description = String(req.body.description || "").trim().slice(0,1000);
    const category = String(req.body.category || "Lainnya").slice(0,40);
    if (!title) {
      fs.unlink(req.file.path, () => {});
      return res.redirect("/admin?error=" + encodeURIComponent("Judul wajib diisi."));
    }
    insertFile.run({
      title, description, category,
      original_name: path.basename(req.file.originalname).slice(0,255),
      stored_name: req.file.filename, external_url: "",
      size: req.file.size, mime_type: req.file.mimetype || "application/octet-stream"
    });
    res.redirect("/admin?ok=1");
  });
});
app.post("/admin/link", requireAdmin, (req, res) => {
  const title = String(req.body.title || "").trim().slice(0,120);
  const description = String(req.body.description || "").trim().slice(0,1000);
  const category = String(req.body.category || "Lainnya").slice(0,40);
  const url = validExternalUrl(String(req.body.url || "").trim());
  if (!title || !url) return res.redirect("/admin?error=" + encodeURIComponent("Judul atau URL tidak valid."));
  insertFile.run({ title, description, category, original_name: "", stored_name: "", external_url: url, size: 0, mime_type: "text/uri-list" });
  res.redirect("/admin?ok=1");
});
app.post("/admin/delete/:id", requireAdmin, (req, res) => {
  const f = getFile.get(Number(req.params.id));
  if (!f) return res.redirect("/admin");
  deleteFile.run(f.id);
  if (f.stored_name) {
    const full = path.resolve(UPLOAD_DIR, f.stored_name);
    if (full.startsWith(UPLOAD_DIR + path.sep)) fs.unlink(full, () => {});
  }
  res.redirect("/admin");
});
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send(layout("Kesalahan", `<div class="empty"><h2>Terjadi kesalahan</h2><p>Permintaan tidak bisa diproses.</p><a class="btn" href="/">Kembali</a></div>`));
});
app.listen(PORT, () => console.log(`Rell Linkes running on port ${PORT}`));
