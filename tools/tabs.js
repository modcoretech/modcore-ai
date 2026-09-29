export const tabsTool = {
  id: 'tabs',
  title: 'Tabs',
  description: 'Query, create, activate, group, and close browser tabs.',
  tools: [
    {
      name: 'tabs_query',
      description: 'List open browser tabs. Optionally filter by a search term matched against title or URL.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional substring to match' }
        }
      },
      risk: 'low',
      handler: async ({ query }) => {
        const tabs = await chrome.tabs.query({});
        const q = query?.toLowerCase();
        const filtered = q
          ? tabs.filter((t) =>
              (t.title || '').toLowerCase().includes(q) ||
              (t.url   || '').toLowerCase().includes(q))
          : tabs;
        return filtered.map((t) => ({
          id: t.id, title: t.title, url: t.url, active: !!t.active
        }));
      }
    },

    {
      name: 'tabs_create',
      description: 'Open a new tab with a URL.',
      parameters: {
        type: 'object',
        properties: {
          url:       { type: 'string',  description: 'URL to open' },
          active:    { type: 'boolean', description: 'Activate the new tab (default true)' }
        },
        required: ['url']
      },
      risk: 'low',
      handler: async ({ url, active = true }) => {
        const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        const tab = await chrome.tabs.create({ url: normalized, active });
        return { tabId: tab.id, url: tab.url };
      }
    },

    {
      name: 'tabs_activate',
      description: 'Focus an existing tab by ID.',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'integer' } },
        required: ['tabId']
      },
      risk: 'low',
      handler: async ({ tabId }) => {
        const tab = await chrome.tabs.update(tabId, { active: true });
        if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        return { tabId, windowId: tab?.windowId };
      }
    },

    {
      name: 'tabs_close',
      description: 'Close a tab by ID.',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'integer' } },
        required: ['tabId']
      },
      risk: 'high',
      confirmMessage: ({ tabId }) => `Close Tab #${tabId}?`,
      handler: async ({ tabId }) => {
        await chrome.tabs.remove(tabId);
        return { closedTabId: tabId };
      }
    }
  ]
};