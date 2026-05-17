export type TransactionGroup = {
  account: string;
  transactions: Transaction[];
}

export type TransactionList = {
  groups: TransactionGroup[];
  pluginName: string;
}

export type ActualBudgetAccount = {
  id: string;
  name: string;
}

export function emptyTransactionStore(): TransactionList {
  return { groups: [], pluginName: "" }
}

export type AppStorage = {
  transactionStore: TransactionList;
  actualBudgetAccounts: ActualBudgetAccount[];
  exportGroup: Transaction[];
}

export type Transaction = {
  type: "withdrawal" | "deposit";
  description: string;
  category_name: string;
  amount: number; // Ensure amount is always positive (absolute value)
  date: string; // Format must be "2025-01-31"
  external_id: string;
  notes?: string | null;
  status?:
  | "pending"
  | "checking"
  | "posting"
  | "success"
  | "error"
  | "duplicate";
};
