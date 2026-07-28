/**
 * @OnlyCurrentDoc
 *
 * The StateService module manages the state of long-running executions,
 * allowing them to be paused and resumed without reprocessing the same items.
 */
const StateService = (function () {
  const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
  const STATE_PROPERTY_KEY = 'gmailCleanupState';

  /**
   * Loads the execution state from PropertiesService.
   * @returns {{isResumed: boolean, processedThreadIds: string[], stats: object}} The loaded state.
   */
  function loadState() {
    const savedStateJSON = SCRIPT_PROPERTIES.getProperty(STATE_PROPERTY_KEY);
    if (savedStateJSON) {
      Logger.log('Resuming previous execution.');
      const savedState = JSON.parse(savedStateJSON);
      return {
        ...savedState,
        isResumed: true,
      };
    }

    Logger.log('Starting a new execution.');
    return {
      isResumed: false,
      processedThreadIds: [],
      stats: {
        processedCount: 0,
        classifiedCount: 0,
        archivedCount: 0,
        labeledCount: 0,
        deleteCandidatesCount: 0,
        skippedCount: 0,
        noActionCount: 0,
        errorCount: 0,
        labeledByLabel: {},
      },
    };
  }

  /**
   * Saves the execution state to PropertiesService or clears it if completed.
   * @param {object} runState The current state of the run.
   * @param {string[]} processedIds The IDs of threads processed in the current batch.
   * @param {boolean} completed Whether the entire execution is finished.
   */
  function saveState(runState, processedIds, completed) {
    if (completed) {
      Logger.log('Execution complete. Clearing saved state.');
      SCRIPT_PROPERTIES.deleteProperty(STATE_PROPERTY_KEY);
    } else {
      Logger.log('Execution timed out. Saving state to resume later.');
      const newState = { ...runState };
      delete newState.isResumed; // Don't save the transient 'isResumed' flag
      newState.processedThreadIds.push(...processedIds);
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
