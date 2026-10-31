import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { AuthProvider } from './auth/AuthProvider.tsx';
import { AuthDialogProvider } from './components/AuthDialog.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { I18nProvider } from './i18n/index.tsx';
import { SettingsProvider } from './settings/SettingsProvider.tsx';
import { ThemeProvider } from './theme/ThemeProvider.tsx';

class CrashGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    (window as any).__dameoCrashed = true;
    (window as any).__dameoBootError?.(`${error.name}: ${error.message}`);
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashGuard>
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
    </CrashGuard>
  </StrictMode>,
);
