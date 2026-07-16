// Minimale ZIP-schrijver (STORE, geen compressie). Verhuisd uit
// BoekhoudingPage (ERP-plan 3.5) — puur en dus testbaar. Gebruikt voor de
// alles-in-één rapportexport (CSV's + factuurbijlagen in één download).

const _crcTbl = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) c = _crcTbl[(c ^ data[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function _cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let off = 0; for (const p of parts) { out.set(p, off); off += p.length }
  return out
}
function _u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b }
function _u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b }

export function makeZip(files: {name: string, data: Uint8Array}[]): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length
    const loc = _cat(
      new Uint8Array([0x50,0x4B,0x03,0x04]),
      _u16(20), _u16(0), _u16(0), _u16(0), _u16(0),
      _u32(crc), _u32(sz), _u32(sz), _u16(nm.length), _u16(0),
      nm, f.data
    )
    locals.push(loc)
    centrals.push(_cat(
      new Uint8Array([0x50,0x4B,0x01,0x02]),
      _u16(20), _u16(20), _u16(0), _u16(0), _u16(0), _u16(0),
      _u32(crc), _u32(sz), _u32(sz), _u16(nm.length), _u16(0), _u16(0),
      _u16(0), _u16(0), _u32(0), _u32(offset),
      nm
    ))
    offset += loc.length
  }
  const cd = _cat(...centrals)
  return _cat(...locals, cd, _cat(
    new Uint8Array([0x50,0x4B,0x05,0x06]),
    _u16(0), _u16(0), _u16(files.length), _u16(files.length),
    _u32(cd.length), _u32(offset), _u16(0)
  ))
}
