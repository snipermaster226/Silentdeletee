import { findByProps, find } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";
import { React, ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Same pattern as Stealmoji — grab Button from here
const { Button } = findByProps("TableRow", "Button");

// LazyActionSheet is used to dismiss the sheet after pressing
const LazyActionSheet = findByProps("openLazy", "hideActionSheet");

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

        // Find the message long-press action sheet the same way Stealmoji finds its emoji sheet:
        // look for the module that opens it via openLazy, then patch the component it lazily loads
        const ActionSheetManager = findByProps("openLazy", "hideActionSheet");

        // Patch openLazy to intercept the message long press sheet
        const unpatch = after("openLazy", ActionSheetManager, (args: any[]) => {
            const [component, key] = args;
            if (key !== "MessageLongPressActionSheet") return;

            // Patch the lazily-loaded component
            component?.then?.((sheet: any) => {
                const sheetModule = sheet?.default ? sheet : { default: sheet };
                const innerUnpatch = after("default", sheetModule, (innerArgs: any[], res: any) => {
                    const message = innerArgs[0]?.message;
                    if (!message) return res;

                    const UserStore = findByProps("getCurrentUser");
                    const currentUser = UserStore?.getCurrentUser();
                    if (!currentUser || message.author?.id !== currentUser.id) return res;

                    const channelId: string = message.channel_id;
                    const messageId: string = message.id;

                    // Append the Silent Delete button using the same Button pattern as Stealmoji
                    const silentBtn = React.createElement(Button, {
                        color: Button.Colors?.RED ?? "red",
                        text: "Silent Delete",
                        size: Button.Sizes?.SMALL,
                        onPress: () => {
                            LazyActionSheet?.hideActionSheet();
                            silentDeleteMessage(channelId, messageId);
                        },
                        style: { marginTop: ReactNative.Platform.select({ android: 12, default: 16 }) }
                    });

                    try {
                        if (Array.isArray(res?.props?.children)) {
                            res.props.children.push(silentBtn);
                        } else if (res?.props?.children) {
                            res.props.children = [res.props.children, silentBtn];
                        }
                    } catch (e) {
                        logger.log("[SilentDelete] Inject error: " + String(e));
                    }

                    return res;
                });

                patches.push(innerUnpatch);
                logger.log("[SilentDelete] Patched lazy sheet.");
            });
        });

        patches.push(unpatch);
        logger.log("[SilentDelete] Loaded — watching for MessageLongPressActionSheet.");
    },

    onUnload() {
        for (const unpatch of patches) unpatch();
        patches = [];
        isLoaded = false;
        logger.log("[SilentDelete] Unloaded.");
    },

    settings: Settings,
};
