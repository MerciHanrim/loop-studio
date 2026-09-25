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
  'templates.button': 'เทมเพลต ▾',
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
  'modules.button': 'แทรกมอดูล ▾',
  'modules.menuLabel': 'แทรกมอดูล',
  'modules.fromFile': 'จากไฟล์…',
  'modules.extract': 'แยกสิ่งที่เลือกออกเป็นมอดูล…',
  'modules.bufferedStep.name': 'ขั้นการผลิตที่มีบัฟเฟอร์',
  'modules.bufferedStep.blurb': 'เพิ่มขั้นการผลิตพร้อมบัฟเฟอร์ขาเข้าและขาออก',
  'modules.rewardSplit.name': 'วงจรแบ่งรางวัล',
  'modules.rewardSplit.blurb': 'เพิ่มวงจรที่แบ่งรางวัลขาเข้าออกเป็นส่วนใช้จ่ายและส่วนเก็บออม',
  'modules.error.title': 'แทรกมอดูลไม่ได้',
  'modules.promote.title': 'เปลี่ยนเอกสารนี้เป็นแบบจำลองที่ขับด้วยพารามิเตอร์ (v2) หรือไม่',
  'modules.promote.body':
    'การแทรกบล็อกนี้จะเปลี่ยนเอกสารเป็นแบบจำลอง v2 และค่าสรุปความหมายของแบบจำลองจะเปลี่ยนไป การเลิกทำครั้งเดียวย้อนทั้งการเปลี่ยนแบบจำลองและการแทรกพร้อมกัน',
  'modules.promote.confirm': 'ยกระดับแล้วแทรก',
  'modules.frames.title': 'กรอบที่บันทึกไว้จะไม่ถูกรวมไปด้วย',
  'modules.frames.insertBody':
    'ไฟล์นี้มีกรอบกลุ่มที่บันทึกไว้ การแทรกเป็นมอดูลจะไม่นำกรอบเข้ามาในกราฟ — ส่วนที่เหลือแทรกตามปกติ',
  'modules.frames.extractBody':
    'กราฟนี้มีกรอบกลุ่มที่บันทึกไว้ กรอบจะไม่ถูกเขียนลงในไฟล์มอดูล — เขียนเฉพาะโหนดที่เลือกและเส้นเชื่อมระหว่างกันเท่านั้น',
  'modules.frames.continue': 'ดำเนินการต่อ',
} as const

export type TemplatesKey = keyof typeof templates
export default templates
