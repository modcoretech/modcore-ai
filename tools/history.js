export const historyTool = {
  id: 'history',
  title: 'History',
  description: 'Query browsing history.',
  tools: [
    {
      name: 'history_search',
      description: 'Search recent browsing history.',
      parameters: {
        type: 'object',
        properties: {
          query:     { type: 'string',  description: 'Search text' },
          maxResults:{ type: 'integer', description: 'Max entries to return (default 20)' }
        },
        required: ['query']
      },
      risk: 'low',
      handler: async ({ query, maxResults = 20 }) => {
        const items = await chrome.history.search({ text: query, maxResults });
        return items.map((h) => ({
          title: h.title, url: h.url, lastVisitTime: h.lastVisitTime
        }));
      }
    }
  ]
};