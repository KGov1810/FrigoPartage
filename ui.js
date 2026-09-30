// Frigo partagé — outils d'interface : gabarits HTML échappés, icônes,
// fiches modales, messages éphémères, sélection de photo.

// ---------------------------------------------------------------------------
// Gabarits HTML (toutes les valeurs insérées sont échappées)
// ---------------------------------------------------------------------------

export class Html {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

export const raw = (value) => new Html(value);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function fmt(value) {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(fmt).join('');
  if (value === null || value === undefined || value === false) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function html(strings, ...values) {
  let out = '';
  strings.forEach((part, i) => {
    out += part;
    if (i < values.length) out += fmt(values[i]);
  });
  return raw(out);
}

export function setHTML(selector, value, root = document) {
  const element = root.querySelector(selector);
  if (element) element.innerHTML = fmt(value);
}

export const simplify = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// ---------------------------------------------------------------------------
// Icônes (trait 24 × 24)
// ---------------------------------------------------------------------------

const svg = (d) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`);

export const I = {
  fridge: svg('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M6 9.5h12M9 5.5v2M9 12.5v4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  barcode: svg('<path d="M4 6v12M7 6v12M10.5 6v12M13 6v12M16.5 6v12M20 6v12"/>'),
  camera: svg('<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  pencil: svg('<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5zM13.5 7l3 3"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  cart: svg('<circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/><path d="M3 3.5h2.2l2.3 11.5h10.8l2-8H6.3"/>'),
  star: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8z"/>'),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7"/>'),
  trash: svg('<path d="M4.5 7h15M10 4h4M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  gauge: svg('<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 14l3.5-4.5"/>'),
  box: svg('<path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8"/>'),
  people: svg('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="17" cy="9.5" r="2.3"/><path d="M16 14.6c2.3 0 4 1.3 4.5 3.9"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
  refresh: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
  bell: svg('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>'),
  cabinet: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16M9.5 11v2M14.5 11v2"/>'),
  flame: svg('<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-2.9 1.8-4.8 3.3-6.4.5 1.6 1.3 2.7 2.4 3.1C11 8.4 12.2 5.3 14.9 3c-.3 2.9.9 4.5 2.3 6.1 1 1.2 1.8 2.8 1.8 4.9C19 18.2 16.1 21 12 21z"/>'),
  leaf: svg('<path d="M5 19c0-8 5.5-13.5 15-14-.2 9.3-5.7 15-14 15"/><path d="M5 19l7-7"/>'),
  receipt: svg('<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>')
};

// ---------------------------------------------------------------------------
// Fiches modales (glissent depuis le bas)
// ---------------------------------------------------------------------------

export const openSheets = new Set();

/**
 * render : () => Html ; actions : { nom: (élément, événement) => void }
 * onInput : écouteur input/change ; onData : appelé quand les données partagées changent.
 */
export function openSheet({ render, actions = {}, onInput = null, onData = null, onClose = null, tall = false }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const panel = document.createElement('div');
  panel.className = `sheet${tall ? ' tall' : ''}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  backdrop.append(panel);

  const sheet = {
    panel,
    isOpen: true,
    onData,
    update() {
      const scroll = panel.querySelector('.sheet-body')?.scrollTop ?? 0;
      panel.innerHTML = fmt(render());
      const body = panel.querySelector('.sheet-body');
      if (body) body.scrollTop = scroll;
    },
    close() {
      if (!sheet.isOpen) return;
      sheet.isOpen = false;
      openSheets.delete(sheet);
      backdrop.classList.remove('open');
      backdrop.classList.add('closing');
      setTimeout(() => backdrop.remove(), 300);
      onClose?.();
    }
  };

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !panel.contains(target)) return;
    const name = target.dataset.action;
    const handler = actions[name] ?? (name === 'close' ? () => sheet.close() : null);
    if (!handler) return;
    event.preventDefault();
    handler(target, event);
  });
  if (onInput) {
    panel.addEventListener('input', onInput);
    panel.addEventListener('change', onInput);
  }
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) sheet.close();
  });

  document.body.append(backdrop);
  sheet.update();
  openSheets.add(sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('open')));
  return sheet;
}

// ---------------------------------------------------------------------------
// Message éphémère (avec action « Annuler » facultative)
// ---------------------------------------------------------------------------

let toastTimer = null;

export function toast(message, actionLabel = null, onAction = null) {
  const element = document.getElementById('toast');
  if (!element) return;
  element.innerHTML = fmt(html`<span>${message}</span>${actionLabel ? html`<button type="button">${actionLabel}</button>` : ''}`);
  element.hidden = false;
  clearTimeout(toastTimer);
  const button = element.querySelector('button');
  if (button) {
    button.addEventListener('click', () => {
      element.hidden = true;
      onAction?.();
    }, { once: true });
  }
  toastTimer = setTimeout(() => { element.hidden = true; }, actionLabel ? 5000 : 2600);
}

// ---------------------------------------------------------------------------
// Photo : doit être appelé directement dans le geste de l'utilisateur (règle d'iOS)
// ---------------------------------------------------------------------------

export function pickImage({ camera = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    input.hidden = true;
    const done = (file) => {
      resolve(file);
      input.remove();
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copié');
  } catch {
    toast('Copie impossible : sélectionnez le texte et copiez-le à la main.');
  }
}

export async function shareText(text, title) {
  if (navigator.share) {
    try {
      await navigator.share(title ? { title, text } : { text });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  await copyText(text);
}

export function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}
