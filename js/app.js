/* ============================================================================
   modcore AI — app.js  (non-UI core)
   ========================================================================== */

import { ToolRegistry } from '../tools/index.js';

/* ── Constants ──────────────────────────────────────────────────────────── */

export const KEYS = {
  CONFIG:  'modcore_config',
  CONVOS:  'modcore_conversations',
  ACTIVE:  'modcore_active',
  MEMORY:  'modcore_memory',
  PROFILE: 'modcore_profile'
};

export const LIMITS = {
  MAX_FILES_PER_UPLOAD: 50,
  MAX_FILE_SIZE: 15 * 1024 * 1024,
  MAX_TOOL_STEPS: 100,
  TOOL_TIMEOUT_MS: 20_000,
  LOOP_WINDOW: 4
};

const DEFAULT_CONFIG = Object.freeze({
  apiKey: '',
  baseUrl: 'http://localhost:1234/v1',
  model: '',
  temperature: 0.7,
  maxToolSteps: LIMITS.MAX_TOOL_STEPS,
  webSearchApiKey: '',
  security: {
    allowWebFetch: true
  }
});

const DEFAULT_PROFILE = Object.freeze({
  displayName: ''
});

/* ── System prompt builder ──────────────────────────────────────────────── */

function buildSystemInstruction(profile, config) {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const tzOffsetMin = -now.getTimezoneOffset();
  const tzSign = tzOffsetMin >= 0 ? '+' : '-';
  const tzAbs = Math.abs(tzOffsetMin);
  const tzStr = `UTC${tzSign}${String(Math.floor(tzAbs / 60)).padStart(2, '0')}:${String(tzAbs % 60).padStart(2, '0')}`;

  const lines = [
    'You are modcore AI, an autonomous agent with native Chrome browser tools',
    'and a persistent workspace of files you can create, read, and update.',
    '',
    '## About the user'
  ];

  if (profile.displayName) {
    lines.push(`- The user's name is **${profile.displayName}**. Address them by name when natural.`);
    lines.push(`- You are helping them personally; keep the tone warm but efficient.`);
  } else {
    lines.push('- The user has not set a display name.');
  }

  lines.push('');
  lines.push('## Current context');
  lines.push(`- Current time: ${now.toISOString()}`);
  lines.push(`- Local time: ${now.toLocaleString()}`);
  lines.push(`- Timezone: ${tz} (${tzStr})`);

  lines.push('');
  lines.push('## Behavior');
  lines.push('- Break complex tasks into multiple tool calls.');
  lines.push('- Briefly explain what you are about to do before calling a tool.');
  lines.push('- When you produce a substantial code file, use `files_write` so the user can view and download it.');
  lines.push('- For code edits, prefer `files_edit` — it modifies specific lines and creates a version entry.');
  lines.push('- Each `files_write` / `files_edit` call accepts a `message` — a short commit message describing the change.');
  lines.push('- If a tool returns `{ ok:false, error }`, explain the failure in plain language and suggest a next step.');
  lines.push('- You may use `web_fetch` to read any HTTP API or URL, and `web_search` for web search.');

  return lines.join('\n');
}

/* ── Confirm handler registration ───────────────────────────────────────── */

let _confirmHandler = null;
export function registerConfirmHandler(fn) { _confirmHandler = fn; }

/* ── Config ─────────────────────────────────────────────────────────────── */

export const Config = {
  async get() {
    try {
      const s = await chrome.storage.local.get(KEYS.CONFIG);
      const stored = s[KEYS.CONFIG] || {};
      return {
        ...DEFAULT_CONFIG,
        ...stored,
        security: { ...DEFAULT_CONFIG.security, ...(stored.security || {}) }
      };
    } catch (e) {
      console.error('[modcore AI] config read failed:', e);
      return { ...DEFAULT_CONFIG };
    }
  },
  async set(patch) {
    const cur = await this.get();
    const next = { ...cur, ...patch };
    await chrome.storage.local.set({ [KEYS.CONFIG]: next });
    return next;
  }
};

/* ── Profile ─────────────────────────────────────────────────────────────── */

export const Profile = {
  async get() {
    const s = await chrome.storage.local.get(KEYS.PROFILE);
    return { ...DEFAULT_PROFILE, ...(s[KEYS.PROFILE] || {}) };
  },
  async set(patch) {
    const cur = await this.get();
    const next = { ...cur, ...patch };
    await chrome.storage.local.set({ [KEYS.PROFILE]: next });
    return next;
  }
};

/* ── Memory ──────────────────────────────────────────────────────────────── */

export const Memory = {
  async all() {
    const s = await chrome.storage.local.get(KEYS.MEMORY);
    return s[KEYS.MEMORY] || {};
  },
  async get(key) { return (await this.all())[key]?.value ?? null; },
  async set(key, v) {
    const m = await this.all();
    m[key] = { value: v, updatedAt: Date.now() };
    await chrome.storage.local.set({ [KEYS.MEMORY]: m });
    return { key, value: v };
  },
  async delete(key) {
    const m = await this.all();
    delete m[key];
    await chrome.storage.local.set({ [KEYS.MEMORY]: m });
    return { key, deleted: true };
  },
  async list() {
    const m = await this.all();
    return Object.entries(m).map(([k, v]) => ({ key: k, value: v.value, updatedAt: v.updatedAt }));
  }
};

/* ── Conversations ──────────────────────────────────────────────────────── */

let _convosCache = null;

export const Conversations = {
  async _read() {
    if (_convosCache) return _convosCache;
    const s = await chrome.storage.local.get(KEYS.CONVOS);
    _convosCache = s[KEYS.CONVOS] || {};
    return _convosCache;
  },
  async _write() { await chrome.storage.local.set({ [KEYS.CONVOS]: _convosCache }); },
  async create() {
    const all = await this._read();
    const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const c = { id, title: 'New chat', createdAt: now, updatedAt: now,
                messages: [], attachments: [], files: {} };
    all[id] = c;
    await this._write();
    await chrome.storage.local.set({ [KEYS.ACTIVE]: id });
    return c;
  },
  async get(id) { return (await this._read())[id] || null; },
  async activeId() {
    const s = await chrome.storage.local.get(KEYS.ACTIVE);
    return s[KEYS.ACTIVE] || null;
  },
  async setActive(id) { await chrome.storage.local.set({ [KEYS.ACTIVE]: id }); },
  async update(id, patch) {
    const all = await this._read();
    if (!all[id]) return null;
    all[id] = { ...all[id], ...patch, updatedAt: Date.now() };
    await this._write();
    return all[id];
  },
  async remove(id) {
    const all = await this._read();
    delete all[id];
    await this._write();
  },
  async sorted() {
    const all = await this._read();
    return Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async clearAll() {
    _convosCache = {};
    await chrome.storage.local.set({ [KEYS.CONVOS]: {} });
    await chrome.storage.local.remove(KEYS.ACTIVE);
  }
};

/* ── Attachment classification ──────────────────────────────────────────── */

const TEXT_EXTS = new Set([
  'txt','md','markdown','mdx','js','mjs','cjs','ts','tsx','jsx','py','rb','go','rs',
  'c','h','cc','cpp','hpp','cxx','cs','java','kt','swift','php','html','htm','css',
  'scss','sass','less','json','jsonc','json5','yaml','yml','toml','xml','svg','sh',
  'bash','zsh','fish','sql','graphql','gql','vue','svelte','astro','lua','pl','r',
  'dart','scala','clj','cljs','ex','exs','erl','hs','ml','mli','nim','zig','v',
  'vb','ps1','bat','cmd','ini','cfg','conf','env','gitignore','dockerignore',
  'dockerfile','makefile','cmake','gradle','lock','log','csv','tsv'
]);

async function sniffBinary(file) {
  try {
    const buf = await file.slice(0, 512).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let nonText = 0;
    for (const b of bytes) {
      if (b === 0) return true;
      if (b < 9 || (b > 13 && b < 32 && b !== 27)) nonText++;
    }
    return nonText / bytes.length > 0.15;
  } catch { return false; }
}

export async function classifyFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = file.type || '';
  if (mime.startsWith('image/')) return { kind: 'image', ext, mime };
  if (mime.startsWith('text/'))  return { kind: 'text',  ext, mime };
  if (TEXT_EXTS.has(ext))        return { kind: 'text',  ext, mime };
  if (ext === 'pdf')             return { kind: 'binary', ext, mime };
  const bin = await sniffBinary(file);
  return { kind: bin ? 'binary' : 'text', ext, mime };
}

export function readAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

export function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/* ── Workspace (files + versions) ──────────────────────────────────────── */

function nowId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function guessLang(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    js:'js', mjs:'js', cjs:'js', ts:'ts', tsx:'tsx', jsx:'jsx', py:'py',
    rb:'rb', go:'go', rs:'rs', c:'c', h:'c', cpp:'cpp', hpp:'cpp',
    cs:'cs', java:'java', kt:'kt', swift:'swift', php:'php', html:'html',
    htm:'html', css:'css', scss:'scss', less:'less', json:'json',
    yaml:'yaml', yml:'yaml', toml:'toml', xml:'xml', svg:'xml',
    sh:'bash', bash:'bash', zsh:'bash', sql:'sql', md:'md', markdown:'md'
  };
  return map[ext] || 'plain';
}

function countLines(text) {
  if (!text) return 0;
  return text.split('\n').length;
}

export const Workspace = {
  /**
   * Create or replace a file. Adds a new version entry.
   */
  async writeFile(convId, path, content, lang, message) {
    const conv = await Conversations.get(convId);
    if (!conv) return null;
    const files = { ...(conv.files || {}) };
    const existing = files[path];
    const now = Date.now();
    const version = {
      id: nowId('v'),
      message: message || (existing ? 'Update' : 'Create'),
      content,
      createdAt: now,
      type: existing ? 'edit' : 'create',
      lines: countLines(content)
    };
    files[path] = {
      path,
      content,
      lang: lang || guessLang(path),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      versions: [...(existing?.versions || []), version]
    };
    await Conversations.update(convId, { files });
    return files[path];
  },

  /**
   * Edit lines [startLine, endLine] (1-indexed, inclusive) of a file.
   * Returns the updated file or null.
   */
  async editFileLines(convId, path, startLine, endLine, newContent, message) {
    const conv = await Conversations.get(convId);
    const file = conv?.files?.[path];
    if (!file) return { error: `No file at "${path}"` };
    const lines = file.content.split('\n');
    const start = Math.max(0, (startLine | 0) - 1);
    const end = Math.min(lines.length, endLine | 0);
    if (start > end) return { error: 'Invalid line range' };
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    const mid = newContent.split('\n');
    const next = [...before, ...mid, ...after].join('\n');
    return await this._applyEdit(convId, path, next, message, 'edit',
      `replaced lines ${startLine}-${endLine}`);
  },

  /**
   * Search-replace: exact oldText → newText.
   */
  async editFileSearch(convId, path, oldText, newText, message) {
    const conv = await Conversations.get(convId);
    const file = conv?.files?.[path];
    if (!file) return { error: `No file at "${path}"` };
    const idx = file.content.indexOf(oldText);
    if (idx === -1) return { error: 'Text not found in file' };
    const next = file.content.slice(0, idx) + newText + file.content.slice(idx + oldText.length);
    return await this._applyEdit(convId, path, next, message, 'edit', 'search-replace');
  },

  async _applyEdit(convId, path, nextContent, message, type, note) {
    const conv = await Conversations.get(convId);
    const files = { ...(conv.files || {}) };
    const file = files[path];
    if (!file) return { error: `No file at "${path}"` };
    const now = Date.now();
    const version = {
      id: nowId('v'),
      message: message || 'Edit',
      content: nextContent,
      createdAt: now,
      type,
      note,
      lines: countLines(nextContent)
    };
    files[path] = {
      ...file,
      content: nextContent,
      updatedAt: now,
      versions: [...(file.versions || []), version]
    };
    await Conversations.update(convId, { files });
    return files[path];
  },

  async deleteFile(convId, path) {
    const conv = await Conversations.get(convId);
    if (!conv) return null;
    const files = { ...(conv.files || {}) };
    delete files[path];
    await Conversations.update(convId, { files });
    return { deleted: path };
  },

  async readFile(convId, path) {
    return (await Conversations.get(convId))?.files?.[path] || null;
  },

  async listFiles(convId) {
    return Object.values((await Conversations.get(convId))?.files || {});
  },

  async restoreVersion(convId, path, versionId) {
    const conv = await Conversations.get(convId);
    const file = conv?.files?.[path];
    if (!file) return { error: 'File not found' };
    const v = (file.versions || []).find((x) => x.id === versionId);
    if (!v) return { error: 'Version not found' };
    const files = { ...(conv.files || {}) };
    const now = Date.now();
    files[path] = {
      ...file,
      content: v.content,
      updatedAt: now,
      versions: [...(file.versions || []), {
        id: nowId('v'),
        message: `Restored from ${new Date(v.createdAt).toLocaleString()}`,
        content: v.content,
        createdAt: now,
        type: 'restore',
        lines: countLines(v.content)
      }]
    };
    await Conversations.update(convId, { files });
    return files[path];
  }
};

/* ── SSE reader ──────────────────────────────────────────────────────────── */

async function* readSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line === 'data: [DONE]') continue;
      if (!line.startsWith('data: ')) continue;
      try { yield JSON.parse(line.slice(6)); }
      catch { console.warn('[SSE] bad JSON:', line); }
    }
  }
}

/* ── Streaming tool call accumulator ────────────────────────────────────── */

class ToolCallAccumulator {
  constructor() { this.calls = new Map(); }
  add(deltas) {
    for (const tc of deltas) {
      const idx = tc.index ?? 0;
      if (!this.calls.has(idx)) this.calls.set(idx, { id: '', name: '', buf: '' });
      const e = this.calls.get(idx);
      if (tc.id)        e.id   = tc.id;
      if (tc.name)      e.name = tc.name;
      if (tc.arguments) e.buf += tc.arguments;
    }
  }
  hasCalls() { return this.calls.size > 0; }
  finalize() {
    const out = [];
    for (const [, e] of this.calls) {
      let args = {};
      try { args = e.buf ? JSON.parse(e.buf) : {}; }
      catch {}
      const id = e.id || `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      out.push({ id, name: e.name, args });
    }
    this.calls.clear();
    return out;
  }
}

/* ── Think tag parser ───────────────────────────────────────────────────── */

class ThinkTagParser {
  constructor() { this.inThink = false; this.buf = ''; }
  feed(chunk) {
    this.buf += chunk;
    let text = '', thinking = '';
    let progress = true;
    while (progress) {
      progress = false;
      if (!this.inThink) {
        const open = this.buf.indexOf('<think>');
        if (open === -1) {
          const tailIdx = this.buf.lastIndexOf('<');
          const tail = tailIdx >= 0 ? this.buf.slice(tailIdx) : '';
          if (tail && '<think>'.startsWith(tail)) {
            text += this.buf.slice(0, tailIdx);
            this.buf = tail;
          } else { text += this.buf; this.buf = ''; }
          break;
        }
        text += this.buf.slice(0, open);
        this.buf = this.buf.slice(open + 7);
        this.inThink = true;
        progress = true;
      } else {
        const close = this.buf.indexOf('</think>');
        if (close === -1) { thinking += this.buf; this.buf = ''; break; }
        thinking += this.buf.slice(0, close);
        this.buf = this.buf.slice(close + 8);
        this.inThink = false;
        progress = true;
      }
    }
    return { text, thinking };
  }
}

/* ── Model catalog (OpenAI-compatible only) ────────────────────────────── */

export async function fetchModels(cfg, signal) {
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Base URL is required');
  const headers = {};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetch(`${base}/models`, { headers, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  const data = await res.json();
  const raw = Array.isArray(data?.data) ? data.data
            : Array.isArray(data?.models) ? data.models : [];
  return raw.map((m) => {
    const id = m.id || m.name || m.model;
    return id ? { id, label: id } : null;
  }).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}

/* ── ToolRunner ─────────────────────────────────────────────────────────── */

class ToolRunner {
  constructor(registry, ctx) {
    this.registry = registry;
    this.ctx = ctx;
  }

  async run(name, rawArgs, { signal } = {}) {
    const tool = this.registry.get(name);
    if (!tool) return fail('unknown_tool', `No such tool: ${name}`);
    const v = validateArgs(tool.parameters, rawArgs);
    if (!v.ok) return fail('invalid_arguments', v.error);
    const args = v.value;

    if (tool.risk === 'high') {
      if (!_confirmHandler) return fail('no_confirm_handler', 'Confirmation handler not registered.');
      const msg = typeof tool.confirmMessage === 'function'
        ? tool.confirmMessage(args)
        : `Run "${name}" with:\n${JSON.stringify(args, null, 2)}`;
      const ok = await _confirmHandler({ title: 'Confirm action', message: msg });
      if (!ok) return fail('user_denied', 'User denied the action.');
    }

    const timeoutMs = tool.timeoutMs ?? LIMITS.TOOL_TIMEOUT_MS;
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(
      () => timeoutCtrl.abort(new DOMException('timeout', 'TimeoutError')),
      timeoutMs
    );
    const merged = combineSignals(signal, timeoutCtrl.signal);

    try {
      const data = await tool.handler(args, merged, this.ctx);
      if (tool.category === 'files') {
        try { this.ctx?.onFilesChanged?.(name, args, data); } catch (e) { console.warn(e); }
      }
      return { ok: true, data };
    } catch (err) {
      const code = err?.name === 'TimeoutError' ? 'timeout'
                 : err?.name === 'AbortError'   ? 'aborted'
                 : 'execution_error';
      return fail(code, err?.message || String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}

function fail(code, message) { return { ok: false, error: { code, message } }; }

function validateArgs(schema, raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const props = schema?.properties || {};
  const required = new Set(schema?.required || []);
  const out = {};
  for (const [key, def] of Object.entries(props)) {
    const val = src[key];
    const missing = val === undefined || val === null || val === '';
    if (missing) {
      if (required.has(key)) return { ok: false, error: `Missing required "${key}"` };
      continue;
    }
    const coerced = coerce(def.type, val);
    if (coerced === undefined)
      return { ok: false, error: `Bad value for "${key}" (expected ${def.type})` };
    out[key] = coerced;
  }
  return { ok: true, value: out };
}

function coerce(type, v) {
  switch (String(type || '').toLowerCase()) {
    case 'string':  return typeof v === 'string' ? v : String(v);
    case 'number':  { const n = Number(v);       return Number.isFinite(n) ? n : undefined; }
    case 'integer': { const n = parseInt(v, 10); return Number.isFinite(n) ? n : undefined; }
    case 'boolean':
      if (typeof v === 'boolean') return v;
      if (v === 'true'  || v === 1 || v === '1')  return true;
      if (v === 'false' || v === 0 || v === '0')  return false;
      return undefined;
    case 'array':   return Array.isArray(v) ? v : undefined;
    case 'object':  return typeof v === 'object' && v !== null ? v : undefined;
    default:        return v;
  }
}

function combineSignals(...signals) {
  const valid = signals.filter(Boolean);
  if (valid.length === 0) return new AbortController().signal;
  if (valid.length === 1) return valid[0];
  const ctrl = new AbortController();
  for (const s of valid) {
    if (s.aborted) { ctrl.abort(s.reason); break; }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/* ── Loop detector ──────────────────────────────────────────────────────── */

class LoopDetector {
  constructor(window = LIMITS.LOOP_WINDOW) {
    this.window = window;
    this.history = [];
  }
  push(name, args) {
    let sig;
    try { sig = `${name}|${JSON.stringify(args, Object.keys(args || {}).sort())}`; }
    catch { sig = `${name}|${JSON.stringify(args)}`; }
    this.history.push(sig);
    if (this.history.length > this.window) this.history.shift();
    return this.history.length === this.window &&
           this.history.every((x) => x === this.history[0]);
  }
}

function stableStringify(v) {
  try { return JSON.stringify(v, Object.keys(v || {}).sort()); }
  catch { return JSON.stringify(v); }
}

/* ── AIEngine (OpenAI-compatible only) ──────────────────────────────────── */

export class AIEngine {
  constructor(config, profile, convId, onFilesChanged) {
    this.config = config;
    this.profile = profile;
    this.convId = convId;
    this.registry = ToolRegistry.getInstance();
    this.runner = new ToolRunner(this.registry, { convId, config, onFilesChanged });
    this.loop = new LoopDetector();
    this.systemInstruction = buildSystemInstruction(profile, config);
  }

  async send(messages, attachments, onEvent, signal) {
    const maxSteps = Math.min(
      this.config.maxToolSteps || LIMITS.MAX_TOOL_STEPS,
      LIMITS.MAX_TOOL_STEPS
    );
    let steps = 0;
    let firstIteration = true;
    let lastText = '';
    const toolCallsRecorded = [];

    while (steps < maxSteps) {
      steps++;
      const acc = new ToolCallAccumulator();
      const parser = new ThinkTagParser();
      let fullText = '', reasoning = '';

      const stream = this.#streamOpenAI(messages, firstIteration ? attachments : [], signal);

      for await (const chunk of stream) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (chunk.type === 'text') {
          const parsed = parser.feed(chunk.text);
          if (parsed.thinking) {
            reasoning += parsed.thinking;
            onEvent({ type: 'reasoning', content: reasoning });
          }
          if (parsed.text) {
            fullText += parsed.text;
            onEvent({ type: 'text', content: fullText, delta: parsed.text });
          }
        } else if (chunk.type === 'reasoning') {
          reasoning += chunk.text;
          onEvent({ type: 'reasoning', content: reasoning });
        } else if (chunk.type === 'tool_call') {
          acc.add([chunk.toolCall]);
        } else if (chunk.type === 'error') {
          throw new Error(chunk.message);
        }
      }

      firstIteration = false;
      lastText = fullText;

      if (!acc.hasCalls()) {
        return { text: fullText, toolCalls: toolCallsRecorded };
      }

      const calls = acc.finalize();

      for (const c of calls) {
        if (this.loop.push(c.name, c.args)) {
          onEvent({ type: 'notice',
            message: `Loop detected on "${c.name}" — stopping.` });
          return { text: fullText, toolCalls: toolCallsRecorded };
        }
      }

      const needsSerial = calls.some((c) =>
        this.registry.get(c.name)?.risk === 'high'
      );
      const results = needsSerial
        ? await this.#runSerial(calls, onEvent, signal)
        : await this.#runParallel(calls, onEvent, signal);

      for (let i = 0; i < calls.length; i++) {
        const t = this.registry.get(calls[i].name);
        toolCallsRecorded.push({
          name: calls[i].name,
          args: calls[i].args,
          ok: results[i]?.ok === true,
          category: t?.category || null
        });
      }

      this.#appendToolTurns(messages, calls, results, fullText);
    }

    onEvent({ type: 'notice', message: `Stopped after ${maxSteps} tool steps.` });
    return { text: lastText, toolCalls: toolCallsRecorded };
  }

  async #runParallel(calls, onEvent, signal) {
    for (const c of calls) onEvent({ type: 'tool_start', name: c.name, args: c.args });
    return Promise.all(calls.map(async (c) => {
      const r = await this.runner.run(c.name, c.args, { signal });
      onEvent({ type: 'tool_end', name: c.name, result: r });
      return r;
    }));
  }

  async #runSerial(calls, onEvent, signal) {
    const out = [];
    for (const c of calls) {
      onEvent({ type: 'tool_start', name: c.name, args: c.args });
      const r = await this.runner.run(c.name, c.args, { signal });
      onEvent({ type: 'tool_end', name: c.name, result: r });
      out.push(r);
    }
    return out;
  }

  #appendToolTurns(messages, calls, results, assistantText) {
    messages.push({
      role: 'assistant',
      content: assistantText || null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args) }
      }))
    });
    for (let i = 0; i < calls.length; i++) {
      messages.push({
        role: 'tool',
        tool_call_id: calls[i].id,
        content: JSON.stringify(results[i])
      });
    }
  }

  async *#streamOpenAI(messages, attachments, signal) {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/chat/completions`;

    const formatted = messages.map((m) => {
      if (m.role === 'assistant' && m.tool_calls) return m;
      if (m.role === 'tool') return m;
      if (typeof m.content === 'string' || Array.isArray(m.content)) return m;
      return { role: m.role, content: '' };
    });

    if (attachments.length > 0) {
      const last = formatted[formatted.length - 1];
      if (last?.role === 'user' && typeof last.content === 'string') {
        const blocks = [];
        if (last.content) blocks.push({ type: 'text', text: last.content });
        for (const a of attachments) {
          if (a.kind === 'image') {
            blocks.push({ type: 'image_url', image_url: { url: a.dataUrl } });
          } else if (a.kind === 'text') {
            blocks.push({ type: 'text',
              text: `\n\n--- File: ${a.name} ---\n${a.content}` });
          } else {
            blocks.push({ type: 'text',
              text: `\n\n--- Attached file: ${a.name} (${a.mime || 'binary'}) ---` });
          }
        }
        if (blocks.length) last.content = blocks;
      }
    }

    const tools = this.registry.toOpenAITools();
    const body = {
      model: this.config.model,
      messages: [{ role: 'system', content: this.systemInstruction }, ...formatted],
      tools: tools.length ? tools : undefined,
      temperature: this.config.temperature,
      stream: true
    };

    const headers = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;

    let res;
    try {
      res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (err) {
      throw new Error(`Network error reaching ${endpoint}: ${err.message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} from ${endpoint}\n${text.slice(0, 500)}`);
    }

    for await (const data of readSSE(res)) {
      const delta = data.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content };
      if (delta.content)           yield { type: 'text',      text: delta.content };
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield { type: 'tool_call', toolCall: {
            index: tc.index ?? 0, id: tc.id,
            name: tc.function?.name, arguments: tc.function?.arguments
          }};
        }
      }
    }
  }
}

/* ── Title generation ───────────────────────────────────────────────────── */

export async function generateTitle(config, userText, assistantText) {
  const fallback = (userText || 'New chat').split('\n')[0].slice(0, 48).trim();
  if (!config.model || !config.baseUrl) return fallback;

  const prompt =
    'Write a very short title (max 5 words, no quotes, no period) for this conversation.\n\n' +
    `User: ${(userText || '').slice(0, 500)}\n\nAssistant: ${(assistantText || '').slice(0, 500)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    const base = config.baseUrl.replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers, signal: ctrl.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3, max_tokens: 24, stream: false
      })
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    return sanitizeTitle(data.choices?.[0]?.message?.content || '') || fallback;
  } catch { return fallback; }
  finally { clearTimeout(timer); }
}

function sanitizeTitle(s) {
  return (s || '')
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/* ── Storage estimator ──────────────────────────────────────────────────── */

export async function estimateStorage() {
  const out = {
    total: 0, limit: 0, breakdown: {}, extensionBytes: 0,
    categories: [
      { id: 'conversations', label: 'Conversations' },
      { id: 'attachments',   label: 'Attachments' },
      { id: 'memory',        label: 'Memory' },
      { id: 'config',        label: 'Settings' },
      { id: 'other',         label: 'Other' }
    ]
  };

  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      out.total = est.usage || 0;
      out.limit = est.quota || 0;
    }
  } catch {}

  try {
    const all = await chrome.storage.local.get(null);
    out.extensionBytes = new Blob([JSON.stringify(all)]).size;

    const convos = all[KEYS.CONVOS] || {};
    let convosBytes = 0, attachBytes = 0;
    for (const c of Object.values(convos)) {
      const { attachments = [], ...rest } = c;
      convosBytes += new Blob([JSON.stringify(rest)]).size;
      attachBytes += new Blob([JSON.stringify(attachments)]).size;
    }
    out.breakdown.conversations = convosBytes;
    out.breakdown.attachments   = attachBytes;
    out.breakdown.memory        = new Blob([JSON.stringify(all[KEYS.MEMORY]  || {})]).size;
    out.breakdown.config        = new Blob([JSON.stringify(all[KEYS.CONFIG]  || {})]).size
                                + new Blob([JSON.stringify(all[KEYS.PROFILE] || {})]).size;
  } catch (e) {
    console.warn('[modcore AI] storage estimate failed:', e);
  }

  const used = Object.values(out.breakdown).reduce((a, b) => a + b, 0);
  out.breakdown.other = Math.max(0, out.extensionBytes - used);
  return out;
}