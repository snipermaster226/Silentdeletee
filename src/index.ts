import { findByProps, find } from "@vendetta/metro";
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
        logger.log("[SilentDelete] Error: " + String(err));
        return false;
    }
}

let patches: (() => void)[] = [];
let isLoaded = false;

export default {
    onLoad() {
        if (isLoaded) return;
        isLoaded = true;

        storage.replacementText ??= "** **";
        storage.deleteDelay ??= 200;
        storage.suppressNotifications ??= true;

        // Find the message context menu by looking for a module that has
        // a "deleteMessage" or "DELETE_MESSAGE" action — the real long press sheet
        const MessageContextMenu = findByProps("useMessageLongPressActionSheet")
            ?? findByProps("MessageContextMenu")
            ?? findByProps("deleteMessage", "pinMessage")
            ?? findByProps("deleteMessage", "editMessage");

        if (!MessageContextMenu) {
            logger.warn("[SilentDelete] Could not find MessageContextMenu by props. Dumping deleteMessage modules:");
            find((m: any) => {
                try {
                    if (m && typeof m === "object" && "deleteMessage" in m) {
                        logger.log("[SilentDelete] >> keys: " + Object.keys(m).slice(0, 10).join(", "));
                    }
                } catch {}
                return false;
            });
            return;
        }

        logger.log("[SilentDelete] Found MessageContextMenu keys: " + Object.keys(MessageContextMenu).join(", "));

        // ModalActionButton is the correct button component from the keys dump
        const { ModalActionButton } = findByProps("ModalActionButton");

        if (!ModalActionButton) {
            logger.warn("[SilentDelete] ModalActionButton not found");
            return;
        }

        // Patch whichever key on the module is a function (the render fn)
        const patchKey = Object.keys(MessageContextMenu).find(
            k => typeof MessageContextMenu[k] === "function"
        );

        if (!patchKey) {
            logger.warn("[SilentDelete] No patchable function found on MessageContextMenu");
            return;
        }

        logger.log("[SilentDelete] Patching key: " + patchKey);

        const unpatch = after(patchKey, MessageContextMenu, (args: any[], res: any) => {
            const message = args[0]?.message ?? args[1]?.message;
            if (!message) return res;

            const UserStore = findByProps("getCurrentUser");
            const currentUser = UserStore?.getCurrentUser();
            if (!currentUser || message.author?.id !== currentUser.id) return res;

            const channelId: string = message.channel_id;
            const messageId: string = message.id;

            const silentDeleteButton = React.createElement(ModalActionButton, {
                text: "Silent Delete",
                iconSource: findByProps("ic_trash")?.ic_trash ?? findByProps("trash")?.trash,
                destructive: true,
                onPress: () => silentDeleteMessage(channelId, messageId),
            });

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
        logger.log("[SilentDelete] Loaded successfully.");
    },

    onUnload() {
        for (const unpatch of patches) unpatch();
        patches = [];
        isLoaded = false;
        logger.log("[SilentDelete] Unloaded.");
    },

    settings: Settings,
};
