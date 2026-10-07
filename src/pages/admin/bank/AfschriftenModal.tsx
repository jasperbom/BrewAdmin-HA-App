import React from 'react'
import { t } from '../../../i18n'
import { fmtD } from '../../../utils/format'
import { vulIn } from '../../../utils/periode'
import Modal from '../../../components/ui/Modal'
import RowActions from '../../../components/ui/RowActions'
import LegeStaat from '../../../components/ui/LegeStaat'
import ResponsiveLijst, { type LijstKolom } from '../../../components/ui/ResponsiveLijst'
import { controleVanAfschrift } from './Aansluiting'
import { ibanWeergave } from './bankTekst'
import { fmt } from '../adminContext'

// ── De bewaarde afschriften ─────────────────────────────────────────────────
// Per afschrift de periode, het aantal transacties en of de saldocontrole
// klopt. "Toon" zet de lijst op de transacties van dat afschrift (en de
// aansluitregel erop); verwijderen zit onder ⋯ en heeft vijf seconden
// terugweg (UndoBar) — de koppelingen blijven staan, dus opnieuw inlezen
// zet ze terug. Het venster sluit bij verwijderen: de UndoBar ligt onder de
// laag van een Modal en moet in beeld zijn.

export interface AfschriftenModalProps {
  /** Nieuwste eerst, zonder een afschrift waarvan de verwijdering loopt. */
  afschriften: any[]
  transacties: any[]
  meerdereRekeningen: boolean
  gekozenId: number | null
  onToon: (a: any) => void
  onVerwijder: (a: any) => void
  onImporteer: () => void
  onSluit: () => void
}

const AfschriftenModal: React.FC<AfschriftenModalProps> = ({
  afschriften, transacties, meerdereRekeningen, gekozenId, onToon, onVerwijder, onImporteer, onSluit,
}) => {
  const controle = (a: any) => {
    const r = controleVanAfschrift(a, afschriften, transacties)
    if (r.ok) {
      const eerste = r.c.vorigEindsaldo == null && r.vorig.bron !== 'overlap'
      return <span className="text-green-700">✓ {t('bank_aansl_ok')}{eerste ? ` · ${t('bank_afs_eerste')}` : ''}</span>
    }
    const wat = !r.internOk ? t('lbl_verschil_kort').replace('{bedrag}', fmt(r.c.verschilIntern))
      : !r.aansluitOk ? t('lbl_verschil_kort').replace('{bedrag}', fmt(r.c.aansluitVerschil ?? 0))
      : vulIn(t('bank_aansl_overgeslagen'), { n: r.overgeslagen })
    return <span className="text-orange-700">⚠ {t('bank_afs_probleem')} · {wat}</span>
  }
  const periode = (a: any) => vulIn(t('bank_afs_periode'), { van: fmtD(a.van) || '—', tot: fmtD(a.tot) || '—' })
  const acties = (a: any) => {
    const getoond = gekozenId != null && Number(a.id) === Number(gekozenId)
    return (
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={() => { onToon(a); onSluit() }} disabled={getoond}
          className="px-3 min-h-[40px] sm:min-h-[30px] rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-default whitespace-nowrap">
          {getoond ? t('bank_afs_getoond') : t('bank_afs_toon')}
        </button>
        <RowActions acties={[{ id: 'verwijderen', label: t('btn_afschrift_verwijderen'), soort: 'gevaar', onClick: () => { onSluit(); onVerwijder(a) } }]} />
      </div>
    )
  }
  const kolommen: LijstKolom<any>[] = [
    { id: 'periode', kop: t('bank_afs_kol_periode'), klasse: 'whitespace-nowrap', cel: a => <span className="font-medium text-gray-900">{periode(a)}</span> },
    {
      id: 'nr', kop: t('bank_afs_kol_nr'),
      cel: a => (
        <span className="text-gray-700">
          {a.afschriftNr || a.referentie || t('lbl_onbekend')}
          {meerdereRekeningen && <span className="block text-xs text-gray-500 font-mono">{ibanWeergave(a.iban)}</span>}
        </span>
      ),
    },
    { id: 'aantal', kop: t('bank_afs_kol_aantal'), rechts: true, cel: a => Number(a.aantal) || 0 },
    { id: 'controle', kop: t('bank_afs_kol_controle'), cel: a => <span className="text-sm">{controle(a)}</span> },
    { id: 'acties', kop: <span className="sr-only">{t('bank_kol_actie')}</span>, rechts: true, klasse: 'whitespace-nowrap', cel: acties },
  ]
  const kaart = (a: any) => (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-gray-900 text-sm">{periode(a)}</span>
        <span className="text-xs text-gray-500 whitespace-nowrap">{Number(a.aantal) || 0} {t('bank_afs_kol_aantal').toLowerCase()}</span>
      </div>
      <div className="text-xs text-gray-600 break-words">
        {a.afschriftNr || a.referentie || t('lbl_onbekend')}{meerdereRekeningen ? ` · ${ibanWeergave(a.iban)}` : ''}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs min-w-0">{controle(a)}</span>
        {acties(a)}
      </div>
    </div>
  )
  return (
    <Modal title={t('bank_afschriften_titel')} onClose={onSluit} wide>
      {afschriften.length === 0 ? (
        <LegeStaat titel={t('bank_leeg_titel')} icoon="bank">
          <button type="button" onClick={() => { onSluit(); onImporteer() }}
            className="px-4 py-2 tbtn rounded-lg text-sm font-medium min-h-tap sm:min-h-0">{t('bank_btn_importeren')}</button>
        </LegeStaat>
      ) : (
        <ResponsiveLijst rijen={afschriften} sleutel={(a: any) => a.id} kolommen={kolommen} kaart={kaart}
          label={t('bank_afschriften_titel')}
          rijKlasse={(a: any) => gekozenId != null && Number(a.id) === Number(gekozenId) ? 'bg-[color:var(--t-pale)]' : ''} />
      )}
    </Modal>
  )
}

export default AfschriftenModal
