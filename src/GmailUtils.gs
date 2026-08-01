/**
 * @OnlyCurrentDoc
 *
 * The GmailUtils module provides helper functions for searching, fetching,
 * and sorting Gmail threads.
 *
 * =============================================================================
 * OLDEST-FIRST STRATEGY — FORWARD DATE WINDOW
 * =============================================================================
 *
 * PROBLEM: Gmail API always returns threads NEWEST-FIRST. There is no native
 * ascending (oldest-first) sort order in the API.
 *
 * SOLUTION — Forward sliding date window:
 *
 *   We divide the total date range (START_FROM_DATE → PROCESS_ONLY_BEFORE_DATE)
 *   into small windows, each BATCH_WINDOW_DAYS wide. We walk FORWARD in time:
 *
 *   Window 1:  after:2010/01/01  before:2010/01/31   ← oldest emails first
 *   Window 2:  after:2010/01/31  before:2010/03/02
 *   Window 3:  after:2010/03/02  before:2010/04/01
 *   ...
 *   Window N:  after:2024/11/01  before:2024/12/31   ← newest (most recent)
 *
 *   Within each window, Gmail returns newest-first → we sort oldest-first.
 *   Because windows are narrow (30 days), sorting a small batch is fast.
 *
 * CONFIG:
 *   START_FROM_DATE         — where to begin (default: 10 years ago)
 *   PROCESS_ONLY_BEFORE_DATE — hard ceiling (default: today)
 *   BATCH_WINDOW_DAYS       — window width in days (hardcoded: 30)
 *
 * RESUMABILITY:
 *   `afterCursorMs` (stored in StateService) = start of next window to process.
 *   On resume, we pick up from exactly where we left off.
 *
 * RESULT:
 *   ✅ Oldest emails processed first
 *   ✅ No email ever re-processed
 *   ✅ MAX_THREADS_TO_PROCESS strictly enforced
 *   ✅ PROCESS_ONLY_BEFORE_DATE respected
 * =============================================================================
 */
const GmailUtils = (function () {

  // Width of each date window in days. Narrow enough for Gmail pagination to
  // be manageable; wide enough to be efficient. 30 days is a good default.
  const BATCH_WINDOW_DAYS = 30;

  /**
   * Parses a 'YYYY/MM/DD' config date string into a UTC Date object.
   * Returns null if the string is null / invalid.
   * @param {string|null} dateStr
   * @returns {Date|null}
   */
  function parseDateConfig(dateStr) {
    if (!dateStr) return null;
    const parts = String(dateStr).trim().split('/');
    if (parts.length !== 3) return null;
    const d = new Date(
      Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
    );
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Returns the "start" anchor timestamp (ms) for the first scan window.
   * Uses START_FROM_DATE from config, or defaults to 10 years ago.
   * @returns {number}
   */
  function getStartAnchorMs() {
    const configDate = parseDateConfig(CONFIG.EXECUTION.START_FROM_DATE);
    if (configDate) return configDate.getTime();
    // Default: 10 years ago
    const d = new Date();
    d.setFullYear(d.getFullYear() - 10);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /**
   * Returns the "end" ceiling timestamp (ms) — emails ON or AFTER this date
   * are ignored. Uses PROCESS_ONLY_BEFORE_DATE from config, or today.
   * @returns {number}
   */
  function getEndCeilingMs() {
    const configDate = parseDateConfig(CONFIG.EXECUTION.PROCESS_ONLY_BEFORE_DATE);
    if (configDate) return configDate.getTime();
    // Default: process everything up to now
    return Date.now();
  }

  /**
   * Builds a Gmail search query for a specific date window.
   *
   * @param {number} afterMs  Start of window (inclusive). Emails AFTER this date.
   * @param {number} beforeMs End of window (exclusive). Emails BEFORE this date.
   * @returns {string} Gmail search query string.
   */
  function buildSearchQuery(afterMs, beforeMs) {
    const afterSec  = Math.floor(afterMs  / 1000);
    const beforeSec = Math.floor(beforeMs / 1000);

    let query = `in:inbox after:${afterSec} before:${beforeSec}`;

    const { SEARCH_OLDER_THAN_DAYS } = CONFIG.EXECUTION;
    if (SEARCH_OLDER_THAN_DAYS > 0) {
      query += ` older_than:${SEARCH_OLDER_THAN_DAYS}d`;
    }

    Logger.log(`Built search query: "${query}"`);
    return query;
  }

  /**
   * Processes all threads within a single date window (oldest-first).
   *
   * Because the window is narrow (BATCH_WINDOW_DAYS days), Gmail returns a
   * manageable number of threads. We fetch up to fetchSize threads, sort
   * them oldest-first, and process each one.
   *
   * @param {number} afterMs   Window start (ms).
   * @param {number} beforeMs  Window end (ms).
   * @param {number} currentProcessedCount Threads processed so far this run.
   * @param {function(GoogleAppsScript.Gmail.GmailThread): void} processFn
   * @returns {{
   *   processedCount : number,
   *   limitReached   : boolean,   // MAX_THREADS_TO_PROCESS was hit
   *   hasMore        : boolean,   // window had more threads than fetchSize (need re-visit)
   * }}
   */
  function processWindow(afterMs, beforeMs, currentProcessedCount, processFn) {
    const { BATCH_SIZE, MAX_THREADS_TO_PROCESS } = CONFIG.EXECUTION;

    // --- Enforce MAX_THREADS_TO_PROCESS ---
    let fetchSize = BATCH_SIZE;
    if (MAX_THREADS_TO_PROCESS > 0) {
      const remaining = MAX_THREADS_TO_PROCESS - (currentProcessedCount || 0);
      if (remaining <= 0) {
        Logger.log(`MAX_THREADS_TO_PROCESS limit of ${MAX_THREADS_TO_PROCESS} reached. Stopping.`);
        return { processedCount: 0, limitReached: true, hasMore: false };
      }
      fetchSize = Math.min(BATCH_SIZE, remaining);
    }

    const query = buildSearchQuery(afterMs, beforeMs);

    // Fetch one page. Gmail returns newest-first within this narrow window.
    const response = Gmail.Users.Threads.list('me', {
      q: query,
      maxResults: fetchSize,
    });

    const rawThreads = response.threads || [];
    if (rawThreads.length === 0) {
      Logger.log(`Window ${_fmtDate(afterMs)} → ${_fmtDate(beforeMs)}: no threads found.`);
      return { processedCount: 0, limitReached: false, hasMore: false };
    }

    Logger.log(
      `Window ${_fmtDate(afterMs)} → ${_fmtDate(beforeMs)}: fetched ${rawThreads.length} threads.`
    );

    // Resolve full thread objects
    const threadObjects = [];
    for (const threadInfo of rawThreads) {
      const thread = GmailApp.getThreadById(threadInfo.id);
      if (thread) threadObjects.push(thread);
    }

    // Sort oldest-first within this narrow window
    threadObjects.sort((a, b) => a.getLastMessageDate() - b.getLastMessageDate());

    let processedCount = 0;
    let limitReached   = false;

    for (const thread of threadObjects) {
      if (
        MAX_THREADS_TO_PROCESS > 0 &&
        (currentProcessedCount || 0) + processedCount >= MAX_THREADS_TO_PROCESS
      ) {
        Logger.log(`MAX_THREADS_TO_PROCESS limit hit mid-window. Stopping.`);
        limitReached = true;
        break;
      }
      processFn(thread);
      processedCount++;
    }

    // hasMore: if we got exactly fetchSize threads, there may be more in this window
    const hasMore = rawThreads.length === fetchSize && !limitReached;

    return { processedCount, limitReached, hasMore };
  }

  /**
   * Formats a timestamp (ms) as a short human-readable date for logging.
   * @param {number} ms
   * @returns {string}
   */
  function _fmtDate(ms) {
    return new Date(ms).toISOString().substring(0, 10);
  }

  /**
   * Returns the BATCH_WINDOW_DAYS constant so Main.gs can use it to advance
   * the cursor by one window width.
   * @returns {number}
   */
  function getWindowDays() {
    return BATCH_WINDOW_DAYS;
  }

  /**
   * Sorts an array of Gmail threads by their last message date.
   * @param {GoogleAppsScript.Gmail.GmailThread[]} threads
   * @param {'asc'|'desc'} direction
   * @returns {GoogleAppsScript.Gmail.GmailThread[]}
   */
  function sortThreadsByDate(threads, direction = 'asc') {
    return threads.sort((a, b) => {
      const dateA = a.getLastMessageDate();
      const dateB = b.getLastMessageDate();
      return direction === 'asc' ? dateA - dateB : dateB - dateA;
    });
  }

  return {
    getStartAnchorMs,
    getEndCeilingMs,
    buildSearchQuery,
    processWindow,
    getWindowDays,
    sortThreadsByDate,
    parseDateConfig,
  };
})();
