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
      Logger.debug('Loaded user labels from cache.');
      this._userLabelsCache = JSON.parse(cachedLabels);
      return this._userLabelsCache;
    }
    Logger.debug('Fetching user labels from Gmail API.');
    const labels = Utils.withRetry(
      () => GmailApp.getUserLabels().map(label => label.getName()),
      'fetch user labels'
    );
    cache.put('userLabels', JSON.stringify(labels), CONFIG.EXECUTION.CACHE_EXPIRATION_SECONDS);
    this._userLabelsCache = labels;
    return labels;
  },
  /**
   * Ensures that all labels required by the script exist in the user's Gmail account.
   * Creates any missing labels.
   */
  ensureLabelsExist() {
    Logger.log('Checking for required Gmail labels...');
    const existingLabels = this._getUserLabels();
    const existingLabelsLower = existingLabels.map(name => name.toLowerCase());
    let createdCount = 0;
    CONFIG.LABELS.REQUIRED_LABELS.forEach(labelName => {
      if (!existingLabelsLower.includes(labelName.toLowerCase())) {
        try {
          if (!CONFIG.EXECUTION.DRY_RUN) {
            Utils.withRetry(() => GmailApp.createLabel(labelName), `create label "${labelName}"`);
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
      // Invalidate cache if we created new labels
      CacheService.getScriptCache().remove('userLabels');
      this._userLabelsCache = null;
    } else {
      Logger.log('All required labels already exist.');
    }
  },
};