/**
 * @fileoverview Service for generating and sending summary reports.
 */

const SummaryService = {
  /**
   * Generates and sends a summary report.
   * @param {string} period The reporting period (e.g., "Weekly", "Monthly").
   * @param {object} stats The statistics from the cleanup run.
   */
  sendSummaryReport(period, stats) {
    const recipient = CONFIG.REPORTING.SUMMARY_EMAIL;
    if (!recipient) {
      Logger.log('Summary email recipient not set. Skipping report.');
      return;
    }

    Logger.log(`Generating ${period} summary report for ${recipient}...`);

    const subject = `Gmail Smart Cleaner: ${period} Summary`;
    const htmlBody = this.createHtmlReport(period, stats);

    if (CONFIG.EXECUTION.DRY_RUN) {
      Logger.log(`[DRY RUN] Would send summary email to ${recipient}.`);
      Logger.debug(`[DRY RUN] Email Subject: ${subject}`);
    } else {
      try {
        Utils.withRetry(
          () =>
            MailApp.sendEmail({
              to: recipient,
              subject: subject,
              htmlBody: htmlBody,
            }),
          `send ${period} summary report`
        );
        Logger.log(`${period} summary report sent successfully.`);
      } catch (e) {
        Logger.error(
          `Failed to send summary email to ${recipient} after multiple retries.`,
          e
        );
      }
    }
  },

  /**
   * Creates the HTML content for the summary report email.
   * @param {string} period The reporting period.
   * @param {object} stats The statistics object.
   * @returns {string} The HTML content of the report.
   */
  createHtmlReport(period, stats) {
    const template = HtmlService.createTemplateFromFile(
      'SummaryReportTemplate'
    );
    template.period = period;
    template.stats = stats;
    template.runtime = stats.totalRuntime || 0;
    template.runDate = new Date().toLocaleDateString();
    return template.evaluate().getContent();
  },
};
