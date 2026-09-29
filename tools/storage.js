export const storageTool = {
  id: 'storage',
  title: 'Storage',
  description: 'Read/write extension-local storage.',
  tools: [
    {
      name: 'storage_get',
      description: 'Get a value from chrome.storage.local.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key']
      },
      risk: 'low',
      handler: async ({ key }) => {
        const data = await chrome.storage.local.get(key);
        return { key, value: data[key] ?? null };
      }
    },
    {
      name: 'storage_set',
      description: 'Write a value to chrome.storage.local.',
      parameters: {
        type: 'object',
        properties: {
          key:   { type: 'string' },
          value: { type: 'string', description: 'String value' }
        },
        required: ['key', 'value']
      },
      risk: 'high',
      confirmMessage: ({ key }) => `Write to storage key "${key}"?`,
      handler: async ({ key, value }) => {
        await chrome.storage.local.set({ [key]: value });
        return { key, ok: true };
      }
    }
  ]
};