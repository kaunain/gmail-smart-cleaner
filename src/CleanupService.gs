/**
 * @fileoverview Service for executing cleanup actions (trash, archive) on emails.
 */

const CleanupService = {
  /**
   * Processes a batch of GmailThread objects, applying classification and cleanup rules.
   *
   * @param {GoogleAppsScript.Gmail.GmailThread[]} threads Threads to process.
   * @param {Object} stats Mutable stats object.
   */
  processThreads(threads, stats) {
    const threadsToTrash = [];
    const threadsToArchive = [];
    const labelMap = new Map(); // labelName -> GmailThread[]

    for (const thread of threads) {
      try {
        stats.processedCount++;

        const subject = thread.getFirstMessageSubject() || '(no subject)';

        // 1) Classify thread
        const classification = RuleEngine.classifyThread(thread);
        const newLabels = classification.labels || [];
        const from = classification.from || '';
        const domain = classification.domain || '';

        if (newLabels.length > 0) {
          stats.threadsLabeledCount++;

          for (const labelName of newLabels) {
            if (!labelMap.has(labelName)) {
              labelMap.set(labelName, []);
            }
            labelMap.get(labelName).push(thread);
          }
        }

        // Build a normalized label set
        const existingThreadLabels = thread
          .getLabels()
          .map((l) => l.getName().toLowerCase());

        const allLabels = new Set([
          ...existingThreadLabels,
          ...newLabels.map((l) => l.toLowerCase()),
        ]);

        let actionTaken = false;

        // 2) Trash rules
        const trashRules = CONFIG?.RULES?.TRASH_RULES || [];
        for (const rule of trashRules) {
          if (!rule || !rule.label || !rule.days) continue;

          if (allLabels.has(String(rule.label).toLowerCase())) {
            const lastMessageDate = thread.getLastMessageDate();
            const thresholdDate = new Date();
            thresholdDate.setDate(thresholdDate.getDate() - Number(rule.days));

            if (lastMessageDate < thresholdDate) {
              if (
                this.isSafeToDelete(
                  thread,
                  subject,
                  [...allLabels],
                  from,
                  domain
                )
              ) {
                threadsToTrash.push(thread);
                stats.trashedCount++;
                actionTaken = true;
              } else {
                stats.skippedCount++;
              }
            }
            break;
          }
        }

        // 3) Archive rules (only if not trashed and thread is read)
        if (!actionTaken && !thread.isUnread()) {
          const archiveRules = CONFIG?.RULES?.ARCHIVE_RULES || [];
          for (const rule of archiveRules) {
            if (!rule || !rule.label) continue;

            if (allLabels.has(String(rule.label).toLowerCase())) {
              threadsToArchive.push(thread);
              stats.archivedCount++;
              actionTaken = true;
              break;
            }
          }
        }
      } catch (error) {
        stats.errorsCount = (stats.errorsCount || 0) + 1;
        Logger.error(
          `Failed to process thread "${thread?.getFirstMessageSubject?.() || 'unknown'}": ${error.message}`
        );
      }
    }

    // 4) Execute actions
    if (CONFIG?.EXECUTION?.DRY_RUN) {
      if (threadsToTrash.length > 0) {
        Logger.log(`[DRY RUN] Would trash ${threadsToTrash.length} threads.`);
      }
      if (threadsToArchive.length > 0) {
        Logger.log(
          `[DRY RUN] Would archive ${threadsToArchive.length} threads.`
        );
      }
      labelMap.forEach((labelThreads, labelName) => {
        Logger.log(
          `[DRY RUN] Would apply label "${labelName}" to ${labelThreads.length} threads.`
        );
      });
      return;
    }

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

    labelMap.forEach((labelThreads, labelName) => {
      const label = GmailApp.getUserLabelByName(labelName);
      if (!label) {
        Logger.warn(`Label "${labelName}" not found.`);
        return;
      }

      Utils.withRetry(
        () => label.addToThreads(labelThreads),
        `apply label "${labelName}" to ${labelThreads.length} threads`
      );

      Logger.log(
        `Applied label "${labelName}" to ${labelThreads.length} threads.`
      );
    });
  },

  /**
   * Checks if a thread is safe to delete.
   *
   * @param {GoogleAppsScript.Gmail.GmailThread} thread Gmail thread.
   * @param {string} subject Thread subject for logging.
   * @param {string[]} threadLabelNames Normalized label names.
   * @param {string} from Sender email.
   * @param {string} domain Sender domain.
   * @returns {boolean}
   */
  isSafeToDelete(thread, subject, threadLabelNames, from, domain) {
    if (thread.hasStarredMessages()) {
      Logger.debug(`Skipping starred thread: "${subject}"`);
      return false;
    }

    if (thread.isImportant()) {
      Logger.debug(`Skipping important thread: "${subject}"`);
      return false;
    }

    if (CONFIG?.SAFETY?.ALLOW_DELETING_UNREAD === false && thread.isUnread()) {
      Logger.debug(`Skipping unread thread as per safety config: "${subject}"`);
      return false;
    }

    const safeLabels = (SAFE_LABELS || []).map((l) => String(l).toLowerCase());
    if (
      threadLabelNames.some((label) =>
        safeLabels.includes(String(label).toLowerCase())
      )
    ) {
      Logger.debug(`Skipping thread with safe label: "${subject}"`);
      return false;
    }

    const safeEmails = (SAFE_SENDER_EMAILS || []).map((e) =>
      String(e).toLowerCase()
    );
    if (safeEmails.includes(String(from).toLowerCase())) {
      Logger.debug(`Skipping thread from safe sender "${from}": "${subject}"`);
      return false;
    }

    const safeDomains = (SAFE_SENDER_DOMAINS || []).map((d) =>
      String(d).toLowerCase()
    );
    if (domain && safeDomains.includes(String(domain).toLowerCase())) {
      Logger.debug(
        `Skipping thread from safe domain "${domain}": "${subject}"`
      );
      return false;
    }

    return true;
  },
};
