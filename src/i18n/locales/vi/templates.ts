// docs/localization.md §L3.3 — Templates & modules slice of the `vi` catalog.
//
// GLOSSARY (§L2.21, approved before translation began). `Mẫu` for template,
// `Mô-đun` for module, `Mô hình` for model, `Khung vẽ` for canvas, `Nhóm` for
// a group frame.
//
// GAME TERMS. `pity` and `pickup` stay in English in the gacha blurb, the way
// every other shipped locale keeps them: they are the MECHANISM names players
// use, not descriptions. `Pickup` is an OPEN native-review item — a majority
// of locales writing `UP` is recorded as a fact and is explicitly not a reason
// to change Vietnamese.
//
// STYLE. Impersonal and terse; the reader is not addressed in the second
// person, and an imperative is used only where the English is one.

const templates = {
  'templates.button': 'Mẫu ▾',
  'templates.menuLabel': 'Mẫu',
  'templates.equilibrium.name': 'Dây chuyền sản xuất cân bằng',
  'templates.equilibrium.blurb': 'Nguyên liệu vào, gia công và phế phẩm, thành phẩm ra — một dây chuyền ổn định sau vài bước.',
  'templates.deadlock.name': 'Tắc nghẽn do hết sức chứa',
  'templates.deadlock.blurb': 'Vẫn dây chuyền đó nhưng không có bước xuất hàng: tồn kho đầy sức chứa và mọi thứ dừng lại.',
  'templates.mmoProgression.name': 'Tiến trình MMO giai đoạn đầu (cấp 1–15)',
  'templates.mmoProgression.blurb': 'Ba khu vực nhiệm vụ, săn quái và phần thưởng — mất bao lâu để đạt cấp 15.',
  'templates.coffeeRoastery.name': 'Luồng vận hành xưởng rang cà phê',
  'templates.coffeeRoastery.blurb': 'Rang, bán hàng và tồn kho kéo lẫn nhau ra sao trong một ngày kinh doanh.',
  'templates.gachaBannerZones.name': 'So sánh ba banner gacha',
  'templates.gachaBannerZones.blurb': 'Ba banner trên cùng một ngân sách, để thấy pity và bảo đảm pickup thay đổi điều gì.',
  'templates.replace.title': 'Nạp mẫu này?',
  'templates.replace.body': 'Phần đang làm sẽ được thay bằng: {name}',
  'templates.replace.confirm': 'Nạp mẫu',
  'modules.button': 'Chèn mô-đun ▾',
  'modules.menuLabel': 'Chèn mô-đun',
  'modules.fromFile': 'Từ tệp…',
  'modules.extract': 'Tách phần đang chọn thành mô-đun…',
  'modules.bufferedStep.name': 'Bước sản xuất có bộ đệm',
  'modules.bufferedStep.blurb': 'Thêm một bước sản xuất kèm bộ đệm đầu vào và đầu ra.',
  'modules.rewardSplit.name': 'Vòng chia phần thưởng',
  'modules.rewardSplit.blurb': 'Thêm một vòng chia phần thưởng nhận được thành chi tiêu và tiết kiệm.',
  'modules.error.title': 'Không chèn được mô-đun',
  'modules.promote.title': 'Chuyển thành mô hình điều khiển bằng tham số (v2)?',
  'modules.promote.body': 'Chèn khối này sẽ chuyển tài liệu thành mô hình v2 và mã tóm lược ngữ nghĩa mô hình thay đổi. Một lần hoàn tác sẽ đảo ngược cả việc chuyển mô hình lẫn việc chèn.',
  'modules.promote.confirm': 'Chuyển và chèn',
  'modules.frames.title': 'Không bao gồm nhóm đã lưu',
  'modules.frames.insertBody': 'Tệp này có các nhóm đã lưu. Chèn nó như một mô-đun sẽ không mang nhóm vào đồ thị — mọi thứ còn lại được chèn như bình thường.',
  'modules.frames.extractBody': 'Đồ thị có các nhóm đã lưu. Chúng không được ghi vào tệp mô-đun — chỉ các nút đang chọn và liên kết nội bộ giữa chúng được ghi.',
  'modules.frames.continue': 'Tiếp tục',
} as const

export default templates
