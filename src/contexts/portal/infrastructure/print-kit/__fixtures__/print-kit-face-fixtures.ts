import PDFDocument from 'pdfkit'
import { PrintKitFonts } from '../print-kit-pdf-text'

export function newDocument() {
  const doc = new PDFDocument({ autoFirstPage: false, font: '', compress: false })
  doc.on('data', () => undefined)
  doc.addPage({ size: [612, 792], margin: 0 })
  return { doc, fonts: new PrintKitFonts(doc) }
}
