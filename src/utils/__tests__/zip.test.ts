import { describe, it, expect } from 'vitest'
import { makeZip, crc32 } from '../zip'

const enc = new TextEncoder()
const leesU32 = (b: Uint8Array, i: number) => new DataView(b.buffer, b.byteOffset + i, 4).getUint32(0, true)
const leesU16 = (b: Uint8Array, i: number) => new DataView(b.buffer, b.byteOffset + i, 2).getUint16(0, true)

describe('crc32', () => {
  it('komt overeen met de bekende referentiewaarden', () => {
    // Standaard CRC-32 (IEEE): "123456789" → 0xCBF43926
    expect(crc32(enc.encode('123456789'))).toBe(0xCBF43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('makeZip', () => {
  it('bouwt een geldig ZIP-archief (signatures, EOCD, CRC per entry)', () => {
    const inhoud = enc.encode('hallo brouwerij')
    const zip = makeZip([
      {name: 'csv/rapport.csv', data: inhoud},
      {name: 'leeg.txt', data: new Uint8Array(0)},
    ])
    // Local file header signature PK\x03\x04
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4B, 0x03, 0x04])
    // CRC + groottes in de eerste local header (offsets 14/18/22)
    expect(leesU32(zip, 14)).toBe(crc32(inhoud))
    expect(leesU32(zip, 18)).toBe(inhoud.length)
    // EOCD-signature PK\x05\x06 op 22 bytes voor het einde, met 2 entries
    const eocd = zip.length - 22
    expect([...zip.slice(eocd, eocd + 4)]).toEqual([0x50, 0x4B, 0x05, 0x06])
    expect(leesU16(zip, eocd + 10)).toBe(2)
    // Bestandsinhoud staat ongecomprimeerd (STORE) direct na de header + naam
    const naamLen = leesU16(zip, 26)
    const dataStart = 30 + naamLen
    expect(new TextDecoder().decode(zip.slice(dataStart, dataStart + inhoud.length))).toBe('hallo brouwerij')
  })

  it('een leeg archief heeft alleen een EOCD-record', () => {
    const zip = makeZip([])
    expect(zip.length).toBe(22)
    expect(leesU16(zip, 10)).toBe(0)
  })
})
