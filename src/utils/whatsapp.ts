/**
 * Builds the official wa.me link to open a WhatsApp conversation, with an
 * optional prefilled message. This is the only supported way this app
 * talks to WhatsApp — no automation, no scraping, no WhatsApp Web control.
 */
export function buildWhatsAppLink(fullPhoneDigits: string, message?: string): string {
  const trimmed = message?.trim();
  if (!trimmed) return `https://wa.me/${fullPhoneDigits}`;
  return `https://wa.me/${fullPhoneDigits}?text=${encodeURIComponent(trimmed)}`;
}

/**
 * True when the app is running installed to the home screen (iOS "Add to
 * Home Screen" or Android/desktop's `display: standalone`), as opposed to
 * a normal browser tab.
 */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayModeStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  return iosStandalone || displayModeStandalone;
}

/**
 * Opens the WhatsApp link.
 *
 * In a normal browser tab, `window.open` is used so the app keeps its own
 * tab and WhatsApp opens in a new one — the nicer desktop/browser
 * behavior.
 *
 * Inside a standalone home-screen app there is no "new tab" to open into.
 * `window.open` in that context is unreliable — it can fail to create a
 * real browsing context and leave the app's own webview in a broken,
 * blank state. Navigating the current webview directly (`location.href`)
 * lets the OS hand off to the WhatsApp app through its universal/app
 * link cleanly, and our own page resumes normally when the person
 * switches back (see the pageshow/visibility recovery in App.tsx and
 * Home.tsx).
 */
export function openWhatsApp(fullPhoneDigits: string, message?: string): void {
  const url = buildWhatsAppLink(fullPhoneDigits, message);
  if (isStandalonePwa()) {
    window.location.href = url;
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
