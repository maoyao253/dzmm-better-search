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
      right: 20px;
      bottom: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .dzmm-fab {
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
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(60, 40, 180, 0.35);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .dzmm-fab:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(60, 40, 180, 0.45); }
    .dzmm-overlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(10, 12, 18, 0.55);
      backdrop-filter: blur(4px);
      z-index: 2147483646;
      padding: 16px;
      box-sizing: border-box;
    }
    .dzmm-overlay.open { display: flex; }
    .dzmm-panel {
      width: min(1180px, 100%);
      height: min(90vh, 900px);
      background: #0f1115;
      border: 1px solid #2a2f3a;
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
    }
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
    }
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
    }
    .dzmm-bar button:hover { border-color: #7c5cff; }
    .dzmm-frame { flex: 1; min-height: 0; }
    .dzmm-frame iframe { width: 100%; height: 100%; border: none; display: block; background: #0f1115; }
    @media (prefers-color-scheme: light) {
      .dzmm-panel { background: #f4f5f8; border-color: #dde0e8; }
      .dzmm-bar { background: #ffffff; border-color: #dde0e8; color: #1c2230; }
      .dzmm-bar button { background: #f0f1f5; border-color: #dde0e8; color: #1c2230; }
    }
  `;
  root.appendChild(style);

  const fab = document.createElement('button');
  fab.className = 'dzmm-fab';
  fab.type = 'button';
  fab.textContent = '🔍 增强搜索';
  fab.title = '打开 DZMM 搜索增强版';

  const overlay = document.createElement('div');
  overlay.className = 'dzmm-overlay';

  const panel = document.createElement('div');
  panel.className = 'dzmm-panel';

  const bar = document.createElement('div');
  bar.className = 'dzmm-bar';
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
  bar.append(barTitle, spacer, compBtn, openBtn, closeBtn);

  const frameWrap = document.createElement('div');
  frameWrap.className = 'dzmm-frame';
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-label', 'DZMM 搜索增强版');
  frame.src = chrome.runtime.getURL('search.html');
  frameWrap.appendChild(frame);

  panel.append(bar, frameWrap);
  overlay.appendChild(panel);
  root.append(fab, overlay);
  document.documentElement.appendChild(host);

  const setOpen = open => {
    overlay.classList.toggle('open', open);
    document.documentElement.style.overflow = open ? 'hidden' : '';
    if (open) {
      if (!frame.src || frame.src === 'about:blank') frame.src = chrome.runtime.getURL('search.html');
    }
  };

  fab.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));
  openBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-search' });
  });
  compBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-competition' });
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) setOpen(false);
  });

  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'dzmm-search-ready') {
      overlay.dataset.ready = '1';
    }
  });
})();
