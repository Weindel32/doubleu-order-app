import React, { useEffect, useMemo, useState } from "react";
import "./App.css";
import jsPDF from "jspdf";

type OrderStatus = "BOZZA" | "CONFERMATO";

type SizeChild = "4" | "6" | "8" | "10" | "12" | "14" | "16";
type SizeAdult = "XS" | "S" | "M" | "L" | "XL" | "XXL";
type SizeKey = SizeChild | SizeAdult;

const CHILD_SIZES: SizeChild[] = ["4", "6", "8", "10", "12", "14", "16"];
const ADULT_SIZES: SizeAdult[] = ["XS", "S", "M", "L", "XL", "XXL"];
const ALL_SIZES: SizeKey[] = [...CHILD_SIZES, ...ADULT_SIZES];

type ClientInfo = {
  name: string;
  address: string;
  city: string;
  cap: string;
  country: string;
  email: string;
};

type Item = {
  id: string;
  codeSP: string; // SOLO produzione
  category: string;
  line: string;
  description: string;
  color: string;
  productionNote: string; // nota per articolo (interna)
  qty: Record<SizeKey, number>;
};

type Order = {
  internalId: string; // DU-2026-0001
  status: OrderStatus;
  createdAtISO: string;
  updatedAtISO: string;

  club: string;

  client: ClientInfo;
  clientNote: string; // note per cliente (pdf cliente)
  productionGeneralNote: string; // note generali (interne)

  items: Item[];
};

const LS_CURRENT = "DOUBLEU_ORDER_CURRENT_V1";
const LS_ARCHIVE = "DOUBLEU_ORDER_ARCHIVE_V1";
const LS_COUNTER = "DOUBLEU_ORDER_COUNTER_V1";

function todayISO() {
  return new Date().toISOString();
}
function fmtITDate(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}
function safeParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
function newInternalId(): string {
  const year = new Date().getFullYear();
  const raw = localStorage.getItem(LS_COUNTER);
  const n = Math.max(0, Number(raw || "0")) + 1;
  localStorage.setItem(LS_COUNTER, String(n));
  return `DU-${year}-${String(n).padStart(4, "0")}`;
}
function emptyQty(): Record<SizeKey, number> {
  const q = {} as Record<SizeKey, number>;
  ALL_SIZES.forEach((s) => (q[s] = 0));
  return q;
}
function makeBlankOrder(): Order {
  const now = todayISO();
  return {
    internalId: newInternalId(),
    status: "BOZZA",
    createdAtISO: now,
    updatedAtISO: now,
    club: "",
    client: {
      name: "",
      address: "",
      city: "",
      cap: "",
      country: "",
      email: "",
    },
    clientNote: "",
    productionGeneralNote: "",
    items: [],
  };
}
function uid(prefix = "it") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function sumQty(qty: Record<SizeKey, number>) {
  return ALL_SIZES.reduce((acc, k) => acc + (Number(qty[k]) || 0), 0);
}
function totalPieces(order: Order) {
  return order.items.reduce((acc, it) => acc + sumQty(it.qty), 0);
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** -------------------- PDF HELPERS (senza autotable) -------------------- */
type PdfMode = "download" | "print";

function pdfHeader(doc: jsPDF, title: string, subtitleRight?: string) {
  const w = doc.internal.pageSize.getWidth();
  // top bar
  doc.setFillColor(11, 31, 59);
  doc.rect(0, 0, w, 32, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("DOUBLEU", 14, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(title, 14, 27);

  if (subtitleRight) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const tw = doc.getTextWidth(subtitleRight);
    doc.text(subtitleRight, w - 14 - tw, 27);
  }

  doc.setTextColor(0, 0, 0);
}

function pdfCard(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFillColor(245, 248, 252);
  doc.setDrawColor(220, 230, 245);
  doc.roundedRect(x, y, w, h, 4, 4, "FD");
}

function pdfText(doc: jsPDF, text: string, x: number, y: number, size = 10, bold = false) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.text(text, x, y);
}

function drawTable(
  doc: jsPDF,
  x: number,
  y: number,
  colWidths: number[],
  rowHeights: number[],
  cells: (string | number)[][],
  headerRows = 1
) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);

  let cy = y;
  for (let r = 0; r < cells.length; r++) {
    const rh = rowHeights[r] ?? rowHeights[rowHeights.length - 1] ?? 10;
    let cx = x;
    for (let c = 0; c < colWidths.length; c++) {
      const cw = colWidths[c];
      const isHeader = r < headerRows;

      doc.setDrawColor(220, 230, 245);
      doc.setFillColor(isHeader ? 235 : 255, isHeader ? 242 : 255, isHeader ? 252 : 255);
      doc.rect(cx, cy, cw, rh, "FD");

      const value = cells[r]?.[c] ?? "";
      const str = String(value);

      doc.setFont("helvetica", isHeader ? "bold" : "normal");
      doc.setFontSize(isHeader ? 9 : 9);
      doc.setTextColor(20, 35, 55);

      const tx = cx + 2.5;
      const ty = cy + rh / 2 + 3;

      doc.text(str, tx, ty);

      cx += cw;
    }
    cy += rh;
  }

  // outer border
  doc.setDrawColor(220, 230, 245);
  doc.rect(x, y, totalW, rowHeights.slice(0, cells.length).reduce((a, b) => a + b, 0), "S");
}

function openBlobForPrint(doc: jsPDF) {
  const blobUrl = doc.output("bloburl");
  const w = window.open(blobUrl, "_blank");
  if (!w) return;
  w.addEventListener("load", () => {
    w.focus();
    w.print();
  });
}

function makeClubCode(club: string) {
  const clean = (club || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = clean.split(" ").filter(Boolean);

  if (parts.length === 0) return "CLUB";

  if (parts[0].length <= 2 && parts.length >= 2) {
    return (parts[0] + parts[1]).slice(0, 4);
  }

  return parts[0].slice(0, 3);
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function makeCustomerRef(order: Order) {
  const code = makeClubCode(order?.club || "");
  const d = order?.updatedAtISO ? new Date(order.updatedAtISO) : new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${code}-${yy}${mm}${dd}`;
}
function makeClientPDF(order: Order, mode: PdfMode) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 32;
  const contentW = pageW - margin * 2;
  const customerRef = makeCustomerRef(order);
  pdfHeader(
  doc,
  `Conferma Ordine`,
  `Riferimento: ${customerRef}`
);

  let y = 48;

  // Info card
  pdfCard(doc, margin, y, contentW, 70);
  pdfText(doc, `Club: ${order.club || "-"}`, margin + 12, y + 22, 11, true);
  pdfText(doc, `Data: ${fmtITDate(order.updatedAtISO)}`, margin + 12, y + 40, 10, false);

 // --- BLOCCO CLIENTE PROFESSIONALE ---
let clientY = y + 58;

if (order.client.name?.trim()) {
  pdfText(doc, order.client.name.trim(), margin + 12, clientY, 12);
  clientY += 16;
}

if (order.client.address?.trim()) {
  pdfText(doc, order.client.address.trim(), margin + 12, clientY, 11);
  clientY += 14;
}

if (order.client.cap?.trim() || order.client.city?.trim()) {
  pdfText(
    doc,
    `${order.client.cap || ""} ${order.client.city || ""}`.trim(),
    margin + 12,
    clientY,
    11
  );
  clientY += 14;
}

if (order.client.country?.trim()) {
  pdfText(
    doc,
    `Nazione: ${order.client.country.trim()}`,
    margin + 12,
    clientY,
    11
  );
  clientY += 14;
}
// --- FINE INDIRIZZO ---
  y += 120;

  // Riepilogo articoli
  pdfText(doc, "Riepilogo articoli", margin, y, 12, true);
  y += 10;

  const items = order.items;

  // --- CHILD TABLE
  const childRows: (string | number)[][] = [];
  childRows.push(["Articolo", ...CHILD_SIZES]);
  items.forEach((it) => {
    const name = `${it.description || it.category}${it.color ? " • " + it.color : ""}`;
    childRows.push([name, ...CHILD_SIZES.map((s) => it.qty[s] || 0)]);
  });
  // totals row
  const childTotals = CHILD_SIZES.map((s) => items.reduce((acc, it) => acc + (it.qty[s] || 0), 0));
  childRows.push(["Totali per taglia", ...childTotals]);

  const colWChild = [180, ...CHILD_SIZES.map(() => (contentW - 180) / CHILD_SIZES.length)];
  const rowHChild = childRows.map((_, i) => (i === 0 ? 18 : i === childRows.length - 1 ? 18 : 18));

  pdfText(doc, "Taglie Bambino", margin, y + 22, 10, true);
  drawTable(doc, margin, y + 30, colWChild, rowHChild, childRows, 1);
  y += 30 + rowHChild.reduce((a, b) => a + b, 0) + 18;

  // --- ADULT TABLE
  const adultRows: (string | number)[][] = [];
  adultRows.push(["Articolo", ...ADULT_SIZES]);
  items.forEach((it) => {
    const name = `${it.description || it.category}${it.color ? " • " + it.color : ""}`;
    adultRows.push([name, ...ADULT_SIZES.map((s) => it.qty[s] || 0)]);
  });
  const adultTotals = ADULT_SIZES.map((s) => items.reduce((acc, it) => acc + (it.qty[s] || 0), 0));
  adultRows.push(["Totali per taglia", ...adultTotals]);

  const colWAdult = [180, ...ADULT_SIZES.map(() => (contentW - 180) / ADULT_SIZES.length)];
  const rowHAdult = adultRows.map(() => 18);

  pdfText(doc, "Taglie Adulto", margin, y + 22, 10, true);
  drawTable(doc, margin, y + 30, colWAdult, rowHAdult, adultRows, 1);
  y += 30 + rowHAdult.reduce((a, b) => a + b, 0) + 18;

  // Note cliente + CGV on page 2 if needed
  doc.addPage();
  pdfHeader(doc, `BOZZA ORDINE • ${fmtITDate(order.updatedAtISO)}`);

  let y2 = 54;
  pdfText(doc, "Note", margin, y2 + 10, 12, true);
  y2 += 20;

  pdfCard(doc, margin, y2, contentW, 80);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const note = order.clientNote?.trim() ? order.clientNote.trim() : "-";
  doc.text(doc.splitTextToSize(note, contentW - 24), margin + 12, y2 + 22);
  y2 += 100;

  pdfText(doc, "Verifica e conferma", margin, y2, 12, true);
  y2 += 14;
  pdfText(
    doc,
    "Ti prego di verificare attentamente quantità e taglie. L’ordine entrerà in produzione solo dopo conferma scritta.",
    margin,
    y2,
    10,
    false
  );
  y2 += 24;

  pdfText(doc, "Condizioni Generali di Vendita", margin, y2, 12, true);
  y2 += 12;

  const cgv = [
    "1. Le quantità e le taglie devono essere verificate prima della conferma definitiva.",
    "2. L’ordine entrerà in produzione solo dopo conferma scritta.",
    "3. Eventuali modifiche successive alla conferma potranno comportare variazioni di costo e tempistiche.",
    "4. I tempi di consegna decorrono dalla conferma definitiva.",
    "5. I prodotti personalizzati non sono soggetti a reso.",
  ];
  doc.setFontSize(10);
  doc.text(cgv, margin, y2 + 14);

  if (mode === "print") openBlobForPrint(doc);
  else doc.save(`DOUBLEU_ordine_${order.club || "cliente"}_${fmtITDate(order.updatedAtISO).replaceAll("/", "-")}.pdf`);
}

function makeProductionPDF(order: Order, mode: PdfMode) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 32;
  const contentW = pageW - margin * 2;

  pdfHeader(doc, `PRODUZIONE • ${fmtITDate(order.updatedAtISO)}`, `Ordine interno: ${order.internalId}`);

  let y = 48;

  pdfCard(doc, margin, y, contentW, 80);
  pdfText(doc, `Club: ${order.club || "-"}`, margin + 12, y + 22, 11, true);
  pdfText(doc, `Data: ${fmtITDate(order.updatedAtISO)}`, margin + 12, y + 40, 10, false);
  pdfText(doc, `Stato: ${order.status}`, margin + 12, y + 56, 10, false);
  pdfText(doc, `Totale pezzi: ${totalPieces(order)}`, margin + 12, y + 72, 10, true);
  y += 96;

  // Note generali produzione
  pdfText(doc, "Note generali produzione (interne)", margin, y, 12, true);
  y += 10;
  pdfCard(doc, margin, y + 8, contentW, 70);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const pnote = order.productionGeneralNote?.trim() ? order.productionGeneralNote.trim() : "-";
  doc.text(doc.splitTextToSize(pnote, contentW - 24), margin + 12, y + 28);
  y += 98;

  // Per ogni articolo: blocco con SP, descrizione, note + tabelle qty
  order.items.forEach((it, idx) => {
    // page break
    if (y > 640) {
      doc.addPage();
      pdfHeader(doc, `PRODUZIONE • ${fmtITDate(order.updatedAtISO)}`, `Ordine interno: ${order.internalId}`);
      y = 48;
    }

    pdfCard(doc, margin, y, contentW, 118);
    pdfText(doc, `${it.category} • ${it.line} • ${it.color}`, margin + 12, y + 22, 11, true);
    pdfText(doc, `Descrizione: ${it.description || "-"}`, margin + 12, y + 40, 10, false);
    pdfText(doc, `Codice modellista (SP): ${it.codeSP || "-"}`, margin + 12, y + 58, 10, true);
    pdfText(doc, `Nota produzione (articolo): ${it.productionNote?.trim() ? it.productionNote.trim() : "-"}`, margin + 12, y + 76, 10, false);
    pdfText(doc, `Totale articolo: ${sumQty(it.qty)}`, margin + 12, y + 96, 10, true);

    y += 130;

    // Tables (child + adult)
    const childRows: (string | number)[][] = [];
    childRows.push(["Taglie Bambino", ...CHILD_SIZES]);
    childRows.push(["Q.tà", ...CHILD_SIZES.map((s) => it.qty[s] || 0)]);

    const colWChild = [120, ...CHILD_SIZES.map(() => (contentW - 120) / CHILD_SIZES.length)];
    const rowHChild = [18, 18];
    drawTable(doc, margin, y, colWChild, rowHChild, childRows, 1);
    y += rowHChild.reduce((a, b) => a + b, 0) + 10;

    const adultRows: (string | number)[][] = [];
    adultRows.push(["Taglie Adulto", ...ADULT_SIZES]);
    adultRows.push(["Q.tà", ...ADULT_SIZES.map((s) => it.qty[s] || 0)]);

    const colWAdult = [120, ...ADULT_SIZES.map(() => (contentW - 120) / ADULT_SIZES.length)];
    const rowHAdult = [18, 18];
    drawTable(doc, margin, y, colWAdult, rowHAdult, adultRows, 1);
    y += rowHAdult.reduce((a, b) => a + b, 0) + 18;

    if (idx < order.items.length - 1) {
      doc.setDrawColor(230, 238, 250);
      doc.line(margin, y, margin + contentW, y);
      y += 14;
    }
  });

  if (mode === "print") openBlobForPrint(doc);
  else doc.save(`DOUBLEU_PRODUZIONE_${order.internalId}_${fmtITDate(order.updatedAtISO).replaceAll("/", "-")}.pdf`);
}

/** -------------------- APP -------------------- */

export default function App() {
  const [order, setOrder] = useState<Order>(() => {
    const saved = safeParse<Order>(localStorage.getItem(LS_CURRENT));
    return saved ?? makeBlankOrder();
  });

  const [archive, setArchive] = useState<Order[]>(() => safeParse<Order[]>(localStorage.getItem(LS_ARCHIVE)) ?? []);

  // autosave current order
  useEffect(() => {
    localStorage.setItem(LS_CURRENT, JSON.stringify(order));
  }, [order]);

  useEffect(() => {
    localStorage.setItem(LS_ARCHIVE, JSON.stringify(archive));
  }, [archive]);

  const total = useMemo(() => totalPieces(order), [order]);

  function touch(partial: Partial<Order>) {
    setOrder((o) => ({
      ...o,
      ...partial,
      updatedAtISO: todayISO(),
    }));
  }

  function updateClient(partial: Partial<ClientInfo>) {
    setOrder((o) => ({
      ...o,
      client: { ...o.client, ...partial },
      updatedAtISO: todayISO(),
    }));
  }

  function addItem(asSet: boolean) {
    const base: Item = {
      id: uid("item"),
      codeSP: form.codeSP,
      category: form.category,
      line: form.line,
      description: form.description,
      color: form.color,
      productionNote: "",
      qty: emptyQty(),
    };

    const itemsToAdd: Item[] = asSet
      ? [
          { ...deepClone(base), id: uid("item"), description: `${base.description} (set)` },
          { ...deepClone(base), id: uid("item"), category: "Pantalone", description: `Pantalone ${base.description} (set)` },
        ]
      : [base];

    setOrder((o) => ({
      ...o,
      items: [...o.items, ...itemsToAdd],
      updatedAtISO: todayISO(),
    }));
  }

  function removeItem(id: string) {
    setOrder((o) => ({
      ...o,
      items: o.items.filter((it) => it.id !== id),
      updatedAtISO: todayISO(),
    }));
  }

  function updateItem(id: string, partial: Partial<Item>) {
    setOrder((o) => ({
      ...o,
      items: o.items.map((it) => (it.id === id ? { ...it, ...partial } : it)),
      updatedAtISO: todayISO(),
    }));
  }

  function updateQty(id: string, size: SizeKey, value: number) {
    const v = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    setOrder((o) => ({
      ...o,
      items: o.items.map((it) =>
        it.id === id ? { ...it, qty: { ...it.qty, [size]: v } } : it
      ),
      updatedAtISO: todayISO(),
    }));
  }

  function confirmOrder() {
    touch({ status: "CONFERMATO" });
  }

  function saveToArchive() {
    const snap = deepClone(order);
    setArchive((a) => [snap, ...a].slice(0, 200));
  }

  function loadFromArchive(idx: number) {
    const chosen = archive[idx];
    if (!chosen) return;
    setOrder(deepClone(chosen));
  }

  function deleteFromArchive(idx: number) {
    setArchive((a) => a.filter((_, i) => i !== idx));
  }

  function duplicateOrder() {
    const clone = deepClone(order);
    clone.internalId = newInternalId();
    clone.status = "BOZZA";
    clone.createdAtISO = todayISO();
    clone.updatedAtISO = todayISO();
    // new item ids
    clone.items = clone.items.map((it) => ({ ...it, id: uid("item") }));
    setOrder(clone);
  }

  function newOrder() {
    setOrder(makeBlankOrder());
  }

  function exportOrderJSON() {
    const data = JSON.stringify(order, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DOUBLEU_ordine_${order.internalId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  function exportArchiveJSON() {
    const data = JSON.stringify(archive, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DOUBLEU_archivio.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  async function importJSON(file: File | null) {
    if (!file) return;
    const text = await file.text();
    const parsed = safeParse<any>(text);
    if (!parsed) {
      alert("JSON non valido.");
      return;
    }
    // if it's an archive array
    if (Array.isArray(parsed)) {
      setArchive(parsed as Order[]);
      alert("Archivio importato.");
      return;
    }
    // else assume single order
    setOrder(parsed as Order);
    alert("Ordine importato.");
  }

  function pdfCliente(mode: PdfMode) {
    makeClientPDF(order, mode);
  }
  function pdfProduzione(mode: PdfMode) {
    makeProductionPDF(order, mode);
  }

  // form add item
  const [form, setForm] = useState({
    codeSP: "",
    category: "Felpa",
    line: "Performance",
    description: "",
    color: "Navy",
  });

  const statusClass = order.status === "CONFERMATO" ? "pill ok" : "pill warn";

  return (
    <div className="page">
      <div className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-title">DOUBLEU Order App</div>
            <div className="pills">
              <div className="pill dark">Ordine interno: <b>{order.internalId}</b></div>
              <div className="pill dark">Totale: <b>{total} pz</b></div>
              <div className={statusClass}>Stato: <b>{order.status}</b></div>
            </div>
          </div>

          <div className="actions">
            <button className="btn primary" onClick={confirmOrder}>Conferma ordine</button>
            <button className="btn" onClick={saveToArchive}>Salva</button>
            <ArchiveMenu
              archive={archive}
              onLoad={loadFromArchive}
              onDelete={deleteFromArchive}
            />
            <button className="btn" onClick={duplicateOrder}>Duplica</button>
            <button className="btn" onClick={newOrder}>Nuovo</button>
          </div>

          <div className="actions secondary">
            <button className="btn white" onClick={() => pdfCliente("download")}>PDF Cliente</button>
            <button className="btn" onClick={() => pdfCliente("print")}>Stampa Cliente</button>
            <button className="btn white" onClick={() => pdfProduzione("download")}>PDF Produzione</button>
            <button className="btn" onClick={() => pdfProduzione("print")}>Stampa Produzione</button>
            <button className="btn" onClick={exportOrderJSON}>Export ordine</button>
            <button className="btn" onClick={exportArchiveJSON}>Export archivio</button>

            <label className="btn file">
              Import JSON
              <input
                type="file"
                accept="application/json"
                onChange={(e) => importJSON(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="content">
        <div className="card">
          <div className="field">
            <label>Club</label>
            <input
              value={order.club}
              onChange={(e) => touch({ club: e.target.value })}
              placeholder="Es. Tennis club"
            />
          </div>
        </div>

        <div className="grid2">
          <div className="card">
            <div className="card-title">Dati cliente / spedizione (facoltativi)</div>
            <div className="grid3">
              <div className="field">
                <label>Nome cliente</label>
                <input value={order.client.name} onChange={(e) => updateClient({ name: e.target.value })} placeholder="Nome" />
              </div>
              <div className="field">
                <label>Indirizzo</label>
                <input value={order.client.address} onChange={(e) => updateClient({ address: e.target.value })} placeholder="Via, n..." />
              </div>
              <div className="field">
                <label>Città</label>
                <input value={order.client.city} onChange={(e) => updateClient({ city: e.target.value })} placeholder="Città" />
              </div>
              <div className="field">
                <label>CAP</label>
                <input value={order.client.cap} onChange={(e) => updateClient({ cap: e.target.value })} placeholder="Es. 46001" />
              </div>
              <div className="field">
                <label>Nazione</label>
                <input value={order.client.country} onChange={(e) => updateClient({ country: e.target.value })} placeholder="Es. Italia" />
              </div>
              <div className="field">
                <label>Email</label>
                <input value={order.client.email} onChange={(e) => updateClient({ email: e.target.value })} placeholder="nome@email.com" />
              </div>
            </div>
            <div className="hint">Se lasci vuoti questi campi, non compariranno nel PDF Cliente.</div>
          </div>

          <div className="card">
            <div className="card-title">Note</div>
            <div className="field">
              <label>Note per il cliente (facoltative)</label>
              <textarea
                rows={3}
                value={order.clientNote}
                onChange={(e) => touch({ clientNote: e.target.value })}
                placeholder="Es. consegna stimata in 35 gg lavorativi"
              />
            </div>

            <div className="divider" />

            <div className="field">
              <label>Note generali produzione (interne)</label>
              <textarea
                rows={3}
                value={order.productionGeneralNote}
                onChange={(e) => touch({ productionGeneralNote: e.target.value })}
                placeholder="Es. Felpa con piping bianco su manica raglan"
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Condizioni Generali di Vendita (PDF Cliente)</div>
          <ol className="cgv">
            <li>Le quantità e le taglie devono essere verificate prima della conferma definitiva.</li>
            <li>L’ordine entrerà in produzione solo dopo conferma scritta.</li>
            <li>Eventuali modifiche successive alla conferma potranno comportare variazioni di costo e tempistiche.</li>
            <li>I tempi di consegna decorrono dalla conferma definitiva.</li>
            <li>I prodotti personalizzati non sono soggetti a reso.</li>
          </ol>
        </div>

        <div className="card">
          <div className="card-title">Aggiungi Articolo</div>

          <div className="add-grid">
            <div className="field">
              <label>Codice modellista (SP) (solo per PDF produzione)</label>
              <input value={form.codeSP} onChange={(e) => setForm((f) => ({ ...f, codeSP: e.target.value }))} placeholder="Es. SP 206" />
            </div>
            <div className="field">
              <label>Categoria</label>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                <option>Felpa</option>
                <option>T-shirt</option>
                <option>Polo</option>
                <option>Pantalone</option>
                <option>Gonna</option>
                <option>Abito</option>
                <option>Tuta</option>
              </select>
            </div>
            <div className="field">
              <label>Linea</label>
              <select value={form.line} onChange={(e) => setForm((f) => ({ ...f, line: e.target.value }))}>
                <option>Performance</option>
                <option>Essential</option>
              </select>
            </div>
            <div className="field">
              <label>Descrizione</label>
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Es. felpa zip cappuccio" />
            </div>
            <div className="field">
              <label>Colore</label>
              <input value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} placeholder="Navy" />
            </div>

            <div className="add-actions">
              <button className="btn primary" onClick={() => addItem(false)}>Aggiungi</button>
              <button className="btn soft" onClick={() => addItem(true)}>+ Set (Felpa + Pantalone)</button>
            </div>
          </div>

          <div className="hint">
            Il PDF Cliente non mostra il numero ordine interno. Il PDF Produzione include SP + DU, note e ordine interno.
          </div>
        </div>

        <div className="card">
          <div className="card-title">Articoli</div>

          {order.items.length === 0 ? (
            <div className="empty">Nessun articolo ancora. Aggiungi il primo articolo sopra.</div>
          ) : (
            <div className="items">
              {order.items.map((it) => (
                <div className="itemCard" key={it.id}>
                  <div className="itemTop">
                    <div>
                      <div className="itemName">{it.category}{it.description ? ` • ${it.description}` : ""}</div>
                      <div className="itemMeta">
                        <span>{it.category}</span> • <span>{it.line}</span> • <span>Colore: <b>{it.color || "-"}</b></span> •{" "}
                        <span>DU: <b>{order.internalId}</b></span> •{" "}
                        <span>Totale articolo: <b>{sumQty(it.qty)}</b></span>
                      </div>
                    </div>
                    <button className="btn danger" onClick={() => removeItem(it.id)}>Elimina</button>
                  </div>

                  <div className="field">
                    <label>Nota produzione (per articolo) (interna)</label>
                    <input
                      value={it.productionNote}
                      onChange={(e) => updateItem(it.id, { productionNote: e.target.value })}
                      placeholder="Es. stampa lato cuore, variante bordino, zip, ecc."
                    />
                  </div>

                  {/* Riquadro sfondo + griglia quantità DENTRO */}
                  <div className="qtyBox">
                    <div className="qtyTitle">Quantità per taglia</div>

                    <div className="qtySectionTitle">Taglie Bambino</div>
                    <div className="qtyGrid">
                      {CHILD_SIZES.map((s) => (
                        <QtyCell
                          key={s}
                          label={s}
                          value={it.qty[s] || 0}
                          onChange={(v) => updateQty(it.id, s, v)}
                        />
                      ))}
                    </div>

                    <div className="qtySectionTitle">Taglie Adulto</div>
                    <div className="qtyGrid">
                      {ADULT_SIZES.map((s) => (
                        <QtyCell
                          key={s}
                          label={s}
                          value={it.qty[s] || 0}
                          onChange={(v) => updateQty(it.id, s, v)}
                        />
                      ))}
                    </div>

                    <div className="qtyFooter">
                      <div className="muted">
                        Codice (solo PDF Produzione): <b>{it.codeSP?.trim() ? it.codeSP : "—"}</b>
                      </div>
                      <button
                        className="btn link"
                        onClick={() => {
                          const v = prompt("Inserisci / modifica codice SP (solo produzione):", it.codeSP || "");
                          if (v === null) return;
                          updateItem(it.id, { codeSP: v });
                        }}
                      >
                        Modifica
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="foot">
          <div className="muted">
            Autosalvataggio attivo • Ultimo update: {fmtITDate(order.updatedAtISO)}
          </div>
        </footer>
      </div>
    </div>
  );
}

function QtyCell(props: { label: string; value: number; onChange: (v: number) => void }) {
  const { label, value, onChange } = props;

  function dec() {
    onChange(Math.max(0, (value || 0) - 1));
  }
  function inc() {
    onChange((value || 0) + 1);
  }

  return (
    <div className="qtyCell">
      <div className="qtyLabel">{label}</div>
      <div className="qtyControls">
        <button className="mini" onClick={dec} aria-label="meno">−</button>
        <input
          className="qtyInput"
          value={String(value ?? 0)}
          inputMode="numeric"
          onChange={(e) => {
            const n = Number(e.target.value.replace(/[^\d]/g, ""));
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
        <button className="mini" onClick={inc} aria-label="più">+</button>
      </div>
    </div>
  );
}

function ArchiveMenu(props: {
  archive: Order[];
  onLoad: (idx: number) => void;
  onDelete: (idx: number) => void;
}) {
  const { archive, onLoad, onDelete } = props;
  const [open, setOpen] = useState(false);

  return (
    <div className="archWrap">
      <button className="btn" onClick={() => setOpen((v) => !v)}>Archivio</button>
      {open && (
        <div className="archPanel" onMouseLeave={() => setOpen(false)}>
          {archive.length === 0 ? (
            <div className="archEmpty">Archivio vuoto.</div>
          ) : (
            archive.slice(0, 20).map((o, idx) => (
              <div className="archRow" key={o.internalId + "_" + idx}>
                <button className="archBtn" onClick={() => { onLoad(idx); setOpen(false); }}>
                  <div className="archTitle">
                    <b>{o.club || "—"}</b> <span className="muted">({o.internalId})</span>
                  </div>
                  <div className="archMeta">
                    Totale {o.items.reduce((a, it) => a + Object.values(it.qty).reduce((x, y) => x + (y || 0), 0), 0)} pz •{" "}
                    {fmtITDate(o.updatedAtISO)} • <span className={o.status === "CONFERMATO" ? "pill ok miniPill" : "pill warn miniPill"}>{o.status}</span>
                  </div>
                </button>
                <button className="archDel" onClick={() => onDelete(idx)} title="Rimuovi da archivio">✕</button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}