/**
 * Uploader.js
 * Builds deterministic import_ids, batches transactions, and uploads to YNAB.
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
   * Prepares and uploads unmatched transactions to YNAB.
   *
   * @param {string} budgetId
   * @param {string} accountId
   * @param {Array<Object>} sheetTransactions
   * @return {Object} {
   *   uploadedCount: number,
   *   duplicateCount: number,
   *   updates: Array<{ rowNum, status, ynabId }>
   * }
   */
  function uploadNewTransactions(budgetId, accountId, sheetTransactions) {
    if (!budgetId || !accountId) {
      throw new Error('Budget ID and Account ID are required.');
    }

    // Filter to rows that are neither Matched, Uploaded, nor Duplicate
    var candidates = sheetTransactions.filter(function(tx) {
      return tx.status !== 'Matched' &&
             tx.status !== 'Uploaded' &&
             tx.status !== 'Duplicate' &&
             tx.milliunits !== 0;
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
        importId: importId
      });
    }

    // Dispatch batch upload to YNAB
    var result = YnabClient.postTransactions(budgetId, payloadItems);

    var createdIds = result.transaction_ids || [];
    var duplicateImportIds = result.duplicate_import_ids || [];

    // Map results back to rows
    var updates = [];
    var dupSet = {};
    for (var d = 0; d < duplicateImportIds.length; d++) {
      dupSet[duplicateImportIds[d]] = true;
    }

    var createdIndex = 0;
    for (var r = 0; r < rowMapping.length; r++) {
      var mapItem = rowMapping[r];
      var isDuplicate = !!dupSet[mapItem.importId];

      if (isDuplicate) {
        updates.push({
          rowNum: mapItem.rowNum,
          status: 'Duplicate',
          ynabId: ''
        });
      } else {
        // Assign created ID sequentially from YNAB response
        var createdId = (createdIndex < createdIds.length) ? createdIds[createdIndex] : 'Uploaded';
        createdIndex++;
        updates.push({
          rowNum: mapItem.rowNum,
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
    uploadNewTransactions: uploadNewTransactions
  };
})();
