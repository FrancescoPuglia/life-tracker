# 🔧 FIX CRITICO: userId Non Restaurato Dopo Refresh

## Problema

Dopo refresh, `getUserCollection()` viene chiamato prima che `userId` sia settato, causando errore:
```
❌ PSYCHOPATH: getUserCollection failed: "User ID not set. Call setUserId() first."
```

## Root Cause

1. `getByIndex()` viene chiamato (da `getActiveSessions()` in `loadData()`)
2. `getByIndex()` chiama `getUserCollection()` 
3. Ma `userId` non è ancora stato restaurato da `sessionStorage`
4. `restoreUserId()` viene chiamato solo in `init()`, ma se `init()` è già stato chiamato, non viene chiamato di nuovo

## Fix Applicati

### FIX #1: restoreUserId() Chiamato in Ogni Metodo
**File**: `src/lib/firebaseAdapter.ts`

Aggiunto `this.restoreUserId()` PRIMA di ogni operazione che richiede `userId`:
- `getUserCollection()` - ora chiama `restoreUserId()` prima di verificare `userId`
- `getByIndex()` - chiama `restoreUserId()` e restituisce `[]` se `userId` non è settato
- `read()` - chiama `restoreUserId()` e restituisce `null` se `userId` non è settato
- `update()` - chiama `restoreUserId()` e lancia errore se `userId` non è settato
- `delete()` - chiama `restoreUserId()` e lancia errore se `userId` non è settato
- `query()` - chiama `restoreUserId()` e restituisce `[]` se `userId` non è settato
- `create()` - chiama `restoreUserId()` prima di verificare `userId`

### FIX #2: restoreUserId() Chiamato Sempre in init()
**File**: `src/lib/firebaseAdapter.ts:63-86`

**Prima**:
```typescript
async init(): Promise<void> {
  if (this.isInitialized) return; // ⚠️ Non chiama restoreUserId() se già inizializzato
  this.restoreUserId();
  // ...
}
```

**Dopo**:
```typescript
async init(): Promise<void> {
  // ⚠️ FIX: CRITICAL - Restore userId SEMPRE, anche se già inizializzato
  this.restoreUserId();
  
  if (this.isInitialized) {
    return; // Solo se già inizializzato, return dopo restore
  }
  // ...
}
```

### FIX #3: Verifica userId Dopo switchToFirebase()
**File**: `src/lib/database.ts:757-800`

Aggiunto verifica che `userId` sia settato correttamente dopo `switchToFirebase()`:
```typescript
// ⚠️ FIX: CRITICAL - Verifica che userId sia settato dopo switch
const adapterInfo = this.getAdapterDebugInfo();
if (this.useFirebase && adapterInfo.userId !== userId) {
  throw new Error(`Failed to set userId. Expected: ${userId}, Got: ${adapterInfo.userId}`);
}
```

### FIX #4: Guard in loadData() per getActiveSessions()
**File**: `src/app/page.tsx:352-365`

Aggiunto guard per verificare che adapter sia pronto prima di chiamare `getActiveSessions()`:
```typescript
// ⚠️ FIX: CRITICAL - Verifica che adapter sia pronto prima di chiamare getActiveSessions
if (currentUser && db.isUsingFirebase) {
  const adapterInfo = db.getAdapterDebugInfo();
  if (adapterInfo.userId === currentUser.uid) {
    try {
      const activeSessions = await db.getActiveSessions(currentUser.uid);
      // ...
    } catch (error) {
      console.warn('⚠️ Failed to load active sessions:', error);
      // Non bloccare il resto del caricamento
    }
  }
}
```

## File Modificati

1. **`src/lib/firebaseAdapter.ts`**
   - Aggiunto `restoreUserId()` in tutti i metodi che richiedono `userId`
   - Modificato `init()` per chiamare `restoreUserId()` sempre
   - Aggiunto guard in `getByIndex()`, `read()`, `query()` per restituire valori safe invece di errore

2. **`src/lib/database.ts`**
   - Aggiunto verifica `userId` dopo `switchToFirebase()`

3. **`src/app/page.tsx`**
   - Aggiunto guard per `getActiveSessions()` in `loadData()`

## Risultato Atteso

Dopo questi fix:
1. ✅ `userId` viene restaurato da `sessionStorage` prima di ogni operazione
2. ✅ `getByIndex()` non fallisce se `userId` non è settato (restituisce `[]`)
3. ✅ `getActiveSessions()` viene chiamato solo quando adapter è pronto
4. ✅ Nessun errore "User ID not set" dopo refresh

## Test

1. Login con Firebase
2. Creare timeBlock e goal
3. Fare refresh (F5)
4. **Verificare**: Nessun errore in console
5. **Verificare**: Dati sono ancora visibili
6. **Console**: Verificare log `💾 userId restored from sessionStorage`

