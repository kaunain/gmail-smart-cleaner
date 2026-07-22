/**
 * @fileoverview Service responsible for classifying Gmail threads.
 */

const RuleEngine = {
  /**
   * Classifies a Gmail thread into labels based on CONFIG.CLASSIFICATION_RULES
   * or CONFIG.RULES.CLASSIFICATION_RULES.
   *
   * @param {GoogleAppsScript.Gmail.GmailThread} thread Gmail thread to classify.
   * @returns {{labels: string[], from: string, domain: string}}
   */
  classifyThread(thread) {
    const labelsToApply = new Set();
    const matchedRules = new Set();
    const matchedDomains = new Set();
    const matchedKeywords = new Set();
    const matchedSender = new Set();

    const messages = thread.getMessages();
    if (!messages || messages.length === 0) {
      AppLogger.warn(
        `Skipping thread with ID ${thread.getId()} because it has no messages.`
      );
      return {
        labels: [],
        from: '',
        domain: '',
        matchedRules: [],
        matchedDomains: [],
        matchedKeywords: [],
        matchedSender: [],
      };
    }
    const firstMessage = messages[0];
    const threadId = thread.getId();

    if (CONFIG.EXECUTION.DEBUG) {
      AppLogger.debug(
        `  [CLASSIFICATION] Starting for thread "${thread.getFirstMessageSubject()}" (ID: ${threadId})`
      );
    }

    // --- GATHERING EMAIL DATA ---

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

    const rules = Utils.getClassificationRules();
    const rulesSource = CONFIG?.CLASSIFICATION_RULES
      ? 'CONFIG.CLASSIFICATION_RULES'
      : CONFIG?.RULES?.CLASSIFICATION_RULES
        ? 'CONFIG.RULES.CLASSIFICATION_RULES'
        : 'none';

    if (CONFIG.EXECUTION.DEBUG) {
      if (rulesSource === 'CONFIG.RULES.CLASSIFICATION_RULES') {
        AppLogger.debug(
          '    > Warning: classification rules were found under CONFIG.RULES.CLASSIFICATION_RULES. Please move them to CONFIG.CLASSIFICATION_RULES or keep this fallback until configuration is corrected.'
        );
      }
      if (rules.length === 0) {
        AppLogger.debug(
          '    > Warning: No classification rules were found. Check CONFIG.CLASSIFICATION_RULES.'
        );
      }
      AppLogger.debug(
        `    > Loaded ${rules.length} classification rule(s) from ${rulesSource}.`
      );
      AppLogger.debug(`    > From: ${fromRaw} (Normalized: ${from})`);
      AppLogger.debug(`    > Domain: ${domain}`);
      AppLogger.debug(`    > Subject: ${subject}`);
      AppLogger.debug(`    > Existing Labels: [${existingLabels.join(', ')}]`);
      AppLogger.debug(
        `    > Body (first 200 chars): ${bodyText.substring(0, 200)}...`
      );
    }

    /**
     * Checks if an email value matches a rule criterion, which can be a string or an array.
     * @param {string|string[]} criterion The rule criterion value.
     * @param {string} emailValue The value from the email.
     * @param {'includes'|'exact'} matchType The type of match to perform.
     * @returns {boolean} True if it matches.
     */
    const _matchesCriterion = (criterion, emailValue, matchType) => {
      if (!criterion) {
        return true; // A non-existent criterion is always a "pass".
      }
      if (!emailValue) {
        if (CONFIG.EXECUTION.DEBUG) {
          AppLogger.debug(
            `      > Match failed for criterion [${criterion}]: Email value is empty.`
          );
        }
        return false; // A criterion requires a value to match against.
      }
      const values = Array.isArray(criterion) ? criterion : [criterion];

      if (matchType === 'includes') {
        const match = values.some((v) =>
          emailValue.includes(String(v).toLowerCase())
        );
        if (CONFIG.EXECUTION.DEBUG) {
          AppLogger.debug(
            `      > [includes] Checking if "${emailValue.substring(
              0,
              100
            )}..." contains any of [${values.join(', ')}]. Result: ${match}`
          );
        }
        return match;
      }
      if (matchType === 'exact') {
        const match = values.some(
          (v) => String(v).toLowerCase() === emailValue
        );
        if (CONFIG.EXECUTION.DEBUG) {
          AppLogger.debug(
            `      > [exact] Checking if "${emailValue}" is an exact match for any of [${values.join(
              ', '
            )}]. Result: ${match}`
          );
        }
        return match;
      }
      // Special handling for domains to match subdomains correctly.
      // e.g., an email from 'notifications.github.com' should match a rule for 'github.com'.
      if (matchType === 'domain') {
        const match = values.some((v) => {
          const critDomain = String(v).toLowerCase();
          return (
            emailValue === critDomain || emailValue.endsWith(`.${critDomain}`)
          );
        });
        if (CONFIG.EXECUTION.DEBUG) {
          AppLogger.debug(
            `      > [domain] Checking if domain "${emailValue}" matches any of [${values.join(
              ', '
            )}]. Result: ${match}`
          );
        }
        return match;
      }
      if (CONFIG.EXECUTION.DEBUG) {
        AppLogger.debug(
          `      > Unknown matchType "${matchType}". Returning false.`
        );
      }
      return false;
    };

    let matchedAnyRule = false;
    for (const rule of rules) {
      if (!rule || !rule.labels || rule.labels.length === 0) continue;

      const { criteria = {}, labels, isPriority } = rule;
      const ruleDescription = `rule with labels [${labels.join(
        ', '
      )}] and criteria ${JSON.stringify(criteria)}`;
      if (CONFIG.EXECUTION.DEBUG) {
        AppLogger.debug(`  [RULE_CHECK] Evaluating ${ruleDescription}`);
      }

      let matched = true;

      if (criteria.from) {
        if (CONFIG.EXECUTION.DEBUG)
          AppLogger.debug(`    - Checking 'from' criterion...`);
        if (!_matchesCriterion(criteria.from, from, 'includes')) {
          matched = false;
        }
      }

      if (matched && criteria.domain) {
        if (CONFIG.EXECUTION.DEBUG)
          AppLogger.debug(`    - Checking 'domain' criterion...`);
        if (!_matchesCriterion(criteria.domain, domain, 'domain')) {
          matched = false;
        } else {
          const values = Array.isArray(criteria.domain)
            ? criteria.domain
            : [criteria.domain];
          values.forEach((value) => matchedDomains.add(String(value)));
        }
      }

      if (matched && criteria.subject) {
        if (CONFIG.EXECUTION.DEBUG)
          AppLogger.debug(`    - Checking 'subject' criterion...`);
        if (!_matchesCriterion(criteria.subject, subject, 'includes')) {
          matched = false;
        } else {
          const values = Array.isArray(criteria.subject)
            ? criteria.subject
            : [criteria.subject];
          values.forEach((value) => matchedKeywords.add(String(value)));
        }
      }

      if (matched && criteria.body) {
        if (CONFIG.EXECUTION.DEBUG)
          AppLogger.debug(`    - Checking 'body' criterion...`);
        if (!_matchesCriterion(criteria.body, bodyText, 'includes')) {
          matched = false;
        } else {
          const values = Array.isArray(criteria.body)
            ? criteria.body
            : [criteria.body];
          values.forEach((value) => matchedKeywords.add(String(value)));
        }
      }

      if (CONFIG.EXECUTION.DEBUG) {
        AppLogger.debug(`    > Overall rule match result: ${matched}`);
      }

      if (matched) {
        matchedAnyRule = true;
        matchedRules.add(ruleDescription);
        if (criteria.from) {
          const values = Array.isArray(criteria.from)
            ? criteria.from
            : [criteria.from];
          values.forEach((value) => matchedSender.add(String(value)));
        }
        if (CONFIG.EXECUTION.DEBUG) {
          AppLogger.debug(
            `  [RULE MATCH] Matched rule for subject "${subject}", queueing labels: [${labels.join(
              ', '
            )}]`
          );
        }
        labels.forEach((label) => labelsToApply.add(label));

        if (isPriority) {
          if (CONFIG.EXECUTION.DEBUG) {
            AppLogger.debug(
              '  [RULE PRIORITY] This is a priority rule. Stopping further rule processing for this thread.'
            );
          }
          break;
        }
      }
    }

    if (!matchedAnyRule) {
      if (CONFIG.EXECUTION.DEBUG) {
        AppLogger.debug(
          '  [FALLBACK] No classification rules matched. Applying Delete label.'
        );
      }
      labelsToApply.add('Delete');
      matchedRules.add('Fallback: Delete because no classification rule matched');
    }

    return {
      labels: [...labelsToApply],
      from,
      domain,
      matchedRules: [...matchedRules],
      matchedDomains: [...matchedDomains],
      matchedKeywords: [...matchedKeywords],
      matchedSender: [...matchedSender],
    };
  },
};
