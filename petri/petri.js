// Petri: a cellular automaton with heredity.
// Every cell runs Gray-Scott reaction-diffusion (U food, V life). The feed rate belongs to the land: a rainfall map that drifts,
// so each region grows its own body plan (waves in the dry, then spots, worms, mazes, cells in the wet).
// Each bit of life carries two genes that travel with it and mutate: its lineage (the hue) and its greed (how low its kill rate is).
// Soil remembers which lineage spent it and sickens that lineage there, so whoever dominates a region loses it to someone else.
// The whole world lives in two float textures and is stepped in a fragment shader. No libraries.

const $ = id => document.getElementById(id);
const canvas = $('c');
const q = new URLSearchParams(location.search);
const N = Math.max(64, Math.min(2048, +(q.get('n') || 512) | 0));
const gl = canvas.getContext('webgl2', {antialias: false, alpha: false, powerPreference: 'high-performance'});
if (!gl || !gl.getExtension('EXT_color_buffer_float')) {$('fail').hidden = false;throw new Error('WebGL 2 float targets unavailable')}

// Rain sets the feed rate, F0 (dry) to F1 (wet). The kill rate follows the band of Gray-Scott that makes patterns at that feed,
// shifted by the greed gene across a width KW: gene 0 is greedy (low kill, dense growth), gene 1 is frail.
const F0 = 0.014, F1 = 0.070, KW = 0.008;
// mu mutation chance, sig mutation step, rS soil recovery, cS soil spend, kin how alike two lineages must be to share a sickness
// (fraction of the hue circle), kP the kill rate added on spent soil, year the steps for one turn of the climate
const P = {mu: 0, sig: 0.07, rS: 1.6e-4, cS: 1.6e-3, kin: 0.08, kP: 0.1, year: 60000};

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D A, B;   // A: U food, V life, S soil, T trail.  B: lineage, greed gene, and (as a vector on the hue circle) who spent the soil here
uniform float clock;      // climate phase, 2 pi per year
uniform int N;
vec4 fa(ivec2 p){return texelFetch(A, (p + N) % N, 0);}
vec4 fb(ivec2 p){return texelFetch(B, (p + N) % N, 0);}
// rainfall, 0 dry to 1 wet: three slow waves that slide across the torus. Integer wave numbers keep it seamless.
float rain(vec2 u){
  u *= 6.2831853;
  float n = .6*sin(u.x + 1.6*sin(u.y + clock)) + .4*sin(2.*u.y - u.x + 2.*clock + 2.) + .25*sin(3.*u.x + 2.*u.y - clock + 4.);
  return smoothstep(-1., 1., n);
}
vec2 dir(float a){return vec2(cos(6.2831853*a), sin(6.2831853*a));}
vec3 hsv(float h, float s, float v){
  vec3 k = clamp(abs(fract(h + vec3(0., 2./3., 1./3.))*6. - 3.) - 1., 0., 1.);
  return v*mix(vec3(1.), k, s);
}
// strain colour: lineage is the hue, greed deepens it and frailty washes it toward white
vec3 strain(vec2 g){
  vec3 c = hsv(g.x, mix(.95, .5, g.y), 1.);
  float d = 1. - dot(c, vec3(.3, .59, .11));
  return mix(c, vec3(1.), .5*d*d);        // lift the dark hues (blue, violet) so every strain reads on black
}
`;

const VS = `#version 300 es
void main(){gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1)*4. - 1., 0., 1.);}`;

const SIM = COMMON + `
uniform int frame;
uniform float mu, sig, rS, cS, kin, kP;
uniform vec4 brush;      // x, y, radius, mode: 1 seed, 2 wipe
uniform vec2 bgene;
uniform vec3 box;        // F0, F1, KW
layout(location=0) out vec4 oA;
layout(location=1) out vec4 oB;
vec3 pcg(uvec3 v){
  v = v*1664525u + 1013904223u;
  v.x += v.y*v.z;v.y += v.z*v.x;v.z += v.x*v.y;
  v ^= v >> 16u;
  v.x += v.y*v.z;v.y += v.z*v.x;v.z += v.x*v.y;
  return vec3(v >> 8u)/16777216.;
}
const float DU = 1., DV = .5, DS = .3;
const ivec2 O[8] = ivec2[8](ivec2(0,1), ivec2(0,-1), ivec2(1,0), ivec2(-1,0), ivec2(1,1), ivec2(-1,1), ivec2(1,-1), ivec2(-1,-1));
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = fa(p), sum = vec4(0.);
  float w[8];
  for(int i = 0; i < 8; i++){
    vec4 n = fa(p + O[i]);
    float k = i < 4 ? .2 : .05;
    sum += k*n;
    w[i] = DV*k*n.y;
  }
  vec4 lap = sum - c;
  float U = c.x, V = c.y, S = c.z, T = c.w;
  vec3 r = pcg(uvec3(p, frame));

  // inheritance: the cell takes the genes of ONE source of its life, chosen in proportion to the matter each sends.
  // Particulate, not blended, so a mutant patch stays a mutant patch. The resident counts fourfold, which keeps borders
  // from dissolving into speckle; empty ground still goes to whoever arrives.
  float self = 4.*V*(1. - DV), tot = self + DV*sum.y;
  ivec2 src = ivec2(0);
  float t = r.x*tot - self;
  if(tot > 1e-6 && t > 0.) for(int i = 0; i < 8; i++){src = O[i];t -= w[i];if(t <= 0.) break;}
  vec4 b = fb(p);
  vec2 g = src == ivec2(0) ? b.xy : fb(p + src).xy, own = b.zw;

  // mutation: now and then a 3x3 block shifts both genes together
  if(frame % 6 == 0){
    vec3 m = pcg(uvec3(p/3, frame/6 + 7919));
    if(m.x < mu){g += (m.yz - .5)*2.*sig;g = vec2(fract(g.x), clamp(g.y, 0., 1.));}
  }

  vec2 uv = (vec2(p) + .5)/float(N);
  float wet = rain(uv);
  float f = mix(box.x, box.y, wet), k = .066 - .021*exp(-(f - .01)/.022) + (g.y - .5)*box.z;
  // spent soil sickens the lineage that spent it, and its close kin: their kill rate rises. Another lineage lives there freely.
  // Lightly used soil is safe, so sparse life can settle; heavily used soil is lethal, so a dense bloom crashes.
  vec2 me = dir(g.x);
  float sg = 6.2831853*kin;
  k += kP*smoothstep(.25, .75, 1. - S)*exp((dot(me, own) - 1.)/(sg*sg));
  float uvv = U*V*V;
  U += DU*lap.x - uvv + f*(1. - U);
  V += DV*lap.y + uvv - (f + k)*V;
  float spend = cS*V*S, spent = 1. - S;
  own = (own*spent + me*spend)/max(spent + spend, 1e-6);
  S += DS*lap.z + rS*(.4 + 1.2*wet)*(1. - S) - spend;
  T = max(T*.9985, V);

  if(brush.w > 0.){
    vec2 d = abs(vec2(p) + .5 - brush.xy);
    d = min(d, float(N) - d);
    float e = length(d)/brush.z;
    if(e < 1.){
      if(brush.w < 1.5){
        if(r.y < .3){V = max(V, .5);U = min(U, .5);g = bgene;}
      } else {V *= smoothstep(.55, 1., e);T *= .5;}
    }
  }
  oA = vec4(clamp(U, 0., 1.), clamp(V, 0., 1.), clamp(S, 0., 1.), T);
  oB = vec4(g, own);
}`;

const SHOW = COMMON + `
uniform vec2 res, ctr;
uniform float zoom;
uniform int mode;
uniform vec4 ring;      // brush preview: x, y (texels), radius, on
out vec4 o;
// bilinear by hand (float filtering is an optional extension). Strain colour is blended as colour, weighted by the life that
// carries it: blending the genes themselves would invent hues that are not there.
void smp(vec2 x, out vec4 a, out vec3 g, out vec2 own){
  x -= .5;
  ivec2 i = ivec2(floor(x));vec2 f = x - floor(x);
  a = vec4(0.);g = vec3(0.);own = vec2(0.);float gw = 0.;
  for(int k = 0; k < 4; k++){
    ivec2 d = ivec2(k & 1, k >> 1);
    float wt = (d.x == 1 ? f.x : 1. - f.x)*(d.y == 1 ? f.y : 1. - f.y);
    vec4 s = fa(i + d);
    float lw = wt*(max(s.y, s.w*.5) + 1e-4);
    vec4 b = fb(i + d);
    a += wt*s;g += lw*strain(b.xy);own += wt*b.zw;gw += lw;
  }
  g /= gw;
}
void main(){
  vec2 x = ctr + (gl_FragCoord.xy - .5*res)/zoom;
  vec4 a;vec3 sc, gg;vec2 own, oo;smp(x, a, sc, own);
  vec4 ax, ay;
  float e = max(1., 1.2/zoom);
  smp(x + vec2(e, 0.), ax, gg, oo);smp(x + vec2(0., e), ay, gg, oo);
  float U = a.x, V = a.y, S = a.z, T = a.w;
  vec3 col;
  if(mode == 2){
    // land: dry is sand, wet is teal; spent soil carries the colour of the lineage that spent it
    float wet = rain(x/float(N));
    vec3 land = mix(vec3(.3, .2, .1), vec3(.04, .3, .3), wet);
    float who = length(own);
    col = mix(mix(vec3(.08), hsv(atan(own.y, own.x)/6.2831853, .9, .8), who), land, S*S);
    col = mix(col, vec3(1.), .6*smoothstep(.08, .3, V));
  } else {
    float body = smoothstep(.06, .26, V);
    if(mode == 1){
      col = sc*(.12 + .88*smoothstep(.02, .2, max(V, T*.6)));
    } else {
      // lit from the upper left, as a relief of V
      vec3 nrm = normalize(vec3(-(ax.y - a.y)/e, -(ay.y - a.y)/e, .09));
      float dif = max(dot(nrm, normalize(vec3(-.5, .6, .62))), 0.);
      float spec = pow(max(dot(nrm, normalize(vec3(-.35, .42, .84))), 0.), 24.);
      float wet = rain(x/float(N));
      vec3 so = hsv(atan(own.y, own.x)/6.2831853, .85, 1.)*length(own);
      vec3 ground = mix(so*so*.14 + .012, mix(vec3(.05, .034, .018), vec3(.008, .04, .052), wet), S);   // dry sand, wet teal; spent soil is stained by whoever spent it
      ground += sc*sc*T*.16*(1. - body);                                      // where life has just been
      ground += vec3(.03, .05, .07)*(1. - U)*(1. - body);                     // eaten food
      col = mix(ground, sc*(.3 + .85*dif) + spec*.45, body);
    }
  }
  if(ring.w > 0.){
    vec2 d = abs(x - ring.xy);d = min(d, float(N) - d);
    float rr = abs(length(d) - ring.z)*zoom;
    col += vec3(.8)*(1. - smoothstep(.6, 1.6, rr))*ring.w;
  }
  vec2 v = gl_FragCoord.xy/res - .5;
  col *= 1. - .55*dot(v, v);
  o = vec4(col, 1.);
}`;

// census: a coarse grid of point samples, read back as bytes
const STAT = COMMON + `
uniform int frame;
out vec4 o;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  int s = N/64;
  ivec2 p = c*s + ivec2((frame*7) % s, (frame*13) % s);
  vec4 a = fa(p);
  o = vec4(fb(p).xy, min(a.y*2.5, 1.), a.z);
}`;

function prog(fs) {
  const p = gl.createProgram();
  for (const [t, s] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(t);
    gl.shaderSource(sh, s);gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return {p, u};
}
const sim = prog(SIM), show = prog(SHOW), stat = prog(STAT);
gl.bindVertexArray(gl.createVertexArray());

function tex(w, h, ifmt, fmt, type, data) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
  return t;
}
function target() {
  const a = tex(N, N, gl.RGBA32F, gl.RGBA, gl.FLOAT, null), b = tex(N, N, gl.RGBA32F, gl.RGBA, gl.FLOAT, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {$('fail').hidden = false;throw new Error('float framebuffer incomplete')}
  return {a, b, fbo};
}
let src = target(), dst = target();
const SG = 64;
const statFbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, statFbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex(SG, SG, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null), 0);
const census = new Uint8Array(SG * SG * 4);

// ---- world ----
let frame = 0, paused = false, stepsPF = 8, cap = 24, view = 0;
const shots = [];                         // one-step stamps: {x, y, r, mode, g}
let held = null;                          // the user's brush while a pointer is down
let sel = [0.08, 0.5];                   // strain on the brush (gene units)
const rnd = (a, b) => a + Math.random() * (b - a);
const founder = () => [Math.random(), rnd(.25, .75)];
function reset() {
  const a = new Float32Array(N * N * 4), b = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {a[i * 4] = 1;a[i * 4 + 2] = 1;b[i * 4] = .3;b[i * 4 + 1] = .5}
  for (const t of [src, dst]) {
    gl.bindTexture(gl.TEXTURE_2D, t.a);gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, a);
    gl.bindTexture(gl.TEXTURE_2D, t.b);gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, b);
  }
  frame = 0;shots.length = 0;hist.length = 0;
  sow(Math.round(14 * (N / 512) ** 2) + 4);
}
function sow(n) {for (let i = 0; i < n; i++) shots.push({x: rnd(0, N), y: rnd(0, N), r: rnd(7, 16), mode: 1, g: founder()})}
function cataclysm() {
  for (let i = 0; i < 5; i++) shots.push({x: rnd(0, N), y: rnd(0, N), r: rnd(.08, .2) * N, mode: 2, g: sel});
  say('cataclysm');
}

const clock = () => 2 * Math.PI * (frame % P.year) / P.year + 1;
function step(n) {
  gl.useProgram(sim.p);
  gl.viewport(0, 0, N, N);
  gl.uniform1i(sim.u.A, 0);gl.uniform1i(sim.u.B, 1);gl.uniform1i(sim.u.N, N);
  gl.uniform1f(sim.u.mu, P.mu);gl.uniform1f(sim.u.sig, P.sig);gl.uniform1f(sim.u.rS, P.rS);gl.uniform1f(sim.u.cS, P.cS);gl.uniform1f(sim.u.kin, P.kin);gl.uniform1f(sim.u.kP, P.kP);
  gl.uniform3f(sim.u.box, F0, F1, P.KW ?? KW);
  for (let i = 0; i < n; i++) {
    const s = shots.shift() || held;
    if (s) {gl.uniform4f(sim.u.brush, s.x, s.y, s.r, s.mode);gl.uniform2f(sim.u.bgene, s.g[0], s.g[1])} else gl.uniform4f(sim.u.brush, 0, 0, 0, 0);
    gl.uniform1f(sim.u.clock, clock());
    gl.uniform1i(sim.u.frame, frame++);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D, src.a);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D, src.b);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    [src, dst] = [dst, src];
  }
}

// ---- camera: centre in texels, zoom in device pixels per texel. The world is a torus, so any view is full. ----
let cx = N / 2, cy = N / 2, zoom = 1, dpr = 1, W = 1, H = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr), first = W === 1;
  if (w === W && h === H) return;
  const k = first ? 1 : Math.max(w, h) / Math.max(W, H);
  W = canvas.width = w;H = canvas.height = h;
  zoom = first ? Math.max(W, H) / N : zoom * k;
}
const zmin = () => Math.min(W, H) / N * .5, zclamp = z => Math.min(48 * dpr, Math.max(zmin(), z));
const toWorld = (px, py) => [cx + (px * dpr - W / 2) / zoom, cy + (H / 2 - py * dpr) / zoom];
const wrap = v => ((v % N) + N) % N;
function zoomAt(px, py, k) {
  const [wx, wy] = toWorld(px, py), z = zclamp(zoom * k);
  cx = wx - (px * dpr - W / 2) / z;cy = wy - (H / 2 - py * dpr) / z;zoom = z;
}

function draw(ring) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);
  gl.useProgram(show.p);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D, src.a);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D, src.b);
  gl.uniform1i(show.u.A, 0);gl.uniform1i(show.u.B, 1);gl.uniform1i(show.u.N, N);
  gl.uniform2f(show.u.res, W, H);gl.uniform2f(show.u.ctr, cx, cy);gl.uniform1f(show.u.zoom, zoom);gl.uniform1i(show.u.mode, view);gl.uniform1f(show.u.clock, clock());
  gl.uniform4f(show.u.ring, ring ? ring[0] : 0, ring ? ring[1] : 0, brushR(), ring ? ring[2] : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ---- census, readout, gene map ----
const hist = [];                 // {life, soil, kinds}
let life = 0, soil = 1, kinds = 0, barren = 0, lastSay = 0;
const occ = new Uint16Array(36);
function count() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, statFbo);
  gl.viewport(0, 0, SG, SG);
  gl.useProgram(stat.p);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D, src.a);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D, src.b);
  gl.uniform1i(stat.u.A, 0);gl.uniform1i(stat.u.B, 1);gl.uniform1i(stat.u.N, N);gl.uniform1i(stat.u.frame, frame);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.readPixels(0, 0, SG, SG, gl.RGBA, gl.UNSIGNED_BYTE, census);
  let n = 0, s = 0;occ.fill(0);
  for (let i = 0; i < census.length; i += 4) {
    s += census[i + 3];
    if (census[i + 2] > 50) {n++;occ[census[i] * 36 >> 8]++}
  }
  life = n / (SG * SG);soil = s / (SG * SG * 255);
  kinds = 0;for (let j = 0; j < occ.length; j++) if (occ[j] > 3) kinds++;   // occupied bins of the hue circle
  hist.push({life, soil, kinds});if (hist.length > 170) hist.shift();
}
function phase() {
  const n = hist.length, then = hist[Math.max(0, n - 13)], d = then ? life - then.life : 0;
  if (life < .004) return ['barren', '#6f7d8f'];
  if (d > .025) return ['bloom', '#ffd166'];
  if (d < -.025) return ['crash', '#ff5a45'];
  return [life > .3 ? 'crowded' : 'settled', '#3fb8a5'];
}
function say(t) {const e = $('ev');e.textContent = t;e.classList.add('on');lastSay = performance.now()}
const pctx = $('plot').getContext('2d'), gctx = $('gmap').getContext('2d');
function hud() {
  const [name, colr] = phase();
  $('ph').textContent = name;$('dot').style.background = colr;$('dot').style.color = colr;
  $('cnt').textContent = `t ${(frame / 1000).toFixed(1)}k · life ${Math.round(life * 100)}% · soil ${Math.round(soil * 100)}%`;
  if (performance.now() - lastSay > 2500) $('ev').classList.remove('on');
  const w = 340, h = 80;
  pctx.clearRect(0, 0, w, h);
  const line = (k, sc, col) => {
    pctx.beginPath();
    hist.forEach((p, i) => {const x = w - (hist.length - 1 - i) * 2, y = h - 3 - Math.min(1, p[k] * sc) * (h - 6);i ? pctx.lineTo(x, y) : pctx.moveTo(x, y)});
    pctx.strokeStyle = col;pctx.lineWidth = 2;pctx.stroke();
  };
  line('soil', 1, '#3fb8a5');line('kinds', 1 / 36, '#c48bff');line('life', 1.6, '#ffd166');
  gmap();
}
// the same colour function as the shader, for the legend
function strainRGB(gx, gy) {
  const h = gx, s = .95 + (.5 - .95) * gy;
  const c = [0, 2 / 3, 1 / 3].map(o => {const k = Math.min(1, Math.max(0, Math.abs(((h + o) % 1) * 6 - 3) - 1));return 1 + (k - 1) * s});
  const d = 1 - (.3 * c[0] + .59 * c[1] + .11 * c[2]);
  return c.map(v => 255 * (v + (1 - v) * .5 * d * d));
}
const GM = 300, legend = (() => {
  const c = document.createElement('canvas');c.width = c.height = GM;
  const x = c.getContext('2d'), im = x.createImageData(GM, GM);
  for (let j = 0; j < GM; j++) for (let i = 0; i < GM; i++) {
    const [r, g, b] = strainRGB(i / GM, 1 - j / GM), o = (j * GM + i) * 4;
    im.data[o] = r * .22;im.data[o + 1] = g * .22;im.data[o + 2] = b * .22;im.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0);return c;
})();
function gmap() {
  gctx.globalCompositeOperation = 'source-over';
  gctx.drawImage(legend, 0, 0);
  gctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < census.length; i += 4 * 2) {
    if (census[i + 2] <= 50) continue;
    const gx = census[i] / 255, gy = census[i + 1] / 255, [r, g, b] = strainRGB(gx, gy);
    gctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},.5)`;
    gctx.fillRect(gx * GM - 2, (1 - gy) * GM - 2, 4, 4);
  }
  gctx.globalCompositeOperation = 'source-over';
  const x = sel[0] * GM, y = (1 - sel[1]) * GM;
  gctx.strokeStyle = '#fff';gctx.lineWidth = 2;
  gctx.beginPath();gctx.arc(x, y, 9, 0, 7);gctx.moveTo(x - 15, y);gctx.lineTo(x - 5, y);gctx.moveTo(x + 5, y);gctx.lineTo(x + 15, y);gctx.moveTo(x, y - 15);gctx.lineTo(x, y - 5);gctx.moveTo(x, y + 5);gctx.lineTo(x, y + 15);gctx.stroke();
}
function setSel(g) {
  sel = [Math.min(1, Math.max(0, g[0])), Math.min(1, Math.max(0, g[1]))];
  $('gsel').textContent = `greed ${Math.round((1 - sel[1]) * 100)}%`;
  gmap();
}
function pickAt(px, py) {
  const [wx, wy] = toWorld(px, py), out = new Float32Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
  gl.readBuffer(gl.COLOR_ATTACHMENT1);
  gl.readPixels(wrap(wx) | 0, wrap(wy) | 0, 1, 1, gl.RGBA, gl.FLOAT, out);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  setSel([out[0], out[1]]);say('strain picked');
}

// ---- input ----
let tool = 'seed', bsize = 9;
const brushR = () => tool === 'wipe' ? bsize * 2.2 : bsize;
const pts = new Map();
let mouse = null, pinch = null, hintGone = false;
const tools = {seed: $('tSeed'), wipe: $('tWipe'), pick: $('tPick'), pan: $('tPan')};
function setTool(t) {tool = t;for (const k in tools) tools[k].setAttribute('aria-pressed', k === t);canvas.classList.toggle('pan', t === 'pan')}
for (const k in tools) tools[k].onclick = () => setTool(k);
const views = [$('v0'), $('v1'), $('v2')];
function setView(v) {view = v;views.forEach((b, i) => b.setAttribute('aria-pressed', i === v))}
views.forEach((b, i) => b.onclick = () => setView(i));
function setPaused(v) {paused = v;$('pause').setAttribute('aria-pressed', v);$('pause').textContent = v ? 'play' : 'pause'}
$('pause').onclick = () => setPaused(!paused);
$('spd').oninput = e => {stepsPF = +e.target.value};
const setMut = v => {P.mu = v <= 0 ? 0 : 2e-5 * Math.pow(10, v / 100 * 2.5)};      // log scale, 2e-5 to 6e-3 per block per 6 steps
$('mut').oninput = e => setMut(+e.target.value);setMut(+$('mut').value);
$('cat').onclick = cataclysm;
$('new').onclick = () => {reset();say('new dish')};

const act = e => e.pointerType === 'mouse' && (e.button === 2 || e.button === 1) ? 'pan' : e.altKey ? 'pick' : tool;
function brushAt(e, mode) {const [x, y] = toWorld(e.clientX, e.clientY);held = {x: wrap(x), y: wrap(y), r: brushR(), mode, g: sel}}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  if (!hintGone) {hintGone = true;$('hint').style.opacity = 0}
  pts.set(e.pointerId, {x: e.clientX, y: e.clientY, a: act(e)});
  if (pts.size === 2) {held = null;const [a, b] = [...pts.values()];pinch = {d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};return}
  const a = act(e);
  if (a === 'pick') pickAt(e.clientX, e.clientY);
  else if (a !== 'pan') brushAt(e, a === 'wipe' ? 2 : 1);
});
canvas.addEventListener('pointermove', e => {
  mouse = e.pointerType === 'mouse' ? [e.clientX, e.clientY] : null;
  const p = pts.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX;p.y = e.clientY;
  if (pts.size === 2 && pinch) {
    const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    cx -= (mx - pinch.x) * dpr / zoom;cy += (my - pinch.y) * dpr / zoom;
    zoomAt(mx, my, d / Math.max(1, pinch.d));
    pinch = {d, x: mx, y: my};
  } else if (p.a === 'pan') {cx -= dx * dpr / zoom;cy += dy * dpr / zoom}
  else if (p.a === 'pick') pickAt(e.clientX, e.clientY);
  else if (held) brushAt(e, held.mode);
});
const up = e => {pts.delete(e.pointerId);held = null;pinch = null};
canvas.addEventListener('pointerup', up);canvas.addEventListener('pointercancel', up);
canvas.addEventListener('pointerleave', () => {mouse = null});
canvas.addEventListener('wheel', e => {e.preventDefault();zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015)))}, {passive: false});
const gm = $('gmap');
const gpick = e => {const r = gm.getBoundingClientRect();setSel([(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height]);if (tool !== 'seed') setTool('seed')};
gm.addEventListener('pointerdown', e => {gm.setPointerCapture(e.pointerId);gpick(e)});
gm.addEventListener('pointermove', e => {if (e.buttons) gpick(e)});
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === 'p' || k === ' ') {setPaused(!paused);e.preventDefault()}
  else if (k === 's') setTool('seed'); else if (k === 'w') setTool('wipe'); else if (k === 'm') setTool('pan');
  else if (k === '1' || k === '2' || k === '3') setView(+k - 1);
  else if (k === 'c') cataclysm(); else if (k === 'n') {reset();say('new dish')}
  else if (k === '[') bsize = Math.max(3, bsize / 1.25); else if (k === ']') bsize = Math.min(60, bsize * 1.25);
  else if (k === 'r') {cx = cy = N / 2;zoom = Math.max(W, H) / N}
});
addEventListener('resize', resize);

// ---- loop ----
let last = performance.now(), slow = 0, tick = 0;
function loop(now) {
  resize();
  const dt = now - last;last = now;
  // keep the frame rate: drop sim steps when frames run long, give them back when there is room
  if (dt > 26) {if (++slow > 4 && cap > 2) {cap--;slow = 0}} else if (dt < 19 && cap < 24 && tick % 30 === 0) cap++;
  if (!paused) step(Math.min(stepsPF, cap));
  else if (held || shots.length) step(1);
  if (tick++ % 12 === 0) {
    count();
    if (!paused && frame > 400) {
      barren = life < .004 ? barren + 1 : 0;
      if (barren > 8) {sow(5);barren = 0;say('spores arrive')}        // an empty dish is reseeded from outside
    }
    hud();
  }
  const ring = mouse && !pts.size && tool !== 'pan' && tool !== 'pick' ? [...toWorld(mouse[0], mouse[1]), .35] : null;
  draw(ring);
  requestAnimationFrame(loop);
}
resize();
reset();
setSel(sel);
setTimeout(() => {if (!hintGone) {hintGone = true;$('hint').style.opacity = 0}}, 14000);
window.__petri = {step, shots,  count, reset, sow, P, N, stats: () => ({frame, life, soil, kinds}), census, view: setView, pause: setPaused,
  cam: (x, y, z) => {cx = x;cy = y;zoom = z * dpr}};
requestAnimationFrame(loop);
