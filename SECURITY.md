# Security Policy

Totpy stores 2FA secrets, so we take security reports seriously. Thank you for helping keep its
users safe.

## Supported versions

Security fixes go into the latest release. Please update before reporting.

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |

## Reporting a vulnerability

**Please don't open a public issue.** Report privately through
[GitHub Security Advisories](https://github.com/amit-y11/totpy/security/advisories/new).

Please include:

- What the problem is and its impact
- Steps or a proof of concept to reproduce it
- The Totpy version and Chrome version

What to expect:

- An acknowledgement within 7 days
- A fix or mitigation plan, coordinated with you before anything is made public
- Credit in the release notes, if you'd like

## Scope

In scope:

- Weaknesses in vault encryption, key derivation, key handling or the recovery code
- Ways for a sync provider, backup file or web page to read, alter or lock away secrets
- Ways to bypass the lock or auto-lock
- Code filled into the wrong site, or secrets reaching a web page

Out of scope:

- Attacks that need malware on the user's computer, or an already unlocked browser profile
- Weak master passwords chosen by users
- Missing hardening that has no demonstrated impact

## Design

See [docs/security.md](docs/security.md) for how Totpy encrypts, syncs and recovers vaults, and
its threat model.
