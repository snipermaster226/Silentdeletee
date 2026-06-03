import { findByProps, findByName, find } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";
import { React } from "@vendetta/metro/common";
import Settings from "./Settings";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function silentDeleteMessage(channelId: string, messageId: string) {
    const RestAPI = findByProps("get", "post", "del", "patch");
    try {
        const replacementText: string = storage.replacementText ?? "** **";
        const deleteDelay: number = storage.deleteDelay ?? 200;
        const suppressNotifications: boolean = storage.suppressNotifications ?? true;

        const response = await RestAPI.post({
            url: `/channels/${channelId}/messages`,
            body: {
                content: replacementText,
                flags: suppressNotifications ? 4096 : 0,
                mobile_network_type: "unknown",
                nonce: messageId,
                tts: false,
            },
        });

        await sleep(deleteDelay);
        await RestAPI.del({ url: `/channels/${channelId}/messages/${response.body.id}` });
        await sleep(100);
        await RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}` });
        logger.log("[SilentDelete] Success!");
        return true;
    } catch (err) {
        console.error("[SilentDelete] Error:", err);
        return false;
    }
}

let patches: (() => void)[] = [];
let isLoaded = false;

export default {
    onLoad() {
        if (isLoaded) {
            logger.warn("[SilentDelete] Already loaded, skipping.");
            return;
        }
        isLoaded = true;

        storage.replacementText ??= "** **";
        storage.deleteDelay ??= 200;
        storage.suppressNotifications ??= true;

        // Try all known names for the message context menu across Revenge/Vendetta builds
        const candidateNames = [
            "MessageLongPressActionSheet",
            "MessageContextMenu",
            "MessageContextMenuActionSheet",
            "MessageMenu",
            "LongPressActionSheet",
            "MessageActionSheet",
        ];

        let menuModule: any = null;
        let foundName = "";

        for (const name of candidateNames) {
            const mod = findByName(name, false);
            if (mod) {
                menuModule = mod;
                foundName = name;
                break;
            }
        }

        // If named lookups all failed, scan every module for a message-related action sheet
        if (!menuModule) {
            menuModule = find((m: any) => {
                const name: string = m?.default?.name ?? m?.name ?? "";
                const lower = name.toLowerCase();
                if (
                    (lower.includes("message") && lower.includes("menu")) ||
                    (lower.includes("message") && lower.includes("action")) ||
                    (lower.includes("message") && lower.includes("longpress")) ||
                    (lower.includes("message") && lower.includes("press"))
                ) {
                    foundName = name;
                    return true;
                }
                return false;
            });
        }

        if (!menuModule) {
            // Dump all module names containing "message" so we can identify the right one
            logger.warn("[SilentDelete] Could not find menu module. Dumping message-related modules:");
            find((m: any) => {
                const name: string = m?.default?.name ?? m?.name ?? "";
                if (name.toLowerCase().includes("message")) {
                    logger.log(`[SilentDelete] >> ${name}`);
                }
                return false;
            });
            return;
        }

        logger.log(`[SilentDelete] Using module: ${foundName}`);

        const ButtonComponent = findByProps("TableRowIcon") ?? findByProps("Button");
        logger.log("[SilentDelete] ButtonComponent keys: " + Object.keys(ButtonComponent ?? {}).join(", "));

        const unpatch = after("default", menuModule, (args: any[], res: any) => {
            const message = args[0]?.message;
            if (!message) return res;

            const UserStore = findByProps("getCurrentUser");
            const currentUser = UserStore?.getCurrentUser();

            // Only show button on our own messages
            if (!currentUser || message.author?.id !== currentUser.id) return res;

            const channelId: string = message.channel_id;
            const messageId: string = message.id;

            const silentDeleteButton = React.createElement(
                ButtonComponent?.TableRowIcon ?? ButtonComponent?.Button,
                {
                    label: "Silent Delete",
                    variant: "destructive",
                    onPress: () => {
                        silentDeleteMessage(channelId, messageId);
                    },
                }
            );

            if (res?.props?.children) {
                if (Array.isArray(res.props.children)) {
                    res.props.children.push(silentDeleteButton);
                } else {
                    res.props.children = [res.props.children, silentDeleteButton];
                }
            }

            return res;
        });

        patches.push(unpatch);
        logger.log("[SilentDelete] Loaded — context menu button injected.");
    },

    onUnload() {
        for (const unpatch of patches) unpatch();
        patches = [];
        isLoaded = false;
        logger.log("[SilentDelete] Unloaded.");
    },

    settings: Settings,
};
