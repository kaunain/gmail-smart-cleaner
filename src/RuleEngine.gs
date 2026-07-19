/**
 * @fileoverview The "brain" of the cleaner, responsible for classifying emails.
 */

const RuleEngine = {
  /**
   * Classifies a single Gmail thread based on the rules in Config.gs.
   * @param {GoogleAppsScript.Gmail.GmailThread} thread The thread to classify.
   * @returns {{labels: string[], from: string, domain: string}} An object containing the labels to apply and sender info.
   */
  classifyThread(thread) {
    const labelsToApply = new Set();
    const messages = thread.getMessages();
    // We only analyze the first and last message for efficiency.
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];

    const subject = thread.getFirstMessageSubject().toLowerCase();
    const from = firstMessage.getFrom().toLowerCase();
    const domain = Utils.getDomainFromEmail(from);
    // For body search, we only get a snippet to avoid performance issues.
    const bodySnippet = lastMessage.getPlainBody().substring(0, 500).toLowerCase();
    const threadLabels = thread.getLabels().map(l => l.getName().toLowerCase());

    for (const rule of CONFIG.CLASSIFICATION_RULES) {
      const { criteria, label, isPriority } = rule;
      let match = true;

      if (criteria.from && !from.includes(criteria.from.toLowerCase())) match = false;
      if (match && criteria.domain && domain !== criteria.domain.toLowerCase()) match = false;
      if (match && criteria.subject && !subject.includes(criteria.subject.toLowerCase())) match = false;
      if (match && criteria.body && !bodySnippet.includes(criteria.body.toLowerCase())) match = false;
      // Gmail categories are implemented as hidden labels, e.g., 'category:promotions'
      if (match && criteria.category && !threadLabels.includes(`category:${criteria.category.toLowerCase()}`)) {
        match = false;
      }

      if (match) {
        Logger.debug(`Thread "${subject}" matched rule for label "${label}". Criteria: ${JSON.stringify(criteria)}`);
        labelsToApply.add(label);
        if (isPriority) {
          Logger.debug('Priority rule matched. Stopping classification for this thread.');
          break; // Stop processing more rules for this thread
        }
      }
    }

    return { labels: [...labelsToApply], from, domain };
  },
};