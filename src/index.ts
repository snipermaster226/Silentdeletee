// SilentDelete - Revenge Plugin
// Compiled single-file bundle

const { findByProps } = vendetta.metro;
const { before } = vendetta.patcher;
const { storage } = vendetta.plugin;
const { logger } = vendetta;
const { registerCommand, unregisterAllCommands } = vendetta.commands;
const { getAssetIDByName } = vendetta.ui.assets;
const { showToast } = vendetta.ui.toasts;
const { React, ReactNative, stylesheet } = vendetta.metro.common;
const { Forms } = vendetta.ui.components;
const { useProxy } = vendetta.storage;

// ─── Utils ────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function silentDeleteMessage(channelId, messageId) {
    const RestAPI = findByProps("get", "post", "del", "patch");

    try {
        const replacementText = storage.replacementText ?? "** **";
        const deleteDelay = storage.deleteDelay ?? 200;
        const suppressNotifications = storage.suppressNotifications ?? true;
        const shouldDelete = storage.deleteOriginal ?? true;

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
        await RestAPI.del({
            url: `/channels/${channelId}/messages/${response.body.id}`,
        });

        if (shouldDelete) {
            await sleep(100);
            await RestAPI.del({
                url: `/channels/${channelId}/messages/${messageId}`,
            });
        }

        return true;
    } catch (err) {
        console.error("[SilentDelete] Error:", err);
        return false;
    }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function loadCommands() {
    registerCommand({
        name: "silentpurge",
        description: "Silently delete your recent messages in this channel",
        options: [
            {
                name: "count",
                description: "Number of your recent messages to silently delete (1-100)",
                type: 4,
                required: true,
            },
        ],
        execute: async (args, ctx) => {
            const countArg = args?.find((o) => o.name === "count");
            const count = parseInt(countArg?.value);
            if (!count || count < 1 || count > 100) {
                showToast("Please provide a count between 1 and 100.", getAssetIDByName("failure-header"));
                return;
            }

            const channelId = ctx?.channel?.id;
            if (!channelId) return;

            const RestAPI = findByProps("get", "post", "del", "patch");
            const UserStore = findByProps("getCurrentUser");
            const currentUserId = UserStore.getCurrentUser().id;

            try {
                const userMessages = [];
                let lastMessageId;

                while (userMessages.length < count) {
                    const query = { limit: "100" };
                    if (lastMessageId) query.before = lastMessageId;

                    const response = await RestAPI.get({
                        url: `/channels/${channelId}/messages`,
                        query,
                    });

                    const messages = response?.body ?? [];
                    if (!messages.length) break;

                    for (const msg of messages) {
                        if (msg.author?.id === currentUserId) {
                            userMessages.push(msg);
                            if (userMessages.length >= count) break;
                        }
                    }

                    lastMessageId = messages[messages.length - 1]?.id;
                    if (messages.length < 100) break;
                    await sleep(100);
                }

                if (!userMessages.length) {
                    showToast("No messages found to delete.", getAssetIDByName("failure-header"));
                    return;
                }

                const purgeInterval = storage.purgeInterval ?? 500;
                let successCount = 0;

                for (let i = 0; i < userMessages.length; i++) {
                    if (await silentDeleteMessage(channelId, userMessages[i].id)) {
                        successCount++;
                    }
                    if (i < userMessages.length - 1) await sleep(purgeInterval);
                }

                showToast(
                    `Successfully silently deleted ${successCount} message(s).`,
                    getAssetIDByName("check")
                );
            } catch (err) {
                console.error("[SilentDelete] silentpurge error:", err);
                showToast("An error occurred during purge.", getAssetIDByName("failure-header"));
            }
        },
    });
}

function unloadCommands() {
    unregisterAllCommands();
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SilentDeleteSettings() {
    useProxy(storage);

    storage.replacementText ??= "** **";
    storage.deleteDelay ??= 200;
    storage.suppressNotifications ??= true;
    storage.deleteOriginal ??= true;
    storage.purgeInterval ??= 500;

    const { FormSwitchRow, FormSection, FormDivider, FormInput } = Forms;

    return React.createElement(
        React.Fragment,
        null,
        React.createElement(
            FormSection,
            { title: "Behavior" },
            React.createElement(FormInput, {
                title: "Replacement Text",
                placeholder: "** **",
                value: storage.replacementText,
                onChangeText: (v) => (storage.replacementText = v),
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Suppress Notifications",
                subLabel: "Prevents pinging mentioned users when replacing the message.",
                value: !!storage.suppressNotifications,
                onValueChange: (v) => (storage.suppressNotifications = v),
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Delete Original Message",
                subLabel: "If disabled, the original message will reappear on client restart.",
                value: !!storage.deleteOriginal,
                onValueChange: (v) => (storage.deleteOriginal = v),
            })
        ),
        React.createElement(
            FormSection,
            { title: "Timing (milliseconds)" },
            React.createElement(FormInput, {
                title: "Delete Delay",
                placeholder: "200",
                value: String(storage.deleteDelay ?? 200),
                keyboardType: "numeric",
                onChangeText: (v) => {
                    const n = parseInt(v);
                    if (!isNaN(n)) storage.deleteDelay = n;
                },
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormInput, {
                title: "Purge Interval",
                placeholder: "500",
                value: String(storage.purgeInterval ?? 500),
                keyboardType: "numeric",
                onChangeText: (v) => {
                    const n = parseInt(v);
                    if (!isNaN(n)) storage.purgeInterval = n;
                },
            })
        )
    );
}

// ─── Action Sheet Patch ───────────────────────────────────────────────────────

let patches = [];

function patchMessageActionSheet() {
    const ActionSheetUtils =
        findByProps("showMessageOptionsSheet") ??
        findByProps("showSimpleActionSheet");

    if (!ActionSheetUtils) {
        logger.warn("[SilentDelete] Could not find action-sheet module – button patch skipped.");
        return;
    }

    const UserStore = findByProps("getCurrentUser", "getUser");

    const methodName = ActionSheetUtils.showMessageOptionsSheet
        ? "showMessageOptionsSheet"
        : "showSimpleActionSheet";

    const unpatch = before(methodName, ActionSheetUtils, (args) => {
        const opts = args[0];
        if (!opts || !opts.options) return;

        const currentUserId = UserStore.getCurrentUser()?.id;
        const message = opts.message ?? opts.options?.[0]?.message;
        if (!message) return;

        if (message.author?.id !== currentUserId || message.deleted) return;

        opts.options.push({
            label: "Silent Delete",
            isDestructive: true,
            action: () => silentDeleteMessage(message.channel_id, message.id),
        });
    });

    patches.push(unpatch);
    logger.log("[SilentDelete] Action-sheet patched.");
}

// ─── Plugin export ────────────────────────────────────────────────────────────

module.exports = {
    onLoad() {
        storage.replacementText ??= "** **";
        storage.deleteDelay ??= 200;
        storage.suppressNotifications ??= true;
        storage.deleteOriginal ??= true;
        storage.purgeInterval ??= 500;

        patchMessageActionSheet();
        loadCommands();

        logger.log("[SilentDelete] Loaded.");
    },

    onUnload() {
        for (const unpatch of patches) unpatch();
        patches = [];
        unloadCommands();
        logger.log("[SilentDelete] Unloaded.");
    },

    settings: SilentDeleteSettings,
};
