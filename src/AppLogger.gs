/**
 * @fileoverview A centralized logging utility for the script.
 * It uses the native Logger for the Apps Script editor logs.
 */

const AppLogger = {
  _write(method, message) {
    if (
      typeof console !== 'undefined' &&
      console &&
      typeof console[method] === 'function'
    ) {
      console[method](message);
    } else if (
      typeof Logger !== 'undefined' &&
      Logger &&
      typeof Logger.log === 'function'
    ) {
      Logger.log(message);
    }
  },

  /**
   * Logs a standard informational message.
   * @param {string} message The message to log.
   */
  log(message) {
    this._write('info', `[INFO] ${message}`);
  },

  /**
   * Logs a debug message. Only logs if DEBUG mode is enabled in CONFIG.
   * @param {string} message The message to log.
   */
  debug(message) {
    if (!CONFIG.EXECUTION.DEBUG) return;
    if (
      typeof console !== 'undefined' &&
      console &&
      typeof console.debug === 'function'
    ) {
      console.debug(`[DEBUG] ${message}`);
    } else if (
      typeof console !== 'undefined' &&
      console &&
      typeof console.log === 'function'
    ) {
      console.log(message);
    } else {
      this._write('log', message);
    }
  },

  /**
   * Logs a warning message.
   * @param {string} message The message to log.
   */
  warn(message) {
    this._write('warn', `[WARN] ${message}`);
  },

  /**
   * Logs an error message.
   * @param {string} message The error message.
   * @param {Error|object} [error] Optional error object to log its stack for more context.
   */
  error(message, error) {
    this._write('error', `[ERROR] ${message}`);

    if (error && error.stack) {
      this._write('error', error.stack);
    }
  },
};
