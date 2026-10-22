import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AdminEntry from './components/AdminEntry.tsx';
import { LanguageProvider } from './i18n/LanguageContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    {(window.location.pathname === '/admin' || window.location.pathname === '/admin/') ? <AdminEntry /> : <App />}
  </LanguageProvider>
);
