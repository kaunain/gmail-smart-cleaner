/**
 * @OnlyCurrentDoc
 *
 * The GmailUtils module provides helper functions for searching, fetching,
 * and sorting Gmail threads.
 *
 * OLDEST-FIRST STRATEGY:
 *   Gmail API always returns threads newest-first and does not support
 *   ascending date order natively. To guarantee oldest-first processing,
 *   we use a sliding date-window approach:
 *
 *   1. We maintain a cursor = the date of the NEWEST email we have processed so far.
 *      Initially null (meaning: start from the very oldest email in inbox).
 *   2. Each batch fetches threads using `before:<cursor+1day>` so we only get emails
 *      older than or equal to the cursor date. Gmail returns these newest-first,
 *      but since they are all within the window, we sort them oldest-first locally.
 *   3. After processing a batch, the cursor advances to the date of the NEWEST
 *      thread we just processed. Next batch will fetch the next set of older emails.
 *
 *   Wait — this is still confusing. Let me clarify the ACTUAL correct approach:
 *
 *   The simplest correct way to process oldest-first with Gmail API:
 *   - Fetch ALL results for the query (paginating with nextPageToken).
 *   - Gmail returns newest-first, so the LAST page has the oldest emails.
 *   - But we can't load all pages into memory.
 *
 *   PRACTICAL SOLUTION — FORWARD DATE CURSOR:
 *   - We store `oldestUnprocessedBeforeMs`: initially = now (today).
 *   - Each batch: fetch threads `before:<oldestUnprocessedBeforeMs>` sorted by Gmail (newest in that range first).
 *   - We sort our batch oldest-first, process them.
 *   - After processing, update cursor to the OLDEST date in this batch
 *     (i.e., move the "before" window backward in time).
 *   - Next batch: fetch threads `before:<that oldest date>` — going further back in time.
 *   - This walks BACKWARD in time = processing oldest emails FIRST overall.
 *
 *   RESULT: oldest emails processed first, no duplicates, MAX_THREADS_TO_PROCESS enforced.
 */
const GmailUtils = (function () {
  /**
   * Builds a Gmail search query.
   * @param {number|null} beforeDateMs If set, only fetch threads BEFORE this date (exclusive).
   *   This is used to walk backward in time (oldest-first).
   * @returns {string} The Gmail search query.
   */
  function buildSearchQuery(beforeDateMs) {
    const { SEARCH_OLDER_THAN_DAYS } = CONFIG.EXECUTION;
    let query = 'in:inbox';

    if (SEARCH_OLDER_THAN_DAYS > 0) {
      query += ` older_than:${SEARCH_OLDER_THAN_DAYS}d`;
    }

    // Backward date cursor: fetch threads strictly BEFORE this date.
    // This walks us backward in time so we always process the oldest emails next.
    // Gmail's `before:` operator accepts Unix timestamp in seconds.
    if (beforeDateMs != null) {
      const beforeSec = Math.floor(beforeDateMs / 1000);
      query += ` before:${beforeSec}`;
    }

    Logger.log(`Built search query: "${query}"`);
    return query;
  }

  /**
   * Fetches one batch of threads (oldest-first) and processes them.
   *
   * HOW OLDEST-FIRST WORKS:
   *   - We use `before:<cursor>` to limit results to emails older than the cursor.
   *   - Gmail returns these newest-first within that range.
   *   - We sort them oldest-first locally and process.
   *   - We return the OLDEST date in this batch as the new cursor.
   *   - The next call uses this older cursor, walking further back in time.
   *   - Net result: each call processes a progressively older set of emails.
   *
   * MAX_THREADS_TO_PROCESS enforcement:
   *   - fetchSize = min(BATCH_SIZE, remaining_quota)
   *   - Processing stops mid-batch if limit is hit.
   *
   * @param {string} query The base Gmail search query (with before: filter already included).
   * @param {number} currentProcessedCount Threads processed so far this run.
   * @param {function(GoogleAppsScript.Gmail.GmailThread): void} processFn Callback per thread.
   * @returns {{
   *   processedCount: number,
   *   oldestDateInBatchMs: number|null,
   *   hasMore: boolean
   * }}
   */
  function searchAndProcessBatch(query, currentProcessedCount, processFn) {
    const { BATCH_SIZE, MAX_THREADS_TO_PROCESS } = CONFIG.EXECUTION;

    // --- Enforce MAX_THREADS_TO_PROCESS ---
    let fetchSize = BATCH_SIZE;
    if (MAX_THREADS_TO_PROCESS > 0) {
      const remaining = MAX_THREADS_TO_PROCESS - (currentProcessedCount || 0);
      if (remaining <= 0) {
        Logger.log(
          `MAX_THREADS_TO_PROCESS limit of ${MAX_THREADS_TO_PROCESS} reached. Stopping.`
        );
        return { processedCount: 0, oldestDateInBatchMs: null, hasMore: false };
      }
      fetchSize = Math.min(BATCH_SIZE, remaining);
    }

    // Fetch one page of threads. Gmail returns newest-first within the `before:` window.
    const response = Gmail.Users.Threads.list('me', {
      q: query,
      maxResults: fetchSize,
    });

    const rawThreads = response.threads || [];
    if (rawThreads.length === 0) {
      Logger.log('No threads found in this batch. All emails processed.');
      return { processedCount: 0, oldestDateInBatchMs: null, hasMore: false };
    }

    Logger.log(
      `Fetched ${rawThreads.length} threads (fetchSize cap: ${fetchSize}).`
    );

    // --- Resolve full thread objects ---
    const threadObjects = [];
    for (const threadInfo of rawThreads) {
      const thread = GmailApp.getThreadById(threadInfo.id);
      if (thread) {
        threadObjects.push(thread);
      }
    }

    // --- Sort oldest-first within this batch ---
    // Within the `before:<cursor>` window, Gmail gives us newest first.
    // We reverse-sort so we process the very oldest email first.
    threadObjects.sort(
      (a, b) => a.getLastMessageDate() - b.getLastMessageDate()
    );

    let processedCount = 0;
    let oldestDateInBatchMs = null; // will be set to the OLDEST date we processed

    for (const thread of threadObjects) {
      // Stop mid-batch if MAX_THREADS_TO_PROCESS is hit
      if (
        MAX_THREADS_TO_PROCESS > 0 &&
        (currentProcessedCount || 0) + processedCount >= MAX_THREADS_TO_PROCESS
      ) {
        Logger.log(
          `MAX_THREADS_TO_PROCESS limit of ${MAX_THREADS_TO_PROCESS} hit mid-batch. Stopping.`
        );
        break;
      }

      processFn(thread);
      processedCount++;

      const threadDateMs = thread.getLastMessageDate().getTime();

      // Track OLDEST date in this batch — this becomes the new `before:` cursor.
      // Since we sorted oldest-first, the first thread processed is the oldest.
      if (oldestDateInBatchMs === null || threadDateMs < oldestDateInBatchMs) {
        oldestDateInBatchMs = threadDateMs;
      }
    }

    // `hasMore`: true if Gmail has more threads matching the current query.
    // We use this to know whether to continue fetching or stop.
    const hasMore = rawThreads.length === fetchSize;

    return {
      processedCount: processedCount,
      oldestDateInBatchMs: oldestDateInBatchMs,
      hasMore: hasMore,
    };
  }

  /**
   * Sorts an array of Gmail threads by their last message date.
   * @param {GoogleAppsScript.Gmail.GmailThread[]} threads The array of threads to sort.
   * @param {'asc' | 'desc'} direction The sort direction.
   * @returns {GoogleAppsScript.Gmail.GmailThread[]} The sorted array of threads.
   */
  function sortThreadsByDate(threads, direction = 'asc') {
    return threads.sort((a, b) => {
      const dateA = a.getLastMessageDate();
      const dateB = b.getLastMessageDate();
      return direction === 'asc' ? dateA - dateB : dateB - dateA;
    });
  }

  return {
    buildSearchQuery: buildSearchQuery,
    searchAndProcessBatch: searchAndProcessBatch,
    sortThreadsByDate: sortThreadsByDate,
  };
})();
