import { useState, useEffect, useRef, useCallback } from "react";

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

@media (max-width: 768px) {
  * { -webkit-tap-highlight-color: transparent; }
  input, select, textarea, button { font-size: 16px !important; }

  .cv-stats {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 8px !important;
  }
  .cv-stats > * {
    min-width: 0 !important;
  }

  .cv-tabs {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch !important;
    scrollbar-width: none !important;
    flex-wrap: nowrap !important;
    padding-bottom: 4px !important;
    margin-left: -16px !important;
    margin-right: -16px !important;
    padding-left: 16px !important;
    padding-right: 16px !important;
  }
  .cv-tabs::-webkit-scrollbar { display: none; }
  .cv-tabs > * { white-space: nowrap; flex-shrink: 0; }

  .cv-grid2 {
    grid-template-columns: 1fr !important;
  }

  .cv-grid3 {
    grid-template-columns: 1fr !important;
  }

  .cv-header {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 12px !important;
  }

  .cv-filters {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch !important;
    flex-wrap: nowrap !important;
    scrollbar-width: none !important;
    padding-bottom: 4px !important;
  }
  .cv-filters::-webkit-scrollbar { display: none; }
  .cv-filters > * { flex-shrink: 0; }

  .cv-cascade {
    flex-direction: column !important;
  }

  .cv-card-row {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 8px !important;
  }
  .cv-card-row > div:last-child {
    text-align: left !important;
  }
}
`;

// ─── Persistent Data Layer (localStorage) ───
const STORAGE_PREFIX = "cv_";

function loadData(key, fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveData(key, data) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data)); } catch (e) { console.warn("Storage full or unavailable:", e); }
}

let CASES_DB = loadData("cases", []);
let CASE_COUNTER = loadData("caseCounter", 1000);
let INVOICES_DB = loadData("invoices", []);
let INVOICE_COUNTER = loadData("invoiceCounter", 5000);

function persistAll() {
  saveData("cases", CASES_DB);
  saveData("caseCounter", CASE_COUNTER);
  saveData("invoices", INVOICES_DB);
  saveData("invoiceCounter", INVOICE_COUNTER);
  saveData("clients", CLIENTS_DB);
  saveData("clientCounter", CLIENT_COUNTER);
  saveData("agents", AGENTS_DB);
  saveData("agentCounter", AGENT_COUNTER);
  saveData("auditLog", AUDIT_LOG);
  saveData("auditCounter", AUDIT_COUNTER);
  saveData("agencySettings", AGENCY_SETTINGS);
}

// ─── Agency Rate Settings ───
let AGENCY_SETTINGS = loadData("agencySettings", {
  agencyName: "CaseVault Investigations",
  agencyLicense: "",
  agencyPhone: "",
  agencyEmail: "",
  agencyAddress: "",
  rates: {
    hourly: 85,
    mileage: 0.655,
    retainer: 0,
    perDiem: 250,
    rushSurcharge: 1.5,
    overnightSurveillance: 125,
    courtTestimony: 175,
    databaseSearch: 35,
    photographyVideo: 75,
    adminClerical: 45,
  },
  defaultTerms: "Net 30",
  mileageMethod: "gps",
});

function getAgencyRate(key) {
  return AGENCY_SETTINGS.rates[key] ?? 0;
}

// Rate cascade: case → client → agency
function resolveRate(caseData, rateKey) {
  // 1. Check case-level override
  if (caseData.rateOverrides && caseData.rateOverrides[rateKey] !== undefined && caseData.rateOverrides[rateKey] !== null && caseData.rateOverrides[rateKey] !== "") {
    return { value: parseFloat(caseData.rateOverrides[rateKey]), source: "case" };
  }
  // 2. Check client-level rate
  const client = CLIENTS_DB.find((cl) => cl.id === caseData.clientId);
  if (client) {
    const clientRateMap = { hourly: client.defaultHourlyRate, mileage: client.defaultMileageRate };
    if (clientRateMap[rateKey] !== undefined && clientRateMap[rateKey] !== null) {
      return { value: parseFloat(clientRateMap[rateKey]), source: "client" };
    }
  }
  // 3. Fall back to agency default
  return { value: getAgencyRate(rateKey), source: "agency" };
}

const RATE_SOURCE_LABELS = {
  case: { color: "#f90", label: "Case Override" },
  client: { color: "#4af", label: "Client Rate" },
  agency: { color: "#666", label: "Agency Default" },
};
let CLIENTS_DB = loadData("clients", []);
let CLIENT_COUNTER = loadData("clientCounter", 100);
let AUDIT_LOG = loadData("auditLog", []);
let AUDIT_COUNTER = loadData("auditCounter", 0);
let AGENTS_DB = loadData("agents", []);
let AGENT_COUNTER = loadData("agentCounter", 0);

// ─── Agency & Role System ───
const AGENT_ROLES = {
  owner: { label: "Owner / Solo PI", color: "#f0d000", permissions: ["all"] },
  admin: { label: "Admin", color: "#f90", permissions: ["manage_agents", "manage_cases", "assign_cases", "view_all", "manage_clients", "manage_invoices", "view_audit"] },
  investigator: { label: "Investigator", color: "#0f0", permissions: ["work_cases", "view_assigned", "create_updates", "record_evidence", "log_mileage", "log_expenses"] },
  viewer: { label: "Viewer / Read Only", color: "#4af", permissions: ["view_assigned"] },
};

// Current user context (mutable singleton)
let CURRENT_USER = null;

function getCurrentUser() {
  return CURRENT_USER;
}

function setCurrentUser(agent) {
  CURRENT_USER = agent;
  window.__cvCurrentUser = agent;
  saveData("currentUserId", agent?.id || null);
}

function hasPermission(perm) {
  if (!CURRENT_USER) return true; // Solo mode fallback
  if (CURRENT_USER.role === "owner") return true;
  return AGENT_ROLES[CURRENT_USER.role]?.permissions.includes(perm) || AGENT_ROLES[CURRENT_USER.role]?.permissions.includes("all");
}

function canViewCase(caseData) {
  if (!CURRENT_USER) return true;
  if (CURRENT_USER.role === "owner" || CURRENT_USER.role === "admin") return true;
  // Investigators and viewers see assigned cases only
  const assigned = caseData.assignedAgents || [];
  return assigned.includes(CURRENT_USER.id) || caseData.leadAgent === CURRENT_USER.id;
}

function getActorName() {
  return CURRENT_USER ? CURRENT_USER.name : "Primary Investigator";
}

function isSoloMode() {
  return AGENTS_DB.length <= 1;
}

// Initialize default owner agent
function initDefaultAgent() {
  if (AGENTS_DB.length === 0) {
    const owner = {
      id: `AGT-${String(++AGENT_COUNTER).padStart(3, "0")}`,
      name: "Agency Owner",
      email: "",
      phone: "",
      role: "owner",
      status: "active",
      licenseNumber: "",
      specialties: [],
      createdAt: new Date().toISOString(),
      avatar: null,
    };
    AGENTS_DB.push(owner);
    setCurrentUser(owner);
    persistAll();
  } else {
    // Restore current user from saved agents
    const savedUserId = loadData("currentUserId", null);
    const restored = savedUserId ? AGENTS_DB.find((a) => a.id === savedUserId) : AGENTS_DB[0];
    setCurrentUser(restored || AGENTS_DB[0]);
  }
}
initDefaultAgent();

// ─── Security & Chain of Custody Engine ───
// SHA-256 hash for tamper detection (Web Crypto API)
async function computeHash(data) {
  const str = typeof data === "string" ? data : JSON.stringify(data);
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(str));
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Synchronous hash fallback for display (simple but consistent)
function quickHash(data) {
  const str = typeof data === "string" ? data : JSON.stringify(data);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h = ((h << 5) - h) + c;
    h |= 0;
  }
  const hex = Math.abs(h).toString(16).padStart(8, "0");
  // Create a longer hash-like string for display
  let extended = "";
  for (let i = 0; i < 8; i++) {
    let sub = 0;
    for (let j = 0; j < str.length; j++) {
      sub = ((sub << 3) - sub + str.charCodeAt(j) * (i + 1)) | 0;
    }
    extended += Math.abs(sub).toString(16).padStart(8, "0");
  }
  return extended.substring(0, 64);
}

// Audit event types
const AUDIT_TYPES = {
  CASE_CREATED: { label: "Case Created", severity: "info", icon: "add" },
  CASE_STATUS: { label: "Status Changed", severity: "warning", icon: "alert" },
  UPDATE_ADDED: { label: "Update Added", severity: "info", icon: "note" },
  DOC_UPLOADED: { label: "Document Uploaded", severity: "info", icon: "doc" },
  DOC_ACCESSED: { label: "Document Accessed", severity: "info", icon: "search" },
  EVIDENCE_RECORDED: { label: "Evidence Recorded", severity: "critical", icon: "cam" },
  EVIDENCE_ACCESSED: { label: "Evidence Accessed", severity: "info", icon: "play" },
  EXPENSE_ADDED: { label: "Expense Added", severity: "info", icon: "expense" },
  EXPENSE_DELETED: { label: "Expense Deleted", severity: "warning", icon: "trash" },
  INVOICE_CREATED: { label: "Invoice Created", severity: "info", icon: "invoice" },
  INVOICE_STATUS: { label: "Invoice Status Changed", severity: "info", icon: "invoice" },
  MILEAGE_LOGGED: { label: "Mileage Logged", severity: "info", icon: "car" },
  CUSTODY_TRANSFER: { label: "Custody Transfer", severity: "critical", icon: "link" },
  LOGIN: { label: "Session Started", severity: "info", icon: "check" },
  EXPORT: { label: "Data Exported", severity: "warning", icon: "print" },
  INTEGRITY_CHECK: { label: "Integrity Verified", severity: "info", icon: "check" },
  INTEGRITY_FAIL: { label: "Integrity Failure", severity: "critical", icon: "alert" },
};

const SEVERITY_COLORS = {
  info: { bg: "rgba(74,170,255,0.08)", border: "rgba(74,170,255,0.15)", text: "#4af", dot: "#4af" },
  warning: { bg: "rgba(255,153,0,0.08)", border: "rgba(255,153,0,0.15)", text: "#f90", dot: "#f90" },
  critical: { bg: "rgba(255,68,68,0.08)", border: "rgba(255,68,68,0.15)", text: "#f44", dot: "#f44" },
};

function logAuditEvent(type, caseId, details = {}, actor = null) {
  const actorName = actor || getActorName();
  const prevHash = AUDIT_LOG.length > 0 ? AUDIT_LOG[AUDIT_LOG.length - 1].hash : "0000000000000000";
  const entry = {
    id: `AUD-${String(++AUDIT_COUNTER).padStart(6, "0")}`,
    type,
    caseId: caseId || null,
    actor: actorName,
    actorId: CURRENT_USER?.id || null,
    timestamp: new Date().toISOString(),
    details,
    prevHash,
    deviceInfo: navigator.userAgent?.substring(0, 80) || "Unknown",
    sessionId: window.__cvSessionId || "—",
  };
  // Chain hash: each entry's hash includes the previous hash for tamper detection
  entry.hash = quickHash(JSON.stringify({ ...entry, prevHash }));
  AUDIT_LOG.push(entry);
  persistAll();
  return entry;
}

// Initialize session
if (!window.__cvSessionId) {
  window.__cvSessionId = "SES-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();
  logAuditEvent("LOGIN", null, { message: "CaseVault session initialized" });
}

const CLIENT_TYPES = [
  "Individual",
  "Attorney",
  "Law Firm",
  "Insurance Company",
  "Corporation",
  "Government Agency",
  "Other",
];

const CLIENT_STATUS_COLORS = {
  active: { bg: "#0f0", text: "#000", label: "ACTIVE" },
  inactive: { bg: "#666", text: "#fff", label: "INACTIVE" },
  vip: { bg: "#f0d000", text: "#000", label: "VIP" },
};

const INVOICE_STATUS_COLORS = {
  draft: { bg: "#555", text: "#fff", label: "DRAFT" },
  sent: { bg: "#4af", text: "#000", label: "SENT" },
  viewed: { bg: "#f90", text: "#000", label: "VIEWED" },
  paid: { bg: "#0f0", text: "#000", label: "PAID" },
  overdue: { bg: "#f44", text: "#fff", label: "OVERDUE" },
};

const STATUS_COLORS = {
  active: { bg: "#0f0", text: "#000", label: "ACTIVE" },
  paused: { bg: "#f90", text: "#000", label: "PAUSED" },
  completed: { bg: "#4af", text: "#000", label: "COMPLETED" },
  archived: { bg: "#666", text: "#fff", label: "ARCHIVED" },
};

const CASE_TYPES = [
  "Surveillance",
  "Background Check",
  "Missing Person",
  "Insurance Fraud",
  "Domestic",
  "Corporate",
  "Asset Search",
  "Skip Trace",
  "Workers Comp",
  "Other",
];

// ─── AI Analysis Engine ───
function analyzeDocuments(caseData) {
  const type = caseData.type || "Surveillance";
  const docs = caseData.documents || [];
  const updates = caseData.updates || [];
  const totalMiles = caseData.mileageEntries?.reduce((s, e) => s + e.miles, 0) || 0;

  const suggestions = {
    Surveillance: [
      { action: "Conduct social media deep-dive on subject's known aliases", probability: 92, priority: "high", category: "Digital" },
      { action: "Cross-reference subject's vehicle registration with DMV records", probability: 87, priority: "high", category: "Records" },
      { action: "Establish counter-surveillance detection route before next session", probability: 78, priority: "medium", category: "Field" },
      { action: "Canvas neighborhood for secondary witnesses", probability: 65, priority: "medium", category: "Field" },
      { action: "Request toll road/bridge records for subject's vehicle", probability: 71, priority: "medium", category: "Records" },
      { action: "Deploy GPS-compatible dashcam for mobile surveillance", probability: 84, priority: "high", category: "Equipment" },
    ],
    "Background Check": [
      { action: "Run comprehensive court records search across all jurisdictions", probability: 94, priority: "high", category: "Records" },
      { action: "Verify employment history with HR departments directly", probability: 88, priority: "high", category: "Verification" },
      { action: "Check sex offender registry and criminal databases", probability: 91, priority: "high", category: "Records" },
      { action: "Search property records and asset databases", probability: 79, priority: "medium", category: "Records" },
      { action: "Conduct social media behavioral analysis", probability: 73, priority: "medium", category: "Digital" },
    ],
    "Missing Person": [
      { action: "File FOIA request with local law enforcement for case files", probability: 82, priority: "high", category: "Records" },
      { action: "Analyze last known cell phone tower pings", probability: 88, priority: "high", category: "Digital" },
      { action: "Interview associates at last known location", probability: 76, priority: "high", category: "Field" },
      { action: "Search hospital and morgue records in surrounding counties", probability: 69, priority: "medium", category: "Records" },
      { action: "Monitor social media accounts for activity patterns", probability: 85, priority: "high", category: "Digital" },
      { action: "Check homeless shelter and community service intake records", probability: 62, priority: "medium", category: "Field" },
    ],
    "Insurance Fraud": [
      { action: "Conduct covert video surveillance during peak activity hours", probability: 91, priority: "high", category: "Field" },
      { action: "Cross-reference medical records with observed physical capability", probability: 86, priority: "high", category: "Records" },
      { action: "Monitor subject's social media for contradicting lifestyle posts", probability: 89, priority: "high", category: "Digital" },
      { action: "Interview neighbors about subject's daily activity level", probability: 74, priority: "medium", category: "Field" },
      { action: "Review prior insurance claim history across carriers", probability: 83, priority: "high", category: "Records" },
    ],
  };

  const baseSuggestions = suggestions[type] || suggestions["Surveillance"];

  // Adjust probabilities based on case data
  return baseSuggestions.map((s) => {
    let adj = s.probability;
    if (docs.length > 3) adj = Math.min(99, adj + 3);
    if (updates.length > 5) adj = Math.min(99, adj + 2);
    if (totalMiles > 100) adj = Math.min(99, adj + 1);
    return { ...s, probability: adj };
  }).sort((a, b) => b.probability - a.probability);
}

function generateCaseSummary(caseData) {
  const updates = caseData.updates || [];
  const docs = caseData.documents || [];
  const miles = caseData.mileageEntries?.reduce((s, e) => s + e.miles, 0) || 0;
  const hours = caseData.mileageEntries?.reduce((s, e) => s + (e.duration || 0), 0) || 0;

  return {
    totalUpdates: updates.length,
    totalDocuments: docs.length,
    totalMileage: miles.toFixed(1),
    totalHours: (hours / 60).toFixed(1),
    riskLevel: miles > 200 ? "High Exposure" : miles > 50 ? "Moderate" : "Low",
    nextReviewDate: new Date(Date.now() + 7 * 86400000).toLocaleDateString(),
    completionEstimate: Math.min(100, Math.round((updates.length / 15) * 100 + (docs.length / 10) * 100) / 2),
  };
}

// ─── Styles ───
const styles = {
  app: {
    fontFamily: "'Outfit', sans-serif",
    background: "#0a0b0f",
    color: "#e0e0e0",
    minHeight: "100vh",
    position: "relative",
    overflow: "hidden",
  },
  scanline: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,0,0.015) 2px, rgba(0,255,0,0.015) 4px)",
    pointerEvents: "none",
    zIndex: 9999,
  },
  sidebar: (mobile, open) => ({
    position: "fixed",
    left: mobile && !open ? -280 : 0,
    top: 0, bottom: 0,
    width: mobile ? 280 : 260,
    background: "linear-gradient(180deg, #0d0e14 0%, #0a0b0f 100%)",
    borderRight: "1px solid rgba(0,255,0,0.1)",
    display: "flex",
    flexDirection: "column",
    zIndex: mobile ? 200 : 100,
    transition: "left 0.25s ease",
    boxShadow: mobile && open ? "4px 0 30px rgba(0,0,0,0.8)" : "none",
  }),
  overlay: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.6)",
    zIndex: 150,
    backdropFilter: "blur(2px)",
  },
  mobileHeader: {
    position: "fixed",
    top: 0, left: 0, right: 0,
    height: 56,
    background: "linear-gradient(180deg, #0d0e14 0%, #0a0b0f 100%)",
    borderBottom: "1px solid rgba(0,255,0,0.1)",
    display: "flex",
    alignItems: "center",
    padding: "0 16px",
    zIndex: 100,
    gap: 12,
  },
  hamburger: {
    background: "none",
    border: "none",
    color: "#0f0",
    fontSize: 22,
    cursor: "pointer",
    padding: "8px 4px",
    lineHeight: 1,
  },
  bottomNav: {
    position: "fixed",
    bottom: 0, left: 0, right: 0,
    height: 64,
    background: "linear-gradient(0deg, #0d0e14 0%, rgba(13,14,20,0.98) 100%)",
    borderTop: "1px solid rgba(0,255,0,0.1)",
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    zIndex: 100,
    paddingBottom: "env(safe-area-inset-bottom, 0px)",
  },
  bottomNavItem: (active) => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "6px 12px",
    cursor: "pointer",
    color: active ? "#0f0" : "#666",
    fontSize: 10,
    fontWeight: active ? 600 : 400,
    transition: "all 0.15s",
    background: "none",
    border: "none",
    fontFamily: "'Outfit', sans-serif",
  }),
  logo: {
    padding: "24px 20px",
    borderBottom: "1px solid rgba(0,255,0,0.08)",
  },
  logoText: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    fontWeight: 600,
    color: "#0f0",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  logoSub: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 9,
    color: "rgba(0,255,0,0.4)",
    letterSpacing: 2,
    marginTop: 4,
  },
  navItem: (active) => ({
    padding: "12px 20px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? "#0f0" : "#888",
    background: active ? "rgba(0,255,0,0.06)" : "transparent",
    borderLeft: active ? "2px solid #0f0" : "2px solid transparent",
    transition: "all 0.2s",
    display: "flex",
    alignItems: "center",
    gap: 10,
  }),
  main: (mobile) => ({
    marginLeft: mobile ? 0 : 260,
    padding: mobile ? "72px 16px 80px" : "24px 32px",
    minHeight: "100vh",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
  }),
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
    flexWrap: "wrap",
    gap: 12,
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: -0.5,
  },
  btn: (variant = "primary") => ({
    padding: "10px 20px",
    border: variant === "primary" ? "1px solid #0f0" : "1px solid #333",
    background: variant === "primary" ? "rgba(0,255,0,0.1)" : "rgba(255,255,255,0.03)",
    color: variant === "primary" ? "#0f0" : "#aaa",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "'Outfit', sans-serif",
    transition: "all 0.2s",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  }),
  card: {
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: 20,
    marginBottom: 16,
    transition: "all 0.2s",
    cursor: "pointer",
  },
  input: {
    width: "100%",
    padding: "10px 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    color: "#e0e0e0",
    fontSize: 14,
    fontFamily: "'Outfit', sans-serif",
    outline: "none",
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    padding: "10px 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    color: "#e0e0e0",
    fontSize: 14,
    fontFamily: "'Outfit', sans-serif",
    outline: "none",
    resize: "vertical",
    minHeight: 80,
    boxSizing: "border-box",
  },
  select: {
    width: "100%",
    padding: "10px 14px",
    background: "#12131a",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    color: "#e0e0e0",
    fontSize: 14,
    fontFamily: "'Outfit', sans-serif",
    outline: "none",
    boxSizing: "border-box",
  },
  badge: (color) => ({
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1.5,
    background: color.bg,
    color: color.text,
  }),
  stat: {
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: "18px 20px",
    flex: 1,
    minWidth: 100,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 800,
    color: "#0f0",
    fontFamily: "'JetBrains Mono', monospace",
  },
  statLabel: {
    fontSize: 11,
    color: "#666",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 4,
  },
  modal: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.85)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    backdropFilter: "blur(8px)",
    padding: "env(safe-area-inset-top, 0) 0 env(safe-area-inset-bottom, 0) 0",
  },
  modalContent: {
    background: "#12131a",
    border: "1px solid rgba(0,255,0,0.15)",
    borderRadius: 14,
    padding: 32,
    width: "90%",
    maxWidth: 600,
    maxHeight: "85vh",
    overflow: "auto",
    WebkitOverflowScrolling: "touch",
  },
  tab: (active) => ({
    padding: "8px 18px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? "#0f0" : "#666",
    borderBottom: active ? "2px solid #0f0" : "2px solid transparent",
    transition: "all 0.2s",
    background: "transparent",
    border: "none",
    borderBottom: active ? "2px solid #0f0" : "2px solid transparent",
    fontFamily: "'Outfit', sans-serif",
  }),
  probBar: (prob) => ({
    height: 6,
    borderRadius: 3,
    background: `linear-gradient(90deg, ${prob > 80 ? "#0f0" : prob > 60 ? "#f90" : "#f44"} ${prob}%, rgba(255,255,255,0.05) ${prob}%)`,
    width: "100%",
  }),
};

// ─── Components ───

function Icon({ name, size = 16 }) {
  const icons = {
    cases: "📁",
    dashboard: "📊",
    map: "🗺️",
    ai: "🤖",
    media: "🎥",
    settings: "⚙️",
    add: "＋",
    play: "▶",
    pause: "⏸",
    stop: "⏹",
    check: "✓",
    doc: "📄",
    mic: "🎙️",
    cam: "📹",
    gps: "📍",
    mile: "🛣️",
    clock: "⏱️",
    alert: "⚠️",
    search: "🔍",
    upload: "⬆",
    star: "⭐",
    car: "🚗",
    invoice: "🧾",
    send: "📨",
    dollar: "💲",
    print: "🖨️",
    edit: "✏️",
    trash: "🗑️",
    copy: "📋",
    client: "👤",
    clients: "👥",
    firm: "🏛️",
    phone: "📞",
    email: "✉️",
    note: "📝",
    link: "🔗",
    expense: "💳",
    receipt: "🧾",
    hotel: "🏨",
    meal: "🍽️",
    gas: "⛽",
    parking: "🅿️",
    flight: "✈️",
    supplies: "🛒",
    shield: "🛡️",
    lock: "🔒",
    chain: "⛓️",
    audit: "📜",
    fingerprint: "🔏",
    verified: "✅",
    broken: "❌",
    hash: "🔐",
    history: "🕐",
    team: "👥",
    assign: "📌",
    badge: "🪪",
    crown: "👑",
    user: "👤",
    switch_user: "🔄",
    rates: "💰",
    cascade: "📊",
  };
  return <span style={{ fontSize: size }}>{icons[name] || "•"}</span>;
}

function StatCard({ value, label, icon }) {
  return (
    <div style={styles.stat}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={styles.statValue}>{value}</div>
          <div style={styles.statLabel}>{label}</div>
        </div>
        <Icon name={icon} size={22} />
      </div>
    </div>
  );
}

function GPSTracker({ caseData, onMileageUpdate }) {
  const [tracking, setTracking] = useState(false);
  const [currentPos, setCurrentPos] = useState(null);
  const [distance, setDistance] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [positions, setPositions] = useState([]);
  const watchRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  const calcDistance = (lat1, lon1, lat2, lon2) => {
    const R = 3959;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const startTracking = () => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported");
      return;
    }
    setTracking(true);
    setDistance(0);
    setElapsed(0);
    setPositions([]);
    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, time: Date.now() };
        setCurrentPos(newPos);
        setPositions((prev) => {
          if (prev.length > 0) {
            const last = prev[prev.length - 1];
            const d = calcDistance(last.lat, last.lng, newPos.lat, newPos.lng);
            if (d > 0.01) {
              setDistance((prev) => prev + d);
              return [...prev, newPos];
            }
            return prev;
          }
          return [newPos];
        });
      },
      (err) => console.error(err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  };

  const stopTracking = () => {
    setTracking(false);
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    if (distance > 0 || elapsed > 0) {
      onMileageUpdate({
        miles: parseFloat(distance.toFixed(2)),
        duration: elapsed,
        positions: positions,
        timestamp: new Date().toISOString(),
      });
    }
  };

  useEffect(() => {
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div style={{ background: "rgba(0,255,0,0.03)", border: "1px solid rgba(0,255,0,0.1)", borderRadius: 10, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="gps" size={18} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>GPS & Mileage Tracker</span>
          {tracking && (
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#0f0", animation: "pulse 1.5s infinite", marginLeft: 6 }} />
          )}
        </div>
        {!tracking ? (
          <button style={styles.btn("primary")} onClick={startTracking}>
            <Icon name="play" size={12} /> Start Tracking
          </button>
        ) : (
          <button style={{ ...styles.btn("primary"), borderColor: "#f44", color: "#f44", background: "rgba(255,68,68,0.1)" }} onClick={stopTracking}>
            <Icon name="stop" size={12} /> Stop & Save
          </button>
        )}
      </div>

      <div className="cv-grid3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 14, textAlign: "center" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: "#0f0" }}>
            {distance.toFixed(2)}
          </div>
          <div style={{ fontSize: 10, color: "#666", letterSpacing: 1, marginTop: 2 }}>MILES</div>
        </div>
        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 14, textAlign: "center" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: "#4af" }}>
            {formatTime(elapsed)}
          </div>
          <div style={{ fontSize: 10, color: "#666", letterSpacing: 1, marginTop: 2 }}>ELAPSED</div>
        </div>
        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 14, textAlign: "center" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: "#f90" }}>
            {currentPos ? `${currentPos.lat.toFixed(4)}` : "—"}
          </div>
          <div style={{ fontSize: 10, color: "#666", letterSpacing: 1, marginTop: 2 }}>LATITUDE</div>
        </div>
      </div>

      {positions.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono', monospace" }}>
          {positions.length} position points logged
        </div>
      )}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
}

function MediaRecorder({ onSave }) {
  const [mode, setMode] = useState(null); // 'audio' | 'video'
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordings, setRecordings] = useState([]);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const videoPreviewRef = useRef(null);

  const startRecording = async (type) => {
    try {
      const constraints = type === "audio" ? { audio: true } : { audio: true, video: { facingMode: "environment" } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (type === "video" && videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.play();
      }

      const recorder = new window.MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: type === "audio" ? "audio/webm" : "video/webm" });
        const url = URL.createObjectURL(blob);
        const entry = {
          id: Date.now(),
          type,
          url,
          duration: elapsed,
          timestamp: new Date().toISOString(),
          size: (blob.size / 1024 / 1024).toFixed(2) + " MB",
        };
        setRecordings((prev) => [...prev, entry]);
        if (onSave) onSave(entry);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRef.current = recorder;
      recorder.start();
      setMode(type);
      setRecording(true);
      setElapsed(0);
      const start = Date.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    } catch (err) {
      alert("Permission denied or device not available: " + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    setMode(null);
  };

  const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div>
      {!recording ? (
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <button style={styles.btn("primary")} onClick={() => startRecording("audio")}>
            <Icon name="mic" size={14} /> Record Audio
          </button>
          <button style={styles.btn("primary")} onClick={() => startRecording("video")}>
            <Icon name="cam" size={14} /> Record Video
          </button>
        </div>
      ) : (
        <div style={{ background: "rgba(255,0,0,0.05)", border: "1px solid rgba(255,0,0,0.2)", borderRadius: 10, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#f44", animation: "pulse 1s infinite" }} />
              <span style={{ fontWeight: 600, color: "#f44", textTransform: "uppercase", fontSize: 12, letterSpacing: 1 }}>
                Recording {mode}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#fff" }}>{formatTime(elapsed)}</span>
            </div>
            <button style={{ ...styles.btn(), borderColor: "#f44", color: "#f44" }} onClick={stopRecording}>
              <Icon name="stop" size={12} /> Stop
            </button>
          </div>
          {mode === "video" && (
            <video ref={videoPreviewRef} style={{ width: "100%", borderRadius: 8, marginTop: 12, background: "#000" }} muted />
          )}
        </div>
      )}

      {recordings.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 8, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>
            Recorded Evidence
          </div>
          {recordings.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: 6, marginBottom: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Icon name={r.type === "audio" ? "mic" : "cam"} size={14} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{r.type === "audio" ? "Audio" : "Video"} Evidence</div>
                  <div style={{ fontSize: 11, color: "#666", fontFamily: "'JetBrains Mono', monospace" }}>
                    {formatTime(r.duration)} • {r.size} • {new Date(r.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
              {r.type === "audio" ? (
                <audio controls src={r.url} style={{ height: 32 }} />
              ) : (
                <a href={r.url} target="_blank" style={{ color: "#4af", fontSize: 12, textDecoration: "none" }}>Preview ↗</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Expense Categories ───
const EXPENSE_CATEGORIES = [
  { id: "hotel", label: "Hotel / Lodging", icon: "hotel" },
  { id: "meal", label: "Meals", icon: "meal" },
  { id: "fuel", label: "Fuel / Gas", icon: "gas" },
  { id: "parking", label: "Parking / Tolls", icon: "parking" },
  { id: "flight", label: "Airfare / Travel", icon: "flight" },
  { id: "supplies", label: "Supplies / Equipment", icon: "supplies" },
  { id: "database", label: "Database / Records Fee", icon: "search" },
  { id: "court", label: "Court Filing Fee", icon: "doc" },
  { id: "communication", label: "Phone / Communication", icon: "phone" },
  { id: "rental", label: "Vehicle Rental", icon: "car" },
  { id: "other", label: "Other", icon: "expense" },
];

function ExpensesPanel({ caseData, onUpdate }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    category: "hotel",
    description: "",
    amount: "",
    date: new Date().toISOString().split("T")[0],
    vendor: "",
    receiptRef: "",
    reimbursable: true,
    notes: "",
  });
  const [filterCat, setFilterCat] = useState("all");
  const [sortBy, setSortBy] = useState("date"); // "date" | "amount" | "category"

  const expenses = caseData.expenses || [];
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const reimbursableTotal = expenses.filter((e) => e.reimbursable).reduce((s, e) => s + e.amount, 0);
  const nonReimbursableTotal = totalExpenses - reimbursableTotal;

  const addExpense = () => {
    if (!form.amount || parseFloat(form.amount) <= 0) return alert("Enter a valid amount");
    if (!form.description) return alert("Enter a description");
    const expense = {
      id: Date.now(),
      category: form.category,
      description: form.description,
      amount: parseFloat(form.amount),
      date: form.date,
      vendor: form.vendor,
      receiptRef: form.receiptRef,
      reimbursable: form.reimbursable,
      notes: form.notes,
      createdAt: new Date().toISOString(),
    };
    caseData.expenses = caseData.expenses || [];
    caseData.expenses.push(expense);
    const catLabel = EXPENSE_CATEGORIES.find((c) => c.id === form.category)?.label || form.category;
    caseData.updates.push({
      text: `Expense logged: ${catLabel} — $${expense.amount.toFixed(2)} (${form.vendor || form.description})`,
      timestamp: new Date().toISOString(),
      id: Date.now() + 1,
      system: true,
    });
    logAuditEvent("EXPENSE_ADDED", caseData.id, { category: form.category, amount: expense.amount, vendor: form.vendor, reimbursable: form.reimbursable });
    onUpdate({ ...caseData });
    setForm({ category: "hotel", description: "", amount: "", date: new Date().toISOString().split("T")[0], vendor: "", receiptRef: "", reimbursable: true, notes: "" });
    setShowAdd(false);
  };

  const deleteExpense = (id) => {
    const removed = caseData.expenses.find((e) => e.id === id);
    caseData.expenses = caseData.expenses.filter((e) => e.id !== id);
    caseData.updates.push({ text: "Expense entry removed", timestamp: new Date().toISOString(), id: Date.now(), system: true });
    logAuditEvent("EXPENSE_DELETED", caseData.id, { expenseId: id, amount: removed?.amount, description: removed?.description });
    onUpdate({ ...caseData });
  };

  const filtered = expenses.filter((e) => filterCat === "all" || e.category === filterCat);
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "date") return new Date(b.date) - new Date(a.date);
    if (sortBy === "amount") return b.amount - a.amount;
    return a.category.localeCompare(b.category);
  });

  // Category breakdown
  const categoryTotals = {};
  expenses.forEach((e) => {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Case Expenses</div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>Track hotel, meals, fuel, fees, and other case costs</div>
        </div>
        <button style={styles.btn("primary")} onClick={() => setShowAdd(true)}>
          <Icon name="add" size={12} /> Add Expense
        </button>
      </div>

      {/* Summary Cards */}
      <div className="cv-grid3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div style={{ background: "rgba(0,255,0,0.04)", borderRadius: 8, padding: 14, textAlign: "center", border: "1px solid rgba(0,255,0,0.1)" }}>
          <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 22, fontWeight: 700, color: "#0f0" }}>${totalExpenses.toFixed(2)}</div>
          <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>TOTAL EXPENSES</div>
        </div>
        <div style={{ background: "rgba(74,170,255,0.04)", borderRadius: 8, padding: 14, textAlign: "center", border: "1px solid rgba(74,170,255,0.1)" }}>
          <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 22, fontWeight: 700, color: "#4af" }}>${reimbursableTotal.toFixed(2)}</div>
          <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>BILLABLE</div>
        </div>
        <div style={{ background: "rgba(255,153,0,0.04)", borderRadius: 8, padding: 14, textAlign: "center", border: "1px solid rgba(255,153,0,0.1)" }}>
          <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 22, fontWeight: 700, color: "#f90" }}>${nonReimbursableTotal.toFixed(2)}</div>
          <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>NON-BILLABLE</div>
        </div>
      </div>

      {/* Category Breakdown */}
      {Object.keys(categoryTotals).length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#666", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>Breakdown by Category</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
            {Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
              const catInfo = EXPENSE_CATEGORIES.find((c) => c.id === cat);
              const pct = totalExpenses > 0 ? (amt / totalExpenses * 100) : 0;
              return (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
                  <Icon name={catInfo?.icon || "expense"} size={14} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#aaa" }}>{catInfo?.label || cat}</div>
                    <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", marginTop: 3 }}>
                      <div style={{ height: 3, borderRadius: 2, background: "#0f0", width: `${pct}%` }} />
                    </div>
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 600, color: "#0f0" }}>${amt.toFixed(0)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Expense Form */}
      {showAdd && (
        <div style={{ background: "rgba(0,255,0,0.03)", border: "1px solid rgba(0,255,0,0.12)", borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f0", marginBottom: 16, fontFamily: "'JetBrains Mono'", letterSpacing: 1 }}>NEW EXPENSE</div>

          {/* Category Selection */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 6 }}>CATEGORY</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {EXPENSE_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: form.category === cat.id ? "1px solid #0f0" : "1px solid rgba(255,255,255,0.08)",
                    background: form.category === cat.id ? "rgba(0,255,0,0.1)" : "rgba(255,255,255,0.02)",
                    color: form.category === cat.id ? "#0f0" : "#888",
                    fontSize: 11,
                    cursor: "pointer",
                    fontFamily: "'Outfit', sans-serif",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    transition: "all 0.15s",
                  }}
                  onClick={() => setForm({ ...form, category: cat.id })}
                >
                  <Icon name={cat.icon} size={12} /> {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>DESCRIPTION *</label>
              <input style={styles.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Holiday Inn — 2 nights" />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>AMOUNT ($) *</label>
              <input type="number" step="0.01" style={styles.input} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>DATE</label>
              <input type="date" style={styles.input} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>

          <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>VENDOR / MERCHANT</label>
              <input style={styles.input} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Marriott, Shell, Subway" />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>RECEIPT REFERENCE</label>
              <input style={styles.input} value={form.receiptRef} onChange={(e) => setForm({ ...form, receiptRef: e.target.value })} placeholder="Receipt # or filename" />
            </div>
          </div>

          <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>NOTES</label>
              <input style={styles.input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Additional details..." />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={form.reimbursable} onChange={(e) => setForm({ ...form, reimbursable: e.target.checked })} style={{ accentColor: "#0f0", width: 16, height: 16 }} />
                <span style={{ color: form.reimbursable ? "#0f0" : "#888" }}>Billable to client</span>
              </label>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button style={styles.btn()} onClick={() => setShowAdd(false)}>Cancel</button>
            <button style={styles.btn("primary")} onClick={addExpense}><Icon name="add" size={12} /> Add Expense</button>
          </div>
        </div>
      )}

      {/* Filters & Sort */}
      {expenses.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#555", letterSpacing: 1, marginRight: 4 }}>FILTER:</span>
          <button style={{ ...styles.btn(filterCat === "all" ? "primary" : ""), fontSize: 11, padding: "5px 10px" }} onClick={() => setFilterCat("all")}>All</button>
          {[...new Set(expenses.map((e) => e.category))].map((cat) => {
            const catInfo = EXPENSE_CATEGORIES.find((c) => c.id === cat);
            return (
              <button key={cat} style={{ ...styles.btn(filterCat === cat ? "primary" : ""), fontSize: 11, padding: "5px 10px" }} onClick={() => setFilterCat(cat)}>
                <Icon name={catInfo?.icon || "expense"} size={10} /> {catInfo?.label || cat}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: "#555", letterSpacing: 1, marginRight: 4 }}>SORT:</span>
          {["date", "amount", "category"].map((s) => (
            <button key={s} style={{ ...styles.btn(sortBy === s ? "primary" : ""), fontSize: 11, padding: "5px 10px" }} onClick={() => setSortBy(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Expense List */}
      {expenses.length === 0 && !showAdd ? (
        <div style={{ textAlign: "center", padding: 40, border: "2px dashed rgba(255,255,255,0.06)", borderRadius: 10, color: "#444" }}>
          <Icon name="expense" size={28} />
          <div style={{ marginTop: 8, fontSize: 13 }}>No expenses recorded. Add hotel stays, meals, fuel, and other case costs.</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Billable expenses automatically appear on invoices.</div>
        </div>
      ) : (
        <div>
          {sorted.map((exp) => {
            const catInfo = EXPENSE_CATEGORIES.find((c) => c.id === exp.category);
            return (
              <div key={exp.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, marginBottom: 6, transition: "all 0.15s" }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: exp.reimbursable ? "rgba(0,255,0,0.08)" : "rgba(255,153,0,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name={catInfo?.icon || "expense"} size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#ddd" }}>{exp.description}</span>
                    {!exp.reimbursable && (
                      <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "rgba(255,153,0,0.12)", color: "#f90", fontWeight: 600, letterSpacing: 0.5 }}>NON-BILLABLE</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#666", fontFamily: "'JetBrains Mono'" }}>
                    {catInfo?.label || exp.category}
                    {exp.vendor ? ` • ${exp.vendor}` : ""}
                    {exp.receiptRef ? ` • Rcpt: ${exp.receiptRef}` : ""}
                    {exp.notes ? ` • ${exp.notes}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 700, color: exp.reimbursable ? "#0f0" : "#f90" }}>
                    ${exp.amount.toFixed(2)}
                  </div>
                  <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono'" }}>{new Date(exp.date).toLocaleDateString()}</div>
                </div>
                <button style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, padding: 4 }} onClick={() => deleteExpense(exp.id)} title="Delete expense">✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Case Rate Overrides (shown on overview tab) ───
function CaseRateOverrides({ caseData, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const overrides = caseData.rateOverrides || {};
  const client = CLIENTS_DB.find((cl) => cl.id === caseData.clientId);

  const rateRows = [
    { key: "hourly", label: "Hourly Rate", unit: "$/hr" },
    { key: "mileage", label: "Mileage Rate", unit: "$/mi" },
    { key: "retainer", label: "Retainer Fee", unit: "$" },
  ];

  const setOverride = (key, value) => {
    caseData.rateOverrides = caseData.rateOverrides || {};
    if (value === "" || value === null) {
      delete caseData.rateOverrides[key];
    } else {
      caseData.rateOverrides[key] = parseFloat(value);
    }
    onUpdate({ ...caseData });
  };

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="rates" size={14} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#ddd" }}>Billing Rates</span>
          {Object.keys(overrides).length > 0 && (
            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "rgba(255,153,0,0.12)", color: "#f90", fontWeight: 600 }}>{Object.keys(overrides).length} OVERRIDE{Object.keys(overrides).length > 1 ? "S" : ""}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#888" }}>
            ${resolveRate(caseData, "hourly").value}/hr • ${resolveRate(caseData, "mileage").value}/mi
          </span>
          <span style={{ color: "#555", fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ fontSize: 10, color: "#555", marginTop: 10, marginBottom: 12 }}>
            Override rates for this case only. Leave blank to use the client or agency default rate.
          </div>

          <div className="cv-grid3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, marginBottom: 8, fontSize: 9, color: "#555", letterSpacing: 1, fontWeight: 600, padding: "0 4px" }}>
            <span>RATE</span>
            <span style={{ textAlign: "center" }}>EFFECTIVE RATE</span>
            <span style={{ textAlign: "center" }}>CASE OVERRIDE</span>
          </div>

          {rateRows.map((row) => {
            const resolved = resolveRate(caseData, row.key);
            const srcInfo = RATE_SOURCE_LABELS[resolved.source];
            const hasOverride = overrides[row.key] !== undefined;
            const clientRate = row.key === "hourly" ? client?.defaultHourlyRate : row.key === "mileage" ? client?.defaultMileageRate : null;
            const agencyRate = getAgencyRate(row.key);

            return (
              <div key={row.key} className="cv-grid3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, alignItems: "center", padding: "8px 4px", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#ccc", fontWeight: 500 }}>{row.label}</div>
                  <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono'", marginTop: 2 }}>
                    Agency: ${agencyRate}{clientRate != null ? ` • Client: $${clientRate}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 14, fontWeight: 700, color: srcInfo?.color || "#888" }}>
                    ${resolved.value}
                  </span>
                  <span style={{ fontSize: 9, color: srcInfo?.color || "#888", marginLeft: 4 }}>{row.unit}</span>
                  <div style={{ fontSize: 9, color: srcInfo?.color || "#555", marginTop: 2 }}>{srcInfo?.label}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                  <input
                    type="number"
                    step={row.key === "mileage" ? "0.001" : "1"}
                    style={{ ...styles.input, width: 90, textAlign: "center", fontFamily: "'JetBrains Mono'", fontWeight: 600, borderColor: hasOverride ? "rgba(255,153,0,0.3)" : undefined }}
                    value={overrides[row.key] ?? ""}
                    placeholder="—"
                    onChange={(e) => setOverride(row.key, e.target.value)}
                  />
                  {hasOverride && (
                    <button style={{ background: "none", border: "none", color: "#f44", cursor: "pointer", fontSize: 12, padding: 2 }} onClick={() => setOverride(row.key, "")} title="Remove override">✕</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InvoicePanel({ caseData, onUpdate }) {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const linkedClient = CLIENTS_DB.find((cl) => cl.id === caseData.clientId);

  // Resolve rates via cascade: case → client → agency
  const hourlyResolved = resolveRate(caseData, "hourly");
  const mileageResolved = resolveRate(caseData, "mileage");

  const [rates, setRates] = useState({
    hourly: hourlyResolved.value,
    mileage: mileageResolved.value,
    retainer: caseData.rateOverrides?.retainer || 0,
    perDiem: resolveRate(caseData, "perDiem").value,
    courtTestimony: resolveRate(caseData, "courtTestimony").value,
  });
  const [rateSources] = useState({
    hourly: hourlyResolved.source,
    mileage: mileageResolved.source,
  });
  const [customItems, setCustomItems] = useState([]);
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemAmt, setNewItemAmt] = useState("");
  const [clientEmail, setClientEmail] = useState(linkedClient?.email || "");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState(AGENCY_SETTINGS.defaultTerms || "Net 30");
  const [discount, setDiscount] = useState(0);

  const totalMiles = caseData.mileageEntries?.reduce((s, e) => s + e.miles, 0) || 0;
  const totalSeconds = caseData.mileageEntries?.reduce((s, e) => s + (e.duration || 0), 0) || 0;
  const totalHours = totalSeconds / 3600;

  const calcLineItems = () => {
    const items = [];
    if (totalHours > 0) {
      items.push({ desc: `Investigative Services (${totalHours.toFixed(2)} hrs @ $${rates.hourly}/hr)`, qty: totalHours, rate: rates.hourly, amount: totalHours * rates.hourly });
    }
    if (totalMiles > 0) {
      items.push({ desc: `Mileage (${totalMiles.toFixed(1)} mi @ $${rates.mileage}/mi)`, qty: totalMiles, rate: rates.mileage, amount: totalMiles * rates.mileage });
    }
    if (rates.retainer > 0) {
      items.push({ desc: "Retainer Fee", qty: 1, rate: rates.retainer, amount: rates.retainer });
    }
    // Add billable expenses
    const billableExpenses = (caseData.expenses || []).filter((e) => e.reimbursable);
    if (billableExpenses.length > 0) {
      // Group by category for cleaner invoices
      const catGroups = {};
      billableExpenses.forEach((e) => {
        const catInfo = EXPENSE_CATEGORIES.find((c) => c.id === e.category);
        const label = catInfo?.label || e.category;
        if (!catGroups[label]) catGroups[label] = { total: 0, items: [] };
        catGroups[label].total += e.amount;
        catGroups[label].items.push(e);
      });
      Object.entries(catGroups).forEach(([label, group]) => {
        const detail = group.items.length === 1
          ? group.items[0].description
          : `${group.items.length} entries`;
        items.push({ desc: `Expense: ${label} (${detail})`, qty: 1, rate: group.total, amount: group.total });
      });
    }
    customItems.forEach((ci) => {
      items.push({ desc: ci.desc, qty: 1, rate: ci.amount, amount: ci.amount });
    });
    return items;
  };

  const lineItems = calcLineItems();
  const subtotal = lineItems.reduce((s, i) => s + i.amount, 0);
  const discountAmt = subtotal * (discount / 100);
  const total = subtotal - discountAmt;

  const addCustomItem = () => {
    if (!newItemDesc || !newItemAmt) return;
    setCustomItems([...customItems, { desc: newItemDesc, amount: parseFloat(newItemAmt), id: Date.now() }]);
    setNewItemDesc("");
    setNewItemAmt("");
  };

  const removeCustomItem = (id) => {
    setCustomItems(customItems.filter((i) => i.id !== id));
  };

  const createInvoice = () => {
    const inv = {
      id: `INV-${++INVOICE_COUNTER}`,
      caseId: caseData.id,
      clientId: caseData.clientId || "",
      caseTitle: caseData.title,
      client: caseData.client,
      clientEmail,
      status: "draft",
      createdAt: new Date().toISOString(),
      dueDate: new Date(Date.now() + (terms === "Net 30" ? 30 : terms === "Net 15" ? 15 : terms === "Net 60" ? 60 : 7) * 86400000).toISOString(),
      terms,
      notes,
      lineItems: calcLineItems(),
      subtotal,
      discount,
      discountAmt,
      total,
      rates: { ...rates },
    };
    INVOICES_DB.push(inv);
    caseData.invoices = caseData.invoices || [];
    caseData.invoices.push(inv);
    caseData.updates.push({ text: `Invoice ${inv.id} created — $${total.toFixed(2)}`, timestamp: new Date().toISOString(), id: Date.now(), system: true });
    logAuditEvent("INVOICE_CREATED", caseData.id, { invoiceId: inv.id, total, lineItems: inv.lineItems.length });
    onUpdate({ ...caseData });
    setShowCreate(false);
    setCustomItems([]);
    setNotes("");
    setClientEmail("");
    setDiscount(0);
  };

  const markInvoice = (inv, newStatus) => {
    const oldStatus = inv.status;
    inv.status = newStatus;
    if (newStatus === "sent") inv.sentAt = new Date().toISOString();
    if (newStatus === "paid") inv.paidAt = new Date().toISOString();
    const idx = INVOICES_DB.findIndex((i) => i.id === inv.id);
    if (idx >= 0) INVOICES_DB[idx] = inv;
    caseData.updates.push({ text: `Invoice ${inv.id} marked as ${newStatus.toUpperCase()}`, timestamp: new Date().toISOString(), id: Date.now(), system: true });
    logAuditEvent("INVOICE_STATUS", caseData.id, { invoiceId: inv.id, from: oldStatus, to: newStatus });
    onUpdate({ ...caseData });
    setSelectedInvoice({ ...inv });
  };

  const invoices = caseData.invoices || [];

  // Invoice Detail View
  if (selectedInvoice) {
    const inv = selectedInvoice;
    return (
      <div>
        <button style={{ ...styles.btn(), padding: "6px 12px", marginBottom: 16 }} onClick={() => setSelectedInvoice(null)}>← Back to Invoices</button>

        {/* Invoice Preview */}
        <div style={{ background: "#fff", color: "#111", borderRadius: 12, padding: 32, maxWidth: 700, position: "relative", overflow: "hidden" }}>
          {/* Watermark for draft */}
          {inv.status === "draft" && (
            <div style={{ position: "absolute", top: "40%", left: "50%", transform: "translate(-50%, -50%) rotate(-30deg)", fontSize: 60, fontWeight: 800, color: "rgba(0,0,0,0.04)", letterSpacing: 8, pointerEvents: "none", fontFamily: "'JetBrains Mono'" }}>DRAFT</div>
          )}
          {inv.status === "paid" && (
            <div style={{ position: "absolute", top: "40%", left: "50%", transform: "translate(-50%, -50%) rotate(-30deg)", fontSize: 60, fontWeight: 800, color: "rgba(0,180,0,0.08)", letterSpacing: 8, pointerEvents: "none", fontFamily: "'JetBrains Mono'" }}>PAID</div>
          )}

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, borderBottom: "3px solid #111", paddingBottom: 20 }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 22, fontWeight: 800, letterSpacing: 2, color: "#111" }}>◈ CASEVAULT</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Private Investigation Services</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#111", letterSpacing: -1 }}>INVOICE</div>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#555" }}>{inv.id}</div>
            </div>
          </div>

          {/* Client & Dates */}
          <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 28 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: 1.5, marginBottom: 6 }}>BILL TO</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>{inv.client}</div>
              {inv.clientEmail && <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{inv.clientEmail}</div>}
              <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>Re: {inv.caseTitle}</div>
              <div style={{ fontSize: 11, color: "#aaa", fontFamily: "'JetBrains Mono'" }}>Case {inv.caseId}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: 1.5, marginBottom: 6 }}>DETAILS</div>
              <div style={{ fontSize: 12, color: "#555" }}>Date: {new Date(inv.createdAt).toLocaleDateString()}</div>
              <div style={{ fontSize: 12, color: "#555" }}>Due: {new Date(inv.dueDate).toLocaleDateString()}</div>
              <div style={{ fontSize: 12, color: "#555" }}>Terms: {inv.terms}</div>
            </div>
          </div>

          {/* Line Items Table */}
          <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #e0e0e0", marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", padding: "10px 16px", background: "#111", color: "#fff", fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>
              <span>DESCRIPTION</span>
              <span style={{ textAlign: "right" }}>AMOUNT</span>
            </div>
            {inv.lineItems.map((item, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "3fr 1fr", padding: "12px 16px", borderTop: i > 0 ? "1px solid #eee" : "none", fontSize: 13 }}>
                <span style={{ color: "#333" }}>{item.desc}</span>
                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono'", fontWeight: 600, color: "#111" }}>${item.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{ width: 260 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#666" }}>
                <span>Subtotal</span>
                <span style={{ fontFamily: "'JetBrains Mono'" }}>${inv.subtotal.toFixed(2)}</span>
              </div>
              {inv.discount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#c00" }}>
                  <span>Discount ({inv.discount}%)</span>
                  <span style={{ fontFamily: "'JetBrains Mono'" }}>-${inv.discountAmt.toFixed(2)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 18, fontWeight: 800, color: "#111", borderTop: "2px solid #111", marginTop: 6 }}>
                <span>Total Due</span>
                <span style={{ fontFamily: "'JetBrains Mono'" }}>${inv.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {inv.notes && (
            <div style={{ marginTop: 20, padding: "12px 16px", background: "#f8f8f8", borderRadius: 6, fontSize: 12, color: "#666", borderLeft: "3px solid #ddd" }}>
              <div style={{ fontWeight: 700, fontSize: 10, color: "#999", letterSpacing: 1, marginBottom: 4 }}>NOTES</div>
              {inv.notes}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          {inv.status === "draft" && (
            <button style={{ ...styles.btn("primary") }} onClick={() => markInvoice(inv, "sent")}>
              <Icon name="send" size={14} /> Mark as Sent
            </button>
          )}
          {inv.status === "sent" && (
            <button style={{ ...styles.btn("primary") }} onClick={() => markInvoice(inv, "paid")}>
              <Icon name="dollar" size={14} /> Mark as Paid
            </button>
          )}
          {inv.status === "viewed" && (
            <button style={{ ...styles.btn("primary") }} onClick={() => markInvoice(inv, "paid")}>
              <Icon name="dollar" size={14} /> Mark as Paid
            </button>
          )}
          <button style={styles.btn()} onClick={() => {
            const printW = window.open("", "_blank");
            const invHtml = generateInvoiceHTML(inv);
            printW.document.write(invHtml);
            printW.document.close();
            printW.print();
          }}>
            <Icon name="print" size={14} /> Print / PDF
          </button>
          <button style={styles.btn()} onClick={() => {
            const mailTo = inv.clientEmail || "";
            const subject = encodeURIComponent(`Invoice ${inv.id} — ${inv.caseTitle}`);
            const body = encodeURIComponent(`Dear ${inv.client},\n\nPlease find your invoice ${inv.id} for investigation services.\n\nTotal Due: $${inv.total.toFixed(2)}\nDue Date: ${new Date(inv.dueDate).toLocaleDateString()}\n\nThank you for your business.\n\nBest regards`);
            window.open(`mailto:${mailTo}?subject=${subject}&body=${body}`);
            if (inv.status === "draft") markInvoice(inv, "sent");
          }}>
            <Icon name="send" size={14} /> Email Invoice
          </button>
          <span style={{ ...styles.badge(INVOICE_STATUS_COLORS[inv.status]), alignSelf: "center", marginLeft: 8 }}>
            {INVOICE_STATUS_COLORS[inv.status].label}
          </span>
        </div>
      </div>
    );
  }

  // Create Invoice Form
  if (showCreate) {
    return (
      <div>
        <button style={{ ...styles.btn(), padding: "6px 12px", marginBottom: 16 }} onClick={() => setShowCreate(false)}>← Back</button>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Create Invoice</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 20 }}>Auto-populated from case mileage & time data</div>

        {/* Rates */}
        <div style={{ background: "rgba(0,255,0,0.03)", border: "1px solid rgba(0,255,0,0.1)", borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0f0", letterSpacing: 1, fontFamily: "'JetBrains Mono'" }}>BILLING RATES</div>
            <div style={{ fontSize: 10, color: "#555" }}>
              <span style={{ color: RATE_SOURCE_LABELS.agency.color }}>● Agency</span>{" "}
              <span style={{ color: RATE_SOURCE_LABELS.client.color }}>● Client</span>{" "}
              <span style={{ color: RATE_SOURCE_LABELS.case.color }}>● Case Override</span>
            </div>
          </div>
          <div className="cv-grid3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>
                HOURLY RATE ($) <span style={{ color: RATE_SOURCE_LABELS[rateSources.hourly]?.color, fontSize: 9 }}>({RATE_SOURCE_LABELS[rateSources.hourly]?.label})</span>
              </label>
              <input type="number" style={styles.input} value={rates.hourly} onChange={(e) => setRates({ ...rates, hourly: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>
                MILEAGE ($/mi) <span style={{ color: RATE_SOURCE_LABELS[rateSources.mileage]?.color, fontSize: 9 }}>({RATE_SOURCE_LABELS[rateSources.mileage]?.label})</span>
              </label>
              <input type="number" step="0.001" style={styles.input} value={rates.mileage} onChange={(e) => setRates({ ...rates, mileage: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>RETAINER FEE ($)</label>
              <input type="number" style={styles.input} value={rates.retainer} onChange={(e) => setRates({ ...rates, retainer: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#555", marginTop: 10 }}>
            Rates auto-populated from the cascade: case overrides → client rates → agency defaults. You can adjust them for this invoice without changing the saved rates.
          </div>
        </div>

        {/* Auto-calculated line items */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", letterSpacing: 1, marginBottom: 14 }}>LINE ITEMS</div>
          {lineItems.length === 0 ? (
            <div style={{ color: "#555", fontSize: 13 }}>No billable items yet. Track mileage/time or add custom items.</div>
          ) : (
            lineItems.map((item, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
                <span style={{ color: "#ccc" }}>{item.desc}</span>
                <span style={{ fontFamily: "'JetBrains Mono'", color: "#0f0", fontWeight: 600 }}>${item.amount.toFixed(2)}</span>
              </div>
            ))
          )}

          {/* Add custom line item */}
          <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: "#666", letterSpacing: 1, display: "block", marginBottom: 4 }}>CUSTOM ITEM</label>
              <input style={styles.input} value={newItemDesc} onChange={(e) => setNewItemDesc(e.target.value)} placeholder="e.g. Database search fee" />
            </div>
            <div style={{ width: 120 }}>
              <label style={{ fontSize: 10, color: "#666", letterSpacing: 1, display: "block", marginBottom: 4 }}>AMOUNT ($)</label>
              <input type="number" style={styles.input} value={newItemAmt} onChange={(e) => setNewItemAmt(e.target.value)} placeholder="0.00" />
            </div>
            <button style={{ ...styles.btn("primary"), padding: "10px 14px" }} onClick={addCustomItem}><Icon name="add" size={12} /></button>
          </div>

          {customItems.map((ci) => (
            <div key={ci.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
              <span style={{ color: "#f90" }}>{ci.desc}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "'JetBrains Mono'", color: "#f90", fontWeight: 600 }}>${ci.amount.toFixed(2)}</span>
                <button style={{ background: "none", border: "none", color: "#f44", cursor: "pointer", fontSize: 12 }} onClick={() => removeCustomItem(ci.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>

        {/* Invoice Details */}
        <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <div>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>CLIENT EMAIL</label>
            <input type="email" style={styles.input} value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="client@example.com" />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>PAYMENT TERMS</label>
            <select style={styles.select} value={terms} onChange={(e) => setTerms(e.target.value)}>
              <option value="Due on Receipt">Due on Receipt</option>
              <option value="Net 7">Net 7</option>
              <option value="Net 15">Net 15</option>
              <option value="Net 30">Net 30</option>
              <option value="Net 60">Net 60</option>
            </select>
          </div>
        </div>

        <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <div>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>DISCOUNT (%)</label>
            <input type="number" min="0" max="100" style={styles.input} value={discount} onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>NOTES</label>
            <input style={styles.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment instructions, thank you note..." />
          </div>
        </div>

        {/* Total Preview */}
        <div style={{ background: "rgba(0,255,0,0.04)", border: "1px solid rgba(0,255,0,0.15)", borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#aaa", marginBottom: 6 }}>
            <span>Subtotal</span>
            <span style={{ fontFamily: "'JetBrains Mono'", color: "#ddd" }}>${subtotal.toFixed(2)}</span>
          </div>
          {discount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#f44", marginBottom: 6 }}>
              <span>Discount ({discount}%)</span>
              <span style={{ fontFamily: "'JetBrains Mono'" }}>-${discountAmt.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, fontWeight: 800, color: "#0f0", paddingTop: 10, borderTop: "1px solid rgba(0,255,0,0.15)" }}>
            <span>Total</span>
            <span style={{ fontFamily: "'JetBrains Mono'" }}>${total.toFixed(2)}</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button style={styles.btn()} onClick={() => setShowCreate(false)}>Cancel</button>
          <button style={styles.btn("primary")} onClick={createInvoice} disabled={lineItems.length === 0}>
            <Icon name="invoice" size={14} /> Create Invoice
          </button>
        </div>
      </div>
    );
  }

  // Invoice List
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Invoices</div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>Auto-calculated from case tracking data</div>
        </div>
        <button style={styles.btn("primary")} onClick={() => setShowCreate(true)}>
          <Icon name="add" size={12} /> New Invoice
        </button>
      </div>

      {invoices.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, border: "2px dashed rgba(255,255,255,0.06)", borderRadius: 10, color: "#444" }}>
          <Icon name="invoice" size={28} />
          <div style={{ marginTop: 8, fontSize: 13 }}>No invoices yet. Create one to auto-calculate from tracked mileage and time.</div>
          <div style={{ marginTop: 4, fontSize: 11, color: "#555" }}>
            Current billable: {totalHours.toFixed(2)} hours, {totalMiles.toFixed(1)} miles
          </div>
        </div>
      ) : (
        invoices.map((inv) => (
          <div key={inv.id} style={{ ...styles.card, cursor: "pointer" }} onClick={() => setSelectedInvoice(inv)} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,0,0.15)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#555" }}>{inv.id}</span>
                  <span style={styles.badge(INVOICE_STATUS_COLORS[inv.status])}>{INVOICE_STATUS_COLORS[inv.status].label}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{inv.client}</div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{inv.lineItems.length} line items • {inv.terms}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 700, color: "#0f0" }}>${inv.total.toFixed(2)}</div>
                <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono'" }}>Due {new Date(inv.dueDate).toLocaleDateString()}</div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Helper to generate printable invoice HTML
function generateInvoiceHTML(inv) {
  const rows = inv.lineItems.map((item) => `<tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px">${item.desc}</td><td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:600">$${item.amount.toFixed(2)}</td></tr>`).join("");
  return `<!DOCTYPE html><html><head><title>Invoice ${inv.id}</title><style>body{font-family:Helvetica,Arial,sans-serif;margin:40px;color:#111}@media print{body{margin:20px}}</style></head><body>
<div style="display:flex;justify-content:space-between;border-bottom:3px solid #111;padding-bottom:20px;margin-bottom:24px">
<div><div style="font-size:22px;font-weight:800;letter-spacing:2px">◈ CASEVAULT</div><div style="font-size:11px;color:#888;margin-top:4px">Private Investigation Services</div></div>
<div style="text-align:right"><div style="font-size:28px;font-weight:800">INVOICE</div><div style="font-family:monospace;font-size:13px;color:#555">${inv.id}</div></div></div>
<div style="display:flex;justify-content:space-between;margin-bottom:28px">
<div><div style="font-size:10px;font-weight:700;color:#999;letter-spacing:1.5px;margin-bottom:4px">BILL TO</div><div style="font-size:15px;font-weight:600">${inv.client}</div>${inv.clientEmail ? `<div style="font-size:12px;color:#666">${inv.clientEmail}</div>` : ""}<div style="font-size:12px;color:#888;margin-top:4px">Re: ${inv.caseTitle}</div><div style="font-size:11px;color:#aaa;font-family:monospace">Case ${inv.caseId}</div></div>
<div style="text-align:right"><div style="font-size:10px;font-weight:700;color:#999;letter-spacing:1.5px;margin-bottom:4px">DETAILS</div><div style="font-size:12px;color:#555">Date: ${new Date(inv.createdAt).toLocaleDateString()}</div><div style="font-size:12px;color:#555">Due: ${new Date(inv.dueDate).toLocaleDateString()}</div><div style="font-size:12px;color:#555">Terms: ${inv.terms}</div></div></div>
<table style="width:100%;border-collapse:collapse;border:1px solid #ddd;border-radius:8px;margin-bottom:20px"><thead><tr style="background:#111;color:#fff"><th style="padding:10px 12px;text-align:left;font-size:10px;letter-spacing:1.5px">DESCRIPTION</th><th style="padding:10px 12px;text-align:right;font-size:10px;letter-spacing:1.5px">AMOUNT</th></tr></thead><tbody>${rows}</tbody></table>
<div style="display:flex;justify-content:flex-end"><div style="width:260px">
<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#666"><span>Subtotal</span><span style="font-family:monospace">$${inv.subtotal.toFixed(2)}</span></div>
${inv.discount > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#c00"><span>Discount (${inv.discount}%)</span><span style="font-family:monospace">-$${inv.discountAmt.toFixed(2)}</span></div>` : ""}
<div style="display:flex;justify-content:space-between;padding:10px 0;font-size:18px;font-weight:800;border-top:2px solid #111;margin-top:6px"><span>Total Due</span><span style="font-family:monospace">$${inv.total.toFixed(2)}</span></div></div></div>
${inv.notes ? `<div style="margin-top:20px;padding:12px 16px;background:#f8f8f8;border-radius:6px;font-size:12px;color:#666;border-left:3px solid #ddd"><div style="font-weight:700;font-size:10px;color:#999;letter-spacing:1px;margin-bottom:4px">NOTES</div>${inv.notes}</div>` : ""}
</body></html>`;
}

function AIPanel({ caseData }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState(null);
  const [summary, setSummary] = useState(null);

  const runAnalysis = () => {
    setAnalyzing(true);
    setTimeout(() => {
      setResults(analyzeDocuments(caseData));
      setSummary(generateCaseSummary(caseData));
      setAnalyzing(false);
    }, 1800);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>AI Case Analyst</div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>Document analysis & investigative direction recommendations</div>
        </div>
        <button style={styles.btn("primary")} onClick={runAnalysis} disabled={analyzing}>
          <Icon name="ai" size={14} /> {analyzing ? "Analyzing..." : "Run Analysis"}
        </button>
      </div>

      {analyzing && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#0f0", animation: "pulse 1s infinite" }}>
            ▓▓▓▓▓░░░░░ PROCESSING CASE DATA...
          </div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 8 }}>Analyzing documents, cross-referencing patterns, generating leads</div>
        </div>
      )}

      {results && summary && !analyzing && (
        <div>
          {/* Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 24 }}>
            <div style={{ background: "rgba(0,255,0,0.04)", borderRadius: 8, padding: 14, textAlign: "center", border: "1px solid rgba(0,255,0,0.1)" }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 700, color: "#0f0" }}>{summary.completionEstimate}%</div>
              <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>COMPLETION</div>
            </div>
            <div style={{ background: "rgba(74,170,255,0.04)", borderRadius: 8, padding: 14, textAlign: "center", border: "1px solid rgba(74,170,255,0.1)" }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 700, color: "#4af" }}>{summary.totalHours}h</div>
              <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>FIELD TIME</div>
            </div>
            <div style={{ background: "rgba(255,153,0,0.04)", borderRadius: 8, padding: 14, textAlign: "center", border: "1px solid rgba(255,153,0,0.1)" }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 700, color: "#f90" }}>{summary.riskLevel}</div>
              <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>EXPOSURE</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 14, textAlign: "center", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 700, color: "#fff" }}>{summary.nextReviewDate}</div>
              <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>NEXT REVIEW</div>
            </div>
          </div>

          {/* Recommendations */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f0", marginBottom: 12, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono'" }}>
            Recommended Next Actions
          </div>
          {results.map((r, i) => (
            <div key={i} style={{ padding: "14px 16px", background: "rgba(255,255,255,0.02)", border: `1px solid ${r.priority === "high" ? "rgba(0,255,0,0.12)" : "rgba(255,255,255,0.05)"}`, borderRadius: 8, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#ddd", lineHeight: 1.4 }}>{r.action}</div>
                <div style={{ marginLeft: 16, minWidth: 50, textAlign: "right" }}>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 16, fontWeight: 700, color: r.probability > 80 ? "#0f0" : r.probability > 60 ? "#f90" : "#f44" }}>
                    {r.probability}%
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={styles.probBar(r.probability)} />
                </div>
                <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono'", color: "#555", letterSpacing: 1 }}>{r.category}</span>
                <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: r.priority === "high" ? "rgba(0,255,0,0.1)" : "rgba(255,153,0,0.1)", color: r.priority === "high" ? "#0f0" : "#f90", fontWeight: 600, letterSpacing: 1 }}>
                  {r.priority.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewCaseModal({ onClose, onSave }) {
  const [form, setForm] = useState({ title: "", client: "", clientId: "", subject: "", type: "Surveillance", description: "", priority: "medium", leadAgent: CURRENT_USER?.id || "", assignedAgents: [] });
  const [clientMode, setClientMode] = useState("existing"); // "existing" | "new"

  const save = () => {
    if (!form.title) return alert("Title is required");
    if (clientMode === "existing" && !form.clientId) return alert("Please select a client");
    if (clientMode === "new" && !form.client) return alert("Please enter a client name");

    let clientName = form.client;
    let clientId = form.clientId;
    if (clientMode === "existing") {
      const cl = CLIENTS_DB.find((c) => c.id === form.clientId);
      clientName = cl ? cl.name : form.client;
    }

    // Ensure lead agent is in assigned list
    const assignedSet = new Set(form.assignedAgents);
    if (form.leadAgent) assignedSet.add(form.leadAgent);

    const newCase = {
      id: `PI-${++CASE_COUNTER}`,
      ...form,
      client: clientName,
      clientId: clientId,
      leadAgent: form.leadAgent || CURRENT_USER?.id || "",
      assignedAgents: [...assignedSet],
      status: "active",
      createdAt: new Date().toISOString(),
      updates: [],
      documents: [],
      mileageEntries: [],
      recordings: [],
      invoices: [],
      expenses: [],
    };
    CASES_DB.push(newCase);
    logAuditEvent("CASE_CREATED", newCase.id, { title: newCase.title, client: clientName, type: newCase.type, leadAgent: form.leadAgent, assignedAgents: [...assignedSet] });
    onSave(newCase);
    onClose();
  };

  return (
    <div style={styles.modal} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 4 }}>New Investigation</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 24 }}>Create a new case file to begin tracking</div>

        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Case Title *</label>
            <input style={styles.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Smith Insurance Surveillance" />
          </div>

          {/* Client Selection */}
          <div>
            <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Client *</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button style={{ ...styles.btn(clientMode === "existing" ? "primary" : ""), fontSize: 12, padding: "6px 14px" }} onClick={() => setClientMode("existing")}>
                Existing Client
              </button>
              <button style={{ ...styles.btn(clientMode === "new" ? "primary" : ""), fontSize: 12, padding: "6px 14px" }} onClick={() => setClientMode("new")}>
                Quick Add
              </button>
            </div>
            {clientMode === "existing" ? (
              CLIENTS_DB.length > 0 ? (
                <select style={styles.select} value={form.clientId} onChange={(e) => {
                  const cl = CLIENTS_DB.find((c) => c.id === e.target.value);
                  setForm({ ...form, clientId: e.target.value, client: cl ? cl.name : "" });
                }}>
                  <option value="">— Select a client —</option>
                  {CLIENTS_DB.filter((cl) => cl.status !== "inactive").map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.name} ({cl.type}){cl.status === "vip" ? " ⭐" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 12, color: "#666", padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
                  No clients yet. Use "Quick Add" or go to Clients page to create one first.
                </div>
              )
            ) : (
              <input style={styles.input} value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value, clientId: "" })} placeholder="Client name (will not create a full client profile)" />
            )}
            {clientMode === "existing" && form.clientId && (() => {
              const cl = CLIENTS_DB.find((c) => c.id === form.clientId);
              if (!cl) return null;
              const caseCount = CASES_DB.filter((c) => c.clientId === cl.id).length;
              return (
                <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(0,255,0,0.03)", border: "1px solid rgba(0,255,0,0.08)", borderRadius: 6, fontSize: 12, color: "#888", display: "flex", gap: 16 }}>
                  <span><Icon name={["Attorney", "Law Firm", "Insurance Company", "Corporation"].includes(cl.type) ? "firm" : "client"} size={12} /> {cl.type}</span>
                  {cl.email && <span><Icon name="email" size={12} /> {cl.email}</span>}
                  <span>{caseCount} existing case{caseCount !== 1 ? "s" : ""}</span>
                  <span>${cl.defaultHourlyRate}/hr</span>
                </div>
              );
            })()}
          </div>

          <div>
            <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Subject</label>
            <input style={styles.input} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject of investigation" />
          </div>
          <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Case Type</label>
              <select style={styles.select} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {CASE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Priority</label>
              <select style={styles.select} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Description</label>
            <textarea style={styles.textarea} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Case details, objectives, and notes..." />
          </div>

          {/* Agent Assignment — only show if multiple agents */}
          {AGENTS_DB.length > 1 && (
            <div style={{ background: "rgba(0,255,0,0.03)", border: "1px solid rgba(0,255,0,0.08)", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: "#0f0", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10, fontFamily: "'JetBrains Mono'", fontWeight: 600 }}>Assignment</div>
              <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>LEAD INVESTIGATOR</label>
                  <select style={styles.select} value={form.leadAgent} onChange={(e) => setForm({ ...form, leadAgent: e.target.value })}>
                    {AGENTS_DB.filter((a) => a.status === "active" && a.role !== "viewer").map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({AGENT_ROLES[a.role]?.label})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>ADDITIONAL PIs</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {AGENTS_DB.filter((a) => a.status === "active" && a.id !== form.leadAgent).map((a) => {
                      const assigned = form.assignedAgents.includes(a.id);
                      return (
                        <button key={a.id} style={{ padding: "4px 10px", borderRadius: 4, border: assigned ? "1px solid #0f0" : "1px solid rgba(255,255,255,0.08)", background: assigned ? "rgba(0,255,0,0.1)" : "transparent", color: assigned ? "#0f0" : "#888", fontSize: 11, cursor: "pointer", fontFamily: "'Outfit'" }}
                          onClick={() => {
                            const next = assigned ? form.assignedAgents.filter((id) => id !== a.id) : [...form.assignedAgents, a.id];
                            setForm({ ...form, assignedAgents: next });
                          }}>
                          {a.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <button style={styles.btn()} onClick={onClose}>Cancel</button>
          <button style={styles.btn("primary")} onClick={save}><Icon name="add" size={12} /> Create Case</button>
        </div>
      </div>
    </div>
  );
}

function CaseDetail({ caseData, onBack, onUpdate }) {
  const [tab, setTab] = useState("overview");
  const [newUpdate, setNewUpdate] = useState("");
  const [docName, setDocName] = useState("");

  const addUpdate = () => {
    if (!newUpdate.trim()) return;
    caseData.updates.push({ text: newUpdate, timestamp: new Date().toISOString(), id: Date.now() });
    logAuditEvent("UPDATE_ADDED", caseData.id, { text: newUpdate.substring(0, 100) });
    setNewUpdate("");
    onUpdate({ ...caseData });
  };

  const addDocument = () => {
    if (!docName.trim()) return;
    const docId = Date.now();
    const docHash = quickHash(docName + docId);
    caseData.documents.push({ name: docName, uploadedAt: new Date().toISOString(), id: docId, type: docName.split(".").pop() || "pdf", size: (Math.random() * 5 + 0.5).toFixed(1) + " MB", integrityHash: docHash, custodyChain: [{ action: "Uploaded", actor: "Primary Investigator", timestamp: new Date().toISOString(), hash: docHash }] });
    logAuditEvent("DOC_UPLOADED", caseData.id, { docName, docId, integrityHash: docHash });
    setDocName("");
    onUpdate({ ...caseData });
  };

  const toggleStatus = (newStatus) => {
    const oldStatus = caseData.status;
    caseData.status = newStatus;
    caseData.updates.push({ text: `Status changed to ${newStatus.toUpperCase()}`, timestamp: new Date().toISOString(), id: Date.now(), system: true });
    logAuditEvent("CASE_STATUS", caseData.id, { from: oldStatus, to: newStatus });
    onUpdate({ ...caseData });
  };

  const totalMiles = caseData.mileageEntries?.reduce((s, e) => s + e.miles, 0) || 0;
  const totalTime = caseData.mileageEntries?.reduce((s, e) => s + (e.duration || 0), 0) || 0;
  const totalExpenses = caseData.expenses?.reduce((s, e) => s + e.amount, 0) || 0;

  const tabs = ["overview", "updates", "documents", "tracking", "expenses", "media", "invoices", "custody", "ai"];

  const isMobile = useIsMobile();

  return (
    <div>
      {!isMobile && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button style={{ ...styles.btn(), padding: "6px 12px" }} onClick={onBack}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#555" }}>{caseData.id}</span>
              <span style={styles.badge(STATUS_COLORS[caseData.status])}>{STATUS_COLORS[caseData.status].label}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginTop: 2 }}>{caseData.title}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {caseData.status === "active" && (
              <button style={{ ...styles.btn(), borderColor: "#f90", color: "#f90" }} onClick={() => toggleStatus("paused")}>
                <Icon name="pause" size={12} /> Pause
              </button>
            )}
            {caseData.status === "paused" && (
              <button style={styles.btn("primary")} onClick={() => toggleStatus("active")}>
                <Icon name="play" size={12} /> Resume
              </button>
            )}
            {(caseData.status === "active" || caseData.status === "paused") && (
              <button style={{ ...styles.btn(), borderColor: "#4af", color: "#4af" }} onClick={() => toggleStatus("completed")}>
                <Icon name="check" size={12} /> Complete
              </button>
            )}
          </div>
        </div>
      )}

      {isMobile && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#555" }}>{caseData.id}</span>
            <span style={styles.badge(STATUS_COLORS[caseData.status])}>{STATUS_COLORS[caseData.status].label}</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 10 }}>{caseData.title}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {caseData.status === "active" && (
              <button style={{ ...styles.btn(), borderColor: "#f90", color: "#f90", padding: "6px 12px", fontSize: 11 }} onClick={() => toggleStatus("paused")}>
                <Icon name="pause" size={11} /> Pause
              </button>
            )}
            {caseData.status === "paused" && (
              <button style={{ ...styles.btn("primary"), padding: "6px 12px", fontSize: 11 }} onClick={() => toggleStatus("active")}>
                <Icon name="play" size={11} /> Resume
              </button>
            )}
            {(caseData.status === "active" || caseData.status === "paused") && (
              <button style={{ ...styles.btn(), borderColor: "#4af", color: "#4af", padding: "6px 12px", fontSize: 11 }} onClick={() => toggleStatus("completed")}>
                <Icon name="check" size={11} /> Complete
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="cv-tabs" style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 24 }}>
        {tabs.map((t) => (
          <button key={t} style={styles.tab(tab === t)} onClick={() => setTab(t)}>
            {t === "ai" ? "AI Analysis" : t === "invoices" ? "Invoices" : t === "expenses" ? "Expenses" : t === "custody" ? "Chain of Custody" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "overview" && (
        <div>
          <div className="cv-stats" style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
            <StatCard value={caseData.updates.length} label="Updates" icon="doc" />
            <StatCard value={caseData.documents.length} label="Documents" icon="doc" />
            <StatCard value={`${totalMiles.toFixed(1)} mi`} label="Mileage" icon="car" />
            <StatCard value={`${(totalTime / 60).toFixed(1)}h`} label="Field Time" icon="clock" />
            <StatCard value={`$${totalExpenses.toFixed(0)}`} label="Expenses" icon="expense" />
          </div>

          <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={styles.card}>
              <div style={{ fontSize: 11, color: "#666", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Case Info</div>
              {(() => {
                const cl = CLIENTS_DB.find((c) => c.id === caseData.clientId);
                const clientDisplay = cl ? `${cl.name} (${cl.type})` : caseData.client;
                const leadName = AGENTS_DB.find((a) => a.id === caseData.leadAgent)?.name;
                const assignedNames = (caseData.assignedAgents || []).filter((id) => id !== caseData.leadAgent).map((id) => AGENTS_DB.find((a) => a.id === id)?.name).filter(Boolean);
                return [
                  ["Client", clientDisplay],
                  cl && cl.contactName ? ["Contact", cl.contactName] : null,
                  cl && cl.email ? ["Email", cl.email] : null,
                  cl && cl.phone ? ["Phone", cl.phone] : null,
                  ["Subject", caseData.subject || "—"],
                  ["Type", caseData.type],
                  ["Priority", caseData.priority?.toUpperCase()],
                  leadName && !isSoloMode() ? ["Lead PI", leadName] : null,
                  assignedNames.length > 0 ? ["Also Assigned", assignedNames.join(", ")] : null,
                  ["Created", new Date(caseData.createdAt).toLocaleDateString()],
                ].filter(Boolean);
              })().map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 13 }}>
                  <span style={{ color: "#666" }}>{k}</span>
                  <span style={{ color: "#ddd", fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={styles.card}>
              <div style={{ fontSize: 11, color: "#666", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Description</div>
              <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>{caseData.description || "No description provided."}</div>
            </div>
          </div>

          {/* Case Rate Overrides */}
          <div style={{ marginTop: 16 }}>
            <CaseRateOverrides caseData={caseData} onUpdate={onUpdate} />
          </div>

          {/* Recent Updates */}
          {caseData.updates.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, color: "#666", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Recent Activity</div>
              {caseData.updates.slice(-5).reverse().map((u) => (
                <div key={u.id} style={{ padding: "10px 14px", borderLeft: u.system ? "2px solid #f90" : "2px solid #0f0", background: "rgba(255,255,255,0.01)", marginBottom: 4, borderRadius: "0 6px 6px 0" }}>
                  <div style={{ fontSize: 13, color: u.system ? "#f90" : "#ccc" }}>{u.text}</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 4, fontFamily: "'JetBrains Mono'" }}>{new Date(u.timestamp).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "updates" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <input style={{ ...styles.input, flex: 1 }} value={newUpdate} onChange={(e) => setNewUpdate(e.target.value)} placeholder="Add case update, observation, or note..." onKeyDown={(e) => e.key === "Enter" && addUpdate()} />
            <button style={styles.btn("primary")} onClick={addUpdate}>Add Update</button>
          </div>
          {caseData.updates.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#444" }}>No updates yet. Start documenting your investigation.</div>
          ) : (
            [...caseData.updates].reverse().map((u) => (
              <div key={u.id} style={{ padding: "14px 16px", borderLeft: u.system ? "2px solid #f90" : "2px solid rgba(0,255,0,0.3)", background: "rgba(255,255,255,0.015)", marginBottom: 6, borderRadius: "0 8px 8px 0" }}>
                <div style={{ fontSize: 13, color: u.system ? "#f90" : "#ddd", lineHeight: 1.5 }}>{u.text}</div>
                <div style={{ fontSize: 10, color: "#555", marginTop: 6, fontFamily: "'JetBrains Mono'" }}>{new Date(u.timestamp).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "documents" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <input style={{ ...styles.input, flex: 1 }} value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Document name (e.g. surveillance_photos_jan15.pdf)" onKeyDown={(e) => e.key === "Enter" && addDocument()} />
            <button style={styles.btn("primary")} onClick={addDocument}><Icon name="upload" size={12} /> Add Document</button>
          </div>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 16 }}>
            In production, this connects to file storage. Documents are analyzed by AI for investigative insights.
          </div>
          {caseData.documents.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#444", border: "2px dashed rgba(255,255,255,0.06)", borderRadius: 10 }}>
              <Icon name="doc" size={28} />
              <div style={{ marginTop: 8 }}>No documents uploaded. Drag files or add document references.</div>
            </div>
          ) : (
            caseData.documents.map((d) => (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon name="doc" size={16} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono'" }}>{d.type.toUpperCase()} • {d.size} • {new Date(d.uploadedAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "tracking" && (
        <div>
          <GPSTracker
            caseData={caseData}
            onMileageUpdate={(entry) => {
              caseData.mileageEntries = caseData.mileageEntries || [];
              caseData.mileageEntries.push(entry);
              caseData.updates.push({ text: `Mileage logged: ${entry.miles} mi (${Math.floor(entry.duration / 60)}m ${entry.duration % 60}s)`, timestamp: new Date().toISOString(), id: Date.now(), system: true });
              logAuditEvent("MILEAGE_LOGGED", caseData.id, { miles: entry.miles, duration: entry.duration, positions: entry.positions?.length || 0 });
              onUpdate({ ...caseData });
            }}
          />

          {/* Mileage History */}
          {caseData.mileageEntries && caseData.mileageEntries.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 12 }}>Mileage Log</div>
              <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 120px 80px", padding: "10px 16px", background: "rgba(255,255,255,0.02)", fontSize: 10, color: "#666", letterSpacing: 1, textTransform: "uppercase", fontWeight: 600 }}>
                  <span>Date & Time</span><span>Distance</span><span>Duration</span><span>Points</span>
                </div>
                {[...caseData.mileageEntries].reverse().map((e, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px 120px 80px", padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,0.03)", fontSize: 13 }}>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#aaa" }}>{new Date(e.timestamp).toLocaleString()}</span>
                    <span style={{ color: "#0f0", fontFamily: "'JetBrains Mono'", fontWeight: 600 }}>{e.miles} mi</span>
                    <span style={{ color: "#4af", fontFamily: "'JetBrains Mono'" }}>{Math.floor(e.duration / 60)}m {e.duration % 60}s</span>
                    <span style={{ color: "#666", fontFamily: "'JetBrains Mono'" }}>{e.positions?.length || 0}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 20, marginTop: 12, fontSize: 12, fontFamily: "'JetBrains Mono'" }}>
                <span style={{ color: "#666" }}>Total: <span style={{ color: "#0f0", fontWeight: 700 }}>{totalMiles.toFixed(2)} mi</span></span>
                <span style={{ color: "#666" }}>Time: <span style={{ color: "#4af", fontWeight: 700 }}>{(totalTime / 60).toFixed(1)}h</span></span>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "expenses" && <ExpensesPanel caseData={caseData} onUpdate={onUpdate} />}

      {tab === "media" && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Evidence Recording</div>
          <MediaRecorder
            onSave={(entry) => {
              caseData.recordings = caseData.recordings || [];
              const evidenceHash = quickHash(JSON.stringify(entry));
              entry.integrityHash = evidenceHash;
              entry.custodyChain = [{ action: "Recorded", actor: "Primary Investigator", timestamp: new Date().toISOString(), hash: evidenceHash }];
              caseData.recordings.push(entry);
              caseData.updates.push({ text: `${entry.type === "audio" ? "Audio" : "Video"} evidence recorded (${entry.size})`, timestamp: new Date().toISOString(), id: Date.now(), system: true });
              logAuditEvent("EVIDENCE_RECORDED", caseData.id, { type: entry.type, size: entry.size, integrityHash: evidenceHash });
              onUpdate({ ...caseData });
            }}
          />
        </div>
      )}

      {tab === "invoices" && <InvoicePanel caseData={caseData} onUpdate={onUpdate} />}

      {tab === "custody" && <ChainOfCustodyPanel caseData={caseData} />}

      {tab === "ai" && <AIPanel caseData={caseData} />}
    </div>
  );
}

// ─── Chain of Custody Panel (per case) ───
function ChainOfCustodyPanel({ caseData }) {
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [evidenceFilter, setEvidenceFilter] = useState("all");

  const caseAuditEntries = AUDIT_LOG.filter((e) => e.caseId === caseData.id);
  const evidenceItems = [
    ...(caseData.documents || []).map((d) => ({ ...d, evidenceType: "document" })),
    ...(caseData.recordings || []).map((r) => ({ ...r, evidenceType: "recording" })),
  ];

  const verifyChainIntegrity = () => {
    setVerifying(true);
    setTimeout(() => {
      let intact = true;
      const issues = [];

      // Verify audit chain hashes
      for (let i = 1; i < caseAuditEntries.length; i++) {
        const entry = caseAuditEntries[i];
        const prev = caseAuditEntries[i - 1];
        if (entry.prevHash !== prev.hash) {
          intact = false;
          issues.push(`Audit chain broken at ${entry.id}: expected prevHash ${prev.hash.substring(0, 12)}..., got ${entry.prevHash.substring(0, 12)}...`);
        }
      }

      // Verify evidence integrity hashes
      evidenceItems.forEach((item) => {
        if (item.integrityHash) {
          const recomputed = quickHash(item.evidenceType === "document" ? (item.name + item.id) : JSON.stringify({ id: item.id, type: item.type, duration: item.duration, size: item.size, timestamp: item.timestamp }));
          if (recomputed !== item.integrityHash) {
            intact = false;
            issues.push(`Evidence integrity hash mismatch on ${item.name || item.type + " recording"}`);
          }
        }
      });

      logAuditEvent(intact ? "INTEGRITY_CHECK" : "INTEGRITY_FAIL", caseData.id, { result: intact ? "PASS" : "FAIL", issues });
      setVerifyResult({ intact, issues, checkedAt: new Date().toISOString(), auditEntries: caseAuditEntries.length, evidenceItems: evidenceItems.length });
      setVerifying(false);
    }, 1200);
  };

  const filteredEvidence = evidenceFilter === "all" ? evidenceItems : evidenceItems.filter((e) => e.evidenceType === evidenceFilter);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}><Icon name="chain" size={16} /> Chain of Custody</div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>Tamper-proof audit trail for evidence admissibility</div>
        </div>
        <button style={styles.btn("primary")} onClick={verifyChainIntegrity} disabled={verifying}>
          <Icon name="shield" size={14} /> {verifying ? "Verifying..." : "Verify Integrity"}
        </button>
      </div>

      {/* Security Status Banner */}
      <div style={{ background: "rgba(0,255,0,0.04)", border: "1px solid rgba(0,255,0,0.12)", borderRadius: 10, padding: 16, marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(0,255,0,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name="shield" size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f0", letterSpacing: 0.5 }}>Evidence Chain Secured</div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
            All actions are cryptographically hashed and chained. Each entry references the previous hash to detect any tampering.
            Session: <span style={{ fontFamily: "'JetBrains Mono'", color: "#555" }}>{window.__cvSessionId}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 700, color: "#0f0" }}>{caseAuditEntries.length}</div>
          <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>AUDIT ENTRIES</div>
        </div>
      </div>

      {/* Verification Result */}
      {verifyResult && (
        <div style={{ background: verifyResult.intact ? "rgba(0,255,0,0.04)" : "rgba(255,68,68,0.06)", border: `1px solid ${verifyResult.intact ? "rgba(0,255,0,0.15)" : "rgba(255,68,68,0.2)"}`, borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Icon name={verifyResult.intact ? "verified" : "broken"} size={18} />
            <span style={{ fontSize: 14, fontWeight: 700, color: verifyResult.intact ? "#0f0" : "#f44" }}>
              {verifyResult.intact ? "INTEGRITY VERIFIED — Chain is intact" : "INTEGRITY FAILURE — Tampering detected"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#888", fontFamily: "'JetBrains Mono'" }}>
            Checked {verifyResult.auditEntries} audit entries and {verifyResult.evidenceItems} evidence items at {new Date(verifyResult.checkedAt).toLocaleString()}
          </div>
          {verifyResult.issues.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {verifyResult.issues.map((issue, i) => (
                <div key={i} style={{ fontSize: 11, color: "#f44", padding: "4px 0", fontFamily: "'JetBrains Mono'" }}>⚠ {issue}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Evidence Items with Custody Chains */}
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f0", marginBottom: 12, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono'" }}>
        Evidence Items ({evidenceItems.length})
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["all", "document", "recording"].map((f) => (
          <button key={f} style={{ ...styles.btn(evidenceFilter === f ? "primary" : ""), fontSize: 11, padding: "5px 10px" }} onClick={() => setEvidenceFilter(f)}>
            {f === "all" ? "All" : f === "document" ? "Documents" : "Recordings"}
          </button>
        ))}
      </div>

      {filteredEvidence.length === 0 ? (
        <div style={{ textAlign: "center", padding: 32, color: "#444", fontSize: 13 }}>No evidence items to show.</div>
      ) : (
        filteredEvidence.map((item) => (
          <div key={item.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Icon name={item.evidenceType === "document" ? "doc" : item.type === "audio" ? "mic" : "cam"} size={16} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#ddd" }}>{item.name || `${item.type} Recording`}</div>
                  <div style={{ fontSize: 11, color: "#666", fontFamily: "'JetBrains Mono'" }}>
                    {item.evidenceType === "document" ? `${item.type?.toUpperCase()} • ${item.size}` : `${item.size} • ${item.type}`}
                  </div>
                </div>
              </div>
              {item.integrityHash && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 2 }}>SHA-256 HASH</div>
                  <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 10, color: "#0f0", wordBreak: "break-all", maxWidth: 200 }}>
                    {item.integrityHash.substring(0, 32)}...
                  </div>
                </div>
              )}
            </div>

            {/* Custody Chain */}
            {item.custodyChain && item.custodyChain.length > 0 && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 10 }}>
                <div style={{ fontSize: 10, color: "#666", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>CUSTODY CHAIN</div>
                {item.custodyChain.map((step, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#0f0", flexShrink: 0 }} />
                    <div style={{ width: 1, height: i < item.custodyChain.length - 1 ? 16 : 0, background: "rgba(0,255,0,0.2)", position: "absolute", marginTop: 18, marginLeft: 3 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, color: "#ddd", fontWeight: 500 }}>{step.action}</span>
                      <span style={{ fontSize: 11, color: "#666" }}> by {step.actor}</span>
                    </div>
                    <span style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono'" }}>{new Date(step.timestamp).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}

      {/* Audit Trail for this case */}
      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0f0", marginBottom: 12, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono'" }}>
          Full Audit Trail ({caseAuditEntries.length} entries)
        </div>
        {caseAuditEntries.length === 0 ? (
          <div style={{ textAlign: "center", padding: 32, color: "#444", fontSize: 13 }}>No audit entries for this case yet.</div>
        ) : (
          <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
            {[...caseAuditEntries].reverse().map((entry, i) => {
              const typeInfo = AUDIT_TYPES[entry.type] || { label: entry.type, severity: "info", icon: "note" };
              const sevColor = SEVERITY_COLORS[typeInfo.severity] || SEVERITY_COLORS.info;
              return (
                <div key={entry.id} style={{ padding: "10px 16px", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.03)" : "none", display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: sevColor.dot, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: sevColor.text }}>{typeInfo.label}</span>
                      <span style={{ fontSize: 10, color: "#555" }}>by {entry.actor}</span>
                    </div>
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <div style={{ fontSize: 11, color: "#666", marginTop: 2, fontFamily: "'JetBrains Mono'" }}>
                        {Object.entries(entry.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" • ")}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono'" }}>{new Date(entry.timestamp).toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: "#444", fontFamily: "'JetBrains Mono'" }}>{entry.id}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hash Chain Visualization */}
      {caseAuditEntries.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, color: "#555", letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>HASH CHAIN (latest 5)</div>
          {caseAuditEntries.slice(-5).reverse().map((entry, i) => (
            <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#555", minWidth: 80 }}>{entry.id}</div>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#0f0", letterSpacing: 0.5 }}>{entry.hash.substring(0, 24)}...</div>
              {i < 4 && <span style={{ fontSize: 10, color: "#333" }}>←</span>}
              {i < 4 && <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#444" }}>{entry.prevHash.substring(0, 16)}...</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Team / Agent Management ───
function TeamPage({ onRefresh }) {
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentForm, setAgentForm] = useState({ name: "", email: "", phone: "", role: "investigator", licenseNumber: "", specialties: "" });

  const addAgent = () => {
    if (!agentForm.name) return alert("Name is required");
    const agent = {
      id: `AGT-${String(++AGENT_COUNTER).padStart(3, "0")}`,
      ...agentForm,
      specialties: agentForm.specialties ? agentForm.specialties.split(",").map((s) => s.trim()) : [],
      status: "active",
      createdAt: new Date().toISOString(),
    };
    AGENTS_DB.push(agent);
    logAuditEvent("CASE_CREATED", null, { action: "Agent added", agentName: agent.name, role: agent.role });
    setShowAddAgent(false);
    setAgentForm({ name: "", email: "", phone: "", role: "investigator", licenseNumber: "", specialties: "" });
    onRefresh();
  };

  const toggleAgentStatus = (agent) => {
    agent.status = agent.status === "active" ? "inactive" : "active";
    onRefresh();
  };

  const switchToAgent = (agent) => {
    setCurrentUser(agent);
    onRefresh();
  };

  // Agent Detail
  if (selectedAgent) {
    const agentCases = CASES_DB.filter((c) => c.leadAgent === selectedAgent.id || (c.assignedAgents || []).includes(selectedAgent.id));
    const asLead = CASES_DB.filter((c) => c.leadAgent === selectedAgent.id);
    const totalMiles = agentCases.reduce((s, c) => s + (c.mileageEntries?.reduce((ms, e) => ms + e.miles, 0) || 0), 0);
    const agentAudits = AUDIT_LOG.filter((a) => a.actorId === selectedAgent.id);

    return (
      <div>
        <button style={{ ...styles.btn(), padding: "6px 12px", marginBottom: 16 }} onClick={() => setSelectedAgent(null)}>← Back to Team</button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#555" }}>{selectedAgent.id}</span>
              <span style={{ ...styles.badge({ bg: AGENT_ROLES[selectedAgent.role]?.color || "#888", text: "#000", label: AGENT_ROLES[selectedAgent.role]?.label || selectedAgent.role }) }}>
                {AGENT_ROLES[selectedAgent.role]?.label || selectedAgent.role}
              </span>
              {selectedAgent.status === "inactive" && <span style={styles.badge({ bg: "#666", text: "#fff", label: "INACTIVE" })}>INACTIVE</span>}
              {CURRENT_USER?.id === selectedAgent.id && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "rgba(0,255,0,0.1)", color: "#0f0" }}>CURRENT USER</span>}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#fff" }}>{selectedAgent.name}</div>
            {selectedAgent.licenseNumber && <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>License: {selectedAgent.licenseNumber}</div>}
          </div>
        </div>

        <div className="cv-stats" style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <StatCard value={agentCases.length} label="Total Cases" icon="cases" />
          <StatCard value={asLead.length} label="As Lead PI" icon="assign" />
          <StatCard value={agentCases.filter((c) => c.status === "active").length} label="Active" icon="play" />
          <StatCard value={`${totalMiles.toFixed(1)}`} label="Total Miles" icon="car" />
          <StatCard value={agentAudits.length} label="Audit Events" icon="shield" />
        </div>

        <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div style={styles.card}>
            <div style={{ fontSize: 11, color: "#666", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Contact</div>
            {[
              ["Email", selectedAgent.email || "—"],
              ["Phone", selectedAgent.phone || "—"],
              ["License #", selectedAgent.licenseNumber || "—"],
              ["Specialties", selectedAgent.specialties?.join(", ") || "—"],
              ["Since", new Date(selectedAgent.createdAt).toLocaleDateString()],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 13 }}>
                <span style={{ color: "#666" }}>{k}</span>
                <span style={{ color: "#ddd", fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={styles.card}>
            <div style={{ fontSize: 11, color: "#666", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Permissions</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(AGENT_ROLES[selectedAgent.role]?.permissions || []).map((p) => (
                <span key={p} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "rgba(0,255,0,0.06)", color: "#0f0", fontFamily: "'JetBrains Mono'" }}>{p}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Cases assigned */}
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0f0", marginBottom: 12, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono'" }}>
          Assigned Cases ({agentCases.length})
        </div>
        {agentCases.map((c) => (
          <div key={c.id} style={{ ...styles.card, cursor: "default" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#555" }}>{c.id}</span>
                  <span style={styles.badge(STATUS_COLORS[c.status])}>{STATUS_COLORS[c.status].label}</span>
                  {c.leadAgent === selectedAgent.id && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "rgba(240,208,0,0.12)", color: "#f0d000", fontWeight: 600 }}>LEAD</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{c.title}</div>
              </div>
              <div style={{ fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono'" }}>{c.client}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="cv-header" style={styles.header}>
        <div>
          <div style={styles.pageTitle}>Team</div>
          <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
            {AGENTS_DB.length} agent{AGENTS_DB.length !== 1 ? "s" : ""} • Logged in as: <span style={{ color: "#0f0", fontWeight: 600 }}>{CURRENT_USER?.name}</span>
            <span style={{ color: "#555" }}> ({AGENT_ROLES[CURRENT_USER?.role]?.label})</span>
          </div>
        </div>
        {hasPermission("manage_agents") && (
          <button style={styles.btn("primary")} onClick={() => setShowAddAgent(true)}><Icon name="add" size={14} /> Add Agent</button>
        )}
      </div>

      {/* Current User Card */}
      <div style={{ background: "rgba(0,255,0,0.04)", border: "1px solid rgba(0,255,0,0.12)", borderRadius: 10, padding: 16, marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(0,255,0,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="crown" size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f0" }}>Active Session: {CURRENT_USER?.name}</div>
          <div style={{ fontSize: 11, color: "#888" }}>{AGENT_ROLES[CURRENT_USER?.role]?.label} • {CURRENT_USER?.id} • Session {window.__cvSessionId?.substring(0, 12)}</div>
        </div>
      </div>

      {/* Add Agent Form */}
      {showAddAgent && (
        <div style={{ background: "rgba(0,255,0,0.03)", border: "1px solid rgba(0,255,0,0.12)", borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f0", marginBottom: 14, fontFamily: "'JetBrains Mono'", letterSpacing: 1 }}>ADD TEAM MEMBER</div>
          <div style={{ display: "grid", gap: 12 }}>
            <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>FULL NAME *</label>
                <input style={styles.input} value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} placeholder="e.g. John Davis" />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>ROLE</label>
                <select style={styles.select} value={agentForm.role} onChange={(e) => setAgentForm({ ...agentForm, role: e.target.value })}>
                  <option value="investigator">Investigator</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer / Read Only</option>
                </select>
              </div>
            </div>
            <div className="cv-grid3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>EMAIL</label>
                <input style={styles.input} value={agentForm.email} onChange={(e) => setAgentForm({ ...agentForm, email: e.target.value })} placeholder="email@agency.com" />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>PHONE</label>
                <input style={styles.input} value={agentForm.phone} onChange={(e) => setAgentForm({ ...agentForm, phone: e.target.value })} placeholder="(555) 123-4567" />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>PI LICENSE #</label>
                <input style={styles.input} value={agentForm.licenseNumber} onChange={(e) => setAgentForm({ ...agentForm, licenseNumber: e.target.value })} placeholder="State license #" />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>SPECIALTIES (comma-separated)</label>
              <input style={styles.input} value={agentForm.specialties} onChange={(e) => setAgentForm({ ...agentForm, specialties: e.target.value })} placeholder="e.g. Surveillance, Skip Trace, Background Checks" />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button style={styles.btn()} onClick={() => setShowAddAgent(false)}>Cancel</button>
            <button style={styles.btn("primary")} onClick={addAgent}><Icon name="add" size={12} /> Add Agent</button>
          </div>
        </div>
      )}

      {/* Agent List */}
      {AGENTS_DB.map((agent) => {
        const caseCount = CASES_DB.filter((c) => c.leadAgent === agent.id || (c.assignedAgents || []).includes(agent.id)).length;
        const activeCases = CASES_DB.filter((c) => (c.leadAgent === agent.id || (c.assignedAgents || []).includes(agent.id)) && c.status === "active").length;
        const isCurrent = CURRENT_USER?.id === agent.id;
        const roleInfo = AGENT_ROLES[agent.role] || AGENT_ROLES.investigator;

        return (
          <div key={agent.id} style={{ ...styles.card, borderColor: isCurrent ? "rgba(0,255,0,0.15)" : undefined }} onClick={() => setSelectedAgent(agent)}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,0,0.15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = isCurrent ? "rgba(0,255,0,0.15)" : "rgba(255,255,255,0.06)"; }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Icon name={agent.role === "owner" ? "crown" : "user"} size={14} />
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#555" }}>{agent.id}</span>
                  <span style={{ ...styles.badge({ bg: roleInfo.color, text: "#000", label: roleInfo.label }) }}>{roleInfo.label}</span>
                  {agent.status === "inactive" && <span style={styles.badge({ bg: "#666", text: "#fff", label: "INACTIVE" })}>INACTIVE</span>}
                  {isCurrent && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "rgba(0,255,0,0.1)", color: "#0f0", fontWeight: 600 }}>YOU</span>}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{agent.name}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                  {agent.email || "No email"}{agent.licenseNumber ? ` • Lic: ${agent.licenseNumber}` : ""}
                  {agent.specialties?.length > 0 ? ` • ${agent.specialties.join(", ")}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: caseCount > 0 ? "#0f0" : "#555", fontFamily: "'JetBrains Mono'" }}>
                  {caseCount} case{caseCount !== 1 ? "s" : ""}{activeCases > 0 ? ` (${activeCases} active)` : ""}
                </div>
                <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  {!isCurrent && agent.status === "active" && (
                    <button style={{ ...styles.btn(), fontSize: 10, padding: "3px 8px" }} onClick={() => switchToAgent(agent)} title="Switch to this user">
                      <Icon name="switch_user" size={10} /> Switch
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Settings / Agency Rates Page ───
function SettingsPage({ onRefresh }) {
  const [settings, setSettings] = useState({ ...AGENCY_SETTINGS });
  const [saved, setSaved] = useState(false);

  const saveSettings = () => {
    Object.assign(AGENCY_SETTINGS, settings);
    logAuditEvent("CASE_STATUS", null, { action: "Agency settings updated" });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onRefresh();
  };

  const rateFields = [
    { key: "hourly", label: "Standard Hourly Rate", unit: "$/hr", desc: "Default rate for investigative services" },
    { key: "mileage", label: "Mileage Rate", unit: "$/mile", desc: "Per-mile reimbursement (IRS rate 2024: $0.67)", step: "0.001" },
    { key: "retainer", label: "Default Retainer Fee", unit: "$", desc: "Upfront retainer charged to new clients" },
    { key: "perDiem", label: "Per Diem (daily)", unit: "$/day", desc: "Daily flat rate for extended surveillance or travel" },
    { key: "rushSurcharge", label: "Rush Surcharge Multiplier", unit: "×", desc: "Rate multiplier for rush/urgent cases (e.g. 1.5 = 150%)", step: "0.1" },
    { key: "overnightSurveillance", label: "Overnight Surveillance", unit: "$/hr", desc: "Hourly rate for overnight or after-hours surveillance" },
    { key: "courtTestimony", label: "Court Testimony", unit: "$/hr", desc: "Hourly rate for court appearances and depositions" },
    { key: "databaseSearch", label: "Database / Records Search", unit: "$/search", desc: "Flat fee per database or records search" },
    { key: "photographyVideo", label: "Photography / Video", unit: "$/hr", desc: "Hourly rate for photo/video documentation services" },
    { key: "adminClerical", label: "Admin / Clerical", unit: "$/hr", desc: "Hourly rate for report writing, filing, admin work" },
  ];

  return (
    <div>
      <div className="cv-header" style={styles.header}>
        <div>
          <div style={styles.pageTitle}>Settings</div>
          <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>Agency defaults & billing rate configuration</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {saved && <span style={{ fontSize: 12, color: "#0f0", fontWeight: 600 }}>✓ Saved</span>}
          <button style={styles.btn("primary")} onClick={saveSettings}>
            <Icon name="check" size={12} /> Save Settings
          </button>
        </div>
      </div>

      {/* Agency Info */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 14, letterSpacing: 0.5 }}>Agency Information</div>
        <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>AGENCY NAME</label>
            <input style={styles.input} value={settings.agencyName} onChange={(e) => setSettings({ ...settings, agencyName: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>PI LICENSE #</label>
            <input style={styles.input} value={settings.agencyLicense} onChange={(e) => setSettings({ ...settings, agencyLicense: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>PHONE</label>
            <input style={styles.input} value={settings.agencyPhone} onChange={(e) => setSettings({ ...settings, agencyPhone: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>EMAIL</label>
            <input style={styles.input} value={settings.agencyEmail} onChange={(e) => setSettings({ ...settings, agencyEmail: e.target.value })} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>ADDRESS</label>
            <input style={styles.input} value={settings.agencyAddress} onChange={(e) => setSettings({ ...settings, agencyAddress: e.target.value })} />
          </div>
        </div>
        <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>DEFAULT PAYMENT TERMS</label>
            <select style={styles.select} value={settings.defaultTerms} onChange={(e) => setSettings({ ...settings, defaultTerms: e.target.value })}>
              <option value="Due on Receipt">Due on Receipt</option>
              <option value="Net 7">Net 7</option>
              <option value="Net 15">Net 15</option>
              <option value="Net 30">Net 30</option>
              <option value="Net 60">Net 60</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>MILEAGE TRACKING METHOD</label>
            <select style={styles.select} value={settings.mileageMethod} onChange={(e) => setSettings({ ...settings, mileageMethod: e.target.value })}>
              <option value="gps">GPS Auto-Track</option>
              <option value="manual">Manual Entry</option>
            </select>
          </div>
        </div>
      </div>

      {/* Rate Cascade Explanation */}
      <div style={{ background: "rgba(0,255,0,0.03)", border: "1px solid rgba(0,255,0,0.1)", borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Icon name="cascade" size={14} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0f0" }}>Rate Cascade</span>
        </div>
        <div style={{ fontSize: 12, color: "#888", lineHeight: 1.6 }}>
          Rates flow through three levels. When creating an invoice, the system checks each level in order and uses the first one it finds:
        </div>
        <div className="cv-cascade" style={{ display: "flex", gap: 12, marginTop: 10 }}>
          <div style={{ flex: 1, padding: "8px 12px", background: "rgba(255,153,0,0.06)", borderRadius: 6, borderLeft: "3px solid #f90" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#f90", letterSpacing: 1, marginBottom: 2 }}>1. CASE OVERRIDE</div>
            <div style={{ fontSize: 11, color: "#888" }}>Set per-case on the Overview tab. Use for negotiated or special rates.</div>
          </div>
          <div style={{ flex: 1, padding: "8px 12px", background: "rgba(74,170,255,0.06)", borderRadius: 6, borderLeft: "3px solid #4af" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#4af", letterSpacing: 1, marginBottom: 2 }}>2. CLIENT RATE</div>
            <div style={{ fontSize: 11, color: "#888" }}>Set on the Client profile. Good for attorneys with standing agreements.</div>
          </div>
          <div style={{ flex: 1, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 6, borderLeft: "3px solid #666" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: 1, marginBottom: 2 }}>3. AGENCY DEFAULT</div>
            <div style={{ fontSize: 11, color: "#888" }}>The rates you set here. Used when nothing else is specified.</div>
          </div>
        </div>
      </div>

      {/* Default Rates Grid */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 16, letterSpacing: 0.5 }}>Default Billing Rates</div>
        <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {rateFields.map((field) => (
            <div key={field.key} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#ddd" }}>{field.label}</div>
                  <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{field.desc}</div>
                </div>
                <span style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono'", whiteSpace: "nowrap" }}>{field.unit}</span>
              </div>
              <input
                type="number"
                step={field.step || "1"}
                style={{ ...styles.input, fontFamily: "'JetBrains Mono'", fontWeight: 600 }}
                value={settings.rates[field.key]}
                onChange={(e) => setSettings({ ...settings, rates: { ...settings.rates, [field.key]: parseFloat(e.target.value) || 0 } })}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Global Audit Log Page ───
function AuditLogPage({ cases }) {
  const [filter, setFilter] = useState("all");
  const [caseFilter, setCaseFilter] = useState("all");

  const filtered = AUDIT_LOG.filter((e) => {
    if (filter !== "all") {
      const typeInfo = AUDIT_TYPES[e.type];
      if (typeInfo && typeInfo.severity !== filter) return false;
    }
    if (caseFilter !== "all" && e.caseId !== caseFilter) return false;
    return true;
  });

  // Chain integrity check
  let chainIntact = true;
  for (let i = 1; i < AUDIT_LOG.length; i++) {
    if (AUDIT_LOG[i].prevHash !== AUDIT_LOG[i - 1].hash) {
      chainIntact = false;
      break;
    }
  }

  const uniqueCases = [...new Set(AUDIT_LOG.filter((e) => e.caseId).map((e) => e.caseId))];

  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Audit Log</div>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>Immutable, hash-chained record of all system activity</div>

      {/* Security Status */}
      <div className="cv-stats" style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ ...styles.stat, borderColor: chainIntact ? "rgba(0,255,0,0.15)" : "rgba(255,68,68,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name={chainIntact ? "verified" : "broken"} size={20} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: chainIntact ? "#0f0" : "#f44" }}>
                {chainIntact ? "Chain Intact" : "Chain Broken"}
              </div>
              <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>HASH CHAIN STATUS</div>
            </div>
          </div>
        </div>
        <StatCard value={AUDIT_LOG.length} label="Total Events" icon="audit" />
        <StatCard value={AUDIT_LOG.filter((e) => AUDIT_TYPES[e.type]?.severity === "critical").length} label="Critical Events" icon="alert" />
        <StatCard value={window.__cvSessionId?.substring(0, 12) || "—"} label="Session ID" icon="fingerprint" />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>SEVERITY:</span>
        {["all", "info", "warning", "critical"].map((f) => (
          <button key={f} style={{ ...styles.btn(filter === f ? "primary" : ""), fontSize: 11, padding: "5px 10px" }} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.06)", margin: "0 8px" }} />
        <span style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>CASE:</span>
        <button style={{ ...styles.btn(caseFilter === "all" ? "primary" : ""), fontSize: 11, padding: "5px 10px" }} onClick={() => setCaseFilter("all")}>All</button>
        {uniqueCases.map((cId) => (
          <button key={cId} style={{ ...styles.btn(caseFilter === cId ? "primary" : ""), fontSize: 11, padding: "5px 10px" }} onClick={() => setCaseFilter(cId)}>
            {cId}
          </button>
        ))}
      </div>

      {/* Log Entries */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#444" }}>No audit events match your filters.</div>
      ) : (
        <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
          {[...filtered].reverse().map((entry, i) => {
            const typeInfo = AUDIT_TYPES[entry.type] || { label: entry.type, severity: "info", icon: "note" };
            const sevColor = SEVERITY_COLORS[typeInfo.severity] || SEVERITY_COLORS.info;
            return (
              <div key={entry.id} style={{ padding: "12px 16px", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.03)" : "none", background: typeInfo.severity === "critical" ? "rgba(255,68,68,0.02)" : "transparent" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: sevColor.dot, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: sevColor.text }}>{typeInfo.label}</span>
                      {entry.caseId && (
                        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(255,255,255,0.04)", color: "#888", fontFamily: "'JetBrains Mono'" }}>{entry.caseId}</span>
                      )}
                      <span style={{ fontSize: 10, color: "#555" }}>by {entry.actor}</span>
                    </div>
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <div style={{ fontSize: 11, color: "#666", marginTop: 3, fontFamily: "'JetBrains Mono'", lineHeight: 1.4 }}>
                        {Object.entries(entry.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" | ")}
                      </div>
                    )}
                    <div style={{ fontSize: 9, color: "#444", marginTop: 3, fontFamily: "'JetBrains Mono'" }}>
                      Hash: {entry.hash.substring(0, 32)}... ← Prev: {entry.prevHash.substring(0, 16)}...
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono'" }}>{new Date(entry.timestamp).toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: "#444", fontFamily: "'JetBrains Mono'" }}>{entry.id}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ───
function Dashboard({ cases, onSelectCase }) {
  const activeCases = cases.filter((c) => c.status === "active").length;
  const pausedCases = cases.filter((c) => c.status === "paused").length;
  const totalMiles = cases.reduce((s, c) => s + (c.mileageEntries?.reduce((ms, e) => ms + e.miles, 0) || 0), 0);
  const totalOutstanding = INVOICES_DB.filter((i) => i.status !== "paid").reduce((s, i) => s + i.total, 0);

  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Dashboard</div>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>Investigation overview and status</div>

      <div className="cv-stats" style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
        <StatCard value={cases.length} label="Total Cases" icon="cases" />
        <StatCard value={activeCases} label="Active" icon="play" />
        <StatCard value={CLIENTS_DB.length} label="Clients" icon="clients" />
        <StatCard value={`$${totalOutstanding.toFixed(0)}`} label="Outstanding" icon="invoice" />
        <StatCard value={`${totalMiles.toFixed(1)}`} label="Total Miles" icon="car" />
      </div>

      {/* Active Cases */}
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f0", marginBottom: 12, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono'" }}>
        Active Investigations
      </div>
      {cases.filter((c) => c.status === "active").length === 0 ? (
        <div style={{ textAlign: "center", padding: 32, color: "#444", fontSize: 13 }}>No active cases. Create a new investigation to get started.</div>
      ) : (
        cases.filter((c) => c.status === "active").map((c) => (
          <div key={c.id} style={styles.card} onClick={() => onSelectCase(c)} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,0,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#555" }}>{c.id}</span>
                  <span style={styles.badge(STATUS_COLORS[c.status])}>{STATUS_COLORS[c.status].label}</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "rgba(255,255,255,0.04)", color: "#888" }}>{c.type}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{c.title}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Client: {c.client} {c.subject && `• Subject: ${c.subject}`}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono'" }}>
                  {(c.mileageEntries?.reduce((s, e) => s + e.miles, 0) || 0).toFixed(1)} mi
                </div>
                <div style={{ fontSize: 11, color: "#555" }}>{c.updates.length} updates</div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Cases List ───
function CasesList({ cases, onSelectCase, onNewCase }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");

  const filtered = cases.filter((c) => {
    if (filter !== "all" && c.status !== filter) return false;
    if (agentFilter !== "all" && c.leadAgent !== agentFilter && !(c.assignedAgents || []).includes(agentFilter)) return false;
    if (search && !c.title.toLowerCase().includes(search.toLowerCase()) && !c.client.toLowerCase().includes(search.toLowerCase()) && !c.id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="cv-header" style={styles.header}>
        <div>
          <div style={styles.pageTitle}>Cases</div>
          <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>{cases.length} total investigations</div>
        </div>
        <button style={styles.btn("primary")} onClick={onNewCase}><Icon name="add" size={14} /> New Case</button>
      </div>

      <div className="cv-filters" style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <input style={{ ...styles.input, paddingLeft: 36 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cases..." />
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}><Icon name="search" size={14} /></span>
        </div>
        {["all", "active", "paused", "completed"].map((f) => (
          <button key={f} style={{ ...styles.btn(filter === f ? "primary" : ""), fontSize: 12, padding: "8px 14px" }} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        {!isSoloMode() && (
          <>
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.06)" }} />
            <select style={{ ...styles.select, width: "auto", padding: "8px 12px", fontSize: 12 }} value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
              <option value="all">All PIs</option>
              {AGENTS_DB.filter((a) => a.status === "active").map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.id === CURRENT_USER?.id ? " (You)" : ""}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {filtered.map((c) => {
        const leadAgent = AGENTS_DB.find((a) => a.id === c.leadAgent);
        return (
          <div key={c.id} style={styles.card} onClick={() => onSelectCase(c)} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,0,0.15)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#555" }}>{c.id}</span>
                  <span style={styles.badge(STATUS_COLORS[c.status])}>{STATUS_COLORS[c.status].label}</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "rgba(255,255,255,0.04)", color: "#888" }}>{c.type}</span>
                  {!isSoloMode() && leadAgent && (
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "rgba(0,255,0,0.06)", color: "#0f0" }}>
                      <Icon name="user" size={9} /> {leadAgent.name}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{c.title}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  Client: {c.client} {c.subject && `• Subject: ${c.subject}`}
                  {!isSoloMode() && (c.assignedAgents || []).length > 1 && ` • ${(c.assignedAgents || []).length} PIs assigned`}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono'" }}>
                <div>{new Date(c.createdAt).toLocaleDateString()}</div>
                <div>{c.updates.length} updates • {c.documents.length} docs</div>
                <div>{(c.mileageEntries?.reduce((s, e) => s + e.miles, 0) || 0).toFixed(1)} mi</div>
              </div>
            </div>
          </div>
        );
      })}
      {filtered.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#444" }}>No cases match your filters.</div>}
    </div>
  );
}

// ─── Client Management ───
function NewClientModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    name: "", type: "Individual", company: "", contactName: "",
    email: "", phone: "", address: "", city: "", state: "", zip: "",
    notes: "", defaultHourlyRate: 85, defaultMileageRate: 0.655,
    status: "active",
  });

  const save = () => {
    if (!form.name) return alert("Client name is required");
    const newClient = {
      id: `CL-${++CLIENT_COUNTER}`,
      ...form,
      createdAt: new Date().toISOString(),
    };
    CLIENTS_DB.push(newClient);
    persistAll();
    onSave(newClient);
    onClose();
  };

  const isOrg = ["Attorney", "Law Firm", "Insurance Company", "Corporation", "Government Agency"].includes(form.type);

  return (
    <div style={styles.modal} onClick={onClose}>
      <div style={{ ...styles.modalContent, maxWidth: 650 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 4 }}>New Client</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 24 }}>Add a client to link cases and invoices</div>

        <div style={{ display: "grid", gap: 16 }}>
          <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Client Type</label>
              <select style={styles.select} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {CLIENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Status</label>
              <select style={styles.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="vip">VIP</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
              {isOrg ? "Firm / Company Name *" : "Client Name *"}
            </label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={isOrg ? "e.g. Davis & Associates, LLP" : "e.g. John Smith"} />
          </div>

          {isOrg && (
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Primary Contact Name</label>
              <input style={styles.input} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="e.g. Attorney Jane Davis" />
            </div>
          )}

          <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Email</label>
              <input type="email" style={styles.input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Phone</label>
              <input style={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(555) 123-4567" />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Address</label>
            <input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>City</label>
              <input style={styles.input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>State</label>
              <input style={styles.input} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Zip</label>
              <input style={styles.input} value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
            </div>
          </div>

          <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Default Hourly Rate ($)</label>
              <input type="number" style={styles.input} value={form.defaultHourlyRate} onChange={(e) => setForm({ ...form, defaultHourlyRate: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Default Mileage Rate ($/mi)</label>
              <input type="number" step="0.001" style={styles.input} value={form.defaultMileageRate} onChange={(e) => setForm({ ...form, defaultMileageRate: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Notes</label>
            <textarea style={styles.textarea} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Billing preferences, referral source, special instructions..." />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <button style={styles.btn()} onClick={onClose}>Cancel</button>
          <button style={styles.btn("primary")} onClick={save}><Icon name="add" size={12} /> Add Client</button>
        </div>
      </div>
    </div>
  );
}

function ClientDetail({ client, cases, onBack, onSelectCase, onUpdateClient }) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ ...client });

  const clientCases = cases.filter((c) => c.clientId === client.id);
  const clientInvoices = INVOICES_DB.filter((i) => i.clientId === client.id);
  const totalBilled = clientInvoices.reduce((s, i) => s + i.total, 0);
  const totalPaid = clientInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0);
  const totalOutstanding = totalBilled - totalPaid;
  const totalMiles = clientCases.reduce((s, c) => s + (c.mileageEntries?.reduce((ms, e) => ms + e.miles, 0) || 0), 0);
  const isOrg = ["Attorney", "Law Firm", "Insurance Company", "Corporation", "Government Agency"].includes(client.type);

  const saveEdit = () => {
    Object.assign(client, editForm);
    const idx = CLIENTS_DB.findIndex((c) => c.id === client.id);
    if (idx >= 0) CLIENTS_DB[idx] = client;
    onUpdateClient(client);
    setEditing(false);
  };

  return (
    <div>
      <button style={{ ...styles.btn(), padding: "6px 12px", marginBottom: 16 }} onClick={onBack}>← Back to Clients</button>

      {/* Client Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#555" }}>{client.id}</span>
            <span style={styles.badge(CLIENT_STATUS_COLORS[client.status] || CLIENT_STATUS_COLORS.active)}>
              {(CLIENT_STATUS_COLORS[client.status] || CLIENT_STATUS_COLORS.active).label}
            </span>
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "rgba(255,255,255,0.04)", color: "#888" }}>{client.type}</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#fff" }}>{client.name}</div>
          {isOrg && client.contactName && <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Contact: {client.contactName}</div>}
        </div>
        <button style={styles.btn()} onClick={() => { setEditForm({ ...client }); setEditing(!editing); }}>
          <Icon name="edit" size={12} /> {editing ? "Cancel" : "Edit"}
        </button>
      </div>

      {/* Edit Form */}
      {editing && (
        <div style={{ background: "rgba(0,255,0,0.03)", border: "1px solid rgba(0,255,0,0.1)", borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f0", marginBottom: 14, letterSpacing: 1, fontFamily: "'JetBrains Mono'" }}>EDIT CLIENT</div>
          <div style={{ display: "grid", gap: 12 }}>
            <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>NAME</label>
                <input style={styles.input} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>CONTACT</label>
                <input style={styles.input} value={editForm.contactName} onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })} />
              </div>
            </div>
            <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>EMAIL</label>
                <input style={styles.input} value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>PHONE</label>
                <input style={styles.input} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              </div>
            </div>
            <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>HOURLY RATE ($)</label>
                <input type="number" style={styles.input} value={editForm.defaultHourlyRate} onChange={(e) => setEditForm({ ...editForm, defaultHourlyRate: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>MILEAGE RATE ($/mi)</label>
                <input type="number" step="0.001" style={styles.input} value={editForm.defaultMileageRate} onChange={(e) => setEditForm({ ...editForm, defaultMileageRate: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#888", letterSpacing: 1, display: "block", marginBottom: 4 }}>NOTES</label>
              <textarea style={styles.textarea} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button style={styles.btn()} onClick={() => setEditing(false)}>Cancel</button>
            <button style={styles.btn("primary")} onClick={saveEdit}><Icon name="check" size={12} /> Save Changes</button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <StatCard value={clientCases.length} label="Total Cases" icon="cases" />
        <StatCard value={clientCases.filter((c) => c.status === "active").length} label="Active Cases" icon="play" />
        <StatCard value={`$${totalBilled.toFixed(0)}`} label="Total Billed" icon="invoice" />
        <StatCard value={`$${totalOutstanding.toFixed(0)}`} label="Outstanding" icon="alert" />
      </div>

      {/* Contact Info & Billing */}
      <div className="cv-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div style={styles.card}>
          <div style={{ fontSize: 11, color: "#666", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Contact Information</div>
          {[
            ["Email", client.email || "—"],
            ["Phone", client.phone || "—"],
            ["Address", [client.address, client.city, client.state, client.zip].filter(Boolean).join(", ") || "—"],
            ["Type", client.type],
            ["Since", new Date(client.createdAt).toLocaleDateString()],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 13 }}>
              <span style={{ color: "#666" }}>{k}</span>
              <span style={{ color: "#ddd", fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={styles.card}>
          <div style={{ fontSize: 11, color: "#666", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Billing Summary</div>
          {[
            ["Default Hourly", `$${client.defaultHourlyRate || 85}/hr`],
            ["Default Mileage", `$${client.defaultMileageRate || 0.655}/mi`],
            ["Total Invoices", clientInvoices.length],
            ["Paid", `$${totalPaid.toFixed(2)}`],
            ["Outstanding", `$${totalOutstanding.toFixed(2)}`],
            ["Total Mileage", `${totalMiles.toFixed(1)} mi`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 13 }}>
              <span style={{ color: "#666" }}>{k}</span>
              <span style={{ color: "#ddd", fontWeight: 500 }}>{v}</span>
            </div>
          ))}
          {client.notes && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(255,255,255,0.02)", borderRadius: 6, fontSize: 12, color: "#888", borderLeft: "2px solid rgba(0,255,0,0.2)" }}>
              {client.notes}
            </div>
          )}
        </div>
      </div>

      {/* Cases List */}
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f0", marginBottom: 12, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono'" }}>
        Cases ({clientCases.length})
      </div>
      {clientCases.length === 0 ? (
        <div style={{ textAlign: "center", padding: 32, color: "#444", fontSize: 13 }}>No cases linked to this client yet.</div>
      ) : (
        clientCases.map((c) => (
          <div key={c.id} style={styles.card} onClick={() => onSelectCase(c)} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,0,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#555" }}>{c.id}</span>
                  <span style={styles.badge(STATUS_COLORS[c.status])}>{STATUS_COLORS[c.status].label}</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "rgba(255,255,255,0.04)", color: "#888" }}>{c.type}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{c.title}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{c.subject && `Subject: ${c.subject} • `}{new Date(c.createdAt).toLocaleDateString()}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono'" }}>
                <div>{c.updates.length} updates</div>
                <div>{(c.mileageEntries?.reduce((s, e) => s + e.miles, 0) || 0).toFixed(1)} mi</div>
              </div>
            </div>
          </div>
        ))
      )}

      {/* Invoices */}
      {clientInvoices.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f0", marginBottom: 12, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono'" }}>
            Invoices ({clientInvoices.length})
          </div>
          {clientInvoices.map((inv) => (
            <div key={inv.id} style={{ ...styles.card, cursor: "default" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#555" }}>{inv.id}</span>
                    <span style={styles.badge(INVOICE_STATUS_COLORS[inv.status])}>{INVOICE_STATUS_COLORS[inv.status].label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>{inv.caseTitle} • {inv.terms}</div>
                </div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 700, color: inv.status === "paid" ? "#0f0" : "#fff" }}>
                  ${inv.total.toFixed(2)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientsPage({ cases, onSelectCase, onRefresh }) {
  const [showNewClient, setShowNewClient] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const clients = CLIENTS_DB.filter((cl) => {
    if (filter !== "all" && cl.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return cl.name.toLowerCase().includes(q) || cl.email?.toLowerCase().includes(q) || cl.id.toLowerCase().includes(q) || cl.type.toLowerCase().includes(q) || cl.contactName?.toLowerCase().includes(q);
    }
    return true;
  });

  if (selectedClient) {
    return (
      <ClientDetail
        client={selectedClient}
        cases={cases}
        onBack={() => setSelectedClient(null)}
        onSelectCase={onSelectCase}
        onUpdateClient={(updated) => { setSelectedClient({ ...updated }); onRefresh(); }}
      />
    );
  }

  return (
    <div>
      <div className="cv-header" style={styles.header}>
        <div>
          <div style={styles.pageTitle}>Clients</div>
          <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>{CLIENTS_DB.length} total clients</div>
        </div>
        <button style={styles.btn("primary")} onClick={() => setShowNewClient(true)}><Icon name="add" size={14} /> New Client</button>
      </div>

      <div className="cv-filters" style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input style={{ ...styles.input, paddingLeft: 36 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients..." />
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}><Icon name="search" size={14} /></span>
        </div>
        {["all", "active", "vip", "inactive"].map((f) => (
          <button key={f} style={{ ...styles.btn(filter === f ? "primary" : ""), fontSize: 12, padding: "8px 14px" }} onClick={() => setFilter(f)}>
            {f === "vip" ? "VIP" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {clients.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#444" }}>
          {CLIENTS_DB.length === 0 ? "No clients yet. Add your first client to start linking cases." : "No clients match your search."}
        </div>
      ) : (
        clients.map((cl) => {
          const caseCount = cases.filter((c) => c.clientId === cl.id).length;
          const activeCases = cases.filter((c) => c.clientId === cl.id && c.status === "active").length;
          const totalBilled = INVOICES_DB.filter((i) => i.clientId === cl.id).reduce((s, i) => s + i.total, 0);
          const isOrg = ["Attorney", "Law Firm", "Insurance Company", "Corporation", "Government Agency"].includes(cl.type);

          return (
            <div key={cl.id} style={styles.card} onClick={() => setSelectedClient(cl)} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,0,0.15)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <Icon name={isOrg ? "firm" : "client"} size={14} />
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#555" }}>{cl.id}</span>
                    <span style={styles.badge(CLIENT_STATUS_COLORS[cl.status] || CLIENT_STATUS_COLORS.active)}>
                      {(CLIENT_STATUS_COLORS[cl.status] || CLIENT_STATUS_COLORS.active).label}
                    </span>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "rgba(255,255,255,0.04)", color: "#888" }}>{cl.type}</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{cl.name}</div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                    {isOrg && cl.contactName ? `${cl.contactName} • ` : ""}
                    {cl.email || "No email"}{cl.phone ? ` • ${cl.phone}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: caseCount > 0 ? "#0f0" : "#555", fontFamily: "'JetBrains Mono'" }}>
                    {caseCount} case{caseCount !== 1 ? "s" : ""}
                  </div>
                  {activeCases > 0 && <div style={{ fontSize: 11, color: "#0f0" }}>{activeCases} active</div>}
                  {totalBilled > 0 && <div style={{ fontSize: 11, color: "#888", fontFamily: "'JetBrains Mono'" }}>${totalBilled.toFixed(0)} billed</div>}
                </div>
              </div>
            </div>
          );
        })
      )}

      {showNewClient && (
        <NewClientModal
          onClose={() => setShowNewClient(false)}
          onSave={(cl) => { setShowNewClient(false); setSelectedClient(cl); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ─── Global Invoices Page ───
function InvoicesPage({ cases, onSelectCase }) {
  const [filter, setFilter] = useState("all");
  const allInvoices = INVOICES_DB;

  const filtered = allInvoices.filter((inv) => {
    if (filter !== "all" && inv.status !== filter) return false;
    return true;
  });

  const totalOutstanding = allInvoices.filter((i) => i.status !== "paid").reduce((s, i) => s + i.total, 0);
  const totalPaid = allInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0);
  const totalAll = allInvoices.reduce((s, i) => s + i.total, 0);

  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Invoices</div>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>All invoices across cases</div>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <StatCard value={allInvoices.length} label="Total Invoices" icon="invoice" />
        <StatCard value={`$${totalOutstanding.toFixed(0)}`} label="Outstanding" icon="alert" />
        <StatCard value={`$${totalPaid.toFixed(0)}`} label="Paid" icon="check" />
        <StatCard value={`$${totalAll.toFixed(0)}`} label="Total Billed" icon="dollar" />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {["all", "draft", "sent", "paid", "overdue"].map((f) => (
          <button key={f} style={{ ...styles.btn(filter === f ? "primary" : ""), fontSize: 12, padding: "8px 14px" }} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#444" }}>
          {allInvoices.length === 0
            ? "No invoices yet. Create invoices from within a case's Invoices tab."
            : "No invoices match this filter."
          }
        </div>
      ) : (
        filtered.map((inv) => {
          const parentCase = cases.find((c) => c.id === inv.caseId);
          return (
            <div key={inv.id} style={styles.card} onClick={() => parentCase && onSelectCase(parentCase)} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,0,0.15)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#555" }}>{inv.id}</span>
                    <span style={styles.badge(INVOICE_STATUS_COLORS[inv.status])}>{INVOICE_STATUS_COLORS[inv.status].label}</span>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "rgba(255,255,255,0.04)", color: "#888" }}>{inv.caseId}</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{inv.client}</div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{inv.caseTitle} • {inv.lineItems.length} items • {inv.terms}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 700, color: inv.status === "paid" ? "#0f0" : "#fff" }}>${inv.total.toFixed(2)}</div>
                  <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono'" }}>
                    {inv.status === "paid" ? `Paid ${new Date(inv.paidAt).toLocaleDateString()}` : `Due ${new Date(inv.dueDate).toLocaleDateString()}`}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Responsive Hook ───
function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

// ─── Responsive Grid Helper ───
function ResponsiveGrid({ columns = "1fr 1fr", mobileColumns = "1fr", gap = 16, children, style = {} }) {
  const mobile = useIsMobile();
  return (
    <div style={{ display: "grid", gridTemplateColumns: mobile ? mobileColumns : columns, gap, ...style }}>
      {children}
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [cases, setCases] = useState(CASES_DB);
  const [selectedCase, setSelectedCase] = useState(null);
  const [showNewCase, setShowNewCase] = useState(false);
  const [time, setTime] = useState(new Date());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mobile = useIsMobile();

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshCases = () => { persistAll(); setCases([...CASES_DB]); };

  const navigate = (pageId) => {
    setPage(pageId);
    setSelectedCase(null);
    if (mobile) setSidebarOpen(false);
  };

  const navItems = [
    { id: "dashboard", icon: "dashboard", label: "Dashboard" },
    { id: "cases", icon: "cases", label: "Cases" },
    { id: "clients", icon: "clients", label: "Clients" },
    { id: "invoices", icon: "invoice", label: "Invoices" },
    ...(!isSoloMode() ? [{ id: "team", icon: "team", label: "Team" }] : []),
    { id: "audit", icon: "shield", label: "Audit Log" },
    { id: "settings", icon: "settings", label: "Settings" },
  ];

  // Bottom nav for mobile — quick access items
  const bottomNavItems = [
    { id: "dashboard", icon: "dashboard", label: "Home" },
    { id: "cases", icon: "cases", label: "Cases" },
    { id: "clients", icon: "clients", label: "Clients" },
    { id: "invoices", icon: "invoice", label: "Invoices" },
    { id: "_more", icon: "settings", label: "More" },
  ];

  const currentPageTitle = selectedCase ? selectedCase.title : navItems.find((n) => n.id === page)?.label || "CaseVault";

  return (
    <div style={styles.app}>
      <style>{FONTS}</style>
      <div style={styles.scanline} />

      {/* Mobile Header Bar */}
      {mobile && (
        <div style={styles.mobileHeader}>
          <button style={styles.hamburger} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f0", fontFamily: "'JetBrains Mono'", letterSpacing: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedCase ? selectedCase.id : "◈ CASEVAULT"}
            </div>
            <div style={{ fontSize: 10, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentPageTitle}</div>
          </div>
          {selectedCase && (
            <button style={{ ...styles.btn(), padding: "6px 12px", fontSize: 11 }} onClick={() => setSelectedCase(null)}>← Back</button>
          )}
          {!selectedCase && page === "cases" && (
            <button style={{ ...styles.btn("primary"), padding: "6px 12px", fontSize: 11 }} onClick={() => setShowNewCase(true)}>
              <Icon name="add" size={12} /> New
            </button>
          )}
        </div>
      )}

      {/* Sidebar Overlay (mobile) */}
      {mobile && sidebarOpen && (
        <div style={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div style={styles.sidebar(mobile, sidebarOpen)}>
        <div style={styles.logo}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={styles.logoText}>◈ CASEVAULT</div>
            {mobile && <button style={{ background: "none", border: "none", color: "#555", fontSize: 20, cursor: "pointer" }} onClick={() => setSidebarOpen(false)}>✕</button>}
          </div>
          <div style={styles.logoSub}>PI Case Management</div>
        </div>

        <div style={{ flex: 1, paddingTop: 12, overflowY: "auto" }}>
          {navItems.map((item) => (
            <div key={item.id} style={styles.navItem(page === item.id && !selectedCase)} onClick={() => navigate(item.id)}>
              <Icon name={item.icon} size={15} />
              {item.label}
            </div>
          ))}
        </div>

        {/* Clock & User */}
        <div style={{ padding: "16px 20px", borderTop: "1px solid rgba(0,255,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "6px 8px", background: "rgba(0,255,0,0.04)", borderRadius: 6, cursor: "pointer" }}
            onClick={() => navigate("team")}>
            <Icon name={CURRENT_USER?.role === "owner" ? "crown" : "user"} size={12} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#0f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{CURRENT_USER?.name || "Not logged in"}</div>
              <div style={{ fontSize: 9, color: "#555" }}>{AGENT_ROLES[CURRENT_USER?.role]?.label || ""}</div>
            </div>
          </div>
          {isSoloMode() && !mobile && (
            <button style={{ ...styles.btn(), width: "100%", fontSize: 11, padding: "6px 10px", justifyContent: "center", marginBottom: 8 }}
              onClick={() => navigate("team")}>
              <Icon name="add" size={10} /> Add Team Members
            </button>
          )}
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: mobile ? 14 : 18, color: "#0f0", fontWeight: 600 }}>
            {time.toLocaleTimeString()}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(0,255,0,0.3)", marginTop: 2 }}>
            {time.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" })}
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={styles.main(mobile)}>
        {selectedCase ? (
          <CaseDetail
            caseData={selectedCase}
            onBack={() => setSelectedCase(null)}
            onUpdate={(updated) => {
              const idx = CASES_DB.findIndex((c) => c.id === updated.id);
              if (idx >= 0) CASES_DB[idx] = updated;
              setSelectedCase({ ...updated });
              refreshCases();
            }}
          />
        ) : page === "dashboard" ? (
          <Dashboard cases={cases} onSelectCase={setSelectedCase} />
        ) : page === "cases" ? (
          <CasesList cases={cases} onSelectCase={setSelectedCase} onNewCase={() => setShowNewCase(true)} />
        ) : page === "clients" ? (
          <ClientsPage
            cases={cases}
            onSelectCase={(c) => { setSelectedCase(c); setPage("cases"); }}
            onRefresh={refreshCases}
          />
        ) : page === "invoices" ? (
          <InvoicesPage cases={cases} onSelectCase={(c) => { setSelectedCase(c); setPage("cases"); }} />
        ) : page === "team" ? (
          <TeamPage onRefresh={() => { refreshCases(); setCases([...CASES_DB]); }} />
        ) : page === "audit" ? (
          <AuditLogPage cases={cases} />
        ) : page === "settings" ? (
          <SettingsPage onRefresh={refreshCases} />
        ) : null}
      </div>

      {/* Mobile Bottom Nav */}
      {mobile && !selectedCase && (
        <div style={styles.bottomNav}>
          {bottomNavItems.map((item) => (
            <button key={item.id} style={styles.bottomNavItem(page === item.id)}
              onClick={() => item.id === "_more" ? setSidebarOpen(true) : navigate(item.id)}>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {showNewCase && (
        <NewCaseModal
          onClose={() => setShowNewCase(false)}
          onSave={(c) => {
            refreshCases();
            setSelectedCase(c);
            setPage("cases");
          }}
        />
      )}
    </div>
  );
}
