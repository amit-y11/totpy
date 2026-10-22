# Changelog

All notable changes to Totpy are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Unlock with a passkey (Touch ID, Windows Hello, your phone or a security key) instead of
  typing the master password. It's offered after creating or restoring a vault and can be
  turned on or off in Settings. It works on that device only and needs a passkey provider
  that supports the WebAuthn PRF extension.

- A README FAQ entry on the security trade-off of keeping 2FA codes in the browser, and when
  to use a security key or phone authenticator instead

### Changed

- The website and README link to Totpy on the Chrome Web Store

## [1.0.1] - 2026-10-09

### Added

- The [totpy.org](https://totpy.org) website, with the privacy policy at totpy.org/privacy

### Changed

- The extension's homepage link now points to totpy.org
- Google Drive sync works out of the box in the Chrome Web Store version, which now ships
  with Totpy's Google OAuth client ID

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

[Unreleased]: https://github.com/amit-y11/totpy/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/amit-y11/totpy/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/amit-y11/totpy/releases/tag/v1.0.0
