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

  // ── wire enum OPTION 표시명 — <select>의 사람이 읽는 텍스트. <option value>는
  //    wire token 그대로, GraphDoc·digest 무변경 (docs/localization.md §L3.4).
  //    원본 데이터 fallback, 진단 코드, Canvas raw 상태 표시는 토큰 유지.
  'enum.activation.passive': '수동',
  'enum.activation.automatic': '자동',
  'enum.activation.onStart': '시작할 때',
  'enum.activation.interactive': '대화형',
  'enum.flowMode.pullAny': '아무 경로에서 당기기',
  'enum.flowMode.pullAll': '모든 경로에서 당기기',
  'enum.flowMode.pushAny': '아무 경로로 보내기',
  'enum.flowMode.pushAll': '모든 경로로 보내기',
  'enum.distribution.deterministic': '고정 비율',
  'enum.distribution.probabilistic': '확률',
  'enum.format.int': '정수',
  'enum.format.float': '실수',
  'enum.format.percent': '백분율',
  'enum.stateMode.trigger': '트리거',
  'enum.stateMode.activator': '액티베이터',
  'enum.stateMode.label': '레이블',

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

  // ═══ Slice 2b-1 — 작은 앱 chrome: Share · PWA 바 · 가져오기 · rev chip ═══

  'dialog.cancel': '취소',

  // ── Share (SEMANTICS-U.md §U7) ──
  'share.button': '공유',
  'share.button.title': '이 다이어그램을 여는 링크 복사',
  'share.disclosure.title': '공유 링크를 만들까요?',
  'share.disclosure.body':
    '링크에는 모든 이름표를 포함한 이 다이어그램 전체가 담깁니다 — 링크를 가진 사람은 누구나 다이어그램을 열고 편집할 수 있습니다. 서버에 올라가지는 않지만 링크 안에 들어 있어 브라우저 기록에 남고, 보낸 상대 모두가 볼 수 있습니다.',
  'share.disclosure.confirm': '링크 만들기',
  'share.tooLarge':
    '이 다이어그램은 공유 링크로 만들기에 너무 큽니다 ({size}, 한도 {cap}). 대신 Export ▾ → Graph JSON으로 파일을 공유하세요.',
  'share.noBase': '공유에 공개 주소가 설정되어 있지 않아 링크를 만들 수 없습니다. 신고해 주세요.',
  'share.panel.label': '공유 링크',
  'share.panel.copied': '링크를 클립보드에 복사했습니다.',
  'share.panel.copyThis': '이 링크를 복사하세요:',
  'share.panel.copyAgain': '다시 복사',
  'share.panel.copy': '복사',
  'share.panel.close': '닫기',

  // ── PWA 업데이트 바 (docs/pwa.md §P4.2) ──
  'pwa.text':
    'Loop Studio 새 버전이 준비되었습니다. 적용하면 앱이 다시 로드되고 현재 실행과 저장하지 않은 결과가 초기화됩니다. 다이어그램은 저장되어 있습니다.',
  'pwa.update': '업데이트',
  'pwa.dismiss': '나중에',
  'pwa.running.title': '실행이 진행 중입니다',
  'pwa.running.body': '업데이트를 적용하면 페이지가 다시 로드되고 현재 실행이 끝납니다. 그래도 적용할까요?',
  'pwa.running.confirm': '적용하고 다시 로드',

  // ── 부팅 알림 (SEMANTICS-R.md §R8) ──
  'bootNotice.dismiss': '닫기',
  'bootNotice.proposalReboot':
    '이 세션은 제안(proposal)을 편집하고 있었습니다. 만들어진 기준(base)이 이 기기에 저장되어 있지 않아 일반 그래프로 다시 열렸습니다 — 편집 내용은 유지됩니다. 검토하거나 다시 내보내려면 제안 파일을 다시 가져오세요.',

  // ── 리비전 칩 (SEMANTICS-R.md §R2 / §R8) ──
  'revChip.proposal': '제안',
  'revChip.rev': 'rev {id}',
  'revChip.title': '프로젝트 {project} · {role} {revision}',
  'revChip.titleDirty': '프로젝트 {project} · {role} {revision} · 이 리비전 이후 저장하지 않은 변경 있음',
  'revChip.unsaved': '저장하지 않은 변경',

  // ── 가져오기 교체 흐름 (Toolbar + MobileTopBar) ──
  'import.replace.title': '현재 다이어그램을 교체할까요?',
  'import.replace.body': '가져온 파일이 지금 캔버스에 있는 내용을 대체합니다.',
  'import.replace.confirm': '교체',
  'import.readError': '파일을 읽을 수 없습니다.',

  // ── React Flow 접근성 (<ReactFlow>의 `ariaLabelConfig`) ──
  'rf.controls.label': '캔버스 컨트롤',
  'rf.controls.zoomIn': '확대',
  'rf.controls.zoomOut': '축소',
  'rf.controls.fitView': '다이어그램을 화면에 맞추기',
  'rf.controls.interactive': '캔버스 편집 켜기/끄기',
  'rf.handle.label': '연결점',
  'rf.node.a11y': 'Enter나 Space로 이 노드를 선택합니다. Delete로 제거, Escape로 취소합니다.',
  'rf.node.a11yKeyboard':
    'Enter나 Space로 이 노드를 선택한 뒤 화살표 키로 이동합니다. Delete로 제거, Escape로 취소합니다.',
  'rf.edge.a11y': 'Enter나 Space로 이 연결을 선택합니다. Delete로 제거, Escape로 취소합니다.',

  // ═══ Slice 2b-2a — 템플릿 · 내보내기/워크스페이스 · 작성자 dialog ═══════

  // ── 모바일 더 보기 시트 행 ──
  'mobile.more.import': '파일 가져오기',
  'mobile.more.importSub': 'Graph 또는 Workspace JSON',

  // ── 템플릿 선택 ──────────────────────────────────────────────────────
  'templates.button': '템플릿 ▾',
  'templates.menuLabel': '템플릿',
  'templates.equilibrium.name': '균형 잡힌 흐름',
  'templates.equilibrium.blurb':
    '소스가 보관함을 채우고, 게이트가 2:1로 정제기와 드레인에 나눠 보내며, 두 번째 드레인이 제품을 빼냅니다. 정상 상태(보관함 3, 제품 1)로 수렴합니다.',
  'templates.deadlock.name': '병목 교착',
  'templates.deadlock.blurb':
    '같은 시스템에서 제품 풀에 출구가 없는 경우. 용량까지 차오르면 게이트가 멈추고 보관함이 역류하며 소스가 0으로 조여집니다 — 안정적으로 얼어붙은 상태.',
  'templates.replace.title': '현재 다이어그램을 교체할까요?',
  'templates.replace.body': '“{name}”을(를) 불러오면 지금 캔버스에 있는 내용이 대체됩니다.',
  'templates.replace.confirm': '템플릿 불러오기',

  // ── 내보내기 메뉴 (§W8) ──
  'export.button': '내보내기 ▾',
  'export.menuLabel': '내보내기',
  'export.graphJson.name': '그래프 JSON',
  'export.graphJson.blurb': '다이어그램 + 권장 실행 설정',
  'export.workspaceJson.name': '워크스페이스 JSON',
  'export.workspaceJson.blurb': '그래프 + 분포 + 보기 + 실시간 실행',
  'export.projectRevision.name': '프로젝트 리비전',
  'export.projectRevision.blurb': '다이어그램 + 프로젝트 id·계보, 오프라인 협업용',
  'export.proposal.name': '제안 만들기',
  'export.proposal.blurb': '편집해서 돌려보낼 사본',
  'export.proposal.needRevision': '먼저 Project revision을 내보내세요',
  'export.author.name': '내보내기 작성자…',
  'export.author.blurb': '기기 로컬 이름표를 파일에 검증 없이 첨부',

  // ── Project revision 고지 → ConfirmDialog (SEMANTICS-R.md §R2.1) ──
  'export.projectRevision.disclosure.title': 'Project revision을 내보낼까요?',
  'export.projectRevision.disclosure.body':
    '이 파일은 일반 Graph JSON에 프로젝트 식별자와 이 리비전의 계보를 함께 담아, 협업자가 완전히 오프라인에서 변경을 비교하고 적용할 수 있게 합니다. 계정도 서버도 없이 모든 것이 파일 안에서 이동합니다.',
  'export.projectRevision.disclosure.confirm': '리비전 내보내기',

  // ── Workspace JSON 요약 → ConfirmDialog (§W4) ──
  'export.workspace.title': '이 워크스페이스를 저장할까요?',
  'export.workspace.included': '포함: {items}.',
  'export.workspace.excluded': '미포함: 실행 취소 기록, 선택, 테마.',
  'export.workspace.confirm': '워크스페이스 저장',
  'export.workspace.item.runConfig': '실행 설정',
  'export.workspace.item.distribution': '{runs}회 실행 분포',
  'export.workspace.item.timeline': '타임라인 보기',
  'export.workspace.item.canvas': '캔버스 위치',
  'export.workspace.item.liveRun': '{step}단계의 실시간 실행',
  'export.workspace.omit.body':
    '분포를 포함하면 {full}이(가) 되어 {limit} 한도를 넘습니다. 분포 없이 저장할까요 ({lean})?',
  'export.workspace.omit.confirm': '분포 없이 저장',
  'export.workspace.reject':
    '이 워크스페이스는 {size}로, 분포를 빼도 {limit} 한도를 넘습니다. 그래프를 줄이거나 Graph JSON을 사용하세요.',

  // ── 내보내기 작성자 dialog (SEMANTICS-R.md §R8) ──
  'author.title': '내보내기 작성자',
  'author.name': '이름',
  'author.namePlaceholder': '예: Alex',
  'author.note': '메모 (선택)',
  'author.notePlaceholder': '파일과 함께 이동하는 짧은 메시지',
  'author.disclosure':
    '이 이름은 이 기기에만 저장됩니다. 내보내는 모든 Project revision과 제안에 검증 없이 첨부되어 보내는 파일 안에서 함께 이동하므로, 받는 사람 누구나 읽을 수 있습니다. 누구나 편집할 수 있으니 신원이 아니라 이름표로 여기세요.',
  'author.save': '저장',

  // ═══ Slice 2b-2b — 몬테카를로 dialog · 제안 검토 ════════════════════════
  // UI chrome(제목/버튼/설명/빈 상태/접근성 이름)만. diff hunk 내용, 필드 값,
  // 통계, 리비전 id는 원문 그대로.

  // ── 몬테카를로 설정 dialog ──
  'mc.title': '몬테카를로',
  'mc.close': '닫기',
  'mc.closeKeepRunning': '닫기 (계속 실행)',
  'mc.field.runs': '실행 횟수',
  'mc.field.steps': '단계 수',
  'mc.field.baseSeed': '기본 시드',
  'mc.pools.head': '추적 대상 풀',
  'mc.pools.headAll': '추적 대상 · 모든 풀',
  'mc.pools.headSome': '추적 대상 · {total}개 중 {n}개',
  'mc.pools.selectAll': '모두 선택',
  'mc.pools.none': '그래프에 풀이 없습니다 — 실행하려면 하나 추가하세요.',
  'mc.pools.group': '추적 대상 풀',
  'mc.pools.keepOne': '최소 하나의 풀은 추적해야 합니다.',
  'mc.cost.estimating': '추정 중…',
  'mc.cost.measured': '측정값(최근 실행)',
  'mc.cost.benchmark': '로컬 기준 성능',
  'mc.cost.execution': '실행 방식',
  'mc.cost.parallel': '병렬 · 워커 {workers}개',
  'mc.cost.localPause': '로컬 · 잠깐 멈출 수 있음',
  'mc.cost.local': '로컬',
  'mc.cost.memory': '메모리',
  'mc.cost.overLimit': ' — 한도 초과, 실행 횟수 / 단계를 줄이세요',
  'mc.run': '{runs}회 실행',
  'mc.cancel': '취소',

  // ── 제안 검토 (SEMANTICS-R.md §R7 / §R7A / §R10.5) ──
  'review.title': '제안 검토',
  'review.close': '닫기',
  'review.byPrefix': '제안자',
  'review.byAnon': '제안',
  'review.unverified': '· 미검증',
  'review.fileSays': '파일 기록: {stamp}',
  'review.differentProject': '지금 열려 있는 것과 프로젝트 id가 다릅니다.',
  'review.diff.none': '그래프 변경 없음.',
  'review.diff.nodes': '노드',
  'review.diff.edges': '엣지',
  'review.diff.runConfig': '실행 설정',
  'review.gate.wrongProject':
    '이 제안은 다른 프로젝트의 것입니다. 문서로는 열 수 있습니다.',
  'review.gate.noTarget': '열려 있는 프로젝트가 없습니다. 이 제안을 문서로 열거나 취소하세요.',
  'review.gate.targetIsProposal':
    '현재 제안이 열려 있습니다. 다른 제안을 적용하려면 먼저 이 제안을 Project revision으로 내보내세요.',
  'review.class.exact': '열려 있는 리비전이 이 제안이 만들어진 기준과 정확히 일치합니다.',
  'review.class.divergent':
    '열려 있는 리비전에 이 제안과 겹치는 변경이 있습니다. 제안 전체를 적용하면 그 변경이 사라집니다.',
  'review.class.unknown':
    '열려 있는 리비전에 변경이 있고, 두 파일의 관계를 증명할 수 없습니다. 필드 충돌은 없습니다.',
  'review.confirm.default':
    '이 제안은 이전 리비전에서 만들어졌습니다. 제안 전체를 적용하면 그래프가 제안의 버전으로 대체되어 그 이후의 변경이 사라집니다. 실행 취소로 되돌릴 수 있습니다.',
  'review.confirm.unknown':
    '이 제안은 이전 리비전에서 만들어졌고, 두 파일의 관계를 판단할 수 없습니다. 제안 전체를 적용하면 그래프가 제안의 버전으로 대체되어 그 이후의 변경이 사라집니다. 실행 취소로 되돌릴 수 있습니다.',
  'review.err.targetMoved': '확인한 이후 문서가 바뀌었습니다 — 변경을 검토하고 다시 적용하세요.',
  'review.err.targetMovedList':
    '선택하는 동안 문서가 바뀌었습니다 — 아래 목록이 갱신되었습니다. 검토 후 다시 적용하세요.',
  'review.err.noEffect': '그 선택은 아무것도 바꾸지 않습니다 — 적용할 것이 없습니다.',
  'review.err.generic': '적용할 수 없음 ({reason}).',
  'review.fail.wrongProject': '이 제안은 다른 프로젝트의 것입니다.',
  'review.fail.noTarget': '적용할 대상 프로젝트가 열려 있지 않습니다.',
  'review.fail.targetIsProposal': '먼저 열린 제안을 Project revision으로 내보내세요.',
  'review.fail.payloadInvalid': '이 제안 파일이 무결성 검사에 실패했습니다 — 다시 가져오세요.',
  'review.fail.invalidSelection':
    '그 선택은 적용할 수 없습니다 — 수락한 엣지에 포함하지 않은 노드가 필요합니다. 선택을 조정한 뒤 다시 시도하세요.',
  'review.hunk.add': '추가',
  'review.hunk.remove': '제거',
  'review.hunk.change': '변경',
  'review.hunk.bothChanged': ' · 양쪽이 함께 바꿈',
  'review.hunk.youDeleted': ' · 내가 삭제함',
  'review.hunk.alsoRemove': '다음 엣지도 제거하거나 다시 연결:',
  'review.hunk.cantRemove': '제거 불가 — 내가 추가한 엣지',
  'review.hunk.toThisNode': '— 이 노드로',
  'review.field.base': '기준',
  'review.field.yours': '내 것',
  'review.field.theirs': '상대 것',
  'review.field.takeTheirs': '상대 것 사용',
  'review.field.keepMine': '내 것 유지',
  'review.action.applyAnyway': '무시하고 적용',
  'review.action.applyProposal': '제안 적용',
  'review.action.applySelected': '선택한 {count}개 적용',
  'review.action.chooseChanges': '변경 고르기',
  'review.action.wholeProposal': '제안 전체',
  'review.action.openAsDoc': '문서로 열기',
  'review.action.cancel': '취소',
  'review.foot.hunks':
    '대상과 고른 변경을 적용하면 새 로컬 리비전이 만들어집니다 (부모 {parent}). 실행 취소 한 번으로 되돌립니다. 파일에는 아무것도 기록되지 않습니다.',
  'review.foot.whole':
    '적용하면 새 로컬 리비전이 만들어집니다 (부모 {parent}). 실행 취소 한 번으로 되돌립니다. 파일에는 아무것도 기록되지 않습니다.',
} satisfies MessageCatalog

export default ko
