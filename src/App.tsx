import { useEffect, useMemo, useState, type CSSProperties } from "react";

type Line = "PERF" | "ESS";
type Category = "TSH" | "SHO" | "SWE" | "TRK" | "SKT" | "DRS" | "POL" | "CNT";
type Status = "DRAFT" | "CONFIRMED";

type SizeKey =
  | "4" | "6" | "8" | "10" | "12" | "14" | "16"
  | "XS" | "S" | "M" | "L" | "XL" | "XXL";

type SizeTable = Record<SizeKey, number>;

type ClientInfo = {
  name: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  email: string;
};

type OrderItem = {
  id: string;
  sp: string; // interno (modellista)
  du: string; // interno/gestionale
  category: Category;
  line: Line;
  description: string;
  color: string;
  sizes: SizeTable;
  productionNote: string; // note per produzione (per articolo)
};

type OrderDoc = {
  orderId: string; // interno
  status: Status;
  club: string;
  createdAtISO: string;
  updatedAtISO: string;

  client: ClientInfo; // facoltativo (A)

  // PDF Cliente
  clientNote: string;
  conditions: string;

  // Produzione
  productionNote: string;

  items: OrderItem[];
};

const LS_KEY = "doubleu_orders_v2";              // archivio
const LS_DRAFT_KEY = "doubleu_current_draft_v2"; // draft corrente (anti perdita dati)

const KIDS: SizeKey[] = ["4","6","8","10","12","14","16"];
const ADULT: SizeKey[] = ["XS","S","M","L","XL","XXL"];
const ALL: SizeKey[] = [...KIDS, ...ADULT];

const CAT_LABEL: Record<Category, string> = {
  TSH: "T-shirt",
  SHO: "Shorts",
  SWE: "Felpa",
  TRK: "Pantalone felpa",
  SKT: "Gonnellino",
  DRS: "Vestitino",
  POL: "Polo",
  CNT: "Canotta"
};

const UI = {
  navy: "#0B1F3B",
  blue: "#1D4ED8",
  cyan: "#06B6D4",
  bg: "#F6F7FB",
  card: "#FFFFFF",
  soft: "#EEF2FF",
  border: "#E5E7EB",
  text: "#0F172A",
  muted: "#64748B",
  danger: "#DC2626",
};

function uid() {
  return Math.random().toString(16).slice(2) + "_" + Date.now();
}

function generateDU(sp: string) {
  const number = sp.replace(/[^0-9]/g, "");
  return "DU" + number;
}

function emptySizes(): SizeTable {
  const obj = {} as SizeTable;
  for (const k of ALL) obj[k] = 0;
  return obj;
}

function sumSizes(s: SizeTable) {
  return Object.values(s).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

function hasAnyQtyIn(sizes: SizeTable, keys: SizeKey[]) {
  return keys.some(k => (sizes[k] || 0) > 0);
}

function formatDateIT(d: Date) {
  return d.toLocaleDateString("it-IT");
}

function safeFileName(s: string) {
  return s.trim().replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
}

function nowISO() {
  return new Date().toISOString();
}

function pad4(n: number) {
  const s = String(n);
  return s.length >= 4 ? s : "0".repeat(4 - s.length) + s;
}

function getYear() {
  return new Date().getFullYear();
}

function loadArchive(): OrderDoc[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr as OrderDoc[];
  } catch {
    return [];
  }
}

function saveArchive(arr: OrderDoc[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

function loadDraft(): OrderDoc | null {
  try {
    const raw = localStorage.getItem(LS_DRAFT_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.orderId) return null;
    return obj as OrderDoc;
  } catch {
    return null;
  }
}

function saveDraft(o: OrderDoc) {
  localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(o));
}

function nextOrderIdFromArchive(archive: OrderDoc[]) {
  const y = getYear();
  const prefix = `DU-${y}-`;
  let maxSeq = 0;
  for (const o of archive) {
    if (!o.orderId?.startsWith(prefix)) continue;
    const tail = o.orderId.slice(prefix.length);
    const seq = parseInt(tail, 10);
    if (!Number.isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
  }
  return `${prefix}${pad4(maxSeq + 1)}`;
}

function newBlankOrder(orderId: string): OrderDoc {
  return {
    orderId,
    status: "DRAFT",
    club: "",
    createdAtISO: nowISO(),
    updatedAtISO: nowISO(),

    client: {
      name: "",
      address: "",
      city: "",
      zip: "",
      country: "",
      email: ""
    },

    clientNote: "",
    productionNote: "",
    conditions:
`1. Le quantità e le taglie devono essere verificate prima della conferma definitiva.
2. L’ordine entrerà in produzione solo dopo conferma scritta.
3. Eventuali modifiche successive alla conferma potranno comportare variazioni di costo e tempistiche.
4. I tempi di consegna decorrono dalla conferma definitiva.
5. I prodotti personalizzati non sono soggetti a reso.`,
    items: [],
  };
}

function mergeArchive(prev: OrderDoc[], incoming: OrderDoc[]) {
  const map = new Map<string, OrderDoc>();
  for (const o of prev) map.set(o.orderId, o);
  for (const o of incoming) map.set(o.orderId, o);
  return Array.from(map.values()).sort((a, b) => (b.updatedAtISO || "").localeCompare(a.updatedAtISO || ""));
}

export default function App() {
  const [archive, setArchive] = useState<OrderDoc[]>([]);
  const [showArchive, setShowArchive] = useState(false);

  // ricerca / filtri archivio
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveStatus, setArchiveStatus] = useState<"ALL" | Status>("ALL");

  // Import/export
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [exportText, setExportText] = useState("");
  const [exportMode, setExportMode] = useState<"CURRENT" | "ALL">("CURRENT");

  // Ordine corrente
  const [order, setOrder] = useState<OrderDoc>(() => newBlankOrder(`DU-${getYear()}-0001`));

  // form articolo
  const [spCode, setSpCode] = useState("");
  const [category, setCategory] = useState<Category>("SWE");
  const [line, setLine] = useState<Line>("PERF");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("Navy");

  const locked = order.status === "CONFIRMED";

  // init: archive + draft restore
  useEffect(() => {
    const a = loadArchive();
    setArchive(a);

    const draft = loadDraft();
    if (draft) {
      setOrder(draft);
      return;
    }

    const nextId = nextOrderIdFromArchive(a);
    setOrder(prev => ({ ...prev, orderId: nextId }));
  }, []);

  // archive persist
  useEffect(() => {
    saveArchive(archive);
  }, [archive]);

  // draft autosave (anti perdita dati)
  useEffect(() => {
    saveDraft(order);
  }, [order]);

  const totalPieces = useMemo(
    () => order.items.reduce((acc, it) => acc + sumSizes(it.sizes), 0),
    [order.items]
  );

  function touchOrder(patch: Partial<OrderDoc>) {
    setOrder(prev => ({ ...prev, ...patch, updatedAtISO: nowISO() }));
  }

  function setClub(v: string) {
    if (locked) return;
    touchOrder({ club: v });
  }

  function setConditions(v: string) {
    if (locked) return;
    touchOrder({ conditions: v });
  }

  function setClientNote(v: string) {
    if (locked) return;
    touchOrder({ clientNote: v });
  }

  function setProductionNote(v: string) {
    if (locked) return;
    touchOrder({ productionNote: v });
  }

  function setClientField<K extends keyof ClientInfo>(k: K, v: string) {
    if (locked) return;
    touchOrder({ client: { ...order.client, [k]: v } });
  }

  function addItem() {
    if (locked) return;
    if (!spCode.trim()) return;

    const sp = spCode.toUpperCase().trim();
    const du = generateDU(sp);

    const newItem: OrderItem = {
      id: uid(),
      sp,
      du,
      category,
      line,
      description: description.trim() || "—",
      color: color.trim() || "—",
      sizes: emptySizes(),
      productionNote: ""
    };

    touchOrder({ items: [newItem, ...order.items] });
    setSpCode("");
    setDescription("");
  }

  function updateSize(itemId: string, size: SizeKey, value: number) {
    if (locked) return;
    const next = order.items.map(it => {
      if (it.id !== itemId) return it;
      return { ...it, sizes: { ...it.sizes, [size]: Math.max(0, value) } };
    });
    touchOrder({ items: next });
  }

  function updateItemNote(itemId: string, note: string) {
    if (locked) return;
    const next = order.items.map(it => (it.id === itemId ? { ...it, productionNote: note } : it));
    touchOrder({ items: next });
  }

  function removeItem(itemId: string) {
    if (locked) return;
    touchOrder({ items: order.items.filter(it => it.id !== itemId) });
  }

  function addSetTracksuit() {
    if (locked) return;
    const spBase = spCode.trim() ? spCode.trim() : "SP 000";

    const hoodie: OrderItem = {
      id: uid(),
      sp: spBase.toUpperCase(),
      du: generateDU(spBase),
      category: "SWE",
      line: "PERF",
      description: "Felpa (set)",
      color: color.trim() || "Navy",
      sizes: emptySizes(),
      productionNote: ""
    };

    const pants: OrderItem = {
      id: uid(),
      sp: spBase.toUpperCase(),
      du: generateDU(spBase),
      category: "TRK",
      line: "PERF",
      description: "Pantalone felpa (set)",
      color: color.trim() || "Navy",
      sizes: emptySizes(),
      productionNote: ""
    };

    touchOrder({ items: [pants, hoodie, ...order.items] });
  }

  function toggleStatus() {
    if (order.status === "DRAFT") {
      if (!order.club.trim()) { alert("Inserisci il nome del Club"); return; }
      if (order.items.length === 0) { alert("Aggiungi almeno un articolo"); return; }
      touchOrder({ status: "CONFIRMED" });
      return;
    }
    const ok = confirm("Vuoi tornare in BOZZA e riabilitare le modifiche?");
    if (!ok) return;
    touchOrder({ status: "DRAFT" });
  }

  function saveCurrentToArchive() {
    const id = order.orderId.trim();
    if (!id) { alert("Order ID non valido"); return; }

    setArchive(prev => {
      const idx = prev.findIndex(o => o.orderId === id);
      const updated = { ...order, updatedAtISO: nowISO() };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updated;
        return copy;
      }
      return [updated, ...prev];
    });
    alert("Ordine salvato in archivio");
  }

  function loadOrderFromArchive(orderId: string) {
    const found = archive.find(o => o.orderId === orderId);
    if (!found) return;
    setOrder(found);
    setShowArchive(false);
  }

  function duplicateCurrentOrder() {
    const newId = nextOrderIdFromArchive(archive);
    const dup: OrderDoc = {
      ...order,
      orderId: newId,
      status: "DRAFT",
      createdAtISO: nowISO(),
      updatedAtISO: nowISO(),
      items: order.items.map(it => ({ ...it, id: uid() })),
    };
    setOrder(dup);
    alert(`Duplicato creato: ${newId}`);
  }

  function newOrder() {
    const newId = nextOrderIdFromArchive(archive);
    setOrder(newBlankOrder(newId));
    setSpCode("");
    setDescription("");
    alert(`Nuovo ordine: ${newId}`);
  }

  function openExport(mode: "CURRENT" | "ALL") {
    setExportMode(mode);
    const payload = mode === "CURRENT" ? order : archive;
    setExportText(JSON.stringify(payload, null, 2));
    setShowExport(true);
  }

  function applyImport() {
    try {
      const parsed = JSON.parse(importText);

      if (Array.isArray(parsed)) {
        const incoming = parsed as OrderDoc[];
        setArchive(prev => mergeArchive(prev, incoming));
        alert("Import archivio completato");
        setShowImport(false);
        setImportText("");
        return;
      }

      const incoming = parsed as OrderDoc;
      if (!incoming.orderId) throw new Error("orderId mancante");

      setArchive(prev => mergeArchive(prev, [incoming]));
      setOrder(incoming);
      alert(`Import ordine completato: ${incoming.orderId}`);
      setShowImport(false);
      setImportText("");
    } catch {
      alert("JSON non valido o non compatibile");
    }
  }

  // =========================
  // PDF helpers
  // =========================
  async function pdf() {
    const { default: jsPDF } = await import("jspdf");
    return jsPDF;
  }

  function ensureBasics() {
    if (!order.club.trim()) { alert("Inserisci il nome del Club"); return false; }
    if (order.items.length === 0) { alert("Aggiungi almeno un articolo"); return false; }
    return true;
  }

  // iPad-safe: se popup bloccato -> download (non cambiare pagina)
  function openBlobForPrint(doc: any, filename: string) {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);

    const w = window.open(url, "_blank");
    if (!w) {
      doc.save(filename);
    }

    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // ===== PDF CLIENTE =====
  async function generateClientPDF(mode: "download" | "print") {
    if (!ensureBasics()) return;

    try {
      const jsPDF = await pdf();
      const doc = new jsPDF({ unit: "pt", format: "a4" });

      const pageW = 595;
      const pageH = 842;
      const margin = 40;
      const contentW = pageW - margin * 2;

      const DATE_STR = formatDateIT(new Date());

      // NO orderId nel PDF cliente
      const FILE_BASE = `DOUBLEU_${safeFileName(order.club)}_${DATE_STR.replaceAll("/", "-")}_CLIENTE`;

      const drawTopBar = () => {
        doc.setFillColor(11, 31, 59);
        doc.rect(0, 0, pageW, 84, "F");
        doc.setFillColor(29, 78, 216);
        doc.rect(0, 84, pageW, 4, "F");

        doc.setTextColor(255,255,255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.text("DOUBLEU", margin, 38);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.text(`${order.status === "CONFIRMED" ? "CONFERMA ORDINE" : "BOZZA ORDINE"} • ${DATE_STR}`, margin, 58);

        doc.setTextColor(15,23,42);
      };

      const drawFooter = (pageNum: number, totalPages: number) => {
        const y = pageH - 32;
        doc.setDrawColor(230,230,230);
        doc.line(margin, y - 10, pageW - margin, y - 10);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(120,120,120);
        doc.text(`${order.status === "CONFIRMED" ? "CONFERMATO" : "BOZZA"} • ${order.club} • ${DATE_STR}`, margin, y);
        doc.text(`Pag. ${pageNum}/${totalPages}`, pageW - margin, y, { align: "right" });
        doc.setTextColor(15,23,42);
      };

      const newPage = () => {
        doc.addPage();
        drawTopBar();
        return 110;
      };

      drawTopBar();
      let y = 110;

      // Meta card
      doc.setFillColor(255,255,255);
      doc.setDrawColor(229,231,235);
      doc.roundedRect(margin, y, contentW, 108, 12, 12, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(`Club: ${order.club}`, margin + 14, y + 24);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100,100,120);
      doc.text(`Data: ${DATE_STR}`, margin + 14, y + 44);

      // Dati spedizione (facoltativi): stampa solo se almeno nome o indirizzo
      const c = order.client || { name:"", address:"", city:"", zip:"", country:"", email:"" };
      const anyShip =
        (c.name || "").trim() ||
        (c.address || "").trim() ||
        (c.city || "").trim() ||
        (c.zip || "").trim() ||
        (c.country || "").trim() ||
        (c.email || "").trim();

      if (anyShip) {
        const line1 = `Cliente: ${(c.name || "—").trim() || "—"}`;
        const line2Parts = [
          (c.address || "").trim(),
          [ (c.zip || "").trim(), (c.city || "").trim() ].filter(Boolean).join(" "),
          (c.country || "").trim()
        ].filter(Boolean);
        const line2 = line2Parts.length ? `Spedizione: ${line2Parts.join(", ")}` : "";
        const line3 = (c.email || "").trim() ? `Email: ${(c.email || "").trim()}` : "";

        doc.text(line1, margin + 14, y + 62);
        if (line2) doc.text(line2, margin + 14, y + 78);
        if (line3) doc.text(line3, margin + 14, y + 94);
      }

      doc.setFont("helvetica", "bold");
      doc.setTextColor(11,31,59);
      doc.text(`Totale pezzi: ${totalPieces}`, pageW - margin - 14, y + 30, { align: "right" });
      doc.setTextColor(15,23,42);

      y += 128;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Riepilogo articoli", margin, y);
      y += 14;

      const drawSizeTable = (title: string, sizesCols: SizeKey[], rows: OrderItem[]) => {
        if (rows.length === 0) return;
        if (y > pageH - 240) y = newPage();

        doc.setFillColor(238,242,255);
        doc.setDrawColor(229,231,235);
        doc.roundedRect(margin, y, contentW, 24, 10, 10, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(11,31,59);
        doc.text(title, margin + 12, y + 16);
        doc.setTextColor(15,23,42);
        y += 34;

        const colW = 34;
        const labelW = contentW - (sizesCols.length * colW);

        const headH = 22;
        doc.setFillColor(248,248,250);
        doc.setDrawColor(229,231,235);
        doc.roundedRect(margin, y, contentW, headH, 10, 10, "FD");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(100,100,120);
        doc.text("Articolo", margin + 12, y + 15);

        for (let i = 0; i < sizesCols.length; i++) {
          const x = margin + labelW + i * colW;
          doc.text(String(sizesCols[i]), x + colW / 2, y + 15, { align: "center" });
        }
        doc.setTextColor(15,23,42);
        y += headH + 8;

        const totals: Record<string, number> = {};
        for (const s of sizesCols) totals[s] = 0;

        for (let r = 0; r < rows.length; r++) {
          const it = rows[r];
          for (const s of sizesCols) totals[s] += (it.sizes[s] || 0);

          const rowTitle = `${it.description} • ${it.color}`;
          const wrapped = doc.splitTextToSize(rowTitle, labelW - 24);
          const rowH = Math.max(34, wrapped.length * 12 + 10);

          if (y + rowH > pageH - 140) y = newPage();

          const zebra = r % 2 === 0;
          doc.setFillColor(zebra ? 255 : 249, zebra ? 255 : 250, zebra ? 255 : 252);
          doc.setDrawColor(229,231,235);
          doc.roundedRect(margin, y, contentW, rowH, 10, 10, "FD");

          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.text(wrapped, margin + 12, y + 14);

          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(110,110,130);
          doc.text(
            `${CAT_LABEL[it.category]} • ${it.line === "PERF" ? "Performance" : "Essential"} • Tot: ${sumSizes(it.sizes)}`,
            margin + 12,
            y + 14 + wrapped.length * 12
          );
          doc.setTextColor(15,23,42);

          doc.setFontSize(10);
          for (let i = 0; i < sizesCols.length; i++) {
            const s = sizesCols[i];
            const q = it.sizes[s] || 0;
            const x = margin + labelW + i * colW + colW / 2;
            doc.text(q > 0 ? String(q) : "—", x, y + 18, { align: "center" });
          }

          y += rowH + 8;
        }

        if (y + 34 > pageH - 140) y = newPage();
        doc.setFillColor(11,31,59);
        doc.setDrawColor(11,31,59);
        doc.roundedRect(margin, y, contentW, 28, 10, 10, "FD");

        doc.setTextColor(255,255,255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("Totali per taglia", margin + 12, y + 18);

        for (let i = 0; i < sizesCols.length; i++) {
          const s = sizesCols[i];
          const x = margin + labelW + i * colW + colW / 2;
          doc.text(String(totals[s]), x, y + 18, { align: "center" });
        }
        doc.setTextColor(15,23,42);
        y += 40;
      };

      const kidsRows = order.items.filter(it => hasAnyQtyIn(it.sizes, KIDS));
      const adultRows = order.items.filter(it => hasAnyQtyIn(it.sizes, ADULT));
      drawSizeTable("Taglie Bambino", KIDS, kidsRows);
      drawSizeTable("Taglie Adulto", ADULT, adultRows);

      if (order.clientNote.trim()) {
        if (y > pageH - 220) y = newPage();
        doc.setDrawColor(220,220,220);
        doc.line(margin, y, pageW - margin, y);
        y += 18;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Note", margin, y);
        y += 12;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        const note = doc.splitTextToSize(order.clientNote, contentW);
        doc.text(note, margin, y);
        y += note.length * 12 + 12;
      }

      if (y > pageH - 250) y = newPage();
      doc.setDrawColor(220,220,220);
      doc.line(margin, y, pageW - margin, y);
      y += 18;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Verifica e conferma", margin, y);
      y += 14;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const confirmText = doc.splitTextToSize(
        "Si prega di verificare attentamente quantità e taglie. L’ordine entrerà in produzione solo dopo conferma scritta.",
        contentW
      );
      doc.text(confirmText, margin, y);
      y += confirmText.length * 12 + 16;

      doc.setFont("helvetica", "bold");
      doc.text("Condizioni Generali di Vendita", margin, y);
      y += 12;

      doc.setFont("helvetica", "normal");
      const cond = doc.splitTextToSize(order.conditions, contentW);
      doc.text(cond, margin, y);

      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        drawFooter(p, totalPages);
      }

      if (mode === "download") {
        doc.save(`${FILE_BASE}.pdf`);
      } else {
        openBlobForPrint(doc, `${FILE_BASE}.pdf`);
      }
    } catch (e: any) {
      console.error(e);
      alert("Errore PDF Cliente. Controlla che 'jspdf' sia installato (npm install jspdf).");
    }
  }

  // ===== PDF PRODUZIONE (stesso stile Cliente) =====
  async function generateProductionPDF(mode: "download" | "print") {
    if (!ensureBasics()) return;

    try {
      const jsPDF = await pdf();
      const doc = new jsPDF({ unit: "pt", format: "a4" });

      const pageW = 595;
      const pageH = 842;
      const margin = 40;
      const contentW = pageW - margin * 2;

      const DATE_STR = formatDateIT(new Date());
      const FILE_BASE = `DOUBLEU_${safeFileName(order.club)}_${order.orderId}_PRODUZIONE`;

      const clientName = (order.client?.name || "").trim();

      const drawTopBar = () => {
        doc.setFillColor(11, 31, 59);
        doc.rect(0, 0, pageW, 84, "F");
        doc.setFillColor(29, 78, 216);
        doc.rect(0, 84, pageW, 4, "F");

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.text("DOUBLEU", margin, 38);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.text(`PRODUZIONE (INTERNO) • ${DATE_STR}`, margin, 58);

        doc.setTextColor(15, 23, 42);
      };

      const drawFooter = (pageNum: number, totalPages: number) => {
        const y = pageH - 32;
        doc.setDrawColor(230, 230, 230);
        doc.line(margin, y - 10, pageW - margin, y - 10);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text(`Produzione • ${order.club} • ${DATE_STR}`, margin, y);
        doc.text(`Pag. ${pageNum}/${totalPages}`, pageW - margin, y, { align: "right" });
        doc.setTextColor(15, 23, 42);
      };

      const newPage = () => {
        doc.addPage();
        drawTopBar();
        return 110;
      };

      drawTopBar();
      let y = 110;

      // ===== META CARD =====
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(229, 231, 235);
      doc.roundedRect(margin, y, contentW, 86, 12, 12, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(`Club: ${order.club}`, margin + 14, y + 24);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 120);
      doc.text(`Data: ${DATE_STR}`, margin + 14, y + 44);

      // SOLO NOME CLIENTE (se presente)
      if (clientName) {
        doc.text(`Cliente: ${clientName}`, margin + 14, y + 62);
      }

      doc.setFont("helvetica", "bold");
      doc.setTextColor(11, 31, 59);
      doc.text(`Ordine interno: ${order.orderId}`, pageW - margin - 14, y + 30, { align: "right" });
      doc.text(`Totale pezzi: ${totalPieces}`, pageW - margin - 14, y + 50, { align: "right" });
      doc.setTextColor(15, 23, 42);

      y += 106;

      // ===== NOTE GENERALI PRODUZIONE =====
      if (order.productionNote.trim()) {
        if (y > pageH - 220) y = newPage();

        doc.setFillColor(238, 242, 255);
        doc.setDrawColor(229, 231, 235);
        doc.roundedRect(margin, y, contentW, 24, 10, 10, "FD");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(11, 31, 59);
        doc.text("Note generali produzione", margin + 12, y + 16);
        doc.setTextColor(15, 23, 42);
        y += 34;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(70, 70, 70);
        const pn = doc.splitTextToSize(order.productionNote, contentW);
        doc.text(pn, margin, y);
        doc.setTextColor(15, 23, 42);
        y += pn.length * 12 + 16;
      }

      // ===== LISTA ARTICOLI (card style) =====
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Riepilogo articoli (produzione)", margin, y);
      y += 14;

      for (let idx = 0; idx < order.items.length; idx++) {
        const it = order.items[idx];

        const title = `${idx + 1}. ${it.description}`;
        const meta = `${CAT_LABEL[it.category]} • ${it.line === "PERF" ? "Performance" : "Essential"} • Colore: ${it.color}`;
        const codes = `SP: ${it.sp}   •   DU: ${it.du}   •   Tot: ${sumSizes(it.sizes)}`;

        // Riga taglie compatta (solo taglie con quantità > 0)
        const sizeChunks: string[] = [];
        for (const s of ALL) {
          const q = it.sizes[s] || 0;
          if (q > 0) sizeChunks.push(`${s}:${q}`);
        }
        const sizeLine = sizeChunks.length ? `Taglie: ${sizeChunks.join("  ")}` : "Taglie: —";

        const titleWrap = doc.splitTextToSize(title, contentW - 24);
        const metaWrap = doc.splitTextToSize(meta, contentW - 24);
        const codesWrap = doc.splitTextToSize(codes, contentW - 24);
        const sizesWrap = doc.splitTextToSize(sizeLine, contentW - 24);

        let noteWrap: string[] = [];
        if (it.productionNote.trim()) {
          noteWrap = doc.splitTextToSize(`Nota articolo: ${it.productionNote.trim()}`, contentW - 24);
        }

        const blockH =
          16 + titleWrap.length * 12 +
          6 + metaWrap.length * 11 +
          4 + codesWrap.length * 11 +
          4 + sizesWrap.length * 11 +
          (noteWrap.length ? 8 + noteWrap.length * 11 : 0) +
          14;

        if (y + blockH > pageH - 120) y = newPage();

        // Card
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(229, 231, 235);
        doc.roundedRect(margin, y, contentW, blockH, 12, 12, "FD");

        let yy = y + 18;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        doc.text(titleWrap, margin + 12, yy);
        yy += titleWrap.length * 12 + 8;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(110, 110, 130);
        doc.text(metaWrap, margin + 12, yy);
        yy += metaWrap.length * 11 + 6;

        doc.setTextColor(70, 70, 70);
        doc.text(codesWrap, margin + 12, yy);
        yy += codesWrap.length * 11 + 6;

        doc.text(sizesWrap, margin + 12, yy);
        yy += sizesWrap.length * 11;

        if (noteWrap.length) {
          yy += 10;
          doc.setTextColor(70, 70, 70);
          doc.text(noteWrap, margin + 12, yy);
        }

        doc.setTextColor(15, 23, 42);
        y += blockH + 12;
      }

      // Footer su tutte le pagine
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        drawFooter(p, totalPages);
      }

      if (mode === "download") {
        doc.save(`${FILE_BASE}.pdf`);
      } else {
        openBlobForPrint(doc, `${FILE_BASE}.pdf`);
      }
    } catch (e: any) {
      console.error(e);
      alert("Errore PDF Produzione. Controlla che 'jspdf' sia installato (npm install jspdf).");
    }
  }

  // =========================
  // UI styles
  // =========================
  const inputBase: CSSProperties = {
    padding: 12,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    background: UI.card,
    outline: "none",
    color: UI.text,
    fontSize: 16,
    lineHeight: "20px",
    width: "100%",
    boxSizing: "border-box"
  };

  const label: CSSProperties = {
    fontSize: 12,
    fontWeight: 900,
    color: UI.muted,
    marginBottom: 6
  };

  const pill: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 999,
    border: `1px solid rgba(255,255,255,.28)`,
    background: "rgba(255,255,255,.12)",
    fontWeight: 900,
    fontSize: 12
  };

  const filteredArchive = useMemo(() => {
    const q = archiveQuery.trim().toLowerCase();
    return archive.filter(o => {
      const statusOk = archiveStatus === "ALL" ? true : o.status === archiveStatus;
      if (!statusOk) return false;
      if (!q) return true;
      const hay = `${o.orderId} ${o.club}`.toLowerCase();
      return hay.includes(q);
    });
  }, [archive, archiveQuery, archiveStatus]);

  // =========================
  // UI actions
  // =========================
  function updateOrderClientField<K extends keyof ClientInfo>(k: K, v: string) {
    setClientField(k, v);
  }

  return (
    <div style={{ minHeight: "100vh", background: UI.bg, color: UI.text }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: 22 }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${UI.navy} 0%, ${UI.blue} 55%, ${UI.cyan} 110%)`,
          borderRadius: 18,
          padding: "18px 18px",
          color: "white",
          boxShadow: "0 14px 40px rgba(2,6,23,.14)"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: -0.5 }}>DOUBLEU Order App</div>
              <div style={{ opacity: 0.9, marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={pill}>Ordine interno: {order.orderId}</div>
                <div style={pill}>Totale: {totalPieces} pz</div>
                <div style={{ ...pill, borderColor: "rgba(255,255,255,.35)" }}>
                  Stato:&nbsp;
                  <span style={{ fontWeight: 1000, color: order.status === "CONFIRMED" ? "#BBF7D0" : "#FEF08A" }}>
                    {order.status === "CONFIRMED" ? "CONFERMATO" : "BOZZA"}
                  </span>
                </div>
              </div>
              {locked && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: .92 }}>
                  🔒 Ordine confermato: modifiche bloccate.
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={toggleStatus} style={topBtn(order.status === "CONFIRMED" ? "ghost" : "solid")}>
                {order.status === "CONFIRMED" ? "Torna in BOZZA" : "Conferma ordine"}
              </button>
              <button onClick={saveCurrentToArchive} style={topBtn("ghost")}>Salva</button>
              <button onClick={() => setShowArchive(true)} style={topBtn("ghost")}>Archivio</button>
              <button onClick={duplicateCurrentOrder} style={topBtn("ghost")}>Duplica</button>
              <button onClick={newOrder} style={topBtn("ghost")}>Nuovo</button>
            </div>
          </div>

          {/* PDF + Print */}
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => generateClientPDF("download")} style={topBtn("solid")}>
              PDF Cliente
            </button>
            <button onClick={() => generateClientPDF("print")} style={topBtn("ghost")}>
              Stampa Cliente
            </button>

            <button onClick={() => generateProductionPDF("download")} style={topBtn("ghost")}>
              PDF Produzione
            </button>
            <button onClick={() => generateProductionPDF("print")} style={topBtn("ghost")}>
              Stampa Produzione
            </button>

            <button onClick={() => openExport("CURRENT")} style={topBtn("ghost")}>Export ordine</button>
            <button onClick={() => openExport("ALL")} style={topBtn("ghost")}>Export archivio</button>
            <button onClick={() => setShowImport(true)} style={topBtn("ghost")}>Import JSON</button>
          </div>
        </div>

        {/* Club */}
        <div style={{ marginTop: 14, background: UI.card, border: `1px solid ${UI.border}`, borderRadius: 16, padding: 14 }}>
          <div style={label}>Club</div>
          <div style={{ maxWidth: 560 }}>
            <input
              value={order.club}
              onChange={(e) => setClub(e.target.value)}
              placeholder="Es. TC Valencia"
              style={{ ...inputBase, opacity: locked ? .6 : 1 }}
              disabled={locked}
            />
          </div>
        </div>

        {/* Dati Cliente / Spedizione (facoltativi) */}
        <div style={{ marginTop: 12, ...card }}>
          <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 10 }}>Dati cliente / spedizione (facoltativi)</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
            <div>
              <div style={label}>Nome cliente</div>
              <input
                value={order.client?.name || ""}
                onChange={(e) => updateOrderClientField("name", e.target.value)}
                placeholder="Es. Marco Rossi"
                style={{ ...inputBase, opacity: locked ? .6 : 1 }}
                disabled={locked}
              />
            </div>

            <div style={{ gridColumn: "span 2" }}>
              <div style={label}>Indirizzo</div>
              <input
                value={order.client?.address || ""}
                onChange={(e) => updateOrderClientField("address", e.target.value)}
                placeholder="Via..., n..."
                style={{ ...inputBase, opacity: locked ? .6 : 1 }}
                disabled={locked}
              />
            </div>

            <div>
              <div style={label}>Città</div>
              <input
                value={order.client?.city || ""}
                onChange={(e) => updateOrderClientField("city", e.target.value)}
                placeholder="Es. Valencia"
                style={{ ...inputBase, opacity: locked ? .6 : 1 }}
                disabled={locked}
              />
            </div>

            <div>
              <div style={label}>CAP</div>
              <input
                value={order.client?.zip || ""}
                onChange={(e) => updateOrderClientField("zip", e.target.value)}
                placeholder="Es. 46001"
                style={{ ...inputBase, opacity: locked ? .6 : 1 }}
                disabled={locked}
              />
            </div>

            <div>
              <div style={label}>Nazione</div>
              <input
                value={order.client?.country || ""}
                onChange={(e) => updateOrderClientField("country", e.target.value)}
                placeholder="Es. Spain"
                style={{ ...inputBase, opacity: locked ? .6 : 1 }}
                disabled={locked}
              />
            </div>

            <div>
              <div style={label}>Email</div>
              <input
                value={order.client?.email || ""}
                onChange={(e) => updateOrderClientField("email", e.target.value)}
                placeholder="nome@email.com"
                style={{ ...inputBase, opacity: locked ? .6 : 1 }}
                disabled={locked}
              />
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: UI.muted }}>
            Se lasci vuoti questi campi, non compariranno nel PDF Cliente.
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 8 }}>Note per il cliente (facoltative)</div>
            <textarea
              value={order.clientNote}
              onChange={(e) => setClientNote(e.target.value)}
              placeholder="Esempio: consegna stimata, richieste di approvazione, ecc."
              style={{ ...textareaBase, opacity: locked ? .6 : 1 }}
              disabled={locked}
            />
          </div>

          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 8 }}>Note generali produzione (interne)</div>
            <textarea
              value={order.productionNote}
              onChange={(e) => setProductionNote(e.target.value)}
              placeholder="Esempio: dettagli lavorazione, note su stampa/ricamo, particolarità."
              style={{ ...textareaBase, opacity: locked ? .6 : 1 }}
              disabled={locked}
            />
          </div>
        </div>

        {/* Conditions */}
        <div style={{ marginTop: 12, ...card }}>
          <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 8 }}>
            Condizioni Generali di Vendita (PDF Cliente)
          </div>

          <textarea
            value={order.conditions}
            onChange={(e) => setConditions(e.target.value)}
            style={{ ...textareaBase, minHeight: 140, opacity: locked ? .6 : 1 }}
            disabled={locked}
          />
        </div>

        {/* Add item */}
        <div style={{ marginTop: 12, ...card }}>
          <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 10 }}>Aggiungi Articolo</div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
              alignItems: "center"
            }}
          >
            <div>
              <div style={label}>Codice modellista (SP)</div>
              <input
                value={spCode}
                onChange={(e) => setSpCode(e.target.value)}
                placeholder="Es. SP 206"
                style={{ ...inputBase, opacity: locked ? .6 : 1 }}
                disabled={locked}
              />
            </div>

            <div>
              <div style={label}>Categoria</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                style={{ ...inputBase, paddingRight: 30, opacity: locked ? .6 : 1 }}
                disabled={locked}
              >
                {Object.keys(CAT_LABEL).map((k) => (
                  <option key={k} value={k}>{CAT_LABEL[k as Category]}</option>
                ))}
              </select>
            </div>

            <div>
              <div style={label}>Linea</div>
              <select
                value={line}
                onChange={(e) => setLine(e.target.value as Line)}
                style={{ ...inputBase, paddingRight: 30, opacity: locked ? .6 : 1 }}
                disabled={locked}
              >
                <option value="PERF">Performance</option>
                <option value="ESS">Essential (basic)</option>
              </select>
            </div>

            <div style={{ gridColumn: "span 2" }}>
              <div style={label}>Descrizione</div>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Es. Felpa zip cappuccio stripe"
                style={{ ...inputBase, opacity: locked ? .6 : 1 }}
                disabled={locked}
              />
            </div>

            <div>
              <div style={label}>Colore</div>
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="Es. Navy"
                style={{ ...inputBase, opacity: locked ? .6 : 1 }}
                disabled={locked}
              />
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
              <button
                onClick={addItem}
                style={primaryBtn(locked)}
                disabled={locked}
              >
                Aggiungi
              </button>

              <button
                onClick={addSetTracksuit}
                style={softBtn(locked)}
                disabled={locked}
                title="Aggiunge 2 righe separate: Felpa + Pantalone felpa"
              >
                + Set (Felpa + Pantalone)
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: UI.muted }}>
            Il PDF Cliente non mostra il numero ordine. Il PDF Produzione include SP + DU, note e ordine interno.
          </div>
        </div>

        {/* Items */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Articoli</div>

          {order.items.length === 0 && <div style={{ color: UI.muted }}>Nessun articolo inserito.</div>}

          {order.items.map((it) => (
            <div key={it.id} style={itemCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>{it.description}</div>
                  <div style={{ fontSize: 13, color: UI.muted, marginBottom: 6 }}>
                    {CAT_LABEL[it.category]} • {it.line === "PERF" ? "Performance" : "Essential"} • Colore: <b style={{ color: UI.text }}>{it.color}</b>
                  </div>
                  <div style={{ fontSize: 13, color: UI.muted }}>
                    DU: <b style={{ color: UI.text }}>{it.du}</b> • Totale articolo: <b style={{ color: UI.text }}>{sumSizes(it.sizes)}</b>
                  </div>
                </div>

                <button
                  onClick={() => removeItem(it.id)}
                  style={{
                    padding: "10px 12px",
                    background: "white",
                    border: `1px solid ${UI.border}`,
                    borderRadius: 12,
                    cursor: locked ? "not-allowed" : "pointer",
                    color: UI.danger,
                    fontWeight: 900,
                    flexShrink: 0,
                    opacity: locked ? .55 : 1
                  }}
                  disabled={locked}
                >
                  Elimina
                </button>
              </div>

              {/* Note produzione articolo */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: UI.muted, marginBottom: 8 }}>
                  Nota produzione (per articolo)
                </div>
                <textarea
                  value={it.productionNote}
                  onChange={(e) => updateItemNote(it.id, e.target.value)}
                  placeholder="Es. stampa lato cuore, variante bordino, zip, ecc."
                  style={{ ...textareaBase, minHeight: 80, opacity: locked ? .6 : 1 }}
                  disabled={locked}
                />
              </div>

              {/* Taglie */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: UI.muted, marginBottom: 8 }}>
                  Quantità per taglia
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
                    gap: 10,
                    opacity: locked ? .65 : 1
                  }}
                >
                  {ALL.map((size) => {
                    const current = it.sizes[size];
                    return (
                      <div key={size} style={sizeCard}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: UI.muted }}>{size}</div>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={current === 0 ? "" : String(current)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") return updateSize(it.id, size, 0);
                            updateSize(it.id, size, parseInt(raw, 10) || 0);
                          }}
                          placeholder="—"
                          style={qtyInput}
                          disabled={locked}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ height: 30 }} />

        {/* ===== Modale Archivio ===== */}
        {showArchive && (
          <div style={modalWrap}>
            <div style={modalCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 1000 }}>Archivio ordini</div>
                <button onClick={() => setShowArchive(false)} style={modalClose}>Chiudi</button>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 220px", gap: 10 }}>
                <input
                  value={archiveQuery}
                  onChange={(e) => setArchiveQuery(e.target.value)}
                  placeholder="Cerca per Club o Order ID (interno)"
                  style={{ ...inputBase }}
                />
                <select
                  value={archiveStatus}
                  onChange={(e) => setArchiveStatus(e.target.value as any)}
                  style={{ ...inputBase, paddingRight: 30 }}
                >
                  <option value="ALL">Tutti</option>
                  <option value="DRAFT">Bozza</option>
                  <option value="CONFIRMED">Confermato</option>
                </select>
              </div>

              <div style={{ marginTop: 12, maxHeight: 420, overflow: "auto", border: `1px solid ${UI.border}`, borderRadius: 12 }}>
                {filteredArchive.length === 0 && (
                  <div style={{ padding: 12, color: UI.muted }}>Nessun ordine trovato.</div>
                )}

                {filteredArchive.map((o) => (
                  <div
                    key={o.orderId}
                    onClick={() => loadOrderFromArchive(o.orderId)}
                    style={{
                      padding: 12,
                      borderBottom: `1px solid ${UI.border}`,
                      cursor: "pointer",
                      background: o.orderId === order.orderId ? UI.soft : "white"
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      {o.orderId} • {o.status === "CONFIRMED" ? "CONFERMATO" : "BOZZA"}
                    </div>
                    <div style={{ fontSize: 12, color: UI.muted, marginTop: 2 }}>
                      {o.club || "—"} • Aggiornato: {new Date(o.updatedAtISO).toLocaleString("it-IT")}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button onClick={newOrder} style={modalBtnPrimary}>Nuovo ordine</button>
                <button onClick={saveCurrentToArchive} style={modalBtn}>Salva ordine corrente</button>
              </div>
            </div>
          </div>
        )}

        {/* ===== Modale Export ===== */}
        {showExport && (
          <div style={modalWrap}>
            <div style={modalCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 1000 }}>
                  Export JSON ({exportMode === "CURRENT" ? "ordine corrente" : "archivio"})
                </div>
                <button onClick={() => setShowExport(false)} style={modalClose}>Chiudi</button>
              </div>

              <textarea value={exportText} readOnly style={{ ...textareaBase, marginTop: 12, minHeight: 320, fontSize: 12 }} />

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(exportText);
                    alert("Copiato negli appunti");
                  }}
                  style={modalBtnPrimary}
                >
                  Copia
                </button>
                <button onClick={() => setShowExport(false)} style={modalBtn}>Ok</button>
              </div>
            </div>
          </div>
        )}

        {/* ===== Modale Import ===== */}
        {showImport && (
          <div style={modalWrap}>
            <div style={modalCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 1000 }}>Import JSON</div>
                <button onClick={() => setShowImport(false)} style={modalClose}>Chiudi</button>
              </div>

              <div style={{ marginTop: 10, color: UI.muted, fontSize: 12 }}>
                Incolla un JSON di <b>un ordine</b> oppure un JSON di <b>archivio (array)</b>.
              </div>

              <textarea value={importText} onChange={(e) => setImportText(e.target.value)} style={{ ...textareaBase, marginTop: 12, minHeight: 320, fontSize: 12 }} />

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={applyImport} style={modalBtnPrimary}>Importa</button>
                <button onClick={() => { setImportText(""); setShowImport(false); }} style={modalBtn}>Annulla</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

/** ===== UI helpers ===== */
function topBtn(kind: "solid" | "ghost"): CSSProperties {
  if (kind === "solid") {
    return {
      padding: "10px 14px",
      borderRadius: 12,
      border: "none",
      cursor: "pointer",
      fontWeight: 900,
      background: "white",
      color: UI.navy
    };
  }
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    fontWeight: 900,
    background: "rgba(255,255,255,.18)",
    color: "white"
  };
}

function primaryBtn(locked: boolean): CSSProperties {
  return {
    padding: "12px 14px",
    background: UI.blue,
    color: "white",
    border: "none",
    borderRadius: 12,
    cursor: locked ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: locked ? .55 : 1
  };
}

function softBtn(locked: boolean): CSSProperties {
  return {
    padding: "12px 14px",
    background: UI.soft,
    color: UI.navy,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    cursor: locked ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: locked ? .55 : 1
  };
}

const card: CSSProperties = {
  background: UI.card,
  border: `1px solid ${UI.border}`,
  borderRadius: 16,
  padding: 14
};

const itemCard: CSSProperties = {
  background: UI.card,
  border: `1px solid ${UI.border}`,
  borderRadius: 16,
  padding: 14,
  marginBottom: 12,
  boxShadow: "0 10px 25px rgba(2,6,23,.06)"
};

const textareaBase: CSSProperties = {
  width: "100%",
  minHeight: 92,
  padding: 12,
  border: `1px solid ${UI.border}`,
  borderRadius: 12,
  fontSize: 16,
  lineHeight: "20px",
  boxSizing: "border-box"
};

const sizeCard: CSSProperties = {
  background: UI.bg,
  border: `1px solid ${UI.border}`,
  borderRadius: 14,
  padding: 10
};

const qtyInput: CSSProperties = {
  marginTop: 8,
  width: "100%",
  padding: 10,
  border: `1px solid ${UI.border}`,
  borderRadius: 12,
  background: "white",
  fontSize: 18,
  fontWeight: 900,
  textAlign: "center"
};

/** ===== Modale styles ===== */
const modalWrap: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2,6,23,.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 14,
  zIndex: 1000
};

const modalCard: CSSProperties = {
  width: "min(920px, 100%)",
  background: "white",
  borderRadius: 16,
  border: "1px solid #E5E7EB",
  padding: 14,
  boxShadow: "0 18px 60px rgba(2,6,23,.25)"
};

const modalClose: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #E5E7EB",
  background: "white",
  cursor: "pointer",
  fontWeight: 900
};

const modalBtnPrimary: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "none",
  background: "#0B1F3B",
  color: "white",
  cursor: "pointer",
  fontWeight: 900
};

const modalBtn: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #E5E7EB",
  background: "white",
  cursor: "pointer",
  fontWeight: 900
};