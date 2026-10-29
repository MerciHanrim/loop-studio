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
  'templates.button': 'Mẫu',
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
  'modules.extract': 'Lưu cấu trúc đang chọn…',
  'modules.error.title': 'Không chèn được cấu trúc',
  'modules.promote.title': 'Chuyển thành mô hình điều khiển bằng tham số (v2)?',
  'modules.promote.body': 'Chèn cấu trúc này sẽ chuyển tài liệu thành mô hình v2 và mã tóm lược ngữ nghĩa mô hình thay đổi. Một lần hoàn tác sẽ đảo ngược cả việc chuyển mô hình lẫn việc chèn.',
  'modules.promote.confirm': 'Chuyển và chèn',
  'modules.frames.title': 'Không bao gồm nhóm đã lưu',
  'modules.frames.insertBody': 'Tệp này có các nhóm đã lưu. Chèn nó như một cấu trúc sẽ không mang nhóm vào đồ thị — mọi thứ còn lại được chèn như bình thường.',
  'modules.frames.extractBody': 'Đồ thị có các nhóm đã lưu. Chúng không được ghi vào tệp cấu trúc — chỉ các nút đang chọn và liên kết nội bộ giữa chúng được ghi.',
  'modules.frames.continue': 'Tiếp tục',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'Gacha thường',
  'templates.gachaGeneral.blurb': 'Một banner, không có pity. Tỉ lệ trúng tính theo số lần quay mục tiêu; lần chạy dừng ở đó.',
  'templates.gachaStandard.name': 'Gacha Standard',
  'templates.gachaStandard.blurb': 'Một banner có trần Hard pity: khi chạm trần, lần quay kế tiếp là SSR bị ép ra.',
  'templates.gachaPickup.name': 'Gacha Pickup',
  'templates.gachaPickup.blurb': 'Pity và bảo đảm pickup: sau một SSR ngoài pickup, SSR kế tiếp là pickup.',
  'modules.insertSaved': 'Chèn cấu trúc đã lưu…',
  'modules.insertSaved.blurb': 'Thêm vào tài liệu này một tệp cấu trúc đã lưu.',
  'modules.insertSaved.locked': 'Không dùng được khi chỉnh sửa đang bị khóa',
  'modules.extract.blurb': 'Lưu các nút đang chọn và liên kết giữa chúng vào một tệp.',
} as const

export default templates
