import { addChatBarButton, ChatBarButton, ChatBarButtonFactory, removeChatBarButton } from "@api/ChatButtons";
import { ApplicationCommandInputType } from "@api/Commands";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Notifications } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { openInviteModal } from "@utils/discord";
import { openModal } from "@utils/modal";
import { GuildStore, Menu, showToast, Toasts } from "@webpack/common";

import { DWCRadarModal } from "./DWCRadarPanel";
import { DEFAULT_EXCLUDED_ROLE_KEYWORDS, DEFAULT_EXCLUDED_SERVERS, DEFAULT_KEYWORDS, extractInviteCode, leaveAllGuilds, loadStoredEntries, parseExcludedServers, parseKeywords, scanGuild } from "./store";
import type { DetectionOptions } from "./store";

import style from "./style.css?managed";

function getExcludedTerms(): string[] {
    return parseKeywords(settings.store.excludedRoleKeywords);
}

function getDetectionOptions(): DetectionOptions {
    return {
        byPerm: settings.store.detectByPermissions,
        manageMessages: settings.store.manageMessagesIsStaff,
        requireHoist: settings.store.requireHoistForPerms,
        includeOwner: settings.store.includeOwner,
        excludeFriends: settings.store.excludeFriends,
        excludeStaffFromExcluded: settings.store.excludeStaffFromExcluded,
    };
}

const settings = definePluginSettings({
    keywords: {
        type: OptionType.STRING,
        description: "Comma-separated keywords to match against role names",
        default: DEFAULT_KEYWORDS,
    },
    excludedServers: {
        type: OptionType.STRING,
        description: "Comma-separated server IDs to never scan (right-click a server > Copy Server ID)",
        default: DEFAULT_EXCLUDED_SERVERS,
    },
    excludedRoleKeywords: {
        type: OptionType.STRING,
        description: "Comma-separated keywords to exclude roles (defaults to the built-in exclusion list; remove any you don't want)",
        default: DEFAULT_EXCLUDED_ROLE_KEYWORDS,
    },
    inviteList: {
        type: OptionType.STRING,
        description: "Invite links to join (one per line). Processed top-to-bottom.",
        default: "",
    },
    detectByPermissions: {
        type: OptionType.BOOLEAN,
        description: "Detect staff by role permissions (ban/kick/manage/timeout), not only by role name",
        default: true,
    },
    manageMessagesIsStaff: {
        type: OptionType.BOOLEAN,
        description: "Also treat 'Manage Messages' as a staff permission (catches more, less precise)",
        default: false,
    },
    requireHoistForPerms: {
        type: OptionType.BOOLEAN,
        description: "Permission matches only count if the role is hoisted (displayed separately)",
        default: false,
    },
    includeOwner: {
        type: OptionType.BOOLEAN,
        description: "Always include the server owner, even with no staff role",
        default: true,
    },
    excludeFriends: {
        type: OptionType.BOOLEAN,
        description: "Never flag your friends, even if they hold a staff role",
        default: true,
    },
    excludeStaffFromExcluded: {
        type: OptionType.BOOLEAN,
        description: "Skip members who are also staff on one of your excluded servers",
        default: true,
    },
});

const DWCRadarIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        viewBox="0 0 24 24"
        width={width}
        height={height}
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
    >
        <circle cx="12" cy="12" r="9" opacity="0.32" />
        <circle cx="12" cy="12" r="5.5" opacity="0.5" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <path d="M12 12 L12 3.5" strokeWidth={1.9} />
    </svg>
);

function joinNextInvite() {
    const list = settings.store.inviteList || "";
    const lines = list.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    if (!lines.length) {
        showToast("No invites in queue", Toasts.Type.MESSAGE);
        return;
    }

    const code = extractInviteCode(lines[0]);
    openInviteModal(code).then(accepted => {
        if (accepted) {
            settings.store.inviteList = lines.slice(1).join("\n");
            showToast(`Joined! ${lines.length - 1} invites remaining`, Toasts.Type.SUCCESS);
        }
    }).catch(() => {
        settings.store.inviteList = lines.slice(1).join("\n");
        showToast(`Invalid invite removed: ${lines[0]}`, Toasts.Type.FAILURE);
    });
}

function onKeydown(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        joinNextInvite();
    }
}

function openDWCRadarModal() {
    openModal(props => <DWCRadarModal rootProps={props} />);
}

const DWCRadarChatBarBtn: ChatBarButtonFactory = () => (
    <ChatBarButton
        tooltip="DWC Radar"
        onClick={openDWCRadarModal}
    >
        <DWCRadarIcon />
    </ChatBarButton>
);

const GuildContextMenuPatch: NavContextMenuPatchCallback = (children, { guild }: { guild: any; }) => {
    if (!guild) return;
    const excluded = parseExcludedServers(settings.store.excludedServers);
    if (excluded.has(guild.id)) return;

    const group = findGroupChildrenByChildId("privacy", children);
    group?.push(
        <Menu.MenuItem
            id="vc-dwcradar-scan"
            label="Scan for Staff"
            action={() => {
                const keywords = parseKeywords(settings.store.keywords);
                scanGuild(guild.id, guild.name, keywords, excluded, getExcludedTerms(), getDetectionOptions());
                openDWCRadarModal();
            }}
        />
    );

    const leaveGroup = findGroupChildrenByChildId("leave-server", children);
    (leaveGroup ?? group)?.push(
        <Menu.MenuItem
            id="vc-dwcradar-leave-all"
            label="Leave All Servers"
            color="danger"
            action={() => leaveAllGuilds(excluded)}
        />
    );
};

export default definePlugin({
    name: "DWCRadar",
    description: "Scans servers for staff-role members and collects their IDs for DWC bulk actions",
    authors: [{ name: "theappleeffect", id: 0n }],

    settings,
    managedStyle: style,

    contextMenus: {
        "guild-context": GuildContextMenuPatch,
        "guild-header-popout": GuildContextMenuPatch,
    },

    commands: [{
        name: "dwcradar",
        description: "Open the DWC Radar panel to view detected staff members",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute: () => {
            openDWCRadarModal();
        },
    }],

    async start() {
        await loadStoredEntries();
        addChatBarButton("DWCRadar", DWCRadarChatBarBtn, DWCRadarIcon);
        document.addEventListener("keydown", onKeydown);
    },

    stop() {
        removeChatBarButton("DWCRadar");
        document.removeEventListener("keydown", onKeydown);
    },

    flux: {
        GUILD_CREATE({ guild }: { guild: any; }) {
            const keywords = parseKeywords(settings.store.keywords);
            if (!keywords.length) return;

            const guildId = guild?.id;
            const guildName = guild?.name ?? "Unknown Server";
            if (!guildId) return;

            const excluded = parseExcludedServers(settings.store.excludedServers);
            if (excluded.has(guildId)) return;

            setTimeout(() => {
                const count = scanGuild(guildId, guildName, keywords, excluded, getExcludedTerms(), getDetectionOptions());
                if (count > 0) {
                    Notifications.showNotification({
                        title: "DWC Radar",
                        body: `Found ${count} staff member${count > 1 ? "s" : ""} in ${guildName}`,
                        color: "#5865F2",
                        noPersist: true,
                        onClick: openDWCRadarModal,
                    });
                }
            }, 3000);
        },
    },
});
