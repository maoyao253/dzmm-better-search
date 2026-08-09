'use strict';
const API = 'https://www.dzmm.ai/api/trpc';
const SITE = 'https://www.dzmm.ai';
const PAGE_LIMIT = 100;

const state = {
  competition: null,
  groups: [],
  groupId: null,        // null = 全部
  sort: 'popular',
  items: new Map(),     // cardId -> item
  order: [],            // cardId 按抓取顺序排列
  cursor: 0,
  hasMore: false,
  loading: false,
  loadedPages: 0,
  totalPages: 0,
  searchId: 0,
  error: null,
  query: '',
  _texts: new Map(),
};

const $ = id => document.getElementById(id);
const qEl = $('q');

/* ---------- utilities ---------- */
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function num(v, dflt = 0){
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function fmtCount(n){
  n = num(n);
  if (n >= 100000000) return (n/100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n/10000).toFixed(1) + '万';
  return String(n);
}
function fmtDate(s){
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function debounce(fn, ms){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------- API ---------- */
async function trpc(path, input){
  const payload = { 0: { json: input } };
  const url = API + '/' + path + '?batch=1&input=' + encodeURIComponent(JSON.stringify(payload));
  let res;
  try {
    res = await fetch(url, { credentials: 'omit', headers: { accept: 'application/json' } });
  } catch (e){
    throw new Error('网络请求失败，请检查网络或稍后重试');
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* ignore */ }
  const errMsg = body && body[0] && body[0].error && body[0].error.json && body[0].error.json.message;
  if (!res.ok || !body || !body[0] || body[0].error){
    const err = new Error(errMsg || ('接口返回 HTTP ' + res.status));
    err.rateLimit = res.status === 429 || /rate limit|too many requests|429/i.test(errMsg || '');
    throw err;
  }
  return body[0].result.data.json;
}

function groupInput(){
  const input = { sort: state.sort, limit: PAGE_LIMIT };
  if (state.groupId != null) input.groupId = state.groupId;
  if (state.cursor) input.cursor = state.cursor;
  return input;
}

function groupLabel(g){
  if (!g) return '';
  if (g.displayName) return g.displayName;
  return g.groupKey === 'game' ? '游戏组' : ('分组 ' + (g.groupKey || ''));
}

/* ---------- load & paging ---------- */
async function loadActive(){
  try {
    const data = await trpc('competition.active', {});
    state.competition = data || null;
    state.groups = (data && data.groups) || [];
  } catch (err){
    state.error = err.rateLimit
      ? '请求太频繁，被接口限流了。请等 30~60 秒再试。'
      : '加载比赛信息失败：' + err.message;
    $('error').style.display = 'block';
    $('error').textContent = state.error;
    renderStatus();
    return;
  }
  renderInfo();
  renderTabs();
  if (!state.competition){
    renderStatus();
    render();
    return;
  }
  runLoad();
}

async function runLoad(){
  state.searchId++;
  const sid = state.searchId;
  state.items.clear();
  state._texts.clear();
  state.order = [];
  state.cursor = 0;
  state.hasMore = false;
  state.error = null;
  state.loadedPages = 0;
  state.totalPages = Math.max(1, num($('fDepth').value, 2));
  $('error').style.display = 'none';
  renderStatus();
  render();
  $('moreBtn').style.display = 'none';

  for (let i = 0; i < state.totalPages; i++){
    if (sid !== state.searchId) return;
    try {
      await fetchPage(sid);
    } catch (err){
      if (sid !== state.searchId) return;
      state.error = err.rateLimit
        ? '请求太频繁，被接口限流了。请等 30~60 秒再试，或把“自动抓取”调小。'
        : '加载失败：' + err.message;
      $('error').style.display = 'block';
      $('error').textContent = state.error;
      renderStatus();
      render();
      return;
    }
    if (!state.hasMore) break;
    if (i < state.totalPages - 1) await sleep(150);
  }
  if (sid !== state.searchId) return;
  renderStatus();
  render();
}

async function fetchPage(sid){
  const data = await trpc('competition.activeGroupCards', groupInput());
  if (sid !== state.searchId) return;
  const items = data.items || [];
  let added = 0;
  for (const it of items){
    if (!state.items.has(it.id)){
      state.items.set(it.id, it);
      state.order.push(it.id);
      added++;
    }
  }
  state.loadedPages++;
  if (data.nextCursor != null){
    state.cursor = data.nextCursor;
    state.hasMore = true;
  } else {
    state.hasMore = false;
  }
  renderStatus();
  render();
}

async function loadMore(){
  if (!state.hasMore || state.loading) return;
  state.loading = true;
  $('moreBtn').disabled = true;
  const sid = state.searchId;
  try {
    await fetchPage(sid);
  } catch (err){
    if (sid === state.searchId){
      state.error = err.rateLimit
        ? '请求太频繁，被接口限流了。请等 30~60 秒再试。'
        : '加载失败：' + err.message;
      $('error').style.display = 'block';
      $('error').textContent = state.error;
      renderStatus();
      render();
    }
  }
  state.loading = false;
  $('moreBtn').disabled = false;
  renderStatus();
  render();
}

/* ---------- local search ---------- */
function itemText(item){
  if (state._texts.has(item.id)) return state._texts.get(item.id);
  const t = [item.name, item.creatorFullName, item.creator, (item.tags || []).join(' '), item.creatorNotes]
    .filter(Boolean).join(' ').toLowerCase();
  state._texts.set(item.id, t);
  return t;
}
function visibleItems(){
  const q = state.query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const arr = [];
  for (const id of state.order){
    const item = state.items.get(id);
    if (!item) continue;
    if (!terms.length) { arr.push(item); continue; }
    const text = itemText(item);
    if (terms.every(t => text.includes(t))) arr.push(item);
  }
  return arr;
}

/* ---------- rendering ---------- */
function currentGroup(){
  return (state.groups || []).find(g => g.id === state.groupId) || null;
}

function renderInfo(){
  const el = $('compInfo');
  el.innerHTML = '';
  const c = state.competition;
  if (!c){ el.style.display = 'none'; return; }
  el.style.display = '';
  const b = document.createElement('div');
  b.className = 'comp-banner';
  const title = document.createElement('span');
  title.className = 'comp-title';
  title.textContent = c.title || '创作比赛';
  const status = document.createElement('span');
  status.className = 'comp-status ' + (c.status || '');
  status.textContent = c.status === 'active' ? '进行中' : c.status === 'judging' ? '评审中' : '已结束';
  const dates = document.createElement('span');
  dates.className = 'comp-muted';
  dates.textContent = (fmtDate(c.startDate) || '?') + ' ~ ' + (fmtDate(c.endDate) || '?');
  const total = (c.groups || []).reduce((s, g) => s + num(g.entryCount), 0);
  const count = document.createElement('span');
  count.className = 'comp-muted';
  count.textContent = '共 ' + fmtCount(total) + ' 件参赛作品';
  b.append(title, status, dates, count);
  el.appendChild(b);
}

function renderTabs(){
  const wrap = $('groupTabs');
  wrap.innerHTML = '';
  const mk = (id, label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab' + (state.groupId === id ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => {
      if (state.groupId !== id){ state.groupId = id; runLoad(); }
    };
    wrap.appendChild(btn);
  };
  const total = (state.groups || []).reduce((s, g) => s + num(g.entryCount), 0);
  mk(null, '全部' + (total ? `（${fmtCount(total)}）` : ''));
  for (const g of state.groups){
    mk(g.id, groupLabel(g) + (num(g.entryCount) ? `（${fmtCount(g.entryCount)}）` : ''));
  }
}

function renderStatus(){
  const el = $('statusText');
  if (state.error){
    el.innerHTML = state.items.size
      ? `已加载 <b>${state.items.size}</b> 条，但加载中断了。`
      : '加载失败，请稍后重试。';
    return;
  }
  if (!state.competition){
    el.innerHTML = '当前没有进行中的比赛，可以等下一期开始后再来。';
    return;
  }
  const grp = currentGroup();
  const groupName = state.groupId == null ? '全部' : (grp ? groupLabel(grp) : '未知分组');
  const sortName = state.sort === 'newest' ? '最新参赛' : '热门';
  if (state.loadedPages < state.totalPages || state.loading){
    el.innerHTML = `正在抓取比赛卡第 <b>${state.loadedPages}</b> 页 / 共 ${state.totalPages} 页，已获取 <b>${state.items.size}</b> 条…`;
  } else {
    const matched = visibleItems().length;
    el.innerHTML = `已加载 <b>${state.items.size}</b> 条${state.query ? `，匹配 <b>${matched}</b> 条` : ''}（${groupName} · ${sortName}）`;
  }
}

function thumbUrl(url, w){
  if (!url) return '';
  let u = url;
  if (u.startsWith('/')) u = SITE + u;
  const m = u.match(/\/storage\/v1\/object\/public\/(.+)$/);
  if (m) return 'https://rls.cheggpt.com/storage/v1/render/image/public/' + m[1] + '?width=' + w + '&resize=contain&quality=75';
  return u;
}

function render(){
  const arr = visibleItems();
  const grid = $('grid');
  const frag = document.createDocumentFragment();
  const blur = $('fBlur').checked;
  const groupMap = new Map((state.groups || []).map(g => [g.id, g]));

  for (const item of arr){
    const a = document.createElement('a');
    a.className = 'card' + (item.isSensitive && blur ? ' nsfw' : '');
    a.href = SITE + '/character/' + item.id;
    a.target = '_blank';
    a.rel = 'noreferrer';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const imgUrl = thumbUrl(item.cardFilename, 460);
    if (imgUrl){
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = item.name || '';
      img.referrerPolicy = 'no-referrer';
      img.src = imgUrl;
      img.onerror = () => {
        img.style.display = 'none';
        const ph = document.createElement('div');
        ph.className = 'placeholder';
        ph.textContent = (item.name || '?').trim().charAt(0);
        thumb.appendChild(ph);
      };
      thumb.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'placeholder';
      ph.textContent = (item.name || '?').trim().charAt(0);
      thumb.appendChild(ph);
    }
    if (item.isSensitive && !blur){
      const b = document.createElement('span');
      b.className = 'nsfw-badge';
      b.textContent = '敏感';
      thumb.appendChild(b);
    }
    if (item.isGamefy){
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = '游戏卡';
      thumb.appendChild(b);
    }
    a.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'body';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.name || '未命名';
    body.appendChild(name);

    if (item.tags && item.tags.length){
      const tags = document.createElement('div');
      tags.className = 'tags';
      for (const t of item.tags.slice(0, 5)){
        const s = document.createElement('span');
        s.className = 'tag';
        s.textContent = '#' + t;
        tags.appendChild(s);
      }
      body.appendChild(tags);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const m1 = document.createElement('span'); m1.className = 'up'; m1.textContent = '♥ ' + fmtCount(item.likesCount);
    const m2 = document.createElement('span'); m2.className = 'cm'; m2.textContent = '💬 ' + fmtCount(item.commentsCount);
    meta.appendChild(m1); meta.appendChild(m2);
    const rating = num(item.weightedRating);
    if (rating > 0){
      const m3 = document.createElement('span'); m3.className = 'rt'; m3.textContent = '★ ' + rating.toFixed(1);
      meta.appendChild(m3);
    }
    const grp = groupMap.get(item.groupId);
    if (grp){
      const m4 = document.createElement('span');
      m4.textContent = groupLabel(grp);
      meta.appendChild(m4);
    }
    body.appendChild(meta);

    const author = document.createElement('div');
    author.className = 'author';
    author.textContent = 'by ' + (item.creatorFullName || item.creator || '匿名创作者');
    body.appendChild(author);

    if (item.creatorNotes){
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = item.creatorNotes.replace(/\s+/g, ' ').trim();
      body.appendChild(desc);
    }
    a.appendChild(body);
    frag.appendChild(a);
  }

  grid.innerHTML = '';
  grid.appendChild(frag);

  const empty = $('empty');
  if (!state.competition && !state.error && !state.loadedPages){
    empty.style.display = 'none';
  } else if (!arr.length){
    empty.style.display = 'block';
    $('emptyText').textContent = state.items.size
      ? `已加载 ${state.items.size} 条但没有符合当前条件的。试试改关键词，或点“加载更多结果”。`
      : (state.error
        ? '加载失败，请查看上方错误提示。'
        : (state.competition ? '该分组暂无参赛作品。' : '当前没有进行中的比赛。'));
  } else {
    empty.style.display = 'none';
  }

  $('moreBtn').style.display = (state.items.size && state.hasMore && !state.error && !state.loading) ? 'inline-block' : 'none';
  $('moreBtn').disabled = false;
}

/* ---------- export ---------- */
function exportLines(){
  return visibleItems().map(item => {
    const tags = (item.tags || []).slice(0, 8).map(t => '#' + t).join(' ');
    return `${item.name || '未命名'}\t♥${fmtCount(item.likesCount)}\t★${num(item.weightedRating) ? num(item.weightedRating).toFixed(1) : '-'}\t${SITE}/character/${item.id}\t${tags}`;
  });
}
$('copyBtn').onclick = async () => {
  const lines = exportLines();
  if (!lines.length){ alert('当前没有匹配结果可复制。'); return; }
  const text = lines.map(l => l.split('\t').slice(0, 4).join(' | ')).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    $('copyBtn').textContent = '已复制 ✓';
    setTimeout(() => { $('copyBtn').textContent = '复制列表'; }, 1500);
  } catch (e) {
    prompt('复制失败，请手动复制：', text);
  }
};
$('exportBtn').onclick = () => {
  const lines = exportLines();
  if (!lines.length){ alert('当前没有匹配结果可导出。'); return; }
  const csv = '\uFEFF名称,赞数,评论,评分,链接,标签\n' + lines.map(l => {
    const c = l.split('\t');
    return c.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',');
  }).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dzmm-competition-' + Date.now() + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

/* ---------- events ---------- */
function applyQuery(){
  state.query = qEl.value;
  renderStatus();
  render();
}
$('searchBtn').addEventListener('click', applyQuery);
qEl.addEventListener('input', debounce(applyQuery, 250));
qEl.addEventListener('keydown', e => { if (e.key === 'Enter') applyQuery(); });
$('fSort').addEventListener('change', () => {
  state.sort = $('fSort').value;
  runLoad();
});
$('fDepth').addEventListener('change', runLoad);
$('fBlur').addEventListener('change', render);
$('moreBtn').addEventListener('click', loadMore);

/* ---------- init ---------- */
renderInfo();
renderTabs();
loadActive();

try { parent.postMessage({ type: "dzmm-search-ready" }, "*"); } catch (e) {}
