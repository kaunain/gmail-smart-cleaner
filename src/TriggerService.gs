/**
 * @fileoverview Service for managing script triggers.
 */

const TriggerService = {
  /**
   * Deletes all existing triggers associated with this script.
   * This is a cleanup step to prevent duplicate triggers.
   */
  deleteAllTriggers() {
    const triggers = ScriptApp.getProjectTriggers();
    if (triggers.length > 0) {
      Logger.log(`Deleting ${triggers.length} existing trigger(s)...`);
      triggers.forEach((trigger) => {
        // When a user runs installTriggers(), we assume a full reset of the
        // schedule. Deleting all triggers created by this script, including
        // any temporary continuation triggers, is the desired behavior.
        ScriptApp.deleteTrigger(trigger);
      });
      Logger.log('All project triggers have been deleted.');
    }
  },

  /**
   * Installs all necessary time-based triggers for the script to run automatically.
   * It will first delete any existing triggers to ensure a clean setup.
   */
  installTriggers() {
    this.deleteAllTriggers();

    Logger.log('Installing new triggers...');

    // Daily cleanup trigger, runs at a random minute between 2-3 AM to avoid hitting Google's quotas at the same time as other scripts.
    ScriptApp.newTrigger('gmailCleanup')
      .timeBased()
      .everyDays(1)
      .atHour(2)
      .nearMinute(30)
      .create();
    Logger.log(
      'Installed daily trigger for "gmailCleanup" to run around 2:30 AM.'
    );

    // Weekly summary trigger
    ScriptApp.newTrigger('sendWeeklySummary')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.SUNDAY)
      .atHour(4)
      .create();
    Logger.log(
      'Installed weekly trigger for "sendWeeklySummary" to run on Sundays around 4 AM.'
    );

    // Monthly summary trigger
    ScriptApp.newTrigger('sendMonthlySummary')
      .timeBased()
      .onMonthDay(1)
      .atHour(5)
      .create();
    Logger.log(
      'Installed monthly trigger for "sendMonthlySummary" to run on the 1st of each month around 5 AM.'
    );

    // Weekly attachment cleanup trigger
    if (CONFIG.RULES.ATTACHMENT_CLEANUP.ENABLED) {
      ScriptApp.newTrigger('cleanupAttachments')
        .timeBased()
        .onWeekDay(ScriptApp.WeekDay.SATURDAY)
        .atHour(3)
        .create();
      Logger.log(
        'Installed weekly trigger for "cleanupAttachments" to run on Saturdays around 3 AM.'
      );
    }

    Logger.log('All triggers installed successfully.');
  },
};
