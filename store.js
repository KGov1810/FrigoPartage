// Kookia — état de l'app et synchronisation Firebase (Firestore).
// Données partagées : foyers/{code}/produits, /courses, /recettes.
// Réglages propres à chaque iPhone : localStorage.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, memoryLocalCache,
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, onSnapshot, writeBatch, serverTimestamp,
  disableNetwork, enableNetwork
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {
  statusOf, daysUntil, hasDate, resolveIngredient, matchesFilters, scaleIngredient, maxPurchases,
  sanitizeCount, splitItemName, toShoppingEntry, stockStatus, nameMatchScore,
  dateKindOf, freezerLimit, estimateFreshDays, isoInDays, toISODate, locationOf
} from './services.js';

// ---------------------------------------------------------------------------
// Réglages locaux
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'frigo.settings.v1';
const DEFAULT_SETTINGS = {
  userName: '',
  alertDays: 2,
  claudeKey: '',
  model: 'claude-sonnet-5-5',
  householdCode: '',
  firebaseConfig: null,
  onboardingDone: false,
  installHintDismissed: false,
  servings: 2,          // nombre de personnes proposé pour les recettes
  lightMaxKcal: 500     // seuil d'une recette « légère » (kcal par portion)
};

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (conseillé)' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (économique)' }
];

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
    // stockage indisponible (navigation privée) : les réglages restent en mémoire
  }
  emit('settings');
}

// ---------------------------------------------------------------------------
// État observable
// ---------------------------------------------------------------------------

export const state = {
  settings: loadSettings(),
  products: [],
  shopping: [],
  recipes: [],
  connected: false,
  reconnecting: false,
  fromCache: true,
  pending: false,
  error: null,
  lastSync: null
};

const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function emit(what) {
  for (const fn of subscribers) {
    try {
      fn(what);
    } catch (error) {
      console.error(error);
    }
  }
}

// ---------------------------------------------------------------------------
// Vues dérivées
// ---------------------------------------------------------------------------

export function sortedProducts() {
  return [...state.products].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.name.localeCompare(b.name, 'fr'));
}

export function productStatus(product) {
  return stockStatus(product, state.settings.alertDays);
}

/** Produits par lieu de rangement ('' = tous). */
export function productsIn(location = '') {
  return sortedProducts().filter((p) => !location || (p.location || 'frigo') === location);
}

/** Produits en stock qui ressemblent à un article de courses (anti-achat en double). */
export function stockMatches(name) {
  const base = splitItemName(name).base;
  return state.products.filter((p) => nameMatchScore(base, p.name) > 0);
}

/** Périmés + à consommer vite (hors produits dont la date est à compléter). */
export function urgentProducts() {
  return sortedProducts().filter((p) => ['expired', 'soon'].includes(productStatus(p)));
}

/** Produits ajoutés sans date (ex. depuis un ticket de caisse). */
export function pendingProducts() {
  return sortedProducts().filter((p) => productStatus(p) === 'pending');
}

export function soonProducts() {
  return sortedProducts().filter((p) => productStatus(p) === 'soon');
}

export function productById(id) {
  return state.products.find((p) => p.id === id) ?? null;
}

export function uncheckedCount() {
  return state.shopping.filter((i) => !i.checked).length;
}

export function syncLabel() {
  if (!firebaseConfig()) return 'Firebase non configuré';
  if (!state.settings.householdCode) return 'Aucun foyer';
  if (state.error) return 'Erreur de synchronisation';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return state.pending ? 'Hors ligne, envoi en attente' : 'Hors ligne';
  }
  if (state.reconnecting) return 'Actualisation…';
  if (!state.connected || (state.fromCache && !state.lastSync)) return 'Connexion…';
  if (state.fromCache) return state.pending ? 'Hors ligne, envoi en attente' : 'Hors ligne';
  if (state.pending) return 'Envoi en cours…';
  return 'Synchronisé';
}

// ---------------------------------------------------------------------------
// Configuration Firebase
// ---------------------------------------------------------------------------

const CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

export function firebaseConfig() {
  const fromFile = window.FIREBASE_CONFIG;
  if (fromFile?.apiKey && fromFile?.projectId && fromFile?.appId) return fromFile;
  return state.settings.firebaseConfig;
}

/** Accepte le bloc « const firebaseConfig = { … } » copié depuis la console, ou du JSON. */
export function parseFirebaseConfig(text) {
  const config = {};
  for (const key of CONFIG_KEYS) {
    const match = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`).exec(text ?? '');
    if (match) config[key] = match[1].trim();
  }
  return config.apiKey && config.projectId && config.appId ? config : null;
}

// Invitation = code du foyer + configuration Firebase, pour le second iPhone.
const INVITE_PREFIX = 'FRIGO1.';

export function invitationCode() {
  const payload = JSON.stringify({ h: state.settings.householdCode, c: firebaseConfig() });
  const base64 = btoa(unescape(encodeURIComponent(payload)));
  return INVITE_PREFIX + base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseInvitation(text) {
  const match = /FRIGO1\.([A-Za-z0-9_-]+)/.exec(text ?? '');
  if (!match) return null;
  try {
    let base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const payload = JSON.parse(decodeURIComponent(escape(atob(base64))));
    const code = normalizeHouseholdCode(payload.h);
    if (!code || !payload.c?.apiKey || !payload.c?.projectId) return null;
    return { code, config: payload.c };
  } catch {
    return null;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateHouseholdCode() {
  const values = crypto.getRandomValues(new Uint32Array(10));
  const chars = [...values].map((v) => CODE_ALPHABET[v % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export function normalizeHouseholdCode(input) {
  const cleaned = String(input ?? '').toUpperCase().split('').filter((c) => CODE_ALPHABET.includes(c)).join('');
  return cleaned.length === 10 ? `${cleaned.slice(0, 5)}-${cleaned.slice(5)}` : null;
}

// ---------------------------------------------------------------------------
// Démarrage Firebase et écoute en temps réel
// ---------------------------------------------------------------------------

let app = null;
let auth = null;
let db = null;
let unsubscribers = [];
const meta = {};

function ensureFirebase() {
  if (db) return true;
  const config = firebaseConfig();
  if (!config) return false;
  app = initializeApp(config);
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache(), ignoreUndefinedProperties: true });
  } catch {
    db = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
  }
  return true;
}

async function signIn() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
}

export async function start() {
  const code = state.settings.householdCode;
  if (!code || unsubscribers.length || !ensureFirebase()) return;
  try {
    await signIn();
  } catch (error) {
    state.error = errorMessage(error);
    emit('sync');
    return;
  }
  if (unsubscribers.length) return;
  const listen = (name, key, map) => onSnapshot(
    collection(db, 'foyers', code, name),
    { includeMetadataChanges: true },
    (snapshot) => {
      state[key] = snapshot.docs.map((d) => map(d.id, d.data())).filter(Boolean);
      meta[key] = { fromCache: snapshot.metadata.fromCache, pending: snapshot.metadata.hasPendingWrites };
      const metas = Object.values(meta);
      state.fromCache = metas.some((m) => m.fromCache);
      state.pending = metas.some((m) => m.pending);
      if (!snapshot.metadata.fromCache) {
        state.error = null;
        state.lastSync = new Date();
        if (key === 'products' || key === 'recipes') rememberRecipeLinks(state.products);
      }
      emit(key);
    },
    (error) => {
      state.error = errorMessage(error);
      stop();
      emit('sync');
    }
  );
  unsubscribers = [
    listen('produits', 'products', toProduct),
    listen('courses', 'shopping', toShoppingItem),
    listen('recettes', 'recipes', toRecipe)
  ];
  state.connected = true;
  emit('sync');
}

function stop() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  state.connected = false;
}

/**
 * Force Firestore à rétablir sa connexion.
 * Quand l'app passe en arrière-plan, iOS la met en pause et coupe la connexion
 * sans prévenir. Au retour, Firestore peut mettre de longues minutes à s'en rendre
 * compte : pendant ce temps, l'iPhone affiche d'anciennes données et garde ses
 * propres modifications en attente. On coupe donc puis rétablit le réseau.
 */
let refreshing = null;

async function refreshConnection() {
  if (!db || refreshing) return refreshing;
  state.reconnecting = true;
  emit('sync');
  refreshing = (async () => {
    try {
      await disableNetwork(db);
      await enableNetwork(db);
    } catch (error) {
      console.warn('Reconnexion Firestore :', error);
    } finally {
      state.reconnecting = false;
      refreshing = null;
      emit('sync');
    }
  })();
  return refreshing;
}

/** Retour au premier plan ou retour du réseau. */
export async function resume() {
  if (!state.connected) {
    await start();
    return;
  }
  await refreshConnection();
}

/** Bouton « Se reconnecter » des Réglages. */
export async function reconnect() {
  stop();
  state.error = null;
  emit('sync');
  await refreshConnection();
  await start();
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

// ---------------------------------------------------------------------------
// Foyer partagé
// ---------------------------------------------------------------------------

export async function createHousehold() {
  if (!ensureFirebase()) throw new Error('Configuration Firebase manquante.');
  await withTimeout(signIn(), 20_000, 'Connexion à Firebase impossible : vérifiez la connexion internet.');
  const code = generateHouseholdCode();
  await withTimeout(
    setDoc(doc(db, 'foyers', code), { createdAt: serverTimestamp(), createdBy: state.settings.userName }),
    20_000, 'Firebase ne répond pas : vérifiez la connexion internet.'
  );
  setHousehold(code);
  return code;
}

/** Accepte un code (« K7M2Q-XP9RT ») ou une invitation complète (« FRIGO1.… »). */
export async function joinHousehold(input) {
  const invitation = parseInvitation(input);
  if (invitation && !window.FIREBASE_CONFIG?.apiKey) {
    updateSettings({ firebaseConfig: invitation.config });
  }
  const code = invitation?.code ?? normalizeHouseholdCode(input);
  if (!code) throw new Error('Code invalide : collez le code d\'invitation reçu (il commence par FRIGO1.).');
  if (!ensureFirebase()) throw new Error("Configuration Firebase manquante : collez le code d'invitation complet.");
  await withTimeout(signIn(), 20_000, 'Connexion à Firebase impossible : vérifiez la connexion internet.');
  const snapshot = await withTimeout(getDoc(doc(db, 'foyers', code)), 20_000,
    'Firebase ne répond pas : vérifiez la connexion internet.');
  if (!snapshot.exists()) throw new Error("Aucun foyer ne correspond à ce code. Vérifiez-le sur l'autre iPhone (Réglages > Foyer partagé).");
  setHousehold(code);
}

function setHousehold(code) {
  stop();
  state.products = [];
  state.shopping = [];
  state.recipes = [];
  state.error = null;
  updateSettings({ householdCode: code });
  start();
}

export function leaveHousehold() {
  stop();
  state.products = [];
  state.shopping = [];
  state.recipes = [];
  updateSettings({ householdCode: '', onboardingDone: false });
}

// ---------------------------------------------------------------------------
// Conversion des documents
// ---------------------------------------------------------------------------

function toProduct(id, d) {
  if (!d.name) return null; // document incomplet (une date vide = « date à compléter »)
  return {
    id,
    name: d.name ?? '',
    expiry: d.expiry ?? '',
    category: d.category ?? 'autre',
    quantity: d.quantity ?? '',
    count: Number(d.count) >= 1 ? Math.round(Number(d.count)) : 1, // nombre d'unités (anciens produits : 1)
    location: d.location || 'frigo',   // anciens produits : au frigo
    dateKind: d.dateKind || 'dlc',     // anciens produits : date limite imprimée
    frozenAt: d.frozenAt ?? '',
    barcode: d.barcode ?? '',
    addedBy: d.addedBy ?? '',
    createdAt: d.createdAt ?? 0,
    image: d.image ?? '',
    imageUrl: d.imageUrl ?? ''
  };
}

function toShoppingItem(id, d) {
  if (!d.name) return null; // document incomplet (ancien bug de l'article « fantôme »)
  return {
    id,
    name: d.name ?? '',
    quantity: d.quantity ?? '',
    checked: Boolean(d.checked),
    addedBy: d.addedBy ?? '',
    createdAt: d.createdAt ?? 0
  };
}

function toRecipe(id, d) {
  if (!d.title) return null; // document incomplet
  return { ...d, id, ingredients: d.ingredients ?? [], steps: d.steps ?? [], usedProductIds: d.usedProductIds ?? [] };
}

// ---------------------------------------------------------------------------
// Écritures (Firestore les garde en file d'attente si l'iPhone est hors ligne)
// ---------------------------------------------------------------------------

function ref(name, id) {
  return doc(db, 'foyers', state.settings.householdCode, name, id);
}

function canWrite() {
  return Boolean(db && state.settings.householdCode);
}

function reportWriteError(error) {
  state.error = errorMessage(error);
  emit('sync');
}

function write(promise) {
  promise.catch((error) => {
    // Document déjà supprimé par l'autre iPhone : rien à signaler.
    if (error?.code === 'not-found') return;
    reportWriteError(error);
  });
}

export function saveProduct(product) {
  if (!canWrite()) return;
  write(setDoc(ref('produits', product.id), {
    name: (product.name ?? '').trim(),
    expiry: product.expiry,
    category: product.category || 'autre',
    quantity: (product.quantity ?? '').trim(),
    count: Math.max(1, Math.round(Number(product.count) || 1)),
    location: product.location || 'frigo',
    dateKind: dateKindOf(product),
    frozenAt: product.frozenAt || '',
    barcode: product.barcode || '',
    addedBy: product.addedBy || state.settings.userName,
    createdAt: product.createdAt || Date.now(),
    image: product.image || '',
    imageUrl: product.imageUrl || ''
  }));
}

/** Retire des produits (consommés ou jetés). Renvoie les produits retirés, pour « Annuler ». */
export function removeProducts(ids) {
  if (!canWrite()) return [];
  const removed = state.products.filter((p) => ids.includes(p.id));
  if (!removed.length) return [];
  rememberRecipeLinks(removed);
  const batch = writeBatch(db);
  removed.forEach((p) => batch.delete(ref('produits', p.id)));
  write(batch.commit());
  return removed;
}

export function restoreProducts(products) {
  products.forEach((p) => saveProduct(p));
}

/**
 * Consomme une unité de chaque produit : le nombre diminue de 1,
 * et le produit n'est retiré du frigo qu'à la dernière unité.
 * Renvoie l'état d'avant (pour « Annuler ») et ce qui a été retiré ou diminué.
 */
export function consumeOne(ids) {
  if (!canWrite()) return { before: [], removed: [], decremented: [] };
  const before = state.products.filter((p) => ids.includes(p.id)).map((p) => ({ ...p }));
  const removed = before.filter((p) => (p.count ?? 1) <= 1);
  const decremented = before.filter((p) => (p.count ?? 1) > 1);
  if (removed.length) removeProducts(removed.map((p) => p.id));
  decremented.forEach((p) => saveProduct({ ...p, count: p.count - 1 }));
  return { before, removed, decremented };
}

/**
 * Ajoute un article. Renvoie 'added', 'updated' (article déjà présent dont la
 * quantité a été remplacée, si updateQuantity) ou false (déjà présent).
 */
export function addShoppingItem(name, quantity = '', { updateQuantity = false } = {}) {
  const raw = String(quantity ?? '').trim();
  // La quantité enregistrée est toujours un nombre ; un poids (« 400 g ») rejoint le nom.
  const entry = /^\d*$/.test(raw)
    ? { name: (name ?? '').trim(), quantity: sanitizeCount(raw) }
    : toShoppingEntry(name, raw);
  const trimmed = entry.name;
  const amount = entry.quantity;
  if (!trimmed || !canWrite()) return false;
  const base = splitItemName(trimmed).base;
  const existing = state.shopping.find((i) => !i.checked
    && splitItemName(i.name).base.localeCompare(base, 'fr', { sensitivity: 'base' }) === 0);
  if (existing) {
    if (updateQuantity && amount && amount !== existing.quantity) {
      updateShoppingItem(existing.id, { quantity: amount });
      return 'updated';
    }
    return false;
  }
  const id = crypto.randomUUID();
  write(setDoc(ref('courses', id), {
    name: trimmed, quantity: amount, checked: false, addedBy: state.settings.userName, createdAt: Date.now()
  }));
  return 'added';
}

/** Modifie le nom et/ou la quantité d'un article. */
export function updateShoppingItem(id, patch) {
  if (!canWrite()) return;
  const data = {};
  if (patch.name !== undefined && patch.name.trim()) data.name = patch.name.trim();
  if (patch.quantity !== undefined) data.quantity = sanitizeCount(patch.quantity);
  if (Object.keys(data).length) write(updateDoc(ref('courses', id), data));
}

export function toggleShoppingItem(id) {
  const item = state.shopping.find((i) => i.id === id);
  if (!item || !canWrite()) return;
  // updateDoc et non setDoc : si l'autre iPhone vient de supprimer l'article,
  // on ne recrée pas un article vide (« fantôme »).
  write(updateDoc(ref('courses', id), { checked: !item.checked }));
}

export function deleteShoppingItems(ids) {
  if (!canWrite() || !ids.length) return;
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(ref('courses', id)));
  write(batch.commit());
}

export function clearCheckedShopping() {
  deleteShoppingItems(state.shopping.filter((i) => i.checked).map((i) => i.id));
}

/** Ajoute aux courses les ingrédients absents du frigo actuel (quantités ajustées). Renvoie le nombre ajouté. */
export function addMissingIngredients(recipe, factor = 1) {
  return recipeAvailability(recipe).missing
    .reduce((count, i) => count + (addShoppingItem(i.name, scaleIngredient(i, factor)) ? 1 : 0), 0);
}

/**
 * Ajoute d'un coup les produits d'un ticket de caisse (date à compléter)
 * et retire de la liste de courses les articles achetés.
 */
export function addReceiptProducts(items, shoppingIdsToRemove = []) {
  if (!canWrite() || !items.length) return 0;
  const batch = writeBatch(db);
  const now = Date.now();
  const today = toISODate(new Date());
  items.forEach((item, index) => {
    const location = locationOf(item.location).id;
    const produce = item.category === 'fruits_legumes' || location === 'fruits';
    let dateKind = 'dlc';
    let expiry = ''; // frigo : date à compléter (elle est imprimée sur l'emballage)
    let frozenAt = '';
    if (location === 'congelateur') {
      dateKind = 'congele';
      frozenAt = today;
      expiry = freezerLimit(item.category, today);
    } else if (location === 'placard') {
      dateKind = 'aucune';
    } else if (produce) {
      dateKind = 'estimee';
      expiry = isoInDays(estimateFreshDays(item.name, location));
    }
    batch.set(ref('produits', crypto.randomUUID()), {
      name: item.name.trim(),
      expiry,
      location,
      dateKind,
      frozenAt,
      category: item.category || 'autre',
      quantity: (item.quantity ?? '').trim(),
      count: Math.max(1, Math.round(Number(item.count) || 1)),
      barcode: '',
      addedBy: state.settings.userName,
      createdAt: now + index,
      image: '',
      imageUrl: ''
    });
  });
  shoppingIdsToRemove.forEach((id) => batch.delete(ref('courses', id)));
  write(batch.commit());
  return items.length;
}

export function saveRecipes(recipes) {
  if (!canWrite() || !recipes.length) return;
  const batch = writeBatch(db);
  recipes.forEach(({ id, ...data }) => batch.set(ref('recettes', id), data));
  // Garde les favoris + les 40 recettes les plus récentes.
  const all = [...recipes, ...state.recipes.filter((r) => !recipes.some((n) => n.id === r.id))];
  all.filter((r) => !r.favorite)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(40)
    .forEach((r) => batch.delete(ref('recettes', r.id)));
  write(batch.commit());
}

export function toggleFavorite(id) {
  const recipe = state.recipes.find((r) => r.id === id);
  if (!recipe || !canWrite()) return;
  write(updateDoc(ref('recettes', id), { favorite: !recipe.favorite }));
}

export function deleteRecipe(id) {
  if (!canWrite()) return;
  write(deleteDoc(ref('recettes', id)));
}

// ---------------------------------------------------------------------------
// Recettes et frigo actuel
// ---------------------------------------------------------------------------

/**
 * Mémorise dans les recettes le code-barres, le nom et la catégorie des produits
 * utilisés, pour les reconnaître s'ils sont rachetés après avoir été consommés.
 * N'écrit que ce qui manque (sans effet la deuxième fois).
 */
function rememberRecipeLinks(products) {
  if (!canWrite() || !products.length || !state.recipes.length) return;
  const byId = new Map(products.map((p) => [p.id, p]));
  const updates = [];
  for (const recipe of state.recipes) {
    let changed = false;
    const ingredients = recipe.ingredients.map((ingredient) => {
      const product = ingredient.productId ? byId.get(ingredient.productId) : null;
      if (!product) return ingredient;
      const patch = {};
      if (product.barcode && !ingredient.barcode) patch.barcode = product.barcode;
      if (!ingredient.productName) patch.productName = product.name;
      if (!ingredient.category) patch.category = product.category;
      if (!Object.keys(patch).length) return ingredient;
      changed = true;
      return { ...ingredient, ...patch };
    });
    if (changed) {
      recipe.ingredients = ingredients;
      updates.push([recipe.id, ingredients]);
    }
  }
  if (!updates.length) return;
  const batch = writeBatch(db);
  updates.forEach(([id, ingredients]) => batch.update(ref('recettes', id), { ingredients }));
  write(batch.commit());
}

/**
 * Situation d'une recette par rapport au frigo actuel :
 * rows : chaque ingrédient avec le produit retrouvé (ou null) et la façon dont il l'a été ;
 * inFridge : produits du frigo utilisés (sans doublon) ; missing : ingrédients à se procurer.
 */
export function recipeAvailability(recipe, priorityIds = new Set()) {
  const rows = recipe.ingredients.map((ingredient) => {
    const match = resolveIngredient(ingredient, state.products);
    const inShopping = !match && ingredient.source !== 'placard' && state.shopping.some(
      (item) => splitItemName(item.name).base.localeCompare(ingredient.name, 'fr', { sensitivity: 'base' }) === 0
    );
    return { ingredient, product: match?.product ?? null, via: match?.via ?? null, inShopping };
  });
  const inFridge = [...new Map(rows.filter((r) => r.product).map((r) => [r.product.id, r.product])).values()];
  const missing = rows.filter((r) => !r.product && r.ingredient.source !== 'placard').map((r) => r.ingredient);
  const priorityUsed = inFridge.filter((p) => priorityIds.has(p.id)).length;
  const urgentUsed = inFridge.filter((p) => ['expired', 'soon'].includes(productStatus(p))).length;
  return { rows, inFridge, missing, priorityUsed, urgentUsed };
}

/**
 * Recettes enregistrées réalisables avec le frigo actuel : au moins un produit
 * du frigo et au plus deux ingrédients à se procurer (six avec une origine ou une envie).
 * Les mieux adaptées d'abord.
 */
export function compatibleRecipes({ priorityIds = new Set(), filters = {}, limit = 5 } = {}) {
  return state.recipes
    .filter((recipe) => matchesFilters(recipe, filters))
    .map((recipe) => ({ recipe, ...recipeAvailability(recipe, priorityIds) }))
    // Avec une origine ou une envie, une recette fidèle peut demander jusqu'à 6 achats.
    .filter((r) => r.inFridge.length > 0 && r.missing.length <= maxPurchases(filters))
    .sort((a, b) => (b.priorityUsed - a.priorityUsed)
      || (b.urgentUsed - a.urgentUsed)
      || (a.missing.length - b.missing.length)
      || (b.inFridge.length - a.inFridge.length)
      || (Number(Boolean(b.recipe.favorite)) - Number(Boolean(a.recipe.favorite)))
      || ((b.recipe.createdAt ?? 0) - (a.recipe.createdAt ?? 0)))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Messages d'erreur compréhensibles
// ---------------------------------------------------------------------------

export function errorMessage(error) {
  const code = error?.code ?? '';
  switch (code) {
    case 'permission-denied':
      return 'Accès refusé par Firebase : vérifiez les règles Firestore (README, étape 1).';
    case 'unavailable':
      return 'Pas de connexion : les modifications seront envoyées au retour du réseau.';
    case 'not-found':
    case 'failed-precondition':
      return 'Base Firestore introuvable : créez-la dans la console Firebase (README, étape 1).';
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return 'Activez la connexion « Anonyme » dans Firebase > Authentication (README, étape 1).';
    case 'auth/configuration-not-found':
      return 'Authentication n\'est pas activé dans la console Firebase (README, étape 1).';
    case 'auth/api-key-not-valid':
    case 'auth/invalid-api-key':
      return 'Configuration Firebase invalide : recopiez-la depuis la console Firebase.';
    case 'auth/network-request-failed':
      return 'Pas de connexion internet.';
    default:
      return error?.message ?? String(error);
  }
}

// Utilisé par l'interface pour la pastille de l'icône.
export function badgeCount() {
  return urgentProducts().length;
}
