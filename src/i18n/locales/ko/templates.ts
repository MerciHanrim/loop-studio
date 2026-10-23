// docs/localization.md §L3.3 — Templates & modules slice of the `ko` catalog.
// `satisfies Record<TemplatesKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/templates`. Merged in `./index.ts`.

import type { TemplatesKey } from '../en/templates'

const templates = {
  'templates.button': '템플릿',
  'templates.menuLabel': '템플릿',
  'templates.equilibrium.name': '균형 잡힌 생산 라인',
  'templates.equilibrium.blurb': '원료 투입부터 가공, 폐기, 출하까지 이어지며 몇 단계 만에 안정됩니다.',
  'templates.deadlock.name': '용량 교착',
  'templates.deadlock.blurb': '출하 단계가 없어 재고가 용량까지 차고 라인 전체가 멈춥니다.',
  'templates.mmoProgression.name': '초반 MMO 성장 (1–15레벨)',
  'templates.mmoProgression.blurb': '세 지역의 퀘스트, 사냥, 보상으로 15레벨까지 걸리는 시간을 봅니다.',
  'templates.coffeeRoastery.name': '커피 로스터리 운영 흐름',
  'templates.coffeeRoastery.blurb': '로스팅한 원두의 판매, 재고, 비용이 어떻게 맞물리는지 살펴봅니다.',
  'templates.gachaGeneral.name': '일반 가챠',
  'templates.gachaGeneral.blurb': '천장 없는 배너 하나. 적중률은 목표 뽑기 횟수가 분모이고, 목표에 이르면 끝납니다.',
  'templates.gachaStandard.name': '상시 가챠',
  'templates.gachaStandard.blurb': '하드 천장이 있는 배너 하나. 천장에 이르면 다음 뽑기가 확정 SSR이 됩니다.',
  'templates.gachaPickup.name': '픽업 가챠',
  'templates.gachaPickup.blurb': '천장과 픽업 보장이 있는 배너 하나. 픽업 외 SSR 다음에 나오는 SSR은 픽업으로 확정됩니다.',
  'templates.gachaBannerZones.name': '3존 가챠 배너 비교',
  'templates.gachaBannerZones.blurb': '같은 예산으로 천장과 보장이 다른 세 배너를 비교합니다.',
  'templates.replace.title': '템플릿을 불러오시겠습니까?',
  'templates.replace.body': '현재 작업을 다음 템플릿으로 바꿉니다: {name}',
  'templates.replace.confirm': '템플릿 불러오기',
  'modules.insertSaved': '저장한 구조 삽입…',
  'modules.insertSaved.blurb': '저장해 둔 구조 파일을 지금 문서에 추가합니다.',
  'modules.extract': '선택한 구조 저장…',
  'modules.extract.blurb': '선택한 노드와 그 사이 연결을 파일로 저장합니다.',
  'modules.error.title': '구조를 삽입할 수 없습니다',
  'modules.promote.title': '파라미터 기반(v2) 모델로 전환할까요?',
  'modules.promote.body': '이 구조를 삽입하면 문서가 v2 모델이 되고 모델 시맨틱스 다이제스트가 변경됩니다. 실행 취소 한 번으로 모델 전환과 삽입을 함께 되돌릴 수 있습니다.',
  'modules.promote.confirm': '전환하고 삽입',
  'modules.frames.title': '저장된 프레임은 포함되지 않습니다',
  'modules.frames.insertBody': '이 파일에는 저장된 그룹 프레임이 있습니다. 구조로 삽입해도 프레임은 그래프로 들어오지 않으며, 나머지는 평소대로 삽입됩니다.',
  'modules.frames.extractBody': '현재 그래프에는 저장된 그룹 프레임이 있습니다. 프레임은 구조 파일에 기록되지 않으며, 선택한 노드와 그 내부 연결만 포함됩니다.',
  'modules.frames.continue': '계속',
} satisfies Record<TemplatesKey, string>

export default templates
