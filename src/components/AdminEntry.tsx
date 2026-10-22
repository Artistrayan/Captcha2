import React, { useState } from 'react';
import { LockKeyhole, ShieldCheck, AlertCircle, LoaderCircle, ArrowRight } from 'lucide-react';
import AdminPanel from './AdminPanel.tsx';
import { AutoTranslate } from '../i18n/AutoTranslate.tsx';

export default function AdminEntry() {
  const mainAppUrl = import.meta.env.VITE_MAIN_APP_URL || 'https://shieldcaptcha-web.onrender.com';
  const [language, setLanguage] = useState<'en' | 'fa'>(() => sessionStorage.getItem('shieldcaptcha_admin_language') === 'fa' ? 'fa' : 'en');
  const toggleLanguage = () => {
    const next = language === 'en' ? 'fa' : 'en';
    sessionStorage.setItem('shieldcaptcha_admin_language', next);
    setLanguage(next);
  };
  const [hasSession, setHasSession] = useState(() => Boolean(sessionStorage.getItem('shieldcaptcha_id_token')));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (hasSession) return <><AutoTranslate lang={language}><AdminPanel /></AutoTranslate><button type="button" onClick={toggleLanguage} className="fixed bottom-4 right-4 z-[100] rounded-full border border-slate-600 bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-xl">{language === 'en' ? 'FA' : 'EN'}</button></>;

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      if (!apiKey) throw new Error('کلید عمومی Firebase در تنظیمات Build برنامه تنظیم نشده است.');
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
      });
      const data = await response.json();
      if (!response.ok || !data.idToken) {
        const code = data?.error?.message;
        const messages: Record<string, string> = {
          EMAIL_NOT_FOUND: 'این ایمیل در Firebase ثبت نشده است.',
          INVALID_PASSWORD: 'گذرواژه نادرست است.',
          INVALID_LOGIN_CREDENTIALS: 'ایمیل یا گذرواژه نادرست است.',
          USER_DISABLED: 'این حساب غیرفعال شده است.',
          TOO_MANY_ATTEMPTS_TRY_LATER: 'تلاش‌های زیادی انجام شده؛ کمی بعد دوباره امتحان کنید.',
        };
        throw new Error(messages[code] || 'ورود انجام نشد. تنظیمات Firebase را بررسی کنید.');
      }
      sessionStorage.setItem('shieldcaptcha_id_token', data.idToken);
      sessionStorage.setItem('shieldcaptcha_user_email', data.email || email.trim());
      setHasSession(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ورود انجام نشد.');
    } finally {
      setBusy(false);
    }
  };

  return <><AutoTranslate lang={language}><main dir={language === 'fa' ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
    <section className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">
      <div className="border-b border-slate-800 bg-slate-900/80 p-7 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300"><ShieldCheck className="h-7 w-7" /></div>
        <p className="text-xs font-semibold tracking-[0.2em] text-emerald-300">SHIELDCAPTCHA</p>
        <h1 className="mt-2 text-2xl font-bold">ورود امن به پنل مدیریت</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">این صفحه از داشبورد کاربران جداست. دسترسی مدیر پس از ورود، توسط سرور بررسی می‌شود.</p>
      </div>
      <form onSubmit={signIn} className="space-y-4 p-7">
        {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm leading-6 text-rose-200"><AlertCircle className="mt-1 h-4 w-4 shrink-0" /><span>{error}</span></div>}
        <label className="block text-sm font-medium">ایمیل مدیر
          <input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-left outline-none focus:border-emerald-500" dir="ltr" placeholder="admin@example.com" />
        </label>
        <label className="block text-sm font-medium">گذرواژه
          <div className="relative mt-2"><LockKeyhole className="absolute left-3 top-3.5 h-4 w-4 text-slate-500" /><input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-4 text-left outline-none focus:border-emerald-500" dir="ltr" placeholder="••••••••" /></div>
        </label>
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {busy ? 'در حال بررسی...' : 'ورود به پنل مدیریت'}
        </button>
        <p className="text-xs leading-6 text-slate-500">اگر ورود موفق بود اما پیام نداشتن دسترسی مدیر دیدید، مقدار ADMIN_EMAIL در Environment Variables سرویس Render باید با ایمیل همین حساب یکسان باشد.</p>
      </form>
      <div className="border-t border-slate-800 p-4"><a href={mainAppUrl} className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowRight className="h-4 w-4" />بازگشت به برنامه</a></div>
    </section>
  </main></AutoTranslate><button type="button" onClick={toggleLanguage} className="fixed bottom-4 right-4 z-[100] rounded-full border border-slate-600 bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-xl">{language === 'en' ? 'FA' : 'EN'}</button></>;
}
