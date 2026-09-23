/* Resistance Map
 * All copy lives in data.json. This file holds logic only.
 * The scoring section is pure and is exported for node tests (tests/scoring.test.js).
 */
(function (root) {
  'use strict';

  /* ============================================================
   * Pure logic
   * ============================================================ */

  function fmt(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] !== undefined ? vars[k] : m;
    });
  }

  function maxScaleValue(data) {
    return Math.max.apply(null, data.scale.map(function (s) { return s.value; }));
  }

  // Max achievable score per resistance, derived from the question bank.
  function maxScores(data) {
    var max = {};
    var top = maxScaleValue(data);
    data.resistanceOrder.forEach(function (k) { max[k] = 0; });
    Object.keys(data.questions).forEach(function (id) {
      max[data.questions[id].resistance] += top;
    });
    return max;
  }

  // answers: { D1: 0..3, ... }  ->  { scores, impact }
  function tally(data, answers) {
    var scores = {}, impact = {};
    data.resistanceOrder.forEach(function (k) { scores[k] = 0; impact[k] = 0; });
    Object.keys(data.questions).forEach(function (id) {
      var q = data.questions[id];
      var v = Number(answers[id]) || 0;
      scores[q.resistance] += v;
      if (q.impact) impact[q.resistance] = v;
    });
    return { scores: scores, impact: impact };
  }

  // Build the full result from raw sums + impact-question scores.
  function evaluate(data, scores, impact) {
    var order = data.resistanceOrder;
    var max = maxScores(data);
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
    var isLow = order.every(function (k) { return percent[k] <= limit; });
    return {
      scores: scores,
      impact: impact,
      max: max,
      percent: percent,
      ranked: ranked,
      top: ranked[0],
      isLow: isLow
    };
  }

  function ctaBranch(data, commitment) {
    return commitment >= data.config.commitmentThreshold ? 'call' : 'dm';
  }

  // #r=D3-P7-S2-E5-U4&k=12030&c=9&g=0&w=2
  function encodeHash(data, res, extra) {
    var order = data.resistanceOrder;
    var parts = ['r=' + order.map(function (k) { return k + res.scores[k]; }).join('-')];
    parts.push('k=' + order.map(function (k) { return res.impact[k] || 0; }).join(''));
    if (extra && extra.commitment) parts.push('c=' + extra.commitment);
    if (extra && extra.goal !== undefined && extra.goal !== null) parts.push('g=' + extra.goal);
    if (extra && extra.whyNow !== undefined && extra.whyNow !== null) parts.push('w=' + extra.whyNow);
    return parts.join('&');
  }

  function decodeHash(data, hash) {
    var str = String(hash || '').replace(/^#/, '');
    if (!str) return null;
    var params = {};
    str.split('&').forEach(function (p) {
      var i = p.indexOf('=');
      if (i > 0) params[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
    });
    if (!params.r) return null;
    var order = data.resistanceOrder;
    var max = maxScores(data);
    var top = maxScaleValue(data);
    var scores = {};
    var ok = true;
    params.r.split('-').forEach(function (chunk) {
      var m = /^([A-Z])(\d+)$/.exec(chunk);
      if (!m || order.indexOf(m[1]) < 0) { ok = false; return; }
      var v = Number(m[2]);
      if (v < 0 || v > max[m[1]]) { ok = false; return; }
      scores[m[1]] = v;
    });
    if (!ok || order.some(function (k) { return scores[k] === undefined; })) return null;

    var impact = {};
    order.forEach(function (k, i) {
      var d = params.k ? Number(params.k.charAt(i)) : 0;
      impact[k] = isFinite(d) && d >= 0 && d <= top ? d : 0;
    });

    var c = Number(params.c);
    var ctxIndex = function (v, qi) {
      var n = Number(v);
      var q = data.contextQuestions[qi];
      return v !== undefined && q && n >= 0 && n < q.options.length ? n : null;
    };
    return {
      scores: scores,
      impact: impact,
      commitment: c >= 1 && c <= 10 ? Math.round(c) : null,
      goal: ctxIndex(params.g, 0),
      whyNow: ctxIndex(params.w, 1)
    };
  }

  var Logic = {
    fmt: fmt, maxScores: maxScores, tally: tally, evaluate: evaluate,
    ctaBranch: ctaBranch, encodeHash: encodeHash, decodeHash: decodeHash
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logic;
  }
  if (typeof document === 'undefined') return;

  /* ============================================================
   * UI
   * ============================================================ */

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var app = document.getElementById('app');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DATA = null;
  var state = null;
  var timers = [];

  function newState() {
    return {
      step: 0,
      answers: {},
      context: {},
      commitment: null,
      reasonNot10: '',
      lead: {},
      completedAt: '',
      sessionId: makeId(),
      result: null
    };
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'rm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }

  // Tiny element builder: h('div', {class: 'x', onclick: fn}, [children])
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    applyAttrs(el, attrs);
    appendChildren(el, children);
    return el;
  }

  function s(tag, attrs, children) {
    var el = document.createElementNS(SVG_NS, tag);
    applyAttrs(el, attrs);
    appendChildren(el, children);
    return el;
  }

  function applyAttrs(el, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
  }

  function appendChildren(el, children) {
    if (children === null || children === undefined) return;
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) return appendChildren(el, c);
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }

  function mount(nodes, focusSel) {
    clearTimers();
    app.textContent = '';
    appendChildren(app, nodes);
    window.scrollTo(0, 0);
    var f = app.querySelector(focusSel || '[data-focus]');
    if (f) f.focus({ preventScroll: true });
  }

  /* ---------- steps ---------- */

  function steps() {
    var list = [];
    DATA.contextQuestions.forEach(function (q, i) { list.push({ type: 'context', q: q, index: i }); });
    DATA.questionOrder.forEach(function (id) { list.push({ type: 'scale', id: id, q: DATA.questions[id] }); });
    list.push({ type: 'commitment' });
    return list;
  }

  function questionCount() {
    return DATA.contextQuestions.length + DATA.questionOrder.length;
  }

  /* ---------- screens ---------- */

  function renderIntro() {
    var t = DATA.ui.intro;
    mount([
      h('section', { class: 'screen intro' }, [
        h('p', { class: 'kicker', text: t.kicker }),
        h('h1', { class: 'intro-title grad', tabindex: '-1', 'data-focus': true, text: t.title }),
        h('p', { class: 'intro-sub', text: t.subtitle }),
        h('p', { class: 'intro-desc', text: t.desc }),
        h('ul', { class: 'specs' }, t.specs.map(function (x) { return h('li', { text: x }); })),
        h('p', { class: 'muted small', text: t.note }),
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: start, text: t.start })
      ])
    ]);
  }

  function start() {
    var cfg = DATA.config.audio;
    if (cfg && cfg.autoStart && !audio.on) setAudio(true);
    state = newState();
    setHash('');
    renderStep();
  }

  function renderStep() {
    var list = steps();
    var st = list[state.step];
    if (st.type === 'commitment') return renderCommitment();
    renderQuestion(st, list.length);
  }

  function header(label, pct) {
    var ui = DATA.ui;
    return h('div', { class: 'qhead' }, [
      h('div', { class: 'qhead-row' }, [
        h('button', {
          class: 'btn-ghost', type: 'button', onclick: goBack,
          text: '← ' + (state.step === 0 ? ui.nav.backToIntro : ui.nav.back)
        }),
        h('span', { class: 'mono muted small', text: label })
      ]),
      h('div', {
        class: 'progress', role: 'progressbar', 'aria-label': label,
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct))
      }, h('div', { class: 'progress-fill', style: 'width:' + pct + '%' }))
    ]);
  }

  function renderQuestion(st, total) {
    var ui = DATA.ui;
    var n = state.step + 1;
    var label = fmt(ui.progress.question, { n: pad2(n), total: pad2(questionCount()) });
    var pct = (state.step / (total - 1)) * 100;
    var options, selected, hint;

    if (st.type === 'context') {
      options = st.q.options.map(function (o, i) { return { label: o, value: i }; });
      selected = state.context[st.q.id];
      hint = ui.hints.context;
    } else {
      options = DATA.scale.map(function (sc) { return { label: sc.label, value: sc.value }; });
      selected = state.answers[st.id];
      hint = ui.hints.scale;
    }

    var qId = 'q-' + state.step;
    var list = h('div', { class: 'options', role: 'group', 'aria-labelledby': qId },
      options.map(function (o, i) {
        var isSel = selected === o.value;
        return h('button', {
          class: 'opt' + (isSel ? ' is-selected' : ''),
          type: 'button',
          'aria-pressed': isSel ? 'true' : 'false',
          onclick: function (e) { choose(st, o.value, e.currentTarget); }
        }, [
          h('span', { class: 'opt-key mono', 'aria-hidden': 'true', text: String(i + 1) }),
          h('span', { class: 'opt-label', text: o.label })
        ]);
      })
    );

    mount([
      h('section', { class: 'screen question' }, [
        header(label, pct),
        h('p', { class: 'hint muted small', text: hint }),
        h('h2', { class: 'qtext', id: qId, tabindex: '-1', 'data-focus': true, text: st.q.text }),
        list
      ])
    ]);
  }

  var locked = false;
  function choose(st, value, btn) {
    if (locked) return;
    if (st.type === 'context') state.context[st.q.id] = value;
    else state.answers[st.id] = value;
    Array.prototype.forEach.call(app.querySelectorAll('.opt'), function (b) {
      b.classList.remove('is-selected');
      b.setAttribute('aria-pressed', 'false');
    });
    if (btn) {
      btn.classList.add('is-selected');
      btn.setAttribute('aria-pressed', 'true');
    }
    locked = true;
    later(function () {
      locked = false;
      state.step += 1;
      renderStep();
    }, reduceMotion ? 0 : DATA.config.autoAdvanceMs);
  }

  function goBack() {
    locked = false;
    if (state.step === 0) return renderIntro();
    state.step -= 1;
    renderStep();
  }

  function renderCommitment() {
    var t = DATA.ui.commitment;
    var submit = h('button', {
      class: 'btn btn-primary btn-block', type: 'button',
      disabled: state.commitment ? null : true,
      onclick: function () { if (state.commitment) runLoading(); },
      text: t.submit
    });
    var nums = [];
    for (var i = 1; i <= 10; i++) nums.push(i);
    var group = h('div', { class: 'scale10', role: 'group', 'aria-label': t.groupLabel },
      nums.map(function (v) {
        var isSel = state.commitment === v;
        return h('button', {
          class: 'num mono' + (isSel ? ' is-selected' : ''),
          type: 'button',
          'aria-pressed': isSel ? 'true' : 'false',
          onclick: function (e) {
            state.commitment = v;
            Array.prototype.forEach.call(group.children, function (b) {
              b.classList.remove('is-selected');
              b.setAttribute('aria-pressed', 'false');
            });
            e.currentTarget.classList.add('is-selected');
            e.currentTarget.setAttribute('aria-pressed', 'true');
            submit.disabled = false;
          },
          text: String(v)
        });
      })
    );
    mount([
      h('section', { class: 'screen commitment' }, [
        header(DATA.ui.progress.commitment, 100),
        h('p', { class: 'kicker', text: t.kicker }),
        h('h2', { class: 'qtext', tabindex: '-1', 'data-focus': true, text: t.question }),
        group,
        h('div', { class: 'scale10-legend muted small', 'aria-hidden': 'true' }, [
          h('span', { text: t.minLabel }), h('span', { text: t.maxLabel })
        ]),
        submit
      ])
    ]);
  }

  function runLoading() {
    var t = DATA.ui.loading;
    var msg = h('p', { class: 'loading-msg', role: 'status', text: t.messages[0] });
    mount([
      h('section', { class: 'screen loading' }, [
        h('p', { class: 'kicker', text: t.kicker }),
        h('div', { class: 'scanner', 'aria-hidden': 'true' }, h('div', { class: 'scanner-bar' })),
        msg
      ])
    ]);
    t.messages.forEach(function (m, i) {
      if (i > 0) later(function () { msg.textContent = m; }, i * DATA.config.loadingStepMs);
    });
    later(finish, DATA.config.loadingMs);
  }

  function finish() {
    var tallied = tally(DATA, state.answers);
    state.result = evaluate(DATA, tallied.scores, tallied.impact);
    state.completedAt = new Date().toISOString();
    setHash(encodeHash(DATA, state.result, {
      commitment: state.commitment, goal: state.context.goal, whyNow: state.context.whyNow
    }));
    sendWebhook('complete');
    renderResult();
  }

  /* ---------- radar ---------- */

  function renderRadar(res) {
    var order = DATA.resistanceOrder;
    var W = 400, H = 380, cx = 200, cy = 202, R = 110, LR = 138;
    var n = order.length;
    var t = DATA.ui.result;

    function pt(i, r) {
      var a = (-90 + (360 / n) * i) * Math.PI / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    function poly(r) {
      return order.map(function (_, i) { return pt(i, r).map(round1).join(','); }).join(' ');
    }

    var aria = fmt(t.radarAria, {
      list: order.map(function (k) {
        return fmt(t.radarAriaItem, { name: DATA.resistances[k].name, p: res.percent[k] });
      }).join(t.listSeparator)
    });

    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'radar', role: 'img', 'aria-label': aria });

    var stops = function (id, coords) {
      return s('linearGradient', {
        id: id, x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], gradientUnits: 'objectBoundingBox'
      }, [
        s('stop', { offset: '0', 'stop-color': '#EFFF8A' }),
        s('stop', { offset: '0.45', 'stop-color': '#E4FF6E' }),
        s('stop', { offset: '1', 'stop-color': '#F59A23' })
      ]);
    };
    svg.appendChild(s('defs', {}, [stops('rmStroke', [0, 0, 1, 1]), stops('rmFill', [0, 0, 0.6, 1])]));

    var grid = s('g', { class: 'radar-grid' });
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      grid.appendChild(s('polygon', { points: poly(R * f), class: f === 1 ? 'grid-outer' : 'grid-ring' }));
    });
    order.forEach(function (_, i) {
      var p = pt(i, R);
      grid.appendChild(s('line', { x1: cx, y1: cy, x2: round1(p[0]), y2: round1(p[1]), class: 'grid-axis' }));
    });
    svg.appendChild(grid);

    var shape = s('g', { class: 'radar-shape', style: 'transform-origin:' + cx + 'px ' + cy + 'px' });
    var pts = order.map(function (k, i) { return pt(i, R * res.percent[k] / 100); });
    shape.appendChild(s('polygon', {
      class: 'radar-area',
      points: pts.map(function (p) { return p.map(round1).join(','); }).join(' ')
    }));
    order.forEach(function (k, i) {
      var p = pts[i];
      if (k === res.top) {
        shape.appendChild(s('circle', { cx: round1(p[0]), cy: round1(p[1]), r: 14, class: 'dot-halo' }));
        shape.appendChild(s('circle', { cx: round1(p[0]), cy: round1(p[1]), r: 6, class: 'dot-top' }));
      } else {
        shape.appendChild(s('circle', { cx: round1(p[0]), cy: round1(p[1]), r: 3.5, class: 'dot' }));
      }
    });
    svg.appendChild(shape);

    var labels = s('g', { class: 'radar-labels' });
    order.forEach(function (k, i) {
      var p = pt(i, LR);
      var a = (-90 + (360 / n) * i) * Math.PI / 180;
      var cos = Math.cos(a), sin = Math.sin(a);
      var anchor = cos > 0.3 ? 'start' : (cos < -0.3 ? 'end' : 'middle');
      var isTop = k === res.top;
      var lines = 2 + (isTop ? 1 : 0);
      var lh = 18;
      var y0;
      if (sin < -0.9) y0 = p[1] - (lines - 1) * lh;          // top vertex: stack upwards
      else if (sin < 0) y0 = p[1] - ((lines - 1) * lh) / 2 + 5; // upper sides: centre on point
      else y0 = p[1] + 8;                                     // lower vertices: stack downwards

      var x = round1(p[0]);
      labels.appendChild(s('text', {
        x: x, y: round1(y0), 'text-anchor': anchor, class: 'lbl' + (isTop ? ' lbl-top' : ''),
        text: DATA.resistances[k].axisLabel
      }));
      labels.appendChild(s('text', {
        x: x, y: round1(y0 + lh), 'text-anchor': anchor, class: 'pct' + (isTop ? ' pct-top' : ''),
        text: fmt(t.percent, { p: res.percent[k] })
      }));
      if (isTop) {
        var bw = t.topBadge.length * 11 + 12, bh = 17;
        var bx = anchor === 'start' ? x : (anchor === 'end' ? x - bw : x - bw / 2);
        var by = y0 + lh * 2 - 12;
        labels.appendChild(s('rect', { x: round1(bx), y: round1(by), width: bw, height: bh, rx: 3, class: 'badge-bg' }));
        labels.appendChild(s('text', {
          x: round1(bx + bw / 2), y: round1(by + 12.5), 'text-anchor': 'middle', class: 'badge-text',
          text: t.topBadge
        }));
      }
    });
    svg.appendChild(labels);
    return svg;
  }

  /* ---------- result ---------- */

  function renderResult() {
    var res = state.result;
    var t = DATA.ui.result;
    var top = DATA.resistances[res.top];

    var topCard = res.isLow
      ? h('section', { class: 'card card-top' }, [
          h('p', { class: 'kicker', text: t.kickers.low }),
          h('h2', { class: 'card-title', text: DATA.lowType.title }),
          h('p', { text: DATA.lowType.desc }),
          h('p', { class: 'top-line' }, [
            h('span', { class: 'muted', text: t.lowTopPrefix }),
            h('strong', { class: 'accent', text: fmt(t.lowTopValue, { name: top.name, p: res.percent[res.top] }) })
          ])
        ])
      : h('section', { class: 'card card-top' }, [
          h('p', { class: 'kicker', text: fmt(t.kickers.top, { code: res.top }) }),
          h('h2', { class: 'card-title' }, [
            h('span', { class: 'muted top-prefix', text: t.topPrefix }),
            h('span', { class: 'accent', text: top.name })
          ]),
          h('dl', { class: 'diag' }, [
            h('dt', { class: 'mono small', text: t.essenceLabel }),
            h('dd', { text: top.diagnosis.essence }),
            h('dt', { class: 'mono small', text: t.consequenceLabel }),
            h('dd', { text: top.diagnosis.consequence })
          ])
        ]);

    var actions = h('section', { class: 'card' }, [
      h('p', { class: 'kicker', text: fmt(t.kickers.actions, { code: res.top }) }),
      h('h2', { class: 'card-title', text: t.actionsTitle }),
      h('p', { class: 'muted small', text: t.actionsIntro }),
      h('ol', { class: 'actions' }, top.actions.slice(0, 3).map(function (a, i) {
        return h('li', { class: 'action' }, [
          h('span', { class: 'action-no mono', 'aria-hidden': 'true', text: pad2(i + 1) }),
          h('div', { class: 'action-body' }, [
            h('p', { text: a.text }),
            h('span', { class: 'tag mono', text: fmt(t.minutes, { m: a.minutes }) })
          ])
        ]);
      }))
    ]);

    var gap = h('section', { class: 'card card-gap' }, [
      h('p', { class: 'kicker', text: t.kickers.gap }),
      h('h2', { class: 'card-title', text: DATA.gap.title }),
      DATA.gap.lines.map(function (l) { return h('p', { text: l }); })
    ]);

    var others = h('section', { class: 'card' }, [
      h('h2', { class: 'card-title small-title', text: t.othersTitle }),
      h('ul', { class: 'others' }, res.ranked.slice(1, 3).map(function (k) {
        return h('li', {}, [
          h('span', { text: DATA.resistances[k].name }),
          h('span', { class: 'mono', text: fmt(t.percent, { p: res.percent[k] }) })
        ]);
      }))
    ]);

    mount([
      h('section', { class: 'screen result' }, [
        h('p', { class: 'kicker', text: t.kicker }),
        h('h1', { class: 'result-title grad', tabindex: '-1', 'data-focus': true, text: t.title }),
        h('div', { class: 'card radar-card' }, [
          renderRadar(res),
          h('p', { class: 'muted small center', text: t.radarCaption })
        ]),
        topCard,
        others,
        actions,
        gap,
        renderProof(),
        renderMeals(),
        renderMethod(res),
        renderCta(),
        renderLead(),
        renderFollow(),
        h('p', { class: 'muted small center share', text: t.shareHint }),
        h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: start, text: t.restart })
      ])
    ]);
  }

  // Images load only when near the viewport, so photos never compete with the first paint.
  function img(item, cls) {
    var el = h('img', {
      class: cls, alt: item.alt, width: item.width, height: item.height, decoding: 'async',
      'data-src': item.src
    });
    if (lazyObserver) lazyObserver.observe(el);
    else el.src = item.src;
    return el;
  }

  var lazyObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.src = e.target.getAttribute('data-src');
          obs.unobserve(e.target);
        });
      }, { rootMargin: '300px 300px' })
    : null;

  function renderProof() {
    var p = DATA.proof;
    if (!p) return null;
    var frame = function (item, mod) {
      return h('figure', { class: 'ba-frame ba-' + mod }, [
        img(item, 'ba-img'),
        h('figcaption', { class: 'ba-label mono', text: item.label })
      ]);
    };
    return h('section', { class: 'card card-proof' }, [
      h('p', { class: 'kicker', text: p.kicker }),
      h('h2', { class: 'card-title', text: p.title }),
      h('div', { class: 'ba' }, [frame(p.before, 'before'), frame(p.after, 'after')]),
      p.story.map(function (l) { return h('p', { text: l }); })
    ]);
  }

  function renderMeals() {
    var m = DATA.meals;
    if (!m) return null;
    return h('section', { class: 'card card-meals' }, [
      h('p', { class: 'kicker', text: m.kicker }),
      h('h2', { class: 'card-title', text: m.title }),
      h('p', { class: 'muted small', text: m.desc }),
      h('ul', { class: 'meals', tabindex: '0', 'aria-label': m.title }, m.items.map(function (it) {
        return h('li', { class: 'meal' }, [
          img(it, 'meal-img'),
          h('span', { class: 'tag mono', text: it.tag }),
          h('p', { class: 'small', text: it.caption })
        ]);
      }))
    ]);
  }

  function renderMethod(res) {
    var m = DATA.method;
    if (!m) return null;
    return h('section', { class: 'card card-method' }, [
      h('p', { class: 'kicker', text: m.kicker }),
      h('h2', { class: 'card-title', text: m.title }),
      h('p', { text: m.intro }),
      m.compare ? renderCompare(m.compare) : null,
      m.itemsTitle ? h('h3', { class: 'sub-title', text: m.itemsTitle }) : null,
      h('ol', { class: 'method' }, m.items.map(function (it, i) {
        var mine = it.hits.indexOf(res.top) >= 0;
        return h('li', { class: 'method-item' + (mine ? ' is-mine' : '') }, [
          h('span', { class: 'action-no mono', 'aria-hidden': 'true', text: pad2(i + 1) }),
          h('div', {}, [
            h('p', { class: 'method-title' }, [
              it.title,
              mine ? h('span', { class: 'badge', text: m.yourTop }) : null
            ]),
            h('p', { text: it.text }),
            h('p', { class: 'hits small muted' }, [
              m.hitsLabel,
              it.hits.map(function (k) {
                return h('span', { class: 'hit mono' + (k === res.top ? ' hit-top' : ''), text: DATA.resistances[k].axisLabel });
              })
            ])
          ])
        ]);
      })),
      h('p', { class: 'method-closing', text: m.closing })
    ]);
  }

  function renderCompare(c) {
    return h('div', { class: 'compare' }, [
      h('h3', { class: 'sub-title', text: c.title }),
      h('table', { class: 'compare-table' }, [
        h('thead', {}, h('tr', {}, [
          h('th', { scope: 'col', class: 'col-a', text: c.colA }),
          h('th', { scope: 'col', class: 'col-b', text: c.colB })
        ])),
        h('tbody', {}, c.rows.map(function (r) {
          return [
            h('tr', { class: 'compare-key' }, h('th', { scope: 'rowgroup', colspan: '2', class: 'mono', text: r.k })),
            h('tr', {}, [
              h('td', { class: 'col-a', text: r.a }),
              h('td', { class: 'col-b', text: r.b })
            ])
          ];
        }))
      ])
    ]);
  }

  function renderFollow() {
    var f = DATA.follow;
    if (!f) return null;
    return h('section', { class: 'card' }, [
      h('p', { class: 'kicker', text: f.kicker }),
      h('h2', { class: 'card-title', text: f.title }),
      h('p', { class: 'muted small', text: f.desc }),
      h('div', { class: 'follow' }, f.links.map(function (l) {
        return h('a', { class: 'follow-link', href: l.url, target: '_blank', rel: 'noopener' }, [
          l.icon ? h('img', { class: 'follow-icon', src: l.icon, alt: '', width: l.iconWidth || 28, height: 28, loading: 'lazy' }) : null,
          h('span', { class: 'follow-text' }, [
            h('span', { class: 'follow-label', text: l.label }),
            h('span', { class: 'mono small muted', text: l.sub })
          ])
        ]);
      }))
    ]);
  }

  function renderCta() {
    if (!state.commitment) return null;
    if (ctaBranch(DATA, state.commitment) === 'call') {
      var hi = DATA.cta.high;
      return h('section', { class: 'card card-cta' }, [
        h('p', { class: 'kicker', text: hi.kicker }),
        h('p', { class: 'cta-lead', text: hi.lead }),
        h('a', {
          class: 'btn btn-primary btn-block', href: DATA.config.calendlyUrl,
          target: '_blank', rel: 'noopener', text: hi.button
        })
      ]);
    }
    var lo = DATA.cta.low;
    var slot = h('div', { class: 'dm-slot' });
    var picks = h('div', { class: 'options compact', role: 'group', 'aria-label': lo.question },
      lo.options.map(function (o) {
        var isSel = state.reasonNot10 === o.label;
        return h('button', {
          class: 'opt' + (isSel ? ' is-selected' : ''), type: 'button',
          'aria-pressed': isSel ? 'true' : 'false',
          onclick: function (e) {
            var changed = state.reasonNot10 !== o.label;
            state.reasonNot10 = o.label;
            Array.prototype.forEach.call(picks.children, function (b) {
              b.classList.remove('is-selected');
              b.setAttribute('aria-pressed', 'false');
            });
            e.currentTarget.classList.add('is-selected');
            e.currentTarget.setAttribute('aria-pressed', 'true');
            fillDm(slot, o);
            if (changed) sendWebhook('reason');
          }
        }, h('span', { class: 'opt-label', text: o.label }));
      })
    );
    var card = h('section', { class: 'card card-cta' }, [
      h('p', { class: 'kicker', text: lo.kicker }),
      h('h2', { class: 'card-title', text: lo.question }),
      picks,
      slot
    ]);
    var prev = lo.options.filter(function (o) { return o.label === state.reasonNot10; })[0];
    if (prev) fillDm(slot, prev);
    return card;
  }

  function fillDm(slot, option) {
    var lo = DATA.cta.low;
    var kw = DATA.config.dmKeyword;
    var copyBtn = h('button', {
      class: 'btn btn-outline', type: 'button', text: lo.copyButton,
      onclick: function () {
        var done = function () { copyBtn.textContent = lo.copied; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(kw).then(done, done);
        } else done();
      }
    });
    slot.textContent = '';
    appendChildren(slot, [
      h('p', { class: 'reply', text: option.reply }),
      h('div', { class: 'dm-box' }, [
        h('p', { class: 'dm-title', text: fmt(lo.dmTitle, { keyword: kw }) }),
        h('p', { class: 'muted small', text: lo.dmDesc }),
        h('div', { class: 'dm-actions' }, [
          DATA.config.igDmUrl
            ? h('a', { class: 'btn btn-primary', href: DATA.config.igDmUrl, target: '_blank', rel: 'noopener', text: lo.dmButton })
            : null,
          copyBtn
        ])
      ])
    ]);
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function renderLead() {
    var t = DATA.lead;
    var msg = h('p', { class: 'form-msg small', role: 'status' });
    var inputs = {};
    var rows = t.fields.map(function (f) {
      var id = 'lead-' + f.id;
      var input = h('input', {
        id: id, name: f.id, type: f.type || 'text', autocomplete: f.autocomplete || 'off',
        inputmode: f.inputmode, maxlength: '120', placeholder: f.placeholder,
        required: f.required ? true : null, 'aria-required': f.required ? 'true' : null
      });
      input.value = state.lead[f.id] || '';
      inputs[f.id] = input;
      return [
        h('label', { for: id }, [f.label, f.required ? h('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }) : null]),
        input
      ];
    });
    var fail = function (text, input) {
      msg.textContent = text;
      msg.className = 'form-msg small warn';
      if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
    };
    var form = h('form', {
      class: 'lead-form', novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        var values = {};
        var bad = null;
        t.fields.forEach(function (f) {
          var input = inputs[f.id];
          input.removeAttribute('aria-invalid');
          values[f.id] = input.value.trim();
          if (bad) return;
          if (f.required && !values[f.id]) bad = [fmt(t.errors.required, { label: f.label }), input];
          else if (f.type === 'email' && values[f.id] && !EMAIL_RE.test(values[f.id])) bad = [t.errors.email, input];
        });
        if (bad) return fail(bad[0], bad[1]);
        state.lead = values;
        sendWebhook('lead');
        msg.textContent = t.done;
        msg.className = 'form-msg small accent';
      }
    }, [
      rows,
      h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: t.submit }),
      h('p', { class: 'muted small', text: t.privacy }),
      msg
    ]);
    return h('section', { class: 'card card-lead' }, [
      h('p', { class: 'kicker', text: t.kicker }),
      h('h2', { class: 'card-title', text: t.title }),
      h('p', { class: 'muted small', text: t.desc }),
      form
    ]);
  }

  /* ---------- webhook ---------- */

  function payload(event) {
    var res = state.result;
    var ctx = DATA.contextQuestions;
    var pick = function (qi, id) {
      var i = state.context[id];
      return i === undefined || i === null ? '' : ctx[qi].options[i];
    };
    return {
      goal: pick(0, 'goal'),
      whyNow: pick(1, 'whyNow'),
      scores: res.scores,
      percent: res.percent,
      topResistance: res.top,
      commitment: state.commitment || 0,
      reasonNot10: state.reasonNot10,
      ig: state.lead.ig || '',
      email: state.lead.email || '',
      line: state.lead.line || '',
      resultUrl: location.href,
      topResistanceName: DATA.resistances[res.top].name,
      completedAt: state.completedAt,
      sessionId: state.sessionId,
      event: event,
      ctaBranch: state.commitment ? ctaBranch(DATA, state.commitment) : '',
      isLow: res.isLow
    };
  }

  function sendWebhook(event) {
    var url = DATA.config.webhookUrl;
    if (!url || !state || !state.result) return;
    var body = JSON.stringify(payload(event));
    var opts = DATA.config.webhookMode === 'json'
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }
      : { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, keepalive: true };
    try { fetch(url, opts).catch(function () {}); } catch (e) { /* never block the UI */ }
  }

  /* ---------- hash ---------- */

  function setHash(str) {
    var url = location.pathname + location.search + (str ? '#' + str : '');
    history.replaceState(null, '', url);
  }

  function restoreFromHash() {
    var d = decodeHash(DATA, location.hash);
    if (!d) return false;
    state = newState();
    state.result = evaluate(DATA, d.scores, d.impact);
    state.commitment = d.commitment;
    if (d.goal !== null) state.context.goal = d.goal;
    if (d.whyNow !== null) state.context.whyNow = d.whyNow;
    state.completedAt = new Date().toISOString();
    state.restored = true;
    renderResult();
    return true;
  }

  /* ---------- helpers ---------- */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function round1(n) { return Math.round(n * 10) / 10; }

  /* ---------- keyboard: 1..9 picks an option ---------- */

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (!app.querySelector('.question')) return;
    var n = Number(e.key);
    if (!n) return;
    var btn = app.querySelectorAll('.question .opt')[n - 1];
    if (btn) btn.click();
  });

  /* ---------- background audio ---------- */

  var audio = { el: null, btn: null, on: false };

  function initAudio() {
    var cfg = DATA.config.audio;
    if (!cfg || !cfg.src) return;
    audio.el = new Audio(cfg.src);
    audio.el.loop = cfg.loop !== false;
    audio.el.volume = typeof cfg.volume === 'number' ? cfg.volume : 0.35;
    audio.el.preload = 'none';
    audio.el.addEventListener('error', removeAudio);

    var bars = h('span', { class: 'audio-bars', 'aria-hidden': 'true' }, [h('i'), h('i'), h('i')]);
    audio.btn = h('button', {
      class: 'audio-toggle', type: 'button', 'aria-pressed': 'false', 'aria-label': cfg.labelOff,
      onclick: function () { setAudio(!audio.on, true); }
    }, [bars, h('span', { class: 'audio-label', text: cfg.short })]);
    document.body.appendChild(audio.btn);

    // Hide the control when the track is missing (for example before a licensed file is added).
    fetch(cfg.src, { method: 'HEAD' })
      .then(function (r) { if (!r.ok) removeAudio(); })
      .catch(removeAudio);
  }

  function removeAudio() {
    if (audio.btn && audio.btn.parentNode) audio.btn.parentNode.removeChild(audio.btn);
    audio.el = null;
    audio.btn = null;
    audio.on = false;
  }

  // Playback needs a user gesture, so this is only ever called from a click.
  function setAudio(on, explicit) {
    if (!audio.el) return;
    var cfg = DATA.config.audio;
    if (on) {
      var p = audio.el.play();
      if (p && p.catch) p.catch(function () { if (!explicit) setAudio(false); });
    } else {
      audio.el.pause();
    }
    audio.on = on;
    audio.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    audio.btn.setAttribute('aria-label', on ? cfg.labelOn : cfg.labelOff);
  }

  /* ---------- boot ---------- */

  function applyMeta() {
    document.title = DATA.meta.title;
    var m = document.querySelector('meta[name="description"]');
    if (m) m.setAttribute('content', DATA.meta.description);
  }

  fetch('data.json')
    .then(function (r) { return r.json(); })
    .then(function (json) {
      DATA = json;
      applyMeta();
      initAudio();
      if (!restoreFromHash()) renderIntro();
      window.addEventListener('hashchange', function () {
        if (!restoreFromHash()) renderIntro();
      });
    })
    .catch(function (err) {
      app.textContent = 'data.json load failed: ' + err.message;
    });

  root.ResistanceMap = Logic;
})(typeof window !== 'undefined' ? window : globalThis);
