import { useEffect } from "react";

import "./App.css";
import config from "@/config";

import TransactionsTable from "@/components/TransactionsTable";
import ActionButtons from "@/components/ActionButtons";
import SyncAccountsButton from "@/components/ActionButtons/SyncAccountsButton";
import EmptyState from "@/components/EmptyState";
import { emptyTransactionStore, type TransactionGroup, type Transaction } from "@openbanker/core/types";
import { getChromeContext } from "@/lib/utils";
import useChromeStorage from "@/hooks/useChromeStorage";

export default function App() {
  const [transactionStore, setTransactionStore] = useChromeStorage("transactionStore", emptyTransactionStore())

  useEffect(() => {
    if (getChromeContext() !== 'extension') return;

    // Reset chrome storage
    setTransactionStore(emptyTransactionStore())

    async function detectTransactions() {
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.url || !tab.id) return;

      const plugin = config.plugins.find(p => p.urlPattern.test(tab.url ?? "FALLBACK"));
      if (plugin !== undefined) {

        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: plugin.scrapeFunc,
        });

        if (res && res[0] && res[0].result) {
          const raw = res[0].result as TransactionGroup[] | Transaction[];
          let groups: TransactionGroup[];
          if (Array.isArray(raw) && raw.length > 0 && 'account' in raw[0]) {
            groups = raw as TransactionGroup[];
          } else {
            groups = [{ account: plugin.name, transactions: raw as Transaction[] }];
          }
          setTransactionStore({ pluginName: plugin.name, groups });
        }

      }
    }
    detectTransactions();

  }, []);

  const hasData = transactionStore.pluginName !== "";
  const multiGroup = transactionStore.groups.length > 1;

  return (
    <div className="m-5 flex flex-col space-y-5 min-w-[600px]">
      <div className="flex justify-between">
        <div className="flex space-x-1">
          <div className="text-3xl font-bold">OpenBanker</div>
          <pre className="flex items-start bg-blue-200 h-fit py-1 px-2 rounded scale-80">
            v0.0.1
          </pre>
        </div>

        <ActionButtons />
      </div>

      {
        hasData && (
          <div className="font-bold">
            Plugin: {transactionStore.pluginName}
          </div>
        )
      }

      {!hasData ? <EmptyState /> : (
        transactionStore.groups.map(group => (
          <div key={group.account} className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              {multiGroup && (
                <span className="font-semibold">
                  {group.account}
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({group.transactions.length})
                  </span>
                </span>
              )}
              <SyncAccountsButton group={group} />
            </div>
            <TransactionsTable transactions={group.transactions} />
          </div>
        ))
      )}
    </div>
  );
}
