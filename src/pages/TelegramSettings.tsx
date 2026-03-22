import { useState, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Bot, Send, Save } from "lucide-react";

export default function TelegramSettings() {
  const [adminChatId, setAdminChatId] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [stockValue, setStockValue] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const { data } = await supabase
      .from("telegram_settings" as any)
      .select("*")
      .eq("id", 1)
      .single();
    if (data) {
      const d = data as any;
      setAdminChatId(d.admin_chat_id || "");
      setBotUsername(d.bot_username || "");
      setStockValue(String(d.stock_value || 0));
      setIsActive(d.is_active || false);
    }
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from("telegram_settings" as any)
      .update({
        admin_chat_id: adminChatId,
        bot_username: botUsername,
        stock_value: Number(stockValue) || 0,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", 1);
    setSaving(false);
    if (error) {
      toast.error("Failed to save settings");
    } else {
      toast.success("Settings saved");
    }
  }

  async function handleTestConnection() {
    if (!adminChatId) {
      toast.error("Enter Admin Chat ID first");
      return;
    }
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-send", {
        body: { chat_id: adminChatId, text: "✅ Test message from Accounts Hub Bot!" },
      });
      if (error) throw error;
      toast.success("Test message sent! Check your Telegram.");
    } catch {
      toast.error("Failed to send test message");
    }
    setTesting(false);
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Telegram Bot Settings
          </h1>
          <p className="text-muted-foreground mt-1">Configure your Telegram bot for remote account queries</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Bot Configuration</CardTitle>
            <CardDescription>Set up your Telegram bot connection</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Bot Active</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="space-y-2">
              <Label>Admin Chat ID</Label>
              <Input
                placeholder="e.g. 123456789"
                value={adminChatId}
                onChange={(e) => setAdminChatId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Send /start to @userinfobot on Telegram to get your Chat ID</p>
            </div>

            <div className="space-y-2">
              <Label>Bot Username (optional)</Label>
              <Input
                placeholder="e.g. @myaccountsbot"
                value={botUsername}
                onChange={(e) => setBotUsername(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Current Stock Value</Label>
              <Input
                type="number"
                placeholder="0"
                value={stockValue}
                onChange={(e) => setStockValue(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Used for net profit calculation</p>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Settings"}
          </Button>
          <Button onClick={handleTestConnection} disabled={testing} variant="outline" className="flex-1">
            <Send className="h-4 w-4 mr-2" />
            {testing ? "Sending..." : "Test Connection"}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
