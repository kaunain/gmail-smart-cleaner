/**
 * @fileoverview Service for managing Gmail labels.
 */

const LabelService = {
  /**
   * Ensures that all labels required by the script exist in the user's Gmail account.
   * Creates any missing labels.
   */
  ensureLabelsExist() {
    Logger.log('Checking for required Gmail labels...');
    const requiredLabels = CONFIG.LABELS.REQUIRED_LABELS;
    const existingLabels = GmailApp.getUserLabels().map(label => label.getName());
    const existingLabelsLower = existingLabels.map(name => name.toLowerCase());

    let createdCount = 0;

    requiredLabels.forEach(labelName => {
      if (!existingLabelsLower.includes(labelName.toLowerCase())) {
        try {
          if (!CONFIG.EXECUTION.DRY_RUN) {
            GmailApp.createLabel(labelName);
          }
          Logger.log(`Created label: "${labelName}"`);
          createdCount++;
        } catch (e) {
          Logger.error(`Failed to create label: "${labelName}"`, e);
        }
      }
    });

    if (createdCount > 0) {
      Logger.log(`Successfully created ${createdCount} new label(s).`);
    } else {
      Logger.log('All required labels already exist.');
    }
  },
};