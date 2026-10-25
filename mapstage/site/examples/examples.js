/**
 * 示例注册表。每个示例 = examples/<id>.html 一个能单独打开、能整份复制走的页面；
 * 官网的 view.html?id=<id> 负责外壳（说明 + 活地图 + 源码 + 用到的 API）。
 * 新增示例：在 LIST 里加一行，再写同名 html（模板见 references/examples-guide.md）。
 * Browser: window.MapStageExamples
 */
(function () {
  'use strict';

  var GROUPS = [
    { id: 'look', title: '底图 Look', blurb: '古卷底图、皮肤、地形、图层开关、地球视角。' },
    { id: 'routes', title: '路线 Routes', blurb: '按里程推进的行军线、角色画法、弧线与真实线形。' },
    { id: 'labels', title: '地名 Labels', blurb: '地名三态、地点层级、位置不确定的「约」。' },
    { id: 'camera', title: '镜头 Camera', blurb: '按地点 / 路线自动取景，缓推与俯仰，一句一动。' },
    { id: 'cards', title: '字卡 Cards', blurb: '八种字卡版式，全部只取决于 t，逐帧可复现。' },
    { id: 'compliance', title: '合规 Compliance', blurb: '合规全图、十段线、自检与拒绝渲染。' },
    { id: 'stage', title: '舞台 Stage', blurb: '逐帧时间契约、预缓存、整段 story.json。' },
    { id: 'play', title: '游戏地图 Play', blurb: 'MapStageBoard：点选、城池、连线、行军动画。' },
  ];

  // api：用到的接口，写法 `MapStage.mount` / `stage.seek` / `MapStageBoard.create` / `board.setCities` /
  //      `AntiqueVectorPaint.applyVectorPaint` / `story.routes` 等，自动链到文档锚点
  // thumb：拍缩略图前 seek 到的时刻（有 __mapstageSeek 的示例）
  var LIST = [
    // ── 底图 ──
    { id: 'look-basic', group: 'look', title: '加载古卷底图',
      blurb: '一行 MapStage.buildStyle 拿到合规底图 style，交给 maplibregl.Map 就能用。',
      api: ['MapStage.buildStyle'], spec: 'look' },
    { id: 'skins', group: 'look', title: '切换古卷皮肤',
      blurb: '宣纸古卷、陈旧羊皮、墨色山水、绢本重彩、暗夜星图：story.look.skin 选一套，底图配色和画布调色一起换。',
      api: ['AntiqueVectorPaint.SKINS', 'story.look', 'MapStage.mount', 'stage.destroy'], spec: 'look#skins' },
    { id: 'look-preset', group: 'look', title: '用 preset.json 定调',
      blurb: '调参台导出的 preset 一并交给 MapStage.mount：色调、地形夸张、默认机位从它来；皮肤优先取 preset.ui.skinId。',
      api: ['MapStage.mount', 'preset'], spec: 'look', thumb: 0 },
    { id: 'look-basemap', group: 'look', title: '底图样式与夜景',
      blurb: 'story.look.basemap 选调参台的底图样式：自然、设色、古卷、水墨、青绿、夜景、暗夜。夜景的夜光是 GeoNames 模拟的，不是卫星实测。',
      api: ['story.look', 'MapStage.mount', 'MapStage.resolveLook'], spec: 'look#basemap', thumb: 5 },
    { id: 'terrain', group: 'look', title: '地形夸张',
      blurb: 'Mapterhorn DEM，真实海拔 1.0 到夸张 2.0 实时拖动；祁连山前看得到网格起伏。',
      api: ['MapStage.buildStyle', 'AntiqueMapFx.setTerrainEx'], spec: 'look#terrain' },
    { id: 'look-layers', group: 'look', title: '图层开关',
      blurb: '山影、道路、植被地表一键开关，录制时按镜头需要取舍。',
      api: ['AntiqueVectorPaint.setHillshade', 'AntiqueVectorPaint.setRoads', 'AntiqueVectorPaint.setLandcover'], spec: 'look' },
    { id: 'globe', group: 'look', title: '地球视角开场',
      blurb: 'MapLibre globe 投影做开场：从地球拉到中国，再切回平面地图录制。',
      api: ['MapStage.buildStyle'], spec: 'look#globe' },

    // ── 路线 ──
    { id: 'route-march', group: 'routes', title: '路线行进',
      blurb: '一条 primary 主线按里程匀速推进：全程淡底、已走实线、同色箭头，draw 窗口控制起止。',
      api: ['story.routes', 'MapStage.mount', 'stage.render'], spec: 'story#routes', thumb: 8 },
    { id: 'route-roles', group: 'routes', title: '路线角色画法',
      blurb: 'primary 实线加箭头、reaction 压力带、background 淡色静态线、residual 留到片尾。',
      api: ['story.routes'], spec: 'story#routes', thumb: 9 },
    { id: 'route-sides', group: 'routes', title: '四方配色',
      blurb: '颜色表示「谁的行动」：red / enemy / ally / neutral 四色固定，不按喜好换。',
      api: ['story.routes', 'MapStage.SIDE_COLORS'], spec: 'story#routes', thumb: 10 },
    { id: 'route-curve', group: 'routes', title: '弧线与真实线形',
      blurb: 'curve: auto 只给两点或近共线的路线加弧；河段、封锁线用 none 保持真实线形。',
      api: ['story.routes', 'MapStage.shapeRoute', 'MapStage.arc'], spec: 'story#routes', thumb: 7 },
    { id: 'route-hold', group: 'routes', title: '分段：hold 按段末收',
      blurb: '两段主线首尾相接，前一段的 hold 必须在后一段开画前收掉，不拖进下一段。',
      api: ['story.routes', 'MapStage.routeWindow'], spec: 'story#routes', thumb: 6 },
    { id: 'route-slice', group: 'routes', title: '自己画路线：sliceRoute',
      blurb: '不用 story 也能用纯函数：sliceRoute 给出已走部分、头部点、朝向和里程，自己接到任何图层上。',
      api: ['MapStage.sliceRoute', 'MapStage.haversineKm', 'MapStage.smoothstep'], spec: 'api-story#mapstage-sliceroute' },

    // ── 地名 ──
    { id: 'labels', group: 'labels', title: '地名三态',
      blurb: '地名出现后不卸载，只在 dim 未讲 / active 当句 / normal 讲过之间切换。',
      api: ['story.beats', 'MapStage.labelStates'], spec: 'story#labels', thumb: 6 },
    { id: 'labels-tiers', group: 'labels', title: '地点层级 tier',
      blurb: 'capital / large / medium / small / pass / station / ordos 七级，决定字号与图标。',
      api: ['story.sites'], spec: 'story#sites', thumb: 0 },
    { id: 'labels-approx', group: 'labels', title: '可信度与「约」',
      blurb: 'confidence C 必须 approx: true，标签自动加「约」；label.side 让两个近点左右避让。',
      api: ['story.sites', 'MapStage.lintStory'], spec: 'story#sites', thumb: 0 },

    // ── 镜头 ──
    { id: 'camera-fit', group: 'camera', title: '按地点自动取景',
      blurb: '勾选几个地点，按安全区（SAFE_AREA，上下留给字幕和字卡）反算机位；不用手写 center / zoom。',
      api: ['MapStage.safePadding', 'MapStage.bbox', 'MapStage.SAFE_AREA'], spec: 'camera#fit' },
    { id: 'camera-route', group: 'camera', title: '按路线取景与 maxSpan',
      blurb: 'fit: "route:<id>" 框住整条路线；maxSpan 给画面横向跨度设上限（km），超出时宁可裁掉两端也不再拉远。',
      api: ['story.shots'], spec: 'story#shots', thumb: 9 },
    { id: 'camera-push', group: 'camera', title: '一句一动：move / push / tilt',
      blurb: '镜头在 t - move 到 t 之间完成移动，到位后停稳缓推，push 推 zoom、tilt 加俯仰。',
      api: ['story.shots', 'MapStage.cameraAt'], spec: 'camera#one-move', thumb: 5 },
    { id: 'camera-manual', group: 'camera', title: '手写机位',
      blurb: '需要精确构图时直接给 center / zoom / pitch / bearing，和 fit 镜头可以混用。',
      api: ['story.shots', 'AntiqueMapFx.readView'], spec: 'story#shots', thumb: 7 },

    // ── 字卡 ──
    { id: 'cards-basic', group: 'cards', title: '地名卡、名牌、印章、大字',
      blurb: 'place / name / stamp / pair 四种基础字卡，不透明、无 transition。',
      api: ['story.cards'], spec: 'story#cards', thumb: 1 },
    { id: 'cards-table', group: 'cards', title: '速查表 table',
      blurb: '表头常亮，格子在窗口前 70% 逐格点亮，之后整表定格。',
      api: ['story.cards'], spec: 'story#cards', thumb: 6 },
    { id: 'cards-telegram', group: 'cards', title: '电报 telegram',
      blurb: '报头条 + 等宽字，电文在窗口前 60% 逐字出现，之后整段定格。',
      api: ['story.cards'], spec: 'story#cards', thumb: 5 },
    { id: 'cards-doc-photo', group: 'cards', title: '文献 doc 与照片 photo',
      blurb: '红头文献带落款和印章；照片卡带「资料照」角标，图没加载完 seek 不放行。',
      api: ['story.cards', 'stage.seek'], spec: 'story#cards', thumb: 2 },

    // ── 合规 ──
    { id: 'compliance', group: 'compliance', title: '合规全图',
      blurb: '不画省界国界、不加雾化暗角，台湾、海南、南海诸岛与海岸线完整的全国视角。',
      api: ['MapStage.buildStyle', 'MapStage.complianceCheck', 'MapStage.COMPLIANCE_POINTS'], spec: 'compliance' },
    { id: 'compliance-full', group: 'compliance', title: '全图时段与十段线',
      blurb: 'compliance.full 标出全国视角的时段：十段线只在这些时段出现，mount 时逐秒自检。',
      api: ['story.compliance', 'MapStage.mount'], spec: 'compliance', thumb: 1 },
    { id: 'stage-check', group: 'compliance', title: '逐时刻自检 stage.check',
      blurb: '拖到任意时刻，stage.check(t) 同步给出合规项与同屏计数，宿主可以逐帧跑。',
      api: ['stage.check'], spec: 'compliance', thumb: 4 },
    { id: 'validate', group: 'compliance', title: '校验不过就拒绝渲染',
      blurb: '引用缺失、C 级没标约、同屏超限、hold 越段、镜头太密，validateStory 一次列全。',
      api: ['MapStage.validateStory', 'MapStage.lintStory'], spec: 'story', thumb: 0 },

    // ── 舞台 ──
    { id: 'seek-contract', group: 'stage', title: '逐帧时间契约',
      blurb: '__mapstageSeek(t) 等地图 idle 才返回：同一个 t 永远是同一帧，直接拼出联系表。',
      api: ['stage.seek', 'window.__mapstageSeek'], spec: 'hosts#seek', thumb: 10 },
    { id: 'precache', group: 'stage', title: '预缓存与正倒序一致',
      blurb: '先 precache() 走一遍所有机位，再正序、倒序各拍一遍，逐像素比较。',
      api: ['stage.precache', 'stage.seek'], spec: 'hosts#seek', thumb: 8 },
    { id: 'story-hexi', group: 'stage', title: '一份 story.json 出整段',
      blurb: '武威 → 敦煌：地点、路线、地名节拍、镜头、字卡全在 story.json 里，页面没有一行手写机位。',
      api: ['MapStage.mount', 'stage.precache', 'stage.seek'], spec: 'story', thumb: 8 },

    // ── 游戏 ──
    { id: 'board-basic', group: 'play', title: '游戏地图最小用法',
      blurb: 'MapStageBoard.create 一张地图，点城换色、计数，状态变了整体重画。',
      api: ['MapStageBoard.create', 'board.setCities', 'board.on'], spec: 'play#quickstart' },
    { id: 'board-cities', group: 'play', title: '城池圈、徽标与选中环',
      blurb: 'setCities 的 color / value / badge / ring / label 五个字段各自管什么。',
      api: ['board.setCities', 'board.getCity', 'MapStageBoard.RINGS'], spec: 'play' },
    { id: 'board-links', group: 'play', title: '连线与相邻关系',
      blurb: 'links 定义相邻关系，setLinks 按两端状态给连线上色，neighbors 查可达城池。',
      api: ['board.setLinks', 'board.neighbors'], spec: 'play' },
    { id: 'board-march', group: 'play', title: '行军动画与镜头',
      blurb: 'board.march 画一条推进线后收起，board.focus 推镜头，board.fit 回全局。',
      api: ['board.march', 'board.focus', 'board.fit'], spec: 'play' },
    { id: 'board-hover', group: 'play', title: '悬停提示与点选',
      blurb: 'hover 事件做信息卡，pick 事件做选择；回调里 id 为 null 表示点在空地。',
      api: ['board.on'], spec: 'play' },
    { id: 'play-sanguo', group: 'play', title: '三分天下 · 回合制原型',
      blurb: '用 MapStageBoard 搭的完整小游戏：征兵、调兵、攻城，魏吴电脑行动。规则是页面自己的。',
      api: ['MapStageBoard.create', 'board.setCities', 'board.march'], spec: 'play' },
  ];

  var GROUP_BY_ID = {};
  GROUPS.forEach(function (g) { GROUP_BY_ID[g.id] = g; });

  function byId(id) {
    return LIST.filter(function (e) { return e.id === id; })[0];
  }

  /** API 名 → 文档链接（相对 site 根） */
  var API_PAGE = {
    MapStage: 'api-story', stage: 'api-story', story: 'story', preset: 'look', window: 'hosts',
    MapStageBoard: 'api-board', board: 'api-board',
    AntiqueVectorPaint: 'api-look', AntiqueMapFx: 'api-look',
  };
  var STORY_ANCHOR = { look: 'look', sites: 'sites', routes: 'routes', beats: 'labels', shots: 'shots', cards: 'cards', compliance: 'compliance' };
  function apiHref(name) {
    var head = name.split('.')[0];
    var page = API_PAGE[head] || 'api';
    var anchor;
    if (head === 'story') anchor = STORY_ANCHOR[name.split('.')[1]] || '';
    else if (head === 'preset') anchor = '';
    else if (head === 'window') anchor = 'seek';
    else anchor = name.toLowerCase().replace(/\./g, '-');
    return 'docs/?p=' + page + (anchor ? '#' + anchor : '');
  }

  function specHref(spec) {
    var parts = spec.split('#');
    return 'docs/?p=' + parts[0] + (parts[1] ? '#' + parts[1] : '');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 示例库卡片；base = examples/ 目录的相对路径 */
  function card(ex, base) {
    base = base || '';
    var a = document.createElement('a');
    a.className = 'ex-card';
    a.href = base + 'view.html?id=' + ex.id;
    a.setAttribute('data-group', ex.group);
    a.innerHTML =
      '<div class="thumb" style="background-image:url(' + base + 'thumbs/' + ex.id + '.jpg)"></div>' +
      '<div class="body"><h3>' + esc(ex.title) + '</h3><p>' + esc(ex.blurb) + '</p>' +
      '<span class="layer">' + esc(GROUP_BY_ID[ex.group].title) + '</span></div>';
    return a;
  }

  /** 搜索：标题、简介、API 名、分组名 */
  function matches(ex, q) {
    if (!q) return true;
    var hay = [ex.id, ex.title, ex.blurb, GROUP_BY_ID[ex.group].title].concat(ex.api || []).join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  /** 示例在 api 名下的反查：文档页「示例」区用 */
  function usingApi(name) {
    return LIST.filter(function (e) { return (e.api || []).indexOf(name) >= 0; });
  }

  window.MapStageExamples = {
    groups: GROUPS, group: function (id) { return GROUP_BY_ID[id]; },
    list: LIST, byId: byId, card: card, matches: matches, usingApi: usingApi,
    apiHref: apiHref, specHref: specHref, esc: esc,
  };
})();
