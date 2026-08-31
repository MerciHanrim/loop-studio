// docs/localization.md §L3.3 — `satisfies MessageCatalog` makes `tsc` fail on a
// missing OR an extra key against `en.ts`. Same `{name}` slots as `en`; no
// concatenation, no rich-text tags.

import type { MessageCatalog } from './en'

const ko = {
  // ── i18n 내부 ───────────────────────────────────────────────────────
  'i18n.messageError': '문구를 표시할 수 없음 ({key})',

  // ── 툴바 / 브랜드 ─────────────────────────────────────────────────────
  'toolbar.preview': '미리보기',
  'toolbar.buildTitle': 'Loop Studio v{version} · 빌드 {sha}',

  // ── 노드 팔레트 — 2단 설명 (이름 / 의미 / 추가 방법) ──────────────────
  'palette.pool.name': '풀',
  'palette.pool.description':
    '자원을 담아 두고 현재 수량을 표시합니다. 용량이 있으며 가득 차면 역압을 겁니다.',
  'palette.source.name': '소스',
  'palette.source.description': '매 단계 새 자원을 만들어 연결된 노드로 밀어 보냅니다.',
  'palette.drain.name': '드레인',
  'palette.drain.description': '연결된 노드에서 자원을 끌어와 시스템에서 제거합니다.',
  'palette.gate.name': '게이트',
  'palette.gate.description':
    '자원을 끌어와 고정 비율 또는 확률에 따라 나가는 연결들로 분배합니다. 아무것도 저장하지 않습니다.',
  'palette.converter.name': '컨버터',
  'palette.converter.description':
    '입력을 소비하고 자체 비율에 따라 출력을 생성합니다. 아무것도 저장하지 않습니다.',
  'palette.end.name': '엔드',
  'palette.end.description': '자원이 도달하는 순간 실행을 종료합니다.',
  'palette.parameter.name': '파라미터',
  'palette.parameter.description':
    '직접 조정하는 고정 숫자입니다. 포트가 없으며 표현식에서 id로 참조합니다.',
  'palette.register.name': '레지스터',
  'palette.register.description':
    '현재 단계에서 표현식으로 계산한 값을 표시합니다. 아무것도 저장하지 않고 포트도 없습니다.',
  'palette.addAction': '클릭하거나 캔버스로 끌어다 놓아 추가하세요.',

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

  // ── 언어 메뉴 ────────────────────────────────────────────────────────
  'lang.rowLabel': '언어',
  'lang.title': '언어',
  'lang.menuLabel': '언어 선택',
  'lang.loading': '불러오는 중…',

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

  // ═══ Slice 2a — 모델 작업 화면 ═══════════════════════════════════════════

  // ── 캔버스 ────────────────────────────────────────────────────────────
  'canvas.minimap': '그래프 미니맵',

  // ── 인스펙터 — 공통 ─────────────────────────────────────────────────
  'inspector.delete': '삭제',
  'inspector.field.label': '이름',
  'inspector.empty.title': '편집할 노드나 연결을 선택하세요.',
  'inspector.empty.hint':
    '상단 바에서 조각을 캔버스로 끌어다 놓은 뒤, 양쪽의 점 사이를 끌어 서로 연결하세요.',
  'inspector.unreadable.note':
    '이 노드의 데이터를 읽을 수 없습니다 ({detail}). 그대로 불러오되 모델에서는 제외됩니다 — 파일에서 고치거나 노드를 삭제하세요.',
  'inspector.unreadable.detailFallback': '데이터가 읽을 수 있는 객체가 아님',
  'inspector.field.rawData': '원본 데이터',

  // ── 인스펙터 — 노드 필드 ────────────────────────────────────────────
  'inspector.field.activation': '활성화',
  'inspector.node.endNote': '자원이 도달하는 순간 실행을 종료합니다.',
  'inspector.field.startingAmount': '시작 수량',
  'inspector.field.capacity': '용량 (비우면 무제한)',
  'inspector.field.flowMode': '흐름 모드',
  'inspector.field.distribution': '분배 방식',
  'inspector.field.value': '값',
  'inspector.field.unit': '단위 (참고용)',
  'inspector.field.min': '최소 (참고용)',
  'inspector.field.max': '최대 (참고용)',
  'inspector.field.step': '증분 (참고용)',
  'inspector.field.expression': '표현식',
  'inspector.field.format': '표시 형식 (참고용)',

  // ── 인스펙터 — 자원 유형 (참고용) ──────────────────────────────────
  'inspector.field.resourceType': '자원 유형 (참고용)',
  'inspector.resourceType.placeholder': 'Gold, Energy, XP, Player, Item 또는 직접 지은 이름',
  'inspector.resourceType.tooLong': '{max}바이트 초과 — 이 태그는 내보낼 때 제거됩니다.',
  'inspector.resourceType.normalised': '“{value}”(으)로 정규화됨.',
  'inspector.resourceType.custom': '사용자 정의 유형 — 기본 색상 없이 일반 견본으로 표시됩니다.',
  'inspector.resourceType.mismatch':
    '유형 불일치: {pairs}. 참고용일 뿐이며 어떤 수량도 바꾸지 않고 실행을 막지도 않습니다.',

  // ── 인스펙터 — 파라미터 ───────────────────────────────────────────
  'inspector.parameter.outOfRange': '값이 참고용 최소/최대 범위를 벗어났습니다 — 그대로 두며 잘라내지 않습니다.',
  'inspector.parameter.hintIncoherent': '참고용 힌트가 서로 맞지 않아 내보낼 때 제거됩니다.',
  'inspector.parameter.noPorts': '파라미터는 포트가 없습니다 — 표현식에서 id로 참조하세요.',

  // ── 인스펙터 — 레지스터 ───────────────────────────────────────────
  'inspector.register.canonical': '표준형: {canonical} (내보낼 때 저장됨)',
  'inspector.register.invalidAtStep': '{code} · {reason} — {step}단계에서 값 없음.',
  'inspector.register.valueAtStep': '{step}단계의 값: {value}',
  'inspector.register.recomputed': '(그래프에서 다시 계산됨 — 저장되지 않음)',
  'inspector.register.formatInvalid': '알 수 없는 형식 — 내보낼 때 float으로 되돌립니다.',
  'inspector.register.noStore': '레지스터는 아무것도 저장하지 않고 포트도 없습니다.',

  // ── 인스펙터 — 연결 ──────────────────────────────────────────────
  'inspector.edge.kindLink': '{kind} 연결',
  'inspector.field.type': '종류',
  'inspector.edge.type.resource': 'resource — 자원을 운반',
  'inspector.edge.type.state': 'state — 값을 읽어 대상을 변경',
  'inspector.field.flow': '흐름',
  'inspector.edge.flowPlaceholder': '1, all, 2D6, 1-3, 25%',
  'inspector.field.route': '경로',
  'inspector.edge.route.curved': '곡선',
  'inspector.edge.route.orthogonal': '직교',
  'inspector.edge.note':
    '연결을 편집하면 실행이 0단계에서 다시 시작되고 대기 중인 트리거가 지워집니다. 완료된 몬테카를로 결과는 오래된 것으로 표시됩니다.',

  // ── 인스펙터 — state 연결 ───────────────────────────────────────
  'inspector.field.mode': '모드',
  'inspector.edge.mode.trigger': 'trigger — 대상을 자극해 실행시킴',
  'inspector.edge.mode.activator': 'activator — 대상을 켜거나 끔',
  'inspector.edge.mode.label': 'label — 대상 풀에 더하거나 값을 설정',
  'inspector.field.delay': '지연 — 펄스가 전달되기까지의 단계 수',
  'inspector.delay.ok': '(fired + delay + 1)에 전달됩니다. 0은 다음 단계를 뜻합니다.',
  'inspector.delay.bad':
    '0 이상의 정수를 사용하세요 — 다른 값은 엔진이 0으로 실행하며 입력한 값은 그대로 둡니다.',
  'inspector.field.condition': '조건 — 소스와의 비교',
  'inspector.field.modifier': '변경 — 매 단계 적용되는 변화',
  'inspector.expr.activatorPlaceholder': '>= 5',
  'inspector.expr.labelPlaceholder': '+1   ·   -2   ·   =S',
  'inspector.stateExpr.noEffect': '{hint} — 파싱되기 전까지 이 연결은 아무 효과가 없습니다.',
  'inspector.activator.describe': '소스가 {op} {n}인 동안 대상이 켜집니다',
  'inspector.label.describe.set': '매 단계 대상 풀을 {amount}(으)로 설정합니다',
  'inspector.label.describe.add': '매 단계 대상 풀에 {amount}을(를) 더합니다',
  'inspector.label.describe.subtract': '매 단계 대상 풀에서 {amount}을(를) 뺍니다',
  'inspector.label.amountSource': '소스 풀의 값',
  'inspector.legacy.note':
    '지원되지 않는 연결입니다. 모드 {mode}은(는) 실행되지 않아 이 연결은 시뮬레이션에 영향을 주지 않습니다. Loop Studio는 자동으로 변환하지 않습니다. 무엇으로 바꿀지 고른 뒤 직접 변환하세요.',
  'inspector.legacy.convertTo': '변환 대상',
  'inspector.legacy.convertButton': '{mode}(으)로 변환',

  // ── stateExpr 힌트 — 구조화된 사유 → 인라인 편집기 안내문 (§L7) ──
  'stateExpr.activator.hint.empty': '비교를 입력하세요, 예: >= 5',
  'stateExpr.activator.hint.opOnly': '숫자를 더하세요, 예: >= 5',
  'stateExpr.activator.hint.notAComparison': '>= <= > < == != 뒤에 숫자를 쓰세요',
  'stateExpr.activator.hint.nonFinite': '숫자는 유한해야 합니다',
  'stateExpr.label.hint.empty': '변경을 입력하세요, 예: +1 또는 =S',
  'stateExpr.label.hint.notAnAssignment': '+ - 또는 = 뒤에 숫자나 S를 쓰세요',
  'stateExpr.label.hint.nonFinite': '숫자는 유한해야 합니다',

  // ── 타임라인 ─────────────────────────────────────────────────────
  'timeline.title': '타임라인',
  'timeline.view.live': '실시간',
  'timeline.view.distribution': '분포',
  'timeline.legend.hide': '{label} 숨기기',
  'timeline.legend.show': '{label} 표시',
  'timeline.legend.register': '레지스터 {label}',
  'timeline.csv': 'CSV',
  'timeline.csvTitle': '실행 결과를 CSV로 내려받기',
  'timeline.axis.step': '{n}단계',
  'timeline.sheetTitle': '타임라인',

  // ── 모바일 인스펙터 시트 ─────────────────────────────────────────
  'mobile.inspector.title': '인스펙터 — 읽기 전용',
  'mobile.inspector.roNote': '편집은 데스크톱에서 합니다. 여기는 읽기 전용 보기입니다.',

  // ── 노드 표면 — 읽을 수 없거나 무효인 모델 노드의 합성 표시 ──
  'node.unreadable.title': '읽을 수 없는 {kind}',
  'node.unreadable.sub': '데이터를 읽을 수 없음 — 파일에서 고치세요',
  'node.invalidFlag': '이 노드는 무효입니다',

  // ── 진단 — 안정적인 {code}에 대한 사용자 노출 안내문 (§L7) ──
  'error.unknownCode': '표현식이 올바르지 않습니다',
  'error.M_REG_PARSE.message': '표현식이 파싱되지 않습니다',
  'error.M_REG_EVAL.message': '표현식이 오류로 평가됩니다 (0으로 나눔 / 유한하지 않음)',
  'error.M_REG_UNKNOWN_REF.message': '참조가 그래프의 어떤 노드도 가리키지 않습니다',
  'error.M_REG_WRONG_KIND.message': '참조가 풀 / 파라미터 / 레지스터가 아닌 노드를 가리킵니다',
  'error.M_REG_INVALID_ID.message': '참조된 id에 사용할 수 없는 제어 문자가 있습니다',
  'error.M_REG_CYCLE.message': '이 레지스터가 의존성 순환에 있습니다',
  'error.M_REG_DEPENDS_ON_INVALID.message': '이 레지스터가 다른 무효한 레지스터에 의존합니다',
  'error.EXPR_EMPTY.message': '표현식이 비어 있습니다',
  'error.EXPR_SYNTAX.message': '{column}열에 구문 오류가 있습니다',
  'error.EXPR_UNCLOSED_PAREN.message': '{column}열의 “(”가 닫히지 않았습니다',
  // 리터럴 중괄호는 ICU 따옴표로 감쌈 ('{' / '}') — 패턴이 파싱되도록 (§L4.1)
  'error.EXPR_UNCLOSED_REF.message': "{column}열의 “@'{'”가 닫히지 않았습니다",
  'error.EXPR_BAD_ESCAPE.message': "{column}열의 “\\” 다음에는 “'}'” 또는 “\\”가 와야 합니다",
  'error.EXPR_NUMBER_RANGE.message': '{column}열의 숫자가 너무 큽니다',
  'error.EXPR_BAD_TOKEN.message': '{column}열에 불필요한 문자가 있습니다',
} satisfies MessageCatalog

export default ko
