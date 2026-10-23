## Summary

<!-- Briefly describe the purpose and outcome of this pull request. -->

## Motivation & Context

<!-- Explain why this change is necessary. Link to relevant issues: e.g. Fixes #123 -->

## Change Type

<!-- Check all that apply: -->
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Performance improvement
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] Security fix
- [ ] Build / CI tooling change

## Implementation Details

<!-- Outline key technical decisions, modified files, and non-obvious logic. -->

## Testing Performed

<!-- Detail the automated and manual testing carried out: -->
- [ ] Automated tests pass locally (`npm test`)
- [ ] Production export build passes (`npm run build`)
- [ ] Electron startup smoke test passes (`npm run smoke`)
- [ ] Extension packaging succeeds (`npm run package:extension`)
- [ ] Manual verification performed on Windows (describe below):

### Manual Verification Details
<!-- Describe steps, test URLs, or scenarios tested manually -->

## Screenshots / UI Diffs (if applicable)

<!-- Add before/after screenshots for visual UI changes -->

## Security, Privacy & Hygiene Checklist

- [ ] Untrusted inputs pass validation (no shell injection, SSRF, or path traversal)
- [ ] No plaintext passwords, API keys, or cloud credentials are exposed or logged
- [ ] No personal tokens, machine paths, or local `.env` files are committed
- [ ] No temporary files, local SQLite databases (`.db`), downloads, or build artifacts staged
- [ ] Backward compatibility preserved for existing databases and settings
- [ ] Interrupted operations remain safely recoverable

## Documentation Checklist

- [ ] Documentation updated in `docs/` or `README.md` (if applicable)
- [ ] `CHANGELOG.md` entry added (if applicable)
