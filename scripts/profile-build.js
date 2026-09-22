#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { buildTopology, analyze } from '../web/overhangs.js';
import { buildFins } from '../web/fins.js';

function usage() {
  console.error('usage: bun scripts/profile-build.js <model.stl> [tiltDeg=0] [mode=auto]');
  process.exit(2);
}

function readSTL(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 !== bytes.byteLength) throw new Error('not a binary STL');
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) {
    const o = 84 + f * 50 + 12;
    for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(o + i * 4, true);
  }
  return pos;
}

function rotX(deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

const [path, tiltArg = '0', mode = 'auto'] = Bun.argv.slice(2);
if (!path) usage();
const tilt = Number(tiltArg);
if (!Number.isFinite(tilt)) usage();

const pos = readSTL(readFileSync(path));
const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
const rot = rotX(tilt);
const t0 = performance.now();
const result = analyze(topo, 45, rot);
const t1 = performance.now();
const profile = {};
const built = buildFins(topo, result, rot, {
  mode,
  bedPad: true,
  tines: true,
  tineDensity: 0,
  coverage: 0.5,
  layerHeight: 0.2,
  profile,
});
const t2 = performance.now();

const supportTris = built.triangles?.length ?? 0;
const padTris = built.padTriangles?.length ?? 0;
const phaseMs = Object.fromEntries(Object.entries(profile)
  .sort((a, b) => b[1].ms - a[1].ms)
  .map(([name, row]) => [name, { calls: row.calls, ms: Number(row.ms.toFixed(3)) }]));
console.log(JSON.stringify({
  model: path,
  tilt,
  mode,
  faces: topo.nFaces,
  overhangRegions: result.regions.length,
  bedArea: Number(result.bedArea.toFixed(3)),
  analyzeMs: Number((t1 - t0).toFixed(3)),
  buildMs: Number((t2 - t1).toFixed(3)),
  supports: built.fins?.length ?? 0,
  braceCount: built.braceCount ?? 0,
  propCount: built.propCount ?? 0,
  tines: built.tines ?? 0,
  unserved: built.unserved ?? 0,
  skipped: built.skipped ?? {},
  supportTriangles: supportTris,
  padTriangles: padTris,
  phaseMs,
}, null, 2));
