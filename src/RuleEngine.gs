/**
 * @fileoverview Service responsible for classifying Gmail threads.
 */

const RuleEngine = {
  /**
   * Classifies a Gmail thread into labels based on CONFIG.RULES.
   *
   * @param {GoogleAppsScript.Gmail.GmailThread} thread Gmail thread to classify.
   * @returns {{labels: string[], from: string, domain: string}}
   */
  classifyThread(thread) {
    const labelsToApply = new Set();

    const messages = thread.getMessages();
    if (!messages || messages.length === 0) {
      AppLogger.warn(
        `Skipping thread with ID ${thread.getId()} because it has no messages.`
      );
      return { labels: [], from: '', domain: '' };
    }
    const firstMessage = messages[0];

    const subject = (thread.getFirstMessageSubject() || '').toLowerCase();

    const fromRaw = firstMessage.getFrom() || '';
    const from = Utils.normalizeEmail(fromRaw);
    const domain = Utils.getDomainFromEmail(fromRaw);

    const bodyText = (
      firstMessage.getPlainBody() ||
      firstMessage.getBody() ||
      ''
    )
      .substring(0, 5000)
      .toLowerCase();

    const existingLabels = thread
      .getLabels()
      .map((l) => l.getName().toLowerCase());

    const rules =
      (CONFIG && CONFIG.RULES && CONFIG.RULES.CLASSIFICATION_RULES) || [];

    /**
     * Checks if an email value matches a rule criterion, which can be a string or an array.
     * @param {string|string[]} criterion The rule criterion value.
     * @param {string} emailValue The value from the email.
     * @param {'includes'|'exact'} matchType The type of match to perform.
     * @returns {boolean} True if it matches.
     */
    const _matchesCriterion = (criterion, emailValue, matchType) => {
      if (!criterion) return true; // No criterion means it's a pass for this check.
      const values = Array.isArray(criterion) ? criterion : [criterion];

      if (matchType === 'includes') {
        return values.some((v) => emailValue.includes(String(v).toLowerCase()));
      }
      if (matchType === 'exact') {
        return values.some((v) => String(v).toLowerCase() === emailValue);
      }
      return false;
    };

    for (const rule of rules) {
      if (!rule || !rule.labels || rule.labels.length === 0) continue;

      const criteria = rule.criteria || {};
      let matched = true;

      if (
        criteria.from &&
        !_matchesCriterion(criteria.from, from, 'includes')
      ) {
        matched = false;
      }

      if (
        matched &&
        criteria.domain &&
        !_matchesCriterion(criteria.domain, domain, 'exact')
      ) {
        matched = false;
      }

      if (
        matched &&
        criteria.subject &&
        !_matchesCriterion(criteria.subject, subject, 'includes')
      ) {
        matched = false;
      }

      if (
        matched &&
        criteria.body &&
        !_matchesCriterion(criteria.body, bodyText, 'includes')
      ) {
        matched = false;
      }

      if (matched) {
        rule.labels.forEach((label) => labelsToApply.add(label));
        AppLogger.debug(
          `Matched rule for subject "${subject}", applying labels: [${rule.labels.join(
            ', '
          )}]`
        );

        if (rule.isPriority) {
          break;
        }
      }
    }

    return {
      labels: [...labelsToApply],
      from,
      domain,
    };
  },
};
