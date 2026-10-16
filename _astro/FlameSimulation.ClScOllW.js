import{W as _,f as v}from"./fullscreen.vertex.CQwJohr5.js";import{a as b,c as y,f as z}from"./utils.DccTNe7p.js";const k=`// D3Q19 lattice constants for 3D Lattice Boltzmann Method

const CS2: f32 = 1.0 / 3.0;  // speed of sound squared
const INV_CS2: f32 = 3.0;
const INV_2CS4: f32 = 4.5;
const INV_2CS2: f32 = 1.5;

// 19 lattice velocity vectors (rest + 6 face + 12 edge)
const E = array<vec3i, 19>(
  vec3i( 0,  0,  0),  //  0: rest
  vec3i( 1,  0,  0),  //  1: +x
  vec3i(-1,  0,  0),  //  2: -x
  vec3i( 0,  1,  0),  //  3: +y
  vec3i( 0, -1,  0),  //  4: -y
  vec3i( 0,  0,  1),  //  5: +z
  vec3i( 0,  0, -1),  //  6: -z
  vec3i( 1,  1,  0),  //  7: +x+y
  vec3i(-1,  1,  0),  //  8: -x+y
  vec3i( 1, -1,  0),  //  9: +x-y
  vec3i(-1, -1,  0),  // 10: -x-y
  vec3i( 1,  0,  1),  // 11: +x+z
  vec3i(-1,  0,  1),  // 12: -x+z
  vec3i( 1,  0, -1),  // 13: +x-z
  vec3i(-1,  0, -1),  // 14: -x-z
  vec3i( 0,  1,  1),  // 15: +y+z
  vec3i( 0, -1,  1),  // 16: -y+z
  vec3i( 0,  1, -1),  // 17: +y-z
  vec3i( 0, -1, -1),  // 18: -y-z
);

// Lattice weights
const W = array<f32, 19>(
  1.0 / 3.0,   // rest
  1.0 / 18.0, 1.0 / 18.0, 1.0 / 18.0,  // face +x -x +y
  1.0 / 18.0, 1.0 / 18.0, 1.0 / 18.0,  // face -y +z -z
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0,  // edge xy
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0,  // edge xz
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0,  // edge yz
);

// Opposite direction index for each q (used in pull-based streaming)
const OPP = array<u32, 19>(
  0u,   // rest -> rest
  2u,   // +x -> -x
  1u,   // -x -> +x
  4u,   // +y -> -y
  3u,   // -y -> +y
  6u,   // +z -> -z
  5u,   // -z -> +z
  10u,  // +x+y -> -x-y
  9u,   // -x+y -> +x-y
  8u,   // +x-y -> -x+y
  7u,   // -x-y -> +x+y
  14u,  // +x+z -> -x-z
  13u,  // -x+z -> +x-z
  12u,  // +x-z -> -x+z
  11u,  // -x-z -> +x+z
  18u,  // +y+z -> -y-z
  17u,  // -y+z -> +y-z
  16u,  // +y-z -> -y+z
  15u,  // -y-z -> +y+z
);

// Compute equilibrium distribution for direction q
fn equilibrium(q: u32, rho: f32, u: vec3f) -> f32 {
  let ei = vec3f(E[q]);
  let eu = dot(ei, u);
  let uu = dot(u, u);
  return rho * W[q] * (1.0 + INV_CS2 * eu + INV_2CS4 * eu * eu - INV_2CS2 * uu);
}
`,w=`// Shared simulation parameters for all flame compute shaders

struct SimParams {
  n: u32,              // grid cells per X/Z dimension
  ny: u32,             // grid cells Y dimension (height = n * 2)
  tau: f32,            // BGK relaxation time (viscosity = (tau - 0.5) / 3)
  buoyancy: f32,       // thermal buoyancy strength
  heat_rate: f32,      // heat injection rate at source
  cooling: f32,        // per-step temperature decay (e.g. 0.995)
  source_radius: f32,  // heat source radius (fraction of N)
  source_jitter: f32,  // injection center noise amplitude (fraction of N)
  time: f32,           // accumulated time for injection noise
  num_swirls: u32,     // active swirl vortex count
  gol_n: u32,          // Game of Life grid size
  gol_threshold: f32,  // smoke density threshold for GoL cell birth
  gol_transition: f32, // height fraction where smoke→GoL transition begins
  gol_threshold_2d: f32, // smoke threshold for 2D overlay GoL seeding
  gol2d_n: u32,        // 2D overlay GoL grid rows (height)
  gol2d_cols: u32,     // 2D overlay GoL grid columns (width)
}
`,B=`// 3D grid indexing utilities
// Trilinear interpolation is written inline in each shader because
// WGSL does not allow storage-address-space pointer parameters.

fn idx3d(x: u32, y: u32, z: u32, nx: u32, ny: u32) -> u32 {
  return z * nx * ny + y * nx + x;
}

fn idx3v(p: vec3u, nx: u32, ny: u32) -> u32 {
  return p.z * nx * ny + p.y * nx + p.x;
}
`,P=`// Initialize all LBM distributions to equilibrium (resting fluid)

#import d3q19
#import flame_params

@group(0) @binding(0) var<storage, read_write> dist: array<f32>;
@group(0) @binding(1) var<storage, read_write> macro_field: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> temp: array<f32>;
@group(0) @binding(3) var<uniform> params: SimParams;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = params.n;
  let ny = params.ny;
  if (id.x >= n || id.y >= ny || id.z >= n) { return; }

  let idx = id.z * n * ny + id.y * n + id.x;
  let N = n * ny * n;

  // Equilibrium at rest: rho = 1, u = (0, 0, 0)
  for (var q = 0u; q < 19u; q++) {
    dist[q * N + idx] = equilibrium(q, 1.0, vec3f(0.0));
  }

  macro_field[idx] = vec4f(0.0, 0.0, 0.0, 1.0);
  temp[idx] = 0.0;
}
`,S=`// Fused pull-based streaming + BGK collision + buoyancy forcing
// Single read_write buffer — race conditions at workgroup boundaries
// are accepted for visual turbulence.

#import d3q19
#import flame_params

@group(0) @binding(0) var<storage, read_write> dist: array<f32>;
@group(0) @binding(1) var<storage, read_write> macro_field: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> temp: array<f32>;
@group(0) @binding(3) var<uniform> params: SimParams;
@group(0) @binding(4) var<storage, read> swirls: array<vec4f>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = params.n;
  let ny = params.ny;
  if (id.x >= n || id.y >= ny || id.z >= n) { return; }

  let idx = id.z * n * ny + id.y * n + id.x;
  let N = n * ny * n;
  let ni = i32(n);
  let niy = i32(ny);

  // --- PULL: gather distributions from upstream neighbors ---
  // For direction q, the distribution arriving here was at (x - e_q)
  // before streaming. Toroidal wrapping on all boundaries.
  var f: array<f32, 19>;
  for (var q = 0u; q < 19u; q++) {
    let src = (vec3i(id) - E[q] + vec3i(ni, niy, ni)) % vec3i(ni, niy, ni);
    let src_idx = u32(src.z) * n * ny + u32(src.y) * n + u32(src.x);
    f[q] = dist[q * N + src_idx];
  }

  // --- Macroscopic quantities ---
  var rho: f32 = 0.0;
  var vel = vec3f(0.0);
  for (var q = 0u; q < 19u; q++) {
    rho += f[q];
    vel += f[q] * vec3f(E[q]);
  }
  vel /= max(rho, 0.001);  // guard against division by zero

  // --- Buoyancy: hot fluid rises ---
  let t = temp[idx];
  vel.y += params.buoyancy * t;

  // --- Swirl vortices: coherent rotational disturbances ---
  // Discrete vortex particles spawned at the heat source and advected
  // by buoyancy. Each imposes solid-body rotation on nearby cells.
  let pos = vec3f(f32(id.x), f32(id.y), f32(id.z));
  for (var s = 0u; s < params.num_swirls; s++) {
    let sp = swirls[s * 2u];       // xyz = position, w = omega
    let sr = swirls[s * 2u + 1u];  // x = radius

    let dx = pos.x - sp.x;
    let dz = pos.z - sp.z;
    let r_xz = sqrt(dx * dx + dz * dz);
    let dy = abs(pos.y - sp.y);

    let radial = smoothstep(sr.x, 0.0, r_xz);
    let vertical = smoothstep(sr.x, 0.0, dy);
    let strength = sp.w * radial * vertical;

    // Solid-body rotation: v_tangential = omega * r
    vel.x += -dz * strength;
    vel.z += dx * strength;
  }

  // --- Velocity clamp: ensure LBM stability (Mach < 0.15) ---
  let speed = length(vel);
  if (speed > 0.15) {
    vel = vel * (0.15 / speed);
  }

  // --- BGK collision: relax toward equilibrium ---
  for (var q = 0u; q < 19u; q++) {
    let feq = equilibrium(q, rho, vel);
    dist[q * N + idx] = f[q] + (feq - f[q]) / params.tau;
  }

  // --- Export for rendering and temperature advection ---
  macro_field[idx] = vec4f(vel, rho);
}
`,G=`// Temperature advection (semi-Lagrangian), cooling, and heat injection.
// In-place read_write on temp buffer — races accepted.

#import trilinear
#import flame_params

@group(0) @binding(0) var<storage, read_write> temp: array<f32>;
@group(0) @binding(1) var<storage, read_write> macro_field: array<vec4f>;
@group(0) @binding(2) var<uniform> params: SimParams;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = params.n;
  let ny = params.ny;
  if (id.x >= n || id.y >= ny || id.z >= n) { return; }

  let idx = id.z * n * ny + id.y * n + id.x;
  let nf = f32(n);
  let nyf = f32(ny);

  // --- Semi-Lagrangian advection: backtrack through velocity field ---
  let vel = macro_field[idx].xyz;
  let back_pos = vec3f(id) - vel;

  // Trilinear sample temperature at back-traced position
  let p = clamp(back_pos, vec3f(0.0), vec3f(nf - 1.001, nyf - 1.001, nf - 1.001));
  let p0 = vec3u(floor(p));
  let fr = p - vec3f(p0);

  let c000 = temp[idx3d(p0.x,      p0.y,      p0.z,      n, ny)];
  let c100 = temp[idx3d(p0.x + 1u, p0.y,      p0.z,      n, ny)];
  let c010 = temp[idx3d(p0.x,      p0.y + 1u, p0.z,      n, ny)];
  let c110 = temp[idx3d(p0.x + 1u, p0.y + 1u, p0.z,      n, ny)];
  let c001 = temp[idx3d(p0.x,      p0.y,      p0.z + 1u, n, ny)];
  let c101 = temp[idx3d(p0.x + 1u, p0.y,      p0.z + 1u, n, ny)];
  let c011 = temp[idx3d(p0.x,      p0.y + 1u, p0.z + 1u, n, ny)];
  let c111 = temp[idx3d(p0.x + 1u, p0.y + 1u, p0.z + 1u, n, ny)];

  let c00 = mix(c000, c100, fr.x);
  let c10 = mix(c010, c110, fr.x);
  let c01 = mix(c001, c101, fr.x);
  let c11 = mix(c011, c111, fr.x);
  let c0  = mix(c00, c10, fr.y);
  let c1  = mix(c01, c11, fr.y);
  var t   = mix(c0, c1, fr.z);

  // --- Cooling: temperature decays each step ---
  t *= params.cooling;

  // --- Heat injection at base ---
  // Ring source at bottom-center (cigarette ember), jittered for flicker
  let center_xz = vec2f(nf * 0.5, nf * 0.5);
  let jx = sin(params.time * 2.7) * params.source_jitter * nf;
  let jz = cos(params.time * 3.1) * params.source_jitter * nf;
  let src_xz = center_xz + vec2f(jx, jz);

  let cell_xz = vec2f(f32(id.x), f32(id.z));
  let dist_xz = length(cell_xz - src_xz);
  let ring_r = params.source_radius * nf;
  let ring_w = ring_r * 0.3;
  let heat_xz = smoothstep(ring_w, 0.0, abs(dist_xz - ring_r));
  let heat_y  = smoothstep(ring_r * 0.5, 0.0, f32(id.y));
  t += params.heat_rate * heat_xz * heat_y;

  temp[idx] = clamp(t, 0.0, 1.0);
}
`,q=`// Volumetric ray marching through the 3D smoke density field,
// with screen-space Game of Life overlay above transition height.

#import fullscreen_vertex

struct RenderParams {
  inv_view_proj: mat4x4f,
  camera_pos: vec4f,   // xyz = position, w = f32(grid_size)
  alive: vec4f,
  dead: vec4f,
  params: vec4f,       // xy = resolution, z = density_scale, w = f32(march_steps)
  gol_params: vec4f,   // x = f32(gol_n), y = pixel_scale_max, z = volume_h, w = f32(grid_ny)
  gol_rect: vec4f,     // x = threshold_3d, y = threshold_2d, z = f32(gol2d_rows), w = f32(gol2d_cols)
}

@group(0) @binding(0) var<storage, read> smoke: array<f32>;
@group(0) @binding(1) var<uniform> rp: RenderParams;
@group(0) @binding(2) var<storage, read> gol: array<u32>;
@group(0) @binding(3) var<storage, read> gol2d: array<u32>;

fn idx3(x: u32, y: u32, z: u32, nx: u32, ny: u32) -> u32 {
  return z * nx * ny + y * nx + x;
}

fn sample_smoke(pos: vec3f, nx: u32, ny: u32) -> f32 {
  let nxf = f32(nx);
  let nyf = f32(ny);
  let p = clamp(pos, vec3f(0.0), vec3f(nxf - 1.001, nyf - 1.001, nxf - 1.001));
  let p0 = vec3u(floor(p));
  let fr = p - vec3f(p0);

  let c000 = smoke[idx3(p0.x,      p0.y,      p0.z,      nx, ny)];
  let c100 = smoke[idx3(p0.x + 1u, p0.y,      p0.z,      nx, ny)];
  let c010 = smoke[idx3(p0.x,      p0.y + 1u, p0.z,      nx, ny)];
  let c110 = smoke[idx3(p0.x + 1u, p0.y + 1u, p0.z,      nx, ny)];
  let c001 = smoke[idx3(p0.x,      p0.y,      p0.z + 1u, nx, ny)];
  let c101 = smoke[idx3(p0.x + 1u, p0.y,      p0.z + 1u, nx, ny)];
  let c011 = smoke[idx3(p0.x,      p0.y + 1u, p0.z + 1u, nx, ny)];
  let c111 = smoke[idx3(p0.x + 1u, p0.y + 1u, p0.z + 1u, nx, ny)];

  let c00 = mix(c000, c100, fr.x);
  let c10 = mix(c010, c110, fr.x);
  let c01 = mix(c001, c101, fr.x);
  let c11 = mix(c011, c111, fr.x);
  let c0  = mix(c00, c10, fr.y);
  let c1  = mix(c01, c11, fr.y);
  return mix(c0, c1, fr.z);
}

fn intersect_aabb(origin: vec3f, dir: vec3f, bmin: vec3f, bmax: vec3f) -> vec2f {
  let inv_dir = 1.0 / dir;
  let t1 = (bmin - origin) * inv_dir;
  let t2 = (bmax - origin) * inv_dir;
  let tmin = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
  let tmax = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
  return vec2f(max(tmin, 0.0), tmax);
}

// Ray march with volumetric GoL binarization, returning smoke alpha.
fn march(uv: vec2f, grid_n: u32, grid_ny: u32, gol_n: u32,
         density_scale: f32, steps: u32, volume_h: f32, threshold: f32) -> f32 {
  let nf = f32(grid_n);
  let nyf = f32(grid_ny);

  let ndc = vec2f(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0);
  let clip = rp.inv_view_proj * vec4f(ndc, 1.0, 1.0);
  let world_pt = clip.xyz / clip.w;
  let ray_origin = rp.camera_pos.xyz;
  let ray_dir = normalize(world_pt - ray_origin);

  let hit = intersect_aabb(ray_origin, ray_dir, vec3f(0.0), vec3f(1.0, volume_h, 1.0));
  let gol_block = nf / f32(gol_n);

  var smoke_alpha = 0.0;
  if (hit.x < hit.y) {
    let step_size = (hit.y - hit.x) / f32(steps);
    var t = hit.x + step_size * 0.5;
    for (var i = 0u; i < steps; i++) {
      if (t >= hit.y) { break; }
      let pos = ray_origin + ray_dir * t;
      let grid_pos = vec3f(pos.x * nf, pos.y / volume_h * nyf, pos.z * nf);

      var smoke_val = max(sample_smoke(grid_pos, grid_n, grid_ny), 0.0);

      if (gol_n > 0u) {
        let qpos = (floor(grid_pos / gol_block) + 0.5) * gol_block;
        let qsmoke = max(sample_smoke(qpos, grid_n, grid_ny), 0.0);
        let gx = u32(clamp(qpos.x / nf * f32(gol_n), 0.0, f32(gol_n) - 1.0));
        let gz = u32(clamp(qpos.z / nf * f32(gol_n), 0.0, f32(gol_n) - 1.0));
        let gol_cell = f32(gol[gz * gol_n + gx]);
        smoke_val = smoke_val * (1.0 - gol_cell) + gol_cell * step(threshold, qsmoke);
      }

      smoke_alpha += (1.0 - smoke_alpha) * smoke_val * density_scale * step_size;
      if (smoke_alpha > 0.99) { break; }
      t += step_size;
    }
    smoke_alpha = clamp(smoke_alpha, 0.0, 1.0);
  }
  return smoke_alpha;
}

@fragment
fn frag(in: VSOut) -> @location(0) vec4f {
  let grid_n = u32(rp.camera_pos.w);
  let grid_ny = u32(rp.gol_params.w);
  let density_scale = rp.params.z;
  let steps = u32(rp.params.w);
  let gol_n = u32(rp.gol_params.x);
  let volume_h = rp.gol_params.z;
  let threshold = rp.gol_rect.x;

  // 1. High-res smoke + volumetric GoL (background)
  let smooth_alpha = march(in.uv, grid_n, grid_ny, gol_n,
                           density_scale, steps, volume_h, threshold);
  let smooth_color = mix(rp.dead.rgb, rp.alive.rgb, smooth_alpha);

  // 2. 2D GoL screen overlay
  let gol2d_rows = u32(rp.gol_rect.z);
  let gol2d_cols = u32(rp.gol_rect.w);
  if (gol2d_rows > 0u) {
    let res = rp.params.xy;
    let block_px = res.y / f32(gol2d_rows);
    let pixel = in.uv * res;
    let cx = u32(floor(pixel.x / block_px));
    let cy = u32(floor(pixel.y / block_px));
    if (cx < gol2d_cols && cy < gol2d_rows) {
      if (gol2d[cy * gol2d_cols + cx] == 1u) {
        return vec4f(rp.alive.rgb, 1.0);
      }
    }
  }
  return vec4f(smooth_color, 1.0);
}
`,C=`// Passive smoke tracer — thin ring injection, pure advection, slow fade.
// Decoupled from temperature: smoke is what you SEE, temperature drives PHYSICS.

#import trilinear
#import flame_params

@group(0) @binding(0) var<storage, read_write> smoke: array<f32>;
@group(0) @binding(1) var<storage, read_write> macro_field: array<vec4f>;
@group(0) @binding(2) var<uniform> params: SimParams;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = params.n;
  let ny = params.ny;
  if (id.x >= n || id.y >= ny || id.z >= n) { return; }

  let idx = id.z * n * ny + id.y * n + id.x;
  let nf = f32(n);
  let nyf = f32(ny);

  // --- Semi-Lagrangian advection ---
  let vel = macro_field[idx].xyz;
  let back_pos = vec3f(id) - vel;

  let p = clamp(back_pos, vec3f(0.0), vec3f(nf - 1.001, nyf - 1.001, nf - 1.001));
  let p0 = vec3u(floor(p));
  let fr = p - vec3f(p0);

  let c000 = smoke[idx3d(p0.x,      p0.y,      p0.z,      n, ny)];
  let c100 = smoke[idx3d(p0.x + 1u, p0.y,      p0.z,      n, ny)];
  let c010 = smoke[idx3d(p0.x,      p0.y + 1u, p0.z,      n, ny)];
  let c110 = smoke[idx3d(p0.x + 1u, p0.y + 1u, p0.z,      n, ny)];
  let c001 = smoke[idx3d(p0.x,      p0.y,      p0.z + 1u, n, ny)];
  let c101 = smoke[idx3d(p0.x + 1u, p0.y,      p0.z + 1u, n, ny)];
  let c011 = smoke[idx3d(p0.x,      p0.y + 1u, p0.z + 1u, n, ny)];
  let c111 = smoke[idx3d(p0.x + 1u, p0.y + 1u, p0.z + 1u, n, ny)];

  let c00 = mix(c000, c100, fr.x);
  let c10 = mix(c010, c110, fr.x);
  let c01 = mix(c001, c101, fr.x);
  let c11 = mix(c011, c111, fr.x);
  let c0  = mix(c00, c10, fr.y);
  let c1  = mix(c01, c11, fr.y);
  var s   = mix(c0, c1, fr.z);

  // --- Slow fade (prevent infinite accumulation) ---
  s *= 0.9995;

  // --- Thin ring injection at base ---
  let center_xz = vec2f(nf * 0.5, nf * 0.5);
  let jx = sin(params.time * 2.7) * params.source_jitter * nf;
  let jz = cos(params.time * 3.1) * params.source_jitter * nf;
  let src_xz = center_xz + vec2f(jx, jz);

  let cell_xz = vec2f(f32(id.x), f32(id.z));
  let dist_xz = length(cell_xz - src_xz);
  let ring_r = params.source_radius * nf;
  let smoke_xz = smoothstep(1.0, 0.0, abs(dist_xz - ring_r));
  let smoke_y = smoothstep(2.0, 0.0, f32(id.y));
  s = max(s, smoke_xz * smoke_y);

  smoke[idx] = clamp(s, 0.0, 1.0);
}
`,L=`// Game of Life on XZ plane, seeded from smoke density.
// Single read_write buffer — race conditions at workgroup boundaries accepted.

#import flame_params

@group(0) @binding(0) var<storage, read_write> gol: array<u32>;
@group(0) @binding(1) var<storage, read> smoke: array<f32>;
@group(0) @binding(2) var<uniform> params: SimParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.xy;  // x = X axis, y = Z axis in smoke volume
  let n = params.gol_n;
  if (id.x >= n || id.y >= n) { return; }

  let ni = i32(n);

  // Read current state: gol[z * n + x]
  let state = gol[id.y * n + id.x];

  // Count neighbors (wrap both axes)
  var neighbors = 0u;
  for (var dz = -1; dz <= 1; dz++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dz == 0) { continue; }
      let nz = (i32(id.y) + dz + ni) % ni;
      let nx = (i32(id.x) + dx + ni) % ni;
      neighbors += gol[u32(nz) * n + u32(nx)];
    }
  }

  // B3/S23 rules
  var alive = (state == 1u && (neighbors == 2u || neighbors == 3u))
           || (state == 0u && neighbors == 3u);

  // Seed from smoke density (sample 3D smoke at mapped XZ position, mid Y)
  let smoke_n = params.n;
  let smoke_ny = params.ny;
  let fx = f32(id.x) / f32(n) * f32(smoke_n);
  let fz = f32(id.y) / f32(n) * f32(smoke_n);
  let fy = f32(smoke_ny) * 0.5;  // sample at vertical midpoint

  let sx = u32(clamp(fx, 0.0, f32(smoke_n - 1u)));
  let sy = u32(clamp(fy, 0.0, f32(smoke_ny - 1u)));
  let sz = u32(clamp(fz, 0.0, f32(smoke_n - 1u)));

  let smoke_idx = sz * smoke_n * smoke_ny + sy * smoke_n + sx;
  let density = smoke[smoke_idx];

  if (density > params.gol_threshold) {
    alive = true;
  }

  gol[id.y * n + id.x] = select(0u, 1u, alive);
}
`,N=`// 2D Game of Life for screen-space overlay.
// Seeded from the same quantized ray march used by the low-res overlay.

#import flame_params

struct RenderParams {
  inv_view_proj: mat4x4f,
  camera_pos: vec4f,
  alive: vec4f,
  dead: vec4f,
  params: vec4f,
  gol_params: vec4f,
  gol_rect: vec4f,
}

@group(0) @binding(0) var<storage, read_write> gol2d: array<u32>;
@group(0) @binding(1) var<storage, read> smoke: array<f32>;
@group(0) @binding(2) var<uniform> sp: SimParams;
@group(0) @binding(3) var<uniform> rp: RenderParams;
@group(0) @binding(4) var<storage, read> gol: array<u32>;

fn idx3(x: u32, y: u32, z: u32, nx: u32, ny: u32) -> u32 {
  return z * nx * ny + y * nx + x;
}

fn sample_smoke(pos: vec3f, nx: u32, ny: u32) -> f32 {
  let nxf = f32(nx);
  let nyf = f32(ny);
  let p = clamp(pos, vec3f(0.0), vec3f(nxf - 1.001, nyf - 1.001, nxf - 1.001));
  let p0 = vec3u(floor(p));
  let fr = p - vec3f(p0);

  let c000 = smoke[idx3(p0.x,      p0.y,      p0.z,      nx, ny)];
  let c100 = smoke[idx3(p0.x + 1u, p0.y,      p0.z,      nx, ny)];
  let c010 = smoke[idx3(p0.x,      p0.y + 1u, p0.z,      nx, ny)];
  let c110 = smoke[idx3(p0.x + 1u, p0.y + 1u, p0.z,      nx, ny)];
  let c001 = smoke[idx3(p0.x,      p0.y,      p0.z + 1u, nx, ny)];
  let c101 = smoke[idx3(p0.x + 1u, p0.y,      p0.z + 1u, nx, ny)];
  let c011 = smoke[idx3(p0.x,      p0.y + 1u, p0.z + 1u, nx, ny)];
  let c111 = smoke[idx3(p0.x + 1u, p0.y + 1u, p0.z + 1u, nx, ny)];

  let c00 = mix(c000, c100, fr.x);
  let c10 = mix(c010, c110, fr.x);
  let c01 = mix(c001, c101, fr.x);
  let c11 = mix(c011, c111, fr.x);
  let c0  = mix(c00, c10, fr.y);
  let c1  = mix(c01, c11, fr.y);
  return mix(c0, c1, fr.z);
}

fn intersect_aabb(origin: vec3f, dir: vec3f, bmin: vec3f, bmax: vec3f) -> vec2f {
  let inv_dir = 1.0 / dir;
  let t1 = (bmin - origin) * inv_dir;
  let t2 = (bmax - origin) * inv_dir;
  let tmin = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
  let tmax = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
  return vec2f(max(tmin, 0.0), tmax);
}

fn march(uv: vec2f) -> f32 {
  let grid_n = u32(rp.camera_pos.w);
  let grid_ny = u32(rp.gol_params.w);
  let density_scale = rp.params.z;
  let steps = u32(rp.params.w);
  let gol_n = u32(rp.gol_params.x);
  let volume_h = rp.gol_params.z;
  let threshold = rp.gol_rect.x;
  let nf = f32(grid_n);
  let gol_block = nf / f32(gol_n);

  let ndc = vec2f(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0);
  let clip = rp.inv_view_proj * vec4f(ndc, 1.0, 1.0);
  let world_pt = clip.xyz / clip.w;
  let ray_origin = rp.camera_pos.xyz;
  let ray_dir = normalize(world_pt - ray_origin);

  let hit = intersect_aabb(ray_origin, ray_dir, vec3f(0.0), vec3f(1.0, volume_h, 1.0));

  var smoke_alpha = 0.0;
  if (hit.x < hit.y) {
    let step_size = (hit.y - hit.x) / f32(steps);
    var t = hit.x + step_size * 0.5;
    for (var i = 0u; i < steps; i++) {
      if (t >= hit.y) { break; }
      let pos = ray_origin + ray_dir * t;
      let grid_pos = vec3f(pos.x * nf, pos.y / volume_h * f32(grid_ny), pos.z * nf);

      var smoke_val = max(sample_smoke(grid_pos, grid_n, grid_ny), 0.0);

      if (gol_n > 0u) {
        let qpos = (floor(grid_pos / gol_block) + 0.5) * gol_block;
        let qsmoke = max(sample_smoke(qpos, grid_n, grid_ny), 0.0);
        let gx = u32(clamp(qpos.x / nf * f32(gol_n), 0.0, f32(gol_n) - 1.0));
        let gz = u32(clamp(qpos.z / nf * f32(gol_n), 0.0, f32(gol_n) - 1.0));
        let gol_cell = f32(gol[gz * gol_n + gx]);
        smoke_val = smoke_val * (1.0 - gol_cell) + gol_cell * step(threshold, qsmoke);
      }

      smoke_alpha += (1.0 - smoke_alpha) * smoke_val * density_scale * step_size;
      if (smoke_alpha > 0.99) { break; }
      t += step_size;
    }
  }
  return clamp(smoke_alpha, 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.xy;
  let cols = sp.gol2d_cols;
  let rows = sp.gol2d_n;
  if (id.x >= cols || id.y >= rows) { return; }

  let ri = i32(rows);
  let ci = i32(cols);

  // Advect: read from 1 cell below to push pattern upward (no Y wrap)
  let src_y = i32(id.y) - 1;
  var state = 0u;
  if (src_y >= 0) {
    state = gol2d[u32(src_y) * cols + id.x];
  }

  // Count neighbors around source position (Y clamped at top, X wraps)
  var neighbors = 0u;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let ny_idx = src_y + dy;
      if (ny_idx < 0 || ny_idx >= ri) { continue; }
      let nx_idx = (i32(id.x) + dx + ci) % ci;
      neighbors += gol2d[u32(ny_idx) * cols + u32(nx_idx)];
    }
  }

  // B3/S23 rules — top row absorbs (no wrapping)
  var alive = (state == 1u && (neighbors == 2u || neighbors == 3u))
           || (state == 0u && neighbors == 3u);
  if (id.y == rows - 1u) { alive = false; }

  // Seed from screen-space quantized march
  let res = rp.params.xy;
  let block_px = res.y / f32(rows);
  let block_uv = vec2f(block_px / res.x, block_px / res.y);
  let uv = (vec2f(f32(id.x), f32(id.y)) + 0.5) * block_uv;

  let alpha = march(uv);
  if (alpha > sp.gol_threshold_2d) {
    alive = true;
  }

  gol2d[id.y * cols + id.x] = select(0u, 1u, alive);
}
`;function U(r,n,i,e){const t=1/Math.tan(r/2),l=1/(i-e),o=new Float32Array(16);return o[0]=t/n,o[5]=t,o[10]=e*l,o[11]=-1,o[14]=i*e*l,o}function M(r,n,i){let e=r[0]-n[0],t=r[1]-n[1],l=r[2]-n[2],o=1/Math.sqrt(e*e+t*t+l*l);e*=o,t*=o,l*=o;let d=i[1]*l-i[2]*t,a=i[2]*e-i[0]*l,s=i[0]*t-i[1]*e;o=1/Math.sqrt(d*d+a*a+s*s),d*=o,a*=o,s*=o;const u=t*s-l*a,f=l*d-e*s,m=e*a-t*d;return new Float32Array([d,u,e,0,a,f,t,0,s,m,l,0,-(d*r[0]+a*r[1]+s*r[2]),-(u*r[0]+f*r[1]+m*r[2]),-(e*r[0]+t*r[1]+l*r[2]),1])}function T(r,n){const i=new Float32Array(16);for(let e=0;e<4;e++)for(let t=0;t<4;t++){let l=0;for(let o=0;o<4;o++)l+=r[o*4+t]*n[e*4+o];i[e*4+t]=l}return i}function R(r){const n=new Float32Array(16);n[0]=r[0],n[1]=r[4],n[2]=r[8],n[4]=r[1],n[5]=r[5],n[6]=r[9],n[8]=r[2],n[9]=r[6],n[10]=r[10],n[3]=0,n[7]=0,n[11]=0;const i=r[12],e=r[13],t=r[14];return n[12]=-(n[0]*i+n[4]*e+n[8]*t),n[13]=-(n[1]*i+n[5]*e+n[9]*t),n[14]=-(n[2]*i+n[6]*e+n[10]*t),n[15]=1,n}function j(r){const n=new Float32Array(16);return n[0]=1/r[0],n[5]=1/r[5],n[11]=1/r[14],n[14]=-1,n[15]=r[10]/r[14],n}class E extends _{gridN;colors;distBuf=null;macroBuf=null;tempBuf=null;smokeBuf=null;simParamsBuf=null;renderParamsBuf=null;swirlBuf=null;golBuf=null;gol2dBuf=null;initPL;lbmPL;tempPL;smokePL;golPL;gol2dPL;initBG;lbmBG;tempBG;smokeBG;golBG;gol2dBG;theta=0;phi=.3;radius=2.5;simTime=0;marchSteps;swirlCount=0;swirlCPU=new Float32Array(512);golN=256;gol2dN=256;gol2dMaxCols;golTickAccum=0;gol2dTickAccum=0;tuning={detail:72,buoyancy:.105,heatRate:2.1,sourceRadius:.02,turbulence:0,densityScale:10,golThreshold:.05,golThreshold2D:.8,golTransition:0,golTickRate:.1,gol2dTickRate:.5,golPixelScaleMax:1};constructor(n){super({canvas:n.canvas,cellSize:1,updateInterval:0}),n.gridSize&&(this.tuning.detail=n.gridSize),b()&&(this.tuning.detail=Math.min(this.tuning.detail,48),this.golN=128,this.gol2dN=128),this.gridN=this.tuning.detail,this.gol2dMaxCols=this.gol2dN*4,this.colors=n.colors,this.marchSteps=this.gridN}buildPipelines(){const n={d3q19:k,flame_params:w,trilinear:B,fullscreen_vertex:v},i=t=>this.device.createComputePipeline({layout:"auto",compute:{module:y(this.device,t,n)}});this.initPL=i(P),this.lbmPL=i(S),this.tempPL=i(G),this.smokePL=i(C),this.golPL=i(L),this.gol2dPL=i(N);const e=y(this.device,q,n);this.renderPL=this.device.createRenderPipeline({layout:"auto",vertex:{module:e,entryPoint:"vert"},fragment:{module:e,entryPoint:"frag",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}})}buildResources(){const n=this.gridN,i=n*2,e=n*i*n;if(!this.distBuf){this.distBuf=this.device.createBuffer({size:19*e*4,usage:GPUBufferUsage.STORAGE}),this.macroBuf=this.device.createBuffer({size:e*16,usage:GPUBufferUsage.STORAGE}),this.tempBuf=this.device.createBuffer({size:e*4,usage:GPUBufferUsage.STORAGE}),this.smokeBuf=this.device.createBuffer({size:e*4,usage:GPUBufferUsage.STORAGE}),this.simParamsBuf=this.device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.swirlBuf=this.device.createBuffer({size:2048,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.golBuf=this.device.createBuffer({size:this.golN*this.golN*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const l=new Uint32Array(this.golN*this.golN),o=this.golN/2,d=this.golN*.15;for(let p=0;p<this.golN;p++)for(let g=0;g<this.golN;g++){const h=g-o,x=p-o;h*h+x*x<d*d&&Math.random()<.07&&(l[p*this.golN+g]=1)}this.device.queue.writeBuffer(this.golBuf,0,l),this.gol2dBuf=this.device.createBuffer({size:this.gol2dMaxCols*this.gol2dN*4,usage:GPUBufferUsage.STORAGE});const a=[{binding:0,resource:{buffer:this.distBuf}},{binding:1,resource:{buffer:this.macroBuf}},{binding:2,resource:{buffer:this.tempBuf}},{binding:3,resource:{buffer:this.simParamsBuf}}];this.initBG=this.device.createBindGroup({layout:this.initPL.getBindGroupLayout(0),entries:a}),this.lbmBG=this.device.createBindGroup({layout:this.lbmPL.getBindGroupLayout(0),entries:[...a,{binding:4,resource:{buffer:this.swirlBuf}}]}),this.tempBG=this.device.createBindGroup({layout:this.tempPL.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.tempBuf}},{binding:1,resource:{buffer:this.macroBuf}},{binding:2,resource:{buffer:this.simParamsBuf}}]}),this.smokeBG=this.device.createBindGroup({layout:this.smokePL.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.smokeBuf}},{binding:1,resource:{buffer:this.macroBuf}},{binding:2,resource:{buffer:this.simParamsBuf}}]}),this.golBG=this.device.createBindGroup({layout:this.golPL.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.golBuf}},{binding:1,resource:{buffer:this.smokeBuf}},{binding:2,resource:{buffer:this.simParamsBuf}}]}),this.writeSimParams();const s=Math.ceil(n/4),u=Math.ceil(i/4),f=this.device.createCommandEncoder(),m=f.beginComputePass();m.setPipeline(this.initPL),m.setBindGroup(0,this.initBG),m.dispatchWorkgroups(s,u,s),m.end(),this.device.queue.submit([f.finish()])}this.renderParamsBuf?.destroy(),this.renderParamsBuf=this.device.createBuffer({size:160,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.renderBG=this.device.createBindGroup({layout:this.renderPL.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.smokeBuf}},{binding:1,resource:{buffer:this.renderParamsBuf}},{binding:2,resource:{buffer:this.golBuf}},{binding:3,resource:{buffer:this.gol2dBuf}}]}),this.gol2dBG=this.device.createBindGroup({layout:this.gol2dPL.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.gol2dBuf}},{binding:1,resource:{buffer:this.smokeBuf}},{binding:2,resource:{buffer:this.simParamsBuf}},{binding:3,resource:{buffer:this.renderParamsBuf}},{binding:4,resource:{buffer:this.golBuf}}]}),this.writeRenderParams()}destroyResources(){this.renderParamsBuf?.destroy(),this.renderParamsBuf=null}frame(){const n=Math.round(this.tuning.detail);n!==this.gridN&&(this.gridN=n,this.marchSteps=n,this.destroySimBuffers(),this.buildResources()),this.updateSwirls(.016),this.swirlCount>0&&this.device.queue.writeBuffer(this.swirlBuf,0,this.swirlCPU,0,this.swirlCount*8);const i=this.gridN,e=i*2,t=Math.ceil(i/4),l=Math.ceil(e/4),o=4,d=this.device.createCommandEncoder();for(let a=0;a<o;a++){this.simTime+=.016/o,this.writeSimParams();const s=d.beginComputePass();s.setPipeline(this.lbmPL),s.setBindGroup(0,this.lbmBG),s.dispatchWorkgroups(t,l,t),s.end();const u=d.beginComputePass();u.setPipeline(this.tempPL),u.setBindGroup(0,this.tempBG),u.dispatchWorkgroups(t,l,t),u.end();const f=d.beginComputePass();f.setPipeline(this.smokePL),f.setBindGroup(0,this.smokeBG),f.dispatchWorkgroups(t,l,t),f.end()}for(this.writeRenderParams(),this.golTickAccum+=this.tuning.golTickRate;this.golTickAccum>=1;){this.golTickAccum-=1;const a=Math.ceil(this.golN/8),s=d.beginComputePass();s.setPipeline(this.golPL),s.setBindGroup(0,this.golBG),s.dispatchWorkgroups(a,a),s.end()}for(this.gol2dTickAccum+=this.tuning.gol2dTickRate;this.gol2dTickAccum>=1;){this.gol2dTickAccum-=1;const a=Math.ceil(this.gol2dCols/8),s=Math.ceil(this.gol2dN/8),u=d.beginComputePass();u.setPipeline(this.gol2dPL),u.setBindGroup(0,this.gol2dBG),u.dispatchWorkgroups(a,s),u.end()}z(d,this.ctx.getCurrentTexture().createView(),this.renderPL,this.renderBG),this.device.queue.submit([d.finish()])}writeSimParams(){const n=new ArrayBuffer(64),i=new Uint32Array(n),e=new Float32Array(n);i[0]=this.gridN,i[1]=this.gridN*2,e[2]=.51,e[3]=this.tuning.buoyancy,e[4]=this.tuning.heatRate,e[5]=.95,e[6]=this.tuning.sourceRadius,e[7]=.095,e[8]=this.simTime,i[9]=this.swirlCount,i[10]=this.golN,e[11]=this.tuning.golThreshold,e[12]=this.tuning.golTransition,e[13]=this.tuning.golThreshold2D,i[14]=this.gol2dN,i[15]=this.gol2dCols,this.device.queue.writeBuffer(this.simParamsBuf,0,n)}writeRenderParams(){const{canvas:n,gridN:i,colors:e,marchSteps:t,theta:l,phi:o,radius:d}=this,a=this.tuning.densityScale,s=n.width/n.height,u=2,f=i*2,m=[.5,u*.5,.5],p=[m[0]+d*Math.cos(o)*Math.sin(l),m[1]+d*Math.sin(o),m[2]+d*Math.cos(o)*Math.cos(l)],g=M(p,m,[0,1,0]),h=U(Math.PI/3,s,.01,10),x=T(R(g),j(h)),c=new Float32Array(40);c.set(x,0),c[16]=p[0],c[17]=p[1],c[18]=p[2],c[19]=i,c[20]=e.alive[0],c[21]=e.alive[1],c[22]=e.alive[2],c[23]=e.alive[3],c[24]=e.dead[0],c[25]=e.dead[1],c[26]=e.dead[2],c[27]=e.dead[3],c[28]=n.width,c[29]=n.height,c[30]=a,c[31]=t,c[32]=this.golN,c[33]=this.tuning.golPixelScaleMax,c[34]=u,c[35]=f,c[36]=this.tuning.golThreshold,c[37]=this.tuning.golThreshold2D,c[38]=this.gol2dN,c[39]=this.gol2dCols,this.device.queue.writeBuffer(this.renderParamsBuf,0,c)}updateSwirls(n){const i=this.gridN,e=this.tuning;let t=0;for(let a=0;a<this.swirlCount;a++){const s=a*8;if(this.swirlCPU[s+5]-=n,this.swirlCPU[s+5]>0){if(this.swirlCPU[s+1]+=e.buoyancy*i*.3*n,this.swirlCPU[s+0]+=(Math.random()-.5)*.2,this.swirlCPU[s+2]+=(Math.random()-.5)*.2,t!==a)for(let u=0;u<8;u++)this.swirlCPU[t*8+u]=this.swirlCPU[a*8+u];t++}}this.swirlCount=t;const l=e.turbulence*10,o=e.turbulence*.04;let d=Math.floor(l)+(Math.random()<l%1?1:0);for(let a=0;a<d&&this.swirlCount<64;a++){const s=Math.random()*2*Math.PI,u=e.sourceRadius*i,f=this.swirlCount*8;this.swirlCPU[f+0]=i*.5+Math.cos(s)*u,this.swirlCPU[f+1]=1,this.swirlCPU[f+2]=i*.5+Math.sin(s)*u,this.swirlCPU[f+3]=(Math.random()<.5?-1:1)*o,this.swirlCPU[f+4]=i*.12,this.swirlCPU[f+5]=.8+Math.random()*.4,this.swirlCPU[f+6]=0,this.swirlCPU[f+7]=0,this.swirlCount++}}destroySimBuffers(){this.distBuf?.destroy(),this.distBuf=null,this.macroBuf?.destroy(),this.macroBuf=null,this.tempBuf?.destroy(),this.tempBuf=null,this.smokeBuf?.destroy(),this.smokeBuf=null,this.simParamsBuf?.destroy(),this.simParamsBuf=null,this.swirlBuf?.destroy(),this.swirlBuf=null,this.golBuf?.destroy(),this.golBuf=null,this.gol2dBuf?.destroy(),this.gol2dBuf=null,this.swirlCount=0,this.simTime=0}get gol2dCols(){if(this.canvas.height===0)return this.gol2dN;const n=this.canvas.height/this.gol2dN;return Math.min(Math.ceil(this.canvas.width/n),this.gol2dMaxCols)}updateColors(n){this.colors=n}onStart(){}onStop(){}}export{E as FlameSimulation};
