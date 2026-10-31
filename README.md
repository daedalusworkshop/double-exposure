# Double

A double-exposure camera: take or pick two photos and blend them (Average, Lighten, Add, Darken).

Built with Expo / React Native. Runs on iPhone in Expo Go, and on the web at
**https://daedalusworkshop.github.io/double-exposure/** once GitHub Pages is enabled.

## Run locally

```bash
npm install
npx expo start          # scan the QR code with Expo Go
npm run build:web       # static web build in dist/
```

## Web hosting

`.github/workflows/deploy-pages.yml` builds the web version and publishes it to
GitHub Pages on every push to `main`. One-time setup: repo **Settings → Pages →
Build and deployment → Source: GitHub Actions**.

The web build is served from `/double-exposure` (set by `experiments.baseUrl` in
`app.json`); change both if the repo is renamed.
