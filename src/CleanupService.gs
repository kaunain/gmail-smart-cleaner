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
        const threadId = thread.getId();
        const subject = thread.getFirstMessageSubject() || '(No Subject)';
        const lastMessageDate = thread.getLastMessageDate();
        const ageInDays =
          (new Date() - lastMessageDate) / (1000 * 60 * 60 * 24);

        if (CONFIG.EXECUTION.DEBUG) {
          AppLogger.debug(
            `\n------------------------------------------------------------------`
          );
          AppLogger.debug(`[START THREAD] Processing Thread ID: ${threadId}`);
          AppLogger.debug(`  - Subject: "${subject}"`);
          AppLogger.debug(
            `  - From: (will be determined during classification)`
          );
          AppLogger.debug(`  - Age: ${ageInDays.toFixed(2)} days`);
          AppLogger.debug(
            `  - Current Labels: [${thread
              .getLabels()
              .map((l) => l.getName())
              .join(', ')}]`
          );
          AppLogger.debug(`  - Is Unread: ${thread.isUnread()}`);
          AppLogger.debug(`  - Is Important (Gmail): ${thread.isImportant()}`);
          AppLogger.debug(`  - Has Starred: ${thread.hasStarredMessages()}`);
          AppLogger.debug(
            `  - Gmail Category: Not available via API for performance reasons.`
          );
        }

        // 1) Classify thread
        const classification = RuleEngine.classifyThread(thread);
        const newLabels = classification.labels || [];
        const from = classification.from || '';
        const domain = classification.domain || '';
        const matchedRules = classification.matchedRules || [];
        const matchedDomains = classification.matchedDomains || [];
        const matchedKeywords = classification.matchedKeywords || [];
        const matchedSender = classification.matchedSender || [];
        const currentLabels = thread.getLabels().map((l) => l.getName());
        const gmailCategories = [
          'Not available via API for performance reasons.',
        ];

        if (newLabels.length > 0) {
          for (const labelName of newLabels) {
            if (!labelMap.has(labelName)) {
              labelMap.set(labelName, []);
            }
            labelMap.get(labelName).push(thread);
            // Update stats for detailed reporting
            stats.labeledByLabel[labelName] =
              (stats.labeledByLabel[labelName] || 0) + 1;
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
        let finalAction = 'Keep';
        let finalReason = 'No cleanup rule matched.';

        // 2) Trash rules
        const trashRules = CONFIG?.RULES?.TRASH_RULES || [];
        for (const rule of trashRules) {
          if (CONFIG.EXECUTION.DEBUG) {
            AppLogger.debug(
              `  [TRASH RULE CHECK] Evaluating rule: ${JSON.stringify(rule)}`
            );
          }
          // FIX: The condition `!rule.days` was incorrect as it evaluated to true for `days: 0`.
          // Changed to `rule.days == null` to correctly handle rules that should run immediately.
          if (!rule || !rule.label || rule.days == null) {
            if (CONFIG.EXECUTION.DEBUG) {
              AppLogger.debug(
                `    - Rule Skipped: Rule is malformed (missing label or days). Condition '(!rule || !rule.label || rule.days == null)' was true.`
              );
            }
            continue;
          }

          if (allLabels.has(String(rule.label).toLowerCase())) {
            if (CONFIG.EXECUTION.DEBUG)
              AppLogger.debug(
                `    - Label Match: TRUE (Thread has label "${rule.label}")`
              );
            const thresholdDate = new Date();
            thresholdDate.setDate(thresholdDate.getDate() - Number(rule.days));

            if (lastMessageDate < thresholdDate) {
              if (CONFIG.EXECUTION.DEBUG) {
                AppLogger.debug(
                  `    - Age Match: TRUE (Thread age is greater than ${rule.days} days). Last message: ${lastMessageDate}, Threshold: ${thresholdDate}`
                );
                AppLogger.debug(
                  `    - Safety Check: Running isSafeToDelete...`
                );
              }
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
                finalAction = 'Trash';
                finalReason = `Matched TRASH rule ${JSON.stringify(rule)} and passed safety checks.`;
                if (CONFIG.EXECUTION.DEBUG)
                  AppLogger.debug(
                    `    - Safety Check Result: PASSED. Action Selected: Trash.`
                  );
                actionTaken = true;
                break; // Exit trash rules loop since an action was taken
              } else {
                stats.skippedCount++; // Reason is logged inside isSafeToDelete
                finalAction = 'Keep';
                finalReason = `Matched TRASH rule ${JSON.stringify(rule)} but failed safety checks.`;
                if (CONFIG.EXECUTION.DEBUG)
                  AppLogger.debug(
                    `    - Safety Check Result: FAILED. Action Selected: Keep.`
                  );
              }
            } else {
              if (CONFIG.EXECUTION.DEBUG) {
                AppLogger.debug(
                  `    - Age Match: FALSE (Thread age is not greater than ${rule.days} days). Last message: ${lastMessageDate}, Threshold: ${thresholdDate}`
                );
              }
            }
          } else {
            if (CONFIG.EXECUTION.DEBUG) {
              AppLogger.debug(
                `    - Label Match: FALSE (Thread does not have label "${rule.label}")`
              );
            }
          }
        }

        // 3) Archive rules (only if not trashed)
        if (!actionTaken) {
          const archiveRules = CONFIG?.RULES?.ARCHIVE_RULES || [];
          for (const rule of archiveRules) {
            if (!rule || !rule.label) continue;

            if (allLabels.has(String(rule.label).toLowerCase())) {
              if (CONFIG.EXECUTION.DEBUG)
                AppLogger.debug(
                  `  [ARCHIVE RULE CHECK] Evaluating rule: ${JSON.stringify(rule)}`
                );
              // Check if the thread can be archived based on its read status and the rule's setting
              const isRead = !thread.isUnread();
              const archiveUnread = rule.archiveUnread === true; // Default to false if not present

              if (CONFIG.EXECUTION.DEBUG) {
                AppLogger.debug(
                  `    - Label Match: TRUE (Thread has label "${rule.label}")`
                );
                AppLogger.debug(
                  `    - Read Status Check: Thread isRead: ${isRead}, Rule archiveUnread: ${archiveUnread}`
                );
              }

              if (isRead || archiveUnread) {
                threadsToArchive.push(thread);
                stats.archivedCount++;
                finalAction = 'Archive';
                finalReason = `Matched ARCHIVE rule ${JSON.stringify(rule)}.`;
                if (CONFIG.EXECUTION.DEBUG)
                  AppLogger.debug(
                    `    - Read Status Result: PASSED. Action Selected: Archive.`
                  );
                actionTaken = true;
                break;
              } else {
                if (CONFIG.EXECUTION.DEBUG) {
                  AppLogger.debug(
                    `    - Read Status Result: FAILED. Matched ARCHIVE rule for label "${rule.label}" but skipping unread thread.`
                  );
                }
                finalAction = 'Keep';
                finalReason = `Matched ARCHIVE rule for label "${rule.label}" but thread is unread and rule does not allow archiving unread.`;
              }
            }
          }
        }
        if (CONFIG.EXECUTION.DEBUG) {
          AppLogger.debug(`[END THREAD] Summary for Thread ID: ${threadId}`);
          AppLogger.debug(`  - Thread ID: ${threadId}`);
          AppLogger.debug(`  - Subject: "${subject}"`);
          AppLogger.debug(`  - From: ${from}`);
          AppLogger.debug(`  - Age: ${ageInDays.toFixed(2)} days`);
          AppLogger.debug(`  - Current Labels: [${currentLabels.join(', ')}]`);
          AppLogger.debug(
            `  - Gmail Categories: [${gmailCategories.join(', ')}]`
          );
          AppLogger.debug(`  - Matched Rules: [${matchedRules.join(' | ')}]`);
          AppLogger.debug(
            `  - Matched Domains: [${matchedDomains.join(', ')}]`
          );
          AppLogger.debug(
            `  - Matched Keywords: [${matchedKeywords.join(', ')}]`
          );
          AppLogger.debug(`  - Matched Sender: [${matchedSender.join(', ')}]`);
          AppLogger.debug(`  - Selected Action: ${finalAction}`);
          AppLogger.debug(`  - Reason: ${finalReason}`);
          AppLogger.debug(`  - Skipped?: ${finalAction === 'Keep'}`);
          AppLogger.debug(
            `  - Why?: ${finalAction === 'Keep' ? finalReason : 'N/A'}`
          );
          AppLogger.debug(
            `  - Trash API Called?: ${finalAction === 'Trash' && !CONFIG.EXECUTION.DRY_RUN}`
          );
          AppLogger.debug(
            `  - Archive API Called?: ${finalAction === 'Archive' && !CONFIG.EXECUTION.DRY_RUN}`
          );
          AppLogger.debug(
            `  - Result: ${CONFIG.EXECUTION.DRY_RUN ? `DRY RUN - Would ${finalAction}` : finalAction}`
          );
          AppLogger.debug(
            `------------------------------------------------------------------`
          );
        }
      } catch (error) {
        stats.errorsCount = (stats.errorsCount || 0) + 1;
        AppLogger.error(
          `Failed to process thread "${thread?.getFirstMessageSubject?.() || 'unknown'}": ${error.message}`
        );
      }
    }

    // 4) Execute actions
    if (CONFIG.EXECUTION.DRY_RUN) {
      if (threadsToTrash.length > 0)
        AppLogger.log(
          `[DRY RUN] Would trash ${threadsToTrash.length} threads. API call to GmailApp.moveThreadsToTrash() skipped.`
        );
      if (threadsToArchive.length > 0)
        AppLogger.log(
          `[DRY RUN] Would archive ${threadsToArchive.length} threads. API call to GmailApp.moveThreadsToArchive() skipped.`
        );
      labelMap.forEach((labelThreads, labelName) => {
        AppLogger.log(
          `[DRY RUN] Would apply label "${labelName}" to ${labelThreads.length} threads. API call to label.addToThreads() skipped.`
        );
      });
      if (threadsToTrash.length === 0) {
        AppLogger.log(
          'Trash API was not called: No threads were selected for trash in this batch.'
        );
      }
      if (threadsToArchive.length === 0) {
        AppLogger.log(
          'Archive API was not called: No threads were selected for archive in this batch.'
        );
      }
      return;
    }

    if (threadsToTrash.length > 0) {
      Utils.withRetry(
        () => GmailApp.moveThreadsToTrash(threadsToTrash),
        `trash ${threadsToTrash.length} threads`
      );
      AppLogger.log(`Trashed ${threadsToTrash.length} threads.`);
    } else {
      AppLogger.log(
        'Trash API was not called: No threads were selected for trash in this batch.'
      );
    }

    if (threadsToArchive.length > 0) {
      Utils.withRetry(
        () => GmailApp.moveThreadsToArchive(threadsToArchive),
        `archive ${threadsToArchive.length} threads`
      );
      AppLogger.log(`Archived ${threadsToArchive.length} threads.`);
    } else {
      AppLogger.log(
        'Archive API was not called: No threads were selected for archive in this batch.'
      );
    }

    labelMap.forEach((labelThreads, labelName) => {
      let label = GmailApp.getUserLabelByName(labelName);
      if (!label) {
        if (CONFIG.EXECUTION.DRY_RUN) {
          AppLogger.log(
            `[DRY RUN] Label "${labelName}" not found, would create it before applying.`
          );
          AppLogger.log(
            `[DRY RUN] Skipping actual label application for "${labelName}".`
          );
          return;
        }

        AppLogger.log(`Label "${labelName}" not found. Creating it now.`);
        label = Utils.withRetry(
          () => GmailApp.createLabel(labelName),
          `create label "${labelName}"`
        );
      }
      if (!label) {
        AppLogger.warn(
          `Label "${labelName}" could not be created. Skipping label application.`
        );
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
    // A small refactor here for clarity and to avoid re-creating the debug logger.
    // I've defined `dlog` at the top of the function.
    // This is a minor deviation but significantly improves readability without changing architecture.

    // Compute safe lists on-the-fly from CONFIG to ensure robustness against script load order issues.
    const safeSenders = (CONFIG.SAFETY.SAFE_SENDERS || []).map((e) =>
      e.toLowerCase()
    );
    const safeDomains = (CONFIG.SAFETY.SAFE_DOMAINS || []).map((d) =>
      d.toLowerCase()
    );
    // All protected labels are now defined directly in CONFIG.SAFETY.PROTECTED_LABELS
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
