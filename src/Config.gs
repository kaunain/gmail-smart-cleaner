/**
 * @fileoverview Centralized configuration for the Gmail Smart Cleaner script.
 * All user-configurable settings are located here.
 */

// Use a single global CONFIG object to avoid polluting the global namespace.
const CONFIG = {
  // ==========================================================================
  // EXECUTION SETTINGS
  // ==========================================================================
  EXECUTION: {
    /**
     * @type {boolean}
     * If true, the script will only log the actions it would take, without
     * actually modifying any emails (trashing, archiving, labeling).
     * This is highly recommended for the first run.
     * SET TO false TO ENABLE REAL ACTIONS.
     */
    DRY_RUN: true,

    /**
     * @type {boolean}
     * If true, enables verbose logging for debugging purposes.
     */
    DEBUG: true,

    /**
     * @type {number}
     * The maximum number of email threads to process in a single batch.
     * Lower this number if you experience timeouts.
     * Recommended: 50-200
     */
    BATCH_SIZE: 100,

    /**
     * @type {number}
     * Maximum script runtime in seconds. The script will try to save its state
     * and schedule a continuation if it's about to exceed this limit.
     * Google Apps Script has a hard limit of 360 seconds (6 minutes).
     * Recommended: 300 (5 minutes)
     */
    MAX_RUNTIME: 300,

    /**
     * @type {number}
     * The script will only process threads older than this number of days.
     * Set to 0 to process all threads in the inbox. A value like 90 or 180
     * is recommended to avoid processing recent mail and improve performance.
     */
    SEARCH_OLDER_THAN_DAYS: 90,

    /**
     * @type {number}
     * The number of past execution summaries to store for the dashboard.
     */
    EXECUTION_HISTORY_COUNT: 10,

    /**
     * @type {{MAX_RETRIES: number, INITIAL_BACKOFF_MS: number}}
     * Configuration for the exponential backoff retry mechanism for failed API calls.
     */
    RETRY_OPTIONS: {
      MAX_RETRIES: 5,
      INITIAL_BACKOFF_MS: 2000,
    },

    /**
     * @type {number}
     * Cache duration in seconds for things like the user's label list.
     */
    CACHE_EXPIRATION_SECONDS: 3600, // 1 hour
  },

  // ==========================================================================
  // REPORTING SETTINGS
  // ==========================================================================
  REPORTING: {
    /**
     * @type {string}
     * The email address to send weekly and monthly summary reports to.
     * Leave empty ('') to disable email reports.
     */
    SUMMARY_EMAIL: Session.getEffectiveUser().getEmail(),

    /**
     * @type {string}
     * The email address to send critical error notifications to.
     * If empty, no error notifications will be sent. It's highly recommended
     * to set this to your primary email address.
     */
    ERROR_REPORT_EMAIL: Session.getEffectiveUser().getEmail(),
  },

  // ==========================================================================
  // SAFETY SETTINGS
  // ==========================================================================
  SAFETY: {
    /**
     * @type {string[]}
     * A list of sender email addresses to protect. Emails from these senders
     * will NEVER be moved to trash.
     * Example: ['boss@example.com', 'important-client@example.com']
     */
    SAFE_SENDERS: [],

    /**
     * @type {string[]}
     * A list of domains to protect. Emails from these domains will NEVER be
     * moved to trash.
     * Example: ['my-company.com', 'my-bank.com']
     */
    SAFE_DOMAINS: [],

    /**
     * @type {string[]}
     * A list of labels to protect. Threads with these labels will NEVER be
     * moved to trash. The script automatically adds labels like 'Finance',
     * 'Work', and 'Bills' to this list.
     */
    PROTECTED_LABELS: ['Insurance', 'Investments', 'Personal', 'Important'],
  },

  // ==========================================================================
  // LABEL DEFINITIONS
  // ==========================================================================
  LABELS: {
    /**
     * @type {string[]}
     * All labels that the script uses. The script will automatically create
     * any of these labels if they don't already exist in your Gmail.
     */
    REQUIRED_LABELS: [
      'Work',
      'Finance',
      'Shopping',
      'Learning',
      'Newsletters',
      'Travel',
      'Bills',
      'Insurance',
      'Investments',
      'Social',
      'OTP',
      'Personal',
      'Important', // A generic important label
      'Promotions', // For promotion-type emails
      'Forums', // For forum/group discussions
      'Large Attachments',
    ],
  },

  // ==========================================================================
  // CLEANUP & ARCHIVE RULES
  // ==========================================================================
  RULES: {
    /**
     * Rules for moving threads to trash.
     * A thread is moved to trash if it has the specified label AND its newest
     * message is older than the specified number of days.
     * This is always subject to the safety checks (e.g., won't trash starred).
     */
    TRASH_RULES: [
      { label: 'OTP', days: 7 },
      { label: 'Promotions', days: 180 },
      { label: 'Social', days: 365 },
    ],

    /**
     * Rules for archiving threads.
     * A thread is archived if it has the specified label AND is read.
     */
    ARCHIVE_RULES: [
      { label: 'Newsletters' },
      { label: 'Promotions' },
      { label: 'Social' },
      { label: 'Forums' },
    ],

    /**
     * Rules for handling large attachments. The script will find threads with
     * attachments larger than the specified size and apply a label.
     * You can then create a TRASH_RULE for this label if you want to delete them.
     * Note: This runs as a separate, less frequent process.
     */
    ATTACHMENT_CLEANUP: {
      ENABLED: true,
      // Find attachments larger than 10MB. Gmail search supports 'k' and 'm'.
      MIN_SIZE_MB: 10,
      // Apply this label to threads with large attachments.
      LABEL: 'Large Attachments',
      // Process threads older than this many days.
      OLDER_THAN_DAYS: 365,
    },
  },

  // ==========================================================================
  // EMAIL CLASSIFICATION RULES
  // ==========================================================================
  /**
   * The core of the smart organization. The script processes these rules in order.
   * `criteria`: Conditions to match against an email. All criteria must be met.
   *   - `from`: Matches the sender's email address.
   *   - `domain`: Matches the sender's domain.
   *   - `subject`: Matches a keyword in the email subject.
   *   - `body`: Matches a keyword in the email body.
   *   - `category`: Matches a Gmail category (e.g., 'promotions', 'social').
   * `label`: The label to apply if the criteria are met.
   * `isPriority`: (Optional) If true, stop processing further rules for this email.
   */
  CLASSIFICATION_RULES: [
    // --- Work & Development ---
    { criteria: { domain: 'github.com' }, label: 'Work' },
    { criteria: { domain: 'gitlab.com' }, label: 'Work' },
    { criteria: { domain: 'bitbucket.org' }, label: 'Work' },
    { criteria: { from: 'noreply@google.com', subject: 'security alert' }, label: 'Important', isPriority: true },
    { criteria: { domain: 'stackoverflow.com' }, label: 'Learning' },

    // --- Social & Professional Networking ---
    { criteria: { domain: 'linkedin.com' }, label: 'Social' },
    { criteria: { domain: 'x.com' }, label: 'Social' }, // Formerly twitter.com
    { criteria: { domain: 'facebook.com' }, label: 'Social' },
    { criteria: { domain: 'instagram.com' }, label: 'Social' },
    { criteria: { category: 'social' }, label: 'Social' },

    // --- Shopping ---
    { criteria: { domain: 'amazon.com' }, label: 'Shopping' },
    { criteria: { domain: 'amazon.in' }, label: 'Shopping' },
    { criteria: { domain: 'flipkart.com' }, label: 'Shopping' },
    { criteria: { domain: 'myntra.com' }, label: 'Shopping' },
    { criteria: { from: 'noreply@swiggy.in' }, label: 'Shopping' },
    { criteria: { from: 'order@zomato.com' }, label: 'Shopping' },

    // --- Finance & Payments ---
    { criteria: { subject: 'bank statement' }, label: 'Finance', isPriority: true },
    { criteria: { subject: 'credit card statement' }, label: 'Finance', isPriority: true },
    { criteria: { domain: 'hdfcbank.com' }, label: 'Finance' },
    { criteria: { domain: 'icicibank.com' }, label: 'Finance' },
    { criteria: { domain: 'sbi.co.in' }, label: 'Finance' },
    { criteria: { domain: 'axisbank.com' }, label: 'Finance' },
    { criteria: { domain: 'kotak.com' }, label: 'Finance' },
    { criteria: { domain: 'paytm.com' }, label: 'Finance' },
    { criteria: { domain: 'phonepe.com' }, label: 'Finance' },
    { criteria: { from: 'gpay-noreply@google.com' }, label: 'Finance' },

    // --- Investments ---
    { criteria: { domain: 'groww.in' }, label: 'Investments' },
    { criteria: { domain: 'zerodha.com' }, label: 'Investments' },
    { criteria: { domain: 'upstox.com' }, label: 'Investments' },
    { criteria: { domain: 'camsonline.com' }, label: 'Investments' },
    { criteria: { subject: 'mutual fund' }, label: 'Investments' },

    // --- Bills & Utilities ---
    { criteria: { subject: 'electricity bill' }, label: 'Bills' },
    { criteria: { subject: 'internet bill' }, label: 'Bills' },
    { criteria: { subject: 'payment due' }, label: 'Bills' },
    { criteria: { from: 'incometaxindia.gov.in' }, label: 'Finance' },

    // --- Travel ---
    { criteria: { domain: 'irctc.co.in' }, label: 'Travel' },
    { criteria: { subject: 'flight ticket' }, label: 'Travel' },
    { criteria: { subject: 'hotel booking' }, label: 'Travel' },
    { criteria: { from: 'booking.com' }, label: 'Travel' },
    { criteria: { from: 'makemytrip.com' }, label: 'Travel' },

    // --- Subscriptions & Entertainment ---
    { criteria: { domain: 'netflix.com' }, label: 'Bills' },
    { criteria: { domain: 'primevideo.com' }, label: 'Bills' },
    { criteria: { domain: 'spotify.com' }, label: 'Bills' },

    // --- Learning & Content ---
    { criteria: { domain: 'medium.com' }, label: 'Learning' },
    { criteria: { domain: 'dev.to' }, label: 'Learning' },
    { criteria: { domain: 'udemy.com' }, label: 'Learning' },
    { criteria: { domain: 'coursera.org' }, label: 'Learning' },

    // --- OTPs (One-Time Passwords) ---
    { criteria: { subject: 'OTP' }, label: 'OTP', isPriority: true },
    { criteria: { subject: 'one-time password' }, label: 'OTP', isPriority: true },
    { criteria: { body: 'is your one-time password' }, label: 'OTP', isPriority: true },

    // --- Generic Categories (lower priority) ---
    { criteria: { category: 'promotions' }, label: 'Promotions' },
    { criteria: { category: 'forums' }, label: 'Forums' },
    { criteria: { subject: 'newsletter' }, label: 'Newsletters' },
  ],
};

/**
 * A consolidated list of all sender emails that should prevent an email from being trashed.
 * This is pre-calculated here for efficiency.
 * @type {string[]}
 */
const SAFE_SENDER_EMAILS = CONFIG.SAFETY.SAFE_SENDERS.map(email => email.toLowerCase());

/**
 * A consolidated list of all sender domains that should prevent an email from being trashed.
 * This is pre-calculated here for efficiency.
 * @type {string[]}
 */
const SAFE_SENDER_DOMAINS = CONFIG.SAFETY.SAFE_DOMAINS.map(domain => domain.toLowerCase());


/**
 * A consolidated list of all labels that should prevent an email from being trashed.
 * This combines user-defined protected labels with critical system labels.
 * This is pre-calculated here for efficiency.
 * @type {string[]}
 */
const SAFE_LABELS = [
  ...new Set([
    'Work',
    'Finance',
    'Bills',
    'Insurance',
    'Investments',
    ...CONFIG.SAFETY.PROTECTED_LABELS,
  ]),
].map(label => label.toLowerCase());