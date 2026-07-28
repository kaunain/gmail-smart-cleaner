/**
 * @fileoverview Service for managing Gmail labels.
 */
const LabelService = {
  _userLabelsCache: null,
  /**
   * Gets all user-defined Gmail labels, using a cache to improve performance.
   * @returns {string[]} An array of label names.
   */
  _getUserLabels() {
    if (this._userLabelsCache) {
      return this._userLabelsCache;
    }
    const cache = CacheService.getScriptCache();
    const cachedLabels = cache.get('userLabels');
    if (cachedLabels) {
      AppLogger.debug('Loaded user labels from cache.');
      this._userLabelsCache = JSON.parse(cachedLabels);
      return this._userLabelsCache;
    }
    AppLogger.debug('Fetching user labels from Gmail API.');
    const labels = Utils.withRetry(
      () => GmailApp.getUserLabels().map((label) => label.getName()),
      'fetch user labels'
    );
    cache.put(
      'userLabels',
      JSON.stringify(labels),
      CONFIG.EXECUTION.CACHE_EXPIRATION_SECONDS
    );
    this._userLabelsCache = labels;
    return labels;
  },
  /**
   * Ensures that all labels required by the script exist in the user's Gmail account.
   * Creates any missing labels.
   */
  ensureLabelsExist() {
    AppLogger.log('Checking for required Gmail labels...');
    const existingLabels = this._getUserLabels();
    const existingLabelsLower = existingLabels.map((name) =>
      name.toLowerCase()
    );
    let createdCount = 0;
    const createdLabels = [];
    CONFIG.LABELS.REQUIRED_LABELS.forEach((labelName) => {
      if (!existingLabelsLower.includes(labelName.toLowerCase())) {
        try {
          const isDryRun = Utils.isClassificationDryRun();
          if (isDryRun) {
            AppLogger.log(`[DRY RUN] Missing label found: "${labelName}"`);
          } else {
            Utils.withRetry(
              () => GmailApp.createLabel(labelName),
              `create label "${labelName}"`
            );
            createdLabels.push(labelName);
          }
          createdCount++;
        } catch (e) {
          AppLogger.error(`Failed to create label: "${labelName}"`, e);
        }
      }
    });
    if (createdCount > 0) {
      const isDryRun = Utils.isClassificationDryRun();
      const action = isDryRun ? 'identified' : 'created';
      if (!isDryRun && createdLabels.length > 0) {
        AppLogger.log(`Created labels: ${createdLabels.join(', ')}`);
      }
      AppLogger.log(`Successfully ${action} ${createdCount} missing label(s).`);
      // Invalidate cache if we created new labels
      CacheService.getScriptCache().remove('userLabels');
      this._userLabelsCache = null;
    } else {
      AppLogger.log('All required labels already exist.');
    }
  },
  /**
   * Checks for any required labels that are missing from the user's account.
   * @returns {string[]} An array of missing label names.
   */
  getMissingLabels() {
    AppLogger.debug('Checking for missing labels...');
    const existingLabels = this._getUserLabels();
    const existingLabelsLower = new Set(
      existingLabels.map((name) => name.toLowerCase())
    );
    const missing = CONFIG.LABELS.REQUIRED_LABELS.filter(
      (labelName) => !existingLabelsLower.has(labelName.toLowerCase())
    );
    return missing;
  },

  /**
   * Finds and removes any script-managed labels that are no longer associated with any threads.
   * This is a housekeeping function to prevent clutter.
   * @param {boolean} [isDryRun=false] If true, skips label deletion and logs only.
   */
  cleanupEmptyLabels(isDryRun = false) {
    if (isDryRun) {
      AppLogger.log('[DRY RUN] Skipping cleanup of empty labels.');
      return;
    }

    AppLogger.log('====== Starting Empty Label Cleanup ======');
    let removedCount = 0;

    const userLabels = GmailApp.getUserLabels();
    userLabels.forEach((label) => {
      const labelName = label.getName();

      try {
        const escapedLabelName = labelName.replace(/"/g, '\\"');
        const searchQuery = `label:"${escapedLabelName}" -in:trash -in:spam`;
        // Use the advanced service to check for existence
        const response = Gmail.Users.Threads.list('me', {
          q: searchQuery,
          maxResults: 1,
        });

        if (!response.threads || response.threads.length === 0) {
          AppLogger.log(`Label "${labelName}" is empty. Deleting it.`);
          label.deleteLabel();
          removedCount++;
        } else if (CONFIG.EXECUTION.DEBUG) {
          AppLogger.debug(
            `Skipping label "${labelName}" because it still has non-trashed/non-spam thread(s).`
          );
        }
      } catch (e) {
        AppLogger.warn(
          `Could not process label "${labelName}" for cleanup: ${e.message}`
        );
      }
    });

    if (removedCount > 0) {
      AppLogger.log(`Removed ${removedCount} empty label(s).`);
      CacheService.getScriptCache().remove('userLabels');
      this._userLabelsCache = null;
    } else {
      AppLogger.log('No empty labels found to remove.');
    }
    AppLogger.log('====== Empty Label Cleanup Complete ======');
  },
};
