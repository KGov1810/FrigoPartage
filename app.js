// Kookia — écrans et interactions.

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
  location: '', // filtre de l'écran Stock ('' = tous les lieux)
  priority: new Set(),
  customPriority: false,
  filters: { difficulty: '', maxMinutes: 0, batchOnly: false, diet: '', light: false, origins: [], wish: '' },
  favoritesOnly: false,
  generating: false,
  recipeNote: null,
  onboarding: { text: '', joinText: '', name: '', invite: '', message: null, busy: false }
};

const DIFFICULTY_LABEL = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile' };

/** Filtres de recettes + seuil « léger » choisi dans les Réglages. */
function currentFilters() {
  return { ...ui.filters, lightMax: state.settings.lightMaxKcal || 500 };
}

/** « Toutes », « 🇮🇹 Italienne, 🇯🇵 Japonaise », « « nouilles » »… */
function originSummary() {
  const labels = ui.filters.origins.map((id) => S.ORIGINS.find((o) => o.id === id)).filter(Boolean)
    .map((o) => `${o.emoji} ${o.label}`);
  const shown = labels.length > 3 ? [...labels.slice(0, 2), `+${labels.length - 2}`] : labels;
  const parts = [...shown];
  if (ui.filters.wish) parts.push(`« ${ui.filters.wish} »`);
  return parts.length ? parts.join(', ') : 'Toutes les cuisines';
}

function originFact(recipe) {
  const origin = S.originOf(recipe.origin);
  return origin ? html`<span>${origin.emoji} ${origin.label}</span>` : '';
}

function servingsLabel(n) {
  return `${n} personne${n > 1 ? 's' : ''}`;
}
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
  const count = (product.count ?? 1) > 1 ? html`<b class="count" aria-hidden="true">×${product.count}</b>` : '';
  return src
    ? html`<span class="thumb"><img src="${src}" alt="" loading="lazy">${count}</span>`
    : html`<span class="thumb">${S.category(product.category).emoji}${count}</span>`;
}

/** Le compteur façon magnet de frigo : jours ou mois restants, ou ancienneté pour les produits secs. */
function dayCounter(product) {
  const c = S.stockCounter(product, state.settings.alertDays);
  return html`<span class="days ${c.cls}" role="img" aria-label="${S.stockLabel(product)}"><b>${c.approx ? '≈' : ''}${c.number}</b><small>${c.label}</small></span>`;
}

/** Version très courte, pour les pastilles : « J-3 », « auj. », « 8 mois ici »… */
function shortExpiry(product) {
  const c = S.stockCounter(product, state.settings.alertDays);
  if (c.cls === 'pending') return 'date ?';
  if (c.label.endsWith('ici')) return `${c.number} ${c.label}`;
  if (c.label.includes('passé')) return store.productStatus(product) === 'expired' ? 'périmé' : 'à vérifier';
  if (c.label === 'dernier jour') return 'auj.';
  if (c.label === 'mois') return `${c.approx ? '≈' : ''}${c.number} mois`;
  return `${c.approx ? '≈' : ''}J-${c.number}`;
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
// Écran Stock (frigo, congélateur, placard, fruits et légumes)
// ===========================================================================

const LOCATION_ICON = { frigo: () => I.fridge, congelateur: () => I.snow, placard: () => I.cabinet, fruits: () => I.apple };

const fridgeView = {
  render() {
    return html`
      <header class="top"><div><h1>Stock</h1><p class="sync" id="sync-line"></p></div></header>
      <div id="fridge-alert"></div>
      <div class="chips location-filter" id="location-filter" role="group" aria-label="Lieu de rangement"></div>
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
    setHTML('#location-filter', locationFilter());
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

/** Filtre par lieu : Tout, Frigo, Congélateur, Placard, Fruits & légumes (avec le nombre de produits). */
function locationFilter() {
  if (!state.products.length) return '';
  const chips = [{ id: '', label: 'Tout' }, ...S.LOCATIONS];
  return chips.map((loc) => {
    const count = store.productsIn(loc.id).length;
    return html`<button class="chip filter-chip" data-action="set-location" data-value="${loc.id}" aria-pressed="${String(ui.location === loc.id)}">${loc.id ? LOCATION_ICON[loc.id]() : ''}${loc.label}<i>${count}</i></button>`;
  });
}

function fridgeList() {
  if (!state.products.length) {
    return html`
      <div class="empty">
        <div class="emoji">🧺</div>
        <h2>Rien en stock pour l'instant</h2>
        <p>Ajoutez ce que vous avez au frigo, au congélateur, au placard, et vos fruits et légumes : scannez un code-barres ou un ticket de caisse, choisissez dans la liste des fruits et légumes, ou tapez un nom.</p>
        <button class="primary" data-action="add-scan">${I.barcode}Scanner un code-barres</button>
        <button class="secondary" data-action="add-produce">${I.apple}Fruits et légumes</button>
        <button class="secondary" data-action="add-manual">${I.pencil}Saisir à la main</button>
      </div>`;
  }
  const query = simplify(ui.search.trim());
  const items = store.productsIn(ui.location).filter((p) => !query
    || simplify(p.name).includes(query)
    || simplify(S.category(p.category).label).includes(query));
  if (!items.length) {
    if (query) return html`<p class="hint">Aucun produit ne correspond à « ${ui.search.trim()} ».</p>`;
    return html`<div class="empty small"><p>Rien ${S.locationOf(ui.location).at} pour l'instant.</p>
      <button class="secondary" data-action="add-menu">${I.plus}Ajouter un produit</button></div>`;
  }

  const groups = [['pending', 'Date à compléter'], ['expired', 'Périmés'], ['soon', 'À consommer vite'],
    ['old', 'Oubliés depuis longtemps'], ['ok', 'En stock']];
  return groups.map(([status, title]) => {
    const list = items.filter((p) => store.productStatus(p) === status);
    if (!list.length) return '';
    const hint = status === 'pending'
      ? html`<p class="hint">Touchez un produit pour indiquer sa date (ou « Lire la date » pour la photographier).</p>`
      : status === 'old' ? html`<p class="hint">Au placard depuis plus de 6 mois : pensez-y pour vos prochaines recettes.</p>` : '';
    return html`<h2 class="section ${status}">${title}<small>${list.length}</small></h2>${hint}<div class="list">${list.map(productRow)}</div>`;
  });
}

function productRow(product) {
  const status = store.productStatus(product);
  const meta = [
    ui.location ? '' : S.locationOf(product.location).label,
    S.quantityLabel(product),
    S.stockShort(product),
    product.addedBy ? `par ${product.addedBy}` : ''
  ].filter(Boolean).join(', ');
  return html`
    <div class="product" data-id="${product.id}">
      <button class="consume" data-action="consume" data-id="${product.id}" aria-label="${(product.count ?? 1) > 1 ? `Consommé : un ${product.name} de moins (il en reste ${product.count - 1})` : `Consommé : retirer ${product.name} du stock`}"></button>
      <button class="product-main" data-action="edit" data-id="${product.id}">
        ${thumb(product)}
        <span class="product-text"><span class="product-name">${product.name}</span><span class="product-meta">${meta}</span></span>
        ${dayCounter(product)}
      </button>
    </div>`;
}

/** Le rond d'un produit consomme une unité ; le produit disparaît à la dernière. */
function consume(id) {
  const product = store.productById(id);
  if (!product) return;
  const last = (product.count ?? 1) <= 1;
  const row = screen.querySelector(`.product[data-id="${CSS.escape(id)}"]`);
  if (last) row?.classList.add('leaving');
  setTimeout(() => {
    const { before } = store.consumeOne([id]);
    if (!before.length) {
      row?.classList.remove('leaving');
      return;
    }
    const message = last
      ? `${product.name} : retiré du stock`
      : `${product.name} : il en reste ${product.count - 1}`;
    toast(message, 'Annuler', () => store.restoreProducts(before));
  }, last ? 180 : 0);
}

/** Ouvre le scanner tout de suite (dans le geste de l'utilisateur), puis la fiche avec le code lu. */
function scanThenEdit() {
  openScanner((code) => openEditor({ barcode: code }));
}

function openAddMenu() {
  const hasKey = Boolean(state.settings.claudeKey);
  const sheet = openSheet({
    render: () => html`
      <div class="menu">
        <button class="menu-item" data-action="scan">${I.barcode}<span>Scanner un code-barres<small>Nom et photo retrouvés automatiquement</small></span></button>
        <button class="menu-item" data-action="photo">${I.camera}<span>Prendre le produit en photo<small>${hasKey ? 'Claude reconnaît le produit et sa date' : "Lecture de la date sur l'emballage"}</small></span></button>
        <button class="menu-item" data-action="produce">${I.apple}<span>Fruits et légumes<small>Sans code-barres : choisissez dans la liste</small></span></button>
        <button class="menu-item" data-action="ticket">${I.receipt}<span>Scanner un ticket de caisse<small>${hasKey ? 'Tous les produits des courses d\'un coup' : 'Nécessite une clé Claude (Réglages)'}</small></span></button>
        <button class="menu-item" data-action="manual">${I.pencil}<span>Saisir à la main</span></button>
        <button class="secondary" data-action="close">Annuler</button>
      </div>`,
    actions: {
      scan: () => {
        sheet.close();
        scanThenEdit();
      },
      photo: () => {
        const filePromise = pickImage({ camera: true }); // dans le geste, sinon iOS refuse
        sheet.close();
        openEditor({ mode: 'photo', filePromise });
      },
      manual: () => {
        sheet.close();
        openEditor({ mode: 'manual' });
      },
      produce: () => {
        sheet.close();
        openProduceSheet();
      },
      ticket: () => {
        // Photo choisie dans le geste (règle d'iOS) ; sans clé, la fiche explique quoi faire.
        const filePromise = hasKey ? pickImage({ camera: false }) : null;
        sheet.close();
        openReceipt(filePromise);
      }
    }
  });
}

// ===========================================================================
// Fruits et légumes sans code-barres
// ===========================================================================

/** Grille de fruits et légumes courants : chaque toucher ajoute 1 ; lieu et date estimée automatiques. */
function openProduceSheet() {
  const picked = new Map(); // nom → { item, count }
  let query = '';

  const sheet = openSheet({
    tall: true,
    render,
    actions: {
      add: (el) => {
        const item = S.PRODUCE.find((x) => x.name === el.dataset.name)
          ?? { name: el.dataset.name, emoji: '🥬', place: 'fruits', days: S.estimateFreshDays(el.dataset.name, 'fruits') };
        const entry = picked.get(item.name) ?? { item, count: 0 };
        entry.count = Math.min(99, entry.count + 1);
        picked.set(item.name, entry);
        sheet.update();
      },
      minus: (el) => {
        const entry = picked.get(el.dataset.name);
        if (!entry) return;
        entry.count -= 1;
        if (entry.count <= 0) picked.delete(el.dataset.name);
        sheet.update();
      },
      plus: (el) => {
        const entry = picked.get(el.dataset.name);
        if (entry) entry.count = Math.min(99, entry.count + 1);
        sheet.update();
      },
      confirm: () => {
        const entries = [...picked.values()];
        if (!entries.length) return;
        entries.forEach(({ item, count }) => store.saveProduct({
          id: crypto.randomUUID(),
          name: item.name,
          category: 'fruits_legumes',
          quantity: '',
          count,
          location: item.place,
          dateKind: 'estimee',
          expiry: S.isoInDays(item.days),
          frozenAt: ''
        }));
        sheet.close();
        toast(`${S.plural(entries.length, 'produit ajouté', 'produits ajoutés')} (dates estimées)`);
      }
    },
    onInput: (event) => {
      if (event.target.name !== 'produce-search') return;
      query = event.target.value;
      const results = sheet.panel.querySelector('#produce-results');
      if (results) results.innerHTML = fmt(grid());
    }
  });

  function grid() {
    const q = simplify(query.trim());
    const items = S.PRODUCE.filter((x) => !q || simplify(x.name).includes(q));
    const custom = q && !S.PRODUCE.some((x) => simplify(x.name) === q)
      ? html`<button class="produce-chip custom" data-action="add" data-name="${query.trim()}">${I.plus}Ajouter « ${query.trim()} »</button>` : '';
    return html`${items.map((x) => html`<button class="produce-chip" data-action="add" data-name="${x.name}" aria-label="Ajouter ${x.name}"><span aria-hidden="true">${x.emoji}</span>${x.name}${picked.get(x.name) ? html`<b>${picked.get(x.name).count}</b>` : ''}</button>`)}${custom}`;
  }

  function render() {
    const entries = [...picked.values()];
    const total = entries.length;
    return html`
      <header class="sheet-head">
        <button class="link" data-action="close">Annuler</button>
        <h2>Fruits et légumes</h2>
        <button class="link strong" data-action="confirm" ${total ? '' : raw('disabled')}>Ajouter</button>
      </header>
      <div class="sheet-body">
        ${total ? html`
          <section class="group">
            <h2>Sélection</h2>
            ${entries.map(({ item, count }) => html`
              <div class="field"><span class="label-stack">${item.emoji} ${item.name}<small>${S.locationOf(item.place).label}, se garde ≈ ${S.durationText(item.days)}</small></span>
                <div class="stepper small">
                  <button data-action="minus" data-name="${item.name}" aria-label="Un ${item.name} de moins">−</button>
                  <output>${count}</output>
                  <button data-action="plus" data-name="${item.name}" aria-label="Un ${item.name} de plus">+</button>
                </div>
              </div>`)}
          </section>
          <button class="primary" data-action="confirm">${I.check}Ajouter ${S.plural(total, 'produit')} au stock</button>` : html`
          <p class="hint">Touchez ce que vous avez acheté (plusieurs fois pour en ajouter plusieurs). Le lieu et une date de conservation estimée sont choisis automatiquement ; modifiables ensuite.</p>`}
        <label class="search produce-search">${I.search}<input name="produce-search" type="search" placeholder="Chercher ou taper un nom" value="${query}" autocomplete="off" aria-label="Chercher un fruit ou un légume"></label>
        <div class="produce-grid" id="produce-results">${grid()}</div>
      </div>`;
  }
}

// ===========================================================================
// Fiche produit (ajout / modification)
// ===========================================================================

function openEditor({ product = null, draft = null, mode = 'manual', filePromise = null, shoppingItemId = null, barcode = '' } = {}) {
  const isNew = !product;
  const p = {
    id: crypto.randomUUID(), name: '', expiry: S.isoInDays(7), category: 'autre', quantity: '', count: 1,
    barcode: '', addedBy: '', createdAt: 0, image: '', imageUrl: '',
    location: ui.location || 'frigo', dateKind: '', frozenAt: '',
    ...(draft ?? {}), ...(product ?? {})
  };
  const view = { dateTouched: !isNew, locationTouched: !isNew || Boolean(draft?.location), busy: '', info: '', error: '', sameProductId: null };
  if (isNew && !draft?.location && p.name) {
    // Fruit ou légume reconnu (ex. rangé depuis la liste de courses) : son lieu habituel, date estimée.
    const produce = S.produceFor(p.name);
    if (produce) {
      p.location = produce.place;
      p.category = 'fruits_legumes';
      p.dateKind = 'estimee';
    }
  }
  if (!p.dateKind) setKind(S.KINDS_BY_LOCATION[p.location][0]);
  if (!isNew && S.dateKindOf(p) !== 'aucune' && !S.hasDate(p.expiry)) view.info = 'Date à compléter : saisissez-la, ou touchez « Lire la date » pour la photographier.';

  /** Change le type de date et prépare une date cohérente (estimée, congélation, aucune). */
  function setKind(kind) {
    p.dateKind = kind;
    if (kind === 'estimee' && !view.dateTouched) p.expiry = S.isoInDays(S.estimateFreshDays(p.name, p.location));
    if (kind === 'congele') {
      p.frozenAt = S.hasDate(p.frozenAt) ? p.frozenAt : S.isoInDays(0);
      p.expiry = S.freezerLimit(p.category, p.frozenAt);
    }
    if (kind === 'aucune') p.expiry = '';
    if ((kind === 'dlc' || kind === 'ddm') && !S.hasDate(p.expiry) && isNew && kind === 'dlc') p.expiry = S.isoInDays(7);
  }

  function setLocation(location) {
    p.location = location;
    const kinds = S.KINDS_BY_LOCATION[location];
    if (!kinds.includes(S.dateKindOf(p))) {
      view.dateTouched = false;
      setKind(kinds[0]);
    }
  }

  /** Mise à jour du statut sans tout redessiner (le sélecteur de date d'iOS resterait sinon bloqué). */
  function refreshStatus() {
    const status = sheet.panel.querySelector('.expiry-status');
    if (status) {
      status.className = `expiry-status ${S.stockStatus(p, state.settings.alertDays)}`;
      status.textContent = S.stockLabel(p);
    }
  }
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
      'set-loc': (el) => {
        view.locationTouched = true;
        setLocation(el.dataset.value);
        sheet.update();
      },
      'set-kind': (el) => {
        view.dateTouched = false;
        setKind(el.dataset.value);
        sheet.update();
      },
      freeze: () => {
        // Un produit qui va périmer gagne plusieurs mois au congélateur.
        p.location = 'congelateur';
        p.dateKind = 'congele';
        p.frozenAt = S.isoInDays(0);
        p.expiry = S.freezerLimit(p.category, p.frozenAt);
        store.saveProduct(p);
        toast(`${p.name} : au congélateur, idéalement avant ${S.formatDate(p.expiry, { month: 'long', year: 'numeric' })}`);
        sheet.close();
      },
      'remove-photo': () => {
        p.image = '';
        p.imageUrl = '';
        sheet.update();
      },
      'count-minus': () => {
        p.count = Math.max(1, (p.count ?? 1) - 1);
        sheet.update();
      },
      'count-plus': () => {
        p.count = Math.min(999, (p.count ?? 1) + 1);
        sheet.update();
      },
      'to-shopping': () => {
        view.info = store.addShoppingItem(p.name, S.quantityLabel(p)) ? 'Ajouté à la liste de courses.' : 'Déjà dans la liste de courses.';
        view.error = '';
        sheet.update();
      },
      consume: () => {
        const removed = store.removeProducts([p.id]);
        sheet.close();
        if (removed.length) toast(`${removed[0].name} : retiré du stock`, 'Annuler', () => store.restoreProducts(removed));
      },
      'add-to-same': () => {
        const same = store.productById(view.sameProductId);
        if (!same) return;
        const count = (same.count ?? 1) + (p.count ?? 1);
        store.saveProduct({ ...same, count });
        if (shoppingItemId) store.deleteShoppingItems([shoppingItemId]);
        toast(`${same.name} : ${count} en stock`);
        sheet.close();
      }
    },
    onInput(event) {
      const t = event.target;
      if (t.name === 'name') {
        p.name = t.value;
        const button = sheet.panel.querySelector('[data-action="save"]');
        if (button) button.disabled = !p.name.trim();
        if (event.type === 'change' && S.dateKindOf(p) === 'estimee' && !view.dateTouched) {
          // Durée estimée selon le fruit ou le légume tapé (sans tout redessiner).
          p.expiry = S.isoInDays(S.estimateFreshDays(p.name, p.location));
          const input = sheet.panel.querySelector('[name="expiry"]');
          if (input) input.value = p.expiry;
          refreshStatus();
        }
      } else if (t.name === 'quantity') {
        p.quantity = t.value;
      } else if (t.name === 'category' && event.type === 'change') {
        p.category = t.value;
        if (S.dateKindOf(p) === 'congele') p.expiry = S.freezerLimit(p.category, p.frozenAt);
        sheet.update();
      } else if (t.name === 'expiry' && event.type === 'change') {
        p.expiry = t.value; // vide = « date à compléter »
        view.dateTouched = true;
        refreshStatus();
        sheet.panel.querySelector('.default-date')?.remove();
      } else if (t.name === 'frozenAt' && event.type === 'change' && t.value) {
        p.frozenAt = t.value;
        p.expiry = S.freezerLimit(p.category, p.frozenAt);
        refreshStatus();
      }
    }
  });

  function dateSection() {
    const kind = S.dateKindOf(p);
    const kinds = S.KINDS_BY_LOCATION[p.location] ?? ['dlc'];
    const status = S.stockStatus(p, state.settings.alertDays);
    const quick = kind === 'ddm'
      ? [[30, '+1 mois'], [91, '+3 mois'], [182, '+6 mois'], [365, '+1 an']]
      : [[3, '+3 j'], [7, '+1 sem'], [14, '+2 sem'], [30, '+1 mois']];
    let fields;
    if (kind === 'aucune') {
      fields = html`<p class="hint inset">Pas de date : l'app suit depuis combien de temps il est ${S.locationOf(p.location).at}. Si le paquet porte une date, choisissez « De préférence (DDM) ».</p>`;
    } else if (kind === 'congele') {
      fields = html`<label class="field"><span>Congelé le</span><input type="date" name="frozenAt" value="${p.frozenAt}"></label>
        <p class="hint inset">Durée conseillée pour « ${S.category(p.category).label.toLowerCase()} » : ${S.FREEZER_MONTHS[p.category] ?? 6} mois (à ajuster avec la catégorie).</p>`;
    } else {
      fields = html`<label class="field"><span>${S.DATE_KINDS[kind].field}</span><input type="date" name="expiry" value="${p.expiry}"></label>
        <div class="quick">${quick.map(([days, label]) => html`<button data-action="quick" data-days="${days}">${label}</button>`)}</div>`;
    }
    return html`
      <section class="group">
        <h2>Date</h2>
        ${kinds.length > 1 ? html`<div class="segmented" role="group" aria-label="Type de date">
          ${kinds.map((k) => html`<button data-action="set-kind" data-value="${k}" aria-pressed="${String(kind === k)}">${S.DATE_KINDS[k].label}</button>`)}
        </div>` : ''}
        ${fields}
        <p class="expiry-status ${status}">${S.stockLabel(p)}</p>
        ${isNew && kind === 'dlc' && !view.dateTouched ? html`<p class="hint inset default-date">Date proposée par défaut : dans 7 jours. Vérifiez-la.</p>` : ''}
        ${kind === 'estimee' && !view.dateTouched ? html`<p class="hint inset default-date">Estimation selon le produit ; ajustez-la si besoin.</p>` : ''}
      </section>`;
  }

  function render() {
    return html`
      <header class="sheet-head">
        <button class="link" data-action="close">Annuler</button>
        <h2>${isNew ? 'Nouveau produit' : 'Modifier le produit'}</h2>
        <button class="link strong" data-action="save" ${p.name.trim() ? '' : raw('disabled')}>${isNew ? 'Ajouter' : 'Enregistrer'}</button>
      </header>
      <div class="sheet-body">
        ${view.info ? html`<p class="note ok">${view.info}</p>` : ''}
        ${view.error ? html`<p class="note warn">${view.error}</p>` : ''}
        ${sameProductNote()}
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
          <div class="field"><span>Nombre</span>
            <div class="stepper">
              <button data-action="count-minus" aria-label="Un de moins" ${(p.count ?? 1) <= 1 ? raw('disabled') : ''}>−</button>
              <output aria-live="polite">${p.count ?? 1}</output>
              <button data-action="count-plus" aria-label="Un de plus">+</button>
            </div>
          </div>
          <label class="field"><span>Poids ou contenance</span><input name="quantity" value="${p.quantity}" placeholder="2 kg, 500 g, 1 L…" autocomplete="off"></label>
          ${(p.count ?? 1) > 1 && p.quantity.trim() ? html`<p class="hint inset">En stock : ${S.quantityLabel(p)}</p>` : ''}
          ${p.image || p.imageUrl ? html`<button class="row-button danger" data-action="remove-photo">${I.trash}Retirer la photo</button>` : ''}
        </section>
        <section class="group">
          <h2>Rangement</h2>
          <div class="location-grid" role="group" aria-label="Lieu de rangement">
            ${S.LOCATIONS.map((loc) => html`<button data-action="set-loc" data-value="${loc.id}" aria-pressed="${String(p.location === loc.id)}">${LOCATION_ICON[loc.id]()}${loc.label}</button>`)}
          </div>
        </section>
        ${dateSection()}
        ${isNew ? '' : html`
          <section class="group">
            ${p.addedBy ? html`<div class="field"><span>Ajouté par</span><span class="muted">${p.addedBy}</span></div>` : ''}
            <button class="row-button" data-action="to-shopping">${I.cart}Ajouter à la liste de courses</button>
            ${p.location !== 'congelateur' && p.location !== 'placard' ? html`<button class="row-button" data-action="freeze">${I.snow}Congeler (se garde plusieurs mois)</button>` : ''}
            <button class="row-button" data-action="consume">${I.check}Consommé : retirer du stock</button>
          </section>`}
      </div>
      ${view.busy ? html`<div class="busy"><span class="spinner"></span><p>${view.busy}</p></div>` : ''}`;
  }

  /** Produit identique (même code-barres) déjà en stock : proposer d'augmenter son nombre. */
  function sameProductNote() {
    const same = isNew && view.sameProductId ? store.productById(view.sameProductId) : null;
    if (!same) return '';
    return html`
      <div class="note ok same-product">
        <span>Déjà ${S.locationOf(same.location).at} : ${same.name} (${S.quantityLabel(same) || '1'}, ${S.stockShort(same)}).</span>
        <button class="secondary" data-action="add-to-same">Ajouter ${p.count ?? 1} à ce produit</button>
        <small>Même date de péremption ? Ajoutez-le à l'existant. Sinon, enregistrez-le à part.</small>
      </div>`;
  }

  function save() {
    if (!p.name.trim() || view.busy) return;
    if (S.dateKindOf(p) === 'congele' && !S.hasDate(p.frozenAt)) p.frozenAt = S.isoInDays(0);
    if (p.expiry && !S.parseISODate(p.expiry)) {
      view.error = 'Indiquez une date de péremption valide.';
      sheet.update();
      return;
    }
    store.saveProduct(p);
    if (shoppingItemId) store.deleteShoppingItems([shoppingItemId]);
    toast(isNew ? `${p.name.trim()} : ajouté ${S.locationOf(p.location).at}` : 'Modifications enregistrées');
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
      if (!p.quantity && info.quantity) {
        const split = S.splitCount(info.quantity);
        p.quantity = split.quantity;
        if ((p.count ?? 1) === 1) p.count = split.count;
      }
      if (!p.image && info.imageUrl) p.imageUrl = info.imageUrl;
      if (!view.locationTouched) {
        const place = { surgele: 'congelateur', epicerie: 'placard', boisson: 'placard' }[info.category];
        if (place) setLocation(place);
      }
      if (S.dateKindOf(p) === 'congele') p.expiry = S.freezerLimit(p.category, p.frozenAt);
      view.sameProductId = state.products.find((x) => x.id !== p.id && x.barcode
        && S.normalizeBarcode(x.barcode) === S.normalizeBarcode(digits))?.id ?? null;
      view.info = 'Produit trouvé. Indiquez le nombre et la date de péremption (ou touchez « Lire la date »).';
    });
  }

    /** Une date lue sur l'emballage : DDM au placard ou au congélateur, date limite au frigo. */
  function applyReadDate(date) {
    p.expiry = date;
    view.dateTouched = true;
    if (p.location === 'placard' || p.location === 'congelateur') p.dateKind = 'ddm';
    else if (p.location === 'frigo' && S.dateKindOf(p) === 'estimee') p.dateKind = 'dlc';
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
        if (!view.locationTouched) {
          const place = { surgele: 'congelateur', epicerie: 'placard', boisson: 'placard' }[result.category]
            ?? (S.produceFor(result.name) ? S.produceFor(result.name).place : null);
          if (place) setLocation(place);
        }
        if (!p.quantity && result.quantity) {
          const split = S.splitCount(result.quantity);
          p.quantity = split.quantity;
          if ((p.count ?? 1) === 1) p.count = split.count;
        }
        if (result.expiry) {
          applyReadDate(result.expiry);
          view.info = "Produit et date reconnus : vérifiez-les avant d'enregistrer.";
        } else {
          view.info = 'Produit reconnu. Date illisible : touchez « Lire la date » pour la photographier de près, ou saisissez-la.';
        }
      } else {
        const date = S.parseExpiryDate(await S.recognizeText(file));
        if (date) {
          applyReadDate(date);
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
        applyReadDate(date);
        view.info = `Date lue${by} : ${longDate(date)}. Vérifiez-la.`;
      } else {
        view.error = 'Date illisible. Essayez une photo plus nette et bien éclairée, ou saisissez-la.';
      }
    });
  }

  // Lancement automatique selon le choix fait dans le menu « + ».
  if (barcode) handleBarcode(barcode);
  if (filePromise) {
    filePromise.then((file) => {
      if (file && sheet.isOpen) handleProductPhoto(file);
    });
  }
  if (mode === 'manual' && isNew && !p.name && !barcode) {
    setTimeout(() => sheet.panel.querySelector('[name="name"]')?.focus(), 350);
  }
  return sheet;
}

// ===========================================================================
// Scanner de code-barres
// ===========================================================================

/**
 * Plein écran caméra. L'app gère la caméra elle-même et surveille l'image :
 * si la vidéo ne démarre pas ou reste noire, elle le dit et propose des solutions
 * (toucher pour démarrer, réessayer, photographier le code, taper les chiffres).
 */
function openScanner(onCode) {
  const overlay = document.createElement('div');
  overlay.className = 'scanner';
  overlay.innerHTML = fmt(html`
    <video playsinline muted autoplay></video>
    <div class="scan-frame" aria-hidden="true"></div>
    <div class="scan-top"><button data-action="close">Annuler</button></div>
    <div class="scan-bottom">
      <p class="scan-hint" role="status">Ouverture de la caméra…</p>
      <div class="scan-actions" hidden>
        <button class="scan-start" data-action="start-video">Démarrer la caméra</button>
        <button class="scan-retry" data-action="retry">Réessayer</button>
      </div>
      <form class="scan-manual">
        <input inputmode="numeric" pattern="[0-9]*" placeholder="Ou tapez les chiffres" autocomplete="off" aria-label="Chiffres du code-barres">
        <button type="submit">OK</button>
      </form>
      <button class="scan-photo" data-action="photo">Photographier le code-barres</button>
    </div>`);
  document.body.append(overlay);
  document.body.classList.add('scanning');

  const video = overlay.querySelector('video');
  const hint = overlay.querySelector('.scan-hint');
  const actions = overlay.querySelector('.scan-actions');
  const startButton = overlay.querySelector('.scan-start');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  let camera = null;
  let decode = null;
  let loopTimer = null;
  let watchdog = null;
  let finished = false;
  let session = 0;
  let darkFrames = 0;

  const say = (text) => { hint.textContent = text; };
  const showActions = (start, retry) => {
    actions.hidden = !start && !retry;
    startButton.hidden = !start;
    overlay.querySelector('.scan-retry').hidden = !retry;
  };

  function stopCamera() {
    session += 1;
    clearTimeout(loopTimer);
    clearTimeout(watchdog);
    camera?.stop();
    camera = null;
  }

  function finish(code) {
    if (finished) return;
    finished = true;
    stopCamera();
    document.removeEventListener('visibilitychange', onVisibility);
    document.body.classList.remove('scanning');
    overlay.remove();
    if (code) onCode(code);
  }

  function isShowingImage() {
    return video.readyState >= 2 && video.videoWidth > 0 && !video.paused;
  }

  async function begin() {
    stopCamera();
    const current = session;
    showActions(false, false);
    say('Ouverture de la caméra…');
    try {
      const opened = await S.startCamera(video);
      if (current !== session || finished) {
        opened.stop();
        return;
      }
      camera = opened;
    } catch (error) {
      if (current !== session || finished) return;
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        say("Accès à la caméra refusé. Autorisez-le dans Réglages de l'iPhone > Safari > Caméra, puis touchez « Réessayer ». Vous pouvez aussi taper les chiffres.");
      } else {
        say('Caméra indisponible. Touchez « Réessayer », photographiez le code-barres ou tapez les chiffres.');
      }
      showActions(false, true);
      return;
    }

    if (!camera.playing) {
      say('Touchez « Démarrer la caméra » pour afficher l\'image.');
      showActions(true, false);
    } else {
      say('Placez le code-barres dans le cadre');
    }

    // Surveillance : pas d'image au bout de 4 s → on le dit clairement.
    watchdog = setTimeout(() => {
      if (current !== session || finished || isShowingImage()) return;
      say("La caméra ne s'affiche pas. Touchez « Démarrer la caméra » ; si l'écran reste noir, « Réessayer », ou fermez complètement l'app et rouvrez-la.");
      showActions(true, true);
    }, 4000);

    try {
      decode = decode ?? await S.createBarcodeDecoder();
    } catch {
      if (current === session) {
        say('Lecteur de code-barres non téléchargé (connexion ?). Tapez les chiffres sous le code-barres.');
      }
      return;
    }
    scanLoop(current);
  }

  /** Analyse la bande centrale de l'image environ 6 fois par seconde. */
  async function scanLoop(current) {
    if (current !== session || finished) return;
    if (isShowingImage()) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const bandHeight = Math.round(h * 0.45);
      const scale = Math.min(1, 1000 / w);
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(bandHeight * scale);
      context.drawImage(video, 0, Math.round((h - bandHeight) / 2), w, bandHeight, 0, 0, canvas.width, canvas.height);

      // Image entièrement noire pendant plus de 3 s : caméra bloquée par iOS.
      const pixel = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      darkFrames = pixel[0] + pixel[1] + pixel[2] < 6 ? darkFrames + 1 : 0;
      if (darkFrames === 20) {
        say("L'image reste noire. Touchez « Réessayer » ; si rien ne change, fermez complètement l'app (balayez-la vers le haut) et rouvrez-la.");
        showActions(false, true);
      }

      const code = await decode(canvas);
      if (code && current === session && !finished) {
        finish(code);
        return;
      }
    }
    loopTimer = setTimeout(() => scanLoop(current), 160);
  }

  // iOS coupe la caméra quand l'app passe en arrière-plan : on la relance au retour.
  function onVisibility() {
    if (finished) return;
    if (document.visibilityState === 'hidden') stopCamera();
    else begin();
  }
  document.addEventListener('visibilitychange', onVisibility);

  overlay.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'close') finish(null);
    if (action === 'retry') begin();
    if (action === 'start-video') {
      // Lancée dans le geste de l'utilisateur, la vidéo est toujours acceptée par iOS.
      video.play().then(() => {
        showActions(false, false);
        say('Placez le code-barres dans le cadre');
      }).catch(() => {
        say('La caméra ne démarre pas. Touchez « Réessayer » ou tapez les chiffres.');
        showActions(false, true);
      });
    }
    if (action === 'photo') {
      stopCamera(); // libère la caméra pour l'appareil photo d'iOS
      pickImage({ camera: true }).then(async (file) => {
        if (!file) {
          say('Photo annulée. Touchez « Réessayer » pour relancer la caméra, ou tapez les chiffres.');
          showActions(false, true);
          return;
        }
        say('Lecture du code-barres…');
        const code = await S.decodeBarcodeFromImage(file).catch(() => null);
        if (code) finish(code);
        else {
          say('Code-barres illisible sur la photo. Tapez les chiffres, ou touchez « Réessayer ».');
          showActions(false, true);
        }
      });
    }
  });

  overlay.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const digits = event.target.querySelector('input').value.replace(/\D/g, '');
    if (digits.length >= 8) finish(digits);
    else say('Un code-barres compte 8 ou 13 chiffres.');
  });

  begin();
}

// ===========================================================================
// Ticket de caisse
// ===========================================================================

/**
 * Photos du ticket → analyse par Claude → vérification → ajout au stock.
 * Pas de date sur un ticket : frigo « date à compléter », congélateur et fruits/légumes
 * en date estimée, placard sans date (ancienneté).
 */
function openReceipt(firstFilePromise) {
  const view = { stage: 'photos', photos: [], items: [], busy: '', error: '' };
  const hasKey = () => Boolean(state.settings.claudeKey);

  const sheet = openSheet({
    tall: true,
    render,
    actions: {
      'add-photo': () => {
        pickImage({ camera: false }).then((file) => file && addPhoto(file));
      },
      'remove-photo': (el) => {
        view.photos.splice(Number(el.dataset.index), 1);
        sheet.update();
      },
      analyze: () => analyze(),
      'toggle-line': (el) => {
        const item = view.items[Number(el.dataset.index)];
        item.selected = !item.selected;
        sheet.update();
      },
      'line-minus': (el) => {
        const item = view.items[Number(el.dataset.index)];
        item.count = Math.max(1, item.count - 1);
        sheet.update();
      },
      'line-plus': (el) => {
        const item = view.items[Number(el.dataset.index)];
        item.count = Math.min(99, item.count + 1);
        sheet.update();
      },
      'back-to-photos': () => {
        view.stage = 'photos';
        view.items = [];
        sheet.update();
      },
      confirm: () => confirmItems()
    },
    onInput(event) {
      const t = event.target;
      const item = view.items[Number(t.dataset.index)];
      if (!item) return;
      if (t.dataset.field === 'name') item.name = t.value;
      if (t.dataset.field === 'quantity') item.quantity = t.value;
      if (t.dataset.field === 'location') item.location = t.value;
    }
  });

  function selected() {
    return view.items.filter((i) => i.selected && i.name.trim());
  }

  function render() {
    const head = view.stage === 'review'
      ? html`<button class="link strong" data-action="confirm" ${selected().length ? '' : raw('disabled')}>Ajouter</button>`
      : html`<span></span>`;
    return html`
      <header class="sheet-head">
        <button class="link" data-action="close">Annuler</button>
        <h2>Ticket de caisse</h2>
        ${head}
      </header>
      <div class="sheet-body">
        ${view.error ? html`<p class="note warn">${view.error}</p>` : ''}
        ${!hasKey()
          ? html`<p class="note warn">La lecture d'un ticket nécessite une clé Claude : ajoutez-la dans Réglages → Recettes et photos.</p>`
          : view.stage === 'photos' ? photosStep() : reviewStep()}
      </div>
      ${view.busy ? html`<div class="busy"><span class="spinner"></span><p>${view.busy}</p></div>` : ''}`;
  }

  function photosStep() {
    return html`
      <p class="hint">Photographiez le ticket bien à plat, avec de la lumière. S'il est long, prenez plusieurs photos de haut en bas. Une capture d'écran de commande en ligne fonctionne aussi.</p>
      ${view.photos.length ? html`
        <div class="receipt-photos">
          ${view.photos.map((photo, index) => html`
            <div class="receipt-photo"><img src="${photo.preview}" alt="Photo ${index + 1} du ticket">
              <button class="icon-btn" data-action="remove-photo" data-index="${index}" aria-label="Retirer la photo ${index + 1}">${I.x}</button>
            </div>`)}
        </div>` : ''}
      <div class="row-actions">
        <button class="secondary" data-action="add-photo">${I.camera}${view.photos.length ? 'Ajouter une photo (suite du ticket)' : 'Photographier le ticket'}</button>
        ${view.photos.length ? html`<button class="primary" data-action="analyze">${I.sparkle}Lire le ticket</button>` : ''}
      </div>
      <p class="hint">La photo est envoyée à Claude pour être lue ; elle n'est pas conservée dans l'app.</p>`;
  }

  function reviewStep() {
    if (!view.items.length) {
      return html`
        <p class="note warn">Aucun produit alimentaire reconnu sur ce ticket.</p>
        <button class="secondary" data-action="back-to-photos">Reprendre les photos</button>`;
    }
    const onList = view.items.filter((i) => i.selected && i.shoppingId);
    return html`
      <p class="note ok">${S.plural(view.items.length, 'produit reconnu', 'produits reconnus')}. Vérifiez les noms, les nombres et le lieu ; décochez ce qui ne va pas en stock. Les dates du frigo seront à compléter ; placard, congélateur, fruits et légumes n'en ont pas besoin.</p>
      <section class="group">
        ${view.items.map((item, index) => html`
          <div class="receipt-line ${item.selected ? '' : 'off'}">
            <button class="pick-box" role="checkbox" aria-checked="${String(item.selected)}" data-action="toggle-line" data-index="${index}" aria-label="Garder ${item.name}"><span class="box">${I.check}</span></button>
            <span class="thumb">${S.category(item.category).emoji}</span>
            <div class="receipt-fields">
              <input data-field="name" data-index="${index}" value="${item.name}" aria-label="Nom du produit" autocomplete="off">
              <small>${item.receiptText ? `« ${item.receiptText} »` : ''}${item.shoppingId ? html` <b class="on-list">sur votre liste</b>` : ''}</small>
              <div class="receipt-qty">
                <div class="stepper small">
                  <button data-action="line-minus" data-index="${index}" aria-label="Un de moins" ${item.count <= 1 ? raw('disabled') : ''}>−</button>
                  <output>${item.count}</output>
                  <button data-action="line-plus" data-index="${index}" aria-label="Un de plus">+</button>
                </div>
                <input data-field="quantity" data-index="${index}" value="${item.quantity}" placeholder="Poids" aria-label="Poids ou contenance" autocomplete="off">
              </div>
              <select class="receipt-location" data-field="location" data-index="${index}" aria-label="Lieu de rangement">
                ${S.LOCATIONS.map((loc) => html`<option value="${loc.id}" ${item.location === loc.id ? raw('selected') : ''}>${loc.label}</option>`)}
              </select>
            </div>
          </div>`)}
      </section>
      ${onList.length ? html`<p class="hint">Retirés de la liste de courses à l'ajout : ${onList.map((i) => i.shoppingName).join(', ')}.</p>` : ''}
      <button class="primary" data-action="confirm" ${selected().length ? '' : raw('disabled')}>${I.check}Ajouter ${S.plural(selected().length, 'produit')} au stock</button>
      <button class="link" data-action="back-to-photos">Reprendre les photos</button>`;
  }

  async function addPhoto(file) {
    try {
      const { dataUrl, base64 } = await S.resizeImage(file, 1568, 0.85);
      view.photos.push({ preview: dataUrl, base64 });
      view.error = '';
    } catch (error) {
      view.error = error?.message || 'Photo illisible.';
    }
    if (sheet.isOpen) sheet.update();
  }

  async function analyze() {
    if (!view.photos.length || view.busy) return;
    view.busy = view.photos.length > 1 ? `Claude lit les ${view.photos.length} photos du ticket…` : 'Claude lit le ticket…';
    view.error = '';
    sheet.update();
    try {
      const items = await S.analyzeReceipt({
        key: state.settings.claudeKey,
        model: state.settings.model,
        images: view.photos.map((p) => p.base64)
      });
      // Repère les articles de la liste de courses achetés (chacun au plus une fois).
      const used = new Set();
      view.items = items.map((item) => {
        const match = state.shopping.find((s) => !used.has(s.id)
          && (S.nameMatchScore(s.name, item.name) > 0 || S.nameMatchScore(s.name, item.receiptText) > 0));
        if (match) used.add(match.id);
        return { ...item, selected: true, shoppingId: match?.id ?? null, shoppingName: match?.name ?? '' };
      });
      view.stage = 'review';
    } catch (error) {
      view.error = error?.message || String(error);
    } finally {
      view.busy = '';
      if (sheet.isOpen) sheet.update();
    }
  }

  function confirmItems() {
    const items = selected();
    if (!items.length) return;
    const shoppingIds = items.map((i) => i.shoppingId).filter(Boolean);
    const added = store.addReceiptProducts(items, shoppingIds);
    sheet.close();
    toast(`${S.plural(added, 'produit ajouté', 'produits ajoutés')} au stock`);
    showTab('frigo');
  }

  if (firstFilePromise) {
    firstFilePromise.then((file) => {
      if (file && sheet.isOpen) addPhoto(file);
    });
  }
  return sheet;
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
      .filter((r) => S.matchesFilters(r, currentFilters()) && (!ui.favoritesOnly || r.favorite));
    const compatible = store.compatibleRecipes({ priorityIds: ui.priority, filters: currentFilters() });
    const servings = state.settings.servings || 2;
    const hiddenOld = state.recipes.filter((r) => S.lacksTagsFor(r, currentFilters())).length;

    return html`
      <header class="top">
        <h1>Recettes</h1>
        <button class="icon-btn" data-action="toggle-favorites" aria-pressed="${String(ui.favoritesOnly)}" aria-label="Afficher seulement les favoris">${I.star}</button>
      </header>

      <section class="group">
        <h2>À utiliser en priorité</h2>
        ${priority.length
          ? html`<div class="chips">${priority.map((p) => html`<span class="chip">${S.category(p.category).emoji} ${p.name} <i class="${store.productStatus(p)}">${shortExpiry(p)}</i></span>`)}</div>`
          : html`<p class="hint inset">${state.products.length
            ? 'Aucun produit ne périme bientôt. Choisissez-en, ou laissez Claude piocher dans tout le stock.'
            : 'Le stock est vide : Claude partira de la liste de courses.'}</p>`}
        <button class="row-button" data-action="pick-products" ${state.products.length ? '' : raw('disabled')}>${I.check}Choisir les produits</button>
      </section>

      <section class="group">
        <div class="field"><span>Pour</span>
          <div class="stepper">
            <button data-action="servings-minus" aria-label="Une personne de moins" ${servings <= 1 ? raw('disabled') : ''}>−</button>
            <output>${servingsLabel(servings)}</output>
            <button data-action="servings-plus" aria-label="Une personne de plus" ${servings >= 12 ? raw('disabled') : ''}>+</button>
          </div>
        </div>
        <span class="filter-label">Régime</span>
        <div class="segmented" role="group" aria-label="Régime">
          ${S.DIETS.map((d) => html`<button data-action="set-diet" data-value="${d.id}" aria-pressed="${String(ui.filters.diet === d.id)}">${d.label}</button>`)}
        </div>
        <button class="field field-button" data-action="pick-origin">
          <span class="label-stack">Origine<small>${originSummary()}</small></span>
          <span class="chevron" aria-hidden="true">›</span>
        </button>
        <span class="filter-label">Difficulté</span>
        <div class="segmented" role="group" aria-label="Difficulté">
          ${[['', 'Toutes'], ...S.DIFFICULTIES.map((d) => [d.id, d.label])].map(([value, label]) => html`<button data-action="set-difficulty" data-value="${value}" aria-pressed="${String(ui.filters.difficulty === value)}">${label}</button>`)}
        </div>
        <span class="filter-label">Temps total maximum</span>
        <div class="segmented" role="group" aria-label="Temps total maximum">
          ${S.TIME_FILTERS.map((t) => html`<button data-action="set-time" data-value="${t.max}" aria-pressed="${String(ui.filters.maxMinutes === t.max)}">${t.label}</button>`)}
        </div>
        <label class="field">
          <span class="label-stack">Batch cooking<small>Se prépare en avance et se garde plusieurs jours</small></span>
          <input type="checkbox" class="switch" id="batch-toggle" ${ui.filters.batchOnly ? raw('checked') : ''}>
        </label>
        <label class="field">
          <span class="label-stack">Léger<small>${state.settings.lightMaxKcal || 500} kcal maximum par portion</small></span>
          <input type="checkbox" class="switch" id="light-toggle" ${ui.filters.light ? raw('checked') : ''}>
        </label>
      </section>

      ${compatible.length ? html`
        <h2 class="section">Déjà dans vos recettes<small>${compatible.length}</small></h2>
        <p class="hint">Réalisables avec votre stock actuel, sans nouvelle génération (gratuit).</p>
        <div class="list">${compatible.map((c) => recipeCard(c.recipe, c))}</div>` : ''}

      <button class="${compatible.length ? 'secondary' : 'primary'} generate" data-action="generate" ${canGenerate ? '' : raw('disabled')}>
        ${ui.generating ? html`<span class="spinner"></span>Claude cuisine… (environ 30 s)` : html`${I.sparkle}${compatible.length ? 'Proposer 5 nouvelles recettes' : 'Proposer 5 recettes'}`}
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
            : recipes.map((recipe) => recipeCard(recipe))}
      </div>
      ${hiddenOld ? html`<p class="hint">${S.plural(hiddenOld, 'recette ancienne', 'recettes anciennes')} (sans régime, calories ou origine) ${hiddenOld > 1 ? 'sont masquées' : 'est masquée'} avec ces filtres.</p>` : ''}`;
  },
  update() {
    rerenderKeepScroll();
  }
};

function recipeCard(recipe, availability = store.recipeAvailability(recipe, ui.priority)) {
  const { inFridge, missing, urgentUsed } = availability;
  let fit = '';
  if (inFridge.length) {
    const missingText = missing.length === 0
      ? 'tout est en stock'
      : `manque ${missing.slice(0, 2).map((i) => i.name.toLowerCase()).join(', ')}${missing.length > 2 ? '…' : ''}`;
    fit = html`<span class="uses">Utilise ${S.plural(inFridge.length, 'produit')} en stock${urgentUsed ? html`, <b class="urgent">dont ${urgentUsed} à consommer vite</b>` : ''}, ${missingText}</span>`;
  }
  return html`
    <button class="recipe-card" data-action="open-recipe" data-id="${recipe.id}">
      <h3><span>${recipe.title}</span>${recipe.favorite ? I.star : ''}</h3>
      ${recipe.summary ? html`<p>${recipe.summary}</p>` : ''}
      <span class="facts">
        <span>${I.clock}${S.formatMinutes(recipe.totalMinutes)}</span>
        <span>${I.gauge}${DIFFICULTY_LABEL[recipe.difficulty] ?? recipe.difficulty}</span>
        ${S.isBatchFriendly(recipe) ? html`<span>${I.box}Se garde ${S.plural(recipe.storageDays, 'jour')}</span>` : ''}
        ${recipe.kcal > 0 ? html`<span>${I.flame}≈ ${recipe.kcal} kcal</span>` : ''}
        ${S.DIET_LABEL[recipe.diet] ? html`<span class="diet">${I.leaf}${S.DIET_LABEL[recipe.diet]}</span>` : ''}
        ${originFact(recipe)}
      </span>
      ${fit}
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
    const filters = currentFilters();
    const recipes = await S.generateRecipes({
      key: state.settings.claudeKey,
      model: state.settings.model,
      priority,
      others,
      shopping: state.shopping,
      filters,
      servings: state.settings.servings || 2
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
            <button class="pick" role="checkbox" aria-checked="${String(ui.priority.has(p.id))}" data-action="toggle" data-id="${p.id}">
              <span class="box">${I.check}</span>
              ${thumb(p)}
              <span class="product-text"><span class="product-name">${p.name}</span><span class="product-meta">${S.stockLabel(p)}</span></span>
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

/** Cuisines à cocher (plusieurs possibles) + envie libre. « Tour du monde » exclut les autres. */
function openOriginPicker() {
  const draft = { origins: new Set(ui.filters.origins), wish: ui.filters.wish };
  const sheet = openSheet({
    tall: true,
    render: () => html`
      <header class="sheet-head">
        <button class="link" data-action="clear">Effacer</button>
        <h2>Origine</h2>
        <button class="link strong" data-action="done">OK</button>
      </header>
      <div class="sheet-body">
        <section class="group">
          <label class="field stack"><span>Envie de…</span>
            <input name="wish" value="${draft.wish}" placeholder="nouilles, couscous, ramen, curry…" autocomplete="off" enterkeyhint="done">
          </label>
        </section>
        <h2 class="section">Cuisines<small>${draft.origins.size ? `${draft.origins.size} choisie${draft.origins.size > 1 ? 's' : ''}` : 'toutes'}</small></h2>
        <div class="origin-grid" role="group" aria-label="Cuisines">
          ${S.ORIGINS.map((o) => html`<button class="origin-chip" data-action="toggle-origin" data-id="${o.id}" aria-pressed="${String(draft.origins.has(o.id))}"><span aria-hidden="true">${o.emoji}</span>${o.label}</button>`)}
        </div>
        <p class="hint">Plusieurs choix possibles. Avec une cuisine ou une envie, Claude peut prévoir jusqu'à 6 ingrédients à acheter par recette pour rester fidèle à l'originale.</p>
      </div>`,
    actions: {
      'toggle-origin': (el) => {
        const id = el.dataset.id;
        if (draft.origins.has(id)) {
          draft.origins.delete(id);
        } else {
          if (id === 'monde') draft.origins.clear();
          else draft.origins.delete('monde');
          draft.origins.add(id);
        }
        sheet.update();
      },
      clear: () => {
        draft.origins.clear();
        draft.wish = '';
        sheet.update();
      },
      done: () => {
        ui.filters.origins = [...draft.origins];
        ui.filters.wish = draft.wish.trim().slice(0, 80);
        ui.recipeNote = null;
        sheet.close();
        rerenderIf('recettes');
      }
    },
    onInput: (event) => {
      if (event.target.name === 'wish') draft.wish = event.target.value;
    }
  });
}

function recipeShareText(recipe, servings = recipe.servings) {
  const factor = servings / (recipe.servings || servings);
  const lines = [recipe.title];
  if (recipe.summary) lines.push(recipe.summary);
  const infos = [S.formatMinutes(recipe.totalMinutes), (DIFFICULTY_LABEL[recipe.difficulty] ?? '').toLowerCase(), `pour ${S.plural(servings, 'portion')}`];
  if (recipe.kcal > 0) infos.push(`environ ${recipe.kcal} kcal par portion`);
  const origin = S.originOf(recipe.origin);
  if (origin) infos.push(`cuisine ${origin.label.toLowerCase()}`);
  lines.push('', infos.join(', '));
  lines.push('', 'Ingrédients :', ...recipe.ingredients.map((i) => {
    const quantity = S.scaleIngredient(i, factor);
    return `- ${quantity ? `${quantity} ` : ''}${i.name}`;
  }));
  lines.push('', 'Préparation :', ...recipe.steps.map((s, n) => `${n + 1}. ${s}`));
  if (recipe.storageTips) lines.push('', `Conservation : ${recipe.storageTips}`);
  return lines.join('\n');
}

function openRecipe(id) {
  let servings = null; // nombre de portions affiché (null = celui de la recette)
  const baseServings = (recipe) => Math.max(1, recipe.servings || 2);
  const shownServings = (recipe) => servings ?? baseServings(recipe);
  const factorFor = (recipe) => shownServings(recipe) / baseServings(recipe);

  const sheet = openSheet({
    tall: true,
    render,
    onData: () => sheet.update(),
    actions: {
      favorite: () => store.toggleFavorite(id),
      'portions-minus': () => {
        const recipe = findRecipe();
        if (!recipe) return;
        servings = Math.max(1, shownServings(recipe) - 1);
        sheet.update();
      },
      'portions-plus': () => {
        const recipe = findRecipe();
        if (!recipe) return;
        servings = Math.min(24, shownServings(recipe) + 1);
        sheet.update();
      },
      'add-missing': () => {
        const recipe = findRecipe();
        if (!recipe) return;
        const added = store.addMissingIngredients(recipe, factorFor(recipe));
        toast(added ? `${S.plural(added, 'ingrédient')} ajouté${added > 1 ? 's' : ''} aux courses` : 'Déjà dans la liste de courses');
      },
      cooked: () => {
        const recipe = findRecipe();
        if (!recipe) return;
        const used = store.recipeAvailability(recipe).inFridge;
        if (!used.length) return;
        const list = used.map((p) => ((p.count ?? 1) > 1 ? `${p.name} (1 sur ${p.count})` : p.name)).join(', ');
        if (!window.confirm(`Retirer une unité du stock : ${list} ?`)) return;
        const { before } = store.consumeOne(used.map((p) => p.id));
        toast(`${S.plural(before.length, 'produit')} mis à jour dans le stock`, 'Annuler', () => store.restoreProducts(before));
      },
      share: () => {
        const recipe = findRecipe();
        if (recipe) shareText(recipeShareText(recipe, shownServings(recipe)), recipe.title);
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
    const availability = store.recipeAvailability(recipe);
    const used = availability.inFridge;
    const missing = availability.missing;
    const prep = recipe.prepMinutes && recipe.prepMinutes < recipe.totalMinutes
      ? `, dont ${S.formatMinutes(recipe.prepMinutes)} de préparation` : '';
    return html`
      <header class="sheet-head">
        <button class="icon-btn" data-action="favorite" aria-pressed="${String(Boolean(recipe.favorite))}" aria-label="${recipe.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${I.star}</button>
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
            ${S.DIET_LABEL[recipe.diet] ? html`<span class="diet">${I.leaf}${S.DIET_LABEL[recipe.diet]}</span>` : ''}
            ${originFact(recipe)}
          </div>
          <p class="kcal">${recipe.kcal > 0
            ? html`${I.flame}≈ ${recipe.kcal} kcal par portion <small>(estimation)</small>`
            : html`<small>Calories non estimées (recette créée avant cette fonction).</small>`}</p>
        </div>

        <section class="group">
          <h2>Ingrédients</h2>
          <div class="field"><span>Portions</span>
            <div class="stepper">
              <button data-action="portions-minus" aria-label="Une portion de moins" ${shownServings(recipe) <= 1 ? raw('disabled') : ''}>−</button>
              <output aria-live="polite">${shownServings(recipe)}</output>
              <button data-action="portions-plus" aria-label="Une portion de plus">+</button>
            </div>
          </div>
          ${shownServings(recipe) !== baseServings(recipe) ? html`<p class="hint inset">Quantités recalculées (recette prévue pour ${baseServings(recipe)}). Les temps de cuisson restent indicatifs.</p>` : ''}
          ${availability.rows.map((row) => ingredientRow(row, factorFor(recipe)))}
          ${missing.length ? html`<button class="row-button" data-action="add-missing">${I.cart}${missing.length > 1 ? `Ajouter les ${missing.length} ingrédients qui manquent aux courses` : "Ajouter l'ingrédient qui manque aux courses"}</button>` : ''}
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
        ${used.length ? html`<p class="hint">« J'ai cuisiné » retire une unité de : ${used.map((p) => p.name).join(', ')}.</p>` : ''}
      </div>`;
  }
}

/** « Au placard », « Au congélateur (même code-barres) », « Au frigo (produit similaire) »… */
function whereLabel(product, via) {
  const at = S.locationOf(product.location).at;
  const place = at.charAt(0).toUpperCase() + at.slice(1);
  if (via === 'code-barres') return `${place} (même code-barres)`;
  if (via === 'nom') return `${place} (produit similaire)`;
  return place;
}

function ingredientRow({ ingredient, product, via, inShopping }, factor = 1) {
  const source = SOURCE[ingredient.source] ? ingredient.source : 'a_acheter';
  let where;
  if (product) where = whereLabel(product, via);
  else if (source === 'placard') where = SOURCE.placard.label;
  else if (inShopping) where = 'Sur la liste de courses';
  else if (ingredient.productId) where = 'Plus en stock';
  else where = 'À acheter';
  const detail = [S.scaleIngredient(ingredient, factor), where].filter(Boolean).join(', ');
  const iconSource = product ? 'stock' : (source === 'placard' ? 'placard' : (inShopping ? 'courses' : 'a_acheter'));
  const productNote = product && via !== 'origine' ? html`<small class="matched">${product.name}</small>` : '';
  return html`
    <div class="ingredient">
      <span class="src ${iconSource}">${SOURCE[iconSource].icon}</span>
      <div><span>${ingredient.name}</span><small>${detail}</small>${productNote}</div>
      ${product ? dayCounter(product) : ''}
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
        <input id="new-item" placeholder="Article à acheter" autocomplete="off" enterkeyhint="done" aria-label="Article à acheter">
        <input id="new-qty" class="qty" placeholder="Qté" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" enterkeyhint="done" aria-label="Nombre à acheter (facultatif)">
        <button type="submit" aria-label="Ajouter">${I.plus}</button>
      </form>
      <p class="hint add-hint">Qté : un nombre, facultatif. Pour un poids, écrivez-le avec l'article (« Farine 1 kg »). Touchez un article pour le modifier.</p>
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
          <p>Ajoutez des articles ici, depuis une recette, ou depuis la fiche d'un produit en stock.</p>
        </div>`,
      toBuy.length ? html`<h2 class="section">À acheter<small>${toBuy.length}</small></h2><div class="list">${toBuy.map(shoppingRow)}</div>` : '',
      inCart.length ? html`
        <h2 class="section">Dans le panier<small>${inCart.length}</small></h2>
        <div class="list">${inCart.map(shoppingRow)}</div>
        <p class="hint">Touchez l'icône de rangement d'un article pour l'ajouter au stock.</p>` : ''
    ]);
  }
};

/** « En stock : 2 au placard » : pour éviter d'acheter en double. */
function stockNote(item) {
  const matches = store.stockMatches(item.name);
  if (!matches.length) return '';
  const count = matches.reduce((n, p) => n + (p.count ?? 1), 0);
  const places = [...new Set(matches.map((p) => S.locationOf(p.location).at))].join(' et ');
  return `En stock : ${count} ${places}`;
}

function shoppingRow(item) {
  const inStock = item.checked ? '' : stockNote(item);
  return html`
    <div class="shop-item ${item.checked ? 'checked' : ''}">
      <button class="tick" data-action="toggle-item" data-id="${item.id}" aria-pressed="${String(item.checked)}" aria-label="${item.checked ? 'Décocher' : 'Cocher'} ${item.name}"><span>${I.check}</span></button>
      <button class="shop-text" data-action="edit-item" data-id="${item.id}" aria-label="Modifier ${item.name}${item.quantity ? `, ${item.quantity}` : ''}">
        <span>${item.name}</span>${item.addedBy ? html`<small>par ${item.addedBy}</small>` : ''}${inStock ? html`<small class="in-stock">${inStock}</small>` : ''}
      </button>
      ${item.quantity ? html`<button class="qty-pill" data-action="edit-item" data-id="${item.id}" tabindex="-1">${item.quantity}</button>` : ''}
      ${item.checked
        ? html`<button class="icon-btn" data-action="item-to-fridge" data-id="${item.id}" aria-label="Ranger ${item.name} dans le stock">${I.jar}</button>`
        : html`<button class="icon-btn" data-action="delete-item" data-id="${item.id}" aria-label="Supprimer ${item.name}">${I.x}</button>`}
    </div>`;
}

/** Ranger un article acheté : la fiche produit s'ouvre avec le nom, le nombre et le poids. */
function moveItemToFridge(item) {
  const { name, quantity, count } = S.fromShoppingEntry(item);
  openEditor({ draft: { name, quantity, count }, shoppingItemId: item.id });
}

/** Fiche d'un article de courses : nom et quantité modifiables. */
function openShoppingItem(id) {
  const item = state.shopping.find((i) => i.id === id);
  if (!item) return;
  // Ancienne quantité libre (« 2 kg ») : convertie en nombre + poids dans le nom.
  const draft = /^\d*$/.test(item.quantity ?? '')
    ? { name: item.name, quantity: item.quantity ?? '' }
    : S.toShoppingEntry(item.name, item.quantity);
  const sheet = openSheet({
    render: () => html`
      <header class="sheet-head">
        <button class="link" data-action="close">Annuler</button>
        <h2>Article</h2>
        <button class="link strong" data-action="save">OK</button>
      </header>
      <div class="sheet-body">
        <section class="group">
          <label class="field"><span>Article</span><input name="name" value="${draft.name}" autocomplete="off"></label>
          <label class="field"><span>Nombre à acheter</span><input name="quantity" value="${draft.quantity}" placeholder="—" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" enterkeyhint="done"></label>
        </section>
        <div class="quick">
          ${['1', '2', '3', '4', '6'].map((n) => html`<button data-action="set-qty" data-value="${n}">${n}</button>`)}
          <button data-action="set-qty" data-value="">Aucune</button>
        </div>
        <section class="group">
          <button class="row-button" data-action="to-fridge">${I.jar}Acheté : ranger dans le stock</button>
          <button class="row-button danger" data-action="delete">${I.trash}Supprimer de la liste</button>
        </section>
      </div>`,
    actions: {
      save: () => {
        if (!draft.name.trim()) return;
        store.updateShoppingItem(id, draft);
        sheet.close();
      },
      'set-qty': (el) => {
        draft.quantity = el.dataset.value;
        sheet.update();
      },
      'to-fridge': () => {
        store.updateShoppingItem(id, draft);
        sheet.close();
        moveItemToFridge({ ...item, ...draft });
      },
      delete: () => {
        store.deleteShoppingItems([id]);
        sheet.close();
        toast(`${item.name} : supprimé`, 'Annuler', () => store.addShoppingItem(item.name, item.quantity));
      }
    },
    onInput: (event) => {
      if (event.target.name === 'name') draft.name = event.target.value;
      if (event.target.name === 'quantity') {
        const clean = S.sanitizeCount(event.target.value);
        if (event.target.value !== clean) event.target.value = clean;
        draft.quantity = clean;
      }
    }
  });
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
      <p class="hint">Les produits à consommer vite sont mis en avant à chaque ouverture. Une application web ne peut pas envoyer de rappel quand elle est fermée : programmez un rappel quotidien « Vérifier le stock » dans l'app Rappels (voir README).</p>

      <section class="group">
        <h2>Recettes et photos (Claude)</h2>
        <div id="claude-key"></div>
        <label class="field"><span>Modèle</span>
          <select id="model">${store.MODELS.map((m) => html`<option value="${m.id}" ${m.id === s.model ? raw('selected') : ''}>${m.label}</option>`)}</select>
        </label>
      </section>
      <p class="hint">Sert à générer les recettes et à reconnaître un produit en photo. Créez une clé sur console.anthropic.com (payée à l'usage : quelques centimes par génération). Elle reste sur cet iPhone.</p>

      <section class="group">
        <h2>Recettes</h2>
        <div class="field"><span class="label-stack">Recette légère<small>Maximum par portion (filtre « Léger »)</small></span>
          <div class="stepper">
            <button data-action="kcal-minus" aria-label="50 kcal de moins">−</button>
            <output id="kcal-max">${s.lightMaxKcal || 500} kcal</output>
            <button data-action="kcal-plus" aria-label="50 kcal de plus">+</button>
          </div>
        </div>
      </section>

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
    const kcal = document.getElementById('kcal-max');
    if (kcal) kcal.textContent = `${s.lightMaxKcal || 500} kcal`;
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
    'Rejoins notre foyer sur Kookia !',
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
      <h1>Kookia</h1>
      <p>Tout ce qu'il y a à manger à la maison, partagé à deux : frigo, congélateur, placard, fruits et légumes. Moins d'oublis, moins de gaspillage, et des recettes avec ce que vous avez.</p>
    </div>
    <h2 class="section">Installez d'abord l'app</h2>
    <ol class="steps-install">
      <li><span>Touchez <strong>Partager</strong> <span class="inline-icon">${I.share}</span> dans la barre de Safari.</span></li>
      <li><span>Choisissez <strong>Sur l'écran d'accueil</strong>, puis <strong>Ajouter</strong>.</span></li>
      <li><span>Ouvrez <strong>Kookia</strong> depuis l'écran d'accueil pour continuer.</span></li>
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
          <p class="note ok">Invitation reconnue. Touchez « Rejoindre » pour retrouver le stock partagé du foyer.</p>
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
  'add-scan': () => scanThenEdit(),
  'add-produce': () => openProduceSheet(),
  'set-location': (el) => {
    ui.location = el.dataset.value;
    fridgeView.update();
  },
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
  'pick-origin': () => openOriginPicker(),
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
  'servings-minus': () => {
    store.updateSettings({ servings: Math.max(1, (state.settings.servings || 2) - 1) });
    rerenderKeepScroll();
  },
  'servings-plus': () => {
    store.updateSettings({ servings: Math.min(12, (state.settings.servings || 2) + 1) });
    rerenderKeepScroll();
  },
  'set-diet': (el) => {
    ui.filters.diet = el.dataset.value;
    ui.recipeNote = null;
    rerenderKeepScroll();
  },
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
    if (item) moveItemToFridge(item);
  },
  'edit-item': (el) => openShoppingItem(el.dataset.id),
  'clear-checked': () => store.clearCheckedShopping(),

  // Réglages
  'alert-minus': () => store.updateSettings({ alertDays: Math.max(0, state.settings.alertDays - 1) }),
  'alert-plus': () => store.updateSettings({ alertDays: Math.min(7, state.settings.alertDays + 1) }),
  'kcal-minus': () => store.updateSettings({ lightMaxKcal: Math.max(250, (state.settings.lightMaxKcal || 500) - 50) }),
  'kcal-plus': () => store.updateSettings({ lightMaxKcal: Math.min(1000, (state.settings.lightMaxKcal || 500) + 50) }),
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
    if (t.id === 'new-qty') {
      const clean = S.sanitizeCount(t.value);
      if (t.value !== clean) t.value = clean;
      return;
    }
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
    else if (t.id === 'batch-toggle' || t.id === 'light-toggle') {
      if (t.id === 'batch-toggle') ui.filters.batchOnly = t.checked;
      else ui.filters.light = t.checked;
      ui.recipeNote = null;
      rerenderKeepScroll();
    }
  });

  screen.addEventListener('submit', (event) => {
    if (event.target.id !== 'add-item') return;
    event.preventDefault();
    const nameInput = document.getElementById('new-item');
    const qtyInput = document.getElementById('new-qty');
    const name = nameInput.value.trim();
    const qty = S.sanitizeCount(qtyInput.value);
    if (!name) {
      if (qty) toast("Indiquez l'article à acheter");
      nameInput.focus();
      return;
    }
    const result = store.addShoppingItem(name, qty, { updateQuantity: true });
    if (result) {
      nameInput.value = '';
      qtyInput.value = '';
      const inStock = stockNote({ name });
      if (result === 'updated') toast(`${name} : quantité mise à jour (${qty})`);
      else if (inStock) toast(`${name} : ajouté. ${inStock}, à vérifier avant d'acheter.`);
    } else {
      toast('Déjà dans la liste');
    }
    nameInput.focus();
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
  window.addEventListener('online', () => {
    store.resume(); // rétablit tout de suite la connexion Firestore
    onStoreChange('sync');
  });
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
