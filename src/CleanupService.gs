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

        const subject = thread.getFirstMessageSubject() || '(No Subject)';
        AppLogger.debug(
          `Processing thread: "${subject}" (ID: ${thread.getId()})`
        );

        // 1) Classify thread
        const classification = RuleEngine.classifyThread(thread);
        const newLabels = classification.labels || [];
        const from = (classification.from || '').toLowerCase();
        const domain = classification.domain || '';

        if (newLabels.length > 0) {
          stats.threadsLabeledCount++;

          for (const labelName of newLabels) {
            if (!labelMap.has(labelName)) {
              labelMap.set(labelName, []);
            }
            labelMap.get(labelName).push(thread);
          }
          AppLogger.debug(`  > Applying new labels: [${newLabels.join(', ')}]`);
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
                AppLogger.debug(
                  `  > Matched TRASH rule: {label: "${rule.label}", days: ${rule.days}}. Queued for trash.`
                );
                actionTaken = true;
              } else {
                stats.skippedCount++; // Reason is logged inside isSafeToDelete
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
              AppLogger.debug(
                `  > Matched ARCHIVE rule: {label: "${rule.label}"}. Queued for archive.`
              );
              actionTaken = true;
              break;
            }
          }
        }

        if (!actionTaken && newLabels.length === 0) {
          AppLogger.debug(`  > No action taken.`);
        }
      } catch (error) {
        stats.errorsCount = (stats.errorsCount || 0) + 1;
        AppLogger.error(
          `Failed to process thread "${thread?.getFirstMessageSubject?.() || 'unknown'}": ${error.message}`
        );
      }
    }

    // 4) Execute actions
    if (CONFIG?.EXECUTION?.DRY_RUN) {
      if (threadsToTrash.length > 0)
        AppLogger.log(
          `[DRY RUN] Would trash ${threadsToTrash.length} threads.`
        );
      if (threadsToArchive.length > 0)
        AppLogger.log(
          `[DRY RUN] Would archive ${threadsToArchive.length} threads.`
        );
      labelMap.forEach((labelThreads, labelName) => {
        AppLogger.log(
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
      AppLogger.log(`Trashed ${threadsToTrash.length} threads.`);
    }

    if (threadsToArchive.length > 0) {
      Utils.withRetry(
        () => GmailApp.moveThreadsToArchive(threadsToArchive),
        `archive ${threadsToArchive.length} threads`
      );
      AppLogger.log(`Archived ${threadsToArchive.length} threads.`);
    }

    labelMap.forEach((labelThreads, labelName) => {
      const label = GmailApp.getUserLabelByName(labelName);
      if (!label) {
        AppLogger.warn(`Label "${labelName}" not found.`);
        return;
      }

      Utils.withRetry(
        () => label.addToThreads(labelThreads),
        `apply label "${labelName}" to ${labelThreads.length} threads`
      );

      AppLogger.log(
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
      AppLogger.debug(`  > Skipping trash for starred thread: "${subject}"`);
      return false;
    }

    if (thread.isImportant()) {
      AppLogger.debug(`  > Skipping trash for important thread: "${subject}"`);
      return false;
    }

    if (CONFIG?.SAFETY?.ALLOW_DELETING_UNREAD === false && thread.isUnread()) {
      AppLogger.debug(
        `  > Skipping trash for unread thread as per safety config: "${subject}"`
      );
      return false;
    }

    const safeLabels = (SAFE_LABELS || []).map((l) => String(l).toLowerCase());
    const matchedSafeLabel = threadLabelNames.find((label) =>
      safeLabels.includes(String(label).toLowerCase())
    );
    if (matchedSafeLabel) {
      AppLogger.debug(
        `  > Skipping trash for thread with safe label "${matchedSafeLabel}": "${subject}"`
      );
      return false;
    }

    if ((SAFE_SENDER_EMAILS || []).includes(from)) {
      AppLogger.debug(
        `  > Skipping trash for thread from safe sender "${from}": "${subject}"`
      );
      return false;
    }

    if (domain && (SAFE_SENDER_DOMAINS || []).includes(domain)) {
      AppLogger.debug(
        `  > Skipping trash for thread from safe domain "${domain}": "${subject}"`
      );
      return false;
    }

    return true;
  },
};
