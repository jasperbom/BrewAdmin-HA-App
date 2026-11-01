import React from 'react'
import { t } from '../../i18n'
import { fmtD } from '../../utils/format'
import { bfKoppelKandidaten } from '../../utils/bfKoppeling'
import type { BfKandidaat } from '../../utils/bfKoppeling'
import Blad from '../ui/Blad'
import Btn from '../ui/Btn'
import LegeStaat from '../ui/LegeStaat'
import StatusPil from '../ui/StatusPil'

// "Koppel aan Brewfather" op de batchpagina (utils/bfKoppeling.ts): de
// Brewfather-batches die nog nergens aan hangen, de best passende eerst (zelfde
// recept, zelfde brouwdag). Eén klik koppelt; de gemeten waarden komen mee
// zoals bij de sync — nooit stil over een waarde heen die hier al staat.

interface BfKoppelVensterProps {
  batch: any
  alleBatches: any[]
  /** De Brewfather-batches van de laatste sync; null = nog niet opgehaald. */
  bfBatches: any[] | null
  /** Namen om op te matchen: de titel en het recept van de batch. */
  namen: string[]
  vernieuw: () => Promise<{ ok: boolean, fout?: string }>
  onKoppel: (k: BfKandidaat) => void
  onSluit: () => void
}

const BF_STATUS_LABEL: Record<string, string> = {
  Planning: 'status_planning', Brewing: 'status_brewing', Fermenting: 'status_fermenting',
  Conditioning: 'status_conditioning', Completed: 'status_closed',
}

const BfKoppelVenster: React.FC<BfKoppelVensterProps> = ({ batch, alleBatches, bfBatches, namen, vernieuw, onKoppel, onSluit }) => {
  const [bezig, setBezig] = React.useState(false)
  const [fout, setFout] = React.useState<string | null>(null)
  const haal = React.useCallback(async () => {
    setBezig(true); setFout(null)
    const r = await vernieuw()
    if (!r.ok) setFout(r.fout || t('bf_koppel_niet_alles'))
    setBezig(false)
  }, [vernieuw])
  // Nog niets opgehaald (de sync bij het openen liep niet of mislukte): nu ophalen.
  React.useEffect(() => { if (bfBatches === null) void haal() }, [bfBatches, haal])

  const kandidaten = React.useMemo(
    () => bfKoppelKandidaten(batch, bfBatches || [], alleBatches, { namen }),
    [batch, bfBatches, alleBatches, namen],
  )

  return (
    <Blad titel={t('bf_koppel_titel')} onSluit={onSluit} wide>
      <p className="text-sm text-gray-600">{t('bf_koppel_uitleg')}</p>
      {fout && <p role="alert" className="text-sm text-red-700">{fout}</p>}
      {bezig && bfBatches === null ? (
        <p className="text-sm text-gray-600">{t('bf_koppel_laden')}</p>
      ) : kandidaten.length === 0 ? (
        <LegeStaat icoon="beer" titel={t('bf_koppel_leeg')} tekst={t('bf_koppel_leeg_tekst')}>
          <Btn v="secondary" onClick={haal} disabled={bezig}>{bezig ? t('bf_koppel_laden') : t('bf_koppel_vernieuw')}</Btn>
        </LegeStaat>
      ) : (
        <>
          <ul className="divide-y divide-gray-200 border-y border-gray-200">
            {kandidaten.map(k => (
              <li key={k.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900 break-words">{k.naam || t('lbl_naamloos')}</span>
                    {k.batchNo && <span className="text-sm text-gray-500 cijfer">#{k.batchNo}</span>}
                    <StatusPil kleur={k.status === 'Completed' ? 'grijs' : 'blauw'}>{t(BF_STATUS_LABEL[k.status] || '', k.status)}</StatusPil>
                    {k.voorgesteld && <StatusPil kleur="groen">{t('bf_koppel_voorstel')}</StatusPil>}
                  </div>
                  <p className="text-sm text-gray-600">
                    {k.datum ? t('bf_koppel_brouwdag').replace('{datum}', fmtD(k.datum)) : t('bf_koppel_geen_datum')}
                    {k.redenen.length > 0 && <> · {k.redenen.map(r => t(r)).join(', ')}</>}
                  </p>
                </div>
                <Btn v={k.voorgesteld ? 'primary' : 'secondary'} s="sm" onClick={() => onKoppel(k)}>{t('bf_koppel_knop')}</Btn>
              </li>
            ))}
          </ul>
          <div>
            <Btn v="ghost" s="sm" onClick={haal} disabled={bezig}>{bezig ? t('bf_koppel_laden') : t('bf_koppel_vernieuw')}</Btn>
          </div>
        </>
      )}
    </Blad>
  )
}

export default BfKoppelVenster
