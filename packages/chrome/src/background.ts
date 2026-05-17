import { toCSV } from "@openbanker/core/utils";
import { type AppStorage } from "@openbanker/core/types";

const CHROME_STORAGE_STRATEGY = "local";

chrome.runtime.onMessage.addListener(async (message, sender, _sendResponse) => {
  if (message.name === "openbanker-transactions-csv-request") {
    const result = await chrome.storage[CHROME_STORAGE_STRATEGY].get(["transactionStore", "exportGroup"]) as Partial<AppStorage>;

    // exportGroup is set by SyncAccountsButton for per-group export; fall back to all transactions
    const transactions = result.exportGroup
      ?? result.transactionStore?.groups?.flatMap(g => g.transactions)
      ?? [];

    const csvContent = toCSV(transactions);

    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        name: "openbanker-transactions-csv-response",
        transactions: csvContent,
      });
    }

    if (result.exportGroup) {
      chrome.storage[CHROME_STORAGE_STRATEGY].remove("exportGroup");
    }
    return;
  }

  if (message.name === "openbanker-sync-accounts") {
    const keyToSet: keyof AppStorage = "actualBudgetAccounts";
    chrome.storage[CHROME_STORAGE_STRATEGY].set({ [keyToSet]: message.accounts })
    return;
  }
});
