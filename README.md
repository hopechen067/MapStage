# MapStage

**English** | [中文](README.zh-CN.md)

Open-source **MapStage tuner**: map and globe projection, satellite, hypsometric relief, 3D terrain, region isolate, and JSON presets.

## Live demo

**→ https://hopechen067.github.io/MapStage/**  
Interactive tuner (EOX satellite + Mapterhorn DEM need internet. No install.)

## What's new

- **Map / Globe** projection, independent satellite and hypsometric relief, optional region isolate (terrain island).
- Hillshade and 3D terrain use **Mapterhorn** DEM (was AWS Terrarium).
- Water is built-in OpenFreeMap / OpenMapTiles vector layers.
- CSS color grade can be toggled; copy JSON includes the live camera and resource switches.
- Public repo renamed to **MapStage**.

## Showcases

Current tuner: national map, 3D terrain, globe, isolate.

<table>
  <tr>
    <td align="center" width="50%">
      <img src="showcases/preview-tuner-china.jpg" alt="Tuner national map view" />
      <br /><sub>Tuner · national view (map)</sub>
    </td>
    <td align="center" width="50%">
      <img src="showcases/preview-tuner-hexi.jpg" alt="Tuner 3D terrain" />
      <br /><sub>Tuner · 3D terrain</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="showcases/preview-tuner-globe.jpg" alt="Tuner globe projection" />
      <br /><sub>Tuner · globe</sub>
    </td>
    <td align="center" width="50%">
      <img src="showcases/preview-tuner-isolate.jpg" alt="Tuner isolate China terrain island" />
      <br /><sub>Tuner · isolate</sub>
    </td>
  </tr>
</table>

| Item | Value |
|------|--------|
| Skill folder | `mapstage` |
| Runtime | MapStage |
| Default basemap | **EOX Sentinel-2 cloudless** (public demo WMTS; check provider terms) |
| Terrain / hillshade | **Mapterhorn** DEM (runtime fetch; Terrarium encoding) |
| Water | OpenFreeMap / OpenMapTiles vector water |
| Look | CSS color grade, map/globe, isolate island, `HanCity3D` settlements |
| License | [MIT](LICENSE) for code/docs; showcase media & third-party terms in [LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md) / [NOTICE.md](NOTICE.md) |
| Hosted demo | [Live demo](https://hopechen067.github.io/MapStage/) — Pages publishes `mapstage/tuner` to the site root |

## Quick pull (install)

**`git clone` pulls the whole repository, not a standalone skill.**  
You get README, showcases, the tuner, and the `mapstage/` skill folder. Agents do not auto-discover that folder from a clone. Copy `mapstage/` into your skills directory (step 2) if you want the agent skill.

### 1) Clone the repo

```bash
git clone https://github.com/hopechen067/MapStage.git
cd MapStage
```

Update later:

```bash
cd MapStage
git pull
```

### 2) Install as an agent skill (copy folder)

The skill lives in `mapstage/`. Copy that folder into your agent skills directory, then reload skills.

**Windows (PowerShell)** — pick the path your host uses:

```powershell
# Grok / common user skills dir
$src = ".\mapstage"
$dst = Join-Path $env:USERPROFILE ".grok\skills\mapstage"
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
Copy-Item -Recurse -Force $src $dst
```

```powershell
# Codex user skills (if you use Codex)
$src = ".\mapstage"
$dst = Join-Path $env:USERPROFILE ".codex\skills\mapstage"
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
Copy-Item -Recurse -Force $src $dst
```

**macOS / Linux:**

```bash
git clone https://github.com/hopechen067/MapStage.git
cp -R MapStage/mapstage ~/.grok/skills/mapstage
# or: ~/.codex/skills/mapstage
```

One-shot clone + install (Unix):

```bash
git clone --depth 1 https://github.com/hopechen067/MapStage.git \
  && cp -R MapStage/mapstage ~/.grok/skills/mapstage
```

### 3) Paste this to your agent

```text
请使用 MapStage skill。
在线调参：https://hopechen067.github.io/MapStage/
仓库：https://github.com/hopechen067/MapStage
我会在 demo 里调好风格后导出 JSON，请按 SKILL.md / references 应用到地图场景（jumpTo + idle，encoding terrarium）。
```

Style workflow: open the [live demo](https://hopechen067.github.io/MapStage/) → tune → **Copy JSON** → paste to your agent.

## Quick start (local tuner)

Only needed if you want to run the tuner offline on your machine (not required for the public demo).

```bash
cd mapstage/tuner

# Option A — Python 3
python -m http.server 8765

# Option B — Node
npx --yes serve -l 8765
```

Then open `http://127.0.0.1:8765/` on the **same machine**.  
Public share link: [Live demo](#live-demo).

Do **not** open `index.html` as `file://` — presets and optional local assets will fail.

Optional check (Node on `PATH`):

```bash
cd mapstage/tuner
node verify.mjs
```

## Features

- **Configurable raster basemap** — default [EOX Sentinel-2 cloudless](https://s2maps.eu). Override with `map-tiles.config.local.js` (gitignored) for any tile URL you are allowed to use.
- **Mapterhorn hillshade + 3D terrain** — Terrarium encoding; map/globe projection; optional region isolate.
- **Vector water** — OpenFreeMap / OpenMapTiles (built-in).
- **CSS color grade** — sepia / warm tint / vignette / paint; filter can be toggled; export JSON presets.
- **City tiers** — capital / large / medium / small / pass / station / ordos via `HanCity3D`.

## Configure map tiles

1. Read [NOTICE.md](NOTICE.md).
2. Defaults: `tuner/map-tiles.config.js` (EOX + Mapterhorn).
3. Personal endpoints: `map-tiles.config.local.js` (gitignored). See `map-tiles.config.example.js`.

EOX public tiles are typically non-commercial with attribution (~10 m). This project does **not** grant rights to any commercial map vendor.

## Tiles are not bundled

Satellite and DEM tiles are fetched at runtime from configured URLs only.

## Attribution & compliance

- Follow each basemap / DEM / CDN provider’s terms for your use case.
- **OpenFreeMap / OSM** attribution for vector water.
- **Third-party runtimes:** keep their licenses when redistributing builds — [NOTICE.md](NOTICE.md).
- **Showcase images:** All Rights Reserved demo media unless noted otherwise ([LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md)).

## Install as an agent skill

The GitHub repo is the full project. The skill is **only** `mapstage/`.

1. Copy `mapstage` into your skills directory (Grok: `~/.grok/skills/mapstage`).
2. Reload agent skills so `SKILL.md` is discovered.
3. Ask the agent to open the tuner, apply an exported JSON preset (version 3), or wire the same look into a MapStage scene.

## Layout

```
.
├── LICENSE
├── LICENSE-EXCEPTIONS.md      # showcase / third-party / user geodata (not MIT)
├── NOTICE.md
├── DATA-PROVENANCE.md
├── SECURITY.md
├── README.md / README.zh-CN.md
├── showcases/                 # README images & sample frames
└── mapstage/
    ├── SKILL.md
    ├── agents/openai.yaml
    ├── references/
    ├── schemas/
    └── tuner/                 # published to GitHub Pages site root
```

## Contributing / security

- Prefer small, documented changes.
- Do not commit API keys or `map-tiles.config.local.js`.
- See [SECURITY.md](SECURITY.md).

## Next reads

- [`mapstage/SKILL.md`](mapstage/SKILL.md)
- [`mapstage/references/参数列表说明.md`](mapstage/references/参数列表说明.md)
- [`mapstage/references/tuner-workflow.md`](mapstage/references/tuner-workflow.md)
- [`mapstage/references/tested-config.md`](mapstage/references/tested-config.md)
