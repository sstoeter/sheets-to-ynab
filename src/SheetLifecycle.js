/**
 * SheetLifecycle.js
 * Handles sheet schema validation, formula lifecycle cache-clearing, and batch status writebacks.
 */

var SheetLifecycle = (function() {
  var COL_DATE = 'Date';
  var COL_PAYEE = 'Payee';
  var COL_MEMO = 'Memo';
  var COL_OUTFLOW = 'Outflow';
  var COL_INFLOW = 'Inflow';
  var COL_STATUS = 'YNAB Status';
  var COL_ID = 'YNAB ID';

  /**
   * Scans row 1 of the sheet to map required column headers to 1-based column indexes.
   * If 'YNAB Status' or 'YNAB ID' columns are missing, appends them automatically.
   */
  function detectHeaders(sheet) {
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var headerRowValues = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var map = {};

    for (var c = 0; c < headerRowValues.length; c++) {
      var val = String(headerRowValues[c]).trim();
      if (val) {
        map[val] = c + 1; // 1-based column index
      }
    }

    // Validate required input headers
    var requiredInputs = [COL_DATE, COL_PAYEE, COL_OUTFLOW, COL_INFLOW];
    for (var i = 0; i < requiredInputs.length; i++) {
      if (!map[requiredInputs[i]]) {
        throw new Error('Required column "' + requiredInputs[i] + '" not found in sheet row 1.');
      }
    }

    // Auto-create managed columns if not present
    var nextCol = sheet.getLastColumn() + 1;
    var needsFormatting = false;

    if (!map[COL_STATUS]) {
      sheet.getRange(1, nextCol).setValue(COL_STATUS);
      map[COL_STATUS] = nextCol;
      nextCol++;
      needsFormatting = true;
    }
    if (!map[COL_ID]) {
      sheet.getRange(1, nextCol).setValue(COL_ID);
      map[COL_ID] = nextCol;
      needsFormatting = true;
    }

    // If headers already existed, check if initial formatting was applied
    if (!needsFormatting) {
      var note = sheet.getRange(1, map[COL_STATUS]).getNote();
      if (!note) {
        needsFormatting = true;
      }
    }

    if (needsFormatting) {
      formatManagedColumns(sheet, map);
    }

    return map;
  }

  /**
   * Formats a date value (Date object or string) into strict ISO 8601 YYYY-MM-DD
   * using the spreadsheet's configured timezone to prevent date shifts.
   */
  function formatIsoDate(dateVal, timeZone) {
    if (!dateVal) return '';
    var tz = timeZone || 'UTC';
    if (Object.prototype.toString.call(dateVal) === '[object Date]') {
      if (isNaN(dateVal.getTime())) return '';
      return Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd');
    }
    var str = String(dateVal).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return str;
    }
    // Attempt parse if date object representation was passed as string
    var parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return Utilities.formatDate(parsed, tz, 'yyyy-MM-dd');
    }
    return '';
  }

  /**
   * Safely parses a number or numeric string (including currency symbols, commas, or spaces)
   * into a float value.
   */
  function parseAmount(val) {
    if (typeof val === 'number') {
      return isNaN(val) ? 0 : val;
    }
    if (!val) return 0;
    var str = String(val).trim();
    str = str.replace(/[^0-9.,\-+]/g, '');
    if (!str) return 0;

    // Handle European (1.250,50) vs US (1,250.50) number formats
    if (str.indexOf(',') !== -1 && str.indexOf('.') !== -1) {
      if (str.indexOf('.') < str.indexOf(',')) {
        str = str.replace(/\./g, '').replace(',', '.');
      } else {
        str = str.replace(/,/g, '');
      }
    } else if (str.indexOf(',') !== -1) {
      str = str.replace(',', '.');
    }

    var num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Clears the YNAB Status and YNAB ID columns for all data rows (row 2 down to last row).
   * Ensures that dynamic changes in formula-driven data don't misalign with cached statuses.
   */
  function clearStatusColumns(sheet, headerMap) {
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;

    var numRows = lastRow - 1;
    sheet.getRange(2, headerMap[COL_STATUS], numRows, 1).clearContent();
    sheet.getRange(2, headerMap[COL_ID], numRows, 1).clearContent();
  }

  /**
   * Reads all transactions from row 2 down to the last row of the sheet.
   * Parses ISO dates, numeric amounts, and calculates YNAB milliunits.
   */
  function readTransactions(sheet, headerMap) {
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];

    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var transactions = [];
    var sheetTz = sheet.getParent().getSpreadsheetTimeZone() || 'UTC';

    for (var i = 0; i < values.length; i++) {
      var rowNum = i + 2; // 1-based sheet row number
      var row = values[i];

      var rawDate = row[headerMap[COL_DATE] - 1];
      var rawPayee = row[headerMap[COL_PAYEE] - 1];
      var rawMemo = headerMap[COL_MEMO] ? row[headerMap[COL_MEMO] - 1] : '';
      var rawOutflow = row[headerMap[COL_OUTFLOW] - 1];
      var rawInflow = row[headerMap[COL_INFLOW] - 1];
      var currentStatus = row[headerMap[COL_STATUS] - 1];
      var currentId = row[headerMap[COL_ID] - 1];

      var isoDate = formatIsoDate(rawDate, sheetTz);
      var payee = String(rawPayee || '').trim();
      var memo = String(rawMemo || '').trim();

      // Skip blank rows
      if (!isoDate && !payee && !rawOutflow && !rawInflow) {
        continue;
      }

      if (!isoDate) {
        throw new Error('Row ' + rowNum + ' has an invalid Date format. ISO 8601 (YYYY-MM-DD) is required.');
      }

      var outflowNum = parseAmount(rawOutflow);
      var inflowNum = parseAmount(rawInflow);

      // Milliunit calculation: Outflow is negative, Inflow is positive
      var milliunits = Math.round((inflowNum - outflowNum) * 1000);

      transactions.push({
        rowNum: rowNum,
        date: isoDate,
        payee: payee,
        memo: memo,
        outflow: outflowNum,
        inflow: inflowNum,
        milliunits: milliunits,
        status: String(currentStatus || '').trim(),
        ynabId: String(currentId || '').trim()
      });
    }

    return transactions;
  }

  /**
   * Batch updates YNAB Status and YNAB ID for specific rows in the sheet.
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {Array<Object>} updates Array of { rowNum, status, ynabId }
   * @param {Object} headerMap
   */
  function updateRowStatuses(sheet, updates, headerMap) {
    if (!updates || updates.length === 0) return;

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;

    var statusCol = headerMap[COL_STATUS];
    var idCol = headerMap[COL_ID];

    // For efficient batch write, get current column arrays and update in-memory
    var numRows = lastRow - 1;
    var statusRange = sheet.getRange(2, statusCol, numRows, 1);
    var idRange = sheet.getRange(2, idCol, numRows, 1);

    var statusValues = statusRange.getValues();
    var idValues = idRange.getValues();

    for (var i = 0; i < updates.length; i++) {
      var item = updates[i];
      var idx = item.rowNum - 2;
      if (idx >= 0 && idx < numRows) {
        if (item.status !== undefined) {
          statusValues[idx][0] = item.status;
        }
        if (item.ynabId !== undefined) {
          idValues[idx][0] = item.ynabId;
        }
      }
    }

    statusRange.setValues(statusValues);
    idRange.setValues(idValues);
  }

  /**
   * Applies visual formatting, conditional formatting rules, and warning protections
   * to the managed YNAB columns (YNAB Status, YNAB ID) to clearly indicate they are
   * computed and not meant for manual editing.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {Object} headerMap
   */
  function formatManagedColumns(sheet, headerMap) {
    if (!sheet || !headerMap) return;

    var statusCol = headerMap[COL_STATUS];
    var idCol = headerMap[COL_ID];
    if (!statusCol || !idCol) return;

    var maxRows = sheet.getMaxRows();

    // 1. Header Styling
    var headerStatus = sheet.getRange(1, statusCol);
    headerStatus.setFontWeight('bold')
      .setBackground('#E8EAED')
      .setFontColor('#202124')
      .setHorizontalAlignment('center')
      .setNote('Managed by YNAB Sync.\nIndicates sync status (Matched, Unmatched, Uploaded).');

    var headerId = sheet.getRange(1, idCol);
    headerId.setFontWeight('bold')
      .setBackground('#E8EAED')
      .setFontColor('#202124')
      .setHorizontalAlignment('center')
      .setNote('Managed by YNAB Sync.\nUnique transaction identifier generated by YNAB.');

    // 2. Data Rows Styling
    if (maxRows > 1) {
      var numDataRows = maxRows - 1;

      // Status column data range: subtle background, centered
      var statusDataRange = sheet.getRange(2, statusCol, numDataRows, 1);
      statusDataRange.setBackground('#F8F9FA')
        .setHorizontalAlignment('center');

      // ID column data range: subtle background, monospace font, 9pt, muted color
      var idDataRange = sheet.getRange(2, idCol, numDataRows, 1);
      idDataRange.setBackground('#F8F9FA')
        .setFontFamily('Roboto Mono')
        .setFontSize(9)
        .setFontColor('#5F6368')
        .setHorizontalAlignment('left');

      // 3. Conditional Formatting Rules for Status Column
      try {
        var existingRules = sheet.getConditionalFormatRules();
        var currentSheetName = sheet.getName();

        // Filter out existing rules on the status column of this sheet to avoid duplicates
        var cleanRules = existingRules.filter(function(rule) {
          var ranges = rule.getRanges();
          for (var i = 0; i < ranges.length; i++) {
            if (ranges[i].getSheet().getName() === currentSheetName && ranges[i].getColumn() === statusCol) {
              return false;
            }
          }
          return true;
        });

        var ruleMatched = SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo('Matched')
          .setBackground('#E6F4EA')
          .setFontColor('#137333')
          .setRanges([statusDataRange])
          .build();

        var ruleUnmatched = SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo('Unmatched')
          .setBackground('#FEF7E0')
          .setFontColor('#B06000')
          .setRanges([statusDataRange])
          .build();

        var ruleUploaded = SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo('Uploaded')
          .setBackground('#E8F0FE')
          .setFontColor('#1A73E8')
          .setRanges([statusDataRange])
          .build();

        var ruleDuplicate = SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo('Duplicate')
          .setBackground('#FCE8E6')
          .setFontColor('#C5221F')
          .setRanges([statusDataRange])
          .build();

        cleanRules.push(ruleMatched, ruleUnmatched, ruleUploaded, ruleDuplicate);
        sheet.setConditionalFormatRules(cleanRules);
      } catch (cfErr) {
        // Safe fallback if conditional formatting cannot be applied in current auth context
      }

      // 4. Soft Edit Warning Protection
      try {
        var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
        var hasWarningProtection = false;
        var desc = 'YNAB Sync Managed Columns';

        for (var p = 0; p < protections.length; p++) {
          if (protections[p].getDescription() === desc) {
            hasWarningProtection = true;
            break;
          }
        }

        if (!hasWarningProtection) {
          var rangesToProtect = [];
          if (Math.abs(idCol - statusCol) === 1) {
            rangesToProtect.push(sheet.getRange(1, Math.min(statusCol, idCol), maxRows, 2));
          } else {
            rangesToProtect.push(sheet.getRange(1, statusCol, maxRows, 1));
            rangesToProtect.push(sheet.getRange(1, idCol, maxRows, 1));
          }

          for (var r = 0; r < rangesToProtect.length; r++) {
            var prot = rangesToProtect[r].protect().setDescription(desc);
            prot.setWarningOnly(true);
          }
        }
      } catch (protErr) {
        // Protection may be restricted depending on Google account tier; safely ignore
      }
    }
  }

  return {
    detectHeaders: detectHeaders,
    formatIsoDate: formatIsoDate,
    clearStatusColumns: clearStatusColumns,
    formatManagedColumns: formatManagedColumns,
    readTransactions: readTransactions,
    updateRowStatuses: updateRowStatuses
  };
})();
