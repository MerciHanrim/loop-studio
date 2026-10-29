// docs/localization.md §L3.3 — Templates & modules slice of the `th` catalog.
//
// GAME TERMS. `pity` and `pickup` stay in English in the gacha blurb, the way
// every other shipped locale keeps them: they are the MECHANISM names players
// use, not descriptions. `drop` and `loot` are transliterated (`ดรอป`, `ลูท`)
// because that is how Thai game copy actually writes them. Both decisions are
// declared per key in `thCopy.test.ts` rather than waived script-wide.
//
// `แบบจำลอง` for model (a simulation model), `เทมเพลต` for template, `กรอบ`
// for frame — §L2.19.

const templates = {
  'templates.button': 'เทมเพลต',
  'templates.menuLabel': 'เทมเพลต',
  'templates.equilibrium.name': 'สายการผลิตที่สมดุล',
  'templates.equilibrium.blurb':
    'วัตถุดิบเข้า การแปรรูปและของเสีย สินค้าสำเร็จรูปออก — สายการผลิตที่เข้าสู่สมดุลภายในไม่กี่ขั้น',
  'templates.deadlock.name': 'ภาวะติดตันจากความจุ',
  'templates.deadlock.blurb':
    'สายการผลิตเดียวกันแต่ไม่มีขั้นการจัดส่ง: สต็อกเต็มความจุแล้วทุกอย่างหยุดนิ่ง',
  'templates.mmoProgression.name': 'การไต่ระดับช่วงต้นของเกม MMO (เลเวล 1–15)',
  'templates.mmoProgression.blurb':
    'เควส การล่า และรางวัล ในสามโซน — ใช้เวลานานเท่าใดกว่าจะถึงเลเวล 15',
  'templates.coffeeRoastery.name': 'สายงานของโรงคั่วกาแฟ',
  'templates.coffeeRoastery.blurb':
    'การคั่ว การขาย และสต็อก ดึงกันไปมาอย่างไรตลอดวันทำการหนึ่งวัน',
  'templates.gachaBannerZones.name': 'การเปรียบเทียบแบนเนอร์กาชาสามโซน',
  'templates.gachaBannerZones.blurb':
    'สามแบนเนอร์บนงบก้อนเดียว เพื่อดูว่า pity และการการันตี pickup เปลี่ยนอะไรบ้าง',
  'templates.replace.title': 'โหลดเทมเพลตนี้หรือไม่',
  'templates.replace.body': 'งานปัจจุบันจะถูกแทนที่ด้วย: {name}',
  'templates.replace.confirm': 'โหลดเทมเพลต',
  'modules.extract': 'บันทึกโครงสร้างที่เลือก…',
  'modules.error.title': 'แทรกโครงสร้างไม่ได้',
  'modules.promote.title': 'เปลี่ยนเอกสารนี้เป็นแบบจำลองที่ขับด้วยพารามิเตอร์ (v2) หรือไม่',
  'modules.promote.body': 'การแทรกโครงสร้างนี้จะเปลี่ยนเอกสารเป็นแบบจำลอง v2 และค่าสรุปความหมายของแบบจำลองจะเปลี่ยนไป การเลิกทำครั้งเดียวย้อนทั้งการเปลี่ยนแบบจำลองและการแทรกพร้อมกัน',
  'modules.promote.confirm': 'ยกระดับแล้วแทรก',
  'modules.frames.title': 'กรอบที่บันทึกไว้จะไม่ถูกรวมไปด้วย',
  'modules.frames.insertBody': 'ไฟล์นี้มีกรอบกลุ่มที่บันทึกไว้ การแทรกเป็นโครงสร้างจะไม่นำกรอบเข้ามาในกราฟ — ส่วนที่เหลือแทรกตามปกติ',
  'modules.frames.extractBody': 'กราฟนี้มีกรอบกลุ่มที่บันทึกไว้ กรอบจะไม่ถูกเขียนลงในไฟล์โครงสร้าง — เขียนเฉพาะโหนดที่เลือกและเส้นเชื่อมระหว่างกันเท่านั้น',
  'modules.frames.continue': 'ดำเนินการต่อ',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'กาชาทั่วไป',
  'templates.gachaGeneral.blurb': 'แบนเนอร์เดียว ไม่มี pity อัตราการออกนับเทียบกับจำนวนการสุ่มเป้าหมาย และการรันหยุดที่นั่น',
  'templates.gachaStandard.name': 'กาชา Standard',
  'templates.gachaStandard.blurb': 'แบนเนอร์เดียวที่มีเพดาน hard pity: เมื่อถึงเพดาน การสุ่มครั้งถัดไปจะเป็น SSR ที่ถูกบังคับออก',
  'templates.gachaPickup.name': 'กาชา Pickup',
  'templates.gachaPickup.blurb': 'Pity และการการันตี pickup: หลังได้ SSR นอก pickup SSR ใบถัดไปจะเป็น pickup',
  'modules.insertSaved': 'แทรกโครงสร้างที่บันทึกไว้…',
  'modules.insertSaved.blurb': 'เพิ่มไฟล์โครงสร้างที่บันทึกไว้ลงในเอกสารนี้',
  'modules.insertSaved.locked': 'ใช้ไม่ได้ขณะที่ล็อกการแก้ไข',
  'modules.extract.blurb': 'บันทึกโหนดที่เลือกและเส้นเชื่อมระหว่างโหนดเหล่านั้นลงในไฟล์',
} as const

export type TemplatesKey = keyof typeof templates
export default templates
