import{W as w,M as z,c as m,a as B,f as P}from"./fullscreen.vertex.9caOMRGv.js";const C=`// Navier-Stokes vorticity-stream function formulation.
// Workgroup cache with halo for race-free stencil operations.
// Single read_write buffer — no scratch, no ping-pong.
//
// Channels: x=error, y=unused, z=stream_function, w=vorticity
// Discretization ported from public/art/3141

struct Params {
  mouse: vec4f,   // xy=position, z=brush_size (NaN=idle), w=unused
  size: vec2f,
  _pad: vec2f,
  bg: vec4f,      // background colour (used by render only)
};

const WG: u32 = 8u;
const TILE: u32 = 2u;
const HALO: u32 = 1u;
const CACHE: u32 = TILE * WG;          // 16
const INNER: u32 = CACHE - 2u * HALO;  // 14

@group(0) @binding(0) var<storage, read_write> state: array<vec4f>;
@group(0) @binding(1) var<uniform> params: Params;

var<workgroup> tile: array<array<vec4f, CACHE>, CACHE>;

// ── Index helpers ────────────────────────────────────────

fn gidx(p: vec2i) -> u32 {
  let sz = vec2i(params.size);
  let w = ((p % sz) + sz) % sz;
  return u32(w.y * sz.x + w.x);
}

fn to_global(local: vec2u, wid: vec2u) -> vec2i {
  return vec2i(local) + vec2i(INNER * wid) - vec2i(1);
}

fn in_bounds(local: vec2u) -> bool {
  return local.x >= HALO && local.x < INNER + HALO
      && local.y >= HALO && local.y < INNER + HALO;
}

// ── Cached stencil operations ────────────────────────────

fn cval(p: vec2u) -> vec4f {
  return tile[p.x][p.y];
}

fn claplacian(p: vec2u) -> vec4f {
  return cval(p + vec2u(1, 0)) + cval(p - vec2u(1, 0))
       + cval(p + vec2u(0, 1)) + cval(p - vec2u(0, 1))
       - 4.0 * cval(p);
}

struct Curl {
  x: vec2f, y: vec2f, z: vec2f, w: vec2f,
};

fn ccurl(p: vec2u) -> Curl {
  let u = (cval(p + vec2u(0, 1)) - cval(p - vec2u(0, 1))) / 2.0;
  let v = (cval(p - vec2u(1, 0)) - cval(p + vec2u(1, 0))) / 2.0;
  var c: Curl;
  c.x = vec2f(u.x, v.x);
  c.y = vec2f(u.y, v.y);
  c.z = vec2f(u.z, v.z);
  c.w = vec2f(u.w, v.w);
  return c;
}

fn cjacobi(p: vec2u, w: f32, h: f32) -> f32 {
  return (cval(p + vec2u(1, 0)).z + cval(p - vec2u(1, 0)).z
        + cval(p + vec2u(0, 1)).z + cval(p - vec2u(0, 1)).z
        + h * w) / 4.0;
}

// ── Advection (global reads — displacement can exceed cache)

fn gvalue(x: vec2i) -> vec4f {
  return state[gidx(x)];
}

fn interpolate(pos: vec2f) -> vec4f {
  let fraction = fract(pos);
  let y = vec2i(pos + (0.5 - fraction));
  return mix(
    mix(gvalue(y), gvalue(y + vec2i(1, 0)), fraction.x),
    mix(gvalue(y + vec2i(0, 1)), gvalue(y + vec2i(1, 1)), fraction.x),
    fraction.y,
  );
}

fn advect(p: vec2u, global: vec2i, dt: f32) -> vec4f {
  let y = vec2f(global) - ccurl(p).z * dt;
  return interpolate(y);
}

// ── Main ─────────────────────────────────────────────────

@compute @workgroup_size(8, 8)
fn main(
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let sz = vec2i(params.size);

  // Load state into workgroup cache (with halo)
  for (var tx = 0u; tx < TILE; tx++) {
    for (var ty = 0u; ty < TILE; ty++) {
      let local = vec2u(tx, ty) + TILE * lid.xy;
      let global = to_global(local, wid.xy);
      tile[local.x][local.y] = state[gidx(global)];
    }
  }
  workgroupBarrier();

  let brush = params.mouse.z;

  // Process each tile cell
  for (var tx = 0u; tx < TILE; tx++) {
    for (var ty = 0u; ty < TILE; ty++) {
      let local = vec2u(tx, ty) + TILE * lid.xy;
      if !in_bounds(local) { continue; }

      let global = to_global(local, wid.xy);
      if (global.x >= sz.x || global.y >= sz.y) { continue; }

      // Idle: Jacobi relaxation
      if !(brush < 0.0 || 0.0 < brush) {
        var Fdt = cval(local);
        Fdt.z = cjacobi(local, Fdt.w, 10.0);
        Fdt.x = abs(claplacian(local).z + cval(local).w) / (1.0 + cval(local).w);
        state[gidx(global)] = Fdt;
        continue;
      }

      // Active: advect + diffuse
      var Fdt = advect(local, global, 1.0);
      Fdt.w += claplacian(local).w * 0.05;

      // Error metric
      Fdt.x = abs(claplacian(local).z + cval(local).w) / (1.0 + cval(local).w);

      // Brush interaction
      let distance = vec2f(global) - params.mouse.xy;
      let norm = dot(distance, distance);
      if (sqrt(norm) < abs(brush)) {
        Fdt.w += 0.01 * sign(brush) * exp(-norm / (brush * brush));
      }

      state[gidx(global)] = Fdt;
    }
  }
}
`,k=`#import fullscreen_vertex

struct Params {
  mouse: vec4f,
  size: vec2f,
  _pad: vec2f,
  bg: vec4f,
};

@group(0) @binding(0) var<storage, read> state: array<vec4f>;
@group(0) @binding(1) var<uniform> params: Params;

fn load_at(pos: vec2i, sz: vec2i) -> vec4f {
  let p = clamp(pos, vec2i(0), sz - 1);
  return state[u32(p.y * sz.x + p.x)];
}

@fragment
fn frag(in: VSOut) -> @location(0) vec4f {
  let size = vec2i(params.size);
  let pos = vec2i(
    i32(in.uv.x * f32(size.x)),
    i32((1.0 - in.uv.y) * f32(size.y)),
  );

  let c = load_at(pos, size);

  // Vorticity -> red/green (unchanged in both modes)
  var color = vec4f(0.0);
  color.g = 5.0 * max(0.0, c.w);    // positive vorticity -> green
  color.r = 5.0 * max(0.0, -c.w);   // negative vorticity -> red
  color.a = c.x;                     // error metric -> alpha

  // Stream function coloring (mode-dependent)
  let raw_stream = abs(c.z);
  if (params.bg.r < 0.5) {
    // Dark mode: #DCED31 accent for stream function, fading to blue
    // near vortex cores to preserve emergent magenta/cyan.
    // Reinhard compress stream to [0,1) to prevent yellow clipping to white.
    let stream = raw_stream / (1.0 + raw_stream);
    let vort = color.r + color.g;
    let t = clamp(vort, 0.0, 1.0);
    let accent = vec3f(0.863, 0.929, 0.192);
    let stream_col = mix(accent, vec3f(0.0, 0.0, 1.0), t);
    color = vec4f(color.rg + stream_col.rg * stream, stream_col.b * stream, color.a);
  } else {
    color.b = raw_stream;
  }

  // Blend over background so dark/light mode both look correct
  let a = clamp(color.a, 0.0, 1.0);
  let blended = mix(params.bg.rgb, color.rgb, a);
  return vec4f(blended, 1.0);
}
`,_=8,E=2,N=1,p=E*_-2*N;class D extends w{stepsPerFrame;brushSize;bgColor;mouse;computePL;buf;paramsBuf;computeBG;readbackBuf;nanCheckPending=!1;paramsData=new Float32Array(12);constructor(e){super({canvas:e.canvas,cellSize:e.cellSize??4,updateInterval:e.updateInterval??16}),this.stepsPerFrame=e.stepsPerFrame??1,this.brushSize=e.brushSize??1e3,this.bgColor=e.bgColor??[1,1,1,1]}updateBackground(e){this.bgColor=e,this.paramsData[8]=e[0],this.paramsData[9]=e[1],this.paramsData[10]=e[2],this.paramsData[11]=e[3]}onStart(){this.mouse=new z(this.canvas)}onStop(){this.mouse?.destroy()}buildPipelines(){const e={fullscreen_vertex:B};this.computePL=this.device.createComputePipeline({layout:"auto",compute:{module:m(this.device,C),entryPoint:"main"}});const n=m(this.device,k,e);this.renderPL=this.device.createRenderPipeline({layout:"auto",vertex:{module:n,entryPoint:"vert"},fragment:{module:n,entryPoint:"frag",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}})}buildResources(){const e=this.device,a=this.gw*this.gh*16;this.buf=e.createBuffer({size:a,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),this.resetState(),this.paramsBuf=e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.paramsData.fill(0),this.paramsData[2]=NaN,this.paramsData[4]=this.gw,this.paramsData[5]=this.gh,this.paramsData[8]=this.bgColor[0],this.paramsData[9]=this.bgColor[1],this.paramsData[10]=this.bgColor[2],this.paramsData[11]=this.bgColor[3],e.queue.writeBuffer(this.paramsBuf,0,this.paramsData),this.readbackBuf=e.createBuffer({size:64,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.computeBG=e.createBindGroup({layout:this.computePL.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.buf}},{binding:1,resource:{buffer:this.paramsBuf}}]}),this.renderBG=e.createBindGroup({layout:this.renderPL.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.buf}},{binding:1,resource:{buffer:this.paramsBuf}}]})}destroyResources(){this.buf.destroy(),this.paramsBuf.destroy(),this.readbackBuf.destroy(),this.nanCheckPending=!1}resetState(){const e=this.gw*this.gh,n=new Float32Array(e*4),a=Math.min(this.gw,this.gh),r=[{x:.22,y:.28,a:.8,s:.05},{x:.28,y:.33,a:-.8,s:.05},{x:.55,y:.4,a:.4,s:.1},{x:.5,y:.55,a:-.4,s:.1},{x:.72,y:.68,a:1,s:.03},{x:.76,y:.72,a:-1,s:.03},{x:.82,y:.25,a:.6,s:.07},{x:.18,y:.72,a:-.5,s:.04},{x:.3,y:.65,a:.5,s:.04}];for(let t=0;t<this.gh;t++)for(let i=0;i<this.gw;i++){let o=0;for(const l of r){const d=i-l.x*this.gw,v=t-l.y*this.gh,x=d*d+v*v,h=l.s*a;o+=l.a*Math.exp(-x/(2*h*h))}const f=(t*this.gw+i)*4;n[f]=Math.abs(o)/(1+o),n[f+3]=o}this.device.queue.writeBuffer(this.buf,0,n)}frame(){const e=this.mouse.state;if(this.paramsData[0]=e.x*this.gw,this.paramsData[1]=e.y*this.gh,e.active){const a=this.brushSize/this.cellSize;this.paramsData[2]=e.button===2?-a:a}else this.paramsData[2]=NaN;this.device.queue.writeBuffer(this.paramsBuf,0,this.paramsData);const n=this.device.createCommandEncoder();for(let a=0;a<this.stepsPerFrame;a++){const r=n.beginComputePass();r.setPipeline(this.computePL),r.setBindGroup(0,this.computeBG),r.dispatchWorkgroups(Math.ceil(this.gw/p),Math.ceil(this.gh/p)),r.end()}if(P(n,this.ctx.getCurrentTexture().createView(),this.renderPL,this.renderBG),this.device.queue.submit([n.finish()]),!this.nanCheckPending){this.nanCheckPending=!0;const a=[0,(this.gw-1)*16,(this.gh-1)*this.gw*16,((this.gh-1)*this.gw+this.gw-1)*16],r=this.device.createCommandEncoder();for(let t=0;t<4;t++)r.copyBufferToBuffer(this.buf,a[t],this.readbackBuf,t*16,16);this.device.queue.submit([r.finish()]),this.readbackBuf.mapAsync(GPUMapMode.READ).then(()=>{const t=new Float32Array(this.readbackBuf.getMappedRange()),i=isNaN(t[3])&&isNaN(t[7])&&isNaN(t[11])&&isNaN(t[15]);this.readbackBuf.unmap(),this.nanCheckPending=!1,i&&(console.warn("[NavierStokes] NaN in all corners, resetting simulation"),this.resetState())}).catch(()=>{this.nanCheckPending=!1})}}}const g=[1,1,1,1],b=[0,0,0,1];function y(){return document.documentElement.classList.contains("dark")}const s=document.getElementById("fluid-sim"),L=document.getElementById("fluid-sim-fallback"),u=document.getElementById("fluid-sim-hint");if(s&&u){const c=()=>{u.style.opacity="0",setTimeout(()=>u.remove(),400),s.removeEventListener("pointerdown",c)};s.addEventListener("pointerdown",c)}if(s){const c=window.matchMedia("(pointer: coarse)").matches,e=new D({canvas:s,cellSize:1,updateInterval:16,stepsPerFrame:1,brushSize:c?15:30,bgColor:y()?b:g});e.start().then(n=>{n?(L?.remove(),new ResizeObserver(()=>e.handleResize()).observe(s),new MutationObserver(()=>{e.updateBackground(y()?b:g)}).observe(document.documentElement,{attributes:!0,attributeFilter:["class"]})):(s.remove(),u?.remove())})}
