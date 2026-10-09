// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://totpy.org',
  integrations: [sitemap()],
  // The privacy page renders ../PRIVACY.md, so the policy has a single source.
  vite: { server: { fs: { allow: ['..'] } } },
});
