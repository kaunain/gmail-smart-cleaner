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
    CONFIG.LABELS.REQUIRED_LABELS.forEach((labelName) => {
      if (!existingLabelsLower.includes(labelName.toLowerCase())) {
        try {
          if (CONFIG.EXECUTION.DRY_RUN) {
            AppLogger.log(`[DRY RUN] Missing label found: "${labelName}"`);
          } else {
            Utils.withRetry(
              () => GmailApp.createLabel(labelName),
              `create label "${labelName}"`
            );
            AppLogger.log(`Created label: "${labelName}"`);
          }
          createdCount++;
        } catch (e) {
          AppLogger.error(`Failed to create label: "${labelName}"`, e);
        }
      }
    });
    if (createdCount > 0) {
      const action = CONFIG.EXECUTION.DRY_RUN ? 'identified' : 'created';
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
};
