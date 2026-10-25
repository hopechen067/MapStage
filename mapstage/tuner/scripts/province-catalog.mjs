/**
 * Provincial isolate catalog (OSM admin polygons, ODbL).
 * Narrative silhouettes — not official boundaries.
 *
 * 34 provincial-level units + optional city extras (zhangye).
 */
export const PROVINCE_GROUPS = [
  { id: 'north', label: '华北' },
  { id: 'northeast', label: '东北' },
  { id: 'east', label: '华东' },
  { id: 'central', label: '中南' },
  { id: 'southwest', label: '西南' },
  { id: 'northwest', label: '西北' },
  { id: 'special', label: '港澳台' },
];

const LARGE = {
  minRingArea: 0.01,
  targetMin: 280,
  targetMax: 900,
  epsCandidates: [0.02, 0.03, 0.045, 0.06, 0.08],
};

const MEDIUM = {
  minRingArea: 0.004,
  targetMin: 180,
  targetMax: 640,
  epsCandidates: [0.012, 0.02, 0.03, 0.045, 0.06],
};

const SMALL = {
  minRingArea: 0.0008,
  targetMin: 80,
  targetMax: 360,
  epsCandidates: [0.004, 0.008, 0.012, 0.02, 0.03],
};

const TINY = {
  minRingArea: 0.00004,
  targetMin: 30,
  targetMax: 220,
  epsCandidates: [0.001, 0.002, 0.004, 0.008, 0.012],
};

function province(id, label, relId, group, size) {
  return {
    id: id,
    label: label,
    relId: relId,
    kind: 'province',
    group: group,
    cacheName: 'osm-' + id + '-R' + relId + '.geojson',
    minRingArea: size.minRingArea,
    targetMin: size.targetMin,
    targetMax: size.targetMax,
    epsCandidates: size.epsCandidates.slice(),
  };
}

/** OSM relation IDs from wiki.openstreetmap.org/wiki/Zh-hans:中华人民共和国 */
export const OSM_PROVINCES = [
  province('beijing', '北京', 912940, 'north', SMALL),
  province('tianjin', '天津', 912999, 'north', SMALL),
  province('hebei', '河北', 912998, 'north', LARGE),
  province('shanxi', '山西', 913105, 'north', MEDIUM),
  province('neimenggu', '内蒙古', 161349, 'north', LARGE),
  province('liaoning', '辽宁', 912942, 'northeast', MEDIUM),
  province('jilin', '吉林', 198590, 'northeast', MEDIUM),
  province('heilongjiang', '黑龙江', 199073, 'northeast', LARGE),
  province('shanghai', '上海', 913067, 'east', SMALL),
  province('jiangsu', '江苏', 913012, 'east', MEDIUM),
  province('zhejiang', '浙江', 553302, 'east', MEDIUM),
  province('anhui', '安徽', 913011, 'east', MEDIUM),
  province('fujian', '福建', 553303, 'east', MEDIUM),
  province('jiangxi', '江西', 913109, 'east', MEDIUM),
  province('shandong', '山东', 913006, 'east', MEDIUM),
  province('henan', '河南', 407492, 'central', MEDIUM),
  province('hubei', '湖北', 913106, 'central', MEDIUM),
  province('hunan', '湖南', 913073, 'central', MEDIUM),
  province('guangdong', '广东', 911844, 'central', MEDIUM),
  province('guangxi', '广西', 286342, 'central', MEDIUM),
  province('hainan', '海南', 2128285, 'central', SMALL),
  province('chongqing', '重庆', 913069, 'southwest', MEDIUM),
  province('sichuan', '四川', 913068, 'southwest', LARGE),
  province('guizhou', '贵州', 286937, 'southwest', MEDIUM),
  province('yunnan', '云南', 913094, 'southwest', LARGE),
  province('xizang', '西藏', 153292, 'southwest', LARGE),
  province('shaanxi', '陕西', 913100, 'northwest', MEDIUM),
  province('gansu', '甘肃', 153314, 'northwest', LARGE),
  province('qinghai', '青海', 153269, 'northwest', LARGE),
  province('ningxia', '宁夏', 913101, 'northwest', SMALL),
  province('xinjiang', '新疆', 153310, 'northwest', LARGE),
  province('hongkong', '香港', 913110, 'special', TINY),
  province('macao', '澳门', 1867188, 'special', TINY),
  province('taiwan', '台湾', 449220, 'special', MEDIUM),
];

export const OSM_CITIES = [
  {
    id: 'zhangye',
    label: '张掖',
    relId: 165803,
    kind: 'city',
    group: 'northwest',
    parentId: 'gansu',
    cacheName: 'osm-zhangye-R165803.geojson',
    minRingArea: 0.001,
    targetMin: 180,
    targetMax: 520,
    epsCandidates: [0.006, 0.01, 0.016, 0.024, 0.035],
  },
];

export const OSM_REGIONS = OSM_PROVINCES.concat(OSM_CITIES);

export const EXPECTED_PROVINCE_COUNT = 34;
