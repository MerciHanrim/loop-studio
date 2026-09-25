// docs/localization.md §L3.3 — spreadsheet-import slice of the `th` catalog.
//
// PARSER POSITION vs TABLE COLUMN (§L2.11). `import.parseError` reports a
// CHARACTER offset into the pasted text, so it reads `ตำแหน่งอักขระ` — the
// same word the six `error.EXPR_*` keys use. A real spreadsheet column is
// `คอลัมน์` and appears only in `import.loc.*` and the column-role keys. The
// two groups are disjoint and `thCopy.test.ts` keeps them that way.
//
// PLURAL. Thai declares only `other`, so every plural block here carries one
// arm — including the three messages that hold two or three separate plurals.
//
// `“…”` wraps a runtime value, header or table name. `en` quotes some of these
// with straight ASCII quotes and others not at all; Thai quotes them all the
// same way, because without a delimiter a value runs into unspaced Thai text.

const dataImport = {
  'import.button': 'ข้อมูล ▾',
  'import.title': 'นำเข้าข้อมูลจากตาราง',
  'import.tableName': 'ชื่อตาราง',
  'import.removeTable': 'ลบตาราง',
  'import.addTable': 'เพิ่มอีกหนึ่งตาราง',
  'import.pastePlaceholder': 'วางข้อความ CSV หรือ TSV ที่นี่',
  'import.pasteAria': 'ข้อความ CSV หรือ TSV',
  'import.tableNameRequired': 'ใส่ชื่อตารางเพื่อไปต่อ',
  'import.pasteDataRequired': 'วางหรืออัปโหลดข้อมูล CSV/TSV เพื่อไปต่อ',
  'import.uploadFile': 'อัปโหลดไฟล์…',
  'import.delimiter': 'ตัวคั่น',
  'import.delimiterAuto': 'ตรวจหาอัตโนมัติ',
  'import.delimiterComma': 'จุลภาค',
  'import.delimiterTab': 'แท็บ',
  'import.headerRow': 'แถวหัวตาราง',
  'import.ignoreLastRows': 'ข้าม N แถวสุดท้าย',
  'import.parseError':
    'ข้อความนี้ไม่ใช่ CSV/TSV ที่ถูกต้อง: {kind} ที่บรรทัด {line} ตำแหน่งอักขระ {column}',
  'import.parseErrorKind.unterminated-quote': 'เครื่องหมายคำพูดที่ไม่ได้ปิด',
  'import.parseErrorKind.text-after-quote': 'ข้อความที่ไม่คาดคิดต่อท้ายเครื่องหมายคำพูดปิด',
  'import.parseErrorKind.quote-in-unquoted-field': 'เครื่องหมายคำพูดในช่องที่ไม่ได้ครอบคำพูด',
  'import.role.ignored': 'ข้าม',
  'import.role.key': 'คีย์',
  'import.role.number': 'ตัวเลข',
  'import.role.label': 'ป้ายกำกับ',
  'import.role.foreignKey': 'คีย์นอก',
  'import.roleAria': 'บทบาทของคอลัมน์ “{header}”',
  'import.selectTable': 'เลือกตาราง…',
  'import.selectColumn': 'เลือกคอลัมน์…',
  'import.selectFrame': 'เลือกกรอบ…',
  'import.groupBy': 'จัดกลุ่มกรอบตาม:',
  'import.warningsFound': '{n, plural, other {# แถวจะแสดงคีย์ดิบแทนชื่อในป้ายกำกับ}}',
  'import.parseErrorsBlockValidation': 'แก้ข้อผิดพลาด CSV/TSV ด้านบนก่อนไปต่อ',
  'import.placement.none': 'วางบนผืนผ้าใบ ไม่สร้างกรอบ',
  'import.placement.framePerTable': 'หนึ่งกรอบต่อหนึ่งตาราง',
  'import.placement.existingFrame': 'เพิ่มเข้ากรอบที่มีอยู่',
  'import.summary':
    'พร้อมนำเข้า {tables, plural, other {# ตาราง}} และจะสร้าง {parameters, plural, other {# พารามิเตอร์}}',
  'import.next': 'ถัดไป',
  'import.back': 'ย้อนกลับ',
  'import.commit': 'นำเข้า',
  'import.qs.title': 'เริ่มต้นอย่างรวดเร็ว',
  'import.qs.toggleAria': 'เริ่มต้นอย่างรวดเร็ว — แสดงหรือซ่อน',
  'import.qs.lead': 'เปลี่ยนตัวเลขในตารางให้เป็นพารามิเตอร์ที่ปรับค่าได้',
  'import.qs.body':
    'แต่ละแถวต้องมีคอลัมน์หนึ่งที่เป็นรหัสไม่ซ้ำกัน ทุกคอลัมน์ที่ทำเครื่องหมายเป็น ตัวเลข จะกลายเป็นพารามิเตอร์หนึ่งตัวต่อหนึ่งแถว ส่วนการเชื่อมเข้ากับแบบจำลองยังเป็นขั้นที่ต้องทำเองหลังจากนั้น ไม่มีการอัปโหลดข้อมูล และตารางต้นทางไม่ถูกแก้ไขเลย',
  'import.qs.exampleHeading': 'ตัวอย่างอย่างย่อ',
  'import.qs.mapping': 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}',
  'import.qs.result': '2 แถว × 2 คอลัมน์ตัวเลข = 4 พารามิเตอร์',
  'import.qs.useExample': 'ใช้ตัวอย่างนี้',
  'import.qs.tableLimit': 'ถึงขีดจำกัด {max} ตารางแล้ว — ลบตารางหนึ่งออกก่อน',
  'import.qs.download': 'ดาวน์โหลด CSV ตัวอย่าง',
  'import.qs.fullGuide': 'คู่มือฉบับเต็ม',
  'import.qs.fullGuideAria': 'คู่มือฉบับเต็ม — เปิดบน GitHub ในแท็บใหม่',
  'import.qs.sources.summary': 'การนำข้อมูลออกจาก Google Sheets หรือ Excel',
  'import.qs.sources.sheets':
    'Google Sheets: ไฟล์ → ดาวน์โหลด → ค่าที่คั่นด้วยเครื่องหมายจุลภาค (.csv) หรือเลือกช่วงข้อมูลแล้วคัดลอก',
  'import.qs.sources.excel': 'Excel หรือ Numbers: บันทึกเป็น / ส่งออกเป็น CSV หรือคัดลอกช่วงข้อมูล',
  'import.qs.sources.privacy':
    'อย่าใช้ “เผยแพร่ไปยังเว็บ” กับชีตส่วนตัว — จะทำให้ใครก็ตามที่มีลิงก์อ่านชีตได้ การดาวน์โหลดหรือคัดลอกยังคงความเป็นส่วนตัวไว้',
  'import.qs.notImported.summary': 'สิ่งที่ไม่ถูกนำเข้า',
  'import.qs.notImported.formulas':
    'ตัวสูตรเองไม่ถูกนำเข้า — CSV หรือการวางข้อมูลนำมาเฉพาะค่าที่คำนวณไว้แล้วของแต่ละเซลล์',
  'import.qs.notImported.list':
    'การจัดรูปแบบ แผนภูมิ เซลล์ที่ผสานหรือมีหลายค่า ไฟล์ .xlsx และการซิงก์แบบสด ส่วนความสัมพันธ์ระหว่างค่าต่าง ๆ ต้องสร้างแบบจำลองเอง',
  'import.qs.limits': 'ได้ถึง {tables} ตาราง {columns} คอลัมน์ที่จับคู่ต่อตาราง และ {rows} แถวต่อตาราง',
  'import.roleHelp.title': 'บทบาทของคอลัมน์',
  'import.roleHelp.key': 'รหัสไม่ซ้ำที่ใช้จับคู่แถวนี้เมื่อรีเฟรช',
  'import.roleHelp.label': 'ชื่อที่แสดงบนพารามิเตอร์ที่สร้างขึ้น',
  'import.roleHelp.number': 'สร้างพารามิเตอร์ที่ปรับค่าได้หนึ่งตัวต่อทุกแถว',
  'import.roleHelp.foreignKey': 'เชื่อมค่านี้กับแถวในตารางอื่นที่นำเข้ามา',
  'import.roleHelp.ignored': 'ไม่นำคอลัมน์นี้เข้า Loop Studio',
  'import.linkTables.summary': 'เชื่อมหลายตารางเข้าด้วยกัน',
  'import.linkTables.body':
    'เพิ่มตารางที่สองแล้วทำเครื่องหมายคอลัมน์หนึ่งเป็น คีย์นอก เพื่ออ้างถึง คีย์ ของอีกตาราง จากนั้น ป้ายกำกับ ของตารางนั้นจะช่วยเติมชื่อที่สร้างขึ้นให้สมบูรณ์ขึ้น ตารางที่มีคีย์นอกสองคอลัมน์ต้องเลือกว่าจะใช้คอลัมน์ใดจัดกลุ่มกรอบ',
  'import.status.key': 'คีย์: {header}',
  'import.status.keyNone': 'คีย์: ยังไม่มี',
  'import.status.keyMany': 'คีย์: {n} คอลัมน์ — เลือกให้เหลือหนึ่งเดียว',
  'import.status.counts':
    '{cols, plural, other {# คอลัมน์ตัวเลข}} × {rows, plural, other {# แถว}} → {n, plural, other {# พารามิเตอร์}}',
  'import.placement.frameHelp': 'กรอบคือกล่องที่มีชื่อกำกับ ใช้จัดกลุ่มโหนดบนผืนผ้าใบ',
  'import.placement.noneResult': '{n, plural, other {# พารามิเตอร์}} บนผืนผ้าใบ ไม่สร้างกรอบ',
  'import.placement.framePerTableResult': 'จะสร้าง {n, plural, other {# กรอบ}}',
  'import.placement.noFramesYet': 'ยังไม่มีกรอบบนผืนผ้าใบนี้',
  'import.review.col.table': 'ตาราง',
  'import.review.col.rows': 'แถว',
  'import.review.col.numberColumns': 'คอลัมน์ตัวเลข',
  'import.review.col.parameters': 'พารามิเตอร์',
  'import.review.col.frames': 'กรอบ',
  'import.review.lookupOnly': '0 (ใช้ค้นหาอย่างเดียว)',
  'import.review.total': 'รวม',
  'import.review.labelsPreview': 'ป้ายกำกับจะมีหน้าตาแบบนี้:',
  'import.review.more': '{n, plural, other {… และอีก # รายการ}}',
  'import.issueSummary':
    'พบ {n, plural, other {# ปัญหา}} ใน {m, plural, other {# ตาราง}} แก้ไขด้านล่างแล้วกด ถัดไป อีกครั้ง',
  'import.issueSummaryStale': 'ข้อมูลเข้าเปลี่ยนไปนับจากการตรวจครั้งล่าสุด — กด ถัดไป เพื่อตรวจใหม่',
  'import.issueJump': 'ไปที่เซลล์นี้',
  'import.loc.table': 'ตาราง {table}',
  'import.loc.tableRow': 'ตาราง {table} แถว {row}',
  'import.loc.tableRowColumn': 'ตาราง {table} แถว {row} คอลัมน์ {column}',
  'import.loc.tableRowColumnHeader': 'ตาราง {table} แถว {row} คอลัมน์ {column} ({header})',
  'import.loc.tableColumnHeader': 'ตาราง {table} คอลัมน์ {column} ({header})',
  'import.issue.table-limit-exceeded': 'ตารางมากเกินไป ({count} สูงสุด {max})',
  'import.issue.column-limit-exceeded': 'คอลัมน์ที่จับคู่มากเกินไป ({count} สูงสุด {max})',
  'import.issue.row-limit-exceeded': 'แถวมากเกินไป ({count} สูงสุด {max})',
  'import.issue.invalid-header-row': 'แถวหัวตารางต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป',
  'import.issue.invalid-ignore-rows': 'ค่า “ข้าม N แถวสุดท้าย” ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป',
  'import.issue.empty-table-name': 'ชื่อตารางว่างเปล่า',
  'import.issue.label-too-long': 'ชื่อตารางยาวเกินไป (สูงสุด {max} อักขระ)',
  'import.issue.empty-column-header': 'หัวคอลัมน์นี้ว่างเปล่า',
  'import.issue.header-too-long': 'หัวคอลัมน์นี้ยาวเกินไป (สูงสุด {max} อักขระ)',
  'import.issue.missing-source-column-id': 'คอลัมน์นี้ไม่มีรหัสภายใน — เลือกบทบาทของคอลัมน์ใหม่',
  'import.issue.duplicate-source-table-id': 'รหัสภายในของตารางนี้ชนกับของอีกตารางหนึ่ง',
  'import.issue.missing-key-column':
    'ยังไม่มีคอลัมน์ใดถูกทำเครื่องหมายเป็น คีย์ เลือก คีย์ ที่คอลัมน์ซึ่งระบุตัวแถวแต่ละแถว เช่น คอลัมน์รหัส',
  'import.issue.multiple-key-columns': 'มีมากกว่าหนึ่งคอลัมน์ถูกทำเครื่องหมายเป็น คีย์ — ให้เหลือหนึ่งเดียว',
  'import.issue.empty-key': 'คีย์ว่างเปล่า ทุกแถวต้องมีค่าคีย์',
  'import.issue.key-too-long': 'คีย์ยาวเกินไป (สูงสุด {max} ไบต์)',
  'import.issue.key-control-char': 'คีย์มีอักขระควบคุมอยู่',
  'import.issue.duplicate-key': 'คีย์ “{value}” ถูกใช้ในแถวอื่นแล้ว กำหนดคีย์ที่ไม่ซ้ำให้ทุกแถว',
  'import.issue.ragged-row':
    'แถวนี้มี {actual} เซลล์ แต่คาดไว้ {expected} ตรวจดูว่าขาดจุลภาคหรือไม่ แถวสรุปตัดออกได้ด้วย “ข้าม N แถวสุดท้าย”',
  'import.issue.empty-number': 'เซลล์นี้ว่างเปล่า ใส่ตัวเลข หรือตั้งคอลัมน์นี้เป็น ข้าม',
  'import.issue.invalid-number':
    '“{value}” ไม่ใช่ตัวเลข ลบตัวคั่นหลักพัน สัญลักษณ์สกุลเงิน และเครื่องหมาย % ออก เช่น 4900',
  'import.issue.orphan-foreign-key': 'ไม่มีแถวใดในตารางปลายทางที่มีคีย์ “{value}”',
  'import.issue.missing-fk-target':
    'คอลัมน์คีย์นอกนี้ยังไม่มีตารางปลายทาง เลือกตารางที่อ้างถึงได้ใต้หัวคอลัมน์',
  'import.issue.invalid-fk-target': 'ตารางปลายทางของคีย์นอกนี้ไม่มีอยู่แล้ว',
  'import.issue.missing-group-by':
    'ตารางนี้มีคอลัมน์คีย์นอกตั้งแต่สองคอลัมน์ขึ้นไป — เลือกว่าจะใช้คอลัมน์ใดจัดกลุ่มกรอบ (“จัดกลุ่มกรอบตาม” ใต้แถวหัวตาราง)',
  'import.issue.invalid-group-by': 'คอลัมน์ที่ใช้จัดกลุ่มต้องเป็นหนึ่งในคอลัมน์คีย์นอกของตารางนี้',
  'import.issue.round-trip-mismatch': 'เก็บข้อมูลนี้อย่างปลอดภัยไม่ได้ — โปรดลดความซับซ้อนแล้วลองใหม่',
  'import.issue.label-fallback': 'ไม่มีชื่อสำหรับการอ้างถึงนี้ — จะแสดงคีย์ดิบแทน',
  'import.commitError.source-table-id-collision':
    'มีตารางที่ใช้รหัสภายในเดียวกันอยู่แล้ว — โปรดนำเข้าใหม่อีกครั้ง',
  'import.commitError.parameter-id-collision':
    'รหัสที่สร้างขึ้นชนกับรหัสที่มีอยู่ — โปรดนำเข้าใหม่อีกครั้ง',
  'import.commitError.frame-placement-failed': 'หาที่ว่างสำหรับกรอบของตาราง “{table}” ไม่ได้',
  'import.commitError.frame-not-found': 'กรอบที่เลือกไว้ไม่มีอยู่แล้ว',
  'import.commitError.frame-insufficient-space': 'พื้นที่ว่างใน “{frame}” ไม่พอ',
  'import.commitError.invalid-result-graph': 'กราฟที่ได้ไม่ถูกต้อง — โปรดติดต่อฝ่ายสนับสนุน',
  'import.menu.import': 'นำเข้าค่าจากตารางเป็นพารามิเตอร์…',
  'import.menu.manage': 'รีเฟรชหรือจัดการตารางที่นำเข้าไว้…',
  'import.menu.guide': 'วิธีเตรียมตาราง…',
  'import.refresh.manageTitle': 'จัดการการเชื่อมกับตาราง',
  'import.refresh.noBindings': 'ยังไม่มีตารางใดถูกเชื่อมไว้',
  'import.refresh.rowCount': '{n, plural, other {# แถว}}',
  'import.refresh.renameLabel': 'ชื่อตาราง',
  'import.refresh.refreshButton': 'รีเฟรช…',
  'import.refresh.exportCsv': 'ส่งออก CSV ข้อเสนอการเปลี่ยนแปลง',
  'import.refresh.exportBlockedDuplicate':
    'การส่งออกถูกระงับ: แถว/คอลัมน์เดียวกันมีพารามิเตอร์ที่ใช้งานอยู่มากกว่าหนึ่งตัว แก้รายการที่ซ้ำก่อนส่งออก',
  'import.refresh.title': 'รีเฟรชตาราง “{table}”',
  'import.refresh.commit': 'ยืนยันการรีเฟรช',
  'import.refresh.columnEvents.title': 'การเปลี่ยนแปลงของคอลัมน์',
  'import.refresh.columnEvents.none': 'ไม่มีการเปลี่ยนแปลงของคอลัมน์ — ทุกคอลัมน์จับคู่ได้เอง',
  'import.refresh.columnEvents.missingHeader': 'คอลัมน์ “{header}” ({role}) ไม่มีอยู่ในข้อมูลใหม่แล้ว',
  'import.refresh.columnEvents.ambiguousMatch': 'คอลัมน์ “{header}” ตรงกับคอลัมน์ขาเข้ามากกว่าหนึ่งคอลัมน์',
  'import.refresh.columnEvents.unresolved': '— เลือกหนึ่งรายการ —',
  'import.refresh.columnEvents.removedOption': 'คอลัมน์ถูกลบ',
  'import.refresh.columnEvents.mapMore': 'จับคู่คอลัมน์เพิ่ม…',
  'import.refresh.columnEvents.unrecognized': 'คอลัมน์ “{header}” ยังไม่ถูกจับคู่',
  'import.refresh.columnEvents.doNotMap': 'ไม่ต้องจับคู่',
  'import.refresh.columnEvents.fkTarget': 'อ้างถึงตาราง…',
  'import.refresh.review.added': '{n, plural, other {จะเพิ่ม # แถว}}',
  'import.refresh.review.missing': '{n, plural, other {ข้อมูลใหม่ขาดไป # แถว}}',
  'import.refresh.review.changed': '{n, plural, other {# ค่าจะอัปเดตเอง}}',
  'import.refresh.review.conflicts': '{n, plural, other {# ค่าขัดแย้งกันและต้องเลือก}}',
  'import.refresh.review.locallyDeleted': '{n, plural, other {# ค่าถูกลบไปในเครื่องแล้ว}}',
  'import.refresh.review.fkRepoints': '{n, plural, other {คีย์นอกเปลี่ยนไป # รายการ}}',
  'import.refresh.review.newColumnValues': '{n, plural, other {จะเพิ่มค่าคอลัมน์ใหม่ # รายการ}}',
  'import.refresh.review.confirmAdd': 'เพิ่มแถวนี้',
  'import.refresh.review.missingChoiceNone': '— เลือก —',
  'import.refresh.review.missingChoiceUnlink': 'คงไว้ตามเดิม และตัดการเชื่อมกับตาราง',
  'import.refresh.review.missingChoiceDelete': 'ลบ',
  'import.refresh.review.missingBlocked': 'ยังถูกอ้างถึงโดย {table} — รีเฟรชตารางนั้นก่อน',
  'import.refresh.review.cellChoiceApplyIncoming': 'ใช้ค่าใหม่ ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'คงค่าเดิมไว้ ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate': 'สร้างใหม่ด้วยค่าใหม่ ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard': 'ทิ้งไป — เลิกติดตามเซลล์นี้',
  'import.refresh.review.fkChoiceAccept': 'รับการอ้างถึงใหม่ ({value})',
  'import.refresh.review.fkChoiceReject': 'คงการอ้างถึงเดิมไว้ ({value})',
  'import.refresh.duplicateTripleError':
    'ข้อมูลนี้เสียหาย: มีพารามิเตอร์มากกว่าหนึ่งตัวผูกกับแถวและคอลัมน์เดียวกัน การรีเฟรชถูกระงับจนกว่าจะแก้ไข',
  'import.refresh.commitError.referenced-node':
    'ลบพารามิเตอร์ของแถวนี้ไม่ได้ — ยังถูกอ้างถึงที่อื่นในกราฟ',
  'import.refresh.commitError.missing-row-dependency':
    'ตัดการเชื่อมหรือลบแถวนี้ไม่ได้ — ยังมีตารางอื่นอ้างถึงอยู่',
  'import.refresh.commitError.placement-failed':
    'หาที่ว่างบนผืนผ้าใบสำหรับพารามิเตอร์ใหม่ไม่ได้ — เลื่อนมุมมองไปตำแหน่งอื่นแล้วลองใหม่',
  'import.refreshIssue.table-not-found': 'การเชื่อมกับตารางนี้ไม่มีอยู่แล้ว',
  'import.refreshIssue.unresolved-column-event': 'การเปลี่ยนแปลงของคอลัมน์นี้ต้องเลือกก่อนจึงจะไปต่อได้',
  'import.refreshIssue.invalid-column-pairing':
    'ตัวเลือกคอลัมน์นี้ไม่ตรงกับการเปลี่ยนแปลงของคอลัมน์ใดที่ค้างอยู่',
  'import.refreshIssue.key-column-cannot-be-removed':
    'คอลัมน์ที่เป็นคีย์ของแถวลบไม่ได้ — ให้จับคู่ใหม่กับคอลัมน์ขาเข้าอื่นแทน',
  'import.refreshIssue.duplicate-column-pairing': 'ตัวเลือกคอลัมน์นี้ขัดแย้งกับอีกตัวเลือกหนึ่ง',
  'import.refreshIssue.invalid-new-column-pairing': 'ตารางปลายทางของคีย์นอกในคอลัมน์ใหม่นี้ไม่ถูกต้อง',
  'import.refreshIssue.duplicate-source-column-id': 'รหัสภายในของคอลัมน์นี้ชนกับรหัสที่มีอยู่',
} as const

export type DataImportKey = keyof typeof dataImport
export default dataImport
