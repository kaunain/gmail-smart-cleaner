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
    archivedCount: 0,
    labeledByLabel: {},
    trashedCount: 0,
    skippedCount: 0,
    startTime: new Date().getTime(),
  };

  let offset = stats.processedCount || 0;
  const BATCH_SIZE = CONFIG.EXECUTION.BATCH_SIZE;

  // Dynamically build the exclusion query for already processed labels
  let exclusionQuery = '';
  if (
    CONFIG.LABELS.REQUIRED_LABELS &&
    CONFIG.LABELS.REQUIRED_LABELS.length > 0
  ) {
    exclusionQuery = CONFIG.LABELS.REQUIRED_LABELS.map(
      (label) => `-label:"${label}"`
    ).join(' ');
  }

  let searchQuery = 'in:inbox';
  if (CONFIG.EXECUTION.SEARCH_OLDER_THAN_DAYS > 0) {
    searchQuery += ` older_than:${CONFIG.EXECUTION.SEARCH_OLDER_THAN_DAYS}d`;
  }
  // Exclude threads that already have any of the script's labels
  searchQuery += ` ${exclusionQuery}`;

  AppLogger.debug(`Using search query: "${searchQuery}"`);

  // Get total count at the beginning for a complete overview.
  let totalThreadsToProcess = 0;
  try {
    AppLogger.log('Calculating total number of threads to process...');
    totalThreadsToProcess = GmailApp.search(searchQuery).length;
    AppLogger.log(
      `Found ${totalThreadsToProcess} total threads matching criteria.`
    );
  } catch (e) {
    AppLogger.warning(
      'Could not calculate total thread count upfront. This can happen on very large inboxes. Proceeding with batch processing.'
    );
  }

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

      // Reverse the threads array to process oldest emails first
      threads.reverse();

      // --- Pre-processing for Important Emails ---
      // The script normally skips emails marked as 'important' by Gmail for safety.
      // This logic intercepts them and applies our own 'Important' label
      // so the action is visible and logged, instead of being skipped silently.
      const priorityLabelName = 'Priority';
      const priorityLabel = GmailApp.getUserLabelByName(priorityLabelName);
      if (priorityLabel) {
        for (const thread of threads) {
          // Check if Gmail considers it important AND we haven't already labeled it.
          const hasPriorityLabel = thread
            .getLabels()
            .some((l) => l.getName() === priorityLabelName);
          if (thread.isImportant() && !hasPriorityLabel) {
            AppLogger.log(
              `Gmail-marked important thread found: "${thread.getFirstMessageSubject()}". Applying '${priorityLabelName}' label.`
            );
            if (!CONFIG.EXECUTION.DRY_RUN) {
              thread.addLabel(priorityLabel);
              // Manually update stats for this pre-processing step
              stats.labeledByLabel[priorityLabelName] =
                (stats.labeledByLabel[priorityLabelName] || 0) + 1;
            }
          }
        }
      }
      // All threads (some now newly labeled) are passed on for further processing.

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

      // If debug mode is on, log the subjects of threads being processed.
      if (CONFIG.EXECUTION.DEBUG && threadsToProcess.length > 0) {
        AppLogger.log('--- Threads in this batch ---');
        threadsToProcess.forEach((thread, index) => {
          AppLogger.log(
            `  [${index + 1}] Subject: "${thread.getFirstMessageSubject()}"`
          );
        });
        AppLogger.log('-----------------------------');
      }

      // By capturing stats before and after, we can log the actions taken within this specific batch.
      const statsBefore = {
        ...stats,
        labeledByLabel: { ...stats.labeledByLabel },
      };

      CleanupService.processThreads(threadsToProcess, stats);

      const processedInBatch =
        stats.processedCount - statsBefore.processedCount;

      let totalLabeledInBatch = 0;
      for (const label in stats.labeledByLabel) {
        const after = stats.labeledByLabel[label] || 0;
        const before = statsBefore.labeledByLabel[label] || 0;
        if (after > before) {
          totalLabeledInBatch += after - before;
        }
      }

      const archivedInBatch = stats.archivedCount - statsBefore.archivedCount;
      const trashedInBatch = stats.trashedCount - statsBefore.trashedCount;
      const skippedInBatch = stats.skippedCount - statsBefore.skippedCount;
      let batchLog = `  > Batch actions: Processed: ${processedInBatch}, Archived: ${archivedInBatch}, Trashed: ${trashedInBatch}, Skipped: ${skippedInBatch}`;
      if (totalLabeledInBatch > 0) {
        batchLog += `, Labeled: ${totalLabeledInBatch}`;
      }
      AppLogger.log(batchLog);

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

    AppLogger.log('====== Gmail Cleanup Complete ======');

    const totalRuntime = Math.round(
      (new Date().getTime() - stats.startTime) / 1000
    );
    AppLogger.log('====== Final Execution Summary ======');
    AppLogger.log(`- Initial Threads Found: ${totalThreadsToProcess}`);
    AppLogger.log(`- Total Threads Processed: ${stats.processedCount}`);

    // Discrepancy check
    if (
      totalThreadsToProcess > 0 &&
      totalThreadsToProcess !== stats.processedCount
    ) {
      AppLogger.log(
        '  (Note: Processed count does not match initial count due to processing limits or script timeout.)'
      );
    }

    AppLogger.log('- Threads Labeled (by Label):');
    const labeledEntries = Object.entries(stats.labeledByLabel);
    if (labeledEntries.length > 0) {
      labeledEntries.forEach(([label, count]) => {
        if (count > 0) AppLogger.log(`    - ${label}: ${count}`);
      });
    } else {
      AppLogger.log('    (None)');
    }

    AppLogger.log(`- Threads Archived: ${stats.archivedCount}`);
    AppLogger.log(`- Threads Trashed: ${stats.trashedCount}`);
    AppLogger.log(
      `- Threads Skipped (due to safety rules): ${stats.skippedCount}`
    );
    AppLogger.log(`- Total Runtime: ${totalRuntime} seconds.`);
    AppLogger.log('=====================================');

    // Perform housekeeping by removing any unused labels
    _cleanupEmptyLabels();

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
 * Finds and removes any script-managed labels that are no longer associated with any threads.
 * This is a housekeeping function to prevent clutter. It will not remove protected labels.
 * @private
 */
function _cleanupEmptyLabels() {
  if (CONFIG.EXECUTION.DRY_RUN) {
    AppLogger.log('[DRY RUN] Skipping cleanup of empty labels.');
    return;
  }

  AppLogger.log('====== Starting Empty Label Cleanup ======');
  const protectedLabels = new Set(CONFIG.SAFETY.PROTECTED_LABELS);
  let removedCount = 0;

  CONFIG.LABELS.REQUIRED_LABELS.forEach((labelName) => {
    if (protectedLabels.has(labelName)) {
      AppLogger.debug(`Skipping protected label: "${labelName}"`);
      return;
    }

    try {
      const label = GmailApp.getUserLabelByName(labelName);
      if (label) {
        // Check if the label has any threads. getThreads(0, 1) is efficient.
        if (label.getThreads(0, 1).length === 0) {
          AppLogger.log(`Label "${labelName}" is empty. Deleting it.`);
          label.deleteLabel();
          removedCount++;
        }
      }
    } catch (e) {
      AppLogger.warning(
        `Could not process label "${labelName}" for cleanup. It might have been deleted already. Error: ${e.message}`
      );
    }
  });

  if (removedCount > 0) {
    AppLogger.log(`Removed ${removedCount} empty label(s).`);
  } else {
    AppLogger.log('No empty labels found to remove.');
  }
  AppLogger.log('====== Empty Label Cleanup Complete ======');
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
