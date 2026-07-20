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

    const firstMessage = thread.getMessages()[0];
    const subject = (thread.getFirstMessageSubject() || '').toLowerCase();

    const fromRaw = (firstMessage.getFrom() || '').toLowerCase();
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

    for (const rule of rules) {
      if (!rule || !rule.label) continue;

      const criteria = rule.criteria || {};
      let matched = true;

      if (
        criteria.from &&
        !from.includes(String(criteria.from).toLowerCase())
      ) {
        matched = false;
      }

      if (
        matched &&
        criteria.domain &&
        domain !== String(criteria.domain).toLowerCase()
      ) {
        matched = false;
      }

      if (
        matched &&
        criteria.subject &&
        !subject.includes(String(criteria.subject).toLowerCase())
      ) {
        matched = false;
      }

      if (
        matched &&
        criteria.body &&
        !bodyText.includes(String(criteria.body).toLowerCase())
      ) {
        matched = false;
      }

      if (
        matched &&
        criteria.category &&
        !existingLabels.includes(
          `^smartlabel_${String(criteria.category).toLowerCase()}`
        )
      ) {
        matched = false;
      }

      if (matched) {
        labelsToApply.add(rule.label);
        Logger.debug(`Matched label "${rule.label}" for subject "${subject}"`);

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
