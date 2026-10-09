# Setting up Google Drive sync

Chrome sync works out of the box. Google Drive sync needs a Google OAuth client ID tied to the
extension's ID. Whoever publishes a build sets this up once; people who install that build
just click **Connect Google Drive**. Without a client ID, the Drive option is shown as
unavailable and everything else works.

The manifest already contains the client ID for the Chrome Web Store version (item ID
`hhhkbhfahgcieokmgibiapncicnpcing`). Google only accepts it from that extension ID, so if you
load Totpy unpacked or publish your own build, replace it with your own client ID as described
below.

Totpy uses the `drive.appdata` scope. It can only see a hidden folder that Totpy creates, never
your other Drive files.

## 1. Give the extension a stable ID

Unpacked extensions get a random ID unless the manifest contains a public key.

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem
```

```bash
openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
```

Add the printed value to `src/manifest.json` as `"key": "<value>"`, run `npm run build` and
reload the extension. Copy its ID from `chrome://extensions`.

Keep `key.pem` private (it is git-ignored). When you publish to the Chrome Web Store, use the
store's item ID instead.

## 2. Create the OAuth client

In the [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project and enable the **Google Drive API**.
2. Configure the **OAuth consent screen** and add the scope
   `https://www.googleapis.com/auth/drive.appdata`. While the app is in testing, add your
   Google account as a test user.
3. Go to **Credentials → Create credentials → OAuth client ID**, choose the **Chrome
   Extension** application type and paste your extension ID.

## 3. Add it to the manifest

Put the client ID in `src/manifest.json`:

```json
"oauth2": {
  "client_id": "1234567890-abc.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/drive.appdata"]
}
```

Rebuild, reload the extension and turn on **Google Drive** in **Settings → Sync**.

## Notes

- Google Drive sync uses `chrome.identity.getAuthToken`, which is only available in Google
  Chrome.
- Publishing an app that uses Drive scopes requires Google's OAuth verification, which asks for
  a homepage and a privacy policy. Use <https://totpy.org> and <https://totpy.org/privacy>.
