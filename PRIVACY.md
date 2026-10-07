# Privacy Policy

_Last updated: October 8, 2026_

Totpy does not collect, transmit or sell any personal data. It has no analytics
and no servers.

- **Your 2FA secrets** are encrypted on your device with your master password and stored in
  your browser's extension storage.
- **Chrome sync (optional):** if enabled, the encrypted vault is stored in your Chrome
  profile's sync storage, which Google syncs between your signed-in browsers. Google receives
  only ciphertext.
- **Google Drive (optional):** if enabled, the encrypted vault is stored in a hidden app-data
  folder in your own Google Drive. The extension only requests the `drive.appdata` scope and
  cannot access your other files. Google receives only ciphertext.
- **Screen capture:** "Scan QR on page" captures the visible tab only when you click it. The
  image is decoded locally and discarded.
- **Filling codes:** when you click **Fill** or **Insert 2FA code**, the extension types the
  code into the page you are on. It gets access to that tab only for that click.
- **Clock check:** at most every 6 hours, the popup sends an empty request to
  `www.googleapis.com` and reads the time from the response, to warn you if your clock is off.
  Nothing about you or your accounts is sent.
- **Automatic copies** are kept encrypted in the extension's local storage only.

Disabling a sync provider in settings lets you delete the encrypted copy stored there.
Uninstalling the extension removes all local data.

Questions? [Open an issue](https://github.com/amit-y11/totpy/issues) on GitHub.
