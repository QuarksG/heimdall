import * as XLSX from 'xlsx';
import { DISCLAIMER_INTRO, DISCLAIMER_SECTIONS } from './disclaimerContent';
import type { StyledCell, CellStyleSpec } from '../../utils/auditStylePatcher';

/**
 * DISCLAIMER SHEET — the reconciliation explanations page.
 *
 * Layout (approved screenshot):
 *   row 1 — bilingual title
 *   row 2 — page purpose line
 *   row 3 — 'TÜRKÇE' | 'ENGLISH' language header
 *   row 4 — the payment-control message (one tall wrapped cell per language)
 *   then one numbered section per invoice class: header row (Turkish side
 *   BLACK fill, English side PURPLE fill, white bold text), the related
 *   'Fatura Türü' classes, and the bilingual paragraphs.
 *
 * Column A carries the Turkish source text, column B the English
 * translation, separated by a THICK vertical border down the whole
 * content region. All text cells wrap top-aligned; row heights are
 * estimated from the wrapped line count so nothing clips. Gridlines are
 * turned off and the visual styling applied post-serialization by the
 * exporter (SheetJS CE cannot write fills/borders/wrap), driven by the
 * `styleCells` this builder records — the renderer stays render-only.
 */
export class DisclaimerSheet {
  public static readonly SHEET_NAME = 'Disclaimer';

  /** Column width (chars) of each language column. */
  private static readonly COL_WIDTH = 110;
  /** Estimated characters per wrapped line at COL_WIDTH. */
  private static readonly CHARS_PER_LINE = 100;
  /** Row height (points) per wrapped text line. */
  private static readonly LINE_HPT = 15;

  public create(): { sheet: XLSX.WorkSheet; styleCells: StyledCell[] } {
    const rows: unknown[][] = [];
    const styleCells: StyledCell[] = [];

    // The thick TR|EN separator: every content cell of column A carries a
    // thick right edge, so the vertical line runs the whole region.
    const sep = (col: number): CellStyleSpec['border'] =>
      col === 0 ? { right: 'thick' } : undefined;

    const pushRow = (
      tr: string,
      en: string,
      specFor: (col: number) => CellStyleSpec,
    ): number => {
      const rowIdx = rows.length;
      rows.push([tr, en]);
      styleCells.push(
        { row: rowIdx, col: 0, spec: specFor(0) },
        { row: rowIdx, col: 1, spec: specFor(1) },
      );
      return rowIdx;
    };

    const text = (col: number): CellStyleSpec => ({
      font: 'default',
      fill: 'none',
      wrap: true,
      border: sep(col),
    });
    const bold = (col: number): CellStyleSpec => ({
      font: 'bold',
      fill: 'none',
      wrap: true,
      border: sep(col),
    });
    // Section headers: Turkish side black, English side purple — white bold.
    const sectionHeader = (col: number): CellStyleSpec => ({
      font: 'whiteBold',
      fill: col === 0 ? 'black' : 'purple',
      wrap: true,
      border: sep(col),
    });
    const spacer = (): number => pushRow('', '', text);

    // --- Top block ---
    pushRow('MUTABAKAT AÇIKLAMALARI VE FERAGATNAME', 'DISCLAIMER OF RECONCILIATION', bold);
    pushRow(
      'Bu sayfa, ödeme detaylarınızda görebileceğiniz her fatura sınıfı için özel açıklamaları ve itiraz yollarını içerir.',
      'This page carries the dedicated explanation and dispute route for every invoice class you may see in your payment details.',
      text,
    );
    pushRow('TÜRKÇE', 'ENGLISH', bold);
    pushRow(DISCLAIMER_INTRO.tr, DISCLAIMER_INTRO.en, text);
    spacer();

    // --- Invoice-class sections ---
    for (const section of DISCLAIMER_SECTIONS) {
      pushRow(`${section.no}. ${section.titleTr}`, `${section.no}. ${section.titleEn}`, sectionHeader);
      pushRow(
        `İlgili fatura sınıfları: ${section.relatedClasses.join(' | ')}`,
        `Related invoice classes: ${section.relatedClasses.join(' | ')}`,
        bold,
      );
      spacer();
      for (const paragraph of section.paragraphs) {
        pushRow(paragraph.tr, paragraph.en, text);
      }
      spacer();
      spacer();
    }

    const sheet = XLSX.utils.aoa_to_sheet(rows);

    // Two wide, readable text columns — Turkish left, English right.
    sheet['!cols'] = [
      { wch: DisclaimerSheet.COL_WIDTH },
      { wch: DisclaimerSheet.COL_WIDTH },
    ];

    // Row heights from the wrapped line estimate (Excel does not auto-fit
    // generated files): the taller of the two language cells wins.
    sheet['!rows'] = rows.map(row => ({
      hpt: DisclaimerSheet.LINE_HPT * Math.max(
        this.wrappedLines(String(row[0] ?? '')),
        this.wrappedLines(String(row[1] ?? '')),
      ),
    }));

    return { sheet, styleCells };
  }

  /** Estimated wrapped line count of one cell's text (embedded \n honored). */
  private wrappedLines(value: string): number {
    if (value === '') return 1;
    return value
      .split('\n')
      .reduce(
        (sum, line) =>
          sum + Math.max(1, Math.ceil(line.length / DisclaimerSheet.CHARS_PER_LINE)),
        0,
      );
  }
}
