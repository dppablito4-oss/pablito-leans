// Apply the saved theme before styles paint; theme changes only affect the UI.
(function initializeTheme() {
  const storageKey = 'pablito-leans-theme';
  const root = document.documentElement;
  let transitionRevision = 0;

  function applyTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    const revision = ++transitionRevision;
    root.classList.add('theme-switching');
    root.dataset.theme = selected;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = selected === 'light' ? '#F3F6F5' : '#000000';
    updateButton();
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: selected } }));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (revision === transitionRevision) root.classList.remove('theme-switching');
    }));
  }

  function updateButton() {
    const button = document.getElementById('btn-theme-toggle');
    if (!button) return;
    const light = root.dataset.theme === 'light';
    const label = light ? 'Cambiar a modo oscuro AMOLED' : 'Cambiar a modo claro';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.querySelector('.theme-toggle__label').textContent = light ? 'Oscuro' : 'Claro';
  }

  let storedTheme = 'dark';
  try { storedTheme = localStorage.getItem(storageKey) || 'dark'; } catch { /* Use the default when storage is unavailable. */ }
  applyTheme(storedTheme);

  document.addEventListener('DOMContentLoaded', () => {
    updateButton();
    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(storageKey, next); } catch { /* The switch still works for this visit. */ }
    });
  });

  window.addEventListener('storage', event => {
    if (event.key === storageKey) applyTheme(event.newValue);
  });
})();
