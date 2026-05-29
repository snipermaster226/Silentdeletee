import { findByProps } from "@vendetta/metro";
import { instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";
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
        // Prevent double-patching
        if (isLoaded) {
            logger.warn("[SilentDelete] Already loaded, skipping.");
            return;
        }
        isLoaded = true;

        storage.replacementText ??= "** **";
        storage.deleteDelay ??= 200;
        storage.suppressNotifications ??= true;

        const MessageActions = findByProps("deleteMessage", "sendMessage");
        if (!MessageActions) {
            logger.warn("[SilentDelete] MessageActions not found");
            return;
        }

        const unpatch = instead("deleteMessage", MessageActions, (args: any[]) => {
            const channelId: string = args[0];
            const messageId: string = args[1];
            if (!channelId || !messageId) return;
            silentDeleteMessage(channelId, messageId);
        });

        patches.push(unpatch);
        logger.log("[SilentDelete] Loaded — deleteMessage patched.");
    },

    onUnload() {
        for (const unpatch of patches) unpatch();
        patches = [];
        isLoaded = false;
        logger.log("[SilentDelete] Unloaded.");
    },

    settings: Settings,
};
