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
    this._write('info', `ℹ️ ${message}`);
  },

  /**
   * Logs a compact summary line for batch activity.
   * @param {string} message The summary text to log.
   */
  summary(message) {
    this._write('info', `📊 ${message}`);
  },

  /**
   * Logs a simple table-like summary block.
   * @param {string} title The title of the summary block.
   * @param {Array<Array<string|number|boolean>>} rows Key/value rows.
   */
  table(title, rows) {
    this._write('info', '');
    this._write('info', `=== ${title} ===`);
    rows.forEach(([label, value]) => {
      const paddedLabel = String(label).padEnd(12, ' ');
      this._write('info', `${paddedLabel}: ${value}`);
    });
    this._write('info', '================');
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
