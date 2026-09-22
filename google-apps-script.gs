/**
 * Resistance Map -> Google Sheet lead table
 *
 * Setup (see README):
 * 1. Create a Google Sheet, then Extensions > Apps Script, paste this file.
 * 2. Deploy > New deployment > Web app
 *      Execute as: Me
 *      Who has access: Anyone
 * 3. Copy the /exec URL into data.json -> config.webhookUrl
 *    Keep config.webhookMode = "simple".
 *
 * One row per quiz session (upsert by sessionId): the "complete", "reason"
 * and "lead" events all update the same row.
 */

var SHEET_NAME = 'leads';

var COLUMNS = [
  ['sessionId',     function (p) { return p.sessionId; }],
  ['updatedAt',     function () { return new Date(); }],
  ['completedAt',   function (p) { return p.completedAt; }],
  ['lastEvent',     function (p) { return p.event; }],
  ['ig',            function (p) { return p.ig; }],
  ['email',         function (p) { return p.email; }],
  ['line',          function (p) { return p.line; }],
  ['resultUrl',     function (p) { return p.resultUrl; }],
  ['topResistance', function (p) { return p.topResistance; }],
  ['isLow',         function (p) { return p.isLow; }],
  ['commitment',    function (p) { return p.commitment; }],
  ['ctaBranch',     function (p) { return p.ctaBranch; }],
  ['reasonNot10',   function (p) { return p.reasonNot10; }],
  ['goal',          function (p) { return p.goal; }],
  ['whyNow',        function (p) { return p.whyNow; }],
  ['D',  function (p) { return p.scores && p.scores.D; }],
  ['P',  function (p) { return p.scores && p.scores.P; }],
  ['S',  function (p) { return p.scores && p.scores.S; }],
  ['E',  function (p) { return p.scores && p.scores.E; }],
  ['U',  function (p) { return p.scores && p.scores.U; }],
  ['D%', function (p) { return p.percent && p.percent.D; }],
  ['P%', function (p) { return p.percent && p.percent.P; }],
  ['S%', function (p) { return p.percent && p.percent.S; }],
  ['E%', function (p) { return p.percent && p.percent.E; }],
  ['U%', function (p) { return p.percent && p.percent.U; }],
  ['followUpStatus', null]  // left for manual follow-up notes; never overwritten
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var p = JSON.parse(e.postData.contents);
    if (!p || !p.sessionId) return json({ ok: false, error: 'missing sessionId' });

    var sheet = getSheet();
    var width = COLUMNS.length;
    var lastRow = sheet.getLastRow();
    var rowIndex = -1;
    if (lastRow > 1) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i][0] === p.sessionId) { rowIndex = i + 2; break; }
      }
    }

    var existing = rowIndex > 0 ? sheet.getRange(rowIndex, 1, 1, width).getValues()[0] : [];
    var row = COLUMNS.map(function (col, i) {
      if (!col[1]) return existing[i] || '';
      return safe(col[1](p));
    });

    if (rowIndex > 0) sheet.getRange(rowIndex, 1, 1, width).setValues([row]);
    else sheet.appendRow(row);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json({ ok: true, service: 'resistance-map' });
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map(function (c) { return c[0]; }));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Block spreadsheet formula injection from free-text fields.
function safe(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
