import { describe, it, expect } from 'vitest'
import {
  wcTerugschrijfPlan, wcSyncVelden, wcSyncTeHerhalen, wcAlGesynct, wcSyncDoelVoorStatus, WC_DOEL_STATUS,
} from '../wcTerugschrijven'

const t = (k: string) => `[${k}]`
const aan = {enabled: true}
const order = (extra: any = {}) => ({id: 1, wc_order_id: 3236, status: 'gepickt', wc_levering: 'verzenden', ...extra})

describe('wcTerugschrijfPlan', () => {
  it('instelling uit of geen webshoporder → niets', () => {
    expect(wcTerugschrijfPlan(order(), 'verzonden', {enabled: false}, t)).toBeNull()
    expect(wcTerugschrijfPlan({id: 1}, 'verzonden', aan, t)).toBeNull()
    expect(wcTerugschrijfPlan(order({wc_order_id: 0}), 'verzonden', aan, t)).toBeNull()
  })
  it('verzonden → completed + privé-notitie met datum en track & trace', () => {
    const p = wcTerugschrijfPlan(order({verzend_datum: '2026-09-10', verzend_tracking: 'https://postnl.nl/t/3S'}), 'verzonden', aan, t)!
    expect(p.orderId).toBe(3236)
    expect(p.put).toEqual({status: 'completed'})
    expect(p.note!.customer_note).toBe(false)
    expect(p.note!.note).toBe('[wc_note_verzonden]')
  })
  it('verzonden zonder track & trace → andere notitietekst, variabelen ingevuld', () => {
    const tt = (k: string) => k === 'wc_note_verzonden_geen_track' ? 'Verzonden op {datum}.' : k
    const p = wcTerugschrijfPlan(order({verzend_datum: '2026-09-10'}), 'verzonden', aan, tt)!
    expect(p.note!.note).toBe('Verzonden op 10-09-2026.')
  })
  it('afgerond ná een geslaagde verzonden-sync → niets meer te doen', () => {
    const o = order({status: 'afgerond', wc_sync: {status: 'completed', datum: 'x', fout: null}})
    expect(wcTerugschrijfPlan(o, 'afgerond', aan, t)).toBeNull()
  })
  it('afhaalorder die nooit verzonden is → bij afronden completed, zonder notitie', () => {
    const p = wcTerugschrijfPlan(order({wc_levering: 'afhalen', status: 'afgerond'}), 'afgerond', aan, t)!
    expect(p.put).toEqual({status: 'completed'})
    expect(p.note).toBeUndefined()
  })
  it('eerdere mislukte sync → opnieuw proberen', () => {
    const o = order({wc_sync: {status: 'completed', datum: 'x', fout: 'WC 502'}})
    expect(wcTerugschrijfPlan(o, 'verzonden', aan, t)).not.toBeNull()
    expect(wcAlGesynct(o, 'completed')).toBe(false)
  })
  it('geannuleerd zonder uitslag → cancelled (winkel boekt voorraad terug, BrewAdmin laat de reservering los)', () => {
    const p = wcTerugschrijfPlan(order({status: 'geannuleerd'}), 'geannuleerd', {enabled: true, uitgeslagen: false}, t)!
    expect(p.put).toEqual({status: 'cancelled'})
    expect(p.wcStatus).toBe('cancelled')
    expect(p.note).toBeUndefined()
  })
  it('geannuleerd ná uitslag → géén status (voorraad zou dubbel terug), alleen een privé-notitie', () => {
    const p = wcTerugschrijfPlan(order({status: 'geannuleerd'}), 'geannuleerd', {enabled: true, uitgeslagen: true}, t)!
    expect(p.put).toBeUndefined()
    expect(p.wcStatus).toBeNull()
    expect(p.note).toEqual({note: '[wc_note_geannuleerd_na_uitslag]', customer_note: false})
    // Notitie al geplaatst → niet nog een keer.
    const o = order({status: 'geannuleerd', wc_sync: {status: null, datum: 'x', fout: null, note: true}})
    expect(wcTerugschrijfPlan(o, 'geannuleerd', {enabled: true, uitgeslagen: true}, t)).toBeNull()
  })
  it('doelen → statussen', () => {
    expect(WC_DOEL_STATUS).toEqual({verzonden: 'completed', afgerond: 'completed', geannuleerd: 'cancelled'})
    expect(wcSyncDoelVoorStatus('gepickt')).toBeNull()
    expect(wcSyncDoelVoorStatus('afgerond')).toBe('afgerond')
  })
})

describe('wcSyncVelden / wcSyncTeHerhalen', () => {
  it('slaat de uitkomst op', () => {
    const plan = wcTerugschrijfPlan(order({verzend_datum: '2026-09-10'}), 'verzonden', aan, t)!
    expect(wcSyncVelden(plan, {ok: true}, 'nu')).toEqual({wc_sync: {status: 'completed', datum: 'nu', fout: null, note: true}})
    expect(wcSyncVelden(plan, {ok: false, fout: 'WC 502'}, 'nu').wc_sync.fout).toBe('WC 502')
  })
  it('herhalen: alleen bij een status die de winkel hoort te kennen en nog niet heeft', () => {
    expect(wcSyncTeHerhalen(order({status: 'gepickt'}), aan)).toBe(false)
    expect(wcSyncTeHerhalen(order({status: 'verzonden'}), aan)).toBe(true)
    expect(wcSyncTeHerhalen(order({status: 'verzonden', wc_sync: {status: 'completed', datum: 'x', fout: null}}), aan)).toBe(false)
    expect(wcSyncTeHerhalen(order({status: 'verzonden', wc_sync: {status: 'completed', datum: 'x', fout: 'boem'}}), aan)).toBe(true)
    expect(wcSyncTeHerhalen(order({status: 'verzonden'}), {enabled: false})).toBe(false)
  })
})
