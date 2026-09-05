# City tier schema

Settlement footprints for `HanCity3D` fill-extrusion / label rendering.

## Site object (HanCity3D-compatible)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Stable id |
| `name` | string | yes | Label text |
| `lng` | number | yes | WGS84 longitude |
| `lat` | number | yes | WGS84 latitude |
| `tier` | string | yes | One of the tiers below |
| `modelType` | string | recommended | `commandery` / `pass` / `station` / `ordos` (defaults from tier) |
| `halfKm` | number | optional | Overrides tier default half-edge (km) |
| `note` | string | optional | Free-form note |

Root file may be a bare array of sites, or `{ "sites": [ ... ] }` / `{ "cities": [ ... ] }` — match what the host loader expects. Sample: `tuner/assets/sample-sites.json`.

## Tiers & default `halfKm`

| Tier | Meaning | Default `halfKm` | Default `modelType` |
|------|---------|------------------|---------------------|
| `capital` | Imperial / primary capital | `30` | `commandery` |
| `large` | Major city | `22` | `commandery` |
| `medium` | Prefecture / commandery seat | `18` | `commandery` |
| `small` | Minor town | `10` | `commandery` |
| `pass` | Pass / gate | `8` | `pass` |
| `station` | Courier / relay station | `4` | `station` |
| `ordos` | Ordos-style compound | `16` | `ordos` |

Global fallback from preset `cities.halfKm` (default `18`) applies when a site has no `halfKm` and an unknown tier.

## Generic examples

```json
[
  {
    "id": "demo-capital",
    "name": "都城",
    "lng": 108.9,
    "lat": 34.3,
    "tier": "capital",
    "modelType": "commandery",
    "halfKm": 30,
    "note": "示例都城"
  },
  {
    "id": "demo-medium",
    "name": "郡城",
    "lng": 103.8,
    "lat": 36.0,
    "tier": "medium",
    "modelType": "commandery",
    "halfKm": 18
  },
  {
    "id": "demo-pass",
    "name": "关隘",
    "lng": 110.5,
    "lat": 34.5,
    "tier": "pass",
    "modelType": "pass",
    "halfKm": 8
  },
  {
    "id": "demo-station",
    "name": "驿站",
    "lng": 105.5,
    "lat": 35.0,
    "tier": "station",
    "modelType": "station",
    "halfKm": 4
  }
]
```

## Preset `cities` block

```json
{
  "dataFile": "assets/sample-sites.json",
  "halfKm": 18,
  "renderMode": "fill-extrusion"
}
```
