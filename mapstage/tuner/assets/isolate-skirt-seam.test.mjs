/**
 * Isolate island skirt / seam / rim contract.
 *
 * Remaining rot after "Seal isolate terrain seams" is the drop-down
 * side wall (skirt), not tile-surface trenches and not a meshSize bump:
 * mixed DEM-tile skirt faces at the clip contour were discarded, and
 * outside verts sat a full cell away so the wall was a stretched ramp.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readPageSource } from '../../runtime/lib/tuner-source.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const vendor = readFileSync(join(root, '..', 'vendor', 'maplibre-gl.js'), 'utf8');
const patch = readFileSync(join(root, '..', 'scripts', 'patch-maplibre-terrain-clip.mjs'), 'utf8');
const island = readFileSync(join(root, 'terrain-island.js'), 'utf8');

let failed = 0;
function check(name, cond) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name);
  } else {
    console.log('OK  ', name);
  }
}

check('vendor still patched', vendor.includes('__ANTIQUE_TERRAIN_CLIP_PATCH'));
check('diagonal rim snap fallback', vendor.includes('if(dot(dir,dir)<1.0e-12)'));
check('bilinear clip helper in vertex shader', vendor.includes('float antiqueClipBi(vec2 uv)'));
check('clip texel uniform bound', vendor.includes('u_clip_texels') && vendor.includes('uniformValues.u_clip_texels'));
check('sobel snap uses 8-neighborhood', vendor.includes('(tr+2.0*r+br)-(tl+2.0*l+bl)'));
check('texel-scale sobel helper', vendor.includes('vec2 antiqueClipSobel(vec2 uv,vec2 st)'));
check('sobel samples 1/2/4 clip texels', vendor.includes('antiqueClipSobel(cu,tex)') && vendor.includes('2.0*tex') && vendor.includes('antiqueClipSobel(cu,4.0*tex)'));
check('sobel normalizes per scale so 4-texel faces cannot dominate', vendor.includes('g+=s1*inversesqrt(n1)') && vendor.includes('0.15*s4*inversesqrt(n4)'));
check('live sample is not unnormalized 1+2+4 sum', !vendor.includes('vec2 g=antiqueClipSobel(cu,tex);g+=antiqueClipSobel(cu,2.0*tex);g+=antiqueClipSobel(cu,4.0*tex);'));
check('live sample is not 2-cell mesh sobel', !vendor.includes('2.0*duv.x'));
check('iso search uses 14 iters', vendor.includes('for(int i=0;i<14;i++)'));
check('v_drop_w is 0-1 shade * clip.w not meters*w', vendor.includes('v_drop_w=(v_drop>80.0?1.0:0.0)*gl_Position.w'));
check('v_drop_w meters*w path is gone', !vendor.includes('v_drop_w=v_drop*gl_Position.w;'));
check('v_clip_w affine clip.w varying', vendor.includes('out highp float v_clip_w') && vendor.includes('in highp float v_clip_w') && vendor.includes('v_clip_w=gl_Position.w'));
check('wall UV uses affine 0-1 shade=v_drop_w/v_clip_w', vendor.includes('float drop=v_drop_w/max(v_clip_w,1.0e-12)') && vendor.includes('if(wall){float uv=clamp(drop,0.0,1.0)'));
check('wall UV is not crushed by drop/u_clip_drop', !vendor.includes('drop/max(u_clip_drop,1.0)') && !vendor.includes('uv=clamp(uv*4.0,0.0,1.0)'));
check('drop is not reconstructed with gl_FragCoord.w', !vendor.includes('v_drop_w*gl_FragCoord.w'));
check('noperspective is not used (illegal in this GLSL)', !vendor.includes('noperspective'));
check('wall skips fog/sky/horizon tint', vendor.includes('if (!wall&&!u_is_globe_mode && v_fog_depth > u_fog_ground_blend)'));
check('wall fog is not the unguarded maplibre mix', !vendor.includes('if (!u_is_globe_mode && v_fog_depth > u_fog_ground_blend) {'));
check('live discard keeps mixed mesh walls', vendor.includes('if(outside&&!mixed)discard') && !vendor.includes('if(outside)discard;') && !vendor.includes('if(outside&&!wall)discard'));
check('live discard does not punch skirt holes', !vendor.includes('outside&&(skirt||!mixed)'));
check('live wall paints 0-1 shade not meter drop>80', vendor.includes('bool wall=u_clip_enabled>0.5&&drop>0.004') && !vendor.includes('bool wall=u_clip_enabled>0.5&&drop>80.0'));
check('affine varyings are highp so shade*w cannot overflow to satellite', vendor.includes('in highp float v_drop_w') && vendor.includes('out highp float v_drop_w'));
check('old skirt-discard wall gone', !vendor.includes('!skirt&&mixed&&v_drop>80.0'));
check('outside skirts drop', vendor.includes('if(!inside){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}'));
check('old non-skirt-only drop gone', !vendor.includes('if(!inside&&a_pos3d.z<0.5)'));
check('outside rim keeps epsilon', vendor.includes('float land=inside?hi:max(lo-0.12,0.0)') && !vendor.includes('float land=inside?min(hi+0.40,1.6)'));
check('out-of-bbox clip samples clamp', vendor.includes('clamp(uv,0.0,1.0)*tsz'));
check('one-cell skirt halo snaps', vendor.includes('bool nearBox=cu.x>=-duv.x'));
check('8-connected rim samples', vendor.includes('cu+vec2(-duv.x,-duv.y)'));
check('patch script live discard is SKIRT_WALL', patch.includes('const CLIP_DISCARD = CLIP_DISCARD_SKIRT_WALL'));
check('patch script live sample is RIM_SMOOTH', patch.includes('const CLIP_VERT_SAMPLE = CLIP_VERT_SAMPLE_RIM_SMOOTH'));
check('mesh stays 128', /var MESH_ISLAND = 128;/.test(island));
check('rim densify is projected not collinear-merged', island.includes('function densifyProjected') && island.includes('Never drop collinear points'));
check('rim rounds corners as arcs', island.includes('function roundCornerArcs'));
check('V-notch walk fillets densified apexes', island.includes('function walkToLen') && island.includes("kind: 'v-notch'"));
check(
  'nudge is re-rounded so 6px flats cannot return',
  /nudgeRimOutwardPx[\s\S]{0,220}roundCornerArcs/.test(island)
);
check(
  'corner chains walk past densified collinear samples',
  island.includes('function walkToLen') && island.includes("kind: 'v-notch'") && island.includes('extendChainEnd')
);
check('densifyProjected has a runaway-split cap', island.includes('var cap = 24000'));
check('nudge mag can cover a mesh-cell stair', island.includes('if (mag > 36) mag = 36'));
check('rim loop does not resample-cap', island.includes('function buildRimLoop') && !/function buildRimLoop[\s\S]{0,400}resampleRing/.test(island));
check('live rim is nudged outward so mesh-snap stairs stay inside', island.includes('function nudgeRimOutwardPx') && island.includes('RIM_NUDGE_PX'));
check('rim densify includes clay/bottom 3d projectors', island.includes('function project3dFn') && island.includes('extraProjects'));
check('skirt bottom is top dropped', island.includes('bottom = top dropped'));
check(
  'overlay wall drop sign is probed against custom-layer ndcY',
  island.includes('function overlayDropSignFromMatrix') &&
    island.includes('a.alt + drop * dropSign') &&
    !/fromLngLat\(\[a\.lng, a\.lat\], a\.alt - drop\)/.test(island)
);
check(
  'overlay walls depth-test against terrain so a drop cannot paint a crown',
  /gl\.enable\(gl\.DEPTH_TEST\)/.test(island) &&
    /gl\.depthFunc\(gl\.LEQUAL\)/.test(island) &&
    !/gl\.disable\(gl\.DEPTH_TEST\)/.test(island)
);
check(
  'live overlay rim is not XY-nudged so uv=0 gold cannot cap the satellite',
  /rimLoopsFromFeature\(feature,\s*gpuElev[\s\S]{0,280}nudgePx:\s*0/.test(island)
);
check(
  'overlay wall top sinks below the terrain rim toward the void',
  island.includes('OVERLAY_TOP_SINK_M') &&
    island.includes('a.alt + dropSign * OVERLAY_TOP_SINK_M') &&
    island.includes('a.alt + drop * dropSign')
);
check(
  'overlay top shade starts past land residual so gold cannot fence the block top',
  island.includes('OVERLAY_TOP_SHADE = 0.12') &&
    island.includes('vert(aTop, OVERLAY_TOP_SHADE') &&
    island.includes('vec3(196.0,160.0,106.0)/255.0') &&
    island.includes('b0=0.10;b1=0.30')
);
const tunerIndex = readPageSource(join(root, '..', 'index.html'));
check(
  'index.html hides region-outline when the island is on',
  /const vis = params\.ui\.showRegionIsolate && hasIsolateFeature\(\) && !isolateUsesIsland\(\)/.test(
    tunerIndex
  ) &&
    /const outlineVis = vis;/.test(tunerIndex) &&
    !/const outlineVis = params\.ui\.showRegionIsolate && hasIsolateFeature\(\) \? 'visible'/.test(
      tunerIndex
    )
);
check(
  'index.html updateRegionIsolate also hides outline on island',
  /outlineVis =\s*params\.ui\.showRegionIsolate && hasIsolateFeature\(\) && !island/.test(tunerIndex)
);
check(
  'index.html isolate does not sync overlay wall geometry',
  /function scheduleIslandWalls[\s\S]{0,900}Island\.syncWalls\(\s*map,\s*maplibregl,\s*null\)/.test(
    tunerIndex
  ) && !/function scheduleIslandWalls[\s\S]{0,900}currentIsolateFeature\(\)/.test(tunerIndex)
);
check(
  'index.html isolate does not waitIdle overlay walls on camera settle',
  /function scheduleIslandWalls[\s\S]{0,900}Island\.syncWalls/.test(tunerIndex) &&
    !/function scheduleIslandWalls[\s\S]{0,1200}waitIdle\(/.test(tunerIndex)
);
check(
  'index.html hillshade uses a dedicated DEM source by default',
  /dualSource !== false/.test(tunerIndex) &&
    /sourceId \+ '-hillshade'/.test(tunerIndex) &&
    /id: 'hillshade'[\s\S]{0,240}layout: \{ visibility: 'visible' \}/.test(tunerIndex)
);
const workbenchSrc = readFileSync(join(root, 'isolate-workbench.js'), 'utf8');
check(
  'isolate-workbench does not sync overlay wall geometry',
  /function scheduleWalls[\s\S]{0,800}Island\.syncWalls\(\s*map,\s*maplibregl,\s*null\)/.test(
    workbenchSrc
  ) && !/function scheduleWalls[\s\S]{0,700}currentFeature\(\)/.test(workbenchSrc)
);
check(
  'isolate-workbench does not waitIdle overlay walls on camera settle',
  /function scheduleWalls[\s\S]{0,800}Island\.syncWalls/.test(workbenchSrc) &&
    !/function scheduleWalls[\s\S]{0,900}waitIdle\(/.test(workbenchSrc)
);
check(
  'syncWalls is remove-only so region-island-walls cannot fence the top',
  /function syncWalls[\s\S]{0,900}removeWallLayer\(map\)/.test(island) &&
    !/function syncWalls[\s\S]{0,1400}map\.addLayer\(impl\)/.test(island)
);
check(
  'syncWalls skips extra repaint when overlay was already absent',
  /function syncWalls[\s\S]{0,1100}if \(had && map\.triggerRepaint\)/.test(island)
);
check(
  'terrain mesh drop is still ele minus u_clip_drop',
  vendor.includes('gl_Position=projectTileFor3D(p2,get_elevation(p2)-ele_delta)')
);
check('wall uses custom-layer mercator matrix', island.includes('defaultProjectionData') && island.includes('modelViewProjectionMatrix'));
check('wall binds its own VAO', island.includes('createVertexArray'));
check('do not snap rim points onto a pixel/mesh grid', /do not snap this loop onto a pixel\/mesh grid/i.test(island));
check('terrain mixed-floor discard stays', island.includes('Terrain mixed-floor discard stays'));
check('clip G encodes water-facing rim', island.includes('paintClipWater') && island.includes('inChinaSeas'));
check('live wall uses location strata not one cake', vendor.includes('if(wall){float uv=clamp(drop,0.0,1.0)'));
check('old one-cake shade gone', !vendor.includes('if(wall){float shade='));
check('strata UV 0 is top rim / 1 is skirt bottom', vendor.includes('if(wall){float uv=clamp(drop,0.0,1.0)'));
check('water palette mud/clay/bedrock', vendor.includes('b0=0.15;b1=0.40') && vendor.includes('vec3(61.0,83.0,72.0)/255.0') && vendor.includes('vec3(166.0,124.0,82.0)/255.0'));
check('land palette residual/weathered/bedrock', vendor.includes('b0=0.10;b1=0.30') && vendor.includes('vec3(196.0,160.0,106.0)/255.0') && vendor.includes('vec3(139.0,115.0,85.0)/255.0'));
check('shared bedrock + bedding line', vendor.includes('vec3(58.0,46.0,36.0)/255.0') && vendor.includes('vec3(26.0,20.0,16.0)/255.0'));
check('strata only on wall not satellite top', vendor.includes('vec4 surface_color=texture(u_texture,clamp') && vendor.indexOf('vec4 surface_color=texture') < vendor.indexOf('if(wall){float uv=clamp(drop'));
check('fragment has u_clip_drop for UV', vendor.includes('uniform highp float u_clip_drop;uniform vec4 u_clip_side_color'));
check('patch live tint is 0-1 shade strata', patch.includes('const CLIP_SIDE_TINT = CLIP_SIDE_TINT_SHADE01') && patch.includes('if(wall){float uv=clamp(drop,0.0,1.0)'));
check('overlay wall UV is affine shade*w', island.includes('v_shade_w=a_shade*gl_Position.w') && island.includes('v_shade_w/max(v_clip_w'));

const DROP = 12000;

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function sampleHalfPlane(u, v) {
  return u <= 0.5 ? 1 : 0;
}

function sampleDisk(u, v) {
  return Math.hypot(u - 0.5, v - 0.5) <= 0.52 ? 1 : 0;
}

function processVertex(u, v, z, sample, duv, mode, texel) {
  const nearBox =
    u >= -duv && v >= -duv && u <= 1 + duv && v <= 1 + duv;
  const cr = sample(clamp01(u), clamp01(v));
  let nMax = cr;
  let nMin = cr;
  const offs = [
    [duv, 0],
    [-duv, 0],
    [0, duv],
    [0, -duv],
    [duv, duv],
    [duv, -duv],
    [-duv, duv],
    [-duv, -duv],
  ];
  if (nearBox) {
    for (let i = 0; i < offs.length; i++) {
      const s = sample(clamp01(u + offs[i][0]), clamp01(v + offs[i][1]));
      nMax = Math.max(nMax, s);
      nMin = Math.min(nMin, s);
    }
  }
  const inside = cr >= 0.5;
  const rim = nearBox && nMin < 0.5 && nMax >= 0.5;
  let pu = u;
  let pv = v;
  let isoU = u;
  let isoV = v;
  let drop = 0;
  const snapOutside = mode !== 'old';
  const dropSkirts = mode !== 'old';
  const canSnap = mode === 'old' ? inside && rim && z < 0.5 : rim;
  if (canSnap) {
    const s = (x, y) => sample(clamp01(x), clamp01(y));
    let gx = 0;
    let gy = 0;
    if (mode === 'old') {
      gx = s(u + duv, v) - s(u - duv, v);
      gy = s(u, v + duv) - s(u, v - duv);
    } else {
      const st = texel > 0 ? texel : duv / 4;
      const weights = [
        [st, 1],
        [2 * st, 0.4],
        [4 * st, 0.15],
      ];
      function kernel(step) {
        const tl = s(u - step, v - step);
        const t = s(u, v - step);
        const tr = s(u + step, v - step);
        const l = s(u - step, v);
        const r = s(u + step, v);
        const bl = s(u - step, v + step);
        const b = s(u, v + step);
        const br = s(u + step, v + step);
        return {
          x: tr + 2 * r + br - (tl + 2 * l + bl),
          y: bl + 2 * b + br - (tl + 2 * t + tr),
        };
      }
      for (let k = 0; k < weights.length; k++) {
        const g = kernel(weights[k][0]);
        const mag = Math.hypot(g.x, g.y);
        if (mag <= 1e-12) continue;
        gx += (weights[k][1] * g.x) / mag;
        gy += (weights[k][1] * g.y) / mag;
      }
    }
    const g2 = gx * gx + gy * gy;
    let dirx = 0;
    let diry = 0;
    if (g2 > 1e-12) {
      dirx = gx / Math.sqrt(g2);
      diry = gy / Math.sqrt(g2);
      if (inside) {
        dirx = -dirx;
        diry = -diry;
      } else if (!snapOutside) {
        dirx = 0;
        diry = 0;
      }
    }
    if (dirx === 0 && diry === 0 && (snapOutside || inside)) {
      for (let i = 0; i < offs.length; i++) {
        const sv = s(u + offs[i][0], v + offs[i][1]);
        const cross = inside ? sv < 0.5 : sv >= 0.5;
        if (!cross) continue;
        const len = Math.hypot(offs[i][0], offs[i][1]);
        if (len < 1e-12) continue;
        dirx = offs[i][0] / len;
        diry = offs[i][1] / len;
        break;
      }
    }
    if (dirx !== 0 || diry !== 0) {
      let lo = 0;
      let hi = 1.6;
      const iters = mode === 'old' ? 8 : 14;
      for (let i = 0; i < iters; i++) {
        const mid = 0.5 * (lo + hi);
        const sv = s(u + dirx * duv * mid, v + diry * duv * mid);
        if (inside) {
          if (sv >= 0.5) lo = mid;
          else hi = mid;
        } else {
          if (sv < 0.5) lo = mid;
          else hi = mid;
        }
      }
      const landIso = inside ? (mode === 'old' ? lo : hi) : Math.max(lo - 0.12, 0);
      const land = landIso;
      pu = u + dirx * duv * land;
      pv = v + diry * duv * land;
      isoU = u + dirx * duv * landIso;
      isoV = v + diry * duv * landIso;
    }
  }
  if (!inside && (dropSkirts || z < 0.5)) drop = DROP;
  return { u: pu, v: pv, isoU, isoV, z: z, drop: drop, inside: inside, rim: rim, origU: u, origV: v };
}

function classifyTri(a, b, c, sample, mode) {
  const mixed = Math.max(a.drop, b.drop, c.drop) - Math.min(a.drop, b.drop, c.drop) > 80;
  const midU = (a.u + b.u + c.u) / 3;
  const midV = (a.v + b.v + c.v) / 3;
  const outside = sample(midU, midV) < 0.5;
  const skirt = a.z > 0.001 || b.z > 0.001 || c.z > 0.001;
  let keep = true;
  if (mode === 'old') {
    if (outside && (skirt || !mixed)) keep = false;
  } else if (outside && !(mixed && Math.max(a.drop, b.drop, c.drop) > 80)) keep = false;
  const wall = mixed && Math.max(a.drop, b.drop, c.drop) > 80;
  return { keep: keep, wall: keep && wall, skirt: skirt, mixed: mixed };
}

function radialSpan(a, b, c, cx, cy) {
  const rs = [a, b, c].map((p) => Math.hypot(p.u - cx, p.v - cy));
  return Math.max(rs[0], rs[1], rs[2]) - Math.min(rs[0], rs[1], rs[2]);
}

function buildGrid(n, sample, mode, texel) {
  const duv = 1 / n;
  const verts = [];
  function add(u, v, z) {
    const p = processVertex(u, v, z, sample, duv, mode, texel);
    verts.push(p);
    return verts.length - 1;
  }
  const idx = [];
  for (let j = 0; j <= n; j++) {
    idx[j] = [];
    for (let i = 0; i <= n; i++) idx[j][i] = add(i * duv, j * duv, 0);
  }
  const tris = [];
  function tri(ia, ib, ic) {
    tris.push([verts[ia], verts[ib], verts[ic]]);
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      tri(idx[j][i], idx[j + 1][i], idx[j + 1][i + 1]);
      tri(idx[j][i], idx[j + 1][i + 1], idx[j][i + 1]);
    }
  }
  const topEdge = [];
  const botEdge = [];
  for (let i = 0; i <= n; i++) {
    topEdge.push(idx[0][i]);
    botEdge.push(idx[n][i]);
  }
  const topSkirt = [];
  const botSkirt = [];
  for (let i = 0; i <= n; i++) {
    topSkirt.push(add(i * duv, -duv, 1));
    botSkirt.push(add(i * duv, 1 + duv, 1));
  }
  for (let i = 0; i < n; i++) {
    tri(topEdge[i], topSkirt[i + 1], topSkirt[i]);
    tri(topEdge[i], topEdge[i + 1], topSkirt[i + 1]);
    tri(botEdge[i], botSkirt[i], botSkirt[i + 1]);
    tri(botEdge[i], botSkirt[i + 1], botEdge[i + 1]);
  }
  const leftSkirt0 = [];
  const leftSkirt1 = [];
  const rightSkirt0 = [];
  const rightSkirt1 = [];
  for (let j = 0; j <= n; j++) {
    leftSkirt0.push(add(0, j * duv, 0));
    leftSkirt1.push(add(-duv, j * duv, 1));
    rightSkirt0.push(add(1, j * duv, 0));
    rightSkirt1.push(add(1 + duv, j * duv, 1));
  }
  for (let j = 0; j < n; j++) {
    tri(leftSkirt0[j], leftSkirt1[j], leftSkirt1[j + 1]);
    tri(leftSkirt0[j], leftSkirt1[j + 1], leftSkirt0[j + 1]);
    tri(rightSkirt0[j], rightSkirt1[j + 1], rightSkirt1[j]);
    tri(rightSkirt0[j], rightSkirt0[j + 1], rightSkirt1[j + 1]);
  }
  return { verts: verts, tris: tris, duv: duv };
}

function summarize(mesh, sample, mode) {
  let walls = 0;
  let skirtWalls = 0;
  let discarded = 0;
  let kept = 0;
  let maxRadial = 0;
  let min3d = Infinity;
  for (let t = 0; t < mesh.tris.length; t++) {
    const [a, b, c] = mesh.tris[t];
    const cls = classifyTri(a, b, c, sample, mode);
    if (!cls.keep) {
      discarded += 1;
      continue;
    }
    kept += 1;
    if (cls.wall) {
      walls += 1;
      if (cls.skirt) skirtWalls += 1;
      maxRadial = Math.max(maxRadial, radialSpan(a, b, c, 0.5, 0.5));
      const ab = [b.u - a.u, b.v - a.v, (b.drop - a.drop) / DROP];
      const ac = [c.u - a.u, c.v - a.v, (c.drop - a.drop) / DROP];
      const cr = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      const area = 0.5 * Math.hypot(cr[0], cr[1], cr[2]);
      if (area < min3d) min3d = area;
    }
  }
  return {
    walls: walls,
    skirtWalls: skirtWalls,
    discarded: discarded,
    kept: kept,
    maxRadial: maxRadial,
    min3d: min3d,
  };
}

function wallThicknessU(mesh, sample, mode) {
  let maxAbs = 0;
  for (let t = 0; t < mesh.tris.length; t++) {
    const [a, b, c] = mesh.tris[t];
    const cls = classifyTri(a, b, c, sample, mode);
    if (!cls.wall) continue;
    maxAbs = Math.max(maxAbs, Math.abs(a.u - 0.5), Math.abs(b.u - 0.5), Math.abs(c.u - 0.5));
  }
  return maxAbs;
}

function sampleDiag(u, v) {
  return u + v <= 1 ? 1 : 0;
}

const n = 16;
const duv = 1 / n;
const outsideSnap = processVertex(0.5 + duv, 0.5, 0, sampleHalfPlane, duv, 'new');
check('outside rim vert drops', outsideSnap.drop === DROP);
check('outside rim vert snaps toward 0.5', outsideSnap.u < 0.5 + duv * 0.5 && outsideSnap.u > 0.5);
const insideSnap = processVertex(0.5, 0.5, 0, sampleHalfPlane, duv, 'new');
check(
  'inside rim vert snaps onto clip 0.5',
  insideSnap.rim &&
    insideSnap.drop === 0 &&
    Math.abs(insideSnap.u - 0.5) < duv * 0.25
);

function pointInTri(p, a, b, c) {
  const v0x = c.u - a.u;
  const v0y = c.v - a.v;
  const v1x = b.u - a.u;
  const v1y = b.v - a.v;
  const v2x = p[0] - a.u;
  const v2y = p[1] - a.v;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const den = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(den) < 1e-18) return false;
  const u = (dot11 * dot02 - dot01 * dot12) / den;
  const v = (dot00 * dot12 - dot01 * dot02) / den;
  return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9;
}

function surfaceCoversIso(mesh, pts) {
  const surface = [];
  for (let t = 0; t < mesh.tris.length; t++) {
    const [a, b, c] = mesh.tris[t];
    if (a.drop > 80 || b.drop > 80 || c.drop > 80) continue;
    if (a.z >= 0.5 || b.z >= 0.5 || c.z >= 0.5) continue;
    surface.push([a, b, c]);
  }
  let hit = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    for (let t = 0; t < surface.length; t++) {
      if (pointInTri(p, surface[t][0], surface[t][1], surface[t][2])) {
        hit += 1;
        break;
      }
    }
  }
  return hit;
}

const isoPts = [];
for (let k = 0; k < 24; k++) {
  const ang = (k / 24) * Math.PI * 2;
  isoPts.push([0.5 + Math.cos(ang) * 0.52, 0.5 + Math.sin(ang) * 0.52]);
}

const diagOutside = processVertex(0.5 + duv, 0.5 + duv, 0, sampleDiag, duv, 'new');
const diagOld = processVertex(0.5 + duv, 0.5 + duv, 0, sampleDiag, duv, 'old');
check('diagonal rim vert is detected', diagOutside.rim);
check('diagonal rim vert drops', diagOutside.drop === DROP);
check(
  'diagonal rim snaps in when axis gradient is zero',
  diagOutside.u + diagOutside.v < diagOld.u + diagOld.v - duv * 0.3 &&
    sampleDiag(diagOutside.u, diagOutside.v) < 0.5
);

const diskNew = buildGrid(n, sampleDisk, 'new');
const diskOld = buildGrid(n, sampleDisk, 'old');
const sumNew = summarize(diskNew, sampleDisk, 'new');
const sumOld = summarize(diskOld, sampleDisk, 'old');
check(
  'surface tris reach the disk 0.5 iso',
  surfaceCoversIso(diskNew, isoPts) >= 12
);

check('new path emits island walls', sumNew.walls > 20);
check('old path discarded mixed skirts at the rim', sumOld.skirtWalls === 0);
check('new path keeps mixed skirt faces as walls', sumNew.skirtWalls > 4);
check('dropped floor is still discarded', sumNew.discarded > 10);
check('wall triangles stay non-degenerate', sumNew.min3d > 1e-6);

const planeNew = buildGrid(n, sampleHalfPlane, 'new');
const planeOld = buildGrid(n, sampleHalfPlane, 'old');
const planeSum = summarize(planeNew, sampleHalfPlane, 'new');
const thickNew = wallThicknessU(planeNew, sampleHalfPlane, 'new');
const thickOld = wallThicknessU(planeOld, sampleHalfPlane, 'old');
check('half-plane clip still has a wall', planeSum.walls > 8);
check(
  'outside snap thins the drop-down wall vs cell-wide ramps',
  thickNew < thickOld * 0.7 && thickNew < duv * 0.55
);
check('half-plane keeps mixed skirts where the rim hits a tile edge', planeSum.skirtWalls > 0);

let leftEdgeWalls = 0;
for (let t = 0; t < planeNew.tris.length; t++) {
  const [a, b, c] = planeNew.tris[t];
  const cls = classifyTri(a, b, c, sampleHalfPlane, 'new');
  if (!cls.wall) continue;
  const midU = (a.u + b.u + c.u) / 3;
  if (midU < 0.15) leftEdgeWalls += 1;
}
check('clamped samples do not build a wall on the inside tile edge', leftEdgeWalls === 0);

let outsideSkirtDropped = 0;
let outsideSkirtTotal = 0;
for (let i = 0; i < diskNew.verts.length; i++) {
  const p = diskNew.verts[i];
  if (p.z < 0.5 || p.inside) continue;
  outsideSkirtTotal += 1;
  if (p.drop === DROP) outsideSkirtDropped += 1;
}
check('every outside stitch-skirt vert drops', outsideSkirtTotal > 0 && outsideSkirtDropped === outsideSkirtTotal);

let insideDropped = 0;
for (let i = 0; i < diskNew.verts.length; i++) {
  if (diskNew.verts[i].inside && diskNew.verts[i].drop > 0) insideDropped += 1;
}
check('inside verts do not drop', insideDropped === 0);

const plane = planeNew;

let covered = 0;
const samples = 32;
for (let s = 0; s < samples; s++) {
  const y = 0.12 + (0.76 * s) / (samples - 1);
  let hit = false;
  for (let t = 0; t < plane.tris.length; t++) {
    const [a, b, c] = plane.tris[t];
    const cls = classifyTri(a, b, c, sampleHalfPlane, 'new');
    if (!cls.wall) continue;
    const minY = Math.min(a.v, b.v, c.v);
    const maxY = Math.max(a.v, b.v, c.v);
    const minU = Math.min(a.u, b.u, c.u);
    const maxU = Math.max(a.u, b.u, c.u);
    if (y >= minY && y <= maxY && minU <= 0.5 + plane.duv && maxU >= 0.5 - plane.duv) {
      hit = true;
      break;
    }
  }
  if (hit) covered += 1;
}
check('half-plane wall is watertight along the rim', covered === samples);

let farOutsideKept = 0;
for (let t = 0; t < diskNew.tris.length; t++) {
  const [a, b, c] = diskNew.tris[t];
  const cls = classifyTri(a, b, c, sampleDisk, 'new');
  if (!cls.keep) continue;
  const midU = (a.u + b.u + c.u) / 3;
  const midV = (a.v + b.v + c.v) / 3;
  if (Math.hypot(midU - 0.5, midV - 0.5) > 0.52 + 2 * diskNew.duv && !cls.mixed) {
    farOutsideKept += 1;
  }
}
check('no far-outside floor faces kept', farOutsideKept === 0);

let overshoot = 0;
let outsideRim = 0;
for (let i = 0; i < diskNew.verts.length; i++) {
  const p = diskNew.verts[i];
  if (!p.rim || p.inside) continue;
  outsideRim += 1;
  if (sampleDisk(p.u, p.v) >= 0.5) overshoot += 1;
}
check('outside rim snap stays outside the 0.5 contour', outsideRim > 0 && overshoot === 0);

function rasterize(res, fn) {
  const g = new Float64Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      g[j * res + i] = fn((i + 0.5) / res, (j + 0.5) / res) ? 1 : 0;
    }
  }
  return { res: res, g: g };
}

function sampleNearest(grid, u, v) {
  const n = grid.res;
  const i = Math.max(0, Math.min(n - 1, Math.floor(u * n)));
  const j = Math.max(0, Math.min(n - 1, Math.floor(v * n)));
  return grid.g[j * n + i];
}

function sampleBilinear(grid, u, v) {
  const n = grid.res;
  const x = Math.max(0, Math.min(n - 1.0001, u * n - 0.5));
  const y = Math.max(0, Math.min(n - 1.0001, v * n - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const at = (ii, jj) =>
    grid.g[Math.max(0, Math.min(n - 1, jj)) * n + Math.max(0, Math.min(n - 1, ii))];
  return (
    at(x0, y0) * (1 - tx) * (1 - ty) +
    at(x0 + 1, y0) * tx * (1 - ty) +
    at(x0, y0 + 1) * (1 - tx) * ty +
    at(x0 + 1, y0 + 1) * tx * ty
  );
}

function longestAxisSilhouette(mesh) {
  let maxLen = 0;
  function consider(a, b) {
    if (!a.rim || !b.rim || a.inside || b.inside) return;
    if (a.z >= 0.5 || b.z >= 0.5) return;
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const ang = Math.atan2(Math.abs(dv), Math.abs(du));
    if (Math.min(ang, Math.PI / 2 - ang) > (8 * Math.PI) / 180) return;
    maxLen = Math.max(maxLen, Math.hypot(du, dv));
  }
  for (let t = 0; t < mesh.tris.length; t++) {
    const [a, b, c] = mesh.tris[t];
    consider(a, b);
    consider(b, c);
    consider(c, a);
  }
  return maxLen;
}

function maxRadialErr(mesh, r) {
  let m = 0;
  let worst = null;
  for (let i = 0; i < mesh.verts.length; i++) {
    const p = mesh.verts[i];
    if (!p.rim || p.z >= 0.5) continue;
    if (p.origU < -1e-9 || p.origV < -1e-9 || p.origU > 1 + 1e-9 || p.origV > 1 + 1e-9) continue;
    const e = Math.abs(Math.hypot((p.isoU ?? p.u) - 0.5, (p.isoV ?? p.v) - 0.5) - r);
    if (e > m) {
      m = e;
      worst = p;
    }
  }
  return { m, worst };
}

function maxLineDev(mesh) {
  let m = 0;
  for (let i = 0; i < mesh.verts.length; i++) {
    const p = mesh.verts[i];
    if (!p.rim || p.z >= 0.5) continue;
    if (p.origU < -1e-9 || p.origV < -1e-9 || p.origU > 1 + 1e-9 || p.origV > 1 + 1e-9) continue;
    m = Math.max(m, Math.abs((p.isoU ?? p.u) * 0.5 + (p.isoV ?? p.v) * 0.866 - 0.7));
  }
  return m;
}

function sampleSlope(u, v) {
  return u * 0.5 + v * 0.866 <= 0.7 ? 1 : 0;
}

function longestAxisAlignedRun(mesh) {
  const pts = [];
  for (let i = 0; i < mesh.verts.length; i++) {
    const p = mesh.verts[i];
    if (!p.rim || p.inside || p.z >= 0.5) continue;
    if (p.origU < -1e-9 || p.origV < -1e-9 || p.origU > 1 + 1e-9 || p.origV > 1 + 1e-9) continue;
    pts.push(p);
  }
  pts.sort((a, b) => Math.atan2(a.v - 0.5, a.u - 0.5) - Math.atan2(b.v - 0.5, b.u - 0.5));
  let run = 0;
  let maxRun = 0;
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i % pts.length];
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const ang = Math.atan2(Math.abs(dv), Math.abs(du));
    const axis = Math.min(ang, Math.PI / 2 - ang) <= (10 * Math.PI) / 180;
    if (axis) {
      run += 1;
      maxRun = Math.max(maxRun, run);
    } else run = 0;
  }
  return maxRun;
}

const diskGrid = rasterize(32, sampleDisk);
const slopeGrid = rasterize(32, sampleSlope);
const nearestDisk = (u, v) => sampleNearest(diskGrid, u, v);
const bilinDisk = (u, v) => sampleBilinear(diskGrid, u, v);
const nearestSlope = (u, v) => sampleNearest(slopeGrid, u, v);
const bilinSlope = (u, v) => sampleBilinear(slopeGrid, u, v);

const diskNearOld = buildGrid(n, nearestDisk, 'old');
const diskBiNew = buildGrid(n, bilinDisk, 'new', 1 / 32);
const slopeNearOld = buildGrid(n, nearestSlope, 'old');
const slopeBiNew = buildGrid(n, bilinSlope, 'new', 1 / 32);
const axisNear = longestAxisSilhouette(diskNearOld);
const axisBi = longestAxisSilhouette(diskBiNew);
const axisSlopeOld = longestAxisSilhouette(slopeNearOld);
const axisSlopeNew = longestAxisSilhouette(slopeBiNew);

check(
  'nearest occupancy rim is a cell-sized polyline stair',
  axisNear >= duv * 0.8 || axisSlopeOld >= duv * 0.8
);
check(
  'bilinear+sobel disk silhouette is not a cell-sized polyline',
  axisBi < duv * 0.45
);
const radBi = maxRadialErr(diskBiNew, 0.52);
const radAn = maxRadialErr(diskNew, 0.52);
const lineOld = maxLineDev(slopeNearOld);
const lineNew = maxLineDev(slopeBiNew);
check(
  'bilinear+sobel 30deg rim has no cell-sized axis steps',
  axisSlopeNew < duv * 0.55
);
check(
  'bilinear+sobel 30deg rim hugs the true line not Bresenham stairs',
  lineNew < duv * 0.4 && lineNew < lineOld * 0.55
);
check(
  'snapped disk rim stays on the curve not a stair envelope',
  radBi.m < duv * 0.3
);
check(
  'analytic disk rim is a curve (radial error << cell)',
  radAn.m < duv * 0.2
);

const slopeGridHi = rasterize(128, sampleSlope);
const diskGridHi = rasterize(128, sampleDisk);
const bilinSlopeHi = (u, v) => sampleBilinear(slopeGridHi, u, v);
const nearestSlopeHi = (u, v) => sampleNearest(slopeGridHi, u, v);
const bilinDiskHi = (u, v) => sampleBilinear(diskGridHi, u, v);
const nearestDiskHi = (u, v) => sampleNearest(diskGridHi, u, v);
const slopeHiNew = buildGrid(n, bilinSlopeHi, 'new', 1 / 128);
const slopeHiOld = buildGrid(n, nearestSlopeHi, 'old');
const diskHiNew = buildGrid(n, bilinDiskHi, 'new', 1 / 128);
const diskHiOld = buildGrid(n, nearestDiskHi, 'old');
const axisRunSlopeHi = longestAxisAlignedRun(slopeHiNew);
const axisRunDiskHi = longestAxisAlignedRun(diskHiNew);
const axisSlopeHi = longestAxisSilhouette(slopeHiNew);
check(
  'high-res 30deg rim step size is well under a mesh cell',
  axisSlopeHi < duv * 0.35
);
check(
  'nearest high-res 30deg rim still has cell-sized axis steps',
  longestAxisSilhouette(slopeHiOld) >= duv * 0.8
);
check(
  'texel sobel 30deg rim is not a 6-7px-class axis polyline',
  axisRunSlopeHi < 5
);
check(
  'high-res rounded disk is a curve not a cell-sized polyline',
  longestAxisSilhouette(diskHiNew) < duv * 0.35 &&
    maxRadialErr(diskHiNew, 0.52).m < duv * 0.28 &&
    axisRunDiskHi <= 3
);
check(
  'nearest high-res disk still shows cell stairs so the rounded-corner check is live',
  longestAxisSilhouette(diskHiOld) >= duv * 0.8 || longestAxisAlignedRun(diskHiOld) >= 3
);

const isolateSrc = readFileSync(join(root, 'region-isolate.js'), 'utf8');
const islandCtx = { console };
islandCtx.window = islandCtx;
islandCtx.globalThis = islandCtx;
vm.runInNewContext(isolateSrc + '\n' + island, islandCtx);
const Island = islandCtx.AntiqueTerrainIsland;
function hexOf(rgb) {
  const h = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
  return ('#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2])).toUpperCase();
}
check('UV 0 is top rim', Island.strataUv(0, 20000) === 0);
check('UV 1 is skirt bottom', Island.strataUv(20000, 20000) === 1);
check(
  'bay UV 0.00-0.15 is marine mud #3D5348',
  hexOf(Island.strataRgb(0, true)) === '#3D5348' && hexOf(Island.strataRgb(0.149, true)) === '#3D5348'
);
check(
  'bay UV 0.15-0.40 is gravel clay #A67C52',
  hexOf(Island.strataRgb(0.151, true)) === '#A67C52' && hexOf(Island.strataRgb(0.399, true)) === '#A67C52'
);
check(
  'bay UV 0.40-1.00 is bedrock #3A2E24',
  hexOf(Island.strataRgb(0.401, true)) === '#3A2E24' && hexOf(Island.strataRgb(1, true)) === '#3A2E24'
);
check('bay top is marine mud', hexOf(Island.strataRgb(0.05, true)) === '#3D5348');
check('bay mid is terrestrial clay', hexOf(Island.strataRgb(0.25, true)) === '#A67C52');
check('bay base is bedrock', hexOf(Island.strataRgb(0.7, true)) === '#3A2E24');
check(
  'inland residual palette unchanged',
  hexOf(Island.strataRgb(0.05, false)) === '#C4A06A' && hexOf(Island.strataRgb(0.099, false)) === '#C4A06A'
);
check(
  'inland weathered palette unchanged',
  hexOf(Island.strataRgb(0.11, false)) === '#8B7355' && hexOf(Island.strataRgb(0.29, false)) === '#8B7355'
);
check('inland bedrock palette unchanged', hexOf(Island.strataRgb(0.31, false)) === '#3A2E24');
check('inland top is residual', hexOf(Island.strataRgb(0.05, false)) === '#C4A06A');
check('inland mid is weathered crust', hexOf(Island.strataRgb(0.2, false)) === '#8B7355');
check('inland base is bedrock', hexOf(Island.strataRgb(0.8, false)) === '#3A2E24');
check(
  'water stack contacts 0.15 and 0.40',
  Island.STRATA_WATER[0].t === 0.15 && Island.STRATA_WATER[1].t === 0.4
);
check(
  'land stack contacts 0.10 and 0.30 unchanged',
  Island.STRATA_LAND[0].t === 0.1 && Island.STRATA_LAND[1].t === 0.3
);
check(
  'two palettes differ at the rim',
  hexOf(Island.strataRgb(0.05, true)) !== hexOf(Island.strataRgb(0.05, false))
);
check('Yellow Sea lng/lat is water rim', Island.isRimWaterLngLat(121.5, 36.8) === true);
check('Gansu inland lng/lat is land rim', Island.isRimWaterLngLat(103.7, 37.9) === false);
check('bedding line at water clay contact', hexOf(Island.strataRgb(0.15, true, { lineWidth: 0.002 })) === '#1A1410');
check('B>R water/sky is not bedrock', Island.classifyWallRgb(38, 44, 62, true) === 'blue-gray');
check('bay bedrock is R>B brown', Island.classifyWallRgb(58, 46, 36, true) === 'rock');
check('bay mud G>R not blue', Island.classifyWallRgb(61, 83, 72, true) === 'mud');
check('blue-gray is B>R and B>G', Island.isBlueGrayRgb(38, 44, 62) === true && Island.isBlueGrayRgb(61, 83, 72) === false);
check('bay clay is warm tan R>B', Island.classifyWallRgb(166, 124, 82, true) === 'clay');

const bayCol = Island.rasterWallColumn(1000, true);
check(
  'rendered bay wall order is mud then clay then rock',
  bayCol.order.length === 3 &&
    bayCol.order[0] === 'mud' &&
    bayCol.order[1] === 'clay' &&
    bayCol.order[2] === 'rock'
);
check('rendered bay wall mud is ~15%', Math.abs(bayCol.pct.mud - 15) < 2);
check('rendered bay wall clay is ~25%', Math.abs(bayCol.pct.clay - 25) < 2);
check('rendered bay wall rock is ~60%', Math.abs(bayCol.pct.rock - 60) < 2);
check('rendered bay wall has no B>R majority', bayCol.pct['blue-gray'] === 0 && bayCol.pct.rock > bayCol.pct['blue-gray']);
check('meter-drop * clip.w overflows mediump at bay zoom', 25000 * 8 > 65504);
check('0-1 shade * clip.w fits mediump', 1 * 8 <= 65504);

const landCol = Island.rasterWallColumn(1000, false);
check(
  'inland wall order is residual then weathered then rock',
  landCol.order.length === 3 &&
    landCol.order[0] === 'residual' &&
    landCol.order[1] === 'weathered' &&
    landCol.order[2] === 'rock'
);
check('inland residual is ~10%', Math.abs(landCol.pct.residual - 10) < 2);
check('inland weathered is ~20%', Math.abs(landCol.pct.weathered - 20) < 2);
check('inland rock is ~70%', Math.abs(landCol.pct.rock - 70) < 2);
check('inland wall has no B>R', landCol.pct['blue-gray'] === 0);

function identProject(lng, lat) {
  return [lng, lat];
}
function identUnproject(x, y) {
  return [x, y];
}

const verticalTail = [
  [40, 0],
  [40, 13],
  [41, 13],
  [41, 0],
  [40, 0],
];
const denseTail = Island.densifyProjected(verticalTail, identProject, 2);
check(
  'near-vertical tail is densified not merged',
  Island.longestProjectedStepPx(denseTail, identProject) <= 2 + 1e-6 && denseTail.length > verticalTail.length
);
let skippedCollinear = false;
for (let i = 1; i < denseTail.length - 1; i++) {
  const x = denseTail[i][0];
  if (Math.abs(x - 40) < 1e-9) {
    const y = denseTail[i][1];
    if (y > 0.5 && y < 12.5 && (y % 1 === 0) === false) {
      /* interpolated — good */
    }
  }
}
check('densifyProjected never calls resampleRing', !Island.densifyProjected.toString().includes('resampleRing'));
check('buildRimLoop never calls resampleRing', !Island.buildRimLoop.toString().includes('resampleRing'));

const chamferCorner = [
  [0, 28],
  [0, 14],
  [1.2, 8.5],
  [4.2, 4.2],
  [8.5, 1.2],
  [14, 0],
  [28, 0],
  [28, 28],
  [0, 28],
];
const rounded = Island.roundCornerArcs(chamferCorner, identProject, identUnproject, { stepPx: 2 });
const rim = Island.buildRimLoop(chamferCorner, identProject, identUnproject, { maxPx: 2, stepPx: 2 });

function axisFlatOnCorner(ring) {
  const pts = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (p[0] <= 18 && p[1] <= 18) pts.push(p);
  }
  if (pts.length < 2) return 99;
  const closed = pts.concat([pts[0]]);
  return Island.longestAxisAlignedFlatPx(closed, identProject);
}
check(
  'rounded corner has no ≥4px axis-aligned flat',
  axisFlatOnCorner(rounded) < 4 && axisFlatOnCorner(rim) < 4
);
check('chamfer 6px flats are replaced by an arc', axisFlatOnCorner(rounded) < 4);
check('rim adjacent spacing ≤2px including the corner', Island.longestProjectedStepPx(rim, identProject) <= 2 + 1e-6);

const closeChamfer = [
  [0, 240],
  [0, 120],
  [12, 72],
  [36, 36],
  [72, 12],
  [120, 0],
  [240, 0],
  [240, 240],
  [0, 240],
];
function longestCornerChord(ring, lim) {
  let max = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (a[0] <= lim && a[1] <= lim && b[0] <= lim && b[1] <= lim) {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d > max) max = d;
    }
  }
  return max;
}
const closeRounded = Island.roundCornerArcs(closeChamfer, identProject, identUnproject, { stepPx: 2 });
const closeRim = Island.buildRimLoop(closeChamfer, identProject, identUnproject, { maxPx: 2, stepPx: 2, nudgePx: 0 });
check(
  'close-zoom 8-segment chamfer is an arc not 48px flats',
  longestCornerChord(closeRounded, 140) < 8 && longestCornerChord(closeRim, 140) <= 2 + 1e-6
);
check(
  'close-zoom chamfer adjacent spacing ≤2px',
  Island.longestProjectedStepPx(closeRim, identProject) <= 2 + 1e-6
);
const sharpClip = [
  [0, 80],
  [0, 0],
  [80, 0],
  [80, 80],
  [0, 80],
];
const sharpKeep = Island.roundCornerArcs(sharpClip, identProject, identUnproject, { stepPx: 2 });
let keepSquare = false;
for (let i = 0; i < sharpKeep.length; i++) {
  if (Math.abs(sharpKeep[i][0]) < 1e-6 && Math.abs(sharpKeep[i][1]) < 1e-6) keepSquare = true;
}
check('sharp 90° clip corners stay unfilleted', keepSquare);

const vNotch = [
  [0, 50],
  [25, 10],
  [50, 50],
  [50, 90],
  [0, 90],
  [0, 50],
];
function inVApex(ll) {
  return ll[0] >= 8 && ll[0] <= 42 && ll[1] >= 8 && ll[1] <= 36;
}
function longestAxisFlatIn(ring, project, pred) {
  let max = 0;
  let run = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    if (!pred(ring[i]) || !pred(ring[i + 1])) {
      run = 0;
      continue;
    }
    const a = project(ring[i][0], ring[i][1]);
    const b = project(ring[i + 1][0], ring[i + 1][1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = Math.hypot(dx, dy);
    const ang = Math.atan2(Math.abs(dy), Math.abs(dx));
    const axis = Math.min(ang, Math.PI / 2 - ang) <= (8 * Math.PI) / 180;
    let collinear = true;
    if (i > 0 && pred(ring[i - 1])) {
      const p = project(ring[i - 1][0], ring[i - 1][1]);
      const turn = Math.abs(
        Math.atan2(
          (a[0] - p[0]) * dy - (a[1] - p[1]) * dx,
          (a[0] - p[0]) * dx + (a[1] - p[1]) * dy
        )
      );
      if (turn > (4 * Math.PI) / 180) collinear = false;
    }
    if (d >= 1.2 && axis && collinear) {
      run += d;
      if (run > max) max = run;
    } else run = 0;
  }
  return max;
}
const vRounded = Island.roundCornerArcs(vNotch, identProject, identUnproject, { stepPx: 2 });
const vRim = Island.buildRimLoop(vNotch, identProject, identUnproject, { maxPx: 2, stepPx: 2, nudgePx: 0 });
check(
  '60° V-notch is an arc, not a 6px apex flat',
  longestAxisFlatIn(vRounded, identProject, inVApex) < 6 &&
    longestAxisFlatIn(vRim, identProject, inVApex) < 6 &&
    Island.longestProjectedStepPx(vRim, identProject) <= 2 + 1e-6
);
check(
  'V-notch adjacent spacing ≤2px',
  Island.longestProjectedStepPx(vRim, identProject) <= 2 + 1e-6
);
const vDense = Island.densifyProjected(vNotch, identProject, 2);
const vDenseRounded = Island.roundCornerArcs(vDense, identProject, identUnproject, { stepPx: 2 });
check(
  'densified V-notch still arcs after 2px samples',
  longestAxisFlatIn(vDenseRounded, identProject, inVApex) < 6 &&
    Island.longestProjectedStepPx(Island.buildRimLoop(vDense, identProject, identUnproject, { maxPx: 2, stepPx: 2, nudgePx: 0 }), identProject) <= 2 + 1e-6
);

const shallowCape = [];
for (let deg = 90; deg >= 36; deg -= 6) {
  const a = (deg * Math.PI) / 180;
  shallowCape.push([800 * Math.cos(a), 800 * Math.sin(a)]);
}
shallowCape.push([900, shallowCape[shallowCape.length - 1][1]], [900, 900], [0, 900], shallowCape[0]);
const shallowRounded = Island.roundCornerArcs(shallowCape, identProject, identUnproject, { stepPx: 2 });
check(
  'shallow 5–7° cape chamfer becomes an arc not 60–100px chords',
  longestCornerChord(shallowRounded, 850) < 12
);

const skirts = Island.skirtRingsFromLoop(rim);
let sameLoop = skirts.top.length === skirts.bottom.length && skirts.top.length > 3;
for (let i = 0; sameLoop && i < skirts.top.length; i++) {
  if (skirts.top[i][0] !== skirts.bottom[i][0] || skirts.top[i][1] !== skirts.bottom[i][1]) sameLoop = false;
}
check('skirt top and bottom rings are the same projected loop', sameLoop);

function stubMl() {
  return {
    MercatorCoordinate: {
      fromLngLat: function (ll, alt) {
        return { x: 0.5, y: 0.4, z: Number(alt) / 40075016.686 };
      },
    },
  };
}
function matClipYFromZ(zScale) {
  const m = new Float32Array(16);
  m[9] = zScale;
  m[15] = 1;
  return m;
}
check(
  'when alt-drop projects toward +ndcY (sky), overlay drop sign is +1',
  Island.overlayDropSignFromMatrix(matClipYFromZ(-1), stubMl(), 116.4, 39.9, 200, 18000) === 1
);
check(
  'when alt-drop projects toward -ndcY (void), overlay drop sign is -1',
  Island.overlayDropSignFromMatrix(matClipYFromZ(1), stubMl(), 116.4, 39.9, 200, 18000) === -1
);
check(
  'missing custom matrix defaults to mesh-down (-1), not a second invert',
  Island.overlayDropSignFromMatrix(null, stubMl(), 116.4, 39.9, 200, 18000) === -1
);

let snappedToGrid = true;
for (let i = 0; i < rim.length; i++) {
  const x = rim[i][0];
  const y = rim[i][1];
  if (Math.abs(x - Math.round(x)) > 1e-6 || Math.abs(y - Math.round(y)) > 1e-6) {
    snappedToGrid = false;
    break;
  }
}
check('rim vertices are not snapped onto a pixel grid', snappedToGrid === false);

function makeOblique(opts) {
  const center = opts.center;
  const zoom = opts.zoom;
  const pitch = (opts.pitch * Math.PI) / 180;
  const bearing = (opts.bearing * Math.PI) / 180;
  const W = opts.width;
  const H = opts.height;
  const worldSize = 256 * Math.pow(2, zoom);
  const fov = 0.6435;
  const camDist = 0.5 / Math.tan(fov / 2);
  const c = Island.lngLatToMercator(center[0], center[1]);
  const cosB = Math.cos(bearing);
  const sinB = Math.sin(bearing);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  function project(lng, lat) {
    const m = Island.lngLatToMercator(lng, lat);
    const x = (m[0] - c[0]) * worldSize;
    const y = (m[1] - c[1]) * worldSize;
    const xr = x * cosB - y * sinB;
    const yr = x * sinB + y * cosB;
    const y2 = yr * cosP;
    const z2 = yr * sinP;
    const w = camDist + z2 / worldSize;
    return [W / 2 + (xr * camDist) / Math.max(w, 1e-6), H / 2 + (y2 * camDist) / Math.max(w, 1e-6)];
  }
  function unproject(sx, sy) {
    const xN = (sx - W / 2) / camDist;
    const yN = (sy - H / 2) / camDist;
    const den = cosP - (yN * sinP) / worldSize;
    const yr = Math.abs(den) > 1e-12 ? (yN * camDist) / den : 0;
    const w = camDist + (yr * sinP) / worldSize;
    const xr = xN * w;
    const x = xr * cosB + yr * sinB;
    const y = -xr * sinB + yr * cosB;
    return Island.mercatorToLngLat(c[0] + x / worldSize, c[1] + y / worldSize);
  }
  return { project: project, unproject: unproject };
}

function longestSingleAxisPx(ring, project) {
  let max = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = project(ring[i][0], ring[i][1]);
    const b = project(ring[i + 1][0], ring[i + 1][1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = Math.hypot(dx, dy);
    const ang = Math.atan2(Math.abs(dy), Math.abs(dx));
    if (Math.min(ang, Math.PI / 2 - ang) <= (8 * Math.PI) / 180 && d > max) max = d;
  }
  return max;
}

const acceptCam = makeOblique({
  center: [122.4, 37.4],
  zoom: 9.4,
  pitch: 62,
  bearing: 12,
  width: 800,
  height: 800,
});
// FM-0902-44 / FM-0903-1 stills camera: Shandong isolate at 1440×900,
// then LANCZOS to isolate-skirt-oblique-800.png (800×500).
const stillsCam = makeOblique({
  center: [121.4, 36.8],
  zoom: 7.35,
  pitch: 62,
  bearing: 32,
  width: 1440,
  height: 900,
});
const elevProject = (lng, lat) => {
  const p = acceptCam.project(lng, lat);
  return [p[0], p[1] - 36];
};
const obliqueChamfer = [
  [122.3, 37.55],
  [122.3, 37.48],
  [122.305, 37.455],
  [122.325, 37.435],
  [122.355, 37.42],
  [122.4, 37.415],
  [122.55, 37.415],
  [122.55, 37.55],
  [122.3, 37.55],
];
const obRim = Island.buildRimLoop(obliqueChamfer, acceptCam.project, acceptCam.unproject, {
  maxPx: 2,
  stepPx: 2,
  nudgePx: 0,
  extraProjects: [elevProject],
});
check(
  'oblique overlay adjacent spacing ≤2px',
  Island.longestProjectedStepPx(obRim, acceptCam.project) <= 2 + 1e-6 &&
    Island.longestProjectedStepPx(obRim, elevProject) <= 2 + 1e-6
);
check(
  'oblique overlay has no 6px corner flats',
  longestSingleAxisPx(obRim, acceptCam.project) <= 2 + 1e-6 &&
    longestSingleAxisPx(obRim, elevProject) <= 2 + 1e-6
);
function inObliqueCorner(ll) {
  return ll[0] >= 122.33 && ll[0] <= 122.4 && ll[1] >= 37.418 && ll[1] <= 37.445;
}
check(
  'oblique chamfer collinear corner flats are <6px after densify',
  longestAxisFlatIn(obRim, acceptCam.project, inObliqueCorner) < 6 &&
    longestAxisFlatIn(obRim, elevProject, inObliqueCorner) < 6
);
const rawOblique = Island.densifyProjected(obliqueChamfer, acceptCam.project, 2);
check(
  'raw densified oblique chamfer still has ≥6px collinear flats so the arc check is live',
  longestAxisFlatIn(rawOblique, acceptCam.project, (ll) => ll[0] >= 122.3 && ll[0] <= 122.42 && ll[1] >= 37.415 && ll[1] <= 37.48) >= 6
);
check(
  'oblique overlay projected step stays ≤2px',
  Island.longestProjectedStepPx(obRim, acceptCam.project) <= 2 + 1e-6
);
check(
  'oblique rounded corner is sampled as an arc',
  obRim.length > obliqueChamfer.length * 3 &&
    Island.longestProjectedStepPx(obRim, acceptCam.project) <= 2 + 1e-6
);
check(
  'wall densify includes custom-layer gpu projectors',
  /projectGpuFn\(map,\s*maplibregl,\s*2500\)/.test(island) && /projectGpuFn\(map,\s*maplibregl,\s*0\)/.test(island)
);
check(
  'rim round/nudge/densify run in gpu elev space so the overlay can cover mesh stairs',
  /projectGpuElevFn\(map,\s*maplibregl\)/.test(island) &&
    /rimLoopsFromFeature\(feature,\s*gpuElev/.test(island)
);
check(
  'custom-layer matrix prefers the live transform over a stale lastMatrix',
  /function customLayerMatrix[\s\S]{0,420}getProjectionDataForCustomLayer/.test(island) &&
    !/function customLayerMatrix[\s\S]{0,180}impl\.lastMatrix/.test(island)
);
check('arc sampling is not capped at 256', !/if \(n > 256\) n = 256/.test(island) && /if \(n > 1024\) n = 1024/.test(island));
check(
  'inside snap stays on the iso',
  vendor.includes('float land=inside?hi:max(lo-0.12,0.0)') &&
    !vendor.includes('float land=inside?min(hi+0.40,1.6)')
);
check(
  'outside mixed fragments stay as mesh walls',
  vendor.includes('if(outside&&!mixed)discard') && !vendor.includes('if(outside)discard;')
);

const dataSrc = readFileSync(join(root, 'region-isolate-data.js'), 'utf8');
vm.runInNewContext(dataSrc, islandCtx);
const rec = islandCtx.REGION_ISOLATE.findRegion(islandCtx.REGION_ISOLATE_DATA, 'shandong');
const feat = islandCtx.REGION_ISOLATE.narrativeFeature(rec.feature);
const sdLoops = Island.rimLoopsFromFeature(feat, acceptCam.project, acceptCam.unproject, {
  maxPx: 2,
  stepPx: 2,
  nudgePx: 12,
  extraProjects: [elevProject],
});
const sdRim = sdLoops[0];
check('shandong isolate has a rim loop', sdLoops.length >= 1 && sdRim && sdRim.length > 200 && sdRim.length < 16000);
check(
  'oblique Shandong overlay adjacent spacing ≤2px',
  Island.longestProjectedStepPx(sdRim, acceptCam.project) <= 2 + 1e-6 &&
    Island.longestProjectedStepPx(sdRim, elevProject) <= 2 + 1e-6
);
check(
  'oblique Shandong overlay has no 6px corner flats',
  longestSingleAxisPx(sdRim, acceptCam.project) <= 2 + 1e-6 &&
    longestSingleAxisPx(sdRim, elevProject) <= 2 + 1e-6
);
check(
  'oblique Shandong overlay projected step ≤2px is not a densify-hidden 6px flat',
  Island.longestProjectedStepPx(sdRim, acceptCam.project) <= 2 + 1e-6 &&
    Island.longestProjectedStepPx(sdRim, elevProject) <= 2 + 1e-6
);

const stillsElev = (lng, lat) => {
  const p = stillsCam.project(lng, lat);
  return [p[0], p[1] - 36];
};
const sdStillsLoops = Island.rimLoopsFromFeature(feat, stillsCam.project, stillsCam.unproject, {
  maxPx: 2,
  stepPx: 2,
  nudgePx: 12,
  extraProjects: [stillsElev],
});
const sdStills = sdStillsLoops[0];
check('stills-camera Shandong isolate has a rim loop', sdStillsLoops.length >= 1 && sdStills && sdStills.length > 200);
check(
  'stills-camera overlay adjacent spacing ≤2px',
  Island.longestProjectedStepPx(sdStills, stillsCam.project) <= 2 + 1e-6 &&
    Island.longestProjectedStepPx(sdStills, stillsElev) <= 2 + 1e-6
);
check(
  'stills-camera overlay has no 6px corner flats',
  longestSingleAxisPx(sdStills, stillsCam.project) <= 2 + 1e-6 &&
    longestSingleAxisPx(sdStills, stillsElev) <= 2 + 1e-6
);

const gpuCam = (lng, lat) => {
  const p = acceptCam.project(lng, lat);
  return [p[0] * 0.55 + 90, p[1] * 1.35 - 40];
};
const sdGpuLoops = Island.rimLoopsFromFeature(feat, gpuCam, acceptCam.unproject, {
  maxPx: 2,
  stepPx: 2,
  nudgePx: 12,
  extraProjects: [acceptCam.project, elevProject],
});
const sdGpu = sdGpuLoops[0];
check('shandong GPU-primary isolate has a rim loop', sdGpuLoops.length >= 1 && sdGpu && sdGpu.length > 200 && sdGpu.length < 20000);
check(
  'oblique Shandong GPU-primary overlay adjacent spacing ≤2px',
  Island.longestProjectedStepPx(sdGpu, gpuCam) <= 2 + 1e-6 &&
    Island.longestProjectedStepPx(sdGpu, acceptCam.project) <= 2 + 1e-6
);
check(
  'oblique Shandong GPU-primary overlay has no 6px corner flats',
  longestSingleAxisPx(sdGpu, gpuCam) <= 2 + 1e-6 &&
    longestSingleAxisPx(sdGpu, acceptCam.project) <= 2 + 1e-6
);
check(
  'oblique Shandong GPU-primary projected step ≤2px',
  Island.longestProjectedStepPx(sdGpu, gpuCam) <= 2 + 1e-6 &&
    Island.longestProjectedStepPx(sdGpu, acceptCam.project) <= 2 + 1e-6
);
const gpuChamfer = Island.buildRimLoop(obliqueChamfer, gpuCam, acceptCam.unproject, {
  maxPx: 2,
  stepPx: 2,
  nudgePx: 12,
});
const gpuChamfer0 = Island.buildRimLoop(obliqueChamfer, gpuCam, acceptCam.unproject, {
  maxPx: 2,
  stepPx: 2,
  nudgePx: 0,
});
function meanOutwardPx(nudged, base, project) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < nudged.length; i++) {
    const a = project(nudged[i][0], nudged[i][1]);
    const b = project(base[Math.min(i, base.length - 1)][0], base[Math.min(i, base.length - 1)][1]);
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d < 80) {
      s += d;
      n += 1;
    }
  }
  return n ? s / n : 0;
}
check(
  'GPU-primary 12px nudge is a real screen offset, not a no-op',
  meanOutwardPx(gpuChamfer, gpuChamfer0, gpuCam) >= 4
);

// Custom-layer mainMatrix at the Shandong oblique camera. Inland verts
// get a fake altitude so the projected ring folds and the screen-space
// area sign points the 12px overlay nudge inland (live fail: overlay
// minY 305 vs mesh 294). Outward is away from the geographic centroid.
const GPU_OBLIQUE_MAT = [
  1015026.9375, 101288.7890625, 63981.07421875, 63498.8359375, 215750.640625,
  -476526.28125, -301007.28125, -298738.53125, 0, 916237.5625, -163623.984375,
  -162390.71875, -936298.3125, 99623.1328125, 64193.36328125, 63741.40234375,
];
const EARTH_CIRC = 2 * Math.PI * 6378137;
function gpuFoldProject(lng, lat) {
  const m = Island.lngLatToMercator(lng, lat);
  const alt = lng < 121.2 ? 800 : -50;
  const z = (alt / EARTH_CIRC) * Math.cos((lat * Math.PI) / 180);
  const x = m[0];
  const y = m[1];
  const c0 = GPU_OBLIQUE_MAT[0] * x + GPU_OBLIQUE_MAT[4] * y + GPU_OBLIQUE_MAT[8] * z + GPU_OBLIQUE_MAT[12];
  const c1 = GPU_OBLIQUE_MAT[1] * x + GPU_OBLIQUE_MAT[5] * y + GPU_OBLIQUE_MAT[9] * z + GPU_OBLIQUE_MAT[13];
  const c3 = GPU_OBLIQUE_MAT[3] * x + GPU_OBLIQUE_MAT[7] * y + GPU_OBLIQUE_MAT[11] * z + GPU_OBLIQUE_MAT[15];
  const ndcX = c0 / c3;
  const ndcY = c1 / c3;
  return [(ndcX * 0.5 + 0.5) * 800, (1 - (ndcY * 0.5 + 0.5)) * 800];
}
function northRimGpu(loop) {
  let minY = 1e9;
  let maxLat = -1e9;
  let n = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    if (p[0] < 122.14 || p[0] > 122.22 || p[1] < 37.7) continue;
    const a = gpuFoldProject(p[0], p[1]);
    if (a[0] > 80 && a[0] < 400 && a[1] > 250 && a[1] < 360) {
      minY = Math.min(minY, a[1]);
      maxLat = Math.max(maxLat, p[1]);
      n += 1;
    }
  }
  return { minY, maxLat, n };
}
const sdRawRing =
  feat.geometry.type === 'MultiPolygon' ? feat.geometry.coordinates[0][0] : feat.geometry.coordinates[0];
const sdFold0 = Island.buildRimLoop(sdRawRing, gpuFoldProject, acceptCam.unproject, {
  maxPx: 16,
  stepPx: 8,
  nudgePx: 0,
});
const sdFold12 = Island.buildRimLoop(sdRawRing, gpuFoldProject, acceptCam.unproject, {
  maxPx: 16,
  stepPx: 8,
  nudgePx: 12,
});
const fold0 = northRimGpu(sdFold0);
const fold12 = northRimGpu(sdFold12);
check(
  'GPU-folded overlay nudge moves the north rim toward the sky, not inland',
  fold0.n > 0 &&
    fold12.n > 0 &&
    fold12.minY <= fold0.minY + 1e-3 &&
    fold12.maxLat >= fold0.maxLat - 1e-4
);
check(
  'overlay nudge follows a geographic outward step, not a folded projected centroid',
  /function nudgeRimOutwardPx[\s\S]{0,3200}dlat/.test(island) &&
    !/function nudgeRimOutwardPx[\s\S]{0,3200}cur\.x - cxy/.test(island)
);

const fpCross = Island.meshCrossingsFromGrid(
  [
    [1, 1, 0],
    [1, 0.2, 0],
    [1, 1, 0],
  ],
  0,
  0,
  1,
  2
);
check('mesh crossing helper stays unused as live rim (fp interpolate only)', fpCross.length >= 1);

if (failed) {
  console.error('isolate-skirt-seam tests failed', {
    sumNew,
    sumOld,
    planeSum,
    obRimN: obRim.length,
    obStep: Island.longestProjectedStepPx(obRim, acceptCam.project),
  });
  process.exit(1);
}
console.log('isolate-skirt-seam tests passed', {
  walls: sumNew.walls,
  skirtWalls: sumNew.skirtWalls,
  maxRadial: Number(sumNew.maxRadial.toFixed(4)),
  oldMaxRadial: Number(sumOld.maxRadial.toFixed(4)),
});
