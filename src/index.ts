import { findByProps } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";
import Settings from "./Settings";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const ActionSheet = findByProps("openLazy", "hideActionSheet");
const { ActionSheetRow } = findByProps("ActionSheetRow");

// Try several icon names used across Discord versions for the delete/trash icon
const DeleteIcon =
    getAssetIDByName("ic_message_delete") ??
    getAssetIDByName("TrashIcon") ??
    getAssetIDByName("trash") ??
    getAssetIDByName("ic_trash");

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

let unpatchOpenLazy: (() => void) | null = null;

export default {
    onLoad() {
        storage.replacementText ??= "** **";
        storage.deleteDelay ??= 200;
        storage.suppressNotifications ??= true;

        unpatchOpenLazy = before("openLazy", ActionSheet, ([comp, args, msg]) => {
            if (args !== "MessageLongPressActionSheet" || !msg?.message) return;

            const UserStore = findByProps("getCurrentUser");
            const currentUser = UserStore?.getCurrentUser();
            if (!currentUser || msg.message.author?.id !== currentUser.id) return;

            const channelId: string = msg.message.channel_id;
            const messageId: string = msg.message.id;

            comp.then((instance: any) => {
                const unpatch = after("default", instance, (_: any, component: any) => {
                    // Self-cleaning patch — removed after sheet unmounts
                    React.useEffect(() => () => { unpatch(); }, []);

                    // Find the button rows array the same way JumpTo does
                    let buttons = findInReactTree(component, (c: any) =>
                        c?.some?.((child: any) => child?.type?.name === "ActionSheetRow")
                    );

                    if (!buttons?.length) {
                        // Fallback: look inside ActionSheetRowGroups
                        const groups = findInReactTree(component, (c: any) =>
                            c?.[0]?.type?.name === "ActionSheetRowGroup"
                        );
                        if (groups?.length) {
                            const targetGroup = groups[Math.min(1, groups.length - 1)];
                            buttons = findInReactTree(targetGroup, (c: any) =>
                                c?.some?.((child: any) => child?.type?.name === "ActionSheetRow")
                            );
                        }
                    }

                    if (!buttons?.length) {
                        logger.warn("[SilentDelete] Could not find buttons array");
                        return;
                    }

                    // Find the Delete Message button and insert Silent Delete just ABOVE it
                    const deleteIndex = buttons.findIndex((c: any) =>
                        c?.props?.message?.toLowerCase?.()?.includes?.("delete") ||
                        c?.props?.label?.toLowerCase?.()?.includes?.("delete")
                    );
                    const insertAt = deleteIndex >= 0 ? deleteIndex : buttons.length;

                    buttons.splice(insertAt, 0,
                        React.createElement(
                            ActionSheetRow.Group,
                            null,
                            React.createElement(ActionSheetRow, {
                                label: "Silent Delete",
                                destructive: true,
                                icon: (
                                    <RN.View style={{ tintColor: "#ed4245" }}>
                                        <ActionSheetRow.Icon
                                            source={DeleteIcon}
                                            color="#ed4245"
                                        />
                                    </RN.View>
                                ),
                                onPress: () => {
                                    ActionSheet.hideActionSheet();
                                    silentDeleteMessage(channelId, messageId);
                                },
                            })
                        )
                    );
                });
            });
        });

        logger.log("[SilentDelete] Loaded.");
    },

    onUnload() {
        unpatchOpenLazy?.();
        unpatchOpenLazy = null;
        logger.log("[SilentDelete] Unloaded.");
    },

    settings: Settings,
};
