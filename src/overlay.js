// Injected into the harness GUI. Adds a "Local Server" sub-interface inside
// the Settings panel: a nav cell appended to the settings section list that
// shows a status page (URL + green/red light + start/stop controls). Class
// names are discovered at runtime and a MutationObserver re-injects after
// React re-renders. Status data comes from the desktop app's server manager
// over window.dsh.
(() => {
  if (window.__dshOverlay) return;
  window.__dshOverlay = true;

  const api = window.dsh;
  if (!api || !api.server || !api.config) return;

  let cachedConfig = { autoStartServer: true };
  // refresh(status) for the one visible status block, or null when the Local
  // Server page is not on screen. Keeping a single reference (rather than
  // appending to a list) means closed pages stop being refreshed instead of
  // piling up against detached DOM nodes.
  let liveRefresh = null;

  // ---------------------------------------------------------------------------
  // Shared styles
  // ---------------------------------------------------------------------------

  const style = document.createElement('style');
  style.textContent = `
    .dsh-ls-page{display:flex;flex-direction:column;gap:14px;width:100%;min-width:0;
      color:var(--dsw-alias-label-primary,#e6e9f0);font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
      font-size:13px;line-height:1.5;box-sizing:border-box}
    .dsh-ls-card{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));
      border:1px solid var(--dsw-alias-border-default,#232a38);border-radius:12px;padding:14px;box-sizing:border-box}
    .dsh-ls-status{display:flex;align-items:center;gap:9px;font-weight:500}
    .dsh-ls-dot{width:12px;height:12px;border-radius:50%;background:#e5534b;flex:none}
    .dsh-ls-dot.green{background:#3fb950;box-shadow:0 0 8px rgba(63,185,80,.8)}
    .dsh-ls-dot.red{background:#e5534b;box-shadow:0 0 8px rgba(229,83,75,.8)}
    .dsh-ls-url{font-family:Consolas,"Cascadia Mono",monospace;font-size:12px;
      color:var(--dsw-alias-link-primary,#7aa2ff);background:var(--dsw-alias-bg-layer-2,#10141c);
      border:1px solid var(--dsw-alias-border-default,#232a38);border-radius:8px;padding:8px 10px;
      cursor:pointer;word-break:break-all;margin-top:12px}
    .dsh-ls-url:hover{border-color:#3a4a6b}
    .dsh-ls-meta{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b93a7);margin-top:8px}
    .dsh-ls-actions{display:flex;gap:8px;margin-top:12px}
    .dsh-ls-actions button{font:inherit;font-size:12px;padding:6px 14px;border-radius:8px;
      border:1px solid var(--dsw-alias-border-default,#2a3040);background:#2b4b8f;color:#fff;cursor:pointer}
    .dsh-ls-actions button:hover{background:#3560b8}
    .dsh-ls-actions button.danger{background:#7a2f2a}
    .dsh-ls-actions button.danger:hover{background:#96403a}
    .dsh-ls-actions button:disabled{opacity:.5;cursor:default}
    .dsh-ls-label{display:flex;align-items:center;gap:8px;font-size:12px;margin-top:12px;cursor:pointer;color:var(--dsw-alias-label-secondary,#b8c0cf)}
    .dsh-ls-error{font-size:12px;color:#e5534b;background:rgba(229,83,75,.08);
      border:1px solid rgba(229,83,75,.3);border-radius:8px;padding:8px 10px;
      white-space:pre-wrap;word-break:break-all;margin-top:12px;display:none}
  `;
  document.head.appendChild(style);

  // ---------------------------------------------------------------------------
  // One status block (the Settings page content)
  // ---------------------------------------------------------------------------

  function makeStatusBlock() {
    const root = document.createElement('div');
    root.className = 'dsh-ls-card';
    root.innerHTML =
      '<div class="dsh-ls-status"><span class="dsh-ls-dot red"></span><span class="dsh-ls-status-text">检测中…</span></div>' +
      '<div class="dsh-ls-url" title="在浏览器中打开"></div>' +
      '<div class="dsh-ls-meta"></div>' +
      '<div class="dsh-ls-actions">' +
      '  <button class="dsh-ls-start">启动服务</button>' +
      '  <button class="dsh-ls-stop danger" style="display:none">停止服务</button>' +
      '</div>' +
      '<label class="dsh-ls-label"><input type="checkbox" class="dsh-ls-autostart" /> 启动桌面应用时自动启动服务</label>' +
      '<div class="dsh-ls-error"></div>';
    const q = (sel) => root.querySelector(sel);
    const els = {
      dot: q('.dsh-ls-dot'),
      statusText: q('.dsh-ls-status-text'),
      url: q('.dsh-ls-url'),
      meta: q('.dsh-ls-meta'),
      startBtn: q('.dsh-ls-start'),
      stopBtn: q('.dsh-ls-stop'),
      autoBox: q('.dsh-ls-autostart'),
      errorEl: q('.dsh-ls-error'),
    };
    els.autoBox.checked = cachedConfig.autoStartServer;

    const refresh = (status) => {
      if (!status) return;
      els.url.textContent = status.url || window.location.origin || '';
      const st = status.state;
      if (st === 'running') {
        els.dot.className = 'dsh-ls-dot green';
        els.statusText.textContent = '运行正常';
      } else {
        els.dot.className = 'dsh-ls-dot red';
        els.statusText.textContent = st === 'starting' ? '正在启动…' : st === 'error' ? '服务异常' : '服务未运行';
      }
      els.meta.textContent = status.managed
        ? '由本应用启动' + (status.pid ? ' (PID ' + status.pid + ')' : '')
        : st === 'running'
          ? '由外部进程提供'
          : '';
      els.startBtn.style.display = st === 'running' ? 'none' : '';
      els.stopBtn.style.display = st === 'running' && status.managed ? '' : 'none';
      if (status.error || status.detail) {
        els.errorEl.style.display = 'block';
        els.errorEl.textContent = [status.error, status.detail].filter(Boolean).join('\n');
      } else {
        els.errorEl.style.display = 'none';
      }
    };

    els.url.addEventListener('click', () => api.openExternal(els.url.textContent));
    els.startBtn.addEventListener('click', async () => {
      els.startBtn.disabled = true;
      els.startBtn.textContent = '正在启动…';
      try { refresh(await api.server.start()); } catch {}
      els.startBtn.disabled = false;
      els.startBtn.textContent = '启动服务';
    });
    els.stopBtn.addEventListener('click', async () => {
      els.stopBtn.disabled = true;
      try { refresh(await api.server.stop()); } catch {}
      els.stopBtn.disabled = false;
    });
    els.autoBox.addEventListener('change', async () => {
      cachedConfig.autoStartServer = els.autoBox.checked;
      try { await api.config.set({ autoStartServer: els.autoBox.checked }); } catch {}
    });

    return { root, refresh };
  }

  // ---------------------------------------------------------------------------
  // Harness Settings panel injection
  // ---------------------------------------------------------------------------

  // SVG elements expose className as an SVGAnimatedString, not a string — going
  // through getAttribute keeps this from throwing on icon elements (the
  // exception would escape into the MutationObserver and silently kill the
  // whole injection).
  const classesOf = (el) => {
    const raw = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
    return raw.split(/\s+/).filter(Boolean);
  };

  const bySuffix = (root, suffix) => {
    if (!root) return null;
    for (const el of root.querySelectorAll('[class*="' + suffix + '"]')) {
      if (classesOf(el).some((c) => c.endsWith(suffix))) return el;
    }
    return null;
  };

  function findShell() {
    for (const d of document.querySelectorAll('[role="dialog"]')) {
      const nav = d.querySelector('nav');
      if (!nav) continue;
      const title = bySuffix(nav, 'navTitle');
      if (!title || !/settings|设置/i.test(title.textContent || '')) continue;
      const navList = bySuffix(nav, 'navList');
      if (!navList) return null;
      return { dialog: d, nav, navList };
    }
    return null;
  }

  let ls = null; // { dialog, content, navList, pageActive, activeCls, overlay }

  function makeCell() {
    if (!ls) return;
    const sample = [...ls.navList.querySelectorAll('button')].find((b) => !b.hasAttribute('data-dsh-ls-cell'));
    if (!sample) return;
    const sampleCls = classesOf(sample);
    const base = sampleCls.filter((c) => !c.endsWith('active')).join(' ');
    ls.activeCls = sampleCls.find((c) => c.endsWith('active')) || '';
    const iconCls = sample.querySelector('svg')?.getAttribute('class') || '';
    const labelEl = bySuffix(sample, 'navLabel');
    const labelCls = labelEl ? classesOf(labelEl).join(' ') : '';
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = base;
    cell.setAttribute('data-dsh-ls-cell', '1');
    cell.innerHTML =
      '<svg class="' + iconCls + '" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<rect x="2" y="2" width="12" height="5" rx="1" fill="currentColor"/>' +
      '<rect x="2" y="9" width="12" height="5" rx="1" fill="currentColor" opacity="0.55"/></svg>' +
      '<span class="' + labelCls + '">Local Server</span>';
    cell.addEventListener('click', activate);
    ls.navList.appendChild(cell);
  }

  function makeOverlay() {
    if (!ls || !ls.content) return;
    if (!ls.content.style.position) ls.content.style.position = 'relative';
    const overlay = document.createElement('div');
    overlay.setAttribute('data-dsh-ls-overlay', '1');
    overlay.style.cssText =
      'position:absolute;inset:0;overflow:auto;padding:18px 20px;box-sizing:border-box;' +
      'background:var(--dsw-alias-bg-layer-2,#161a22);z-index:10;';
    const block = makeStatusBlock();
    overlay.appendChild(block.root);
    liveRefresh = block.refresh;
    ls.overlay = overlay;
    ls.content.appendChild(overlay);
    poll(); // fill the block now instead of waiting for the next tick
  }

  function activate() {
    if (!ls) return;
    ls.pageActive = true;
    // Clear the highlight (active class + aria-current) from every cell first,
    // otherwise the previously selected section stays lit next to ours.
    ls.navList.querySelectorAll('button').forEach((b) => {
      b.removeAttribute('aria-current');
      if (ls.activeCls) b.classList.remove(ls.activeCls);
    });
    const cell = ls.navList.querySelector('[data-dsh-ls-cell]');
    if (cell) {
      cell.setAttribute('aria-current', 'true');
      if (ls.activeCls) cell.classList.add(ls.activeCls);
    }
    if (!ls.overlay || !ls.overlay.isConnected) makeOverlay();
  }

  function deactivate() {
    if (!ls) return;
    ls.pageActive = false;
    const cell = ls.navList.querySelector('[data-dsh-ls-cell]');
    if (cell) {
      cell.removeAttribute('aria-current');
      if (ls.activeCls) cell.classList.remove(ls.activeCls);
    }
    if (ls.overlay && ls.overlay.isConnected) ls.overlay.remove();
    ls.overlay = null;
    liveRefresh = null;
  }

  function ensureInjected() {
    if (ls && !document.contains(ls.dialog)) {
      // Settings dialog closed: drop the refresher with it.
      ls = null;
      liveRefresh = null;
      return;
    }
    const shell = findShell();
    if (!shell) return;
    if (ls && ls.dialog === shell.dialog) {
      if (!ls.navList.querySelector('[data-dsh-ls-cell]')) makeCell();
      if (ls.pageActive) {
        // A React re-render may re-add the highlight to a real section;
        // while our page is active, keep the highlight on our cell only.
        ls.navList.querySelectorAll('button').forEach((b) => {
          const isOurs = b.hasAttribute('data-dsh-ls-cell');
          if (isOurs) {
            b.setAttribute('aria-current', 'true');
            if (ls.activeCls) b.classList.add(ls.activeCls);
          } else {
            b.removeAttribute('aria-current');
            if (ls.activeCls) b.classList.remove(ls.activeCls);
          }
        });
        if (!ls.overlay || !ls.overlay.isConnected) {
          const content = bySuffix(shell.dialog, 'content');
          if (content) {
            ls.content = content;
            makeOverlay();
          }
        }
      }
      return;
    }
    // A different dialog instance: the previous overlay (if any) is gone with it.
    liveRefresh = null;
    ls = {
      dialog: shell.dialog,
      content: bySuffix(shell.dialog, 'content'),
      navList: shell.navList,
      pageActive: false,
      activeCls: '',
      overlay: null,
    };
    makeCell();
    ls.navList.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (t && !t.hasAttribute('data-dsh-ls-cell') && ls && ls.pageActive) {
        deactivate();
        // React may skip re-rendering when the clicked section is already the
        // active one, so restore its highlight manually.
        t.setAttribute('aria-current', 'true');
        if (ls.activeCls) t.classList.add(ls.activeCls);
      }
    }, true);
  }

  const bodyObserver = new MutationObserver(() => ensureInjected());
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  ensureInjected();

  // ---------------------------------------------------------------------------
  // Polling + init
  // ---------------------------------------------------------------------------

  async function poll() {
    // No visible status block → nothing to update, and no reason to make the
    // main process probe the server over HTTP every two seconds.
    if (!liveRefresh) return;
    try {
      const status = await api.server.getStatus();
      if (liveRefresh) liveRefresh(status);
    } catch {}
  }

  (async () => {
    try {
      const cfg = await api.config.get();
      cachedConfig = { ...cachedConfig, ...cfg };
      document.querySelectorAll('.dsh-ls-autostart').forEach((cb) => { cb.checked = !!cachedConfig.autoStartServer; });
    } catch {}
    poll();
    window.setInterval(poll, 2000);
  })();
})();
