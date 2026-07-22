/**
 * @fileoverview A centralized logging utility for the script.
 * It uses the native Logger for the Apps Script editor logs.
 */

const AppLogger = {
  /**
   * Logs a standard informational message.
   * @param {string} message The message to log.
   */
  log(message) {
    console.info(`[INFO] ${message}`);
  },

  /**
   * Logs a debug message. Only logs if DEBUG mode is enabled in CONFIG.
   * @param {string} message The message to log.
   */
  debug(message) {
    if (CONFIG.EXECUTION.DEBUG) {
      console.debug(`[DEBUG] ${message}`);
    }
  },

  /**
   * Logs a warning message.
   * @param {string} message The message to log.
   */
  warn(message) {
    console.warn(`[WARN] ${message}`);
  },

  /**
   * Logs an error message.
   * @param {string} message The error message.
   * @param {Error|object} [error] Optional error object to log its stack for more context.
   */
  error(message, error) {
    console.error(`[ERROR] ${message}`);

    if (error && error.stack) {
      console.error(error.stack);
    }
  },
};
