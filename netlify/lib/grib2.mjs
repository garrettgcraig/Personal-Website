// Minimal GRIB2 reader for one message on a regular lat/lon grid (template 3.0): data
// representation templates 5.0 (simple packing), 5.2 (complex packing) and 5.3 (complex packing
// with spatial differencing), no bitmap. That covers NOAA GEFS pgrb2a 0.5-degree rain fields.
// Returns the grid geometry and a value lookup with bilinear interpolation.

class Bits {
  constructor(buf, pos) { this.buf = buf; this.bit = pos * 8; }
  read(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const b = this.bit >> 3;
      v = v * 2 + ((this.buf[b] >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return v;
  }
  align() { this.bit = Math.ceil(this.bit / 8) * 8; }
}

const u = (b, p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; };
// GRIB2 signed integers: sign bit then magnitude
const s = (b, p, n) => { const v = u(b, p, n); const top = 2 ** (8 * n - 1); return v >= top ? -(v - top) : v; };

export function decodeGrib2(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== "GRIB" || b[7] !== 2) throw new Error("not a GRIB2 message");
  let p = 16;
  let grid, rep, dataPos, dataLen, bitmap = 255;
  while (p < b.length - 4) {
    if (String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) === "7777") break;
    const len = u(b, p, 4), sec = b[p + 4];
    if (sec === 3) {
      const tpl = u(b, p + 12, 2);
      if (tpl !== 0) throw new Error(`grid template ${tpl} not supported`);
      grid = {
        ni: u(b, p + 30, 4), nj: u(b, p + 34, 4),
        la1: s(b, p + 46, 4) / 1e6, lo1: s(b, p + 50, 4) / 1e6,
        la2: s(b, p + 55, 4) / 1e6, lo2: s(b, p + 59, 4) / 1e6,
        di: u(b, p + 63, 4) / 1e6, dj: u(b, p + 67, 4) / 1e6, scan: b[p + 71],
      };
    } else if (sec === 5) {
      const tpl = u(b, p + 9, 2);
      rep = { n: u(b, p + 5, 4), tpl, R: new DataView(b.buffer, b.byteOffset + p + 11, 4).getFloat32(0), E: s(b, p + 15, 2), D: s(b, p + 17, 2), nbits: b[p + 19] };
      if (tpl === 2 || tpl === 3) Object.assign(rep, {
        splitting: b[p + 21], missing: b[p + 22], NG: u(b, p + 31, 4), gwRef: b[p + 35], gwBits: b[p + 36],
        glRef: u(b, p + 37, 4), glInc: b[p + 41], glLast: u(b, p + 42, 4), glBits: b[p + 46],
        order: tpl === 3 ? b[p + 47] : 0, extra: tpl === 3 ? b[p + 48] : 0,
      });
      else if (tpl !== 0) throw new Error(`data template ${tpl} not supported`);
    } else if (sec === 6) bitmap = b[p + 5];
    else if (sec === 7) { dataPos = p + 5; dataLen = len - 5; }
    p += len;
  }
  if (!grid || !rep || dataPos == null) throw new Error("incomplete GRIB2 message");
  if (bitmap !== 255) throw new Error("bitmaps not supported");
  const scale = 2 ** rep.E, dec = 10 ** -rep.D;
  const out = new Float64Array(rep.n);
  if (rep.tpl === 0) {
    const br = new Bits(b, dataPos);
    for (let i = 0; i < rep.n; i++) out[i] = (rep.R + (rep.nbits ? br.read(rep.nbits) : 0) * scale) * dec;
  } else {
    if (rep.missing !== 0) throw new Error("missing-value management not supported");
    let q = dataPos;
    const ex = [];
    let minsd = 0;
    if (rep.tpl === 3 && rep.order > 0) {
      for (let k = 0; k < rep.order; k++) { ex.push(s(b, q, rep.extra)); q += rep.extra; }
      minsd = s(b, q, rep.extra); q += rep.extra;
    }
    const br = new Bits(b, q);
    const NG = rep.NG;
    const refs = new Array(NG), widths = new Array(NG), lens = new Array(NG);
    for (let g = 0; g < NG; g++) refs[g] = br.read(rep.nbits);
    br.align();
    for (let g = 0; g < NG; g++) widths[g] = rep.gwRef + br.read(rep.gwBits);
    br.align();
    for (let g = 0; g < NG; g++) lens[g] = rep.glRef + rep.glInc * br.read(rep.glBits);
    lens[NG - 1] = rep.glLast;
    br.align();
    const x = new Float64Array(rep.n);
    let i = 0;
    for (let g = 0; g < NG; g++) {
      const w = widths[g];
      for (let k = 0; k < lens[g] && i < rep.n; k++) x[i++] = refs[g] + (w ? br.read(w) : 0);
    }
    if (rep.tpl === 3 && rep.order === 1) {
      x[0] = ex[0];
      for (let j = 1; j < rep.n; j++) x[j] = x[j] + minsd + x[j - 1];
    } else if (rep.tpl === 3 && rep.order === 2) {
      x[0] = ex[0]; x[1] = ex[1];
      for (let j = 2; j < rep.n; j++) x[j] = x[j] + minsd + 2 * x[j - 1] - x[j - 2];
    }
    for (let j = 0; j < rep.n; j++) out[j] = (rep.R + x[j] * scale) * dec;
  }
  void dataLen;
  return { grid, values: out };
}

// Bilinear value at (lat, lon) on a regular grid scanned west-to-east, north-to-south (scan 0)
// or south-to-north (scan 64). lon in degrees east 0-360 or -180..180.
export function valueAt({ grid, values }, lat, lon) {
  const lo = ((lon % 360) + 360) % 360;
  const south = (grid.scan & 64) !== 0;
  const yi = south ? (lat - grid.la1) / grid.dj : (grid.la1 - lat) / grid.dj;
  const xi = (lo - grid.lo1) / grid.di;
  const y0 = Math.floor(yi), x0 = Math.floor(xi), fy = yi - y0, fx = xi - x0;
  const at = (y, x) => values[y * grid.ni + ((x % grid.ni) + grid.ni) % grid.ni];
  return at(y0, x0) * (1 - fy) * (1 - fx) + at(y0 + 1, x0) * fy * (1 - fx) + at(y0, x0 + 1) * (1 - fy) * fx + at(y0 + 1, x0 + 1) * fy * fx;
}
