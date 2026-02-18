const state = {
  user: null,
  apps: [],
  categories: [],
  view: 'home',
  selectedApp: null,
  favorites: JSON.parse(localStorage.getItem('favorites') || '[]'),
  recentlyViewed: JSON.parse(localStorage.getItem('recentlyViewed') || '[]')
};

const appRoot = document.getElementById('app');

const api = async (url, options = {}) => {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
};

const formatDate = iso => new Date(iso).toLocaleDateString();

const nav = () => `
  <nav class="navbar">
    <div class="brand">Mendixdemo</div>
    <div class="nav-links">
      <button data-route="home">Home</button>
      <button data-route="library">Content Library</button>
      <button data-route="categories">Categories</button>
      <button data-route="profile">Profile</button>
      ${state.user?.role === 'admin' ? '<button data-route="admin">Admin Panel</button>' : ''}
      <button id="logoutBtn">Logout</button>
    </div>
  </nav>
`;

const renderLogin = (error = '') => {
  appRoot.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card">
        <h2>Welcome to Mendixdemo</h2>
        <p class="muted">Login as <b>admin/admin123</b> or <b>user/user123</b>.</p>
        ${error ? `<p style="color:#c92a2a">${error}</p>` : ''}
        <form id="loginForm" class="form-grid">
          <label>Username<input name="username" required /></label>
          <label>Password<input name="password" type="password" required /></label>
          <button type="submit">Log in securely</button>
        </form>
      </div>
    </div>`;

  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
      state.user = data.user;
      await loadData();
      renderApp();
    } catch (err) {
      renderLogin(err.message);
    }
  };
};

const appCard = (a) => `
  <article class="card">
    <div class="row"><span class="tag">${a.category || 'General'}</span><span class="muted">${formatDate(a.uploadDate)}</span></div>
    <h3>${a.title}</h3>
    <p>${a.description}</p>
    <p class="muted">Version ${a.version || 'n/a'} ${a.isPublished ? '• Published' : '• Draft'}</p>
    <div class="row">
      <button data-open="${a.id}">Details</button>
      <button class="secondary" data-favorite="${a.id}">${state.favorites.includes(a.id) ? 'Unfavorite' : 'Favorite'}</button>
    </div>
  </article>
`;

const bindCommonEvents = () => {
  document.querySelectorAll('[data-route]').forEach(b => b.onclick = () => { state.view = b.dataset.route; renderApp(); });
  const lo = document.getElementById('logoutBtn');
  if (lo) lo.onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); state.user = null; renderLogin(); };
  document.querySelectorAll('[data-open]').forEach(btn => btn.onclick = async () => {
    const { app, related } = await api(`/api/apps/${btn.dataset.open}`);
    state.selectedApp = { ...app, related };
    state.recentlyViewed = [app.id, ...state.recentlyViewed.filter(x => x !== app.id)].slice(0, 8);
    localStorage.setItem('recentlyViewed', JSON.stringify(state.recentlyViewed));
    state.view = 'detail';
    renderApp();
  });
  document.querySelectorAll('[data-favorite]').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.favorite;
    state.favorites = state.favorites.includes(id) ? state.favorites.filter(x => x !== id) : [id, ...state.favorites];
    localStorage.setItem('favorites', JSON.stringify(state.favorites));
    renderApp();
  });
};

const renderHome = () => {
  const featured = state.apps.filter(a => a.featured).slice(0, 3);
  const recent = [...state.apps].sort((a,b)=>new Date(b.uploadDate)-new Date(a.uploadDate)).slice(0, 4);
  return `
  <section class="container">
    <div class="card">
      <h2>Dashboard</h2>
      <div class="kpis">
        <div class="kpi"><div class="muted">Total visible apps</div><b>${state.apps.length}</b></div>
        <div class="kpi"><div class="muted">Categories</div><b>${state.categories.length}</b></div>
        <div class="kpi"><div class="muted">Favorites</div><b>${state.favorites.length}</b></div>
      </div>
      <input id="quickSearch" placeholder="Quick search apps..." />
    </div>
    <h3>Featured apps</h3>
    <div class="grid">${featured.map(appCard).join('') || '<p class="muted">No featured apps yet.</p>'}</div>
    <h3>Recently added</h3>
    <div class="grid">${recent.map(appCard).join('')}</div>
  </section>`;
};

const renderLibrary = () => `
  <section class="container">
    <div class="card form-grid">
      <label>Search <input id="search" placeholder="Keyword" /></label>
      <label>Category <select id="category"><option value="">All</option>${state.categories.map(c=>`<option>${c}</option>`).join('')}</select></label>
      <label>Sort <select id="sort"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="title">Title</option></select></label>
      <button id="applyFilters">Apply</button>
    </div>
    <div id="libraryResults" class="grid" style="margin-top:1rem">${state.apps.map(appCard).join('')}</div>
  </section>`;

const renderCategories = () => `
  <section class="container grid">
    ${state.categories.map(cat => `<div class="card"><h3>${cat}</h3><p>${state.apps.filter(a=>a.category===cat).length} app(s)</p></div>`).join('')}
  </section>`;

const renderProfile = () => {
  const recentCards = state.apps.filter(a => state.recentlyViewed.includes(a.id)).slice(0, 4);
  return `<section class="container"><div class="card"><h2>${state.user.username}</h2><p class="muted">Role: ${state.user.role}</p></div>
  <h3>Recently viewed</h3><div class="grid">${recentCards.map(appCard).join('') || '<p class="muted">None yet.</p>'}</div></section>`;
};

const renderDetail = () => {
  const a = state.selectedApp;
  if (!a) return '<section class="container"><p>No app selected.</p></section>';
  return `<section class="container">
    <div class="card">
      <div class="row"><span class="tag">${a.category}</span><span class="muted">${formatDate(a.uploadDate)}</span></div>
      <h2>${a.title}</h2>
      <p>${a.description}</p>
      <p class="muted">Version ${a.version} • ${a.views} views</p>
      <a href="${a.downloadUrl}" target="_blank"><button>Download</button></a>
    </div>
    <h3>Related content</h3>
    <div class="grid">${(a.related || []).map(appCard).join('') || '<p class="muted">No related content.</p>'}</div>
  </section>`;
};

const renderAdmin = () => `
<section class="container">
  <div class="card">
    <h2>Admin Panel</h2>
    <form id="adminForm" class="form-grid">
      <label>Title<input name="title" required /></label>
      <label>Version<input name="version" required /></label>
      <label>Category<input name="category" required /></label>
      <label>Download URL<input name="downloadUrl" placeholder="Optional when file uploaded" /></label>
      <label>Tags<input name="tags" placeholder="comma,separated" /></label>
      <label>App File<input name="file" type="file" /></label>
      <label>Published<select name="isPublished"><option value="true">Published</option><option value="false">Draft</option></select></label>
      <label>Featured<select name="featured"><option value="false">No</option><option value="true">Yes</option></select></label>
      <label style="grid-column:1/-1">Description<textarea name="description" rows="3" required></textarea></label>
      <button type="submit">Upload Application</button>
    </form>
  </div>
  <div class="card" style="margin-top:1rem">
    <h3>Content Management</h3>
    <div class="grid">
      ${state.apps.map(a=>`<div class="list-item"><b>${a.title}</b><p>${a.category} • ${a.isPublished ? 'Published':'Draft'}</p><p class="muted">${a.views} views</p>
      <div class="row"><button data-toggle="${a.id}" class="secondary">${a.isPublished ? 'Unpublish':'Publish'}</button><button data-delete="${a.id}" class="danger">Delete</button></div></div>`).join('')}
    </div>
  </div>
</section>`;

const handleLibraryFilters = () => {
  const b = document.getElementById('applyFilters');
  if (!b) return;
  b.onclick = async () => {
    const search = document.getElementById('search').value;
    const category = document.getElementById('category').value;
    const sort = document.getElementById('sort').value;
    const data = await api(`/api/apps?search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&sort=${sort}`);
    state.apps = data.apps;
    renderApp();
  };
};

const handleAdmin = () => {
  const form = document.getElementById('adminForm');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      payload.isPublished = payload.isPublished === 'true';
      payload.featured = payload.featured === 'true';
      const file = fd.get('file');
      if (file && file.size) {
        payload.file = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, base64: reader.result });
          reader.readAsDataURL(file);
        });
      }
      await api('/api/apps', { method: 'POST', body: JSON.stringify(payload) });
      await loadData();
      renderApp();
    };
  }

  document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async () => {
    await api(`/api/apps/${btn.dataset.delete}`, { method: 'DELETE' });
    await loadData(); renderApp();
  });

  document.querySelectorAll('[data-toggle]').forEach(btn => btn.onclick = async () => {
    const app = state.apps.find(a => a.id === btn.dataset.toggle);
    await api(`/api/apps/${app.id}`, { method: 'PUT', body: JSON.stringify({ ...app, tags: (app.tags || []).join(','), isPublished: !app.isPublished }) });
    await loadData(); renderApp();
  });
};

const renderApp = () => {
  if (!state.user) return renderLogin();
  let content = '';
  if (state.view === 'home') content = renderHome();
  if (state.view === 'library') content = renderLibrary();
  if (state.view === 'categories') content = renderCategories();
  if (state.view === 'profile') content = renderProfile();
  if (state.view === 'detail') content = renderDetail();
  if (state.view === 'admin') content = state.user.role === 'admin' ? renderAdmin() : '<section class="container"><p>Forbidden</p></section>';
  appRoot.innerHTML = nav() + content;
  bindCommonEvents();
  handleLibraryFilters();
  handleAdmin();
  const quick = document.getElementById('quickSearch');
  if (quick) quick.oninput = async () => {
    const data = await api(`/api/apps?search=${encodeURIComponent(quick.value)}`);
    state.apps = data.apps;
    state.view = 'library';
    renderApp();
  };
};

const loadData = async () => {
  const [appsRes, catRes] = await Promise.all([api('/api/apps'), api('/api/categories')]);
  state.apps = appsRes.apps;
  state.categories = catRes.categories;
};

(async () => {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    await loadData();
    renderApp();
  } catch {
    renderLogin();
  }
})();
