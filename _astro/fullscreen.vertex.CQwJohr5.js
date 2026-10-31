import{r as t,b as s,f as r}from"./utils.DccTNe7p.js";class h{canvas;cellSize;interval;device;ctx;format;gw=0;gh=0;renderPL;renderBG;raf=null;last=0;resizeTimer=null;constructor(e){this.canvas=e.canvas,this.cellSize=e.cellSize,this.interval=e.updateInterval}sizeCanvas(){t(this.canvas)}async start(){try{this.sizeCanvas();const e=await s(this.canvas);return e?(this.device=e.device,this.ctx=e.context,this.format=e.format,this.device.lost.then(i=>{console.warn(`[${this.constructor.name}] Device lost (${i.reason}): ${i.message}`),this.stop()}),this.gw=Math.ceil(this.canvas.width/this.cellSize),this.gh=Math.ceil(this.canvas.height/this.cellSize),this.buildPipelines(),this.buildResources(),this.onStart(),this.renderFrame(),this.raf=requestAnimationFrame(this.loop),!0):!1}catch(e){return console.warn(`[${this.constructor.name}] Init failed:`,e),!1}}stop(){this.raf!==null&&cancelAnimationFrame(this.raf),this.raf=null,this.resizeTimer!==null&&clearTimeout(this.resizeTimer),this.resizeTimer=null,this.onStop()}handleResize(){this.resizeTimer!==null&&clearTimeout(this.resizeTimer),this.resizeTimer=setTimeout(()=>this.rebuild(),150)}rebuild(){this.sizeCanvas(),this.ctx.configure({device:this.device,format:this.format,alphaMode:"premultiplied"}),this.gw=Math.ceil(this.canvas.width/this.cellSize),this.gh=Math.ceil(this.canvas.height/this.cellSize),this.destroyResources(),this.buildResources(),this.renderFrame()}renderFrame(){const e=this.device.createCommandEncoder();r(e,this.ctx.getCurrentTexture().createView(),this.renderPL,this.renderBG),this.device.queue.submit([e.finish()])}loop=e=>{this.raf=requestAnimationFrame(this.loop),!(e-this.last<this.interval)&&(this.last=e,this.frame())};onStart(){}onStop(){}}const c=`struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vert(@builtin(vertex_index) i: u32) -> VSOut {
  let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: VSOut;
  o.pos = vec4f(p[i], 0, 1);
  o.uv = p[i] * 0.5 + 0.5;
  return o;
}
`;export{h as W,c as f};
