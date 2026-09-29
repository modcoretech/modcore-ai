export const bookmarksTool = {
  id: 'bookmarks',
  title: 'Bookmarks',
  description: 'Search and add browser bookmarks.',
  tools: [
    {
      name: 'bookmarks_search',
      description: 'Search existing bookmarks by keyword.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
      },
      risk: 'low',
      handler: async ({ query }) => {
        const results = await chrome.bookmarks.search(query);
        return results.map((b) => ({ id: b.id, title: b.title, url: b.url }));
      }
    },
    {
      name: 'bookmarks_create',
      description: 'Save a new bookmark.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url:   { type: 'string' }
        },
        required: ['title', 'url']
      },
      risk: 'low',
      handler: async ({ title, url }) => {
        const bookmark = await chrome.bookmarks.create({ title, url });
        return { id: bookmark.id, title: bookmark.title, url: bookmark.url };
      }
    }
  ]
};