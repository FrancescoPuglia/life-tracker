# 🎯 Life Tracker

A comprehensive personal life management application with goal tracking, time blocking, habits, notes, analytics, and AI coaching.

## 🚀 Features

- **OKR Management**: Goals → Projects → Tasks with hierarchical progress tracking
- **Time Block Planner**: Google Calendar-style scheduling with weekly repeats
- **Weekly Planning Intelligence** (v1.2): natural-language weekly intentions → draft week → safe commit → plan-vs-actual review. Deterministic, local-first, no AI in MVP. See [`docs/WEEKLY_PLANNING_INTELLIGENCE.md`](docs/WEEKLY_PLANNING_INTELLIGENCE.md).
- **Hierarchical Rollup**: Automatic progress calculation from completed time blocks
- **Cascade Delete** (v1.1): Delete goals → auto-deletes projects → tasks (with audit trail)
- **Habits Tracker**: Daily habits with streak counting
- **Rich Notes**: Notion-like block editor powered by Tiptap
- **Vision Board**: Visual goal manifestation
- **Analytics Dashboard**: Charts, metrics, ROI analysis
- **Secure AI Coaching**: grounded Responses API analysis and human-approved proposals through an authenticated Firebase Functions backend
- **Dual-Mode Persistence**:
  - Logged users: Firebase Firestore (cloud sync)
  - Guest users: IndexedDB (local storage)

### 🧭 Weekly Planning Intelligence (v1.2)

Turn natural-language weekly intentions into a reviewable, draft-first week of real TimeBlocks — with plan-vs-actual calibration the following week.

- **Write your week**: *"Ogni giorno sveglia alle 7. Lunedì Catalana 2 ore. Palestra 4 volte a settimana. Leggere ogni sera 30 minuti."*
- **Deterministic engine**: regex + tables, no LLM, no API key. Same input → same draft.
- **Goal/Project/Task mapping**: each intent maps to your OKR with a confidence score + "needs review" gate.
- **Realism score 0–100** with explainable penalties (overload, context switches, recovery, goal coverage).
- **Draft-first persistence**: `localStorage` only. Nothing reaches the calendar until you click Approve.
- **Idempotent commit**: every TimeBlock carries a `WPI_KEY` in its notes — re-approve is a no-op, no duplicates.
- **Plan-vs-actual review**: completion rate, planned/completed hours, day breakdown, realism calibration verdict.
- **Stack**: TypeScript (zero `any`), React 18, Tailwind, Vitest. 126 tests across engine + UI.

Full architecture, safety model, data flow and roadmap: [`docs/WEEKLY_PLANNING_INTELLIGENCE.md`](docs/WEEKLY_PLANNING_INTELLIGENCE.md).

## 📋 Prerequisites

- **Node.js**: 18.x or higher
- **npm**: 9.x or higher
- **Firebase Project**: (optional, for production)
- **Firebase CLI + Java 21**: for emulator-backed Rules and transaction tests
- **OpenAI project key**: optional for a separately approved live backend; never needed for builds or automated tests

## ⚙️ Setup

### 1. Clone & Install

```bash
git clone https://github.com/your-username/life-tracker.git
cd life-tracker
npm install
```

### 2. Environment Variables

```bash
cp .env.local.example .env.local
# Configure public Firebase Web SDK values and NEXT_PUBLIC_AI_API_BASE_URL
```

**⚠️ NEVER commit `.env.local` to Git!**

See `.env.local.example`, [AI_SETUP_GUIDE.md](AI_SETUP_GUIDE.md), and [SECURITY.md](SECURITY.md). Provider secrets belong only in Firebase Secret Manager.

### 3. Run

```bash
npm run dev  # Development at http://localhost:3000
npm run build && npm start  # Production
```

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests (watch) |
| `npm run test:coverage` | Coverage report |
| `npm run test:rules` | Firestore Rules emulator tests |
| `npm run test:functions:emulator` | Firestore transaction integration tests |
| `npm run test:auth:emulator` | Firebase Auth boundary integration tests |
| `npm run check:static-security` | Browser/static AI security scan |
| `npm --prefix functions run test:run` | Functions unit tests |
| `npm --prefix functions run build` | Build the Functions backend |

## 🧪 Testing

```bash
npm run test          # Watch mode
npm run test:run      # Single run (CI)
npm run test:coverage # With coverage
npm run test:ui       # Interactive UI
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for testing guidelines.

## 🔐 Security

- **Identity**: Firebase ID tokens are verified by Firebase Admin; UID comes only from the decoded token
- **Authorization**: deny-by-default client Rules plus independent UID-scoped Admin repository methods
- **AI authority**: strict read/proposal tools; apply and rollback require an exact, expiring user-held capability
- **Abuse controls**: bounded input/tool/context sizes and a Firestore-backed per-user limiter shared across Function instances
- **Secrets**: OpenAI and capability secrets are bound only to the HTTPS Function through Secret Manager

Report vulnerabilities: See [SECURITY.md](SECURITY.md)

## 🐛 Troubleshooting

**Build fails**: Check `tsconfig.json` paths, restart TS server
**Firebase auth error**: Verify `.env.local` has correct Firebase config
**AI not configured**: set the public `NEXT_PUBLIC_AI_API_BASE_URL` during the frontend build
**Backend provider error**: verify the rotated Function secret and backend logs; never add a provider key to `.env.local`
**Rate limit**: Wait 1 minute, check for infinite API call loops

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Code style guidelines
- Git workflow
- Testing requirements
- PR process

## 📊 Architecture

**Tech Stack**: static Next.js 15 + TypeScript frontend; Firebase Auth/Firestore/Functions backend; server-only OpenAI Responses API
**State**: React Context (DataProvider)
**Persistence**: Adapter pattern (Firebase/IndexedDB/Memory)
**Rollup**: TimeBlock → Task → Project → Goal (automatic)

The secure AI flow is: browser → Firebase Auth → HTTPS Function → UID-scoped domain tools → Responses API → immutable preview → explicit approval → Firestore transaction → verification/audit/rollback. See [AI_SETUP_GUIDE.md](AI_SETUP_GUIDE.md) and [docs/SECURE_AI_INTEGRATION.md](docs/SECURE_AI_INTEGRATION.md).

See [CLAUDE.md](CLAUDE.md) for detailed architecture.

## 📄 License

MIT License

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/your-username/life-tracker/issues)
- **Security**: [SECURITY.md](SECURITY.md)
- **Docs**: [CLAUDE.md](CLAUDE.md)

---

**Version**: 1.1.0 (Cascade Delete + Test Framework + Security Hardening)
**Last Updated**: 2026-01-11
