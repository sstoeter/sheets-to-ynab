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
  var COL_IMPORT_ID = 'YNAB Import ID';
  var COL_STATUS = 'YNAB Status';
  var COL_ID = 'YNAB ID';

  /**
   * Scans row 1 of the sheet to map required column headers to 1-based column indexes.
   * Ensures managed columns (YNAB Import ID, YNAB Status, YNAB ID) are present in proper order.
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

    // Validate required input headers (can be directly entered or formula-generated)
    var requiredInputs = [COL_DATE, COL_PAYEE, COL_OUTFLOW, COL_INFLOW];
    for (var i = 0; i < requiredInputs.length; i++) {
      if (!map[requiredInputs[i]]) {
        throw new Error('Required column "' + requiredInputs[i] + '" not found in sheet row 1.');
      }
    }

    var needsFormatting = false;

    // 1. Auto-insert YNAB Import ID if missing
    if (!map[COL_IMPORT_ID]) {
      if (map[COL_STATUS]) {
        // Insert right before YNAB Status to keep: ... Inflow | YNAB Import ID | YNAB Status | YNAB ID
        var statusCol = map[COL_STATUS];
        sheet.insertColumnBefore(statusCol);
        sheet.getRange(1, statusCol).setValue(COL_IMPORT_ID);
        sheet.setColumnWidth(statusCol, 200);
      } else {
        var nextColImport = sheet.getLastColumn() + 1;
        sheet.getRange(1, nextColImport).setValue(COL_IMPORT_ID);
        sheet.setColumnWidth(nextColImport, 200);
      }
      needsFormatting = true;
    }

    // Re-scan header row after possible column insertion
    lastCol = Math.max(sheet.getLastColumn(), 1);
    headerRowValues = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    map = {};
    for (var c2 = 0; c2 < headerRowValues.length; c2++) {
      var val2 = String(headerRowValues[c2]).trim();
      if (val2) {
        map[val2] = c2 + 1;
      }
    }

    // 2. Auto-insert YNAB Status if missing
    if (!map[COL_STATUS]) {
      var nextColStatus = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextColStatus).setValue(COL_STATUS);
      map[COL_STATUS] = nextColStatus;
      needsFormatting = true;
    }

    // 3. Auto-insert YNAB ID if missing
    if (!map[COL_ID]) {
      var nextColId = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextColId).setValue(COL_ID);
      map[COL_ID] = nextColId;
      needsFormatting = true;
    }

    // Check if initial formatting was applied
    if (!needsFormatting) {
      var note = sheet.getRange(1, map[COL_IMPORT_ID]).getNote();
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

    // If Date object: format using spreadsheet's timezone via Utilities.formatDate to prevent timezone shifts
    if (Object.prototype.toString.call(dateVal) === '[object Date]') {
      if (isNaN(dateVal.getTime())) return '';
      if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
        return Utilities.formatDate(dateVal, timeZone || 'UTC', 'yyyy-MM-dd');
      }
      var y = dateVal.getFullYear();
      var m = ('0' + (dateVal.getMonth() + 1)).slice(-2);
      var d = ('0' + dateVal.getDate()).slice(-2);
      return y + '-' + m + '-' + d;
    }

    var str = String(dateVal).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return str;
    }

    // Swiss/German format: DD.MM.YYYY
    var ddmmyyyy = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (ddmmyyyy) {
      return ddmmyyyy[3] + '-' + ('0' + ddmmyyyy[2]).slice(-2) + '-' + ('0' + ddmmyyyy[1]).slice(-2);
    }

    // Slash format: DD/MM/YYYY or YYYY/MM/DD
    var yyyymmdd = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (yyyymmdd) {
      return yyyymmdd[1] + '-' + ('0' + yyyymmdd[2]).slice(-2) + '-' + ('0' + yyyymmdd[3]).slice(-2);
    }
    var slashDdmmyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashDdmmyyyy) {
      return slashDdmmyyyy[3] + '-' + ('0' + slashDdmmyyyy[2]).slice(-2) + '-' + ('0' + slashDdmmyyyy[1]).slice(-2);
    }

    // Attempt parse if date string
    var parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
        return Utilities.formatDate(parsed, timeZone || 'UTC', 'yyyy-MM-dd');
      }
      var py = parsed.getFullYear();
      var pm = ('0' + (parsed.getMonth() + 1)).slice(-2);
      var pd = ('0' + parsed.getDate()).slice(-2);
      return py + '-' + pm + '-' + pd;
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
   * Clears the YNAB Import ID, YNAB Status, and YNAB ID columns for all data rows (row 2 downward).
   * Ensures that dynamic changes in formula-driven data don't misalign with cached values.
   */
  function clearStatusColumns(sheet, headerMap) {
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;

    var numRows = lastRow - 1;
    if (headerMap[COL_IMPORT_ID]) {
      sheet.getRange(2, headerMap[COL_IMPORT_ID], numRows, 1).clearContent();
    }
    if (headerMap[COL_STATUS]) {
      sheet.getRange(2, headerMap[COL_STATUS], numRows, 1).clearContent();
    }
    if (headerMap[COL_ID]) {
      sheet.getRange(2, headerMap[COL_ID], numRows, 1).clearContent();
    }
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
    var displayValues = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    var transactions = [];
    var sheetTz = sheet.getParent().getSpreadsheetTimeZone() || 'UTC';

    for (var i = 0; i < values.length; i++) {
      var rowNum = i + 2; // 1-based sheet row number
      var row = values[i];
      var displayRow = displayValues[i];

      var rawDate = row[headerMap[COL_DATE] - 1];
      var displayDate = displayRow ? String(displayRow[headerMap[COL_DATE] - 1] || '').trim() : '';
      var rawPayee = row[headerMap[COL_PAYEE] - 1];
      var rawMemo = headerMap[COL_MEMO] ? row[headerMap[COL_MEMO] - 1] : '';
      var rawOutflow = row[headerMap[COL_OUTFLOW] - 1];
      var rawInflow = row[headerMap[COL_INFLOW] - 1];
      var currentImportId = headerMap[COL_IMPORT_ID] ? row[headerMap[COL_IMPORT_ID] - 1] : '';
      var currentStatus = headerMap[COL_STATUS] ? row[headerMap[COL_STATUS] - 1] : '';
      var currentId = headerMap[COL_ID] ? row[headerMap[COL_ID] - 1] : '';

      // Prioritize display value if it already represents a strict ISO date (YYYY-MM-DD)
      var isoDate = '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) {
        isoDate = displayDate;
      } else if (rawDate) {
        isoDate = formatIsoDate(rawDate, sheetTz);
      } else if (displayDate) {
        isoDate = formatIsoDate(displayDate, sheetTz);
      }
      var payee = String(rawPayee || '').trim();
      var memo = String(rawMemo || '').trim();

      // Skip blank rows
      if (!isoDate && !payee && !rawOutflow && !rawInflow) {
        continue;
      }

      if (!isoDate) {
        throw new Error('Row ' + rowNum + ' has an invalid Date format. ISO 8601 (YYYY-MM-DD) is required.');
      }

      var outflowNum = Math.abs(parseAmount(rawOutflow));
      var inflowNum = Math.abs(parseAmount(rawInflow));

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
        importId: String(currentImportId || '').trim(),
        status: String(currentStatus || '').trim(),
        ynabId: String(currentId || '').trim()
      });
    }

    return transactions;
  }

  /**
   * Batch updates YNAB Import ID, YNAB Status, and YNAB ID for specific rows in the sheet.
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {Array<Object>} updates Array of { rowNum, importId, status, ynabId }
   * @param {Object} headerMap
   */
  function updateRowStatuses(sheet, updates, headerMap) {
    if (!updates || updates.length === 0) return;

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;

    var importIdCol = headerMap[COL_IMPORT_ID];
    var statusCol = headerMap[COL_STATUS];
    var idCol = headerMap[COL_ID];

    var numRows = lastRow - 1;
    var importIdRange = importIdCol ? sheet.getRange(2, importIdCol, numRows, 1) : null;
    var statusRange = statusCol ? sheet.getRange(2, statusCol, numRows, 1) : null;
    var idRange = idCol ? sheet.getRange(2, idCol, numRows, 1) : null;

    var importIdValues = importIdRange ? importIdRange.getValues() : null;
    var statusValues = statusRange ? statusRange.getValues() : null;
    var idValues = idRange ? idRange.getValues() : null;

    for (var i = 0; i < updates.length; i++) {
      var item = updates[i];
      var idx = item.rowNum - 2;
      if (idx >= 0 && idx < numRows) {
        if (item.importId !== undefined && importIdValues) {
          importIdValues[idx][0] = item.importId;
        }
        if (item.status !== undefined && statusValues) {
          statusValues[idx][0] = item.status;
        }
        if (item.ynabId !== undefined && idValues) {
          idValues[idx][0] = item.ynabId;
        }
      }
    }

    if (importIdRange) importIdRange.setValues(importIdValues);
    if (statusRange) statusRange.setValues(statusValues);
    if (idRange) idRange.setValues(idValues);
  }

  /**
   * Applies visual formatting, conditional formatting rules, and warning protections
   * to the managed columns (YNAB Import ID, YNAB Status, YNAB ID).
   */
  function formatManagedColumns(sheet, headerMap) {
    if (!sheet || !headerMap) return;

    var importIdCol = headerMap[COL_IMPORT_ID];
    var statusCol = headerMap[COL_STATUS];
    var idCol = headerMap[COL_ID];
    if (!importIdCol || !statusCol || !idCol) return;

    var maxRows = sheet.getMaxRows();

    // 1. Header Styling & Column Sizing
    sheet.setColumnWidth(importIdCol, 200);

    var headerImportId = sheet.getRange(1, importIdCol);
    headerImportId.setFontWeight('bold')
      .setBackground('#E8EAED')
      .setFontColor('#202124')
      .setHorizontalAlignment('center')
      .setNote('Managed by YNAB Sync.\nDeterministic deduplication ID: YNAB:[milliunits]:[YYYY-MM-DD]:[occurrence].');

    var headerStatus = sheet.getRange(1, statusCol);
    headerStatus.setFontWeight('bold')
      .setBackground('#E8EAED')
      .setFontColor('#202124')
      .setHorizontalAlignment('center')
      .setNote('Managed by YNAB Sync.\nIndicates sync status (Uploaded, Duplicate).');

    var headerId = sheet.getRange(1, idCol);
    headerId.setFontWeight('bold')
      .setBackground('#E8EAED')
      .setFontColor('#202124')
      .setHorizontalAlignment('center')
      .setNote('Managed by YNAB Sync.\nUnique transaction identifier generated by YNAB.');

    // 2. Data Rows Styling
    if (maxRows > 1) {
      var numDataRows = maxRows - 1;

      // Import ID column data range: subtle background, monospace font, 9pt, centered
      var importIdDataRange = sheet.getRange(2, importIdCol, numDataRows, 1);
      importIdDataRange.setBackground('#F8F9FA')
        .setFontFamily('Roboto Mono')
        .setFontSize(9)
        .setFontColor('#5F6368')
        .setHorizontalAlignment('center');

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

        var ruleUploaded = SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo('Uploaded')
          .setBackground('#E6F4EA')
          .setFontColor('#137333')
          .setRanges([statusDataRange])
          .build();

        var ruleDuplicate = SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo('Duplicate')
          .setBackground('#FCE8E6')
          .setFontColor('#C5221F')
          .setRanges([statusDataRange])
          .build();

        var ruleSkipped = SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo('Skipped')
          .setBackground('#FEF7E0')
          .setFontColor('#B06000')
          .setRanges([statusDataRange])
          .build();

        cleanRules.push(ruleUploaded, ruleDuplicate, ruleSkipped);
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
          var cols = [importIdCol, statusCol, idCol].sort(function(a, b) { return a - b; });
          var rangesToProtect = [];
          if (cols[2] - cols[0] === 2) {
            // Contiguous 3 columns
            rangesToProtect.push(sheet.getRange(1, cols[0], maxRows, 3));
          } else {
            for (var cIdx = 0; cIdx < cols.length; cIdx++) {
              rangesToProtect.push(sheet.getRange(1, cols[cIdx], maxRows, 1));
            }
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
