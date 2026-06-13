# Skill: Add Asset Page

Pattern for adding a new asset page (like Gold, Cash, Insurance, Private).

---

## 1. HTML scaffold

Add a page div in `index.html` alongside the other asset pages:

```html
<!-- page: <name> -->
<div id="page-<name>" class="page" style="display:none">
  <div class="page-header">
    <h2 class="page-title"><name></h2>
    <button onclick="openAdd<Name>()" style="width:34px;height:34px;border-radius:50%;border:none;background:var(--accent);color:#fff;font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">+</button>
  </div>
  <div id="<name>-metrics-wrap" style="display:none">
    <!-- metric cards here (see Gold page for reference) -->
  </div>
  <div id="<name>-content"></div>
</div>
```

Omit the `+` button and modal if the page is read-only (like Insurance).

---

## 2. Add/Edit modal

Place the modal + overlay after the page div. Follow the Gold modal pattern:

```html
<div id="<name>-modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200" onclick="close<Name>Modal()"></div>
<div id="<name>-modal" class="modal" style="display:none">
  <div class="modal-header">
    <span id="<name>-modal-title">Add <Name></span>
    <button class="modal-close" onclick="close<Name>Modal()">×</button>
  </div>
  <!-- inputs -->
  <div id="<name>-modal-error" style="color:var(--danger);font-size:12px;margin-bottom:8px"></div>
  <button class="btn btn-primary" id="<name>-modal-save-btn" onclick="save<Name>()">Add <Name></button>
</div>
```

---

## 3. Route it

In `loadPage(page)` (around line 1259), add:

```js
else if (page === '<name>')  await load<Name>();
```

In `navigate(page)` nav-highlight block, add to `_NAV_ASSET_PAGES` if it goes under the More tab:

```js
const _NAV_ASSET_PAGES = new Set(['gold','mf','insurance','private','<name>']);
```

Add a row in the More sheet (`page-more`):

```html
<div class="more-row" onclick="navigate('<name>')">
  <span>🏷️</span><span><Name></span><span class="more-arrow">›</span>
</div>
```

---

## 4. JS loader function

```js
async function load<Name>() {
  const { data: items } = await sb.from('<table>')
    .select('*').eq('user_id', state.userId)
    .order('created_at', { ascending: false });

  const el = document.getElementById('<name>-content');
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🏷️</div><div class="empty-text">No items<br><span style="font-size:13px;color:var(--text-muted)">Tap + to add one</span></div></div>';
    return;
  }

  // Optionally fetch a price: const price = await getLatestPrice('SYMBOL');

  el.innerHTML = items.map(item => `
    <div class="card">
      <!-- use .mono for numbers, fmtUSD/fmtTHB for formatted values -->
      <div class="holding-top">
        <div class="holding-ticker">${item.name}</div>
        <span class="holding-price">${fmtUSD(item.value)}</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="pt-act-btn" onclick="openEdit<Name>('${item.id}')">✏️</button>
        <button class="pt-act-btn" onclick="delete<Name>('${item.id}')">🗑</button>
      </div>
    </div>
  `).join('');
}
```

---

## 5. CRUD functions

```js
let _<name>EditId = null;

function openAdd<Name>() {
  _<name>EditId = null;
  document.getElementById('<name>-modal-title').textContent = 'Add <Name>';
  document.getElementById('<name>-modal-save-btn').textContent = 'Add <Name>';
  // reset form fields
  document.getElementById('<name>-modal-error').textContent = '';
  document.getElementById('<name>-modal-overlay').style.display = 'block';
  document.getElementById('<name>-modal').style.display = 'block';
}

async function openEdit<Name>(id) {
  _<name>EditId = id;
  const { data: item } = await sb.from('<table>').select('*').eq('id', id).single();
  if (!item) return;
  document.getElementById('<name>-modal-title').textContent = 'Edit <Name>';
  document.getElementById('<name>-modal-save-btn').textContent = 'Save Changes';
  // populate form fields from item
  document.getElementById('<name>-modal-error').textContent = '';
  document.getElementById('<name>-modal-overlay').style.display = 'block';
  document.getElementById('<name>-modal').style.display = 'block';
}

function close<Name>Modal() {
  document.getElementById('<name>-modal-overlay').style.display = 'none';
  document.getElementById('<name>-modal').style.display = 'none';
}

async function save<Name>() {
  const errEl = document.getElementById('<name>-modal-error');
  // read + validate form fields
  const payload = { user_id: state.userId, /* fields */ };
  const { error } = _<name>EditId
    ? await sb.from('<table>').update(payload).eq('id', _<name>EditId)
    : await sb.from('<table>').insert(payload);
  if (error) { errEl.textContent = error.message; return; }
  close<Name>Modal();
  await load<Name>();
}

async function delete<Name>(id) {
  if (!confirm('Delete this item?')) return;
  await sb.from('<table>').delete().eq('id', id);
  await load<Name>();
}
```

---

## 6. Supabase table + RLS

Before writing the JS, run a migration (see `skills/supabase-migration.md`).

The table needs:
- `id uuid DEFAULT gen_random_uuid() PRIMARY KEY`
- `user_id uuid NOT NULL`
- `created_at timestamptz DEFAULT now()`
- Your data columns

Minimum RLS for a user-writable asset page:
```sql
CREATE POLICY "anon_read_all" ON <table> FOR SELECT USING (true);
CREATE POLICY "anon_insert_<table>" ON <table> FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update_<table>" ON <table> FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_<table>" ON <table> FOR DELETE USING (true);
```

---

## 7. Home dashboard integration

To show the new asset type in `calcUserData()` and the home donut/grid, add a fetch inside `calcUserData(userId)` and return the total as a named key (e.g., `bondsUSD`). Then add a slice to `_renderAssetSummary()`.

---

## 8. SW cache bump

Every time `index.html` changes, bump the cache version in `sw.js`:
```js
const CACHE_NAME = 'smart-me-v27'; // was v26
```
