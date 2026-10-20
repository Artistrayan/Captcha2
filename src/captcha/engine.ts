import crypto from 'node:crypto';
import { dbRepository } from '../db/index.ts';

const SERVER_SALT = process.env.CAPTCHA_SERVER_SALT || 'shield_captcha_internal_salt_dev_98741';

export interface VisualOption {
  id: string; // e.g. opt_3a7b
  svg: string; // inline sanitized SVG data URI
}

export interface GeneratedChallenge {
  challengeId: string;
  siteKey: string;
  prompt: string;
  targetCategory: string;
  options: VisualOption[];
  token: string;
  expiresAt: Date;
  expiresInSeconds: number;
}

// Crisp, self-contained SVG icon templates for categories
// Completely local - no external images or network dependencies!
const SVG_ICONS: Record<string, string> = {
  star: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z"/></svg>`,
  heart: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z"/></svg>`,
  book: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  house: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linejoin="round"><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></svg>`,
  leaf: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linejoin="round"><path d="M20 4c-8 0-14 3-14 10a6 6 0 0 0 6 6c7 0 8-8 8-16z"/><path d="M3 21c3-6 7-9 13-12"/></svg>`,
  music: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
  lock: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  key: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg>`,
  bicycle: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>`,
  car: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>`,
  clock: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  bell: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  camera: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
  cloud: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
};

const CATEGORIES = Object.keys(SVG_ICONS);

const CATEGORY_NAMES_FA: Record<string, string> = {
  shield: 'سپر امنیت (Shield)',
  lock: 'قفل (Lock)',
  key: 'کلید (Key)',
  bicycle: 'دوچرخه (Bicycle)',
  car: 'اتومبیل (Car)',
  clock: 'ساعت (Clock)',
  bell: 'زنگوله (Bell)',
  camera: 'دوربین (Camera)',
  cloud: 'ابر (Cloud)',
};

const CATEGORY_NAMES_EN: Record<string, string> = {
  shield: 'Shield',
  lock: 'Lock',
  key: 'Key',
  bicycle: 'Bicycle',
  car: 'Car',
  clock: 'Clock',
  bell: 'Bell',
  camera: 'Camera',
  cloud: 'Cloud',
};

import { CATEGORY_NAMES_I18N, LanguageCode } from '../i18n/translations.ts';

export function generatePromptForLanguage(category: string, lang = 'en'): string {
  const catNames = CATEGORY_NAMES_I18N[category] || { en: category } as any;
  const langKey = (lang || 'en') as LanguageCode;
  const name = catNames[langKey] || catNames.en || category;

  switch (langKey) {
    case 'fa':
      return `تصویر «${name}» را انتخاب کنید.`;
    case 'es':
      return `Seleccione la imagen «${name}».`;
    case 'zh':
      return `请选择「${name}」图标。`;
    case 'ar':
      return `اختر صورة «${name}».`;
    case 'fr':
      return `Sélectionnez l'image «${name}».`;
    case 'de':
      return `Wählen Sie das Bild «${name}».`;
    case 'ru':
      return `Выберите изображение «${name}».`;
    case 'pt':
      return `Selecione a imagem «${name}».`;
    case 'ja':
      return `「${name}」の画像を選択してください。`;
    case 'en':
    default:
      return `Select the «${name}» image.`;
  }
}

/**
 * Creates a visual image challenge with CSPRNG randomization.
 * Correct answer is hashed and kept strictly on the server.
 */
export async function issueCaptchaChallenge(
  siteKey: string,
  domain?: string,
  lang: string = 'en'
): Promise<GeneratedChallenge> {
  const site = await dbRepository.getSiteByKey(siteKey);
  if (!site) {
    throw new Error('SITE_KEY_NOT_FOUND');
  }

  // Domain binding check if domain provided
  if (domain && domain !== 'localhost' && domain !== '127.0.0.1') {
    let appHostname = '';
    if (process.env.APP_URL) {
      try {
        appHostname = new URL(process.env.APP_URL).hostname;
      } catch {}
    }

    const isSelfTesting =
      (appHostname && domain === appHostname) ||
      domain.endsWith('.onrender.com') ||
      domain.endsWith('.run.app');

    const isAllowed = isSelfTesting || site.domains.some(d => {
      const cleanD = d.toLowerCase().trim();
      const cleanTarget = domain.toLowerCase().trim();
      return cleanD === cleanTarget || cleanTarget.endsWith(`.${cleanD}`) || cleanD === '*';
    });

    if (!isAllowed && site.domains.length > 0) {
      throw new Error('DOMAIN_MISMATCH');
    }
  }

  // Select target category using CSPRNG
  const targetCategoryIndex = crypto.randomInt(0, CATEGORIES.length);
  const targetCategory = CATEGORIES[targetCategoryIndex];

  // Difficulty controls the number of visually plausible distractors.
  const optionCount = site.challengeDifficulty === 'HIGH' ? 8 : site.challengeDifficulty === 'LOW' ? 4 : 6;
  const challengeMode = crypto.randomInt(0, 2) === 0 ? 'IMAGE_SELECTION' : 'ODD_ONE_OUT';
  const otherCategories = CATEGORIES.filter(c => c !== targetCategory);
  for (let i = otherCategories.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [otherCategories[i], otherCategories[j]] = [otherCategories[j], otherCategories[i]];
  }

  // Each mode has one server-verified correct option.
  const challengeItems: Array<{ category: string; correct: boolean }> =
    challengeMode === 'ODD_ONE_OUT'
      ? [
          { category: targetCategory, correct: true },
          ...Array.from({ length: optionCount - 1 }, () => ({
            category: otherCategories[0],
            correct: false,
          })),
        ]
      : [
          { category: targetCategory, correct: true },
          ...otherCategories.slice(0, optionCount - 1).map(category => ({
            category,
            correct: false,
          })),
        ];

  for (let i = challengeItems.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [challengeItems[i], challengeItems[j]] = [challengeItems[j], challengeItems[i]];
  }

  let correctOptionId = '';
  const options: VisualOption[] = [];
  for (const item of challengeItems) {
    const optId = `opt_${crypto.randomBytes(6).toString('hex')}`;
    if (item.correct) correctOptionId = optId;
    const encodedSvg = `data:image/svg+xml;utf8,${encodeURIComponent(SVG_ICONS[item.category])}`;
    options.push({ id: optId, svg: encodedSvg });
  }
  const challengeId = `ch_${crypto.randomBytes(12).toString('hex')}`;
  const token = `sct_${crypto.randomBytes(24).toString('base64url')}`;
  const expiresInSeconds = 20;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  // Compute secure HMAC hash of correct option ID
  const correctAnswerHash = crypto
    .createHmac('sha256', SERVER_SALT)
    .update(`${challengeId}:${correctOptionId}`)
    .digest('hex');

  const prompt = challengeMode === 'ODD_ONE_OUT'
    ? ({
        fa: 'تصویری را انتخاب کنید که با بقیه متفاوت است.',
        en: 'Select the image that is different from the others.',
        es: 'Seleccione la imagen diferente de las demás.',
        zh: '请选择与其他图标不同的图片。',
        ar: 'اختر الصورة المختلفة عن البقية.',
        fr: 'Sélectionnez l’image différente des autres.',
        de: 'Wählen Sie das Bild, das sich von den anderen unterscheidet.',
        ru: 'Выберите изображение, которое отличается от остальных.',
        pt: 'Selecione a imagem diferente das outras.',
        ja: 'ほかと異なる画像を選択してください。',
      } as Record<string, string>)[lang] || 'Select the image that is different from the others.'
    : generatePromptForLanguage(targetCategory, lang);

  // Persist challenge in database
  await dbRepository.createChallenge({
    id: challengeId,
    siteKey,
    challengeType: challengeMode,
    prompt,
    correctAnswerHash,
    options: options.map(o => ({ id: o.id, label: '', icon: o.svg })),
    token,
    expiresAt,
    maxAttempts: 3,
  });

  return {
    challengeId,
    siteKey,
    prompt,
    targetCategory,
    options,
    token,
    expiresAt,
    expiresInSeconds,
  };
}

export interface VerificationInput {
  token: string;
  selectedOptionId?: string;
  secretKey?: string;
  remoteIp?: string;
  hostname?: string;
  action?: string;
}

export interface VerificationOutput {
  success: boolean;
  score: number; // 0 (bot) to 100 (human)
  hostname: string;
  challenge_ts: string;
  action: string;
  development_mode: boolean;
  error_codes: string[];
}

/**
 * Server-side CAPTCHA verification.
 * Enforces atomic consumption, expiration check, attempt limits, and single-use replay protection.
 */
export async function verifyCaptchaResponse(input: VerificationInput): Promise<VerificationOutput> {
  const errorCodes: string[] = [];
  const challengeTs = new Date().toISOString();
  const hostname = input.hostname || 'localhost';

  if (!input.token) {
    return {
      success: false,
      score: 0,
      hostname,
      challenge_ts: challengeTs,
      action: input.action || 'verify',
      development_mode: true,
      error_codes: ['missing-input-response'],
    };
  }

  // Fetch challenge from database
  const challenge = await dbRepository.getChallengeByToken(input.token);

  if (!challenge) {
    return {
      success: false,
      score: 0,
      hostname,
      challenge_ts: challengeTs,
      action: input.action || 'verify',
      development_mode: true,
      error_codes: ['invalid-input-response'],
    };
  }

  // A token alone is never proof of a solved challenge: require an explicit option.
  if (!input.selectedOptionId) {
    await dbRepository.recordVerificationEvent({
      siteKey: challenge.siteKey,
      token: input.token,
      success: false,
      score: 0,
      hostname,
      action: input.action,
      clientIp: input.remoteIp,
      errorCodes: ['missing-input-response'],
    });
    return {
      success: false,
      score: 0,
      hostname,
      challenge_ts: challengeTs,
      action: input.action || 'verify',
      development_mode: true,
      error_codes: ['missing-input-response'],
    };
  }

  // 1. Replay / Consumption check: Was it already used?
  if (challenge.isConsumed) {
    errorCodes.push('timeout-or-duplicate');
    await dbRepository.recordVerificationEvent({
      siteKey: challenge.siteKey,
      token: input.token,
      success: false,
      score: 0,
      hostname,
      action: input.action,
      clientIp: input.remoteIp,
      errorCodes,
    });
    return {
      success: false,
      score: 0,
      hostname,
      challenge_ts: challengeTs,
      action: input.action || 'verify',
      development_mode: true,
      error_codes: errorCodes,
    };
  }

  // 2. Expiration check
  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    // Atomically consume to prevent lingering expired attempts
    await dbRepository.consumeChallengeToken(input.token);
    errorCodes.push('challenge-expired');
    await dbRepository.recordVerificationEvent({
      siteKey: challenge.siteKey,
      token: input.token,
      success: false,
      score: 0,
      hostname,
      action: input.action,
      clientIp: input.remoteIp,
      errorCodes,
    });
    return {
      success: false,
      score: 0,
      hostname,
      challenge_ts: challengeTs,
      action: input.action || 'verify',
      development_mode: true,
      error_codes: errorCodes,
    };
  }

  // 3. Max attempts check
  if (challenge.attemptsCount >= challenge.maxAttempts) {
    await dbRepository.consumeChallengeToken(input.token);
    errorCodes.push('max-attempts-exceeded');
    await dbRepository.recordVerificationEvent({
      siteKey: challenge.siteKey,
      token: input.token,
      success: false,
      score: 0,
      hostname,
      action: input.action,
      clientIp: input.remoteIp,
      errorCodes,
    });
    return {
      success: false,
      score: 0,
      hostname,
      challenge_ts: challengeTs,
      action: input.action || 'verify',
      development_mode: true,
      error_codes: errorCodes,
    };
  }

  // 4. Secret Key check (if server-to-server verify is being performed).
  // Invalid credentials must fail closed; never continue into answer verification.
  if (input.secretKey) {
    const site = await dbRepository.getSiteByKey(challenge.siteKey);
    const hashedProvidedSecret = crypto.createHash('sha256').update(input.secretKey).digest('hex');
    if (!site || hashedProvidedSecret !== site.secretKeyHash) {
      const secretError = !site ? 'invalid-site' : 'invalid-secret-key';
      await dbRepository.recordVerificationEvent({
        siteKey: challenge.siteKey,
        token: input.token,
        success: false,
        score: 0,
        hostname,
        action: input.action,
        clientIp: input.remoteIp,
        errorCodes: [secretError],
      });
      return {
        success: false,
        score: 0,
        hostname,
        challenge_ts: challengeTs,
        action: input.action || 'verify',
        development_mode: true,
        error_codes: [secretError],
      };
    }
  }

  // 5. Verify Answer correctness using HMAC
  if (input.selectedOptionId) {
    const candidateHash = crypto
      .createHmac('sha256', SERVER_SALT)
      .update(`${challenge.id}:${input.selectedOptionId}`)
      .digest('hex');

    // Use timingSafeEqual to prevent timing attacks
    const bufCandidate = Buffer.from(candidateHash, 'hex');
    const bufCorrect = Buffer.from(challenge.correctAnswerHash, 'hex');

    const isMatch = bufCandidate.length === bufCorrect.length && crypto.timingSafeEqual(bufCandidate, bufCorrect);

    if (!isMatch) {
      const newAttempts = await dbRepository.incrementChallengeAttempts(challenge.id);
      errorCodes.push('incorrect-captcha-sol');
      if (newAttempts >= challenge.maxAttempts) {
        await dbRepository.consumeChallengeToken(input.token);
      }
      await dbRepository.recordVerificationEvent({
        siteKey: challenge.siteKey,
        token: input.token,
        success: false,
        score: 0,
        hostname,
        action: input.action,
        clientIp: input.remoteIp,
        errorCodes,
      });
      return {
        success: false,
        score: 0,
        hostname,
        challenge_ts: challengeTs,
        action: input.action || 'verify',
        development_mode: true,
        error_codes: errorCodes,
      };
    }
  }

  // 6. ATOMIC CONSUMPTION: consume token immediately upon successful verification!
  const consumed = await dbRepository.consumeChallengeToken(input.token);
  if (!consumed) {
    // If another concurrent request consumed it first
    errorCodes.push('timeout-or-duplicate');
    return {
      success: false,
      score: 0,
      hostname,
      challenge_ts: challengeTs,
      action: input.action || 'verify',
      development_mode: true,
      error_codes: errorCodes,
    };
  }

  // Verification SUCCESS!
  await dbRepository.recordVerificationEvent({
    siteKey: challenge.siteKey,
    token: input.token,
    success: true,
    score: 95, // Human verified visual puzzle
    hostname,
    action: input.action,
    clientIp: input.remoteIp,
    errorCodes: [],
  });

  return {
    success: true,
    score: 95,
    hostname,
    challenge_ts: challengeTs,
    action: input.action || 'verify',
    development_mode: true,
    error_codes: [],
  };
}
