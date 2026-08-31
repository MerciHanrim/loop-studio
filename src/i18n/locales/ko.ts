// docs/localization.md §L3.3 — `satisfies MessageCatalog` makes `tsc` fail on a
// missing OR an extra key against `en.ts`. Same `{name}` slots as `en`; no
// concatenation, no rich-text tags.

import type { MessageCatalog } from './en'

const ko = {
  // ── 툴바 / 브랜드 ─────────────────────────────────────────────────────
  'toolbar.preview': '미리보기',
  'toolbar.buildTitle': 'Loop Studio v{version} · 빌드 {sha}',

  'toolbar.node.pool': '풀',
  'toolbar.node.source': '소스',
  'toolbar.node.drain': '드레인',
  'toolbar.node.gate': '게이트',
  'toolbar.node.converter': '컨버터',
  'toolbar.node.end': '엔드',
  'toolbar.node.parameter': '파라미터',
  'toolbar.node.register': '레지스터',
  'toolbar.node.addTitle': '{name} 추가 — 캔버스로 끌어다 놓거나 클릭하세요',

  'toolbar.undo.title': '실행 취소 (Ctrl/Cmd+Z)',
  'toolbar.redo.title': '다시 실행 (Ctrl/Cmd+Shift+Z)',
  'toolbar.new': '새로 만들기',
  'toolbar.import': '가져오기',

  'toolbar.newGraph.title': '새 그래프를 시작할까요?',
  'toolbar.newGraph.body': '현재 그래프가 대체됩니다.',
  'toolbar.newGraph.confirm': '새 그래프',

  // ── 테마 토글 ────────────────────────────────────────────────────────
  'theme.rowLabel': '테마',
  'theme.title': '테마: 시스템 / 라이트 / 다크',
  'theme.auto': '◐ 자동',
  'theme.light': '☀ 라이트',
  'theme.dark': '☾ 다크',

  // ── 언어 선택 ────────────────────────────────────────────────────────
  'lang.rowLabel': '언어',
  'lang.title': '언어',

  // ── 재생 바 ─────────────────────────────────────────────────────────
  'playbar.reset.title': '0단계로 초기화',
  'playbar.step.title': '한 단계 진행',
  'playbar.play': '▶ 재생',
  'playbar.pause': '⏸ 일시정지',
  'playbar.replay': '⟳ 다시 재생',
  'playbar.step': '{n}단계',
  'playbar.stepEnded': '{n}단계 · 종료됨',
  'playbar.speed': '속도',
  'playbar.seed': '시드',
  'playbar.seed.title': '난수 시드 — 같은 시드는 실행을 재현하며, 바꾸면 다시 시작합니다',
  'playbar.mc': '몬테카를로',
  'playbar.mc.withNote': '몬테카를로 · {note}',
  'playbar.mc.title': '다이어그램을 여러 번 실행해 분포를 확인합니다',
  'playbar.mc.progress': '몬테카를로 {pct}%',
  'playbar.mc.progress.title': '몬테카를로 실행 중',
  'playbar.cancel': '취소',
  'playbar.timeline.show': '타임라인 표시',
  'playbar.timeline.hide': '타임라인 숨기기',
  'runbar.ariaLabel': '실행 컨트롤',
  'runbar.mc.cancel': 'MC {pct}% · 취소',
  'runbar.timeline': '타임라인',

  // ── 모바일 상단 바 ──────────────────────────────────────────────────
  'mobile.topbar.caption': '보기 및 실행 — 편집은 데스크톱에서',
  'mobile.more': '더 보기',

  // ── 재생 안내 — 접근성 라이브 리전 ─────────────────────────────────
  'a11y.playback.started': '재생 시작',
  'a11y.playback.endedAtStep': '{n}단계에서 종료됨',
  'a11y.playback.resetToZero': '0단계로 초기화됨',
  'a11y.playback.stepN': '{n}단계',
  'a11y.playback.pausedAtStep': '{n}단계에서 일시정지됨',
} satisfies MessageCatalog

export default ko
