(() => {
  if (window.__dzmmBoostInjected) return;
  window.__dzmmBoostInjected = true;

  const host = document.createElement('div');
  host.id = 'dzmm-boost-host';
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .dzmm-fab {
      position: fixed;
      right: 20px;
      bottom: 20px;
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 11px 17px;
      border: none;
      border-radius: 999px;
      background: linear-gradient(135deg, #7c5cff, #3ea6ff);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: grab;
      user-select: none;
      touch-action: none;
      pointer-events: auto;
      box-shadow: 0 8px 24px rgba(60, 40, 180, 0.35);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .dzmm-fab:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(60, 40, 180, 0.45); }
    .dzmm-fab.dragging { cursor: grabbing; transform: none; transition: none; }
    .dzmm-panel {
      position: fixed;
      display: none;
      flex-direction: column;
      width: min(900px, calc(100vw - 40px));
      height: min(78vh, 760px);
      background: #0f1115;
      border: 1px solid #2a2f3a;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
      pointer-events: auto;
      min-width: min(360px, calc(100vw - 16px));
      min-height: min(260px, calc(100vh - 16px));
    }
    .dzmm-panel.open { display: flex; }
    .dzmm-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: #171a21;
      border-bottom: 1px solid #2a2f3a;
      color: #e8eaf0;
      font-size: 13.5px;
      font-weight: 600;
      flex-shrink: 0;
      cursor: move;
      user-select: none;
      touch-action: none;
    }
    .dzmm-grip { opacity: .7; font-size: 13px; }
    .dzmm-bar .spacer { flex: 1; }
    .dzmm-bar button {
      border: 1px solid #2a2f3a;
      background: #1d212b;
      color: #e8eaf0;
      font: inherit;
      font-size: 12.5px;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      touch-action: manipulation;
    }
    .dzmm-bar button:hover { border-color: #7c5cff; }
    .dzmm-frame { flex: 1; min-height: 0; position: relative; }
    .dzmm-frame iframe { width: 100%; height: 100%; border: none; display: block; background: #0f1115; }
    .dzmm-resize {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 18px;
      height: 18px;
      cursor: nwse-resize;
      touch-action: none;
      z-index: 2;
    }
    .dzmm-resize::after {
      content: '';
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 8px;
      height: 8px;
      border-right: 2px solid rgba(255, 255, 255, 0.35);
      border-bottom: 2px solid rgba(255, 255, 255, 0.35);
    }
    @media (prefers-color-scheme: light) {
      .dzmm-panel { background: #f4f5f8; border-color: #dde0e8; }
      .dzmm-bar { background: #ffffff; border-color: #dde0e8; color: #1c2230; }
      .dzmm-bar button { background: #f0f1f5; border-color: #dde0e8; color: #1c2230; }
      .dzmm-resize::after { border-color: rgba(30, 40, 70, 0.4); }
    }
    @media (max-width: 640px) {
      .dzmm-fab { padding: 10px 14px; font-size: 13px; }
    }
  `;
  root.appendChild(style);

  const fab = document.createElement('button');
  fab.className = 'dzmm-fab';
  fab.type = 'button';
  fab.textContent = '🔍 增强搜索';
  fab.title = '打开 DZMM 搜索增强版（可拖动位置）';

  const panel = document.createElement('div');
  panel.className = 'dzmm-panel';

  const bar = document.createElement('div');
  bar.className = 'dzmm-bar';
  const grip = document.createElement('span');
  grip.className = 'dzmm-grip';
  grip.textContent = '⠿';
  const barTitle = document.createElement('span');
  barTitle.textContent = 'DZMM 搜索增强版';
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = '在新标签页打开';
  openBtn.title = '用完整标签页使用搜索';
  const compBtn = document.createElement('button');
  compBtn.type = 'button';
  compBtn.textContent = '🏆 比赛卡';
  compBtn.title = '打开当期创作比赛卡页面';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕ 关闭';
  bar.append(grip, barTitle, spacer, compBtn, openBtn, closeBtn);

  const frameWrap = document.createElement('div');
  frameWrap.className = 'dzmm-frame';
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-label', 'DZMM 搜索增强版');
  frameWrap.appendChild(frame);
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'dzmm-resize';
  resizeHandle.title = '拖动调整窗口大小';
  frameWrap.appendChild(resizeHandle);

  panel.append(bar, frameWrap);
  root.append(fab, panel);
  document.documentElement.appendChild(host);

  /* ---------- 位置存取 ---------- */
  function storageGet(key, dflt){
    return new Promise(resolve => {
      try {
        if (chrome && chrome.storage && chrome.storage.local){
          chrome.storage.local.get(key, obj => {
            try { resolve(obj && obj[key] != null ? obj[key] : dflt); }
            catch (e) { resolve(dflt); }
          });
        } else {
          const raw = localStorage.getItem('dzmm_float_' + key);
          resolve(raw ? JSON.parse(raw) : dflt);
        }
      } catch (e) { resolve(dflt); }
    });
  }
  function storageSet(key, val){
    try {
      if (chrome && chrome.storage && chrome.storage.local){
        chrome.storage.local.set({ [key]: val });
      } else {
        localStorage.setItem('dzmm_float_' + key, JSON.stringify(val));
      }
    } catch (e) { /* ignore */ }
  }

  let panelRect = null;
  let fabRect = null;

  function clampPanel(r){
    const m = 8;
    const maxW = innerWidth - m * 2;
    const maxH = innerHeight - m * 2;
    const minW = Math.min(360, maxW);
    const minH = Math.min(260, maxH);
    const width = Math.max(minW, Math.min(r.width || 900, maxW));
    const height = Math.max(minH, Math.min(r.height || 760, maxH));
    const left = Math.min(Math.max(r.left != null ? r.left : innerWidth - width - 20, m), innerWidth - width - m);
    const top = Math.min(Math.max(r.top != null ? r.top : innerHeight - height - 84, m), innerHeight - height - m);
    return { left, top, width, height };
  }
  function applyPanelRect(r){
    const c = clampPanel(r);
    panel.style.left = c.left + 'px';
    panel.style.top = c.top + 'px';
    panel.style.width = c.width + 'px';
    panel.style.height = c.height + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panelRect = c;
  }
  function savePanelRect(){
    if (!panel.classList.contains('open')) return;
    panelRect = {
      left: panel.offsetLeft,
      top: panel.offsetTop,
      width: panel.offsetWidth,
      height: panel.offsetHeight,
    };
    storageSet('panelRect', panelRect);
  }
  function applyFabRect(r){
    if (!r){
      fab.style.right = '20px';
      fab.style.bottom = '20px';
      fab.style.left = 'auto';
      fab.style.top = 'auto';
      return;
    }
    const w = fab.offsetWidth || 0;
    const h = fab.offsetHeight || 0;
    const left = Math.min(Math.max(r.left, 8), innerWidth - w - 8);
    const top = Math.min(Math.max(r.top, 8), innerHeight - h - 8);
    fab.style.left = left + 'px';
    fab.style.top = top + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  }

  (async () => {
    panelRect = await storageGet('panelRect', null);
    fabRect = await storageGet('fabRect', null);
    applyFabRect(fabRect);
    if (panelRect) applyPanelRect(panelRect);
  })();

  window.addEventListener('resize', () => {
    if (panelRect) applyPanelRect(panelRect);
    applyFabRect(fabRect);
  });

  /* ---------- 开关 ---------- */
  const setOpen = open => {
    panel.classList.toggle('open', open);
    if (open){
      if (!panelRect) applyPanelRect(null);
      if (!frame.src || frame.src === 'about:blank') frame.src = chrome.runtime.getURL('search.html');
    }
  };

  fab.addEventListener('click', () => {
    if (fabMoved) return;
    setOpen(true);
  });
  closeBtn.addEventListener('click', () => setOpen(false));
  openBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-search' });
  });
  compBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-competition' });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('open')) setOpen(false);
  });

  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'dzmm-search-ready') {
      panel.dataset.ready = '1';
    }
  });

  /* ---------- 悬浮按钮拖动 ---------- */
  let fabMoved = false;
  let fabDrag = null;
  fab.addEventListener('pointerdown', e => {
    fabMoved = false;
    fabDrag = {
      startX: e.clientX,
      startY: e.clientY,
      left: fab.offsetLeft,
      top: fab.offsetTop,
    };
    fab.setPointerCapture(e.pointerId);
    fab.classList.add('dragging');
  });
  fab.addEventListener('pointermove', e => {
    if (!fabDrag) return;
    const dx = e.clientX - fabDrag.startX;
    const dy = e.clientY - fabDrag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) fabMoved = true;
    const w = fab.offsetWidth || 0;
    const h = fab.offsetHeight || 0;
    const left = Math.min(Math.max(fabDrag.left + dx, 8), innerWidth - w - 8);
    const top = Math.min(Math.max(fabDrag.top + dy, 8), innerHeight - h - 8);
    fab.style.left = left + 'px';
    fab.style.top = top + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  });
  fab.addEventListener('pointerup', () => {
    if (!fabDrag) return;
    fab.classList.remove('dragging');
    fabDrag = null;
    if (fabMoved){
      fabRect = { left: fab.offsetLeft, top: fab.offsetTop };
      storageSet('fabRect', fabRect);
    }
  });

  /* ---------- 面板拖动（标题栏） ---------- */
  let panelDrag = null;
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    panelDrag = {
      startX: e.clientX,
      startY: e.clientY,
      left: panel.offsetLeft,
      top: panel.offsetTop,
    };
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointermove', e => {
    if (!panelDrag) return;
    const r = clampPanel({
      left: panelDrag.left + e.clientX - panelDrag.startX,
      top: panelDrag.top + e.clientY - panelDrag.startY,
      width: panel.offsetWidth,
      height: panel.offsetHeight,
    });
    panel.style.left = r.left + 'px';
    panel.style.top = r.top + 'px';
  });
  bar.addEventListener('pointerup', () => {
    if (!panelDrag) return;
    panelDrag = null;
    savePanelRect();
  });

  /* ---------- 面板缩放（右下角） ---------- */
  let resizeDrag = null;
  resizeHandle.addEventListener('pointerdown', e => {
    e.preventDefault();
    resizeDrag = {
      startX: e.clientX,
      startY: e.clientY,
      width: panel.offsetWidth,
      height: panel.offsetHeight,
    };
    resizeHandle.setPointerCapture(e.pointerId);
  });
  resizeHandle.addEventListener('pointermove', e => {
    if (!resizeDrag) return;
    const r = clampPanel({
      left: panel.offsetLeft,
      top: panel.offsetTop,
      width: resizeDrag.width + (e.clientX - resizeDrag.startX),
      height: resizeDrag.height + (e.clientY - resizeDrag.startY),
    });
    panel.style.width = r.width + 'px';
    panel.style.height = r.height + 'px';
  });
  resizeHandle.addEventListener('pointerup', () => {
    if (!resizeDrag) return;
    resizeDrag = null;
    savePanelRect();
  });
})();
