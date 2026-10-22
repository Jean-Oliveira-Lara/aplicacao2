import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import Home from './pages/Home';
import Recentes from './pages/Recentes';

export default function App() {
  useEffect(() => {
    // Recovery for the "blank screen after returning from WhatsApp" bug in
    // standalone home-screen apps: iOS/Android sometimes restore the page
    // from the back-forward cache (bfcache) instead of doing a normal
    // reload after the webview comes back from the background. When that
    // restore happens, `pageshow` fires with `event.persisted === true`.
    // A bfcache-restored page inside a standalone webview can come back in
    // a broken, blank render — a plain reload is the reliable fix (not a
    // CSS/visual patch): it forces the whole app to boot fresh from a
    // known-good state instead of resuming a possibly-corrupted one.
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        window.location.reload();
      }
    }
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/recentes" element={<Recentes />} />
      </Routes>
    </AppShell>
  );
}
