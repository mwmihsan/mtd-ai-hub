import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  TrendingUp,
  ShoppingCart,
  Receipt,
  UtensilsCrossed,
  Loader2,
} from "lucide-react";

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

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [filesRes, rowsRes] = await Promise.all([
      supabase.from("uploaded_files").select("*").order("upload_date", { ascending: false }),
      supabase.from("account_rows").select("*"),
    ]);
    if (filesRes.data) setFiles(filesRes.data as FileRecord[]);
    if (rowsRes.data) {
      // Filter empty rows
      const valid = (rowsRes.data as AccountRow[]).filter(
        (r) => r.date || r.account || r.sub_account || r.description || Number(r.debit) > 0 || Number(r.credit) > 0
      );
      setRows(valid);
    }
    setLoading(false);
  }

  const months = useMemo(() => {
    const unique = [...new Set(files.map((f) => f.month))];
    return unique.sort();
  }, [files]);

  const filteredRows = useMemo(() => {
    if (selectedMonth === "all") return rows;
    const fileIds = files.filter((f) => f.month === selectedMonth).map((f) => f.id);
    return rows.filter((r) => fileIds.includes(r.file_id));
  }, [rows, files, selectedMonth]);

  const totalSales = useMemo(
    () => filteredRows.filter((r) => r.account?.toLowerCase() === "sale").reduce((s, r) => s + Number(r.credit), 0),
    [filteredRows]
  );
  const totalPurchase = useMemo(
    () => filteredRows.filter((r) => r.account?.toLowerCase() === "purchase").reduce((s, r) => s + Number(r.debit), 0),
    [filteredRows]
  );
  const totalExpense = useMemo(
    () => filteredRows.filter((r) => r.account?.toLowerCase() === "expense").reduce((s, r) => s + Number(r.debit), 0),
    [filteredRows]
  );
  const mealsExpense = useMemo(
    () =>
      filteredRows
        .filter(
          (r) =>
            r.account?.toLowerCase() === "expense" &&
            (r.sub_account?.toLowerCase().includes("meal") || r.description?.toLowerCase().includes("meal"))
        )
        .reduce((s, r) => s + Number(r.debit), 0),
    [filteredRows]
  );

  // Chart data: per-month aggregates
  const monthlyChartData = useMemo(() => {
    const monthMap: Record<string, { month: string; sales: number; purchase: number; expense: number; meals: number; staff: number }> = {};
    for (const file of files) {
      if (!monthMap[file.month]) {
        monthMap[file.month] = { month: file.month, sales: 0, purchase: 0, expense: 0, meals: 0, staff: 0 };
      }
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
            <SelectTrigger className="w-[200px]">
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

        {/* Summary cards - 4 cards without Staff Salary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Card key={card.title} className="animate-fade-in transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{card.title}</CardTitle>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-foreground">{fmt(card.value)}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts */}
        {monthlyChartData.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Sales chart */}
            <Card className="animate-fade-in">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-foreground">Monthly Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <BarChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="sales" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Expense chart */}
            <Card className="animate-fade-in">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-foreground">Monthly Expenses</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <BarChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="expense" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Purchase chart */}
            <Card className="animate-fade-in">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-foreground">Monthly Purchases</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <BarChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="purchase" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Meals chart - separate */}
            <Card className="animate-fade-in">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-foreground">Monthly Meals Expense</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <BarChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="meals" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Staff Salary chart - separate */}
            <Card className="animate-fade-in">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-foreground">Monthly Staff Salary</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <BarChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="staff" fill="hsl(var(--ring))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {monthlyChartData.length === 0 && (
          <Card>
            <CardContent className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No data yet. Upload Excel files in Accounts Hub to see charts.
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
