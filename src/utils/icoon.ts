// App-icoon-generatie: iOS accepteert als home-screen-icoon alleen een echt,
// vierkant (bij voorkeur 180×180) PNG-bestand — geen SVG, geen data-URL-link,
// en transparantie wordt zwart. Deze helper rastert het geüploade logo
// (welk formaat dan ook dat de browser kan decoderen: PNG/JPEG/SVG/HEIC/…)
// via een canvas naar een gecentreerde PNG op een egale achtergrond.
// Geeft null terug wanneer het bronbeeld niet te laden/rasteren is.
export const maakAppIcoon = (
  bron: string,
  grootte = 180,
  achtergrond = '#ffffff',
): Promise<string | null> =>
  new Promise(resolve => {
    try {
      const img = new Image()
      img.onload = () => {
        try {
          if (!img.width || !img.height) { resolve(null); return }
          const canvas = document.createElement('canvas')
          canvas.width = grootte
          canvas.height = grootte
          const ctx = canvas.getContext('2d')
          if (!ctx) { resolve(null); return }
          ctx.fillStyle = achtergrond
          ctx.fillRect(0, 0, grootte, grootte)
          // Gecentreerd en passend, met wat ademruimte rondom
          const marge = grootte * 0.08
          const schaal = Math.min(
            (grootte - 2 * marge) / img.width,
            (grootte - 2 * marge) / img.height,
          )
          const b = img.width * schaal
          const h = img.height * schaal
          ctx.drawImage(img, (grootte - b) / 2, (grootte - h) / 2, b, h)
          resolve(canvas.toDataURL('image/png'))
        } catch {
          resolve(null)
        }
      }
      img.onerror = () => resolve(null)
      img.src = bron
    } catch {
      resolve(null)
    }
  })
