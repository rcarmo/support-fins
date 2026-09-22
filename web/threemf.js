/**
 * 3MF writer (core spec, 2015/02 namespace).
 *
 * Why 3MF alongside the STL: it carries the two things a raw STL cannot, both
 * of which matter to this tool specifically --
 *   1. UNITS. STL is unitless, so a slicer has to guess millimeters; a mis-guess
 *      is the classic "my part imported at 1/25 scale" bug. 3MF states mm.
 *   2. SEPARATE OBJECTS. The part and the fins go in as two distinct meshes
 *      assembled by <components> into one build item. They stay locked in the
 *      right relative position (the fins only work where they were placed), and
 *      a slicer shows the fins as their own selectable/colorable body -- so the
 *      breakaway support reads as support, not as part of the model.
 *
 * We do NOT embed slicer-specific print profiles (Bambu/Orca bind "supports off"
 * to a full printer-specific project config, which breaks across printers and
 * slicers). Bambu and Prusa factory profiles default to no supports, and the
 * fins are ordinary model geometry -- so the exported file prints as intended
 * without reaching into any slicer's settings.
 *
 * Geometry in, same as the STL path: flat arrays of [x,y,z], three vertices per
 * triangle, already in print space (oriented, seated on the plate).
 */

import { zipStore, unzip } from './zip.js';

const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const REL_3DMODEL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const CT_MODEL = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
const CT_RELS = 'application/vnd.openxmlformats-package.relationships+xml';

// Trim a coordinate to a compact decimal string. 6 decimals is well under the
// ~1um that matters for a print and keeps the model file small.
function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(6);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * Build an indexed <mesh> from a flat triangle-soup array. Vertices that share
 * exact coordinates are merged (they do, because every vertex is produced by the
 * identical transform of the same source point), which restores shared topology
 * and shrinks the file; anything that doesn't merge is left as-is and slices fine.
 */
function meshXML(tris) {
  const index = new Map();
  const verts = [];
  const faces = [];
  for (let t = 0; t < tris.length; t += 3) {
    const idx = [];
    for (let i = 0; i < 3; i++) {
      const p = tris[t + i];
      const key = `${p[0]},${p[1]},${p[2]}`;
      let vi = index.get(key);
      if (vi === undefined) {
        vi = verts.length;
        index.set(key, vi);
        verts.push(p);
      }
      idx.push(vi);
    }
    // Drop any triangle that collapsed to a line/point after the merge; a
    // degenerate face is invalid 3MF and some readers reject the whole model.
    if (idx[0] !== idx[1] && idx[1] !== idx[2] && idx[0] !== idx[2]) faces.push(idx);
  }

  const v = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    v[i] = `<vertex x="${fmt(p[0])}" y="${fmt(p[1])}" z="${fmt(p[2])}"/>`;
  }
  const f = new Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    const t = faces[i];
    f[i] = `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`;
  }
  return `<mesh><vertices>${v.join('')}</vertices><triangles>${f.join('')}</triangles></mesh>`;
}

function modelXML(partTris, finTris, title) {
  const objects = [`<object id="1" type="model">${meshXML(partTris)}</object>`];
  let buildId = 1;

  if (finTris && finTris.length) {
    objects.push(`<object id="2" type="model">${meshXML(finTris)}</object>`);
    // An assembly object so the part and fins import as one locked unit while
    // remaining two distinct meshes.
    objects.push(
      '<object id="3" type="model"><components>' +
      '<component objectid="1"/><component objectid="2"/></components></object>');
    buildId = 3;
  }

  const safeTitle = String(title).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}">` +
    '<metadata name="Application">Support Fins</metadata>' +
    `<metadata name="Title">${safeTitle}</metadata>` +
    `<resources>${objects.join('')}</resources>` +
    `<build><item objectid="${buildId}"/></build></model>`;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  `<Default Extension="rels" ContentType="${CT_RELS}"/>` +
  `<Default Extension="model" ContentType="${CT_MODEL}"/></Types>`;

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Id="rel0" Target="/3D/3dmodel.model" Type="${REL_3DMODEL}"/></Relationships>`;

/**
 * @param partTris  the model geometry, print space
 * @param finTris   the fins + pad, print space (may be empty)
 * @param name      written as the model Title
 * @returns Blob    a .3mf package
 */
export function writeThreeMF(partTris, finTris, name = 'Support Fins') {
  return zipStore([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: '3D/3dmodel.model', data: modelXML(partTris, finTris, name) },
  ]);
}

// ---------------------------------------------------------------- 3MF reader

/**
 * Reading a 3MF back in. A user who models in Fusion, Bambu Studio or FreeCAD
 * has a .3mf in hand, not an STL, and telling them to go re-export is the wrong
 * answer -- especially since a 3MF is the better input: it states its units, so
 * the 1/25-scale guess never happens on the way in either.
 *
 * Parsed with a small tag scanner rather than DOMParser, for two reasons: the
 * test suite runs outside a browser (no DOM), and a scanner cannot be talked
 * into resolving an external entity from a file a stranger sent us.
 *
 * Three things here are easy to get wrong and are what separate "works on our
 * own export" from "works on a real file":
 *   1. UNITS. The unit attribute is authoritative and is not always millimetre
 *      (inch and centimetre both turn up). Everything downstream is mm.
 *   2. TRANSFORMS. Geometry lives in object space; a <build><item> and every
 *      <component> may carry a matrix, and they compose. Ignoring them is the
 *      "part imports offset from the plate / mirrored" bug.
 *   3. MULTIPLE ITEMS. A plate can hold several objects. This tool works on one
 *      part, so every build item is merged into a single soup -- same shape of
 *      input the STL path produces.
 */

// 3MF unit vocabulary -> millimetres.
const UNIT_MM = {
  micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000,
};

/**
 * Walk XML, calling onOpen(name, attrs, selfClosing) and onClose(name).
 * Attribute parsing honours quotes, so a value containing '>' (legal, and Bambu
 * writes object names verbatim) does not cut the tag short.
 */
function scanXML(xml, onOpen, onClose) {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    // Declarations, comments, CDATA: skip wholesale, none carry geometry.
    if (xml.startsWith('<!--', lt)) { i = xml.indexOf('-->', lt); i = i < 0 ? n : i + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { i = xml.indexOf(']]>', lt); i = i < 0 ? n : i + 3; continue; }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      i = xml.indexOf('>', lt); i = i < 0 ? n : i + 1; continue;
    }
    if (xml[lt + 1] === '/') {
      const gt = xml.indexOf('>', lt);
      if (gt < 0) break;
      onClose(xml.slice(lt + 2, gt).trim());
      i = gt + 1;
      continue;
    }

    // Element name, then attributes up to an unquoted '>' or '/>'.
    let p = lt + 1;
    while (p < n && !/[\s/>]/.test(xml[p])) p++;
    const name = xml.slice(lt + 1, p);
    const attrs = {};
    let selfClosing = false;
    while (p < n) {
      while (p < n && /\s/.test(xml[p])) p++;
      if (xml[p] === '/' && xml[p + 1] === '>') { selfClosing = true; p += 2; break; }
      if (xml[p] === '>') { p++; break; }
      const nameStart = p;
      while (p < n && !/[\s=/>]/.test(xml[p])) p++;
      const attr = xml.slice(nameStart, p);
      while (p < n && /\s/.test(xml[p])) p++;
      if (xml[p] !== '=') { if (attr) attrs[attr] = ''; continue; }
      p++;
      while (p < n && /\s/.test(xml[p])) p++;
      const q = xml[p];
      let value;
      if (q === '"' || q === "'") {
        const end = xml.indexOf(q, p + 1);
        value = xml.slice(p + 1, end < 0 ? n : end);
        p = end < 0 ? n : end + 1;
      } else {
        const start = p;
        while (p < n && !/[\s/>]/.test(xml[p])) p++;
        value = xml.slice(start, p);
      }
      attrs[attr] = value;
    }
    onOpen(name, attrs, selfClosing);
    i = p;
  }
}

// Strip any namespace prefix: a writer may emit <m:object>, and the core
// elements are unambiguous by local name.
const local = (tag) => {
  const c = tag.indexOf(':');
  return c < 0 ? tag : tag.slice(c + 1);
};

/**
 * A 3MF matrix is 12 numbers, row-major, translation last, applied to a ROW
 * vector: p' = p * M3 + t. Kept as that same flat 12 for composition.
 */
function parseMatrix(s) {
  if (!s) return null;
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) return null;
  return v;
}

/** b applied after a, as one matrix (row-vector convention). */
function compose(a, b) {
  if (!a) return b;
  if (!b) return a;
  const m = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  for (let c = 0; c < 3; c++) {
    m[9 + c] = a[9] * b[c] + a[10] * b[3 + c] + a[11] * b[6 + c] + b[9 + c];
  }
  return m;
}

/**
 * Object types that are not printable solid geometry. `support` and `surface`
 * are not closed bodies and `other` is explicitly non-printable, so pulling
 * them in as part geometry would poison the overhang analysis. `model` and
 * `solidsupport` are kept; a missing type means `model` per the spec.
 */
const SKIP_TYPES = new Set(['support', 'surface', 'other']);
const CAD_PAYLOAD_RE = /(^|[/\\])[^/\\]+\.(step|stp|stpz|iges|igs|brep|sat)$/i;

function cadPayloads(parts) {
  const names = [];
  for (const name of parts.keys()) if (CAD_PAYLOAD_RE.test(name)) names.push(name);
  return names;
}

/** Parse 3D/3dmodel.model into { objects, items, unit }. */
function parseModelXML(xml) {
  const objects = new Map();   // id -> { type, verts, tris, components }
  const items = [];            // { objectid, transform }
  let unit = 'millimeter';
  let cur = null;              // object being filled
  let inVertices = false;

  scanXML(xml, (tag, a, selfClosing) => {
    switch (local(tag)) {
      case 'model':
        if (a.unit) unit = a.unit;
        break;
      case 'object':
        cur = { type: a.type || 'model', verts: [], tris: [], components: [] };
        objects.set(String(a.id), cur);
        if (selfClosing) cur = null;
        break;
      case 'vertices':
        inVertices = true;
        break;
      case 'vertex':
        // Guard on inVertices: the beam-lattice extension has its own <v> refs,
        // and only <vertices> children are mesh points.
        if (cur && inVertices) cur.verts.push(+a.x || 0, +a.y || 0, +a.z || 0);
        break;
      case 'triangle':
        if (cur) cur.tris.push(+a.v1, +a.v2, +a.v3);
        break;
      case 'component':
        if (cur) cur.components.push({ objectid: String(a.objectid), transform: parseMatrix(a.transform) });
        break;
      case 'item':
        items.push({ objectid: String(a.objectid), transform: parseMatrix(a.transform) });
        break;
      default:
        break;
    }
  }, (tag) => {
    const t = local(tag);
    if (t === 'object') cur = null;
    else if (t === 'vertices') inVertices = false;
  });

  return { objects, items, unit };
}

/**
 * Flatten one object (mesh or assembly) into `out` as a triangle soup, applying
 * `m`. `seen` breaks a component cycle -- a malformed file can reference itself,
 * and the spec forbids it, so bailing is correct rather than recursing forever.
 */
function emitObject(objects, id, m, out, seen, stats) {
  const obj = objects.get(id);
  if (!obj || seen.has(id)) return;
  if (SKIP_TYPES.has(obj.type)) { stats.skipped++; return; }
  seen.add(id);

  const { verts, tris } = obj;
  for (let t = 0; t < tris.length; t += 3) {
    // A triangle indexing a vertex that does not exist is a broken file. Check
    // all three FIRST and drop the whole face -- pushing NaN would silently
    // blank the render, and pushing a partial face would shift every vertex
    // after it by one, shearing the rest of the mesh.
    const o0 = tris[t] * 3, o1 = tris[t + 1] * 3, o2 = tris[t + 2] * 3;
    if (!(o0 >= 0 && o1 >= 0 && o2 >= 0)
        || o0 + 3 > verts.length || o1 + 3 > verts.length || o2 + 3 > verts.length) {
      stats.dropped++;
      continue;
    }
    for (const o of [o0, o1, o2]) {
      const x = verts[o], y = verts[o + 1], z = verts[o + 2];
      if (m) {
        out.push(x * m[0] + y * m[3] + z * m[6] + m[9],
                 x * m[1] + y * m[4] + z * m[7] + m[10],
                 x * m[2] + y * m[5] + z * m[8] + m[11]);
      } else {
        out.push(x, y, z);
      }
    }
  }
  if (tris.length) stats.meshes++;

  for (const c of obj.components) emitObject(objects, c.objectid, compose(c.transform, m), out, seen, stats);
  seen.delete(id);
}

/**
 * Read a .3mf package into a triangle soup in millimetres.
 *
 * @param bytes  Uint8Array of the whole .3mf file
 * @returns { positions: Float32Array, unit, meshes, items, skipped, dropped }
 *          positions is flat [x,y,z] x 3 per triangle -- the same layout
 *          STLLoader produces, so the caller builds a BufferGeometry from it.
 */
export async function readThreeMF(bytes) {
  const parts = await unzip(bytes);
  const cad = cadPayloads(parts);

  // The root relationship names the model part, but every writer in practice
  // uses the conventional path; fall back to any *.model in the package before
  // giving up, which covers the odd writer that renames it.
  let modelPart = parts.get('3D/3dmodel.model');
  if (!modelPart) {
    const rels = parts.get('_rels/.rels');
    if (rels) {
      let target = null;
      scanXML(new TextDecoder().decode(rels), (tag, a) => {
        if (local(tag) === 'Relationship' && a.Type === REL_3DMODEL && a.Target) target = a.Target;
      }, () => {});
      if (target) modelPart = parts.get(target.replace(/^\//, ''));
    }
  }
  if (!modelPart) {
    for (const [name, data] of parts) if (name.toLowerCase().endsWith('.model')) { modelPart = data; break; }
  }
  if (!modelPart) {
    if (cad.length) throw new Error('this 3MF contains CAD/STEP payloads but no printable mesh geometry; export or tessellate it to STL or mesh 3MF first');
    throw new Error('no 3D model part found in this 3MF');
  }

  const xml = new TextDecoder().decode(modelPart);
  const { objects, items, unit } = parseModelXML(xml);

  const scale = UNIT_MM[unit] ?? 1;
  const stats = { meshes: 0, skipped: 0, dropped: 0 };
  const out = [];

  // No <build> items is technically a valid-but-empty plate. Real files written
  // by a few CAD exporters omit it, and refusing to open a file that plainly
  // contains meshes would be obtuse -- so fall back to every mesh object.
  const roots = items.length
    ? items
    : [...objects.entries()].filter(([, o]) => o.tris.length).map(([id]) => ({ objectid: id, transform: null }));

  for (const item of roots) emitObject(objects, item.objectid, item.transform, out, new Set(), stats);

  if (!out.length) {
    if (cad.length) throw new Error('this 3MF contains CAD/STEP payloads but no printable mesh geometry; export or tessellate it to STL or mesh 3MF first');
    throw new Error('this 3MF contains no printable mesh geometry');
  }

  const positions = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) positions[i] = out[i] * scale;

  return {
    positions, unit,
    meshes: stats.meshes,
    items: roots.length,
    skipped: stats.skipped,
    dropped: stats.dropped,
    cadPayloads: cad,
  };
}
