/**
 * whatsappLogo.ts — het WhatsApp-logo voor de uitnodiging onder een mail
 * (`mailTemplate.ts`, als inline bijlage `cid:whatsapp-logo`).
 *
 * Wit WhatsApp-teken op een groene cirkel (#25D366), 96×96 PNG (getoond op
 * 44 px, scherp op een retinascherm). Het teken komt uit Simple Icons 16.36
 * (`icons/whatsapp.svg`, CC0); het merk is van Meta en mag ongewijzigd gebruikt
 * worden om naar WhatsApp te verwijzen
 * (https://about.meta.com/brand/resources/whatsapp/whatsapp-brand).
 * Een mailprogramma toont geen SVG, daarom een PNG.
 */
export const WHATSAPP_CID = 'whatsapp-logo'

/** De WhatsApp-groen van het merk. */
export const WHATSAPP_GROEN = '#25D366'

export const WHATSAPP_LOGO_PNG =
  'data:image/png;base64,' +
  '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'
