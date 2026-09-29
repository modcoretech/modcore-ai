/* ============================================================================
   modcore AI — ui.js  (rendering + unified sidebar + modals)
   ========================================================================== */

import { smd, shj } from './vendor.js';
import * as Core from './app.js';
import { registerConfirmHandler } from './app.js';

const { Config, Profile, Memory, Conversations, Workspace,
        KEYS, LIMITS, classifyFile, readAsText, readAsDataURL,
        humanSize, estimateStorage, generateTitle } = Core;

/* ── Modal ──────────────────────────────────────────────────────────────── */

export const Modal = {
  _resolve: null,
  init() {
    const dlg = document.getElementById('confirm-dialog');
    dlg.addEventListener('close', () => {
      if (Modal._resolve) {
        Modal._resolve(dlg.returnValue === 'confirm');
        Modal._resolve = null;
      }
    });
    registerConfirmHandler(Modal.confirm.bind(Modal));
  },
  confirm({ title, message, confirmText = 'Allow', cancelText = 'Cancel' }) {
    const dlg = document.getElementById('confirm-dialog');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-action-btn').textContent = confirmText;
    document.getElementById('cancel-action-btn').textContent = cancelText;
    dlg.returnValue = 'cancel';
    return new Promise((resolve) => {
      Modal._resolve = resolve;
      dlg.showModal();
    });
  }
};

/* ── Streaming markdown renderer ────────────────────────────────────────── */

export class StreamingRenderer {
  constructor(container) {
    this.container = container;
    this.parser = null; this.active = false; this.fallbackBuf = '';
  }
  start() {
    this.container.innerHTML = '';
    this.active = true; this.fallbackBuf = '';
    if (smd) this.parser = smd.parser(smd.default_renderer(this.container));
    else this.container.style.whiteSpace = 'pre-wrap';
  }
  write(chunk) {
    if (!this.active || !chunk) return;
    if (this.parser) smd.parser_write(this.parser, chunk);
    else { this.fallbackBuf += chunk; this.container.textContent = this.fallbackBuf; }
  }
  end() {
    if (!this.active) return;
    this.active = false;
    if (this.parser) { smd.parser_end(this.parser); this.parser = null; this.#highlight(); }
  }
  async #highlight() {
    if (!shj) return;
    for (const el of this.container.querySelectorAll('pre > code')) {
      const raw = (el.className || '').trim();
      try { await shj.highlightElement(el, raw || 'plain'); }
      catch { try { await shj.highlightElement(el, 'plain'); } catch {} }
    }
  }
}

/* ── Chain of Thought ───────────────────────────────────────────────────── */

class ChainOfThought {
  constructor(host) {
    this.startTime = performance.now();
    this.toolCount = 0;
    this.steps = new Map();
    this.done = false;

    this.el = document.createElement('details');
    this.el.className = 'cot';
    this.el.open = true;

    this.summary = document.createElement('summary');
    this.summary.className = 'cot-summary';
    this.summary.innerHTML = `
      <span class="cot-spinner"></span>
      <span class="cot-summary-text">Thinking…</span>
      <span class="icon icon-chevron cot-chevron"></span>
    `;

    this.body = document.createElement('div');
    this.body.className = 'cot-body';
    this.reasoning = document.createElement('div');
    this.reasoning.className = 'cot-reasoning';
    this.stepList = document.createElement('div');
    this.stepList.className = 'cot-steps';

    this.body.append(this.reasoning, this.stepList);
    this.el.append(this.summary, this.body);
    host.appendChild(this.el);
  }

  setReasoning(text) {
    if (this.reasoning.textContent !== text) this.reasoning.textContent = text;
  }
  closeEarly() { if (!this.done) this.el.open = false; }
  reopen()     { if (!this.done) this.el.open = true; }

  addToolStep(name, args) {
    this.reopen();
    this.toolCount++;
    const card = document.createElement('div');
    card.className = 'cot-step running';
    card.dataset.tool = name;
    const dot = document.createElement('span');
    dot.className = 'cot-dot';
    const nameEl = document.createElement('span');
    nameEl.className = 'cot-step-name';
    nameEl.textContent = name;
    const argsEl = document.createElement('span');
    argsEl.className = 'cot-step-args';
    argsEl.textContent = args && Object.keys(args).length ? compactJson(args) : '';
    card.append(dot, nameEl, argsEl);
    this.stepList.appendChild(card);
    this.steps.set(name, card);
    this.#updateSummary();
  }

  settleToolStep(name, result) {
    const card = this.steps.get(name);
    if (!card) return;
    card.classList.remove('running');
    const ok = result && (result.ok === true || result.status === 'success');
    card.classList.add(ok ? 'done' : 'error');
    if (!ok) card.querySelector('.cot-step-args').textContent =
      result?.error?.message || result?.message || 'failed';
    this.#updateSummary();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.el.classList.add('cot-done');
    this.summary.querySelector('.cot-spinner')?.remove();
    const dur = ((performance.now() - this.startTime) / 1000).toFixed(1);
    const parts = [];
    if (this.toolCount) parts.push(`${this.toolCount} step${this.toolCount === 1 ? '' : 's'}`);
    parts.push(`${dur}s`);
    this.summary.querySelector('.cot-summary-text').textContent = parts.join(' · ');
    setTimeout(() => { if (this.el.open) this.el.open = false; }, 350);
  }

  #updateSummary() {
    if (this.done) return;
    const txt = this.summary.querySelector('.cot-summary-text');
    if (this.toolCount === 0) txt.textContent = 'Thinking…';
    else txt.textContent = `Working… (${this.toolCount} step${this.toolCount === 1 ? '' : 's'})`;
  }
}

function compactJson(obj) {
  try { const s = JSON.stringify(obj); return s.length > 120 ? s.slice(0, 117) + '…' : s; }
  catch { return ''; }
}

/* ── Unified Sidebar ────────────────────────────────────────────────────── */

export class Sidebar {
  constructor(ui) {
    this.ui = ui;
    this.$panel    = document.getElementById('sidebar-panel');
    this.$title    = document.getElementById('sidebar-title');
    this.$subtitle = document.getElementById('sidebar-subtitle');
    this.$body     = document.getElementById('sidebar-body');
    this.$tabs     = document.getElementById('sidebar-tabs');
    this.$back     = document.getElementById('sidebar-back');
    this.$close    = document.getElementById('sidebar-close');
    this.$actions  = document.getElementById('sidebar-actions');

    this.mode = 'files-list';        // 'files-list' | 'file' | 'file-history' | settings tabs | 'loading'
    this.currentConvId = null;
    this.currentFile = null;         // path
    this.settingsTab = 'general';

    this.$close.addEventListener('click', () => this.close());
    this.$back.addEventListener('click', () => this.goBack());
  }

  isOpen() { return this.$panel.classList.contains('open'); }
  open() { this.$panel.classList.add('open'); this.render(); }
  close() { this.$panel.classList.remove('open'); this.mode = null; }

  goBack() {
    if (this.mode === 'file' || this.mode === 'file-history') {
      this.mode = 'files-list';
      this.currentFile = null;
      this.render();
    } else if (this.mode.startsWith('settings-')) {
      this.mode = 'files-list';
      this.render();
    }
  }

  async setConversation(convId) {
    this.currentConvId = convId;
    if (this.isOpen()) this.render();
  }

  showFiles() {
    this.mode = 'files-list';
    this.open();
  }

  showSettings(tab = 'general') {
    this.mode = `settings-${tab}`;
    this.settingsTab = tab;
    this.open();
  }

  showFile(path, tab = 'file') {
    this.currentFile = path;
    this.mode = tab;
    this.open();
  }

  showLoading(label) {
    this.mode = 'loading';
    this.$panel.classList.add('open');
    this.$panel.classList.add('loading');
    this.$tabs.innerHTML = '';
    this.$back.hidden = true;
    this.$actions.innerHTML = '';
    this.$title.textContent = 'Working…';
    this.$subtitle.textContent = label || '';
    this.$body.innerHTML = '<div class="side-loading"><span class="cot-spinner"></span></div>';
  }
  clearLoading() { this.$panel.classList.remove('loading'); }

  async render() {
    this.clearLoading();
    this.$tabs.innerHTML = '';
    this.$actions.innerHTML = '';
    this.$back.hidden = true;

    if (this.mode === 'files-list')     return this.#renderFilesList();
    if (this.mode === 'file')           return this.#renderFileContent();
    if (this.mode === 'file-history')   return this.#renderFileHistory();
    if (this.mode === 'settings-general')  return this.#renderSettings('general');
    if (this.mode === 'settings-profile')  return this.#renderSettings('profile');
    if (this.mode === 'settings-storage')  return this.#renderSettings('storage');
    if (this.mode === 'settings-security') return this.#renderSettings('security');
  }

  /* ── Files ────────────────────────────────────────────────────────────── */

  async #renderFilesList() {
    this.$title.textContent = 'Files';
    this.$subtitle.textContent = '';
    this.$back.hidden = true;

    const conv = await Conversations.get(this.currentConvId);
    if (!conv) return;
    const files = Object.values(conv.files || {});
    const atts  = conv.attachments || [];
    this.$body.innerHTML = '';

    if (atts.length) {
      this.$body.appendChild(sectionHeading(`Uploads · ${atts.length}`));
      for (const a of atts) this.$body.appendChild(this.#fileRow(a, 'upload'));
    }
    if (files.length) {
      this.$body.appendChild(sectionHeading(`Workspace · ${files.length}`));
      for (const f of files) this.$body.appendChild(this.#fileRow(f, 'workspace'));
    }
    if (!atts.length && !files.length) {
      this.$body.appendChild(emptyState('No files yet.',
        'Uploads and files modcore AI creates appear here.'));
    }
  }

  #fileRow(item, kind) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'side-row';

    const name = item.name || item.path || 'file';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const badge = document.createElement('span');
    badge.className = 'side-badge';
    badge.textContent = (ext || 'file').slice(0, 4).toUpperCase();

    const text = document.createElement('div');
    text.className = 'side-row-text';
    const title = document.createElement('div');
    title.className = 'side-row-title';
    title.textContent = name;
    const meta = document.createElement('div');
    meta.className = 'side-row-meta';
    const versions = item.versions?.length || 0;
    const versionTag = versions > 1 ? ` · ${versions} versions` : '';
    meta.textContent = humanSize(item.size || (item.content ? item.content.length : 0)) + versionTag;
    text.append(title, meta);

    row.append(badge, text);
    row.addEventListener('click', () => {
      if (kind === 'upload') this.showFile(name, 'file');
      else this.showFile(item.path, 'file');
    });
    return row;
  }

  async #renderFileContent() {
    this.$back.hidden = false;
    const conv = await Conversations.get(this.currentConvId);
    if (!conv) return;

    // Either a workspace file (by path) or an upload (by name).
    let item, kind, path;
    if (conv.files?.[this.currentFile]) {
      item = conv.files[this.currentFile];
      kind = 'workspace';
      path = this.currentFile;
    } else {
      item = (conv.attachments || []).find((a) => a.name === this.currentFile);
      if (!item) { this.showFiles(); return; }
      kind = 'upload';
      path = item.name;
    }

    this.$title.textContent = item.name || item.path;
    this.$subtitle.textContent = kind === 'upload'
      ? 'Upload'
      : `${(item.versions || []).length} version${(item.versions || []).length === 1 ? '' : 's'}`;

    // Tabs: Content + History for workspace files only.
    if (kind === 'workspace') {
      const tabs = [
        { id: 'file', label: 'Content' },
        { id: 'file-history', label: 'History' }
      ];
      for (const t of tabs) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'side-tab' + (t.id === this.mode ? ' active' : '');
        b.textContent = t.label;
        b.addEventListener('click', () => { this.mode = t.id; this.render(); });
        this.$tabs.appendChild(b);
      }
    }

    // Download
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'msg-action';
    dl.title = 'Download';
    dl.innerHTML = `<span class="icon icon-download"></span>`;
    dl.addEventListener('click', () => this.#download(item, kind));
    this.$actions.appendChild(dl);

    this.$body.innerHTML = '';
    const pre = document.createElement('div');
    pre.className = 'side-preview';

    if (kind === 'upload' && item.kind === 'image') {
      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.alt = item.name;
      img.className = 'side-preview-img';
      pre.appendChild(img);
    } else {
      const code = document.createElement('code');
      code.className = `side-code shj-lang-${item.lang || 'plain'}`;
      code.textContent = item.content || '';
      pre.appendChild(code);
      if (shj) { try { await shj.highlightElement(code, item.lang || 'plain'); } catch {} }
    }
    this.$body.appendChild(pre);
  }

  async #renderFileHistory() {
    const conv = await Conversations.get(this.currentConvId);
    const file = conv?.files?.[this.currentFile];
    if (!file) { this.showFiles(); return; }

    this.$title.textContent = file.path;
    this.$subtitle.textContent = 'History';
    this.$back.hidden = false;

    // Same tabs as content view
    for (const t of [
      { id: 'file', label: 'Content' },
      { id: 'file-history', label: 'History' }
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'side-tab' + (t.id === this.mode ? ' active' : '');
      b.textContent = t.label;
      b.addEventListener('click', () => { this.mode = t.id; this.render(); });
      this.$tabs.appendChild(b);
    }

    this.$body.innerHTML = '';
    const versions = [...(file.versions || [])].reverse();
    if (!versions.length) {
      this.$body.appendChild(emptyState('No versions yet.', ''));
      return;
    }
    for (const v of versions) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'side-row';

      const badge = document.createElement('span');
      badge.className = 'side-badge commit-badge';
      badge.textContent = v.type === 'create' ? '+' : v.type === 'restore' ? '↺' : '✎';

      const text = document.createElement('div');
      text.className = 'side-row-text';
      const title = document.createElement('div');
      title.className = 'side-row-title';
      title.textContent = v.message;
      const meta = document.createElement('div');
      meta.className = 'side-row-meta';
      const when = new Date(v.createdAt);
      meta.textContent = `${when.toLocaleDateString()} ${when.toLocaleTimeString()} · ${v.lines} lines`;
      text.append(title, meta);

      row.append(badge, text);
      row.addEventListener('click', async () => {
        const ok = await Modal.confirm({
          title: 'Restore version?',
          message: `Restore "${file.path}" to:\n\n"${v.message}"\n\nThis will replace the current content.`,
          confirmText: 'Restore', cancelText: 'Cancel'
        });
        if (!ok) return;
        await Workspace.restoreVersion(this.currentConvId, file.path, v.id);
        this.mode = 'file';
        this.render();
      });
      this.$body.appendChild(row);
    }
  }

  #download(item, kind) {
    const a = document.createElement('a');
    const name = item.name || item.path?.split('/').pop() || 'file';
    a.download = name;
    if (kind === 'upload' && item.dataUrl) {
      a.href = item.dataUrl;
    } else {
      const mime = guessMimeFromExt(name);
      a.href = URL.createObjectURL(new Blob([item.content || ''], { type: mime }));
    }
    a.click();
    if (a.href.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ── Settings ─────────────────────────────────────────────────────────── */

  async #renderSettings(tab) {
    this.$title.textContent = 'Settings';
    this.$subtitle.textContent = '';
    this.$back.hidden = true;

    for (const t of [
      { id: 'general',  label: 'General' },
      { id: 'profile',  label: 'Profile' },
      { id: 'storage',  label: 'Storage' },
      { id: 'security', label: 'Security' }
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'side-tab' + (t.id === tab ? ' active' : '');
      b.textContent = t.label;
      b.addEventListener('click', () => this.showSettings(t.id));
      this.$tabs.appendChild(b);
    }

    this.$body.innerHTML = '';
    this.$body.classList.add('side-body-settings');

    if (tab === 'general')  await this.#renderGeneral();
    if (tab === 'profile')  await this.#renderProfile();
    if (tab === 'storage')  await this.#renderStorage();
    if (tab === 'security') await this.#renderSecurity();
  }

  async #renderGeneral() {
    const cfg = await Config.get();

    this.$body.append(
      field('API base URL', textInput('s-baseUrl', cfg.baseUrl)),
      field('API key (optional)', passwordInput('s-apiKey', cfg.apiKey)),
      field('Web search API key (langsearch.com)',
        passwordInput('s-webSearchApiKey', cfg.webSearchApiKey)),
      await this.#modelField(cfg),
      (() => { const d = document.createElement('div'); d.id = 's-model-status'; d.className = 'model-status'; return d; })(),
      (() => {
        const row = document.createElement('div');
        row.className = 'modal-actions';
        const save = document.createElement('button');
        save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = 'Save';
        save.addEventListener('click', () => this.#saveGeneral());
        row.appendChild(save);
        return row;
      })()
    );

    this.#loadModels();
  }

  async #modelField(cfg) {
    const row = document.createElement('div');
    row.className = 'field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.textContent = 'Default model';
    const wrap = document.createElement('div');
    wrap.className = 'model-row';
    const sel = document.createElement('select');
    sel.id = 's-model'; sel.className = 'form-input';
    if (cfg.model) {
      const o = document.createElement('option');
      o.value = o.textContent = cfg.model; o.selected = true;
      sel.appendChild(o);
    } else {
      const o = document.createElement('option');
      o.value = ''; o.textContent = '— click refresh to load —';
      o.disabled = true; o.selected = true;
      sel.appendChild(o);
    }
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'btn btn-ghost model-refresh';
    refresh.title = 'Refresh models';
    refresh.innerHTML = `<span class="icon icon-refresh"></span>`;
    refresh.addEventListener('click', () => this.#loadModels());
    wrap.append(sel, refresh);
    row.append(label, wrap);
    return row;
  }

  async #loadModels() {
    const statusEl = this.$body.querySelector('#s-model-status');
    const sel = this.$body.querySelector('#s-model');
    if (!sel || !statusEl) return;

    const cfg = {
      baseUrl: this.$body.querySelector('#s-baseUrl').value.trim(),
      apiKey:  this.$body.querySelector('#s-apiKey').value.trim()
    };
    if (!cfg.baseUrl) {
      statusEl.textContent = 'Add a base URL first.'; statusEl.dataset.kind = 'muted'; return;
    }

    statusEl.textContent = 'Loading models…'; statusEl.dataset.kind = 'muted';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const models = await Core.fetchModels(cfg, ctrl.signal);
      clearTimeout(timer);
      const current = sel.value;
      sel.innerHTML = '';
      if (!models.length) {
        const o = document.createElement('option');
        o.value = ''; o.textContent = 'No models returned';
        o.disabled = true; o.selected = true;
        sel.appendChild(o);
        statusEl.textContent = 'Provider returned an empty list.';
        statusEl.dataset.kind = 'muted';
        return;
      }
      for (const m of models) {
        const o = document.createElement('option');
        o.value = m.id; o.textContent = m.label;
        sel.appendChild(o);
      }
      if (current && models.some((m) => m.id === current)) sel.value = current;
      statusEl.textContent = `Loaded ${models.length} model${models.length === 1 ? '' : 's'}`;
      statusEl.dataset.kind = 'ok';
    } catch (err) {
      clearTimeout(timer);
      statusEl.textContent = err?.name === 'AbortError'
        ? 'Timed out.' : `Failed: ${err?.message || err}`;
      statusEl.dataset.kind = 'error';
    }
  }

  async #saveGeneral() {
    const baseUrl = this.$body.querySelector('#s-baseUrl').value.trim();
    const apiKey  = this.$body.querySelector('#s-apiKey').value.trim();
    const webSearchApiKey = this.$body.querySelector('#s-webSearchApiKey').value.trim();
    const model   = this.$body.querySelector('#s-model').value;
    if (!model) {
      const s = this.$body.querySelector('#s-model-status');
      s.textContent = 'Pick a model before saving.'; s.dataset.kind = 'error';
      return;
    }
    await Config.set({ baseUrl, apiKey, webSearchApiKey, model });
    window.__modcoreRefreshQuickModel?.();
    this.close();
  }

  async #renderProfile() {
    const p = await Profile.get();
    const nameField = field('Display name',
      textInput('p-name', p.displayName, 'What should modcore AI call you?'));
    const hint = document.createElement('div');
    hint.className = 'field-hint';
    hint.textContent = 'Your name is always shared with the AI so it can address you personally.';

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = 'Save';
    save.addEventListener('click', async () => {
      await Profile.set({
        displayName: this.$body.querySelector('#p-name').value.trim()
      });
      this.close();
    });
    actions.appendChild(save);

    this.$body.append(nameField, hint, actions);
  }

  async #renderStorage() {
    const host = document.createElement('div');
    host.className = 'storage-view';
    host.innerHTML = `<div class="side-empty"><p>Calculating…</p></div>`;
    this.$body.appendChild(host);

    const est = await estimateStorage();
    const cats = est.categories.map((c) => ({
      id: c.id, label: c.label, bytes: est.breakdown[c.id] || 0
    }));
    const total = cats.reduce((a, b) => a + b.bytes, 0) || 1;

    const colors = {
      conversations: '#6DA7EC', attachments: '#8bb9f0',
      memory: '#7fc99a', config: '#e5b567', other: '#898781'
    };

    host.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'storage-head';
    head.innerHTML = `
      <div>
        <div class="storage-total-value">${humanSize(total)}</div>
        <div class="storage-total-label">used by modcore AI</div>
      </div>
      <div class="storage-quota">${est.limit ? `of ${humanSize(est.limit)} available` : ''}</div>
    `;
    host.appendChild(head);

    const bar = document.createElement('div');
    bar.className = 'storage-bar';
    for (const c of cats) {
      if (!c.bytes) continue;
      const seg = document.createElement('div');
      seg.className = 'storage-seg';
      seg.style.background = colors[c.id];
      seg.style.width = `${(c.bytes / total) * 100}%`;
      seg.title = `${c.label}: ${humanSize(c.bytes)}`;
      bar.appendChild(seg);
    }
    host.appendChild(bar);

    const legend = document.createElement('div');
    legend.className = 'storage-legend';
    for (const c of cats) {
      const row = document.createElement('div');
      row.className = 'storage-row';
      row.innerHTML = `
        <span class="storage-dot" style="background:${colors[c.id]}"></span>
        <span class="storage-label">${c.label}</span>
        <span class="storage-value">${humanSize(c.bytes)}</span>
      `;
      legend.appendChild(row);
    }
    host.appendChild(legend);

    const actions = document.createElement('div');
    actions.className = 'storage-actions';
    const clearConvos = document.createElement('button');
    clearConvos.type = 'button'; clearConvos.className = 'btn btn-ghost';
    clearConvos.textContent = 'Clear all conversations';
    clearConvos.addEventListener('click', async () => {
      const ok = await Modal.confirm({
        title: 'Delete all conversations?',
        message: 'Removes every conversation, message, and file.',
        confirmText: 'Delete all', cancelText: 'Cancel'
      });
      if (!ok) return;
      await Conversations.clearAll();
      window.__modcoreReload?.();
      this.render();
    });
    const clearMem = document.createElement('button');
    clearMem.type = 'button'; clearMem.className = 'btn btn-ghost';
    clearMem.textContent = 'Clear memory';
    clearMem.addEventListener('click', async () => {
      const ok = await Modal.confirm({
        title: 'Clear memory?',
        message: 'Removes everything modcore AI remembers across all conversations.',
        confirmText: 'Clear', cancelText: 'Cancel'
      });
      if (!ok) return;
      await chrome.storage.local.remove(KEYS.MEMORY);
      this.render();
    });
    actions.append(clearConvos, clearMem);
    host.appendChild(actions);
  }

  async #renderSecurity() {
    const cfg = await Config.get();

    const field1 = document.createElement('div');
    field1.className = 'security-field';

    const row = document.createElement('div');
    row.className = 'security-row';

    const text = document.createElement('div');
    text.className = 'security-text';
    const label = document.createElement('div');
    label.className = 'security-label';
    label.textContent = 'Outbound web access';
    const desc = document.createElement('div');
    desc.className = 'security-desc';
    desc.textContent = 'When enabled, modcore AI can fetch public APIs and URLs (web_fetch) and search the web (web_search). Disable to keep the AI offline.';
    text.append(label, desc);

    const toggle = document.createElement('label');
    toggle.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = cfg.security?.allowWebFetch !== false;
    input.addEventListener('change', async () => {
      const cur = await Config.get();
      await Config.set({ security: { ...cur.security, allowWebFetch: input.checked } });
    });
    const slider = document.createElement('span');
    slider.className = 'switch-slider';
    toggle.append(input, slider);

    row.append(text, toggle);
    field1.appendChild(row);

    const hint = document.createElement('div');
    hint.className = 'field-hint';
    hint.textContent = 'The AI never sends your files or conversations to arbitrary URLs on its own. Only tool calls it makes as part of a task trigger outbound requests.';

    this.$body.append(field1, hint);
  }
}

/* ── Small helpers ──────────────────────────────────────────────────────── */

function field(label, input) {
  const w = document.createElement('div');
  w.className = 'field';
  const l = document.createElement('label');
  l.className = 'field-label';
  l.textContent = label;
  w.append(l, input);
  return w;
}
function textInput(id, value, placeholder = '') {
  const i = document.createElement('input');
  i.type = 'text'; i.id = id; i.className = 'form-input';
  i.value = value || ''; i.placeholder = placeholder;
  return i;
}
function passwordInput(id, value) {
  const i = document.createElement('input');
  i.type = 'password'; i.id = id; i.className = 'form-input';
  i.value = value || '';
  return i;
}
function sectionHeading(text) {
  const d = document.createElement('div');
  d.className = 'side-section-heading';
  d.textContent = text;
  return d;
}
function emptyState(title, sub) {
  const d = document.createElement('div');
  d.className = 'side-empty';
  const p1 = document.createElement('p'); p1.textContent = title;
  if (sub) {
    const p2 = document.createElement('p'); p2.className = 'muted'; p2.textContent = sub;
    d.append(p1, p2);
  } else d.appendChild(p1);
  return d;
}
function guessMimeFromExt(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    txt: 'text/plain', md: 'text/markdown', html: 'text/html',
    css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
    ts: 'text/typescript', json: 'application/json', xml: 'application/xml',
    svg: 'image/svg+xml', csv: 'text/csv', yaml: 'text/yaml', yml: 'text/yaml'
  };
  return map[ext] || 'text/plain';
}
function camel(id) { return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function renderMarkdownSync(text) {
  if (!smd) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }
  const d = document.createElement('div');
  const r = smd.default_renderer(d);
  const p = smd.parser(r);
  smd.parser_write(p, text);
  smd.parser_end(p);
  return d.innerHTML;
}

/* ── Main UI ────────────────────────────────────────────────────────────── */

export class UI {
  constructor() {
    this.conversation = null;
    this.messages = [];
    this.attachments = [];
    this.busy = false;
    this.abortCtrl = null;
    this.scrollToken = 0;

    this.$ = (id) => document.getElementById(id);
    this.#cache();
    Modal.init();
    this.sidebar = new Sidebar(this);
    this.#bind();
    this.#init();
  }

  #cache() {
    const ids = [
      'chat-container','user-input','send-btn','file-input','attach-btn',
      'attachment-preview','app-container','settings-btn','new-chat-btn',
      'convo-list','quick-model','files-btn'
    ];
    for (const id of ids) this['$' + camel(id)] = this.$(id);
  }

  #bind() {
    this.$sendBtn.addEventListener('click', () => this.#onSendOrStop());
    this.$userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.#onSendOrStop();
      }
    });
    this.$userInput.addEventListener('input', () => this.#autoGrowInput());

    this.$settingsBtn.addEventListener('click', () => this.sidebar.showSettings('general'));
    this.$newChatBtn.addEventListener('click', () => this.#newConversation());
    this.$filesBtn.addEventListener('click', () => this.sidebar.showFiles());

    this.$attachBtn.addEventListener('click', () => this.$fileInput.click());
    this.$fileInput.addEventListener('change', (e) => this.#handleFiles(e.target.files));
    this.$appContainer.addEventListener('dragover', (e) => {
      e.preventDefault(); this.$appContainer.classList.add('drag-active');
    });
    this.$appContainer.addEventListener('dragleave', (e) => {
      if (e.target === this.$appContainer) this.$appContainer.classList.remove('drag-active');
    });
    this.$appContainer.addEventListener('drop', (e) => {
      e.preventDefault(); this.$appContainer.classList.remove('drag-active');
      this.#handleFiles(e.dataTransfer.files);
    });

    this.$quickModel.addEventListener('change', () => this.#onQuickModelChange());

    // Intercept link clicks globally to open them in a new tab.
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (a.target === '_blank' || !/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      chrome.tabs.create({ url: href });
    });

    window.__modcoreReload = () => this.#reloadAll();
    window.__modcoreRefreshQuickModel = () => this.#refreshQuickModel();
  }

  async #init() {
    await this.#refreshQuickModel();
    const activeId = await Conversations.activeId();
    let conv = activeId ? await Conversations.get(activeId) : null;
    if (!conv) {
      const list = await Conversations.sorted();
      conv = list[0] || await Conversations.create();
    }
    await this.#loadConversation(conv);
    await this.#renderConvoList();
  }

  async #reloadAll() {
    const activeId = await Conversations.activeId();
    let conv = activeId ? await Conversations.get(activeId) : null;
    if (!conv) conv = await Conversations.create();
    await this.#loadConversation(conv);
    await this.#renderConvoList();
  }

  async #newConversation() {
    if (this.busy) this.abortCtrl?.abort();
    const c = await Conversations.create();
    await this.#loadConversation(c);
    await this.#renderConvoList();
  }

  async #loadConversation(c) {
    this.conversation = c;
    this.messages = c.messages ? [...c.messages] : [];
    await Conversations.setActive(c.id);
    this.#renderConversation();
    await this.sidebar.setConversation(c.id);
    await this.#renderConvoList();
  }

  async #switchConversation(id) {
    if (this.busy) this.abortCtrl?.abort();
    const c = await Conversations.get(id);
    if (c) await this.#loadConversation(c);
  }

  async #deleteConversation(id) {
    await Conversations.remove(id);
    if (this.conversation?.id === id) {
      const list = await Conversations.sorted();
      const next = list[0] || await Conversations.create();
      await this.#loadConversation(next);
    } else await this.#renderConvoList();
  }

  async #renderConvoList() {
    const list = await Conversations.sorted();
    const activeId = this.conversation?.id;
    this.$convoList.innerHTML = '';
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'convo-empty'; e.textContent = 'No conversations';
      this.$convoList.appendChild(e);
      return;
    }
    for (const c of list) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'convo-item' + (c.id === activeId ? ' active' : '');
      const t = document.createElement('span');
      t.className = 'convo-title'; t.textContent = c.title || 'New chat';
      const del = document.createElement('span');
      del.className = 'icon icon-trash convo-del'; del.title = 'Delete';
      del.addEventListener('click', (e) => { e.stopPropagation(); this.#deleteConversation(c.id); });
      item.append(t, del);
      item.addEventListener('click', () => this.#switchConversation(c.id));
      this.$convoList.appendChild(item);
    }
  }

  #renderConversation() {
    this.$chatContainer.innerHTML = '';
    if (!this.messages.length) { this.$chatContainer.appendChild(this.#emptyStateEl()); return; }
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i];
      if (m.role === 'user') this.#renderUserMessage(m, i);
      else this.#renderAssistantMessage(m, i);
    }
    this.#scrollToBottom();
  }

  #emptyStateEl() {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.innerHTML = `
      <h1>What should I do?</h1>
      <p>Ask modcore AI to manage tabs, bookmarks, extensions, or build something in the workspace.</p>
    `;
    return el;
  }

  #renderUserMessage(m, idx) {
    const el = document.createElement('div');
    el.className = 'message user';
    el.dataset.idx = idx;

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = m.content || '';
    el.appendChild(content);

    if (m.attachments && m.attachments.length) {
      const wrap = document.createElement('div');
      wrap.className = 'message-attachments';
      for (const a of m.attachments) {
        const chip = document.createElement('button');
        chip.type = 'button'; chip.className = 'file-chip';
        chip.textContent = a.name;
        chip.addEventListener('click', () => {
          this.sidebar.showFile(a.name, 'file');
        });
        wrap.appendChild(chip);
      }
      el.insertBefore(wrap, content);
    }

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.append(
      this.#actionIcon('copy', 'Copy', () => navigator.clipboard.writeText(m.content || '')),
      this.#actionIcon('edit', 'Edit', () => this.#editMessage(el, idx)),
      this.#actionIcon('refresh', 'Regenerate', () => this.#regenerateFrom(idx))
    );
    el.appendChild(actions);
    this.$chatContainer.appendChild(el);
  }

  #renderAssistantMessage(m, idx) {
    const el = document.createElement('div');
    el.className = 'message assistant';
    el.dataset.idx = idx;

    const content = document.createElement('div');
    content.className = 'message-content';
    const md = document.createElement('div');
    md.className = 'md-stream';
    md.innerHTML = m.content ? renderMarkdownSync(m.content) : '';
    content.appendChild(md);

    // Render file cards for any file tool calls.
    const fileCalls = (m.toolCalls || []).filter((t) =>
      t.ok && (t.name === 'files_write' || t.name === 'files_edit') && t.args?.path
    );
    if (fileCalls.length) {
      const cards = document.createElement('div');
      cards.className = 'file-cards';
      const seen = new Set();
      for (const t of fileCalls) {
        const p = t.args.path;
        if (seen.has(p)) continue;
        seen.add(p);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'file-card';
        const ext = (p.split('.').pop() || '').toLowerCase();
        card.innerHTML = `
          <span class="file-card-badge">${ext.slice(0, 4).toUpperCase() || 'FILE'}</span>
          <span class="file-card-body">
            <span class="file-card-path">${escapeHtml(p)}</span>
            <span class="file-card-meta">${t.name === 'files_edit' ? 'Edited' : 'Written'}</span>
          </span>
        `;
        card.addEventListener('click', () => this.sidebar.showFile(p, 'file'));
        cards.appendChild(card);
      }
      content.appendChild(cards);
    }

    el.appendChild(content);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.append(
      this.#actionIcon('copy', 'Copy', () => navigator.clipboard.writeText(m.content || '')),
      this.#actionIcon('refresh', 'Regenerate', () => this.#regenerateFrom(idx))
    );
    el.appendChild(actions);
    this.$chatContainer.appendChild(el);
    if (m.content) this.#highlightStatic(md);
  }

  #actionIcon(icon, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'msg-action'; b.title = label;
    b.innerHTML = `<span class="icon icon-${icon}"></span>`;
    b.addEventListener('click', onClick);
    return b;
  }

  async #highlightStatic(container) {
    if (!shj) return;
    for (const el of container.querySelectorAll('pre > code')) {
      const raw = (el.className || '').trim();
      try { await shj.highlightElement(el, raw || 'plain'); }
      catch { try { await shj.highlightElement(el, 'plain'); } catch {} }
    }
  }

  async #onSendOrStop() {
    if (this.busy) return this.abortCtrl?.abort();
    await this.#sendCurrent();
  }

  #autoGrowInput() {
    const el = this.$userInput;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  }

  async #handleFiles(files) {
    const remaining = LIMITS.MAX_FILES_PER_UPLOAD - this.attachments.length;
    const list = Array.from(files).slice(0, remaining);
    for (const file of list) {
      if (file.size > LIMITS.MAX_FILE_SIZE) {
        console.warn(`[modcore AI] "${file.name}" skipped (too large)`);
        continue;
      }
      const cls = await classifyFile(file);
      let rec;
      if (cls.kind === 'text') {
        const content = await readAsText(file);
        rec = { name: file.name, type: file.type, size: file.size,
                kind: 'text', ext: cls.ext, content };
      } else {
        const dataUrl = await readAsDataURL(file);
        rec = { name: file.name, type: file.type, size: file.size,
                kind: cls.kind, ext: cls.ext, dataUrl };
      }
      this.attachments.push(rec);
    }
    this.#renderAttachments();
  }

  #renderAttachments() {
    this.$attachmentPreview.innerHTML = '';
    this.attachments.forEach((att, idx) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      const name = document.createElement('span');
      name.textContent = att.name;
      name.addEventListener('click', () => this.sidebar.showFile(att.name, 'file'));
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'attachment-remove'; rm.textContent = '×';
      rm.addEventListener('click', () => { this.attachments.splice(idx, 1); this.#renderAttachments(); });
      chip.append(name, rm);
      this.$attachmentPreview.appendChild(chip);
    });
  }

  async #sendCurrent() {
    const text = this.$userInput.value.trim();
    if (!text && this.attachments.length === 0) return;

    this.$userInput.value = '';
    this.$userInput.style.height = 'auto';
    const attachments = this.attachments;
    this.attachments = [];
    this.#renderAttachments();

    const conv = await Conversations.get(this.conversation.id);
    const existingAtts = conv?.attachments || [];
    const merged = [...existingAtts, ...attachments.map((a) => ({
      name: a.name, type: a.type, size: a.size, kind: a.kind, ext: a.ext,
      content: a.kind === 'text' ? a.content : undefined,
      dataUrl: a.kind !== 'text' ? a.dataUrl : undefined
    }))];
    await Conversations.update(this.conversation.id, { attachments: merged });

    const userMsg = {
      role: 'user', content: text,
      attachments: attachments.map((a) => ({ name: a.name, type: a.type }))
    };
    this.messages.push(userMsg);
    await this.#persist();
    this.$chatContainer.querySelector('.empty-state')?.remove();
    this.#renderUserMessage(userMsg, this.messages.length - 1);
    await this.sidebar.setConversation(this.conversation.id);

    const cfg = await Config.get();
    if (!cfg.model) return this.#appendError('No model selected. Open Settings and pick one.');
    if (!cfg.baseUrl) return this.#appendError('No API base URL configured.');

    await this.#runEngine(cfg, attachments);
  }

  async #runEngine(cfg, attachments) {
    const profile = await Profile.get();

    const onFilesChanged = (toolName, args) => {
      // If the sidebar is showing a specific file that was just edited, refresh it.
      if (this.sidebar.mode === 'file' || this.sidebar.mode === 'file-history') {
        if (args?.path && args.path === this.sidebar.currentFile) {
          this.sidebar.render();
        }
      } else if (this.sidebar.isOpen()) {
        this.sidebar.render();
      } else {
        this.sidebar.showFiles();
      }
    };

    const engine = new Core.AIEngine(cfg, profile, this.conversation.id, onFilesChanged);
    const { el, cot, renderer } = this.#beginAssistantMessage();
    this.abortCtrl = new AbortController();
    this.#setBusy(true);

    let rawText = '';
    let cotClosed = false;
    let sidebarOpenedForTool = false;

    try {
      const result = await engine.send(
        this.#buildEngineMessages(),
        attachments,
        (update) => {
          if (update.type === 'reasoning') {
            cot.setReasoning(update.content);
          } else if (update.type === 'text') {
            if (!cotClosed) { cotClosed = true; cot.closeEarly(); }
            rawText = update.content;
            renderer.write(update.delta);
          } else if (update.type === 'tool_start') {
            cot.addToolStep(update.name, update.args);
            if (update.name.startsWith('files_') && !sidebarOpenedForTool) {
              sidebarOpenedForTool = true;
              this.sidebar.showLoading(update.name === 'files_write'
                ? `Writing ${update.args?.path || 'file'}…`
                : `Editing ${update.args?.path || 'file'}…`);
            }
          } else if (update.type === 'tool_end') {
            cot.settleToolStep(update.name, update.result);
          } else if (update.type === 'notice') {
            cot.addToolStep('notice', { message: update.message });
            cot.settleToolStep('notice', { ok: false, error: { message: update.message } });
          }
          this.#scrollToBottom();
        },
        this.abortCtrl.signal
      );

      // Store tool calls on the message.
      if (result?.toolCalls?.length) {
        this.pendingToolCalls = result.toolCalls;
      }
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'Stopped by user.' : (err?.message || String(err));
      cot.addToolStep('error', { message: msg });
      cot.settleToolStep('error', { ok: false, error: { message: msg } });
    } finally {
      renderer.end();
      cot.finish();
      this.#setBusy(false);
      this.sidebar.clearLoading();

      const toolCalls = this.pendingToolCalls || [];
      this.pendingToolCalls = null;

      if (rawText || toolCalls.length) {
        this.messages.push({ role: 'assistant', content: rawText, toolCalls });
        await this.#persist();
      }
      this.#attachAssistantActions(el, this.messages.length - 1, toolCalls);
      this.#scrollToBottom();

      const after = await Conversations.get(this.conversation.id);
      if (after && (after.title === 'New chat' || !after.title)) {
        const firstUser = this.messages.find((m) => m.role === 'user');
        const title = await generateTitle(cfg, firstUser?.content || '', rawText);
        await Conversations.update(this.conversation.id, { title });
        this.conversation.title = title;
        await this.#renderConvoList();
      }
    }
  }

  #buildEngineMessages() {
    return this.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  async #persist() {
    if (!this.conversation) return;
    await Conversations.update(this.conversation.id, { messages: this.messages });
    this.conversation.messages = this.messages;
  }

  #setBusy(busy) {
    this.busy = busy;
    this.$sendBtn.classList.toggle('stopping', busy);
    this.$sendBtn.innerHTML = busy
      ? '<span class="icon icon-stop"></span>'
      : '<span class="icon icon-arrow-up"></span>';
    this.$userInput.disabled = busy;
  }

  #beginAssistantMessage() {
    const el = document.createElement('div');
    el.className = 'message assistant';
    const cotHost = document.createElement('div');
    cotHost.className = 'cot-host';
    const content = document.createElement('div');
    content.className = 'message-content';
    const md = document.createElement('div');
    md.className = 'md-stream';
    content.appendChild(md);
    el.append(cotHost, content);
    this.$chatContainer.appendChild(el);
    this.#scrollToBottom();
    const cot = new ChainOfThought(cotHost);
    const renderer = new StreamingRenderer(md);
    renderer.start();
    return { el, cot, renderer };
  }

  #attachAssistantActions(el, idx, toolCalls) {
    if (el.querySelector('.msg-actions')) return;
    const content = el.querySelector('.message-content');

    // Render file cards too.
    const fileCalls = (toolCalls || []).filter((t) =>
      t.ok && (t.name === 'files_write' || t.name === 'files_edit') && t.args?.path
    );
    if (fileCalls.length) {
      const cards = document.createElement('div');
      cards.className = 'file-cards';
      const seen = new Set();
      for (const t of fileCalls) {
        const p = t.args.path;
        if (seen.has(p)) continue;
        seen.add(p);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'file-card';
        const ext = (p.split('.').pop() || '').toLowerCase();
        card.innerHTML = `
          <span class="file-card-badge">${ext.slice(0, 4).toUpperCase() || 'FILE'}</span>
          <span class="file-card-body">
            <span class="file-card-path">${escapeHtml(p)}</span>
            <span class="file-card-meta">${t.name === 'files_edit' ? 'Edited' : 'Written'}</span>
          </span>
        `;
        card.addEventListener('click', () => this.sidebar.showFile(p, 'file'));
        cards.appendChild(card);
      }
      content.appendChild(cards);
    }

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.append(
      this.#actionIcon('copy', 'Copy', () => {
        navigator.clipboard.writeText(this.messages[idx]?.content || '');
      }),
      this.#actionIcon('refresh', 'Regenerate', () => this.#regenerateFrom(idx))
    );
    content.appendChild(actions);
  }

  #appendError(message) {
    this.$chatContainer.querySelector('.empty-state')?.remove();
    const el = document.createElement('div');
    el.className = 'message assistant';
    const c = document.createElement('div');
    c.className = 'message-content error-content';
    c.textContent = message;
    el.appendChild(c);
    this.$chatContainer.appendChild(el);
    this.#scrollToBottom();
  }

  #editMessage(el, idx) {
    const original = this.messages[idx];
    if (!original || original.role !== 'user') return;
    const content = el.querySelector('.message-content');
    const current = original.content || '';
    content.innerHTML = '';
    const ta = document.createElement('textarea');
    ta.className = 'edit-ta';
    ta.value = current;
    const row = document.createElement('div');
    row.className = 'edit-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.#renderConversation());
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = 'Save & resend';
    save.addEventListener('click', async () => {
      const newText = ta.value.trim();
      if (!newText) return;
      this.messages = this.messages.slice(0, idx);
      this.messages.push({ ...original, content: newText });
      await this.#persist();
      this.#renderConversation();
      const cfg = await Config.get();
      if (!cfg.model) return this.#appendError('No model selected.');
      await this.#runEngine(cfg, []);
    });
    row.append(cancel, save);
    content.append(ta, row);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  async #regenerateFrom(idx) {
    if (this.busy) return;
    const target = this.messages[idx];
    if (!target) return;
    this.messages = this.messages.slice(0, idx);
    await this.#persist();
    this.#renderConversation();
    const cfg = await Config.get();
    if (!cfg.model) return this.#appendError('No model selected.');
    await this.#runEngine(cfg, []);
  }

  #scrollToBottom() {
    const el = this.$chatContainer;
    const token = ++this.scrollToken;
    requestAnimationFrame(() => {
      if (token !== this.scrollToken) return;
      el.scrollTop = el.scrollHeight;
    });
  }

  async #refreshQuickModel() {
    const cfg = await Config.get();
    this.$quickModel.innerHTML = '';
    if (cfg.model) {
      const o = document.createElement('option');
      o.value = o.textContent = cfg.model; o.selected = true;
      this.$quickModel.appendChild(o);
    } else {
      const o = document.createElement('option');
      o.value = ''; o.textContent = 'No model — open Settings';
      o.disabled = true; o.selected = true;
      this.$quickModel.appendChild(o);
    }
  }

  async #onQuickModelChange() {
    if (this.$quickModel.value) await Config.set({ model: this.$quickModel.value });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  try {
    window.app = new UI();
  } catch (err) {
    console.error('[modcore AI] boot failure:', err);
    document.body.innerHTML = `
      <pre style="padding:32px;font:14px/1.5 ui-monospace,monospace;color:#F0EFEC;background:#151515;min-height:100vh;margin:0;white-space:pre-wrap;">
modcore AI failed to start.

${err?.stack || err?.message || String(err)}
      </pre>`;
  }
});