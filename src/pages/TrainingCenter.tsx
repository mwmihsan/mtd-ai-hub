import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type Alias = { id: string; sub_account_name: string; alias: string; created_at: string };
type Intent = { id: string; example_text: string; intent: string; description: string | null; created_at: string };
type Correction = { id: string; original_query: string; correct_result: string; wrong_result: string | null; usage_count: number; created_at: string };
type Feedback = { id: string; chat_id: number; query: string | null; response_summary: string | null; rating: string; created_at: string };
type Memory = { chat_id: number; pending: any; context: any; updated_at: string; expires_at: string };
type Account = { account_id: string; account_name: string; account_type: string | null; mobile: string | null; status: string; created_at: string };

export default function TrainingCenter() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth", { replace: true });
        return;
      }
      if (!mounted) return;
      setUserEmail(session.user.email ?? null);
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      const admin = !!roles?.some((r) => r.role === "admin");
      setIsAdmin(admin);
      setChecking(false);
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate("/auth", { replace: true });
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [navigate]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  }

  async function claimAdmin() {
    const { data, error } = await supabase.rpc("claim_first_admin");
    if (error) return toast.error(error.message);
    if (data === true) {
      toast.success("You are now admin");
      setIsAdmin(true);
    } else {
      toast.error("An admin already exists. Ask them to grant you access.");
    }
  }

  if (checking) {
    return (
      <AppLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <Card className="mx-auto mt-12 max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Admin access required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-mono">{userEmail}</span>. Your account doesn't have the
              admin role. If no admin exists yet, claim the role below.
            </p>
            <Button onClick={claimAdmin} className="w-full">Claim admin (first user only)</Button>
            <Button variant="outline" onClick={signOut} className="w-full">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">AI Training Center</h1>
            <p className="text-sm text-muted-foreground">Teach the bot. Track what it learns.</p>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>

        <Tabs defaultValue="aliases" className="w-full">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="aliases">Aliases</TabsTrigger>
            <TabsTrigger value="intents">Intents</TabsTrigger>
            <TabsTrigger value="corrections">Corrections</TabsTrigger>
            <TabsTrigger value="feedback">Feedback</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
          </TabsList>

          <TabsContent value="accounts"><AccountsTab /></TabsContent>
          <TabsContent value="aliases"><AliasesTab /></TabsContent>
          <TabsContent value="intents"><IntentsTab /></TabsContent>
          <TabsContent value="corrections"><CorrectionsTab /></TabsContent>
          <TabsContent value="feedback"><FeedbackTab /></TabsContent>
          <TabsContent value="memory"><MemoryTab /></TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

/* ---------------- Aliases ---------------- */
function AliasesTab() {
  const [rows, setRows] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState("");
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("account_aliases").select("*").order("created_at", { ascending: false });
    setRows((data as Alias[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("account_aliases").insert({
      sub_account_name: sub.trim(),
      alias: alias.trim().toLowerCase(),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setSub(""); setAlias("");
    toast.success("Alias added");
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("account_aliases").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-sm">Account aliases</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={add} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1"><Label className="text-xs">Sub-account name</Label><Input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="M.N.M NISRAN" required /></div>
          <div className="space-y-1"><Label className="text-xs">Alias / nickname</Label><Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="mnm" required /></div>
          <Button type="submit" disabled={saving} className="self-end">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="ml-1">Add</span>
          </Button>
        </form>
        <div className="mt-4 overflow-x-auto">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Alias</TableHead><TableHead>Sub-account</TableHead><TableHead className="w-[80px]"></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.alias}</TableCell>
                    <TableCell>{r.sub_account_name}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground">No aliases yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Intents ---------------- */
const INTENT_OPTIONS = ["sales", "purchase", "profit", "expense", "stock", "report", "customer_ledger", "help"];

function IntentsTab() {
  const [rows, setRows] = useState<Intent[]>([]);
  const [loading, setLoading] = useState(true);
  const [example, setExample] = useState("");
  const [intent, setIntent] = useState("sales");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("intent_training").select("*").order("created_at", { ascending: false });
    setRows((data as Intent[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("intent_training").insert({
      example_text: example.trim().toLowerCase(),
      intent,
      description: desc.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setExample(""); setDesc("");
    toast.success("Intent added");
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("intent_training").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-sm">Intent training</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={add} className="grid grid-cols-1 gap-2 sm:grid-cols-[1.5fr_1fr_1.5fr_auto]">
          <div className="space-y-1"><Label className="text-xs">Example phrase</Label><Input value={example} onChange={(e) => setExample(e.target.value)} placeholder="april sales" required /></div>
          <div className="space-y-1">
            <Label className="text-xs">Intent</Label>
            <select value={intent} onChange={(e) => setIntent(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {INTENT_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="optional" /></div>
          <Button type="submit" disabled={saving} className="self-end">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="ml-1">Add</span>
          </Button>
        </form>
        <div className="mt-4 overflow-x-auto">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Phrase</TableHead><TableHead>Intent</TableHead><TableHead>Notes</TableHead><TableHead className="w-[60px]"></TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.example_text}</TableCell>
                    <TableCell><Badge variant="secondary">{r.intent}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.description}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">No intents trained yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Corrections ---------------- */
function CorrectionsTab() {
  const [rows, setRows] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("corrections").select("*").order("usage_count", { ascending: false }).limit(200);
    setRows((data as Correction[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    const { error } = await supabase.from("corrections").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-sm">User corrections</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Original query</TableHead><TableHead>Correct answer</TableHead><TableHead>Used</TableHead><TableHead className="w-[60px]"></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.original_query}</TableCell>
                  <TableCell className="text-xs">{r.correct_result}</TableCell>
                  <TableCell><Badge variant="outline">{r.usage_count}</Badge></TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">No corrections recorded</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Feedback ---------------- */
function FeedbackTab() {
  const [rows, setRows] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("feedback").select("*").order("created_at", { ascending: false }).limit(200);
      setRows((data as Feedback[]) || []);
      setLoading(false);
    })();
  }, []);

  const up = rows.filter((r) => r.rating === "up").length;
  const down = rows.filter((r) => r.rating === "down").length;
  const total = rows.length;
  const accuracy = total > 0 ? Math.round((up / total) * 100) : 0;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Total feedback</div><div className="text-2xl font-bold">{total}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">👍 Positive</div><div className="text-2xl font-bold text-success">{up}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Accuracy</div><div className="text-2xl font-bold">{accuracy}%</div></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Recent feedback</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Query</TableHead><TableHead>Rating</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{r.query}</TableCell>
                    <TableCell>{r.rating === "up" ? "👍" : "👎"}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground">No feedback yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------- Memory ---------------- */
function MemoryTab() {
  const [rows, setRows] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("telegram_conversation_state")
      .select("chat_id, pending, context, updated_at, expires_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    setRows((data as Memory[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  async function clearAll() {
    const { error } = await supabase.from("telegram_conversation_state").delete().gte("chat_id", -9223372036854775000);
    if (error) return toast.error(error.message);
    toast.success("Memory cleared");
    load();
  }

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Conversation memory</CardTitle>
        <Button variant="outline" size="sm" onClick={clearAll}><Trash2 className="mr-2 h-4 w-4" />Clear all</Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Chat</TableHead><TableHead>Pending</TableHead><TableHead>Context</TableHead><TableHead>Updated</TableHead><TableHead>Expires</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.chat_id}>
                  <TableCell className="font-mono text-xs">{r.chat_id}</TableCell>
                  <TableCell className="text-xs"><pre className="whitespace-pre-wrap text-[10px]">{r.pending ? JSON.stringify(r.pending, null, 0) : "—"}</pre></TableCell>
                  <TableCell className="text-xs"><pre className="whitespace-pre-wrap text-[10px]">{r.context && Object.keys(r.context).length ? JSON.stringify(r.context, null, 0) : "—"}</pre></TableCell>
                  <TableCell className="text-xs">{new Date(r.updated_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{new Date(r.expires_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No active sessions</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}