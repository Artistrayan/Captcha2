import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Clock, LifeBuoy, LogOut, RefreshCw, Send, ShieldCheck } from 'lucide-react';

type TicketMessage = { id: string; authorId: string; authorRole: string; body: string; createdAt: string };
type Ticket = { id: string; userId: string; subject: string; category: string; priority: string; status: string; messages: TicketMessage[]; createdAt: string; updatedAt: string };
const statuses = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];

export default function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem('shieldcaptcha_id_token') || '');
  const [email] = useState(() => sessionStorage.getItem('shieldcaptcha_user_email') || '');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('open');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const selected = tickets.find(ticket => ticket.id === selectedId);

  const loadTickets = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/v1/support/tickets', { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (response.status === 401) throw new Error('نشست ورود معتبر نیست. ابتدا از صفحه اصلی وارد حساب شوید.');
      if (!response.ok) throw new Error(data.error || 'بارگذاری تیکت‌ها ناموفق بود.');
      if (!data.isAdmin) throw new Error('این حساب دسترسی مدیر ندارد.');
      const next: Ticket[] = data.tickets || [];
      setTickets(next); setIsAdmin(true);
      const active = next.find(t => t.id === selectedId) || next[0];
      setSelectedId(active?.id || '');
      if (active) setStatus(active.status);
    } catch (err) {
      setIsAdmin(false); setError(err instanceof Error ? err.message : 'خطای ناشناخته');
    } finally { setLoading(false); }
  }, [token, selectedId]);

  useEffect(() => { void loadTickets(); }, [loadTickets]);

  const sendReply = async () => {
    if (!selected || reply.trim().length < 2) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/support/tickets/${encodeURIComponent(selected.id)}/replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: reply.trim(), status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'ارسال پاسخ ناموفق بود.');
      setReply(''); await loadTickets();
    } catch (err) { setError(err instanceof Error ? err.message : 'ارسال پاسخ ناموفق بود.'); }
    finally { setBusy(false); }
  };

  const signOut = () => {
    sessionStorage.removeItem('shieldcaptcha_id_token'); sessionStorage.removeItem('shieldcaptcha_user_email');
    setToken(''); setTickets([]); setIsAdmin(false); window.location.href = '/';
  };

  return <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-100">
    <header className="border-b border-slate-800 bg-slate-900/80"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-400"><ShieldCheck className="h-6 w-6" /></div><div><h1 className="text-xl font-bold">پنل مدیریت ShieldCaptcha</h1><p className="mt-1 text-xs text-slate-400">مدیریت پشتیبانی و درخواست‌های کاربران</p></div></div>
      <div className="flex items-center gap-2"><a href="/" className="rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800">بازگشت به برنامه</a>{token && <button onClick={signOut} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800"><LogOut className="h-4 w-4" />خروج</button>}</div>
    </div></header>
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      {!token ? <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6"><AlertCircle className="mb-3 h-6 w-6 text-amber-400" /><h2 className="font-semibold">ابتدا وارد حساب مدیر شوید</h2><p className="my-3 text-sm text-slate-300">از صفحه اصلی با حساب {email || 'مدیر'} وارد شوید، سپس این صفحه را دوباره باز کنید.</p><a href="/" className="inline-flex rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">رفتن به صفحه ورود</a></section> : <>
        {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={<LifeBuoy />} label="همه تیکت‌ها" value={tickets.length} />
          <Metric icon={<Clock />} label="باز" value={tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length} />
          <Metric icon={<Activity />} label="در انتظار پاسخ کاربر" value={tickets.filter(t => t.status === 'waiting_user').length} />
          <Metric icon={<CheckCircle2 />} label="حل‌شده یا بسته" value={tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length} />
        </div>
        {loading ? <div className="rounded-xl border border-slate-800 p-8 text-center text-sm text-slate-400">در حال بررسی دسترسی و بارگذاری اطلاعات واقعی...</div> : !isAdmin ? <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-100">دسترسی مدیر تأیید نشد. باز کردن این آدرس به‌تنهایی دسترسی ایجاد نمی‌کند.</div> :
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
          <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50"><div className="flex items-center justify-between border-b border-slate-800 p-4"><h2 className="font-semibold">صندوق پشتیبانی</h2><button onClick={() => void loadTickets()} className="rounded-lg border border-slate-700 p-2 hover:bg-slate-800" title="بروزرسانی"><RefreshCw className="h-4 w-4" /></button></div>
            <div className="max-h-[65vh] overflow-y-auto">{tickets.length === 0 ? <p className="p-6 text-sm text-slate-400">هنوز تیکتی ثبت نشده است.</p> : tickets.map(ticket => <button key={ticket.id} onClick={() => { setSelectedId(ticket.id); setStatus(ticket.status); }} className={`block w-full border-b border-slate-800/80 p-4 text-right hover:bg-slate-800/70 ${selectedId === ticket.id ? 'bg-emerald-500/10' : ''}`}>
              <div className="flex items-start justify-between gap-3"><span className="font-medium">{ticket.subject}</span><span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[10px]">{ticket.status}</span></div><p className="mt-2 text-xs text-slate-400">کاربر: {ticket.userId} · {ticket.category} · اولویت {ticket.priority}</p><p className="mt-1 text-[10px] text-slate-500">{new Date(ticket.updatedAt).toLocaleString('fa-IR')}</p>
            </button>)}</div>
          </section>
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50">{!selected ? <div className="p-8 text-center text-sm text-slate-400">برای مشاهده گفتگو، یک تیکت انتخاب کنید.</div> : <>
            <div className="border-b border-slate-800 p-4"><h2 className="font-semibold">{selected.subject}</h2><p className="mt-1 text-xs text-slate-400">شناسه: {selected.id} · {new Date(selected.createdAt).toLocaleString('fa-IR')}</p></div>
            <div className="max-h-[42vh] space-y-3 overflow-y-auto p-4">{(selected.messages || []).map(message => <div key={message.id} className={`rounded-xl border p-3 ${message.authorRole === 'ADMIN' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-slate-700 bg-slate-950/70'}`}><div className="mb-2 flex justify-between gap-3 text-[11px] text-slate-400"><span>{message.authorRole === 'ADMIN' ? 'پشتیبانی' : 'کاربر'}</span><span>{new Date(message.createdAt).toLocaleString('fa-IR')}</span></div><p className="whitespace-pre-wrap break-words text-sm">{message.body}</p></div>)}</div>
            <div className="space-y-3 border-t border-slate-800 p-4"><label className="block text-xs text-slate-400">وضعیت تیکت<select value={status} onChange={e => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white">{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select></label><textarea value={reply} onChange={e => setReply(e.target.value)} rows={4} maxLength={5000} placeholder="پاسخ مدیر به کاربر..." className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none focus:border-emerald-500" /><button disabled={busy || reply.trim().length < 2} onClick={() => void sendReply()} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" />{busy ? 'در حال ارسال...' : 'ارسال پاسخ و ذخیره وضعیت'}</button></div>
          </>}</section>
        </div>}
      </>}
      <p className="text-center text-xs text-slate-600">این پنل فقط داده‌های برگشتی از API را نمایش می‌دهد و آمار ساختگی تولید نمی‌کند.</p>
    </main>
  </div>;
}
function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><div className="mb-3 flex items-center justify-between text-slate-400"><span className="text-xs">{label}</span><span className="text-emerald-400">{icon}</span></div><strong className="text-2xl">{value}</strong></div>;
}