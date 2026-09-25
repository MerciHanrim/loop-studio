// docs/localization.md §L3.3 — Canvas surface slice of the `th` catalog.
//
// NODE KINDS. `ถังพัก` · `แหล่งกำเนิด` · `ทางระบาย` · `ตัวกระจาย` · `ตัวแปลง` ·
// `จุดสิ้นสุด` · `พารามิเตอร์` · `ค่าที่คำนวณ`.
//
// The names describe what the node DOES in Loop Studio rather than translating
// the English surface form, because two of the English words mean something
// else in Thai when taken literally:
//   • `Gate` is not `ประตู` (a door). The node splits a flow by ratio or picks
//     a branch by probability, so it is `ตัวกระจาย` — the same move `de`, `fr`
//     and `tr` made away from the literal word.
//   • `Source` is not `ต้นทาง`. That is the UPSTREAM END of a route, which is
//     also what an edge's source end is called, so the node kind and the edge
//     end would collide. `แหล่งกำเนิด` names the thing that ORIGINATES.
//   • `Pool` is `ถังพัก` (a holding/buffer tank) rather than `บ่อ`, the literal
//     pool: the node's defining behaviour is holding a level and pushing back
//     when full.
//   • `Drain` is `ทางระบาย`, the drainage outlet — the concrete word, matching
//     the register English chose when it picked `Drain` over `Sink`.
//
// `ค่าที่คำนวณ` for Register, never `บันทึก`. `บันทึก` means both "a record"
// and "save", and the catalog already uses save for a BUTTON (`author.save`,
// `export.workspace.confirm`), so the node kind and an action would be the
// same word. de / fr / es-ES / ru / tr all made the same move to "calculated
// value" for the same reason: this node stores nothing.
//
// PLURAL. Thai declares only `other`, so the two count messages carry a single
// arm. `#` still groups (`1,000,000`).
//
// `“…”` wraps a runtime label — the Royal Institute's Thai quotation mark,
// not the `«…»` `tr` uses. Thai has no spaces between words, so without a
// delimiter a user's label runs straight into the sentence around it.

const canvas = {
  'palette.pool.name': 'ถังพัก',
  'palette.pool.description':
    'เก็บทรัพยากรไว้และแสดงปริมาณปัจจุบัน เมื่อความจุเต็ม จะดันกลับไปยังการไหลขาเข้า',
  'palette.source.name': 'แหล่งกำเนิด',
  'palette.source.description': 'สร้างทรัพยากรใหม่ในทุกขั้น แล้วส่งไปยังโหนดที่ป้อนอยู่',
  'palette.drain.name': 'ทางระบาย',
  'palette.drain.description': 'ดึงทรัพยากรจากโหนดที่เชื่อมอยู่ แล้วนำออกจากระบบ',
  'palette.gate.name': 'ตัวกระจาย',
  'palette.gate.description':
    'แบ่งทรัพยากรขาเข้าตามอัตราส่วนที่กำหนด หรือสุ่มเลือกหนึ่งสาขาตามความน่าจะเป็นแล้วส่งไปทางนั้น ไม่เก็บอะไรไว้',
  'palette.converter.name': 'ตัวแปลง',
  'palette.converter.description':
    'ใช้ทรัพยากรขาเข้าแล้วผลิตทรัพยากรขาออกตามอัตราส่วนที่กำหนด ไม่เก็บอะไรไว้',
  'palette.end.name': 'จุดสิ้นสุด',
  'palette.end.description': 'หยุดการรันเมื่อมีทรัพยากรมาถึง',
  'palette.parameter.name': 'พารามิเตอร์',
  'palette.parameter.description':
    'ตัวเลขคงที่ที่กำหนดเอง ไม่มีจุดเชื่อม และนิพจน์อ้างถึงได้ด้วย id',
  'palette.register.name': 'ค่าที่คำนวณ',
  'palette.register.description':
    'คำนวณนิพจน์สำหรับขั้นปัจจุบันแล้วแสดงผลลัพธ์ ไม่สะสม ไม่เก็บค่า และไม่มีจุดเชื่อม',
  'palette.addAction': 'คลิก หรือลากลงบนผืนผ้าใบ เพื่อเพิ่ม',
  'canvas.minimap': 'แผนที่ย่อของกราฟ',
  'canvas.minimap.hide': 'ซ่อนแผนที่ย่อ',
  'canvas.minimap.show': 'แสดงแผนที่ย่อ',
  'canvas.lock.lock': 'ล็อกการแก้ไข — การเลือกและการอ่านยังใช้ได้',
  'canvas.lock.unlock': 'ปลดล็อกการแก้ไข — ย้าย เชื่อม และเปลี่ยนค่า',
  'canvas.focus.on': 'โฟกัสปิดอยู่ — คลิกเพื่อโฟกัสโหนดที่เลือก',
  'canvas.focus.off': 'โฟกัสเปิดอยู่ — คลิกเพื่อแสดงกราฟทั้งหมด',
  'canvas.focus.hint': 'เลือกโหนดที่ต้องการโฟกัส',
  'canvas.focus.rowLabel': 'โฟกัสสิ่งที่เลือก',
  'canvas.focus.stateOn': 'เปิด',
  'canvas.focus.stateOff': 'ปิด',
  'canvas.panMode.off': 'โหมดเลื่อนปิดอยู่ — ลากพื้นที่ว่างเพื่อเลื่อน',
  'canvas.panMode.on': 'โหมดเลื่อนเปิดอยู่ — ลากตรงไหนก็ได้เพื่อเลื่อน',
  'canvas.panMode.rowLabel': 'โหมดเลื่อน',
  'canvas.filter.open': 'ตัวกรอง — ซ่อนบางส่วนของกราฟขณะสำรวจ',
  'canvas.filter.close': 'ปิดแผงตัวกรอง',
  'canvas.filter.title': 'ตัวกรอง',
  'canvas.filter.rowLabel': 'ตัวกรอง',
  'canvas.filter.groupEdgeClass': 'ชนิดเส้นเชื่อม',
  'canvas.filter.groupResourceType': 'ชนิดทรัพยากร',
  'canvas.filter.groupNodeKind': 'ประเภทโหนด',
  'canvas.filter.edgeClass.resource': 'ทรัพยากร',
  'canvas.filter.edgeClass.state': 'สถานะ',
  'canvas.filter.edgeClass.hint': 'คำใบ้การพึ่งพา',
  'canvas.filter.untyped': 'ไม่ระบุชนิด',
  'canvas.filter.clear': 'ล้างตัวกรอง',
  'canvas.filter.hiddenCount': 'ซ่อนอยู่: {n}',
  'canvas.filter.none': 'ไม่มีอะไรถูกซ่อน',
  'canvas.filter.checkboxHint': 'ติ๊ก = ซ่อน',
  'canvas.nodeKind.source': 'แหล่งกำเนิด',
  'canvas.nodeKind.pool': 'ถังพัก',
  'canvas.nodeKind.gate': 'ตัวกระจาย',
  'canvas.nodeKind.converter': 'ตัวแปลง',
  'canvas.nodeKind.drain': 'ทางระบาย',
  'canvas.nodeKind.end': 'จุดสิ้นสุด',
  'canvas.nodeKind.parameter': 'พารามิเตอร์',
  'canvas.nodeKind.register': 'ค่าที่คำนวณ',
  'canvas.resetView': 'รีเซ็ตมุมมอง — จัดกราฟให้พอดีและล้างตัวกรองกับโฟกัส',
  'canvas.regionSelect.off':
    'เลือกพื้นที่ — ลากบนพื้นที่ว่างเพื่อเลือก กด Shift ค้างแล้วลากก็ได้เช่นกัน',
  'canvas.regionSelect.on': 'เลือกพื้นที่ — กำลังเลือก ลากบนพื้นที่ว่าง กด Esc เพื่อยกเลิก',
  'canvas.regionSelect.count': '{n, plural, other {เลือกไว้ # โหนด}}',
  'canvas.regionSelect.countLocked':
    '{n, plural, other {เลือกไว้ # โหนด}} · ปลดล็อกการแก้ไขเพื่อย้าย',
  'canvas.frame.draw': 'กรอบกลุ่ม — ลากบนพื้นที่ว่างเพื่อวาด',
  'canvas.frame.drawing': 'กรอบกลุ่ม — กำลังวาด ลากบนพื้นที่ว่าง กด Esc เพื่อยกเลิก',
  'canvas.frame.defaultName': 'กลุ่มที่ {n}',
  'canvas.frame.delete': 'ลบกรอบนี้',
  'canvas.frame.suggest':
    'แนะนำกรอบ — วาดสี่เหลี่ยมคร่าว ๆ ล้อมโหนดที่เชื่อมกันเชิงโครงสร้าง ดูโครงสร้างเท่านั้น ไม่ใช่ความหมายเชิงเนื้อหา',
  'canvas.frame.suggestStale': 'แนะนำกรอบ — กราฟเปลี่ยนไป คลิกเพื่อคำนวณกลุ่มที่แนะนำใหม่',
  'canvas.frame.suggestRow': 'แนะนำกรอบ',
  'canvas.frame.suggestNote': 'กลุ่มเชิงโครงสร้างที่แนะนำ — อาจไม่ตรงกับวิธีแบ่งงานที่ต้องการ',
  'canvas.frame.suggestNoteDismiss': 'ปิดหมายเหตุนี้',
  'canvas.frame.areaName': 'พื้นที่ที่ {n}',
  'canvas.frame.dismiss': 'ปิดกรอบที่แนะนำนี้',
  'canvas.frame.clearAll': 'ล้างกรอบทั้งหมด',
  'canvas.frame.clearSuggested': 'ล้างกรอบที่แนะนำ',
  'canvas.frame.clearSuggestedRow': 'ล้างกรอบที่แนะนำ',
  'canvas.frame.colorRow': 'สีกรอบ',
  'canvas.frame.color.neutral': 'กลาง',
  'canvas.frame.color.slate': 'หินชนวน',
  'canvas.frame.color.sage': 'เสจ',
  'canvas.frame.color.gold': 'ทอง',
  'canvas.frame.color.violet': 'ม่วง',
  'canvas.frame.color.rose': 'กุหลาบ',
  'canvas.activity.off': 'ชั้นแสดงกิจกรรมปิดอยู่ — คลิกเพื่อไล่สีส่วนที่เพิ่งทำงาน',
  'canvas.activity.on': 'ชั้นแสดงกิจกรรมเปิดอยู่ — คลิกเพื่อซ่อนสี',
  'canvas.activity.rowLabel': 'ชั้นแสดงกิจกรรม',
  'canvas.route.invalidFlag': 'เส้นทางไม่ถูกต้อง — มีจุดของเส้นทางอยู่ในโหนด',
  'canvas.edgeLabel.clamp': 'ถูกตัด',
  'canvas.edgeLabel.clamp.title': 'ถูกตัดโดยการจำกัดครั้งเดียวของถังพักปลายทางเมื่อจบเฟส 0',
  'canvas.edgeLabel.blocked': 'ถูกขวาง',
  'canvas.edgeLabel.blocked.title':
    'ส่งถึงแล้ว แต่ปลายทางทำงานไม่ได้ (การกระตุ้นไม่ตรง หรือมีตัวกระตุ้นกดไว้ให้ปิด)',
  'canvas.edgeLabel.breakdown.title': 'การถ่ายโอนบนเส้นเชื่อมนี้ในขั้นนี้',
  'canvas.edgeLabel.refMissing': 'ข้อผิดพลาดการอ้างถึงพารามิเตอร์',
  'node.unreadable.title': '{kind} ที่อ่านไม่ได้',
  'node.unreadable.sub': 'อ่านข้อมูลไม่ได้ — แก้ไขในไฟล์',
  'node.invalidFlag': 'โหนดนี้ไม่ถูกต้อง',
  'node.aria.invalid': 'ไม่ถูกต้อง',
  'node.aria.selected': 'เลือกอยู่',
  'node.aria.focused': 'อยู่ที่โฟกัส',
  'node.evaluatedCue': 'คำนวณในขั้นนี้แล้วแต่ไม่ได้ทำงาน',
  'node.default.pool': 'ถังพัก',
  'node.default.source': 'แหล่งกำเนิด',
  'node.default.drain': 'ทางระบาย',
  'node.default.gate': 'ตัวกระจาย',
  'node.default.converter': 'ตัวแปลง',
  'node.default.end': 'จุดสิ้นสุด',
  'node.default.parameter': 'พารามิเตอร์',
  'node.default.register': 'ค่าที่คำนวณ',
  'canvas.frame.a11y.roledescription': 'กรอบกลุ่ม',
  'canvas.frame.a11y.roledescriptionAuto': 'กรอบกลุ่มที่แนะนำ',
  'canvas.frame.a11y.name': '“{label}”, {n, plural, other {# โหนด}}',
  'canvas.frame.a11y.desc': 'กด Enter หรือ Space เพื่อเลือกกรอบนี้',
  'canvas.frame.a11y.descSelected':
    'เลือกแล้ว ปุ่มลูกศรย้ายกรอบพร้อมทุกอย่างที่อยู่ข้างใน กด Shift ค้างเพื่อก้าวทีละมาก Backspace หรือ Delete ลบกรอบ Escape ยกเลิกการเลือก',
  'canvas.frame.a11y.descReadonly': 'อ่านอย่างเดียว — กรอบนี้เลือกและอ่านได้ แต่แก้ไขไม่ได้',
  'canvas.frame.a11y.resize':
    'ปรับขนาดกรอบ “{label}” — กว้าง {w} สูง {h} ปุ่มลูกศรปรับขนาด กด Shift ค้างเพื่อก้าวทีละมาก',
  'canvas.frame.a11y.moved': 'ย้ายกรอบ “{label}” ไปที่ x {x}, y {y}',
  'canvas.frame.a11y.resized': 'ปรับขนาดกรอบ “{label}” เป็น กว้าง {w} สูง {h}',
  'rf.node.moveCancelled': 'ยกเลิกการย้ายแล้ว โหนดกลับไปอยู่ที่ x {x}, y {y}',
  'rf.node.moved': 'ย้ายโหนดที่เลือก{direction} ตำแหน่งใหม่ x {x}, y {y}',
  'rf.dir.left': 'ไปทางซ้าย',
  'rf.dir.right': 'ไปทางขวา',
  'rf.dir.up': 'ขึ้น',
  'rf.dir.down': 'ลง',
  'rf.controls.label': 'ตัวควบคุมผืนผ้าใบ',
  'rf.controls.zoomIn': 'ซูมเข้า',
  'rf.controls.zoomOut': 'ซูมออก',
  'rf.controls.fitView': 'จัดไดอะแกรมให้พอดีกับมุมมอง',
  'rf.controls.interactive': 'สลับการแก้ไขบนผืนผ้าใบ',
  'rf.handle.label': 'จุดเชื่อม',
  'rf.node.a11y': 'กด Enter หรือ Space เพื่อเลือกโหนดนี้ กด Delete เพื่อลบ Escape เพื่อยกเลิก',
  'rf.node.a11yKeyboard':
    'กด Enter หรือ Space เพื่อเลือกโหนดนี้ แล้วใช้ปุ่มลูกศรเพื่อย้าย กด Delete เพื่อลบ Escape เพื่อยกเลิก',
  'rf.edge.a11y': 'กด Enter หรือ Space เพื่อเลือกเส้นเชื่อมนี้ กด Delete เพื่อลบ Escape เพื่อยกเลิก',
} as const

export type CanvasKey = keyof typeof canvas
export default canvas
