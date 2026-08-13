import * as XLSX from 'xlsx';

/**
 * AUDIT TRAILS SHEET — the workbook's data-quality page.
 *
 * Every warning produced by the validation toolbox (and the upload-time
 * file checks) is stored here IN FULL, one row per finding. The on-screen
 * UI only announces that findings exist and directs the analyst to this
 * sheet — the workbook is the single place where the complete detail
 * lives, reviewable and shareable like every other page of the report.
 *
 * (Formerly named 'Disclaimer' — that name now belongs to the static
 * invoice-class explanations sheet, `DisclaimerSheet`.)
 *
 * The sheet is always present so its absence is never ambiguous: with a
 * clean parse it carries an explicit "no findings" row.
 */
export class DataQualitySheet {
  public static readonly SHEET_NAME = 'Audit Trails';

  public create(warnings: string[]): XLSX.WorkSheet {
    const rows: unknown[][] = [
      ['DATA QUALITY AUDIT TRAILS'],
      [
        'Review every finding below against Amazon invoice rules and policies before relying on this report.',
      ],
      [],
      ['No', 'Finding'],
    ];

    if (warnings.length === 0) {
      rows.push([1, 'No data-quality findings — the file parsed clean.']);
    } else {
      warnings.forEach((warning, i) => rows.push([i + 1, warning]));
    }

    const sheet = XLSX.utils.aoa_to_sheet(rows);

    // Readable layout: narrow index column, wide text column.
    sheet['!cols'] = [{ wch: 5 }, { wch: 150 }];

    return sheet;
  }
}
