// Excel 總表版面：A4 直式、左右兩組、資料列同高、名稱不換行，依格寬重新計算字級（移植自 web/print_total.py）
window.PlateLayout = (() => {
  const FONT = 14, TITLE_HEIGHT = 26, HEADER_HEIGHT = 22, ROW_HEIGHT = 22;
  const MARGIN_TOP = .32, MARGIN_BOTTOM = .42, MARGIN_SIDE = .30;
  const SERIES = { '一般': '一般版', '中': '中版', '大': '大版' };
  const PAPER = { name: 'portrait', numberWidth: 8, nameWidth: 13.65, height: 841.89 };
  PAPER.budget = PAPER.height - (MARGIN_TOP + MARGIN_BOTTOM) * 72 - TITLE_HEIGHT - HEADER_HEIGHT - 10;
  const FAMILY = '"Microsoft JhengHei","微軟正黑體"';

  const canvas = document.createElement('canvas').getContext('2d');
  const hasJhengHei = (() => {
    const probe = '網版編號Wi1';
    canvas.font = `56px ${FAMILY}, monospace`;
    const a = canvas.measureText(probe).width;
    canvas.font = '56px monospace';
    return Math.abs(a - canvas.measureText(probe).width) > .5;
  })();
  const cache = new Map();

  function emWidth(text) {
    let total = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0);
      if (ch === '\t') total += 3;
      else if ((code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) ||
               (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) ||
               (code >= 0xffe0 && code <= 0xffe6) || code >= 0x20000) total += 1;
      else if (" Ilifj.,:;!'|()".includes(ch)) total += .33;
      else if ('MW@%'.includes(ch)) total += .91;
      else total += .61;
    }
    return FONT * 1.10 * total;
  }

  function textWidth(text, bold = false) {
    const key = (bold ? 'b' : 'n') + text;
    if (cache.has(key)) return cache.get(key);
    let width;
    if (hasJhengHei) {
      canvas.font = `${bold ? 'bold ' : ''}${FONT * 4}px ${FAMILY}`;
      width = canvas.measureText(text).width / 4;
    } else {
      width = emWidth(text);
    }
    cache.set(key, width);
    return width;
  }

  function fittedSize(text, width, span = 1, bold = false) {
    if (!text.trim()) return FONT;
    const available = Math.floor(width * 7) * .75 * span - 7;
    return Math.min(FONT, Math.max(1, Math.floor(2 * FONT * available / textWidth(text, bold)) / 2));
  }

  function columnsFor(record) {
    const names = (record.names.length ? record.names : [record.status]).map(t => t.replace(/\r\n|[\r\n\t]/g, ' '));
    if (names.length > 3) return [[3, names.join(' ／ ')]];
    const options = { 1: [[3]], 2: [[1, 2], [2, 1]], 3: [[1, 1, 1]] }[names.length];
    let best, score = Infinity;
    for (const spans of options) {
      const cells = spans.map((span, i) => [span, names[i]]);
      const s = Math.max(...cells.map(([span, text]) => textWidth(text) / span));
      if (s < score) { score = s; best = cells; }
    }
    return best;
  }

  function preview(names) {
    if (!names.length) return [];
    return columnsFor({ names }).map(([span, text]) => ({ text, span, size: fittedSize(text, PAPER.nameWidth, span) }));
  }

  function preparePages(records) {
    const pages = [];
    const capacity = 2 * Math.floor(PAPER.budget / ROW_HEIGHT);
    const groups = [];
    for (const r of records) {
      if (!groups.length || groups[groups.length - 1][0].series !== r.series) groups.push([]);
      groups[groups.length - 1].push(r);
    }
    for (const group of groups) {
      const series = group.map(r => [r, columnsFor(r)]);
      for (let offset = 0; offset < series.length; offset += capacity) {
        const block = series.slice(offset, offset + capacity);
        const split = Math.ceil(block.length / 2);
        const left = block.slice(0, split), right = block.slice(split);
        const pairs = left.map((entry, i) => [entry, right[i] || null]);
        pages.push([block[0][0], block[block.length - 1][0], pairs]);
      }
    }
    return pages;
  }

  let loading;
  function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    loading = loading || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = resolve;
      s.onerror = () => { loading = null; reject(new Error('Excel 元件下載失敗，請確認網路後再試。')); };
      document.head.append(s);
    });
    return loading;
  }

  async function exportTotal(records) {
    await loadExcelJS();
    const pages = preparePages(records);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('總表', { views: [{ showGridLines: false }] });
    const widths = [PAPER.numberWidth, PAPER.nameWidth, PAPER.nameWidth, PAPER.nameWidth, 2.5,
      PAPER.numberWidth, PAPER.nameWidth, PAPER.nameWidth, PAPER.nameWidth];
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const thin = { style: 'thin', color: { argb: 'FFABB9B3' } };
    const frame = { left: thin, right: thin, top: thin, bottom: thin };
    const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
    const put = (row, col, text, { size = FONT, bold = false, color = '172923', center = false } = {}) => {
      const cell = ws.getCell(row, col);
      cell.value = text;
      cell.font = { name: 'Microsoft JhengHei', size, bold, color: { argb: 'FF' + color } };
      cell.alignment = { vertical: 'middle', horizontal: center ? 'center' : 'left', wrapText: false };
      return cell;
    };

    let row = 1;
    for (const [first, last, pairs] of pages) {
      if (row > 1) ws.getRow(row - 1).addPageBreak();
      ws.mergeCells(row, 1, row, 9);
      put(row, 1, `${SERIES[first.series]}${String(first.sort).padStart(3, '0')}-${String(last.sort).padStart(3, '0')}`, { size: 16, bold: true });
      ws.getRow(row).height = TITLE_HEIGHT;
      row++;
      for (const start of [1, 6]) {
        for (let c = start; c < start + 4; c++) ws.getCell(row, c).border = frame;
        ws.mergeCells(row, start + 1, row, start + 3);
        for (const [c, label] of [[start, '編號'], [start + 1, '名稱']]) {
          const cell = put(row, c, label, { bold: true, center: c === start });
          cell.fill = fill('FFE4ECE8');
          cell.border = frame;
        }
      }
      ws.getRow(row).height = HEADER_HEIGHT;
      row++;
      pairs.forEach((pair, index) => {
        [1, 6].forEach((start, side) => {
          for (let c = start; c < start + 4; c++) {
            const cell = ws.getCell(row, c);
            cell.border = frame;
            if (index % 2) cell.fill = fill('FFF5F7F5');
          }
          const entry = pair[side];
          if (!entry) return;
          const [record, cells] = entry;
          const number = put(row, start, record.number, { bold: true, center: true,
            size: fittedSize(record.number, PAPER.numberWidth, 1, true) });
          number.numFmt = '@';
          if (record.count === null || record.status === '待核對') {
            number.fill = fill('FFD7D7D7');
            number.note = '名稱或狀態待核對。';
          }
          let col = start + 1;
          for (const [span, text] of cells) {
            if (span > 1) ws.mergeCells(row, col, row, col + span - 1);
            const cell = put(row, col, text, { size: fittedSize(text, PAPER.nameWidth, span),
              color: record.names.length ? '172923' : '4B5954' });
            cell.border = frame;
            col += span;
          }
        });
        ws.getRow(row).height = ROW_HEIGHT;
        row++;
      });
    }
    ws.pageSetup = {
      paperSize: 9, orientation: PAPER.name, scale: 100, fitToPage: false, horizontalCentered: true,
      printArea: `A1:I${row - 1}`,
      margins: { left: MARGIN_SIDE, right: MARGIN_SIDE, top: MARGIN_TOP, bottom: MARGIN_BOTTOM, header: .12, footer: .16 },
    };
    ws.headerFooter = { oddFooter: '&L&10灰底編號待核對&R&10第 &P / &N 頁' };
    const buffer = await wb.xlsx.writeBuffer();
    return { blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), pages: pages.length };
  }

  return { preview, exportTotal, hasJhengHei };
})();
