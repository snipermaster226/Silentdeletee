import { findByProps, findByName } from "@vendetta/metro";
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

        // Find the message long-press context menu
        const MessageLongPressActionSheet = findByName("MessageLongPressActionSheet", false);
        if (!MessageLongPressActionSheet) {
            logger.warn("[SilentDelete] MessageLongPressActionSheet not found");
            return;
        }

        const ButtonComponent = findByProps("TableRowIcon") ?? findByProps("Button");
        console.log("[SilentDelete] ButtonComponent keys:", Object.keys(ButtonComponent ?? {}).join(", "));

        const unpatch = after("default", MessageLongPressActionSheet, (args: any[], res: any) => {
            const message = args[0]?.message;
            if (!message) return res;

            const UserStore = findByProps("getCurrentUser");
            const currentUser = UserStore?.getCurrentUser();

            // Only show button on our own messages
            if (!currentUser || message.author?.id !== currentUser.id) return res;

            const channelId: string = message.channel_id;
            const messageId: string = message.id;

            // Build the Silent Delete button
            const silentDeleteButton = React.createElement(
                ButtonComponent?.TableRowIcon ?? ButtonComponent?.Button,
                {
                    label: "Silent Delete",
                    icon: findByProps("trash") ?? undefined,
                    variant: "destructive",
                    onPress: () => {
                        silentDeleteMessage(channelId, messageId);
                    },
                }
            );

            // Append our button to the existing action sheet children
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
