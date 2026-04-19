# Void Mobile Assets

These source images feed the Capacitor native icon/splash generation pipeline.

Required files:
- `assets/icon-only.png` (1024x1024)
- `assets/splash.png` (2732x2732)
- `assets/splash-dark.png` (2732x2732)

Generate native assets after replacing any source file:

```bash
npm run assets:generate
npm run cap:sync
```

Notes:
- Keep filenames exactly as listed above so the pipeline stays deterministic.
- For production artwork, replace these placeholders with final brand-approved PNGs.
