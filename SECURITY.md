# Security Policy

## 🚨 CRITICAL: Exposed API Key Detected

**If you cloned this repository before 2026-01-11**, your `.env.local` may contain an **exposed OpenAI API key**.

### Immediate Actions Required:

1. **Revoke the key**:
   - Go to https://platform.openai.com/api-keys
   - Find key starting with `sk-proj-fHChBCV...`
   - Click "Revoke"

2. **Generate new key**:
   - Create new secret key
   - Copy to `.env.local` (NEVER commit)
   - Set spending limits

3. **Verify `.gitignore`**:
   ```bash
   # Ensure .env.local is ignored
   grep ".env.local" .gitignore
   ```

4. **Remove from Git history** (if committed):
   ```bash
   # WARNING: Rewrites history, coordinate with team
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch .env.local" \
     --prune-empty --tag-name-filter cat -- --all

   git push --force --all
   git push --force --tags
   ```

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead:
1. Email: **security@yourapp.com** (replace with actual email)
2. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (optional)

We will respond within 48 hours.

## Security Best Practices

### Environment Variables

- ✅ **DO**: Use `.env.local` for secrets (gitignored)
- ✅ **DO**: Prefix client-safe vars with `NEXT_PUBLIC_`
- ❌ **DON'T**: Commit `.env.local` to Git
- ❌ **DON'T**: Log secrets to console

### API Routes

- ✅ **DO**: Implement rate limiting (10 req/min)
- ✅ **DO**: Validate all inputs
- ✅ **DO**: Use server-side API keys only
- ❌ **DON'T**: Trust client input without validation

### Firebase

- ✅ **DO**: Deploy Firestore rules (`npm run firebase:rules`)
- ✅ **DO**: Use user-scoped paths: `/users/{userId}/...`
- ❌ **DON'T**: Allow public read/write access

### Dependencies

- ✅ **DO**: Run `npm audit` regularly
- ✅ **DO**: Update dependencies quarterly
- ❌ **DON'T**: Ignore security warnings

## Secrets Rotation Schedule

| Secret | Rotation Frequency | Last Rotated |
|--------|-------------------|--------------|
| OpenAI API Key | 90 days | 2026-01-11 |
| Firebase Service Account | 180 days | TBD |

## Contact

For questions: security@yourapp.com
