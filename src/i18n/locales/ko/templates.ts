// docs/localization.md §L3.3 — Templates & modules slice of the `ko` catalog.
// `satisfies Record<TemplatesKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/templates`. Merged in `./index.ts`.

import type { TemplatesKey } from '../en/templates'

const templates = {
  'templates.button': '템플릿 ▾',
  'templates.menuLabel': '템플릿',
  'templates.equilibrium.name': '균형 잡힌 생산 라인',
  'templates.equilibrium.blurb': '원료가 들어오고, 생산이 가공과 폐기로 나뉘며, 완제품이 출하됩니다. 재생해 보세요 — 원료 재고와 완제품 재고가 몇 단계 만에 안정되고 타임라인이 평평하게 유지됩니다.',
  'templates.deadlock.name': '용량 교착',
  'templates.deadlock.blurb': '같은 라인에서 출하 단계가 없어 완제품이 빠져나갈 곳이 없습니다. 재생해 보세요 — 완제품 재고가 용량까지 차고, 원료 재고가 천장까지 역류하며, 공급이 0으로 조여지고 라인 전체가 멈춥니다.',
  'templates.mmoProgression.name': '초반 MMO 성장 (1–15레벨)',
  'templates.mmoProgression.blurb': '서로 연결된 플레이 경제: 세 개의 지역 구간(1–5 / 5–10 / 10–15), 승리·비치명적 실패·사망으로 갈리는 확률 전투, 분류된 전리품, 수리와 재보급 비용이 드는 골드 경제, 그리고 레벨마다 오르는 XP 곡선. 실행하거나 몬테카를로로 돌려 15레벨 도달 시간이 얼마나 퍼지는지 확인하세요.',
  'templates.coffeeRoastery.name': '커피 로스터리 운영 흐름',
  'templates.coffeeRoastery.blurb': '로스팅·판매·재고의 관계를 단순화해 살펴보는 운영 흐름 시뮬레이션: 생두가 입고되고, 일부는 납품으로 나가며, 나머지는 로스팅해 카페·온라인·리테일로 판매됩니다. 하루 운영 값 다섯 개를 바꾸며 재고 궤적과 예상 지표가 어떻게 움직이는지 살펴보세요. 단순화한 시뮬레이션 예제이며 ERP나 실시간 모니터링 시스템이 아닙니다.',
  'templates.replace.title': '현재 다이어그램을 교체할까요?',
  'templates.replace.body': '“{name}”을(를) 불러오면 지금 캔버스에 있는 내용이 대체됩니다.',
  'templates.replace.confirm': '템플릿 불러오기',
  'modules.button': '모듈 삽입 ▾',
  'modules.menuLabel': '모듈 삽입',
  'modules.fromFile': '파일에서…',
  'modules.extract': '선택 항목을 모듈로 내보내기…',
  'modules.bufferedStep.name': '버퍼가 있는 생산 단계',
  'modules.bufferedStep.blurb': '공급이 인박스 풀로 들어가고, 인테이크 게이트가 2→1 변환기와 폐기 드레인으로 나눈 뒤, 아웃박스 풀에서 출하됩니다. 시스템 내 수량과 계획 생산량을 보여주는 레지스터가 함께 있습니다.',
  'modules.rewardSplit.name': '보상 분배 루프',
  'modules.rewardSplit.blurb': '활동이 지갑을 채우고, 배분 게이트가 2:1로 지출과 저축으로 나눕니다. 저축은 인출로 빠져나가며, 두 레지스터가 순자산과 목표 대비 진행도를 추적합니다.',
  'modules.error.title': '모듈을 삽입할 수 없습니다',
  'modules.promote.title': '파라미터 기반(v2) 모델로 전환할까요?',
  'modules.promote.body': '이 블록을 삽입하면 문서가 v2 모델이 되고 모델 시맨틱스 다이제스트가 변경됩니다. 실행 취소 한 번으로 모델 전환과 삽입을 함께 되돌릴 수 있습니다.',
  'modules.promote.confirm': '전환하고 삽입',
  'modules.frames.title': '저장된 프레임은 포함되지 않습니다',
  'modules.frames.insertBody': '이 파일에는 저장된 그룹 프레임이 있습니다. 모듈로 삽입해도 프레임은 그래프로 들어오지 않으며, 나머지는 평소대로 삽입됩니다.',
  'modules.frames.extractBody': '현재 그래프에는 저장된 그룹 프레임이 있습니다. 프레임은 모듈 파일에 기록되지 않으며, 선택한 노드와 그 내부 연결만 포함됩니다.',
  'modules.frames.continue': '계속',
} satisfies Record<TemplatesKey, string>

export default templates
