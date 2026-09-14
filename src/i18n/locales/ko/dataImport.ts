// docs/data-import.md §DI16 Phase 1B — the CSV/TSV import wizard's `ko` slice.
// `satisfies Record<DataImportKey, string>` makes `tsc` fail on a missing or
// an extra key against `../en/dataImport`.

import type { DataImportKey } from '../en/dataImport'

const dataImport = {
  'import.button': '스프레드시트 데이터 ▾',
  'import.title': '스프레드시트 데이터 가져오기',
  'import.tableName': '테이블 이름',
  'import.removeTable': '테이블 제거',
  'import.addTable': '테이블 추가',
  'import.pastePlaceholder': 'CSV 또는 TSV 텍스트를 붙여넣으세요',
  'import.uploadFile': '파일 업로드…',
  'import.delimiter': '구분자',
  'import.delimiterAuto': '자동 감지',
  'import.delimiterComma': '쉼표',
  'import.delimiterTab': '탭',
  'import.headerRow': '헤더 행',
  'import.ignoreLastRows': '마지막 N행 무시',
  'import.parseError': '유효한 CSV/TSV가 아닙니다: {line}행 {column}열에서 {kind}.',
  'import.role.ignored': '무시',
  'import.role.key': '키',
  'import.role.number': '숫자',
  'import.role.label': '라벨',
  'import.role.foreignKey': '외래 키',
  'import.selectTable': '테이블 선택…',
  'import.selectColumn': '컬럼 선택…',
  'import.selectFrame': '프레임 선택…',
  'import.groupBy': '프레임 그룹 기준:',
  'import.errorsFound': '{n, plural, other {계속하기 전에 해결해야 할 문제가 #개 있습니다:}}',
  'import.warningsFound': '{n, plural, other {#개 행은 라벨에 이름 대신 원본 키를 사용합니다.}}',
  'import.placement.none': '프레임 없이 캔버스에 배치',
  'import.placement.framePerTable': '테이블당 프레임 하나',
  'import.placement.existingFrame': '기존 프레임에 추가',
  'import.summary': '{tables, plural, other {테이블 #개}}를 가져와 {parameters, plural, other {파라미터 #개}}를 생성합니다.',
  'import.next': '다음',
  'import.back': '이전',
  'import.commit': '가져오기',
} satisfies Record<DataImportKey, string>

export default dataImport
