# License exceptions (not covered by MIT)

The repository root [LICENSE](LICENSE) is a standard MIT grant for project
**code and documentation**. The items below are **out of scope** of that grant.
This file exists so GitHub / SPDX can detect MIT on `LICENSE` while keeping the
same legal intent previously appended to that file.

Also see [DATA-PROVENANCE.md](DATA-PROVENANCE.md) and [NOTICE.md](NOTICE.md).

## 1. Geographic overlay data

This repository **does not include** a bundled China water / hydrography pack.
Do not assume any former or external `water-data.js` dump is MIT-licensed or
cleared for redistribution via this project.

If you add your own local `tuner/assets/water-data.js` (gitignored), that file
remains under **your** data license — this project does not re-license it.
See [DATA-PROVENANCE.md](DATA-PROVENANCE.md).

Region isolate silhouettes in `tuner/assets/region-isolate-data.js` are **not**
MIT: Natural Earth portions are public domain; OSM-derived province/city
polygons remain [ODbL 1.0](https://www.openstreetmap.org/copyright). Polar ice
and optional landcover GeoJSON packs are documented in DATA-PROVENANCE.md.

## 2. Showcase media under `showcases/`

Screenshots and short clips for the project README. Unless a file states
otherwise, treat them as All Rights Reserved demo media (viewing them in
the repository is fine; do not assume a free stock / re-licensing grant).

Showcase stills may depict maps that once included a water overlay in a
private or prior build; that does **not** mean hydrography data is shipped
or licensed from this repository.

## 3. Third-party services and libraries

MapLibre GL JS, Three.js, tile providers (e.g. AWS Terrarium, any basemap
you configure), and CDN hosts keep their own licenses and terms. This
project does not grant rights to those services. See NOTICE.md.
