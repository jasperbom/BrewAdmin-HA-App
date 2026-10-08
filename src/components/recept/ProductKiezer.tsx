import React from 'react'
import { t } from '../../i18n'
import BierKleur from '../ui/BierKleur'
import Btn from '../ui/Btn'
import LegeStaat from '../ui/LegeStaat'
import KiezerBlad, { KiezerKop, KiezerRegel, KiezerNiets } from './KiezerBlad'
import { ReceptChip } from './ReceptRij'
import { productEbc } from '../../utils/bierKleur'
import { productenVoorKoppelen } from '../../utils/receptLijst'

// "Koppel aan product": de receptkiezer omgekeerd — kies het product (bier)
// waar een recept bij hoort. Niet-gearchiveerde producten op naam, die uit
// roulatie (seizoensbier) apart. Een product waar het recept al bij hoort is
// gemarkeerd en niet te kiezen.

export interface ProductKiezerProps {
  /** Titel van het blad; standaard "Koppel aan product". */
  titel?: string
  /** Waar het over gaat ("Bomstraat Blond"), klein boven de lijst. */
  onderwerp?: string
  producten: any[] | null | undefined
  /** Voor de kleurstip (EBC uit het recept als het product er geen heeft). */
  recepten?: any[] | null
  onKies: (productId: number) => void
  onSluit: () => void
  /** Producten waar het recept al bij hoort. */
  gekoppeld?: ReadonlyArray<number> | null
  /** Naar de productenpagina als er nog geen producten zijn. */
  onNaarProducten?: () => void
  inline?: boolean
}

const ProductKiezer: React.FC<ProductKiezerProps> = ({
  titel, onderwerp, producten, recepten, onKies, onSluit, gekoppeld, onNaarProducten, inline = false,
}) => {
  const [zoek, setZoek] = React.useState('')
  const lijst = React.useMemo(() => productenVoorKoppelen(producten, zoek), [producten, zoek])
  const al = new Set((gekoppeld || []).map(Number))
  const regel = (p: any) => {
    const isAl = al.has(Number(p.id))
    return (
      <KiezerRegel key={p.id} onKies={() => { if (!isAl) onKies(Number(p.id)) }} disabled={isAl}
        links={<BierKleur ebc={productEbc(p, recepten || [])} s="md" />}
        titel={<span className="inline-flex items-center gap-1.5 max-w-full">
          <span className="truncate">{p.naam || t('lbl_naamloos')}</span>
          {isAl && <ReceptChip soort="grijs">{t('recept_chip_gekoppeld')}</ReceptChip>}
        </span>}
        sub={p.stijl || undefined} />
    )
  }
  const geen = !lijst.inRoulatie.length && !lijst.uitRoulatie.length
  const geenProducten = geen && zoek.trim() === ''
  return (
    <KiezerBlad titel={titel || t('recept_koppel_titel')} onSluit={onSluit} zoek={zoek} onZoek={setZoek}
      zoekPlaceholder={t('recept_koppel_zoek')} inline={inline} laag
      intro={onderwerp ? t('recept_koppel_onderwerp').replace('{recept}', onderwerp) : undefined}>
      {geenProducten ? (
        <LegeStaat cls="my-2" icoon="beer" titel={t('recept_koppel_geen_producten')}>
          {onNaarProducten && <Btn v="secondary" s="sm" onClick={onNaarProducten}>{t('recept_naar_producten')}</Btn>}
        </LegeStaat>
      ) : geen ? (
        <KiezerNiets zoek={zoek} onWis={() => setZoek('')} />
      ) : (
        <div>
          {lijst.inRoulatie.map(regel)}
          {lijst.uitRoulatie.length > 0 && <KiezerKop sub>{t('recept_kiezer_seizoen')}</KiezerKop>}
          {lijst.uitRoulatie.map(regel)}
        </div>
      )}
    </KiezerBlad>
  )
}

export default ProductKiezer
