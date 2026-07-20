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
  // 1. Validate configuration
  const configErrors = Utils.validateConfig();
  if (configErrors.length > 0) {
    AppLogger.error('Configuration validation failed:');
    configErrors.forEach((err) => AppLogger.error(`- ${err}`));
  } else {
    AppLogger.log('Configuration validation passed.');
  }

  // 2. Check triggers (basic check)
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
  const lockAcquired = lock.tryLock(10000); // Wait 10 seconds for lock

  if (!lockAcquired) {
    AppLogger.log(
      'Could not acquire lock. Another instance is likely running. Exiting...'
    );
    return;
  }

  // Validate configuration before running
  const configErrors = Utils.validateConfig();
  if (configErrors.length > 0) {
    const errorMsg = 'GmailCleanup stopped due to configuration errors.';
    AppLogger.error(errorMsg);
    _sendErrorNotification(
      'Configuration Error',
      `${errorMsg}\n\n${configErrors.join('\n')}`
    );
    return;
  }

  Utils.resetStartTime(); // Ensure runtime calculation is correct for this execution slice
  AppLogger.log('====== Starting Gmail Cleanup ======');
  if (CONFIG.EXECUTION.DRY_RUN) {
    AppLogger.log('*** DRY RUN IS ENABLED. NO CHANGES WILL BE MADE. ***');
  }

  const properties = PropertiesService.getScriptProperties();
  const savedState = JSON.parse(properties.getProperty('cleanupState') || '{}');
  if (savedState.stats) {
    AppLogger.log('Resuming previous cleanup run.');
  } else {
    AppLogger.log('Starting a new cleanup run.');
  }

  const stats = savedState.stats || {
    processedCount: 0,
    threadsLabeledCount: 0,
    archivedCount: 0,
    trashedCount: 0,
    skippedCount: 0,
    startTime: new Date().getTime(),
  };

  let offset = stats.processedCount || 0;
  const BATCH_SIZE = CONFIG.EXECUTION.BATCH_SIZE;

  let searchQuery = 'in:inbox';
  if (CONFIG.EXECUTION.SEARCH_OLDER_THAN_DAYS > 0) {
    searchQuery += ` older_than:${CONFIG.EXECUTION.SEARCH_OLDER_THAN_DAYS}d`;
  }

  AppLogger.debug(`Using search query: "${searchQuery}"`);

  try {
    let threads = [];

    do {
      AppLogger.log(
        `Searching for next batch of threads (offset: ${offset})...`
      );
      threads = GmailApp.search(searchQuery, offset, BATCH_SIZE);

      if (threads.length === 0) {
        AppLogger.log('No more threads found matching the search query.');
        break;
      }

      const maxToProcess = CONFIG.EXECUTION.MAX_THREADS_TO_PROCESS;
      let threadsToProcess = threads;

      // If a processing limit is set, check if we need to slice this batch.
      if (maxToProcess > 0) {
        const remaining = maxToProcess - stats.processedCount;
        if (remaining <= 0) {
          AppLogger.log(
            `Processing limit of ${maxToProcess} already met. Stopping.`
          );
          break; // Exit the loop.
        }
        if (threads.length > remaining) {
          AppLogger.log(
            `Trimming batch from ${threads.length} to ${remaining} to respect processing limit of ${maxToProcess}.`
          );
          threadsToProcess = threads.slice(0, remaining);
        }
      }

      AppLogger.log(
        `Processing a batch of ${threadsToProcess.length} thread(s).`
      );

      // By capturing stats before and after, we can log the actions taken within this specific batch.
      const statsBefore = { ...stats };

      CleanupService.processThreads(threadsToProcess, stats);

      const processedInBatch =
        stats.processedCount - statsBefore.processedCount;
      const labeledInBatch =
        stats.threadsLabeledCount - statsBefore.threadsLabeledCount;
      const archivedInBatch = stats.archivedCount - statsBefore.archivedCount;
      const trashedInBatch = stats.trashedCount - statsBefore.trashedCount;
      const skippedInBatch = stats.skippedCount - statsBefore.skippedCount;
      AppLogger.log(
        `  > Batch actions: Processed: ${processedInBatch}, Labeled: ${labeledInBatch}, Archived: ${archivedInBatch}, Trashed: ${trashedInBatch}, Skipped: ${skippedInBatch}`
      );

      offset += threadsToProcess.length;

      if (Utils.isTimeRunningOut()) {
        properties.setProperty(
          'cleanupState',
          JSON.stringify({ stats: stats })
        );
        AppLogger.log(
          'Execution time limit is approaching. Saving state and pausing.'
        );
        AppLogger.log(
          'The script will resume from this point on the next run.'
        );
        break;
      }

      // If we sliced the batch, it means we hit our processing limit, so we should stop.
      if (threadsToProcess.length < threads.length) {
        break;
      }
    } while (threads.length === BATCH_SIZE);

    const totalRuntime = Math.round(
      (new Date().getTime() - stats.startTime) / 1000
    );
    AppLogger.log(
      `Processed: ${stats.processedCount}, Labeled: ${stats.threadsLabeledCount}, Archived: ${stats.archivedCount}, Trashed: ${stats.trashedCount}, Skipped: ${stats.skippedCount}`
    );
    AppLogger.log(`Total runtime: ${totalRuntime} seconds.`);

    AppLogger.log('====== Gmail Cleanup Complete ======');

    _updateExecutionHistory({
      ...stats,
      totalRuntime,
      status: 'Success',
      completedAt: new Date().toISOString(),
    });
    properties.deleteProperty('cleanupState');
  } catch (e) {
    AppLogger.error('A critical error occurred during gmailCleanup.', e);
    _sendErrorNotification('Script Failure: gmailCleanup', e.stack);
    _updateExecutionHistory({
      ...stats,
      status: 'Failure',
      error: e.message,
      completedAt: new Date().toISOString(),
    });
  } finally {
    lock.releaseLock();
  }
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

      if (response.threads && response.threads.length > 0) {
        const threadIds = response.threads.map((t) => t.id);
        const threads = threadIds.map((id) => GmailApp.getThreadById(id));
        AppLogger.log(
          `Found a batch of ${threads.length} threads with attachments larger than ${MIN_SIZE_MB}MB.`
        );

        if (CONFIG.EXECUTION.DRY_RUN) {
          AppLogger.log(
            `[DRY RUN] Would apply label "${LABEL}" to ${threads.length} threads.`
          );
        } else {
          Utils.withRetry(
            () => label.addToThreads(threads),
            `apply label "${LABEL}" to ${threads.length} threads`
          );
          AppLogger.log(`Successfully labeled ${threads.length} threads.`);
        }
        totalLabeled += threads.length;
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
    SummaryService.sendSummaryReport(period, lastRun);
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
