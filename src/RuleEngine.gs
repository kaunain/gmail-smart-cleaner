/**
 * @fileoverview The RuleEngine for classifying Gmail threads based on configured rules.
 */

const RuleEngine = (function () {
  /**
   * Caches parsed email bodies to avoid redundant processing.
   * @type {Map<string, {from: string, domain: string, body: string}>}
   */
  const threadCache = new Map();

  /**
   * Extracts and caches relevant information from a thread.
   * @param {GoogleAppsScript.Gmail.GmailThread} thread The thread to process.
   * @returns {{from: string, domain: string, body: string}}
   */
  function getThreadInfo(thread) {
    const threadId = thread.getId();
    if (threadCache.has(threadId)) {
      return threadCache.get(threadId);
    }

    // Use a regular expression to reliably extract the email address from the 'From' header,
    // which can have various formats (e.g., "Sender Name <email@example.com>").
    const fromHeader = thread.getMessages()[0].getFrom() || '';
    const emailMatch = fromHeader.match(/<([^>]+)>/);
    const from = (emailMatch ? emailMatch[1] : fromHeader).toLowerCase();
    const domain = from.includes('@') ? from.split('@')[1] : '';

    // Get a plain text version of the body, truncated for performance.
    const body = thread
      .getMessages()[0]
      .getPlainBody()
      .toLowerCase()
      .substring(0, 5000);

    const info = { from, domain, body };
    threadCache.set(threadId, info);
    return info;
  }

  /**
   * Classifies a single Gmail thread based on the rules in Config.gs.
   * @param {GoogleAppsScript.Gmail.GmailThread} thread The Gmail thread to classify.
   * @returns {{labels: string[], from: string, domain: string}} The classification result.
   */
  function classifyThread(thread) {
    const subject = (thread.getFirstMessageSubject() || '').toLowerCase();
    const { from, domain, body } = getThreadInfo(thread);

    const classificationRules = CONFIG.CLASSIFICATION_RULES || [];

    // Separate priority rules from normal rules
    const priorityRules = classificationRules.filter((rule) => rule.isPriority);
    const normalRules = classificationRules.filter((rule) => !rule.isPriority);

    // Helper to safely check criteria, whether it's a string or an array of strings.
    const checkCriterion = (value, criterion) => {
      if (!criterion) return false;
      // Ensure criterion is an array for consistent processing.
      const criteriaArray = Array.isArray(criterion) ? criterion : [criterion];
      return criteriaArray.some((c) => value.includes(c.toLowerCase()));
    };

    // Function to check if a thread matches a rule's criteria
    const checkMatch = (rule) => {
      if (!rule.criteria) return false;
      const {
        from: fromCrit,
        domain: domainCrit,
        subject: subjectCrit,
        body: bodyCrit,
      } = rule.criteria;

      return (
        checkCriterion(from, fromCrit) ||
        checkCriterion(domain, domainCrit) ||
        checkCriterion(subject, subjectCrit) ||
        checkCriterion(body, bodyCrit)
      );
    };

    // Process priority rules first. If a match is found, stop and return.
    for (const rule of priorityRules) {
      if (checkMatch(rule)) {
        return {
          labels: rule.labels || [],
          from: from,
          domain: domain,
        };
      }
    }

    // If no priority rule matched, process normal rules.
    const matchedLabels = new Set();
    for (const rule of normalRules) {
      if (checkMatch(rule)) {
        (rule.labels || []).forEach((label) => matchedLabels.add(label));
      }
    }

    // If no rules matched, apply the default behavior as per README documentation.
    // This treats any unclassified, non-important email as a candidate for deletion.
    if (matchedLabels.size === 0) {
      // The 'Delete' label marks it for the TRASH_RULES to process.
      matchedLabels.add('Delete');
    }

    return {
      labels: [...matchedLabels],
      from: from,
      domain: domain,
    };
  }

  /**
   * Clears the internal cache. Should be called at the end of an execution.
   */
  function clearCache() {
    threadCache.clear();
  }

  return {
    classifyThread: classifyThread,
    clearCache: clearCache,
  };
})();
