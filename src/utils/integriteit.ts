// Referentiële-integriteitscheck (ERP-plan 1.3).
//
// De datastore kent geen foreign keys: verwijzingen (accijns → batch,
// pick → afvulling, …) kunnen wees worden wanneer een doelrecord verdwijnt.
// Deze functie rapporteert álle verwijzingen die nergens meer naartoe wijzen.
// Puur en UI-vrij zodat hij unit-testbaar is; vertaling van labels doet de
// aanroeper (Instellingen → App → Gezondheid).

export interface IntegriteitProbleem {
  entiteit: string   // data-key van het record met de kapotte verwijzing
  id: any            // id van dat record
  veld: string       // veld dat verwijst
  doel: string       // data-key waar het veld naartoe hoort te wijzen
  doel_id: any       // de niet-bestaande doel-id
}

const idSet = (arr?: any[]): Set<string> =>
  new Set((arr || []).map((x: any) => String(x?.id)))

export function checkIntegriteit(d: Record<string, any[] | undefined>): IntegriteitProbleem[] {
  const problemen: IntegriteitProbleem[] = []
  const sets: Record<string, Set<string>> = {
    ingredienten:     idSet(d.ingredienten),
    lots:             idSet(d.lots),
    batches:          idSet(d.batches),
    afvullingen:      idSet(d.afvullingen),
    uitleveringen:    idSet(d.uitleveringen),
    accijns:          idSet(d.accijns),
    bestellingen:     idSet(d.bestellingen),
    verkoop_facturen: idSet(d.verkoop_facturen),
    klanten:          idSet(d.klanten),
  }

  // Eén veld → één doel. Lege/afwezige verwijzingen (null/undefined/'') zijn
  // geldig ("niet gekoppeld") en worden overgeslagen.
  const check = (entiteit: string, veld: string, doel: string) => {
    for (const r of d[entiteit] || []) {
      const v = r?.[veld]
      if (v === null || v === undefined || v === '') continue
      if (!sets[doel].has(String(v))) {
        problemen.push({entiteit, id: r?.id, veld, doel, doel_id: v})
      }
    }
  }

  // Veld met een array van doel-id's (bijv. pick.uitlevering_ids).
  const checkLijst = (entiteit: string, veld: string, doel: string) => {
    for (const r of d[entiteit] || []) {
      const lijst = Array.isArray(r?.[veld]) ? r[veld] : []
      for (const v of lijst) {
        if (v === null || v === undefined) continue
        if (!sets[doel].has(String(v))) {
          problemen.push({entiteit, id: r?.id, veld, doel, doel_id: v})
        }
      }
    }
  }

  check('lots', 'ingredient_id', 'ingredienten')
  check('batch_ingredienten', 'batch_id', 'batches')
  check('batch_ingredienten', 'lot_id', 'lots')
  check('afvullingen', 'batch_id', 'batches')
  check('uitleveringen', 'batch_id', 'batches')
  check('uitleveringen', 'afvulling_id', 'afvullingen')
  check('accijns', 'batch_id', 'batches')
  check('accijns', 'uitlevering_id', 'uitleveringen')
  check('bestelling_picks', 'bestelling_id', 'bestellingen')
  check('bestelling_picks', 'afvulling_id', 'afvullingen')
  check('bestelling_picks', 'uitlevering_id', 'uitleveringen')
  check('bestelling_picks', 'accijns_id', 'accijns')
  checkLijst('bestelling_picks', 'uitlevering_ids', 'uitleveringen')
  checkLijst('bestelling_picks', 'accijns_ids', 'accijns')
  check('afboekingen', 'afvulling_id', 'afvullingen')
  check('afboekingen', 'batch_id', 'batches')
  check('verkoop_facturen', 'bestelling_id', 'bestellingen')
  check('verkoop_facturen', 'klant_id', 'klanten')
  check('verkoop_facturen', 'credit_van_factuur_id', 'verkoop_facturen')
  check('bestellingen', 'factuur_id', 'verkoop_facturen')

  return problemen
}
