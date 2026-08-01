/**
 * @fileoverview Main entry point for the Gmail Smart Cleaner script.
 * Contains user-facing functions that can be run from the Apps Script editor or via triggers.
 */

/**
 * Web app entry point. Renders the execution dashboard.
 * @param {GoogleAppsScript.Events.DoGet} e The event parameter.
 * @returns {GoogleAppsScript.HTML.HtmlOutput} The HTML output for the page.
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('DashboardTemplate');
  return template
    .evaluate()
    .setTitle('Gmail Smart Cleaner Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// ==========================================================================
// USER-FACING FUNCTIONS (for manual execution and setup)
// ==========================================================================

/**
 * Performs the initial setup for the script.
 * This function should be run manually once after deployment.
 * It creates all the necessary Gmail labels defined in the configuration.
 */
function runInitialSetup() {
  AppLogger.log('Starting initial setup...');
  AppLogger.log('Ensuring all required Gmail labels exist...');
  LabelService.ensureLabelsExist();
  AppLogger.log(
    'Initial setup complete. You can now run installTriggers() to automate the script.'
  );
}

/**
 * Installs the time-based triggers required for automatic execution.
 * This function should be run manually once after the initial setup.
 * It will delete any old triggers and create new ones for daily cleanup and reports.
 */
function installTriggers() {
  AppLogger.log('Starting trigger installation...');
  AppLogger.log(
    'Deleting old triggers and creating new daily/weekly triggers.'
  );
  TriggerService.installTriggers();
  AppLogger.log('Trigger installation complete.');
}

/**
 * Performs a health check of the script's configuration and triggers.
 * Can be run manually to diagnose issues.
 */
function runHealthCheck() {
  AppLogger.log('====== Starting Health Check ======');

  // 0. Check DRY_RUN status
  const classificationDryRun = Utils.isClassificationDryRun();
  const trashDryRun = Utils.isTrashDryRun();
  AppLogger.log(
    `DRY_RUN status -> Classification: ${classificationDryRun ? 'ENABLED' : 'DISABLED'} | Trash: ${trashDryRun ? 'ENABLED' : 'DISABLED'}`
  );

  // 1. Validate configuration
  const configErrors = Utils.validateConfig();
  if (configErrors.length > 0) {
    AppLogger.error('Configuration validation failed:');
    configErrors.forEach((err) => AppLogger.error(`- ${err}`));
  } else {
    AppLogger.log('Configuration validation passed.');
  }

  // 2. Check for Advanced Gmail Service
  try {
    // Accessing a property on Gmail will throw an error if the service is not enabled.
    // This is a simple way to check for its existence.
    // eslint-disable-next-line no-unused-expressions
    Gmail.Users;
    AppLogger.log('Advanced Gmail API service is enabled.');
  } catch (e) {
    AppLogger.error(
      'Advanced Gmail API service is NOT enabled. Please enable it in the editor under Services -> Gmail API.'
    );
  }

  // 3. Check if required labels exist
  const missingLabels = LabelService.getMissingLabels();
  if (missingLabels.length > 0) {
    AppLogger.error(
      `Found ${missingLabels.length} missing labels: ${missingLabels.join(', ')}`
    );
    AppLogger.error('Please run runInitialSetup() to create them.');
  } else {
    AppLogger.log('All required labels exist.');
  }

  // 4. Check triggers
  const triggers = ScriptApp.getProjectTriggers();
  if (triggers.length > 0) {
    AppLogger.log(`Found ${triggers.length} installed trigger(s):`);
    triggers.forEach((trigger) => {
      AppLogger.log(
        `- Handler: ${trigger.getHandlerFunction()}, Type: ${trigger.getEventType()}`
      );
    });
  } else {
    AppLogger.log(
      'No triggers are currently installed. Run installTriggers() to set them up.'
    );
  }
  AppLogger.log('====== Health Check Complete ======');
}

// ==========================================================================
// TRIGGER-DRIVEN FUNCTIONS (for automated execution)
// ==========================================================================

/**
 * The main cleanup function. This is the core function that will be run daily.
 * It finds, classifies, and processes emails based on the configured rules.
 * It's designed to be resumable to handle large inboxes without timing out.
 */
function gmailCleanup() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    AppLogger.log('Could not acquire lock. Another instance is likely running. Exiting...');
    return;
  }

  // --- Config validation ---
  const configErrors = Utils.validateConfig();
  if (configErrors.length > 0) {
    const errorMsg = 'GmailCleanup stopped due to configuration errors.';
    AppLogger.error(errorMsg);
    _sendErrorNotification('Configuration Error', `${errorMsg}\n\n${configErrors.join('\n')}`);
    lock.releaseLock();
    return;
  }

  Utils.resetStartTime();
  AppLogger.log('====== Starting Gmail Cleanup ======');
  if (Utils.isClassificationDryRun()) {
    AppLogger.log('*** CLASSIFICATION DRY RUN IS ENABLED. NO CHANGES WILL BE MADE. ***');
  }

  // --- Load state ---
  // afterCursorMs = start of next 30-day window to process (oldest-first).
  // Initialised to START_FROM_DATE (or 10 years ago) on first run.
  const runState = StateService.loadState();
  const { stats } = runState;
  let afterCursorMs = runState.afterCursorMs;

  // Hard ceiling — do not process emails on/after this date
  const endCeilingMs   = GmailUtils.getEndCeilingMs();
  const windowDays     = GmailUtils.getWindowDays();   // 30
  const windowDurationMs = windowDays * 24 * 60 * 60 * 1000;

  AppLogger.log(
    `Scanning: ${new Date(afterCursorMs).toISOString().substring(0, 10)}` +
    ` → ${new Date(endCeilingMs).toISOString().substring(0, 10)}` +
    ` (${windowDays}-day windows, oldest-first)`
  );

  if (CONFIG.EXECUTION.PROCESS_ONLY_BEFORE_DATE) {
    AppLogger.log(
      `PROCESS_ONLY_BEFORE_DATE is set: only emails before ` +
      `${CONFIG.EXECUTION.PROCESS_ONLY_BEFORE_DATE} will be processed.`
    );
  }

  LabelService.ensureLabelsExist();

  try {
    const priorityLabel = GmailApp.getUserLabelByName('Priority');
    const userLabels    = GmailApp.getUserLabels();
    const labelMap      = new Map(userLabels.map((l) => [l.getName(), l]));

    // =========================================================
    // MAIN LOOP — one iteration = one 30-day date window
    // Walk FORWARD in time: oldest window first → newest last
    // =========================================================
    while (afterCursorMs < endCeilingMs) {

      // Window end = afterCursorMs + 30 days, capped at endCeilingMs
      const beforeCursorMs = Math.min(afterCursorMs + windowDurationMs, endCeilingMs);

      // --- MAX_THREADS_TO_PROCESS pre-check ---
      const maxLimit = CONFIG.EXECUTION.MAX_THREADS_TO_PROCESS;
      if (maxLimit > 0 && (stats.processedCount || 0) >= maxLimit) {
        AppLogger.log(`Reached MAX_THREADS_TO_PROCESS limit of ${maxLimit}. Pausing.`);
        StateService.saveState(runState, afterCursorMs, false);
        return;
      }

      const statsBeforeWindow = JSON.parse(JSON.stringify(stats));
      const windowStartTime   = new Date();

      // Process this window (oldest-first within window)
      const result = GmailUtils.processWindow(
        afterCursorMs,
        beforeCursorMs,
        stats.processedCount || 0,
        (thread) => {
          CleanupService.processThread(thread, stats, labelMap, priorityLabel);
        }
      );

      // --- Window logging ---
      const windowDuration = ((new Date() - windowStartTime) / 1000).toFixed(1);
      if (result.processedCount > 0) {
        const parts = [
          `window: ${new Date(afterCursorMs).toISOString().substring(0, 10)} → ${new Date(beforeCursorMs).toISOString().substring(0, 10)}`,
          `processed: ${result.processedCount}`,
        ];

        const deleteDelta  = (stats.deleteCandidatesCount || 0) - (statsBeforeWindow.deleteCandidatesCount || 0);
        const archiveDelta = (stats.archivedCount         || 0) - (statsBeforeWindow.archivedCount         || 0);
        const labelDelta   = (stats.labeledCount          || 0) - (statsBeforeWindow.labeledCount          || 0);

        if (deleteDelta  > 0) parts.push(`Delete Candidates: ${deleteDelta}`);
        if (archiveDelta > 0) parts.push(`Archived: ${archiveDelta}`);
        if (labelDelta   > 0) {
          const before = statsBeforeWindow.labeledByLabel || {};
          for (const lbl in stats.labeledByLabel) {
            const d = (stats.labeledByLabel[lbl] || 0) - (before[lbl] || 0);
            if (d > 0) parts.push(`${lbl}: ${d}`);
          }
        }

        AppLogger.summary(`[${windowDuration}s] ${parts.join(' | ')}`);
      }

      // Stop if limit hit mid-window
      if (result.limitReached) {
        AppLogger.log(`MAX_THREADS_TO_PROCESS limit reached. Saving cursor and pausing.`);
        StateService.saveState(runState, afterCursorMs, false);
        return;
      }

      // Advance cursor to the next window (forward in time)
      afterCursorMs = beforeCursorMs;

      // Check execution time limit after each window
      if (Utils.isTimeRunningOut()) {
        AppLogger.log('Execution time limit approaching. Saving cursor and pausing.');
        StateService.saveState(runState, afterCursorMs, false);
        return;
      }
    }

    // =========================================================
    // All windows processed — clear state
    // =========================================================
    StateService.saveState(runState, afterCursorMs, true);
    AppLogger.log('====== Gmail Cleanup Complete ======');

    const totalRuntime = Utils.getScriptRuntime();
    const {
      processedCount, classifiedCount, labeledCount, labeledOnlyCount,
      deleteCandidatesCount, archivedCount, skippedCount, noActionCount, errorCount,
    } = stats;

    AppLogger.table('Cleanup Execution Summary', [
      ['Reviewed Threads',           processedCount],
      ['--------------------',       '----------'],
      ['Delete Candidates',          deleteCandidatesCount || 0],
      ['Archived Threads',           archivedCount         || 0],
      ['Category Labeled Only',      labeledOnlyCount      || 0],
      ['Safety Blocked',             skippedCount          || 0],
      ['No Action Taken',            noActionCount         || 0],
      ['--------------------',       '----------'],
      ['Classified (rules matched)', classifiedCount       || 0],
      ['Labels Applied (total)',     labeledCount          || 0],
      ['Failed / Errors',            errorCount            || 0],
      ['Runtime',                    `${totalRuntime}s`],
      ['Classification Dry Run',     Utils.isClassificationDryRun() ? 'Yes' : 'No'],
    ]);

    AppLogger.log(
      `Thread Outcome Breakdown (Sums to ${processedCount}): ` +
      `Delete Candidates: ${deleteCandidatesCount || 0} | Archived: ${archivedCount || 0} | ` +
      `Category Labeled: ${labeledOnlyCount || 0} | Safety Blocked: ${skippedCount || 0} | ` +
      `No Action: ${noActionCount || 0}`
    );

    if (labeledCount > 0 && stats.labeledByLabel) {
      AppLogger.log(
        `Applied labels → ${Object.entries(stats.labeledByLabel).map(([l, c]) => `${l}: ${c}`).join(' | ')}`
      );
    } else {
      AppLogger.log('Applied labels → none (no matching rules or labels already present)');
    }

    _cleanupEmptyLabels();
    _updateExecutionHistory({ ...stats, totalRuntime, status: 'Success', completedAt: new Date().toISOString() });

  } catch (e) {
    AppLogger.error('A critical error occurred during gmailCleanup.', e);
    _sendErrorNotification('Script Failure: gmailCleanup', e.stack);
    _updateExecutionHistory({ ...stats, status: 'Failure', error: e.message, completedAt: new Date().toISOString() });
    StateService.saveState(runState, afterCursorMs, false);
  } finally {
    RuleEngine.clearCache();
    lock.releaseLock();
  }
}


/**
 * Step 2 of deletion workflow: Moves eligible threads labeled 'Delete' to Trash.
 * This is a separate top-level function that must be run manually or triggered independently.
 * @returns {Object} Stats of the trash run.
 */
function trashDeleteLabeledEmails() {
  return CleanupService.trashDeleteLabeledEmails();
}

/**
 * Finds threads with large attachments and applies a label.
 * Runs as a separate, less frequent process.
 */
function cleanupAttachments() {
  if (!CONFIG.RULES.ATTACHMENT_CLEANUP.ENABLED) {
    AppLogger.log('Attachment cleanup is disabled in the configuration.');
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    AppLogger.log('Could not acquire lock for attachment cleanup. Exiting.');
    return;
  }

  AppLogger.log('====== Starting Attachment Cleanup ======');
  const { MIN_SIZE_MB, OLDER_THAN_DAYS, LABEL } =
    CONFIG.RULES.ATTACHMENT_CLEANUP;
  const searchQuery = `has:attachment larger:${MIN_SIZE_MB}m older_than:${OLDER_THAN_DAYS}d -label:"${LABEL}"`;

  AppLogger.debug(`Using search query: "${searchQuery}"`);

  try {
    const label = GmailApp.getUserLabelByName(LABEL);
    if (!label) {
      AppLogger.error(
        `Attachment cleanup label "${LABEL}" does not exist. Please run initial setup.`
      );
      return;
    }

    let pageToken = null;
    let totalLabeled = 0;
    do {
      const listOptions = {
        q: searchQuery,
        maxResults: CONFIG.EXECUTION.BATCH_SIZE,
        pageToken: pageToken,
      };

      const response = Gmail.Users.Threads.list('me', listOptions);
      pageToken = response.nextPageToken;

      const threads = response.threads || [];
      if (threads.length > 0) {
        const threadIds = threads.map((t) => t.id);
        AppLogger.log(
          `Found a batch of ${threads.length} threads with attachments larger than ${MIN_SIZE_MB}MB.`
        );

        if (Utils.isClassificationDryRun()) {
          AppLogger.log(
            `[DRY RUN] Would apply label "${LABEL}" to ${threadIds.length} threads.`
          );
        } else {
          // Use the advanced API's batchModify for maximum efficiency.
          // This labels the entire batch in a single API call.
          Utils.withRetry(
            () =>
              Gmail.Users.Threads.batchModify(
                { ids: threadIds, addLabelIds: [label.getId()] },
                'me'
              ),
            `batch apply label "${LABEL}" to ${threadIds.length} threads`
          );
          AppLogger.log(`Successfully labeled ${threadIds.length} threads.`);
        }
        totalLabeled += threadIds.length;
      }
      if (Utils.isTimeRunningOut()) {
        AppLogger.log(
          'Execution time limit is approaching. Pausing attachment cleanup. Will continue on next scheduled run.'
        );
        break;
      }
    } while (pageToken);

    if (totalLabeled === 0) {
      AppLogger.log('No new threads with large attachments found.');
    }
  } catch (e) {
    AppLogger.error('A critical error occurred during cleanupAttachments.', e);
    _sendErrorNotification('Script Failure: cleanupAttachments', e.stack);
  } finally {
    lock.releaseLock();
    AppLogger.log('====== Attachment Cleanup Complete ======');
  }
}

/**
 * Finds and removes any script-managed labels that are no longer associated with any threads.
 * This is a housekeeping function to prevent clutter. It will not remove protected labels.
 * @private
 */
function _cleanupEmptyLabels() {
  LabelService.cleanupEmptyLabels(Utils.isClassificationDryRun());
}

/**
 * Retrieves the execution history for the dashboard.
 * This function is called from the HTML template.
 * @returns {object[]} An array of execution history objects.
 */
function getExecutionHistory() {
  const properties = PropertiesService.getScriptProperties();
  const history = JSON.parse(
    properties.getProperty('executionHistory') || '[]'
  );
  return history;
}

/**
 * Updates the execution history in PropertiesService.
 * @param {object} newRunStats The statistics of the completed run.
 * @private
 */
function _updateExecutionHistory(newRunStats) {
  AppLogger.debug('Updating execution history...');
  const properties = PropertiesService.getScriptProperties();
  const history = getExecutionHistory();
  history.unshift(newRunStats); // Add new run to the beginning

  // Keep history limited to the configured count
  const trimmedHistory = history.slice(
    0,
    CONFIG.EXECUTION.EXECUTION_HISTORY_COUNT
  );

  properties.setProperty('executionHistory', JSON.stringify(trimmedHistory));
  // Also set last run for summary reports
  properties.setProperty('lastRunStats', JSON.stringify(newRunStats));
}

/**
 * Helper function to send a summary report for a given period.
 * @param {string} period The reporting period (e.g., "Weekly", "Monthly").
 * @private
 */
function _sendSummaryReport(period) {
  const lastRun = getExecutionHistory()[0]; // Get the most recent run
  if (lastRun && lastRun.status === 'Success') {
    AppLogger.log(`Generating ${period} summary report...`);
    SummaryService.sendSummary(lastRun);
  } else {
    AppLogger.log(
      `No successful run found in history. Skipping ${period.toLowerCase()} report.`
    );
  }
}

function sendWeeklySummary() {
  AppLogger.log('Triggered: sendWeeklySummary');
  _sendSummaryReport('Weekly');
}

function sendMonthlySummary() {
  AppLogger.log('Triggered: sendMonthlySummary');
  _sendSummaryReport('Monthly');
}

/**
 * Sends an email notification about a critical script error.
 * @param {string} subject The subject of the error email.
 * @param {string} body The body of the error email, typically the error stack.
 * @private
 */
function _sendErrorNotification(subject, body) {
  const recipient = CONFIG.REPORTING.ERROR_REPORT_EMAIL;
  if (!recipient) return;
  AppLogger.log(`Attempting to send error notification to ${recipient}...`);

  try {
    Utils.withRetry(
      () =>
        MailApp.sendEmail(
          recipient,
          `[Gmail Smart Cleaner] ${subject}`,
          `A critical error occurred in the Gmail Smart Cleaner script:\n\n${body}`
        ),
      'send error notification'
    );
  } catch (e) {
    AppLogger.error('Failed to send error notification email.', e);
  }
}
