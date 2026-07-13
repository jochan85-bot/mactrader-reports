"""국장 리포트 ☀️ 신선 주도주 관찰 태그 주입 v2 (HTML 패치 — 재생성 아님).
- ☀️ 아이콘만 (글자 없음), 위치 = .cright 등락률(cchg) 아래
- 카드에 data-fresh="true" → 섹터 탭에 "☀️ 신선주도주" 필터 추가
- 정렬·컷·점수·데이터 무영향. fresh_leader_tag.run(write=False)로 판정.
매번 .bak(pre_fresh)에서 복원 후 재적용 → 패치 누적 방지.
"""
import sys, os, re

WS = "/Users/joleechan/.openclaw/workspace"
sys.path.insert(0, WS)
import fresh_leader_tag  # noqa

TARGETS = [
    "/Users/joleechan/mactrader-reports/kr_sepa_vcp_latest.html",
    "/Users/joleechan/mactrader-reports/history/2026/07/kr_sepa_vcp_20260713.html",
]
BAK_SUFFIX = ".bak.pre_fresh_20260713"

CSS_ANCHOR = (
    ".sbadge{margin-top:4px;font-size:9px;font-weight:700;padding:1px 5px;"
    "border-radius:4px;background:#DCFCE7;color:#15803D;display:inline-block;}"
)
CSS_NEW = (
    CSS_ANCHOR +
    "\n.fresh-sun{font-size:19px;line-height:1;margin-top:3px;text-align:right;}"
    "\n.tab[data-filter=fresh]{color:#B45309;}"
)
SUN = '\n      <div class="fresh-sun">☀️</div>'

# JS: applyFilters okS 분기에 fresh 추가
JS_OLD = ("(curSector==='unicorn'&&c.dataset.unicorn==='true')||\n"
          "              (curSector!=='ai'&&curSector!=='unicorn'&&c.dataset.sector===curSector);")
JS_NEW = ("(curSector==='unicorn'&&c.dataset.unicorn==='true')||\n"
          "              (curSector==='fresh'&&c.dataset.fresh==='true')||\n"
          "              (curSector!=='ai'&&curSector!=='unicorn'&&curSector!=='fresh'&&c.dataset.sector===curSector);")


def fresh_tickers():
    res = fresh_leader_tag.run("KR", write=False)
    return {r["ticker"] for r in res["rows"] if r["fresh_leader"]}


def patch(path, fresh):
    bak = path + BAK_SUFFIX
    # 항상 pre_fresh 원본에서 시작 (누적 방지)
    src = bak if os.path.exists(bak) else path
    html = open(src, encoding="utf-8").read()

    # 1) CSS
    assert CSS_ANCHOR in html, "sbadge CSS 앵커 실패"
    html = html.replace(CSS_ANCHOR, CSS_NEW, 1)

    # 3) 카드별: data-fresh + ☀️ (카드 블록 단위 처리)
    parts = html.split('<div class="card"')
    tagged = []
    for i in range(1, len(parts)):
        block = '<div class="card"' + parts[i]
        # 이 블록의 티커
        m = re.search(r'<div class="tpill">([^<]+)</div>', block)
        tk = m.group(1) if m else None
        if tk in fresh:
            # 3a) 카드 여는 태그에 data-fresh
            block = re.sub(r'(<div class="card"[^>]*?)>',
                           r'\1 data-fresh="true">', block, count=1)
            # 3b) cchg 아래 ☀️
            block = re.sub(r'(<div class="cchg[^"]*">[^<]*</div>)',
                           r'\1' + SUN, block, count=1)
            tagged.append(tk)
        parts[i] = block[len('<div class="card"'):]
    html = ('<div class="card"'.join(parts))

    # 4) 섹터 탭 추가 (마지막 tab 뒤, vtabs 앞)
    n = len(tagged)
    fresh_tab = (f'<button class="tab" data-filter="fresh">☀️ 신선주도주 '
                 f'<span class="c">{n}</span></button>')
    anchor = '</button></div><div class="vtabs">'
    assert anchor in html, "탭 앵커 실패"
    html = html.replace(anchor, '</button>' + fresh_tab + '</div><div class="vtabs">', 1)

    # 5) 필터 JS
    assert JS_OLD in html, "JS 앵커 실패"
    html = html.replace(JS_OLD, JS_NEW, 1)

    open(path, "w", encoding="utf-8").write(html)
    print(f"  [OK] {os.path.basename(path)} — {n}개 태그: {sorted(tagged)}")
    return n


if __name__ == "__main__":
    fresh = fresh_tickers()
    print(f"fresh_leader KR 판정: {len(fresh)}종목 {sorted(fresh)}\n")
    for p in TARGETS:
        if os.path.exists(p):
            patch(p, fresh)
        else:
            print(f"  [MISS] {p}")
