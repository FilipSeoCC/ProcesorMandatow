"use client";

import {
  Bell,
  Bug,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  FileDown,
  Files,
  ImagePlus,
  Inbox,
  LayoutDashboard,
  Landmark,
  LogOut,
  Menu,
  MoreHorizontal,
  ScanLine,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Branches from "./branches";
import DeliveryPlanner from "./delivery-planner";
import Employees from "./employees";
import FleetManager from "./fleet-manager";
import bugStyles from "./auth-gate.module.css";
import styles from "./workspace.module.css";

type CaseStatus =
  | "Do weryfikacji"
  | "Dopasowano"
  | "Nowa"
  | "Zweryfikowana"
  | "Zrealizowana";

type CaseItem = {
  // Stable identity (the document UUID for real cases) — used for React keys,
  // selection and lookups. Deliberately NOT the case number: two letters from
  // the same authority can legitimately carry the same one, and keying on it
  // made the second document collide with the first and become unselectable.
  id: string;
  // Human-facing case number shown in the UI. Display only.
  caseNumber: string;
  documentId?: string;
  uploadedBy?: string | null;
  createdAt?: string;
  plate: string;
  sender: string;
  authorityName?: string | null;
  authorityAddress?: string | null;
  authorityConfidence?: number;
  authoritySource?: "ocr" | "stored" | "none";
  extractionConfidence?: Record<string, number>;
  eventAt: string;
  letterDate?: string | null;
  receivedAt: string;
  deadline: string;
  status: CaseStatus;
  customer: string;
  agreement: string;
  previewUrl?: string | null;
  previewPages?: string[];
  ocrStatus?: string;
  ocrText?: string | null;
  responsibleName?: string;
  responsibleTaxId?: string;
  responsibleEmail?: string;
  confirmedAt?: string | null;
  resolvedAt?: string | null;
  reviewPackageSentAt?: string | null;
};

// Statuses the background OCR job can still move on from by itself —
// worth polling for. Config/failure states need an explicit retry instead.
const pendingOcrStatuses = new Set(["uploaded", "processing"]);

type UploadPage = { id: string; file: File; name: string };

function extensionOf(fileName: string) {
  const match = fileName.match(/\.[^.]+$/);
  return match ? match[0] : "";
}

async function prepareCameraUpload(file: File, displayName: string) {
  const trimmedName = displayName.trim();
  const namedWithOriginalExtension = trimmedName
    ? `${trimmedName}${extensionOf(file.name)}`
    : file.name;
  if (!file.type.startsWith("image/") || file.size <= 1_000_000)
    return { blob: file as Blob, name: namedWithOriginalExtension };

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Nie udało się odczytać zdjęcia."));
      element.src = sourceUrl;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    if (!blob || blob.size >= file.size)
      return { blob: file as Blob, name: namedWithOriginalExtension };
    return {
      blob,
      name: `${trimmedName || file.name.replace(/\.[^.]+$/, "") || "skan"}.jpg`,
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

// Loose plausibility check, same spirit as the OCR-side plate/date checks:
// flags obvious garbage (digits, a single character, stray symbols) without
// rejecting real names — Polish names carry diacritics, hyphenated
// surnames, multiple given names, apostrophes, etc.
function plausibleName(value: string) {
  const trimmed = value.trim();
  return trimmed.length >= 2 && /^[\p{L} .'-]+$/u.test(trimmed) && /\p{L}/u.test(trimmed);
}

const OCR_FIELD_KEYS = ["registrationNumber", "eventAt", "caseNumber", "sender"] as const;

// Real OCR stats when extraction_confidence is on the document, otherwise a
// presence-based estimate for legacy/demo cases that never went through OCR.
function ocrFieldStats(item: CaseItem) {
  const confidence = item.extractionConfidence;
  if (confidence) {
    const values = OCR_FIELD_KEYS.map((key) => confidence[key] ?? 0);
    const recognized = values.filter((value) => value > 0).length;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { recognized, total: values.length, confidencePercent: Math.round(average * 100) };
  }
  const presence = [
    Boolean(item.plate) && item.plate !== "OCR…",
    Boolean(item.eventAt) && item.eventAt !== "Oczekuje na OCR",
    Boolean(item.caseNumber),
    Boolean(item.sender) && item.sender !== "Nowy dokument z telefonu",
  ];
  return {
    recognized: presence.filter(Boolean).length,
    total: presence.length,
    confidencePercent: null as number | null,
  };
}

function plausibleAuthorityLabel(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.length >= 4 &&
    trimmed.length <= 150 &&
    !/urządzeni[ea] rejestrując|w związku z|ujawnieniem naruszenia|niniejszym/i.test(
      trimmed,
    ) &&
    /canard|centrum automatycznego nadzoru|inspektorat transportu drogowego|straż (?:miejska|gminna)|policj|urząd skarbow|urząd (?:miasta|gminy|miejski|marszałkowski)|zarząd dróg/i.test(
      trimmed,
    )
  );
}

function formatCaseEventAt(value: string) {
  const iso = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/,
  );
  if (!iso) return value;
  const date = `${iso[3]}.${iso[2]}.${iso[1]}`;
  return iso[4] && iso[5] ? `${date}, ${iso[4]}:${iso[5]}` : date;
}

function storedAccessToken() {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
    try {
      const session = JSON.parse(localStorage.getItem(key) || "null");
      if (session?.access_token) return String(session.access_token);
    } catch {}
  }
  return null;
}

const demoCases: CaseItem[] = [
  {
    id: "SM/8421/26",
    caseNumber: "SM/8421/26",
    plate: "WI 2847K",
    sender: "Straż Miejska m.st. Warszawy",
    eventAt: "18.07.2026, 14:32",
    receivedAt: "Dzisiaj, 09:14",
    deadline: "4 dni",
    status: "Do weryfikacji",
    customer: "Nova Bud Sp. z o.o.",
    agreement: "W/2026/0418",
  },
  {
    id: "CAN/1093/26",
    caseNumber: "CAN/1093/26",
    plate: "WW 91R2",
    sender: "CANARD",
    eventAt: "15.07.2026, 08:07",
    receivedAt: "Dzisiaj, 08:46",
    deadline: "8 dni",
    status: "Dopasowano",
    customer: "Marcin Wiśniewski",
    agreement: "W/2026/0381",
  },
  {
    id: "GITD/771/26",
    caseNumber: "GITD/771/26",
    plate: "WX 5520M",
    sender: "Główny Inspektorat Transportu Drogowego",
    eventAt: "12.07.2026, 19:41",
    receivedAt: "Wczoraj, 15:20",
    deadline: "11 dni",
    status: "Nowa",
    customer: "—",
    agreement: "—",
  },
  {
    id: "SM/8134/26",
    caseNumber: "SM/8134/26",
    plate: "WPR 77A9",
    sender: "Straż Miejska w Piasecznie",
    eventAt: "09.07.2026, 12:18",
    receivedAt: "Wczoraj, 11:08",
    deadline: "6 dni",
    status: "Dopasowano",
    customer: "Verto Group Sp. z o.o.",
    agreement: "W/2026/0356",
  },
];

function accountDisplayName(account: {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
} | null) {
  if (!account) return "Konto użytkownika";
  const full = `${account.firstName ?? ""} ${account.lastName ?? ""}`.trim();
  return full || account.email || "Konto użytkownika";
}

function accountInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "?";
}

const statusClass: Record<CaseStatus, string> = {
  "Do weryfikacji": styles.statusReview,
  Dopasowano: styles.statusMatched,
  Nowa: styles.statusNew,
  Zweryfikowana: styles.statusMatched,
  Zrealizowana: styles.statusResolved,
};

type BugStatus = "nowe" | "w_trakcie" | "rozwiazane" | "brak_realizacji";

const bugStatusLabel: Record<BugStatus, string> = {
  nowe: "Nowe",
  w_trakcie: "W trakcie",
  rozwiazane: "Zrobione",
  brak_realizacji: "Brak realizacji",
};

const bugStatusClass: Record<BugStatus, string> = {
  nowe: styles.statusReview,
  w_trakcie: styles.statusNew,
  rozwiazane: styles.statusMatched,
  brak_realizacji: styles.statusClosed,
};

// Closed either way — done or explicitly not going to happen — drops out of
// the "needs attention" count in the sidebar nav badge.
const bugStatusOpen = (status: BugStatus) =>
  status !== "rozwiazane" && status !== "brak_realizacji";

export default function MandatyWorkspace() {
  const [activeView, setActiveView] = useState<
    "cases" | "fleet" | "documents" | "routes" | "employees" | "bugs" | "branches"
  >("cases");
  const [fleetImportOpen, setFleetImportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [bugReportDescription, setBugReportDescription] = useState("");
  const [bugReportStatus, setBugReportStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [bugReportError, setBugReportError] = useState<string | null>(null);
  const [bugReportAttachment, setBugReportAttachment] = useState<File | null>(
    null,
  );
  const [bugReportAttachmentPreview, setBugReportAttachmentPreview] =
    useState<string | null>(null);
  const [account, setAccount] = useState<{
    email: string | null;
    role: string | null;
    userId: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [nameFirst, setNameFirst] = useState("");
  const [nameLast, setNameLast] = useState("");
  const [nameStatus, setNameStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [nameError, setNameError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    id: number;
    success: boolean;
    message: string;
  } | null>(null);
  const [caseItems, setCaseItems] = useState<CaseItem[]>(demoCases);
  const [selectedId, setSelectedId] = useState(demoCases[0].id);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"Wszystkie" | CaseStatus>("Wszystkie");
  const [scanOpen, setScanOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [uploadedPages, setUploadedPages] = useState<UploadPage[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);
  const [matchOk, setMatchOk] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [sendPackageOpen, setSendPackageOpen] = useState(false);
  const [sendingPackage, setSendingPackage] = useState(false);
  const [sendPackageError, setSendPackageError] = useState<string | null>(null);
  const [authorityPackageOpen, setAuthorityPackageOpen] = useState(false);
  const [sendingAuthorityPackage, setSendingAuthorityPackage] = useState(false);
  const [preparingAuthorityPdf, setPreparingAuthorityPdf] = useState(false);
  const [authorityPackageError, setAuthorityPackageError] = useState<string | null>(null);
  const [authorityName, setAuthorityName] = useState("");
  const [authorityAddress, setAuthorityAddress] = useState("");
  const [caseMenuOpen, setCaseMenuOpen] = useState(false);
  const [deletingCase, setDeletingCase] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [team, setTeam] = useState<
    Array<{ userId: string; role: string; status: string; email: string | null; name: string | null }>
  >([]);
  const [teamUpdating, setTeamUpdating] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  // Role change is a permission change, not a value you fix like a typo —
  // stage it and require an explicit confirm, same reasoning as the
  // send-review-package dialog: no destructive action fires on a single
  // accidental click.
  const [teamPending, setTeamPending] = useState<{
    userId: string;
    role: "admin" | "boss" | "user";
  } | null>(null);
  const [docEmployeeFilter, setDocEmployeeFilter] = useState("Wszyscy");
  const [docDateFrom, setDocDateFrom] = useState("");
  const [docDateTo, setDocDateTo] = useState("");
  const [bugReports, setBugReports] = useState<
    Array<{
      id: string;
      description: string;
      context: string;
      reporter_email: string;
      status: BugStatus;
      created_at: string;
      attachmentUrl: string | null;
    }>
  >([]);
  const [bugReportsLoading, setBugReportsLoading] = useState(false);
  const [bugUpdating, setBugUpdating] = useState<string | null>(null);
  const [notificationsSeenAt, setNotificationsSeenAt] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [draft, setDraft] = useState({
    plate: "",
    eventAt: "",
    caseNumber: "",
    sender: "",
    responsibleName: "",
    responsibleTaxId: "",
    responsibleEmail: "",
  });

  const selected =
    caseItems.find((item) => item.id === selectedId) ?? caseItems[0];

  // Keyed on the underlying values, not just selected.id: the OCR poll can
  // fill in a match for the case that is already open, and with an id-only
  // dependency this effect never re-ran, so the panel kept showing "Brak
  // dopasowania" until the user navigated away and back. Polling returns
  // identical values while nothing changes, so this does not fight the user's
  // typing — it only re-runs when the server value actually moved.
  useEffect(() => {
    if (!selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the edit form when the selected case changes, not a derived-render value
    setDraft({
      plate: selected.plate === "OCR…" ? "" : selected.plate,
      eventAt: selected.eventAt === "Oczekuje na OCR" ? "" : selected.eventAt,
      caseNumber: selected.caseNumber ?? "",
      sender:
        selected.sender === "Nowy dokument z telefonu" ? "" : selected.sender,
      responsibleName: selected.responsibleName ?? "",
      responsibleTaxId: selected.responsibleTaxId ?? "",
      responsibleEmail: selected.responsibleEmail ?? "",
    });
    setMatchMessage(null);
    setMatchOk(false);
    setSaveError(null);
    setAuthorityPackageOpen(false);
    setAuthorityPackageError(null);
    setAuthorityName(
      selected.authorityName ||
        (plausibleAuthorityLabel(selected.sender) ? selected.sender : ""),
    );
    setAuthorityAddress(selected.authorityAddress || "");
    setCaseMenuOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selected?.id,
    selected?.plate,
    selected?.eventAt,
    selected?.sender,
    selected?.responsibleName,
    selected?.responsibleTaxId,
    selected?.responsibleEmail,
    selected?.authorityName,
    selected?.authorityAddress,
  ]);

  const filtered = useMemo(
    () =>
      caseItems.filter((item) => {
        const matchesQuery = `${item.plate} ${item.caseNumber} ${item.sender}`
          .toLowerCase()
          .includes(query.toLowerCase());
        return (
          matchesQuery && (filter === "Wszystkie" || item.status === filter)
        );
      }),
    [caseItems, filter, query],
  );

  const caseMetrics = useMemo(() => {
    const newCount = caseItems.filter((item) => item.status === "Nowa").length;
    const pendingOcrCount = caseItems.filter(
      (item) => item.ocrStatus && pendingOcrStatuses.has(item.ocrStatus),
    ).length;
    const reviewCount = caseItems.filter(
      (item) => item.status === "Do weryfikacji",
    ).length;
    const matchedCount = caseItems.filter((item) => item.responsibleName).length;
    const matchedPercent = caseItems.length
      ? Math.round((matchedCount / caseItems.length) * 100)
      : 0;
    return { newCount, pendingOcrCount, reviewCount, matchedPercent };
  }, [caseItems]);

  function employeeLabel(userId?: string | null) {
    if (!userId) return "Nieznany";
    const member = team.find((entry) => entry.userId === userId);
    return member?.name || member?.email || "Nieznany";
  }

  async function loadTeam() {
    const response = await fetch("/api/team", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json().catch(() => null);
    if (data?.team) setTeam(data.team);
  }

  async function changeTeamRole(userId: string, role: "admin" | "boss" | "user") {
    setTeamUpdating(userId);
    setTeamError(null);
    try {
      const response = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Nie udało się zmienić roli.");
      setTeamPending(null);
      await loadTeam();
    } catch (reason) {
      setTeamError(reason instanceof Error ? reason.message : "Nie udało się zmienić roli.");
    } finally {
      setTeamUpdating(null);
    }
  }

  async function loadBugReports() {
    setBugReportsLoading(true);
    try {
      const response = await fetch("/api/bug-reports", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setBugReports(data.reports ?? []);
    } finally {
      setBugReportsLoading(false);
    }
  }

  async function loadNotificationsSeenAt() {
    const response = await fetch("/api/notifications", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    setNotificationsSeenAt(data.seenAt ?? null);
  }

  async function toggleNotifications() {
    const opening = !notificationsOpen;
    setNotificationsOpen(opening);
    if (!opening) return;
    // Marks everything currently shown as seen — the dot/count clears on
    // open, independent of each report's own status (that's what the Błędy
    // nav badge tracks separately).
    const response = await fetch("/api/notifications", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setNotificationsSeenAt(data.seenAt ?? new Date().toISOString());
  }

  async function updateBugStatus(id: string, status: BugStatus) {
    setBugUpdating(id);
    try {
      const response = await fetch(`/api/bug-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (response.ok) await loadBugReports();
    } finally {
      setBugUpdating(null);
    }
  }

  useEffect(() => {
    if (account?.role !== "admin") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-role-known pattern
    loadBugReports().catch(() => null);
    loadNotificationsSeenAt().catch(() => null);
  }, [account?.role]);

  const unseenBugReports = bugReports.filter(
    (report) =>
      !notificationsSeenAt || new Date(report.created_at) > new Date(notificationsSeenAt),
  );

  const docFiltered = useMemo(
    () =>
      caseItems.filter((item) => {
        const matchesEmployee =
          docEmployeeFilter === "Wszyscy" ||
          (item.uploadedBy ?? "") === docEmployeeFilter;
        const day = item.createdAt ? item.createdAt.slice(0, 10) : "";
        const matchesFrom = !docDateFrom || (day && day >= docDateFrom);
        const matchesTo = !docDateTo || (day && day <= docDateTo);
        return matchesEmployee && matchesFrom && matchesTo;
      }),
    [caseItems, docEmployeeFilter, docDateFrom, docDateTo],
  );

  async function loadDocuments(preserveSelection: boolean) {
    const response = await fetch("/api/documents", { cache: "no-store" });
    if (!response.ok) return null;
    const result = (await response.json()) as {
      documents?: Array<{
        id: string;
        status: string;
        created_at: string;
        uploaded_by: string | null;
        registration_number: string | null;
        event_at: string | null;
        letter_date: string | null;
        case_number: string | null;
        sender: string | null;
        authority_name?: string | null;
        authority_address?: string | null;
        authority_confidence?: number;
        authority_source?: "ocr" | "stored" | "none";
        extraction_confidence?: Record<string, number>;
        previewUrl: string | null;
        previewPages?: string[];
        ocr_text: string | null;
        responsible_name: string;
        responsible_tax_id: string;
        responsible_email: string;
        confirmed_at: string | null;
        resolved_at: string | null;
        review_package_sent_at?: string | null;
      }>;
    };
    // Zero documents is a real state (every case deleted), not a failure to
    // ignore — returning early without clearing would leave the just-deleted
    // cases on screen, still selectable, pointing at ids the server no longer
    // has. The detail panel is conditionally rendered for exactly this case.
    if (!result.documents?.length) {
      setCaseItems([]);
      setSelectedId("");
      return [];
    }
    const mapped: CaseItem[] = result.documents.map((document) => ({
      id: document.id,
      caseNumber:
        document.case_number || document.id.slice(0, 13).toUpperCase(),
      documentId: document.id,
      uploadedBy: document.uploaded_by,
      plate: document.registration_number || "OCR…",
      sender: document.sender || "Nowy dokument z telefonu",
      authorityName: document.authority_name ?? null,
      authorityAddress: document.authority_address ?? null,
      authorityConfidence: document.authority_confidence ?? 0,
      authoritySource: document.authority_source ?? "none",
      extractionConfidence: document.extraction_confidence,
      eventAt: document.event_at || "Oczekuje na OCR",
      letterDate: document.letter_date,
      receivedAt: new Date(document.created_at).toLocaleString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
      createdAt: document.created_at,
      deadline: "—",
      status: document.resolved_at
        ? "Zrealizowana"
        : document.confirmed_at
          ? "Zweryfikowana"
          : document.status === "ready" ||
              document.status === "needs_review" ||
              document.status === "ocr_failed" ||
              document.status === "retake_required"
            ? "Do weryfikacji"
            : "Nowa",
      customer: document.responsible_name || "—",
      agreement: "—",
      previewUrl: document.previewUrl,
      previewPages: document.previewPages ?? [],
      ocrStatus: document.status,
      ocrText: document.ocr_text,
      responsibleName: document.responsible_name,
      responsibleTaxId: document.responsible_tax_id,
      responsibleEmail: document.responsible_email,
      confirmedAt: document.confirmed_at,
      resolvedAt: document.resolved_at,
      reviewPackageSentAt: document.review_package_sent_at ?? null,
    }));
    const justFinished = mapped.find((item) => {
      const prior = caseItems.find((existing) => existing.id === item.id);
      return (
        prior?.ocrStatus &&
        pendingOcrStatuses.has(prior.ocrStatus) &&
        item.ocrStatus &&
        !pendingOcrStatuses.has(item.ocrStatus)
      );
    });
    if (justFinished) {
      const success =
        justFinished.ocrStatus === "ready" ||
        justFinished.ocrStatus === "needs_review";
      setToast({
        id: Date.now(),
        success,
        message: success
          ? `OCR zakończony sukcesem: ${justFinished.caseNumber}`
          : justFinished.ocrStatus === "retake_required"
            ? `Zdjęcie nieczytelne, zrób je ponownie: ${justFinished.caseNumber}`
            : `Analiza OCR nie powiodła się: ${justFinished.caseNumber}`,
      });
    }
    setCaseItems(mapped);
    setSelectedId((current) =>
      preserveSelection && mapped.some((item) => item.id === current)
        ? current
        : mapped[0].id,
    );
    return mapped;
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern
    loadDocuments(false).catch(() => null);
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data)
          setAccount({
            email: data.email ?? null,
            role: data.role ?? null,
            userId: data.userId ?? null,
            firstName: data.firstName ?? null,
            lastName: data.lastName ?? null,
          });
      })
      .catch(() => null);
    loadTeam().catch(() => null);
  }, []);

  async function changePassword() {
    if (newPassword.length < 8) {
      setPasswordStatus("error");
      setPasswordError("Nowe hasło musi mieć minimum 8 znaków.");
      return;
    }
    setPasswordStatus("saving");
    setPasswordError(null);
    try {
      const response = await fetch("/api/auth", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Nie udało się zmienić hasła.");
      setPasswordStatus("saved");
      setNewPassword("");
    } catch (reason) {
      setPasswordStatus("error");
      setPasswordError(
        reason instanceof Error ? reason.message : "Nie udało się zmienić hasła.",
      );
      return;
    }
  }

  async function saveName() {
    if (!nameFirst.trim() || !nameLast.trim()) {
      setNameStatus("error");
      setNameError("Podaj imię i nazwisko.");
      return;
    }
    setNameStatus("saving");
    setNameError(null);
    try {
      const response = await fetch("/api/auth", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: nameFirst.trim(), lastName: nameLast.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Nie udało się zapisać danych.");
      setNameStatus("saved");
      setAccount((current) =>
        current
          ? { ...current, firstName: nameFirst.trim(), lastName: nameLast.trim() }
          : current,
      );
    } catch (reason) {
      setNameStatus("error");
      setNameError(
        reason instanceof Error ? reason.message : "Nie udało się zapisać danych.",
      );
    }
  }

  useEffect(() => {
    const hasPending = caseItems.some(
      (item) => item.ocrStatus && pendingOcrStatuses.has(item.ocrStatus),
    );
    if (!hasPending) return;
    const interval = window.setInterval(() => {
      loadDocuments(true).catch(() => null);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [caseItems]);

  async function retryOcr() {
    if (!selected.documentId || retrying) return;
    setRetrying(true);
    try {
      const response = await fetch(
        `/api/documents/${selected.documentId}/retry`,
        { method: "POST" },
      );
      if (response.ok) await loadDocuments(true);
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selectedFiles.length === 0) return;

    const unsupportedFile = selectedFiles.find(
      (file) => !/\.(pdf|jpe?g|png|tiff?|heic|heif)$/i.test(file.name),
    );
    if (unsupportedFile) {
      setUploadError(
        `Format pliku „${unsupportedFile.name}” nie jest obsługiwany.`,
      );
      return;
    }

    const invalidFile = selectedFiles.find(
      (file) => file.size > 15 * 1024 * 1024,
    );
    if (invalidFile) {
      setUploadError(`Plik „${invalidFile.name}” przekracza limit 15 MB.`);
      return;
    }

    if (uploadedPages.length + selectedFiles.length > 10) {
      setUploadError("Jedna sprawa może zawierać maksymalnie 10 stron.");
      return;
    }

    setUploadError(null);
    setUploadedPages((current) => [
      ...current,
      ...selectedFiles.map((file, offset) => ({
        id: `${Date.now()}-${current.length + offset}`,
        file,
        name: `Dokument ${current.length + offset + 1}`,
      })),
    ]);
    setProcessing(true);
    window.setTimeout(() => setProcessing(false), 700);
  }

  function removePage(id: string) {
    setUploadedPages((current) => current.filter((page) => page.id !== id));
    setUploadError(null);
  }

  async function handleSave() {
    if (!selected.documentId || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/documents/${selected.documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationNumber: draft.plate,
          eventAt: draft.eventAt,
          caseNumber: draft.caseNumber,
          sender: draft.sender,
          responsibleName: draft.responsibleName,
          responsibleTaxId: draft.responsibleTaxId,
          responsibleEmail: draft.responsibleEmail,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Nie udało się zapisać sprawy.");
      await loadDocuments(true);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) {
      setSaveError(
        reason instanceof Error ? reason.message : "Nie udało się zapisać sprawy.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function rematch() {
    if (!selected.documentId || matching) return;
    setMatching(true);
    setMatchMessage(null);
    setMatchOk(false);
    try {
      const response = await fetch(
        `/api/documents/${selected.documentId}/match`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            registrationNumber: draft.plate,
            eventAt: draft.eventAt,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Nie udało się dopasować klienta.");
      if (data.matched) {
        setDraft((current) => ({
          ...current,
          responsibleName: data.responsibleName ?? current.responsibleName,
          responsibleTaxId: data.responsibleTaxId ?? current.responsibleTaxId,
          responsibleEmail: data.responsibleEmail ?? current.responsibleEmail,
        }));
        setMatchMessage("Znaleziono dopasowanie — sprawdź dane i zatwierdź.");
        setMatchOk(true);
      } else {
        setMatchMessage(
          data.reason || "Nie znaleziono dopasowania — uzupełnij dane ręcznie.",
        );
      }
    } catch (reason) {
      setMatchMessage(
        reason instanceof Error ? reason.message : "Nie udało się dopasować klienta.",
      );
    } finally {
      setMatching(false);
    }
  }

  // What's stopping "Wyslij pakiet do pracownika" right now — shown near the
  // button instead of just graying it out, so the reviewer knows exactly
  // what to fix rather than guessing. Only surfaced once the case is
  // confirmed (same gate as the notice-PDF button below) — before that,
  // "Zatwierdź dane" is already the obvious next step.
  const sendPackageBlockers = selected.confirmedAt
    ? [
        !selected.plate || selected.plate === "OCR…" ? "numer rejestracyjny" : null,
        !selected.eventAt || selected.eventAt === "Oczekuje na OCR"
          ? "data zdarzenia"
          : null,
        !draft.responsibleName ? "dopasowany odbiorca" : null,
        !draft.responsibleEmail ? "e-mail odbiorcy" : null,
      ].filter((item): item is string => Boolean(item))
    : [];

  function openSendPackage() {
    setSendPackageError(null);
    setSendPackageOpen(true);
  }

  async function sendReviewPackage() {
    if (!selected.documentId || sendingPackage) return;
    setSendingPackage(true);
    setSendPackageError(null);
    try {
      const response = await fetch(
        `/api/documents/${selected.documentId}/send-review-package`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Nie udało się wysłać wiadomości.");
      setSendPackageOpen(false);
      setToast({
        id: Date.now(),
        success: true,
        message: "Gotowy pakiet został wysłany na Twój e-mail.",
      });
      await loadDocuments(true);
    } catch (reason) {
      setSendPackageError(
        reason instanceof Error
          ? reason.message
          : "Nie udało się wysłać wiadomości.",
      );
    } finally {
      setSendingPackage(false);
    }
  }

  function openAuthorityPackage() {
    setAuthorityPackageError(null);
    setAuthorityName(
      selected.authorityName ||
        (plausibleAuthorityLabel(draft.sender) ? draft.sender.trim() : "") ||
        (plausibleAuthorityLabel(selected.sender) ? selected.sender : ""),
    );
    setAuthorityAddress(selected.authorityAddress || "");
    setAuthorityPackageOpen(true);
  }

  async function downloadAuthorityNotice() {
    if (!selected.documentId) return;
    if (!authorityName.trim() || !authorityAddress.trim()) {
      setAuthorityPackageError("Uzupełnij nazwę i pełny adres urzędu.");
      return;
    }
    setPreparingAuthorityPdf(true);
    setAuthorityPackageError(null);
    try {
      const response = await fetch(
        `/api/documents/${selected.documentId}/authority-notice`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authorityName: authorityName.trim(),
            authorityAddress: authorityAddress.trim(),
          }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Nie udało się przygotować PDF.");
      }
      const pdf = await response.blob();
      const downloadUrl = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `pismo-do-urzedu-${selected.caseNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
    } catch (reason) {
      setAuthorityPackageError(
        reason instanceof Error
          ? reason.message
          : "Nie udało się przygotować PDF.",
      );
    } finally {
      setPreparingAuthorityPdf(false);
    }
  }

  async function sendAuthorityPackage() {
    if (!selected.documentId || sendingAuthorityPackage) return;
    if (!authorityName.trim() || !authorityAddress.trim()) {
      setAuthorityPackageError("Uzupełnij nazwę i pełny adres urzędu.");
      return;
    }
    setSendingAuthorityPackage(true);
    setAuthorityPackageError(null);
    try {
      const response = await fetch(
        `/api/documents/${selected.documentId}/authority-package`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authorityName: authorityName.trim(),
            authorityAddress: authorityAddress.trim(),
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Nie udało się przygotować pakietu do urzędu.");
      setAuthorityPackageOpen(false);
      setToast({
        id: Date.now(),
        success: true,
        message: "Pakiet do urzędu został wysłany na Twój e-mail.",
      });
    } catch (reason) {
      setAuthorityPackageError(
        reason instanceof Error
          ? reason.message
          : "Nie udało się przygotować pakietu do urzędu.",
      );
    } finally {
      setSendingAuthorityPackage(false);
    }
  }

  async function markResolved() {
    if (!selected.documentId || resolving) return;
    setResolving(true);
    try {
      const response = await fetch(
        `/api/documents/${selected.documentId}/resolve`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Nie udało się oznaczyć sprawy.");
      await loadDocuments(true);
    } catch (reason) {
      setSaveError(
        reason instanceof Error ? reason.message : "Nie udało się oznaczyć sprawy.",
      );
    } finally {
      setResolving(false);
    }
  }

  async function deleteCase() {
    if (!selected.documentId || deletingCase) return;
    if (
      !window.confirm(
        `Usunąć sprawę ${selected.caseNumber}? Tej operacji nie można cofnąć.`,
      )
    )
      return;
    setDeletingCase(true);
    try {
      const response = await fetch(`/api/documents/${selected.documentId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setCaseMenuOpen(false);
        await loadDocuments(false);
      }
    } finally {
      setDeletingCase(false);
    }
  }

  function toggleCaseSelection(documentId?: string | null) {
    if (!documentId) return;
    setSelectedCaseIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedCaseIds(new Set());
  }

  async function bulkDeleteCases() {
    if (selectedCaseIds.size === 0 || bulkWorking) return;
    if (
      !window.confirm(
        `Usunąć ${selectedCaseIds.size} zaznaczonych spraw? Tej operacji nie można cofnąć.`,
      )
    )
      return;
    setBulkWorking(true);
    try {
      await Promise.all(
        [...selectedCaseIds].map((documentId) =>
          fetch(`/api/documents/${documentId}`, { method: "DELETE" }),
        ),
      );
      exitSelectMode();
      await loadDocuments(false);
    } finally {
      setBulkWorking(false);
    }
  }

  async function bulkResolveCases() {
    if (selectedCaseIds.size === 0 || bulkWorking) return;
    setBulkWorking(true);
    try {
      const results = await Promise.all(
        [...selectedCaseIds].map((documentId) =>
          fetch(`/api/documents/${documentId}/resolve`, { method: "POST" }).then(
            (response) => response.ok,
          ),
        ),
      );
      const failed = results.filter((ok) => !ok).length;
      exitSelectMode();
      await loadDocuments(false);
      if (failed > 0)
        setToast({
          id: Date.now(),
          success: false,
          message: `${failed} spraw nie udało się oznaczyć — najpierw wymagane zatwierdzenie danych.`,
        });
    } finally {
      setBulkWorking(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.reload();
  }

  function setBugReportAttachmentFile(file: File | null) {
    setBugReportAttachmentPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return file ? URL.createObjectURL(file) : null;
    });
    setBugReportAttachment(file);
  }

  function pickBugReportAttachment(candidate: File | null) {
    if (!candidate) return;
    if (!candidate.type.startsWith("image/")) return;
    if (candidate.size > 8 * 1024 * 1024) {
      setBugReportStatus("error");
      setBugReportError("Zrzut ekranu przekracza limit 8 MB.");
      return;
    }
    setBugReportAttachmentFile(candidate);
  }

  async function submitBugReportForm() {
    const description = bugReportDescription.trim();
    if (!description) {
      setBugReportStatus("error");
      setBugReportError("Opisz co się stało.");
      return;
    }
    setBugReportStatus("sending");
    setBugReportError(null);
    try {
      const token = storedAccessToken();
      const form = new FormData();
      form.set("description", description);
      form.set("context", document.title);
      if (bugReportAttachment) form.set("attachment", bugReportAttachment);
      const response = await fetch("/api/bug-reports", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Nie udało się wysłać zgłoszenia.");
      setBugReportStatus("sent");
      setBugReportDescription("");
      setBugReportAttachmentFile(null);
      window.setTimeout(() => {
        setBugReportOpen(false);
        setBugReportStatus("idle");
      }, 1600);
    } catch (reason) {
      setBugReportStatus("error");
      setBugReportError(
        reason instanceof Error ? reason.message : "Nie udało się wysłać zgłoszenia.",
      );
    }
  }

  async function uploadDesktopDocument() {
    if (!uploadedPages.length || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      const preparedFiles = await Promise.all(
        uploadedPages.map((page) => prepareCameraUpload(page.file, page.name)),
      );
      const payloadSize = preparedFiles.reduce((sum, file) => sum + file.blob.size, 0);
      if (payloadSize > 4 * 1024 * 1024)
        throw new Error(
          "Zbyt dużo danych do wysłania naraz. Wyślij maksymalnie 3–4 zdjęcia lub podziel dokument na dwie sprawy.",
        );
      const form = new FormData();
      preparedFiles.forEach((file) => form.append("files", file.blob, file.name));
      const token = storedAccessToken();
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Nie udało się przesłać dokumentu.");
      // The upload route answers 200 with mode:"demo" when Supabase isn't
      // configured — nothing was stored. Treating that as success would tell
      // the user their mandate is filed when it silently isn't.
      if (result.mode === "demo")
        throw new Error(
          "Dokument NIE został zapisany — magazyn dokumentów nie jest skonfigurowany. Zgłoś to administratorowi i nie kasuj oryginału.",
        );
      setUploadedPages([]);
      setScanOpen(false);
      await loadDocuments(true);
    } catch (reason) {
      setUploadError(
        reason instanceof Error
          ? reason.message
          : "Nie udało się przesłać dokumentu.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.mobileHeader}>
        <button
          className={styles.iconButton}
          onClick={() => setMobileMenu(true)}
          aria-label="Otwórz menu"
        >
          <Menu size={22} />
        </button>
        <Brand compact />
        <NotificationsBell
          reports={unseenBugReports}
          open={notificationsOpen}
          onToggle={toggleNotifications}
          onOpenBugs={() => {
            setActiveView("bugs");
            setNotificationsOpen(false);
            setMobileMenu(false);
          }}
        />
      </header>

      <aside
        className={`${styles.sidebar} ${mobileMenu ? styles.sidebarOpen : ""}`}
        aria-label="Główna nawigacja"
      >
        <div className={styles.sidebarTop}>
          <Brand />
          <button
            className={`${styles.iconButton} ${styles.mobileOnly}`}
            onClick={() => setMobileMenu(false)}
            aria-label="Zamknij menu"
          >
            <X size={21} />
          </button>
        </div>
        <nav className={styles.nav}>
          <button
            type="button"
            onClick={() => {
              setActiveView("routes");
              setMobileMenu(false);
            }}
            className={`${styles.navItem} ${activeView === "routes" ? styles.navActive : ""}`}
          >
            <LayoutDashboard size={19} />
            Planer tras
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveView("cases");
              setMobileMenu(false);
            }}
            className={`${styles.navItem} ${activeView === "cases" ? styles.navActive : ""}`}
          >
            <Inbox size={19} />
            Sprawy<span className={styles.navCount}>{caseItems.length}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveView("documents");
              setMobileMenu(false);
            }}
            className={`${styles.navItem} ${activeView === "documents" ? styles.navActive : ""}`}
          >
            <FileText size={19} />
            Dokumenty
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveView("fleet");
              setMobileMenu(false);
            }}
            className={`${styles.navItem} ${activeView === "fleet" ? styles.navActive : ""}`}
          >
            <UsersRound size={19} />
            Flota
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveView("employees");
              setMobileMenu(false);
            }}
            className={`${styles.navItem} ${activeView === "employees" ? styles.navActive : ""}`}
          >
            <UserRound size={19} />
            Pracownicy
          </button>
          {(account?.role === "admin" || account?.role === "boss") && (
            <button
              type="button"
              onClick={() => {
                setActiveView("branches");
                setMobileMenu(false);
              }}
              className={`${styles.navItem} ${activeView === "branches" ? styles.navActive : ""}`}
            >
              <Building2 size={19} />
              Oddziały
            </button>
          )}
          {account?.role === "admin" && (
            <button
              type="button"
              onClick={() => {
                setActiveView("bugs");
                setMobileMenu(false);
              }}
              className={`${styles.navItem} ${activeView === "bugs" ? styles.navActive : ""}`}
            >
              <Bug size={19} />
              Błędy
              {bugReports.filter((report) => bugStatusOpen(report.status)).length > 0 && (
                <span className={styles.navCount}>
                  {bugReports.filter((report) => bugStatusOpen(report.status)).length}
                </span>
              )}
            </button>
          )}
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.securityNote}>
            <ShieldCheck size={18} />
            <span>
              <strong>Dane chronione</strong>
              <small>Sesja szyfrowana</small>
            </span>
          </div>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => {
              setBugReportOpen(true);
              setBugReportStatus("idle");
              setBugReportError(null);
            }}
          >
            <Bug size={19} />
            Zgłoś błąd
          </button>
          <div className={styles.accountMenuWrap}>
            {accountMenuOpen && (
              <div className={styles.accountMenu} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setNameFirst(account?.firstName ?? "");
                    setNameLast(account?.lastName ?? "");
                    setNameStatus("idle");
                    setNameError(null);
                    setSettingsOpen(true);
                    setAccountMenuOpen(false);
                  }}
                >
                  <UserRound size={16} />
                  Ustawienia
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    signOut();
                  }}
                >
                  <LogOut size={16} />
                  Wyloguj się
                </button>
              </div>
            )}
            <button
              className={styles.profileButton}
              onClick={() => setAccountMenuOpen((current) => !current)}
            >
              <span className={styles.avatar}>
                {accountInitials(accountDisplayName(account))}
              </span>
              <span>
                <strong>{accountDisplayName(account)}</strong>
                <small>{account?.email || "Kliknij, aby zobaczyć opcje"}</small>
              </span>
              <MoreHorizontal size={18} />
            </button>
          </div>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className={styles.backdrop}
          onClick={() => setMobileMenu(false)}
          aria-label="Zamknij menu"
        />
      )}

      <main id="main-content" className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Operacje</p>
            <h1>
              {activeView === "cases"
                ? "Obsługa mandatów"
                : activeView === "documents"
                  ? "Dokumenty"
                  : activeView === "routes"
                    ? "Planer tras"
                    : activeView === "employees"
                      ? "Pracownicy"
                      : activeView === "bugs"
                        ? "Zgłoszenia błędów"
                        : activeView === "branches"
                          ? "Oddziały"
                          : "Zarządzanie flotą"}
            </h1>
          </div>
          <div className={styles.topbarActions}>
            <button
              type="button"
              className={styles.helpButton}
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={18} />
              Pomoc
            </button>
            <NotificationsBell
              reports={unseenBugReports}
              open={notificationsOpen}
              onToggle={toggleNotifications}
              onOpenBugs={() => {
                setActiveView("bugs");
                setNotificationsOpen(false);
              }}
            />
            {activeView === "fleet" ? (
              <button
                className={styles.primaryButton}
                onClick={() => setFleetImportOpen(true)}
              >
                <Upload size={18} />
                Importuj flotę
              </button>
            ) : activeView === "routes" ||
              activeView === "employees" ||
              activeView === "bugs" ||
              activeView === "branches" ? null : (
              <button
                className={styles.primaryButton}
                onClick={() => setScanOpen(true)}
              >
                <ScanLine size={18} />
                Skanuj dokument
              </button>
            )}
          </div>
        </header>

        {activeView === "fleet" ? (
          <FleetManager
            importOpen={fleetImportOpen}
            onCloseImport={() => setFleetImportOpen(false)}
          />
        ) : activeView === "employees" ? (
          <Employees
            team={team}
            teamPending={teamPending}
            teamUpdating={teamUpdating}
            teamError={teamError}
            viewerRole={account?.role ?? null}
            onStagePendingRole={(userId, role) => setTeamPending({ userId, role })}
            onConfirmRole={changeTeamRole}
            onCancelRole={() => setTeamPending(null)}
          />
        ) : activeView === "routes" ? (
          <DeliveryPlanner employeeLabel={employeeLabel} currentUserName={accountDisplayName(account)} />
        ) : activeView === "branches" ? (
          <Branches />
        ) : activeView === "bugs" ? (
          <section className={styles.bugList} aria-label="Zgłoszenia błędów">
            {bugReportsLoading && bugReports.length === 0 ? (
              <div className={styles.emptyState}>
                <Bug size={24} />
                <strong>Ładowanie…</strong>
              </div>
            ) : bugReports.length === 0 ? (
              <div className={styles.emptyState}>
                <Bug size={24} />
                <strong>Brak zgłoszeń</strong>
                <span>Zgłoszenia błędów od zespołu pojawią się tutaj.</span>
              </div>
            ) : (
              bugReports.map((report) => (
                <article key={report.id} className={styles.bugCard}>
                  <div className={styles.bugCardHeader}>
                    <span
                      className={`${styles.status} ${bugStatusClass[report.status]}`}
                    >
                      {bugStatusLabel[report.status]}
                    </span>
                    <span className={styles.caseMeta}>
                      <span>{report.reporter_email}</span>
                      <span>
                        {new Date(report.created_at).toLocaleString("pl-PL", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                  </div>
                  <p className={styles.bugDescription}>{report.description}</p>
                  {report.context && (
                    <p className={styles.bugContext}>Kontekst: {report.context}</p>
                  )}
                  {report.attachmentUrl && (
                    <a
                      href={report.attachmentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.bugAttachment}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={report.attachmentUrl} alt="Załączony zrzut ekranu" />
                    </a>
                  )}
                  <div className={styles.bugCardFooter}>
                    <label className={styles.selectBox}>
                      <span className={styles.srOnly}>Status zgłoszenia</span>
                      <select
                        value={report.status}
                        disabled={bugUpdating === report.id}
                        onChange={(event) =>
                          updateBugStatus(report.id, event.target.value as BugStatus)
                        }
                      >
                        <option value="nowe">Nowe</option>
                        <option value="w_trakcie">W trakcie</option>
                        <option value="rozwiazane">Zrobione</option>
                        <option value="brak_realizacji">Brak realizacji</option>
                      </select>
                      <ChevronDown size={16} />
                    </label>
                  </div>
                </article>
              ))
            )}
          </section>
        ) : activeView === "documents" ? (
          <>
            <div className={styles.docFilters}>
              <label className={styles.selectBox}>
                <span className={styles.srOnly}>Filtr pracownika</span>
                <select
                  value={docEmployeeFilter}
                  onChange={(event) => setDocEmployeeFilter(event.target.value)}
                >
                  <option value="Wszyscy">Wszyscy pracownicy</option>
                  {team.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name || member.email || member.userId}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </label>
              <label className={styles.selectBox}>
                <span className={styles.srOnly}>Data od</span>
                <input
                  type="date"
                  value={docDateFrom}
                  onChange={(event) => setDocDateFrom(event.target.value)}
                />
              </label>
              <label className={styles.selectBox}>
                <span className={styles.srOnly}>Data do</span>
                <input
                  type="date"
                  value={docDateTo}
                  onChange={(event) => setDocDateTo(event.target.value)}
                />
              </label>
              {(docEmployeeFilter !== "Wszyscy" || docDateFrom || docDateTo) && (
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => {
                    setDocEmployeeFilter("Wszyscy");
                    setDocDateFrom("");
                    setDocDateTo("");
                  }}
                >
                  Wyczyść filtry
                </button>
              )}
            </div>
            <section
              className={styles.documentsGrid}
              aria-label="Wszystkie dokumenty"
            >
              {docFiltered.length === 0 ? (
                <div className={styles.emptyState}>
                  <FileText size={24} />
                  <strong>Brak dokumentów</strong>
                  <span>
                    {caseItems.length === 0
                      ? "Zeskanowane dokumenty pojawią się tutaj."
                      : "Żaden dokument nie pasuje do wybranych filtrów."}
                  </span>
                </div>
              ) : (
                docFiltered.map((item) => (
                  <button
                    key={item.id}
                    className={styles.documentCard}
                    onClick={() => {
                      setSelectedId(item.id);
                      setActiveView("cases");
                      setMobileDetailOpen(true);
                    }}
                  >
                    <span className={styles.documentThumb}>
                      {item.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.previewUrl} alt="" />
                      ) : (
                        <FileText size={26} />
                      )}
                    </span>
                    <span className={styles.documentMeta}>
                      <span className={styles.caseItemTop}>
                        <strong className={styles.plate}>{item.plate}</strong>
                        <span
                          className={`${styles.status} ${statusClass[item.status]}`}
                        >
                          {item.status}
                        </span>
                      </span>
                      <span className={styles.sender}>{item.sender}</span>
                      <span className={styles.caseMeta}>
                        <span>{item.caseNumber}</span>
                        <span>{item.receivedAt}</span>
                      </span>
                      <span className={styles.caseMeta}>
                        <span>Zgłosił: {employeeLabel(item.uploadedBy)}</span>
                      </span>
                    </span>
                  </button>
                ))
              )}
            </section>
          </>
        ) : (
          <>
            <section className={styles.metrics} aria-label="Podsumowanie spraw">
              <Metric
                label="Nowe"
                value={String(caseMetrics.newCount)}
                detail={`${caseMetrics.pendingOcrCount} oczekuje na analizę OCR`}
                icon={<Inbox size={19} />}
              />
              <Metric
                label="Do weryfikacji"
                value={String(caseMetrics.reviewCount)}
                detail="Wymagają potwierdzenia danych"
                icon={<Clock3 size={19} />}
                tone="amber"
              />
              <Metric
                label="Dopasowane"
                value={`${caseMetrics.matchedPercent}%`}
                detail="Wszystkich zgłoszeń"
                icon={<CheckCircle2 size={19} />}
                tone="green"
              />
            </section>

            <section className={styles.workspace} id="sprawy">
              <div className={styles.casePanel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>Kolejka spraw</h2>
                    <p>
                      {filtered.length} z {caseItems.length} aktywnych
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => {
                      if (selectMode) exitSelectMode();
                      else setSelectMode(true);
                    }}
                  >
                    {selectMode ? "Anuluj" : "Zaznacz"}
                  </button>
                </div>
                <div className={styles.filters}>
                  <label className={styles.searchBox}>
                    <Search size={18} />
                    <span className={styles.srOnly}>Szukaj sprawy</span>
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Nr rej. lub numer sprawy"
                    />
                  </label>
                  <label className={styles.selectBox}>
                    <span className={styles.srOnly}>Filtr statusu</span>
                    <select
                      value={filter}
                      onChange={(event) =>
                        setFilter(event.target.value as typeof filter)
                      }
                    >
                      <option>Wszystkie</option>
                      <option>Nowa</option>
                      <option>Do weryfikacji</option>
                      <option>Zweryfikowana</option>
                      <option>Zrealizowana</option>
                    </select>
                    <ChevronDown size={16} />
                  </label>
                </div>
                <div className={styles.caseList}>
                  {filtered.map((item) => (
                    <button
                      key={item.id}
                      className={`${styles.caseItem} ${selectedId === item.id ? styles.caseSelected : ""} ${selectMode ? styles.caseItemSelectable : ""}`}
                      onClick={() => {
                        if (selectMode) {
                          toggleCaseSelection(item.documentId);
                          return;
                        }
                        setSelectedId(item.id);
                        setMobileDetailOpen(true);
                      }}
                    >
                      {selectMode && (
                        <span
                          className={`${styles.caseCheckbox} ${
                            item.documentId && selectedCaseIds.has(item.documentId)
                              ? styles.caseCheckboxOn
                              : ""
                          }`}
                        >
                          {item.documentId && selectedCaseIds.has(item.documentId) && (
                            <Check size={13} />
                          )}
                        </span>
                      )}
                      <span className={styles.caseItemTop}>
                        <strong className={styles.plate}>{item.plate}</strong>
                        <span
                          className={`${styles.status} ${statusClass[item.status]}`}
                        >
                          {item.status}
                        </span>
                      </span>
                      <span className={styles.sender}>{item.sender}</span>
                      <span className={styles.caseMeta}>
                        <span>{item.caseNumber}</span>
                        <span>{item.receivedAt}</span>
                      </span>
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <div className={styles.emptyState}>
                      <Search size={24} />
                      <strong>Brak pasujących spraw</strong>
                      <span>Zmień wyszukiwanie lub filtr.</span>
                    </div>
                  )}
                </div>
                {selectMode && selectedCaseIds.size > 0 && (
                  <div className={styles.bulkBar}>
                    <span>{selectedCaseIds.size} zaznaczonych</span>
                    <div>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={bulkWorking}
                        onClick={bulkResolveCases}
                      >
                        {bulkWorking ? "Pracuję…" : "Oznacz jako zrealizowane"}
                      </button>
                      <button
                        type="button"
                        className={styles.bulkDeleteButton}
                        disabled={bulkWorking}
                        onClick={bulkDeleteCases}
                      >
                        <Trash2 size={15} />
                        Usuń
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {selected && (
              <div
                className={`${styles.detailPanel} ${mobileDetailOpen ? styles.detailPanelOpen : ""}`}
                key={`${selected.id}|${selected.plate}|${selected.eventAt}|${selected.sender}|${selected.ocrStatus}|${selected.customer}`}
              >
                <div className={styles.detailHeader}>
                  <div className={styles.detailTitle}>
                    <button
                      className={`${styles.iconButton} ${styles.mobileOnly}`}
                      onClick={() => setMobileDetailOpen(false)}
                      aria-label="Wróć do listy"
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <div>
                      <span className={styles.mono}>{selected.caseNumber}</span>
                      <h2>{selected.plate}</h2>
                    </div>
                  </div>
                  <div className={styles.detailActions}>
                    <div className={styles.caseMenuWrap}>
                      <button
                        className={styles.moreButton}
                        onClick={() => setCaseMenuOpen((current) => !current)}
                        aria-label="Więcej opcji"
                      >
                        <MoreHorizontal size={20} />
                      </button>
                      {caseMenuOpen && (
                        <div className={styles.caseMenu} role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={!selected.documentId || deletingCase}
                            onClick={deleteCase}
                          >
                            <Trash2 size={15} />
                            {deletingCase ? "Usuwam…" : "Usuń sprawę"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className={styles.reviewGrid}>
                  <DocumentPreview pages={selected.previewPages} fallbackSrc={selected.previewUrl} />
                  <div className={styles.dataPane}>
                  <div className={styles.dataPaneScroll}>
                    <div className={styles.analysisBanner}>
                      <span>
                        <CheckCircle2 size={18} />
                        <strong>
                          {!selected.ocrStatus
                            ? "Analiza zakończona"
                            : pendingOcrStatuses.has(selected.ocrStatus)
                              ? "Analiza w toku"
                              : selected.ocrStatus === "ready"
                                ? "Analiza zakończona"
                                : selected.ocrStatus === "needs_review"
                                  ? "Wymaga weryfikacji"
                                  : selected.ocrStatus === "retake_required"
                                    ? "Zdjęcie nieczytelne"
                                    : "Analiza nie powiodła się"}
                        </strong>
                      </span>
                      <small>
                        {!selected.ocrStatus
                          ? `Rozpoznano ${ocrFieldStats(selected).recognized} z ${ocrFieldStats(selected).total} pól`
                          : pendingOcrStatuses.has(selected.ocrStatus)
                            ? "Trwa rozpoznawanie dokumentu…"
                            : selected.ocrStatus === "ready"
                              ? "Dane OCR gotowe do weryfikacji"
                              : selected.ocrStatus === "needs_review"
                                ? "Część danych nie została rozpoznana — uzupełnij ręcznie poniżej"
                                : selected.ocrStatus === "retake_required"
                                  ? "Nie rozpoznaliśmy żadnych danych na zdjęciu — zrób nowe zdjęcie w dobrym oświetleniu, obejmując całą stronę, usuń tę sprawę i dodaj dokument ponownie"
                                  : "Nie udało się odczytać dokumentu"}
                      </small>
                      {selected.documentId && selected.ocrStatus !== "retake_required" && (
                        <button
                          type="button"
                          className={styles.textButtonFramed}
                          disabled={
                            retrying ||
                            (selected.ocrStatus
                              ? pendingOcrStatuses.has(selected.ocrStatus)
                              : false)
                          }
                          onClick={retryOcr}
                        >
                          {retrying ? "Ponawiam…" : "Uruchom OCR ponownie"}
                        </button>
                      )}
                    </div>
                    <section className={styles.formSection}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <p className={styles.eyebrow}>Dane zdarzenia</p>
                          <h3>Odczyt z dokumentu</h3>
                        </div>
                        {ocrFieldStats(selected).confidencePercent !== null && (
                          <span className={styles.confidence}>
                            {ocrFieldStats(selected).confidencePercent}% pewności
                          </span>
                        )}
                      </div>
                      <div className={styles.formGrid}>
                        <Field
                          label="Numer rejestracyjny"
                          value={draft.plate}
                          onChange={(value) => {
                            setDraft((current) => ({ ...current, plate: value }));
                            setMatchMessage(null);
                          }}
                          confident
                        />
                        <Field
                          label="Data i godzina zdarzenia"
                          value={draft.eventAt}
                          onChange={(value) => {
                            setDraft((current) => ({
                              ...current,
                              eventAt: value,
                            }));
                            setMatchMessage(null);
                          }}
                          confident
                        />
                        <Field
                          label="Numer sprawy"
                          value={draft.caseNumber}
                          onChange={(value) =>
                            setDraft((current) => ({ ...current, caseNumber: value }))
                          }
                        />
                        <Field
                          label="Nadawca"
                          value={draft.sender}
                          onChange={(value) =>
                            setDraft((current) => ({ ...current, sender: value }))
                          }
                          wide
                        />
                      </div>
                      {selected.ocrText && (
                        <details className={styles.ocrRaw}>
                          <summary>Surowy tekst OCR</summary>
                          <pre>{selected.ocrText}</pre>
                        </details>
                      )}
                    </section>
                    <section className={styles.matchCard}>
                      <div className={styles.matchIcon}>
                        <UserRound size={21} />
                      </div>
                      <div className={styles.matchContent}>
                        <span className={styles.matchLabel}>
                          Dopasowany użytkownik pojazdu
                        </span>
                        <strong>
                          {draft.responsibleName || "Brak dopasowania"}
                        </strong>
                        <small>
                          {draft.responsibleEmail ||
                            "Uzupełnij dane ręcznie lub zmień dopasowanie"}
                        </small>
                      </div>
                      {draft.responsibleName && (
                        <span className={styles.matchScore}>
                          <Check size={15} />
                          OK
                        </span>
                      )}
                    </section>
                    {matchMessage && (
                      <p className={matchOk ? styles.matchSuccess : styles.uploadError}>
                        {matchMessage}
                      </p>
                    )}
                    <section className={styles.formSection}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <p className={styles.eyebrow}>Dane do odpowiedzi</p>
                          <h3>Osoba odpowiedzialna</h3>
                        </div>
                        <button
                          type="button"
                          className={styles.textButton}
                          onClick={rematch}
                          disabled={matching}
                        >
                          {matching ? "Dopasowuję…" : "Zmień dopasowanie"}
                        </button>
                      </div>
                      <div className={styles.formGrid}>
                        <Field
                          label="Nazwa / imię i nazwisko"
                          value={draft.responsibleName}
                          onChange={(value) =>
                            setDraft((current) => ({
                              ...current,
                              responsibleName: value,
                            }))
                          }
                          wide
                          warning={
                            !draft.responsibleName ||
                            !plausibleName(draft.responsibleName)
                          }
                        />
                        <Field
                          label="NIP / PESEL"
                          value={draft.responsibleTaxId}
                          onChange={(value) =>
                            setDraft((current) => ({
                              ...current,
                              responsibleTaxId: value,
                            }))
                          }
                        />
                        <Field
                          label="E-mail"
                          value={draft.responsibleEmail}
                          onChange={(value) =>
                            setDraft((current) => ({
                              ...current,
                              responsibleEmail: value,
                            }))
                          }
                        />
                      </div>
                    </section>
                    {saveError && (
                      <p className={styles.uploadError}>{saveError}</p>
                    )}
                  </div>
                    <div className={styles.formFooter}>
                      <span>
                        {selected.resolvedAt
                          ? `Zrealizowano: ${new Date(selected.resolvedAt).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                          : selected.confirmedAt
                            ? `Zatwierdzono: ${new Date(selected.confirmedAt).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                            : "Jeszcze niezatwierdzone"}
                      </span>
                      <div>
                        {selected.confirmedAt && !selected.resolvedAt && (
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={markResolved}
                            disabled={resolving}
                          >
                            {resolving ? "Zapisuję…" : "Oznacz jako zrealizowaną"}
                          </button>
                        )}
                        {selected.confirmedAt && selected.documentId && (
                          <a
                            className={styles.secondaryButton}
                            href={`/api/documents/${selected.documentId}/notice`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <FileDown size={18} /> PDF dla klienta
                          </a>
                        )}
                        {selected.confirmedAt &&
                          selected.documentId &&
                          (sendPackageBlockers.length > 0 ? (
                            <span
                              className={styles.uploadError}
                              title={`Uzupełnij: ${sendPackageBlockers.join(", ")}`}
                            >
                              Brakuje: {sendPackageBlockers.join(", ")}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={openSendPackage}
                              title={
                                selected.reviewPackageSentAt
                                  ? `Ostatnio wysłano: ${new Date(selected.reviewPackageSentAt).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                                  : undefined
                              }
                            >
                              <Send size={18} />
                              {selected.reviewPackageSentAt
                                ? "Pakiet dla klienta ponownie"
                                : "Pakiet dla klienta"}
                            </button>
                          ))}
                        {selected.confirmedAt && selected.documentId && (
                          <button
                            type="button"
                            className={styles.authorityButton}
                            onClick={openAuthorityPackage}
                          >
                            <Landmark size={18} /> Pakiet do urzędu
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={handleSave}
                          disabled={saving}
                        >
                          {saved ? <Check size={18} /> : null}
                          {saving ? "Zapisuję…" : saved ? "Zapisano" : "Zatwierdź dane"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </section>
          </>
        )}
      </main>

      {activeView === "fleet" ? (
        <button
          className={styles.mobileScanButton}
          onClick={() => setFleetImportOpen(true)}
        >
          <Upload size={21} />
          Importuj flotę
        </button>
      ) : activeView === "routes" ||
        activeView === "employees" ||
        activeView === "bugs" ||
        activeView === "branches" ? null : (
        <button
          className={styles.mobileScanButton}
          onClick={() => setScanOpen(true)}
        >
          <Camera size={21} />
          Skanuj dokument
        </button>
      )}

      {toast && (
        <div
          className={`${styles.toast} ${toast.success ? styles.toastSuccess : styles.toastError}`}
          role="status"
        >
          {toast.success ? (
            <CheckCircle2 size={18} />
          ) : (
            <XCircle size={18} />
          )}
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Zamknij powiadomienie"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {sendPackageOpen && (
        <div
          className={styles.modalLayer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-package-title"
        >
          <button
            className={styles.modalBackdrop}
            onClick={() => !sendingPackage && setSendPackageOpen(false)}
            aria-label="Zamknij okno"
          />
          <div className={styles.helpModal}>
            <header>
              <div>
                <span>Sprawa {selected.caseNumber}</span>
                <h2 id="send-package-title">Pakiet dla klienta</h2>
              </div>
              <button
                onClick={() => !sendingPackage && setSendPackageOpen(false)}
                aria-label="Zamknij"
              >
                <X size={21} />
              </button>
            </header>
            <p>
              Wiadomość trafi na Twój e-mail — <strong>nie bezpośrednio
              do klienta</strong>. Będzie zawierać skan wezwania i gotowy
              szablon do przekazania klientowi; przed przesłaniem dalej warto
              go jeszcze sprawdzić.
            </p>
            <ul>
              <li>
                <strong>Pojazd:</strong> {selected.plate}
              </li>
              <li>
                <strong>Data zdarzenia:</strong> {selected.eventAt}
              </li>
              <li>
                <strong>Dopasowany klient:</strong> {draft.responsibleName}
              </li>
            </ul>
            {sendPackageError && (
              <p className={styles.uploadError}>{sendPackageError}</p>
            )}
            <footer>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setSendPackageOpen(false)}
                disabled={sendingPackage}
              >
                Anuluj
              </button>
              <button
                className={styles.primaryButton}
                onClick={sendReviewPackage}
                disabled={sendingPackage}
              >
                <Send size={18} />
                {sendingPackage ? "Wysyłam…" : "Wyślij"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {authorityPackageOpen && (
        <div
          className={styles.modalLayer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="authority-package-title"
        >
          <button
            className={styles.modalBackdrop}
            onClick={() =>
              !sendingAuthorityPackage &&
              !preparingAuthorityPdf &&
              setAuthorityPackageOpen(false)
            }
            aria-label="Zamknij okno"
          />
          <div className={styles.helpModal}>
            <header>
              <div>
                <span>Sprawa {selected.caseNumber}</span>
                <h2 id="authority-package-title">Pakiet do urzędu</h2>
              </div>
              <button
                onClick={() =>
                  !sendingAuthorityPackage &&
                  !preparingAuthorityPdf &&
                  setAuthorityPackageOpen(false)
                }
                aria-label="Zamknij"
              >
                <X size={21} />
              </button>
            </header>
            <p>
              System przygotuje osobne oświadczenie o wskazaniu użytkownika
              pojazdu. PDF możesz pobrać od razu. Po podłączeniu Resenda cały
              pakiet — pismo i skan źródłowy — trafi na Twój e-mail do
              sprawdzenia i przekazania urzędowi.
            </p>
            <div className={styles.authoritySummary}>
              <span>
                <strong>Pojazd</strong>
                {selected.plate}
              </span>
              <span>
                <strong>Data zdarzenia</strong>
                {formatCaseEventAt(selected.eventAt)}
              </span>
              <span>
                <strong>Wskazany użytkownik</strong>
                {draft.responsibleName || "Brak dopasowania"}
              </span>
            </div>
            <div
              className={`${styles.authorityDetection} ${
                selected.authorityName
                  ? styles.authorityDetectionSuccess
                  : styles.authorityDetectionWarning
              }`}
              role="status"
            >
              {selected.authorityName ? (
                <CheckCircle2 size={16} aria-hidden="true" />
              ) : (
                <CircleHelp size={16} aria-hidden="true" />
              )}
              <span>
                <strong>
                  {selected.authorityName
                    ? "Organ rozpoznany ze skanu OCR"
                    : "Nie rozpoznano organu w dokumencie"}
                </strong>
                {selected.authorityName
                  ? "Sprawdź nazwę i adres z nagłówkiem pisma przed pobraniem PDF."
                  : "Uzupełnij nazwę i pełny adres ręcznie — system nie podstawi przypadkowego zdania z treści pisma."}
              </span>
            </div>
            <div className={styles.authorityForm}>
              <label>
                <span>Nazwa urzędu / organu</span>
                <input
                  value={authorityName}
                  onChange={(event) => setAuthorityName(event.target.value)}
                  placeholder="np. Główny Inspektorat Transportu Drogowego"
                  maxLength={200}
                />
              </label>
              <label>
                <span>Pełny adres urzędu</span>
                <textarea
                  value={authorityAddress}
                  onChange={(event) => setAuthorityAddress(event.target.value)}
                  placeholder="Ulica, kod pocztowy i miejscowość"
                  maxLength={500}
                  rows={3}
                />
              </label>
            </div>
            {authorityPackageError && (
              <p className={styles.uploadError} role="alert">
                {authorityPackageError}
              </p>
            )}
            <footer className={styles.authorityModalFooter}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setAuthorityPackageOpen(false)}
                disabled={sendingAuthorityPackage || preparingAuthorityPdf}
              >
                Anuluj
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={downloadAuthorityNotice}
                disabled={sendingAuthorityPackage || preparingAuthorityPdf}
              >
                <FileDown size={18} />
                {preparingAuthorityPdf ? "Przygotowuję…" : "Pobierz PDF"}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={sendAuthorityPackage}
                disabled={sendingAuthorityPackage || preparingAuthorityPdf}
              >
                <Send size={18} />
                {sendingAuthorityPackage ? "Wysyłam…" : "Wyślij do siebie"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {helpOpen && (
        <div
          className={styles.modalLayer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
        >
          <button
            className={styles.modalBackdrop}
            onClick={() => setHelpOpen(false)}
            aria-label="Zamknij okno"
          />
          <div className={styles.helpModal}>
            <header>
              <div>
                <span>FlotaFlow</span>
                <h2 id="help-title">Czym jest ta aplikacja</h2>
              </div>
              <button onClick={() => setHelpOpen(false)} aria-label="Zamknij">
                <X size={21} />
              </button>
            </header>
            <p>
              FlotaFlow automatyzuje obsługę mandatów i wezwań trafiających do
              właściciela floty, mimo że w danym momencie z auta korzystał
              klient. Aplikacja rozpoznaje dane z przesłanego skanu (OCR),
              dopasowuje pojazd i klienta, i prowadzi sprawę aż do wysłania
              wezwania.
            </p>
            <ul>
              <li>
                <strong>Sprawy</strong> — kolejka dokumentów: sprawdzasz odczyt
                OCR, poprawiasz dane i zatwierdzasz sprawę.
              </li>
              <li>
                <strong>Dokumenty</strong> — pełna lista wszystkich
                zeskanowanych dokumentów, niezależnie od statusu.
              </li>
              <li>
                <strong>Flota</strong> — kartoteka pojazdów i ich aktualnych
                użytkowników, import z CSV/XML.
              </li>
              <li>
                <strong>Planer tras</strong> — układanie kolejności dostaw i
                odbiorów aut przy użyciu Google Maps.
              </li>
              <li>
                <strong>Pracownicy</strong> — baza kierowców, kontakty i
                terminy ważności prawa jazdy.
              </li>
            </ul>
            <footer>
              <button
                className={styles.primaryButton}
                onClick={() => setHelpOpen(false)}
              >
                Rozumiem
              </button>
            </footer>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          className={styles.modalLayer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
        >
          <button
            className={styles.modalBackdrop}
            onClick={() => setSettingsOpen(false)}
            aria-label="Zamknij okno"
          />
          <div className={styles.helpModal}>
            <header>
              <div>
                <span>Konto</span>
                <h2 id="settings-title">Ustawienia</h2>
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                aria-label="Zamknij"
              >
                <X size={21} />
              </button>
            </header>
            <div className={styles.settingsField}>
              <small>Adres e-mail</small>
              <strong>{account?.email || "—"}</strong>
            </div>
            <div className={styles.settingsField}>
              <small>Rola</small>
              <strong>{account?.role || "—"}</strong>
            </div>
            <div className={styles.settingsPasswordForm}>
              <label>
                Imię
                <input
                  value={nameFirst}
                  onChange={(event) => {
                    setNameFirst(event.target.value);
                    setNameStatus("idle");
                  }}
                  placeholder="Imię"
                />
              </label>
              <label>
                Nazwisko
                <input
                  value={nameLast}
                  onChange={(event) => {
                    setNameLast(event.target.value);
                    setNameStatus("idle");
                  }}
                  placeholder="Nazwisko"
                />
              </label>
              {nameStatus === "error" && nameError && (
                <p className={styles.error}>{nameError}</p>
              )}
              {nameStatus === "saved" && (
                <p className={styles.settingsSaved}>Dane zostały zapisane.</p>
              )}
              <button
                type="button"
                className={styles.primaryButton}
                disabled={nameStatus === "saving"}
                onClick={saveName}
              >
                {nameStatus === "saving" ? "Zapisuję…" : "Zapisz imię i nazwisko"}
              </button>
            </div>
            <div className={styles.settingsPasswordForm}>
              <label>
                Nowe hasło
                <input
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    setPasswordStatus("idle");
                  }}
                  placeholder="Minimum 8 znaków"
                />
              </label>
              {passwordStatus === "error" && passwordError && (
                <p className={styles.error}>{passwordError}</p>
              )}
              {passwordStatus === "saved" && (
                <p className={styles.settingsSaved}>Hasło zostało zmienione.</p>
              )}
              <button
                type="button"
                className={styles.primaryButton}
                disabled={passwordStatus === "saving"}
                onClick={changePassword}
              >
                {passwordStatus === "saving" ? "Zapisuję…" : "Zmień hasło"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bugReportOpen && (
        <div
          className={bugStyles.bugModalLayer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bug-report-title"
        >
          <button
            className={bugStyles.bugModalBackdrop}
            onClick={() => {
              setBugReportOpen(false);
              setBugReportAttachmentFile(null);
            }}
            aria-label="Zamknij"
          />
          <div className={bugStyles.bugModal}>
            <header>
              <h2 id="bug-report-title">Zgłoś błąd</h2>
              <button
                onClick={() => {
                  setBugReportOpen(false);
                  setBugReportAttachmentFile(null);
                }}
                aria-label="Zamknij"
              >
                <X size={19} />
              </button>
            </header>
            {bugReportStatus === "sent" ? (
              <div className={bugStyles.bugSent} role="status">
                <CheckCircle2 size={20} />
                Zgłoszenie wysłane, dziękujemy.
              </div>
            ) : (
              <>
                <label>
                  Co się stało?
                  <textarea
                    value={bugReportDescription}
                    onChange={(event) =>
                      setBugReportDescription(event.target.value)
                    }
                    onPaste={(event) => {
                      const item = Array.from(event.clipboardData.items).find(
                        (entry) => entry.type.startsWith("image/"),
                      );
                      const file = item?.getAsFile();
                      if (file) pickBugReportAttachment(file);
                    }}
                    rows={5}
                    placeholder="Opisz problem — co robiłeś, co się stało, czego się spodziewałeś. Możesz wkleić zrzut ekranu (Ctrl+V)."
                  />
                </label>
                <div className={bugStyles.bugAttachRow}>
                  <label className={bugStyles.bugAttachButton}>
                    <ImagePlus size={15} />
                    {bugReportAttachment
                      ? "Zmień zrzut ekranu"
                      : "Dodaj zrzut ekranu lub plik"}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        pickBugReportAttachment(event.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                  {bugReportAttachmentPreview && (
                    <div className={bugStyles.bugAttachPreview}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={bugReportAttachmentPreview}
                        alt="Podgląd załącznika"
                      />
                      <button
                        type="button"
                        onClick={() => setBugReportAttachmentFile(null)}
                        aria-label="Usuń załącznik"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {bugReportStatus === "error" && bugReportError && (
                  <p className={bugStyles.bugError} role="alert">
                    {bugReportError}
                  </p>
                )}
                <button
                  type="button"
                  className={bugStyles.bugSubmit}
                  disabled={bugReportStatus === "sending"}
                  onClick={submitBugReportForm}
                >
                  {bugReportStatus === "sending" ? "Wysyłam…" : "Wyślij zgłoszenie"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {scanOpen && (
        <div
          className={styles.modalLayer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="scan-title"
        >
          <button
            className={styles.modalBackdrop}
            onClick={() => setScanOpen(false)}
            aria-label="Zamknij okno"
          />
          <div className={styles.scanModal}>
            <div className={styles.modalHandle} />
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Nowa sprawa</p>
                <h2 id="scan-title">Dodaj dokument</h2>
              </div>
              <button
                className={styles.iconButton}
                onClick={() => setScanOpen(false)}
                aria-label="Zamknij"
              >
                <X size={21} />
              </button>
            </div>
            <p className={`${styles.modalIntro} ${styles.desktopInstruction}`}>
              Dodaj gotowy skan z komputera. Możesz wskazać jeden PDF albo kilka
              plików graficznych.
            </p>
            <p className={`${styles.modalIntro} ${styles.mobileInstruction}`}>
              Uruchom skaner i fotografuj strony po kolei. Po każdym zdjęciu
              wrócisz tutaj, aby dodać następną stronę.
            </p>

            <div className={styles.sourceGrid}>
              <label className={styles.cameraAction}>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFiles}
                />
                <span className={styles.cameraIcon}>
                  <ScanLine size={28} />
                </span>
                <span>
                  <strong>Uruchom skaner</strong>
                  <small>Zeskanuj dokument tylnym aparatem</small>
                </span>
              </label>
              <label className={styles.fileAction}>
                <input
                  type="file"
                  accept=".pdf,application/pdf,.jpg,.jpeg,.png,.tif,.tiff,.heic,.heif,image/jpeg,image/png,image/tiff,image/heic,image/heif"
                  multiple
                  onChange={handleFiles}
                />
                <span className={styles.fileIcon}>
                  <ImagePlus size={24} />
                </span>
                <span>
                  <strong>Dodaj skan z urządzenia</strong>
                  <small>PDF, JPG, PNG, TIFF lub HEIC</small>
                </span>
              </label>
            </div>

            {uploadError && (
              <p className={styles.uploadError} role="alert">
                {uploadError}
              </p>
            )}

            {processing && (
              <div className={styles.processingRow}>
                <span className={styles.spinner} />
                <span>
                  <strong>Dodajemy stronę…</strong>
                  <small>Nie zamykaj tego okna</small>
                </span>
              </div>
            )}

            {uploadedPages.length > 0 && (
              <section
                className={styles.fileSection}
                aria-labelledby="added-pages-title"
              >
                <div className={styles.fileSectionHeader}>
                  <div>
                    <h3 id="added-pages-title">Dodane strony</h3>
                    <span>{uploadedPages.length}/10</span>
                  </div>
                  <small>Kliknij nazwę, aby ją zmienić</small>
                </div>
                <ol className={styles.fileList}>
                  {uploadedPages.map((page, index) => (
                    <li key={page.id}>
                      <span className={styles.pageNumber}>{index + 1}</span>
                      <span className={styles.fileType}>
                        {page.file.type === "application/pdf" ? (
                          <Files size={19} />
                        ) : (
                          <ImagePlus size={19} />
                        )}
                      </span>
                      <span className={styles.fileName}>
                        <input
                          className={styles.nameInput}
                          value={page.name}
                          aria-label={`Nazwa strony ${index + 1}`}
                          onChange={(event) => {
                            const value = event.target.value;
                            setUploadedPages((current) =>
                              current.map((item) =>
                                item.id === page.id
                                  ? { ...item, name: value }
                                  : item,
                              ),
                            );
                          }}
                        />
                        <small>
                          {(page.file.size / 1024 / 1024).toFixed(1)} MB ·
                          strona {index + 1}
                        </small>
                      </span>
                      <button
                        type="button"
                        onClick={() => removePage(page.id)}
                        aria-label={`Usuń stronę ${index + 1}`}
                      >
                        <Trash2 size={18} />
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            <div className={styles.scanTips}>
              <ShieldCheck size={18} />
              <span>
                <strong>Bezpieczne przesyłanie</strong>
                <small>
                  Zdjęcie nie zostanie zapisane w galerii przez aplikację.
                </small>
              </span>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                onClick={() => setScanOpen(false)}
              >
                Anuluj
              </button>
              <button
                className={styles.primaryButton}
                disabled={uploadedPages.length === 0 || processing || uploading}
                onClick={uploadDesktopDocument}
              >
                <Upload size={18} />
                {uploading ? "Przesyłanie…" : "Wyślij"}{" "}
                {uploadedPages.length > 0 ? `(${uploadedPages.length})` : ""} do
                analizy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark}>
        <FileText size={compact ? 18 : 20} />
      </span>
      <span>
        <strong>
          Flota<span>Flow</span>
        </strong>
        {!compact && <small>Obsługa dokumentów</small>}
      </span>
    </div>
  );
}

function NotificationsBell({
  reports,
  open,
  onToggle,
  onOpenBugs,
}: {
  reports: Array<{ id: string; description: string; created_at: string }>;
  open: boolean;
  onToggle: () => void;
  onOpenBugs: () => void;
}) {
  return (
    <div className={styles.iconButtonWrap}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Powiadomienia"
        onClick={onToggle}
      >
        <Bell size={20} />
        {reports.length > 0 && <span className={styles.notificationDot} />}
      </button>
      {open && (
        <div className={styles.notificationsPanel} role="menu">
          <header>
            <strong>Powiadomienia</strong>
          </header>
          {reports.length === 0 ? (
            <p className={styles.notificationsEmpty}>Brak nowych powiadomień.</p>
          ) : (
            <ul>
              {reports.slice(0, 8).map((report) => (
                <li key={report.id}>
                  <button type="button" onClick={onOpenBugs}>
                    <span>Nowe zgłoszenie błędu</span>
                    <small>{report.description.slice(0, 80)}</small>
                    <time>
                      {new Date(report.created_at).toLocaleString("pl-PL", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
  tone = "blue",
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone?: "blue" | "amber" | "green";
}) {
  return (
    <article className={styles.metricCard}>
      <div className={`${styles.metricIcon} ${styles[`metric_${tone}`]}`}>
        {icon}
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function Field({
  label,
  value,
  wide = false,
  confident = false,
  warning = false,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
  confident?: boolean;
  warning?: boolean;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`${styles.field} ${wide ? styles.fieldWide : ""}`}>
      <span>
        {label}
        {confident && (
          <CheckCircle2 size={14} aria-label="Wysoka pewność odczytu" />
        )}
      </span>
      {onChange ? (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={warning ? styles.inputWarning : ""}
        />
      ) : (
        <input
          defaultValue={value}
          disabled={disabled}
          className={warning ? styles.inputWarning : ""}
        />
      )}
    </label>
  );
}

function DocumentPreview({
  pages,
  fallbackSrc,
}: {
  pages?: string[];
  fallbackSrc?: string | null;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const resolvedPages = pages?.length ? pages : fallbackSrc ? [fallbackSrc] : [];
  const totalPages = resolvedPages.length;
  const currentPage = Math.min(pageIndex, Math.max(totalPages - 1, 0));
  const src = resolvedPages[currentPage] ?? null;
  return (
    <div className={styles.documentPane}>
      <div className={styles.documentToolbar}>
        <span>{totalPages ? `Strona ${currentPage + 1} z ${totalPages}` : "Brak podglądu"}</span>
        <div>
          <button
            aria-label="Poprzednia strona"
            disabled={currentPage <= 0}
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            aria-label="Następna strona"
            disabled={currentPage >= totalPages - 1}
            onClick={() => setPageIndex((current) => Math.min(totalPages - 1, current + 1))}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      <div className={styles.paperWrap}>
        {src ? (
          // The source is a short-lived signed Supabase URL, so it cannot be optimized at build time.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.scanImage}
            src={src}
            alt={`Strona ${currentPage + 1} zeskanowanego dokumentu`}
          />
        ) : (
          <article
            className={styles.paper}
            aria-label="Podgląd przykładowego dokumentu"
          >
            <div className={styles.paperLogo}>SM</div>
            <p className={styles.paperKicker}>STRAŻ MIEJSKA M.ST. WARSZAWY</p>
            <div className={styles.paperRule} />
            <p className={styles.paperDate}>Warszawa, 21 lipca 2026 r.</p>
            <h4>
              WEZWANIE DO WSKAZANIA
              <br />
              UŻYTKOWNIKA POJAZDU
            </h4>
            <p>
              W związku z ujawnieniem naruszenia przepisów ruchu drogowego
              prosimy o wskazanie osoby, której powierzono pojazd:
            </p>
            <div className={styles.paperHighlight}>
              <span>Numer rejestracyjny</span>
              <strong>WI 2847K</strong>
            </div>
            <div className={styles.paperHighlight}>
              <span>Data i godzina zdarzenia</span>
              <strong>18.07.2026, 14:32</strong>
            </div>
            <p className={styles.paperText}>
              Odpowiedź należy przekazać w terminie 7 dni od dnia otrzymania
              niniejszego pisma.
            </p>
            <div className={styles.paperSignature}>
              Z upoważnienia
              <br />
              <strong>Starszy Inspektor</strong>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
