/**
 * @fileoverview Main entry point for the Gmail Smart Cleaner script.
 * Contains user-facing functions that can be run from the Apps Script editor or via triggers.
 */

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

    properties.setProperty('lastRunStats', JSON.stringify({ ...stats, totalRuntime }));
    properties.deleteProperty('cleanupState');
  } catch (e) {
    Logger.error('A critical error occurred during gmailCleanup.', e);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Helper function to send a summary report for a given period.
 * @param {string} period The reporting period (e.g., "Weekly", "Monthly").
 * @private
 */
function _sendSummaryReport(period) {
  const statsJson = PropertiesService.getScriptProperties().getProperty('lastRunStats');
  if (statsJson) {
    const lastRun = JSON.parse(statsJson);
    SummaryService.sendSummaryReport(period, lastRun, lastRun.totalRuntime);
  } else {
    Logger.log(`No stats found for the last run. Skipping ${period.toLowerCase()} report.`);
  }
}

function sendWeeklySummary() {
  _sendSummaryReport('Weekly');
}

function sendMonthlySummary() {
  _sendSummaryReport('Monthly');
}