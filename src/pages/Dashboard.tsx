import React, { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { TrendingUp, ShoppingCart, Receipt, UtensilsCrossed, Loader2, Users } from "lucide-react";

interface AccountRow {
  id: string;
  file_id: string;
  date: string;
  account: string;
  sub_account: string;
  description: string;
  debit: number;
  credit: number;
}

interface FileRecord {
  id: string;
  file_name: string;
  month: string;
  upload_date: string;
  row_count: number;
}

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--ring))",
  "hsl(210 70% 50%)",
  "hsl(280 60% 55%)",
  "hsl(30 80% 50%)",
  "hsl(170 60% 40%)",
  "hsl(350 70% 50%)",
];

export default function Dashboard() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    let allRows: AccountRow[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase.from("account_rows").select("*").range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      allRows = [...allRows, ...(data as AccountRow[])];
      if (data.length < pageSize) break;
      from += pageSize;
    }

    const [filesRes] = await Promise.all([
      supabase.from("uploaded_files").select("*").order("upload_date", { ascending: false }),
    ]);
    if (filesRes.data) setFiles(filesRes.data as FileRecord[]);

    const valid = allRows.filter(
      (r) => r.date || r.account || r.sub_account || r.description || Number(r.debit) > 0 || Number(r.credit) > 0
    );
    setRows(valid);
    setLoading(false);
  }

  const months = useMemo(() => [...new Set(files.map((f) => f.month))].sort(), [files]);

  const filteredRows = useMemo(() => {
    if (selectedMonth === "all") return rows;
    const fileIds = files.filter((f) => f.month === selectedMonth).map((f) => f.id);
    return rows.filter((r) => fileIds.includes(r.file_id));
  }, [rows, files, selectedMonth]);

  const matchAccount = (row: AccountRow, ...types: string[]) =>
    types.some((t) => row.account?.toLowerCase() === t.toLowerCase());

  const totalSales = useMemo(
    () => filteredRows.filter((r) => matchAccount(r, "sale")).reduce((s, r) => s + Number(r.credit), 0),
    [filteredRows]
  );
  const totalPurchase = useMemo(
    () => filteredRows.filter((r) => matchAccount(r, "purchase")).reduce((s, r) => s + Number(r.debit), 0),
    [filteredRows]
  );
  const totalExpense = useMemo(
    () => filteredRows.filter((r) => matchAccount(r, "expense")).reduce((s, r) => s + Number(r.debit), 0),
    [filteredRows]
  );
  const mealsExpense = useMemo(
    () =>
      filteredRows
        .filter(
          (r) =>
            matchAccount(r, "expense") &&
            (r.sub_account?.toLowerCase().includes("meal") ||
              r.description?.toLowerCase().includes("meal"))
        )
        .reduce((s, r) => s + Number(r.debit), 0),
    [filteredRows]
  );
  const staffSalary = useMemo(
    () =>
      filteredRows
        .filter(
          (r) =>
            matchAccount(r, "staff", "workers") ||
            r.sub_account?.toLowerCase().includes("salary") ||
            r.description?.toLowerCase().includes("salary")
        )
        .reduce((s, r) => s + Number(r.debit), 0),
    [filteredRows]
  );

  // Build sub-account breakdown charts per account type
  const buildSubAccountData = (accountTypes: string[], useCredit = false) => {
    const matching = filteredRows.filter((r) => matchAccount(r, ...accountTypes));
    const subMap: Record<string, number> = {};
    for (const r of matching) {
      const sub = r.sub_account?.trim() || r.description?.trim() || "Other";
      subMap[sub] = (subMap[sub] || 0) + Number(useCredit ? r.credit : r.debit);
    }
    return Object.entries(subMap)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  };

  const salesSubData = useMemo(() => buildSubAccountData(["sale"], true), [filteredRows]);
  const purchaseSubData = useMemo(() => buildSubAccountData(["purchase"]), [filteredRows]);
  const expenseSubData = useMemo(() => buildSubAccountData(["expense"]), [filteredRows]);
  const staffSubData = useMemo(() => buildSubAccountData(["staff", "workers"]), [filteredRows]);
  const mealsSubData = useMemo(() => {
    const matching = filteredRows.filter(
      (r) =>
        matchAccount(r, "expense") &&
        (r.sub_account?.toLowerCase().includes("meal") || r.description?.toLowerCase().includes("meal"))
    );
    const subMap: Record<string, number> = {};
    for (const r of matching) {
      const sub = r.sub_account?.trim() || r.description?.trim() || "Other";
      subMap[sub] = (subMap[sub] || 0) + Number(r.debit);
    }
    return Object.entries(subMap)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredRows]);

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const cards = [
    { title: "Total Sales", value: totalSales, icon: TrendingUp, color: "text-success" },
    { title: "Total Purchase", value: totalPurchase, icon: ShoppingCart, color: "text-primary" },
    { title: "Total Expense", value: totalExpense, icon: Receipt, color: "text-destructive" },
    { title: "Meals Expense", value: mealsExpense, icon: UtensilsCrossed, color: "text-warning" },
    { title: "Staff Salary", value: staffSalary, icon: Users, color: "text-ring" },
  ];

  const chartSections = [
    { title: "Sales by Sub-Account", data: salesSubData, accentColor: "hsl(var(--success))" },
    { title: "Purchase by Sub-Account", data: purchaseSubData, accentColor: "hsl(var(--primary))" },
    { title: "Expense by Sub-Account", data: expenseSubData, accentColor: "hsl(var(--destructive))" },
    { title: "Staff by Sub-Account", data: staffSubData, accentColor: "hsl(var(--ring))" },
    { title: "Meals by Sub-Account", data: mealsSubData, accentColor: "hsl(var(--warning))" },
  ];

  const chartConfig = {
    amount: { label: "Amount", color: "hsl(var(--primary))" },
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Shop accounts summary</p>
          </div>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Select month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Months</SelectItem>
              {months.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((card) => (
            <Card key={card.title} className="animate-fade-in transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 px-3 pt-3">
                <CardTitle className="text-[10px] sm:text-xs font-medium text-muted-foreground">{card.title}</CardTitle>
                <card.icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${card.color}`} />
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="text-base sm:text-xl font-bold text-foreground">{fmt(card.value)}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Sub-account breakdown charts */}
        {filteredRows.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {chartSections.map((section) => (
              <Card key={section.title} className="animate-fade-in">
                <CardHeader className="px-3 pt-3 pb-1">
                  <CardTitle className="text-xs sm:text-sm font-semibold text-foreground">{section.title}</CardTitle>
                </CardHeader>
                <CardContent className="px-1 pb-3 sm:px-3">
                  {section.data.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[220px] sm:h-[300px] w-full">
                      <BarChart data={section.data} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                        <YAxis
                          dataKey="name"
                          type="category"
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                          width={90}
                        />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="amount" fill={section.accentColor} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
                      No data available
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No data yet. Upload Excel files in Admin Panel to see charts.
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}