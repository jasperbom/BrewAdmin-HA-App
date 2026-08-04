import { describe, it, expect } from 'vitest'
import { registreerOntsmetting, taakReinigingStatus, taakSchoonmaakTaakId } from '../ontsmetting'
import { DEFAULT_BATCH_TAKEN_ITEMS } from '../constants'

const basis = () => ({
  status: 'Ontsmet' as const,
  tankId: 'FV1' as string | null,
  batchId: 7,
  batchNaam: 'Blond #7',
  taakId: 111,
  taakLabel: 'Fermentor voorbereid, gesteriliseerd en gelabeld met batch-nr.',
  datum: '2026-08-04',
  door: 'jasper',
  statussen: {FV1: {status: 'Vuil' as const, sinds: '2026-07-30'}},
  tankLog: [] as any[],
  schoonmaakTaken: [] as any[],
  schoonmaakLog: [] as any[],
})

// ── Welke batchtaak legt een reiniging vast ────────────────────────────────
describe('taakReinigingStatus', () => {
  it('leest het expliciete veld op het item', () => {
    expect(taakReinigingStatus({id: 1, tank_reiniging: 'Ontsmet'})).toBe('Ontsmet')
    expect(taakReinigingStatus({id: 1, tank_reiniging: 'Schoon'})).toBe('Schoon')
  })

  it('respecteert een bewust uitgezette registratie', () => {
    // Een gebruiker die de automatische registratie uitzet op het fermentor-item
    // mag niet alsnog via de legacy-koppeling geregistreerd worden.
    expect(taakReinigingStatus({id: 111, labelKey: 'brouwdag_check_11_fermentor', tank_reiniging: ''})).toBe('')
  })

  it('valt terug op de legacy-koppeling voor opgeslagen items zonder veld', () => {
    expect(taakReinigingStatus({id: 111, labelKey: 'brouwdag_check_11_fermentor'})).toBe('Ontsmet')
    expect(taakReinigingStatus({id: 111})).toBe('Ontsmet')
    expect(taakReinigingStatus({id: 103, labelKey: 'brouwdag_check_3_jodiumtest'})).toBe('')
    expect(taakReinigingStatus(null)).toBe('')
  })

  it('staat aan op het fermentor-item in de standaardtaken', () => {
    const fermentor = DEFAULT_BATCH_TAKEN_ITEMS.find((i: any) => i.labelKey === 'brouwdag_check_11_fermentor')
    expect(taakReinigingStatus(fermentor)).toBe('Ontsmet')
  })

  it('leest een gekoppelde schoonmaaktaak', () => {
    expect(taakSchoonmaakTaakId({schoonmaak_taak_id: 3})).toBe(3)
    expect(taakSchoonmaakTaakId({schoonmaak_taak_id: 0})).toBe(null)
    expect(taakSchoonmaakTaakId({})).toBe(null)
  })
})

// ── Registratie ───────────────────────────────────────────────────────────
describe('registreerOntsmetting', () => {
  it('zet de tankstatus en schrijft de logregel', () => {
    const r = registreerOntsmetting(basis())
    expect(r.tankGeregistreerd).toBe(true)
    expect(r.reden).toBe('')
    expect(r.statussen.FV1).toEqual({status: 'Ontsmet', sinds: '2026-08-04', laatste_log_id: 1})
    expect(r.tankLog).toHaveLength(1)
    expect(r.tankLog[0]).toMatchObject({
      tank_id: 'FV1', datum: '2026-08-04', uitgevoerd_door: 'jasper',
      nieuwe_status: 'Ontsmet', oorzaak: 'batch_checklist', batch_id: 7, taak_id: 111,
    })
  })

  it('laat de bestaande log ongemoeid en telt door op het hoogste id', () => {
    const inp = basis()
    inp.tankLog = [{id: 4, tank_id: 'FV2', datum: '2026-07-30', uitgevoerd_door: 'systeem', nieuwe_status: 'Vuil'}]
    const r = registreerOntsmetting(inp)
    expect(r.tankLog).toHaveLength(2)
    expect(r.tankLog[1].id).toBe(5)
    expect(r.statussen.FV1?.laatste_log_id).toBe(5)
  })

  it('is idempotent: hetzelfde vinkje registreert niet dubbel', () => {
    const eerste = registreerOntsmetting(basis())
    const tweede = registreerOntsmetting({...basis(), tankLog: eerste.tankLog, statussen: eerste.statussen})
    expect(tweede.tankGeregistreerd).toBe(false)
    expect(tweede.reden).toBe('al_geregistreerd')
    expect(tweede.tankLog).toHaveLength(1)
  })

  it('registreert opnieuw voor een andere batch in dezelfde tank', () => {
    const eerste = registreerOntsmetting(basis())
    const tweede = registreerOntsmetting({...basis(), batchId: 8, tankLog: eerste.tankLog, statussen: eerste.statussen})
    expect(tweede.tankGeregistreerd).toBe(true)
    expect(tweede.tankLog).toHaveLength(2)
  })

  it('doet niets zonder status', () => {
    const r = registreerOntsmetting({...basis(), status: ''})
    expect(r.reden).toBe('geen_status')
    expect(r.tankLog).toHaveLength(0)
    expect(r.statussen.FV1?.status).toBe('Vuil')
  })

  it('doet niets zonder uitvoerder — een naamloze regel is geen bewijs', () => {
    const r = registreerOntsmetting({...basis(), door: '  '})
    expect(r.reden).toBe('geen_uitvoerder')
    expect(r.tankLog).toHaveLength(0)
  })

  it('meldt geen doel als de batch niet in een tank ligt en niets gekoppeld is', () => {
    const r = registreerOntsmetting({...basis(), tankId: null})
    expect(r.reden).toBe('geen_doel')
    expect(r.tankGeregistreerd).toBe(false)
    expect(r.schoonmaakLog).toHaveLength(0)
  })

  it('muteert de meegegeven arrays en map niet', () => {
    const inp = basis()
    registreerOntsmetting(inp)
    expect(inp.tankLog).toHaveLength(0)
    expect(inp.statussen.FV1.status).toBe('Vuil')
  })
})

// ── HACCP-schoonmaaklog ───────────────────────────────────────────────────
describe('registreerOntsmetting — schoonmaaktaken', () => {
  it('logt een uitvoering op elke actieve schoonmaaktaak van die tank', () => {
    const inp = basis()
    inp.schoonmaakTaken = [
      {id: 1, naam: 'Gistvat CIP', tank_id: 'FV1', frequentie: 'per_batch', middel: 'Chloorvrij alkalisch'},
      {id: 2, naam: 'Gistvat desinfectie', tank_id: 'FV1', frequentie: 'per_batch'},
      {id: 3, naam: 'Andere tank', tank_id: 'FV2', frequentie: 'per_batch'},
      {id: 4, naam: 'Oude taak', tank_id: 'FV1', actief: false},
    ]
    const r = registreerOntsmetting(inp)
    expect(r.schoonmaakTaakNamen).toEqual(['Gistvat CIP', 'Gistvat desinfectie'])
    expect(r.schoonmaakLog).toHaveLength(2)
    expect(r.schoonmaakLog[0]).toMatchObject({
      taak_id: 1, datum: '2026-08-04', uitgevoerd_door: 'jasper',
      middel: 'Chloorvrij alkalisch', batch_id: 7, batch_taak_id: 111, bron: 'batch_checklist',
    })
    expect(r.schoonmaakLog[0].opmerking).toContain('Blond #7')
  })

  it('logt ook een expliciet aan de batchtaak gekoppelde taak zonder tank', () => {
    const inp = basis()
    inp.tankId = null
    inp.schoonmaakTaken = [{id: 9, naam: 'Afvullijn reinigen', frequentie: 'per_batch'}]
    const r = registreerOntsmetting({...inp, schoonmaakTaakId: 9, taakId: 201})
    expect(r.tankGeregistreerd).toBe(false)
    expect(r.schoonmaakTaakNamen).toEqual(['Afvullijn reinigen'])
    expect(r.reden).toBe('')
  })

  it('logt dezelfde taak niet twee keer voor hetzelfde vinkje', () => {
    const inp = basis()
    inp.schoonmaakTaken = [{id: 1, naam: 'Gistvat CIP', tank_id: 'FV1'}]
    const eerste = registreerOntsmetting(inp)
    const tweede = registreerOntsmetting({
      ...inp, tankLog: eerste.tankLog, statussen: eerste.statussen, schoonmaakLog: eerste.schoonmaakLog,
    })
    expect(tweede.schoonmaakTaakNamen).toEqual([])
    expect(tweede.schoonmaakLog).toHaveLength(1)
    expect(tweede.reden).toBe('al_geregistreerd')
  })
})
