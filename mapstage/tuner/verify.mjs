import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { readPageSource } from '../runtime/lib/tuner-source.mjs';

const root = dirname(fileURLToPath(import.meta.url));

const required = [
  'index.html',
  'hexi-map-shot.html',
  'map-tiles.config.js',
  'map-tiles.config.example.js',
  'assets/map-fx.js',
  'assets/region-isolate.js',
  'assets/region-isolate-data.js',
  'assets/terrain-island.js',
  'vendor/maplibre-gl.js',
  'scripts/patch-maplibre-terrain-clip.mjs',
  'assets/han-city-3d.js',
  'assets/sample-sites.json',
  'preset-antique-default.json',
  'presets/antique-default.json',
  'scenes.json',
  'vector-layers.html',
  'assets/vector-paint.js',
  'assets/isolate-workbench.js',
  'assets/landcover-lowzoom.geojson',
  'assets/site-nav.js',
  'assets/tuner-shell.js',
  'assets/tuner-vector.js',
  'assets/mapstage-story.js',
  'assets/mapstage-hosts.js',
  'assets/mapstage-play.js',
  'assets/mapstage-board.js',
  '../schemas/story.schema.json',
  '../site/examples/story-hexi.json',
  '../site/examples/play-sanguo.json',
];

let ok = true;
for (const rel of required) {
  const p = join(root, rel);
  if (existsSync(p)) {
    console.log(`OK  ${rel}`);
  } else {
    console.error(`MISS ${rel}`);
    ok = false;
  }
}

const localCfg = join(root, 'map-tiles.config.local.js');
if (existsSync(localCfg)) {
  console.log('OK  map-tiles.config.local.js (optional local override present)');
} else {
  console.log('—   map-tiles.config.local.js (optional, not present)');
}

const indexHtml = join(root, 'index.html');
if (existsSync(indexHtml)) {
  const html = readPageSource(indexHtml);
  if (!html.includes('MAP_MIN_ZOOM = 3')) {
    console.error('FAIL index.html missing MAP_MIN_ZOOM=3');
    ok = false;
  } else {
    console.log('OK  index.html MAP_MIN_ZOOM=3');
  }
  {
    if (!html.includes("viewMode === 'globe' ? GLOBE_MIN_ZOOM")) {
      console.error('FAIL createMap does not pass GLOBE_MIN_ZOOM when viewMode is globe');
      ok = false;
    } else {
      console.log('OK  createMap minZoom follows viewMode globe vs map');
    }
  }
  if (!html.includes("kind === 'empty'") && !html.includes("return 'empty'")) {
    console.error('FAIL index.html missing isolate-off empty mask kind');
    ok = false;
  } else {
    console.log('OK  index.html isolate-off uploads empty mask');
  }
  if (!html.includes("return 'island'") || !html.includes("kind !== 'island'")) {
    console.error('FAIL index.html island isolate still builds tiled parchment mask');
    ok = false;
  } else {
    console.log('OK  index.html island isolate skips tiled parchment mask');
  }
  if (!html.includes('three@0.160.0')) {
    console.error('FAIL index.html missing Three.js script');
    ok = false;
  } else {
    console.log('OK  index.html loads Three.js');
  }
}


{
  const navPath = join(root, 'assets/site-nav.js');
  try {
    const nav = readFileSync(navPath, 'utf8');
    if (!nav.includes('function mount') && !nav.includes('mount:')) {
      console.error('FAIL site-nav.js missing mount');
      ok = false;
    } else {
      console.log('OK  site-nav.js LINKS + mount');
    }
    const navCtx = { window: { location: { search: '' } } };
    vm.runInNewContext(nav, navCtx);
    const SiteNav = navCtx.window.AntiqueSiteNav;
    const navHrefs = (SiteNav.LINKS || []).map((row) => row.href);
    const expectHrefs = ['../', '../docs/', '../examples/', 'index.html'];
    if (JSON.stringify(navHrefs) !== JSON.stringify(expectHrefs)) {
      console.error('FAIL site-nav LINKS hrefs got ' + JSON.stringify(navHrefs));
      ok = false;
    } else {
      console.log('OK  site-nav LINKS hrefs');
    }
    if ((SiteNav.LINKS || []).some((row) => row.page === 'edit')) {
      console.error('FAIL site-nav still lists a separate 皮肤编辑 entry (merged into Studio 配色)');
      ok = false;
    } else {
      console.log('OK  site-nav single Studio entry (皮肤编辑 merged into 配色)');
    }
    if (typeof SiteNav.editorPage !== 'function') {
      console.error('FAIL site-nav missing editorPage');
      ok = false;
    } else {
      if (SiteNav.editorPage('skin') !== 'index.html' || SiteNav.editorPage('camera') !== 'index.html') {
        console.error('FAIL editorPage(skin|camera) expected index.html');
        ok = false;
      }
      if (SiteNav.editorPage('city') !== 'index.html' || SiteNav.editorPage('climate') !== 'index.html') {
        console.error('FAIL editorPage(city|climate) expected index.html');
        ok = false;
      }
      console.log('OK  editorPage all families → index');
    }
    const parseCtx = { window: { location: { search: '?family=skin%20&variant=ink&family=camera' } } };
    vm.runInNewContext(nav, parseCtx);
    const parsed = parseCtx.window.AntiqueSiteNav.parseQuery();
    if (parsed.family !== 'camera' || parsed.variant !== 'ink') {
      console.error('FAIL parseQuery last-write/trim got ' + JSON.stringify(parsed));
      ok = false;
    } else {
      console.log('OK  parseQuery last family wins and trims');
    }
    const skinHref = SiteNav.editorHref('skin', 'ink');
    const camHref = SiteNav.editorHref('camera', 'hexi-rise');
    const cityHref = SiteNav.editorHref('city', 'tiered');
    if (skinHref !== 'index.html?family=skin&variant=ink') {
      console.error('FAIL editorHref(skin) ' + skinHref);
      ok = false;
    } else {
      console.log('OK  editorHref(skin) → index.html');
    }
    if (camHref !== 'index.html?family=camera&variant=hexi-rise') {
      console.error('FAIL editorHref(camera) ' + camHref);
      ok = false;
    } else {
      console.log('OK  editorHref(camera) → index.html');
    }
    if (cityHref !== 'index.html?family=city&variant=tiered') {
      console.error('FAIL editorHref(city) ' + cityHref);
      ok = false;
    } else {
      console.log('OK  editorHref(city) → index.html');
    }
    const layersHtml = readFileSync(join(root, 'vector-layers.html'), 'utf8');
    if (!layersHtml.includes('AntiqueSiteNav.mount') || !layersHtml.includes("page: 'edit'")) {
      console.error('FAIL vector-layers.html missing AntiqueSiteNav.mount({ page: edit })');
      ok = false;
    } else {
      console.log('OK  vector-layers.html mounts shared nav as edit');
    }
    if (!layersHtml.includes('editorPage') || !layersHtml.includes('skinDeepLink')) {
      console.error('FAIL vector-layers.html missing family/variant boot');
      ok = false;
    } else {
      console.log('OK  vector-layers.html boots family via editorPage');
    }
    if (
      !layersHtml.includes('vendor/maplibre-gl.js') ||
      !layersHtml.includes('isolate-workbench.js') ||
      !layersHtml.includes('AntiqueIsolateWorkbench.mount')
    ) {
      console.error('FAIL vector-layers.html missing patched vendor isolate workbench');
      ok = false;
    } else {
      console.log('OK  vector-layers.html patched 5.6 isolate workbench');
    }
    if (!layersHtml.includes('out.family =') || !layersHtml.includes('skin: lastSkin') || !layersHtml.includes('out.isolate')) {
      console.error('FAIL vector-layers.html export missing skin/isolate fields');
      ok = false;
    } else {
      console.log('OK  vector-layers.html export carries skin id + isolate');
    }
    const idxHtml = readFileSync(indexHtml, 'utf8');
    // 目录深链（?family=）已随 catalog 退役；调参台顶栏由 site-nav 渲染，皮肤编辑入口来自 LINKS
    if (!idxHtml.includes('id="chrome-nav"') || !idxHtml.includes('assets/tuner-shell.js')) {
      console.error('FAIL index.html missing #chrome-nav or tuner-shell.js (shared nav mount)');
      ok = false;
    } else {
      console.log('OK  index.html mounts the shared nav (single Studio entry)');
    }
  } catch (e) {
    console.error('FAIL site-nav check', e);
    ok = false;
  }
}

if (existsSync(join(root, 'vendor', 'maplibre-gl.js'))) {
  const vendor = readFileSync(join(root, 'vendor', 'maplibre-gl.js'), 'utf8');
  if (!vendor.includes('__ANTIQUE_TERRAIN_CLIP_PATCH') || !vendor.includes('bindAntiqueTerrainClip')) {
    console.error('FAIL vendor/maplibre-gl.js missing terrain clip patch');
    ok = false;
  } else if (
    !vendor.includes("var projectionMercatorVert = 'uniform vec4 u_projection_tile_mercator_coords;") ||
    vendor.includes('uniform float u_ele_delta;uniform vec4 u_projection_tile_mercator_coords;')
  ) {
    console.error('FAIL vendor/maplibre-gl.js clip coords uniform still duplicates on globe');
    ok = false;
  } else {
    console.log('OK  vendor/maplibre-gl.js terrain clip patch');
    if (
      vendor.includes('smoothstep(0.72,1.0,v_clip)') ||
      !vendor.includes('vec2 p2=a_pos3d.xy') ||
      !vendor.includes('projectTileFor3D(p2,') ||
      !vendor.includes('cuf=') ||
      !vendor.includes('highp vec2 u_clip_origin') ||
      !vendor.includes('out highp vec2 v_mercator') ||
      !vendor.includes('in highp vec2 v_mercator') ||
      !vendor.includes('fwidth(v_drop)') ||
      !vendor.includes('v_skirt=a_pos3d.z') ||
      vendor.includes('v_skirt>0.5||!mixed') ||
      vendor.includes('outside&&(skirt||!mixed)') ||
      vendor.includes('!skirt&&mixed&&v_drop>80.0') ||
      !vendor.includes('if(outside&&!mixed)discard') ||
      vendor.includes('if(outside&&!wall)discard') ||
      vendor.includes('if(outside)discard;') ||
      !vendor.includes('float land=inside?hi:max(lo-0.12,0.0)') ||
      vendor.includes('float land=inside?min(hi+0.40,1.6):max(lo-0.12,0.0)') ||
      !vendor.includes('bool nearBox=cu.x>=-duv.x') ||
      !vendor.includes('float antiqueClipBi(vec2 uv)') ||
      !vendor.includes('(tr+2.0*r+br)-(tl+2.0*l+bl)') ||
      !vendor.includes('antiqueClipSobel') ||
      !vendor.includes('antiqueClipSobel(cu,4.0*tex)') ||
      !vendor.includes('g+=s1*inversesqrt(n1)') ||
      vendor.includes('vec2 g=antiqueClipSobel(cu,tex);g+=antiqueClipSobel(cu,2.0*tex);g+=antiqueClipSobel(cu,4.0*tex);') ||
      vendor.includes('2.0*duv.x') ||
      !vendor.includes('for(int i=0;i<14;i++)') ||
      !vendor.includes('u_clip_texels') ||
      !vendor.includes('clamp(uv,0.0,1.0)*tsz') ||
      !vendor.includes('p2=(v_mercator-orig)/sc') ||
      !vendor.includes('if(!inside){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}') ||
      !vendor.includes('if(dot(dir,dir)<1.0e-12)') ||
      vendor.includes('if(!inside&&a_pos3d.z<0.5)') ||
      vendor.includes('textureSize(u_clip') ||
      vendor.includes('vec2 p2=a_pos3d.xy;vec2 p2=a_pos3d.xy;') ||
      vendor.includes('if(cr>=0.5)dir=-dir') ||
      !vendor.includes('bool wall=') ||
      vendor.includes('if(wall){float shade=') ||
      !vendor.includes('if(wall){float uv=clamp(drop,0.0,1.0)') ||
      vendor.includes('drop/max(u_clip_drop,1.0)') ||
      !vendor.includes('b0=0.15;b1=0.40') ||
      !vendor.includes('b0=0.10;b1=0.30') ||
      !vendor.includes('vec3(61.0,83.0,72.0)/255.0') ||
      !vendor.includes('vec3(196.0,160.0,106.0)/255.0') ||
      !vendor.includes('uniform highp float u_clip_drop;uniform vec4 u_clip_side_color') ||
      !vendor.includes('out highp float v_drop_w') ||
      !vendor.includes('in highp float v_drop_w') ||
      !vendor.includes('out highp float v_clip_w') ||
      !vendor.includes('in highp float v_clip_w') ||
      !vendor.includes('v_drop_w=(v_drop>80.0?1.0:0.0)*gl_Position.w') ||
      vendor.includes('v_drop_w=v_drop*gl_Position.w;') ||
      !vendor.includes('v_clip_w=gl_Position.w') ||
      !vendor.includes('float drop=v_drop_w/max(v_clip_w,1.0e-12)') ||
      !vendor.includes('bool wall=u_clip_enabled>0.5&&drop>0.004') ||
      vendor.includes('bool wall=u_clip_enabled>0.5&&drop>80.0') ||
      vendor.includes('uv=clamp(uv*4.0,0.0,1.0)') ||
      vendor.includes('float drop=v_drop_w*gl_FragCoord.w') ||
      !vendor.includes('if (!wall&&!u_is_globe_mode && v_fog_depth > u_fog_ground_blend)') ||
      vendor.includes('if (!u_is_globe_mode && v_fog_depth > u_fog_ground_blend) {') ||
      vendor.includes('noperspective') ||
      !vendor.includes('dg>0.05') ||
      !vendor.includes('(a_pos3d.z==1.0 && u_clip_enabled<0.5) ? u_ele_delta') ||
      vendor.includes('v_drop=ele_delta') ||
      !vendor.includes('v_drop=u_clip_drop') ||
      vendor.includes('v_drop/420.0') ||
      !vendor.includes('NORTH_POLE_Y : -delta') ||
      vendor.includes('const overlap = delta * 2') ||
      vendor.includes('EXTENT + overlap') ||
      !vendor.includes('vertexArray.emplaceBack(x * delta, y * delta, 0);') ||
      vendor.includes('clamp(p2/8192.0,vec2(0.01),vec2(0.99))') ||
      !vendor.includes('clamp(p2/8192.0,vec2(0.002),vec2(0.998))')
    ) {
      console.error('FAIL vendor/maplibre-gl.js island clip/skirt contract drifted');
      ok = false;
    } else {
      console.log('OK  vendor/maplibre-gl.js island skirt wall stays mixed at tile edges');
    }
  }
}

{
  const island = readFileSync(join(root, 'assets', 'terrain-island.js'), 'utf8');
  if (
    !island.includes('TEXTURE_MAG_FILTER, gl.LINEAR') ||
    /TEXTURE_MAG_FILTER, gl\.NEAREST/.test(island) ||
    !/var MESH_ISLAND = 128;/.test(island) ||
    /var MESH_ISLAND = 256;/.test(island)
  ) {
    console.error('FAIL terrain-island.js clip must be LINEAR and meshSize 128');
    ok = false;
  } else {
    console.log('OK  terrain-island.js LINEAR clip + mesh 128');
  }
  if (
    !island.includes('paintClipWater') ||
    !island.includes('inChinaSeas') ||
    !island.includes('strataRgb')
  ) {
    console.error('FAIL terrain-island.js missing location strata helpers');
    ok = false;
  } else {
    console.log('OK  terrain-island.js location strata helpers');
  }
}

for (const test of ['isolate-skirt-seam.test.mjs', 'map-fx.test.mjs', 'tuner-modules.test.mjs', 'tuner-vector.test.mjs', 'mapstage-story.test.mjs', 'mapstage-look.test.mjs', 'mapstage-play.test.mjs', 'mapstage-board.test.mjs']) {
  const run = spawnSync(process.execPath, [join(root, 'assets', test)], {
    encoding: 'utf8',
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) {
    console.error('FAIL ' + test);
    ok = false;
  }
}

// 官网 site/：必需文件 + 纯函数单测（md 渲染、stage-kit 几何 / 镜头）
{
  const site = join(root, '..', 'site');
  const siteRequired = [
    'index.html', 'serve.mjs', 'docs/index.html', 'examples/index.html', 'examples/examples.js',
    'assets/site.css', 'assets/site.js', 'assets/md.js', 'assets/stage-kit.js', 'assets/favicon.svg',
  ];
  for (const rel of siteRequired) {
    if (!existsSync(join(site, rel))) {
      console.error('MISS site/' + rel);
      ok = false;
    }
  }
  // 示例注册表：浏览器脚本，用最小 window 桩读出来
  const winStub = {};
  vm.runInNewContext(readFileSync(join(site, 'examples', 'examples.js'), 'utf8'), { window: winStub });
  const Ex = winStub.MapStageExamples;
  for (const ex of Ex.list) {
    const file = join(site, 'examples', ex.id + '.html');
    if (!existsSync(file)) {
      console.error('MISS site/examples/' + ex.id + '.html (registered in examples.js)');
      ok = false;
      continue;
    }
    // 示例要能整份复制走：不引官网外壳和 stage-kit
    const html = readFileSync(file, 'utf8');
    for (const bad of ['assets/site.js', 'assets/site.css', 'stage-kit.js', 'examples.js']) {
      if (html.includes(bad)) {
        console.error('BAD site/examples/' + ex.id + '.html references ' + bad + '（示例只用正式运行时）');
        ok = false;
      }
    }
    if (!Ex.group(ex.group)) {
      console.error('BAD examples.js ' + ex.id + ': unknown group ' + ex.group);
      ok = false;
    }
  }
  const docsShell = readFileSync(join(site, 'docs', 'index.html'), 'utf8');
  const docFile = {};
  for (const m of docsShell.matchAll(/\['([\w-]+)', '[^']+', '([^']+\.md)'\]/g)) {
    docFile[m[1]] = m[2];
    if (!existsSync(join(root, '..', 'references', m[2]))) {
      console.error('MISS references/' + m[2] + ' (listed in docs sidebar)');
      ok = false;
    }
  }
  // 示例的 api / spec 链接必须落到文档里真实存在的 {#锚点}
  for (const ex of Ex.list) {
    const hrefs = (ex.api || []).map((n) => [n, Ex.apiHref(n)]).concat([['spec ' + ex.spec, Ex.specHref(ex.spec)]]);
    for (const [name, href] of hrefs) {
      const m = /^docs\/\?p=([^#]+)(?:#(.+))?$/.exec(href);
      const md = m && docFile[m[1]];
      const text = md && existsSync(join(root, '..', 'references', md)) ? readFileSync(join(root, '..', 'references', md), 'utf8') : null;
      if (!text || (m[2] && !text.includes('{#' + m[2] + '}'))) {
        console.error('BAD examples.js ' + ex.id + ': ' + name + ' → ' + href + ' 在文档里没有对应锚点');
        ok = false;
      }
    }
  }
  for (const test of ['md.test.mjs', 'stage-kit.test.mjs']) {
    const run = spawnSync(process.execPath, [join(site, 'assets', test)], { encoding: 'utf8' });
    if (run.stdout) process.stdout.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    if (run.status !== 0) {
      console.error('FAIL site/assets/' + test);
      ok = false;
    }
  }
  console.log('OK  site/ files, example pages, docs sources');
}

// Encoding guard: an editor round-trip (GBK / Latin-1) once turned CJK into
// U+FFFD or runs of '?' and ate the following quote or '<', silently breaking the
// whole inline tuner script. Catch that before it ships.
{
  // tuner/ + site/ + references/ + SKILL.md（含未提交的新文件），vendor 除外
  const pkg = join(root, '..');
  const textFiles = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.html', '*.js', '*.mjs', '*.cjs', '*.css', '*.json', '*.md', '*.yaml'],
    { cwd: pkg, encoding: 'utf8' }
  ).stdout.split('\n').filter((f) =>
    f && existsSync(join(pkg, f)) &&
    (/^(tuner|site|references|agents)\//.test(f) || f === 'SKILL.md') &&
    !f.startsWith('tuner/vendor/')
  );
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let encOk = true;
  for (const rel of textFiles) {
    const buf = readFileSync(join(pkg, rel));
    let text;
    try {
      text = decoder.decode(buf);
    } catch (e) {
      console.error('FAIL ' + rel + ' is not valid UTF-8');
      encOk = false;
      continue;
    }
    if (text.includes(String.fromCharCode(0xfffd)) || /[?]{4}/.test(text)) {
      console.error('FAIL ' + rel + ' contains U+FFFD or a run of 4+ question marks (mangled CJK)');
      encOk = false;
    }
    if (rel.endsWith('.html')) {
      const re = /<script>([\s\S]*?)<\/script>/g;
      let m;
      while ((m = re.exec(text))) {
        try {
          new vm.Script(m[1], { filename: rel });
        } catch (e) {
          console.error('FAIL ' + rel + ' inline <script> does not parse: ' + e.message);
          encOk = false;
        }
      }
    }
  }
  if (encOk) console.log('OK  ' + textFiles.length + ' text files are clean UTF-8; inline scripts parse');
  else ok = false;
}

if (!ok) {
  console.error('verify failed');
  process.exit(1);
}
console.log('verify ok');
process.exit(0);
