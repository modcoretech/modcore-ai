export const systemTool = {
  id: 'system',
  title: 'System',
  description: 'Read the current time and timezone.',
  tools: [
    {
      name: 'time_now',
      description: 'Return the current date and time, including timezone and UTC offset.',
      parameters: { type: 'object', properties: {} },
      risk: 'low',
      async handler() {
        const now = new Date();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const offsetMin = -now.getTimezoneOffset();
        const sign = offsetMin >= 0 ? '+' : '-';
        const abs = Math.abs(offsetMin);
        const offset = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
        return {
          iso: now.toISOString(),
          local: now.toString(),
          locale: now.toLocaleString(),
          timezone: tz,
          utcOffset: offset,
          unix: Math.floor(now.getTime() / 1000)
        };
      }
    }
  ]
};