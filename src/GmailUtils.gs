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
    const { SEARCH_OLDER_THAN_DAYS } = Config.EXECUTION;
    let query = 'in:inbox';

    if (SEARCH_OLDER_THAN_DAYS > 0) {
      query += ` older_than:${SEARCH_OLDER_THAN_DAYS}d`;
    }

    Logger.log(`Built search query: "${query}"`);
    return query;
  }

  /**
   * Searches for Gmail threads matching the query, excluding already processed ones.
   * @param {string} query The Gmail search query.
   * @param {string[]} processedThreadIds An array of thread IDs to exclude from the search.
   * @returns {GoogleAppsScript.Gmail.GmailThread[]} The found threads.
   */
  function searchThreads(query, processedThreadIds) {
    const { BATCH_SIZE, MAX_THREADS_TO_PROCESS } = Config.EXECUTION;
    const processedSet = new Set(processedThreadIds);
    const allThreads = [];
    let pageToken = null;

    Logger.log(`Searching for threads with query: "${query}"`);

    do {
      const response = Gmail.Users.Threads.list('me', {
        q: query,
        maxResults: BATCH_SIZE,
        pageToken: pageToken,
      });

      if (response.threads && response.threads.length > 0) {
        for (const threadInfo of response.threads) {
          if (!processedSet.has(threadInfo.id)) {
            const thread = GmailApp.getThreadById(threadInfo.id);
            if (thread) {
              allThreads.push(thread);
            }
          }
        }
      }

      pageToken = response.nextPageToken;

      if (
        MAX_THREADS_TO_PROCESS > 0 &&
        allThreads.length >= MAX_THREADS_TO_PROCESS
      ) {
        break;
      }
    } while (pageToken);

    const finalThreads =
      MAX_THREADS_TO_PROCESS > 0
        ? allThreads.slice(0, MAX_THREADS_TO_PROCESS)
        : allThreads;

    Logger.log(`Found ${finalThreads.length} new threads to process.`);
    return finalThreads;
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
    searchThreads: searchThreads,
    sortThreadsByDate: sortThreadsByDate,
  };
})();