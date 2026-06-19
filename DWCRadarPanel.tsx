import { Settings } from "@api/Settings";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { Avatar, IconUtils, React, showToast, Toasts, UserStore, useMemo, useState } from "@webpack/common";

import { openInviteModal } from "@utils/discord";

import { clearAllEntries, EXCLUDED_TERMS, extractInviteCode, parseExcludedServers, parseKeywords, removeEntry, scanAllGuilds, scanCurrentGuild, toggleHandled, useIsScanning, useStaffEntries } from "./store";
import type { StaffEntry } from "./store";

const cl = classNameFactory("vc-dwcradar-");

const KW_DEFAULT = "Mod,Moderator,Moderation,Senior Moderator,Trial Mod,Admin,Administrator,Manager,Owner,Co-Owner,Helper,Staff,Jr. Staff,Sr. Staff,Head Staff,Senior Staff,Supervisor,Trainee,Dueño,Ayudante,Soporte,Personal,Jefe,Dono,Ajudante,Equipe,Suporte,Propriétaire,Aide,Personnel,Gérant,Besitzer,Leitung,Helfer,Personale,Proprietario,Eigenaar,Beheerder,Yönetici,Sahip,Yardımcı";

function RadarSweepIcon({ size = 22 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className={cl("scan-icon")}>
            <circle cx="12" cy="12" r="9" opacity="0.32" />
            <circle cx="12" cy="12" r="5.5" opacity="0.5" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
            <path d="M12 12 L12 3.5" strokeWidth={1.9} />
        </svg>
    );
}

interface DeduplicatedEntry {
    userId: string;
    username?: string;
    roles: string[];
    guilds: { guildId: string; guildName?: string; }[];
    handled: boolean;
}

function deduplicateEntries(entries: StaffEntry[]): DeduplicatedEntry[] {
    const map = new Map<string, DeduplicatedEntry>();

    for (const e of entries) {
        const existing = map.get(e.userId);
        if (existing) {
            if (!existing.guilds.some(g => g.guildId === e.guildId)) {
                existing.guilds.push({ guildId: e.guildId, guildName: e.guildName });
            }
            for (const r of e.roles ?? []) {
                if (!existing.roles.includes(r)) existing.roles.push(r);
            }
            existing.handled = existing.handled && !!e.handled;
        } else {
            map.set(e.userId, {
                userId: e.userId,
                username: e.username,
                roles: [...(e.roles ?? [])],
                guilds: [{ guildId: e.guildId, guildName: e.guildName }],
                handled: !!e.handled,
            });
        }
    }

    return Array.from(map.values());
}

function UserAvatar({ userId }: { userId: string; }) {
    const user = UserStore.getUser(userId);
    if (!user) {
        return <div className={cl("avatar-fallback")}>?</div>;
    }
    return (
        <Avatar
            src={IconUtils.getUserAvatarURL(user, true, 32)}
            size="SIZE_32"
            className={cl("avatar")}
        />
    );
}

function StaffEntryRow({ entry }: { entry: DeduplicatedEntry; }) {
    const copyId = () => {
        copyToClipboard(entry.userId);
        showToast(`Copied ${entry.userId}`, Toasts.Type.SUCCESS);
    };

    const handleToggle = () => {
        for (const g of entry.guilds) {
            toggleHandled(entry.userId, g.guildId);
        }
    };

    const handleRemove = () => {
        for (const g of entry.guilds) {
            removeEntry(entry.userId, g.guildId);
        }
    };

    const user = UserStore.getUser(entry.userId);
    const displayName = entry.username || user?.username || "Unknown";
    const serverNames = entry.guilds.map(g => g.guildName ?? "Unknown").join(", ");

    return (
        <div className={classes(cl("entry"), entry.handled && cl("entry-handled"))}>
            <div className={cl("entry-left")}>
                <input
                    type="checkbox"
                    className={cl("checkbox")}
                    checked={entry.handled}
                    onChange={handleToggle}
                    title={entry.handled ? "Mark as unhandled" : "Mark as handled"}
                />
                <UserAvatar userId={entry.userId} />
                <div className={cl("entry-info")}>
                    <span className={cl("entry-name")}>
                        {displayName}
                        {entry.guilds.length > 1 && (
                            <span className={cl("server-badge")} title={serverNames}>
                                {entry.guilds.length}
                            </span>
                        )}
                    </span>
                    {entry.roles.length > 0 && (
                        <span className={cl("entry-roles")}>{entry.roles.join(", ")}</span>
                    )}
                    <code className={cl("entry-id")}>{entry.userId}</code>
                </div>
            </div>
            <div className={cl("entry-actions")}>
                <Button variant="secondary" size="xs" onClick={copyId}>Copy</Button>
                <Button variant="dangerSecondary" size="xs" onClick={handleRemove}>
                    <svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" /></svg>
                </Button>
            </div>
        </div>
    );
}

function ScanSection() {
    const isScanning = useIsScanning();
    const pluginSettings = Settings.plugins.DWCRadar;

    const scan = () => {
        const keywords = parseKeywords(pluginSettings.keywords);
        const excluded = parseExcludedServers(pluginSettings.excludedServers);
        const excludedTerms = parseKeywords(pluginSettings.excludedRoleKeywords);
        const count = scanCurrentGuild(keywords, excluded, excludedTerms);
        if (count > 0) {
            showToast(`Found ${count} new staff members`, Toasts.Type.SUCCESS);
        } else {
            showToast("No new staff members found", Toasts.Type.MESSAGE);
        }
    };

    const scanAll = async () => {
        const keywords = parseKeywords(pluginSettings.keywords);
        const excluded = parseExcludedServers(pluginSettings.excludedServers);
        const excludedTerms = parseKeywords(pluginSettings.excludedRoleKeywords);
        const count = await scanAllGuilds(keywords, excluded, excludedTerms);
        if (count > 0) {
            showToast(`Found ${count} new staff members across all servers`, Toasts.Type.SUCCESS);
        } else {
            showToast("No new staff members found", Toasts.Type.MESSAGE);
        }
    };

    return (
        <div className={cl("scan")}>
            <div className={cl("scan-top")}>
                <div className={cl("scan-head")}>
                    <RadarSweepIcon />
                    <div className={cl("scan-text")}>
                        <Heading tag="h5" className={cl("scan-label")}>
                            {isScanning ? "Scanning…" : "Radar ready"}
                        </Heading>
                        <span className={cl("scan-sub")}>
                            {isScanning ? "Sweeping member roles for staff" : "Scan a server to detect staff"}
                        </span>
                    </div>
                </div>
                <div className={cl("scan-actions")}>
                    <Button variant="secondary" size="small" onClick={scan} disabled={isScanning}>
                        Current Server
                    </Button>
                    <Button variant="secondary" size="small" onClick={scanAll} disabled={isScanning}>
                        All Servers
                    </Button>
                </div>
            </div>
        </div>
    );
}

function InviteQueueSection() {
    const pluginSettings = Settings.plugins.DWCRadar;
    const [localList, setLocalList] = useState(pluginSettings.inviteList || "");
    const [joining, setJoining] = useState(false);

    const save = (val: string) => {
        setLocalList(val);
        pluginSettings.inviteList = val;
    };

    const lines = localList.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    const joinNext = async () => {
        if (!lines.length || joining) return;
        setJoining(true);

        const code = extractInviteCode(lines[0]);
        try {
            const accepted = await openInviteModal(code);
            if (accepted) {
                save(lines.slice(1).join("\n"));
                showToast(`Joined! ${lines.length - 1} invites remaining`, Toasts.Type.SUCCESS);
            }
        } catch {
            showToast(`Invalid invite removed: ${lines[0]}`, Toasts.Type.FAILURE);
            save(lines.slice(1).join("\n"));
        } finally {
            setJoining(false);
        }
    };

    return (
        <div className={cl("scan")}>
            <div className={cl("scan-top")}>
                <Heading tag="h5" className={cl("scan-label")}>
                    Invite Queue ({lines.length})
                </Heading>
                <div className={cl("scan-actions")}>
                    <Button variant="primary" size="small" onClick={joinNext} disabled={!lines.length || joining}>
                        {joining ? "Joining..." : "Join Next"}
                    </Button>
                </div>
            </div>
            <textarea
                className={cl("invite-textarea")}
                placeholder={"discord.gg/example\ndiscord.gg/example2\n..."}
                value={localList}
                onChange={e => save(e.currentTarget.value)}
                rows={4}
            />
        </div>
    );
}

function SettingsPanel({ icon, title, hint, count, children }: {
    icon: React.ReactNode; title: string; hint: string; count?: string; children: React.ReactNode;
}) {
    return (
        <div className={cl("scan")}>
            <div className={cl("settings-head")}>
                <div className={cl("settings-head-icon")}>{icon}</div>
                <div className={cl("settings-head-text")}>
                    <span className={cl("settings-head-title")}>{title}</span>
                    <span className={cl("settings-head-hint")}>{hint}</span>
                </div>
                {count != null && <span className={cl("settings-head-count")}>{count}</span>}
            </div>
            {children}
        </div>
    );
}

function DWCRadarSettingsModal(props: ModalProps) {
    const s = Settings.plugins.DWCRadar;
    const [keywords, setKeywords] = useState(s.keywords ?? "");
    const [excludedServers, setExcludedServers] = useState(s.excludedServers ?? "");
    const [excludedRoleKw, setExcludedRoleKw] = useState(s.excludedRoleKeywords ?? "");
    const [inviteList, setInviteList] = useState(s.inviteList ?? "");

    const upKeywords = (v: string) => { setKeywords(v); s.keywords = v; };
    const upExServers = (v: string) => { setExcludedServers(v); s.excludedServers = v; };
    const upExRole = (v: string) => { setExcludedRoleKw(v); s.excludedRoleKeywords = v; };
    const upInvite = (v: string) => { setInviteList(v); s.inviteList = v; };

    const resetDefaults = () => {
        upKeywords(KW_DEFAULT);
        upExServers("");
        upExRole("");
        upInvite("");
    };

    const csv = (v: string) => v.split(",").map(x => x.trim()).filter(Boolean);
    const kwAll = csv(keywords);
    const kwChips = kwAll.slice(0, 10);
    const kwMore = kwAll.length > 10 ? `+${kwAll.length - 10} more` : "";
    const invLines = inviteList.split("\n").map(l => l.trim()).filter(Boolean);

    return (
        <ModalRoot {...props} size={ModalSize.MEDIUM} className={cl("root")}>
            <ModalHeader className={cl("header")}>
                <button
                    className={cl("back-btn")}
                    aria-label="Back to Radar"
                    onClick={() => { props.onClose(); openDWCRadarModal(); }}
                >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>
                <div className={cl("settings-head-icon")} style={{ flexShrink: 0 }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M 12.00 5.30 L 12.84 5.35 L 14.19 2.86 L 16.91 3.99 L 16.11 6.71 L 16.74 7.26 L 17.29 7.89 L 20.01 7.09 L 21.14 9.81 L 18.65 11.16 L 18.70 12.00 L 18.65 12.84 L 21.14 14.19 L 20.01 16.91 L 17.29 16.11 L 16.74 16.74 L 16.11 17.29 L 16.91 20.01 L 14.19 21.14 L 12.84 18.65 L 12.00 18.70 L 11.16 18.65 L 9.81 21.14 L 7.09 20.01 L 7.89 17.29 L 7.26 16.74 L 6.71 16.11 L 3.99 16.91 L 2.86 14.19 L 5.35 12.84 L 5.30 12.00 L 5.35 11.16 L 2.86 9.81 L 3.99 7.09 L 6.71 7.89 L 7.26 7.26 L 7.89 6.71 L 7.09 3.99 L 9.81 2.86 L 11.16 5.35 Z" />
                        <circle cx="12" cy="12" r="3.2" />
                    </svg>
                </div>
                <div className={cl("title")} style={{ flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
                    <span style={{ fontSize: 17, fontWeight: 600, color: "#f1f3f7", letterSpacing: "-0.2px" }}>Radar Settings</span>
                    <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Configure detection keywords and exclusions</span>
                </div>
                <div className={cl("header-actions")}>
                    <Button variant="secondary" size="small" onClick={resetDefaults}>Reset Defaults</Button>
                </div>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>

            <ModalContent className={cl("content")}>
                <SettingsPanel
                    title="Detection Keywords"
                    hint="Comma-separated. A member is flagged when any of their role names contains one of these."
                    count={`${kwAll.length} terms`}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                            <circle cx="7" cy="7" r="1.4" fill="currentColor" stroke="none" />
                        </svg>
                    }
                >
                    <textarea className={cl("invite-textarea")} value={keywords} rows={4}
                        placeholder="Mod, Moderator, Admin, Owner…"
                        onChange={e => upKeywords(e.currentTarget.value)} />
                    <div className={cl("chips")}>
                        {kwChips.map(t => <span key={t} className={cl("chip-accent")}>{t}</span>)}
                        {kwMore && <span className={cl("chip-muted")}>{kwMore}</span>}
                    </div>
                </SettingsPanel>

                <SettingsPanel
                    title="Excluded Servers"
                    hint="Server IDs to never scan. Right-click a server → Copy Server ID."
                    count={`${csv(excludedServers).length} servers`}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M5.6 5.6l12.8 12.8" />
                        </svg>
                    }
                >
                    <input type="text" className={cl("settings-input")} value={excludedServers}
                        placeholder="123456789012345678, 987654321098765432…"
                        onChange={e => upExServers(e.currentTarget.value)} />
                </SettingsPanel>

                <SettingsPanel
                    title="Excluded Role Keywords"
                    hint="Roles matching any of these are ignored even if they match a detection keyword."
                    count={`${csv(excludedRoleKw).length} terms`}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                            <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                            <path d="M2 2l20 20" />
                        </svg>
                    }
                >
                    <input type="text" className={cl("settings-input")} value={excludedRoleKw}
                        placeholder="retired, ping, former…"
                        onChange={e => upExRole(e.currentTarget.value)} />
                </SettingsPanel>

                <SettingsPanel
                    title="Invite List"
                    hint="Invite links to join, one per line. Processed top-to-bottom by the queue."
                    count={`${invLines.length} links`}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                        </svg>
                    }
                >
                    <textarea className={cl("invite-textarea")} value={inviteList} rows={3}
                        placeholder="discord.gg/example"
                        onChange={e => upInvite(e.currentTarget.value)} />
                </SettingsPanel>

                <div className={cl("scan")}>
                    <div className={cl("settings-head")}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#868d9b" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <span className={cl("settings-head-title")} style={{ fontSize: 13 }}>Built-in Exclusions</span>
                    </div>
                    <div className={cl("chips")}>
                        {EXCLUDED_TERMS.map(t => <span key={t} className={cl("chip-muted")}>{t}</span>)}
                    </div>
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

function openDWCRadarModal() {
    openModal(props => <DWCRadarModal rootProps={props} />);
}

function openDWCRadarSettingsModal() {
    openModal(props => <DWCRadarSettingsModal {...props} />);
}

export function DWCRadarModal({ rootProps }: { rootProps: ModalProps; }) {
    const rawEntries = useStaffEntries();
    const [search, setSearch] = useState("");

    const deduplicated = useMemo(() => deduplicateEntries(rawEntries), [rawEntries]);

    const filtered = useMemo(() => {
        if (!search.trim()) return deduplicated;
        const q = search.toLowerCase();
        return deduplicated.filter(e =>
            e.userId.includes(q) ||
            e.username?.toLowerCase().includes(q) ||
            e.guilds.some(g => g.guildName?.toLowerCase().includes(q)) ||
            e.roles.some(r => r.toLowerCase().includes(q))
        );
    }, [deduplicated, search]);

    const unhandledCount = deduplicated.filter(e => !e.handled).length;

    const copyDWC = () => {
        if (!filtered.length) return;
        const ids = filtered.map(e => e.userId);
        const text = ids.length === 1
            ? `?dwc add ${ids[0]}`
            : `?dwc add ${ids[0]}\n${ids.slice(1).join("\n")}`;
        copyToClipboard(text);
        showToast(`Copied ${ids.length} IDs in DWC format`, Toasts.Type.SUCCESS);
    };

    const copyAllIds = () => {
        if (!filtered.length) return;
        copyToClipboard(filtered.map(e => e.userId).join("\n"));
        showToast(`Copied ${filtered.length} IDs`, Toasts.Type.SUCCESS);
    };

    return (
        <ModalRoot {...rootProps} size={ModalSize.MEDIUM} className={cl("root")}>
            <ModalHeader className={cl("header")}>
                <Heading tag="h2" className={cl("title")}>
                    DWC Radar
                    <span className={cl("count")}>{unhandledCount}</span>
                </Heading>
                <div className={cl("header-actions")}>
                    <Button variant="primary" size="small" onClick={copyDWC} disabled={!filtered.length}>
                        Copy DWC
                    </Button>
                    <Button variant="secondary" size="small" onClick={copyAllIds} disabled={!filtered.length}>
                        Copy IDs
                    </Button>
                    <Button variant="dangerPrimary" size="small" onClick={clearAllEntries} disabled={!deduplicated.length}>
                        Clear
                    </Button>
                    <Button
                        variant="secondary"
                        size="small"
                        aria-label="Settings"
                        onClick={() => { rootProps.onClose(); openDWCRadarSettingsModal(); }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M 12.00 5.30 L 12.84 5.35 L 14.19 2.86 L 16.91 3.99 L 16.11 6.71 L 16.74 7.26 L 17.29 7.89 L 20.01 7.09 L 21.14 9.81 L 18.65 11.16 L 18.70 12.00 L 18.65 12.84 L 21.14 14.19 L 20.01 16.91 L 17.29 16.11 L 16.74 16.74 L 16.11 17.29 L 16.91 20.01 L 14.19 21.14 L 12.84 18.65 L 12.00 18.70 L 11.16 18.65 L 9.81 21.14 L 7.09 20.01 L 7.89 17.29 L 7.26 16.74 L 6.71 16.11 L 3.99 16.91 L 2.86 14.19 L 5.35 12.84 L 5.30 12.00 L 5.35 11.16 L 2.86 9.81 L 3.99 7.09 L 6.71 7.89 L 7.26 7.26 L 7.89 6.71 L 7.09 3.99 L 9.81 2.86 L 11.16 5.35 Z" />
                            <circle cx="12" cy="12" r="3.2" />
                        </svg>
                    </Button>
                </div>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className={cl("content")}>
                <InviteQueueSection />
                <ScanSection />

                {deduplicated.length > 0 && (
                    <div className={cl("search")}>
                        <svg width="16" height="16" viewBox="0 0 24 24" className={cl("search-icon")}>
                            <path fill="currentColor" d="M21.707 20.293l-4.823-4.823A7.454 7.454 0 0 0 18.5 10.5a7.5 7.5 0 1 0-7.5 7.5 7.454 7.454 0 0 0 4.97-1.616l4.823 4.823a1 1 0 0 0 1.414-1.414zM10.5 16a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
                        </svg>
                        <input
                            type="text"
                            className={cl("search-input")}
                            placeholder="Search IDs, usernames, servers, or roles..."
                            value={search}
                            onChange={e => setSearch(e.currentTarget.value)}
                        />
                        {search && (
                            <span className={cl("search-count")}>
                                {filtered.length}/{deduplicated.length}
                            </span>
                        )}
                    </div>
                )}

                {deduplicated.length === 0 ? (
                    <div className={cl("empty")}>
                        <svg width="48" height="48" viewBox="0 0 24 24" className={cl("empty-icon")}>
                            <path fill="currentColor" d="M 12,2 C 6.48,2 2,6.48 2,12 2,17.52 6.48,22 12,22 17.52,22 22,17.52 22,12 22,6.48 17.52,2 12,2 Z m 0,18 C 7.58,20 4,16.42 4,12 4,7.58 7.58,4 12,4 c 4.42,0 8,3.58 8,8 0,4.42 -3.58,8 -8,8 z" />
                            <path fill="currentColor" transform="rotate(8.6629753,-11.542936,16.46816)" d="m 14.140375,11.697211 c -8.002171,7.698785 7.969694,1.441723 -3.132559,1.227196 C -0.0944369,12.709881 15.623788,19.579284 7.9250028,11.577112 0.22621763,3.574941 6.4832797,19.546806 6.6978061,8.4445529 6.9123325,-2.6576998 0.04292977,13.060525 8.045101,5.3617398 16.047272,-2.3370453 0.07540771,3.9200168 11.17766,4.1345432 22.279913,4.3490696 6.5616884,-2.5203332 14.260474,5.4818381 21.959259,13.484009 15.702197,-2.4878552 15.48767,8.6143975 15.273144,19.71665 22.142547,3.9984255 14.140375,11.697211 Z" />
                        </svg>
                        <p>No staff entries detected yet.</p>
                        <p className={cl("empty-hint")}>Join a server or click "Scan Current Server" to detect staff members.</p>
                    </div>
                ) : (
                    <div className={cl("list")}>
                        {filtered.map(entry => (
                            <StaffEntryRow key={entry.userId} entry={entry} />
                        ))}
                        {filtered.length === 0 && search && (
                            <div className={cl("empty")}>
                                <p>No entries match "{search}"</p>
                            </div>
                        )}
                    </div>
                )}
            </ModalContent>
        </ModalRoot>
    );
}
