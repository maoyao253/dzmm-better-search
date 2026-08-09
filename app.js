
'use strict';
const API = 'https://www.dzmm.ai/api/trpc/search.search';
const SITE = 'https://www.dzmm.ai';
const PAGE_LIMIT = 100;

const TYPE_META = {
  cards:       { label: '角色卡', type: 'cards',      scope: true },
  games:       { label: '游戏卡', type: 'gamefy',     scope: true },
  novels:      { label: '小说',   type: 'novels',     scope: false },
  images:      { label: '绘图',   type: 'images',     scope: false },
  tweets:      { label: '推文',   type: 'tweets',     scope: false },
  checkpoints: { label: '模型',   type: 'checkpoints', scope: false },
  combined:    { label: '全部',   type: 'combined',   scope: false },
};
const TYPE_KEYS = Object.keys(TYPE_META);

const state = {
  items: new Map(),      // uniqueId -> raw result item
  streams: [],           // {params, cursor, hasMore}
  query: '',
  type: 'cards',
  searchId: 0,
  loadedPages: 0,
  totalPages: 0,
  finished: false,
  error: null,
  startedAt: 0,
  autoAuthors: [],
  _views: new Map(),
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
function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function termHits(text, term){
  if (!text || !term) return false;
  const t = String(text).toLowerCase();
  const q = String(term).toLowerCase();
  if (/[\u4e00-\u9fff]/.test(q)) return t.includes(q);
  return new RegExp('(^|[^a-z0-9])' + escRe(q) + '($|[^a-z0-9])', 'i').test(t);
}

/* ---------- query parsing ---------- */
function parseQuery(raw){
  const out = { terms: [], excludes: [], phrases: [], tags: [], creators: [], opts: {} };
  const tokens = String(raw || '').match(/"[^"]*"|\S+/g) || [];
  for (const tok of tokens){
    if (tok.startsWith('"') && tok.endsWith('"') && tok.length >= 2){
      const phrase = tok.slice(1, -1).trim();
      if (phrase) out.phrases.push(phrase.toLowerCase());
      continue;
    }
    const low = tok.toLowerCase();
    if (low.startsWith('min:')){ const v = Number(tok.slice(4)); if (Number.isFinite(v)) out.opts.minLikes = v; continue; }
    if (low.startsWith('rating:')){ const v = Number(tok.slice(7)); if (Number.isFinite(v)) out.opts.minRating = v; continue; }
    if (low.startsWith('date:')){ out.opts.date = tok.slice(5).toLowerCase(); continue; }
    if (low.startsWith('sort:')){ out.opts.sort = tok.slice(5).toLowerCase(); continue; }
    if (low.startsWith('type:')){ out.opts.type = tok.slice(5).toLowerCase(); continue; }
    if (low.startsWith('lang:')){ out.opts.lang = tok.slice(5).toLowerCase(); continue; }
    if (tok.startsWith('#') && tok.length > 1){ out.tags.push(tok.slice(1).toLowerCase()); continue; }
    if (tok.startsWith('@') && tok.length > 1){ out.creators.push(tok.slice(1)); continue; }
    if (tok.startsWith('-') && tok.length > 1){ out.excludes.push(tok.slice(1).toLowerCase()); continue; }
    if (tok) out.terms.push(tok.toLowerCase());
  }
  return out;
}

/* 去掉扩展自己处理的语法（@作者 / #标签 / -排除 / min: / rating: 等），
   避免把带 @ 的原始查询直接发给 dzmm 接口导致搜不到内容 */
function serverQueryFor(raw){
  const tokens = String(raw || '').match(/"[^"]*"|\S+/g) || [];
  const kept = [];
  for (const tok of tokens){
    if (tok.startsWith('"') && tok.endsWith('"') && tok.length >= 2){ kept.push(tok); continue; }
    const low = tok.toLowerCase();
    if (low.startsWith('min:') || low.startsWith('rating:') || low.startsWith('date:') ||
        low.startsWith('sort:') || low.startsWith('type:') || low.startsWith('lang:')) continue;
    if (tok.startsWith('#') && tok.length > 1) continue;
    if (tok.startsWith('-') && tok.length > 1) continue;
    if (tok.startsWith('@') && tok.length > 1) continue;
    kept.push(tok);
  }
  return kept.join(' ');
}

function isSingleBareTerm(s){
  const t = String(s || '').trim();
  return !!t && !/\s/.test(t) && !t.startsWith('"') && !t.startsWith("'");
}

function normalizeType(v){
  const map = {
    card:'cards', cards:'cards', game:'games', games:'games', gamefy:'games',
    novel:'novels', novels:'novels', book:'novels',
    image:'images', images:'images', gallery:'images', galleries:'images',
    tweet:'tweets', tweets:'tweets', checkpoint:'checkpoints', checkpoints:'checkpoints',
    all:'combined', combined:'combined',
  };
  return map[v] || null;
}
function normalizeSort(v){
  return ['smart','popular','recent','relevant','most_liked','most_comments','rating'].includes(v) ? v : null;
}
function normalizeDate(v){
  return ['day','week','month','three_months'].includes(v) ? v : null;
}
function normalizeLang(v){
  if (v === 'zh' || v === 'zh-cn') return 'zh-CN';
  if (v === 'en' || v === 'en-us') return 'en-US';
  return null;
}

/* ---------- item views ---------- */
function firstMedia(m){
  if (!m) return '';
  if (Array.isArray(m)) return m.find(x => typeof x === 'string' && x) || '';
  if (typeof m === 'string') return m;
  return '';
}
function thumbUrl(url, w){
  if (!url) return '';
  let u = url;
  if (u.startsWith('/')) u = SITE + u;
  const m = u.match(/\/storage\/v1\/object\/public\/(.+)$/);
  if (m) return 'https://rls.cheggpt.com/storage/v1/render/image/public/' + m[1] + '?width=' + w + '&resize=contain&quality=75';
  return u;
}
function itemUrl(item){
  if (item.detailHref) return SITE + item.detailHref;
  if (item.postId) return SITE + '/post/' + item.postId;
  const d = item.data || {};
  if (item.type === 'card' || item.type === 'gamefy') return SITE + '/character/' + d.id;
  return '#';
}
function ensureView(item){
  if (state._views.has(item.uniqueId)) return state._views.get(item.uniqueId);
  const d = item.data || {};
  const authorName = (item.author && item.author.fullName) || d.creatorFullName || d.creator || '';
  let view;
  switch (item.type){
    case 'card':
    case 'gamefy':
      view = {
        kind: 'card', nsfw: !!d.isSensitive, title: d.name || '',
        tags: Array.isArray(d.tags) ? d.tags : [],
        desc: d.creatorNotes || item.displayContent || '',
        author: authorName,
        image: d.cardFilename || '',
        likes: num(item.likesCount, num(d.likesCount)),
        comments: num(item.commentsCount, num(d.commentsCount)),
        rating: num(d.weightedRating),
        popularity: num(d.popularityScore),
        publishedAt: d.publishedAt || d.firstPublishedAt || d.createdAt || item.timestamp || '',
        extra: '',
      };
      break;
    case 'book':
      view = {
        kind: 'book', nsfw: !!d.isNsfw, title: d.title || '',
        tags: Array.isArray(d.tags) ? d.tags : [],
        desc: d.description || item.displayContent || '',
        author: authorName, image: d.coverImageUrl || '',
        likes: num(item.likesCount), comments: num(item.commentsCount),
        rating: 0, popularity: 0,
        publishedAt: d.publishedAt || d.createdAt || item.timestamp || '',
        extra: `${num(d.chapterCount)} 章 · ${fmtCount(d.totalWordCount)} 字`,
      };
      break;
    case 'tweet':
      view = {
        kind: 'tweet', nsfw: !d.sfw, title: (d.content || '').slice(0, 60),
        tags: [], desc: d.content || '',
        author: authorName, image: firstMedia(d.mediaUrls) || firstMedia(item.displayMedia),
        likes: num(item.likesCount), comments: num(item.commentsCount),
        rating: 0, popularity: 0,
        publishedAt: d.createdAt || item.timestamp || '',
        extra: '',
      };
      break;
    case 'checkpoint':
      view = {
        kind: 'checkpoint', nsfw: false, title: d.name || '模型检查点',
        tags: [], desc: d.description || '',
        author: authorName, image: '',
        likes: num(item.likesCount), comments: num(item.commentsCount),
        rating: num(d.ratingAvg), popularity: 0,
        publishedAt: d.createdAt || item.timestamp || '',
        extra: num(d.ratingCount) ? `${num(d.ratingCount)} 人评分` : '',
      };
      break;
    case 'image':
      view = {
        kind: 'image', nsfw: false, title: (d.originalPrompt || '绘图作品').slice(0, 60),
        tags: Array.isArray(d.tags) ? d.tags : [],
        desc: d.originalPrompt || '',
        author: authorName, image: firstMedia(item.displayMedia) || '',
        likes: num(item.likesCount), comments: num(item.commentsCount),
        rating: 0, popularity: 0,
        publishedAt: d.createdAt || item.timestamp || '',
        extra: d.model ? `模型：${d.model}` : '',
      };
      break;
    default:
      view = {
        kind: 'other', nsfw: false, title: d.name || d.title || '结果',
        tags: Array.isArray(d.tags) ? d.tags : [], desc: item.displayContent || '',
        author: authorName, image: firstMedia(item.displayMedia),
        likes: num(item.likesCount), comments: num(item.commentsCount),
        rating: 0, popularity: 0,
        publishedAt: item.timestamp || '', extra: '',
      };
  }
  const textParts = [view.title, (view.tags || []).join(' '), view.author, view.desc, item.displayContent];
  item._text = textParts.filter(Boolean).join(' ').toLowerCase();
  state._views.set(item.uniqueId, view);
  return view;
}

/* ---------- filters & scoring ---------- */
function getFilters(){
  return {
    type: state.type,
    scope: $('fScope').value,
    sort: $('fSort').value,
    date: $('fDate').value,
    lang: $('fLang').value,
    nsfw: $('fNsfw').value,
    minLikes: num($('fMinLikes').value),
    minRating: num($('fMinRating').value),
    matchAll: $('fMatchAll').checked,
    searchDesc: $('fSearchDesc').checked,
    hideSystem: $('fHideSystem').checked,
    depth: num($('fDepth').value, 2),
  };
}
function isSystemItem(item, view){
  if (view.kind !== 'card') return false;
  const fn = String((item.data || {}).cardFilename || '');
  return fn.includes('system-assistant') || (!view.author && !view.desc);
}
function passesFilters(item, view, parsed){
  const f = getFilters();
  if (f.nsfw === 'sfw' && view.nsfw) return false;
  if (f.nsfw === 'nsfw' && !view.nsfw) return false;
  if (f.hideSystem && isSystemItem(item, view)) return false;
  const minLikes = parsed.opts.minLikes != null ? parsed.opts.minLikes : f.minLikes;
  const minRating = parsed.opts.minRating != null ? parsed.opts.minRating : f.minRating;
  if (minLikes > 0 && view.likes < minLikes) return false;
  if (minRating > 0 && view.rating < minRating) return false;
  for (const ex of parsed.excludes) if (termHits(item._text, ex)) return false;
  const tagText = (view.tags || []).map(t => t.toLowerCase());
  for (const tag of parsed.tags){
    if (!tagText.some(t => t.includes(tag) || tag.includes(t))) return false;
  }
  for (const cr of parsed.creators){
    if (!termHits(view.author, cr)) return false;
  }
  for (const aa of state.autoAuthors){
    if (!termHits(view.author, aa)) return false;
  }
  return true;
}
function scoreItem(item, view, parsed){
  const name = (view.title || '').toLowerCase();
  const tagsText = (view.tags || []).join(' ').toLowerCase();
  const requireAll = getFilters().matchAll;
  let score = 0, hitAny = false;
  for (const term of parsed.terms){
    const inName = termHits(name, term);
    const inTags = termHits(tagsText, term);
    const inText = termHits(item._text, term);
    if (!inName && !inTags && !inText){
      if (requireAll) return -Infinity;
      continue;
    }
    hitAny = true;
    if (inName){
      if (name === term) score += 500;
      else if (name.startsWith(term)) score += 320;
      else score += 200;
    }
    if (inTags) score += 150;
    if (inText) score += 80;
  }
  for (const phrase of parsed.phrases){
    if (!item._text.includes(phrase)){
      if (requireAll) return -Infinity;
    } else {
      hitAny = true;
      score += 400;
    }
  }
  if ((parsed.terms.length || parsed.phrases.length) && !hitAny) return -Infinity;
  return score;
}
function matchedItems(parsed){
  const f = getFilters();
  const arr = [];
  for (const item of state.items.values()){
    const view = ensureView(item);
    if (!passesFilters(item, view, parsed)) continue;
    const score = scoreItem(item, view, parsed);
    if (score === -Infinity) continue;
    arr.push({ item, view, score });
  }
  const sort = normalizeSort(parsed.opts.sort) || f.sort;
  arr.sort((a, b) => {
    switch (sort){
      case 'recent': return String(b.view.publishedAt).localeCompare(String(a.view.publishedAt));
      case 'popular': return b.view.popularity - a.view.popularity;
      case 'most_liked': return b.view.likes - a.view.likes;
      case 'most_comments': return b.view.comments - a.view.comments;
      case 'rating': return (b.view.rating - a.view.rating) || (b.view.likes - a.view.likes);
      default:
        if (b.score !== a.score) return b.score - a.score;
        return b.view.popularity - a.view.popularity;
    }
  });
  return arr;
}

/* ---------- API ---------- */
function buildStreams(parsed){
  const f = getFilters();
  const type = normalizeType(parsed.opts.type) || f.type;
  const meta = TYPE_META[type];
  const streams = [];
  let serverQ = serverQueryFor(state.query);
  let scope = parsed.opts.scope || f.scope;
  if (parsed.creators.length){
    // 作者名可能出现在简介里，必须用全范围抓取；纯 @作者 查询则直接用作者名搜
    scope = 'all';
    if (!serverQ.trim()) serverQ = parsed.creators.join(' ');
  } else if (isSingleBareTerm(serverQ)){
    // 单个词有可能是作者名，用全范围抓取，抓完再自动按作者过滤
    scope = 'all';
  }
  const base = { q: serverQ, limit: PAGE_LIMIT };
  if (meta.scope){
    base.type = meta.type;
    if (f.sort && f.sort !== 'smart') base.sort = f.sort;
    if (f.date !== 'all') base.dateRange = f.date;
    if (f.lang !== 'all') base.lang = f.lang;
    streams.push({ params: { ...base, scope }, cursor: null, hasMore: true });
    if (f.searchDesc && scope !== 'all'){
      streams.push({ params: { ...base, scope: 'all' }, cursor: null, hasMore: true });
    }
  } else if (meta.type === 'combined'){
    streams.push({
      params: { q: serverQ, types: 'cards,tweets,checkpoints,galleries,gamefy', sort: 'recent', excludeForumTopics: 'true', limit: PAGE_LIMIT },
      cursor: null, hasMore: true
    });
  } else {
    base.type = meta.type;
    if (f.sort && f.sort !== 'smart') base.sort = f.sort;
    if (f.date !== 'all') base.dateRange = f.date;
    if (f.lang !== 'all') base.lang = f.lang;
    streams.push({ params: base, cursor: null, hasMore: true });
  }
  return { streams, type };
}

async function fetchPage(stream){
  const params = { ...stream.params };
  if (stream.cursor != null) params.cursor = stream.cursor;
  const payload = { 0: { json: params } };
  const url = API + '?batch=1&input=' + encodeURIComponent(JSON.stringify(payload));
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
  const data = body[0].result.data.json;
  const results = data.results || [];
  if (data.nextCursor != null){
    stream.cursor = data.nextCursor;
    stream.hasMore = !!data.nextCursor;
  } else {
    stream.cursor = (stream.cursor || 0) + results.length;
    stream.hasMore = results.length >= PAGE_LIMIT;
  }
  return results;
}

async function fetchStream(stream, pages, sid, onPage){
  for (let i = 0; i < pages; i++){
    if (sid !== state.searchId) return;
    const results = await fetchPage(stream);
    let added = 0;
    for (const r of results){
      if (!state.items.has(r.uniqueId)){
        state.items.set(r.uniqueId, r);
        added++;
      }
    }
    onPage && onPage(added, i + 1, stream);
    if (!stream.hasMore) break;
    await sleep(120);
  }
}

/* ---------- search execution ---------- */
async function runSearch(){
  const q = qEl.value.trim();
  state.searchId++;
  const sid = state.searchId;
  state.query = q;
  state.items.clear();
  state._views.clear();
  state.autoAuthors = [];
  state.finished = false;
  state.error = null;
  state.loadedPages = 0;
  state.totalPages = 0;
  state.startedAt = Date.now();

  const parsed = parseQuery(q);
  const { streams, type } = buildStreams(parsed);
  state.streams = streams;
  state.type = type;
  state.totalPages = streams.length * getFilters().depth;
  saveHistory(q);
  renderTabs();
  $('error').style.display = 'none';
  renderStatus();
  render();
  $('moreBtn').style.display = 'none';

  for (const stream of streams){
    try {
      await fetchStream(stream, getFilters().depth, sid, () => {
        state.loadedPages++;
        renderStatus();
        render();
      });
    } catch (err){
      if (sid !== state.searchId) return;
      state.error = err.rateLimit
        ? '请求太频繁，被接口限流了。请等 30~60 秒再搜，或把“抓取深度”调小。'
        : '加载失败：' + err.message;
      $('error').style.display = 'block';
      $('error').textContent = state.error;
      renderStatus();
      render();
      return;
    }
    if (sid !== state.searchId) return;
  }
  if (sid !== state.searchId) return;
  detectAutoAuthors(parsed);
  state.finished = true;
  renderStatus();
  render();
}

function detectAutoAuthors(parsed){
  state.autoAuthors = [];
  if (parsed.creators.length) return;
  const cleaned = serverQueryFor(state.query).trim();
  if (!cleaned || /\s/.test(cleaned) || cleaned.startsWith('"') || cleaned.startsWith("'")) return;
  const low = cleaned.toLowerCase();
  const found = new Map();
  for (const item of state.items.values()){
    const d = item.data || {};
    const id = item.authorId || d.userId;
    const name = (item.author && item.author.fullName) || d.creatorFullName || d.creator || '';
    if (id && name && name.toLowerCase().includes(low)){
      if (!found.has(id)) found.set(id, name);
    }
  }
  state.autoAuthors = [...found.values()];
}

async function loadMore(){
  if (!state.streams.length) return;
  state.finished = false;
  const sid = state.searchId;
  $('moreBtn').disabled = true;
  for (const stream of state.streams){
    if (!stream.hasMore) continue;
    try {
      await fetchStream(stream, 1, sid, () => {
        state.loadedPages++;
        renderStatus();
        render();
      });
    } catch (err){
      if (sid !== state.searchId) return;
      state.error = err.rateLimit
        ? '请求太频繁，被接口限流了。请等 30~60 秒再试。'
        : '加载失败：' + err.message;
      $('error').style.display = 'block';
      $('error').textContent = state.error;
      renderStatus();
      render();
      return;
    }
  }
  if (sid !== state.searchId) return;
  state.finished = true;
  $('moreBtn').disabled = false;
  detectAutoAuthors(parseQuery(state.query));
  renderStatus();
  render();
}

/* ---------- rendering ---------- */
function renderTabs(){
  const wrap = $('typeTabs');
  wrap.innerHTML = '';
  for (const key of TYPE_KEYS){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab' + (key === state.type ? ' active' : '');
    btn.textContent = TYPE_META[key].label;
    btn.onclick = () => {
      if (state.type !== key) { state.type = key; runSearch(); }
    };
    wrap.appendChild(btn);
  }
}

function renderStatus(){
  const el = $('statusText');
  const elapsed = ((Date.now() - state.startedAt) / 1000).toFixed(1);
  if (!state.query && !state.items.size){
    el.innerHTML = '输入关键词开始搜索；也可以直接点“搜索”浏览全部角色卡。';
  } else if (state.error){
    el.innerHTML = `已抓取 <b>${state.items.size}</b> 条，但加载中断了。`;
  } else if (!state.finished){
    el.innerHTML = `正在抓取第 <b>${state.loadedPages}</b> 页 / 共 ${state.totalPages} 页，已获取 <b>${state.items.size}</b> 条…`;
  } else {
    const parsed = parseQuery(state.query);
    const matched = matchedItems(parsed).length;
    if (state.autoAuthors.length){
      el.innerHTML = `已按作者「<b>${esc(state.autoAuthors.join('、'))}</b>」过滤，匹配 <b>${matched}</b> 条 · ` +
        `<a href="javascript:void(0)" class="cancel-auto">取消过滤</a>（用时 ${elapsed} 秒）`;
    } else {
      el.innerHTML = `已抓取 <b>${state.items.size}</b> 条，匹配 <b>${matched}</b> 条（用时 ${elapsed} 秒）`;
    }
  }
  const cancelLink = el.querySelector && el.querySelector('.cancel-auto');
  if (cancelLink) cancelLink.onclick = () => { state.autoAuthors = []; renderStatus(); render(); };
}

function render(){
  const parsed = parseQuery(state.query);
  const arr = matchedItems(parsed);
  const grid = $('grid');
  grid.className = 'grid';
  const frag = document.createDocumentFragment();
  const f = getFilters();
  const blurNsfw = f.nsfw === 'all';

  for (const { item, view } of arr){
    const a = document.createElement('a');
    a.className = 'card' + (view.nsfw && blurNsfw ? ' nsfw' : '');
    a.href = itemUrl(item);
    a.target = '_blank';
    a.rel = 'noreferrer';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const imgUrl = thumbUrl(view.image, 460);
    if (imgUrl){
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = view.title;
      img.referrerPolicy = 'no-referrer';
      img.src = imgUrl;
      img.onerror = () => { img.style.display = 'none'; const ph = document.createElement('div'); ph.className='placeholder'; ph.textContent = (view.title || '?').trim().charAt(0); thumb.appendChild(ph); };
      thumb.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'placeholder';
      ph.textContent = (view.title || '?').trim().charAt(0);
      thumb.appendChild(ph);
    }
    if (view.nsfw && f.nsfw !== 'sfw'){
      const b = document.createElement('span');
      b.className = 'nsfw-badge';
      b.textContent = '敏感';
      thumb.appendChild(b);
    }
    if (view.kind !== 'card'){
      const b = document.createElement('span');
      b.className = 'badge';
      const kindKey = { card:'cards', gamefy:'games', book:'novels', tweet:'tweets', checkpoint:'checkpoints', image:'images' }[item.type] || item.type;
      b.textContent = (TYPE_META[kindKey] && TYPE_META[kindKey].label) || item.type;
      thumb.appendChild(b);
    }
    a.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'body';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = view.title || '未命名';
    body.appendChild(name);

    if (view.tags && view.tags.length){
      const tags = document.createElement('div');
      tags.className = 'tags';
      for (const t of view.tags.slice(0, 5)){
        const s = document.createElement('span');
        s.className = 'tag';
        s.textContent = '#' + t;
        tags.appendChild(s);
      }
      body.appendChild(tags);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const m1 = document.createElement('span'); m1.className = 'up'; m1.textContent = '♥ ' + fmtCount(view.likes);
    const m2 = document.createElement('span'); m2.className = 'cm'; m2.textContent = '💬 ' + fmtCount(view.comments);
    meta.appendChild(m1); meta.appendChild(m2);
    if (view.rating > 0){
      const m3 = document.createElement('span'); m3.className = 'rt'; m3.textContent = '★ ' + view.rating.toFixed(1);
      meta.appendChild(m3);
    }
    if (view.extra){ const m4 = document.createElement('span'); m4.textContent = view.extra; meta.appendChild(m4); }
    body.appendChild(meta);

    const author = document.createElement('div');
    author.className = 'author';
    author.textContent = view.author ? ('by ' + view.author) : '';
    body.appendChild(author);

    if (view.desc){
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = view.desc.replace(/\s+/g, ' ').trim();
      body.appendChild(desc);
    }
    a.appendChild(body);
    frag.appendChild(a);
  }

  grid.innerHTML = '';
  grid.appendChild(frag);

  const empty = $('empty');
  if (!state.items.size && !state.error && !state.loadedPages){
    empty.style.display = 'none';
  } else if (!arr.length){
    empty.style.display = 'block';
    $('emptyText').textContent = state.items.size
      ? `已抓取 ${state.items.size} 条但没有符合当前条件的。试试减少过滤条件，或点“加载更多结果”。`
      : '没有找到匹配的内容，试试换关键词，或点“加载更多结果”。';
  } else {
    empty.style.display = 'none';
  }

  const anyMore = state.streams.some(s => s.hasMore);
  $('moreBtn').style.display = (state.items.size && anyMore && !state.error) ? 'inline-block' : 'none';
  $('moreBtn').disabled = false;
}

/* ---------- history ---------- */
function getHistory(){
  try { return JSON.parse(localStorage.getItem('dzmm_search_history') || '[]'); }
  catch (e) { return []; }
}
function saveHistory(q){
  if (!q) return;
  try {
    const h = getHistory().filter(x => x !== q);
    h.unshift(q);
    localStorage.setItem('dzmm_search_history', JSON.stringify(h.slice(0, 12)));
  } catch (e) { /* ignore */ }
}
function renderHistory(){
  const wrap = $('history');
  wrap.innerHTML = '';
  const h = getHistory();
  if (!h.length) return;
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = '最近搜索：';
  wrap.appendChild(lbl);
  for (const q of h){
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = q;
    c.title = q;
    c.onclick = () => { qEl.value = q; runSearch(); };
    wrap.appendChild(c);
  }
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'chip';
  clear.textContent = '清空';
  clear.onclick = () => { try { localStorage.removeItem('dzmm_search_history'); } catch (e) {} renderHistory(); };
  wrap.appendChild(clear);
}

/* ---------- export ---------- */
function exportLines(){
  const parsed = parseQuery(state.query);
  const arr = matchedItems(parsed);
  return arr.map(({ item, view }) => {
    const tags = (view.tags || []).slice(0, 8).map(t => '#' + t).join(' ');
    return `${view.title}\t♥${fmtCount(view.likes)}\t★${view.rating ? view.rating.toFixed(1) : '-'}\t${itemUrl(item)}\t${tags}`;
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
  const header = '\uFEFF作者,粉丝数,关注数,链接\n';
  const csv = header + lines.map(l => {
    const c = l.split('\t');
    return c.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',');
  }).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dzmm-search-' + Date.now() + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

/* ---------- events ---------- */
$('searchForm').addEventListener('submit', e => { e.preventDefault(); runSearch(); });
$('moreBtn').addEventListener('click', loadMore);
for (const id of ['fScope', 'fSearchDesc', 'fDepth']){
  $(id).addEventListener('change', runSearch);
}
for (const id of ['fSort', 'fDate', 'fLang', 'fNsfw', 'fMinLikes', 'fMinRating', 'fMatchAll', 'fHideSystem']){
  $(id).addEventListener('change', () => { renderStatus(); render(); });
}

/* ---------- init ---------- */
renderTabs();
renderHistory();
const urlQ = new URLSearchParams(location.search).get('q');
if (urlQ){
  qEl.value = urlQ;
  runSearch();
} else if (!qEl.value){
  runSearch();
}


try { parent.postMessage({ type: "dzmm-search-ready" }, "*"); } catch (e) {}
