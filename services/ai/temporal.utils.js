/**
 * Temporal Cognition & Human Memory Utilities
 * Maps conversation dates and timestamps to human-like episodic recollections.
 */

/**
 * Format current real-world date and time for system prompt injection.
 * @param {Date} [now=new Date()]
 * @returns {{ iso: string, formattedDate: string, formattedTime: string, dayOfWeek: string, fullDateTime: string, calendarDate: string }}
 */
export function getCurrentTimeContext(now = new Date()) {
  const dateObj = now instanceof Date ? now : new Date(now);

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const dayOfWeek = days[dateObj.getDay()];
  const monthName = months[dateObj.getMonth()];
  const dayOfMonth = dateObj.getDate();
  const year = dateObj.getFullYear();

  let hours = dateObj.getHours();
  const minutes = dateObj.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;

  const formattedDate = `${dayOfWeek}, ${monthName} ${dayOfMonth}, ${year}`;
  const formattedTime = `${hours}:${minutes} ${ampm}`;
  const fullDateTime = `${formattedDate} at ${formattedTime}`;
  const calendarDate = dateObj.toISOString().split('T')[0];

  return {
    iso: dateObj.toISOString(),
    formattedDate,
    formattedTime,
    dayOfWeek,
    fullDateTime,
    calendarDate,
  };
}

/**
 * Convert a past timestamp into a rich human-like episodic memory time description.
 * Just like a human remembers ("earlier today", "yesterday afternoon", "6 days ago on Monday", etc.).
 * @param {Date|string|number} pastTimestamp
 * @param {Date} [referenceDate=new Date()]
 * @returns {string} Human-friendly relative time description
 */
export function formatHumanRelativeDate(pastTimestamp, referenceDate = new Date()) {
  if (!pastTimestamp) return 'in a past conversation';

  const then = pastTimestamp instanceof Date ? pastTimestamp : new Date(pastTimestamp);
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);

  if (isNaN(then.getTime())) return 'in a past conversation';

  const diffMs = now.getTime() - then.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  // Determine calendar day difference (taking timezone/midnight into account)
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thenDate = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const diffDays = Math.round((nowDate.getTime() - thenDate.getTime()) / (1000 * 60 * 60 * 24));

  const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = daysShort[then.getDay()];
  const monthName = monthsShort[then.getMonth()];
  const dayNum = then.getDate();
  const yearNum = then.getFullYear();

  let hours = then.getHours();
  const minutes = then.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const timeFormatted = `${hours}:${minutes} ${ampm}`;

  // 1. Same calendar day (Today)
  if (diffDays === 0) {
    if (diffMinutes < 5) return 'just now in this conversation';
    if (diffMinutes < 60) return `earlier today (${diffMinutes}m ago, at ${timeFormatted})`;
    if (diffHours < 4) return `earlier today (${diffHours}h ago, at ${timeFormatted})`;
    return `earlier today (at ${timeFormatted})`;
  }

  // 2. Yesterday
  if (diffDays === 1) {
    return `yesterday (${dayName}, ${monthName} ${dayNum} at ${timeFormatted})`;
  }

  // 3. 2 to 6 days ago (same or previous week)
  if (diffDays >= 2 && diffDays <= 6) {
    return `${diffDays} days ago (${dayName}, ${monthName} ${dayNum})`;
  }

  // 4. 1 to 4 weeks ago
  if (diffDays > 6 && diffDays <= 30) {
    const weeks = Math.round(diffDays / 7);
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago (${monthName} ${dayNum}, ${yearNum})`;
  }

  // 5. Older than 30 days
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths <= 11) {
    return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago (${monthName} ${yearNum})`;
  }

  return `on ${monthName} ${dayNum}, ${yearNum}`;
}

/**
 * Get a concise temporal anchor tag (e.g. for database or badges).
 * @param {Date|string} pastTimestamp
 * @param {Date} [referenceDate=new Date()]
 * @returns {string}
 */
export function getHumanTimeAnchor(pastTimestamp, referenceDate = new Date()) {
  if (!pastTimestamp) return 'historical_memory';

  const then = pastTimestamp instanceof Date ? pastTimestamp : new Date(pastTimestamp);
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);

  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thenDate = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const diffDays = Math.round((nowDate.getTime() - thenDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays <= 7) return 'this_week';
  if (diffDays <= 30) return 'this_month';
  return 'earlier_conversation';
}

/**
 * Format a single memory object into a prompt line with time and date anchoring.
 * @param {Object} mem
 * @param {Date} [now=new Date()]
 * @returns {string}
 */
export function formatTimeAwareMemoryLine(mem, now = new Date()) {
  const timestamp = mem.occurred_at || mem.created_at;
  const timeDesc = formatHumanRelativeDate(timestamp, now);
  const categoryTag = (mem.category || 'FACT').toUpperCase();
  const typeTag = mem.memory_type ? mem.memory_type.replace('_', ' ').toUpperCase() : 'USER FACT';

  return `- [Spoken ${timeDesc} | ${typeTag} / ${categoryTag}]: ${mem.content}`;
}
