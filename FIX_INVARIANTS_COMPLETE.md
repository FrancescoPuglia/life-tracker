# 🔧 FIX COMPLETO: Invarianti Firebase userId

## Patch Applicate

### 1. database.ts - configureAdapter() NON seleziona FirebaseAdapter di default

**File**: `src/lib/database.ts:687-715`

**Prima**: Selezionava FirebaseAdapter se `firebaseReady === true` (anche senza userId)

**Dopo**: 
- Default: IndexedDBAdapter sempre
- FirebaseAdapter viene selezionato SOLO tramite `switchToFirebase(userId)`
- Garantisce INVARIANTE A: se `useFirebase === true` allora `userId` è settato

### 2. database.ts - switchToFirebase() Atomico

**File**: `src/lib/database.ts:757-832`

**Modifiche**:
- Aggiunto campo `_activeUserId` per tracciare userId attivo
- Operazione atomica:
  1. Set `_activeUserId = userId`
  2. Set `adapter = firebaseAdapter`
  3. Chiamare `adapter.setUserId(userId)` SINCRONO
  4. `await adapter.init()`
  5. Set `useFirebase = true` SOLO dopo tutto pronto
- Aggiunto `checkInvariants()` che verifica INVARIANTE A e B
- Getter `activeUserId` per accesso esterno

### 3. database.ts - Invariant Check B in create/getAll

**File**: `src/lib/database.ts:848-867, 901-929`

**Modifiche**:
- Prima di `adapter.create()`: verifica che se `useFirebase === true` allora `adapter.userId === activeUserId`
- Prima di `adapter.getAll()`: stessa verifica
- Se invariante violato: lancia errore chiaro invece di procedere

### 4. page.tsx - Flag dbReadyForUser

**File**: `src/app/page.tsx:76, 137-160`

**Modifiche**:
- Aggiunto stato `dbReadyForUser` (inizia come `false`)
- `isReady` ora include `dbReadyForUser`: `!!currentUser?.uid && db.isUsingFirebase && dbReadyForUser`
- `setDbReadyForUser(true)` viene chiamato SOLO dopo `switchToFirebase()` completato con successo
- `loadData()` viene chiamato SOLO se `dbReadyForUser === true` o se già usando Firebase con userId match

### 5. page.tsx - Guard in handleCreateTimeBlock e handleCreateGoal

**File**: `src/app/page.tsx:572-580, 801-811`

**Modifiche**:
- Entrambi verificano `!isReady || !dbReadyForUser` prima di procedere
- Log chiaro quando bloccati
- `handleCreateTimeBlock` mostra errore UI se bloccato

### 6. Invariant Check Logging

**File**: `src/lib/database.ts:810-832`

Aggiunto logging "INVARIANT CHECK" che stampa:
- `currentUserId`
- `dbIsUsingFirebase`
- `dbActiveUserId`
- `firebaseAdapterUserId`
- `invariantA` (se useFirebase allora userId match)
- `invariantB` (se useFirebase allora userId non null)

## File Modificati

1. **`src/lib/database.ts`**
   - `configureAdapter()`: Default IndexedDBAdapter
   - `switchToFirebase()`: Operazione atomica con invariant check
   - `create()`, `getAll()`: Invariant check B prima di operazioni
   - Aggiunto `_activeUserId` e getter `activeUserId`

2. **`src/app/page.tsx`**
   - Aggiunto stato `dbReadyForUser`
   - Modificato `isReady` per includere `dbReadyForUser`
   - `handleCreateTimeBlock` e `handleCreateGoal` verificano `dbReadyForUser`
   - `loadData()` chiamato solo quando DB è pronto

## Checklist Test

### ✅ Test 1: Login → Create TimeBlock → Refresh → TimeBlock Presente
1. Login con Firebase
2. Creare timeBlock
3. Fare refresh (F5)
4. **Verificare**: TimeBlock è ancora visibile
5. **Console**: Verificare log `🔍 INVARIANT CHECK` con valori corretti

### ✅ Test 2: Create Goal → Appare Subito
1. Creare goal
2. **Verificare**: Goal appare IMMEDIATAMENTE in UI
3. **Console**: Verificare log `🔥 PSYCHOPATH: Goals count before: X after: X+1`

### ✅ Test 3: Hard Refresh (Ctrl+Shift+R)
1. Creare timeBlock e goal
2. Fare hard reload (Ctrl+Shift+R)
3. **Verificare**: Dati sono ancora visibili
4. **Console**: Verificare che `dbReadyForUser` viene settato correttamente

### ✅ Test 4: Incognito
1. Aprire app in incognito
2. Login
3. Creare timeBlock e goal
4. **Verificare**: Nessun errore "Firebase userId not set"
5. **Console**: Verificare invariant checks

## Risultato Atteso

Dopo questi fix:
1. ✅ INVARIANTE A: Se `db.isUsingFirebase === true` allora `adapter.userId === currentUser.uid`
2. ✅ INVARIANTE B: Nessuna chiamata a `db.create/getAll/update/delete` raggiunge FirebaseAdapter senza userId
3. ✅ INVARIANTE C: `loadData()` non sovrascrive state con `[]` quando DB non è pronto
4. ✅ TimeBlocks persistono dopo refresh
5. ✅ Goals appaiono immediatamente dopo creazione
6. ✅ Nessun errore "Firebase userId not set"

