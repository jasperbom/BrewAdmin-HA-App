import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import { nieuwProductUitBatch } from '../../utils/productKeten'
import { ontkoppelProduct } from '../../utils/batchKeten'
import { useUndo } from '../ui/UndoBar'

interface ProductKoppelingBron {
  producten: any[]
  setProducten: (fn: (prev: any[]) => any[]) => void
  recepten: any[]
  bat: any[]
  setBat: (fn: (prev: any[]) => any[]) => void
  auditLog: any[]
  setAuditLog: (fn: (prev: any[]) => any[]) => void
}

/**
 * Het product van een batch uit een recept (utils/batchKeten.ts) — gedeeld
 * door een nieuwe batch plannen (lijst Batches) en "Recept opnieuw toepassen"
 * op de batch. Eén kandidaat: de app koppelt zelf en meldt het met een
 * terugweg in de UndoBar ("Gekoppeld aan Kadeblond · Ongedaan maken"). Meer
 * of geen: de keuze uit het formulier; een nieuw product erft naam, stijl en
 * recept (`nieuwProductUitBatch`) — geen ABV en geen allergenen.
 */
export function useProductKoppeling({ producten, setProducten, recepten, bat, setBat, auditLog, setAuditLog }: ProductKoppelingBron) {
  const undo = useUndo()
  // De laatste stand van de batches: de terugweg loopt pas na een render, en
  // kan lopen terwijl de pagina al weg is (een tik op de productchip).
  const batRef = React.useRef<any[]>(bat)
  batRef.current = bat

  /** De melding bij een productbesluit dat niet kan (lege of dubbele naam). */
  const besluitFoutTekst = (fout: string | null): string | null =>
    fout === 'naam_leeg' ? t('err_product_naam_leeg')
      : fout === 'naam_bestaat' ? t('err_product_naam_duplicaat')
      : null

  /** Het nieuwe product (met id) uit een batch zonder product. */
  const nieuwProductRecord = (batchZonder: any, recept: any, naam: string): any => {
    const velden = nieuwProductUitBatch(batchZonder, recept, { vandaag: tod(), naam, recepten })
    return { id: newId(producten || []), ...velden }
  }

  const voegProductToe = (p: any) => {
    setProducten((prev: any[]) => [...(prev || []), p])
    logAudit(auditLog, setAuditLog, {entiteit: 'Product', entiteit_id: p.id, actie: 'aangemaakt', omschrijving: `Product "${p.naam}" aangemaakt`})
  }

  /** De terugweg van een automatische koppeling: vijf seconden "Ongedaan maken".
   *  Is de batch intussen verwijderd of aan iets anders gekoppeld, dan blijft
   *  hij zoals hij is (ontkoppelProduct → null). */
  const meldAutomatischeKoppeling = (batchId: number, product: any, naamZonder: string, biernaamZonder?: string | null) => {
    const k = { productId: Number(product.id), productNaam: String(product.naam || ''), naamZonder, biernaamZonder }
    undo.plan(`batch-koppel-${batchId}`, t('keten_gekoppeld_undo').replace('{naam}', product.naam || t('lbl_naamloos')),
      () => {},
      () => {
        const nu = (batRef.current || []).find((b: any) => b.id === batchId)
        if (!nu || !ontkoppelProduct(nu, k)) return
        setBat((prev: any[]) => (prev || []).map((b: any) => b.id === batchId ? (ontkoppelProduct(b, k) || b) : b))
        logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: batchId, actie: 'gewijzigd',
          velden: {product_id: {oud: product.id, nieuw: ''}}, omschrijving: `Koppeling aan product "${product.naam || ''}" ongedaan gemaakt`})
      })
  }

  return { besluitFoutTekst, nieuwProductRecord, voegProductToe, meldAutomatischeKoppeling }
}
