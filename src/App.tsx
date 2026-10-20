import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield, Key, Globe, Plus, Trash2, Copy, Check, RefreshCw,
  Terminal, ShieldCheck, ShieldAlert, Code2, ExternalLink,
  Layers, Lock, Database, AlertCircle, Eye, EyeOff,
  Activity, TrendingUp, CheckCircle2, XCircle
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RechartsTooltip, Legend
} from 'recharts';
import { CaptchaWidget } from './components/CaptchaWidget.tsx';
import { LanguageSelector, useI18n } from './i18n/LanguageContext.tsx';

interface SiteItem {
  id: string;
  name: string;
  siteKey: string;
  domains: string[];
  maskedSecretKey: string;
  challengeDifficulty: string;
  invisibleEnabled: boolean;
  rateLimitPerMinute: number;
  createdAt: string;
}

interface HealthStatus {
  status: string;
  version: string;
  database: {
    isPostgresConnected: boolean;
    engine: string;
    databaseUrlConfigured: boolean;
  };
  firebaseAuth: {
    isInitialized: boolean;
    authMode: string;
  };
}

export default function App() {
  const { t, meta } = useI18n();
  const [country, setCountry] = useState<string>(() => localStorage.getItem('shieldcaptcha_country') || 'US');
  const [activeTab, setActiveTab] = useState<'sites' | 'playground' | 'logs' | 'docs'>('sites');
  const [health, setHealth] = useState<HealthStatus | null>(null);

  // User session state (Defaults to developer session)
  const [userEmail, setUserEmail] = useState<string>(import.meta.env.DEV ? 'developer@shieldcaptcha.dev' : '');
  const [authToken, setAuthToken] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [isLoadingSites, setIsLoadingSites] = useState<boolean>(true);
  const [selectedSiteKey, setSelectedSiteKey] = useState<string>('');

  // Add Site Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteDomains, setNewSiteDomains] = useState('localhost, 127.0.0.1');
  const [newSiteDifficulty, setNewSiteDifficulty] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [newSiteInvisible, setNewSiteInvisible] = useState(true);
  const [isCreatingSite, setIsCreatingSite] = useState(false);

  // One-time Secret Key modal
  const [oneTimeSecretModal, setOneTimeSecretModal] = useState<{
    siteName: string;
    siteKey: string;
    secretKey: string;
  } | null>(null);

  // Playground & Test Suite states
  const [lastVerifiedToken, setLastVerifiedToken] = useState<string | null>(null);
  const [lastVerifiedSiteKey, setLastVerifiedSiteKey] = useState<string | null>(null);
  const [lastVerificationData, setLastVerificationData] = useState<any>(null);
  const [testResultLog, setTestResultLog] = useState<{
    title: string;
    status: 'success' | 'failed';
    code?: string;
    payload: any;
    timestamp: string;
  } | null>(null);
  const [isTestingScenario, setIsTestingScenario] = useState(false);

  // Audit Logs
  const [logs, setLogs] = useState<any[]>([]);
  const [hourlyTraffic, setHourlyTraffic] = useState<Array<{ hour: string; passed: number; blocked: number }>>([]);
  const [analyticsSummary, setAnalyticsSummary] = useState({ totalRequests: 0, passedRequests: 0, blockedRequests: 0, passRatePercent: 0 });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Initialize session & fetch health
  useEffect(() => {
    fetch('/api/v1/health')
      .then(res => res.json())
      .then(data => setHealth(data))
      .catch(console.error);

    // Developer sessions are only permitted in local development. Production must use real Firebase sign-in.
    if (import.meta.env.DEV) {
      loginUser(userEmail);
    } else {
      const savedToken = sessionStorage.getItem('shieldcaptcha_id_token');
      const savedEmail = sessionStorage.getItem('shieldcaptcha_user_email');
      if (savedToken) {
        setAuthToken(savedToken);
        if (savedEmail) setUserEmail(savedEmail);
        fetchSites(savedToken);
      } else {
        setIsLoadingSites(false);
      }
    }
  }, []);

  const loginUser = async (email: string, password?: string): Promise<string> => {
    setIsLoadingSites(true);
    setIsSigningIn(true);
    setAuthError('');
    try {
      if (import.meta.env.DEV) {
        const res = await fetch('/api/v1/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name: email.split('@')[0] }),
        });
        const data = await res.json();
        if (!res.ok || !data.token) throw new Error(data.message || 'ورود آزمایشی ناموفق بود');
        setAuthToken(data.token);
        fetchSites(data.token);
        return data.token;
      }

      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      if (!apiKey) throw new Error('کلید عمومی Firebase در تنظیمات ساخت سایت تعریف نشده است.');
      if (!health?.firebaseAuth.isInitialized) throw new Error('احراز هویت سمت سرور آماده نیست؛ تنظیمات Firebase Admin را بررسی کنید.');
      if (!password) throw new Error('گذرواژه را وارد کنید.');

      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.idToken) {
        const code = data?.error?.message;
        const messages: Record<string, string> = {
          EMAIL_NOT_FOUND: 'این ایمیل در Firebase ثبت نشده است.',
          INVALID_PASSWORD: 'گذرواژه صحیح نیست.',
          INVALID_LOGIN_CREDENTIALS: 'ایمیل یا گذرواژه صحیح نیست.',
          USER_DISABLED: 'این حساب غیرفعال شده است.',
          TOO_MANY_ATTEMPTS_TRY_LATER: 'تلاش‌های زیادی انجام شده؛ کمی بعد دوباره امتحان کنید.',
        };
        throw new Error(messages[code] || 'ورود Firebase ناموفق بود.');
      }
      sessionStorage.setItem('shieldcaptcha_id_token', data.idToken);
      sessionStorage.setItem('shieldcaptcha_user_email', data.email || email);
      setAuthToken(data.idToken);
      setUserEmail(data.email || email);
      setAuthPassword('');
      fetchSites(data.idToken);
      return data.idToken;
    } catch (err: any) {
      setAuthError(err?.message || 'ورود ناموفق بود.');
      if (import.meta.env.DEV) console.error('Session login error:', err);
    } finally {
      setIsLoadingSites(false);
      setIsSigningIn(false);
    }
    return '';
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    setIsSigningIn(true);
    setIsLoadingSites(true);
    try {
      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      if (!apiKey) throw new Error('کلید عمومی Firebase در تنظیمات ساخت سایت تعریف نشده است.');
      if (!health?.firebaseAuth.isInitialized) throw new Error('احراز هویت سمت سرور آماده نیست؛ تنظیمات Firebase Admin را بررسی کنید.');
      if (authPassword.length < 6) throw new Error('گذرواژه باید حداقل ۶ نویسه داشته باشد.');

      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail.trim(), password: authPassword, returnSecureToken: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.idToken) {
        const code = data?.error?.message;
        const messages: Record<string, string> = {
          EMAIL_EXISTS: 'این ایمیل قبلاً ثبت شده است؛ وارد حساب شوید.',
          INVALID_EMAIL: 'ساختار ایمیل معتبر نیست.',
          WEAK_PASSWORD: 'گذرواژه ضعیف است؛ حداقل ۶ نویسه وارد کنید.',
          OPERATION_NOT_ALLOWED: 'ثبت‌نام با ایمیل و گذرواژه در تنظیمات Firebase فعال نیست.',
          TOO_MANY_ATTEMPTS_TRY_LATER: 'تلاش‌های زیادی انجام شده؛ کمی بعد دوباره امتحان کنید.',
        };
        if (code === 'EMAIL_EXISTS') {
          setAuthMode('login');
          throw new Error('این ایمیل قبلاً ثبت شده است. به صفحهٔ ورود منتقل شدید؛ با همان ایمیل و گذرواژه وارد شوید.');
        }
        throw new Error(messages[code] || 'ایجاد حساب در Firebase ناموفق بود.');
      }
      sessionStorage.setItem('shieldcaptcha_id_token', data.idToken);
      sessionStorage.setItem('shieldcaptcha_user_email', data.email || userEmail.trim());
      setAuthToken(data.idToken);
      setUserEmail(data.email || userEmail.trim());
      setAuthPassword('');
      await fetchSites(data.idToken);
    } catch (err: any) {
      setAuthError(err?.message || 'ایجاد حساب ناموفق بود.');
    } finally {
      setIsLoadingSites(false);
      setIsSigningIn(false);
    }
  };

  const fetchSites = async (token = authToken) => {
    if (!token) return;
    setIsLoadingSites(true);
    try {
      const res = await fetch('/api/v1/sites', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.status === 401) {
        sessionStorage.removeItem('shieldcaptcha_id_token');
        sessionStorage.removeItem('shieldcaptcha_user_email');
        setAuthToken('');
        setSites([]);
        setSelectedSiteKey('');
        setAuthError('نشست ورود معتبر نیست؛ دوباره وارد شوید.');
        return;
      }
      if (data.sites) {
        setSites(data.sites);
        if (data.sites.length > 0 && !selectedSiteKey) {
          setSelectedSiteKey(data.sites[0].siteKey);
        }
      }
    } catch (err) {
      console.error('Failed to fetch sites:', err);
    } finally {
      setIsLoadingSites(false);
    }
  };

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSiteName.trim()) return;

    setIsCreatingSite(true);
    try {
      let currentToken = authToken;
      if (!currentToken) {
        currentToken = await loginUser(userEmail);
      }

      if (!currentToken) {
        alert('جلسه کاربری یافت نشد. لطفاً صفحه را بارگذاری مجدد نمایید.');
        setIsCreatingSite(false);
        return;
      }

      const domainsArr = newSiteDomains
        .split(',')
        .map(d => d.trim())
        .filter(Boolean);

      const res = await fetch('/api/v1/sites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          name: newSiteName,
          domains: domainsArr.length > 0 ? domainsArr : ['localhost'],
          challengeDifficulty: newSiteDifficulty,
          invisibleEnabled: newSiteInvisible,
        }),
      });

      const data = await res.json();
      if (res.ok && data.site) {
        setIsAddModalOpen(false);
        setNewSiteName('');
        // Open One-Time Secret Key reveal modal
        setOneTimeSecretModal({
          siteName: data.site.name,
          siteKey: data.site.siteKey,
          secretKey: data.oneTimeSecretKey,
        });
        setSelectedSiteKey(data.site.siteKey);
        // Refresh sites from server to ensure persistence!
        await fetchSites(currentToken);
      } else {
        alert(data.message || data.error || 'خطا در ثبت سایت');
      }
    } catch (err: any) {
      alert(err.message || 'خطای ارتباط با سرور در ثبت سایت');
    } finally {
      setIsCreatingSite(false);
    }
  };

  const handleDeleteSite = async (siteId: string) => {
    if (!window.confirm('آیا از حذف این سایت اطمینان دارید؟ تمام کلیدها و رویدادهای مربوطه حذف خواهند شد.')) return;

    try {
      const res = await fetch(`/api/v1/sites/${siteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        await fetchSites();
      }
    } catch (err) {
      console.error('Failed to delete site:', err);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Run security test scenarios right from the playground UI.
  const runSecurityTest = async (scenario: 'wrong_answer' | 'replay_attack' | 'backend_verify') => {
    if (!selectedSiteKey) return;
    setIsTestingScenario(true);
    setTestResultLog(null);

    try {
      if (scenario === 'replay_attack') {
        if (!lastVerifiedToken || lastVerifiedSiteKey !== selectedSiteKey) {
          setTestResultLog({
            title: 'برای آزمون بازپخش ابتدا همین سایت را با ویجت تأیید کنید',
            status: 'failed',
            code: 'verified-token-required',
            payload: { message: 'ابتدا کپچای ویجت زنده را با موفقیت حل کنید؛ سپس همین توکن تأییدشده را برای آزمون بازپخش دوباره ارسال می‌کنیم.' },
            timestamp: new Date().toLocaleTimeString('fa-IR'),
          });
          return;
        }

        // A previously solved token must be rejected when reused.
        const replayRes = await fetch('/api/v1/captcha/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: lastVerifiedToken, selectedOptionId: 'opt_replay_probe' }),
        });
        const replayData = await replayRes.json();
        const blocked = replayData.error_codes?.includes('timeout-or-duplicate');
        setTestResultLog({
          title: 'تست محافظت در برابر بازپخش توکن (Replay Attack Prevention)',
          status: blocked ? 'success' : 'failed',
          code: replayData.error_codes?.[0],
          payload: {
            replayAttempt: replayData,
            securityResult: blocked ? 'موفق: توکن حل‌شده و مصرف‌شده دوباره پذیرفته نشد.' : 'ناموفق: پاسخ سرور مطابق انتظار نبود.',
          },
          timestamp: new Date().toLocaleTimeString('fa-IR'),
        });
        return;
      }

      // Issue a fresh challenge for the negative-answer and invalid-secret tests.
      const chRes = await fetch('/api/v1/captcha/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteKey: selectedSiteKey, domain: 'localhost' }),
      });
      const challenge = await chRes.json();
      if (!chRes.ok || !challenge.token) throw new Error(challenge.message || challenge.code || 'Challenge issuance failed');

      if (scenario === 'wrong_answer') {
        let fourthAttempt: any;
        for (let i = 0; i < 4; i++) {
          const verifyRes = await fetch('/api/v1/captcha/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: challenge.token, selectedOptionId: 'opt_deliberately_wrong_id_9999' }),
          });
          const attemptData = await verifyRes.json();
          if (i === 3) fourthAttempt = attemptData;
        }
        const fifthRes = await fetch('/api/v1/captcha/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: challenge.token, selectedOptionId: 'opt_deliberately_wrong_id_9999' }),
        });
        const fifthAttempt = await fifthRes.json();
        const fourthAllowed = fourthAttempt?.error_codes?.includes('incorrect-captcha-sol');
        const fifthBlocked = fifthAttempt.error_codes?.some((code: string) => ['timeout-or-duplicate', 'max-attempts-exceeded'].includes(code));
        setTestResultLog({
          title: 'تست چهار تلاش مجاز و مسدودشدن تلاش پنجم',
          status: fourthAllowed && fifthBlocked ? 'success' : 'failed',
          code: fifthAttempt.error_codes?.[0],
          payload: { fourthIncorrectAttempt: fourthAttempt, fifthBlockedAttempt: fifthAttempt },
          timestamp: new Date().toLocaleTimeString('fa-IR'),
        });
      } else {
        // Never send a real private key from this browser-based lab.
        const verifyRes = await fetch('/api/v1/captcha/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: challenge.token,
            secretKey: 'sc_sec_intentionally_invalid_test_key',
            action: 'security_lab_invalid_secret',
          }),
        });
        const vData = await verifyRes.json();
        const rejected = vData.success === false && vData.error_codes?.includes('invalid-secret-key');
        setTestResultLog({
          title: 'تست رد کلید محرمانه نامعتبر',
          status: rejected ? 'success' : 'failed',
          code: vData.error_codes?.[0],
          payload: {
            ...vData,
            securityResult: rejected ? 'موفق: سرور کلید محرمانهٔ نامعتبر را رد کرد.' : 'ناموفق: پاسخ سرور مطابق انتظار نبود.',
          },
          timestamp: new Date().toLocaleTimeString('fa-IR'),
        });
      }
    } catch (err: any) {
      setTestResultLog({
        title: 'خطای اجرای آزمون',
        status: 'failed',
        payload: { error: err.message },
        timestamp: new Date().toLocaleTimeString('fa-IR'),
      });
    } finally {
      setIsTestingScenario(false);
    }
  };

  const fetchUsageLogs = async () => {
    try {
      const res = await fetch('/api/v1/analytics/usage', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (res.ok && data.summary) {
        setAnalyticsSummary({
          totalRequests: Number(data.summary.totalRequests) || 0,
          passedRequests: Number(data.summary.passedRequests) || 0,
          blockedRequests: Number(data.summary.blockedRequests) || 0,
          passRatePercent: Number(data.summary.passRatePercent) || 0,
        });
      }
      if (res.ok && data.recentEvents) {
        setLogs(data.recentEvents);
      }
      if (res.ok && Array.isArray(data.hourlyTraffic)) {
        setHourlyTraffic(data.hourlyTraffic);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchUsageLogs();
    }
  }, [activeTab]);

  // The chart uses complete server-side hourly aggregates, not the latest 50 log rows.
  const traffic24hData = useMemo(() => {
    const now = new Date();
    const buckets = new Map<string, { hour: string; passed: number; blocked: number; total: number }>();
    for (let i = 23; i >= 0; i--) {
      const bucketEnd = new Date(now.getTime() - i * 3600 * 1000);
      bucketEnd.setUTCMinutes(0, 0, 0);
      const key = new Date(bucketEnd).toISOString();
      const hour = `${bucketEnd.getHours().toString().padStart(2, '0')}:00`;
      buckets.set(key, { hour, passed: 0, blocked: 0, total: 0 });
    }

    for (const item of hourlyTraffic) {
      const eventHour = new Date(item.hour);
      eventHour.setUTCMinutes(0, 0, 0);
      const key = eventHour.toISOString();
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.passed = Number(item.passed) || 0;
        bucket.blocked = Number(item.blocked) || 0;
        bucket.total = bucket.passed + bucket.blocked;
      }
    }

    return [...buckets.values()];
  }, [hourlyTraffic]);

  // Summary cards use server-side aggregates for the full 24-hour window.
  const trafficStats = useMemo(() => ({
    total: analyticsSummary.totalRequests,
    passed: analyticsSummary.passedRequests,
    blocked: analyticsSummary.blockedRequests,
    rate: analyticsSummary.passRatePercent,
  }), [analyticsSummary]);

  if (!import.meta.env.DEV && !authToken) {
    return (
      <div dir={meta.dir} className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 py-10 font-sans">
        <div className="w-full max-w-md">
          <div className="flex justify-end mb-4"><LanguageSelector /></div>
          <div className="text-center mb-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 shadow-lg shadow-emerald-950/50">
              <Shield className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">ShieldCaptcha</h1>
            <p className="mt-2 text-sm text-slate-400">{t('authSecureSignIn')}</p>
          </div>
          <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
            <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-slate-950 p-1">
              <button type="button" onClick={() => { setAuthMode('login'); setAuthError(''); }} className={'rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ' + (authMode === 'login' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white')}>{t('authLogin')}</button>
              <button type="button" onClick={() => { setAuthMode('signup'); setAuthError(''); }} className={'rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ' + (authMode === 'signup' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white')}>{t('authSignup')}</button>
            </div>
            <h2 className="text-lg font-semibold text-white">{authMode === 'login' ? t('authWelcomeBack') : t('authCreateAccount')}</h2>
            <p className="mt-1 mb-5 text-xs leading-6 text-slate-400">{authMode === 'login' ? t('authLoginDescription') : t('authSignupDescription')}</p>
            <form className="space-y-4" onSubmit={authMode === 'login' ? async (event) => { event.preventDefault(); await loginUser(userEmail.trim(), authPassword); } : handleSignUp}>
              <div>
                <label htmlFor="auth-email" className="mb-1.5 block text-sm text-slate-300">{t('authEmail')}</label>
                <input id="auth-email" type="email" required autoComplete="email" value={userEmail} onChange={(event) => setUserEmail(event.target.value)} placeholder="name@example.com" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-left text-sm text-white outline-none focus:border-emerald-500" />
              </div>
              {authMode === 'signup' && <div>
                <label htmlFor="auth-country" className="mb-1.5 block text-sm text-slate-300">{t('authCountry')}</label>
                <select id="auth-country" value={country} onChange={(event) => { setCountry(event.target.value); localStorage.setItem('shieldcaptcha_country', event.target.value); }} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500">
                  <option value="IN">India</option><option value="CN">China</option><option value="US">United States</option><option value="ID">Indonesia</option><option value="PK">Pakistan</option><option value="NG">Nigeria</option><option value="BR">Brazil</option><option value="BD">Bangladesh</option><option value="RU">Russia</option><option value="ET">Ethiopia</option>
                </select>
              </div>}
              <div>
                <label htmlFor="auth-password" className="mb-1.5 block text-sm text-slate-300">{t('authPassword')}</label>
                <input id="auth-password" type="password" required minLength={6} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder={t('authPasswordHint')} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-left text-sm text-white outline-none focus:border-emerald-500" />
              </div>
              {authError && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm leading-6 text-rose-300">{authError}</p>}
              {!import.meta.env.VITE_FIREBASE_API_KEY && <p className="text-xs leading-5 text-amber-300">VITE_FIREBASE_API_KEY در تنظیمات build تعریف نشده است.</p>}
              {health && !health.firebaseAuth.isInitialized && <p className="text-xs leading-5 text-amber-300">Firebase Admin سمت سرور آماده نیست؛ تنظیمات Firebase را بررسی کنید.</p>}
              <button type="submit" disabled={isSigningIn || !import.meta.env.VITE_FIREBASE_API_KEY || !health?.firebaseAuth.isInitialized} className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                {isSigningIn ? t('authPleaseWait') : authMode === 'login' ? t('authSignInButton') : t('authCreateAccount')}
              </button>
            </form>
            <p className="mt-5 text-center text-xs leading-5 text-slate-500">{t('authPasswordPrivacy')}</p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-white shadow-lg shadow-emerald-950/50">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white text-base">{t('appName')}</span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  MVP v1.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400">{t('appTagline')}</p>
            </div>
          </div>

          {/* Engine & Database Status indicator */}
          <div className="hidden md:flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">ذخیره‌سازی:</span>
              <span className="font-mono text-emerald-400 font-medium">
                {health?.database.isPostgresConnected ? 'PostgreSQL (Cloud SQL)' : (import.meta.env.PROD ? 'Database unavailable' : 'Drizzle File Storage')}
              </span>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60">
              <Lock className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-slate-400">احراز هویت:</span>
              <span className="font-mono text-teal-400 font-medium">
                {health?.firebaseAuth.isInitialized ? 'Firebase Admin Live' : (import.meta.env.PROD ? 'Firebase not configured' : 'Development JWT')}
              </span>
            </div>

            {/* Test-only tenant switcher; never expose simulated identities in production. */}
            {import.meta.env.DEV && <select
              value={userEmail}
              onChange={(e) => {
                setUserEmail(e.target.value);
                loginUser(e.target.value);
              }}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 focus:ring-1 focus:ring-emerald-500 cursor-pointer"
            >
              <option value="developer@shieldcaptcha.dev">حساب: Developer (Admin)</option>
              <option value="alice@shieldcaptcha.dev">حساب: Alice (کاربر تست ۱)</option>
              <option value="bob@shieldcaptcha.dev">حساب: Bob (کاربر تست ۲)</option>
            </select>}
          </div>
          <LanguageSelector />
          {authToken && (
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem('shieldcaptcha_id_token');
                sessionStorage.removeItem('shieldcaptcha_user_email');
                setAuthToken('');
                setSites([]);
                setSelectedSiteKey('');
                setUserEmail('');
                setAuthPassword('');
                setAuthError('');
              }}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
            >
              خروج امن
            </button>
          )}
        </div>

        {/* Tab Bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 border-t border-slate-800/60 overflow-x-auto">
          {[
            { id: 'sites', label: t('tabSites'), icon: Globe },
            { id: 'playground', label: t('tabPlayground'), icon: Terminal },
            { id: 'logs', label: t('tabLogs'), icon: Layers },
            { id: 'docs', label: t('tabDocs'), icon: Code2 },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-4 text-xs font-medium flex items-center gap-2 border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.id === 'sites' && sites.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300">
                    {sites.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full">
        {!import.meta.env.DEV && !authToken && (
          <div role="region" aria-label="ورود امن مدیریتی" className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <h2 className="font-semibold mb-2">ورود امن مدیریتی</h2>
            <p className="text-xs text-amber-200/90 mb-4">
              با حساب ایمیل/گذرواژهٔ Firebase وارد شوید. گذرواژه فقط به سرویس Firebase ارسال می‌شود و در ShieldCaptcha ذخیره نمی‌شود.
            </p>
            <form
              className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                await loginUser(userEmail, authPassword);
              }}
            >
              <input
                type="email"
                required
                autoComplete="username"
                value={userEmail}
                onChange={(event) => setUserEmail(event.target.value)}
                placeholder="ایمیل حساب"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="گذرواژه"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                disabled={isSigningIn || !import.meta.env.VITE_FIREBASE_API_KEY || !health?.firebaseAuth.isInitialized}
                className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSigningIn ? 'در حال ورود…' : 'ورود'}
              </button>
            </form>
            {!import.meta.env.VITE_FIREBASE_API_KEY && <p className="mt-3 text-xs text-amber-200">VITE_FIREBASE_API_KEY در تنظیمات build تعریف نشده است.</p>}
            {health && !health.firebaseAuth.isInitialized && <p className="mt-3 text-xs text-amber-200">Firebase Admin سمت سرور آماده نیست؛ تنظیمات FIREBASE_PROJECT_ID و FIREBASE_SERVICE_ACCOUNT_KEY را بررسی کنید.</p>}
            {authError && <p role="alert" className="mt-3 text-xs text-rose-300">{authError}</p>}
          </div>
        )}
        {/* TAB 1: SITES MANAGEMENT */}
        {activeTab === 'sites' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>وب‌سایت‌های ثبت‌شده</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                    {userEmail}
                  </span>
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  کلیدهای عمومی و محرمانه سایت‌های خود را مدیریت کرده و دامنه‌های مجاز را پیکربندی نمایید.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchSites()}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
                  title="بارگذاری مجدد"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingSites ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-emerald-950/40 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>ثبت سایت جدید (Add Site)</span>
                </button>
              </div>
            </div>

            {/* Sites Grid */}
            {isLoadingSites ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
                <span className="text-xs text-slate-400">در حال دریافت فهرست سایت‌ها از پایگاه داده...</span>
              </div>
            ) : sites.length === 0 ? (
              <div className="py-16 px-4 rounded-2xl border border-dashed border-slate-800 text-center flex flex-col items-center justify-center gap-3 bg-slate-900/30">
                <Globe className="w-10 h-10 text-slate-600" />
                <h3 className="text-sm font-semibold text-slate-300">هیچ سایتی برای این حساب ثبت نشده است</h3>
                <p className="text-xs text-slate-500 max-w-sm">
                  برای شروع دریافت کلید عمومی Site Key و کلید خصوصی Secret Key، دکمه «ثبت سایت جدید» را بزنید.
                </p>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="mt-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium cursor-pointer"
                >
                  ثبت اولین وب‌سایت
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sites.map(site => (
                  <div
                    key={site.id}
                    className="p-5 rounded-xl border border-slate-800 bg-slate-900/70 hover:border-slate-700 transition-all flex flex-col justify-between gap-4 shadow-sm"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                            <Globe className="w-4 h-4" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-white">{site.name}</h3>
                            <span className="text-[10px] text-slate-500">
                              ثبت شده: {new Date(site.createdAt).toLocaleDateString('fa-IR')}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDeleteSite(site.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                          title="حذف سایت"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Site Key (Public) */}
                      <div className="space-y-2 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-400 font-medium block mb-1">
                            کلید عمومی (Public Site Key):
                          </span>
                          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80 font-mono text-[11px] text-emerald-400">
                            <span className="truncate">{site.siteKey}</span>
                            <button
                              onClick={() => copyToClipboard(site.siteKey, `site-${site.id}`)}
                              className="text-slate-400 hover:text-white p-1 cursor-pointer"
                              title="کپی کلید عمومی"
                            >
                              {copiedKey === `site-${site.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        {/* Secret Key (Masked - Private) */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-slate-400 font-medium">
                              کلید محرمانه (Secret Key):
                            </span>
                            <span className="text-[9px] text-amber-400/80">فقط در سرور نگهداری شود</span>
                          </div>
                          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/70 border border-slate-800/60 font-mono text-[11px] text-slate-400">
                            <span className="truncate">{site.maskedSecretKey}</span>
                            <Lock className="w-3.5 h-3.5 text-slate-500" />
                          </div>
                        </div>

                        {/* Whitelisted Domains */}
                        <div>
                          <span className="text-[10px] text-slate-400 font-medium block mb-1">
                            دامنه‌های مجاز (Domain Binding):
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {site.domains.map((dom, i) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                                {dom}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">
                        سطح چالش: <span className="text-slate-300 font-medium">{site.challengeDifficulty}</span>
                      </span>
                      <button
                        onClick={() => {
                          setSelectedSiteKey(site.siteKey);
                          setActiveTab('playground');
                        }}
                        className="text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <span>تست در آزمایشگاه</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: INTERACTIVE PLAYGROUND & ABUSE TESTING */}
        {activeTab === 'playground' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Live Widget Embed */}
            <div className="lg:col-span-5 space-y-4">
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <span>ویجت زنده در وب‌سایت فرضی</span>
                  </h2>

                  {/* Site Selector */}
                  <select
                    value={selectedSiteKey}
                    onChange={(e) => setSelectedSiteKey(e.target.value)}
                    className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 cursor-pointer"
                  >
                    {sites.map(s => (
                      <option key={s.id} value={s.siteKey}>{s.name} ({s.siteKey.slice(0, 10)}...)</option>
                    ))}
                  </select>
                </div>

                <p className="text-xs text-slate-400 mb-4">
                  این ویجت مستقیماً به API سرور (`POST /api/v1/captcha/challenge` و `verify`) متصل است.
                </p>

                {/* Embedded Widget */}
                {selectedSiteKey ? (
                  <CaptchaWidget
                    key={selectedSiteKey}
                    siteKey={selectedSiteKey}
                    onVerify={(token, data) => {
                      setLastVerifiedToken(token);
                      setLastVerifiedSiteKey(selectedSiteKey);
                      setLastVerificationData(data);
                    }}
                    onError={(code) => console.log('Widget error:', code)}
                  />
                ) : (
                  <div className="text-xs text-slate-500 text-center py-8">
                    لطفاً ابتدا یک سایت در تب مدیریت سایت‌ها ایجاد کنید.
                  </div>
                )}

                {/* Verification result badge */}
                {lastVerificationData && (
                  <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                      <ShieldCheck className="w-4 h-4" />
                      <span>پاسخ تأیید شده توسط سرور:</span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-300">
                      امتیاز امنیت (Score): {lastVerificationData.score} / 100
                    </div>
                    <div className="font-mono text-[10px] text-slate-400 truncate">
                      توکن تأیید: {lastVerifiedToken}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Security Attack & Abuse Test Suite */}
            <div className="lg:col-span-7 space-y-4">
              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    <span>آزمایشگاه سناریوهای امنیتی (Security Attack Scenarios)</span>
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                    آزمایش زنده API
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  با کلیک روی هر دکمه، یک سناریوی نفوذ یا رفتار غیرمجاز واقعی به سمت سرور فرستاده شده و رفتار اتمیک سرور ارزیابی می‌شود:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
                  <button
                    disabled={isTestingScenario || !selectedSiteKey}
                    onClick={() => runSecurityTest('wrong_answer')}
                    className="p-3 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-right transition-all cursor-pointer disabled:opacity-50"
                  >
                    <div className="text-xs font-semibold text-rose-400 mb-1">۱. چهار تلاش مجاز</div>
                    <div className="text-[10px] text-slate-400">چهار پاسخ اشتباه پذیرفته می‌شود؛ تلاش پنجم باید رد شود</div>
                  </button>

                  <button
                    disabled={isTestingScenario || !selectedSiteKey}
                    onClick={() => runSecurityTest('replay_attack')}
                    className="p-3 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-right transition-all cursor-pointer disabled:opacity-50"
                  >
                    <div className="text-xs font-semibold text-amber-400 mb-1">۲. حمله بازپخش (Replay)</div>
                    <div className="text-[10px] text-slate-400">ارسال توکن یک‌بارمصرف برای بار دوم و رد آن در سرور</div>
                  </button>

                  <button
                    disabled={isTestingScenario || !selectedSiteKey}
                    onClick={() => runSecurityTest('backend_verify')}
                    className="p-3 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-right transition-all cursor-pointer disabled:opacity-50"
                  >
                    <div className="text-xs font-semibold text-emerald-400 mb-1">۳. رد کلید محرمانه نامعتبر</div>
                    <div className="text-[10px] text-slate-400">بررسی ردشدن Secret Key آزمایشی نامعتبر؛ کلید واقعی در مرورگر ارسال نمی‌شود</div>
                  </button>
                </div>

                {/* Scenario Execution Log */}
                {testResultLog && (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">{testResultLog.title}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                        testResultLog.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                      }`}>
                        {testResultLog.status === 'success' ? 'رفتار امنیتی مطابق انتظار' : 'شکست آزمون'}
                      </span>
                    </div>

                    <pre className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto">
                      {JSON.stringify(testResultLog.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: AUDIT LOGS */}
        {activeTab === 'logs' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-emerald-400" />
                  <span>لاگ‌های امنیتی و تحلیل ترافیک ۲۴ ساعت گذشته</span>
                </h2>
                <p className="text-xs text-slate-400">
                  نظارت بلادرنگ بر روند درخواست‌های تأیید هویت، تفکیک ترافیک واقعی و دفع حملات ربات
                </p>
              </div>
              <button
                onClick={fetchUsageLogs}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>بروزرسانی آمار</span>
              </button>
            </div>

            {/* 24-Hour Summary Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block">کل درخواست‌ها (۲۴h)</span>
                  <span className="text-xl font-bold font-mono text-white mt-0.5 block">{trafficStats.total}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-800 text-slate-300">
                  <Activity className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block">تأییدشده (انسان)</span>
                  <span className="text-xl font-bold font-mono text-emerald-400 mt-0.5 block">{trafficStats.passed}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block">مسدودشده (ربات / نفوذ)</span>
                  <span className="text-xl font-bold font-mono text-rose-400 mt-0.5 block">{trafficStats.blocked}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400">
                  <XCircle className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block">نرخ قبولی (Pass Rate)</span>
                  <span className="text-xl font-bold font-mono text-teal-300 mt-0.5 block">{trafficStats.rate}%</span>
                </div>
                <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-400">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Recharts Line Chart: Verification Traffic Trends (Last 24 Hours) */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span>نمودار روند ترافیک اعتبارسنجی در ۲۴ ساعت گذشته</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    توزیع ساعتی درخواست‌های تأییدشده (سبز) در برابر تلاش‌های مسدودشده یا نامعتبر (قرمز)
                  </p>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 self-start sm:self-auto">
                  بازه: ۲۴ ساعت گذشته (Hourly)
                </span>
              </div>

              <div className="h-64 w-full pt-2" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={traffic24hData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickLine={{ stroke: '#334155' }}
                      interval={2}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickLine={{ stroke: '#334155' }}
                      allowDecimals={false}
                    />
                    <RechartsTooltip
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          const passedVal = payload.find(p => p.dataKey === 'passed')?.value ?? 0;
                          const blockedVal = payload.find(p => p.dataKey === 'blocked')?.value ?? 0;
                          return (
                            <div className="bg-slate-900/95 backdrop-blur border border-slate-700/80 p-3 rounded-xl shadow-2xl text-xs space-y-1.5 min-w-[150px] text-right font-sans">
                              <p className="font-mono text-slate-300 font-semibold border-b border-slate-800 pb-1">
                                ساعت {label}
                              </p>
                              <div className="flex items-center justify-between gap-3 text-emerald-400 font-mono">
                                <span>{passedVal}</span>
                                <span className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                                  تأیید شده:
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3 text-rose-400 font-mono">
                                <span>{blockedVal}</span>
                                <span className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                                  <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
                                  مسدود شده:
                                </span>
                              </div>
                              <div className="pt-1 border-t border-slate-800 text-[10px] text-slate-400 font-mono flex items-center justify-between">
                                <span className="text-white font-bold">{Number(passedVal) + Number(blockedVal)}</span>
                                <span>مجموع درخواست:</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="circle"
                      wrapperStyle={{ paddingBottom: '12px', fontSize: '11px' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="passed"
                      name="تأییدشده (Passed)"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dot={{ r: 2, fill: '#10b981' }}
                      activeDot={{ r: 5, fill: '#10b981', stroke: '#064e3b', strokeWidth: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="blocked"
                      name="مسدودشده (Blocked)"
                      stroke="#f43f5e"
                      strokeWidth={2.5}
                      dot={{ r: 2, fill: '#f43f5e' }}
                      activeDot={{ r: 5, fill: '#f43f5e', stroke: '#881337', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Event Logs Table */}
            <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/50 shadow-sm">
              <div className="p-3.5 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">فهرست رویدادهای اخیر (Recent Event Logs)</span>
                <span className="text-[10px] font-mono text-slate-400">آخرین ۵۰ رویداد</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] border-b border-slate-800">
                    <tr>
                      <th className="p-3">زمان</th>
                      <th className="p-3">Site Key</th>
                      <th className="p-3">نتیجه (Decision)</th>
                      <th className="p-3">امتیاز</th>
                      <th className="p-3">میزبان (Hostname)</th>
                      <th className="p-3">کدهای خطا / توضیحات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-500">
                          هنوز رویدادی ثبت نشده است. از تب آزمایشگاه چند چالش را حل کنید تا لاگ‌ها نمایش داده شوند.
                        </td>
                      </tr>
                    ) : (
                      logs.map((log, i) => (
                        <tr key={i} className="hover:bg-slate-800/40">
                          <td className="p-3 text-slate-400">
                            {new Date(log.createdAt).toLocaleTimeString('fa-IR')}
                          </td>
                          <td className="p-3 text-slate-300 truncate max-w-[120px]">{log.siteKey}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] ${
                              log.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                            }`}>
                              {log.success ? 'PASS (تأیید)' : 'BLOCKED (رد شده)'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-200">{log.score}</td>
                          <td className="p-3 text-slate-400">{log.hostname || 'localhost'}</td>
                          <td className="p-3 text-slate-400">
                            {log.errorCodes && log.errorCodes.length > 0 ? (
                              <span className="text-rose-400">{log.errorCodes.join(', ')}</span>
                            ) : (
                              <span className="text-emerald-500">none (موفق)</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: INTEGRATION GUIDE & DOCS */}
        {activeTab === 'docs' && (
          <div className="space-y-6 max-w-4xl">
            <div>
              <h2 className="text-xl font-bold text-white">راهنمای ادغام سریع (Quickstart Integration Guide)</h2>
              <p className="text-xs text-slate-400 mt-1">
                نحوه قرار دادن ویجت در فرانت‌اند و اعتبارسنجی توکن حاصل در بک‌اند با کمتر از ۱۰ خط کد.
              </p>
            </div>

            {/* Step 1: Frontend */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center">۱</span>
                <h3 className="text-sm font-semibold text-white">نمایش ویجت در فرم وب‌سایت (React / HTML)</h3>
              </div>
              <p className="text-xs text-slate-400">
                ویجت را در صفحه ورود، ثبت‌نام یا پرداخت خود قرار داده و پس از تکمیل، توکن صادرشده را همراه با فرم ارسال کنید:
              </p>

              <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-400 overflow-x-auto">
{`import { CaptchaWidget } from '@shieldcaptcha/widget';

export function LoginForm() {
  const [token, setToken] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    // توکن را به سرور خود بفرستید
    await fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, captchaToken: token })
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" placeholder="ایمیل" />
      <CaptchaWidget 
        siteKey="${selectedSiteKey || 'sc_site_YOUR_KEY'}" 
        onVerify={(verifiedToken) => setToken(verifiedToken)} 
      />
      <button type="submit" disabled={!token}>ورود به حساب</button>
    </form>
  );
}`}
              </pre>
            </div>

            {/* Step 2: Backend Verification */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-teal-500/20 text-teal-400 text-xs font-bold flex items-center justify-center">۲</span>
                <h3 className="text-sm font-semibold text-white">اعتبارسنجی سرور به سرور (Node.js / Express)</h3>
              </div>
              <p className="text-xs text-slate-400">
                در کنترلر بک‌اند خود، توکن ارسالی را به اندپوینت `/api/v1/captcha/verify` ارسال کنید:
              </p>

              <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-teal-300 overflow-x-auto">
{`// در بک‌اند (هرگز Secret Key را در فرانت‌اند قرار ندهید):
app.post('/api/login', async (req, res) => {
  const { email, password, captchaToken } = req.body;

  const verifyResponse = await fetch('https://shieldcaptcha-web.onrender.com/api/v1/captcha/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secretKey: process.env.SHIELDCAPTCHA_SECRET_KEY, // sc_sec_live_...
      token: captchaToken,
      remoteIp: req.ip,
    })
  });

  const verification = await verifyResponse.json();

  if (!verification.success) {
    return res.status(403).json({ error: 'CAPTCHA verification failed', codes: verification.error_codes });
  }

  // اعتبارسنجی موفق بود؛ ادامه فرایند ورود...
});`}
              </pre>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: ADD SITE */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400" />
                <span>ثبت وب‌سایت جدید</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-500 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSite} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">نام سایت یا پروژه:</label>
                <input
                  type="text"
                  required
                  value={newSiteName}
                  onChange={e => setNewSiteName(e.target.value)}
                  placeholder="مثال: فروشگاه دیجی‌شاپ"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  دامنه‌های مجاز (با کاما جدا کنید):
                </label>
                <input
                  type="text"
                  value={newSiteDomains}
                  onChange={e => setNewSiteDomains(e.target.value)}
                  placeholder="localhost, example.com, app.example.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-mono text-emerald-400 focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  چالش‌ها فقط از این دامنه‌ها قابل صدور خواهند بود.
                </span>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">سطح دشواری چالش:</label>
                <select
                  value={newSiteDifficulty}
                  onChange={e => setNewSiteDifficulty(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white cursor-pointer"
                >
                  <option value="LOW">آسان (Low - برای کاربران عمومی)</option>
                  <option value="MEDIUM">متوسط (Medium - استاندارد تجاری)</option>
                  <option value="HIGH">دقیق (High - فرم‌های حساس یا پرداخت)</option>
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="invisibleCheck"
                  checked={newSiteInvisible}
                  onChange={e => setNewSiteInvisible(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="invisibleCheck" className="text-slate-300 cursor-pointer">
                  فعال‌سازی ارزیابی اولیه نامرئی (Invisible Check)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isCreatingSite}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isCreatingSite ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>ایجاد و دریافت کلیدها</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ONE-TIME SECRET KEY DISPLAY */}
      {oneTimeSecretModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-emerald-400 pb-2 border-b border-slate-800">
              <ShieldCheck className="w-5 h-5" />
              <h3 className="text-sm font-bold text-white">
                کلیدهای سایت «{oneTimeSecretModal.siteName}» با موفقیت تولید شدند
              </h3>
            </div>

            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>هشدار امنیتی بسیار مهم:</strong>
                <p className="text-[11px] text-amber-200/90 mt-0.5">
                  کلید خصوصی فقط این یک‌بار به شما نمایش داده می‌شود. به دلایل امنیتی، سرور فقط هش یک‌طرفه آن را ذخیره می‌کند و امکان مشاهده مجدد آن وجود نخواهد داشت.
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[11px] text-slate-400 block mb-1">کلید عمومی سایت (Site Key):</span>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-emerald-400">
                  <span className="truncate">{oneTimeSecretModal.siteKey}</span>
                  <button
                    onClick={() => copyToClipboard(oneTimeSecretModal.siteKey, 'modal-sitekey')}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {copiedKey === 'modal-sitekey' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 block mb-1 font-semibold text-rose-400">
                  کلید محرمانه اختصاصی (Secret Key):
                </span>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-rose-500/40 font-mono text-[11px] text-rose-300">
                  <span className="truncate">{oneTimeSecretModal.secretKey}</span>
                  <button
                    onClick={() => copyToClipboard(oneTimeSecretModal.secretKey, 'modal-secretkey')}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {copiedKey === 'modal-secretkey' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setOneTimeSecretModal(null)}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs cursor-pointer"
              >
                کلید را ذخیره کردم و متوجه شدم
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
