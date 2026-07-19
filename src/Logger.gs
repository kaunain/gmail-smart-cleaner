/**
 * @fileoverview A simple logging utility for the script.
 */

const Logger = {
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
    if (CONFIG.EXECUTION.DEBUG) {
      Logger.log(`[DEBUG] ${message}`);
    }
  },

  /**
   * Logs an error message.
   * @param {string} message The error message.
   * @param {Error} [error] Optional error object to log its stack.
   */
  error(message, error) {
    console.error(`[ERROR] ${message}`);
    if (error && error.stack) {
      console.error(error.stack);
    }
  },
};
