/**
 * @OnlyCurrentDoc
 *
 * The GmailUtils module provides helper functions for searching, fetching,
 * and sorting Gmail threads.
 */
const GmailUtils = (function () {
  /**
   * Builds the Gmail search query based on configuration.
   * @returns {string} The Gmail search query.
   */
  function buildSearchQuery() {
    const { SEARCH_OLDER_THAN_DAYS } = CONFIG.EXECUTION;
    let query = 'in:inbox';

    if (SEARCH_OLDER_THAN_DAYS > 0) {
      query += ` older_than:${SEARCH_OLDER_THAN_DAYS}d`;
    }

    Logger.log(`Built search query: "${query}"`);
    return query;
  }

  /**
   * Searches for a single batch of threads and processes them using a callback.
   * This is a more memory and API-efficient approach than fetching all threads first.
   * @param {string} query The Gmail search query.
   * @param {string[]} processedThreadIds An array of thread IDs to exclude from the search.
   * @param {string | null} pageToken The token for the next page of results.
   * @param {function(GoogleAppsScript.Gmail.GmailThread): void} processFn The function to call for each new thread.
   * @returns {{processedIds: string[], nextPageToken: (string | null)}}
   */
  function searchAndProcessBatch(
    query,
    processedThreadIds,
    pageToken,
    processFn
  ) {
    const { BATCH_SIZE, MAX_THREADS_TO_PROCESS } = CONFIG.EXECUTION;
    const processedSet = new Set(processedThreadIds);
    const processedInThisBatch = [];

    let batchFetchSize = BATCH_SIZE;
    // If MAX_THREADS_TO_PROCESS is set, calculate how many more threads we can process.
    if (MAX_THREADS_TO_PROCESS > 0) {
      const remaining = MAX_THREADS_TO_PROCESS - processedSet.size;
      // Request only the remaining number of threads if it's less than the standard batch size.
      if (remaining < BATCH_SIZE) {
        batchFetchSize = remaining > 0 ? remaining : 0;
      }
    }

    const response = Gmail.Users.Threads.list('me', {
      q: query,
      maxResults: batchFetchSize,
      pageToken: pageToken,
    });

    if (response.threads && response.threads.length > 0) {
      Logger.log(`Fetched a batch of ${response.threads.length} threads.`);
      for (const threadInfo of response.threads) {
        if (!processedSet.has(threadInfo.id)) {
          const thread = GmailApp.getThreadById(threadInfo.id);
          if (thread) {
            processFn(thread);
            processedInThisBatch.push(thread.id);
          }
        }
      }
    }

    return {
      processedIds: processedInThisBatch,
      nextPageToken: response.nextPageToken || null,
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
