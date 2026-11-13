// =====================================================
// State
// =====================================================
const state = {
  user: null,
  access: localStorage.getItem('access') || null,
  refresh: localStorage.getItem('refresh') || null,
  view: 'home',
  itemId: null,
  filters: { type: '', category: '', q: '' },
};

// =====================================================
// Tiny DOM helper
// =====================================================
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el[k] = v;
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

// =====================================================
// API + auto-refresh
// =====================================================
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.access) headers.Authorization = `Bearer ${state.access}`;

  let res = await fetch('/api' + path, { ...opts, headers });

  if (res.status === 401 && state.refresh) {
    const ok = await refreshTokens();
    if (ok) {
      headers.Authorization = `Bearer ${state.access}`;
      res = await fetch('/api' + path, { ...opts, headers });
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function refreshTokens() {
  try {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: state.refresh }),
    });
    if (!r.ok) return false;
    setSession(await r.json());
    return true;
  } catch { return false; }
}

function setSession(d) {
  if (d.user) state.user = d.user;
  if (d.access)  { state.access = d.access;  localStorage.setItem('access', d.access); }
  if (d.refresh) { state.refresh = d.refresh; localStorage.setItem('refresh', d.refresh); }
}
function clearSession() {
  state.user = null; state.access = null; state.refresh = null;
  localStorage.removeItem('access'); localStorage.removeItem('refresh');
}

// =====================================================
// Toast
// =====================================================
function toast(msg, kind = 'info') {
  const el = h('div', { class: `toast toast-${kind}` }, msg);
  document.getElementById('toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// =====================================================
// Categories
// =====================================================
const CATEGORIES = ['Electronics','Documents','Keys','Bags','Clothing','Jewelry','Pets','Other'];

// =====================================================
// Router
// =====================================================
async function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  app.appendChild(renderHeader());

  const main = h('main', { class: 'container' });
  if (state.view === 'home')               await renderHome(main);
  else if (state.view === 'login')         renderAuth(main, 'login');
  else if (state.view === 'register')      renderAuth(main, 'register');
  else if (state.view === 'report')        renderReport(main);
  else if (state.view === 'item')          await renderItem(main, state.itemId);
  else if (state.view === 'notifications') await renderNotifications(main);
  else if (state.view === 'claims')        await renderClaims(main);
  app.appendChild(main);
}

function renderHeader() {
  const nav = h('nav', { class: 'nav' });
  nav.appendChild(h('span', {
    class: 'brand',
    onclick: () => { state.view = 'home'; render(); }
  }, '🔎 FindIt'));

  const links = h('div', { class: 'nav-links' });
  links.appendChild(h('a', { onclick: () => { state.view = 'home'; render(); } }, 'Browse'));

  if (state.user) {
    links.appendChild(h('a', { onclick: () => { state.view = 'report'; render(); } }, 'Report'));
    links.appendChild(h('a', { onclick: () => { state.view = 'claims'; render(); } },
      state.user.role === 'admin' ? 'Manage claims' : 'My claims'));
    links.appendChild(h('a', { onclick: () => { state.view = 'notifications'; render(); } }, '🔔'));
    links.appendChild(h('span', { class: 'user-chip' },
      state.user.name + (state.user.role === 'admin' ? ' · admin' : '')));
    links.appendChild(h('button', {
      class: 'btn btn-ghost',
      onclick: async () => {
        try { await api('/auth/logout', { method: 'POST' }); } catch {}
        clearSession();
        state.view = 'home';
        render();
      }
    }, 'Logout'));
  } else {
    links.appendChild(h('button', { class: 'btn btn-ghost',   onclick: () => { state.view = 'login';    render(); } }, 'Login'));
    links.appendChild(h('button', { class: 'btn btn-primary', onclick: () => { state.view = 'register'; render(); } }, 'Sign up'));
  }
  nav.appendChild(links);
  return nav;
}

// =====================================================
// Home
// =====================================================
async function renderHome(main) {
  main.appendChild(h('section', { class: 'hero' },
    h('h1', {}, 'Lost something? Found something?'),
    h('p', {}, 'A community-powered lost & found board. Post once — our background worker automatically matches lost and found reports.')
  ));

  const controls = h('div', { class: 'controls card' });

  const tabs = h('div', { class: 'tabs' });
  ['', 'LOST', 'FOUND'].forEach(t => {
    tabs.appendChild(h('button', {
      class: `tab ${state.filters.type === t ? 'active' : ''}`,
      onclick: () => { state.filters.type = t; render(); }
    }, t === '' ? 'All' : t === 'LOST' ? 'Lost' : 'Found'));
  });
  controls.appendChild(tabs);

  const cat = h('select', {
    class: 'input',
    onchange: e => { state.filters.category = e.target.value; render(); }
  });
  cat.appendChild(h('option', { value: '' }, 'All categories'));
  CATEGORIES.forEach(c => {
    const o = h('option', { value: c }, c);
    if (state.filters.category === c) o.selected = true;
    cat.appendChild(o);
  });
  controls.appendChild(cat);

  const search = h('input', {
    class: 'input', type: 'search',
    placeholder: 'Search title or description…',
    value: state.filters.q,
    oninput: e => {
      state.filters.q = e.target.value;
      clearTimeout(search._t);
      search._t = setTimeout(render, 300);
    }
  });
  controls.appendChild(search);
  main.appendChild(controls);

  try {
    const params = new URLSearchParams();
    if (state.filters.type)     params.set('type', state.filters.type);
    if (state.filters.category) params.set('category', state.filters.category);
    if (state.filters.q)        params.set('q', state.filters.q);

    const items = await api('/items?' + params.toString());
    if (items.length === 0) {
      main.appendChild(h('div', { class: 'empty card' }, 'No items yet. Be the first to report one!'));
    } else {
      const grid = h('div', { class: 'grid' });
      items.forEach(it => grid.appendChild(itemCard(it)));
      main.appendChild(grid);
    }
  } catch (e) {
    main.appendChild(h('div', { class: 'error card' }, 'Failed to load items: ' + e.message));
  }
}

function itemCard(it) {
  const card = h('article', {
    class: 'item-card card',
    onclick: () => { state.view = 'item'; state.itemId = it.id; render(); }
  });
  if (it.image_data) card.appendChild(h('img', { class: 'item-img', src: it.image_data, alt: it.title }));

  const body = h('div', { class: 'item-body' });
  body.appendChild(h('div', { class: 'tags' },
    h('span', { class: `tag ${it.type === 'LOST' ? 'tag-lost' : 'tag-found'}` }, it.type),
    h('span', { class: 'tag tag-status' }, it.status.replace('_', ' '))
  ));
  body.appendChild(h('h3', {}, it.title));
  body.appendChild(h('p', { class: 'muted' }, it.category + (it.location ? ' · ' + it.location : '')));
  if (it.description) {
    body.appendChild(h('p', { class: 'desc' },
      it.description.slice(0, 140) + (it.description.length > 140 ? '…' : '')));
  }
  body.appendChild(h('p', { class: 'muted small' },
    'Reported by ' + it.reporter_name + ' · ' + new Date(it.created_at).toLocaleString()));
  card.appendChild(body);
  return card;
}

// =====================================================
// Auth
// =====================================================
function renderAuth(main, mode) {
  const card = h('div', { class: 'card auth-card' });
  card.appendChild(h('h2', {}, mode === 'login' ? 'Welcome back' : 'Create your account'));

  const form = h('form', { class: 'form' });
  if (mode === 'register') {
    form.appendChild(h('label', {}, 'Name',
      h('input', { class: 'input', name: 'name', required: true })));
  }
  form.appendChild(h('label', {}, 'Email',
    h('input', { class: 'input', name: 'email', type: 'email', required: true })));
  form.appendChild(h('label', {}, 'Password',
    h('input', { class: 'input', name: 'password', type: 'password', required: true, minlength: 8 })));

  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' },
    mode === 'login' ? 'Log in' : 'Sign up');
  form.appendChild(submit);

  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Please wait…';
    try {
      const body = Object.fromEntries(new FormData(form));
      const d = await api('/auth/' + mode, { method: 'POST', body: JSON.stringify(body) });
      setSession(d);
      toast('Welcome, ' + d.user.name + '!', 'success');
      state.view = 'home';
      await render();
    } catch (e) {
      toast(e.message, 'error');
      submit.disabled = false;
      submit.textContent = mode === 'login' ? 'Log in' : 'Sign up';
    }
  };
  card.appendChild(form);
  card.appendChild(h('p', { class: 'muted small center' },
    mode === 'login' ? 'New here? ' : 'Already have an account? ',
    h('a', {
      class: 'link',
      onclick: () => { state.view = mode === 'login' ? 'register' : 'login'; render(); }
    }, mode === 'login' ? 'Create an account' : 'Log in')
  ));
  main.appendChild(card);
}

// =====================================================
// Report an item
// =====================================================
function renderReport(main) {
  if (!state.user) { state.view = 'login'; return render(); }

  const card = h('div', { class: 'card' });
  card.appendChild(h('h2', {}, 'Report an item'));

  const form = h('form', { class: 'form' });

  const typeRow = h('div', { class: 'radio-row' });
  ['LOST', 'FOUND'].forEach(t => {
    const wrap = h('label', { class: 'radio-pill' });
    wrap.appendChild(h('input', { type: 'radio', name: 'type', value: t, required: true }));
    wrap.appendChild(h('span', {}, t === 'LOST' ? '😟 I lost something' : '🎉 I found something'));
    typeRow.appendChild(wrap);
  });
  form.appendChild(typeRow);

  form.appendChild(h('label', {}, 'Title',
    h('input', { class: 'input', name: 'title', required: true, maxlength: 120,
      placeholder: 'e.g. Black iPhone 13 with cracked screen' })));

  form.appendChild(h('label', {}, 'Description',
    h('textarea', { class: 'input', name: 'description', rows: 4, maxlength: 2000,
      placeholder: 'Color, distinguishing marks, contents, etc.' })));

  const cat = h('select', { class: 'input', name: 'category', required: true });
  cat.appendChild(h('option', { value: '' }, 'Select category…'));
  CATEGORIES.forEach(c => cat.appendChild(h('option', { value: c }, c)));
  form.appendChild(h('label', {}, 'Category', cat));

  form.appendChild(h('label', {}, 'Location',
    h('input', { class: 'input', name: 'location', maxlength: 120,
      placeholder: 'e.g. Main Library, 2nd floor' })));

  form.appendChild(h('label', {}, 'Photo (optional, max 5 MB)',
    h('input', { class: 'input', type: 'file', name: 'photo', accept: 'image/*' })));

  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Submit report');
  form.appendChild(submit);

  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Uploading…';
    try {
      const fd = new FormData(form);
      let image_data;
      const file = fd.get('photo');
      if (file && file.size > 0) {
        if (file.size > 5 * 1024 * 1024) throw new Error('Image must be ≤ 5 MB');
        image_data = await fileToDataURL(file);
      }

      const body = {
        type: fd.get('type'),
        title: fd.get('title'),
        description: fd.get('description') || '',
        category: fd.get('category'),
        location: fd.get('location') || '',
        image_data,
      };
      const item = await api('/items', { method: 'POST', body: JSON.stringify(body) });
      toast('Report submitted! Our worker is looking for matches…', 'success');
      state.view = 'item';
      state.itemId = item.id;
      await render();
    } catch (e) {
      toast(e.message, 'error');
      submit.disabled = false;
      submit.textContent = 'Submit report';
    }
  };
  card.appendChild(form);
  main.appendChild(card);
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// =====================================================
// Item detail
// =====================================================
async function renderItem(main, id) {
  try {
    const item    = await api('/items/' + id);
    const matches = await api(`/items/${id}/matches`);

    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'tags' },
      h('span', { class: `tag ${item.type === 'LOST' ? 'tag-lost' : 'tag-found'}` }, item.type),
      h('span', { class: 'tag tag-status' }, item.status.replace('_', ' '))
    ));
    card.appendChild(h('h2', {}, item.title));
    if (item.image_data) card.appendChild(h('img', { class: 'item-img-large', src: item.image_data }));
    card.appendChild(h('p', {}, item.description || 'No description provided.'));
    card.appendChild(h('p', { class: 'muted' }, '📁 ' + item.category + ' · 📍 ' + (item.location || '—')));
    card.appendChild(h('p', { class: 'muted small' },
      'Reported by ' + item.reporter_name + ' · ' + new Date(item.created_at).toLocaleString()));

    if (state.user && item.type === 'FOUND' &&
        ['OPEN', 'MATCHED'].includes(item.status) &&
        item.user_id !== state.user.id) {
      const claimBtn = h('button', { class: 'btn btn-primary mt' }, 'Claim this item');
      claimBtn.onclick = async () => {
        try {
          await api(`/items/${item.id}/claims`, {
            method: 'POST',
            body: JSON.stringify({ message: 'This is mine.' }),
          });
          toast('Claim submitted — an admin will review it shortly.', 'success');
          await render();
        } catch (e) { toast(e.message, 'error'); }
      };
      card.appendChild(claimBtn);
    }

    if (matches.length) {
      card.appendChild(h('h3', { class: 'mt' }, `🔗 Possible matches (${matches.length})`));
      matches.forEach(m => {
        const otherId    = m.lost_id === item.id ? m.found_id : m.lost_id;
        const otherTitle = m.lost_id === item.id ? m.found_title : m.lost_title;
        card.appendChild(h('div', {
          class: 'match-row',
          onclick: () => { state.itemId = otherId; render(); }
        },
          h('span', {}, '↔ ' + otherTitle),
          h('span', { class: 'score' }, 'score ' + Number(m.score).toFixed(2))
        ));
      });
    } else if (item.status === 'OPEN') {
      card.appendChild(h('p', { class: 'muted mt' },
        'No matches yet — the background worker keeps scanning for you.'));
    }
    main.appendChild(card);
  } catch (e) {
    main.appendChild(h('div', { class: 'error card' }, e.message));
  }
}

// =====================================================
// Notifications
// =====================================================
async function renderNotifications(main) {
  if (!state.user) { state.view = 'login'; return render(); }
  try {
    const list = await api('/notifications');
    const card = h('div', { class: 'card' });
    card.appendChild(h('h2', {}, '🔔 Notifications'));
    if (!list.length) card.appendChild(h('p', { class: 'muted' }, 'Nothing here yet.'));
    list.forEach(n => {
      card.appendChild(h('div', { class: `notif ${n.read ? '' : 'unread'}` },
        h('p', {}, n.message),
        h('span', { class: 'muted small' }, new Date(n.created_at).toLocaleString())
      ));
    });
    if (list.length) {
      const btn = h('button', { class: 'btn btn-ghost mt' }, 'Mark all as read');
      btn.onclick = async () => {
        await api('/notifications/read-all', { method: 'POST' });
        render();
      };
      card.appendChild(btn);
    }
    main.appendChild(card);
  } catch (e) {
    main.appendChild(h('div', { class: 'error card' }, e.message));
  }
}

// =====================================================
// Claims (admin + user)
// =====================================================
async function renderClaims(main) {
  if (!state.user) { state.view = 'login'; return render(); }
  try {
    const list = await api('/claims');
    const card = h('div', { class: 'card' });
    card.appendChild(h('h2', {},
      state.user.role === 'admin' ? 'Manage claims' : 'My claims'));

    if (!list.length) card.appendChild(h('p', { class: 'muted' }, 'No claims yet.'));

    list.forEach(c => {
      const row = h('div', { class: 'claim-row' });

      const info = h('div', {});
      info.appendChild(h('strong', {}, c.item_title));
      if (c.claimant_has_match) {
        info.appendChild(h('span', { class: 'verified' }, '✓ verified match'));
      }
      info.appendChild(h('p', { class: 'muted small' },
        'by ' + c.claimant_name + ' · ' + new Date(c.created_at).toLocaleString()));
      info.appendChild(h('p', {}, c.message || ''));
      row.appendChild(info);

      const actions = h('div', { class: 'claim-actions' });
      if (c.status === 'PENDING' && state.user.role === 'admin') {
        const approve = h('button', { class: 'btn btn-success' }, 'Approve');
        approve.onclick = async () => {
          try {
            await api('/claims/' + c.id, { method: 'PATCH', body: JSON.stringify({ status: 'APPROVED' }) });
            toast('Claim approved', 'success');
            render();
          } catch (e) { toast(e.message, 'error'); }
        };
        const reject = h('button', { class: 'btn btn-danger' }, 'Reject');
        reject.onclick = async () => {
          try {
            await api('/claims/' + c.id, { method: 'PATCH', body: JSON.stringify({ status: 'REJECTED' }) });
            toast('Claim rejected', 'success');
            render();
          } catch (e) { toast(e.message, 'error'); }
        };
        actions.appendChild(approve);
        actions.appendChild(reject);
      } else {
        const cls = c.status === 'APPROVED' ? 'tag-found' : c.status === 'REJECTED' ? 'tag-lost' : 'tag-status';
        actions.appendChild(h('span', { class: `tag ${cls}` }, c.status));
      }
      row.appendChild(actions);
      card.appendChild(row);
    });
    main.appendChild(card);
  } catch (e) {
    main.appendChild(h('div', { class: 'error card' }, e.message));
  }
}

// =====================================================
// Boot
// =====================================================
(async function boot() {
  if (state.refresh) {
    const ok = await refreshTokens();
    if (!ok) clearSession();
  }
  await render();
})();
