# 🧠 Guida Setup AI Vera - ChatGPT Integration

## 🎯 STATO ATTUALE

✅ **IMPLEMENTAZIONE COMPLETATA:**
- AIInputBarV2 integrato in MainApp.tsx 
- Struttura completa OpenAI con Function Calling
- 4 modalità AI: Ask, Plan, Analyze, Coach
- Sistema robusto di proposte modifiche

⚠️ **MODALITÀ PREVIEW ATTIVA:**
L'AI attualmente mostra una preview dei dati senza chiamare OpenAI. Per attivare l'AI vera segui i passi sotto.

---

## 🚀 ATTIVAZIONE AI VERA

### **Step 1: Configurazione API Key**

1. Ottieni una API key da [OpenAI](https://platform.openai.com/api-keys)
2. Modifica `.env.local`:
```env
# Sostituisci con la tua vera API key
OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE
```

### **Step 2: Abilitare API Routes**

Il progetto attualmente usa `output: export` che non supporta API routes.

**Opzione A - Per Development e Server Deploy:**
```javascript
// next.config.js - Commenta output export
const nextConfig = {
  // COMMENTED FOR AI: ...(process.env.NODE_ENV === 'production' && {
  //   output: 'export',
  //   trailingSlash: true,
  // }),
  // ... resto config
}
```

**Opzione B - Per Static Deploy (Vercel/Netlify):**
Usa Edge Functions o serverless functions invece delle API routes Next.js

### **Step 3: Ripristinare API Route**

```bash
mkdir -p src/app/api/ai/chat
```

Copia `route.ts` dalla cartella downloads alla destinazione:
```bash
cp /mnt/c/Users/Franc/Downloads/route.ts src/app/api/ai/chat/
```

### **Step 4: Aggiornare AIInputBarV2**

Sostituisci il mock nella funzione `sendMessage()`:
```typescript
// RIMUOVI QUESTO MOCK:
const mockData = { ... };

// RIPRISTINA QUESTO:
const response = await fetch('/api/ai/chat', {
  method: 'POST', 
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: modePrefix + text,
    context,
    history,
    userId,
  }),
});
```

---

## 🎮 FUNZIONALITÀ AI

### **Ask Mode** 
- "Com'è andata oggi?"
- "Quali task sono a rischio?"
- Analisi dello stato attuale

### **Plan Mode**
- "Ottimizza la mia giornata" 
- "Aggiungi 2h di deep work"
- Modifiche concrete ai time blocks

### **Analyze Mode**
- "Dove sto andando bene?"
- "Analisi settimanale"
- Pattern e insights sui dati

### **Coach Mode**
- "Perché fallisco questa abitudine?"
- "Weekly review"
- Consigli personalizzati if-then

---

## 💰 COSTI PREVISTI

**GPT-4o-mini (RACCOMANDATO):**
- ~€0.50-2/mese per uso moderato
- Ottima qualità/prezzo

**GPT-4o (PREMIUM):**
- ~€3-10/mese
- Analisi più profonde

---

## ⚡ COSA VEDRAI

L'AI avrà accesso COMPLETO a:
- ✅ Tutti i tuoi goals con progresso
- ✅ Tasks con priorità e deadline  
- ✅ Time blocks pianificati vs tempo reale
- ✅ Abitudini con streak counters
- ✅ KPIs calcolati in tempo reale

E potrà **MODIFICARE** concretamente:
- ✅ Creare/spostare/eliminare time blocks
- ✅ Aggiornare priorità dei task
- ✅ Ottimizzare la giornata
- ✅ Suggerire if-then plans per abitudini

---

## 🔧 TROUBLESHOOTING

**"API key not found"**
→ Verifica .env.local con OPENAI_API_KEY

**"Failed to fetch /api/ai/chat"**  
→ Disabilita `output: export` in next.config.js

**"Rate limit exceeded"**
→ Stai facendo troppe richieste, aspetta

**L'AI non propone modifiche**
→ Usa modalità "Plan" e chiedi modifiche specifiche

---

## 🎯 PROSSIMI STEP

1. **Implementa Sessions nel DataProvider** per dati tempo reale più accurati
2. **Aggiungi Domains** per contestualizzazione goal/progetti  
3. **Streaming responses** per UX real-time
4. **Custom tools** per funzioni specifiche della tua app

---

**🧠 L'AI è pronta - basta attivarla! 🚀**