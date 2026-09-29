import { Workspace } from '../js/app.js';

export const filesTool = {
  id: 'files',
  title: 'Workspace files',
  description: 'Create, edit, read, and manage versioned files in the conversation workspace.',
  tools: [
    {
      name: 'files_write',
      description:
        'Create or overwrite a workspace file. Adds a new version to the file\'s history. ' +
        'Use for new files or full rewrites. For small edits, prefer files_edit.',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: 'File path, e.g. src/index.js' },
          content: { type: 'string', description: 'Full file contents' },
          lang:    { type: 'string', description: 'Optional language hint (js, py, …)' },
          message: { type: 'string', description: 'Short commit message describing the change' }
        },
        required: ['path', 'content']
      },
      risk: 'low',
      category: 'files',
      async handler({ path, content, lang, message }, _signal, ctx) {
        if (!ctx?.convId) return { ok: false, error: { code: 'no_conversation', message: 'No active conversation' } };
        const f = await Workspace.writeFile(ctx.convId, path, content, lang, message);
        if (!f) return { ok: false, error: { code: 'write_failed', message: 'Write failed' } };
        return { path: f.path, bytes: content.length, lang: f.lang, versions: f.versions.length };
      }
    },
    {
      name: 'files_edit',
      description:
        'Edit specific lines of a workspace file. Provide either (start_line, end_line, new_content) ' +
        'for line-range replacement, or (old_text, new_text) for search-replace. ' +
        'Creates a new version with your commit message.',
      parameters: {
        type: 'object',
        properties: {
          path:        { type: 'string' },
          start_line:  { type: 'integer', description: 'First line to replace (1-indexed, inclusive)' },
          end_line:    { type: 'integer', description: 'Last line to replace (1-indexed, inclusive)' },
          new_content: { type: 'string', description: 'Replacement text' },
          old_text:    { type: 'string', description: 'Exact text to search for' },
          new_text:    { type: 'string', description: 'Replacement for old_text' },
          message:     { type: 'string', description: 'Commit message for this change' }
        },
        required: ['path']
      },
      risk: 'low',
      category: 'files',
      async handler({ path, start_line, end_line, new_content, old_text, new_text, message }, _signal, ctx) {
        if (!ctx?.convId) return { ok: false, error: { code: 'no_conversation', message: 'No active conversation' } };
        let result;
        if (old_text !== undefined && new_text !== undefined) {
          result = await Workspace.editFileSearch(ctx.convId, path, old_text, new_text, message);
        } else if (start_line !== undefined && end_line !== undefined && new_content !== undefined) {
          result = await Workspace.editFileLines(ctx.convId, path, start_line, end_line, new_content, message);
        } else {
          return { ok: false, error: { code: 'bad_args', message: 'Provide either (start_line, end_line, new_content) or (old_text, new_text)' } };
        }
        if (result?.error) return { ok: false, error: { code: 'edit_failed', message: result.error } };
        return { path: result.path, lines: result.content.split('\n').length, versions: result.versions.length };
      }
    },
    {
      name: 'files_read',
      description: 'Read a workspace file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      risk: 'low',
      category: 'files',
      async handler({ path }, _signal, ctx) {
        const f = await Workspace.readFile(ctx.convId, path);
        if (!f) return { ok: false, error: { code: 'not_found', message: `No file at "${path}"` } };
        return { path: f.path, content: f.content, lang: f.lang };
      }
    },
    {
      name: 'files_list',
      description: 'List all workspace files for this conversation.',
      parameters: { type: 'object', properties: {} },
      risk: 'low',
      category: 'files',
      async handler(_, _signal, ctx) {
        const files = await Workspace.listFiles(ctx.convId);
        return files.map((f) => ({
          path: f.path, bytes: f.content.length,
          versions: (f.versions || []).length,
          updatedAt: f.updatedAt
        }));
      }
    },
    {
      name: 'files_history',
      description: 'List version history of a specific file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      risk: 'low',
      category: 'files',
      async handler({ path }, _signal, ctx) {
        const f = await Workspace.readFile(ctx.convId, path);
        if (!f) return { ok: false, error: { code: 'not_found', message: 'File not found' } };
        return (f.versions || []).map((v) => ({
          id: v.id, message: v.message, type: v.type,
          createdAt: v.createdAt, lines: v.lines
        }));
      }
    },
    {
      name: 'files_restore',
      description: 'Restore a file to a previous version.',
      parameters: {
        type: 'object',
        properties: {
          path:       { type: 'string' },
          version_id: { type: 'string' }
        },
        required: ['path', 'version_id']
      },
      risk: 'high',
      confirmMessage: ({ path, version_id }) => `Restore "${path}" to version ${version_id}?`,
      category: 'files',
      async handler({ path, version_id }, _signal, ctx) {
        const r = await Workspace.restoreVersion(ctx.convId, path, version_id);
        if (r?.error) return { ok: false, error: { code: 'restore_failed', message: r.error } };
        return { path: r.path, versions: r.versions.length };
      }
    },
    {
      name: 'files_delete',
      description: 'Delete a workspace file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      risk: 'high',
      confirmMessage: ({ path }) => `Delete file "${path}"?`,
      category: 'files',
      async handler({ path }, _signal, ctx) {
        return await Workspace.deleteFile(ctx.convId, path);
      }
    }
  ]
};