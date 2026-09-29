// Frigo partagé — écrans et interactions.

import * as store from './store.js';
import { state } from './store.js';
import * as S from './services.js';
import {
  html, raw, fmt, setHTML, simplify, I, openSheet, openSheets, toast,
  pickImage, copyText, shareText, isStandalone
} from './ui.js';

const screen = document.getElementById('screen');

const ui = {
  tab: 'frigo',
  search: '',
  priority: new Set(),
  customPriority: false,
  filters: { difficulty: '', maxMinutes: 0, batchOnly: false },
  favoritesOnly: false,
  generating: false,
  recipeNote: null,
  onboarding: { text: '', joinText: '', name: '', invite: '', message: null, busy: false }
};

const DIFFICULTY_LABEL = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile' };
const SOURCE = {
  stock: { label: 'Au frigo', icon: I.fridge },
  courses: { label: 'Liste de courses', icon: I.cart },
  placard: { label: 'Placard', icon: I.cabinet },
  a_acheter: { label: 'À acheter', icon: I.cart }
};

// ===========================================================================
// Éléments communs
// ===========================================================================

function thumb(product) {
  const src = product.image || product.imageUrl;
  return src
    ? html`<span class="thumb"><img src="${src}" alt="" loading="lazy"></span>`
    : html`<span class="thumb">${S.category(product.category).emoji}</span>`;
}

/** Le compteur de jours, façon magnet de frigo. */
function dayCounter(iso, status) {
  const days = S.daysUntil(iso);
  let number;
  let label;
  if (days < 0) {
    number = -days;
    label = days < -1 ? 'jours passés' : 'jour passé';
  } else if (days === 0) {
    number = 0;
    label = 'dernier jour';
  } else {
    number = days > 999 ? '999+' : days;
    label = days > 1 ? 'jours' : 'jour';
  }
  return html`<span class="days ${status}" role="img" aria-label="${S.expiryLabel(iso)}"><b>${number}</b><small>${label}</small></span>`;
}

function shortExpiry(iso) {
  const days = S.daysUntil(iso);
  if (days < 0) return 'périmé';
  if (days === 0) return 'auj.';
  return `J-${days}`;
}

function longDate(iso) {
  return S.formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function syncLine() {
  const element = document.getElementById('sync-line');
  if (!element) return;
  element.textContent = store.syncLabel();
  element.dataset.state = state.error ? 'error' : (state.fromCache && state.connected ? 'offline' : '');
}

function errorNote() {
  return state.error ? html`<p class="note error">${state.error}</p>` : '';
}

function updateChrome() {
  document.querySelectorAll('.tab').forEach((tab) => {
    if (tab.dataset.tab === ui.tab) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  setTabBadge('frigo', store.urgentProducts().length, false);
  setTabBadge('courses', store.uncheckedCount(), true);
  updateAppBadge();
}

function setTabBadge(name, count, calm) {
  const badge = document.querySelector(`[data-badge="${name}"]`);
  if (!badge) return;
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('calm', calm);
}

function updateAppBadge() {
  if (!('setAppBadge' in navigator)) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const count = store.badgeCount();
  const request = count ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  request?.catch?.(() => {});
}

// ===========================================================================
// Écran Frigo
// ===========================================================================

const fridgeView = {
  render() {
    return html`
      <header class="top"><div><h1>Mon frigo</h1><p class="sync" id="sync-line"></p></div></header>
      <div id="fridge-alert"></div>
      <label class="search" id="search-box">${I.search}<input id="search" type="search" placeholder="Rechercher un produit" value="${ui.search}" autocomplete="off" enterkeyhint="search" aria-label="Rechercher un produit"></label>
      <div id="fridge-list"></div>
      <button class="fab" data-action="add-menu" aria-label="Ajouter un produit">${I.plus}</button>`;
  },
  mounted() {
    this.update();
  },
  update() {
    syncLine();
    setHTML('#fridge-alert', [errorNote(), fridgeAlert()]);
    setHTML('#fridge-list', fridgeList());
    const box = document.getElementById('search-box');
    if (box) box.hidden = state.products.length === 0;
  }
};

function fridgeAlert() {
  const urgent = store.urgentProducts();
  if (!urgent.length) return '';
  const expired = urgent.filter((p) => store.productStatus(p) === 'expired').length;
  const names = urgent.slice(0, 3).map((p) => p.name);
  const more = urgent.length > 3 ? ` et ${urgent.length - 3} autre${urgent.length > 4 ? 's' : ''}` : '';
  const title = expired === urgent.length
    ? `${S.plural(urgent.length, 'produit')} périmé${urgent.length > 1 ? 's' : ''}`
    : `${S.plural(urgent.length, 'produit')} à consommer vite`;
  return html`
    <button class="alert-card ${expired === urgent.length ? 'expired' : ''}" data-action="go-recipes">
      <strong>${title}</strong>
      <span>${names.join(', ')}${more}</span>
      <em>Idées recettes</em>
    </button>`;
}

function fridgeList() {
  if (!state.products.length) {
    return html`
      <div class="empty">
        <div class="emoji">🥬</div>
        <h2>Le frigo est vide</h2>
        <p>Ajoutez un produit : scannez son code-barres, prenez-le en photo ou tapez son nom.</p>
        <button class="primary" data-action="add-scan">${I.barcode}Scanner un code-barres</button>
        <button class="secondary" data-action="add-manual">${I.pencil}Saisir à la main</button>
      </div>`;
  }
  const query = simplify(ui.search.trim());
  const items = store.sortedProducts().filter((p) => !query
    || simplify(p.name).includes(query)
    || simplify(S.category(p.category).label).includes(query));
  if (!items.length) return html`<p class="hint">Aucun produit ne correspond à « ${ui.search.trim()} ».</p>`;

  const groups = [['expired', 'Périmés'], ['soon', 'À consommer vite'], ['ok', 'Au frigo']];
  return groups.map(([status, title]) => {
    const list = items.filter((p) => store.productStatus(p) === status);
    if (!list.length) return '';
    return html`<h2 class="section ${status}">${title}<small>${list.length}</small></h2><div class="list">${list.map(productRow)}</div>`;
  });
}

function productRow(product) {
  const status = store.productStatus(product);
  const meta = [
    product.quantity,
    `jusqu'au ${S.formatDate(product.expiry)}`,
    product.addedBy ? `par ${product.addedBy}` : ''
  ].filter(Boolean).join(', ');
  return html`
    <div class="product" data-id="${product.id}">
      <button class="consume" data-action="consume" data-id="${product.id}" aria-label="Consommé : retirer ${product.name} du frigo"></button>
      <button class="product-main" data-action="edit" data-id="${product.id}">
        ${thumb(product)}
        <span class="product-text"><span class="product-name">${product.name}</span><span class="product-meta">${meta}</span></span>
        ${dayCounter(product.expiry, status)}
      </button>
    </div>`;
}

function consume(id) {
  const row = screen.querySelector(`.product[data-id="${CSS.escape(id)}"]`);
  row?.classList.add('leaving');
  setTimeout(() => {
    const removed = store.removeProducts([id]);
    if (removed.length) {
      toast(`${removed[0].name} : retiré du frigo`, 'Annuler', () => store.restoreProducts(removed));
    } else {
      row?.classList.remove('leaving');
    }
  }, 180);
}

function openAddMenu() {
  const hasKey = Boolean(state.settings.claudeKey);
  const sheet = openSheet({
    render: () => html`
      <div class="menu">
        <button class="menu-item" data-action="scan">${I.barcode}<span>Scanner un code-barres<small>Nom et photo retrouvés automatiquement</small></span></button>
        <button class="menu-item" data-action="photo">${I.camera}<span>Prendre le produit en photo<small>${hasKey ? 'Claude reconnaît le produit et sa date' : "Lecture de la date sur l'emballage"}</small></span></button>
        <button class="menu-item" data-action="manual">${I.pencil}<span>Saisir à la main</span></button>
        <button class="secondary" data-action="close">Annuler</button>
      </div>`,
    actions: {
      scan: () => {
        sheet.close();
        openEditor({ mode: 'barcode' });
      },
      photo: () => {
        const filePromise = pickImage({ camera: true }); // dans le geste, sinon iOS refuse
        sheet.close();
        openEditor({ mode: 'photo', filePromise });
      },
      manual: () => {
        sheet.close();
        openEditor({ mode: 'manual' });
      }
    }
  });
}

// ===========================================================================
// Fiche produit (ajout / modification)
// ===========================================================================

function openEditor({ product = null, draft = null, mode = 'manual', filePromise = null, shoppingItemId = null } = {}) {
  const isNew = !product;
  const p = {
    id: crypto.randomUUID(), name: '', expiry: S.isoInDays(7), category: 'autre', quantity: '',
    barcode: '', addedBy: '', createdAt: 0, image: '', imageUrl: '',
    ...(draft ?? {}), ...(product ?? {})
  };
  const view = { dateTouched: !isNew, busy: '', info: '', error: '' };
  const hasKey = () => Boolean(state.settings.claudeKey);
  const claude = () => ({ key: state.settings.claudeKey, model: state.settings.model });

  const sheet = openSheet({
    tall: true,
    render,
    actions: {
      save,
      scan: () => openScanner((code) => handleBarcode(code)),
      photo: () => {
        // Sans « capture » : iOS propose appareil photo OU photothèque.
        pickImage({ camera: false }).then((file) => file && handleProductPhoto(file));
      },
      'date-photo': () => {
        pickImage({ camera: true }).then((file) => file && handleDatePhoto(file));
      },
      quick: (el) => {
        p.expiry = S.isoInDays(Number(el.dataset.days));
        view.dateTouched = true;
        sheet.update();
      },
      'remove-photo': () => {
        p.image = '';
        p.imageUrl = '';
        sheet.update();
      },
      'to-shopping': () => {
        view.info = store.addShoppingItem(p.name, p.quantity) ? 'Ajouté à la liste de courses.' : 'Déjà dans la liste de courses.';
        view.error = '';
        sheet.update();
      },
      consume: () => {
        const removed = store.removeProducts([p.id]);
        sheet.close();
        if (removed.length) toast(`${removed[0].name} : retiré du frigo`, 'Annuler', () => store.restoreProducts(removed));
      }
    },
    onInput(event) {
      const t = event.target;
      if (t.name === 'name') {
        p.name = t.value;
        const button = sheet.panel.querySelector('[data-action="save"]');
        if (button) button.disabled = !p.name.trim();
      } else if (t.name === 'quantity') {
        p.quantity = t.value;
      } else if (t.name === 'category' && event.type === 'change') {
        p.category = t.value;
        sheet.update();
      } else if (t.name === 'expiry' && event.type === 'change' && t.value) {
        p.expiry = t.value;
        view.dateTouched = true;
        // Mise à jour partielle : ne pas refermer le sélecteur de date d'iOS.
        const status = sheet.panel.querySelector('.expiry-status');
        if (status) {
          status.className = `expiry-status ${S.statusOf(p.expiry, state.settings.alertDays)}`;
          status.textContent = S.expiryLabel(p.expiry);
        }
        sheet.panel.querySelector('.default-date')?.remove();
      }
    }
  });

  function render() {
    const status = S.statusOf(p.expiry, state.settings.alertDays);
    return html`
      <header class="sheet-head">
        <button class="link" data-action="close">Annuler</button>
        <h2>${isNew ? 'Nouveau produit' : 'Modifier le produit'}</h2>
        <button class="link strong" data-action="save" ${p.name.trim() ? '' : raw('disabled')}>${isNew ? 'Ajouter' : 'Enregistrer'}</button>
      </header>
      <div class="sheet-body">
        ${view.info ? html`<p class="note ok">${view.info}</p>` : ''}
        ${view.error ? html`<p class="note warn">${view.error}</p>` : ''}
        <div class="capture">
          <button data-action="scan">${I.barcode}Code-barres</button>
          <button data-action="photo">${I.camera}Photo du produit</button>
          <button data-action="date-photo">${I.calendar}Lire la date</button>
        </div>
        ${hasKey() ? '' : html`<p class="hint">Sans clé Claude (Réglages), la photo sert seulement à lire la date. Le code-barres reste le moyen le plus fiable d'identifier un produit.</p>`}
        <section class="group">
          <div class="name-row">${thumb(p)}<input name="name" value="${p.name}" placeholder="Nom (ex. Yaourt nature)" autocomplete="off" enterkeyhint="done" aria-label="Nom du produit"></div>
          <label class="field"><span>Catégorie</span>
            <select name="category">${S.CATEGORIES.map((c) => html`<option value="${c.id}" ${c.id === p.category ? raw('selected') : ''}>${c.emoji} ${c.label}</option>`)}</select>
          </label>
          <label class="field"><span>Quantité</span><input name="quantity" value="${p.quantity}" placeholder="500 g, 2 pots…" autocomplete="off"></label>
          ${p.image || p.imageUrl ? html`<button class="row-button danger" data-action="remove-photo">${I.trash}Retirer la photo</button>` : ''}
        </section>
        <section class="group">
          <label class="field"><span>Date de péremption</span><input type="date" name="expiry" value="${p.expiry}"></label>
          <div class="quick">
            ${[[3, '+3 j'], [7, '+1 sem'], [14, '+2 sem'], [30, '+1 mois']].map(([days, label]) => html`<button data-action="quick" data-days="${days}">${label}</button>`)}
          </div>
          <p class="expiry-status ${status}">${S.expiryLabel(p.expiry)}</p>
          ${isNew && !view.dateTouched ? html`<p class="hint inset default-date">Date proposée par défaut : dans 7 jours. Vérifiez-la.</p>` : ''}
        </section>
        ${isNew ? '' : html`
          <section class="group">
            ${p.addedBy ? html`<div class="field"><span>Ajouté par</span><span class="muted">${p.addedBy}</span></div>` : ''}
            <button class="row-button" data-action="to-shopping">${I.cart}Ajouter à la liste de courses</button>
            <button class="row-button" data-action="consume">${I.check}Consommé : retirer du frigo</button>
          </section>`}
      </div>
      ${view.busy ? html`<div class="busy"><span class="spinner"></span><p>${view.busy}</p></div>` : ''}`;
  }

  function save() {
    if (!p.name.trim() || view.busy) return;
    if (!S.parseISODate(p.expiry)) {
      view.error = 'Indiquez une date de péremption valide.';
      sheet.update();
      return;
    }
    store.saveProduct(p);
    if (shoppingItemId) store.deleteShoppingItems([shoppingItemId]);
    toast(isNew ? `${p.name.trim()} : ajouté au frigo` : 'Modifications enregistrées');
    sheet.close();
  }

  async function run(message, task) {
    view.busy = message;
    view.info = '';
    view.error = '';
    sheet.update();
    try {
      await task();
    } catch (error) {
      view.error = error?.message || String(error);
    } finally {
      view.busy = '';
      if (sheet.isOpen) sheet.update();
    }
  }

  function handleBarcode(code) {
    const digits = String(code).replace(/\D/g, '');
    if (!digits) return;
    return run('Recherche du produit…', async () => {
      p.barcode = digits;
      let info;
      try {
        info = await S.lookupBarcode(digits);
      } catch {
        throw new Error('Recherche impossible (connexion internet ?). Saisissez le nom à la main.');
      }
      if (!info) {
        view.error = `Code ${digits} inconnu d'Open Food Facts : saisissez le nom ou prenez le produit en photo.`;
        return;
      }
      p.name = info.name;
      p.category = info.category;
      if (!p.quantity && info.quantity) p.quantity = info.quantity;
      if (!p.image && info.imageUrl) p.imageUrl = info.imageUrl;
      view.info = 'Produit trouvé. Indiquez la date de péremption, ou touchez « Lire la date ».';
    });
  }

  function handleProductPhoto(file) {
    const message = hasKey() ? 'Claude analyse la photo…' : "Lecture de la date… (le premier usage télécharge l'outil de lecture)";
    return run(message, async () => {
      p.image = await S.thumbnail(file);
      p.imageUrl = '';
      if (hasKey()) {
        const { base64 } = await S.resizeImage(file, 1568, 0.8);
        const result = await S.analyzeProduct({ ...claude(), base64 });
        if (!result.isFood) {
          view.error = 'Claude ne reconnaît pas de produit alimentaire sur cette photo.';
          return;
        }
        if (result.name) p.name = result.name;
        p.category = result.category;
        if (!p.quantity) p.quantity = result.quantity;
        if (result.expiry) {
          p.expiry = result.expiry;
          view.dateTouched = true;
          view.info = "Produit et date reconnus : vérifiez-les avant d'enregistrer.";
        } else {
          view.info = 'Produit reconnu. Date illisible : touchez « Lire la date » pour la photographier de près, ou saisissez-la.';
        }
      } else {
        const date = S.parseExpiryDate(await S.recognizeText(file));
        if (date) {
          p.expiry = date;
          view.dateTouched = true;
          view.info = `Date lue : ${longDate(date)}. Vérifiez-la, puis saisissez le nom du produit.`;
        } else {
          view.info = "Sans clé Claude, la photo ne permet pas d'identifier le produit : saisissez son nom ou scannez le code-barres.";
        }
      }
    });
  }

  function handleDatePhoto(file) {
    return run(hasKey() ? 'Claude lit la date…' : "Lecture de la date… (le premier usage télécharge l'outil de lecture)", async () => {
      let date = null;
      let by = '';
      if (hasKey()) {
        const { base64 } = await S.resizeImage(file, 1568, 0.85);
        date = (await S.analyzeProduct({ ...claude(), base64 })).expiry;
        by = ' par Claude';
      } else {
        date = S.parseExpiryDate(await S.recognizeText(file));
      }
      if (date) {
        p.expiry = date;
        view.dateTouched = true;
        view.info = `Date lue${by} : ${longDate(date)}. Vérifiez-la.`;
      } else {
        view.error = 'Date illisible. Essayez une photo plus nette et bien éclairée, ou saisissez-la.';
      }
    });
  }

  // Lancement automatique selon le choix fait dans le menu « + ».
  if (mode === 'barcode') setTimeout(() => sheet.isOpen && openScanner((code) => handleBarcode(code)), 320);
  if (filePromise) {
    filePromise.then((file) => {
      if (file && sheet.isOpen) handleProductPhoto(file);
    });
  }
  if (mode === 'manual' && isNew && !p.name) {
    setTimeout(() => sheet.panel.querySelector('[name="name"]')?.focus(), 350);
  }
  return sheet;
}

// ===========================================================================
// Scanner de code-barres
// ===========================================================================

function openScanner(onCode) {
  const overlay = document.createElement('div');
  overlay.className = 'scanner';
  overlay.innerHTML = fmt(html`
    <video playsinline muted autoplay></video>
    <div class="scan-frame" aria-hidden="true"></div>
    <div class="scan-top"><button data-action="close">Annuler</button></div>
    <div class="scan-bottom">
      <p class="scan-hint">Placez le code-barres dans le cadre</p>
      <form class="scan-manual">
        <input inputmode="numeric" pattern="[0-9]*" placeholder="Ou tapez les chiffres" autocomplete="off" aria-label="Chiffres du code-barres">
        <button type="submit">OK</button>
      </form>
      <button class="scan-photo" data-action="photo">Photographier le code-barres</button>
    </div>`);
  document.body.append(overlay);

  const hint = overlay.querySelector('.scan-hint');
  let stopCamera = null;
  let finished = false;

  const stop = () => {
    stopCamera?.();
    stopCamera = null;
  };
  const finish = (code) => {
    if (finished) return;
    finished = true;
    stop();
    overlay.remove();
    if (code) onCode(code);
  };

  S.startBarcodeScan(overlay.querySelector('video'), (code) => finish(code))
    .then((stopFn) => {
      if (finished) stopFn();
      else stopCamera = stopFn;
    })
    .catch((error) => {
      hint.textContent = error?.name === 'NotAllowedError'
        ? "Accès à la caméra refusé : autorisez-le (Réglages de l'iPhone > Safari > Caméra) ou tapez les chiffres."
        : 'Caméra indisponible : tapez les chiffres sous le code-barres.';
    });

  overlay.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'close') finish(null);
    if (target.dataset.action === 'photo') {
      stop(); // libère la caméra avant d'ouvrir l'appareil photo
      pickImage({ camera: true }).then(async (file) => {
        if (!file) return;
        hint.textContent = 'Lecture du code-barres…';
        const code = await S.decodeBarcodeFromImage(file).catch(() => null);
        if (code) finish(code);
        else hint.textContent = 'Code-barres illisible sur la photo : tapez les chiffres.';
      });
    }
  });

  overlay.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const digits = event.target.querySelector('input').value.replace(/\D/g, '');
    if (digits.length >= 8) finish(digits);
    else hint.textContent = 'Un code-barres compte 8 ou 13 chiffres.';
  });
}

// ===========================================================================
// Écran Recettes
// ===========================================================================

function applyDefaultPriority() {
  const ids = new Set(state.products.map((p) => p.id));
  if (!ui.customPriority) {
    ui.priority = new Set(store.soonProducts().map((p) => p.id));
  } else {
    ui.priority = new Set([...ui.priority].filter((id) => ids.has(id)));
  }
}

const recipesView = {
  render() {
    applyDefaultPriority();
    const hasKey = Boolean(state.settings.claudeKey);
    const priority = store.sortedProducts().filter((p) => ui.priority.has(p.id));
    const canGenerate = hasKey && !ui.generating && (state.products.length > 0 || state.shopping.length > 0);
    const recipes = [...state.recipes]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .filter((r) => S.matchesFilters(r, ui.filters) && (!ui.favoritesOnly || r.favorite));

    return html`
      <header class="top">
        <h1>Recettes</h1>
        <button class="icon-btn" data-action="toggle-favorites" aria-pressed="${ui.favoritesOnly}" aria-label="Afficher seulement les favoris">${I.star}</button>
      </header>

      <section class="group">
        <h2>À utiliser en priorité</h2>
        ${priority.length
          ? html`<div class="chips">${priority.map((p) => html`<span class="chip">${S.category(p.category).emoji} ${p.name} <i class="${store.productStatus(p)}">${shortExpiry(p.expiry)}</i></span>`)}</div>`
          : html`<p class="hint inset">${state.products.length
            ? 'Aucun produit ne périme bientôt. Choisissez-en, ou laissez Claude piocher dans tout le frigo.'
            : 'Le frigo est vide : Claude partira de la liste de courses.'}</p>`}
        <button class="row-button" data-action="pick-products" ${state.products.length ? '' : raw('disabled')}>${I.check}Choisir les produits</button>
      </section>

      <section class="group">
        <span class="filter-label">Difficulté</span>
        <div class="segmented" role="group" aria-label="Difficulté">
          ${[['', 'Toutes'], ...S.DIFFICULTIES.map((d) => [d.id, d.label])].map(([value, label]) => html`<button data-action="set-difficulty" data-value="${value}" aria-pressed="${ui.filters.difficulty === value}">${label}</button>`)}
        </div>
        <span class="filter-label">Temps total maximum</span>
        <div class="segmented" role="group" aria-label="Temps total maximum">
          ${S.TIME_FILTERS.map((t) => html`<button data-action="set-time" data-value="${t.max}" aria-pressed="${ui.filters.maxMinutes === t.max}">${t.label}</button>`)}
        </div>
        <label class="field">
          <span class="label-stack">Batch cooking<small>Se prépare en avance et se garde plusieurs jours</small></span>
          <input type="checkbox" class="switch" id="batch-toggle" ${ui.filters.batchOnly ? raw('checked') : ''}>
        </label>
      </section>

      <button class="primary" data-action="generate" ${canGenerate ? '' : raw('disabled')}>
        ${ui.generating ? html`<span class="spinner"></span>Claude cuisine… (environ 30 s)` : html`${I.sparkle}Proposer 5 recettes`}
      </button>
      ${ui.recipeNote
        ? html`<p class="note ${ui.recipeNote.kind}">${ui.recipeNote.text}</p>`
        : !hasKey
          ? html`<p class="hint">Ajoutez votre clé API Claude dans Réglages pour générer des recettes.</p>`
          : ''}

      <h2 class="section">${ui.favoritesOnly ? 'Recettes favorites' : 'Mes recettes'}<small>${recipes.length || ''}</small></h2>
      <div class="list">
        ${!state.recipes.length
          ? html`<p class="hint">Aucune recette pour l'instant. Les recettes générées sont partagées avec l'autre iPhone.</p>`
          : !recipes.length
            ? html`<p class="hint">Aucune recette ne correspond à ces filtres.</p>`
            : recipes.map(recipeCard)}
      </div>`;
  },
  update() {
    rerenderKeepScroll();
  }
};

function recipeCard(recipe) {
  const inStock = recipe.usedProductIds.filter((id) => store.productById(id)).length;
  return html`
    <button class="recipe-card" data-action="open-recipe" data-id="${recipe.id}">
      <h3><span>${recipe.title}</span>${recipe.favorite ? I.star : ''}</h3>
      ${recipe.summary ? html`<p>${recipe.summary}</p>` : ''}
      <span class="facts">
        <span>${I.clock}${S.formatMinutes(recipe.totalMinutes)}</span>
        <span>${I.gauge}${DIFFICULTY_LABEL[recipe.difficulty] ?? recipe.difficulty}</span>
        ${S.isBatchFriendly(recipe) ? html`<span>${I.box}Se garde ${S.plural(recipe.storageDays, 'jour')}</span>` : ''}
      </span>
      ${inStock ? html`<span class="uses">Utilise ${S.plural(inStock, 'produit')} du frigo</span>` : ''}
    </button>`;
}

async function generateRecipes() {
  if (ui.generating) return;
  ui.generating = true;
  ui.recipeNote = null;
  rerenderIf('recettes');
  try {
    const all = store.sortedProducts();
    const priority = all.filter((p) => ui.priority.has(p.id));
    const others = all.filter((p) => !ui.priority.has(p.id) && store.productStatus(p) !== 'expired');
    const filters = { ...ui.filters };
    const recipes = await S.generateRecipes({
      key: state.settings.claudeKey,
      model: state.settings.model,
      priority,
      others,
      shopping: state.shopping,
      filters
    });
    store.saveRecipes(recipes);
    if (!recipes.length) {
      ui.recipeNote = { kind: 'warn', text: 'Aucune recette reçue, réessayez.' };
    } else if (!recipes.some((r) => S.matchesFilters(r, filters))) {
      ui.recipeNote = { kind: 'warn', text: 'Les recettes reçues ne respectent pas tous les filtres : assouplissez-les pour les voir, ou réessayez.' };
    } else {
      ui.recipeNote = { kind: 'ok', text: `${S.plural(recipes.length, 'nouvelle recette', 'nouvelles recettes')} ci-dessous.` };
    }
  } catch (error) {
    ui.recipeNote = { kind: 'error', text: error?.message || String(error) };
  } finally {
    ui.generating = false;
    rerenderIf('recettes');
  }
}

function openProductPicker() {
  const sheet = openSheet({
    tall: true,
    render: () => html`
      <header class="sheet-head">
        <button class="link" data-action="none">Aucun</button>
        <h2>Produits à utiliser</h2>
        <button class="link strong" data-action="close">OK</button>
      </header>
      <div class="sheet-body">
        <section class="group">
          ${store.sortedProducts().map((p) => html`
            <button class="pick" role="checkbox" aria-checked="${ui.priority.has(p.id)}" data-action="toggle" data-id="${p.id}">
              <span class="box">${I.check}</span>
              ${thumb(p)}
              <span class="product-text"><span class="product-name">${p.name}</span><span class="product-meta">${S.expiryLabel(p.expiry)}</span></span>
            </button>`)}
        </section>
      </div>`,
    actions: {
      toggle: (el) => {
        ui.customPriority = true;
        const id = el.dataset.id;
        if (ui.priority.has(id)) ui.priority.delete(id);
        else ui.priority.add(id);
        sheet.update();
      },
      none: () => {
        ui.customPriority = true;
        ui.priority.clear();
        sheet.update();
      }
    },
    onData: () => sheet.update(),
    onClose: () => rerenderIf('recettes')
  });
}

function recipeShareText(recipe) {
  const lines = [recipe.title];
  if (recipe.summary) lines.push(recipe.summary);
  lines.push('', `${S.formatMinutes(recipe.totalMinutes)}, ${(DIFFICULTY_LABEL[recipe.difficulty] ?? '').toLowerCase()}, ${S.plural(recipe.servings, 'portion')}`);
  lines.push('', 'Ingrédients :', ...recipe.ingredients.map((i) => `- ${i.quantity ? `${i.quantity} ` : ''}${i.name}`));
  lines.push('', 'Préparation :', ...recipe.steps.map((s, n) => `${n + 1}. ${s}`));
  if (recipe.storageTips) lines.push('', `Conservation : ${recipe.storageTips}`);
  return lines.join('\n');
}

function openRecipe(id) {
  const sheet = openSheet({
    tall: true,
    render,
    onData: () => sheet.update(),
    actions: {
      favorite: () => store.toggleFavorite(id),
      'add-missing': () => {
        const recipe = findRecipe();
        if (!recipe) return;
        const added = store.addMissingIngredients(recipe);
        toast(added ? `${S.plural(added, 'ingrédient')} ajouté${added > 1 ? 's' : ''} aux courses` : 'Déjà dans la liste de courses');
      },
      cooked: () => {
        const recipe = findRecipe();
        if (!recipe) return;
        const used = recipe.usedProductIds.map(store.productById).filter(Boolean);
        if (!used.length) return;
        if (!window.confirm(`Retirer du frigo : ${used.map((p) => p.name).join(', ')} ?`)) return;
        const removed = store.removeProducts(used.map((p) => p.id));
        toast(`${S.plural(removed.length, 'produit')} retiré${removed.length > 1 ? 's' : ''} du frigo`, 'Annuler', () => store.restoreProducts(removed));
      },
      share: () => {
        const recipe = findRecipe();
        if (recipe) shareText(recipeShareText(recipe), recipe.title);
      },
      delete: () => {
        if (!window.confirm('Supprimer cette recette sur les deux iPhone ?')) return;
        store.deleteRecipe(id);
        sheet.close();
      }
    }
  });

  function findRecipe() {
    return state.recipes.find((r) => r.id === id) ?? null;
  }

  function render() {
    const recipe = findRecipe();
    if (!recipe) {
      return html`
        <header class="sheet-head"><span></span><h2>Recette</h2><button class="link strong" data-action="close">Fermer</button></header>
        <div class="sheet-body"><p class="hint">Cette recette a été supprimée.</p></div>`;
    }
    const used = recipe.usedProductIds.map(store.productById).filter(Boolean);
    const missing = recipe.ingredients.filter((i) => i.source === 'a_acheter');
    const prep = recipe.prepMinutes && recipe.prepMinutes < recipe.totalMinutes
      ? `, dont ${S.formatMinutes(recipe.prepMinutes)} de préparation` : '';
    return html`
      <header class="sheet-head">
        <button class="icon-btn" data-action="favorite" aria-pressed="${Boolean(recipe.favorite)}" aria-label="${recipe.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${I.star}</button>
        <h2>Recette</h2>
        <button class="link strong" data-action="close">Fermer</button>
      </header>
      <div class="sheet-body">
        <div class="recipe-hero">
          <h2>${recipe.title}</h2>
          ${recipe.summary ? html`<p>${recipe.summary}</p>` : ''}
          <div class="facts">
            <span>${I.clock}${S.formatMinutes(recipe.totalMinutes)}${prep}</span>
            <span>${I.gauge}${DIFFICULTY_LABEL[recipe.difficulty] ?? recipe.difficulty}</span>
            <span>${I.people}${S.plural(recipe.servings, 'portion')}</span>
          </div>
        </div>

        <section class="group">
          <h2>Ingrédients</h2>
          ${recipe.ingredients.map(ingredientRow)}
          ${missing.length ? html`<button class="row-button" data-action="add-missing">${I.cart}${missing.length > 1 ? `Ajouter les ${missing.length} ingrédients manquants aux courses` : "Ajouter l'ingrédient manquant aux courses"}</button>` : ''}
        </section>

        <section class="group">
          <h2>Préparation</h2>
          <ol class="steps">${recipe.steps.map((step) => html`<li><span>${step}</span></li>`)}</ol>
        </section>

        ${recipe.storageDays > 0 || recipe.storageTips ? html`
          <section class="group">
            <h2>Conservation</h2>
            <p class="plain">${recipe.storageDays > 0 ? `Se garde ${S.plural(recipe.storageDays, 'jour')} au réfrigérateur. ` : ''}${recipe.storageTips}</p>
          </section>` : ''}

        <section class="group">
          ${used.length ? html`<button class="row-button" data-action="cooked">${I.check}J'ai cuisiné cette recette</button>` : ''}
          <button class="row-button" data-action="share">${I.share}Partager la recette</button>
          <button class="row-button danger" data-action="delete">${I.trash}Supprimer la recette</button>
        </section>
        ${used.length ? html`<p class="hint">« J'ai cuisiné » retire du frigo : ${used.map((p) => p.name).join(', ')}.</p>` : ''}
      </div>`;
  }
}

function ingredientRow(ingredient) {
  const source = SOURCE[ingredient.source] ? ingredient.source : 'a_acheter';
  const product = ingredient.productId ? store.productById(ingredient.productId) : null;
  const detail = [
    ingredient.quantity,
    ingredient.productId && !product ? 'plus au frigo' : SOURCE[source].label
  ].filter(Boolean).join(', ');
  return html`
    <div class="ingredient">
      <span class="src ${source}">${SOURCE[source].icon}</span>
      <div><span>${ingredient.name}</span><small>${detail}</small></div>
      ${product ? dayCounter(product.expiry, store.productStatus(product)) : ''}
    </div>`;
}

// ===========================================================================
// Écran Courses
// ===========================================================================

const shoppingView = {
  render() {
    return html`
      <header class="top"><div><h1>Courses</h1><p class="sync" id="sync-line"></p></div>
        <button class="link" data-action="clear-checked" id="clear-checked" hidden>Vider le panier</button></header>
      <form class="add-item" id="add-item">
        <input id="new-item" placeholder="Ajouter un article" autocomplete="off" enterkeyhint="done" aria-label="Nouvel article">
        <button type="submit" aria-label="Ajouter">${I.plus}</button>
      </form>
      <div id="shopping-list"></div>`;
  },
  mounted() {
    this.update();
  },
  update() {
    syncLine();
    const toBuy = state.shopping.filter((i) => !i.checked).sort((a, b) => a.createdAt - b.createdAt);
    const inCart = state.shopping.filter((i) => i.checked).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const clear = document.getElementById('clear-checked');
    if (clear) clear.hidden = inCart.length === 0;
    setHTML('#shopping-list', [
      errorNote(),
      state.shopping.length ? '' : html`
        <div class="empty">
          <div class="emoji">🧺</div>
          <h2>Liste vide</h2>
          <p>Ajoutez des articles ici, depuis une recette, ou depuis la fiche d'un produit du frigo.</p>
        </div>`,
      toBuy.length ? html`<h2 class="section">À acheter<small>${toBuy.length}</small></h2><div class="list">${toBuy.map(shoppingRow)}</div>` : '',
      inCart.length ? html`
        <h2 class="section">Dans le panier<small>${inCart.length}</small></h2>
        <div class="list">${inCart.map(shoppingRow)}</div>
        <p class="hint">Touchez l'icône frigo d'un article pour le ranger avec sa date de péremption.</p>` : ''
    ]);
  }
};

function shoppingRow(item) {
  const detail = [item.quantity, item.addedBy ? `par ${item.addedBy}` : ''].filter(Boolean).join(', ');
  return html`
    <div class="shop-item ${item.checked ? 'checked' : ''}">
      <button class="tick" data-action="toggle-item" data-id="${item.id}" aria-pressed="${item.checked}" aria-label="${item.name}"><span>${I.check}</span></button>
      <button class="shop-text" data-action="toggle-item" data-id="${item.id}" tabindex="-1"><span>${item.name}</span>${detail ? html`<small>${detail}</small>` : ''}</button>
      <button class="icon-btn" data-action="item-to-fridge" data-id="${item.id}" aria-label="Ranger ${item.name} au frigo">${I.fridge}</button>
      <button class="icon-btn" data-action="delete-item" data-id="${item.id}" aria-label="Supprimer ${item.name}">${I.x}</button>
    </div>`;
}

// ===========================================================================
// Écran Réglages
// ===========================================================================

function alertText(days) {
  return days === 0 ? 'le jour même' : `${S.plural(days, 'jour')} avant`;
}

const settingsView = {
  render() {
    const s = state.settings;
    return html`
      <header class="top"><h1>Réglages</h1></header>

      <section class="group">
        <h2>Profil</h2>
        <label class="field"><span>Votre prénom</span><input data-setting="userName" value="${s.userName}" placeholder="Prénom" autocomplete="given-name"></label>
      </section>

      <section class="group">
        <h2>Alertes de péremption</h2>
        <div class="field"><span>Prévenir</span>
          <div class="stepper">
            <button data-action="alert-minus" aria-label="Un jour de moins">−</button>
            <output id="alert-days">${alertText(s.alertDays)}</output>
            <button data-action="alert-plus" aria-label="Un jour de plus">+</button>
          </div>
        </div>
        <div id="badge-row"></div>
      </section>
      <p class="hint">Les produits à consommer vite sont mis en avant à chaque ouverture. Une application web ne peut pas envoyer de rappel quand elle est fermée : programmez un rappel quotidien « Vérifier le frigo » dans l'app Rappels (voir README).</p>

      <section class="group">
        <h2>Recettes et photos (Claude)</h2>
        <div id="claude-key"></div>
        <label class="field"><span>Modèle</span>
          <select id="model">${store.MODELS.map((m) => html`<option value="${m.id}" ${m.id === s.model ? raw('selected') : ''}>${m.label}</option>`)}</select>
        </label>
      </section>
      <p class="hint">Sert à générer les recettes et à reconnaître un produit en photo. Créez une clé sur console.anthropic.com (payée à l'usage : quelques centimes par génération). Elle reste sur cet iPhone.</p>

      <section class="group"><h2>Foyer partagé</h2><div id="household"></div></section>

      <section class="group">
        <h2>Synchronisation</h2>
        <div id="sync-details"></div>
        <button class="row-button" data-action="reconnect">${I.refresh}Se reconnecter</button>
      </section>

      <section class="group">
        <h2>À propos</h2>
        <div class="field"><span>Données produits</span><a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a></div>
        <p class="plain hint">Base collaborative sous licence ODbL.</p>
      </section>`;
  },
  mounted() {
    this.update('settings');
  },
  update(what) {
    const s = state.settings;
    const days = document.getElementById('alert-days');
    if (days) days.textContent = alertText(s.alertDays);
    setHTML('#badge-row', badgeRow());
    const time = state.lastSync ? state.lastSync.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
    setHTML('#sync-details', html`
      <div class="field"><span>État</span><span class="muted">${store.syncLabel()}</span></div>
      <div class="field"><span>Dernière synchro</span><span class="muted">${time}</span></div>
      ${state.error ? html`<p class="note error">${state.error}</p>` : ''}`);
    if (what !== 'settings') return; // ne pas effacer un champ en cours de saisie
    setHTML('#claude-key', s.claudeKey
      ? html`
        <div class="field"><span>Clé API</span><span class="muted">enregistrée (…${s.claudeKey.slice(-4)})</span></div>
        <button class="row-button danger" data-action="delete-key">${I.trash}Supprimer la clé</button>`
      : html`
        <label class="field stack"><span>Clé API</span><input id="key-input" type="password" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <div class="row-actions"><button class="secondary" data-action="save-key">Enregistrer la clé</button></div>`);
    setHTML('#household', s.householdCode
      ? html`
        <div class="field"><span>Code du foyer</span><strong>${s.householdCode}</strong></div>
        <button class="row-button" data-action="share-invite">${I.share}Inviter l'autre iPhone</button>
        <button class="row-button" data-action="copy-invite">${I.copy}Copier le code d'invitation</button>
        <button class="row-button danger" data-action="leave">Quitter ce foyer</button>`
      : html`<p class="plain hint">Aucun foyer.</p>`);
  }
};

function badgeRow() {
  if (!isStandalone() || !('setAppBadge' in navigator) || !('Notification' in window)) return '';
  if (Notification.permission === 'granted') {
    return html`<div class="field"><span>Pastille sur l'icône</span><span class="muted">activée</span></div>`;
  }
  if (Notification.permission === 'denied') {
    return html`<p class="plain hint">Pastille refusée : Réglages de l'iPhone > Notifications > Frigo.</p>`;
  }
  return html`<button class="row-button" data-action="enable-badge">${I.bell}Afficher sur l'icône le nombre de produits à consommer</button>`;
}

function inviteMessage() {
  const url = location.origin + location.pathname;
  return [
    'Rejoins notre Frigo partagé !',
    `1. Ouvre ce lien dans Safari : ${url}`,
    "2. Touche Partager puis « Sur l'écran d'accueil », et ouvre l'app depuis l'écran d'accueil.",
    "3. Colle ce code d'invitation quand l'app le demande :",
    '',
    store.invitationCode()
  ].join('\n');
}

// ===========================================================================
// Accueil (installation, connexion, foyer)
// ===========================================================================

function needsOnboarding() {
  const s = state.settings;
  return !store.firebaseConfig() || !s.householdCode || !s.onboardingDone;
}

function onboardingStep() {
  const s = state.settings;
  if (!isStandalone() && !s.installHintDismissed && !s.householdCode) return 'install';
  if (!store.firebaseConfig()) return 'connect';
  if (!s.householdCode) return 'household';
  return 'created';
}

function obMessage() {
  const m = ui.onboarding.message;
  return m ? html`<p class="note ${m.kind}">${m.text}</p>` : '';
}

const ONBOARDING = {
  install: () => html`
    <div class="welcome">
      <img src="icon-180.png" alt="">
      <h1>Frigo partagé</h1>
      <p>Les dates de péremption, les recettes anti-gaspillage et la liste de courses, partagées à deux.</p>
    </div>
    <h2 class="section">Installez d'abord l'app</h2>
    <ol class="steps-install">
      <li><span>Touchez <strong>Partager</strong> <span class="inline-icon">${I.share}</span> dans la barre de Safari.</span></li>
      <li><span>Choisissez <strong>Sur l'écran d'accueil</strong>, puis <strong>Ajouter</strong>.</span></li>
      <li><span>Ouvrez <strong>Frigo</strong> depuis l'écran d'accueil pour continuer.</span></li>
    </ol>
    <p class="hint">L'app installée garde ses propres données : faites la configuration depuis l'écran d'accueil, pas dans Safari.</p>
    <button class="link" data-action="dismiss-install">Continuer dans Safari quand même</button>`,

  connect: () => html`
    <header class="top"><h1>Connexion</h1></header>
    <p class="hint">Le partage entre les deux iPhone passe par votre base Firebase gratuite.</p>
    <section class="group">
      <label class="field stack">
        <span><strong>Second iPhone</strong> : collez le code d'invitation reçu.<br><strong>Premier iPhone</strong> : collez la configuration Firebase (README, étape 1).</span>
        <textarea id="connect-text" placeholder="FRIGO1.… ou const firebaseConfig = { … }" autocapitalize="off" autocorrect="off" spellcheck="false">${ui.onboarding.text}</textarea>
      </label>
    </section>
    ${obMessage()}
    <button class="primary" data-action="connect">Continuer</button>`,

  household: () => {
    const o = ui.onboarding;
    return html`
      <header class="top"><h1>Votre foyer</h1></header>
      <section class="group">
        <label class="field"><span>Votre prénom</span><input id="ob-name" value="${o.name || state.settings.userName}" placeholder="Prénom" autocomplete="given-name"></label>
      </section>
      ${o.invite
        ? html`
          <p class="note ok">Invitation reconnue. Touchez « Rejoindre » pour retrouver le frigo partagé.</p>
          <button class="primary" data-action="join" ${o.busy ? raw('disabled') : ''}>${o.busy ? html`<span class="spinner"></span>Connexion…` : 'Rejoindre le foyer'}</button>`
        : html`
          <h2 class="section">Premier iPhone</h2>
          <button class="primary" data-action="create" ${o.busy ? raw('disabled') : ''}>${o.busy ? html`<span class="spinner"></span>Connexion…` : html`${I.plus}Créer un foyer`}</button>
          <h2 class="section">Second iPhone</h2>
          <section class="group">
            <label class="field stack"><span>Code d'invitation reçu</span>
              <textarea id="join-text" placeholder="FRIGO1.…" autocapitalize="off" autocorrect="off" spellcheck="false">${o.joinText}</textarea>
            </label>
          </section>
          <button class="secondary" data-action="join" ${o.busy ? raw('disabled') : ''}>Rejoindre le foyer</button>`}
      ${obMessage()}`;
  },

  created: () => html`
    <div class="welcome">
      <div class="emoji" aria-hidden="true">🎉</div>
      <h1>Foyer créé</h1>
      <p>Sur le second iPhone, installez l'app puis collez ce code d'invitation.</p>
    </div>
    <div class="code-box long">${store.invitationCode()}</div>
    <div class="row-actions inline">
      <button class="secondary" data-action="share-invite">${I.share}Envoyer</button>
      <button class="secondary" data-action="copy-invite">${I.copy}Copier</button>
    </div>
    <p class="hint">Code du foyer : ${state.settings.householdCode}. L'invitation reste disponible dans Réglages > Foyer partagé.</p>
    <button class="primary" data-action="start">Commencer</button>`
};

function renderOnboarding() {
  screen.innerHTML = fmt(ONBOARDING[onboardingStep()]());
}

function onboardingName() {
  const value = document.getElementById('ob-name')?.value ?? ui.onboarding.name;
  return (value || state.settings.userName || '').trim();
}

async function onboardingCreate() {
  const name = onboardingName();
  if (!name) {
    ui.onboarding.message = { kind: 'warn', text: 'Indiquez votre prénom.' };
    renderOnboarding();
    return;
  }
  store.updateSettings({ userName: name });
  ui.onboarding.busy = true;
  ui.onboarding.message = null;
  renderOnboarding();
  try {
    await store.createHousehold();
  } catch (error) {
    ui.onboarding.message = { kind: 'error', text: store.errorMessage(error) };
  }
  ui.onboarding.busy = false;
  render();
}

async function onboardingJoin() {
  const name = onboardingName();
  const input = ui.onboarding.invite || document.getElementById('join-text')?.value || ui.onboarding.joinText;
  if (!name) {
    ui.onboarding.message = { kind: 'warn', text: 'Indiquez votre prénom.' };
    renderOnboarding();
    return;
  }
  if (!input.trim()) {
    ui.onboarding.message = { kind: 'warn', text: "Collez le code d'invitation reçu de l'autre iPhone." };
    renderOnboarding();
    return;
  }
  store.updateSettings({ userName: name });
  ui.onboarding.busy = true;
  ui.onboarding.message = null;
  renderOnboarding();
  try {
    await store.joinHousehold(input);
    ui.onboarding.invite = '';
    store.updateSettings({ onboardingDone: true });
  } catch (error) {
    ui.onboarding.message = { kind: 'error', text: store.errorMessage(error) };
  }
  ui.onboarding.busy = false;
  render();
}

function onboardingConnect() {
  const text = document.getElementById('connect-text')?.value ?? ui.onboarding.text;
  ui.onboarding.text = text;
  const invite = store.parseInvitation(text);
  if (invite) {
    ui.onboarding.invite = text;
    ui.onboarding.message = null;
    store.updateSettings({ firebaseConfig: invite.config });
    render();
    return;
  }
  const config = store.parseFirebaseConfig(text);
  if (config) {
    ui.onboarding.message = null;
    store.updateSettings({ firebaseConfig: config });
    render();
    return;
  }
  ui.onboarding.message = {
    kind: 'warn',
    text: "Texte non reconnu. Collez le code d'invitation (il commence par FRIGO1.) ou le bloc de configuration Firebase complet."
  };
  renderOnboarding();
}

// ===========================================================================
// Rendu général et navigation
// ===========================================================================

const VIEWS = { frigo: fridgeView, recettes: recipesView, courses: shoppingView, reglages: settingsView };

function render() {
  const onboarding = needsOnboarding();
  document.body.classList.toggle('onboarding', onboarding);
  if (onboarding) {
    renderOnboarding();
    return;
  }
  const view = VIEWS[ui.tab];
  screen.innerHTML = fmt(view.render());
  view.mounted?.();
  updateChrome();
}

function rerenderKeepScroll() {
  const y = window.scrollY;
  screen.innerHTML = fmt(VIEWS[ui.tab].render());
  VIEWS[ui.tab].mounted?.();
  window.scrollTo(0, y);
}

function rerenderIf(tab) {
  if (ui.tab === tab && !document.body.classList.contains('onboarding')) rerenderKeepScroll();
}

function showTab(name) {
  if (!VIEWS[name]) return;
  ui.tab = name;
  if (name === 'recettes') ui.recipeNote = null;
  render();
  window.scrollTo(0, 0);
}

function onStoreChange(what) {
  const onboarding = needsOnboarding();
  if (onboarding !== document.body.classList.contains('onboarding')) {
    render();
    return;
  }
  if (onboarding) {
    if (what === 'settings' || what === 'sync') renderOnboarding();
    return;
  }
  VIEWS[ui.tab].update?.(what);
  updateChrome();
  openSheets.forEach((sheet) => sheet.onData?.(what));
}

// ===========================================================================
// Actions de l'écran principal
// ===========================================================================

const ACTIONS = {
  // Frigo
  'add-menu': () => openAddMenu(),
  'add-scan': () => openEditor({ mode: 'barcode' }),
  'add-manual': () => openEditor({ mode: 'manual' }),
  consume: (el) => consume(el.dataset.id),
  edit: (el) => {
    const product = store.productById(el.dataset.id);
    if (product) openEditor({ product });
  },
  'go-recipes': () => showTab('recettes'),

  // Recettes
  'toggle-favorites': () => {
    ui.favoritesOnly = !ui.favoritesOnly;
    rerenderKeepScroll();
  },
  'pick-products': () => openProductPicker(),
  'set-difficulty': (el) => {
    ui.filters.difficulty = el.dataset.value;
    ui.recipeNote = null;
    rerenderKeepScroll();
  },
  'set-time': (el) => {
    ui.filters.maxMinutes = Number(el.dataset.value);
    ui.recipeNote = null;
    rerenderKeepScroll();
  },
  generate: () => generateRecipes(),
  'open-recipe': (el) => openRecipe(el.dataset.id),

  // Courses
  'toggle-item': (el) => store.toggleShoppingItem(el.dataset.id),
  'delete-item': (el) => {
    const item = state.shopping.find((i) => i.id === el.dataset.id);
    if (!item) return;
    store.deleteShoppingItems([item.id]);
    toast(`${item.name} : supprimé`, 'Annuler', () => store.addShoppingItem(item.name, item.quantity));
  },
  'item-to-fridge': (el) => {
    const item = state.shopping.find((i) => i.id === el.dataset.id);
    if (item) openEditor({ draft: { name: item.name, quantity: item.quantity }, shoppingItemId: item.id });
  },
  'clear-checked': () => store.clearCheckedShopping(),

  // Réglages
  'alert-minus': () => store.updateSettings({ alertDays: Math.max(0, state.settings.alertDays - 1) }),
  'alert-plus': () => store.updateSettings({ alertDays: Math.min(7, state.settings.alertDays + 1) }),
  'save-key': () => {
    const key = document.getElementById('key-input')?.value.trim() ?? '';
    if (!key.startsWith('sk-')) {
      toast('Ce texte ne ressemble pas à une clé Claude (elle commence par sk-ant-).');
      return;
    }
    store.updateSettings({ claudeKey: key });
    toast('Clé enregistrée');
  },
  'delete-key': () => {
    if (window.confirm('Supprimer la clé Claude de cet iPhone ?')) store.updateSettings({ claudeKey: '' });
  },
  'share-invite': () => shareText(inviteMessage()),
  'copy-invite': () => copyText(store.invitationCode()),
  leave: () => {
    if (window.confirm("Quitter ce foyer ? Les données restent dans le foyer : vous pourrez le rejoindre avec le code d'invitation.")) {
      store.leaveHousehold();
    }
  },
  reconnect: () => store.reconnect(),
  'enable-badge': async () => {
    try {
      await Notification.requestPermission();
    } catch {
      // ancien Safari : rien à faire
    }
    updateAppBadge();
    settingsView.update('badge');
  },

  // Accueil
  'dismiss-install': () => store.updateSettings({ installHintDismissed: true }),
  connect: () => onboardingConnect(),
  create: () => onboardingCreate(),
  join: () => onboardingJoin(),
  start: () => {
    store.updateSettings({ onboardingDone: true });
    ui.tab = 'frigo';
    render();
  }
};

// ===========================================================================
// Démarrage
// ===========================================================================

function wireEvents() {
  screen.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !screen.contains(target)) return;
    const handler = ACTIONS[target.dataset.action];
    if (!handler) return;
    event.preventDefault();
    handler(target, event);
  });

  screen.addEventListener('input', (event) => {
    const t = event.target;
    if (t.id === 'search') {
      ui.search = t.value;
      setHTML('#fridge-list', fridgeList());
    } else if (t.id === 'connect-text') {
      ui.onboarding.text = t.value;
    } else if (t.id === 'join-text') {
      ui.onboarding.joinText = t.value;
    } else if (t.id === 'ob-name') {
      ui.onboarding.name = t.value;
    }
  });

  screen.addEventListener('change', (event) => {
    const t = event.target;
    if (t.dataset.setting === 'userName') store.updateSettings({ userName: t.value.trim() });
    else if (t.id === 'model') store.updateSettings({ model: t.value });
    else if (t.id === 'batch-toggle') {
      ui.filters.batchOnly = t.checked;
      ui.recipeNote = null;
      rerenderKeepScroll();
    }
  });

  screen.addEventListener('submit', (event) => {
    if (event.target.id !== 'add-item') return;
    event.preventDefault();
    const input = document.getElementById('new-item');
    const value = input.value.trim();
    if (!value) return;
    if (store.addShoppingItem(value)) input.value = '';
    else toast('Déjà dans la liste');
    input.focus();
  });

  document.querySelector('.tabbar').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab) showTab(tab.dataset.tab);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    store.resume();
    if (!needsOnboarding()) {
      VIEWS[ui.tab].update?.('time'); // les jours restants changent après minuit
      updateChrome();
    }
  });
  window.addEventListener('online', () => onStoreChange('sync'));
  window.addEventListener('offline', () => onStoreChange('sync'));
}

function boot() {
  wireEvents();
  store.subscribe(onStoreChange);
  render();
  store.start();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
