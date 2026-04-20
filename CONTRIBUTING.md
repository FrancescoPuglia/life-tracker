# Contributing to Life Tracker

Thank you for contributing! This guide will help maintain code quality and consistency.

## 🛠️ Development Setup

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/life-tracker.git`
3. Install dependencies: `npm install`
4. Copy environment template: `cp .env.local.example .env.local`
5. Configure `.env.local` with your credentials
6. Start dev server: `npm run dev`

## 📜 Code Style

### TypeScript

- **Strict mode**: Enabled (no `any` without justification)
- **Naming conventions**:
  - Components: PascalCase (`MyComponent.tsx`)
  - Functions: camelCase (`calculateProgress`)
  - Constants: UPPER_SNAKE_CASE (`MAX_RETRIES`)
  - Types/Interfaces: PascalCase (`interface Goal {}`)

### Formatting

Run Prettier before committing:
```bash
npx prettier --write src/
```

### ESLint Rules

- No unused variables (prefix with `_` if intentional)
- No `console.log` (use `console.warn`/`console.error`)
- Warn on `any` type usage

## ✅ Testing

### Writing Tests

**Test file naming**: `*.test.ts` or `*.test.tsx`

**Run tests**:
```bash
npm run test          # Watch mode
npm run test:run      # Single run
npm run test:coverage # With coverage
```

**Example**:
```typescript
import { describe, it, expect } from 'vitest';

describe('myFunction', () => {
  it('should do something', () => {
    expect(myFunction(input)).toBe(expected);
  });
});
```

**Coverage requirements**:
- Core logic (`lib/`): >80%
- Components: >60%
- Utils: >90%

## 🔀 Git Workflow

### Branch Naming

- `feature/add-thing` - New features
- `fix/bug-description` - Bug fixes
- `refactor/improve-thing` - Code improvements
- `docs/update-readme` - Documentation
- `test/add-tests` - Adding tests

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

**Types**: feat, fix, refactor, test, docs, chore, perf

**Examples**:
```
feat(okr): add cascade delete for goals
fix(rollup): exclude deleted entities from calculations
test(rollup): add unit tests for progress calculation
```

### Pull Request Process

1. Create PR against `main` branch
2. Fill out template (what changed, why, test plan)
3. Ensure CI passes (build, tests, lint)
4. Request review from maintainers
5. Address feedback
6. Squash and merge when approved

## 🏗️ Architecture Guidelines

### Adding New Features

1. Plan first (discuss in GitHub issue)
2. Define TypeScript interfaces in `src/types/`
3. Add to data layer (`database.ts`) if new collection
4. Implement business logic in `src/lib/`
5. Update `DataProvider.tsx` with CRUD operations
6. Create UI component in `src/components/`
7. Add tests for logic + critical UI

### File Size Limits

- Components: <500 LoC (split if larger)
- Lib files: <1000 LoC (refactor if larger)

### Security Checklist

- [ ] No secrets in code (use `.env.local`)
- [ ] User input sanitized (DOMPurify for HTML)
- [ ] API routes have rate limiting
- [ ] Firestore rules deny by default

## 🐛 Bug Reports

### Issue Template

```markdown
**Bug Description**
Clear, concise description

**To Reproduce**
1. Go to '...'
2. Click on '...'
3. See error

**Expected Behavior**
What should happen

**Environment**
- Browser: Chrome 120
- OS: macOS 14
- Version: 1.0.0
```

## 📝 Documentation

### Code Comments

- Explain *why*, not *what*
- Use JSDoc for public APIs

**Example**:
```typescript
/**
 * Calculate hierarchical progress rollup.
 *
 * @param userId - Filter to specific user's data
 * @returns Updates for each level of hierarchy
 */
export async function performHierarchicalRollup(userId: string): Promise<RollupResult> {
  // ...
}
```

## ❓ Questions?

- Check [README.md](README.md)
- Check [CLAUDE.md](CLAUDE.md)
- Open a GitHub Discussion
- Open an issue

---

**Happy coding!** 🎉
