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
    const logMessage = `[INFO] ${message}`;
    Logger.log(logMessage);
  },

  /**
   * Logs a debug message. Only logs if DEBUG mode is enabled in CONFIG.
   * @param {string} message The message to log.
   */
  debug(message) {
    if (CONFIG.EXECUTION.DEBUG) {
      const logMessage = `[DEBUG] ${message}`;
      Logger.log(logMessage);
    }
  },

  /**
   * Logs a warning message.
   * @param {string} message The message to log.
   */
  warn(message) {
    const logMessage = `[WARN] ${message}`;
    Logger.log(logMessage);
  },

  /**
   * Logs an error message.
   * @param {string} message The error message.
   * @param {Error|object} [error] Optional error object to log its stack for more context.
   */
  error(message, error) {
    const errorMessage = `[ERROR] ${message}`;
    Logger.log(errorMessage);

    if (error && error.stack) {
      Logger.log(error.stack);
    }
  },
};
