// Injected into the harness GUI.
// Adds:
// 1. "Local Server" management & "Voice Input" configuration inside Settings.
// 2. Real-time Voice Input (STT) button in the chat composer using Google Vertex gemini-3.5-transcribe.
// 3. Global keyboard shortcut (Alt+V) for instant push-to-talk / speech-to-text.
(() => {
  if (window.__dshOverlay) return;
  window.__dshOverlay = true;

  const api = window.dsh;
  if (!api || !api.server || !api.config) return;

  let cachedConfig = { autoStartServer: true, voiceAutoSend: false, voiceModel: 'gemini-3.5-transcribe' };
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
    .dsh-ls-card-title{font-size:13px;font-weight:600;margin-bottom:10px;color:var(--dsw-alias-label-primary,#e6e9f0);display:flex;align-items:center;gap:8px}
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

    /* Voice input toolbar button & badges */
    .dsh-voice-btn{
      display:inline-flex;align-items:center;justify-content:center;
      width:28px;height:28px;border-radius:6px;
      border:none;background:transparent;
      color:var(--dsw-alias-label-tertiary,#8b93a7);
      cursor:pointer;transition:all .15s ease;
      padding:0;margin:0 2px;position:relative;
    }
    .dsh-voice-btn:hover{
      background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));
      color:var(--dsw-alias-label-primary,#e6e9f0);
    }
    .dsh-voice-btn[data-voice-state="recording"]{
      background:rgba(229,83,75,.15);
      color:#e5534b;
      animation:dsh-pulse 1.2s infinite ease-in-out;
    }
    .dsh-voice-btn[data-voice-state="transcribing"]{
      background:rgba(122,162,255,.15);
      color:#7aa2ff;
      cursor:wait;
    }
    .dsh-voice-spinner{
      width:14px;height:14px;
      border:2px solid rgba(122,162,255,.3);
      border-top-color:#7aa2ff;
      border-radius:50%;
      animation:dsh-spin .8s linear infinite;
    }
    .dsh-voice-toast{
      position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
      background:#1e2430;border:1px solid #3a4a6b;
      color:#e6e9f0;font-size:12px;padding:8px 14px;border-radius:8px;
      box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:9999;
      pointer-events:none;transition:opacity .2s;
    }
    .dsh-kbd{
      display:inline-block;padding:2px 5px;font-size:11px;font-family:inherit;
      background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);
      border-radius:4px;color:var(--dsw-alias-label-secondary,#b8c0cf);margin-left:4px;
    }

    /* Harness update card */
    .dsh-update-row{font-size:12px;color:var(--dsw-alias-label-secondary,#b8c0cf);margin-top:10px;line-height:1.8}
    .dsh-update-msg{font-size:12px;margin-top:10px;line-height:1.6;min-height:16px;
      color:var(--dsw-alias-label-secondary,#b8c0cf);white-space:pre-wrap;word-break:break-all}
    .dsh-update-msg.ok{color:#3fb950}
    .dsh-update-msg.err{color:#e5534b}

    @keyframes dsh-pulse{
      0%{box-shadow:0 0 0 0 rgba(229,83,75,.6)}
      70%{box-shadow:0 0 0 6px rgba(229,83,75,0)}
      100%{box-shadow:0 0 0 0 rgba(229,83,75,0)}
    }
    @keyframes dsh-spin{
      to{transform:rotate(360deg)}
    }
  `;
  document.head.appendChild(style);

  // ---------------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------------

  function showToast(message, duration = 3000) {
    const existing = document.querySelector('.dsh-voice-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'dsh-voice-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // ---------------------------------------------------------------------------
  // Voice recording & transcription manager
  // ---------------------------------------------------------------------------

  let voiceState = 'idle'; // idle | recording | transcribing
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStream = null;

  function updateVoiceButtons() {
    document.querySelectorAll('[data-dsh-voice-btn]').forEach((btn) => {
      btn.setAttribute('data-voice-state', voiceState);
      if (voiceState === 'recording') {
        btn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
          '<circle cx="12" cy="12" r="6"/></svg>';
        btn.title = '正在录音… 点击停止并识别 (Alt+V)';
      } else if (voiceState === 'transcribing') {
        btn.innerHTML = '<span class="dsh-voice-spinner"></span>';
        btn.title = '正在通过 ' + (cachedConfig.voiceModel || 'gemini-3.5-transcribe') + ' 识别…';
      } else {
        btn.innerHTML =
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>' +
          '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>' +
          '<line x1="12" y1="19" x2="12" y2="23"/>' +
          '<line x1="8" y1="23" x2="16" y2="23"/>' +
          '</svg>';
        btn.title = '语音输入 (Alt+V)';
      }
    });
  }

  /**
   * Dispatches React-compatible change/input events on textarea
   */
  function setReactInputValue(input, value) {
    if (!input) return;
    const previousValue = input.value;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }
    const inputEvent = new Event('input', { bubbles: true });
    // React valueTracker update
    if (input._valueTracker) {
      input._valueTracker.setValue(previousValue);
    }
    input.dispatchEvent(inputEvent);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
    input.selectionStart = input.selectionEnd = value.length;
  }

  /**
   * Every element that can act as the chat composer: the <textarea> of older
   * GUIs, or the Lexical contenteditable dsh-web-frontend uses since 0.1.2-rc.1
   * (marked data-composer-input; contenteditable="false" while no workspace is
   * selected, so an inert one can carry the button but not take text).
   */
  function findComposers() {
    return [...document.querySelectorAll('textarea, [data-composer-input]')];
  }

  /** The composer to type into: the focused one, else the first editable one. */
  function activeComposer() {
    const all = findComposers();
    const editable = (el) => (el.tagName === 'TEXTAREA' ? !el.disabled : el.isContentEditable);
    return all.find((el) => el === document.activeElement && editable(el)) || all.find(editable) || null;
  }

  /** The composer's enclosing card — where its toolbar and send button live. */
  function composerContainer(composer) {
    return composer.closest('[data-composer-card]')
      || composer.closest('[data-input-scroll]')?.parentElement
      || composer.closest('[class*="InputBar_wrap"]')
      || composer.parentElement?.parentElement
      || null;
  }

  function composerText(composer) {
    return composer.tagName === 'TEXTAREA' ? composer.value || '' : composer.textContent || '';
  }

  /**
   * Append text to the composer through the GUI's own input path, so its state
   * (send button, drafts) sees it. Returns false when nothing could be typed.
   */
  function appendComposerText(composer, text) {
    const current = composerText(composer);
    const glue = current && !/\s$/.test(current) ? ' ' : '';
    if (composer.tagName === 'TEXTAREA') {
      setReactInputValue(composer, current + glue + text);
      return true;
    }
    // Lexical owns this DOM, so never write innerHTML. execCommand('insertText')
    // raises the same beforeinput event as typing, which is what it listens to.
    if (!composer.isContentEditable) return false;
    composer.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return document.execCommand('insertText', false, glue + text);
  }

  async function startRecording() {
    if (voiceState !== 'idle') return;
    try {
      audioChunks = [];
      recordingStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.start(200);
      voiceState = 'recording';
      updateVoiceButtons();
    } catch (err) {
      console.error('[VoiceInput] 无法访问麦克风:', err);
      showToast('无法启动麦克风：' + (err.message || '请检查麦克风权限'));
      voiceState = 'idle';
      updateVoiceButtons();
    }
  }

  async function stopRecording() {
    if (voiceState !== 'recording' || !mediaRecorder) return;
    voiceState = 'transcribing';
    updateVoiceButtons();

    return new Promise((resolve) => {
      mediaRecorder.onstop = async () => {
        try {
          if (recordingStream) {
            recordingStream.getTracks().forEach((t) => t.stop());
            recordingStream = null;
          }

          const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          if (blob.size < 100) {
            voiceState = 'idle';
            updateVoiceButtons();
            return resolve();
          }

          // Convert blob to base64
          const reader = new FileReader();
          reader.onloadend = async () => {
            const dataUrl = reader.result;
            const base64Data = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : '';

            try {
              if (api.voice?.transcribe) {
                const res = await api.voice.transcribe({
                  audioBase64: base64Data,
                  mimeType: blob.type,
                  model: cachedConfig.voiceModel || 'gemini-3.5-transcribe',
                });

                if (res.ok && res.text) {
                  const composer = activeComposer();
                  if (composer && appendComposerText(composer, res.text)) {
                    if (cachedConfig.voiceAutoSend) {
                      // The editor enables its send button on its next state
                      // commit, not synchronously — give it a beat.
                      setTimeout(() => {
                        const sendBtn = composerContainer(composer)
                          ?.querySelector('button[aria-label*="发送"], button[type="submit"], [class*="send"]');
                        if (sendBtn && !sendBtn.disabled) sendBtn.click();
                      }, 300);
                    }
                  } else {
                    showToast('已识别: ' + res.text);
                  }
                } else if (!res.ok) {
                  showToast('语音识别失败: ' + (res.error || '未知错误'));
                }
              }
            } catch (transcribeErr) {
              console.error('[VoiceInput] 转写异常:', transcribeErr);
              showToast('转写失败: ' + transcribeErr.message);
            } finally {
              voiceState = 'idle';
              updateVoiceButtons();
              resolve();
            }
          };
          reader.readAsDataURL(blob);
        } catch (e) {
          console.error('[VoiceInput] 结束录音异常:', e);
          voiceState = 'idle';
          updateVoiceButtons();
          resolve();
        }
      };

      try {
        mediaRecorder.stop();
      } catch {
        voiceState = 'idle';
        updateVoiceButtons();
        resolve();
      }
    });
  }

  function toggleVoiceInput() {
    if (voiceState === 'idle') {
      startRecording();
    } else if (voiceState === 'recording') {
      stopRecording();
    }
  }

  // Global shortcut Alt+V
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'v' || e.key === 'V' || e.code === 'KeyV')) {
      e.preventDefault();
      toggleVoiceInput();
    }
  });

  // ---------------------------------------------------------------------------
  // Inject Voice Input Button into Composer
  // ---------------------------------------------------------------------------

  function ensureVoiceButtonInjected() {
    // Find each composer's tools container (next to attachments / slash commands)
    for (const composer of findComposers()) {
      const container = composerContainer(composer);
      if (!container) continue;

      const tools = container.querySelector('[class*="InputBar_tools"], [class*="tools"]')
        || container.querySelector('[class*="row"] > div');
      // The last fallback is loose ("grow" matches "row"); never land inside the editor.
      if (!tools || tools === composer || tools.contains(composer)) continue;

      if (!tools.querySelector('[data-dsh-voice-btn]')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dsh-voice-btn';
        btn.setAttribute('data-dsh-voice-btn', '1');
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleVoiceInput();
        });
        tools.appendChild(btn);
        updateVoiceButtons();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // One status block (the Settings page content)
  // ---------------------------------------------------------------------------

  function makeStatusBlock() {
    const root = document.createElement('div');
    root.className = 'dsh-ls-page';
    root.innerHTML =
      '<div class="dsh-ls-card">' +
      '  <div class="dsh-ls-card-title">本地 Harness 服务</div>' +
      '  <div class="dsh-ls-status"><span class="dsh-ls-dot red"></span><span class="dsh-ls-status-text">检测中…</span></div>' +
      '  <div class="dsh-ls-url" title="在浏览器中打开"></div>' +
      '  <div class="dsh-ls-meta"></div>' +
      '  <div class="dsh-ls-actions">' +
      '    <button class="dsh-ls-start">启动服务</button>' +
      '    <button class="dsh-ls-stop danger" style="display:none">停止服务</button>' +
      '  </div>' +
      '  <label class="dsh-ls-label"><input type="checkbox" class="dsh-ls-autostart" /> 启动桌面应用时自动启动服务</label>' +
      '  <div class="dsh-ls-error"></div>' +
      '</div>' +
      '<div class="dsh-ls-card">' +
      '  <div class="dsh-ls-card-title">语音输入 (STT)</div>' +
      '  <div style="font-size:12px;color:var(--dsw-alias-label-secondary,#b8c0cf);line-height:1.6">' +
      '    由 <strong>Google Vertex AI (' + (cachedConfig.voiceModel || 'gemini-3.5-transcribe') + ')</strong> 提供低延迟多模态语音转文字服务。' +
      '  </div>' +
      '  <label class="dsh-ls-label"><input type="checkbox" class="dsh-ls-autosend" /> 语音转写完成后自动发送消息</label>' +
      '  <div style="font-size:12px;color:var(--dsw-alias-label-tertiary,#8b93a7);margin-top:10px">' +
      '    快捷键：<span class="dsh-kbd">Alt</span> + <span class="dsh-kbd">V</span> 开启/结束录音' +
      '  </div>' +
      '</div>' +
      '<div class="dsh-ls-card">' +
      '  <div class="dsh-ls-card-title">Harness 更新</div>' +
      '  <div style="font-size:12px;color:var(--dsw-alias-label-secondary,#b8c0cf);line-height:1.6">' +
      '    对比内置的 <strong>@deepseek-ai/dsh</strong> 与 npm 最新版本' +
      '  </div>' +
      '  <div class="dsh-update-row">当前版本：<span class="dsh-update-cur">—</span><br>最新版本：<span class="dsh-update-latest">—</span></div>' +
      '  <div class="dsh-ls-actions"><button class="dsh-ls-update">检查更新</button></div>' +
      '  <div class="dsh-update-msg"></div>' +
      '</div>';

    const q = (sel) => root.querySelector(sel);
    const els = {
      dot: q('.dsh-ls-dot'),
      statusText: q('.dsh-ls-status-text'),
      url: q('.dsh-ls-url'),
      meta: q('.dsh-ls-meta'),
      startBtn: q('.dsh-ls-start'),
      stopBtn: q('.dsh-ls-stop'),
      autoBox: q('.dsh-ls-autostart'),
      autoSendBox: q('.dsh-ls-autosend'),
      errorEl: q('.dsh-ls-error'),
      updateCur: q('.dsh-update-cur'),
      updateLatest: q('.dsh-update-latest'),
      updateBtn: q('.dsh-ls-update'),
      updateMsg: q('.dsh-update-msg'),
    };
    els.autoBox.checked = !!cachedConfig.autoStartServer;
    els.autoSendBox.checked = !!cachedConfig.voiceAutoSend;

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
    els.autoSendBox.addEventListener('change', async () => {
      cachedConfig.voiceAutoSend = els.autoSendBox.checked;
      try { await api.config.set({ voiceAutoSend: els.autoSendBox.checked }); } catch {}
    });

    // --- Harness update card ---
    const setUpdateMsg = (text, kind) => {
      els.updateMsg.textContent = text || '';
      els.updateMsg.className = 'dsh-update-msg' + (kind ? ' ' + kind : '');
    };
    els.updateBtn.addEventListener('click', async () => {
      if (!api.harness || !api.harness.checkUpdate) {
        setUpdateMsg('当前版本不支持在线检查更新', 'err');
        return;
      }
      els.updateBtn.disabled = true;
      els.updateBtn.textContent = '检查中…';
      setUpdateMsg('正在查询 npm registry…', '');
      try {
        const res = await api.harness.checkUpdate();
        if (!res.ok) {
          setUpdateMsg(res.error || '检查失败', 'err');
        } else if (res.updating) {
          els.updateCur.textContent = res.cached ? 'v' + res.cached : '（未缓存）';
          els.updateLatest.textContent = 'v' + res.latest;
          setUpdateMsg(`发现新版本 v${res.latest}，正在下载安装，完成后将自动重启应用…`, '');
        } else {
          els.updateCur.textContent = res.cached ? 'v' + res.cached : '（未缓存）';
          els.updateLatest.textContent = res.latest ? 'v' + res.latest : '—';
          setUpdateMsg('', '');
        }
      } catch (err) {
        setUpdateMsg('检查失败：' + ((err && err.message) || err), 'err');
      } finally {
        els.updateBtn.disabled = false;
        els.updateBtn.textContent = '检查更新';
      }
    });

    return { root, refresh };
  }

  // ---------------------------------------------------------------------------
  // Harness Settings panel injection
  // ---------------------------------------------------------------------------

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
      '<span class="' + labelCls + '">Local Server & STT</span>';
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
    poll();
  }

  function activate() {
    if (!ls) return;
    ls.pageActive = true;
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
    ensureVoiceButtonInjected();

    if (ls && !document.contains(ls.dialog)) {
      ls = null;
      liveRefresh = null;
      return;
    }
    const shell = findShell();
    if (!shell) return;
    if (ls && ls.dialog === shell.dialog) {
      if (!ls.navList.querySelector('[data-dsh-ls-cell]')) makeCell();
      if (ls.pageActive) {
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
      document.querySelectorAll('.dsh-ls-autosend').forEach((cb) => { cb.checked = !!cachedConfig.voiceAutoSend; });
    } catch {}
    // Live progress of the Settings "检查更新" flow (updating → restarting → error).
    if (api.harness && api.harness.onProgress) {
      api.harness.onProgress((p) => {
        const msgEl = document.querySelector('.dsh-update-msg');
        if (!msgEl) return;
        msgEl.textContent = (p && p.message) || '';
        msgEl.className = 'dsh-update-msg' + (p && p.phase === 'error' ? ' err' : '');
      });
    }
    poll();
    window.setInterval(poll, 2000);
  })();
})();
