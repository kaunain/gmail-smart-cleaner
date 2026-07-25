/**
 * @fileoverview Service for executing cleanup actions (trash, archive) on emails.
 */

const CleanupService = {
  /**
   * Processes a batch of GmailThread objects, applying classification and cleanup rules.
   * This is a legacy function; the main flow now uses processThread.
   *
   * @param {GoogleAppsScript.Gmail.GmailThread[]} threads Threads to process.
   * @param {Object} stats Mutable stats object.
   */
  processThreads(threads, stats) {
    for (const thread of threads) {
      this.processThread(thread, stats);
    }
  },

  /**
   * Processes a single GmailThread, applying all classification and cleanup rules.
   * @param {GoogleAppsScript.Gmail.GmailThread} thread The thread to process.
   * @param {Object} stats Mutable stats object to update.
   * @param {Map<string, GoogleAppsScript.Gmail.GmailLabel>} labelMap A map of all user labels for efficient lookup.
   */
  processThread(thread, stats, labelMap) {
    try {
      stats.processedCount++;
      const threadId = thread.getId();
      const subject = thread.getFirstMessageSubject() || '(No Subject)';
      const lastMessageDate = thread.getLastMessageDate();

      // 1. Classify thread to determine labels and metadata
      const classification = RuleEngine.classifyThread(thread);
      const newLabels = classification.labels || [];
      const from = classification.from || '';
      const domain = classification.domain || '';

      // Build a combined set of existing and new labels for rule evaluation
      const existingThreadLabels = thread
        .getLabels()
        .map((l) => l.getName().toLowerCase());
      const allLabels = new Set([
        ...existingThreadLabels,
        ...newLabels.map((l) => l.toLowerCase()),
      ]);

      let actionTaken = false;

      // 2. Evaluate Trash Rules
      const trashRules = CONFIG?.RULES?.TRASH_RULES || [];
      for (const rule of trashRules) {
        if (!rule || !rule.label || rule.days == null) continue;

        if (allLabels.has(String(rule.label).toLowerCase())) {
          const thresholdDate = new Date();
          thresholdDate.setDate(thresholdDate.getDate() - Number(rule.days));

          if (lastMessageDate < thresholdDate) {
            if (
              this.isSafeToDelete(thread, subject, [...allLabels], from, domain)
            ) {
              if (!CONFIG.EXECUTION.DRY_RUN) {
                thread.moveToTrash();
              }
              stats.trashedCount++;
              // Enhance stats for detailed logging
              const ruleKey = `label: ${rule.label}, days: ${rule.days}`;
              if (!stats.trashedByRule) {
                stats.trashedByRule = {};
              }
              stats.trashedByRule[ruleKey] =
                (stats.trashedByRule[ruleKey] || 0) + 1;
              actionTaken = true;
              break; // Action taken, no need to check other trash/archive rules
            } else {
              // Matched a trash rule but was stopped by a safety check
              stats.skippedCount++;
              actionTaken = true; // Considered "processed", so skip archiving
              break;
            }
          }
        }
      }

      // 3. Evaluate Archive Rules (only if not trashed or skipped)
      if (!actionTaken) {
        const archiveRules = CONFIG?.RULES?.ARCHIVE_RULES || [];
        for (const rule of archiveRules) {
          if (!rule || !rule.label) continue;

          if (allLabels.has(String(rule.label).toLowerCase())) {
            const isRead = !thread.isUnread();
            const archiveUnread = rule.archiveUnread === true;

            if (isRead || archiveUnread) {
              if (!CONFIG.EXECUTION.DRY_RUN) {
                thread.moveToArchive();
              }
              stats.archivedCount++;
              actionTaken = true;
              break; // Action taken
            }
          }
        }
      }

      // 4. Apply new labels (if any were identified)
      if (newLabels.length > 0) {
        let labelsApplied = 0;
        for (const labelName of newLabels) {
          // Check if the thread already has this label to avoid redundant API calls
          if (!existingThreadLabels.includes(labelName.toLowerCase())) {
            if (!CONFIG.EXECUTION.DRY_RUN) {
              const label = labelMap.get(labelName);
              if (label) {
                thread.addLabel(label);
              }
            }
            labelsApplied++;
            // Enhance stats for detailed logging
            if (!stats.labeledByLabel) {
              stats.labeledByLabel = {};
            }
            stats.labeledByLabel[labelName] =
              (stats.labeledByLabel[labelName] || 0) + 1;
          }
        }
        if (labelsApplied > 0) {
          stats.labeledCount += labelsApplied;
        }
      }

      // If no action was taken at all, it's implicitly "kept" but not "skipped"
      // A "skip" means a rule matched but was blocked by safety.
      if (!actionTaken && newLabels.length === 0) {
        // This case is implicitly a "keep", no stat change needed.
      }
    } catch (error) {
      stats.errorCount = (stats.errorCount || 0) + 1;
      AppLogger.error(
        `Failed to process thread "${thread?.getFirstMessageSubject?.() || 'unknown'}": ${error.message}`
      );
    }
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
    const dlog = CONFIG.EXECUTION.DEBUG ? AppLogger.debug : () => {};

    if (thread.hasStarredMessages()) {
      dlog(`  > [SAFETY CHECK] Result: FALSE. Reason: Thread is starred.`);
      return false;
    }

    if (thread.isImportant()) {
      dlog(
        `  > [SAFETY CHECK] Result: FALSE. Reason: Thread is marked as important by Gmail.`
      );
      return false;
    }

    if (CONFIG.SAFETY.ALLOW_DELETING_UNREAD === false && thread.isUnread()) {
      dlog(
        `  > [SAFETY CHECK] Result: FALSE. Reason: Thread is unread and ALLOW_DELETING_UNREAD is false.`
      );
      return false;
    }

    const safeSenders = (CONFIG.SAFETY.SAFE_SENDERS || []).map((e) =>
      e.toLowerCase()
    );
    const safeDomains = (CONFIG.SAFETY.SAFE_DOMAINS || []).map((d) =>
      d.toLowerCase()
    );
    const safeLabels = (CONFIG.SAFETY.PROTECTED_LABELS || []).map((l) =>
      l.toLowerCase()
    );
    const matchedSafeLabel = threadLabelNames.find((label) =>
      safeLabels.includes(label)
    );
    if (matchedSafeLabel) {
      dlog(
        `  > [SAFETY CHECK] Result: FALSE. Reason: Thread has protected label "${matchedSafeLabel}".`
      );
      return false;
    }

    if (safeSenders.includes(from)) {
      dlog(
        `  > [SAFETY CHECK] Result: FALSE. Reason: Sender "${from}" is in SAFE_SENDERS.`
      );
      return false;
    }

    if (domain && safeDomains.includes(domain)) {
      dlog(
        `  > [SAFETY CHECK] Result: FALSE. Reason: Domain "${domain}" is in SAFE_DOMAINS.`
      );
      return false;
    }

    dlog(`  > [SAFETY CHECK] Result: TRUE. All safety checks passed.`);
    return true;
  },
};

/*
  NOTE: The original processThreads function is being removed as its logic
  has been refactored into the new processThread function, which handles
  a single thread at a time. The new processThreads function above now
  simply delegates to the new single-thread processor.
*/
