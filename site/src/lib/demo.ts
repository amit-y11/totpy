// Public demo accounts. Their secrets are intentionally published: the site
// computes real TOTP codes for them in the browser, so anyone can scan the
// demo QR code with their own authenticator and see the same code.

export const DEMO = {
  issuer: 'Totpy Demo',
  account: 'try@totpy.org',
  secret: 'TOTPYDEMOTOTPYDEMOTOTPYDEMOTOTPY',
};

export const demoUri =
  `otpauth://totp/${encodeURIComponent(DEMO.issuer)}:${encodeURIComponent(DEMO.account)}` +
  `?secret=${DEMO.secret}&issuer=${encodeURIComponent(DEMO.issuer)}`;

/** Fictional services used in the page's product mockups. */
export const SAMPLE_ACCOUNTS = [
  { issuer: 'Orbit', account: 'you@work.com', secret: 'ORBITORBITORBIT2', hue: 252 },
  { issuer: 'Northwind', account: 'admin@northwind.io', secret: 'NORTHWINDNORTHW2', hue: 160 },
  { issuer: 'Acme Cloud', account: 'ops@acme.dev', secret: 'ACMECLOUDACMECL2', hue: 28 },
  { issuer: 'Pixel Mail', account: 'me@pixel.email', secret: 'PIXELMAILPIXELM2', hue: 320 },
];
