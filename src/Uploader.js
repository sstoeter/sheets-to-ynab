/**
 * Uploader.js
 * Builds deterministic YNAB import IDs, batches transactions, and uploads to YNAB.
 */

var Uploader = (function() {
  /**
   * Generates a deterministic import_id following the official YNAB format:
   * "YNAB:[amount]:[date]:[occurrence]" (max 36 chars).
   */
  function generateImportId(amountMilliunits, isoDate, occurrence) {
    var rawId = 'YNAB:' + amountMilliunits + ':' + isoDate + ':' + occurrence;
    return rawId.substring(0, 36);
  }

  /**
   * Generates deterministic YNAB Import IDs for all transactions in the sheet.
   *
   * @param {Array<Object>} sheetTransactions
   * @return {Object} {
   *   generatedCount: number,
   *   updates: Array<{ rowNum, importId, status, ynabId }>
   * }
   */
  function generateSheetImportIds(sheetTransactions) {
    var occurrenceTracker = {};
    var updates = [];
    var generatedCount = 0;

    for (var i = 0; i < sheetTransactions.length; i++) {
      var tx = sheetTransactions[i];

      // Skip zero-amount transactions
      if (tx.milliunits === 0) {
        updates.push({
          rowNum: tx.rowNum,
          importId: '',
          status: 'Skipped',
          ynabId: ''
        });
        continue;
      }

      var occKey = tx.milliunits + ':' + tx.date;
      occurrenceTracker[occKey] = (occurrenceTracker[occKey] || 0) + 1;
      var occurrenceIndex = occurrenceTracker[occKey];

      var importId = generateImportId(tx.milliunits, tx.date, occurrenceIndex);
      generatedCount++;

      updates.push({
        rowNum: tx.rowNum,
        importId: importId,
        status: tx.status === 'Ready' ? '' : (tx.status || ''),
        ynabId: tx.ynabId || ''
      });
    }

    return {
      generatedCount: generatedCount,
      updates: updates
    };
  }

  /**
   * Prepares and uploads all transaction rows to YNAB.
   *
   * @param {string} budgetId
   * @param {string} accountId
   * @param {Array<Object>} sheetTransactions
   * @return {Object} {
   *   uploadedCount: number,
   *   duplicateCount: number,
   *   updates: Array<{ rowNum, importId, status, ynabId }>
   * }
   */
  function uploadAllTransactions(budgetId, accountId, sheetTransactions) {
    if (!budgetId || !accountId) {
      throw new Error('Budget ID and Account ID are required.');
    }

    // Filter to rows with non-zero amounts
    var candidates = sheetTransactions.filter(function(tx) {
      return tx.milliunits !== 0;
    });

    if (candidates.length === 0) {
      return {
        uploadedCount: 0,
        duplicateCount: 0,
        updates: []
      };
    }

    var occurrenceTracker = {};
    var payloadItems = [];
    var rowMapping = []; // Tracks index to sheet rowNum

    for (var i = 0; i < candidates.length; i++) {
      var tx = candidates[i];
      var occKey = tx.milliunits + ':' + tx.date;
      occurrenceTracker[occKey] = (occurrenceTracker[occKey] || 0) + 1;
      var occurrenceIndex = occurrenceTracker[occKey];

      // Always regenerate deterministic importId to reflect any date/amount edits
      var importId = generateImportId(tx.milliunits, tx.date, occurrenceIndex);

      payloadItems.push({
        account_id: accountId,
        date: tx.date,
        amount: tx.milliunits,
        payee_name: tx.payee ? tx.payee.substring(0, 100) : null,
        memo: tx.memo ? tx.memo.substring(0, 200) : null,
        cleared: 'cleared',
        approved: false,
        import_id: importId
      });

      rowMapping.push({
        rowNum: tx.rowNum,
        importId: importId,
        existingYnabId: tx.ynabId || ''
      });
    }

    // Dispatch batch upload to YNAB
    var result = YnabClient.postTransactions(budgetId, payloadItems);

    var createdIds = result.transaction_ids || [];
    var duplicateImportIds = result.duplicate_import_ids || [];

    // Map results back to rows
    var dupSet = {};
    for (var d = 0; d < duplicateImportIds.length; d++) {
      dupSet[duplicateImportIds[d]] = true;
    }

    var updates = [];
    var createdIndex = 0;
    for (var r = 0; r < rowMapping.length; r++) {
      var mapItem = rowMapping[r];
      var isDuplicate = !!dupSet[mapItem.importId];

      if (isDuplicate) {
        updates.push({
          rowNum: mapItem.rowNum,
          importId: mapItem.importId,
          status: 'Duplicate',
          ynabId: mapItem.existingYnabId || ''
        });
      } else {
        // Assign created UUID sequentially from YNAB response
        var createdId = (createdIndex < createdIds.length) ? createdIds[createdIndex] : '';
        createdIndex++;
        updates.push({
          rowNum: mapItem.rowNum,
          importId: mapItem.importId,
          status: 'Uploaded',
          ynabId: createdId
        });
      }
    }

    return {
      uploadedCount: createdIds.length,
      duplicateCount: duplicateImportIds.length,
      updates: updates
    };
  }

  return {
    generateImportId: generateImportId,
    generateSheetImportIds: generateSheetImportIds,
    uploadAllTransactions: uploadAllTransactions
  };
})();
