import { tabsTool }        from './tabs.js';
import { bookmarksTool }   from './bookmarks.js';
import { historyTool }     from './history.js';
import { storageTool }     from './storage.js';
import { managementTool }  from './management.js';
import { filesTool }       from './files.js';
import { memoryTool }      from './memory.js';
import { webTool }         from './web.js';
import { systemTool }      from './system.js';

const ALL = [
  tabsTool, bookmarksTool, historyTool, storageTool, managementTool,
  filesTool, memoryTool, webTool, systemTool
];

export class ToolRegistry {
  static #instance = null;
  static getInstance() {
    if (!ToolRegistry.#instance) ToolRegistry.#instance = new ToolRegistry();
    return ToolRegistry.#instance;
  }
  #tools = new Map();
  constructor() {
    if (ToolRegistry.#instance) return ToolRegistry.#instance;
    for (const t of ALL) {
      for (const d of t.tools) {
        if (this.#tools.has(d.name)) console.warn(`[modcore AI] duplicate tool "${d.name}"`);
        this.#tools.set(d.name, { ...d, category: t.id });
      }
    }
    ToolRegistry.#instance = this;
  }
  get(name) { return this.#tools.get(name); }
  has(name) { return this.#tools.has(name); }
  toOpenAITools() {
    return [...this.#tools.values()].map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
  }
}