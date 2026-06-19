import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { FluxDispatcher, GuildChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, React, RestAPI, SelectedGuildStore, showToast, Toasts, UserStore } from "@webpack/common";

export interface StaffEntry {
    userId: string;
    username?: string;
    guildId: string;
    guildName?: string;
    roles?: string[];
    handled?: boolean;
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

let entries: StaffEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
    listeners.forEach(fn => fn());
}

export async function loadStoredEntries() {
    const stored = await DataStore.get<StaffEntry[]>(STORE_KEY);
    if (stored) {
        entries = stored;
        notify();
    }
}

export function addStaffEntry(entry: StaffEntry): boolean {
    if (entries.some(e => e.userId === entry.userId && e.guildId === entry.guildId)) return false;

    entries = [...entries, entry];
    notify();
    DataStore.set(STORE_KEY, entries);
    return true;
}

function addEntryBatch(entry: StaffEntry): boolean {
    if (entries.some(e => e.userId === entry.userId && e.guildId === entry.guildId)) return false;
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

function checkMember(
    member: { user?: any; roles?: string[]; nick?: string; },
    guildId: string,
    guildName: string,
    staffRoleIds: Set<string>,
    roleIdToName: Map<string, string>,
    batch = false,
): boolean {
    const userId = member.user?.id;
    if (!userId) return false;

    if (member.user?.bot) return false;

    const matchedRoles: string[] = [];
    const memberRoles = member.roles ?? [];
    for (const roleId of memberRoles) {
        if (staffRoleIds.has(roleId)) {
            matchedRoles.push(roleIdToName.get(roleId) ?? "Unknown Role");
        }
    }

    if (matchedRoles.length === 0) return false;

    const nickname = member.nick;
    const username = member.user?.username;
    const entry: StaffEntry = {
        userId,
        username: nickname || username || undefined,
        guildId,
        guildName,
        roles: matchedRoles,
    };
    return batch ? addEntryBatch(entry) : addStaffEntry(entry);
}

function scanGuildInternal(guildId: string, guildName: string, keywords: string[], userExcludedTerms: string[] = []): number {
    let newCount = 0;

    const guild = GuildStore.getGuild(guildId);
    if (!guild) {
        logger.warn("Guild not found:", guildId);
        return 0;
    }

    const allExcluded = [...EXCLUDED_TERMS, ...userExcludedTerms];

    const staffRoleIds = new Set<string>();
    const roleIdToName = new Map<string, string>();

    const allRoles = GuildRoleStore.getSortedRoles(guildId);
    for (const role of allRoles) {
        const lower = role?.name?.toLowerCase() ?? "";
        if (role && role.name && matchesKeyword(role.name, keywords)
            && !allExcluded.some(t => lower.includes(t))) {
            staffRoleIds.add(role.id);
            roleIdToName.set(role.id, role.name);
        }
    }

    const memberIds: string[] = GuildMemberStore.getMemberIds(guildId) ?? [];

    for (const userId of memberIds) {
        const cachedMember = GuildMemberStore.getMember(guildId, userId);
        if (!cachedMember) continue;

        const user = UserStore.getUser(userId);
        const member = {
            user: user ?? { id: userId, username: undefined },
            roles: cachedMember.roles,
            nick: cachedMember.nick,
        };

        if (checkMember(member, guildId, guildName, staffRoleIds, roleIdToName, true)) {
            newCount++;
        }
    }

    if (newCount > 0) {
        notify();
        DataStore.set(STORE_KEY, entries);
    }

    return newCount;
}

export function scanGuild(guildId: string, guildName: string, keywords: string[], excluded?: Set<string>, userExcludedTerms?: string[]): number {
    if (scanning) return 0;
    if (excluded?.has(guildId)) return 0;
    setScanning(true);

    try {
        const count = scanGuildInternal(guildId, guildName, keywords, userExcludedTerms);
        logger.info(`Scan complete: ${count} new staff entries in ${guildName}`);
        return count;
    } finally {
        setScanning(false);
    }
}

export function scanCurrentGuild(keywords: string[], excluded?: Set<string>, userExcludedTerms?: string[]): number {
    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) return 0;
    if (excluded?.has(guildId)) return 0;

    const guild = GuildStore.getGuild(guildId);
    const guildName = guild?.name ?? "Unknown Server";

    return scanGuild(guildId, guildName, keywords, excluded, userExcludedTerms);
}

export async function scanAllGuilds(keywords: string[], excluded?: Set<string>, userExcludedTerms?: string[]): Promise<number> {
    if (scanning) return 0;
    setScanning(true);

    let totalCount = 0;

    try {
        const guilds = GuildStore.getGuilds();
        const guildList = Object.values(guilds);
        logger.info(`Scanning ${guildList.length} servers...`);

        for (const guild of guildList) {
            if (excluded?.has(guild.id)) continue;

            const beforeCount = GuildMemberStore.getMemberIds(guild.id)?.length ?? 0;
            if (beforeCount < 10) {
                await requestGuildMembers(guild.id);
                await delay(500);
            }

            const afterCount = GuildMemberStore.getMemberIds(guild.id)?.length ?? 0;
            logger.info(`${guild.name}: ${afterCount} members (was ${beforeCount})`);

            let count = scanGuildInternal(guild.id, guild.name, keywords, userExcludedTerms);
            if (count === 0 && afterCount > beforeCount) {
                await delay(1000);
                count = scanGuildInternal(guild.id, guild.name, keywords, userExcludedTerms);
            }
            if (count > 0) totalCount += count;
        }

        logger.info(`Scan all complete: ${totalCount} new staff entries across ${guildList.length} servers`);
    } finally {
        setScanning(false);
    }

    return totalCount;
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
