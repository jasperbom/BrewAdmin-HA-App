// Weer te geven bier-/productnaam voor een (verpakte) regel.
//
// Eén batch kan bij het afvullen over meerdere producten worden verdeeld
// (verschillende etiketten → verschillende producten). Het product staat dan
// per afvulling op `afvulling.product_id`; anders valt het terug op het
// product van de batch (`batch.product_id`) en pas daarna op de biernaam/
// receptnaam van de batch. Zo tonen twee afvullingen van dezelfde batch met
// verschillende etiketten hun eigen productnaam in plaats van dezelfde
// receptnaam.

export const productNaam = (afv: any, batch: any, producten: any[]): string => {
  const pid = afv?.product_id ?? batch?.product_id ?? null
  if (pid != null) {
    const p = (producten || []).find((x: any) => x?.id === pid)
    if (p?.naam) return p.naam
  }
  return batch?.biernaam || batch?.naam || ''
}
