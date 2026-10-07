import React from 'react'
import { t } from '../../i18n'
import type { AttentieDoel } from '../../utils/attentie'
import Segment from '../../components/inkoop/Segment'
import AgpPage from '../AgpPage'
import VoorraadverloopPage from '../VoorraadverloopPage'
import InventarisatiePage from '../InventarisatiePage'

// ── Voorraad (Administratie) ────────────────────────────────────────────────
// De fiscale voorraad op één plek, met AGP-stand | Verloop | Tellingen als
// segment: de AGP-pagina (wat er nu ligt, per locatie), het voorraadverloop
// per periode (had geen eigen menuplek) en de inventarisatie. De drie pagina's
// zelf zijn ongewijzigd en krijgen dezelfde props als voorheen vanuit App.

export type VoorraadTab = 'agp' | 'verloop' | 'tellingen'

const TABS: VoorraadTab[] = ['agp', 'verloop', 'tellingen']

export interface VoorraadPageProps {
  /** Eenmalig navigatiedoel: `tab` kiest het segment (`agp`/`verloop`/`tellingen`). */
  navDoel?: AttentieDoel | null
  onNavDoelConsumed?: () => void
  bat: any
  av: any
  uit: any
  acc: any
  setAcc: any
  bi: any
  lots: any
  setLots: any
  ing: any
  log: any
  setLog: any
  producten: any
  locaties: any
  setLocaties: any
  verplaatsingen: any
  setVerplaatsingen: any
  afboekingen: any
  setAfboekingen: any
  accijnsInst: any
  accijnsAangiftes: any
  verliezen: any
  bestellingen: any
  bestellingPicks: any
  inventarisaties: any
  setInventarisaties: any
  auditLog: any
  setAuditLog: any
}

function VoorraadPage({
  navDoel = null, onNavDoelConsumed = () => {},
  bat, av, uit, acc, setAcc, bi, lots, setLots, ing, log, setLog, producten, locaties, setLocaties,
  verplaatsingen, setVerplaatsingen, afboekingen, setAfboekingen, accijnsInst, accijnsAangiftes,
  verliezen, bestellingen, bestellingPicks, inventarisaties, setInventarisaties, auditLog, setAuditLog,
}: VoorraadPageProps) {
  const [tab, setTab] = React.useState<VoorraadTab>(
    TABS.includes(navDoel?.tab as VoorraadTab) ? (navDoel?.tab as VoorraadTab) : 'agp')
  React.useEffect(() => {
    if (navDoel) onNavDoelConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-5">
      <Segment<VoorraadTab>
        label={t('voorraad_segment')}
        waarde={tab}
        onKies={setTab}
        opties={[
          { v: 'agp', l: t('voorraad_seg_agp') },
          { v: 'verloop', l: t('voorraad_seg_verloop') },
          { v: 'tellingen', l: t('voorraad_seg_tellingen') },
        ]}
      />
      {tab === 'agp' && <AgpPage bat={bat} av={av} uit={uit} acc={acc} setAcc={setAcc} producten={producten} locaties={locaties} setLocaties={setLocaties} verplaatsingen={verplaatsingen} setVerplaatsingen={setVerplaatsingen} afboekingen={afboekingen} accijnsInst={accijnsInst} log={log} setLog={setLog} auditLog={auditLog} setAuditLog={setAuditLog} accijnsAangiftes={accijnsAangiftes} verliezen={verliezen} bestellingen={bestellingen} bestellingPicks={bestellingPicks} />}
      {tab === 'verloop' && <VoorraadverloopPage lots={lots} bat={bat} bi={bi} av={av} uit={uit} afboekingen={afboekingen} log={log} ing={ing} accijnsInst={accijnsInst} producten={producten} locaties={locaties} verplaatsingen={verplaatsingen} />}
      {tab === 'tellingen' && <InventarisatiePage lots={lots} ing={ing} av={av} bat={bat} uit={uit} afboekingen={afboekingen} setAfboekingen={setAfboekingen} acc={acc} setAcc={setAcc} accijnsAangiftes={accijnsAangiftes} bestellingPicks={bestellingPicks} bestellingen={bestellingen} inventarisaties={inventarisaties} setInventarisaties={setInventarisaties} setLots={setLots} log={log} setLog={setLog} auditLog={auditLog} setAuditLog={setAuditLog} accijnsInst={accijnsInst} />}
    </div>
  )
}

export default VoorraadPage
