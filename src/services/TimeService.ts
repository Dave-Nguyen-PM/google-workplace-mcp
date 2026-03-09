export class TimeService {
  getCurrentDate = async () => {
    const now = new Date();
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            utc: now.toISOString().split('T')[0],
            local: now.toLocaleDateString('en-CA'),
            dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        },
      ],
    };
  };

  getCurrentTime = async () => {
    const now = new Date();
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            utc: now.toISOString(),
            local: now.toLocaleString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        },
      ],
    };
  };

  getTimeZone = async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            timezone: tz,
            utcOffset: `${sign}${hours}:${minutes}`,
          }),
        },
      ],
    };
  };
}
