/**
 * @OnlyCurrentDoc
 *
 * StateService — manages resumable execution state using a FORWARD date cursor.
 *
 * Cursor: `afterCursorMs`
 *   - Stores the START of the next date window to process.
 *   - Begins at GmailUtils.getStartAnchorMs() (START_FROM_DATE or 10 years ago).
 *   - Advances forward by BATCH_WINDOW_DAYS after each window is fully processed.
 *   - On resume, we pick up from exactly the next unprocessed window.
 *   - When cursor >= endCeilingMs, all emails have been processed → state is cleared.
 */
const StateService = (function () {
  const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
  const STATE_PROPERTY_KEY = 'gmailCleanupState';

  /**
   * Loads execution state. Returns fresh state if no saved state exists.
   * @returns {{
   *   isResumed      : boolean,
   *   afterCursorMs  : number,   // start of next window to process
   *   stats          : object
   * }}
   */
  function loadState() {
    const savedJSON = SCRIPT_PROPERTIES.getProperty(STATE_PROPERTY_KEY);
    if (savedJSON) {
      Logger.log('Resuming previous execution from saved cursor.');
      const saved = JSON.parse(savedJSON);
      return { ...saved, isResumed: true };
    }

    Logger.log('Starting a new execution.');
    return {
      isResumed    : false,
      afterCursorMs: GmailUtils.getStartAnchorMs(), // oldest date to begin from
      stats: {
        processedCount       : 0,
        classifiedCount      : 0,
        archivedCount        : 0,
        labeledCount         : 0,
        labeledOnlyCount     : 0,
        deleteCandidatesCount: 0,
        skippedCount         : 0,
        noActionCount        : 0,
        errorCount           : 0,
        labeledByLabel       : {},
      },
    };
  }

  /**
   * Persists the current cursor and stats, or clears state if complete.
   * @param {object} runState      The current state object (contains stats).
   * @param {number} afterCursorMs The cursor to save (start of next window).
   * @param {boolean} completed    True when all windows have been processed.
   */
  function saveState(runState, afterCursorMs, completed) {
    if (completed) {
      Logger.log('Execution complete. Clearing saved state.');
      SCRIPT_PROPERTIES.deleteProperty(STATE_PROPERTY_KEY);
      return;
    }

    Logger.log(
      `Saving state. Next window starts at: ${new Date(afterCursorMs).toISOString().substring(0, 10)}`
    );

    const toSave = { ...runState };
    delete toSave.isResumed;          // transient — don't persist
    toSave.afterCursorMs = afterCursorMs;

    SCRIPT_PROPERTIES.setProperty(STATE_PROPERTY_KEY, JSON.stringify(toSave));
  }

  return { loadState, saveState };
})();
