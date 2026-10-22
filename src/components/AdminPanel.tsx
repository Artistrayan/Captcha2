import React, { useCallback, useEffect, useState } from 'react';
import { AutoTranslate, translateAdminText } from '../i18n/AutoTranslate.tsx';
import { Activity, AlertCircle, Building2, CheckCircle2, Clock, DollarSign, LayoutDashboard, LifeBuoy, LogOut, Receipt, RefreshCw, Send, ShieldCheck, Users, Wallet } from 'lucide-react';

type TicketMessage = { id: string; authorId: string; authorRole: string; body: string; createdAt: string };
type Ticket = { id: string; userId: string; subject: string; category: string; priority: string; status: string; messages: TicketMessage[]; createdAt: string; updatedAt: string };
type Overview = { users: number; sites: number; tickets: number; openTickets: number; requests24h: number; passed24h: number; blocked24h: number; passRate24h: number; generatedAt: string };
type AdminUser = { id: string; email: string; name: string; role: string; createdAt: string };
type AdminSite = { id: string; name: string; siteKey: string; ownerEmail: string; domains: string[]; challengeDifficulty: string; invisibleEnabled: boolean; rateLimitPerMinute: number; createdAt: string };
type AdminEvent = { id: string; siteKey: string; success: boolean; score: number; hostname: string; action: string; errorCodes: string[]; createdAt: string };
type FinanceSummary = { generatedAt: string; totals: { total_invoices: number; paid_invoices: number; pending_invoices: number; expired_invoices: number; revenue_all: string | number; revenue_month: string | number; paid_this_month: number; invoices_30d: number }; plans: { plan_id: string; paid_count: number; revenue: string | number }[]; statuses: { status: string; count: number }[]; recentInvoices: { id: string; plan_id: string; amount_usdt: string | number; status: string; txid: string | null; created_at: string; paid_at: string | null; email: string }[]; subscriptions: { active: number; inactive: number }; accountingNote: string };
type Section = 'overview' | 'users' | 'sites' | 'tickets' | 'activity' | 'finance';
const sections: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'نمای کلی سامانه', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'users', label: 'مدیریت کاربران', icon: <Users className="h-4 w-4" /> },
  { id: 'sites', label: 'وب‌سایت‌ها و کلیدها', icon: <Building2 className="h-4 w-4" /> },
  { id: 'tickets', label: 'تیکت‌های پشتیبانی', icon: <LifeBuoy className="h-4 w-4" /> },
  { id: 'activity', label: 'رویدادهای امنیتی', icon: <Activity className="h-4 w-4" /> },
  { id: 'finance', label: 'حسابداری و اشتراک‌ها', icon: <Wallet className="h-4 w-4" /> },
];
const statuses = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const mainAppUrl = import.meta.env.VITE_MAIN_APP_URL || 'https://shieldcaptcha-web.onrender.com';
const dateText = (value: string) => value ? new Date(value).toLocaleString(sessionStorage.getItem('shieldcaptcha_admin_language') === 'fa' ? 'fa-IR' : 'en-US') : '—';

export default function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem('shieldcaptcha_id_token') || '');
  const [email] = useState(() => sessionStorage.getItem('shieldcaptcha_user_email') || '');
  const [section, setSection] = useState<Section>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sites, setSites] = useState<AdminSite[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [financeError, setFinanceError] = useState('');
  const [financeExporting, setFinanceExporting] = useState(false);
  const [financeExportFrom, setFinanceExportFrom] = useState('');
  const [financeExportTo, setFinanceExportTo] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('open');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const selected = tickets.find(ticket => ticket.id === selectedId);

  const api = useCallback(async (path: string) => {
    const response = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (response.status === 401) throw new Error('نشست ورود معتبر نیست. از صفحه اصلی دوباره وارد شوید.');
    if (response.status === 403) throw new Error('این حساب مجوز مدیریت سامانه را ندارد.');
    if (!response.ok) throw new Error(data.error || data.message || 'دریافت اطلاعات ناموفق بود.');
    return data;
  }, [token]);

  const loadAll = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [overviewData, userData, siteData, eventData, ticketData] = await Promise.all([
        api('/api/v1/admin/overview'),
        api('/api/v1/admin/users'),
        api('/api/v1/admin/sites'),
        api('/api/v1/admin/events'),
        api('/api/v1/support/tickets'),
      ]);
      if (!ticketData.isAdmin) throw new Error('این حساب مجوز مدیریت سامانه را ندارد.');
      setOverview(overviewData);
      setUsers(userData.users || []);
      setSites(siteData.sites || []);
      setEvents(eventData.events || []);
      const nextTickets: Ticket[] = ticketData.tickets || [];
      setTickets(nextTickets);
      setSelectedId(current => nextTickets.some(ticket => ticket.id === current) ? current : (nextTickets[0]?.id || ''));
      setIsAdmin(true);
      setFinanceError('');
      void api('/api/v1/billing/admin/summary').then((data: FinanceSummary) => { setFinance(data); setFinanceError(''); }).catch((err: unknown) => { setFinance(null); setFinanceError(err instanceof Error ? err.message : 'دریافت اطلاعات حسابداری ناموفق بود.'); });
    } catch (err) {
      setIsAdmin(false);
      setError(err instanceof Error ? err.message : 'خطای ناشناخته هنگام دریافت اطلاعات');
    } finally { setLoading(false); }
  }, [token, api]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const sendReply = async () => {
    if (!selected || reply.trim().length < 2) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBase}/api/v1/support/tickets/${encodeURIComponent(selected.id)}/replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: reply.trim(), status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'ارسال پاسخ ناموفق بود.');
      setReply('');
      await loadAll();
    } catch (err) { setError(err instanceof Error ? err.message : 'ارسال پاسخ ناموفق بود.'); }
    finally { setBusy(false); }
  };

  const exportFinanceCsv = async () => {
    if (!token || financeExporting) return;
    setFinanceExporting(true);
    setFinanceError('');
    try {
      const query = new URLSearchParams();
      if (financeExportFrom) query.set('from', financeExportFrom);
      if (financeExportTo) query.set('to', financeExportTo);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const response = await fetch(`${apiBase}/api/v1/billing/admin/export.csv${suffix}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || data?.message || 'خروجی حسابداری دریافت نشد.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `shieldcaptcha-accounting-${financeExportFrom || 'all'}-${financeExportTo || new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setFinanceError(err instanceof Error ? err.message : 'خروجی حسابداری دریافت نشد.');
    } finally {
      setFinanceExporting(false);
    }
  };

  const signOut = () => {
    sessionStorage.removeItem('shieldcaptcha_id_token');
    sessionStorage.removeItem('shieldcaptcha_user_email');
    setToken(''); setIsAdmin(false); window.location.href = mainAppUrl;
  };

  const pageTitle = sections.find(item => item.id === section)?.label || 'پنل مدیریت';
  return <AutoTranslate lang={sessionStorage.getItem('shieldcaptcha_admin_language') === 'fa' ? 'fa' : 'en'}><div dir={sessionStorage.getItem('shieldcaptcha_admin_language') === 'fa' ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-950 text-slate-100">
    <header className="border-b border-slate-800 bg-slate-900/90">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-400"><ShieldCheck className="h-6 w-6" /></div><div><h1 className="text-xl font-bold">مرکز مدیریت ShieldCaptcha</h1><p className="mt-1 text-xs text-slate-400">کنترل کاربران، وب‌سایت‌ها، فعالیت امنیتی و پشتیبانی</p></div></div>
        <div className="flex items-center gap-2"><a href={mainAppUrl} className="rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800">صفحه اصلی برنامه</a><button onClick={() => void loadAll()} disabled={loading || !token} className="rounded-lg border border-slate-700 p-2 hover:bg-slate-800 disabled:opacity-50" title="بارگذاری مجدد"><RefreshCw className="h-4 w-4" /></button>{token && <button onClick={signOut} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800"><LogOut className="h-4 w-4" />خروج</button>}</div>
      </div>
    </header>
    <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      {!token ? <section className="mx-auto max-w-xl rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6"><AlertCircle className="mb-3 h-6 w-6 text-amber-400" /><h2 className="font-semibold">ابتدا وارد حساب مدیر شوید</h2><p className="my-3 text-sm text-slate-300">از صفحه اصلی با حساب مدیریتی {email || 'خود'} وارد شوید و سپس این صفحه را باز کنید.</p><a href={mainAppUrl} className="inline-flex rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">رفتن به صفحه ورود</a></section> : <>
        {error && <div role="alert" className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
        <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
            <p className="px-3 pb-3 pt-2 text-[11px] font-semibold text-slate-500">منوی مدیریت</p>
            <nav className="space-y-1">{sections.map(item => <button key={item.id} onClick={() => setSection(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-right text-sm transition ${section === item.id ? 'bg-emerald-500/15 font-semibold text-emerald-300 ring-1 ring-emerald-500/20' : 'text-slate-300 hover:bg-slate-800'}`}>{item.icon}<span>{item.label}</span>{item.id === 'tickets' && overview?.openTickets ? <span className="mr-auto rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">{overview.openTickets}</span> : null}</button>)}</nav>
            <div className="mt-4 border-t border-slate-800 px-3 pt-4 text-[11px] leading-6 text-slate-500">این منو مستقل از داشبورد کاربران است. عملیات و آمار فقط از API واقعی سرور دریافت می‌شوند.</div>
          </aside>
          <section className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs text-emerald-400">ADMIN CONSOLE</p><h2 className="mt-1 text-2xl font-bold">{pageTitle}</h2></div><p className="text-xs text-slate-500">{overview ? `آخرین به‌روزرسانی: ${dateText(overview.generatedAt)}` : ''}</p></div>
            {loading ? <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-400">در حال دریافت اطلاعات مدیریتی از سرور...</div> : !isAdmin ? <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-100">دسترسی مدیر تأیید نشد. دسترسی این صفحه توسط سرور کنترل می‌شود.</div> : <>
              {section === 'overview' && <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric icon={<Users />} label="کل کاربران" value={overview?.users ?? 0} />
                  <Metric icon={<Building2 />} label="وب‌سایت‌های ثبت‌شده" value={overview?.sites ?? 0} />
                  <Metric icon={<LifeBuoy />} label="تیکت‌های پشتیبانی" value={overview?.tickets ?? 0} />
                  <Metric icon={<Clock />} label="تیکت‌های باز" value={overview?.openTickets ?? 0} />
                  <Metric icon={<Activity />} label="تلاش‌های تأیید کپچا در ۲۴ ساعت" value={overview?.requests24h ?? 0} />
                  <Metric icon={<CheckCircle2 />} label="تأییدشده در ۲۴ ساعت" value={overview?.passed24h ?? 0} />
                  <Metric icon={<AlertCircle />} label="مسدودشده در ۲۴ ساعت" value={overview?.blocked24h ?? 0} />
                  <Metric icon={<CheckCircle2 />} label="نرخ عبور ۲۴ ساعت" value={overview?.passRate24h ?? 0} suffix="%" />
                </div>
                <div className="grid gap-4 xl:grid-cols-3">{sections.filter(item => item.id !== 'overview').map(item => <button key={item.id} onClick={() => setSection(item.id)} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-right hover:border-emerald-500/40 hover:bg-slate-900">{item.icon}<span className="font-medium">{item.label}</span><span className="mr-auto text-slate-500">←</span></button>)}</div>
              </div>}
              {section === 'users' && <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50"><div className="border-b border-slate-800 p-4"><h3 className="font-semibold">فهرست کاربران</h3><p className="mt-1 text-xs text-slate-400">نمایش حداکثر ۵۰۰ حساب اخیر؛ بدون شناسه ورود یا اطلاعات محرمانه</p></div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-right text-sm"><thead className="bg-slate-950/70 text-xs text-slate-400"><tr><th className="p-3">نام</th><th className="p-3">ایمیل</th><th className="p-3">نقش</th><th className="p-3">تاریخ ایجاد</th></tr></thead><tbody>{users.map(user => <tr key={user.id} className="border-t border-slate-800"><td className="p-3">{user.name || '—'}</td><td className="p-3" dir="ltr">{user.email}</td><td className="p-3"><span className={user.role === 'ADMIN' ? 'text-emerald-300' : 'text-slate-300'}>{user.role}</span></td><td className="p-3 text-xs text-slate-400">{dateText(user.createdAt)}</td></tr>)}</tbody></table>{users.length === 0 && <p className="p-6 text-sm text-slate-400">کاربری یافت نشد.</p>}</div></div>}
              {section === 'sites' && <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50"><div className="border-b border-slate-800 p-4"><h3 className="font-semibold">وب‌سایت‌ها و تنظیمات کپچا</h3><p className="mt-1 text-xs text-slate-400">کلید محرمانه و هش آن عمداً نمایش داده نمی‌شوند.</p></div><div className="grid gap-3 p-4 md:grid-cols-2">{sites.map(site => <article key={site.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h4 className="font-semibold">{site.name}</h4><span className="rounded-md bg-slate-800 px-2 py-1 text-[10px]">{site.challengeDifficulty}</span></div><p className="mt-2 text-xs text-slate-400">مالک: <span dir="ltr">{site.ownerEmail}</span></p><p className="mt-3 break-all font-mono text-xs text-emerald-300">{site.siteKey}</p><p className="mt-2 text-xs text-slate-300">دامنه‌ها: {site.domains?.join(', ') || 'ثبت نشده'}</p><div className="mt-3 flex flex-wrap gap-2 text-[10px]"><span className="rounded-md bg-slate-800 px-2 py-1">محدودیت: {site.rateLimitPerMinute}/دقیقه</span><span className="rounded-md bg-slate-800 px-2 py-1">بررسی نامرئی: {site.invisibleEnabled ? 'فعال' : 'غیرفعال'}</span></div><p className="mt-3 text-[10px] text-slate-500">ایجاد: {dateText(site.createdAt)}</p></article>)}</div>{sites.length === 0 && <p className="p-6 text-sm text-slate-400">وب‌سایتی ثبت نشده است.</p>}</div>}
              {section === 'tickets' && <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)]">
                <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50"><div className="flex items-center justify-between border-b border-slate-800 p-4"><h3 className="font-semibold">صندوق پشتیبانی</h3><span className="text-xs text-slate-400">{tickets.length} تیکت</span></div><div className="max-h-[70vh] overflow-y-auto">{tickets.length === 0 ? <p className="p-6 text-sm text-slate-400">هنوز تیکتی ثبت نشده است.</p> : tickets.map(ticket => <button key={ticket.id} onClick={() => { setSelectedId(ticket.id); setStatus(ticket.status); }} className={`block w-full border-b border-slate-800/80 p-4 text-right hover:bg-slate-800/70 ${selectedId === ticket.id ? 'bg-emerald-500/10' : ''}`}><div className="flex items-start justify-between gap-3"><span className="font-medium">{ticket.subject}</span><span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[10px]">{ticket.status}</span></div><p className="mt-2 text-xs text-slate-400">کاربر: {ticket.userId} · {ticket.category} · اولویت {ticket.priority}</p><p className="mt-1 text-[10px] text-slate-500">{dateText(ticket.updatedAt)}</p></button>)}</div></section>
                <section className="rounded-2xl border border-slate-800 bg-slate-900/50">{!selected ? <div className="p-8 text-center text-sm text-slate-400">برای مشاهده گفتگو، یک تیکت انتخاب کنید.</div> : <><div className="border-b border-slate-800 p-4"><h3 className="font-semibold">{selected.subject}</h3><p className="mt-1 text-xs text-slate-400">شناسه: {selected.id} · {dateText(selected.createdAt)}</p></div><div className="max-h-[42vh] space-y-3 overflow-y-auto p-4">{(selected.messages || []).map(message => <div key={message.id} className={`rounded-xl border p-3 ${message.authorRole === 'ADMIN' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-slate-700 bg-slate-950/70'}`}><div className="mb-2 flex justify-between gap-3 text-[11px] text-slate-400"><span>{message.authorRole === 'ADMIN' ? 'مدیریت' : 'کاربر'}</span><span>{dateText(message.createdAt)}</span></div><p className="whitespace-pre-wrap break-words text-sm">{message.body}</p></div>)}</div><div className="space-y-3 border-t border-slate-800 p-4"><label className="block text-xs text-slate-400">وضعیت تیکت<select value={status} onChange={event => setStatus(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white">{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select></label><textarea value={reply} onChange={event => setReply(event.target.value)} rows={4} maxLength={5000} placeholder="پاسخ مدیر به کاربر..." className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none focus:border-emerald-500" /><button disabled={busy || reply.trim().length < 2} onClick={() => void sendReply()} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" />{busy ? 'در حال ارسال...' : 'ارسال پاسخ و ذخیره وضعیت'}</button></div></>}</section>
              </div>}
              {section === 'finance' && <div className="space-y-5">
                {financeError && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100">اطلاعات حسابداری بارگذاری نشد: {financeError}</div>}
                {!finance && !financeError && <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">در حال دریافت گزارش مالی...</div>}
                {finance && <>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Metric icon={<DollarSign />} label="کل درآمد تأییدشده (USDT)" value={Number(finance.totals.revenue_all || 0)} />
                    <Metric icon={<Wallet />} label="درآمد ماه جاری (USDT)" value={Number(finance.totals.revenue_month || 0)} />
                    <Metric icon={<CheckCircle2 />} label="پرداخت‌های موفق" value={Number(finance.totals.paid_invoices || 0)} />
                    <Metric icon={<Clock />} label="فاکتورهای در انتظار" value={Number(finance.totals.pending_invoices || 0)} />
                    <Metric icon={<Receipt />} label="فاکتورهای منقضی" value={Number(finance.totals.expired_invoices || 0)} />
                    <Metric icon={<Users />} label="اشتراک‌های فعال" value={Number(finance.subscriptions?.active || 0)} />
                    <Metric icon={<Users />} label="اشتراک‌های غیرفعال یا منقضی" value={Number(finance.subscriptions?.inactive || 0)} />
                    <Metric icon={<Activity />} label="پرداخت موفق در ماه جاری" value={Number(finance.totals.paid_this_month || 0)} />
                    <Metric icon={<Receipt />} label="فاکتورهای ۳۰ روز اخیر" value={Number(finance.totals.invoices_30d || 0)} />
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
                    <div className="border-b border-slate-800 p-4"><h3 className="font-semibold">درآمد بر اساس پلن</h3><p className="mt-1 text-xs text-slate-400">فقط فاکتورهای پرداخت‌شده و تأییدشده در شبکه</p></div>
                    <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead className="bg-slate-950/70 text-xs text-slate-400"><tr><th className="p-3">پلن</th><th className="p-3">خرید موفق</th><th className="p-3">درآمد (USDT)</th></tr></thead><tbody>{finance.plans.map(plan => <tr key={plan.plan_id} className="border-t border-slate-800"><td className="p-3 font-medium">{plan.plan_id}</td><td className="p-3">{plan.paid_count}</td><td className="p-3" dir="ltr">{Number(plan.revenue || 0).toFixed(2)}</td></tr>)}</tbody></table>{finance.plans.length === 0 && <p className="p-5 text-sm text-slate-400">هنوز خریدی ثبت نشده است.</p>}</div>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
                    <div className="border-b border-slate-800 p-4"><h3 className="font-semibold">توزیع وضعیت فاکتورها</h3><p className="mt-1 text-xs text-slate-400">همه وضعیت‌هایی که در پایگاه داده ثبت شده‌اند</p></div>
                    <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead className="bg-slate-950/70 text-xs text-slate-400"><tr><th className="p-3">وضعیت</th><th className="p-3">تعداد</th></tr></thead><tbody>{finance.statuses.map(item => <tr key={item.status} className="border-t border-slate-800"><td className="p-3">{item.status}</td><td className="p-3">{item.count}</td></tr>)}</tbody></table>{finance.statuses.length === 0 && <p className="p-5 text-sm text-slate-400">فاکتوری ثبت نشده است.</p>}</div>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
                    <div className="flex flex-col gap-3 border-b border-slate-800 p-4"><div><h3 className="font-semibold">دفتر فاکتورها و خرید اشتراک</h3><p className="mt-1 text-xs text-slate-400">گزارش کامل فاکتورها و وضعیت اشتراک‌ها؛ برای خروجی‌های بزرگ بازه تاریخ انتخاب کنید.</p></div><div className="flex flex-wrap items-end gap-2"><label className="text-xs text-slate-400">از تاریخ<input type="date" value={financeExportFrom} max={financeExportTo || undefined} onChange={event => setFinanceExportFrom(event.target.value)} className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" /></label><label className="text-xs text-slate-400">تا تاریخ<input type="date" value={financeExportTo} min={financeExportFrom || undefined} onChange={event => setFinanceExportTo(event.target.value)} className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" /></label><button onClick={() => void exportFinanceCsv()} disabled={financeExporting} className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">{financeExporting ? 'در حال ساخت خروجی...' : 'خروجی CSV کامل'}</button></div></div>
                    <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-right text-sm"><thead className="bg-slate-950/70 text-xs text-slate-400"><tr><th className="p-3">کاربر</th><th className="p-3">پلن</th><th className="p-3">مبلغ USDT</th><th className="p-3">وضعیت</th><th className="p-3">شناسه تراکنش</th><th className="p-3">تاریخ ایجاد</th><th className="p-3">تاریخ پرداخت</th></tr></thead><tbody>{finance.recentInvoices.map(invoice => <tr key={invoice.id} className="border-t border-slate-800"><td className="p-3" dir="ltr">{invoice.email}</td><td className="p-3">{invoice.plan_id}</td><td className="p-3" dir="ltr">{Number(invoice.amount_usdt || 0).toFixed(2)}</td><td className="p-3"><span className={invoice.status === 'paid' ? 'text-emerald-300' : invoice.status === 'pending' ? 'text-amber-300' : 'text-slate-400'}>{invoice.status}</span></td><td className="max-w-48 truncate p-3 font-mono text-xs" dir="ltr">{invoice.txid || '—'}</td><td className="p-3 text-xs text-slate-400">{dateText(invoice.created_at)}</td><td className="p-3 text-xs text-slate-400">{dateText(invoice.paid_at || '')}</td></tr>)}</tbody></table>{finance.recentInvoices.length === 0 && <p className="p-5 text-sm text-slate-400">فاکتوری ثبت نشده است.</p>}</div>
                  </div>
                  <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs leading-6 text-slate-400">{finance.accountingNote} آخرین به‌روزرسانی: {dateText(finance.generatedAt)}. این گزارش فعلاً درآمد ناخالص را نشان می‌دهد و کارمزد شبکه، بازپرداخت و هزینه عملیاتی را از آن کم نمی‌کند.</p>
                </>}
              </div>}
              {section === 'activity' && <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50"><div className="border-b border-slate-800 p-4"><h3 className="font-semibold">آخرین رویدادهای امنیتی</h3><p className="mt-1 text-xs text-slate-400">آخرین رویدادهای ثبت‌شده در API؛ حداکثر ۵۰ مورد</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-right text-sm"><thead className="bg-slate-950/70 text-xs text-slate-400"><tr><th className="p-3">نتیجه</th><th className="p-3">دامنه</th><th className="p-3">کلید سایت</th><th className="p-3">امتیاز</th><th className="p-3">خطاها</th><th className="p-3">زمان</th></tr></thead><tbody>{events.map(event => <tr key={event.id} className="border-t border-slate-800"><td className="p-3"><span className={event.success ? 'text-emerald-300' : 'text-rose-300'}>{event.success ? 'تأیید' : 'مسدود'}</span></td><td className="p-3">{event.hostname || '—'}</td><td className="max-w-48 truncate p-3 font-mono text-xs">{event.siteKey}</td><td className="p-3">{event.score}</td><td className="p-3 text-xs text-slate-400">{event.errorCodes?.join(', ') || '—'}</td><td className="p-3 text-xs text-slate-400">{dateText(event.createdAt)}</td></tr>)}</tbody></table>{events.length === 0 && <p className="p-6 text-sm text-slate-400">رویداد امنیتی ثبت نشده است.</p>}</div></div>}
            </>}
          </section>
        </div>
      </>}
    </main>
  </div></AutoTranslate>;
}
function Metric({ icon, label, value, suffix = '' }: { icon: React.ReactNode; label: string; value: number; suffix?: string }) {
  const language = sessionStorage.getItem('shieldcaptcha_admin_language') === 'fa' ? 'fa' : 'en';
  const displayLabel = translateAdminText(label, language);
  return <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><div className="mb-3 flex items-center justify-between text-slate-400"><span className="text-xs">{displayLabel}</span><span className="text-emerald-400">{icon}</span></div><strong className="text-2xl">{value}{suffix}</strong></div>;
}
