import{W as l,c as n,f as d,a as v}from"./fullscreen.vertex.9caOMRGv.js";const h=`requires readonly_and_readwrite_storage_textures;

@group(0) @binding(0) var state: texture_storage_2d<r32uint, read_write>;

fn alive(pos: vec2i, size: vec2i) -> u32 {
  return textureLoad(state, (pos % size + size) % size).x;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(state));
  let pos = vec2i(id.xy);
  if (pos.x >= size.x || pos.y >= size.y) { return; }

  let n = alive(pos + vec2i(-1,-1), size) + alive(pos + vec2i(0,-1), size) + alive(pos + vec2i(1,-1), size)
        + alive(pos + vec2i(-1, 0), size)                                  + alive(pos + vec2i(1, 0), size)
        + alive(pos + vec2i(-1, 1), size) + alive(pos + vec2i(0, 1), size) + alive(pos + vec2i(1, 1), size);

  let cur = textureLoad(state, pos).x;
  textureStore(state, pos, vec4u(select(0u, 1u, n == 3u || (cur == 1u && n == 2u)), 0u, 0u, 0u));
}
`,f=`#import fullscreen_vertex

struct Colors { alive: vec4f, dead: vec4f };

@group(0) @binding(0) var state: texture_2d<u32>;
@group(0) @binding(1) var<uniform> colors: Colors;

@fragment
fn frag(in: VSOut) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(state));
  let cell = vec2i(
    i32(in.uv.x * size.x),
    i32((1.0 - in.uv.y) * size.y),
  );
  let c = select(colors.dead, colors.alive, textureLoad(state, cell, 0).x == 1u);
  return vec4f(c.rgb * c.a, c.a);
}
`,o=8;class m extends l{density;colors;computePL;stateTex;colorBuf;computeBG;constructor(e){super({canvas:e.canvas,cellSize:e.cellSize??10,updateInterval:e.updateInterval??150}),this.density=e.initialDensity??.25,this.colors={...e.colors}}updateColors(e){this.colors={...e},this.colorBuf&&this.device.queue.writeBuffer(this.colorBuf,0,new Float32Array([...e.alive,...e.dead]))}buildPipelines(){const e={fullscreen_vertex:v};this.computePL=this.device.createComputePipeline({layout:"auto",compute:{module:n(this.device,h),entryPoint:"main"}});const t=n(this.device,f,e);this.renderPL=this.device.createRenderPipeline({layout:"auto",vertex:{module:t,entryPoint:"vert"},fragment:{module:t,entryPoint:"frag",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}})}buildResources(){const e=this.device;this.stateTex=e.createTexture({size:[this.gw,this.gh],format:"r32uint",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});const t=new Uint32Array(this.gw*this.gh);for(let r=0;r<t.length;r++)t[r]=Math.random()<this.density?1:0;e.queue.writeTexture({texture:this.stateTex},t,{bytesPerRow:this.gw*4},[this.gw,this.gh]),this.colorBuf=e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),e.queue.writeBuffer(this.colorBuf,0,new Float32Array([...this.colors.alive,...this.colors.dead])),this.computeBG=e.createBindGroup({layout:this.computePL.getBindGroupLayout(0),entries:[{binding:0,resource:this.stateTex.createView()}]}),this.renderBG=e.createBindGroup({layout:this.renderPL.getBindGroupLayout(0),entries:[{binding:0,resource:this.stateTex.createView()},{binding:1,resource:{buffer:this.colorBuf}}]})}destroyResources(){this.stateTex.destroy(),this.colorBuf.destroy()}frame(){const e=this.device.createCommandEncoder(),t=e.beginComputePass();t.setPipeline(this.computePL),t.setBindGroup(0,this.computeBG),t.dispatchWorkgroups(Math.ceil(this.gw/o),Math.ceil(this.gh/o)),t.end(),d(e,this.ctx.getCurrentTexture().createView(),this.renderPL,this.renderBG),this.device.queue.submit([e.finish()])}}const a={alive:[.82,.84,.88,.55],dead:[1,1,1,.82]},u={alive:[.05,.06,.09,.62],dead:[0,0,0,.78]};function c(){return document.documentElement.classList.contains("dark")}const s=document.getElementById("hero-sim");if(s){const i=new m({canvas:s,cellSize:10,updateInterval:150,initialDensity:.25,colors:c()?u:a});i.start().then(e=>{if(!e){s.remove();return}document.getElementById("hero-overlay")?.classList.add("hidden"),new ResizeObserver(()=>i.handleResize()).observe(s),new MutationObserver(()=>{i.updateColors(c()?u:a)}).observe(document.documentElement,{attributes:!0,attributeFilter:["class"]})})}
