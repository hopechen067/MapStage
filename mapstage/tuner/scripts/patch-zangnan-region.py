#!/usr/bin/env python3
"""Insert selectable 藏南 (Zangnan) city region under xizang into region-isolate-data.js.

Geometry = Chinese-atlas Tibet ∩ South Tibet claim extent (Natural Earth
Arunachal Pradesh buffered). Narrative silhouette for isolate dropdown.
Requires: pyshp, shapely. NE 50m admin-1 shapefile under /tmp/ne50_states/.
"""
# See agent history / china-boundaries fix for usage.
print('Use the cloud-agent patch that rebuilt region-isolate-data.js with id=zangnan.')
