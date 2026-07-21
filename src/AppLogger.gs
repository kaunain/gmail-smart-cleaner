/**
 * @fileoverview A centralized logging utility for the script.
 * It uses the native Logger for the script editor and console for Stackdriver logging.
 */

const AppLogger = {
  /**
   * Logs a standard informational message.
   * @param {string} message The message to log.
   */
  log(message) {
    const logMessage = `[INFO] ${message}`;
    Logger.log(logMessage); // For Apps Script editor logs
    console.log(logMessage); // For Stackdriver logs
  },

  /**
   * Logs a debug message. Only logs if DEBUG mode is enabled in CONFIG.
   * @param {string} message The message to log.
   */
  debug(message) {
    if (CONFIG.EXECUTION.DEBUG) {
      const logMessage = `[DEBUG] ${message}`;
      Logger.log(logMessage);
      console.log(logMessage);
    }
  },

  /**
   * Logs a warning message.
   * @param {string} message The message to log.
   */
  warn(message) {
    const logMessage = `[WARN] ${message}`;
    Logger.log(logMessage);
    console.warn(logMessage); // Use console.warn for warnings
  },

  /**
   * Logs an error message.
   * @param {string} message The error message.
   * @param {Error|object} [error] Optional error object to log its stack for more context.
   */
  error(message, error) {
    const errorMessage = `[ERROR] ${message}`;
    // Log to both default logger (for script editor) and console.error (for Stackdriver)
    Logger.log(errorMessage);
    console.error(errorMessage);

    if (error && error.stack) {
      Logger.log(error.stack);
      console.error(error.stack);
    }
  },
};
