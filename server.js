const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const sessions = new Map();

for (const dir of [DATA_DIR, UPLOAD_DIR, PUBLIC_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
};

const seedData = () => ({
  users: [
    { id: 'u-admin', username: 'admin', role: 'admin', passwordHash: hashPassword('admin123') },
    { id: 'u-user', username: 'user', role: 'user', passwordHash: hashPassword('user123') }
  ],
  apps: [
    {
      id: crypto.randomUUID(),
      title: 'Starter CRM',
      description: 'Prebuilt CRM app starter template.',
      version: '1.0.0',
      category: 'Business',
      tags: ['crm', 'starter'],
      uploadDate: new Date().toISOString(),
      fileType: 'url',
      downloadUrl: 'https://example.com/starter-crm',
      isPublished: true,
      featured: true,
      views: 0
    }
  ]
});

const readDb = () => {
  if (!fs.existsSync(DB_PATH)) {
    const data = seedData();
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    return data;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
};

const writeDb = (data) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));

const parseCookies = (req) => {
  const cookieHeader = req.headers.cookie || '';
  return Object.fromEntries(cookieHeader.split(';').filter(Boolean).map(c => {
    const [k, ...v] = c.trim().split('=');
    return [k, decodeURIComponent(v.join('='))];
  }));
};

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const serveStatic = (req, res, urlPath) => {
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
};

const parseBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 10_000_000) reject(new Error('Payload too large'));
  });
  req.on('end', () => {
    if (!raw) return resolve({});
    try {
      resolve(JSON.parse(raw));
    } catch {
      reject(new Error('Invalid JSON body'));
    }
  });
  req.on('error', reject);
});

const getSessionUser = (req) => {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session || Date.now() > session.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  return session.user;
};

const requireAuth = (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    json(res, 401, { message: 'Unauthorized' });
    return null;
  }
  return user;
};

const requireAdmin = (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    json(res, 403, { message: 'Forbidden' });
    return null;
  }
  return user;
};

const toClientApp = (app) => ({
  id: app.id,
  title: app.title,
  description: app.description,
  version: app.version,
  category: app.category,
  tags: app.tags,
  uploadDate: app.uploadDate,
  isPublished: app.isPublished,
  featured: !!app.featured,
  views: app.views || 0,
  downloadUrl: app.fileType === 'file' ? `/api/apps/${app.id}/download` : app.downloadUrl
});

const sendDownload = (res, app) => {
  if (app.fileType !== 'file' || !app.filePath || !fs.existsSync(app.filePath)) return json(res, 404, { message: 'File not found' });
  const ext = path.extname(app.fileName || 'download.bin') || '.bin';
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${path.basename(app.fileName || `app${ext}`)}"`
  });
  fs.createReadStream(app.filePath).pipe(res);
};

const saveUploadedFile = (fileObj) => {
  const match = /^data:(.+);base64,(.+)$/.exec(fileObj?.base64 || '');
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  const safeName = `${Date.now()}-${(fileObj.name || 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '')}`;
  const filePath = path.join(UPLOAD_DIR, safeName);
  fs.writeFileSync(filePath, buffer);
  return { filePath, fileName: fileObj.name || safeName, mime: match[1] };
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    return json(res, 403, { message: 'Direct file access blocked' });
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const db = readDb();
      const user = db.users.find(u => u.username === body.username);
      if (!user || !verifyPassword(body.password || '', user.passwordHash)) return json(res, 401, { message: 'Invalid credentials' });
      const sid = crypto.randomUUID();
      const userData = { id: user.id, username: user.username, role: user.role };
      sessions.set(sid, { user: userData, expiresAt: Date.now() + SESSION_TTL_MS });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/` });
      return res.end(JSON.stringify({ user: userData }));
    } catch (err) {
      return json(res, 400, { message: err.message });
    }
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const sid = parseCookies(req).sid;
    if (sid) sessions.delete(sid);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=; Max-Age=0; Path=/' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = getSessionUser(req);
    return json(res, user ? 200 : 401, { user: user || null });
  }

  if (url.pathname === '/api/categories' && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = readDb();
    const visible = user.role === 'admin' ? db.apps : db.apps.filter(a => a.isPublished);
    const categories = [...new Set(visible.map(a => a.category).filter(Boolean))];
    return json(res, 200, { categories });
  }

  if (url.pathname === '/api/apps' && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = readDb();
    let apps = user.role === 'admin' ? db.apps : db.apps.filter(a => a.isPublished);
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const category = url.searchParams.get('category') || '';
    const sort = url.searchParams.get('sort') || 'newest';
    if (search) apps = apps.filter(a => [a.title, a.description, ...(a.tags || [])].join(' ').toLowerCase().includes(search));
    if (category) apps = apps.filter(a => a.category === category);
    apps = apps.sort((a, b) => {
      if (sort === 'oldest') return new Date(a.uploadDate) - new Date(b.uploadDate);
      if (sort === 'title') return a.title.localeCompare(b.title);
      return new Date(b.uploadDate) - new Date(a.uploadDate);
    });
    return json(res, 200, { apps: apps.map(toClientApp) });
  }

  if (url.pathname === '/api/apps' && req.method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    try {
      const body = await parseBody(req);
      const db = readDb();
      const app = {
        id: crypto.randomUUID(),
        title: body.title,
        description: body.description,
        version: body.version,
        category: body.category,
        tags: (body.tags || '').split(',').map(t => t.trim()).filter(Boolean),
        uploadDate: new Date().toISOString(),
        isPublished: !!body.isPublished,
        featured: !!body.featured,
        fileType: body.file?.base64 ? 'file' : 'url',
        downloadUrl: body.downloadUrl || '',
        views: 0
      };
      if (app.fileType === 'file') Object.assign(app, saveUploadedFile(body.file));
      db.apps.push(app);
      writeDb(db);
      return json(res, 201, { app: toClientApp(app) });
    } catch (err) {
      return json(res, 400, { message: err.message });
    }
  }

  const appIdMatch = url.pathname.match(/^\/api\/apps\/([^/]+)$/);
  if (appIdMatch && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = readDb();
    const app = db.apps.find(a => a.id === appIdMatch[1]);
    if (!app || (!app.isPublished && user.role !== 'admin')) return json(res, 404, { message: 'Not found' });
    app.views = (app.views || 0) + 1;
    writeDb(db);
    const related = db.apps.filter(a => a.id !== app.id && a.category === app.category && (user.role === 'admin' || a.isPublished)).slice(0, 3).map(toClientApp);
    return json(res, 200, { app: toClientApp(app), related });
  }

  if (appIdMatch && req.method === 'PUT') {
    const user = requireAdmin(req, res);
    if (!user) return;
    try {
      const body = await parseBody(req);
      const db = readDb();
      const app = db.apps.find(a => a.id === appIdMatch[1]);
      if (!app) return json(res, 404, { message: 'Not found' });
      Object.assign(app, {
        title: body.title,
        description: body.description,
        version: body.version,
        category: body.category,
        tags: (body.tags || '').split(',').map(t => t.trim()).filter(Boolean),
        isPublished: !!body.isPublished,
        featured: !!body.featured,
        downloadUrl: body.downloadUrl || app.downloadUrl
      });
      if (body.file?.base64) {
        const fileInfo = saveUploadedFile(body.file);
        Object.assign(app, { fileType: 'file', ...fileInfo });
      } else if (body.downloadUrl) {
        app.fileType = 'url';
      }
      writeDb(db);
      return json(res, 200, { app: toClientApp(app) });
    } catch (err) {
      return json(res, 400, { message: err.message });
    }
  }

  if (appIdMatch && req.method === 'DELETE') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const db = readDb();
    const index = db.apps.findIndex(a => a.id === appIdMatch[1]);
    if (index === -1) return json(res, 404, { message: 'Not found' });
    db.apps.splice(index, 1);
    writeDb(db);
    return json(res, 200, { ok: true });
  }

  const downloadMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/download$/);
  if (downloadMatch && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = readDb();
    const app = db.apps.find(a => a.id === downloadMatch[1]);
    if (!app || (!app.isPublished && user.role !== 'admin')) return json(res, 404, { message: 'Not found' });
    if (app.fileType === 'url') {
      res.writeHead(302, { Location: app.downloadUrl });
      return res.end();
    }
    return sendDownload(res, app);
  }

  if (req.method === 'GET' && serveStatic(req, res, url.pathname)) return;
  json(res, 404, { message: 'Route not found' });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Mendixdemo running on http://localhost:${PORT}`);
    console.log('Demo accounts: admin/admin123 and user/user123');
  });
}

module.exports = { hashPassword, verifyPassword, server };
