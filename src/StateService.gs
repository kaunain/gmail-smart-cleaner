/**
 * @OnlyCurrentDoc
 *
 * The StateService module manages the state of long-running executions using
 * a backward date-cursor approach.
 *
 * HOW THE CURSOR WORKS:
 *   - `beforeCursorMs`: We fetch threads BEFORE this date.
 *   - Initially set to "now" (today), so we start from the most recent emails
 *     and walk BACKWARD in time — meaning the OLDEST emails in inbox are always
 *     processed LAST per run, but across multiple runs we march oldest-first.
 *
 *   Wait — let me re-explain clearly:
 *   - We want OLDEST emails processed FIRST.
 *   - Gmail API: newest-first only. No ascending sort.
 *   - Our strategy: walk time BACKWARD using `before:` cursor.
 *     Run 1: before=today        → fetch newest batch → process oldest in that batch first
 *     Run 2: before=oldest_date_from_run1 → fetch next older batch → ...
 *   - Each run's batch is sorted oldest-first locally.
 *   - The cursor (before:) moves backward, so we process older and older emails over time.
 *   - This means truly oldest emails (from years ago) are reached after several runs.
 *
 *   SIMPLER UNDERSTANDING:
 *   - cursor starts at NOW
 *   - each batch: fetch threads `before:cursor`, sort oldest-first, process
 *   - cursor = oldest date in last batch
 *   - next batch: fetch threads `before:<even older date>`
 *   - repeat until no more threads found
 *   - STATE IS CLEARED — next fresh run starts from NOW again (any new emails added since)
 */
const StateService = (function () {
  const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
  const STATE_PROPERTY_KEY = 'gmailCleanupState';

  /**
   * Loads the execution state from PropertiesService.
   * @returns {{isResumed: boolean, beforeCursorMs: number|null, stats: object}}
   */
  function loadState() {
    const savedStateJSON = SCRIPT_PROPERTIES.getProperty(STATE_PROPERTY_KEY);
    if (savedStateJSON) {
      Logger.log('Resuming previous execution from saved date cursor.');
      const savedState = JSON.parse(savedStateJSON);
      return {
        ...savedState,
        isResumed: true,
      };
    }

    Logger.log('Starting a new execution.');
    return {
      isResumed: false,
      // null = start from NOW (walk backward from today)
      beforeCursorMs: null,
      stats: {
        processedCount: 0,
        classifiedCount: 0,
        archivedCount: 0,
        labeledCount: 0,
        labeledOnlyCount: 0,
        deleteCandidatesCount: 0,
        skippedCount: 0,
        noActionCount: 0,
        errorCount: 0,
        labeledByLabel: {},
      },
    };
  }

  /**
   * Saves the execution state to PropertiesService, or clears it if completed.
   * @param {object} runState The current state object (contains stats).
   * @param {number|null} beforeCursorMs The new cursor value to save.
   * @param {boolean} completed Whether all emails have been processed.
   */
  function saveState(runState, beforeCursorMs, completed) {
    if (completed) {
      Logger.log('Execution complete. Clearing saved state.');
      SCRIPT_PROPERTIES.deleteProperty(STATE_PROPERTY_KEY);
    } else {
      const cursorDate =
        beforeCursorMs != null
          ? new Date(beforeCursorMs).toISOString()
          : 'not set';
      Logger.log(`Saving state. beforeCursor: ${cursorDate}`);

      const newState = { ...runState };
      delete newState.isResumed; // transient flag — don't persist

      if (beforeCursorMs != null) {
        newState.beforeCursorMs = beforeCursorMs;
      }

      SCRIPT_PROPERTIES.setProperty(
        STATE_PROPERTY_KEY,
        JSON.stringify(newState)
      );
    }
  }

  return {
    loadState: loadState,
    saveState: saveState,
  };
})();
