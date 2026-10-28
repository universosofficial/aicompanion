import openai from '../../config/openai.js';

export const CRISIS_HOTLINE_INFO = {
  number: '988',
  name: '988 Suicide & Crisis Lifeline',
  callUrl: 'tel:988',
  smsUrl: 'sms:988',
  webUrl: 'https://988lifeline.org',
  intlUrl: 'https://findahelpline.com',
  badge: 'Free • Confidential • 24/7',
};

// Resilient deterministic regex patterns for immediate local safety guarantees
const CRISIS_PATTERNS = [
  /\b(?:i\s*(?:want|wish|need)\s*to|i'm\s*(?:going|planning)\s*to|i\s*will)\s*(?:kill|hang|shoot|overdose|cut|poison|end)\s*myself\b/i,
  /\b(?:i\s*(?:want|wish)\s*to\s*die|i\s*don'?t\s*want\s*to\s*(?:live|be\s*alive|exist|wake\s*up)(?:\s*anymore)?)\b/i,
  /\b(?:commit(?:ting)?|attempt(?:ing)?)\s*suicide\b/i,
  /\b(?:thinking\s*(?:about|of)|considering)\s*suicide\b/i,
  /\b(?:end\s*(?:it\s*all|my\s*life)|take\s*my\s*(?:own\s*)?life)\b/i,
  /\b(?:better\s*off\s*dead|no\s*reason\s*to\s*live|tired\s*of\s*(?:living|life))\b/i,
  /\b(?:cutting|harming|hurting)\s*myself\b/i,
  /\b(?:how\s*to\s*(?:commit\s*suicide|kill\s*myself|end\s*my\s*life))\b/i,
];

const CSAM_PATTERNS = [
  /\b(?:child|minor|underage|infant|toddler|baby)\s*(?:sex|porn|erotic|naked|nude|abuse|exploit|molest)\b/i,
  /\b(?:pedophil|paedophil|csam)\b/i,
];

const EXTREME_VIOLENCE_PATTERNS = [
  /\b(?:how\s*to\s*(?:make|build)\s*(?:a\s*)?(?:bomb|explosive|dirty\s*bomb|anthrax|sarin))\b/i,
  /\b(?:mass\s*shooting|commit\s*a\s*terrorist\s*attack|plan\s*a\s*school\s*shooting)\b/i,
];

const PUBLIC_HATE_PATTERNS = [
  /\b(?:exterminate|genocide|gas\s*all)\s*(?:jews|muslims|christians|blacks|whites|asians|lgbtq|trans|gays)\b/i,
];

export class ModerationService {
  /**
   * Scan text content through OpenAI Moderation API + local heuristic fallback rules.
   *
   * @param {string} text - User message, transcript, or knowledge document content
   * @param {Object} [options]
   * @param {boolean} [options.isPublic=false] - Whether content is public (e.g. shared Mind, knowledge upload)
   * @returns {Promise<{
   *   isAllowed: boolean,
   *   isCrisis: boolean,
   *   isHardViolation: boolean,
   *   flaggedCategory: string|null,
   *   reason: string|null,
   *   crisisHotline: Object|null
   * }>}
   */
  async checkContent(text, options = {}) {
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) {
      return {
        isAllowed: true,
        isCrisis: false,
        isHardViolation: false,
        flaggedCategory: null,
        reason: null,
        crisisHotline: null,
      };
    }

    const isPublic = Boolean(options.isPublic);

    // 1. Fast deterministic heuristic scan (Local zero-latency layer)
    const localCrisis = CRISIS_PATTERNS.some((pattern) => pattern.test(raw));
    const localCsam = CSAM_PATTERNS.some((pattern) => pattern.test(raw));
    const localExtremeViolence = EXTREME_VIOLENCE_PATTERNS.some((pattern) => pattern.test(raw));
    const localHate = isPublic && PUBLIC_HATE_PATTERNS.some((pattern) => pattern.test(raw));

    // Hard instant block for CSAM or extreme terror
    if (localCsam) {
      return {
        isAllowed: false,
        isCrisis: false,
        isHardViolation: true,
        flaggedCategory: 'sexual/minors',
        reason: 'This content violates child safety and legal protection policies.',
        crisisHotline: null,
      };
    }

    if (localExtremeViolence) {
      return {
        isAllowed: false,
        isCrisis: false,
        isHardViolation: true,
        flaggedCategory: 'violence/extreme',
        reason: 'This content violates policies regarding mass violence, terror, or weapons.',
        crisisHotline: null,
      };
    }

    if (localHate) {
      return {
        isAllowed: false,
        isCrisis: false,
        isHardViolation: true,
        flaggedCategory: 'hate/incitement',
        reason: 'Public AI Mind knowledge and profiles must adhere to anti-hate and non-discrimination guidelines.',
        crisisHotline: null,
      };
    }

    // 2. OpenAI Moderation API call (Comprehensive safety evaluation)
    let openAiFlagged = false;
    let openAiCategories = {};

    try {
      if (openai?.moderations?.create) {
        // Truncate to first 4,000 characters if scanning massive document to prevent API limits
        const truncatedInput = raw.length > 4000 ? raw.slice(0, 4000) : raw;
        const modResponse = await openai.moderations.create({
          input: truncatedInput,
          model: 'omni-moderation-latest',
        });

        const result = modResponse.results?.[0];
        if (result) {
          openAiFlagged = Boolean(result.flagged);
          openAiCategories = result.categories || {};
        }
      }
    } catch (apiErr) {
      // Gracefully fall back to local rules if API key is invalid or service is temporarily unreachable
      console.warn('[MODERATION SERVICE] OpenAI Moderation API notice (using local rules):', apiErr.message);
    }

    // 3. Evaluate Crisis / Self-Harm Signals
    const isSelfHarm = Boolean(
      localCrisis ||
      openAiCategories['self-harm'] ||
      openAiCategories['self-harm/intent'] ||
      openAiCategories['self-harm/instructions']
    );

    if (isSelfHarm) {
      // Philosophy: Never block or 400 a suicidal user.
      // Allow conversational de-escalation with special crisis protocol + surface 988 banner.
      return {
        isAllowed: true,
        isCrisis: true,
        isHardViolation: false,
        flaggedCategory: 'self-harm',
        reason: null,
        crisisHotline: CRISIS_HOTLINE_INFO,
      };
    }

    // 4. Evaluate Hard Violations from OpenAI
    if (openAiCategories['sexual/minors']) {
      return {
        isAllowed: false,
        isCrisis: false,
        isHardViolation: true,
        flaggedCategory: 'sexual/minors',
        reason: 'This content violates child safety and legal protection policies.',
        crisisHotline: null,
      };
    }

    if (openAiCategories['violence/graphic'] && isPublic) {
      return {
        isAllowed: false,
        isCrisis: false,
        isHardViolation: true,
        flaggedCategory: 'violence/graphic',
        reason: 'Public AI Mind knowledge and profiles must adhere to safety and non-violence standards.',
        crisisHotline: null,
      };
    }

    if (isPublic && (openAiCategories['hate/threatening'] || openAiCategories['harassment/threatening'])) {
      return {
        isAllowed: false,
        isCrisis: false,
        isHardViolation: true,
        flaggedCategory: 'hate/threatening',
        reason: 'Public knowledge documents and shared minds must adhere to safety and anti-harassment guidelines.',
        crisisHotline: null,
      };
    }

    return {
      isAllowed: true,
      isCrisis: false,
      isHardViolation: false,
      flaggedCategory: null,
      reason: null,
      crisisHotline: null,
    };
  }

  /**
   * Validate voice cloning consent declaration.
   * @param {boolean|string} consentValue
   * @returns {{ valid: boolean, error?: string }}
   */
  validateVoiceConsent(consentValue) {
    const hasConsent =
      consentValue === true ||
      consentValue === 'true' ||
      consentValue === 1 ||
      consentValue === '1';

    if (!hasConsent) {
      return {
        valid: false,
        error:
          'You must acknowledge and certify that you own all rights to this reference voice audio or have explicit written permission to use it under our Terms of Service.',
      };
    }

    return { valid: true };
  }
}

export const moderationService = new ModerationService();
export default moderationService;
