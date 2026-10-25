# License exceptions (not covered by MIT)

The repository root [LICENSE](LICENSE) is a standard MIT grant for project
**code and documentation**. The items below are **out of scope** of that grant.
This file exists so GitHub / SPDX can detect MIT on `LICENSE` while keeping the
same legal intent previously appended to that file.

Also see [DATA-PROVENANCE.md](DATA-PROVENANCE.md) and [NOTICE.md](NOTICE.md).

## 1. Geographic overlay data (not redistributed here)

This repository **does not include** a bundled China water / hydrography pack.
Do not assume any former or external `water-data.js` dump is MIT-licensed or
cleared for redistribution via this project. Water and roads in the tuner come
from OpenFreeMap vector tiles (OpenStreetMap, ODbL); see [DATA-PROVENANCE.md](DATA-PROVENANCE.md).

Region isolate silhouettes in `tuner/assets/region-isolate-data.js` are **not** all MIT:
the nation `china` silhouette (+ `xizang`, `zangnan`, `haiyu` and island groups) is derived from Natural Earth (public domain);
remaining OSM-derived province/city polygons stay [ODbL 1.0](https://www.openstreetmap.org/copyright) (see DATA-PROVENANCE.md).

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
