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
  'Pakistan': 'پاکستان', 'Nigeria': 'نیجریه', 'Brazil': 'برزیل', 'Bangladesh': 'بنگلادش', 'Russia': 'روسیه', 'Ethiopia': 'اتیوپی'
};

function translateNode(node: React.ReactNode, lang: LanguageCode): React.ReactNode {
  if (lang !== 'fa') return node;
  const lookup = new Map<string, string>();
  Object.keys(translations.en).forEach(key => {
    const source = translations.en[key];
    const target = translations.fa[key];
    if (source && target) lookup.set(source, target);
  });
  Object.entries(extraFa).forEach(([source, target]) => lookup.set(source, target));
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
    return React.cloneElement(child, nextProps);
  };
  return walk(node);
}

export const AutoTranslate: React.FC<{ lang: LanguageCode; children: React.ReactNode }> = ({ lang, children }) =>
  <>{translateNode(children, lang)}</>;
