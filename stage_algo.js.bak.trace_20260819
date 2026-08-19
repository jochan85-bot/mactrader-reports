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

function _naBase(flag) {
  return {
    stage: "NA", stage_sub: null, stage2_start_date: null, stage2_elapsed_years: null,
    cycle_type: null, base_count: null, censored: false, start_context_na: false,
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

function computeStageCore(hist, rsScore, P) {
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
            inCorrection = false;
            corrStartIdx = null;
            corrPeak = null;
            corrLow = null;
            prevBaseLow = null;
          }
          // else: continuation — 앵커·베이스카운트·조정추적 전부 보존
        }
        if (newState === "St4") {
          st4SinceSt2Exit = true;
          cycleAnchorIdx = null;
          cycleAnchorContextNa = false;
        }
      }
    }

    if (cycleAnchorIdx !== null) {
      const cClose = closes[i];
      const cLow = lows[i];

      if (cyclePeak === null || cClose > cyclePeak) {
        cyclePeak = cClose;

        if (inCorrection && corrStartIdx !== null) {
          const corrDays = i - corrStartIdx;
          if (corrPeak !== null && corrLow !== null && corrDays >= P.BASE_CORR_DAYS_MIN) {
            const depth = (corrLow - corrPeak) / corrPeak;
            if (depth <= -P.BASE_CORR_DEPTH_THR) {
              if (prevBaseLow !== null && corrLow < prevBaseLow) baseCount = 1;
              else baseCount += 1;
              prevBaseLow = corrLow;
            }
          }
          inCorrection = false;
          corrStartIdx = null;
          corrPeak = null;
          corrLow = null;
        }
      }

      if (cyclePeak !== null) {
        const drawdown = (cClose - cyclePeak) / cyclePeak;
        if (!inCorrection && drawdown <= -P.BASE_CORR_DEPTH_THR) {
          inCorrection = true;
          corrStartIdx = i;
          corrPeak = cyclePeak;
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

  if (sub === "early2") return inner ? `Stage2e (${inner})` : "Stage2e";
  return inner ? `Stage2 (${inner})` : "Stage2";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeStage, stageDisplayText, smaSeries, rawSignal, checkTT, determineCycleType };
}
