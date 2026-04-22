import { getSupabase } from '../api/service-factory.js';
import type { ConversationExchange } from '../types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ConversationStore {
  // Returns the conversations table UUID for this (tenantId, conversationId) pair, creating if needed.
  async getOrCreate(conversationId: string, tenantId: string): Promise<string | null> {
    if (!UUID_RE.test(tenantId)) return null;

    const supabase = getSupabase();
    try {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conversationId)
        .maybeSingle();

      if (existing) return existing.id as string;

      const { data: created, error } = await supabase
        .from('conversations')
        .insert({ tenant_id: tenantId, conversation_id: conversationId })
        .select('id')
        .single();

      if (error) {
        console.error('[ConversationStore] insert error:', error.message);
        return null;
      }
      return created?.id ?? null;
    } catch (e) {
      console.error('[ConversationStore] getOrCreate error:', e);
      return null;
    }
  }

  async getRecentExchanges(conversationRowId: string, limit = 10): Promise<ConversationExchange[]> {
    const supabase = getSupabase();
    try {
      const { data } = await supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversationRowId)
        .order('created_at', { ascending: false })
        .limit(limit * 2);

      if (!data || data.length === 0) return [];

      const msgs = data.reverse();
      const exchanges: ConversationExchange[] = [];

      for (let i = 0; i < msgs.length - 1; i++) {
        if (msgs[i].role === 'user' && msgs[i + 1].role === 'assistant') {
          exchanges.push({ userMsg: msgs[i].content, aiResponse: msgs[i + 1].content });
          i++;
        }
      }

      return exchanges.slice(-limit);
    } catch (e) {
      console.error('[ConversationStore] getRecentExchanges error:', e);
      return [];
    }
  }

  async saveMessage(
    conversationRowId: string,
    role: 'user' | 'assistant',
    content: string,
    phantomsFired?: unknown[],
  ): Promise<void> {
    const supabase = getSupabase();
    try {
      await supabase.from('messages').insert({
        conversation_id: conversationRowId,
        role,
        content,
        phantoms_fired: phantomsFired ?? null,
      });
    } catch (e) {
      console.error('[ConversationStore] saveMessage error:', e);
    }
  }
}

let _store: ConversationStore | null = null;
export function getConversationStore(): ConversationStore {
  if (!_store) _store = new ConversationStore();
  return _store;
}
