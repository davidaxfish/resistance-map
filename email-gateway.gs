/**
 * Resistance Map: welcome email + subscriber log
 *
 * Runs as ring390@gmail.com (the account that deploys it), so mail goes out from that address.
 * Container-bound: paste this into the Google Sheet's Apps Script (Extensions > Apps Script).
 * See README section "寄信自動化" for the deployment steps.
 *
 * Why the endpoint is safe to leave public:
 *  - It never accepts copy, links or HTML from the browser. All email text comes from data.json on the
 *    live site (DATA_URL), and the result link is rebuilt here from the validated scores.
 *  - Scores, names and addresses are validated, names are HTML-escaped.
 *  - One mail per address per hour, and a daily cap, so it cannot be used as a spam relay.
 *
 * @OnlyCurrentDoc
 */

var CONFIG = {
  DATA_URL: 'https://davidaxfish.github.io/resistance-map/data.json',
  SITE_URL: 'https://davidaxfish.github.io/resistance-map/',
  TAB: '訂閱者',
  COOLDOWN_SECONDS: 3600,
  DAILY_CAP: 80,
  TIMEZONE: 'Asia/Taipei'
};

var HEADERS = [
  'receivedAt', 'sessionId', 'name', 'email', 'topResistance', 'topResistanceName',
  'D%', 'P%', 'S%', 'E%', 'U%', 'commitment', 'resultUrl',
  'emailStatus', 'emailSentAt', 'error', 'followUpStatus'
];

/* ============================================================
 * Pure logic (no Apps Script services): unit-tested in Node
 * ============================================================ */

function fmt_(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, function (m, k) {
    return vars && vars[k] !== undefined ? vars[k] : m;
  });
}

function esc_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cleanName_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
}

var EMAIL_RE_ = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']{2,}$/;

function maxScaleValue_(data) {
  return Math.max.apply(null, data.scale.map(function (s) { return s.value; }));
}

function maxScores_(data) {
  var max = {};
  var top = maxScaleValue_(data);
  data.resistanceOrder.forEach(function (k) { max[k] = 0; });
  Object.keys(data.questions).forEach(function (id) { max[data.questions[id].resistance] += top; });
  return max;
}

/** Returns a validated input object, or null when anything is off. */
function parseInput_(raw, data) {
  var body;
  try { body = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (err) { return null; }
  if (!body || typeof body !== 'object') return null;

  var email = String(body.email || '').trim();
  if (email.length > 120 || !EMAIL_RE_.test(email)) return null;

  var name = cleanName_(body.name);
  if (!name) return null;

  var order = data.resistanceOrder;
  var max = maxScores_(data);
  var topImpact = maxScaleValue_(data);
  var scores = {}, impact = {};
  for (var i = 0; i < order.length; i++) {
    var k = order[i];
    var sc = body.scores ? Number(body.scores[k]) : NaN;
    if (!isFinite(sc) || sc % 1 !== 0 || sc < 0 || sc > max[k]) return null;
    scores[k] = sc;
    var im = body.impact ? Number(body.impact[k]) : 0;
    impact[k] = isFinite(im) && im % 1 === 0 && im >= 0 && im <= topImpact ? im : 0;
  }

  var c = Number(body.commitment);
  return {
    sessionId: String(body.sessionId || '').replace(/[^\w-]/g, '').slice(0, 64),
    name: name,
    email: email,
    scores: scores,
    impact: impact,
    commitment: c >= 1 && c <= 10 ? Math.round(c) : 0
  };
}

/** Same ranking rules as the site: percent, then the life-impact question, then D P S E U order. */
function evaluate_(data, scores, impact) {
  var order = data.resistanceOrder;
  var max = maxScores_(data);
  var ratio = {}, percent = {};
  order.forEach(function (k) {
    ratio[k] = max[k] ? scores[k] / max[k] : 0;
    percent[k] = Math.round(ratio[k] * 100);
  });
  var ranked = order.slice().sort(function (a, b) {
    if (ratio[b] !== ratio[a]) return ratio[b] - ratio[a];
    var ia = impact[a] || 0, ib = impact[b] || 0;
    if (ib !== ia) return ib - ia;
    return order.indexOf(a) - order.indexOf(b);
  });
  var limit = data.config.lowResistanceMaxPercent;
  return {
    percent: percent,
    ranked: ranked,
    top: ranked[0],
    isLow: order.every(function (k) { return percent[k] <= limit; })
  };
}

function resultUrl_(data, input, baseUrl) {
  var order = data.resistanceOrder;
  var parts = ['r=' + order.map(function (k) { return k + input.scores[k]; }).join('-')];
  parts.push('k=' + order.map(function (k) { return input.impact[k] || 0; }).join(''));
  if (input.commitment) parts.push('c=' + input.commitment);
  return baseUrl + '#' + parts.join('&');
}

function findLink_(data, host) {
  var links = (data.follow && data.follow.links) || [];
  for (var i = 0; i < links.length; i++) if (String(links[i].url).indexOf(host) >= 0) return links[i].url;
  return '';
}

var FONT_ = "'PingFang TC','Microsoft JhengHei','Noto Sans TC','Helvetica Neue',Arial,sans-serif";

function button_(href, label, primary) {
  var style = primary
    ? 'background:#E4FF6E;color:#0A0A0A;border:1px solid #E4FF6E;'
    : 'background:transparent;color:#E4FF6E;border:1px solid #B7CC55;';
  return '<a href="' + esc_(href) + '" style="display:block;text-align:center;text-decoration:none;font-weight:700;' +
    'font-size:16px;line-height:20px;padding:14px 18px;border-radius:6px;' + style + '">' + esc_(label) + '</a>';
}

function bar_(label, p, isTop) {
  var fill = isTop ? '#FFC24B' : '#E4FF6E';
  var cells = '';
  if (p > 0) cells += '<td width="' + p + '%" style="background:' + fill + ';height:8px;line-height:8px;font-size:0;border-radius:3px">&nbsp;</td>';
  if (p < 100) cells += '<td style="height:8px;line-height:8px;font-size:0">&nbsp;</td>';
  return '<tr>' +
    '<td style="padding:6px 0;font-size:14px;color:' + (isTop ? '#FFC24B' : '#F2F2EE') + ';width:96px;white-space:nowrap">' + esc_(label) + '</td>' +
    '<td style="padding:6px 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
    'style="background:#2A2A2A;border-radius:3px"><tr>' + cells + '</tr></table></td>' +
    '<td style="padding:6px 0;width:44px;text-align:right;font-size:13px;color:#8C8C86">' + p + '%</td></tr>';
}

/** Builds {subject, html, text} for one subscriber. Everything but the name comes from data.json. */
function buildEmail_(data, input, opts) {
  var E = data.email;
  var R = data.ui.result;
  var res = evaluate_(data, input.scores, input.impact);
  var top = data.resistances[res.top];
  var url = resultUrl_(data, input, (opts && opts.siteUrl) || CONFIG.SITE_URL);
  var book = data.config.calendlyUrl;
  var skool = findLink_(data, 'skool.com');
  var ig = findLink_(data, 'instagram.com');
  var logo = ((opts && opts.siteUrl) || CONFIG.SITE_URL) + 'assets/logo-wordmark.png';
  var vars = { name: input.name };
  var actions = top.actions.slice(0, 3);

  var subject = fmt_(E.subject, vars).replace(/[\r\n]+/g, ' ');

  var topBlock;
  var topText;
  if (res.isLow) {
    topBlock =
      '<p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#FFC24B">' + esc_(data.lowType.title) + '</p>' +
      '<p style="margin:0 0 10px;font-size:15px;line-height:1.8;color:#F2F2EE">' + esc_(data.lowType.desc) + '</p>' +
      '<p style="margin:0;font-size:14px;color:#8C8C86">' + esc_(R.lowTopPrefix) + '<span style="color:#E4FF6E;font-weight:700">' +
      esc_(fmt_(R.lowTopValue, { name: top.name, p: res.percent[res.top] })) + '</span></p>';
    topText = data.lowType.title + '\n' + data.lowType.desc + '\n' + R.lowTopPrefix + fmt_(R.lowTopValue, { name: top.name, p: res.percent[res.top] });
  } else {
    topBlock =
      '<p style="margin:0 0 4px;font-size:14px;color:#8C8C86">' + esc_(E.topLead) + '</p>' +
      '<p style="margin:0 0 14px;font-size:26px;font-weight:700;color:#FFC24B">' + esc_(top.name) + '</p>' +
      '<p style="margin:0 0 2px;font-size:12px;letter-spacing:1px;color:#B7CC55">' + esc_(R.essenceLabel) + '</p>' +
      '<p style="margin:0 0 12px;font-size:15px;line-height:1.8;color:#F2F2EE">' + esc_(top.diagnosis.essence) + '</p>' +
      '<p style="margin:0 0 2px;font-size:12px;letter-spacing:1px;color:#B7CC55">' + esc_(R.consequenceLabel) + '</p>' +
      '<p style="margin:0;font-size:15px;line-height:1.8;color:#F2F2EE">' + esc_(top.diagnosis.consequence) + '</p>';
    topText = E.topLead + top.name + '\n' + R.essenceLabel + '：' + top.diagnosis.essence + '\n' + R.consequenceLabel + '：' + top.diagnosis.consequence;
  }

  var bars = data.resistanceOrder.map(function (k) {
    return bar_(data.resistances[k].name, res.percent[k], !res.isLow && k === res.top);
  }).join('');

  var actionRows = actions.map(function (a, i) {
    return '<tr><td valign="top" style="padding:10px 12px 10px 0;font-size:13px;color:#FFC24B;font-family:monospace">0' + (i + 1) + '</td>' +
      '<td style="padding:10px 0;border-top:1px solid #2A2A2A;font-size:15px;line-height:1.8;color:#F2F2EE">' + esc_(a.text) +
      '<br><span style="display:inline-block;margin-top:6px;font-size:12px;color:#E4FF6E;border:1px solid #B7CC55;border-radius:4px;padding:1px 8px">' +
      esc_(fmt_(R.minutes, { m: a.minutes })) + '</span></td></tr>';
  }).join('');

  var encourage = E.encourage.map(function (l) {
    return '<p style="margin:0 0 10px;font-size:15px;line-height:1.9;color:#F2F2EE">' + esc_(l) + '</p>';
  }).join('');

  var card = 'background:#141414;border:1px solid #2A2A2A;border-radius:10px;padding:22px 20px';
  var html =
    '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="dark"><title>' + esc_(subject) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#0A0A0A">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0A0A0A">' + esc_(E.preheader) + '</div>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0A0A0A"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;font-family:' + FONT_ + '">' +

    '<tr><td style="padding:4px 4px 18px"><img src="' + esc_(logo) + '" alt="Fu System" width="96" style="display:block;border:0;height:auto"></td></tr>' +

    '<tr><td style="padding:0 4px 18px">' +
    '<p style="margin:0 0 10px;font-size:22px;font-weight:700;color:#F2F2EE">' + esc_(fmt_(E.greeting, vars)) + '</p>' +
    '<p style="margin:0;font-size:15px;line-height:1.9;color:#F2F2EE">' + esc_(E.intro) + '</p></td></tr>' +

    '<tr><td style="padding-bottom:14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="' + card + '">' +
    '<tr><td><p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;color:#B7CC55">' + esc_(E.resultTitle) + '</p>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' + bars + '</table></td></tr></table></td></tr>' +

    '<tr><td style="padding-bottom:14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="' + card + ';border-color:#8a6a2a">' +
    '<tr><td>' + topBlock + '</td></tr></table></td></tr>' +

    '<tr><td style="padding-bottom:14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="' + card + '">' +
    '<tr><td><p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#F2F2EE">' + esc_(E.actionsTitle) + '</p>' +
    '<p style="margin:0 0 8px;font-size:13px;color:#8C8C86">' + esc_(E.actionsLead) + '</p>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' + actionRows + '</table></td></tr></table></td></tr>' +

    '<tr><td style="padding:0 0 18px">' + button_(url, E.viewOnline, false) + '</td></tr>' +

    '<tr><td style="padding:0 4px 18px">' + encourage + '</td></tr>' +

    '<tr><td style="padding-bottom:14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="' + card + ';border-color:#FFC24B">' +
    '<tr><td><p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#F2F2EE">' + esc_(E.ctaTitle) + '</p>' +
    '<p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:#F2F2EE">' + esc_(E.ctaLead) + '</p>' +
    button_(book, E.bookLabel, true) + '</td></tr></table></td></tr>' +

    '<tr><td style="padding-bottom:18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="' + card + '">' +
    '<tr><td><p style="margin:0 0 12px;font-size:15px;color:#F2F2EE">' + esc_(E.moreTitle) + '</p>' +
    (skool ? '<div style="margin-bottom:10px">' + button_(skool, E.skoolLabel, false) + '</div>' : '') +
    (ig ? button_(ig, E.igLabel, false) : '') + '</td></tr></table></td></tr>' +

    '<tr><td style="padding:0 4px 8px"><p style="margin:0;font-size:15px;line-height:1.8;color:#F2F2EE">' + esc_(E.signoff) + '<br>' +
    '<strong>' + esc_(E.signName) + '</strong></p></td></tr>' +
    '<tr><td style="padding:12px 4px 0;border-top:1px solid #2A2A2A"><p style="margin:12px 0 0;font-size:12px;line-height:1.8;color:#8C8C86">' + esc_(E.footer) + '</p></td></tr>' +

    '</table></td></tr></table></body></html>';

  var text = [
    fmt_(E.greeting, vars), '',
    E.intro, '',
    E.resultTitle,
    data.resistanceOrder.map(function (k) { return data.resistances[k].name + ' ' + res.percent[k] + '%'; }).join('\n'), '',
    topText, '',
    E.actionsTitle + '（' + E.actionsLead + '）',
    actions.map(function (a, i) { return (i + 1) + '. ' + a.text + '（' + fmt_(R.minutes, { m: a.minutes }) + '）'; }).join('\n'), '',
    E.viewOnline + '：' + url, '',
    E.encourage.join('\n'), '',
    E.ctaTitle, E.ctaLead,
    E.bookLabel + '：' + book, '',
    E.moreTitle,
    skool ? E.skoolLabel + '：' + skool : '',
    ig ? E.igLabel + '：' + ig : '', '',
    E.signoff, E.signName, '',
    E.footer
  ].filter(function (l) { return l !== null; }).join('\n');

  return { subject: subject, html: html, text: text, url: url, result: res };
}

/* ============================================================
 * Apps Script entry points
 * ============================================================ */

function doGet() {
  return json_({ ok: true, service: 'resistance-map-email' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = loadData_();
    var input = parseInput_(e && e.postData ? e.postData.contents : '', data);
    if (!input) return json_({ ok: false, error: 'invalid' });

    var built = buildEmail_(data, input);
    var status = 'sent';
    var error = '';
    var sentAt = '';

    var key = 'em:' + input.email.toLowerCase();
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) {
      status = 'skipped_cooldown';
    } else if (dailyCount_() >= CONFIG.DAILY_CAP) {
      status = 'skipped_daily_cap';
    } else if (MailApp.getRemainingDailyQuota() < 1) {
      status = 'skipped_quota';
    } else {
      try {
        MailApp.sendEmail({
          to: input.email,
          subject: built.subject,
          body: built.text,
          htmlBody: built.html,
          name: data.email.fromName || 'Fu System',
          replyTo: Session.getEffectiveUser().getEmail()
        });
        cache.put(key, '1', CONFIG.COOLDOWN_SECONDS);
        bumpDaily_();
        sentAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
      } catch (err) {
        status = 'error';
        error = String(err).slice(0, 300);
      }
    }

    logRow_(input, built, status, sentAt, error);
    return json_({ ok: true, status: status });
  } catch (err) {
    return json_({ ok: false, error: String(err).slice(0, 200) });
  } finally {
    lock.releaseLock();
  }
}

function loadData_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('data.json');
  if (hit) return JSON.parse(hit);
  var res = UrlFetchApp.fetch(CONFIG.DATA_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('data.json ' + res.getResponseCode());
  var text = res.getContentText();
  var parsed = JSON.parse(text);
  if (!parsed.email || !parsed.resistances) throw new Error('data.json missing email block');
  cache.put('data.json', text, 600);
  return parsed;
}

function dayKey_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function dailyCount_() {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty('day') === dayKey_() ? Number(p.getProperty('count') || 0) : 0;
}

function bumpDaily_() {
  var p = PropertiesService.getScriptProperties();
  var n = dailyCount_() + 1;
  p.setProperties({ day: dayKey_(), count: String(n) });
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.TAB) || ss.insertSheet(CONFIG.TAB);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Free-text fields are neutralised so a spreadsheet never evaluates them as a formula.
function safe_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

function logRow_(input, built, status, sentAt, error) {
  var p = built.result.percent;
  var top = built.result.top;
  sheet_().appendRow([
    Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    safe_(input.sessionId), safe_(input.name), safe_(input.email),
    top, safe_(loadData_().resistances[top].name),
    p.D, p.P, p.S, p.E, p.U,
    input.commitment || '', built.url,
    status, sentAt, safe_(error), ''
  ]);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to grant permissions and see a real email arrive. */
function authorizeAndTest() {
  var data = loadData_();
  var me = Session.getEffectiveUser().getEmail();
  var input = parseInput_({
    sessionId: 'editor-test', name: '測試', email: me,
    scores: { D: 5, P: 7, S: 3, E: 4, U: 2 }, impact: { D: 2, P: 2, S: 1, E: 0, U: 1 }, commitment: 9
  }, data);
  var built = buildEmail_(data, input);
  MailApp.sendEmail({ to: me, subject: '[測試] ' + built.subject, body: built.text, htmlBody: built.html, name: data.email.fromName });
  logRow_(input, built, 'editor_test', '', '');
  Logger.log('Sent a test email to ' + me);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseInput_: parseInput_, evaluate_: evaluate_, buildEmail_: buildEmail_,
    resultUrl_: resultUrl_, esc_: esc_, cleanName_: cleanName_
  };
}
