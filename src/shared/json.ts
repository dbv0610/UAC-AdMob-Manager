// Đọc / định dạng chuỗi JSON (giá trị Remote Config kiểu JSON). Dùng chung main + renderer.

// Tìm vị trí lỗi đầu tiên (JSON.parse của V8 mới không còn báo vị trí cho mọi lỗi)
function findError(s: string): { pos: number; what: string } {
  let i = 0;
  const fail = (what: string): never => {
    throw { pos: i, what };
  };
  const ws = () => {
    while (i < s.length && ' \t\n\r'.includes(s[i])) i++;
  };
  const str = () => {
    i++; // "
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\n') fail('Chuỗi chưa đóng ngoặc kép');
      i += s[i] === '\\' ? 2 : 1;
    }
    if (s[i] !== '"') fail('Chuỗi chưa đóng ngoặc kép');
    i++;
  };
  const value = (): void => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++;
      ws();
      if (s[i] === '}') return void i++;
      for (;;) {
        ws();
        if (s[i] !== '"') fail('Cần tên khóa trong ngoặc kép');
        str();
        ws();
        if (s[i] !== ':') fail('Thiếu dấu “:” sau tên khóa');
        i++;
        value();
        ws();
        if (s[i] === ',') {
          i++;
          ws();
          if (s[i] === '}') fail('Dư dấu phẩy trước “}”');
          continue;
        }
        if (s[i] === '}') return void i++;
        fail('Thiếu dấu phẩy hoặc “}”');
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (s[i] === ']') return void i++;
      for (;;) {
        value();
        ws();
        if (s[i] === ',') {
          i++;
          ws();
          if (s[i] === ']') fail('Dư dấu phẩy trước “]”');
          continue;
        }
        if (s[i] === ']') return void i++;
        fail('Thiếu dấu phẩy hoặc “]”');
      }
    }
    if (c === '"') return str();
    const lit = s.slice(i).match(/^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)/);
    if (lit) return void (i += lit[0].length);
    fail(i >= s.length ? 'JSON kết thúc đột ngột' : `Ký tự không hợp lệ “${c}”`);
  };
  try {
    value();
    ws();
    if (i < s.length) fail('Thừa nội dung sau JSON');
  } catch (e) {
    if (e && typeof e === 'object' && 'pos' in e) return e as { pos: number; what: string };
    throw e;
  }
  return { pos: 0, what: 'JSON không hợp lệ' };
}

export function parseJson(s: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    const { pos, what } = findError(s);
    const before = s.slice(0, pos).split('\n');
    return { ok: false, error: `Dòng ${before.length}, cột ${before.at(-1)!.length + 1}: ${what}` };
  }
}

export const prettyJson = (s: string) => {
  const p = parseJson(s);
  return p.ok ? JSON.stringify(p.value, null, 2) : s;
};
export const isJsonLike = (s: string) => /^\s*[[{]/.test(s) && parseJson(s).ok;

// Giữ kiểu viết gốc khi lưu: gốc một dòng thì thu gọn, gốc nhiều dòng thì 2 khoảng trắng; nội dung không đổi thì trả lại đúng chuỗi gốc
export function keepStyle(original: string, edited: string) {
  const a = parseJson(original);
  const b = parseJson(edited);
  if (!b.ok) return edited;
  if (a.ok && JSON.stringify(a.value) === JSON.stringify(b.value)) return original;
  return original.includes('\n') ? JSON.stringify(b.value, null, 2) : JSON.stringify(b.value);
}
