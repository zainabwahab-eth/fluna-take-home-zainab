import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const n8nWebhookUrl = Deno.env.get("N8N_WEBHOOK_URL")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { companyName, requestor } = body;

    // Validate inputs
    if (!companyName || typeof companyName !== "string" || companyName.trim() === "") {
      return new Response(
        JSON.stringify({ error: "companyName is required and must be a non-empty string" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!requestor || typeof requestor !== "string" || requestor.trim() === "") {
      return new Response(
        JSON.stringify({ error: "requestor is required and must be a non-empty string" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      supabaseUrl ?? "",
      supabaseKey ?? ""
    );

    const cleanCompanyName = companyName.trim();
    const cleanRequestor = requestor.trim();

    // check for recent completed result (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentCompleted, error: checkError } = await supabase
      .from("company_mentions")
      .select("id, company_name, requestor, status, mentions_output, quality_score, quality_reasoning, updated_at")
      .eq("company_name", cleanCompanyName)
      .eq("status", "Completed")
      .gte("updated_at", thirtyDaysAgo.toISOString())
      .order("updated_at", { ascending: false })
      .limit(1);

    if (checkError) throw checkError;

    // Return cached result if found
    if (recentCompleted && recentCompleted.length > 0) {
      const existing = recentCompleted[0];
      return new Response(
        JSON.stringify({
          ...existing,
          cached: true,
          message: `Returning cached result from ${existing.updated_at}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for currently running request for same company
    const { data: runningResult, error: runningError } = await supabase
      .from("company_mentions")
      .select("id, company_name, requestor, status, created_at")
      .eq("company_name", cleanCompanyName)
      .eq("status", "Running")
      .limit(1);

    if (runningError) throw runningError;

    if (runningResult && runningResult.length > 0) {
      return new Response(
        JSON.stringify({
          ...runningResult[0],
          message: "A request for this company is already being processed",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert new row with status Running
    const { data: newRecord, error: insertError } = await supabase
      .from("company_mentions")
      .insert({
        company_name: cleanCompanyName,
        requestor: cleanRequestor,
        status: "Running",
      })
      .select("id, company_name, requestor, status, created_at")
      .single();

    if (insertError) throw insertError;
    if (!newRecord) throw new Error("Failed to create new record");

    // Check n8n webhook URL exists
    if (!n8nWebhookUrl) throw new Error("N8N_WEBHOOK_URL environment variable is not set");

    // Trigger n8n in background — don't await
    fetch(n8nWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: newRecord.id,
        companyName: cleanCompanyName,
        requestor: cleanRequestor,
      }),
    }).catch((err) => {
      console.error("Failed to trigger n8n webhook:", err);
    });

    // Respond immediately with 202 Accepted
    return new Response(
      JSON.stringify({
        id: newRecord.id,
        company_name: newRecord.company_name,
        requestor: newRecord.requestor,
        status: "Running",
        created_at: newRecord.created_at,
      }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
