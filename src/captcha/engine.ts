import crypto from 'node:crypto';
import { dbRepository } from '../db/index.ts';
import { assessCaptchaRisk } from './risk-engine.ts';
import { predictCaptchaMLShadow } from './ml-risk-engine.ts';

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
const SERVER_SALT = process.env.CAPTCHA_SERVER_SALT || (IS_PRODUCTION ? '' : 'shield_captcha_internal_salt_dev_98741');
if (IS_PRODUCTION && !SERVER_SALT) {
  throw new Error('[Captcha] CAPTCHA_SERVER_SALT is required in production; refusing to start with a default salt.');
}

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

function createPrismFlowSvg(angles: number[]): string {
  const arrow = (x: number, angle: number) =>
    `<g transform="rotate(${angle} ${x} 12)" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M ${x} 15 L ${x} 9 M ${x-2.2} 11.3 L ${x} 9 L ${x+2.2} 11.3"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${angles.map((angle, index) => arrow(4 + index * 8, angle)).join('')}</svg>`;
}


function polygonPath(sides: number, cx: number, cy: number, radius: number, rotation = -90): string {
  const points = Array.from({ length: sides }, (_, i) => {
    const angle = (rotation + (360 * i) / sides) * Math.PI / 180;
    return `${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`;
  });
  return points.join(' ');
}

function polygonSvg(sides: number, rotation = -90): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="${polygonPath(sides, 50, 50, 34, rotation)}" fill="#0f172a" stroke="#67e8f9" stroke-width="3" stroke-linejoin="round"/><circle cx="50" cy="50" r="3" fill="#f8fafc"/></svg>`;
}

function buildPolygonSequenceItems(optionCount: number): Array<{ category: string; correct: boolean; svgOverride?: string }> {
  const correct = [3, 4, 5];
  const sequences: Array<{ sides: number[]; correct: boolean }> = [{ sides: correct, correct: true }];
  const seen = new Set([correct.join(',')]);
  while (sequences.length < optionCount) {
    const sides = Array.from({ length: 3 }, () => crypto.randomInt(3, 9));
    const signature = sides.join(',');
    if (sides[1] === sides[0] + 1 && sides[2] === sides[1] + 1 || seen.has(signature)) continue;
    seen.add(signature);
    sequences.push({ sides, correct: false });
  }
  for (let i = sequences.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [sequences[i], sequences[j]] = [sequences[j], sequences[i]];
  }
  return sequences.map(({ sides, correct: isCorrect }) => ({
    category: 'key',
    correct: isCorrect,
    svgOverride: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 64">${sides.map((n, i) => `<polygon points="${polygonPath(n, 30 + i * 60, 32, 15)}" fill="#0f172a" stroke="#67e8f9" stroke-width="2" stroke-linejoin="round"/>`).join('')}</svg>`,
  }));
}

function buildPolygonCountItems(optionCount: number): Array<{ category: string; correct: boolean; svgOverride?: string }> {
  const distractors = [3, 4, 6, 7, 8, 9, 10];
  for (let i = distractors.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [distractors[i], distractors[j]] = [distractors[j], distractors[i]];
  }
  const sides = [5, ...distractors.slice(0, optionCount - 1)];
  for (let i = sides.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [sides[i], sides[j]] = [sides[j], sides[i]];
  }
  return sides.map(n => ({ category: 'key', correct: n === 5, svgOverride: polygonSvg(n) }));
}

function buildPrismFlowItems(optionCount: number): Array<{ category: string; correct: boolean; rotationAngle?: number; svgOverride?: string }> {
  const start = crypto.randomInt(0, 4) * 90;
  const direction = crypto.randomInt(0, 2) === 0 ? 1 : -1;
  const normalize = (angle: number) => (angle + 360) % 360;
  const correctAngles = [0, 1, 2].map(index => normalize(start + direction * 90 * index));
  const sequences: Array<{ angles: number[]; correct: boolean }> = [{ angles: correctAngles, correct: true }];
  const key = (angles: number[]) => angles.join(',');
  const seen = new Set([key(correctAngles)]);
  while (sequences.length < optionCount) {
    const angles = [0, 1, 2].map(() => crypto.randomInt(0, 4) * 90);
    const d1 = normalize(angles[1] - angles[0]);
    const d2 = normalize(angles[2] - angles[1]);
    const isConsistentQuarterTurn = (d1 === 90 && d2 === 90) || (d1 === 270 && d2 === 270);
    const signature = key(angles);
    if (isConsistentQuarterTurn || seen.has(signature)) continue;
    seen.add(signature);
    sequences.push({ angles, correct: false });
  }
  for (let i = sequences.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [sequences[i], sequences[j]] = [sequences[j], sequences[i]];
  }
  return sequences.map(sequence => ({
    category: 'key',
    correct: sequence.correct,
    svgOverride: createPrismFlowSvg(sequence.angles),
  }));
}

/**
 * Creates a visual image challenge with CSPRNG randomization.
 * Correct answer is hashed and kept strictly on the server.
 */
export async function issueCaptchaChallenge(
  siteKey: string,
  domain?: string,
  lang: string = 'en',
  forceHighDifficulty = false
): Promise<GeneratedChallenge> {
  const site = await dbRepository.getSiteByKey(siteKey);
  if (!site) {
    throw new Error('SITE_KEY_NOT_FOUND');
  }

  // Domain binding: never implicitly trust arbitrary hosted app domains.
  if (IS_PRODUCTION && !domain) {
    throw new Error('DOMAIN_REQUIRED');
  }
  const cleanTarget = domain?.toLowerCase().trim().replace(/\.$/, '');
  const isLocalHost = cleanTarget === 'localhost' || cleanTarget === '127.0.0.1';

  // Localhost is a development convenience only. It must never bypass the
  // production allow-list, even when a caller forges an Origin header.
  if (IS_PRODUCTION && isLocalHost) {
    throw new Error('DOMAIN_MISMATCH');
  }

  if (domain && !(!IS_PRODUCTION && isLocalHost)) {
    let appHostname = '';
    if (process.env.APP_URL) {
      try {
        appHostname = new URL(process.env.APP_URL).hostname.toLowerCase();
      } catch {}
    }

    const isSelfTesting = !!appHostname && cleanTarget === appHostname;

    // Normalize hostnames and allow only an explicitly configured exact domain
    // or its subdomains. A wildcard entry would silently authorize every website.
    const isAllowed = isSelfTesting || site.domains.some(d => {
      const cleanD = d.toLowerCase().trim().replace(/\.$/, '');
      if (!cleanD || cleanD === '*' || cleanD.includes('://') || cleanD.includes('/')) return false;
      return cleanD === cleanTarget || cleanTarget!.endsWith(`.${cleanD}`);
    });

    if (!isAllowed) {
      throw new Error('DOMAIN_MISMATCH');
    }
  }

  // Pick one of three visual challenge modes using a cryptographically secure RNG.
  const challengeMode = (['PRISM_FLOW', 'POLYGON_SEQUENCE', 'POLYGON_COUNT'] as const)[crypto.randomInt(0, 3)];
  const targetCategory = 'geometric-pattern';

  // Difficulty controls the number of visually plausible distractors.
  const optionCount = forceHighDifficulty || site.challengeDifficulty === 'HIGH' ? 8 : site.challengeDifficulty === 'LOW' ? 4 : 6;
  // Each mode has exactly one server-verified correct option.
  const challengeItems: Array<{ category: string; correct: boolean; rotationAngle?: number; svgOverride?: string }> =
    challengeMode === 'PRISM_FLOW'
      ? buildPrismFlowItems(optionCount)
      : challengeMode === 'POLYGON_SEQUENCE'
        ? buildPolygonSequenceItems(optionCount)
        : buildPolygonCountItems(optionCount);

  for (let i = challengeItems.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [challengeItems[i], challengeItems[j]] = [challengeItems[j], challengeItems[i]];
  }

  let correctOptionId = '';
  const options: VisualOption[] = [];
  for (const item of challengeItems) {
    const optId = `opt_${crypto.randomBytes(6).toString('hex')}`;
    if (item.correct) correctOptionId = optId;
    const optionSvg = item.svgOverride;
    if (!optionSvg) throw new Error('CAPTCHA_GEOMETRY_RENDER_FAILED');

    const encodedSvg = `data:image/svg+xml;utf8,${encodeURIComponent(optionSvg)}`;
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

  const prompt = ({
    PRISM_FLOW: {
      fa: 'توالی‌ای را انتخاب کنید که جهت هر پیکان در آن ۹۰ درجه و در یک جهت می‌چرخد.',
      en: 'Select the sequence where each arrow turns 90 degrees in the same direction.',
      es: 'Seleccione la secuencia en la que cada flecha gira 90 grados en la misma dirección.',
      zh: '请选择每个箭头都沿同一方向旋转 90 度的序列。',
      ar: 'اختر التسلسل الذي يدور فيه كل سهم 90 درجة في الاتجاه نفسه.',
      fr: 'Sélectionnez la séquence où chaque flèche tourne de 90 degrés dans le même sens.',
      de: 'Wählen Sie die Folge, in der sich jeder Pfeil in dieselbe Richtung um 90 Grad dreht.',
      ru: 'Выберите последовательность, в которой каждая стрелка поворачивается на 90 градусов в одном направлении.',
      pt: 'Selecione a sequência em que cada seta gira 90 graus na mesma direção.',
      ja: '各矢印が同じ方向に90度回転する並びを選択してください。',
    },
    POLYGON_SEQUENCE: {
      fa: 'توالی چندضلعی‌هایی را انتخاب کنید که تعداد ضلع‌ها در هر مرحله یکی بیشتر می‌شود.',
      en: 'Select the polygon sequence that adds exactly one side at each step.',
      es: 'Seleccione la secuencia de polígonos que añade exactamente un lado en cada paso.',
      zh: '请选择每一步都恰好增加一条边的多边形序列。',
      ar: 'اختر تسلسل المضلعات الذي يضيف ضلعًا واحدًا بالضبط في كل خطوة.',
      fr: 'Sélectionnez la suite de polygones qui ajoute exactement un côté à chaque étape.',
      de: 'Wählen Sie die Polygonfolge, die bei jedem Schritt genau eine Seite hinzufügt.',
      ru: 'Выберите последовательность многоугольников, в которой на каждом шаге добавляется ровно одна сторона.',
      pt: 'Selecione a sequência de polígonos que adiciona exatamente um lado em cada etapa.',
      ja: '各段階で辺がちょうど1本ずつ増える多角形の並びを選択してください。',
    },
    POLYGON_COUNT: {
      fa: 'پنج‌ضلعی را انتخاب کنید؛ شکلی که دقیقاً پنج ضلع دارد.',
      en: 'Select the pentagon: the polygon with exactly five sides.',
      es: 'Seleccione el pentágono: el polígono que tiene exactamente cinco lados.',
      zh: '请选择五边形，即恰好有五条边的多边形。',
      ar: 'اختر الشكل الخماسي الذي يحتوي على خمسة أضلاع بالضبط.',
      fr: 'Sélectionnez le pentagone, le polygone qui possède exactement cinq côtés.',
      de: 'Wählen Sie das Fünfeck mit genau fünf Seiten.',
      ru: 'Выберите пятиугольник — фигуру ровно с пятью сторонами.',
      pt: 'Selecione o pentágono, o polígono com exatamente cinco lados.',
      ja: '辺がちょうど5本ある五角形を選択してください。',
    },
  } as Record<string, Record<string, string>>)[challengeMode]?.[lang] || 'Select the correct geometric pattern.';

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
    maxAttempts: 2,
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
  userAgent?: string;
  acceptLanguage?: string;
}

export interface VerificationOutput {
  success: boolean;
  score: number; // 0 (bot) to 100 (human)
  hostname: string;
  challenge_ts: string;
  action: string;
  development_mode: boolean;
  error_codes: string[];
  risk_action?: 'allow' | 'challenge' | 'block';
  risk_signals?: string[];
}

export async function verifyCaptchaReceipt(input: { token: string; secretKey: string; hostname?: string; action?: string; remoteIp?: string }): Promise<VerificationOutput> {
  const timestamp = new Date().toISOString();
  const hostname = input.hostname || 'unknown';
  const challenge = await dbRepository.getChallengeByToken(input.token);
  if (!challenge) return { success: false, score: 0, hostname, challenge_ts: timestamp, action: 'server-verify', development_mode: !IS_PRODUCTION, error_codes: ['invalid-input-response'] };
  const site = await dbRepository.getSiteByKey(challenge.siteKey);
  const suppliedHash = crypto.createHash('sha256').update(input.secretKey).digest();
  const expectedHash = site ? Buffer.from(site.secretKeyHash, 'hex') : Buffer.alloc(0);
  const secretMatches = !!site && expectedHash.length === suppliedHash.length &&
    expectedHash.length > 0 && crypto.timingSafeEqual(expectedHash, suppliedHash);
  if (!secretMatches) {
    return { success: false, score: 0, hostname, challenge_ts: timestamp, action: 'server-verify', development_mode: !IS_PRODUCTION, error_codes: [site ? 'invalid-secret-key' : 'invalid-site'] };
  }
  if (!challenge.isConsumed || !challenge.solvedAt) {
    return { success: false, score: 0, hostname, challenge_ts: timestamp, action: 'server-verify', development_mode: !IS_PRODUCTION, error_codes: ['captcha-not-solved'] };
  }
  const solvedAt = new Date(challenge.solvedAt).getTime();
  if (!Number.isFinite(solvedAt) || Date.now() - solvedAt > 120000 || solvedAt > Date.now()) {
    return { success: false, score: 0, hostname, challenge_ts: timestamp, action: 'server-verify', development_mode: !IS_PRODUCTION, error_codes: ['timeout-or-duplicate'] };
  }
  const riskEvent = await dbRepository.getVerificationEventByToken(input.token);
  const riskScore = typeof riskEvent?.score === 'number' ? Math.max(0, Math.min(100, riskEvent.score)) : 50;
  const riskSignals = riskEvent
    ? (riskEvent.errorCodes || []).filter(code => code.startsWith('risk:')).map(code => code.slice(5))
    : ['missing-risk-event'];
  const claimed = await dbRepository.markChallengeServerVerified(input.token);
  if (!claimed) {
    return { success: false, score: 0, hostname, challenge_ts: timestamp, action: 'server-verify', development_mode: !IS_PRODUCTION, error_codes: ['timeout-or-duplicate'] };
  }
  return {
    success: true,
    score: riskScore,
    hostname,
    challenge_ts: timestamp,
    action: input.action || 'server-verify',
    development_mode: !IS_PRODUCTION,
    error_codes: [],
    risk_action: riskScore < 25 ? 'block' : riskScore < 80 ? 'challenge' : 'allow',
    risk_signals: riskSignals,
  };
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
      development_mode: !IS_PRODUCTION,
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
      development_mode: !IS_PRODUCTION,
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
      development_mode: !IS_PRODUCTION,
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
      development_mode: !IS_PRODUCTION,
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
      development_mode: !IS_PRODUCTION,
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
      development_mode: !IS_PRODUCTION,
      error_codes: errorCodes,
    };
  }

  const recentEvents = await dbRepository.getRecentEvents(challenge.siteKey);
  const risk = assessCaptchaRisk({
    elapsedMs: Date.now() - new Date(challenge.createdAt).getTime(),
    attemptsCount: challenge.attemptsCount,
    remoteIp: input.remoteIp,
    userAgent: input.userAgent,
    acceptLanguage: input.acceptLanguage,
    recentEvents: recentEvents.filter(event => event.token !== input.token),
  });
  const mlShadow = predictCaptchaMLShadow({
    elapsedMs: Date.now() - new Date(challenge.createdAt).getTime(),
    attemptsCount: challenge.attemptsCount,
    userAgent: input.userAgent,
    acceptLanguage: input.acceptLanguage,
    sameIpRecentCount: recentEvents.filter(event => event.clientIp === input.remoteIp).length,
    sameIpRecentFailureCount: recentEvents.filter(event => event.clientIp === input.remoteIp && !event.success).length,
  });
  const mlAuditCodes = mlShadow.available ? [`ml-shadow-score:${mlShadow.humanScore}`, `ml-shadow-model:${mlShadow.modelVersion}`] : [];

  // Verify the selected option using the server-only HMAC.
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
        development_mode: !IS_PRODUCTION,
        error_codes: errorCodes,
        challenge_consumed: newAttempts >= challenge.maxAttempts,
      };
    }
  }

  if (IS_PRODUCTION && risk.action === 'block') {
    await dbRepository.consumeChallengeToken(input.token);
    await dbRepository.recordVerificationEvent({
      siteKey: challenge.siteKey, token: input.token, success: false, score: risk.score,
      hostname, action: input.action, clientIp: input.remoteIp,
      errorCodes: ['high-risk-traffic', ...risk.signals.map(signal => `risk:${signal}`)],
    });
    return {
      success: false, score: risk.score, hostname, challenge_ts: challengeTs,
      action: input.action || 'verify', development_mode: !IS_PRODUCTION,
      error_codes: ['high-risk-traffic'], risk_action: risk.action, risk_signals: risk.signals,
    };
  }

  // 6. ATOMIC CONSUMPTION: consume token immediately upon successful verification!
  const consumed = await dbRepository.consumeChallengeToken(input.token, true);
  if (!consumed) {
    // If another concurrent request consumed it first
    errorCodes.push('timeout-or-duplicate');
    return {
      success: false,
      score: 0,
      hostname,
      challenge_ts: challengeTs,
      action: input.action || 'verify',
      development_mode: !IS_PRODUCTION,
      error_codes: errorCodes,
    };
  }

  // Verification SUCCESS!
  await dbRepository.recordVerificationEvent({
    siteKey: challenge.siteKey,
    token: input.token,
    success: true,
    score: risk.score,
    hostname,
    action: input.action,
    clientIp: input.remoteIp,
    errorCodes: [...(risk.signals.length ? risk.signals.map(signal => `risk:${signal}`) : []), ...mlAuditCodes],
  });

  return {
    success: true,
    score: risk.score,
    hostname,
    challenge_ts: challengeTs,
    action: input.action || 'verify',
    development_mode: !IS_PRODUCTION,
    error_codes: [],
    risk_action: risk.action,
    risk_signals: risk.signals,
  };
}
