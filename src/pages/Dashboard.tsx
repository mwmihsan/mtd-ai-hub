import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
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

export default function Dashboard() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    // Fetch all rows with pagination
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

  // Helper to match account type case-insensitively
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

  // Chart data per month
  const monthlyChartData = useMemo(() => {
    const monthMap: Record<string, { month: string; sales: number; purchase: number; expense: number; meals: number; staff: number }> = {};
    for (const file of files) {
      if (!monthMap[file.month]) monthMap[file.month] = { month: file.month, sales: 0, purchase: 0, expense: 0, meals: 0, staff: 0 };
    }
    for (const row of rows) {
      const file = files.find((f) => f.id === row.file_id);
      if (!file) continue;
      const m = monthMap[file.month];
      if (!m) continue;
      const acc = row.account?.toLowerCase() || "";
      const sub = row.sub_account?.toLowerCase() || "";
      const desc = row.description?.toLowerCase() || "";
      if (acc === "sale") m.sales += Number(row.credit);
      if (acc === "purchase") m.purchase += Number(row.debit);
      if (acc === "expense") {
        m.expense += Number(row.debit);
        if (sub.includes("meal") || desc.includes("meal")) m.meals += Number(row.debit);
      }
      if (acc === "staff" || acc === "workers" || sub.includes("salary") || desc.includes("salary")) {
        m.staff += Number(row.debit);
      }
    }
    return Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
  }, [rows, files]);

  const chartConfig = {
    sales: { label: "Sales", color: "hsl(var(--success))" },
    purchase: { label: "Purchase", color: "hsl(var(--primary))" },
    expense: { label: "Expense", color: "hsl(var(--destructive))" },
    meals: { label: "Meals", color: "hsl(var(--warning))" },
    staff: { label: "Staff Salary", color: "hsl(var(--ring))" },
  };

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const cards = [
    { title: "Total Sales", value: totalSales, icon: TrendingUp, color: "text-success" },
    { title: "Total Purchase", value: totalPurchase, icon: ShoppingCart, color: "text-primary" },
    { title: "Total Expense", value: totalExpense, icon: Receipt, color: "text-destructive" },
    { title: "Meals Expense", value: mealsExpense, icon: UtensilsCrossed, color: "text-warning" },
    { title: "Staff Salary", value: staffSalary, icon: Users, color: "text-ring" },
  ];

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

        {/* Charts */}
        {monthlyChartData.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {([
              { key: "sales", title: "Monthly Sales", color: "hsl(var(--success))" },
              { key: "expense", title: "Monthly Expenses", color: "hsl(var(--destructive))" },
              { key: "purchase", title: "Monthly Purchases", color: "hsl(var(--primary))" },
              { key: "meals", title: "Monthly Meals Expense", color: "hsl(var(--warning))" },
              { key: "staff", title: "Monthly Staff Salary", color: "hsl(var(--ring))" },
            ] as const).map((chart) => (
              <Card key={chart.key} className="animate-fade-in">
                <CardHeader className="px-3 pt-3 pb-1">
                  <CardTitle className="text-xs sm:text-sm font-semibold text-foreground">{chart.title}</CardTitle>
                </CardHeader>
                <CardContent className="px-1 pb-3 sm:px-3">
                  <ChartContainer config={chartConfig} className="h-[200px] sm:h-[280px] w-full">
                    <BarChart data={monthlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} width={50} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey={chart.key} fill={chart.color} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {monthlyChartData.length === 0 && (
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
