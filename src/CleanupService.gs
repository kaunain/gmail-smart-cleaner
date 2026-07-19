/**
 * @fileoverview Service for executing cleanup actions (trash, archive) on emails.
 */

const CleanupService = {
  /**
   * Processes a batch of threads, applying classification and cleanup rules.
   * @param {GoogleAppsScript.Gmail.GmailThread[]} threads The threads to process.
   * @param {object} stats A statistics object to update.
   */
  processThreads(threads, stats) {
    const threadsToTrash = [];
    const threadsToArchive = [];
    const labelMap = new Map(); // Maps labelName -> [threads]

    for (const thread of threads) {
      stats.processedCount++;
      const subject = thread.getFirstMessageSubject();

      // 1. Classify and Label
      const {
        labels: newLabels,
        from,
        domain,
      } = RuleEngine.classifyThread(thread);
      if (newLabels.length > 0) {
        stats.threadsLabeledCount++; // Increment count of threads that received at least one label
        newLabels.forEach((labelName) => {
          if (!labelMap.has(labelName)) {
            labelMap.set(labelName, []);
          }
          labelMap.get(labelName).push(thread);
        });
      }

      // 2. Check for Cleanup Actions (Trash/Archive)
      const threadLabels = thread.getLabels().map((l) => l.getName());
      const allLabels = [...new Set([...threadLabels, ...newLabels])];
      let actionTaken = false;

      // Check Trash Rules
      for (const rule of CONFIG.RULES.TRASH_RULES) {
        if (allLabels.includes(rule.label)) {
          const lastMessageDate = thread.getLastMessageDate();
          const thresholdDate = new Date();
          thresholdDate.setDate(thresholdDate.getDate() - rule.days);

          if (lastMessageDate < thresholdDate) {
            if (this.isSafeToDelete(thread, subject, allLabels, from, domain)) {
              threadsToTrash.push(thread);
              stats.trashedCount++;
              actionTaken = true;
            } else {
              stats.skippedCount++;
            }
            break; // A thread can only be trashed once
          }
        }
      }

      // Check Archive Rules (only if not trashed and is read)
      if (!actionTaken && thread.isUnread() === false) {
        for (const rule of CONFIG.RULES.ARCHIVE_RULES) {
          if (allLabels.includes(rule.label)) {
            threadsToArchive.push(thread);
            stats.archivedCount++;
            break; // A thread can only be archived once
          }
        }
      }
    }

    // 3. Execute Batch Actions
    if (CONFIG.EXECUTION.DRY_RUN) {
      if (threadsToTrash.length > 0)
        Logger.log(`[DRY RUN] Would trash ${threadsToTrash.length} threads.`);
      if (threadsToArchive.length > 0)
        Logger.log(
          `[DRY RUN] Would archive ${threadsToArchive.length} threads.`
        );
      labelMap.forEach((threads, labelName) => {
        Logger.log(
          `[DRY RUN] Would apply label "${labelName}" to ${threads.length} threads.`
        );
      });
    } else {
      if (threadsToTrash.length > 0) {
        Utils.withRetry(
          () => GmailApp.moveThreadsToTrash(threadsToTrash),
          `trash ${threadsToTrash.length} threads`
        );
        Logger.log(`Trashed ${threadsToTrash.length} threads.`);
      }
      if (threadsToArchive.length > 0) {
        Utils.withRetry(
          () => GmailApp.moveThreadsToArchive(threadsToArchive),
          `archive ${threadsToArchive.length} threads`
        );
        Logger.log(`Archived ${threadsToArchive.length} threads.`);
      }
      labelMap.forEach((threads, labelName) => {
        const label = GmailApp.getUserLabelByName(labelName);
        if (label) {
          Utils.withRetry(
            () => label.addToThreads(threads),
            `apply label "${labelName}" to ${threads.length} threads`
          );
          Logger.log(
            `Applied label "${labelName}" to ${threads.length} threads.`
          );
        }
      });
    }
  },

  /**
   * Checks if a thread is safe to be moved to trash.
   * @param {GoogleAppsScript.Gmail.GmailThread} thread The thread to check.
   * @param {string} subject The subject of the thread for logging.
   * @param {string[]} threadLabelNames Lowercase names of all labels on the thread.
   * @param {string} from The lowercase sender email address.
   * @param {string} domain The lowercase sender domain.
   * @returns {boolean} True if it's safe to delete, false otherwise.
   */
  isSafeToDelete(thread, subject, threadLabelNames, from, domain) {
    if (thread.isStarred()) {
      Logger.debug(`Skipping starred thread: "${subject}"`);
      return false;
    } // Fast check
    if (thread.isImportant()) {
      Logger.debug(`Skipping important thread: "${subject}"`);
      return false;
    } // Fast check
    if (!CONFIG.SAFETY.ALLOW_DELETING_UNREAD && thread.isUnread()) {
      Logger.debug(`Skipping unread thread as per safety config: "${subject}"`);
      return false;
    }
    // Check labels before making an expensive API call. Also fixes a case-sensitivity bug.
    if (
      threadLabelNames.some((label) =>
        SAFE_LABELS.includes(label.toLowerCase())
      )
    ) {
      Logger.debug(`Skipping thread with safe label: "${subject}"`);
      return false;
    }
    if (SAFE_SENDER_EMAILS.includes(from)) {
      Logger.debug(`Skipping thread from safe sender "${from}": "${subject}"`);
      return false;
    }
    if (domain && SAFE_SENDER_DOMAINS.includes(domain)) {
      Logger.debug(
        `Skipping thread from safe domain "${domain}": "${subject}"`
      );
      return false;
    }
    return true;
  },
};
