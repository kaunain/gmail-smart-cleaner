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
    Logger.log('Could not acquire lock. Another instance is likely running. Exiting.');
    return;
  }

  Logger.log('====== Starting Gmail Cleanup ======');
  if (CONFIG.EXECUTION.DRY_RUN) {
    Logger.log('*** DRY RUN IS ENABLED. NO CHANGES WILL BE MADE. ***');
  }

  const properties = PropertiesService.getScriptProperties();
  const savedState = JSON.parse(properties.getProperty('cleanupState') || '{}');

  const stats = savedState.stats || {
    processedCount: 0, labeledCount: 0, archivedCount: 0,
    trashedCount: 0, skippedCount: 0, startTime: new Date().getTime(),
  };
  let page = savedState.page || 0;
  const BATCH_SIZE = CONFIG.EXECUTION.BATCH_SIZE;
  const searchQuery = 'in:inbox'; // Can be configured later if needed

  try {
    let threads;
    do {
      threads = GmailApp.search(searchQuery, page * BATCH_SIZE, BATCH_SIZE);
      
      if (threads.length > 0) {
        Logger.log(`Processing page ${page + 1} with ${threads.length} threads.`);
        CleanupService.processThreads(threads, stats);
      }

      if (Utils.isTimeRunningOut()) {
        const newState = { page: page + 1, stats: stats };
        properties.setProperty('cleanupState', JSON.stringify(newState));
        ScriptApp.newTrigger('gmailCleanup').timeBased().after(60 * 1000).create();
        Logger.log(`Approaching execution time limit. Pausing. Will resume on page ${page + 2}.`);
        lock.releaseLock();
        return; // Exit and wait for the next trigger
      }
      page++;
    } while (threads.length === BATCH_SIZE);

    const totalRuntime = Math.round((new Date().getTime() - stats.startTime) / 1000);
    Logger.log('====== Gmail Cleanup Complete ======');
    Logger.log(`Processed: ${stats.processedCount}, Labeled: ${stats.labeledCount}, Archived: ${stats.archivedCount}, Trashed: ${stats.trashedCount}, Skipped: ${stats.skippedCount}`);
    Logger.log(`Total runtime: ${totalRuntime} seconds.`);

    properties.setProperty('lastRunStats', JSON.stringify({ ...stats, totalRuntime }));
    properties.deleteProperty('cleanupState');
  } catch (e) {
    Logger.error('An error occurred during gmailCleanup.', e);
  } finally {
    lock.releaseLock();
  }
}

function sendWeeklySummary() {
  const statsJson = PropertiesService.getScriptProperties().getProperty('lastRunStats');
  if (statsJson) SummaryService.sendSummaryReport('Weekly', JSON.parse(statsJson), JSON.parse(statsJson).totalRuntime);
  else Logger.log('No stats found for the last run. Skipping weekly report.');
}

function sendMonthlySummary() {
  const statsJson = PropertiesService.getScriptProperties().getProperty('lastRunStats');
  if (statsJson) SummaryService.sendSummaryReport('Monthly', JSON.parse(statsJson), JSON.parse(statsJson).totalRuntime);
  else Logger.log('No stats found for the last run. Skipping monthly report.');
}