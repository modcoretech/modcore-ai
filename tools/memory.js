import { Memory } from '../js/app.js';

export const memoryTool = {
  id: 'memory',
  title: 'Memory',
  description: 'Persistent memory that survives across all conversations.',
  tools: [
    {
      name: 'memory_set',
      description: 'Save a value in long-term memory (e.g. user preferences, project context).',
      parameters: {
        type: 'object',
        properties: {
          key:   { type: 'string' },
          value: { type: 'string' }
        },
        required: ['key', 'value']
      },
      risk: 'low',
      async handler({ key, value }) { return await Memory.set(key, value); }
    },
    {
      name: 'memory_get',
      description: 'Read a value from long-term memory.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key']
      },
      risk: 'low',
      async handler({ key }) {
        const v = await Memory.get(key);
        return v == null ? { key, value: null } : { key, value: v };
      }
    },
    {
      name: 'memory_list',
      description: 'List everything stored in memory.',
      parameters: { type: 'object', properties: {} },
      risk: 'low',
      async handler() { return await Memory.list(); }
    },
    {
      name: 'memory_delete',
      description: 'Delete a memory entry.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key']
      },
      risk: 'low',
      async handler({ key }) { return await Memory.delete(key); }
    }
  ]
};