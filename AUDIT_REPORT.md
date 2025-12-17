# 🔍 AUDIT COMPLETO - Life Tracker Project

**Data**: 2024  
**Engineer**: Senior Engineer Audit  
**Obiettivo**: Audit totale + Fix problema A (time block sparisce dopo refresh)

---

## FASE 1 — MAPPA ARCHITETTURA

### Struttura Progetto

```
life-tracker/
├── src/
│   ├── app/                    # Next.js 15 App Router
│   │   ├── page.tsx           # HomePage principale (client component)
│   │   ├── layout.tsx          # Root layout (SSR)
│   │   └── globals.css         # Stili globali
│   ├── components/             # Componenti React UI
│   │   ├── TimeBlockPlanner.tsx
│   │   ├── OKRManager.tsx
│   │   ├── HabitsTracker.tsx
│   │   └── ... (altri componenti)
│   ├── lib/                    # Business logic & adapters
│   │   ├── database.ts        # LifeTrackerDB wrapper + adapter selection
│   │   ├── firebaseAdapter.ts  # FirebaseAdapter implementation
│   │   ├── firebase.ts         # Firebase initialization
│   │   ├── auth.ts             # AuthManager singleton
│   │   └── ... (altri moduli)
│   ├── config/
│   │   └── firebaseConfig.ts  # Firebase config hardcoded
│   ├── types/
│   │   └── index.ts           # TypeScript interfaces
│   └── utils/
│       └── sessionManager.ts
└── public/                     # Static assets
```

### Ruolo Moduli Principali

#### `src/app/` (Routing & Pages)
- **`page.tsx`**: Componente principale client-side (`'use client'`)
  - Gestisce tutto lo stato dell'applicazione (timeBlocks, goals, projects, tasks, habits)
  - Inizializza database e auth tramite `useEffect`
  - Carica dati con `loadData()` dopo autenticazione
  - Handler per CRUD: `handleCreateTimeBlock`, `handleCreateGoal`, etc.

- **`layout.tsx`**: Root layout SSR
  - Metadata e viewport config
  - Importa `globals.css`
  - Non contiene logica client-side

#### `src/lib/` (Database & Storage)

**`database.ts`** - LifeTrackerDB (Singleton)
- **Ruolo**: Wrapper che seleziona adapter (Firebase vs IndexedDB vs Memory)
- **Adapters disponibili**:
  1. `MemoryAdapter`: No-op per SSR/server
  2. `IndexedDBAdapter`: Storage locale browser
  3. `FirebaseAdapter`: Cloud storage (Firestore)
- **Inizializzazione**:
  - Costruttore chiama `configureAdapter()` che seleziona adapter basato su:
    - `typeof window !== 'undefined'` (browser check)
    - Presenza `firebaseConfig.apiKey`
    - Presenza `firebaseAdapter` instance
  - **PROBLEMA**: Seleziona adapter al momento della creazione, non al runtime
- **Metodi chiave**:
  - `init()`: Inizializza adapter corrente
  - `switchToFirebase(userId)`: Cambia adapter a Firebase e setta userId
  - `switchToIndexedDB()`: Torna a IndexedDB
  - `create/read/update/delete/getAll`: Delega all'adapter corrente

**`firebaseAdapter.ts`** - FirebaseAdapter
- **Ruolo**: Implementazione DatabaseAdapter per Firestore
- **Path struttura**: `users/{userId}/{collectionName}/{docId}`
- **Metodi chiave**:
  - `setUserId(userId)`: Setta userId per path generation
  - `getUserCollection(collectionName)`: Genera path `users/{userId}/{collectionName}`
  - `create/read/update/delete/getAll`: Operazioni Firestore con conversione Date ↔ Timestamp
- **PROBLEMA**: Se `userId` non è settato, `getUserCollection()` lancia errore

**`firebase.ts`** - Firebase Initialization
- **Ruolo**: Inizializza Firebase App, Auth, Firestore
- **Comportamento**: Esegue init immediato (non lazy)
- Esporta: `auth`, `db` (Firestore instance), `app`

**`auth.ts`** - AuthManager (Singleton)
- **Ruolo**: Gestisce autenticazione Firebase
- **Comportamento**:
  - `onAuthStateChanged` listener che chiama `db.switchToFirebase(user.uid)` quando user logga
  - Hook `useAuth()` per React components
- **PROBLEMA**: Race condition con `page.tsx` useEffect

#### `src/components/` (UI Components)
- Tutti i componenti sono `'use client'`
- Ricevono props: `currentUserId`, `isReady` (Firebase ready flag)
- Handler passati come props: `onCreateTimeBlock`, `onCreateGoal`, etc.

---

### Flusso Dati Completo

#### TimeBlocks Flow

**1. CREAZIONE (UI → State → DB → Storage)**

```
TimeBlockPlanner.tsx
  ↓ onClick "Add Block"
handleQuickCreateBlock()
  ↓ setNewBlockData + setShowCreateModal(true)
Modal form submit
  ↓ handleCreateBlock()
onCreateTimeBlock(blockData) [prop da page.tsx]
  ↓
page.tsx::handleCreateTimeBlock()
  ↓
  ├─ Check: isReady = !!currentUser?.uid && db.isUsingFirebase
  ├─ Se !isReady → return (blocca creazione)
  ├─ Optimistic update: setTimeBlocks([...prev, optimisticBlock])
  ├─ db.create('timeBlocks', block)
  │    ↓
  │    LifeTrackerDB.create()
  │      ↓
  │    adapter.create() [FirebaseAdapter o IndexedDBAdapter]
  │      ↓
  │    FirebaseAdapter.create():
  │      ├─ getUserCollection('timeBlocks') → users/{userId}/timeBlocks
  │      ├─ setDoc(docRef, dataWithTimestamps)
  │      └─ convertTimestampsToDates(result)
  │    OPPURE
  │    IndexedDBAdapter.create():
  │      ├─ getStore('timeBlocks')
  │      └─ store.put(data)
  ├─ Update state: setTimeBlocks(prev => prev.map(...))
  └─ Logging
```

**2. LETTURA (Storage → DB → State → UI)**

```
page.tsx::loadData()
  ↓
  ├─ db.getAll<TimeBlock>('timeBlocks')
  │    ↓
  │    LifeTrackerDB.getAll()
  │      ↓
  │    adapter.getAll() [FirebaseAdapter o IndexedDBAdapter]
  │      ↓
  │    FirebaseAdapter.getAll():
  │      ├─ getUserCollection('timeBlocks') → users/{userId}/timeBlocks
  │      ├─ getDocs(collectionRef)
  │      └─ convertTimestampsToDates(results)
  │    OPPURE
  │    IndexedDBAdapter.getAll():
  │      ├─ getStore('timeBlocks')
  │      └─ store.getAll()
  ├─ Filter by userId: allTimeBlocks.filter(b => b.userId === currentUserId)
  ├─ Deserialize dates: new Date(block.startTime), etc.
  ├─ setTimeBlocks(deserializedTimeBlocks)
  └─ TimeBlockPlanner riceve timeBlocks come prop e renderizza
```

**3. AGGIORNAMENTO/CANCELLAZIONE**
- Simile a creazione, ma con `db.update()` o `db.delete()`
- State update ottimistico in `handleUpdateTimeBlock` / `handleDeleteTimeBlock`

#### Goals Flow

**1. CREAZIONE**
```
OKRManager.tsx
  ↓ onClick "Create Goal"
handleCreateItem()
  ↓ onCreateGoal(goalData) [prop da page.tsx]
  ↓
page.tsx::handleCreateGoal()
  ↓
  ├─ Check: isReady
  ├─ Se !isReady → return
  ├─ db.create('goals', goalToCreate)
  ├─ setGoals([...goals, deserializedGoal])
  └─ Logging
```

**2. LETTURA**
- Stesso pattern di TimeBlocks: `loadData()` → `db.getAll('goals')` → filter by userId → setState

---

### Inizializzazione Sistema

#### Sequenza di Init (Browser)

```
1. Next.js SSR: layout.tsx renderizzato (server)
   └─ Nessuna init DB/Auth (server-side)

2. Client hydration: page.tsx montato
   └─ 'use client' → React hydration

3. page.tsx::useEffect[0] - Auth listener
   └─ auth.onAuthStateChange((user) => setCurrentUser(user))
   └─ Firebase Auth già inizializzato in firebase.ts

4. page.tsx::useEffect[1] - DB init (dipende da currentUser?.uid, authLoading)
   └─ if (authLoading || typeof window === 'undefined') return
   └─ db.init()
   │    ↓
   │    LifeTrackerDB.init()
   │      └─ Se adapter è MemoryAdapter → configureAdapter() di nuovo
   │      └─ adapter.init()
   └─ if (currentUser?.uid)
      └─ db.switchToFirebase(currentUser.uid)
         └─ Set adapter = firebaseAdapter
         └─ adapter.setUserId(userId)
         └─ adapter.init()
      └─ loadData()

5. auth.ts::onAuthStateChanged (parallel listener)
   └─ Se user loggato → db.switchToFirebase(user.uid)
```

**PROBLEMA IDENTIFICATO**: Race condition tra `page.tsx` useEffect e `auth.ts` listener. Entrambi chiamano `switchToFirebase`, ma l'ordine non è garantito.

---

## FASE 2 — DIAGNOSI ROOT CAUSE

### PROBLEMA A: Time Block sparisce dopo refresh

#### Sintomi
1. Utente crea timeBlock → appare in UI ✅
2. Utente fa refresh (F5) → timeBlock sparisce ❌
3. Aspettativa: timeBlock deve ricaricarsi da Firebase e rimanere visibile

#### Root Cause Analysis

**CAUSA RADICE #1: Adapter Selection al Costruttore**

**File**: `src/lib/database.ts:680-714`

```typescript
constructor() {
  this.useFirebase = false;
  this.adapter = new MemoryAdapter(); // Placeholder
  this.configureAdapter(); // ⚠️ CHIAMATO AL COSTRUTTORE
}

private configureAdapter() {
  const inBrowser = typeof window !== 'undefined';
  const hasFirebaseConfig = !!firebaseConfig?.apiKey;
  const firebaseReady = hasFirebaseConfig && firebaseAdapter !== null;

  if (!inBrowser) {
    this.useFirebase = false;
    this.adapter = new MemoryAdapter();
    return;
  }

  this.useFirebase = firebaseReady; // ⚠️ Seleziona Firebase SOLO se firebaseAdapter esiste
  this.adapter = this.useFirebase ? firebaseAdapter! : new IndexedDBAdapter();
}
```

**Problema**: 
- `configureAdapter()` viene chiamato nel costruttore PRIMA che Firebase sia inizializzato
- Se `firebaseAdapter` è `null` (non ancora creato), seleziona IndexedDB
- Anche se `switchToFirebase()` viene chiamato dopo, potrebbe esserci una race condition

**CAUSA RADICE #2: Race Condition tra Auth Listener e Page useEffect**

**File**: `src/app/page.tsx:93-128` e `src/lib/auth.ts:55-64`

```typescript
// page.tsx
useEffect(() => {
  if (authLoading || typeof window === 'undefined') return;
  const initializeApp = async () => {
    await db.init();
    if (currentUser?.uid) {
      await db.switchToFirebase(currentUser.uid); // ⚠️ Chiamato qui
      await loadData();
    }
  };
  initializeApp();
}, [currentUser?.uid, authLoading]);

// auth.ts
onAuthStateChanged(auth, (firebaseUser) => {
  if (user) {
    db.switchToFirebase(user.uid).catch(...); // ⚠️ Chiamato anche qui
  }
  this.listeners.forEach(listener => listener(user));
});
```

**Problema**:
- Due listener chiamano `switchToFirebase` in parallelo
- Ordine di esecuzione non garantito
- Se `page.tsx` useEffect esegue prima che `currentUser` sia settato, non chiama `switchToFirebase`
- Se `auth.ts` listener esegue dopo, potrebbe chiamare `switchToFirebase` ma `loadData()` non viene chiamato

**CAUSA RADICE #3: userId non settato durante getAll()**

**File**: `src/lib/firebaseAdapter.ts:89-104`

```typescript
private getUserCollection(collectionName: string): string {
  if (!this.userId) {
    throw new Error('User ID not set. Call setUserId() first.'); // ⚠️ ERRORE
  }
  return `users/${this.userId}/${collectionName}`;
}
```

**Problema**:
- Se `getAll()` viene chiamato prima che `setUserId()` sia chiamato, lancia errore
- Oppure se `userId` viene perso dopo refresh, `getAll()` fallisce silenziosamente

**CAUSA RADICE #4: loadData() chiamato prima di switchToFirebase**

**File**: `src/app/page.tsx:174-276`

```typescript
const loadData = async () => {
  const allTimeBlocks = await db.getAll<TimeBlock>('timeBlocks');
  // ...
  const userTimeBlocks = allTimeBlocks.filter(b => b.userId === currentUserId);
  setTimeBlocks(userTimeBlocks);
};
```

**Problema**:
- Se `loadData()` viene chiamato quando adapter è ancora IndexedDB (non Firebase)
- I dati vengono letti da IndexedDB locale invece che da Firebase
- Dopo refresh, IndexedDB potrebbe essere vuoto o contenere dati vecchi

**CAUSA RADICE #5: FirebaseAdapter non persiste userId tra refresh**

**File**: `src/lib/firebaseAdapter.ts:58-61`

```typescript
export class FirebaseAdapter implements DatabaseAdapter {
  private isInitialized = false;
  private userId: string | null = null; // ⚠️ Reset a null dopo refresh
```

**Problema**:
- `userId` è una proprietà di istanza, non persistita
- Dopo refresh, `firebaseAdapter` viene ricreato o `userId` è `null`
- `setUserId()` deve essere chiamato di nuovo dopo ogni refresh

---

### Condizioni che Attivano il Bug

1. **SSR/Hydration**: Next.js fa SSR → hydration → `db` singleton potrebbe essere ricreato
2. **Auth State Delay**: `onAuthStateChanged` può impiegare tempo per determinare user loggato
3. **Race Condition**: `page.tsx` useEffect e `auth.ts` listener competono
4. **Adapter Selection Timing**: `configureAdapter()` seleziona adapter prima che Firebase sia ready
5. **userId Missing**: `setUserId()` non chiamato prima di `getAll()`

---

### Strumenti di Verifica

**Console Logs**:
- `🔥 PSYCHOPATH:` logs già presenti nel codice
- Verificare: `db.getAdapterDebugInfo()` per vedere adapter attivo
- Verificare: `db.isUsingFirebase` per vedere se Firebase è attivo

**Network Tab**:
- Verificare chiamate Firestore: `users/{userId}/timeBlocks`
- Se non ci sono chiamate → adapter è IndexedDB

**Application Tab (Chrome DevTools)**:
- IndexedDB → `LifeTrackerDB` → `timeBlocks` store
- Verificare se dati sono in IndexedDB invece che Firebase

**Firestore Console**:
- Verificare se dati sono salvati in `users/{userId}/timeBlocks`

**Local Storage**:
- Non usato direttamente, ma potrebbe essere utile per persistire `userId`

---

## FASE 3 — FIX COMPLETO

### Strategia Fix Minimamente Invasiva

1. **Garantire adapter corretto in browser**: Lazy init di adapter solo quando necessario
2. **Garantire userId stabile**: Persist userId in localStorage o sessionStorage
3. **Evitare init SSR**: Spostare tutta init in client-only con guard
4. **Assicurare refresh state**: Chiamare `loadData()` dopo ogni `switchToFirebase`
5. **Eliminare race condition**: Un solo punto di init (page.tsx useEffect)

### Patch Proposte

#### PATCH 1: Fix Adapter Selection Lazy

**File**: `src/lib/database.ts`

**Prima**:
```typescript
constructor() {
  this.useFirebase = false;
  this.adapter = new MemoryAdapter();
  this.configureAdapter(); // ⚠️ Chiamato subito
}
```

**Dopo**:
```typescript
constructor() {
  this.useFirebase = false;
  this.adapter = new MemoryAdapter();
  // ⚠️ NON chiamare configureAdapter() qui
  // Verrà chiamato lazy in init() o switchToFirebase()
}

async init(): Promise<void> {
  // Se siamo in browser e adapter è MemoryAdapter, riconfigura
  if (typeof window !== 'undefined' && this.adapter instanceof MemoryAdapter) {
    this.configureAdapter();
  }
  await this.adapter.init();
}
```

#### PATCH 2: Persist userId in sessionStorage

**File**: `src/lib/firebaseAdapter.ts`

**Prima**:
```typescript
setUserId(userId: string): void {
  this.userId = userId;
}
```

**Dopo**:
```typescript
setUserId(userId: string): void {
  this.userId = userId;
  // Persist in sessionStorage per sopravvivere a refresh
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('firebase_userId', userId);
  }
}

// Aggiungere metodo per restore userId
private restoreUserId(): void {
  if (typeof window !== 'undefined') {
    const savedUserId = sessionStorage.getItem('firebase_userId');
    if (savedUserId) {
      this.userId = savedUserId;
    }
  }
}

async init(): Promise<void> {
  // Restore userId prima di init
  this.restoreUserId();
  // ... resto del codice
}
```

#### PATCH 3: Fix Race Condition - Un solo init point

**File**: `src/app/page.tsx`

**Prima**:
```typescript
useEffect(() => {
  if (authLoading || typeof window === 'undefined') return;
  const initializeApp = async () => {
    await db.init();
    if (currentUser?.uid) {
      await db.switchToFirebase(currentUser.uid);
      await loadData();
    }
  };
  initializeApp();
}, [currentUser?.uid, authLoading]);
```

**Dopo**:
```typescript
useEffect(() => {
  if (authLoading || typeof window === 'undefined') return;
  
  const initializeApp = async () => {
    try {
      await db.init();
      
      // ⚠️ CRITICAL: Aspetta che currentUser sia disponibile
      if (!currentUser?.uid) {
        console.log('⏳ Waiting for user authentication...');
        return;
      }
      
      // ⚠️ CRITICAL: Switch to Firebase PRIMA di loadData
      const adapterInfo = db.getAdapterDebugInfo();
      if (!db.isUsingFirebase || adapterInfo.userId !== currentUser.uid) {
        console.log('🔄 Switching to Firebase for user:', currentUser.uid);
        await db.switchToFirebase(currentUser.uid);
      }
      
      // ⚠️ CRITICAL: Load data SOLO dopo switchToFirebase
      await loadData();
    } catch (error) {
      console.error('❌ Failed to initialize app:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  initializeApp();
}, [currentUser?.uid, authLoading]); // ⚠️ Dipende da currentUser?.uid
```

**File**: `src/lib/auth.ts` - Rimuovere switchToFirebase da qui

**Prima**:
```typescript
onAuthStateChanged(auth, (firebaseUser) => {
  if (user) {
    db.switchToFirebase(user.uid).catch(...); // ⚠️ Rimuovere
  }
  this.listeners.forEach(listener => listener(user));
});
```

**Dopo**:
```typescript
onAuthStateChanged(auth, (firebaseUser) => {
  const user = firebaseUser ? this.mapFirebaseUser(firebaseUser) : null;
  this.currentUser = user;
  
  // ⚠️ NON chiamare switchToFirebase qui
  // Sarà gestito da page.tsx useEffect quando currentUser cambia
  
  this.listeners.forEach(listener => listener(user));
});
```

#### PATCH 4: Guard in getAll() per userId

**File**: `src/lib/firebaseAdapter.ts`

**Prima**:
```typescript
async getAll<T>(collectionName: string): Promise<T[]> {
  await this.init();
  const collectionPath = this.getUserCollection(collectionName); // ⚠️ Può lanciare errore
  // ...
}
```

**Dopo**:
```typescript
async getAll<T>(collectionName: string): Promise<T[]> {
  await this.init();
  
  // ⚠️ CRITICAL: Verifica userId prima di procedere
  if (!this.userId) {
    console.warn('⚠️ FirebaseAdapter: userId not set, cannot getAll');
    return [];
  }
  
  const collectionPath = this.getUserCollection(collectionName);
  // ... resto del codice
}
```

#### PATCH 5: Logging Chirurgico

**File**: `src/app/page.tsx` - Aggiungere log in `loadData()`

```typescript
const loadData = async () => {
  console.log('📊 loadData() START', {
    adapter: db.getAdapterDebugInfo(),
    currentUserId: currentUser?.uid,
    isUsingFirebase: db.isUsingFirebase
  });
  
  const allTimeBlocks = await db.getAll<TimeBlock>('timeBlocks');
  
  console.log('📊 loadData() RETRIEVED', {
    totalTimeBlocks: allTimeBlocks.length,
    adapterUsed: db.getAdapterDebugInfo().adapterType
  });
  
  // ... resto del codice
};
```

---

## CHECKLIST TEST MANUALI

### Scenario 1: Nuovo Utente

1. ✅ Aprire app in incognito
2. ✅ Verificare che adapter sia IndexedDB (console log)
3. ✅ Creare timeBlock → verificare che appaia
4. ✅ Fare refresh → verificare che timeBlock sia ancora visibile (da IndexedDB)
5. ✅ Fare login con Firebase
6. ✅ Verificare che adapter sia Firebase (console log)
7. ✅ Creare nuovo timeBlock → verificare che appaia
8. ✅ Fare refresh → verificare che ENTRAMBI i timeBlocks siano visibili (da Firebase)

### Scenario 2: Utente Già Loggato

1. ✅ Aprire app (utente già loggato da sessione precedente)
2. ✅ Verificare che adapter sia Firebase IMMEDIATAMENTE (console log)
3. ✅ Verificare che timeBlocks esistenti vengano caricati da Firebase
4. ✅ Creare nuovo timeBlock → verificare che appaia
5. ✅ Fare refresh → verificare che tutti i timeBlocks siano ancora visibili

### Scenario 3: Refresh Immediato dopo Save

1. ✅ Creare timeBlock
2. ✅ Verificare che appaia in UI
3. ✅ Fare refresh IMMEDIATAMENTE (< 1 secondo)
4. ✅ Verificare che timeBlock sia ancora visibile
5. ✅ Verificare console per confermare che viene caricato da Firebase

### Scenario 4: Hard Reload (Ctrl+Shift+R)

1. ✅ Creare timeBlock
2. ✅ Fare hard reload (Ctrl+Shift+R)
3. ✅ Verificare che timeBlock sia ancora visibile
4. ✅ Verificare Network tab per chiamate Firestore

### Scenario 5: Incognito (Nuova Sessione)

1. ✅ Aprire app in incognito
2. ✅ Fare login
3. ✅ Creare timeBlock
4. ✅ Chiudere tab
5. ✅ Riaprire app in incognito (stesso browser)
6. ✅ Verificare che utente sia ancora loggato (Firebase Auth persistence)
7. ✅ Verificare che timeBlock sia ancora visibile

### Verifiche Console Logs

Per ogni scenario, verificare:

```
✅ "🔥 PSYCHOPATH: Switching to Firebase for user: {userId}"
✅ "📊 loadData() START" con adapter info corretto
✅ "📊 loadData() RETRIEVED" con count > 0 se ci sono timeBlocks
✅ "🔥 DEV LOG: FirebaseAdapter.getAll SUCCESS" con docCount > 0
✅ Network tab: chiamate a `users/{userId}/timeBlocks`
```

### Verifiche Firestore Console

1. ✅ Aprire Firebase Console → Firestore Database
2. ✅ Navigare a `users/{userId}/timeBlocks`
3. ✅ Verificare che timeBlocks creati siano presenti
4. ✅ Verificare che `userId` field corrisponda all'utente loggato

---

## IMPLEMENTAZIONE FIX

### Patch Applicate

#### ✅ PATCH 1: Fix Adapter Selection Lazy
**File**: `src/lib/database.ts`
- **Modifica**: Rimosso `configureAdapter()` dal costruttore
- **Risultato**: Adapter viene configurato lazy in `init()` solo quando necessario
- **Linee modificate**: 680-684, 716-721

#### ✅ PATCH 2: Persist userId in sessionStorage
**File**: `src/lib/firebaseAdapter.ts`
- **Modifica**: 
  - `setUserId()` ora salva userId in `sessionStorage`
  - Aggiunto `restoreUserId()` che viene chiamato in `init()`
  - `getAll()` verifica userId e restituisce array vuoto invece di errore se mancante
- **Risultato**: userId persiste tra refresh della pagina
- **Linee modificate**: 63-81, 83-104, 260-309

#### ✅ PATCH 3: Fix Race Condition - Un solo init point
**File**: `src/lib/auth.ts`, `src/app/page.tsx`
- **Modifica**:
  - Rimosso `db.switchToFirebase()` da `auth.ts` listener
  - Migliorato `page.tsx` useEffect per gestire correttamente switchToFirebase e loadData
  - Aggiunto check per verificare se switch è necessario prima di chiamarlo
- **Risultato**: Eliminata race condition, un solo punto di init
- **Linee modificate**: `auth.ts:55-68`, `page.tsx:92-128`

#### ✅ PATCH 4: Guard in getAll() per userId
**File**: `src/lib/firebaseAdapter.ts`
- **Modifica**: `getAll()` ora verifica userId e tenta restore da sessionStorage prima di procedere
- **Risultato**: Evita errori quando userId non è settato
- **Linee modificate**: 260-309

#### ✅ PATCH 5: Logging Chirurgico
**File**: `src/app/page.tsx`
- **Modifica**: Aggiunto logging dettagliato in `loadData()` per tracciare adapter utilizzato e dati recuperati
- **Risultato**: Facilita debug e verifica del comportamento
- **Linee modificate**: 188-226

### File Modificati

1. `src/lib/database.ts` - Adapter selection lazy
2. `src/lib/firebaseAdapter.ts` - userId persistence e guard
3. `src/lib/auth.ts` - Rimozione switchToFirebase duplicato
4. `src/app/page.tsx` - Fix init sequence e logging

### Testing

Eseguire la checklist di test manuali nella sezione seguente per verificare che i fix funzionino correttamente.

