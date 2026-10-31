import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { AuthProvider } from './auth/AuthProvider.tsx';
import { AuthDialogProvider } from './components/AuthDialog.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { I18nProvider } from './i18n/index.tsx';
import { SettingsProvider } from './settings/SettingsProvider.tsx';
import { ThemeProvider } from './theme/ThemeProvider.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <SettingsProvider>
          <ToastProvider>
            <AuthProvider>
              <AuthDialogProvider>
                <App />
              </AuthDialogProvider>
            </AuthProvider>
          </ToastProvider>
        </SettingsProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
