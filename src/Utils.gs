/**
 * @fileoverview A collection of utility functions used across the project.
 */

const Utils = {
  /**
   * The timestamp when the script execution started.
   * @type {number}
   */
  _scriptStartTime: 0,

  /**
   * Resets the script start time to the current time.
   * Should be called at the beginning of a new execution slice.
   */
  resetStartTime() {
    this._scriptStartTime = new Date().getTime();
  },

  /**
   * Checks if the script is approaching the maximum execution time limit.
   * @returns {boolean} True if time is running out, false otherwise.
   */
  isTimeRunningOut() {
    if (this._scriptStartTime === 0) {
      this.resetStartTime(); // Auto-initialize on first call if not explicitly reset
    }
    const currentTime = new Date().getTime();
    const elapsedTime = (currentTime - this._scriptStartTime) / 1000; // in seconds
    // Stop if we are within 30 seconds of the max runtime to be safe.
    return elapsedTime > CONFIG.EXECUTION.MAX_RUNTIME - 30;
  },

  /**
   * Calculates the total runtime of the script in seconds.
   * @returns {number} The total runtime in seconds.
   */
  getScriptRuntime() {
    const currentTime = new Date().getTime();
    return Math.round((currentTime - this._scriptStartTime) / 1000);
  },

  /**
   * Parses the domain from an email address.
   * Example: 'John Doe <john.doe@example.com>' -> 'example.com'
   * @param {string} email The full email string.
   * @returns {string|null} The extracted domain or null if not found.
   */
  getDomainFromEmail(email) {
    if (!email) return null;
    const match = email.match(/@([\w.-]+)/);
    return match ? match[1].toLowerCase() : null;
  },

  /**
   * Pauses the script for a specified duration.
   * @param {number} seconds The number of seconds to sleep.
   */
  sleep(seconds) {
    Utilities.sleep(seconds * 1000);
  },

  /**
   * A wrapper to execute a function with an exponential backoff retry mechanism.
   * @param {function} fn The function to execute.
   * @param {string} description A description of the operation for logging.
   * @returns {*} The return value of the wrapped function.
   */
  withRetry(fn, description) {
    const { MAX_RETRIES, INITIAL_BACKOFF_MS } = CONFIG.EXECUTION.RETRY_OPTIONS;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        return fn();
      } catch (e) {
        const isLastAttempt = i === MAX_RETRIES - 1;
        AppLogger.error(
          `Operation "${description}" failed on attempt ${i + 1}. Error: ${e.message}`
        );
        if (isLastAttempt) {
          AppLogger.error(
            `All ${MAX_RETRIES} retries failed for "${description}". Rethrowing error.`
          );
          throw e;
        }
        const backoffTime =
          INITIAL_BACKOFF_MS * Math.pow(2, i) + Math.random() * 1000;
        AppLogger.log(`Retrying in ${Math.round(backoffTime / 1000)}s...`);
        this.sleep(backoffTime / 1000);
      }
    }
  },

  /**
   * Validates the configuration object for common errors.
   * @returns {string[]} A list of validation error messages.
   */
  validateConfig() {
    const errors = [];
    if (CONFIG.EXECUTION.BATCH_SIZE <= 0 || CONFIG.EXECUTION.BATCH_SIZE > 500) {
      errors.push('EXECUTION.BATCH_SIZE must be between 1 and 500.');
    }
    if (
      CONFIG.EXECUTION.MAX_RUNTIME < 60 ||
      CONFIG.EXECUTION.MAX_RUNTIME > 540
    ) {
      errors.push(
        'EXECUTION.MAX_RUNTIME should be between 60 and 540 seconds.'
      );
    }
    if (
      CONFIG.RULES.ATTACHMENT_CLEANUP.ENABLED &&
      CONFIG.RULES.ATTACHMENT_CLEANUP.MIN_SIZE_MB <= 0
    ) {
      errors.push('ATTACHMENT_CLEANUP.MIN_SIZE_MB must be greater than 0.');
    }
    // Check that all labels in rules exist in REQUIRED_LABELS
    const allRuleLabels = [
      ...CONFIG.RULES.TRASH_RULES.map((r) => r.label),
      ...CONFIG.RULES.ARCHIVE_RULES.map((r) => r.label),
      ...CONFIG.CLASSIFICATION_RULES.flatMap((r) => r.labels || []),
    ];

    if (CONFIG.RULES.ATTACHMENT_CLEANUP.ENABLED) {
      allRuleLabels.push(CONFIG.RULES.ATTACHMENT_CLEANUP.LABEL);
    }
    const requiredLabels = CONFIG.LABELS.REQUIRED_LABELS;
    const missingLabels = [...new Set(allRuleLabels)].filter(
      (l) => !requiredLabels.includes(l)
    );
    if (missingLabels.length > 0) {
      errors.push(
        `The following labels are used in rules but not defined in LABELS.REQUIRED_LABELS: ${missingLabels.join(', ')}`
      );
    }

    // Check that all protected labels are also required labels
    const protectedLabels = CONFIG.SAFETY.PROTECTED_LABELS;
    const missingProtected = protectedLabels.filter(
      (l) => !requiredLabels.includes(l)
    );
    if (missingProtected.length > 0) {
      errors.push(
        `The following labels are in SAFETY.PROTECTED_LABELS but not in LABELS.REQUIRED_LABELS: ${missingProtected.join(', ')}`
      );
    }
    return errors;
  },

  /**
   * Formats a number of bytes into a human-readable string.
   * @param {number} bytes The number of bytes.
   * @param {number} [decimals=2] The number of decimal places.
   * @returns {string} The formatted string (e.g., "10.24 KB").
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  },
  normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
  },
};
