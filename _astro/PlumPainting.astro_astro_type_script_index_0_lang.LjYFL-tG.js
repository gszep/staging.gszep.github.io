import{W as O,c as f,a as F,f as L}from"./fullscreen.vertex.DM5TiE_a.js";const H=`// Sumi-e ink wash NPR rendering with physarum-generated brush strokes.
// Composites: washi paper + physarum trail ink + sky wash + blossom pink.
// Sky detection reuses the tree mask from erosion-extract (no video sampling needed).

#import fullscreen_vertex

struct Params {
  size: vec2f,
  branch_ink: f32,     // branch stroke opacity
  sky_ink: f32,        // sky wash opacity
  paper_tone: f32,     // paper brightness
  blossom_ink: f32,    // pink blossom overlay strength
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var eroded: texture_2d<f32>;    // blurred classification
@group(0) @binding(2) var original: texture_2d<f32>;   // sharp original mask
@group(0) @binding(3) var trail_tex: texture_2d<f32>;  // physarum trail

// ── Noise primitives ──────────────────────────────────────

#import hash21

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x),
    mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0u; i < 3u; i++) {
    v += a * vnoise(q);
    q *= 2.01;
    a *= 0.5;
  }
  return v;
}

// ── Main ──────────────────────────────────────────────────

@fragment
fn frag(in: VSOut) -> @location(0) vec4f {
  let px = in.uv * params.size;
  let uv = vec2f(in.uv.x, 1.0 - in.uv.y);

  // ── Paper ─────────────────────────────────────────────
  let grain = fbm(px * 0.35) * 0.03 + fbm(px * 0.08) * 0.015;
  let pt = params.paper_tone;
  let paper = vec3f(pt, pt - 0.01, pt - 0.03) - grain;

  // ── Texture coordinate for mask/trail lookups ─────────
  let sz = vec2i(params.size);
  let mask_coord = clamp(vec2i(uv * params.size), vec2i(0), sz - 1);

  // ── Sky from tree mask (sky = where trees aren't) ─────
  let sky = 1.0 - textureLoad(original, mask_coord, 0).r;

  // ── Physarum trail → branch ink ───────────────────────
  let trail_val = textureLoad(trail_tex, mask_coord, 0).r;
  let trail_ink = smoothstep(0.0, 1.5, trail_val) * params.branch_ink;

  // ── Composite ─────────────────────────────────────────
  let sky_ink    = sky * params.sky_ink;
  let ink_col    = vec3f(0.06, 0.05, 0.08);
  let total_ink  = clamp(trail_ink + sky_ink, 0.0, 1.0);
  let base       = mix(paper, ink_col, total_ink);

  // ── Blossom overlay from eroded mask ──────────────────
  let classify = step(0.5, textureLoad(eroded, mask_coord, 0).r);
  let sharp    = textureLoad(original, mask_coord, 0).r;
  let blossom  = sharp * classify;
  let pink     = vec3f(0.85, 0.50, 0.55);
  let out      = mix(base, pink, blossom * params.blossom_ink);

  return vec4f(out, 1.0);
}
`,U=`// Extract tree silhouette mask from video luminance.
// Renders to an r32float texture: 1.0 = tree, 0.0 = sky.

#import fullscreen_vertex

struct Params {
  size: vec2f,
  threshold: f32,
};

@group(0) @binding(0) var video: texture_external;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> params: Params;

@fragment
fn frag(in: VSOut) -> @location(0) vec4f {
  let uv = vec2f(in.uv.x, 1.0 - in.uv.y);
  let c  = textureSampleBaseClampToEdge(video, samp, uv).rgb;
  let l  = dot(c, vec3f(0.299, 0.587, 0.114));
  let t  = params.threshold;
  let mask = 1.0 - smoothstep(t + 0.15, t - 0.15, l);
  return vec4f(mask, 0.0, 0.0, 1.0);
}
`,z=`// In-place 5x5 box blur with workgroup cache.
// Dispatch repeatedly for morphological erosion effect:
// thin structures (branches) erode away, fat structures (blossoms) survive.

requires readonly_and_readwrite_storage_textures;

const WG: u32 = 8u;
const TILE: u32 = 2u;
const HALO: u32 = 2u;                   // 5x5 kernel radius
const CACHE: u32 = TILE * WG;           // 16
const INNER: u32 = CACHE - 2u * HALO;   // 12

var<workgroup> tile: array<array<f32, CACHE>, CACHE>;

@group(0) @binding(0) var mask: texture_storage_2d<r32float, read_write>;

@compute @workgroup_size(WG, WG)
fn blur(@builtin(local_invocation_id) lid: vec3u,
        @builtin(workgroup_id) wid: vec3u) {
  let dims = textureDimensions(mask);
  let origin = vec2i(wid.xy) * i32(INNER) - i32(HALO);

  // Load TILE x TILE cells per thread into shared memory
  for (var ty = 0u; ty < TILE; ty++) {
    for (var tx = 0u; tx < TILE; tx++) {
      let li = vec2u(lid.x * TILE + tx, lid.y * TILE + ty);
      let gi = clamp(origin + vec2i(li), vec2i(0), vec2i(dims) - 1);
      tile[li.y][li.x] = textureLoad(mask, gi).r;
    }
  }

  workgroupBarrier();

  // Write inner cells with 5x5 box average
  for (var ty = 0u; ty < TILE; ty++) {
    for (var tx = 0u; tx < TILE; tx++) {
      let li = vec2u(lid.x * TILE + tx, lid.y * TILE + ty);
      if (li.x < HALO || li.x >= CACHE - HALO ||
          li.y < HALO || li.y >= CACHE - HALO) { continue; }

      let gi = origin + vec2i(li);
      if (gi.x < 0 || gi.y < 0 || u32(gi.x) >= dims.x || u32(gi.y) >= dims.y) { continue; }

      var sum = 0.0;
      for (var dy = -2i; dy <= 2i; dy++) {
        for (var dx = -2i; dx <= 2i; dx++) {
          sum += tile[u32(i32(li.y) + dy)][u32(i32(li.x) + dx)];
        }
      }

      textureStore(mask, gi, vec4f(sum / 25.0, 0.0, 0.0, 0.0));
    }
  }
}
`,R=`// Extract color-based attraction field from video.
// Agents are attracted to regions whose color is close to a target color
// (e.g. dark green branches in the plum blossom footage).

#import fullscreen_vertex

struct Params {
  size: vec2f,
  threshold: f32,       // luminance darkness threshold
  tolerance: f32,       // color distance radius (smaller = stricter match)
  target_r: f32,        // target color R [0,1]
  target_g: f32,        // target color G [0,1]
  target_b: f32,        // target color B [0,1]
};

@group(0) @binding(0) var video: texture_external;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var mask: texture_2d<f32>;  // tree=1, sky=0

@fragment
fn frag(in: VSOut) -> @location(0) vec4f {
  let uv = vec2f(in.uv.x, 1.0 - in.uv.y);
  let c  = textureSampleBaseClampToEdge(video, samp, uv).rgb;

  // Color proximity: how close is this pixel to the target color?
  let tgt = vec3f(params.target_r, params.target_g, params.target_b);
  let dist = distance(c, tgt);
  let attract = smoothstep(params.tolerance, 0.0, dist);

  // Sky repulsion: reuse the tree/sky mask (0=sky → strong repulsion)
  let coord = vec2i(uv * params.size);
  let tree = textureLoad(mask, coord, 0).r;
  let sky = (1.0 - tree) * 2.0;  // doubled repulsion strength

  return vec4f(attract - sky, 0.0, 0.0, 1.0);
}
`,N=`// Physarum agent step: sense trail + attraction field → turn → move → deposit.
// Agents self-organize into filamentary structures along regions of high
// attraction (dark green branches in the plum blossom video).

requires readonly_and_readwrite_storage_textures;

#import physarum_params
#import hash21

@group(0) @binding(0) var<storage, read_write> agents: array<vec4f>;
@group(0) @binding(1) var trail: texture_storage_2d<r32float, read_write>;
@group(0) @binding(2) var attract: texture_2d<f32>;   // dark green attraction field
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var mask: texture_2d<f32>;       // tree=1, sky=0

fn sense(pos: vec2f, angle: f32) -> f32 {
  let dir = vec2f(cos(angle), sin(angle));
  let sp = pos + dir * params.sensor_dist;
  let sz = vec2i(params.size);
  let coord = clamp(vec2i(sp), vec2i(0), sz - 1);

  let trail_val = textureLoad(trail, coord).r;
  let attract_val = textureLoad(attract, coord, 0).r;

  return trail_val + params.mask_weight * attract_val;
}

@compute @workgroup_size(256)
fn agents_step(@builtin(global_invocation_id) id: vec3u) {
  let idx = id.x;
  if (idx >= u32(params.num_agents)) { return; }

  var agent = agents[idx];
  let pos = agent.xy;
  let heading = agent.z;
  let sz = params.size;

  // Sense at three positions
  let left   = sense(pos, heading - params.sensor_angle);
  let center = sense(pos, heading);
  let right  = sense(pos, heading + params.sensor_angle);

  // Stochastic element
  let rng = hash21(pos * 0.1 + vec2f(params.time * 13.7, f32(idx) * 0.01));

  // Boost turn speed outside tree mask (agents return to branches faster)
  let mc = clamp(vec2i(pos), vec2i(0), vec2i(params.size) - 1);
  let raw_mask = textureLoad(mask, mc, 0).r;
  let tree = smoothstep(params.agent_threshold - 0.15, params.agent_threshold + 0.15, raw_mask);
  let ts = params.turn_speed * mix(4.0, 1.0, tree);  // 4x turn speed in sky

  // Turn decision
  var h = heading;
  if (center > left && center > right) {
    // Continue straight with tiny noise
    h += (rng - 0.5) * 0.1;
  } else if (center < left && center < right) {
    // Both sides better → random turn
    h += (rng - 0.5) * 2.0 * ts;
  } else if (left > right) {
    h -= ts;
  } else {
    h += ts;
  }

  // Move
  var np = pos + vec2f(cos(h), sin(h)) * params.speed;

  // Wrap boundaries
  np = fract(np / sz) * sz;

  // Update agent
  agents[idx] = vec4f(np, h, 0.0);

  // Deposit trail at new position
  let dc = clamp(vec2i(np), vec2i(0), vec2i(sz) - 1);
  let cur = textureLoad(trail, dc).r;
  textureStore(trail, dc, vec4f(min(cur + params.deposit, 5.0), 0.0, 0.0, 0.0));
}
`,W=`// Trail diffusion + decay. 3×3 mean blur with configurable mix and decay.
// Uses tiled workgroup cache with halo for race-free stencil operations.
// Dispatch: ceil(width / INNER) × ceil(height / INNER) workgroups.

requires readonly_and_readwrite_storage_textures;

#import physarum_params

const WG: u32 = 8u;
const TILE: u32 = 2u;
const HALO: u32 = 1u;
const CACHE: u32 = TILE * WG;           // 16
const INNER: u32 = CACHE - 2u * HALO;   // 14

var<workgroup> tile: array<array<f32, CACHE>, CACHE>;

@group(0) @binding(0) var trail: texture_storage_2d<r32float, read_write>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var mask: texture_2d<f32>;  // tree=1, sky=0

@compute @workgroup_size(WG, WG)
fn diffuse(@builtin(local_invocation_id) lid: vec3u,
           @builtin(workgroup_id) wid: vec3u) {
  let dims = textureDimensions(trail);
  let origin = vec2i(wid.xy) * i32(INNER) - i32(HALO);

  // Load TILE × TILE cells per thread into shared memory
  for (var ty = 0u; ty < TILE; ty++) {
    for (var tx = 0u; tx < TILE; tx++) {
      let li = vec2u(lid.x * TILE + tx, lid.y * TILE + ty);
      let gi = clamp(origin + vec2i(li), vec2i(0), vec2i(dims) - 1);
      tile[li.y][li.x] = textureLoad(trail, gi).r;
    }
  }

  workgroupBarrier();

  // Write inner cells: 3×3 blur mixed with center, then decay
  for (var ty = 0u; ty < TILE; ty++) {
    for (var tx = 0u; tx < TILE; tx++) {
      let li = vec2u(lid.x * TILE + tx, lid.y * TILE + ty);
      if (li.x < HALO || li.x >= CACHE - HALO ||
          li.y < HALO || li.y >= CACHE - HALO) { continue; }

      let gi = origin + vec2i(li);
      if (gi.x < 0 || gi.y < 0 || u32(gi.x) >= dims.x || u32(gi.y) >= dims.y) { continue; }

      var sum = 0.0;
      for (var dy = -1i; dy <= 1i; dy++) {
        for (var dx = -1i; dx <= 1i; dx++) {
          sum += tile[u32(i32(li.y) + dy)][u32(i32(li.x) + dx)];
        }
      }

      let blurred = sum / 9.0;
      let center = tile[li.y][li.x];
      let diffused = mix(center, blurred, params.diffuse_weight);

      // Faster decay outside tree mask (trails fade quickly in sky)
      let raw_mask = textureLoad(mask, gi, 0).r;
      let tree = smoothstep(params.agent_threshold - 0.15, params.agent_threshold + 0.15, raw_mask);
      let decay = mix(params.decay * 0.5, params.decay, tree);
      textureStore(trail, gi, vec4f(diffused * decay, 0.0, 0.0, 0.0));
    }
  }
}
`,T=`// Shared hash function for pseudo-random number generation.
// Used by physarum agents (stochastic turns) and brush-stroke render (paper noise).

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(p.xyx * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`,D=`// Shared physarum parameter struct.
// Used by both physarum-agents.compute.wgsl and physarum-diffuse.compute.wgsl.

struct Params {
  size: vec2f,
  num_agents: f32,
  time: f32,
  sensor_dist: f32,
  sensor_angle: f32,
  turn_speed: f32,
  deposit: f32,
  speed: f32,
  mask_weight: f32,
  decay: f32,
  diffuse_weight: f32,
  agent_threshold: f32,
};
`,X=`// 4x downsample with box-filter average.
// Each output pixel averages a 4x4 block from the source texture.

const SCALE: u32 = 2u;
const WG: u32 = 8u;

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;

@compute @workgroup_size(WG, WG)
fn downsample(@builtin(global_invocation_id) gid: vec3u) {
  let dst_dims = textureDimensions(dst);
  if (gid.x >= dst_dims.x || gid.y >= dst_dims.y) { return; }

  let base = vec2i(gid.xy) * i32(SCALE);
  let src_max = vec2i(textureDimensions(src)) - 1;

  var sum = 0.0;
  for (var dy = 0i; dy < i32(SCALE); dy++) {
    for (var dx = 0i; dx < i32(SCALE); dx++) {
      let c = clamp(base + vec2i(dx, dy), vec2i(0), src_max);
      sum += textureLoad(src, c, 0).r;
    }
  }

  textureStore(dst, vec2i(gid.xy), vec4f(sum / f32(SCALE * SCALE), 0.0, 0.0, 0.0));
}
`,Y=`// Bilinear upsample from a small texture to a larger output.
// Each output pixel interpolates between the 4 nearest source texels.

const WG: u32 = 8u;

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;

@compute @workgroup_size(WG, WG)
fn upsample(@builtin(global_invocation_id) gid: vec3u) {
  let dst_dims = textureDimensions(dst);
  if (gid.x >= dst_dims.x || gid.y >= dst_dims.y) { return; }

  let src_dims = vec2f(textureDimensions(src));
  let dst_dimsf = vec2f(dst_dims);

  // Map output pixel center to source coordinate
  let uv = (vec2f(gid.xy) + 0.5) / dst_dimsf;
  let sc = uv * src_dims - 0.5;

  let base = vec2i(floor(sc));
  let f    = fract(sc);
  let smax = vec2i(src_dims) - 1;

  let c00 = textureLoad(src, clamp(base,              vec2i(0), smax), 0).r;
  let c10 = textureLoad(src, clamp(base + vec2i(1,0), vec2i(0), smax), 0).r;
  let c01 = textureLoad(src, clamp(base + vec2i(0,1), vec2i(0), smax), 0).r;
  let c11 = textureLoad(src, clamp(base + vec2i(1,1), vec2i(0), smax), 0).r;

  let result = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
  textureStore(dst, vec2i(gid.xy), vec4f(result, 0.0, 0.0, 0.0));
}
`,I=12,G=14,q=256,A=2,k=8;class j extends O{video;sampler;paramsBuf;paramsData=new Float32Array(8);extractPL;blurPL;maskOrigTex;maskOrigView;maskBlurTex;maskBlurView;extractParamsBuf;extractParamsData=new Float32Array(8);blurBG;downsamplePL;upsamplePL;maskSmallTex;maskSmallView;downsampleBG;upsampleBG;smallW=0;smallH=0;attractPL;attractTex;attractView;agentsPL;diffusePL;agentsBuf;trailTex;trailView;physarumParamsBuf;physarumParamsData=new Float32Array(16);agentsBG;diffuseBG;numAgents=0;tuning={branchInk:1,skyInk:.3,paperTone:1,maskThreshold:.52,erosionSteps:70,blossomInk:1,attractColor:"#6c896f",colorTolerance:.32,sensorDist:9.5,sensorAngle:.9,turnSpeed:.44,deposit:1.78,trailSpeed:1.5,maskWeight:10,trailDecay:.986,diffuseWeight:0,physarumSteps:16,agentThreshold:0};constructor(t){super({canvas:t.canvas,cellSize:1,updateInterval:t.updateInterval??33}),this.video=t.video}sizeCanvas(){this.video.videoWidth>0?(this.canvas.width=this.video.videoWidth,this.canvas.height=this.video.videoHeight):super.sizeCanvas()}buildPipelines(){const t={fullscreen_vertex:F},e={hash21:T},i={physarum_params:D,hash21:T},n=f(this.device,H,{...t,...e});this.renderPL=this.device.createRenderPipeline({layout:"auto",vertex:{module:n,entryPoint:"vert"},fragment:{module:n,entryPoint:"frag",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}});const l=f(this.device,U,t);this.extractPL=this.device.createRenderPipeline({layout:"auto",vertex:{module:l,entryPoint:"vert"},fragment:{module:l,entryPoint:"frag",targets:[{format:"r32float"}]},primitive:{topology:"triangle-list"}});const a=f(this.device,z);this.blurPL=this.device.createComputePipeline({layout:"auto",compute:{module:a,entryPoint:"blur"}});const c=f(this.device,X);this.downsamplePL=this.device.createComputePipeline({layout:"auto",compute:{module:c,entryPoint:"downsample"}});const m=f(this.device,Y);this.upsamplePL=this.device.createComputePipeline({layout:"auto",compute:{module:m,entryPoint:"upsample"}});const h=f(this.device,R,t);this.attractPL=this.device.createRenderPipeline({layout:"auto",vertex:{module:h,entryPoint:"vert"},fragment:{module:h,entryPoint:"frag",targets:[{format:"r32float"}]},primitive:{topology:"triangle-list"}});const d=f(this.device,N,i);this.agentsPL=this.device.createComputePipeline({layout:"auto",compute:{module:d,entryPoint:"agents_step"}});const u=f(this.device,W,{physarum_params:D});this.diffusePL=this.device.createComputePipeline({layout:"auto",compute:{module:u,entryPoint:"diffuse"}}),this.sampler=this.device.createSampler({magFilter:"linear",minFilter:"linear"})}buildResources(){const t=this.device;this.paramsBuf=t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.extractParamsBuf=t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.maskOrigTex=t.createTexture({size:[this.gw,this.gh],format:"r32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),this.maskOrigView=this.maskOrigTex.createView(),this.smallW=Math.max(1,Math.ceil(this.gw/A)),this.smallH=Math.max(1,Math.ceil(this.gh/A)),this.maskSmallTex=t.createTexture({size:[this.smallW,this.smallH],format:"r32float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING}),this.maskSmallView=this.maskSmallTex.createView(),this.maskBlurTex=t.createTexture({size:[this.gw,this.gh],format:"r32float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING}),this.maskBlurView=this.maskBlurTex.createView(),this.blurBG=t.createBindGroup({layout:this.blurPL.getBindGroupLayout(0),entries:[{binding:0,resource:this.maskSmallView}]}),this.downsampleBG=t.createBindGroup({layout:this.downsamplePL.getBindGroupLayout(0),entries:[{binding:0,resource:this.maskOrigView},{binding:1,resource:this.maskSmallView}]}),this.upsampleBG=t.createBindGroup({layout:this.upsamplePL.getBindGroupLayout(0),entries:[{binding:0,resource:this.maskSmallView},{binding:1,resource:this.maskBlurView}]}),this.attractTex=t.createTexture({size:[this.gw,this.gh],format:"r32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),this.attractView=this.attractTex.createView(),this.numAgents=Math.min(Math.floor(this.gw*this.gh/8),5e5),this.agentsBuf=t.createBuffer({size:this.numAgents*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const e=new Float32Array(this.numAgents*4);for(let i=0;i<this.numAgents;i++){const n=i*4;e[n+0]=Math.random()*this.gw,e[n+1]=Math.random()*this.gh*.5+this.gh*.5,e[n+2]=Math.random()*Math.PI*2,e[n+3]=0}t.queue.writeBuffer(this.agentsBuf,0,e),this.trailTex=t.createTexture({size:[this.gw,this.gh],format:"r32float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING}),this.trailView=this.trailTex.createView(),this.physarumParamsBuf=t.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.agentsBG=t.createBindGroup({layout:this.agentsPL.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.agentsBuf}},{binding:1,resource:this.trailView},{binding:2,resource:this.attractView},{binding:3,resource:{buffer:this.physarumParamsBuf}},{binding:4,resource:this.maskOrigView}]}),this.diffuseBG=t.createBindGroup({layout:this.diffusePL.getBindGroupLayout(0),entries:[{binding:0,resource:this.trailView},{binding:1,resource:{buffer:this.physarumParamsBuf}},{binding:2,resource:this.maskOrigView}]}),this.renderBG=t.createBindGroup({layout:this.renderPL.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.paramsBuf}},{binding:1,resource:this.maskBlurView},{binding:2,resource:this.maskOrigView},{binding:3,resource:this.trailView}]})}destroyResources(){this.paramsBuf.destroy(),this.extractParamsBuf.destroy(),this.maskOrigTex.destroy(),this.maskSmallTex.destroy(),this.maskBlurTex.destroy(),this.attractTex.destroy(),this.agentsBuf.destroy(),this.trailTex.destroy(),this.physarumParamsBuf.destroy()}renderNPR(){if(this.video.readyState<2)return;let t;try{t=this.device.importExternalTexture({source:this.video})}catch{return}const e=this.tuning;this.extractParamsData[0]=this.gw,this.extractParamsData[1]=this.gh,this.extractParamsData[2]=e.maskThreshold;const i=e.attractColor;this.extractParamsData[3]=e.colorTolerance,this.extractParamsData[4]=parseInt(i.slice(1,3),16)/255,this.extractParamsData[5]=parseInt(i.slice(3,5),16)/255,this.extractParamsData[6]=parseInt(i.slice(5,7),16)/255,this.device.queue.writeBuffer(this.extractParamsBuf,0,this.extractParamsData),this.paramsData[0]=this.gw,this.paramsData[1]=this.gh,this.paramsData[2]=e.branchInk,this.paramsData[3]=e.skyInk,this.paramsData[4]=e.paperTone,this.paramsData[5]=e.blossomInk,this.device.queue.writeBuffer(this.paramsBuf,0,this.paramsData),this.physarumParamsData[0]=this.gw,this.physarumParamsData[1]=this.gh,this.physarumParamsData[2]=this.numAgents,this.physarumParamsData[3]=performance.now()/1e3,this.physarumParamsData[4]=e.sensorDist,this.physarumParamsData[5]=e.sensorAngle,this.physarumParamsData[6]=e.turnSpeed,this.physarumParamsData[7]=e.deposit,this.physarumParamsData[8]=e.trailSpeed,this.physarumParamsData[9]=e.maskWeight,this.physarumParamsData[10]=e.trailDecay,this.physarumParamsData[11]=e.diffuseWeight,this.physarumParamsData[12]=e.agentThreshold,this.device.queue.writeBuffer(this.physarumParamsBuf,0,this.physarumParamsData);const n=this.device.createBindGroup({layout:this.extractPL.getBindGroupLayout(0),entries:[{binding:0,resource:t},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.extractParamsBuf}}]}),l=this.device.createBindGroup({layout:this.attractPL.getBindGroupLayout(0),entries:[{binding:0,resource:t},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.extractParamsBuf}},{binding:3,resource:this.maskOrigView}]}),a=this.device.createCommandEncoder();L(a,this.maskOrigView,this.extractPL,n),L(a,this.attractView,this.attractPL,l);{const h=a.beginComputePass();h.setPipeline(this.downsamplePL),h.setBindGroup(0,this.downsampleBG),h.dispatchWorkgroups(Math.ceil(this.smallW/k),Math.ceil(this.smallH/k)),h.end()}const c=Math.max(0,Math.round(e.erosionSteps/A));for(let h=0;h<c;h++){const d=a.beginComputePass();d.setPipeline(this.blurPL),d.setBindGroup(0,this.blurBG),d.dispatchWorkgroups(Math.ceil(this.smallW/I),Math.ceil(this.smallH/I)),d.end()}{const h=a.beginComputePass();h.setPipeline(this.upsamplePL),h.setBindGroup(0,this.upsampleBG),h.dispatchWorkgroups(Math.ceil(this.gw/k),Math.ceil(this.gh/k)),h.end()}const m=Math.max(1,Math.round(e.physarumSteps));for(let h=0;h<m;h++){const d=a.beginComputePass();d.setPipeline(this.agentsPL),d.setBindGroup(0,this.agentsBG),d.dispatchWorkgroups(Math.ceil(this.numAgents/q)),d.end();const u=a.beginComputePass();u.setPipeline(this.diffusePL),u.setBindGroup(0,this.diffuseBG),u.dispatchWorkgroups(Math.ceil(this.gw/G),Math.ceil(this.gh/G)),u.end()}L(a,this.ctx.getCurrentTexture().createView(),this.renderPL,this.renderBG),this.device.queue.submit([a.finish()])}renderFrame(){this.renderNPR()}frame(){this.renderNPR()}}/**
 * lil-gui
 * https://lil-gui.georgealways.com
 * @version 0.21.0
 * @author George Michael Brower
 * @license MIT
 */class g{constructor(t,e,i,n,l="div"){this.parent=t,this.object=e,this.property=i,this._disabled=!1,this._hidden=!1,this.initialValue=this.getValue(),this.domElement=document.createElement(l),this.domElement.classList.add("lil-controller"),this.domElement.classList.add(n),this.$name=document.createElement("div"),this.$name.classList.add("lil-name"),g.nextNameID=g.nextNameID||0,this.$name.id=`lil-gui-name-${++g.nextNameID}`,this.$widget=document.createElement("div"),this.$widget.classList.add("lil-widget"),this.$disable=this.$widget,this.domElement.appendChild(this.$name),this.domElement.appendChild(this.$widget),this.domElement.addEventListener("keydown",a=>a.stopPropagation()),this.domElement.addEventListener("keyup",a=>a.stopPropagation()),this.parent.children.push(this),this.parent.controllers.push(this),this.parent.$children.appendChild(this.domElement),this._listenCallback=this._listenCallback.bind(this),this.name(i)}name(t){return this._name=t,this.$name.textContent=t,this}onChange(t){return this._onChange=t,this}_callOnChange(){this.parent._callOnChange(this),this._onChange!==void 0&&this._onChange.call(this,this.getValue()),this._changed=!0}onFinishChange(t){return this._onFinishChange=t,this}_callOnFinishChange(){this._changed&&(this.parent._callOnFinishChange(this),this._onFinishChange!==void 0&&this._onFinishChange.call(this,this.getValue())),this._changed=!1}reset(){return this.setValue(this.initialValue),this._callOnFinishChange(),this}enable(t=!0){return this.disable(!t)}disable(t=!0){return t===this._disabled?this:(this._disabled=t,this.domElement.classList.toggle("lil-disabled",t),this.$disable.toggleAttribute("disabled",t),this)}show(t=!0){return this._hidden=!t,this.domElement.style.display=this._hidden?"none":"",this}hide(){return this.show(!1)}options(t){const e=this.parent.add(this.object,this.property,t);return e.name(this._name),this.destroy(),e}min(t){return this}max(t){return this}step(t){return this}decimals(t){return this}listen(t=!0){return this._listening=t,this._listenCallbackID!==void 0&&(cancelAnimationFrame(this._listenCallbackID),this._listenCallbackID=void 0),this._listening&&this._listenCallback(),this}_listenCallback(){this._listenCallbackID=requestAnimationFrame(this._listenCallback);const t=this.save();t!==this._listenPrevValue&&this.updateDisplay(),this._listenPrevValue=t}getValue(){return this.object[this.property]}setValue(t){return this.getValue()!==t&&(this.object[this.property]=t,this._callOnChange(),this.updateDisplay()),this}updateDisplay(){return this}load(t){return this.setValue(t),this._callOnFinishChange(),this}save(){return this.getValue()}destroy(){this.listen(!1),this.parent.children.splice(this.parent.children.indexOf(this),1),this.parent.controllers.splice(this.parent.controllers.indexOf(this),1),this.parent.$children.removeChild(this.domElement)}}class K extends g{constructor(t,e,i){super(t,e,i,"lil-boolean","label"),this.$input=document.createElement("input"),this.$input.setAttribute("type","checkbox"),this.$input.setAttribute("aria-labelledby",this.$name.id),this.$widget.appendChild(this.$input),this.$input.addEventListener("change",()=>{this.setValue(this.$input.checked),this._callOnFinishChange()}),this.$disable=this.$input,this.updateDisplay()}updateDisplay(){return this.$input.checked=this.getValue(),this}}function S(s){let t,e;return(t=s.match(/(#|0x)?([a-f0-9]{6})/i))?e=t[2]:(t=s.match(/rgb\(\s*(\d*)\s*,\s*(\d*)\s*,\s*(\d*)\s*\)/))?e=parseInt(t[1]).toString(16).padStart(2,0)+parseInt(t[2]).toString(16).padStart(2,0)+parseInt(t[3]).toString(16).padStart(2,0):(t=s.match(/^#?([a-f0-9])([a-f0-9])([a-f0-9])$/i))&&(e=t[1]+t[1]+t[2]+t[2]+t[3]+t[3]),e?"#"+e:!1}const Z={isPrimitive:!0,match:s=>typeof s=="string",fromHexString:S,toHexString:S},b={isPrimitive:!0,match:s=>typeof s=="number",fromHexString:s=>parseInt(s.substring(1),16),toHexString:s=>"#"+s.toString(16).padStart(6,0)},J={isPrimitive:!1,match:s=>Array.isArray(s)||ArrayBuffer.isView(s),fromHexString(s,t,e=1){const i=b.fromHexString(s);t[0]=(i>>16&255)/255*e,t[1]=(i>>8&255)/255*e,t[2]=(i&255)/255*e},toHexString([s,t,e],i=1){i=255/i;const n=s*i<<16^t*i<<8^e*i<<0;return b.toHexString(n)}},Q={isPrimitive:!1,match:s=>Object(s)===s,fromHexString(s,t,e=1){const i=b.fromHexString(s);t.r=(i>>16&255)/255*e,t.g=(i>>8&255)/255*e,t.b=(i&255)/255*e},toHexString({r:s,g:t,b:e},i=1){i=255/i;const n=s*i<<16^t*i<<8^e*i<<0;return b.toHexString(n)}},tt=[Z,b,J,Q];function et(s){return tt.find(t=>t.match(s))}class it extends g{constructor(t,e,i,n){super(t,e,i,"lil-color"),this.$input=document.createElement("input"),this.$input.setAttribute("type","color"),this.$input.setAttribute("tabindex",-1),this.$input.setAttribute("aria-labelledby",this.$name.id),this.$text=document.createElement("input"),this.$text.setAttribute("type","text"),this.$text.setAttribute("spellcheck","false"),this.$text.setAttribute("aria-labelledby",this.$name.id),this.$display=document.createElement("div"),this.$display.classList.add("lil-display"),this.$display.appendChild(this.$input),this.$widget.appendChild(this.$display),this.$widget.appendChild(this.$text),this._format=et(this.initialValue),this._rgbScale=n,this._initialValueHexString=this.save(),this._textFocused=!1,this.$input.addEventListener("input",()=>{this._setValueFromHexString(this.$input.value)}),this.$input.addEventListener("blur",()=>{this._callOnFinishChange()}),this.$text.addEventListener("input",()=>{const l=S(this.$text.value);l&&this._setValueFromHexString(l)}),this.$text.addEventListener("focus",()=>{this._textFocused=!0,this.$text.select()}),this.$text.addEventListener("blur",()=>{this._textFocused=!1,this.updateDisplay(),this._callOnFinishChange()}),this.$disable=this.$text,this.updateDisplay()}reset(){return this._setValueFromHexString(this._initialValueHexString),this}_setValueFromHexString(t){if(this._format.isPrimitive){const e=this._format.fromHexString(t);this.setValue(e)}else this._format.fromHexString(t,this.getValue(),this._rgbScale),this._callOnChange(),this.updateDisplay()}save(){return this._format.toHexString(this.getValue(),this._rgbScale)}load(t){return this._setValueFromHexString(t),this._callOnFinishChange(),this}updateDisplay(){return this.$input.value=this._format.toHexString(this.getValue(),this._rgbScale),this._textFocused||(this.$text.value=this.$input.value.substring(1)),this.$display.style.backgroundColor=this.$input.value,this}}class P extends g{constructor(t,e,i){super(t,e,i,"lil-function"),this.$button=document.createElement("button"),this.$button.appendChild(this.$name),this.$widget.appendChild(this.$button),this.$button.addEventListener("click",n=>{n.preventDefault(),this.getValue().call(this.object),this._callOnChange()}),this.$button.addEventListener("touchstart",()=>{},{passive:!0}),this.$disable=this.$button}}class st extends g{constructor(t,e,i,n,l,a){super(t,e,i,"lil-number"),this._initInput(),this.min(n),this.max(l);const c=a!==void 0;this.step(c?a:this._getImplicitStep(),c),this.updateDisplay()}decimals(t){return this._decimals=t,this.updateDisplay(),this}min(t){return this._min=t,this._onUpdateMinMax(),this}max(t){return this._max=t,this._onUpdateMinMax(),this}step(t,e=!0){return this._step=t,this._stepExplicit=e,this}updateDisplay(){const t=this.getValue();if(this._hasSlider){let e=(t-this._min)/(this._max-this._min);e=Math.max(0,Math.min(e,1)),this.$fill.style.width=e*100+"%"}return this._inputFocused||(this.$input.value=this._decimals===void 0?t:t.toFixed(this._decimals)),this}_initInput(){this.$input=document.createElement("input"),this.$input.setAttribute("type","text"),this.$input.setAttribute("aria-labelledby",this.$name.id),window.matchMedia("(pointer: coarse)").matches&&(this.$input.setAttribute("type","number"),this.$input.setAttribute("step","any")),this.$widget.appendChild(this.$input),this.$disable=this.$input;const e=()=>{let r=parseFloat(this.$input.value);isNaN(r)||(this._stepExplicit&&(r=this._snap(r)),this.setValue(this._clamp(r)))},i=r=>{const p=parseFloat(this.$input.value);isNaN(p)||(this._snapClampSetValue(p+r),this.$input.value=this.getValue())},n=r=>{r.key==="Enter"&&this.$input.blur(),r.code==="ArrowUp"&&(r.preventDefault(),i(this._step*this._arrowKeyMultiplier(r))),r.code==="ArrowDown"&&(r.preventDefault(),i(this._step*this._arrowKeyMultiplier(r)*-1))},l=r=>{this._inputFocused&&(r.preventDefault(),i(this._step*this._normalizeMouseWheel(r)))};let a=!1,c,m,h,d,u;const v=5,E=r=>{c=r.clientX,m=h=r.clientY,a=!0,d=this.getValue(),u=0,window.addEventListener("mousemove",_),window.addEventListener("mouseup",x)},_=r=>{if(a){const p=r.clientX-c,w=r.clientY-m;Math.abs(w)>v?(r.preventDefault(),this.$input.blur(),a=!1,this._setDraggingStyle(!0,"vertical")):Math.abs(p)>v&&x()}if(!a){const p=r.clientY-h;u-=p*this._step*this._arrowKeyMultiplier(r),d+u>this._max?u=this._max-d:d+u<this._min&&(u=this._min-d),this._snapClampSetValue(d+u)}h=r.clientY},x=()=>{this._setDraggingStyle(!1,"vertical"),this._callOnFinishChange(),window.removeEventListener("mousemove",_),window.removeEventListener("mouseup",x)},C=()=>{this._inputFocused=!0},o=()=>{this._inputFocused=!1,this.updateDisplay(),this._callOnFinishChange()};this.$input.addEventListener("input",e),this.$input.addEventListener("keydown",n),this.$input.addEventListener("wheel",l,{passive:!1}),this.$input.addEventListener("mousedown",E),this.$input.addEventListener("focus",C),this.$input.addEventListener("blur",o)}_initSlider(){this._hasSlider=!0,this.$slider=document.createElement("div"),this.$slider.classList.add("lil-slider"),this.$fill=document.createElement("div"),this.$fill.classList.add("lil-fill"),this.$slider.appendChild(this.$fill),this.$widget.insertBefore(this.$slider,this.$input),this.domElement.classList.add("lil-has-slider");const t=(o,r,p,w,M)=>(o-r)/(p-r)*(M-w)+w,e=o=>{const r=this.$slider.getBoundingClientRect();let p=t(o,r.left,r.right,this._min,this._max);this._snapClampSetValue(p)},i=o=>{this._setDraggingStyle(!0),e(o.clientX),window.addEventListener("mousemove",n),window.addEventListener("mouseup",l)},n=o=>{e(o.clientX)},l=()=>{this._callOnFinishChange(),this._setDraggingStyle(!1),window.removeEventListener("mousemove",n),window.removeEventListener("mouseup",l)};let a=!1,c,m;const h=o=>{o.preventDefault(),this._setDraggingStyle(!0),e(o.touches[0].clientX),a=!1},d=o=>{o.touches.length>1||(this._hasScrollBar?(c=o.touches[0].clientX,m=o.touches[0].clientY,a=!0):h(o),window.addEventListener("touchmove",u,{passive:!1}),window.addEventListener("touchend",v))},u=o=>{if(a){const r=o.touches[0].clientX-c,p=o.touches[0].clientY-m;Math.abs(r)>Math.abs(p)?h(o):(window.removeEventListener("touchmove",u),window.removeEventListener("touchend",v))}else o.preventDefault(),e(o.touches[0].clientX)},v=()=>{this._callOnFinishChange(),this._setDraggingStyle(!1),window.removeEventListener("touchmove",u),window.removeEventListener("touchend",v)},E=this._callOnFinishChange.bind(this),_=400;let x;const C=o=>{if(Math.abs(o.deltaX)<Math.abs(o.deltaY)&&this._hasScrollBar)return;o.preventDefault();const p=this._normalizeMouseWheel(o)*this._step;this._snapClampSetValue(this.getValue()+p),this.$input.value=this.getValue(),clearTimeout(x),x=setTimeout(E,_)};this.$slider.addEventListener("mousedown",i),this.$slider.addEventListener("touchstart",d,{passive:!1}),this.$slider.addEventListener("wheel",C,{passive:!1})}_setDraggingStyle(t,e="horizontal"){this.$slider&&this.$slider.classList.toggle("lil-active",t),document.body.classList.toggle("lil-dragging",t),document.body.classList.toggle(`lil-${e}`,t)}_getImplicitStep(){return this._hasMin&&this._hasMax?(this._max-this._min)/1e3:.1}_onUpdateMinMax(){!this._hasSlider&&this._hasMin&&this._hasMax&&(this._stepExplicit||this.step(this._getImplicitStep(),!1),this._initSlider(),this.updateDisplay())}_normalizeMouseWheel(t){let{deltaX:e,deltaY:i}=t;return Math.floor(t.deltaY)!==t.deltaY&&t.wheelDelta&&(e=0,i=-t.wheelDelta/120,i*=this._stepExplicit?1:10),e+-i}_arrowKeyMultiplier(t){let e=this._stepExplicit?1:10;return t.shiftKey?e*=10:t.altKey&&(e/=10),e}_snap(t){let e=0;return this._hasMin?e=this._min:this._hasMax&&(e=this._max),t-=e,t=Math.round(t/this._step)*this._step,t+=e,t=parseFloat(t.toPrecision(15)),t}_clamp(t){return t<this._min&&(t=this._min),t>this._max&&(t=this._max),t}_snapClampSetValue(t){this.setValue(this._clamp(this._snap(t)))}get _hasScrollBar(){const t=this.parent.root.$children;return t.scrollHeight>t.clientHeight}get _hasMin(){return this._min!==void 0}get _hasMax(){return this._max!==void 0}}class nt extends g{constructor(t,e,i,n){super(t,e,i,"lil-option"),this.$select=document.createElement("select"),this.$select.setAttribute("aria-labelledby",this.$name.id),this.$display=document.createElement("div"),this.$display.classList.add("lil-display"),this.$select.addEventListener("change",()=>{this.setValue(this._values[this.$select.selectedIndex]),this._callOnFinishChange()}),this.$select.addEventListener("focus",()=>{this.$display.classList.add("lil-focus")}),this.$select.addEventListener("blur",()=>{this.$display.classList.remove("lil-focus")}),this.$widget.appendChild(this.$select),this.$widget.appendChild(this.$display),this.$disable=this.$select,this.options(n)}options(t){return this._values=Array.isArray(t)?t:Object.values(t),this._names=Array.isArray(t)?t:Object.keys(t),this.$select.replaceChildren(),this._names.forEach(e=>{const i=document.createElement("option");i.textContent=e,this.$select.appendChild(i)}),this.updateDisplay(),this}updateDisplay(){const t=this.getValue(),e=this._values.indexOf(t);return this.$select.selectedIndex=e,this.$display.textContent=e===-1?t:this._names[e],this}}class rt extends g{constructor(t,e,i){super(t,e,i,"lil-string"),this.$input=document.createElement("input"),this.$input.setAttribute("type","text"),this.$input.setAttribute("spellcheck","false"),this.$input.setAttribute("aria-labelledby",this.$name.id),this.$input.addEventListener("input",()=>{this.setValue(this.$input.value)}),this.$input.addEventListener("keydown",n=>{n.code==="Enter"&&this.$input.blur()}),this.$input.addEventListener("blur",()=>{this._callOnFinishChange()}),this.$widget.appendChild(this.$input),this.$disable=this.$input,this.updateDisplay()}updateDisplay(){return this.$input.value=this.getValue(),this}}var at=`.lil-gui {
  font-family: var(--font-family);
  font-size: var(--font-size);
  line-height: 1;
  font-weight: normal;
  font-style: normal;
  text-align: left;
  color: var(--text-color);
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  --background-color: #1f1f1f;
  --text-color: #ebebeb;
  --title-background-color: #111111;
  --title-text-color: #ebebeb;
  --widget-color: #424242;
  --hover-color: #4f4f4f;
  --focus-color: #595959;
  --number-color: #2cc9ff;
  --string-color: #a2db3c;
  --font-size: 11px;
  --input-font-size: 11px;
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  --font-family-mono: Menlo, Monaco, Consolas, "Droid Sans Mono", monospace;
  --padding: 4px;
  --spacing: 4px;
  --widget-height: 20px;
  --title-height: calc(var(--widget-height) + var(--spacing) * 1.25);
  --name-width: 45%;
  --slider-knob-width: 2px;
  --slider-input-width: 27%;
  --color-input-width: 27%;
  --slider-input-min-width: 45px;
  --color-input-min-width: 45px;
  --folder-indent: 7px;
  --widget-padding: 0 0 0 3px;
  --widget-border-radius: 2px;
  --checkbox-size: calc(0.75 * var(--widget-height));
  --scrollbar-width: 5px;
}
.lil-gui, .lil-gui * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
.lil-gui.lil-root {
  width: var(--width, 245px);
  display: flex;
  flex-direction: column;
  background: var(--background-color);
}
.lil-gui.lil-root > .lil-title {
  background: var(--title-background-color);
  color: var(--title-text-color);
}
.lil-gui.lil-root > .lil-children {
  overflow-x: hidden;
  overflow-y: auto;
}
.lil-gui.lil-root > .lil-children::-webkit-scrollbar {
  width: var(--scrollbar-width);
  height: var(--scrollbar-width);
  background: var(--background-color);
}
.lil-gui.lil-root > .lil-children::-webkit-scrollbar-thumb {
  border-radius: var(--scrollbar-width);
  background: var(--focus-color);
}
@media (pointer: coarse) {
  .lil-gui.lil-allow-touch-styles, .lil-gui.lil-allow-touch-styles .lil-gui {
    --widget-height: 28px;
    --padding: 6px;
    --spacing: 6px;
    --font-size: 13px;
    --input-font-size: 16px;
    --folder-indent: 10px;
    --scrollbar-width: 7px;
    --slider-input-min-width: 50px;
    --color-input-min-width: 65px;
  }
}
.lil-gui.lil-force-touch-styles, .lil-gui.lil-force-touch-styles .lil-gui {
  --widget-height: 28px;
  --padding: 6px;
  --spacing: 6px;
  --font-size: 13px;
  --input-font-size: 16px;
  --folder-indent: 10px;
  --scrollbar-width: 7px;
  --slider-input-min-width: 50px;
  --color-input-min-width: 65px;
}
.lil-gui.lil-auto-place, .lil-gui.autoPlace {
  max-height: 100%;
  position: fixed;
  top: 0;
  right: 15px;
  z-index: 1001;
}

.lil-controller {
  display: flex;
  align-items: center;
  padding: 0 var(--padding);
  margin: var(--spacing) 0;
}
.lil-controller.lil-disabled {
  opacity: 0.5;
}
.lil-controller.lil-disabled, .lil-controller.lil-disabled * {
  pointer-events: none !important;
}
.lil-controller > .lil-name {
  min-width: var(--name-width);
  flex-shrink: 0;
  white-space: pre;
  padding-right: var(--spacing);
  line-height: var(--widget-height);
}
.lil-controller .lil-widget {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--widget-height);
}
.lil-controller.lil-string input {
  color: var(--string-color);
}
.lil-controller.lil-boolean {
  cursor: pointer;
}
.lil-controller.lil-color .lil-display {
  width: 100%;
  height: var(--widget-height);
  border-radius: var(--widget-border-radius);
  position: relative;
}
@media (hover: hover) {
  .lil-controller.lil-color .lil-display:hover:before {
    content: " ";
    display: block;
    position: absolute;
    border-radius: var(--widget-border-radius);
    border: 1px solid #fff9;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
  }
}
.lil-controller.lil-color input[type=color] {
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}
.lil-controller.lil-color input[type=text] {
  margin-left: var(--spacing);
  font-family: var(--font-family-mono);
  min-width: var(--color-input-min-width);
  width: var(--color-input-width);
  flex-shrink: 0;
}
.lil-controller.lil-option select {
  opacity: 0;
  position: absolute;
  width: 100%;
  max-width: 100%;
}
.lil-controller.lil-option .lil-display {
  position: relative;
  pointer-events: none;
  border-radius: var(--widget-border-radius);
  height: var(--widget-height);
  line-height: var(--widget-height);
  max-width: 100%;
  overflow: hidden;
  word-break: break-all;
  padding-left: 0.55em;
  padding-right: 1.75em;
  background: var(--widget-color);
}
@media (hover: hover) {
  .lil-controller.lil-option .lil-display.lil-focus {
    background: var(--focus-color);
  }
}
.lil-controller.lil-option .lil-display.lil-active {
  background: var(--focus-color);
}
.lil-controller.lil-option .lil-display:after {
  font-family: "lil-gui";
  content: "↕";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  padding-right: 0.375em;
}
.lil-controller.lil-option .lil-widget,
.lil-controller.lil-option select {
  cursor: pointer;
}
@media (hover: hover) {
  .lil-controller.lil-option .lil-widget:hover .lil-display {
    background: var(--hover-color);
  }
}
.lil-controller.lil-number input {
  color: var(--number-color);
}
.lil-controller.lil-number.lil-has-slider input {
  margin-left: var(--spacing);
  width: var(--slider-input-width);
  min-width: var(--slider-input-min-width);
  flex-shrink: 0;
}
.lil-controller.lil-number .lil-slider {
  width: 100%;
  height: var(--widget-height);
  background: var(--widget-color);
  border-radius: var(--widget-border-radius);
  padding-right: var(--slider-knob-width);
  overflow: hidden;
  cursor: ew-resize;
  touch-action: pan-y;
}
@media (hover: hover) {
  .lil-controller.lil-number .lil-slider:hover {
    background: var(--hover-color);
  }
}
.lil-controller.lil-number .lil-slider.lil-active {
  background: var(--focus-color);
}
.lil-controller.lil-number .lil-slider.lil-active .lil-fill {
  opacity: 0.95;
}
.lil-controller.lil-number .lil-fill {
  height: 100%;
  border-right: var(--slider-knob-width) solid var(--number-color);
  box-sizing: content-box;
}

.lil-dragging .lil-gui {
  --hover-color: var(--widget-color);
}
.lil-dragging * {
  cursor: ew-resize !important;
}
.lil-dragging.lil-vertical * {
  cursor: ns-resize !important;
}

.lil-gui .lil-title {
  height: var(--title-height);
  font-weight: 600;
  padding: 0 var(--padding);
  width: 100%;
  text-align: left;
  background: none;
  text-decoration-skip: objects;
}
.lil-gui .lil-title:before {
  font-family: "lil-gui";
  content: "▾";
  padding-right: 2px;
  display: inline-block;
}
.lil-gui .lil-title:active {
  background: var(--title-background-color);
  opacity: 0.75;
}
@media (hover: hover) {
  body:not(.lil-dragging) .lil-gui .lil-title:hover {
    background: var(--title-background-color);
    opacity: 0.85;
  }
  .lil-gui .lil-title:focus {
    text-decoration: underline var(--focus-color);
  }
}
.lil-gui.lil-root > .lil-title:focus {
  text-decoration: none !important;
}
.lil-gui.lil-closed > .lil-title:before {
  content: "▸";
}
.lil-gui.lil-closed > .lil-children {
  transform: translateY(-7px);
  opacity: 0;
}
.lil-gui.lil-closed:not(.lil-transition) > .lil-children {
  display: none;
}
.lil-gui.lil-transition > .lil-children {
  transition-duration: 300ms;
  transition-property: height, opacity, transform;
  transition-timing-function: cubic-bezier(0.2, 0.6, 0.35, 1);
  overflow: hidden;
  pointer-events: none;
}
.lil-gui .lil-children:empty:before {
  content: "Empty";
  padding: 0 var(--padding);
  margin: var(--spacing) 0;
  display: block;
  height: var(--widget-height);
  font-style: italic;
  line-height: var(--widget-height);
  opacity: 0.5;
}
.lil-gui.lil-root > .lil-children > .lil-gui > .lil-title {
  border: 0 solid var(--widget-color);
  border-width: 1px 0;
  transition: border-color 300ms;
}
.lil-gui.lil-root > .lil-children > .lil-gui.lil-closed > .lil-title {
  border-bottom-color: transparent;
}
.lil-gui + .lil-controller {
  border-top: 1px solid var(--widget-color);
  margin-top: 0;
  padding-top: var(--spacing);
}
.lil-gui .lil-gui .lil-gui > .lil-title {
  border: none;
}
.lil-gui .lil-gui .lil-gui > .lil-children {
  border: none;
  margin-left: var(--folder-indent);
  border-left: 2px solid var(--widget-color);
}
.lil-gui .lil-gui .lil-controller {
  border: none;
}

.lil-gui label, .lil-gui input, .lil-gui button {
  -webkit-tap-highlight-color: transparent;
}
.lil-gui input {
  border: 0;
  outline: none;
  font-family: var(--font-family);
  font-size: var(--input-font-size);
  border-radius: var(--widget-border-radius);
  height: var(--widget-height);
  background: var(--widget-color);
  color: var(--text-color);
  width: 100%;
}
@media (hover: hover) {
  .lil-gui input:hover {
    background: var(--hover-color);
  }
  .lil-gui input:active {
    background: var(--focus-color);
  }
}
.lil-gui input:disabled {
  opacity: 1;
}
.lil-gui input[type=text],
.lil-gui input[type=number] {
  padding: var(--widget-padding);
  -moz-appearance: textfield;
}
.lil-gui input[type=text]:focus,
.lil-gui input[type=number]:focus {
  background: var(--focus-color);
}
.lil-gui input[type=checkbox] {
  appearance: none;
  width: var(--checkbox-size);
  height: var(--checkbox-size);
  border-radius: var(--widget-border-radius);
  text-align: center;
  cursor: pointer;
}
.lil-gui input[type=checkbox]:checked:before {
  font-family: "lil-gui";
  content: "✓";
  font-size: var(--checkbox-size);
  line-height: var(--checkbox-size);
}
@media (hover: hover) {
  .lil-gui input[type=checkbox]:focus {
    box-shadow: inset 0 0 0 1px var(--focus-color);
  }
}
.lil-gui button {
  outline: none;
  cursor: pointer;
  font-family: var(--font-family);
  font-size: var(--font-size);
  color: var(--text-color);
  width: 100%;
  border: none;
}
.lil-gui .lil-controller button {
  height: var(--widget-height);
  text-transform: none;
  background: var(--widget-color);
  border-radius: var(--widget-border-radius);
}
@media (hover: hover) {
  .lil-gui .lil-controller button:hover {
    background: var(--hover-color);
  }
  .lil-gui .lil-controller button:focus {
    box-shadow: inset 0 0 0 1px var(--focus-color);
  }
}
.lil-gui .lil-controller button:active {
  background: var(--focus-color);
}

@font-face {
  font-family: "lil-gui";
  src: url("data:application/font-woff2;charset=utf-8;base64,d09GMgABAAAAAALkAAsAAAAABtQAAAKVAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHFQGYACDMgqBBIEbATYCJAMUCwwABCAFhAoHgQQbHAbIDiUFEYVARAAAYQTVWNmz9MxhEgodq49wYRUFKE8GWNiUBxI2LBRaVnc51U83Gmhs0Q7JXWMiz5eteLwrKwuxHO8VFxUX9UpZBs6pa5ABRwHA+t3UxUnH20EvVknRerzQgX6xC/GH6ZUvTcAjAv122dF28OTqCXrPuyaDER30YBA1xnkVutDDo4oCi71Ca7rrV9xS8dZHbPHefsuwIyCpmT7j+MnjAH5X3984UZoFFuJ0yiZ4XEJFxjagEBeqs+e1iyK8Xf/nOuwF+vVK0ur765+vf7txotUi0m3N0m/84RGSrBCNrh8Ee5GjODjF4gnWP+dJrH/Lk9k4oT6d+gr6g/wssA2j64JJGP6cmx554vUZnpZfn6ZfX2bMwPPrlANsB86/DiHjhl0OP+c87+gaJo/gY084s3HoYL/ZkWHTRfBXvvoHnnkHvngKun4KBE/ede7tvq3/vQOxDXB1/fdNz6XbPdcr0Vhpojj9dG+owuSKFsslCi1tgEjirjXdwMiov2EioadxmqTHUCIwo8NgQaeIasAi0fTYSPTbSmwbMOFduyh9wvBrESGY0MtgRjtgQR8Q1bRPohn2UoCRZf9wyYANMXFeJTysqAe0I4mrherOekFdKMrYvJjLvOIUM9SuwYB5DVZUwwVjJJOaUnZCmcEkIZZrKqNvRGRMvmFZsmhP4VMKCSXBhSqUBxgMS7h0cZvEd71AWkEhGWaeMFcNnpqyJkyXgYL7PQ1MoSq0wDAkRtJIijkZSmqYTiSImfLiSWXIZwhRh3Rug2X0kk1Dgj+Iu43u5p98ghopcpSo0Uyc8SnjlYX59WUeaMoDqmVD2TOWD9a4pCRAzf2ECgwGcrHjPOWY9bNxq/OL3I/QjwEAAAA=") format("woff2");
}`;function lt(s){const t=document.createElement("style");t.innerHTML=s;const e=document.querySelector("head link[rel=stylesheet], head style");e?document.head.insertBefore(t,e):document.head.appendChild(t)}let V=!1;class B{constructor({parent:t,autoPlace:e=t===void 0,container:i,width:n,title:l="Controls",closeFolders:a=!1,injectStyles:c=!0,touchStyles:m=!0}={}){if(this.parent=t,this.root=t?t.root:this,this.children=[],this.controllers=[],this.folders=[],this._closed=!1,this._hidden=!1,this.domElement=document.createElement("div"),this.domElement.classList.add("lil-gui"),this.$title=document.createElement("button"),this.$title.classList.add("lil-title"),this.$title.setAttribute("aria-expanded",!0),this.$title.addEventListener("click",()=>this.openAnimated(this._closed)),this.$title.addEventListener("touchstart",()=>{},{passive:!0}),this.$children=document.createElement("div"),this.$children.classList.add("lil-children"),this.domElement.appendChild(this.$title),this.domElement.appendChild(this.$children),this.title(l),this.parent){this.parent.children.push(this),this.parent.folders.push(this),this.parent.$children.appendChild(this.domElement);return}this.domElement.classList.add("lil-root"),m&&this.domElement.classList.add("lil-allow-touch-styles"),!V&&c&&(lt(at),V=!0),i?i.appendChild(this.domElement):e&&(this.domElement.classList.add("lil-auto-place","autoPlace"),document.body.appendChild(this.domElement)),n&&this.domElement.style.setProperty("--width",n+"px"),this._closeFolders=a}add(t,e,i,n,l){if(Object(i)===i)return new nt(this,t,e,i);const a=t[e];switch(typeof a){case"number":return new st(this,t,e,i,n,l);case"boolean":return new K(this,t,e);case"string":return new rt(this,t,e);case"function":return new P(this,t,e)}console.error(`gui.add failed
	property:`,e,`
	object:`,t,`
	value:`,a)}addColor(t,e,i=1){return new it(this,t,e,i)}addFolder(t){const e=new B({parent:this,title:t});return this.root._closeFolders&&e.close(),e}load(t,e=!0){return t.controllers&&this.controllers.forEach(i=>{i instanceof P||i._name in t.controllers&&i.load(t.controllers[i._name])}),e&&t.folders&&this.folders.forEach(i=>{i._title in t.folders&&i.load(t.folders[i._title])}),this}save(t=!0){const e={controllers:{},folders:{}};return this.controllers.forEach(i=>{if(!(i instanceof P)){if(i._name in e.controllers)throw new Error(`Cannot save GUI with duplicate property "${i._name}"`);e.controllers[i._name]=i.save()}}),t&&this.folders.forEach(i=>{if(i._title in e.folders)throw new Error(`Cannot save GUI with duplicate folder "${i._title}"`);e.folders[i._title]=i.save()}),e}open(t=!0){return this._setClosed(!t),this.$title.setAttribute("aria-expanded",!this._closed),this.domElement.classList.toggle("lil-closed",this._closed),this}close(){return this.open(!1)}_setClosed(t){this._closed!==t&&(this._closed=t,this._callOnOpenClose(this))}show(t=!0){return this._hidden=!t,this.domElement.style.display=this._hidden?"none":"",this}hide(){return this.show(!1)}openAnimated(t=!0){return this._setClosed(!t),this.$title.setAttribute("aria-expanded",!this._closed),requestAnimationFrame(()=>{const e=this.$children.clientHeight;this.$children.style.height=e+"px",this.domElement.classList.add("lil-transition");const i=l=>{l.target===this.$children&&(this.$children.style.height="",this.domElement.classList.remove("lil-transition"),this.$children.removeEventListener("transitionend",i))};this.$children.addEventListener("transitionend",i);const n=t?this.$children.scrollHeight:0;this.domElement.classList.toggle("lil-closed",!t),requestAnimationFrame(()=>{this.$children.style.height=n+"px"})}),this}title(t){return this._title=t,this.$title.textContent=t,this}reset(t=!0){return(t?this.controllersRecursive():this.controllers).forEach(i=>i.reset()),this}onChange(t){return this._onChange=t,this}_callOnChange(t){this.parent&&this.parent._callOnChange(t),this._onChange!==void 0&&this._onChange.call(this,{object:t.object,property:t.property,value:t.getValue(),controller:t})}onFinishChange(t){return this._onFinishChange=t,this}_callOnFinishChange(t){this.parent&&this.parent._callOnFinishChange(t),this._onFinishChange!==void 0&&this._onFinishChange.call(this,{object:t.object,property:t.property,value:t.getValue(),controller:t})}onOpenClose(t){return this._onOpenClose=t,this}_callOnOpenClose(t){this.parent&&this.parent._callOnOpenClose(t),this._onOpenClose!==void 0&&this._onOpenClose.call(this,t)}destroy(){this.parent&&(this.parent.children.splice(this.parent.children.indexOf(this),1),this.parent.folders.splice(this.parent.folders.indexOf(this),1)),this.domElement.parentElement&&this.domElement.parentElement.removeChild(this.domElement),Array.from(this.children).forEach(t=>t.destroy())}controllersRecursive(){let t=Array.from(this.controllers);return this.folders.forEach(e=>{t=t.concat(e.controllersRecursive())}),t}foldersRecursive(){let t=Array.from(this.folders);return this.folders.forEach(e=>{t=t.concat(e.foldersRecursive())}),t}}const y=document.getElementById("plum-sumi"),$=document.getElementById("plum-video");if(y&&$){const s=new j({canvas:y,video:$});s.start().then(t=>{if(t){new ResizeObserver(()=>s.handleResize()).observe(y);const e=new B({title:"Sumi-e",autoPlace:!1});e.close(),y.parentElement.appendChild(e.domElement);const i=e.addFolder("Physarum");i.add(s.tuning,"sensorDist",1,40,.5).name("sensor dist"),i.add(s.tuning,"sensorAngle",.05,1.57,.01).name("sensor angle"),i.add(s.tuning,"turnSpeed",.01,1,.01).name("turn speed"),i.add(s.tuning,"deposit",.01,2,.01).name("deposit"),i.add(s.tuning,"trailSpeed",.1,5,.1).name("speed"),i.add(s.tuning,"maskWeight",0,10,.1).name("mask attract"),i.add(s.tuning,"trailDecay",.9,1,.001).name("decay"),i.add(s.tuning,"diffuseWeight",0,1,.01).name("diffuse"),i.add(s.tuning,"physarumSteps",1,16,1).name("steps/frame");const n=e.addFolder("Ink");n.add(s.tuning,"branchInk",0,1,.01).name("branch opacity"),n.add(s.tuning,"skyInk",0,.3,.005).name("sky wash"),n.add(s.tuning,"paperTone",.85,1,.005).name("paper tone");const l=e.addFolder("Segmentation");l.add(s.tuning,"maskThreshold",0,1,.01).name("mask cutoff"),l.add(s.tuning,"erosionSteps",0,200,1).name("erosion steps"),l.addColor(s.tuning,"attractColor").name("attract color"),l.add(s.tuning,"colorTolerance",.01,1,.01).name("tolerance"),l.add(s.tuning,"agentThreshold",0,1,.01).name("agent mask"),e.addFolder("Blossom").add(s.tuning,"blossomInk",0,1,.01).name("pink strength")}else{y.remove(),$.style.display="none";const e=document.getElementById("plum-fallback");e&&(e.style.display="block")}})}
