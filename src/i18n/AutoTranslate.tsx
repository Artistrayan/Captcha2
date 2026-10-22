import React from 'react';
import { translations, LanguageCode } from './translations.ts';

// Translate static UI text that was previously hard-coded instead of using t(key).
// Dynamic user content and code examples are intentionally preserved.
const extraFa: Record<string, string> = {
  'Support Center': 'مرکز پشتیبانی',
  'Create a support ticket, track its status, and reply in one place. Do not include passwords, secret keys, or wallet private keys.': 'درخواست پشتیبانی ثبت کنید، وضعیت آن را پیگیری کنید و پاسخ‌ها را همین‌جا ببینید. گذرواژه، کلید محرمانه یا کلید خصوصی کیف پول را وارد نکنید.',
  'Open a new ticket': 'ثبت درخواست جدید', 'Subject': 'موضوع', 'Briefly describe the issue': 'مشکل را کوتاه توضیح دهید',
  'Category': 'دسته‌بندی', 'General': 'عمومی', 'Technical issue': 'مشکل فنی', 'Billing / subscription': 'پرداخت / اشتراک',
  'Security': 'امنیت', 'Priority': 'اولویت', 'Low': 'کم', 'Normal': 'عادی', 'High': 'زیاد', 'Urgent': 'فوری',
  'Message': 'پیام', 'Explain what happened and what you expected...': 'شرح دهید چه اتفاقی افتاده و انتظار شما چه بوده است...',
  'Submit ticket': 'ثبت درخواست', 'All support tickets': 'همه درخواست‌های پشتیبانی', 'Your support tickets': 'درخواست‌های پشتیبانی شما',
  'Refresh': 'بارگذاری مجدد', 'No support tickets yet.': 'هنوز درخواست پشتیبانی ثبت نشده است.',
  'priority': 'اولویت', 'messages': 'پیام', 'Write a reply...': 'پاسخ خود را بنویسید...',
  'In progress': 'در حال بررسی', 'Waiting for user': 'در انتظار کاربر', 'Resolved': 'حل‌شده', 'Closed': 'بسته‌شده', 'Send reply': 'ارسال پاسخ',
  'Crypto Payments & Subscriptions': 'پرداخت رمزارزی و اشتراک‌ها',
  'USDT payments are accepted on the TRON (TRC20) network only. A subscription activates only after independent on-chain transaction verification.': 'پرداخت USDT فقط از طریق شبکه TRON (TRC20) پذیرفته می‌شود. اشتراک پس از تأیید مستقل تراکنش روی بلاک‌چین فعال خواهد شد.',
  'Exact amount': 'مبلغ دقیق', 'Network & expiry': 'شبکه و زمان انقضا', 'Receiving address (TRC20 only)': 'آدرس دریافت (فقط TRC20)',
  'Copied': 'کپی شد', 'Copy wallet address': 'کپی آدرس کیف پول',
  'Send the exact amount. Using the wrong network or token may result in loss of funds. Never enter a wallet private key.': 'دقیقاً همین مبلغ را ارسال کنید. انتخاب شبکه یا توکن اشتباه ممکن است باعث از دست رفتن دارایی شود. هرگز کلید خصوصی کیف پول را وارد نکنید.',
  'Transaction ID (TXID)': 'شناسه تراکنش (TXID)', '64-character transaction ID': 'شناسه تراکنش ۶۴ کاراکتری',
  'Verify payment on blockchain': 'تأیید پرداخت در بلاک‌چین', 'Payment confirmed.': 'پرداخت تأیید شد.',
  'Recent Invoices': 'فاکتورهای اخیر', 'No invoices yet.': 'هنوز فاکتوری وجود ندارد.',
  'Loading websites from the database...': 'در حال بارگذاری وب‌سایت‌ها از پایگاه داده...',
  'Test in Playground': 'آزمایش در محیط تست', 'Server-verified response:': 'پاسخ تأییدشده توسط سرور:',
  'Four incorrect answers are allowed; the fifth attempt should be rejected': 'چهار پاسخ اشتباه مجاز است؛ تلاش پنجم باید رد شود',
  'Verify that an invalid test Secret Key is rejected; the real key is never sent to the browser': 'بررسی کنید کلید محرمانه آزمایشی نامعتبر رد شود؛ کلید واقعی هرگز به مرورگر ارسال نمی‌شود',
  'Pass rate': 'نرخ موفقیت', 'Embed the widget in your website form (React / HTML)': 'افزودن ویجت به فرم وب‌سایت (React / HTML)',
  'Server-to-server verification (Node.js / Express)': 'تأیید سرور به سرور (Node.js / Express)',
  'Register New Website': 'ثبت وب‌سایت جدید', 'Website or project name:': 'نام وب‌سایت یا پروژه:',
  'e.g. My Online Store': 'مثلاً فروشگاه آنلاین من', 'localhost, example.com, app.example.com': 'localhost, example.com, app.example.com',
  'Create and retrieve keys': 'ایجاد و دریافت کلیدها', 'Critical security warning:': 'هشدار امنیتی مهم:',
  'Public Site Key:': 'کلید عمومی سایت:', 'Secure Dashboard Sign-In': 'ورود امن به پنل مدیریت',
  'Account email': 'ایمیل حساب', 'Storage:': 'ذخیره‌سازی:', 'Authentication:': 'احراز هویت:',
  'Database unavailable': 'پایگاه داده در دسترس نیست', 'Firebase not configured': 'Firebase پیکربندی نشده است',
  'Development JWT': 'توکن توسعه JWT', 'VITE_FIREBASE_API_KEY is not set in the build configuration.': 'متغیر VITE_FIREBASE_API_KEY در تنظیمات ساخت تعریف نشده است.',
  'Server-side Firebase Admin is not ready; check the Firebase configuration.': 'Firebase Admin سمت سرور آماده نیست؛ تنظیمات Firebase را بررسی کنید.',
  'Server-side Firebase Admin is not ready; check FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_KEY settings.': 'Firebase Admin سمت سرور آماده نیست؛ تنظیمات FIREBASE_PROJECT_ID و FIREBASE_SERVICE_ACCOUNT_KEY را بررسی کنید.',
  'India': 'هند', 'China': 'چین', 'United States': 'ایالات متحده', 'Indonesia': 'اندونزی',
  'Pakistan': 'پاکستان', 'Nigeria': 'نیجریه', 'Brazil': 'برزیل', 'Bangladesh': 'بنگلادش', 'Russia': 'روسیه', 'Ethiopia': 'اتیوپی',
  'Secure admin sign-in': 'ورود امن به پنل مدیریت',
  'This page is separate from the user dashboard. Admin access is checked by the server after sign-in.': 'این صفحه از داشبورد کاربران جداست. دسترسی مدیر پس از ورود، توسط سرور بررسی می‌شود.',
  'Admin email': 'ایمیل مدیر',
  'Password': 'گذرواژه',
  'Checking...': 'در حال بررسی...',
  'Sign in to admin console': 'ورود به پنل مدیریت',
  'This email is not registered in Firebase.': 'این ایمیل در Firebase ثبت نشده است.',
  'Incorrect password.': 'گذرواژه نادرست است.',
  'Incorrect email or password.': 'ایمیل یا گذرواژه نادرست است.',
  'This account has been disabled.': 'این حساب غیرفعال شده است.',
  'Too many attempts; try again later.': 'تلاش‌های زیادی انجام شده؛ کمی بعد دوباره امتحان کنید.',
  'Sign-in failed. Check Firebase settings.': 'ورود انجام نشد. تنظیمات Firebase را بررسی کنید.',
  'Firebase public API key is not configured in the app build settings.': 'کلید عمومی Firebase در تنظیمات Build برنامه تنظیم نشده است.',
  'Sign-in failed.': 'ورود انجام نشد.',
  'If sign-in succeeds but admin access is denied, ADMIN_EMAIL in the Render service environment must match this account email.': 'اگر ورود موفق بود اما پیام نداشتن دسترسی مدیر دیدید، مقدار ADMIN_EMAIL در Environment Variables سرویس Render باید با ایمیل همین حساب یکسان باشد.',
  'Back to app': 'بازگشت به برنامه',
  'System overview': 'نمای کلی سامانه',
  'User management': 'مدیریت کاربران',
  'Websites & keys': 'وب‌سایت‌ها و کلیدها',
  'Support tickets': 'تیکت‌های پشتیبانی',
  'Security events': 'رویدادهای امنیتی',
  'Accounting & subscriptions': 'حسابداری و اشتراک‌ها',
  'Admin console': 'پنل مدیریت',
  'ShieldCaptcha Admin Center': 'مرکز مدیریت ShieldCaptcha',
  'Manage users, websites, security activity, and support': 'کنترل کاربران، وب‌سایت‌ها، فعالیت امنیتی و پشتیبانی',
  'Main application': 'صفحه اصلی برنامه',
  
  'Sign out': 'خروج',
  'Sign in to the administrator account first': 'ابتدا وارد حساب مدیر شوید',
  'Sign in on the main page with the admin account ': 'از صفحه اصلی با حساب مدیریتی ',
  ' and then open this page.': ' وارد شوید و سپس این صفحه را باز کنید.',
  'Go to sign-in': 'رفتن به صفحه ورود',
  'Admin menu': 'منوی مدیریت',
  'This menu is independent from the user dashboard. Operations and metrics come only from the real server API.': 'این منو مستقل از داشبورد کاربران است. عملیات و آمار فقط از API واقعی سرور دریافت می‌شوند.',
  'Last updated: ': 'آخرین به‌روزرسانی: ',
  'Loading admin data from server...': 'در حال دریافت اطلاعات مدیریتی از سرور...',
  'Admin access was not confirmed. This page is protected by the server.': 'دسترسی مدیر تأیید نشد. دسترسی این صفحه توسط سرور کنترل می‌شود.',
  'Total users': 'کل کاربران',
  'Registered websites': 'وب‌سایت‌های ثبت‌شده',
  'Open tickets': 'تیکت‌های باز',
  'Requests in 24 hours': 'درخواست‌های ۲۴ ساعت',
  'Passed in 24 hours': 'تأییدشده در ۲۴ ساعت',
  'Blocked in 24 hours': 'مسدودشده در ۲۴ ساعت',
  'Pass rate (24 hours)': 'نرخ عبور ۲۴ ساعت',
  'User list': 'فهرست کاربران',
  'Showing up to 500 recent accounts; no login identifiers or secret data': 'نمایش حداکثر ۵۰۰ حساب اخیر؛ بدون شناسه ورود یا اطلاعات محرمانه',
  'Name': 'نام',
  'Email': 'ایمیل',
  'Role': 'نقش',
  'Created date': 'تاریخ ایجاد',
  'No users found.': 'کاربری یافت نشد.',
  'Websites & CAPTCHA settings': 'وب‌سایت‌ها و تنظیمات کپچا',
  'Secret keys and hashes are intentionally hidden.': 'کلید محرمانه و هش آن عمداً نمایش داده نمی‌شوند.',
  'Owner: ': 'مالک: ',
  'Domains: ': 'دامنه‌ها: ',
  'Not registered': 'ثبت نشده',
  'Limit: ': 'محدودیت: ',
  '/minute': '/دقیقه',
  'Invisible check: ': 'بررسی نامرئی: ',
  'Enabled': 'فعال',
  'Disabled': 'غیرفعال',
  'Created: ': 'ایجاد: ',
  'No websites registered.': 'وب‌سایتی ثبت نشده است.',
  'Support inbox': 'صندوق پشتیبانی',
  ' tickets': ' تیکت',
  'No tickets have been submitted yet.': 'هنوز تیکتی ثبت نشده است.',
  'User: ': 'کاربر: ',
  'Priority ': 'اولویت ',
  'Select a ticket to view the conversation.': 'برای مشاهده گفتگو، یک تیکت انتخاب کنید.',
  'ID: ': 'شناسه: ',
  'Admin': 'مدیریت',
  'Ticket status': 'وضعیت تیکت',
  'Reply to user...': 'پاسخ مدیر به کاربر...',
  'Sending...': 'در حال ارسال...',
  'Send reply and save status': 'ارسال پاسخ و ذخیره وضعیت',
  'Accounting data failed to load: ': 'اطلاعات حسابداری بارگذاری نشد: ',
  'Loading financial report...': 'در حال دریافت گزارش مالی...',
  'Total confirmed revenue (USDT)': 'کل درآمد تأییدشده (USDT)',
  'Current month revenue (USDT)': 'درآمد ماه جاری (USDT)',
  'Successful payments': 'پرداخت‌های موفق',
  'Pending invoices': 'فاکتورهای در انتظار',
  'Expired invoices': 'فاکتورهای منقضی',
  'Active subscriptions': 'اشتراک‌های فعال',
  'Inactive or expired subscriptions': 'اشتراک‌های غیرفعال یا منقضی',
  'Successful payments this month': 'پرداخت موفق در ماه جاری',
  'Invoices in the last 30 days': 'فاکتورهای ۳۰ روز اخیر',
  'Revenue by plan': 'درآمد بر اساس پلن',
  'Only invoices paid and confirmed on-chain': 'فقط فاکتورهای پرداخت‌شده و تأییدشده در شبکه',
  'Plan': 'پلن',
  'Successful purchases': 'خرید موفق',
  'Revenue (USDT)': 'درآمد (USDT)',
  'No purchases yet.': 'هنوز خریدی ثبت نشده است.',
  'Invoice status distribution': 'توزیع وضعیت فاکتورها',
  'All statuses recorded in the database': 'همه وضعیت‌هایی که در پایگاه داده ثبت شده‌اند',
  'Status': 'وضعیت',
  'Count': 'تعداد',
  'No invoices recorded.': 'فاکتوری ثبت نشده است.',
  'Invoice ledger and subscription purchases': 'دفتر فاکتورها و خرید اشتراک',
  'Up to 100 recent invoices with payment status': 'حداکثر ۱۰۰ فاکتور اخیر، همراه با وضعیت پرداخت',
  'Export invoices CSV': 'خروجی CSV فاکتورها',
  'User': 'کاربر',
  'Amount USDT': 'مبلغ USDT',
  'Transaction ID': 'شناسه تراکنش',
  'Payment date': 'تاریخ پرداخت',
  'Latest update: ': 'آخرین به‌روزرسانی: ',
  'This report currently shows gross revenue and does not subtract network fees, refunds, or operating costs.': 'این گزارش فعلاً درآمد ناخالص را نشان می‌دهد و کارمزد شبکه، بازپرداخت و هزینه عملیاتی را از آن کم نمی‌کند.',
  'Latest security events': 'آخرین رویدادهای امنیتی',
  'Last recorded API events; up to 50 items': 'آخرین رویدادهای ثبت‌شده در API؛ حداکثر ۵۰ مورد',
  'Result': 'نتیجه',
  'Domain': 'دامنه',
  'Site key': 'کلید سایت',
  'Score': 'امتیاز',
  'Errors': 'خطاها',
  'Time': 'زمان',
  'No security events recorded.': 'رویداد امنیتی ثبت نشده است.',
  'Session is invalid. Sign in again from the main page.': 'نشست ورود معتبر نیست. از صفحه اصلی دوباره وارد شوید.',
  'This account is not authorized to manage the system.': 'این حساب مجوز مدیریت سامانه را ندارد.',
  'Could not retrieve data.': 'دریافت اطلاعات ناموفق بود.',
  'Could not retrieve accounting data.': 'دریافت اطلاعات حسابداری ناموفق بود.',
  'Unknown error while loading data': 'خطای ناشناخته هنگام دریافت اطلاعات',
  'Failed to send reply.': 'ارسال پاسخ ناموفق بود.',
  'Verified': 'تأیید',
  'Blocked': 'مسدود',
  'Ticket ID: ': 'شناسه: '
};

function translateNode(node: React.ReactNode, lang: LanguageCode): React.ReactNode {
  if (lang !== 'fa' && lang !== 'en') return node;
  const lookup = new Map<string, string>();
  Object.keys(translations.en).forEach(key => {
    const english = translations.en[key];
    const persian = translations.fa[key];
    if (english && persian) {
      if (lang === 'fa') lookup.set(english, persian);
      else lookup.set(persian, english);
    }
  });
  Object.entries(extraFa).forEach(([english, persian]) => {
    if (lang === 'fa') lookup.set(english, persian);
    else lookup.set(persian, english);
  });
  const walk = (child: React.ReactNode): React.ReactNode => {
    if (typeof child === 'string') return lookup.get(child) || child;
    if (Array.isArray(child)) return child.map(walk);
    if (!React.isValidElement(child)) return child;
    const typeName = typeof child.type === 'string' ? child.type.toLowerCase() : '';
    if (['pre', 'code', 'script', 'style', 'textarea'].includes(typeName)) return child;
    const props = child.props as Record<string, unknown>;
    const nextProps: Record<string, unknown> = {};
    ['placeholder', 'title', 'aria-label'].forEach(attr => {
      const value = props[attr];
      if (typeof value === 'string') nextProps[attr] = lookup.get(value) || value;
    });
    if (props.children !== undefined) nextProps.children = walk(props.children as React.ReactNode);
    return React.cloneElement(child as React.ReactElement<any>, nextProps);
  };
  return walk(node);
}

export function translateAdminText(text: string, lang: LanguageCode): string {
  const translated = translateNode(text, lang);
  return typeof translated === 'string' ? translated : text;
}

export const AutoTranslate: React.FC<{ lang: LanguageCode; children: React.ReactNode }> = ({ lang, children }) =>
  <>{translateNode(children, lang)}</>;
