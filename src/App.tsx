import { useEffect } from 'react';
import { useAuth } from './auth/AuthProvider.tsx';
import { Header, BottomNav } from './components/Header.tsx';
import { SplashLoader } from './components/States.tsx';
import { ChallengeInbox } from './components/Lobby.tsx';
import { useI18n } from './i18n/index.tsx';
import { Friends } from './pages/Friends.tsx';
import { Game } from './pages/Game.tsx';
import { Home } from './pages/Home.tsx';
import { Leaderboard } from './pages/Leaderboard.tsx';
import { Play } from './pages/Play.tsx';
import { Profile } from './pages/Profile.tsx';
import { Settings } from './pages/Settings.tsx';
import { Shop } from './pages/Shop.tsx';
import { Inventory } from './pages/Inventory.tsx';
import { Wallet } from './pages/Wallet.tsx';
import { Admin } from './pages/Admin.tsx';
import { Live } from './pages/Live.tsx';
import { Watch } from './pages/Watch.tsx';
import { Archive } from './pages/Archive.tsx';
import { VirtualProfile } from './pages/VirtualProfile.tsx';
import { AchievementsPage } from './components/Achievements.tsx';
import { About, Blocked, Feedback, Help } from './pages/Info.tsx';
import { Link, useRoute } from './router.tsx';

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="page">
      <div className="card state">
        <div className="state-title">{t('notFound.title')}</div>
        <Link to="/" className="btn btn-primary">
          {t('nav.home')}
        </Link>
      </div>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const { ready, tgError } = useAuth();
  const { t } = useI18n();
  const top = route.segments[0] ?? '';

  useEffect(() => {
    document.title = `DAMEO — ${t('brand.tagline')}`;
  }, [t]);

  if (!ready) return <SplashLoader />;

  let page;
  switch (top) {
    case '':
      page = <Home />;
      break;
    case 'play':
      page = <Play />;
      break;
    case 'game':
      page = <Game />;
      break;
    case 'leaderboard':
      page = <Leaderboard />;
      break;
    case 'tournaments':
      page = <Leaderboard initialTab="tournaments" />;
      break;
    case 'friends':
      page = <Friends />;
      break;
    case 'profile':
      page = <Profile />;
      break;
    case 'achievements':
      page = <AchievementsPage />;
      break;
    case 'vp':
      page = <VirtualProfile />;
      break;
    case 'settings':
      page = <Settings />;
      break;
    case 'shop':
      page = <Shop />;
      break;
    case 'inventory':
      page = <Inventory />;
      break;
    case 'wallet':
      page = <Wallet />;
      break;
    case 'admin':
      page = <Admin />;
      break;
    case 'live':
      page = <Live />;
      break;
    case 'watch':
      page = <Watch />;
      break;
    case 'archive':
      page = <Archive />;
      break;
    case 'help':
      page = <Help />;
      break;
    case 'about':
      page = <About />;
      break;
    case 'feedback':
      page = <Feedback />;
      break;
    case 'blocked':
      page = <Blocked />;
      break;
    default:
      page = <NotFound />;
  }
  return (
    <div className="app">
      <a href="#main" className="skip-link" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        {t('a11y.skip')}
      </a>
      <div className="ambient" aria-hidden="true" />
      <Header />
      {tgError && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="notice notice-warn" role="alert">
            {tgError === 'bot-token-missing' ? t('auth.tgTokenMissing') : t('auth.tgFailed', { err: tgError })}
          </div>
        </div>
      )}
      <main id="main" tabIndex={-1} key={route.path} className="main page-enter">
        {page}
      </main>
      <footer className="footer">
        <span>© DAMEO · {t('brand.tagline')}</span>
        <span className="muted">{t('footer.free')}</span>
      </footer>
      <ChallengeInbox />
      <BottomNav />
    </div>
  );
}
