# Changelog

All notable changes to Totpy are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-08

First public release.

### Added

- 6, 7 and 8-digit TOTP codes with SHA-1, SHA-256 and SHA-512, with copy, search and countdown
- Add accounts by scanning a QR code on the page, uploading a QR image, pasting an `otpauth://`
  link or typing the setup key
- Import from Google Authenticator exports and lists of `otpauth://` links
- Fill codes into pages from the popup, and right-click **Insert 2FA code**
- Suggested accounts for the current site
- Master-password encryption (AES-256-GCM, PBKDF2-SHA-256) with a recovery code
- End-to-end encrypted sync through Chrome sync and Google Drive
- Automatic daily encrypted copies, kept for 7 days
- Encrypted backup export and import, and plain `otpauth://` export
- Auto-lock and a clock-drift warning
- Light and dark themes

[Unreleased]: https://github.com/amit-y11/totpy/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/amit-y11/totpy/releases/tag/v1.0.0
