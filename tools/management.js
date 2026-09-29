export const managementTool = {
  id: 'management',
  title: 'Extensions',
  description: 'List installed extensions and toggle them.',
  tools: [
    {
      name: 'extensions_list',
      description: 'List all installed Chrome extensions.',
      parameters: { type: 'object', properties: {} },
      risk: 'low',
      handler: async () => {
        const all = await chrome.management.getAll();
        return all.map((e) => ({
          id: e.id, name: e.name, version: e.version,
          enabled: e.enabled, type: e.type
        }));
      }
    },
    {
      name: 'extensions_toggle',
      description: 'Enable or disable an extension.',
      parameters: {
        type: 'object',
        properties: {
          id:      { type: 'string' },
          enabled: { type: 'boolean' }
        },
        required: ['id', 'enabled']
      },
      risk: 'high',
      confirmMessage: ({ id, enabled }) =>
        `${enabled ? 'Enable' : 'Disable'} extension "${id}"?`,
      handler: async ({ id, enabled }) => {
        await chrome.management.setEnabled(id, enabled);
        return { id, enabled };
      }
    }
  ]
};