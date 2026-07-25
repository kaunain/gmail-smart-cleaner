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
  if (CONFIG.EXECUTION.DRY_RUN) {
    AppLogger.warn(
      'DRY_RUN is currently ENABLED. The script will not make any changes.'
    );
  } else {
    AppLogger.log('DRY_RUN is DISABLED. The script will perform real actions.');
  }

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

  // Load state for resumable execution
  const runState = StateService.loadState();
  const { stats, processedThreadIds } = runState;

  // Make sure all configured labels exist before processing cleanup.
  LabelService.ensureLabelsExist();

  const searchQuery = GmailUtils.buildSearchQuery();

  try {
    // Fetch the Priority label once outside the loop for performance.
    const priorityLabelName = 'Priority';
    const priorityLabel = GmailApp.getUserLabelByName(priorityLabelName);

    // Fetch all user labels once and create a map for efficient lookups.
    const userLabels = GmailApp.getUserLabels();
    const labelMap = new Map(userLabels.map((l) => [l.getName(), l]));

    // Process threads in batches to avoid exceeding API quotas and memory limits.
    let pageToken = null;
    do {
      const result = GmailUtils.searchAndProcessBatch(
        searchQuery,
        processedThreadIds,
        pageToken,
        (thread) => {
          // This is a "callback" function that processes a single thread.
          // --- Pre-processing for Important Emails ---
          if (priorityLabel) {
            const hasPriorityLabel = thread
              .getLabels()
              .some((l) => l.getName() === priorityLabelName);
            if (thread.isImportant() && !hasPriorityLabel) {
              AppLogger.log(
                `Gmail-marked important thread found: "${thread.getFirstMessageSubject()}". Applying '${priorityLabelName}' label.`
              );
              if (!CONFIG.EXECUTION.DRY_RUN) {
                thread.addLabel(priorityLabel);
                stats.labeledCount++;
              }
            }
          }
          // Process the thread using CleanupService
          CleanupService.processThread(thread, stats, labelMap);
        }
      );

      // Update state with the IDs processed in this batch.
      processedThreadIds.push(...result.processedIds);
      pageToken = result.nextPageToken;

      // Check if we have reached the processing limit
      if (
        CONFIG.EXECUTION.MAX_THREADS_TO_PROCESS > 0 &&
        stats.processedCount >= CONFIG.EXECUTION.MAX_THREADS_TO_PROCESS
      ) {
        AppLogger.log(
          `Reached MAX_THREADS_TO_PROCESS limit of ${CONFIG.EXECUTION.MAX_THREADS_TO_PROCESS}. Pausing execution.`
        );
        // Setting pageToken to null will stop the do-while loop.
        pageToken = null;
      }

      // Check for timeout after each batch.
      if (Utils.isTimeRunningOut()) {
        AppLogger.log(
          'Execution time limit is approaching. Saving state and pausing.'
        );
        StateService.saveState(runState, result.processedIds, false);
        return; // Exit function to be resumed later
      }
    } while (pageToken);

    /*
    const processedInThisRun = [];

    for (const thread of sortedThreads) {
      // --- Pre-processing for Important Emails ---
      if (priorityLabel) {
        // Note: We use the pre-fetched priorityLabel object here.
        const hasPriorityLabel = thread
          .getLabels()
          .some((l) => l.getName() === priorityLabelName);
        if (thread.isImportant() && !hasPriorityLabel) {
          AppLogger.log(
            `Gmail-marked important thread found: "${thread.getFirstMessageSubject()}". Applying '${priorityLabelName}' label.`
          );
          if (!CONFIG.EXECUTION.DRY_RUN) {
            thread.addLabel(priorityLabel);
            stats.labeledCount++;
          }
        }
      }

      // Process a single thread
      CleanupService.processThread(thread, stats, labelMap);
      processedInThisRun.push(thread.getId());

      // Check for timeout after each thread
      if (Utils.isTimeRunningOut()) {
        AppLogger.log(
          'Execution time limit is approaching. Saving state and pausing.'
        );
        StateService.saveState(runState, processedInThisRun, false);
        return; // Exit function to be resumed later
      }
    }
    */

    // If the loop completes, all threads have been processed.
    StateService.saveState(runState, [], true); // Mark as complete

    AppLogger.log('====== Gmail Cleanup Complete ======');

    const totalRuntime = Utils.getScriptRuntime();
    const {
      processedCount,
      labeledCount,
      trashedCount,
      archivedCount,
      skippedCount,
      errorCount,
    } = stats;

    AppLogger.log('====== Final Execution Summary ======');
    AppLogger.log(`- Threads Processed: ${processedCount}`);
    AppLogger.log(`- Total Threads Labeled: ${labeledCount}`);
    if (labeledCount > 0 && stats.labeledByLabel) {
      Object.entries(stats.labeledByLabel).forEach(([label, count]) => {
        AppLogger.log(`  - Applied Label "${label}": ${count} time(s)`);
      });
    } else {
      AppLogger.log(
        '  - WHY: No threads matched any CLASSIFICATION_RULES, or all matched threads already had the required labels.'
      );
    }

    AppLogger.log(`- Total Threads Selected For Trash: ${trashedCount}`);
    if (trashedCount > 0 && stats.trashedByRule) {
      Object.entries(stats.trashedByRule).forEach(([rule, count]) => {
        AppLogger.log(`  - Matched Trash Rule "${rule}": ${count} time(s)`);
      });
    } else {
      AppLogger.log(
        '  - WHY: No threads met the criteria for any TRASH_RULES (e.g., wrong label, not old enough), or all that did were protected by safety rules.'
      );
    }

    AppLogger.log(
      `- Threads Actually Trashed: ${CONFIG.EXECUTION.DRY_RUN ? 0 : trashedCount}`
    );
    if (CONFIG.EXECUTION.DRY_RUN && trashedCount > 0) {
      AppLogger.log(
        '  - WHY: DRY_RUN is enabled, so no threads were actually trashed.'
      );
    }

    AppLogger.log(`- Threads Selected For Archive: ${archivedCount}`);
    if (archivedCount === 0) {
      AppLogger.log(
        '  - WHY: No threads met the criteria for any ARCHIVE_RULES (e.g., wrong label, unread status).'
      );
    }

    AppLogger.log(
      `- Threads Actually Archived: ${CONFIG.EXECUTION.DRY_RUN ? 0 : archivedCount}`
    );
    if (CONFIG.EXECUTION.DRY_RUN && archivedCount > 0) {
      AppLogger.log(
        '  - WHY: DRY_RUN is enabled, so no threads were actually archived.'
      );
    }

    AppLogger.log(`- Threads Skipped: ${skippedCount}`);
    if (skippedCount === 0) {
      AppLogger.log(
        '  - WHY: No threads were skipped by safety checks or rule conflicts.'
      );
    }

    AppLogger.log(`- Threads Failed: ${errorCount || 0}`);
    if ((errorCount || 0) === 0) {
      AppLogger.log('  - WHY: No thread processing errors occurred.');
    }
    AppLogger.log('');
    AppLogger.log(`- Total Runtime: ${totalRuntime} seconds.`);
    AppLogger.log(`- Dry Run Mode: ${CONFIG.EXECUTION.DRY_RUN}`);
    AppLogger.log('=====================================');

    // Perform housekeeping by removing any unused labels
    _cleanupEmptyLabels();

    _updateExecutionHistory({
      ...stats,
      totalRuntime,
      status: 'Success',
      completedAt: new Date().toISOString(),
    });
  } catch (e) {
    AppLogger.error('A critical error occurred during gmailCleanup.', e);
    _sendErrorNotification('Script Failure: gmailCleanup', e.stack);
    _updateExecutionHistory({
      ...stats,
      status: 'Failure',
      error: e.message,
      completedAt: new Date().toISOString(),
    });
    StateService.saveState(runState, [], false); // Save state on failure
  } finally {
    RuleEngine.clearCache(); // Ensure cache is cleared after every run.
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

      const threads = response.threads || [];
      if (threads.length > 0) {
        const threadIds = threads.map((t) => t.id);
        AppLogger.log(
          `Found a batch of ${threads.length} threads with attachments larger than ${MIN_SIZE_MB}MB.`
        );

        if (CONFIG.EXECUTION.DRY_RUN) {
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
  if (CONFIG.EXECUTION.DRY_RUN) {
    AppLogger.log('[DRY RUN] Skipping cleanup of empty labels.');
    return;
  }

  AppLogger.log('====== Starting Empty Label Cleanup ======');
  const protectedLabels = new Set(
    (CONFIG.SAFETY.PROTECTED_LABELS || []).map((labelName) =>
      labelName.toLowerCase()
    )
  );
  let removedCount = 0;

  const userLabels = GmailApp.getUserLabels();
  userLabels.forEach((label) => {
    const labelName = label.getName();

    // Safety Check: Do not delete protected labels, even if they are empty.
    if (protectedLabels.has(labelName.toLowerCase())) {
      if (CONFIG.EXECUTION.DEBUG) {
        AppLogger.debug(`Skipping protected label "${labelName}".`);
      }
      return;
    }

    try {
      const escapedLabelName = labelName.replace(/"/g, '\\"');
      const searchQuery = `label:"${escapedLabelName}" -in:trash -in:spam`;
      // Use the more efficient advanced service to check for existence, not count.
      const response = Gmail.Users.Threads.list('me', {
        q: searchQuery,
        maxResults: 1,
      });

      if (!response.threads || response.threads.length === 0) {
        AppLogger.log(`Label "${labelName}" is empty. Deleting it.`);
        label.deleteLabel();
        removedCount++;
      } else if (CONFIG.EXECUTION.DEBUG) {
        AppLogger.debug(
          `Skipping label "${labelName}" because it still has ${response.threads.length > 0 ? 'at least 1' : 'unknown'} non-trashed/non-spam thread(s).`
        );
      }
    } catch (e) {
      AppLogger.warn(
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
