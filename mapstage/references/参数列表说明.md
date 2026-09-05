# 参数列表说明 · Map preset

Field names match `tuner/preset-antique-default.json` (version 2).  
Defaults below = **antique parchment v2**.

## Root

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `id` | string | `antique-default` | Preset id |
| `label` | string | `Antique parchment default` | Human label |
| `version` | number | `2` | Schema version |
| `savedAt` | string | ISO-like datetime | Export timestamp |

## `camera`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `center` | `[lng, lat]` | `[104.0, 35.5]` | Default China overview |
| `zoom` | number | `4.2` | Overview scale |
| `pitch` | number | `28` | Degrees |
| `bearing` | number | `0` | Degrees |

## `maplibre`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `backgroundColor` | color | `#c8c2b4` | Map background / parchment base |
| `terrainExaggeration` | number | `1.6` | `map.setTerrain({ exaggeration })` |

### `maplibre.satellite`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `opacity` | number | `0.7` | Layer opacity |
| `saturation` | number | `-0.08` | Raster saturation |
| `contrast` | number | `0.02` | Raster contrast |
| `brightnessMin` | number | `0.08` | Raster brightness-min |
| `brightnessMax` | number | `0.96` | Raster brightness-max |
| `hueRotate` | number | `12` | Degrees |

### `maplibre.hillshade`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `exaggeration` | number | `0.42` | Hillshade exaggeration |
| `illuminationDirection` | number | `315` | Light azimuth |
| `shadowColor` | color | `#2c2824` | |
| `highlightColor` | color | `#f0ece4` | |
| `accentColor` | color | `#6a6458` | |

### `maplibre.water`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `lakeFill` | color | `rgba(50,118,138,0.9)` | Lake fill |
| `lakeOutline` | color | `rgba(90,110,105,0.8)` | Lake outline |
| `riverLevel3` | color | `rgba(48,112,128,0.55)` | Minor rivers |
| `riverLevel2` | color | `rgba(45,110,125,0.88)` | Mid rivers |
| `riverLevel1` | color | `rgba(42,105,120,0.95)` | Major rivers |
| `highlightRiver` | color | `rgba(38,100,118,1)` | Narrative highlight systems |
| `riverL3Width` | number | `1.2` | Line width base |
| `riverL2Width` | number | `2` | |
| `riverL1Width` | number | `1.8` | |
| `highlightWidth` | number | `2.4` | Highlight line width |

**Alias (legacy JSON only):** `qilianRiver` → `highlightRiver`, `qilianWidth` → `highlightWidth`. Prefer the `highlight*` names in new exports.

## `css`

Applied as CSS `filter` + warm-tint overlay + vignette on the map canvas wrapper.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `sepia` | number | `0.08` | |
| `saturate` | number | `0.98` | |
| `contrast` | number | `1.03` | |
| `brightness` | number | `1.0` | |
| `hueRotate` | number | `-1` | Degrees |
| `warmTintAlpha` | number | `0.04` | Soft-light overlay alpha |
| `warmTintColor` | color | `#9a8868` | Warm tint |
| `vignetteStrength` | number | `0.1` | Edge darken |

## `ui`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `showWater` | boolean | `true` | All water layers |
| `showHighlight` | boolean | `true` | Highlight river systems |
| `showCities` | boolean | `true` | Settlement extrusions / labels |
| `showRef` | boolean | `false` | Reference image compare (tuner only) |

Optional tuner-only: `showRiverLabels`, `refMode` (`pip` \| `split`).

**Alias (legacy):** `showQilian` → `showHighlight`.

## `cities`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `dataFile` | string | `assets/sample-sites.json` | Relative to tuner root |
| `halfKm` | number | `18` | Global half-edge km fallback |
| `renderMode` | string | `fill-extrusion` | Extrusion mode |

See [`city-tier-schema.md`](city-tier-schema.md) for per-tier `halfKm` defaults.
