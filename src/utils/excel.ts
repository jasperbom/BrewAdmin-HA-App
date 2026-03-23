import * as XLSX from 'xlsx'

export const excelExport = (
  ing: any, lots: any, bat: any, bi: any, av: any, uit: any, acc: any,
  verp: any, ond: any, log: any, archief: any, geslotenBieren: any,
  recepten: any, tanks: any, artikelen: any, hygieneItems: any,
  hygieneGroups: any, inkoopFacturen: any, verkoopFacturen: any
) => {
  const wb = XLSX.utils.book_new()
  const toRow = (o: any) => {
    const r: any = {}
    for (const [k, v] of Object.entries(o)) r[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v
    return r
  }
  const prep = (d: any) => (d || []).length ? d.map(toRow) : [{}];
  [
    ['Ingredienten', ing], ['Lots', lots], ['Batches', bat], ['BatchIngredienten', bi],
    ['Afvullingen', av], ['Uitslagen', uit], ['Accijns', acc], ['Verpakkingen', verp || []],
    ['Onderdelen', ond || []], ['VoorraadLog', log || []], ['VoorraadArchief', archief || []],
    ['GeslotenBieren', geslotenBieren || []], ['Recepten', recepten || []], ['Tanks', tanks || []],
    ['Artikelen', artikelen || []], ['HygieneItems', hygieneItems || []],
    ['HygieneGroups', hygieneGroups || []], ['InkoopFacturen', inkoopFacturen || []],
    ['VerkoopFacturen', verkoopFacturen || []]
  ].forEach(([n, d]: any) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prep(d)), n))
  XLSX.writeFile(wb, 'craftery_data.xlsx')
}

export const excelImport = (file: File, cb: (data: any) => void) => {
  const r = new FileReader()
  r.onload = e => {
    const wb = XLSX.read((e.target as any).result, {type:'array'})
    const gs = (n: string) => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n]) : []
    const fromRow = (o: any) => {
      const r: any = {}
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
          try { r[k] = JSON.parse(v) } catch { r[k] = v }
        } else { r[k] = v }
      }
      return r
    }
    const parse = (n: string) => gs(n).map(fromRow)
    cb({
      ingredienten: gs('Ingredienten'), lots: gs('Lots'), batches: gs('Batches'),
      batchIngredienten: gs('BatchIngredienten'), afvullingen: gs('Afvullingen'),
      uitslagen: gs('Uitslagen'), accijns: gs('Accijns'), verpakkingen: gs('Verpakkingen'),
      onderdelen: parse('Onderdelen'), voorraadLog: parse('VoorraadLog'),
      voorraadArchief: parse('VoorraadArchief'), geslotenBieren: gs('GeslotenBieren'),
      recepten: parse('Recepten'), tanks: gs('Tanks'), artikelen: parse('Artikelen'),
      hygieneItems: parse('HygieneItems'), hygieneGroups: parse('HygieneGroups'),
      inkoopFacturen: parse('InkoopFacturen'), verkoopFacturen: parse('VerkoopFacturen')
    })
  }
  r.readAsArrayBuffer(file)
}
