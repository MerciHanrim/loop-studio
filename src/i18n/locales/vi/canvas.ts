// docs/localization.md §L3.3 — Canvas surface slice of the `vi` catalog.
// `satisfies Record<CanvasKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/canvas`. Merged in `./index.ts`.
//
// GLOSSARY (§L2.21, approved before translation began):
//   Pool `Bể chứa` · Source `Nguồn` · Drain `Điểm xả` · Gate `Bộ chia`
//   Converter `Bộ chuyển đổi` · End `Điểm kết thúc` · Parameter `Tham số`
//   Register `Giá trị tính toán` · canvas `Khung vẽ` · Group `Nhóm` ·
//   Area `Vùng`.
//
// `Bộ chia` for Gate, and NOT `Cổng`: `Cổng` is the literal gate and is
// also what a network port is called. This product's Gate SPLITS flow.
//
// It read `Bộ phân phối` (distributor) until the full EN↔VI read-back,
// which found the product contradicting itself: BOTH gate-typed labels this
// product ships say `chia` — `Bộ chia phần thưởng` (mmo `reward_router`)
// and `Chia luồng sản xuất` (equilibrium `tpl-gate`). The kind name now
// follows its own labels, and `Bộ chia` is two syllables instead of four.
//
// `Giá trị tính toán` for Register, NOT `Thanh ghi`: the latter is the CPU
// register and would mislead — the same trap Thai avoided with `บันทึก`.
//
// PLURALS. `Intl.PluralRules('vi')` declares exactly ONE category, `other`, for
// integers and decimals alike, so every plural message here has a single arm
// with `#` preserved. Vietnamese has no grammatical number on the noun, so the
// classifier does the work and the count sits in front of it.
//
// STYLE. Impersonal and terse; no second person unless the English is an
// imperative aimed at the reader.

import type { CanvasKey } from '../en/canvas'

const canvas = {
  'palette.pool.name': 'Bể chứa',
  'palette.pool.description': 'Giữ tài nguyên và hiển thị lượng hiện có. Khi đầy sức chứa, nó đẩy ngược lại dòng chảy đi vào.',
  'palette.source.name': 'Nguồn',
  'palette.source.description': 'Tạo tài nguyên mới ở mỗi bước và gửi tới các nút mà nó cấp.',
  'palette.drain.name': 'Điểm xả',
  'palette.drain.description': 'Rút tài nguyên từ các nút mà nó lấy về và loại chúng khỏi hệ thống.',
  'palette.gate.name': 'Bộ chia',
  'palette.gate.description': 'Chia tài nguyên đi vào theo tỉ lệ cố định, hoặc chọn một nhánh theo xác suất và gửi tới đó. Không giữ gì cả.',
  'palette.converter.name': 'Bộ chuyển đổi',
  'palette.converter.description': 'Tiêu thụ tài nguyên đầu vào và tạo tài nguyên đầu ra theo tỉ lệ đã đặt. Không giữ gì cả.',
  'palette.end.name': 'Điểm kết thúc',
  'palette.end.description': 'Dừng lần chạy khi có tài nguyên tới nơi.',
  'palette.parameter.name': 'Tham số',
  'palette.parameter.description': 'Một số cố định do người dùng đặt. Nó không có cổng kết nối, và biểu thức có thể tham chiếu tới nó bằng id.',
  'palette.register.name': 'Giá trị tính toán',
  'palette.register.description': 'Tính một biểu thức cho bước hiện tại và hiển thị kết quả. Nó không tích lũy, không lưu gì và không có cổng kết nối.',
  'palette.addAction': 'Nhấn, hoặc kéo vào khung vẽ, để thêm một cái.',
  'canvas.minimap': 'Bản đồ thu nhỏ của đồ thị',
  'canvas.minimap.hide': 'Ẩn bản đồ thu nhỏ',
  'canvas.minimap.show': 'Hiện bản đồ thu nhỏ',
  'canvas.lock.lock': 'Khóa chỉnh sửa — vẫn chọn và đọc được',
  'canvas.lock.unlock': 'Mở khóa chỉnh sửa — di chuyển, nối và đổi giá trị',
  'canvas.focus.on': 'Tiêu điểm đang tắt — nhấn để lấy tiêu điểm nút đang chọn',
  'canvas.focus.off': 'Tiêu điểm đang bật — nhấn để hiện toàn bộ đồ thị',
  'canvas.focus.hint': 'Chọn một nút để lấy tiêu điểm',
  'canvas.focus.rowLabel': 'Tiêu điểm theo lựa chọn',
  'canvas.focus.stateOn': 'Bật',
  'canvas.focus.stateOff': 'Tắt',
  'canvas.panMode.off': 'Chế độ kéo màn hình đang tắt — kéo vùng trống để di chuyển',
  'canvas.panMode.on': 'Chế độ kéo màn hình đang bật — kéo ở bất kỳ đâu để di chuyển',
  'canvas.panMode.rowLabel': 'Chế độ kéo màn hình',
  'canvas.filter.open': 'Bộ lọc — ẩn bớt phần đồ thị khi đang xem',
  'canvas.filter.close': 'Đóng bảng bộ lọc',
  'canvas.filter.title': 'Bộ lọc',
  'canvas.filter.rowLabel': 'Bộ lọc',
  'canvas.filter.groupEdgeClass': 'Loại liên kết',
  'canvas.filter.groupResourceType': 'Loại tài nguyên',
  'canvas.filter.groupNodeKind': 'Loại nút',
  'canvas.filter.edgeClass.resource': 'Tài nguyên',
  'canvas.filter.edgeClass.state': 'Trạng thái',
  'canvas.filter.edgeClass.hint': 'Gợi ý phụ thuộc',
  'canvas.filter.untyped': 'không có loại',
  'canvas.filter.clear': 'Xóa bộ lọc',
  'canvas.filter.hiddenCount': 'Đang ẩn {n}',
  'canvas.filter.none': 'Không ẩn gì',
  'canvas.filter.checkboxHint': 'đánh dấu = ẩn',
  'canvas.nodeKind.source': 'Nguồn',
  'canvas.nodeKind.pool': 'Bể chứa',
  'canvas.nodeKind.gate': 'Bộ chia',
  'canvas.nodeKind.converter': 'Bộ chuyển đổi',
  'canvas.nodeKind.drain': 'Điểm xả',
  'canvas.nodeKind.end': 'Điểm kết thúc',
  'canvas.nodeKind.parameter': 'Tham số',
  'canvas.nodeKind.register': 'Giá trị tính toán',
  'canvas.resetView': 'Đặt lại khung nhìn — vừa khít đồ thị và bỏ bộ lọc / tiêu điểm',
  'canvas.regionSelect.off': 'Chọn một vùng — kéo trên vùng trống để chọn; giữ Shift và kéo cũng được',
  'canvas.regionSelect.on': 'Chọn một vùng — đang chọn; kéo trên vùng trống, Esc để hủy',
  'canvas.regionSelect.count': '{n, plural, other {Đã chọn # nút}}',
  'canvas.regionSelect.countLocked':
    '{n, plural, other {Đã chọn # nút}} · mở khóa chỉnh sửa để di chuyển',
  'canvas.frame.draw': 'Nhóm — kéo trên vùng trống để vẽ một nhóm',
  'canvas.frame.drawing': 'Nhóm — đang vẽ; kéo trên vùng trống, Esc để hủy',
  'canvas.frame.defaultName': 'Nhóm {n}',
  'canvas.frame.delete': 'Xóa nhóm này',
  'canvas.frame.suggest': 'Gợi ý nhóm — các hình chữ nhật gom sơ bộ quanh những nút nối với nhau về cấu trúc. Chỉ theo cấu trúc, không theo ý nghĩa nghiệp vụ.',
  'canvas.frame.suggestStale': 'Gợi ý nhóm — đồ thị đã thay đổi; nhấn để tính lại các nhóm gợi ý',
  'canvas.frame.suggestRow': 'Gợi ý nhóm',
  'canvas.frame.suggestNote': 'Các nhóm gợi ý theo cấu trúc — có thể không khớp với cách bạn muốn chia việc.',
  'canvas.frame.suggestNoteDismiss': 'Bỏ qua ghi chú này',
  'canvas.frame.areaName': 'Vùng {n}',
  'canvas.frame.dismiss': 'Bỏ nhóm gợi ý này',
  'canvas.frame.clearAll': 'Xóa tất cả nhóm',
  'canvas.frame.clearSuggested': 'Xóa các nhóm gợi ý',
  'canvas.frame.clearSuggestedRow': 'Xóa các nhóm gợi ý',
  'canvas.frame.colorRow': 'Màu nhóm',
  'canvas.frame.color.neutral': 'Trung tính',
  'canvas.frame.color.slate': 'Xám lam',
  'canvas.frame.color.sage': 'Xanh rêu',
  'canvas.frame.color.gold': 'Vàng kim',
  'canvas.frame.color.violet': 'Tím',
  'canvas.frame.color.rose': 'Hồng',
  'canvas.frame.props.title': 'Cài đặt nhóm — {label}',
  'canvas.frame.props.name': 'Tên',
  'canvas.activity.off': 'Lớp phủ hoạt động đang tắt — nhấn để tô màu phần vừa hoạt động',
  'canvas.activity.on': 'Lớp phủ hoạt động đang bật — nhấn để ẩn màu tô',
  'canvas.activity.rowLabel': 'Lớp phủ hoạt động',
  'canvas.route.invalidFlag': 'đường đi không hợp lệ — một điểm định tuyến nằm trong nút',
  'canvas.edgeLabel.clamp': 'cắt bớt',
  'canvas.edgeLabel.clamp.title': 'bị bỏ bởi một lần cắt duy nhất ở cuối Pha 0 của Bể chứa đích',
  'canvas.edgeLabel.blocked': 'bị chặn',
  'canvas.edgeLabel.blocked.title': 'đã chuyển tới nơi, nhưng đích không kích hoạt được (sai kiểu kích hoạt, hoặc một bộ kích hoạt giữ nó đóng)',
  'canvas.edgeLabel.breakdown.title': 'các lần chuyển qua liên kết này trong bước hiện tại',
  'canvas.edgeLabel.refMissing': 'Lỗi tham chiếu tham số',
  'node.unreadable.title': 'không đọc được {kind}',
  'node.unreadable.sub': 'không đọc được dữ liệu — hãy sửa trong tệp',
  'node.invalidFlag': 'Nút này không hợp lệ',
  'node.aria.invalid': 'không hợp lệ',
  'node.aria.selected': 'đang chọn',
  'node.aria.focused': 'đang có tiêu điểm',
  'node.evaluatedCue': 'Đã tính ở bước này nhưng không hành động',
  'node.default.pool': 'Bể chứa',
  'node.default.source': 'Nguồn',
  'node.default.drain': 'Điểm xả',
  'node.default.gate': 'Bộ chia',
  'node.default.converter': 'Bộ chuyển đổi',
  'node.default.end': 'Điểm kết thúc',
  'node.default.parameter': 'Tham số',
  'node.default.register': 'Giá trị tính toán',
  'canvas.frame.a11y.roledescription': 'nhóm',
  'canvas.frame.a11y.roledescriptionAuto': 'nhóm gợi ý',
  'canvas.frame.a11y.name': '“{label}”, {n, plural, other {# nút}}',
  'canvas.frame.a11y.desc': 'Nhấn Enter hoặc Space để chọn nhóm này.',
  'canvas.frame.a11y.descSelected': 'Đang chọn. Các phím mũi tên di chuyển nhóm cùng mọi thứ bên trong, giữ Shift để bước lớn hơn. Backspace hoặc Delete xóa nó. Escape bỏ chọn.',
  'canvas.frame.a11y.descReadonly': 'Chỉ đọc — nhóm này chọn và đọc được, nhưng không sửa được.',
  'canvas.frame.a11y.resize': 'Đổi kích thước “{label}” — rộng {w}, cao {h}. Các phím mũi tên đổi kích thước, giữ Shift để bước lớn hơn.',
  'canvas.frame.a11y.moved': '“{label}” đã chuyển tới x {x}, y {y}',
  'canvas.frame.a11y.resized': '“{label}” đã đổi thành rộng {w}, cao {h}',
  'rf.node.moveCancelled': 'Đã hủy di chuyển. Nút trở lại x {x}, y {y}',
  'rf.node.moved': 'Đã chuyển nút đang chọn theo hướng {direction}. Vị trí mới, x {x}, y {y}',
  'rf.dir.left': 'trái',
  'rf.dir.right': 'phải',
  'rf.dir.up': 'trên',
  'rf.dir.down': 'dưới',
  'rf.controls.label': 'Điều khiển khung vẽ',
  'rf.controls.zoomIn': 'Phóng to',
  'rf.controls.zoomOut': 'Thu nhỏ',
  'rf.controls.fitView': 'Vừa khít sơ đồ vào khung nhìn',
  'rf.controls.interactive': 'Bật/tắt chỉnh sửa khung vẽ',
  'rf.handle.label': 'Điểm kết nối',
  'rf.node.a11y': 'Nhấn Enter hoặc Space để chọn nút này. Nhấn Delete để xóa, Escape để hủy.',
  'rf.node.a11yKeyboard': 'Nhấn Enter hoặc Space để chọn nút này, rồi dùng các phím mũi tên để di chuyển. Nhấn Delete để xóa, Escape để hủy.',
  'rf.edge.a11y': 'Nhấn Enter hoặc Space để chọn liên kết này. Nhấn Delete để xóa, Escape để hủy.',
} satisfies Record<CanvasKey, string>

export default canvas
