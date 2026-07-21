/**
 * JPEG → 단순 다페이지 PDF (의존성 없음).
 * A4 폭에 맞추고 길면 여러 장으로 나눈다.
 */
export function writeJpegPdf(jpeg: Buffer, imgWidth: number, imgHeight: number): Buffer {
  const pageW = 595;
  const pageH = 842;
  const margin = 18;
  const fitW = pageW - margin * 2;
  const fitH = pageH - margin * 2;
  const scale = Math.min(fitW / imgWidth, 1);
  const drawW = imgWidth * scale;
  const drawH = imgHeight * scale;
  const pages = Math.max(1, Math.ceil(drawH / fitH));

  type Obj = { id: number; body: Buffer };
  const objs: Obj[] = [];
  let idSeq = 0;
  const nextId = () => ++idSeq;

  const catalogId = nextId();
  const pagesId = nextId();
  const imageId = nextId();
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (let i = 0; i < pages; i++) {
    pageIds.push(nextId());
    contentIds.push(nextId());
  }

  objs.push({
    id: catalogId,
    body: Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`),
  });
  objs.push({
    id: pagesId,
    body: Buffer.from(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`,
    ),
  });

  const imgDict =
    `<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`;
  objs.push({
    id: imageId,
    body: Buffer.concat([
      Buffer.from(`${imgDict}\nstream\n`),
      jpeg,
      Buffer.from('\nendstream'),
    ]),
  });

  for (let i = 0; i < pages; i++) {
    const x = margin + (fitW - drawW) / 2;
    const y = pageH - margin - drawH + i * fitH;
    const stream = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    objs.push({
      id: contentIds[i],
      body: Buffer.concat([
        Buffer.from(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n`),
        Buffer.from(stream),
        Buffer.from('\nendstream'),
      ]),
    });
    objs.push({
      id: pageIds[i],
      body: Buffer.from(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
          `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`,
      ),
    });
  }

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  for (const obj of objs.sort((a, b) => a.id - b.id)) {
    offsets[obj.id] = parts.reduce((n, b) => n + b.length, 0);
    parts.push(Buffer.from(`${obj.id} 0 obj\n`), obj.body, Buffer.from('\nendobj\n'));
  }
  const xrefPos = parts.reduce((n, b) => n + b.length, 0);
  let xref = `xref\n0 ${idSeq + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= idSeq; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  parts.push(Buffer.from(xref));
  parts.push(
    Buffer.from(
      `trailer\n<< /Size ${idSeq + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
