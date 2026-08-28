# Security

## Reporting

If you find a security issue in this repository (e.g. accidental secret commit,
XSS in the tuner page, unsafe dependency usage), open a private report via
GitHub Security Advisories when available, or contact the repository owner.

## What this project is not

- Not a tile proxy or API key vault.
- Do not commit real map provider keys into tracked config files — prefer a
  gitignored `map-tiles.config.local.js`.
- The HTTP tuner is a **local / demo design tool**, not a hardened production host.

## Secrets policy

This repository should never contain:

- Map / cloud API keys or tokens
- Credentials for render farms or private services
- A redistributable hydrography pack (`water-data.js` / `water-manifest.json`). This public repository and its GitHub Pages site must not publish `water-data.js` again.
