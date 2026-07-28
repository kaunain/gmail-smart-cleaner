/**
 * @fileoverview Service for executing email classification and 2-step deletion workflow.
 */

const CleanupService = {
  /**
   * Processes a single GmailThread, applying classification and identifying delete candidates.
   * NOTE: This function NEVER moves threads to Trash. Step 2 (trashDeleteLabeledEmails) moves them to Trash.
   * @param {GoogleAppsScript.Gmail.GmailThread} thread The thread to process.
   * @param {Object} stats Mutable stats object to update.
   * @param {Map<string, GoogleAppsScript.Gmail.GmailLabel>} labelMap A map of all user labels.
   * @param {GoogleAppsScript.Gmail.GmailLabel | null} priorityLabel The pre-fetched 'Priority' label object.
   */
  processThread(thread, stats, labelMap, priorityLabel) {
    try {
      stats.processedCount++;
      const subject = thread.getFirstMessageSubject() || '(No Subject)';
      const lastMessageDate = thread.getLastMessageDate();

      const existingThreadLabels = thread
        .getLabels()
        .map((l) => l.getName().toLowerCase());
      let labelsAppliedInThisRun = 0;

      // --- Pre-processing for Important Emails ---
      if (priorityLabel && thread.isImportant()) {
        const priorityLabelName = priorityLabel.getName();
        if (!existingThreadLabels.includes(priorityLabelName.toLowerCase())) {
          AppLogger.log(
            `Gmail-marked important thread found: "${subject}". Applying '${priorityLabelName}' label.`
          );
          if (!Utils.isClassificationDryRun()) {
            thread.addLabel(priorityLabel);
          }
          labelsAppliedInThisRun++;
          stats.labeledByLabel[priorityLabelName] =
            (stats.labeledByLabel[priorityLabelName] || 0) + 1;
        }
      }

      // 1. Classify thread to determine labels and metadata
      const classification = RuleEngine.classifyThread(thread);
      const newLabels = classification.labels || [];
      const from = classification.from || '';
      const domain = classification.domain || '';

      if (newLabels.length > 0) {
        stats.classifiedCount = (stats.classifiedCount || 0) + 1;
      }

      // Build a combined set of existing and new labels for rule evaluation
      const allLabels = new Set([
        ...existingThreadLabels,
        ...newLabels.map((l) => l.toLowerCase()),
      ]);

      let isDeleteCandidate = false;
      let isSafetyBlocked = false;

      // 2. Evaluate Trash / Delete candidate Rules
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
              isDeleteCandidate = true;
              if (!newLabels.map((l) => l.toLowerCase()).includes('delete')) {
                newLabels.push('Delete');
              }
              stats.deleteCandidatesCount =
                (stats.deleteCandidatesCount || 0) + 1;
              break;
            } else {
              // Matched a cleanup rule but blocked by safety
              isSafetyBlocked = true;
              stats.skippedCount = (stats.skippedCount || 0) + 1;
              break;
            }
          }
        }
      }

      let isArchived = false;
      // 3. Evaluate Archive Rules (only if not candidate for delete)
      if (!isDeleteCandidate) {
        const archiveRules = CONFIG?.RULES?.ARCHIVE_RULES || [];
        for (const rule of archiveRules) {
          if (!rule || !rule.label) continue;

          if (allLabels.has(String(rule.label).toLowerCase())) {
            const isRead = !thread.isUnread();
            const archiveUnread = rule.archiveUnread === true;

            if (isRead || archiveUnread) {
              if (!Utils.isClassificationDryRun()) {
                thread.moveToArchive();
              }
              stats.archivedCount = (stats.archivedCount || 0) + 1;
              isArchived = true;
              break;
            }
          }
        }
      }

      // 4. Apply new labels (including Delete label if identified)
      if (newLabels.length > 0) {
        // Safety guard: Ensure 'Delete' label is NEVER applied if thread is not safe to delete
        const deleteLabelIndex = newLabels.findIndex(
          (l) => l.toLowerCase() === 'delete'
        );
        if (deleteLabelIndex !== -1) {
          const isSafe = this.isSafeToDelete(
            thread,
            subject,
            [...allLabels],
            from,
            domain
          );
          if (!isSafe) {
            newLabels.splice(deleteLabelIndex, 1);
            if (!isSafetyBlocked) {
              isSafetyBlocked = true;
              stats.skippedCount = (stats.skippedCount || 0) + 1;
            }
          }
        }

        for (const labelName of newLabels) {
          if (!existingThreadLabels.includes(labelName.toLowerCase())) {
            if (!Utils.isClassificationDryRun()) {
              const label = labelMap.get(labelName);
              if (label) {
                thread.addLabel(label);
              }
            }
            labelsAppliedInThisRun++;
            if (!stats.labeledByLabel) {
              stats.labeledByLabel = {};
            }
            stats.labeledByLabel[labelName] =
              (stats.labeledByLabel[labelName] || 0) + 1;
          }
        }
      }

      if (labelsAppliedInThisRun > 0) {
        stats.labeledCount = (stats.labeledCount || 0) + 1;
      }

      // Record mutually exclusive primary outcome for exact breakdown math
      if (isDeleteCandidate) {
        // Primary outcome: Delete candidate (already counted in stats.deleteCandidatesCount)
      } else if (isArchived) {
        // Primary outcome: Archived (already counted in stats.archivedCount)
      } else if (isSafetyBlocked) {
        // Primary outcome: Safety blocked (already counted in stats.skippedCount)
      } else if (labelsAppliedInThisRun > 0) {
        // Primary outcome: Labeled only (new classification/priority labels applied, not deleted or archived)
        stats.labeledOnlyCount = (stats.labeledOnlyCount || 0) + 1;
      } else {
        // Primary outcome: No action taken
        stats.noActionCount = (stats.noActionCount || 0) + 1;
      }
    } catch (error) {
      stats.errorCount = (stats.errorCount || 0) + 1;
      AppLogger.error(
        `Failed to process thread "${thread?.getFirstMessageSubject?.() || 'unknown'}": ${error.message}`
      );
    }
  },

  /**
   * Validates safety rules for a given thread.
   * Returns an object indicating whether it's safe to delete and the skip reason if unsafe.
   *
   * @param {GoogleAppsScript.Gmail.GmailThread} thread Gmail thread.
   * @param {string} subject Thread subject.
   * @param {string[]} threadLabelNames Normalized label names.
   * @param {string} from Sender email.
   * @param {string} domain Sender domain.
   * @returns {{safe: boolean, reason?: string}}
   */
  getSafetyCheckResult(thread, subject, threadLabelNames, from, domain) {
    const dlog = CONFIG.EXECUTION.DEBUG ? AppLogger.debug : () => {};

    if (thread.hasStarredMessages()) {
      dlog(`  > [SAFETY CHECK] Result: FALSE. Reason: Thread is starred.`);
      return { safe: false, reason: 'SKIPPED - Starred' };
    }

    if (thread.isImportant()) {
      dlog(
        `  > [SAFETY CHECK] Result: FALSE. Reason: Thread is marked as important by Gmail.`
      );
      return { safe: false, reason: 'SKIPPED - Important' };
    }

    if (CONFIG.SAFETY.ALLOW_DELETING_UNREAD === false && thread.isUnread()) {
      dlog(
        `  > [SAFETY CHECK] Result: FALSE. Reason: Thread is unread and ALLOW_DELETING_UNREAD is false.`
      );
      return { safe: false, reason: 'SKIPPED - Unread' };
    }

    const safeSenders = (CONFIG.SAFETY.SAFE_SENDERS || [])
      .map((e) => String(e).trim().toLowerCase())
      .filter((e) => e.length > 0);
    const safeDomains = (CONFIG.SAFETY.SAFE_DOMAINS || []).map((d) =>
      String(d).trim().toLowerCase()
    );
    const safeLabels = (CONFIG.SAFETY.PROTECTED_LABELS || []).map((l) =>
      String(l).trim().toLowerCase()
    );
    const matchedSafeLabel = threadLabelNames.find((label) =>
      safeLabels.includes(label.toLowerCase())
    );
    if (matchedSafeLabel) {
      dlog(
        `  > [SAFETY CHECK] Result: FALSE. Reason: Thread has protected label "${matchedSafeLabel}".`
      );
      return { safe: false, reason: 'SKIPPED - Protected label' };
    }

    const normFrom = (from || '').trim().toLowerCase();
    const matchedSafeSender = safeSenders.find(
      (s) => normFrom && normFrom.startsWith(s)
    );
    if (matchedSafeSender) {
      dlog(
        `  > [SAFETY CHECK] Result: FALSE. Reason: Sender "${from}" matches SAFE_SENDERS "${matchedSafeSender}".`
      );
      return { safe: false, reason: 'SKIPPED - Safe sender' };
    }

    if (domain && safeDomains.includes(domain.toLowerCase())) {
      dlog(
        `  > [SAFETY CHECK] Result: FALSE. Reason: Domain "${domain}" is in SAFE_DOMAINS.`
      );
      return { safe: false, reason: 'SKIPPED - Safe domain' };
    }

    dlog(`  > [SAFETY CHECK] Result: TRUE. All safety checks passed.`);
    return { safe: true };
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
    return this.getSafetyCheckResult(
      thread,
      subject,
      threadLabelNames,
      from,
      domain
    ).safe;
  },

  /**
   * Step 2 of deletion workflow: Processes threads labeled 'Delete' and moves eligible threads to Trash after safety checks.
   * @returns {Object} Statistics of the trash run.
   */
  trashDeleteLabeledEmails() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      AppLogger.log(
        'Could not acquire lock for trashDeleteLabeledEmails. Exiting...'
      );
      return {
        deleteLabelFoundCount: 0,
        eligibleForTrashCount: 0,
        trashedCount: 0,
        protectedSkippedCount: 0,
        errorsCount: 0,
      };
    }

    Utils.resetStartTime();
    AppLogger.log('====== Delete Label Trash Run ======');
    if (Utils.isTrashDryRun()) {
      AppLogger.log(
        '*** TRASH DRY RUN IS ENABLED. NO EMAILS WILL BE MOVED TO TRASH. ***'
      );
    }

    const stats = {
      deleteLabelFoundCount: 0,
      eligibleForTrashCount: 0,
      trashedCount: 0,
      protectedSkippedCount: 0,
      errorsCount: 0,
    };

    try {
      const searchQuery = 'label:Delete -in:trash';
      let pageToken = null;
      const maxLimit = CONFIG.EXECUTION.MAX_THREADS_TO_PROCESS || 0;

      do {
        const currentCount = Utils.isTrashDryRun()
          ? stats.eligibleForTrashCount
          : stats.trashedCount;

        if (maxLimit > 0 && currentCount >= maxLimit) {
          AppLogger.log(
            `Reached MAX_THREADS_TO_PROCESS limit of ${maxLimit}. Stopping trash execution.`
          );
          break;
        }

        let fetchSize = CONFIG.EXECUTION.BATCH_SIZE;
        if (maxLimit > 0) {
          const remaining = maxLimit - currentCount;
          if (remaining < fetchSize) {
            fetchSize = remaining > 0 ? remaining : 1;
          }
        }

        const listOptions = {
          q: searchQuery,
          maxResults: fetchSize,
          pageToken: pageToken,
        };

        const response = Gmail.Users.Threads.list('me', listOptions);
        pageToken = response.nextPageToken;

        const threads = response.threads || [];
        if (threads.length > 0) {
          stats.deleteLabelFoundCount += threads.length;
          const eligibleThreadsInBatch = [];

          for (const threadInfo of threads) {
            const batchCount =
              (Utils.isTrashDryRun()
                ? stats.eligibleForTrashCount
                : stats.trashedCount) + eligibleThreadsInBatch.length;

            if (maxLimit > 0 && batchCount >= maxLimit) {
              AppLogger.log(
                `Reached MAX_THREADS_TO_PROCESS limit of ${maxLimit} for trash operations.`
              );
              pageToken = null;
              break;
            }

            try {
              const thread = GmailApp.getThreadById(threadInfo.id);
              if (!thread) continue;

              const subject = thread.getFirstMessageSubject() || '(No Subject)';
              const threadLabels = thread
                .getLabels()
                .map((l) => l.getName().toLowerCase());

              if (!threadLabels.includes('delete')) {
                AppLogger.log(
                  `SKIPPED thread "${subject}" - SKIPPED - Missing Delete label`
                );
                stats.protectedSkippedCount++;
                continue;
              }

              const msgs = thread.getMessages();
              const firstMsg = msgs.length > 0 ? msgs[0] : null;
              const fromHeader = firstMsg ? firstMsg.getFrom() || '' : '';
              const emailMatch = fromHeader.match(/<([^>]+)>/);
              const from = (
                emailMatch ? emailMatch[1] : fromHeader
              ).toLowerCase();
              const domain = from.includes('@') ? from.split('@')[1] : '';

              const safetyResult = this.getSafetyCheckResult(
                thread,
                subject,
                threadLabels,
                from,
                domain
              );

              if (!safetyResult.safe) {
                AppLogger.log(
                  `SKIPPED thread "${subject}" - ${safetyResult.reason}`
                );
                stats.protectedSkippedCount++;
              } else {
                eligibleThreadsInBatch.push(thread);
                stats.eligibleForTrashCount++;
              }
            } catch (threadError) {
              stats.errorsCount++;
              AppLogger.error(
                `Failed to validate thread ID ${threadInfo.id}: ${threadError.message}`
              );
            }
          }

          if (eligibleThreadsInBatch.length > 0) {
            if (Utils.isTrashDryRun()) {
              AppLogger.log(
                `[DRY RUN] Would move ${eligibleThreadsInBatch.length} threads to Trash.`
              );
            } else {
              Utils.withRetry(
                () => GmailApp.moveThreadsToTrash(eligibleThreadsInBatch),
                `move ${eligibleThreadsInBatch.length} threads to Trash`
              );
              stats.trashedCount += eligibleThreadsInBatch.length;
              AppLogger.log(
                `Successfully moved ${eligibleThreadsInBatch.length} threads to Trash.`
              );
            }
          }
        }

        const totalCount = Utils.isTrashDryRun()
          ? stats.eligibleForTrashCount
          : stats.trashedCount;
        if (maxLimit > 0 && totalCount >= maxLimit) {
          AppLogger.log(
            `Reached MAX_THREADS_TO_PROCESS limit of ${maxLimit}. Stopping trash execution.`
          );
          break;
        }

        if (Utils.isTimeRunningOut()) {
          AppLogger.log(
            'Execution time limit is approaching in trashDeleteLabeledEmails.'
          );
          break;
        }
      } while (pageToken);

      AppLogger.table('Delete Label Trash Run', [
        ['Delete-labeled threads found', stats.deleteLabelFoundCount],
        ['Eligible for Trash', stats.eligibleForTrashCount],
        ['Skipped', stats.protectedSkippedCount],
        ['Actually moved to Trash', stats.trashedCount],
        ['Errors', stats.errorsCount],
      ]);

      if (Utils.isTrashDryRun()) {
        AppLogger.log(
          `[DRY RUN] Would move ${stats.eligibleForTrashCount} threads to Trash.`
        );
      }
    } catch (e) {
      stats.errorsCount++;
      AppLogger.error(
        'A critical error occurred during trashDeleteLabeledEmails.',
        e
      );
    } finally {
      lock.releaseLock();
      AppLogger.log('====== Delete Label Trash Run Complete ======');
    }

    return stats;
  },
};
