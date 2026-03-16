import  { useEffect, useMemo, useState } from "react";
import "./App.css";
import jsPDF from "jspdf";

const APP_VERSION = "v1.1.4";
const APP_PASSWORD = "Worder2026";

type OrderStatus = "PREVENTIVO" | "CONFERMATO" | "CONSEGNA PARZIALE" | "CONSEGNATO";

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
type Payment = {
  date: string;
  amount: number;
  method: string;
  note?: string;
};
type CommercialRow = {
  description: string;
  price: number;
  qty: number;
};
type Order = {
  internalId: string; // DU-2026-0001
  status: OrderStatus;
  createdAtISO: string;
  updatedAtISO: string;

  club: string;
  // --- Commerciale interno (non per cliente) ---
  kitName: string;        // es. "KIT 4 capi"
  kitUnitPrice: number;   // prezzo kit (es. 90)
  kitQty: number;         // quantità kit (es. 120)
  currency: "EUR";
  payments: Payment[];
  commercialRows: CommercialRow[];

    vatEnabled: boolean; // IVA facoltativa
  vatRate: number;     // es. 22
showKitTotalOnClientPdf: boolean;
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
    status: "PREVENTIVO",
    createdAtISO: now,
    updatedAtISO: now,

    club: "",
    payments: [],
    commercialRows: [],
    client: {
      name: "",
      address: "",
      city: "",
      cap: "",
      country: "",
      email: "",
    },

    // --- Commerciale interno ---
    kitName: "KIT",
    kitUnitPrice: 0,
    kitQty: 0,
    currency: "EUR",

    // IVA facoltativa
    vatEnabled: false,
    vatRate: 22,
showKitTotalOnClientPdf: false,
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
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function kitSubtotal(order: Order) {
  return round2((order.kitUnitPrice || 0) * (order.kitQty || 0));
}

function kitVatAmount(order: Order) {
  if (!order.vatEnabled) return 0;
  const rate = (order.vatRate || 0) / 100;
  return round2(kitSubtotal(order) * rate);
}

function kitTotal(order: Order) {
  return round2(kitSubtotal(order) + kitVatAmount(order));
}
/** -------------------- PDF HELPERS (senza autotable) -------------------- */
type PdfMode = "download" | "print";

function pdfHeader(
  doc: jsPDF,
  _title: string,
  subtitleRight?: string,
  accent?: { r: number; g: number; b: number }
) {
  const w = doc.internal.pageSize.getWidth();
  // top bar
  const a = accent ?? { r: 11, g: 31, b: 59 };
  doc.setFillColor(a.r, a.g, a.b);
  doc.rect(0, 0, w, 32, "F");
  doc.setDrawColor(255, 255, 255);
doc.setLineWidth(0.4);
doc.line(0, 32, w, 32);
doc.setDrawColor(255, 255, 255);
doc.setLineWidth(0.6);
doc.line(0, 32, w, 32);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("DOUBLEU", 14, 20);
doc.setFontSize(8.5);
doc.setFont("helvetica", "normal");
doc.setTextColor(235, 235, 235);
doc.text("MADE IN ITALY · PREMIUM CLUBWEAR", 14, 29);
doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
doc.setFontSize(12);
doc.setFont("helvetica", "normal");

  if (subtitleRight) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(subtitleRight, w - 14, 20, { align: "right" });
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
function getClubAccentColor(club?: string): { r: number; g: number; b: number } {
  const key = (club || "").trim().toLowerCase();

  const DEFAULT = { r: 11, g: 32, b: 59 };

  const MAP: Record<string, { r: number; g: number; b: number }> = {
    "eco village": { r: 11, g: 32, b: 59 },
  };

  return MAP[key] || DEFAULT;
}

function makeClientPDF(order: Order, mode: PdfMode) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const accent = getClubAccentColor(order.club);
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 32;
  const contentW = pageW - margin * 2;
  const customerRef = makeCustomerRef(order);
  const title = "Dettaglio Ordine";
 pdfHeader(
  doc,
  title,
  `Riferimento: ${customerRef}`,
  accent
);

  let y = 48;
  // Info card
  pdfCard(doc, margin, y, contentW, 70);
  pdfText(doc, `Club: ${order.club || "-"}`, margin + 12, y + 22, 11, true);
  pdfText(doc, `Data: ${fmtITDate(order.updatedAtISO)}`, margin + 12, y + 40, 10, false);
// dopo Club e Data
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  // --- Totale ordine (da KIT) - opzionale ---
const hasKitPrice =
  (order.kitUnitPrice || 0) > 0 &&
  (order.kitQty || 0) > 0;

console.log("PDF CLIENT", {
  kitUnitPrice: order.kitUnitPrice,
  kitQty: order.kitQty,
  show: order.showKitTotalOnClientPdf,
  hasKitPrice,
});
if (hasKitPrice) {
  // Totale KIT: lo stampiamo più sotto (sotto "DETTAGLIO ORDINE") per evitare sovrapposizioni
}

  // NON stampare qui
  // lo stampiamo più sotto, sotto "DETTAGLIO ORDINE"



// reset
doc.setTextColor(0, 0, 0);
doc.setFont("helvetica", "normal");

  doc.setFont("helvetica", "normal");

if (hasKitPrice) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(25, 35, 50);





  doc.setTextColor(0, 0, 0);
}
  // --- BLOCCO CLIENTE PROFESSIONALE ---
let clientY = y + 58;
// calcolo altezza blocco cliente
let blockHeight = 0;

if (order.client.name?.trim()) blockHeight += 16;
if (order.client.address?.trim()) blockHeight += 14;
if (order.client.cap?.trim() || order.client.city?.trim()) blockHeight += 14;
if (order.client.country?.trim()) blockHeight += 14;
if (order.client.email?.trim()) blockHeight += 14;

// disegno sfondo unico (anti-banding)
doc.setFillColor(243, 244, 246);

// 1) rettangolo pieno sotto (super stabile)
doc.rect(margin, clientY - 12, contentW, blockHeight + 16, "F");

// 2) opzionale: rounded sopra per estetica (stesso colore)
doc.roundedRect(margin, clientY - 12, contentW, blockHeight + 16, 6, 6, "F");
const rightX = margin + contentW - 12;

if (order.client.name?.trim()) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(order.client.name.trim(), rightX, clientY, { align: "right" });
  clientY += 16;
}

doc.setFont("helvetica", "normal");
doc.setFontSize(12);

if (order.client.address?.trim()) {
  doc.text(order.client.address.trim(), rightX, clientY, { align: "right" });
  clientY += 14;
}

if (order.client.cap?.trim() || order.client.city?.trim()) {
  const capCity = `${order.client.cap || ""} ${order.client.city || ""}`.trim();
  doc.text(capCity, rightX, clientY, { align: "right" });
  clientY += 14;
}

if (order.client.country?.trim()) {
  doc.text(order.client.country.trim(), rightX, clientY, { align: "right" });
  clientY += 14;
}

if (order.client.email?.trim()) {
  doc.text(order.client.email.trim(), rightX, clientY, { align: "right" });
  clientY += 14;

}

y = Math.max(y, clientY) + 20;




// --- FINE INDIRIZZO ---
// porta y appena sotto l’ultimo elemento stampato nel blocco cliente
y = Math.max(y, clientY) + 24;   // prova 24 (più vicino). Se lo vuoi ancora più su: 18.

// Riepilogo articoli

// Spazio maggiore tra indirizzo e titolo
y += 18;

// Titolo
doc.setFont("helvetica", "normal");
doc.setFontSize(13);
doc.setTextColor(70, 70, 70);
doc.text("DETTAGLIO ORDINE", margin, y);

// Linea proporzionata
doc.setDrawColor(220, 220, 220);
doc.setLineWidth(0.5);
doc.line(margin, y + 6, margin + contentW, y + 6);
// Totale ordine sotto la linea, a destra
if (order.showKitTotalOnClientPdf && hasKitPrice) {
  const subtotal = kitSubtotal(order);
  const total = kitTotal(order);
  const euro = (n: number) => n.toFixed(2).replace(".", ",");

  const text = order.vatEnabled
    ? `Totale ordine (IVA incl.): € ${euro(total)}`
    : `Totale ordine: € ${euro(subtotal)}`;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(25, 35, 50);

  // y + 18 = sotto la linea (linea è a y+6)
  doc.text(text, margin + contentW, y + 18, { align: "right" });

  doc.setTextColor(0, 0, 0);
}
// Reset
doc.setFontSize(11);
doc.setTextColor(0, 0, 0);

y += 22;

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
const statusLabel =
  order.status === "PREVENTIVO"
    ? "Preventivo"
    : order.status === "CONFERMATO"
    ? "Ordine Confermato"
    : order.status === "CONSEGNA PARZIALE"
    ? "Consegna Parziale"
    : "Ordine Consegnato";

pdfHeader(
  doc,
  `${statusLabel} • ${fmtITDate(order.updatedAtISO)}`
);

  let y2 = 54;
  pdfText(doc, "Note", margin, y2 + 10, 12, true);
  y2 += 20;

  pdfCard(doc, margin, y2, contentW, 60);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const note = order.clientNote?.trim() ? order.clientNote.trim() : "-";
  doc.text(doc.splitTextToSize(note, contentW - 24), margin + 12, y2 + 22);
  y2 += 70;
// ===== Condizioni sotto le NOTE =====
y2 += 12;
pdfText(doc, "Condizioni Generali di Vendita", margin, y2, 12, true);
y2 += 24;

doc.setFont("helvetica", "normal");
doc.setFontSize(7.5);

const termsText = `

1. Oggetto

Le presenti condizioni regolano la vendita di prodotti personalizzati a marchio DOUBLEU.

Tutti i prodotti sono realizzati su richiesta e personalizzati secondo le specifiche approvate dal cliente.
<HR>
2. Conferma dell’Ordine

L’ordine si considera confermato esclusivamente al verificarsi congiunto di:
• Firma del foglio d’ordine
• Approvazione grafica definitiva (design, colori, loghi, taglie, quantità)
• Versamento dell’acconto previsto e concordato
<HR>
3. Produzione e Tempistiche

I tempi di produzione decorrono dalla data di:
• Conferma grafica definitiva
• Ricezione dell’acconto

Le tempistiche concordate sono indicative e possono subire variazioni per cause di forza maggiore (ritardi fornitori, trasporti, eventi straordinari).

DOUBLEU si impegna a rispettare le tempistiche concordate al momento della conferma.
<HR>
4. Prodotti Personalizzati

Essendo prodotti realizzati su misura e personalizzati:
• Non è previsto diritto di recesso
• Non è possibile annullare l’ordine dopo l’avvio della produzione
• Non sono accettati resi per errori di taglia comunicati dal cliente

Il cliente è responsabile della correttezza di:
• Quantità
• Taglie
• Ortografia dei loghi/nominativi
• Specifiche tecniche approvate
<HR>
5. Tolleranze

Sono da considerarsi normali:
• Lievi variazioni cromatiche tra schermo e prodotto finito
• Tolleranze dimensionali tipiche della produzione tessile
• Leggere differenze di posizionamento stampa/ricamo
<HR>
6. Spedizione

I costi di spedizione sono a carico del cliente, salvo accordi diversi.

Eventuali danni devono essere segnalati al momento della consegna con riserva scritta al corriere.
<HR>
7. Pagamenti

Acconto al momento della conferma d’ordine e saldo alla consegna della merce, salvo accordi diversi.
<HR>
8. Proprietà del Marchio

Il marchio DOUBLEU è di esclusiva proprietà dell’azienda.

Eventuali utilizzi diversi da quelli concordati devono essere autorizzati per iscritto.
<HR>
9. Foro Competente

Per ogni controversia è competente il Foro di Salerno.
`.trim();
// ===== Render "pulito" delle condizioni (titoli, bullet, <HR>) =====
const pageHeight = doc.internal.pageSize.getHeight();
const maxY = pageHeight - 78; // spazio riservato per la firma in basso

doc.setFont("helvetica", "normal");
doc.setFontSize(8.4);

const rows = String(termsText).split("\n");
let yT = y2 + 10; // spazio tra titolo "Condizioni Generali..." e punto 1

for (const raw of rows) {
  const t = String(raw ?? "").trimEnd();

  // riga vuota = piccolo respiro
  if (!t.trim()) {
    yT += 5;
    continue;
  }



  // separatore estetico
  if (t.trim() === "<HR>") {
    if (yT > maxY) {
      doc.addPage();
      pdfHeader(doc, "CONDIZIONI GENERALI DI VENDITA");
      yT = 64;
    }
    doc.setLineWidth(0.5);
    doc.line(margin, yT, margin + 60, yT); // riga corta
    yT += 8;
    continue;
  }

  const isSection = /^\d+\.\s/.test(t.trim());
  const isBullet = /^[-•]\s/.test(t.trim());

  // se non ci sta, vai a pagina nuova (ma lasciando spazio firma)
  if (yT > maxY) {
    doc.addPage();
    pdfHeader(doc, "CONDIZIONI GENERALI DI VENDITA");
    yT = 64;
  }

  // Titoli sezione tipo "1. Oggetto"
  if (isSection) {
    yT += 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.2);

    doc.text(t.trim(), margin, yT);
    yT += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.4);
    continue;
  }

  // Bullet con rientro + wrap
  if (isBullet) {
    const bulletText = t.replace(/^[-•]\s*/, "• ");
    const wrapped = doc.splitTextToSize(bulletText, contentW - 24 - 10);
    doc.text(wrapped, margin + 10, yT);
    yT += wrapped.length * 9;
    continue;
  }

  // Paragrafo normale
  const wrapped = doc.splitTextToSize(t, contentW - 24);
  doc.text(wrapped, margin, yT);
  yT += wrapped.length * 9;
}
  
  
 





  // ---- FIRMA IN BASSO A DESTRA ----
const signRightX = margin + contentW;

doc.setFont("helvetica", "normal");
doc.setFontSize(9);

const signYTop = pageHeight - 80;   // più in alto rispetto a prima
const signSpacing = 22;             // spazio verticale tra le due righe

doc.text(
  "Luogo e Data: ________________________________",
  signRightX,
  signYTop,
  { align: "right" }
);

doc.text(
  "Firma Cliente: ________________________________",
  signRightX,
  signYTop + signSpacing,
  { align: "right" }
);




  // --- Output finale ---
  if (mode === "print") {
    openBlobForPrint(doc);
  } else {
    doc.save(`DOUBLEU_ordine_${order.club || "Cliente"}_${fmtITDate(order.updatedAtISO)}.pdf`);
  }
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
export function normalizeOrder(o: any): Order {
  const base = makeBlankOrder();

  return {
    ...base,
    ...o,
    kitUnitPrice: typeof o?.kitUnitPrice === "number" ? o.kitUnitPrice : 0,
    kitQty: typeof o?.kitQty === "number" ? o.kitQty : 0,
    vatEnabled: typeof o?.vatEnabled === "boolean" ? o.vatEnabled : false,
    vatRate: typeof o?.vatRate === "number" ? o.vatRate : 22,
    showKitTotalOnClientPdf:
      typeof o?.showKitTotalOnClientPdf === "boolean" ? o.showKitTotalOnClientPdf : false,
  };
}
/** -------------------- APP -------------------- */
export default function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(
    localStorage.getItem("doubleu_auth") === "ok"
  );

  const [passwordInput, setPasswordInput] = useState("");

  const handleLogin = () => {
    if (passwordInput === APP_PASSWORD) {
      localStorage.setItem("doubleu_auth", "ok");
      setIsAuthenticated(true);
    } else {
      alert("Password errata");
    }
  };
 const [order, setOrder] = useState<Order>(() => {
  const saved = safeParse<Partial<Order>>(localStorage.getItem(LS_CURRENT));
  const base = makeBlankOrder();

  return {
    ...base,
    ...(saved ?? {}),
    // assicurati che il flag esista sempre
    showKitTotalOnClientPdf: (saved as any)?.showKitTotalOnClientPdf ?? false,
  } as Order;
});

  const [archive, setArchive] = useState<Order[]>(() => safeParse<Order[]>(localStorage.getItem(LS_ARCHIVE)) ?? []);
  const kpiConfirmedOrders = confirmedOrdersCount(archive);
const kpiConfirmedRevenue = confirmedRevenue(archive);
const kpiConfirmedPieces = confirmedPieces(archive);
const kpiConfirmedAverage = confirmedAverageOrder(archive);
const [payAmount, setPayAmount] = useState("");
const [payMethod, setPayMethod] = useState("Bonifico");
const [payNote, setPayNote] = useState("");
function deleteOrder(id: string) {
  if (!window.confirm("Vuoi eliminare questo ordine?")) return;

  const updated = archive.filter(o => o.internalId !== id);

  setArchive(updated);

  localStorage.setItem("LS_ARCHIVE", JSON.stringify(updated));
}
// ===== DASHBOARD VIEW =====
const [view, setView] = useState<"dashboard" | "order" | "orders">("dashboard");
const [dashStatus, setDashStatus] = useState<"TUTTI" | "PREVENTIVO" | "CONFERMATO" | "CONSEGNATO">("TUTTI");
const [dashQuery, setDashQuery] = useState("");

function orderTotalPieces(o: Order) {
  // totale pezzi: usa items se presenti, altrimenti kitQty
  try {
    return Array.isArray(o.items) && o.items.length
      ? o.items.reduce((acc, it) => acc + Object.values(it.qty || {}).reduce((a, n) => a + (Number(n) || 0), 0), 0)
      : (Number((o as any).kitQty) || 0);
  } catch {
    return Number((o as any).kitQty) || 0;
  }
}

function orderTotalEuro(o: Order) {
  const rows = (o as any).commercialRows || [];

  const base = rows.reduce((sum: number, r: any) => {
    const price = Number(r.price) || 0;
    const qty =
      Number(r.qty) ||
      Number(r.totalQty) ||
      0;

    return sum + price * qty;
  }, 0);

  const vatEnabled = Boolean((o as any).vatEnabled);
  const vatRate = Number((o as any).vatRate) || 0;

  return vatEnabled ? base * (1 + vatRate / 100) : base;
}

function confirmedOrdersList(archive: Order[]) {
  return archive.filter((o) => o.status === "CONFERMATO");
}

function confirmedOrdersCount(archive: Order[]) {
  return confirmedOrdersList(archive).length;
}

function confirmedRevenue(archive: Order[]) {
  return confirmedOrdersList(archive).reduce((sum, o) => sum + orderTotalEuro(o), 0);
}

function confirmedPieces(archive: Order[]) {
  return confirmedOrdersList(archive).reduce((sum, o) => sum + orderTotalPieces(o), 0);
}

function confirmedAverageOrder(archive: Order[]) {
  const count = confirmedOrdersCount(archive);
  if (!count) return 0;
  return confirmedRevenue(archive) / count;
}
function euro(n: number) {
  try {
    return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
  } catch {
    return `€ ${n.toFixed(2)}`;
  }
}

function shortDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("it-IT");
}

const archiveCount = archive.length;

const dashRows = archive
  .filter(o => {
    const st = (o.status || "PREVENTIVO") as any;
    if (dashStatus !== "TUTTI" && st !== dashStatus) return false;
    const q = dashQuery.trim().toLowerCase();
    if (!q) return true;
    const club = (o.club || "").toLowerCase();
    const name = ((o.client && o.client.name) ? o.client.name : "").toLowerCase();
    const id = (o.internalId || "").toLowerCase();
    return club.includes(q) || name.includes(q) || id.includes(q);
  })
  .sort((a, b) => (b.updatedAtISO || b.createdAtISO || "").localeCompare(a.updatedAtISO || a.createdAtISO || ""))
  .slice(0, 50);

const kpiPreventivi = archive.filter(o => o.status === "PREVENTIVO").length;
const kpiConfermati = archive.filter(o => o.status === "CONFERMATO").length;
const kpiConsegnati = archive.filter(o => o.status === "CONSEGNATO").length;



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
  // PREVENTIVO -> CONFERMATO -> CONSEGNATO
const next: Record<OrderStatus, OrderStatus> = {
  PREVENTIVO: "CONFERMATO",
  CONFERMATO: "CONSEGNA PARZIALE",
  "CONSEGNA PARZIALE": "CONSEGNATO",
  CONSEGNATO: "CONSEGNATO",
};
  touch({ status: next[order.status] });
}

 function saveToArchive() {
  const snap = deepClone(order);
  setArchive((prev) => {
    const filtered = prev.filter((o) => o.internalId !== snap.internalId);
    return [snap, ...filtered].slice(0, 200);
  });
}

 function loadFromArchive(idx: number) {
  const chosen = archive[idx];
  if (!chosen) return;

  const base = makeBlankOrder();

  setOrder({
    ...base,
    ...deepClone(chosen),
    payments: Array.isArray(chosen.payments) ? chosen.payments : [],
  });

  setView("order");
}
  

  function deleteFromArchive(idx: number) {
    setArchive((a) => a.filter((_, i) => i !== idx));
  }
function addCommercialRow() {
  setOrder((prev) => ({
    ...prev,
    commercialRows: [
      ...(prev.commercialRows || []),
      { description: "", price: 0, qty: 0 }
    ],
    updatedAtISO: new Date().toISOString()
  }));
}

function updateCommercialRow(idx: number, patch: Partial<CommercialRow>) {
  setOrder((prev) => {
    const next = [...(prev.commercialRows || [])];
    next[idx] = { ...next[idx], ...patch };

    return {
      ...prev,
      commercialRows: next,
      updatedAtISO: new Date().toISOString()
    };
  });
}

function removeCommercialRow(idx: number) {
  setOrder((prev) => ({
    ...prev,
    commercialRows: (prev.commercialRows || []).filter((_, i) => i !== idx),
    updatedAtISO: new Date().toISOString()
  }));
}
const commercialTotal = (order.commercialRows || []).reduce(
  (acc, row) => acc + (Number(row.price) || 0) * (Number(row.qty) || 0),
  0
);

function addPayment(amount: number, method: string, note: string = "") {
  const newPayment = {
    date: new Date().toISOString(),
    amount,
    method,
    note
  };

  setOrder({
    ...order,
    payments: [...order.payments, newPayment],
    updatedAtISO: new Date().toISOString()
  });
}
  function duplicateOrder() {
    const clone = deepClone(order);
    clone.internalId = newInternalId();
    clone.status = "PREVENTIVO";
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

  const statusClass =
  order.status === "CONSEGNATO" ? "pill ok" :
  order.status === "CONFERMATO" ? "pill ok" :
  "pill warn";
 
  if (!isAuthenticated) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f5f6f8",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          background: "white",
          padding: 40,
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
          textAlign: "center",
          width: 320,
        }}
      >
        <h2 style={{ marginBottom: 20 }}>DOUBLEU Order App</h2>

        <input
          type="password"
          placeholder="Inserisci password"
          value={passwordInput}
          onChange={(e) => setPasswordInput(e.target.value)}
          style={{
            padding: 12,
            fontSize: 16,
            marginBottom: 16,
            width: "100%",
            borderRadius: 6,
            border: "1px solid #ccc",
          }}
        />

        <button
          onClick={handleLogin}
          style={{
            padding: "12px 20px",
            fontSize: 16,
            width: "100%",
            borderRadius: 6,
            border: "none",
            background: "#0f172a",
            color: "white",
            cursor: "pointer",
          }}
        >
          Accedi
        </button>
      </div>
    </div>
  );
}
  return view === "dashboard" ? (
  <div
    className="dashRoot"
    style={{
      minHeight: "100vh",
      background: "#f5f6f8",
      display: "grid",
      gridTemplateColumns: "260px 1fr",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    }}
  >
    {/* SIDEBAR */}
    <aside
      style={{
        background: "rgba(255,255,255,0.65)",
        borderRight: "1px solid rgba(0,0,0,0.08)",
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div

          style={{
            width: 42,
            height: 42,
            borderRadius: 10,
            background: "linear-gradient(135deg,#3b82f6,#60a5fa)",
            display: "grid",
            placeItems: "center",
            color: "white",
            fontWeight: 800,
          }}
        >
          D
        </div>
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontWeight: 800 }}>DOUBLEU</div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>Order App</div>
        </div>
      </div>
<button
  onClick={() => setView("dashboard")}
  style={{
    marginTop: 20,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "#eaf2ff",
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left"
  }}
>
Dashboard
</button>

<button
  onClick={() => {
    setOrder(makeBlankOrder());
    setView("order");
  }}
  style={{
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "white",
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left"
  }}
>
+ Nuovo Ordine
</button>
 
 <button
  onClick={() => setView("orders")}
  style={{
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "white",
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left",
    marginTop: 6
  }}
>
  Archivio Ordini
</button>

      <div style={{ marginTop: "auto", opacity: 0.7, fontSize: 12 }}>
        Archivio ordini: <b>{archiveCount}</b>
      </div>
    </aside>

    {/* MAIN */}
    <main style={{ padding: 22 }}>
      {/* TOP */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: -0.2 }}>
          Dashboard
        </h1>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(0,0,0,0.08)",
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <span style={{ opacity: 0.65 }}>Cerca</span>
            <input
              value={dashQuery}
              onChange={(e) => setDashQuery(e.target.value)}
              placeholder="Cliente / DU / club"
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                width: 240,
                fontSize: 14,
              }}
            />
          </div>
        </div>
      </div>

      {/* KPI */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(240px, 1fr))",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 16,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 44, fontWeight: 800 }}>{kpiPreventivi}</div>
          <div style={{ opacity: 0.7, fontWeight: 700 }}>Preventivi</div>
          <button
            className="btn"
            onClick={() => setDashStatus("TUTTI")}
            style={{ marginTop: 12, borderRadius: 12 }}
          >
            Vedi tutti
          </button>
        </div>

        <div
          style={{
            background: "linear-gradient(135deg,#3b82f6,#60a5fa)",
            color: "white",
            borderRadius: 16,
            padding: 18,
            border: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ fontSize: 44, fontWeight: 800 }}>{kpiConfermati}</div>
          <div style={{ opacity: 0.9, fontWeight: 700 }}>Confermati</div>
          <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800 }}>
            {euro(
  archive
    .filter((o) => o.status === "CONFERMATO")
    .reduce(
      (sum, o) =>
        sum +
        (o.commercialRows || []).reduce(
          (rSum, r) => rSum + (Number(r.price) || 0) * (Number(r.qty) || 0),
          0
        ),
      0
    )
)}
          </div>
        </div>

        <div
          style={{
            background: "rgba(34,197,94,0.12)",
            border: "1px solid rgba(34,197,94,0.25)",
            borderRadius: 16,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 44, fontWeight: 800 }}>{kpiConsegnati}</div>
          <div style={{ opacity: 0.7, fontWeight: 700 }}>Consegnati</div>
        </div>
      </div>
<div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    marginTop: 14,
    marginBottom: 18,
  }}
>
  <div className="card" style={{ padding: 16 }}>
    <div style={{ fontSize: 12, opacity: 0.7 }}>Ordini confermati</div>
    <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>
      {kpiConfirmedOrders}
    </div>
  </div>

  <div className="card" style={{ padding: 16 }}>
    <div style={{ fontSize: 12, opacity: 0.7 }}>Fatturato confermato</div>
    <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>
      {euro(kpiConfirmedRevenue)}
    </div>
  </div>

  <div className="card" style={{ padding: 16 }}>
    <div style={{ fontSize: 12, opacity: 0.7 }}>Pezzi confermati</div>
    <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>
      {kpiConfirmedPieces}
    </div>
  </div>

  <div className="card" style={{ padding: 16 }}>
    <div style={{ fontSize: 12, opacity: 0.7 }}>Valore medio ordine</div>
    <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>
      {euro(kpiConfirmedAverage)}
    </div>
  </div>
</div>
      {/* FILTER TABS */}
      <div
        style={{
          background: "rgba(255,255,255,0.7)",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 16,
          padding: 14,
          marginBottom: 14,
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        {(["TUTTI", "PREVENTIVO", "CONFERMATO", "CONSEGNATO"] as const).map(
          (s) => (
            <button
              key={s}
              className="btn"
              onClick={() => setDashStatus(s)}
   style={{
  borderRadius: 12,
  fontWeight: 700,
  color: "#111827",
  background: dashStatus === s ? "#eaf2ff" : "white",
  border: dashStatus === s ? "1px solid #93c5fd" : "1px solid #e5e7eb",
}}
            >
              {s === "TUTTI"
                ? "Tutti"
                : s === "PREVENTIVO"
                ? "Preventivo"
                : s === "CONFERMATO"
                ? "Confermato"
                : "Consegnato"}
            </button>
          )
        )}
        <div style={{ marginLeft: "auto", opacity: 0.65, fontSize: 13 }}>
          Risultati: <b>{dashRows.length}</b>
        </div>
      </div>

      {/* TABLE */}
      <div
        style={{
          background: "rgba(255,255,255,0.75)",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <div
style={{
  display: "grid",
  gridTemplateColumns: "2fr 1fr 1fr 0.8fr 1fr",
  gap: 10,
  padding: "14px 16px",
  fontWeight: 800,
  borderBottom: "1px solid rgba(0,0,0,0.08)",
  alignItems: "center",
  opacity: 0.8,
}}
        >
<div>Cliente</div>
<div>Data</div>
<div>Stato</div>
<div>Tot Pezzi</div>
<div>Totale</div>
        </div>

        {dashRows.map((o, idx) => (
  <div
    key={(o.internalId || "") + idx}
    onClick={() => {
  const archiveIdx = archive.findIndex(
    (a) => (a.internalId || "") === (o.internalId || "")
  );
  if (archiveIdx >= 0) {
    loadFromArchive(archiveIdx);
    setView("order");
  }
}}
    style={{
      display: "grid",
      cursor: "pointer",
      gridTemplateColumns: "2fr 1fr 1fr 0.8fr 1fr",
      gap: 10,
      padding: "14px 16px",
      borderBottom: "1px solid rgba(0,0,0,0.06)",
      alignItems: "center",
    }}
  >
            <div style={{ fontWeight: 800 }}>
              {(o.club || o.client?.name || "—").toString()}
              <div style={{ fontSize: 12, opacity: 0.65 }}>
                {o.internalId || ""}
              </div>
            </div>

            <div style={{ opacity: 0.85 }}>
              {shortDate(o.createdAtISO || o.updatedAtISO)}
            </div>

            <div>
              <span
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontWeight: 800,
                  fontSize: 12,
                  background:
                    o.status === "CONFERMATO"
                      ? "rgba(59,130,246,0.14)"
                      : o.status === "CONSEGNATO"
                      ? "rgba(34,197,94,0.14)"
                      : "rgba(0,0,0,0.08)",
                  border: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                {o.status}
              </span>
            </div>

            <div style={{ fontWeight: 800 }}>{orderTotalPieces(o)}</div>
            <div style={{ fontWeight: 800 }}>{euro((o.commercialRows || []).reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.qty) || 0), 0))}</div>

            <div>
              <button
                className="btn"
                onClick={() => {
                  // carica ordine dall’archivio e passa alla pagina ordine
                  loadFromArchive(archive.indexOf(o));
                  setView("order");
                }}
                style={{ borderRadius: 12 }}
              >
                ›
              </button>
              <button
  className="btn"
  onClick={() => {
    const copy = structuredClone(o);
    copy.internalId = newInternalId();
    copy.status = "PREVENTIVO";
    copy.createdAtISO = todayISO();
    copy.updatedAtISO = todayISO();
    copy.payments = [];
    setOrder(copy);
    setView("order");
  }}
  style={{ borderRadius: 12, background: "#2563eb", color: "white", marginLeft: 6 }}
>
  Riordina
</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  </div>
) : view === "orders" ? (
  <div style={{ padding: 22 }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16
      }}
    >
      <h1 style={{ margin: 0, fontSize: 28 }}>Archivio Ordini</h1>

      <button
        onClick={() => setView("dashboard")}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #d1d5db",
          background: "white",
          fontWeight: 600,
          cursor: "pointer"
        }}
      >
        ← Dashboard
      </button>
    </div>

    {archive.length === 0 ? (
      <div
        className="card"
        style={{
          padding: 20,
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 12,
          background: "white"
        }}
      >
        Nessun ordine presente in archivio.
      </div>
    ) : (
      <div style={{ display: "grid", gap: 12 }}>
        {archive.map((o, idx) => (
          <div
            key={`${o.internalId || ""}-${idx}`}
            className="card"
            style={{
              position: "relative",
              padding: 16,
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: 12,
              background: "white"
            }}
          >
            <button
              title="Elimina ordine"
              onClick={(e) => {
                e.stopPropagation();
                deleteOrder(o.internalId);
              }}
              style={{
                position: "absolute",
                right: 16,
                bottom: 16,
                width: 36,
                height: 36,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
                fontSize: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              🗑
            </button>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16
              }}
            >
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>
                  {o.club || o.client?.name || "Ordine senza nome"}
                </div>
                <div style={{ opacity: 0.7, marginTop: 4 }}>
                  {o.internalId} • {o.status}
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800 }}>
                  {orderTotalEuro(o).toFixed(2)} €
                </div>
                <div style={{ opacity: 0.7, marginTop: 4 }}>
            {new Date(o.createdAtISO || o.updatedAtISO).toLocaleDateString("it-IT", {
  day: "2-digit",
  month: "short",
  year: "numeric"
})}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                gap: 10
              }}
            >
              <button
                onClick={() => {
                  loadFromArchive(idx);
                  setView("order");
                }}
                style={{
                  background: "white",
                  color: "#111827",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "10px 16px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 14
                }}
              >
                Apri ordine
              </button>

              <button
                onClick={() => {
                  const copy = structuredClone(o);
                  copy.internalId = newInternalId();
                  copy.status = "PREVENTIVO";
                  copy.createdAtISO = todayISO();
                  copy.updatedAtISO = todayISO();
                  copy.payments = [];
                  setOrder(copy);
                  setView("order");
                }}
                style={{
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 16px",
                  background: "#2563eb",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 14
                }}
              >
                Riordina
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
) : (
    <div className="page">
      <div className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-title">DOUBLEU Order App</div>
            <div className="pills">
              <div className="pill dark">Ordine interno: <b>{order.internalId}</b></div>
              <div className="pill dark">Totale: <b>{total} pz</b></div>
              <div className={statusClass}>Stato: <b>{order.status}</b></div>
              <div className="pill dark">Archivio: <b>{archive.length}</b></div>
            </div>
          </div>

          <div className="actions">
            <button className="btn" onClick={() => setView("dashboard")}>
  ← Dashboard
</button>
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
<div className="field">
  <label>Data ordine</label>
  <input
    type="date"
    value={order.createdAtISO ? order.createdAtISO.slice(0, 10) : ""}
    onChange={(e) =>
      setOrder({
        ...order,
        createdAtISO: new Date(e.target.value).toISOString()
      })
    }
    style={{ width: "180px" }}
  />
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
  <div className="card-title">Righe commerciali (interne)</div>

  <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
    {(order.commercialRows || []).length === 0 && (
      <div style={{ opacity: 0.65 }}>
        Nessuna riga commerciale inserita.
      </div>
    )}

    {(order.commercialRows || []).map((row, idx) => (
      <div
        key={idx}
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 110px 90px 120px 44px",
          gap: 10,
          alignItems: "center"
        }}
      >
        <input
          placeholder="Descrizione"
          value={row.description}
          onChange={(e) =>
            updateCommercialRow(idx, { description: e.target.value })
          }
        />

        <input
          type="number"
          placeholder="Prezzo"
          value={row.price === 0 ? "" : row.price}
          onChange={(e) =>
            updateCommercialRow(idx, {
              price: e.target.value === "" ? 0 : Number(e.target.value)
            })
          }
        />

        <input
          type="number"
          placeholder="Qta"
          value={row.qty === 0 ? "" : row.qty}
          onChange={(e) =>
            updateCommercialRow(idx, {
              qty: e.target.value === "" ? 0 : Number(e.target.value)
            })
          }
        />

        <div style={{ fontWeight: 700 }}>
          {((Number(row.price) || 0) * (Number(row.qty) || 0)).toFixed(2)} €
        </div>

        <button
          type="button"
          onClick={() => removeCommercialRow(idx)}
          style={{
            height: 40,
            borderRadius: 10,
            border: "1px solid #d1d5db",
            background: "white",
            cursor: "pointer",
            fontWeight: 700
          }}
        >
          ×
        </button>
      </div>
    ))}

    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 8
      }}
    >
      <button
        type="button"
        onClick={addCommercialRow}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #d1d5db",
          background: "white",
          fontWeight: 700,
          cursor: "pointer"
        }}
      >
        + Aggiungi riga
      </button>

      <div style={{ fontWeight: 800, fontSize: 18 }}>
        Totale commerciale: {commercialTotal.toFixed(2)} €
      </div>
    </div>
  </div>
</div>
{/* --- PAGAMENTI --- */}
<div className="card">
  <div className="card-title">Pagamenti</div>

  <div className="grid3">
    <div className="field">
      <label>Importo (€)</label>
      <input
        type="number"
        placeholder="0"
        value={payAmount}
        onChange={(e) => setPayAmount(e.target.value)}
      />
    </div>

    <div className="field">
      <label>Metodo</label>
      <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
        <option value="Bonifico">Bonifico</option>
        <option value="Contanti">Contanti</option>
        <option value="Carta">Carta</option>
        <option value="PayPal">PayPal</option>
        <option value="Altro">Altro</option>
      </select>
    </div>

    <div className="field">
      <label>Nota</label>
      <input
        placeholder="Es. acconto 60% / saldo / riferimento"
        value={payNote}
        onChange={(e) => setPayNote(e.target.value)}
      />
    </div>
  </div>

  <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
    <button
      className="btn primary"
      onClick={() => {
        const n = Number(payAmount);
        if (!n || n <= 0) return;
        addPayment(n, payMethod, payNote);
        setPayAmount("");
        setPayNote("");
      }}
    >
      Aggiungi pagamento
    </button>

    <div className="muted">
      Totale pagato:{" "}
      <b>
      {order.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0).toFixed(2)} €
      </b>
    </div>
  </div>

  {order.payments.length > 0 && (
    <div style={{ marginTop: 12 }}>
      <div className="muted" style={{ marginBottom: 6 }}>Storico pagamenti</div>
      <div style={{ display: "grid", gap: 6 }}>
        {order.payments
          .slice()
          .reverse()
          .map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 10px",
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 10,
              }}
            >
              <div>
                <b>{p.amount.toFixed(2)} €</b> — {p.method}
                {p.note ? <span className="muted"> • {p.note}</span> : null}
              </div>
              <div className="muted">
                {new Date(p.date).toLocaleDateString()}
              </div>
            </div>
          ))}
      </div>
    </div>
  )}
  <div className="muted" style={{ fontWeight: 600 }}>
Totale ordine: <b>{commercialTotal.toFixed(2)} €</b>
</div>

<div className="muted" style={{ fontWeight: 700 }}>
Residuo da pagare: <b>{(commercialTotal - order.payments.reduce((s,p)=>s+(Number(p.amount)||0),0)).toFixed(2)} €</b>
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
                <option>T-Shirt Donna</option>
                <option value="Pantaloncino">Pantaloncino</option>
                <option>Polo</option>
                <option>Pantalone</option>
                <option>Gonnellino</option>
                <option>Dress</option>
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
          <div
  style={{
    position: "fixed",
    bottom: 8,
    right: 12,
    fontSize: 11,
    opacity: 0.4,
    fontWeight: 500,
  }}
>
  {APP_VERSION}
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
      <button className="btn" type="button" onClick={() => setOpen((v) => !v)}>
        Archivio
      </button>

      {open && (
        <div className="archPanel" onMouseLeave={() => setOpen(false)}>
          {archive.length === 0 ? (
            <div className="muted">Nessun ordine salvato</div>
          ) : (
            archive.slice(0, 20).map((o, idx) => {
              const total = (o.items ?? []).reduce((sum: number, it: any) => {
                const qtyObj = (it as any)?.qty ?? {};
                const row = Object.values(qtyObj as Record<string, any>).reduce(
                  (a: number, n: any) => a + (Number(n) || 0),
                  0
                );
                return sum + row;
              }, 0);

              return (
                <div className="archRow" key={`${o.internalId}-${idx}`}>
                  <button
                    className="archBtn"
                    type="button"
                    onClick={() => {
                      onLoad(idx);
                      setOpen(false);
                    }}
                  >
                    <div className="archTitle">
                      <b>{o.club || "-"}</b>{" "}
                      <span className="muted">{o.internalId}</span>
                    </div>

                    <div className="archMeta">
                      Totale <b>{total}</b> {" • "} {fmtITDate(o.createdAtISO || o.updatedAtISO)}
                    </div>
                  </button>

                  <button
                    className="archDel"
                    type="button"
                    onClick={() => onDelete(idx)}
                    aria-label="Elimina"
                  >
                    x
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}