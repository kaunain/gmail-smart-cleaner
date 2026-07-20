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
     * The maximum number of email threads to process in a single full execution.
     * The script will stop after reaching this limit.
     * Set to 0 to process all matching threads.
     */
    MAX_THREADS_TO_PROCESS: 0,

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

    /**
     * @type {boolean}
     * If true, allows the script to trash unread emails that match TRASH_RULES.
     * By default this is false to prevent accidental deletion of new, unread mail.
     * USE WITH CAUTION.
     */
    ALLOW_DELETING_UNREAD: true,
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
      'Junk Mail', // For specific senders you want to trash
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
      { label: 'Promotions', days: 30 },
      { label: 'Social', days: 90 },
      { label: 'Junk Mail', days: 7 },
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
    // --- High Priority & Security ---
    {
      criteria: { from: 'newsletter@annoying.com' },
      labels: ['Junk Mail'],
      isPriority: true,
    },
    {
      criteria: { from: 'noreply@google.com', subject: 'security alert' },
      labels: ['Important'],
      isPriority: true,
    },

    // --- Work & Development ---
    {
      criteria: { domain: ['github.com', 'gitlab.com', 'bitbucket.org'] },
      labels: ['Work'],
    },

    // --- Social & Professional Networking ---
    {
      criteria: {
        domain: ['linkedin.com', 'x.com', 'facebook.com', 'instagram.com'],
      },
      labels: ['Social'],
    },
    { criteria: { category: 'social' }, labels: ['Social'] }, // Fallback

    // --- Shopping ---
    {
      criteria: {
        domain: ['amazon.com', 'amazon.in', 'flipkart.com', 'myntra.com'],
      },
      labels: ['Shopping'],
    },
    {
      criteria: { from: ['noreply@swiggy.in', 'order@zomato.com'] },
      labels: ['Shopping'],
    },

    // --- Finance & Payments ---
    {
      criteria: { subject: ['bank statement', 'credit card statement'] },
      labels: ['Finance', 'Important'], // Example of applying multiple labels
      isPriority: true,
    },
    {
      criteria: {
        domain: [
          'hdfcbank.com',
          'icicibank.com',
          'sbi.co.in',
          'axisbank.com',
          'kotak.com',
          'paytm.com',
          'phonepe.com',
        ],
      },
      labels: ['Finance'],
    },
    { criteria: { from: 'gpay-noreply@google.com' }, labels: ['Finance'] },

    // --- Investments ---
    {
      criteria: {
        domain: ['groww.in', 'zerodha.com', 'upstox.com', 'camsonline.com'],
      },
      labels: ['Investments'],
    },
    { criteria: { subject: 'mutual fund' }, labels: ['Investments'] },

    // --- Bills & Utilities ---
    {
      criteria: {
        subject: ['electricity bill', 'internet bill', 'payment due'],
      },
      labels: ['Bills'],
    },
    { criteria: { from: 'incometaxindia.gov.in' }, labels: ['Finance'] },
    {
      criteria: { domain: ['netflix.com', 'primevideo.com', 'spotify.com'] },
      labels: ['Bills'],
    },

    // --- Travel ---
    { criteria: { domain: 'irctc.co.in' }, labels: ['Travel'] },
    {
      criteria: { subject: ['flight ticket', 'hotel booking'] },
      labels: ['Travel'],
    },
    {
      criteria: { from: ['booking.com', 'makemytrip.com'] },
      labels: ['Travel'],
    },

    // --- Learning & Content ---
    {
      criteria: {
        domain: [
          'stackoverflow.com',
          'medium.com',
          'dev.to',
          'udemy.com',
          'coursera.org',
        ],
      },
      labels: ['Learning'],
    },

    // --- OTPs (One-Time Passwords) ---
    {
      criteria: { subject: ['OTP', 'one-time password'] },
      labels: ['OTP'],
      isPriority: true,
    },
    {
      criteria: { body: 'is your one-time password' },
      labels: ['OTP'],
      isPriority: true,
    },

    // --- Generic Categories (lower priority) ---
    { criteria: { category: 'promotions' }, labels: ['Promotions'] },
    { criteria: { category: 'forums' }, labels: ['Forums'] },
    { criteria: { subject: 'newsletter' }, labels: ['Newsletters'] },
  ],
};
