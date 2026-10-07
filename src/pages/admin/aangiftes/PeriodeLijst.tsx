import React from 'react'
import { t } from '../../../i18n'
import ResponsiveLijst from '../../../components/ui/ResponsiveLijst'
import type { LijstKolom } from '../../../components/ui/ResponsiveLijst'
import { stapSleutel, pilVoor, type AangifteRij } from '../../../utils/aangifteStappen'
import { StappenBalk, Pil, SubRegel, BedragCel, periodeTitel } from './onderdelen'

// ── De periodelijst (BTW-perioden én accijnsmaanden) ────────────────────────
// Eén component voor beide segmenten. Bureau: Periode · Stap · Bedrag ·
// Volgende stap; telefoon: een kaart met dezelfde inhoud. Per regel hooguit
// één knop (de volgende stap), anders een statuspil. De knop bouwt de
// pagina: die weet wat "Koppel betaling" of "Markeer ingediend" doet.

interface PeriodeLijstProps {
  rijen: AangifteRij[]
  /** Het detail staat ernaast: op een smaller bureau minder kolommen. */
  naastDetail?: boolean
  gekozen: string | null
  onKies: (rij: AangifteRij) => void
  /** De volgende-stapknop van een regel, of null (dan de pil). `telefoon`: over de volle breedte in de kaart. */
  knop: (rij: AangifteRij, telefoon: boolean) => React.ReactNode
  label: string
  leeg: React.ReactNode
}

/** Is het venster minstens zo breed? Volgt een venster dat van grootte wisselt. */
function useMinBreedte(px: number): boolean {
  const query = `(min-width: ${px}px)`
  const [past, setPast] = React.useState<boolean>(() =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches)
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const wissel = () => setPast(mq.matches)
    wissel()
    mq.addEventListener?.('change', wissel)
    return () => mq.removeEventListener?.('change', wissel)
  }, [query])
  return past
}

const PeriodeLijst: React.FC<PeriodeLijstProps> = ({ rijen, naastDetail = false, gekozen, onKies, knop, label, leeg }) => {
  // Naast het detail is de lijst smal: onder 1280 px schuiven de stappen
  // onder de periode, onder 1024 px valt de knopkolom weg (de volgende stap
  // staat dan in de actiebalk van het detail).
  const ruim = useMinBreedte(1280)
  const breed = useMinBreedte(1024)
  const stappenInPeriode = naastDetail && !ruim
  const zonderKnop = naastDetail && !breed
  const alle: LijstKolom<AangifteRij>[] = [
    {
      id: 'periode', kop: t('agf_kol_periode'),
      cel: r => (
        <span className="block min-w-0">
          <span className="block font-semibold text-gray-900">{periodeTitel(r)}</span>
          <SubRegel rij={r} />
          {stappenInPeriode && <StappenBalk rij={r} cls="mt-1" />}
        </span>
      ),
    },
    { id: 'stap', kop: t('agf_kol_stap'), cel: r => <StappenBalk rij={r} /> },
    { id: 'bedrag', kop: t('agf_kol_bedrag'), rechts: true, klasse: 'whitespace-nowrap', cel: r => <BedragCel rij={r} /> },
    {
      id: 'volgende', kop: t('agf_kol_volgende'), rechts: true, klasse: 'whitespace-nowrap w-1',
      cel: r => knop(r, false) || <Pil rij={r} />,
    },
  ]
  const kolommen = alle.filter(k => !(k.id === 'stap' && stappenInPeriode) && !(k.id === 'volgende' && zonderKnop))

  const kaart = (r: AangifteRij) => {
    const k = knop(r, true)
    return (
      <div className="min-w-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 break-words">{periodeTitel(r)}</div>
            <SubRegel rij={r} cls="mt-0.5" />
          </div>
          <BedragCel rij={r} />
        </div>
        <div className="mt-2 flex items-center gap-2 min-w-0">
          <StappenBalk rij={r} cls="flex-1" />
          {/* De pil alleen als hij iets toevoegt aan het stap-label (Actie, Afgerond). */}
          {t(pilVoor(r).sleutel) !== t(stapSleutel(r)) && <Pil rij={r} />}
        </div>
        {k && <div className="mt-2.5">{k}</div>}
      </div>
    )
  }

  return (
    <ResponsiveLijst<AangifteRij>
      rijen={rijen}
      sleutel={r => r.sleutel}
      kolommen={kolommen}
      kaart={kaart}
      onKies={onKies}
      gekozenSleutel={gekozen}
      rijLabel={r => `${periodeTitel(r)}, ${t(stapSleutel(r))}`}
      label={label}
      leeg={leeg}
    />
  )
}

export default PeriodeLijst
