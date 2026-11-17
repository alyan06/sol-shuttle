/**
 * Light, dark, or whatever the phone is set to. The choice is kept on the device (it's about this
 * screen, not the person) and put on <html> before the first paint by the script in app/layout.tsx.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'shuttle.theme';
export const THEME_EVENT = 'shuttle:theme';

/** Runs before the page paints, so a saved choice never flashes the other theme first. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export function storedTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** Whether the page is showing dark right now, whichever way it got there. */
export function showingDark(): boolean {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'dark') return true;
  if (chosen === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private browsing: the choice lasts for this visit.
  }
  // The browser's own chrome (status bar, address bar) follows the page.
  const colour = getComputedStyle(document.documentElement).getPropertyValue('--chrome').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', colour));
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Calls back whenever what's showing changes: the choice here, or the phone's own setting. */
export function onThemeChange(listener: () => void): () => void {
  const media = matchMedia('(prefers-color-scheme: dark)');
  window.addEventListener(THEME_EVENT, listener);
  media.addEventListener('change', listener);
  return () => {
    window.removeEventListener(THEME_EVENT, listener);
    media.removeEventListener('change', listener);
  };
}
