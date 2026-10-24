import { calculatePassRatePercent } from './utils/analytics.ts';
import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield, Key, Globe, Plus, Trash2, Copy, Check, RefreshCw, Wallet,
  Terminal, ShieldCheck, ShieldAlert, Code2, ExternalLink,
  Layers, Lock, Database, AlertCircle, Eye, EyeOff,
  Activity, TrendingUp, CheckCircle2, XCircle, LifeBuoy, Send, MessageSquare
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RechartsTooltip, Legend
} from 'recharts';
import { CaptchaWidget } from './components/CaptchaWidget.tsx';
import { LanguageSelector, useI18n } from './i18n/LanguageContext.tsx';
import { AutoTranslate } from './i18n/AutoTranslate.tsx';

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
  const [activeTab, setActiveTab] = useState<'sites' | 'playground' | 'logs' | 'docs' | 'billing' | 'support'>('sites');
  const [health, setHealth] = useState<HealthStatus | null>(null);

  // User session state (Defaults to developer session)
  const [userEmail, setUserEmail] = useState<string>(import.meta.env.DEV ? 'developer@shieldcaptcha.dev' : '');
  const [authToken, setAuthToken] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [loginCaptchaVerified, setLoginCaptchaVerified] = useState(false);
  const loginCaptchaSiteKey = 'sc_site_198d2ad04c0f73b7c2ec03a4';
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
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
  const [billingConfig, setBillingConfig] = useState<any>(null);
  const [billingInvoices, setBillingInvoices] = useState<any[]>([]);
  const [billingPlan, setBillingPlan] = useState<'starter' | 'pro' | 'business'>('starter');
  const [billingInvoice, setBillingInvoice] = useState<any>(null);
  const [billingTxid, setBillingTxid] = useState('');
  const [billingMessage, setBillingMessage] = useState('');
  const [billingBusy, setBillingBusy] = useState(false);
  const [supportTickets, setSupportTickets] = useState<any[]>([]);
  const [supportIsAdmin, setSupportIsAdmin] = useState(false);
  const [supportSubject, setSupportSubject] = useState('');
  const [supportCategory, setSupportCategory] = useState<'general' | 'technical' | 'billing' | 'security'>('technical');
  const [supportPriority, setSupportPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [supportBody, setSupportBody] = useState('');
  const [supportReply, setSupportReply] = useState('');
  const [activeTicketId, setActiveTicketId] = useState('');
  const [supportStatus, setSupportStatus] = useState('in_progress');
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');


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
        if (!res.ok || !data.token) throw new Error(data.message || 'Test sign-in failed');
        setAuthToken(data.token);
        fetchSites(data.token);
        return data.token;
      }

      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      if (!apiKey) throw new Error('Firebase public API key is missing from the build configuration.');
      if (!health?.firebaseAuth.isInitialized) throw new Error('Server authentication is not ready; check Firebase Admin configuration.');
      if (!password) throw new Error('Enter your password.');

      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.idToken) {
        const code = data?.error?.message;
        const messages: Record<string, string> = {
          EMAIL_NOT_FOUND: 'This email is not registered with Firebase.',
          INVALID_PASSWORD: 'Incorrect password.',
          INVALID_LOGIN_CREDENTIALS: 'Incorrect email or password.',
          USER_DISABLED: 'This account has been disabled.',
          TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Please try again later.',
        };
        throw new Error(messages[code] || 'Firebase sign-in failed.');
      }
      sessionStorage.setItem('shieldcaptcha_id_token', data.idToken);
      sessionStorage.setItem('shieldcaptcha_user_email', data.email || email);
      setAuthToken(data.idToken);
      setUserEmail(data.email || email);
      setAuthPassword('');
      fetchSites(data.idToken);
      return data.idToken;
    } catch (err: any) {
      setAuthError(err?.message || 'Sign-in failed.');
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
    if (!emailCodeSent) {
      setAuthError('First request the verification code sent to your email.');
      return;
    }
    setIsSigningIn(true);
    setIsLoadingSites(true);
    try {
      if (!import.meta.env.VITE_FIREBASE_API_KEY) throw new Error('Firebase public API key is missing from the build configuration.');
      if (!health?.firebaseAuth.isInitialized) throw new Error('Server-side Firebase authentication is not ready.');
      if (!/^\d{6}$/.test(emailCode.trim())) throw new Error('Enter the six-digit code sent to your email.');
      if (authPassword.length < 8) throw new Error('Password must be at least 8 characters.');
      const verifyRes = await fetch('/api/v1/auth/email-code/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail.trim(), code: emailCode.trim(), password: authPassword }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.customToken) throw new Error(verifyData.error || 'Email verification failed.');
      const exchangeRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(import.meta.env.VITE_FIREBASE_API_KEY)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verifyData.customToken, returnSecureToken: true }),
      });
      const authData = await exchangeRes.json();
      if (!exchangeRes.ok || !authData.idToken) throw new Error(authData?.error?.message || 'Could not finish sign-in after email verification.');
      sessionStorage.setItem('shieldcaptcha_id_token', authData.idToken);
      sessionStorage.setItem('shieldcaptcha_user_email', authData.email || userEmail.trim());
      setAuthToken(authData.idToken);
      setUserEmail(authData.email || userEmail.trim());
      setAuthPassword(''); setEmailCode(''); setEmailCodeSent(false);
      await fetchSites(authData.idToken);
    } catch (err: any) {
      setAuthError(err?.message || 'Account creation failed.');
    } finally {
      setIsLoadingSites(false);
      setIsSigningIn(false);
    }
  };

  const sendEmailVerificationCode = async () => {
    setAuthError('');
    const email = userEmail.trim();
    if (!email) { setAuthError('Enter your Gmail address first.'); return; }
    setIsSigningIn(true);
    try {
      const res = await fetch('/api/v1/auth/email-code/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send verification code.');
      setEmailCodeSent(true);
      setAuthError(data.message || 'Verification code sent. Check your inbox and spam folder.');
    } catch (err: any) {
      setAuthError(err?.message || 'Could not send verification code.');
    } finally { setIsSigningIn(false); }
  };

  const signInWithGoogle = async () => {
    setAuthError('');
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
    if (!clientId || !apiKey) {
      setAuthError('Google sign-in is not configured. Set the public Google client ID and Firebase API key in the main service environment.');
      return;
    }
    setGoogleBusy(true);
    try {
      await new Promise<void>((resolve, reject) => {
        const win = window as any;
        const begin = () => {
          try {
            const client = win.google.accounts.oauth2.initTokenClient({
              client_id: clientId,
              scope: 'openid email profile',
              callback: async (response: any) => {
                if (response.error || !response.access_token) { reject(new Error(response.error_description || response.error || 'Google sign-in was cancelled.')); return; }
                try {
                  const body = new URLSearchParams({ access_token: response.access_token, providerId: 'google.com', requestUri: window.location.origin, returnSecureToken: 'true', returnIdpCredential: 'true' });
                  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postBody: body.toString(), requestUri: window.location.origin, returnSecureToken: true, returnIdpCredential: true }) });
                  const data = await res.json();
                  if (!res.ok || !data.idToken) throw new Error(data?.error?.message || 'Google sign-in failed.');
                  sessionStorage.setItem('shieldcaptcha_id_token', data.idToken);
                  sessionStorage.setItem('shieldcaptcha_user_email', data.email || '');
                  setAuthToken(data.idToken); setUserEmail(data.email || ''); setAuthPassword('');
                  await fetchSites(data.idToken);
                  resolve();
                } catch (error) { reject(error); }
              },
            });
            client.requestAccessToken();
          } catch (error) { reject(error); }
        };
        if (win.google?.accounts?.oauth2) { begin(); return; }
        const existing = document.querySelector('script[data-google-identity]') as HTMLScriptElement | null;
        const script = existing || document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true; script.defer = true; script.dataset.googleIdentity = 'true';
        script.onload = begin;
        script.onerror = () => reject(new Error('Could not load Google sign-in.'));
        if (!existing) document.head.appendChild(script);
      });
    } catch (err: any) {
      setAuthError(err?.message || 'Google sign-in failed.');
    } finally { setGoogleBusy(false); }
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
        setAuthError('Your sign-in session is invalid. Please sign in again.');
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
        alert('User session not found. Please reload the page.');
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
        alert(data.message || data.error || 'Failed to register website');
      }
    } catch (err: any) {
      alert(err.message || 'Server connection error while registering website');
    } finally {
      setIsCreatingSite(false);
    }
  };

  const handleDeleteSite = async (siteId: string) => {
    if (!window.confirm('Are you sure you want to delete this website? All related keys and events will be deleted.')) return;

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
            title: 'Verify this site with the widget before testing replay protection',
            status: 'failed',
            code: 'verified-token-required',
            payload: { message: 'Complete the live CAPTCHA widget first; then the verified token will be submitted again to test replay protection.' },
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
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
          title: 'Replay attack prevention test',
          status: blocked ? 'success' : 'failed',
          code: replayData.error_codes?.[0],
          payload: {
            replayAttempt: replayData,
            securityResult: blocked ? 'Passed: a solved and consumed token was rejected on reuse.' : 'Failed: the server response did not match expectations.',
          },
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        });
        return;
      }

      // Issue a fresh challenge for the negative-answer and invalid-secret tests.
      const chRes = await fetch('/api/v1/captcha/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteKey: selectedSiteKey, domain: 'localhost', usageType: 'test' }),
      });
      const challenge = await chRes.json();
      if (!chRes.ok || !challenge.token) throw new Error(challenge.message || challenge.code || 'Challenge issuance failed');

      if (scenario === 'wrong_answer') {
        const firstRes = await fetch('/api/v1/captcha/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: challenge.token, selectedOptionId: 'opt_deliberately_wrong_id_9999' }),
        });
        const firstAttempt = await firstRes.json();
        const secondRes = await fetch('/api/v1/captcha/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: challenge.token, selectedOptionId: 'opt_deliberately_wrong_id_9999' }),
        });
        const secondAttempt = await secondRes.json();
        const thirdRes = await fetch('/api/v1/captcha/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: challenge.token, selectedOptionId: 'opt_deliberately_wrong_id_9999' }),
        });
        const thirdAttempt = await thirdRes.json();
        const twoWrongAnswersCounted = firstAttempt?.error_codes?.includes('incorrect-captcha-sol') &&
          secondAttempt?.error_codes?.includes('incorrect-captcha-sol');
        const thirdBlocked = thirdAttempt.error_codes?.some((code: string) => ['timeout-or-duplicate', 'max-attempts-exceeded'].includes(code));
        setTestResultLog({
          title: 'Test two incorrect answers allowed and block the third',
          status: twoWrongAnswersCounted && thirdBlocked ? 'success' : 'failed',
          code: thirdAttempt.error_codes?.[0],
          payload: { firstIncorrectAttempt: firstAttempt, secondIncorrectAttempt: secondAttempt, thirdBlockedAttempt: thirdAttempt },
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
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
          title: 'Invalid secret key rejection test',
          status: rejected ? 'success' : 'failed',
          code: vData.error_codes?.[0],
          payload: {
            ...vData,
            securityResult: rejected ? 'Passed: the server rejected the invalid secret key.' : 'Failed: the server response did not match expectations.',
          },
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        });
      }
    } catch (err: any) {
      setTestResultLog({
        title: 'Test execution error',
        status: 'failed',
        payload: { error: err.message },
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
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
        const totalRequests = Number(data.summary.totalRequests) || 0;
        const passedRequests = Number(data.summary.passedRequests) || 0;
        const blockedRequests = Number(data.summary.blockedRequests) || 0;
        setAnalyticsSummary({
          totalRequests,
          passedRequests,
          blockedRequests,
          // Derive the percentage from the displayed counts to prevent stale/inconsistent rates.
          passRatePercent: calculatePassRatePercent(totalRequests, passedRequests),
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

  useEffect(() => {
    if (activeTab !== 'billing' || !authToken) return;
    const headers = { Authorization: `Bearer ${authToken}` };
    fetch('/api/v1/billing/config', { headers }).then(r => r.json()).then(setBillingConfig).catch(() => setBillingConfig({ ready: false }));
    fetch('/api/v1/billing/invoices', { headers }).then(r => r.json()).then(d => setBillingInvoices(Array.isArray(d.invoices) ? d.invoices : [])).catch(() => setBillingInvoices([]));
  }, [activeTab, authToken]);

  const loadSupportTickets = async () => {
    if (!authToken) {
      setSupportTickets([]);
      setSupportMessage('Please sign in to open a support ticket or view replies.');
      return;
    }
    try {
      const res = await fetch('/api/v1/support/tickets', { headers: { Authorization: `Bearer ${authToken}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Could not load support tickets.');
      const tickets = Array.isArray(data.tickets) ? data.tickets : [];
      setSupportTickets(tickets);
      setSupportIsAdmin(Boolean(data.isAdmin));
      if (activeTicketId && !tickets.some((ticket: any) => ticket.id === activeTicketId)) setActiveTicketId('');
      setSupportMessage('');
    } catch (error: any) {
      setSupportMessage(error?.message || 'Support inbox is unavailable.');
    }
  };

  useEffect(() => {
    if (activeTab === 'support' && authToken) loadSupportTickets();
  }, [activeTab, authToken]);

  const createSupportTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    setSupportBusy(true); setSupportMessage('');
    try {
      const res = await fetch('/api/v1/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ subject: supportSubject, category: supportCategory, priority: supportPriority, body: supportBody }),
      });
      const data = await res.json();
      if (!res.ok || !data.ticket) throw new Error(data.error || 'Could not create support ticket.');
      setActiveTicketId(data.ticket.id);
      setSupportSubject(''); setSupportBody('');
      await loadSupportTickets();
      setSupportMessage('Support ticket created successfully. You can follow replies here.');
    } catch (error: any) {
      setSupportMessage(error?.message || 'Could not create support ticket.');
    } finally { setSupportBusy(false); }
  };

  const sendSupportReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeTicketId || !supportReply.trim()) return;
    setSupportBusy(true); setSupportMessage('');
    try {
      const res = await fetch(`/api/v1/support/tickets/${encodeURIComponent(activeTicketId)}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ body: supportReply, ...(supportIsAdmin ? { status: supportStatus } : {}) }),
      });
      const data = await res.json();
      if (!res.ok || !data.ticket) throw new Error(data.error || 'Could not send reply.');
      setSupportReply('');
      await loadSupportTickets();
      setSupportMessage('Reply sent successfully.');
    } catch (error: any) {
      setSupportMessage(error?.message || 'Could not send reply.');
    } finally { setSupportBusy(false); }
  };

  const createBillingInvoice = async () => {
    setBillingBusy(true); setBillingMessage('Creating invoice...');
    try {
      const res = await fetch('/api/v1/billing/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ plan: billingPlan }),
      });
      const data = await res.json();
      if (!res.ok || !data.invoice) throw new Error(data.error || 'Invoice creation failed.');
      setBillingInvoice(data.invoice); setBillingTxid(''); setBillingMessage(data.instructions || 'Invoice created.');
      const list = await fetch('/api/v1/billing/invoices', { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.json());
      setBillingInvoices(Array.isArray(list.invoices) ? list.invoices : []);
    } catch (e: any) { setBillingMessage(e?.message || 'Error creating invoice'); }
    finally { setBillingBusy(false); }
  };

  const verifyBillingPayment = async () => {
    if (!billingInvoice || !billingTxid.trim()) return;
    setBillingBusy(true); setBillingMessage('Checking the transaction on the TRON network...');
    try {
      const res = await fetch(`/api/v1/billing/invoices/${encodeURIComponent(billingInvoice.id)}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ txid: billingTxid.trim() }),
      });
      const data = await res.json();
      setBillingMessage(data.message || data.error || 'Payment status checked.');
      if (data.status === 'paid') {
        setBillingInvoice({ ...billingInvoice, status: 'paid', txid: billingTxid.trim() });
        const list = await fetch('/api/v1/billing/invoices', { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.json());
        setBillingInvoices(Array.isArray(list.invoices) ? list.invoices : []);
      }
    } catch (e: any) { setBillingMessage(e?.message || 'Error checking transaction'); }
    finally { setBillingBusy(false); }
  };


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
      <AutoTranslate lang={meta.code as any}>
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
              <button type="button" onClick={() => { setAuthMode('login'); setAuthError(''); setEmailCodeSent(false); setEmailCode(''); setLoginCaptchaVerified(false); }} className={'rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ' + (authMode === 'login' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white')}>{t('authLogin')}</button>
              <button type="button" onClick={() => { setAuthMode('signup'); setAuthError(''); setEmailCodeSent(false); setEmailCode(''); setLoginCaptchaVerified(false); }} className={'rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ' + (authMode === 'signup' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white')}>{t('authSignup')}</button>
            </div>
            <h2 className="text-lg font-semibold text-white">{authMode === 'login' ? t('authWelcomeBack') : t('authCreateAccount')}</h2>
            <p className="mt-1 mb-5 text-xs leading-6 text-slate-400">{authMode === 'login' ? t('authLoginDescription') : t('authSignupDescription')}</p>
            <form className="space-y-4" onSubmit={authMode === 'login' ? async (event) => { event.preventDefault(); setAuthError(''); if (!loginCaptchaVerified) { setAuthError(meta.code === 'fa' ? 'ابتدا کپچا را با موفقیت تأیید کنید.' : 'Please complete the CAPTCHA verification first.'); return; } await loginUser(userEmail.trim(), authPassword); } : handleSignUp}>
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
              {authMode === 'signup' && <div className="space-y-2">
                {!emailCodeSent ? <button type="button" onClick={() => void sendEmailVerificationCode()} disabled={isSigningIn || !userEmail.trim()} className="w-full rounded-lg border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300 disabled:opacity-50">{isSigningIn ? 'Sending code…' : 'Send Gmail verification code'}</button> : <div>
                  <label htmlFor="auth-email-code" className="mb-1.5 block text-sm text-slate-300">Email verification code</label>
                  <input id="auth-email-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={emailCode} onChange={event => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-left text-sm text-white outline-none focus:border-emerald-500" />
                  <button type="button" onClick={() => void sendEmailVerificationCode()} disabled={isSigningIn} className="mt-2 text-xs text-emerald-300 underline disabled:opacity-50">Send code again</button>
                </div>}
              </div>}
              <div>
                <label htmlFor="auth-password" className="mb-1.5 block text-sm text-slate-300">{t('authPassword')}</label>
                <input id="auth-password" type="password" required minLength={authMode === 'login' ? 6 : 8} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder={authMode === 'signup' ? 'At least 8 characters' : t('authPasswordHint')} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-left text-sm text-white outline-none focus:border-emerald-500" />
              </div>
              {authMode === 'login' && <div className="pt-2 space-y-2">
                <p className="text-xs text-slate-400">{meta.code === 'fa' ? 'برای ورود، ابتدا بررسی امنیتی را کامل کنید.' : 'Complete the security check before signing in.'}</p>
                <CaptchaWidget
                  key={loginCaptchaSiteKey}
                  siteKey={loginCaptchaSiteKey}
                  usageType="test"
                  action="login"
                  lang={meta.code as any}
                  onVerify={() => { setLoginCaptchaVerified(true); setAuthError(''); }}
                  onChallenge={() => setLoginCaptchaVerified(false)}
                  onError={() => setLoginCaptchaVerified(false)}
                  onExpire={() => setLoginCaptchaVerified(false)}
                />
                {loginCaptchaVerified && <p role="status" className="text-xs text-emerald-300">{meta.code === 'fa' ? 'کپچا تأیید شد؛ اکنون می‌توانید وارد شوید.' : 'CAPTCHA verified. You can now sign in.'}</p>}
              </div>}
              {authError && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm leading-6 text-rose-300">{authError}</p>}
              {!import.meta.env.VITE_FIREBASE_API_KEY && <p className="text-xs leading-5 text-amber-300">VITE_FIREBASE_API_KEY is not set in the build configuration.</p>}
              {health && !health.firebaseAuth.isInitialized && <p className="text-xs leading-5 text-amber-300">Server-side Firebase Admin is not ready; check the Firebase configuration.</p>}
              <button type="submit" disabled={isSigningIn || !import.meta.env.VITE_FIREBASE_API_KEY || !health?.firebaseAuth.isInitialized || (authMode === 'login' && !loginCaptchaVerified) || (authMode === 'signup' && !emailCodeSent)} className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                {isSigningIn ? t('authPleaseWait') : authMode === 'login' ? t('authSignInButton') : 'Verify code and create account'}
              </button>
              <div className="relative py-1 text-center text-xs text-slate-500"><span className="bg-slate-900 px-3">or</span></div>
              <button type="button" onClick={() => void signInWithGoogle()} disabled={googleBusy || isSigningIn} className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-700 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"><span className="text-base font-bold">G</span>{googleBusy ? 'Connecting to Google…' : 'Continue with Google'}</button>
            </form>
            <p className="mt-5 text-center text-xs leading-5 text-slate-500">{t('authPasswordPrivacy')}</p>
          </section>
        </div>
      </div>
      </AutoTranslate>
    );
  }

  return (
    <AutoTranslate lang={meta.code as any}>
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
              <span className="text-slate-400">Storage:</span>
              <span className="font-mono text-emerald-400 font-medium">
                {health?.database.isPostgresConnected ? 'PostgreSQL (Cloud SQL)' : (import.meta.env.PROD ? 'Database unavailable' : 'Drizzle File Storage')}
              </span>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60">
              <Lock className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-slate-400">Authentication:</span>
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
              <option value="developer@shieldcaptcha.dev">{t('accountDev')}</option>
              <option value="alice@shieldcaptcha.dev">{t('accountAlice')}</option>
              <option value="bob@shieldcaptcha.dev">{t('accountBob')}</option>
            </select>}
          </div>
          <LanguageSelector />
          {authToken && userEmail.trim().toLowerCase() === 'tattoo.rayan2015@gmail.com' && (
            <a
              href="/admin"
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
              title="ورود به پنل اختصاصی مدیریت سامانه"
            >
              پنل مدیریت
            </a>
          )}
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
              Sign Out
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
            { id: 'billing', label: 'Billing & Subscription', icon: Wallet },
            { id: 'support', label: 'Support', icon: LifeBuoy },
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
          <div role="region" aria-label="Secure Dashboard Sign-In" className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <h2 className="font-semibold mb-2">Secure Dashboard Sign-In</h2>
            <p className="text-xs text-amber-200/90 mb-4">
              Sign in with your Firebase email and password. Your password is sent only to Firebase and is not stored by ShieldCaptcha.
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
                placeholder="Account email"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder={t('authPassword')}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                disabled={isSigningIn || !import.meta.env.VITE_FIREBASE_API_KEY || !health?.firebaseAuth.isInitialized}
                className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSigningIn ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
            {!import.meta.env.VITE_FIREBASE_API_KEY && <p className="mt-3 text-xs text-amber-200">VITE_FIREBASE_API_KEY is not set in the build configuration.</p>}
            {health && !health.firebaseAuth.isInitialized && <p className="mt-3 text-xs text-amber-200">Server-side Firebase Admin is not ready; check FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_KEY settings.</p>}
            {authError && <p role="alert" className="mt-3 text-xs text-rose-300">{authError}</p>}
          </div>
        )}

        {/* TAB: CUSTOMER SUPPORT */}
        {activeTab === 'support' && (
          <div className="max-w-6xl space-y-6">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><LifeBuoy className="h-6 w-6 text-emerald-400" /> Support Center</h1>
              <p className="mt-2 text-sm text-slate-400">Create a support ticket, track its status, and reply in one place. Do not include passwords, secret keys, or wallet private keys.</p>
            </div>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <form onSubmit={createSupportTicket} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5">
                <h2 className="font-semibold text-white">Open a new ticket</h2>
                <div><label htmlFor="support-subject" className="mb-1.5 block text-xs text-slate-300">Subject</label><input id="support-subject" required minLength={4} maxLength={160} value={supportSubject} onChange={e => setSupportSubject(e.target.value)} placeholder="Briefly describe the issue" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white" /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label htmlFor="support-category" className="mb-1.5 block text-xs text-slate-300">Category</label><select id="support-category" value={supportCategory} onChange={e => setSupportCategory(e.target.value as any)} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white"><option value="general">General</option><option value="technical">Technical issue</option><option value="billing">Billing / subscription</option><option value="security">Security</option></select></div>
                  <div><label htmlFor="support-priority" className="mb-1.5 block text-xs text-slate-300">Priority</label><select id="support-priority" value={supportPriority} onChange={e => setSupportPriority(e.target.value as any)} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
                </div>
                <div><label htmlFor="support-body" className="mb-1.5 block text-xs text-slate-300">Message</label><textarea id="support-body" required minLength={10} maxLength={5000} rows={5} value={supportBody} onChange={e => setSupportBody(e.target.value)} placeholder="Explain what happened and what you expected..." className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white" /></div>
                <button disabled={supportBusy} type="submit" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"><Send className="h-4 w-4" /> Submit ticket</button>
              </form>
              <div className="space-y-4">
                <div className="flex items-center justify-between"><h2 className="font-semibold text-white">{supportIsAdmin ? 'All support tickets' : 'Your support tickets'}</h2><button type="button" onClick={loadSupportTickets} className="text-xs text-emerald-300 underline">Refresh</button></div>
                {supportMessage && <p role="status" className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300">{supportMessage}</p>}
                {supportTickets.length === 0 ? <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No support tickets yet.</div> : <div className="space-y-3">{supportTickets.map((ticket: any) => <button type="button" key={ticket.id} onClick={() => { setActiveTicketId(ticket.id); setSupportStatus(ticket.status === 'open' ? 'in_progress' : ticket.status); }} className={`w-full rounded-xl border p-4 text-left transition-colors ${activeTicketId === ticket.id ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-white">{ticket.subject}</span><span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-emerald-300">{String(ticket.status).replace('_', ' ')}</span></div><div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500"><span>#{ticket.id}</span><span>{ticket.category}</span><span>{ticket.priority} priority</span><span>{ticket.messages?.length || 0} messages</span></div></button>)}</div>}
                {supportTickets.filter((ticket: any) => ticket.id === activeTicketId).map((ticket: any) => <section key={ticket.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
                  <div className="border-b border-slate-800 p-4"><h3 className="font-semibold text-white">{ticket.subject}</h3><p className="mt-1 text-[11px] text-slate-500">Ticket {ticket.id} · Status: {ticket.status}</p></div>
                  <div className="max-h-80 space-y-3 overflow-y-auto p-4">{(ticket.messages || []).map((message: any) => <div key={message.id} className={`rounded-lg border p-3 ${message.authorRole === 'ADMIN' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-700 bg-slate-950/70'}`}><div className="mb-1 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-200">{message.authorRole === 'ADMIN' ? 'ShieldCaptcha Support' : 'Customer'}</span><span className="text-[10px] text-slate-500">{new Date(message.createdAt).toLocaleString('en-US')}</span></div><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{message.body}</p></div>)}</div>
                  {ticket.status !== 'closed' && <form onSubmit={sendSupportReply} className="space-y-3 border-t border-slate-800 p-4"><textarea required minLength={2} maxLength={5000} rows={3} value={supportReply} onChange={e => setSupportReply(e.target.value)} placeholder="Write a reply..." className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white" /><div className="flex flex-wrap items-center justify-between gap-3">{supportIsAdmin && <select value={supportStatus} onChange={e => setSupportStatus(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white"><option value="in_progress">In progress</option><option value="waiting_user">Waiting for user</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select>}<button disabled={supportBusy || !supportReply.trim()} type="submit" className="ml-auto inline-flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50"><MessageSquare className="h-4 w-4" /> Send reply</button></div></form>}
                </section>)}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="space-y-6 max-w-5xl">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Wallet className="w-6 h-6 text-emerald-400" /> Crypto Payments & Subscriptions</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">USDT payments are accepted on the TRON (TRC20) network only. A subscription activates only after independent on-chain transaction verification.</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <div className="flex items-center gap-2 mb-2"><span className={`h-2.5 w-2.5 rounded-full ${billingConfig?.ready ? 'bg-emerald-400' : 'bg-amber-400'}`} /><span className="font-semibold text-white">{billingConfig?.ready ? 'Crypto payment gateway is configured' : 'Payment gateway is not ready to receive funds'}</span></div>
              <p className="text-sm leading-6 text-slate-400">{billingConfig?.message || (billingConfig?.ready ? 'Network: TRON (TRC20) · Currency: USDT' : 'The service administrator must configure the receiving wallet address and TRON provider API key in Render environment variables.')}</p>
              {billingConfig?.ready && <div className="mt-3 break-all rounded-lg bg-slate-950 border border-slate-700 p-3 font-mono text-sm text-emerald-300">{billingConfig.walletAddress}<button className="ml-3 text-xs text-slate-300 underline" onClick={() => copyToClipboard(billingConfig.walletAddress, 'billing-wallet')}>{copiedKey === 'billing-wallet' ? 'Copied' : 'Copy address'}</button></div>}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { id: 'starter', title: 'Starter', price: 9, requests: '100,000 + 50 bonus requests per purchase' },
                { id: 'pro', title: 'Pro', price: 49, requests: '1,000,000 + 500 bonus requests per purchase' },
                { id: 'business', title: 'Business', price: 199, requests: '5,000,000 + 2,500 bonus requests per purchase' },
              ].map(plan => (
                <button key={plan.id} type="button" onClick={() => setBillingPlan(plan.id as any)} className={`text-left rounded-xl border p-4 transition-colors ${billingPlan === plan.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'}`}>
                  <div className="text-sm text-slate-300">{plan.title}</div><div className="mt-2 text-2xl font-bold text-white">${plan.price}<span className="text-xs font-normal text-slate-400"> / 30 days</span></div><div className="mt-2 text-xs text-slate-400">{plan.requests}</div>
                </button>
              ))}
            </div>
            <button type="button" disabled={!billingConfig?.ready || billingBusy} onClick={createBillingInvoice} className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed">{billingBusy ? 'Processing...' : 'Create USDT payment invoice'}</button>
            {billingInvoice && (
              <div className="space-y-4 rounded-xl border border-emerald-500/30 bg-slate-900/80 p-4">
                <h2 className="font-semibold text-white">Invoice {billingInvoice.id}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-950 p-3"><div className="text-xs text-slate-400">Exact amount</div><div className="mt-1 text-2xl font-bold text-emerald-300">{billingInvoice.amount_usdt} USDT</div></div>
                  <div className="rounded-lg bg-slate-950 p-3"><div className="text-xs text-slate-400">Network & expiry</div><div className="mt-1 text-sm text-white">TRON (TRC20)</div><div className="text-xs text-slate-400">{new Date(billingInvoice.expires_at).toLocaleString()}</div></div>
                </div>
                <div><label className="mb-1 block text-xs text-slate-400">Receiving address (TRC20 only)</label><div className="break-all rounded-lg bg-slate-950 p-3 font-mono text-xs text-white">{billingInvoice.payment_address || billingConfig?.walletAddress}</div><button className="mt-2 text-xs text-emerald-300 underline" onClick={() => copyToClipboard(billingInvoice.payment_address || billingConfig?.walletAddress, 'invoice-wallet')}>{copiedKey === 'invoice-wallet' ? 'Copied' : 'Copy wallet address'}</button></div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-6 text-amber-200">Send the exact amount. Using the wrong network or token may result in loss of funds. Never enter a wallet private key.</div>
                {billingInvoice.status !== 'paid' && <div className="space-y-2"><label className="block text-xs text-slate-300" htmlFor="billing-txid">Transaction ID (TXID)</label><input id="billing-txid" value={billingTxid} onChange={e => setBillingTxid(e.target.value)} placeholder="64-character transaction ID" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-white" /><button disabled={billingBusy || billingTxid.trim().length !== 64} onClick={verifyBillingPayment} className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-white disabled:opacity-40">Verify payment on blockchain</button></div>}
                {billingInvoice.status === 'paid' && <p className="text-sm font-semibold text-emerald-300">Payment confirmed.</p>}
              </div>
            )}
            {billingMessage && <p role="status" className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm leading-6 text-slate-300">{billingMessage}</p>}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h2 className="mb-3 font-semibold text-white">Recent Invoices</h2>
              {billingInvoices.length === 0 ? <p className="text-sm text-slate-500">No invoices yet.</p> : <div className="space-y-2">{billingInvoices.map(inv => <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950 p-3 text-xs"><span className="font-mono text-slate-300">{inv.id}</span><span className="text-white">{inv.amount_usdt} USDT · {inv.plan_id}</span><span className={inv.status === 'paid' ? 'text-emerald-300' : 'text-amber-300'}>{inv.status}</span></div>)}</div>}
            </div>
          </div>
        )}

        {/* TAB 1: SITES MANAGEMENT */}
        {activeTab === 'sites' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>{t('sitesTitle')}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                    {userEmail}
                  </span>
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  {t('sitesSubtitle')}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchSites()}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
                  title={t('refreshBtn')}
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingSites ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-emerald-950/40 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('addSiteBtn')}</span>
                </button>
              </div>
            </div>

            {/* Sites Grid */}
            {isLoadingSites ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
                <span className="text-xs text-slate-400">Loading websites from the database...</span>
              </div>
            ) : sites.length === 0 ? (
              <div className="py-16 px-4 rounded-2xl border border-dashed border-slate-800 text-center flex flex-col items-center justify-center gap-3 bg-slate-900/30">
                <Globe className="w-10 h-10 text-slate-600" />
                <h3 className="text-sm font-semibold text-slate-300">{t('noSitesTitle')}</h3>
                <p className="text-xs text-slate-500 max-w-sm">
                  {t('noSitesDesc')}
                </p>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="mt-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium cursor-pointer"
                >
                  {t('addFirstSite')}
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
                              Created: {new Date(site.createdAt).toLocaleDateString('en-US')}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDeleteSite(site.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                          title="Delete website"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Site Key (Public) */}
                      <div className="space-y-2 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-400 font-medium block mb-1">
                            {t('publicKeyLabel')}
                          </span>
                          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80 font-mono text-[11px] text-emerald-400">
                            <span className="truncate">{site.siteKey}</span>
                            <button
                              onClick={() => copyToClipboard(site.siteKey, `site-${site.id}`)}
                              className="text-slate-400 hover:text-white p-1 cursor-pointer"
                              title={t('copyPublicKey')}
                            >
                              {copiedKey === `site-${site.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        {/* Secret Key (Masked - Private) */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-slate-400 font-medium">
                              {t('secretKeyLabel')}
                            </span>
                            <span className="text-[9px] text-amber-400/80">{t('serverOnlyNotice')}</span>
                          </div>
                          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/70 border border-slate-800/60 font-mono text-[11px] text-slate-400">
                            <span className="truncate">{site.maskedSecretKey}</span>
                            <Lock className="w-3.5 h-3.5 text-slate-500" />
                          </div>
                        </div>

                        {/* Whitelisted Domains */}
                        <div>
                          <span className="text-[10px] text-slate-400 font-medium block mb-1">
                            {t('allowedDomains')}
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
                        {t('difficultyLabel')} <span className="text-slate-300 font-medium">{site.challengeDifficulty}</span>
                      </span>
                      <button
                        onClick={() => {
                          setSelectedSiteKey(site.siteKey);
                          setActiveTab('playground');
                        }}
                        className="text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <span>Test in Playground</span>
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
                    <span>{t('playgroundTitle')}</span>
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
                  This widget connects directly to the server API (`POST /api/v1/captcha/challenge` and `verify`).
                </p>

                {/* Embedded Widget */}
                {selectedSiteKey ? (
                  <CaptchaWidget
                    usageType="test"
                    key={selectedSiteKey}
                    siteKey={selectedSiteKey}
                    lang={meta.code as any}
                    onVerify={(token, data) => {
                      setLastVerifiedToken(token);
                      setLastVerifiedSiteKey(selectedSiteKey);
                      setLastVerificationData(data);
                    }}
                    onError={(code) => console.log('Widget error:', code)}
                  />
                ) : (
                  <div className="text-xs text-slate-500 text-center py-8">
                    {t('noSiteWarning')}
                  </div>
                )}

                {/* Verification result badge */}
                {lastVerificationData && (
                  <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                      <ShieldCheck className="w-4 h-4" />
                      <span>Server-verified response:</span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-300">
                      Security score: {lastVerificationData.score} / 100
                    </div>
                    <div className="font-mono text-[10px] text-slate-400 truncate">
                      Verification token: {lastVerifiedToken}
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
                    <span>{t('attackLabTitle')}</span>
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                    {t('liveApiTest')}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  {t('attackLabSubtitle')}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
                  <button
                    disabled={isTestingScenario || !selectedSiteKey}
                    onClick={() => runSecurityTest('wrong_answer')}
                    className="p-3 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-right transition-all cursor-pointer disabled:opacity-50"
                  >
                    <div className="text-xs font-semibold text-rose-400 mb-1">1. Two incorrect answers allowed</div>
                    <div className="text-[10px] text-slate-400">The second incorrect answer consumes the challenge; a third attempt must be rejected</div>
                  </button>

                  <button
                    disabled={isTestingScenario || !selectedSiteKey}
                    onClick={() => runSecurityTest('replay_attack')}
                    className="p-3 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-right transition-all cursor-pointer disabled:opacity-50"
                  >
                    <div className="text-xs font-semibold text-amber-400 mb-1">{t('attackReplay')}</div>
                    <div className="text-[10px] text-slate-400">{t('attackReplayDesc')}</div>
                  </button>

                  <button
                    disabled={isTestingScenario || !selectedSiteKey}
                    onClick={() => runSecurityTest('backend_verify')}
                    className="p-3 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-right transition-all cursor-pointer disabled:opacity-50"
                  >
                    <div className="text-xs font-semibold text-emerald-400 mb-1">3. Reject invalid secret key</div>
                    <div className="text-[10px] text-slate-400">Verify that an invalid test Secret Key is rejected; the real key is never sent to the browser</div>
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
                        {testResultLog.status === 'success' ? 'Behavior matches expectations' : 'Test failed'}
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
                  <span>{t('logsTitle')}</span>
                </h2>
                <p className="text-xs text-slate-400">
                  {t('logsSubtitle')}
                </p>
              </div>
              <button
                onClick={fetchUsageLogs}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t('refreshLogs')}</span>
              </button>
            </div>

            {/* 24-Hour Summary Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block">{t('totalRequests24h')}</span>
                  <span className="text-xl font-bold font-mono text-white mt-0.5 block">{trafficStats.total}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-800 text-slate-300">
                  <Activity className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block">{t('passedHumans')}</span>
                  <span className="text-xl font-bold font-mono text-emerald-400 mt-0.5 block">{trafficStats.passed}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block">{t('blockedBots')}</span>
                  <span className="text-xl font-bold font-mono text-rose-400 mt-0.5 block">{trafficStats.blocked}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400">
                  <XCircle className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block">Pass rate</span>
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
                    <span>{t('trafficTrendsTitle')}</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {t('trafficTrendsSubtitle')}
                  </p>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 self-start sm:self-auto">
                  {t('range24h')}
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
                                Hour {label}
                              </p>
                              <div className="flex items-center justify-between gap-3 text-emerald-400 font-mono">
                                <span>{passedVal}</span>
                                <span className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                                  Verified:
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3 text-rose-400 font-mono">
                                <span>{blockedVal}</span>
                                <span className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                                  <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
                                  Blocked:
                                </span>
                              </div>
                              <div className="pt-1 border-t border-slate-800 text-[10px] text-slate-400 font-mono flex items-center justify-between">
                                <span className="text-white font-bold">{Number(passedVal) + Number(blockedVal)}</span>
                                <span>{t('totalRequestsLabel')}</span>
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
                      name="Verified (Passed)"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dot={{ r: 2, fill: '#10b981' }}
                      activeDot={{ r: 5, fill: '#10b981', stroke: '#064e3b', strokeWidth: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="blocked"
                      name="Blocked"
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
                <span className="text-xs font-semibold text-slate-200">{t('recentEventsTitle')}</span>
                <span className="text-[10px] font-mono text-slate-400">{t('last50Events')}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] border-b border-slate-800">
                    <tr>
                      <th className="p-3">{t('tableTime')}</th>
                      <th className="p-3">{t('tableSiteKey')}</th>
                      <th className="p-3">{t('tableDecision')}</th>
                      <th className="p-3">{t('tableScore')}</th>
                      <th className="p-3">{t('tableHostname')}</th>
                      <th className="p-3">{t('tableErrors')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-500">
                          {t('noEventsNotice')}
                        </td>
                      </tr>
                    ) : (
                      logs.map((log, i) => (
                        <tr key={i} className="hover:bg-slate-800/40">
                          <td className="p-3 text-slate-400">
                            {new Date(log.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                          </td>
                          <td className="p-3 text-slate-300 truncate max-w-[120px]">{log.siteKey}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] ${
                              log.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                            }`}>
                              {log.success ? 'PASS' : 'BLOCKED'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-200">{log.score}</td>
                          <td className="p-3 text-slate-400">{log.hostname || 'localhost'}</td>
                          <td className="p-3 text-slate-400">
                            {log.errorCodes && log.errorCodes.length > 0 ? (
                              <span className="text-rose-400">{log.errorCodes.join(', ')}</span>
                            ) : (
                              <span className="text-emerald-500">{t('noneSuccess')}</span>
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
              <h2 className="text-xl font-bold text-white">{t('docsTitle')}</h2>
              <p className="text-xs text-slate-400 mt-1">
                {t('docsSubtitle')}
              </p>
            </div>

            {/* Step 1: Frontend */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center">1</span>
                <h3 className="text-sm font-semibold text-white">Embed the widget in your website form (React / HTML)</h3>
              </div>
              <p className="text-xs text-slate-400">
                Place the widget in your sign-in, sign-up, or payment form and submit the generated token with the form:
              </p>

              <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-400 overflow-x-auto">
{`import { CaptchaWidget } from '@shieldcaptcha/widget';

export function LoginForm() {
  const [token, setToken] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Send the token to your server
    await fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, captchaToken: token })
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" placeholder={t('authEmail')} />
      <CaptchaWidget 
        siteKey="${selectedSiteKey || 'sc_site_YOUR_KEY'}" 
        onVerify={(verifiedToken) => setToken(verifiedToken)} 
      />
      <button type="submit" disabled={!token}>{t('authSignInButton')}</button>
    </form>
  );
}`}
              </pre>
            </div>

            {/* Step 2: Backend Verification */}
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-teal-500/20 text-teal-400 text-xs font-bold flex items-center justify-center">2</span>
                <h3 className="text-sm font-semibold text-white">Server-to-server verification (Node.js / Express)</h3>
              </div>
              <p className="text-xs text-slate-400">
                In your backend controller, send the submitted token to `/api/v1/captcha/verify`:
              </p>

              <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-teal-300 overflow-x-auto">
{`// On the backend (never expose the Secret Key in frontend code):
app.post('/api/login', async (req, res) => {
  const { email, password, captchaToken } = req.body;

  const verifyResponse = await fetch(process.env.SHIELDCAPTCHA_API_URL + '/api/v1/captcha/verify', {
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

  // Verification succeeded; continue the sign-in flow...
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
                <span>Register New Website</span>
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
                <label className="block text-slate-300 font-medium mb-1">Website or project name:</label>
                <input
                  type="text"
                  required
                  value={newSiteName}
                  onChange={e => setNewSiteName(e.target.value)}
                  placeholder="e.g. My Online Store"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Allowed domains (comma-separated):
                </label>
                <input
                  type="text"
                  value={newSiteDomains}
                  onChange={e => setNewSiteDomains(e.target.value)}
                  placeholder="localhost, example.com, app.example.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 font-mono text-emerald-400 focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Challenges can only be issued for these domains.
                </span>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">{t('difficultySelect')}</label>
                <select
                  value={newSiteDifficulty}
                  onChange={e => setNewSiteDifficulty(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white cursor-pointer"
                >
                  <option value="LOW">{t('diffLow')}</option>
                  <option value="MEDIUM">{t('diffMedium')}</option>
                  <option value="HIGH">{t('diffHigh')}</option>
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
                  Enable invisible pre-check (Invisible Check)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isCreatingSite}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isCreatingSite ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Create and retrieve keys</span>
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
                Keys for site “{oneTimeSecretModal.siteName}” were generated successfully
              </h3>
            </div>

            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>Critical security warning:</strong>
                <p className="text-[11px] text-amber-200/90 mt-0.5">
                  The private key is shown only once. For security, the server stores only a one-way hash, and the key cannot be viewed again.
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[11px] text-slate-400 block mb-1">Public Site Key:</span>
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
                  Private Secret Key:
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
                {t('savedAcknowledge')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AutoTranslate>
  );
}
