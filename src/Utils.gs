/**
 * @fileoverview A collection of utility functions used across the project.
 */

const Utils = {
  /**
   * The timestamp when the script execution started.
   * @type {number}
   */
  _scriptStartTime: new Date().getTime(),

  /**
   * Checks if the script is approaching the maximum execution time limit.
   * @returns {boolean} True if time is running out, false otherwise.
   */
  isTimeRunningOut() {
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
};