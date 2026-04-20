# 🎯 Life Tracker

A comprehensive personal life management application with goal tracking, time blocking, habits, notes, analytics, and AI coaching.

## 🚀 Features

- **OKR Management**: Goals → Projects → Tasks with hierarchical progress tracking
- **Time Block Planner**: Google Calendar-style scheduling with weekly repeats
- **Hierarchical Rollup**: Automatic progress calculation from completed time blocks
- **Cascade Delete** (v1.1): Delete goals → auto-deletes projects → tasks (with audit trail)
- **Habits Tracker**: Daily habits with streak counting
- **Rich Notes**: Notion-like block editor powered by Tiptap
- **Vision Board**: Visual goal manifestation
- **Analytics Dashboard**: Charts, metrics, ROI analysis
- **AI Coaching**: OpenAI-powered scheduling, risk prediction
- **Dual-Mode Persistence**:
  - Logged users: Firebase Firestore (cloud sync)
  - Guest users: IndexedDB (local storage)

## 📋 Prerequisites

- **Node.js**: 18.x or higher
- **npm**: 9.x or higher
- **Firebase Project**: (optional, for production)
- **OpenAI API Key**: (optional, for AI features)

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
# Edit .env.local with your credentials
```

**⚠️ NEVER commit `.env.local` to Git!**

See `.env.local.example` for template and [SECURITY.md](SECURITY.md) for key rotation.

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
| `npm run firebase:deploy` | Deploy to Firebase |

## 🧪 Testing

```bash
npm run test          # Watch mode
npm run test:run      # Single run (CI)
npm run test:coverage # With coverage
npm run test:ui       # Interactive UI
```

**Current Coverage**: 80%+ core logic, 70%+ API routes

See [CONTRIBUTING.md](CONTRIBUTING.md) for testing guidelines.

## 🔐 Security

- **API Key Exposure**: See [SECURITY.md](SECURITY.md) for rotation instructions
- **Rate Limiting**: 10 req/min per IP on `/api/ai/chat`
- **Firestore Rules**: User-scoped access only
- **Input Validation**: All API routes validate inputs

Report vulnerabilities: See [SECURITY.md](SECURITY.md)

## 🐛 Troubleshooting

**Build fails**: Check `tsconfig.json` paths, restart TS server
**Firebase auth error**: Verify `.env.local` has correct Firebase config
**OpenAI 401**: Check `OPENAI_API_KEY` is valid and not revoked
**Rate limit**: Wait 1 minute, check for infinite API call loops

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Code style guidelines
- Git workflow
- Testing requirements
- PR process

## 📊 Architecture

**Tech Stack**: Next.js 15 + TypeScript + Firebase + OpenAI
**State**: React Context (DataProvider)
**Persistence**: Adapter pattern (Firebase/IndexedDB/Memory)
**Rollup**: TimeBlock → Task → Project → Goal (automatic)

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
