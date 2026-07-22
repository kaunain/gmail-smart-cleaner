/**
 * @fileoverview Builds and sends summary reports for cleanup runs.
 */

const SummaryService = {
  /**
   * Sends a summary email when enabled.
   *
   * @param {Object} stats Current run statistics.
   */
  sendSummary(stats) {
    try {
      const recipient = CONFIG.REPORTING.SUMMARY_EMAIL;
      if (!recipient) {
        AppLogger.debug('Summary email is disabled (recipient not set).');
        return;
      }

      const subject = `Gmail Smart Cleaner Summary - ${new Date().toLocaleDateString()}`;
      const body = this.buildPlainTextSummary(stats);

      Utils.withRetry(
        () => MailApp.sendEmail(recipient, subject, body),
        `send summary email to ${recipient}`
      );
      AppLogger.log(`Summary email sent to ${recipient}.`);
    } catch (error) {
      // Use AppLogger and pass the error object for stack tracing
      AppLogger.error(`Failed to send summary email: ${error.message}`, error);
    }
  },

  /**
   * Builds a plain text summary body.
   *
   * @param {Object} stats Current run statistics.
   * @returns {string}
   */
  buildPlainTextSummary(stats) {
    const lines = [];
    lines.push('Gmail Smart Cleaner Summary');
    lines.push('================================');
    lines.push(`- Threads Processed: ${stats.processedCount || 0}`);
    lines.push(`- Threads Archived: ${stats.archivedCount || 0}`);
    lines.push(`- Threads Trashed: ${stats.trashedCount || 0}`);
    lines.push(`- Threads Skipped: ${stats.skippedCount || 0}`);
    lines.push(`- Errors: ${stats.errorsCount || 0}`);
    lines.push('');

    lines.push('Threads Labeled (by Label):');
    const labeledEntries = Object.entries(stats.labeledByLabel || {});
    if (
      labeledEntries.length > 0 &&
      labeledEntries.some(([, count]) => count > 0)
    ) {
      labeledEntries.forEach(([label, count]) => {
        if (count > 0) lines.push(`  - ${label}: ${count}`);
      });
    } else {
      lines.push('  (None)');
    }
    lines.push('');

    lines.push(`Dry Run: ${CONFIG.EXECUTION.DRY_RUN ? 'Yes' : 'No'}`);
    lines.push(`Runtime: ${stats.totalRuntime || 0} sec`);
    lines.push('');
    lines.push('Generated at:');
    lines.push(new Date().toString());

    return lines.join('\n');
  },
};
