/**
 * @fileoverview A simple logging utility for the script.
 */

const AppLogger = {
  /**
   * Logs a standard informational message.
   * @param {string} message The message to log.
   */
  log(message) {
    Logger.log(`[INFO] ${message}`);
  },

  /**
   * Logs a debug message. Only logs if DEBUG mode is enabled in CONFIG.
   * @param {string} message The message to log.
   */
  debug(message) {
    // Only log if DEBUG mode is enabled.
    // Calls Logger.log directly to avoid double-prefixing.
    if (CONFIG.EXECUTION.DEBUG) Logger.log(`[DEBUG] ${message}`);
  },

  /**
   * Logs a warning message.
   * @param {string} message The message to log.
   */
  warn(message) {
    Logger.log(`[WARN] ${message}`);
  },

  /**
   * Logs an error message.
   * @param {string} message The error message.
   * @param {Error|object} [error] Optional error object to log its stack.
   */
  error(message, error) {
    // Log to both default logger (for script editor) and console.error (for Stackdriver).
    const errorMessage = `[ERROR] ${message}`;
    Logger.log(errorMessage);
    console.error(errorMessage);

    if (error && error.stack) {
      Logger.log(error.stack);
      console.error(error.stack);
    }
  },
};
