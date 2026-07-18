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
  return template.evaluate().setTitle('Gmail Smart Cleaner Dashboard').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
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
  Logger.log('Starting initial setup...');
  LabelService.ensureLabelsExist();
  Logger.log('Initial setup complete. You can now run installTriggers() to automate the script.');
}

/**
 * Installs the time-based triggers required for automatic execution.
 * This function should be run manually once after the initial setup.
 * It will delete any old triggers and create new ones for daily cleanup and reports.
 */
function installTriggers() {
  Logger.log('Starting trigger installation...');
  TriggerService.installTriggers();
  Logger.log('Trigger installation complete.');
}

/**
 * Performs a health check of the script's configuration and triggers.
 * Can be run manually to diagnose issues.
 */
function runHealthCheck() {
  Logger.log('====== Starting Health Check ======');
  // 1. Validate configuration
  const configErrors = Utils.validateConfig();
  if (configErrors.length > 0) {
    Logger.error('Configuration validation failed:');
    configErrors.forEach(err => Logger.error(`- ${err}`));
  } else {
    Logger.log('Configuration validation passed.');
  }

  // 2. Check triggers (basic check)
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log(`Found ${triggers.length} installed trigger(s). Run installTriggers() to reset if needed.`);
  Logger.log('====== Health Check Complete ======');
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
    Logger.log('Could not acquire lock. Another instance is likely running. Exiting...');
    return;
  }

  // Validate configuration before running
  const configErrors = Utils.validateConfig();
  if (configErrors.length > 0) {
    const errorMsg = 'GmailCleanup stopped due to configuration errors.';
    Logger.error(errorMsg);
    _sendErrorNotification('Configuration Error', `${errorMsg}\n\n${configErrors.join('\n')}`);
    return;
  }

  Utils.resetStartTime(); // Ensure runtime calculation is correct for this execution slice
  Logger.log('====== Starting Gmail Cleanup ======');
  if (CONFIG.EXECUTION.DRY_RUN) {
    Logger.log('*** DRY RUN IS ENABLED. NO CHANGES WILL BE MADE. ***');
  }

  const properties = PropertiesService.getScriptProperties();
  const savedState = JSON.parse(properties.getProperty('cleanupState') || '{}');

  const stats = savedState.stats || {
    processedCount: 0,
    threadsLabeledCount: 0,
    archivedCount: 0,
    trashedCount: 0,
    skippedCount: 0,
    startTime: new Date().getTime(),
  };

  const continuationToken = savedState.continuationToken || null;
  const BATCH_SIZE = CONFIG.EXECUTION.BATCH_SIZE;

  let searchQuery = 'in:inbox';
  if (CONFIG.EXECUTION.SEARCH_OLDER_THAN_DAYS > 0) {
    searchQuery += ` older_than:${CONFIG.EXECUTION.SEARCH_OLDER_THAN_DAYS}d`;
  }

  try {
    let threads;
    let currentToken = continuationToken;

    do {
      const searchResult = currentToken
        ? GmailApp.continueSearch(currentToken, BATCH_SIZE)
        : GmailApp.search(searchQuery, 0, BATCH_SIZE);

      threads = searchResult.threads;
      currentToken = searchResult.continuationToken;

      if (threads.length > 0) {
        Logger.log(`Processing a batch of ${threads.length} threads.`);
        CleanupService.processThreads(threads, stats);
      }

      if (Utils.isTimeRunningOut()) {
        if (currentToken) {
          const newState = { continuationToken: currentToken, stats: stats };
          properties.setProperty('cleanupState', JSON.stringify(newState));
          ScriptApp.newTrigger('gmailCleanup').timeBased().after(60 * 1000).create();
          Logger.log('Approaching execution time limit. Pausing. Will resume automatically in 1 minute.');
        } else {
          // Ran out of time but also finished processing all threads in the last batch.
          Logger.log('Approaching time limit, but no more threads to process. Finishing run.');
        }
        lock.releaseLock();
        return; // Exit and wait for the next trigger or finish.
      }
    } while (threads.length === BATCH_SIZE && currentToken);

    const totalRuntime = Math.round((new Date().getTime() - stats.startTime) / 1000);
    Logger.log('====== Gmail Cleanup Complete ======');
    Logger.log(`Processed: ${stats.processedCount}, Labeled: ${stats.threadsLabeledCount}, Archived: ${stats.archivedCount}, Trashed: ${stats.trashedCount}, Skipped: ${stats.skippedCount}`);
    Logger.log(`Total runtime: ${totalRuntime} seconds.`);

    _updateExecutionHistory({ ...stats, totalRuntime, status: 'Success', completedAt: new Date().toISOString() });
    properties.deleteProperty('cleanupState');
  } catch (e) {
    Logger.error('A critical error occurred during gmailCleanup.', e);
    _sendErrorNotification('Script Failure: gmailCleanup', e.stack);
    _updateExecutionHistory({ ...stats, status: 'Failure', error: e.message, completedAt: new Date().toISOString() });
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
    Logger.log('Attachment cleanup is disabled in the configuration.');
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('Could not acquire lock for attachment cleanup. Exiting.');
    return;
  }

  Logger.log('====== Starting Attachment Cleanup ======');
  const { MIN_SIZE_MB, OLDER_THAN_DAYS, LABEL } = CONFIG.RULES.ATTACHMENT_CLEANUP;
  const searchQuery = `has:attachment larger:${MIN_SIZE_MB}m older_than:${OLDER_THAN_DAYS}d -label:"${LABEL}"`;

  try {
    const label = GmailApp.getUserLabelByName(LABEL);
    if (!label) {
      Logger.error(`Attachment cleanup label "${LABEL}" does not exist. Please run initial setup.`);
      return;
    }

    const threads = GmailApp.search(searchQuery, 0, CONFIG.EXECUTION.BATCH_SIZE);
    if (threads.length === 0) {
      Logger.log('No new threads with large attachments found.');
      return;
    }

    Logger.log(`Found ${threads.length} threads with attachments larger than ${MIN_SIZE_MB}MB.`);

    if (CONFIG.EXECUTION.DRY_RUN) {
      Logger.log(`[DRY RUN] Would apply label "${LABEL}" to ${threads.length} threads.`);
    } else {
      Utils.withRetry(() => label.addToThreads(threads), `apply label "${LABEL}" to ${threads.length} threads`);
      Logger.log(`Successfully labeled ${threads.length} threads.`);
    }
  } catch (e) {
    Logger.error('A critical error occurred during cleanupAttachments.', e);
    _sendErrorNotification('Script Failure: cleanupAttachments', e.stack);
  } finally {
    lock.releaseLock();
    Logger.log('====== Attachment Cleanup Complete ======');
  }
}

/**
 * Retrieves the execution history for the dashboard.
 * This function is called from the HTML template.
 * @returns {object[]} An array of execution history objects.
 */
function getExecutionHistory() {
  const properties = PropertiesService.getScriptProperties();
  const history = JSON.parse(properties.getProperty('executionHistory') || '[]');
  return history;
}

/**
 * Updates the execution history in PropertiesService.
 * @param {object} newRunStats The statistics of the completed run.
 * @private
 */
function _updateExecutionHistory(newRunStats) {
  const properties = PropertiesService.getScriptProperties();
  const history = getExecutionHistory();
  history.unshift(newRunStats); // Add new run to the beginning

  // Keep history limited to the configured count
  const trimmedHistory = history.slice(0, CONFIG.EXECUTION.EXECUTION_HISTORY_COUNT);

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
    SummaryService.sendSummaryReport(period, lastRun, lastRun.totalRuntime);
  } else {
    Logger.log(`No successful run found in history. Skipping ${period.toLowerCase()} report.`);
  }
}

function sendWeeklySummary() {
  _sendSummaryReport('Weekly');
}

function sendMonthlySummary() {
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

  try {
    MailApp.sendEmail(recipient, `[Gmail Smart Cleaner] ${subject}`, `A critical error occurred in the Gmail Smart Cleaner script:\n\n${body}`);
  } catch (e) {
    Logger.error('Failed to send error notification email.', e);
  }
}