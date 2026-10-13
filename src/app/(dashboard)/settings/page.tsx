"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  loadCompanyProfile,
  saveCompanyProfile,
  type CompanyProfile,
} from "@/lib/company-settings";
import {
  Building2,
  CreditCard,
  Users,
  Save,
  Upload,
  ShieldCheck,
  Truck,
  ArrowRightLeft,
  BookOpen,
  UsersIcon,
  LogOut,
  PanelLeft,
} from "lucide-react";
import ModuleVisibilitySettings from "@/components/modules/settings/ModuleVisibilitySettings";
import { capitalizeFirst } from "@/lib/utils";

type SettingsTab = "company" | "vouchers" | "modules" | "users";

interface VoucherSettings {
  cpvPrefix: string;
  ppvPrefix: string;
  bpvPrefix: string;
  defaultCashAccount: string;
  defaultBankAccount: string;
  printCopies: number;
  autoPrint: boolean;
}

interface UserRole {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "operator" | "viewer";
  modules: string[];
}

const MODULE_LIST = [
  { id: "dispatch", label: "Dispatch", icon: Truck },
  { id: "gate-pass", label: "Gate Pass", icon: ArrowRightLeft },
  { id: "ledger", label: "Ledger", icon: BookOpen },
  { id: "labour", label: "Labour", icon: UsersIcon },
  { id: "qc", label: "Quality QC", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Building2 },
];

const MOCK_USERS: UserRole[] = [
  { id: "u1", name: "Admin User", email: "admin@glassco.pk", role: "admin", modules: ["dispatch", "gate-pass", "ledger", "labour", "qc", "settings"] },
  { id: "u2", name: "Ahmad Khan", email: "ahmad@glassco.pk", role: "manager", modules: ["dispatch", "gate-pass", "labour"] },
  { id: "u3", name: "Bilal Ahmed", email: "bilal@glassco.pk", role: "operator", modules: ["dispatch", "gate-pass"] },
  { id: "u4", name: "Saira Bibi", email: "saira@glassco.pk", role: "viewer", modules: ["ledger"] },
];

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-crimson-primary/10 text-crimson-primary border-crimson-primary/20",
  manager: "bg-status-optimal/10 text-status-optimal border-status-optimal/20",
  operator: "bg-status-amber/10 text-status-amber border-status-amber/20",
  viewer: "bg-[var(--input-bg)] text-secondary border-[var(--input-border)]",
};

export default function SettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();

  const [tab, setTab] = useState<SettingsTab>("company");

  const [company, setCompany] = useState<CompanyProfile>(() => loadCompanyProfile());

  const [vouchers, setVouchers] = useState<VoucherSettings>({
    cpvPrefix: "CPV",
    ppvPrefix: "PPV",
    bpvPrefix: "BPV",
    defaultCashAccount: "1100",
    defaultBankAccount: "1120",
    printCopies: 2,
    autoPrint: false,
  });

  const [users, setUsers] = useState<UserRole[]>(MOCK_USERS);
  const [saved, setSaved] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  function handleLogoFile(file: File | undefined | null) {
    if (!file) return;
    setLogoError("");
    const okTypes = ["image/png", "image/jpeg", "image/svg+xml"];
    if (!okTypes.includes(file.type)) {
      setLogoError("Only PNG, JPG or SVG files are allowed.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError("File must be 2MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const logo = String(reader.result || "");
      setCompany((prev) => ({ ...prev, logo }));
      saveCompanyProfile({ ...company, logo });
    };
    reader.onerror = () => setLogoError("Could not read the selected file.");
    reader.readAsDataURL(file);
  }

  function handleSave() {
    saveCompanyProfile(company);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleLogout() {
    queryClient.clear();
    await signOut();
    router.push("/login");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display font-bold tracking-tight">Settings</h1>
          <p className="text-body text-secondary mt-1">Application configuration &amp; user management</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleLogout}
            title="Sign out of this session"
            className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:text-status-alert hover:border-status-alert/40 transition-colors flex items-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
          <button onClick={handleSave} className="crimson-btn text-caption px-4 py-2 flex items-center gap-2">
            <Save className="h-4 w-4" />
            {saved ? "Saved!" : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="glow-line" />

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-bg-subtle border border-border-subtle w-full sm:w-fit overflow-x-auto">
        {([
          ["company", "Company Profile", Building2],
          ["vouchers", "Financial & Vouchers", CreditCard],
          ["modules", "Menu Visibility", PanelLeft],
          ["users", "User Management", Users],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded text-caption font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${
              tab === key ? "bg-crimson-primary text-white" : "text-secondary hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ─── Company Profile Tab ─────────────────────────────────── */}
      {tab === "company" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6 space-y-4">
            <h3 className="text-h2 font-semibold">Company Details</h3>
            <div className="glow-line mb-2" />

            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Company Name</label>
              <input
                type="text"
                value={company.name}
                onChange={(e) => setCompany({ ...company, name: capitalizeFirst(e.target.value) })}
                className="glass-input w-full"
              />
            </div>

            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Address</label>
              <textarea
                value={company.address}
                onChange={(e) => setCompany({ ...company, address: capitalizeFirst(e.target.value) })}
                className="glass-input w-full resize-none"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Phone (Mobile)</label>
                <input
                  type="tel"
                  value={company.phone}
                  onChange={(e) => setCompany({ ...company, phone: e.target.value })}
                  className="glass-input w-full font-mono"
                />
              </div>
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Email</label>
                <input
                  type="email"
                  value={company.email}
                  onChange={(e) => setCompany({ ...company, email: e.target.value })}
                  className="glass-input w-full font-mono"
                />
              </div>
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Telephone (Landline)</label>
                <input
                  type="tel"
                  value={company.telephone}
                  onChange={(e) => setCompany({ ...company, telephone: e.target.value })}
                  className="glass-input w-full font-mono"
                />
              </div>
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Website</label>
                <input
                  type="text"
                  value={company.website}
                  onChange={(e) => setCompany({ ...company, website: e.target.value })}
                  className="glass-input w-full font-mono"
                />
              </div>
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Facebook</label>
                <input
                  type="text"
                  value={company.facebook}
                  onChange={(e) => setCompany({ ...company, facebook: e.target.value })}
                  className="glass-input w-full font-mono"
                />
              </div>
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Instagram</label>
                <input
                  type="text"
                  value={company.instagram}
                  onChange={(e) => setCompany({ ...company, instagram: e.target.value })}
                  className="glass-input w-full font-mono"
                />
              </div>
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">WhatsApp</label>
                <input
                  type="text"
                  value={company.whatsapp}
                  onChange={(e) => setCompany({ ...company, whatsapp: e.target.value })}
                  className="glass-input w-full font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">NTN / STRN</label>
              <input
                type="text"
                value={company.ntn}
                onChange={(e) => setCompany({ ...company, ntn: e.target.value })}
                className="glass-input w-full font-mono"
              />
            </div>
          </div>

          <div className="glass-card p-6 space-y-4">
            <h3 className="text-h2 font-semibold">Company Logo</h3>
            <div className="glow-line mb-2" />

            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                handleLogoFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => logoInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  logoInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleLogoFile(e.dataTransfer.files?.[0]);
              }}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-crimson-primary bg-crimson-primary/5"
                  : "border-[var(--input-border)] hover:border-crimson-primary/40"
              }`}
            >
              <Upload className="h-8 w-8 mx-auto text-muted mb-3" />
              <p className="text-body text-secondary">Click to upload or drag &amp; drop</p>
              <p className="text-caption text-muted mt-1">PNG, JPG or SVG (max 2MB)</p>
            </div>
            {logoError && (
              <p className="text-caption text-status-alert">{logoError}</p>
            )}

            <div className="glass-card p-4 bg-[var(--input-bg)]">
              <p className="text-caption text-muted uppercase tracking-wider font-medium mb-2">Preview</p>
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-lg bg-crimson-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                  {company.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={company.logo} alt="Company logo" className="h-full w-full object-contain" />
                  ) : (
                    <Building2 className="h-8 w-8 text-crimson-primary" />
                  )}
                </div>
                <div>
                  <p className="text-body font-semibold text-foreground">{company.name || "Company Name"}</p>
                  <p className="text-caption text-muted">{company.address || "Company Address"}</p>
                  {company.logo && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...company, logo: "" };
                        setCompany(next);
                        saveCompanyProfile(next);
                      }}
                      className="mt-1 text-caption text-status-alert hover:underline"
                    >
                      Remove logo
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="glass-card p-4 space-y-2">
              <h4 className="text-caption text-muted uppercase tracking-wider font-medium">Invoice Header Preview</h4>
              <div className="border border-[var(--input-border)] rounded-lg p-4 bg-white text-black">
                <div className="flex justify-between items-start border-b-2 border-red-600 pb-3 mb-3">
                  <div className="flex items-center gap-3">
                    {company.logo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={company.logo} alt="" className="h-10 w-10 object-contain" />
                    )}
                    <div>
                      <p className="text-lg font-bold text-red-600">{company.name || "GLASSCO SANITARY"}</p>
                      <p className="text-xs text-gray-500">Tax Invoice</p>
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p className="font-semibold text-black">INV-2026-0001</p>
                    <p>Date: {new Date().toLocaleDateString("en-PK")}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500">Bill To: <span className="text-black font-medium">Customer Name</span></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Financial & Vouchers Tab ────────────────────────────── */}
      {tab === "vouchers" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6 space-y-4">
            <h3 className="text-h2 font-semibold">Voucher Prefixes</h3>
            <div className="glow-line mb-2" />

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Cash Payment (CPV)</label>
                <input
                  type="text"
                  value={vouchers.cpvPrefix}
                  onChange={(e) => setVouchers({ ...vouchers, cpvPrefix: e.target.value })}
                  className="glass-input w-full font-mono text-center"
                />
                <p className="text-caption text-muted mt-1 text-center font-mono">{vouchers.cpvPrefix}-2026-00001</p>
              </div>
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Party Payment (PPV)</label>
                <input
                  type="text"
                  value={vouchers.ppvPrefix}
                  onChange={(e) => setVouchers({ ...vouchers, ppvPrefix: e.target.value })}
                  className="glass-input w-full font-mono text-center"
                />
                <p className="text-caption text-muted mt-1 text-center font-mono">{vouchers.ppvPrefix}-2026-00001</p>
              </div>
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Bank Payment (BPV)</label>
                <input
                  type="text"
                  value={vouchers.bpvPrefix}
                  onChange={(e) => setVouchers({ ...vouchers, bpvPrefix: e.target.value })}
                  className="glass-input w-full font-mono text-center"
                />
                <p className="text-caption text-muted mt-1 text-center font-mono">{vouchers.bpvPrefix}-2026-00001</p>
              </div>
            </div>
          </div>

          <div className="glass-card p-6 space-y-4">
            <h3 className="text-h2 font-semibold">Default Accounts</h3>
            <div className="glow-line mb-2" />

            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Default Cash Account</label>
              <input
                type="text"
                value={vouchers.defaultCashAccount}
                onChange={(e) => setVouchers({ ...vouchers, defaultCashAccount: e.target.value })}
                className="glass-input w-full font-mono"
                placeholder="e.g. 1100"
              />
              <p className="text-caption text-muted mt-1">Used as the default credit account for Cash Payment Vouchers</p>
            </div>

            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Default Bank Account</label>
              <input
                type="text"
                value={vouchers.defaultBankAccount}
                onChange={(e) => setVouchers({ ...vouchers, defaultBankAccount: e.target.value })}
                className="glass-input w-full font-mono"
                placeholder="e.g. 1120"
              />
              <p className="text-caption text-muted mt-1">Used as the default credit account for Bank Payment Vouchers</p>
            </div>
          </div>

          <div className="glass-card p-6 space-y-4 lg:col-span-2">
            <h3 className="text-h2 font-semibold">Print Options</h3>
            <div className="glow-line mb-2" />

            <div className="flex items-center gap-6">
              <div>
                <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Print Copies</label>
                <select
                  value={vouchers.printCopies}
                  onChange={(e) => setVouchers({ ...vouchers, printCopies: Number(e.target.value) })}
                  className="glass-input w-24"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-caption text-muted uppercase tracking-wider font-medium">Auto-Print on Save</label>
                <button
                  onClick={() => setVouchers({ ...vouchers, autoPrint: !vouchers.autoPrint })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    vouchers.autoPrint ? "bg-crimson-primary" : "bg-neutral-600"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      vouchers.autoPrint ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Menu Visibility Tab ─────────────────────────────────── */}
      {tab === "modules" && <ModuleVisibilitySettings />}

      {/* ─── User Management Tab ─────────────────────────────────── */}
      {tab === "users" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-body text-secondary">{users.length} registered users</p>
            <button className="crimson-btn text-caption px-3 py-1.5">+ Add User</button>
          </div>

          <div className="space-y-2">
            {users.map((user) => (
              <div key={user.id} className="glass-card p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="h-10 w-10 shrink-0 rounded-full bg-crimson-primary/10 flex items-center justify-center">
                      <span className="text-body font-semibold text-crimson-primary">
                        {user.name.split(" ").map((n) => n[0]).join("")}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-body font-medium text-foreground truncate">{user.name}</p>
                      <p className="text-caption text-muted font-mono truncate">{user.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap">
                    <span className={`badge font-mono text-caption border ${ROLE_COLORS[user.role]}`}>
                      {user.role.toUpperCase()}
                    </span>

                    <div className="flex items-center gap-1">
                      {MODULE_LIST.map((mod) => {
                        const hasAccess = user.modules.includes(mod.id);
                        return (
                          <button
                            key={mod.id}
                            title={`${mod.label}: ${hasAccess ? "Granted" : "Denied"}`}
                            className={`h-6 w-6 rounded flex items-center justify-center transition-colors ${
                              hasAccess
                                ? "bg-status-optimal/10 text-status-optimal"
                                : "bg-[var(--input-bg)] text-muted"
                            }`}
                            onClick={() => {
                              setUsers((prev) =>
                                prev.map((u) => {
                                  if (u.id !== user.id) return u;
                                  const modules = hasAccess
                                    ? u.modules.filter((m) => m !== mod.id)
                                    : [...u.modules, mod.id];
                                  return { ...u, modules };
                                })
                              );
                            }}
                          >
                            <mod.icon className="h-3 w-3" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="glass-card p-4">
            <h4 className="text-caption text-muted uppercase tracking-wider font-medium mb-3">Module Access Legend</h4>
            <div className="flex flex-wrap gap-3">
              {MODULE_LIST.map((mod) => (
                <div key={mod.id} className="flex items-center gap-1.5 text-caption text-secondary">
                  <mod.icon className="h-3 w-3" />
                  {mod.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
