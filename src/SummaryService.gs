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
      if (
        !CONFIG ||
        !CONFIG.EXECUTION ||
        !CONFIG.EXECUTION.SEND_SUMMARY_EMAIL
      ) {
        Logger.debug('Summary email is disabled.');
        return;
      }

      const recipient =
        (CONFIG.NOTIFICATIONS && CONFIG.NOTIFICATIONS.SUMMARY_EMAIL) ||
        Session.getActiveUser().getEmail();

      const subject = `Gmail Smart Cleaner Summary - ${new Date().toLocaleDateString()}`;
      const body = this.buildPlainTextSummary(stats);

      MailApp.sendEmail(recipient, subject, body);
      Logger.log(`Summary email sent to ${recipient}`);
    } catch (error) {
      Logger.error(`Failed to send summary email: ${error.message}`);
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
    lines.push(`Processed: ${stats.processedCount || 0}`);
    lines.push(`Labeled: ${stats.threadsLabeledCount || 0}`);
    lines.push(`Archived: ${stats.archivedCount || 0}`);
    lines.push(`Trashed: ${stats.trashedCount || 0}`);
    lines.push(`Skipped: ${stats.skippedCount || 0}`);
    lines.push(`Errors: ${stats.errorsCount || 0}`);
    lines.push('');
    lines.push(`Dry Run: ${CONFIG?.EXECUTION?.DRY_RUN ? 'Yes' : 'No'}`);
    lines.push(`Runtime: ${Utils.getRuntimeSeconds(stats)} sec`);
    lines.push('');
    lines.push('Generated at:');
    lines.push(new Date().toString());

    return lines.join('\n');
  },
};
