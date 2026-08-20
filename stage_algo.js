/*
 * stage_algo.js — Stage(Weinstein 스테이지) 판정 알고리즘, stage_tag.py 1:1 이식.
 * 블록 STAGE-WEB-READER-1R (2026-08-19). 관찰·표시 전용 — 매매 로직 무접촉.
 *
 * 원본: ~/.openclaw/workspace/stage_tag.py (STAGE-TAG-WIRE-1 / ANCHOR-FIX-1N / WIRE-1F 반영본)
 * 상수는 이 파일에 하드코딩하지 않는다 — 호출측이 stage_params.json을 읽어 params로 주입.
 * 브라우저(stage_reader.html)와 Node(parity 테스트) 양쪽에서 동일하게 동작하도록
 * 전역 상태·DOM·모듈 시스템에 의존하지 않는 순수 함수로만 구성한다.
 *
 * hist 항목 형식: { date: "YYYYMMDD"|"YYYY-MM-DD", open, high, low, close, volume }
 * (과거 → 최근 순, 마지막 = 판정 기준 확정봉. stage_tag.py의 입력 계약과 동일)
 */

function smaSeries(closes, period) {
  const result = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += closes[k];
    result[i] = sum / period;
  }
  return result;
}

function rawSignal(i, closes, sma150, P) {
  const s = sma150[i];
  if (s == null || i < P.SMA150_RATE_DAYS) return null;
  const sAgo = sma150[i - P.SMA150_RATE_DAYS];
  if (sAgo == null || sAgo <= 0) return null;
  const rate = (s - sAgo) / sAgo;
  const c = closes[i];
  if (c > s && rate > P.SMA150_UP_THR) return "raw2";
  if (c < s && rate < P.SMA150_DN_THR) return "raw4";
  return "flat";
}

function firstLabelableIdx(closes, sma150, P) {
  for (let i = 0; i < closes.length; i++) {
    if (rawSignal(i, closes, sma150, P) !== null) return i;
  }
  return null;
}

function checkTT(i, closes, highs, lows, sma50, sma150, sma200, rsScore, P) {
  try {
    const c = closes[i], s50 = sma50[i], s150 = sma150[i], s200 = sma200[i];
    if (c == null || s50 == null || s150 == null || s200 == null) return false;
    if (!(c > s50 && s50 > s150 && s150 > s200)) return false;
    if (i < P.SMA200_RATE_DAYS) return false;
    const s200Ago = sma200[i - P.SMA200_RATE_DAYS];
    if (s200Ago == null || s200Ago <= 0) return false;
    if ((s200 - s200Ago) / s200Ago <= 0) return false;
    const wStart = Math.max(0, i - 252);
    let wHi = -Infinity, wLo = Infinity;
    for (let k = wStart; k <= i; k++) {
      if (highs[k] > wHi) wHi = highs[k];
      if (lows[k] < wLo) wLo = lows[k];
    }
    if (wHi <= 0 || wLo <= 0) return false;
    if (c < wLo * (1 + P.TT_52W_LOW_GAIN)) return false;
    if (c < wHi * (1 - P.TT_52W_HIGH_LOSS)) return false;
    if (rsScore != null && Number(rsScore) < P.TT_RS_MIN) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// ─── [STAGE-BASE-WIRE-1C 2026-08-19] 표시 구간 트리밍 (방식① 최장 채택) ────────
//   파이썬 stage_tag.py 의 _maximal_flat / _longest_run_below / _trim_segment 이식본.
//   ⚠️ 표시 전용 — baseCount·계수·리셋 판정에 일체 개입하지 않는다.
//   상수는 전부 stage_params.json(P) 에서 온다. 하드코딩 금지.
function maximalFlat(closes, bs, be, W) {
  const n = be - bs + 1;
  if (n <= 0) return [];
  const c = closes.slice(bs, be + 1);
  const res = [];
  let ePrev = -1;
  const maxd = [], mind = [];       // 단조 덱 (인덱스 저장, head 포인터로 popleft)
  let mh = 0, nh = 0;               // maxd/mind head
  let e = -1;
  for (let st = 0; st < n; st++) {
    if (e < st - 1) { e = st - 1; maxd.length = 0; mind.length = 0; mh = 0; nh = 0; }
    while (e + 1 < n) {
      const v = c[e + 1];
      while (maxd.length > mh && c[maxd[maxd.length - 1]] <= v) maxd.pop();
      while (mind.length > nh && c[mind[mind.length - 1]] >= v) mind.pop();
      maxd.push(e + 1); mind.push(e + 1);
      const lo = c[mind[nh]], hi = c[maxd[mh]];
      if (lo > 0 && (hi - lo) / lo <= W) { e += 1; }
      else {
        if (maxd.length > mh && maxd[maxd.length - 1] === e + 1) maxd.pop();
        if (mind.length > nh && mind[mind.length - 1] === e + 1) mind.pop();
        break;
      }
    }
    if (e >= st && e > ePrev) { res.push([bs + st, bs + e]); ePrev = e; }
    if (maxd.length > mh && maxd[mh] === st) mh += 1;
    if (mind.length > nh && mind[nh] === st) nh += 1;
  }
  return res;
}

function longestRunBelow(closes, s, e, thr) {
  let best = null, cs = null;
  for (let i = s; i <= e; i++) {
    if (closes[i] <= thr) {
      if (cs === null) cs = i;
      if (best === null || (i - cs) > (best[1] - best[0])) best = [cs, i];
    } else { cs = null; }
  }
  return best;
}

function segRangePct(closes, s, e) {
  const seg = closes.slice(s, e + 1);
  const lo = Math.min.apply(null, seg), hi = Math.max.apply(null, seg);
  return lo > 0 ? Math.round((hi - lo) / lo * 10000) / 100 : null;
}

function trimSegment(closes, s, e, P) {
  const lo = Math.min.apply(null, closes.slice(s, e + 1));
  const hi = closes[s];
  const cands = maximalFlat(closes, s, e, P.BASE_TRIM_RANGE_W);
  let cb = null;
  for (const t of cands) if (cb === null || (t[1] - t[0]) > (cb[1] - cb[0])) cb = t;
  const cc = (hi > lo)
    ? longestRunBelow(closes, s, e, lo + (hi - lo) * P.BASE_TRIM_HALF_FRAC)
    : null;
  const lb = cb === null ? 0 : cb[1] - cb[0] + 1;
  const lc = cc === null ? 0 : cc[1] - cc[0] + 1;
  const pick = (lb >= lc) ? "b" : "c";            // 동률 → (b) 우선
  const cand = (lb >= lc) ? cb : cc;
  if (cand === null || (cand[1] - cand[0] + 1) < P.BASE_TRIM_MIN_BARS) {
    return [s, e, "none"];                        // 트리밍 불가 → 원 구간
  }
  return [cand[0], cand[1], pick];
}

function _naBase(flag) {
  return {
    stage: "NA", stage_sub: null, stage2_start_date: null, stage2_elapsed_years: null,
    cycle_type: null, base_count: null, base_segments: [],
    censored: false, start_context_na: false,
    na_flag: flag,
  };
}

function determineCycleType(closes, sma150, n, st2StartIdx, censored, P) {
  if (st2StartIdx == null) return "continuation";
  if (censored) return "continuation";

  let confirmed = null, streakT = null, streakL = 0, hadSt4 = false;
  const lim = Math.min(st2StartIdx, n);
  for (let i = 0; i < lim; i++) {
    const raw = rawSignal(i, closes, sma150, P);
    let push;
    if (raw === null) push = null;
    else if (raw === "raw2") push = "raw2";
    else if (raw === "raw4") push = "raw4";
    else {
      if (confirmed === "St2") push = "raw3";
      else if (confirmed === "St4") push = "raw1";
      else push = null;
    }

    if (push !== null && push === streakT) streakL += 1;
    else { streakT = push; streakL = (push !== null) ? 1 : 0; }

    if (streakL >= P.CONFIRM_BARS && push !== null) {
      const m = { raw2: "St2", raw4: "St4", raw3: "St3", raw1: "St1" };
      const newS = m[push];
      if (newS !== confirmed) {
        confirmed = newS;
        if (newS === "St2") hadSt4 = false;
        if (newS === "St4") hadSt4 = true;
      }
    }
  }
  return hadSt4 ? "fresh" : "continuation";
}

// [STAGE-CHART-1 2026-08-19] trace 는 순수 계측 훅이다 — 판정에 쓰이는 어떤 변수도
//   읽거나 바꾸지 않고 기록만 한다. 계측판을 따로 복제하지 않고 이 함수 하나에
//   옵션 인자로 붙인 이유: 사본을 두면 두 경로가 나중에 갈라질 수 있기 때문.
//   trace 를 넘기지 않으면 기존 동작과 바이트 단위로 동일하다.
function computeStageCore(hist, rsScore, P, trace) {
  if (!hist || hist.length < P.MIN_BARS) {
    const n = hist ? hist.length : 0;
    return _naBase(`NA(이력부족:${n}/${P.MIN_BARS})`);
  }

  const closes = hist.map(b => Number(b.close));
  const highs  = hist.map(b => Number(b.high != null ? b.high : b.close));
  const lows   = hist.map(b => Number(b.low  != null ? b.low  : b.close));
  const dates  = hist.map(b => String(b.date || ""));
  const n = hist.length;

  const sma50  = smaSeries(closes, P.SMA_WINDOWS[0]);
  const sma150 = smaSeries(closes, P.SMA_WINDOWS[1]);
  const sma200 = smaSeries(closes, P.SMA_WINDOWS[2]);
  const firstLabelable = firstLabelableIdx(closes, sma150, P);

  if (trace) {
    trace.dates = dates; trace.closes = closes;
    trace.sma50 = sma50; trace.sma150 = sma150; trace.sma200 = sma200;
    trace.timeline = []; trace.baseEvents = []; trace.anchorEvents = [];
    trace.firstLabelable = firstLabelable;
  }

  let confirmed = null, streakType = null, streakStart = 0, streakLen = 0;
  let currentSt2StartIdx = null;
  let st4SinceSt2Exit = false; // eslint-disable-line no-unused-vars (원본 파이썬과 동일하게 보존, 읽기 전용)
  let cycleAnchorIdx = null;
  let cycleAnchorContextNa = false;

  let baseCount = 0;
  let cyclePeak = null;
  let inCorrection = false;
  let corrStartIdx = null;
  let corrPeak = null;
  let corrLow = null;
  let prevBaseLow = null;
  let cyclePeakIdx = null;      // [WIRE-1C]
  let corrPeakIdx = null;       // [WIRE-1C] 조정 시작 고점 인덱스 (표시 구간 시작점)
  const baseSegments = [];      // [WIRE-1C] 표시 전용 구간 목록

  for (let i = 0; i < n; i++) {
    const raw = rawSignal(i, closes, sma150, P);
    let push;
    if (raw === null) push = null;
    else if (raw === "raw2") push = "raw2";
    else if (raw === "raw4") push = "raw4";
    else {
      if (confirmed === "St2") push = "raw3";
      else if (confirmed === "St4") push = "raw1";
      else push = null;
    }

    if (push !== null && push === streakType) streakLen += 1;
    else { streakType = push; streakStart = i; streakLen = (push !== null) ? 1 : 0; }

    if (streakLen >= P.CONFIRM_BARS && push !== null) {
      const m = { raw2: "St2", raw4: "St4", raw3: "St3", raw1: "St1" };
      const newState = m[push];
      if (newState !== confirmed) {
        const oldState = confirmed;
        confirmed = newState;
        const retroactiveStart = streakStart;

        if (newState === "St2") {
          currentSt2StartIdx = retroactiveStart;
          st4SinceSt2Exit = false;

          if (cycleAnchorIdx === null) {
            cycleAnchorIdx = retroactiveStart;
            cycleAnchorContextNa = (oldState === null);
            baseCount = 1;
            cyclePeak = closes[i];
            cyclePeakIdx = i;
            inCorrection = false;
            corrStartIdx = null;
            corrPeak = null;
            corrLow = null;
            corrPeakIdx = null;
            prevBaseLow = null;
            // 앵커 확정 = B1 시작점. 베이스 이벤트 목록에는 안 들어오므로 별도 기록.
            if (trace) trace.anchorEvents.push({
              type: "set", idx: retroactiveStart, date: dates[retroactiveStart],
              contextNa: (oldState === null), confirmedAt: i, confirmedAtDate: dates[i],
            });
          }
          // else: continuation — 앵커·베이스카운트·조정추적 전부 보존
        }
        if (newState === "St4") {
          st4SinceSt2Exit = true;
          if (trace && cycleAnchorIdx !== null) trace.anchorEvents.push({
            type: "clear", idx: i, date: dates[i],
          });
          cycleAnchorIdx = null;
          cycleAnchorContextNa = false;
        }
      }
    }

    // 봉별 확정 상태 기록 (전이 처리 직후 = 파이썬 계측 프로토타입과 동일 지점)
    if (trace) trace.timeline.push(confirmed);

    if (cycleAnchorIdx !== null) {
      const cClose = closes[i];
      const cLow = lows[i];

      if (cyclePeak === null || cClose > cyclePeak) {
        cyclePeak = cClose;
        cyclePeakIdx = i;

        if (inCorrection && corrStartIdx !== null) {
          const corrDays = i - corrStartIdx;
          if (corrPeak !== null && corrLow !== null && corrDays >= P.BASE_CORR_DAYS_MIN) {
            const depth = (corrLow - corrPeak) / corrPeak;
            if (depth <= -P.BASE_CORR_DEPTH_THR) {
              // ── [STAGE-BASE-WIRE-1C] (가)안 계수 규칙 (파이썬 stage_tag.py 와 동일) ──
              //   ① |depth| > BASE_DEPTH_CAP → 계수하지 않고 리셋
              //   ② 언더컷 → 리셋 (기존 로직 유지, 상한 리셋과 병존)
              //   ③ 그 외 → +1
              //   리셋값은 P.BASE_RESET_FLOOR(=1). 0은 산출되지 않는다.
              const segS = (corrPeakIdx !== null) ? corrPeakIdx : corrStartIdx;
              const overCap = Math.abs(depth) > P.BASE_DEPTH_CAP;
              const wasReset = (prevBaseLow !== null && corrLow < prevBaseLow);
              let counted = true;
              if (overCap) { baseCount = P.BASE_RESET_FLOOR; counted = false; }
              else if (wasReset) { baseCount = P.BASE_RESET_FLOOR; }
              else { baseCount += 1; }
              prevBaseLow = corrLow;
              // 표시 구간 트리밍 — baseCount 에 무개입
              const tr3 = trimSegment(closes, segS, i, P);
              baseSegments.push({
                start_date: dates[tr3[0]], end_date: dates[tr3[1]],
                bars: tr3[1] - tr3[0] + 1,
                depth_pct: Math.round(depth * 10000) / 100,
                range_pct: segRangePct(closes, tr3[0], tr3[1]),
                picked: tr3[2], counted,
              });
              if (trace) trace.baseEvents.push({
                idx: i, date: dates[i], baseCount,
                corrStartIdx, corrStartDate: dates[corrStartIdx],
                corrDays, depthPct: Math.round(depth * 1000) / 10,
                undercutReset: wasReset && !overCap,
                depthOverCap: overCap, counted,
                segStartIdx: tr3[0], segEndIdx: tr3[1],
                segBars: tr3[1] - tr3[0] + 1, segPicked: tr3[2],
              });
            }
          }
          inCorrection = false;
          corrStartIdx = null;
          corrPeak = null;
          corrLow = null;
          corrPeakIdx = null;
        }
      }

      if (cyclePeak !== null) {
        const drawdown = (cClose - cyclePeak) / cyclePeak;
        if (!inCorrection && drawdown <= -P.BASE_CORR_DEPTH_THR) {
          inCorrection = true;
          corrStartIdx = i;
          corrPeak = cyclePeak;
          corrPeakIdx = cyclePeakIdx;   // [WIRE-1C] 표시 구간 시작점
          corrLow = cLow;
        } else if (inCorrection && cLow < corrLow) {
          corrLow = cLow;
        }
      }
    }
  }

  const stage = confirmed || "NA";
  if (stage === "NA") return _naBase("NA(상태미확정)");

  let stageSub = null;
  if (stage === "St2") {
    const tt = checkTT(n - 1, closes, highs, lows, sma50, sma150, sma200, rsScore, P);
    stageSub = tt ? "confirmed2" : "early2";
  }

  let stage2StartDate = null, stage2ElapsedYears = null, censored = false;

  if (stage === "St2" && cycleAnchorIdx !== null) {
    censored = (firstLabelable !== null && cycleAnchorIdx === firstLabelable);
    const dStr = dates[cycleAnchorIdx];
    if (dStr) {
      stage2StartDate = dStr;
      const lastD = dates[dates.length - 1];
      if (lastD) {
        try {
          const norm = s => s.slice(0, 10).replace(/-/g, "");
          const toDate = s => new Date(+s.slice(0,4), +s.slice(4,6) - 1, +s.slice(6,8));
          const d0 = toDate(norm(dStr));
          const d1 = toDate(norm(lastD));
          stage2ElapsedYears = Math.round(((d1 - d0) / 86400000 / 365.25) * 100) / 100;
        } catch (e) { /* 원본과 동일: 무시하고 null 유지 */ }
      }
    }
  }

  const startContextNa = (stage === "St2") ? Boolean(cycleAnchorContextNa) : false;

  let cycleType = null;
  if (stage === "St2") {
    if (startContextNa) cycleType = "NA";
    else cycleType = determineCycleType(closes, sma150, n, currentSt2StartIdx, censored, P);
  }

  return {
    stage,
    stage_sub: stageSub,
    stage2_start_date: stage2StartDate,
    stage2_elapsed_years: stage2ElapsedYears,
    cycle_type: cycleType,
    base_count: (stage === "St2") ? baseCount : null,
    base_segments: baseSegments,   // [WIRE-1C] 표시 전용
    censored,
    start_context_na: startContextNa,
    na_flag: null,
  };
}

function computeStage(hist, rsScore, P) {
  try {
    return computeStageCore(hist, rsScore, P);
  } catch (e) {
    return _naBase(`NA(예외:${e && e.name ? e.name : "Error"})`);
  }
}

// [STAGE-CHART-1] 차트용 — 판정 결과 + 봉별 타임라인/베이스 이벤트를 같이 반환.
//   result 는 computeStage() 와 동일해야 한다 (같은 코드 경로를 쓰므로 구조적으로 보장).
function computeStageTrace(hist, rsScore, P) {
  const trace = {};
  let result;
  try {
    result = computeStageCore(hist, rsScore, P, trace);
  } catch (e) {
    result = _naBase(`NA(예외:${e && e.name ? e.name : "Error"})`);
  }
  return { result, trace };
}

function stageDisplayText(result) {
  const stage = result.stage || "NA";
  if (stage !== "St2") {
    return (stage === "St1" || stage === "St3" || stage === "St4")
      ? "Stage" + stage.slice(2) : "Stage?";
  }
  const sub = result.stage_sub || "";
  const elap = result.stage2_elapsed_years;
  const bc = result.base_count;
  const cens = Boolean(result.censored);
  const ctxNa = Boolean(result.start_context_na);

  let elapS = "";
  if (elap != null) elapS = (cens ? "≥" : "") + elap.toFixed(2) + "yr";
  let bcS = "";
  if (bc != null) bcS = "B" + bc + ((cens || ctxNa) ? "+" : "");
  const inner = [elapS, bcS].filter(Boolean).join(", ");

  if (sub === "early2") return inner ? `Stage2u (${inner})` : "Stage2u";
  return inner ? `Stage2 (${inner})` : "Stage2";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeStage, computeStageTrace, stageDisplayText, smaSeries, rawSignal, checkTT, determineCycleType };
}
