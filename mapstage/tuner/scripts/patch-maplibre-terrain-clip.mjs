/**
 * Patch MapLibre GL JS 5.6.0-dev so terrain fragments outside a clip
 * texture are discarded, and getRenderableTiles can skip exterior tiles.
 *
 * Input:  mapstage/.cache/maplibre/maplibre-gl-dev.js
 * Output: mapstage/tuner/vendor/maplibre-gl.js
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(root, '.cache', 'maplibre', 'maplibre-gl-dev.js');
const destDir = join(root, 'tuner', 'vendor');
const dest = join(destDir, 'maplibre-gl.js');

const CLIP_FRAG_PREFIX =
  'uniform sampler2D u_clip;uniform highp float u_clip_enabled;uniform highp vec2 u_clip_origin;uniform highp vec2 u_clip_size;uniform highp float u_clip_drop;uniform vec4 u_clip_side_color;in highp vec2 v_mercator;in float v_clip;in float v_drop;in highp float v_drop_w;in highp float v_clip_w;in float v_skirt;';
const CLIP_FRAG_PREFIX_DROP_W =
  'uniform sampler2D u_clip;uniform highp float u_clip_enabled;uniform highp vec2 u_clip_origin;uniform highp vec2 u_clip_size;uniform highp float u_clip_drop;uniform vec4 u_clip_side_color;in highp vec2 v_mercator;in float v_clip;in float v_drop;in float v_drop_w;in float v_skirt;';
const CLIP_FRAG_PREFIX_OLD =
  'uniform sampler2D u_clip;uniform highp float u_clip_enabled;uniform highp vec2 u_clip_origin;uniform highp vec2 u_clip_size;uniform vec4 u_clip_side_color;in highp vec2 v_mercator;in float v_clip;in float v_drop;in float v_skirt;';
const CLIP_FRAG_PREFIX_MED =
  'uniform sampler2D u_clip;uniform highp float u_clip_enabled;uniform highp vec2 u_clip_origin;uniform highp vec2 u_clip_size;uniform float u_clip_drop;uniform vec4 u_clip_side_color;in highp vec2 v_mercator;in float v_clip;in float v_drop;in float v_skirt;';
const CLIP_FRAG_PREFIX_PERSP =
  'uniform sampler2D u_clip;uniform highp float u_clip_enabled;uniform highp vec2 u_clip_origin;uniform highp vec2 u_clip_size;uniform highp float u_clip_drop;uniform vec4 u_clip_side_color;in highp vec2 v_mercator;in float v_clip;in float v_drop;in float v_skirt;';
const CLIP_FRAG_PREFIX_NOPERSP =
  'uniform sampler2D u_clip;uniform highp float u_clip_enabled;uniform highp vec2 u_clip_origin;uniform highp vec2 u_clip_size;uniform highp float u_clip_drop;uniform vec4 u_clip_side_color;in highp vec2 v_mercator;in float v_clip;noperspective in float v_drop;in float v_skirt;';
const FOG_IF =
  'if (!u_is_globe_mode && v_fog_depth > u_fog_ground_blend)';
const FOG_IF_SKIP_WALL =
  'if (!wall&&!u_is_globe_mode && v_fog_depth > u_fog_ground_blend)';
const CLIP_DISCARD_WALL =
  'float dg=fwidth(v_drop);float cg=fwidth(v_clip);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool inBox=cuf.x>=0.0&&cuf.y>=0.0&&cuf.x<=1.0&&cuf.y<=1.0;float cr=inBox?texture(u_clip,cuf).r:0.0;bool outside=u_clip_enabled>0.5&&cr<0.5;bool wall=u_clip_enabled>0.5&&(dg>0.05||cg>0.08||(v_drop>0.5&&!outside)||v_skirt>0.5);if(outside&&!wall)discard;';
const CLIP_VERT_SAMPLE_DROP_SKIRT =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));float cr=(cu.x<0.0||cu.y<0.0||cu.x>1.0||cu.y>1.0)?0.0:texture(u_clip,cu).r;v_clip=cr>=0.5?1.0:0.0;if(v_clip<0.5){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
// Live discard: outside fragments always go away. Mesh drop/fwidth walls
// built a DEM-tile AABB cake; side walls are a separate custom layer.
const CLIP_DISCARD_DROP_ONLY =
  'float dg=fwidth(v_drop);bool wall=u_clip_enabled>0.5&&dg>0.05;if(u_clip_enabled>0.5&&!wall){vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));if(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5)discard;}';
const CLIP_DISCARD_CONTOUR =
  'float dg=fwidth(v_drop);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool inBox=cuf.x>=0.0&&cuf.y>=0.0&&cuf.x<=1.0&&cuf.y<=1.0;float cr=inBox?texture(u_clip,cuf).r:0.0;bool outside=u_clip_enabled>0.5&&(!inBox||cr<0.5);bool wall=outside&&dg>0.05;if(outside&&!wall)discard;';
const CLIP_DISCARD_NO_RIM =
  'float dg=fwidth(v_drop);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool outside=u_clip_enabled>0.5&&(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5);bool wall=u_clip_enabled>0.5&&v_skirt<0.5&&outside&&dg>0.05;if(outside&&!wall)discard;';
const CLIP_DISCARD_RAMP_TILEBOX =
  'float dg=fwidth(v_drop);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool outside=u_clip_enabled>0.5&&(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5);bool mixed=dg>0.05;if(outside&&(v_skirt>0.5||!mixed))discard;bool wall=u_clip_enabled>0.5&&v_skirt<0.5&&mixed&&v_drop>80.0;';
// Skirt triangles interpolate v_skirt 0→1. Keeping v_skirt<0.5 mixed
// fragments paints a 12 km wall on every DEM tile edge (nested AABB
// boxes around the island). Discard any outside fragment that belongs
// to a skirt triangle; only pure surface mixed tris are island walls.
const CLIP_DISCARD_RAMP =
  'float dg=fwidth(v_drop);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool outside=u_clip_enabled>0.5&&(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5);bool mixed=dg>0.05;bool skirt=v_skirt>0.001;if(outside&&(skirt||!mixed))discard;bool wall=u_clip_enabled>0.5&&!skirt&&mixed&&v_drop>80.0;';
// Island side wall: keep every mixed triangle, including DEM tile
// skirts that straddle the clip. Discarding those punched holes in
// the drop-down face at every tile edge (sawtooth + 烂面). Fully
// outside skirts now drop too, so they are not mixed and do not
// rebuild the AABB cake.
const CLIP_DISCARD_SKIRT_WALL_V1 =
  'float dg=fwidth(v_drop);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool outside=u_clip_enabled>0.5&&(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5);bool mixed=dg>0.05;if(outside&&!mixed)discard;bool wall=u_clip_enabled>0.5&&mixed&&v_drop>80.0;';
// Discard stays mixed-floor (FM-0902-23). Wall tint uses affine drop:
// VS writes v_drop*clip.w and clip.w; FS divides so UV is screen-linear
// without gl_FragCoord.w (SwiftShader does not report 1/clip.w).
const CLIP_DISCARD_SKIRT_WALL_FC =
  'float dg=fwidth(v_drop);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool outside=u_clip_enabled>0.5&&(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5);bool mixed=dg>0.05;if(outside&&!mixed)discard;float drop=v_drop_w*gl_FragCoord.w;bool wall=u_clip_enabled>0.5&&drop>80.0;';
const CLIP_DISCARD_SKIRT_WALL_METERS =
  'float dg=fwidth(v_drop);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool outside=u_clip_enabled>0.5&&(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5);bool mixed=dg>0.05;if(outside&&!mixed)discard;float drop=v_drop_w/max(v_clip_w,1.0e-12);bool wall=u_clip_enabled>0.5&&drop>80.0;';
// FM-0902-46: wall flag is 0-1 shade, not meters. Discard used fwidth mixed
// so convex cape chords stayed mesh polylines. Affine drop is the wall.
const CLIP_DISCARD_SKIRT_WALL_FWIDTH =
  'float dg=fwidth(v_drop);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool outside=u_clip_enabled>0.5&&(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5);bool mixed=dg>0.05;if(outside&&!mixed)discard;float drop=v_drop_w/max(v_clip_w,1.0e-12);bool wall=u_clip_enabled>0.5&&drop>0.004;';
// FM-0903-14: mesh mixed-floor is the visible skirt (PR7). Discard only
// fully-outside fragments so drop-down faces stay solid. Overlay walls
// are not the live rim — they sat on the block top as a pale fence.
const CLIP_DISCARD_SKIRT_WALL =
  'float dg=fwidth(v_drop);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool outside=u_clip_enabled>0.5&&(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5);bool mixed=dg>0.05;if(outside&&!mixed)discard;float drop=v_drop_w/max(v_clip_w,1.0e-12);bool wall=u_clip_enabled>0.5&&drop>0.004;';
const CLIP_VERT_SAMPLE_NOSKIRT =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));float cr=(cu.x<0.0||cu.y<0.0||cu.x>1.0||cu.y>1.0)?0.0:texture(u_clip,cu).r;v_clip=cr>=0.5?1.0:0.0;if(v_clip<0.5&&a_pos3d.z<0.5){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
const CLIP_VERT_SAMPLE_DROP =
  'vec2 p2=a_pos3d.xy;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));float cr=(cu.x<0.0||cu.y<0.0||cu.x>1.0||cu.y>1.0)?0.0:texture(u_clip,cu).r;v_clip=cr>=0.5?1.0:0.0;if(v_clip<0.5){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
const CLIP_DISCARD_RIM =
  'float dg=fwidth(v_drop);float cg=fwidth(v_clip);vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool inBox=cuf.x>=0.0&&cuf.y>=0.0&&cuf.x<=1.0&&cuf.y<=1.0;float cr=inBox?texture(u_clip,cuf).r:0.0;bool outside=u_clip_enabled>0.5&&cr<0.5;vec2 e=max(fwidth(cuf),vec2(1.0e-5))*2.5;bool rim=u_clip_enabled>0.5&&v_skirt>0.5&&cr>=0.5&&(texture(u_clip,clamp(cuf+vec2(e.x,0.0),0.0,1.0)).r<0.5||texture(u_clip,clamp(cuf-vec2(e.x,0.0),0.0,1.0)).r<0.5||texture(u_clip,clamp(cuf+vec2(0.0,e.y),0.0,1.0)).r<0.5||texture(u_clip,clamp(cuf-vec2(0.0,e.y),0.0,1.0)).r<0.5);bool wall=u_clip_enabled>0.5&&(dg>0.05||cg>0.08||(v_drop>0.5&&!outside)||rim);if(outside&&!wall)discard;';
const CLIP_DISCARD_ALWAYS =
  'if(u_clip_enabled>0.5){vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));if(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5)discard;}';
const CLIP_DISCARD_MIXED =
  'float dg=fwidth(v_drop);bool wall=u_clip_enabled>0.5&&dg>0.05;if(u_clip_enabled>0.5&&v_clip<0.5&&!wall)discard;';
// Tuned look: drop-all-outside verts (surface + stitch skirts) make
// the side wall. Discard the constant-v_drop floor. Mixed skirt
// triangles at the clip contour are the island wall at tile edges.
const CLIP_DISCARD = CLIP_DISCARD_SKIRT_WALL;
const CLIP_DISCARD_OLD = 'if(u_clip_enabled>0.5&&v_clip<0.001)discard;';
const CLIP_DISCARD_DROP =
  'if(u_clip_enabled>0.5&&v_drop<0.5){vec2 cuf=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));if(cuf.x<0.0||cuf.y<0.0||cuf.x>1.0||cuf.y>1.0||texture(u_clip,cuf).r<0.5)discard;}';
const CLIP_SIDE_TINT_FW =
  'if(wall){float shade=mix(1.0,0.30,clamp(v_drop/2800.0,0.0,1.0));surface_color=vec4(u_clip_side_color.rgb*shade,u_clip_side_color.a);}';
const CLIP_SIDE_TINT_SHADE =
  'if(wall){float shade=mix(1.0,0.30,clamp(max(v_drop,1.0)/2800.0,0.0,1.0));surface_color=vec4(u_clip_side_color.rgb*shade,u_clip_side_color.a);}';
// Location strata on mixed walls only (skirt + rectangular cut faces).
// UV 0 = top rim, 1 = skirt bottom, from affine-reconstructed drop so
// 15/25/60 is screen-linear. Clip G = water-facing rim.
// Bay/water: 0–0.15 mud #3D5348, 0.15–0.40 clay #A67C52, 0.40–1 bedrock #3A2E24.
// Inland/cape palette is unchanged. Fog/sky/horizon do not tint walls.
const CLIP_SIDE_TINT_V1 =
  'if(wall){float uv=clamp(v_drop/max(u_clip_drop,1.0),0.0,1.0);vec2 e=max(fwidth(cuf),vec2(1.0e-5));vec2 gr=vec2(texture(u_clip,clamp(cuf+vec2(e.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cuf-vec2(e.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cuf+vec2(0.0,e.y),0.0,1.0)).r-texture(u_clip,clamp(cuf-vec2(0.0,e.y),0.0,1.0)).r);float g2=dot(gr,gr);vec2 od=g2>1.0e-12?-gr*inversesqrt(g2):vec2(0.0);float water=texture(u_clip,clamp(cuf+od*max(e,vec2(1.0e-4))*3.0,0.0,1.0)).g;float n=fract(sin(dot(cuf,vec2(127.1,311.7)))*43758.5453);uv=clamp(uv+0.044*(cuf.x+cuf.y*0.35-0.7)+0.02*(n-0.5),0.0,1.0);vec3 rock=vec3(58.0,46.0,36.0)/255.0;vec3 c;float b0;float b1;if(water>0.5){b0=0.15;b1=0.40;c=uv<b0?vec3(61.0,83.0,72.0)/255.0:uv<b1?vec3(166.0,124.0,82.0)/255.0:rock;}else{b0=0.10;b1=0.30;c=uv<b0?vec3(196.0,160.0,106.0)/255.0:uv<b1?vec3(139.0,115.0,85.0)/255.0:rock;}float fw=max(fwidth(uv),1.0e-6);float line=max(1.0-smoothstep(0.0,fw,abs(uv-b0)),1.0-smoothstep(0.0,fw,abs(uv-b1)));c=mix(c,vec3(26.0,20.0,16.0)/255.0,line);surface_color=vec4(c,1.0);}';
const CLIP_SIDE_TINT_GEOM =
  'if(wall){float uv=clamp(drop/max(u_clip_drop,1.0),0.0,1.0);vec2 e=max(fwidth(cuf),vec2(1.0e-5));vec2 gr=vec2(texture(u_clip,clamp(cuf+vec2(e.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cuf-vec2(e.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cuf+vec2(0.0,e.y),0.0,1.0)).r-texture(u_clip,clamp(cuf-vec2(0.0,e.y),0.0,1.0)).r);float g2=dot(gr,gr);vec2 od=g2>1.0e-12?-gr*inversesqrt(g2):vec2(0.0);float water=texture(u_clip,clamp(cuf+od*max(e,vec2(1.0e-4))*3.0,0.0,1.0)).g;float n=fract(sin(dot(cuf,vec2(127.1,311.7)))*43758.5453);uv=clamp(uv+0.044*(cuf.x+cuf.y*0.35-0.7)+0.02*(n-0.5),0.0,1.0);vec3 rock=vec3(58.0,46.0,36.0)/255.0;vec3 c;float b0;float b1;if(water>0.5){b0=0.15;b1=0.40;c=uv<b0?vec3(61.0,83.0,72.0)/255.0:uv<b1?vec3(166.0,124.0,82.0)/255.0:rock;}else{b0=0.10;b1=0.30;c=uv<b0?vec3(196.0,160.0,106.0)/255.0:uv<b1?vec3(139.0,115.0,85.0)/255.0:rock;}float fw=max(fwidth(uv),1.0e-6);float line=max(1.0-smoothstep(0.0,fw,abs(uv-b0)),1.0-smoothstep(0.0,fw,abs(uv-b1)));c=mix(c,vec3(26.0,20.0,16.0)/255.0,line);surface_color=vec4(c,1.0);}';
// FM-0902-46: drop is already 0-1 wall shade. Dividing by u_clip_drop
// (18–100 km) crushed the stack to ~0 and let satellite water tint the face.
const CLIP_SIDE_TINT_SHADE01 =
  'if(wall){float uv=clamp(drop,0.0,1.0);vec2 e=max(fwidth(cuf),vec2(1.0e-5));vec2 gr=vec2(texture(u_clip,clamp(cuf+vec2(e.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cuf-vec2(e.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cuf+vec2(0.0,e.y),0.0,1.0)).r-texture(u_clip,clamp(cuf-vec2(0.0,e.y),0.0,1.0)).r);float g2=dot(gr,gr);vec2 od=g2>1.0e-12?-gr*inversesqrt(g2):vec2(0.0);float water=texture(u_clip,clamp(cuf+od*max(e,vec2(1.0e-4))*3.0,0.0,1.0)).g;float n=fract(sin(dot(cuf,vec2(127.1,311.7)))*43758.5453);uv=clamp(uv+0.044*(cuf.x+cuf.y*0.35-0.7)+0.02*(n-0.5),0.0,1.0);vec3 rock=vec3(58.0,46.0,36.0)/255.0;vec3 c;float b0;float b1;if(water>0.5){b0=0.15;b1=0.40;c=uv<b0?vec3(61.0,83.0,72.0)/255.0:uv<b1?vec3(166.0,124.0,82.0)/255.0:rock;}else{b0=0.10;b1=0.30;c=uv<b0?vec3(196.0,160.0,106.0)/255.0:uv<b1?vec3(139.0,115.0,85.0)/255.0:rock;}float fw=max(fwidth(uv),1.0e-6);float line=max(1.0-smoothstep(0.0,fw,abs(uv-b0)),1.0-smoothstep(0.0,fw,abs(uv-b1)));c=mix(c,vec3(26.0,20.0,16.0)/255.0,line);surface_color=vec4(c,1.0);}';
// Affine drop/u_clip_drop already spans ~0–1 on the visible bay wall.
// uv*4 crushed mud/clay into bedrock (FM-0902-41).
const CLIP_SIDE_TINT_DFy_INWALL =
  'if(wall){float uv=clamp(drop/max(u_clip_drop,1.0),0.0,1.0);float dy=dFdy(uv);float uvb=clamp(uv-dy*gl_FragCoord.y,max(uv,1.0e-4),1.0);uv=clamp(uv/uvb,0.0,1.0);vec2 e=max(fwidth(cuf),vec2(1.0e-5));vec2 gr=vec2(texture(u_clip,clamp(cuf+vec2(e.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cuf-vec2(e.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cuf+vec2(0.0,e.y),0.0,1.0)).r-texture(u_clip,clamp(cuf-vec2(0.0,e.y),0.0,1.0)).r);float g2=dot(gr,gr);vec2 od=g2>1.0e-12?-gr*inversesqrt(g2):vec2(0.0);float water=texture(u_clip,clamp(cuf+od*max(e,vec2(1.0e-4))*3.0,0.0,1.0)).g;float n=fract(sin(dot(cuf,vec2(127.1,311.7)))*43758.5453);uv=clamp(uv+0.044*(cuf.x+cuf.y*0.35-0.7)+0.02*(n-0.5),0.0,1.0);vec3 rock=vec3(58.0,46.0,36.0)/255.0;vec3 c;float b0;float b1;if(water>0.5){b0=0.15;b1=0.40;c=uv<b0?vec3(61.0,83.0,72.0)/255.0:uv<b1?vec3(166.0,124.0,82.0)/255.0:rock;}else{b0=0.10;b1=0.30;c=uv<b0?vec3(196.0,160.0,106.0)/255.0:uv<b1?vec3(139.0,115.0,85.0)/255.0:rock;}float fw=max(fwidth(uv),1.0e-6);float line=max(1.0-smoothstep(0.0,fw,abs(uv-b0)),1.0-smoothstep(0.0,fw,abs(uv-b1)));c=mix(c,vec3(26.0,20.0,16.0)/255.0,line);surface_color=vec4(c,1.0);}';
const CLIP_SIDE_TINT_X4 =
  'if(wall){float uv=clamp(drop/max(u_clip_drop,1.0),0.0,1.0);uv=clamp(uv*4.0,0.0,1.0);vec2 e=max(fwidth(cuf),vec2(1.0e-5));vec2 gr=vec2(texture(u_clip,clamp(cuf+vec2(e.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cuf-vec2(e.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cuf+vec2(0.0,e.y),0.0,1.0)).r-texture(u_clip,clamp(cuf-vec2(0.0,e.y),0.0,1.0)).r);float g2=dot(gr,gr);vec2 od=g2>1.0e-12?-gr*inversesqrt(g2):vec2(0.0);float water=texture(u_clip,clamp(cuf+od*max(e,vec2(1.0e-4))*3.0,0.0,1.0)).g;float n=fract(sin(dot(cuf,vec2(127.1,311.7)))*43758.5453);uv=clamp(uv+0.044*(cuf.x+cuf.y*0.35-0.7)+0.02*(n-0.5),0.0,1.0);vec3 rock=vec3(58.0,46.0,36.0)/255.0;vec3 c;float b0;float b1;if(water>0.5){b0=0.15;b1=0.40;c=uv<b0?vec3(61.0,83.0,72.0)/255.0:uv<b1?vec3(166.0,124.0,82.0)/255.0:rock;}else{b0=0.10;b1=0.30;c=uv<b0?vec3(196.0,160.0,106.0)/255.0:uv<b1?vec3(139.0,115.0,85.0)/255.0:rock;}float fw=max(fwidth(uv),1.0e-6);float line=max(1.0-smoothstep(0.0,fw,abs(uv-b0)),1.0-smoothstep(0.0,fw,abs(uv-b1)));c=mix(c,vec3(26.0,20.0,16.0)/255.0,line);surface_color=vec4(c,1.0);}';
const CLIP_SIDE_TINT = CLIP_SIDE_TINT_SHADE01;
const CLIP_SIDE_TINT_DROP =
  'if(u_clip_enabled>0.5&&v_drop>0.5){float shade=mix(1.0,0.30,clamp(v_drop/2800.0,0.0,1.0));surface_color=vec4(u_clip_side_color.rgb*shade,u_clip_side_color.a);}';
const CLIP_SIDE_TINT_OLD =
  'if(u_clip_enabled>0.5&&v_clip<0.999){surface_color=mix(u_clip_side_color,surface_color,smoothstep(0.72,1.0,v_clip));}';
const CLIP_VERT_UNIFORMS =
  'uniform sampler2D u_clip;uniform highp vec2 u_clip_origin;uniform highp vec2 u_clip_size;uniform highp float u_clip_drop;uniform highp vec2 u_clip_texels;';
// Vertex textures often ignore LINEAR. 4-tap at texel centers rebuilds
// the 0.5 iso so rim snap follows the AA contour, not NEAREST stairs.
const CLIP_VERT_HELPER_BI =
  'float antiqueClipBi(vec2 uv){vec2 tsz=max(u_clip_texels,vec2(1.0));vec2 tex=1.0/tsz;vec2 p=clamp(uv,0.0,1.0)*tsz-0.5;vec2 i0=floor(p);vec2 f=fract(p);vec2 c0=(i0+0.5)*tex;float s00=texture(u_clip,clamp(c0,0.0,1.0)).r;float s10=texture(u_clip,clamp(c0+vec2(tex.x,0.0),0.0,1.0)).r;float s01=texture(u_clip,clamp(c0+vec2(0.0,tex.y),0.0,1.0)).r;float s11=texture(u_clip,clamp(c0+tex,0.0,1.0)).r;return mix(mix(s00,s10,f.x),mix(s01,s11,f.x),f.y);}';
const CLIP_VERT_HELPER_SOBEL =
  'vec2 antiqueClipSobel(vec2 uv,vec2 st){float tl=antiqueClipBi(uv+vec2(-st.x,-st.y));float t=antiqueClipBi(uv+vec2(0.0,-st.y));float tr=antiqueClipBi(uv+vec2(st.x,-st.y));float l=antiqueClipBi(uv+vec2(-st.x,0.0));float r=antiqueClipBi(uv+vec2(st.x,0.0));float bl=antiqueClipBi(uv+vec2(-st.x,st.y));float b=antiqueClipBi(uv+vec2(0.0,st.y));float br=antiqueClipBi(uv+vec2(st.x,st.y));return vec2((tr+2.0*r+br)-(tl+2.0*l+bl),(bl+2.0*b+br)-(tl+2.0*t+tr));}';
const CLIP_VERT_HELPER = CLIP_VERT_HELPER_BI + CLIP_VERT_HELPER_SOBEL;
const CLIP_VERT_SAMPLE_SOLID =
  'v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));float cr=(cu.x<0.0||cu.y<0.0||cu.x>1.0||cu.y>1.0)?0.0:texture(u_clip,cu).r;v_clip=cr>=0.5?1.0:0.0;if(v_clip<0.5){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
const CLIP_VERT_SAMPLE_SNAP_ALL =
  'vec2 p2=a_pos3d.xy;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 duv=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));float cr=(cu.x<0.0||cu.y<0.0||cu.x>1.0||cu.y>1.0)?0.0:texture(u_clip,cu).r;if(cu.x>=0.0&&cu.y>=0.0&&cu.x<=1.0&&cu.y<=1.0){vec2 g=vec2(texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r);float g2=dot(g,g);if(g2>1.0e-8){vec2 dir=g*inversesqrt(g2);if(cr>=0.5)dir=-dir;float lo=0.0;float hi=1.85;for(int i=0;i<8;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(duv*mid);float s=(t.x<0.0||t.y<0.0||t.x>1.0||t.y>1.0)?0.0:texture(u_clip,t).r;if(cr>=0.5){if(s>0.5)lo=mid;else hi=mid;}else{if(s<0.5)lo=mid;else hi=mid;}}cu=cu+dir*(duv*hi);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}}v_clip=cr>=0.5?1.0:0.0;if(v_clip<0.5){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
const CLIP_VERT_SAMPLE_SNAP_OUTSIDE =
  'vec2 p2=a_pos3d.xy;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 duv=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));float cr=(cu.x<0.0||cu.y<0.0||cu.x>1.0||cu.y>1.0)?0.0:texture(u_clip,cu).r;if(cr<0.5&&cr>0.02&&cu.x>=0.0&&cu.y>=0.0&&cu.x<=1.0&&cu.y<=1.0){vec2 g=vec2(texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r);float g2=dot(g,g);if(g2>0.01){vec2 dir=g*inversesqrt(g2);float lo=0.0;float hi=1.85;for(int i=0;i<8;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(duv*mid);float s=(t.x<0.0||t.y<0.0||t.x>1.0||t.y>1.0)?0.0:texture(u_clip,t).r;if(s<0.5)lo=mid;else hi=mid;}cu=cu+dir*(duv*hi);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}}v_clip=cr>=0.5?1.0:0.0;if(v_clip<0.5){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
const CLIP_VERT_SAMPLE_NODROP =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));float cr=(cu.x<0.0||cu.y<0.0||cu.x>1.0||cu.y>1.0)?0.0:texture(u_clip,cu).r;v_clip=cr>=0.5?1.0:0.0;}';
const CLIP_VERT_SAMPLE_RIMSNAP =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 duv=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));float cr=(cu.x<0.0||cu.y<0.0||cu.x>1.0||cu.y>1.0)?0.0:texture(u_clip,cu).r;v_clip=cr>=0.5?1.0:0.0;if(v_clip<0.5){float n=0.0;if(cu.x>=0.0&&cu.y>=0.0&&cu.x<=1.0&&cu.y<=1.0){n=max(n,texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r);n=max(n,texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r);n=max(n,texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r);n=max(n,texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r);}if(n>=0.5){vec2 g=vec2(texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r);float g2=dot(g,g);if(g2>1.0e-8){vec2 dir=g*inversesqrt(g2);float lo=0.0;float hi=1.85;for(int i=0;i<8;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(duv*mid);float s=(t.x<0.0||t.y<0.0||t.x>1.0||t.y>1.0)?0.0:texture(u_clip,t).r;if(s<0.5)lo=mid;else hi=mid;}cu=cu+dir*(duv*hi);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}}';
const CLIP_VERT_SAMPLE_SMOOTH =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 texel=vec2(1.0)/vec2(textureSize(u_clip,0));vec2 cell=max((sc*64.0)/max(u_clip_size,vec2(1.0e-12)),texel*8.0);vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool inBox=cu.x>=0.0&&cu.y>=0.0&&cu.x<=1.0&&cu.y<=1.0;float cr=inBox?texture(u_clip,cu).r:0.0;float nMax=cr;float nMin=cr;if(inBox){float nb;nb=texture(u_clip,clamp(cu+vec2(cell.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(cell.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(0.0,cell.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(0.0,cell.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(cell.x,cell.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(cell.x,-cell.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(-cell.x,cell.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(-cell.x,-cell.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);}bool inside=cr>=0.5;bool rim=inBox&&((nMin<0.5&&nMax>=0.5)||(cr>0.08&&cr<0.92));v_clip=inside?1.0:0.0;if(rim){vec2 g=vec2(texture(u_clip,clamp(cu+vec2(texel.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(texel.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cu+vec2(0.0,texel.y),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(0.0,texel.y),0.0,1.0)).r);float g2=dot(g,g);if(g2>1.0e-10){vec2 dir=g*inversesqrt(g2);if(inside)dir=-dir;float lo=0.0;float hi=1.6;for(int i=0;i<10;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(cell*mid);float s=(t.x<0.0||t.y<0.0||t.x>1.0||t.y>1.0)?0.0:texture(u_clip,t).r;if(inside){if(s>=0.5)lo=mid;else hi=mid;}else{if(s<0.5)lo=mid;else hi=mid;}}cu=cu+dir*(cell*hi);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}}if(!inside&&rim&&a_pos3d.z<0.5){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
// Top silhouette: snap inside-rim verts onto clip 0.5 (province outline).
// Outside rim verts also snap, but stop short of 0.5 (land=lo-0.12) so the
// mixed triangle stays a thin vertical wall instead of a cell-wide ramp
// or a collapsed line. All outside verts — including stitch skirts —
// drop in Z; undropped skirts used to mix with dropped surface verts and
// paint AABB boxes, so the old path discarded every outside skirt face
// and left holes in the island wall at tile edges.
const CLIP_VERT_SAMPLE_INSIDE_RIM =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 duv=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool inBox=cu.x>=0.0&&cu.y>=0.0&&cu.x<=1.0&&cu.y<=1.0;float cr=inBox?texture(u_clip,cu).r:0.0;float nMax=cr;float nMin=cr;if(inBox){float nb;nb=texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);}bool inside=cr>=0.5;bool rim=inBox&&nMin<0.5&&nMax>=0.5;v_clip=inside?1.0:0.0;if(inside&&rim&&a_pos3d.z<0.5){vec2 g=vec2(texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r);float g2=dot(g,g);if(g2>1.0e-8){vec2 dir=-g*inversesqrt(g2);float lo=0.0;float hi=1.6;for(int i=0;i<8;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(duv*mid);float s=(t.x<0.0||t.y<0.0||t.x>1.0||t.y>1.0)?0.0:texture(u_clip,t).r;if(s>=0.5)lo=mid;else hi=mid;}cu=cu+dir*(duv*hi);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}}if(!inside&&a_pos3d.z<0.5){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
const CLIP_VERT_SAMPLE_RIM_WALL_V1 =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 duv=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool inBox=cu.x>=0.0&&cu.y>=0.0&&cu.x<=1.0&&cu.y<=1.0;float cr=inBox?texture(u_clip,cu).r:0.0;float nMax=cr;float nMin=cr;if(inBox){float nb;nb=texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(duv.x,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(duv.x,-duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(-duv.x,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(-duv.x,-duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);}bool inside=cr>=0.5;bool rim=inBox&&nMin<0.5&&nMax>=0.5;v_clip=inside?1.0:0.0;if(rim){vec2 g=vec2(texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r);float g2=dot(g,g);if(g2>1.0e-8){vec2 dir=g*inversesqrt(g2);if(inside)dir=-dir;float lo=0.0;float hi=1.6;for(int i=0;i<8;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(duv*mid);float s=(t.x<0.0||t.y<0.0||t.x>1.0||t.y>1.0)?0.0:texture(u_clip,t).r;if(inside){if(s>=0.5)lo=mid;else hi=mid;}else{if(s<0.5)lo=mid;else hi=mid;}}float land=inside?lo:max(lo-0.12,0.0);cu=cu+dir*(duv*land);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}}if(!inside){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
// Clamp out-of-bbox clip samples so view-edge stitch skirts inherit the
// texture edge (island-fills-view → stay up; pad → drop). Treating
// !inBox as cr=0 rebuilt a rectangular wall around the clip AABB.
const CLIP_VERT_SAMPLE_RIM_WALL_V2 =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 duv=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool inBox=cu.x>=0.0&&cu.y>=0.0&&cu.x<=1.0&&cu.y<=1.0;float cr=texture(u_clip,clamp(cu,0.0,1.0)).r;float nMax=cr;float nMin=cr;if(inBox){float nb;nb=texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(duv.x,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(duv.x,-duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(-duv.x,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(-duv.x,-duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);}bool inside=cr>=0.5;bool rim=inBox&&nMin<0.5&&nMax>=0.5;v_clip=inside?1.0:0.0;if(rim){vec2 g=vec2(texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r);float g2=dot(g,g);if(g2>1.0e-8){vec2 dir=g*inversesqrt(g2);if(inside)dir=-dir;float lo=0.0;float hi=1.6;for(int i=0;i<8;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(duv*mid);float s=texture(u_clip,clamp(t,0.0,1.0)).r;if(inside){if(s>=0.5)lo=mid;else hi=mid;}else{if(s<0.5)lo=mid;else hi=mid;}}float land=inside?lo:max(lo-0.12,0.0);cu=cu+dir*(duv*land);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}}if(!inside){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
const CLIP_VERT_SAMPLE_RIM_WALL_V3 =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 duv=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool nearBox=cu.x>=-duv.x&&cu.y>=-duv.y&&cu.x<=1.0+duv.x&&cu.y<=1.0+duv.y;float cr=texture(u_clip,clamp(cu,0.0,1.0)).r;float nMax=cr;float nMin=cr;if(nearBox){float nb;nb=texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(duv.x,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(duv.x,-duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(-duv.x,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(-duv.x,-duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);}bool inside=cr>=0.5;bool rim=nearBox&&nMin<0.5&&nMax>=0.5;v_clip=inside?1.0:0.0;if(rim){vec2 g=vec2(texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r);float g2=dot(g,g);if(g2>1.0e-8){vec2 dir=g*inversesqrt(g2);if(inside)dir=-dir;float lo=0.0;float hi=1.6;for(int i=0;i<8;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(duv*mid);float s=texture(u_clip,clamp(t,0.0,1.0)).r;if(inside){if(s>=0.5)lo=mid;else hi=mid;}else{if(s<0.5)lo=mid;else hi=mid;}}float land=inside?lo:max(lo-0.12,0.0);cu=cu+dir*(duv*land);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}}if(!inside){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
// Axis gradient is 0 on diagonal coasts (X/Y neighbors same side;
// only a diagonal sample crosses 0.5). Those verts used to stay a
// full cell out and paint orange sawtooth spikes. Walk the first
// 8-connected crossing instead.
const CLIP_VERT_SAMPLE_RIM_WALL =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 duv=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool nearBox=cu.x>=-duv.x&&cu.y>=-duv.y&&cu.x<=1.0+duv.x&&cu.y<=1.0+duv.y;float cr=texture(u_clip,clamp(cu,0.0,1.0)).r;float nMax=cr;float nMin=cr;if(nearBox){float nb;nb=texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(duv.x,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(duv.x,-duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(-duv.x,duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);nb=texture(u_clip,clamp(cu+vec2(-duv.x,-duv.y),0.0,1.0)).r;nMax=max(nMax,nb);nMin=min(nMin,nb);}bool inside=cr>=0.5;bool rim=nearBox&&nMin<0.5&&nMax>=0.5;v_clip=inside?1.0:0.0;if(rim){vec2 g=vec2(texture(u_clip,clamp(cu+vec2(duv.x,0.0),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(duv.x,0.0),0.0,1.0)).r,texture(u_clip,clamp(cu+vec2(0.0,duv.y),0.0,1.0)).r-texture(u_clip,clamp(cu-vec2(0.0,duv.y),0.0,1.0)).r);float g2=dot(g,g);vec2 dir=vec2(0.0);if(g2>1.0e-8){dir=g*inversesqrt(g2);if(inside)dir=-dir;}if(dot(dir,dir)<1.0e-12){vec2 o;float t;o=vec2(duv.x,0.0);t=texture(u_clip,clamp(cu+o,0.0,1.0)).r;if((inside&&t<0.5)||(!inside&&t>=0.5))dir=o;o=vec2(-duv.x,0.0);t=texture(u_clip,clamp(cu+o,0.0,1.0)).r;if(dot(dir,dir)<1.0e-12&&((inside&&t<0.5)||(!inside&&t>=0.5)))dir=o;o=vec2(0.0,duv.y);t=texture(u_clip,clamp(cu+o,0.0,1.0)).r;if(dot(dir,dir)<1.0e-12&&((inside&&t<0.5)||(!inside&&t>=0.5)))dir=o;o=vec2(0.0,-duv.y);t=texture(u_clip,clamp(cu+o,0.0,1.0)).r;if(dot(dir,dir)<1.0e-12&&((inside&&t<0.5)||(!inside&&t>=0.5)))dir=o;o=vec2(duv.x,duv.y);t=texture(u_clip,clamp(cu+o,0.0,1.0)).r;if(dot(dir,dir)<1.0e-12&&((inside&&t<0.5)||(!inside&&t>=0.5)))dir=o;o=vec2(duv.x,-duv.y);t=texture(u_clip,clamp(cu+o,0.0,1.0)).r;if(dot(dir,dir)<1.0e-12&&((inside&&t<0.5)||(!inside&&t>=0.5)))dir=o;o=vec2(-duv.x,duv.y);t=texture(u_clip,clamp(cu+o,0.0,1.0)).r;if(dot(dir,dir)<1.0e-12&&((inside&&t<0.5)||(!inside&&t>=0.5)))dir=o;o=vec2(-duv.x,-duv.y);t=texture(u_clip,clamp(cu+o,0.0,1.0)).r;if(dot(dir,dir)<1.0e-12&&((inside&&t<0.5)||(!inside&&t>=0.5)))dir=o;float d2=dot(dir,dir);if(d2>1.0e-12)dir*=inversesqrt(d2);}if(dot(dir,dir)>1.0e-12){float lo=0.0;float hi=1.6;for(int i=0;i<8;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(duv*mid);float s=texture(u_clip,clamp(t,0.0,1.0)).r;if(inside){if(s>=0.5)lo=mid;else hi=mid;}else{if(s<0.5)lo=mid;else hi=mid;}}float land=inside?lo:max(lo-0.12,0.0);cu=cu+dir*(duv*land);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}}if(!inside){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
// Bilinear clip + 8-connected Sobel (1-cell and 2-cell): axis-only
// gradients lock onto Bresenham faces (~6px stairs / polyline corners).
// Kept so re-patch can replace it with texel-scale Sobel (FM-0902-39).
const CLIP_VERT_SAMPLE_RIM_SMOOTH_V1 =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 duv=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool nearBox=cu.x>=-duv.x&&cu.y>=-duv.y&&cu.x<=1.0+duv.x&&cu.y<=1.0+duv.y;float cr=antiqueClipBi(cu);float nMax=cr;float nMin=cr;if(nearBox){float nb;nb=antiqueClipBi(cu+vec2(duv.x,0.0));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(-duv.x,0.0));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(0.0,duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(0.0,-duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(duv.x,duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(duv.x,-duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(-duv.x,duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(-duv.x,-duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);}bool inside=cr>=0.5;bool rim=nearBox&&nMin<0.5&&nMax>=0.5;v_clip=inside?1.0:0.0;if(rim){float tl=antiqueClipBi(cu+vec2(-duv.x,-duv.y));float t=antiqueClipBi(cu+vec2(0.0,-duv.y));float tr=antiqueClipBi(cu+vec2(duv.x,-duv.y));float l=antiqueClipBi(cu+vec2(-duv.x,0.0));float r=antiqueClipBi(cu+vec2(duv.x,0.0));float bl=antiqueClipBi(cu+vec2(-duv.x,duv.y));float b=antiqueClipBi(cu+vec2(0.0,duv.y));float br=antiqueClipBi(cu+vec2(duv.x,duv.y));vec2 g=vec2((tr+2.0*r+br)-(tl+2.0*l+bl),(bl+2.0*b+br)-(tl+2.0*t+tr));float tl2=antiqueClipBi(cu+vec2(-2.0*duv.x,-2.0*duv.y));float t2=antiqueClipBi(cu+vec2(0.0,-2.0*duv.y));float tr2=antiqueClipBi(cu+vec2(2.0*duv.x,-2.0*duv.y));float l2=antiqueClipBi(cu+vec2(-2.0*duv.x,0.0));float r2=antiqueClipBi(cu+vec2(2.0*duv.x,0.0));float bl2=antiqueClipBi(cu+vec2(-2.0*duv.x,2.0*duv.y));float b2=antiqueClipBi(cu+vec2(0.0,2.0*duv.y));float br2=antiqueClipBi(cu+vec2(2.0*duv.x,2.0*duv.y));g+=vec2((tr2+2.0*r2+br2)-(tl2+2.0*l2+bl2),(bl2+2.0*b2+br2)-(tl2+2.0*t2+tr2));float g2=dot(g,g);vec2 dir=vec2(0.0);if(g2>1.0e-12){dir=g*inversesqrt(g2);if(inside)dir=-dir;}if(dot(dir,dir)<1.0e-12){vec2 o;float tt;o=vec2(duv.x,0.0);tt=antiqueClipBi(cu+o);if((inside&&tt<0.5)||(!inside&&tt>=0.5))dir=o;o=vec2(-duv.x,0.0);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(0.0,duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(0.0,-duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(duv.x,duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(duv.x,-duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(-duv.x,duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(-duv.x,-duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;float d2=dot(dir,dir);if(d2>1.0e-12)dir*=inversesqrt(d2);}if(dot(dir,dir)>1.0e-12){float lo=0.0;float hi=1.6;for(int i=0;i<10;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(duv*mid);float s=antiqueClipBi(t);if(inside){if(s>=0.5)lo=mid;else hi=mid;}else{if(s<0.5)lo=mid;else hi=mid;}}float land=inside?hi:max(lo-0.12,0.0);cu=cu+dir*(duv*land);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}}if(!inside){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
// Unnormalized 1+2+4 texel sum: the 4-texel kernel (~1 mesh cell) drowned
// the AA gradient and locked onto occupancy faces (11px / 6–7px stairs).
const CLIP_VERT_SOBEL_ACCUM_V1 =
  'vec2 tex=1.0/max(u_clip_texels,vec2(1.0));vec2 g=antiqueClipSobel(cu,tex);g+=antiqueClipSobel(cu,2.0*tex);g+=antiqueClipSobel(cu,4.0*tex);';
// Fine scale wins: normalize each kernel so 4-texel Bresenham faces cannot
// dominate the 1-texel bilinear iso. Keep 8-connected Sobel + 14-iter search.
const CLIP_VERT_SOBEL_ACCUM =
  'vec2 tex=1.0/max(u_clip_texels,vec2(1.0));vec2 g=vec2(0.0);vec2 s1=antiqueClipSobel(cu,tex);float n1=dot(s1,s1);if(n1>1.0e-12)g+=s1*inversesqrt(n1);vec2 s2=antiqueClipSobel(cu,2.0*tex);float n2=dot(s2,s2);if(n2>1.0e-12)g+=0.4*s2*inversesqrt(n2);vec2 s4=antiqueClipSobel(cu,4.0*tex);float n4=dot(s4,s4);if(n4>1.0e-12)g+=0.15*s4*inversesqrt(n4);';
const CLIP_VERT_SAMPLE_RIM_SMOOTH =
  'vec2 p2=a_pos3d.xy;v_skirt=a_pos3d.z;v_clip=1.0;v_drop=0.0;if(u_clip_enabled>0.5){vec2 orig=u_projection_tile_mercator_coords.xy;vec2 sc=max(u_projection_tile_mercator_coords.zw,vec2(1.0e-12));vec2 duv=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));bool nearBox=cu.x>=-duv.x&&cu.y>=-duv.y&&cu.x<=1.0+duv.x&&cu.y<=1.0+duv.y;float cr=antiqueClipBi(cu);float nMax=cr;float nMin=cr;if(nearBox){float nb;nb=antiqueClipBi(cu+vec2(duv.x,0.0));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(-duv.x,0.0));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(0.0,duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(0.0,-duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(duv.x,duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(duv.x,-duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(-duv.x,duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);nb=antiqueClipBi(cu+vec2(-duv.x,-duv.y));nMax=max(nMax,nb);nMin=min(nMin,nb);}bool inside=cr>=0.5;bool rim=nearBox&&nMin<0.5&&nMax>=0.5;v_clip=inside?1.0:0.0;if(rim){' +
  CLIP_VERT_SOBEL_ACCUM +
  'float g2=dot(g,g);vec2 dir=vec2(0.0);if(g2>1.0e-12){dir=g*inversesqrt(g2);if(inside)dir=-dir;}if(dot(dir,dir)<1.0e-12){vec2 o;float tt;o=vec2(duv.x,0.0);tt=antiqueClipBi(cu+o);if((inside&&tt<0.5)||(!inside&&tt>=0.5))dir=o;o=vec2(-duv.x,0.0);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(0.0,duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(0.0,-duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(duv.x,duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(duv.x,-duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(-duv.x,duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;o=vec2(-duv.x,-duv.y);tt=antiqueClipBi(cu+o);if(dot(dir,dir)<1.0e-12&&((inside&&tt<0.5)||(!inside&&tt>=0.5)))dir=o;float d2=dot(dir,dir);if(d2>1.0e-12)dir*=inversesqrt(d2);}if(dot(dir,dir)>1.0e-12){float lo=0.0;float hi=1.6;for(int i=0;i<14;i++){float mid=0.5*(lo+hi);vec2 t=cu+dir*(duv*mid);float s=antiqueClipBi(t);if(inside){if(s>=0.5)lo=mid;else hi=mid;}else{if(s<0.5)lo=mid;else hi=mid;}}float land=inside?hi:max(lo-0.12,0.0);cu=cu+dir*(duv*land);v_mercator=u_clip_origin+cu*u_clip_size;p2=(v_mercator-orig)/sc;}}if(!inside){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}}';
const CLIP_VERT_SAMPLE = CLIP_VERT_SAMPLE_RIM_SMOOTH;
const CLIP_VERT_SAMPLE_OLD =
  'v_clip=1.0;if(u_clip_enabled>0.5){vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));float cr=(cu.x<0.0||cu.y<0.0||cu.x>1.0||cu.y>1.0)?0.0:texture(u_clip,cu).r;v_clip=cr>=0.5?1.0:0.0;if(v_clip<0.5)ele_delta=max(ele_delta,u_clip_drop);}';
const ELE_DELTA_GATED =
  'float ele_delta=(a_pos3d.z==1.0 && u_clip_enabled<0.5) ? u_ele_delta : 0.0;';
const ELE_DELTA_STITCH = 'float ele_delta=a_pos3d.z==1.0 ? u_ele_delta : 0.0;';

function ungateStitchDelta(s) {
  if (s.includes(ELE_DELTA_STITCH)) {
    s = s.split(ELE_DELTA_STITCH).join(ELE_DELTA_GATED);
  }
  return s;
}

function patchVertexClipInterp(s) {
  s = ungateStitchDelta(s);
  if (s.includes(CLIP_DISCARD_OLD) && !s.includes('cuf=')) {
    s = s.split(CLIP_DISCARD_OLD).join(CLIP_DISCARD);
  }
  if (s.includes('out float v_clip;') && s.includes('u_clip_drop') && s.includes('cuf=')) return s;
  const oldDiscard =
    'if(u_clip_enabled>0.5){vec2 cu=(v_mercator-u_clip_origin)/max(u_clip_size,vec2(1.0e-12));if(cu.x<0.0||cu.y<0.0||cu.x>1.0||cu.y>1.0)discard;if(texture(u_clip,cu).r<0.5)discard;}';
  if (s.includes(oldDiscard)) {
    s = s.split(oldDiscard).join(CLIP_DISCARD);
  }
  s = s.split(
    'uniform sampler2D u_clip;uniform highp float u_clip_enabled;uniform vec2 u_clip_origin;uniform vec2 u_clip_size;in vec2 v_mercator;'
  ).join(CLIP_FRAG_PREFIX);
  s = mustReplace(
    s,
    'uniform highp float u_clip_enabled;out vec2 v_texture_pos;out float v_fog_depth;out vec2 v_mercator;void main() {',
    'uniform highp float u_clip_enabled;' +
      CLIP_VERT_UNIFORMS +
      'out vec2 v_texture_pos;out float v_fog_depth;out highp vec2 v_mercator;out float v_clip;out float v_drop;out highp float v_drop_w;out highp float v_clip_w;out float v_skirt;void main() {',
    'terrainVert v_clip'
  );
  s = mustReplace(
    s,
    'uniform highp float u_clip_enabled;out float v_depth;out vec2 v_mercator;void main() {',
    'uniform highp float u_clip_enabled;' +
      CLIP_VERT_UNIFORMS +
      'out float v_depth;out highp vec2 v_mercator;out float v_clip;out float v_drop;out highp float v_drop_w;out highp float v_clip_w;out float v_skirt;void main() {',
    'terrainVertDepth v_clip'
  );
  s = mustReplace(
    s,
    'uniform highp float u_clip_enabled;out vec2 v_texture_pos;out vec2 v_mercator;void main() {',
    'uniform highp float u_clip_enabled;' +
      CLIP_VERT_UNIFORMS +
      'out vec2 v_texture_pos;out highp vec2 v_mercator;out float v_clip;out float v_drop;out highp float v_drop_w;out highp float v_clip_w;out float v_skirt;void main() {',
    'terrainVertCoords v_clip'
  );
  s = ungateStitchDelta(s);
  s = mustReplace(
    s,
    'v_mercator=u_projection_tile_mercator_coords.xy+a_pos3d.xy*u_projection_tile_mercator_coords.zw;gl_Position=',
    'v_mercator=u_projection_tile_mercator_coords.xy+a_pos3d.xy*u_projection_tile_mercator_coords.zw;' +
      CLIP_VERT_SAMPLE +
      'gl_Position=',
    'v_clip sample before gl_Position'
  );
  if (!s.includes("'u_clip_drop':")) {
    s = s.split(
      "'u_clip_size': new performance$1.Uniform2f(context, locations.u_clip_size),"
    ).join(
      "'u_clip_size': new performance$1.Uniform2f(context, locations.u_clip_size),\n    'u_clip_drop': new performance$1.Uniform1f(context, locations.u_clip_drop),"
    );
    s = s.split("'u_clip_size': [1, 1],").join("'u_clip_size': [1, 1],\n    'u_clip_drop': 12000,");
  }
  if (!s.includes('uniformValues.u_clip_drop')) {
    s = s.split(
      'uniformValues.u_clip_size = clip && clip.size ? clip.size : [1, 1];'
    ).join(
      'uniformValues.u_clip_size = clip && clip.size ? clip.size : [1, 1];\n    uniformValues.u_clip_drop = clip && clip.drop > 0 ? clip.drop : 12000;'
    );
  }
  return s;
}

function mustReplace(hay, needle, replacement, label) {
  if (!hay.includes(needle)) {
    throw new Error('patch miss: ' + label);
  }
  const next = hay.replace(needle, replacement);
  if (next === hay) throw new Error('patch no-op: ' + label);
  return next;
}

function patch(srcText) {
  let s = srcText;
  if (s.includes('__ANTIQUE_TERRAIN_CLIP_PATCH')) {
    return patchSideTint(patchSkirtSolid(patchVertexClipInterp(s)));
  }

  s = mustReplace(
    s,
    "var terrainFrag = 'uniform sampler2D u_texture;uniform vec4 u_fog_color;uniform vec4 u_horizon_color;uniform float u_fog_ground_blend;uniform float u_fog_ground_blend_opacity;uniform float u_horizon_fog_blend;uniform bool u_is_globe_mode;in vec2 v_texture_pos;in float v_fog_depth;",
    "var terrainFrag = 'uniform sampler2D u_texture;uniform vec4 u_fog_color;uniform vec4 u_horizon_color;uniform float u_fog_ground_blend;uniform float u_fog_ground_blend_opacity;uniform float u_horizon_fog_blend;uniform bool u_is_globe_mode;" +
      CLIP_FRAG_PREFIX +
      'in vec2 v_texture_pos;in float v_fog_depth;',
    'terrainFrag uniforms'
  );
  s = mustReplace(
    s,
    "void main() {vec4 surface_color=texture(u_texture,vec2(v_texture_pos.x,1.0-v_texture_pos.y));",
    "void main() {" +
      CLIP_DISCARD +
      "vec4 surface_color=texture(u_texture,vec2(v_texture_pos.x,1.0-v_texture_pos.y));" +
      CLIP_SIDE_TINT,
    'terrainFrag discard'
  );

  s = mustReplace(
    s,
    "var terrainDepthFrag = 'in float v_depth;",
    "var terrainDepthFrag = '" + CLIP_FRAG_PREFIX + "in float v_depth;",
    'terrainDepthFrag uniforms'
  );
  s = mustReplace(
    s,
    "void main() {fragColor=pack(v_depth);}",
    "void main() {" + CLIP_DISCARD + "fragColor=pack(v_depth);}",
    'terrainDepthFrag discard'
  );

  s = mustReplace(
    s,
    "var terrainCoordsFrag = 'precision mediump float;uniform sampler2D u_texture;uniform float u_terrain_coords_id;in vec2 v_texture_pos;void main() {",
    "var terrainCoordsFrag = 'precision mediump float;uniform sampler2D u_texture;uniform float u_terrain_coords_id;" +
      CLIP_FRAG_PREFIX +
      "in vec2 v_texture_pos;void main() {" +
      CLIP_DISCARD,
    'terrainCoordsFrag'
  );

  // Globe prelude already declares this uniform. Mercator prelude does not.
  s = mustReplace(
    s,
    "var projectionMercatorVert = 'float projectLineThickness(float tileY) {return 1.0;}",
    "var projectionMercatorVert = 'uniform vec4 u_projection_tile_mercator_coords;float projectLineThickness(float tileY) {return 1.0;}",
    'projectionMercatorVert clip coords'
  );

  const mercatorVarying =
    'v_mercator=u_projection_tile_mercator_coords.xy+a_pos3d.xy*u_projection_tile_mercator_coords.zw;';

  s = mustReplace(
    s,
    "var terrainVert = 'in vec3 a_pos3d;uniform mat4 u_fog_matrix;uniform float u_ele_delta;out vec2 v_texture_pos;out float v_fog_depth;void main() {float ele=get_elevation(a_pos3d.xy);float ele_delta=a_pos3d.z==1.0 ? u_ele_delta : 0.0;v_texture_pos=a_pos3d.xy/8192.0;",
    "var terrainVert = 'in vec3 a_pos3d;uniform mat4 u_fog_matrix;uniform float u_ele_delta;uniform highp float u_clip_enabled;" +
      CLIP_VERT_UNIFORMS +
      'out vec2 v_texture_pos;out float v_fog_depth;out highp vec2 v_mercator;out float v_clip;out float v_drop;out highp float v_drop_w;out highp float v_clip_w;out float v_skirt;void main() {float ele=get_elevation(a_pos3d.xy);' +
      ELE_DELTA_GATED +
      'v_texture_pos=a_pos3d.xy/8192.0;' +
      mercatorVarying +
      CLIP_VERT_SAMPLE,
    'terrainVert'
  );

  s = mustReplace(
    s,
    "var terrainVertDepth = 'in vec3 a_pos3d;uniform float u_ele_delta;out float v_depth;void main() {float ele=get_elevation(a_pos3d.xy);float ele_delta=a_pos3d.z==1.0 ? u_ele_delta : 0.0;",
    "var terrainVertDepth = 'in vec3 a_pos3d;uniform float u_ele_delta;uniform highp float u_clip_enabled;" +
      CLIP_VERT_UNIFORMS +
      'out float v_depth;out highp vec2 v_mercator;out float v_clip;out float v_drop;out highp float v_drop_w;out highp float v_clip_w;out float v_skirt;void main() {float ele=get_elevation(a_pos3d.xy);' +
      ELE_DELTA_GATED +
      mercatorVarying +
      CLIP_VERT_SAMPLE,
    'terrainVertDepth'
  );

  s = mustReplace(
    s,
    "var terrainVertCoords = 'in vec3 a_pos3d;uniform float u_ele_delta;out vec2 v_texture_pos;void main() {float ele=get_elevation(a_pos3d.xy);float ele_delta=a_pos3d.z==1.0 ? u_ele_delta : 0.0;v_texture_pos=a_pos3d.xy/8192.0;",
    "var terrainVertCoords = 'in vec3 a_pos3d;uniform float u_ele_delta;uniform highp float u_clip_enabled;" +
      CLIP_VERT_UNIFORMS +
      'out vec2 v_texture_pos;out highp vec2 v_mercator;out float v_clip;out float v_drop;out highp float v_drop_w;out highp float v_clip_w;out float v_skirt;void main() {float ele=get_elevation(a_pos3d.xy);' +
      ELE_DELTA_GATED +
      'v_texture_pos=a_pos3d.xy/8192.0;' +
      mercatorVarying +
      CLIP_VERT_SAMPLE,
    'terrainVertCoords'
  );

  const clipUniforms = `'u_clip': new performance$1.Uniform1i(context, locations.u_clip),
    'u_clip_enabled': new performance$1.Uniform1f(context, locations.u_clip_enabled),
    'u_clip_origin': new performance$1.Uniform2f(context, locations.u_clip_origin),
    'u_clip_size': new performance$1.Uniform2f(context, locations.u_clip_size),
    'u_clip_drop': new performance$1.Uniform1f(context, locations.u_clip_drop),
    'u_clip_texels': new performance$1.Uniform2f(context, locations.u_clip_texels),
    'u_clip_side_color': new performance$1.Uniform4f(context, locations.u_clip_side_color),`;

  s = mustReplace(
    s,
    `const terrainUniforms = (context, locations) => ({
    'u_texture': new performance$1.Uniform1i(context, locations.u_texture),`,
    `const terrainUniforms = (context, locations) => ({
    ${clipUniforms}
    'u_texture': new performance$1.Uniform1i(context, locations.u_texture),`,
    'terrainUniforms'
  );
  s = mustReplace(
    s,
    `const terrainDepthUniforms = (context, locations) => ({
    'u_ele_delta': new performance$1.Uniform1f(context, locations.u_ele_delta)
});`,
    `const terrainDepthUniforms = (context, locations) => ({
    ${clipUniforms}
    'u_ele_delta': new performance$1.Uniform1f(context, locations.u_ele_delta)
});`,
    'terrainDepthUniforms'
  );
  s = mustReplace(
    s,
    `const terrainCoordsUniforms = (context, locations) => ({
    'u_texture': new performance$1.Uniform1i(context, locations.u_texture),`,
    `const terrainCoordsUniforms = (context, locations) => ({
    ${clipUniforms}
    'u_texture': new performance$1.Uniform1i(context, locations.u_texture),`,
    'terrainCoordsUniforms'
  );

  const clipValues = `'u_clip': 4,
    'u_clip_enabled': 0,
    'u_clip_origin': [0, 0],
    'u_clip_size': [1, 1],
    'u_clip_drop': 12000,
    'u_clip_texels': [1, 1],
    'u_clip_side_color': [0.427, 0.29, 0.212, 1],`;

  s = mustReplace(
    s,
    `const terrainUniformValues = (eleDelta, fogMatrix, sky, pitch, isGlobeMode) => ({
    'u_texture': 0,`,
    `const terrainUniformValues = (eleDelta, fogMatrix, sky, pitch, isGlobeMode) => ({
    ${clipValues}
    'u_texture': 0,`,
    'terrainUniformValues'
  );
  s = mustReplace(
    s,
    `const terrainDepthUniformValues = (eleDelta) => ({
    'u_ele_delta': eleDelta
});`,
    `const terrainDepthUniformValues = (eleDelta) => ({
    ${clipValues}
    'u_ele_delta': eleDelta
});`,
    'terrainDepthUniformValues'
  );
  s = mustReplace(
    s,
    `const terrainCoordsUniformValues = (coordsId, eleDelta) => ({
    'u_terrain_coords_id': coordsId / 255,`,
    `const terrainCoordsUniformValues = (coordsId, eleDelta) => ({
    ${clipValues}
    'u_terrain_coords_id': coordsId / 255,`,
    'terrainCoordsUniformValues'
  );

  const bindFn = `function bindAntiqueTerrainClip(context, gl, uniformValues) {
    const clip = typeof globalThis !== 'undefined' ? globalThis.__antiqueTerrainClip : null;
    if (!context.__antiqueClipDummy) {
        const dummy = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, dummy);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        context.__antiqueClipDummy = dummy;
    }
    context.activeTexture.set(gl.TEXTURE4);
    const tex = clip && clip.enabled && clip.texture ? clip.texture : context.__antiqueClipDummy;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    uniformValues.u_clip = 4;
    uniformValues.u_clip_enabled = clip && clip.enabled && clip.texture ? 1 : 0;
    uniformValues.u_clip_origin = clip && clip.origin ? clip.origin : [0, 0];
    uniformValues.u_clip_size = clip && clip.size ? clip.size : [1, 1];
    uniformValues.u_clip_drop = clip && clip.drop > 0 ? clip.drop : 12000;
    uniformValues.u_clip_texels = clip && clip._size ? clip._size : [1, 1];
    uniformValues.u_clip_side_color = clip && clip.sideColor ? clip.sideColor : [0.427, 0.29, 0.212, 1];
}

`;

  s = mustReplace(
    s,
    `function drawDepth(painter, terrain) {`,
    bindFn + `function drawDepth(painter, terrain) {`,
    'bindAntiqueTerrainClip'
  );

  s = mustReplace(
    s,
    `        const uniformValues = terrainDepthUniformValues(terrain.getMeshFrameDelta(tr.zoom));
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);`,
    `        const uniformValues = terrainDepthUniformValues(terrain.getMeshFrameDelta(tr.zoom));
        bindAntiqueTerrainClip(context, gl, uniformValues);
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);`,
    'drawDepth bind'
  );

  s = mustReplace(
    s,
    `        const uniformValues = terrainCoordsUniformValues(255 - terrain.coordsIndex.length, terrain.getMeshFrameDelta(tr.zoom));
        const projectionData = tr.getProjectionData({ overscaledTileID: tile.tileID, applyTerrainMatrix: false, applyGlobeMatrix: true });
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);`,
    `        const uniformValues = terrainCoordsUniformValues(255 - terrain.coordsIndex.length, terrain.getMeshFrameDelta(tr.zoom));
        bindAntiqueTerrainClip(context, gl, uniformValues);
        const projectionData = tr.getProjectionData({ overscaledTileID: tile.tileID, applyTerrainMatrix: false, applyGlobeMatrix: true });
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);`,
    'drawCoords bind'
  );

  s = mustReplace(
    s,
    `        const uniformValues = terrainUniformValues(eleDelta, fogMatrix, painter.style.sky, tr.pitch, isRenderingGlobe);
        const projectionData = tr.getProjectionData({ overscaledTileID: tile.tileID, applyTerrainMatrix: false, applyGlobeMatrix: true });
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);`,
    `        const uniformValues = terrainUniformValues(eleDelta, fogMatrix, painter.style.sky, tr.pitch, isRenderingGlobe);
        bindAntiqueTerrainClip(context, gl, uniformValues);
        const projectionData = tr.getProjectionData({ overscaledTileID: tile.tileID, applyTerrainMatrix: false, applyGlobeMatrix: true });
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);`,
    'drawTerrain bind'
  );

  s = mustReplace(
    s,
    `    getRenderableTiles() {
        return this._renderableTilesKeys.map(key => this.getTileByID(key));
    }`,
    `    getRenderableTiles() {
        const tiles = this._renderableTilesKeys.map(key => this.getTileByID(key));
        const clip = typeof globalThis !== 'undefined' ? globalThis.__antiqueTerrainClip : null;
        if (clip && clip.enabled && typeof clip.filterTiles === 'function') {
            return clip.filterTiles(tiles);
        }
        return tiles;
    }`,
    'getRenderableTiles'
  );

  s = patchSkirtSolid(s);
  s = patchSideTint(s);
  s =
    '/* maplibre-gl@5.6.0-dev + antique terrain clip patch */\n' +
    'globalThis.__ANTIQUE_TERRAIN_CLIP_PATCH = true;\n' +
    s;
  return s;
}

function patchSkirtSolid(s) {
  s = ungateStitchDelta(s);
  if (s.includes(CLIP_DISCARD_WALL)) {
    s = s.split(CLIP_DISCARD_WALL).join(CLIP_DISCARD);
  }
  if (s.includes(CLIP_DISCARD_MIXED)) {
    s = s.split(CLIP_DISCARD_MIXED).join(CLIP_DISCARD);
  }
  const oldCell =
    'vec2 cell=(sc*64.0)/max(u_clip_size,vec2(1.0e-12));vec2 texel=vec2(1.0)/vec2(textureSize(u_clip,0));';
  const newCell =
    'vec2 texel=vec2(1.0)/vec2(textureSize(u_clip,0));vec2 cell=max((sc*64.0)/max(u_clip_size,vec2(1.0e-12)),texel*8.0);';
  if (s.includes(oldCell)) s = s.split(oldCell).join(newCell);
  s = s.split('if(!inside&&rim){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}').join(
    'if(!inside&&rim&&a_pos3d.z<0.5){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}'
  );
  s = s.split('bool wall=u_clip_enabled>0.5&&v_skirt<0.5&&(dg>0.05||cg>0.08||(v_drop>0.5&&!outside));').join(
    'bool wall=u_clip_enabled>0.5&&v_skirt<0.5&&outside&&dg>0.05;'
  );
  s = s.split('bool wall=u_clip_enabled>0.5&&(dg>0.05||cg>0.08||(v_drop>0.5&&!outside));').join(
    'bool wall=u_clip_enabled>0.5&&v_skirt<0.5&&outside&&dg>0.05;'
  );
  if (s.includes(CLIP_DISCARD_NO_RIM)) {
    s = s.split(CLIP_DISCARD_NO_RIM).join(CLIP_DISCARD);
  }
  if (s.includes(CLIP_DISCARD_RAMP_TILEBOX)) {
    s = s.split(CLIP_DISCARD_RAMP_TILEBOX).join(CLIP_DISCARD);
  }
  if (s.includes(CLIP_DISCARD_RAMP) && CLIP_DISCARD_RAMP !== CLIP_DISCARD) {
    s = s.split(CLIP_DISCARD_RAMP).join(CLIP_DISCARD);
  }
  if (s.includes(CLIP_VERT_SAMPLE_INSIDE_RIM)) {
    s = s.split(CLIP_VERT_SAMPLE_INSIDE_RIM).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_RIM_WALL_V1)) {
    s = s.split(CLIP_VERT_SAMPLE_RIM_WALL_V1).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_RIM_WALL_V2)) {
    s = s.split(CLIP_VERT_SAMPLE_RIM_WALL_V2).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_RIM_WALL_V3)) {
    s = s.split(CLIP_VERT_SAMPLE_RIM_WALL_V3).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_RIM_WALL) && CLIP_VERT_SAMPLE_RIM_WALL !== CLIP_VERT_SAMPLE) {
    s = s.split(CLIP_VERT_SAMPLE_RIM_WALL).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_SMOOTH)) {
    s = s.split(CLIP_VERT_SAMPLE_SMOOTH).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_RIM_SMOOTH_V1) && CLIP_VERT_SAMPLE_RIM_SMOOTH_V1 !== CLIP_VERT_SAMPLE) {
    s = s.split(CLIP_VERT_SAMPLE_RIM_SMOOTH_V1).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SOBEL_ACCUM_V1) && CLIP_VERT_SOBEL_ACCUM_V1 !== CLIP_VERT_SOBEL_ACCUM) {
    s = s.split(CLIP_VERT_SOBEL_ACCUM_V1).join(CLIP_VERT_SOBEL_ACCUM);
  }
  if (s.includes(CLIP_VERT_SAMPLE_RIMSNAP)) {
    s = s.split(CLIP_VERT_SAMPLE_RIMSNAP).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_NODROP)) {
    s = s.split(CLIP_VERT_SAMPLE_NODROP).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_NOSKIRT)) {
    s = s.split(CLIP_VERT_SAMPLE_NOSKIRT).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_DROP_SKIRT) && !s.includes('textureSize(u_clip')) {
    s = s.split(CLIP_VERT_SAMPLE_DROP_SKIRT).join(CLIP_VERT_SAMPLE);
  }
  if (!s.includes('out float v_drop;')) {
    s = s.split('out highp vec2 v_mercator;out float v_clip;').join(
      'out highp vec2 v_mercator;out float v_clip;out float v_drop;'
    );
    s = s.split('out vec2 v_mercator;out float v_clip;').join(
      'out highp vec2 v_mercator;out float v_clip;out float v_drop;'
    );
  }
  if (!s.includes('in float v_drop;')) {
    s = s.split('in highp vec2 v_mercator;in float v_clip;').join(
      'in highp vec2 v_mercator;in float v_clip;in float v_drop;'
    );
    s = s.split('in vec2 v_mercator;in float v_clip;').join(
      'in highp vec2 v_mercator;in float v_clip;in float v_drop;'
    );
  }
  if (s.includes(CLIP_VERT_SAMPLE_SNAP_ALL)) {
    s = s.split(CLIP_VERT_SAMPLE_SNAP_ALL).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_SNAP_OUTSIDE)) {
    s = s.split(CLIP_VERT_SAMPLE_SNAP_OUTSIDE).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_DISCARD_DROP_ONLY)) {
    s = s.split(CLIP_DISCARD_DROP_ONLY).join(CLIP_DISCARD);
  }
  if (s.includes(CLIP_DISCARD_CONTOUR)) {
    s = s.split(CLIP_DISCARD_CONTOUR).join(CLIP_DISCARD);
  }
  if (s.includes(CLIP_DISCARD_NO_RIM)) {
    s = s.split(CLIP_DISCARD_NO_RIM).join(CLIP_DISCARD);
  }
  if (s.includes(CLIP_DISCARD_RIM)) {
    s = s.split(CLIP_DISCARD_RIM).join(CLIP_DISCARD);
  }
  if (s.includes(CLIP_VERT_SAMPLE_DROP) && !s.includes('v_skirt=a_pos3d.z')) {
    s = s.split(CLIP_VERT_SAMPLE_DROP).join(CLIP_VERT_SAMPLE);
  }
  if (!s.includes('out float v_skirt;')) {
    s = s.split('out float v_clip;out float v_drop;').join(
      'out float v_clip;out float v_drop;out float v_skirt;'
    );
  }
  if (!s.includes('in float v_skirt;')) {
    s = s.split('in float v_clip;in float v_drop;').join(
      'in float v_clip;in float v_drop;in float v_skirt;'
    );
  }
  if (s.includes(CLIP_FRAG_PREFIX_OLD)) {
    s = s.split(CLIP_FRAG_PREFIX_OLD).join(CLIP_FRAG_PREFIX);
  }
  if (s.includes(CLIP_FRAG_PREFIX_MED)) {
    s = s.split(CLIP_FRAG_PREFIX_MED).join(CLIP_FRAG_PREFIX);
  }
  if (s.includes(CLIP_FRAG_PREFIX_PERSP)) {
    s = s.split(CLIP_FRAG_PREFIX_PERSP).join(CLIP_FRAG_PREFIX);
  }
  s = s.split('uniform float u_clip_drop;').join('uniform highp float u_clip_drop;');
  if (s.includes(CLIP_SIDE_TINT_SHADE) && CLIP_SIDE_TINT_SHADE !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_SHADE).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_SIDE_TINT_FW) && CLIP_SIDE_TINT_FW !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_FW).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_VERT_SAMPLE_OLD)) {
    s = s.split(CLIP_VERT_SAMPLE_OLD).join(CLIP_VERT_SAMPLE);
  }
  if (s.includes(CLIP_VERT_SAMPLE_SOLID) && !s.includes(CLIP_VERT_SAMPLE)) {
    s = s.split(CLIP_VERT_SAMPLE_SOLID).join(CLIP_VERT_SAMPLE);
  }
  s = s.split('vec2 p2=a_pos3d.xy;vec2 p2=a_pos3d.xy;').join('vec2 p2=a_pos3d.xy;');
  s = s.split('out vec2 v_mercator;out float v_clip;out float v_drop;').join(
    'out highp vec2 v_mercator;out float v_clip;out float v_drop;'
  );
  s = s.split('out vec2 v_mercator;out float v_clip;').join(
    'out highp vec2 v_mercator;out float v_clip;'
  );
  s = s.split('in vec2 v_mercator;in float v_clip;in float v_drop;').join(
    'in highp vec2 v_mercator;in float v_clip;in float v_drop;'
  );
  s = s.split('in vec2 v_mercator;in float v_clip;').join(
    'in highp vec2 v_mercator;in float v_clip;'
  );
  if (s.includes('v_drop=ele_delta')) {
    s = s.split('v_drop=ele_delta').join('v_drop=u_clip_drop');
  }
  if (s.includes(CLIP_SIDE_TINT_OLD)) {
    s = s.split(CLIP_SIDE_TINT_OLD).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_SIDE_TINT_DROP)) {
    s = s.split(CLIP_SIDE_TINT_DROP).join(CLIP_SIDE_TINT);
  }
  if (s.includes('v_drop>2.0')) {
    s = s.split('v_drop>2.0').join('v_drop>0.5');
  }
  if (s.includes('v_drop/420.0')) {
    s = s.split('v_drop/420.0').join('v_drop/2800.0');
  }
  if (s.includes("v_texture_pos=a_pos3d.xy/8192.0;v_mercator=")) {
    s = s.split("v_texture_pos=a_pos3d.xy/8192.0;v_mercator=").join('v_mercator=');
  }
  if (s.includes('gl_Position=projectTileFor3D(a_pos3d.xy,get_elevation(a_pos3d.xy)-ele_delta)')) {
    s = s.split('gl_Position=projectTileFor3D(a_pos3d.xy,get_elevation(a_pos3d.xy)-ele_delta)').join(
      'v_texture_pos=p2/8192.0;gl_Position=projectTileFor3D(p2,get_elevation(p2)-ele_delta)'
    );
  }
  if (s.includes('gl_Position=projectTileFor3D(a_pos3d.xy,ele-ele_delta);v_depth=')) {
    s = s.split('gl_Position=projectTileFor3D(a_pos3d.xy,ele-ele_delta);v_depth=').join(
      'gl_Position=projectTileFor3D(p2,get_elevation(p2)-ele_delta);v_depth='
    );
  }
  if (s.includes('gl_Position=projectTileFor3D(a_pos3d.xy,ele-ele_delta);}')) {
    s = s.split('gl_Position=projectTileFor3D(a_pos3d.xy,ele-ele_delta);}').join(
      'v_texture_pos=p2/8192.0;gl_Position=projectTileFor3D(p2,get_elevation(p2)-ele_delta);}'
    );
  }
  const uvRaw = 'v_texture_pos=p2/8192.0';
  const uvClamp = 'v_texture_pos=clamp(p2/8192.0,vec2(0.002),vec2(0.998))';
  if (s.includes('clamp(p2/8192.0,vec2(0.01),vec2(0.99))')) {
    s = s.split('clamp(p2/8192.0,vec2(0.01),vec2(0.99))').join('clamp(p2/8192.0,vec2(0.002),vec2(0.998))');
  }
  if (s.includes(uvRaw) && !s.includes(uvClamp)) {
    s = s.split(uvRaw).join(uvClamp);
  }
  const texRaw = 'vec4 surface_color=texture(u_texture,vec2(v_texture_pos.x,1.0-v_texture_pos.y));';
  const texClamp =
    'vec4 surface_color=texture(u_texture,clamp(vec2(v_texture_pos.x,1.0-v_texture_pos.y),vec2(0.002),vec2(0.998)));';
  if (s.includes('clamp(vec2(v_texture_pos.x,1.0-v_texture_pos.y),vec2(0.01),vec2(0.99))')) {
    s = s.split(
      'clamp(vec2(v_texture_pos.x,1.0-v_texture_pos.y),vec2(0.01),vec2(0.99))'
    ).join('clamp(vec2(v_texture_pos.x,1.0-v_texture_pos.y),vec2(0.002),vec2(0.998))');
  }
  if (s.includes(texRaw)) {
    s = s.split(texRaw).join(texClamp);
  }
  if (s.includes(CLIP_SIDE_TINT_OLD) || s.includes('smoothstep(0.72,1.0,v_clip)')) {
    throw new Error('old skirt texture mix remains');
  }
  if (s.includes(CLIP_DISCARD_OLD)) {
    s = s.split(CLIP_DISCARD_OLD).join(CLIP_DISCARD);
  }
  if (s.includes(CLIP_DISCARD_DROP)) {
    s = s.split(CLIP_DISCARD_DROP).join(CLIP_DISCARD);
  }
  if (s.includes(CLIP_DISCARD_ALWAYS) && !s.includes('bool wall=')) {
    s = s.split(CLIP_DISCARD_ALWAYS).join(CLIP_DISCARD);
  }
  if (s.includes('bool wall=u_clip_enabled>0.5&&dg>=2.0')) {
    s = s.split('bool wall=u_clip_enabled>0.5&&dg>=2.0').join('bool wall=u_clip_enabled>0.5&&dg>0.05');
  }
  if (s.includes('uniform vec2 u_clip_origin;uniform vec2 u_clip_size;')) {
    s = s.split('uniform vec2 u_clip_origin;uniform vec2 u_clip_size;').join(
      'uniform highp vec2 u_clip_origin;uniform highp vec2 u_clip_size;'
    );
  }
  if (s.includes("const key = `m_${northPole ? 'n' : ''}_${southPole ? 's' : ''}`;")) {
    s = s.split("const key = `m_${northPole ? 'n' : ''}_${southPole ? 's' : ''}`;").join(
      "const key = `m_${this.meshSize}_${northPole ? 'n' : ''}_${southPole ? 's' : ''}`;"
    );
  }
  if (!s.includes('float antiqueClipBi(vec2 uv)')) {
    s = s.split('out float v_skirt;void main()').join(
      'out float v_skirt;' + CLIP_VERT_HELPER + 'void main()'
    );
  }
  if (s.includes(CLIP_VERT_HELPER_BI) && !s.includes('vec2 antiqueClipSobel(vec2 uv,vec2 st)')) {
    s = s.split(CLIP_VERT_HELPER_BI).join(CLIP_VERT_HELPER);
  }
  if (!s.includes('uniform highp vec2 u_clip_texels')) {
    if (s.includes('uniform highp float u_clip_drop;')) {
      s = s.split('uniform highp float u_clip_drop;').join(
        'uniform highp float u_clip_drop;uniform highp vec2 u_clip_texels;'
      );
    } else {
      s = s.split('uniform float u_clip_drop;').join(
        'uniform highp float u_clip_drop;uniform highp vec2 u_clip_texels;'
      );
    }
  }
  if (!s.includes("'u_clip_texels':")) {
    s = s.split(
      "'u_clip_drop': new performance$1.Uniform1f(context, locations.u_clip_drop),"
    ).join(
      "'u_clip_drop': new performance$1.Uniform1f(context, locations.u_clip_drop),\n    'u_clip_texels': new performance$1.Uniform2f(context, locations.u_clip_texels),"
    );
    s = s.split("'u_clip_drop': 12000,").join(
      "'u_clip_drop': 12000,\n    'u_clip_texels': [1, 1],"
    );
  }
  if (!s.includes('uniformValues.u_clip_texels')) {
    s = s.split(
      'uniformValues.u_clip_drop = clip && clip.drop > 0 ? clip.drop : 12000;'
    ).join(
      'uniformValues.u_clip_drop = clip && clip.drop > 0 ? clip.drop : 12000;\n    uniformValues.u_clip_texels = clip && clip._size ? clip._size : [1, 1];'
    );
  }
  if (!s.includes('vec2 p2=a_pos3d.xy') || !s.includes('projectTileFor3D(p2,')) {
    throw new Error('clip vertex p2 path missing');
  }
  if (s.includes('vec2 p2=a_pos3d.xy;vec2 p2=a_pos3d.xy;')) {
    throw new Error('p2 redeclared in terrain vertex shader');
  }
  if (s.includes('textureSize(u_clip')) {
    throw new Error('textureSize clip sample is forbidden');
  }
  if (!s.includes('float antiqueClipBi(vec2 uv)') || !s.includes('(tr+2.0*r+br)-(tl+2.0*l+bl)')) {
    throw new Error('rim snap must bilinear-sample the clip and use an 8-connected Sobel');
  }
  if (!s.includes('antiqueClipSobel') || !s.includes('antiqueClipSobel(cu,4.0*tex)')) {
    throw new Error('rim snap must Sobel at clip-texel scale, not 2-cell mesh stairs');
  }
  if (!s.includes('g+=s1*inversesqrt(n1)') || !s.includes('0.15*s4*inversesqrt(n4)')) {
    throw new Error('rim Sobel must normalize per-scale so 4-texel occupancy faces cannot dominate');
  }
  if (s.includes(CLIP_VERT_SOBEL_ACCUM_V1)) {
    throw new Error('unnormalized 1+2+4 texel Sobel sum remains');
  }
  if (!s.includes('u_clip_texels') || !s.includes('uniformValues.u_clip_texels')) {
    throw new Error('u_clip_texels uniform missing');
  }
  if (s.includes('float land=inside?lo:max(lo-0.12,0.0)')) {
    s = s.split('float land=inside?lo:max(lo-0.12,0.0)').join(
      'float land=inside?hi:max(lo-0.12,0.0)'
    );
  }
  if (s.includes('float land=inside?min(hi+0.40,1.6):max(lo-0.12,0.0)')) {
    s = s.split('float land=inside?min(hi+0.40,1.6):max(lo-0.12,0.0)').join(
      'float land=inside?hi:max(lo-0.12,0.0)'
    );
  }
  if (!s.includes('bool nearBox=cu.x>=-duv.x') || !s.includes('float land=inside?hi:max(lo-0.12,0.0)')) {
    throw new Error('rim verts must snap to clip 0.5 (inside) and keep outside epsilon plus a one-cell skirt halo');
  }
  if (!s.includes('clamp(uv,0.0,1.0)*tsz')) {
    throw new Error('out-of-bbox clip samples must clamp, not force cr=0');
  }
  if (!s.includes('if(!inside){ele_delta=max(ele_delta,u_clip_drop);v_drop=u_clip_drop;}')) {
    throw new Error('all outside verts including stitch skirts must drop in Z');
  }
  if (s.includes('if(cr>=0.5)dir=-dir') || s.includes('if(!inside&&a_pos3d.z<0.5)')) {
    throw new Error('outside rim snap must keep epsilon; skirts must drop');
  }
  s = qualifyWallStrata(s);
  if (s.includes('outside&&(skirt||!mixed)') || s.includes('!skirt&&mixed&&v_drop>80.0')) {
    throw new Error('mixed skirt triangles are island walls at tile edges; do not discard them');
  }
  if (!s.includes('if(outside&&!mixed)discard') || s.includes('if(outside&&!wall)discard') || !s.includes('bool wall=u_clip_enabled>0.5&&drop>0.004')) {
    throw new Error('discard the dropped floor; keep mixed (incl. skirt) as walls');
  }
  if (s.includes('||v_skirt>0.5)') || s.includes('v_skirt>0.5||!mixed')) {
    throw new Error('skirt-as-wall paints extra faces under the island');
  }
  if (!s.includes('ele_delta=max(ele_delta,u_clip_drop)') || !s.includes('v_drop=u_clip_drop')) {
    throw new Error('outside verts must drop in Z (tuned side wall)');
  }
  if (!s.includes('fwidth(v_drop)') || !s.includes('bool wall=')) {
    throw new Error('keep mixed drop triangles as walls; discard the floor');
  }
  if (!s.includes('v_skirt=a_pos3d.z') || !s.includes('out float v_skirt;') || !s.includes('in float v_skirt;')) {
    throw new Error('v_skirt varying missing');
  }
  if (!s.includes('out highp vec2 v_mercator') || !s.includes('in highp vec2 v_mercator')) {
    throw new Error('v_mercator not highp');
  }
  if (!s.includes(ELE_DELTA_GATED) || (s.includes('a_pos3d.z==1.0 ? u_ele_delta') && !s.includes('u_clip_enabled<0.5'))) {
    throw new Error('isolate must gate official stitch skirts or they paint km curtains');
  }
  if (s.includes('v_drop=ele_delta')) {
    throw new Error('v_drop must not come from stitch ele_delta');
  }
  if (s.includes('if(wall){float shade=')) {
    throw new Error('one-cake side tint remains; walls must use location strata');
  }
  if (!s.includes('if(wall){float uv=clamp(drop,0.0,1.0)')) {
    throw new Error('wall strata UV (0 top rim / 1 skirt bottom) missing');
  }
  if (!s.includes('b0=0.15;b1=0.40') || !s.includes('b0=0.10;b1=0.30')) {
    throw new Error('water vs land strata palettes missing');
  }
  if (!s.includes('vec3(61.0,83.0,72.0)/255.0') || !s.includes('vec3(196.0,160.0,106.0)/255.0')) {
    throw new Error('strata palette colors missing');
  }
  if (!s.includes('uniform highp float u_clip_drop;uniform vec4 u_clip_side_color')) {
    throw new Error('fragment u_clip_drop missing for strata UV');
  }
  s = qualifyWallStrata(s);
  if (s.includes('uv=clamp(uv*4.0,0.0,1.0)')) {
    throw new Error('uv*4 crushes bay mud/clay; affine drop/u_clip_drop already spans 15/25/60');
  }
  if (s.includes('noperspective out float v_drop') || s.includes('noperspective in float v_drop')) {
    throw new Error('noperspective is illegal in this GLSL; use affine v_drop_w instead');
  }
  if (
    !s.includes('out highp float v_drop_w') ||
    !s.includes('in highp float v_drop_w') ||
    !s.includes('out highp float v_clip_w') ||
    !s.includes('in highp float v_clip_w') ||
    !s.includes('v_drop_w=(v_drop>80.0?1.0:0.0)*gl_Position.w') ||
    !s.includes('v_clip_w=gl_Position.w')
  ) {
    throw new Error('v_drop_w / v_clip_w affine 0-1 shade varyings missing (screen-linear bay 15/25/60)');
  }
  if (s.includes('float drop=v_drop_w*gl_FragCoord.w')) {
    throw new Error('do not reconstruct drop with gl_FragCoord.w; SwiftShader is not 1/clip.w');
  }
  if (!s.includes('float drop=v_drop_w/max(v_clip_w,1.0e-12)') || !s.includes('if(wall){float uv=clamp(drop,0.0,1.0)')) {
    throw new Error('wall strata UV must use affine 0-1 shade=v_drop_w/v_clip_w');
  }
  if (s.includes('v_drop_w=v_drop*gl_Position.w;') || s.includes('drop/max(u_clip_drop,1.0)')) {
    throw new Error('meter-drop * w overflows mediump and paints satellite water; use 0-1 shade');
  }
  if (!s.includes(FOG_IF_SKIP_WALL) || s.includes(FOG_IF + ' {')) {
    throw new Error('wall strata must not mix fog/sky/horizon');
  }
  s = patchOutwardSkirts(s);
  if (!s.includes('highp vec2 u_clip_origin') || s.includes('uniform vec2 u_clip_origin;uniform vec2 u_clip_size;')) {
    throw new Error('clip origin precision mismatch not fixed');
  }
  return s;
}

function qualifyWallStrata(s) {
  if (s.includes(CLIP_FRAG_PREFIX_NOPERSP)) {
    s = s.split(CLIP_FRAG_PREFIX_NOPERSP).join(CLIP_FRAG_PREFIX);
  }
  if (s.includes(CLIP_FRAG_PREFIX_PERSP) && !s.includes('v_drop_w')) {
    s = s.split(CLIP_FRAG_PREFIX_PERSP).join(CLIP_FRAG_PREFIX);
  }
  if (s.includes(CLIP_FRAG_PREFIX_DROP_W)) {
    s = s.split(CLIP_FRAG_PREFIX_DROP_W).join(CLIP_FRAG_PREFIX);
  }
  s = s.split('noperspective out float v_drop;').join(
    'out float v_drop;out highp float v_drop_w;out highp float v_clip_w;'
  );
  s = s.split('noperspective in float v_drop;').join(
    'in float v_drop;in highp float v_drop_w;in highp float v_clip_w;'
  );
  s = s.split('out float v_drop;out float v_drop_w;out float v_clip_w;').join(
    'out float v_drop;out highp float v_drop_w;out highp float v_clip_w;'
  );
  s = s.split('in float v_drop;in float v_drop_w;in float v_clip_w;').join(
    'in float v_drop;in highp float v_drop_w;in highp float v_clip_w;'
  );
  if (!s.includes('v_clip_w')) {
    s = s.split('out float v_drop;out float v_drop_w;out float v_skirt;').join(
      'out float v_drop;out highp float v_drop_w;out highp float v_clip_w;out float v_skirt;'
    );
  }
  if (!s.includes('v_clip_w')) {
    s = s.split('in float v_drop;in float v_drop_w;in float v_skirt;').join(
      'in float v_drop;in highp float v_drop_w;in highp float v_clip_w;in float v_skirt;'
    );
  }
  if (!s.includes('v_drop_w')) {
    s = s.split('out float v_drop;out float v_skirt;').join(
      'out float v_drop;out highp float v_drop_w;out highp float v_clip_w;out float v_skirt;'
    );
  }
  if (!s.includes('v_drop_w')) {
    s = s.split('in float v_drop;in float v_skirt;').join(
      'in float v_drop;in highp float v_drop_w;in highp float v_clip_w;in float v_skirt;'
    );
  }
  const gp = 'gl_Position=projectTileFor3D(p2,get_elevation(p2)-ele_delta);';
  const gpW =
    'gl_Position=projectTileFor3D(p2,get_elevation(p2)-ele_delta);v_drop_w=(v_drop>80.0?1.0:0.0)*gl_Position.w;v_clip_w=gl_Position.w;';
  if (s.includes(gp) && !s.includes('v_drop_w=(v_drop>80.0?1.0:0.0)*gl_Position.w')) {
    s = s.split(gp).join(gpW);
  }
  s = s.split('v_drop_w=v_drop*gl_Position.w;').join(
    'v_drop_w=(v_drop>80.0?1.0:0.0)*gl_Position.w;'
  );
  if (s.includes('v_drop_w=(v_drop>80.0?1.0:0.0)*gl_Position.w;') && !s.includes('v_clip_w=gl_Position.w')) {
    s = s.split('v_drop_w=(v_drop>80.0?1.0:0.0)*gl_Position.w;').join(
      'v_drop_w=(v_drop>80.0?1.0:0.0)*gl_Position.w;v_clip_w=gl_Position.w;'
    );
  }
  if (s.includes(CLIP_DISCARD_SKIRT_WALL_V1)) {
    s = s.split(CLIP_DISCARD_SKIRT_WALL_V1).join(CLIP_DISCARD_SKIRT_WALL);
  }
  if (s.includes(CLIP_DISCARD_SKIRT_WALL_FC)) {
    s = s.split(CLIP_DISCARD_SKIRT_WALL_FC).join(CLIP_DISCARD_SKIRT_WALL);
  }
  if (s.includes(CLIP_DISCARD_SKIRT_WALL_METERS)) {
    s = s.split(CLIP_DISCARD_SKIRT_WALL_METERS).join(CLIP_DISCARD_SKIRT_WALL);
  }
  if (s.includes(CLIP_DISCARD_SKIRT_WALL_FWIDTH)) {
    s = s.split(CLIP_DISCARD_SKIRT_WALL_FWIDTH).join(CLIP_DISCARD_SKIRT_WALL);
  }
  s = s.split('bool wall=u_clip_enabled>0.5&&drop>80.0').join(
    'bool wall=u_clip_enabled>0.5&&drop>0.004'
  );
  if (!s.includes('float dyDrop=dFdy(drop)')) {
    s = s.split(
      'float drop=v_drop_w/max(v_clip_w,1.0e-12);bool wall=u_clip_enabled>0.5&&drop>0.004;'
    ).join(
      'float drop=v_drop_w/max(v_clip_w,1.0e-12);bool wall=u_clip_enabled>0.5&&drop>0.004;float dyDrop=dFdy(drop);'
    );
  }
  s = s.split('float drop=v_drop_w*gl_FragCoord.w;').join(
    'float drop=v_drop_w/max(v_clip_w,1.0e-12);'
  );
  s = s.split('bool wall=u_clip_enabled>0.5&&mixed&&v_drop>80.0;').join(
    'float drop=v_drop_w/max(v_clip_w,1.0e-12);bool wall=u_clip_enabled>0.5&&drop>0.004;'
  );
  if (s.includes(CLIP_SIDE_TINT_V1) && CLIP_SIDE_TINT_V1 !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_V1).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_SIDE_TINT_GEOM) && CLIP_SIDE_TINT_GEOM !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_GEOM).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_SIDE_TINT_DFy_INWALL) && CLIP_SIDE_TINT_DFy_INWALL !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_DFy_INWALL).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_SIDE_TINT_X4) && CLIP_SIDE_TINT_X4 !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_X4).join(CLIP_SIDE_TINT);
  }
  s = s.split('uv=clamp(uv*4.0,0.0,1.0);').join('');
  s = s.split(
    'float dy=dFdy(uv);float uvb=clamp(uv-dy*gl_FragCoord.y,max(uv,1.0e-4),1.0);uv=clamp(uv/uvb,0.0,1.0);'
  ).join('');
  s = s.split(
    'float dy=dyDrop/max(u_clip_drop,1.0);float uvb=clamp(uv-dy*gl_FragCoord.y,max(uv,1.0e-4),1.0);uv=clamp(uv/uvb,0.0,1.0);'
  ).join('');
  if (s.includes('float dyDrop=dFdy(drop);')) {
    s = s.split('float dyDrop=dFdy(drop);').join('');
  }
  s = s.split('if(wall){float uv=clamp(v_drop/max(u_clip_drop,1.0),0.0,1.0)').join(
    'if(wall){float uv=clamp(drop,0.0,1.0)'
  );
  s = s.split('if(wall){float uv=clamp(drop/max(u_clip_drop,1.0),0.0,1.0)').join(
    'if(wall){float uv=clamp(drop,0.0,1.0)'
  );
  if (s.includes(FOG_IF) && !s.includes(FOG_IF_SKIP_WALL)) {
    s = s.split(FOG_IF).join(FOG_IF_SKIP_WALL);
  }
  return s;
}

function patchOutwardSkirts(s) {
  const northOld = 'const northY = northPole ? performance$1.NORTH_POLE_Y : 0;';
  const northNew = 'const northY = northPole ? performance$1.NORTH_POLE_Y : -delta;';
  const southOld = 'const southY = southPole ? performance$1.SOUTH_POLE_Y : performance$1.EXTENT;';
  const southNew = 'const southY = southPole ? performance$1.SOUTH_POLE_Y : performance$1.EXTENT + delta;';
  const sideOld = 'vertexArray.emplaceBack(x * performance$1.EXTENT, y * delta, z);';
  const sideNew =
    'vertexArray.emplaceBack(x * performance$1.EXTENT + (z ? (x ? delta : -delta) : 0), y * delta, z);';
  const gridOfficial = 'vertexArray.emplaceBack(x * delta, y * delta, 0);';
  const gridOverlap =
    'vertexArray.emplaceBack(x === 0 ? -overlap : x === meshSize ? performance$1.EXTENT + overlap : x * delta, y === 0 ? -overlap : y === meshSize ? performance$1.EXTENT + overlap : y * delta, 0);';
  if (s.includes(northOld)) s = s.split(northOld).join(northNew);
  if (s.includes(southOld)) s = s.split(southOld).join(southNew);
  if (s.includes(sideOld)) s = s.split(sideOld).join(sideNew);
  if (s.includes(gridOverlap)) {
    s = s.split(gridOverlap).join(gridOfficial);
  }
  if (s.includes('const overlap = delta * 2')) {
    s = s.split('const delta = performance$1.EXTENT / meshSize;\n        const overlap = delta * 2;').join(
      'const delta = performance$1.EXTENT / meshSize;'
    );
  }
  if (
    !s.includes('NORTH_POLE_Y : -delta') ||
    !s.includes('EXTENT + delta') ||
    !s.includes('z ? (x ? delta : -delta)')
  ) {
    throw new Error('outward tile skirts missing');
  }
  if (s.includes('const overlap = delta * 2') || s.includes('EXTENT + overlap') || !s.includes(gridOfficial)) {
    throw new Error('terrain surface verts must stay official 0..EXTENT without overlap');
  }
  if (!s.includes('clamp(p2/8192.0,vec2(0.002),vec2(0.998))')) {
    throw new Error('terrain RTT uv inset missing');
  }
  return s;
}

function patchSideTint(s) {
  if (s.includes(CLIP_FRAG_PREFIX_OLD)) s = s.split(CLIP_FRAG_PREFIX_OLD).join(CLIP_FRAG_PREFIX);
  if (s.includes(CLIP_FRAG_PREFIX_MED)) s = s.split(CLIP_FRAG_PREFIX_MED).join(CLIP_FRAG_PREFIX);
  if (s.includes(CLIP_FRAG_PREFIX_NOPERSP)) s = s.split(CLIP_FRAG_PREFIX_NOPERSP).join(CLIP_FRAG_PREFIX);
  if (s.includes(CLIP_FRAG_PREFIX_PERSP) && !s.includes('v_drop_w')) {
    s = s.split(CLIP_FRAG_PREFIX_PERSP).join(CLIP_FRAG_PREFIX);
  }
  if (s.includes(CLIP_FRAG_PREFIX_DROP_W)) {
    s = s.split(CLIP_FRAG_PREFIX_DROP_W).join(CLIP_FRAG_PREFIX);
  }
  s = s.split('uniform float u_clip_drop;').join('uniform highp float u_clip_drop;');
  if (s.includes(CLIP_SIDE_TINT_OLD)) s = s.split(CLIP_SIDE_TINT_OLD).join(CLIP_SIDE_TINT);
  if (s.includes(CLIP_SIDE_TINT_SHADE) && CLIP_SIDE_TINT_SHADE !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_SHADE).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_SIDE_TINT_FW) && CLIP_SIDE_TINT_FW !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_FW).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_SIDE_TINT_DROP) && !s.includes('if(wall){float uv=clamp(drop')) {
    s = s.split(CLIP_SIDE_TINT_DROP).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_SIDE_TINT_GEOM) && CLIP_SIDE_TINT_GEOM !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_GEOM).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_SIDE_TINT_DFy_INWALL) && CLIP_SIDE_TINT_DFy_INWALL !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_DFy_INWALL).join(CLIP_SIDE_TINT);
  }
  if (s.includes(CLIP_SIDE_TINT_X4) && CLIP_SIDE_TINT_X4 !== CLIP_SIDE_TINT) {
    s = s.split(CLIP_SIDE_TINT_X4).join(CLIP_SIDE_TINT);
  }
  s = s.split('uv=clamp(uv*4.0,0.0,1.0);').join('');
  s = s.split(
    'float dy=dyDrop/max(u_clip_drop,1.0);float uvb=clamp(uv-dy*gl_FragCoord.y,max(uv,1.0e-4),1.0);uv=clamp(uv/uvb,0.0,1.0);'
  ).join('');
  s = s.split('in float v_clip;uniform vec4 u_clip_side_color;in float v_drop;').join(
    'in float v_clip;in float v_drop;'
  );
  const needleRaw =
    CLIP_DISCARD +
    'vec4 surface_color=texture(u_texture,vec2(v_texture_pos.x,1.0-v_texture_pos.y));';
  const needleClamp =
    CLIP_DISCARD +
    'vec4 surface_color=texture(u_texture,clamp(vec2(v_texture_pos.x,1.0-v_texture_pos.y),vec2(0.002),vec2(0.998)));';
  if (!s.includes(CLIP_SIDE_TINT)) {
    if (s.includes(needleClamp)) s = s.split(needleClamp).join(needleClamp + CLIP_SIDE_TINT);
    else if (s.includes(needleRaw)) s = s.split(needleRaw).join(needleRaw + CLIP_SIDE_TINT);
  }
  if (!s.includes("'u_clip_side_color':")) {
    s = s.split(
      "'u_clip_drop': new performance$1.Uniform1f(context, locations.u_clip_drop),"
    ).join(
      "'u_clip_drop': new performance$1.Uniform1f(context, locations.u_clip_drop),\n    'u_clip_side_color': new performance$1.Uniform4f(context, locations.u_clip_side_color),"
    );
    s = s.split("'u_clip_drop': 12000,").join(
      "'u_clip_drop': 12000,\n    'u_clip_side_color': [0.427, 0.29, 0.212, 1],"
    );
  }
  if (!s.includes('uniformValues.u_clip_side_color')) {
    s = s.split(
      'uniformValues.u_clip_drop = clip && clip.drop > 0 ? clip.drop : 12000;'
    ).join(
      'uniformValues.u_clip_drop = clip && clip.drop > 0 ? clip.drop : 12000;\n    uniformValues.u_clip_side_color = clip && clip.sideColor ? clip.sideColor : [0.427, 0.29, 0.212, 1];'
    );
  }
  return qualifyWallStrata(s);
}

if (process.argv.includes('--vendor-only')) {
  if (!existsSync(dest)) {
    console.error('Missing ' + dest);
    process.exit(1);
  }
  const out = patch(readFileSync(dest, 'utf8'));
  writeFileSync(dest, out);
  console.log('updated', dest, out.length, 'bytes');
} else {
  if (!existsSync(src)) {
    console.error('Missing ' + src);
    console.error('Download https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl-dev.js first.');
    process.exit(1);
  }
  const out = patch(readFileSync(src, 'utf8'));
  mkdirSync(destDir, { recursive: true });
  writeFileSync(dest, out);
  console.log('wrote', dest, out.length, 'bytes');
}
