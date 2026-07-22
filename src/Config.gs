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
     * Set to 0 to process all threads. A value like 7 is a good balance
     * between processing recent items and avoiding active conversations.
     */
    SEARCH_OLDER_THAN_DAYS: 7,

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
     * moved to trash by a TRASH_RULE. It's recommended to include all
     * labels that handle important information.
     */
    PROTECTED_LABELS: [
      'Work',
      'Finance',
      'Bills',
      'Insurance',
      'Investments',
      'Personal', // Personal, non-work related
      'Priority', // For high-priority threads
    ],

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
      'Priority', // A generic priority label
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
      { label: 'Junk Mail', days: 0 }, // Trash immediately
    ],

    /**
     * Rules for archiving threads.
     * A thread is archived if it has the specified label.
     * - `label`: The label to match.
     * - `archiveUnread`: (Optional) If true, unread threads will also be archived.
     *   Defaults to false (only read threads are archived).
     */
    ARCHIVE_RULES: [
      { label: 'Newsletters', archiveUnread: true }, // Archive newsletters even if unread
      { label: 'Social', archiveUnread: false }, // Only archive read social emails
      { label: 'Forums', archiveUnread: true },
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
  CLASSIFICATION_RULES: [
    // --- High Priority & Security ---
    {
      criteria: { from: 'newsletter@annoying.com' },
      labels: ['Junk Mail'],
      isPriority: true,
    },
    {
      // Rule to catch and trash failed GitHub Actions notifications
      criteria: { subject: 'Run failed: Deploy to Google Apps Script' },
      labels: ['Junk Mail'],
      isPriority: true,
    },
    {
      criteria: { from: 'noreply@google.com', subject: 'security alert' },
      labels: ['Priority'],
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
      labels: ['Finance', 'Priority'], // Example of applying multiple labels
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

    // --- Forums & Groups ---
    {
      criteria: {
        domain: [
          'quora.com',
          'reddit.com',
          'ycombinator.com', // Hacker News
        ],
      },
      labels: ['Forums'],
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

    // --- Generic Fallbacks (lower priority) ---
    // This rule acts as a catch-all for common email types.
    { criteria: { subject: 'newsletter' }, labels: ['Newsletters'] },
    {
      criteria: {
        subject: [
          'sale',
          'offer',
          'deal',
          'discount',
          'promo',
          'promotion',
          'limited time offer',
          'buy now',
          'free shipping',
          'exclusive offer',
        ],
      },
      labels: ['Promotions'],
    },
    {
      criteria: {
        body: [
          'unsubscribe',
          'manage preferences',
          'view in browser',
          'special offer',
          'limited time offer',
          'free shipping',
          'exclusive offer',
          'save up to',
        ],
      },
      labels: ['Promotions'],
    },

    // This is a powerful fallback rule. Most marketing and promotional emails
    // are legally required to have an "unsubscribe" link.
    // This will catch many emails that your other rules might have missed.
    { criteria: { body: 'unsubscribe' }, labels: ['Promotions'] },
  ],
};

// Keep the old nested path for compatibility, but prefer CONFIG.CLASSIFICATION_RULES.
CONFIG.RULES.CLASSIFICATION_RULES = CONFIG.CLASSIFICATION_RULES;
