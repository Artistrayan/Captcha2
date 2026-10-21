import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AdminPanel from './components/AdminPanel.tsx';
import { LanguageProvider } from './i18n/LanguageContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    {(window.location.pathname === '/admin' || window.location.pathname === '/admin/') ? <AdminPanel /> : <App />}
  </LanguageProvider>
);
