export type RiskAction = 'allow' | 'challenge' | 'block';
export interface RiskEvent { success: boolean; score: number; clientIp?: string | null; createdAt: Date | string; }
export interface RiskInput {
  now?: number; elapsedMs?: number; attemptsCount?: number; remoteIp?: string;
  userAgent?: string; acceptLanguage?: string; recentEvents?: RiskEvent[];
}
export interface RiskAssessment { score: number; action: RiskAction; signals: string[]; }

/** Explainable server-side anti-automation scoring; this is not a trained ML model. */
export function assessCaptchaRisk(input: RiskInput): RiskAssessment {
  const now = input.now ?? Date.now();
  let score = 100;
  const signals: string[] = [];
  const ua = (input.userAgent || '').slice(0, 512).toLowerCase();
  const automationPatterns = [
    /headlesschrome|headlessfirefox/, /playwright|puppeteer|selenium|phantomjs/,
    /python-requests|python-urllib|aiohttp|httpx\//, /(?:^|\s)(?:curl|wget)\//,
    /scrapy|go-http-client|java\/\d/,
  ];
  if (ua && automationPatterns.some(pattern => pattern.test(ua))) {
    score -= 55; signals.push('automation-user-agent');
  } else if (!ua) { score -= 8; signals.push('missing-user-agent'); }
  if (!input.acceptLanguage) { score -= 4; signals.push('missing-language-header'); }

  if (typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs)) {
    if (input.elapsedMs < 150) { score -= 30; signals.push('impossibly-fast-solve'); }
    else if (input.elapsedMs < 350) { score -= 20; signals.push('very-fast-solve'); }
    else if (input.elapsedMs < 700) { score -= 10; signals.push('fast-solve'); }
    else if (input.elapsedMs < 1500) { score -= 4; signals.push('quick-solve'); }
  }
  const attempts = Math.max(0, Math.min(10, Math.floor(input.attemptsCount || 0)));
  if (attempts > 0) { score -= Math.min(25, attempts * 8); signals.push('multiple-answer-attempts'); }

  const events = (input.recentEvents || []).filter(event => {
    const time = new Date(event.createdAt).getTime();
    return Number.isFinite(time) && now - time >= 0 && now - time <= 5 * 60_000;
  });
  const sameIp = input.remoteIp ? events.filter(event => event.clientIp === input.remoteIp) : [];
  if (sameIp.length >= 10) { score -= 25; signals.push('high-ip-verification-volume'); }
  else if (sameIp.length >= 5) { score -= 12; signals.push('elevated-ip-verification-volume'); }
  const failures = sameIp.filter(event => !event.success);
  if (failures.length >= 6) { score -= 25; signals.push('repeated-ip-failures'); }
  else if (failures.length >= 3) { score -= 15; signals.push('multiple-ip-failures'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, action: score < 25 ? 'block' : score < 80 ? 'challenge' : 'allow', signals };
}
