import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { FluxDispatcher, GuildChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, PermissionsBits, React, RelationshipStore, RestAPI, SelectedGuildStore, showToast, Toasts, UserStore } from "@webpack/common";

export type DetectSource = "name" | "perm" | "owner";

export interface StaffEntry {
    userId: string;
    username?: string;
    guildId: string;
    guildName?: string;
    roles?: string[];
    handled?: boolean;
    sources?: DetectSource[];
}

export interface DetectionOptions {
    byPerm: boolean;
    manageMessages: boolean;
    requireHoist: boolean;
    includeOwner: boolean;
    excludeFriends: boolean;
    excludeStaffFromExcluded: boolean;
}

const DEFAULT_DETECTION: DetectionOptions = {
    byPerm: false,
    manageMessages: false,
    requireHoist: false,
    includeOwner: false,
    excludeFriends: false,
    excludeStaffFromExcluded: false,
};

export const CORE_STAFF_PERM_NAMES = [
    "Administrator", "Ban Members", "Kick Members",
    "Manage Server", "Manage Roles", "Manage Channels", "Timeout Members",
];

function staffPermBits(manageMessages: boolean): bigint[] {
    const bits = [
        PermissionsBits.ADMINISTRATOR,
        PermissionsBits.BAN_MEMBERS,
        PermissionsBits.KICK_MEMBERS,
        PermissionsBits.MANAGE_GUILD,
        PermissionsBits.MANAGE_ROLES,
        PermissionsBits.MANAGE_CHANNELS,
        PermissionsBits.MODERATE_MEMBERS,
    ];
    if (manageMessages) bits.push(PermissionsBits.MANAGE_MESSAGES);
    return bits;
}

function mergeSources(a?: DetectSource[], b?: DetectSource[]): DetectSource[] {
    return [...new Set<DetectSource>([...(a ?? []), ...(b ?? [])])];
}

const logger = new Logger("DWCRadar");
const STORE_KEY = "DWCRadar_entries";

export const EXCLUDED_TERMS = [
    "retired", "retirado", "retraité", "pensioniert", "ritirato", "gepensioneerd", "emekli",
    "announcement", "anuncio", "annonce", "ankündigung", "annuncio", "aankondiging", "duyuru",
    "tester", "probador", "testeur", "testador", "provatore", "penguji",
    "bot",
    "former", "ex-", "antiguo", "ancien", "ehemalig", "voormalig", "eski",
    "ping",
];

export const DEFAULT_KEYWORDS =

    "Mod,Moderator,Moderation,Senior Moderator,Trial Mod,Admin,Administrator,Manager,Owner,Co-Owner,Helper,Staff,Jr. Staff,Sr. Staff,Head Staff,Senior Staff,Supervisor,Trainee," +

    "Dueño,Ayudante,Soporte,Personal,Jefe," +

    "Dono,Ajudante,Equipe,Suporte,Moderador,Moderação,Administrador,Administração,Gerente,Gestor,Proprietário,Fundador,Líder,Responsável,Auxiliar,Equipa," +

    "Propriétaire,Aide,Personnel,Gérant," +

    "Besitzer,Leitung,Helfer," +

    "Personale,Proprietario," +

    "Eigenaar,Beheerder," +

    "Yönetici,Sahip,Yardımcı," +

    "Админ,Администратор,Администрация,Модератор,Модер,Модерация,Владелец,Создатель,Основатель,Хелпер,Помощник,Персонал,Стафф,Менеджер,Поддержка,Куратор,Руководитель,Заместитель,Старший," +

    "Pemilik,Pendiri,Pembina,Pengelola,Pengurus,Staf,Pembantu,Penolong,Dukungan,Pimpinan,Ketua,Moderasi," +

    "Quản trị,Quản lý,Điều hành,Kiểm duyệt,Hỗ trợ,Trợ lý,Nhân viên,Giám sát,Chủ sở hữu,Chủ tịch,Sáng lập";

export const DEFAULT_EXCLUDED_SERVERS = [
    "1407854032248111134",
    "1226222528851349646",
    "1245512926689890324",
    "1470562455162851422",
    "1313314163585712212",
    "1484334121793622098",
    "1496441024480935987",
].join(",");

export const DEFAULT_EXCLUDED_ROLE_KEYWORDS = EXCLUDED_TERMS.join(",");

let entries: StaffEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
    listeners.forEach(fn => fn());
}

export async function loadStoredEntries() {
    const stored = await DataStore.get<StaffEntry[]>(STORE_KEY);
    if (stored) {

        entries = stored.map(e => e.sources ? e : { ...e, sources: ["name"] as DetectSource[] });
        notify();
    }
}

export function addStaffEntry(entry: StaffEntry): boolean {
    const idx = entries.findIndex(e => e.userId === entry.userId && e.guildId === entry.guildId);
    if (idx !== -1) {
        const merged = mergeSources(entries[idx].sources, entry.sources);
        if (merged.length !== (entries[idx].sources?.length ?? 0)) {
            entries = entries.map((e, i) => i === idx ? { ...e, sources: merged } : e);
            notify();
            DataStore.set(STORE_KEY, entries);
        }
        return false;
    }
    entries = [...entries, entry];
    notify();
    DataStore.set(STORE_KEY, entries);
    return true;
}

function addEntryBatch(entry: StaffEntry): boolean {
    const idx = entries.findIndex(e => e.userId === entry.userId && e.guildId === entry.guildId);
    if (idx !== -1) {
        const merged = mergeSources(entries[idx].sources, entry.sources);
        if (merged.length !== (entries[idx].sources?.length ?? 0))
            entries = entries.map((e, i) => i === idx ? { ...e, sources: merged } : e);
        return false;
    }
    entries = [...entries, entry];
    return true;
}

export function toggleHandled(userId: string, guildId: string) {
    entries = entries.map(e =>
        e.userId === userId && e.guildId === guildId ? { ...e, handled: !e.handled } : e
    );
    notify();
    DataStore.set(STORE_KEY, entries);
}

export function removeEntry(userId: string, guildId: string) {
    entries = entries.filter(e => !(e.userId === userId && e.guildId === guildId));
    notify();
    DataStore.set(STORE_KEY, entries);
}

export function clearAllEntries() {
    entries = [];
    notify();
    DataStore.set(STORE_KEY, entries);
}

export function getEntries(): StaffEntry[] {
    return entries;
}

let scanning = false;
const scanListeners = new Set<() => void>();

export function useIsScanning(): boolean {
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

    React.useEffect(() => {
        scanListeners.add(forceUpdate);
        return () => { scanListeners.delete(forceUpdate); };
    }, []);

    return scanning;
}

function setScanning(val: boolean) {
    scanning = val;
    scanListeners.forEach(fn => fn());
}

export function parseKeywords(keywordSetting: string): string[] {
    return keywordSetting
        .split(",")
        .map(k => k.trim().toLowerCase())
        .filter(k => k.length > 0);
}

export function extractInviteCode(raw: string): string {
    return raw
        .replace(/^https?:\/\/(www\.)?/i, "")
        .replace(/^(discord\.gg|discord\.com\/invite)\//i, "")
        .trim();
}

export function parseExcludedServers(setting: string): Set<string> {
    return new Set(
        setting.split(",").map(s => s.trim()).filter(s => s.length > 0)
    );
}

function requestGuildMembers(guildId: string): Promise<void> {
    return new Promise<void>(resolve => {
        const defaultChannel = GuildChannelStore.getDefaultChannel(guildId);
        if (!defaultChannel) {
            resolve();
            return;
        }

        const timeout = setTimeout(resolve, 3000);

        const callback = (data: any) => {
            if (data.guildId === guildId) {
                FluxDispatcher.unsubscribe("GUILD_MEMBER_LIST_UPDATE", callback);
                clearTimeout(timeout);
                setTimeout(resolve, 200);
            }
        };

        FluxDispatcher.subscribe("GUILD_MEMBER_LIST_UPDATE", callback);

        FluxDispatcher.dispatch({
            type: "GUILD_SUBSCRIPTIONS",
            subscriptions: {
                [guildId]: {
                    channels: {
                        [defaultChannel.id]: [[0, 99]],
                    },
                },
            },
        });
    });
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function matchesKeyword(text: string, keywords: string[]): boolean {
    const lower = text.toLowerCase();
    return keywords.some(kw => lower.includes(kw));
}

interface RoleInfo {
    name: string;
    byName: boolean;
    byPerm: boolean;
}

function checkMember(
    member: { user?: any; roles?: string[]; nick?: string; },
    guildId: string,
    guildName: string,
    roleInfo: Map<string, RoleInfo>,
    batch = false,
): boolean {
    const userId = member.user?.id;
    if (!userId) return false;

    if (member.user?.bot) return false;

    const matchedRoles: string[] = [];
    let byName = false;
    let byPerm = false;
    for (const roleId of member.roles ?? []) {
        const info = roleInfo.get(roleId);
        if (info) {
            matchedRoles.push(info.name);
            if (info.byName) byName = true;
            if (info.byPerm) byPerm = true;
        }
    }

    if (matchedRoles.length === 0) return false;

    const sources: DetectSource[] = [];
    if (byName) sources.push("name");
    if (byPerm) sources.push("perm");

    const nickname = member.nick;
    const username = member.user?.username;
    const entry: StaffEntry = {
        userId,
        username: nickname || username || undefined,
        guildId,
        guildName,
        roles: matchedRoles,
        sources,
    };
    return batch ? addEntryBatch(entry) : addStaffEntry(entry);
}

function buildRoleInfo(guildId: string, keywords: string[], userExcludedTerms: string[], opts: DetectionOptions): Map<string, RoleInfo> {
    const allExcluded = userExcludedTerms;
    const permBits = opts.byPerm ? staffPermBits(opts.manageMessages) : [];

    const roleInfo = new Map<string, RoleInfo>();

    for (const role of GuildRoleStore.getSortedRoles(guildId)) {
        if (!role || !role.name) continue;
        if (role.id === guildId) continue;
        if (role.managed || role.tags?.bot_id || role.tags?.integration_id) continue;
        if (role.tags && "premium_subscriber" in role.tags) continue;

        const lower = role.name.toLowerCase();
        if (allExcluded.some(t => lower.includes(t))) continue;

        const byName = matchesKeyword(role.name, keywords);
        const byPerm = opts.byPerm
            && (!opts.requireHoist || role.hoist)
            && permBits.some(b => (role.permissions & b) !== 0n);

        if (byName || byPerm) roleInfo.set(role.id, { name: role.name, byName, byPerm });
    }

    return roleInfo;
}

function collectStaffUserIds(guildIds: Iterable<string>, keywords: string[], userExcludedTerms: string[], opts: DetectionOptions): Set<string> {
    const out = new Set<string>();

    for (const guildId of guildIds) {
        const guild = GuildStore.getGuild(guildId);
        if (!guild) continue;

        const roleInfo = buildRoleInfo(guildId, keywords, userExcludedTerms, opts);

        for (const userId of GuildMemberStore.getMemberIds(guildId) ?? []) {
            const m = GuildMemberStore.getMember(guildId, userId);
            if (!m) continue;
            if (UserStore.getUser(userId)?.bot) continue;
            if ((m.roles ?? []).some(r => roleInfo.has(r))) out.add(userId);
        }

        if (opts.includeOwner && guild.ownerId) out.add(guild.ownerId);
    }

    return out;
}

function scanGuildInternal(guildId: string, guildName: string, keywords: string[], userExcludedTerms: string[] = [], opts: DetectionOptions = DEFAULT_DETECTION, excludeUserIds?: Set<string>): number {
    let newCount = 0;

    const guild = GuildStore.getGuild(guildId);
    if (!guild) {
        logger.warn("Guild not found:", guildId);
        return 0;
    }

    const roleInfo = buildRoleInfo(guildId, keywords, userExcludedTerms, opts);

    const skipUser = (userId: string): boolean =>
        (excludeUserIds?.has(userId) ?? false)
        || (opts.excludeFriends && RelationshipStore.isFriend(userId));

    const memberIds: string[] = GuildMemberStore.getMemberIds(guildId) ?? [];

    for (const userId of memberIds) {
        if (skipUser(userId)) continue;

        const cachedMember = GuildMemberStore.getMember(guildId, userId);
        if (!cachedMember) continue;

        const user = UserStore.getUser(userId);
        const member = {
            user: user ?? { id: userId, username: undefined },
            roles: cachedMember.roles,
            nick: cachedMember.nick,
        };

        if (checkMember(member, guildId, guildName, roleInfo, true)) {
            newCount++;
        }
    }

    if (opts.includeOwner && guild.ownerId && !skipUser(guild.ownerId)) {
        const ownerId = guild.ownerId;
        const ownerUser = UserStore.getUser(ownerId);
        if (!ownerUser?.bot) {
            const ownerMember = GuildMemberStore.getMember(guildId, ownerId);
            const added = addEntryBatch({
                userId: ownerId,
                username: ownerMember?.nick || ownerUser?.username || undefined,
                guildId,
                guildName,
                roles: ["Owner"],
                sources: ["owner"],
            });
            if (added) newCount++;
        }
    }

    if (newCount > 0) {
        notify();
        DataStore.set(STORE_KEY, entries);
    }

    return newCount;
}

export function scanGuild(guildId: string, guildName: string, keywords: string[], excluded?: Set<string>, userExcludedTerms?: string[], opts: DetectionOptions = DEFAULT_DETECTION): number {
    if (scanning) return 0;
    if (excluded?.has(guildId)) return 0;
    setScanning(true);

    try {
        const excludeUserIds = opts.excludeStaffFromExcluded && excluded?.size
            ? collectStaffUserIds(excluded, keywords, userExcludedTerms ?? [], opts)
            : undefined;
        const count = scanGuildInternal(guildId, guildName, keywords, userExcludedTerms, opts, excludeUserIds);
        logger.info(`Scan complete: ${count} new staff entries in ${guildName}`);
        return count;
    } finally {
        setScanning(false);
    }
}

export interface CurrentScanResult {
    excluded: boolean;
    noGuild: boolean;
    count: number;
}

export function scanCurrentGuild(keywords: string[], excluded?: Set<string>, userExcludedTerms?: string[], opts: DetectionOptions = DEFAULT_DETECTION): CurrentScanResult {
    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) return { excluded: false, noGuild: true, count: 0 };
    if (excluded?.has(guildId)) return { excluded: true, noGuild: false, count: 0 };

    const guild = GuildStore.getGuild(guildId);
    const guildName = guild?.name ?? "Unknown Server";

    const count = scanGuild(guildId, guildName, keywords, excluded, userExcludedTerms, opts);
    return { excluded: false, noGuild: false, count };
}

export interface AllScanResult {
    scanned: number;
    skipped: number;
    found: number;
}

export async function scanAllGuilds(keywords: string[], excluded?: Set<string>, userExcludedTerms?: string[], opts: DetectionOptions = DEFAULT_DETECTION): Promise<AllScanResult> {
    if (scanning) return { scanned: 0, skipped: 0, found: 0 };
    setScanning(true);

    let totalCount = 0;
    let scanned = 0;
    let skipped = 0;

    try {
        const guilds = GuildStore.getGuilds();
        const guildList = Object.values(guilds);
        logger.info(`Scanning ${guildList.length} servers...`);

        let excludeUserIds: Set<string> | undefined;
        if (opts.excludeStaffFromExcluded && excluded?.size) {
            for (const gid of excluded) {
                if (!GuildStore.getGuild(gid)) continue;
                const before = GuildMemberStore.getMemberIds(gid)?.length ?? 0;
                if (before < 10) {
                    await requestGuildMembers(gid);
                    await delay(500);
                }
            }
            excludeUserIds = collectStaffUserIds(excluded, keywords, userExcludedTerms ?? [], opts);
            logger.info(`Excluding ${excludeUserIds.size} users who are staff on excluded servers`);
        }

        for (const guild of guildList) {
            if (excluded?.has(guild.id)) {
                skipped++;
                continue;
            }
            scanned++;

            const beforeCount = GuildMemberStore.getMemberIds(guild.id)?.length ?? 0;
            if (beforeCount < 10) {
                await requestGuildMembers(guild.id);
                await delay(500);
            }

            const afterCount = GuildMemberStore.getMemberIds(guild.id)?.length ?? 0;
            logger.info(`${guild.name}: ${afterCount} members (was ${beforeCount})`);

            let count = scanGuildInternal(guild.id, guild.name, keywords, userExcludedTerms, opts, excludeUserIds);
            if (count === 0 && afterCount > beforeCount) {
                await delay(1000);
                count = scanGuildInternal(guild.id, guild.name, keywords, userExcludedTerms, opts, excludeUserIds);
            }
            if (count > 0) totalCount += count;
        }

        logger.info(`Scan all complete: ${totalCount} new staff entries across ${scanned} servers (${skipped} skipped)`);
    } finally {
        setScanning(false);
    }

    return { scanned, skipped, found: totalCount };
}

export function useStaffEntries(): StaffEntry[] {
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

    React.useEffect(() => {
        listeners.add(forceUpdate);
        return () => { listeners.delete(forceUpdate); };
    }, []);

    return entries;
}

export async function leaveAllGuilds(excluded?: Set<string>) {
    const guilds = Object.values(GuildStore.getGuilds());
    const toLeave = guilds.filter(g => !excluded?.has(g.id));

    logger.info(`Leaving ${toLeave.length} servers (${guilds.length - toLeave.length} excluded)...`);
    let left = 0;

    for (const guild of toLeave) {
        try {
            await RestAPI.delete({ url: `/users/@me/guilds/${guild.id}` });
            left++;
            if (left % 5 === 0) {
                showToast(`Left ${left}/${toLeave.length} servers...`, Toasts.Type.MESSAGE);
            }
        } catch (e) {
            logger.warn(`Failed to leave ${guild.name}:`, e);
        }
        await delay(500);
    }

    showToast(`Left ${left} servers`, Toasts.Type.SUCCESS);
}
