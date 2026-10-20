import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, RefreshCw, CheckCircle2, AlertTriangle, Clock, Lock } from 'lucide-react';
import { LanguageCode, translations } from '../i18n/translations.ts';

export interface CaptchaWidgetProps {
  siteKey: string;
  onVerify?: (token: string, verificationResult: any) => void;
  onError?: (errorCode: string) => void;
  onExpire?: () => void;
  theme?: 'dark' | 'light';
  action?: string;
  autoStart?: boolean;
  lang?: LanguageCode;
}

interface ChallengeOption {
  id: string;
  svg: string;
}

interface ChallengeData {
  challengeId: string;
  siteKey: string;
  prompt: string;
  options: ChallengeOption[];
  token: string;
  expiresInSeconds: number;
  expiresAt: string;
}

export const CaptchaWidget: React.FC<CaptchaWidgetProps> = ({
  siteKey,
  onVerify,
  onError,
  onExpire,
  theme = 'dark',
  action = 'submit',
  autoStart = true,
  lang = 'en',
}) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'challenge' | 'verifying' | 'success' | 'error' | 'expired'>('idle');
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(120);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<number>(0);
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);

  const t = (key: string): string => {
    const dict = translations[lang] || translations.en;
    return dict[key] || translations.en[key] || key;
  };
  const isRtl = lang === 'fa' || lang === 'ar';

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchChallenge = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    setSelectedOptionId(null);

    try {
      const res = await fetch('/api/v1/captcha/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteKey, lang }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const rawText = await res.text().catch(() => '');
        console.error('Non-JSON response from captcha challenge:', rawText.slice(0, 200));
        throw new Error(
          res.status >= 500
            ? (lang === 'fa' ? 'خطای موقت در ارتباط با سرویس؛ لطفاً مجدداً تلاش کنید.' : 'Temporary server error. Please retry.')
            : (lang === 'fa' ? `پاسخ غیرمنتظره از سرور (کد ${res.status})` : `Unexpected server response (HTTP ${res.status})`)
        );
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || data.code || `HTTP ${res.status}`);
      }

      setChallenge(data);
      setTimeLeft(data.expiresInSeconds || 120);
      setStatus('challenge');
    } catch (err: any) {
      console.error('Failed to load challenge:', err);
      setStatus('error');
      setErrorMessage(err.message || (lang === 'fa' ? 'خطا در برقراری ارتباط با سرور کپچا' : 'Failed to connect to CAPTCHA server'));
      onError?.(err.message || 'challenge_fetch_error');
    }
  }, [siteKey, lang, onError]);

  // Handle countdown timer
  useEffect(() => {
    if (status === 'challenge' && timeLeft > 0) {
      timerRef.current = setTimeout(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            setStatus('expired');
            onExpire?.();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [status, timeLeft, onExpire]);

  useEffect(() => {
    if (autoStart && siteKey) {
      fetchChallenge();
    }
  }, [autoStart, siteKey, fetchChallenge]);

  const handleVerify = async () => {
    if (!challenge || !selectedOptionId) return;

    setStatus('verifying');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/v1/captcha/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: challenge.token,
          selectedOptionId,
          action,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('پاسخ سرور در قالب معتبر دریافت نشد');
      }

      const data = await res.json();

      if (data.success) {
        setStatus('success');
        setVerifiedToken(challenge.token);
        onVerify?.(challenge.token, data);
      } else {
        const primaryError = data.error_codes?.[0] || 'verification_failed';
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);

        if (primaryError === 'challenge-expired' || primaryError === 'timeout-or-duplicate') {
          setStatus('expired');
          setErrorMessage(t('widgetExpiredDesc'));
        } else if (primaryError === 'max-attempts-exceeded' || newAttempts >= 3) {
          setStatus('error');
          setErrorMessage(t('widgetMaxAttemptsExceeded'));
        } else {
          setStatus('challenge');
          setErrorMessage(t('widgetIncorrectAnswer'));
        }

        onError?.(primaryError);
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMessage('خطای شبکه در اعتبارسنجی پاسخ');
      onError?.('network_error');
    }
  };

  const isDark = theme === 'dark';

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`rounded-xl border transition-all duration-200 overflow-hidden shadow-lg ${
        isDark
          ? 'bg-slate-900 border-slate-700/80 text-slate-100 shadow-emerald-950/20'
          : 'bg-white border-slate-200 text-slate-800 shadow-slate-200'
      } max-w-sm w-full mx-auto font-sans`}
      role="region"
      aria-label="ShieldCaptcha Security Verification"
    >
      {/* Widget Header */}
      <div className={`px-4 py-3 flex items-center justify-between border-b ${
        isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-100 bg-slate-50'
      }`}>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-semibold tracking-wide flex items-center gap-1.5">
              <span>ShieldCaptcha</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                Visual MVP
              </span>
            </h4>
            <p className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {t('appTagline')}
            </p>
          </div>
        </div>

        {status === 'challenge' && (
          <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span className={timeLeft < 30 ? 'text-rose-400 font-bold' : ''}>
              {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </span>
          </div>
        )}
      </div>

      {/* Widget Body */}
      <div className="p-4">
        {/* Loading State */}
        {status === 'loading' && (
          <div className="py-8 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
            <span className="text-xs text-slate-400">{t('widgetLoading')}</span>
          </div>
        )}

        {/* Verifying State */}
        {status === 'verifying' && (
          <div className="py-8 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
            <span className="text-xs text-emerald-400 font-medium">{t('widgetVerifying')}</span>
          </div>
        )}

        {/* Success State */}
        {status === 'success' && (
          <div className="py-6 flex flex-col items-center justify-center text-center gap-2">
            <div className="p-2 rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h5 className="text-sm font-semibold text-emerald-400">{t('widgetVerified')}</h5>
            <p className="text-[11px] text-slate-400 max-w-[240px]">
              {t('widgetTokenGenerated')}
            </p>
            {verifiedToken && (
              <div className="mt-2 text-[10px] font-mono px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700/60 truncate max-w-full">
                Token: {verifiedToken.slice(0, 14)}...{verifiedToken.slice(-6)}
              </div>
            )}
          </div>
        )}

        {/* Expired State */}
        {status === 'expired' && (
          <div className="py-6 flex flex-col items-center justify-center text-center gap-2">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <h5 className="text-xs font-semibold text-amber-400">{t('widgetExpiredTitle')}</h5>
            <p className="text-[11px] text-slate-400">{t('widgetExpiredDesc')}</p>
            <button
              onClick={fetchChallenge}
              className="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t('widgetRequestNew')}
            </button>
          </div>
        )}

        {/* Error State */}
        {status === 'error' && (
          <div className="py-6 flex flex-col items-center justify-center text-center gap-2">
            <AlertTriangle className="w-8 h-8 text-rose-400" />
            <h5 className="text-xs font-semibold text-rose-400">{t('widgetErrorTitle')}</h5>
            <p className="text-[11px] text-slate-400 max-w-[260px]">{errorMessage}</p>
            <button
              onClick={fetchChallenge}
              className="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t('widgetRetry')}
            </button>
          </div>
        )}

        {/* Interactive Image Challenge State */}
        {status === 'challenge' && challenge && (
          <div>
            <div className={`mb-3 ${isRtl ? 'text-right' : 'text-left'}`}>
              <span className="text-[11px] text-emerald-400 font-semibold block mb-0.5">{t('widgetInstruction')}</span>
              <p className="text-xs font-medium text-slate-100">{challenge.prompt}</p>
            </div>

            {errorMessage && (
              <div className="mb-3 p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMessage} ({attempts + 1} / 3)</span>
              </div>
            )}

            {/* 2x2 Visual Options Grid */}
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              {challenge.options.map((opt, index) => {
                const isSelected = selectedOptionId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedOptionId(opt.id)}
                    className={`relative p-3 rounded-lg border flex flex-col items-center justify-center transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-500/15 ring-2 ring-emerald-500/40'
                        : isDark
                        ? 'border-slate-700/80 bg-slate-800/60 hover:bg-slate-800 hover:border-slate-600'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                    aria-label={`Option ${index + 1}`}
                  >
                    <img
                      src={opt.svg}
                      alt={`Option ${index + 1}`}
                      className="w-12 h-12 object-contain pointer-events-none select-none transition-transform hover:scale-105"
                      loading="eager"
                    />
                    {isSelected && (
                      <span className={`absolute top-1.5 ${isRtl ? 'left-1.5' : 'right-1.5'} w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-emerald-900`} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
              <button
                type="button"
                onClick={fetchChallenge}
                title={t('widgetRequestNew')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
              </button>

              <button
                type="button"
                disabled={!selectedOptionId}
                onClick={handleVerify}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  selectedOptionId
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/40'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                {t('widgetSubmitAnswer')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Widget Footer */}
      <div className={`px-4 py-2 border-t text-[10px] flex items-center justify-between ${
        isDark ? 'border-slate-800/80 bg-slate-950/40 text-slate-500' : 'border-slate-100 bg-slate-50 text-slate-400'
      }`}>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
          ShieldCaptcha Guard
        </span>
        <span className="text-slate-400 font-mono text-[9px]">Privacy First</span>
      </div>
    </div>
  );
};

