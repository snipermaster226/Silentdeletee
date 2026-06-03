import { findByProps, find } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";
import { React, ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const { Button } = findByProps("TableRow", "Button");
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
let sheetPatched = false; // guard — only patch the sheet component once

export default {
    onLoad() {
        if (isLoaded) return;
        isLoaded = true;

        storage.replacementText ??= "** **";
        storage.deleteDelay ??= 200;
        storage.suppressNotifications ??= true;

        const unpatch = after("openLazy", LazyActionSheet, (args: any[]) => {
            const [component, key] = args;
            if (key !== "MessageLongPressActionSheet") return;
            if (sheetPatched) return; // already patched, don't stack

            component?.then?.((sheet: any) => {
                if (sheetPatched) return;
                sheetPatched = true;

                const sheetModule = sheet?.default ? sheet : { default: sheet };

                const innerUnpatch = after("default", sheetModule, (innerArgs: any[], res: any) => {
                    const message = innerArgs[0]?.message;
                    if (!message) return res;

                    const UserStore = findByProps("getCurrentUser");
                    const currentUser = UserStore?.getCurrentUser();
                    if (!currentUser || message.author?.id !== currentUser.id) return res;

                    // Dump the res tree so we can find where the buttons live
                    try {
                        const summarize = (node: any, depth = 0): string => {
                            if (depth > 4 || !node) return String(node);
                            if (Array.isArray(node)) return `[Array(${node.length}): ${node.map(n => summarize(n, depth+1)).join(", ")}]`;
                            if (typeof node === "object") {
                                const type = node?.type?.name ?? node?.type?.displayName ?? node?.type ?? "?";
                                const childCount = Array.isArray(node?.props?.children) ? node.props.children.length : (node?.props?.children ? 1 : 0);
                                return `<${type} children=${childCount}>`;
                            }
                            return String(node);
                        };
                        logger.log("[SilentDelete] res: " + summarize(res));
                    } catch(e) {
                        logger.log("[SilentDelete] dump error: " + String(e));
                    }

                    const channelId: string = message.channel_id;
                    const messageId: string = message.id;

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
                logger.log("[SilentDelete] Sheet patched.");
            });
        });

        patches.push(unpatch);
        logger.log("[SilentDelete] Loaded.");
    },

    onUnload() {
        for (const unpatch of patches) unpatch();
        patches = [];
        isLoaded = false;
        sheetPatched = false;
        logger.log("[SilentDelete] Unloaded.");
    },

    settings: Settings,
};
